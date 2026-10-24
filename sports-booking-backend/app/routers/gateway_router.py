import json
import os
import re
from typing import Optional
import time
from datetime import datetime, timezone

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .. import cashfree
from ..auth import get_current_user_id
from ..database import get_db, get_app_setting
from .games_router import online_breakdown, payment_fee_settings, _admit_paid_pay_first_player, PAY_FIRST_STATUS

router = APIRouter(prefix="/api/payments", tags=["payment-gateway"])

PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").rstrip("/")
UPI_RE = re.compile(r"^[A-Za-z0-9.\-_]{2,256}@[A-Za-z]{2,64}$")
PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")


class PayoutAccountRequest(BaseModel):
    upi_id: str
    account_holder: Optional[str] = None
    pan: Optional[str] = None


class CreateOrderRequest(BaseModel):
    game_id: int


def _phone10(phone: str) -> str:
    digits = re.sub(r"\D", "", phone or "")
    return digits[-10:] if len(digits) >= 10 else ""


def _require_gateway():
    if not cashfree.configured():
        raise HTTPException(status_code=503, detail="Online payments are not set up yet")


async def _refresh_vendor_status(db: aiosqlite.Connection, user_row: aiosqlite.Row) -> str:
    status = user_row["cf_vendor_status"] or ""
    if user_row["cf_vendor_id"] and status != "ACTIVE" and cashfree.configured():
        try:
            vendor = await cashfree.get_vendor(user_row["cf_vendor_id"])
        except cashfree.CashfreeError:
            return status
        status = vendor.get("status") or status
        await db.execute("UPDATE users SET cf_vendor_status = ? WHERE id = ?", (status, user_row["id"]))
        await db.commit()
    return status


@router.get("/gateway")
async def gateway_info(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    fees = await payment_fee_settings(db)
    return {
        "provider": "cashfree",
        "configured": cashfree.configured(),
        "mode": cashfree.mode(),
        "fee_percent": fees["surcharge_percent"],
        "gst_percent": fees["gst_percent"],
        "commission_percent": fees["commission_percent"],
        "app_fee_gst_percent": fees["app_fee_gst_percent"],
    }


@router.get("/payout-account")
async def get_payout_account(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    row = await (await db.execute(
        "SELECT id, payout_upi, payout_name, cf_vendor_id, cf_vendor_status FROM users WHERE id = ?", (user_id,)
    )).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    status = await _refresh_vendor_status(db, row)
    return {
        "upi_id": row["payout_upi"],
        "account_holder": row["payout_name"],
        "status": status,
        "ready": status == "ACTIVE",
        "gateway_configured": cashfree.configured(),
    }


@router.put("/payout-account")
async def save_payout_account(
    req: PayoutAccountRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    _require_gateway()
    upi = req.upi_id.strip()
    pan = (req.pan or "").strip().upper()
    if not UPI_RE.match(upi):
        raise HTTPException(status_code=400, detail="Enter a valid UPI ID, e.g. 98xxxxxx45@okhdfcbank")
    if pan and not PAN_RE.match(pan):
        raise HTTPException(status_code=400, detail="Enter a valid PAN, e.g. ABCDE1234F")
    row = await (await db.execute(
        "SELECT id, name, email, phone, cf_vendor_id FROM users WHERE id = ?", (user_id,)
    )).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    holder = (req.account_holder or "").strip() or (row["name"] or "").strip() or f"User {user_id}"
    phone = _phone10(row["phone"])
    if not phone:
        raise HTTPException(status_code=400, detail="Add your mobile number to your profile first")
    upi_details = {"vpa": upi, "account_holder": holder}
    kyc_details = {"account_type": "INDIVIDUAL", "business_type": "Miscellaneous", "pan": pan} if pan else None
    try:
        if row["cf_vendor_id"]:
            vendor_id = row["cf_vendor_id"]
            vendor = await cashfree.update_vendor(
                vendor_id, {"name": holder, "upi": upi_details, **({"kyc_details": kyc_details} if kyc_details else {})}
            )
        else:
            vendor_id = f"etb_u{user_id}"
            body = {
                "vendor_id": vendor_id,
                "status": "ACTIVE",
                "name": holder,
                "phone": phone,
                "verify_account": False,
                "dashboard_access": False,
                "schedule_option": 1,
                "upi": upi_details,
            }
            if kyc_details:
                body["kyc_details"] = kyc_details
            if row["email"]:
                body["email"] = row["email"]
            vendor = await cashfree.create_vendor(body)
    except cashfree.CashfreeError as e:
        raise HTTPException(status_code=400, detail=f"Cashfree: {e.message}")
    status = vendor.get("status") or ""
    await db.execute(
        "UPDATE users SET payout_upi = ?, payout_name = ?, cf_vendor_id = ?, cf_vendor_status = ? WHERE id = ?",
        (upi, holder, vendor_id, status, user_id),
    )
    await db.commit()
    return {"upi_id": upi, "account_holder": holder, "status": status, "ready": status == "ACTIVE", "gateway_configured": True}


def _public_base(request: Request) -> str:
    if PUBLIC_BASE_URL:
        return PUBLIC_BASE_URL
    base = str(request.base_url).rstrip("/")
    if base.startswith("http://") and "localhost" not in base and "127.0.0.1" not in base:
        base = "https://" + base[len("http://"):]
    return base


@router.post("/orders")
async def create_payment_order(
    req: CreateOrderRequest,
    request: Request,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    _require_gateway()
    game = await (await db.execute("SELECT * FROM games WHERE id = ?", (req.game_id,))).fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if (game["payment_collection"] or "offline") != "app":
        raise HTTPException(status_code=400, detail="This game's payments are tracked offline")
    if (await get_app_setting(db, 'payments_enabled', 'false')).lower() != 'true':
        raise HTTPException(status_code=400, detail="In-app payments are turned off")
    player = await (await db.execute(
        "SELECT 1 FROM game_players WHERE game_id = ? AND user_id = ? AND status IN ('selected', ?)",
        (req.game_id, user_id, PAY_FIRST_STATUS),
    )).fetchone()
    if not player:
        raise HTTPException(status_code=403, detail="You are not a selected player in this game")

    await db.execute(
        "INSERT OR IGNORE INTO payments (game_id, user_id, amount) VALUES (?, ?, ?)",
        (req.game_id, user_id, game["cost_per_person"]),
    )
    payment = await (await db.execute(
        "SELECT amount, paid_amount FROM payments WHERE game_id = ? AND user_id = ?", (req.game_id, user_id)
    )).fetchone()
    base = round(payment["amount"] - (payment["paid_amount"] or 0), 2)
    if base <= 0:
        raise HTTPException(status_code=400, detail="Already paid")

    payee_id = game["payee_user_id"] or game["created_by"]
    payee = await (await db.execute(
        "SELECT id, name, cf_vendor_id, cf_vendor_status FROM users WHERE id = ?", (payee_id,)
    )).fetchone()
    if not payee or not payee["cf_vendor_id"]:
        raise HTTPException(status_code=400, detail="The payment receiver hasn't added a UPI payout account yet")
    if await _refresh_vendor_status(db, payee) != "ACTIVE":
        raise HTTPException(status_code=400, detail="The payment receiver's payout account is still being verified")

    breakdown = online_breakdown(base, await payment_fee_settings(db))
    order_amount = breakdown["total"]
    vendor_amount = base
    commission = round(breakdown["app_fee"] + breakdown["app_fee_gst"], 2)
    fee = breakdown["gateway_fee"]

    user = await (await db.execute("SELECT name, email, phone FROM users WHERE id = ?", (user_id,))).fetchone()
    order_id = f"etb_{req.game_id}_{user_id}_{int(time.time())}"
    body = {
        "order_id": order_id,
        "order_amount": order_amount,
        "order_currency": "INR",
        "customer_details": {
            "customer_id": f"u{user_id}",
            "customer_phone": _phone10(user["phone"]) or "9999999999",
            "customer_name": user["name"] or "Player",
        },
        "order_note": f"{game['title']} ({game['game_date']})"[:200],
        "order_splits": [{"vendor_id": payee["cf_vendor_id"], "amount": vendor_amount}],
        "order_tags": {"game_id": str(req.game_id), "user_id": str(user_id)},
    }
    if user["email"]:
        body["customer_details"]["customer_email"] = user["email"]
    public_base = _public_base(request)
    if public_base.startswith("https://"):
        body["order_meta"] = {
            "return_url": f"{public_base}/?cf_order={order_id}",
            "notify_url": f"{public_base}/api/payments/webhook/cashfree",
        }
    try:
        order = await cashfree.create_order(body)
    except cashfree.CashfreeError as e:
        raise HTTPException(status_code=502, detail=f"Cashfree: {e.message}")

    await db.execute(
        """INSERT INTO payment_orders (order_id, game_id, user_id, base_amount, fee_amount, order_amount,
               vendor_id, vendor_amount, commission_amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (order_id, req.game_id, user_id, base, fee, order_amount, payee["cf_vendor_id"], vendor_amount, commission),
    )
    await db.commit()
    return {
        "order_id": order_id,
        "payment_session_id": order.get("payment_session_id"),
        "mode": cashfree.mode(),
        "base_amount": base,
        "fee_amount": fee,
        "app_fee_amount": commission,
        "order_amount": order_amount,
        "receiver_amount": vendor_amount,
        "receiver_name": payee["name"],
    }


async def _confirm_order(db: aiosqlite.Connection, row: aiosqlite.Row, cf_payment_id: str = "") -> str:
    if row["status"] == "paid":
        return "paid"
    try:
        order = await cashfree.get_order(row["order_id"])
    except cashfree.CashfreeError as e:
        raise HTTPException(status_code=502, detail=f"Cashfree: {e.message}")
    cf_status = order.get("order_status") or ""
    amount_ok = abs(float(order.get("order_amount") or 0) - row["order_amount"]) < 0.01
    if cf_status == "PAID" and amount_ok:
        now = datetime.now(timezone.utc).isoformat()
        cursor = await db.execute(
            "UPDATE payment_orders SET status = 'paid', paid_at = ?, cf_payment_id = ? WHERE id = ? AND status != 'paid'",
            (now, cf_payment_id, row["id"]),
        )
        if cursor.rowcount == 1:
            await db.execute(
                "UPDATE payments SET paid_amount = MIN(amount, COALESCE(paid_amount, 0) + ?), paid_at = ?, paid_by = user_id, paid_via = 'online' WHERE game_id = ? AND user_id = ?",
                (row["base_amount"], now, row["game_id"], row["user_id"]),
            )
            await db.execute(
                "UPDATE payments SET status = 'paid' WHERE game_id = ? AND user_id = ? AND paid_amount >= amount",
                (row["game_id"], row["user_id"]),
            )
            await db.execute(
                "UPDATE game_players SET payment_confirmed = 1 WHERE game_id = ? AND user_id = ?",
                (row["game_id"], row["user_id"]),
            )
            await _admit_paid_pay_first_player(db, row["game_id"], row["user_id"])
            game = await (await db.execute(
                "SELECT title, payee_user_id, created_by FROM games WHERE id = ?", (row["game_id"],)
            )).fetchone()
            payer = await (await db.execute("SELECT name FROM users WHERE id = ?", (row["user_id"],))).fetchone()
            title = game["title"] if game else "the game"
            await db.execute(
                "INSERT INTO notifications (user_id, game_id, type, message) VALUES (?, ?, 'payment_confirmed', ?)",
                (row["user_id"], row["game_id"], f"Payment of Rs {row['order_amount']:.2f} received for {title}."),
            )
            if game:
                await db.execute(
                    "INSERT INTO notifications (user_id, game_id, type, message) VALUES (?, ?, 'settlement_update', ?)",
                    (game["payee_user_id"] or game["created_by"], row["game_id"],
                     f"{payer['name'] if payer else 'A player'} paid online for {title}. "
                     f"Rs {row['vendor_amount']:.2f} will be settled to your UPI."),
                )
        await db.commit()
        return "paid"
    if cf_status in ("EXPIRED", "TERMINATED"):
        await db.execute("UPDATE payment_orders SET status = 'failed' WHERE id = ? AND status = 'created'", (row["id"],))
        await db.commit()
        return "failed"
    return "pending"


@router.post("/orders/{order_id}/verify")
async def verify_payment_order(
    order_id: str,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    _require_gateway()
    row = await (await db.execute("SELECT * FROM payment_orders WHERE order_id = ?", (order_id,))).fetchone()
    if not row or row["user_id"] != user_id:
        raise HTTPException(status_code=404, detail="Order not found")
    return {"order_id": order_id, "status": await _confirm_order(db, row)}


@router.post("/webhook/cashfree")
async def cashfree_webhook(request: Request, db: aiosqlite.Connection = Depends(get_db)):
    raw = await request.body()
    if not cashfree.verify_webhook(
        raw, request.headers.get("x-webhook-timestamp", ""), request.headers.get("x-webhook-signature", "")
    ):
        raise HTTPException(status_code=401, detail="Invalid signature")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    data = payload.get("data") if isinstance(payload, dict) else None
    order = data.get("order") if isinstance(data, dict) else None
    order_id = order.get("order_id") if isinstance(order, dict) else None
    if not order_id:
        return {"ok": True}
    payment = data.get("payment") if isinstance(data.get("payment"), dict) else {}
    row = await (await db.execute("SELECT * FROM payment_orders WHERE order_id = ?", (order_id,))).fetchone()
    if row:
        await _confirm_order(db, row, str(payment.get("cf_payment_id") or ""))
    return {"ok": True}

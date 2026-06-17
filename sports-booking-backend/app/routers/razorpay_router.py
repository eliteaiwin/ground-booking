import os
import hmac
import hashlib
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
import aiosqlite
import razorpay

from ..database import get_db
from ..auth import get_current_user_id

router = APIRouter(prefix="/api/razorpay", tags=["razorpay"])

RAZORPAY_KEY_ID = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
PLATFORM_COMMISSION_PERCENT = 3  # Platform keeps 3%, Razorpay takes ~2% separately


def get_razorpay_client():
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        raise HTTPException(status_code=500, detail="Razorpay not configured")
    return razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))


class CreateOrderRequest(BaseModel):
    game_id: int


class VerifyPaymentRequest(BaseModel):
    game_id: int
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@router.get("/config")
async def get_razorpay_config():
    """Return public Razorpay key for frontend checkout."""
    return {
        "key_id": RAZORPAY_KEY_ID,
        "enabled": bool(RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET),
    }


@router.post("/create-order")
async def create_order(
    req: CreateOrderRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Create a Razorpay order for a game payment."""
    # Get game details
    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (req.game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    # Check user is a selected player
    cursor = await db.execute(
        "SELECT * FROM game_players WHERE game_id = ? AND user_id = ? AND status = 'selected'",
        (req.game_id, user_id),
    )
    player = await cursor.fetchone()
    if not player:
        raise HTTPException(status_code=400, detail="You are not a selected player in this game")

    if player["payment_confirmed"] == 1:
        raise HTTPException(status_code=400, detail="Payment already confirmed")

    # Check if already has a pending order
    cursor = await db.execute(
        "SELECT * FROM razorpay_orders WHERE game_id = ? AND user_id = ? AND status = 'created'",
        (req.game_id, user_id),
    )
    existing = await cursor.fetchone()
    if existing:
        return {
            "order_id": existing["razorpay_order_id"],
            "amount": existing["amount"],
            "currency": "INR",
            "key_id": RAZORPAY_KEY_ID,
        }

    # Create Razorpay order
    amount_paise = int(game["cost_per_person"] * 100)  # Convert to paise
    client = get_razorpay_client()

    # Get user info for receipt
    cursor = await db.execute("SELECT name, phone FROM users WHERE id = ?", (user_id,))
    user_row = await cursor.fetchone()

    order_data = {
        "amount": amount_paise,
        "currency": "INR",
        "receipt": f"game_{req.game_id}_user_{user_id}",
        "notes": {
            "game_id": str(req.game_id),
            "user_id": str(user_id),
            "game_title": game["title"],
            "player_name": user_row["name"] if user_row else "",
        },
    }

    try:
        order = client.order.create(data=order_data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Razorpay order creation failed: {str(e)}")

    # Store order in DB
    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        """INSERT INTO razorpay_orders 
           (razorpay_order_id, game_id, user_id, amount, status, created_at)
           VALUES (?, ?, ?, ?, 'created', ?)""",
        (order["id"], req.game_id, user_id, amount_paise, now),
    )
    await db.commit()

    return {
        "order_id": order["id"],
        "amount": amount_paise,
        "currency": "INR",
        "key_id": RAZORPAY_KEY_ID,
    }


@router.post("/verify-payment")
async def verify_payment(
    req: VerifyPaymentRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Verify Razorpay payment signature and confirm payment."""
    # Verify signature
    message = f"{req.razorpay_order_id}|{req.razorpay_payment_id}"
    expected_signature = hmac.HMAC(
        RAZORPAY_KEY_SECRET.encode("utf-8"),
        message.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if expected_signature != req.razorpay_signature:
        raise HTTPException(status_code=400, detail="Invalid payment signature")

    # Check order exists
    cursor = await db.execute(
        "SELECT * FROM razorpay_orders WHERE razorpay_order_id = ? AND user_id = ?",
        (req.razorpay_order_id, user_id),
    )
    order = await cursor.fetchone()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order["status"] == "paid":
        return {"message": "Payment already verified", "status": "paid"}

    now = datetime.now(timezone.utc).isoformat()

    # Update order status
    await db.execute(
        """UPDATE razorpay_orders 
           SET status = 'paid', razorpay_payment_id = ?, paid_at = ?
           WHERE razorpay_order_id = ?""",
        (req.razorpay_payment_id, now, req.razorpay_order_id),
    )

    game_id = order["game_id"]

    # Mark payment as confirmed in game_players
    await db.execute(
        "UPDATE game_players SET payment_confirmed = 1, payment_marked_by = ?, payment_marked_at = ? WHERE game_id = ? AND user_id = ?",
        (user_id, now, game_id, user_id),
    )

    # Update or create payment record
    cursor = await db.execute(
        "SELECT * FROM payments WHERE game_id = ? AND user_id = ?",
        (game_id, user_id),
    )
    payment = await cursor.fetchone()
    if not payment:
        cursor2 = await db.execute("SELECT cost_per_person FROM games WHERE id = ?", (game_id,))
        game = await cursor2.fetchone()
        await db.execute(
            "INSERT INTO payments (game_id, user_id, amount, status, paid_at) VALUES (?, ?, ?, 'paid', ?)",
            (game_id, user_id, game["cost_per_person"] if game else 0, now),
        )
    else:
        await db.execute(
            "UPDATE payments SET status = 'paid', paid_at = ? WHERE game_id = ? AND user_id = ?",
            (now, game_id, user_id),
        )

    # Notify user
    cursor = await db.execute("SELECT title FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    game_title = game["title"] if game else "Unknown"
    await db.execute(
        "INSERT INTO notifications (user_id, game_id, type, message) VALUES (?, ?, 'payment_confirmed', ?)",
        (user_id, game_id, f"Payment of ₹{order['amount'] / 100:.0f} confirmed for {game_title} via Razorpay!"),
    )

    await db.commit()

    # Attempt Route transfer (split payment) - non-blocking
    try:
        await _process_route_transfer(db, game_id, user_id, req.razorpay_payment_id, order["amount"])
    except Exception:
        pass  # Route transfer failures are logged but don't block payment confirmation

    return {"message": "Payment verified successfully", "status": "paid"}


async def _process_route_transfer(
    db: aiosqlite.Connection,
    game_id: int,
    user_id: int,
    payment_id: str,
    amount_paise: int,
):
    """Transfer funds via Razorpay Route: 90% to payee, 10% platform commission."""
    cursor = await db.execute("SELECT payee_user_id FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game or not game["payee_user_id"]:
        return  # No payee configured, skip transfer

    # Check if payee has a linked Razorpay account
    cursor = await db.execute(
        "SELECT razorpay_account_id FROM users WHERE id = ?",
        (game["payee_user_id"],),
    )
    payee = await cursor.fetchone()
    if not payee:
        return
    
    razorpay_account_id = None
    try:
        razorpay_account_id = payee["razorpay_account_id"]
    except Exception:
        return

    if not razorpay_account_id:
        return  # Payee hasn't linked their Razorpay account yet

    # Calculate split: 90% to payee
    payee_amount = int(amount_paise * (100 - PLATFORM_COMMISSION_PERCENT) / 100)

    client = get_razorpay_client()
    try:
        client.payment.transfer(
            payment_id,
            {
                "transfers": [
                    {
                        "account": razorpay_account_id,
                        "amount": payee_amount,
                        "currency": "INR",
                        "notes": {
                            "game_id": str(game_id),
                            "user_id": str(user_id),
                            "type": "game_payment_split",
                        },
                    }
                ]
            },
        )
    except Exception as e:
        # Log but don't fail - transfer can be retried
        print(f"Route transfer failed for payment {payment_id}: {e}")

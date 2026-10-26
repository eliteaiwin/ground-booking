import os
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, timedelta
import aiosqlite

from .. import cashfree
from ..database import get_db, get_app_setting
from ..auth import get_current_user_id
from ..currency import ground_currency

router = APIRouter(prefix="/api/payments", tags=["payments"])


class RecordPaymentRequest(BaseModel):
    game_id: int


class MarkPaidWithCommentRequest(BaseModel):
    user_id: int
    game_id: int
    comment: str = ""


async def require_admin_or_moderator(user_id: int, db: aiosqlite.Connection):
    cursor = await db.execute(
        "SELECT role FROM user_roles WHERE user_id = ? AND role IN ('admin', 'moderator')", (user_id,)
    )
    if not await cursor.fetchone():
        raise HTTPException(status_code=403, detail="Admin or Moderator access required")


@router.post("/pay")
async def record_payment(
    req: RecordPaymentRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    # Check payment exists
    cursor = await db.execute(
        "SELECT * FROM payments WHERE game_id = ? AND user_id = ?",
        (req.game_id, user_id)
    )
    payment = await cursor.fetchone()
    game_row = await (await db.execute("SELECT payment_collection FROM games WHERE id = ?", (req.game_id,))).fetchone()
    if game_row and (game_row["payment_collection"] or "offline") == "app" and cashfree.configured() \
            and (await get_app_setting(db, 'payments_enabled', 'false')).lower() == 'true':
        raise HTTPException(status_code=400, detail="This game is paid through the app. Use Pay online.")
    if not payment:
        cursor = await db.execute(
            """SELECT g.cost_per_person FROM game_players gp JOIN games g ON g.id = gp.game_id
               WHERE gp.game_id = ? AND gp.user_id = ? AND gp.status = 'selected'""",
            (req.game_id, user_id)
        )
        player = await cursor.fetchone()
        if not player:
            raise HTTPException(status_code=404, detail="No payment record found")
        await db.execute(
            "INSERT INTO payments (game_id, user_id, amount) VALUES (?, ?, ?)",
            (req.game_id, user_id, player["cost_per_person"])
        )
        cursor = await db.execute(
            "SELECT * FROM payments WHERE game_id = ? AND user_id = ?", (req.game_id, user_id)
        )
        payment = await cursor.fetchone()
    if (payment["paid_amount"] or 0) >= payment["amount"]:
        raise HTTPException(status_code=400, detail="Already paid")

    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE payments SET status = 'paid', paid_amount = amount, paid_at = ?, paid_by = ?, paid_via = 'self' "
        "WHERE game_id = ? AND user_id = ?",
        (now, user_id, req.game_id, user_id)
    )

    # Update player payment_confirmed so frontend shows correct status
    await db.execute(
        "UPDATE game_players SET payment_confirmed = 1 WHERE game_id = ? AND user_id = ?",
        (req.game_id, user_id)
    )

    # Notify user of payment confirmation
    cursor = await db.execute("SELECT title FROM games WHERE id = ?", (req.game_id,))
    game = await cursor.fetchone()
    game_title = game["title"] if game else "Unknown"

    await db.execute(
        "INSERT INTO notifications (user_id, game_id, type, message) VALUES (?, ?, 'payment_confirmed', ?)",
        (user_id, req.game_id, f"Payment confirmed for {game_title}!")
    )

    await db.commit()
    return {"message": "Payment recorded successfully"}


PROOF_DIR = os.environ.get("UPLOAD_DIR", "/data/uploads" if os.path.exists("/data") else "./uploads")
os.makedirs(PROOF_DIR, exist_ok=True)
PROOF_MAX_BYTES = 10 * 1024 * 1024


def _short_date(d: str) -> str:
    try:
        return datetime.strptime(d, "%Y-%m-%d").strftime("%d-%b-%y")
    except (TypeError, ValueError):
        return d or ""


def _money(currency: str, amount: float) -> str:
    text = f"{amount:,.0f}" if float(amount).is_integer() else f"{amount:,.2f}"
    return f"{currency} {text}" if currency[-1:].isalpha() else f"{currency}{text}"


@router.post("/pay-with-proof")
async def record_payment_with_proof(
    game_id: int = Form(...),
    file: UploadFile = File(...),
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Settle Offline: the player marks their share as paid and attaches a payment screenshot."""
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload a screenshot image of the payment")
    content = await file.read(PROOF_MAX_BYTES + 1)
    if len(content) > PROOF_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Screenshot too large. Max size: 10MB")
    if not content:
        raise HTTPException(status_code=400, detail="The screenshot is empty")
    pay = await (await db.execute(
        "SELECT amount, paid_amount FROM payments WHERE game_id = ? AND user_id = ?", (game_id, user_id)
    )).fetchone()
    owed = max(0.0, (pay["amount"] - (pay["paid_amount"] or 0))) if pay else None

    try:
        await record_payment(RecordPaymentRequest(game_id=game_id), user_id, db)
    except HTTPException as e:
        if e.detail != "Already paid":
            raise

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif"):
        ext = ".jpg"
    name = f"proof_{uuid.uuid4().hex}{ext}"
    with open(os.path.join(PROOF_DIR, name), "wb") as f:
        f.write(content)
    await db.execute("UPDATE payments SET proof_file = ? WHERE game_id = ? AND user_id = ?", (name, game_id, user_id))

    game = await (await db.execute(
        "SELECT title, game_date, ground_name, created_by, payee_user_id, cost_per_person FROM games WHERE id = ?", (game_id,)
    )).fetchone()
    payer = await (await db.execute("SELECT name FROM users WHERE id = ?", (user_id,))).fetchone()
    if game:
        if owed is None:
            row = await (await db.execute("SELECT amount FROM payments WHERE game_id = ? AND user_id = ?", (game_id, user_id))).fetchone()
            owed = row["amount"] if row else game["cost_per_person"]
        amount = _money(await ground_currency(db, game["ground_name"]), owed)
        message = (f"{payer['name'] if payer else 'A player'} marked {amount} as paid for {game['title']} "
                   f"({_short_date(game['game_date'])}) and uploaded a payment screenshot.")
        for mod_id in {game["created_by"], game["payee_user_id"]} - {None, user_id}:
            await db.execute(
                "INSERT INTO notifications (user_id, game_id, type, message) VALUES (?, ?, 'payment_proof', ?)",
                (mod_id, game_id, message)
            )
    await db.commit()
    return {"message": "Marked as paid. The moderator has been told and can see your screenshot."}


@router.get("/proof/{game_id}/{player_id}")
async def get_payment_proof(
    game_id: int,
    player_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    if user_id != player_id:
        from .games_router import can_moderate_game
        await require_admin_or_moderator(user_id, db)
        if not await can_moderate_game(user_id, game_id, db):
            raise HTTPException(status_code=403, detail="Only this game's moderators can see payment screenshots")
    row = await (await db.execute(
        "SELECT proof_file FROM payments WHERE game_id = ? AND user_id = ?", (game_id, player_id)
    )).fetchone()
    path = os.path.join(PROOF_DIR, row["proof_file"]) if row and row["proof_file"] else ""
    if not path or not os.path.exists(path):
        raise HTTPException(status_code=404, detail="No payment screenshot")
    return FileResponse(path)


@router.get("/my")
async def my_payments(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    cursor = await db.execute(
        """SELECT p.*, g.title, g.sport_type, g.game_date, g.game_time, g.ground_name
           FROM payments p JOIN games g ON p.game_id = g.id 
           WHERE p.user_id = ? ORDER BY g.game_date DESC""",
        (user_id,)
    )
    payments = await cursor.fetchall()
    currencies = {name: await ground_currency(db, name) for name in {p["ground_name"] for p in payments}}
    return [
        {
            "id": p["id"],
            "game_id": p["game_id"],
            "currency": currencies[p["ground_name"]],
            "game_title": p["title"],
            "sport_type": p["sport_type"],
            "game_date": p["game_date"],
            "game_time": p["game_time"],
            "ground_name": p["ground_name"],
            "amount": p["amount"],
            "paid_amount": p["paid_amount"] or 0,
            "pending": max(0, p["amount"] - (p["paid_amount"] or 0)),
            "status": "paid" if (p["paid_amount"] or 0) >= p["amount"] else "pending",
            "paid_at": p["paid_at"]
        }
        for p in payments
    ]


@router.get("/summary")
async def payment_summary(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
    payment_status: Optional[str] = Query(None),
    game_status: Optional[str] = Query(None),
    date_range: Optional[str] = Query(None),
    game_id: Optional[int] = Query(None),
):
    await require_admin_or_moderator(user_id, db)

    # Build date filter
    date_filter = ""
    date_params: list = []
    if date_range == "today5":
        now = datetime.now(timezone.utc)
        start = (now - timedelta(days=5)).strftime("%Y-%m-%d")
        end = (now + timedelta(days=5)).strftime("%Y-%m-%d")
        date_filter = " AND g.game_date >= ? AND g.game_date <= ?"
        date_params = [start, end]
    elif date_range == "month":
        now = datetime.now(timezone.utc)
        start = (now - timedelta(days=30)).strftime("%Y-%m-%d")
        date_filter = " AND g.game_date >= ?"
        date_params = [start]
    elif date_range == "year":
        now = datetime.now(timezone.utc)
        start = (now - timedelta(days=365)).strftime("%Y-%m-%d")
        date_filter = " AND g.game_date >= ?"
        date_params = [start]

    # Build game status filter
    game_status_filter = ""
    if game_status == "voting_open":
        game_status_filter = " AND g.status = 'voting_open'"
    elif game_status == "completed":
        game_status_filter = " AND g.status = 'completed'"
    elif game_status == "in_progress":
        game_status_filter = " AND g.status = 'in_progress'"
    elif game_status == "abandoned":
        game_status_filter = " AND g.status = 'abandoned'"

    # Build game id filter
    game_id_filter = ""
    game_id_params: list = []
    if game_id:
        game_id_filter = " AND g.id = ?"
        game_id_params = [game_id]

    # Build payment status filter for user query
    pay_filter = ""
    if payment_status == "paid":
        pay_filter = " AND p.paid_amount >= p.amount"
    elif payment_status == "pending":
        pay_filter = " AND (p.paid_amount IS NULL OR p.paid_amount < p.amount)"

    # Per-game summary
    # Note: pay_filter is applied in the JOIN ON clause (not WHERE) so that games
    # without matching payments still appear with zeroed counts instead of being
    # excluded entirely by the LEFT JOIN → INNER JOIN conversion.
    query = """SELECT g.id, g.title, g.sport_type, g.game_date, g.ground_name, g.cost_per_person, g.status as game_status,
           COUNT(p.id) as total_players,
           SUM(CASE WHEN p.paid_amount >= p.amount THEN 1 ELSE 0 END) as paid_count,
           SUM(CASE WHEN p.paid_amount IS NULL OR p.paid_amount < p.amount THEN 1 ELSE 0 END) as pending_count,
           COALESCE(SUM(p.paid_amount), 0) as total_collected,
           COALESCE(SUM(CASE WHEN p.paid_amount >= p.amount THEN 0 ELSE p.amount - p.paid_amount END), 0) as total_pending
           FROM games g LEFT JOIN payments p ON g.id = p.game_id""" + pay_filter + """
           WHERE 1=1""" + date_filter + game_status_filter + game_id_filter + """
           GROUP BY g.id ORDER BY g.game_date DESC"""
    params = date_params + game_id_params
    cursor = await db.execute(query, params)
    games = await cursor.fetchall()

    # Per-user payments (with filters)
    user_query = """SELECT u.id, u.name, u.first_name, u.last_name, u.phone, 
           p.game_id, g.title as game_title, g.game_date, g.sport_type, g.ground_name, g.status as game_status,
           p.amount, p.paid_amount, p.paid_at
           FROM payments p 
           JOIN users u ON p.user_id = u.id
           JOIN games g ON p.game_id = g.id
           WHERE 1=1""" + pay_filter + date_filter + game_status_filter + game_id_filter + """
           ORDER BY u.name, g.game_date DESC"""
    user_params = date_params + game_id_params
    cursor = await db.execute(user_query, user_params)
    user_payments = await cursor.fetchall()

    # Group by user
    users_map: dict = {}
    for up in user_payments:
        uid = up["id"]
        paid_amount = up["paid_amount"] or 0
        is_paid = paid_amount >= up["amount"]
        pending = max(0, up["amount"] - paid_amount)
        if uid not in users_map:
            display_name = up["name"] or f"{up['first_name'] or ''} {up['last_name'] or ''}".strip()
            users_map[uid] = {
                "user_id": uid,
                "name": display_name,
                "phone": up["phone"],
                "games": [],
                "total_pending": 0.0,
                "total_paid": 0.0,
            }
        users_map[uid]["games"].append({
            "game_id": up["game_id"],
            "game_title": up["game_title"],
            "game_date": up["game_date"],
            "sport_type": up["sport_type"],
            "ground_name": up["ground_name"],
            "game_status": up["game_status"],
            "amount": up["amount"],
            "paid_amount": paid_amount,
            "pending": pending,
            "status": "paid" if is_paid else "pending",
            "paid_at": up["paid_at"],
        })
        if is_paid:
            users_map[uid]["total_paid"] += paid_amount
        else:
            users_map[uid]["total_pending"] += pending

    users_list = sorted(users_map.values(), key=lambda x: x["total_pending"], reverse=True)
    currencies = {name: await ground_currency(db, name) for name in {g["ground_name"] for g in games} | {up["ground_name"] for up in user_payments}}
    for u in users_list:
        for ug in u["games"]:
            ug["currency"] = currencies[ug["ground_name"]]

    # Also return list of games for dropdown (filtered by date range and status)
    games_dropdown_query = """SELECT g.id, g.title, g.game_date, g.sport_type, g.ground_name, g.status
           FROM games g WHERE 1=1""" + date_filter + game_status_filter + """
           ORDER BY g.game_date DESC"""
    games_dropdown_params = date_params
    cursor = await db.execute(games_dropdown_query, games_dropdown_params)
    games_dropdown = await cursor.fetchall()

    return {
        "per_game": [
            {
                "game_id": g["id"],
                "title": g["title"],
                "sport_type": g["sport_type"],
                "game_date": g["game_date"],
                "ground_name": g["ground_name"],
                "cost_per_person": g["cost_per_person"],
                "currency": currencies[g["ground_name"]],
                "game_status": g["game_status"],
                "total_players": g["total_players"],
                "paid_count": g["paid_count"] or 0,
                "pending_count": g["pending_count"] or 0,
                "total_collected": g["total_collected"] or 0,
                "total_pending": g["total_pending"] or 0
            }
            for g in games
        ],
        "users_with_payments": users_list,
        "games_dropdown": [
            {
                "id": gd["id"],
                "title": gd["title"],
                "game_date": gd["game_date"],
                "sport_type": gd["sport_type"],
                "ground_name": gd["ground_name"],
                "status": gd["status"],
            }
            for gd in games_dropdown
        ],
    }


@router.post("/mark-paid-with-comment")
async def mark_paid_with_comment(
    req: MarkPaidWithCommentRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Mark a user's payment as paid with a comment. Logs settlement record."""
    await require_admin_or_moderator(user_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (req.game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    now = datetime.now(timezone.utc).isoformat()

    # Check if payment record exists
    cursor = await db.execute(
        "SELECT * FROM payments WHERE game_id = ? AND user_id = ?",
        (req.game_id, req.user_id)
    )
    payment = await cursor.fetchone()
    if not payment:
        await db.execute(
            "INSERT INTO payments (game_id, user_id, amount, paid_amount, status, paid_at, paid_by, paid_via) "
            "VALUES (?, ?, ?, ?, 'paid', ?, ?, 'moderator')",
            (req.game_id, req.user_id, game["cost_per_person"], game["cost_per_person"], now, user_id)
        )
    elif (payment["paid_amount"] or 0) < payment["amount"]:
        await db.execute(
            "UPDATE payments SET status = 'paid', paid_amount = amount, paid_at = ?, paid_by = ?, paid_via = 'moderator' "
            "WHERE game_id = ? AND user_id = ?",
            (now, user_id, req.game_id, req.user_id)
        )

    # Always update player payment_confirmed (fixes inconsistency if payment was
    # already 'paid' but payment_confirmed was still 0 from a prior partial failure)
    await db.execute(
        "UPDATE game_players SET payment_confirmed = 1 WHERE game_id = ? AND user_id = ?",
        (req.game_id, req.user_id)
    )

    # Log the settlement record
    await db.execute(
        """INSERT INTO payment_settlements 
           (game_id, user_id, moderator_id, comment, action_date) 
           VALUES (?, ?, ?, ?, ?)""",
        (req.game_id, req.user_id, user_id, req.comment, now)
    )

    # Get user and moderator names
    cursor = await db.execute("SELECT name FROM users WHERE id = ?", (req.user_id,))
    target_user = await cursor.fetchone()
    target_name = target_user["name"] if target_user else "Unknown"

    cursor = await db.execute("SELECT name FROM users WHERE id = ?", (user_id,))
    mod_user = await cursor.fetchone()
    mod_name = mod_user["name"] if mod_user else "Moderator"

    # Notify the user
    comment_text = f" Comment: {req.comment}" if req.comment else ""
    await db.execute(
        "INSERT INTO notifications (user_id, game_id, type, message) VALUES (?, ?, 'payment_confirmed', ?)",
        (req.user_id, req.game_id,
         f"Your payment for {game['title']} has been marked as paid by {mod_name}.{comment_text}")
    )

    # Notify all moderators of this game
    cursor = await db.execute(
        """SELECT DISTINCT ur.user_id FROM user_roles ur
           WHERE ur.role IN ('admin', 'moderator') AND ur.user_id != ?""",
        (user_id,)
    )
    mod_rows = await cursor.fetchall()
    for m in mod_rows:
        await db.execute(
            "INSERT INTO notifications (user_id, game_id, type, message) VALUES (?, ?, 'settlement_update', ?)",
            (m["user_id"], req.game_id,
             f"{mod_name} marked {target_name}'s payment for {game['title']} as paid.{comment_text}")
        )

    await db.commit()
    return {"message": "Payment marked as paid", "user_name": target_name}


@router.get("/settlements")
async def get_settlements(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Get all settlement records (Mark as Paid logs) for admin/moderator."""
    await require_admin_or_moderator(user_id, db)

    cursor = await db.execute(
        """SELECT ps.id, ps.game_id, ps.user_id, ps.moderator_id, ps.comment, ps.action_date,
           g.title as game_title, g.game_date, g.sport_type, g.ground_name,
           u.name as user_name, u.phone as user_phone,
           m.name as moderator_name
           FROM payment_settlements ps
           JOIN games g ON ps.game_id = g.id
           JOIN users u ON ps.user_id = u.id
           JOIN users m ON ps.moderator_id = m.id
           ORDER BY ps.action_date DESC"""
    )
    rows = await cursor.fetchall()

    return [
        {
            "id": r["id"],
            "game_id": r["game_id"],
            "game_title": r["game_title"],
            "game_date": r["game_date"],
            "sport_type": r["sport_type"],
            "ground_name": r["ground_name"],
            "user_id": r["user_id"],
            "user_name": r["user_name"],
            "user_phone": r["user_phone"],
            "moderator_id": r["moderator_id"],
            "moderator_name": r["moderator_name"],
            "comment": r["comment"],
            "action_date": r["action_date"],
        }
        for r in rows
    ]


# --- Per-player payment history (popup Payment tab / My Profile) ---

class HistoryActionRequest(BaseModel):
    game_id: int
    comment: str = ""


def _local_paid_at(value) -> Optional[datetime]:
    """paid_at is stored as UTC (ISO with offset, or SQLite's naive UTC timestamp); convert to the games' local time."""
    from zoneinfo import ZoneInfo
    from .games_router import APP_TIMEZONE
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(ZoneInfo(APP_TIMEZONE)).replace(tzinfo=None)


async def _require_history_viewer(viewer_id: int, player_id: int, db: aiosqlite.Connection):
    if viewer_id != player_id:
        await require_admin_or_moderator(viewer_id, db)


@router.get("/history/{player_id}")
async def payment_history(
    player_id: int,
    game_id: Optional[int] = Query(None),
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Every completed game a player owes for: owed, paid, remaining (negative = excess) and how long after the game they paid.
    With game_id, only games of that game's series (e.g. every 'Wed Blr united' game) are included."""
    from .games_router import _game_end, can_moderate_game, _payment_settings
    await _require_history_viewer(user_id, player_id, db)
    where, params = "p.user_id = ? AND g.status = 'completed'", [player_id]
    series = ""
    if game_id is not None:
        game = await (await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))).fetchone()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        if game["series_name"]:
            where += " AND g.series_name = ? AND g.ground_name = ?"
            params += [game["series_name"], game["ground_name"]]
            series = game["series_name"]
        else:
            where += " AND g.title = ? AND g.ground_name = ?"
            params += [game["title"], game["ground_name"]]
            series = game["title"]
    rows = await (await db.execute(
        f"""SELECT p.game_id, p.amount, COALESCE(p.paid_amount, 0) AS paid_amount, p.paid_at, p.paid_via,
                   g.title, g.series_name, g.ground_name, g.game_date, g.game_time, g.duration_minutes, g.status AS game_status,
                   g.payment_collection, u.name AS payee_name
            FROM payments p JOIN games g ON g.id = p.game_id LEFT JOIN users u ON u.id = g.payee_user_id
            WHERE {where} ORDER BY g.game_date DESC, g.game_time DESC""",
        params
    )).fetchall()
    is_admin = await (await db.execute(
        "SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,)
    )).fetchone() is not None
    is_mod = is_admin or await (await db.execute(
        "SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'moderator'", (user_id,)
    )).fetchone() is not None

    online_ready = (await _payment_settings(db))["enabled"] and cashfree.configured()
    items, pay_minutes = [], []
    for r in rows:
        remaining = round(r["amount"] - r["paid_amount"], 2)
        end = _game_end(r)
        paid_at = _local_paid_at(r["paid_at"]) if r["paid_amount"] > 0 else None
        done = None
        if paid_at and end and remaining <= 0:
            done = int((paid_at - end).total_seconds() // 60)
            if r["game_status"] == "completed":
                pay_minutes.append(max(done, 0))
        items.append({
            "game_id": r["game_id"],
            "game_name": r["series_name"] or r["title"],
            "currency": await ground_currency(db, r["ground_name"]),
            "title": r["title"],
            "game_date": r["game_date"],
            "game_time": r["game_time"],
            "game_status": r["game_status"],
            "amount": r["amount"],
            "paid_amount": r["paid_amount"],
            "remaining": remaining,
            "balance": 0.0 - remaining,
            "payee_name": r["payee_name"] or "",
            "pay_online": bool(user_id == player_id and remaining > 0 and (r["payment_collection"] or "offline") == "app"
                               and online_ready),
            "paid_at": paid_at.strftime("%Y-%m-%d %H:%M") if paid_at else None,
            "paid_via": r["paid_via"] or "",
            "done_minutes": done,
            "can_pay": user_id == player_id and remaining > 0,
            "can_settle": bool(is_mod and user_id != player_id and remaining != 0 and (is_admin or await can_moderate_game(user_id, r["game_id"], db))),
        })
    owed = round(sum(i["amount"] for i in items), 2)
    paid = round(sum(i["paid_amount"] for i in items), 2)
    return {
        "player_id": player_id,
        "series": series,
        "summary": {
            "owed": owed,
            "paid": paid,
            "due": round(sum(i["remaining"] for i in items if i["remaining"] > 0), 2),
            "excess": round(-sum(i["remaining"] for i in items if i["remaining"] < 0), 2),
            "outstanding": round(owed - paid, 2),
            "avg_pay_minutes": round(sum(pay_minutes) / len(pay_minutes)) if pay_minutes else None,
        },
        "items": items,
    }


async def _history_payment(db: aiosqlite.Connection, user_id: int, player_id: int, game_id: int):
    from .games_router import require_game_moderator
    await require_game_moderator(user_id, game_id, db)
    game = await (await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))).fetchone()
    row = await (await db.execute(
        "SELECT amount, COALESCE(paid_amount, 0) AS paid_amount FROM payments WHERE game_id = ? AND user_id = ?",
        (game_id, player_id)
    )).fetchone()
    if not game or not row:
        raise HTTPException(status_code=404, detail="No payment for this player in that game")
    return game, row


@router.post("/history/{player_id}/settle")
async def settle_offline(
    player_id: int,
    req: HistoryActionRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    """Moderator confirms a due (player paid offline) or an excess (returned offline) is settled; remaining becomes 0."""
    game, row = await _history_payment(db, user_id, player_id, req.game_id)
    diff = round(row["amount"] - row["paid_amount"], 2)
    if diff == 0:
        raise HTTPException(status_code=400, detail="Nothing to settle: this payment is already even")
    now = datetime.now(timezone.utc).isoformat()
    if diff > 0:
        await db.execute(
            "UPDATE payments SET status = 'paid', paid_amount = amount, paid_at = ?, paid_by = ?, paid_via = 'offline' "
            "WHERE game_id = ? AND user_id = ?",
            (now, user_id, req.game_id, player_id)
        )
        await db.execute(
            "UPDATE game_players SET payment_confirmed = 1 WHERE game_id = ? AND user_id = ?", (req.game_id, player_id)
        )
        what = f"due of {diff:.0f}"
    else:
        await db.execute(
            "UPDATE payments SET paid_amount = amount WHERE game_id = ? AND user_id = ?", (req.game_id, player_id)
        )
        what = f"excess of {-diff:.0f}"
    comment = req.comment.strip()[:300]
    await db.execute(
        "INSERT INTO payment_settlements (game_id, user_id, moderator_id, comment, action_date) VALUES (?, ?, ?, ?, ?)",
        (req.game_id, player_id, user_id, f"Settled offline: {what}" + (f". {comment}" if comment else ""), now)
    )
    mod = await (await db.execute("SELECT name FROM users WHERE id = ?", (user_id,))).fetchone()
    await db.execute(
        "INSERT INTO notifications (user_id, game_id, type, message) VALUES (?, ?, 'payment_confirmed', ?)",
        (player_id, req.game_id,
         f"{mod['name'] if mod else 'Moderator'} confirmed your {what} for {game['title']} ({game['game_date']}) was settled offline.")
    )
    await db.commit()
    return {"message": f"Settled {what}"}


@router.post("/history/{player_id}/remind")
async def remind_payment(
    player_id: int,
    req: HistoryActionRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    game, row = await _history_payment(db, user_id, player_id, req.game_id)
    due = round(row["amount"] - row["paid_amount"], 2)
    if due <= 0:
        raise HTTPException(status_code=400, detail="Nothing is due for this game")
    await db.execute(
        "INSERT INTO notifications (user_id, game_id, type, message) VALUES (?, ?, 'payment_reminder', ?)",
        (player_id, req.game_id,
         f"Reminder: please pay {due:.0f} for {game['title']} on {game['game_date']}.")
    )
    await db.commit()
    return {"message": "Reminder sent"}

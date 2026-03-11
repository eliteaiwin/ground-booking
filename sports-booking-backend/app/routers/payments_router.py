from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone, timedelta
import aiosqlite

from ..database import get_db
from ..auth import get_current_user_id

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
    if not payment:
        raise HTTPException(status_code=404, detail="No payment record found")
    if payment["status"] == "paid":
        raise HTTPException(status_code=400, detail="Already paid")

    now = datetime.now(timezone.utc).isoformat()
    await db.execute(
        "UPDATE payments SET status = 'paid', paid_at = ? WHERE game_id = ? AND user_id = ?",
        (now, req.game_id, user_id)
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
    return [
        {
            "id": p["id"],
            "game_id": p["game_id"],
            "game_title": p["title"],
            "sport_type": p["sport_type"],
            "game_date": p["game_date"],
            "game_time": p["game_time"],
            "ground_name": p["ground_name"],
            "amount": p["amount"],
            "status": p["status"],
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
        pay_filter = " AND p.status = 'paid'"
    elif payment_status == "pending":
        pay_filter = " AND p.status = 'pending'"

    # Per-game summary
    query = """SELECT g.id, g.title, g.sport_type, g.game_date, g.ground_name, g.cost_per_person, g.status as game_status,
           COUNT(p.id) as total_players,
           SUM(CASE WHEN p.status='paid' THEN 1 ELSE 0 END) as paid_count,
           SUM(CASE WHEN p.status='pending' THEN 1 ELSE 0 END) as pending_count,
           SUM(CASE WHEN p.status='paid' THEN p.amount ELSE 0 END) as total_collected,
           SUM(CASE WHEN p.status='pending' THEN p.amount ELSE 0 END) as total_pending
           FROM games g LEFT JOIN payments p ON g.id = p.game_id
           WHERE 1=1""" + date_filter + game_status_filter + game_id_filter + pay_filter + """
           GROUP BY g.id ORDER BY g.game_date DESC"""
    params = date_params + game_id_params
    cursor = await db.execute(query, params)
    games = await cursor.fetchall()

    # Per-user payments (with filters)
    user_query = """SELECT u.id, u.name, u.first_name, u.last_name, u.phone, 
           p.game_id, g.title as game_title, g.game_date, g.sport_type, g.ground_name, g.status as game_status,
           p.amount, p.status as pay_status, p.paid_at
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
            "status": up["pay_status"],
            "paid_at": up["paid_at"],
        })
        if up["pay_status"] == "pending":
            users_map[uid]["total_pending"] += up["amount"]
        else:
            users_map[uid]["total_paid"] += up["amount"]

    users_list = sorted(users_map.values(), key=lambda x: x["total_pending"], reverse=True)

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
            "INSERT INTO payments (game_id, user_id, amount, status, paid_at) VALUES (?, ?, ?, 'paid', ?)",
            (req.game_id, req.user_id, game["cost_per_person"], now)
        )
    elif payment["status"] == "paid":
        return {"message": "Already marked as paid"}
    else:
        await db.execute(
            "UPDATE payments SET status = 'paid', paid_at = ? WHERE game_id = ? AND user_id = ?",
            (now, req.game_id, req.user_id)
        )

    # Update player payment_confirmed
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

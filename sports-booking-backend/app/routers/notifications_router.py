from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import aiosqlite

from ..database import get_db
from ..auth import get_current_user_id

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


# --- Models ---

class NotificationSettingsUpdate(BaseModel):
    voting_started: Optional[bool] = None
    game_cancelled: Optional[bool] = None
    game_completed_vote: Optional[bool] = None
    potd_announced: Optional[bool] = None
    potd_congrats_delay_hours: Optional[int] = None
    vacation_start: Optional[str] = None  # ISO date or empty string to clear
    vacation_end: Optional[str] = None


class GroundAlertPauseRequest(BaseModel):
    ground_id: int
    sport_type: str = ""  # empty = all sports on this ground
    paused: bool = True


class ModeratorAlertOverrideRequest(BaseModel):
    user_id: int
    ground_id: int
    payment_overdue_enabled: bool = True
    payment_reminder_enabled: bool = True
    nomination_payment_alert: bool = True


# --- Existing notification endpoints ---

@router.get("")
async def get_notifications(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    cursor = await db.execute(
        """SELECT n.*, g.title as game_title, g.sport_type 
           FROM notifications n LEFT JOIN games g ON n.game_id = g.id 
           WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT 50""",
        (user_id,)
    )
    notifications = await cursor.fetchall()
    return [
        {
            "id": n["id"],
            "game_id": n["game_id"],
            "game_title": n["game_title"],
            "sport_type": n["sport_type"],
            "type": n["type"],
            "message": n["message"],
            "is_read": bool(n["is_read"]),
            "created_at": n["created_at"]
        }
        for n in notifications
    ]


@router.put("/{notification_id}/read")
async def mark_read(
    notification_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await db.execute(
        "UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?",
        (notification_id, user_id)
    )
    await db.commit()
    return {"message": "Marked as read"}


@router.put("/read-all")
async def mark_all_read(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await db.execute(
        "UPDATE notifications SET is_read = 1 WHERE user_id = ?",
        (user_id,)
    )
    await db.commit()
    return {"message": "All notifications marked as read"}


# --- Notification Settings ---

@router.get("/settings")
async def get_notification_settings(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Get the current user's notification preferences."""
    cursor = await db.execute(
        "SELECT * FROM notification_settings WHERE user_id = ?", (user_id,)
    )
    row = await cursor.fetchone()
    if not row:
        # Return defaults
        return {
            "voting_started": True,
            "game_cancelled": True,
            "game_completed_vote": True,
            "potd_announced": True,
            "potd_congrats_delay_hours": 24,
            "vacation_start": None,
            "vacation_end": None,
            "is_on_vacation": False,
        }

    now = datetime.utcnow().strftime("%Y-%m-%d")
    vac_start = row["vacation_start"] or ""
    vac_end = row["vacation_end"] or ""
    is_on_vacation = bool(vac_start and vac_end and vac_start <= now <= vac_end)

    return {
        "voting_started": bool(row["voting_started"]),
        "game_cancelled": bool(row["game_cancelled"]),
        "game_completed_vote": bool(row["game_completed_vote"]),
        "potd_announced": bool(row["potd_announced"]),
        "potd_congrats_delay_hours": row["potd_congrats_delay_hours"],
        "vacation_start": vac_start or None,
        "vacation_end": vac_end or None,
        "is_on_vacation": is_on_vacation,
    }


@router.put("/settings")
async def update_notification_settings(
    req: NotificationSettingsUpdate,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Update the current user's notification preferences."""
    # Upsert: create row if not exists
    await db.execute(
        "INSERT OR IGNORE INTO notification_settings (user_id) VALUES (?)", (user_id,)
    )

    updates = []
    params = []
    if req.voting_started is not None:
        updates.append("voting_started = ?")
        params.append(int(req.voting_started))
    if req.game_cancelled is not None:
        updates.append("game_cancelled = ?")
        params.append(int(req.game_cancelled))
    if req.game_completed_vote is not None:
        updates.append("game_completed_vote = ?")
        params.append(int(req.game_completed_vote))
    if req.potd_announced is not None:
        updates.append("potd_announced = ?")
        params.append(int(req.potd_announced))
    if req.potd_congrats_delay_hours is not None:
        updates.append("potd_congrats_delay_hours = ?")
        params.append(max(1, req.potd_congrats_delay_hours))
    if req.vacation_start is not None:
        updates.append("vacation_start = ?")
        params.append(req.vacation_start if req.vacation_start else None)
    if req.vacation_end is not None:
        updates.append("vacation_end = ?")
        params.append(req.vacation_end if req.vacation_end else None)

    if updates:
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(user_id)
        await db.execute(
            f"UPDATE notification_settings SET {', '.join(updates)} WHERE user_id = ?",
            params
        )
        await db.commit()

    return {"message": "Notification settings updated"}


# --- Ground Alert Pauses (user-controlled) ---

@router.get("/ground-pauses")
async def get_ground_alert_pauses(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Get all ground/sport alert pauses for the current user."""
    cursor = await db.execute(
        """SELECT gap.id, gap.ground_id, g.name as ground_name, g.location,
                  gap.sport_type, gap.paused
           FROM ground_alert_pauses gap
           JOIN grounds g ON gap.ground_id = g.id
           WHERE gap.user_id = ?
           ORDER BY g.location, g.name, gap.sport_type""",
        (user_id,)
    )
    rows = await cursor.fetchall()
    return [
        {
            "id": r["id"],
            "ground_id": r["ground_id"],
            "ground_name": f"{r['location']} - {r['ground_name']}",
            "sport_type": r["sport_type"],
            "paused": bool(r["paused"]),
        }
        for r in rows
    ]


@router.post("/ground-pauses")
async def set_ground_alert_pause(
    req: GroundAlertPauseRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Pause or resume alerts for a specific ground/sport."""
    await db.execute(
        """INSERT INTO ground_alert_pauses (user_id, ground_id, sport_type, paused)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, ground_id, sport_type) DO UPDATE SET paused = ?""",
        (user_id, req.ground_id, req.sport_type, int(req.paused), int(req.paused))
    )
    await db.commit()
    return {"message": f"Alerts {'paused' if req.paused else 'resumed'} for ground"}


@router.delete("/ground-pauses/{pause_id}")
async def remove_ground_alert_pause(
    pause_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Remove a ground alert pause (resume all alerts for that ground/sport)."""
    await db.execute(
        "DELETE FROM ground_alert_pauses WHERE id = ? AND user_id = ?",
        (pause_id, user_id)
    )
    await db.commit()
    return {"message": "Alert pause removed"}


# --- Moderator Alert Overrides (moderator-controlled, user cannot disable) ---

@router.get("/moderator-overrides/{ground_id}")
async def get_moderator_overrides(
    ground_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Get moderator alert overrides for all users on a specific ground.
    Only moderators/admins can view this."""
    # Check if user is moderator or admin for this ground
    cursor = await db.execute("SELECT role FROM user_roles WHERE user_id = ?", (user_id,))
    roles = [r["role"] for r in await cursor.fetchall()]
    if "admin" not in roles:
        # Check moderator assignment
        cursor = await db.execute(
            """SELECT id FROM moderator_locations ml
               JOIN grounds g ON g.location = ml.location
               WHERE ml.user_id = ? AND g.id = ?""",
            (user_id, ground_id)
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=403, detail="Not authorized")

    cursor = await db.execute(
        """SELECT mao.*, u.name as user_name, u.phone as user_phone
           FROM moderator_alert_overrides mao
           JOIN users u ON mao.user_id = u.id
           WHERE mao.ground_id = ?
           ORDER BY u.name""",
        (ground_id,)
    )
    rows = await cursor.fetchall()
    return [
        {
            "id": r["id"],
            "user_id": r["user_id"],
            "user_name": r["user_name"],
            "user_phone": r["user_phone"],
            "ground_id": r["ground_id"],
            "payment_overdue_enabled": bool(r["payment_overdue_enabled"]),
            "payment_reminder_enabled": bool(r["payment_reminder_enabled"]),
            "nomination_payment_alert": bool(r["nomination_payment_alert"]),
        }
        for r in rows
    ]


@router.post("/moderator-overrides")
async def set_moderator_alert_override(
    req: ModeratorAlertOverrideRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Set alert overrides for a user on a ground. Only moderators/admins can set this.
    Users cannot disable these alerts themselves."""
    # Check moderator/admin permission
    cursor = await db.execute("SELECT role FROM user_roles WHERE user_id = ?", (user_id,))
    roles = [r["role"] for r in await cursor.fetchall()]
    if "admin" not in roles:
        cursor = await db.execute(
            """SELECT id FROM moderator_locations ml
               JOIN grounds g ON g.location = ml.location
               WHERE ml.user_id = ? AND g.id = ?""",
            (user_id, req.ground_id)
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=403, detail="Not authorized")

    await db.execute(
        """INSERT INTO moderator_alert_overrides
           (user_id, ground_id, set_by, payment_overdue_enabled, payment_reminder_enabled, nomination_payment_alert)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, ground_id) DO UPDATE SET
           set_by = ?, payment_overdue_enabled = ?, payment_reminder_enabled = ?,
           nomination_payment_alert = ?, updated_at = CURRENT_TIMESTAMP""",
        (req.user_id, req.ground_id, user_id,
         int(req.payment_overdue_enabled), int(req.payment_reminder_enabled), int(req.nomination_payment_alert),
         user_id, int(req.payment_overdue_enabled), int(req.payment_reminder_enabled), int(req.nomination_payment_alert))
    )
    await db.commit()
    return {"message": "Alert overrides updated"}


# --- Helper: Should notify user? ---

async def should_notify_user(
    db: aiosqlite.Connection,
    target_user_id: int,
    notification_type: str,
    ground_id: Optional[int] = None,
    sport_type: str = ""
) -> bool:
    """Check if a notification should be sent to a user based on their settings.
    Returns True if the notification should go through, False if suppressed.

    notification_type: 'voting_started' | 'game_cancelled' | 'game_completed_vote' | 'potd_announced'
    """
    # 1. Check vacation mode
    cursor = await db.execute(
        "SELECT * FROM notification_settings WHERE user_id = ?", (target_user_id,)
    )
    settings = await cursor.fetchone()
    if settings:
        vac_start = settings["vacation_start"] or ""
        vac_end = settings["vacation_end"] or ""
        now = datetime.utcnow().strftime("%Y-%m-%d")
        if vac_start and vac_end and vac_start <= now <= vac_end:
            return False  # On vacation, suppress all user-controllable alerts

        # 2. Check per-type toggle
        type_map = {
            "voting_started": "voting_started",
            "game_cancelled": "game_cancelled",
            "game_completed_vote": "game_completed_vote",
            "potd_announced": "potd_announced",
        }
        col = type_map.get(notification_type)
        if col and not settings[col]:
            return False  # User disabled this type

    # 3. Check ground-level pause
    if ground_id:
        cursor = await db.execute(
            """SELECT paused FROM ground_alert_pauses
               WHERE user_id = ? AND ground_id = ? AND (sport_type = ? OR sport_type = '')
               AND paused = 1""",
            (target_user_id, ground_id, sport_type)
        )
        if await cursor.fetchone():
            return False  # Paused for this ground/sport

    return True


# --- Payment Reminder tracking ---

@router.post("/payment-reminder/{game_id}/{target_user_id}")
async def track_payment_reminder(
    game_id: int,
    target_user_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Track payment reminder sent to a user. Increments reminder count.
    After 4th reminder, moderator is alerted."""
    # Upsert reminder tracking
    await db.execute(
        """INSERT INTO payment_reminders (user_id, game_id, reminder_count, last_reminded_at)
           VALUES (?, ?, 1, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, game_id) DO UPDATE SET
           reminder_count = reminder_count + 1,
           last_reminded_at = CURRENT_TIMESTAMP""",
        (target_user_id, game_id)
    )

    # Check if 4th reminder reached
    cursor = await db.execute(
        "SELECT reminder_count, moderator_alerted FROM payment_reminders WHERE user_id = ? AND game_id = ?",
        (target_user_id, game_id)
    )
    row = await cursor.fetchone()
    alert_moderator = False
    if row and row["reminder_count"] >= 4 and not row["moderator_alerted"]:
        alert_moderator = True
        await db.execute(
            "UPDATE payment_reminders SET moderator_alerted = 1 WHERE user_id = ? AND game_id = ?",
            (target_user_id, game_id)
        )
        # Create notification for moderators
        cursor2 = await db.execute("SELECT ground_name FROM games WHERE id = ?", (game_id,))
        game_row = await cursor2.fetchone()
        if game_row:
            cursor3 = await db.execute("SELECT name FROM users WHERE id = ?", (target_user_id,))
            user_row = await cursor3.fetchone()
            user_name = user_row["name"] if user_row else f"User #{target_user_id}"
            # Find moderators for this ground
            parts = (game_row["ground_name"] or "").split(" - ")
            if len(parts) == 2:
                cursor4 = await db.execute(
                    """SELECT ml.user_id FROM moderator_locations ml
                       WHERE ml.location = ?""",
                    (parts[0].strip(),)
                )
                mod_rows = await cursor4.fetchall()
                for mod in mod_rows:
                    await db.execute(
                        """INSERT INTO notifications (user_id, game_id, type, message)
                           VALUES (?, ?, 'payment_overdue_alert',
                           ?)""",
                        (mod["user_id"], game_id,
                         f"Payment overdue: {user_name} has been reminded {row['reminder_count']} times for game #{game_id}")
                    )

    await db.commit()
    return {"message": "Reminder tracked", "reminder_count": row["reminder_count"] if row else 1, "moderator_alerted": alert_moderator}


@router.get("/payment-reminders/{game_id}")
async def get_payment_reminders(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Get payment reminder status for all players in a game."""
    cursor = await db.execute(
        """SELECT pr.user_id, u.name as user_name, pr.reminder_count,
                  pr.last_reminded_at, pr.moderator_alerted
           FROM payment_reminders pr
           JOIN users u ON pr.user_id = u.id
           WHERE pr.game_id = ?
           ORDER BY pr.reminder_count DESC""",
        (game_id,)
    )
    rows = await cursor.fetchall()
    return [
        {
            "user_id": r["user_id"],
            "user_name": r["user_name"],
            "reminder_count": r["reminder_count"],
            "last_reminded_at": r["last_reminded_at"],
            "moderator_alerted": bool(r["moderator_alerted"]),
        }
        for r in rows
    ]


# --- List user's grounds for pause management ---

@router.get("/my-grounds")
async def get_my_grounds_for_notifications(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Get all grounds the user is a member of, for notification pause management."""
    cursor = await db.execute(
        """SELECT DISTINCT g.id, g.name, g.location
           FROM grounds g
           LEFT JOIN ground_members gm ON gm.ground_id = g.id AND gm.user_id = ?
           LEFT JOIN game_players gp ON gp.user_id = ?
           LEFT JOIN games ga ON ga.id = gp.game_id
           WHERE gm.id IS NOT NULL
              OR ga.ground_name = (g.location || ' - ' || g.name)
           ORDER BY g.location, g.name""",
        (user_id, user_id)
    )
    rows = await cursor.fetchall()
    results = []
    for r in rows:
        # Get sport types for this ground
        sport_cursor = await db.execute(
            "SELECT DISTINCT sport_type FROM games WHERE (ground_name = ? OR ground_name = ?) AND sport_type != ''",
            (f"{r['location']} - {r['name']}", r['name'])
        )
        sport_rows = await sport_cursor.fetchall()
        sports = [s["sport_type"] for s in sport_rows]
        results.append({
            "id": r["id"],
            "name": r["name"],
            "location": r["location"],
            "display_name": f"{r['location']} - {r['name']}",
            "sport_types": sports,
        })
    return results

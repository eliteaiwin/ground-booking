from fastapi import APIRouter, Depends
import aiosqlite

from ..database import get_db
from ..auth import get_current_user_id

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


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

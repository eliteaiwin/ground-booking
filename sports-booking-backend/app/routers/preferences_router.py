from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import aiosqlite

from ..database import get_db
from ..auth import get_current_user_id

router = APIRouter(prefix="/api/preferences", tags=["preferences"])


class UpdatePreferenceRequest(BaseModel):
    sport_type: str
    default_max_players: int


async def require_admin_or_moderator(user_id: int, db: aiosqlite.Connection):
    cursor = await db.execute(
        "SELECT role FROM user_roles WHERE user_id = ? AND role IN ('admin', 'moderator')", (user_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="Admin or Moderator access required")


@router.get("")
async def get_preferences(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    cursor = await db.execute("SELECT * FROM moderator_preferences ORDER BY sport_type")
    rows = await cursor.fetchall()
    return [{"sport_type": r["sport_type"], "default_max_players": r["default_max_players"]} for r in rows]


@router.put("")
async def update_preference(
    req: UpdatePreferenceRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin_or_moderator(user_id, db)

    await db.execute(
        "INSERT INTO moderator_preferences (sport_type, default_max_players) VALUES (?, ?) "
        "ON CONFLICT(sport_type) DO UPDATE SET default_max_players = ?",
        (req.sport_type, req.default_max_players, req.default_max_players)
    )
    await db.commit()
    return {"message": "Preference updated", "sport_type": req.sport_type, "default_max_players": req.default_max_players}


@router.get("/{sport_type}")
async def get_preference_for_sport(
    sport_type: str,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    cursor = await db.execute(
        "SELECT * FROM moderator_preferences WHERE sport_type = ?", (sport_type,)
    )
    row = await cursor.fetchone()
    if not row:
        return {"sport_type": sport_type, "default_max_players": 10}
    return {"sport_type": row["sport_type"], "default_max_players": row["default_max_players"]}

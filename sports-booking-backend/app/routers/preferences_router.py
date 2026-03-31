from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict
import aiosqlite

from ..database import get_db
from ..auth import get_current_user_id

router = APIRouter(prefix="/api/preferences", tags=["preferences"])


class UpdatePreferenceRequest(BaseModel):
    sport_type: str
    default_max_players: int


class UpdateRoleThemeRequest(BaseModel):
    role: str
    primary_color: str
    header_bg: str
    button_bg: str
    button_hover: str
    accent_color: str


async def require_admin_or_moderator(user_id: int, db: aiosqlite.Connection):
    cursor = await db.execute(
        "SELECT role FROM user_roles WHERE user_id = ? AND role IN ('admin', 'moderator')", (user_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="Admin or Moderator access required")


async def require_admin(user_id: int, db: aiosqlite.Connection):
    cursor = await db.execute(
        "SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="Admin access required")


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


@router.get("/role-themes")
async def get_role_themes(
    db: aiosqlite.Connection = Depends(get_db)
):
    """Get theme settings for all roles. Public endpoint (no auth required for login page theming)."""
    cursor = await db.execute("SELECT * FROM role_theme_settings ORDER BY role")
    rows = await cursor.fetchall()
    result: Dict[str, dict] = {}
    for r in rows:
        result[r["role"]] = {
            "primary_color": r["primary_color"],
            "header_bg": r["header_bg"],
            "button_bg": r["button_bg"],
            "button_hover": r["button_hover"],
            "accent_color": r["accent_color"],
        }
    # Fill in defaults for any missing roles
    defaults = {
        "admin": {"primary_color": "#7f1d1d", "header_bg": "#7f1d1d", "button_bg": "#7f1d1d", "button_hover": "#991b1b", "accent_color": "#7f1d1d"},
        "moderator": {"primary_color": "#1d4ed8", "header_bg": "#1d4ed8", "button_bg": "#1d4ed8", "button_hover": "#1e40af", "accent_color": "#1d4ed8"},
        "ground_management": {"primary_color": "#6b7280", "header_bg": "#6b7280", "button_bg": "#6b7280", "button_hover": "#4b5563", "accent_color": "#6b7280"},
        "user": {"primary_color": "#16a34a", "header_bg": "#16a34a", "button_bg": "#16a34a", "button_hover": "#15803d", "accent_color": "#16a34a"},
        "readonly": {"primary_color": "#16a34a", "header_bg": "#16a34a", "button_bg": "#16a34a", "button_hover": "#15803d", "accent_color": "#16a34a"},
    }
    for role, theme in defaults.items():
        if role not in result:
            result[role] = theme
    return result


@router.put("/role-themes")
async def update_role_theme(
    req: UpdateRoleThemeRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Update theme settings for a role. Admin only."""
    await require_admin(user_id, db)

    valid_roles = ["admin", "moderator", "ground_management", "user", "readonly"]
    if req.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}")

    await db.execute(
        """INSERT INTO role_theme_settings (role, primary_color, header_bg, button_bg, button_hover, accent_color, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(role) DO UPDATE SET
             primary_color = ?, header_bg = ?, button_bg = ?, button_hover = ?, accent_color = ?,
             updated_by = ?, updated_at = CURRENT_TIMESTAMP""",
        (req.role, req.primary_color, req.header_bg, req.button_bg, req.button_hover, req.accent_color, user_id,
         req.primary_color, req.header_bg, req.button_bg, req.button_hover, req.accent_color, user_id)
    )
    await db.commit()
    return {"message": f"Theme for {req.role} updated", "role": req.role}


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

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List
import aiosqlite

from ..database import get_db
from ..auth import get_current_user_id

router = APIRouter(prefix="/api/users", tags=["users"])


class UpdateRolesRequest(BaseModel):
    roles: List[str]


async def require_admin(user_id: int, db: aiosqlite.Connection):
    cursor = await db.execute("SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="Admin access required")


@router.post("/bootstrap-admin")
async def bootstrap_admin(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Make user_id=1 admin if no admin exists yet."""
    cursor = await db.execute("SELECT COUNT(*) as cnt FROM user_roles WHERE role = 'admin'")
    row = await cursor.fetchone()
    if row["cnt"] > 0:
        raise HTTPException(status_code=400, detail="Admin already exists")
    if user_id != 1:
        raise HTTPException(status_code=403, detail="Only the first registered user can bootstrap")
    await db.execute("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'admin')", (user_id,))
    await db.execute("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'moderator')", (user_id,))
    await db.commit()
    return {"message": "Admin bootstrapped successfully"}


@router.get("")
async def list_users(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)

    cursor = await db.execute(
        "SELECT id, first_name, last_name, name, phone, email, notification_preference, sports, locations, created_at FROM users ORDER BY name"
    )
    users = await cursor.fetchall()

    result = []
    for u in users:
        cursor2 = await db.execute("SELECT role FROM user_roles WHERE user_id = ?", (u["id"],))
        roles_rows = await cursor2.fetchall()
        roles = [r["role"] for r in roles_rows]
        first_name = u["first_name"] or ""
        last_name = u["last_name"] or ""
        display_name = u["name"] or f"{first_name} {last_name}".strip()
        sports = [s for s in (u["sports"] or "").split(",") if s]
        locations = [loc for loc in (u["locations"] or "").split(",") if loc]
        result.append({
            "id": u["id"],
            "first_name": first_name,
            "last_name": last_name,
            "name": display_name,
            "phone": u["phone"],
            "email": u["email"],
            "notification_preference": u["notification_preference"],
            "sports": sports,
            "locations": locations,
            "roles": roles,
            "created_at": u["created_at"]
        })

    return result


@router.put("/{target_user_id}/roles")
async def update_user_roles(
    target_user_id: int,
    req: UpdateRolesRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)

    # Validate roles
    valid_roles = {"admin", "ground_management", "moderator", "user", "readonly"}
    for role in req.roles:
        if role not in valid_roles:
            raise HTTPException(status_code=400, detail=f"Invalid role: {role}")

    # Check target user exists
    cursor = await db.execute("SELECT id FROM users WHERE id = ?", (target_user_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="User not found")

    # Guard: prevent removing the last admin
    if 'admin' not in req.roles:
        cursor = await db.execute(
            "SELECT COUNT(*) as cnt FROM user_roles WHERE role = 'admin' AND user_id != ?",
            (target_user_id,)
        )
        remaining = await cursor.fetchone()
        if remaining["cnt"] == 0:
            raise HTTPException(status_code=400, detail="Cannot remove the last admin role")

    # Replace roles
    await db.execute("DELETE FROM user_roles WHERE user_id = ?", (target_user_id,))
    for role in req.roles:
        await db.execute("INSERT INTO user_roles (user_id, role) VALUES (?, ?)", (target_user_id, role))
    await db.commit()

    return {"message": "Roles updated", "roles": req.roles}

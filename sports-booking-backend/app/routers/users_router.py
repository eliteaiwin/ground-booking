from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import List, Optional
import aiosqlite
import json as json_lib

from ..database import get_db
from ..auth import get_current_user_id, hash_password
from ..routers.auth_router import generate_user_code, _assign_roles

router = APIRouter(prefix="/api/users", tags=["users"])

# Super-admin emails that can never have admin removed
SUPER_ADMIN_EMAILS = {"tittlejoseph@gmail.com", "elitedevlit@gmail.com"}


class UpdateRolesRequest(BaseModel):
    roles: List[str]


class AdminUpdateUserRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notification_preference: Optional[str] = None
    sports: Optional[List[str]] = None
    locations: Optional[List[str]] = None
    sport_positions: Optional[dict] = None
    currency: Optional[str] = None


class ResetPasswordRequest(BaseModel):
    new_password: str
    force_change: bool = False


class AssignGroundRoleRequest(BaseModel):
    ground_id: int
    role: str
    sport_type: str = ""


class DisableUserRequest(BaseModel):
    reason: str = ""


class BulkImportUserItem(BaseModel):
    first_name: str
    last_name: str = ""
    phone: str


class BulkImportRequest(BaseModel):
    users: List[BulkImportUserItem]
    default_password: str
    notification_preference: str = "whatsapp"


async def require_admin(user_id: int, db: aiosqlite.Connection):
    cursor = await db.execute("SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="Admin access required")


async def is_super_admin(user_id: int, db: aiosqlite.Connection) -> bool:
    cursor = await db.execute("SELECT email FROM users WHERE id = ?", (user_id,))
    row = await cursor.fetchone()
    if row and row["email"] and row["email"].lower() in SUPER_ADMIN_EMAILS:
        return True
    return False


@router.post("/bootstrap-admin")
async def bootstrap_admin(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
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
    search: Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    ground_id: Optional[int] = Query(None),
    role: Optional[str] = Query(None),
    sport: Optional[str] = Query(None),
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)

    query = "SELECT id, user_code, first_name, last_name, name, phone, email, notification_preference, sports, locations, sport_positions, profile_pic, is_disabled, disabled_reason, created_at FROM users WHERE 1=1"
    params: list = []

    if search:
        esc = search.replace("%", r"\%").replace("_", r"\_")
        query += r" AND (name LIKE ? ESCAPE '\' OR phone LIKE ? ESCAPE '\' OR email LIKE ? ESCAPE '\' OR first_name LIKE ? ESCAPE '\' OR last_name LIKE ? ESCAPE '\')"
        like_val = "%" + esc + "%"
        params.extend([like_val, like_val, like_val, like_val, like_val])

    if location:
        esc_loc = location.replace("%", r"\%").replace("_", r"\_")
        query += r" AND locations LIKE ? ESCAPE '\'"
        params.append("%" + esc_loc + "%")

    if sport:
        esc_sport = sport.replace("%", r"\%").replace("_", r"\_")
        query += r" AND sports LIKE ? ESCAPE '\'"
        params.append("%" + esc_sport + "%")

    query += " ORDER BY name"
    cursor = await db.execute(query, params)
    users = await cursor.fetchall()

    ground_user_ids: set = set()
    ground_info = None
    if ground_id:
        gcursor = await db.execute("SELECT * FROM grounds WHERE id = ?", (ground_id,))
        ground_info = await gcursor.fetchone()
        if ground_info:
            mcursor = await db.execute("SELECT user_id FROM ground_members WHERE ground_id = ?", (ground_id,))
            for row in await mcursor.fetchall():
                ground_user_ids.add(row["user_id"])
            mod_cursor = await db.execute(
                "SELECT user_id FROM moderator_locations WHERE location = ? AND (ground_name = ? OR ground_name = '')",
                (ground_info["location"], ground_info["name"])
            )
            for row in await mod_cursor.fetchall():
                ground_user_ids.add(row["user_id"])
            gm_cursor = await db.execute(
                "SELECT user_id FROM ground_management_assignments WHERE ground_id = ?", (ground_id,)
            )
            for row in await gm_cursor.fetchall():
                ground_user_ids.add(row["user_id"])
            disp = ground_info["location"] + " - " + ground_info["name"]
            player_cursor = await db.execute(
                "SELECT DISTINCT gp.user_id FROM game_players gp JOIN games g ON gp.game_id = g.id WHERE g.ground_name = ? OR g.ground_name = ?",
                (disp, ground_info["name"])
            )
            for row in await player_cursor.fetchall():
                ground_user_ids.add(row["user_id"])

    result = []
    for u in users:
        uid = u["id"]
        if ground_id and uid not in ground_user_ids:
            continue

        cursor2 = await db.execute("SELECT role FROM user_roles WHERE user_id = ?", (uid,))
        roles_rows = await cursor2.fetchall()
        roles = [r["role"] for r in roles_rows]

        if role and role not in roles:
            continue

        first_name = u["first_name"] or ""
        last_name = u["last_name"] or ""
        display_name = u["name"] or (first_name + " " + last_name).strip()
        sports_list = [s for s in (u["sports"] or "").split(",") if s]
        locations_list = [loc for loc in (u["locations"] or "").split(",") if loc]

        sport_positions = {}
        try:
            sp_raw = u["sport_positions"] or ""
            if sp_raw:
                sport_positions = json_lib.loads(sp_raw)
        except Exception:
            pass

        user_code = u["user_code"] or "" if "user_code" in u.keys() else ""
        profile_pic = u["profile_pic"] or "" if "profile_pic" in u.keys() else ""
        email_lower = (u["email"] or "").lower()
        is_super = email_lower in SUPER_ADMIN_EMAILS

        mod_assignments = []
        mod_cursor = await db.execute(
            "SELECT ml.id, ml.location, ml.ground_name, ml.sport_type, g.id as ground_id "
            "FROM moderator_locations ml LEFT JOIN grounds g ON g.location = ml.location AND g.name = ml.ground_name "
            "WHERE ml.user_id = ?",
            (uid,)
        )
        for row in await mod_cursor.fetchall():
            mod_assignments.append({
                "id": row["id"], "location": row["location"],
                "ground_name": row["ground_name"], "ground_id": row["ground_id"],
                "sport_type": row["sport_type"] or "",
            })

        gm_assignments = []
        gm_cursor = await db.execute(
            "SELECT gma.id, gma.ground_id, g.name as ground_name, g.location "
            "FROM ground_management_assignments gma JOIN grounds g ON gma.ground_id = g.id "
            "WHERE gma.user_id = ?",
            (uid,)
        )
        for row in await gm_cursor.fetchall():
            gm_assignments.append({
                "id": row["id"], "ground_id": row["ground_id"],
                "ground_name": row["ground_name"], "location": row["location"],
            })

        is_disabled = False
        disabled_reason = ""
        try:
            is_disabled = bool(u["is_disabled"])
            disabled_reason = u["disabled_reason"] or ""
        except Exception:
            pass

        result.append({
            "id": uid, "user_code": user_code,
            "first_name": first_name, "last_name": last_name,
            "name": display_name, "phone": u["phone"],
            "email": u["email"],
            "notification_preference": u["notification_preference"],
            "sports": sports_list, "locations": locations_list,
            "sport_positions": sport_positions,
            "profile_pic": profile_pic,
            "roles": roles, "is_super_admin": is_super,
            "is_disabled": is_disabled, "disabled_reason": disabled_reason,
            "moderator_assignments": mod_assignments,
            "ground_management_assignments": gm_assignments,
            "created_at": u["created_at"]
        })

    return result


@router.post("/bulk-import")
async def bulk_import_users(
    req: BulkImportRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Admin bulk-imports users from a WhatsApp group (or any list) with a default password.

    New users are forced to change their password on first login and can add an email
    in their profile afterwards.
    """
    await require_admin(user_id, db)

    if len(req.default_password) < 6:
        raise HTTPException(status_code=400, detail="Default password must be at least 6 characters")

    if len(req.users) > 500:
        raise HTTPException(status_code=400, detail="Cannot import more than 500 users at once")

    password_hash = hash_password(req.default_password)
    sports_str = ""
    locations_str = ""
    positions_str = json_lib.dumps({})
    results = []
    created = 0
    skipped = 0

    for item in req.users:
        phone = item.phone.strip()
        if not phone:
            results.append({"phone": phone, "status": "skipped", "reason": "Empty phone number"})
            skipped += 1
            continue

        # Skip duplicates within this batch or already in DB
        cursor = await db.execute("SELECT id FROM users WHERE phone = ?", (phone,))
        if await cursor.fetchone():
            results.append({"phone": phone, "status": "skipped", "reason": "Phone number already registered"})
            skipped += 1
            continue

        first = item.first_name.strip()
        last = (item.last_name or "").strip()
        full_name = f"{first} {last}".strip() or first
        user_code = await generate_user_code(db)

        cursor = await db.execute(
            """INSERT INTO users (user_code, first_name, last_name, name, phone, email,
               password_hash, notification_preference, sports, locations, sport_positions,
               force_password_change)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (user_code, first, last, full_name, phone, None,
             password_hash, req.notification_preference, sports_str, locations_str,
             positions_str, 1)
        )
        new_user_id = cursor.lastrowid
        await _assign_roles(db, new_user_id)

        results.append({"phone": phone, "name": full_name, "status": "created", "user_id": new_user_id})
        created += 1

    await db.commit()
    return {"created": created, "skipped": skipped, "results": results}


@router.put("/{target_user_id}/roles")
async def update_user_roles(
    target_user_id: int,
    req: UpdateRolesRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)

    valid_roles = {"admin", "ground_management", "moderator", "user", "readonly"}
    for r in req.roles:
        if r not in valid_roles:
            raise HTTPException(status_code=400, detail="Invalid role: " + r)

    cursor = await db.execute("SELECT id, email FROM users WHERE id = ?", (target_user_id,))
    target = await cursor.fetchone()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Super-admin protection
    target_email = (target["email"] or "").lower()
    if target_email in SUPER_ADMIN_EMAILS and "admin" not in req.roles:
        raise HTTPException(status_code=403, detail="Cannot remove admin permission from this protected account")

    if "admin" not in req.roles:
        cursor = await db.execute(
            "SELECT COUNT(*) as cnt FROM user_roles WHERE role = 'admin' AND user_id != ?",
            (target_user_id,)
        )
        remaining = await cursor.fetchone()
        if remaining["cnt"] == 0:
            raise HTTPException(status_code=400, detail="Cannot remove the last admin role")

    await db.execute("DELETE FROM user_roles WHERE user_id = ?", (target_user_id,))
    for r in req.roles:
        await db.execute("INSERT INTO user_roles (user_id, role) VALUES (?, ?)", (target_user_id, r))
    await db.commit()

    return {"message": "Roles updated", "roles": req.roles}


@router.put("/{target_user_id}")
async def admin_update_user(
    target_user_id: int,
    req: AdminUpdateUserRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)
    cursor = await db.execute("SELECT id FROM users WHERE id = ?", (target_user_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="User not found")

    updates: list = []
    params: list = []

    if req.first_name is not None:
        updates.append("first_name = ?")
        params.append(req.first_name)
    if req.last_name is not None:
        updates.append("last_name = ?")
        params.append(req.last_name)
    if req.first_name is not None or req.last_name is not None:
        cursor = await db.execute("SELECT first_name, last_name FROM users WHERE id = ?", (target_user_id,))
        current = await cursor.fetchone()
        fn = req.first_name if req.first_name is not None else (current["first_name"] or "")
        ln = req.last_name if req.last_name is not None else (current["last_name"] or "")
        updates.append("name = ?")
        params.append((fn + " " + ln).strip())
    if req.email is not None:
        cursor = await db.execute("SELECT id FROM users WHERE email = ? AND id != ?", (req.email, target_user_id))
        if await cursor.fetchone():
            raise HTTPException(status_code=400, detail="Email already in use")
        updates.append("email = ?")
        params.append(req.email)
    if req.phone is not None:
        cursor = await db.execute("SELECT id FROM users WHERE phone = ? AND id != ?", (req.phone, target_user_id))
        if await cursor.fetchone():
            raise HTTPException(status_code=400, detail="Phone number already in use")
        updates.append("phone = ?")
        params.append(req.phone)
    if req.notification_preference is not None:
        updates.append("notification_preference = ?")
        params.append(req.notification_preference)
    if req.sports is not None:
        updates.append("sports = ?")
        params.append(",".join(req.sports))
    if req.locations is not None:
        updates.append("locations = ?")
        params.append(",".join(req.locations))
    if req.sport_positions is not None:
        updates.append("sport_positions = ?")
        params.append(json_lib.dumps(req.sport_positions))
    if req.currency is not None:
        updates.append("currency = ?")
        params.append(req.currency)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    params.append(target_user_id)
    await db.execute("UPDATE users SET " + ", ".join(updates) + " WHERE id = ?", params)
    await db.commit()
    return {"message": "User updated"}


@router.post("/{target_user_id}/reset-password")
async def reset_password(
    target_user_id: int,
    req: ResetPasswordRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)
    cursor = await db.execute("SELECT id FROM users WHERE id = ?", (target_user_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="User not found")

    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    pw_hash = hash_password(req.new_password)
    await db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (pw_hash, target_user_id))

    flag = 1 if req.force_change else 0
    await db.execute("UPDATE users SET force_password_change = ? WHERE id = ?", (flag, target_user_id))

    await db.commit()
    return {"message": "Password reset successfully", "force_change": req.force_change}


@router.post("/{target_user_id}/ground-role")
async def assign_ground_role(
    target_user_id: int,
    req: AssignGroundRoleRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)
    cursor = await db.execute("SELECT id FROM users WHERE id = ?", (target_user_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="User not found")

    cursor = await db.execute("SELECT * FROM grounds WHERE id = ?", (req.ground_id,))
    ground = await cursor.fetchone()
    if not ground:
        raise HTTPException(status_code=404, detail="Ground not found")

    if req.role == "moderator":
        await db.execute(
            "INSERT OR IGNORE INTO moderator_locations (user_id, location, ground_name, sport_type) VALUES (?, ?, ?, ?)",
            (target_user_id, ground["location"], ground["name"], req.sport_type)
        )
        await db.execute(
            "INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'moderator')",
            (target_user_id,)
        )
        await db.commit()
        return {"message": "User assigned as Moderator for " + ground["location"] + " - " + ground["name"]}

    elif req.role == "ground_management":
        await db.execute(
            "INSERT OR IGNORE INTO ground_management_assignments (user_id, ground_id, assigned_by) VALUES (?, ?, ?)",
            (target_user_id, req.ground_id, user_id)
        )
        await db.execute(
            "INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'ground_management')",
            (target_user_id,)
        )
        await db.commit()
        return {"message": "User assigned as Ground Manager for " + ground["location"] + " - " + ground["name"]}

    else:
        raise HTTPException(status_code=400, detail="Invalid role. Use 'moderator' or 'ground_management'")


@router.delete("/{target_user_id}/ground-role/{assignment_type}/{assignment_id}")
async def remove_ground_role(
    target_user_id: int,
    assignment_type: str,
    assignment_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)

    if assignment_type == "moderator":
        await db.execute("DELETE FROM moderator_locations WHERE id = ? AND user_id = ?", (assignment_id, target_user_id))
        cursor = await db.execute("SELECT COUNT(*) as cnt FROM moderator_locations WHERE user_id = ?", (target_user_id,))
        row = await cursor.fetchone()
        if row["cnt"] == 0:
            await db.execute("DELETE FROM user_roles WHERE user_id = ? AND role = 'moderator'", (target_user_id,))
        await db.commit()
        return {"message": "Moderator assignment removed"}
    elif assignment_type == "ground_management":
        await db.execute("DELETE FROM ground_management_assignments WHERE id = ? AND user_id = ?", (assignment_id, target_user_id))
        cursor = await db.execute("SELECT COUNT(*) as cnt FROM ground_management_assignments WHERE user_id = ?", (target_user_id,))
        row = await cursor.fetchone()
        if row["cnt"] == 0:
            await db.execute("DELETE FROM user_roles WHERE user_id = ? AND role = 'ground_management'", (target_user_id,))
        await db.commit()
        return {"message": "Ground Management assignment removed"}
    else:
        raise HTTPException(status_code=400, detail="Invalid assignment type")


@router.post("/{target_user_id}/disable")
async def disable_user(
    target_user_id: int,
    req: DisableUserRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Admin disables a user on the platform."""
    await require_admin(user_id, db)

    cursor = await db.execute("SELECT id, email FROM users WHERE id = ?", (target_user_id,))
    target = await cursor.fetchone()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Cannot disable super-admins
    target_email = (target["email"] or "").lower()
    if target_email in SUPER_ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Cannot disable a protected super-admin account")

    # Cannot disable yourself
    if target_user_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot disable your own account")

    await db.execute(
        "UPDATE users SET is_disabled = 1, disabled_reason = ?, disabled_at = CURRENT_TIMESTAMP, disabled_by = ? WHERE id = ?",
        (req.reason, user_id, target_user_id)
    )
    await db.commit()
    return {"message": "User disabled", "user_id": target_user_id}


@router.post("/{target_user_id}/enable")
async def enable_user(
    target_user_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Admin re-enables a disabled user."""
    await require_admin(user_id, db)

    cursor = await db.execute("SELECT id FROM users WHERE id = ?", (target_user_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="User not found")

    await db.execute(
        "UPDATE users SET is_disabled = 0, disabled_reason = '', disabled_at = NULL, disabled_by = NULL WHERE id = ?",
        (target_user_id,)
    )
    await db.commit()
    return {"message": "User enabled", "user_id": target_user_id}

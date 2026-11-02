from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import aiosqlite
import json as json_lib
import os
import sqlite3
import tarfile
import tempfile
from datetime import datetime

from ..database import get_db, get_app_setting, set_app_setting, DATABASE_PATH
from ..auth import get_current_user_id, hash_password
from ..routers.auth_router import generate_user_code, _assign_roles, UPLOAD_DIR
from .games_router import payment_fee_settings
from ..phone_utils import split_phone
from ..user_merge import merge_duplicate_phone_users, delete_unplayed_user, _has_played

router = APIRouter(prefix="/api/users", tags=["users"])

# Super admins: the only accounts that can grant or remove Admin; they can never lose it or be disabled
SUPER_ADMIN_EMAILS = {"tittlejoseph@gmail.com", "eliteaiwin@gmail.com", "elitedevlit@gmail.com"}
SUPER_ADMIN_PHONES = {"9811536174", "8951575798", "9990009999"}


def is_super_identity(email: Optional[str], phone: Optional[str]) -> bool:
    return (email or "").lower() in SUPER_ADMIN_EMAILS or (phone or "") in SUPER_ADMIN_PHONES


async def ensure_super_admin_roles(db: aiosqlite.Connection):
    db.row_factory = aiosqlite.Row
    for u in await (await db.execute("SELECT id, email, phone FROM users")).fetchall():
        if is_super_identity(u["email"], u["phone"]):
            await db.execute("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'admin')", (u["id"],))
    await db.commit()


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


class QuickAddUserRequest(BaseModel):
    nick_name: str
    phone: str
    country_code: Optional[str] = None
    ground_id: Optional[int] = None


class BulkImportRequest(BaseModel):
    users: List[BulkImportUserItem]
    default_password: str
    notification_preference: str = "whatsapp"


class AppSettingsRequest(BaseModel):
    payments_enabled: Optional[bool] = None
    payment_surcharge_percent: Optional[float] = None
    payment_dev_share_percent: Optional[float] = None
    payment_gst_percent: Optional[float] = None
    payment_app_fee_gst_percent: Optional[float] = None
    enabled_sports: Optional[List[str]] = None
    player_name_display: Optional[str] = None


async def require_admin(user_id: int, db: aiosqlite.Connection):
    cursor = await db.execute("SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="Admin access required")


async def is_super_admin(user_id: int, db: aiosqlite.Connection) -> bool:
    cursor = await db.execute("SELECT email, phone FROM users WHERE id = ?", (user_id,))
    row = await cursor.fetchone()
    return bool(row and is_super_identity(row["email"], row["phone"]))


async def admin_ground_scope(user_id: int, db: aiosqlite.Connection) -> Optional[set]:
    """None for full Admins; otherwise the ground ids this Ground Admin manages (403 if none)."""
    if await (await db.execute("SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,))).fetchone():
        return None
    rows = await (await db.execute("SELECT ground_id FROM ground_admin_assignments WHERE user_id = ?", (user_id,))).fetchall()
    if not rows:
        raise HTTPException(status_code=403, detail="Admin access required")
    return {r["ground_id"] for r in rows}


async def _ground_user_ids(db: aiosqlite.Connection, ground_id: int) -> set:
    ids: set = set()
    g = await (await db.execute("SELECT * FROM grounds WHERE id = ?", (ground_id,))).fetchone()
    if not g:
        return ids
    for sql, params in (
        ("SELECT user_id FROM ground_members WHERE ground_id = ?", (ground_id,)),
        ("SELECT user_id FROM moderator_locations WHERE location = ? AND (ground_name = ? OR ground_name = '')", (g["location"], g["name"])),
        ("SELECT user_id FROM ground_management_assignments WHERE ground_id = ?", (ground_id,)),
        ("SELECT user_id FROM ground_admin_assignments WHERE ground_id = ?", (ground_id,)),
        ("SELECT DISTINCT gp.user_id FROM game_players gp JOIN games ga ON gp.game_id = ga.id WHERE ga.ground_name = ? OR ga.ground_name = ?",
         (g["location"] + " - " + g["name"], g["name"])),
    ):
        ids.update(r["user_id"] for r in await (await db.execute(sql, params)).fetchall())
    return ids


@router.get("/my-admin-grounds")
async def my_admin_grounds(user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    scope = await admin_ground_scope(user_id, db)
    return {"all": scope is None, "ground_ids": sorted(scope or [])}


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
    scope = await admin_ground_scope(user_id, db)
    if scope is not None and ground_id and ground_id not in scope:
        raise HTTPException(status_code=403, detail="Not an admin of this ground")

    query = "SELECT id, user_code, first_name, last_name, name, display_name, always_prepay, phone, email, notification_preference, sports, locations, sport_positions, profile_pic, is_disabled, disabled_reason, created_at FROM users WHERE 1=1"
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
    if ground_id:
        ground_user_ids = await _ground_user_ids(db, ground_id)
    elif scope is not None:
        for gid in scope:
            ground_user_ids |= await _ground_user_ids(db, gid)
        ground_id = -1

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
        is_super = is_super_identity(email_lower, u["phone"])

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

        played_row = await (await db.execute(
            "SELECT COUNT(DISTINCT gp.game_id) AS n FROM game_players gp JOIN games ga ON ga.id = gp.game_id "
            "WHERE gp.user_id = ? AND gp.status = 'selected' AND ga.status = 'completed'", (uid,))).fetchone()
        can_delete = not is_super and uid != user_id and not await _has_played(db, uid)

        ga_assignments = [dict(r) for r in await (await db.execute(
            "SELECT gaa.id, gaa.ground_id, g.name as ground_name, g.location "
            "FROM ground_admin_assignments gaa JOIN grounds g ON gaa.ground_id = g.id WHERE gaa.user_id = ?", (uid,)
        )).fetchall()]

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
            "display_name": u["display_name"] or "",
            "always_prepay": bool(u["always_prepay"]),
            "email": u["email"],
            "notification_preference": u["notification_preference"],
            "sports": sports_list, "locations": locations_list,
            "sport_positions": sport_positions,
            "profile_pic": profile_pic,
            "roles": roles, "is_super_admin": is_super,
            "is_disabled": is_disabled, "disabled_reason": disabled_reason,
            "moderator_assignments": mod_assignments,
            "ground_management_assignments": gm_assignments,
            "ground_admin_assignments": ga_assignments,
            "games_played": played_row["n"] if played_row else 0,
            "can_delete": can_delete,
            "created_at": u["created_at"]
        })

    return result


@router.post("/quick-add")
async def quick_add_user(
    req: QuickAddUserRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Admin / Ground Admin adds a player with just a nick name and mobile number (they sign in by OTP)."""
    scope = await admin_ground_scope(user_id, db)
    nick = req.nick_name.strip()
    cc, phone = split_phone(req.phone, req.country_code)
    if not nick:
        raise HTTPException(status_code=400, detail="Nick Name is required")
    if not phone.isdigit() or len(phone) < 6:
        raise HTTPException(status_code=400, detail="Enter a valid mobile number")
    ground_id = req.ground_id
    if scope is not None:
        if ground_id is None and len(scope) == 1:
            ground_id = next(iter(scope))
        if ground_id not in scope:
            raise HTTPException(status_code=403, detail="Choose one of your grounds")
    existing = await (await db.execute(
        "SELECT id, name, display_name FROM users WHERE phone = ?", (phone,))).fetchone()
    if existing:
        if ground_id:
            if not await (await db.execute("SELECT 1 FROM ground_members WHERE ground_id = ? AND user_id = ?",
                                           (ground_id, existing["id"]))).fetchone():
                await db.execute("INSERT INTO ground_members (user_id, ground_id, added_by) VALUES (?, ?, ?)",
                                 (existing["id"], ground_id, user_id))
                await db.commit()
        return {"user_id": existing["id"], "status": "exists",
                "message": f"Already registered as {existing['display_name'] or existing['name']}"}
    user_code = await generate_user_code(db)
    cursor = await db.execute(
        "INSERT INTO users (user_code, first_name, last_name, name, display_name, phone, country_code, "
        "sports, locations, sport_positions) VALUES (?, ?, '', ?, ?, ?, ?, '', '', '{}')",
        (user_code, nick, nick, nick, phone, cc))
    new_id = cursor.lastrowid
    await _assign_roles(db, new_id)
    if ground_id:
        await db.execute("INSERT INTO ground_members (user_id, ground_id, added_by) VALUES (?, ?, ?)",
                         (new_id, ground_id, user_id))
    await db.commit()
    return {"user_id": new_id, "status": "created", "message": f"{nick} added"}


@router.delete("/{target_user_id}")
async def delete_user(
    target_user_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Admin / Ground Admin deletes a user who has never played a game."""
    scope = await admin_ground_scope(user_id, db)
    target = await (await db.execute("SELECT id, email, phone FROM users WHERE id = ?", (target_user_id,))).fetchone()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if is_super_identity(target["email"], target["phone"]) or target_user_id == user_id:
        raise HTTPException(status_code=403, detail="This account can't be deleted")
    if scope is not None:
        allowed: set = set()
        for gid in scope:
            allowed |= await _ground_user_ids(db, gid)
        if target_user_id not in allowed:
            raise HTTPException(status_code=403, detail="Not a user of your grounds")
    if await _has_played(db, target_user_id):
        raise HTTPException(status_code=400, detail="Only users who have never played a game can be deleted")
    await delete_unplayed_user(db, target_user_id, user_id)
    return {"message": "User deleted"}


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
        phone = split_phone(item.phone)[1] if item.phone.strip() else ""
        if not phone:
            results.append({"phone": phone, "status": "skipped", "reason": "Empty phone number"})
            skipped += 1
            continue

        # Skip duplicates within this batch or already in DB
        cursor = await db.execute("SELECT id, first_name, last_name FROM users WHERE phone = ?", (phone,))
        existing = await cursor.fetchone()
        if existing:
            if not (existing["first_name"] or "").strip() and item.first_name.strip():
                await db.execute("UPDATE users SET first_name = ?, last_name = ?, name = ? WHERE id = ?",
                                 (item.first_name.strip(), (item.last_name or "").strip(),
                                  f"{item.first_name.strip()} {(item.last_name or '').strip()}".strip(), existing["id"]))
            results.append({"phone": phone, "status": "skipped", "reason": "Already registered (details merged)"})
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
    await merge_duplicate_phone_users(db)
    return {"created": created, "skipped": skipped, "results": results}


@router.put("/{target_user_id}/roles")
async def update_user_roles(
    target_user_id: int,
    req: UpdateRolesRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)

    valid_roles = {"admin", "ground_admin", "ground_management", "moderator", "payment_receiver", "user", "readonly"}
    for r in req.roles:
        if r not in valid_roles:
            raise HTTPException(status_code=400, detail="Invalid role: " + r)

    cursor = await db.execute("SELECT id, email, phone FROM users WHERE id = ?", (target_user_id,))
    target = await cursor.fetchone()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if is_super_identity(target["email"], target["phone"]) and "admin" not in req.roles:
        raise HTTPException(status_code=403, detail="Cannot remove admin permission from a Super Admin")
    had_admin = bool(await (await db.execute(
        "SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'admin'", (target_user_id,))).fetchone())
    if had_admin != ("admin" in req.roles) and not await is_super_admin(user_id, db):
        raise HTTPException(status_code=403, detail="Only a Super Admin can grant or remove Admin")
    has_ga = bool(await (await db.execute(
        "SELECT 1 FROM ground_admin_assignments WHERE user_id = ?", (target_user_id,))).fetchone())
    req.roles = [r for r in req.roles if r != "ground_admin"] + (["ground_admin"] if has_ga else [])

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


@router.get("/app-settings")
async def get_app_settings(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Get app-wide settings. Public keys are readable by any logged-in user."""
    payments_enabled = (await get_app_setting(db, 'payments_enabled', 'false')).lower() == 'true'
    fees = await payment_fee_settings(db)
    gateway = float(await get_app_setting(db, 'payment_gateway_percent', '2'))
    enabled_sports_raw = await get_app_setting(db, 'enabled_sports', 'soccer')
    enabled_sports = [s.strip() for s in enabled_sports_raw.split(',') if s.strip()]
    player_name_display = await get_app_setting(db, 'player_name_display', 'first_phone_masked')
    return {
        "payments_enabled": payments_enabled,
        "payment_surcharge_percent": fees["surcharge_percent"],
        "payment_gateway_percent": gateway,
        "payment_dev_share_percent": fees["commission_percent"],
        "payment_gst_percent": fees["gst_percent"],
        "payment_app_fee_gst_percent": fees["app_fee_gst_percent"],
        "enabled_sports": enabled_sports,
        "player_name_display": player_name_display,
    }


@router.put("/app-settings")
async def update_app_settings(
    req: AppSettingsRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Admin only: update app-wide settings."""
    await require_admin(user_id, db)
    if req.payments_enabled is not None:
        await set_app_setting(db, 'payments_enabled', 'true' if req.payments_enabled else 'false')
    if req.payment_surcharge_percent is not None:
        await set_app_setting(db, 'payment_surcharge_percent', str(req.payment_surcharge_percent))
    if req.payment_dev_share_percent is not None:
        if not 0 <= req.payment_dev_share_percent < 100:
            raise HTTPException(status_code=400, detail="Commission must be between 0 and 100")
        await set_app_setting(db, 'payment_dev_share_percent', str(req.payment_dev_share_percent))
    if req.payment_gst_percent is not None:
        if not 0 <= req.payment_gst_percent <= 100:
            raise HTTPException(status_code=400, detail="GST must be between 0 and 100")
        await set_app_setting(db, 'payment_gst_percent', str(req.payment_gst_percent))
    if req.payment_app_fee_gst_percent is not None:
        if not 0 <= req.payment_app_fee_gst_percent <= 100:
            raise HTTPException(status_code=400, detail="GST must be between 0 and 100")
        await set_app_setting(db, 'payment_app_fee_gst_percent', str(req.payment_app_fee_gst_percent))
    if req.enabled_sports is not None:
        await set_app_setting(db, 'enabled_sports', ','.join(req.enabled_sports))
    if req.player_name_display is not None:
        await set_app_setting(db, 'player_name_display', req.player_name_display)
    return await get_app_settings(user_id, db)


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
    scope = await admin_ground_scope(user_id, db)
    if scope is not None and (req.role == "ground_admin" or req.ground_id not in scope):
        raise HTTPException(status_code=403, detail="Ground Admins can only assign Moderators and Ground Managers for their own grounds")
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

    elif req.role == "ground_admin":
        await db.execute(
            "INSERT OR IGNORE INTO ground_admin_assignments (user_id, ground_id, assigned_by) VALUES (?, ?, ?)",
            (target_user_id, req.ground_id, user_id)
        )
        await db.execute("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'ground_admin')", (target_user_id,))
        await db.commit()
        return {"message": "User assigned as Ground Admin for " + ground["location"] + " - " + ground["name"]}

    else:
        raise HTTPException(status_code=400, detail="Invalid role. Use 'moderator', 'ground_management' or 'ground_admin'")


@router.delete("/{target_user_id}/ground-role/{assignment_type}/{assignment_id}")
async def remove_ground_role(
    target_user_id: int,
    assignment_type: str,
    assignment_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    scope = await admin_ground_scope(user_id, db)
    if scope is not None:
        if assignment_type == "moderator":
            row = await (await db.execute(
                "SELECT g.id FROM moderator_locations ml JOIN grounds g ON g.location = ml.location AND g.name = ml.ground_name "
                "WHERE ml.id = ? AND ml.user_id = ?", (assignment_id, target_user_id))).fetchone()
        elif assignment_type == "ground_management":
            row = await (await db.execute(
                "SELECT ground_id AS id FROM ground_management_assignments WHERE id = ? AND user_id = ?",
                (assignment_id, target_user_id))).fetchone()
        else:
            row = None
        if not row or row["id"] not in scope:
            raise HTTPException(status_code=403, detail="Not an admin of this ground")

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
    elif assignment_type == "ground_admin":
        await db.execute("DELETE FROM ground_admin_assignments WHERE id = ? AND user_id = ?", (assignment_id, target_user_id))
        row = await (await db.execute("SELECT COUNT(*) as cnt FROM ground_admin_assignments WHERE user_id = ?", (target_user_id,))).fetchone()
        if row["cnt"] == 0:
            await db.execute("DELETE FROM user_roles WHERE user_id = ? AND role = 'ground_admin'", (target_user_id,))
        await db.commit()
        return {"message": "Ground Admin assignment removed"}
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

    cursor = await db.execute("SELECT id, email, phone FROM users WHERE id = ?", (target_user_id,))
    target = await cursor.fetchone()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Cannot disable super-admins
    if is_super_identity(target["email"], target["phone"]):
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


@router.get("/admin/backup")
async def download_backup(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Admin-only: download a tar.gz containing a consistent SQLite snapshot and uploaded files."""
    await require_admin(user_id, db)
    tmpdir = tempfile.mkdtemp(prefix="backup-")
    snapshot = os.path.join(tmpdir, "app.db")
    src = sqlite3.connect(DATABASE_PATH)
    try:
        dst = sqlite3.connect(snapshot)
        src.backup(dst)
        dst.close()
    finally:
        src.close()
    stamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    archive = os.path.join(tmpdir, f"backup-{stamp}.tar.gz")
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(snapshot, arcname="app.db")
        if UPLOAD_DIR.is_dir():
            tar.add(str(UPLOAD_DIR), arcname="uploads")
    return FileResponse(archive, media_type="application/gzip", filename=os.path.basename(archive))

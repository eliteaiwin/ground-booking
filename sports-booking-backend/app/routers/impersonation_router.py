"""Impersonation: act as another user (e.g. to nominate a friend) without their OTP.

Super Admins may impersonate anyone, Admins anyone on their grounds (full Admins: anyone),
everyone else only the people an Admin or Moderator granted them. Nobody may impersonate a higher role.
"""
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..auth import create_access_token, get_current_user_id
from ..database import get_db
from ..request_context import impersonator_id
from .users_router import is_super_admin, _ground_user_ids

router = APIRouter(prefix="/api/impersonation", tags=["impersonation"])

ROLE_LABELS = {5: "Super Admin", 4: "Admin", 3: "Ground Admin", 2: "Moderator", 1: "User"}


async def role_rank(db: aiosqlite.Connection, uid: int) -> int:
    if await is_super_admin(uid, db):
        return 5
    roles = {r["role"] for r in await (await db.execute("SELECT role FROM user_roles WHERE user_id = ?", (uid,))).fetchall()}
    if "admin" in roles:
        return 4
    if "ground_admin" in roles:
        return 3
    if roles & {"moderator", "ground_management"}:
        return 2
    return 1


def _real_user(user_id: int) -> int:
    """The person really using the app (the impersonator when acting as someone else)."""
    return impersonator_id.get() or user_id


async def _scope(db: aiosqlite.Connection, actor: int) -> Optional[set]:
    """None = may impersonate anyone (rank permitting); otherwise the allowed user ids."""
    rank = await role_rank(db, actor)
    if rank >= 4:
        return None
    allowed = {r["target_user_id"] for r in await (await db.execute(
        "SELECT target_user_id FROM impersonation_grants WHERE user_id = ?", (actor,))).fetchall()}
    if rank == 3:
        for r in await (await db.execute("SELECT ground_id FROM ground_admin_assignments WHERE user_id = ?", (actor,))).fetchall():
            allowed |= await _ground_user_ids(db, r["ground_id"])
    return allowed


async def can_impersonate(db: aiosqlite.Connection, actor: int, target: int) -> bool:
    if actor == target:
        return False
    scope = await _scope(db, actor)
    if scope is not None and target not in scope:
        return False
    return await role_rank(db, actor) >= await role_rank(db, target)


async def _user_brief(db: aiosqlite.Connection, uid: int) -> Optional[dict]:
    u = await (await db.execute("SELECT id, name, phone FROM users WHERE id = ? AND deleted_at IS NULL", (uid,))).fetchone()
    if not u:
        return None
    return {"id": u["id"], "name": u["name"], "phone": u["phone"], "role": ROLE_LABELS[await role_rank(db, uid)]}


@router.get("/whoami")
async def whoami(user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    imp = impersonator_id.get()
    return {"user": await _user_brief(db, user_id), "impersonator": await _user_brief(db, imp) if imp else None}


@router.get("/targets")
async def list_targets(search: str = Query(""), user_id: int = Depends(get_current_user_id),
                       db: aiosqlite.Connection = Depends(get_db)):
    actor = _real_user(user_id)
    scope = await _scope(db, actor)
    q = "SELECT id FROM users WHERE deleted_at IS NULL AND id != ?"
    params: list = [actor]
    if search.strip():
        like = f"%{search.strip()}%"
        q += " AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)"
        params += [like, like, like]
    elif scope is None:
        return []
    q += " ORDER BY name LIMIT 200"
    out = []
    for r in await (await db.execute(q, params)).fetchall():
        if scope is not None and r["id"] not in scope:
            continue
        if await can_impersonate(db, actor, r["id"]):
            out.append(await _user_brief(db, r["id"]))
        if len(out) >= 30:
            break
    return out


class StartRequest(BaseModel):
    target_user_id: int


@router.post("/start")
async def start(req: StartRequest, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    actor = _real_user(user_id)
    if not await can_impersonate(db, actor, req.target_user_id):
        raise HTTPException(status_code=403, detail="You are not allowed to impersonate this user")
    cur = await db.execute("INSERT INTO impersonation_sessions (impersonator_id, target_user_id) VALUES (?, ?)",
                           (actor, req.target_user_id))
    await db.commit()
    token = create_access_token(req.target_user_id, impersonator=actor, session_id=cur.lastrowid, hours=24 * 365)
    return {"token": token, "user": await _user_brief(db, req.target_user_id)}


@router.get("/sessions")
async def my_sessions(user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    """People currently impersonating me."""
    me = _real_user(user_id)
    rows = await (await db.execute(
        """SELECT s.id, s.created_at, u.id AS uid, u.name, u.phone FROM impersonation_sessions s
           JOIN users u ON u.id = s.impersonator_id
           WHERE s.target_user_id = ? AND s.revoked_at IS NULL ORDER BY s.created_at DESC""", (me,))).fetchall()
    return [{"id": r["id"], "since": r["created_at"], "user": {"id": r["uid"], "name": r["name"], "phone": r["phone"]}} for r in rows]


@router.post("/sessions/{session_id}/revoke")
async def revoke(session_id: int, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    me = _real_user(user_id)
    s = await (await db.execute("SELECT * FROM impersonation_sessions WHERE id = ?", (session_id,))).fetchone()
    if not s or me not in (s["target_user_id"], s["impersonator_id"]):
        raise HTTPException(status_code=404, detail="Not found")
    await db.execute("UPDATE impersonation_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?", (session_id,))
    await db.commit()
    return {"status": "logged_off"}


async def _require_granter(db: aiosqlite.Connection, actor: int):
    if await role_rank(db, actor) < 2:
        raise HTTPException(status_code=403, detail="Only an Admin or Moderator can change who someone may impersonate")


@router.get("/grants/{target_user_id}")
async def list_grants(target_user_id: int, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    await _require_granter(db, _real_user(user_id))
    rows = await (await db.execute(
        "SELECT target_user_id FROM impersonation_grants WHERE user_id = ? ORDER BY id", (target_user_id,))).fetchall()
    return [b for b in [await _user_brief(db, r["target_user_id"]) for r in rows] if b]


class GrantRequest(BaseModel):
    target_user_id: int


@router.post("/grants/{grantee_id}")
async def add_grant(grantee_id: int, req: GrantRequest, user_id: int = Depends(get_current_user_id),
                    db: aiosqlite.Connection = Depends(get_db)):
    actor = _real_user(user_id)
    await _require_granter(db, actor)
    if grantee_id == req.target_user_id:
        raise HTTPException(status_code=400, detail="Pick someone else")
    if await role_rank(db, req.target_user_id) > await role_rank(db, grantee_id):
        raise HTTPException(status_code=400, detail="They can't impersonate someone with a higher role")
    await db.execute("INSERT OR IGNORE INTO impersonation_grants (user_id, target_user_id, granted_by) VALUES (?, ?, ?)",
                     (grantee_id, req.target_user_id, actor))
    await db.commit()
    return await list_grants(grantee_id, user_id, db)


@router.delete("/grants/{grantee_id}/{target_user_id}")
async def remove_grant(grantee_id: int, target_user_id: int, user_id: int = Depends(get_current_user_id),
                       db: aiosqlite.Connection = Depends(get_db)):
    await _require_granter(db, _real_user(user_id))
    await db.execute("DELETE FROM impersonation_grants WHERE user_id = ? AND target_user_id = ?", (grantee_id, target_user_id))
    await db.execute("UPDATE impersonation_sessions SET revoked_at = CURRENT_TIMESTAMP "
                     "WHERE impersonator_id = ? AND target_user_id = ? AND revoked_at IS NULL", (grantee_id, target_user_id))
    await db.commit()
    return await list_grants(grantee_id, user_id, db)

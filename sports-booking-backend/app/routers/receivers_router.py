import re
from typing import List, Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import get_current_user_id
from ..database import get_db

router = APIRouter(prefix="/api/receivers", tags=["receivers"])

KINDS = ("upi", "paytm", "phonepe", "gpay")
UPI_RE = re.compile(r"^[a-z0-9._-]{2,256}@[a-z][a-z0-9]{1,63}$")


class Method(BaseModel):
    kind: str
    value: str


class ReceiverRequest(BaseModel):
    nick_name: str
    methods: List[Method]
    ground_ids: List[int] = []


async def _roles(db: aiosqlite.Connection, uid: int) -> set:
    rows = await (await db.execute("SELECT role FROM user_roles WHERE user_id = ?", (uid,))).fetchall()
    return {r["role"] for r in rows}


async def _managed_grounds(db: aiosqlite.Connection, uid: int) -> set:
    rows = await (await db.execute(
        "SELECT ground_id FROM ground_management_assignments WHERE user_id = ?", (uid,)
    )).fetchall()
    return {r["ground_id"] for r in rows}


async def _require_manager(db: aiosqlite.Connection, uid: int) -> bool:
    roles = await _roles(db, uid)
    if "admin" in roles:
        return True
    if "ground_management" in roles:
        return False
    raise HTTPException(status_code=403, detail="Admin or Ground Management access required")


async def ground_id_for_name(db: aiosqlite.Connection, ground_name: Optional[str]) -> Optional[int]:
    name = (ground_name or "").strip()
    parts = name.split(" - ", 1)
    row = None
    if len(parts) == 2:
        row = await (await db.execute(
            "SELECT id FROM grounds WHERE location = ? AND name = ?", (parts[0].strip(), parts[1].strip())
        )).fetchone()
    if row is None and name:
        row = await (await db.execute("SELECT id FROM grounds WHERE name = ?", (name,))).fetchone()
    return row["id"] if row else None


def _clean_methods(methods: List[Method]) -> list:
    out, seen = [], set()
    for m in methods:
        kind = (m.kind or "").strip().lower()
        if kind not in KINDS:
            raise HTTPException(status_code=400, detail=f"Unknown payment way: {m.kind}")
        value = (m.value or "").strip()
        if not value:
            continue
        if kind == "upi":
            value = value.lower().replace(" ", "")
            if not UPI_RE.match(value):
                raise HTTPException(status_code=400, detail=f"'{value}' is not a valid UPI ID (e.g. 9811536174@axisb)")
        else:
            digits = re.sub(r"\D", "", value)
            if len(digits) == 12 and digits.startswith("91"):
                digits = digits[2:]
            elif len(digits) == 11 and digits.startswith("0"):
                digits = digits[1:]
            if len(digits) != 10:
                raise HTTPException(status_code=400, detail=f"'{value}' is not a valid 10-digit mobile number")
            value = digits
        if (kind, value) not in seen:
            seen.add((kind, value))
            out.append((kind, value))
    if not out:
        raise HTTPException(status_code=400, detail="Add at least one UPI ID or Paytm / PhonePe / Google Pay number")
    return out


async def _methods(db: aiosqlite.Connection, rid: int) -> list:
    rows = await (await db.execute(
        "SELECT kind, value FROM payment_receiver_methods WHERE receiver_id = ? ORDER BY sort_order, id", (rid,)
    )).fetchall()
    return [{"kind": r["kind"], "value": r["value"]} for r in rows]


async def _load(db: aiosqlite.Connection, row) -> dict:
    grounds = await (await db.execute(
        """SELECT g.id, g.name, g.location FROM payment_receiver_grounds rg JOIN grounds g ON g.id = rg.ground_id
           WHERE rg.receiver_id = ? ORDER BY g.location, g.name""", (row["id"],)
    )).fetchall()
    return {
        "id": row["id"],
        "nick_name": row["nick_name"],
        "methods": await _methods(db, row["id"]),
        "grounds": [{"id": g["id"], "display_name": f"{g['location']} - {g['name']}"} for g in grounds],
        "created_by": row["created_by"],
    }


async def public_receiver(db: aiosqlite.Connection, rid: Optional[int]) -> Optional[dict]:
    """What players see on a game: the nick name and the ways to pay, never the person behind it."""
    if not rid:
        return None
    row = await (await db.execute("SELECT id, nick_name FROM payment_receivers WHERE id = ?", (rid,))).fetchone()
    if not row:
        return None
    return {"id": row["id"], "nick_name": row["nick_name"], "methods": await _methods(db, rid)}


async def check_receiver(db: aiosqlite.Connection, rid: Optional[int], ground_name: Optional[str]) -> Optional[int]:
    """None/0 means no receiver; otherwise it must be tagged to the game's ground."""
    if not rid:
        return None
    gid = await ground_id_for_name(db, ground_name)
    ok = gid and await (await db.execute(
        """SELECT 1 FROM payment_receivers r JOIN payment_receiver_grounds rg ON rg.receiver_id = r.id
           WHERE r.id = ? AND rg.ground_id = ? AND r.deleted_at IS NULL""", (rid, gid)
    )).fetchone()
    if not ok:
        raise HTTPException(status_code=400, detail="This payment receiver isn't tagged to the game's ground")
    return rid


async def _get_row(db: aiosqlite.Connection, rid: int):
    row = await (await db.execute(
        "SELECT * FROM payment_receivers WHERE id = ? AND deleted_at IS NULL", (rid,)
    )).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Payment receiver not found")
    return row


async def _tags(db: aiosqlite.Connection, rid: int) -> set:
    rows = await (await db.execute("SELECT ground_id FROM payment_receiver_grounds WHERE receiver_id = ?", (rid,))).fetchall()
    return {r["ground_id"] for r in rows}


async def _check_can_edit(db: aiosqlite.Connection, uid: int, row) -> tuple[bool, set]:
    is_admin = await _require_manager(db, uid)
    managed = set() if is_admin else await _managed_grounds(db, uid)
    if not is_admin and row["created_by"] != uid and not (await _tags(db, row["id"]) & managed):
        raise HTTPException(status_code=403, detail="You can only change receivers for grounds you manage")
    return is_admin, managed


async def _valid_grounds(db: aiosqlite.Connection, ids: List[int], is_admin: bool, managed: set) -> set:
    wanted = set(ids)
    if not is_admin and wanted - managed:
        raise HTTPException(status_code=403, detail="You can only tag grounds you manage")
    if wanted:
        rows = await (await db.execute(
            f"SELECT id FROM grounds WHERE id IN ({','.join('?' * len(wanted))})", tuple(wanted)
        )).fetchall()
        if len(rows) != len(wanted):
            raise HTTPException(status_code=400, detail="Unknown ground")
    return wanted


async def _save(db: aiosqlite.Connection, rid: int, nick: str, methods: list, grounds: set) -> None:
    await db.execute("UPDATE payment_receivers SET nick_name = ? WHERE id = ?", (nick, rid))
    await db.execute("DELETE FROM payment_receiver_methods WHERE receiver_id = ?", (rid,))
    for i, (kind, value) in enumerate(methods):
        await db.execute(
            "INSERT INTO payment_receiver_methods (receiver_id, kind, value, sort_order) VALUES (?, ?, ?, ?)",
            (rid, kind, value, i),
        )
    await db.execute("DELETE FROM payment_receiver_grounds WHERE receiver_id = ?", (rid,))
    for gid in grounds:
        await db.execute("INSERT INTO payment_receiver_grounds (receiver_id, ground_id) VALUES (?, ?)", (rid, gid))


def _nick(req: ReceiverRequest) -> str:
    nick = (req.nick_name or "").strip()
    if not nick or len(nick) > 40:
        raise HTTPException(status_code=400, detail="Nick name is required (up to 40 characters)")
    return nick


@router.get("")
async def list_receivers(user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    is_admin = await _require_manager(db, user_id)
    if is_admin:
        rows = await (await db.execute(
            "SELECT * FROM payment_receivers WHERE deleted_at IS NULL ORDER BY nick_name COLLATE NOCASE"
        )).fetchall()
    else:
        managed = await _managed_grounds(db, user_id)
        rows = await (await db.execute(
            f"""SELECT DISTINCT r.* FROM payment_receivers r
                LEFT JOIN payment_receiver_grounds rg ON rg.receiver_id = r.id
                WHERE r.deleted_at IS NULL AND (r.created_by = ? OR rg.ground_id IN ({','.join('?' * len(managed)) or 'NULL'}))
                ORDER BY r.nick_name COLLATE NOCASE""", (user_id, *managed)
        )).fetchall()
    return [await _load(db, r) for r in rows]


@router.get("/for-ground")
async def receivers_for_ground(ground_name: str, user_id: int = Depends(get_current_user_id),
                               db: aiosqlite.Connection = Depends(get_db)):
    if not await _roles(db, user_id) & {"admin", "ground_management", "moderator"}:
        raise HTTPException(status_code=403, detail="Moderator access required")
    gid = await ground_id_for_name(db, ground_name)
    if not gid:
        return []
    rows = await (await db.execute(
        """SELECT r.id, r.nick_name FROM payment_receivers r JOIN payment_receiver_grounds rg ON rg.receiver_id = r.id
           WHERE rg.ground_id = ? AND r.deleted_at IS NULL ORDER BY r.nick_name COLLATE NOCASE""", (gid,)
    )).fetchall()
    return [{"id": r["id"], "nick_name": r["nick_name"]} for r in rows]


@router.post("")
async def create_receiver(req: ReceiverRequest, user_id: int = Depends(get_current_user_id),
                          db: aiosqlite.Connection = Depends(get_db)):
    is_admin = await _require_manager(db, user_id)
    managed = set() if is_admin else await _managed_grounds(db, user_id)
    nick, methods = _nick(req), _clean_methods(req.methods)
    grounds = await _valid_grounds(db, req.ground_ids, is_admin, managed)
    cur = await db.execute("INSERT INTO payment_receivers (nick_name, created_by) VALUES (?, ?)", (nick, user_id))
    await _save(db, cur.lastrowid, nick, methods, grounds)
    await db.commit()
    return await _load(db, await _get_row(db, cur.lastrowid))


@router.put("/{rid}")
async def update_receiver(rid: int, req: ReceiverRequest, user_id: int = Depends(get_current_user_id),
                          db: aiosqlite.Connection = Depends(get_db)):
    row = await _get_row(db, rid)
    is_admin, managed = await _check_can_edit(db, user_id, row)
    nick, methods = _nick(req), _clean_methods(req.methods)
    if is_admin:
        grounds = await _valid_grounds(db, req.ground_ids, True, set())
    else:
        # Ground managers only change tags on their own grounds; other grounds' tags stay as they are.
        grounds = (await _tags(db, rid) - managed) | await _valid_grounds(db, [g for g in req.ground_ids if g in managed], False, managed)
    await _save(db, rid, nick, methods, grounds)
    await db.commit()
    return await _load(db, await _get_row(db, rid))


@router.delete("/{rid}")
async def delete_receiver(rid: int, user_id: int = Depends(get_current_user_id),
                          db: aiosqlite.Connection = Depends(get_db)):
    row = await _get_row(db, rid)
    await _check_can_edit(db, user_id, row)
    await db.execute("UPDATE payment_receivers SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?", (rid,))
    await db.execute("UPDATE games SET receiver_id = NULL WHERE receiver_id = ? AND status NOT IN ('completed', 'cancelled')", (rid,))
    await db.commit()
    return {"message": "Payment receiver removed"}

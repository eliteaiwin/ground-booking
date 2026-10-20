import uuid
from datetime import datetime, timedelta
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import get_current_user_id
from ..database import get_db
from ..pitches import (
    describe, find_layout, layouts_payload, load_occupancy, parse_dt, pitch_label, pitch_units,
    sport_layouts, unit_count, user_group_ids,
)

router = APIRouter(prefix="/api/allotments", tags=["allotments"])


class GroupRequest(BaseModel):
    name: str


class GroupMemberRequest(BaseModel):
    user_id: int


class AllotmentRequest(BaseModel):
    sport_type: str
    pitch_format: str = ""
    pitch_number: int = 0
    allot_date: str
    start_time: str
    duration_minutes: int = 60
    moderator_user_id: Optional[int] = None
    moderator_group_id: Optional[int] = None
    rent: float = 0
    notes: str = ""
    repeat_weeks: int = 1


class AllotmentUpdate(BaseModel):
    rent: Optional[float] = None
    rent_paid: Optional[bool] = None
    notes: Optional[str] = None


async def _ground(db: aiosqlite.Connection, ground_id: int) -> aiosqlite.Row:
    row = await (await db.execute("SELECT * FROM grounds WHERE id = ?", (ground_id,))).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Ground not found")
    return row


async def _is_admin(db: aiosqlite.Connection, user_id: int) -> bool:
    return await (await db.execute(
        "SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,)
    )).fetchone() is not None


async def _can_manage(db: aiosqlite.Connection, user_id: int, ground_id: int) -> bool:
    if await _is_admin(db, user_id):
        return True
    return await (await db.execute(
        "SELECT 1 FROM ground_management_assignments WHERE user_id = ? AND ground_id = ?", (user_id, ground_id)
    )).fetchone() is not None


async def _require_manager(db: aiosqlite.Connection, user_id: int, ground_id: int):
    if not await _can_manage(db, user_id, ground_id):
        raise HTTPException(status_code=403, detail="Only this ground's Ground Managers can do this")


async def _require_viewer(db: aiosqlite.Connection, user_id: int, ground: aiosqlite.Row):
    if await _can_manage(db, user_id, ground["id"]):
        return
    mod = await (await db.execute(
        "SELECT 1 FROM moderator_locations WHERE user_id = ? AND location = ? AND (ground_name = ? OR ground_name = '')",
        (user_id, ground["location"], ground["name"])
    )).fetchone()
    if not mod:
        raise HTTPException(status_code=403, detail="Only Ground Managers and moderators of this ground can see this")


async def _group(db: aiosqlite.Connection, group_id: int) -> aiosqlite.Row:
    row = await (await db.execute("SELECT * FROM moderator_groups WHERE id = ?", (group_id,))).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Moderator group not found")
    return row


def _display_name(ground: aiosqlite.Row) -> str:
    return f"{ground['location']} - {ground['name']}"


# --- Moderator groups ---

@router.get("/grounds/{ground_id}/groups")
async def list_groups(ground_id: int, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    ground = await _ground(db, ground_id)
    await _require_viewer(db, user_id, ground)
    groups = await (await db.execute(
        "SELECT id, name FROM moderator_groups WHERE ground_id = ? ORDER BY name COLLATE NOCASE", (ground_id,)
    )).fetchall()
    result = []
    for g in groups:
        members = await (await db.execute(
            """SELECT u.id, u.name, u.phone FROM moderator_group_members m JOIN users u ON u.id = m.user_id
               WHERE m.group_id = ? ORDER BY u.name COLLATE NOCASE""", (g["id"],)
        )).fetchall()
        result.append({
            "id": g["id"],
            "name": g["name"],
            "members": [{"user_id": m["id"], "name": m["name"], "phone": m["phone"]} for m in members],
        })
    return result


@router.post("/grounds/{ground_id}/groups")
async def create_group(ground_id: int, req: GroupRequest, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    await _ground(db, ground_id)
    await _require_manager(db, user_id, ground_id)
    name = req.name.strip()[:60]
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required")
    try:
        cursor = await db.execute(
            "INSERT INTO moderator_groups (ground_id, name, created_by) VALUES (?, ?, ?)", (ground_id, name, user_id)
        )
    except aiosqlite.IntegrityError:
        raise HTTPException(status_code=409, detail=f"A group named '{name}' already exists at this ground")
    await db.commit()
    return {"id": cursor.lastrowid, "name": name, "members": []}


@router.delete("/groups/{group_id}")
async def delete_group(group_id: int, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    group = await _group(db, group_id)
    await _require_manager(db, user_id, group["ground_id"])
    upcoming = await (await db.execute(
        "SELECT COUNT(*) AS cnt FROM ground_allotments WHERE moderator_group_id = ? AND status = 'confirmed' AND allot_date >= ?",
        (group_id, datetime.now().strftime("%Y-%m-%d"))
    )).fetchone()
    if upcoming["cnt"]:
        raise HTTPException(status_code=400, detail=f"This group still has {upcoming['cnt']} upcoming allotment(s). Remove them first.")
    await db.execute("UPDATE games SET moderator_group_id = NULL WHERE moderator_group_id = ?", (group_id,))
    await db.execute("DELETE FROM moderator_group_members WHERE group_id = ?", (group_id,))
    await db.execute("DELETE FROM moderator_groups WHERE id = ?", (group_id,))
    await db.commit()
    return {"message": "Group deleted"}


@router.post("/groups/{group_id}/members")
async def add_group_member(group_id: int, req: GroupMemberRequest, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    group = await _group(db, group_id)
    await _require_manager(db, user_id, group["ground_id"])
    member = await (await db.execute(
        "SELECT id FROM users WHERE id = ? AND deleted_at IS NULL", (req.user_id,)
    )).fetchone()
    if not member:
        raise HTTPException(status_code=404, detail="User not found")
    await db.execute(
        "INSERT OR IGNORE INTO moderator_group_members (group_id, user_id, added_by) VALUES (?, ?, ?)",
        (group_id, req.user_id, user_id)
    )
    await db.commit()
    return {"message": "Member added"}


@router.delete("/groups/{group_id}/members/{member_id}")
async def remove_group_member(group_id: int, member_id: int, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    group = await _group(db, group_id)
    await _require_manager(db, user_id, group["ground_id"])
    await db.execute("DELETE FROM moderator_group_members WHERE group_id = ? AND user_id = ?", (group_id, member_id))
    await db.commit()
    return {"message": "Member removed"}


# --- Occupancy & allotments ---

def _item_payload(item: dict, day_start: datetime) -> dict:
    start_min = max(0, int((item["start"] - day_start).total_seconds() // 60))
    end_min = min(1440, int((item["end"] - day_start).total_seconds() // 60))
    payload = {
        "kind": item["kind"],
        "id": item["id"],
        "title": item["title"],
        "start": item["start"].strftime("%Y-%m-%d %H:%M"),
        "end": item["end"].strftime("%Y-%m-%d %H:%M"),
        "start_minute": start_min,
        "end_minute": end_min,
        "units": sorted(item["units"]),
        "pitch_label": item["pitch_label"],
        "holder": item["holder"],
    }
    if item["kind"] == "allotment":
        payload.update({
            "rent": item["rent"],
            "rent_paid": item["rent_paid"],
            "series_key": item["series_key"],
            "moderator_user_id": item["moderator_user_id"],
            "moderator_group_id": item["moderator_group_id"],
        })
    else:
        payload.update({"allotment_id": item["allotment_id"], "status": item["status"]})
    return payload


@router.get("/grounds/{ground_id}/occupancy")
async def ground_occupancy(
    ground_id: int,
    date: str,
    sport: str,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    ground = await _ground(db, ground_id)
    await _require_viewer(db, user_id, ground)
    try:
        day_start = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    layouts = sport_layouts(ground, sport)
    items = await load_occupancy(db, ground, _display_name(ground), sport, day_start, day_start + timedelta(days=1))
    return {
        "date": date,
        "sport": sport,
        "can_manage": await _can_manage(db, user_id, ground_id),
        **layouts_payload(layouts),
        "items": [_item_payload(i, day_start) for i in sorted(items, key=lambda i: i["start"])],
    }


@router.post("/grounds/{ground_id}/allotments")
async def create_allotment(
    ground_id: int,
    req: AllotmentRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    ground = await _ground(db, ground_id)
    await _require_manager(db, user_id, ground_id)

    sport = req.sport_type.strip().lower()
    ground_sports = [x for x in (ground["sports"] or "").split(",") if x]
    if ground_sports and sport not in ground_sports:
        raise HTTPException(status_code=400, detail=f"This ground does not offer {req.sport_type}")
    if (req.moderator_user_id is None) == (req.moderator_group_id is None):
        raise HTTPException(status_code=400, detail="Allot to either one moderator or one moderator group")
    members: set[int] = set()
    if req.moderator_group_id is not None:
        group = await _group(db, req.moderator_group_id)
        if group["ground_id"] != ground_id:
            raise HTTPException(status_code=400, detail="That moderator group belongs to another ground")
        rows = await (await db.execute(
            "SELECT user_id FROM moderator_group_members WHERE group_id = ?", (req.moderator_group_id,)
        )).fetchall()
        members = {r["user_id"] for r in rows}
    else:
        target = await (await db.execute(
            "SELECT id FROM users WHERE id = ? AND deleted_at IS NULL", (req.moderator_user_id,)
        )).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="Moderator not found")
        members = {req.moderator_user_id}

    layouts = sport_layouts(ground, sport)
    fmt, number = req.pitch_format.strip(), req.pitch_number
    if fmt:
        layout = find_layout(layouts, fmt)
        if not layout:
            raise HTTPException(status_code=400, detail=f"'{fmt}' is not a pitch layout of this ground for {req.sport_type}")
        fmt, count = layout["format"], int(layout["count"])
        if count == 1:
            number = 0
        elif not 1 <= number <= count:
            raise HTTPException(status_code=400, detail=f"Pick which {fmt} pitch (A-{chr(64 + count)})")
    else:
        number = 0
    units = pitch_units(layouts, fmt, number) if fmt else frozenset(range(unit_count(layouts)))
    label = pitch_label(fmt, number, int(find_layout(layouts, fmt)["count"]) if fmt else 0)

    if not 15 <= req.duration_minutes <= 1440:
        raise HTTPException(status_code=400, detail="Duration must be between 15 minutes and 24 hours")
    weeks = max(1, min(req.repeat_weeks, 26))
    try:
        first_start = parse_dt(req.allot_date, req.start_time)
    except ValueError:
        raise HTTPException(status_code=400, detail="Use YYYY-MM-DD for the date and HH:MM for the time")
    series_key = uuid.uuid4().hex if weeks > 1 else ""

    created, skipped = [], []
    for w in range(weeks):
        start = first_start + timedelta(weeks=w)
        end = start + timedelta(minutes=req.duration_minutes)
        items = await load_occupancy(db, ground, _display_name(ground), sport, start, end)
        adopt, blockers = [], []
        for item in items:
            if not item["units"] & units:
                continue
            fits = item["units"] <= units and item["start"] >= start and item["end"] <= end
            if item["kind"] == "game" and fits and item["created_by"] in members and not item["allotment_id"]:
                adopt.append(item["id"])
            else:
                blockers.append(item)
        date_str = start.strftime("%Y-%m-%d")
        if blockers:
            skipped.append({"date": date_str, "reason": f"{label} is not free — {describe(blockers[0])}"})
            continue
        cursor = await db.execute(
            """INSERT INTO ground_allotments (ground_id, sport_type, pitch_format, pitch_number, allot_date, start_time,
               duration_minutes, moderator_user_id, moderator_group_id, rent, notes, series_key, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (ground_id, sport, fmt, number, date_str, start.strftime("%H:%M"), req.duration_minutes,
             req.moderator_user_id, req.moderator_group_id, max(req.rent, 0), req.notes.strip()[:300], series_key, user_id)
        )
        for game_id in adopt:
            await db.execute(
                "UPDATE games SET allotment_id = ?, moderator_group_id = ? WHERE id = ?",
                (cursor.lastrowid, req.moderator_group_id, game_id)
            )
        created.append({"id": cursor.lastrowid, "date": date_str, "linked_games": adopt})
    await db.commit()
    return {"created": created, "skipped": skipped, "pitch_label": label}


async def _allotment(db: aiosqlite.Connection, allotment_id: int) -> aiosqlite.Row:
    row = await (await db.execute("SELECT * FROM ground_allotments WHERE id = ?", (allotment_id,))).fetchone()
    if not row or row["status"] != "confirmed":
        raise HTTPException(status_code=404, detail="Allotment not found")
    return row


@router.patch("/{allotment_id}")
async def update_allotment(allotment_id: int, req: AllotmentUpdate, user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    row = await _allotment(db, allotment_id)
    await _require_manager(db, user_id, row["ground_id"])
    updates, params = [], []
    if req.rent is not None:
        updates.append("rent = ?")
        params.append(max(req.rent, 0))
    if req.rent_paid is not None:
        updates.append("rent_paid = ?")
        params.append(1 if req.rent_paid else 0)
    if req.notes is not None:
        updates.append("notes = ?")
        params.append(req.notes.strip()[:300])
    if updates:
        await db.execute(f"UPDATE ground_allotments SET {', '.join(updates)} WHERE id = ?", (*params, allotment_id))
        await db.commit()
    return {"message": "Allotment updated"}


@router.delete("/{allotment_id}")
async def cancel_allotment(
    allotment_id: int,
    series: bool = False,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db),
):
    row = await _allotment(db, allotment_id)
    await _require_manager(db, user_id, row["ground_id"])
    ids = [allotment_id]
    if series and row["series_key"]:
        rows = await (await db.execute(
            "SELECT id FROM ground_allotments WHERE series_key = ? AND status = 'confirmed' AND allot_date >= ?",
            (row["series_key"], row["allot_date"])
        )).fetchall()
        ids = [r["id"] for r in rows]
    marks = ",".join("?" * len(ids))
    await db.execute(f"UPDATE ground_allotments SET status = 'cancelled' WHERE id IN ({marks})", ids)
    await db.execute(f"UPDATE games SET allotment_id = NULL, moderator_group_id = NULL WHERE allotment_id IN ({marks})", ids)
    await db.commit()
    return {"cancelled": len(ids)}


@router.get("/mine")
async def my_allotments(user_id: int = Depends(get_current_user_id), db: aiosqlite.Connection = Depends(get_db)):
    groups = await user_group_ids(db, user_id)
    marks = ",".join("?" * len(groups)) or "NULL"
    rows = await (await db.execute(
        f"""SELECT a.*, g.location, g.name AS ground_name, g.sport_details, mg.name AS group_name
            FROM ground_allotments a
            JOIN grounds g ON g.id = a.ground_id
            LEFT JOIN moderator_groups mg ON mg.id = a.moderator_group_id
            WHERE a.status = 'confirmed' AND a.allot_date >= ?
              AND (a.moderator_user_id = ? OR a.moderator_group_id IN ({marks}))
            ORDER BY a.allot_date, a.start_time LIMIT 200""",
        (datetime.now().strftime("%Y-%m-%d"), user_id, *groups)
    )).fetchall()
    result = []
    for r in rows:
        layout = find_layout(sport_layouts(r, r["sport_type"]), r["pitch_format"])
        end = parse_dt(r["allot_date"], r["start_time"]) + timedelta(minutes=r["duration_minutes"])
        result.append({
            "id": r["id"],
            "ground_id": r["ground_id"],
            "ground_name": f"{r['location']} - {r['ground_name']}",
            "sport_type": r["sport_type"],
            "pitch_format": r["pitch_format"],
            "pitch_number": r["pitch_number"],
            "pitch_label": pitch_label(r["pitch_format"], r["pitch_number"], int(layout["count"]) if layout else 0),
            "allot_date": r["allot_date"],
            "start_time": r["start_time"],
            "end_time": end.strftime("%H:%M"),
            "duration_minutes": r["duration_minutes"],
            "group_name": r["group_name"] or "",
            "rent": r["rent"],
            "rent_paid": bool(r["rent_paid"]),
            "notes": r["notes"],
        })
    return result

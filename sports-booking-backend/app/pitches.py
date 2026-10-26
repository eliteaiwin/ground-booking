import json
from datetime import datetime, timedelta
from math import lcm
from typing import Optional

import aiosqlite
from fastapi import HTTPException


def parse_dt(date: str, time: str) -> datetime:
    return datetime.strptime(f"{date} {time}", "%Y-%m-%d %H:%M")


def sport_layouts(ground: Optional[aiosqlite.Row], sport: str) -> list[dict]:
    if not ground:
        return []
    try:
        details = json.loads(ground["sport_details"] or "{}")
    except ValueError:
        return []
    entry = details.get((sport or "").lower()) if isinstance(details, dict) else None
    pitches = entry.get("pitches", []) if isinstance(entry, dict) else []
    return [p for p in pitches if isinstance(p, dict) and p.get("format") and int(p.get("count") or 0) > 0]


def find_layout(layouts: list[dict], fmt: str) -> Optional[dict]:
    key = (fmt or "").strip().lower()
    return next((p for p in layouts if p["format"].lower() == key), None) if key else None


def unit_count(layouts: list[dict]) -> int:
    return lcm(*[int(p["count"]) for p in layouts]) if layouts else 1


def pitch_units(layouts: list[dict], fmt: str, number: int) -> frozenset[int]:
    """Units of the ground strip covered by a pitch. Pitches of a format sit side by side, A leftmost."""
    total = unit_count(layouts)
    layout = find_layout(layouts, fmt)
    if not layout:
        return frozenset(range(total))
    count = int(layout["count"])
    width = total // count
    index = min(max(number, 1), count) - 1
    return frozenset(range(index * width, (index + 1) * width))


def pitch_letter(number: int) -> str:
    return chr(64 + number) if 1 <= number <= 26 else str(number)


def pitch_label(fmt: str, number: int, count: int = 0) -> str:
    if not fmt:
        return "Whole ground"
    if not number or count == 1:
        return fmt
    return f"{fmt} {pitch_letter(number)}"


def layouts_payload(layouts: list[dict]) -> dict:
    total = unit_count(layouts)
    return {
        "units": total,
        "layouts": [
            {
                "format": p["format"],
                "count": int(p["count"]),
                "pitches": [
                    {
                        "number": n,
                        "letter": pitch_letter(n),
                        "label": pitch_label(p["format"], n, int(p["count"])),
                        "units": sorted(pitch_units(layouts, p["format"], n)),
                    }
                    for n in range(1, int(p["count"]) + 1)
                ],
            }
            for p in layouts
        ],
    }


async def find_ground(db: aiosqlite.Connection, ground_name: str) -> Optional[aiosqlite.Row]:
    return await (await db.execute(
        "SELECT * FROM grounds WHERE location || ' - ' || name = ? OR name = ? ORDER BY is_approved DESC LIMIT 1",
        (ground_name, ground_name),
    )).fetchone()


def _multi_sport(ground: Optional[aiosqlite.Row]) -> bool:
    return bool(ground) and len([x for x in (ground["sports"] or "").split(",") if x]) > 1


async def load_occupancy(
    db: aiosqlite.Connection,
    ground: Optional[aiosqlite.Row],
    ground_name: str,
    sport: str,
    window_start: datetime,
    window_end: datetime,
    exclude_game_id: Optional[int] = None,
    exclude_allotment_id: Optional[int] = None,
) -> list[dict]:
    """Games and allotments on a ground overlapping [window_start, window_end), with the units they use."""
    layouts = sport_layouts(ground, sport)
    first_day = (window_start - timedelta(days=1)).strftime("%Y-%m-%d")
    last_day = window_end.strftime("%Y-%m-%d")
    names = [ground_name]
    if ground:
        names = [f"{ground['location']} - {ground['name']}", ground["name"]]
    filter_sport = _multi_sport(ground) and bool(sport)
    items: list[dict] = []

    query = f"""SELECT g.id, g.title, g.sport_type, g.game_date, g.game_time, g.duration_minutes, g.status,
                      g.pitch_format, g.pitch_number, g.allotment_id, g.created_by, u.name AS creator_name
               FROM games g LEFT JOIN users u ON u.id = g.created_by
               WHERE g.ground_name IN ({','.join('?' * len(names))}) AND g.status != 'cancelled'
                 AND g.game_date >= ? AND g.game_date <= ?"""
    params: list = [*names, first_day, last_day]
    if filter_sport:
        query += " AND LOWER(g.sport_type) = ?"
        params.append(sport.lower())
    if exclude_game_id is not None:
        query += " AND g.id != ?"
        params.append(exclude_game_id)
    for row in await (await db.execute(query, params)).fetchall():
        try:
            start = parse_dt(row["game_date"], row["game_time"])
        except ValueError:
            continue
        end = start + timedelta(minutes=row["duration_minutes"] or 90)
        if not (start < window_end and end > window_start):
            continue
        layout = find_layout(layouts, row["pitch_format"])
        items.append({
            "kind": "game",
            "id": row["id"],
            "title": row["title"],
            "start": start,
            "end": end,
            "units": pitch_units(layouts, row["pitch_format"], row["pitch_number"]) if layout else frozenset(range(unit_count(layouts))),
            "pitch_label": pitch_label(layout["format"] if layout else "", row["pitch_number"], int(layout["count"]) if layout else 0),
            "holder": row["creator_name"] or "",
            "allotment_id": row["allotment_id"],
            "created_by": row["created_by"],
            "status": row["status"],
        })

    if ground:
        query = """SELECT a.*, u.name AS moderator_name, mg.name AS group_name
                   FROM ground_allotments a
                   LEFT JOIN users u ON u.id = a.moderator_user_id
                   LEFT JOIN moderator_groups mg ON mg.id = a.moderator_group_id
                   WHERE a.ground_id = ? AND a.status = 'confirmed' AND a.allot_date >= ? AND a.allot_date <= ?"""
        params = [ground["id"], first_day, last_day]
        if filter_sport:
            query += " AND LOWER(a.sport_type) = ?"
            params.append(sport.lower())
        if exclude_allotment_id is not None:
            query += " AND a.id != ?"
            params.append(exclude_allotment_id)
        for row in await (await db.execute(query, params)).fetchall():
            start = parse_dt(row["allot_date"], row["start_time"])
            end = start + timedelta(minutes=row["duration_minutes"])
            if not (start < window_end and end > window_start):
                continue
            layout = find_layout(layouts, row["pitch_format"])
            items.append({
                "kind": "allotment",
                "id": row["id"],
                "title": row["notes"] or "",
                "start": start,
                "end": end,
                "units": pitch_units(layouts, row["pitch_format"], row["pitch_number"]) if layout else frozenset(range(unit_count(layouts))),
                "pitch_label": pitch_label(layout["format"] if layout else "", row["pitch_number"], int(layout["count"]) if layout else 0),
                "holder": row["group_name"] or row["moderator_name"] or "",
                "moderator_user_id": row["moderator_user_id"],
                "moderator_group_id": row["moderator_group_id"],
                "rent": row["rent"],
                "rent_paid": bool(row["rent_paid"]),
                "series_key": row["series_key"],
            })
    return items


def describe(item: dict) -> str:
    when = f"{item['start'].strftime('%Y-%m-%d %H:%M')}-{item['end'].strftime('%H:%M')}"
    if item["kind"] == "game":
        return f"game '{item['title']}' on {item['pitch_label']} ({when})"
    return f"{item['pitch_label']} allotted to {item['holder'] or 'someone'} ({when})"


async def group_parents(db: aiosqlite.Connection) -> dict[int, Optional[int]]:
    rows = await (await db.execute("SELECT id, parent_id FROM moderator_groups")).fetchall()
    return {r["id"]: r["parent_id"] for r in rows}


def group_ancestors(group_id: int, parents: dict[int, Optional[int]]) -> list[int]:
    """Parent, grandparent, ... of a group (nearest first)."""
    chain, seen = [], {group_id}
    parent = parents.get(group_id)
    while parent is not None and parent not in seen:
        chain.append(parent)
        seen.add(parent)
        parent = parents.get(parent)
    return chain


def group_descendants(group_id: int, parents: dict[int, Optional[int]]) -> set[int]:
    return {g for g in parents if g != group_id and group_id in group_ancestors(g, parents)}


async def user_group_ids(db: aiosqlite.Connection, user_id: int) -> set[int]:
    """Groups a user belongs to, directly or through a sub-group (a parent group's allotment covers its sub-groups)."""
    rows = await (await db.execute(
        "SELECT group_id FROM moderator_group_members WHERE user_id = ?", (user_id,)
    )).fetchall()
    direct = {r["group_id"] for r in rows}
    if not direct:
        return direct
    parents = await group_parents(db)
    return direct | {a for g in direct for a in group_ancestors(g, parents)}


async def group_member_ids(db: aiosqlite.Connection, group_id: int) -> set[int]:
    """Members of a group and of all its sub-groups."""
    ids = {group_id} | group_descendants(group_id, await group_parents(db))
    marks = ",".join("?" * len(ids))
    rows = await (await db.execute(
        f"SELECT DISTINCT user_id FROM moderator_group_members WHERE group_id IN ({marks})", tuple(ids)
    )).fetchall()
    return {r["user_id"] for r in rows}


def allotment_belongs_to(item: dict, user_id: int, groups: set[int]) -> bool:
    return item.get("moderator_user_id") == user_id or (item.get("moderator_group_id") in groups)


async def resolve_game_slot(
    db: aiosqlite.Connection,
    user_id: int,
    ground_name: str,
    sport: str,
    date: str,
    time: str,
    duration_minutes: int,
    pitch_format: Optional[str] = None,
    pitch_number: Optional[int] = None,
    exclude_game_id: Optional[int] = None,
    allotment_id: Optional[int] = None,
) -> dict:
    """Pick the pitch for a game and the allotment it falls in, or raise 409 on a clash.

    A game may use a pitch inside an allotment that belongs to its moderator (directly or via a
    moderator group); any other overlapping game or allotment on shared units is a conflict.
    """
    try:
        start = parse_dt(date, time)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid game date or time format")
    end = start + timedelta(minutes=duration_minutes)

    ground = await find_ground(db, ground_name)
    layouts = sport_layouts(ground, sport)
    items = await load_occupancy(db, ground, ground_name, sport, start, end, exclude_game_id=exclude_game_id)
    groups = await user_group_ids(db, user_id)
    is_admin = await (await db.execute(
        "SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,)
    )).fetchone() is not None

    covering = [
        i for i in items
        if i["kind"] == "allotment" and i["start"] <= start and i["end"] >= end
        and (allotment_belongs_to(i, user_id, groups) or (is_admin and i["id"] == allotment_id))
    ]
    if allotment_id is not None:
        covering = [i for i in covering if i["id"] == allotment_id]
        if not covering:
            raise HTTPException(status_code=400, detail="The game must be within the allotted ground and time.")

    fmt = (pitch_format or "").strip()
    if not fmt and covering:
        own = await (await db.execute(
            "SELECT pitch_format, pitch_number FROM ground_allotments WHERE id = ?", (covering[0]["id"],)
        )).fetchone()
        fmt, pitch_number = own["pitch_format"], own["pitch_number"]

    count = 1
    if fmt:
        layout = find_layout(layouts, fmt)
        if not layout:
            raise HTTPException(status_code=400, detail=f"'{fmt}' is not a pitch layout of this ground for {sport}")
        fmt, count = layout["format"], int(layout["count"])
    number = pitch_number or 0
    if fmt and number and not 1 <= number <= count:
        raise HTTPException(status_code=400, detail=f"{fmt} has only {count} pitch(es) at this ground")
    if count == 1:
        number = 0

    candidates = [number] if number or count == 1 else list(range(1, count + 1))
    options = []
    for n in candidates:
        units = pitch_units(layouts, fmt, n) if fmt else frozenset(range(unit_count(layouts)))
        link = next((a for a in covering if units <= a["units"]), None)
        blockers = [
            i for i in items
            if i["units"] & units and not (link and i["kind"] == "allotment" and i["id"] == link["id"])
        ]
        options.append((n, link, blockers))
    options.sort(key=lambda o: (bool(o[2]), o[1] is None))
    n, link, blockers = options[0]
    if blockers:
        label = pitch_label(fmt, n, count) if len(candidates) == 1 else (f"any {fmt} pitch" if fmt else "the whole ground")
        raise HTTPException(
            status_code=409,
            detail=f"Pitch conflict: {label} is not free — {describe(blockers[0])}.",
        )
    if allotment_id is not None and not link:
        raise HTTPException(status_code=400, detail="The selected pitch is outside the allotted ground.")
    group_id = None
    if link:
        group_id = link.get("moderator_group_id")
    return {
        "pitch_format": fmt,
        "pitch_number": n if fmt and count > 1 else 0,
        "allotment_id": link["id"] if link else None,
        "moderator_group_id": group_id,
    }

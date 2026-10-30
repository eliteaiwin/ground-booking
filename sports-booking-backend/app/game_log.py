"""Game "Log" tab: events are recorded as they happen; older history is rebuilt from stored timestamps."""
import os
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

import aiosqlite

from .currency import ground_currency

APP_TZ = ZoneInfo(os.environ.get("APP_TIMEZONE", "Asia/Kolkata"))
PAYMENT_KINDS = {"paid", "paid_online", "marked_paid", "settled", "excess_settled", "reminder", "refund", "received", "not_received"}
JOIN_KINDS = {"joined", "waiting", "nominated", "nominated_waiting", "pay_first", "played_added"}


def _utc_iso(local: datetime) -> str:
    return local.replace(tzinfo=APP_TZ).astimezone(timezone.utc).isoformat()


def _parse_utc(value) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00").replace(" ", "T", 1))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _schedule(game) -> tuple[Optional[datetime], Optional[datetime]]:
    try:
        start = datetime.strptime(f"{game['game_date']} {game['game_time']}", "%Y-%m-%d %H:%M")
    except (TypeError, ValueError):
        return None, None
    return start, start + timedelta(minutes=game["duration_minutes"] or 90)


async def log_event(db: aiosqlite.Connection, game_id: int, kind: str, user_id: Optional[int] = None,
                    actor_id: Optional[int] = None, amount: Optional[float] = None, note: str = "",
                    at_local: Optional[datetime] = None):
    """Record a game event. `at_local` (games' local time) caps the time, e.g. a game auto-completed
    when someone next opens the app is logged at its scheduled end."""
    now = datetime.now(timezone.utc)
    at = now
    if at_local is not None:
        at = min(now, at_local.replace(tzinfo=APP_TZ).astimezone(timezone.utc))
    await db.execute(
        "INSERT INTO game_events (game_id, kind, user_id, actor_id, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (game_id, kind, user_id, actor_id, amount, note or "", at.isoformat()),
    )


async def log_join_before_leaving(db: aiosqlite.Connection, game_id: int, player) -> None:
    """A leaver's game_players row is deleted, so keep their original join in the log first."""
    if await (await db.execute(
        f"SELECT 1 FROM game_events WHERE game_id = ? AND user_id = ? AND kind IN ({','.join('?' * len(JOIN_KINDS))})",
        (game_id, player["user_id"], *JOIN_KINDS),
    )).fetchone():
        return
    queued = player["status"] == "waiting" or bool(player["list_at"])
    by_other = player["nominated_by"] not in (None, player["user_id"])
    kind = ("nominated_waiting" if queued else "nominated") if by_other else ("waiting" if queued else "joined")
    at = _parse_utc(player["joined_at"]) or datetime.now(timezone.utc)
    await db.execute(
        "INSERT INTO game_events (game_id, kind, user_id, actor_id, amount, note, created_at) VALUES (?, ?, ?, ?, ?, '', ?)",
        (game_id, kind, player["user_id"], player["nominated_by"] or player["user_id"], None, at.isoformat()),
    )


def _duration(minutes: float) -> str:
    m = int(round(minutes))
    d, rem = divmod(m, 1440)
    h, mm = divmod(rem, 60)
    if d:
        return f"{d}d {h}h" if h else f"{d}d"
    if h:
        return f"{h}h {mm}m" if mm else f"{h}h"
    return f"{mm}m"


def _elapsed(seconds: float) -> str:
    """Two largest units, e.g. 2h, 10m 10s, 1d 3h."""
    s = max(int(round(seconds)), 0)
    parts = [(s // 86400, "d"), (s % 86400 // 3600, "h"), (s % 3600 // 60, "m"), (s % 60, "s")]
    while len(parts) > 1 and parts[0][0] == 0:
        parts.pop(0)
    shown = [f"{v}{u}" for v, u in parts[:2] if v]
    return " ".join(shown) or "0s"


async def build_log(db: aiosqlite.Connection, game, viewer_id: int, see_all_payments: bool) -> list[dict]:
    game_id = game["id"]
    cur = await ground_currency(db, game["ground_name"])
    start, end = _schedule(game)
    end_utc = end.replace(tzinfo=APP_TZ).astimezone(timezone.utc) if end else None
    start_utc = start.replace(tzinfo=APP_TZ).astimezone(timezone.utc) if start else None
    events = [dict(r) for r in await (await db.execute(
        "SELECT kind, user_id, actor_id, amount, note, created_at FROM game_events WHERE game_id = ? ORDER BY id",
        (game_id,),
    )).fetchall()]
    kinds = {e["kind"] for e in events}
    joined = {e["user_id"] for e in events if e["kind"] in JOIN_KINDS}
    paid_logged = {e["user_id"] for e in events if e["kind"] in PAYMENT_KINDS - {"reminder", "received", "not_received"}}
    creator = game["created_by"]

    if "created" not in kinds:
        events.append({"kind": "created", "user_id": None, "actor_id": creator, "amount": None, "note": "",
                       "created_at": game["created_at"]})
    # Rebuild joins in arrival order: a join gets a spot only while fewer than max_players hold one.
    end_sched = end
    moved_up = {e["user_id"] for e in events if e["kind"] == "promoted"}
    epoch = datetime.min.replace(tzinfo=timezone.utc)
    seat_moves = sorted(
        ((_parse_utc(e["created_at"]) or epoch, e["kind"], e["user_id"]) for e in events
         if e["kind"] in ("joined", "nominated", "promoted", "quit", "removed", "demoted")),
        key=lambda m: m[0],
    )
    seated: set = set()
    rows = await (await db.execute(
        "SELECT user_id, status, nominated_by, joined_at FROM game_players WHERE game_id = ? ORDER BY joined_at, id",
        (game_id,),
    )).fetchall()
    i = 0
    for p in rows:
        if p["user_id"] in joined:
            continue
        t = _parse_utc(p["joined_at"]) or epoch
        while i < len(seat_moves) and seat_moves[i][0] <= t:
            _, k, uid = seat_moves[i]
            (seated.add if k in ("joined", "nominated", "promoted") else seated.discard)(uid)
            i += 1
        by_other = p["nominated_by"] not in (None, p["user_id"])
        queued = p["status"] == "waiting" or len(seated) >= game["max_players"] or p["user_id"] in moved_up
        if not queued:
            seated.add(p["user_id"])
        kind = ("nominated_waiting" if queued else "nominated") if by_other else ("waiting" if queued else "joined")
        events.append({"kind": kind, "user_id": p["user_id"], "actor_id": p["nominated_by"], "amount": None,
                       "note": "", "created_at": p["joined_at"]})
        if queued and p["status"] != "waiting" and p["user_id"] not in moved_up:
            if game["status"] == "completed" and end_sched:
                events.append({"kind": "played_added", "user_id": p["user_id"], "actor_id": creator, "amount": None,
                               "note": "", "created_at": _utc_iso(end_sched + timedelta(seconds=2))})
            else:
                moved = (_parse_utc(p["joined_at"]) or datetime.now(timezone.utc)) + timedelta(seconds=1)
                events.append({"kind": "promoted", "user_id": p["user_id"], "actor_id": None, "amount": None,
                               "note": "", "created_at": moved.isoformat()})
    for p in await (await db.execute(
        "SELECT user_id, amount, paid_amount, paid_at, paid_by, paid_via FROM payments "
        "WHERE game_id = ? AND paid_at IS NOT NULL AND COALESCE(paid_amount, 0) > 0", (game_id,)
    )).fetchall():
        if p["user_id"] in paid_logged:
            continue
        kind = {"online": "paid_online", "moderator": "marked_paid", "offline": "settled"}.get(p["paid_via"] or "", "paid")
        events.append({"kind": kind, "user_id": p["user_id"], "actor_id": p["paid_by"], "amount": p["paid_amount"],
                       "note": "due" if kind == "settled" else "", "created_at": p["paid_at"]})
    status = game["status"]
    now_local = datetime.now(APP_TZ).replace(tzinfo=None)
    if start and status in ("in_progress", "completed") and "started" not in kinds:
        events.append({"kind": "started", "user_id": None, "actor_id": None, "amount": None, "note": "",
                       "created_at": _utc_iso(start)})
    if end and status == "completed":
        if "completed" not in kinds:
            events.append({"kind": "completed", "user_id": None, "actor_id": None, "amount": None, "note": "",
                           "created_at": _utc_iso(end)})
        events.append({"kind": "potd_open", "user_id": None, "actor_id": None, "amount": None, "note": "",
                       "created_at": _utc_iso(end + timedelta(seconds=1))})
        deadline = end + timedelta(minutes=game["potd_congrats_delay_minutes"] or 1440)
        if now_local >= deadline:
            top = await (await db.execute(
                """SELECT player_id, SUM(CASE preference WHEN 1 THEN 3 WHEN 2 THEN 2 WHEN 3 THEN 1 ELSE 0 END) AS pts,
                          SUM(CASE WHEN preference = 1 THEN 1 ELSE 0 END) AS firsts
                   FROM potd_votes WHERE game_id = ? GROUP BY player_id ORDER BY pts DESC, firsts DESC LIMIT 1""",
                (game_id,),
            )).fetchone()
            events.append({"kind": "potd_final", "user_id": top["player_id"] if top else None, "actor_id": None,
                           "amount": None, "note": "", "created_at": _utc_iso(deadline)})

    if not see_all_payments:
        events = [e for e in events if e["kind"] not in PAYMENT_KINDS or e["user_id"] == viewer_id]

    def place_of(e) -> Optional[int]:
        note = e["note"] or ""
        return int(note[6:]) if note.startswith("place:") and note[6:].isdigit() else None

    ids = {i for e in events for i in (e["user_id"], e["actor_id"], place_of(e)) if i} | {creator}
    people = {}
    if ids:
        marks = ",".join("?" * len(ids))
        for u in await (await db.execute(
            f"SELECT id, name, display_name, gender, profile_pic FROM users WHERE id IN ({marks})", tuple(ids)
        )).fetchall():
            people[u["id"]] = dict(u)

    def nm(uid) -> str:
        u = people.get(uid)
        if not u:
            return "Someone"
        return (u["display_name"] or (u["name"] or "").split(" ")[0] or "Someone").strip()

    def money(v) -> str:
        text = f"{(v or 0):,.0f}"
        return f"{cur} {text}" if cur[-1:].isalpha() else f"{cur}{text}"

    def timing(at: Optional[datetime]) -> str:
        if not at or not end_utc or not start_utc:
            return ""
        if at < start_utc:
            return f", {_elapsed((start_utc - at).total_seconds())} before the game started"
        if at < end_utc:
            return f", {_elapsed((end_utc - at).total_seconds())} before the game ended"
        return f", {_elapsed((at - end_utc).total_seconds())} after the game ended"

    out = []
    for e in events:
        at = _parse_utc(e["created_at"])
        if not at:
            continue
        u, a, k, note = nm(e["user_id"]), nm(e["actor_id"]), e["kind"], e["note"]
        pays = " (still pays, nobody was waiting)" if note == "pays" else ""
        text = {
            "created": f"Game is initiated by moderator {a}",
            "cloned": f"{a} cloned this game from {note}",
            "joined": f"{u} joins the game{' (tentative)' if note == 'tentative' else ''}",
            "waiting": f"{u} joins the waiting list{' (tentative)' if note == 'tentative' else ''}",
            "availability_confirmed": f"{u} confirms playing (no longer tentative)",
            "nominated": f"{a} adds {u} to the game",
            "nominated_waiting": f"{a} adds {u} to the waiting list",
            "pay_first": f"{u} asks to join (pays first)",
            "admitted": f"{u} is added after paying",
            "promoted": f"{u} is confirmed from WL in {nm(place_of(e))}'s place" if place_of(e)
                        else f"{u} moves up from the waiting list",
            "demoted": f"{u} moves to the waiting list (fewer spots)",
            "quit": f"{u} quit the game{pays}",
            "quit_waiting": f"{u} left the waiting list",
            "removed": f"{a} removed {u}{pays}",
            "played_added": f"{a} adds {u} as played",
            "played_removed": f"{a} marks {u} as not played",
            "started": "Game is started",
            "completed": "Game is completed",
            "cancelled": f"Game is cancelled by {a}",
            "potd_open": "POTD voting started",
            "potd_final": f"POTD finalized: {u}" if e["user_id"] else "POTD finalized (no votes)",
            "paid": f"{u} paid {money(e['amount'])}{' with screenshot' if note == 'screenshot' else ''}{timing(at)}",
            "paid_online": f"{u} paid {money(e['amount'])} online{timing(at)}",
            "marked_paid": f"{a} marked {u}'s {money(e['amount'])} as paid{timing(at)}",
            "settled": f"{a} settled {u}'s {'excess' if note == 'excess' else 'due'} of {money(e['amount'])} offline{timing(at)}",
            "excess_settled": f"{a} returned {u}'s excess of {money(e['amount'])}",
            "received": f"{note or a} confirmed receiving {u}'s {money(e['amount'])}",
            "not_received": f"{note or a} says {u}'s {money(e['amount'])} was not received",
            "reminder": f"{note or a} sent {u} a payment reminder" + (f" ({money(e['amount'])} due)" if e["amount"] else ""),
            "refund": f"{u}'s {money(e['amount'])} to be refunded offline by the Payment Receiver",
        }.get(k, k)
        who = e["user_id"] or e["actor_id"] or creator
        p = people.get(who) or {}
        out.append({
            "kind": k, "at": at.astimezone(APP_TZ).replace(tzinfo=None).isoformat(timespec="seconds"), "description": text,
            "user_id": who, "user_name": nm(who), "profile_pic": p.get("profile_pic"), "gender": p.get("gender"),
        })
    out.sort(key=lambda x: x["at"])
    return out

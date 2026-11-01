"""Goal timing: storage helpers and insights such as late goals, hat-tricks and first-scorer results."""
from datetime import datetime, timedelta
from typing import Iterable, Optional

import aiosqlite

WINDOW = timedelta(minutes=15)


def game_window(game) -> Optional[tuple]:
    try:
        start = datetime.strptime(f"{game['game_date']} {game['game_time']}", "%Y-%m-%d %H:%M")
    except (TypeError, ValueError):
        return None
    return start, start + timedelta(minutes=game["duration_minutes"] or 90)


def goal_at(game, hhmm: str) -> Optional[datetime]:
    """Map an HH:MM goal time onto the game's date (handles games that cross midnight)."""
    win = game_window(game)
    try:
        t = datetime.strptime(hhmm, "%H:%M").time()
    except (TypeError, ValueError):
        return None
    if not win:
        return None
    start, end = win
    for day in (start.date(), start.date() + timedelta(days=1)):
        at = datetime.combine(day, t)
        if start - WINDOW <= at <= end + WINDOW:
            return at
    return None


async def save_goal_times(db: aiosqlite.Connection, game, user_id: int, times: Iterable[str], own_goal: bool, limit: int):
    for hhmm in list(times or [])[:max(limit, 0)]:
        hhmm = (hhmm or "").strip()
        if not hhmm:
            continue
        if not goal_at(game, hhmm):
            start, end = game_window(game) or (None, None)
            from fastapi import HTTPException
            span = f" ({(start - WINDOW):%H:%M} to {(end + WINDOW):%H:%M})" if start else ""
            raise HTTPException(status_code=400, detail=f"Goal time {hhmm} must be within the game time ±15 min{span}")
        await db.execute(
            "INSERT INTO goal_times (game_id, user_id, own_goal, scored_at) VALUES (?, ?, ?, ?)",
            (game["id"], user_id, 1 if own_goal else 0, hhmm),
        )


def _ordinal(n: int) -> str:
    return f"{n}{'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


async def _team_result(db, game_id: int, user_id: int) -> Optional[str]:
    row = await (await db.execute(
        "SELECT team_id FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, user_id))).fetchone()
    sc = await (await db.execute("SELECT * FROM game_scores WHERE game_id = ?", (game_id,))).fetchone()
    if not row or not row["team_id"] or not sc:
        return None
    if row["team_id"] == sc["team_a_id"]:
        mine, theirs = sc["team_a_score"], sc["team_b_score"]
    elif row["team_id"] == sc["team_b_id"]:
        mine, theirs = sc["team_b_score"], sc["team_a_score"]
    else:
        return None
    return "win" if mine > theirs else "lose" if mine < theirs else "draw"


async def first_scorer(db, game) -> Optional[int]:
    rows = await (await db.execute(
        "SELECT user_id, scored_at FROM goal_times WHERE game_id = ? AND own_goal = 0", (game["id"],))).fetchall()
    timed = [(goal_at(game, r["scored_at"]), r["user_id"]) for r in rows]
    timed = [t for t in timed if t[0]]
    return min(timed)[1] if timed else None


async def game_insights(db: aiosqlite.Connection, game, today: str) -> list:
    gid = game["id"]
    names = {r["id"]: (r["display_name"] or r["name"]) for r in await (await db.execute(
        "SELECT u.id, u.name, u.display_name FROM users u JOIN game_players gp ON gp.user_id = u.id WHERE gp.game_id = ?",
        (gid,))).fetchall()}
    out = []
    win = game_window(game)

    # Late goals
    if win:
        late_from = win[1] - timedelta(minutes=5)
        late: dict = {}
        for r in await (await db.execute(
                "SELECT user_id, scored_at FROM goal_times WHERE game_id = ? AND own_goal = 0", (gid,))).fetchall():
            at = goal_at(game, r["scored_at"])
            if at and at >= late_from:
                late[r["user_id"]] = late.get(r["user_id"], 0) + 1
        for uid, n in sorted(late.items(), key=lambda x: -x[1]):
            out.append(f"{names.get(uid, 'Someone')} scored {n} goals in the last 5 mins" if n > 1
                       else f"{names.get(uid, 'Someone')} scored in the last 5 mins")

    # Hat-tricks
    for r in await (await db.execute(
            "SELECT user_id FROM goal_scorers WHERE game_id = ? AND goals >= 3", (gid,))).fetchall():
        n = (await (await db.execute(
            """SELECT COUNT(*) FROM goal_scorers gs JOIN games g ON g.id = gs.game_id
               WHERE gs.user_id = ? AND gs.goals >= 3 AND g.status = 'completed'
                 AND (g.game_date < ? OR (g.game_date = ? AND g.id <= ?))""",
            (r["user_id"], game["game_date"], game["game_date"], gid))).fetchone())[0]
        when = " today" if game["game_date"] == today else ""
        out.append(f"{names.get(r['user_id'], 'Someone')} scored a hat-trick{when}" if n <= 1
                   else f"{names.get(r['user_id'], 'Someone')} has a {_ordinal(n)} hat-trick{when}")

    # First goal and the team's result, across all games where this player scored first
    uid = await first_scorer(db, game)
    if uid:
        results = []
        for g in await (await db.execute(
                """SELECT DISTINCT g.* FROM games g JOIN goal_times gt ON gt.game_id = g.id
                   WHERE g.status = 'completed' AND gt.user_id = ? AND gt.own_goal = 0""", (uid,))).fetchall():
            if await first_scorer(db, g) == uid:
                res = await _team_result(db, g["id"], uid)
                if res:
                    results.append(res)
        name = names.get(uid, "Someone")
        if len(results) >= 2:
            top = max(set(results), key=results.count)
            verb = {"win": "wins", "lose": "loses", "draw": "draws"}[top]
            if results.count(top) == len(results):
                out.append(f"Whenever {name} scores first, the team {verb} ({len(results)} of {len(results)})")
            else:
                out.append(f"When {name} scores first, the team {verb} {results.count(top)} of {len(results)}")
        else:
            out.append(f"{name} scored the first goal")
    return out

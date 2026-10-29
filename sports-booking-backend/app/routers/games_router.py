import math
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List, Dict
import aiosqlite
import hashlib
import os
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .. import cashfree
from ..database import get_db, get_app_setting
from ..auth import get_current_user_id
from ..pitches import resolve_game_slot, user_group_ids
from .preferences_router import game_defaults
from ..currency import ground_currency
from ..game_log import log_event, build_log

VOTING_LINK_SECRET = "ground-booking-voting-2026"

router = APIRouter(prefix="/api/games", tags=["games"])


class CreateGameRequest(BaseModel):
    title: str
    sport_type: str  # soccer, cricket, badminton, basketball, hockey, pickleball, tennis, swimming
    ground_name: str
    game_date: str
    game_time: str
    max_players: int
    ground_cost: float  # total ground cost; cost_per_person is derived
    payment_timing: str  # before, after
    duration_minutes: int = 90
    payee_user_id: Optional[int] = None
    quit_penalty_hours: Optional[int] = None  # None = moderator preference
    payment_mode: str = "postpaid"  # prepaid, postpaid
    potd_congrats_delay_minutes: Optional[int] = None  # None = moderator preference (24 hours by default)
    note_before_players: Optional[str] = None
    note_after_players: Optional[str] = None
    series_name: Optional[str] = None
    series_day: Optional[str] = None
    pitch_format: Optional[str] = None
    pitch_number: Optional[int] = None
    allotment_id: Optional[int] = None
    payment_collection: str = "offline"  # offline, app


class EditGameRequest(BaseModel):
    title: Optional[str] = None
    sport_type: Optional[str] = None
    ground_name: Optional[str] = None
    game_date: Optional[str] = None
    game_time: Optional[str] = None
    max_players: Optional[int] = None
    ground_cost: Optional[float] = None  # total ground cost
    cost_per_person: Optional[float] = None  # deprecated, kept for compatibility
    duration_minutes: Optional[int] = None
    payee_user_id: Optional[int] = None
    quit_penalty_hours: Optional[int] = None
    payment_mode: Optional[str] = None  # prepaid, postpaid
    potd_congrats_delay_minutes: Optional[int] = None
    note_before_players: Optional[str] = None
    note_after_players: Optional[str] = None
    series_name: Optional[str] = None
    series_day: Optional[str] = None
    pitch_format: Optional[str] = None
    pitch_number: Optional[int] = None
    payment_collection: Optional[str] = None  # offline, app


class SeriesDay(BaseModel):
    day: str  # Monday, Tuesday, ...
    time: str  # HH:MM


class CreateSeriesRequest(BaseModel):
    series_name: str
    sport_type: str
    ground_name: str
    max_players: int
    ground_cost: float  # total ground cost; per-player cost derived
    duration_minutes: int = 90
    payee_user_id: Optional[int] = None
    quit_penalty_hours: Optional[int] = None
    payment_mode: str = "postpaid"
    potd_congrats_delay_minutes: Optional[int] = None
    note_before_players: Optional[str] = None
    note_after_players: Optional[str] = None
    recurrence_days: List[SeriesDay]
    weeks: int = 4
    pitch_format: Optional[str] = None
    start_date: Optional[str] = None  # YYYY-MM-DD; defaults to today
    payment_collection: str = "offline"  # offline, app


class NominateRequest(BaseModel):
    user_id: int
    position: str = ""


class PlayerPrepayRequest(BaseModel):
    must_prepay: bool
    always: Optional[bool] = None


class StartGameRequest(BaseModel):
    """Start game no longer requires payee/penalty/mode — those are set at create/edit time."""
    pass


class VotePOTDRequest(BaseModel):
    first_preference: int
    second_preference: Optional[int] = None
    third_preference: Optional[int] = None


class VoteJoinRequest(BaseModel):
    position: str = ""


class CreateTeamsRequest(BaseModel):
    team_names: List[str]  # e.g. ["Team A", "Team B"]
    jersey_colors: Optional[List[str]] = None


class TeamJerseyRequest(BaseModel):
    jersey_color: str = ""


JERSEY_COLORS = ["Blue", "Green", "Yellow", "Red", "White", "Black", "Blue/Black", "Black/White", "Bibs - Green or Red"]


def _jersey_shades(color: str) -> set:
    """Colours a jersey shows; Blue and Black look alike on the pitch, so they count as one."""
    parts = color.replace("Bibs - ", "").replace(" or ", "/").split("/")
    return {"Dark" if p in ("Blue", "Black") else p for p in parts if p}


def _check_jerseys(colors: List[str]) -> List[str]:
    cleaned = [(c or "").strip() for c in colors]
    for c in cleaned:
        if c and c not in JERSEY_COLORS:
            raise HTTPException(status_code=400, detail=f"Unknown jersey colour: {c}")
    picked = [c for c in cleaned if c]
    for i, a in enumerate(picked):
        for b in picked[i + 1:]:
            if _jersey_shades(a) & _jersey_shades(b):
                raise HTTPException(status_code=400, detail=f"{a} and {b} look too alike for two teams")
    return cleaned


class MovePlayerRequest(BaseModel):
    player_user_id: int
    team_id: Optional[int] = None  # null to unassign


class CompleteGameRequest(BaseModel):
    team_a_score: Optional[int] = None
    team_b_score: Optional[int] = None
    goal_scorers: Optional[List[dict]] = None  # [{"user_id": int, "goals": int}]
    played_user_ids: Optional[List[int]] = None  # players who actually played and should pay


class TeamScore(BaseModel):
    team_id: int
    score: int


class GoalScorerEntry(BaseModel):
    user_id: int
    goals: int = 0
    own_goals: int = 0


class EditCompletedGameRequest(BaseModel):
    played_user_ids: List[int]
    team_scores: Optional[List[TeamScore]] = None
    team_assignments: Optional[Dict[str, Optional[int]]] = None
    goal_scorers: Optional[List[GoalScorerEntry]] = None


class MarkPaymentRequest(BaseModel):
    user_id: int
    game_id: int


async def require_role(user_id: int, role: str, db: aiosqlite.Connection):
    cursor = await db.execute("SELECT role FROM user_roles WHERE user_id = ? AND role = ?", (user_id, role))
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=403, detail=f"{role.capitalize()} access required")


async def require_admin_or_moderator(user_id: int, db: aiosqlite.Connection):
    cursor = await db.execute(
        "SELECT role FROM user_roles WHERE user_id = ? AND role IN ('admin', 'moderator')", (user_id,)
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="Admin or Moderator access required")


async def require_admin_moderator_or_ground_management(user_id: int, db: aiosqlite.Connection):
    cursor = await db.execute(
        "SELECT role FROM user_roles WHERE user_id = ? AND role IN ('admin', 'moderator', 'ground_management')",
        (user_id,),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="Admin, Moderator, or Ground Management access required")


def _parse_game_datetime(game_date: str, game_time: str) -> datetime:
    """Parse a game date and time string into a naive datetime."""
    return datetime.strptime(f"{game_date} {game_time}", "%Y-%m-%d %H:%M")


async def _payment_settings(db: aiosqlite.Connection, game: Optional[aiosqlite.Row] = None) -> dict:
    enabled = (await get_app_setting(db, 'payments_enabled', 'false')).lower() == 'true'
    if game is not None and (game["payment_collection"] or "offline") != "app":
        enabled = False
    fees = await payment_fee_settings(db)
    return {"enabled": enabled, **fees}


PAYMENT_COLLECTIONS = ("offline", "app")


def _check_collection(value: str) -> str:
    if value not in PAYMENT_COLLECTIONS:
        raise HTTPException(status_code=400, detail="payment_collection must be 'offline' or 'app'")
    return value


DEFAULT_GATEWAY_FEE_PERCENT = '2'
DEFAULT_GATEWAY_GST_PERCENT = '18'
DEFAULT_COMMISSION_PERCENT = '3'
DEFAULT_APP_FEE_GST_PERCENT = '0'


async def payment_fee_settings(db: aiosqlite.Connection) -> dict:
    return {
        "surcharge_percent": float(await get_app_setting(db, 'payment_surcharge_percent', DEFAULT_GATEWAY_FEE_PERCENT)),
        "gst_percent": float(await get_app_setting(db, 'payment_gst_percent', DEFAULT_GATEWAY_GST_PERCENT)),
        "commission_percent": float(await get_app_setting(db, 'payment_dev_share_percent', DEFAULT_COMMISSION_PERCENT)),
        "app_fee_gst_percent": float(await get_app_setting(db, 'payment_app_fee_gst_percent', DEFAULT_APP_FEE_GST_PERCENT)),
    }


def online_breakdown(base: float, fees: dict) -> dict:
    """App fee (plus GST on it) is added on top of the base; the total is then grossed up so the
    gateway fee (plus GST on it) is also covered by the payer."""
    commission = round(base * fees["commission_percent"] / 100, 2)
    app_fee_gst = round(commission * fees["app_fee_gst_percent"] / 100, 2)
    subtotal = base + commission + app_fee_gst
    rate = fees["surcharge_percent"] * (1 + fees["gst_percent"] / 100) / 100
    exact = round(subtotal / (1 - rate), 2) if 0 < rate < 1 else round(subtotal, 2)
    # Players pay a whole-rupee amount; the round-up goes to the app fee.
    total = float(math.ceil(exact - 0.001))
    return {
        "base": round(base, 2),
        "app_fee": round(commission + total - exact, 2),
        "app_fee_gst": app_fee_gst,
        "gateway_fee": round(exact - subtotal, 2),
        "total": total,
    }


async def _get_sport_max_players(db: aiosqlite.Connection, sport_type: str) -> int | None:
    cursor = await db.execute(
        "SELECT default_max_players FROM moderator_preferences WHERE sport_type = ?",
        (sport_type,)
    )
    row = await cursor.fetchone()
    return row["default_max_players"] if row else None


async def _get_game(db: aiosqlite.Connection, game_id: int) -> aiosqlite.Row:
    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    return game


def _whole_rupees(amount: float) -> float:
    return float(math.ceil(amount - 0.001)) if amount > 0 else 0.0


def _per_person_amount(ground_cost: float, player_count: int, max_players: int) -> float:
    """Split ground cost across actual players; fall back to max players when none have joined yet."""
    denominator = player_count if player_count > 0 else max_players
    if denominator <= 0:
        return 0.0
    return round(ground_cost / denominator, 2)


async def _paid_player_names(db: aiosqlite.Connection, game_id: int, user_ids) -> list:
    """Names of the given players who have already paid something for this game."""
    ids = list(user_ids)
    if not ids:
        return []
    rows = await (await db.execute(
        "SELECT u.name FROM payments p JOIN users u ON u.id = p.user_id "
        f"WHERE p.game_id = ? AND p.user_id IN ({','.join('?' * len(ids))}) AND COALESCE(p.paid_amount, 0) > 0",
        (game_id, *ids)
    )).fetchall()
    return [r["name"] for r in rows]


async def _recalc_game_cost(db: aiosqlite.Connection, game_id: int, game: Optional[aiosqlite.Row] = None):
    """Recompute cost_per_person and update payment records for selected players."""
    if game is None:
        game = await _get_game(db, game_id)

    counted = "played = 1" if game["status"] == "completed" else "status = 'selected'"
    cursor = await db.execute(
        f"SELECT COUNT(*) as cnt FROM game_players WHERE game_id = ? AND {counted}",
        (game_id,)
    )
    selected_count = (await cursor.fetchone())["cnt"]

    ground_cost = game["ground_cost"] if game["ground_cost"] is not None else (game["cost_per_person"] * game["max_players"])
    max_players = game["max_players"]
    new_cost = _per_person_amount(ground_cost, selected_count if game["status"] == "completed" else 0, max_players)

    await db.execute(
        "UPDATE games SET cost_per_person = ?, ground_cost = ? WHERE id = ?",
        (new_cost, ground_cost, game_id)
    )

    # Update payment amounts for selected/waiting players; preserve paid_amount where already paid.
    # App payments keep the exact share (fees are added at checkout); offline amounts are whole rupees.
    due = new_cost if (await _payment_settings(db, game))["enabled"] else _whole_rupees(new_cost)
    await db.execute(
        f"UPDATE payments SET amount = ? WHERE game_id = ? AND user_id IN (SELECT user_id FROM game_players WHERE game_id = ? AND {counted})",
        (due, game_id, game_id)
    )

    # Adjust payment status based on paid_amount
    cursor = await db.execute(
        "SELECT id, user_id, amount, paid_amount, status FROM payments WHERE game_id = ?",
        (game_id,)
    )
    rows = await cursor.fetchall()
    for row in rows:
        new_status = "paid" if (row["paid_amount"] or 0) >= row["amount"] else "pending"
        await db.execute(
            "UPDATE game_players SET payment_confirmed = ? WHERE game_id = ? AND user_id = ?",
            (1 if new_status == "paid" else 0, game_id, row["user_id"])
        )
        if new_status != row["status"]:
            if new_status == "paid":
                await db.execute(
                    "UPDATE payments SET status = 'paid', paid_at = ? WHERE id = ?",
                    (datetime.now(timezone.utc).isoformat(), row["id"])
                )
            else:
                await db.execute(
                    "UPDATE payments SET status = 'pending', paid_at = NULL WHERE id = ?",
                    (row["id"],)
                )
    await db.commit()


async def can_moderate_game(user_id: int, game_id: int, db: aiosqlite.Connection) -> bool:
    row = await (await db.execute(
        "SELECT created_by, moderator_group_id FROM games WHERE id = ?", (game_id,)
    )).fetchone()
    if not row or not row["moderator_group_id"] or row["created_by"] == user_id:
        return True
    admin = await (await db.execute(
        "SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,)
    )).fetchone()
    return admin is not None or row["moderator_group_id"] in await user_group_ids(db, user_id)


async def require_game_moderator(user_id: int, game_id: int, db: aiosqlite.Connection):
    await require_admin_or_moderator(user_id, db)
    if not await can_moderate_game(user_id, game_id, db):
        raise HTTPException(status_code=403, detail="Only moderators in this game's moderator group can manage it")


async def _hidden_group_game_ids(db: aiosqlite.Connection, user_id: int) -> set[int]:
    """Games run by a moderator group stay hidden from moderators outside that group."""
    roles = {r["role"] for r in await (await db.execute(
        "SELECT role FROM user_roles WHERE user_id = ?", (user_id,)
    )).fetchall()}
    if "admin" in roles or "moderator" not in roles:
        return set()
    groups = await user_group_ids(db, user_id)
    rows = await (await db.execute(
        """SELECT g.id, g.moderator_group_id FROM games g
           WHERE g.moderator_group_id IS NOT NULL AND g.created_by != ?
             AND NOT EXISTS (SELECT 1 FROM game_players gp WHERE gp.game_id = g.id AND gp.user_id = ?)""",
        (user_id, user_id)
    )).fetchall()
    return {r["id"] for r in rows if r["moderator_group_id"] not in groups}


async def _potd_win_counts(db: aiosqlite.Connection, where: str = "g.status = 'completed'", params: Optional[list] = None) -> Dict[int, int]:
    """Number of games each player was chosen Player of the Day (same tie-break as the game view)."""
    cursor = await db.execute(
        f"""SELECT pv.game_id, pv.player_id,
                   SUM(CASE WHEN pv.preference = 1 THEN 3
                            WHEN pv.preference = 2 THEN 2
                            WHEN pv.preference = 3 THEN 1 ELSE 0 END) as points,
                   COUNT(*) as total_votes
            FROM potd_votes pv
            JOIN games g ON pv.game_id = g.id
            WHERE {where}
            GROUP BY pv.game_id, pv.player_id""",
        params or [],
    )
    best: Dict[int, tuple] = {}
    for r in await cursor.fetchall():
        key = (-(r["points"] or 0), -r["total_votes"], r["player_id"])
        if r["game_id"] not in best or key < best[r["game_id"]]:
            best[r["game_id"]] = key
    wins: Dict[int, int] = {}
    for key in best.values():
        wins[key[2]] = wins.get(key[2], 0) + 1
    return wins


async def _build_rankings(
    db: aiosqlite.Connection,
    *,
    sport_type: Optional[str] = None,
    ground_name: Optional[str] = None,
    series_name: Optional[str] = None,
    series_day: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> list[dict]:
    """Build player rankings by POTD points + goals for a given filter scope."""
    conditions = ["g.status = 'completed'"]
    params: list = []
    if sport_type:
        conditions.append("g.sport_type = ?")
        params.append(sport_type)
    if ground_name:
        conditions.append("g.ground_name = ?")
        params.append(ground_name)
    if series_name:
        conditions.append("g.series_name = ?")
        params.append(series_name)
    if series_day:
        conditions.append("g.series_day = ?")
        params.append(series_day)
    if from_date:
        conditions.append("g.game_date >= ?")
        params.append(from_date)
    if to_date:
        conditions.append("g.game_date <= ?")
        params.append(to_date)
    where = " AND ".join(conditions)

    # POTD points
    cursor = await db.execute(
        f"""SELECT pv.player_id, u.name, u.display_name, u.first_name, u.phone,
                   SUM(CASE WHEN pv.preference = 1 THEN 3
                            WHEN pv.preference = 2 THEN 2
                            WHEN pv.preference = 3 THEN 1 ELSE 0 END) as potd_points,
                   SUM(CASE WHEN pv.preference = 1 THEN 1 ELSE 0 END) as first_pref_wins,
                   COUNT(DISTINCT pv.game_id) as games_voted_in
            FROM potd_votes pv
            JOIN users u ON pv.player_id = u.id
            JOIN games g ON pv.game_id = g.id
            WHERE {where}
            GROUP BY pv.player_id
            ORDER BY potd_points DESC, first_pref_wins DESC""",
        params,
    )
    potd_rows = await cursor.fetchall()

    # Goals (net of own goals)
    cursor = await db.execute(
        f"""SELECT gs.user_id, u.name, u.display_name, u.first_name, u.phone,
                   SUM(gs.goals - gs.own_goals) as total_goals,
                   COUNT(DISTINCT gs.game_id) as games_scored_in
            FROM goal_scorers gs
            JOIN users u ON gs.user_id = u.id
            JOIN games g ON gs.game_id = g.id
            WHERE {where}
            GROUP BY gs.user_id
            ORDER BY total_goals DESC""",
        params,
    )
    goals_rows = await cursor.fetchall()

    # Games played
    cursor = await db.execute(
        f"""SELECT gp.user_id, COUNT(DISTINCT gp.game_id) as games_played
            FROM game_players gp
            JOIN games g ON gp.game_id = g.id
            WHERE gp.status = 'selected' AND {where}
            GROUP BY gp.user_id""",
        params,
    )
    games_played_rows = await cursor.fetchall()
    games_played_map = {r["user_id"]: r["games_played"] for r in games_played_rows}
    potd_wins = await _potd_win_counts(db, where, params)

    goals_map = {}
    for r in goals_rows:
        goals_map[r["user_id"]] = {
            "total_goals": r["total_goals"],
            "games_scored_in": r["games_scored_in"],
        }

    player_ids_seen = set()
    rankings = []
    for r in potd_rows:
        pid = r["player_id"]
        player_ids_seen.add(pid)
        goal_data = goals_map.get(pid, {"total_goals": 0, "games_scored_in": 0})
        rankings.append({
            "user_id": pid,
            "name": r["name"],
            "display_name": r["display_name"] or "",
            "first_name": r["first_name"],
            "phone": r["phone"],
            "potd_points": r["potd_points"],
            "first_pref_wins": r["first_pref_wins"],
            "potd_wins": potd_wins.get(pid, 0),
            "total_goals": goal_data["total_goals"],
            "games_played": games_played_map.get(pid, 0),
            "combined_score": r["potd_points"] + goal_data["total_goals"],
        })

    for r in goals_rows:
        pid = r["user_id"]
        if pid not in player_ids_seen:
            rankings.append({
                "user_id": pid,
                "name": r["name"],
                "display_name": r["display_name"] or "",
                "first_name": r["first_name"],
                "phone": r["phone"],
                "potd_points": 0,
                "first_pref_wins": 0,
                "potd_wins": potd_wins.get(pid, 0),
                "total_goals": r["total_goals"],
                "games_played": games_played_map.get(pid, 0),
                "combined_score": r["total_goals"],
            })

    rankings.sort(key=lambda x: (-x["combined_score"], -x["potd_points"], -x["total_goals"]))
    for i, r in enumerate(rankings, 1):
        r["rank"] = i

    return rankings


def _outcome_for_player(row: aiosqlite.Row) -> Optional[str]:
    """Return 'win', 'loss', 'draw', or None for a player's completed game row."""
    team_id = row["team_id"]
    if not team_id:
        return None
    team_a_id = row["team_a_id"]
    team_b_id = row["team_b_id"]
    if team_id == team_a_id:
        team_score = row["team_a_score"]
        opp_score = row["team_b_score"]
    elif team_id == team_b_id:
        team_score = row["team_b_score"]
        opp_score = row["team_a_score"]
    else:
        return None
    if team_score is None or opp_score is None:
        return None
    if team_score > opp_score:
        return "win"
    if team_score < opp_score:
        return "loss"
    return "draw"


async def _compute_streaks(
    db: aiosqlite.Connection,
    player_id: int,
    since_date: Optional[str] = None,
) -> dict:
    """Compute win/loss streaks for a player across completed games."""
    conditions = ["g.status = 'completed'", "gp.user_id = ?", "gp.status = 'selected'"]
    params = [player_id]
    if since_date:
        conditions.append("g.game_date >= ?")
        params.append(since_date)

    cursor = await db.execute(
        f"""SELECT g.id, g.game_date, g.game_time, gp.team_id,
                   gs.team_a_id, gs.team_a_score, gs.team_b_id, gs.team_b_score
            FROM game_players gp
            JOIN games g ON gp.game_id = g.id
            LEFT JOIN game_scores gs ON gs.game_id = g.id
            WHERE {' AND '.join(conditions)}
            ORDER BY g.game_date ASC, g.game_time ASC""",
        params,
    )
    games = await cursor.fetchall()

    outcomes = []
    for row in games:
        outcome = _outcome_for_player(row)
        if outcome:
            outcomes.append(outcome)

    # Current streaks from the most recent games
    current_win_streak = 0
    current_loss_streak = 0
    for o in reversed(outcomes):
        if o == "win":
            current_win_streak += 1
        else:
            break
    for o in reversed(outcomes):
        if o == "loss":
            current_loss_streak += 1
        else:
            break

    # Longest streaks within the date range
    def longest_streak(seq: list[str], target: str) -> int:
        best = 0
        current = 0
        for o in seq:
            if o == target:
                current += 1
                best = max(best, current)
            else:
                current = 0
        return best

    return {
        "games_considered": len(outcomes),
        "current_win_streak": current_win_streak,
        "current_loss_streak": current_loss_streak,
        "longest_win_streak": longest_streak(outcomes, "win"),
        "longest_loss_streak": longest_streak(outcomes, "loss"),
    }


async def create_notification(db: aiosqlite.Connection, user_id: int, game_id: int, notif_type: str, message: str):
    await db.execute(
        "INSERT INTO notifications (user_id, game_id, type, message) VALUES (?, ?, ?, ?)",
        (user_id, game_id, notif_type, message)
    )


PAY_FIRST_STATUS = "awaiting_payment"


APP_TIMEZONE = os.environ.get("APP_TIMEZONE", "Asia/Kolkata")


def _local_now() -> datetime:
    """Game dates/times are stored in the grounds' local time (India by default), not the server's clock."""
    return datetime.now(ZoneInfo(APP_TIMEZONE)).replace(tzinfo=None)


def _game_start(game) -> Optional[datetime]:
    try:
        return datetime.strptime(f"{game['game_date']} {game['game_time']}", "%Y-%m-%d %H:%M")
    except (TypeError, ValueError):
        return None


def _game_end(game) -> Optional[datetime]:
    try:
        duration = game["duration_minutes"] or 90
    except (KeyError, IndexError):
        duration = 90
    try:
        return datetime.strptime(f"{game['game_date']} {game['game_time']}", "%Y-%m-%d %H:%M") + timedelta(minutes=duration)
    except (TypeError, ValueError):
        return None


def _game_has_ended(game) -> bool:
    end = _game_end(game)
    return end is not None and _local_now() >= end


async def _roster_locked(db: aiosqlite.Connection, game) -> bool:
    """Players of a completed game can only be added/removed for roster_edit_days after it ends."""
    if game["status"] != "completed":
        return False
    days = int(await get_app_setting(db, "roster_edit_days", "3") or 3)
    end = _game_end(game)
    return end is not None and _local_now() >= end + timedelta(days=days)


LATE_QUIT_DETAIL = (
    "You are quitting late, please liaise with the moderator to remove your name. "
    "If someone from the waiting list gets confirmed in your place then fine, "
    "else you still pay for today's game."
)


async def _late_quit_hours(db: aiosqlite.Connection) -> int:
    return int(await get_app_setting(db, "late_quit_hours", "2") or 0)


async def _is_late_quit(db: aiosqlite.Connection, game) -> bool:
    """Confirmed players can't quit themselves within late_quit_hours of the start."""
    hours = await _late_quit_hours(db)
    if hours <= 0:
        return False
    try:
        start = datetime.strptime(f"{game['game_date']} {game['game_time']}", "%Y-%m-%d %H:%M")
    except (TypeError, ValueError):
        return False
    return _local_now() >= start - timedelta(hours=hours)


async def _is_game_moderator(user_id: int, game_id: int, db: aiosqlite.Connection) -> bool:
    try:
        await require_game_moderator(user_id, game_id, db)
        return True
    except HTTPException:
        return False


ROSTER_LOCKED_DETAIL = "Players can't be added or removed any more: the game ended more than {} days ago"


def _game_is_archived(game) -> bool:
    """Completed/cancelled games archive as soon as their end time passes, any other game 24 hours after it ends."""
    end = _game_end(game)
    if end is None:
        return game["status"] in ("completed", "cancelled")
    grace = timedelta(0) if game["status"] in ("completed", "cancelled") else timedelta(hours=24)
    return _local_now() >= end + grace


async def _is_pay_first(db: aiosqlite.Connection, uid: int) -> bool:
    if (await get_app_setting(db, "pay_first_enabled", "false")) != "true":
        return False
    row = await (await db.execute("SELECT always_prepay FROM users WHERE id = ?", (uid,))).fetchone()
    return bool(row and row["always_prepay"])


async def _add_pay_first_player(db: aiosqlite.Connection, game, uid: int, nominated_by: Optional[int], position: str) -> dict:
    """Pay-first players are held outside the lists until their share is paid."""
    ground_cost = game["ground_cost"] if game["ground_cost"] is not None else game["cost_per_person"] * game["max_players"]
    share = _per_person_amount(ground_cost, game["max_players"], game["max_players"])
    due = share if (await _payment_settings(db, game))["enabled"] else _whole_rupees(share)
    await db.execute(
        "INSERT INTO game_players (game_id, user_id, status, nominated_by, position) VALUES (?, ?, ?, ?, ?)",
        (game["id"], uid, PAY_FIRST_STATUS, nominated_by, position or ""),
    )
    await log_event(db, game["id"], "pay_first", user_id=uid, actor_id=nominated_by)
    await db.execute(
        "INSERT OR IGNORE INTO payments (game_id, user_id, amount) VALUES (?, ?, ?)", (game["id"], uid, due)
    )
    await db.execute(
        "UPDATE payments SET amount = ? WHERE game_id = ? AND user_id = ? AND COALESCE(paid_amount, 0) = 0",
        (due, game["id"], uid),
    )
    await create_notification(
        db, uid, game["id"], "payment_due",
        f"Pay {due:.0f} for {game['title']} to confirm your spot. Your name is added to the list once payment is received."
    )
    return {"status": PAY_FIRST_STATUS, "amount": due,
            "message": f"Payment of {due:.0f} is needed first. The name is added to the list once paid."}


async def _admit_paid_pay_first_player(db: aiosqlite.Connection, game_id: int, uid: int):
    """Move a pay-first player into the game once their payment covers the share."""
    gp = await (await db.execute(
        "SELECT id, status FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, uid)
    )).fetchone()
    if not gp or gp["status"] != PAY_FIRST_STATUS:
        return
    pay = await (await db.execute(
        "SELECT amount, paid_amount FROM payments WHERE game_id = ? AND user_id = ?", (game_id, uid)
    )).fetchone()
    if not pay or (pay["paid_amount"] or 0) < pay["amount"]:
        return
    game = await _get_game(db, game_id)
    count = (await (await db.execute(
        "SELECT COUNT(*) AS cnt FROM game_players WHERE game_id = ? AND status = 'selected'", (game_id,)
    )).fetchone())["cnt"]
    status = "selected" if count < game["max_players"] else "waiting"
    await db.execute("UPDATE game_players SET status = ?, payment_confirmed = 1 WHERE id = ?", (status, gp["id"]))
    await log_event(db, game_id, "admitted", user_id=uid)
    await create_notification(
        db, uid, game_id, "payment_confirmed",
        f"Payment received. You're {'confirmed' if status == 'selected' else 'on the waiting list'} for {game['title']}."
    )
    await _recalc_game_cost(db, game_id)


async def get_game_dict(db: aiosqlite.Connection, game_id: int) -> dict:
    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    # Get players
    cursor = await db.execute(
        """SELECT gp.*, u.name, u.phone, u.display_name, u.gender, u.always_prepay FROM game_players gp 
           JOIN users u ON gp.user_id = u.id 
           WHERE gp.game_id = ? ORDER BY gp.joined_at""",
        (game_id,)
    )
    players_rows = await cursor.fetchall()

    # Build lookup of nominator names/phones
    nominator_ids = {p["nominated_by"] for p in players_rows if p["nominated_by"]}
    nominator_map: dict[int, dict] = {}
    for nid in nominator_ids:
        ncursor = await db.execute("SELECT name, phone FROM users WHERE id = ?", (nid,))
        nrow = await ncursor.fetchone()
        if nrow:
            nominator_map[nid] = {"name": nrow["name"], "phone": nrow["phone"]}

    # Build lookup of sport-specific photos for all players in this game
    sport_type = game["sport_type"].lower() if game["sport_type"] else ""
    player_ids = [p["user_id"] for p in players_rows]
    player_photo_map: dict[int, str] = {}
    if player_ids:
        placeholders = ",".join("?" * len(player_ids))
        # Small icons use the profile photo; a sport photo only when there is no profile photo
        cursor = await db.execute(
            f"SELECT user_id, filename FROM user_photos WHERE user_id IN ({placeholders}) AND purpose = 'profile'",
            tuple(player_ids)
        )
        for row in await cursor.fetchall():
            player_photo_map[row["user_id"]] = row["filename"]
        still_missing = [uid for uid in player_ids if uid not in player_photo_map]
        if still_missing:
            placeholders3 = ",".join("?" * len(still_missing))
            cursor = await db.execute(
                f"SELECT id, profile_pic FROM users WHERE id IN ({placeholders3}) AND profile_pic != ''",
                tuple(still_missing)
            )
            for row in await cursor.fetchall():
                player_photo_map[row["id"]] = row["profile_pic"]
        missing_ids = [uid for uid in player_ids if uid not in player_photo_map]
        if sport_type and missing_ids:
            placeholders2 = ",".join("?" * len(missing_ids))
            cursor = await db.execute(
                f"SELECT user_id, filename FROM user_photos WHERE user_id IN ({placeholders2}) AND purpose = ?",
                (*missing_ids, sport_type)
            )
            for row in await cursor.fetchall():
                player_photo_map.setdefault(row["user_id"], row["filename"])

    selected = []
    waiting = []
    awaiting = []
    for p in players_rows:
        nom_by = p["nominated_by"]
        nom_info = None
        joined_at_str = p["joined_at"] or ""
        # Format joined_at for display
        joined_display = ""
        if joined_at_str:
            try:
                from datetime import datetime as _dt
                jdt = _dt.fromisoformat(joined_at_str.replace("Z", "+00:00"))
                joined_display = jdt.strftime("%-d-%b-%y %-I:%M %p")
            except Exception:
                joined_display = joined_at_str[:16] if len(joined_at_str) > 16 else joined_at_str
        if nom_by:
            if nom_by == p["user_id"]:
                nom_info = f"Self Nominated" + (f" on {joined_display}" if joined_display else "")
            elif nom_by in nominator_map:
                n = nominator_map[nom_by]
                nom_info = f"Nominated by {n['name']}" + (f" on {joined_display}" if joined_display else "")
            else:
                nom_info = f"Nominated by user #{nom_by}" + (f" on {joined_display}" if joined_display else "")
        else:
            nom_info = f"Self Nominated" + (f" on {joined_display}" if joined_display else "")
        player_data = {
            "id": p["id"],
            "user_id": p["user_id"],
            "name": p["name"],
            "display_name": p["display_name"] or "",
            "phone": p["phone"],
            "status": p["status"],
            "position": p["position"] or "",
            "team_id": p["team_id"],
            "payment_confirmed": p["payment_confirmed"],
            "must_prepay": bool(p["must_prepay"]),
            "always_prepay": bool(p["always_prepay"]),
            "played": bool(p["played"]),
            "nominated_by": p["nominated_by"],
            "nominated_by_info": nom_info,
            "nominated_by_name": nominator_map[nom_by]["name"] if nom_by and nom_by != p["user_id"] and nom_by in nominator_map else "",
            "joined_at": p["joined_at"],
            "photo": player_photo_map.get(p["user_id"], ""),
            "gender": p["gender"] or "",
        }
        if p["status"] == "selected":
            selected.append(player_data)
        elif p["status"] == PAY_FIRST_STATUS:
            awaiting.append(player_data)
        else:
            waiting.append(player_data)

    for pd in awaiting:
        pay = await (await db.execute(
            "SELECT amount, paid_amount FROM payments WHERE game_id = ? AND user_id = ?", (game_id, pd["user_id"])
        )).fetchone()
        pd["due"] = max(0, round(pay["amount"] - (pay["paid_amount"] or 0), 2)) if pay else game["cost_per_person"]

    # Get payee info
    payee_info = None
    if game["payee_user_id"]:
        cursor = await db.execute("SELECT id, name, phone FROM users WHERE id = ?", (game["payee_user_id"],))
        payee = await cursor.fetchone()
        if payee:
            payee_info = {"id": payee["id"], "name": payee["name"], "phone": payee["phone"]}

    # Get payment summary for players who actually played/are selected
    cursor = await db.execute(
        """SELECT COUNT(*) as total,
                  COALESCE(SUM(CASE WHEN p.paid_amount >= p.amount THEN 1 ELSE 0 END), 0) as paid,
                  COALESCE(SUM(p.amount), 0) as total_amount,
                  COALESCE(SUM(p.paid_amount), 0) as total_paid_amount
           FROM payments p
           JOIN game_players gp ON p.user_id = gp.user_id AND p.game_id = gp.game_id
           WHERE p.game_id = ? AND (gp.status = 'selected' OR gp.played = 1)""",
        (game_id,)
    )
    pay_summary = await cursor.fetchone()

    # Get POTD using weighted points (1st pref=3pts, 2nd=2pts, 3rd=1pt) consistent with get_potd_results
    cursor = await db.execute(
        """SELECT p.player_id, u.name,
                  SUM(CASE WHEN p.preference = 1 THEN 3
                           WHEN p.preference = 2 THEN 2
                           WHEN p.preference = 3 THEN 1 ELSE 0 END) as points,
                  COUNT(*) as total_votes
           FROM potd_votes p JOIN users u ON p.player_id = u.id 
           WHERE p.game_id = ? GROUP BY p.player_id ORDER BY points DESC, total_votes DESC, p.player_id LIMIT 1""",
        (game_id,)
    )
    potd = await cursor.fetchone()
    potd_info = None
    if potd:
        potd_info = {"player_id": potd["player_id"], "name": potd["name"], "votes": potd["points"] or potd["total_votes"]}

    # Get creator info
    cursor = await db.execute("SELECT name FROM users WHERE id = ?", (game["created_by"],))
    creator = await cursor.fetchone()

    # Get teams
    cursor = await db.execute(
        "SELECT * FROM game_teams WHERE game_id = ? ORDER BY team_order", (game_id,)
    )
    teams_rows = await cursor.fetchall()
    teams = [{"id": t["id"], "team_name": t["team_name"], "team_order": t["team_order"],
              "jersey_color": t["jersey_color"] if "jersey_color" in t.keys() else ""} for t in teams_rows]

    # Get quit_penalty_hours, duration, and potd delay
    quit_penalty_hours = 0
    duration_minutes = 90
    potd_delay_minutes = 1440
    try:
        quit_penalty_hours = game["quit_penalty_hours"] or 0
    except Exception:
        pass
    try:
        duration_minutes = game["duration_minutes"] or 90
    except Exception:
        pass
    try:
        potd_delay_minutes = game["potd_congrats_delay_minutes"] or 1440
    except Exception:
        pass

    is_archived = _game_is_archived(game)

    # Get per-player payment details for players who actually played/are selected
    cursor = await db.execute(
        """SELECT p.user_id, p.status as pay_status, p.amount, p.paid_amount, p.paid_at, p.proof_file, u.name,
                  p.paid_by, p.paid_via, m.name AS paid_by_name
           FROM payments p
           JOIN users u ON p.user_id = u.id
           LEFT JOIN users m ON m.id = p.paid_by
           JOIN game_players gp ON p.user_id = gp.user_id AND p.game_id = gp.game_id
           WHERE p.game_id = ? AND (gp.status = 'selected' OR gp.played = 1)""",
        (game_id,)
    )
    payment_rows = await cursor.fetchall()
    payment_details = [
        {
            "user_id": pr["user_id"],
            "name": pr["name"],
            "status": "paid" if pr["paid_amount"] >= pr["amount"] else "pending",
            "amount": pr["amount"],
            "paid_amount": pr["paid_amount"] or 0,
            "pending": max(0, pr["amount"] - (pr["paid_amount"] or 0)),
            "excess": max(0, round((pr["paid_amount"] or 0) - pr["amount"], 2)),
            "paid_at": pr["paid_at"],
            "paid_by": pr["paid_by"],
            "paid_by_name": pr["paid_by_name"] or "",
            "paid_via": pr["paid_via"] or "",
            "has_proof": bool(pr["proof_file"]),
        }
        for pr in payment_rows
    ]

    # Get game_code safely
    game_code = ""
    try:
        game_code = game["game_code"] or ""
    except Exception:
        pass

    # Calculate ground cost and per-person amount
    pay_settings = await _payment_settings(db, game)
    base_ground_cost = game["ground_cost"] if game["ground_cost"] is not None else (game["cost_per_person"] * game["max_players"])
    selected_count = len(selected)
    base_per_person_amount = _per_person_amount(
        base_ground_cost, selected_count if game["status"] == "completed" else 0, game["max_players"]
    )
    fee_breakdown = online_breakdown(base_per_person_amount, pay_settings) if pay_settings["enabled"] else None
    per_person_amount = fee_breakdown["total"] if fee_breakdown else _whole_rupees(base_per_person_amount)
    ground_cost = online_breakdown(base_ground_cost, pay_settings)["total"] if fee_breakdown else base_ground_cost

    group_name = ""
    if game["moderator_group_id"]:
        group_row = await (await db.execute(
            "SELECT name FROM moderator_groups WHERE id = ?", (game["moderator_group_id"],)
        )).fetchone()
        group_name = group_row["name"] if group_row else ""

    result = {
        "id": game["id"],
        "game_code": game_code,
        "title": game["title"],
        "sport_type": game["sport_type"],
        "ground_name": game["ground_name"],
        "pitch_format": game["pitch_format"],
        "pitch_number": game["pitch_number"],
        "allotment_id": game["allotment_id"],
        "moderator_group_id": game["moderator_group_id"],
        "moderator_group_name": group_name,
        "ground_confirmed": game["allotment_id"] is not None,
        "game_date": game["game_date"],
        "game_time": game["game_time"],
        "max_players": game["max_players"],
        "cost_per_person": game["cost_per_person"],
        "base_ground_cost": base_ground_cost,
        "ground_cost": ground_cost,
        "per_person_amount": per_person_amount,
        "payments_enabled": pay_settings["enabled"],
        "payment_surcharge_percent": pay_settings["surcharge_percent"],
        "payment_gst_percent": pay_settings["gst_percent"],
        "payment_commission_percent": pay_settings["commission_percent"],
        "fee_breakdown": fee_breakdown,
        "base_per_person_amount": base_per_person_amount,
        "online_payment_ready": pay_settings["enabled"] and cashfree.configured()
            and await ground_currency(db, game["ground_name"]) == "₹",
        "payment_timing": game["payment_timing"],
        "payment_collection": game["payment_collection"] or "offline",
        "currency": await ground_currency(db, game["ground_name"]),
        "status": game["status"],
        "payee": payee_info,
        "quit_penalty_hours": quit_penalty_hours,
        "duration_minutes": duration_minutes,
        "potd_congrats_delay_minutes": potd_delay_minutes,
        "allow_position_selection": (await get_app_setting(db, "allow_position_selection", "false")) == "true",
        "show_quit_penalty": (await get_app_setting(db, "show_quit_penalty", "false")) == "true",
        "pay_first_enabled": (await get_app_setting(db, "pay_first_enabled", "false")) == "true",
        "is_archived": is_archived,
        "is_past": _game_has_ended(game),
        "roster_locked": await _roster_locked(db, game),
        "roster_edit_days": int(await get_app_setting(db, "roster_edit_days", "3") or 3),
        "late_quit_hours": await _late_quit_hours(db),
        "late_quit_now": await _is_late_quit(db, game),
        "created_by": game["created_by"],
        "created_by_name": creator["name"] if creator else None,
        "created_at": game["created_at"],
        "selected_players": selected,
        "waiting_list": waiting,
        "awaiting_payment": awaiting,
        "teams": teams,
        "payment_summary": {
            "total": pay_summary["total"] or 0,
            "paid": pay_summary["paid"] or 0,
            "pending": (pay_summary["total"] or 0) - (pay_summary["paid"] or 0),
            "total_amount": pay_summary["total_amount"] or 0,
            "total_paid_amount": pay_summary["total_paid_amount"] or 0,
        },
        "payment_details": payment_details,
        "player_of_the_day": potd_info,
        "game_score": None,
        "goal_scorers": [],
        "note_before_players": game["note_before_players"] if "note_before_players" in game.keys() else "",
        "note_after_players": game["note_after_players"] if "note_after_players" in game.keys() else "",
        "series_name": game["series_name"] if "series_name" in game.keys() else "",
        "series_day": game["series_day"] if "series_day" in game.keys() else "",
    }

    # Add score data if available
    try:
        cursor = await db.execute(
            "SELECT * FROM game_scores WHERE game_id = ?", (game_id,)
        )
        score_row = await cursor.fetchone()
        if score_row:
            # Get team names
            team_a_name = "Team A"
            team_b_name = "Team B"
            if score_row["team_a_id"]:
                tc = await db.execute("SELECT team_name FROM game_teams WHERE id = ?", (score_row["team_a_id"],))
                tr = await tc.fetchone()
                if tr:
                    team_a_name = tr["team_name"]
            if score_row["team_b_id"]:
                tc = await db.execute("SELECT team_name FROM game_teams WHERE id = ?", (score_row["team_b_id"],))
                tr = await tc.fetchone()
                if tr:
                    team_b_name = tr["team_name"]

            result["game_score"] = {
                "team_a_id": score_row["team_a_id"],
                "team_a_name": team_a_name,
                "team_a_score": score_row["team_a_score"],
                "team_b_id": score_row["team_b_id"],
                "team_b_name": team_b_name,
                "team_b_score": score_row["team_b_score"],
            }

        # Get goal scorers
        cursor = await db.execute(
            """SELECT gs.user_id, gs.goals, gs.own_goals, u.name, u.display_name, u.phone
               FROM goal_scorers gs JOIN users u ON gs.user_id = u.id
               WHERE gs.game_id = ? ORDER BY (gs.goals - gs.own_goals) DESC, gs.goals DESC""",
            (game_id,)
        )
        scorer_rows = await cursor.fetchall()
        result["goal_scorers"] = [
            {"user_id": s["user_id"], "name": s["name"], "display_name": s["display_name"] or "", "phone": s["phone"], "goals": s["goals"], "own_goals": s["own_goals"]}
            for s in scorer_rows
        ]
    except Exception:
        pass

    return result


@router.post("")
async def create_game(
    req: CreateGameRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin_or_moderator(user_id, db)

    # Prevent overlapping games on the same ground unless the existing game is cancelled
    slot = await resolve_game_slot(
        db, user_id, req.ground_name, req.sport_type, req.game_date, req.game_time, req.duration_minutes,
        pitch_format=req.pitch_format, pitch_number=req.pitch_number, allotment_id=req.allotment_id,
    )

    # Enforce sport max-player preference cap
    max_cap = await _get_sport_max_players(db, req.sport_type)
    if max_cap is not None and req.max_players > max_cap:
        raise HTTPException(
            status_code=400,
            detail=f"Max players for {req.sport_type} is capped at {max_cap}. {req.max_players} exceeds the configured maximum."
        )

    # Derive payment_timing from payment_mode
    payment_timing = "before" if req.payment_mode == "prepaid" else req.payment_timing

    # Derive per-player cost from total ground cost
    cost_per_person = _per_person_amount(req.ground_cost, 0, req.max_players)

    # Generate unique game code
    from .locations_router import generate_game_code
    game_code = await generate_game_code(db, req.sport_type)

    # Build display code: SC01-Location-Ground
    ground_parts = req.ground_name.replace(' - ', '-').replace(' ', '')
    game_code_display = f"{game_code}-{ground_parts}"

    defaults = await game_defaults(db)
    potd_delay = req.potd_congrats_delay_minutes or defaults["default_potd_delay_minutes"]
    quit_penalty = req.quit_penalty_hours if req.quit_penalty_hours is not None else defaults["default_quit_penalty_hours"]
    if not defaults["show_quit_penalty"]:
        quit_penalty = 0
    payee_id = req.payee_user_id or defaults["default_payee_user_id"]

    series_name = (req.series_name or req.ground_name).strip()
    series_day = (req.series_day or "").strip()
    note_before = (req.note_before_players or "").strip()
    note_after = (req.note_after_players or "").strip()
    cursor = await db.execute(
        """INSERT INTO games (title, game_code, sport_type, ground_name, game_date, game_time,
           max_players, ground_cost, cost_per_person, payment_timing, created_by, duration_minutes,
           payee_user_id, quit_penalty_hours, potd_congrats_delay_minutes, note_before_players, note_after_players, series_name, series_day,
           pitch_format, pitch_number, allotment_id, moderator_group_id, payment_collection)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (req.title, game_code_display, req.sport_type, req.ground_name, req.game_date, req.game_time,
         req.max_players, req.ground_cost, cost_per_person, payment_timing, user_id, req.duration_minutes,
         payee_id, quit_penalty, potd_delay, note_before, note_after, series_name, series_day,
         slot["pitch_format"], slot["pitch_number"], slot["allotment_id"], slot["moderator_group_id"], _check_collection(req.payment_collection))
    )
    game_id = cursor.lastrowid
    await log_event(db, game_id, "created", actor_id=user_id)
    await db.commit()

    return await get_game_dict(db, game_id)


@router.post("/series")
async def create_game_series(
    req: CreateSeriesRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Create multiple game instances for a recurring series.

    For each recurrence day (e.g. Wednesday 20:00, Sunday 19:00), this creates
    `weeks` consecutive weekly game instances on the same ground.
    """
    await require_admin_or_moderator(user_id, db)
    defaults = await game_defaults(db)
    quit_penalty = req.quit_penalty_hours if req.quit_penalty_hours is not None else defaults["default_quit_penalty_hours"]
    if not defaults["show_quit_penalty"]:
        quit_penalty = 0
    payee_id = req.payee_user_id or defaults["default_payee_user_id"]

    day_map = {
        "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
        "friday": 4, "saturday": 5, "sunday": 6,
    }

    start = _local_now()
    if req.start_date:
        try:
            start = datetime.strptime(req.start_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="start_date must be YYYY-MM-DD")

    payment_timing = "before" if req.payment_mode == "prepaid" else "after"

    max_cap = await _get_sport_max_players(db, req.sport_type)
    if max_cap is not None and req.max_players > max_cap:
        raise HTTPException(
            status_code=400,
            detail=f"Max players for {req.sport_type} is capped at {max_cap}. {req.max_players} exceeds the configured maximum."
        )

    series_cost_per_person = _per_person_amount(req.ground_cost, 0, req.max_players)

    from .locations_router import generate_game_code
    created_games = []
    skipped = []

    for rd in req.recurrence_days:
        day_key = rd.day.lower()
        if day_key not in day_map:
            skipped.append({"day": rd.day, "reason": "Invalid day name"})
            continue
        target_wd = day_map[day_key]
        try:
            hour, minute = map(int, rd.time.split(":"))
        except ValueError:
            skipped.append({"day": rd.day, "reason": "time must be HH:MM"})
            continue

        # Find first occurrence on or after start
        days_ahead = (target_wd - start.weekday()) % 7
        first_date = start + timedelta(days=days_ahead)
        # If the first occurrence is before right now on the same day, move to next week
        if first_date.date() < start.date():
            first_date += timedelta(weeks=1)
        first_date = first_date.replace(hour=hour, minute=minute)

        for w in range(req.weeks):
            game_date = first_date + timedelta(weeks=w)
            date_str = game_date.strftime("%Y-%m-%d")
            time_str = game_date.strftime("%H:%M")

            try:
                slot = await resolve_game_slot(
                    db, user_id, req.ground_name, req.sport_type, date_str, time_str, req.duration_minutes,
                    pitch_format=req.pitch_format,
                )
            except HTTPException as e:
                skipped.append({"date": date_str, "time": time_str, "reason": e.detail})
                continue

            game_code = await generate_game_code(db, req.sport_type)
            ground_parts = req.ground_name.replace(' - ', '-').replace(' ', '')
            game_code_display = f"{game_code}-{ground_parts}"
            title = f"{req.series_name} - {rd.day}"

            series_name = req.series_name.strip()
            series_day = rd.day.strip()

            potd_delay = req.potd_congrats_delay_minutes or defaults["default_potd_delay_minutes"]

            note_before = (req.note_before_players or "").strip()
            note_after = (req.note_after_players or "").strip()
            cursor = await db.execute(
                """INSERT INTO games (title, game_code, sport_type, ground_name, game_date, game_time,
                   max_players, ground_cost, cost_per_person, payment_timing, created_by, duration_minutes,
                   payee_user_id, quit_penalty_hours, potd_congrats_delay_minutes, note_before_players, note_after_players, series_name, series_day,
                   pitch_format, pitch_number, allotment_id, moderator_group_id, payment_collection)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (title, game_code_display, req.sport_type, req.ground_name, date_str, time_str,
                 req.max_players, req.ground_cost, series_cost_per_person, payment_timing, user_id, req.duration_minutes,
                 payee_id, quit_penalty, potd_delay, note_before, note_after, series_name, series_day,
                 slot["pitch_format"], slot["pitch_number"], slot["allotment_id"], slot["moderator_group_id"], _check_collection(req.payment_collection))
            )
            await log_event(db, cursor.lastrowid, "created", actor_id=user_id)
            created_games.append(await get_game_dict(db, cursor.lastrowid))

    await db.commit()
    return {"created": created_games, "skipped": skipped}


@router.get("")
async def list_games(
    status: Optional[str] = None,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await _auto_progress_games(db)
    if status:
        cursor = await db.execute("SELECT id FROM games WHERE status = ? ORDER BY game_date DESC, game_time DESC", (status,))
    else:
        cursor = await db.execute("SELECT id FROM games ORDER BY game_date DESC, game_time DESC")
    games = await cursor.fetchall()

    hidden = await _hidden_group_game_ids(db, user_id)
    result = []
    for g in games:
        if g["id"] in hidden:
            continue
        game_data = await get_game_dict(db, g["id"])
        result.append(game_data)
    return result


@router.get("/{game_id:int}")
async def get_game(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await _auto_progress_games(db)
    result = await get_game_dict(db, game_id)
    result["can_moderate"] = await can_moderate_game(user_id, game_id, db)
    result["ground_country_code"] = await _ground_country_code(db, result.get("ground_name") or "")
    result["ground_map_url"] = await _ground_map_url(db, result.get("ground_name") or "")
    sees_contacts = (await (await db.execute(
        "SELECT 1 FROM user_roles WHERE user_id = ? AND role IN ('admin', 'moderator', 'ground_management')",
        (user_id,)
    )).fetchone()) is not None
    if not sees_contacts:
        payee = result.get("payee")
        _mask_phones(result)
        result["payee"] = payee
    return result


async def _ground_country_code(db: aiosqlite.Connection, ground_name: str) -> str:
    parts = ground_name.split(" - ")
    if len(parts) == 2:
        cursor = await db.execute(
            "SELECT country_code FROM grounds WHERE location = ? AND name = ?", (parts[0].strip(), parts[1].strip())
        )
    else:
        cursor = await db.execute("SELECT country_code FROM grounds WHERE name = ?", (ground_name,))
    row = await cursor.fetchone()
    return (row["country_code"] if row else "") or "91"


async def _ground_map_url(db: aiosqlite.Connection, ground_name: str) -> str:
    parts = ground_name.split(" - ")
    if len(parts) == 2:
        cursor = await db.execute(
            "SELECT maps_url, latitude, longitude FROM grounds WHERE location = ? AND name = ?", (parts[0].strip(), parts[1].strip())
        )
    else:
        cursor = await db.execute("SELECT maps_url, latitude, longitude FROM grounds WHERE name = ?", (ground_name,))
    row = await cursor.fetchone()
    if not row:
        return ""
    if row["latitude"] is not None and row["longitude"] is not None:
        return f"https://www.google.com/maps/search/?api=1&query={row['latitude']},{row['longitude']}"
    return row["maps_url"] or ""


def _mask_local(phone: str) -> str:
    """Mask the last 10 digits (keeping any country code) so players only see e.g. 9xxxxxxx01."""
    p = phone.strip()
    if len(p) < 4:
        return p
    local = p[-10:] if len(p) >= 10 else p
    return p[:len(p) - len(local)] + local[0] + "x" * (len(local) - 3) + local[-2:]


def _mask_phones(obj):
    """Only admins, moderators and ground management may see other players' full phone numbers."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "phone" and isinstance(v, str):
                obj[k] = _mask_local(v)
            else:
                _mask_phones(v)
    elif isinstance(obj, list):
        for v in obj:
            _mask_phones(v)


async def _edit_completed_game(db: aiosqlite.Connection, game: aiosqlite.Row, req: "EditGameRequest"):
    """After a game is completed only the payment receiver and ground cost can change; shares are re-split
    among the players who played, leaving any excess or deficit against what each player already paid."""
    game_id = game["id"]
    if req.payee_user_id is not None:
        await db.execute("UPDATE games SET payee_user_id = ? WHERE id = ?", (req.payee_user_id, game_id))
    if req.ground_cost is not None and req.ground_cost != game["ground_cost"]:
        await db.execute("UPDATE games SET ground_cost = ? WHERE id = ?", (req.ground_cost, game_id))
        await _recalc_game_cost(db, game_id)
        await _notify_share_change(db, game, "Ground cost")
    await db.commit()
    return await get_game_dict(db, game_id)


async def _notify_share_change(db: aiosqlite.Connection, game: aiosqlite.Row, reason: str):
    """Tell players who already paid that their share changed, with the excess or deficit."""
    game_id = game["id"]
    rows = await (await db.execute(
        "SELECT p.user_id, p.amount, COALESCE(p.paid_amount, 0) AS paid FROM payments p "
        "JOIN game_players gp ON gp.game_id = p.game_id AND gp.user_id = p.user_id "
        "WHERE p.game_id = ? AND gp.played = 1", (game_id,)
    )).fetchall()
    for r in rows:
        if r["paid"] <= 0:
            continue
        diff = round(r["paid"] - r["amount"], 2)
        if diff > 0:
            note = f"You paid {r['paid']:.0f}; the excess {diff:.0f} will be adjusted by the moderator."
        elif diff < 0:
            note = f"You paid {r['paid']:.0f}; please pay the remaining {-diff:.0f}."
        else:
            continue
        await db.execute(
            "INSERT INTO notifications (user_id, game_id, type, message) VALUES (?, ?, 'payment_update', ?)",
            (r["user_id"], game_id,
             f"{reason} for {game['title']} changed. Your share is now {r['amount']:.0f}. {note}")
        )


async def _add_to_completed_game(db: aiosqlite.Connection, game: aiosqlite.Row, player_id: int, moderator_id: int):
    """A player who turned up (late or from the waiting list) is added as played, even beyond max players;
    the same ground cost is re-split among everyone who played."""
    game_id = game["id"]
    if await _roster_locked(db, game):
        raise HTTPException(status_code=400, detail=ROSTER_LOCKED_DETAIL.format(await get_app_setting(db, "roster_edit_days", "3")))
    if not await (await db.execute("SELECT 1 FROM users WHERE id = ?", (player_id,))).fetchone():
        raise HTTPException(status_code=404, detail="User not found")
    existing = await (await db.execute(
        "SELECT id, played FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, player_id)
    )).fetchone()
    if existing and existing["played"]:
        raise HTTPException(status_code=400, detail="Player already marked as played")
    if existing:
        await db.execute("UPDATE game_players SET status = 'selected', played = 1 WHERE id = ?", (existing["id"],))
    else:
        await db.execute(
            "INSERT INTO game_players (game_id, user_id, status, played, nominated_by) VALUES (?, ?, 'selected', 1, ?)",
            (game_id, player_id, moderator_id)
        )
    await db.execute(
        "INSERT OR IGNORE INTO payments (game_id, user_id, amount) VALUES (?, ?, ?)",
        (game_id, player_id, game["cost_per_person"])
    )
    await log_event(db, game_id, "played_added", user_id=player_id, actor_id=moderator_id)
    await _recalc_game_cost(db, game_id)
    await _notify_share_change(db, game, "Number of players")
    share = (await (await db.execute(
        "SELECT amount FROM payments WHERE game_id = ? AND user_id = ?", (game_id, player_id)
    )).fetchone())["amount"]
    await db.execute(
        "INSERT INTO notifications (user_id, game_id, type, message) VALUES (?, ?, 'payment_update', ?)",
        (player_id, game_id, f"You were added to {game['title']} as a player. Your share is {_whole_rupees(share):.0f}.")
    )
    await db.commit()
    return await get_game_dict(db, game_id)


@router.put("/{game_id}")
async def edit_game(
    game_id: int,
    req: EditGameRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_game_moderator(user_id, game_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Cannot edit a cancelled game")
    if game["status"] == "completed":
        return await _edit_completed_game(db, game, req)

    updates: list[str] = []
    params: list = []

    # Enforce sport max-player preference cap on edit
    final_sport = req.sport_type if req.sport_type is not None else game["sport_type"]
    final_max = req.max_players if req.max_players is not None else game["max_players"]
    max_cap = await _get_sport_max_players(db, final_sport)
    if max_cap is not None and final_max > max_cap:
        raise HTTPException(
            status_code=400,
            detail=f"Max players for {final_sport} is capped at {max_cap}. {final_max} exceeds the configured maximum."
        )

    for field in ("title", "sport_type", "ground_name", "game_date", "game_time",
                  "max_players", "ground_cost", "cost_per_person", "duration_minutes",
                  "payee_user_id", "quit_penalty_hours", "potd_congrats_delay_minutes",
                  "note_before_players", "note_after_players",
                  "series_name", "series_day"):
        val = getattr(req, field, None)
        if val is not None:
            if field in ("series_name", "series_day", "note_before_players", "note_after_players"):
                val = str(val).strip()
            updates.append(f"{field} = ?")
            params.append(val)

    if req.payment_mode is not None:
        new_timing = "before" if req.payment_mode == "prepaid" else "after"
        updates.append("payment_timing = ?")
        params.append(new_timing)

    if req.payment_collection is not None:
        updates.append("payment_collection = ?")
        params.append(_check_collection(req.payment_collection))

    pitch_changed = req.pitch_format is not None or req.pitch_number is not None
    if not updates and not pitch_changed:
        return await get_game_dict(db, game_id)

    # Prevent moving a game into an occupied time slot on the same ground
    final_ground = req.ground_name if req.ground_name is not None else game["ground_name"]
    final_date = req.game_date if req.game_date is not None else game["game_date"]
    final_time = req.game_time if req.game_time is not None else game["game_time"]
    final_duration = req.duration_minutes if req.duration_minutes is not None else game["duration_minutes"]
    final_pitch = req.pitch_format if req.pitch_format is not None else game["pitch_format"]
    final_number = req.pitch_number if req.pitch_number is not None else (
        game["pitch_number"] if req.pitch_format is None else None
    )
    slot = await resolve_game_slot(
        db, game["created_by"], final_ground, final_sport, final_date, final_time, final_duration,
        pitch_format=final_pitch, pitch_number=final_number, exclude_game_id=game_id,
    )
    updates.extend(["pitch_format = ?", "pitch_number = ?", "allotment_id = ?", "moderator_group_id = ?"])
    params.extend([slot["pitch_format"], slot["pitch_number"], slot["allotment_id"], slot["moderator_group_id"]])

    params.append(game_id)
    await db.execute(f"UPDATE games SET {', '.join(updates)} WHERE id = ?", params)

    # Recompute selected/waiting if max_players changed
    if req.max_players is not None:
        cursor2 = await db.execute(
            "SELECT id, user_id FROM game_players WHERE game_id = ? AND status = 'selected' ORDER BY joined_at DESC",
            (game_id,)
        )
        selected = await cursor2.fetchall()
        if len(selected) > req.max_players:
            for row in selected[:len(selected) - req.max_players]:
                await db.execute("UPDATE game_players SET status = 'waiting' WHERE id = ?", (row["id"],))
                await log_event(db, game_id, "demoted", user_id=row["user_id"], actor_id=user_id)
                await db.execute("DELETE FROM payments WHERE game_id = ? AND user_id = ?", (game_id, row["user_id"]))

    # Recalculate per-player cost and payment records after any relevant change
    if req.ground_cost is not None or req.max_players is not None or req.cost_per_person is not None:
        await _recalc_game_cost(db, game_id)

    await db.commit()
    return await get_game_dict(db, game_id)


@router.post("/{game_id}/open-voting")
async def open_voting(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_game_moderator(user_id, game_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] != "draft":
        raise HTTPException(status_code=400, detail="Can only open voting for draft games")
    if _game_has_ended(game):
        raise HTTPException(status_code=400, detail="This game's time is over")

    await db.execute("UPDATE games SET status = 'voting_open' WHERE id = ?", (game_id,))

    # Notify all users
    cursor = await db.execute("SELECT id FROM users")
    all_users = await cursor.fetchall()
    for u in all_users:
        await create_notification(
            db, u["id"], game_id, "voting_opened",
            f"Nominations are open for {game['title']} at {game['ground_name']} on {game['game_date']} at {game['game_time']}. Join now!"
        )

    await db.commit()
    return await get_game_dict(db, game_id)


@router.post("/{game_id}/vote")
async def vote_join_game(
    game_id: int,
    req: Optional[VoteJoinRequest] = None,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    position = req.position if req else ""
    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] != "voting_open":
        raise HTTPException(status_code=400, detail="Voting is not open for this game")

    # Check if user is disabled
    try:
        dis_cursor = await db.execute("SELECT is_disabled FROM users WHERE id = ?", (user_id,))
        dis_row = await dis_cursor.fetchone()
        if dis_row and dis_row["is_disabled"]:
            raise HTTPException(status_code=403, detail="Your account has been disabled. You cannot join games.")
    except HTTPException:
        raise
    except Exception:
        pass

    # Check if user is blocked for this ground
    ground_name = game["ground_name"]
    try:
        parts = ground_name.split(" - ")
        if len(parts) == 2:
            gnd_cursor = await db.execute(
                "SELECT id FROM grounds WHERE location = ? AND name = ?",
                (parts[0].strip(), parts[1].strip())
            )
        else:
            gnd_cursor = await db.execute("SELECT id FROM grounds WHERE name = ?", (ground_name,))
        gnd_row = await gnd_cursor.fetchone()
        if gnd_row:
            block_cursor = await db.execute(
                "SELECT 1 FROM blocked_ground_users WHERE user_id = ? AND ground_id = ?",
                (user_id, gnd_row["id"])
            )
            if await block_cursor.fetchone():
                raise HTTPException(status_code=403, detail="You have been blocked from this ground by a moderator.")
    except HTTPException:
        raise
    except Exception:
        pass

    # Check if already joined
    cursor = await db.execute("SELECT id FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, user_id))
    if await cursor.fetchone():
        raise HTTPException(status_code=400, detail="Already joined this game")

    # Check nomination limit for this user on this ground
    try:
        # Find the ground_id from ground_name
        parts = ground_name.split(" - ")
        if len(parts) == 2:
            gnd_cursor = await db.execute(
                "SELECT id FROM grounds WHERE location = ? AND name = ?",
                (parts[0].strip(), parts[1].strip())
            )
        else:
            gnd_cursor = await db.execute("SELECT id FROM grounds WHERE name = ?", (ground_name,))
        gnd_row = await gnd_cursor.fetchone()
        if gnd_row:
            mem_cursor = await db.execute(
                "SELECT max_nominations FROM ground_members WHERE user_id = ? AND ground_id = ?",
                (user_id, gnd_row["id"])
            )
            mem_row = await mem_cursor.fetchone()
            if mem_row and mem_row["max_nominations"] and mem_row["max_nominations"] > 0:
                # Count how many players this user has nominated (including self) in this game
                nom_cursor = await db.execute(
                    "SELECT COUNT(*) as cnt FROM game_players WHERE game_id = ? AND (nominated_by = ? OR (user_id = ? AND nominated_by IS NULL))",
                    (game_id, user_id, user_id)
                )
                nom_count = (await nom_cursor.fetchone())["cnt"]
                if nom_count >= mem_row["max_nominations"]:
                    raise HTTPException(
                        status_code=400,
                        detail=f"You can only nominate up to {mem_row['max_nominations']} players (including yourself) for games on this ground"
                    )
    except HTTPException:
        raise
    except Exception:
        pass  # If ground lookup fails, allow the nomination

    if await _is_pay_first(db, user_id):
        result = await _add_pay_first_player(db, game, user_id, None, position)
        await db.commit()
        return {**result, "is_prepaid": True, "is_first_time_on_ground": False}

    # Count selected players
    cursor = await db.execute("SELECT COUNT(*) as cnt FROM game_players WHERE game_id = ? AND status = 'selected'", (game_id,))
    count_row = await cursor.fetchone()
    selected_count = count_row["cnt"]

    player_status = "selected" if selected_count < game["max_players"] else "waiting"

    # Check if game is prepaid - require payment confirmation before confirming
    is_prepaid = game["payment_timing"] == "before"
    payment_confirmed = 0

    # Check if first-time user on this ground for PostPaid games
    is_first_time_on_ground = False
    if game["payment_timing"] == "after":
        ground_name = game["ground_name"]
        # Check if user has played any completed game on this ground before
        # Use exact match on full ground_name and also match the "Location - Ground" format
        # to handle cases where ground_name format changed over time
        query_params = [user_id, ground_name]
        like_clause = ""
        if ' - ' in ground_name:
            # Extract both location and ground parts for precise matching
            location_part = ground_name.split(' - ')[0]
            ground_part = ground_name.split(' - ')[-1]
            escaped_location = location_part.replace('%', '\\%').replace('_', '\\_')
            escaped_ground = ground_part.replace('%', '\\%').replace('_', '\\_')
            like_clause = " OR g.ground_name LIKE ? ESCAPE '\\'"
            query_params.append(f"{escaped_location} - {escaped_ground}")
        prev_cursor = await db.execute(
            f"""SELECT g.id FROM games g
               JOIN game_players gp ON g.id = gp.game_id
               WHERE gp.user_id = ? AND g.status = 'completed'
               AND gp.status = 'selected'
               AND (g.ground_name = ?{like_clause})
               LIMIT 1""",
            query_params
        )
        if not await prev_cursor.fetchone():
            is_first_time_on_ground = True

    await db.execute(
        "INSERT INTO game_players (game_id, user_id, status, position, payment_confirmed) VALUES (?, ?, ?, ?, ?)",
        (game_id, user_id, player_status, position, payment_confirmed)
    )
    await log_event(db, game_id, "joined" if player_status == "selected" else "waiting", user_id=user_id, actor_id=user_id)

    # If payment is before and player is selected, create payment record
    if player_status == "selected" and is_prepaid:
        await db.execute(
            "INSERT OR IGNORE INTO payments (game_id, user_id, amount) VALUES (?, ?, ?)",
            (game_id, user_id, game["cost_per_person"])
        )

    # For first-time PostPaid users, create deposit payment record
    if is_first_time_on_ground and player_status == "selected":
        await db.execute(
            "INSERT OR IGNORE INTO payments (game_id, user_id, amount) VALUES (?, ?, ?)",
            (game_id, user_id, game["cost_per_person"])
        )

    await _recalc_game_cost(db, game_id)
    await db.commit()
    msg = f"You are {'selected' if player_status == 'selected' else 'on the waiting list'}"
    if is_prepaid and player_status == "selected":
        msg += ". Please complete payment to confirm your spot."
    if is_first_time_on_ground and player_status == "selected":
        msg += ". As this is your first time on this ground, please pay in advance even though this is a PostPaid game."
    return {"status": player_status, "message": msg, "is_prepaid": is_prepaid, "is_first_time_on_ground": is_first_time_on_ground}


@router.delete("/{game_id}/vote")
async def quit_game(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    return await _quit_game(game_id, user_id, db, by_moderator=await _is_game_moderator(user_id, game_id, db),
                            actor_id=user_id)


async def _quit_game(game_id: int, user_id: int, db: aiosqlite.Connection, by_moderator: bool = False,
                     actor_id: Optional[int] = None):
    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] not in ("draft", "voting_open", "in_progress"):
        raise HTTPException(status_code=400, detail="Cannot quit at this stage")

    cursor = await db.execute("SELECT * FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, user_id))
    player = await cursor.fetchone()
    if not player:
        raise HTTPException(status_code=400, detail="Not in this game")
    if await _paid_player_names(db, game_id, [user_id]):
        raise HTTPException(status_code=400, detail="This player has already paid for this game, so their name can't be removed")

    was_selected = player["status"] == "selected"
    old_team_id = player["team_id"]
    must_pay = False
    late = was_selected and await _is_late_quit(db, game)
    if late and not by_moderator:
        raise HTTPException(status_code=400, detail=LATE_QUIT_DETAIL)
    if late:
        waiting = await (await db.execute(
            "SELECT 1 FROM game_players WHERE game_id = ? AND status = 'waiting' LIMIT 1", (game_id,)
        )).fetchone()
        must_pay = waiting is None

    # Check quit penalty
    quit_penalty_hours = 0
    try:
        quit_penalty_hours = game["quit_penalty_hours"] or 0
    except Exception:
        pass

    if quit_penalty_hours > 0 and was_selected and not late:
        # Check if within penalty window.
        # Design: if the game is already in_progress (hours_until_game < 0),
        # penalty still applies — quitting a live game should require payment.
        # Only skip penalty when hours_until_game >= quit_penalty_hours (early quit).
        try:
            game_dt_str = f"{game['game_date']} {game['game_time']}"
            game_dt = datetime.strptime(game_dt_str, "%Y-%m-%d %H:%M")
            hours_until_game = (game_dt - _local_now()).total_seconds() / 3600
            if hours_until_game < quit_penalty_hours:
                must_pay = True
        except Exception:
            pass

    if must_pay:
        # Don't remove payment record - user must still pay
        # Remove from game players but keep payment obligation
        await db.execute("DELETE FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, user_id))
        # Ensure payment record exists
        await db.execute(
            "INSERT OR IGNORE INTO payments (game_id, user_id, amount) VALUES (?, ?, ?)",
            (game_id, user_id, game["cost_per_person"])
        )
    else:
        # Remove player
        await db.execute("DELETE FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, user_id))
        # Remove payment record if exists
        await db.execute("DELETE FROM payments WHERE game_id = ? AND user_id = ?", (game_id, user_id))

    if actor_id is not None and actor_id != user_id:
        await log_event(db, game_id, "removed", user_id=user_id, actor_id=actor_id, note="pays" if must_pay else "")
    else:
        kind = "quit" if was_selected else "quit_waiting"
        await log_event(db, game_id, kind, user_id=user_id, actor_id=user_id, note="pays" if must_pay else "")

    # If was selected, promote first waiting player
    if was_selected:
        cursor = await db.execute(
            "SELECT * FROM game_players WHERE game_id = ? AND status = 'waiting' ORDER BY joined_at LIMIT 1",
            (game_id,)
        )
        next_player = await cursor.fetchone()
        if next_player:
            await db.execute(
                "UPDATE game_players SET status = 'selected' WHERE id = ?",
                (next_player["id"],)
            )
            await log_event(db, game_id, "promoted", user_id=next_player["user_id"])
            # If player who quit had a team, assign promoted player to that team
            if old_team_id:
                await db.execute(
                    "UPDATE game_players SET team_id = ? WHERE id = ?",
                    (old_team_id, next_player["id"])
                )
            # Create payment record for promoted player if payment is before
            if game["payment_timing"] == "before":
                await db.execute(
                    "INSERT OR IGNORE INTO payments (game_id, user_id, amount) VALUES (?, ?, ?)",
                    (game_id, next_player["user_id"], game["cost_per_person"])
                )

            # Check if promoted player is first-time on this ground for PostPaid games
            if game["payment_timing"] == "after":
                ground_name = game["ground_name"]
                ft_params = [next_player["user_id"], ground_name]
                ft_like = ""
                if ' - ' in ground_name:
                    loc_part = ground_name.split(' - ')[0]
                    gnd_part = ground_name.split(' - ')[-1]
                    esc_loc = loc_part.replace('%', '\\%').replace('_', '\\_')
                    esc_gnd = gnd_part.replace('%', '\\%').replace('_', '\\_')
                    ft_like = " OR g.ground_name LIKE ? ESCAPE '\\'"
                    ft_params.append(f"{esc_loc} - {esc_gnd}")
                ft_cursor = await db.execute(
                    f"""SELECT g.id FROM games g
                       JOIN game_players gp ON g.id = gp.game_id
                       WHERE gp.user_id = ? AND g.status = 'completed'
                       AND gp.status = 'selected'
                       AND (g.ground_name = ?{ft_like})
                       LIMIT 1""",
                    ft_params
                )
                if not await ft_cursor.fetchone():
                    await db.execute(
                        "INSERT OR IGNORE INTO payments (game_id, user_id, amount) VALUES (?, ?, ?)",
                        (game_id, next_player["user_id"], game["cost_per_person"])
                    )

            # Notify promoted player
            await create_notification(
                db, next_player["user_id"], game_id, "promoted",
                f"You've been promoted from the waiting list for {game['title']}!"
            )

    await _recalc_game_cost(db, game_id)
    await db.commit()
    if must_pay:
        return {"message": "You have quit the game but must still pay as it is within the penalty window.", "must_pay": True}
    return {"message": "You have quit the game", "must_pay": False}


@router.delete("/{game_id}/players/{player_user_id}")
async def remove_player(
    game_id: int,
    player_user_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Players can remove themselves or someone they nominated; moderators can remove anyone."""
    game = await _get_game(db, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    row = await (await db.execute(
        "SELECT nominated_by FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, player_user_id)
    )).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail="Player is not in this game")
    is_mod = await _is_game_moderator(user_id, game_id, db)
    if not is_mod and player_user_id != user_id and row["nominated_by"] != user_id:
        await require_game_moderator(user_id, game_id, db)
    result = await _quit_game(game_id, player_user_id, db, by_moderator=is_mod, actor_id=user_id)
    if player_user_id != user_id:
        remover = await (await db.execute("SELECT name FROM users WHERE id = ?", (user_id,))).fetchone()
        await create_notification(
            db, player_user_id, game_id, "removed",
            f"{remover['name'] if remover else 'A moderator'} removed you from {game['title']}."
        )
        await db.commit()
        result = {**result, "message": "Player removed from the game"}
    return result


@router.post("/{game_id}/nominate")
async def nominate_player(
    game_id: int,
    req: NominateRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_game_moderator(user_id, game_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] == "completed":
        return await _add_to_completed_game(db, game, req.user_id, user_id)
    if game["status"] not in ("draft", "voting_open", "in_progress"):
        raise HTTPException(status_code=400, detail="Players can only be added to games that are draft, open for nomination, in progress or completed")

    # Check if user exists
    cursor = await db.execute("SELECT id FROM users WHERE id = ?", (req.user_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="User not found")

    # Check if nominated user is disabled
    try:
        dis_cursor = await db.execute("SELECT is_disabled FROM users WHERE id = ?", (req.user_id,))
        dis_row = await dis_cursor.fetchone()
        if dis_row and dis_row["is_disabled"]:
            raise HTTPException(status_code=400, detail="Cannot nominate a disabled user.")
    except HTTPException:
        raise
    except Exception:
        pass

    # Check if nominated user is blocked for this ground
    ground_name = game["ground_name"]
    try:
        parts = ground_name.split(" - ")
        if len(parts) == 2:
            gnd_cursor = await db.execute(
                "SELECT id FROM grounds WHERE location = ? AND name = ?",
                (parts[0].strip(), parts[1].strip())
            )
        else:
            gnd_cursor = await db.execute("SELECT id FROM grounds WHERE name = ?", (ground_name,))
        gnd_row = await gnd_cursor.fetchone()
        if gnd_row:
            block_cursor = await db.execute(
                "SELECT 1 FROM blocked_ground_users WHERE user_id = ? AND ground_id = ?",
                (req.user_id, gnd_row["id"])
            )
            if await block_cursor.fetchone():
                raise HTTPException(status_code=400, detail="This user is blocked from this ground.")
    except HTTPException:
        raise
    except Exception:
        pass

    # Check if already joined - if waiting and a spot opened up, promote to selected
    cursor = await db.execute("SELECT id, status FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, req.user_id))
    existing = await cursor.fetchone()
    if existing:
        if existing["status"] == "waiting":
            count_cursor = await db.execute("SELECT COUNT(*) as cnt FROM game_players WHERE game_id = ? AND status = 'selected'", (game_id,))
            selected_count = (await count_cursor.fetchone())["cnt"]
            if selected_count < game["max_players"]:
                await db.execute(
                    "UPDATE game_players SET status = 'selected' WHERE id = ?",
                    (existing["id"],)
                )
                await db.execute(
                    "INSERT OR IGNORE INTO payments (game_id, user_id, amount) VALUES (?, ?, ?)",
                    (game_id, req.user_id, game["cost_per_person"])
                )
                await log_event(db, game_id, "promoted", user_id=req.user_id, actor_id=user_id)
                await db.commit()
                return {"status": "selected", "message": "User promoted to selected"}
        raise HTTPException(status_code=400, detail="User already in this game")

    # Check nomination limit for the nominator on this ground
    try:
        parts = ground_name.split(" - ")
        if len(parts) == 2:
            gnd_cursor = await db.execute(
                "SELECT id FROM grounds WHERE location = ? AND name = ?",
                (parts[0].strip(), parts[1].strip())
            )
        else:
            gnd_cursor = await db.execute("SELECT id FROM grounds WHERE name = ?", (ground_name,))
        gnd_row = await gnd_cursor.fetchone()
        if gnd_row:
            mem_cursor = await db.execute(
                "SELECT max_nominations FROM ground_members WHERE user_id = ? AND ground_id = ?",
                (user_id, gnd_row["id"])
            )
            mem_row = await mem_cursor.fetchone()
            if mem_row and mem_row["max_nominations"] and mem_row["max_nominations"] > 0:
                nom_cursor = await db.execute(
                    "SELECT COUNT(*) as cnt FROM game_players WHERE game_id = ? AND (nominated_by = ? OR (user_id = ? AND nominated_by IS NULL))",
                    (game_id, user_id, user_id)
                )
                nom_count = (await nom_cursor.fetchone())["cnt"]
                if nom_count >= mem_row["max_nominations"]:
                    raise HTTPException(
                        status_code=400,
                        detail=f"This user can only nominate up to {mem_row['max_nominations']} players (including themselves) for games on this ground"
                    )
    except HTTPException:
        raise
    except Exception:
        pass

    if await _is_pay_first(db, req.user_id):
        result = await _add_pay_first_player(db, game, req.user_id, user_id, req.position)
        await db.commit()
        return result

    # Count selected
    cursor = await db.execute("SELECT COUNT(*) as cnt FROM game_players WHERE game_id = ? AND status = 'selected'", (game_id,))
    count_row = await cursor.fetchone()
    selected_count = count_row["cnt"]

    player_status = "selected" if selected_count < game["max_players"] else "waiting"

    await db.execute(
        "INSERT INTO game_players (game_id, user_id, status, nominated_by, position) VALUES (?, ?, ?, ?, ?)",
        (game_id, req.user_id, player_status, user_id, req.position)
    )
    if req.user_id == user_id:
        kind = "joined" if player_status == "selected" else "waiting"
    else:
        kind = "nominated" if player_status == "selected" else "nominated_waiting"
    await log_event(db, game_id, kind, user_id=req.user_id, actor_id=user_id)

    # Always create a payment record for selected players (recalculates outstanding)
    if player_status == "selected":
        await db.execute(
            "INSERT OR IGNORE INTO payments (game_id, user_id, amount) VALUES (?, ?, ?)",
            (game_id, req.user_id, game["cost_per_person"])
        )

    # Notify nominated user only if the game is already open
    if game["status"] == "voting_open":
        await create_notification(
            db, req.user_id, game_id, "nominated",
            f"You've been nominated for {game['title']} at {game['ground_name']}!"
        )

    await _recalc_game_cost(db, game_id)
    await db.commit()
    return {"status": player_status, "message": f"User nominated as {player_status}"}


@router.post("/{game_id}/players/{player_user_id}/prepay")
async def set_player_prepay(
    game_id: int,
    player_user_id: int,
    req: PlayerPrepayRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Moderator marks a player as having to pay before the game (this game, or always)."""
    await require_game_moderator(user_id, game_id, db)
    game = await _get_game(db, game_id)
    cursor = await db.execute(
        "SELECT id FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, player_user_id)
    )
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Player is not in this game")
    await db.execute(
        "UPDATE game_players SET must_prepay = ? WHERE game_id = ? AND user_id = ?",
        (1 if req.must_prepay else 0, game_id, player_user_id),
    )
    if req.always is not None:
        await db.execute(
            "UPDATE users SET always_prepay = ? WHERE id = ?", (1 if req.always else 0, player_user_id)
        )
    if req.must_prepay or req.always:
        await create_notification(
            db, player_user_id, game_id, "payment_due",
            f"Please pay {game['cost_per_person']:.0f} for {game['title']} before the game starts."
        )
    await db.commit()
    return {"message": "Saved"}


async def _start_game(db: aiosqlite.Connection, game):
    game_id = game["id"]
    cur = await db.execute("UPDATE games SET status = 'in_progress' WHERE id = ? AND status = 'voting_open'", (game_id,))
    if cur.rowcount == 0:
        return await get_game_dict(db, game_id)
    await log_event(db, game_id, "started", at_local=_game_start(game))

    # Recompute cost per player before creating payment records
    await _recalc_game_cost(db, game_id)

    # Create payment records for all selected players
    cursor = await db.execute(
        """SELECT gp.user_id, gp.must_prepay, u.always_prepay FROM game_players gp
           JOIN users u ON u.id = gp.user_id
           WHERE gp.game_id = ? AND gp.status = 'selected'""",
        (game_id,)
    )
    selected = await cursor.fetchall()
    payee_info = None
    if game["payee_user_id"]:
        pcursor = await db.execute("SELECT name, phone FROM users WHERE id = ?", (game["payee_user_id"],))
        payee_info = await pcursor.fetchone()

    for p in selected:
        await db.execute(
            "INSERT OR IGNORE INTO payments (game_id, user_id, amount) VALUES (?, ?, ?)",
            (game_id, p["user_id"], game["cost_per_person"])
        )
        pays_first = game["payment_timing"] == "before" or p["must_prepay"]
        if pays_first and payee_info:
            await create_notification(
                db, p["user_id"], game_id, "payment_due",
                f"Payment of {game['cost_per_person']} is due for {game['title']}. Pay to {payee_info['name']} ({payee_info['phone']})"
            )

    await db.commit()
    return await get_game_dict(db, game_id)


@router.post("/{game_id}/start")
async def start_game(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Start a game. Payee, quit_penalty, and payment_mode are already set
    at create/edit time — this endpoint just transitions the status."""
    await require_game_moderator(user_id, game_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] != "voting_open":
        raise HTTPException(status_code=400, detail="Can only start a game that has open voting")

    return await _start_game(db, game)


async def _complete_game(db: aiosqlite.Connection, game, req: CompleteGameRequest):
    game_id = game["id"]
    # For soccer games, validate and store scores
    if game["sport_type"] == "soccer" and req.team_a_score is not None and req.team_b_score is not None:
        total_goals = req.team_a_score + req.team_b_score

        # Validate goal scorers if provided
        if req.goal_scorers:
            total_attributed = sum(gs["goals"] for gs in req.goal_scorers)
            if total_attributed > total_goals:
                raise HTTPException(
                    status_code=400,
                    detail=f"Total attributed goals ({total_attributed}) cannot exceed total game goals ({total_goals})"
                )

        # Get team info
        cursor = await db.execute(
            "SELECT * FROM game_teams WHERE game_id = ? ORDER BY team_order", (game_id,)
        )
        teams = await cursor.fetchall()
        team_a_id = teams[0]["id"] if len(teams) > 0 else None
        team_b_id = teams[1]["id"] if len(teams) > 1 else None

        # Store game score
        await db.execute(
            """INSERT OR REPLACE INTO game_scores (game_id, team_a_id, team_a_score, team_b_id, team_b_score)
               VALUES (?, ?, ?, ?, ?)""",
            (game_id, team_a_id, req.team_a_score, team_b_id, req.team_b_score)
        )

        # Store goal scorers
        if req.goal_scorers:
            await db.execute("DELETE FROM goal_scorers WHERE game_id = ?", (game_id,))
            for gs in req.goal_scorers:
                if gs["goals"] > 0:
                    await db.execute(
                        "INSERT INTO goal_scorers (game_id, user_id, goals) VALUES (?, ?, ?)",
                        (game_id, gs["user_id"], gs["goals"])
                    )

    cur = await db.execute("UPDATE games SET status = 'completed' WHERE id = ? AND status = 'in_progress'", (game_id,))
    if cur.rowcount == 0:
        return await get_game_dict(db, game_id)
    await log_event(db, game_id, "completed", at_local=_game_end(game))

    # Determine who actually played. Defaults to currently selected players for backward compatibility.
    cursor = await db.execute("SELECT user_id, status FROM game_players WHERE game_id = ?", (game_id,))
    all_players = await cursor.fetchall()
    all_player_ids = {p["user_id"] for p in all_players}

    if req.played_user_ids is not None:
        played_user_ids = [uid for uid in req.played_user_ids if uid in all_player_ids]
    else:
        played_user_ids = [p["user_id"] for p in all_players if p["status"] == "selected"]

    if not played_user_ids:
        raise HTTPException(status_code=400, detail="At least one player must have played to complete the game")

    played_set = set(played_user_ids)
    paid_dropped = await _paid_player_names(
        db, game_id, [p["user_id"] for p in all_players if p["status"] == "selected" and p["user_id"] not in played_set]
    )
    if paid_dropped:
        raise HTTPException(status_code=400, detail=f"Already paid, so they must stay as played: {', '.join(paid_dropped)}")

    # Mark played players as selected and unplayed as waiting/not played.
    # payment_confirmed is reset only for unplayed players.
    await db.execute(
        """UPDATE game_players
           SET status = CASE WHEN user_id IN ({}) THEN 'selected' ELSE 'waiting' END,
               played = CASE WHEN user_id IN ({}) THEN 1 ELSE 0 END,
               payment_confirmed = CASE WHEN user_id IN ({}) THEN payment_confirmed ELSE 0 END
           WHERE game_id = ?""".format(
            ",".join("?" * len(played_user_ids)),
            ",".join("?" * len(played_user_ids)),
            ",".join("?" * len(played_user_ids))
        ),
        (*played_user_ids, *played_user_ids, *played_user_ids, game_id)
    )

    # Remove pending payment obligations for unplayed players.
    unplayed_ids = [uid for uid in all_player_ids if uid not in played_set]
    if unplayed_ids:
        placeholders = ",".join("?" * len(unplayed_ids))
        await db.execute(
            f"DELETE FROM payments WHERE game_id = ? AND user_id IN ({placeholders}) AND status = 'pending'",
            (game_id, *unplayed_ids)
        )

    # Recalculate per-player cost based on the actual number of players who played.
    await _recalc_game_cost(db, game_id)

    # Get payee info
    payee_name = ""
    payee_phone = ""
    if game["payee_user_id"]:
        cursor = await db.execute("SELECT name, phone FROM users WHERE id = ?", (game["payee_user_id"],))
        payee = await cursor.fetchone()
        if payee:
            payee_name = payee["name"]
            payee_phone = payee["phone"]

    # Refresh game to get updated cost_per_person and ground_cost
    game = await _get_game(db, game_id)
    base_ground_cost = game["ground_cost"] if game["ground_cost"] is not None else (game["cost_per_person"] * game["max_players"])
    per_person_amount = _per_person_amount(base_ground_cost, len(played_user_ids), game["max_players"])

    # Insert pending payments for played players that do not yet have one.
    for uid in played_user_ids:
        await db.execute(
            "INSERT OR IGNORE INTO payments (game_id, user_id, amount, status) VALUES (?, ?, ?, 'pending')",
            (game_id, uid, per_person_amount)
        )
    # Ensure existing payment amounts match the recomputed cost.
    placeholders = ",".join("?" * len(played_user_ids))
    await db.execute(
        f"""UPDATE payments SET amount = ?
            WHERE game_id = ? AND user_id IN ({placeholders})""",
        (per_person_amount, game_id, *played_user_ids)
    )

    # Notify players about the completed game and payment due.
    if game["payment_timing"] == "after":
        for uid in played_user_ids:
            await create_notification(
                db, uid, game_id, "payment_due",
                f"Game completed! Payment of {per_person_amount:.2f} is due for {game['title']}. Pay to {payee_name} ({payee_phone})"
            )
    else:
        for uid in played_user_ids:
            await create_notification(
                db, uid, game_id, "game_completed",
                f"Game '{game['title']}' has been completed! Nominate the Player of the Day."
            )

    await db.commit()
    return await get_game_dict(db, game_id)


async def _auto_progress_games(db: aiosqlite.Connection):
    """Games move to Game Started at their start time and to Completed at their end time."""
    now = _local_now()
    rows = await (await db.execute(
        "SELECT * FROM games WHERE status IN ('voting_open', 'in_progress')"
    )).fetchall()
    for g in rows:
        try:
            start = datetime.strptime(f"{g['game_date']} {g['game_time']}", "%Y-%m-%d %H:%M")
        except (TypeError, ValueError):
            continue
        end = _game_end(g)
        try:
            if g["status"] == "voting_open" and now >= start:
                await _start_game(db, g)
                g = await _get_game(db, g["id"])
            if g["status"] == "in_progress" and end is not None and now >= end:
                await _complete_game(db, g, CompleteGameRequest())
        except HTTPException:
            # e.g. nobody joined the game; leave it for the moderator.
            await db.rollback()


@router.post("/{game_id}/complete")
async def complete_game(
    game_id: int,
    req: CompleteGameRequest = CompleteGameRequest(),
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_game_moderator(user_id, game_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] != "in_progress":
        raise HTTPException(status_code=400, detail="Can only complete an in-progress game")

    return await _complete_game(db, game, req)


@router.post("/{game_id}/edit-result")
async def edit_completed_game_result(
    game_id: int,
    req: EditCompletedGameRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Edit who played, team assignments, score, and goal scorers after a game is completed."""
    await require_game_moderator(user_id, game_id, db)

    game = await _get_game(db, game_id)
    if game["status"] != "completed":
        raise HTTPException(status_code=400, detail="Only completed games can be edited")

    cursor = await db.execute("SELECT user_id, played FROM game_players WHERE game_id = ?", (game_id,))
    all_rows = await cursor.fetchall()
    all_player_ids = {r["user_id"] for r in all_rows}
    played_before = {r["user_id"] for r in all_rows if r["played"]}

    if not req.played_user_ids:
        raise HTTPException(status_code=400, detail="At least one player must have played")

    played_user_ids = [uid for uid in req.played_user_ids if uid in all_player_ids]
    if not played_user_ids:
        raise HTTPException(status_code=400, detail="No valid players selected")

    # Reset all players to not played, then mark the played ones.
    await db.execute(
        "UPDATE game_players SET status = 'waiting', played = 0, team_id = NULL WHERE game_id = ?",
        (game_id,)
    )
    placeholders = ",".join("?" * len(played_user_ids))
    await db.execute(
        f"UPDATE game_players SET status = 'selected', played = 1 WHERE game_id = ? AND user_id IN ({placeholders})",
        (game_id, *played_user_ids)
    )
    for uid in set(played_user_ids) - played_before:
        await log_event(db, game_id, "played_added", user_id=uid, actor_id=user_id)
    for uid in played_before - set(played_user_ids):
        await log_event(db, game_id, "played_removed", user_id=uid, actor_id=user_id)

    # Apply team assignments for played users
    if req.team_assignments:
        tc = await db.execute("SELECT id FROM game_teams WHERE game_id = ?", (game_id,))
        valid_teams = {r["id"] for r in await tc.fetchall()}
        for uid_str, team_id in req.team_assignments.items():
            uid_int = int(uid_str)
            if uid_int in played_user_ids and team_id in valid_teams:
                await db.execute(
                    "UPDATE game_players SET team_id = ? WHERE game_id = ? AND user_id = ?",
                    (team_id, game_id, uid_int)
                )

    # Update team scores
    if req.team_scores:
        tc = await db.execute("SELECT id FROM game_teams WHERE game_id = ? ORDER BY team_order", (game_id,))
        team_rows = await tc.fetchall()
        if len(team_rows) >= 2:
            score_map = {ts.team_id: ts.score for ts in req.team_scores}
            team_a_id = team_rows[0]["id"]
            team_b_id = team_rows[1]["id"]
            await db.execute("DELETE FROM game_scores WHERE game_id = ?", (game_id,))
            await db.execute(
                """INSERT INTO game_scores (game_id, team_a_id, team_a_score, team_b_id, team_b_score)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    game_id,
                    team_a_id,
                    score_map.get(team_a_id, 0),
                    team_b_id,
                    score_map.get(team_b_id, 0),
                )
            )

    # Update goal scorers (including own goals)
    await db.execute("DELETE FROM goal_scorers WHERE game_id = ?", (game_id,))
    if req.goal_scorers:
        for gs in req.goal_scorers:
            if gs.user_id in played_user_ids and (gs.goals > 0 or gs.own_goals > 0):
                await db.execute(
                    "INSERT INTO goal_scorers (game_id, user_id, goals, own_goals) VALUES (?, ?, ?, ?)",
                    (game_id, gs.user_id, max(0, gs.goals), max(0, gs.own_goals))
                )

    current_played = {r["user_id"] for r in await (await db.execute(
        "SELECT user_id FROM game_players WHERE game_id = ? AND played = 1", (game_id,)
    )).fetchall()}
    if set(played_user_ids) != current_played and await _roster_locked(db, game):
        raise HTTPException(status_code=400, detail=ROSTER_LOCKED_DETAIL.format(await get_app_setting(db, "roster_edit_days", "3")))

    # Remove pending payment obligations for players who did not play.
    unplayed_ids = [uid for uid in all_player_ids if uid not in played_user_ids]
    paid_dropped = await _paid_player_names(db, game_id, unplayed_ids)
    if paid_dropped:
        raise HTTPException(status_code=400, detail=f"Already paid, so they must stay as played: {', '.join(paid_dropped)}")
    if unplayed_ids:
        placeholders = ",".join("?" * len(unplayed_ids))
        await db.execute(
            f"DELETE FROM payments WHERE game_id = ? AND user_id IN ({placeholders}) AND status = 'pending'",
            (game_id, *unplayed_ids)
        )

    # Recalculate per-player cost and payment amounts.
    base_ground_cost = game["ground_cost"] if game["ground_cost"] is not None else (game["cost_per_person"] * game["max_players"])
    per_person = _per_person_amount(base_ground_cost, len(played_user_ids), game["max_players"])

    await db.execute(
        "UPDATE games SET cost_per_person = ?, ground_cost = ? WHERE id = ?",
        (per_person, base_ground_cost, game_id)
    )

    # Upsert payments for played users
    for uid in played_user_ids:
        await db.execute(
            "INSERT OR IGNORE INTO payments (game_id, user_id, amount, status) VALUES (?, ?, ?, 'pending')",
            (game_id, uid, per_person)
        )
    placeholders = ",".join("?" * len(played_user_ids))
    due = per_person if (await _payment_settings(db, game))["enabled"] else _whole_rupees(per_person)
    await db.execute(
        f"UPDATE payments SET amount = ? WHERE game_id = ? AND user_id IN ({placeholders})",
        (due, game_id, *played_user_ids)
    )

    # Re-evaluate payment status based on paid_amount
    pc = await db.execute(
        "SELECT id, amount, paid_amount, status FROM payments WHERE game_id = ? AND user_id IN ({})".format(placeholders),
        (game_id, *played_user_ids)
    )
    pay_rows = await pc.fetchall()
    for pr in pay_rows:
        new_status = "paid" if (pr["paid_amount"] or 0) >= pr["amount"] else "pending"
        if new_status != pr["status"]:
            if new_status == "paid":
                await db.execute(
                    "UPDATE payments SET status = 'paid', paid_at = ? WHERE id = ?",
                    (datetime.now(timezone.utc).isoformat(), pr["id"])
                )
            else:
                await db.execute(
                    "UPDATE payments SET status = 'pending', paid_at = NULL WHERE id = ?",
                    (pr["id"],)
                )

    await db.commit()
    return await get_game_dict(db, game_id)


@router.get("/{game_id}/cancel-preview")
async def cancel_game_preview(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Preview cancel impact: confirmed player count, paid count, refund amount."""
    await require_game_moderator(user_id, game_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    cursor = await db.execute(
        "SELECT COUNT(*) as cnt FROM game_players WHERE game_id = ? AND status = 'selected'",
        (game_id,)
    )
    confirmed = (await cursor.fetchone())["cnt"]

    cursor = await db.execute(
        "SELECT COUNT(*) as cnt FROM game_players WHERE game_id = ?",
        (game_id,)
    )
    total_players = (await cursor.fetchone())["cnt"]

    cursor = await db.execute(
        "SELECT COUNT(*) as cnt, COALESCE(SUM(paid_amount), 0) as total_paid FROM payments WHERE game_id = ? AND paid_amount >= amount",
        (game_id,)
    )
    pay_row = await cursor.fetchone()
    paid_count = pay_row["cnt"]
    refund_amount = pay_row["total_paid"]

    return {
        "game_id": game_id,
        "title": game["title"],
        "ground_name": game["ground_name"],
        "game_date": game["game_date"],
        "game_time": game["game_time"],
        "confirmed_players": confirmed,
        "total_players": total_players,
        "paid_players": paid_count,
        "refund_amount": refund_amount,
    }


@router.post("/{game_id}/cancel")
async def cancel_game(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Cancel a game. Refund paid players, notify all participants and subscribed users."""
    await require_game_moderator(user_id, game_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] == "completed":
        raise HTTPException(status_code=400, detail="Cannot cancel a completed game")
    if game["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Game is already cancelled")
    if _game_has_ended(game):
        raise HTTPException(status_code=400, detail="Can't cancel a game that is already over")

    await db.execute("UPDATE games SET status = 'cancelled' WHERE id = ?", (game_id,))
    await log_event(db, game_id, "cancelled", actor_id=user_id)

    cancel_detail = (
        f"Game '{game['title']}' on {game['game_date']} at {game['game_time']} "
        f"at {game['ground_name']} has been cancelled."
    )

    # Refund paid players
    cursor = await db.execute(
        "SELECT user_id, paid_amount FROM payments WHERE game_id = ? AND paid_amount >= amount",
        (game_id,)
    )
    paid_players = await cursor.fetchall()
    for pp in paid_players:
        await db.execute(
            "UPDATE payments SET status = 'pending', paid_amount = 0, paid_at = NULL WHERE game_id = ? AND user_id = ?",
            (game_id, pp["user_id"])
        )
        await log_event(db, game_id, "refund", user_id=pp["user_id"], amount=pp["paid_amount"])
        await create_notification(
            db, pp["user_id"], game_id, "game_cancelled",
            f"{cancel_detail} Your payment of {pp['paid_amount']} has been marked for refund."
        )

    # Clear pending payments for players who quit with penalty (no longer in game_players)
    paid_user_ids = {pp["user_id"] for pp in paid_players}
    cursor = await db.execute(
        "SELECT user_id FROM game_players WHERE game_id = ?", (game_id,)
    )
    all_players = await cursor.fetchall()
    game_player_user_ids = {p["user_id"] for p in all_players}

    cursor = await db.execute(
        "SELECT user_id, amount FROM payments WHERE game_id = ? AND (paid_amount IS NULL OR paid_amount < amount)",
        (game_id,)
    )
    pending_payments = await cursor.fetchall()
    for pp in pending_payments:
        if pp["user_id"] not in game_player_user_ids and pp["user_id"] not in paid_user_ids:
            await db.execute(
                "DELETE FROM payments WHERE game_id = ? AND user_id = ?",
                (game_id, pp["user_id"])
            )
            await create_notification(
                db, pp["user_id"], game_id, "game_cancelled",
                f"{cancel_detail} Your pending payment obligation has been cancelled."
            )

    # Notify all game players (who haven't already been notified via refund)
    for p in all_players:
        if p["user_id"] not in paid_user_ids:
            await create_notification(
                db, p["user_id"], game_id, "game_cancelled", cancel_detail
            )

    # Notify other users who have notifications enabled and match the sport/ground
    sport = game["sport_type"]
    ground = game["ground_name"]
    game_player_ids = {p["user_id"] for p in all_players}
    cursor = await db.execute(
        "SELECT id, sports, locations FROM users WHERE notification_preference != 'none'"
    )
    all_users = await cursor.fetchall()
    for u in all_users:
        if u["id"] in game_player_ids or u["id"] in paid_user_ids:
            continue
        user_sports = u["sports"] or ""
        user_locations = (u["locations"] or "").lower()
        if sport in user_sports or any(loc.strip() in ground.lower() for loc in user_locations.split(',') if loc.strip()):
            await create_notification(
                db, u["id"], game_id, "game_cancelled",
                f"A {sport} game at {ground} on {game['game_date']} has been cancelled."
            )

    await db.commit()
    return await get_game_dict(db, game_id)


@router.delete("/{game_id:int}")
async def delete_game(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Permanently delete a draft or cancelled game (or, for Admins, an archived game) and all related records."""
    await require_admin_moderator_or_ground_management(user_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if _game_is_archived(game):
        is_admin = await (await db.execute(
            "SELECT 1 FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,)
        )).fetchone()
        if not is_admin:
            raise HTTPException(status_code=403, detail="Only an Admin can delete an archived game")
    elif _game_has_ended(game):
        raise HTTPException(status_code=400, detail="A game that is over can't be deleted")
    elif game["status"] not in ("draft", "cancelled"):
        raise HTTPException(status_code=400, detail="Only draft or cancelled games can be deleted")

    # Delete all related records
    await db.execute("DELETE FROM potd_votes WHERE game_id = ?", (game_id,))
    await db.execute("DELETE FROM goal_scorers WHERE game_id = ?", (game_id,))
    await db.execute("DELETE FROM game_scores WHERE game_id = ?", (game_id,))
    await db.execute("DELETE FROM game_teams WHERE game_id = ?", (game_id,))
    await db.execute("DELETE FROM game_players WHERE game_id = ?", (game_id,))
    await db.execute("DELETE FROM payments WHERE game_id = ?", (game_id,))
    await db.execute("DELETE FROM payment_reminders WHERE game_id = ?", (game_id,))
    await db.execute("DELETE FROM notifications WHERE game_id = ?", (game_id,))
    # Delete discussion media and messages for this game
    await db.execute("DELETE FROM discussion_media WHERE game_id = ?", (game_id,))
    await db.execute("DELETE FROM discussion_messages WHERE game_id = ?", (game_id,))
    await db.execute("DELETE FROM games WHERE id = ?", (game_id,))

    await db.commit()
    return {"message": "Game deleted permanently", "game_id": game_id}


@router.post("/{game_id}/vote-potd")
async def vote_player_of_the_day(
    game_id: int,
    req: VotePOTDRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    # Check if user has readonly role - readonly users cannot vote
    cursor = await db.execute(
        "SELECT role FROM user_roles WHERE user_id = ? AND role = 'readonly'", (user_id,)
    )
    if await cursor.fetchone():
        raise HTTPException(status_code=403, detail="Read-only users cannot vote")

    # Check voter was a player in this game
    cursor = await db.execute(
        "SELECT id FROM game_players WHERE game_id = ? AND user_id = ? AND status = 'selected'",
        (game_id, user_id)
    )
    if not await cursor.fetchone():
        raise HTTPException(status_code=403, detail="Only selected players can vote")

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] != "completed":
        raise HTTPException(status_code=400, detail="Can only vote after game is completed")

    # Check 24-hour voting window
    try:
        game_date = game["game_date"]
        game_time = game["game_time"] or "00:00"
        duration = 90
        try:
            duration = game["duration_minutes"] or 90
        except Exception:
            pass
        game_end_str = f"{game_date} {game_time}"
        game_end_dt = datetime.strptime(game_end_str, "%Y-%m-%d %H:%M")
        from datetime import timedelta
        game_end_dt = game_end_dt + timedelta(minutes=duration)
        voting_deadline = game_end_dt + timedelta(minutes=game["potd_congrats_delay_minutes"] or 1440)
        now = _local_now()
        if now < game_end_dt:
            raise HTTPException(status_code=400, detail="Voting opens after the game ends")
        if now > voting_deadline:
            raise HTTPException(status_code=400, detail="Player of the Day nominations have closed")
    except HTTPException:
        raise
    except Exception:
        pass  # If date parsing fails, allow voting anyway

    # Validate preferences: no self-voting, all must be in the game, no duplicates
    preferences = [req.first_preference]
    if req.second_preference is not None:
        preferences.append(req.second_preference)
    if req.third_preference is not None:
        if req.second_preference is None:
            raise HTTPException(status_code=400, detail="Cannot set 3rd preference without 2nd")
        preferences.append(req.third_preference)

    # Check no duplicates
    if len(set(preferences)) != len(preferences):
        raise HTTPException(status_code=400, detail="Cannot vote for the same player twice")

    # Check no self-voting
    if user_id in preferences:
        raise HTTPException(status_code=400, detail="Cannot vote for yourself")

    # Check all players were in the game
    for pid in preferences:
        cursor = await db.execute(
            "SELECT id FROM game_players WHERE game_id = ? AND user_id = ? AND status = 'selected'",
            (game_id, pid)
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=400, detail=f"Player {pid} was not in this game")

    # Remove existing votes for this voter in this game
    await db.execute("DELETE FROM potd_votes WHERE game_id = ? AND voter_id = ?", (game_id, user_id))

    # Insert ranked votes
    for i, pid in enumerate(preferences, start=1):
        await db.execute(
            "INSERT INTO potd_votes (game_id, voter_id, player_id, preference) VALUES (?, ?, ?, ?)",
            (game_id, user_id, pid, i)
        )

    await db.commit()
    return {"message": "Vote recorded", "preferences": len(preferences)}


@router.post("/{game_id}/broadcast-status")
async def broadcast_game_status(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_game_moderator(user_id, game_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] not in ("voting_open", "in_progress"):
        raise HTTPException(status_code=400, detail="Can only broadcast status for active games")

    # Build status message
    cursor = await db.execute(
        """SELECT gp.*, u.name FROM game_players gp 
           JOIN users u ON gp.user_id = u.id 
           WHERE gp.game_id = ? ORDER BY gp.joined_at""",
        (game_id,)
    )
    players_rows = await cursor.fetchall()

    selected = [p for p in players_rows if p["status"] == "selected"]
    waiting = [p for p in players_rows if p["status"] == "waiting"]

    sport_label = game["sport_type"].capitalize()
    msg = f"{game['title']}\n{game['ground_name']}\nGame Time: {game['game_time']}\nSport: {sport_label}\n\nPlayers:\n"
    for i, p in enumerate(selected, 1):
        msg += f"{i}. {p['name']}\n"
    if waiting:
        msg += "\nWL:\n"
        for i, p in enumerate(waiting, 1):
            msg += f"{i}. {p['name']}\n"
    msg += f"\nCost: ${game['cost_per_person']:.2f}/person"

    # Notify all users who have matching sport or location preferences
    cursor = await db.execute("SELECT id FROM users")
    all_users = await cursor.fetchall()
    for u in all_users:
        await create_notification(
            db, u["id"], game_id, "game_status",
            msg
        )

    await db.commit()
    return {"message": "Status broadcast sent to all users", "status_text": msg}


@router.get("/{game_id}/log")
async def get_game_log(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Everything that happened in a game. Players only see their own payments."""
    game = await _get_game(db, game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    return await build_log(db, game, user_id, await _is_game_moderator(user_id, game_id, db))


@router.get("/{game_id}/potd")
async def get_potd_results(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    # Calculate points: 1st preference = 3pts, 2nd = 2pts, 3rd = 1pt
    cursor = await db.execute(
        """SELECT p.player_id, u.name, u.first_name,
                  SUM(CASE WHEN p.preference = 1 THEN 3
                           WHEN p.preference = 2 THEN 2
                           WHEN p.preference = 3 THEN 1 ELSE 0 END) as points,
                  COUNT(*) as total_votes,
                  SUM(CASE WHEN p.preference = 1 THEN 1 ELSE 0 END) as first_pref_count,
                  SUM(CASE WHEN p.preference = 2 THEN 1 ELSE 0 END) as second_pref_count,
                  SUM(CASE WHEN p.preference = 3 THEN 1 ELSE 0 END) as third_pref_count
           FROM potd_votes p JOIN users u ON p.player_id = u.id 
           WHERE p.game_id = ? GROUP BY p.player_id ORDER BY points DESC, first_pref_count DESC""",
        (game_id,)
    )
    results = await cursor.fetchall()

    result_list = [{
        "player_id": r["player_id"],
        "name": r["name"],
        "first_name": r["first_name"],
        "points": r["points"],
        "total_votes": r["total_votes"],
        "first_pref": r["first_pref_count"],
        "second_pref": r["second_pref_count"],
        "third_pref": r["third_pref_count"],
    } for r in results]

    vote_rows = await (await db.execute(
        """SELECT pv.player_id, pv.voter_id, pv.preference,
                  COALESCE(NULLIF(u.display_name, ''), u.name) AS voter_name
           FROM potd_votes pv JOIN users u ON u.id = pv.voter_id
           WHERE pv.game_id = ? ORDER BY pv.preference, voter_name""",
        (game_id,)
    )).fetchall()
    by_player: dict = {}
    for v in vote_rows:
        by_player.setdefault(v["player_id"], []).append({
            "voter_id": v["voter_id"], "voter_name": v["voter_name"],
            "preference": v["preference"], "points": {1: 3, 2: 2, 3: 1}.get(v["preference"], 0),
        })
    for r in result_list:
        r["voters"] = by_player.get(r["player_id"], [])

    # Handle ties: if top 2 players have equal points, both get equal recognition
    winner = None
    if result_list:
        winner = result_list[0]
        # Check for tie
        tied_winners = [r for r in result_list if r["points"] == result_list[0]["points"]]
        if len(tied_winners) > 1:
            winner = {"tied": True, "players": tied_winners}
        else:
            winner["tied"] = False

    # Check if current user has already voted
    cursor = await db.execute(
        "SELECT player_id, preference FROM potd_votes WHERE game_id = ? AND voter_id = ? ORDER BY preference",
        (game_id, user_id)
    )
    my_votes = await cursor.fetchall()
    my_vote_data = [{"player_id": v["player_id"], "preference": v["preference"]} for v in my_votes]

    # Check voting window
    voting_open = True
    voting_deadline_str = None
    try:
        cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
        game = await cursor.fetchone()
        if game and game["status"] == "completed":
            game_date = game["game_date"]
            game_time = game["game_time"] or "00:00"
            duration = 90
            try:
                duration = game["duration_minutes"] or 90
            except Exception:
                pass
            from datetime import timedelta
            game_end_dt = datetime.strptime(f"{game_date} {game_time}", "%Y-%m-%d %H:%M") + timedelta(minutes=duration)
            voting_deadline = game_end_dt + timedelta(minutes=game["potd_congrats_delay_minutes"] or 1440)
            voting_deadline_str = voting_deadline.strftime("%Y-%m-%d %H:%M")
            now = _local_now()
            if now > voting_deadline:
                voting_open = False
    except Exception:
        pass

    return {
        "results": result_list,
        "man_of_the_match": winner,
        "my_votes": my_vote_data,
        "voting_open": voting_open,
        "voting_deadline": voting_deadline_str,
    }


@router.post("/{game_id}/teams")
async def create_teams(
    game_id: int,
    req: CreateTeamsRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_game_moderator(user_id, game_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    colors = _check_jerseys((req.jersey_colors or [])[:len(req.team_names)])
    colors += [""] * (len(req.team_names) - len(colors))

    # Delete existing teams for this game
    await db.execute("UPDATE game_players SET team_id = NULL WHERE game_id = ?", (game_id,))
    await db.execute("DELETE FROM game_teams WHERE game_id = ?", (game_id,))

    # Create new teams
    for i, name in enumerate(req.team_names):
        await db.execute(
            "INSERT INTO game_teams (game_id, team_name, team_order, jersey_color) VALUES (?, ?, ?, ?)",
            (game_id, name, i, colors[i])
        )

    await db.commit()
    return await get_game_dict(db, game_id)


@router.put("/{game_id}/teams/{team_id}/jersey")
async def set_team_jersey(
    game_id: int,
    team_id: int,
    req: TeamJerseyRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_game_moderator(user_id, game_id, db)
    cursor = await db.execute("SELECT id, jersey_color FROM game_teams WHERE game_id = ?", (game_id,))
    rows = await cursor.fetchall()
    if not any(r["id"] == team_id for r in rows):
        raise HTTPException(status_code=404, detail="Team not found")
    color = _check_jerseys([req.jersey_color] + [r["jersey_color"] for r in rows if r["id"] != team_id])[0]
    await db.execute("UPDATE game_teams SET jersey_color = ? WHERE id = ?", (color, team_id))
    await db.commit()
    return await get_game_dict(db, game_id)


@router.post("/{game_id}/teams/move-player")
async def move_player_to_team(
    game_id: int,
    req: MovePlayerRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_game_moderator(user_id, game_id, db)

    # Validate team exists if team_id provided
    if req.team_id is not None:
        cursor = await db.execute(
            "SELECT id FROM game_teams WHERE id = ? AND game_id = ?",
            (req.team_id, game_id)
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Team not found")

    # Update player's team
    await db.execute(
        "UPDATE game_players SET team_id = ? WHERE game_id = ? AND user_id = ?",
        (req.team_id, game_id, req.player_user_id)
    )
    await db.commit()
    return await get_game_dict(db, game_id)


@router.delete("/{game_id}/teams")
async def delete_teams(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_game_moderator(user_id, game_id, db)
    await db.execute("UPDATE game_players SET team_id = NULL WHERE game_id = ?", (game_id,))
    await db.execute("DELETE FROM game_teams WHERE game_id = ?", (game_id,))
    await db.commit()
    return await get_game_dict(db, game_id)


@router.get("/{game_id}/quit-penalty-check")
async def check_quit_penalty(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Check if quitting now would incur a penalty."""
    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    quit_penalty_hours = 0
    try:
        quit_penalty_hours = game["quit_penalty_hours"] or 0
    except Exception:
        pass

    if quit_penalty_hours == 0:
        return {"has_penalty": False, "quit_penalty_hours": 0, "must_pay": False}

    try:
        game_dt_str = f"{game['game_date']} {game['game_time']}"
        game_dt = datetime.strptime(game_dt_str, "%Y-%m-%d %H:%M")
        hours_until_game = (game_dt - _local_now()).total_seconds() / 3600
        must_pay = hours_until_game < quit_penalty_hours
        return {
            "has_penalty": True,
            "quit_penalty_hours": quit_penalty_hours,
            "hours_until_game": round(hours_until_game, 1),
            "must_pay": must_pay
        }
    except Exception:
        return {"has_penalty": True, "quit_penalty_hours": quit_penalty_hours, "must_pay": False}


class SettleExcessRequest(BaseModel):
    user_id: int


@router.post("/{game_id}/settle-excess")
async def settle_excess(
    game_id: int,
    req: SettleExcessRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Moderator returned a player's overpayment offline; the payment is reset to exactly the share."""
    await require_game_moderator(user_id, game_id, db)
    game = await _get_game(db, game_id)
    row = await (await db.execute(
        "SELECT amount, paid_amount FROM payments WHERE game_id = ? AND user_id = ?", (game_id, req.user_id)
    )).fetchone()
    if not row or (row["paid_amount"] or 0) <= row["amount"]:
        raise HTTPException(status_code=400, detail="No excess payment to settle")
    excess = row["paid_amount"] - row["amount"]
    await db.execute(
        "UPDATE payments SET paid_amount = amount WHERE game_id = ? AND user_id = ?", (game_id, req.user_id)
    )
    await log_event(db, game_id, "excess_settled", user_id=req.user_id, actor_id=user_id, amount=excess)
    await db.execute(
        "INSERT INTO notifications (user_id, game_id, type, message) VALUES (?, ?, 'payment_update', ?)",
        (req.user_id, game_id, f"Moderator settled your excess payment of {excess:.0f} for {game['title']}.")
    )
    await db.commit()
    return await get_game_dict(db, game_id)


@router.post("/{game_id}/mark-paid")
async def mark_payment_made(
    game_id: int,
    req: MarkPaymentRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Moderator marks a user's payment as made from backend."""
    await require_game_moderator(user_id, game_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    # Check if payment record exists
    cursor = await db.execute(
        "SELECT * FROM payments WHERE game_id = ? AND user_id = ?",
        (game_id, req.user_id)
    )
    payment = await cursor.fetchone()
    if not payment:
        # Create and mark as paid
        now = datetime.now(timezone.utc).isoformat()
        amount = game["cost_per_person"]
        await db.execute(
            "INSERT INTO payments (game_id, user_id, amount, paid_amount, status, paid_at, paid_by, paid_via) "
            "VALUES (?, ?, ?, ?, 'paid', ?, ?, 'moderator')",
            (game_id, req.user_id, amount, amount, now, user_id)
        )
    elif (payment["paid_amount"] or 0) < payment["amount"]:
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            "UPDATE payments SET status = 'paid', paid_amount = amount, paid_at = ?, paid_by = ?, paid_via = 'moderator' "
            "WHERE game_id = ? AND user_id = ?",
            (now, user_id, game_id, req.user_id)
        )

    if not payment or (payment["paid_amount"] or 0) < payment["amount"]:
        owed = game["cost_per_person"] if not payment else payment["amount"] - (payment["paid_amount"] or 0)
        await log_event(db, game_id, "marked_paid", user_id=req.user_id, actor_id=user_id, amount=owed)

    # Always update player payment_confirmed (fixes inconsistency if payment was
    # already 'paid' but payment_confirmed was still 0 from a previous partial failure)
    await db.execute(
        "UPDATE game_players SET payment_confirmed = 1 WHERE game_id = ? AND user_id = ?",
        (game_id, req.user_id)
    )

    # Notify user
    await create_notification(
        db, req.user_id, game_id, "payment_confirmed",
        f"Your payment for {game['title']} has been confirmed by the moderator."
    )
    await _admit_paid_pay_first_player(db, game_id, req.user_id)

    await db.commit()
    return await get_game_dict(db, game_id)


@router.post("/{game_id}/remind-unpaid")
async def remind_unpaid_players(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Moderator sends payment reminder to all unpaid players."""
    await require_game_moderator(user_id, game_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    # Get unpaid players
    cursor = await db.execute(
        """SELECT p.user_id, u.name, u.phone, u.notification_preference
           FROM payments p JOIN users u ON p.user_id = u.id
           WHERE p.game_id = ? AND (p.paid_amount IS NULL OR p.paid_amount < p.amount)""",
        (game_id,)
    )
    unpaid = await cursor.fetchall()

    if not unpaid:
        return {"message": "No unpaid players to remind", "reminded_count": 0}

    # Get payee info
    payee_name = ""
    payee_phone = ""
    if game["payee_user_id"]:
        cursor = await db.execute("SELECT name, phone FROM users WHERE id = ?", (game["payee_user_id"],))
        payee = await cursor.fetchone()
        if payee:
            payee_name = payee["name"]
            payee_phone = payee["phone"]

    reminded = []
    for u in unpaid:
        msg = f"Reminder: Payment of {game['cost_per_person']} is pending for {game['title']}. Please pay to {payee_name} ({payee_phone})."
        await create_notification(db, u["user_id"], game_id, "payment_reminder", msg)
        reminded.append({
            "user_id": u["user_id"],
            "name": u["name"],
            "phone": u["phone"],
            "preference": u["notification_preference"]
        })

    await db.commit()

    # Build WhatsApp message for moderator to share
    wa_msg = f"Payment Reminder - {game['title']}\n\n"
    wa_msg += f"Unpaid players:\n"
    for u in unpaid:
        wa_msg += f"- {u['name']} ({u['phone']})\n"
    wa_msg += f"\nAmount: {game['cost_per_person']}/person\nPay to: {payee_name} ({payee_phone})"

    return {
        "message": f"Reminder sent to {len(reminded)} players",
        "reminded_count": len(reminded),
        "reminded": reminded,
        "whatsapp_message": wa_msg
    }


@router.get("/hall-of-fame")
async def hall_of_fame(
    sport: Optional[str] = Query(None, description="Filter by sport type"),
    ground_name: Optional[str] = Query(None, description="Filter by ground"),
    series_name: Optional[str] = Query(None, description="Filter by series"),
    series_day: Optional[str] = Query(None, description="Filter by series day"),
    from_date: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    to_date: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Hall of Fame: Player rankings by POTD points + goals scored.
    Points: 1st preference = 3pts, 2nd = 2pts, 3rd = 1pt.
    Supports filters by sport, ground, series, and series day.
    """
    rankings = await _build_rankings(
        db,
        sport_type=sport,
        ground_name=ground_name,
        series_name=series_name,
        series_day=series_day,
        from_date=from_date,
        to_date=to_date,
    )
    return {
        "rankings": rankings,
        "filters": {
            "sport": sport,
            "ground_name": ground_name,
            "series_name": series_name,
            "series_day": series_day,
            "from_date": from_date,
            "to_date": to_date,
        },
    }


def _count_label(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _others_phrase(n: int) -> str:
    if n == 0:
        return "nobody else has done so"
    if n == 1:
        return "only one other player has done so"
    return f"{n} other players have done so"


def _duration_label(minutes: float) -> str:
    m = max(int(round(minutes)), 0)
    d, h, mm = m // 1440, (m % 1440) // 60, m % 60
    if d:
        return f"{d}d {h}h" if h else f"{d}d"
    if h:
        return f"{h}h {mm}m" if mm else f"{h}h"
    return f"{mm}m"


async def _avg_pay_minutes(db: aiosqlite.Connection) -> Dict[int, float]:
    """Average time each player takes to pay in full after a completed game ends (players with 2+ such games)."""
    from .payments_router import _local_paid_at
    rows = await (await db.execute(
        """SELECT p.user_id, p.paid_at, g.game_date, g.game_time, g.duration_minutes
           FROM payments p JOIN games g ON g.id = p.game_id
           WHERE g.status = 'completed' AND p.paid_at IS NOT NULL
             AND COALESCE(p.paid_amount, 0) > 0 AND COALESCE(p.paid_amount, 0) >= p.amount"""
    )).fetchall()
    times: Dict[int, List[float]] = {}
    for r in rows:
        end, paid = _game_end(r), _local_paid_at(r["paid_at"])
        if end and paid:
            times.setdefault(r["user_id"], []).append(max((paid - end).total_seconds() / 60, 0))
    return {uid: sum(t) / len(t) for uid, t in times.items() if len(t) >= 2}


def _leader_suffix(value: int, values: dict, player_id: int, what: str) -> str:
    """Return ' — the most ...' when the player leads all others on `values`."""
    if value <= 0 or value < max(values.values(), default=0):
        return ""
    tied = sum(1 for uid, v in values.items() if uid != player_id and v == value)
    if tied > 2:
        return ""
    if tied:
        return f" — joint most {what} with {_count_label(tied, 'other player')}"
    return f" — the most {what} by anyone"


@router.get("/player/{player_id}/insights")
async def get_player_insights(
    player_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Generate highlight statements for a player compared with all other players."""
    cursor = await db.execute("SELECT id, name FROM users WHERE id = ?", (player_id,))
    player = await cursor.fetchone()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    cursor = await db.execute(
        """SELECT gp.user_id, gp.team_id, gs.team_a_id, gs.team_a_score, gs.team_b_id, gs.team_b_score
           FROM game_players gp
           JOIN games g ON gp.game_id = g.id
           LEFT JOIN game_scores gs ON gs.game_id = g.id
           WHERE g.status = 'completed' AND gp.status = 'selected'"""
    )
    played: Dict[int, int] = {}
    results: Dict[int, Dict[str, int]] = {}
    for row in await cursor.fetchall():
        uid = row["user_id"]
        played[uid] = played.get(uid, 0) + 1
        outcome = _outcome_for_player(row)
        if outcome:
            rec = results.setdefault(uid, {"win": 0, "draw": 0, "loss": 0})
            rec[outcome] += 1

    cursor = await db.execute(
        """SELECT gs.user_id, gs.goals, gs.own_goals
           FROM goal_scorers gs
           JOIN games g ON gs.game_id = g.id
           WHERE g.status = 'completed'"""
    )
    goals: Dict[int, int] = {}
    own_goals: Dict[int, int] = {}
    best_game: Dict[int, int] = {}
    for row in await cursor.fetchall():
        uid = row["user_id"]
        goals[uid] = goals.get(uid, 0) + (row["goals"] or 0)
        own_goals[uid] = own_goals.get(uid, 0) + (row["own_goals"] or 0)
        best_game[uid] = max(best_game.get(uid, 0), row["goals"] or 0)

    cursor = await db.execute(
        """SELECT p.game_id, p.user_id
           FROM payments p
           JOIN games g ON p.game_id = g.id
           WHERE g.status = 'completed' AND p.status = 'paid' AND p.paid_at IS NOT NULL
           ORDER BY p.game_id, p.paid_at, p.id"""
    )
    payers_by_game: Dict[int, List[int]] = {}
    for row in await cursor.fetchall():
        payers_by_game.setdefault(row["game_id"], []).append(row["user_id"])
    last_payer: Dict[int, int] = {}
    first_payer: Dict[int, int] = {}
    pay_positions: Dict[int, List[float]] = {}
    for payers in payers_by_game.values():
        if len(payers) < 3:
            continue
        first_payer[payers[0]] = first_payer.get(payers[0], 0) + 1
        last_payer[payers[-1]] = last_payer.get(payers[-1], 0) + 1
        for idx, uid in enumerate(payers):
            pay_positions.setdefault(uid, []).append(idx / (len(payers) - 1))

    facts: List[Dict[str, str]] = []
    games = played.get(player_id, 0)
    if games == 0:
        return {"user_id": player_id, "name": player["name"], "insights": [
            {"category": "games", "text": "Hasn't played any completed games yet."}
        ]}

    rec = results.get(player_id, {"win": 0, "draw": 0, "loss": 0})
    text = f"Has played {_count_label(games, 'game')}"
    decided = rec["win"] + rec["draw"] + rec["loss"]
    if decided:
        text += f" — {rec['win']} won, {rec['draw']} drawn, {rec['loss']} lost"
        if rec["loss"] == 0:
            text += ", never lost one"
    text += _leader_suffix(games, played, player_id, "games played")
    facts.append({"category": "games", "text": text + "."})

    if decided >= 3:
        win_rates = {
            uid: r["win"] / (r["win"] + r["draw"] + r["loss"])
            for uid, r in results.items() if r["win"] + r["draw"] + r["loss"] >= 3
        }
        rate = win_rates[player_id]
        better = sum(1 for uid, v in win_rates.items() if uid != player_id and v > rate)
        if better < 3 and rec["win"] > 0:
            facts.append({"category": "games", "text": (
                f"Wins {round(rate * 100)}% of games — #{better + 1} win rate "
                f"among {len(win_rates)} regular players."
            )})

    streaks = await _compute_streaks(db, player_id)
    if streaks["longest_win_streak"] >= 3:
        facts.append({"category": "streak", "text": f"Longest winning streak: {_count_label(streaks['longest_win_streak'], 'game')}."})
    if streaks["current_win_streak"] >= 2:
        facts.append({"category": "streak", "text": f"Currently on a winning streak of {_count_label(streaks['current_win_streak'], 'game')}."})

    total = goals.get(player_id, 0)
    if total > 0:
        text = f"Has scored {_count_label(total, 'goal')}"
        suffix = _leader_suffix(total, goals, player_id, "goals")
        if not suffix:
            rank = 1 + sum(1 for v in goals.values() if v > total)
            suffix = f" — #{rank} among {len([v for v in goals.values() if v > 0])} scorers"
        facts.append({"category": "goals", "text": text + suffix + "."})
        if games >= 3:
            facts.append({"category": "goals", "text": f"Averages {total / games:.1f} goals per game."})

    best = best_game.get(player_id, 0)
    if best >= 2:
        others = sum(1 for uid, v in best_game.items() if uid != player_id and v >= best)
        facts.append({"category": "goals", "text": f"Scored {best} goals in a single game — {_others_phrase(others)}."})

    og = own_goals.get(player_id, 0)
    if og > 0:
        text = f"Has scored {_count_label(og, 'own goal')} so far"
        facts.append({"category": "own_goals", "text": text + _leader_suffix(og, own_goals, player_id, "own goals") + "."})

    lp = last_payer.get(player_id, 0)
    if lp > 0:
        text = f"Has been the last person to pay in {_count_label(lp, 'game')}"
        facts.append({"category": "payments", "text": text + _leader_suffix(lp, last_payer, player_id, "times") + "."})

    regular_payers = {uid: sum(p) / len(p) for uid, p in pay_positions.items() if len(p) >= 3}
    if player_id in regular_payers:
        avg = regular_payers[player_id]
        quicker = sum(1 for uid, v in regular_payers.items() if uid != player_id and v < avg)
        fp = first_payer.get(player_id, 0)
        if quicker < 3:
            text = f"Among the top 3 quickest payers (#{quicker + 1} of {len(regular_payers)})"
            if fp:
                text += f", paid first in {_count_label(fp, 'game')}"
            facts.append({"category": "payments", "text": text + "."})
        elif fp:
            facts.append({"category": "payments", "text": f"Was the first to pay in {_count_label(fp, 'game')}."})

    avg_pay = await _avg_pay_minutes(db)
    if player_id in avg_pay and len(avg_pay) >= 2:
        mine = avg_pay[player_id]
        rank = 1 + sum(1 for uid, v in avg_pay.items() if uid != player_id and v < mine)
        n = len(avg_pay)
        text = f"Pays {_duration_label(mine)} after the game ends on average"
        if rank <= 3 and rank <= n // 2:
            text += f" — one of the best (#{rank} of {n})"
        elif rank > n - 3 and rank > (n + 1) // 2:
            text += f" — one of the worst (#{rank} of {n})"
        else:
            text += f" (#{rank} of {n})"
        facts.append({"category": "payments", "text": text + "."})

    potd_wins = await _potd_win_counts(db)
    pw = potd_wins.get(player_id, 0)
    if pw > 0:
        text = f"Chosen Player of the Day in {pw}/{games} games"
        facts.append({"category": "fame", "text": text + _leader_suffix(pw, potd_wins, player_id, "times") + "."})

    rankings = await _build_rankings(db)
    fame = next((r for r in rankings if r["user_id"] == player_id), None)
    if fame and fame["rank"] <= 10:
        text = f"Ranked #{fame['rank']} in the Hall of Fame"
        if fame["first_pref_wins"]:
            text += f", voted Player of the Day first choice {_count_label(fame['first_pref_wins'], 'time')}"
        facts.append({"category": "fame", "text": text + "."})

    return {"user_id": player_id, "name": player["name"], "insights": facts}


@router.get("/player/{player_id}/stats")
async def get_player_stats(
    player_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Get a player's Hall of Fame stats, ranks, and streaks for their profile."""
    cursor = await db.execute("SELECT id, name, first_name, phone FROM users WHERE id = ?", (player_id,))
    player = await cursor.fetchone()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    # Aggregate rankings across scopes
    scopes = {
        "overall": {},
    }

    # Build a few useful scope rankings by player's known contexts
    # Sport/ground/series groups the player has actually played in
    cursor = await db.execute(
        """SELECT DISTINCT g.sport_type, g.ground_name, g.series_name, g.series_day
           FROM game_players gp
           JOIN games g ON gp.game_id = g.id
           WHERE gp.user_id = ? AND g.status = 'completed'""",
        (player_id,)
    )
    contexts = await cursor.fetchall()

    def _rank_from(rankings: list[dict]) -> Optional[int]:
        for r in rankings:
            if r["user_id"] == player_id:
                return r["rank"]
        return None

    overall_rankings = await _build_rankings(db)
    scopes["overall"]["rank"] = _rank_from(overall_rankings)
    player_overall = next((r for r in overall_rankings if r["user_id"] == player_id), {})
    scopes["overall"]["potd_points"] = player_overall.get("potd_points", 0)
    scopes["overall"]["total_goals"] = player_overall.get("total_goals", 0)
    scopes["overall"]["games_played"] = player_overall.get("games_played", 0)
    scopes["overall"]["potd_wins"] = player_overall.get("potd_wins", 0)
    scopes["overall"]["combined_score"] = player_overall.get("combined_score", 0)

    # Collect distinct scope rankings the player appears in
    sport_ranks = {}
    ground_ranks = {}
    series_ranks = {}
    for ctx in contexts:
        sport = ctx["sport_type"]
        ground = ctx["ground_name"]
        series = ctx["series_name"]
        day = ctx["series_day"]
        if sport and sport not in sport_ranks:
            rankings = await _build_rankings(db, sport_type=sport)
            sport_ranks[sport] = _rank_from(rankings)
        if ground and ground not in ground_ranks:
            rankings = await _build_rankings(db, ground_name=ground)
            ground_ranks[ground] = _rank_from(rankings)
        if series and day and f"{series}::{day}" not in series_ranks:
            rankings = await _build_rankings(db, series_name=series, series_day=day)
            series_ranks[f"{series}::{day}"] = _rank_from(rankings)

    scopes["by_sport"] = sport_ranks
    scopes["by_ground"] = ground_ranks
    scopes["by_series_day"] = {k: v for k, v in series_ranks.items() if v is not None}

    # POTD points by sport
    cursor = await db.execute(
        """SELECT g.sport_type,
                  SUM(CASE WHEN pv.preference = 1 THEN 3
                           WHEN pv.preference = 2 THEN 2
                           WHEN pv.preference = 3 THEN 1 ELSE 0 END) as points,
                  SUM(CASE WHEN pv.preference = 1 THEN 1 ELSE 0 END) as first_pref_wins
           FROM potd_votes pv
           JOIN games g ON pv.game_id = g.id
           WHERE pv.player_id = ? AND g.status = 'completed'
           GROUP BY g.sport_type""",
        (player_id,)
    )
    potd_by_sport = await cursor.fetchall()

    # Goals by sport (net of own goals)
    cursor = await db.execute(
        """SELECT g.sport_type, SUM(gs.goals - gs.own_goals) as total_goals
           FROM goal_scorers gs
           JOIN games g ON gs.game_id = g.id
           WHERE gs.user_id = ? AND g.status = 'completed'
           GROUP BY g.sport_type""",
        (player_id,)
    )
    goals_by_sport = await cursor.fetchall()

    # Games played by sport
    cursor = await db.execute(
        """SELECT g.sport_type, COUNT(DISTINCT gp.game_id) as games_played
           FROM game_players gp
           JOIN games g ON gp.game_id = g.id
           WHERE gp.user_id = ? AND gp.status = 'selected' AND g.status = 'completed'
           GROUP BY g.sport_type""",
        (player_id,)
    )
    games_by_sport = await cursor.fetchall()

    # Streaks (overall and since a fixed start date)
    streaks = await _compute_streaks(db, player_id)
    streaks_since_jan = await _compute_streaks(db, player_id, since_date="2026-01-01")

    return {
        "user_id": player_id,
        "name": player["name"],
        "first_name": player["first_name"],
        "overall_potd_rank": scopes["overall"]["rank"],
        "total_potd_points": scopes["overall"]["potd_points"],
        "potd_wins": scopes["overall"]["potd_wins"],
        "total_goals": scopes["overall"]["total_goals"],
        "games_played": scopes["overall"]["games_played"],
        "combined_score": scopes["overall"]["combined_score"],
        "potd_by_sport": [
            {"sport": r["sport_type"], "points": r["points"], "first_pref_wins": r["first_pref_wins"]}
            for r in potd_by_sport
        ],
        "goals_by_sport": [
            {"sport": r["sport_type"], "total_goals": r["total_goals"]}
            for r in goals_by_sport
        ],
        "games_by_sport": [
            {"sport": r["sport_type"], "games_played": r["games_played"]}
            for r in games_by_sport
        ],
        "ranks": scopes,
        "streaks": {
            "overall": streaks,
            "since_2026_01_01": streaks_since_jan,
        },
    }


@router.get("/{game_id}/voting-link")
async def get_voting_link(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Generate a shareable direct voting link for a game."""
    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    # Generate a token based on game_id
    token = hashlib.sha256(f"{game_id}-{VOTING_LINK_SECRET}".encode()).hexdigest()[:16]

    game_code = ""
    try:
        game_code = game["game_code"] or ""
    except Exception:
        pass

    return {
        "game_id": game_id,
        "game_code": game_code,
        "voting_token": token,
        "voting_open": game["status"] == "voting_open",
        "status": game["status"],
    }


@router.get("/vote/{voting_token}")
async def access_voting_page(
    voting_token: str,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Resolve a voting token to a game and check if voting is open."""
    # Look up game by stored voting_token column first (O(1) lookup)
    try:
        cursor = await db.execute(
            "SELECT id, status FROM games WHERE voting_token = ?", (voting_token,)
        )
        game = await cursor.fetchone()
        if game:
            return {
                "game_id": game["id"],
                "voting_open": game["status"] == "voting_open",
                "status": game["status"],
            }
    except Exception:
        pass

    # Fallback: check recent games only (limit to 100 most recent) for backwards compatibility
    cursor = await db.execute("SELECT id, status FROM games ORDER BY id DESC LIMIT 100")
    games = await cursor.fetchall()
    for game in games:
        expected_token = hashlib.sha256(f"{game['id']}-{VOTING_LINK_SECRET}".encode()).hexdigest()[:16]
        if expected_token == voting_token:
            # Store the token for future O(1) lookups
            try:
                await db.execute("UPDATE games SET voting_token = ? WHERE id = ?", (voting_token, game["id"]))
                await db.commit()
            except Exception:
                pass
            return {
                "game_id": game["id"],
                "voting_open": game["status"] == "voting_open",
                "status": game["status"],
            }
    raise HTTPException(status_code=404, detail="Invalid voting link")


@router.get("/search/games")
async def search_games(
    date: Optional[str] = Query(None, description="Filter by game date (YYYY-MM-DD)"),
    date_from: Optional[str] = Query(None, description="Filter games from this date (YYYY-MM-DD)"),
    date_to: Optional[str] = Query(None, description="Filter games up to this date (YYYY-MM-DD)"),
    ground: Optional[str] = Query(None, description="Filter by ground name (partial match)"),
    location: Optional[str] = Query(None, description="Filter by location name"),
    status: Optional[str] = Query(None, description="Filter by game status"),
    sport: Optional[str] = Query(None, description="Filter by sport type"),
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Search games by date range, ground, location, status, sport. Any user can search."""
    query = "SELECT id FROM games WHERE 1=1"
    params: list[str] = []

    if date:
        query += " AND game_date = ?"
        params.append(date)
    if date_from:
        query += " AND game_date >= ?"
        params.append(date_from)
    if date_to:
        query += " AND game_date <= ?"
        params.append(date_to)
    if ground:
        query += " AND LOWER(ground_name) LIKE LOWER(?)"
        params.append(f"%{ground}%")
    if location:
        # Join with grounds table to filter by location
        query += " AND ground_name IN (SELECT (g2.location || ' - ' || g2.name) FROM grounds g2 WHERE LOWER(g2.location) = LOWER(?))"
        params.append(location)
    if status:
        query += " AND status = ?"
        params.append(status)
    if sport:
        query += " AND LOWER(sport_type) LIKE LOWER(?)"
        params.append(f"%{sport}%")

    query += " ORDER BY game_date ASC, game_time ASC"

    cursor = await db.execute(query, params)
    games = await cursor.fetchall()

    result = []
    for g in games:
        game_data = await get_game_dict(db, g["id"])
        result.append(game_data)
    return result

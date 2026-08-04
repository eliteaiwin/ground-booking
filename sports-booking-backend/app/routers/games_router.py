from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
import aiosqlite
import hashlib
from datetime import datetime, timedelta, timezone

from ..database import get_db, get_app_setting
from ..auth import get_current_user_id

VOTING_LINK_SECRET = "ground-booking-voting-2026"

router = APIRouter(prefix="/api/games", tags=["games"])


class CreateGameRequest(BaseModel):
    title: str
    sport_type: str  # soccer, cricket, badminton, basketball, hockey
    ground_name: str
    game_date: str
    game_time: str
    max_players: int
    cost_per_person: float
    payment_timing: str  # before, after
    duration_minutes: int = 90
    payee_user_id: Optional[int] = None
    quit_penalty_hours: int = 0
    payment_mode: str = "postpaid"  # prepaid, postpaid
    potd_congrats_delay_minutes: int = 1440  # default 24 hours
    series_name: Optional[str] = None
    series_day: Optional[str] = None


class EditGameRequest(BaseModel):
    title: Optional[str] = None
    sport_type: Optional[str] = None
    ground_name: Optional[str] = None
    game_date: Optional[str] = None
    game_time: Optional[str] = None
    max_players: Optional[int] = None
    cost_per_person: Optional[float] = None
    duration_minutes: Optional[int] = None
    payee_user_id: Optional[int] = None
    quit_penalty_hours: Optional[int] = None
    payment_mode: Optional[str] = None  # prepaid, postpaid
    potd_congrats_delay_minutes: Optional[int] = None
    series_name: Optional[str] = None
    series_day: Optional[str] = None


class SeriesDay(BaseModel):
    day: str  # Monday, Tuesday, ...
    time: str  # HH:MM


class CreateSeriesRequest(BaseModel):
    series_name: str
    sport_type: str
    ground_name: str
    max_players: int
    cost_per_person: float
    duration_minutes: int = 90
    payee_user_id: Optional[int] = None
    quit_penalty_hours: int = 0
    payment_mode: str = "postpaid"
    potd_congrats_delay_minutes: int = 1440
    recurrence_days: List[SeriesDay]
    weeks: int = 4
    start_date: Optional[str] = None  # YYYY-MM-DD; defaults to today


class NominateRequest(BaseModel):
    user_id: int
    position: str = ""


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


class MovePlayerRequest(BaseModel):
    player_user_id: int
    team_id: Optional[int] = None  # null to unassign


class CompleteGameRequest(BaseModel):
    team_a_score: Optional[int] = None
    team_b_score: Optional[int] = None
    goal_scorers: Optional[List[dict]] = None  # [{"user_id": int, "goals": int}]
    played_user_ids: Optional[List[int]] = None  # players who actually played and should pay


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


async def _payment_settings(db: aiosqlite.Connection) -> dict:
    enabled = (await get_app_setting(db, 'payments_enabled', 'false')).lower() == 'true'
    surcharge = float(await get_app_setting(db, 'payment_surcharge_percent', '7'))
    return {"enabled": enabled, "surcharge_percent": surcharge}


def _with_surcharge(amount: float, surcharge_percent: float) -> float:
    return amount * (1 + surcharge_percent / 100)


async def _check_ground_time_overlap(
    db: aiosqlite.Connection,
    ground_name: str,
    game_date: str,
    game_time: str,
    duration_minutes: int,
    exclude_game_id: Optional[int] = None
):
    """Block creation/editing of a game if another non-cancelled game overlaps on the same ground."""
    try:
        new_start = _parse_game_datetime(game_date, game_time)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid game date or time format")
    new_end = new_start + timedelta(minutes=duration_minutes)

    query = """SELECT id, title, game_date, game_time, duration_minutes, status
               FROM games
               WHERE ground_name = ? AND status != 'cancelled'"""
    params: list = [ground_name]
    if exclude_game_id is not None:
        query += " AND id != ?"
        params.append(exclude_game_id)

    cursor = await db.execute(query, params)
    async with cursor:
        async for row in cursor:
            try:
                existing_start = _parse_game_datetime(row["game_date"], row["game_time"])
            except ValueError:
                continue
            existing_end = existing_start + timedelta(minutes=row["duration_minutes"] or 90)
            if new_start < existing_end and new_end > existing_start:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Time slot conflict: '{row['title']}' ({row['game_date']} "
                        f"{row['game_time']}, status: {row['status']}) already occupies this ground. "
                        f"Only cancelled games can overlap."
                    )
                )


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
        f"""SELECT pv.player_id, u.name, u.first_name, u.phone,
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

    # Goals
    cursor = await db.execute(
        f"""SELECT gs.user_id, u.name, u.first_name, u.phone,
                   SUM(gs.goals) as total_goals,
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
            "first_name": r["first_name"],
            "phone": r["phone"],
            "potd_points": r["potd_points"],
            "first_pref_wins": r["first_pref_wins"],
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
                "first_name": r["first_name"],
                "phone": r["phone"],
                "potd_points": 0,
                "first_pref_wins": 0,
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


async def get_game_dict(db: aiosqlite.Connection, game_id: int) -> dict:
    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    # Get players
    cursor = await db.execute(
        """SELECT gp.*, u.name, u.phone FROM game_players gp 
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
        # Try sport-specific photo first
        if sport_type:
            cursor = await db.execute(
                f"SELECT user_id, filename FROM user_photos WHERE user_id IN ({placeholders}) AND purpose = ?",
                (*player_ids, sport_type)
            )
            for row in await cursor.fetchall():
                player_photo_map[row["user_id"]] = row["filename"]
        # Fill in with profile photos for those who don't have a sport-specific one
        missing_ids = [uid for uid in player_ids if uid not in player_photo_map]
        if missing_ids:
            placeholders2 = ",".join("?" * len(missing_ids))
            cursor = await db.execute(
                f"SELECT user_id, filename FROM user_photos WHERE user_id IN ({placeholders2}) AND purpose = 'profile'",
                tuple(missing_ids)
            )
            for row in await cursor.fetchall():
                if row["user_id"] not in player_photo_map:
                    player_photo_map[row["user_id"]] = row["filename"]
        # Fall back to legacy profile_pic for remaining
        still_missing = [uid for uid in player_ids if uid not in player_photo_map]
        if still_missing:
            placeholders3 = ",".join("?" * len(still_missing))
            cursor = await db.execute(
                f"SELECT id, profile_pic FROM users WHERE id IN ({placeholders3}) AND profile_pic != ''",
                tuple(still_missing)
            )
            for row in await cursor.fetchall():
                if row["id"] not in player_photo_map and row["profile_pic"]:
                    player_photo_map[row["id"]] = row["profile_pic"]

    selected = []
    waiting = []
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
                nom_info = f"Nominated by {n['name']} {n['phone']}" + (f" on {joined_display}" if joined_display else "")
            else:
                nom_info = f"Nominated by user #{nom_by}" + (f" on {joined_display}" if joined_display else "")
        else:
            nom_info = f"Self Nominated" + (f" on {joined_display}" if joined_display else "")
        player_data = {
            "id": p["id"],
            "user_id": p["user_id"],
            "name": p["name"],
            "phone": p["phone"],
            "status": p["status"],
            "position": p["position"] or "",
            "team_id": p["team_id"],
            "payment_confirmed": p["payment_confirmed"],
            "played": bool(p["played"]),
            "nominated_by": p["nominated_by"],
            "nominated_by_info": nom_info,
            "joined_at": p["joined_at"],
            "photo": player_photo_map.get(p["user_id"], ""),
        }
        if p["status"] == "selected":
            selected.append(player_data)
        else:
            waiting.append(player_data)

    # Get payee info
    payee_info = None
    if game["payee_user_id"]:
        cursor = await db.execute("SELECT id, name, phone FROM users WHERE id = ?", (game["payee_user_id"],))
        payee = await cursor.fetchone()
        if payee:
            payee_info = {"id": payee["id"], "name": payee["name"], "phone": payee["phone"]}

    # Get payment summary for players who actually played/are selected
    cursor = await db.execute(
        """SELECT COUNT(*) as total, SUM(CASE WHEN p.status='paid' THEN 1 ELSE 0 END) as paid
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
           WHERE p.game_id = ? GROUP BY p.player_id ORDER BY points DESC, total_votes DESC LIMIT 1""",
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
    teams = [{"id": t["id"], "team_name": t["team_name"], "team_order": t["team_order"]} for t in teams_rows]

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

    # Check if game is archived:
    # 1) Completed more than 7 days ago, OR
    # 2) Auto-archived because there are >10 completed games (oldest get archived)
    is_archived = False
    if game["status"] == "completed":
        try:
            game_dt = datetime.strptime(game["game_date"], "%Y-%m-%d")
            game_dt = game_dt.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            if (now - game_dt).days >= 7:
                is_archived = True
        except Exception:
            pass

        # Auto-archive: check if this game is beyond the 10 most recent completed games
        if not is_archived:
            try:
                cursor2 = await db.execute(
                    "SELECT id FROM games WHERE status = 'completed' ORDER BY game_date DESC, game_time DESC LIMIT 10"
                )
                recent_10 = await cursor2.fetchall()
                recent_10_ids = {r["id"] for r in recent_10}
                if game["id"] not in recent_10_ids:
                    is_archived = True
            except Exception:
                pass

    # Get per-player payment details for players who actually played/are selected
    cursor = await db.execute(
        """SELECT p.user_id, p.status as pay_status, p.amount, p.paid_at, u.name
           FROM payments p
           JOIN users u ON p.user_id = u.id
           JOIN game_players gp ON p.user_id = gp.user_id AND p.game_id = gp.game_id
           WHERE p.game_id = ? AND (gp.status = 'selected' OR gp.played = 1)""",
        (game_id,)
    )
    payment_rows = await cursor.fetchall()
    payment_details = [
        {
            "user_id": pr["user_id"],
            "name": pr["name"],
            "status": pr["pay_status"],
            "amount": pr["amount"],
            "paid_at": pr["paid_at"],
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
    pay_settings = await _payment_settings(db)
    base_ground_cost = game["cost_per_person"] * game["max_players"]
    ground_cost = _with_surcharge(base_ground_cost, pay_settings["surcharge_percent"]) if pay_settings["enabled"] else base_ground_cost
    if game["status"] == "completed" and selected:
        per_person_amount = ground_cost / len(selected)
    else:
        per_person_amount = _with_surcharge(game["cost_per_person"], pay_settings["surcharge_percent"]) if pay_settings["enabled"] else game["cost_per_person"]

    result = {
        "id": game["id"],
        "game_code": game_code,
        "title": game["title"],
        "sport_type": game["sport_type"],
        "ground_name": game["ground_name"],
        "game_date": game["game_date"],
        "game_time": game["game_time"],
        "max_players": game["max_players"],
        "cost_per_person": game["cost_per_person"],
        "base_ground_cost": base_ground_cost,
        "ground_cost": ground_cost,
        "per_person_amount": per_person_amount,
        "payments_enabled": pay_settings["enabled"],
        "payment_surcharge_percent": pay_settings["surcharge_percent"],
        "payment_timing": game["payment_timing"],
        "status": game["status"],
        "payee": payee_info,
        "quit_penalty_hours": quit_penalty_hours,
        "duration_minutes": duration_minutes,
        "potd_congrats_delay_minutes": potd_delay_minutes,
        "is_archived": is_archived,
        "created_by": game["created_by"],
        "created_by_name": creator["name"] if creator else None,
        "created_at": game["created_at"],
        "selected_players": selected,
        "waiting_list": waiting,
        "teams": teams,
        "payment_summary": {
            "total": pay_summary["total"] or 0,
            "paid": pay_summary["paid"] or 0,
            "pending": (pay_summary["total"] or 0) - (pay_summary["paid"] or 0)
        },
        "payment_details": payment_details,
        "player_of_the_day": potd_info,
        "game_score": None,
        "goal_scorers": [],
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
            """SELECT gs.user_id, gs.goals, u.name, u.phone
               FROM goal_scorers gs JOIN users u ON gs.user_id = u.id
               WHERE gs.game_id = ? ORDER BY gs.goals DESC""",
            (game_id,)
        )
        scorer_rows = await cursor.fetchall()
        result["goal_scorers"] = [
            {"user_id": s["user_id"], "name": s["name"], "phone": s["phone"], "goals": s["goals"]}
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
    await _check_ground_time_overlap(
        db, req.ground_name, req.game_date, req.game_time, req.duration_minutes
    )

    # Derive payment_timing from payment_mode
    payment_timing = "before" if req.payment_mode == "prepaid" else req.payment_timing

    # Generate unique game code
    from .locations_router import generate_game_code
    game_code = await generate_game_code(db, req.sport_type)

    # Build display code: SC01-Location-Ground
    ground_parts = req.ground_name.replace(' - ', '-').replace(' ', '')
    game_code_display = f"{game_code}-{ground_parts}"

    # Check if moderator has a previous game with custom POTD delay
    potd_delay = req.potd_congrats_delay_minutes
    if potd_delay == 1440:  # default value, check if user has a previous override
        prev_cursor = await db.execute(
            """SELECT potd_congrats_delay_minutes FROM games 
               WHERE created_by = ? AND potd_congrats_delay_minutes IS NOT NULL 
               ORDER BY id DESC LIMIT 1""",
            (user_id,)
        )
        prev_row = await prev_cursor.fetchone()
        if prev_row and prev_row["potd_congrats_delay_minutes"]:
            potd_delay = prev_row["potd_congrats_delay_minutes"]

    series_name = (req.series_name or req.ground_name).strip()
    series_day = (req.series_day or "").strip()
    cursor = await db.execute(
        """INSERT INTO games (title, game_code, sport_type, ground_name, game_date, game_time,
           max_players, cost_per_person, payment_timing, created_by, duration_minutes,
           payee_user_id, quit_penalty_hours, potd_congrats_delay_minutes, series_name, series_day)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (req.title, game_code_display, req.sport_type, req.ground_name, req.game_date, req.game_time,
         req.max_players, req.cost_per_person, payment_timing, user_id, req.duration_minutes,
         req.payee_user_id, req.quit_penalty_hours, potd_delay, series_name, series_day)
    )
    game_id = cursor.lastrowid
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

    day_map = {
        "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3,
        "friday": 4, "saturday": 5, "sunday": 6,
    }

    start = datetime.now()
    if req.start_date:
        try:
            start = datetime.strptime(req.start_date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="start_date must be YYYY-MM-DD")

    payment_timing = "before" if req.payment_mode == "prepaid" else "after"
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
                await _check_ground_time_overlap(
                    db, req.ground_name, date_str, time_str, req.duration_minutes
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

            # Use last created POTD delay for consistency
            potd_delay = req.potd_congrats_delay_minutes
            if potd_delay == 1440:
                prev_cursor = await db.execute(
                    """SELECT potd_congrats_delay_minutes FROM games
                       WHERE created_by = ? AND potd_congrats_delay_minutes IS NOT NULL
                       ORDER BY id DESC LIMIT 1""",
                    (user_id,)
                )
                prev_row = await prev_cursor.fetchone()
                if prev_row and prev_row["potd_congrats_delay_minutes"]:
                    potd_delay = prev_row["potd_congrats_delay_minutes"]

            cursor = await db.execute(
                """INSERT INTO games (title, game_code, sport_type, ground_name, game_date, game_time,
                   max_players, cost_per_person, payment_timing, created_by, duration_minutes,
                   payee_user_id, quit_penalty_hours, potd_congrats_delay_minutes, series_name, series_day)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (title, game_code_display, req.sport_type, req.ground_name, date_str, time_str,
                 req.max_players, req.cost_per_person, payment_timing, user_id, req.duration_minutes,
                 req.payee_user_id, req.quit_penalty_hours, potd_delay, series_name, series_day)
            )
            created_games.append(await get_game_dict(db, cursor.lastrowid))

    await db.commit()
    return {"created": created_games, "skipped": skipped}


@router.get("")
async def list_games(
    status: Optional[str] = None,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    if status:
        cursor = await db.execute("SELECT id FROM games WHERE status = ? ORDER BY game_date DESC, game_time DESC", (status,))
    else:
        cursor = await db.execute("SELECT id FROM games ORDER BY game_date DESC, game_time DESC")
    games = await cursor.fetchall()

    result = []
    for g in games:
        game_data = await get_game_dict(db, g["id"])
        result.append(game_data)
    return result


@router.get("/{game_id:int}")
async def get_game(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    return await get_game_dict(db, game_id)


@router.put("/{game_id}")
async def edit_game(
    game_id: int,
    req: EditGameRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin_or_moderator(user_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail="Cannot edit a completed or cancelled game")

    updates: list[str] = []
    params: list = []

    for field in ("title", "sport_type", "ground_name", "game_date", "game_time",
                  "max_players", "cost_per_person", "duration_minutes",
                  "payee_user_id", "quit_penalty_hours", "potd_congrats_delay_minutes",
                  "series_name", "series_day"):
        val = getattr(req, field, None)
        if val is not None:
            if field in ("series_name", "series_day"):
                val = str(val).strip()
            updates.append(f"{field} = ?")
            params.append(val)

    if req.payment_mode is not None:
        new_timing = "before" if req.payment_mode == "prepaid" else "after"
        updates.append("payment_timing = ?")
        params.append(new_timing)

    if not updates:
        return await get_game_dict(db, game_id)

    # Prevent moving a game into an occupied time slot on the same ground
    final_ground = req.ground_name if req.ground_name is not None else game["ground_name"]
    final_date = req.game_date if req.game_date is not None else game["game_date"]
    final_time = req.game_time if req.game_time is not None else game["game_time"]
    final_duration = req.duration_minutes if req.duration_minutes is not None else game["duration_minutes"]
    await _check_ground_time_overlap(
        db, final_ground, final_date, final_time, final_duration, exclude_game_id=game_id
    )

    params.append(game_id)
    await db.execute(f"UPDATE games SET {', '.join(updates)} WHERE id = ?", params)

    # Recalculate payment records for selected players when cost changes
    if req.cost_per_person is not None:
        cursor2 = await db.execute(
            "SELECT user_id FROM game_players WHERE game_id = ? AND status = 'selected'", (game_id,)
        )
        selected = await cursor2.fetchall()
        for p in selected:
            await db.execute(
                "UPDATE payments SET amount = ? WHERE game_id = ? AND user_id = ?",
                (req.cost_per_person, game_id, p["user_id"])
            )

    await db.commit()
    return await get_game_dict(db, game_id)


@router.post("/{game_id}/open-voting")
async def open_voting(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin_or_moderator(user_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] != "draft":
        raise HTTPException(status_code=400, detail="Can only open voting for draft games")

    await db.execute("UPDATE games SET status = 'voting_open' WHERE id = ?", (game_id,))

    # Notify all users
    cursor = await db.execute("SELECT id FROM users")
    all_users = await cursor.fetchall()
    for u in all_users:
        await create_notification(
            db, u["id"], game_id, "voting_opened",
            f"Voting is open for {game['title']} at {game['ground_name']} on {game['game_date']} at {game['game_time']}. Join now!"
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
    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] not in ("voting_open", "in_progress"):
        raise HTTPException(status_code=400, detail="Cannot quit at this stage")

    cursor = await db.execute("SELECT * FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, user_id))
    player = await cursor.fetchone()
    if not player:
        raise HTTPException(status_code=400, detail="Not in this game")

    was_selected = player["status"] == "selected"
    old_team_id = player["team_id"]
    must_pay = False

    # Check quit penalty
    quit_penalty_hours = 0
    try:
        quit_penalty_hours = game["quit_penalty_hours"] or 0
    except Exception:
        pass

    if quit_penalty_hours > 0 and was_selected:
        # Check if within penalty window.
        # Design: if the game is already in_progress (hours_until_game < 0),
        # penalty still applies — quitting a live game should require payment.
        # Only skip penalty when hours_until_game >= quit_penalty_hours (early quit).
        try:
            game_dt_str = f"{game['game_date']} {game['game_time']}"
            game_dt = datetime.strptime(game_dt_str, "%Y-%m-%d %H:%M")
            game_dt = game_dt.replace(tzinfo=timezone.utc)
            now = datetime.now(timezone.utc)
            hours_until_game = (game_dt - now).total_seconds() / 3600
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

    await db.commit()
    if must_pay:
        return {"message": "You have quit the game but must still pay as it is within the penalty window.", "must_pay": True}
    return {"message": "You have quit the game", "must_pay": False}


@router.post("/{game_id}/nominate")
async def nominate_player(
    game_id: int,
    req: NominateRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin_or_moderator(user_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] not in ("draft", "voting_open", "in_progress"):
        raise HTTPException(status_code=400, detail="Players can only be added to games that are draft, open for voting, or in progress")

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

    # Count selected
    cursor = await db.execute("SELECT COUNT(*) as cnt FROM game_players WHERE game_id = ? AND status = 'selected'", (game_id,))
    count_row = await cursor.fetchone()
    selected_count = count_row["cnt"]

    player_status = "selected" if selected_count < game["max_players"] else "waiting"

    await db.execute(
        "INSERT INTO game_players (game_id, user_id, status, nominated_by, position) VALUES (?, ?, ?, ?, ?)",
        (game_id, req.user_id, player_status, user_id, req.position)
    )

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

    await db.commit()
    return {"status": player_status, "message": f"User nominated as {player_status}"}


@router.post("/{game_id}/start")
async def start_game(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Start a game. Payee, quit_penalty, and payment_mode are already set
    at create/edit time — this endpoint just transitions the status."""
    await require_admin_or_moderator(user_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] != "voting_open":
        raise HTTPException(status_code=400, detail="Can only start a game that has open voting")

    await db.execute("UPDATE games SET status = 'in_progress' WHERE id = ?", (game_id,))

    # Create payment records for all selected players
    cursor = await db.execute(
        "SELECT user_id FROM game_players WHERE game_id = ? AND status = 'selected'",
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
        if game["payment_timing"] == "before" and payee_info:
            await create_notification(
                db, p["user_id"], game_id, "payment_due",
                f"Payment of {game['cost_per_person']} is due for {game['title']}. Pay to {payee_info['name']} ({payee_info['phone']})"
            )

    await db.commit()
    return await get_game_dict(db, game_id)


@router.post("/{game_id}/complete")
async def complete_game(
    game_id: int,
    req: CompleteGameRequest = CompleteGameRequest(),
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin_or_moderator(user_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] != "in_progress":
        raise HTTPException(status_code=400, detail="Can only complete an in-progress game")

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

    await db.execute("UPDATE games SET status = 'completed' WHERE id = ?", (game_id,))

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

    # Get payee info
    payee_name = ""
    payee_phone = ""
    if game["payee_user_id"]:
        cursor = await db.execute("SELECT name, phone FROM users WHERE id = ?", (game["payee_user_id"],))
        payee = await cursor.fetchone()
        if payee:
            payee_name = payee["name"]
            payee_phone = payee["phone"]

    # Calculate per-person amount based on ground booking cost (cost_per_person * max_players)
    # split among the players who actually played. If in-app payments are enabled, include surcharge.
    pay_settings = await _payment_settings(db)
    base_ground_cost = game["cost_per_person"] * game["max_players"]
    ground_cost = _with_surcharge(base_ground_cost, pay_settings["surcharge_percent"]) if pay_settings["enabled"] else base_ground_cost
    per_person_amount = ground_cost / len(played_user_ids)

    # Remove pending payment obligations for unplayed players.
    unplayed_ids = [uid for uid in all_player_ids if uid not in played_set]
    if unplayed_ids:
        placeholders = ",".join("?" * len(unplayed_ids))
        await db.execute(
            f"DELETE FROM payments WHERE game_id = ? AND user_id IN ({placeholders}) AND status = 'pending'",
            (game_id, *unplayed_ids)
        )

    # Update/insert payment records for players who played.
    placeholders = ",".join("?" * len(played_user_ids))
    # Update existing pending payments to the recalculated per-person amount.
    await db.execute(
        f"""UPDATE payments SET amount = ?
            WHERE game_id = ? AND user_id IN ({placeholders}) AND status = 'pending'""",
        (per_person_amount, game_id, *played_user_ids)
    )
    # Insert pending payments for played players that do not yet have one.
    for uid in played_user_ids:
        await db.execute(
            "INSERT OR IGNORE INTO payments (game_id, user_id, amount, status) VALUES (?, ?, ?, 'pending')",
            (game_id, uid, per_person_amount)
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
                f"Game '{game['title']}' has been completed! Vote for Player of the Day."
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
    await require_admin_or_moderator(user_id, db)

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
        "SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as total_paid FROM payments WHERE game_id = ? AND status = 'paid'",
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
    await require_admin_or_moderator(user_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] == "completed":
        raise HTTPException(status_code=400, detail="Cannot cancel a completed game")
    if game["status"] == "cancelled":
        raise HTTPException(status_code=400, detail="Game is already cancelled")

    await db.execute("UPDATE games SET status = 'cancelled' WHERE id = ?", (game_id,))

    cancel_detail = (
        f"Game '{game['title']}' on {game['game_date']} at {game['game_time']} "
        f"at {game['ground_name']} has been cancelled."
    )

    # Refund paid players
    cursor = await db.execute(
        "SELECT user_id, amount FROM payments WHERE game_id = ? AND status = 'paid'",
        (game_id,)
    )
    paid_players = await cursor.fetchall()
    for pp in paid_players:
        await db.execute(
            "UPDATE payments SET status = 'pending' WHERE game_id = ? AND user_id = ?",
            (game_id, pp["user_id"])
        )
        await create_notification(
            db, pp["user_id"], game_id, "game_cancelled",
            f"{cancel_detail} Your payment of {pp['amount']} has been marked for refund."
        )

    # Clear pending payments for players who quit with penalty (no longer in game_players)
    paid_user_ids = {pp["user_id"] for pp in paid_players}
    cursor = await db.execute(
        "SELECT user_id FROM game_players WHERE game_id = ?", (game_id,)
    )
    all_players = await cursor.fetchall()
    game_player_user_ids = {p["user_id"] for p in all_players}

    cursor = await db.execute(
        "SELECT user_id, amount FROM payments WHERE game_id = ? AND status = 'pending'",
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
    """Permanently delete a draft or cancelled game and all related records."""
    await require_admin_moderator_or_ground_management(user_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] not in ("draft", "cancelled"):
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
        voting_deadline = game_end_dt + timedelta(hours=24)
        now = datetime.now()
        if now < game_end_dt:
            raise HTTPException(status_code=400, detail="Voting opens after the game ends")
        if now > voting_deadline:
            raise HTTPException(status_code=400, detail="Voting window has closed (24 hours after game end)")
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
    await require_admin_or_moderator(user_id, db)

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
            voting_deadline = game_end_dt + timedelta(hours=24)
            voting_deadline_str = voting_deadline.strftime("%Y-%m-%d %H:%M")
            now = datetime.now()
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
    await require_admin_or_moderator(user_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    # Delete existing teams for this game
    await db.execute("UPDATE game_players SET team_id = NULL WHERE game_id = ?", (game_id,))
    await db.execute("DELETE FROM game_teams WHERE game_id = ?", (game_id,))

    # Create new teams
    for i, name in enumerate(req.team_names):
        await db.execute(
            "INSERT INTO game_teams (game_id, team_name, team_order) VALUES (?, ?, ?)",
            (game_id, name, i)
        )

    await db.commit()
    return await get_game_dict(db, game_id)


@router.post("/{game_id}/teams/move-player")
async def move_player_to_team(
    game_id: int,
    req: MovePlayerRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin_or_moderator(user_id, db)

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
    await require_admin_or_moderator(user_id, db)
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
        game_dt = game_dt.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        hours_until_game = (game_dt - now).total_seconds() / 3600
        must_pay = hours_until_game < quit_penalty_hours
        return {
            "has_penalty": True,
            "quit_penalty_hours": quit_penalty_hours,
            "hours_until_game": round(hours_until_game, 1),
            "must_pay": must_pay
        }
    except Exception:
        return {"has_penalty": True, "quit_penalty_hours": quit_penalty_hours, "must_pay": False}


@router.post("/{game_id}/mark-paid")
async def mark_payment_made(
    game_id: int,
    req: MarkPaymentRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Moderator marks a user's payment as made from backend."""
    await require_admin_or_moderator(user_id, db)

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
        await db.execute(
            "INSERT INTO payments (game_id, user_id, amount, status, paid_at) VALUES (?, ?, ?, 'paid', ?)",
            (game_id, req.user_id, game["cost_per_person"], now)
        )
    elif payment["status"] != "paid":
        now = datetime.now(timezone.utc).isoformat()
        await db.execute(
            "UPDATE payments SET status = 'paid', paid_at = ? WHERE game_id = ? AND user_id = ?",
            (now, game_id, req.user_id)
        )

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

    await db.commit()
    return await get_game_dict(db, game_id)


@router.post("/{game_id}/remind-unpaid")
async def remind_unpaid_players(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Moderator sends payment reminder to all unpaid players."""
    await require_admin_or_moderator(user_id, db)

    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    # Get unpaid players
    cursor = await db.execute(
        """SELECT p.user_id, u.name, u.phone, u.notification_preference
           FROM payments p JOIN users u ON p.user_id = u.id
           WHERE p.game_id = ? AND p.status = 'pending'""",
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

    # Goals by sport
    cursor = await db.execute(
        """SELECT g.sport_type, SUM(gs.goals) as total_goals
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

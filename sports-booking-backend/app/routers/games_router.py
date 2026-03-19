from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import aiosqlite
from datetime import datetime, timezone

from ..database import get_db
from ..auth import get_current_user_id

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


class NominateRequest(BaseModel):
    user_id: int
    position: str = ""


class StartGameRequest(BaseModel):
    """Start game no longer requires payee/penalty/mode — those are set at create/edit time."""
    pass


class VotePOTDRequest(BaseModel):
    player_id: int


class VoteJoinRequest(BaseModel):
    position: str = ""


class CreateTeamsRequest(BaseModel):
    team_names: List[str]  # e.g. ["Team A", "Team B"]


class MovePlayerRequest(BaseModel):
    player_user_id: int
    team_id: Optional[int] = None  # null to unassign


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

    selected = []
    waiting = []
    for p in players_rows:
        nom_by = p["nominated_by"]
        nom_info = None
        if nom_by:
            if nom_by == p["user_id"]:
                nom_info = "Self Nominated"
            elif nom_by in nominator_map:
                n = nominator_map[nom_by]
                nom_info = f"Nominated by {n['name']} {n['phone']}"
            else:
                nom_info = f"Nominated by user #{nom_by}"
        else:
            nom_info = "Self Nominated"
        player_data = {
            "id": p["id"],
            "user_id": p["user_id"],
            "name": p["name"],
            "phone": p["phone"],
            "status": p["status"],
            "position": p["position"] or "",
            "team_id": p["team_id"],
            "payment_confirmed": p["payment_confirmed"],
            "nominated_by": p["nominated_by"],
            "nominated_by_info": nom_info,
            "joined_at": p["joined_at"]
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

    # Get payment summary
    cursor = await db.execute(
        "SELECT COUNT(*) as total, SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) as paid FROM payments WHERE game_id = ?",
        (game_id,)
    )
    pay_summary = await cursor.fetchone()

    # Get POTD
    cursor = await db.execute(
        """SELECT p.player_id, u.name, COUNT(*) as votes 
           FROM potd_votes p JOIN users u ON p.player_id = u.id 
           WHERE p.game_id = ? GROUP BY p.player_id ORDER BY votes DESC LIMIT 1""",
        (game_id,)
    )
    potd = await cursor.fetchone()
    potd_info = None
    if potd:
        potd_info = {"player_id": potd["player_id"], "name": potd["name"], "votes": potd["votes"]}

    # Get creator info
    cursor = await db.execute("SELECT name FROM users WHERE id = ?", (game["created_by"],))
    creator = await cursor.fetchone()

    # Get teams
    cursor = await db.execute(
        "SELECT * FROM game_teams WHERE game_id = ? ORDER BY team_order", (game_id,)
    )
    teams_rows = await cursor.fetchall()
    teams = [{"id": t["id"], "team_name": t["team_name"], "team_order": t["team_order"]} for t in teams_rows]

    # Get quit_penalty_hours and duration
    quit_penalty_hours = 0
    duration_minutes = 90
    try:
        quit_penalty_hours = game["quit_penalty_hours"] or 0
    except Exception:
        pass
    try:
        duration_minutes = game["duration_minutes"] or 90
    except Exception:
        pass

    # Check if game is archived (completed > 7 days ago)
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

    # Get per-player payment details
    cursor = await db.execute(
        """SELECT p.user_id, p.status as pay_status, p.amount, p.paid_at, u.name
           FROM payments p JOIN users u ON p.user_id = u.id
           WHERE p.game_id = ?""",
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

    return {
        "id": game["id"],
        "title": game["title"],
        "sport_type": game["sport_type"],
        "ground_name": game["ground_name"],
        "game_date": game["game_date"],
        "game_time": game["game_time"],
        "max_players": game["max_players"],
        "cost_per_person": game["cost_per_person"],
        "payment_timing": game["payment_timing"],
        "status": game["status"],
        "payee": payee_info,
        "quit_penalty_hours": quit_penalty_hours,
        "duration_minutes": duration_minutes,
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
        "player_of_the_day": potd_info
    }


@router.post("")
async def create_game(
    req: CreateGameRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_role(user_id, "admin", db)

    # Derive payment_timing from payment_mode
    payment_timing = "before" if req.payment_mode == "prepaid" else req.payment_timing

    cursor = await db.execute(
        """INSERT INTO games (title, sport_type, ground_name, game_date, game_time, 
           max_players, cost_per_person, payment_timing, created_by, duration_minutes,
           payee_user_id, quit_penalty_hours) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (req.title, req.sport_type, req.ground_name, req.game_date, req.game_time,
         req.max_players, req.cost_per_person, payment_timing, user_id, req.duration_minutes,
         req.payee_user_id, req.quit_penalty_hours)
    )
    game_id = cursor.lastrowid
    await db.commit()

    return await get_game_dict(db, game_id)


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


@router.get("/{game_id}")
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
    if game["status"] in ("completed",):
        raise HTTPException(status_code=400, detail="Cannot edit a completed game")

    updates: list[str] = []
    params: list = []

    for field in ("title", "sport_type", "ground_name", "game_date", "game_time",
                  "max_players", "cost_per_person", "duration_minutes",
                  "payee_user_id", "quit_penalty_hours"):
        val = getattr(req, field, None)
        if val is not None:
            updates.append(f"{field} = ?")
            params.append(val)

    if req.payment_mode is not None:
        new_timing = "before" if req.payment_mode == "prepaid" else "after"
        updates.append("payment_timing = ?")
        params.append(new_timing)

    if not updates:
        return await get_game_dict(db, game_id)

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
    await require_role(user_id, "admin", db)

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

    # Check if already joined
    cursor = await db.execute("SELECT id FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, user_id))
    if await cursor.fetchone():
        raise HTTPException(status_code=400, detail="Already joined this game")

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
    if game["status"] != "voting_open":
        raise HTTPException(status_code=400, detail="Voting is not open")

    # Check if user exists
    cursor = await db.execute("SELECT id FROM users WHERE id = ?", (req.user_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="User not found")

    # Check if already joined
    cursor = await db.execute("SELECT id FROM game_players WHERE game_id = ? AND user_id = ?", (game_id, req.user_id))
    if await cursor.fetchone():
        raise HTTPException(status_code=400, detail="User already in this game")

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

    # Notify nominated user
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

    await db.execute("UPDATE games SET status = 'completed' WHERE id = ?", (game_id,))

    # Get payee info
    payee_name = ""
    payee_phone = ""
    if game["payee_user_id"]:
        cursor = await db.execute("SELECT name, phone FROM users WHERE id = ?", (game["payee_user_id"],))
        payee = await cursor.fetchone()
        if payee:
            payee_name = payee["name"]
            payee_phone = payee["phone"]

    # If payment timing is 'after', create payment records and notify
    if game["payment_timing"] == "after":
        cursor = await db.execute(
            "SELECT user_id FROM game_players WHERE game_id = ? AND status = 'selected'",
            (game_id,)
        )
        selected = await cursor.fetchall()
        for p in selected:
            await db.execute(
                "INSERT OR IGNORE INTO payments (game_id, user_id, amount) VALUES (?, ?, ?)",
                (game_id, p["user_id"], game["cost_per_person"])
            )
            await create_notification(
                db, p["user_id"], game_id, "payment_due",
                f"Game completed! Payment of ${game['cost_per_person']:.2f} is due for {game['title']}. Pay to {payee_name} ({payee_phone})"
            )
    else:
        # Notify about game completion
        cursor = await db.execute(
            "SELECT user_id FROM game_players WHERE game_id = ? AND status = 'selected'",
            (game_id,)
        )
        selected = await cursor.fetchall()
        for p in selected:
            await create_notification(
                db, p["user_id"], game_id, "game_completed",
                f"Game '{game['title']}' has been completed! Vote for Player of the Day."
            )

    await db.commit()
    return await get_game_dict(db, game_id)


@router.post("/{game_id}/cancel")
async def cancel_game(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Cancel a game. Only admin or moderator can cancel."""
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

    # Notify all players
    cursor = await db.execute(
        "SELECT user_id FROM game_players WHERE game_id = ?", (game_id,)
    )
    players = await cursor.fetchall()
    for p in players:
        await create_notification(
            db, p["user_id"], game_id, "game_cancelled",
            f"Game '{game['title']}' has been cancelled."
        )

    await db.commit()
    return await get_game_dict(db, game_id)


@router.post("/{game_id}/vote-potd")
async def vote_player_of_the_day(
    game_id: int,
    req: VotePOTDRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    cursor = await db.execute("SELECT * FROM games WHERE id = ?", (game_id,))
    game = await cursor.fetchone()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game["status"] != "completed":
        raise HTTPException(status_code=400, detail="Can only vote after game is completed")

    # Check voter was a player
    cursor = await db.execute(
        "SELECT id FROM game_players WHERE game_id = ? AND user_id = ? AND status = 'selected'",
        (game_id, user_id)
    )
    if not await cursor.fetchone():
        raise HTTPException(status_code=403, detail="Only selected players can vote")

    # Prevent self-voting
    if req.player_id == user_id:
        raise HTTPException(status_code=400, detail="Cannot vote for yourself")

    # Check player being voted for was in the game
    cursor = await db.execute(
        "SELECT id FROM game_players WHERE game_id = ? AND user_id = ? AND status = 'selected'",
        (game_id, req.player_id)
    )
    if not await cursor.fetchone():
        raise HTTPException(status_code=400, detail="Voted player was not in this game")

    # Check already voted
    cursor = await db.execute("SELECT id FROM potd_votes WHERE game_id = ? AND voter_id = ?", (game_id, user_id))
    existing = await cursor.fetchone()
    if existing:
        # Update vote
        await db.execute(
            "UPDATE potd_votes SET player_id = ? WHERE game_id = ? AND voter_id = ?",
            (req.player_id, game_id, user_id)
        )
    else:
        await db.execute(
            "INSERT INTO potd_votes (game_id, voter_id, player_id) VALUES (?, ?, ?)",
            (game_id, user_id, req.player_id)
        )

    await db.commit()
    return {"message": "Vote recorded"}


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
    cursor = await db.execute(
        """SELECT p.player_id, u.name, COUNT(*) as votes 
           FROM potd_votes p JOIN users u ON p.player_id = u.id 
           WHERE p.game_id = ? GROUP BY p.player_id ORDER BY votes DESC""",
        (game_id,)
    )
    results = await cursor.fetchall()

    return {
        "results": [{"player_id": r["player_id"], "name": r["name"], "votes": r["votes"]} for r in results],
        "man_of_the_match": {"player_id": results[0]["player_id"], "name": results[0]["name"], "votes": results[0]["votes"]} if results else None
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

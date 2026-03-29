from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import aiosqlite
from datetime import datetime, timedelta

from ..database import get_db
from ..auth import get_current_user_id

router = APIRouter(prefix="/api/locations", tags=["locations"])


async def require_admin_or_moderator(user_id: int, db: aiosqlite.Connection):
    cursor = await db.execute(
        "SELECT role FROM user_roles WHERE user_id = ? AND role IN ('admin', 'moderator')", (user_id,)
    )
    if not await cursor.fetchone():
        raise HTTPException(status_code=403, detail="Admin or Moderator access required")


async def require_admin(user_id: int, db: aiosqlite.Connection):
    cursor = await db.execute("SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=403, detail="Admin access required")


class AddLocationRequest(BaseModel):
    name: str


class AddGroundRequest(BaseModel):
    name: str
    location: str


class AssignModeratorLocationRequest(BaseModel):
    user_id: int
    location: str
    ground_name: str = ""
    sport_type: str = ""


class RemoveModeratorLocationRequest(BaseModel):
    user_id: int
    location: str
    ground_name: str = ""
    sport_type: str = ""


class AssignGroundManagementRequest(BaseModel):
    user_id: int
    ground_id: int


class RenameLocationRequest(BaseModel):
    new_name: str


class RenameGroundRequest(BaseModel):
    new_name: str


# --- Locations ---

@router.get("")
async def list_locations(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    cursor = await db.execute("SELECT * FROM locations ORDER BY name")
    rows = await cursor.fetchall()
    return [{"id": r["id"], "name": r["name"], "created_at": r["created_at"]} for r in rows]


@router.post("")
async def add_location(
    req: AddLocationRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin_or_moderator(user_id, db)
    try:
        cursor = await db.execute(
            "INSERT INTO locations (name, created_by) VALUES (?, ?)",
            (req.name, user_id)
        )
        await db.commit()
        return {"id": cursor.lastrowid, "name": req.name, "message": "Location added"}
    except Exception:
        raise HTTPException(status_code=400, detail="Location already exists")


# --- Grounds ---

@router.get("/grounds/search")
async def search_grounds_public(
    location: Optional[str] = None,
    ground_name: Optional[str] = None,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Public endpoint: any user can search grounds and see moderators + phone numbers."""
    query = "SELECT * FROM grounds WHERE 1=1"
    params: list = []
    if location:
        query += " AND location = ?"
        params.append(location)
    if ground_name:
        escaped = ground_name.replace('%', '\\%').replace('_', '\\_')
        query += " AND (name LIKE ? ESCAPE '\\' OR location LIKE ? ESCAPE '\\')"
        params.extend([f"%{escaped}%", f"%{escaped}%"])
    query += " ORDER BY location, name"
    cursor = await db.execute(query, params)
    grounds_rows = await cursor.fetchall()

    results = []
    for g in grounds_rows:
        # Get moderators for this ground
        mod_cursor = await db.execute(
            """SELECT ml.*, u.name as user_name, u.phone as user_phone
               FROM moderator_locations ml JOIN users u ON ml.user_id = u.id
               WHERE ml.location = ? AND (ml.ground_name = ? OR ml.ground_name = '')
               ORDER BY u.name""",
            (g["location"], g["name"])
        )
        mod_rows = await mod_cursor.fetchall()
        moderators = [
            {
                "user_id": m["user_id"],
                "name": m["user_name"],
                "phone": m["user_phone"],
                "sport_type": m["sport_type"] or "All Sports",
            }
            for m in mod_rows
        ]
        results.append({
            "id": g["id"],
            "name": g["name"],
            "location": g["location"],
            "display_name": f"{g['location']} - {g['name']}",
            "is_approved": g["is_approved"],
            "moderators": moderators,
        })
    return results


@router.get("/grounds")
async def list_grounds(
    location: Optional[str] = None,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    if location:
        cursor = await db.execute(
            "SELECT * FROM grounds WHERE location = ? ORDER BY name", (location,)
        )
    else:
        cursor = await db.execute("SELECT * FROM grounds ORDER BY location, name")
    rows = await cursor.fetchall()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "location": r["location"],
            "display_name": f"{r['location']} - {r['name']}",
            "is_approved": r["is_approved"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.post("/grounds")
async def add_ground(
    req: AddGroundRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin_or_moderator(user_id, db)

    # Check if user is admin
    cursor = await db.execute("SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,))
    is_admin = await cursor.fetchone() is not None
    approved = 1 if is_admin else 1  # auto-approve for now

    try:
        cursor = await db.execute(
            "INSERT INTO grounds (name, location, created_by, is_approved) VALUES (?, ?, ?, ?)",
            (req.name, req.location, user_id, approved)
        )
        await db.commit()

        # If not admin, notify admins about new ground
        if not is_admin:
            admin_cursor = await db.execute(
                "SELECT user_id FROM user_roles WHERE role = 'admin'"
            )
            admins = await admin_cursor.fetchall()
            for admin in admins:
                await db.execute(
                    "INSERT INTO notifications (user_id, type, message) VALUES (?, 'new_ground', ?)",
                    (admin["user_id"], f"New ground added: {req.location} - {req.name}. Please review.")
                )
            await db.commit()

        return {
            "id": cursor.lastrowid,
            "name": req.name,
            "location": req.location,
            "display_name": f"{req.location} - {req.name}",
            "message": "Ground added"
        }
    except Exception:
        raise HTTPException(status_code=400, detail="Ground already exists for this location")


# --- Rename Location (admin only) ---

@router.put("/{location_id}/rename")
async def rename_location(
    location_id: int,
    req: RenameLocationRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)
    cursor = await db.execute("SELECT * FROM locations WHERE id = ?", (location_id,))
    loc = await cursor.fetchone()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    old_name = loc["name"]
    try:
        await db.execute("UPDATE locations SET name = ? WHERE id = ?", (req.new_name, location_id))
        # Update references in grounds and moderator_locations
        await db.execute("UPDATE grounds SET location = ? WHERE location = ?", (req.new_name, old_name))
        await db.execute("UPDATE moderator_locations SET location = ? WHERE location = ?", (req.new_name, old_name))
        # Update game ground_name references that use "{location} - {ground}" format
        await db.execute("UPDATE games SET ground_name = REPLACE(ground_name, ?, ?) WHERE ground_name LIKE ?", (old_name + ' - ', req.new_name + ' - ', old_name + ' - %'))
        await db.commit()
        return {"message": "Location renamed", "old_name": old_name, "new_name": req.new_name}
    except Exception:
        raise HTTPException(status_code=400, detail="Location name already exists")


# --- Rename Ground (admin or moderator of that ground) ---

@router.put("/grounds/{ground_id}/rename")
async def rename_ground(
    ground_id: int,
    req: RenameGroundRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin_or_moderator(user_id, db)
    cursor = await db.execute("SELECT * FROM grounds WHERE id = ?", (ground_id,))
    ground = await cursor.fetchone()
    if not ground:
        raise HTTPException(status_code=404, detail="Ground not found")

    # Check if moderator has access to this ground
    admin_cursor = await db.execute("SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,))
    is_admin = await admin_cursor.fetchone() is not None
    if not is_admin:
        mod_cursor = await db.execute(
            "SELECT id FROM moderator_locations WHERE user_id = ? AND location = ? AND (ground_name = ? OR ground_name = '')",
            (user_id, ground["location"], ground["name"])
        )
        if not await mod_cursor.fetchone():
            raise HTTPException(status_code=403, detail="You are not a moderator for this ground")

    old_name = ground["name"]
    try:
        await db.execute("UPDATE grounds SET name = ? WHERE id = ?", (req.new_name, ground_id))
        # Update moderator_locations references
        await db.execute(
            "UPDATE moderator_locations SET ground_name = ? WHERE location = ? AND ground_name = ?",
            (req.new_name, ground["location"], old_name)
        )
        # Update game ground_name references
        old_display = f"{ground['location']} - {old_name}"
        new_display = f"{ground['location']} - {req.new_name}"
        await db.execute("UPDATE games SET ground_name = ? WHERE ground_name = ?", (new_display, old_display))
        await db.execute("UPDATE games SET ground_name = ? WHERE ground_name = ?", (req.new_name, old_name))
        await db.commit()
        return {"message": "Ground renamed", "old_name": old_name, "new_name": req.new_name}
    except Exception:
        raise HTTPException(status_code=400, detail="Ground name already exists for this location")


# --- Delete Ground (admin only, no games played) ---

@router.delete("/grounds/{ground_id}")
async def delete_ground(
    ground_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)
    cursor = await db.execute("SELECT * FROM grounds WHERE id = ?", (ground_id,))
    ground = await cursor.fetchone()
    if not ground:
        raise HTTPException(status_code=404, detail="Ground not found")

    # Check if any game was played on this ground
    display_name = f"{ground['location']} - {ground['name']}"
    game_cursor = await db.execute(
        "SELECT id FROM games WHERE ground_name = ? OR ground_name = ?",
        (display_name, ground["name"])
    )
    if await game_cursor.fetchone():
        raise HTTPException(status_code=400, detail="Cannot delete ground: games have been played on it")

    # Remove moderator assignments for this ground
    await db.execute(
        "DELETE FROM moderator_locations WHERE location = ? AND ground_name = ?",
        (ground["location"], ground["name"])
    )
    await db.execute("DELETE FROM grounds WHERE id = ?", (ground_id,))
    await db.commit()
    return {"message": "Ground deleted"}


# --- Ground Players: see who played/is voting on a ground for a sport ---

@router.get("/grounds/{ground_id}/players")
async def get_ground_players(
    ground_id: int,
    sport_type: Optional[str] = None,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    cursor = await db.execute("SELECT * FROM grounds WHERE id = ?", (ground_id,))
    ground = await cursor.fetchone()
    if not ground:
        raise HTTPException(status_code=404, detail="Ground not found")

    display_name = f"{ground['location']} - {ground['name']}"
    # Find games on this ground
    query = "SELECT * FROM games WHERE (ground_name = ? OR ground_name = ?)"
    params: list = [display_name, ground["name"]]
    if sport_type:
        query += " AND sport_type = ?"
        params.append(sport_type)
    query += " ORDER BY game_date DESC, game_time DESC"

    game_cursor = await db.execute(query, params)
    game_rows = await game_cursor.fetchall()

    games_info = []
    for g in game_rows:
        players_cursor = await db.execute(
            """SELECT gp.status, gp.position, u.name, u.id as user_id
               FROM game_players gp JOIN users u ON gp.user_id = u.id
               WHERE gp.game_id = ? ORDER BY gp.joined_at""",
            (g["id"],)
        )
        players = await players_cursor.fetchall()
        games_info.append({
            "game_id": g["id"],
            "title": g["title"],
            "sport_type": g["sport_type"],
            "status": g["status"],
            "game_date": g["game_date"],
            "game_time": g["game_time"],
            "players": [
                {"user_id": p["user_id"], "name": p["name"], "status": p["status"], "position": p["position"] or ""}
                for p in players
            ]
        })

    return {"ground": display_name, "games": games_info}


# --- Moderator-Location Assignments ---

@router.get("/moderator-assignments")
async def list_moderator_assignments(
    location: Optional[str] = None,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)
    if location:
        cursor = await db.execute(
            """SELECT ml.*, u.name as user_name, u.phone as user_phone
               FROM moderator_locations ml JOIN users u ON ml.user_id = u.id
               WHERE ml.location = ? ORDER BY u.name""",
            (location,)
        )
    else:
        cursor = await db.execute(
            """SELECT ml.*, u.name as user_name, u.phone as user_phone
               FROM moderator_locations ml JOIN users u ON ml.user_id = u.id
               ORDER BY ml.location, u.name"""
        )
    rows = await cursor.fetchall()
    results = []
    for r in rows:
        sport_type = ""
        try:
            sport_type = r["sport_type"] or ""
        except Exception:
            pass
        results.append({
            "id": r["id"],
            "user_id": r["user_id"],
            "user_name": r["user_name"],
            "user_phone": r["user_phone"],
            "location": r["location"],
            "ground_name": r["ground_name"],
            "sport_type": sport_type,
        })
    return results


@router.post("/moderator-assignments")
async def assign_moderator_location(
    req: AssignModeratorLocationRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)

    # Auto-grant moderator role if user doesn't already have it
    await db.execute(
        "INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'moderator')",
        (req.user_id,)
    )
    await db.commit()

    try:
        await db.execute(
            "INSERT INTO moderator_locations (user_id, location, ground_name, sport_type) VALUES (?, ?, ?, ?)",
            (req.user_id, req.location, req.ground_name, req.sport_type)
        )
        await db.commit()
        return {"message": "Moderator assigned to location"}
    except Exception:
        raise HTTPException(status_code=400, detail="Assignment already exists")


@router.delete("/moderator-assignments/{assignment_id}")
async def remove_moderator_assignment(
    assignment_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)
    await db.execute("DELETE FROM moderator_locations WHERE id = ?", (assignment_id,))
    await db.commit()
    return {"message": "Assignment removed"}


# --- Ground Management Assignments ---

@router.get("/ground-management-assignments")
async def list_ground_management_assignments(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """List ground management assignments. Admin sees all, ground_management role sees their own."""
    cursor = await db.execute("SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,))
    is_admin = await cursor.fetchone() is not None

    if is_admin:
        cursor = await db.execute(
            """SELECT gma.id, gma.user_id, gma.ground_id, gma.created_at,
                      u.name as user_name, u.first_name, u.phone as user_phone,
                      g.name as ground_name, g.location
               FROM ground_management_assignments gma
               JOIN users u ON gma.user_id = u.id
               JOIN grounds g ON gma.ground_id = g.id
               ORDER BY g.location, g.name, u.name"""
        )
    else:
        cursor = await db.execute(
            """SELECT gma.id, gma.user_id, gma.ground_id, gma.created_at,
                      u.name as user_name, u.first_name, u.phone as user_phone,
                      g.name as ground_name, g.location
               FROM ground_management_assignments gma
               JOIN users u ON gma.user_id = u.id
               JOIN grounds g ON gma.ground_id = g.id
               WHERE gma.user_id = ?
               ORDER BY g.location, g.name""",
            (user_id,)
        )
    rows = await cursor.fetchall()
    return [
        {
            "id": r["id"],
            "user_id": r["user_id"],
            "user_name": r["user_name"],
            "user_phone": r["user_phone"],
            "ground_id": r["ground_id"],
            "ground_name": r["ground_name"],
            "location": r["location"],
            "display_name": f"{r['location']} - {r['ground_name']}",
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.post("/ground-management-assignments")
async def assign_ground_management(
    req: AssignGroundManagementRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)

    # Verify ground exists
    cursor = await db.execute("SELECT id FROM grounds WHERE id = ?", (req.ground_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Ground not found")

    # Verify target user exists
    cursor = await db.execute("SELECT id FROM users WHERE id = ?", (req.user_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="User not found")

    # Auto-grant ground_management role if user doesn't already have it
    await db.execute(
        "INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'ground_management')",
        (req.user_id,)
    )

    try:
        await db.execute(
            "INSERT INTO ground_management_assignments (user_id, ground_id, assigned_by) VALUES (?, ?, ?)",
            (req.user_id, req.ground_id, user_id)
        )
        await db.commit()
        return {"message": "Ground management assigned"}
    except Exception:
        raise HTTPException(status_code=400, detail="Assignment already exists")


@router.delete("/ground-management-assignments/{assignment_id}")
async def remove_ground_management_assignment(
    assignment_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await require_admin(user_id, db)
    await db.execute("DELETE FROM ground_management_assignments WHERE id = ?", (assignment_id,))
    await db.commit()
    return {"message": "Assignment removed"}


# --- Ground Schedule / Gantt Chart Data ---

@router.get("/grounds/{ground_id}/schedule")
async def get_ground_schedule(
    ground_id: int,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Get schedule data for a ground (for Gantt chart view).
    Accessible by admin and ground_management users assigned to this ground.
    Returns games within the date range with status, timing, and details.
    """
    # Check access: admin or ground_management for this ground
    cursor = await db.execute("SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,))
    is_admin = await cursor.fetchone() is not None

    if not is_admin:
        cursor = await db.execute(
            "SELECT role FROM user_roles WHERE user_id = ? AND role = 'ground_management'", (user_id,)
        )
        is_gm = await cursor.fetchone() is not None
        if not is_gm:
            raise HTTPException(status_code=403, detail="Ground Management or Admin access required")

        # Check if assigned to this ground
        cursor = await db.execute(
            "SELECT id FROM ground_management_assignments WHERE user_id = ? AND ground_id = ?",
            (user_id, ground_id)
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=403, detail="Not assigned to this ground")

    # Get ground info
    cursor = await db.execute("SELECT * FROM grounds WHERE id = ?", (ground_id,))
    ground = await cursor.fetchone()
    if not ground:
        raise HTTPException(status_code=404, detail="Ground not found")

    display_name = f"{ground['location']} - {ground['name']}"

    # Default date range: last 30 days to next 30 days
    if not start_date:
        start_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")
    if not end_date:
        end_date = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")

    # Fetch games for this ground in date range
    cursor = await db.execute(
        """SELECT g.*, u.name as creator_name, u.phone as creator_phone
           FROM games g
           LEFT JOIN users u ON g.created_by = u.id
           WHERE (g.ground_name = ? OR g.ground_name = ?)
             AND g.game_date >= ? AND g.game_date <= ?
           ORDER BY g.game_date, g.game_time""",
        (display_name, ground["name"], start_date, end_date)
    )
    game_rows = await cursor.fetchall()

    schedule = []
    for g in game_rows:
        # Get player count
        p_cursor = await db.execute(
            "SELECT COUNT(*) as cnt FROM game_players WHERE game_id = ? AND status = 'selected'",
            (g["id"],)
        )
        player_count = (await p_cursor.fetchone())["cnt"]

        # Get moderators for this ground
        mod_cursor = await db.execute(
            """SELECT u.name, u.phone FROM moderator_locations ml
               JOIN users u ON ml.user_id = u.id
               WHERE ml.location = ? AND (ml.ground_name = ? OR ml.ground_name = '')""",
            (ground["location"], ground["name"])
        )
        moderators = [{"name": m["name"], "phone": m["phone"]} for m in await mod_cursor.fetchall()]

        # Calculate end time
        duration = 90
        try:
            duration = g["duration_minutes"] or 90
        except Exception:
            pass

        schedule.append({
            "game_id": g["id"],
            "title": g["title"] or "Regular Game",
            "sport_type": g["sport_type"],
            "status": g["status"],
            "game_date": g["game_date"],
            "game_time": g["game_time"],
            "duration_minutes": duration,
            "max_players": g["max_players"],
            "current_players": player_count,
            "cost_per_person": g["cost_per_person"],
            "created_by": g["creator_name"],
            "creator_phone": g["creator_phone"],
            "moderators": moderators,
        })

    return {
        "ground_id": ground_id,
        "ground_name": display_name,
        "location": ground["location"],
        "start_date": start_date,
        "end_date": end_date,
        "schedule": schedule,
    }


# --- My Managed Grounds (for ground_management role) ---

@router.get("/my-managed-grounds")
async def my_managed_grounds(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Get grounds assigned to the current user for ground management."""
    cursor = await db.execute(
        """SELECT g.id, g.name, g.location, gma.created_at as assigned_at
           FROM ground_management_assignments gma
           JOIN grounds g ON gma.ground_id = g.id
           WHERE gma.user_id = ?
           ORDER BY g.location, g.name""",
        (user_id,)
    )
    rows = await cursor.fetchall()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "location": r["location"],
            "display_name": f"{r['location']} - {r['name']}",
            "assigned_at": r["assigned_at"],
        }
        for r in rows
    ]

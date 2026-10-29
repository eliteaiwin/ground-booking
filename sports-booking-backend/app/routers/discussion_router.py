from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from typing import Optional, List
import aiosqlite
import os
import uuid
import shutil
from datetime import datetime

from ..database import get_db
from ..auth import get_current_user_id
from .games_router import can_moderate_game, create_notification
from .users_router import is_super_admin

router = APIRouter(prefix="/api/discussions", tags=["discussions"])

# Directory for uploaded media files
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "/data/uploads" if os.path.exists("/data") else os.path.join(os.path.dirname(__file__), "..", "..", "uploads"))
os.makedirs(UPLOAD_DIR, exist_ok=True)


class PostMessageRequest(BaseModel):
    message: str
    game_id: Optional[int] = None
    parent_id: Optional[int] = None
    mention_user_ids: Optional[List[int]] = None


class GalleryRequest(BaseModel):
    in_gallery: bool


class CleanupRequest(BaseModel):
    older_than_days: Optional[int] = None
    game_id: Optional[int] = None
    what: str = "all"  # all | messages | media


MEDIA_MAX = {"photo": (10 * 1024 * 1024, "10MB"), "video": (50 * 1024 * 1024, "50MB")}


async def _has_role(db: aiosqlite.Connection, user_id: int, role: str) -> bool:
    return await (await db.execute(
        "SELECT 1 FROM user_roles WHERE user_id = ? AND role = ?", (user_id, role)
    )).fetchone() is not None


async def _is_admin(db: aiosqlite.Connection, user_id: int) -> bool:
    return await _has_role(db, user_id, "admin") or await is_super_admin(user_id, db)


async def _is_staff(db: aiosqlite.Connection, user_id: int, game_id: Optional[int]) -> bool:
    """Admins, super admins and the game's moderators may delete anything in its discussion."""
    if await _is_admin(db, user_id):
        return True
    if not await _has_role(db, user_id, "moderator"):
        return False
    return game_id is None or await can_moderate_game(user_id, game_id, db)


async def _require_admin(db: aiosqlite.Connection, user_id: int):
    if not await _is_admin(db, user_id):
        raise HTTPException(status_code=403, detail="Admin access required")


async def _save_upload(file: UploadFile, media_type: str) -> tuple[str, int]:
    max_size, size_label = MEDIA_MAX[media_type]
    chunks = []
    total = 0
    while chunk := await file.read(8192):
        total += len(chunk)
        if total > max_size:
            raise HTTPException(status_code=400, detail=f"File too large. Max size: {size_label}")
        chunks.append(chunk)
    ext = os.path.splitext(file.filename or "upload")[1] or (".jpg" if media_type == "photo" else ".mp4")
    unique_name = f"{uuid.uuid4().hex}{ext}"
    with open(os.path.join(UPLOAD_DIR, unique_name), "wb") as f:
        f.write(b"".join(chunks))
    return unique_name, total


def _file_size(row) -> int:
    if row["file_size"]:
        return row["file_size"]
    try:
        return os.path.getsize(os.path.join(UPLOAD_DIR, row["file_path"]))
    except OSError:
        return 0


async def _delete_media(db: aiosqlite.Connection, media_id: int) -> int:
    """Permanently remove a photo/video, its file, comments and reactions. Returns bytes freed."""
    row = await (await db.execute("SELECT * FROM discussion_media WHERE id = ?", (media_id,))).fetchone()
    if not row:
        return 0
    size = _file_size(row)
    try:
        os.remove(os.path.join(UPLOAD_DIR, row["file_path"]))
    except OSError:
        pass
    await db.execute("DELETE FROM emoji_reactions WHERE target_type = 'media_comment' AND target_id IN (SELECT id FROM media_comments WHERE media_id = ?)", (media_id,))
    await db.execute("DELETE FROM media_comments WHERE media_id = ?", (media_id,))
    await db.execute("DELETE FROM emoji_reactions WHERE target_type = 'media' AND target_id = ?", (media_id,))
    await db.execute("DELETE FROM discussion_media WHERE id = ?", (media_id,))
    await db.execute("UPDATE discussion_messages SET media_id = NULL WHERE media_id = ?", (media_id,))
    return size


async def _delete_message(db: aiosqlite.Connection, message_id: int) -> int:
    freed = 0
    rows = await (await db.execute(
        "SELECT id, media_id FROM discussion_messages WHERE id = ? OR parent_id = ?", (message_id, message_id)
    )).fetchall()
    for r in rows:
        if r["media_id"]:
            media = await (await db.execute("SELECT in_gallery FROM discussion_media WHERE id = ?", (r["media_id"],))).fetchone()
            if media and not media["in_gallery"]:
                freed += await _delete_media(db, r["media_id"])
        await db.execute("DELETE FROM emoji_reactions WHERE target_type = 'message' AND target_id = ?", (r["id"],))
    await db.execute("DELETE FROM discussion_messages WHERE parent_id = ?", (message_id,))
    await db.execute("DELETE FROM discussion_messages WHERE id = ?", (message_id,))
    return freed


async def _media_brief(db: aiosqlite.Connection, media_id: Optional[int]) -> Optional[dict]:
    if not media_id:
        return None
    m = await (await db.execute("SELECT * FROM discussion_media WHERE id = ?", (media_id,))).fetchone()
    if not m:
        return None
    return {"id": m["id"], "media_type": m["media_type"], "in_gallery": bool(m["in_gallery"]),
            "file_path": f"/api/discussions/media/file/{m['id']}", "user_id": m["user_id"]}


async def _notify_mentions(db: aiosqlite.Connection, sender_id: int, game_id: Optional[int], text: str, ids: Optional[List[int]]):
    targets = {i for i in (ids or []) if i != sender_id}
    if not targets:
        return
    sender = await (await db.execute("SELECT name FROM users WHERE id = ?", (sender_id,))).fetchone()
    where = "the discussion"
    if game_id:
        g = await (await db.execute("SELECT title FROM games WHERE id = ?", (game_id,))).fetchone()
        if g:
            where = f"{g['title']} chat"
    snippet = text if len(text) <= 80 else text[:77] + "..."
    for uid in targets:
        if await (await db.execute("SELECT 1 FROM users WHERE id = ?", (uid,))).fetchone():
            await create_notification(db, uid, game_id, "mention",
                                      f"{sender['name'] if sender else 'Someone'} mentioned you in {where}: \"{snippet}\"")


class MediaCommentRequest(BaseModel):
    comment: str
    parent_id: Optional[int] = None


class EmojiReactionRequest(BaseModel):
    target_type: str  # 'message', 'media', 'media_comment'
    target_id: int
    emoji: str


async def _get_reactions(db: aiosqlite.Connection, target_type: str, target_id: int) -> list:
    cursor = await db.execute(
        """SELECT er.emoji, er.user_id, u.name
           FROM emoji_reactions er JOIN users u ON er.user_id = u.id
           WHERE er.target_type = ? AND er.target_id = ?""",
        (target_type, target_id)
    )
    rows = await cursor.fetchall()
    # Group by emoji
    emoji_map: dict[str, list] = {}
    for r in rows:
        emoji = r["emoji"]
        if emoji not in emoji_map:
            emoji_map[emoji] = []
        emoji_map[emoji].append({"user_id": r["user_id"], "name": r["name"]})
    return [{"emoji": k, "users": v, "count": len(v)} for k, v in emoji_map.items()]


# --- Discussion Messages ---

@router.get("/messages")
async def list_messages(
    game_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """List discussion messages. If game_id is provided, filter by game. Otherwise return general discussion."""
    if game_id is not None:
        cursor = await db.execute(
            """SELECT dm.*, u.name as user_name, u.phone as user_phone
               FROM discussion_messages dm JOIN users u ON dm.user_id = u.id
               WHERE dm.game_id = ? AND dm.parent_id IS NULL
               ORDER BY dm.created_at DESC LIMIT ? OFFSET ?""",
            (game_id, limit, offset)
        )
    else:
        cursor = await db.execute(
            """SELECT dm.*, u.name as user_name, u.phone as user_phone
               FROM discussion_messages dm JOIN users u ON dm.user_id = u.id
               WHERE dm.game_id IS NULL AND dm.parent_id IS NULL
               ORDER BY dm.created_at DESC LIMIT ? OFFSET ?""",
            (limit, offset)
        )
    messages = await cursor.fetchall()

    result = []
    for msg in messages:
        # Get replies
        reply_cursor = await db.execute(
            """SELECT dm.*, u.name as user_name, u.phone as user_phone
               FROM discussion_messages dm JOIN users u ON dm.user_id = u.id
               WHERE dm.parent_id = ?
               ORDER BY dm.created_at ASC""",
            (msg["id"],)
        )
        replies = await reply_cursor.fetchall()

        reply_list = []
        for r in replies:
            reactions = await _get_reactions(db, "message", r["id"])
            reply_list.append({
                "id": r["id"],
                "user_id": r["user_id"],
                "user_name": r["user_name"],
                "message": r["message"],
                "created_at": r["created_at"],
                "reactions": reactions,
                "media": await _media_brief(db, r["media_id"]),
            })

        reactions = await _get_reactions(db, "message", msg["id"])
        result.append({
            "id": msg["id"],
            "game_id": msg["game_id"],
            "user_id": msg["user_id"],
            "user_name": msg["user_name"],
            "message": msg["message"],
            "created_at": msg["created_at"],
            "reactions": reactions,
            "media": await _media_brief(db, msg["media_id"]),
            "replies": reply_list,
        })

    return result


@router.post("/messages")
async def post_message(
    req: PostMessageRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Post a discussion message. game_id=null for general discussion, or set to a game id for game-specific."""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    cursor = await db.execute(
        "INSERT INTO discussion_messages (game_id, user_id, message, parent_id) VALUES (?, ?, ?, ?)",
        (req.game_id, user_id, req.message.strip(), req.parent_id)
    )
    msg_id = cursor.lastrowid
    await _notify_mentions(db, user_id, req.game_id, req.message.strip(), req.mention_user_ids)
    await db.commit()

    # Fetch the created message
    cursor = await db.execute(
        """SELECT dm.*, u.name as user_name FROM discussion_messages dm
           JOIN users u ON dm.user_id = u.id WHERE dm.id = ?""",
        (msg_id,)
    )
    msg = await cursor.fetchone()
    return {
        "id": msg["id"],
        "game_id": msg["game_id"],
        "user_id": msg["user_id"],
        "user_name": msg["user_name"],
        "message": msg["message"],
        "parent_id": msg["parent_id"],
        "created_at": msg["created_at"],
    }


@router.post("/messages/with-media")
async def post_message_with_media(
    file: UploadFile = File(...),
    message: str = Form(""),
    game_id: Optional[int] = Form(None),
    parent_id: Optional[int] = Form(None),
    add_to_gallery: bool = Form(False),
    mention_user_ids: str = Form(""),
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Chat message with a photo/video. add_to_gallery also shows it in the game's Photos & Videos tab."""
    ctype = file.content_type or ""
    if ctype.startswith("image/"):
        media_type = "photo"
    elif ctype.startswith("video/"):
        media_type = "video"
    else:
        raise HTTPException(status_code=400, detail="Only images or videos can be attached")
    if add_to_gallery and game_id is None:
        add_to_gallery = False
    unique_name, size = await _save_upload(file, media_type)
    cursor = await db.execute(
        """INSERT INTO discussion_media (game_id, user_id, media_type, file_path, file_name, caption, in_gallery, file_size)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (game_id or 0, user_id, media_type, unique_name, file.filename or "upload", message.strip()[:200],
         1 if add_to_gallery else 0, size)
    )
    media_id = cursor.lastrowid
    cursor = await db.execute(
        "INSERT INTO discussion_messages (game_id, user_id, message, parent_id, media_id) VALUES (?, ?, ?, ?, ?)",
        (game_id, user_id, message.strip(), parent_id, media_id)
    )
    msg_id = cursor.lastrowid
    ids = [int(x) for x in mention_user_ids.split(",") if x.strip().isdigit()]
    await _notify_mentions(db, user_id, game_id, message.strip() or f"[{media_type}]", ids)
    await db.commit()
    return {"id": msg_id, "media": await _media_brief(db, media_id)}


# --- Media Upload ---

@router.get("/media")
async def list_media(
    game_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """List all media for a game."""
    cursor = await db.execute(
        """SELECT dm.*, u.name as user_name
           FROM discussion_media dm JOIN users u ON dm.user_id = u.id
           WHERE dm.game_id = ? AND dm.in_gallery = 1
           ORDER BY dm.created_at DESC""",
        (game_id,)
    )
    media_rows = await cursor.fetchall()

    result = []
    for m in media_rows:
        # Get comments count
        comment_cursor = await db.execute(
            "SELECT COUNT(*) as cnt FROM media_comments WHERE media_id = ?",
            (m["id"],)
        )
        comment_count = (await comment_cursor.fetchone())["cnt"]

        reactions = await _get_reactions(db, "media", m["id"])
        result.append({
            "id": m["id"],
            "game_id": m["game_id"],
            "user_id": m["user_id"],
            "user_name": m["user_name"],
            "media_type": m["media_type"],
            "file_path": f"/api/discussions/media/file/{m['id']}",
            "file_name": m["file_name"],
            "caption": m["caption"],
            "created_at": m["created_at"],
            "comment_count": comment_count,
            "reactions": reactions,
        })

    return result


@router.post("/media/upload")
async def upload_media(
    game_id: int = Form(...),
    caption: str = Form(""),
    media_type: str = Form(...),
    file: UploadFile = File(...),
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Upload a photo or video for a game discussion."""
    if media_type not in ("photo", "video"):
        raise HTTPException(status_code=400, detail="media_type must be 'photo' or 'video'")

    unique_name, size = await _save_upload(file, media_type)

    cursor = await db.execute(
        """INSERT INTO discussion_media (game_id, user_id, media_type, file_path, file_name, caption, file_size)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (game_id, user_id, media_type, unique_name, file.filename or "upload", caption, size)
    )
    media_id = cursor.lastrowid
    await db.commit()

    return {
        "id": media_id,
        "game_id": game_id,
        "media_type": media_type,
        "file_path": f"/api/discussions/media/file/{media_id}",
        "file_name": file.filename,
        "caption": caption,
    }


@router.get("/media/file/{media_id}")
async def get_media_file(
    media_id: int,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Serve a media file."""
    from fastapi.responses import FileResponse

    cursor = await db.execute("SELECT * FROM discussion_media WHERE id = ?", (media_id,))
    media = await cursor.fetchone()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    file_path = os.path.join(UPLOAD_DIR, media["file_path"])
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(file_path, filename=media["file_name"])


# --- Media Comments ---

@router.get("/media/{media_id}/comments")
async def list_media_comments(
    media_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """List all comments on a media item."""
    cursor = await db.execute(
        """SELECT mc.*, u.name as user_name
           FROM media_comments mc JOIN users u ON mc.user_id = u.id
           WHERE mc.media_id = ? AND mc.parent_id IS NULL
           ORDER BY mc.created_at ASC""",
        (media_id,)
    )
    comments = await cursor.fetchall()

    result = []
    for c in comments:
        # Get replies
        reply_cursor = await db.execute(
            """SELECT mc.*, u.name as user_name
               FROM media_comments mc JOIN users u ON mc.user_id = u.id
               WHERE mc.parent_id = ?
               ORDER BY mc.created_at ASC""",
            (c["id"],)
        )
        replies_rows = await reply_cursor.fetchall()

        reply_list = []
        for r in replies_rows:
            reactions = await _get_reactions(db, "media_comment", r["id"])
            reply_list.append({
                "id": r["id"],
                "user_id": r["user_id"],
                "user_name": r["user_name"],
                "comment": r["comment"],
                "created_at": r["created_at"],
                "reactions": reactions,
            })

        reactions = await _get_reactions(db, "media_comment", c["id"])
        result.append({
            "id": c["id"],
            "media_id": c["media_id"],
            "user_id": c["user_id"],
            "user_name": c["user_name"],
            "comment": c["comment"],
            "created_at": c["created_at"],
            "reactions": reactions,
            "replies": reply_list,
        })

    return result


@router.post("/media/{media_id}/comments")
async def post_media_comment(
    media_id: int,
    req: MediaCommentRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Add a comment to a media item."""
    if not req.comment.strip():
        raise HTTPException(status_code=400, detail="Comment cannot be empty")

    # Verify media exists
    cursor = await db.execute("SELECT id FROM discussion_media WHERE id = ?", (media_id,))
    if not await cursor.fetchone():
        raise HTTPException(status_code=404, detail="Media not found")

    cursor = await db.execute(
        "INSERT INTO media_comments (media_id, user_id, comment, parent_id) VALUES (?, ?, ?, ?)",
        (media_id, user_id, req.comment.strip(), req.parent_id)
    )
    comment_id = cursor.lastrowid
    await db.commit()

    cursor = await db.execute(
        """SELECT mc.*, u.name as user_name FROM media_comments mc
           JOIN users u ON mc.user_id = u.id WHERE mc.id = ?""",
        (comment_id,)
    )
    c = await cursor.fetchone()
    return {
        "id": c["id"],
        "media_id": c["media_id"],
        "user_id": c["user_id"],
        "user_name": c["user_name"],
        "comment": c["comment"],
        "parent_id": c["parent_id"],
        "created_at": c["created_at"],
    }


# --- Emoji Reactions ---

@router.post("/reactions")
async def toggle_reaction(
    req: EmojiReactionRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Toggle an emoji reaction on a message, media, or media comment."""
    if req.target_type not in ("message", "media", "media_comment"):
        raise HTTPException(status_code=400, detail="Invalid target_type")

    # Check if reaction already exists - toggle off
    cursor = await db.execute(
        """SELECT id FROM emoji_reactions
           WHERE target_type = ? AND target_id = ? AND user_id = ? AND emoji = ?""",
        (req.target_type, req.target_id, user_id, req.emoji)
    )
    existing = await cursor.fetchone()

    if existing:
        await db.execute("DELETE FROM emoji_reactions WHERE id = ?", (existing["id"],))
        await db.commit()
        return {"action": "removed", "emoji": req.emoji}
    else:
        await db.execute(
            "INSERT INTO emoji_reactions (target_type, target_id, user_id, emoji) VALUES (?, ?, ?, ?)",
            (req.target_type, req.target_id, user_id, req.emoji)
        )
        await db.commit()
        return {"action": "added", "emoji": req.emoji}


@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Delete a message permanently: the author, or an admin / super admin / the game's moderator."""
    cursor = await db.execute("SELECT * FROM discussion_messages WHERE id = ?", (message_id,))
    msg = await cursor.fetchone()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg["user_id"] != user_id and not await _is_staff(db, user_id, msg["game_id"]):
        raise HTTPException(status_code=403, detail="Only the author, a moderator or an admin can delete this message")
    await _delete_message(db, message_id)
    await db.commit()
    return {"status": "deleted"}


async def _media_or_404(db: aiosqlite.Connection, media_id: int):
    m = await (await db.execute("SELECT * FROM discussion_media WHERE id = ?", (media_id,))).fetchone()
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")
    return m


@router.delete("/media/{media_id}")
async def delete_media(
    media_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    m = await _media_or_404(db, media_id)
    if m["user_id"] != user_id and not await _is_staff(db, user_id, m["game_id"] or None):
        raise HTTPException(status_code=403, detail="Only the uploader, a moderator or an admin can delete this")
    await db.execute("DELETE FROM discussion_messages WHERE media_id = ? AND message = ''", (media_id,))
    await _delete_media(db, media_id)
    await db.commit()
    return {"status": "deleted"}


@router.put("/media/{media_id}/gallery")
async def set_media_gallery(
    media_id: int,
    req: GalleryRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    m = await _media_or_404(db, media_id)
    if not m["game_id"]:
        raise HTTPException(status_code=400, detail="Only game chats have an images section")
    if m["user_id"] != user_id and not await _is_staff(db, user_id, m["game_id"]):
        raise HTTPException(status_code=403, detail="Only the uploader, a moderator or an admin can change this")
    await db.execute("UPDATE discussion_media SET in_gallery = ? WHERE id = ?", (1 if req.in_gallery else 0, media_id))
    await db.commit()
    return await _media_brief(db, media_id)


# --- Storage clean-up (admins) ---

@router.get("/storage")
async def storage_usage(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    await _require_admin(db, user_id)
    media = await (await db.execute(
        """SELECT dm.*, u.name AS user_name, g.title AS game_title, g.game_date
           FROM discussion_media dm JOIN users u ON u.id = dm.user_id
           LEFT JOIN games g ON g.id = dm.game_id ORDER BY dm.created_at ASC"""
    )).fetchall()
    msgs = await (await db.execute(
        """SELECT dm.game_id, COUNT(*) AS cnt, MIN(dm.created_at) AS oldest, g.title AS game_title, g.game_date
           FROM discussion_messages dm LEFT JOIN games g ON g.id = dm.game_id GROUP BY dm.game_id"""
    )).fetchall()
    games: dict = {}
    for r in msgs:
        key = r["game_id"] or 0
        games[key] = {"game_id": key or None, "title": r["game_title"] or "General discussion", "game_date": r["game_date"],
                      "messages": r["cnt"], "media": 0, "bytes": 0, "oldest": r["oldest"]}
    items = []
    for m in media:
        size = _file_size(m)
        key = m["game_id"] or 0
        g = games.setdefault(key, {"game_id": key or None, "title": m["game_title"] or "General discussion",
                                   "game_date": m["game_date"], "messages": 0, "media": 0, "bytes": 0, "oldest": m["created_at"]})
        g["media"] += 1
        g["bytes"] += size
        if m["created_at"] and (not g["oldest"] or m["created_at"] < g["oldest"]):
            g["oldest"] = m["created_at"]
        items.append({"id": m["id"], "media_type": m["media_type"], "bytes": size, "created_at": m["created_at"],
                      "user_name": m["user_name"], "game_title": g["title"], "game_date": m["game_date"],
                      "in_gallery": bool(m["in_gallery"]), "file_path": f"/api/discussions/media/file/{m['id']}"})
    return {
        "messages": sum(g["messages"] for g in games.values()),
        "media": len(items),
        "bytes": sum(i["bytes"] for i in items),
        "games": sorted(games.values(), key=lambda g: g["oldest"] or ""),
        "items": items,
    }


@router.post("/cleanup")
async def cleanup_discussions(
    req: CleanupRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Permanently delete chats and/or photos/videos older than N days, or for one game."""
    await _require_admin(db, user_id)
    if req.what not in ("all", "messages", "media"):
        raise HTTPException(status_code=400, detail="what must be all, messages or media")
    if req.older_than_days is None and req.game_id is None:
        raise HTTPException(status_code=400, detail="Pick an age or a game")
    conds, params = [], []
    if req.older_than_days is not None:
        if req.older_than_days < 0:
            raise HTTPException(status_code=400, detail="older_than_days must be 0 or more")
        conds.append("created_at < datetime('now', ?)")
        params.append(f"-{int(req.older_than_days)} days")
    if req.game_id is not None:
        conds.append("COALESCE(game_id, 0) = ?")
        params.append(req.game_id)
    where = " AND ".join(conds)
    deleted_messages = deleted_media = freed = 0
    if req.what in ("all", "media"):
        for r in await (await db.execute(f"SELECT id FROM discussion_media WHERE {where}", params)).fetchall():
            await db.execute("DELETE FROM discussion_messages WHERE media_id = ? AND message = ''", (r["id"],))
            freed += await _delete_media(db, r["id"])
            deleted_media += 1
    if req.what in ("all", "messages"):
        rows = await (await db.execute(f"SELECT id FROM discussion_messages WHERE {where} AND parent_id IS NULL", params)).fetchall()
        for r in rows:
            freed += await _delete_message(db, r["id"])
            deleted_messages += 1
        await db.execute(f"DELETE FROM discussion_messages WHERE {where}", params)
    await db.commit()
    return {"deleted_messages": deleted_messages, "deleted_media": deleted_media, "freed_bytes": freed}

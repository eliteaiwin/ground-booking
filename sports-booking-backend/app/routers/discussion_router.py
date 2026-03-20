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

router = APIRouter(prefix="/api/discussions", tags=["discussions"])

# Directory for uploaded media files
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", os.path.join(os.path.dirname(__file__), "..", "..", "uploads"))
os.makedirs(UPLOAD_DIR, exist_ok=True)


class PostMessageRequest(BaseModel):
    message: str
    game_id: Optional[int] = None
    parent_id: Optional[int] = None


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
           WHERE dm.game_id = ?
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

    # Validate file size (10MB for photos, 50MB for videos)
    max_size = 50 * 1024 * 1024 if media_type == "video" else 10 * 1024 * 1024
    content = await file.read()
    if len(content) > max_size:
        size_label = "50MB" if media_type == "video" else "10MB"
        raise HTTPException(status_code=400, detail=f"File too large. Max size: {size_label}")

    # Save file
    ext = os.path.splitext(file.filename or "upload")[1] or (".jpg" if media_type == "photo" else ".mp4")
    unique_name = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(UPLOAD_DIR, unique_name)
    with open(file_path, "wb") as f:
        f.write(content)

    cursor = await db.execute(
        """INSERT INTO discussion_media (game_id, user_id, media_type, file_path, file_name, caption)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (game_id, user_id, media_type, unique_name, file.filename or "upload", caption)
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
    user_id: int = Depends(get_current_user_id),
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

    content_type = "image/jpeg" if media["media_type"] == "photo" else "video/mp4"
    return FileResponse(file_path, media_type=content_type, filename=media["file_name"])


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
    """Delete a discussion message (only the author can delete)."""
    cursor = await db.execute("SELECT * FROM discussion_messages WHERE id = ?", (message_id,))
    msg = await cursor.fetchone()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if msg["user_id"] != user_id:
        # Check if admin
        role_cursor = await db.execute(
            "SELECT role FROM user_roles WHERE user_id = ? AND role = 'admin'", (user_id,)
        )
        if not await role_cursor.fetchone():
            raise HTTPException(status_code=403, detail="Only the author or an admin can delete this message")

    # Delete replies first
    await db.execute("DELETE FROM emoji_reactions WHERE target_type = 'message' AND target_id IN (SELECT id FROM discussion_messages WHERE parent_id = ?)", (message_id,))
    await db.execute("DELETE FROM discussion_messages WHERE parent_id = ?", (message_id,))
    await db.execute("DELETE FROM emoji_reactions WHERE target_type = 'message' AND target_id = ?", (message_id,))
    await db.execute("DELETE FROM discussion_messages WHERE id = ?", (message_id,))
    await db.commit()
    return {"status": "deleted"}

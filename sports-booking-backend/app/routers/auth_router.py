from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
import aiosqlite
import random
import string
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..database import get_db
from ..auth import hash_password, verify_password, create_access_token, get_current_user_id

# Profile pictures upload directory
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/data/uploads" if os.path.exists("/data") else "./uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


async def generate_user_code(db: aiosqlite.Connection) -> str:
    """Generate next user code like U001, U002, etc."""
    cursor = await db.execute(
        "SELECT user_code FROM users WHERE user_code != '' ORDER BY user_code DESC LIMIT 1"
    )
    row = await cursor.fetchone()
    if row and row["user_code"]:
        code = row["user_code"]
        num_part = ''.join(c for c in code if c.isdigit())
        next_num = int(num_part) + 1 if num_part else 1
    else:
        next_num = 1
    return f"U{next_num:03d}"

router = APIRouter(prefix="/api/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    first_name: str
    last_name: str
    phone: str
    email: Optional[str] = None
    password: str
    notification_preference: str = "whatsapp"
    sports: List[str] = []
    locations: List[str] = []
    sport_positions: Optional[dict] = None  # {"soccer": ["Striker"], "cricket": ["Batsman", "Bowler"]}


class LoginRequest(BaseModel):
    phone: str
    password: str


class OTPRequestModel(BaseModel):
    phone: str


class OTPVerifyRequest(BaseModel):
    phone: str
    otp: str


class GoogleAuthRequest(BaseModel):
    id_token: str  # Google ID token from Google Identity Services


GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")


class ChangePasswordRequest(BaseModel):
    current_password: Optional[str] = None
    new_password: str


class ForgotPasswordRequest(BaseModel):
    email: str


class ResetPasswordTokenRequest(BaseModel):
    token: str
    new_password: str


class UpdateProfileRequest(BaseModel):
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notification_preference: Optional[str] = None
    sports: Optional[List[str]] = None
    locations: Optional[List[str]] = None
    sport_positions: Optional[dict] = None
    currency: Optional[str] = None


async def _assign_roles(db: aiosqlite.Connection, user_id: int):
    """Assign roles: first user gets all roles, others get 'user'.
    
    Checks user_roles table for existing admins (not user count) to reduce
    race window. Uses INSERT OR IGNORE for idempotency.
    """
    cursor = await db.execute("SELECT COUNT(*) as cnt FROM user_roles WHERE role = 'admin'")
    admin_count = await cursor.fetchone()
    if admin_count["cnt"] == 0:
        await db.execute("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'admin')", (user_id,))
        await db.execute("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'moderator')", (user_id,))
    await db.execute("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'user')", (user_id,))


@router.post("/register")
async def register(req: RegisterRequest, db: aiosqlite.Connection = Depends(get_db)):
    # Check if phone already exists
    cursor = await db.execute("SELECT id FROM users WHERE phone = ?", (req.phone,))
    existing = await cursor.fetchone()
    if existing:
        raise HTTPException(status_code=400, detail="Phone number already registered")

    if req.email:
        cursor = await db.execute("SELECT id FROM users WHERE email = ?", (req.email,))
        existing = await cursor.fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Email already registered")

    import json as json_lib
    full_name = f"{req.first_name} {req.last_name}".strip()
    password_hash = hash_password(req.password)
    sports_str = ",".join(req.sports)
    locations_str = ",".join(req.locations)
    positions_str = json_lib.dumps(req.sport_positions) if req.sport_positions else ""

    user_code = await generate_user_code(db)

    cursor = await db.execute(
        """INSERT INTO users (user_code, first_name, last_name, name, phone, email, password_hash,
           notification_preference, sports, locations, sport_positions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (user_code, req.first_name, req.last_name, full_name, req.phone, req.email,
         password_hash, req.notification_preference, sports_str, locations_str, positions_str)
    )
    user_id = cursor.lastrowid

    await _assign_roles(db, user_id)
    await db.commit()

    token = create_access_token(user_id)
    return {"token": token, "user_id": user_id, "message": "Registration successful"}


@router.post("/login")
async def login(req: LoginRequest, db: aiosqlite.Connection = Depends(get_db)):
    cursor = await db.execute("SELECT id, password_hash FROM users WHERE phone = ?", (req.phone,))
    user = await cursor.fetchone()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not user["password_hash"]:
        raise HTTPException(status_code=401, detail="No password set. Use OTP or Google login.")

    if not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # Check if user is disabled
    try:
        dis_cursor = await db.execute("SELECT is_disabled, disabled_reason FROM users WHERE id = ?", (user["id"],))
        dis_row = await dis_cursor.fetchone()
        if dis_row and dis_row["is_disabled"]:
            reason = dis_row["disabled_reason"] or ""
            detail = "Your account has been disabled by an administrator."
            if reason:
                detail += f" Reason: {reason}"
            raise HTTPException(status_code=403, detail=detail)
    except HTTPException:
        raise
    except Exception:
        pass

    # Check force_password_change flag
    force_change = False
    try:
        fc_cursor = await db.execute("SELECT force_password_change FROM users WHERE id = ?", (user["id"],))
        fc_row = await fc_cursor.fetchone()
        if fc_row and fc_row["force_password_change"]:
            force_change = True
    except Exception:
        pass

    token = create_access_token(user["id"])
    return {"token": token, "user_id": user["id"], "force_password_change": force_change}


@router.post("/otp/request")
async def request_otp(req: OTPRequestModel, db: aiosqlite.Connection = Depends(get_db)):
    """Send OTP to user's phone (simulated - returns OTP for demo)."""
    cursor = await db.execute("SELECT id FROM users WHERE phone = ?", (req.phone,))
    user = await cursor.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="Phone number not registered")

    otp_code = ''.join(random.SystemRandom().choices(string.digits, k=6))
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)

    await db.execute(
        "UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE id = ?",
        (otp_code, expires_at.isoformat(), user["id"])
    )
    await db.commit()

    # In production, send via SMS/WhatsApp. For demo, return the OTP.
    return {"message": "OTP sent successfully", "otp_demo": otp_code}


@router.post("/otp/verify")
async def verify_otp(req: OTPVerifyRequest, db: aiosqlite.Connection = Depends(get_db)):
    """Verify OTP and return auth token."""
    cursor = await db.execute(
        "SELECT id, otp_code, otp_expires_at FROM users WHERE phone = ?", (req.phone,)
    )
    user = await cursor.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="Phone number not registered")

    # Check expiry first to avoid leaking OTP correctness for expired tokens
    if not user["otp_expires_at"]:
        raise HTTPException(status_code=401, detail="OTP expired")

    try:
        expires = datetime.fromisoformat(user["otp_expires_at"])
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires:
            raise HTTPException(status_code=401, detail="OTP expired")
    except ValueError:
        raise HTTPException(status_code=401, detail="OTP expired")

    import hmac as _hmac
    if not user["otp_code"] or not _hmac.compare_digest(user["otp_code"], req.otp):
        # Clear OTP on failed attempt to prevent brute-force
        await db.execute("UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = ?", (user["id"],))
        await db.commit()
        raise HTTPException(status_code=401, detail="Invalid OTP")

    # Clear OTP after successful verification
    await db.execute("UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = ?", (user["id"],))
    await db.commit()

    # Check if user is disabled
    try:
        dis_cursor = await db.execute("SELECT is_disabled, disabled_reason FROM users WHERE id = ?", (user["id"],))
        dis_row = await dis_cursor.fetchone()
        if dis_row and dis_row["is_disabled"]:
            reason = dis_row["disabled_reason"] or ""
            detail = "Your account has been disabled by an administrator."
            if reason:
                detail += f" Reason: {reason}"
            raise HTTPException(status_code=403, detail=detail)
    except HTTPException:
        raise
    except Exception:
        pass

    token = create_access_token(user["id"])
    return {"token": token, "user_id": user["id"]}


@router.post("/google")
async def google_auth(req: GoogleAuthRequest, db: aiosqlite.Connection = Depends(get_db)):
    """Authenticate or register via Google SSO.

    Accepts a Google ID token from Google Identity Services, verifies it
    server-side, and returns a JWT. Creates a new user if the Google account
    is not yet registered.
    """
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=501,
            detail="Google authentication is not configured. Set GOOGLE_CLIENT_ID env var."
        )

    from google.oauth2 import id_token as google_id_token
    from google.auth.transport import requests as google_requests

    try:
        idinfo = google_id_token.verify_oauth2_token(
            req.id_token, google_requests.Request(), GOOGLE_CLIENT_ID
        )
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Google ID token")

    google_sub = idinfo["sub"]
    email = idinfo.get("email", "")
    first_name = idinfo.get("given_name", "")
    last_name = idinfo.get("family_name", "")

    if not email:
        raise HTTPException(status_code=400, detail="Google account has no email")

    # Look up by google_id first, then by email
    cursor = await db.execute("SELECT id FROM users WHERE google_id = ?", (google_sub,))
    user = await cursor.fetchone()

    if not user:
        # Check if an account with this email exists (link Google to it)
        cursor = await db.execute("SELECT id FROM users WHERE email = ?", (email,))
        user = await cursor.fetchone()
        if user:
            await db.execute("UPDATE users SET google_id = ? WHERE id = ?", (google_sub, user["id"]))
            await db.commit()

    if user:
        # Check if user is disabled
        try:
            dis_cursor = await db.execute("SELECT is_disabled, disabled_reason FROM users WHERE id = ?", (user["id"],))
            dis_row = await dis_cursor.fetchone()
            if dis_row and dis_row["is_disabled"]:
                reason = dis_row["disabled_reason"] or ""
                detail = "Your account has been disabled by an administrator."
                if reason:
                    detail += f" Reason: {reason}"
                raise HTTPException(status_code=403, detail=detail)
        except HTTPException:
            raise
        except Exception:
            pass

        token = create_access_token(user["id"])
        return {"token": token, "user_id": user["id"]}

    # New user — register
    full_name = f"{first_name} {last_name}".strip() or email.split("@")[0]
    user_code = await generate_user_code(db)
    # Use a placeholder phone since the column is NOT NULL UNIQUE;
    # the user can update it later in their profile.
    placeholder_phone = f"g-{google_sub[:20]}"

    cursor = await db.execute(
        """INSERT INTO users (user_code, first_name, last_name, name, phone, email,
           google_id, notification_preference, sports, locations, sport_positions)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'whatsapp', '', '', '')""",
        (user_code, first_name, last_name, full_name, placeholder_phone, email, google_sub)
    )
    user_id = cursor.lastrowid
    await _assign_roles(db, user_id)
    await db.commit()

    token = create_access_token(user_id)
    return {"token": token, "user_id": user_id, "message": "Registration via Google successful"}


@router.post("/change-password")
async def change_password(
    req: ChangePasswordRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Change password. Used for force-change and voluntary change."""
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    cursor = await db.execute("SELECT password_hash, force_password_change FROM users WHERE id = ?", (user_id,))
    user = await cursor.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # If not a forced change, verify current password
    force_change = False
    try:
        force_change = bool(user["force_password_change"])
    except Exception:
        pass

    if not force_change:
        if not req.current_password:
            raise HTTPException(status_code=400, detail="Current password is required")
        if not user["password_hash"]:
            raise HTTPException(status_code=400, detail="No password set on this account. Use Google login or request a password reset.")
        if not verify_password(req.current_password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")

    new_hash = hash_password(req.new_password)
    await db.execute(
        "UPDATE users SET password_hash = ?, force_password_change = 0 WHERE id = ?",
        (new_hash, user_id)
    )
    await db.commit()
    return {"message": "Password changed successfully", "force_logout": True}


@router.post("/forgot-password")
async def forgot_password(
    req: ForgotPasswordRequest,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Send password reset email with a token link."""
    cursor = await db.execute("SELECT id, email FROM users WHERE email = ?", (req.email,))
    user = await cursor.fetchone()
    if not user:
        # Don't reveal if email exists
        return {"message": "If the email is registered, a reset link has been sent."}

    # Generate reset token
    reset_token = uuid.uuid4().hex
    expires = datetime.now(timezone.utc) + timedelta(hours=1)
    await db.execute(
        "UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE id = ?",
        (reset_token, expires.isoformat(), user["id"])
    )
    await db.commit()

    # In production, send email with reset link. For demo, return the token.
    return {
        "message": "If the email is registered, a reset link has been sent.",
        "reset_token_demo": reset_token
    }


@router.post("/reset-password-token")
async def reset_password_with_token(
    req: ResetPasswordTokenRequest,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Reset password using a token from forgot-password email."""
    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    cursor = await db.execute(
        "SELECT id, password_reset_token, password_reset_expires FROM users WHERE password_reset_token = ?",
        (req.token,)
    )
    user = await cursor.fetchone()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    # Check expiry
    try:
        expires = datetime.fromisoformat(user["password_reset_expires"])
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires:
            raise HTTPException(status_code=400, detail="Reset token has expired")
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    new_hash = hash_password(req.new_password)
    await db.execute(
        "UPDATE users SET password_hash = ?, force_password_change = 0, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?",
        (new_hash, user["id"])
    )
    await db.commit()
    return {"message": "Password reset successfully. Please login with your new password.", "force_logout": True}


@router.get("/me")
async def get_profile(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    import json as json_lib
    cursor = await db.execute(
        """SELECT id, user_code, first_name, last_name, name, phone, email,
           notification_preference, sports, locations, sport_positions, profile_pic, created_at
           FROM users WHERE id = ?""",
        (user_id,)
    )
    user = await cursor.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Get currency and phone_verified safely
    currency = "Rs"
    phone_verified = 0
    try:
        cursor2 = await db.execute("SELECT currency, phone_verified FROM users WHERE id = ?", (user_id,))
        extra = await cursor2.fetchone()
        if extra:
            currency = extra["currency"] or "Rs"
            phone_verified = extra["phone_verified"] or 0
    except Exception:
        pass

    cursor = await db.execute("SELECT role FROM user_roles WHERE user_id = ?", (user_id,))
    roles_rows = await cursor.fetchall()
    roles = [r["role"] for r in roles_rows]

    first_name = user["first_name"] or ""
    last_name = user["last_name"] or ""
    display_name = user["name"] or f"{first_name} {last_name}".strip()
    sports = [s for s in (user["sports"] or "").split(",") if s]
    locations = [loc for loc in (user["locations"] or "").split(",") if loc]
    sport_positions = {}
    if user["sport_positions"]:
        try:
            sport_positions = json_lib.loads(user["sport_positions"])
        except Exception:
            pass

    user_code = ""
    profile_pic = ""
    try:
        user_code = user["user_code"] or ""
    except Exception:
        pass
    try:
        profile_pic = user["profile_pic"] or ""
    except Exception:
        pass

    return {
        "id": user["id"],
        "user_code": user_code,
        "first_name": first_name,
        "last_name": last_name,
        "name": display_name,
        "phone": user["phone"],
        "email": user["email"],
        "notification_preference": user["notification_preference"],
        "sports": sports,
        "locations": locations,
        "sport_positions": sport_positions,
        "profile_pic": profile_pic,
        "currency": currency,
        "phone_verified": phone_verified,
        "roles": roles,
        "created_at": user["created_at"]
    }


@router.put("/me")
async def update_profile(
    req: UpdateProfileRequest,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    updates = []
    params = []
    if req.first_name is not None:
        updates.append("first_name = ?")
        params.append(req.first_name)
    if req.last_name is not None:
        updates.append("last_name = ?")
        params.append(req.last_name)
    if req.first_name is not None or req.last_name is not None:
        # Also update the display name
        cursor = await db.execute("SELECT first_name, last_name FROM users WHERE id = ?", (user_id,))
        current = await cursor.fetchone()
        fn = req.first_name if req.first_name is not None else (current["first_name"] or "")
        ln = req.last_name if req.last_name is not None else (current["last_name"] or "")
        updates.append("name = ?")
        params.append(f"{fn} {ln}".strip())
    if req.email is not None:
        # Check email uniqueness
        cursor = await db.execute("SELECT id FROM users WHERE email = ? AND id != ?", (req.email, user_id))
        if await cursor.fetchone():
            raise HTTPException(status_code=400, detail="Email already in use")
        updates.append("email = ?")
        params.append(req.email)
    if req.notification_preference is not None:
        updates.append("notification_preference = ?")
        params.append(req.notification_preference)
    if req.sports is not None:
        updates.append("sports = ?")
        params.append(",".join(req.sports))
    if req.locations is not None:
        updates.append("locations = ?")
        params.append(",".join(req.locations))
    if req.sport_positions is not None:
        import json as json_lib
        updates.append("sport_positions = ?")
        params.append(json_lib.dumps(req.sport_positions))
    if req.currency is not None:
        updates.append("currency = ?")
        params.append(req.currency)
    if req.phone is not None:
        # Check phone uniqueness
        cursor = await db.execute("SELECT id FROM users WHERE phone = ? AND id != ?", (req.phone, user_id))
        if await cursor.fetchone():
            raise HTTPException(status_code=400, detail="Phone number already in use")
        updates.append("phone = ?")
        params.append(req.phone)
        updates.append("phone_verified = ?")
        params.append(0)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    params.append(user_id)
    await db.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
    await db.commit()
    return {"message": "Profile updated"}


@router.post("/me/profile-pic")
async def upload_profile_pic(
    file: UploadFile = File(...),
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Upload a profile picture for the current user."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    # Limit file size to 5MB using chunked reads
    max_size = 5 * 1024 * 1024
    chunks = []
    total = 0
    while chunk := await file.read(8192):
        total += len(chunk)
        if total > max_size:
            raise HTTPException(status_code=400, detail="File too large. Max 5MB.")
        chunks.append(chunk)
    contents = b"".join(chunks)

    # Generate unique filename
    ext = Path(file.filename or "pic.jpg").suffix or ".jpg"
    filename = f"profile_{user_id}_{uuid.uuid4().hex[:8]}{ext}"
    file_path = UPLOAD_DIR / filename

    # Delete old profile pic if exists
    try:
        cursor = await db.execute("SELECT profile_pic FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        if row and row["profile_pic"]:
            old_file = UPLOAD_DIR / row["profile_pic"]
            if old_file.exists():
                old_file.unlink()
    except Exception:
        pass

    # Save file
    with open(file_path, "wb") as f:
        f.write(contents)

    # Update database
    await db.execute("UPDATE users SET profile_pic = ? WHERE id = ?", (filename, user_id))
    await db.commit()

    return {"message": "Profile picture uploaded", "filename": filename}


@router.get("/profile-pic/{filename}")
async def get_profile_pic(filename: str):
    """Serve a profile picture file."""
    # Sanitize filename to prevent path traversal
    safe_name = Path(filename).name
    file_path = UPLOAD_DIR / safe_name
    if not file_path.exists() or not file_path.is_relative_to(UPLOAD_DIR):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(file_path))


VALID_PHOTO_PURPOSES = ('profile', 'soccer', 'cricket', 'badminton', 'basketball', 'hockey')


@router.post("/me/photos")
async def upload_user_photo(
    file: UploadFile = File(...),
    purpose: str = "profile",
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Upload a photo and assign it to a purpose (profile, soccer, cricket, etc.)."""
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are allowed")

    purpose = purpose.lower().strip()
    if purpose not in VALID_PHOTO_PURPOSES:
        raise HTTPException(status_code=400, detail=f"Invalid purpose. Must be one of: {', '.join(VALID_PHOTO_PURPOSES)}")

    # Limit file size to 5MB using chunked reads
    max_size = 5 * 1024 * 1024
    chunks = []
    total = 0
    while chunk := await file.read(8192):
        total += len(chunk)
        if total > max_size:
            raise HTTPException(status_code=400, detail="File too large. Max 5MB.")
        chunks.append(chunk)
    contents = b"".join(chunks)

    # Generate unique filename
    ext = Path(file.filename or "pic.jpg").suffix or ".jpg"
    filename = f"userphoto_{user_id}_{uuid.uuid4().hex[:8]}{ext}"
    file_path = UPLOAD_DIR / filename

    # Save file
    with open(file_path, "wb") as f:
        f.write(contents)

    # Remove any existing photo with the same purpose for this user
    cursor = await db.execute(
        "SELECT id, filename FROM user_photos WHERE user_id = ? AND purpose = ?",
        (user_id, purpose)
    )
    old = await cursor.fetchone()
    if old:
        old_file = UPLOAD_DIR / old["filename"]
        if old_file.exists():
            old_file.unlink()
        await db.execute("DELETE FROM user_photos WHERE id = ?", (old["id"],))

    # Insert the new photo
    cursor = await db.execute(
        "INSERT INTO user_photos (user_id, filename, purpose) VALUES (?, ?, ?)",
        (user_id, filename, purpose)
    )
    photo_id = cursor.lastrowid
    await db.commit()

    # If this is the 'profile' purpose photo, also update users.profile_pic for backward compat
    if purpose == "profile":
        await db.execute("UPDATE users SET profile_pic = ? WHERE id = ?", (filename, user_id))
        await db.commit()

    return {"message": "Photo uploaded", "id": photo_id, "filename": filename, "purpose": purpose}


@router.get("/me/photos")
async def list_user_photos(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """List all photos for the current user."""
    cursor = await db.execute(
        "SELECT id, filename, purpose, caption, created_at FROM user_photos WHERE user_id = ? ORDER BY created_at DESC",
        (user_id,)
    )
    rows = await cursor.fetchall()
    photos = [{"id": r["id"], "filename": r["filename"], "purpose": r["purpose"],
               "caption": r["caption"], "created_at": r["created_at"]} for r in rows]

    # Also include the legacy profile_pic if it exists and isn't in user_photos
    cursor = await db.execute("SELECT profile_pic FROM users WHERE id = ?", (user_id,))
    user_row = await cursor.fetchone()
    legacy_pic = user_row["profile_pic"] if user_row else ""
    if legacy_pic:
        has_profile = any(p["purpose"] == "profile" for p in photos)
        if not has_profile:
            photos.insert(0, {"id": 0, "filename": legacy_pic, "purpose": "profile",
                              "caption": "", "created_at": ""})

    return {"photos": photos}


@router.put("/me/photos/{photo_id}/purpose")
async def update_photo_purpose(
    photo_id: int,
    purpose: str = "profile",
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Change the purpose of an existing photo."""
    purpose = purpose.lower().strip()
    if purpose not in VALID_PHOTO_PURPOSES:
        raise HTTPException(status_code=400, detail=f"Invalid purpose. Must be one of: {', '.join(VALID_PHOTO_PURPOSES)}")

    # Verify photo belongs to user
    cursor = await db.execute(
        "SELECT id, filename FROM user_photos WHERE id = ? AND user_id = ?",
        (photo_id, user_id)
    )
    photo = await cursor.fetchone()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    # Remove any existing photo with the target purpose (one photo per purpose)
    cursor = await db.execute(
        "SELECT id, filename FROM user_photos WHERE user_id = ? AND purpose = ? AND id != ?",
        (user_id, purpose, photo_id)
    )
    old = await cursor.fetchone()
    if old:
        old_file = UPLOAD_DIR / old["filename"]
        if old_file.exists():
            old_file.unlink()
        await db.execute("DELETE FROM user_photos WHERE id = ?", (old["id"],))

    await db.execute("UPDATE user_photos SET purpose = ? WHERE id = ?", (purpose, photo_id))
    await db.commit()

    # Update users.profile_pic for backward compat
    if purpose == "profile":
        await db.execute("UPDATE users SET profile_pic = ? WHERE id = ?", (photo["filename"], user_id))
        await db.commit()

    return {"message": "Photo purpose updated", "purpose": purpose}


@router.delete("/me/photos/{photo_id}")
async def delete_user_photo(
    photo_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Delete a user photo."""
    cursor = await db.execute(
        "SELECT id, filename, purpose FROM user_photos WHERE id = ? AND user_id = ?",
        (photo_id, user_id)
    )
    photo = await cursor.fetchone()
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    # Delete file from disk
    file_path = UPLOAD_DIR / photo["filename"]
    if file_path.exists():
        file_path.unlink()

    was_profile = photo["purpose"] == "profile"
    await db.execute("DELETE FROM user_photos WHERE id = ?", (photo_id,))
    await db.commit()

    # If we deleted the profile photo, pick the next available or clear it
    if was_profile:
        cursor = await db.execute(
            "SELECT filename FROM user_photos WHERE user_id = ? ORDER BY created_at ASC LIMIT 1",
            (user_id,)
        )
        next_photo = await cursor.fetchone()
        new_pic = next_photo["filename"] if next_photo else ""
        await db.execute("UPDATE users SET profile_pic = ? WHERE id = ?", (new_pic, user_id))
        await db.commit()

    return {"message": "Photo deleted"}


@router.get("/user/{target_user_id}/photos")
async def get_user_photos(
    target_user_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Get all photos for a given user (public view)."""
    cursor = await db.execute(
        "SELECT id, filename, purpose, created_at FROM user_photos WHERE user_id = ? ORDER BY created_at DESC",
        (target_user_id,)
    )
    rows = await cursor.fetchall()
    photos = [{"id": r["id"], "filename": r["filename"], "purpose": r["purpose"],
               "created_at": r["created_at"]} for r in rows]

    # Fallback: include legacy profile_pic if no photos in user_photos table
    if not photos:
        cursor = await db.execute("SELECT profile_pic FROM users WHERE id = ?", (target_user_id,))
        user_row = await cursor.fetchone()
        legacy_pic = user_row["profile_pic"] if user_row else ""
        if legacy_pic:
            photos.append({"id": 0, "filename": legacy_pic, "purpose": "profile", "created_at": ""})

    return {"photos": photos}


@router.get("/user/{target_user_id}/sport-photo/{sport}")
async def get_user_sport_photo(
    target_user_id: int,
    sport: str,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Get the photo filename for a user for a specific sport. Falls back to profile photo."""
    sport = sport.lower().strip()

    # Try sport-specific photo first
    cursor = await db.execute(
        "SELECT filename FROM user_photos WHERE user_id = ? AND purpose = ?",
        (target_user_id, sport)
    )
    row = await cursor.fetchone()
    if row:
        return {"filename": row["filename"], "purpose": sport}

    # Fall back to profile photo from user_photos
    cursor = await db.execute(
        "SELECT filename FROM user_photos WHERE user_id = ? AND purpose = 'profile'",
        (target_user_id,)
    )
    row = await cursor.fetchone()
    if row:
        return {"filename": row["filename"], "purpose": "profile"}

    # Fall back to legacy profile_pic
    cursor = await db.execute("SELECT profile_pic FROM users WHERE id = ?", (target_user_id,))
    user_row = await cursor.fetchone()
    pic = user_row["profile_pic"] if user_row else ""
    return {"filename": pic, "purpose": "profile"}


@router.get("/user/{target_user_id}/persona")
async def get_user_persona(
    target_user_id: int,
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Get a user's full persona: profile, ranks across sports, grounds they play on."""
    import json as json_lib

    cursor = await db.execute(
        "SELECT id, user_code, first_name, last_name, name, phone, sports, locations, sport_positions, profile_pic FROM users WHERE id = ?",
        (target_user_id,)
    )
    user = await cursor.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user_code = ""
    profile_pic = ""
    try:
        user_code = user["user_code"] or ""
    except Exception:
        pass
    try:
        profile_pic = user["profile_pic"] or ""
    except Exception:
        pass

    first_name = user["first_name"] or ""
    last_name = user["last_name"] or ""
    display_name = user["name"] or f"{first_name} {last_name}".strip()
    sports = [s for s in (user["sports"] or "").split(",") if s]
    sport_positions = {}
    if user["sport_positions"]:
        try:
            sport_positions = json_lib.loads(user["sport_positions"])
        except Exception:
            pass

    # Get roles
    cursor = await db.execute("SELECT role FROM user_roles WHERE user_id = ?", (target_user_id,))
    roles_rows = await cursor.fetchall()
    roles = [r["role"] for r in roles_rows]

    # Get POTD points per sport (3 for 1st pref, 2 for 2nd, 1 for 3rd)
    sport_rankings = []
    try:
        cursor = await db.execute(
            """SELECT g.sport_type,
                SUM(CASE WHEN pv.preference = 1 THEN 3 WHEN pv.preference = 2 THEN 2 WHEN pv.preference = 3 THEN 1 ELSE 0 END) as points,
                COUNT(DISTINCT pv.game_id) as games_voted
            FROM potd_votes pv
            JOIN games g ON pv.game_id = g.id
            WHERE pv.player_id = ?
            GROUP BY g.sport_type
            ORDER BY points DESC""",
            (target_user_id,)
        )
        rows = await cursor.fetchall()
        for row in rows:
            # Get rank for this sport
            rank_cursor = await db.execute(
                """SELECT player_id, SUM(CASE WHEN pv2.preference = 1 THEN 3 WHEN pv2.preference = 2 THEN 2 WHEN pv2.preference = 3 THEN 1 ELSE 0 END) as pts
                FROM potd_votes pv2
                JOIN games g2 ON pv2.game_id = g2.id
                WHERE g2.sport_type = ?
                GROUP BY player_id
                ORDER BY pts DESC""",
                (row["sport_type"],)
            )
            rank_rows = await rank_cursor.fetchall()
            rank = 1
            for i, rr in enumerate(rank_rows):
                if rr["player_id"] == target_user_id:
                    rank = i + 1
                    break
            sport_rankings.append({
                "sport": row["sport_type"],
                "points": row["points"],
                "rank": rank,
                "games_voted": row["games_voted"],
            })
    except Exception:
        pass

    # Get goals per sport
    goal_stats = []
    try:
        cursor = await db.execute(
            """SELECT g.sport_type, SUM(gs.goals) as total_goals
            FROM goal_scorers gs
            JOIN games g ON gs.game_id = g.id
            WHERE gs.user_id = ?
            GROUP BY g.sport_type
            ORDER BY total_goals DESC""",
            (target_user_id,)
        )
        rows = await cursor.fetchall()
        for row in rows:
            goal_stats.append({
                "sport": row["sport_type"],
                "total_goals": row["total_goals"],
            })
    except Exception:
        pass

    # Get grounds this user plays on
    grounds_played = []
    try:
        cursor = await db.execute(
            """SELECT DISTINCT g.ground_name FROM games g
            JOIN game_players gp ON gp.game_id = g.id
            WHERE gp.user_id = ? AND gp.status = 'selected'
            ORDER BY g.ground_name""",
            (target_user_id,)
        )
        rows = await cursor.fetchall()
        for row in rows:
            # Try to get ground_code for this ground
            ground_code_display = ""
            try:
                parts = row["ground_name"].split(" - ")
                if len(parts) == 2:
                    gc = await db.execute(
                        "SELECT ground_code FROM grounds WHERE location = ? AND name = ?",
                        (parts[0].strip(), parts[1].strip())
                    )
                    gr = await gc.fetchone()
                    if gr and gr["ground_code"]:
                        ground_code_display = f"{gr['ground_code']}-{row['ground_name'].replace(' - ', '-').replace(' ', '')}"
            except Exception:
                pass
            grounds_played.append({
                "ground_name": row["ground_name"],
                "ground_code_display": ground_code_display,
            })
    except Exception:
        pass

    # Total games played
    cursor = await db.execute(
        "SELECT COUNT(DISTINCT game_id) as cnt FROM game_players WHERE user_id = ? AND status = 'selected'",
        (target_user_id,)
    )
    total_games = (await cursor.fetchone())["cnt"] or 0

    # Get sport-specific photos map
    sport_photos: dict[str, str] = {}
    try:
        cursor = await db.execute(
            "SELECT purpose, filename FROM user_photos WHERE user_id = ?",
            (target_user_id,)
        )
        photo_rows = await cursor.fetchall()
        for pr in photo_rows:
            sport_photos[pr["purpose"]] = pr["filename"]
    except Exception:
        pass
    # If no profile photo in user_photos, use legacy profile_pic
    if "profile" not in sport_photos and profile_pic:
        sport_photos["profile"] = profile_pic

    return {
        "id": user["id"],
        "user_code": user_code,
        "first_name": first_name,
        "last_name": last_name,
        "name": display_name,
        "phone": user["phone"],
        "sports": sports,
        "sport_positions": sport_positions,
        "profile_pic": profile_pic,
        "sport_photos": sport_photos,
        "roles": roles,
        "sport_rankings": sport_rankings,
        "goal_stats": goal_stats,
        "grounds_played": grounds_played,
        "total_games_played": total_games,
    }

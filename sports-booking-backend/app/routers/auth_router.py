from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from typing import Optional, List
import aiosqlite
import random
import string
from datetime import datetime, timedelta, timezone

from ..database import get_db
from ..auth import hash_password, verify_password, create_access_token, get_current_user_id

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
    google_id: str
    email: str
    first_name: str
    last_name: str


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
    """Assign roles: first user gets all roles, others get 'user'."""
    cursor = await db.execute("SELECT COUNT(*) as cnt FROM users")
    count_row = await cursor.fetchone()
    if count_row["cnt"] == 1:
        await db.execute("INSERT INTO user_roles (user_id, role) VALUES (?, 'admin')", (user_id,))
        await db.execute("INSERT INTO user_roles (user_id, role) VALUES (?, 'moderator')", (user_id,))
        await db.execute("INSERT INTO user_roles (user_id, role) VALUES (?, 'user')", (user_id,))
    else:
        await db.execute("INSERT INTO user_roles (user_id, role) VALUES (?, 'user')", (user_id,))


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

    cursor = await db.execute(
        """INSERT INTO users (first_name, last_name, name, phone, email, password_hash,
           notification_preference, sports, locations, sport_positions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (req.first_name, req.last_name, full_name, req.phone, req.email,
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

    token = create_access_token(user["id"])
    return {"token": token, "user_id": user["id"]}


@router.post("/otp/request")
async def request_otp(req: OTPRequestModel, db: aiosqlite.Connection = Depends(get_db)):
    """Send OTP to user's phone (simulated - returns OTP for demo)."""
    cursor = await db.execute("SELECT id FROM users WHERE phone = ?", (req.phone,))
    user = await cursor.fetchone()
    if not user:
        raise HTTPException(status_code=404, detail="Phone number not registered")

    otp_code = ''.join(random.choices(string.digits, k=6))
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

    if not user["otp_code"] or user["otp_code"] != req.otp:
        raise HTTPException(status_code=401, detail="Invalid OTP")

    # Check expiry
    if user["otp_expires_at"]:
        try:
            expires = datetime.fromisoformat(user["otp_expires_at"])
            if expires.tzinfo is None:
                expires = expires.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > expires:
                raise HTTPException(status_code=401, detail="OTP expired")
        except ValueError:
            pass

    # Clear OTP after successful verification
    await db.execute("UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = ?", (user["id"],))
    await db.commit()

    token = create_access_token(user["id"])
    return {"token": token, "user_id": user["id"]}


@router.post("/google")
async def google_auth(req: GoogleAuthRequest, db: aiosqlite.Connection = Depends(get_db)):
    """Authenticate or register via Google SSO."""
    # Check if user exists by google_id
    cursor = await db.execute("SELECT id FROM users WHERE google_id = ?", (req.google_id,))
    user = await cursor.fetchone()

    if user:
        token = create_access_token(user["id"])
        return {"token": token, "user_id": user["id"]}

    # Check if email already exists
    if req.email:
        cursor = await db.execute("SELECT id FROM users WHERE email = ?", (req.email,))
        existing = await cursor.fetchone()
        if existing:
            # Link google_id to existing account
            await db.execute("UPDATE users SET google_id = ? WHERE id = ?", (req.google_id, existing["id"]))
            await db.commit()
            token = create_access_token(existing["id"])
            return {"token": token, "user_id": existing["id"]}

    # Create new user (no password, no phone initially - will need to set phone later)
    full_name = f"{req.first_name} {req.last_name}".strip()
    # Generate a temporary unique phone placeholder
    temp_phone = f"google_{req.google_id}"

    cursor = await db.execute(
        """INSERT INTO users (first_name, last_name, name, phone, email, google_id,
           notification_preference) VALUES (?, ?, ?, ?, ?, ?, 'whatsapp')""",
        (req.first_name, req.last_name, full_name, temp_phone, req.email, req.google_id)
    )
    user_id = cursor.lastrowid

    await _assign_roles(db, user_id)
    await db.commit()

    token = create_access_token(user_id)
    return {"token": token, "user_id": user_id, "is_new": True}


@router.get("/me")
async def get_profile(
    user_id: int = Depends(get_current_user_id),
    db: aiosqlite.Connection = Depends(get_db)
):
    import json as json_lib
    cursor = await db.execute(
        """SELECT id, first_name, last_name, name, phone, email,
           notification_preference, sports, locations, sport_positions, created_at
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

    return {
        "id": user["id"],
        "first_name": first_name,
        "last_name": last_name,
        "name": display_name,
        "phone": user["phone"],
        "email": user["email"],
        "notification_preference": user["notification_preference"],
        "sports": sports,
        "locations": locations,
        "sport_positions": sport_positions,
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

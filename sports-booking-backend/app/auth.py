import jwt
import os
from datetime import datetime, timedelta, timezone
import bcrypt as _bcrypt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional

SECRET_KEY = os.environ.get("JWT_SECRET", "sports-booking-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 72

security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return _bcrypt.hashpw(password.encode('utf-8'), _bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, password_hash: str) -> bool:
    return _bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))


def create_access_token(user_id: int, impersonator: Optional[int] = None, session_id: Optional[int] = None,
                        hours: Optional[int] = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=hours or ACCESS_TOKEN_EXPIRE_HOURS)
    payload = {"sub": str(user_id), "exp": expire}
    if impersonator:
        payload["imp"] = impersonator
        payload["sid"] = session_id
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


async def _impersonation_active(session_id) -> bool:
    import aiosqlite
    from .database import DATABASE_PATH
    async with aiosqlite.connect(DATABASE_PATH) as db:
        row = await (await db.execute(
            "SELECT 1 FROM impersonation_sessions WHERE id = ? AND revoked_at IS NULL", (session_id,))).fetchone()
    return bool(row)


def decode_token(token: str) -> int:
    return _decode(token)[0]


def _decode(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return int(payload["sub"]), payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


async def get_current_user_id(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> int:
    """Extract JWT from Authorization header or X-Auth-Token header.

    When the app is behind a Basic-Auth proxy (e.g. the Devin expose tunnel),
    the proxy consumes the Authorization header.  The frontend can send the
    JWT via the X-Auth-Token header instead so both auth layers coexist.
    """
    token = credentials.credentials if credentials and credentials.credentials else ""
    if not token:
        # Fallback: X-Auth-Token header
        token = request.headers.get("X-Auth-Token", "").removeprefix("Bearer ").strip()
    if token:
        from .request_context import impersonator_id
        user_id, payload = _decode(token)
        imp = int(payload.get("imp") or 0)
        if imp:
            if not await _impersonation_active(payload.get("sid")):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="This impersonation was logged off")
        impersonator_id.set(imp)
        return user_id

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )

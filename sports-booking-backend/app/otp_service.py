"""OTP delivery via Twilio Verify, with an in-memory demo fallback when Twilio is not configured."""
import os
import random
import string
import hmac
import re
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException

TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_VERIFY_SERVICE_SID = os.environ.get("TWILIO_VERIFY_SERVICE_SID", "")
DEFAULT_COUNTRY_CODE = os.environ.get("DEFAULT_COUNTRY_CODE", "+91")

OTP_TTL_MINUTES = 5
RATE_LIMIT_MAX = 3          # OTP sends per phone
RATE_LIMIT_WINDOW = 10 * 60  # seconds

_demo_otps: dict[str, dict] = {}
_send_log: dict[str, deque] = defaultdict(deque)


def twilio_enabled() -> bool:
    return bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID)


def to_e164(phone: str) -> str:
    digits = re.sub(r"[^\d+]", "", phone.strip())
    if digits.startswith("+"):
        return digits
    if digits.startswith("00"):
        return "+" + digits[2:]
    cc = DEFAULT_COUNTRY_CODE.lstrip("+")
    if len(digits) > 10 and digits.startswith(cc):
        return "+" + digits
    if digits.startswith("0"):
        digits = digits[1:]
    return f"+{cc}{digits}"


def _check_rate_limit(phone: str):
    now = time.time()
    log = _send_log[phone]
    while log and now - log[0] > RATE_LIMIT_WINDOW:
        log.popleft()
    if len(log) >= RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="Too many OTP requests. Please try again in a few minutes.")
    log.append(now)


async def send_otp(phone: str) -> dict:
    """Send an OTP to the phone. Returns the API response payload."""
    _check_rate_limit(phone)
    if not twilio_enabled():
        code = ''.join(random.SystemRandom().choices(string.digits, k=6))
        _demo_otps[phone] = {
            "otp": code,
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES),
        }
        return {"message": "OTP sent successfully", "otp_demo": code}

    url = f"https://verify.twilio.com/v2/Services/{TWILIO_VERIFY_SERVICE_SID}/Verifications"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            url,
            data={"To": to_e164(phone), "Channel": "sms"},
            auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
        )
    if resp.status_code >= 400:
        detail = "Failed to send OTP. Please check the phone number and try again."
        try:
            msg = resp.json().get("message", "")
            if "Invalid parameter `To`" in msg or "not a valid phone number" in msg:
                detail = "Invalid phone number. Please include your country code."
        except ValueError:
            pass
        raise HTTPException(status_code=502, detail=detail)
    return {"message": "OTP sent successfully"}


async def check_otp(phone: str, otp: str) -> bool:
    """Return True if the OTP is valid for the phone. Consumes the code on success or failure."""
    if not twilio_enabled():
        entry = _demo_otps.pop(phone, None)
        if not entry:
            raise HTTPException(status_code=401, detail="No OTP requested for this phone number")
        if datetime.now(timezone.utc) > entry["expires_at"]:
            raise HTTPException(status_code=401, detail="OTP expired. Please request a new one.")
        return hmac.compare_digest(entry["otp"], otp)

    url = f"https://verify.twilio.com/v2/Services/{TWILIO_VERIFY_SERVICE_SID}/VerificationCheck"
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            url,
            data={"To": to_e164(phone), "Code": otp},
            auth=(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN),
        )
    if resp.status_code == 404:
        raise HTTPException(status_code=401, detail="OTP expired or not requested. Please request a new one.")
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail="Could not verify OTP. Please try again.")
    return resp.json().get("status") == "approved"

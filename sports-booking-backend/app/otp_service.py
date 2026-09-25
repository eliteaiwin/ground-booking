"""OTP delivery: SMS via Twilio Verify, email via Resend/SendGrid/SMTP.

Falls back to an in-memory demo code (returned in the API response) when no provider is configured.
"""
import os
import random
import string
import hmac
import re
import smtplib
import time
from email.message import EmailMessage
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException

TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_VERIFY_SERVICE_SID = os.environ.get("TWILIO_VERIFY_SERVICE_SID", "")
DEFAULT_COUNTRY_CODE = os.environ.get("DEFAULT_COUNTRY_CODE", "+91")

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY", "")
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
EMAIL_FROM = os.environ.get("EMAIL_FROM", "Elite Turf Booking <no-reply@elite-turf-booking.fly.dev>")
APP_NAME = "Elite Turf Booking"

# Fixed code accepted for review/demo accounts (e.g. Apple App Review) that cannot receive real OTPs.
DEMO_OTP_CODE = os.environ.get("DEMO_OTP_CODE", "")
DEMO_OTP_IDENTIFIERS = {i.strip().lower() for i in os.environ.get("DEMO_OTP_IDENTIFIERS", "").split(",") if i.strip()}

OTP_TTL_MINUTES = 5
RATE_LIMIT_MAX = 3          # OTP sends per phone
RATE_LIMIT_WINDOW = 10 * 60  # seconds

_demo_otps: dict[str, dict] = {}
_send_log: dict[str, deque] = defaultdict(deque)


def twilio_enabled() -> bool:
    return bool(TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID)


def email_enabled() -> bool:
    return bool(RESEND_API_KEY or SENDGRID_API_KEY or SMTP_HOST)


def is_email(identifier: str) -> bool:
    return "@" in identifier


def normalize_identifier(identifier: str) -> str:
    identifier = identifier.strip()
    return identifier.lower() if is_email(identifier) else identifier


def _is_demo_identifier(identifier: str) -> bool:
    return bool(DEMO_OTP_CODE) and normalize_identifier(identifier).lower() in DEMO_OTP_IDENTIFIERS


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


def _new_local_code(identifier: str) -> str:
    code = ''.join(random.SystemRandom().choices(string.digits, k=6))
    _demo_otps[identifier] = {
        "otp": code,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=OTP_TTL_MINUTES),
    }
    return code


def _check_local_code(identifier: str, otp: str) -> bool:
    entry = _demo_otps.get(identifier)
    if not entry:
        raise HTTPException(status_code=401, detail="No OTP requested. Please request a new one.")
    if datetime.now(timezone.utc) > entry["expires_at"]:
        _demo_otps.pop(identifier, None)
        raise HTTPException(status_code=401, detail="OTP expired. Please request a new one.")
    entry["attempts"] = entry.get("attempts", 0) + 1
    ok = hmac.compare_digest(entry["otp"], otp)
    if ok or entry["attempts"] >= 5:
        _demo_otps.pop(identifier, None)
    return ok


async def _send_email(to: str, subject: str, text: str):
    if RESEND_API_KEY:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
                json={"from": EMAIL_FROM, "to": [to], "subject": subject, "text": text},
            )
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail="Failed to send OTP email. Please try again.")
        return
    if SENDGRID_API_KEY:
        from_name, _, from_addr = EMAIL_FROM.rpartition("<")
        from_addr = from_addr.rstrip(">").strip() or EMAIL_FROM
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.sendgrid.com/v3/mail/send",
                headers={"Authorization": f"Bearer {SENDGRID_API_KEY}"},
                json={
                    "personalizations": [{"to": [{"email": to}]}],
                    "from": {"email": from_addr, "name": from_name.strip() or APP_NAME},
                    "subject": subject,
                    "content": [{"type": "text/plain", "value": text}],
                },
            )
        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail="Failed to send OTP email. Please try again.")
        return
    msg = EmailMessage()
    msg["From"] = EMAIL_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(text)
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as smtp:
            smtp.starttls()
            if SMTP_USER:
                smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(msg)
    except (smtplib.SMTPException, OSError):
        raise HTTPException(status_code=502, detail="Failed to send OTP email. Please try again.")


async def send_otp(identifier: str) -> dict:
    """Send an OTP to a phone number or email address. Returns the API response payload."""
    identifier = normalize_identifier(identifier)
    if _is_demo_identifier(identifier):
        return {"message": "OTP sent successfully"}
    _check_rate_limit(identifier)

    if is_email(identifier):
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", identifier):
            raise HTTPException(status_code=400, detail="Invalid email address.")
        code = _new_local_code(identifier)
        if not email_enabled():
            return {"message": "OTP sent successfully", "otp_demo": code}
        await _send_email(
            identifier,
            f"{code} is your {APP_NAME} login code",
            f"Your {APP_NAME} login code is {code}. It expires in {OTP_TTL_MINUTES} minutes.\n\n"
            "If you did not request this, you can ignore this email.",
        )
        return {"message": "OTP sent successfully"}

    phone = identifier
    if not twilio_enabled():
        return {"message": "OTP sent successfully", "otp_demo": _new_local_code(phone)}

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


async def check_otp(identifier: str, otp: str) -> bool:
    """Return True if the OTP is valid for the phone number or email."""
    identifier = normalize_identifier(identifier)
    otp = otp.strip()
    if _is_demo_identifier(identifier):
        return hmac.compare_digest(DEMO_OTP_CODE, otp)
    if is_email(identifier) or not twilio_enabled():
        return _check_local_code(identifier, otp)

    phone = identifier
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

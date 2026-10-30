"""Phone push notifications through Firebase Cloud Messaging (Android + iOS via APNs)."""
import asyncio
import base64
import json
import logging
import os
from typing import Iterable, Optional

import aiosqlite

from .database import DATABASE_PATH

log = logging.getLogger(__name__)

_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
# Per kind: Android channel id + sound file (res/raw) and iOS bundled sound
SOUNDS = {
    "voting": ("voting", "whistle", "whistle.wav"),
    "payment": ("payment", "coin", "coin.wav"),
}
_creds = None


def _service_account() -> Optional[dict]:
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if not raw:
        return None
    try:
        if not raw.startswith("{"):
            raw = base64.b64decode(raw).decode()
        return json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        log.warning("FIREBASE_SERVICE_ACCOUNT is not valid JSON")
        return None


def push_enabled() -> bool:
    return _service_account() is not None


def _access_token(info: dict) -> str:
    global _creds
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request
    if _creds is None:
        _creds = service_account.Credentials.from_service_account_info(info, scopes=[_SCOPE])
    if not _creds.valid:
        _creds.refresh(Request())
    return _creds.token


def _send_all(tokens: list, title: str, body: str, data: dict, kind: str) -> list:
    """Blocking send; returns tokens Firebase says are no longer valid."""
    import requests
    info = _service_account()
    if not info or not tokens:
        return []
    url = f"https://fcm.googleapis.com/v1/projects/{info['project_id']}/messages:send"
    headers = {"Authorization": f"Bearer {_access_token(info)}"}
    channel, android_sound, ios_sound = SOUNDS.get(kind, ("general", "default", "default"))
    dead = []
    for token in tokens:
        msg = {
            "token": token,
            "notification": {"title": title, "body": body},
            "data": {k: str(v) for k, v in data.items()},
            "android": {"priority": "high", "notification": {"channel_id": channel, "sound": android_sound}},
            "apns": {"payload": {"aps": {"sound": ios_sound}}},
        }
        try:
            r = requests.post(url, json={"message": msg}, headers=headers, timeout=10)
        except requests.RequestException as e:
            log.warning("Push send failed: %s", e)
            continue
        if r.status_code in (400, 404) and ("UNREGISTERED" in r.text or "INVALID_ARGUMENT" in r.text):
            dead.append(token)
        elif r.status_code >= 300:
            log.warning("Push send error %s: %s", r.status_code, r.text[:200])
    return dead


async def _deliver(tokens: list, title: str, body: str, data: dict, kind: str):
    try:
        dead = await asyncio.to_thread(_send_all, tokens, title, body, data, kind)
        if dead:
            async with aiosqlite.connect(DATABASE_PATH) as db:
                await db.executemany("DELETE FROM push_tokens WHERE token = ?", [(t,) for t in dead])
                await db.commit()
    except Exception:  # never let a push failure affect the app
        log.exception("Push delivery failed")


async def push_to_users(db: aiosqlite.Connection, user_ids: Iterable[int], title: str, body: str,
                        kind: str, game_id: Optional[int] = None, open_tab: str = ""):
    """Send a phone push to every registered device of these users, in the background."""
    if not push_enabled():
        return
    ids = list({int(u) for u in user_ids})
    if not ids:
        return
    marks = ",".join("?" * len(ids))
    rows = await (await db.execute(f"SELECT token FROM push_tokens WHERE user_id IN ({marks})", ids)).fetchall()
    tokens = [r[0] for r in rows]
    if not tokens:
        return
    data = {"kind": kind, "game_id": game_id or "", "open": open_tab}
    asyncio.create_task(_deliver(tokens, title, body, data, kind))

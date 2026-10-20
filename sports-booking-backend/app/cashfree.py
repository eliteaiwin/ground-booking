"""Minimal Cashfree Payment Gateway (PG + Easy Split) client."""
import base64
import hashlib
import hmac
import os

import httpx

CASHFREE_APP_ID = os.environ.get("CASHFREE_APP_ID", "")
CASHFREE_SECRET_KEY = os.environ.get("CASHFREE_SECRET_KEY", "")
CASHFREE_ENV = os.environ.get("CASHFREE_ENV", "sandbox").lower()
API_VERSION = "2025-01-01"


class CashfreeError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def configured() -> bool:
    return bool(CASHFREE_APP_ID and CASHFREE_SECRET_KEY)


def mode() -> str:
    return "production" if CASHFREE_ENV == "production" else "sandbox"


def _base_url() -> str:
    return "https://api.cashfree.com/pg" if mode() == "production" else "https://sandbox.cashfree.com/pg"


async def _call(method: str, path: str, body: dict | None = None) -> dict:
    headers = {
        "x-client-id": CASHFREE_APP_ID,
        "x-client-secret": CASHFREE_SECRET_KEY,
        "x-api-version": API_VERSION,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.request(method, f"{_base_url()}{path}", headers=headers, json=body)
    try:
        data = resp.json()
    except ValueError:
        data = {}
    if resp.status_code >= 400:
        message = data.get("message") if isinstance(data, dict) else ""
        raise CashfreeError(resp.status_code, message or f"Cashfree error {resp.status_code}")
    return data


async def get_vendor(vendor_id: str) -> dict:
    return await _call("GET", f"/easy-split/vendors/{vendor_id}")


async def create_vendor(body: dict) -> dict:
    return await _call("POST", "/easy-split/vendors", body)


async def update_vendor(vendor_id: str, body: dict) -> dict:
    return await _call("PATCH", f"/easy-split/vendors/{vendor_id}", body)


async def create_order(body: dict) -> dict:
    return await _call("POST", "/orders", body)


async def get_order(order_id: str) -> dict:
    return await _call("GET", f"/orders/{order_id}")


def verify_webhook(raw_body: bytes, timestamp: str, signature: str) -> bool:
    if not (CASHFREE_SECRET_KEY and timestamp and signature):
        return False
    signed = timestamp.encode() + raw_body
    expected = base64.b64encode(
        hmac.new(CASHFREE_SECRET_KEY.encode(), signed, hashlib.sha256).digest()
    ).decode()
    return hmac.compare_digest(expected, signature)

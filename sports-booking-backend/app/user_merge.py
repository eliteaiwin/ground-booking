"""Merge accounts that share a mobile number, when the extra account has never played a game."""
import logging
from collections import defaultdict

import aiosqlite

from .phone_utils import split_phone

log = logging.getLogger(__name__)

KEEP_COLUMNS = {"id", "user_code", "phone", "country_code", "created_at", "otp_code", "otp_expires_at", "deleted_at"}
EXTRA_REF_COLUMNS = {"user_id", "received_by", "disabled_by", "referred_by", "paid_by"}


def _empty(v) -> bool:
    return v is None or (isinstance(v, str) and v.strip() in ("", "[]", "{}"))


async def _user_ref_columns(db: aiosqlite.Connection) -> list[tuple[str, str]]:
    tables = [r[0] for r in await (await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).fetchall()]
    refs = set()
    for t in tables:
        if t == "users":
            continue
        for fk in await (await db.execute(f"PRAGMA foreign_key_list('{t}')")).fetchall():
            if fk[2] == "users":
                refs.add((t, fk[3]))
        for col in await (await db.execute(f"PRAGMA table_info('{t}')")).fetchall():
            if col[1] in EXTRA_REF_COLUMNS or col[1].endswith("_by"):
                refs.add((t, col[1]))
    refs.add(("users", "disabled_by"))
    return sorted(refs)


async def _has_played(db: aiosqlite.Connection, uid: int) -> bool:
    for sql in ("SELECT 1 FROM game_players WHERE user_id = ? LIMIT 1",
                "SELECT 1 FROM payments WHERE user_id = ? LIMIT 1"):
        try:
            if await (await db.execute(sql, (uid,))).fetchone():
                return True
        except aiosqlite.OperationalError:
            pass
    return False


async def _merge_into(db: aiosqlite.Connection, keep: dict, drop: dict, refs, user_cols):
    did = drop["id"]
    for t, c in refs:
        try:
            await db.execute(f"UPDATE OR IGNORE \"{t}\" SET \"{c}\" = ? WHERE \"{c}\" = ?", (keep["id"], did))
            await db.execute(f"DELETE FROM \"{t}\" WHERE \"{c}\" = ?", (did,))
        except aiosqlite.OperationalError:
            pass
    await db.execute("DELETE FROM users WHERE id = ?", (did,))
    fill = {c: drop[c] for c in user_cols if c not in KEEP_COLUMNS and _empty(keep.get(c)) and not _empty(drop.get(c))}
    if "password_hash" in fill and "force_password_change" in user_cols:
        fill["force_password_change"] = drop.get("force_password_change")
    if fill:
        sets = ", ".join(f"\"{c}\" = ?" for c in fill)
        await db.execute(f"UPDATE users SET {sets} WHERE id = ?", (*fill.values(), keep["id"]))


async def merge_duplicate_phone_users(db: aiosqlite.Connection) -> dict:
    """Groups users by normalised mobile; folds accounts that never played into the one that did (or the oldest).

    Groups where more than one account has played are left alone and reported.
    """
    db.row_factory = aiosqlite.Row
    user_cols = [c[1] for c in await (await db.execute("PRAGMA table_info('users')")).fetchall()]
    where = "WHERE deleted_at IS NULL" if "deleted_at" in user_cols else ""
    rows = [dict(r) for r in await (await db.execute(f"SELECT * FROM users {where} ORDER BY id")).fetchall()]
    groups = defaultdict(list)
    for u in rows:
        cc, national = split_phone(u.get("phone") or "", u.get("country_code"))
        if len(national) >= 6 and national.isdigit():
            groups[(cc, national)].append(u)
    merged, skipped = [], []
    refs = None
    for (cc, national), users in groups.items():
        if len(users) < 2:
            continue
        played = [u for u in users if await _has_played(db, u["id"])]
        if len(played) > 1:
            skipped.append({"phone": national, "user_ids": [u["id"] for u in users]})
            continue
        keep = played[0] if played else users[0]
        refs = refs or await _user_ref_columns(db)
        for drop in users:
            if drop["id"] == keep["id"]:
                continue
            await _merge_into(db, keep, drop, refs, user_cols)
            keep = dict(await (await db.execute("SELECT * FROM users WHERE id = ?", (keep["id"],))).fetchone())
            merged.append({"kept": keep["id"], "removed": drop["id"], "phone": national})
            log.info("Merged user %s into %s (same mobile)", drop["id"], keep["id"])
        if keep.get("phone") != national and not await (await db.execute(
                "SELECT 1 FROM users WHERE phone = ? AND id != ?", (national, keep["id"]))).fetchone():
            await db.execute("UPDATE users SET phone = ?, country_code = ? WHERE id = ?", (national, cc, keep["id"])) \
                if "country_code" in user_cols else await db.execute("UPDATE users SET phone = ? WHERE id = ?", (national, keep["id"]))
    if merged:
        await db.commit()
    if skipped:
        log.warning("Same-mobile accounts not merged (more than one has played): %s", skipped)
    return {"merged": merged, "skipped": skipped}

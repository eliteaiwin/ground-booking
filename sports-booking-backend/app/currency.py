"""A game's currency comes from its ground's country (grounds.country_code), never from the player."""
import aiosqlite

COUNTRY_CURRENCY = {
    "91": "₹", "44": "£", "1": "$", "971": "AED", "966": "SAR", "974": "QAR",
    "65": "S$", "61": "A$", "64": "NZ$", "49": "€", "977": "NPR", "94": "LKR",
}
DEFAULT_CURRENCY = "₹"


def currency_for_country(code: str | None) -> str:
    return COUNTRY_CURRENCY.get((code or "").strip().lstrip("+"), DEFAULT_CURRENCY)


async def ground_currency(db: aiosqlite.Connection, ground_name: str | None) -> str:
    name = (ground_name or "").strip()
    parts = name.split(" - ", 1)
    row = None
    if len(parts) == 2:
        row = await (await db.execute(
            "SELECT country_code FROM grounds WHERE location = ? AND name = ?", (parts[0].strip(), parts[1].strip())
        )).fetchone()
    if row is None and name:
        row = await (await db.execute("SELECT country_code FROM grounds WHERE name = ?", (name,))).fetchone()
    return currency_for_country(row["country_code"] if row else None)

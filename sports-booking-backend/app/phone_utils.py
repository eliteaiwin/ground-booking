import re
from typing import Optional

KNOWN_CODES = ["971", "966", "974", "977", "91", "44", "65", "61", "64", "49", "94", "1"]


def split_phone(raw: str, country_code: Optional[str] = None) -> tuple[str, str]:
    """Return (country_code, national_number). '+44 7700…' wins over country_code; otherwise India by default."""
    s = (raw or "").strip()
    intl = s.startswith("+") or s.startswith("00")
    digits = re.sub(r"\D", "", s)
    if s.startswith("00"):
        digits = digits[2:]
    if intl:
        for code in KNOWN_CODES:
            if digits.startswith(code) and len(digits) - len(code) >= 6:
                return code, digits[len(code):]
    cc = re.sub(r"\D", "", country_code or "") or "91"
    if not intl and len(digits) == 10 + len(cc) and digits.startswith(cc):
        digits = digits[len(cc):]
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return cc, digits


def e164(country_code: str, national: str) -> str:
    return f"+{re.sub(r'[^0-9]', '', country_code or '91') or '91'}{national}"

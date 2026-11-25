from datetime import datetime


def game_date_text(game_date) -> str:
    """'2026-11-22' -> 'Sun 22-Nov'."""
    try:
        return datetime.strptime(str(game_date), "%Y-%m-%d").strftime("%a %d-%b")
    except (TypeError, ValueError):
        return str(game_date or "")


def _cap(s: str, cap: bool) -> str:
    return s[:1].upper() + s[1:] if cap else s


def game_name(game, cap: bool = False) -> str:
    """Title, or 'the <ground> game' when it has none (for messages that already give the date)."""
    title = (game["title"] or "").strip()
    if title:
        return title
    return _cap(f"the {game['ground_name']} game" if game["ground_name"] else "the game", cap)


def game_label(game, cap: bool = False) -> str:
    """Name and date for a game in messages, e.g. 'Sunday Game (Sun 22-Nov)'."""
    title = (game["title"] or "").strip()
    date = game_date_text(game["game_date"])
    if title:
        return f"{title} ({date})" if date else title
    return _cap(f"{game_name(game)} on {date}" if date else game_name(game), cap)

import aiosqlite
import os

DATABASE_PATH = os.environ.get("DATABASE_PATH", "/data/app.db")

# Fallback for local development
if not os.path.exists(os.path.dirname(DATABASE_PATH)):
    DATABASE_PATH = os.path.join(os.path.dirname(__file__), "..", "app.db")


async def get_db():
    db = await aiosqlite.connect(DATABASE_PATH)
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
    finally:
        await db.close()


async def init_db():
    db = await aiosqlite.connect(DATABASE_PATH)
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")

    await db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            first_name TEXT NOT NULL DEFAULT '',
            last_name TEXT NOT NULL DEFAULT '',
            name TEXT NOT NULL DEFAULT '',
            phone TEXT NOT NULL UNIQUE,
            email TEXT,
            password_hash TEXT,
            notification_preference TEXT NOT NULL DEFAULT 'whatsapp',
            sports TEXT NOT NULL DEFAULT '',
            locations TEXT NOT NULL DEFAULT '',
            sport_positions TEXT NOT NULL DEFAULT '',
            google_id TEXT,
            otp_code TEXT,
            otp_expires_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS user_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'moderator', 'user')),
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, role)
        );

        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            sport_type TEXT NOT NULL,
            ground_name TEXT NOT NULL,
            game_date TEXT NOT NULL,
            game_time TEXT NOT NULL,
            max_players INTEGER NOT NULL,
            cost_per_person REAL NOT NULL,
            payment_timing TEXT NOT NULL DEFAULT 'after',
            status TEXT NOT NULL DEFAULT 'draft',
            payee_user_id INTEGER,
            quit_penalty_hours INTEGER NOT NULL DEFAULT 0,
            created_by INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id),
            FOREIGN KEY (payee_user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS game_players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'selected',
            position TEXT NOT NULL DEFAULT '',
            nominated_by INTEGER,
            team_id INTEGER,
            payment_confirmed INTEGER NOT NULL DEFAULT 0,
            joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (nominated_by) REFERENCES users(id),
            UNIQUE(game_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'paid')),
            paid_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(game_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS potd_votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            voter_id INTEGER NOT NULL,
            player_id INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id),
            FOREIGN KEY (voter_id) REFERENCES users(id),
            FOREIGN KEY (player_id) REFERENCES users(id),
            UNIQUE(game_id, voter_id)
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            game_id INTEGER,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            is_read INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (game_id) REFERENCES games(id)
        );

        CREATE TABLE IF NOT EXISTS moderator_preferences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sport_type TEXT NOT NULL UNIQUE,
            default_max_players INTEGER NOT NULL DEFAULT 10
        );

        CREATE TABLE IF NOT EXISTS game_teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            team_name TEXT NOT NULL,
            team_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (game_id) REFERENCES games(id)
        );

        CREATE TABLE IF NOT EXISTS locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS grounds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            location TEXT NOT NULL,
            created_by INTEGER,
            is_approved INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id),
            UNIQUE(name, location)
        );

        CREATE TABLE IF NOT EXISTS moderator_locations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            location TEXT NOT NULL,
            ground_name TEXT NOT NULL DEFAULT '',
            sport_type TEXT NOT NULL DEFAULT '',
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, location, ground_name, sport_type)
        );

        CREATE TABLE IF NOT EXISTS payment_settlements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            moderator_id INTEGER NOT NULL,
            comment TEXT NOT NULL DEFAULT '',
            action_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (moderator_id) REFERENCES users(id)
        );
    """)

    # Migration: add columns if they don't exist (for existing databases)
    migrations = [
        "ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE users ADD COLUMN sports TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE users ADD COLUMN locations TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE users ADD COLUMN sport_positions TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE users ADD COLUMN google_id TEXT",
        "ALTER TABLE users ADD COLUMN otp_code TEXT",
        "ALTER TABLE users ADD COLUMN otp_expires_at TIMESTAMP",
        "ALTER TABLE games ADD COLUMN quit_penalty_hours INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE game_players ADD COLUMN position TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE game_players ADD COLUMN team_id INTEGER",
        "ALTER TABLE game_players ADD COLUMN payment_confirmed INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN currency TEXT NOT NULL DEFAULT 'Rs'",
        "ALTER TABLE users ADD COLUMN phone_verified INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE games ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 90",
        "ALTER TABLE moderator_locations ADD COLUMN sport_type TEXT NOT NULL DEFAULT ''",
    ]
    for migration in migrations:
        try:
            await db.execute(migration)
        except Exception:
            pass

    # Seed default moderator preferences
    defaults = [
        ("soccer", 16), ("cricket", 14), ("badminton", 4),
        ("basketball", 10), ("hockey", 14),
    ]
    for sport, count in defaults:
        try:
            await db.execute(
                "INSERT OR IGNORE INTO moderator_preferences (sport_type, default_max_players) VALUES (?, ?)",
                (sport, count)
            )
        except Exception:
            pass

    # Migrate old 'name' column to first_name/last_name if needed
    try:
        cursor = await db.execute(
            "SELECT id, name FROM users WHERE (first_name = '' OR first_name IS NULL) AND name IS NOT NULL AND name != ''"
        )
        rows = await cursor.fetchall()
        for row in rows:
            parts = row["name"].split(" ", 1)
            fn = parts[0]
            ln = parts[1] if len(parts) > 1 else ""
            await db.execute("UPDATE users SET first_name = ?, last_name = ? WHERE id = ?", (fn, ln, row["id"]))
    except Exception:
        pass

    # Migrate old 'football' sport_type to 'soccer'
    try:
        await db.execute("UPDATE games SET sport_type = 'soccer' WHERE sport_type = 'football'")
    except Exception:
        pass

    # Fix sample user names: replace role-based last names with proper surnames
    role_name_fixes = {
        "Admin": "Joseph",
        "Goalie": "Ferguson",
        "Midfielder": "Beckham",
        "Striker": "Ronaldo",
        "Keeper": "Schmeichel",
        "Forward": "Henry",
    }
    try:
        cursor = await db.execute("SELECT id, first_name, last_name, name FROM users")
        rows = await cursor.fetchall()
        for row in rows:
            ln = row["last_name"] or ""
            if ln in role_name_fixes:
                new_ln = role_name_fixes[ln]
                new_name = f"{row['first_name']} {new_ln}".strip()
                await db.execute(
                    "UPDATE users SET last_name = ?, name = ? WHERE id = ?",
                    (new_ln, new_name, row["id"])
                )
    except Exception:
        pass

    await db.commit()
    await db.close()

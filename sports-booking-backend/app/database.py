import aiosqlite
import os
import json as _json

DATABASE_PATH = os.environ.get("DATABASE_PATH", "/data/app.db")
SEED_MODE = os.environ.get("SEED_MODE", "")  # "production" to seed admin+test users, "" for no auto-seed

# Fallback for local development: if the parent directory doesn't exist, use a
# path relative to this package.  os.path.dirname("app.db") returns "" which
# makes os.path.exists("") return False — the fallback still applies correctly.
_db_dir = os.path.dirname(DATABASE_PATH)
if _db_dir and not os.path.exists(_db_dir):
    DATABASE_PATH = os.path.join(os.path.dirname(__file__), "..", "app.db")
elif not _db_dir:
    # Bare filename like "app.db" — resolve relative to project root
    DATABASE_PATH = os.path.join(os.path.dirname(__file__), "..", DATABASE_PATH)


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
    db.row_factory = aiosqlite.Row
    await db.execute("PRAGMA journal_mode=WAL")
    await db.execute("PRAGMA foreign_keys=ON")

    await db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_code TEXT NOT NULL DEFAULT '',
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
            profile_pic TEXT NOT NULL DEFAULT '',
            google_id TEXT,
            otp_code TEXT,
            otp_expires_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS user_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin', 'ground_management', 'moderator', 'user', 'readonly')),
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, role)
        );

        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            game_code TEXT NOT NULL DEFAULT '',
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
            voting_token TEXT,
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
            preference INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id),
            FOREIGN KEY (voter_id) REFERENCES users(id),
            FOREIGN KEY (player_id) REFERENCES users(id),
            UNIQUE(game_id, voter_id, preference)
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
            ground_code TEXT NOT NULL DEFAULT '',
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

        CREATE TABLE IF NOT EXISTS discussion_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER,
            user_id INTEGER NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            parent_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (parent_id) REFERENCES discussion_messages(id)
        );

        CREATE TABLE IF NOT EXISTS discussion_media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            media_type TEXT NOT NULL CHECK(media_type IN ('photo', 'video')),
            file_path TEXT NOT NULL,
            file_name TEXT NOT NULL DEFAULT '',
            caption TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS media_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            comment TEXT NOT NULL,
            parent_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (media_id) REFERENCES discussion_media(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (parent_id) REFERENCES media_comments(id)
        );

        CREATE TABLE IF NOT EXISTS emoji_reactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            target_type TEXT NOT NULL CHECK(target_type IN ('message', 'media', 'media_comment')),
            target_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            emoji TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(target_type, target_id, user_id, emoji)
        );

        CREATE TABLE IF NOT EXISTS ground_management_assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            ground_id INTEGER NOT NULL,
            assigned_by INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (ground_id) REFERENCES grounds(id),
            FOREIGN KEY (assigned_by) REFERENCES users(id),
            UNIQUE(user_id, ground_id)
        );

        CREATE TABLE IF NOT EXISTS game_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL UNIQUE,
            team_a_id INTEGER,
            team_a_score INTEGER NOT NULL DEFAULT 0,
            team_b_id INTEGER,
            team_b_score INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id),
            FOREIGN KEY (team_a_id) REFERENCES game_teams(id),
            FOREIGN KEY (team_b_id) REFERENCES game_teams(id)
        );

        CREATE TABLE IF NOT EXISTS goal_scorers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            goals INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (game_id) REFERENCES games(id),
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(game_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS ground_join_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            ground_id INTEGER NOT NULL,
            sports TEXT NOT NULL DEFAULT '',
            message TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
            assigned_role TEXT NOT NULL DEFAULT 'user' CHECK(assigned_role IN ('user', 'readonly')),
            reviewed_by INTEGER,
            reviewed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (ground_id) REFERENCES grounds(id),
            FOREIGN KEY (reviewed_by) REFERENCES users(id),
            UNIQUE(user_id, ground_id)
        );

        CREATE TABLE IF NOT EXISTS ground_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            ground_id INTEGER NOT NULL,
            role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'readonly')),
            max_nominations INTEGER NOT NULL DEFAULT 0,
            added_by INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (ground_id) REFERENCES grounds(id),
            FOREIGN KEY (added_by) REFERENCES users(id),
            UNIQUE(user_id, ground_id)
        );

        CREATE TABLE IF NOT EXISTS notification_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            voting_started INTEGER NOT NULL DEFAULT 1,
            game_cancelled INTEGER NOT NULL DEFAULT 1,
            game_completed_vote INTEGER NOT NULL DEFAULT 1,
            potd_announced INTEGER NOT NULL DEFAULT 1,
            potd_congrats_delay_hours INTEGER NOT NULL DEFAULT 24,
            vacation_start TEXT,
            vacation_end TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS ground_alert_pauses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            ground_id INTEGER NOT NULL,
            sport_type TEXT NOT NULL DEFAULT '',
            paused INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (ground_id) REFERENCES grounds(id),
            UNIQUE(user_id, ground_id, sport_type)
        );

        CREATE TABLE IF NOT EXISTS moderator_alert_overrides (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            ground_id INTEGER NOT NULL,
            set_by INTEGER NOT NULL,
            payment_overdue_enabled INTEGER NOT NULL DEFAULT 1,
            payment_reminder_enabled INTEGER NOT NULL DEFAULT 1,
            nomination_payment_alert INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (ground_id) REFERENCES grounds(id),
            FOREIGN KEY (set_by) REFERENCES users(id),
            UNIQUE(user_id, ground_id)
        );

        CREATE TABLE IF NOT EXISTS payment_reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            game_id INTEGER NOT NULL,
            reminder_count INTEGER NOT NULL DEFAULT 0,
            last_reminded_at TIMESTAMP,
            moderator_alerted INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (game_id) REFERENCES games(id),
            UNIQUE(user_id, game_id)
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
        "ALTER TABLE potd_votes ADD COLUMN preference INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE grounds ADD COLUMN ground_code TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE games ADD COLUMN game_code TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE users ADD COLUMN user_code TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE users ADD COLUMN profile_pic TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE ground_members ADD COLUMN max_nominations INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE games ADD COLUMN voting_token TEXT",
        "ALTER TABLE users ADD COLUMN force_password_change INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN password_reset_token TEXT",
        "ALTER TABLE users ADD COLUMN password_reset_expires TIMESTAMP",
    ]
    for migration in migrations:
        try:
            await db.execute(migration)
        except Exception:
            pass

    # Migrate user_roles CHECK constraint to support new roles (existing DBs)
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS user_roles_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'ground_management', 'moderator', 'user', 'readonly')),
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, role)
            );
            INSERT OR IGNORE INTO user_roles_new (id, user_id, role)
                SELECT id, user_id, role FROM user_roles;
            DROP TABLE user_roles;
            ALTER TABLE user_roles_new RENAME TO user_roles;
        """)
    except Exception:
        pass

    # Migrate potd_votes UNIQUE constraint for ranked voting (existing DBs)
    try:
        await db.executescript("""
            CREATE TABLE IF NOT EXISTS potd_votes_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                game_id INTEGER NOT NULL,
                voter_id INTEGER NOT NULL,
                player_id INTEGER NOT NULL,
                preference INTEGER NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (game_id) REFERENCES games(id),
                FOREIGN KEY (voter_id) REFERENCES users(id),
                FOREIGN KEY (player_id) REFERENCES users(id),
                UNIQUE(game_id, voter_id, preference)
            );
            INSERT OR IGNORE INTO potd_votes_new (id, game_id, voter_id, player_id, preference, created_at)
                SELECT id, game_id, voter_id, player_id, preference, created_at FROM potd_votes;
            DROP TABLE potd_votes;
            ALTER TABLE potd_votes_new RENAME TO potd_votes;
        """)
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

    # Seed data based on SEED_MODE
    if SEED_MODE == "production":
        await _seed_production_data(db)

    await db.close()


async def _seed_production_data(db: aiosqlite.Connection):
    """Seed the production instance with 2 admin users + 20 test users.
    Only runs once (skips if users already exist).
    """
    from .auth import hash_password

    cursor = await db.execute("SELECT COUNT(*) as cnt FROM users")
    count = (await cursor.fetchone())["cnt"]
    if count > 0:
        return  # Already seeded

    password_hash = hash_password("password123")

    # --- 2 Admin users ---
    admin_users = [
        {
            "first_name": "Tittle", "last_name": "Joseph",
            "phone": "9900000001", "email": "tittlejoseph@gmail.com",
            "sports": "soccer,cricket", "locations": "Bangalore",
            "sport_positions": _json.dumps({"soccer": ["Midfielder"], "cricket": ["Batsman"]}),
        },
        {
            "first_name": "Elite", "last_name": "Dev",
            "phone": "9900000002", "email": "elitedevlit@gmail.com",
            "sports": "soccer,cricket,badminton", "locations": "Bangalore",
            "sport_positions": _json.dumps({"soccer": ["Striker"], "cricket": ["Bowler"], "badminton": ["Singles"]}),
        },
    ]

    for admin in admin_users:
        full_name = f"{admin['first_name']} {admin['last_name']}"
        cursor = await db.execute(
            """INSERT INTO users (first_name, last_name, name, phone, email, password_hash,
               notification_preference, sports, locations, sport_positions)
               VALUES (?, ?, ?, ?, ?, ?, 'whatsapp', ?, ?, ?)""",
            (admin["first_name"], admin["last_name"], full_name,
             admin["phone"], admin["email"], password_hash,
             admin["sports"], admin["locations"], admin["sport_positions"])
        )
        uid = cursor.lastrowid
        await db.execute("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'admin')", (uid,))
        await db.execute("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'ground_management')", (uid,))
        await db.execute("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'moderator')", (uid,))
        await db.execute("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'user')", (uid,))

    # --- 20 Test users ---
    test_users = [
        {"first_name": "Rahul",    "last_name": "Sharma",    "sports": "soccer,cricket"},
        {"first_name": "Priya",    "last_name": "Patel",     "sports": "badminton,cricket"},
        {"first_name": "Amit",     "last_name": "Kumar",     "sports": "soccer"},
        {"first_name": "Neha",     "last_name": "Singh",     "sports": "soccer,basketball"},
        {"first_name": "Vikram",   "last_name": "Reddy",     "sports": "cricket"},
        {"first_name": "Ananya",   "last_name": "Gupta",     "sports": "badminton"},
        {"first_name": "Rohan",    "last_name": "Verma",     "sports": "soccer,hockey"},
        {"first_name": "Sneha",    "last_name": "Iyer",      "sports": "cricket,badminton"},
        {"first_name": "Arjun",    "last_name": "Nair",      "sports": "soccer"},
        {"first_name": "Kavita",   "last_name": "Menon",     "sports": "basketball"},
        {"first_name": "Suresh",   "last_name": "Pillai",    "sports": "soccer,cricket"},
        {"first_name": "Divya",    "last_name": "Rao",       "sports": "badminton,hockey"},
        {"first_name": "Manish",   "last_name": "Joshi",     "sports": "soccer"},
        {"first_name": "Pooja",    "last_name": "Desai",     "sports": "cricket"},
        {"first_name": "Rajesh",   "last_name": "Kulkarni",  "sports": "soccer,basketball"},
        {"first_name": "Meera",    "last_name": "Chatterjee","sports": "badminton"},
        {"first_name": "Sanjay",   "last_name": "Mishra",    "sports": "hockey,soccer"},
        {"first_name": "Lakshmi",  "last_name": "Venkat",    "sports": "cricket,soccer"},
        {"first_name": "Karthik",  "last_name": "Bhat",      "sports": "soccer"},
        {"first_name": "Ritu",     "last_name": "Agarwal",   "sports": "badminton,basketball"},
    ]

    for i, user in enumerate(test_users, start=1):
        phone = f"990000010{i}" if i < 10 else f"99000001{i}"
        full_name = f"{user['first_name']} {user['last_name']}"
        cursor = await db.execute(
            """INSERT INTO users (first_name, last_name, name, phone, email, password_hash,
               notification_preference, sports, locations, sport_positions)
               VALUES (?, ?, ?, ?, ?, ?, 'whatsapp', ?, 'Bangalore', '')""",
            (user["first_name"], user["last_name"], full_name,
             phone, f"{user['first_name'].lower()}.{user['last_name'].lower()}@test.com",
             password_hash, user["sports"])
        )
        uid = cursor.lastrowid
        await db.execute("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, 'user')", (uid,))

    # Create default location and ground for Bangalore
    await db.execute(
        "INSERT OR IGNORE INTO locations (name, created_by) VALUES ('Bangalore', 1)"
    )
    await db.execute(
        "INSERT OR IGNORE INTO grounds (name, location, created_by, ground_code) VALUES ('Whitefield United', 'Bangalore', 1, 'G001')"
    )

    await db.commit()

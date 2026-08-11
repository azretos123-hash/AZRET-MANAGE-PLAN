import os
import sqlite3
import secrets
from datetime import datetime
from werkzeug.security import generate_password_hash

DATABASE_URL = (os.environ.get("DATABASE_URL") or "").strip()
IS_RENDER = bool(os.environ.get("RENDER") or os.environ.get("RENDER_SERVICE_ID"))
IS_POSTGRES = DATABASE_URL.startswith("postgres://") or DATABASE_URL.startswith("postgresql://")
SQLITE_PATH = os.environ.get("SQLITE_PATH", "database.db")

# IMPORTANT PERSISTENCE GUARD:
# Render's filesystem is ephemeral. A SQLite database written there can vanish
# whenever the service restarts/redeploys (which may look like data was
# automatically deleted after some hours/a day). Production on Render must use
# Neon/PostgreSQL. We intentionally fail fast instead of silently falling back
# to SQLite and risking finance-data loss.
if DATABASE_URL and not IS_POSTGRES:
    raise RuntimeError("DATABASE_URL must be a PostgreSQL/Neon connection string")
if IS_RENDER and not IS_POSTGRES:
    raise RuntimeError(
        "Persistent database required on Render: set DATABASE_URL to your Neon PostgreSQL connection string. "
        "SQLite is allowed only for local development."
    )

DATA_TABLES = [
    'income', 'expenses', 'savings', 'family_transfers',
    'emi', 'debts', 'notes', 'shopping'
]
PAYMENT_TABLES = ['emi_payments', 'debt_payments']
ALLOWED_TABLES = set(DATA_TABLES + PAYMENT_TABLES)


class Row(dict):
    """Mapping row that also supports integer indexing like sqlite3.Row."""
    def __init__(self, mapping, order=None):
        super().__init__(mapping)
        self._order = list(order or mapping.keys())

    def __getitem__(self, key):
        if isinstance(key, int):
            return super().__getitem__(self._order[key])
        return super().__getitem__(key)


class CursorAdapter:
    def __init__(self, cursor, postgres=False):
        self._cursor = cursor
        self.postgres = postgres

    @staticmethod
    def _convert_placeholders(sql):
        # Project SQL uses DB-API '?' placeholders. There are no literal '?' SQL
        # operators in this codebase, so this conversion is safe here.
        return sql.replace('?', '%s')

    def execute(self, sql, params=()):
        if self.postgres:
            sql = self._convert_placeholders(sql)
        self._cursor.execute(sql, params)
        return self

    def executemany(self, sql, seq):
        if self.postgres:
            sql = self._convert_placeholders(sql)
        self._cursor.executemany(sql, seq)
        return self

    @property
    def rowcount(self):
        return self._cursor.rowcount

    @property
    def description(self):
        return self._cursor.description

    def _wrap(self, raw):
        if raw is None:
            return None
        if isinstance(raw, sqlite3.Row):
            keys = raw.keys()
            return Row({k: raw[k] for k in keys}, keys)
        if isinstance(raw, dict):
            return Row(raw)
        if self._cursor.description:
            cols = [d.name if hasattr(d, 'name') else d[0] for d in self._cursor.description]
            return Row(dict(zip(cols, raw)), cols)
        return raw

    def fetchone(self):
        return self._wrap(self._cursor.fetchone())

    def fetchall(self):
        return [self._wrap(r) for r in self._cursor.fetchall()]

    def close(self):
        return self._cursor.close()


class ConnectionAdapter:
    def __init__(self, conn, postgres=False):
        self._conn = conn
        self.postgres = postgres

    def cursor(self):
        return CursorAdapter(self._conn.cursor(), self.postgres)

    def commit(self):
        return self._conn.commit()

    def rollback(self):
        return self._conn.rollback()

    def close(self):
        return self._conn.close()


def storage_backend_info():
    return {
        "backend": "postgresql" if IS_POSTGRES else "sqlite",
        "persistent_for_render": bool(IS_POSTGRES),
        "database_url_configured": bool(DATABASE_URL),
    }


def get_db():
    if IS_POSTGRES:
        import psycopg
        # Neon connection strings already include TLS options. Keep autocommit off
        # so each helper can commit or rollback atomically.
        conn = psycopg.connect(DATABASE_URL, connect_timeout=10)
        return ConnectionAdapter(conn, postgres=True)

    conn = sqlite3.connect(SQLITE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return ConnectionAdapter(conn, postgres=False)


def _table_exists(cursor, table):
    if IS_POSTGRES:
        cursor.execute("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=?)", (table,))
        row = cursor.fetchone()
        return bool(row and row[0])
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,))
    return cursor.fetchone() is not None


def _columns(cursor, table):
    if IS_POSTGRES:
        cursor.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=?", (table,))
        return {row['column_name'] for row in cursor.fetchall()}
    cursor.execute(f"PRAGMA table_info({table})")
    return {row['name'] for row in cursor.fetchall()}


def _add_column(cursor, table, definition):
    column = definition.split()[0]
    if column not in _columns(cursor, table):
        if IS_POSTGRES:
            # SQLite-ish types used by migration definitions are valid enough in
            # Postgres except REAL, which Postgres accepts as an alias.
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")
        else:
            cursor.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def _create_schema_postgres(c):
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS income (
        id BIGSERIAL PRIMARY KEY, user_id BIGINT,
        type TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, date TEXT NOT NULL,
        time TEXT NOT NULL, notes TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS expenses (
        id BIGSERIAL PRIMARY KEY, user_id BIGINT,
        name TEXT NOT NULL, category TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL,
        date TEXT NOT NULL, time TEXT NOT NULL, notes TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS savings (
        id BIGSERIAL PRIMARY KEY, user_id BIGINT,
        type TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, goal DOUBLE PRECISION DEFAULT 0,
        date TEXT NOT NULL, time TEXT NOT NULL, notes TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS family_transfers (
        id BIGSERIAL PRIMARY KEY, user_id BIGINT,
        amount DOUBLE PRECISION NOT NULL, receiver TEXT NOT NULL, date TEXT NOT NULL,
        time TEXT NOT NULL, notes TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS emi (
        id BIGSERIAL PRIMARY KEY, user_id BIGINT,
        name TEXT NOT NULL, category TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL,
        paid DOUBLE PRECISION DEFAULT 0, monthly_payment DOUBLE PRECISION DEFAULT 0,
        date TEXT NOT NULL, time TEXT NOT NULL, notes TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS debts (
        id BIGSERIAL PRIMARY KEY, user_id BIGINT,
        person TEXT NOT NULL, description TEXT, total_amount DOUBLE PRECISION NOT NULL,
        paid_amount DOUBLE PRECISION DEFAULT 0, monthly_payment DOUBLE PRECISION DEFAULT 0,
        due_date TEXT, date TEXT NOT NULL, time TEXT NOT NULL, notes TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS notes (
        id BIGSERIAL PRIMARY KEY, user_id BIGINT,
        title TEXT NOT NULL, content TEXT, date TEXT NOT NULL, time TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS shopping (
        id BIGSERIAL PRIMARY KEY, user_id BIGINT,
        product_name TEXT NOT NULL, category TEXT NOT NULL,
        quantity DOUBLE PRECISION NOT NULL DEFAULT 1, price DOUBLE PRECISION NOT NULL DEFAULT 0,
        total DOUBLE PRECISION NOT NULL DEFAULT 0, priority TEXT DEFAULT 'Medium',
        date TEXT NOT NULL, time TEXT NOT NULL, notes TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS emi_payments (
        id BIGSERIAL PRIMARY KEY, user_id BIGINT,
        emi_id BIGINT NOT NULL, amount DOUBLE PRECISION NOT NULL, date TEXT NOT NULL,
        time TEXT NOT NULL, notes TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS debt_payments (
        id BIGSERIAL PRIMARY KEY, user_id BIGINT,
        debt_id BIGINT NOT NULL, amount DOUBLE PRECISION NOT NULL, date TEXT NOT NULL,
        time TEXT NOT NULL, notes TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)''')
    c.execute('''CREATE TABLE IF NOT EXISTS settings (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        UNIQUE(user_id, key)
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS ai_chat_history (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'chat',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS user_assets (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        kind TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        data BYTEA NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, kind)
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )''')


def _create_schema_sqlite(c):
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    table_sql = {
        'income': '''CREATE TABLE IF NOT EXISTS income (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            type TEXT NOT NULL, amount REAL NOT NULL, date TEXT NOT NULL,
            time TEXT NOT NULL, notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
        'expenses': '''CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            name TEXT NOT NULL, category TEXT NOT NULL, amount REAL NOT NULL,
            date TEXT NOT NULL, time TEXT NOT NULL, notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
        'savings': '''CREATE TABLE IF NOT EXISTS savings (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            type TEXT NOT NULL, amount REAL NOT NULL, goal REAL DEFAULT 0,
            date TEXT NOT NULL, time TEXT NOT NULL, notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
        'family_transfers': '''CREATE TABLE IF NOT EXISTS family_transfers (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            amount REAL NOT NULL, receiver TEXT NOT NULL, date TEXT NOT NULL,
            time TEXT NOT NULL, notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
        'emi': '''CREATE TABLE IF NOT EXISTS emi (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            name TEXT NOT NULL, category TEXT NOT NULL, amount REAL NOT NULL,
            paid REAL DEFAULT 0, monthly_payment REAL DEFAULT 0,
            date TEXT NOT NULL, time TEXT NOT NULL, notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
        'debts': '''CREATE TABLE IF NOT EXISTS debts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            person TEXT NOT NULL, description TEXT, total_amount REAL NOT NULL,
            paid_amount REAL DEFAULT 0, monthly_payment REAL DEFAULT 0,
            due_date TEXT, date TEXT NOT NULL, time TEXT NOT NULL, notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
        'notes': '''CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            title TEXT NOT NULL, content TEXT, date TEXT NOT NULL, time TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
        'shopping': '''CREATE TABLE IF NOT EXISTS shopping (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            product_name TEXT NOT NULL, category TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 1, price REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0, priority TEXT DEFAULT 'Medium',
            date TEXT NOT NULL, time TEXT NOT NULL, notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''',
        'emi_payments': '''CREATE TABLE IF NOT EXISTS emi_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            emi_id INTEGER NOT NULL, amount REAL NOT NULL, date TEXT NOT NULL,
            time TEXT NOT NULL, notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (emi_id) REFERENCES emi(id) ON DELETE CASCADE)''',
        'debt_payments': '''CREATE TABLE IF NOT EXISTS debt_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            debt_id INTEGER NOT NULL, amount REAL NOT NULL, date TEXT NOT NULL,
            time TEXT NOT NULL, notes TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (debt_id) REFERENCES debts(id) ON DELETE CASCADE)'''
    }
    for sql in table_sql.values():
        c.execute(sql)
    c.execute('''CREATE TABLE IF NOT EXISTS ai_chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'chat',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS user_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        kind TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        data BLOB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, kind)
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')


def _ensure_settings_schema(c, owner_id):
    if not _table_exists(c, 'settings'):
        if IS_POSTGRES:
            c.execute('''CREATE TABLE settings (
                id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL,
                key TEXT NOT NULL, value TEXT, UNIQUE(user_id,key))''')
        else:
            c.execute('''CREATE TABLE settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
                key TEXT NOT NULL, value TEXT, UNIQUE(user_id,key))''')
        return

    cols = _columns(c, 'settings')
    if 'user_id' in cols:
        return

    # Legacy single-user settings table -> per-user settings.
    if IS_POSTGRES:
        c.execute("ALTER TABLE settings RENAME TO settings_legacy")
        c.execute('''CREATE TABLE settings (
            id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL,
            key TEXT NOT NULL, value TEXT, UNIQUE(user_id,key))''')
    else:
        c.execute("ALTER TABLE settings RENAME TO settings_legacy")
        c.execute('''CREATE TABLE settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
            key TEXT NOT NULL, value TEXT, UNIQUE(user_id,key))''')

    # If there is no account yet, keep legacy settings under temporary owner 0.
    # The first registered account will claim them. This prevents data loss when
    # upgrading an old single-user production database before registration.
    legacy_owner = owner_id if owner_id is not None else 0
    c.execute("SELECT key, value FROM settings_legacy")
    for row in c.fetchall():
        c.execute("INSERT INTO settings (user_id,key,value) VALUES (?,?,?) ON CONFLICT(user_id,key) DO NOTHING",
                  (legacy_owner, row['key'], row['value']))
    c.execute("DROP TABLE settings_legacy")


def init_db():
    conn = get_db()
    c = conn.cursor()
    try:
        if IS_POSTGRES:
            _create_schema_postgres(c)
        else:
            _create_schema_sqlite(c)

        _add_column(c, 'users', 'email TEXT')
        _add_column(c, 'users', 'created_at TIMESTAMP')
        for table in DATA_TABLES + PAYMENT_TABLES:
            _add_column(c, table, 'user_id BIGINT' if IS_POSTGRES else 'user_id INTEGER')
        _add_column(c, 'emi', 'monthly_payment DOUBLE PRECISION DEFAULT 0' if IS_POSTGRES else 'monthly_payment REAL DEFAULT 0')
        _add_column(c, 'debts', 'monthly_payment DOUBLE PRECISION DEFAULT 0' if IS_POSTGRES else 'monthly_payment REAL DEFAULT 0')

        c.execute("SELECT id FROM users ORDER BY id LIMIT 1")
        first = c.fetchone()
        owner_id = first['id'] if first else None

        # Migrate a legacy single-user settings table before any code touches
        # settings.user_id. In older databases the settings table may not have
        # that column yet; touching it first would make startup fail.
        _ensure_settings_schema(c, owner_id)

        if owner_id is not None:
            c.execute("UPDATE users SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP) WHERE id = ?", (owner_id,))
            # SECURITY: legacy rows with NULL ownership are never auto-assigned to
            # whichever account happens to have the lowest id. Only an explicitly
            # configured legacy owner may claim them. This avoids cross-user data
            # exposure after converting an old single-user database to public use.
            legacy_email = (os.environ.get("LEGACY_OWNER_EMAIL") or "").strip().lower()
            legacy_username = (os.environ.get("LEGACY_OWNER_USERNAME") or "").strip().lower()
            if legacy_email or legacy_username:
                c.execute("SELECT username, email FROM users WHERE id=?", (owner_id,))
                owner = c.fetchone()
                owner_email = str((owner or {}).get('email') or '').strip().lower()
                owner_username = str((owner or {}).get('username') or '').strip().lower()
                owner_match = bool(legacy_email and owner_email == legacy_email)
                if not legacy_email and legacy_username:
                    owner_match = owner_username == legacy_username
                elif owner_match and legacy_username:
                    owner_match = owner_username == legacy_username
                if owner_match:
                    for table in DATA_TABLES + PAYMENT_TABLES:
                        c.execute(f"UPDATE {table} SET user_id = ? WHERE user_id IS NULL", (owner_id,))
                    c.execute("UPDATE settings SET user_id=? WHERE user_id=0", (owner_id,))

        defaults = {
            'theme': 'light', 'default_currency': 'AED', 'primary_currency': 'AED', 'secondary_currency': 'INR', 'exchange_rate': '22.60',
            'app_name': 'Rizq رزق — Growth نمو', 'shopping_budget': '0',
            'splash_video_url': '',
            'theme_image_url': '', 'theme_video_url': '', 'logo_url': ''
        }
        if owner_id is not None:
            for k, v in defaults.items():
                c.execute("INSERT INTO settings (user_id,key,value) VALUES (?,?,?) ON CONFLICT(user_id,key) DO NOTHING",
                          (owner_id, k, v))

        # Indexes improve the public multi-user workload and also reinforce that
        # nearly every query is scoped by user_id.
        for table in DATA_TABLES + PAYMENT_TABLES:
            c.execute(f"CREATE INDEX IF NOT EXISTS idx_{table}_user_id ON {table}(user_id)")
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_lower_username ON users(LOWER(username))")
        c.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_lower_email ON users(LOWER(email))")
        c.execute("CREATE INDEX IF NOT EXISTS idx_ai_chat_history_user_id ON ai_chat_history(user_id, id)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_user_assets_user_id ON user_assets(user_id, kind)")

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_user_by_username(username):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT * FROM users WHERE LOWER(username)=LOWER(?)", (username,))
    row = c.fetchone(); conn.close()
    return dict(row) if row else None


def get_user_by_email(email):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT * FROM users WHERE LOWER(email)=LOWER(?)", (email,))
    row = c.fetchone(); conn.close()
    return dict(row) if row else None


def get_user_by_login(login):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT * FROM users WHERE LOWER(username)=LOWER(?) OR LOWER(email)=LOWER(?)", (login, login))
    row = c.fetchone(); conn.close()
    return dict(row) if row else None


def get_user_by_id(user_id):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT id, username, email, created_at FROM users WHERE id=?", (user_id,))
    row = c.fetchone(); conn.close()
    return dict(row) if row else None


def create_user(username, email, password):
    conn = get_db(); c = conn.cursor()
    try:
        c.execute("SELECT COUNT(*) FROM users")
        is_first_account = (c.fetchone()[0] == 0)
        now = datetime.now().isoformat(timespec='seconds')
        if IS_POSTGRES:
            c.execute("INSERT INTO users (username,email,password_hash,created_at) VALUES (?,?,?,?) RETURNING id",
                      (username, email, generate_password_hash(password), now))
            user_id = c.fetchone()[0]
        else:
            c.execute("INSERT INTO users (username,email,password_hash,created_at) VALUES (?,?,?,?)",
                      (username, email, generate_password_hash(password), now))
            c.execute("SELECT last_insert_rowid()")
            user_id = c.fetchone()[0]

        if is_first_account:
            # SECURITY: never let an arbitrary first public registrant inherit
            # legacy single-user finance records. Legacy rows stay quarantined
            # (NULL/owner 0) unless this registrant explicitly matches the
            # deployment's configured legacy owner identity.
            legacy_email = (os.environ.get("LEGACY_OWNER_EMAIL") or "").strip().lower()
            legacy_username = (os.environ.get("LEGACY_OWNER_USERNAME") or "").strip().lower()
            owner_match = bool(legacy_email and email.lower() == legacy_email)
            if owner_match and legacy_username:
                owner_match = username.lower() == legacy_username
            if owner_match:
                for table in DATA_TABLES + PAYMENT_TABLES:
                    c.execute(f"UPDATE {table} SET user_id=? WHERE user_id IS NULL", (user_id,))
                c.execute("UPDATE settings SET user_id=? WHERE user_id=0", (user_id,))

        defaults = {
            'theme': 'light', 'default_currency': 'AED', 'primary_currency': 'AED', 'secondary_currency': 'INR', 'exchange_rate': '22.60',
            'app_name': 'Rizq رزق — Growth نمو', 'shopping_budget': '0',
            'splash_video_url': '',
            'theme_image_url': '', 'theme_video_url': '', 'logo_url': ''
        }
        for k, v in defaults.items():
            c.execute("INSERT INTO settings (user_id,key,value) VALUES (?,?,?) ON CONFLICT(user_id,key) DO NOTHING", (user_id, k, v))
        conn.commit()
        return user_id
    except Exception as exc:
        conn.rollback()
        # Unique-constraint errors differ between SQLite and psycopg; callers
        # already perform duplicate checks, so treat integrity/unique failures as
        # a normal registration conflict and re-raise unexpected errors.
        name = exc.__class__.__name__.lower()
        msg = str(exc).lower()
        if 'integrity' in name or 'unique' in msg or 'duplicate' in msg:
            return None
        raise
    finally:
        conn.close()


def update_username(user_id, new_username):
    conn = get_db(); c = conn.cursor()
    try:
        c.execute("UPDATE users SET username=? WHERE id=?", (new_username, user_id))
        conn.commit(); return c.rowcount > 0
    except Exception as exc:
        conn.rollback()
        msg = str(exc).lower(); name = exc.__class__.__name__.lower()
        if 'integrity' in name or 'unique' in msg or 'duplicate' in msg:
            return False
        raise
    finally:
        conn.close()


def update_email(user_id, new_email):
    conn = get_db(); c = conn.cursor()
    try:
        c.execute("UPDATE users SET email=? WHERE id=?", (new_email, user_id))
        conn.commit(); return c.rowcount > 0
    except Exception as exc:
        conn.rollback()
        msg = str(exc).lower(); name = exc.__class__.__name__.lower()
        if 'integrity' in name or 'unique' in msg or 'duplicate' in msg:
            return False
        raise
    finally:
        conn.close()


def update_password(user_id, new_password):
    conn = get_db(); c = conn.cursor()
    c.execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(new_password), user_id))
    conn.commit(); conn.close()


def fetch_all(table, user_id, search=None, month=None, year=None):
    if table not in ALLOWED_TABLES: return []
    conn = get_db(); c = conn.cursor()
    query = f"SELECT * FROM {table} WHERE user_id = ?"
    params = [user_id]
    if search:
        columns = _columns(c, table)
        # Known text fields per table; avoid DB-specific type introspection here.
        text_map = {
            'income':['type','date','time','notes'], 'expenses':['name','category','date','time','notes'],
            'savings':['type','date','time','notes'], 'family_transfers':['receiver','date','time','notes'],
            'emi':['name','category','date','time','notes'], 'debts':['person','description','due_date','date','time','notes'],
            'notes':['title','content','date','time'], 'shopping':['product_name','category','priority','date','time','notes'],
            'emi_payments':['date','time','notes'], 'debt_payments':['date','time','notes']
        }
        search_cols = [col for col in text_map.get(table, []) if col in columns]
        if search_cols:
            query += " AND (" + " OR ".join([f"LOWER(COALESCE({col},'')) LIKE LOWER(?)" for col in search_cols]) + ")"
            params.extend([f"%{search}%"] * len(search_cols))
    if month:
        query += " AND date LIKE ?"; params.append(f"{month}%")
    elif year:
        query += " AND date LIKE ?"; params.append(f"{year}%")
    query += " ORDER BY date DESC, time DESC, id DESC"
    c.execute(query, params)
    rows = [dict(r) for r in c.fetchall()]; conn.close(); return rows


def fetch_one(table, record_id, user_id):
    if table not in ALLOWED_TABLES: return None
    conn = get_db(); c = conn.cursor()
    c.execute(f"SELECT * FROM {table} WHERE id=? AND user_id=?", (record_id, user_id))
    row = c.fetchone(); conn.close(); return dict(row) if row else None


def insert_record(table, data, user_id):
    if table not in ALLOWED_TABLES: raise ValueError('unknown table')
    payload = dict(data); payload['user_id'] = user_id
    conn = get_db(); c = conn.cursor()
    keys = list(payload); values = [payload[k] for k in keys]
    placeholders = ', '.join(['?'] * len(keys))
    if IS_POSTGRES:
        c.execute(f"INSERT INTO {table} ({', '.join(keys)}) VALUES ({placeholders}) RETURNING id", values)
        new_id = c.fetchone()[0]
    else:
        c.execute(f"INSERT INTO {table} ({', '.join(keys)}) VALUES ({placeholders})", values)
        c.execute("SELECT last_insert_rowid()")
        new_id = c.fetchone()[0]
    conn.commit(); conn.close(); return new_id


def update_record(table, record_id, data, user_id):
    if table not in ALLOWED_TABLES: return False
    safe = {k:v for k,v in data.items() if k != 'user_id'}
    if not safe: return False
    conn = get_db(); c = conn.cursor()
    updates = ", ".join([f"{k}=?" for k in safe])
    c.execute(f"UPDATE {table} SET {updates} WHERE id=? AND user_id=?", list(safe.values())+[record_id,user_id])
    conn.commit(); ok = c.rowcount > 0; conn.close(); return ok


def delete_record(table, record_id, user_id):
    if table not in ALLOWED_TABLES: return False
    conn = get_db(); c = conn.cursor()
    try:
        # Keep payment ledgers consistent when their parent EMI/debt is deleted.
        # Scope every delete by user_id to preserve multi-user isolation.
        if table == 'emi':
            c.execute("DELETE FROM emi_payments WHERE emi_id=? AND user_id=?", (record_id, user_id))
        elif table == 'debts':
            c.execute("DELETE FROM debt_payments WHERE debt_id=? AND user_id=?", (record_id, user_id))
        c.execute(f"DELETE FROM {table} WHERE id=? AND user_id=?", (record_id,user_id))
        ok = c.rowcount > 0
        conn.commit()
        return ok
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def search_global(term, user_id):
    conn=get_db(); c=conn.cursor(); results=[]
    tables={
        'income':['type','notes'], 'expenses':['name','category','notes'],
        'savings':['type','notes'], 'family_transfers':['receiver','notes'],
        'emi':['name','category','notes'], 'debts':['person','description','notes'],
        'notes':['title','content'], 'shopping':['product_name','category','priority','notes']}
    for table, cols in tables.items():
        cond=" OR ".join([f"LOWER(COALESCE({col},'')) LIKE LOWER(?)" for col in cols])
        params=[user_id]+[f"%{term}%"]*len(cols)
        c.execute(f"SELECT * FROM {table} WHERE user_id=? AND ({cond}) ORDER BY date DESC LIMIT 10", params)
        for row in c.fetchall():
            d=dict(row); d['module']=table; results.append(d)
    conn.close(); return results


def get_ai_chat_history(user_id, limit=20):
    """Return recent AI turns oldest-first, scoped to one authenticated user."""
    try:
        limit = max(1, min(int(limit), 40))
    except Exception:
        limit = 20
    conn = get_db(); c = conn.cursor()
    # LIMIT is an integer generated above, never user-provided SQL text.
    c.execute(f"SELECT id, role, content, mode, created_at FROM ai_chat_history WHERE user_id=? ORDER BY id DESC LIMIT {limit}", (user_id,))
    rows = [dict(r) for r in c.fetchall()]
    conn.close()
    rows.reverse()
    return rows


def add_ai_chat_message(user_id, role, content, mode='chat'):
    role = role if role in ('user', 'assistant') else 'user'
    mode = mode if mode in ('chat', 'voice', 'call') else 'chat'
    text = str(content or '').strip()
    if not text:
        return None
    # Avoid unbounded DB growth / prompt injection by huge accidental transcripts.
    text = text[:12000]
    conn = get_db(); c = conn.cursor()
    if IS_POSTGRES:
        c.execute("INSERT INTO ai_chat_history (user_id,role,content,mode) VALUES (?,?,?,?) RETURNING id", (user_id, role, text, mode))
        new_id = c.fetchone()[0]
    else:
        c.execute("INSERT INTO ai_chat_history (user_id,role,content,mode) VALUES (?,?,?,?)", (user_id, role, text, mode))
        c.execute("SELECT last_insert_rowid()")
        new_id = c.fetchone()[0]
    # Keep only the most recent 80 messages per user.
    c.execute("DELETE FROM ai_chat_history WHERE user_id=? AND id NOT IN (SELECT id FROM ai_chat_history WHERE user_id=? ORDER BY id DESC LIMIT 80)", (user_id, user_id))
    conn.commit(); conn.close()
    return new_id


def clear_ai_chat_history(user_id):
    conn = get_db(); c = conn.cursor()
    c.execute("DELETE FROM ai_chat_history WHERE user_id=?", (user_id,))
    count = c.rowcount
    conn.commit(); conn.close()
    return count


def get_dashboard_data(user_id):
    conn=get_db(); c=conn.cursor()
    def scalar(sql, params=()):
        c.execute(sql, params); row=c.fetchone(); return row[0] if row else 0
    uid=(user_id,)
    total_income=scalar("SELECT COALESCE(SUM(amount),0) FROM income WHERE user_id=?",uid)
    total_expenses=scalar("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=?",uid)
    total_savings=scalar("SELECT COALESCE(SUM(amount),0) FROM savings WHERE user_id=?",uid)
    savings_goal=scalar("SELECT COALESCE(SUM(goal),0) FROM savings WHERE user_id=?",uid)
    total_family=scalar("SELECT COALESCE(SUM(amount),0) FROM family_transfers WHERE user_id=?",uid)
    total_emi=scalar("SELECT COALESCE(SUM(amount),0) FROM emi WHERE user_id=?",uid)
    emi_paid=scalar("SELECT COALESCE(SUM(paid),0) FROM emi WHERE user_id=?",uid)
    emi_pending=scalar("SELECT COALESCE(SUM(CASE WHEN COALESCE(amount,0)-COALESCE(paid,0)>0 THEN COALESCE(amount,0)-COALESCE(paid,0) ELSE 0 END),0) FROM emi WHERE user_id=?",uid)
    active_emi_count=scalar("SELECT COUNT(*) FROM emi WHERE user_id=? AND COALESCE(amount,0)-COALESCE(paid,0)>0",uid)
    total_debt=scalar("SELECT COALESCE(SUM(total_amount),0) FROM debts WHERE user_id=?",uid)
    debt_paid=scalar("SELECT COALESCE(SUM(paid_amount),0) FROM debts WHERE user_id=?",uid)
    total_shopping=scalar("SELECT COALESCE(SUM(total),0) FROM shopping WHERE user_id=?",uid)
    outstanding_debt=max(0,total_debt-debt_paid)
    net_balance=total_income-total_expenses-total_family-emi_paid
    now=datetime.now(); this_month=now.strftime('%Y-%m')
    monthly_income=scalar("SELECT COALESCE(SUM(amount),0) FROM income WHERE user_id=? AND date LIKE ?",(user_id,f"{this_month}%"))
    monthly_expense=scalar("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=? AND date LIKE ?",(user_id,f"{this_month}%"))
    months=[]; income_series=[]; expense_series=[]
    for i in range(5,-1,-1):
        year=now.year; month=now.month-i
        while month<=0: month+=12; year-=1
        m=f"{year}-{month:02d}"; months.append(m)
        income_series.append(scalar("SELECT COALESCE(SUM(amount),0) FROM income WHERE user_id=? AND date LIKE ?",(user_id,f"{m}%")))
        expense_series.append(scalar("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=? AND date LIKE ?",(user_id,f"{m}%")))
    c.execute("SELECT category,COALESCE(SUM(amount),0) cat_total FROM expenses WHERE user_id=? GROUP BY category ORDER BY cat_total DESC",(user_id,))
    cat_rows=c.fetchall(); categories=[r['category'] for r in cat_rows]; category_totals=[r['cat_total'] for r in cat_rows]
    running=0; savings_series=[]
    for m in months:
        running += scalar("SELECT COALESCE(SUM(amount),0) FROM savings WHERE user_id=? AND date LIKE ?",(user_id,f"{m}%")); savings_series.append(running)
    conn.close()
    return {'total_income':total_income,'total_expenses':total_expenses,'total_savings':total_savings,
        'savings_goal':savings_goal,'total_family_transfer':total_family,'total_emi':total_emi,
        'emi_paid':emi_paid,'emi_pending':emi_pending,'active_emi_count':active_emi_count,
        'total_debt':total_debt,'debt_paid':debt_paid,'outstanding_debt':outstanding_debt,
        'total_shopping':total_shopping,'net_balance':net_balance,
        'monthly_income':monthly_income,'monthly_expense':monthly_expense,'monthly_savings':monthly_income-monthly_expense,
        'chart_months':months,'chart_income':income_series,'chart_expense':expense_series,
        'chart_savings_growth':savings_series,'chart_categories':categories,'chart_category_totals':category_totals}


def get_or_create_system_secret(key="flask_secret_key"):
    """Return a stable application secret stored in the persistent database.

    This is used only when an explicit SECRET_KEY/AZRET_SECRET_KEY environment
    variable is absent. On Render + Neon it prevents deploy failures while still
    keeping Flask sessions stable across restarts/redeploys.
    """
    conn = get_db(); c = conn.cursor()
    try:
        c.execute("SELECT value FROM system_config WHERE key=?", (key,))
        row = c.fetchone()
        if row and row['value']:
            return row['value']

        candidate = secrets.token_urlsafe(64)
        c.execute(
            "INSERT INTO system_config (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) "
            "ON CONFLICT(key) DO NOTHING",
            (key, candidate)
        )
        conn.commit()
        c.execute("SELECT value FROM system_config WHERE key=?", (key,))
        row = c.fetchone()
        if not row or not row['value']:
            raise RuntimeError("Unable to initialize persistent application secret")
        return row['value']
    finally:
        conn.close()


def get_settings(user_id):
    conn=get_db(); c=conn.cursor(); c.execute("SELECT key,value FROM settings WHERE user_id=?",(user_id,))
    rows=c.fetchall(); conn.close(); return {r['key']:r['value'] for r in rows}


def get_public_branding():
    # Public login branding must not depend on the first registered user's
    # personal settings. This prevents accidental cross-user branding leakage.
    return {'app_name': 'Rizq رزق — Growth نمو'}


def save_user_asset(user_id, kind, mime_type, data):
    if kind not in {'logo', 'splash_video', 'theme_image', 'theme_video'}:
        raise ValueError('unsupported asset kind')
    if not isinstance(data, (bytes, bytearray)) or not data:
        raise ValueError('asset is empty')
    conn = get_db(); c = conn.cursor()
    c.execute(
        "INSERT INTO user_assets (user_id,kind,mime_type,data,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP) "
        "ON CONFLICT(user_id,kind) DO UPDATE SET mime_type=excluded.mime_type,data=excluded.data,updated_at=CURRENT_TIMESTAMP",
        (user_id, kind, mime_type, bytes(data))
    )
    conn.commit(); conn.close()


def get_user_asset(user_id, kind):
    conn = get_db(); c = conn.cursor()
    c.execute("SELECT mime_type,data,updated_at FROM user_assets WHERE user_id=? AND kind=?", (user_id, kind))
    row = c.fetchone(); conn.close()
    return dict(row) if row else None


def delete_user_asset(user_id, kind):
    conn = get_db(); c = conn.cursor()
    c.execute("DELETE FROM user_assets WHERE user_id=? AND kind=?", (user_id, kind))
    deleted = c.rowcount
    conn.commit(); conn.close()
    return deleted


def save_settings(data, user_id):
    conn=get_db(); c=conn.cursor()
    for k,v in data.items():
        c.execute("INSERT INTO settings (user_id,key,value) VALUES (?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value",(user_id,k,str(v)))
    conn.commit(); conn.close()


def clear_all_data(user_id):
    conn=get_db(); c=conn.cursor()
    for t in PAYMENT_TABLES + DATA_TABLES:
        c.execute(f"DELETE FROM {t} WHERE user_id=?",(user_id,))
    conn.commit(); conn.close()

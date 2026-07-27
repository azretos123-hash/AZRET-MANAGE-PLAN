import sqlite3
import os
import json
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime

DB_NAME = "database.db"

def get_db():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # Table creation
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS income (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            amount REAL NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS savings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            amount REAL NOT NULL,
            goal REAL DEFAULT 0,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS family_transfers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            amount REAL NOT NULL,
            receiver TEXT NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS emi (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            amount REAL NOT NULL,
            paid REAL DEFAULT 0,
            monthly_payment REAL DEFAULT 0,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS debts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            person TEXT NOT NULL,
            description TEXT,
            total_amount REAL NOT NULL,
            paid_amount REAL DEFAULT 0,
            monthly_payment REAL DEFAULT 0,
            due_date TEXT,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS shopping (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_name TEXT NOT NULL,
            category TEXT NOT NULL,
            quantity REAL NOT NULL DEFAULT 1,
            price REAL NOT NULL DEFAULT 0,
            total REAL NOT NULL DEFAULT 0,
            priority TEXT DEFAULT 'Medium',
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS emi_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            emi_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (emi_id) REFERENCES emi (id) ON DELETE CASCADE
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS debt_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            debt_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (debt_id) REFERENCES debts (id) ON DELETE CASCADE
        )
    ''')

    cursor.execute('''
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')

    # Ensure migrations if columns exist
    try:
        cursor.execute("ALTER TABLE users ADD COLUMN username TEXT UNIQUE NOT NULL DEFAULT 'Ijas'")
    except sqlite3.OperationalError:
        pass

    try:
        cursor.execute("ALTER TABLE emi ADD COLUMN monthly_payment REAL DEFAULT 0")
    except sqlite3.OperationalError:
        pass

    try:
        cursor.execute("ALTER TABLE debts ADD COLUMN monthly_payment REAL DEFAULT 0")
    except sqlite3.OperationalError:
        pass

    # Create default user if none exists
    cursor.execute("SELECT COUNT(*) FROM users")
    if cursor.fetchone()[0] == 0:
        hashed_password = generate_password_hash('azret123')
        cursor.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", ('Ijas', hashed_password))
    else:
        cursor.execute("UPDATE users SET username = 'Ijas' WHERE username IS NULL OR username = ''")

    # Seed default settings
    default_settings = {
        'theme': 'light',
        'default_currency': 'AED',
        'exchange_rate': '22.60',
        'app_name': 'AZRET MANAGE PLAN',
        'shopping_budget': '0',
        'splash_video_url': '/static/video/enter_video_logo.mp4',
        'theme_image_url': '',
        'theme_video_url': ''
    }

    for key, value in default_settings.items():
        cursor.execute("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", (key, value))

    conn.commit()
    conn.close()

def get_user_by_username(username):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE LOWER(username) = LOWER(?)", (username,))
    user = cursor.fetchone()
    conn.close()
    return user

def create_user(username, password):
    conn = get_db()
    cursor = conn.cursor()
    hashed = generate_password_hash(password)
    try:
        cursor.execute("INSERT INTO users (username, password_hash) VALUES (?, ?)", (username, hashed))
        conn.commit()
        success = True
    except sqlite3.IntegrityError:
        success = False
    conn.close()
    return success

def update_username(current_username, new_username):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE users SET username = ? WHERE LOWER(username) = LOWER(?)", (new_username, current_username))
        conn.commit()
        success = cursor.rowcount > 0
    except sqlite3.IntegrityError:
        success = False
    conn.close()
    return success

def update_password(username, new_password):
    conn = get_db()
    cursor = conn.cursor()
    hashed = generate_password_hash(new_password)
    cursor.execute("UPDATE users SET password_hash = ? WHERE LOWER(username) = LOWER(?)", (hashed, username))
    conn.commit()
    conn.close()

def fetch_all(table, search=None, month=None, year=None):
    conn = get_db()
    cursor = conn.cursor()
    
    query = f"SELECT * FROM {table} WHERE 1=1"
    params = []

    if search:
        # Get table column names
        cursor.execute(f"PRAGMA table_info({table})")
        columns = [row['name'] for row in cursor.fetchall() if row['type'] in ('TEXT', 'VARCHAR')]
        if columns:
            search_conditions = [f"{col} LIKE ?" for col in columns]
            query += f" AND ({' OR '.join(search_conditions)})"
            params.extend([f"%{search}%"] * len(columns))

    if month:
        query += " AND date LIKE ?"
        params.append(f"{month}%")
    elif year:
        query += " AND date LIKE ?"
        params.append(f"{year}%")

    query += " ORDER BY date DESC, time DESC, id DESC"
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def fetch_one(table, record_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM {table} WHERE id = ?", (record_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def insert_record(table, data):
    conn = get_db()
    cursor = conn.cursor()
    
    keys = list(data.keys())
    values = list(data.values())
    placeholders = ", ".join(["?"] * len(keys))
    columns = ", ".join(keys)

    query = f"INSERT INTO {table} ({columns}) VALUES ({placeholders})"
    cursor.execute(query, values)
    conn.commit()
    new_id = cursor.lastrowid
    conn.close()
    return new_id

def update_record(table, record_id, data):
    conn = get_db()
    cursor = conn.cursor()
    
    updates = ", ".join([f"{k} = ?" for k in data.keys()])
    values = list(data.values())
    values.append(record_id)

    query = f"UPDATE {table} SET {updates} WHERE id = ?"
    cursor.execute(query, values)
    conn.commit()
    conn.close()

def delete_record(table, record_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(f"DELETE FROM {table} WHERE id = ?", (record_id,))
    conn.commit()
    conn.close()

def search_global(term):
    conn = get_db()
    cursor = conn.cursor()
    results = []

    tables = {
        'income': ['type', 'notes'],
        'expenses': ['name', 'category', 'notes'],
        'savings': ['type', 'notes'],
        'family_transfers': ['receiver', 'notes'],
        'emi': ['name', 'category', 'notes'],
        'debts': ['person', 'description', 'notes'],
        'notes': ['title', 'content'],
        'shopping': ['product_name', 'category', 'priority', 'notes']
    }

    for table, cols in tables.items():
        conditions = [f"{col} LIKE ?" for col in cols]
        query = f"SELECT * FROM {table} WHERE {' OR '.join(conditions)} ORDER BY date DESC LIMIT 10"
        params = [f"%{term}%"] * len(cols)
        cursor.execute(query, params)
        rows = cursor.fetchall()
        for r in rows:
            row_dict = dict(r)
            row_dict['module'] = table
            results.append(row_dict)

    conn.close()
    return results

def get_dashboard_data():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM income")
    total_income = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM expenses")
    total_expenses = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM savings")
    total_savings = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(goal), 0) FROM savings")
    savings_goal = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM family_transfers")
    total_family = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM emi")
    total_emi = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(paid), 0) FROM emi")
    emi_paid = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(CASE WHEN COALESCE(amount, 0) - COALESCE(paid, 0) > 0 THEN COALESCE(amount, 0) - COALESCE(paid, 0) ELSE 0 END), 0) FROM emi")
    emi_pending = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM emi WHERE COALESCE(amount, 0) - COALESCE(paid, 0) > 0")
    active_emi_count = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(total_amount), 0) FROM debts")
    total_debt = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(paid_amount), 0) FROM debts")
    debt_paid = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(total), 0) FROM shopping")
    total_shopping = cursor.fetchone()[0]

    outstanding_debt = max(0, total_debt - debt_paid)
    net_balance = total_income - total_expenses - total_family - emi_paid

    now = datetime.now()
    this_month = now.strftime('%Y-%m')

    cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM income WHERE date LIKE ?", (f"{this_month}%",))
    monthly_income = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE date LIKE ?", (f"{this_month}%",))
    monthly_expense = cursor.fetchone()[0]

    monthly_savings = monthly_income - monthly_expense

    # Chart data: Last 6 months
    months = []
    income_series = []
    expense_series = []

    for i in range(5, -1, -1):
        month_dt = datetime(now.year, now.month, 1)
        # Shift months
        year = month_dt.year
        month = month_dt.month - i
        while month <= 0:
            month += 12
            year -= 1
        m_str = f"{year}-{month:02d}"
        months.append(m_str)

        cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM income WHERE date LIKE ?", (f"{m_str}%",))
        inc = cursor.fetchone()[0]

        cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE date LIKE ?", (f"{m_str}%",))
        exp = cursor.fetchone()[0]

        income_series.append(inc)
        expense_series.append(exp)

    # Category totals for expenses
    cursor.execute("SELECT category, COALESCE(SUM(amount), 0) as cat_total FROM expenses GROUP BY category ORDER BY cat_total DESC")
    cat_rows = cursor.fetchall()
    categories = [r['category'] for r in cat_rows]
    category_totals = [r['cat_total'] for r in cat_rows]

    # Savings growth
    savings_series = []
    running_savings = 0
    for m_str in months:
        cursor.execute("SELECT COALESCE(SUM(amount), 0) FROM savings WHERE date LIKE ?", (f"{m_str}%",))
        s_inc = cursor.fetchone()[0]
        running_savings += s_inc
        savings_series.append(running_savings)

    conn.close()

    return {
        'total_income': total_income,
        'total_expenses': total_expenses,
        'total_savings': total_savings,
        'savings_goal': savings_goal,
        'total_family_transfer': total_family,
        'total_emi': total_emi,
        'emi_paid': emi_paid,
        'emi_pending': emi_pending,
        'active_emi_count': active_emi_count,
        'outstanding_debt': outstanding_debt,
        'total_shopping': total_shopping,
        'net_balance': net_balance,
        'monthly_income': monthly_income,
        'monthly_expense': monthly_expense,
        'monthly_savings': monthly_savings,
        'chart_months': months,
        'chart_income': income_series,
        'chart_expense': expense_series,
        'chart_savings_growth': savings_series,
        'chart_categories': categories,
        'chart_category_totals': category_totals
    }

def get_settings():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM settings")
    rows = cursor.fetchall()
    conn.close()
    return {row['key']: row['value'] for row in rows}

def save_settings(data):
    conn = get_db()
    cursor = conn.cursor()
    for k, v in data.items():
        cursor.execute("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (k, str(v)))
    conn.commit()
    conn.close()

def clear_all_data():
    conn = get_db()
    cursor = conn.cursor()
    tables = ['income', 'expenses', 'savings', 'family_transfers', 'emi', 'debts', 'notes', 'shopping', 'emi_payments', 'debt_payments']
    for t in tables:
        cursor.execute(f"DELETE FROM {t}")
    conn.commit()
    conn.close()

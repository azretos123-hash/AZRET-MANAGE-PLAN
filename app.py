import os
import sys
import json
import re
import io
import time
import math
import mimetypes
import threading
import secrets
import hmac
import hashlib
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta
from flask import Flask, render_template, request, jsonify, redirect, url_for, session, send_file, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename
import requests
from fpdf import FPDF
import database as db

app = Flask(__name__)
# Render terminates HTTPS at its proxy. ProxyFix lets Flask correctly understand
# the original scheme/host while still serving behind Gunicorn.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

# Initialize the database before resolving the Flask session secret. In production
# the Neon/PostgreSQL database is persistent, so it can safely hold a generated
# fallback secret when Render's SECRET_KEY environment variable was not added.
db.init_db()
_secret = os.environ.get("SECRET_KEY") or os.environ.get("AZRET_SECRET_KEY")
if not _secret and db.IS_POSTGRES:
    _secret = db.get_or_create_system_secret()
app.secret_key = _secret or "local-development-only-change-me"
app.config["SESSION_PERMANENT"] = True
app.config["PERMANENT_SESSION_LIFETIME"] = 30 * 24 * 60 * 60
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = bool(os.environ.get("RENDER") or os.environ.get("RENDER_SERVICE_ID")) or os.environ.get("SESSION_COOKIE_SECURE", "0") == "1"
app.config["MAX_CONTENT_LENGTH"] = 25 * 1024 * 1024


def _get_csrf_token():
    token = session.get('_csrf_token')
    if not token:
        token = secrets.token_urlsafe(32)
        session['_csrf_token'] = token
    return token

@app.before_request
def csrf_protect_api_writes():
    """Require a per-session CSRF token for every state-changing API request.

    SameSite=Lax already blocks most cross-site cookie submission, but an
    explicit token also protects against same-site/subdomain CSRF and future
    browser-policy changes. The token is injected into the app/login pages and
    sent in X-CSRF-Token by the frontend.
    """
    if request.path.startswith('/api/') and request.method in {'POST', 'PUT', 'PATCH', 'DELETE'}:
        expected = _get_csrf_token()
        supplied = request.headers.get('X-CSRF-Token', '')
        if not supplied or not hmac.compare_digest(str(supplied), str(expected)):
            return jsonify({'success': False, 'error': 'Invalid or missing CSRF token'}), 403


UPLOAD_FOLDER = os.path.join('static', 'uploads')
VIDEO_UPLOAD_FOLDER = os.path.join(UPLOAD_FOLDER, 'video')
THEME_UPLOAD_FOLDER = os.path.join(UPLOAD_FOLDER, 'theme')
THEME_VIDEO_UPLOAD_FOLDER = os.path.join(UPLOAD_FOLDER, 'theme_video')

for folder in [UPLOAD_FOLDER, VIDEO_UPLOAD_FOLDER, THEME_UPLOAD_FOLDER, THEME_VIDEO_UPLOAD_FOLDER]:
    os.makedirs(folder, exist_ok=True)

ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico'}
ALLOWED_VIDEO_EXTENSIONS = {'mp4', 'webm', 'ogg', 'mov', 'm4v'}

def allowed_file(filename, allowed_set):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_set

ASSET_LIMITS = {
    'logo': 2 * 1024 * 1024,
    'theme_image': 5 * 1024 * 1024,
    'splash_video': 15 * 1024 * 1024,
    'theme_video': 15 * 1024 * 1024,
}

# Lightweight abuse protection for a public deployment. This is intentionally
# in-process because Render is configured for one Gunicorn worker. If the app is
# later scaled to multiple workers/instances, replace this with a shared limiter.
_rate_lock = threading.Lock()
_rate_buckets = defaultdict(deque)

def _rate_limit(bucket, key, limit, window_seconds):
    now = time.time()
    token = (bucket, str(key or 'unknown'))
    with _rate_lock:
        q = _rate_buckets[token]
        cutoff = now - window_seconds
        while q and q[0] <= cutoff:
            q.popleft()
        if len(q) >= limit:
            retry_after = max(1, int(window_seconds - (now - q[0])))
            return retry_after
        q.append(now)
    return 0

def _client_ip():
    return request.remote_addr or 'unknown'

def _asset_mime(filename):
    ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''
    mapping = {
        'png':'image/png','jpg':'image/jpeg','jpeg':'image/jpeg','gif':'image/gif',
        'webp':'image/webp','ico':'image/x-icon','mp4':'video/mp4','webm':'video/webm',
        'ogg':'video/ogg','mov':'video/quicktime','m4v':'video/x-m4v'
    }
    return mapping.get(ext, 'application/octet-stream')

def _save_asset_upload(file, kind, allowed_extensions):
    if not file or not file.filename or not allowed_file(file.filename, allowed_extensions):
        return None, ('Invalid file type', 400)
    raw = file.read(ASSET_LIMITS[kind] + 1)
    if len(raw) > ASSET_LIMITS[kind]:
        return None, (f'File is too large for {kind.replace("_", " ")}', 413)
    if not raw:
        return None, ('File is empty', 400)
    mime = _asset_mime(file.filename)
    db.save_user_asset(session['user_id'], kind, mime, raw)
    url = f"/api/assets/{kind}?v={int(time.time())}"
    return url, None

def login_required(f):
    def wrapper(*args, **kwargs):
        if not session.get('user_id'):
            if request.path.startswith('/api/'):
                return jsonify({'error': 'unauthorized'}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    wrapper.__name__ = f.__name__
    return wrapper

@app.after_request
def add_security_headers(response):
    response.headers.setdefault('X-Content-Type-Options', 'nosniff')
    response.headers.setdefault('X-Frame-Options', 'SAMEORIGIN')
    response.headers.setdefault('Referrer-Policy', 'strict-origin-when-cross-origin')
    response.headers.setdefault('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()')
    # Never let browsers/shared proxies cache authenticated finance/API responses.
    # Static assets and the manifest retain their normal cache policy.
    if request.path.startswith('/api/') or request.path in {'/', '/login', '/splash'}:
        response.headers['Cache-Control'] = 'no-store, private, max-age=0'
        response.headers['Pragma'] = 'no-cache'
    if app.config.get('SESSION_COOKIE_SECURE'):
        response.headers.setdefault('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    return response




@app.route('/manifest.json')
def manifest_file():
    response = send_from_directory('static', 'manifest.json', mimetype='application/manifest+json')
    response.headers['Cache-Control'] = 'public, max-age=3600'
    return response


@app.route('/service-worker.js')
def service_worker_file():
    response = send_from_directory('static', 'service-worker.js', mimetype='application/javascript')
    # Service workers must be revalidated so deployments pick up fixes quickly.
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Service-Worker-Allowed'] = '/'
    return response

@app.route('/health')
def health():
    # Lightweight DB check used by Render health checks.
    try:
        conn = db.get_db()
        cur = conn.cursor()
        cur.execute('SELECT 1')
        cur.fetchone()
        conn.close()
        info = db.storage_backend_info()
        return jsonify({'status': 'ok', **info}), 200
    except Exception as exc:
        app.logger.error("Database health check failed: %s", exc)
        return jsonify({'status': 'database_unavailable'}), 503


@app.route('/')
def index():
    if session.get('user_id'):
        return render_template('index.html', start_splash=False, csrf_token=_get_csrf_token())
    return render_template('login.html', csrf_token=_get_csrf_token())

@app.route('/splash')
@login_required
def splash():
    return render_template('index.html', start_splash=True, csrf_token=_get_csrf_token())

@app.route('/login')
def login():
    if session.get('user_id'):
        return redirect(url_for('index'))
    return render_template('login.html', csrf_token=_get_csrf_token())

@app.route('/api/register', methods=['POST'])
def api_register():
    retry_after = _rate_limit('register', _client_ip(), 5, 600)
    if retry_after:
        return jsonify({'success': False, 'error': 'Too many registration attempts. Please try again later.'}), 429, {'Retry-After': str(retry_after)}
    data = request.get_json() or {}
    username = str(data.get('username', '')).strip()
    email = str(data.get('email', '')).strip().lower()
    password = str(data.get('password', ''))
    confirm_password = str(data.get('confirm_password', ''))

    if not (3 <= len(username) <= 40):
        return jsonify({'success': False, 'error': 'Username must be 3 to 40 characters'}), 400
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", username):
        return jsonify({'success': False, 'error': 'Username can contain letters, numbers, dot, dash and underscore only'}), 400
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        return jsonify({'success': False, 'error': 'Enter a valid email address'}), 400
    if len(email) > 254:
        return jsonify({'success': False, 'error': 'Email address is too long'}), 400
    if len(password) < 8:
        return jsonify({'success': False, 'error': 'Password must be at least 8 characters'}), 400
    if len(password) > 256:
        return jsonify({'success': False, 'error': 'Password is too long'}), 400
    if password != confirm_password:
        return jsonify({'success': False, 'error': 'Passwords do not match'}), 400
    if db.get_user_by_username(username):
        return jsonify({'success': False, 'error': 'Username is already taken'}), 409
    if db.get_user_by_email(email):
        return jsonify({'success': False, 'error': 'Email is already registered'}), 409

    user_id = db.create_user(username, email, password)
    if not user_id:
        return jsonify({'success': False, 'error': 'Unable to create account'}), 400

    session.clear()
    session.permanent = True
    session['user_id'] = user_id
    session['username'] = username
    return jsonify({'success': True, 'redirect': url_for('splash')})


@app.route('/api/login', methods=['POST'])
def api_login():
    retry_after = _rate_limit('login', _client_ip(), 12, 60)
    if retry_after:
        return jsonify({'success': False, 'error': 'Too many login attempts. Please wait and try again.'}), 429, {'Retry-After': str(retry_after)}
    data = request.get_json() or {}
    login_value = str(data.get('username', data.get('login', ''))).strip()
    password = str(data.get('password', ''))
    if not login_value or len(login_value) > 254 or len(password) > 256:
        return jsonify({'success': False, 'error': 'Incorrect username/email or password'}), 401

    user = db.get_user_by_login(login_value)
    if user and check_password_hash(user['password_hash'], password):
        session.clear()
        session.permanent = True
        session['user_id'] = user['id']
        session['username'] = user['username']
        return jsonify({'success': True, 'redirect': url_for('splash')})

    return jsonify({'success': False, 'error': 'Incorrect username/email or password'}), 401


def _password_reset_hash(user_id, code):
    raw = f"{app.secret_key}:{int(user_id)}:{str(code)}".encode('utf-8')
    return hashlib.sha256(raw).hexdigest()


def _as_utc_datetime(value):
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value or '').strip().replace('Z', '+00:00')
        dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _send_password_reset_email(email, code):
    api_key = (os.environ.get('BREVO_API_KEY') or '').strip()
    sender_email = (os.environ.get('BREVO_SENDER_EMAIL') or '').strip()
    sender_name = (os.environ.get('BREVO_SENDER_NAME') or 'YARIN').strip() or 'YARIN'
    if not api_key or not sender_email:
        raise RuntimeError('email_service_not_configured')

    payload = {
        'sender': {'name': sender_name, 'email': sender_email},
        'to': [{'email': email}],
        'subject': 'YARIN password reset code',
        'htmlContent': f'''<!doctype html><html><body style="margin:0;background:#06101f;font-family:Arial,sans-serif;color:#eaf4ff">
        <div style="max-width:560px;margin:24px auto;padding:32px;border-radius:24px;background:#0b1b36;border:1px solid #1f6fbb">
          <div style="font-size:13px;letter-spacing:4px;color:#5ad7e0">YARIN · يارين</div>
          <h1 style="margin:14px 0 8px;font-size:26px">Reset your password</h1>
          <p style="color:#b7c7dc;line-height:1.6">Use this one-time code to continue. It expires in 10 minutes.</p>
          <div style="margin:26px 0;padding:18px;text-align:center;border-radius:16px;background:#07152b;border:1px solid #2e8cff;font-size:34px;font-weight:800;letter-spacing:10px;color:#ffffff">{code}</div>
          <p style="color:#8fa5c1;font-size:13px;line-height:1.5">If you did not request this code, you can ignore this email. Never share this code with anyone.</p>
          <div style="margin-top:20px;color:#5ad7e0;font-size:12px">Your Money. Your Future. · Tomorrow Starts Today.</div>
        </div></body></html>'''
    }
    response = requests.post(
        'https://api.brevo.com/v3/smtp/email',
        headers={'accept': 'application/json', 'api-key': api_key, 'content-type': 'application/json'},
        json=payload,
        timeout=10,
    )
    if not 200 <= response.status_code < 300:
        app.logger.error('Brevo password reset email failed with status %s', response.status_code)
        raise RuntimeError('email_send_failed')


@app.route('/api/password-reset/request', methods=['POST'])
def password_reset_request():
    retry_after = _rate_limit('password_reset_request', _client_ip(), 5, 900)
    if retry_after:
        return jsonify({'success': False, 'error': 'Too many reset requests. Please wait and try again.'}), 429, {'Retry-After': str(retry_after)}

    if not (os.environ.get('BREVO_API_KEY') or '').strip() or not (os.environ.get('BREVO_SENDER_EMAIL') or '').strip():
        return jsonify({'success': False, 'error': 'Password recovery email is not configured yet.'}), 503

    data = request.get_json() or {}
    email = str(data.get('email', '')).strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254:
        return jsonify({'success': False, 'error': 'Enter a valid email address'}), 400

    user = db.get_user_by_email(email)
    generic = {'success': True, 'message': 'If that email is registered, a 6-digit code has been sent.'}
    if not user:
        return jsonify(generic)

    code = f"{secrets.randbelow(1_000_000):06d}"
    expires = datetime.now(timezone.utc) + timedelta(minutes=10)
    db.create_password_reset_code(user['id'], _password_reset_hash(user['id'], code), expires.isoformat())
    try:
        _send_password_reset_email(email, code)
    except RuntimeError as exc:
        db.clear_password_reset_codes(user['id'])
        if str(exc) == 'email_service_not_configured':
            return jsonify({'success': False, 'error': 'Password recovery email is not configured yet.'}), 503
        return jsonify({'success': False, 'error': 'Unable to send the reset email right now. Please try again.'}), 502
    return jsonify(generic)


@app.route('/api/password-reset/verify', methods=['POST'])
def password_reset_verify():
    retry_after = _rate_limit('password_reset_verify', _client_ip(), 12, 600)
    if retry_after:
        return jsonify({'success': False, 'error': 'Too many OTP attempts. Please wait and try again.'}), 429, {'Retry-After': str(retry_after)}

    data = request.get_json() or {}
    email = str(data.get('email', '')).strip().lower()
    code = re.sub(r'\D', '', str(data.get('code', '')))
    if len(code) != 6:
        return jsonify({'success': False, 'error': 'Enter the 6-digit code'}), 400

    session.pop('password_reset_user_id', None)
    session.pop('password_reset_verified_at', None)
    user = db.get_user_by_email(email)
    if not user:
        return jsonify({'success': False, 'error': 'Invalid or expired code'}), 400
    reset = db.get_latest_password_reset_code(user['id'])
    if not reset or int(reset.get('attempts') or 0) >= 5:
        return jsonify({'success': False, 'error': 'Invalid or expired code'}), 400
    try:
        expired = _as_utc_datetime(reset.get('expires_at')) <= datetime.now(timezone.utc)
    except Exception:
        expired = True
    if expired:
        db.consume_password_reset_code(reset['id'])
        return jsonify({'success': False, 'error': 'This code has expired. Request a new code.'}), 400

    supplied_hash = _password_reset_hash(user['id'], code)
    if not hmac.compare_digest(str(reset.get('code_hash') or ''), supplied_hash):
        db.increment_password_reset_attempts(reset['id'])
        return jsonify({'success': False, 'error': 'Invalid or expired code'}), 400

    db.consume_password_reset_code(reset['id'])
    session['password_reset_user_id'] = user['id']
    session['password_reset_verified_at'] = int(time.time())
    return jsonify({'success': True, 'message': 'Code verified. You can now choose a new password.'})


@app.route('/api/password-reset/complete', methods=['POST'])
def password_reset_complete():
    retry_after = _rate_limit('password_reset_complete', _client_ip(), 8, 600)
    if retry_after:
        return jsonify({'success': False, 'error': 'Too many attempts. Please wait and try again.'}), 429, {'Retry-After': str(retry_after)}

    user_id = session.get('password_reset_user_id')
    verified_at = int(session.get('password_reset_verified_at') or 0)
    if not user_id or not verified_at or time.time() - verified_at > 600:
        session.pop('password_reset_user_id', None)
        session.pop('password_reset_verified_at', None)
        return jsonify({'success': False, 'error': 'Reset verification expired. Request a new code.'}), 403

    data = request.get_json() or {}
    password = str(data.get('password', ''))
    confirm = str(data.get('confirm_password', ''))
    if len(password) < 8:
        return jsonify({'success': False, 'error': 'New password must be at least 8 characters'}), 400
    if len(password) > 256:
        return jsonify({'success': False, 'error': 'New password is too long'}), 400
    if password != confirm:
        return jsonify({'success': False, 'error': 'Passwords do not match'}), 400

    db.update_password(user_id, password)
    db.clear_password_reset_codes(user_id)
    session.pop('password_reset_user_id', None)
    session.pop('password_reset_verified_at', None)
    return jsonify({'success': True, 'message': 'Password changed successfully. You can sign in now.'})


@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'success': True})


@app.route('/api/profile', methods=['GET'])
@login_required
def get_profile():
    user = db.get_user_by_id(session['user_id'])
    if not user:
        session.clear()
        return jsonify({'error': 'unauthorized'}), 401
    return jsonify({'user_id': user['id'], 'username': user['username'], 'email': user.get('email', '')})


@app.route('/api/update-username', methods=['POST'])
@login_required
def update_username():
    data = request.get_json() or {}
    new_username = str(data.get('username', '')).strip()
    if not (3 <= len(new_username) <= 40):
        return jsonify({'success': False, 'error': 'Username must be 3 to 40 characters'}), 400
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", new_username):
        return jsonify({'success': False, 'error': 'Username contains unsupported characters'}), 400
    success = db.update_username(session['user_id'], new_username)
    if success:
        session['username'] = new_username
        return jsonify({'success': True, 'username': new_username})
    return jsonify({'success': False, 'error': 'Username already taken or invalid'}), 400


@app.route('/api/update-email', methods=['POST'])
@login_required
def update_email():
    data = request.get_json() or {}
    email = str(data.get('email', '')).strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        return jsonify({'success': False, 'error': 'Enter a valid email address'}), 400
    if len(email) > 254:
        return jsonify({'success': False, 'error': 'Email address is too long'}), 400
    if db.update_email(session['user_id'], email):
        return jsonify({'success': True, 'email': email})
    return jsonify({'success': False, 'error': 'Email is already registered'}), 409


@app.route('/api/change-password', methods=['POST'])
@login_required
def change_password():
    data = request.get_json() or {}
    current_password = str(data.get('current_password', ''))
    new_password = str(data.get('new_password', ''))
    user = db.get_user_by_login(session.get('username', ''))
    if not user or user['id'] != session['user_id'] or not check_password_hash(user['password_hash'], current_password):
        return jsonify({'success': False, 'error': 'Current password is incorrect'}), 400
    if len(new_password) < 8:
        return jsonify({'success': False, 'error': 'New password must be at least 8 characters'}), 400
    if len(new_password) > 256:
        return jsonify({'success': False, 'error': 'New password is too long'}), 400
    db.update_password(session['user_id'], new_password)
    return jsonify({'success': True})

# Generic CRUD endpoints
TABLE_CONFIGS = {
    'income': {
        'fields': ['type', 'amount', 'date', 'time', 'notes'],
        'required': ['type', 'amount', 'date']
    },
    'expenses': {
        'fields': ['name', 'category', 'amount', 'date', 'time', 'notes'],
        'required': ['name', 'category', 'amount', 'date']
    },
    'savings': {
        'fields': ['type', 'amount', 'goal', 'date', 'time', 'notes'],
        'required': ['type', 'amount', 'date']
    },
    'family_transfers': {
        'fields': ['amount', 'receiver', 'date', 'time', 'notes'],
        'required': ['amount', 'receiver', 'date']
    },
    'emi': {
        'fields': ['name', 'category', 'amount', 'paid', 'monthly_payment', 'date', 'time', 'notes'],
        'required': ['name', 'category', 'amount', 'date']
    },
    'debts': {
        'fields': ['person', 'description', 'total_amount', 'paid_amount', 'monthly_payment', 'due_date', 'date', 'time', 'notes'],
        'required': ['person', 'total_amount', 'date']
    },
    'notes': {
        'fields': ['title', 'content', 'date', 'time'],
        'required': ['title', 'date']
    },
    'shopping': {
        'fields': ['product_name', 'category', 'quantity', 'price', 'total', 'priority', 'date', 'time', 'notes'],
        'required': ['product_name', 'category', 'quantity', 'price', 'date']
    }
}

NUMERIC_FIELDS = {'amount', 'paid', 'goal', 'total_amount', 'paid_amount', 'monthly_payment', 'quantity', 'price', 'total'}

MAX_FINANCE_VALUE = 1_000_000_000_000_000.0
TEXT_FIELD_LIMITS = {
    'type': 120, 'name': 200, 'category': 120, 'receiver': 200,
    'person': 200, 'description': 2000, 'title': 300, 'content': 12000,
    'product_name': 500, 'priority': 40, 'notes': 12000,
}

def _valid_date(value):
    if value in (None, ''):
        return True
    try:
        datetime.strptime(str(value), '%Y-%m-%d')
        return True
    except (ValueError, TypeError):
        return False

def _valid_time(value):
    if value in (None, ''):
        return True
    text = str(value)
    for fmt in ('%H:%M', '%H:%M:%S'):
        try:
            datetime.strptime(text, fmt)
            return True
        except (ValueError, TypeError):
            pass
    return False

def _validate_text_dates(payload):
    for field, limit in TEXT_FIELD_LIMITS.items():
        if field in payload and payload[field] is not None and len(str(payload[field])) > limit:
            return f"'{field}' is too long"
    for field in ('date', 'due_date'):
        if field in payload and not _valid_date(payload.get(field)):
            return f"'{field}' must be YYYY-MM-DD"
    if 'time' in payload and not _valid_time(payload.get('time')):
        return "'time' must be HH:MM or HH:MM:SS"
    return None

def get_now_date_time():
    now = datetime.now()
    return now.strftime('%Y-%m-%d'), now.strftime('%H:%M')


def _validate_record_integrity(table_name, payload, existing=None):
    """Normalize derived values and reject financially inconsistent records.

    `payload` contains already parsed values. For updates, `existing` is merged
    only for cross-field checks; ownership remains enforced separately.
    """
    combined = dict(existing or {})
    combined.update(payload)

    if table_name == 'shopping':
        qty = float(combined.get('quantity') or 0)
        price = float(combined.get('price') or 0)
        if qty <= 0:
            return "'quantity' must be greater than zero"
        # Never trust a browser-supplied total; derive it from quantity × price.
        payload['total'] = round(qty * price, 2)

    if table_name == 'emi':
        total = float(combined.get('amount') or 0)
        paid = float(combined.get('paid') or 0)
        if paid > total + 1e-9:
            return "'paid' cannot be greater than EMI amount"

    if table_name == 'debts':
        total = float(combined.get('total_amount') or 0)
        paid = float(combined.get('paid_amount') or 0)
        if paid > total + 1e-9:
            return "'paid_amount' cannot be greater than total debt"

    return None

@app.route('/api/<table_name>', methods=['GET'])
@login_required
def get_records(table_name):
    if table_name not in TABLE_CONFIGS:
        return jsonify({'error': 'unknown table'}), 404

    search = request.args.get('q', '').strip()
    month = request.args.get('month', '').strip()
    year = request.args.get('year', '').strip()

    records = db.fetch_all(table_name, session['user_id'], search=search, month=month, year=year)
    return jsonify(records)

@app.route('/api/<table_name>', methods=['POST'])
@login_required
def create_record(table_name):
    if table_name not in TABLE_CONFIGS:
        return jsonify({'error': 'unknown table'}), 404

    cfg = TABLE_CONFIGS[table_name]
    data = request.get_json() or {}

    for req in cfg['required']:
        if data.get(req) is None or str(data.get(req)).strip() == '':
            return jsonify({'error': f"'{req}' is required"}), 400

    default_date, default_time = get_now_date_time()
    data['date'] = data.get('date') or default_date
    data['time'] = data.get('time') or default_time

    insert_data = {}
    for field in cfg['fields']:
        val = data.get(field)
        if field in NUMERIC_FIELDS:
            try:
                val = float(val) if val is not None else 0.0
            except (ValueError, TypeError):
                return jsonify({'error': f"'{field}' must be a valid number"}), 400
            if not math.isfinite(val) or val < 0:
                return jsonify({'error': f"'{field}' must be zero or greater"}), 400
            if val > MAX_FINANCE_VALUE:
                return jsonify({'error': f"'{field}' is too large"}), 400
            if field == 'quantity' and val <= 0:
                return jsonify({'error': "'quantity' must be greater than zero"}), 400
        elif val is None:
            val = ''
        insert_data[field] = val

    field_error = _validate_text_dates(insert_data)
    if field_error:
        return jsonify({'error': field_error}), 400
    integrity_error = _validate_record_integrity(table_name, insert_data)
    if integrity_error:
        return jsonify({'error': integrity_error}), 400

    new_id = db.insert_record(table_name, insert_data, session['user_id'])
    new_record = db.fetch_one(table_name, new_id, session['user_id'])
    return jsonify(new_record), 201

@app.route('/api/<table_name>/<int:record_id>', methods=['PUT'])
@login_required
def update_record_route(table_name, record_id):
    if table_name not in TABLE_CONFIGS:
        return jsonify({'error': 'unknown table'}), 404

    existing = db.fetch_one(table_name, record_id, session['user_id'])
    if not existing:
        return jsonify({'error': 'not found'}), 404

    cfg = TABLE_CONFIGS[table_name]
    data = request.get_json() or {}

    update_data = {}
    for field in cfg['fields']:
        if field in data:
            val = data[field]
            if field in NUMERIC_FIELDS:
                try:
                    val = float(val) if val is not None else 0.0
                except (ValueError, TypeError):
                    return jsonify({'error': f"'{field}' must be a valid number"}), 400
                if not math.isfinite(val) or val < 0:
                    return jsonify({'error': f"'{field}' must be zero or greater"}), 400
                if val > MAX_FINANCE_VALUE:
                    return jsonify({'error': f"'{field}' is too large"}), 400
                if field == 'quantity' and val <= 0:
                    return jsonify({'error': "'quantity' must be greater than zero"}), 400
            elif val is None:
                val = ''
            update_data[field] = val

    # Required fields must remain valid after an edit as well. Frontend HTML
    # validation is not a security boundary; API clients can call this route
    # directly and previously could blank required fields on existing records.
    combined_required = dict(existing)
    combined_required.update(update_data)
    for req in cfg['required']:
        if combined_required.get(req) is None or str(combined_required.get(req)).strip() == '':
            return jsonify({'error': f"'{req}' is required"}), 400

    field_error = _validate_text_dates(update_data)
    if field_error:
        return jsonify({'error': field_error}), 400
    integrity_error = _validate_record_integrity(table_name, update_data, existing)
    if integrity_error:
        return jsonify({'error': integrity_error}), 400

    if update_data:
        db.update_record(table_name, record_id, update_data, session['user_id'])

    updated = db.fetch_one(table_name, record_id, session['user_id'])
    return jsonify(updated)

@app.route('/api/<table_name>/<int:record_id>', methods=['DELETE'])
@login_required
def delete_record_route(table_name, record_id):
    if table_name not in TABLE_CONFIGS:
        return jsonify({'error': 'unknown table'}), 404

    if not db.delete_record(table_name, record_id, session['user_id']):
        return jsonify({'error': 'not found'}), 404
    return jsonify({'success': True})

# Smart EMI / Debt tracking
SMART_TRACKING_CONFIG = {
    'emi': {
        'header_table': 'emi',
        'payments_table': 'emi_payments',
        'fk_field': 'emi_id',
        'name_field': 'name',
        'total_field': 'amount',
        'paid_field': 'paid'
    },
    'debts': {
        'header_table': 'debts',
        'payments_table': 'debt_payments',
        'fk_field': 'debt_id',
        'name_field': 'person',
        'total_field': 'total_amount',
        'paid_field': 'paid_amount'
    }
}

def format_smart_row(cfg, row):
    row_dict = dict(row)
    total = float(row_dict.get(cfg['total_field']) or 0)
    paid = float(row_dict.get(cfg['paid_field']) or 0)
    row_dict['total_amount_view'] = total
    row_dict['paid_amount_view'] = paid
    row_dict['pending_amount'] = max(0.0, round(total - paid, 2))
    return row_dict

@app.route('/api/<table_name>/suggest', methods=['GET'])
@login_required
def suggest_smart_records(table_name):
    if table_name not in SMART_TRACKING_CONFIG:
        return jsonify({'error': 'unknown table'}), 404

    cfg = SMART_TRACKING_CONFIG[table_name]
    q = request.args.get('q', '').strip()[:200]
    if not q:
        return jsonify([])

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM {cfg['header_table']} WHERE user_id = ? AND {cfg['name_field']} LIKE ? ORDER BY date DESC, time DESC, id DESC LIMIT 8", (session['user_id'], f"%{q}%"))
    rows = cursor.fetchall()
    conn.close()

    return jsonify([format_smart_row(cfg, r) for r in rows])

@app.route('/api/<table_name>/<int:record_id>/payments', methods=['GET'])
@login_required
def get_smart_payments(table_name, record_id):
    if table_name not in SMART_TRACKING_CONFIG:
        return jsonify({'error': 'unknown table'}), 404

    cfg = SMART_TRACKING_CONFIG[table_name]
    header = db.fetch_one(cfg['header_table'], record_id, session['user_id'])
    if not header:
        return jsonify({'error': 'not found'}), 404

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM {cfg['payments_table']} WHERE user_id = ? AND {cfg['fk_field']} = ? ORDER BY date DESC, time DESC, id DESC", (session['user_id'], record_id))
    payments = [dict(r) for r in cursor.fetchall()]
    conn.close()

    return jsonify({
        'record': format_smart_row(cfg, header),
        'payments': payments
    })

@app.route('/api/<table_name>/<int:record_id>/payments', methods=['POST'])
@login_required
def add_smart_payment(table_name, record_id):
    if table_name not in SMART_TRACKING_CONFIG:
        return jsonify({'error': 'unknown table'}), 404

    cfg = SMART_TRACKING_CONFIG[table_name]
    header = db.fetch_one(cfg['header_table'], record_id, session['user_id'])
    if not header:
        return jsonify({'error': 'not found'}), 404

    data = request.get_json() or {}
    try:
        amount = float(data.get('amount', 0))
    except (ValueError, TypeError):
        amount = 0.0

    if not math.isfinite(amount) or amount <= 0:
        return jsonify({'error': "'amount' must be a positive number"}), 400
    if amount > MAX_FINANCE_VALUE:
        return jsonify({'error': "'amount' is too large"}), 400

    # Prevent overpayments from pushing paid totals beyond the original balance.
    total_amount = float(header.get(cfg['total_field']) or 0)
    current_paid = float(header.get(cfg['paid_field']) or 0)
    remaining = max(0.0, total_amount - current_paid)
    if remaining <= 0:
        return jsonify({'error': 'This balance is already fully paid'}), 400
    if amount > remaining + 1e-9:
        return jsonify({'error': f'Payment exceeds remaining balance ({remaining:.2f})'}), 400

    default_date, default_time = get_now_date_time()
    payment_date = data.get('date') or default_date
    payment_time = data.get('time') or default_time
    notes = str(data.get('notes', ''))
    field_error = _validate_text_dates({'date': payment_date, 'time': payment_time, 'notes': notes})
    if field_error:
        return jsonify({'error': field_error}), 400

    conn = db.get_db()
    cursor = conn.cursor()
    try:
        # Atomically reserve the payment against the remaining balance. This
        # prevents two near-simultaneous requests from both passing the earlier
        # remaining-balance check and corrupting the ledger.
        cursor.execute(
            f"UPDATE {cfg['header_table']} SET {cfg['paid_field']} = COALESCE({cfg['paid_field']},0) + ? "
            f"WHERE id = ? AND user_id = ? AND COALESCE({cfg['paid_field']},0) + ? <= COALESCE({cfg['total_field']},0) + 0.000000001",
            (amount, record_id, session['user_id'], amount)
        )
        if cursor.rowcount <= 0:
            conn.rollback()
            conn.close()
            return jsonify({'error': 'Payment exceeds the current remaining balance. Refresh and try again.'}), 409
        cursor.execute(f"INSERT INTO {cfg['payments_table']} (user_id, {cfg['fk_field']}, amount, date, time, notes) VALUES (?, ?, ?, ?, ?, ?)",
                       (session['user_id'], record_id, amount, payment_date, payment_time, notes))
        conn.commit()
        cursor.execute(f"SELECT * FROM {cfg['payments_table']} WHERE user_id = ? AND {cfg['fk_field']} = ? ORDER BY date DESC, time DESC, id DESC", (session['user_id'], record_id))
        payments = [dict(r) for r in cursor.fetchall()]
    except Exception:
        conn.rollback()
        conn.close()
        raise
    conn.close()

    updated_header = db.fetch_one(cfg['header_table'], record_id, session['user_id'])

    return jsonify({
        'record': format_smart_row(cfg, updated_header),
        'payments': payments
    }), 201

@app.route('/api/dashboard', methods=['GET'])
@login_required
def dashboard_api():
    data = db.get_dashboard_data(session['user_id'])
    return jsonify(data)

# AI Assistant Context

def get_income_profile():
    settings = db.get_settings(session['user_id'])
    
    def fnum(key):
        try:
            value = float(settings.get(key) or 0)
            return value if math.isfinite(value) else 0.0
        except (ValueError, TypeError):
            return 0.0

    profile = {
        'saved': settings.get('income_profile_saved') == '1',
        'monthly_income': fnum('income_profile_monthly_income'),
        'other_income': fnum('income_profile_other_income'),
        'fixed_emi_commitment': fnum('income_profile_fixed_emi_commitment'),
        'fixed_debt_commitment': fnum('income_profile_fixed_debt_commitment'),
        'notes': settings.get('income_profile_notes', ''),
        'updated_at': settings.get('income_profile_updated_at', '')
    }
    profile['total_verified_income'] = round(profile['monthly_income'] + profile['other_income'], 2)
    return profile


def gather_financial_context():
    dash = db.get_dashboard_data(session['user_id'])
    income_profile = get_income_profile()
    display_currency, display_rate = _user_display_currency(session['user_id'])
    return {
        'display_currency': display_currency,
        'display_rate': display_rate,
        'total_income': dash['total_income'],
        'total_expenses': dash['total_expenses'],
        'total_savings': dash['total_savings'],
        'savings_goal': dash['savings_goal'],
        'total_family': dash['total_family_transfer'],
        'total_emi': dash['total_emi'],
        'total_emi_paid': dash['emi_paid'],
        'emi_pending': dash['emi_pending'],
        'active_emi_count': dash['active_emi_count'],
        'total_debt': dash.get('total_debt', 0),
        'debt_paid': dash.get('debt_paid', 0),
        'outstanding_debt': dash['outstanding_debt'],
        'total_shopping': dash['total_shopping'],
        'net_balance': dash['net_balance'],
        'income_profile': income_profile
    }


def local_ai_response(query, context, language_key, user_name='User'):
    """Small finance-only emergency fallback.

    This is intentionally NOT used as a replacement for Gemini general chat.
    The old version silently used this for every Gemini failure, which made the
    assistant look as if it only knew saved app data and caused repetitive
    answers. Set AI_LOCAL_FALLBACK=1 only if a finance-only fallback is wanted.
    """
    lower = query.lower()
    currency = context.get('display_currency', 'AED')
    rate = float(context.get('display_rate') or 1.0)

    if any(k in lower for k in ['emi', 'loan', 'installment']):
        return f"{user_name}, you have {context['active_emi_count']} active EMIs totaling {context['total_emi'] * rate:.2f} {currency}, with {context['emi_pending'] * rate:.2f} {currency} still pending."
    if any(k in lower for k in ['debt', 'borrow', 'loan balance', 'outstanding debt']):
        return f"{user_name}, your outstanding debt is {context['outstanding_debt'] * rate:.2f} {currency}."
    if any(k in lower for k in ['balance', 'net balance', 'cash', 'available']):
        return f"{user_name}, your current net balance is {context['net_balance'] * rate:.2f} {currency}."
    if any(k in lower for k in ['savings', 'goal', 'save more', 'save']):
        return f"{user_name}, you have {context['total_savings'] * rate:.2f} {currency} in savings and your saved goal is {context['savings_goal'] * rate:.2f} {currency}."
    if any(k in lower for k in ['salary', 'income']):
        if context['income_profile']['saved']:
            return f"{user_name}, your saved monthly income is {context['income_profile']['monthly_income'] * rate:.2f} {currency} and other income is {context['income_profile']['other_income'] * rate:.2f} {currency}."
        return f"{user_name}, I do not have a saved salary profile yet."
    return None


def _gemini_api_key():
    # google-genai accepts either variable. Supporting both avoids a common
    # Render configuration mismatch where GOOGLE_API_KEY was set but the old
    # app only checked GEMINI_API_KEY.
    return (os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY') or '').strip()


def _gemini_models_to_try():
    configured = (os.environ.get('GEMINI_MODEL') or '').strip()
    # Current stable production models first. Old 1.5 models and the shut-down
    # 2.0 alias are deliberately removed.
    candidates = ['gemini-3.5-flash-lite', configured, 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite']
    result = []
    for item in candidates:
        if item and item not in result:
            result.append(item)
    return result


def _build_ai_system_instruction(user_name, language_key, mode):
    if language_key.startswith('ml'):
        language = (
            "Reply naturally in Malayalam. You may keep unavoidable technical names in English. "
            "Do not switch to English unless the user asks."
        )
    else:
        language = "Reply naturally in English unless the user asks for another language."

    voice_rule = (
        "For voice mode, keep answers concise and natural for speech, usually 1 to 4 sentences. "
        "Do not use markdown tables or long lists."
        if mode in ('voice', 'call') else
        "For chat mode, answer at the length needed by the question. Use simple formatting only when useful."
    )

    return (
        f"You are Azret AI, the Gemini-powered assistant inside YARIN يارين for {user_name}. "
        f"{language} {voice_rule} "
        "You are a GENERAL-PURPOSE conversational assistant, not only a finance bot. "
        "Answer questions about everyday knowledge, technology, travel, writing, calculations, ideas, and other normal topics using your model knowledge. "
        "Use the supplied YARIN financial context ONLY when the user's question is actually about their money, budget, savings, EMI, debt, shopping plan, or YARIN app records. "
        "For unrelated questions, IGNORE the financial context completely. "
        "Use recent conversation history to understand follow-up questions and pronouns. "
        "Do not repeat a canned greeting or repeat the same financial summary unless it directly answers the new question. "
        "Personality: warm, friendly, lightly playful and encouraging. Small tasteful jokes or affectionate phrases are welcome in casual conversation, but never overdo them and never let humor reduce financial accuracy. "
        "For serious finance questions, give the direct accurate answer first, then optional friendly encouragement. Avoid possessive or manipulative language. "
        "Never claim that saved app data is current real-world information. If current/live external information is requested and no live search tool is available, say that limitation clearly."
    )


def _is_finance_related(query, history=None):
    # Classify primarily from the NEW turn. The old implementation searched
    # several previous user turns too, so one earlier finance question could
    # keep attaching finance context to unrelated later questions and encourage
    # repetitive answers. Only use history for short ambiguous follow-ups.
    current = str(query or '').lower().strip()
    keywords = [
        'money', 'finance', 'financial', 'budget', 'income', 'salary', 'expense', 'saving', 'savings',
        'emi', 'debt', 'loan', 'balance', 'cash', 'aed', 'inr', 'rupee', 'dirham', 'shopping', 'spend', 'payment',
        'വരുമാനം', 'ശമ്പളം', 'ചിലവ്', 'ചെലവ്', 'സേവിംഗ്', 'സമ്പാദ്യം', 'കടം', 'ഇഎംഐ', 'ഇ.എം.ഐ', 'ബാലൻസ്', 'പണം', 'ബജറ്റ്'
    ]
    if any(k in current for k in keywords):
        return True
    english_followup = bool(re.search(r'\b(?:it|that|this|those|them|more|why)\b|\bhow\s+much\b|\bwhat\s+about\b', current))
    malayalam_followup = any(m in current for m in ('അതെ', 'അത്', 'ഇത്', 'എത്ര', 'പിന്നെ'))
    if len(current) <= 45 and (english_followup or malayalam_followup):
        prev_users = [str(x.get('content') or '').lower() for x in (history or []) if x.get('role') == 'user']
        if prev_users and any(k in prev_users[-1] for k in keywords):
            return True
    return False


def _format_financial_context(context):
    if not context:
        return "YARIN FINANCIAL CONTEXT: not attached because this conversation is not about saved finance records."
    cur = context.get('display_currency', 'AED')
    rate = float(context.get('display_rate') or 1.0)
    cv = lambda x: float(x or 0) * rate
    return (
        f"YARIN PRIVATE FINANCIAL CONTEXT (display currency {cur}; use only when relevant):\n"
        f"Total Income: {cv(context['total_income']):.2f} {cur}\n"
        f"Total Expenses: {cv(context['total_expenses']):.2f} {cur}\n"
        f"Total Savings: {cv(context['total_savings']):.2f} {cur}\n"
        f"Savings Goal: {cv(context['savings_goal']):.2f} {cur}\n"
        f"Active EMIs: {context['active_emi_count']}\n"
        f"EMI Pending: {cv(context['emi_pending']):.2f} {cur}\n"
        f"Outstanding Debt: {cv(context['outstanding_debt']):.2f} {cur}\n"
        f"Net Balance: {cv(context['net_balance']):.2f} {cur}\n"
        f"Saved Monthly Salary Profile: {cv(context['income_profile']['monthly_income']):.2f} {cur}"
    )


def _format_recent_ai_history(history):
    if not history:
        return "(No previous conversation yet.)"
    lines = []
    for item in history[-16:]:
        role = 'User' if item.get('role') == 'user' else 'Assistant'
        text = str(item.get('content') or '').strip().replace('\x00', '')
        # Keep prompt size controlled while still preserving multi-turn context.
        if len(text) > 3500:
            text = text[:3500] + '…'
        lines.append(f"{role}: {text}")
    return "\n".join(lines)


@app.route('/api/ai-status', methods=['GET'])
@login_required
def ai_status():
    key = _gemini_api_key()
    return jsonify({
        'configured': bool(key),
        'key_source': 'GEMINI_API_KEY' if os.environ.get('GEMINI_API_KEY') else ('GOOGLE_API_KEY' if os.environ.get('GOOGLE_API_KEY') else None),
        'models': _gemini_models_to_try(),
        'history_count': len(db.get_ai_chat_history(session['user_id'], 40)),
        'provider': 'Google Gemini'
    })


@app.route('/api/ai-history', methods=['GET', 'DELETE'])
@login_required
def ai_history():
    if request.method == 'DELETE':
        deleted = db.clear_ai_chat_history(session['user_id'])
        return jsonify({'success': True, 'deleted': deleted})
    history = db.get_ai_chat_history(session['user_id'], 40)
    return jsonify({'history': history})


@app.route('/api/ai-assistant', methods=['POST'])
@login_required
def ai_assistant():
    retry_after = _rate_limit('ai', session.get('user_id'), 40, 60)
    if retry_after:
        return jsonify({'error': 'AI request limit reached. Please wait a moment and try again.', 'code': 'AI_RATE_LIMIT'}), 429, {'Retry-After': str(retry_after)}
    data = request.get_json(silent=True) or {}
    query = (data.get('query') or data.get('message') or data.get('prompt') or '').strip()
    language_key = (data.get('language') or 'en').strip().lower()
    mode = (data.get('mode') or 'chat').strip().lower()
    if mode not in ('chat', 'voice', 'call'):
        mode = 'chat'

    if not query:
        return jsonify({'error': 'No query provided'}), 400
    if len(query) > 12000:
        return jsonify({'error': 'Message is too long. Please shorten it and try again.'}), 400

    user_name = session.get('username', 'User')
    history = db.get_ai_chat_history(session['user_id'], 8)
    finance_related = _is_finance_related(query, history)
    context = gather_financial_context() if finance_related else None
    gemini_key = _gemini_api_key()

    if not gemini_key:
        fallback = None
        if context and os.environ.get('AI_LOCAL_FALLBACK', '0') == '1':
            fallback = local_ai_response(query, context, language_key, user_name)
        if fallback:
            db.add_ai_chat_message(session['user_id'], 'user', query, mode)
            db.add_ai_chat_message(session['user_id'], 'assistant', fallback, mode)
            return jsonify({'response': fallback, 'reply': fallback, 'language': language_key, 'mode': mode, 'provider': 'local-finance-fallback'}), 200
        return jsonify({
            'error': 'Gemini API is not configured on the server.',
            'code': 'GEMINI_NOT_CONFIGURED',
            'hint': 'Set GEMINI_API_KEY (or GOOGLE_API_KEY) in Render Environment and redeploy.'
        }), 503

    system_instruction = _build_ai_system_instruction(user_name, language_key, mode)
    if context:
        current_message = f"{_format_financial_context(context)}\n\nUSER MESSAGE:\n{query}"
    else:
        current_message = query

    response_text = None
    used_model = None
    errors = []
    client = None
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=gemini_key, http_options=types.HttpOptions(timeout=8000))

        # Use Gemini's native multi-turn chat representation instead of
        # flattening history into one giant prompt string. Google documents
        # explicit user/model history for chat, which improves follow-ups and
        # reduces the tendency to repeat prior answers.
        chat_history = []
        # Normalize persisted history before sending it to Gemini. A truncated
        # window can otherwise begin with a model turn or contain duplicate
        # consecutive roles after an interrupted request. Current Gemini chat
        # APIs are stricter about malformed/prefilled model turns.
        normalized_history = []
        for item in history[-8:]:
            role = 'user' if item.get('role') == 'user' else 'model'
            text = str(item.get('content') or '').strip()[:1800]
            if not text:
                continue
            if not normalized_history and role != 'user':
                continue
            if normalized_history and normalized_history[-1][0] == role:
                normalized_history[-1] = (role, normalized_history[-1][1] + "\n" + text)
            else:
                normalized_history.append((role, text))
        # The new message is always a user turn, so do not prefill a final model
        # turn in history; drop it if an interrupted prior request left one.
        if normalized_history and normalized_history[-1][0] == 'model':
            pass  # valid completed prior turn before the new user message
        for role, text in normalized_history[-6:]:
            chat_history.append(types.Content(role=role, parts=[types.Part(text=text)]))

        for mname in _gemini_models_to_try():
            try:
                chat = client.chats.create(
                    model=mname,
                    history=chat_history,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction,
                        # Gemini 3.6+ deprecates sampling parameters such as
                        # temperature/top_p/top_k. Keeping the config minimal
                        # avoids present/future 400 responses on current models.
                        max_output_tokens=600 if mode == 'chat' else 220,
                    ),
                )
                response = chat.send_message(message=current_message)
                candidate = (getattr(response, 'text', None) or '').strip()
                if candidate:
                    response_text = candidate
                    used_model = mname
                    break
                errors.append(f"{mname}: empty response")
            except Exception as ex_m:
                # Keep server logs useful while not leaking API keys or internal
                # stack traces to the public client. A short one-time retry helps
                # with transient 429/500/503 model-load spikes without causing
                # duplicate successful replies or long request storms.
                safe_error = str(ex_m).replace(gemini_key, '[redacted]')[:500]
                print(f"[AI ASSISTANT] Model {mname} failed: {safe_error}")
                errors.append(f"{mname}: {safe_error}")
                # Fast-fail: move immediately to the next low-latency model instead of
                # retrying the same overloaded endpoint and making the user wait.
                continue
    except Exception as exc:
        safe_error = str(exc).replace(gemini_key, '[redacted]')[:500]
        print(f"[AI ASSISTANT] Gemini SDK/client failed: {safe_error}")
        errors.append(f"SDK: {safe_error}")
    finally:
        if client is not None:
            try:
                client.close()
            except Exception:
                pass

    if not response_text:
        fallback = None
        if context and os.environ.get('AI_LOCAL_FALLBACK', '0') == '1':
            fallback = local_ai_response(query, context, language_key, user_name)
        if fallback:
            response_text = fallback
            used_model = 'local-finance-fallback'
        else:
            # Do not silently pretend that canned financial data came from Gemini.
            # This was the main source of the old repetitive/wrong behaviour.
            return jsonify({
                'error': 'Gemini could not answer this request right now.',
                'code': 'GEMINI_CALL_FAILED',
                'hint': 'Check Render logs, API key permissions/quota, and the configured GEMINI_MODEL.',
                'tried_models': _gemini_models_to_try()
            }), 502

    db.add_ai_chat_message(session['user_id'], 'user', query, mode)
    db.add_ai_chat_message(session['user_id'], 'assistant', response_text, mode)

    return jsonify({
        'response': response_text,
        'reply': response_text,
        'language': language_key,
        'mode': mode,
        'provider': 'Google Gemini' if used_model != 'local-finance-fallback' else used_model,
        'model': used_model
    })


@app.route('/api/fetch-product-details', methods=['POST'])
@login_required
def fetch_product_details():
    data = request.get_json() or {}
    url = data.get('url', '').strip()

    if not url:
        return jsonify({'error': 'URL is required'}), 400

    try:
        from urllib.parse import urlparse, unquote
        parsed = urlparse(url)
        host = parsed.netloc.lower()
        path_name = parsed.path or ''
        title = ''

        if 'amazon.' in host:
            unescaped = unquote(path_name)
            if '/dp/' in unescaped:
                title = unescaped.split('/dp/')[0].split('/')[-1]
            elif '/product/' in unescaped:
                title = unescaped.split('/product/')[1].split('/')[0]
            else:
                title = [p for p in unescaped.split('/') if p][-1] if [p for p in unescaped.split('/') if p] else ''
        else:
            title = [p for p in path_name.split('/') if p][-1] if [p for p in path_name.split('/') if p] else ''

        title = re.sub(r'[-_]', ' ', title).strip()
        if len(title) > 120:
            title = title[:120]

        return jsonify({
            'title': title or 'Product details',
            'price': 0,
            'currency': 'AED'
        })
    except Exception:
        return jsonify({'title': 'Product details unavailable', 'price': 0, 'currency': 'AED'})

@app.route('/api/global-search', methods=['GET'])
@login_required
def global_search_api():
    q = request.args.get('q', '').strip()[:200]
    if not q:
        return jsonify([])

    results = db.search_global(q, session['user_id'])
    return jsonify(results)

@app.route('/api/settings', methods=['GET'])
@login_required
def get_settings_api():
    return jsonify(db.get_settings(session['user_id']))

@app.route('/api/settings', methods=['POST'])
@login_required
def save_settings_api():
    data = request.get_json() or {}
    if not isinstance(data, dict):
        return jsonify({'success': False, 'error': 'Invalid settings payload'}), 400
    allowed = {'theme', 'default_currency', 'primary_currency', 'secondary_currency', 'exchange_rate', 'shopping_budget', 'salary_credit_day'}
    safe = {k: v for k, v in data.items() if k in allowed}
    if not safe:
        return jsonify({'success': False, 'error': 'No supported settings supplied'}), 400
    if 'theme' in safe and safe['theme'] not in {'light', 'dark'}:
        return jsonify({'success': False, 'error': 'Invalid theme'}), 400
    for cur_key in ('default_currency', 'primary_currency', 'secondary_currency'):
        if cur_key in safe:
            code = str(safe[cur_key] or '').upper().strip()
            if not re.fullmatch(r'[A-Z]{3}', code):
                return jsonify({'success': False, 'error': f'Invalid {cur_key}'}), 400
            safe[cur_key] = code
    # Validate the resulting pair, not only fields present in this one request.
    # This closes a bug where changing only primary (or only secondary) could
    # make both saved currencies identical. The active/default currency must
    # also always belong to the saved pair.
    existing = db.get_settings(session['user_id'])
    resulting_primary = safe.get('primary_currency', str(existing.get('primary_currency') or 'AED').upper())
    resulting_secondary = safe.get('secondary_currency', str(existing.get('secondary_currency') or 'INR').upper())
    if resulting_primary == resulting_secondary:
        return jsonify({'success': False, 'error': 'Primary and secondary currencies must be different'}), 400
    if 'default_currency' in safe and safe['default_currency'] not in {resulting_primary, resulting_secondary}:
        return jsonify({'success': False, 'error': 'Default currency must be one of the selected currency pair'}), 400
    if 'salary_credit_day' in safe:
        try:
            day = int(safe['salary_credit_day'])
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'Invalid salary credit day'}), 400
        if day < 1 or day > 31:
            return jsonify({'success': False, 'error': 'Salary credit day must be between 1 and 31'}), 400
        safe['salary_credit_day'] = str(day)
    for key in ('exchange_rate', 'shopping_budget'):
        if key in safe:
            try:
                num = float(safe[key])
            except (TypeError, ValueError):
                return jsonify({'success': False, 'error': f'Invalid {key}'}), 400
            if not math.isfinite(num):
                return jsonify({'success': False, 'error': f'Invalid {key}'}), 400
            if key == 'exchange_rate' and num <= 0:
                return jsonify({'success': False, 'error': 'Exchange rate must be greater than zero'}), 400
            if key == 'shopping_budget' and num < 0:
                return jsonify({'success': False, 'error': 'Shopping budget cannot be negative'}), 400
            safe[key] = str(num)
    db.save_settings(safe, session['user_id'])
    return jsonify({'success': True})

# ---------------------------------------------------------------------------
# Exchange-rate proxy/cache (Frankfurter v2)
# ---------------------------------------------------------------------------
_FX_CACHE = {}
_FX_CACHE_LOCK = threading.Lock()

def _fx_cached(key, ttl, loader):
    now = time.time()
    with _FX_CACHE_LOCK:
        item = _FX_CACHE.get(key)
        if item and now - item[0] < ttl:
            return item[1]
    value = loader()
    with _FX_CACHE_LOCK:
        _FX_CACHE[key] = (now, value)
    return value

def _fx_get_json(path, params=None, timeout=8):
    url = 'https://api.frankfurter.dev' + path
    r = requests.get(url, params=params or {}, timeout=timeout, headers={'User-Agent': 'YARIN-Finance/1.0'})
    r.raise_for_status()
    return r.json()

@app.route('/api/fx/currencies', methods=['GET'])
@login_required
def fx_currencies():
    try:
        data = _fx_cached('currencies', 6 * 3600, lambda: _fx_get_json('/v2/currencies'))
        out = []
        if isinstance(data, list):
            for item in data:
                code = str(item.get('iso_code') or item.get('code') or '').upper()
                if re.fullmatch(r'[A-Z]{3}', code):
                    out.append({'code': code, 'name': item.get('name') or code})
        elif isinstance(data, dict):
            for code, name in data.items():
                code = str(code).upper()
                if re.fullmatch(r'[A-Z]{3}', code):
                    out.append({'code': code, 'name': name if isinstance(name, str) else code})
        out.sort(key=lambda x: x['code'])
        return jsonify({'currencies': out})
    except Exception:
        fallback = [('AED','United Arab Emirates Dirham'),('INR','Indian Rupee'),('USD','US Dollar'),('EUR','Euro'),('GBP','British Pound'),('SAR','Saudi Riyal'),('QAR','Qatari Riyal'),('KWD','Kuwaiti Dinar'),('BHD','Bahraini Dinar'),('OMR','Omani Rial'),('CAD','Canadian Dollar'),('AUD','Australian Dollar'),('CHF','Swiss Franc'),('JPY','Japanese Yen'),('CNY','Chinese Yuan'),('SGD','Singapore Dollar'),('NZD','New Zealand Dollar'),('PKR','Pakistani Rupee'),('BDT','Bangladeshi Taka'),('LKR','Sri Lankan Rupee')]
        return jsonify({'currencies':[{'code':c,'name':n} for c,n in fallback], 'fallback': True})

@app.route('/api/fx/rate', methods=['GET'])
@login_required
def fx_rate():
    base = str(request.args.get('base') or 'AED').upper().strip()
    quote = str(request.args.get('quote') or 'INR').upper().strip()
    if not re.fullmatch(r'[A-Z]{3}', base) or not re.fullmatch(r'[A-Z]{3}', quote):
        return jsonify({'error':'Invalid currency code'}), 400
    if base == quote:
        return jsonify({'base':base,'quote':quote,'rate':1.0,'date':datetime.utcnow().strftime('%Y-%m-%d')})
    try:
        data = _fx_cached(f'rate:{base}:{quote}', 600, lambda: _fx_get_json(f'/v2/rate/{base}/{quote}'))
        rate = float(data.get('rate'))
        rate_date = data.get('date')
        if not math.isfinite(rate) or rate <= 0:
            raise ValueError('Invalid exchange rate')
        # Keep the last known AED->currency rate in the user's persistent
        # settings. This prevents a new browser/device from silently assuming
        # a 1:1 conversion during a temporary external API outage.
        if base == 'AED':
            db.save_settings({f'fx_rate_{quote}': rate, f'fx_rate_date_{quote}': rate_date or ''}, session['user_id'])
            if quote == 'INR':
                db.save_settings({'exchange_rate': rate}, session['user_id'])
        return jsonify({'base':base,'quote':quote,'rate':rate,'date':rate_date,'provider':'Frankfurter'})
    except Exception:
        return jsonify({'error':'Exchange rate temporarily unavailable'}), 503

@app.route('/api/fx/series', methods=['GET'])
@login_required
def fx_series():
    from datetime import timedelta
    base = str(request.args.get('base') or 'AED').upper().strip()
    quote = str(request.args.get('quote') or 'INR').upper().strip()
    range_key = str(request.args.get('range') or '1M').upper()
    if not re.fullmatch(r'[A-Z]{3}', base) or not re.fullmatch(r'[A-Z]{3}', quote):
        return jsonify({'error':'Invalid currency code'}), 400
    days = {'7D':10,'1M':35,'3M':100,'1Y':370}.get(range_key,35)
    end = datetime.utcnow().date(); start = end - timedelta(days=days)
    params={'base':base,'quotes':quote,'from':start.isoformat(),'to':end.isoformat()}
    if range_key == '1Y': params['group']='month'
    try:
        data = _fx_cached(f'series:{base}:{quote}:{range_key}', 1800, lambda: _fx_get_json('/v2/rates', params=params))
        points=[]
        if isinstance(data,list):
            for item in data:
                if str(item.get('quote') or '').upper()==quote and item.get('rate') is not None:
                    try:
                        rate = float(item['rate'])
                    except (TypeError, ValueError):
                        continue
                    if math.isfinite(rate) and rate > 0 and item.get('date'):
                        points.append({'date':item.get('date'),'rate':rate})
        elif isinstance(data,dict):
            for d,row in (data.get('rates') or {}).items():
                if isinstance(row,dict) and quote in row:
                    try:
                        rate = float(row[quote])
                    except (TypeError, ValueError):
                        continue
                    if math.isfinite(rate) and rate > 0 and d:
                        points.append({'date':d,'rate':rate})
        points.sort(key=lambda x:x['date'])
        if range_key=='7D': points=points[-7:]
        return jsonify({'base':base,'quote':quote,'range':range_key,'points':points,'provider':'Frankfurter'})
    except Exception:
        return jsonify({'error':'Exchange history temporarily unavailable','points':[]}), 503

def _user_display_currency(user_id):
    settings = db.get_settings(user_id)
    code = str(settings.get('default_currency') or settings.get('primary_currency') or 'AED').upper()
    if not re.fullmatch(r'[A-Z]{3}', code):
        code = 'AED'
    rate = 1.0
    if code != 'AED':
        try:
            data = _fx_cached(f'rate:AED:{code}', 600, lambda: _fx_get_json(f'/v2/rate/AED/{code}', timeout=2.5))
            rate = float(data.get('rate') or 0)
            if not math.isfinite(rate) or rate <= 0:
                raise ValueError('Invalid live FX rate')
            # Persist the last-known rate for every supported display currency,
            # not just INR. Reports/AI therefore remain consistent during a
            # temporary reference-rate outage or on a newly restarted server.
            db.save_settings({f'fx_rate_{code}': rate, f'fx_rate_date_{code}': data.get('date') or ''}, user_id)
            if code == 'INR':
                db.save_settings({'exchange_rate': rate}, user_id)
        except Exception:
            persisted = settings.get(f'fx_rate_{code}')
            try:
                persisted_rate = float(persisted)
            except (TypeError, ValueError):
                persisted_rate = 0.0
            if math.isfinite(persisted_rate) and persisted_rate > 0:
                rate = persisted_rate
            elif code == 'INR':
                try:
                    legacy_rate = float(settings.get('exchange_rate') or 0)
                except (TypeError, ValueError):
                    legacy_rate = 0.0
                if math.isfinite(legacy_rate) and legacy_rate > 0:
                    rate = legacy_rate
                else:
                    code, rate = 'AED', 1.0
            else:
                code, rate = 'AED', 1.0
    return code, rate

def _display_money(amount_aed, user_id):
    code, rate = _user_display_currency(user_id)
    return code, float(amount_aed or 0) * rate

@app.route('/api/branding', methods=['GET'])
def get_branding():
    # Branding customization, splash video, and dashboard wallpaper controls
    # are intentionally disabled. Login wallpapers remain online/random and
    # are independent from these removed dashboard settings.
    return jsonify({
        'app_name': 'YARIN يارين',
        'logo_url': '/static/icons/yarin-emblem.webp',
        'splash_video_url': '',
        'theme_image_url': '',
        'theme_video_url': ''
    })

@app.route('/api/assets/<kind>', methods=['GET'])
@login_required
def serve_user_asset(kind):
    if kind not in ASSET_LIMITS:
        return jsonify({'error': 'unknown asset'}), 404
    asset = db.get_user_asset(session['user_id'], kind)
    if not asset:
        return jsonify({'error': 'asset not found'}), 404
    data = asset.get('data')
    if isinstance(data, memoryview):
        data = data.tobytes()
    response = send_file(io.BytesIO(bytes(data)), mimetype=asset.get('mime_type') or 'application/octet-stream', conditional=True)
    response.headers['Cache-Control'] = 'private, max-age=3600'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response

@app.route('/api/logo', methods=['POST'])
@login_required
def upload_logo():
    return jsonify({'success': False, 'error': 'Branding customization is disabled in YARIN'}), 410

@app.route('/api/logo', methods=['DELETE'])
@login_required
def delete_logo():
    return jsonify({'success': False, 'error': 'Branding customization is disabled in YARIN'}), 410

@app.route('/api/splash-video', methods=['POST'])
@login_required
def upload_splash_video():
    return jsonify({'success': False, 'error': 'Branding customization is disabled in YARIN'}), 410

@app.route('/api/splash-video', methods=['DELETE'])
@login_required
def delete_splash_video():
    return jsonify({'success': False, 'error': 'Branding customization is disabled in YARIN'}), 410

@app.route('/api/theme-image', methods=['POST'])
@login_required
def upload_theme_image():
    return jsonify({'success': False, 'error': 'Branding customization is disabled in YARIN'}), 410

@app.route('/api/theme-image', methods=['DELETE'])
@login_required
def delete_theme_image():
    return jsonify({'success': False, 'error': 'Branding customization is disabled in YARIN'}), 410

@app.route('/api/theme-video', methods=['POST'])
@login_required
def upload_theme_video():
    return jsonify({'success': False, 'error': 'Branding customization is disabled in YARIN'}), 410

@app.route('/api/theme-video', methods=['DELETE'])
@login_required
def delete_theme_video():
    return jsonify({'success': False, 'error': 'Branding customization is disabled in YARIN'}), 410

@app.route('/api/export', methods=['GET'])
@login_required
def export_data():
    # A backup must include payment history too, otherwise EMI/debt ledgers cannot
    # be reconstructed after an import. Everything remains scoped to this user.
    dump = {'backup_version': 2}
    for table in TABLE_CONFIGS:
        dump[table] = db.fetch_all(table, session['user_id'])
    for table in ('emi_payments', 'debt_payments'):
        dump[table] = db.fetch_all(table, session['user_id'])
    dump['settings'] = db.get_settings(session['user_id'])

    filename = f"yarin_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    buf = io.BytesIO(json.dumps(dump, indent=2, default=str).encode('utf-8'))
    return send_file(buf, mimetype='application/json', as_attachment=True, download_name=filename)

@app.route('/api/import', methods=['POST'])
@login_required
def import_data():
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    file = request.files['file']
    try:
        content = json.loads(file.read().decode('utf-8'))
        if not isinstance(content, dict):
            raise ValueError('Backup root must be an object')

        # Map old backup IDs to newly inserted IDs. This is required so imported
        # EMI/debt payment history points at the correct newly-created parent row.
        id_maps = {'emi': {}, 'debts': {}}
        for table in TABLE_CONFIGS:
            rows = content.get(table, [])
            if not isinstance(rows, list):
                continue
            allowed_fields = set(TABLE_CONFIGS[table]['fields'])
            for rec in rows:
                if not isinstance(rec, dict):
                    continue
                old_id = rec.get('id')
                rec_copy = {k: rec.get(k) for k in allowed_fields if k in rec}
                if not rec_copy:
                    continue
                # Backups are untrusted input too: reject malformed/negative/NaN
                # numeric values rather than corrupting finance totals.
                malformed = False
                for field in NUMERIC_FIELDS.intersection(rec_copy):
                    try:
                        num = float(rec_copy[field] if rec_copy[field] is not None else 0)
                    except (TypeError, ValueError):
                        malformed = True; break
                    if not math.isfinite(num) or num < 0 or num > MAX_FINANCE_VALUE or (field == 'quantity' and num <= 0):
                        malformed = True; break
                    rec_copy[field] = num
                if malformed:
                    continue
                if _validate_text_dates(rec_copy):
                    continue
                integrity_error = _validate_record_integrity(table, rec_copy)
                if integrity_error:
                    continue
                new_id = db.insert_record(table, rec_copy, session['user_id'])
                if table in id_maps and old_id is not None:
                    id_maps[table][str(old_id)] = new_id

        payment_specs = {
            'emi_payments': ('emi_id', 'emi'),
            'debt_payments': ('debt_id', 'debts')
        }
        for table, (fk_field, parent_table) in payment_specs.items():
            rows = content.get(table, [])
            if not isinstance(rows, list):
                continue
            for rec in rows:
                if not isinstance(rec, dict):
                    continue
                mapped_parent = id_maps[parent_table].get(str(rec.get(fk_field)))
                if not mapped_parent:
                    # Old v1 backups did not contain payment history; malformed v2
                    # rows are skipped rather than linked to another user's record.
                    continue
                try:
                    amount = float(rec.get('amount', 0))
                except (TypeError, ValueError):
                    continue
                if not math.isfinite(amount) or amount <= 0 or amount > MAX_FINANCE_VALUE:
                    continue
                payload = {
                    fk_field: mapped_parent,
                    'amount': amount,
                    'date': str(rec.get('date') or get_now_date_time()[0]),
                    'time': str(rec.get('time') or get_now_date_time()[1]),
                    'notes': str(rec.get('notes') or '')
                }
                if _validate_text_dates(payload):
                    continue
                db.insert_record(table, payload, session['user_id'])

        settings = content.get('settings')
        if isinstance(settings, dict):
            # Backups are untrusted input. Only import settings that this build
            # understands, and validate the currency pair before saving it.
            allowed_import_settings = {
                'theme', 'default_currency', 'primary_currency', 'secondary_currency',
                'exchange_rate', 'shopping_budget', 'salary_credit_day',
                'last_salary_amount', 'income_profile_saved',
                'income_profile_monthly_income', 'income_profile_other_income',
                'income_profile_fixed_emi_commitment', 'income_profile_fixed_debt_commitment'
            }
            safe_settings = {}
            for k, v in settings.items():
                key = str(k)[:80]
                if key not in allowed_import_settings:
                    continue
                value = str(v)
                if len(value) <= 12000:
                    safe_settings[key] = value

            pcur = str(safe_settings.get('primary_currency') or '').upper()
            scur = str(safe_settings.get('secondary_currency') or '').upper()
            dcur = str(safe_settings.get('default_currency') or '').upper()
            if pcur and not re.fullmatch(r'[A-Z]{3}', pcur):
                safe_settings.pop('primary_currency', None); pcur = ''
            if scur and not re.fullmatch(r'[A-Z]{3}', scur):
                safe_settings.pop('secondary_currency', None); scur = ''
            if pcur and scur and pcur == scur:
                safe_settings.pop('secondary_currency', None); scur = ''
            if dcur and not re.fullmatch(r'[A-Z]{3}', dcur):
                safe_settings.pop('default_currency', None)
            elif dcur and pcur and scur and dcur not in {pcur, scur}:
                safe_settings['default_currency'] = pcur

            if 'salary_credit_day' in safe_settings:
                try:
                    day = int(safe_settings['salary_credit_day'])
                    if not 1 <= day <= 31:
                        raise ValueError
                    safe_settings['salary_credit_day'] = str(day)
                except Exception:
                    safe_settings.pop('salary_credit_day', None)

            for numeric_setting in ('exchange_rate', 'shopping_budget', 'last_salary_amount',
                                    'income_profile_monthly_income', 'income_profile_other_income',
                                    'income_profile_fixed_emi_commitment', 'income_profile_fixed_debt_commitment'):
                if numeric_setting in safe_settings:
                    try:
                        num = float(safe_settings[numeric_setting])
                        if not math.isfinite(num) or num < 0 or num > MAX_FINANCE_VALUE:
                            raise ValueError
                        safe_settings[numeric_setting] = str(num)
                    except Exception:
                        safe_settings.pop(numeric_setting, None)

            if safe_settings:
                db.save_settings(safe_settings, session['user_id'])

        return jsonify({'success': True})
    except Exception:
        return jsonify({'success': False, 'error': 'Invalid or incompatible JSON backup'}), 400

@app.route('/api/clear-all-data', methods=['POST'])
@login_required
def clear_all_data_api():
    data = request.get_json() or {}
    if data.get('confirm') != 'DELETE':
        return jsonify({'success': False, 'error': 'Confirmation text mismatch'}), 400

    db.clear_all_data(session['user_id'])
    return jsonify({'success': True})

@app.route('/api/advice', methods=['GET'])
@login_required
def get_advice():
    dash = db.get_dashboard_data(session['user_id'])
    income = dash['total_income']
    expenses = dash['total_expenses']
    savings = dash['total_savings']
    outstanding = dash['outstanding_debt']

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT category, COALESCE(SUM(amount),0) as t FROM expenses WHERE user_id=? GROUP BY category ORDER BY t DESC LIMIT 1", (session['user_id'],))
    cat_row = cursor.fetchone()
    conn.close()

    tips = []
    savings_rate = 0.0
    if income > 0:
        savings_rate = round(((income - expenses) / income) * 100, 1)

    if income == 0:
        tips.append("Add your income records to unlock personalised financial insights.")
    else:
        if savings_rate < 0:
            tips.append("Your expenses currently exceed your income. Review non-essential spending this month.")
        elif savings_rate < 20:
            tips.append(f"Your savings rate is {savings_rate}%. Aim for at least 20% of income saved each month.")
        else:
            tips.append(f"Great job — you're saving {savings_rate}% of your income. Keep this momentum going.")

    if cat_row and cat_row['t'] > 0:
        tips.append(f"Your highest spending category is '{cat_row['category']}'. Look for ways to trim it.")

    if outstanding > 0:
        cur, shown = _display_money(outstanding, session['user_id'])
        tips.append(f"You have {cur} {shown:,.2f} in outstanding debt. Prioritise clearing high-interest amounts first.")
    else:
        tips.append("You currently have no outstanding debt. Excellent financial discipline.")

    if savings <= 0:
        tips.append("Start a small recurring savings habit — even a fixed amount every payday adds up.")

    if savings_rate >= 30:
        health = "Excellent"
    elif savings_rate >= 15:
        health = "Good"
    elif savings_rate >= 0:
        health = "Needs Attention"
    else:
        health = "Critical"

    motivational = [
        "Every dirham saved today builds the freedom of tomorrow.",
        "Small consistent habits create big financial results.",
        "You are the CEO of your own finances — lead wisely.",
        "Discipline today, comfort tomorrow."
    ]

    import random
    return jsonify({
        'tips': tips,
        'health': health,
        'savings_rate': savings_rate,
        'motivational': random.choice(motivational)
    })

@app.route('/api/income-profile', methods=['GET'])
@login_required
def get_income_profile_route():
    return jsonify(get_income_profile())

@app.route('/api/income-profile', methods=['POST'])
@login_required
def save_income_profile_route():
    data = request.get_json() or {}
    try:
        monthly_income = float(data.get('monthly_income', 0))
    except (ValueError, TypeError):
        monthly_income = 0.0

    if not math.isfinite(monthly_income) or monthly_income <= 0:
        return jsonify({'error': 'Enter a valid verified monthly income to save your profile'}), 400

    def get_f(key):
        try:
            value = float(data.get(key, 0))
            return value if math.isfinite(value) and value >= 0 else 0.0
        except (ValueError, TypeError):
            return 0.0

    other_income = get_f('other_income')
    fixed_emi_commitment = get_f('fixed_emi_commitment')
    fixed_debt_commitment = get_f('fixed_debt_commitment')
    notes = str(data.get('notes', '')).strip()[:500]

    values = {
        'income_profile_monthly_income': str(monthly_income),
        'income_profile_other_income': str(other_income),
        'income_profile_fixed_emi_commitment': str(fixed_emi_commitment),
        'income_profile_fixed_debt_commitment': str(fixed_debt_commitment),
        'income_profile_notes': notes,
        'income_profile_saved': '1',
        'income_profile_updated_at': datetime.now().strftime('%Y-%m-%d %H:%M')
    }

    db.save_settings(values, session['user_id'])
    return jsonify(get_income_profile())

@app.route('/api/salary-plan', methods=['POST'])
@login_required
def salary_plan_route():
    profile = get_income_profile()
    if not profile['saved'] or profile['monthly_income'] <= 0:
        return jsonify({
            'error': 'Save your Income & Commitment Profile first — the Smart Plan only unlocks once your verified income and fixed commitments are on file.',
            'gate_locked': True
        }), 400

    data = request.get_json() or {}
    try:
        override_salary = float(data.get('salary', 0))
    except (ValueError, TypeError):
        override_salary = 0.0
    if not math.isfinite(override_salary) or override_salary < 0:
        override_salary = 0.0

    verified_income = profile['total_verified_income']
    salary = override_salary if override_salary > 0 else verified_income
    is_projection = override_salary > 0 and abs(override_salary - verified_income) > 0.01

    if salary <= 0:
        return jsonify({'error': 'Enter a valid salary amount'}), 400

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COALESCE(SUM(monthly_payment),0) FROM emi WHERE user_id=? AND COALESCE(amount,0)-COALESCE(paid,0)>0", (session['user_id'],))
    emi_monthly = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(monthly_payment),0) FROM debts WHERE user_id=? AND COALESCE(total_amount,0)-COALESCE(paid_amount,0)>0", (session['user_id'],))
    debt_monthly = cursor.fetchone()[0]
    conn.close()

    total_emi_commitment = emi_monthly + profile['fixed_emi_commitment']
    total_debt_commitment = debt_monthly + profile['fixed_debt_commitment']

    weights = {'family': 15, 'emi': 12, 'debt': 8, 'savings': 20, 'shopping': 8, 'emergency': 7}
    labels = {
        'family': 'Family Support',
        'emi': 'EMI / Loans',
        'debt': 'Debt Repayment',
        'savings': 'Savings',
        'shopping': 'Shopping & Personal',
        'emergency': 'Emergency Fund'
    }

    if total_emi_commitment <= 0:
        freed = weights['emi'] - 2
        weights['savings'] += freed * 0.6
        weights['emergency'] += freed * 0.4
        weights['emi'] = 2

    if total_debt_commitment <= 0:
        freed = weights['debt']
        weights['savings'] += freed * 0.5
        weights['shopping'] += freed * 0.5
        weights['debt'] = 0

    total_weight = sum(weights.values()) or 1
    allocations = []
    running_total = 0.0

    for key, w in weights.items():
        pct = (w / total_weight) * 100
        amt = round(salary * w / total_weight, 2)
        running_total += amt
        allocations.append({
            'key': key,
            'label': labels[key],
            'percent': round(pct, 1),
            'amount': amt
        })

    drift = round(salary - running_total, 2)
    if allocations and drift:
        biggest = max(allocations, key=lambda x: x['amount'])
        biggest['amount'] = round(biggest['amount'] + drift, 2)

    savings_alloc = next(a for a in allocations if a['key'] == 'savings')['amount']
    savings_pct = round((savings_alloc / salary) * 100, 1) if salary else 0
    emi_pct = round((total_emi_commitment / salary) * 100, 1) if salary else 0
    debt_pct = round((total_debt_commitment / salary) * 100, 1) if salary else 0

    dash = db.get_dashboard_data(session['user_id'])
    total_savings = dash['total_savings']
    savings_goal = dash['savings_goal']

    health_score = 0.0
    health_score += min(40.0, max(0.0, savings_pct) / 30.0 * 40.0)
    health_score += max(0.0, 25.0 - (max(0.0, emi_pct) / 40.0) * 25.0)
    health_score += max(0.0, 20.0 - (max(0.0, debt_pct) / 50.0) * 20.0)
    if savings_goal > 0:
        health_score += min(1.0, total_savings / savings_goal) * 15.0
    elif total_savings > 0:
        health_score += 10.0
    health_score = round(max(0.0, min(100.0, health_score)), 1)

    if health_score >= 80:
        health = "Excellent"
    elif health_score >= 60:
        health = "Good"
    elif health_score >= 40:
        health = "Needs Attention"
    else:
        health = "Critical"

    display_cur, display_rate = _user_display_currency(session['user_id'])
    suggestions = [
        f"Verified monthly income on file: {display_cur} {verified_income * display_rate:,.2f}"
    ]
    if is_projection:
        suggestions.append(f"This plan is a what-if projection using {display_cur} {salary * display_rate:,.2f} instead of your verified income.")

    money_tips = [
        "Automate a transfer to savings the moment your salary lands — pay yourself first.",
        "Review subscriptions every quarter; small recurring charges add up fast.",
        "Keep 3-6 months of expenses in your Emergency Fund before investing aggressively."
    ]

    free_amount = max(0.0, round(salary - total_emi_commitment - total_debt_commitment, 2))
    commitment_breakdown = [
        {'label': 'Free / Flexible Income', 'amount': free_amount},
        {'label': 'EMI Commitments', 'amount': round(total_emi_commitment, 2)},
        {'label': 'Debt Commitments', 'amount': round(total_debt_commitment, 2)}
    ]

    return jsonify({
        'salary': salary,
        'verified_income': verified_income,
        'is_projection': is_projection,
        'allocations': allocations,
        'health': health,
        'budget_health_score': health_score,
        'savings_rate': savings_pct,
        'emi_to_income_pct': emi_pct,
        'debt_to_income_pct': debt_pct,
        'commitment_breakdown': commitment_breakdown,
        'suggestions': suggestions,
        'money_tips': money_tips
    })

@app.route('/api/report/<kind>', methods=['GET'])
@login_required
def generate_report(kind):
    now = datetime.now()
    if kind == 'monthly':
        date_filter = f"{now.strftime('%Y-%m')}%"
        label = now.strftime('%B %Y')
    elif kind == 'yearly':
        date_filter = f"{now.strftime('%Y')}%"
        label = f"Year {now.strftime('%Y')}"
    else:
        date_filter = "%"
        label = "Complete Financial Report"

    conn = db.get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT COALESCE(SUM(amount),0) FROM income WHERE user_id=? AND date LIKE ?", (session['user_id'], date_filter))
    income = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE user_id=? AND date LIKE ?", (session['user_id'], date_filter))
    expenses = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(amount),0) FROM savings WHERE user_id=? AND date LIKE ?", (session['user_id'], date_filter))
    savings = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(amount),0) FROM family_transfers WHERE user_id=? AND date LIKE ?", (session['user_id'], date_filter))
    family = cursor.fetchone()[0]

    # EMI `paid` is a cumulative balance on the parent row, so filtering the
    # parent by its creation date gives wrong monthly/yearly payment totals.
    # Reconstruct period activity from the payment ledger plus any initial paid
    # amount that existed when the EMI record was created.
    cursor.execute("SELECT id, COALESCE(paid,0) AS paid, date FROM emi WHERE user_id=?", (session['user_id'],))
    emi_rows = [dict(r) for r in cursor.fetchall()]
    cursor.execute("SELECT emi_id, COALESCE(amount,0) AS amount, date FROM emi_payments WHERE user_id=?", (session['user_id'],))
    payment_rows = [dict(r) for r in cursor.fetchall()]
    paid_by_emi = {}
    for row in payment_rows:
        paid_by_emi[row['emi_id']] = paid_by_emi.get(row['emi_id'], 0.0) + float(row.get('amount') or 0)
    prefix = date_filter[:-1] if date_filter.endswith('%') else date_filter
    emi_paid = sum(float(r.get('amount') or 0) for r in payment_rows if str(r.get('date') or '').startswith(prefix))
    for row in emi_rows:
        initial_paid = max(0.0, float(row.get('paid') or 0) - paid_by_emi.get(row['id'], 0.0))
        if str(row.get('date') or '').startswith(prefix):
            emi_paid += initial_paid

    cursor.execute("SELECT COALESCE(SUM(total_amount - paid_amount),0) FROM debts WHERE user_id=?", (session['user_id'],))
    debt_out = cursor.fetchone()[0]
    conn.close()

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font('Arial', 'B', 16)
    pdf.cell(0, 10, 'YARIN - Tomorrow Starts Today.', 0, 1, 'C')
    pdf.set_font('Arial', '', 9)
    pdf.cell(0, 6, 'Your Money. Your Future. | Tomorrow Starts Today.', 0, 1, 'C')
    pdf.set_font('Arial', '', 12)
    pdf.cell(0, 8, f"{kind.upper()} REPORT - {label}", 0, 1, 'C')
    pdf.ln(10)

    pdf.set_font('Arial', '', 11)
    report_cur, report_rate = _user_display_currency(session['user_id'])
    cv = lambda x: float(x or 0) * report_rate
    pdf.cell(0, 8, f"Total Income: {report_cur} {cv(income):,.2f}", 0, 1)
    pdf.cell(0, 8, f"Total Expenses: {report_cur} {cv(expenses):,.2f}", 0, 1)
    pdf.cell(0, 8, f"Total Savings: {report_cur} {cv(savings):,.2f}", 0, 1)
    pdf.cell(0, 8, f"Family Transfers: {report_cur} {cv(family):,.2f}", 0, 1)
    pdf.cell(0, 8, f"EMI Paid: {report_cur} {cv(emi_paid):,.2f}", 0, 1)
    pdf.cell(0, 8, f"Outstanding Debt: {report_cur} {cv(debt_out):,.2f}", 0, 1)
    pdf.cell(0, 8, f"Net Balance: {report_cur} {cv(income - expenses - family - emi_paid):,.2f}", 0, 1)

    filename = f"YARIN_{kind}_report_{now.strftime('%Y%m%d')}.pdf"
    output = io.BytesIO(pdf.output(dest='S').encode('latin1'))

    return send_file(output, mimetype='application/pdf', as_attachment=True, download_name=filename)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    app.run(host='0.0.0.0', port=port, debug=False)

import os
import sys
import json
import re
import io
import time
from datetime import datetime
from flask import Flask, render_template, request, jsonify, redirect, url_for, session, send_file
from flask_session import Session
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename
import requests
from fpdf import FPDF
import database as db

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "azret-manage-plan-secret-key-2026")
app.config["SESSION_TYPE"] = "filesystem"
app.config["SESSION_PERMANENT"] = True
app.config["PERMANENT_SESSION_LIFETIME"] = 30 * 24 * 60 * 60  # 30 days
Session(app)

# Initialize database
db.init_db()

UPLOAD_FOLDER = os.path.join('static', 'uploads')
VIDEO_UPLOAD_FOLDER = os.path.join(UPLOAD_FOLDER, 'video')
THEME_UPLOAD_FOLDER = os.path.join(UPLOAD_FOLDER, 'theme')
THEME_VIDEO_UPLOAD_FOLDER = os.path.join(UPLOAD_FOLDER, 'theme_video')

for folder in [UPLOAD_FOLDER, VIDEO_UPLOAD_FOLDER, THEME_UPLOAD_FOLDER, THEME_VIDEO_UPLOAD_FOLDER]:
    os.makedirs(folder, exist_ok=True)

ALLOWED_IMAGE_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'}
ALLOWED_VIDEO_EXTENSIONS = {'mp4', 'webm', 'ogg', 'mov', 'm4v'}

def allowed_file(filename, allowed_set):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_set

def login_required(f):
    def wrapper(*args, **kwargs):
        if not session.get('logged_in'):
            if request.path.startswith('/api/'):
                return jsonify({'error': 'unauthorized'}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    wrapper.__name__ = f.__name__
    return wrapper

@app.route('/')
def index():
    if session.get('logged_in'):
        return render_template('index.html', start_splash=False)
    return render_template('login.html')

@app.route('/splash')
@login_required
def splash():
    return render_template('index.html', start_splash=True)

@app.route('/login')
def login():
    if session.get('logged_in'):
        return redirect(url_for('index'))
    return render_template('login.html')

@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json() or {}
    username = data.get('username', '').strip()
    password = data.get('password', '')

    user = db.get_user_by_username(username)
    if user and check_password_hash(user['password_hash'], password):
        session['logged_in'] = True
        session['username'] = user['username']
        return jsonify({'success': True, 'redirect': url_for('splash')})

    return jsonify({'success': False, 'error': 'Incorrect username or password'}), 401

@app.route('/api/logout', methods=['POST'])
def api_logout():
    session.clear()
    return jsonify({'success': True})

@app.route('/api/profile', methods=['GET'])
@login_required
def get_profile():
    user = db.get_user_by_username(session.get('username', 'Ijas'))
    return jsonify({'username': user['username'] if user else 'Ijas'})

@app.route('/api/update-username', methods=['POST'])
@login_required
def update_username():
    data = request.get_json() or {}
    new_username = data.get('username', '').strip()

    if not new_username:
        return jsonify({'success': False, 'error': 'Username cannot be empty'}), 400

    if len(new_username) > 40:
        return jsonify({'success': False, 'error': 'Username is too long (max 40 characters)'}), 400

    current_username = session.get('username', 'Ijas')
    success = db.update_username(current_username, new_username)

    if success:
        session['username'] = new_username
        return jsonify({'success': True, 'username': new_username})

    return jsonify({'success': False, 'error': 'Username already taken or invalid'}), 400

@app.route('/api/change-password', methods=['POST'])
@login_required
def change_password():
    data = request.get_json() or {}
    current_password = data.get('current_password', '')
    new_password = data.get('new_password', '')

    username = session.get('username', 'Ijas')
    user = db.get_user_by_username(username)

    if not user or not check_password_hash(user['password_hash'], current_password):
        return jsonify({'success': False, 'error': 'Current password is incorrect'}), 400

    if len(new_password) < 4:
        return jsonify({'success': False, 'error': 'New password must be at least 4 characters'}), 400

    db.update_password(username, new_password)
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

def get_now_date_time():
    now = datetime.now()
    return now.strftime('%Y-%m-%d'), now.strftime('%H:%M')

@app.route('/api/<table_name>', methods=['GET'])
@login_required
def get_records(table_name):
    if table_name not in TABLE_CONFIGS:
        return jsonify({'error': 'unknown table'}), 404

    search = request.args.get('q', '').strip()
    month = request.args.get('month', '').strip()
    year = request.args.get('year', '').strip()

    records = db.fetch_all(table_name, search=search, month=month, year=year)
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
            except ValueError:
                val = 0.0
        elif val is None:
            val = ''
        insert_data[field] = val

    new_id = db.insert_record(table_name, insert_data)
    new_record = db.fetch_one(table_name, new_id)
    return jsonify(new_record), 201

@app.route('/api/<table_name>/<int:record_id>', methods=['PUT'])
@login_required
def update_record_route(table_name, record_id):
    if table_name not in TABLE_CONFIGS:
        return jsonify({'error': 'unknown table'}), 404

    existing = db.fetch_one(table_name, record_id)
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
                except ValueError:
                    val = 0.0
            elif val is None:
                val = ''
            update_data[field] = val

    if update_data:
        db.update_record(table_name, record_id, update_data)

    updated = db.fetch_one(table_name, record_id)
    return jsonify(updated)

@app.route('/api/<table_name>/<int:record_id>', methods=['DELETE'])
@login_required
def delete_record_route(table_name, record_id):
    if table_name not in TABLE_CONFIGS:
        return jsonify({'error': 'unknown table'}), 404

    db.delete_record(table_name, record_id)
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
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify([])

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM {cfg['header_table']} WHERE {cfg['name_field']} LIKE ? ORDER BY date DESC, time DESC, id DESC LIMIT 8", (f"%{q}%",))
    rows = cursor.fetchall()
    conn.close()

    return jsonify([format_smart_row(cfg, r) for r in rows])

@app.route('/api/<table_name>/<int:record_id>/payments', methods=['GET'])
@login_required
def get_smart_payments(table_name, record_id):
    if table_name not in SMART_TRACKING_CONFIG:
        return jsonify({'error': 'unknown table'}), 404

    cfg = SMART_TRACKING_CONFIG[table_name]
    header = db.fetch_one(cfg['header_table'], record_id)
    if not header:
        return jsonify({'error': 'not found'}), 404

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM {cfg['payments_table']} WHERE {cfg['fk_field']} = ? ORDER BY date DESC, time DESC, id DESC", (record_id,))
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
    header = db.fetch_one(cfg['header_table'], record_id)
    if not header:
        return jsonify({'error': 'not found'}), 404

    data = request.get_json() or {}
    try:
        amount = float(data.get('amount', 0))
    except ValueError:
        amount = 0.0

    if amount <= 0:
        return jsonify({'error': "'amount' must be a positive number"}), 400

    default_date, default_time = get_now_date_time()
    payment_date = data.get('date') or default_date
    payment_time = data.get('time') or default_time
    notes = data.get('notes', '')

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute(f"INSERT INTO {cfg['payments_table']} ({cfg['fk_field']}, amount, date, time, notes) VALUES (?, ?, ?, ?, ?)",
                   (record_id, amount, payment_date, payment_time, notes))
    
    current_paid = float(header.get(cfg['paid_field']) or 0)
    new_paid = current_paid + amount
    cursor.execute(f"UPDATE {cfg['header_table']} SET {cfg['paid_field']} = ? WHERE id = ?", (new_paid, record_id))
    conn.commit()

    cursor.execute(f"SELECT * FROM {cfg['payments_table']} WHERE {cfg['fk_field']} = ? ORDER BY date DESC, time DESC, id DESC", (record_id,))
    payments = [dict(r) for r in cursor.fetchall()]
    conn.close()

    updated_header = db.fetch_one(cfg['header_table'], record_id)

    return jsonify({
        'record': format_smart_row(cfg, updated_header),
        'payments': payments
    }), 201

@app.route('/api/dashboard', methods=['GET'])
@login_required
def dashboard_api():
    data = db.get_dashboard_data()
    return jsonify(data)

# AI Assistant Context
def get_income_profile():
    settings = db.get_settings()
    
    def fnum(key):
        try:
            return float(settings.get(key) or 0)
        except ValueError:
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
    dash = db.get_dashboard_data()
    income_profile = get_income_profile()
    return {
        'total_income': dash['total_income'],
        'total_expenses': dash['total_expenses'],
        'total_savings': dash['total_savings'],
        'savings_goal': dash['savings_goal'],
        'total_family': dash['total_family_transfer'],
        'total_emi': dash['total_emi'],
        'total_emi_paid': dash['emi_paid'],
        'emi_pending': dash['emi_pending'],
        'active_emi_count': dash['active_emi_count'],
        'total_debt': dash['outstanding_debt'] + dash['net_balance'], # approx
        'debt_paid': 0,
        'outstanding_debt': dash['outstanding_debt'],
        'total_shopping': dash['total_shopping'],
        'net_balance': dash['net_balance'],
        'income_profile': income_profile
    }

def local_ai_response(query, context, language_key, user_name='Ijas'):
    lower = query.lower()
    currency = 'AED'

    if any(k in lower for k in ['emi', 'loan', 'installment']):
        return f"{user_name}, you have {context['active_emi_count']} active EMIs totaling {context['total_emi']:.2f} {currency}, with {context['emi_pending']:.2f} {currency} still pending. Focus on paying pending EMIs first to reduce your fixed commitments."

    if any(k in lower for k in ['debt', 'borrow', 'loan balance', 'outstanding debt']):
        return f"{user_name}, your outstanding debt is {context['outstanding_debt']:.2f} {currency}. Use the debt repayment slice and avoid new borrowing until the balance is lower."

    if any(k in lower for k in ['balance', 'net balance', 'cash', 'available']):
        return f"{user_name}, your current net balance is {context['net_balance']:.2f} {currency}. Total income is {context['total_income']:.2f}, expenses are {context['total_expenses']:.2f}, and pending EMIs are {context['emi_pending']:.2f}."

    if any(k in lower for k in ['savings', 'goal', 'save more', 'save']):
        goal_text = f"Your savings goal is {context['savings_goal']:.2f} {currency}." if context['savings_goal'] > 0 else "Keep building your savings consistently."
        return f"{user_name}, you have {context['total_savings']:.2f} {currency} in savings. {goal_text}"

    if any(k in lower for k in ['salary', 'income']):
        if context['income_profile']['saved']:
            return f"{user_name}, your verified monthly income is {context['income_profile']['monthly_income']:.2f} {currency}, with other income {context['income_profile']['other_income']:.2f} {currency}."
        return f"{user_name}, I do not have your saved salary profile. Save your income profile to get smarter recommendations."

    if any(k in lower for k in ['help', 'advice', 'suggest', 'recommend']):
        return f"{user_name}, based on your data, keep at least 20% of income for savings, cover EMI commitments first, and avoid extra discretionary spending until your net balance improves."

    if language_key == 'ml':
        return f"ഹായ് {user_name}, ഞാൻ നിങ്ങളുടെ zuooi Ai അസിസ്റ്റന്റ് ആണ്. നിലവിലെ സാമ്പത്തിക വിവരങ്ങൾ: വരുമാനം {context['total_income']:.2f} {currency}, ചിലവുകൾ {context['total_expenses']:.2f} {currency}, ഇ.എം.ഐ ബാക്കി {context['emi_pending']:.2f} {currency}, ബാക്കി {context['net_balance']:.2f} {currency}."

    return f"Hello {user_name}, I am zuooi Ai, your Gemini AI Assistant. Ask me anything about your finances, budget, or general questions in English or Malayalam."

@app.route('/api/ai-assistant', methods=['POST'])
@login_required
def ai_assistant():
    data = request.get_json() or {}
    query = (data.get('query') or data.get('message') or data.get('prompt') or '').strip()
    language_key = (data.get('language') or 'en').strip().lower()
    mode = data.get('mode', 'chat') # 'chat' or 'voice' / 'call'

    if not query:
        return jsonify({'error': 'No query provided'}), 400

    context = gather_financial_context()
    user_name = session.get('username', 'Ijas')

    response_text = None
    gemini_key = os.environ.get('GEMINI_API_KEY')

    if gemini_key:
        try:
            from google import genai
            client = genai.Client(api_key=gemini_key)
            lang_instr = "Respond in Malayalam (മലയാളം)" if language_key.startswith('ml') else "Respond in English"
            
            if mode in ['voice', 'call']:
                system_instructions = (
                    f"You are zuooi Ai, an intelligent live voice AI assistant and financial advisor for {user_name}. "
                    f"Language instruction: {lang_instr}. "
                    f"You are powered by Gemini with full conversational and general knowledge capabilities. "
                    f"You can answer ANY question, query, calculation, or real-world concept (both financial and general topics outside finance). "
                    f"Provide clear, direct, intelligent spoken answers in 1 to 3 clear sentences. Avoid repetition or canned responses. Do NOT use bullet points, symbols, markdown asterisks, or lists."
                )
            else:
                system_instructions = (
                    f"You are zuooi Ai, an advanced Gemini-powered AI Assistant and Financial Command Advisor for {user_name}. "
                    f"Language instruction: {lang_instr}. "
                    f"You have full intelligence and general knowledge to discuss ANY topic inside or outside the financial application. "
                    f"Answer every question uniquely and thoughtfully. When answering financial questions, use the app's financial context below. "
                    f"Format with clean markdown bolding key terms or numbers."
                )

            prompt_text = (
                f"{system_instructions}\n\n"
                f"App Financial Context:\n"
                f"- Total Income: {context['total_income']:.2f} AED\n"
                f"- Total Expenses: {context['total_expenses']:.2f} AED\n"
                f"- Total Savings: {context['total_savings']:.2f} AED (Goal: {context['savings_goal']:.2f} AED)\n"
                f"- Active EMIs: {context['active_emi_count']} with {context['emi_pending']:.2f} AED pending\n"
                f"- Outstanding Debt: {context['outstanding_debt']:.2f} AED\n"
                f"- Net Balance: {context['net_balance']:.2f} AED\n"
                f"- Monthly Salary Profile: {context['income_profile']['monthly_income']:.2f} AED\n\n"
                f"User Question: {query}"
            )

            models_to_try = [
                os.environ.get('GEMINI_MODEL', 'gemini-2.5-flash'),
                'gemini-2.0-flash',
                'gemini-1.5-flash',
                'gemini-1.5-pro'
            ]
            
            for mname in models_to_try:
                try:
                    res = client.models.generate_content(model=mname, contents=prompt_text)
                    if res and res.text:
                        response_text = res.text.strip()
                        break
                except Exception as ex_m:
                    print(f"[AI ASSISTANT] Model {mname} failed: {ex_m}")
                    continue
        except Exception as e:
            print(f"[AI ASSISTANT] Gemini call failed: {e}")

    if not response_text:
        response_text = local_ai_response(query, context, language_key, user_name)

    return jsonify({
        'response': response_text,
        'reply': response_text,
        'language': language_key,
        'mode': mode
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
    q = request.args.get('q', '').strip()
    if not q:
        return jsonify([])

    results = db.search_global(q)
    return jsonify(results)

@app.route('/api/settings', methods=['GET'])
@login_required
def get_settings_api():
    return jsonify(db.get_settings())

@app.route('/api/settings', methods=['POST'])
@login_required
def save_settings_api():
    data = request.get_json() or {}
    db.save_settings(data)
    return jsonify({'success': True})

@app.route('/api/branding', methods=['GET'])
def get_branding():
    settings = db.get_settings()
    return jsonify({
        'app_name': settings.get('app_name', 'AZRET MANAGE PLAN'),
        'logo_url': settings.get('logo_url', ''),
        'splash_video_url': settings.get('splash_video_url', '/static/video/enter_video_logo.mp4'),
        'theme_image_url': settings.get('theme_image_url', ''),
        'theme_video_url': settings.get('theme_video_url', '')
    })

@app.route('/api/logo', methods=['POST'])
@login_required
def upload_logo():
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    file = request.files['file']
    if file and allowed_file(file.filename, ALLOWED_IMAGE_EXTENSIONS):
        ext = file.filename.rsplit('.', 1)[1].lower()
        filename = f"logo.{ext}"
        filepath = os.path.join(UPLOAD_FOLDER, filename)
        file.save(filepath)

        logo_url = f"/static/uploads/{filename}?v={int(time.time())}"
        db.save_settings({'logo_url': logo_url})
        return jsonify({'success': True, 'logo_url': logo_url})

    return jsonify({'success': False, 'error': 'Invalid image file'}), 400

@app.route('/api/logo', methods=['DELETE'])
@login_required
def delete_logo():
    settings = db.get_settings()
    db.save_settings({'logo_url': ''})
    return jsonify({'success': True})

@app.route('/api/splash-video', methods=['POST'])
@login_required
def upload_splash_video():
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    file = request.files['file']
    if file and allowed_file(file.filename, ALLOWED_VIDEO_EXTENSIONS):
        ext = file.filename.rsplit('.', 1)[1].lower()
        filename = f"splash.{ext}"
        filepath = os.path.join(VIDEO_UPLOAD_FOLDER, filename)
        file.save(filepath)

        video_url = f"/static/uploads/video/{filename}?v={int(time.time())}"
        db.save_settings({'splash_video_url': video_url})
        return jsonify({'success': True, 'splash_video_url': video_url})

    return jsonify({'success': False, 'error': 'Invalid video file'}), 400

@app.route('/api/splash-video', methods=['DELETE'])
@login_required
def delete_splash_video():
    default_url = '/static/video/enter_video_logo.mp4'
    db.save_settings({'splash_video_url': default_url})
    return jsonify({'success': True, 'splash_video_url': default_url})

@app.route('/api/theme-image', methods=['POST'])
@login_required
def upload_theme_image():
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    file = request.files['file']
    if file and allowed_file(file.filename, ALLOWED_IMAGE_EXTENSIONS):
        ext = file.filename.rsplit('.', 1)[1].lower()
        filename = f"theme.{ext}"
        filepath = os.path.join(THEME_UPLOAD_FOLDER, filename)
        file.save(filepath)

        theme_url = f"/static/uploads/theme/{filename}?v={int(time.time())}"
        db.save_settings({'theme_image_url': theme_url})
        return jsonify({'success': True, 'theme_image_url': theme_url})

    return jsonify({'success': False, 'error': 'Invalid image file'}), 400

@app.route('/api/theme-image', methods=['DELETE'])
@login_required
def delete_theme_image():
    db.save_settings({'theme_image_url': ''})
    return jsonify({'success': True})

@app.route('/api/theme-video', methods=['POST'])
@login_required
def upload_theme_video():
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    file = request.files['file']
    if file and allowed_file(file.filename, ALLOWED_VIDEO_EXTENSIONS):
        ext = file.filename.rsplit('.', 1)[1].lower()
        filename = f"theme.{ext}"
        filepath = os.path.join(THEME_VIDEO_UPLOAD_FOLDER, filename)
        file.save(filepath)

        theme_video_url = f"/static/uploads/theme_video/{filename}?v={int(time.time())}"
        db.save_settings({'theme_video_url': theme_video_url})
        return jsonify({'success': True, 'theme_video_url': theme_video_url})

    return jsonify({'success': False, 'error': 'Invalid video file'}), 400

@app.route('/api/theme-video', methods=['DELETE'])
@login_required
def delete_theme_video():
    db.save_settings({'theme_video_url': ''})
    return jsonify({'success': True})

@app.route('/api/export', methods=['GET'])
@login_required
def export_data():
    dump = {}
    for table in TABLE_CONFIGS:
        dump[table] = db.fetch_all(table)
    dump['settings'] = db.get_settings()

    filename = f"azret_export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    buf = io.BytesIO(json.dumps(dump, indent=2).encode('utf-8'))
    return send_file(buf, mimetype='application/json', as_attachment=True, download_name=filename)

@app.route('/api/import', methods=['POST'])
@login_required
def import_data():
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    file = request.files['file']
    try:
        content = json.loads(file.read().decode('utf-8'))
        for table in TABLE_CONFIGS:
            if table in content and isinstance(content[table], list):
                for rec in content[table]:
                    rec_copy = dict(rec)
                    rec_copy.pop('id', None)
                    if rec_copy:
                        db.insert_record(table, rec_copy)

        if 'settings' in content and isinstance(content['settings'], dict):
            db.save_settings(content['settings'])

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': 'Invalid JSON file'}), 400

@app.route('/api/clear-all-data', methods=['POST'])
@login_required
def clear_all_data_api():
    data = request.get_json() or {}
    if data.get('confirm') != 'DELETE':
        return jsonify({'success': False, 'error': 'Confirmation text mismatch'}), 400

    db.clear_all_data()
    return jsonify({'success': True})

@app.route('/api/advice', methods=['GET'])
@login_required
def get_advice():
    dash = db.get_dashboard_data()
    income = dash['total_income']
    expenses = dash['total_expenses']
    savings = dash['total_savings']
    outstanding = dash['outstanding_debt']

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT category, COALESCE(SUM(amount),0) as t FROM expenses GROUP BY category ORDER BY t DESC LIMIT 1")
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
        tips.append(f"You have AED {outstanding:,.2f} in outstanding debt. Prioritise clearing high-interest amounts first.")
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
    except ValueError:
        monthly_income = 0.0

    if monthly_income <= 0:
        return jsonify({'error': 'Enter a valid verified monthly income to save your profile'}), 400

    def get_f(key):
        try:
            return max(0.0, float(data.get(key, 0)))
        except ValueError:
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

    db.save_settings(values)
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
    except ValueError:
        override_salary = 0.0

    verified_income = profile['total_verified_income']
    salary = override_salary if override_salary > 0 else verified_income
    is_projection = override_salary > 0 and abs(override_salary - verified_income) > 0.01

    if salary <= 0:
        return jsonify({'error': 'Enter a valid salary amount'}), 400

    conn = db.get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COALESCE(SUM(monthly_payment),0) FROM emi WHERE COALESCE(amount,0) - COALESCE(paid,0) > 0")
    emi_monthly = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(monthly_payment),0) FROM debts WHERE COALESCE(total_amount,0) - COALESCE(paid_amount,0) > 0")
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

    dash = db.get_dashboard_data()
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

    suggestions = [
        f"Verified monthly income on file: AED {verified_income:,.2f}"
    ]
    if is_projection:
        suggestions.append(f"This plan is a what-if projection using AED {salary:,.2f} instead of your verified income.")

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

    cursor.execute("SELECT COALESCE(SUM(amount),0) FROM income WHERE date LIKE ?", (date_filter,))
    income = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE date LIKE ?", (date_filter,))
    expenses = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(amount),0) FROM savings WHERE date LIKE ?", (date_filter,))
    savings = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(amount),0) FROM family_transfers WHERE date LIKE ?", (date_filter,))
    family = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(paid),0) FROM emi WHERE date LIKE ?", (date_filter,))
    emi_paid = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(total_amount - paid_amount),0) FROM debts")
    debt_out = cursor.fetchone()[0]
    conn.close()

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font('Arial', 'B', 16)
    pdf.cell(0, 10, 'AZRET MANAGE PLAN', 0, 1, 'C')
    pdf.set_font('Arial', '', 12)
    pdf.cell(0, 8, f"{kind.upper()} REPORT - {label}", 0, 1, 'C')
    pdf.ln(10)

    pdf.set_font('Arial', '', 11)
    pdf.cell(0, 8, f"Total Income: AED {income:,.2f}", 0, 1)
    pdf.cell(0, 8, f"Total Expenses: AED {expenses:,.2f}", 0, 1)
    pdf.cell(0, 8, f"Total Savings: AED {savings:,.2f}", 0, 1)
    pdf.cell(0, 8, f"Family Transfers: AED {family:,.2f}", 0, 1)
    pdf.cell(0, 8, f"EMI Paid: AED {emi_paid:,.2f}", 0, 1)
    pdf.cell(0, 8, f"Outstanding Debt: AED {debt_out:,.2f}", 0, 1)
    pdf.cell(0, 8, f"Net Balance: AED {income - expenses - family - emi_paid:,.2f}", 0, 1)

    filename = f"AZRET_{kind}_report_{now.strftime('%Y%m%d')}.pdf"
    output = io.BytesIO(pdf.output(dest='S').encode('latin1'))

    return send_file(output, mimetype='application/pdf', as_attachment=True, download_name=filename)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    app.run(host='0.0.0.0', port=port, debug=False)

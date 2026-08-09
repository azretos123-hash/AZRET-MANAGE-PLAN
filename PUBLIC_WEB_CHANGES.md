# AZRET MANAGE PLAN — Public Multi-User Build

This build converts the original single-user Flask finance website into a public multi-user application while preserving the existing dashboard and finance modules.

## Completed

- Public Sign In / Create Account page
- Secure password hashing using Werkzeug
- Unique username and email accounts
- Server-side session authentication
- Per-user data ownership for Income, Expenses, Savings, Family Transfer, EMI, Debt, Notes, Shopping, EMI payments, Debt payments and Settings
- User-scoped Dashboard, Search, Reports, Export, Import, Backup/Clear Data and Smart Salary logic
- IDOR protection by checking both record id and authenticated user_id
- SQLite support for local development
- Neon/PostgreSQL support through `DATABASE_URL` for production
- Safe legacy migration: old single-user records are assigned to the original/first account instead of being deleted or exposed to new users
- Render Blueprint (`render.yaml`) and `/health` database health endpoint
- Production cookie/security headers and ProxyFix for Render

## Production environment variables

Set these on Render:

- `DATABASE_URL` — Neon PostgreSQL connection string
- `SECRET_KEY` — long random secret
- `SESSION_COOKIE_SECURE=1`
- `GEMINI_API_KEY` — only if AI Assistant is used
- `GEMINI_MODEL` — optional

Never commit real credentials to GitHub.

## Render commands

Build: `pip install -r requirements.txt`

Start: `gunicorn app:app`

Health check: `/health`

## Important migration behavior

The app does not intentionally drop finance tables on startup. If an old single-user database already contains records without `user_id`, those records are claimed by the existing first account. If no account exists yet, the records remain unassigned until the first account is created, then that first account claims them. New accounts receive clean private data.

## Local use

When `DATABASE_URL` is not set, the app uses SQLite (`database.db` by default). This keeps local VS Code testing simple. Production should use Neon/PostgreSQL so finance records survive Render restarts/redeploys.

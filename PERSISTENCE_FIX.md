# Persistence Fix

This build fixes the most likely cause of records disappearing on Render: accidental use of SQLite on Render's ephemeral filesystem.

Changes:
- Render now requires `DATABASE_URL` for Neon/PostgreSQL.
- Invalid/non-PostgreSQL `DATABASE_URL` is rejected.
- SQLite remains available only for local development.
- `/health` exposes the active storage backend without exposing credentials.
- Database initialization remains non-destructive and does not reset finance tables.
- No timed cleanup/24-hour deletion logic exists for financial records.

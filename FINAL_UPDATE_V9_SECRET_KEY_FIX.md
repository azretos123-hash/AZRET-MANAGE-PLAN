# AZRET Manage Plan V9 - Render SECRET_KEY deployment fix

## What changed

- Existing Render web services no longer crash when `SECRET_KEY` was not manually added.
- `SECRET_KEY` / `AZRET_SECRET_KEY` environment variables are still preferred when present.
- If neither is present in production and Neon/PostgreSQL is configured, the app creates one strong random Flask session secret once and stores it in the persistent `system_config` table in Neon.
- The same secret is reused across Render restarts and redeploys, so login sessions remain cryptographically stable.
- Local SQLite development keeps the existing local-development fallback.
- The existing hard guard requiring Neon/PostgreSQL on Render remains unchanged, so finance data cannot silently fall back to ephemeral SQLite.

## Current Render requirement

`DATABASE_URL` must still point to Neon/PostgreSQL. `GEMINI_API_KEY` is required for Gemini features.

`SECRET_KEY` is now optional for an already-created Render service because the app can persistently bootstrap it from Neon. You can still set a manual `SECRET_KEY` in Render if desired.

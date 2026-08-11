# AZRET Manage Plan — Persistent Render + Neon Deployment

## Why old data could disappear
Render web-service storage is ephemeral. If the app uses a local SQLite file on Render, that file can be lost when the service restarts or redeploys. This can look like records are being automatically deleted after a day.

## Fix built into this project
Production on Render now **refuses to start without Neon/PostgreSQL**. There is no silent SQLite fallback on Render. Local VS Code testing can still use SQLite. No scheduled job or automatic cleanup deletes finance records.

## Render environment variables
Set these in Render > Service > Environment:

- `DATABASE_URL` = your Neon PostgreSQL connection string (required)
- `SECRET_KEY` = a long random secret (required)
- `SESSION_COOKIE_SECURE` = `1`
- `GEMINI_API_KEY` = optional, only if the AI feature is used

Keep the Neon SSL parameters from the connection string. Never place the real DATABASE_URL or SECRET_KEY in GitHub.

## Verify persistence
After deploy, open `/health`. A correct production deployment should report:

```json
{
  "status": "ok",
  "backend": "postgresql",
  "persistent_for_render": true,
  "database_url_configured": true
}
```

Then register/login, add a test Income record, wait/restart/redeploy the Render service, and confirm the record remains.

## Important
Do not create a new Neon database on every deploy. Keep the same Neon project/database and the same `DATABASE_URL`. Changing `DATABASE_URL` points the app at a different database and the old records will not appear.

## V9 note: SECRET_KEY on an existing Render service

The application no longer fails startup when an existing manually-created Render service does not have `SECRET_KEY` configured. If `DATABASE_URL` is a working Neon/PostgreSQL URL, the app generates a strong secret once and persists it in Neon (`system_config`). An explicit Render `SECRET_KEY` still takes priority when configured.

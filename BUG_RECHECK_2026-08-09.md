# Bug Recheck — 2026-08-09

Fixed during recheck:

- Added missing `/manifest.json` Flask route.
- Added missing `/service-worker.js` Flask route.
- Reworked service-worker caching so login/dashboard HTML and API responses are never cached.
- Removed cache-first behavior for authenticated navigation to prevent stale login/dashboard screens after login/logout.
- Bumped service-worker cache version so old cached shell is replaced.
- Service worker now ignores third-party online wallpaper requests.
- Python syntax check passed for `app.py` and `database.py`.
- JavaScript syntax check passed for `static/js/app.js`, `static/js/charts.js`, and `static/service-worker.js`.
- Confirmed protected API routes use `login_required` except intentionally public auth/branding/health routes.
- Confirmed finance CRUD/database queries are scoped by authenticated `user_id` in the inspected code.

Production persistence reminder:

- On Render, `DATABASE_URL` must point to Neon/PostgreSQL. The app intentionally refuses to start on Render without PostgreSQL to avoid ephemeral SQLite data loss.

Note: full live Flask/Neon integration tests were not executed in this build environment because the Python runtime here does not have the project dependencies available for installation. Static/syntax/security-route checks were completed.

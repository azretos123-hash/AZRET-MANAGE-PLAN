# YARIN V60 — Deep Audit

V60 is a code-level and isolated runtime regression pass based on V59.

Key corrections in this pass:
- Removed invented/stale hard-coded AED→INR defaults from new accounts.
- Browser localStorage FX quotes are no longer trusted for financial conversion; only live/server-persisted verified rates are used.
- Missing FX no longer renders editable finance amounts as 0 or writes a false converted 0.00 auto-note.
- Monthly available balance now includes same-month family transfers and logged EMI/debt repayments.
- Six-month Savings Growth now includes the opening savings balance from earlier months.
- Backup import restores validated `fx_rate_<CODE>` and rate-date settings and rejects invalid/fake rates.
- Password reset DB writes are transactional and reset-code history is capped per user.
- Registration defaults to a browser-session login; the 30-day session is reserved for explicit Remember Me sign-in.
- Document Vault uses monotonic numeric IDs to avoid rapid-upload collisions.
- Gold Saver invalid imported date strings are sanitized and rendered safely.
- Process-local rate-limit and FX caches are bounded to avoid long-running public-worker memory growth.
- Cache/version references synchronized to V60.

Verification performed:
- Python compile: app.py, database.py
- Node syntax: app.js, charts.js
- CSS parse and HTML duplicate-ID checks
- User-isolated SQLite CRUD/dashboard/payment/settings/reset lifecycle regression
- App route stubs for register/login/settings/CRUD/payments/finance suite/password reset/import
- Monthly cash-flow + savings opening-balance regression
- Password-reset history cap regression
- Dynamic FX backup-import validation regression
- Static route/navigation and secret scans
- ZIP integrity test

External provider availability (Neon, Brevo, Gemini, Frankfurter, Gold API) still depends on live credentials/network/provider status and cannot be guaranteed by an offline source audit.

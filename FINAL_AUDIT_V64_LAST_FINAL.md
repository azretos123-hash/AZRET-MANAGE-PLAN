# YARIN V64 — Last Final Deep Audit

Base: V63 Currency Flag Shade
Date: 2026-08-14

## Real issues fixed in this pass
- Fixed rapid currency-switch flag transition race on the salary countdown card.
- Added live-gold fallback when Gemini is temporarily unavailable, and corrected provider labeling.
- Cached Gemini model discovery and capped fallback attempts to prevent long AI stalls/timeouts during provider trouble.
- Reduced Gemini REST fallback timeout and retained current stable Flash model preference.
- Made JSON backup import transactional so unexpected DB failures roll back the whole restore instead of leaving partial rows/settings.
- Added optional shared DB-connection support to record/settings helpers for atomic restore operations.
- Quarantined legacy single-user settings under owner 0 until an explicitly configured legacy owner identity matches; fixed username-only legacy-owner claiming.
- Removed the hourly third-party dashboard wallpaper request and kept the local premium gradient fallback to reduce mobile network/paint work.
- Removed dead legacy browser-direct FX code so currency conversion continues to rely on YARIN server-verified rates.
- Synchronized cache/static versions to V64.

## Regression checks
- Python AST / py_compile: pass
- JavaScript syntax (app.js, charts.js, service-worker.js): pass
- JSON parse (package, manifest, metadata): pass
- Duplicate HTML IDs: 0
- Sidebar page targets: all 22 targets exist
- Frontend API references: no missing backend routes found
- CSS brace integrity: pass
- Static PWA assets referenced by service worker: present
- Secret-pattern scan: no embedded API keys found (example DB URL placeholder excluded)
- SQLite transaction helper rollback/commit: pass
- Legacy settings quarantine: pass
- Multi-user dashboard isolation: pass
- Monthly family/EMI/debt cash-flow calculation: pass
- Clear-all account isolation: pass

## External dependencies
Live Gemini, Brevo, Neon, Frankfurter and gold-provider availability/credentials are external runtime dependencies and cannot be guaranteed by static source audit alone.

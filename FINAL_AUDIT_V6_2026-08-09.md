# AZRET Manage Plan — Final Audit V6 (2026-08-09)

This pass re-audited the V5 project with code scans, syntax checks, SQLite multi-user isolation checks, and current official documentation for Flask security/session cookies, Render Flask deployment, Neon connection pooling, and Gemini API usage/rate limits.

## Fixes added in V6

- Prevent authenticated HTML/API responses from being cached by browsers/shared proxies (`Cache-Control: no-store, private`).
- Force secure session cookies automatically on Render, even if the optional flag is omitted manually.
- Return authenticated `user_id` in `/api/profile` and namespace the 27th-day salary reminder per account. Previously two users sharing one browser could share the same local reminder state.
- Move salary reminder initialization until after the profile is loaded.
- Add email-length validation to profile email updates.
- Add server-side date/time validation so malformed dates cannot silently disappear from reports and filters.
- Add text-length and numeric upper-bound validation to reduce public API/database abuse and accidental overflow.
- Apply the same validation to imports and payment history entries.
- Add payment date/time/notes validation.
- Correct Gemini financial context: `total_debt` and `debt_paid` now come from real database aggregates instead of the legacy approximation (`outstanding_debt + net_balance`) / hard-coded zero.
- Add `total_debt` and `debt_paid` to dashboard backend data.
- Limit global-search query length.
- Bump service-worker cache version so deployed clients pick up the corrected JavaScript.

## Checks performed

- Python syntax: PASS
- JavaScript syntax: PASS
- Static/PWA required files: PASS
- Secret-pattern scan: PASS
- Authenticated-route decorator audit: PASS
- User-scoped CRUD query review: PASS
- SQLite User A / User B dashboard isolation: PASS
- Dashboard debt aggregates: PASS
- Service-worker private API/navigation cache policy: PASS
- Gemini current model/API documentation cross-check: PASS
- Render/Neon deployment architecture cross-check: PASS

## Production note

A code audit cannot simulate the real Render network, Neon credentials/quota, browser microphone permissions, or the live Gemini API. After deployment, run a short smoke test with real environment variables.

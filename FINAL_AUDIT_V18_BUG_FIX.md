# RIZQ V18 — Bug Fix Audit

Date: 2026-08-11

Concrete fixes in this build:

1. Fixed legacy settings migration startup failure. Older single-user databases whose `settings` table has no `user_id` are now migrated before any code tries to update `settings.user_id`.
2. Fixed record-edit validation mismatch. PUT/edit requests now enforce the same maximum finance-value limit as create requests.
3. Fixed required-field bypass on record edits. API clients can no longer blank required fields on an existing record by bypassing browser validation.
4. Hardened backup import settings. Only supported settings are imported; currency codes, dual-currency consistency, salary-credit day, and numeric finance settings are validated before save.
5. Limited global-search query length to reduce accidental/abusive oversized searches.
6. Updated export filename branding from `azret_export_...` to `rizq_export_...`.

Verification performed:

- Python compile: PASS
- JavaScript syntax: PASS
- Python AST parse: PASS
- Duplicate HTML IDs: PASS (none)
- Static template asset references: PASS
- Manifest JSON parse: PASS
- Legacy settings migration test with SQLite: PASS
- Two-user CRUD isolation test with SQLite: PASS
- ZIP integrity: PASS

Production-only checks still require the real Render + Neon + Gemini environment because those external services cannot be fully simulated offline.

# YARIN V53 — All Bug Fix / Regression Audit

Date: 2026-08-13

## Major fixes in V53

- Replaced the broken Gold Saver Chart.js assumption with the project's built-in offline `AzretCharts` engine.
- Fixed persisted Gold Saver country selection and strengthened Gold input validation.
- Corrected dashboard monthly savings to use real Savings records; added a separate monthly available balance.
- Included debt repayments in cash/net-balance reporting and hardened EMI/Debt payment-ledger consistency.
- Fixed salary-day 31 behavior for February/short months and same-day salary countdown/reminders.
- Added server-backed, user-scoped sync for Calendar, Net Worth, Goals, Bills and Gold Saver data.
- Added finance-suite data to backup/export/import, with merge, size, numeric, date and currency validation.
- Added a deterministic currency whitelist matching the FX provider's published currency-code set, preventing malformed backup codes from entering finance-suite state.
- Made cross-currency suite calculations fail closed when an FX rate is unavailable instead of silently treating currencies as 1:1.
- Fixed Clear All so server finance data, suite state, AI history, finance-profile values and local Document Vault records are actually cleared without stale sync races.
- Fixed Document Vault IndexedDB connection lifecycle so clear/delete operations are not blocked by leaked connections.
- Fixed backup/export sync timing so the latest suite edits are flushed first; import/clear now pause stale pushes and force a remote rehydrate after success.
- Updated browser asset cache/version to V53 (`package.json` 1.0.53, asset `?v=53`, Service Worker cache v53).

## Verification completed

- Python syntax compile: PASS
- JavaScript syntax (`app.js`, `charts.js`, Service Worker): PASS
- Inline template JavaScript syntax: PASS
- JSON files: PASS
- Duplicate HTML IDs: 0
- Sidebar page targets: PASS
- Direct DOM listener targets: PASS
- Client/server API route static match: PASS
- CSS brace/structure check: PASS
- PWA manifest icon files: PASS
- Dashboard + Clear All isolated SQLite unit test: PASS
- Finance-suite sanitizer/merge test: PASS
- Final ZIP integrity test: performed after packaging

External providers (hosting, email, Gemini, Gold/FX network availability) still depend on live credentials/network/provider availability; V53 hardens the application-side failure paths.

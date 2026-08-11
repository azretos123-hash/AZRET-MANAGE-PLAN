# RIZQ V20 — Small Bug Recheck

Fixed after another source-level audit:

- Local-date bug: form defaults and salary-day reminder now use the browser's local calendar date instead of UTC `toISOString()`, preventing a previous-day date around midnight in positive time zones.
- Dynamic dual-currency bug: EMI/Debt edit/reset/payment forms no longer force AED when the user's configured pair does not include AED.
- Stale entry-currency bug: per-field currency state is normalized to the currently configured pair.
- Registration cleanup: removed an unreachable duplicate validation return.
- Service-worker cache bumped to V20 so devices do not keep the previous JavaScript after deployment.

Checks run: Python compile, JavaScript syntax, JSON manifest parsing, duplicate HTML id scan, static-reference scan, ZIP integrity.

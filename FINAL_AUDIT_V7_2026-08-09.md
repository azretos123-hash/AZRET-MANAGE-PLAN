# AZRET Manage Plan — Final Audit V7 (2026-08-09)

This pass rechecked authentication, multi-user isolation, persistence, Gemini chat, PWA caching, input validation, backup/import, and deployment assumptions.

## Additional fixes in V7

- Prevented a security/data-leak edge case where the first arbitrary public registrant could inherit quarantined legacy single-user records. Legacy records are now claimed only when the first registering account matches `LEGACY_OWNER_EMAIL` (and, if set, `LEGACY_OWNER_USERNAME`). Otherwise legacy rows remain quarantined instead of being exposed.
- Added one short retry for transient Gemini 429/5xx/high-demand failures before falling through to the next configured model. Authentication/configuration failures are not repeatedly retried.
- Bumped the service-worker cache version so clients receive the audited frontend after deployment.
- Kept Render production persistence guard: production refuses to run on ephemeral SQLite and requires PostgreSQL/Neon.

## Verification performed

- `python3 -m py_compile app.py database.py`
- `node --check static/js/app.js`
- `node --check static/js/charts.js`
- Multi-user SQLite isolation smoke test
- Legacy-data ownership/quarantine smoke test
- Protected-route static audit
- PWA cache policy review
- ZIP integrity test

Production-only items such as the real Render network, Neon credentials, Gemini quota/API key and browser microphone permissions still require a short smoke test after deployment.

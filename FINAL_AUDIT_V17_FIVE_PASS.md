# RIZQ V17 — Five-pass pre-deploy audit

1. **Syntax / structure:** Python + JavaScript + JSON checked; legacy duplicate JS function declarations neutralized so V16/V17 currency logic is the single active implementation.
2. **Security / multi-user:** legacy NULL-owned finance rows are no longer auto-assigned to the first/lowest-id account; they are claimable only by configured `LEGACY_OWNER_EMAIL` / `LEGACY_OWNER_USERNAME`. Removed branding upload endpoints now return 410.
3. **Currency / FX:** resulting primary/secondary pair is validated even on partial settings updates; default currency must belong to that pair. Frankfurter v2 rate/time-series endpoint usage checked against current official docs.
4. **Azret AI / Gemini:** stable low-latency `gemini-3.5-flash-lite` remains first; fallbacks remain. Multi-turn user/model history, per-user history storage, finance-context gating, rate limiting, and no-canned-general-fallback behavior rechecked.
5. **UI / PWA / persistence:** service-worker cache bumped, private/API navigation stays network-only, hourly wallpaper fallback/recovery hardened, Render production still refuses ephemeral SQLite and requires PostgreSQL/Neon.

A source audit cannot simulate production-only API quota, browser microphone support, Neon network outages, or Render runtime behavior. Run a short production smoke test after deploy.

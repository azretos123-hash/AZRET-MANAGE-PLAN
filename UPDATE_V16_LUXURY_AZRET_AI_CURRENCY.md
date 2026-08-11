# RIZQ V16 — Luxury Dashboard / Azret AI / Dual Currency

This release consolidates the requested visual and functional redesign without
removing the existing finance modules or multi-user isolation.

## Included

- Luxury glass/gold/navy dashboard visual system and premium typography.
- Larger greeting and live time display.
- Online dashboard wallpaper that changes on the hour with preload/fallback.
- Sidebar order: Calculator → Notes → Reports → Settings → About.
- Primary + Secondary Currency settings with searchable server-supplied currency
  catalog and per-user persistence.
- Dynamic currency switch and generic AED-base conversion layer so existing
  canonical records are not relabelled/corrupted.
- Reference FX trend card with 7D/1M/3M/1Y ranges and cached server proxy.
- Azret AI as the visible assistant name, with dashboard avatar launcher and
  floating Live AI window.
- Avatar visual states: greeting, listening, thinking and speaking, plus idle
  breathing/blink/ring effects and responsive mobile presentation.
- Faster AI model preference: Gemini 3.5 Flash-Lite first, short recent history,
  smaller voice responses and quick fallback model sequence.
- Warm, lightly playful assistant personality while keeping financial accuracy
  and user-data privacy first.
- Existing Neon persistence, CSRF protection, PWA safe caching, salary date,
  reports, backups and user-isolated data preserved.

## Validation performed

- Python source compilation for `app.py` and `database.py`.
- JavaScript syntax validation with Node.
- HTML duplicate-ID scan.
- Static checks for removed Voice Summary/settings branding controls.
- Service-worker cache version bumped for this release.

A final Render smoke test with the real Neon URL and Gemini key is still needed
because external credentials/network behavior cannot be fully reproduced by a
static source audit.

# YARIN V47 final recheck

- Rechecked Python/JS/JSON/HTML/static references.
- Fixed Render Gemini default mismatch: production now defaults to gemini-3.5-flash, which has an official free tier.
- Disabled local AI fallback in Render so provider failures are not disguised as Gemini answers.
- Filtered discovered Gemini models to exclude image/live/preview models from text chat fallback.
- REST Gemini failures now feed the real HTTP status/body into safe diagnostic hints.
- Synchronized .env.example and render.yaml model defaults.
- Bumped service worker cache to V47.

# RIZQ V33 — last-pass reliability audit

Changes made after re-auditing V32:

- Optimized the Azret AI avatar from a 1024×1536 ~2.35 MB PNG to a 512×768 WebP. This reduces dashboard/AI-window load and image decode cost without changing the UI concept.
- Added global handling for an expired authenticated session: same-origin API 401 responses now return the user to the login page instead of cascading into widget/render errors.
- Hardened generic table loading so non-2xx or malformed API responses are not treated as record arrays.
- Bumped app.js cache-buster and service-worker cache to V33 and updated the avatar cache reference.

Validation performed:

- Python compileall
- JavaScript syntax (`node --check`)
- JSON parsing
- duplicate HTML ID scan
- duplicate Flask route scan
- missing static-reference scan
- old screenshot/mockup asset reference scan
- ZIP CRC integrity test

Known external/runtime limitations remain: Render/Neon availability, Gemini API quota/network latency, browser microphone/SpeechRecognition/TTS availability, and secure email-based password recovery (no mail provider is configured in this project).

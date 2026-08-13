# YARIN V46 audit

- Gemini REST authentication updated to current `x-goog-api-key` header.
- Gemini model discovery uses the same current authentication pattern.
- REST fallback now carries recent conversation history instead of dropping context.
- Stable model order retained with Gemini 3.6 Flash / 3.5 Flash-Lite fallbacks.
- Password reset UI now shows explicit Email → OTP → Password progress.
- Brevo provider hints/status are surfaced in the reset UI when sending fails.
- Mobile sidebar now keeps the main Sign Out control outside the scrolling nav so it remains reachable.
- YARIN / يارين login typography refined to a premium serif pairing.
- Dubai night background now uses the direct Wikimedia image URL instead of a redirect URL.
- Cache/service-worker bumped to V46.

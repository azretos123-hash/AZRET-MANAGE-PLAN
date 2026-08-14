# YARIN V59 — Password Reset + Browser Viewport Fit

- Added tolerant secret parsing so accidental wrapping quotes in Render environment values do not invalidate Brevo credentials.
- Password reset prefers Brevo REST API and optionally falls back to Brevo SMTP relay when `BREVO_SMTP_LOGIN` and `BREVO_SMTP_KEY` are configured.
- Improved 401/403 diagnostics without exposing secrets.
- Added compact desktop browser-height breakpoints so login/register and reset-password UI fit Chrome/Edge viewports with less vertical space.
- Password reset dialog now has a viewport-bounded max height and safe internal scrolling.
- Mobile reset dialog remains compact and touch friendly.
- PWA standalone behavior is preserved.
- Static cache bumped to V59.

# AZRET MANAGE PLAN — V10 Settings Update

Changes requested and applied:

- Removed Custom Logo controls from Settings.
- Removed Splash Screen Video controls from Settings and login/register now open the dashboard directly instead of the splash route.
- Removed Dashboard Background Image/Video wallpaper controls from Settings.
- Existing per-user custom branding/background assets are no longer applied by `/api/branding`; the standard AZRET branding is used.
- Kept Light/Dark theme and Default Currency controls.
- Added a per-user **Salary Credit Date** setting (day 1–31).
- Dashboard salary countdown now uses each signed-in user's own salary day.
- Monthly salary reminder now uses each user's configured salary day instead of a fixed 27th.
- For months shorter than the selected day (for example day 31 in February), the month's last day is used automatically.
- Removed the Dashboard **AI Voice Assistant / EN / ML / Speak Summary** card.
- The separate Gemini AI chat/live assistant remains available.
- Service-worker cache version bumped so the updated JS/HTML is not mixed with older cached assets after deployment.

Validation performed:
- `python3 -m py_compile app.py database.py` passed.
- `node --check static/js/app.js` passed.
- Removed-settings DOM IDs were checked so `setupSettingsPage()` no longer references missing controls.

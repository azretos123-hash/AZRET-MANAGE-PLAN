# YARIN يارين

**Your Money. Your Future.**  
**Tomorrow Starts Today.**

YARIN is a public, multi-user personal finance web application built with Flask,
vanilla JavaScript and persistent PostgreSQL/Neon storage for production. Each
account has isolated finance records and its own salary date, theme and
primary/secondary display currencies.

## Current experience

- Premium responsive finance dashboard for desktop/ChromeOS and mobile.
- Public registration/login with private user-isolated data.
- Email OTP password reset through Brevo transactional email.
- Income, Expenses, Savings, Family Transfer, EMI, Debt, Shopping, Notes,
  Salary Planner, Calculators, Search, Reports/PDF, Backup/Import and Settings.
- Selectable primary + secondary currency pair with dashboard and form updates.
- Exchange-rate trend views and salary countdown.
- Azret AI chat + voice assistant with finance-aware context.
- Official YARIN emblem, animated login/splash, dark/light mode and PWA.

## Production architecture

`GitHub → Render → Flask/Gunicorn → Neon PostgreSQL`

Production requires `DATABASE_URL`. Gemini requires `GEMINI_API_KEY`. Password
reset email requires `BREVO_SENDER_EMAIL` plus either `BREVO_API_KEY` (preferred)
or the optional Brevo SMTP fallback pair `BREVO_SMTP_LOGIN` + `BREVO_SMTP_KEY`.
`BREVO_SENDER_NAME` is optional. Never commit real secrets to the repository.

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

Local development can use SQLite. Production intentionally refuses SQLite on
Render to prevent data loss from the ephemeral filesystem.

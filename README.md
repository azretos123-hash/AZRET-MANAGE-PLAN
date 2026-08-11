# Rizq رزق — Growth نمو

**Plan • Manage • Grow · خطّط • أدر • نمُ**  
**A Smarter Financial Life · لحياة مالية أذكى**

Rizq is a public, multi-user personal finance web application built with Flask,
vanilla JavaScript and persistent PostgreSQL/Neon storage for production.
Each account has isolated finance records and its own salary date, theme and
primary/secondary display currencies.

## Current experience

- Premium responsive finance dashboard for desktop/ChromeOS and mobile.
- Public registration/login with private user-isolated data.
- Income, Expenses, Savings, Family Transfer, EMI, Debt, Shopping, Notes,
  Salary Planner, Calculators, Search, Reports/PDF, Backup/Import and Settings.
- Selectable **Primary + Secondary Currency** pair; the top switch, forms,
  dashboard values, calculators and reference exchange chart follow the pair.
- Dashboard **exchange-rate trend** with 7D / 1M / 3M / 1Y views.
- Per-user **Salary Credit Date** and salary countdown.
- **Azret AI** chat + voice assistant with English/Malayalam, conversation
  history, finance-aware context and a responsive animated avatar experience.
- Premium bilingual Rizq branding, splash animation, dark/light mode and PWA.
- Hourly online dashboard wallpaper with a safe gradient fallback.

## Production architecture

`GitHub → Render → Flask/Gunicorn → Neon PostgreSQL`

Render production requires `DATABASE_URL` (Neon) and `GEMINI_API_KEY`. A
`SECRET_KEY` can be supplied explicitly; if omitted in production, the app can
persist a generated secret in the PostgreSQL system config. Never commit real
secrets to the repository.

## Run locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

Local development can use SQLite. Production intentionally refuses SQLite on
Render to prevent data loss from the ephemeral filesystem.

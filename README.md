# AZRET MANAGE PLAN

A private, premium personal finance management web app — built with
Flask, SQLite, vanilla JS and a blue/white glassmorphism dashboard.
Designed to run **entirely on your own device** (including Chromebook
Linux / Chrome), with no cloud account and no data leaving your machine.

---

## ✨ Features

- Password-protected login (local only, no cloud account)
- Dashboard with live-updating stats, animated canvas charts (no external
  chart library needed — fully offline), AED ⇄ INR currency switch and a
  live exchange-rate lookup with manual refresh
- Full CRUD modules: **Income, Expenses, Savings, Family Transfer, EMI,
  Debt/Outstanding, Notes** — each with search, edit, delete and running
  totals
- **Smart Salary Planner (EMI & Income-Aware)**: save a one-time **Income &
  Commitment Profile** (verified monthly income, other income, and any
  fixed EMI/debt not already tracked elsewhere) — the Smart Plan is
  **gated** and only generates once that profile is saved. Every plan then
  re-analyzes your live EMI pending balance, outstanding debt, and the
  profile's declared commitments before suggesting an allocation, and
  surfaces a numeric **Budget Health Score (0-100)**, a standalone canvas
  pie chart for the category breakdown, a second pie chart for
  **Income vs Commitments**, and **AI-style Smart Advice** written around
  your actual numbers
- **Reports**: Monthly / Yearly / Complete PDF reports generated on demand
- **Calculators**: simple calculator, AED↔INR converter, savings
  projector, EMI calculator
- **About** page with automatic financial-health tips based on your data
- **Settings**: light/dark mode, default currency, backup/export/import,
  clear-all-data, password change
- Installable **Progressive Web App** with offline app-shell caching
- Responsive layout — desktop, laptop and Chromebook screens

---

## 🗂 Project Structure

```
azret_manage_plan/
├── app.py                  # Flask application & all API routes
├── database.py              # SQLite schema + connection helper
├── requirements.txt
├── README.md
├── instance/
│   └── azret.db              # created automatically on first run
├── static/
│   ├── css/style.css
│   ├── js/app.js              # SPA logic (navigation, CRUD, calculators…)
│   ├── js/charts.js           # dependency-free canvas chart engine
│   ├── icons/icon-192.png
│   ├── icons/icon-512.png
│   ├── manifest.json          # PWA manifest
│   └── service-worker.js      # PWA offline app-shell cache
└── templates/
    ├── login.html
    └── index.html             # main single-page dashboard shell
```

---

## 🚀 Installation

### 1. Requirements
- Python 3.9+
- pip

### 2. Install dependencies

```bash
cd azret_manage_plan
pip install -r requirements.txt
```

### 3. Run the app

```bash
python app.py
```

The server starts on **http://127.0.0.1:5000**. Open that address in
Chrome (works great on Chromebook's Linux/Crostini container, or any
desktop browser).

### 4. First login

- Default password: **azret123**
- Change it immediately from **Settings → Change Password**.

The SQLite database is created automatically at
`instance/azret.db` on first run — no manual setup needed.

---

## 📲 Installing as an App (PWA)

1. Open the site in Chrome.
2. Click the **Install** icon in the address bar (or menu → *Install
   AZRET MANAGE PLAN*).
3. The app now opens in its own window, with an app icon and splash
   screen, and the interface shell continues to load even without an
   internet connection (the local Flask server must still be running on
   the device — no internet connection is required for that either).

---

## 💾 Data & Backup

Everything is stored in one local SQLite file: `instance/azret.db`.

- **Settings → Backup Database** downloads a copy of that file.
- **Settings → Export Data** downloads a full JSON snapshot of every
  module.
- **Settings → Import Data** merges a previously exported JSON file back
  in.
- To restore a `.db` backup, stop the server and replace
  `instance/azret.db` with your backup file, then restart `python app.py`.
- **Settings → Clear All Data** permanently wipes every record (requires
  typing `DELETE` to confirm). This does not remove your password.

---

## 🔒 Privacy

AZRET MANAGE PLAN makes **no external network calls** except one
optional, harmless lookup: the live AED→INR rate (fetched directly by
your browser from a public exchange-rate API when you open the dashboard
or press refresh). Everything else — your income, expenses, savings,
debts, notes, and login — stays in the local SQLite database on this
device only.

---

## 🛠 Tech Stack

| Layer       | Technology                         |
|-------------|-------------------------------------|
| Backend     | Python 3, Flask                     |
| Templates   | Jinja2                              |
| Database    | SQLite (via Python `sqlite3`)       |
| Frontend    | Vanilla HTML5 / CSS3 / JavaScript   |
| Charts      | Custom dependency-free canvas engine|
| PDF Reports | ReportLab                           |
| PWA         | Web App Manifest + Service Worker   |

---

---

## 🆕 Phase 4 — Smart Salary Planner Upgrade

- **Allocation Gate**: `/api/salary-plan` refuses to generate (server-side,
  not just hidden in the UI) until an Income & Commitment Profile has been
  saved via `/api/income-profile`.
- **Income-aware engine**: defaults to the profile's verified income
  (declared income + other income) and combines EMI/debt table pending
  balances with the profile's declared fixed commitments before weighting
  the allocation. A different typed-in amount is treated as an explicit
  "what-if" projection and flagged (`is_projection`) rather than silently
  overwriting your verified figure.
- **Budget Health Score**: new numeric 0-100 score blending savings rate,
  EMI burden, debt burden and savings-goal progress, shown as a ring
  alongside the existing Excellent/Good/Needs Attention/Critical label.
- **Extra Analytics**: a second standalone canvas pie chart (Income vs
  Commitments: Free/Flexible vs EMI vs Debt) sits next to the existing
  category-allocation pie chart.
- No schema migration needed — the profile is stored as a few keys in the
  existing `settings` table, so upgrading an existing install just means
  replacing these files.

---

Powered by **AZRET**.

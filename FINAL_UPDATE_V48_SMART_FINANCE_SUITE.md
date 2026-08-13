# YARIN V48 — Smart Finance Suite

Added without removing the existing V47 login, OTP, mobile, contact, AI, exchange, CRUD, reports, settings, backup or branding features.

## New features
- Gold Saver with country/market selector (UAE/AED, India/INR, Saudi/SAR, Qatar/QAR, UK/GBP, US/USD), live XAU spot reference, per-gram conversion, contribution history, gram goal, target-price alert and session snapshot chart. This is tracking/reference only, not trade execution.
- Dashboard Smart Reminder bell for missed monthly savings, salary date with no income entry, Gold Saver monthly contribution, due bills, calendar events, goal deadlines and gold target price.
- Financial Calendar with automatic salary date plus custom bill/EMI/savings/gold/other reminders.
- Net Worth Tracker for user-entered assets and liabilities.
- Goals Center with target amount, saved amount, deadline and progress.
- Bills & Subscriptions Tracker with recurring due day reminders.
- Document Vault using browser IndexedDB; selected files remain local to that browser/device in this feature.
- Financial Health Score based on recorded net-worth, debt ratio, goal progress and planning activity. It is a planning indicator, not financial advice or a credit score.
- Azret AI Coach context: sends only aggregate new-suite metrics (score, net worth, counts, gold grams, alert titles) alongside the existing server-side finance context.

## Reliability
- Fixed sidebar route binding so non-page Sign Out buttons are not accidentally routed as pages.
- Service worker cache bumped to V48.
- Mobile responsive styles included for all new pages.

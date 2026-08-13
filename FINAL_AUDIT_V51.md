# YARIN V51 — Deep Recheck

V50 was re-audited and additional edge cases were fixed.

- Smart Finance Suite browser storage is now namespaced by authenticated user ID, preventing Gold Saver, Goals, Bills, Calendar and Net Worth data from leaking between accounts on a shared browser.
- Legacy unscoped Smart Finance Suite localStorage is migrated once to the authenticated account and then removed.
- Document Vault now uses a per-user IndexedDB database.
- Smart Finance Suite initialization fails closed and retries if the authenticated user ID is temporarily unavailable instead of falling back to a shared generic namespace.
- Bill, Financial Calendar and goal-deadline notifications now use local calendar-day arithmetic, fixing same-day reminders that could appear as “in 1 day.”
- Gold target-price alerts are stored per currency, so a target entered in AED is not reused as INR/SAR/QAR/GBP/USD after a market switch.
- Gold Saver refuses to record a contribution if the cached rate belongs to a different selected market.
- A stale gold rate from another country is no longer displayed after a country switch when refresh fails.
- Gold reference fetching now goes through authenticated `/api/gold/rate` on the YARIN server. The server fetches XAU/USD and converts it with the existing FX service, avoiding browser CORS failures and removing silent hard-coded FX fallback values.
- Goal validation rejects negative saved amounts.
- Financial Health no longer presents a “healthy” score when no meaningful financial data exists and now incorporates monthly savings rate.
- Document Vault open action uses a temporary object URL link and revokes it after use.
- Cache/version references are synchronized to V51.

Checks completed: Python compile, JavaScript syntax, inline JavaScript syntax after Jinja placeholder normalization, JSON parsing, duplicate HTML IDs, local static references, CSS parsing, and ZIP integrity.

# YARIN V52 recheck

Additional bugs fixed after V51:
- Finance-suite records now preserve the currency used when they were created.
- Net worth totals convert mixed-currency records into the active primary currency instead of relabelling raw numbers.
- Goals and bills display their recorded currency rather than silently changing the currency label.
- Financial Health net-worth math now uses normalized currency values.
- Notification bill amounts preserve recorded currency.
- Gold monthly contribution date now uses an explicit local YYYY-MM-DD key instead of relying on locale-specific date formatting.
- Cache version synchronized to V52.

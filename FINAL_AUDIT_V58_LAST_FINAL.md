# YARIN V58 — Last Final Audit

Release: 1.0.58

## Final fixes

- Repaired the malformed V57 mobile-login CSS block so mobile optimizations are parsed by browsers.
- Kept the mobile login compact and stable with `100svh`, reduced heavy animation/blur work, local lightweight first background, and no autofocus keyboard jump.
- Made Remember Me control the Flask session permanence instead of being cosmetic only.
- Corrected dashboard savings-goal aggregation to use the actual goal rather than summing repeated goal values from every savings row.
- Hardened currency pair/default settings and rejected unsupported/fake currency codes.
- Hardened finance-suite import validation and preflighted suite data before inserting financial rows to avoid partial restores on malformed backups.
- Required valid calendar dates during finance-suite sanitization.
- Prevented old unscoped browser finance-suite data from being assigned to the next account on a shared browser.
- Fixed recurring notification read keys so monthly reminders can alert again in a new month.
- Notification badge now counts all active unread reminders, supports `99+`, and renders a bounded first 100 items.
- Preserved the global top-bar notification modal behavior: full-screen dim/blur backdrop, theme-independent navy panel, individual read state, Escape/backdrop/close controls.
- Preserved mobile sidebar requirements: no top logout/X, theme icon in header, Sign Out before Contact Us at the end of the scrollable menu, standard blue/gray feature icons.
- Improved mobile performance by preventing unnecessary FX-chart reloads on minor browser viewport changes and using a smaller dashboard wallpaper request on phones.
- Updated PWA static fallback to ignore asset query-string versions so offline cached assets match `?v=58` URLs.
- Synchronized templates, package metadata and service-worker cache to V58.

## Verification performed

- Python syntax compile: PASS
- Main JavaScript syntax: PASS
- Chart JavaScript syntax: PASS
- Inline login JavaScript syntax: PASS
- Inline dashboard JavaScript syntax: PASS
- HTML duplicate-ID scan: PASS
- Sidebar page-target scan: PASS
- CSS brace/comment/serialization checks: PASS
- PWA cached-asset existence check: PASS
- Version/cache synchronization: PASS
- SQLite full CRUD and account-isolation regression tests: PASS
- Savings-goal regression test: PASS
- Payment cascade regression test: PASS
- Settings and user-asset account-isolation tests: PASS
- Secret-pattern scan of application source: PASS

## Runtime note

A live Flask HTTP test-client run was not possible in the audit container because Flask/Werkzeug are not installed there and the container has no package-download access. The application source, JavaScript, HTML/CSS/PWA structure and real SQLite database layer were tested directly as listed above.

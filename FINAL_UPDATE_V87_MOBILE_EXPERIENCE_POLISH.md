# YARIN V87 — Mobile Experience Polish

Mobile-only UI pass. Desktop/tablet (>=768px) layout is intentionally unchanged.

## Changes
- Global search collapses to a search icon on phones; tap expands a focused search bar with close control.
- Restored compact mobile greeting, username, local time/date below the top bar.
- Reduced top-bar height and GPU-heavy blur while keeping menu, notification bell and currency switch accessible.
- Fixed Android salary flag rendering: AED uses a real UAE flag field, INR uses a real India flag field from center-to-right of the salary card; other currencies keep the existing fallback.
- Rebuilt mobile salary countdown into a compact two-column layout with horizontal hrs/mins/secs.
- Kept Daily Reflection visible in a smaller readable row.
- Removed partial Azret AI typewriter state on mobile; "Hello!" is always complete.
- Tightened Dashboard hero/rate card, FX chart, stats, form/table/card spacing.
- Added subtle mobile page transitions and stronger bottom-navigation active state.
- Reduced floating calculator launcher size on mobile to avoid covering content.
- All changes are CSS/JS/HTML mobile overrides; business/data APIs are untouched.

## Cache
- index/login asset query: v87
- service worker cache: yarin-cache-v87

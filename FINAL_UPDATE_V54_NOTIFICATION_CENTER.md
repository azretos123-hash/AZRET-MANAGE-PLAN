# YARIN V54 — Notification Center Fix

- Moved the notification bell from the Dashboard heading into the global top bar next to Search.
- Replaced the emoji bell with a self-contained green 3D-style SVG bell (no checkerboard/image background dependency).
- Added an unread-count badge; hidden at zero and capped visually at 99+.
- Opening notifications now uses a fixed viewport modal with full-page blur/dim overlay, independent of the current page.
- Notification modal uses a fixed navy design in both Light and Dark modes.
- Background scrolling is locked while the notification modal is open.
- Modal closes with X, Escape, or clicking the blurred backdrop.
- Opening the modal does not mark notifications as read. A notification becomes read only after the user selects it.
- Read state is user-scoped in localStorage and is cleared by Clear All Data.
- Bumped frontend/service-worker cache version to V54.

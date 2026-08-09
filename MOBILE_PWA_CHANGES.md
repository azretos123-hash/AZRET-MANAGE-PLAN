# Mobile / PWA update

This build keeps the same public multi-user backend and adds a phone-first responsive interface.

- Responsive phone/tablet/desktop layouts.
- Mobile bottom navigation for Dashboard, Income, Expenses and Savings; More opens the full sidebar.
- Sticky compact top bar on phones.
- Touch targets are at least ~44px for primary controls.
- Form inputs use 16px text to avoid mobile-browser zoom.
- Tables remain usable with touch horizontal scrolling.
- Modals adapt to a bottom-sheet style on smaller screens.
- Safe-area support for notched iPhone/Android devices.
- Existing PWA manifest/service worker retained; standalone/home-screen mode supported.
- No finance features were intentionally removed.


## ChromeOS / Desktop layout safeguard
- Phone app-style bottom navigation is now limited to screens 767px wide or smaller.
- ChromeOS, laptops and desktop browsers keep the normal desktop website layout.
- Mobile PWA behavior remains available on phones.

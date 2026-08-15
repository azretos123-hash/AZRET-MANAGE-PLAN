# YARIN V83 — Deep Clean Audit

Final hardening pass after V82.

## Fixed
- Synced all main/login static cache-busters to V83.
- Bumped service-worker cache to `yarin-cache-v83` and disabled updateViaCache on registration.
- Removed two legacy external Dubai wallpaper URLs; worldwide login wallpapers are now local-only.
- Wallpaper rotation advances after same-tab reload instead of replaying the just-seen image.
- Removed the hidden duplicate mobile Sign Out nav element; mobile uses the single footer Sign Out below Contact Us.
- Calculator now rejects non-finite results such as division by zero instead of showing Infinity.
- Added non-negative/minimum constraints and input modes to Currency, Savings and EMI calculators.
- Added finite-result protection to EMI calculations.
- Kept Calculator and Reports out of the sidebar as intended.

## Validation
- Python source compilation
- JavaScript syntax checks
- HTML duplicate-ID audit
- Navigation-to-page mapping audit
- CSS brace balance
- SVG/XML validation for all 16 worldwide wallpaper assets
- JSON validation for manifest/package/metadata
- Service-worker asset existence audit
- ZIP integrity check

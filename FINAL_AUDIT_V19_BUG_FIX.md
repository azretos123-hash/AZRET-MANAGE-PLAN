# RIZQ V19 Bug Fix Audit

Date: 2026-08-11

## Fixed
- Bumped the PWA/service-worker cache from the old V17 key to V19 so V18/V19 JavaScript, CSS, icons and manifest are not kept behind an obsolete cache generation after deployment.
- Revalidated dynamic primary/secondary currency implementation and AED canonical storage conversion helpers.
- Revalidated Gemini model configuration: `gemini-3.5-flash-lite` remains first choice and deprecated sampling parameters are not sent.

## Static verification
- Python `compileall`: PASS
- JavaScript `node --check`: PASS
- Service-worker static routes/assets: PASS
- Duplicate HTML id scan: PASS
- JSON manifest parse: PASS
- ZIP integrity: PASS

## Production-only verification still required
Render + Neon connectivity, a real Gemini API request, browser microphone permission/speech recognition, and remote wallpaper/FX network availability require a deployed environment and cannot be fully proven by offline source inspection.

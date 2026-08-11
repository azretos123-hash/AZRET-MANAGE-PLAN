# RIZQ V32 Final Stability Pass

- Removed the old Azret AI screenshot asset from the project.
- Azret AI popup now uses the standalone avatar asset only; UI remains HTML/CSS/JS.
- Minimize no longer ends an active voice conversation; Close still stops it.
- Added automatic Malayalam/English detection from typed/recognized text without a visible EN/ML switch.
- Added chat request timeout and clearer Gemini/network errors.
- Fixed microphone permission/audio-capture loops so denied permissions do not retry forever.
- Consolidated browser TTS into one implementation with best-effort natural/feminine voice selection and language-correct fallback.
- Updated service-worker and JS cache versions to V32.
- Cleaned stale package Growth branding.
- Gemini model order remains current low-latency stable models: 3.5 Flash-Lite -> configured model -> 3.1 Flash-Lite -> 2.5 Flash-Lite fallback.

Important: browser SpeechRecognition/SpeechSynthesis voice quality and exact lip-sync depend on the user's browser/OS. This build does not claim native Gemini Live audio or human-perfect facial rigging.

# Gemini integration recheck and fixes

- Fixed a critical browser permission bug: the old `Permissions-Policy` disabled the microphone for the site. Microphone is now allowed for the same origin.
- Removed silent general-chat fallback to canned finance answers. Gemini failures now surface as real configuration/API errors instead of pretending the local finance fallback is Gemini.
- Supports both `GEMINI_API_KEY` and `GOOGLE_API_KEY`.
- Updated model order to current stable models: `gemini-3.6-flash`, `gemini-3.5-flash`, then `gemini-2.5-flash`. Removed obsolete 1.5 and shut-down 2.0 fallbacks.
- Added user-scoped persistent conversation history, so follow-up chat and voice turns have context and do not start from zero every request.
- Added a Clear control that deletes only the signed-in user's AI conversation memory.
- General questions are explicitly separated from private finance context; finance data is used only when relevant.
- Improved frontend HTTP/API error handling and empty-response handling.
- Voice mode now shares the same conversation memory and reports Gemini errors instead of repeating a canned response.
- Bumped the PWA cache version so browsers receive the updated JavaScript immediately after deployment.
- Added `/api/ai-status` for authenticated configuration diagnostics.

Note: the existing voice UI uses browser speech recognition + speech synthesis around Gemini text turns. It is now conversational and continuous, but it is not a native PCM Gemini Live API WebSocket implementation. Google documents the native Live API separately.

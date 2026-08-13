# V34 Azret AI Redesign Audit

- Removed the old cropped/oval Azret AI presentation.
- The user reference screenshot is not used as the popup UI.
- Added a standalone waving hijabi avatar asset used only as the character visual.
- Rebuilt the assistant popup using HTML/CSS/JS: header, online state, avatar pane, quick actions, chat, voice view, transcript, controls, minimize and close.
- Opening the dashboard avatar opens the assistant in Chat mode without turning on the microphone.
- Clicking the girl inside the popup switches to Voice mode and starts the voice conversation.
- Dashboard launcher hides while the popup is open and returns after close.
- Voice state UI continues to use Listening / Thinking / Speaking state changes.
- Removed the obsolete rizq-ai-avatar.webp asset to prevent stale use.
- Service-worker cache bumped to v34.
- Python compile, JavaScript syntax, duplicate-ID and static reference checks passed.

# YARIN V93 — Live Particle Authentication Wallpaper

- Integrated a local, dependency-free live particle layer into the V92 cinematic login background.
- Particle colours are sampled from the currently active local nature wallpaper.
- Desktop pointer movement creates a subtle momentum/push interaction inspired by the supplied WebGL particle concept.
- Mobile/coarse-pointer devices automatically use a reduced particle count and ~30 FPS rendering to protect responsiveness, heat, and battery.
- Reduced-motion users receive the static blurred wallpaper without animation.
- Existing 60-second nature rotation and full-set no-repeat behavior remain intact.
- When the wallpaper changes, the particle palette automatically follows the new scene.
- Login, register, OTP/password reset, theme selection, and backend authentication logic were not changed.
- Added auth-particles.js to the service-worker static asset list and bumped cache to V93.

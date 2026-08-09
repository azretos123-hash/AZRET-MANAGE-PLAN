# Online Login Wallpaper

- Login/Register loads an online random wallpaper from `picsum.photos` with no API key.
- A fresh wallpaper is requested on page load, when returning to the tab, and every 30 seconds while visible.
- Two background layers cross-fade smoothly.
- If the remote image service or internet connection fails, the login screen keeps a built-in gradient fallback and remains fully usable.
- Wallpapers are not stored in the project, so the ZIP stays small.
- Desktop/ChromeOS keeps the normal desktop login layout; mobile remains responsive.

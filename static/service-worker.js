/* YARIN يارين — Service Worker
   Public multi-user safe caching policy:
   - Never cache authenticated HTML/navigation responses.
   - Never cache API responses.
   - Cache only static app assets.
   This avoids stale login/dashboard screens and prevents one signed-in view
   from being replayed after logout on the same device.
*/

const CACHE_NAME = 'yarin-cache-v53';
const STATIC_ASSETS = [
  '/manifest.json',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/js/charts.js',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/icons/yarin-emblem.webp',
  '/static/icons/rizq-ai-wave.webp',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  // Authentication/private data and navigation must always come from server.
  if (
    request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname === '/login' ||
    url.pathname === '/splash' ||
    url.pathname.startsWith('/api/')
  ) {
    event.respondWith(fetch(request));
    return;
  }

  // Do not interfere with third-party online wallpaper/exchange-rate requests.
  if (url.origin !== self.location.origin) return;

  // Cache only our static assets. Network-first keeps deployments fresh.
  if (url.pathname.startsWith('/static/') || url.pathname === '/manifest.json') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
  }
});

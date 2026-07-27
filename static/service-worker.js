/* AZRET MANAGE PLAN — Service Worker
   Caches the app shell so the interface loads instantly and works even
   without an internet connection. API calls (/api/*) always go to the
   local Flask server on this device — no internet is required for that
   either, since the server runs locally.
*/

const CACHE_NAME = 'azret-shell-v2';
const APP_SHELL = [
  '/',
  '/login',
  '/manifest.json',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/js/charts.js',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
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
  const url = new URL(event.request.url);

  // Never cache API calls or exchange-rate lookups — always go live.
  if (url.pathname.startsWith('/api/') || url.hostname.includes('er-api.com')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response(
        JSON.stringify({ error: 'offline' }),
        { headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // App shell: cache-first, falling back to network, then to cache on failure.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

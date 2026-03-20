// F2F PWA Service Worker v1
const CACHE_NAME = 'f2f-pwa-v2';
const URLS_TO_CACHE = [
  '/F2F-office/',
  '/F2F-office/index.html',
  '/F2F-office/styles.css',
  '/F2F-office/app.js',
  '/F2F-office/supabase.js',
  '/F2F-office/f2f_data.js',
  '/F2F-office/manifest.json',
  '/F2F-office/icon-192.png',
  '/F2F-office/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(URLS_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network-first strategy — always try fresh data, fallback to cache
  e.respondWith(
    fetch(e.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});

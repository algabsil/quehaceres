const CACHE_NAME = 'quehaceres-v2';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// App shell: cache-first. Supabase API calls: always go to network (handled in app.js, not cached here).
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // let API calls pass straight through
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

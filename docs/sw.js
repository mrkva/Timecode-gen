const CACHE_NAME = 'ltc-v7';
const ASSETS = [
  './',
  './index.html',
  './ltc-worklet.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_NAME)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
  );
});

// Tell the page when a new version activates
self.addEventListener('message', (event) => {
  if (event.data === 'getVersion') {
    event.source.postMessage({ type: 'version', version: CACHE_NAME });
  }
});

/* Room Designer service worker: caches the app so it opens offline. Your rooms live in IndexedDB, not here. */
const CACHE = 'room-designer-0.1.1';
const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/vendor/three.bundle.js',
  './js/app.js',
  './js/catalog.js',
  './js/db.js',
  './js/geometry.js',
  './js/homography.js',
  './js/icons.js',
  './js/models.js',
  './js/panels.js',
  './js/phone-scan.js',
  './js/photo-tool.js',
  './js/photos.js',
  './js/scanning.js',
  './js/store.js',
  './js/textures.js',
  './js/util.js',
  './js/version.js',
  './js/viewer.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate for same-origin GET requests: instant loads, updates picked up on next visit.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) {
        event.waitUntil(network);
        return cached;
      }
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    })
  );
});

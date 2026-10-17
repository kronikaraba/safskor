// Yalnızca bağlantı yokken gösterilecek sayfayı saklar. JS, CSS ve API her zaman ağdan gelir,
// böylece yeni sürüm yayınlanınca uygulamada eski kod takılı kalmaz.
const CACHE = 'safskor-offline-v1';
const OFFLINE = '/offline.html';
const OFFLINE_ASSETS = [OFFLINE, '/offline.js', '/img/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(OFFLINE_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const { pathname, origin } = new URL(e.request.url);
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
  } else if (origin === location.origin && OFFLINE_ASSETS.includes(pathname)) {
    e.respondWith(fetch(e.request).catch(() => caches.match(pathname)));
  }
});

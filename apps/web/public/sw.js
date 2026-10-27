// Brink offline cache. The game runs entirely in the browser, so once loaded it plays without a
// network: navigations go network-first (a fresh deploy wins), everything else cache-first (hashed
// bundles and art never change under the same name). Bump VERSION to drop old caches.
const VERSION = 'brink-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest', './icons/apple-touch-icon.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }
  // Hashed bundles never change under one name: cache-first. Art and the rest: serve the cached copy
  // at once and refresh it in the background, so a redeploy shows up on the next launch.
  const hashed = new URL(req.url).pathname.includes('/assets/');
  e.respondWith(
    caches.open(VERSION).then((c) =>
      c.match(req).then((hit) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res.ok) c.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hashed && hit ? hit : hit || fresh;
      }),
    ),
  );
});

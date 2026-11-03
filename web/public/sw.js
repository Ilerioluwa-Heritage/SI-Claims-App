// Keeps the app on the phone or computer after the first visit, so it opens
// without a connection. Only the app's own files are kept here: never the
// files you upload, which stay in the page and are never sent anywhere.

const CACHE = 'si-claims-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  // A new version of this file (a new CACHE name) clears the old kept files.
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Cloudflare's sign-in and sign-out pages: always straight from the internet, never kept.
  if (url.pathname.startsWith('/cdn-cgi/')) return;

  if (request.mode === 'navigate') {
    // The page itself: the newest from the internet, the kept copy when offline.
    // Only the app's own page is kept, never a sign-in redirect or a closed page.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // The app's own files (a new version has new file names): the kept copy first.
  // Anything else is fetched as usual and not kept.
  const path = url.href.slice(self.registration.scope.length);
  if (!/^(assets|icons)\/[^/]+$|^manifest\.webmanifest$/.test(path)) return;
  event.respondWith(
    caches.match(request).then(
      (kept) =>
        kept ??
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});

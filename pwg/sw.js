/* Pinoy Word Games — offline cache (app shell only; Firestore goes online) */
const CACHE = "pwg-v4";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "static/css/pwg.css",
  "static/js/game.js",
  "static/js/questions.js",
  "static/js/firebase.js",
  "static/icons/icon.svg",
  "static/icons/icon-192.png",
  "static/icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// same-origin GETs: cache-first with background refresh; everything else untouched
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fresh = fetch(e.request).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});

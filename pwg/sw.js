/* Pinoy Word Games — offline cache (app shell only; Firestore goes online) */
const CACHE = "pwg-v11";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "static/css/pwg.css",
  "static/js/game.js",
  "static/js/audio.js",
  "static/js/questions.js",
  "static/js/firebase.js",
  "static/icons/icon.svg",
  "static/icons/icon-192.png",
  "static/icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  // Pre-cache the new shell but stay in "waiting" until the page asks us to
  // take over (via Sync Up), so an update never swaps assets mid-game.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

// Sync Up tells the waiting worker to activate now; controllerchange in the
// page then reloads into the fresh version.
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
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

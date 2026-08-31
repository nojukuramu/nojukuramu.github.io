/* SkyLine — offline app-shell cache */
const CACHE = "skyline-v1";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "vendor/three.min.js",
  "js/core.js",
  "js/qualityManager.js",
  "js/procgen.js",
  "js/terrain.js",
  "js/trees.js",
  "js/water.js",
  "js/lighting.js",
  "js/roads.js",
  "js/zoning.js",
  "js/buildings.js",
  "js/citizens.js",
  "js/traffic.js",
  "js/weather.js",
  "js/ambient.js",
  "js/audio.js",
  "js/economy.js",
  "js/save.js",
  "js/input.js",
  "js/ui.js",
  "js/main.js",
  "assets/icons/icon.svg",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

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

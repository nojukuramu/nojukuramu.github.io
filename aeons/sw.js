/* Aeons service worker — the game's shell, cached so it opens instantly
   and plays with no connection.

   The shape is Hacks' sw.js (which is Magic Sandbox's), the house pattern
   every installable app here follows (CLAUDE.md): the worker never takes
   over by itself, it answers "skip-waiting" when the page asks, and CACHE
   carries the same number as window.AE_VERSION in index.html —
   tools/validate.js refuses to let the two drift. Bumping it is what
   publishes an update. Saved games live in IndexedDB, not here, so an
   update never touches them. */
var CACHE = "aeons-v1";
var SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/aeons.css",
  "./js/audio.js",
  "./js/auto.js",
  "./js/buildings.js",
  "./js/combat.js",
  "./js/data.js",
  "./js/enemy.js",
  "./js/entities.js",
  "./js/fog.js",
  "./js/fx.js",
  "./js/heroes.js",
  "./js/icons.js",
  "./js/info.js",
  "./js/input.js",
  "./js/lore.js",
  "./js/main.js",
  "./js/minimap.js",
  "./js/orient.js",
  "./js/path.js",
  "./js/render.js",
  "./js/rng.js",
  "./js/save.js",
  "./js/sim.js",
  "./js/sprites.js",
  "./js/state.js",
  "./js/terrain.js",
  "./js/ui.js",
  "./js/units.js",
  "./js/update.js",
  "./js/world.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch.png"
];

self.addEventListener("install", function (e) {
  /* Deliberately no skipWaiting() here: a new build installs, parks itself
     in "waiting", and takes over only when the page asks (the player
     pressed Reload) or every tab of the old build has closed. Swapping code
     out from under a realm in progress is the failure this avoids.
     cache: "reload" skips the HTTP cache, so a version's shell is never
     assembled from files the previous deploy left there. */
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: "reload" }); }));
  }));
});

self.addEventListener("message", function (e) {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  /* Cache first, never refreshed behind the page's back: a version is
     replaced whole, by the install above, or not at all. */
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        if (req.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      });
    })
  );
});

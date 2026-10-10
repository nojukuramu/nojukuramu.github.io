/* Type service worker — the page's shell, cached so it opens instantly and
   works with no connection (the challenges are built in the page, so there is
   nothing else to fetch).

   The shape is Hacks' sw.js, the house pattern every installable app here
   follows (CLAUDE.md): the worker never takes over by itself, it answers
   "skip-waiting" when the page asks, and CACHE carries the same number as
   window.TY_VERSION in index.html — tools/validate.js refuses to let the two
   drift. Bumping it is what publishes an update. */
var CACHE = "type-v3";
var SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/type.css",
  "./js/main.js",
  "./js/update.js",
  "./js/info.js",
  "./js/store.js",
  "./js/rng.js",
  "./js/words.js",
  "./js/fill.js",
  "./js/gen.js",
  "./js/gen-text.js",
  "./js/gen-terminal.js",
  "./js/gen-code.js",
  "./js/gen-keys.js",
  "./js/convo.js",
  "./js/engine.js",
  "./js/race.js",
  "./js/lobby.js",
  "./js/peer.js",
  "./js/mp.js",
  "./js/highlight.js",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/maskable-512.png",
  "./assets/icons/apple-touch.png"
];

self.addEventListener("install", function (e) {
  /* Deliberately no skipWaiting() here: a new build installs, parks itself
     in "waiting", and takes over only when the page asks (the typist
     pressed Reload) or every tab of the old build has closed. Swapping code
     out from under a half-typed challenge is the failure this avoids.
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

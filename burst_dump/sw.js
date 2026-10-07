/* BURST//DUMP service worker — the page's shell, cached so it opens instantly
   and works offline (photos and songs never leave the device, so there is
   nothing else to fetch).

   The shape is Type's sw.js (type/sw.js), the house pattern every installable
   app here follows (CLAUDE.md): the worker never takes over by itself, it
   answers "skip-waiting" when the page asks, and CACHE carries the same
   number as window.BD_VERSION in index.html — tools/validate.js refuses to
   let the two drift. Bumping it is what publishes an update.

   One addition: Essentia.js (2.5 MB) is not in the shell. Most visits never
   add a song, so it is cached the first time the analysis worker asks for
   it, in a cache of its own named for its version, which an app update
   leaves alone. */
var CACHE = "burstdump-v2";
var VENDOR = "burstdump-essentia-0.1.3";
var SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/burst.css",
  "./js/main.js",
  "./js/update.js",
  "./js/info.js",
  "./js/timeline.js",
  "./js/render.js",
  "./js/photos.js",
  "./js/audio.js",
  "./js/export.js",
  "./js/mir.js",
  "./js/analysis-worker.js",
  "./vendor/mp4-muxer.mjs",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch.png"
];

self.addEventListener("install", function (e) {
  /* Deliberately no skipWaiting() here: a new build installs, parks itself
     in "waiting", and takes over only when the page asks or every tab of
     the old build has closed. Swapping code out from under an export in
     progress is the failure this avoids. cache: "reload" skips the HTTP
     cache, so a version's shell is never assembled from stale files. */
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: "reload" }); }));
  }));
});

self.addEventListener("message", function (e) {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE || k === VENDOR ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var bucket = url.pathname.indexOf("/vendor/essentia/") >= 0 ? VENDOR : CACHE;
  /* Cache first, never refreshed behind the page's back: a version is
     replaced whole, by the install above, or not at all. */
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === "basic") {
          var copy = res.clone();
          caches.open(bucket).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        if (req.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      });
    })
  );
});

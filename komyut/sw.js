/* KomyutApp service worker — caches the shell so the app opens instantly and
   survives a flaky connection, which on a Philippine commute is most of it.

   The pattern is the one the-wolf-game, karaokenatin and routecast already
   use in this repository, including the `"skip-waiting"` message, so all
   four workers answer the same word and the update flow reads the same in
   every one of them.

   CACHE is the app's version, and the page carries the same number as
   KM_VERSION in static/js/boot.js; tools/validate.js refuses to let the two
   drift apart. Bumping it is what publishes an update: a changed sw.js is
   what a browser notices, and a new cache name is what makes the old shell
   go away. */
var CACHE = "komyut-v3";
var SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./static/icon.svg",
  "./static/icon-192.png",
  "./static/icon-512.png",
  "./static/icon-maskable-192.png",
  "./static/icon-maskable-512.png",
  "./static/apple-touch-icon.png",
  "./static/css/app.css",
  "./static/js/boot.js",
  "./static/js/util.js",
  "./static/js/sanitize.js",
  "./static/js/config.js",
  "./static/js/icons.js",
  "./static/js/info.js",
  "./static/js/update.js",
  "./static/js/supa.js",
  "./static/js/transit.js",
  "./static/js/geocode.js",
  "./static/js/router.js",
  "./static/js/weather.js",
  "./static/js/routes.js",
  "./static/js/plan.js",
  "./static/js/map.js",
  "./static/js/ui.js",
  "./static/js/finder.js",
  "./static/js/detail.js",
  "./static/js/browse.js",
  "./static/js/builder.js",
  "./static/js/planner.js",
  "./static/js/account.js",
  "./static/js/app.js",
  "./static/js/pwa.js",
  "./vendor/leaflet/leaflet.js",
  "./vendor/leaflet/leaflet.css",
  "./vendor/leaflet/images/marker-icon.png",
  "./vendor/leaflet/images/marker-icon-2x.png",
  "./vendor/leaflet/images/marker-shadow.png",
  "./vendor/leaflet/images/layers.png",
  "./vendor/leaflet/images/layers-2x.png"
];

self.addEventListener("install", function (e) {
  /* Deliberately no skipWaiting() here. A finished install parks this
     worker in "waiting" until either every tab of the old build has gone,
     or the page asks for the handover with "skip-waiting" below because
     somebody pressed Reload. Swapping code out from under a person mid-way
     through filing a route is the failure this replaces. */
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
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

  /* Never touch the live services: the community database, the forecast,
     the geocoder, the router, the map tiles. A cached vote count is a
     wrong vote count, and a stale forecast is worse than no forecast.
     Everything cross-origin goes straight to the network. */
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match("./index.html");
      });
    })
  );
});

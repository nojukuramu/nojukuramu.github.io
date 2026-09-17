/* RouteCast service worker — caches the shell so the app opens instantly and
   survives a flaky connection. Forecast, routing and geocoding calls always go
   to the network; stale weather is worse than no weather.

   CACHE is the app's version, and the page carries the same number as
   RC_VERSION; tools/validate.js refuses to let the two drift apart. Bumping it
   is what publishes an update: a changed sw.js is what a browser notices, and
   a new cache name is what makes the old shell go away. */
var CACHE = "routecast-v11";
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
  "./static/js/util.js",
  "./static/js/info.js",
  "./static/js/update.js",
  "./static/js/icons.js",
  "./static/js/coords.js",
  "./static/js/background.js",
  "./static/js/history.js",
  "./static/js/heat.js",
  "./static/js/traffic.js",
  "./static/js/eta.js",
  "./static/js/routes.js",
  "./static/js/marks.js",
  "./static/js/geocode.js",
  "./static/js/router.js",
  "./static/js/sampler.js",
  "./static/js/weather.js",
  "./static/js/elevation.js",
  "./static/js/risk.js",
  "./static/js/pick.js",
  "./static/js/qr.js",
  "./static/js/peer.js",
  "./static/js/voice.js",
  "./static/js/rejoin.js",
  "./static/js/group.js",
  "./static/js/groupui.js",
  "./static/js/pubs.js",
  "./static/js/pubsui.js",
  "./static/js/nav.js",
  "./static/js/free.js",
  "./static/js/follow.js",
  "./static/js/compass.js",
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
  /* Deliberately no skipWaiting() here, and this is the whole point of the
     change. It used to be there, which meant a deploy could swap the code out
     from under somebody halfway through a ride — new scripts against an old
     page, or a reload at the worst possible moment. A finished install now
     parks this worker in "waiting" until either every tab of the old build has
     gone, or the page asks for the handover with "skip-waiting" below because
     the rider pressed Reload. */
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

  // Never cache the live services or the map tiles.
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

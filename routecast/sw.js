/* RouteCast service worker — caches the shell so the app opens instantly and
   survives a flaky connection. Forecast, routing and geocoding calls always go
   to the network; stale weather is worse than no weather. */
var CACHE = "routecast-v2";
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
  "./static/js/icons.js",
  "./static/js/geocode.js",
  "./static/js/router.js",
  "./static/js/sampler.js",
  "./static/js/weather.js",
  "./static/js/risk.js",
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
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () {
    return self.skipWaiting();
  }));
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

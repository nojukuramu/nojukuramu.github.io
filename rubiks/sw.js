/* sw.js — Rubiks cube timer
 *
 * Network-first for navigations, JS and CSS so a deploy is picked up on the
 * next load. Stale-while-revalidate for icons and the manifest. The worker
 * never takes over by itself; the page asks with "skip-waiting". */
"use strict";

var VERSION = "rubiks-v3";
var ASSET_V = "3";
var SHELL = VERSION + "-shell";

var SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest?v=" + ASSET_V,
  "./css/rubiks.css?v=" + ASSET_V,
  "./js/icons.js?v=" + ASSET_V,
  "./js/cube.js?v=" + ASSET_V,
  "./js/solver222.js?v=" + ASSET_V,
  "./js/scramble.js?v=" + ASSET_V,
  "./js/store.js?v=" + ASSET_V,
  "./js/stats.js?v=" + ASSET_V,
  "./js/timer.js?v=" + ASSET_V,
  "./js/sound.js?v=" + ASSET_V,
  "./js/wake.js?v=" + ASSET_V,
  "./js/chart.js?v=" + ASSET_V,
  "./js/cube3d.js?v=" + ASSET_V,
  "./js/follow.js?v=" + ASSET_V,
  "./js/info.js?v=" + ASSET_V,
  "./js/update.js?v=" + ASSET_V,
  "./js/sheets.js?v=" + ASSET_V,
  "./js/panels.js?v=" + ASSET_V,
  "./js/app.js?v=" + ASSET_V,
  /* 650 KB, fetched once at install so the 3D view works offline. */
  "./vendor/build/three.module.min.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(SHELL).then(function (c) {
      return Promise.all(SHELL_FILES.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    })
    /* No skipWaiting() here. The page asks with "skip-waiting" when the user
       says so, not mid-solve. */
  );
});

self.addEventListener("message", function (e) {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf(VERSION) !== 0) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(SHELL).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) {
      return hit || caches.match("./index.html");
    });
  });
}

function staleWhileRevalidate(req) {
  return caches.match(req).then(function (hit) {
    var net = fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () { return hit; });
    return hit || net;
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  var p = url.pathname;
  if (req.mode === "navigate" || /\.(?:js|css)$/.test(p)) {
    e.respondWith(networkFirst(req));
    return;
  }
  e.respondWith(staleWhileRevalidate(req));
});

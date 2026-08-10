/* sw.js — service worker for ARCO.
 *
 * Scope is this folder only. An instrument has no business needing a network,
 * so the whole thing is cached and plays offline: there are no samples to
 * download, the strings are synthesised on the device.
 *
 *   - Navigations are network-first, so a deployed change shows up on the next
 *     load instead of being pinned to whatever was cached at install time.
 *   - Same-origin assets are stale-while-revalidate: instant from cache, with a
 *     fresh copy pulled in the background for next time.
 *   - Cross-origin requests are left completely alone.
 */
"use strict";

var VERSION = "arco-v1";
var SHELL = VERSION + "-shell";

var SHELL_FILES = [
  "./",
  "./index.html",
  "./css/arco.css",
  "./js/theory.js",
  "./js/engine.js",
  "./js/dsp-worklet.js",
  "./js/input.js",
  "./js/render.js",
  "./js/shell.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(SHELL)
      .then(function (cache) {
        // One missing file must not fail the whole install, or a typo in this
        // list silently costs the app its installability.
        return Promise.all(
          SHELL_FILES.map(function (url) {
            return cache.add(new Request(url, { cache: "reload" })).catch(function () {});
          })
        );
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (k) {
            if (k.indexOf(VERSION) !== 0) return caches.delete(k);
            return null;
          })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          var copy = res.clone();
          caches.open(SHELL).then(function (c) { c.put("./index.html", copy); });
          return res;
        })
        .catch(function () {
          return caches.match("./index.html").then(function (hit) {
            return hit || caches.match("./");
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req)
        .then(function (res) {
          if (res && res.status === 200 && res.type === "basic") {
            var copy = res.clone();
            caches.open(SHELL).then(function (c) { c.put(req, copy); });
          }
          return res;
        })
        .catch(function () { return hit; });
      return hit || net;
    })
  );
});

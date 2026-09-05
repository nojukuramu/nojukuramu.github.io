/* sw.js — makes the game installable, and keeps the shell usable with no network.
 *
 * Scope is this folder only, and it is deliberately narrow about what it touches:
 *
 *   - Navigations and the app's own code (JS, CSS) are network-first, so a
 *     deploy is picked up on the next load instead of being pinned to whatever
 *     was cached at install. The alternative pairs each deploy's fresh HTML with
 *     the previous deploy's stylesheet for exactly one load, which is the worst
 *     bug to be told about and the hardest to reproduce.
 *   - The data files are network-first too. They ARE the game — a stale
 *     list_of_roles.json is a room where a role quietly does the wrong thing.
 *   - Icons and the manifest are stale-while-revalidate: instant, refreshed
 *     behind you.
 *   - Everything cross-origin is left completely alone. The signalling brokers
 *     and the STUN/TURN servers must never be mediated by a cache, and
 *     WebSockets never reach a fetch handler anyway.
 *
 * Playing needs the network regardless — it is a peer-to-peer game. What
 * survives offline is the app itself, so a phone with no signal still opens to
 * something rather than a dinosaur.
 */
"use strict";

var VERSION = "wg-v1";
var ASSET_V = "1.0.0";          /* matches the ?v= in index.html */
var SHELL = VERSION + "-shell";

var SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest?v=" + ASSET_V,
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./css/theme.css?v=" + ASSET_V,
  "./css/app.css?v=" + ASSET_V,
  "./data/list_of_roles.json?v=" + ASSET_V,
  "./data/game_flow.json?v=" + ASSET_V,
  "./data/sky.json?v=" + ASSET_V,
  "./data/list_of_events.json?v=" + ASSET_V
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(SHELL).then(function (c) {
      // One failed file must not fail the whole install, or a single 404 leaves
      // the app permanently uninstallable.
      return Promise.all(SHELL_FILES.map(function (u) {
        return c.add(u).catch(function () { /* it will be fetched on demand */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
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
  if (url.origin !== self.location.origin) return;     // brokers, STUN, TURN: not ours

  var p = url.pathname;
  if (req.mode === "navigate" || /\.(?:js|css|json)$/.test(p)) {
    e.respondWith(networkFirst(req));
    return;
  }
  e.respondWith(staleWhileRevalidate(req));
});

/* sw.js — service worker: makes the app installable, and keeps the shell and
 * your library usable with no network.
 *
 * Scope is this folder only. Deliberately narrow in what it touches:
 *
 *   - Navigations are network-first, so a deployed change is picked up on the
 *     next load rather than being pinned to whatever was cached at install.
 *   - Same-origin assets are stale-while-revalidate: instant from cache, with
 *     a fresh copy fetched in the background for next time.
 *   - Everything cross-origin is left completely alone — YouTube's player,
 *     the search mirrors and the signalling brokers must not be mediated by a
 *     cache, and WebSockets never reach a fetch handler anyway.
 *
 * Playback needs the network regardless; what survives offline is the app
 * itself and the library, which is exactly the part that is yours.
 */
"use strict";

var VERSION = "kn-v4";
var SHELL = VERSION + "-shell";

var SHELL_FILES = [
  "./",
  "./index.html",
  "./css/app.css",
  "./js/icons.js",
  "./js/qr.js",
  "./js/peer.js",
  "./js/search.js",
  "./js/library.js",
  "./js/room.js",
  "./js/player.js",
  "./js/app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png"
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
  );
  // Deliberately no skipWaiting() here: a finished install parks this worker in
  // "waiting", which is what the page watches for so it can offer the update
  // rather than swapping the app out from under a room that is mid-song. The
  // page sends "skip-waiting" below when the user accepts.
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.filter(function (k) { return k.indexOf(VERSION) !== 0; })
              .map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("message", function (event) {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // Not ours to touch: YouTube, Piped/Invidious, the brokers, thumbnails.
  if (url.origin !== self.location.origin) return;
  // Another app on the same origin — this site hosts several.
  if (url.pathname.indexOf(self.registration.scope.replace(self.location.origin, "")) !== 0) return;

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
      var network = fetch(req)
        .then(function (res) {
          if (res && res.ok && res.type === "basic") {
            var copy = res.clone();
            caches.open(SHELL).then(function (c) { c.put(req, copy); });
          }
          return res;
        })
        .catch(function () { return hit; });
      return hit || network;
    })
  );
});

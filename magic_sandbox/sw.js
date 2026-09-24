/* Magic Sandbox service worker — the game's shell, cached so it opens
   instantly and plays with no connection.

   CACHE is the game's version: index.html declares the same number as
   window.MS_VERSION, and tools/validate.js refuses to let the two drift.
   Bumping it is what publishes an update — a changed sw.js is what a browser
   notices, and a new cache name is what retires the old shell.

   Models and textures are not in SHELL: the game fetches all of them at boot,
   and the fetch handler below keeps each one the first time it passes, so a
   second visit is fully offline without making the install wait on them. */
var CACHE = "msandbox-v3";
var SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/game.css",
  "./js/main.js",
  "./js/util.js",
  "./js/state.js",
  "./js/save.js",
  "./js/spellcore.js",
  "./js/boons.js",
  "./js/themes.js",
  "./js/icons.js",
  "./js/glyphart.js",
  "./js/gfx.js",
  "./js/fx.js",
  "./js/models.js",
  "./js/world.js",
  "./js/spells.js",
  "./js/enemies.js",
  "./js/player.js",
  "./js/game.js",
  "./js/input.js",
  "./js/audio.js",
  "./js/hud.js",
  "./js/forge.js",
  "./js/menus.js",
  "./js/info.js",
  "./js/update.js",
  "./js/peer.js",
  "./js/modes.js",
  "./js/lobby.js",
  "./js/net.js",
  "./js/fog.js",
  "./js/mpui.js",
  "./vendor/build/three.module.min.js",
  "./vendor/examples/jsm/loaders/GLTFLoader.js",
  "./vendor/examples/jsm/utils/BufferGeometryUtils.js",
  "./vendor/examples/jsm/postprocessing/EffectComposer.js",
  "./vendor/examples/jsm/postprocessing/RenderPass.js",
  "./vendor/examples/jsm/postprocessing/UnrealBloomPass.js",
  "./vendor/examples/jsm/postprocessing/OutputPass.js",
  "./vendor/examples/jsm/postprocessing/ShaderPass.js",
  "./vendor/examples/jsm/postprocessing/MaskPass.js",
  "./vendor/examples/jsm/postprocessing/Pass.js",
  "./vendor/examples/jsm/shaders/CopyShader.js",
  "./vendor/examples/jsm/shaders/LuminosityHighPassShader.js",
  "./vendor/examples/jsm/shaders/OutputShader.js",
  "./assets/manifest.json",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/maskable-512.png",
  "./assets/icons/apple-touch.png"
];

self.addEventListener("install", function (e) {
  /* Deliberately no skipWaiting() here. The first version's worker took over
     the moment it installed, which could swap the code out from under a
     floor in progress. A finished install now waits until the page asks for
     the handover with "skip-waiting" (the player pressed Reload) or every tab
     of the old build has closed.

     cache: "reload" skips the browser's HTTP cache, so a new version's shell
     is never assembled from files the previous deploy left there. */
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
  /* Cache first, and never refreshed in the background: the old worker
     re-fetched every file behind the page's back, which quietly mixed builds.
     A version is replaced whole, by the install above, or not at all. */
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

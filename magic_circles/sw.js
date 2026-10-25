/* Magic Circles service worker — the game's shell, cached so it opens
   instantly and plays with no connection.

   Shape lifted from Magic Sandbox's (magic_sandbox/sw.js), which is the
   house pattern in CLAUDE.md. CACHE is the game's version: index.html
   declares the same number as window.MC_VERSION, and tools/validate.js
   refuses to let the two drift. Bumping it is what publishes an update.

   The models are not in SHELL: the game fetches all of them at boot, and the
   fetch handler below keeps each one the first time it passes, so a second
   visit is fully offline without making the install wait on 4 MB. */
var CACHE = "mcircles-v3";
var SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/game.css",
  "./js/assets.js",
  "./js/audio.js",
  "./js/chunks.js",
  "./js/enemies.js",
  "./js/forge.js",
  "./js/fx.js",
  "./js/game.js",
  "./js/gfx.js",
  "./js/glyphart.js",
  "./js/hud.js",
  "./js/icons.js",
  "./js/info.js",
  "./js/input.js",
  "./js/main.js",
  "./js/map.js",
  "./js/menus.js",
  "./js/physics.js",
  "./js/player.js",
  "./js/presets.js",
  "./js/save.js",
  "./js/spellcore.js",
  "./js/spells.js",
  "./js/state.js",
  "./js/terrain.js",
  "./js/textures.js",
  "./js/topics.js",
  "./js/update.js",
  "./js/util.js",
  "./js/world.js",
  "./vendor/build/three.module.min.js",
  "./vendor/examples/jsm/loaders/GLTFLoader.js",
  "./vendor/examples/jsm/postprocessing/EffectComposer.js",
  "./vendor/examples/jsm/postprocessing/MaskPass.js",
  "./vendor/examples/jsm/postprocessing/OutputPass.js",
  "./vendor/examples/jsm/postprocessing/Pass.js",
  "./vendor/examples/jsm/postprocessing/RenderPass.js",
  "./vendor/examples/jsm/postprocessing/ShaderPass.js",
  "./vendor/examples/jsm/postprocessing/UnrealBloomPass.js",
  "./vendor/examples/jsm/shaders/CopyShader.js",
  "./vendor/examples/jsm/shaders/LuminosityHighPassShader.js",
  "./vendor/examples/jsm/shaders/OutputShader.js",
  "./vendor/examples/jsm/utils/BufferGeometryUtils.js",
  "./vendor/examples/jsm/utils/SkeletonUtils.js",
  "./assets/manifest.json",
  "./icons/mc-192.png",
  "./icons/mc-512.png",
  "./icons/mc-maskable-512.png"
];

self.addEventListener("install", function (e) {
  /* Deliberately no skipWaiting() here. The Phaser build's worker took over
     the moment it installed; a finished install now waits until the page
     asks for the handover with "skip-waiting" (the player pressed Reload) or
     every tab of the old build has closed.

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

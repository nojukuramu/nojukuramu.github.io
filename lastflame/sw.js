/* Last Flame service worker — the game's shell, cached so it opens instantly
   and plays with no connection.

   Lifted from Ballzooka's sw.js (ballzooka/sw.js), which is Bloomworks',
   Aeons', Hacks' and Magic Sandbox's: the house pattern every installable app
   here follows (CLAUDE.md). The worker never takes over by itself, it answers
   "skip-waiting" when the page asks, and CACHE carries the same number as
   window.LF_VERSION in index.html — tools/validate.js refuses to let the two
   drift. Bumping it is what publishes an update. Changed: the shell, which
   is this game's, and holds the house's models, surfaces and sounds too, so a
   night offline sounds and looks like a night online. */
var CACHE = "lastflame-v1";
var SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/lastflame.css",
  "./js/audio.js",
  "./js/creature.js",
  "./js/game.js",
  "./js/house.js",
  "./js/hunter.js",
  "./js/icons.js",
  "./js/info.js",
  "./js/input.js",
  "./js/main.js",
  "./js/nav.js",
  "./js/render.js",
  "./js/rng.js",
  "./js/save.js",
  "./js/textures.js",
  "./js/topics.js",
  "./js/ui.js",
  "./js/update.js",
  "./vendor/build/three.module.min.js",
  "./vendor/jsm/loaders/GLTFLoader.js",
  "./vendor/jsm/postprocessing/EffectComposer.js",
  "./vendor/jsm/postprocessing/MaskPass.js",
  "./vendor/jsm/postprocessing/OutputPass.js",
  "./vendor/jsm/postprocessing/Pass.js",
  "./vendor/jsm/postprocessing/RenderPass.js",
  "./vendor/jsm/postprocessing/ShaderPass.js",
  "./vendor/jsm/postprocessing/UnrealBloomPass.js",
  "./vendor/jsm/shaders/CopyShader.js",
  "./vendor/jsm/shaders/LuminosityHighPassShader.js",
  "./vendor/jsm/shaders/OutputShader.js",
  "./vendor/jsm/utils/BufferGeometryUtils.js",
  "./assets/models/armchair.glb",
  "./assets/models/bed.glb",
  "./assets/models/bench.glb",
  "./assets/models/bookshelf.glb",
  "./assets/models/bucket.glb",
  "./assets/models/candlestick.glb",
  "./assets/models/chair.glb",
  "./assets/models/china_cabinet.glb",
  "./assets/models/commode.glb",
  "./assets/models/crate.glb",
  "./assets/models/dining_table.glb",
  "./assets/models/drawers.glb",
  "./assets/models/gallinera.glb",
  "./assets/models/grandfather_clock.glb",
  "./assets/models/iron_bed.glb",
  "./assets/models/jug.glb",
  "./assets/models/lantern.glb",
  "./assets/models/mirror.glb",
  "./assets/models/nightstand.glb",
  "./assets/models/oil_lamp.glb",
  "./assets/models/painting.glb",
  "./assets/models/palayok.glb",
  "./assets/models/photo.glb",
  "./assets/models/pot.glb",
  "./assets/models/rocking_chair.glb",
  "./assets/models/santo.glb",
  "./assets/models/screen.glb",
  "./assets/models/side_table.glb",
  "./assets/models/sofa.glb",
  "./assets/models/stool.glb",
  "./assets/models/sungka.glb",
  "./assets/models/table.glb",
  "./assets/models/tea_table.glb",
  "./assets/models/vase.glb",
  "./assets/textures/cabinet.webp",
  "./assets/textures/cabinet_arm.webp",
  "./assets/textures/cabinet_n.webp",
  "./assets/textures/ceiling.webp",
  "./assets/textures/ceiling_arm.webp",
  "./assets/textures/ceiling_n.webp",
  "./assets/textures/damaged.webp",
  "./assets/textures/damaged_arm.webp",
  "./assets/textures/damaged_n.webp",
  "./assets/textures/floor.webp",
  "./assets/textures/floor_arm.webp",
  "./assets/textures/floor_n.webp",
  "./assets/textures/panels.webp",
  "./assets/textures/panels_arm.webp",
  "./assets/textures/panels_n.webp",
  "./assets/textures/plaster.webp",
  "./assets/textures/plaster_arm.webp",
  "./assets/textures/plaster_n.webp",
  "./assets/textures/tiles.webp",
  "./assets/textures/tiles_arm.webp",
  "./assets/textures/tiles_n.webp",
  "./assets/sounds/break.mp3",
  "./assets/sounds/breathe.mp3",
  "./assets/sounds/chime.mp3",
  "./assets/sounds/clank.mp3",
  "./assets/sounds/clank2.mp3",
  "./assets/sounds/click.mp3",
  "./assets/sounds/closet_close.mp3",
  "./assets/sounds/closet_open.mp3",
  "./assets/sounds/creak1.mp3",
  "./assets/sounds/creak2.mp3",
  "./assets/sounds/creak3.mp3",
  "./assets/sounds/creak4.mp3",
  "./assets/sounds/creak5.mp3",
  "./assets/sounds/creak6.mp3",
  "./assets/sounds/door_close.mp3",
  "./assets/sounds/door_creak_long.mp3",
  "./assets/sounds/door_open.mp3",
  "./assets/sounds/door_slam.mp3",
  "./assets/sounds/drag.mp3",
  "./assets/sounds/drone1.mp3",
  "./assets/sounds/drone2.mp3",
  "./assets/sounds/exhale.mp3",
  "./assets/sounds/fire.mp3",
  "./assets/sounds/frogs.mp3",
  "./assets/sounds/gasp.mp3",
  "./assets/sounds/growl1.mp3",
  "./assets/sounds/growl2.mp3",
  "./assets/sounds/growl3.mp3",
  "./assets/sounds/growl4.mp3",
  "./assets/sounds/growl5.mp3",
  "./assets/sounds/growl6.mp3",
  "./assets/sounds/heart.mp3",
  "./assets/sounds/howl.mp3",
  "./assets/sounds/ignite.mp3",
  "./assets/sounds/latch.mp3",
  "./assets/sounds/pant.mp3",
  "./assets/sounds/paper.mp3",
  "./assets/sounds/rain.mp3",
  "./assets/sounds/shriek.mp3",
  "./assets/sounds/sneak1.mp3",
  "./assets/sounds/sneak2.mp3",
  "./assets/sounds/sneak3.mp3",
  "./assets/sounds/sneak4.mp3",
  "./assets/sounds/step1.mp3",
  "./assets/sounds/step2.mp3",
  "./assets/sounds/step3.mp3",
  "./assets/sounds/step4.mp3",
  "./assets/sounds/step5.mp3",
  "./assets/sounds/step6.mp3",
  "./assets/sounds/sting1.mp3",
  "./assets/sounds/sting2.mp3",
  "./assets/sounds/sting3.mp3",
  "./assets/sounds/thunder1.mp3",
  "./assets/sounds/thunder2.mp3",
  "./assets/sounds/thunder3.mp3",
  "./assets/sounds/tick.mp3",
  "./assets/sounds/tuko.mp3",
  "./assets/sounds/whisper1.mp3",
  "./assets/sounds/whisper2.mp3",
  "./assets/sounds/whisper3.mp3",
  "./assets/sounds/whisper4.mp3",
  "./assets/sounds/whisper5.mp3",
  "./assets/sounds/wind.mp3",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./icons/apple-touch.png"
];

self.addEventListener("install", function (e) {
  /* Deliberately no skipWaiting() here: a new build installs, parks itself
     in "waiting", and takes over only when the page asks (the player
     pressed Reload) or every tab of the old build has closed. Swapping code
     out from under a night in progress is the failure this avoids.
     cache: "reload" skips the HTTP cache, so a version's shell is never
     assembled from files the previous deploy left there. */
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

/* The Long Light service worker — the game's shell, cached so it opens
   instantly and plays with no connection.

   Lifted from Last Flame's sw.js (lastflame/sw.js), which is Ballzooka's
   (ballzooka/sw.js), Bloomworks', Aeons', Hacks' and Magic Sandbox's: the
   house pattern every installable app here follows (CLAUDE.md). The worker
   never takes over by itself, it answers "skip-waiting" when the page asks,
   and CACHE carries the same number as window.LL_VERSION in index.html —
   tools/validate.js refuses to let the two drift. Bumping it is what
   publishes an update. Changed: the shell, which is this game's — the
   Packed models, surfaces, sounds and samples are in it, so a walk offline
   looks and sounds like one online. The Full set (assets/full/) is not: it
   is fetched the first time it is chosen and kept by the fetch handler. */
var CACHE = "longlight-v1";
var SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/longlight.css",
  "./assets/models/alarm_clock.glb",
  "./assets/models/axe.glb",
  "./assets/models/bed.glb",
  "./assets/models/binoculars.glb",
  "./assets/models/boots.glb",
  "./assets/models/bucket.glb",
  "./assets/models/cans.glb",
  "./assets/models/chair.glb",
  "./assets/models/clipboard.glb",
  "./assets/models/clock.glb",
  "./assets/models/compass.glb",
  "./assets/models/crate.glb",
  "./assets/models/crate_open.glb",
  "./assets/models/desk.glb",
  "./assets/models/drum.glb",
  "./assets/models/fish_knife.glb",
  "./assets/models/generator.glb",
  "./assets/models/jerrycan.glb",
  "./assets/models/jerrycan_green.glb",
  "./assets/models/lantern.glb",
  "./assets/models/lifebuoy.glb",
  "./assets/models/lpg.glb",
  "./assets/models/medical.glb",
  "./assets/models/notebook.glb",
  "./assets/models/postcards.glb",
  "./assets/models/pot.glb",
  "./assets/models/radio.glb",
  "./assets/models/rations.glb",
  "./assets/models/rock_a.glb",
  "./assets/models/rock_b.glb",
  "./assets/models/searchlight.glb",
  "./assets/models/shelves.glb",
  "./assets/models/spade.glb",
  "./assets/models/spectacles.glb",
  "./assets/models/stone_a.glb",
  "./assets/models/stone_b.glb",
  "./assets/models/stool.glb",
  "./assets/models/stove.glb",
  "./assets/models/suitcase.glb",
  "./assets/models/table.glb",
  "./assets/models/thermos.glb",
  "./assets/models/toolbox.glb",
  "./assets/music/cello_43.mp3",
  "./assets/music/cello_50.mp3",
  "./assets/music/cello_53.mp3",
  "./assets/music/cello_57.mp3",
  "./assets/music/cello_60.mp3",
  "./assets/music/piano_45.mp3",
  "./assets/music/piano_49.mp3",
  "./assets/music/piano_53.mp3",
  "./assets/music/piano_57.mp3",
  "./assets/music/piano_61.mp3",
  "./assets/music/piano_65.mp3",
  "./assets/music/piano_69.mp3",
  "./assets/music/piano_73.mp3",
  "./assets/music/piano_77.mp3",
  "./assets/music/piano_81.mp3",
  "./assets/music/piano_85.mp3",
  "./assets/sounds/breath1.mp3",
  "./assets/sounds/breath2.mp3",
  "./assets/sounds/breath3.mp3",
  "./assets/sounds/bubbles.mp3",
  "./assets/sounds/canister.mp3",
  "./assets/sounds/crack1.mp3",
  "./assets/sounds/crack2.mp3",
  "./assets/sounds/crack3.mp3",
  "./assets/sounds/crack4.mp3",
  "./assets/sounds/door_creak.mp3",
  "./assets/sounds/door_slam.mp3",
  "./assets/sounds/eat1.mp3",
  "./assets/sounds/eat2.mp3",
  "./assets/sounds/fire_big.mp3",
  "./assets/sounds/fire_small.mp3",
  "./assets/sounds/flag.mp3",
  "./assets/sounds/floor1.mp3",
  "./assets/sounds/floor2.mp3",
  "./assets/sounds/floor3.mp3",
  "./assets/sounds/generator.mp3",
  "./assets/sounds/ignite.mp3",
  "./assets/sounds/ignite_big.mp3",
  "./assets/sounds/lid.mp3",
  "./assets/sounds/lighter.mp3",
  "./assets/sounds/morse.mp3",
  "./assets/sounds/paper.mp3",
  "./assets/sounds/pebbles.mp3",
  "./assets/sounds/plane.mp3",
  "./assets/sounds/radio_static.mp3",
  "./assets/sounds/radio_sweep.mp3",
  "./assets/sounds/reel.mp3",
  "./assets/sounds/sea.mp3",
  "./assets/sounds/sigh.mp3",
  "./assets/sounds/splash.mp3",
  "./assets/sounds/step1.mp3",
  "./assets/sounds/step2.mp3",
  "./assets/sounds/step3.mp3",
  "./assets/sounds/step4.mp3",
  "./assets/sounds/step5.mp3",
  "./assets/sounds/step6.mp3",
  "./assets/sounds/step7.mp3",
  "./assets/sounds/step8.mp3",
  "./assets/sounds/stepq1.mp3",
  "./assets/sounds/stepq2.mp3",
  "./assets/sounds/stepq3.mp3",
  "./assets/sounds/stepq4.mp3",
  "./assets/sounds/stone1.mp3",
  "./assets/sounds/stone2.mp3",
  "./assets/sounds/stone3.mp3",
  "./assets/sounds/stove_on.mp3",
  "./assets/sounds/tin.mp3",
  "./assets/sounds/wind_calm.mp3",
  "./assets/sounds/wind_howl.mp3",
  "./assets/sounds/wind_inside.mp3",
  "./assets/sounds/wind_strong.mp3",
  "./assets/sounds/wind_whistle.mp3",
  "./assets/sounds/wrapper.mp3",
  "./assets/sounds/zip.mp3",
  "./assets/textures/floor.webp",
  "./assets/textures/floor_arm.webp",
  "./assets/textures/floor_n.webp",
  "./assets/textures/hut_grey.webp",
  "./assets/textures/hut_grey_arm.webp",
  "./assets/textures/hut_grey_n.webp",
  "./assets/textures/hut_red.webp",
  "./assets/textures/hut_red_arm.webp",
  "./assets/textures/hut_red_n.webp",
  "./assets/textures/ice.webp",
  "./assets/textures/ice_arm.webp",
  "./assets/textures/ice_n.webp",
  "./assets/textures/metal.webp",
  "./assets/textures/metal_arm.webp",
  "./assets/textures/metal_n.webp",
  "./assets/textures/planks.webp",
  "./assets/textures/planks_arm.webp",
  "./assets/textures/planks_n.webp",
  "./assets/textures/rock.webp",
  "./assets/textures/rock_arm.webp",
  "./assets/textures/rock_n.webp",
  "./assets/textures/snow_aerial.webp",
  "./assets/textures/snow_aerial_arm.webp",
  "./assets/textures/snow_aerial_n.webp",
  "./assets/textures/snow_soft.webp",
  "./assets/textures/snow_soft_arm.webp",
  "./assets/textures/snow_soft_n.webp",
  "./assets/textures/snow_wind.webp",
  "./assets/textures/snow_wind_arm.webp",
  "./assets/textures/snow_wind_n.webp",
  "./icons/apple-touch.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon.svg",
  "./icons/maskable-512.png",
  "./js/audio.js",
  "./js/game.js",
  "./js/icons.js",
  "./js/info.js",
  "./js/input.js",
  "./js/main.js",
  "./js/places.js",
  "./js/render.js",
  "./js/rng.js",
  "./js/save.js",
  "./js/scenery.js",
  "./js/sky.js",
  "./js/sun.js",
  "./js/terrain.js",
  "./js/textures.js",
  "./js/topics.js",
  "./js/ui.js",
  "./js/update.js",
  "./js/worker.js",
  "./js/world.js",
  "./vendor/build/three.module.min.js",
  "./vendor/jsm/csm/CSM.js",
  "./vendor/jsm/csm/CSMFrustum.js",
  "./vendor/jsm/csm/CSMShader.js",
  "./vendor/jsm/loaders/GLTFLoader.js",
  "./vendor/jsm/objects/Sky.js",
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
  "./vendor/simplex-noise/simplex-noise.js"
];

self.addEventListener("install", function (e) {
  /* Deliberately no skipWaiting() here: a new build installs, parks itself
     in "waiting", and takes over only when the page asks (the player
     pressed Reload) or every tab of the old build has closed. Swapping code
     out from under a walk in progress is the failure this avoids.
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
    /* the Full set is kept across versions: it is big, and it does not change
       with the code (its own cache, below) */
    return Promise.all(keys.map(function (k) { return k === CACHE || k === FULL ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

var FULL = "longlight-full";
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  var full = url.pathname.indexOf("/assets/full/") >= 0;
  /* Cache first, never refreshed behind the page's back: a version is
     replaced whole, by the install above, or not at all. */
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === "basic") {
          var copy = res.clone();
          caches.open(full ? FULL : CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        if (req.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      });
    })
  );
});

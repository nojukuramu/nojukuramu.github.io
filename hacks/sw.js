/* Hacks service worker — the game's shell, cached so it opens instantly
   and plays with no connection.

   The shape is Magic Sandbox's sw.js, the house pattern every installable
   app here follows (CLAUDE.md): the worker never takes over by itself, it
   answers "skip-waiting" when the page asks, and CACHE carries the same
   number as window.HK_VERSION in index.html — tools/validate.js refuses to
   let the two drift. Bumping it is what publishes an update. */
var CACHE = "hacks-v4";
var SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/game.css",
  "./js/main.js",
  "./js/clock.js",
  "./js/state.js",
  "./js/util.js",
  "./js/save.js",
  "./js/controls.js",
  "./js/brush.js",
  "./js/movement.js",
  "./js/map.js",
  "./js/nav.js",
  "./js/skeleton.js",
  "./js/weapons.js",
  "./js/modes.js",
  "./js/game.js",
  "./js/bots.js",
  "./js/render.js",
  "./js/models.js",
  "./js/rig.js",
  "./js/figures.js",
  "./js/viewmodel.js",
  "./js/orient.js",
  "./js/input.js",
  "./js/touch.js",
  "./js/hud.js",
  "./js/audio.js",
  "./js/medals.js",
  "./js/menus.js",
  "./js/icons.js",
  "./js/info.js",
  "./js/update.js",
  "./js/hackapi.js",
  "./js/hackworker.js",
  "./js/hackui.js",
  "./js/hackdocs.js",
  "./js/editor.js",
  "./js/peer.js",
  "./js/lobby.js",
  "./js/net.js",
  "./js/mpui.js",
  "./vendor/build/three.module.min.js",
  "./vendor/jsm/loaders/GLTFLoader.js",
  "./vendor/jsm/utils/BufferGeometryUtils.js",
  "./vendor/jsm/utils/SkeletonUtils.js",
  "./vendor/jsm/environments/RoomEnvironment.js",
  "./assets/models/kestrel.glb",
  "./assets/models/hornet.glb",
  "./assets/models/wasp.glb",
  "./assets/models/brick.glb",
  "./assets/models/mauler.glb",
  "./assets/models/talon.glb",
  "./assets/models/katana.glb",
  "./assets/models/lancer.glb",
  "./assets/models/human.glb",
  "./assets/sounds/bolt.mp3",
  "./assets/sounds/brick.mp3",
  "./assets/sounds/brick_far.mp3",
  "./assets/sounds/chop.mp3",
  "./assets/sounds/clank.mp3",
  "./assets/sounds/clip.mp3",
  "./assets/sounds/condor.mp3",
  "./assets/sounds/condor_far.mp3",
  "./assets/sounds/dink.mp3",
  "./assets/sounds/draw.mp3",
  "./assets/sounds/grunt.mp3",
  "./assets/sounds/hornet.mp3",
  "./assets/sounds/hornet_far.mp3",
  "./assets/sounds/kestrel.mp3",
  "./assets/sounds/kestrel_far.mp3",
  "./assets/sounds/mauler.mp3",
  "./assets/sounds/mauler_far.mp3",
  "./assets/sounds/pump.mp3",
  "./assets/sounds/rack.mp3",
  "./assets/sounds/reload_mag.mp3",
  "./assets/sounds/reload_rifle.mp3",
  "./assets/sounds/shell.mp3",
  "./assets/sounds/slice.mp3",
  "./assets/sounds/slice2.mp3",
  "./assets/sounds/step1.mp3",
  "./assets/sounds/step2.mp3",
  "./assets/sounds/step3.mp3",
  "./assets/sounds/step4.mp3",
  "./assets/sounds/talon.mp3",
  "./assets/sounds/talon_far.mp3",
  "./assets/sounds/vo_annihilation.mp3",
  "./assets/sounds/vo_combo_breaker.mp3",
  "./assets/sounds/vo_dominating.mp3",
  "./assets/sounds/vo_double_kill.mp3",
  "./assets/sounds/vo_fight.mp3",
  "./assets/sounds/vo_final_round.mp3",
  "./assets/sounds/vo_first_blood.mp3",
  "./assets/sounds/vo_flawless_victory.mp3",
  "./assets/sounds/vo_game_over.mp3",
  "./assets/sounds/vo_headshot.mp3",
  "./assets/sounds/vo_killshot.mp3",
  "./assets/sounds/vo_multi_kill.mp3",
  "./assets/sounds/vo_precision_kill.mp3",
  "./assets/sounds/vo_rampage.mp3",
  "./assets/sounds/vo_revenge_kill.mp3",
  "./assets/sounds/vo_round_winner.mp3",
  "./assets/sounds/vo_team_deathmatch.mp3",
  "./assets/sounds/vo_triple_kill.mp3",
  "./assets/sounds/vo_unstoppable.mp3",
  "./assets/sounds/wasp.mp3",
  "./assets/sounds/wasp_far.mp3",
  "./assets/sounds/yelp.mp3",
  "./assets/icons/icon.svg",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/maskable-512.png",
  "./assets/icons/apple-touch.png"
];

self.addEventListener("install", function (e) {
  /* Deliberately no skipWaiting() here: a new build installs, parks itself
     in "waiting", and takes over only when the page asks (the player
     pressed Reload) or every tab of the old build has closed. Swapping code
     out from under a match in progress is the failure this avoids.
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

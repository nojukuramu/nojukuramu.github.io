/* ============================================================
   RouteCast — noticing that a new version exists

   A service worker makes an app open instantly and work with no signal by
   serving a copy of itself from a cache. The cost of that is the one failure
   nobody reports as a bug: a phone quietly running a build from three deploys
   ago, with a fix in it that the rider was told about and cannot see.

   The shape here is the one The Wolf Game and KaraokeNatin already use in
   this repository, deliberately — including the `"skip-waiting"` message, so
   the three apps' service workers answer the same word. What is new is the
   half RouteCast specifically needs:

     **An update never takes over mid-ride.** The old sw.js called
     `skipWaiting()` inside install, which means a deploy could swap the code
     under a rider halfway to somewhere. It no longer does. A new worker
     installs, parks itself in `waiting`, and the page offers it. The rider
     decides when.

   How an update is noticed
   -----------------------
     * on load, and then every 30 minutes while the page is visible
     * whenever the page comes back from hidden, at most that often
     * whenever the network comes back
   Each check is one conditional request for sw.js, which is a few hundred
   bytes when nothing has changed. That is the entire cost.

   How it is offered
   -----------------
   One bar at the top, above the map, with two buttons: reload, or later.
   It is the only thing in this app allowed to appear over the map
   unprompted, and it earns that by being one line high and dismissible. While
   a ride is running it is quieter still — the offer stands, but reloading is
   confirmed first, because a reload ends the ride in progress.
   ============================================================ */
var RC = RC || {};

RC.update = (function (global) {
  "use strict";

  var CHECK_MS = 30 * 60 * 1000;
  // update() resolves the moment a new worker STARTS installing, so a manual
  // check has to wait a beat before it can honestly say "you are up to date".
  var SETTLE_MS = 1500;

  var reg = null;
  var ready = false;          // a new build is installed and waiting
  var reloading = false;
  var hadController = false;
  var lastCheckAt = 0;
  var dismissed = false;
  var onState = null;

  function version() { return (global.RC_VERSION || "?"); }

  function fire() {
    if (typeof onState === "function") { try { onState(api.state()); } catch (e) {} }
  }

  /* ---------------------------------------------------------
     The bar
     --------------------------------------------------------- */
  function render() {
    var bar = RC.el("update-bar");
    if (!bar) return;
    bar.hidden = !(ready && !dismissed);
    fire();
  }

  function announce() {
    if (ready) { render(); return; }
    ready = true;
    dismissed = false;
    render();
  }

  /* ---------------------------------------------------------
     Watching the registration
     --------------------------------------------------------- */
  function watch(worker) {
    if (!worker) return;
    worker.addEventListener("statechange", function () {
      // A worker reaching "installed" while another is already in charge is
      // by definition a newer build waiting its turn. Without a controller it
      // is simply the first install, which is not an update.
      if (worker.state === "installed" && navigator.serviceWorker.controller) announce();
    });
  }

  function check(manual) {
    if (ready) { if (manual) { dismissed = false; render(); } return Promise.resolve("ready"); }
    if (!reg) return Promise.resolve("unsupported");
    lastCheckAt = Date.now();
    return reg.update().then(function () {
      return new Promise(function (resolve) {
        setTimeout(function () {
          if (reg.waiting) { announce(); resolve("ready"); return; }
          resolve(reg.installing ? "downloading" : "current");
        }, SETTLE_MS);
      });
    }, function () { return "offline"; });
  }

  function apply() {
    if (reg && reg.waiting) {
      // The waiting worker takes over, which fires controllerchange below and
      // reloads us onto the new build. The timeout is the belt to that brace:
      // a worker that refuses to hand over must not leave a dead button.
      reg.waiting.postMessage("skip-waiting");
      setTimeout(function () {
        if (!reloading) { reloading = true; location.reload(); }
      }, 2000);
      return;
    }
    reloading = true;
    location.reload();
  }

  var api = {
    init: function (registration) {
      var bar = RC.el("update-bar");
      if (bar) {
        var go = RC.el("update-go");
        var later = RC.el("update-later");
        if (go) go.addEventListener("click", api.apply);
        if (later) later.addEventListener("click", function () {
          // Dismissed for this page load only. The build is still waiting, and
          // the You tab still offers it — but the map gets its line back.
          dismissed = true;
          render();
        });
      }

      if (!("serviceWorker" in navigator)) { fire(); return; }
      if (!registration) { fire(); return; }

      reg = registration;
      hadController = !!navigator.serviceWorker.controller;

      if (reg.waiting && hadController) announce();
      watch(reg.installing);
      reg.addEventListener("updatefound", function () { watch(reg.installing); });

      navigator.serviceWorker.addEventListener("controllerchange", function () {
        // The first worker claiming a page that had none is an install, not an
        // update, and reloading for it would be a flash on somebody's very
        // first visit.
        if (!hadController || reloading) return;
        reloading = true;
        location.reload();
      });

      check(false);

      try {
        document.addEventListener("visibilitychange", function () {
          if (document.hidden || Date.now() - lastCheckAt < CHECK_MS) return;
          check(false);
        });
        global.addEventListener("online", function () { check(false); });
      } catch (e) {}
      setInterval(function () { if (!document.hidden) check(false); }, CHECK_MS);
      fire();
    },

    /** Ask now. Returns "ready", "downloading", "current", "offline" or
        "unsupported" — the words the You tab reports back. */
    check: function () { return check(true); },

    apply: function () {
      // A reload ends a ride in progress, which is worth one question and not
      // worth a dialog at any other time.
      var riding = (RC.nav && RC.nav.isActive && RC.nav.isActive()) ||
                   (RC.free && RC.free.isActive && RC.free.isActive());
      if (riding && !global.confirm("Reloading ends the ride you are recording. Update now?")) return;
      apply();
    },

    isReady: function () { return ready; },
    version: version,
    supported: function () { return "serviceWorker" in navigator; },

    state: function () {
      return { ready: ready, dismissed: dismissed, version: version(), supported: api.supported() };
    },

    onState: function (fn) { onState = fn; fire(); }
  };

  return api;
})(typeof window !== "undefined" ? window : globalThis);

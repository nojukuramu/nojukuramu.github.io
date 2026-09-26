/* ARCO — update.js
 * Noticing that a new version exists, and offering it.
 *
 * Lifted from routecast/static/js/update.js, which is the shape The Wolf Game
 * and KaraokeNatin use too — including the "skip-waiting" message, so every
 * service worker in this repository answers the same word. Changed: the
 * namespace, the element ids, and apply(), which here has nothing to confirm:
 * a reload stops whatever is ringing and loses nothing else.
 *
 * How an update is noticed: on load, every 30 minutes while visible, when the
 * page comes back from hidden, and when the network returns — each one a
 * conditional request for sw.js. How it is offered: one dismissible line at
 * the top, and a version line in Setup with a manual check.
 *
 * The old sw.js called skipWaiting() inside install, which let a deploy swap
 * the code out mid-song. It no longer does; the player decides when.
 */
window.ARCO = window.ARCO || {};

window.ARCO.update = (function (global) {
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

  function version() { return (global.ARCO_VERSION || "?"); }

  function fire() {
    if (typeof onState === "function") { try { onState(api.state()); } catch (e) {} }
  }

  /* ---------------------------------------------------------
     The bar
     --------------------------------------------------------- */
  function render() {
    var bar = el("update-bar");
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

  function el(id) { return document.getElementById(id); }

  var api = {
    init: function (registration) {
      var bar = el("update-bar");
      if (bar) {
        var go = el("update-go");
        var later = el("update-later");
        if (go) go.addEventListener("click", api.apply);
        if (later) later.addEventListener("click", function () {
          // Dismissed for this page load only. The build is still waiting, and
          // Setup still offers it — but the neck gets its line back.
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
        "unsupported" — the words Setup reports back. */
    check: function () { return check(true); },

    apply: function () { apply(); },

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

/* ============================================================
   KomyutApp — noticing that a new version exists

   Lifted whole from routecast/static/js/update.js, with the namespace
   changed from RC to KM and the "is a ride in progress" question replaced
   by this app's version of it. Everything else — the check schedule, the
   `"skip-waiting"` word the worker answers to, the controllerchange guard
   that tells an install apart from an update — is RouteCast's, unchanged,
   because three apps in this repository already answer the same word and a
   fourth dialect of the same conversation would help nobody.

   The pattern, stated once:

     * The worker never takes over on its own. A new build installs, parks
       itself in `waiting`, and stays there.
     * The page offers it in one dismissible line, and the person decides.
     * Checks happen on load, every 30 minutes while visible, on coming
       back from hidden, and when the network returns. Each is one
       conditional request for sw.js.
     * The page declares KM_VERSION and sw.js carries the same number in
       its cache name; tools/validate.js refuses to let the two drift.

   What is different here: the thing a reload would interrupt is a route
   being filed, not a ride being recorded. The builder keeps its draft on
   the phone, so a reload costs nothing — but a half-typed description is
   still worth one question.
   ============================================================ */
var KM = KM || {};

KM.update = (function (global) {
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

  function version() { return (global.KM_VERSION || "?"); }

  function fire() {
    if (typeof onState === "function") { try { onState(api.state()); } catch (e) {} }
  }

  /* ---------------------------------------------------------
     The bar
     --------------------------------------------------------- */
  function render() {
    var bar = KM.el("update-bar");
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
      var bar = KM.el("update-bar");
      if (bar) {
        var go = KM.el("update-go");
        var later = KM.el("update-later");
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
      // A reload throws away whatever is typed but not saved, which is
      // worth one question and not worth a dialog at any other time.
      var mid = !!(KM.builder && KM.builder._stops && KM.builder._stops().length);
      if (mid && !global.confirm("You are part way through filing a route. The stops are kept, but anything typed and not saved is not. Update now?")) return;
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

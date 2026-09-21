/* ============================================================
   KomyutApp — installing, and staying up to date

   Registers the service worker and hands the registration to KM.update,
   which owns the whole "a new version is waiting" conversation. Nothing
   here decides when to take an update; that is deliberately one module's
   job and it is not this one.

   Also carries the install prompt. The browser only offers it once, at a
   moment of its choosing, so the event is caught and held until somebody
   presses the button — which is the only way an install button can exist
   at all.
   ============================================================ */
(function () {
  "use strict";

  var deferred = null;

  function showInstall(on) {
    var btn = KM.el("install-btn");
    if (btn) btn.hidden = !on;
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    showInstall(true);
  });

  window.addEventListener("appinstalled", function () {
    deferred = null;
    showInstall(false);
    if (KM.app) KM.app.toast("Installed. It works with no signal now.");
  });

  function wire() {
    var btn = KM.el("install-btn");
    if (btn) {
      btn.addEventListener("click", function () {
        if (!deferred) return;
        deferred.prompt();
        deferred.userChoice.then(function () {
          deferred = null;
          showInstall(false);
        });
      });
    }

    var v = KM.el("version-text");
    if (v) v.textContent = "v" + (window.KM_VERSION || "?");

    if (!("serviceWorker" in navigator)) {
      KM.update.init(null);
      return;
    }
    /* Registered after load rather than during it: the worker's install
       fetches the whole shell, and racing that against the first paint on
       a phone on mobile data makes the first visit slower for no gain. */
    navigator.serviceWorker.register("sw.js").then(function (reg) {
      KM.update.init(reg);
    }, function () {
      KM.update.init(null);
    });
  }

  if (document.readyState === "complete") wire();
  else window.addEventListener("load", wire);
})();

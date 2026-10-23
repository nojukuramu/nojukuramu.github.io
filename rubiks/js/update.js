/* Rubiks — update watcher
   Lifted from routecast/static/js/update.js and hacks/js/update.js.
   Same shape: the worker waits, the page watches and asks, the user decides. */
"use strict";

var RK = RK || {};

RK.update = (function (global) {
  var CHECK_MS = 30 * 60 * 1000;
  var SETTLE_MS = 1500;

  var reg = null;
  var ready = false;
  var reloading = false;
  var hadController = false;
  var lastCheckAt = 0;
  var dismissed = false;

  function version() { return (global.RK_VERSION || "?"); }

  function render() {
    var bar = document.getElementById("update-bar");
    if (!bar) return;
    bar.hidden = !(ready && !dismissed);
  }

  function announce() {
    if (ready) { render(); return; }
    ready = true;
    dismissed = false;
    render();
  }

  function watch(worker) {
    if (!worker) return;
    worker.addEventListener("statechange", function () {
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
      reg.waiting.postMessage("skip-waiting");
      setTimeout(function () {
        if (!reloading) { reloading = true; location.reload(); }
      }, 2000);
      return;
    }
    reloading = true;
    location.reload();
  }

  return {
    init: function (registration) {
      var bar = document.getElementById("update-bar");
      if (bar) {
        var go = document.getElementById("update-go");
        var later = document.getElementById("update-later");
        if (go) go.addEventListener("click", apply);
        if (later) later.addEventListener("click", function () {
          dismissed = true;
          render();
        });
      }

      if (!("serviceWorker" in navigator)) return;
      if (!registration) return;

      reg = registration;
      hadController = !!navigator.serviceWorker.controller;

      if (reg.waiting && hadController) announce();
      watch(reg.installing);
      reg.addEventListener("updatefound", function () { watch(reg.installing); });

      navigator.serviceWorker.addEventListener("controllerchange", function () {
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
    },

    check: function () { return check(true); },
    apply: apply,
    isReady: function () { return ready; },
    version: version
  };
})(typeof window !== "undefined" ? window : globalThis);

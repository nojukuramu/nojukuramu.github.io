/* Rubiks — keep the screen on
 *
 * The takeWakeLock / dropWakeLock pair from routecast/static/js/background.js,
 * without the rest of that module: a timer needs the screen awake between
 * solves on a phone propped against something, nothing more. The browser
 * drops the lock whenever the page is hidden, so it is taken again on return. */
"use strict";

var RK = RK || {};

RK.wake = (function (global) {
  var enabled = false, wakeLock = null, busy = false;

  function hidden() {
    try { return document.visibilityState === "hidden"; } catch (e) { return false; }
  }

  function take() {
    if (!enabled || wakeLock || busy || hidden()) return;
    var wl = global.navigator && navigator.wakeLock;
    if (!wl || !wl.request) return;
    busy = true;
    try {
      wl.request("screen").then(function (lock) {
        busy = false;
        if (!enabled) { try { lock.release(); } catch (e) {} return; }
        wakeLock = lock;
        try { lock.addEventListener("release", function () { if (wakeLock === lock) wakeLock = null; }); } catch (e) {}
      }, function () { busy = false; });
    } catch (e) { busy = false; }
  }

  function drop() {
    if (!wakeLock) return;
    try { wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }

  try { document.addEventListener("visibilitychange", function () { if (!hidden()) take(); }); } catch (e) {}

  return {
    set: function (on) { enabled = !!on; if (enabled) take(); else drop(); },
    /* Chrome refuses a request outside a gesture on some pages; every press
       of the timer is one, so the app nudges here as well. */
    nudge: take
  };
})(typeof window !== "undefined" ? window : globalThis);

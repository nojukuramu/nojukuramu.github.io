/* ARCO — shell.js
 * Fullscreen, orientation lock, and installation.
 *
 * An instrument wants the whole screen: browser chrome eats the top of the fan,
 * and a stray edge-swipe in the middle of a strum is a wrong note. So there are
 * three ways in, in increasing order of permanence:
 *
 *   1. Double-tap the portrait screen — goes fullscreen and rotates for you.
 *   2. The ⛶ button — fullscreen at any time.
 *   3. Install it — launches fullscreen and landscape with no chrome at all,
 *      and works with no network, since nothing here is streamed.
 *
 * iPhone Safari has no Fullscreen API and no orientation lock, so on that one
 * platform installing is the only real route to fullscreen. The UI says so
 * rather than offering a button that silently does nothing.
 */
window.ARCO = window.ARCO || {};
(function (A) {
  "use strict";

  var deferredPrompt = null;
  var listeners = [];
  function emit() {
    for (var i = 0; i < listeners.length; i++) listeners[i](status());
  }

  var isIOS = /iP(hone|ad|od)/.test(navigator.platform || "") ||
    (/Mac/.test(navigator.platform || "") && navigator.maxTouchPoints > 1) ||
    /iPhone|iPad|iPod/.test(navigator.userAgent);

  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function canFullscreen() {
    var el = document.documentElement;
    return !!(el.requestFullscreen || el.webkitRequestFullscreen);
  }

  function isInstalled() {
    return (window.matchMedia && (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches
    )) || window.navigator.standalone === true;
  }

  function status() {
    return {
      fullscreen: !!fsElement(),
      canFullscreen: canFullscreen(),
      installed: isInstalled(),
      installable: !!deferredPrompt,
      ios: isIOS
    };
  }

  function requestFullscreen() {
    var el = document.documentElement;
    var fn = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!fn) return Promise.reject(new Error("no-fullscreen"));
    try {
      var r = fn.call(el, { navigationUI: "hide" });
      return r && r.then ? r : Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function exitFullscreen() {
    var fn = document.exitFullscreen || document.webkitExitFullscreen;
    if (!fn || !fsElement()) return Promise.resolve();
    try {
      var r = fn.call(document);
      return r && r.then ? r : Promise.resolve();
    } catch (e) {
      return Promise.resolve();
    }
  }

  function lockLandscape() {
    var o = screen.orientation;
    if (!o || !o.lock) return Promise.reject(new Error("no-lock"));
    try {
      var r = o.lock("landscape");
      return r && r.then ? r : Promise.resolve();
    } catch (e) {
      return Promise.reject(e);
    }
  }

  /* Fullscreen first, then the rotation lock — Chrome only honours a lock while
   * the document is actually fullscreen. Both are best-effort: plenty of
   * browsers refuse one or the other, and refusing is not an error worth
   * interrupting anyone over. Resolves with what actually happened. */
  function goImmersive() {
    var got = { fullscreen: false, locked: false };
    return requestFullscreen()
      .then(function () { got.fullscreen = true; })
      .catch(function () {})
      .then(function () {
        return lockLandscape()
          .then(function () { got.locked = true; })
          .catch(function () {});
      })
      .then(function () {
        emit();
        return got;
      });
  }

  function toggleFullscreen() {
    if (fsElement()) return exitFullscreen().then(function () { emit(); return status(); });
    return goImmersive().then(status);
  }

  function install() {
    if (!deferredPrompt) return Promise.resolve("unavailable");
    var p = deferredPrompt;
    deferredPrompt = null;
    emit();
    p.prompt();
    return p.userChoice.then(function (c) {
      return c && c.outcome ? c.outcome : "dismissed";
    }).catch(function () { return "dismissed"; });
  }

  /* Two taps in quick succession, close together. Deliberately bound only to
   * the portrait screen — the playing surface must never treat a fast repeat
   * tap as a gesture, because that is exactly what tremolo picking is. */
  function onDoubleTap(el, fn) {
    var lastT = 0, lastX = 0, lastY = 0;
    el.addEventListener("pointerup", function (e) {
      var now = performance.now();
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      if (now - lastT < 420 && (dx * dx + dy * dy) < 60 * 60) {
        lastT = 0;
        fn(e);
      } else {
        lastT = now;
        lastX = e.clientX;
        lastY = e.clientY;
      }
    });
  }

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol === "file:") return;
    navigator.serviceWorker.register("sw.js").catch(function () {
      /* Installability is a bonus; the app runs fine without it. */
    });
  }

  function init() {
    registerSW();

    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;
      emit();
    });
    window.addEventListener("appinstalled", function () {
      deferredPrompt = null;
      emit();
    });

    document.addEventListener("fullscreenchange", emit);
    document.addEventListener("webkitfullscreenchange", emit);
  }

  A.shell = {
    init: init,
    status: status,
    goImmersive: goImmersive,
    toggleFullscreen: toggleFullscreen,
    exitFullscreen: exitFullscreen,
    install: install,
    onDoubleTap: onDoubleTap,
    isInstalled: isInstalled,
    on: function (fn) { listeners.push(fn); }
  };
})(window.ARCO);

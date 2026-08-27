/* ============================================================
   RouteCast — install-to-home-screen and full-screen chrome.
   No modules, no build step. Hangs off RC where useful.
   ============================================================ */
(function () {
  "use strict";

  var DISMISS_DAYS = 30;
  var DISMISS_MS = DISMISS_DAYS * 24 * 60 * 60 * 1000;

  /* ---------------------------------------------------------
     Platform sniffing
     --------------------------------------------------------- */
  function isStandalone() {
    try {
      // The manifest declares display_override, so an installed app can report
      // fullscreen or minimal-ui rather than standalone. Checking only
      // standalone left the install button showing inside the installed app.
      return (window.matchMedia && (
          window.matchMedia("(display-mode: standalone)").matches ||
          window.matchMedia("(display-mode: fullscreen)").matches ||
          window.matchMedia("(display-mode: minimal-ui)").matches)) ||
        window.navigator.standalone === true;
    } catch (e) { return false; }
  }

  function isIOS() {
    var ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/.test(ua)) return true;
    // iPadOS 13+ reports as "Macintosh" but exposes multi-touch.
    if (/Macintosh/.test(ua) && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) return true;
    return false;
  }

  function isIOSSafari() {
    if (!isIOS()) return false;
    var ua = navigator.userAgent || "";
    // Other iOS browsers embed WebKit too but identify themselves; none of
    // them can drive the "Add to Home Screen" install flow.
    return !/CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua);
  }

  function dismissedRecently() {
    var at = RC.store.get("installDismissedAt", 0);
    return at && (Date.now() - at) < DISMISS_MS;
  }

  function rememberDismissal() {
    RC.store.set("installDismissedAt", Date.now());
  }

  /* ---------------------------------------------------------
     Install button
     --------------------------------------------------------- */
  var installBtn = RC.el("install-btn");
  var deferredPrompt = null;

  function showInstallBtn() {
    if (installBtn) installBtn.hidden = false;
  }

  function hideInstallBtn() {
    if (installBtn) installBtn.hidden = true;
  }

  function flashStatus(msg) {
    var el = RC.el("status");
    if (!el || el.textContent) return; // don't clobber something already showing
    el.textContent = msg;
    setTimeout(function () {
      if (el.textContent === msg) el.textContent = "";
    }, 4000);
  }

  if (!isStandalone()) {
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;
      if (!dismissedRecently()) showInstallBtn();
    });

    window.addEventListener("appinstalled", function () {
      deferredPrompt = null;
      hideInstallBtn();
      flashStatus("RouteCast is installed.");
    });

    if (installBtn) {
      installBtn.addEventListener("click", function () {
        if (deferredPrompt) {
          var evt = deferredPrompt;
          deferredPrompt = null;
          evt.prompt();
          evt.userChoice.then(function (choice) {
            if (choice && choice.outcome === "accepted") {
              hideInstallBtn();
            } else {
              rememberDismissal();
            }
          }, function () {
            rememberDismissal();
          });
        } else if (isIOSSafari()) {
          openIOSInstall();
        }
      });
    }

    // iOS Safari never fires beforeinstallprompt — offer the button anyway
    // and point it at the manual instructions instead.
    if (isIOSSafari() && !dismissedRecently()) {
      showInstallBtn();
    }
  }

  /* ---------------------------------------------------------
     iOS manual-install instructions card
     --------------------------------------------------------- */
  var iosCard = RC.el("ios-install");
  var iosScrim = RC.el("ios-install-scrim");
  var iosClose = RC.el("ios-install-close");

  function openIOSInstall() {
    if (!iosCard) return;
    iosCard.hidden = false;
  }

  function closeIOSInstall() {
    if (!iosCard) return;
    iosCard.hidden = true;
    rememberDismissal();
  }

  if (iosClose) iosClose.addEventListener("click", closeIOSInstall);
  if (iosScrim) iosScrim.addEventListener("click", closeIOSInstall);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && iosCard && !iosCard.hidden) closeIOSInstall();
  });

  /* ---------------------------------------------------------
     Full screen
     --------------------------------------------------------- */
  var fsBtn = RC.el("fullscreen-btn");
  var root = document.documentElement;

  function fsSupported() {
    return !!(root.requestFullscreen || root.webkitRequestFullscreen);
  }

  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function requestFs() {
    if (root.requestFullscreen) return root.requestFullscreen();
    if (root.webkitRequestFullscreen) { root.webkitRequestFullscreen(); return Promise.resolve(); }
    return Promise.reject(new Error("Full screen is not supported."));
  }

  function exitFs() {
    if (document.exitFullscreen) return document.exitFullscreen();
    if (document.webkitExitFullscreen) { document.webkitExitFullscreen(); return Promise.resolve(); }
    return Promise.reject(new Error("Full screen is not supported."));
  }

  function syncFsState() {
    var on = isFullscreen();
    if (fsBtn) fsBtn.setAttribute("aria-pressed", String(on));
    root.setAttribute("data-fullscreen", on ? "on" : "off");
    RC.store.set("fullscreen", on);
  }

  if (fsSupported()) {
    document.addEventListener("fullscreenchange", syncFsState);
    document.addEventListener("webkitfullscreenchange", syncFsState);

    if (fsBtn) {
      fsBtn.addEventListener("click", function () {
        var p = isFullscreen() ? exitFs() : requestFs();
        if (p && p.catch) p.catch(function () { /* user gesture required elsewhere, or denied */ });
      });
    }

    // Reapplying full screen on load needs a user gesture in virtually every
    // browser, so wait for the first interaction and try then; if the
    // browser refuses, drop the remembered preference silently.
    if (RC.store.get("fullscreen", false)) {
      var tryReapply = function () {
        document.removeEventListener("click", tryReapply, true);
        document.removeEventListener("keydown", tryReapply, true);
        document.removeEventListener("touchend", tryReapply, true);
        if (!isFullscreen()) {
          var p = requestFs();
          if (p && p.catch) p.catch(function () { /* silently give up */ });
        }
      };
      document.addEventListener("click", tryReapply, true);
      document.addEventListener("keydown", tryReapply, true);
      document.addEventListener("touchend", tryReapply, true);
    }

    syncFsState();
  } else {
    // iPhone Safari has no Fullscreen API at all — hide the dead control
    // and lean on the install-to-home-screen path instead, which is how
    // full screen actually happens there.
    if (fsBtn) fsBtn.hidden = true;
    if (isIOS() && !isStandalone() && !dismissedRecently()) {
      showInstallBtn();
    }
  }
})();

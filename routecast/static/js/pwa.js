/* ============================================================
   RouteCast — install to home screen.
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
      // display_override can land an installed app on minimal-ui rather than
      // standalone, and an old install may still report fullscreen. Checking
      // only standalone left the install button showing inside the app.
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
     No full screen

     RouteCast used to have a button that asked the browser for the whole
     display — notification bar and all. It was removed on purpose. A rider
     hiding the clock, the signal bars and the battery meter behind a map is
     giving up the three pieces of information a phone on a handlebar is
     best at, and getting a strip of tiles back for them. The manifest asks
     for `standalone` rather than `fullscreen` for the same reason: installed
     or not, the status bar stays on the screen.

     The iOS install path survives, because on iPhone "add to home screen" is
     the only thing that ever removed the browser chrome, and removing the
     browser's own chrome is not the same as hiding the system's.
     --------------------------------------------------------- */
  if (isIOS() && !isStandalone() && !dismissedRecently()) showInstallBtn();

  // A preference left over from the button, and the attribute it set. Both
  // are cleared once so an upgrading install does not stay stuck in a mode
  // it can no longer leave.
  try {
    if (RC.store.get("fullscreen", null) !== null) {
      RC.store.set("fullscreen", null);
      if (document.exitFullscreen && document.fullscreenElement) document.exitFullscreen();
      else if (document.webkitExitFullscreen && document.webkitFullscreenElement) document.webkitExitFullscreen();
    }
  } catch (e) {}
  document.documentElement.removeAttribute("data-fullscreen");
})();

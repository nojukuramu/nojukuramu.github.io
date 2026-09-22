/* ============================================================
   TheCommuters — the shell

   Boots the modules in order, owns the sheet and the tab bar, and provides
   the two things every other module needs and none of them should own:
   a one-line toast, and "let the user pick a point on the map".

   The layout rule, once, because every module depends on it: THE MAP IS
   THE SCREEN. The rail is a row of buttons over it, the tab bar is a strip
   under it, and the sheet rises over the bottom of it on purpose and goes
   away on purpose. Nothing is half open, nothing reflows the map, and no
   pane owns the middle of the display.
   ============================================================ */
var KM = KM || {};

KM.app = (function () {
  "use strict";

  var PANES = {
    find:   { title: "Find a trip",     icon: "search",   module: "planner" },
    browse: { title: "Routes",          icon: "route",    module: "browse" },
    build:  { title: "File a route",    icon: "plus",     module: "builder" },
    you:    { title: "You",             icon: "user",     module: "account" }
  };

  var current = "find";
  var sheet, toastEl, toastTimer = null;
  var picking = null;

  function init() {
    sheet = KM.el("sheet");
    toastEl = KM.el("toast");

    paintChrome();

    KM.map.init();
    KM.info.init();
    KM.finder.init();
    KM.detail.init();
    KM.planner.init();
    KM.browse.init();
    KM.builder.init();
    KM.auth.init();
    KM.account.init();

    wireTabs();
    wireRail();
    wirePickBar();

    KM.supa.init();
    KM.account.paint();

    /* The sheet starts open, because an app that opens on a bare map is an
       app that asks "now what". Which pane depends on how we got here:
       KM.supa.init() has just read the URL for a confirmation or reset
       link, and one of those has something to do in You. */
    var landing = KM.supa.landing();
    openTab(KM.account.landingTab(landing), { open: true });
    KM.account.landed(landing);

    /* A phone rotating, or a keyboard appearing, changes the map's box. */
    window.addEventListener("resize", KM.debounce(function () { KM.map.invalidate(); }, 200));
  }

  /* ---------------------------------------------------------
     The chrome that carries icons rather than text
     --------------------------------------------------------- */
  function paintChrome() {
    KM.glyph(KM.el("rail-icon"), "jeepney", "ride");
    KM.glyph(KM.el("locate-btn"), "location");
    KM.glyph(KM.el("theme-btn"), "star");
    KM.glyph(KM.el("install-btn"), "install");
    KM.glyph(KM.el("account-btn"), "user");
    KM.glyph(KM.el("update-icon"), "refresh");
    KM.el("sheet-close").setAttribute("aria-label", "Close");

    Array.prototype.forEach.call(document.querySelectorAll(".km-tab"), function (tab) {
      var key = tab.getAttribute("data-tab");
      var slot = tab.querySelector(".km-tab-icon");
      if (key === "browse") KM.glyph(slot, "route", "ride");
      else KM.glyph(slot, PANES[key].icon);
    });

    paintTheme();
  }

  /* ---------------------------------------------------------
     Tabs and the sheet
     --------------------------------------------------------- */
  function wireTabs() {
    KM.el("tabs").addEventListener("click", function (e) {
      var tab = e.target.closest(".km-tab");
      if (!tab) return;
      var key = tab.getAttribute("data-tab");
      /* Tapping the tab you are already on closes the sheet, which is the
         gesture people try first and the fastest way back to the map. */
      if (key === current && sheet.getAttribute("data-open") === "true") {
        setSheet(false);
        return;
      }
      openTab(key, { open: true });
    });

    KM.el("sheet-close").addEventListener("click", function () { setSheet(false); });
  }

  function openTab(key, opts) {
    opts = opts || {};
    if (!PANES[key]) return;
    current = key;

    Array.prototype.forEach.call(document.querySelectorAll(".km-pane"), function (pane) {
      pane.hidden = pane.getAttribute("data-pane") !== key;
    });
    Array.prototype.forEach.call(document.querySelectorAll(".km-tab"), function (tab) {
      var on = tab.getAttribute("data-tab") === key;
      tab.classList.toggle("is-on", on);
      tab.setAttribute("aria-current", on ? "page" : "false");
    });

    KM.el("sheet-title").textContent = PANES[key].title;
    if (opts.open !== false) setSheet(true);

    if (KM.detail.isOpen()) KM.detail.close();

    var mod = KM[PANES[key].module];
    if (mod && mod.activate) mod.activate();
    KM.info.paintButtons();
    KM.el("sheet-body").scrollTop = 0;
  }

  function setSheet(open) {
    sheet.setAttribute("data-open", open ? "true" : "false");
    sheet.setAttribute("aria-hidden", open ? "false" : "true");
    document.documentElement.setAttribute("data-sheet", open ? "open" : "closed");
    setTimeout(function () { KM.map.invalidate(); }, 260);
  }

  /* ---------------------------------------------------------
     The rail
     --------------------------------------------------------- */
  function wireRail() {
    KM.el("locate-btn").addEventListener("click", function () {
      var btn = KM.el("locate-btn");
      btn.disabled = true;
      KM.map.locate().then(function () {
        btn.disabled = false;
      }, function (err) {
        btn.disabled = false;
        toast(err.message);
      });
    });

    KM.el("theme-btn").addEventListener("click", function () {
      var now = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", now);
      KM.store.set("theme", now);
      paintTheme();
    });

    KM.el("account-btn").addEventListener("click", function () { openTab("you", { open: true }); });

    var checkBtn = KM.el("update-check");
    if (checkBtn) {
      checkBtn.addEventListener("click", function () {
        KM.el("update-state").textContent = "Checking…";
        KM.update.check().then(function (word) {
          KM.el("update-state").textContent = {
            ready: "A new version is ready. Reload to take it.",
            downloading: "Downloading a new version…",
            current: "This is the latest version.",
            offline: "Could not check — no connection.",
            unsupported: "This browser does not install the app."
          }[word] || "";
        });
      });
    }
  }

  function paintTheme() {
    var dark = document.documentElement.getAttribute("data-theme") === "dark";
    var btn = KM.el("theme-btn");
    if (btn) {
      KM.glyph(btn, dark ? "clear" : "cloud", "weather");
      btn.setAttribute("aria-label", dark ? "Switch to light" : "Switch to dark");
    }
  }

  /* ---------------------------------------------------------
     Picking a point on the map

     The pin is fixed at the centre and the map moves under it. While
     picking, the sheet gets out of the way entirely — a bottom sheet over
     the map is exactly the half of the map somebody is trying to aim at.
     --------------------------------------------------------- */
  function wirePickBar() {
    KM.el("pick-cancel").addEventListener("click", function () { endPick(null); });
    KM.el("pick-confirm").addEventListener("click", function () { endPick(KM.map.centreCoord()); });
  }

  function pick(opts) {
    opts = opts || {};
    if (picking) endPick(null);

    KM.el("pick-label").textContent = opts.label || "Drag the map to place the pin";
    KM.el("pick-bar").hidden = false;
    setSheet(false);
    KM.map.startPick(null);
    document.documentElement.setAttribute("data-picking", "true");

    return new Promise(function (resolve) { picking = resolve; });
  }

  function endPick(coord) {
    KM.el("pick-bar").hidden = true;
    KM.map.stopPick();
    document.documentElement.removeAttribute("data-picking");
    var r = picking;
    picking = null;
    if (r) r(coord);
    if (coord || !KM.finder.isOpen()) setSheet(true);
  }

  /* ---------------------------------------------------------
     One short line at a time
     --------------------------------------------------------- */
  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = String(message || "");
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 4200);
  }

  return {
    init: init,
    openTab: openTab,
    setSheet: setSheet,
    pick: pick,
    toast: toast,
    currentTab: function () { return current; }
  };
})();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", KM.app.init);
} else {
  KM.app.init();
}

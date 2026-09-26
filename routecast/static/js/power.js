/* ============================================================
   RouteCast — battery saver

   A navigator is the app most likely to be running when the phone is at
   fifteen per cent, on a mount, in the sun, two hours from a socket. The
   ride has to survive that, and the only lever a web page really has is to
   do less work: fewer camera frames, flat buildings, no decorative motion,
   and a forecast refetched half as often.

   Three settings, because "on" and "off" are not enough:

     auto   the default. Saves only when the phone says it is low (20% or
            under) AND not charging — the Battery Status API, where the
            browser has it. Where it does not (Safari, Firefox), auto simply
            never saves, which is the honest fallback: guessing a battery
            level would be worse than not knowing one.
     on     always save, for the rider who knows the day is long.
     off    never save, whatever the battery says.

   What "saving" means is decided by the modules that do the work, not here:
   this module only answers one question, `RC.power.saving()`, and says when
   the answer changes. The whole page also carries data-power="save", so the
   stylesheet can drop its own motion without any JavaScript asking.
   ============================================================ */
var RC = RC || {};

RC.power = (function (global) {
  "use strict";

  var LOW = 0.2;
  var MODES = ["auto", "on", "off"];

  var mode = "auto";
  var battery = null;        // the BatteryManager, once the browser hands it over
  var last = null;           // the last answer saving() gave, for change detection
  var listeners = [];

  function fire(ev, detail) {
    for (var i = 0; i < listeners.length; i++) {
      if (listeners[i].ev !== ev) continue;
      try { listeners[i].fn(detail); } catch (e) {}
    }
  }

  function low() {
    return !!(battery && !battery.charging && typeof battery.level === "number" && battery.level <= LOW);
  }

  function saving() {
    if (mode === "on") return true;
    if (mode === "off") return false;
    return low();
  }

  /* Called on every battery event and every mode change. The attribute is
     written every time (it is one string), but listeners are only told when
     the answer actually changed: a level ticking from 43% to 42% is not news
     to the camera. */
  function changed() {
    var now = saving();
    try { document.documentElement.setAttribute("data-power", now ? "save" : "normal"); } catch (e) {}
    fire("battery", api.battery());
    if (now !== last) {
      var auto = mode === "auto" && now;
      last = now;
      fire("change", { saving: now, auto: auto });
    }
  }

  function watchBattery() {
    var nav = global.navigator;
    if (!nav || typeof nav.getBattery !== "function") return;
    try {
      nav.getBattery().then(function (b) {
        battery = b;
        ["levelchange", "chargingchange"].forEach(function (ev) {
          try { b.addEventListener(ev, changed); } catch (e) {}
        });
        changed();
      }, function () {});
    } catch (e) {}
  }

  var api = {
    init: function () {
      mode = RC.store.get("powerMode", "auto");
      if (MODES.indexOf(mode) < 0) mode = "auto";
      changed();
      watchBattery();
    },

    saving: saving,
    mode: function () { return mode; },

    setMode: function (m) {
      if (MODES.indexOf(m) < 0) return mode;
      mode = m;
      RC.store.set("powerMode", m);
      changed();
      fire("mode", { mode: m });
      return mode;
    },

    /** { level: 0..1, charging } — or null where the browser will not say. */
    battery: function () {
      if (!battery || typeof battery.level !== "number") return null;
      return { level: battery.level, charging: !!battery.charging };
    },

    /** Is saving on only because the battery is low? The panel says so,
        because a camera that suddenly got choppier deserves a reason. */
    isAuto: function () { return mode === "auto" && saving(); },

    /** Events: "change" ({saving, auto}), "battery" (level/charging), "mode". */
    on: function (ev, fn) {
      listeners.push({ ev: ev, fn: fn });
      return function () {
        for (var i = 0; i < listeners.length; i++) {
          if (listeners[i].fn === fn && listeners[i].ev === ev) { listeners.splice(i, 1); return; }
        }
      };
    },

    LOW: LOW
  };

  // Ready from the first frame, like RC.background: the camera asks before
  // app.js has done anything at all.
  try { api.init(); } catch (e) {}

  return api;
})(typeof window !== "undefined" ? window : globalThis);

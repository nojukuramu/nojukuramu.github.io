/* ============================================================
   RouteCast — the rain lock

   A touchscreen in the rain is a touchscreen being pressed by the rain.
   Drops land on it, a wet glove brushes it, and the phone on the handlebar
   starts ending rides, zooming out to the Visayas and opening the planner
   by itself. Every rider who has used a phone in weather knows this, and
   the usual answer — put it in a bag — is also the end of navigation.

   So a ride can be locked. The screen keeps doing everything it does —
   the map follows, the dashboard counts, the voice talks — and ignores
   every touch until one of them is a deliberate hold on the lock itself.
   A raindrop cannot hold for most of a second in one place; a thumb can.

   The lock covers the whole screen with a transparent layer rather than
   switching off controls one by one. That is not laziness: it is the only
   way to be sure that a control added next month is locked too.
   ============================================================ */
var RC = RC || {};

RC.lock = (function () {
  "use strict";

  var HOLD_MS = 900;
  var locked = false;
  var holdTimer = null;
  var onChange = null;

  function veil() { return RC.el("lock-veil"); }

  function set(on) {
    var v = veil();
    if (!v) return false;
    locked = !!on;
    v.hidden = !locked;
    document.documentElement.setAttribute("data-locked", locked ? "yes" : "no");
    cancelHold();
    if (typeof onChange === "function") { try { onChange(locked); } catch (e) {} }
    return locked;
  }

  function cancelHold() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    var pill = RC.el("lock-pill");
    if (pill) pill.classList.remove("is-holding");
  }

  function init(opts) {
    opts = opts || {};
    onChange = opts.onChange || null;
    var v = veil(), pill = RC.el("lock-pill");
    if (!v || !pill) return;

    pill.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      e.stopPropagation();
      cancelHold();
      pill.classList.add("is-holding");
      holdTimer = setTimeout(function () {
        holdTimer = null;
        if (RC.guide) RC.guide.buzz(40);
        set(false);
      }, HOLD_MS);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
      pill.addEventListener(ev, cancelHold);
    });

    /* Anything else that touches the screen is absorbed — and the pill
       nods, so a rider who forgot it was locked knows why nothing happened. */
    v.addEventListener("pointerdown", function (e) {
      if (e.target && e.target.closest && e.target.closest("#lock-pill")) return;
      e.preventDefault();
      pill.classList.remove("is-nudge");
      void pill.offsetWidth;
      pill.classList.add("is-nudge");
    });
    ["click", "touchstart", "touchmove", "wheel", "contextmenu"].forEach(function (ev) {
      v.addEventListener(ev, function (e) {
        if (e.target && e.target.closest && e.target.closest("#lock-pill")) return;
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
      }, { passive: false });
    });
  }

  return {
    init: init,
    lock: function () { return set(true); },
    unlock: function () { return set(false); },
    toggle: function () { return set(!locked); },
    isLocked: function () { return locked; },
    HOLD_MS: HOLD_MS
  };
})();

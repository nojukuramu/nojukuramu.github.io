/* ============================================================
   RouteCast — the camera

   Who owns the map while you are riding: you, or the app? Both want it, and
   the old answer — "whoever moved it last" — is why reaching over to look at
   the junction ahead used to end in a tug of war, the next fix yanking the
   view back a heartbeat after your thumb left the glass.

   This module is the arbitration, and it draws the line by INTENT rather
   than by event:

   * A drag is "let me look somewhere else". Following stops, a Re-centre
     control appears, and nothing moves the map again until you ask — or
     until you have been done looking for RESUME_MS, whichever comes first.
   * A zoom is "let me look closer at the same thing". Following continues,
     and the zoom you chose becomes the zoom it follows at. Pinching to see
     the roundabout you are entering should not cost you your position, and
     the app must never zoom back out over your fingers.
   * The app's own pans are not gestures. They are flagged before they are
     made, so a camera move can never be mistaken for the rider making one.

   Everything else is edge cases, and the edge cases are the point:

   * A fix arriving mid-drag is ignored rather than fought over — a pointer
     on the glass always wins.
   * Momentum from a flick is left to finish; the camera does not stack a
     pan on top of an inertia animation.
   * While the page is hidden the camera does nothing at all: waking to
     twenty queued animations is how a map ends up somewhere it never was.
   * Course-up needs the rider exactly at the centre (compass.js rotates the
     element about it), so in that mode the camera is authoritative and
     jumps rather than animating.
   * A big jump — the first fix, a tunnel exit, a reroute — is a cut, not a
     pan. Animating a hundred kilometres is a slideshow with no information
     in it.
   ============================================================ */
RC.follow = (function () {
  "use strict";

  var RESUME_MS = 12000;         // hands off this long and the camera comes back
  var GESTURE_GRACE_MS = 350;    // a wheel/pinch is "in progress" for this long after
  var CUT_PX = 420;              // further than this on screen: jump, do not animate
  var PAN_DURATION_S = 0.45;

  var map = null, container = null;
  var following = false;
  var enabled = false;
  var preferredZoom = null;
  var pointers = 0;
  var lastGestureTs = 0;
  var programmatic = 0;
  var resumeTimer = null;
  var lastTarget = null;
  var onChange = null;

  function now() { return Date.now(); }

  function fire() {
    if (typeof onChange === "function") {
      try { onChange(following, enabled); } catch (e) {}
    }
  }

  function clearResume() {
    if (resumeTimer) { clearTimeout(resumeTimer); resumeTimer = null; }
  }

  /* The rider looked away. Come back on your own after a while, but only if
     nothing has been touched since — every fresh gesture pushes the timer
     out, so reading a map for two minutes is not interrupted nineteen
     times. */
  function scheduleResume() {
    clearResume();
    if (!enabled || RESUME_MS <= 0) return;
    resumeTimer = setTimeout(function () {
      resumeTimer = null;
      if (!enabled || following) return;
      if (pointers > 0 || now() - lastGestureTs < GESTURE_GRACE_MS) { scheduleResume(); return; }
      engage();
    }, RESUME_MS);
  }

  function engage() {
    if (!enabled || following) return;
    following = true;
    clearResume();
    fire();
    if (lastTarget) apply(lastTarget.lat, lastTarget.lon, lastTarget.opts, true);
  }

  function disengage() {
    if (!following) return;
    following = false;
    fire();
    scheduleResume();
  }

  /* ---------- telling the rider's hands from our own ---------- */

  function markGesture() { lastGestureTs = now(); }

  function onPointerDown() { pointers++; markGesture(); }
  function onPointerUp() { pointers = Math.max(0, pointers - 1); markGesture(); scheduleResumeIfIdle(); }

  function scheduleResumeIfIdle() { if (enabled && !following) scheduleResume(); }

  function onWheel() { markGesture(); }

  function onKeyDown(e) {
    var k = e.key || "";
    // Leaflet's keyboard handler pans with the arrows and zooms with +/-;
    // only the pan is a "look elsewhere".
    if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
      markGesture();
      disengage();
    }
  }

  function onDragStart() {
    markGesture();
    disengage();
  }

  function onZoomEnd() {
    // A zoom the rider made is a preference, not a departure: remember it and
    // keep following. A zoom WE made is already at the preferred level.
    if (programmatic > 0) return;
    if (pointers > 0 || now() - lastGestureTs < GESTURE_GRACE_MS) {
      preferredZoom = map.getZoom();
      markGesture();
    }
  }

  function onMoveEnd() {
    if (programmatic > 0) programmatic--;
  }

  /* ---------- moving the camera ---------- */

  function pageHidden() {
    try { return document.visibilityState === "hidden"; } catch (e) { return false; }
  }

  function apply(lat, lon, opts, force) {
    opts = opts || {};
    if (!map) return;
    if (!following && !force) return;
    if (pageHidden()) return;
    // A pointer on the glass outranks the camera, every time.
    if (pointers > 0) return;

    var zoom = preferredZoom == null ? map.getZoom() : preferredZoom;
    if (opts.minZoom != null && zoom < opts.minZoom) zoom = opts.minZoom;

    var target = L.latLng(lat, lon);
    var far = true;
    try {
      var a = map.latLngToContainerPoint(target);
      var b = map.latLngToContainerPoint(map.getCenter());
      far = Math.abs(a.x - b.x) > CUT_PX || Math.abs(a.y - b.y) > CUT_PX;
    } catch (e) { far = true; }

    programmatic++;
    try {
      if (opts.rotated || far || zoom !== map.getZoom()) {
        // Course-up must keep the rider dead centre or the rotation pivots
        // around the wrong point; a long jump is a cut either way.
        map.setView(target, zoom, { animate: false });
      } else {
        map.panTo(target, { animate: true, duration: PAN_DURATION_S, easeLinearity: 0.5 });
      }
    } catch (e) {
      programmatic = Math.max(0, programmatic - 1);
      return;
    }
    // moveend decrements; a move that produces no event (an identical
    // position) would otherwise leak the flag, so time it out as well.
    setTimeout(function () { if (programmatic > 0) programmatic--; }, 1200);
  }

  /* ---------- public ---------- */

  function init(opts) {
    opts = opts || {};
    map = opts.map;
    container = opts.container || (map && map.getContainer && map.getContainer());
    onChange = opts.onChange || null;
    if (!map) return;

    map.on("dragstart", onDragStart);
    map.on("zoomend", onZoomEnd);
    map.on("moveend", onMoveEnd);

    if (container && container.addEventListener) {
      container.addEventListener("pointerdown", onPointerDown, { passive: true });
      container.addEventListener("pointerup", onPointerUp, { passive: true });
      container.addEventListener("pointercancel", onPointerUp, { passive: true });
      container.addEventListener("wheel", onWheel, { passive: true });
      container.addEventListener("keydown", onKeyDown);
    }
    try {
      document.addEventListener("visibilitychange", function () {
        // Coming back to a live ride: re-seat the camera on the last known
        // position in one move, rather than letting a queued animation
        // replay the minutes the page spent hidden.
        if (!pageHidden() && following && lastTarget) {
          apply(lastTarget.lat, lastTarget.lon, lastTarget.opts, true);
        }
      });
    } catch (e) {}
  }

  /* Turn the camera on for a ride. minZoom is applied once, on the first
     fix, so starting a ride zoomed out to the whole route still drops you
     to a useful scale — and never overrides a zoom you chose afterwards. */
  function enable(opts) {
    opts = opts || {};
    enabled = true;
    following = true;
    lastTarget = null;
    pointers = 0;
    preferredZoom = opts.zoom == null ? null : opts.zoom;
    clearResume();
    fire();
  }

  function disable() {
    enabled = false;
    following = false;
    lastTarget = null;
    preferredZoom = null;
    clearResume();
    fire();
  }

  // Called on every fix. Cheap and idempotent when following is off.
  function setTarget(lat, lon, opts) {
    if (!enabled) return;
    lastTarget = { lat: lat, lon: lon, opts: opts || {} };
    if (!following) return;
    apply(lat, lon, opts, false);
  }

  /* The app's own zoom buttons. They are made through silently(), so the
     gesture heuristics correctly ignore them — which would leave the camera
     snapping straight back to the zoom it was already following at. Telling
     it the new zoom is how a deliberate zoom sticks. */
  function setZoom(z) {
    if (typeof z === "number" && !isNaN(z)) preferredZoom = z;
  }

  // The Re-centre control, and anything else that means "put me back".
  function recenter(opts) {
    if (!enabled) return false;
    if (opts && opts.zoom != null) preferredZoom = opts.zoom;
    following = true;
    clearResume();
    fire();
    if (lastTarget) apply(lastTarget.lat, lastTarget.lon, lastTarget.opts, true);
    return true;
  }

  /* Something else took the map deliberately — the whole-route overview, a
     tapped checkpoint. That is not a gesture to be resumed out of after
     twelve seconds; it is a decision, and it stands until Re-centre. */
  function release() {
    if (!enabled) return;
    following = false;
    clearResume();
    fire();
  }

  // Wrap a map move the app makes, so it is never mistaken for the rider's.
  function silently(fn) {
    programmatic++;
    try { fn(); } finally {
      setTimeout(function () { if (programmatic > 0) programmatic--; }, 1200);
    }
  }

  return {
    init: init,
    enable: enable,
    disable: disable,
    setZoom: setZoom,
    setTarget: setTarget,
    recenter: recenter,
    release: release,
    silently: silently,
    isEnabled: function () { return enabled; },
    isFollowing: function () { return enabled && following; },
    RESUME_MS: RESUME_MS
  };
})();

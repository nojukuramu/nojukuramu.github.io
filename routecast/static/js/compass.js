/* ============================================================
   RouteCast — compass and map rotation
   Two modes, cycled from the compass button:

     "north"   north is up, the map pans and drags freely (the default,
               and what every other part of the app assumes).
     "course"  the map rotates so the way you are pointing is up, and stays
               centred on you. This is the mode you ride in.

   How the rotation is done
   ------------------------
   Leaflet 1.x has no rotation of its own, so the map element itself is
   rotated with a CSS transform — one GPU-composited property, no reflow,
   no re-projection, and Leaflet's own geometry is untouched. Two
   consequences are handled here rather than papered over:

   * A rotated rectangle does not cover its own container. While course-up
     is on, #map is grown to the container's DIAGONAL in both axes and
     re-centred, so the corners stay full of tiles at every angle. That
     costs roughly 1.4x the tiles, which is why it is only paid for in the
     mode that needs it.
   * Leaflet maps pointer positions through the element's axis-aligned
     bounding box, which a rotation invalidates: dragging would move the
     map along the wrong axis. So dragging is disabled while rotated, and
     zoom is anchored to the map centre (rotation-invariant) instead of the
     pointer. A drag attempt is not swallowed, though — it drops you back
     to north-up, which is exactly what reaching for the map means.

   Where the heading comes from
   ----------------------------
   In priority order, and deliberately: a moving vehicle's GPS course is far
   steadier than a magnetometer sitting next to a phone mount and an engine.

     1. GPS course, while actually moving (>= MOVING_KMH).
     2. The device magnetometer, for when you are stopped or crawling —
        this is the "where the user is facing" case. iOS gates it behind a
        permission prompt that must come from a user gesture, which the
        compass button provides.
     3. The bearing of the route segment underneath you, as a last resort.

   Cost
   ----
   Nothing polls and nothing is fetched. The orientation listener is only
   attached while course-up is on. Bearings are smoothed on the shortest
   arc and written to one CSS custom property, at most once per frame and
   only when the angle actually moved more than MIN_STEP_DEG — so a
   straight highway writes to the DOM a handful of times a minute.
   ============================================================ */
RC.compass = (function () {
  "use strict";

  var MODES = ["north", "course"];
  var MOVING_KMH = 7;          // below this, GPS course is noise — use the magnetometer
  var SMOOTH_ALPHA = 0.25;     // exponential smoothing on the shortest arc
  var MIN_STEP_DEG = 1.5;      // don't repaint for less than this
  var SENSOR_MIN_INTERVAL_MS = 100;
  var BREAKOUT_PX = 24;        // drag this far while rotated -> back to north-up

  var map = null, mapEl = null, wrapEl = null;
  var mode = "north";
  var targetBearing = 0;       // where we want the map rotated to
  var appliedBearing = 0;      // what the DOM currently says
  var smoothBearing = 0;
  var frame = null;
  var sensorAttached = false, lastSensorTs = 0, sensorHeading = null;
  var gpsCourse = null, gpsMoving = false, routeBearing = null;
  var savedInteractions = null;
  var onModeChange = null;

  function norm(deg) { return ((deg % 360) + 360) % 360; }

  /* Signed shortest angular difference b - a, in (-180, 180]. */
  function delta(a, b) {
    var d = norm(b - a);
    return d > 180 ? d - 360 : d;
  }

  /* ---------- heading selection ---------- */

  function currentHeading() {
    if (gpsMoving && gpsCourse != null) return gpsCourse;
    if (sensorHeading != null) return sensorHeading;
    if (gpsCourse != null) return gpsCourse;
    if (routeBearing != null) return routeBearing;
    return null;
  }

  function recompute() {
    if (mode !== "course") { setTarget(0); return; }
    var h = currentHeading();
    if (h == null) return;      // nothing trustworthy yet — hold the last angle
    setTarget(-h);              // rotating the map by -heading puts heading up
  }

  function setTarget(deg) {
    targetBearing = deg;
    schedule();
  }

  /* One rAF-driven easing loop. It writes the CSS variable only when the
     angle has actually moved a visible amount, and stops itself as soon as
     the smoothed bearing lands on the target — so a straight road costs
     nothing and a turn costs a few dozen composited frames. */
  function schedule() {
    if (frame != null) return;
    frame = requestAnimationFrame(function () {
      frame = null;
      var gap = delta(smoothBearing, targetBearing);
      if (Math.abs(gap) < 0.05) smoothBearing = targetBearing;
      else smoothBearing += gap * SMOOTH_ALPHA;

      var settled = smoothBearing === targetBearing;
      if (settled || Math.abs(delta(appliedBearing, smoothBearing)) >= MIN_STEP_DEG) {
        appliedBearing = smoothBearing;
        document.documentElement.style.setProperty("--rc-bearing", appliedBearing.toFixed(1) + "deg");
      }
      if (!settled) schedule();
    });
  }

  /* ---------- device orientation ---------- */

  function readOrientation(e) {
    var h = null;
    if (typeof e.webkitCompassHeading === "number" && !isNaN(e.webkitCompassHeading)) {
      h = e.webkitCompassHeading;                 // iOS: already degrees clockwise from north
    } else if (e.absolute && typeof e.alpha === "number" && !isNaN(e.alpha)) {
      h = 360 - e.alpha;                          // spec alpha is counter-clockwise
    }
    if (h == null) return null;
    var screenAngle = 0;
    try {
      screenAngle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    } catch (err) {}
    return norm(h + screenAngle);
  }

  function onOrientation(e) {
    var t = Date.now();
    if (t - lastSensorTs < SENSOR_MIN_INTERVAL_MS) return;
    var h = readOrientation(e);
    if (h == null) return;
    lastSensorTs = t;
    sensorHeading = h;
    recompute();
  }

  function attachSensor() {
    if (sensorAttached || typeof window.addEventListener !== "function") return;
    sensorAttached = true;
    try {
      window.addEventListener("deviceorientationabsolute", onOrientation, true);
      window.addEventListener("deviceorientation", onOrientation, true);
    } catch (e) { sensorAttached = false; }
  }

  function detachSensor() {
    if (!sensorAttached) return;
    sensorAttached = false;
    sensorHeading = null;
    try {
      window.removeEventListener("deviceorientationabsolute", onOrientation, true);
      window.removeEventListener("deviceorientation", onOrientation, true);
    } catch (e) {}
  }

  /* iOS 13+ will not deliver orientation events without an explicit grant,
     and only asks from inside a user gesture — the compass tap is one.
     Everywhere else this resolves immediately. */
  function requestSensorPermission() {
    var DOE = window.DeviceOrientationEvent;
    if (!DOE || typeof DOE.requestPermission !== "function") return Promise.resolve(true);
    try {
      return DOE.requestPermission().then(function (r) { return r === "granted"; },
                                          function () { return false; });
    } catch (e) { return Promise.resolve(false); }
  }

  /* ---------- rotation geometry ---------- */

  function applyGeometry(rotated) {
    if (!mapEl || !wrapEl) return;
    if (!rotated) {
      mapEl.style.top = mapEl.style.right = mapEl.style.bottom = mapEl.style.left = "";
    } else {
      var r = wrapEl.getBoundingClientRect();
      var w = r.width, h = r.height;
      var d = Math.ceil(Math.sqrt(w * w + h * h));
      var dx = Math.ceil((d - w) / 2), dy = Math.ceil((d - h) / 2);
      mapEl.style.top = -dy + "px";
      mapEl.style.bottom = -dy + "px";
      mapEl.style.left = -dx + "px";
      mapEl.style.right = -dx + "px";
    }
    if (map) {
      try { map.invalidateSize({ pan: false, animate: false, debounceMoveend: true }); } catch (e) {}
    }
  }

  function setInteractions(rotated) {
    if (!map) return;
    try {
      if (rotated) {
        if (!savedInteractions) {
          savedInteractions = {
            dragging: map.dragging && map.dragging.enabled(),
            touchZoom: map.options.touchZoom,
            scrollWheelZoom: map.options.scrollWheelZoom,
            doubleClickZoom: map.options.doubleClickZoom
          };
        }
        if (map.dragging) map.dragging.disable();
        // "center" anchors every zoom at the map centre, which is the one
        // point a rotation leaves where it was.
        map.options.touchZoom = "center";
        map.options.scrollWheelZoom = "center";
        map.options.doubleClickZoom = "center";
      } else if (savedInteractions) {
        if (map.dragging && savedInteractions.dragging) map.dragging.enable();
        map.options.touchZoom = savedInteractions.touchZoom;
        map.options.scrollWheelZoom = savedInteractions.scrollWheelZoom;
        map.options.doubleClickZoom = savedInteractions.doubleClickZoom;
        savedInteractions = null;
      }
    } catch (e) {}
  }

  /* A drag on a rotated map means "let me look around" — honour it by
     dropping to north-up rather than ignoring the gesture. */
  var pointerStart = null;
  function onPointerDown(e) {
    if (mode !== "course") return;
    pointerStart = { x: e.clientX, y: e.clientY };
  }
  function onPointerMove(e) {
    if (!pointerStart || mode !== "course") return;
    var dx = e.clientX - pointerStart.x, dy = e.clientY - pointerStart.y;
    if (dx * dx + dy * dy > BREAKOUT_PX * BREAKOUT_PX) {
      pointerStart = null;
      setMode("north");
    }
  }
  function onPointerUp() { pointerStart = null; }

  /* ---------- public ---------- */

  function setMode(next, opts) {
    opts = opts || {};
    if (MODES.indexOf(next) < 0) next = "north";
    if (next === mode) return Promise.resolve(mode);

    function commit(sensorOk) {
      mode = next;
      var rotated = mode === "course";
      document.documentElement.setAttribute("data-rotate", rotated ? "on" : "off");
      applyGeometry(rotated);
      setInteractions(rotated);
      if (rotated && sensorOk) attachSensor(); else detachSensor();
      recompute();
      if (!rotated) setTarget(0);
      if (typeof onModeChange === "function") { try { onModeChange(mode); } catch (e) {} }
      return mode;
    }

    if (next === "course" && opts.gesture !== false) {
      return requestSensorPermission().then(commit, function () { return commit(false); });
    }
    return Promise.resolve(commit(false));
  }

  function cycle() { return setMode(mode === "course" ? "north" : "course"); }

  /* Fed from RC.nav on every fix. speedKmh decides whether the GPS course is
     worth trusting over the magnetometer. */
  function setCourse(courseDeg, speedKmh, routeBearingDeg) {
    gpsCourse = (typeof courseDeg === "number" && !isNaN(courseDeg)) ? norm(courseDeg) : null;
    gpsMoving = typeof speedKmh === "number" && speedKmh >= MOVING_KMH;
    routeBearing = (typeof routeBearingDeg === "number" && !isNaN(routeBearingDeg)) ? norm(routeBearingDeg) : null;
    recompute();
  }

  function reset() {
    gpsCourse = null; gpsMoving = false; routeBearing = null;
  }

  function init(opts) {
    map = opts.map;
    mapEl = opts.mapEl;
    wrapEl = opts.wrapEl;
    onModeChange = opts.onModeChange || null;
    document.documentElement.setAttribute("data-rotate", "off");
    document.documentElement.style.setProperty("--rc-bearing", "0deg");
    if (wrapEl && window.PointerEvent) {
      wrapEl.addEventListener("pointerdown", onPointerDown, { passive: true });
      wrapEl.addEventListener("pointermove", onPointerMove, { passive: true });
      wrapEl.addEventListener("pointerup", onPointerUp, { passive: true });
      wrapEl.addEventListener("pointercancel", onPointerUp, { passive: true });
    }
    window.addEventListener("resize", function () {
      if (mode === "course") applyGeometry(true);
    });
  }

  return {
    init: init,
    setMode: setMode,
    cycle: cycle,
    setCourse: setCourse,
    reset: reset,
    getMode: function () { return mode; },
    getBearing: function () { return appliedBearing; },
    isRotated: function () { return mode === "course"; }
  };
})();

/* ============================================================
   RouteCast — live driving navigation
   No DOM here: this module owns geolocation + the wake lock only and
   reports everything through callbacks; app.js renders the HUD.

   Projection
   ----------
   Every geolocation fix is projected onto the route polyline: for a
   window of segments around the last matched segment, the fix is dropped
   into a local planar frame (longitude scaled by cos(latitude) of the
   fix, so the frame is metric-accurate near the fix) and projected
   perpendicularly onto each candidate segment, clamped to the segment.
   The best (smallest perpendicular distance) match wins. Distance-along
   and expected elapsed time are then linearly interpolated from
   route.cumDist / route.cumDur using that segment's interpolation
   fraction. Only when the windowed match is implausibly far away
   (bigger than FULL_SCAN_THRESHOLD_M) do we pay for a full-polyline
   scan — that only happens on a big GPS jump or the first fix.
   ============================================================ */
RC.nav = (function () {
  "use strict";

  var WINDOW = 200;                 // segments to search either side of the last match
  var FULL_SCAN_THRESHOLD_M = 300;  // windowed match this bad -> fall back to a full scan
  var OFFROUTE_M = 60;              // perpendicular distance considered "off route"
  var OFFROUTE_STREAK = 3;          // consecutive bad fixes before flagging offRoute
  var RETIME_INTERVAL_MS = 60000;   // re-sample downstream weather at most this often
  var ARRIVE_EPS_M = 15;            // close enough to the final coordinate to call it arrival
  var RATIO_MIN = 0.6, RATIO_MAX = 2.0;
  var MIN_EXPECTED_S_FOR_RATIO = 5; // ignore ratio noise over a near-zero expected-time span

  var st = null; // internal session state while navigating, null otherwise

  function now() { return new Date(); }

  /* ---------- projection ---------- */

  function projectOntoRoute(route, lat, lon, lastIdx) {
    var coords = route.coords, n = coords.length;
    var latRad = lat * Math.PI / 180;
    var cosLat = Math.cos(latRad) || 1e-6;
    var mPerDegLat = 111320;

    function toXY(la, lo) {
      return { x: (lo - lon) * mPerDegLat * cosLat, y: (la - lat) * mPerDegLat };
    }

    function scanRange(lo, hi) {
      var best = null;
      for (var i = lo; i < hi; i++) {
        var a = toXY(coords[i][0], coords[i][1]);
        var b = toXY(coords[i + 1][0], coords[i + 1][1]);
        var abx = b.x - a.x, aby = b.y - a.y;
        var len2 = abx * abx + aby * aby;
        var t;
        if (len2 === 0) {
          t = 0;
        } else {
          t = ((0 - a.x) * abx + (0 - a.y) * aby) / len2;
          if (t < 0) t = 0; else if (t > 1) t = 1;
        }
        var projx = a.x + t * abx, projy = a.y + t * aby;
        var dx = 0 - projx, dy = 0 - projy;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (!best || d < best.d) best = { d: d, i: i, t: t };
      }
      return best;
    }

    if (n < 2) return { index: 0, t: 0, offRouteM: 0, distanceAlong: 0, expectedS: 0 };

    var lo = Math.max(0, (lastIdx == null ? 0 : lastIdx) - WINDOW);
    var hi = Math.min(n - 1, (lastIdx == null ? n - 1 : lastIdx) + WINDOW);
    var best = scanRange(lo, hi);

    if (!best || best.d > FULL_SCAN_THRESHOLD_M) {
      var full = scanRange(0, n - 1);
      if (full && (!best || full.d < best.d)) best = full;
    }

    var cumDist = route.cumDist, cumDur = route.cumDur;
    var i = best.i, t = best.t;
    var distanceAlong = cumDist[i] + t * (cumDist[i + 1] - cumDist[i]);
    var expectedS = cumDur[i] + t * (cumDur[i + 1] - cumDur[i]);
    return { index: i, t: t, offRouteM: best.d, distanceAlong: distanceAlong, expectedS: expectedS };
  }

  /* ---------- wake lock ---------- */

  function releaseWakeLock() {
    if (st && st.wakeLock) {
      try { st.wakeLock.release(); } catch (e) {}
      st.wakeLock = null;
    }
  }

  function acquireWakeLock() {
    if (!st || !st.active) return;
    try {
      if (navigator.wakeLock && navigator.wakeLock.request) {
        navigator.wakeLock.request("screen").then(function (lock) {
          if (!st || !st.active) { try { lock.release(); } catch (e) {} return; }
          st.wakeLock = lock;
        }, function () { /* ignore — not fatal */ });
      }
    } catch (e) { /* Wake Lock API not available — ignore */ }
  }

  function onVisibilityChange() {
    try {
      if (document.visibilityState === "visible" && st && st.active && !st.wakeLock) {
        acquireWakeLock();
      }
    } catch (e) {}
  }

  /* ---------- fix processing ---------- */

  function buildNextCheckpointInfo(distanceAlong, expectedS, ratio) {
    var cps = st.checkpoints;
    for (var j = 0; j < cps.length; j++) {
      if (cps[j].distance > distanceAlong + 0.5) {
        var cp = cps[j];
        var etaSecondsFromNow = (st.route.cumDur[cp.i] - expectedS) * ratio;
        return {
          checkpoint: cp,
          index: j,
          distanceToNextM: cp.distance - distanceAlong,
          secondsToNext: Math.max(0, etaSecondsFromNow)
        };
      }
    }
    return null;
  }

  function retimeCheckpoints(distanceAlong, expectedS, ratio, nowDate) {
    var cps = st.checkpoints;
    for (var j = 0; j < cps.length; j++) {
      var cp = cps[j];
      if (cp.distance <= distanceAlong + 0.5) continue; // already passed — leave its record alone
      var remainS = Math.max(0, (st.route.cumDur[cp.i] - expectedS) * ratio);
      var newEta = new Date(nowDate.getTime() + remainS * 1000);
      cp.eta = newEta;
      cp.etaSeconds = (newEta.getTime() - st.navStartWallClock) / 1000;
      if (st.series) {
        try { cp.wx = RC.weather.sampleSeries(st.series, j, newEta); } catch (e) {}
      }
    }
    st.lastRetimeTs = nowDate.getTime();
  }

  function fireDueCheckpoints(distanceAlong, state) {
    var cps = st.checkpoints;
    for (var j = 0; j < cps.length; j++) {
      if (st.fired[j]) continue;
      if (cps[j].isStart) { st.fired[j] = true; continue; }
      if (cps[j].distance <= distanceAlong + 0.5) {
        st.fired[j] = true;
        if (typeof RC.nav.onCheckpoint === "function") {
          try { RC.nav.onCheckpoint(cps[j], state); } catch (e) {}
        }
      }
    }
  }

  function handlePosition(position) {
    if (!st || !st.active) return;
    try {
      var coords = position.coords || {};
      var lat = coords.latitude, lon = coords.longitude;
      if (typeof lat !== "number" || typeof lon !== "number") return;

      var fixNow = now();
      var proj = projectOntoRoute(st.route, lat, lon, st.lastMatchIndex);
      st.lastMatchIndex = proj.index;

      // off-route streak
      if (proj.offRouteM > OFFROUTE_M) {
        st.offRouteStreak++;
        if (st.offRouteStreak >= OFFROUTE_STREAK) st.offRoute = true;
      } else {
        st.offRouteStreak = 0;
        st.offRoute = false;
      }

      // first-fix baseline for the elapsed/expected ratio
      if (st.startTime == null) {
        st.startTime = fixNow;
        st.startExpectedS = proj.expectedS;
        st.navStartWallClock = fixNow.getTime();
      }

      var elapsedRealS = (fixNow.getTime() - st.startTime.getTime()) / 1000;
      var deltaExpectedS = proj.expectedS - st.startExpectedS;
      if (deltaExpectedS > MIN_EXPECTED_S_FOR_RATIO) {
        st.ratio = RC.clamp(elapsedRealS / deltaExpectedS, RATIO_MIN, RATIO_MAX);
      } // else keep previous ratio (starts at 1)

      var totalDist = st.route.cumDist[st.route.cumDist.length - 1];
      var totalDur = st.route.cumDur[st.route.cumDur.length - 1];
      var remainingExpectedS = Math.max(0, totalDur - proj.expectedS);
      var remainingS = remainingExpectedS * st.ratio;
      var etaDate = new Date(fixNow.getTime() + remainingS * 1000);
      var remainingM = Math.max(0, totalDist - proj.distanceAlong);
      var progress = totalDist > 0 ? RC.clamp(proj.distanceAlong / totalDist, 0, 1) : 0;

      var passedCount = 0;
      for (var k = 0; k < st.checkpoints.length; k++) {
        if (st.checkpoints[k].distance <= proj.distanceAlong + 0.5) passedCount++;
      }

      // re-time downstream checkpoints + re-sample weather, throttled
      if (fixNow.getTime() - st.lastRetimeTs >= RETIME_INTERVAL_MS) {
        retimeCheckpoints(proj.distanceAlong, proj.expectedS, st.ratio, fixNow);
      }

      var nextInfo = buildNextCheckpointInfo(proj.distanceAlong, proj.expectedS, st.ratio);

      var speedKmh = (typeof coords.speed === "number" && coords.speed != null) ? coords.speed * 3.6 : null;
      var headingDeg = (typeof coords.heading === "number" && !isNaN(coords.heading)) ? coords.heading : null;

      var state = {
        lat: lat, lon: lon, accuracy: coords.accuracy == null ? null : coords.accuracy,
        headingDeg: headingDeg, speedKmh: speedKmh,
        distanceAlong: proj.distanceAlong, remainingM: remainingM, remainingS: remainingS,
        etaDate: etaDate, progress: progress,
        nextCheckpoint: nextInfo ? nextInfo.checkpoint : null,
        distanceToNextM: nextInfo ? nextInfo.distanceToNextM : 0,
        secondsToNext: nextInfo ? nextInfo.secondsToNext : 0,
        passedCount: passedCount, offRoute: st.offRoute, offRouteM: proj.offRouteM
      };

      fireDueCheckpoints(proj.distanceAlong, state);

      if (typeof RC.nav.onUpdate === "function") {
        try { RC.nav.onUpdate(state); } catch (e) {}
      }

      if (st.offRoute && typeof RC.nav.onOffRoute === "function") {
        try { RC.nav.onOffRoute(state); } catch (e) {}
      }

      if (!st.arrived && (progress >= 0.999 || remainingM <= ARRIVE_EPS_M)) {
        st.arrived = true;
        if (typeof RC.nav.onArrive === "function") {
          try { RC.nav.onArrive(); } catch (e) {}
        }
      }

      if (typeof st.resolveStart === "function") {
        var resolveFn = st.resolveStart;
        st.resolveStart = null;
        resolveFn();
      }
    } catch (e) {
      // never throw into the geolocation callback
      try { console.error("RC.nav: error handling position fix", e); } catch (e2) {}
    }
  }

  function handleError(err) {
    if (!st) return;
    var msg = "Could not get your location.";
    if (err && err.code === 1) msg = "Location permission was denied. Allow location access to navigate.";
    else if (err && err.code === 2) msg = "Your location is currently unavailable.";
    else if (err && err.code === 3) msg = "Location request timed out.";

    if (typeof st.rejectStart === "function") {
      var rejectFn = st.rejectStart;
      st.rejectStart = null;
      st.resolveStart = null;
      cleanup();
      rejectFn(new Error(msg));
      return;
    }
    // Already running: don't throw, just surface it.
    try {
      if (typeof RC.nav.onOffRoute === "function") {
        RC.nav.onOffRoute({ error: msg });
      } else {
        console.error("RC.nav:", msg);
      }
    } catch (e) {}
  }

  function cleanup() {
    if (!st) return;
    if (st.watchId != null) {
      try { navigator.geolocation.clearWatch(st.watchId); } catch (e) {}
      st.watchId = null;
    }
    releaseWakeLock();
    if (st.visListenerAttached) {
      try { document.removeEventListener("visibilitychange", onVisibilityChange); } catch (e) {}
      st.visListenerAttached = false;
    }
    st.active = false;
  }

  /* ---------- public API ---------- */

  function start(opts) {
    opts = opts || {};
    var route = opts.route, checkpoints = opts.checkpoints || [];

    if (!route || !route.coords || route.coords.length < 2) {
      return Promise.reject(new Error("No route to navigate."));
    }
    if (!navigator || !navigator.geolocation) {
      return Promise.reject(new Error("Geolocation is not available on this device or browser."));
    }

    // restarting: tear down any previous session first
    if (st && st.active) cleanup();

    return new Promise(function (resolve, reject) {
      st = {
        active: true,
        route: route,
        checkpoints: checkpoints,
        series: opts.series || null,
        vehicle: opts.vehicle || "car",
        map: opts.map || null,
        watchId: null,
        wakeLock: null,
        visListenerAttached: false,
        lastMatchIndex: 0,
        offRouteStreak: 0,
        offRoute: false,
        startTime: null,
        startExpectedS: 0,
        navStartWallClock: 0,
        ratio: 1,
        lastRetimeTs: 0,
        fired: {},
        arrived: false,
        resolveStart: resolve,
        rejectStart: reject
      };

      try {
        st.watchId = navigator.geolocation.watchPosition(handlePosition, handleError, {
          enableHighAccuracy: true,
          maximumAge: 2000,
          timeout: 15000
        });
      } catch (e) {
        var msg = "Could not start navigation: " + (e && e.message ? e.message : "unknown error");
        st = null;
        reject(new Error(msg));
        return;
      }

      acquireWakeLock();
      try {
        document.addEventListener("visibilitychange", onVisibilityChange);
        st.visListenerAttached = true;
      } catch (e) {}
    });
  }

  function stop() {
    if (!st) return;
    cleanup();
    st = null;
  }

  function isActive() {
    return !!(st && st.active);
  }

  var api = {
    start: start,
    stop: stop,
    isActive: isActive,
    onUpdate: null,
    onArrive: null,
    onOffRoute: null,
    onCheckpoint: null
  };

  return api;
})();

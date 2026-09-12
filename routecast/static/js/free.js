/* ============================================================
   RouteCast — free driving

   Navigation without a destination. Everything the driving dashboard shows
   that does not depend on a planned line — speed, distance covered, moving
   and stopped time, average and top speed, climb, heading, the sky where
   you actually are — and, crucially, the SAME ride recorder that runs during
   navigation. A road you rode without planning it is still a road you know,
   and RouteCast learns it either way.

   What it deliberately does NOT do
   --------------------------------
   * No route projection, no remaining distance, no ETA. There is nowhere to
     arrive, and inventing a destination to have something to count down to
     would be a lie the whole app is built to avoid.
   * No ETA calibration record. The pace model learns from a ride against a
     PREDICTION; a free ride has none, so it teaches roads and nothing else.
     (nav.js's endSession(summary) contract: a null summary records the roads
     and leaves the timing model alone.)

   Cost
   ----
   Nothing polls. The dashboard is driven entirely by the geolocation fixes
   the browser hands us. The single behaviour that costs a request — the
   local forecast — is gated on time AND distance AND visibility, so a phone
   in a pocket at a red light spends nothing.
   ============================================================ */
RC.free = (function () {
  "use strict";

  var SPEED_SMOOTHING = 0.45;    // matches nav.js: a readable, non-flickering number
  var MOVING_KMH = 3;            // below this the rider is stopped, not crawling
  var MAX_PLAUSIBLE_KMH = 400;   // anything faster is a GPS jump, not a motorcycle
  var MAX_ACCURACY_M = 100;      // a fix vaguer than this cannot move the odometer
  var ALT_DEADBAND_M = 3;        // GPS altitude noise floor; below it, no climb is real
  var TRACK_MIN_GAP_M = 15;      // decimate the drawn line — 1 Hz fixes at 60 km/h is 17 m
  var TRACK_MAX_POINTS = 6000;

  // The local forecast: at most this often, and only after moving this far.
  var WX_INTERVAL_MS = 12 * 60 * 1000;
  var WX_DISTANCE_M = 5000;

  var st = null;

  function canGoOnline() {
    try {
      if (navigator.onLine === false) return false;
      if (document.visibilityState === "hidden") return false;
    } catch (e) {}
    return true;
  }

  function smoothSpeed(prev, next) {
    if (next == null) return prev;
    if (prev == null) return next;
    return prev + (next - prev) * SPEED_SMOOTHING;
  }

  /* ---------- wake lock (same contract as nav.js) ---------- */

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
        }, function () {});
      }
    } catch (e) {}
  }

  function onVisibilityChange() {
    try {
      if (document.visibilityState === "visible" && st && st.active && !st.wakeLock) acquireWakeLock();
    } catch (e) {}
  }

  /* ---------- the odometer ----------
     The one number a free ride is really about, so it is the one number
     worth being fussy about. A step is only counted when it is longer than
     the fix's own error circle can explain and slower than a motorcycle can
     actually travel — otherwise a phone sitting at a junction under a
     flyover racks up kilometres it never rode. */
  function acceptStep(prev, next, dtS, accuracy) {
    var d = RC.haversine(prev, next);
    if (!(dtS > 0)) return 0;
    if (d < 1) return 0;
    var impliedKmh = (d / dtS) * 3.6;
    if (impliedKmh > MAX_PLAUSIBLE_KMH) return 0;
    if (typeof accuracy === "number" && accuracy > 0) {
      if (accuracy > MAX_ACCURACY_M) return 0;
      if (d < accuracy * 0.5) return 0;
    }
    return d;
  }

  function maybeFetchWeather(state, nowMs) {
    if (st.wxBusy) return;
    if (typeof RC.free.onWeather !== "function") return;
    if (nowMs - st.lastWxTs < WX_INTERVAL_MS && st.distanceM - st.lastWxDistanceM < WX_DISTANCE_M) return;
    if (!canGoOnline()) return;
    st.wxBusy = true;
    st.lastWxTs = nowMs;
    st.lastWxDistanceM = st.distanceM;
    var session = st;
    var done = function () { if (st === session) st.wxBusy = false; };
    try {
      Promise.resolve(RC.free.onWeather(state)).then(done, done);
    } catch (e) { done(); }
  }

  function handlePosition(position) {
    if (!st || !st.active) return;
    try {
      var c = position.coords || {};
      var lat = c.latitude, lon = c.longitude;
      if (typeof lat !== "number" || typeof lon !== "number") return;

      var nowMs = Date.now();
      var accuracy = (typeof c.accuracy === "number") ? c.accuracy : null;

      if (!st.startedAt) {
        st.startedAt = nowMs;
        st.lastTickTs = nowMs;
      }

      var speedKmh = (typeof c.speed === "number" && c.speed != null && !isNaN(c.speed))
        ? Math.max(0, c.speed * 3.6) : null;
      var headingDeg = (typeof c.heading === "number" && !isNaN(c.heading)) ? c.heading : null;

      var stepM = 0;
      if (st.lastFix) {
        var dtS = (nowMs - st.lastFix.t) / 1000;
        stepM = acceptStep({ lat: st.lastFix.lat, lon: st.lastFix.lon }, { lat: lat, lon: lon }, dtS, accuracy);
        st.distanceM += stepM;
        // A chipset that reports no speed of its own still has two fixes and
        // a clock, which is all a speed is.
        if (speedKmh == null && dtS > 0.4 && dtS < 30 && stepM > 0) {
          speedKmh = (stepM / dtS) * 3.6;
        }
      }

      // Moving vs stopped, charged against wall-clock time rather than fix
      // count: a phone that drops to one fix a minute in a tunnel must not
      // make the average speed look better than the ride was.
      var tickS = st.lastTickTs ? (nowMs - st.lastTickTs) / 1000 : 0;
      if (tickS > 0 && tickS < 120) {
        if ((speedKmh != null && speedKmh >= MOVING_KMH) || stepM > 2) st.movingS += tickS;
        else st.stoppedS += tickS;
      }
      st.lastTickTs = nowMs;

      st.smoothedSpeedKmh = smoothSpeed(st.smoothedSpeedKmh, speedKmh);
      if (speedKmh != null && speedKmh > st.maxSpeedKmh && speedKmh < MAX_PLAUSIBLE_KMH) {
        st.maxSpeedKmh = speedKmh;
      }

      // Climb and descent from the phone's altitude, with a deadband: GPS
      // altitude wanders several metres at a standstill, and without one a
      // parked bike "climbs" a mountain over an afternoon.
      var altitude = (typeof c.altitude === "number" && !isNaN(c.altitude)) ? c.altitude : null;
      var gradePct = null;
      if (altitude != null) {
        if (st.lastAltM == null) {
          st.lastAltM = altitude;
        } else {
          var dAlt = altitude - st.lastAltM;
          if (Math.abs(dAlt) >= ALT_DEADBAND_M) {
            if (dAlt > 0) st.climbM += dAlt; else st.descentM += -dAlt;
            if (stepM > 5) gradePct = (dAlt / stepM) * 100;
            st.lastAltM = altitude;
          }
        }
        if (st.minAltM == null || altitude < st.minAltM) st.minAltM = altitude;
        if (st.maxAltM == null || altitude > st.maxAltM) st.maxAltM = altitude;
      }

      // The travelled line, decimated. This is what gets drawn behind the
      // rider; the history recorder keeps its own, coarser record.
      if (!st.track.length || RC.haversine(
            { lat: st.track[st.track.length - 1][0], lon: st.track[st.track.length - 1][1] },
            { lat: lat, lon: lon }) >= TRACK_MIN_GAP_M) {
        st.track.push([lat, lon]);
        if (st.track.length > TRACK_MAX_POINTS) st.track.splice(0, st.track.length - TRACK_MAX_POINTS);
      }

      st.lastFix = { lat: lat, lon: lon, t: nowMs };

      var elapsedS = (nowMs - st.startedAt) / 1000;
      // Two averages, because they answer different questions: the moving
      // average is how fast the road is, the overall one is how long the
      // journey took. Showing only the second makes every city ride look
      // like a crawl; showing only the first hides the traffic.
      var avgMovingKmh = st.movingS > 20 ? (st.distanceM / st.movingS) * 3.6 : null;
      var avgOverallKmh = elapsedS > 30 ? (st.distanceM / elapsedS) * 3.6 : null;

      var state = {
        lat: lat, lon: lon, accuracy: accuracy,
        speedKmh: speedKmh,
        displaySpeedKmh: st.smoothedSpeedKmh,
        maxSpeedKmh: st.maxSpeedKmh || null,
        avgSpeedKmh: avgMovingKmh,
        avgOverallKmh: avgOverallKmh,
        headingDeg: headingDeg,
        courseDeg: headingDeg,
        distanceM: st.distanceM,
        elapsedS: elapsedS,
        movingS: st.movingS,
        stoppedS: st.stoppedS,
        elevationM: altitude,
        elevationSource: altitude == null ? null : "gps",
        gradePct: gradePct,
        climbM: st.climbM,
        descentM: st.descentM,
        track: st.track,
        wx: st.wx || null,
        wxAt: st.wxAt || null
      };

      /* The ride recorder — the entire reason free driving exists. It is fed
         the raw fix, exactly as navigation feeds it: what is worth recording
         is where you went, and a free ride knows that better than a planned
         one, because nothing suggested it. */
      if (st.recordHistory && RC.history) {
        try { RC.history.record({ lat: lat, lon: lon, t: nowMs, speedKmh: speedKmh }); } catch (e) {}
      }

      if (typeof RC.free.onUpdate === "function") {
        try { RC.free.onUpdate(state); } catch (e) {}
      }

      maybeFetchWeather(state, nowMs);

      if (typeof st.resolveStart === "function") {
        var resolveFn = st.resolveStart;
        st.resolveStart = null;
        st.rejectStart = null;
        resolveFn();
      }
    } catch (e) {
      try { console.error("RC.free: error handling position fix", e); } catch (e2) {}
    }
  }

  function handleError(err) {
    if (!st) return;
    var msg = "Could not get your location.";
    if (err && err.code === 1) msg = "Location permission was denied. Allow location access to record a ride.";
    else if (err && err.code === 2) msg = "Your location is currently unavailable.";
    else if (err && err.code === 3) msg = "Location request timed out.";

    if (typeof st.rejectStart === "function") {
      var rejectFn = st.rejectStart;
      st.rejectStart = null;
      st.resolveStart = null;
      cleanup();
      st = null;
      rejectFn(new Error(msg));
      return;
    }
    if (typeof RC.free.onError === "function") {
      try { RC.free.onError(msg); } catch (e) {}
    }
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

  /* ---------- public ---------- */

  function start(opts) {
    opts = opts || {};
    if (!navigator || !navigator.geolocation) {
      return Promise.reject(new Error("Geolocation is not available on this device or browser."));
    }
    if (st && st.active) cleanup();

    return new Promise(function (resolve, reject) {
      st = {
        active: true,
        vehicle: opts.vehicle || "car",
        recordHistory: opts.recordHistory !== false,
        watchId: null,
        wakeLock: null,
        visListenerAttached: false,
        startedAt: 0,
        lastTickTs: 0,
        lastFix: null,
        distanceM: 0,
        movingS: 0,
        stoppedS: 0,
        smoothedSpeedKmh: null,
        maxSpeedKmh: 0,
        climbM: 0,
        descentM: 0,
        lastAltM: null,
        minAltM: null,
        maxAltM: null,
        track: [],
        wx: null,
        wxAt: null,
        wxBusy: false,
        // Count the first forecast from the start: nothing has been fetched
        // for this position yet, so the distance gate is what holds it back
        // for the first few minutes, not the clock.
        lastWxTs: 0,
        lastWxDistanceM: 0,
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
        st = null;
        reject(new Error("Could not start recording: " + (e && e.message ? e.message : "unknown error")));
        return;
      }

      if (st.recordHistory && RC.history) {
        try { RC.history.startSession(st.vehicle); } catch (e) {}
      }

      acquireWakeLock();
      try {
        document.addEventListener("visibilitychange", onVisibilityChange);
        st.visListenerAttached = true;
      } catch (e) {}
    });
  }

  /* Ending a free ride hands back what it measured, for the summary the
     rider sees. The history session is closed with a null timing record on
     purpose: the roads are kept, the pace model is not touched. There was
     no estimate to be right or wrong about. */
  function stop() {
    if (!st) return null;
    var summary = {
      distanceM: st.distanceM,
      elapsedS: st.startedAt ? (Date.now() - st.startedAt) / 1000 : 0,
      movingS: st.movingS,
      stoppedS: st.stoppedS,
      maxSpeedKmh: st.maxSpeedKmh || null,
      avgMovingKmh: st.movingS > 20 ? (st.distanceM / st.movingS) * 3.6 : null,
      climbM: st.climbM,
      descentM: st.descentM,
      track: st.track.slice()
    };
    if (st.recordHistory && RC.history) {
      try { RC.history.endSession(null); } catch (e) {}
    }
    cleanup();
    st = null;
    return summary;
  }

  // Hand the last local forecast back in, so the next update carries it.
  function setWeather(wx) {
    if (!st) return false;
    st.wx = wx || null;
    st.wxAt = wx ? new Date() : null;
    return true;
  }

  function isActive() { return !!(st && st.active); }

  function snapshot() {
    if (!st) return null;
    return {
      distanceM: st.distanceM,
      elapsedS: st.startedAt ? (Date.now() - st.startedAt) / 1000 : 0,
      movingS: st.movingS,
      track: st.track
    };
  }

  return {
    start: start,
    stop: stop,
    setWeather: setWeather,
    isActive: isActive,
    snapshot: snapshot,
    onUpdate: null,
    onWeather: null,
    onError: null,
    MOVING_KMH: MOVING_KMH,
    _acceptStep: acceptStep
  };
})();

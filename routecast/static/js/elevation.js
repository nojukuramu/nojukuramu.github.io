/* ============================================================
   RouteCast — terrain
   Upstream: Open-Meteo's elevation endpoint
   (https://api.open-meteo.com/v1/elevation) — free, key-less, Copernicus
   DEM GLO-90 at 90 m resolution, up to 100 coordinates per request.

   Two things come out of it:

   * A **profile** for the panel: elevation sampled evenly along the route,
     with total climb and descent, so a ride over a mountain looks like one
     before you set off. Climb matters to a rider for reasons weather does
     not cover — it is colder up there, and a bike that is fine at sea level
     is a different bike on a 6% grade in the rain.
   * A **live reading** during navigation: the altitude at your position and
     the grade of the road under you, taken from the profile already in
     memory. The browser's own GPS altitude is reported too, but it is
     famously noisy on a phone; the DEM is steadier, so the HUD prefers it
     and falls back to the GPS figure only when there is no profile.

   One request per route, at most SAMPLES coordinates. Nothing is refetched
   during a ride: the ground does not move.
   ============================================================ */
RC.elevation = (function () {
  "use strict";

  var BASE = "https://api.open-meteo.com/v1/elevation";
  var CHUNK = 100;      // the endpoint's documented per-request maximum
  var SAMPLES = 100;    // points along the route; one request for most trips

  // Rounded-coordinate cache, so replanning the same route or picking an
  // alternative that shares most of its line costs nothing.
  var cache = {};
  var cacheCount = 0;
  var CACHE_MAX = 4000;

  function key(lat, lon) {
    return (Math.round(lat * 2000) / 2000) + "," + (Math.round(lon * 2000) / 2000);
  }

  function fetchChunk(points, signal) {
    var lats = [], lons = [];
    for (var i = 0; i < points.length; i++) {
      lats.push(Math.round(points[i].lat * 10000) / 10000);
      lons.push(Math.round(points[i].lon * 10000) / 10000);
    }
    var url = BASE + "?latitude=" + lats.join(",") + "&longitude=" + lons.join(",");
    return RC.jsonGet(url, { signal: signal, timeout: 12000 }).then(function (json) {
      var arr = (json && json.elevation) || [];
      for (var j = 0; j < points.length; j++) {
        var v = arr[j];
        if (typeof v === "number" && isFinite(v)) {
          if (cacheCount >= CACHE_MAX) { cache = {}; cacheCount = 0; }
          if (!cache.hasOwnProperty(key(points[j].lat, points[j].lon))) cacheCount++;
          cache[key(points[j].lat, points[j].lon)] = v;
          points[j].elevationM = v;
        }
      }
      return points;
    });
  }

  /* Pick SAMPLES points spread evenly by DISTANCE along the route, not by
     coordinate index — OSRM geometry is dense round corners and sparse on a
     straight, so index-spacing would sample every bend and skip the climb
     between them. */
  function pickPoints(route, count) {
    var cumDist = route.cumDist, coords = route.coords;
    var total = cumDist[cumDist.length - 1];
    var n = Math.max(2, Math.min(count, coords.length));
    var out = [];
    var ci = 0;
    for (var i = 0; i < n; i++) {
      var target = total * (i / (n - 1));
      while (ci < cumDist.length - 1 && cumDist[ci + 1] < target) ci++;
      out.push({ lat: coords[ci][0], lon: coords[ci][1], distance: cumDist[ci], i: ci });
    }
    return out;
  }

  /* RC.elevation.profile(route, opts) -> Promise<Profile>
     Profile = {
       points: [{distance, elevationM, lat, lon}],
       minM, maxM, climbM, descentM,
       at: function(distanceM) -> {elevationM, gradePct}
     }
     Rejects only on a network failure the caller may want to report; a
     partial response still resolves with whatever came back. */
  function profile(route, opts) {
    opts = opts || {};
    if (!route || !route.coords || route.coords.length < 2) {
      return Promise.reject(RC.error("No route to read the terrain of.", "input"));
    }
    var points = pickPoints(route, opts.samples || SAMPLES);

    // Serve whatever the cache already knows and ask only for the rest.
    var missing = [];
    for (var i = 0; i < points.length; i++) {
      var k = key(points[i].lat, points[i].lon);
      if (cache.hasOwnProperty(k)) points[i].elevationM = cache[k];
      else missing.push(points[i]);
    }
    if (!missing.length) return Promise.resolve(build(points));

    var chain = Promise.resolve();
    for (var c = 0; c < missing.length; c += CHUNK) {
      (function (slice) {
        chain = chain.then(function () { return fetchChunk(slice, opts.signal); });
      })(missing.slice(c, c + CHUNK));
    }
    return chain.then(function () { return build(points); });
  }

  // Climb and descent are accumulated with a small dead band: a 90 m DEM
  // sampled every few hundred metres has enough noise that summing every
  // sign change would invent hundreds of metres of climbing on a flat road.
  var NOISE_M = 4;

  function build(points) {
    var usable = points.filter(function (p) { return typeof p.elevationM === "number"; });
    if (!usable.length) throw RC.error("No elevation data for this route.", "http");

    var minM = Infinity, maxM = -Infinity, climbM = 0, descentM = 0;
    var anchor = usable[0].elevationM;
    for (var i = 0; i < usable.length; i++) {
      var e = usable[i].elevationM;
      if (e < minM) minM = e;
      if (e > maxM) maxM = e;
      var d = e - anchor;
      if (d > NOISE_M) { climbM += d; anchor = e; }
      else if (d < -NOISE_M) { descentM += -d; anchor = e; }
    }

    function at(distanceM) {
      if (usable.length < 2) return { elevationM: usable[0].elevationM, gradePct: 0 };
      var lo = 0;
      while (lo < usable.length - 2 && usable[lo + 1].distance < distanceM) lo++;
      var a = usable[lo], b = usable[lo + 1];
      var span = b.distance - a.distance;
      var f = span > 0 ? RC.clamp((distanceM - a.distance) / span, 0, 1) : 0;
      var rise = b.elevationM - a.elevationM;
      return {
        elevationM: a.elevationM + rise * f,
        gradePct: span > 0 ? (rise / span) * 100 : 0
      };
    }

    return {
      points: usable,
      minM: minM,
      maxM: maxM,
      climbM: Math.round(climbM),
      descentM: Math.round(descentM),
      at: at
    };
  }

  function clearCache() { cache = {}; cacheCount = 0; }

  return { profile: profile, clearCache: clearCache, SAMPLES: SAMPLES };
})();

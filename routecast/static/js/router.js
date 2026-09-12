/* ============================================================
   RouteCast — routing
   Upstream: OSRM demo server (https://router.project-osrm.org), free &
   key-less "driving" profile. This is a public demo instance meant for
   light/testing use — we keep requests to one route call per user action
   (no polling, no bulk loops) and let RC.jsonGet's built-in timeout/retry
   handle flakiness.

   cumDist/cumDur construction
   ----------------------------
   OSRM's per-leg `annotation.distance` / `annotation.duration` arrays hold
   one entry per EDGE of that leg's geometry (i.e. leg_coord_count - 1
   entries). Because consecutive legs share their boundary coordinate,
   concatenating every leg's annotation array *in order* produces exactly
   one edge-length/duration value per edge of the FULL route geometry —
   there's no need to separately track where each leg's coordinates start
   and end. Edge count = coords.length - 1, which is exactly what a flat
   concatenation of the per-leg annotation arrays gives you. cumDist/cumDur
   are then just the running (prefix) sums of those edges, seeded with 0.

   When annotations are missing altogether we can't recover leg boundaries
   from the geometry either, so the fallback approximates at the whole-route
   level: edge lengths come from haversine distance between consecutive
   geometry coordinates (scaled so the total matches route.distance), and
   duration is distributed across edges proportionally to those same
   haversine weights (scaled so the total matches route.duration).
   ============================================================ */
RC.router = (function () {
  "use strict";

  var BASE = "https://router.project-osrm.org";

  var VEHICLE = {
    car:        { label: "Car",        factor: 1.00, exclude: [null] },
    // Filters traffic (approximation) and, being under 400cc territory in
    // practice, legally banned from PH expressways (NLEX/SLEX/SCTEX/
    // CAVITEX/Skyway etc, all OSM `motorway` class) — see avoidMotorways.
    //
    // `exclude` is a LADDER, not a flag. OSRM's stock car profile declares
    // three excludable classes — motorway, toll and ferry — and accepts them
    // combined. Every Philippine expressway a motorcycle is barred from is
    // also a toll road, and a handful of them (the older CAVITEX segments,
    // parts of the C-5 Link) are tagged `trunk` rather than `motorway` in
    // OSM, so `motorway,toll` catches roads that `motorway` alone leaves in
    // the line. It is also the request most likely to be refused, which is
    // why it is the FIRST rung and not the only one: each rung is tried in
    // turn and the first the server honours wins, so a demo instance that
    // cannot combine classes still gets the plain exclusion rather than
    // nothing at all.
    motorcycle: { label: "Motorcycle", factor: 0.93, avoidMotorways: true,
                  exclude: ["motorway,toll", "motorway", null] }
  };

  // OSRM codes that mean "the exclude=motorway parameter itself is why this
  // failed" (server doesn't support it, or genuinely can't route around the
  // expressway) as opposed to an unrelated problem with the request.
  var EXCLUDE_RETRY_CODES = { InvalidValue: "unsupported", NotImplemented: "unsupported", NoRoute: "no-route" };

  var OSRM_ERROR_MESSAGES = {
    NoRoute: "No road route between those points.",
    NoSegment: "One of those points isn't near a road OSRM knows about.",
    InvalidInput: "That request wasn't valid — try different points.",
    NotImplemented: "That kind of route isn't supported.",
    TooBig: "That route has too many points for the demo server."
  };

  /* Philippine expressways, by the names OSM actually carries in `ref` and
     `name` and that OSRM echoes back in its step names. Riders are barred
     from all of them, so this list is the second line of defence behind
     `exclude=motorway`: when the routing server cannot honour the exclusion
     (see EXCLUDE_RETRY_CODES) we still want to know whether the line it gave
     us puts a motorcycle somewhere it is not allowed to be — and to prefer,
     among the alternatives on offer, the one that does so least.

     Matching is on whole words, with a negative lookahead for the suffixes
     that mark an ordinary street — "Skyway" is the expressway, "Skyway
     Avenue" is a road in a subdivision named after it. It remains a
     heuristic over free text, not a classification: it can miss an unnamed
     motorway segment and it can still be fooled by an unusual name, so a
     clean result is reported as "nothing found", never as a guarantee that
     the route is legal for a motorcycle. */
  var EXPRESSWAY_RE = new RegExp(
    "\\b(" + [
      "NLEX", "SLEX", "SCTEX", "TPLEX", "STAR ?Tollway", "CAVITEX", "CALAX",
      "NAIAX", "Skyway", "C-?5 ?Link", "CCLEX", "TPLEx", "MCX", "SLEx",
      "Subic[- ]Clark[- ]Tarlac Expressway", "North Luzon Expressway",
      "South Luzon Expressway", "Manila[- ]Cavite Expressway",
      "Tarlac[- ]Pangasinan[- ]La Union Expressway",
      "Cavite[- ]Laguna Expressway", "Cebu[- ]Cordova Link Expressway",
      "Muntinlupa[- ]Cavite Expressway", "Expressway", "Tollway"
    ].join("|") + ")\\b(?! ?(Avenue|Ave|Street|St|Road|Rd|Drive|Lane|Alley|Barangay|Village|Subdivision|Hall)\\b)", "i");

  /* The expressway-looking road a single step is on, or null.

     Two fields are read, not one. OSRM echoes the street NAME in its
     instruction text, but Philippine expressways are signed by their
     reference — a step on the North Luzon Expressway routinely comes back
     named "Governor's Drive" with `ref: "NLEX"`, and reading only the
     instruction misses it entirely. The instruction is checked first
     because it produces the more readable label; the ref is the safety
     net under it. */
  function stepRoad(step) {
    var text = (step && step.text) || "";
    var m = text.match(EXPRESSWAY_RE);
    if (m) {
      // Report the road, not the instruction: "Take the ramp onto Skyway"
      // should surface as the road name after "onto" when there is one.
      var onto = text.split(" onto ");
      return (onto.length > 1 ? onto[onto.length - 1] : m[0]).trim();
    }
    var ref = (step && step.ref) || "";
    var m2 = ref.match(EXPRESSWAY_RE);
    return m2 ? m2[0].trim() : null;
  }

  /* The distinct expressway-looking road names a route's own steps mention,
     in order, deduplicated. Empty means nothing was found — which is not the
     same as proof there is nothing there. */
  function expresswayNames(route) {
    var seen = {}, out = [];
    var steps = (route && route.steps) || [];
    for (var i = 0; i < steps.length; i++) {
      var road = stepRoad(steps[i]);
      if (!road || seen[road]) continue;
      seen[road] = true;
      out.push(road);
    }
    return out;
  }

  /* Metres of a route spent on steps whose name or ref looks like an
     expressway. Used to choose between alternatives: least illegal beats
     first-returned, whether or not the exclusion was honoured. */
  function expresswayMeters(route) {
    var steps = (route && route.steps) || [];
    var m = 0;
    for (var i = 0; i < steps.length; i++) {
      if (stepRoad(steps[i])) m += steps[i].distance || 0;
    }
    return m;
  }

  // OSRM `bearings=deg,range;...` — one entry per waypoint, empty for any
  // waypoint we have no heading for. Used when rerouting mid-ride so the
  // router starts you facing the way you are actually pointing instead of
  // opening with a U-turn onto the carriageway you just left.
  function buildBearingString(bearings, count) {
    var parts = [];
    var any = false;
    for (var i = 0; i < count; i++) {
      var b = bearings[i];
      if (b && typeof b.deg === "number" && !isNaN(b.deg)) {
        parts.push(Math.round(((b.deg % 360) + 360) % 360) + "," + Math.round(b.range == null ? 90 : b.range));
        any = true;
      } else {
        parts.push("");
      }
    }
    return any ? parts.join(";") : null;
  }

  function buildCoordString(waypoints) {
    var parts = [];
    for (var i = 0; i < waypoints.length; i++) {
      parts.push(waypoints[i].lon + "," + waypoints[i].lat);
    }
    return parts.join(";");
  }

  // Turn a maneuver + street name into a short human instruction.
  function stepText(step) {
    var m = step.maneuver || {};
    var type = m.type || "";
    var modifier = m.modifier;
    var name = step.name || "";
    var verb;

    if (type === "depart") verb = "Head out";
    else if (type === "arrive") verb = "Arrive at destination";
    else if (type === "roundabout" || type === "rotary" || type === "roundabout turn") verb = "Enter the roundabout";
    else if (type === "merge") verb = "Merge";
    else if (type === "on ramp") verb = "Take the ramp";
    else if (type === "off ramp") verb = "Take the exit";
    else if (type === "fork") verb = modifier ? ("Keep " + modifier) : "Keep straight";
    else if (type === "end of road") verb = modifier ? ("Turn " + modifier) : "Turn";
    else if (type === "continue" || type === "new name") verb = "Continue";
    else if (type === "turn") verb = (modifier === "uturn") ? "Make a U-turn" : (modifier ? ("Turn " + modifier) : "Turn");
    else verb = modifier ? ("Turn " + modifier) : "Continue";

    var text = verb;
    if (name && type !== "arrive") text += " onto " + name;
    return text;
  }

  // First few distinct road names, "AH1, SLEX, Skyway".
  function buildSummary(legs) {
    var seen = {};
    var names = [];
    for (var i = 0; i < legs.length; i++) {
      var steps = legs[i].steps || [];
      for (var j = 0; j < steps.length; j++) {
        var name = steps[j].name;
        if (name && !seen[name]) {
          seen[name] = true;
          names.push(name);
          if (names.length >= 3) return names.join(", ");
        }
      }
    }
    return names.join(", ");
  }

  function parseRoute(osrmRoute, factor) {
    var coords = (osrmRoute.geometry.coordinates || []).map(function (c) {
      return [c[1], c[0]]; // [lon,lat] -> [lat,lon]
    });
    var legs = osrmRoute.legs || [];

    var haveAnnotations = legs.length > 0 && legs.every(function (leg) {
      return leg.annotation && leg.annotation.distance && leg.annotation.duration;
    });

    var cumDist = new Array(coords.length);
    var cumDur = new Array(coords.length);
    cumDist[0] = 0;
    cumDur[0] = 0;

    if (haveAnnotations) {
      var idx = 0;
      for (var li = 0; li < legs.length; li++) {
        var dArr = legs[li].annotation.distance;
        var uArr = legs[li].annotation.duration;
        for (var ei = 0; ei < dArr.length; ei++) {
          idx++;
          cumDist[idx] = cumDist[idx - 1] + dArr[ei];
          cumDur[idx] = cumDur[idx - 1] + uArr[ei] * factor;
        }
      }
    } else {
      // Fallback: haversine-weighted edges scaled to match route totals.
      var edgeDist = [];
      var totalHaversine = 0;
      for (var i = 1; i < coords.length; i++) {
        var d = RC.haversine(
          { lat: coords[i - 1][0], lon: coords[i - 1][1] },
          { lat: coords[i][0], lon: coords[i][1] }
        );
        edgeDist.push(d);
        totalHaversine += d;
      }
      var distScale = totalHaversine > 0 ? osrmRoute.distance / totalHaversine : 1;
      var durScale = totalHaversine > 0 ? (osrmRoute.duration * factor) / totalHaversine : 0;
      for (var k = 0; k < edgeDist.length; k++) {
        cumDist[k + 1] = cumDist[k] + edgeDist[k] * distScale;
        cumDur[k + 1] = cumDur[k] + edgeDist[k] * durScale;
      }
    }

    var steps = [];
    for (var si = 0; si < legs.length; si++) {
      var legSteps = legs[si].steps || [];
      for (var sj = 0; sj < legSteps.length; sj++) {
        var st = legSteps[sj];
        var loc = (st.maneuver && st.maneuver.location) || [0, 0];
        steps.push({
          text: stepText(st),
          name: st.name || "",
          ref: st.ref || "",
          distance: st.distance || 0,
          duration: (st.duration || 0) * factor,
          lat: loc[1],
          lon: loc[0]
        });
      }
    }

    return {
      coords: coords,
      cumDist: cumDist,
      cumDur: cumDur,
      distance: osrmRoute.distance,
      duration: osrmRoute.duration * factor,
      summary: buildSummary(legs),
      steps: steps,
      legs: legs.map(function (leg) {
        return { distance: leg.distance, duration: leg.duration * factor };
      })
    };
  }

  /* An in-memory, short-lived cache of finished route responses.

     Planning fires on a good many things that are not a new question: a
     vehicle toggled to look at the difference and toggled straight back, a
     spacing changed and changed again, a saved route tapped twice. Each of
     those used to be a fresh round trip to a public demo server for an
     answer we had thirty seconds ago. The key is the exact request, so a
     hit is always the same road; the TTL is short because traffic-free
     geometry still ages, and the cache is memory only, so a reload is a
     clean slate. An in-flight request is shared rather than duplicated —
     two identical plans a second apart cost one request, not two. */
  var CACHE_TTL_MS = 90 * 1000;
  var CACHE_MAX = 24;
  var cache = new Map();

  function cacheGet(key) {
    var hit = cache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.t > CACHE_TTL_MS) { cache.delete(key); return null; }
    return hit.p;
  }

  function cachePut(key, promise) {
    cache.set(key, { t: Date.now(), p: promise });
    // Never leave a rejection cached: the next attempt deserves the network.
    promise.catch(function () { cache.delete(key); });
    while (cache.size > CACHE_MAX) {
      var oldest = null, oldestT = Infinity;
      cache.forEach(function (v, k) { if (v.t < oldestT) { oldestT = v.t; oldest = k; } });
      if (oldest == null) break;
      cache.delete(oldest);
    }
  }

  function clearCache() { cache.clear(); }

  /* Cloning matters: callers mutate what they get back (eta.js writes a
     calibration onto the route, history.js writes a familiarity score), and
     a cache that handed out the same objects twice would serve the second
     rider the first one's annotations. */
  function cloneRoutes(routes) {
    return routes.map(function (r) {
      var copy = {};
      for (var k in r) if (Object.prototype.hasOwnProperty.call(r, k)) copy[k] = r[k];
      return copy;
    });
  }

  // Least illegal first, then quickest. Applied to every motorcycle result,
  // not only to the ones where the exclusion was refused: an exclusion the
  // server accepted still cannot catch a tollway OSM has tagged `trunk`.
  function rankByLegality(routes) {
    return routes.slice().sort(function (a, b) {
      var ea = a.expresswayM, eb = b.expresswayM;
      // Under a couple of hundred metres the difference is a ramp shared
      // with a legal road, not a stretch of expressway; do not trade real
      // minutes for it.
      if (Math.abs(ea - eb) > 200) return ea - eb;
      return a.duration - b.duration;
    });
  }

  // RC.router.route(waypoints, {vehicle, alternatives, signal, bearings, avoidMotorways}) -> Promise<Route[]>
  function route(waypoints, opts) {
    opts = opts || {};
    if (!waypoints || waypoints.length < 2) {
      return Promise.reject(RC.error("Need at least two points to route.", "route"));
    }
    var vehicleKey = opts.vehicle || "car";
    var vehicle = VEHICLE[vehicleKey] || VEHICLE.car;
    var alternatives = opts.alternatives == null ? true : opts.alternatives;
    var avoid = opts.avoidMotorways == null ? !!vehicle.avoidMotorways : !!opts.avoidMotorways;

    // Ask for three rather than "as many as you feel like". More lines to
    // choose from is the single cheapest way to find one that stays off the
    // expressway, and it costs the same request.
    var altParam = alternatives ? "3" : "false";

    var baseUrl = BASE + "/route/v1/driving/" + buildCoordString(waypoints) +
      "?overview=full&geometries=geojson&steps=true&annotations=duration,distance" +
      "&alternatives=" + altParam;

    if (opts.bearings) {
      var bstr = buildBearingString(opts.bearings, waypoints.length);
      if (bstr) baseUrl += "&bearings=" + bstr;
    }

    /* One OSRM request at one rung of the exclusion ladder. `exclude` is the
       class string for this rung, or null for "ask for nothing special".
       forceAlternatives widens a single-route request when we are hunting
       for a legal line and the first answer was not one. */
    function attempt(exclude, forceAlternatives) {
      var url = baseUrl;
      if (forceAlternatives && !alternatives) url = url.replace("&alternatives=false", "&alternatives=3");
      if (exclude) url += "&exclude=" + encodeURIComponent(exclude);

      var key = url;
      var cached = cacheGet(key);
      if (cached) return cached.then(cloneRoutes);

      var p = RC.jsonGet(url, { signal: opts.signal }).then(function (data) {
        // OSRM only ever resolves here with code "Ok" — any error code comes
        // back as an HTTP 400 (see the .catch below) — but guard anyway in
        // case a future response shape slips an error through as 200.
        if (!data || data.code !== "Ok") {
          throw RC.error(OSRM_ERROR_MESSAGES[data && data.code] || "Could not calculate a route.",
                         "route", null, data && data.code);
        }
        var routes = (data.routes || []).map(function (r) { return parseRoute(r, vehicle.factor); });
        if (!routes.length) throw RC.error(OSRM_ERROR_MESSAGES.NoRoute, "route", null, "NoRoute");
        for (var j = 0; j < routes.length; j++) {
          // Annotate every route, excluded or not: an exclusion the server
          // accepted can still leave a toll expressway in the line if OSM
          // has it tagged as trunk rather than motorway, and the rider would
          // rather be told than find out at the toll gate.
          routes[j].expresswayNames = expresswayNames(routes[j]);
          routes[j].expresswayM = expresswayMeters(routes[j]);
          routes[j].excludeApplied = exclude || null;
          routes[j].avoidedMotorways = !!exclude;
        }
        return routes;
      }, function (err) {
        // OSRM's error responses (InvalidValue, NoRoute, NotImplemented, ...)
        // arrive as HTTP 400 with a JSON body, not a resolved payload — see
        // RC.jsonGet, which attaches that body as err.body.
        if (err && err.status === 400 && err.body && err.body.code) {
          throw RC.error(OSRM_ERROR_MESSAGES[err.body.code] || err.body.message || "Could not calculate a route.",
                         "route", 400, err.body.code);
        }
        throw err;
      });

      cachePut(key, p);
      return p.then(cloneRoutes);
    }

    /* Walk the ladder. A failure that names the exclusion itself
       (InvalidValue / NotImplemented from a server that cannot honour the
       class, NoRoute because there genuinely is no expressway-free way
       through) drops to the next rung; anything else is a real error and
       stops here, because retrying a bad waypoint with fewer constraints
       just produces a wrong answer more slowly. */
    var ladder = avoid ? vehicle.exclude.slice() : [null];
    var lastReason = null;

    function walk(i) {
      var exclude = ladder[i];
      return attempt(exclude, avoid && !alternatives).then(function (routes) {
        if (exclude) return finish(routes, null);
        // The bottom rung: nothing was excluded, so say why, and pick the
        // offered line that spends the fewest metres on an expressway
        // rather than whatever came back first.
        return finish(routes, avoid ? (lastReason || "unsupported") : null);
      }, function (err) {
        var code = err && err.code;
        if (i + 1 < ladder.length && (!code || EXCLUDE_RETRY_CODES.hasOwnProperty(code))) {
          if (code) lastReason = EXCLUDE_RETRY_CODES[code];
          return walk(i + 1);
        }
        throw err;
      });
    }

    /* One last look at what came back. When the exclusion was honoured but
       the winning line still runs a serious distance on something named like
       an expressway — a tollway OSM tagged `trunk`, which no exclusion class
       can catch — spend one more request with alternatives to see whether a
       clean line exists. Only once, only for a rider who is actually barred,
       and only when the offence is big enough to be a road rather than a
       shared ramp. */
    var RECHECK_M = 800;

    function finish(routes, failedReason) {
      var ranked = avoid ? rankByLegality(routes) : routes;
      for (var i = 0; i < ranked.length; i++) {
        ranked[i].motorwayAvoidanceFailed = !!failedReason;
        if (failedReason) ranked[i].motorwayAvoidanceReason = failedReason;
      }
      var best = ranked[0];
      if (avoid && !failedReason && !alternatives && best && best.expresswayM > RECHECK_M) {
        return attempt(best.excludeApplied, true).then(function (more) {
          var wider = rankByLegality(more);
          for (var k = 0; k < wider.length; k++) wider[k].motorwayAvoidanceFailed = false;
          // Only take the wider answer if it is actually cleaner; a second
          // opinion that agrees is not a reason to change the route.
          if (wider[0] && wider[0].expresswayM < best.expresswayM - 200) return [wider[0]];
          return ranked.slice(0, 1);
        }, function () { return ranked.slice(0, 1); });
      }
      return alternatives ? ranked : ranked.slice(0, 1);
    }

    return walk(0);
  }

  return {
    route: route,
    clearCache: clearCache,
    stepRoad: stepRoad,
    VEHICLE: VEHICLE,
    expresswayNames: expresswayNames,
    expresswayMeters: expresswayMeters,
    EXPRESSWAY_RE: EXPRESSWAY_RE
  };
})();

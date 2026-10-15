/* ============================================================
   RouteCast — routing
   Upstream: OSRM demo server for ordinary routes; Valhalla (FOSSGIS) when
   expressways must be avoided — see AVOID_LADDER. OSRM is
   https://router.project-osrm.org, free & key-less "driving" profile. This is a public demo instance meant for
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

  /* Valhalla, as run by FOSSGIS for openstreetmap.org's own directions:
     free, key-less, CORS-open, and — unlike the OSRM demo — able to keep a
     route off expressways. It is only asked when expressways must be
     avoided; every other route stays on OSRM, as it always has. */
  var VALHALLA = "https://valhalla1.openstreetmap.de/route";

  var VEHICLE = {
    car:        { label: "Car",        factor: 1.00, costing: "auto" },
    // Filters traffic (approximation) and, being under 400cc territory in
    // practice, legally banned from PH expressways (NLEX/SLEX/SCTEX/
    // CAVITEX/Skyway etc, all OSM `motorway` class) — see avoidMotorways.
    //
    // The avoidance used to be an OSRM `exclude=motorway,toll` ladder. The
    // demo server answers EVERY exclude value — motorway, toll, both — with
    // InvalidValue "Exclude flag combination is not supported" (checked
    // against the live server), so the ladder always fell to its bottom rung
    // and every motorcycle route was the expressway route with a warning on
    // it. Valhalla is asked instead; see AVOID_LADDER.
    motorcycle: { label: "Motorcycle", factor: 0.93, avoidMotorways: true, costing: "motorcycle" }
  };

  /* What to try, in order, when expressways must be avoided. "valhalla" is
     Valhalla with `exclude_highways` and `exclude_tolls`; null is plain OSRM.
     Both flags, because every PH expressway a rider is barred from is also
     tolled and a few are tagged `trunk` rather than `motorway`. The public
     instance downgrades the hard exclusion to a strong preference (warning
     208) — tried against NLEX, SLEX/STAR, SCTEX, TPLEX, Skyway, CAVITEX,
     CALAX and CCLEX trips it still came back clean on all of them, and on
     surface roads a rider would pick (EDSA, MacArthur Highway), where
     `use_highways: 0` wandered off down provincial roads and once still
     found TPLEX. So the answer is believed only when Valhalla's own
     `has_highway` / `has_toll` say it is clean (see parseValhalla). */
  var AVOID_LADDER = ["valhalla", null];

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
     Valhalla's exclusion: when it cannot be reached and the route falls back
     to plain OSRM (see AVOID_LADDER) we still want to know whether the line it gave
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

  function ordinal(n) {
    n = n | 0;
    var t = n % 100;
    if (t >= 11 && t <= 13) return n + "th";
    return n + (["th", "st", "nd", "rd"][n % 10] || "th");
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
    else if (type === "roundabout" || type === "rotary" || type === "roundabout turn") {
      /* Which exit is the whole instruction at a roundabout — "enter the
         roundabout" on its own sends a rider round it looking for a sign. */
      verb = m.exit ? "At the roundabout, take the " + ordinal(m.exit) + " exit" : "Enter the roundabout";
    }
    else if (type === "exit roundabout" || type === "exit rotary") verb = "Leave the roundabout";
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
          lon: loc[0],
          /* The manoeuvre itself, not just its sentence: the turn banner
             draws an arrow from these, and the voice decides from them
             whether an instruction is worth saying twice. */
          type: (st.maneuver && st.maneuver.type) || "",
          modifier: (st.maneuver && st.maneuver.modifier) || "",
          exit: (st.maneuver && st.maneuver.exit) || 0
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

  /* Valhalla's shapes are Google polylines at six decimal places. */
  function decodePolyline6(str) {
    var out = [], index = 0, lat = 0, lon = 0;
    while (index < str.length) {
      var shift = 0, result = 0, b;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lon += (result & 1) ? ~(result >> 1) : (result >> 1);
      out.push([lat / 1e6, lon / 1e6]);
    }
    return out;
  }

  /* Valhalla's numbered manoeuvres, translated into OSRM's type/modifier
     vocabulary. Everything downstream — stepText, the turn banner's arrows,
     the voice deciding what is worth saying — already speaks OSRM, and one
     vocabulary is better than teaching three files a second one. */
  var VALHALLA_MANEUVER = {
    1: ["depart", ""], 2: ["depart", "right"], 3: ["depart", "left"],
    4: ["arrive", ""], 5: ["arrive", "right"], 6: ["arrive", "left"],
    7: ["new name", "straight"], 8: ["continue", "straight"],
    9: ["turn", "slight right"], 10: ["turn", "right"], 11: ["turn", "sharp right"],
    12: ["turn", "uturn"], 13: ["turn", "uturn"],
    14: ["turn", "sharp left"], 15: ["turn", "left"], 16: ["turn", "slight left"],
    17: ["on ramp", "straight"], 18: ["on ramp", "right"], 19: ["on ramp", "left"],
    20: ["off ramp", "right"], 21: ["off ramp", "left"],
    22: ["fork", "straight"], 23: ["fork", "right"], 24: ["fork", "left"],
    25: ["merge", "straight"], 26: ["roundabout", ""], 27: ["exit roundabout", ""],
    28: ["notification", "straight"], 29: ["notification", "straight"],
    37: ["merge", "slight right"], 38: ["merge", "slight left"]
  };

  /* Valhalla hands back one list mixing names and refs ("EDSA", "1", "AH26").
     A ref is a short letter prefix and a number ("1", "AH26", "E1", "C-5");
     the first entry that is not one is the name. Not "has no lower-case
     letters" — EDSA and NLEX are names written in capitals. */
  var REF_RE = /^[A-Z]{0,3}[- ]?\d+[A-Z]?$/;

  function splitStreetNames(list) {
    var name = "", refs = [];
    for (var i = 0; i < (list || []).length; i++) {
      var n = list[i];
      if (REF_RE.test(n)) refs.push(n);
      else if (!name) name = n;
    }
    return { name: name || refs[0] || "", ref: refs.join("; ") };
  }

  /* A Valhalla trip, in the exact shape parseRoute gives an OSRM route.
     cumDist/cumDur are built per manoeuvre: each manoeuvre's own length and
     time are spread over its shape segments by haversine weight, so the
     arrays agree with the step list rather than only with the total. */
  function parseValhalla(trip, factor) {
    var coords = [], cumDist = [0], cumDur = [0], steps = [], legs = [];
    var tripLegs = trip.legs || [];
    for (var li = 0; li < tripLegs.length; li++) {
      var leg = tripLegs[li];
      var shape = decodePolyline6(leg.shape || "");
      // Consecutive legs share their boundary point; keep it once.
      var offset = coords.length ? coords.length - 1 : 0;
      for (var c = (coords.length ? 1 : 0); c < shape.length; c++) coords.push(shape[c]);

      var mans = leg.maneuvers || [];
      for (var mi = 0; mi < mans.length; mi++) {
        var man = mans[mi];
        var b = man.begin_shape_index || 0, e = man.end_shape_index || b;
        var lenM = (man.length || 0) * 1000, dur = (man.time || 0) * factor;
        var w = [], tw = 0;
        for (var k = b; k < e; k++) {
          var d = RC.haversine({ lat: shape[k][0], lon: shape[k][1] }, { lat: shape[k + 1][0], lon: shape[k + 1][1] });
          w.push(d); tw += d;
        }
        for (var k2 = 0; k2 < w.length; k2++) {
          var gi = offset + b + k2 + 1;
          var share = tw > 0 ? w[k2] / tw : 1 / w.length;
          cumDist[gi] = cumDist[gi - 1] + lenM * share;
          cumDur[gi] = cumDur[gi - 1] + dur * share;
        }

        var kind = VALHALLA_MANEUVER[man.type] || ["turn", ""];
        var names = splitStreetNames(man.street_names);
        var exit = man.roundabout_exit_count || 0;
        var osrmLike = { name: names.name, maneuver: { type: kind[0], modifier: kind[1], exit: exit } };
        var at = shape[b] || shape[0] || [0, 0];
        steps.push({
          text: stepText(osrmLike),
          name: names.name,
          ref: names.ref,
          distance: lenM,
          duration: dur,
          lat: at[0],
          lon: at[1],
          type: kind[0],
          modifier: kind[1],
          exit: exit
        });
      }
      var ls = leg.summary || {};
      legs.push({ distance: (ls.length || 0) * 1000, duration: (ls.time || 0) * factor });
    }
    // A manoeuvre list that skips a point (it never should) must not leave a
    // hole the ETA would read as NaN.
    for (var f = 1; f < coords.length; f++) {
      if (cumDist[f] == null) cumDist[f] = cumDist[f - 1];
      if (cumDur[f] == null) cumDur[f] = cumDur[f - 1];
    }

    var seen = {}, summary = [];
    for (var si = 0; si < steps.length && summary.length < 3; si++) {
      var nm = steps[si].name;
      if (nm && !seen[nm]) { seen[nm] = true; summary.push(nm); }
    }
    var ts = trip.summary || {};
    return {
      coords: coords,
      cumDist: cumDist,
      cumDur: cumDur,
      distance: (ts.length || 0) * 1000,
      duration: (ts.time || 0) * factor,
      summary: summary.join(", "),
      steps: steps,
      legs: legs,
      // Valhalla's own verdict on the line, read edge by edge — far better
      // evidence than our reading of the names, so it decides whether the
      // avoidance held.
      hasHighway: !!ts.has_highway,
      hasToll: !!ts.has_toll
    };
  }

  // Valhalla's error codes that mean "nothing legal joins these points".
  var VALHALLA_NO_ROUTE = { 442: true, 443: true };

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

    function annotate(routes, rung) {
      for (var j = 0; j < routes.length; j++) {
        // Annotate every route, avoided or not: the rider would rather be
        // told about an expressway-looking name than find out at the toll
        // gate, whatever the router believed.
        routes[j].expresswayNames = expresswayNames(routes[j]);
        routes[j].expresswayM = expresswayMeters(routes[j]);
        // Kept as the class string app.js already explains to the rider.
        routes[j].excludeApplied = rung ? "motorway,toll" : null;
        routes[j].avoidedMotorways = !!rung;
        routes[j].engine = rung || "osrm";
      }
      return routes;
    }

    function cached(key, fetcher) {
      var hit = cacheGet(key);
      if (hit) return hit.then(cloneRoutes);
      var p = fetcher();
      cachePut(key, p);
      return p.then(cloneRoutes);
    }

    /* One plain OSRM request. forceAlternatives widens a single-route
       request when we are hunting for a legal line and the first answer was
       not one. */
    function attemptOsrm(forceAlternatives) {
      var url = baseUrl;
      if (forceAlternatives && !alternatives) url = url.replace("&alternatives=false", "&alternatives=3");

      return cached(url, function () {
        return RC.jsonGet(url, { signal: opts.signal }).then(function (data) {
          // OSRM only ever resolves here with code "Ok" — any error code comes
          // back as an HTTP 400 (see the .catch below) — but guard anyway in
          // case a future response shape slips an error through as 200.
          if (!data || data.code !== "Ok") {
            throw RC.error(OSRM_ERROR_MESSAGES[data && data.code] || "Could not calculate a route.",
                           "route", null, data && data.code);
          }
          var routes = (data.routes || []).map(function (r) { return parseRoute(r, vehicle.factor); });
          if (!routes.length) throw RC.error(OSRM_ERROR_MESSAGES.NoRoute, "route", null, "NoRoute");
          return annotate(routes, null);
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
      });
    }

    /* One Valhalla request with expressways and tolls excluded. A line that
       Valhalla itself says still uses a motorway or a toll is a refusal in
       all but name, and is reported as one ("no-route") so the caller can
       say so rather than present it as avoided. */
    function attemptValhalla(forceAlternatives) {
      var locations = waypoints.map(function (w, i) {
        var loc = { lat: w.lat, lon: w.lon };
        var bb = opts.bearings && opts.bearings[i];
        if (bb && typeof bb.deg === "number" && !isNaN(bb.deg)) {
          loc.heading = Math.round(((bb.deg % 360) + 360) % 360);
          loc.heading_tolerance = Math.round(bb.range == null ? 90 : bb.range);
        }
        return loc;
      });
      var costingOptions = {};
      costingOptions[vehicle.costing] = { exclude_highways: true, exclude_tolls: true };
      var body = {
        locations: locations,
        costing: vehicle.costing,
        costing_options: costingOptions,
        directions_options: { units: "kilometers", language: "en-US" }
      };
      // Valhalla only offers alternates between two points.
      if ((alternatives || forceAlternatives) && waypoints.length === 2) body.alternates = 2;
      var url = VALHALLA + "?json=" + encodeURIComponent(JSON.stringify(body));

      return cached(url, function () {
        return RC.jsonGet(url, { signal: opts.signal }).then(function (data) {
          var trips = [];
          if (data && data.trip) trips.push(data.trip);
          (data && data.alternates || []).forEach(function (a) { if (a && a.trip) trips.push(a.trip); });
          var routes = trips.map(function (t) { return parseValhalla(t, vehicle.factor); })
            .filter(function (r) { return r.coords.length > 1; });
          if (!routes.length) throw RC.error(OSRM_ERROR_MESSAGES.NoRoute, "route", null, "NoRoute");
          var clean = routes.filter(function (r) { return !r.hasHighway && !r.hasToll; });
          if (!clean.length) throw RC.error(OSRM_ERROR_MESSAGES.NoRoute, "route", null, "NoRoute");
          return annotate(clean, "valhalla");
        }, function (err) {
          var code = err && err.body && err.body.error_code;
          if (code && VALHALLA_NO_ROUTE[code]) throw RC.error(OSRM_ERROR_MESSAGES.NoRoute, "route", err.status, "NoRoute");
          throw err;
        });
      });
    }

    function attempt(rung, forceAlternatives) {
      return rung === "valhalla" ? attemptValhalla(forceAlternatives) : attemptOsrm(forceAlternatives);
    }

    /* Walk the ladder. Any Valhalla failure — busy, unreachable, no legal
       line — drops to plain OSRM, so the rider always gets a route; the
       panel then says plainly that this one may use expressways. Only a
       cancellation stops here. An OSRM failure is a real error and stops,
       because there is nothing below it. */
    var ladder = avoid ? AVOID_LADDER.slice() : [null];
    var lastReason = null;

    function walk(i) {
      var rung = ladder[i];
      return attempt(rung, avoid && !alternatives).then(function (routes) {
        if (rung) return finish(routes, null);
        // The bottom rung: nothing was avoided, so say why, and pick the
        // offered line that spends the fewest metres on an expressway
        // rather than whatever came back first.
        return finish(routes, avoid ? (lastReason || "unsupported") : null);
      }, function (err) {
        if (err && err.kind === "abort") throw err;
        if (i + 1 < ladder.length) {
          lastReason = (err && err.code === "NoRoute") ? "no-route" : "unsupported";
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
        return attempt(best.engine === "valhalla" ? "valhalla" : null, true).then(function (more) {
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
    AVOID_LADDER: AVOID_LADDER,
    // Exposed for the harness: the translation of a Valhalla trip is worth pinning.
    _parseValhalla: parseValhalla,
    _decodePolyline6: decodePolyline6,
    stepRoad: stepRoad,
    VEHICLE: VEHICLE,
    expresswayNames: expresswayNames,
    expresswayMeters: expresswayMeters,
    EXPRESSWAY_RE: EXPRESSWAY_RE,
    // Exposed for the harness: what a manoeuvre is called is worth pinning.
    _stepText: stepText
  };
})();

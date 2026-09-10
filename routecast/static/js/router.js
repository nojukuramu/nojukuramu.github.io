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
    car:        { label: "Car",        factor: 1.00 },
    // Filters traffic (approximation) and, being under 400cc territory in
    // practice, legally banned from PH expressways (NLEX/SLEX/SCTEX/
    // CAVITEX/Skyway etc, all OSM `motorway` class) — see avoidMotorways.
    motorcycle: { label: "Motorcycle", factor: 0.93, avoidMotorways: true }
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

  /* The distinct expressway-looking road names a route's own steps mention,
     in order, deduplicated. Empty means nothing was found — which is not the
     same as proof there is nothing there. */
  function expresswayNames(route) {
    var seen = {}, out = [];
    var steps = route.steps || [];
    for (var i = 0; i < steps.length; i++) {
      var name = steps[i].text || "";
      var m = name.match(EXPRESSWAY_RE);
      if (!m) continue;
      // Report the road, not the instruction: "Take the ramp onto Skyway"
      // should surface as the road name after "onto" when there is one.
      var onto = name.split(" onto ");
      var road = (onto.length > 1 ? onto[onto.length - 1] : m[0]).trim();
      if (seen[road]) continue;
      seen[road] = true;
      out.push(road);
    }
    return out;
  }

  /* Metres of a route spent on steps whose name looks like an expressway.
     Used to choose between alternatives when the exclusion could not be
     applied at all: least illegal beats first-returned. */
  function expresswayMeters(route) {
    var steps = route.steps || [];
    var m = 0;
    for (var i = 0; i < steps.length; i++) {
      if (EXPRESSWAY_RE.test(steps[i].text || "")) m += steps[i].distance || 0;
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

  // RC.router.route(waypoints, {vehicle, alternatives, signal, bearings}) -> Promise<Route[]>
  function route(waypoints, opts) {
    opts = opts || {};
    if (!waypoints || waypoints.length < 2) {
      return Promise.reject(RC.error("Need at least two points to route.", "route"));
    }
    var vehicleKey = opts.vehicle || "car";
    var vehicle = VEHICLE[vehicleKey] || VEHICLE.car;
    var alternatives = opts.alternatives == null ? true : opts.alternatives;

    var baseUrl = BASE + "/route/v1/driving/" + buildCoordString(waypoints) +
      "?overview=full&geometries=geojson&steps=true&annotations=duration,distance" +
      "&alternatives=" + (alternatives ? "true" : "false");

    if (opts.bearings) {
      var bstr = buildBearingString(opts.bearings, waypoints.length);
      if (bstr) baseUrl += "&bearings=" + bstr;
    }

    // attempt(useExclude, forceAlternatives) fires one OSRM request, with or
    // without exclude=motorway. On a code that indicates the exclusion itself
    // is the problem, it retries exactly once without it and flags the
    // returned routes as an honest fallback rather than pretending the
    // avoidance worked. A network/timeout/abort error (rejected promise,
    // no OSRM `code` at all) is never retried here — RC.jsonGet already
    // owns its own retry policy for those.
    function handleFailure(useExclude, code, data) {
      if (useExclude && EXCLUDE_RETRY_CODES.hasOwnProperty(code)) {
        var reason = EXCLUDE_RETRY_CODES[code];
        // Ask for alternatives on the fallback even when the caller did not
        // want them: if we cannot make the server keep a motorcycle off an
        // expressway, the least we can do is pick the offered line that
        // spends the fewest metres on one.
        return attempt(false, true).then(function (routes) {
          routes.sort(function (a, b) {
            var ea = expresswayMeters(a), eb = expresswayMeters(b);
            if (ea !== eb) return ea - eb;
            return a.duration - b.duration;
          });
          for (var i = 0; i < routes.length; i++) {
            routes[i].motorwayAvoidanceFailed = true;
            routes[i].motorwayAvoidanceReason = reason; // "unsupported" | "no-route"
          }
          // The caller asked for one route; give it the least-illegal one.
          return alternatives ? routes : routes.slice(0, 1);
        });
      }
      var msg = OSRM_ERROR_MESSAGES[code] || (data && data.message) || "Could not calculate a route.";
      throw RC.error(msg, "route");
    }

    function attempt(useExclude, forceAlternatives) {
      var url = baseUrl;
      if (forceAlternatives && !alternatives) {
        url = url.replace("&alternatives=false", "&alternatives=true");
      }
      url += (useExclude ? "&exclude=motorway" : "");
      return RC.jsonGet(url, { signal: opts.signal }).then(function (data) {
        // OSRM only ever resolves here with code "Ok" — any error code comes
        // back as an HTTP 400 (see the .catch below) — but guard anyway in
        // case a future response shape slips an error through as 200.
        if (!data || data.code !== "Ok") return handleFailure(useExclude, data && data.code, data);
        var routes = (data.routes || []).map(function (r) { return parseRoute(r, vehicle.factor); });
        for (var j = 0; j < routes.length; j++) {
          if (useExclude) routes[j].avoidedMotorways = true;
          // Annotate every route, excluded or not: an exclusion that the
          // server accepted can still leave a toll expressway in the line
          // if OSM has it tagged as trunk rather than motorway, and the
          // rider would rather be told than find out at the toll gate.
          routes[j].expresswayNames = expresswayNames(routes[j]);
        }
        return routes;
      }, function (err) {
        // OSRM's error responses (InvalidValue, NoRoute, NotImplemented, ...)
        // arrive as HTTP 400 with a JSON body, not a resolved payload — see
        // RC.jsonGet, which attaches that body as err.body.
        if (err && err.status === 400 && err.body && err.body.code) {
          return handleFailure(useExclude, err.body.code, err.body);
        }
        throw err;
      });
    }

    return attempt(!!vehicle.avoidMotorways);
  }

  return {
    route: route,
    VEHICLE: VEHICLE,
    expresswayNames: expresswayNames,
    expresswayMeters: expresswayMeters,
    EXPRESSWAY_RE: EXPRESSWAY_RE
  };
})();

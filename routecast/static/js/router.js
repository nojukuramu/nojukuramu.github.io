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
    motorcycle: { label: "Motorcycle", factor: 0.93 } // filters traffic; approximation
  };

  var OSRM_ERROR_MESSAGES = {
    NoRoute: "No road route between those points.",
    NoSegment: "One of those points isn't near a road OSRM knows about.",
    InvalidInput: "That request wasn't valid — try different points.",
    NotImplemented: "That kind of route isn't supported.",
    TooBig: "That route has too many points for the demo server."
  };

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

  // RC.router.route(waypoints, {vehicle, alternatives, signal}) -> Promise<Route[]>
  function route(waypoints, opts) {
    opts = opts || {};
    if (!waypoints || waypoints.length < 2) {
      return Promise.reject(RC.error("Need at least two points to route.", "route"));
    }
    var vehicleKey = opts.vehicle || "car";
    var vehicle = VEHICLE[vehicleKey] || VEHICLE.car;
    var alternatives = opts.alternatives == null ? true : opts.alternatives;

    var url = BASE + "/route/v1/driving/" + buildCoordString(waypoints) +
      "?overview=full&geometries=geojson&steps=true&annotations=duration,distance" +
      "&alternatives=" + (alternatives ? "true" : "false");

    return RC.jsonGet(url, { signal: opts.signal }).then(function (data) {
      if (!data || data.code !== "Ok") {
        var code = data && data.code;
        var msg = OSRM_ERROR_MESSAGES[code] || (data && data.message) || "Could not calculate a route.";
        throw RC.error(msg, "route");
      }
      return (data.routes || []).map(function (r) { return parseRoute(r, vehicle.factor); });
    });
  }

  return { route: route, VEHICLE: VEHICLE };
})();

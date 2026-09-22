/* ============================================================
   TheCommuters — routing between the stops somebody dropped

   Upstream: the OSRM demo server (https://router.project-osrm.org), free
   and key-less, same instance RouteCast uses. This file keeps RouteCast's
   contract deliberately — same base URL, same "one route call per user
   action, no polling" politeness, same shape of result — because a second
   opinion about how to call OSRM in the same repository is how two callers
   end up hammering a public demo server differently.

   What is different here, and why
   -------------------------------
   RouteCast plans A to B for one vehicle. TheCommuters builds a LINE: an
   ordered list of stops that somebody is describing from memory, where the
   order is the point and the shape between them is the part the router
   fills in. So:

     * Every stop is a waypoint, in the order given, and `continue_straight`
       is off — a jeepney line doubles back on itself constantly and a
       router told not to U-turn will invent a loop around a block rather
       than admit it.
     * The polyline comes back decoded to [lat, lon] pairs, which is what
       goes in the database and what Leaflet draws.
     * Per-leg distances and durations are kept, because the route builder
       shows them per stop and the journey planner needs to know how far
       along a line a transfer happens.

   OSRM's demo server offers the car profile only. A jeepney is a vehicle on
   the same roads, so that is the right shape for everything here except
   walking legs, which are computed straight-line with a detour factor
   rather than routed — a walking route from a public demo server for a
   two-hundred-metre hop is a request nobody needs to make.
   ============================================================ */
var KM = KM || {};

KM.router = (function () {
  "use strict";

  var BASE = "https://router.project-osrm.org";

  /* Real walking is not a straight line. 1.35 is the usual figure for how
     much longer a street network makes a short walk than the crow flies. */
  var WALK_DETOUR = 1.35;
  var WALK_KMH = 4.5;

  /* ---------------------------------------------------------
     polyline6 decoding.

     OSRM's default `geometries=polyline` is 5 decimals, about 1.1 m, which
     visibly staircases a route drawn at street zoom. polyline6 is the same
     encoding at 6 decimals and costs a few more bytes.
     --------------------------------------------------------- */
  function decode(str, precision) {
    var factor = Math.pow(10, precision == null ? 6 : precision);
    var index = 0, lat = 0, lon = 0, out = [];
    while (index < str.length) {
      var b, shift = 0, result = 0;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += ((result & 1) ? ~(result >> 1) : (result >> 1));
      shift = 0; result = 0;
      do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lon += ((result & 1) ? ~(result >> 1) : (result >> 1));
      out.push([lat / factor, lon / factor]);
    }
    return out;
  }

  var OSRM_MESSAGES = {
    NoRoute: "No road route between those stops.",
    NoSegment: "One of those stops is not near a road the router knows.",
    InvalidInput: "That request was not valid — try moving a stop.",
    TooBig: "That is too many stops for the free routing server."
  };

  /* route(stops, {signal}) -> Promise<Route>

     stops: [{lat, lon}, ...], at least two, in order.
     Route: {
       path:      [[lat,lon], ...],     the drawn line
       distance:  metres, total
       duration:  seconds, total, as a car drives it
       legs:      [{distance, duration}, ...] one per gap between stops
     }
   */
  function route(stops, opts) {
    opts = opts || {};
    if (!stops || stops.length < 2) {
      return Promise.reject(KM.error("A route needs at least two stops.", "invalid"));
    }
    if (stops.length > KM.sanitize.LIMITS.stopsMax) {
      return Promise.reject(KM.error("That is more stops than a route can hold.", "invalid"));
    }

    var coords = stops.map(function (s) {
      return s.lon.toFixed(6) + "," + s.lat.toFixed(6);
    }).join(";");

    var url = BASE + "/route/v1/driving/" + coords +
      "?overview=full&geometries=polyline6&steps=false&continue_straight=false&annotations=false";

    return KM.jsonGet(url, { signal: opts.signal, timeout: 20000 }).then(function (body) {
      if (!body || body.code !== "Ok" || !body.routes || !body.routes.length) {
        var code = (body && body.code) || "NoRoute";
        throw KM.error(OSRM_MESSAGES[code] || "The router could not draw that.", "route", 0, code);
      }
      var r = body.routes[0];
      var path = decode(r.geometry, 6);
      if (path.length < 2) throw KM.error("The router returned an empty line.", "route");

      return {
        path: path,
        distance: Math.round(r.distance || 0),
        duration: Math.round(r.duration || 0),
        legs: (r.legs || []).map(function (leg) {
          return { distance: Math.round(leg.distance || 0), duration: Math.round(leg.duration || 0) };
        })
      };
    }, function (err) {
      /* OSRM sends its machine-readable reason in the body of a 400, which
         KM.jsonGet attaches. Surface the human sentence for the ones we
         have one for, and the generic network message otherwise. */
      var code = err && err.body && err.body.code;
      if (code && OSRM_MESSAGES[code]) throw KM.error(OSRM_MESSAGES[code], "route", err.status, code);
      throw err;
    });
  }

  /* A walking hop, not routed. Straight line, a detour factor, and a
     walking pace — enough to say "four minutes' walk" honestly without
     making a request to a public server for every transfer considered. */
  function walk(a, b) {
    var straight = KM.haversine(a, b);
    var distance = Math.round(straight * WALK_DETOUR);
    return {
      path: [[a.lat, a.lon], [b.lat, b.lon]],
      distance: distance,
      duration: Math.round(distance / (WALK_KMH * 1000 / 3600)),
      straight: Math.round(straight),
      estimated: true
    };
  }

  /* How far along a path each point sits, in metres. The journey planner
     lives on this: "does route A meet route B after I got on" is a
     comparison of two of these numbers. */
  function cumulative(path) {
    var out = [0];
    for (var i = 1; i < path.length; i++) {
      out.push(out[i - 1] + KM.haversine(
        { lat: path[i - 1][0], lon: path[i - 1][1] },
        { lat: path[i][0], lon: path[i][1] }));
    }
    return out;
  }

  /* Points spaced every `spacingM` along a path, each carrying how far
     along it is. Used for the weather checkpoints and for the grid the
     transfer finder hashes routes into. */
  function sample(path, spacingM) {
    var cum = cumulative(path);
    var total = cum[cum.length - 1];
    if (!(total > 0)) return [{ lat: path[0][0], lon: path[0][1], along: 0 }];
    var step = Math.max(50, spacingM || 200);
    var out = [];
    var target = 0, i = 0;
    while (target <= total + 1) {
      while (i < cum.length - 2 && cum[i + 1] < target) i++;
      var span = cum[i + 1] - cum[i];
      var t = span > 0 ? (target - cum[i]) / span : 0;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      out.push({
        lat: path[i][0] + (path[i + 1][0] - path[i][0]) * t,
        lon: path[i][1] + (path[i + 1][1] - path[i][1]) * t,
        along: Math.min(target, total)
      });
      target += step;
    }
    var last = path[path.length - 1];
    if (out[out.length - 1].along < total - 1) out.push({ lat: last[0], lon: last[1], along: total });
    return out;
  }

  /* The nearest point on a path to p, with how far along it is. Returns
     null when the path is empty. */
  function nearestOnPath(p, path, cum) {
    if (!path || path.length < 2) return null;
    cum = cum || cumulative(path);
    var best = null;
    for (var i = 0; i < path.length - 1; i++) {
      var a = { lat: path[i][0], lon: path[i][1] };
      var b = { lat: path[i + 1][0], lon: path[i + 1][1] };
      var hit = KM.nearestOnSegment(p, a, b);
      if (!best || hit.distance < best.distance) {
        best = {
          distance: hit.distance,
          point: hit.point,
          along: cum[i] + (cum[i + 1] - cum[i]) * hit.t,
          index: i
        };
      }
    }
    return best;
  }

  return {
    route: route,
    walk: walk,
    decode: decode,
    cumulative: cumulative,
    sample: sample,
    nearestOnPath: nearestOnPath,
    WALK_KMH: WALK_KMH,
    WALK_DETOUR: WALK_DETOUR
  };
})();

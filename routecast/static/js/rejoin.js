/* ============================================================
   RouteCast — rejoining a planned route

   A group ride has ONE line everybody agreed on: the planned route. It is
   static. It does not re-draw itself because somebody took a wrong turn, and
   it is byte-identical on every phone in the room — that is the whole point of
   it. So when a rider drifts off it, the answer is never "silently move the
   line". The answer is a set of ways back, drawn next to it, for the rider to
   pick from.

   Three kinds of way back
   -----------------------
   1. STOP       straight to a stop (or the destination) from where you are.
                 Ignores the planned line entirely — sometimes the detour you
                 took is genuinely the shorter way to the next meeting point.
   2. REJOIN     to the nearest point ON the planned line. The shortest way to
                 stop being the one who is lost.
   3. OPTIMISED  through that nearest point and on to the stop. Rejoins the
                 group's line and then rides it, which is what "we are riding
                 together" actually means.

   All of them are real routes from the router, not drawn guesses. Each is
   scored on time PLUS how much of it is spent away from the planned corridor,
   so the recommendation is not simply "whatever is fastest for me".

   Everything above the router call is pure geometry with no browser in it, so
   tools/validate.js can check the arithmetic without a network or a map.
   ============================================================ */
var RC = RC || {};

RC.rejoin = (function () {
  "use strict";

  var R_EARTH = 6371008.8;
  var TO_RAD = Math.PI / 180;

  // A rider this far from the planned line is off it. GPS on a motorcycle in
  // a city is routinely 30 m out and a dual carriageway's two sides are 20 m
  // apart, so anything tighter than this cries wolf at every traffic light.
  var OFF_ROUTE_M = 160;

  // ...and this far back inside it before we stop saying so. One threshold
  // for both directions would flicker the whole way down a road that runs
  // parallel to the planned one.
  var BACK_ON_M = 90;

  // The corridor a candidate route is measured against: geometry further than
  // this from the planned line counts as "away from the group".
  var CORRIDOR_M = 70;

  // A minute of penalty per kilometre ridden outside the corridor. Deliberately
  // mild: it should break a tie between two similar routes, not send a rider
  // 20 minutes out of their way for the sake of tidiness.
  var OFF_PENALTY_S_PER_KM = 60;

  var MAX_STOP_CANDIDATES = 2;   // at most this many "straight to a stop" asks
  var STOP_PASSED_M = 250;       // a stop this close behind you is done

  /* ---------- metres, cheaply ----------
     Everything here is local — a rider, a line, the few hundred metres
     between them — so one equirectangular projection around a reference
     latitude is exact enough and costs two multiplications instead of a
     haversine per segment. */
  function planar(lat, lon, refLat) {
    return {
      x: lon * TO_RAD * Math.cos(refLat * TO_RAD) * R_EARTH,
      y: lat * TO_RAD * R_EARTH
    };
  }

  function metres(aLat, aLon, bLat, bLon) {
    var ref = (aLat + bLat) / 2;
    var a = planar(aLat, aLon, ref);
    var b = planar(bLat, bLon, ref);
    var dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /** Cumulative metres along a [[lat,lon], ...] line. Index i is the distance
      from the start of the line to point i. */
  function cumulative(coords) {
    var cum = [0];
    for (var i = 1; i < coords.length; i++) {
      cum.push(cum[i - 1] + metres(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]));
    }
    return cum;
  }

  /** The closest point on the line to (lat, lon).
      Returns { lat, lon, i, distM, alongM } — i is the index of the segment
      start, alongM the distance from the beginning of the line, so a caller
      can ask "what is still ahead of me". */
  function nearestOn(coords, lat, lon, cum) {
    if (!coords || coords.length === 0) return null;
    if (coords.length === 1) {
      return { lat: coords[0][0], lon: coords[0][1], i: 0,
               distM: metres(lat, lon, coords[0][0], coords[0][1]), alongM: 0 };
    }
    cum = cum || cumulative(coords);
    var p = planar(lat, lon, lat);
    var best = null;

    for (var i = 0; i < coords.length - 1; i++) {
      var a = planar(coords[i][0], coords[i][1], lat);
      var b = planar(coords[i + 1][0], coords[i + 1][1], lat);
      var dx = b.x - a.x, dy = b.y - a.y;
      var len2 = dx * dx + dy * dy;
      var t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      var cx = a.x + t * dx, cy = a.y + t * dy;
      var ex = p.x - cx, ey = p.y - cy;
      var d2 = ex * ex + ey * ey;
      if (!best || d2 < best.d2) {
        best = {
          d2: d2,
          i: i,
          t: t,
          lat: coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t,
          lon: coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t,
          alongM: cum[i] + (cum[i + 1] - cum[i]) * t
        };
      }
    }
    return {
      lat: best.lat, lon: best.lon, i: best.i,
      distM: Math.sqrt(best.d2), alongM: best.alongM
    };
  }

  /** Metres from a point to the line — the number that decides "off route". */
  function distanceToLine(coords, lat, lon) {
    var n = nearestOn(coords, lat, lon);
    return n ? n.distM : null;
  }

  /** Douglas–Peucker, so a 4000-point geometry can cross a data channel and
      still be the same road. Tolerance is in metres. */
  function simplify(coords, toleranceM) {
    if (!coords || coords.length < 3) return (coords || []).slice();
    var tol = toleranceM || 12;
    var ref = coords[0][0];
    var pts = coords.map(function (c) { return planar(c[0], c[1], ref); });
    var keep = new Array(coords.length);
    keep[0] = keep[coords.length - 1] = true;

    // Iterative rather than recursive: a long route can be deep enough to
    // matter, and a blown stack here would take the whole ride with it.
    var stack = [[0, coords.length - 1]];
    while (stack.length) {
      var span = stack.pop();
      var first = span[0], last = span[1];
      var a = pts[first], b = pts[last];
      var dx = b.x - a.x, dy = b.y - a.y;
      var len2 = dx * dx + dy * dy;
      var worst = -1, worstAt = -1;
      for (var i = first + 1; i < last; i++) {
        var p = pts[i];
        var t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        var ex = p.x - (a.x + t * dx), ey = p.y - (a.y + t * dy);
        var d = Math.sqrt(ex * ex + ey * ey);
        if (d > worst) { worst = d; worstAt = i; }
      }
      if (worst > tol && worstAt > 0) {
        keep[worstAt] = true;
        stack.push([first, worstAt], [worstAt, last]);
      }
    }
    var out = [];
    for (var k = 0; k < coords.length; k++) if (keep[k]) out.push(coords[k]);
    return out;
  }

  /** Round to five decimals — about a metre — and hand back plain arrays.
      Full float precision triples the size of a shared route for accuracy
      no map at any zoom can show. */
  function compact(coords) {
    var out = [];
    for (var i = 0; i < coords.length; i++) {
      out.push([Math.round(coords[i][0] * 1e5) / 1e5, Math.round(coords[i][1] * 1e5) / 1e5]);
    }
    return out;
  }

  /** How much of `coords` runs further than CORRIDOR_M from the planned line.
      Sampled, not exhaustive: the answer feeds a tie-break, and an O(n*m)
      sweep over two full geometries on every suggestion is not worth a metre
      of precision. */
  function offCorridorMeters(coords, planned) {
    if (!coords || coords.length < 2 || !planned || planned.length < 2) return 0;
    var line = planned.length > 400 ? simplify(planned, 25) : planned;
    var total = 0;
    for (var i = 1; i < coords.length; i++) {
      var segLen = metres(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
      if (segLen === 0) continue;
      var mid = [(coords[i - 1][0] + coords[i][0]) / 2, (coords[i - 1][1] + coords[i][1]) / 2];
      if (distanceToLine(line, mid[0], mid[1]) > CORRIDOR_M) total += segLen;
    }
    return total;
  }

  /** The stops still ahead of a rider, in planned-route order.
      A stop is "behind" once the rider has passed the point on the line where
      it sits — not once they are merely near it, or a rider who stops for fuel
      200 m short of the meeting point loses it from the list. */
  function stopsAhead(planned, from) {
    var coords = planned && planned.coords;
    var stops = (planned && planned.stops) || [];
    if (!coords || coords.length < 2 || !stops.length) return stops.slice();
    var cum = cumulative(coords);
    var me = nearestOn(coords, from.lat, from.lon, cum);
    var out = [];
    for (var i = 0; i < stops.length; i++) {
      var s = stops[i];
      if (s.lat == null || s.lon == null) continue;
      var at = nearestOn(coords, s.lat, s.lon, cum);
      var alongM = at ? at.alongM : 0;
      var directM = metres(from.lat, from.lon, s.lat, s.lon);
      // The last stop is the destination, and you never pass your destination:
      // it stays on the list until you are standing on it.
      var isLast = i === stops.length - 1;
      var passed = isLast
        ? directM < STOP_PASSED_M
        : (alongM < me.alongM - STOP_PASSED_M && directM > STOP_PASSED_M);
      if (!passed) out.push({ lat: s.lat, lon: s.lon, name: s.name, alongM: alongM, index: i, isLast: isLast });
    }
    return out;
  }

  function score(cand, planned) {
    var offM = offCorridorMeters(cand.coords, planned);
    cand.offCorridorM = offM;
    cand.score = cand.duration + (offM / 1000) * OFF_PENALTY_S_PER_KM;
    return cand;
  }

  /* Two candidates whose geometry is the same road are one candidate with two
     names. Comparing endpoints and length catches it without comparing every
     point of two 3000-point lines. */
  function sameish(a, b) {
    if (!a || !b) return false;
    if (Math.abs(a.distance - b.distance) > Math.max(120, a.distance * 0.02)) return false;
    var ea = a.coords[a.coords.length - 1], eb = b.coords[b.coords.length - 1];
    return metres(ea[0], ea[1], eb[0], eb[1]) < 120;
  }

  /* ---------- the suggestion itself ----------
     `opts.router` exists so the harness can answer with canned geometry; in
     the app it is RC.router.route and nothing else. */
  function suggest(opts) {
    opts = opts || {};
    var from = opts.from;
    var planned = opts.planned;
    var router = opts.router || (RC.router && RC.router.route);
    if (!from || from.lat == null || !planned || !planned.coords || planned.coords.length < 2) {
      return Promise.resolve([]);
    }
    if (!router) return Promise.resolve([]);

    var routeOpts = {
      vehicle: opts.vehicle || "car",
      alternatives: false,
      avoidMotorways: opts.avoidMotorways,
      signal: opts.signal
    };

    var cum = cumulative(planned.coords);
    var me = nearestOn(planned.coords, from.lat, from.lon, cum);
    var ahead = stopsAhead(planned, from).slice(0, MAX_STOP_CANDIDATES);

    // The last point of the planned line is always a destination worth asking
    // about, even on a planned route that carried no named stops at all.
    if (!ahead.length) {
      var end = planned.coords[planned.coords.length - 1];
      ahead = [{ lat: end[0], lon: end[1], name: "the end of the planned route",
                 alongM: cum[cum.length - 1], index: 0, isLast: true }];
    }

    var jobs = [];

    // 1 — straight to each stop still ahead.
    ahead.forEach(function (stop) {
      jobs.push(
        router([{ lat: from.lat, lon: from.lon }, { lat: stop.lat, lon: stop.lon }], routeOpts)
          .then(function (routes) {
            var r = routes && routes[0];
            if (!r) return null;
            return {
              kind: "stop",
              label: "Direct to " + (stop.name || "the next stop"),
              why: "Ignores the planned line and heads straight there.",
              target: stop,
              route: r, coords: r.coords, distance: r.distance, duration: r.duration
            };
          }, function () { return null; })
      );
    });

    // 2 — to the nearest point on the planned line.
    jobs.push(
      router([{ lat: from.lat, lon: from.lon }, { lat: me.lat, lon: me.lon }], routeOpts)
        .then(function (routes) {
          var r = routes && routes[0];
          if (!r) return null;
          return {
            kind: "rejoin",
            label: "Back to the planned route",
            why: "The shortest way back onto the line everyone else is riding.",
            target: { lat: me.lat, lon: me.lon, name: "the planned route" },
            route: r, coords: r.coords, distance: r.distance, duration: r.duration
          };
        }, function () { return null; })
    );

    // 3 — through that point and on to the first stop ahead. One routing
    //     request with a via, so the geometry really does run along the
    //     planned road rather than being two lines stapled together.
    var main = ahead[0];
    if (main && metres(me.lat, me.lon, main.lat, main.lon) > 150) {
      jobs.push(
        router([{ lat: from.lat, lon: from.lon },
                { lat: me.lat, lon: me.lon },
                { lat: main.lat, lon: main.lon }], routeOpts)
          .then(function (routes) {
            var r = routes && routes[0];
            if (!r) return null;
            return {
              kind: "optimised",
              label: "Rejoin, then on to " + (main.name || "the next stop"),
              why: "Gets you back on the group's line and keeps you on it.",
              target: main,
              route: r, coords: r.coords, distance: r.distance, duration: r.duration
            };
          }, function () { return null; })
      );
    }

    return Promise.all(jobs).then(function (list) {
      var out = [];
      list.forEach(function (c) {
        if (!c || !c.coords || c.coords.length < 2) return;
        score(c, planned.coords);
        // A duplicate is dropped in favour of whichever scored better, so the
        // rider is never offered the same road twice under two names.
        for (var i = 0; i < out.length; i++) {
          if (sameish(out[i], c)) {
            if (c.score < out[i].score) out[i] = c;
            return;
          }
        }
        out.push(c);
      });

      out.sort(function (a, b) { return a.score - b.score; });
      for (var i = 0; i < out.length; i++) {
        out[i].id = out[i].kind + "-" + i;
        out[i].recommended = i === 0;
      }
      return out;
    });
  }

  return {
    OFF_ROUTE_M: OFF_ROUTE_M,
    BACK_ON_M: BACK_ON_M,
    CORRIDOR_M: CORRIDOR_M,
    metres: metres,
    cumulative: cumulative,
    nearestOn: nearestOn,
    distanceToLine: distanceToLine,
    simplify: simplify,
    compact: compact,
    offCorridorMeters: offCorridorMeters,
    stopsAhead: stopsAhead,
    suggest: suggest
  };
})();

/* ============================================================
   KomyutApp — getting from a pin to a pin on other people's routes

   This is the part that makes the app a navigator rather than a list. You
   drop two pins (or use where you are standing), and it works out which
   community routes chain together to get you there, including the
   transfers — because in the Philippines almost nothing is one ride.

   How it works
   ------------
   1. **Ask for the area, not the country.** One call fetches every route
      whose bounding box overlaps a box around the two pins, padded. That is
      the only network request the planner makes.

   2. **Sample every route into a grid.** Each route's polyline is sampled
      every SAMPLE_M and each sample dropped into a cell about CELL_M
      across. Two routes that share a cell can be changed between there.
      This is what makes transfers findable at all: comparing every pair of
      polylines point by point is O(n^2) in points and unusable on a phone;
      a hash of cells is one pass.

   3. **Search over routes, not over points.** A state is "I am on route R,
      at metre M along it". From there the moves are: get off and walk to
      the destination (if it is near enough), or get off at a shared cell
      and get on the route that shares it. Depth is capped at MAX_LEGS
      rides, because an itinerary with four changes is one nobody takes.

   4. **Cost in seconds, weighted by how much the community trusts it.**
      A leg's time is its distance at that vehicle's realistic speed plus
      its typical boarding wait. Walking is counted at more than its
      duration because ten minutes walking is not ten minutes sitting. And
      then the whole leg is inflated by how unreliable its route is:

          weight = 1 + (1 - reliability) * UNRELIABLE_PENALTY

      which is how "prioritise the nearest route with the best votes"
      becomes a number rather than a slogan. A route nobody has voted on is
      not excluded — it is simply beaten by a route people have backed,
      unless it saves you a real walk.

   What it is honest about
   -----------------------
   Community routes are claims, and a chain of three claims is three times
   as likely to contain a wrong one. Every itinerary carries the reliability
   of its WEAKEST leg, not its average, because that is the one that will
   strand you.

   A route is treated as running both directions. Almost every jeepney and
   tricycle line does, and the alternative — assuming the direction it
   happened to be drawn in — would hide the return trip on every route in
   the database. A genuinely one-way loop is the case this gets wrong, and
   the route detail says which way it was drawn so a rider can tell.
   ============================================================ */
var KM = KM || {};

KM.plan = (function () {
  "use strict";

  /* How far somebody will walk to reach a route, and to change between two.
     900 m is about eleven minutes and is roughly where people stop calling
     it "just there". */
  var MAX_WALK_M = 900;
  var MAX_TRANSFER_WALK_M = 450;

  var SAMPLE_M = 120;   // spacing of the points a route is hashed by
  var CELL_M = 300;     // grid cell; two routes sharing one can be changed between

  var MAX_LEGS = 3;         // rides, so at most two transfers
  var TRANSFER_PENALTY_S = 240;
  var WALK_DISCOMFORT = 1.7;   // a minute walking costs this many minutes sitting
  var UNRELIABLE_PENALTY = 0.8;

  /* Below this, riding is silly: if the whole trip is 600 m you walk. */
  var MIN_RIDE_M = 400;

  function cellKey(lat, lon) {
    var dLat = CELL_M / 111320;
    var dLon = CELL_M / (111320 * Math.max(0.2, KM.lonScale(lat)));
    return Math.round(lat / dLat) + ":" + Math.round(lon / dLon);
  }

  /* ---------------------------------------------------------
     Preparing the candidates
     --------------------------------------------------------- */
  function prepare(rows) {
    return (rows || []).map(function (r, idx) {
      var path = r.path || [];
      if (path.length < 2) return null;
      var cum = KM.router.cumulative(path);
      var prepared = {
        idx: idx,
        route: r,
        path: path,
        cum: cum,
        length: cum[cum.length - 1],
        type: KM.transit.type(r.route_type),
        reliability: KM.transit.reliability(r),
        samples: KM.router.sample(path, SAMPLE_M)
      };
      return prepared;
    }).filter(Boolean);
  }

  function buildGrid(prepared) {
    var grid = {};
    prepared.forEach(function (p) {
      p.samples.forEach(function (s) {
        var k = cellKey(s.lat, s.lon);
        if (!grid[k]) grid[k] = [];
        /* One entry per route per cell, keeping the first sample that
           landed there. A route that runs the length of a cell would
           otherwise put five identical transfer options in the list. */
        var already = false;
        for (var i = 0; i < grid[k].length; i++) {
          if (grid[k][i].p === p) { already = true; break; }
        }
        if (!already) grid[k].push({ p: p, at: s });
      });
    });
    return grid;
  }

  /* Where a route can be boarded for a given point, or null if it is too
     far to walk to. */
  function boarding(p, point, maxWalk) {
    var hit = KM.router.nearestOnPath(point, p.path, p.cum);
    if (!hit || hit.distance > maxWalk) return null;
    return hit;
  }

  /* ---------------------------------------------------------
     Costing
     --------------------------------------------------------- */
  function walkLeg(from, to, label) {
    var w = KM.router.walk(from, to);
    return {
      mode: "walk",
      label: label || "Walk",
      from: from, to: to,
      path: w.path,
      distance: w.distance,
      duration: w.duration,
      cost: w.duration * WALK_DISCOMFORT
    };
  }

  function rideLeg(p, fromAlong, toAlong) {
    var a = Math.min(fromAlong, toAlong), b = Math.max(fromAlong, toAlong);
    var distance = b - a;
    var speed = p.type.speedKmh * 1000 / 3600;

    /* Prefer the route's own recorded duration where it has one: it came
       from the router over the real road network, which knows about the
       hills and the one-way system that a flat average speed does not.
       Scale it to the fraction of the route actually ridden. */
    var duration;
    if (p.route.duration_s > 0 && p.length > 0) {
      var scaled = p.route.duration_s * (distance / p.length);
      /* The router's figure is a car's. A jeepney stops; the type's own
         average speed is the floor on how slow that makes it. */
      duration = Math.max(scaled, distance / speed);
    } else {
      duration = distance / speed;
    }
    duration += p.type.boardS;

    var weight = 1 + (1 - p.reliability) * UNRELIABLE_PENALTY;

    return {
      mode: "ride",
      route: p.route,
      type: p.type,
      reliability: p.reliability,
      fromAlong: a,
      toAlong: b,
      forward: toAlong >= fromAlong,
      path: slicePath(p, a, b),
      distance: Math.round(distance),
      duration: Math.round(duration),
      waitS: p.type.boardS,
      cost: duration * weight
    };
  }

  /* The stretch of a route between two distances along it, as its own
     polyline, so the map can draw the part you actually ride in the leg's
     own colour and leave the rest of the line alone. */
  function slicePath(p, fromAlong, toAlong) {
    var out = [];
    var cum = p.cum, path = p.path;
    function pointAt(d) {
      var i = 0;
      while (i < cum.length - 2 && cum[i + 1] < d) i++;
      var span = cum[i + 1] - cum[i];
      var t = span > 0 ? (d - cum[i]) / span : 0;
      t = KM.clamp(t, 0, 1);
      return [path[i][0] + (path[i + 1][0] - path[i][0]) * t,
              path[i][1] + (path[i + 1][1] - path[i][1]) * t];
    }
    out.push(pointAt(fromAlong));
    for (var i = 0; i < path.length; i++) {
      if (cum[i] > fromAlong && cum[i] < toAlong) out.push(path[i]);
    }
    out.push(pointAt(toAlong));
    return out;
  }

  /* ---------------------------------------------------------
     The search

     Breadth-first over rides, keeping the cheapest way to have reached
     each (route, roughly-where-on-it) state. "Roughly" matters: without
     rounding the along-distance into buckets, the same route reached at
     4 011 m and 4 130 m are two states and the frontier explodes.
     --------------------------------------------------------- */
  function stateKey(p, along) {
    return p.idx + "@" + Math.round(along / 500);
  }

  function search(prepared, grid, origin, destination) {
    var results = [];
    var seen = {};
    var frontier = [];

    /* Seed: every route you could walk to from the origin. */
    prepared.forEach(function (p) {
      var board = boarding(p, origin, MAX_WALK_M);
      if (!board) return;
      var first = walkLeg(origin, board.point, "Walk to " + p.route.name);
      frontier.push({
        p: p,
        along: board.along,
        legs: [first],
        cost: first.cost,
        rides: 0
      });
    });

    /* And the option of simply walking, which for a short hop beats every
       route in the database and must not be hidden by them. */
    var straight = KM.haversine(origin, destination);
    if (straight <= MAX_WALK_M * 2.2) {
      var only = walkLeg(origin, destination, "Walk the whole way");
      results.push(finish([only], null));
    }

    var guard = 0;
    while (frontier.length && guard++ < 4000) {
      var state = frontier.shift();
      var key = stateKey(state.p, state.along);
      if (seen[key] !== undefined && seen[key] <= state.cost) continue;
      seen[key] = state.cost;

      /* Can this route take us near enough to the destination? */
      var off = boarding(state.p, destination, MAX_WALK_M);
      if (off && Math.abs(off.along - state.along) >= MIN_RIDE_M) {
        var ride = rideLeg(state.p, state.along, off.along);
        var last = walkLeg(off.point, destination, "Walk to where you are going");
        results.push(finish(state.legs.concat([ride, last]), null));
      }

      if (state.rides + 1 >= MAX_LEGS) continue;

      /* Otherwise, change. Every cell this route passes through that some
         other route also passes through is a place to get off. */
      var offered = {};
      state.p.samples.forEach(function (s) {
        if (Math.abs(s.along - state.along) < MIN_RIDE_M) return;
        var here = grid[cellKey(s.lat, s.lon)];
        if (!here || here.length < 2) return;

        here.forEach(function (other) {
          if (other.p === state.p) return;
          if (offered[other.p.idx]) return;

          var getOff = { lat: s.lat, lon: s.lon };
          var hop = boarding(other.p, getOff, MAX_TRANSFER_WALK_M);
          if (!hop) return;
          offered[other.p.idx] = true;

          var ride2 = rideLeg(state.p, state.along, s.along);
          var change = walkLeg(getOff, hop.point, "Change to " + other.p.route.name);
          change.transfer = true;
          var cost = state.cost + ride2.cost + change.cost + TRANSFER_PENALTY_S;

          frontier.push({
            p: other.p,
            along: hop.along,
            legs: state.legs.concat([ride2, change]),
            cost: cost,
            rides: state.rides + 1
          });
        });
      });

      /* Cheapest first, so the good itineraries are found before the guard
         runs out on a dense city. */
      frontier.sort(function (a, b) { return a.cost - b.cost; });
    }

    return dedupe(results).sort(function (a, b) { return a.cost - b.cost; }).slice(0, 6);
  }

  /* ---------------------------------------------------------
     Turning a chain of legs into something a person reads
     --------------------------------------------------------- */
  function finish(legs) {
    var duration = 0, cost = 0, walkM = 0, rideM = 0, transfers = 0;
    var fareMin = 0, fareMax = 0, fareKnown = true, currency = null;
    var weakest = 1;
    var rides = [];

    legs.forEach(function (leg) {
      duration += leg.duration;
      cost += leg.cost;
      if (leg.mode === "walk") {
        walkM += leg.distance;
        if (leg.transfer) transfers++;
      } else {
        rideM += leg.distance;
        rides.push(leg);
        weakest = Math.min(weakest, leg.reliability);
        var r = leg.route;
        if (r.fare_min == null && r.fare_max == null) fareKnown = false;
        else {
          fareMin += Number(r.fare_min != null ? r.fare_min : r.fare_max);
          fareMax += Number(r.fare_max != null ? r.fare_max : r.fare_min);
          currency = currency || r.currency;
        }
      }
    });

    if (!rides.length) weakest = 1;   // walking is perfectly reliable

    return {
      legs: legs,
      rides: rides,
      duration: Math.round(duration),
      cost: cost,
      walkM: Math.round(walkM),
      rideM: Math.round(rideM),
      transfers: transfers,
      fare: fareKnown && rides.length
        ? { min: fareMin, max: fareMax, currency: currency || KM.config.DEFAULT_CURRENCY }
        : null,
      /* The weakest link, not the average: the unreliable leg is the one
         that strands you, and averaging it away is how a planner lies. */
      reliability: weakest,
      band: KM.transit.band(weakest),
      signature: legs.filter(function (l) { return l.mode === "ride"; })
        .map(function (l) { return l.route.id; }).join(">")
    };
  }

  /* Two itineraries that use the same routes in the same order are the
     same itinerary, however differently the search arrived at them. */
  function dedupe(list) {
    var seen = {}, out = [];
    list.forEach(function (it) {
      var k = it.signature || "walk";
      if (seen[k] !== undefined) {
        if (list[seen[k]].cost <= it.cost) return;
        out[out.indexOf(list[seen[k]])] = it;
        return;
      }
      seen[k] = list.indexOf(it);
      out.push(it);
    });
    return out;
  }

  /* ---------------------------------------------------------
     The public call
     --------------------------------------------------------- */

  /* find(origin, destination, {types}) -> Promise<{itineraries, considered}>

     origin/destination: {lat, lon}. */
  function find(origin, destination, opts) {
    opts = opts || {};
    var o = KM.sanitize.coord(origin.lat, origin.lon);
    var d = KM.sanitize.coord(destination.lat, destination.lon);
    if (!o || !d) return Promise.reject(KM.error("Those are not two places.", "invalid"));

    /* The box: the two pins, padded by the furthest anybody would walk plus
       a fifth of the separation, so a route that swings wide between them
       is still a candidate. Capped, because a pin in Luzon and a pin in
       Mindanao is not a jeepney question. */
    var span = KM.haversine(o, d);
    if (span > 400000) {
      return Promise.reject(KM.error("That is too far apart for a commute.", "invalid"));
    }
    var padM = KM.clamp(span * 0.2, 1500, 12000) + MAX_WALK_M;
    var padLat = padM / 111320;
    var padLon = padM / (111320 * Math.max(0.2, KM.lonScale((o.lat + d.lat) / 2)));

    var south = Math.min(o.lat, d.lat) - padLat;
    var north = Math.max(o.lat, d.lat) + padLat;
    var west = Math.min(o.lon, d.lon) - padLon;
    var east = Math.max(o.lon, d.lon) + padLon;

    return KM.routes.inBbox(south, west, north, east, opts.types).then(function (rows) {
      var prepared = prepare(rows);
      var grid = buildGrid(prepared);
      return {
        considered: prepared.length,
        itineraries: search(prepared, grid, o, d)
      };
    });
  }

  /* Checkpoints along an itinerary for the forecast: the start of every
     leg, plus points along the long ones, each stamped with when you get
     there if you leave at `departAt`. */
  function checkpoints(itinerary, departAt) {
    var t = (departAt ? departAt.getTime() : Date.now());
    var out = [];
    itinerary.legs.forEach(function (leg) {
      var pts = leg.path && leg.path.length ? leg.path : [];
      if (!pts.length) return;
      var every = leg.mode === "ride" ? 4000 : 100000;
      var samples = KM.router.sample(pts, every);
      var legStart = t;
      samples.forEach(function (s) {
        var frac = leg.distance > 0 ? s.along / Math.max(1, leg.distance) : 0;
        out.push({
          lat: s.lat, lon: s.lon,
          eta: new Date(legStart + frac * leg.duration * 1000),
          leg: leg
        });
      });
      t += leg.duration * 1000;
    });
    /* Never ask for more than a screenful of forecasts; the middle of a
       long ride is the part worth thinning. */
    if (out.length > 14) {
      var keep = [], step = (out.length - 1) / 13;
      for (var i = 0; i < 14; i++) keep.push(out[Math.round(i * step)]);
      out = keep;
    }
    return out;
  }

  return {
    find: find,
    checkpoints: checkpoints,
    prepare: prepare,
    buildGrid: buildGrid,
    cellKey: cellKey,
    MAX_WALK_M: MAX_WALK_M,
    MAX_LEGS: MAX_LEGS,
    /* Exposed so tools/validate.js can run the search on a fixture without
       a network or a browser. */
    _search: search
  };
})();

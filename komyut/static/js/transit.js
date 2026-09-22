/* ============================================================
   TheCommuters — what kind of ride it is, and how much to trust it

   Two pure tables and one pure function, kept together because they are the
   app's whole opinion about community data and they are the part most worth
   testing without a browser. tools/validate.js runs everything here.

   Route types
   -----------
   The list is Philippine-first and deliberately not a taxonomy anybody has
   to look up: a jeepney is a jeepney. Each type carries the numbers the
   journey planner needs — a typical cruising speed, and how long boarding
   one tends to cost — because "the fastest route" is wrong if it puts you
   on three tricycles.

   `walkable` marks the types that are not a vehicle at all, so the planner
   can chain a walk onto the front and back of a ride without inventing a
   fare for it.

   Reliability
   -----------
   A community route is a claim, and the meter is how strongly the community
   has backed it. It is deliberately **not** the raw vote count: ten up and
   nothing else is not the same evidence as two hundred up and three down,
   and a raw ratio says they are identical. The lower bound of a Wilson
   score interval is the standard answer to that — it asks "given this many
   votes, how low could the true approval plausibly be?", so a route earns
   confidence by being voted on, not merely by being voted on well.

   On top of that sit three adjustments that a pure ratio cannot see:

     * **Validated** routes get a floor, because somebody with the tag
       checked it. It is a floor and not a bonus: a validated route the
       community has since voted into the ground still falls.
     * **Staleness** pulls the meter down as a route ages without anybody
       confirming it. Routes change — a jeepney line is rerouted, a terminal
       moves — and a four-year-old route with fifty upvotes from 2021 is
       evidence about 2021.
     * **Discussion** nudges it up slightly. A route people argue about in
       the comments has been looked at.

   The result is 0..1, and the meter shows five bands so nobody reads a
   percentage as precision it does not have.
   ============================================================ */
var KM = KM || {};

KM.transit = (function () {
  "use strict";

  /* speedKmh: what this actually averages door to door including traffic,
     not what the vehicle can do.
     boardS: typical wait plus boarding, in seconds. */
  var TYPES = [
    { id: "jeepney",   label: "Jeepney",        icon: "jeepney",   speedKmh: 16, boardS: 240, fares: true },
    { id: "bus",       label: "Bus",            icon: "bus",       speedKmh: 20, boardS: 420, fares: true },
    { id: "uv",        label: "UV Express",     icon: "van",       speedKmh: 22, boardS: 480, fares: true },
    { id: "tricycle",  label: "Tricycle",       icon: "tricycle",  speedKmh: 14, boardS: 120, fares: true },
    { id: "habal",     label: "Habal-habal",    icon: "motorcycle",speedKmh: 24, boardS: 120, fares: true },
    { id: "train",     label: "Train",          icon: "train",     speedKmh: 30, boardS: 360, fares: true },
    { id: "ferry",     label: "Ferry / Boat",   icon: "ferry",     speedKmh: 18, boardS: 900, fares: true },
    { id: "van",       label: "Shuttle / Van",  icon: "van",       speedKmh: 25, boardS: 600, fares: true },
    { id: "pedicab",   label: "Pedicab",        icon: "pedicab",   speedKmh: 9,  boardS: 120, fares: true },
    { id: "walk",      label: "Walk",           icon: "walk",      speedKmh: 4.5, boardS: 0,  fares: false, walkable: true },
    { id: "other",     label: "Other",          icon: "route",     speedKmh: 18, boardS: 300, fares: true }
  ];

  var BY_ID = {};
  TYPES.forEach(function (t) { BY_ID[t.id] = t; });

  function type(id) { return BY_ID[id] || BY_ID.other; }
  function ids() { return TYPES.map(function (t) { return t.id; }); }

  /* ---------------------------------------------------------
     Wilson lower bound at 95% confidence.

     n = 0 returns 0, not 0.5: a route nobody has voted on has earned
     nothing, and starting everything at half a meter would make the meter
     meaningless on a new board where most routes have no votes yet.
     --------------------------------------------------------- */
  var Z = 1.96;

  function wilson(up, down) {
    var u = Math.max(0, up | 0), d = Math.max(0, down | 0);
    var n = u + d;
    if (n === 0) return 0;
    var p = u / n;
    var z2 = Z * Z;
    var denom = 1 + z2 / n;
    var centre = p + z2 / (2 * n);
    var margin = Z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
    return Math.max(0, Math.min(1, (centre - margin) / denom));
  }

  /* How much a route's evidence has decayed. 1.0 fresh, falling to a floor
     of 0.55 after about two years — a floor rather than zero, because an
     old well-voted route is still the best guess anybody has. */
  var HALF_LIFE_DAYS = 400;
  var STALE_FLOOR = 0.55;

  function freshness(lastConfirmedAt, now) {
    if (!lastConfirmedAt) return STALE_FLOOR;
    var t = (lastConfirmedAt instanceof Date) ? lastConfirmedAt : new Date(lastConfirmedAt);
    if (isNaN(t.getTime())) return STALE_FLOOR;
    var days = Math.max(0, ((now || Date.now()) - t.getTime()) / 86400000);
    var decayed = Math.pow(0.5, days / HALF_LIFE_DAYS);
    return STALE_FLOOR + (1 - STALE_FLOOR) * decayed;
  }

  /* The floor a validated route cannot fall below while it is still
     validated and not actively disliked. Deliberately below "good": the tag
     means somebody checked it, not that it is the best line in the city. */
  var VALIDATED_FLOOR = 0.55;

  /* route: { upvotes, downvotes, validated, comment_count, updated_at,
              last_confirmed_at, created_at } */
  function reliability(route, now) {
    route = route || {};
    var up = route.upvotes || 0;
    var down = route.downvotes || 0;

    var base = wilson(up, down);

    /* Discussion is weak evidence and is capped hard at +0.06, because
       otherwise the loudest route wins rather than the best one. */
    var talk = Math.min(0.06, Math.log1p(Math.max(0, route.comment_count || 0)) * 0.02);

    var stale = freshness(route.last_confirmed_at || route.updated_at || route.created_at, now);

    var score = (base + talk) * stale;

    if (route.validated) {
      /* Only floors it while the community has not turned on it. Two
         downvotes for every upvote is the community saying the tag is out
         of date, and the floor gets out of the way. */
      var contested = down > up;
      if (!contested) score = Math.max(score, VALIDATED_FLOOR * stale);
    }

    return Math.max(0, Math.min(1, score));
  }

  /* Five bands, because a meter that reads "73%" invites an argument about
     the 3. */
  var BANDS = [
    { at: 0.00, id: "unproven", label: "Unproven" },
    { at: 0.20, id: "weak",     label: "Thin evidence" },
    { at: 0.40, id: "fair",     label: "Fair" },
    { at: 0.60, id: "good",     label: "Well backed" },
    { at: 0.80, id: "strong",   label: "Strongly backed" }
  ];

  function band(score) {
    var out = BANDS[0];
    for (var i = 0; i < BANDS.length; i++) if (score >= BANDS[i].at) out = BANDS[i];
    return out;
  }

  /* What sorts a list. Negative net votes push a route down, as asked, and
     they do it by more than a thin margin: the point is that a route the
     community has rejected sinks out of the way rather than sitting fourth.

     Text relevance (0..1, from the search RPC) is folded in here rather
     than in SQL so the same ordering applies to a browse with no query. */
  function rank(route, relevance) {
    var r = reliability(route);
    var net = (route.upvotes || 0) - (route.downvotes || 0);
    var penalty = net < 0 ? Math.min(0.6, Math.log1p(-net) * 0.18) : 0;
    var lift = net > 0 ? Math.min(0.25, Math.log1p(net) * 0.05) : 0;
    var rel = typeof relevance === "number" ? relevance : 0;
    return (r * 0.55) + (rel * 0.45) + lift - penalty;
  }

  return {
    TYPES: TYPES,
    ids: ids,
    type: type,
    label: function (id) { return type(id).label; },
    wilson: wilson,
    freshness: freshness,
    reliability: reliability,
    band: band,
    BANDS: BANDS,
    rank: rank,
    HALF_LIFE_DAYS: HALF_LIFE_DAYS
  };
})();

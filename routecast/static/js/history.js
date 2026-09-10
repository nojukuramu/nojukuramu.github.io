/* ============================================================
   RouteCast — ride history
   The record of where you have ACTUALLY been, as opposed to where a router
   once said you would go. Nothing here touches the network and nothing
   leaves the device: it is localStorage and arithmetic.

   What is stored
   --------------
   Two things, both per vehicle:

   1. **Road usage.** Every fix during navigation is quantised to a ~124 m
      grid cell (1/900th of a degree). When the rider crosses from one cell
      into another, that crossing is written as an *edge* — the pair of cell
      ids — together with how far and how long the crossing took. An edge is
      a piece of road you have used, weighed by how often you have used it.
      Planning then prefers a line built mostly out of edges you already own.

   2. **Timing truth.** How long a ride actually took against how long it was
      predicted to take, bucketed by hour of the week. This is what drags the
      ETA back to reality; see eta.js, which consumes it.

   Why cells and not road ids
   --------------------------
   OSRM gives us a polyline, not OSM way ids, so there is nothing stable to
   key a road by. A grid cell chain is coarse but it is honest: two rides
   down the same carriageway produce the same chain of cells regardless of
   which lane the GPS thought you were in, and a parallel service road one
   cell over produces a different one. 124 m is about the width of a large
   junction — fine enough to tell two roads apart, coarse enough that a
   wobbling fix does not invent a new road every second.

   Bounds
   ------
   Edges are capped (MAX_EDGES); the least recently used are evicted first,
   so a road you stopped riding a year ago makes room for the one you ride
   now. Writes are debounced — a ride does not hit localStorage on every fix.
   ============================================================ */
RC.history = (function () {
  "use strict";

  var KEY = "history";
  var VERSION = 1;

  // 1/900 deg ~ 124 m of latitude. Longitude cells are narrower away from
  // the equator, which is harmless: the grid only has to be self-consistent.
  var CELL = 900;

  var MAX_EDGES = 6000;
  var EVICT_TO = 5200;      // after an eviction pass, how many we keep
  var MAX_TRIPS = 120;      // finished-ride timing records

  // A jump bigger than this between consecutive fixes is a GPS glitch, a
  // tunnel exit or a phone that was asleep — not a road you rode.
  var MAX_STEP_M = 600;
  var MAX_STEP_S = 150;
  // Below this speed you are parked, and a parked phone's drifting fixes
  // would otherwise carve a bogus edge through a car park.
  var MIN_SPEED_KMH = 3;

  var SAVE_DEBOUNCE_MS = 20000;

  var VEHICLES = { car: 1, motorcycle: 1 };

  /* ---------- store ---------- */

  var data = null;
  var dirty = false;
  var saveTimer = null;

  function blank() {
    return { v: VERSION, edges: {}, hours: { car: {}, motorcycle: {} }, trips: [] };
  }

  function load() {
    if (data) return data;
    var raw = RC.store.get(KEY, null);
    if (!raw || raw.v !== VERSION || !raw.edges) {
      data = blank();
    } else {
      data = raw;
      if (!data.hours) data.hours = { car: {}, motorcycle: {} };
      if (!data.hours.car) data.hours.car = {};
      if (!data.hours.motorcycle) data.hours.motorcycle = {};
      if (!data.trips) data.trips = [];
    }
    return data;
  }

  function flush() {
    if (!dirty) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    evictIfNeeded();
    RC.store.set(KEY, load());
    dirty = false;
  }

  function markDirty() {
    dirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(function () { saveTimer = null; flush(); }, SAVE_DEBOUNCE_MS);
  }

  function evictIfNeeded() {
    var d = load();
    var keys = Object.keys(d.edges);
    if (keys.length <= MAX_EDGES) return;
    // Least recently used first; ties broken by the edge used least often,
    // so a road ridden once six months ago goes before a daily commute that
    // happens to share a timestamp with it.
    keys.sort(function (a, b) {
      var ea = d.edges[a], eb = d.edges[b];
      if (ea[3] !== eb[3]) return ea[3] - eb[3];
      return ea[0] - eb[0];
    });
    var drop = keys.length - EVICT_TO;
    for (var i = 0; i < drop; i++) delete d.edges[keys[i]];
  }

  /* ---------- cells and edges ---------- */

  function cellOf(lat, lon) {
    return Math.round(lat * CELL) + "." + Math.round(lon * CELL);
  }

  // Undirected: a road is the same road whichever way you ride it. Sorting
  // the two cell ids means one ride out and one ride back reinforce the same
  // edge instead of filling the store with mirrored duplicates.
  function edgeKey(vehicle, cellA, cellB) {
    var lo = cellA < cellB ? cellA : cellB;
    var hi = cellA < cellB ? cellB : cellA;
    return (vehicle === "motorcycle" ? "m" : "c") + "|" + lo + "|" + hi;
  }

  function dayIndex(ms) { return Math.floor(ms / 86400000); }

  // hour of week, 0 (Sunday 00:00) .. 167 (Saturday 23:00)
  function hourOfWeek(date) {
    return date.getDay() * 24 + date.getHours();
  }

  /* ---------- recording ---------- */

  var session = null;

  function startSession(vehicle) {
    session = {
      vehicle: VEHICLES[vehicle] ? vehicle : "car",
      lastFix: null,
      cell: null,
      cellEnteredAt: 0,
      cellEnteredFix: null,
      pendingM: 0,
      pendingS: 0,
      distanceM: 0,
      movingS: 0,
      startedAt: Date.now(),
      edgesWritten: 0
    };
    return session;
  }

  function writeEdge(vehicle, cellA, cellB, meters, seconds, atMs) {
    if (cellA === cellB) return;
    if (!(meters > 0) || !(seconds > 0)) return;
    var d = load();
    var key = edgeKey(vehicle, cellA, cellB);
    var e = d.edges[key];
    if (e) {
      e[0] += 1;
      e[1] += meters;
      e[2] += seconds;
      e[3] = dayIndex(atMs);
    } else {
      d.edges[key] = [1, meters, seconds, dayIndex(atMs)];
    }
    markDirty();
  }

  /* RC.history.record(fix) — one geolocation fix during a live ride.
     fix: {lat, lon, t (ms), speedKmh|null}
     Returns true when the fix closed an edge (i.e. crossed into a new cell). */
  function record(fix) {
    if (!session || !fix) return false;
    if (typeof fix.lat !== "number" || typeof fix.lon !== "number") return false;
    var t = fix.t || Date.now();
    var cell = cellOf(fix.lat, fix.lon);

    if (!session.lastFix) {
      session.lastFix = { lat: fix.lat, lon: fix.lon, t: t };
      session.cell = cell;
      session.cellEnteredAt = t;
      return false;
    }

    var dtS = (t - session.lastFix.t) / 1000;
    var dM = RC.haversine({ lat: session.lastFix.lat, lon: session.lastFix.lon },
                          { lat: fix.lat, lon: fix.lon });
    session.lastFix = { lat: fix.lat, lon: fix.lon, t: t };

    // A glitch, a sleeping phone or a stationary rider contributes nothing —
    // and resets the pending accumulation so the next real edge is not
    // credited with a gap it never travelled.
    var speedKmh = fix.speedKmh != null ? fix.speedKmh : (dtS > 0 ? (dM / dtS) * 3.6 : 0);
    if (dtS <= 0 || dtS > MAX_STEP_S || dM > MAX_STEP_M) {
      session.cell = cell;
      session.cellEnteredAt = t;
      session.pendingM = 0;
      session.pendingS = 0;
      return false;
    }
    if (speedKmh < MIN_SPEED_KMH) {
      // Still count the clock — sitting at a light is part of how long the
      // road really takes — but do not let it start a new edge.
      session.pendingS += dtS;
      return false;
    }

    session.pendingM += dM;
    session.pendingS += dtS;
    session.distanceM += dM;
    session.movingS += dtS;

    if (cell !== session.cell) {
      writeEdge(session.vehicle, session.cell, cell, session.pendingM, session.pendingS, t);
      session.edgesWritten++;
      session.cell = cell;
      session.cellEnteredAt = t;
      session.pendingM = 0;
      session.pendingS = 0;
      return true;
    }
    return false;
  }

  /* RC.history.endSession(summary) — call when a ride stops.
     summary: {plannedS, actualS, distanceM, departedAt (Date)}
     The timing record is what eta.js learns from; a ride shorter than
     MIN_TRIP_* is thrown away because its ratio is mostly noise. */
  var MIN_TRIP_S = 240;      // 4 minutes
  var MIN_TRIP_M = 1500;     // 1.5 km

  function endSession(summary) {
    var s = session;
    session = null;
    if (!s) { flush(); return null; }

    var rec = null;
    if (summary && summary.plannedS > MIN_TRIP_S && summary.actualS > MIN_TRIP_S &&
        summary.distanceM >= MIN_TRIP_M) {
      var ratio = summary.actualS / summary.plannedS;
      // A ratio outside this band means something other than traffic
      // happened — a long lunch stop, or a ride abandoned halfway.
      if (ratio > 0.5 && ratio < 3) {
        var d = load();
        var when = summary.departedAt instanceof Date ? summary.departedAt : new Date();
        rec = {
          at: when.getTime(),
          vehicle: s.vehicle,
          how: hourOfWeek(when),
          ratio: Math.round(ratio * 1000) / 1000,
          distanceM: Math.round(summary.distanceM)
        };
        d.trips.push(rec);
        while (d.trips.length > MAX_TRIPS) d.trips.shift();

        var bucket = d.hours[s.vehicle] || (d.hours[s.vehicle] = {});
        var h = String(rec.how);
        var cur = bucket[h] || [0, 0];
        bucket[h] = [cur[0] + 1, cur[1] + ratio];
        markDirty();
      }
    }
    flush();
    return rec;
  }

  function sessionStats() {
    if (!session) return null;
    return {
      vehicle: session.vehicle,
      distanceM: session.distanceM,
      movingS: session.movingS,
      edgesWritten: session.edgesWritten
    };
  }

  /* ---------- reading it back ---------- */

  function edgeFor(vehicle, cellA, cellB) {
    var d = load();
    var e = d.edges[edgeKey(vehicle, cellA, cellB)];
    if (e) return e;
    // A road ridden in a car is still a road you know on a bike. Fall back
    // to the other vehicle at a discount rather than pretending it is new.
    var other = vehicle === "motorcycle" ? "car" : "motorcycle";
    var alt = d.edges[edgeKey(other, cellA, cellB)];
    return alt ? [alt[0], alt[1], alt[2], alt[3], true] : null;
  }

  /* How much of a polyline runs over roads you have already used.
     Returns {score 0..1, knownM, totalM, edges, knownEdges}.
     `score` is metre-weighted, so a familiar 40 km motorway counts for more
     than a familiar 200 m side street, and each edge is weighted by how
     often it has been ridden (three rides is "well known"; more adds
     nothing, because a road is not four times more familiar the fourth
     time you ride it). */
  var CONFIDENT_USES = 3;
  var OTHER_VEHICLE_DISCOUNT = 0.6;

  function familiarity(coords, vehicle) {
    var out = { score: 0, knownM: 0, totalM: 0, edges: 0, knownEdges: 0 };
    if (!coords || coords.length < 2) return out;
    vehicle = VEHICLES[vehicle] ? vehicle : "car";

    var prevCell = cellOf(coords[0][0], coords[0][1]);
    var pendingM = 0;
    var weightedM = 0;

    for (var i = 1; i < coords.length; i++) {
      var m = RC.haversine({ lat: coords[i - 1][0], lon: coords[i - 1][1] },
                           { lat: coords[i][0], lon: coords[i][1] });
      out.totalM += m;
      pendingM += m;
      var cell = cellOf(coords[i][0], coords[i][1]);
      if (cell === prevCell) continue;

      out.edges++;
      var e = edgeFor(vehicle, prevCell, cell);
      if (e) {
        out.knownEdges++;
        var w = Math.min(1, e[0] / CONFIDENT_USES);
        if (e[4]) w *= OTHER_VEHICLE_DISCOUNT;
        out.knownM += pendingM;
        weightedM += pendingM * w;
      }
      prevCell = cell;
      pendingM = 0;
    }

    out.score = out.totalM > 0 ? RC.clamp(weightedM / out.totalM, 0, 1) : 0;
    return out;
  }

  /* Rank a set of candidate routes so the one built mostly from roads you
     already ride comes first — but never at any cost. A route is only
     promoted over the fastest one when it is meaningfully more familiar
     (FAMILIAR_MARGIN) and not meaningfully slower (SLOWER_TOLERANCE).
     Returns a new array; the input is untouched. Each route is annotated
     with `.familiarity` either way, so the UI can show the number even when
     it changed nothing. */
  var FAMILIAR_MARGIN = 0.15;
  var SLOWER_TOLERANCE = 1.12;

  function rankRoutes(routes, vehicle) {
    if (!routes || !routes.length) return routes || [];
    var scored = routes.map(function (r) {
      r.familiarity = familiarity(r.coords, vehicle);
      return r;
    });
    if (scored.length < 2) return scored;

    var fastest = scored[0];
    for (var i = 1; i < scored.length; i++) {
      if (scored[i].duration < fastest.duration) fastest = scored[i];
    }
    var best = fastest;
    for (var j = 0; j < scored.length; j++) {
      var r = scored[j];
      if (r === fastest) continue;
      if (r.duration > fastest.duration * SLOWER_TOLERANCE) continue;
      if (r.familiarity.score > best.familiarity.score + FAMILIAR_MARGIN) best = r;
    }
    if (best === scored[0]) return scored;
    var out = [best];
    for (var k = 0; k < scored.length; k++) if (scored[k] !== best) out.push(scored[k]);
    out.preferredByHistory = best !== fastest;
    return out;
  }

  /* The learned correction for how long a ride really takes, as a multiple
     of what the router predicted. Blends the bucket for this hour of the
     week (if you have ridden at this hour before) with the vehicle's
     all-time average, so one 6am ride does not decide every 6am ETA.
     Returns null until there is enough to say anything. */
  var MIN_TRIPS_FOR_BIAS = 2;
  var HOUR_WEIGHT_FULL = 4;   // rides in this hour bucket before it dominates

  function etaBias(vehicle, date) {
    vehicle = VEHICLES[vehicle] ? vehicle : "car";
    var d = load();
    var all = { n: 0, sum: 0 };
    for (var i = 0; i < d.trips.length; i++) {
      if (d.trips[i].vehicle !== vehicle) continue;
      all.n++;
      all.sum += d.trips[i].ratio;
    }
    if (all.n < MIN_TRIPS_FOR_BIAS) return null;
    var overall = all.sum / all.n;

    if (!(date instanceof Date)) return { ratio: overall, samples: all.n, hourSamples: 0 };

    var bucket = (d.hours[vehicle] || {})[String(hourOfWeek(date))];
    if (!bucket || !bucket[0]) return { ratio: overall, samples: all.n, hourSamples: 0 };

    var hourly = bucket[1] / bucket[0];
    var w = Math.min(1, bucket[0] / HOUR_WEIGHT_FULL);
    return {
      ratio: overall * (1 - w) + hourly * w,
      samples: all.n,
      hourSamples: bucket[0]
    };
  }

  /* Your own observed speed on the roads of a given polyline, in km/h, or
     null when you have not ridden enough of it. traffic.js uses this to
     ground its congestion model in something real. */
  function observedSpeed(coords, vehicle) {
    if (!coords || coords.length < 2) return null;
    vehicle = VEHICLES[vehicle] ? vehicle : "car";
    var prevCell = cellOf(coords[0][0], coords[0][1]);
    var meters = 0, seconds = 0, hits = 0;
    for (var i = 1; i < coords.length; i++) {
      var cell = cellOf(coords[i][0], coords[i][1]);
      if (cell === prevCell) continue;
      var e = edgeFor(vehicle, prevCell, cell);
      if (e && e[2] > 0) { meters += e[1] / e[0]; seconds += e[2] / e[0]; hits++; }
      prevCell = cell;
    }
    if (hits < 5 || seconds <= 0) return null;
    return { kmh: (meters / seconds) * 3.6, edges: hits };
  }

  function stats() {
    var d = load();
    var keys = Object.keys(d.edges);
    var meters = 0, byVehicle = { car: 0, motorcycle: 0 };
    for (var i = 0; i < keys.length; i++) {
      meters += d.edges[keys[i]][1];
      byVehicle[keys[i].charAt(0) === "m" ? "motorcycle" : "car"] += 1;
    }
    return {
      edges: keys.length,
      metersRecorded: meters,
      edgesByVehicle: byVehicle,
      trips: d.trips.length,
      lastTripAt: d.trips.length ? d.trips[d.trips.length - 1].at : null
    };
  }

  function clear() {
    data = blank();
    dirty = true;
    flush();
  }

  // Flushing on the way out is best-effort: pagehide fires reliably where
  // unload does not, and neither is guaranteed on a killed tab — which is
  // why the debounce is 20s rather than "at the end".
  try {
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flush();
    });
  } catch (e) {}

  return {
    startSession: startSession,
    record: record,
    endSession: endSession,
    sessionStats: sessionStats,
    familiarity: familiarity,
    rankRoutes: rankRoutes,
    etaBias: etaBias,
    observedSpeed: observedSpeed,
    stats: stats,
    clear: clear,
    flush: flush,
    // exposed for the test harness
    _cellOf: cellOf,
    _edgeKey: edgeKey,
    CELL: CELL
  };
})();

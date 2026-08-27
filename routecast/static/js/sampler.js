/* ============================================================
   RouteCast — checkpoint sampler
   Pure computation over an already-built RC.router Route — no network calls.
   Walks route.cumDist and drops a checkpoint roughly every `everyKm`,
   always keeping the start and the destination, and never exceeding
   `maxPoints` (spacing widens instead of dropping the endpoints) or
   emitting two checkpoints closer than 1 km apart.
   ============================================================ */
RC.sampler = (function () {
  "use strict";

  var MIN_GAP_M = 1000; // never emit two checkpoints closer than this

  // Smallest coord index whose cumDist is >= targetM (snap forward to the
  // next coordinate at or past the target distance; never interpolates).
  function indexAtOrPast(cumDist, targetM) {
    for (var i = 0; i < cumDist.length; i++) {
      if (cumDist[i] >= targetM) return i;
    }
    return cumDist.length - 1;
  }

  // RC.sampler.sample(route, {everyKm, maxPoints, departAt, stopMinutes}) -> Checkpoint[]
  function sample(route, opts) {
    opts = opts || {};
    var everyKm = opts.everyKm == null ? 25 : opts.everyKm;
    var maxPoints = opts.maxPoints == null ? 24 : opts.maxPoints;
    var departAt = opts.departAt || new Date();
    var stopMinutes = opts.stopMinutes || 0;

    var cumDist = route.cumDist;
    var cumDur = route.cumDur;
    var coords = route.coords;
    var n = coords.length;
    var lastIdx = n - 1;
    var totalM = cumDist[lastIdx];
    var totalKm = totalM / 1000;

    // Widen spacing so maxPoints is never exceeded by the everyKm request.
    var spacingKm = everyKm;
    if (maxPoints > 1 && totalKm / (maxPoints - 1) > spacingKm) {
      spacingKm = totalKm / (maxPoints - 1);
    }
    var spacingM = spacingKm * 1000;
    if (!isFinite(spacingM) || spacingM <= 0) spacingM = totalM || 1;

    // Walk the route picking one coord index per spacing interval, skipping
    // any pick that would land within MIN_GAP_M of the previous one.
    var picks = [];
    var target = 0;
    while (target <= totalM && picks.length < maxPoints) {
      var idx = indexAtOrPast(cumDist, target);
      if (picks.length === 0 || cumDist[idx] - cumDist[picks[picks.length - 1]] >= MIN_GAP_M) {
        picks.push(idx);
      }
      target += spacingM;
    }

    // Always include the destination.
    if (picks.length === 0) {
      picks.push(lastIdx);
    } else if (picks[picks.length - 1] !== lastIdx) {
      var gapToEnd = cumDist[lastIdx] - cumDist[picks[picks.length - 1]];
      if (gapToEnd < MIN_GAP_M && picks.length > 1) {
        picks[picks.length - 1] = lastIdx; // too close to the end — replace it
      } else {
        picks.push(lastIdx);
      }
    }

    // Always include the start.
    if (picks[0] !== 0) picks.unshift(0);

    // If widening still overshot maxPoints (e.g. a very short route with a
    // small maxPoints), trim interior points first, keeping start and end.
    while (picks.length > maxPoints && picks.length > 2) {
      picks.splice(1, 1);
    }

    // Build checkpoints, accumulating stopMinutes delay after each
    // intermediate (non-start, non-end) stop for every checkpoint after it.
    var checkpoints = [];
    var stopsSoFar = 0;
    for (var i = 0; i < picks.length; i++) {
      var pIdx = picks[i];
      var isStart = pIdx === 0;
      var isEnd = pIdx === lastIdx;
      var etaSeconds = cumDur[pIdx] + stopsSoFar * stopMinutes * 60;
      var eta = new Date(departAt.getTime() + etaSeconds * 1000);

      checkpoints.push({
        i: pIdx,
        lat: coords[pIdx][0],
        lon: coords[pIdx][1],
        distance: cumDist[pIdx],
        eta: eta,
        etaSeconds: etaSeconds,
        isStart: isStart,
        isEnd: isEnd,
        label: ""
      });

      if (!isStart && !isEnd) stopsSoFar++;
    }

    return checkpoints;
  }

  return { sample: sample };
})();

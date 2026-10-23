/* Rubiks — statistics
 *
 * Averages follow WCA and csTimer: an average of n drops the fastest and
 * slowest ceil(5% of n) solves (one each for Ao5 and Ao12, three for Ao50,
 * five for Ao100) and means the rest. A DNF counts as the slowest solve, so
 * an average survives as many DNFs as it trims and no more. A mean of 3 trims
 * nothing, so one DNF sinks it. */
"use strict";

var RK = RK || {};

RK.stats = (function () {
  var WINDOWS = [3, 5, 12, 50, 100];

  function effectiveTime(s) {
    if (s.penalty === "DNF") return Infinity;
    return s.time + (s.penalty === "+2" ? 2000 : 0);
  }

  /* WCA truncates to the hundredth rather than rounding. */
  function formatTime(ms, decimals) {
    if (ms === null || ms === undefined) return "-";
    if (ms === Infinity || ms !== ms) return "DNF";
    var d = decimals === 3 ? 3 : 2, unit = d === 3 ? 1 : 10;
    var total = Math.floor(ms / unit);
    var frac = total % (d === 3 ? 1000 : 100);
    var secsAll = Math.floor(total / (d === 3 ? 1000 : 100));
    var mins = Math.floor(secsAll / 60), secs = secsAll % 60;
    var f = String(frac); while (f.length < d) f = "0" + f;
    return (mins ? mins + ":" + (secs < 10 ? "0" : "") : "") + secs + "." + f;
  }

  function trimOf(n) { return n < 5 ? 0 : Math.ceil(n * 0.05); }

  /* The average of a list of solves, all of them. */
  function average(list) {
    var n = list.length, trim = trimOf(n);
    if (!n) return null;
    var t = list.map(effectiveTime).sort(function (a, b) { return a - b; });
    var dnf = t.filter(function (x) { return x === Infinity; }).length;
    if (dnf > trim) return Infinity;
    var kept = t.slice(trim, n - trim), sum = 0;
    for (var i = 0; i < kept.length; i++) sum += kept[i];
    return Math.round(sum / kept.length);
  }

  /* The average of the n solves ending at index `end` (exclusive). */
  function aoN(solves, n, end) {
    if (end === undefined) end = solves.length;
    if (end < n) return null;
    return average(solves.slice(end - n, end));
  }

  /* Which solves an average trimmed, as indices into the window. */
  function trimmed(list) {
    var trim = trimOf(list.length);
    var order = list.map(function (s, i) { return { i: i, t: effectiveTime(s) }; })
      .sort(function (a, b) { return a.t - b.t || a.i - b.i; });
    var out = {};
    order.slice(0, trim).concat(order.slice(order.length - trim)).forEach(function (o) { out[o.i] = true; });
    return out;
  }

  /* Rolling average series, one value per solve (null until n solves).
     A sorted window slides along instead of re-sorting every window: with
     thousands of solves, the slice-and-sort version stutters after each one. */
  function rolling(solves, n) {
    var out = [], win = [], trim = trimOf(n), t = solves.map(effectiveTime);
    function at(v) {
      var lo = 0, hi = win.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (win[mid] < v) lo = mid + 1; else hi = mid; }
      return lo;
    }
    for (var i = 0; i < t.length; i++) {
      win.splice(at(t[i]), 0, t[i]);
      if (win.length > n) win.splice(at(t[i - n]), 1);
      if (win.length < n) { out.push(null); continue; }
      if (win[n - 1 - trim] === Infinity) { out.push(Infinity); continue; }
      var sum = 0;
      for (var k = trim; k < n - trim; k++) sum += win[k];
      out.push(Math.round(sum / (n - 2 * trim)));
    }
    return out;
  }

  function finite(solves) {
    return solves.map(effectiveTime).filter(function (t) { return t !== Infinity; });
  }

  function mean(solves) {
    var t = finite(solves);
    if (!t.length) return null;
    return Math.round(t.reduce(function (a, b) { return a + b; }, 0) / t.length);
  }

  function sd(solves) {
    var t = finite(solves);
    if (t.length < 2) return null;
    var m = t.reduce(function (a, b) { return a + b; }, 0) / t.length;
    var v = t.reduce(function (a, b) { return a + (b - m) * (b - m); }, 0) / (t.length - 1);
    return Math.round(Math.sqrt(v));
  }

  function bestIndex(series) {
    var b = -1;
    for (var i = 0; i < series.length; i++) {
      var v = series[i];
      if (v === null || v === Infinity) continue;
      if (b < 0 || v < series[b]) b = i;
    }
    return b;
  }

  /* Everything the side panel and the stats sheet show, in one pass. */
  function summary(solves) {
    var singles = solves.map(effectiveTime);
    var out = { count: solves.length, cur: {}, best: {}, bestEnd: {}, roll: {} };
    var bi = bestIndex(singles);
    out.single = singles.length ? singles[singles.length - 1] : null;
    out.bestSingle = bi < 0 ? null : singles[bi];
    out.bestSingleIdx = bi;
    WINDOWS.forEach(function (n) {
      var r = rolling(solves, n);
      out.roll[n] = r;
      out.cur[n] = r.length ? r[r.length - 1] : null;
      var b = bestIndex(r);
      out.best[n] = b < 0 ? null : r[b];
      out.bestEnd[n] = b < 0 ? -1 : b + 1;
    });
    out.mean = mean(solves);
    out.sd = sd(solves);
    out.dnf = solves.filter(function (s) { return s.penalty === "DNF"; }).length;
    out.plus2 = solves.filter(function (s) { return s.penalty === "+2"; }).length;
    var w = -1;
    singles.forEach(function (t) { if (t !== Infinity && t > w) w = t; });
    out.worst = w < 0 ? null : w;
    out.total = finite(solves).reduce(function (a, b) { return a + b; }, 0);
    return out;
  }

  /* After a solve: which personal bests did it set? Only counts when there
     was a previous value to beat, so the first Ao5 is not a "record". */
  function newBests(before, after) {
    var out = [];
    if (after.bestSingle !== null && before.bestSingle !== null && after.bestSingle < before.bestSingle) out.push("single");
    [5, 12, 50, 100].forEach(function (n) {
      if (after.best[n] !== null && before.best[n] !== null && after.best[n] < before.best[n]) out.push("Ao" + n);
    });
    return out;
  }

  /* Histogram of finite times in `bins` equal-width buckets, clipped at the
     2nd and 95th percentiles so one 2-minute disaster, or one slip of the
     finger that stopped the clock at 0.40, does not flatten the chart. */
  function histogram(solves, bins) {
    var t = finite(solves).sort(function (a, b) { return a - b; });
    if (t.length < 2) return null;
    var lo = t[t.length >= 30 ? Math.floor(t.length * 0.02) : 0], hi = t[Math.min(t.length - 1, Math.floor(t.length * 0.95))];
    var step = Math.max(10, niceStep((hi - lo) / (bins || 10)));
    var start = Math.floor(lo / step) * step, out = [];
    for (var x = start; x <= hi; x += step) out.push({ from: x, to: x + step, n: 0 });
    var over = 0, under = 0;
    t.forEach(function (v) {
      var k = Math.floor((v - start) / step);
      if (k < 0) under++; else if (k >= out.length) over++; else out[k].n++;
    });
    return { bins: out, over: over, under: under, step: step };
  }

  function niceStep(raw) {
    var steps = [10, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000];
    for (var i = 0; i < steps.length; i++) if (steps[i] >= raw) return steps[i];
    return 60000 * Math.ceil(raw / 60000);
  }

  /* Solves grouped by local calendar day, newest first. */
  function byDay(solves) {
    var days = {}, order = [];
    solves.forEach(function (s) {
      var d = new Date(s.date);
      var key = d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
      if (!days[key]) { days[key] = { date: s.date, solves: [] }; order.push(key); }
      days[key].solves.push(s);
    });
    return order.reverse().map(function (k) {
      var g = days[k];
      return { date: g.date, count: g.solves.length, mean: mean(g.solves), best: bestIndex(g.solves.map(effectiveTime)) < 0 ? null : Math.min.apply(null, finite(g.solves)), ao5: g.solves.length >= 5 ? average(g.solves.slice(-5)) : null };
    });
  }

  return {
    WINDOWS: WINDOWS,
    effectiveTime: effectiveTime,
    formatTime: formatTime,
    average: average,
    aoN: aoN,
    trimmed: trimmed,
    rolling: rolling,
    mean: mean,
    sd: sd,
    summary: summary,
    newBests: newBests,
    histogram: histogram,
    byDay: byDay
  };
})();

/* Rubiks — statistics: averages, best, worst, trends */
"use strict";

var RK = RK || {};

RK.stats = (function () {
  function effectiveTime(s) {
    if (s.penalty === "DNF") return Infinity;
    return s.time + (s.penalty === "+2" ? 2000 : 0);
  }

  function formatTime(ms) {
    if (ms === Infinity || ms !== ms) return "DNF";
    if (ms < 0) return "-";
    var neg = ms < 0;
    ms = Math.abs(ms);
    var mins = Math.floor(ms / 60000);
    var secs = Math.floor((ms % 60000) / 1000);
    var cents = Math.floor((ms % 1000) / 10);
    var s = (secs < 10 && mins ? "0" : "") + secs + "." + (cents < 10 ? "0" : "") + cents;
    return (neg ? "-" : "") + (mins ? mins + ":" : "") + s;
  }

  /* Average of N: drop best and worst, mean of the rest. If >1 DNF, it is DNF. */
  function aoN(solves, n) {
    if (solves.length < n) return null;
    var last = solves.slice(-n);
    var times = last.map(effectiveTime);
    var dnfs = times.filter(function (t) { return t === Infinity; }).length;
    if (dnfs > 1) return Infinity;
    times.sort(function (a, b) { return a - b; });
    var trimmed = times.slice(1, -1);
    var sum = 0;
    for (var i = 0; i < trimmed.length; i++) sum += trimmed[i];
    return Math.round(sum / trimmed.length);
  }

  /* Mean of all solves (DNFs excluded from count) */
  function mean(solves) {
    var sum = 0, count = 0;
    for (var i = 0; i < solves.length; i++) {
      var t = effectiveTime(solves[i]);
      if (t !== Infinity) { sum += t; count++; }
    }
    return count ? Math.round(sum / count) : null;
  }

  function best(solves) {
    var b = Infinity;
    for (var i = 0; i < solves.length; i++) {
      var t = effectiveTime(solves[i]);
      if (t < b) b = t;
    }
    return b === Infinity ? null : b;
  }

  function worst(solves) {
    var w = -1;
    for (var i = 0; i < solves.length; i++) {
      var t = effectiveTime(solves[i]);
      if (t !== Infinity && t > w) w = t;
    }
    return w < 0 ? null : w;
  }

  function bestAoN(solves, n) {
    if (solves.length < n) return null;
    var b = Infinity;
    for (var i = n; i <= solves.length; i++) {
      var window = solves.slice(i - n, i);
      var a = aoN(window, n);
      if (a !== null && a < b) b = a;
    }
    return b === Infinity ? null : b;
  }

  function summary(solves) {
    return {
      count: solves.length,
      best: best(solves),
      worst: worst(solves),
      mean: mean(solves),
      ao5: aoN(solves, 5),
      ao12: aoN(solves, 12),
      ao50: aoN(solves, 50),
      ao100: aoN(solves, 100),
      bestAo5: bestAoN(solves, 5),
      bestAo12: bestAoN(solves, 12)
    };
  }

  return {
    effectiveTime: effectiveTime,
    formatTime: formatTime,
    aoN: aoN,
    mean: mean,
    best: best,
    worst: worst,
    bestAoN: bestAoN,
    summary: summary
  };
})();

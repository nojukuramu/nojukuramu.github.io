/* Rubiks — charts
 *
 * Same shape as aeons/js/ledger.js chart(): an SVG string, 2px lines, a
 * recessive baseline, no library. Added here: a crosshair and one tooltip
 * that lists every series at the hovered solve, because a trend of 200
 * solves is unreadable without one.
 *
 * Series colours live in the stylesheet (--s-ao5, --s-ao12), validated for
 * both themes; text never wears them. */
"use strict";

var RK = RK || {};

RK.chart = (function () {
  var fmt = function (ms) { return RK.stats.formatTime(ms); };

  function niceTicks(lo, hi, count) {
    var span = hi - lo, raw = span / count;
    var steps = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 15000, 30000, 60000, 120000, 300000];
    var step = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) if (steps[i] >= raw) { step = steps[i]; break; }
    var out = [];
    for (var v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
    return out;
  }

  function path(vals, x, y) {
    var d = "", pen = false;
    for (var i = 0; i < vals.length; i++) {
      var v = vals[i];
      if (v === null || v === Infinity) { pen = false; continue; }
      d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1);
      pen = true;
    }
    return d;
  }

  function tooltip(host) {
    var tip = host.querySelector(".chart-tip");
    if (!tip) { tip = document.createElement("div"); tip.className = "chart-tip"; tip.hidden = true; host.appendChild(tip); }
    return tip;
  }

  function showTip(host, tip, rows, px, py) {
    tip.textContent = "";
    rows.forEach(function (r, i) {
      var line = document.createElement("div");
      if (i === 0) { line.className = "tip-head"; line.textContent = r[0]; }
      else {
        if (r[2]) { var sw = document.createElement("i"); sw.className = "sw " + r[2]; line.appendChild(sw); }
        var b = document.createElement("strong"); b.textContent = r[1];
        line.appendChild(b);
        line.appendChild(document.createTextNode(" " + r[0]));
      }
      tip.appendChild(line);
    });
    tip.hidden = false;
    var w = host.clientWidth, tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(w - tw, px + 12)) + "px";
    tip.style.top = Math.max(0, py - 10) + "px";
  }

  /* Times over solves: singles as faint dots, Ao5 and Ao12 as lines, the
     target as a dashed rule. `first` is the 1-based number of solves[0]. */
  function trend(host, solves, opts) {
    opts = opts || {};
    var W = Math.max(260, host.clientWidth || 600), H = opts.height || 200, padL = 44, padR = 10, padT = 10, padB = 20;
    var singles = solves.map(RK.stats.effectiveTime);
    var a5 = opts.ao5 || [], a12 = opts.ao12 || [];
    var finite = singles.filter(function (t) { return t !== Infinity; }).sort(function (a, b) { return a - b; });
    if (finite.length < 2) { host.innerHTML = '<p class="chart-empty">' + (opts.empty || "The trend starts after a few solves.") + "</p>"; return; }
    /* Clip the fastest and slowest 3% once there are enough solves: one
       finger-slip "0.40" or one 2-minute disaster would otherwise flatten
       every other point into a line. Clipped points sit faded at the edge. */
    var cut = finite.length >= 20 ? Math.floor(finite.length * 0.03) : 0;
    var lo = finite[cut], hi = finite[finite.length - 1 - cut];
    if (opts.target && opts.target > hi * 0.6 && opts.target < hi * 1.4) { lo = Math.min(lo, opts.target); hi = Math.max(hi, opts.target); }
    var span = Math.max(500, hi - lo);
    lo = Math.max(0, lo - span * 0.08); hi = hi + span * 0.08;
    var n = singles.length;
    var x = function (i) { return padL + (n === 1 ? 0.5 : i / (n - 1)) * (W - padL - padR); };
    var y = function (v) { return padT + (1 - (Math.max(lo, Math.min(v, hi)) - lo) / (hi - lo)) * (H - padT - padB); };

    var g = "";
    niceTicks(lo, hi, 4).forEach(function (t) {
      g += '<line class="grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(t).toFixed(1) + '" y2="' + y(t).toFixed(1) + '"/>' +
        '<text class="axis" x="' + (padL - 6) + '" y="' + (y(t) + 3.5).toFixed(1) + '" text-anchor="end">' + fmtTick(t) + "</text>";
    });
    var first = opts.first || 1;
    g += '<text class="axis" x="' + padL + '" y="' + (H - 4) + '">' + first + "</text>";
    g += '<text class="axis" x="' + (W - padR) + '" y="' + (H - 4) + '" text-anchor="end">' + (first + n - 1) + "</text>";
    if (opts.target) g += '<line class="target" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y(opts.target).toFixed(1) + '" y2="' + y(opts.target).toFixed(1) + '"/>';

    var dots = "";
    singles.forEach(function (t, i) {
      if (t === Infinity) dots += '<path class="dnf" d="M' + (x(i) - 3).toFixed(1) + " " + (padT + 3) + "l6 6m0 -6l-6 6" + '"/>';
      else dots += '<circle class="single" cx="' + x(i).toFixed(1) + '" cy="' + y(t).toFixed(1) + '" r="' + (n > 150 ? 1.8 : 2.6) + '"' + (t > hi || t < lo ? ' opacity=".35"' : "") + "/>";
    });

    host.innerHTML = '<svg class="chart-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Times over the last ' + n + ' solves">' + g + dots +
      '<path class="line ao12" d="' + path(a12, x, y) + '"/>' +
      '<path class="line ao5" d="' + path(a5, x, y) + '"/>' +
      '<line class="cross" y1="' + padT + '" y2="' + (H - padB) + '" x1="0" x2="0" visibility="hidden"/></svg>';

    var svg = host.querySelector("svg"), cross = svg.querySelector(".cross"), tip = tooltip(host);
    function at(ev) {
      var r = svg.getBoundingClientRect();
      var vx = (ev.clientX - r.left) / r.width * W;
      var i = Math.round((vx - padL) / (W - padL - padR) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
      var rows = [["Solve " + (first + i)], ["single", fmt(singles[i]), ""]];
      if (a5[i] != null) rows.push(["Ao5", fmt(a5[i]), "ao5"]);
      if (a12[i] != null) rows.push(["Ao12", fmt(a12[i]), "ao12"]);
      showTip(host, tip, rows, ev.clientX - r.left, ev.clientY - r.top);
    }
    function leave() { cross.setAttribute("visibility", "hidden"); tip.hidden = true; }
    svg.addEventListener("pointermove", at);
    svg.addEventListener("pointerdown", at);
    svg.addEventListener("pointerleave", leave);
  }

  function fmtTick(ms) {
    var s = ms / 1000;
    if (s >= 60) { var m = Math.floor(s / 60), r = Math.round(s % 60); return m + ":" + (r < 10 ? "0" : "") + r; }
    return (s % 1 ? s.toFixed(1) : s.toFixed(0));
  }

  /* How the times spread: one bar per bucket, rounded top, 2px gaps. */
  function histogram(host, solves) {
    var h = RK.stats.histogram(solves, 12);
    if (!h) { host.innerHTML = '<p class="chart-empty">The spread shows after a few solves.</p>'; return; }
    var W = Math.max(260, host.clientWidth || 600), H = 150, padL = 8, padR = 8, padT = 14, padB = 22;
    var max = Math.max.apply(null, h.bins.map(function (b) { return b.n; })) || 1;
    var bw = (W - padL - padR) / h.bins.length;
    var bars = "", labels = "", every = Math.ceil(h.bins.length / 6);
    h.bins.forEach(function (b, i) {
      var bh = b.n / max * (H - padT - padB), bx = padL + i * bw + 1, by = H - padB - bh, w = bw - 2;
      if (b.n) bars += '<path class="bar" d="M' + bx.toFixed(1) + " " + (H - padB) + "V" + (by + Math.min(4, bh)).toFixed(1) +
        "q0 -" + Math.min(4, bh).toFixed(1) + " " + Math.min(4, w / 2).toFixed(1) + " -" + Math.min(4, bh).toFixed(1) +
        "H" + (bx + w - Math.min(4, w / 2)).toFixed(1) + "q" + Math.min(4, w / 2).toFixed(1) + " 0 " + Math.min(4, w / 2).toFixed(1) + " " + Math.min(4, bh).toFixed(1) +
        "V" + (H - padB) + 'Z"/>';
      bars += '<rect class="hit" data-i="' + i + '" x="' + (padL + i * bw).toFixed(1) + '" y="0" width="' + bw.toFixed(1) + '" height="' + H + '" fill="transparent"/>';
      if (i % every === 0) labels += '<text class="axis" x="' + (padL + i * bw).toFixed(1) + '" y="' + (H - 6) + '">' + fmtTick(b.from) + "</text>";
    });
    var peak = 0;
    h.bins.forEach(function (b, i) { if (b.n > h.bins[peak].n) peak = i; });
    labels += '<text class="val" x="' + (padL + peak * bw + bw / 2).toFixed(1) + '" y="' + (H - padB - h.bins[peak].n / max * (H - padT - padB) - 4).toFixed(1) + '" text-anchor="middle">' + h.bins[peak].n + "</text>";
    host.innerHTML = '<svg class="chart-svg" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Distribution of times">' +
      '<line class="base" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (H - padB) + '" y2="' + (H - padB) + '"/>' + bars + labels + "</svg>" +
      (h.over || h.under ? '<p class="chart-note">' + [h.under ? h.under + " faster off the left edge" : "", h.over ? h.over + " slower off the right edge" : ""].filter(Boolean).join(", ") + "</p>" : "");
    var svg = host.querySelector("svg"), tip = tooltip(host);
    svg.addEventListener("pointermove", function (ev) {
      var t = ev.target.closest && ev.target.closest(".hit");
      if (!t) { tip.hidden = true; return; }
      var b = h.bins[+t.getAttribute("data-i")], r = svg.getBoundingClientRect();
      showTip(host, tip, [[fmt(b.from) + " to " + fmt(b.to)], ["solves", String(b.n), ""]], ev.clientX - r.left, ev.clientY - r.top);
    });
    svg.addEventListener("pointerleave", function () { tip.hidden = true; });
  }

  return { trend: trend, histogram: histogram };
})();

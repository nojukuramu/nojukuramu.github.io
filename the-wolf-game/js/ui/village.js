/* village.js — the board, drawn as a place you could walk into.
 *
 * The first version arranged houses in concentric rings around a fire. It was
 * legible and it was a diagram: a seating chart with roofs on. This draws the
 * valley instead — a river running through it, a road climbing from the ford to
 * the square, fields behind fences, woods on the slopes, and the houses set into
 * the land at the depth they belong to.
 *
 * Everything is one SVG with a viewBox fitted to whatever space it is given, so
 * it scales to any screen and never asks the page to scroll. The whole scene is
 * generated from a fixed seed, so it is the same valley every time you open it
 * and a different one for every room code.
 *
 * Depth is done the old way, because the old way is the one that reads:
 *
 *   - four bands from the treeline down to the foreground
 *   - things lower on the screen are nearer, so they are larger and drawn last
 *   - a band of mist between each, which is most of why it looks like distance
 *
 * The state of a house is carried by the drawing, never by a label:
 *
 *   alive          window lit, smoke from the chimney
 *   your own       lit, ringed, and named "you"
 *   dead           window out, roof sagging, no smoke
 *   dead tonight   door hanging open, blood at the threshold, and a slow pulse
 *                  until somebody raises the alarm
 *   visited        a footpath trodden from the square to the door
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});
  var NS = "http://www.w3.org/2000/svg";

  function el(name, attrs, kids) {
    var n = document.createElementNS(NS, name);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (attrs[k] == null || attrs[k] === false) return;
      if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    [].concat(kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function txt(s) { return document.createTextNode(s == null ? "" : String(s)); }
  function n2(v) { return Math.round(v * 10) / 10; }

  /** Deterministic PRNG — the same room code is always the same valley. */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seedOf(code) {
    var s = 2166136261;
    String(code || "village").split("").forEach(function (c) {
      s ^= c.charCodeAt(0); s = Math.imul(s, 16777619);
    });
    return s >>> 0;
  }

  var VW = 1000;

  /* ---------------- geometry ----------------
   *
   * The valley is built before anything is drawn in it: the river, the road and
   * the square are decided first, and the houses are then placed against them.
   * That ordering is the whole reason the village looks deliberate — a house
   * cannot end up standing in the ford, because by the time it is placed the
   * ford already exists and it is being measured against.
   */

  function cubic(p0, c1, c2, p1, t) {
    var u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * p0[0] + b * c1[0] + c * c2[0] + d * p1[0],
            a * p0[1] + b * c1[1] + c * c2[1] + d * p1[1]];
  }

  /** Flatten a run of cubic segments into points we can measure against. */
  function flatten(segs, steps) {
    var out = [];
    segs.forEach(function (sg, i) {
      for (var k = i ? 1 : 0; k <= steps; k++) out.push(cubic(sg[0], sg[1], sg[2], sg[3], k / steps));
    });
    return out;
  }

  function svgPath(segs) {
    var d = "M" + n2(segs[0][0][0]) + " " + n2(segs[0][0][1]);
    segs.forEach(function (sg) {
      d += " C" + n2(sg[1][0]) + " " + n2(sg[1][1]) + " " + n2(sg[2][0]) + " " + n2(sg[2][1]) +
           " " + n2(sg[3][0]) + " " + n2(sg[3][1]);
    });
    return d;
  }

  /** Shortest distance from a point to a polyline. `squash` foreshortens the
   *  vertical axis, because a road drawn in perspective is wider than it is
   *  tall and a house beside it should be judged the same way. */
  function distToPoly(x, y, poly, squash) {
    var best = Infinity;
    squash = squash || 1;
    for (var i = 1; i < poly.length; i++) {
      var ax = poly[i - 1][0], ay = poly[i - 1][1];
      var bx = poly[i][0], by = poly[i][1];
      var dx = bx - ax, dy = (by - ay) / squash;
      var px = x - ax, py = (y - ay) / squash;
      var len = dx * dx + dy * dy;
      var t = len ? Math.max(0, Math.min(1, (px * dx + py * dy) / len)) : 0;
      var ex = px - dx * t, ey = py - dy * t;
      var d = Math.sqrt(ex * ex + ey * ey);
      if (d < best) best = d;
    }
    return best;
  }

  /** Where two polylines cross, and which way the first one is running there. */
  function crossing(a, b) {
    for (var i = 1; i < a.length; i++) {
      for (var j = 1; j < b.length; j++) {
        var p = segHit(a[i - 1], a[i], b[j - 1], b[j]);
        if (p) return { x: p[0], y: p[1], angle: Math.atan2(a[i][1] - a[i - 1][1], a[i][0] - a[i - 1][0]) };
      }
    }
    return null;
  }
  function segHit(p1, p2, p3, p4) {
    var d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
    if (!d) return null;
    var u = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
    var v = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return [p1[0] + u * (p2[0] - p1[0]), p1[1] + u * (p2[1] - p1[1])];
  }

  /**
   * Lay out the valley: a river across it, a road up from the bottom through
   * the square and over the ford, and the bridge where the two actually meet.
   */
  function terrain(rnd, VH) {
    /* The river has to stay above the near ridge or the far half of it is
     * painted over by the field in front and the valley loses its water. */
    var ry = VH * (0.395 + rnd() * 0.05);
    var river = [
      [[-40, ry], [VW * 0.22, ry - VH * 0.06], [VW * 0.36, ry + VH * 0.06], [VW * 0.55, ry + VH * 0.03]],
      [[VW * 0.55, ry + VH * 0.03], [VW * 0.74, ry - VH * 0.01], [VW * 0.86, ry + VH * 0.08], [VW + 40, ry + VH * 0.055]]
    ];
    var riverPoly = flatten(river, 26);

    var square = { x: VW * (0.40 + rnd() * 0.20), y: VH * (0.70 + rnd() * 0.06) };

    // The ford: a point on the river the road will climb to.
    var fordX = VW * (0.22 + rnd() * 0.34);
    var fordY = riverPoly.reduce(function (best, pt) {
      return Math.abs(pt[0] - fordX) < Math.abs(best[0] - fordX) ? pt : best;
    }, riverPoly[0])[1];

    var exitX = VW * (0.62 + rnd() * 0.26);
    var road = [
      [[exitX, VH + 40], [exitX - VW * 0.05, VH * 0.94], [square.x + VW * 0.14, square.y + VH * 0.10], [square.x, square.y]],
      [[square.x, square.y], [square.x - VW * 0.16, square.y - VH * 0.08], [fordX + VW * 0.06, fordY + VH * 0.10], [fordX, fordY]],
      /* The road stops at the treeline rather than running off the top of the
       * frame: above the far ridge there is no ground for it to be on, and a
       * road drawn across the open sky reads as a bug. */
      [[fordX, fordY], [fordX - VW * 0.04, fordY - VH * 0.09], [fordX - VW * 0.02, VH * 0.24], [fordX + VW * 0.02, VH * 0.145]]
    ];
    var roadPoly = flatten(road, 22);

    return {
      river: river, riverPoly: riverPoly, riverD: svgPath(river),
      road: road, roadPoly: roadPoly, roadD: svgPath(road),
      square: square,
      ford: crossing(roadPoly, riverPoly) || { x: fordX, y: fordY, angle: -1.2 }
    };
  }

  /* The four depth bands, as fractions of the drawn height, with the scale a
   * house sits at in each. The gaps are where the mist and the woods go. */
  var BANDS = [
    { y: 0.30, scale: 0.52 },
    { y: 0.45, scale: 0.72 },
    { y: 0.64, scale: 0.96 },
    { y: 0.84, scale: 1.24 }
  ];

  /** How many houses go in each band, near ones first — the front row reads. */
  function spread(n) {
    if (n <= 3) return [0, 0, n, 0];
    if (n <= 6) return [0, 0, Math.ceil(n / 2), n - Math.ceil(n / 2)];
    if (n <= 10) return [0, Math.floor(n * 0.3), Math.ceil(n * 0.38), n - Math.floor(n * 0.3) - Math.ceil(n * 0.38)];
    if (n <= 16) return [Math.floor(n * 0.18), Math.floor(n * 0.26), Math.ceil(n * 0.3),
                         n - Math.floor(n * 0.18) - Math.floor(n * 0.26) - Math.ceil(n * 0.3)];
    return [Math.floor(n * 0.22), Math.floor(n * 0.26), Math.ceil(n * 0.28),
            n - Math.floor(n * 0.22) - Math.floor(n * 0.26) - Math.ceil(n * 0.28)];
  }

  function unitFor(n) { return n > 18 ? 0.62 : n > 12 ? 0.74 : n > 8 ? 0.86 : n > 4 ? 1.0 : 1.15; }

  /**
   * Where every house stands.
   *
   * Not a row and not a ring: darts thrown into each depth band and rejected
   * until they land somewhere a person would actually build. A site has to be
   * off the road, out of the water, clear of the square and clear of its
   * neighbours — and it is preferred if it is *near* the road, because that is
   * what makes the result read as a village that grew along a road rather than
   * houses scattered over a field.
   *
   * If a band cannot find a good site in a reasonable number of throws the
   * constraints relax rather than the loop spinning: a full room on a short
   * screen is a genuinely tight fit, and a house slightly too near the verge is
   * a much better outcome than a missing one.
   */
  function layout(n, VH, seed, geo) {
    var rnd = rng(seed);
    var counts = spread(n);
    var unit = unitFor(n);
    var out = [], idx = 0;

    counts.forEach(function (count, b) {
      if (!count) return;
      var band = BANDS[b];
      var baseScale = band.scale * unit;
      // The widest shape is the long house at 106 across, plus a 15-wide gable
      // and a 9-wide eave on each side. Measuring from the wall alone clipped
      // the outermost house on every screen.
      var half = 72 * baseScale;
      var margin = half + 22;
      var lo = VH * (band.y - 0.055), hi = VH * (band.y + 0.055);

      for (var i = 0; i < count; i++) {
        var placed = null;
        for (var attempt = 0; attempt < 220 && !placed; attempt++) {
          var relax = attempt / 220;                       // 0 strict, 1 desperate
          var x = margin + rnd() * (VW - margin * 2);
          var y = lo + rnd() * (hi - lo);

          var roadGap = distToPoly(x, y, geo.roadPoly, 0.55);
          var riverGap = distToPoly(x, y, geo.riverPoly, 0.55);
          if (roadGap < (half + 30) * (1 - relax * 0.5)) continue;
          if (riverGap < (half + 26) * (1 - relax * 0.5)) continue;

          var sq = Math.hypot(x - geo.square.x, (y - geo.square.y) / 0.5);
          if (sq < (150 + half) * (1 - relax * 0.45)) continue;

          var clash = out.some(function (o) {
            var need = (half + 56 * o.scale + 26) * (1 - relax * 0.5);
            return Math.hypot(x - o.x, (y - o.y) / 0.55) < need;
          });
          if (clash) continue;

          // A house belongs near the road. Insist on it while there is still
          // room to be fussy, then stop insisting.
          if (relax < 0.55 && roadGap > 300) continue;

          placed = { x: x, y: y, roadGap: roadGap };
        }
        if (!placed) {
          // Nowhere at all: fall back to an even slot on the band.
          var t = (i + 0.5) / count;
          placed = { x: margin + (VW - margin * 2) * t, y: (lo + hi) / 2, roadGap: 999 };
        }
        out.push({
          x: placed.x, y: placed.y,
          scale: baseScale * (0.94 + rnd() * 0.12),
          band: b, i: idx++
        });
      }
    });
    // Painter's order: nearer things last.
    return out.sort(function (a, b) { return a.y - b.y; });
  }

  /* ---------------- scenery ---------------- */

  /** A soft ridge: one path across the frame, used for every field band. */
  function ridge(rnd, VH, yFrac, amp, cls) {
    var pts = [];
    for (var i = 0; i <= 10; i++) {
      pts.push([VW * (i / 10), VH * yFrac - amp * VH * (rnd() * 0.8 + 0.2)]);
    }
    var d = "M-20 " + n2(VH + 40) + " L-20 " + n2(pts[0][1]);
    for (var k = 1; k < pts.length; k++) {
      var p0 = pts[k - 1], p1 = pts[k];
      var cx = (p0[0] + p1[0]) / 2;
      d += " C" + n2(cx) + " " + n2(p0[1]) + " " + n2(cx) + " " + n2(p1[1]) + " " + n2(p1[0]) + " " + n2(p1[1]);
    }
    d += " L" + (VW + 20) + " " + n2(VH + 40) + " Z";
    return el("path", { class: cls, d: d });
  }

  /** A conifer, a broadleaf, or a bare one — the last only where things died. */
  /* Two nested groups on purpose. A CSS `transform` animation on an element
   * that also carries a `transform` *attribute* replaces it outright — which
   * quietly stacked every tree in the village at the origin the first time the
   * sway was added. Placement lives on the outer group, motion on the inner. */
  function tree(x, y, s, kind) {
    var outer = el("g", { transform: "translate(" + n2(x) + "," + n2(y) + ") scale(" + n2(s) + ")" });
    var g = el("g", { class: "ln-tree" });
    outer.appendChild(g);
    g.appendChild(el("ellipse", { class: "ln-tree-shadow", cx: 0, cy: 2, rx: 14, ry: 3.5 }));
    g.appendChild(el("path", { class: "ln-trunk", d: "M-2.2 0 h4.4 l-1 -16 h-2.4 z" }));
    if (kind === "conifer") {
      g.appendChild(el("path", { class: "ln-crown c1", d: "M0 -46 L11 -22 H-11 Z" }));
      g.appendChild(el("path", { class: "ln-crown c2", d: "M0 -34 L14 -8 H-14 Z" }));
    } else if (kind === "bare") {
      g.appendChild(el("path", {
        class: "ln-branch",
        d: "M0 -14 l-9 -11 M0 -18 l8 -12 M0 -22 l-6 -12 M0 -8 l10 -7"
      }));
    } else {
      g.appendChild(el("circle", { class: "ln-crown c1", cx: -6, cy: -26, r: 12 }));
      g.appendChild(el("circle", { class: "ln-crown c2", cx: 7, cy: -24, r: 10 }));
      g.appendChild(el("circle", { class: "ln-crown c1", cx: 0, cy: -34, r: 11 }));
    }
    return outer;
  }

  /** A dry-stone wall of the fields, drawn as posts and rails. */
  function fence(x1, y1, x2, y2, posts) {
    var g = el("g", { class: "ln-fence" });
    g.appendChild(el("path", { d: "M" + n2(x1) + " " + n2(y1 - 7) + " L" + n2(x2) + " " + n2(y2 - 7) }));
    g.appendChild(el("path", { d: "M" + n2(x1) + " " + n2(y1 - 13) + " L" + n2(x2) + " " + n2(y2 - 13) }));
    for (var i = 0; i <= posts; i++) {
      var t = i / posts;
      var px = x1 + (x2 - x1) * t, py = y1 + (y2 - y1) * t;
      g.appendChild(el("path", { class: "post", d: "M" + n2(px) + " " + n2(py) + " v-17" }));
    }
    return g;
  }

  /* ---------------- one house ----------------
   *
   * Three shapes, chosen by seat so a village is not a row of identical boxes:
   * a cottage, a long low house and a steep-roofed cabin. On top of that,
   * shingles on the roof, a doorstep, a lantern by the door that sways and
   * throws light on the wall, and — for some — a woodpile or a barrel.
   *
   * All of it is cheap: paths and one animation class. The point is that at
   * forty pixels a house should still read as somebody's home rather than as
   * a marker on a map.
   */

  var SHAPES = [
    { w: 88, wall: 58, roof: 42, windows: 2, logs: false, name: "cottage" },
    { w: 106, wall: 50, roof: 32, windows: 2, logs: false, name: "long" },
    { w: 74, wall: 54, roof: 52, windows: 1, logs: true, name: "cabin" }
  ];

  function house(spot, h, p, opts) {
    var s = spot.scale;
    var shape = SHAPES[spot.i % SHAPES.length];
    var w = shape.w * s, roof = shape.roof * s, wall = shape.wall * s;
    var dead = !h.occupantAlive;
    var fresh = h.state === "dead-tonight";

    var cls = ["hs", "hs-" + shape.name];
    if (h.isOwn) cls.push("own");
    if (dead) cls.push("dead");
    if (fresh) cls.push("fresh");
    if (h.reported) cls.push("reported");
    if (h.visited) cls.push("visited");
    if (opts.selectable === false) cls.push("static");

    var g = el("g", {
      class: cls.join(" "),
      transform: "translate(" + n2(spot.x) + "," + n2(spot.y) + ")",
      role: opts.selectable === false ? null : "button",
      tabindex: opts.selectable === false ? null : "0",
      "aria-label": p.name + (dead ? ", dead" : ""),
      onclick: opts.onPick ? function () { opts.onPick(h.id); } : null,
      onkeydown: opts.onPick ? function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onPick(h.id); }
      } : null
    });

    g.appendChild(el("ellipse", { class: "hs-shadow", cx: 2 * s, cy: 3 * s, rx: w * 0.64, ry: 8 * s }));

    // Smoke first, so it rises from behind the roof rather than over it.
    if (!dead) {
      g.appendChild(el("path", {
        class: "hs-smoke",
        d: "M" + n2(-w * 0.30) + " " + n2(-wall - roof * 0.62) +
           " c" + n2(-6 * s) + " " + n2(-14 * s) + " " + n2(9 * s) + " " + n2(-19 * s) + " " + n2(2 * s) + " " + n2(-33 * s) +
           " c" + n2(-7 * s) + " " + n2(-11 * s) + " " + n2(6 * s) + " " + n2(-16 * s) + " " + n2(3 * s) + " " + n2(-26 * s)
      }));
    }

    var lean = dead ? (spot.i % 2 ? 1.8 : -1.8) : 0;
    var body = el("g", { transform: "rotate(" + lean + ")" });

    body.appendChild(el("path", {
      class: "hs-wall",
      d: "M" + n2(-w / 2) + " 0 L" + n2(-w / 2) + " " + n2(-wall) +
         " L" + n2(w / 2) + " " + n2(-wall) + " L" + n2(w / 2) + " 0 Z"
    }));

    // Log courses on the cabin, so the three shapes read differently up close.
    if (shape.logs) {
      var logs = "";
      for (var lg = 1; lg < 4; lg++) {
        logs += "M" + n2(-w / 2 + 2 * s) + " " + n2(-wall + (wall / 4) * lg) +
                " h" + n2(w - 4 * s) + " ";
      }
      body.appendChild(el("path", { class: "hs-logs", d: logs }));
    }

    // A gable end, so it is a solid and not a facade.
    body.appendChild(el("path", {
      class: "hs-gable",
      d: "M" + n2(w / 2) + " 0 L" + n2(w / 2) + " " + n2(-wall) +
         " L" + n2(w / 2 + 15 * s) + " " + n2(-wall + 6 * s) + " L" + n2(w / 2 + 15 * s) + " " + n2(6 * s) + " Z"
    }));
    body.appendChild(el("path", {
      class: "hs-roof",
      d: "M" + n2(-w / 2 - 9 * s) + " " + n2(-wall) + " L0 " + n2(-wall - roof) +
         " L" + n2(w / 2 + 9 * s) + " " + n2(-wall) + " Z"
    }));

    // Shingles: courses following the pitch, thinning towards the ridge.
    var sh = "";
    for (var c = 1; c <= 3; c++) {
      var f = c / 4;
      var y = -wall - roof * f;
      var half = (w / 2 + 9 * s) * (1 - f);
      sh += "M" + n2(-half) + " " + n2(y) + " h" + n2(half * 2) + " ";
    }
    body.appendChild(el("path", { class: "hs-shingles", d: sh }));

    body.appendChild(el("path", {
      class: "hs-roof-side",
      d: "M" + n2(w / 2 + 9 * s) + " " + n2(-wall) + " L0 " + n2(-wall - roof) +
         " L" + n2(10 * s) + " " + n2(-wall - roof + 5 * s) +
         " L" + n2(w / 2 + 21 * s) + " " + n2(-wall + 5 * s) + " Z"
    }));
    // Chimney, with a cap.
    body.appendChild(el("path", {
      class: "hs-roof",
      d: "M" + n2(-w * 0.30) + " " + n2(-wall - roof * 0.52) + " h" + n2(11 * s) +
         " v" + n2(-15 * s) + " h" + n2(-11 * s) + " z"
    }));
    body.appendChild(el("path", {
      class: "hs-roof-side",
      d: "M" + n2(-w * 0.30 - 2 * s) + " " + n2(-wall - roof * 0.52 - 15 * s) + " h" + n2(15 * s) + " v" + n2(-3 * s) + " h" + n2(-15 * s) + " z"
    }));

    // Windows: one or two, each with a frame and a sill.
    var winY = -wall + 12 * s, winH = 20 * s;
    var slots = shape.windows === 1 ? [0] : [-1, 1];
    slots.forEach(function (k) {
      var cx = shape.windows === 1 ? -w * 0.16 : k * w * 0.24;
      var ww = 16 * s;
      body.appendChild(el("rect", {
        class: "hs-window", x: n2(cx - ww / 2), y: n2(winY), width: n2(ww), height: n2(winH), rx: n2(1.6 * s)
      }));
      body.appendChild(el("path", {
        class: "hs-mullion",
        d: "M" + n2(cx - ww / 2) + " " + n2(winY + winH * 0.5) + " h" + n2(ww) +
           " M" + n2(cx) + " " + n2(winY) + " v" + n2(winH)
      }));
      body.appendChild(el("path", {
        class: "hs-sill",
        d: "M" + n2(cx - ww / 2 - 2 * s) + " " + n2(winY + winH) + " h" + n2(ww + 4 * s)
      }));
    });

    // Doorstep, then the door.
    var doorX = shape.windows === 1 ? w * 0.18 : 0;
    body.appendChild(el("path", {
      class: "hs-step",
      d: "M" + n2(doorX - 13 * s) + " 0 h" + n2(26 * s) + " v" + n2(4 * s) + " h" + n2(-26 * s) + " z"
    }));
    if (fresh) {
      body.appendChild(el("rect", {
        class: "hs-doorway", x: n2(doorX - 9 * s), y: n2(-30 * s), width: n2(18 * s), height: n2(30 * s), rx: n2(2 * s)
      }));
      body.appendChild(el("path", {
        class: "hs-door open",
        d: "M" + n2(doorX + 9 * s) + " 0 v" + n2(-30 * s) + " l" + n2(12 * s) + " " + n2(-5 * s) + " v" + n2(35 * s) + " z"
      }));
    } else {
      body.appendChild(el("rect", {
        class: "hs-door", x: n2(doorX - 9 * s), y: n2(-30 * s), width: n2(18 * s), height: n2(30 * s), rx: n2(2 * s)
      }));
      body.appendChild(el("circle", { class: "hs-handle", cx: n2(doorX + 5 * s), cy: n2(-15 * s), r: n2(1.5 * s) }));
    }

    // A lantern beside the door, on a bracket. It swings, and it is the only
    // light on the outside of the house.
    var lx = doorX + 20 * s, ly = -36 * s;
    var lamp = el("g", { class: "hs-lamp", transform: "translate(" + n2(lx) + "," + n2(ly) + ")" });
    lamp.appendChild(el("path", { class: "hs-bracket", d: "M" + n2(-8 * s) + " 0 h" + n2(8 * s) }));
    var swing = el("g", { class: "hs-lamp-swing" });
    swing.appendChild(el("path", { class: "hs-bracket", d: "M0 0 v" + n2(5 * s) }));
    swing.appendChild(el("circle", { class: "hs-lamp-glow", cx: 0, cy: 9 * s, r: n2(15 * s) }));
    swing.appendChild(el("path", {
      class: "hs-lamp-body",
      d: "M" + n2(-3.4 * s) + " " + n2(5 * s) + " h" + n2(6.8 * s) + " l" + n2(1.4 * s) + " " + n2(7 * s) +
         " h" + n2(-9.6 * s) + " z"
    }));
    lamp.appendChild(swing);
    body.appendChild(lamp);

    g.appendChild(body);

    if (!dead) g.appendChild(el("ellipse", { class: "hs-spill", cx: 0, cy: 5 * s, rx: w * 0.74, ry: 16 * s }));

    // Something in the yard, on about half of them.
    if (spot.i % 3 === 0) {
      g.appendChild(el("path", {
        class: "hs-props",
        d: "M" + n2(-w * 0.62) + " 0 h" + n2(15 * s) + " v" + n2(-9 * s) + " h" + n2(-15 * s) + " z"
      }));
      g.appendChild(el("path", {
        class: "hs-props-line",
        d: "M" + n2(-w * 0.62) + " " + n2(-4.5 * s) + " h" + n2(15 * s)
      }));
    } else if (spot.i % 3 === 1) {
      g.appendChild(el("path", {
        class: "hs-props",
        d: "M" + n2(w * 0.56) + " 0 q" + n2(2 * s) + " " + n2(-11 * s) + " " + n2(11 * s) + " " + n2(-11 * s) +
           " q" + n2(9 * s) + " 0 " + n2(11 * s) + " " + n2(11 * s) + " z"
      }));
    }

    if (fresh) {
      g.appendChild(el("path", {
        class: "hs-smear",
        d: "M" + n2(doorX - 23 * s) + " " + n2(-33 * s) +
           " q" + n2(5 * s) + " " + n2(16 * s) + " " + n2(2 * s) + " " + n2(33 * s) +
           " l" + n2(8 * s) + " 0 q" + n2(2 * s) + " " + n2(-18 * s) + " " + n2(-2 * s) + " " + n2(-33 * s) + " z"
      }));
      g.appendChild(el("path", {
        class: "hs-blood",
        d: "M" + n2(-w * 0.30) + " " + n2(3 * s) +
           " q" + n2(16 * s) + " " + n2(14 * s) + " " + n2(40 * s) + " " + n2(6 * s) +
           " q" + n2(16 * s) + " " + n2(-3 * s) + " " + n2(26 * s) + " " + n2(5 * s) +
           " q" + n2(-12 * s) + " " + n2(13 * s) + " " + n2(-44 * s) + " " + n2(10 * s) +
           " q" + n2(-30 * s) + " " + n2(2 * s) + " " + n2(-22 * s) + " " + n2(-21 * s) + " z"
      }));
      g.appendChild(el("circle", { class: "hs-drop", cx: n2(w * 0.50), cy: n2(15 * s), r: n2(4 * s) }));
      g.appendChild(el("circle", { class: "hs-drop", cx: n2(-w * 0.44), cy: n2(11 * s), r: n2(2.6 * s) }));
      if (!h.reported) g.appendChild(el("circle", { class: "hs-alarm", cx: 0, cy: n2(-wall * 0.5), r: n2(w * 0.66) }));
    }

    g.appendChild(el("text", { class: "hs-name", x: 0, y: n2(23 * s), "text-anchor": "middle" }, [txt(p.name)]));
    if (opts.subtitle) {
      var sub = opts.subtitle(h, p);
      if (sub) g.appendChild(el("text", { class: "hs-sub", x: 0, y: n2(36 * s), "text-anchor": "middle" }, [txt(sub)]));
    }
    return g;
  }

  /* ---------------- the scene ---------------- */

  /** Gradients the scene needs. One <defs>, added once per repaint. */
  function defs() {
    var d = el("defs");
    /* The road has to stop somewhere, and a round stroke cap sitting in an
     * open field reads as a broken drawing. It fades out into the treeline. */
    /* White, not black. An SVG mask is a *luminance* mask: black hides whatever
     * its alpha says, so a black-to-black gradient erases the entire road. */
    var fade = el("linearGradient", { id: "wg-road-fade", x1: "0", y1: "0", x2: "0", y2: "1" });
    fade.appendChild(el("stop", { offset: "0%", "stop-color": "#fff", "stop-opacity": "0" }));
    fade.appendChild(el("stop", { offset: "20%", "stop-color": "#fff", "stop-opacity": "1" }));
    d.appendChild(fade);

    var spill = el("radialGradient", { id: "wg-spill" });
    spill.appendChild(el("stop", { offset: "0%", "stop-color": "#ffcf8a", "stop-opacity": "0.5" }));
    spill.appendChild(el("stop", { offset: "55%", "stop-color": "#ffcf8a", "stop-opacity": "0.16" }));
    spill.appendChild(el("stop", { offset: "100%", "stop-color": "#ffcf8a", "stop-opacity": "0" }));
    d.appendChild(spill);
    var lamp = el("radialGradient", { id: "wg-lamp" });
    lamp.appendChild(el("stop", { offset: "0%", "stop-color": "#ffc978", "stop-opacity": "0.55" }));
    lamp.appendChild(el("stop", { offset: "100%", "stop-color": "#ffc978", "stop-opacity": "0" }));
    d.appendChild(lamp);
    return d;
  }

  function paint(svg, view, houses, VH, opts) {
    var seed = seedOf(view.code);
    var rnd = rng(seed);
    var geo = terrain(rnd, VH);
    var spots = layout(houses.length, VH, seed, geo);
    var night = view.phase === "night" || view.phase === "verdict" || view.phase === "role_reveal";
    svg.setAttribute("class", "village-svg" + (night ? " night" : ""));
    svg.appendChild(defs());

    /* --- the land, back to front, with mist in the gaps --- */
    svg.appendChild(ridge(rnd, VH, 0.145, 0.045, "ln-field far"));
    svg.appendChild(el("rect", { class: "ln-mist", x: -20, y: n2(VH * 0.125), width: VW + 40, height: n2(VH * 0.10) }));
    svg.appendChild(ridge(rnd, VH, 0.36, 0.06, "ln-field mid"));

    /* --- the river --- */
    svg.appendChild(el("path", { class: "ln-river-bank", d: geo.riverD }));
    svg.appendChild(el("path", { class: "ln-river", d: geo.riverD }));
    svg.appendChild(el("path", { class: "ln-river-glint", d: geo.riverD }));

    svg.appendChild(el("rect", { class: "ln-mist", x: -20, y: n2(VH * 0.36), width: VW + 40, height: n2(VH * 0.09) }));
    svg.appendChild(ridge(rnd, VH, 0.55, 0.05, "ln-field near"));

    /* Nightfall over the land.
     *
     * Pigments mixed with the sky get you a green valley by day, but at
     * midnight a 58% green is still a green: mixing cannot take a colour below
     * the darkest thing in the mix. So the ground gets a scrim whose opacity is
     * driven by `--sky-mix`, the same 0-to-1 the theme uses for how far from
     * noon we are. At noon it is invisible; at midnight it puts the whole
     * valley under the night. */
    svg.appendChild(el("rect", { class: "ln-dusk", x: -20, y: -20, width: VW + 40, height: VH + 40 }));

    /* --- the road, and the bridge where it actually meets the water --- */
    var mask = el("mask", { id: "wg-road-mask", maskUnits: "userSpaceOnUse" });
    mask.appendChild(el("rect", { x: -40, y: 0, width: VW + 80, height: VH, fill: "url(#wg-road-fade)" }));
    svg.appendChild(mask);
    var roadG = el("g", { mask: "url(#wg-road-mask)" });
    roadG.appendChild(el("path", { class: "ln-road-edge", d: geo.roadD }));
    roadG.appendChild(el("path", { class: "ln-road", d: geo.roadD }));
    svg.appendChild(roadG);

    var deg = (geo.ford.angle * 180) / Math.PI + 90;
    var bridge = el("g", {
      class: "ln-bridge",
      transform: "translate(" + n2(geo.ford.x) + "," + n2(geo.ford.y) + ") rotate(" + n2(deg) + ")"
    });
    bridge.appendChild(el("path", { class: "deck", d: "M-44 0 h88" }));
    bridge.appendChild(el("path", { class: "rail", d: "M-42 -11 h84 M-42 -4 h84" }));
    for (var bp = -42; bp <= 42; bp += 21) bridge.appendChild(el("path", { class: "post", d: "M" + bp + " 1 v-13" }));
    svg.appendChild(bridge);

    /* --- fields, fenced along the near bank on both sides of the road --- */
    svg.appendChild(fence(VW * 0.03, VH * 0.60, VW * 0.24, VH * 0.575, 6));
    svg.appendChild(fence(VW * 0.76, VH * 0.585, VW * 0.98, VH * 0.615, 6));

    /* --- woods: anywhere a house, the road or the water is not --- */
    var taken = spots.map(function (sp) { return { x: sp.x, y: sp.y, r: 74 * sp.scale }; });
    taken.push({ x: geo.square.x, y: geo.square.y, r: 140 });
    function clear(x, y, r) {
      for (var i = 0; i < taken.length; i++) {
        var t = taken[i];
        var dx = (x - t.x) / (t.r + r), dy = (y - t.y) / ((t.r + r) * 0.55);
        if (dx * dx + dy * dy < 1) return false;
      }
      if (distToPoly(x, y, geo.riverPoly, 0.55) < 34 + r * 0.5) return false;
      if (distToPoly(x, y, geo.roadPoly, 0.55) < 30 + r * 0.5) return false;
      return true;
    }

    /* Woods over the whole valley, thickest on the far slopes where nobody
     * lives. An even scatter left the upper half bare, which read as an empty
     * stage with a village standing on it. */
    var trees = [];
    for (var a = 0; a < 340 && trees.length < 78; a++) {
      var ty = VH * (0.185 + rnd() * 0.81);
      var depth = ty / VH;
      // Two thirds up the slope, one third down in the fields.
      if (depth > 0.55 && rnd() < 0.45) continue;
      var tx = rnd() * VW;
      if (!clear(tx, ty, 22)) continue;
      var ts = (0.26 + depth * 1.05) * (0.8 + rnd() * 0.45);
      // Bare trees only in the far woods, where they read as depth rather than
      // as a broken drawing.
      var kind = rnd() < 0.58 ? "conifer" : (depth < 0.45 && rnd() < 0.18) ? "bare" : "broadleaf";
      trees.push({ x: tx, y: ty, s: ts, kind: kind });
      taken.push({ x: tx, y: ty, r: 14 * ts });
    }

    /* --- everything from here is depth-sorted together, so a tree can stand
     *     in front of a far house and behind a near one --- */
    var props = trees.map(function (t) {
      return { y: t.y, node: function () { return tree(t.x, t.y, t.s, t.kind); } };
    });

    // The square: a well, a fire, and the ground worn bare around them.
    props.push({ y: geo.square.y + 1, node: function () {
      var g = el("g", { class: "ln-square", transform: "translate(" + n2(geo.square.x) + "," + n2(geo.square.y) + ")" });
      g.appendChild(el("ellipse", { class: "ln-clearing", cx: 0, cy: 0, rx: 124, ry: 44 }));
      g.appendChild(el("circle", { class: "ln-fire-glow", cx: -6, cy: -4, r: 66 }));
      g.appendChild(el("path", { class: "ln-logs", d: "M-24 4 L22 -6 M-24 -6 L22 4" }));
      g.appendChild(el("path", {
        class: "ln-flame",
        d: "M-4 -36 C6 -24 12 -15 12 -7 C12 3 5 9 -4 9 C-13 9 -20 3 -20 -7 C-20 -15 -14 -24 -4 -36 Z"
      }));
      g.appendChild(el("path", { class: "ln-well", d: "M44 4 h34 v-16 h-34 z" }));
      g.appendChild(el("path", { class: "ln-well-frame", d: "M46 -12 v-20 h30 v20 M42 -32 h38 l-6 -9 h-26 z" }));
      return g;
    } });

    // A few boulders on the near slope, for texture.
    for (var b2 = 0; b2 < 8; b2++) {
      var kx = rnd() * VW, ky = VH * (0.5 + rnd() * 0.46);
      if (!clear(kx, ky, 30)) continue;
      (function (kx, ky, ks) {
        props.push({ y: ky, node: function () {
          return el("path", {
            class: "ln-rock",
            d: "M" + n2(kx - 16 * ks) + " " + n2(ky) +
               " q" + n2(2 * ks) + " " + n2(-13 * ks) + " " + n2(13 * ks) + " " + n2(-14 * ks) +
               " q" + n2(12 * ks) + " " + n2(-1 * ks) + " " + n2(19 * ks) + " " + n2(14 * ks) + " z"
          });
        } });
      })(kx, ky, 0.5 + rnd() * 0.8);
    }

    // A short path from the road to each door, so a house is connected to the
    // village rather than dropped beside it.
    spots.forEach(function (sp) {
      if (sp.roadGap > 220) return;
      var near = nearestOn(geo.roadPoly, sp.x, sp.y);
      svg.appendChild(el("path", {
        class: "ln-drive",
        d: "M" + n2(near[0]) + " " + n2(near[1]) +
           " Q" + n2((near[0] + sp.x) / 2) + " " + n2((near[1] + sp.y) / 2 + 6) + " " + n2(sp.x) + " " + n2(sp.y + 2)
      }));
    });

    // Footpaths to doors you have already been to tonight.
    houses.forEach(function (h, i) {
      if (!h.visited) return;
      var sp = spots.filter(function (x) { return x.i === i; })[0];
      if (!sp) return;
      svg.appendChild(el("path", {
        class: "ln-track",
        d: "M" + n2(geo.square.x) + " " + n2(geo.square.y) +
           " Q" + n2((geo.square.x + sp.x) / 2 + 30) + " " + n2((geo.square.y + sp.y) / 2) + " " + n2(sp.x) + " " + n2(sp.y + 3)
      }));
    });

    spots.forEach(function (sp) {
      var h = houses[sp.i];
      if (!h) return;
      var p = playerOf(view, h.id) || { name: "?" };
      props.push({ y: sp.y + 0.5, node: function () { return house(sp, h, p, opts); } });
    });

    props.sort(function (a, b) { return a.y - b.y; });
    props.forEach(function (pr) { svg.appendChild(pr.node()); });

    /* A second, lighter scrim over the houses and trees. Windows, the fire and
     * the blood are drawn after it, so the only things that stay bright at
     * night are the things that ought to be. */
    svg.appendChild(el("rect", { class: "ln-night", x: -20, y: -20, width: VW + 40, height: VH + 40 }));
    relight(svg);

    /* --- fireflies, at night only, in the near field --- */
    if (night) {
      for (var f = 0; f < 14; f++) {
        svg.appendChild(el("circle", {
          class: "ln-fly", cx: n2(rnd() * VW), cy: n2(VH * (0.45 + rnd() * 0.5)), r: n2(1.6 + rnd() * 1.6),
          style: "animation-delay:" + n2(rnd() * -9) + "s;animation-duration:" + n2(5 + rnd() * 6) + "s"
        }));
      }
    }

    /* --- foreground: grass along the very bottom, out of focus --- */
    var grass = "";
    for (var q = 0; q < 60; q++) {
      var gx = (q / 60) * (VW + 40) - 20 + rnd() * 16;
      var gh = 10 + rnd() * 22;
      grass += "M" + n2(gx) + " " + n2(VH + 12) + " q" + n2(rnd() * 8 - 4) + " " + n2(-gh * 0.6) + " " + n2(rnd() * 12 - 6) + " " + n2(-gh) + " ";
    }
    svg.appendChild(el("path", { class: "ln-grass", d: grass }));
  }

  /** The point on a polyline nearest a given spot. */
  function nearestOn(poly, x, y) {
    var best = poly[0], bd = Infinity;
    for (var i = 0; i < poly.length; i++) {
      var d = Math.hypot(poly[i][0] - x, (poly[i][1] - y) / 0.55);
      if (d < bd) { bd = d; best = poly[i]; }
    }
    return best;
  }

  /* Re-stamp on top of the night scrim everything that must not be dimmed by
   * it: window glass, the spill on the ground beneath it, the fire, anything
   * bleeding — and the names, which the blood pool was otherwise painting over.
   * Cloning is cheaper and far less error-prone than trying to hold a z-order
   * through a depth sort. */
  function relight(svg) {
    var lit = svg.querySelectorAll(
      ".hs-window, .hs-spill, .ln-flame, .ln-fire-glow, .hs-blood, .hs-smear, .hs-drop, .hs-alarm, .ln-fly, .hs-name, .hs-sub");
    var layer = el("g", { class: "ln-lit" });
    for (var i = 0; i < lit.length; i++) {
      var node = lit[i].cloneNode(true);
      // Carry the ancestors' transforms down onto the clone.
      var t = [], p = lit[i];
      while (p && p !== svg) {
        var tr = p.getAttribute && p.getAttribute("transform");
        if (tr) t.unshift(tr);
        p = p.parentNode;
      }
      if (t.length) {
        var wrap = el("g", { transform: t.join(" ") });
        wrap.appendChild(node);
        layer.appendChild(wrap);
      } else {
        layer.appendChild(node);
      }
    }
    svg.appendChild(layer);
  }

  /* ---------------- mounting ---------------- */

  function render(view, opts) {
    opts = opts || {};
    var houses = (view.houses || []).filter(function (h) {
      var p = playerOf(view, h.id);
      return p && !p.spectator;
    });

    var svg = el("svg", {
      class: "village-svg",
      preserveAspectRatio: "xMidYMid slice",
      role: "group",
      "aria-label": "The village"
    });

    /* The scene is laid out for the shape of the space it is given, so it is
     * redrawn when that shape changes rather than letterboxed into it. */
    var lastKey = "";
    function fit() {
      var box = svg.getBoundingClientRect();
      var w = box.width || 1000, h = box.height || 620;
      var VH = Math.max(380, Math.min(1600, Math.round(VW * (h / Math.max(1, w)))));
      var key = VH + ":" + houses.length + ":" + view.code + ":" + view.phase;
      if (key === lastKey) return;
      lastKey = key;
      svg.setAttribute("viewBox", "0 0 " + VW + " " + VH);
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      paint(svg, view, houses, VH, opts);
    }
    if (global.ResizeObserver) new ResizeObserver(fit).observe(svg);
    else global.addEventListener("resize", fit);

    svg.setAttribute("viewBox", "0 0 " + VW + " 620");
    paint(svg, view, houses, 620, opts);
    setTimeout(fit, 0);
    return svg;
  }

  function playerOf(view, id) {
    var list = view.players || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  WG.village = { render: render, layout: layout, unitFor: unitFor, VW: VW };
})(typeof window !== "undefined" ? window : globalThis);

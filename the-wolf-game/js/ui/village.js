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
   * Where every house stands. Bands are laid across the valley and gently
   * bowed, so a row of houses follows the ground rather than a ruled line, and
   * each is nudged off its slot so nothing is evenly spaced.
   */
  function layout(n, VH, seed) {
    var rnd = rng(seed);
    var counts = spread(n);
    var unit = unitFor(n);
    var out = [], idx = 0;

    counts.forEach(function (count, b) {
      if (!count) return;
      var band = BANDS[b];
      var scale = band.scale * unit;
      var margin = 66 * scale + 26;
      var left = margin, right = VW - margin;
      var step = (right - left) / Math.max(1, count);
      for (var i = 0; i < count; i++) {
        var t = count === 1 ? 0.5 : (i + 0.5) / count;
        var x = left + step * i + step * 0.5 + (rnd() - 0.5) * step * 0.42;
        // The band sags in the middle: the valley floor, not a shelf.
        var bow = Math.sin(t * Math.PI) * VH * 0.035;
        var y = band.y * VH + bow + (rnd() - 0.5) * VH * 0.022;
        out.push({
          x: Math.max(margin, Math.min(VW - margin, x)),
          y: y,
          scale: scale * (0.94 + rnd() * 0.12),
          band: b,
          flip: rnd() < 0.42,
          i: idx++
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
  function tree(x, y, s, kind) {
    var g = el("g", { class: "ln-tree", transform: "translate(" + n2(x) + "," + n2(y) + ") scale(" + n2(s) + ")" });
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
    return g;
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

  /* ---------------- one house ---------------- */

  function house(spot, h, p, opts) {
    var s = spot.scale;
    var w = 88 * s, roof = 42 * s, wall = 58 * s;
    var dead = !h.occupantAlive;
    var fresh = h.state === "dead-tonight";

    var cls = ["hs"];
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

    g.appendChild(el("ellipse", { class: "hs-shadow", cx: 2 * s, cy: 3 * s, rx: w * 0.62, ry: 8 * s }));

    // Smoke, before the house, so it rises behind the roof.
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
    // A gable end, so the house has a corner and reads as a solid.
    body.appendChild(el("path", {
      class: "hs-gable",
      d: "M" + n2(w / 2) + " 0 L" + n2(w / 2) + " " + n2(-wall) +
         " L" + n2(w / 2 + 16 * s) + " " + n2(-wall + 6 * s) + " L" + n2(w / 2 + 16 * s) + " " + n2(6 * s) + " Z"
    }));
    body.appendChild(el("path", {
      class: "hs-roof",
      d: "M" + n2(-w / 2 - 9 * s) + " " + n2(-wall) + " L0 " + n2(-wall - roof) +
         " L" + n2(w / 2 + 9 * s) + " " + n2(-wall) + " Z"
    }));
    body.appendChild(el("path", {
      class: "hs-roof-side",
      d: "M" + n2(w / 2 + 9 * s) + " " + n2(-wall) + " L0 " + n2(-wall - roof) +
         " L" + n2(11 * s) + " " + n2(-wall - roof + 5 * s) +
         " L" + n2(w / 2 + 22 * s) + " " + n2(-wall + 5 * s) + " Z"
    }));
    body.appendChild(el("path", {
      class: "hs-roof",
      d: "M" + n2(-w * 0.30) + " " + n2(-wall - roof * 0.52) + " h" + n2(11 * s) +
         " v" + n2(-15 * s) + " h" + n2(-11 * s) + " z"
    }));

    body.appendChild(el("rect", {
      class: "hs-window", x: n2(-20 * s), y: n2(-wall + 11 * s), width: n2(17 * s), height: n2(20 * s), rx: n2(2 * s)
    }));
    body.appendChild(el("rect", {
      class: "hs-window", x: n2(1 * s), y: n2(-wall + 11 * s), width: n2(17 * s), height: n2(20 * s), rx: n2(2 * s)
    }));
    body.appendChild(el("path", {
      class: "hs-mullion",
      d: "M" + n2(-20 * s) + " " + n2(-wall + 20 * s) + " h" + n2(17 * s) +
         " M" + n2(1 * s) + " " + n2(-wall + 20 * s) + " h" + n2(17 * s)
    }));

    if (fresh) {
      body.appendChild(el("rect", {
        class: "hs-doorway", x: n2(-9 * s), y: n2(-30 * s), width: n2(18 * s), height: n2(30 * s), rx: n2(2 * s)
      }));
      body.appendChild(el("path", {
        class: "hs-door open",
        d: "M" + n2(9 * s) + " 0 v" + n2(-30 * s) + " l" + n2(12 * s) + " " + n2(-5 * s) + " v" + n2(35 * s) + " z"
      }));
    } else {
      body.appendChild(el("rect", {
        class: "hs-door", x: n2(-9 * s), y: n2(-30 * s), width: n2(18 * s), height: n2(30 * s), rx: n2(2 * s)
      }));
    }
    g.appendChild(body);

    if (!dead) g.appendChild(el("ellipse", { class: "hs-spill", cx: 0, cy: 4 * s, rx: w * 0.58, ry: 11 * s }));

    if (fresh) {
      g.appendChild(el("path", {
        class: "hs-smear",
        d: "M" + n2(-23 * s) + " " + n2(-33 * s) +
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

    g.appendChild(el("text", { class: "hs-name", x: 0, y: n2(21 * s), "text-anchor": "middle" }, [txt(p.name)]));
    if (opts.subtitle) {
      var sub = opts.subtitle(h, p);
      if (sub) g.appendChild(el("text", { class: "hs-sub", x: 0, y: n2(34 * s), "text-anchor": "middle" }, [txt(sub)]));
    }
    return g;
  }

  /* ---------------- the scene ---------------- */

  function paint(svg, view, houses, VH, opts) {
    var seed = seedOf(view.code);
    var rnd = rng(seed);
    var spots = layout(houses.length, VH, seed);
    var night = view.phase === "night" || view.phase === "verdict" || view.phase === "role_reveal";
    svg.setAttribute("class", "village-svg" + (night ? " night" : ""));

    /* --- the land, back to front, with mist in the gaps --- */
    svg.appendChild(ridge(rnd, VH, 0.20, 0.05, "ln-field far"));
    svg.appendChild(el("rect", { class: "ln-mist", x: -20, y: n2(VH * 0.17), width: VW + 40, height: n2(VH * 0.10) }));
    svg.appendChild(ridge(rnd, VH, 0.36, 0.06, "ln-field mid"));

    /* --- the river, and the ford the road crosses at --- */
    var rx0 = VW * (0.06 + rnd() * 0.1);
    var river = "M" + n2(-30) + " " + n2(VH * 0.415) +
      " C" + n2(VW * 0.26) + " " + n2(VH * 0.36) + " " + n2(VW * 0.36) + " " + n2(VH * 0.52) + " " + n2(VW * 0.55) + " " + n2(VH * 0.49) +
      " C" + n2(VW * 0.76) + " " + n2(VH * 0.46) + " " + n2(VW * 0.86) + " " + n2(VH * 0.60) + " " + n2(VW + 30) + " " + n2(VH * 0.55);
    svg.appendChild(el("path", { class: "ln-river-bank", d: river }));
    svg.appendChild(el("path", { class: "ln-river", d: river }));
    svg.appendChild(el("path", { class: "ln-river-glint", d: river }));

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

    /* --- the road: up out of the ford, through the square, off the bottom --- */
    var square = { x: VW * (0.46 + rnd() * 0.08), y: VH * 0.735 };
    var road = "M" + n2(VW * 0.30) + " " + n2(VH * 0.47) +
      " C" + n2(VW * 0.34) + " " + n2(VH * 0.58) + " " + n2(square.x - VW * 0.18) + " " + n2(square.y - VH * 0.06) + " " + n2(square.x) + " " + n2(square.y) +
      " C" + n2(square.x + VW * 0.16) + " " + n2(square.y + VH * 0.06) + " " + n2(VW * 0.70) + " " + n2(VH * 0.90) + " " + n2(VW * 0.76) + " " + n2(VH + 30);
    svg.appendChild(el("path", { class: "ln-road-edge", d: road }));
    svg.appendChild(el("path", { class: "ln-road", d: road }));

    // The bridge, where the road meets the water.
    var bx = VW * 0.31, by = VH * 0.455;
    var bridge = el("g", { class: "ln-bridge", transform: "translate(" + n2(bx) + "," + n2(by) + ")" });
    bridge.appendChild(el("path", { class: "deck", d: "M-42 0 h84" }));
    bridge.appendChild(el("path", { class: "rail", d: "M-40 -11 h80 M-40 -4 h80" }));
    for (var bp = -40; bp <= 40; bp += 20) bridge.appendChild(el("path", { class: "post", d: "M" + bp + " 1 v-13" }));
    svg.appendChild(bridge);

    /* --- fields and hedgerows --- */
    svg.appendChild(fence(VW * 0.04, VH * 0.60, VW * 0.26, VH * 0.575, 6));
    svg.appendChild(fence(VW * 0.74, VH * 0.585, VW * 0.97, VH * 0.615, 6));

    /* --- woods: thick at the back, thinning as the valley opens --- */
    var taken = spots.map(function (sp) { return { x: sp.x, y: sp.y, r: 92 * sp.scale }; });
    taken.push({ x: square.x, y: square.y, r: 130 });
    function clear(x, y, r) {
      for (var i = 0; i < taken.length; i++) {
        var t = taken[i];
        var dx = (x - t.x) / (t.r + r), dy = (y - t.y) / ((t.r + r) * 0.55);
        if (dx * dx + dy * dy < 1) return false;
      }
      // Never on the water or the road.
      if (Math.abs(y - (VH * 0.415 + (x / VW) * VH * 0.14)) < VH * 0.035) return false;
      return true;
    }
    var trees = [];
    for (var a = 0; a < 130; a++) {
      var tx = rnd() * VW, ty = VH * (0.30 + Math.pow(rnd(), 0.75) * 0.66);
      if (!clear(tx, ty, 26)) continue;
      var depth = ty / VH;
      var ts = (0.30 + depth * 1.05) * (0.8 + rnd() * 0.45);
      // Bare trees only in the far woods, where they read as depth
      // rather than as a broken drawing.
      var kind = rnd() < 0.55 ? "conifer" : (depth < 0.45 && rnd() < 0.16) ? "bare" : "broadleaf";
      trees.push({ x: tx, y: ty, s: ts, kind: kind });
      taken.push({ x: tx, y: ty, r: 16 * ts });
      if (trees.length > 46) break;
    }

    /* --- everything from here is depth-sorted together, so a tree can stand
     *     in front of a far house and behind a near one --- */
    var props = trees.map(function (t) {
      return { y: t.y, node: function () { return tree(t.x, t.y, t.s, t.kind); } };
    });

    // The square: a well, a fire, and the ground worn bare around them.
    props.push({ y: square.y + 1, node: function () {
      var g = el("g", { class: "ln-square", transform: "translate(" + n2(square.x) + "," + n2(square.y) + ")" });
      g.appendChild(el("ellipse", { class: "ln-clearing", cx: 0, cy: 0, rx: 118, ry: 40 }));
      g.appendChild(el("circle", { class: "ln-fire-glow", cx: -6, cy: -4, r: 66 }));
      g.appendChild(el("path", { class: "ln-logs", d: "M-24 4 L22 -6 M-24 -6 L22 4" }));
      g.appendChild(el("path", {
        class: "ln-flame",
        d: "M-4 -36 C6 -24 12 -15 12 -7 C12 3 5 9 -4 9 C-13 9 -20 3 -20 -7 C-20 -15 -14 -24 -4 -36 Z"
      }));
      // The well, off to one side of the fire.
      g.appendChild(el("path", { class: "ln-well", d: "M44 4 h34 v-16 h-34 z" }));
      g.appendChild(el("path", { class: "ln-well-frame", d: "M46 -12 v-20 h30 v20 M42 -32 h38 l-6 -9 h-26 z" }));
      return g;
    } });

    // A few boulders on the near slope, for texture.
    for (var b2 = 0; b2 < 7; b2++) {
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

    // Footpaths to doors you have already been to tonight.
    houses.forEach(function (h, i) {
      if (!h.visited) return;
      var sp = spots.filter(function (x) { return x.i === i; })[0];
      if (!sp) return;
      svg.appendChild(el("path", {
        class: "ln-track",
        d: "M" + n2(square.x) + " " + n2(square.y) +
           " Q" + n2((square.x + sp.x) / 2 + 30) + " " + n2((square.y + sp.y) / 2) + " " + n2(sp.x) + " " + n2(sp.y + 3)
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

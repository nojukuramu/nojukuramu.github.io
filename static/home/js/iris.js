/* ============================================================
   nojukuramu — the iris

   One aperture, used twice: full screen for the intro, and behind the
   glass of the lens, where it closes and opens between projects.

   It is drawn as geometry, not as nine images turned about a pin. The
   opening is a regular polygon; continue each of its sides past the
   corner until it meets the rim, and those N rays cut the ring outside
   the polygon into N identical pieces, each one a blade. A blade is
   therefore the same shape every time, only turned, so it is computed
   once a frame and every other blade is a <use> of it — which also lets a
   gradient laid across the first blade follow each copy round.

   At an opening of zero the polygon is a point and the blades are nine
   pie slices meeting in the middle: shut. Opened up past the rim they
   would no longer meet it, so the opening is kept just inside.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var SVG = "http://www.w3.org/2000/svg";
  var TAU = Math.PI * 2;
  var made = 0;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function node(name, attrs, parent) {
    var n = document.createElementNS(SVG, name);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function f(v) { return Math.round(v * 100) / 100; }

  /* Where a ray from p (inside the circle) along unit d leaves it. */
  function exit(px, py, dx, dy, R) {
    var b = px * dx + py * dy, c = px * px + py * py - R * R;
    var s = -b + Math.sqrt(Math.max(0, b * b - c));
    return [px + dx * s, py + dy * s];
  }

  /* svg: an empty svg element. Its viewBox is set here, centred on the origin.
     opts: { blades: 9, radius: 100, tone: "lens" | "intro" } */
  function create(svg, opts) {
    opts = opts || {};
    var N = opts.blades || 9;
    var R = opts.radius || 100;
    var id = "iris" + (++made);
    var step = TAU / N;

    svg.setAttribute("viewBox", [-R, -R, R * 2, R * 2].join(" "));
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var defs = node("defs", {}, svg);
    /* Laid across the first blade, from its trailing seam to its leading
       one: each plate is lit along the edge that sits on top of the next,
       which is what makes nine identical pieces read as overlapping. */
    var lin = node("linearGradient", { id: id + "-g", gradientUnits: "userSpaceOnUse",
                                       x1: f(R * Math.cos(-step * 0.2)), y1: f(R * Math.sin(-step * 0.2)),
                                       x2: f(R * Math.cos(step * 1.1)), y2: f(R * Math.sin(step * 1.1)) }, defs);
    var stops = opts.tone === "intro"
      ? [["0", "#050506"], [".55", "#141518"], [".86", "#26282d"], ["1", "#3a3d43"]]
      : [["0", "#040405"], [".55", "#111214"], [".86", "#202226"], ["1", "#34373c"]];
    stops.forEach(function (s) { node("stop", { offset: s[0], "stop-color": s[1] }, lin); });
    /* and the whole fan is darker toward the middle, where no light gets */
    var rad = node("radialGradient", { id: id + "-r", gradientUnits: "userSpaceOnUse", cx: 0, cy: 0, r: R }, defs);
    node("stop", { offset: "0", "stop-color": "#000", "stop-opacity": ".7" }, rad);
    node("stop", { offset: ".5", "stop-color": "#000", "stop-opacity": ".15" }, rad);
    node("stop", { offset: "1", "stop-color": "#000", "stop-opacity": ".35" }, rad);
    var clip = node("clipPath", { id: id + "-c" }, defs);
    node("circle", { cx: 0, cy: 0, r: R }, clip);

    var blade = node("g", { id: id + "-b" }, defs);
    var body = node("path", { fill: "url(#" + id + "-g)" }, blade);
    var edge = node("path", { fill: "none", stroke: "rgba(255,255,255,.16)", "stroke-width": f(R * 0.006),
                              "stroke-linecap": "round" }, blade);

    var fan = node("g", { "clip-path": "url(#" + id + "-c)" }, svg);
    for (var k = 0; k < N; k++) {
      var u = node("use", { transform: "rotate(" + f(k * 360 / N) + ")" }, fan);
      u.setAttribute("href", "#" + id + "-b");
      u.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#" + id + "-b");
    }
    node("circle", { cx: 0, cy: 0, r: R, fill: "url(#" + id + "-r)", "pointer-events": "none",
                     class: "iris-shade" }, fan);

    var lastOpen = -1, lastTurn = 0;

    /* open: 0 (shut) .. 1 (the polygon's sides touch the rim)
       turn: radians the polygon is turned by; blades swing as they close */
    function set(open, turn) {
      open = clamp(open, 0, 0.985);
      turn = turn || 0;
      if (Math.abs(open - lastOpen) < 0.0005 && Math.abs(turn - lastTurn) < 0.0005) return;
      lastOpen = open; lastTurn = turn;
      svg.style.visibility = open >= 0.985 && opts.hideOpen ? "hidden" : "";

      var c = (open * R) / Math.cos(step / 2);        /* circumradius of the opening */
      var a0 = turn, a1 = turn + step;
      var v0x = c * Math.cos(a0), v0y = c * Math.sin(a0);
      var v1x = c * Math.cos(a1), v1y = c * Math.sin(a1);
      /* the sides' directions, known exactly even when the polygon is a point */
      var d0 = a0 + step / 2 + Math.PI / 2;           /* side 0: v0 → v1 */
      var dm = a0 - step / 2 + Math.PI / 2;           /* side -1, arriving at v0 */
      var Rr = R * 1.02;
      var e0 = exit(v1x, v1y, Math.cos(d0), Math.sin(d0), Rr);
      var em = exit(v0x, v0y, Math.cos(dm), Math.sin(dm), Rr);
      body.setAttribute("d",
        "M" + f(v0x) + " " + f(v0y) +
        "L" + f(v1x) + " " + f(v1y) +
        "L" + f(e0[0]) + " " + f(e0[1]) +
        "A" + f(Rr) + " " + f(Rr) + " 0 0 0 " + f(em[0]) + " " + f(em[1]) + "Z");
      /* the seam this blade lays over its neighbour */
      edge.setAttribute("d", "M" + f(v0x) + " " + f(v0y) + "L" + f(v1x) + " " + f(v1y) +
                             "L" + f(e0[0]) + " " + f(e0[1]));
    }

    set(0, 0);
    return { set: set, radius: R, blades: N };
  }

  NJ.iris = { create: create };
})(window);

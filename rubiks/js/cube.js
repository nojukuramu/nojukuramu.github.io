/* Rubiks — NxN cube model and scramble preview
 *
 * Every sticker is a point in space rather than an index into a face array.
 * A turn is then one rotation applied to every sticker in the turning layers,
 * which is the same eight lines for a 2x2 and a 7x7, wide turns included.
 * Face-array implementations need a hand-written cycle table per move and per
 * size, and that table is where the bugs live.
 *
 * Coordinates are odd integers: on an NxN, a sticker on the U face sits at
 * y = N, and its x and z run -(N-1) .. N-1 in steps of 2.
 *
 * Orientation is the WCA one: white on top, green in front. */
"use strict";

var RK = RK || {};

RK.cube = (function () {
  var FACES = ["U", "R", "F", "D", "L", "B"];
  var AXIS = { U: [0, 1, 0], D: [0, -1, 0], R: [1, 0, 0], L: [-1, 0, 0], F: [0, 0, 1], B: [0, 0, -1] };
  var COLOR = { U: "#f4f4f2", R: "#e0312b", F: "#1fa34a", D: "#f7d21c", L: "#f7811d", B: "#2563eb" };

  /* Where sticker (row, col) of each face sits, as the face is drawn in the
     net: U above F, then L F R B in a row, D below F. */
  function place(face, n, r, c) {
    var a = -(n - 1) + 2 * c, b = (n - 1) - 2 * r;
    switch (face) {
      case "U": return [a, n, -(n - 1) + 2 * r];
      case "D": return [a, -n, b];
      case "F": return [a, b, n];
      case "B": return [-a, b, -n];
      case "R": return [n, b, -a];
      case "L": return [-n, b, a];
    }
  }

  function solved(n) {
    var st = [];
    FACES.forEach(function (f) {
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) st.push({ p: place(f, n, r, c), c: f });
    });
    return { n: n, st: st };
  }

  /* Clockwise as seen from the face is -90 degrees about its outward axis:
     v' = a(a.v) - (a x v). */
  function rot(v, a) {
    var d = a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
    var cx = a[1] * v[2] - a[2] * v[1], cy = a[2] * v[0] - a[0] * v[2], cz = a[0] * v[1] - a[1] * v[0];
    return [a[0] * d - cx, a[1] * d - cy, a[2] * d - cz];
  }

  var MOVE = /^(\d*)([URFDLB])(w?)(['2]?)$/;

  function parse(tok) {
    var m = MOVE.exec(tok);
    if (!m) return null;
    var depth = m[1] ? parseInt(m[1], 10) : (m[3] ? 2 : 1);
    return { face: m[2], depth: depth, turns: m[4] === "2" ? 2 : m[4] === "'" ? 3 : 1 };
  }

  function turn(cube, mv) {
    var a = AXIS[mv.face], thr = cube.n + 1 - 2 * mv.depth;
    for (var i = 0; i < cube.st.length; i++) {
      var s = cube.st[i], p = s.p;
      if (a[0] * p[0] + a[1] * p[1] + a[2] * p[2] < thr) continue;
      for (var k = 0; k < mv.turns; k++) p = rot(p, a);
      s.p = p;
    }
    return cube;
  }

  function apply(cube, alg) {
    String(alg || "").split(/\s+/).forEach(function (tok) {
      var mv = tok && parse(tok);
      if (mv) turn(cube, mv);
    });
    return cube;
  }

  /* The six faces as rows of colour letters, in net order. */
  function faces(cube) {
    var n = cube.n, at = {};
    cube.st.forEach(function (s) { at[s.p.join(",")] = s.c; });
    var out = {};
    FACES.forEach(function (f) {
      var rows = [];
      for (var r = 0; r < n; r++) {
        var row = [];
        for (var c = 0; c < n; c++) row.push(at[place(f, n, r, c).join(",")]);
        rows.push(row);
      }
      out[f] = rows;
    });
    return out;
  }

  function isSolved(cube) {
    var fs = faces(cube);
    return FACES.every(function (f) {
      var first = fs[f][0][0];
      return fs[f].every(function (row) { return row.every(function (x) { return x === first; }); });
    });
  }

  /* The net as one SVG. Each face is a 1x1 unit tile with a hairline gap so
     it reads as a cube net at 90px wide and at 400px. */
  function svg(n, alg) {
    var fs = faces(apply(solved(n), alg));
    var POS = { U: [1, 0], L: [0, 1], F: [1, 1], R: [2, 1], B: [3, 1], D: [1, 2] };
    var gap = 0.06, cell = (1 - gap) / n, pad = cell * 0.06;
    var rr = Math.min(0.04, cell * 0.18);
    var h = "";
    FACES.forEach(function (f) {
      var ox = POS[f][0] + gap / 2, oy = POS[f][1] + gap / 2;
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
        h += '<rect x="' + (ox + c * cell + pad).toFixed(4) + '" y="' + (oy + r * cell + pad).toFixed(4) +
          '" width="' + (cell - 2 * pad).toFixed(4) + '" height="' + (cell - 2 * pad).toFixed(4) +
          '" rx="' + rr.toFixed(4) + '" fill="' + COLOR[fs[f][r][c]] + '" stroke="rgba(0,0,0,.28)" stroke-width="' + (cell * 0.05).toFixed(4) + '"/>';
      }
    });
    return '<svg viewBox="0 0 4 3" role="img" aria-label="Scrambled cube, unfolded">' + h + "</svg>";
  }

  return { solved: solved, apply: apply, parse: parse, faces: faces, isSolved: isSolved, svg: svg, COLOR: COLOR };
})();

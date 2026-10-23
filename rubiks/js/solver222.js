/* Rubiks — random-state 2x2 scrambles
 *
 * A random-move scramble leaves some states far likelier than others; the WCA
 * scrambles 2x2 by picking a state uniformly and solving it, and so does this.
 * The 2x2 is small enough to do that in a page: 7! corner permutations times
 * 3^6 twists, searched with IDA* over two tiny pruning tables (5040 and 729
 * entries) built on first use. A solve takes a few milliseconds.
 *
 * The DBL corner never moves, so U, R and F reach every state and the cube
 * never needs a rotation. Corner order and move definitions are Kociemba's. */
"use strict";

var RK = RK || {};

RK.solver222 = (function () {
  /* URF UFL ULB UBR DFR DLF DBL DRB */
  var MOVES = [
    { cp: [3, 0, 1, 2, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0] }, // U
    { cp: [4, 1, 2, 0, 7, 5, 6, 3], co: [2, 0, 0, 1, 1, 0, 0, 2] }, // R
    { cp: [1, 5, 2, 3, 0, 4, 6, 7], co: [1, 2, 0, 0, 2, 1, 0, 0] }  // F
  ];
  var NAMES = ["U", "U2", "U'", "R", "R2", "R'", "F", "F2", "F'"];
  var FREE = [0, 1, 2, 3, 4, 5, 7]; // every position but DBL
  var NP = 5040, NO = 729;

  var permMove = null, oriMove = null, permDist = null, oriDist = null;

  function mul(s, m) {
    var cp = [], co = [];
    for (var i = 0; i < 8; i++) { cp[i] = s.cp[m.cp[i]]; co[i] = (s.co[m.cp[i]] + m.co[i]) % 3; }
    return { cp: cp, co: co };
  }

  function encPerm(cp) {
    var q = FREE.map(function (p) { return FREE.indexOf(cp[p]); }), idx = 0;
    for (var i = 0; i < 7; i++) {
      var smaller = 0;
      for (var j = i + 1; j < 7; j++) if (q[j] < q[i]) smaller++;
      idx = idx * (7 - i) + smaller;
    }
    return idx;
  }

  function decPerm(idx) {
    var lehmer = [];
    for (var i = 6; i >= 0; i--) { lehmer[i] = idx % (7 - i); idx = Math.floor(idx / (7 - i)); }
    var pool = [0, 1, 2, 3, 4, 5, 6], cp = [0, 1, 2, 3, 4, 5, 6, 7];
    for (var k = 0; k < 7; k++) cp[FREE[k]] = FREE[pool.splice(lehmer[k], 1)[0]];
    return cp;
  }

  function encOri(co) {
    var idx = 0;
    for (var i = 0; i < 6; i++) idx = idx * 3 + co[FREE[i]];
    return idx;
  }

  function decOri(idx) {
    var co = [0, 0, 0, 0, 0, 0, 0, 0], sum = 0;
    for (var i = 5; i >= 0; i--) { co[FREE[i]] = idx % 3; sum += idx % 3; idx = Math.floor(idx / 3); }
    co[7] = (3 - sum % 3) % 3;
    return co;
  }

  function table(size, step) {
    var t = [];
    for (var i = 0; i < size; i++) {
      var row = [];
      for (var f = 0; f < 3; f++) {
        var x = i;
        for (var p = 0; p < 3; p++) { x = step(x, MOVES[f]); row.push(x); }
      }
      t.push(row);
    }
    return t;
  }

  function prune(size, mv) {
    var d = new Int8Array(size).fill(-1), frontier = [0], depth = 0;
    d[0] = 0;
    while (frontier.length) {
      var next = [];
      for (var i = 0; i < frontier.length; i++) for (var m = 0; m < 9; m++) {
        var y = mv[frontier[i]][m];
        if (d[y] < 0) { d[y] = depth + 1; next.push(y); }
      }
      frontier = next; depth++;
    }
    return d;
  }

  function init() {
    if (permMove) return;
    var ID = [0, 0, 0, 0, 0, 0, 0, 0];
    permMove = table(NP, function (x, m) { return encPerm(mul({ cp: decPerm(x), co: ID }, m).cp); });
    oriMove = table(NO, function (x, m) { return encOri(mul({ cp: [0, 1, 2, 3, 4, 5, 6, 7], co: decOri(x) }, m).co); });
    permDist = prune(NP, permMove);
    oriDist = prune(NO, oriMove);
  }

  function search(p, o, depth, last, path) {
    var h = Math.max(permDist[p], oriDist[o]);
    if (h > depth) return false;
    if (depth === 0) return p === 0 && o === 0;
    for (var m = 0; m < 9; m++) {
      var f = (m / 3) | 0;
      if (f === last) continue;
      path.push(m);
      if (search(permMove[p][m], oriMove[o][m], depth - 1, f, path)) return true;
      path.pop();
    }
    return false;
  }

  function solve(p, o) {
    init();
    for (var depth = 0; depth <= 11; depth++) {
      var path = [];
      if (search(p, o, depth, -1, path)) return path;
    }
    return null;
  }

  function invert(m) { return (m - m % 3) + (2 - m % 3); }

  /* WCA filters out states that are fewer than four moves from solved. */
  function scramble(rand) {
    rand = rand || Math.random;
    for (;;) {
      var sol = solve(Math.floor(rand() * NP), Math.floor(rand() * NO));
      if (sol && sol.length >= 4) return sol.slice().reverse().map(function (m) { return NAMES[invert(m)]; });
    }
  }

  /* For the validator: the state a move sequence leaves, and its solution. */
  function stateOf(names) {
    var s = { cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0] };
    names.forEach(function (n) {
      var i = NAMES.indexOf(n);
      for (var k = 0; k <= i % 3; k++) s = mul(s, MOVES[(i / 3) | 0]);
    });
    return { p: encPerm(s.cp), o: encOri(s.co) };
  }

  return {
    scramble: scramble,
    solve: function (p, o) { return (solve(p, o) || []).map(function (m) { return NAMES[m]; }); },
    stateOf: stateOf
  };
})();

/* Rubiks — events and their scrambles
 *
 * 2x2 is random-state (solver222.js), as the WCA does it. Bigger cubes are
 * random-move, the lengths csTimer uses: a random-state 3x3 needs a two-phase
 * solver that would outweigh the rest of this app, and for practice the
 * difference is not one a solver can feel.
 *
 * Event ids 2x2, 3x3 and 4x4 are the storage keys from v1; keep them. */
"use strict";

var RK = RK || {};

RK.scramble = (function () {
  var MODS = ["", "'", "2"];
  var AXIS_OF = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
  var FACES = ["U", "D", "R", "L", "F", "B"];

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  /* Random-move NxN. Turns on one axis commute, so within a run on the same
     axis no (face, depth) may repeat: that is what forbids R R and R L R
     without forbidding R L. */
  function nxn(n, len) {
    var maxDepth = Math.floor(n / 2), out = [], axis = -1, used = {};
    while (out.length < len) {
      var face = pick(FACES), depth = 1 + Math.floor(Math.random() * maxDepth);
      if (n === 3 || n === 2) depth = 1;
      var key = face + depth;
      if (AXIS_OF[face] === axis && used[key]) continue;
      if (AXIS_OF[face] !== axis) { axis = AXIS_OF[face]; used = {}; }
      used[key] = true;
      var name = depth === 1 ? face : (depth === 2 ? "" : depth) + face + "w";
      out.push(name + pick(MODS));
    }
    return out;
  }

  function pyraminx() {
    var out = [], prev = "";
    while (out.length < 11) {
      var f = pick(["U", "L", "R", "B"]);
      if (f === prev) continue;
      prev = f;
      out.push(f + pick(["", "'"]));
    }
    ["u", "l", "r", "b"].forEach(function (t) {
      var r = Math.floor(Math.random() * 3);
      if (r) out.push(t + (r === 2 ? "'" : ""));
    });
    return out;
  }

  function skewb() {
    var out = [], prev = "";
    while (out.length < 11) {
      var f = pick(["R", "U", "L", "B"]);
      if (f === prev) continue;
      prev = f;
      out.push(f + pick(["", "'"]));
    }
    return out;
  }

  /* Pochmann style, as the WCA scrambler wrote it: seven lines of ten
     R++/D-- turns, each line closed by U if its last D went ++, U' if --. */
  function megaminx() {
    var out = [];
    for (var line = 0; line < 7; line++) {
      var d = "";
      for (var i = 0; i < 10; i++) {
        d = Math.random() < 0.5 ? "++" : "--";
        out.push((i % 2 ? "D" : "R") + d);
      }
      out.push(d === "++" ? "U\n" : "U'\n");
    }
    return out;
  }

  var EVENTS = [
    { id: "3x3", name: "3x3x3", short: "3x3", n: 3, gen: function () { return nxn(3, 25); } },
    { id: "2x2", name: "2x2x2", short: "2x2", n: 2, gen: function () { return RK.solver222.scramble(); } },
    { id: "4x4", name: "4x4x4", short: "4x4", n: 4, gen: function () { return nxn(4, 40); } },
    { id: "5x5", name: "5x5x5", short: "5x5", n: 5, gen: function () { return nxn(5, 60); } },
    { id: "6x6", name: "6x6x6", short: "6x6", n: 6, gen: function () { return nxn(6, 80); } },
    { id: "7x7", name: "7x7x7", short: "7x7", n: 7, gen: function () { return nxn(7, 100); } },
    { id: "oh", name: "3x3 One-Handed", short: "OH", n: 3, gen: function () { return nxn(3, 25); } },
    { id: "pyra", name: "Pyraminx", short: "Pyra", n: 0, gen: pyraminx },
    { id: "skewb", name: "Skewb", short: "Skewb", n: 0, gen: skewb },
    { id: "mega", name: "Megaminx", short: "Mega", n: 0, gen: megaminx }
  ];

  function event(id) {
    for (var i = 0; i < EVENTS.length; i++) if (EVENTS[i].id === id) return EVENTS[i];
    return EVENTS[0];
  }

  return {
    EVENTS: EVENTS,
    event: event,
    generate: function (id) { return event(id).gen(); },
    /* Megaminx carries its own line breaks; everything else is one line. */
    format: function (moves) { return moves.join(" ").replace(/\n /g, "\n").trim(); }
  };
})();

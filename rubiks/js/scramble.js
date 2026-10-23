/* Rubiks — scramble generator
   Generates random-state-approximating scrambles for standard WCA puzzles. */
"use strict";

var RK = RK || {};

RK.scramble = (function () {
  var FACES_3 = ["U", "D", "R", "L", "F", "B"];
  var MODS = ["", "'", "2"];
  var OPPOSITE = { U: "D", D: "U", R: "L", L: "R", F: "B", B: "F" };

  /* WCA scrambles are 20 random moves with no two consecutive moves on the
     same face and no three consecutive moves on the same axis. */
  function generate3x3(len) {
    len = len || 20;
    var moves = [];
    var prev = "", prevPrev = "";
    for (var i = 0; i < len; i++) {
      var pool = FACES_3.filter(function (f) {
        if (f === prev) return false;
        if (f === prevPrev && OPPOSITE[f] === prev) return false;
        return true;
      });
      var face = pool[Math.floor(Math.random() * pool.length)];
      var mod = MODS[Math.floor(Math.random() * MODS.length)];
      moves.push(face + mod);
      prevPrev = prev;
      prev = face;
    }
    return moves;
  }

  function generate2x2() {
    var faces = ["U", "R", "F"];
    var moves = [];
    var prev = "";
    for (var i = 0; i < 11; i++) {
      var pool = faces.filter(function (f) { return f !== prev; });
      var face = pool[Math.floor(Math.random() * pool.length)];
      var mod = MODS[Math.floor(Math.random() * MODS.length)];
      moves.push(face + mod);
      prev = face;
    }
    return moves;
  }

  function generate4x4() {
    var faces = ["U", "D", "R", "L", "F", "B"];
    var wide = ["Uw", "Dw", "Rw", "Lw", "Fw", "Bw"];
    var moves = [];
    var prev = "";
    for (var i = 0; i < 44; i++) {
      var set = Math.random() < 0.35 ? wide : faces;
      var pool = set.filter(function (f) { return f[0] !== prev; });
      if (!pool.length) pool = set;
      var face = pool[Math.floor(Math.random() * pool.length)];
      var mod = MODS[Math.floor(Math.random() * MODS.length)];
      moves.push(face + mod);
      prev = face[0];
    }
    return moves;
  }

  return {
    generate: function (puzzle) {
      switch (puzzle) {
        case "2x2": return generate2x2();
        case "4x4": return generate4x4();
        default:    return generate3x3();
      }
    },
    format: function (moves) { return moves.join("  "); }
  };
})();

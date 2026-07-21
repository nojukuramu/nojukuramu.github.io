/* core.js — shared namespace + tiny utilities used by every module.
 * Loaded first so later scripts can attach to `Game` at parse time even
 * though the actual THREE scene/camera/renderer are only created once
 * main.js boots.
 */
(function (global) {
  "use strict";

  var Game = {
    CONFIG: {
      WORLD_SIZE: 400,      // terrain spans -200..200 on X/Z
      WATER_LEVEL: 1.2,
      MAX_HEIGHT: 46,
      MIN_HEIGHT: -14,
      CELL_SIZE: 8          // zoning/parcel grid resolution (world units)
    },
    scene: null,
    camera: null,
    renderer: null,
    clock: null,
    raycaster: null,
    mode: "normal",         // 'normal' | 'creative'
    tool: "select",
    paused: false,
    timeScale: 1,
    running: false
  };

  Game.util = {
    clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    smoothstep: function (a, b, x) {
      var t = Game.util.clamp((x - a) / (b - a), 0, 1);
      return t * t * (3 - 2 * t);
    },
    // deterministic PRNG (mulberry32) so seeded city layouts are reproducible
    mulberry32: function (seed) {
      return function () {
        seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
        var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    formatMoney: function (v) {
      var neg = v < 0; v = Math.abs(Math.round(v));
      var s = v.toLocaleString ? v.toLocaleString() : String(v);
      return (neg ? "-$" : "$") + s;
    },
    formatTime: function (hours) {
      var h = Math.floor(hours) % 24;
      var m = Math.floor((hours - Math.floor(hours)) * 60);
      return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
    }
  };

  global.Game = Game;
})(window);

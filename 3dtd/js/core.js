/* ============================================================
   VELL — core namespace, math, noise, grid, event bus
   ============================================================ */
(function (global) {
  'use strict';

  var TD = global.TD = {};

  /* ---------- constants ---------- */
  TD.GRID = 56;          // cells per side
  TD.CELL = 2.0;         // world units per cell
  TD.WORLD = TD.GRID * TD.CELL;
  TD.HALF = TD.WORLD * 0.5;
  TD.WATER_Y = 0.0;      // water plane height
  TD.DEEP_DEPTH = 1.05;  // below this depth water is deep (unwalkable)

  // cell kinds
  TD.G = {
    GROUND: 0,
    SHALLOW: 1,
    DEEP: 2,
    CLIFF: 3,
    PROP: 4,
    BASE: 5,
    SPAWN: 6
  };

  /* ---------- tiny event bus ---------- */
  var handlers = {};
  TD.bus = {
    on: function (evt, fn) { (handlers[evt] || (handlers[evt] = [])).push(fn); return fn; },
    off: function (evt, fn) {
      var a = handlers[evt]; if (!a) return;
      var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
    },
    emit: function (evt, data) {
      var a = handlers[evt]; if (!a) return;
      for (var i = 0; i < a.length; i++) { try { a[i](data); } catch (e) { console.warn(evt, e); } }
    }
  };

  /* ---------- math ---------- */
  var U = TD.util = {
    clamp: function (v, a, b) { return v < a ? a : (v > b ? b : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    smooth: function (t) { return t * t * (3 - 2 * t); },
    smoothstep: function (e0, e1, x) { var t = U.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); },
    mix3: function (out, a, b, t) { out.r = a.r + (b.r - a.r) * t; out.g = a.g + (b.g - a.g) * t; out.b = a.b + (b.b - a.b) * t; return out; },
    dampen: function (cur, target, lambda, dt) { return U.lerp(cur, target, 1 - Math.exp(-lambda * dt)); },
    fmt: function (n) {
      n = Math.floor(n);
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
      if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
      return String(n);
    },
    roman: function (n) {
      var m = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
      [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']], s = '';
      for (var i = 0; i < m.length; i++) while (n >= m[i][0]) { s += m[i][1]; n -= m[i][0]; }
      return s || 'O';
    }
  };

  /* ---------- colour: author in sRGB, render in linear ---------- */
  TD.C = function (hex) { return new THREE.Color(hex).convertSRGBToLinear(); };

  /* ---------- deterministic RNG (mulberry32) ---------- */
  TD.RNG = function (seed) {
    var s = (seed >>> 0) || 1;
    function next() {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next: next,
      range: function (a, b) { return a + next() * (b - a); },
      int: function (a, b) { return Math.floor(a + next() * (b - a + 1)); },
      pick: function (arr) { return arr[Math.floor(next() * arr.length) % arr.length]; },
      chance: function (p) { return next() < p; },
      sign: function () { return next() < 0.5 ? -1 : 1; }
    };
  };

  /* ---------- value noise + fbm ---------- */
  TD.Noise = function (seed) {
    var perm = new Uint8Array(512);
    var rng = TD.RNG(seed);
    var p = new Uint8Array(256);
    var i;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) { var j = rng.int(0, i); var t = p[i]; p[i] = p[j]; p[j] = t; }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];

    function grad(hash, x, y) {
      switch (hash & 3) {
        case 0: return x + y;
        case 1: return -x + y;
        case 2: return x - y;
        default: return -x - y;
      }
    }
    function noise2(x, y) {
      var X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
      var xf = x - Math.floor(x), yf = y - Math.floor(y);
      var u = U.smooth(xf), v = U.smooth(yf);
      var aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
      var ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
      var x1 = U.lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
      var x2 = U.lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
      return U.lerp(x1, x2, v) * 0.7; // ~[-1,1]
    }
    function fbm(x, y, oct, lac, gain) {
      oct = oct || 4; lac = lac || 2.0; gain = gain || 0.5;
      var amp = 1, freq = 1, sum = 0, norm = 0;
      for (var o = 0; o < oct; o++) {
        sum += noise2(x * freq, y * freq) * amp;
        norm += amp; amp *= gain; freq *= lac;
      }
      return sum / norm;
    }
    function ridge(x, y, oct) {
      var amp = 1, freq = 1, sum = 0, norm = 0;
      for (var o = 0; o < (oct || 4); o++) {
        var n = 1 - Math.abs(noise2(x * freq, y * freq));
        sum += n * n * amp; norm += amp; amp *= 0.5; freq *= 2.0;
      }
      return sum / norm;
    }
    return { noise2: noise2, fbm: fbm, ridge: ridge };
  };

  /* ---------- quality auto-detect ---------- */
  TD.detectQuality = function () {
    var mem = navigator.deviceMemory || 4;
    var cores = navigator.hardwareConcurrency || 4;
    var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    var px = Math.min(global.devicePixelRatio || 1, 2);
    var score = (mobile ? 0 : 2) + (mem >= 8 ? 2 : mem >= 4 ? 1 : 0) + (cores >= 8 ? 2 : cores >= 4 ? 1 : 0);
    if (score >= 5) return 'high';
    if (score >= 3) return 'medium';
    return 'low';
  };

  TD.QUALITY = {
    low: { shadows: false, shadowSize: 1024, reflection: false, particles: 600, pixelRatio: 1.0, fireflies: 40, propDensity: 0.7 },
    medium: { shadows: true, shadowSize: 1024, reflection: false, particles: 1400, pixelRatio: 1.35, fireflies: 90, propDensity: 0.9 },
    high: { shadows: true, shadowSize: 2048, reflection: true, particles: 2600, pixelRatio: 1.75, fireflies: 160, propDensity: 1.0 }
  };

  /* ---------- shared scratch ---------- */
  TD.state = {
    quality: 'medium',
    seed: 0,
    running: false,
    paused: false,
    speed: 1,
    time: 0,        // seconds since start (scaled)
    dayT: 0.28,     // 0..1 through the day
    sap: 0,
    wave: 0,
    waveActive: false,
    baseHP: 1000,
    baseHPMax: 1000,
    lives: 1,
    kills: 0,
    over: false,
    codex: {}
  };

  TD.idx = function (x, z) { return z * TD.GRID + x; };
  TD.inBounds = function (x, z) { return x >= 0 && z >= 0 && x < TD.GRID && z < TD.GRID; };
  TD.cellToWorldX = function (x) { return (x + 0.5) * TD.CELL - TD.HALF; };
  TD.cellToWorldZ = function (z) { return (z + 0.5) * TD.CELL - TD.HALF; };
  TD.worldToCellX = function (wx) { return Math.floor((wx + TD.HALF) / TD.CELL); };
  TD.worldToCellZ = function (wz) { return Math.floor((wz + TD.HALF) / TD.CELL); };

})(window);

/* ============================================================
   VELL — procedural canvas textures (no external assets)
   ============================================================ */
(function (TD) {
  'use strict';

  var cache = {};
  var tex = TD.tex = {};

  function canvas(size) {
    var c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }

  function make(key, size, draw, opts) {
    if (cache[key]) return cache[key];
    var c = canvas(size);
    draw(c.getContext('2d'), size);
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = (opts && opts.clamp) ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    t.anisotropy = 4;
    t.encoding = (opts && opts.linear) ? THREE.LinearEncoding : THREE.sRGBEncoding;
    if (opts && opts.nomip) { t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; }
    cache[key] = t;
    return t;
  }

  /* value-noise field helper on a canvas */
  function noiseField(ctx, size, cells, colorFn, alpha) {
    var rng = TD.RNG(cells * 7919 + size);
    var grid = new Float32Array((cells + 1) * (cells + 1));
    for (var i = 0; i < grid.length; i++) grid[i] = rng.next();
    var img = ctx.getImageData(0, 0, size, size);
    var d = img.data;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        var fx = x / size * cells, fy = y / size * cells;
        var x0 = Math.floor(fx), y0 = Math.floor(fy);
        var tx = TD.util.smooth(fx - x0), ty = TD.util.smooth(fy - y0);
        var a = grid[y0 * (cells + 1) + x0], b = grid[y0 * (cells + 1) + x0 + 1];
        var c2 = grid[(y0 + 1) * (cells + 1) + x0], dd = grid[(y0 + 1) * (cells + 1) + x0 + 1];
        var v = TD.util.lerp(TD.util.lerp(a, b, tx), TD.util.lerp(c2, dd, tx), ty);
        var o = (y * size + x) * 4;
        var col = colorFn(v, x, y);
        d[o] = TD.util.lerp(d[o], col[0], alpha);
        d[o + 1] = TD.util.lerp(d[o + 1], col[1], alpha);
        d[o + 2] = TD.util.lerp(d[o + 2], col[2], alpha);
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function speckle(ctx, size, n, colors, rmin, rmax, alpha) {
    var rng = TD.RNG(n + size);
    ctx.globalAlpha = alpha;
    for (var i = 0; i < n; i++) {
      var x = rng.next() * size, y = rng.next() * size;
      var r = rng.range(rmin, rmax);
      ctx.fillStyle = rng.pick(colors);
      ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- terrain layers ---------- */
  tex.moss = function () {
    return make('moss', 256, function (ctx, s) {
      ctx.fillStyle = '#3b5e34'; ctx.fillRect(0, 0, s, s);
      noiseField(ctx, s, 8, function (v) {
        var g = 70 + v * 70;
        return [34 + v * 26, g, 40 + v * 26];
      }, 0.85);
      noiseField(ctx, s, 26, function (v) { return [40 + v * 60, 80 + v * 70, 44 + v * 40]; }, 0.35);
      speckle(ctx, s, 260, ['#6f9a4e', '#88ad5c', '#2f4a2b', '#7fae6a'], 0.6, 2.6, 0.4);
      speckle(ctx, s, 60, ['#c7d98a', '#e0d27a'], 0.5, 1.4, 0.5); // tiny flowers
    });
  };

  tex.silt = function () {
    return make('silt', 256, function (ctx, s) {
      ctx.fillStyle = '#8a7a5c'; ctx.fillRect(0, 0, s, s);
      noiseField(ctx, s, 10, function (v) { return [130 + v * 60, 116 + v * 52, 88 + v * 44]; }, 0.9);
      noiseField(ctx, s, 40, function (v) { return [150 + v * 50, 138 + v * 40, 106 + v * 34]; }, 0.25);
      speckle(ctx, s, 400, ['#b9a882', '#6f6047', '#cbbb93'], 0.4, 1.8, 0.35);
    });
  };

  tex.stoneTex = function () {
    return make('stoneTex', 256, function (ctx, s) {
      ctx.fillStyle = '#6b6a68'; ctx.fillRect(0, 0, s, s);
      noiseField(ctx, s, 6, function (v) { return [86 + v * 62, 88 + v * 62, 92 + v * 60]; }, 0.9);
      noiseField(ctx, s, 22, function (v) { return [70 + v * 90, 72 + v * 88, 78 + v * 86]; }, 0.35);
      // fissures
      var rng = TD.RNG(4242);
      ctx.strokeStyle = 'rgba(40,42,46,0.55)';
      for (var i = 0; i < 26; i++) {
        ctx.lineWidth = rng.range(0.6, 2.2);
        ctx.beginPath();
        var x = rng.next() * s, y = rng.next() * s;
        ctx.moveTo(x, y);
        for (var k = 0; k < 5; k++) { x += rng.range(-30, 30); y += rng.range(-30, 30); ctx.lineTo(x, y); }
        ctx.stroke();
      }
      speckle(ctx, s, 120, ['#9aa08f', '#57604f'], 0.6, 2.4, 0.3); // lichen
    });
  };

  tex.bark = function () {
    return make('bark', 128, function (ctx, s) {
      ctx.fillStyle = '#4a3a2c'; ctx.fillRect(0, 0, s, s);
      var rng = TD.RNG(77);
      for (var i = 0; i < 70; i++) {
        ctx.strokeStyle = 'rgba(' + (30 + rng.next() * 60 | 0) + ',' + (24 + rng.next() * 44 | 0) + ',' + (18 + rng.next() * 30 | 0) + ',0.8)';
        ctx.lineWidth = rng.range(1, 4);
        var x = rng.next() * s;
        ctx.beginPath(); ctx.moveTo(x, 0);
        for (var y = 0; y < s; y += 12) { x += rng.range(-2.5, 2.5); ctx.lineTo(x, y); }
        ctx.stroke();
      }
      speckle(ctx, s, 40, ['#6b7f4a', '#7d8e55'], 1, 3, 0.25);
    });
  };

  tex.rust = function () {
    return make('rust', 128, function (ctx, s) {
      ctx.fillStyle = '#6a3a22'; ctx.fillRect(0, 0, s, s);
      noiseField(ctx, s, 7, function (v) { return [120 + v * 90, 60 + v * 50, 34 + v * 30]; }, 0.9);
      noiseField(ctx, s, 24, function (v) { return [150 + v * 70, 78 + v * 40, 40 + v * 24]; }, 0.3);
      speckle(ctx, s, 200, ['#3a2a24', '#8d4a26', '#c07038', '#2a1e1a'], 0.5, 2.4, 0.5);
    });
  };

  tex.metal = function () {
    return make('metal', 128, function (ctx, s) {
      ctx.fillStyle = '#4c5157'; ctx.fillRect(0, 0, s, s);
      noiseField(ctx, s, 5, function (v) { return [66 + v * 44, 70 + v * 44, 78 + v * 46]; }, 0.85);
      var rng = TD.RNG(9);
      ctx.globalAlpha = 0.35;
      for (var i = 0; i < 40; i++) {
        ctx.fillStyle = rng.chance(0.5) ? '#7d8794' : '#33383e';
        ctx.fillRect(0, rng.next() * s, s, rng.range(0.5, 2));
      }
      ctx.globalAlpha = 1;
      speckle(ctx, s, 90, ['#8a4a2a', '#6b3a20'], 0.6, 2.6, 0.35);
    });
  };

  /* ---------- water normal-ish ripple map ---------- */
  tex.ripple = function () {
    return make('ripple', 256, function (ctx, s) {
      var img = ctx.createImageData(s, s);
      var d = img.data;
      var n = TD.Noise(1337);
      for (var y = 0; y < s; y++) {
        for (var x = 0; x < s; x++) {
          var u = x / s * 6, v = y / s * 6;
          var e = 0.06;
          var c = n.fbm(u, v, 4);
          var gx = (n.fbm(u + e, v, 4) - n.fbm(u - e, v, 4));
          var gy = (n.fbm(u, v + e, 4) - n.fbm(u, v - e, 4));
          var o = (y * s + x) * 4;
          d[o] = 128 + gx * 900;
          d[o + 1] = 128 + gy * 900;
          d[o + 2] = 200 + c * 40;
          d[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }, { linear: true });
  };

  /* ---------- sprites ---------- */
  tex.spark = function () {
    return make('spark', 64, function (ctx, s) {
      var g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    }, { clamp: true, nomip: true });
  };

  tex.smoke = function () {
    return make('smoke', 128, function (ctx, s) {
      var img = ctx.createImageData(s, s);
      var d = img.data, n = TD.Noise(88);
      for (var y = 0; y < s; y++) for (var x = 0; x < s; x++) {
        var dx = (x - s / 2) / (s / 2), dy = (y - s / 2) / (s / 2);
        var r = Math.sqrt(dx * dx + dy * dy);
        var f = (n.fbm(x / s * 4, y / s * 4, 4) * 0.5 + 0.5);
        var a = TD.util.clamp((1 - r) * 1.5, 0, 1);
        a = a * a * (0.45 + f * 0.75);
        var o = (y * s + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = 255;
        d[o + 3] = TD.util.clamp(a, 0, 1) * 255;
      }
      ctx.putImageData(img, 0, 0);
    }, { clamp: true });
  };

  tex.ring = function () {
    return make('ring', 128, function (ctx, s) {
      var g = ctx.createRadialGradient(s / 2, s / 2, s * 0.30, s / 2, s / 2, s * 0.5);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.8, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    }, { clamp: true, nomip: true });
  };

  tex.leaf = function () {
    return make('leaf', 64, function (ctx, s) {
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = '#8fbf62';
      ctx.beginPath();
      ctx.ellipse(s / 2, s / 2, s * 0.18, s * 0.42, 0.5, 0, 6.283);
      ctx.fill();
      ctx.strokeStyle = 'rgba(50,80,40,0.6)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(s * 0.35, s * 0.78); ctx.lineTo(s * 0.65, s * 0.22); ctx.stroke();
    }, { clamp: true });
  };

  /* glyph decal used on monoliths / lore stones */
  tex.glyph = function () {
    return make('glyph', 256, function (ctx, s) {
      ctx.fillStyle = '#0b0f10'; ctx.fillRect(0, 0, s, s);
      var rng = TD.RNG(2024);
      ctx.strokeStyle = '#7de3c8'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (var i = 0; i < 16; i++) {
        var x = rng.range(24, s - 24), y = rng.range(24, s - 24);
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (var k = 0; k < rng.int(2, 4); k++) {
          x += rng.pick([-28, 0, 28]); y += rng.pick([-28, 0, 28]);
          ctx.lineTo(x, y);
        }
        ctx.stroke();
        if (rng.chance(0.4)) { ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.283); ctx.stroke(); }
      }
    });
  };

  tex.dispose = function () {
    for (var k in cache) cache[k].dispose();
    cache = {};
  };

})(window.TD);

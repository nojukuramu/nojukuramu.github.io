/* procgen.js
 * All texture generation is done on <canvas> at runtime — zero image assets,
 * zero network requests. Every function here returns a THREE.CanvasTexture
 * (or a plain canvas/context for compositing). Keeping this in one module
 * means every other system swaps in real texture files later just by
 * changing what these functions return.
 */
(function (global) {
  "use strict";

  function mkCanvas(w, h) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }

  // cheap value-noise for terrain-ish speckle
  function valueNoise(w, h, scale, seed) {
    seed = seed || 1;
    function rand(x, y) {
      var n = Math.sin(x * 12.9898 * seed + y * 78.233 * seed) * 43758.5453;
      return n - Math.floor(n);
    }
    var data = new Float32Array(w * h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var fx = x / scale, fy = y / scale;
        var x0 = Math.floor(fx), y0 = Math.floor(fy);
        var tx = fx - x0, ty = fy - y0;
        var a = rand(x0, y0), b = rand(x0 + 1, y0), c = rand(x0, y0 + 1), d = rand(x0 + 1, y0 + 1);
        var top = a + (b - a) * tx, bot = c + (d - c) * tx;
        data[y * w + x] = top + (bot - top) * ty;
      }
    }
    return data;
  }

  var Procgen = {
    mkCanvas: mkCanvas,
    valueNoise: valueNoise,

    // Ground texture: grass/dirt speckled tiling texture used as terrain base map.
    groundTexture: function (size) {
      size = size || 256;
      var c = mkCanvas(size, size);
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#5f8a4a";
      ctx.fillRect(0, 0, size, size);
      var noise = valueNoise(size, size, 18, 4.2);
      var img = ctx.getImageData(0, 0, size, size);
      for (var i = 0; i < size * size; i++) {
        var n = noise[i];
        var shade = 0.85 + n * 0.3;
        img.data[i * 4] = Math.min(255, img.data[i * 4] * shade);
        img.data[i * 4 + 1] = Math.min(255, img.data[i * 4 + 1] * shade);
        img.data[i * 4 + 2] = Math.min(255, img.data[i * 4 + 2] * shade);
      }
      ctx.putImageData(img, 0, 0);
      var tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return tex;
    },

    // Road surface texture with lane markings baked in per type.
    roadTexture: function (type) {
      var w = 128, h = 256;
      var c = mkCanvas(w, h);
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#2b2f36";
      ctx.fillRect(0, 0, w, h);
      var noise = valueNoise(w, h, 10, 7.7);
      var img = ctx.getImageData(0, 0, w, h);
      for (var i = 0; i < w * h; i++) {
        var n = 0.9 + noise[i] * 0.2;
        img.data[i * 4] *= n; img.data[i * 4 + 1] *= n; img.data[i * 4 + 2] *= n;
      }
      ctx.putImageData(img, 0, 0);

      ctx.strokeStyle = "rgba(235,220,140,0.9)";
      if (type === "highway") {
        ctx.setLineDash([18, 14]);
        ctx.lineWidth = 3;
        for (var lane = 1; lane < 4; lane++) {
          var x = (w / 4) * lane;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(4, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(w - 4, 0); ctx.lineTo(w - 4, h); ctx.stroke();
      } else if (type === "avenue") {
        ctx.setLineDash([20, 16]);
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.setLineDash([10, 12]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
        ctx.setLineDash([]);
      }
      var tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      return tex;
    },

    // Building facade: window grid, emissive-ready (alpha channel doubles as emissive mask).
    buildingTexture: function (opts) {
      opts = opts || {};
      var cols = opts.cols || 6, rows = opts.rows || 10;
      var w = cols * 24, h = rows * 24;
      var c = mkCanvas(w, h);
      var ctx = c.getContext("2d");
      var baseHue = opts.hue != null ? opts.hue : 210;
      ctx.fillStyle = "hsl(" + baseHue + ", 18%, " + (opts.light || 30) + "%)";
      ctx.fillRect(0, 0, w, h);

      var litMask = mkCanvas(w, h);
      var lctx = litMask.getContext("2d");
      lctx.fillStyle = "#000"; lctx.fillRect(0, 0, w, h);

      for (var r = 0; r < rows; r++) {
        for (var cix = 0; cix < cols; cix++) {
          var px = cix * 24 + 4, py = r * 24 + 4;
          var lit = Math.random() < (opts.litChance != null ? opts.litChance : 0.0);
          ctx.fillStyle = lit ? "hsl(46, 90%, 78%)" : "hsl(" + (baseHue + 8) + ", 30%, " + ((opts.light || 30) - 10) + "%)";
          ctx.fillRect(px, py, 16, 14);
          if (lit) {
            lctx.fillStyle = "#fff";
            lctx.fillRect(px, py, 16, 14);
          }
        }
      }
      var tex = new THREE.CanvasTexture(c);
      var emTex = new THREE.CanvasTexture(litMask);
      tex.anisotropy = 4;
      return { map: tex, emissiveMap: emTex };
    },

    // A single building's *night* variant is baked once at spawn time with a
    // fixed random lit-window pattern, so its emissive texture never has to
    // be regenerated per frame — see buildings.js `familyTextures`.
    buildingNightTexture: function (dayCanvasSourceOpts, litChance) {
      return this.buildingTexture(Object.assign({}, dayCanvasSourceOpts, { litChance: litChance }));
    },

    // Radial sprite used for street lights / headlights / rain streak alpha.
    glowSprite: function (color, size) {
      size = size || 64;
      var c = mkCanvas(size, size);
      var ctx = c.getContext("2d");
      var g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, color || "rgba(255,240,180,1)");
      g.addColorStop(0.4, (color || "rgba(255,240,180,1)").replace("1)", "0.6)"));
      g.addColorStop(1, "rgba(255,240,180,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      var tex = new THREE.CanvasTexture(c);
      return tex;
    },

    rainStreakTexture: function () {
      var w = 8, h = 64;
      var c = mkCanvas(w, h);
      var ctx = c.getContext("2d");
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "rgba(200,220,255,0)");
      g.addColorStop(0.5, "rgba(200,220,255,0.55)");
      g.addColorStop(1, "rgba(200,220,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      return new THREE.CanvasTexture(c);
    },

    starTexture: function () {
      return this.glowSprite("rgba(255,255,255,1)", 32);
    },

    // Simple foliage billboard (two crossed diamonds) for procedural trees.
    treeTexture: function () {
      var s = 128;
      var c = mkCanvas(s, s);
      var ctx = c.getContext("2d");
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = "#3f6b34";
      ctx.beginPath();
      ctx.ellipse(s / 2, s * 0.4, s * 0.32, s * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#325a29";
      ctx.beginPath();
      ctx.ellipse(s * 0.35, s * 0.5, s * 0.2, s * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5a3a25";
      ctx.fillRect(s / 2 - 4, s * 0.62, 8, s * 0.36);
      var tex = new THREE.CanvasTexture(c);
      return tex;
    }
  };

  global.Procgen = Procgen;
})(window);

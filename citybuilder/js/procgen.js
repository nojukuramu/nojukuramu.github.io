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

  // FIX 7b: fraction of the facade texture height reserved as a flat roof
  // band (must match buildings.js ROOF_BAND, which remaps the box UVs to match).
  var ROOF_BAND_RATIO = 0.12;

  // Darken/lighten a "#rrggbb" hex color by a signed fractional amount
  // (negative darkens toward black, positive lightens toward white).
  function shadeHex(hex, amt) {
    var c = hex.replace("#", "");
    if (c.length === 3) c = c.split("").map(function (ch) { return ch + ch; }).join("");
    var r = parseInt(c.substring(0, 2), 16), g = parseInt(c.substring(2, 4), 16), b = parseInt(c.substring(4, 6), 16);
    function adj(v) { return Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt))); }
    return "rgb(" + adj(r) + "," + adj(g) + "," + adj(b) + ")";
  }

  // Same shading but accepts ANY css color string ("hsl(...)", "rgb(...)",
  // "#hex") by resolving it through a 1x1 canvas first.
  var _resolveCanvas = null;
  function shadeRgbOrHsl(color, amt) {
    if (color.charAt(0) === "#") return shadeHex(color, amt);
    if (!_resolveCanvas) _resolveCanvas = mkCanvas(1, 1);
    var rctx = _resolveCanvas.getContext("2d");
    rctx.fillStyle = color;
    rctx.fillRect(0, 0, 1, 1);
    var d = rctx.getImageData(0, 0, 1, 1).data;
    function adj(v) { return Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt))); }
    return "rgb(" + adj(d[0]) + "," + adj(d[1]) + "," + adj(d[2]) + ")";
  }

  // FIX 8: resolve a building's wall/glass/roof colors. Accepts an explicit
  // `opts.wallColor` (hex string like "#b8a992", or {h,s,l}); falls back to
  // the original hue-only behavior when only opts.hue/opts.light are given.
  function resolveWallColors(opts) {
    var roof = "hsl(220, 6%, 19%)"; // flat dark neutral gray, same for every palette
    if (opts.wallColor) {
      if (typeof opts.wallColor === "string") {
        return { fill: opts.wallColor, glassA: shadeHex(opts.wallColor, -0.38), glassB: shadeHex(opts.wallColor, -0.5), roof: roof };
      }
      var wc = opts.wallColor;
      return {
        fill: "hsl(" + wc.h + ", " + wc.s + "%, " + wc.l + "%)",
        glassA: "hsl(" + wc.h + ", " + Math.max(6, wc.s - 6) + "%, " + Math.max(6, wc.l - 18) + "%)",
        glassB: "hsl(" + wc.h + ", " + Math.max(6, wc.s - 6) + "%, " + Math.max(6, wc.l - 24) + "%)",
        roof: roof
      };
    }
    var baseHue = opts.hue != null ? opts.hue : 210;
    var light = opts.light != null ? opts.light : 30;
    return {
      fill: "hsl(" + baseHue + ", 18%, " + light + "%)",
      glassA: "hsl(" + (baseHue + 8) + ", 26%, " + Math.max(6, light - 14) + "%)",
      glassB: "hsl(" + (baseHue + 8) + ", 26%, " + Math.max(6, light - 20) + "%)",
      roof: roof
    };
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

  // With the renderer running a linear->sRGB output pipeline (see main.js),
  // every texture that carries *color* must be tagged as sRGB so it is
  // decoded to linear before lighting. One helper so no call site forgets.
  function srgb(tex) {
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  var Procgen = {
    mkCanvas: mkCanvas,
    valueNoise: valueNoise,

    // Ground texture: multi-tone grass with patchy hue drift and fine blade
    // speckle. Two noise octaves — a broad one drives warm/cool patches, a
    // fine one adds per-texel sparkle so the ground never reads flat.
    groundTexture: function (size) {
      size = size || 256;
      var c = mkCanvas(size, size);
      var ctx = c.getContext("2d");
      var broad = valueNoise(size, size, 46, 3.7);
      var mid = valueNoise(size, size, 15, 6.1);
      var fine = valueNoise(size, size, 4, 11.3);
      var img = ctx.createImageData(size, size);
      for (var i = 0; i < size * size; i++) {
        var b = broad[i], m = mid[i], f = fine[i];
        // base grass: warm olive in dry patches, cooler green in lush patches.
        // Broad amplitude stays LOW — the texture tiles ~18x across the map,
        // so strong low-frequency blobs would read as a repeating checker;
        // large-scale variety comes from the vertex-color biome noise instead.
        var r = 98 + b * 14 - m * 10;
        var g = 124 + b * 8 + m * 9;
        var bl = 60 + b * 5 - m * 5;
        var shade = 0.88 + f * 0.24;
        img.data[i * 4] = Math.min(255, r * shade);
        img.data[i * 4 + 1] = Math.min(255, g * shade);
        img.data[i * 4 + 2] = Math.min(255, bl * shade);
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      var tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      return srgb(tex);
    },

    // Road surface texture v2. Streets and avenues get sidewalks baked into
    // the outer band of the strip (pale concrete + curb shadow line +
    // expansion joints), highways get shoulder lines instead. The asphalt
    // core carries per-lane wear streaks (subtle darkening where tires run)
    // so roads read as used, not freshly printed.
    roadTexture: function (type) {
      var w = 128, h = 256;
      var c = mkCanvas(w, h);
      var ctx = c.getContext("2d");

      // asphalt base with noise grain
      ctx.fillStyle = "#33373e";
      ctx.fillRect(0, 0, w, h);
      var noise = valueNoise(w, h, 9, 7.7);
      var fine = valueNoise(w, h, 3, 13.1);
      var img = ctx.getImageData(0, 0, w, h);
      for (var i = 0; i < w * h; i++) {
        var n = 0.88 + noise[i] * 0.18 + fine[i] * 0.08;
        img.data[i * 4] *= n; img.data[i * 4 + 1] *= n; img.data[i * 4 + 2] *= n;
      }
      ctx.putImageData(img, 0, 0);

      var sidewalkPx = type === "highway" ? 0 : Math.round(w * 0.14);
      var curbPx = 3;
      var asphaltL = sidewalkPx, asphaltR = w - sidewalkPx;
      var asphaltW = asphaltR - asphaltL;

      // tire-wear streaks: darken two soft bands per lane
      function wearBand(cx, halfW) {
        var grad = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
        grad.addColorStop(0, "rgba(0,0,0,0)");
        grad.addColorStop(0.5, "rgba(0,0,0,0.16)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(cx - halfW, 0, halfW * 2, h);
      }
      var lanes = type === "highway" ? 4 : 2;
      for (var ln = 0; ln < lanes; ln++) {
        var laneC = asphaltL + asphaltW * (ln + 0.5) / lanes;
        var laneW = asphaltW / lanes;
        wearBand(laneC - laneW * 0.22, laneW * 0.13);
        wearBand(laneC + laneW * 0.22, laneW * 0.13);
      }

      // lane markings
      if (type === "highway") {
        ctx.strokeStyle = "rgba(235,225,170,0.85)";
        ctx.setLineDash([18, 14]);
        ctx.lineWidth = 3;
        for (var lm = 1; lm < 4; lm++) {
          var x = asphaltL + (asphaltW / 4) * lm;
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(asphaltL + 5, 0); ctx.lineTo(asphaltL + 5, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(asphaltR - 5, 0); ctx.lineTo(asphaltR - 5, h); ctx.stroke();
      } else if (type === "avenue") {
        ctx.strokeStyle = "rgba(240,215,120,0.9)";
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(w / 2 - 3, 0); ctx.lineTo(w / 2 - 3, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(w / 2 + 3, 0); ctx.lineTo(w / 2 + 3, h); ctx.stroke();
      } else {
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.setLineDash([12, 14]);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
        ctx.setLineDash([]);
      }

      // sidewalks: pale concrete slabs + curb shadow + expansion joints
      if (sidewalkPx > 0) {
        var walkNoise = valueNoise(sidewalkPx, h, 8, 5.3);
        [[0, sidewalkPx], [w - sidewalkPx, sidewalkPx]].forEach(function (band) {
          var bx = band[0], bw = band[1];
          ctx.fillStyle = "#9a9891";
          ctx.fillRect(bx, 0, bw, h);
          var wimg = ctx.getImageData(bx, 0, bw, h);
          for (var wi = 0; wi < bw * h; wi++) {
            var sn = 0.92 + walkNoise[wi % (sidewalkPx * h)] * 0.14;
            wimg.data[wi * 4] *= sn; wimg.data[wi * 4 + 1] *= sn; wimg.data[wi * 4 + 2] *= sn;
          }
          ctx.putImageData(wimg, bx, 0);
          // expansion joints across the walk
          ctx.strokeStyle = "rgba(0,0,0,0.22)";
          ctx.lineWidth = 1.5;
          for (var jy = 16; jy < h; jy += 32) {
            ctx.beginPath(); ctx.moveTo(bx, jy); ctx.lineTo(bx + bw, jy); ctx.stroke();
          }
          // curb: bright edge + shadow line against the asphalt
          var curbX = bx === 0 ? bw - curbPx : bx;
          ctx.fillStyle = "#b3b1a9";
          ctx.fillRect(curbX, 0, curbPx, h);
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillRect(bx === 0 ? bw : bx - 2, 0, 2, h);
        });
      }

      var tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 4;
      return srgb(tex);
    },

    // Plain tiling asphalt (no markings) for intersection hub discs.
    asphaltTexture: function () {
      var s = 64;
      var c = mkCanvas(s, s);
      var ctx = c.getContext("2d");
      ctx.fillStyle = "#33373e";
      ctx.fillRect(0, 0, s, s);
      var noise = valueNoise(s, s, 7, 9.9);
      var img = ctx.getImageData(0, 0, s, s);
      for (var i = 0; i < s * s; i++) {
        var n = 0.88 + noise[i] * 0.2;
        img.data[i * 4] *= n; img.data[i * 4 + 1] *= n; img.data[i * 4 + 2] *= n;
      }
      ctx.putImageData(img, 0, 0);
      var tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return srgb(tex);
    },

    // Building facade: window grid, emissive-ready (alpha channel doubles as emissive mask).
    // FIX 7a: the day map always gets dark glass windows (with a subtle two-tone
    // checker for variety) — the lit-window pattern is painted ONLY into the
    // emissive mask, so night lighting comes purely from emissiveMap * emissiveIntensity.
    // FIX 7b: the top ROOF_BAND_RATIO slice of the canvas is reserved as a flat,
    // windowless roof color (buildings.js remaps the box UVs so only the top/
    // bottom faces sample this band and only the side faces sample the rest).
    // Facade v2. Beyond the v1 window grid this bakes in the details that
    // make a box read as architecture at a glance: floor separation lines,
    // window sills with a drop-shadow underside and a top glass highlight,
    // a taller ground-floor storefront row (opts.storefront) with entrance
    // door, a cornice band under the roof, vertical edge ambient-occlusion
    // (dark left/right margins that shade the box corners), and a roof band
    // with parapet line + AC-unit blocks. Lit windows still go ONLY into
    // the emissive mask; storefronts get a higher lit chance so commercial
    // streets glow at dusk.
    buildingTexture: function (opts) {
      opts = opts || {};
      var cols = opts.cols || 6, rows = opts.rows || 10;
      var CELL = 24;
      var w = cols * CELL, h = rows * CELL;
      var c = mkCanvas(w, h);
      var ctx = c.getContext("2d");
      var wall = resolveWallColors(opts);

      // wall base with a subtle vertical gradient (weathering darkens the base)
      var wallGrad = ctx.createLinearGradient(0, 0, 0, h);
      wallGrad.addColorStop(0, wall.fill);
      wallGrad.addColorStop(1, shadeRgbOrHsl(wall.fill, -0.12));
      ctx.fillStyle = wallGrad;
      ctx.fillRect(0, 0, w, h);

      // faint wall grain
      var grain = valueNoise(w, h, 6, 8.8);
      var img = ctx.getImageData(0, 0, w, h);
      for (var gi = 0; gi < w * h; gi++) {
        var gn = 0.96 + grain[gi] * 0.08;
        img.data[gi * 4] *= gn; img.data[gi * 4 + 1] *= gn; img.data[gi * 4 + 2] *= gn;
      }
      ctx.putImageData(img, 0, 0);

      var litMask = mkCanvas(w, h);
      var lctx = litMask.getContext("2d");
      lctx.fillStyle = "#000"; lctx.fillRect(0, 0, w, h);

      var roofPx = Math.round(h * ROOF_BAND_RATIO);
      var litChance = opts.litChance != null ? opts.litChance : 0.0;
      var groundRow = rows - 1; // bottom row of the canvas = street level

      for (var r = 0; r < rows; r++) {
        var rowTop = r * CELL;
        if (rowTop + 4 < roofPx) continue;
        // floor separation line above each row
        ctx.fillStyle = "rgba(0,0,0,0.18)";
        ctx.fillRect(0, rowTop, w, 2);

        var isGround = opts.storefront && r === groundRow;
        for (var cix = 0; cix < cols; cix++) {
          var px = cix * CELL + 4, py = rowTop + 4;
          var winW = 16, winH = isGround ? 18 : 13;
          var isDoor = isGround && cix === Math.floor(cols / 2);

          if (isDoor) {
            // recessed entrance: dark slot + light frame
            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.fillRect(px + 1, py, winW - 2, winH + 1);
            ctx.strokeStyle = "rgba(255,255,255,0.25)";
            ctx.lineWidth = 1;
            ctx.strokeRect(px + 1.5, py + 0.5, winW - 3, winH);
          } else {
            // glass pane
            ctx.fillStyle = (cix + r) % 2 === 0 ? wall.glassA : wall.glassB;
            ctx.fillRect(px, py, winW, winH);
            // sky reflection streak in the top third of the pane
            ctx.fillStyle = "rgba(200,220,240,0.16)";
            ctx.fillRect(px, py, winW, Math.max(2, winH * 0.3));
            // sill shadow under the pane
            ctx.fillStyle = "rgba(0,0,0,0.3)";
            ctx.fillRect(px - 1, py + winH, winW + 2, 2);
          }

          var lit = !isDoor && Math.random() < (isGround ? Math.min(0.9, litChance * 2.2) : litChance);
          if (lit) {
            lctx.fillStyle = isGround ? "#fff6dd" : "#fff";
            lctx.fillRect(px, py, winW, winH);
          }
        }
      }

      // cornice: light ledge + shadow just below the roof band
      ctx.fillStyle = shadeRgbOrHsl(wall.fill, 0.18);
      ctx.fillRect(0, roofPx, w, 3);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(0, roofPx + 3, w, 2);

      // vertical edge AO so box corners read shaded
      var edgeW = Math.max(3, Math.round(w * 0.035));
      var aoL = ctx.createLinearGradient(0, 0, edgeW, 0);
      aoL.addColorStop(0, "rgba(0,0,0,0.32)"); aoL.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = aoL; ctx.fillRect(0, roofPx, edgeW, h - roofPx);
      var aoR = ctx.createLinearGradient(w - edgeW, 0, w, 0);
      aoR.addColorStop(0, "rgba(0,0,0,0)"); aoR.addColorStop(1, "rgba(0,0,0,0.32)");
      ctx.fillStyle = aoR; ctx.fillRect(w - edgeW, roofPx, edgeW, h - roofPx);

      // roof band: base + parapet edge + AC units + hatch
      ctx.fillStyle = wall.roof;
      ctx.fillRect(0, 0, w, roofPx);
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(0, 0, w, 2);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, roofPx - 2, w, 2);
      var acCount = 2 + Math.floor(Math.random() * 3);
      for (var ac = 0; ac < acCount; ac++) {
        var acW = 6 + Math.random() * 8, acH = 4 + Math.random() * 5;
        var acX = 4 + Math.random() * (w - acW - 8);
        var acY = 3 + Math.random() * Math.max(1, roofPx - acH - 6);
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.fillRect(acX, acY, acW, acH);
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(acX + 1, acY + acH, acW, 2);
      }

      var tex = new THREE.CanvasTexture(c);
      var emTex = new THREE.CanvasTexture(litMask);
      tex.anisotropy = 4;
      return { map: srgb(tex), emissiveMap: srgb(emTex) };
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
    // Kept for the park prop; scattered world trees use treeGeometry below.
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
      return srgb(tex);
    },

    // Merge several primitive geometries into ONE vertex-colored
    // BufferGeometry so a whole prop (trunk + foliage, car body + cabin)
    // costs a single InstancedMesh. parts: [{geo, color, matrix?}].
    // BufferGeometryUtils isn't in the vendored three.min.js, so this is a
    // hand-rolled non-indexed concat.
    mergeGeoms: function (parts) {
      var pos = [], norm = [], col = [];
      var tmpColor = new THREE.Color();
      var normalMat = new THREE.Matrix3();
      parts.forEach(function (p) {
        var g = p.geo.toNonIndexed();
        if (p.matrix) g.applyMatrix4(p.matrix);
        tmpColor.set(p.color).convertSRGBToLinear();
        var pa = g.attributes.position.array, na = g.attributes.normal.array;
        for (var i = 0; i < pa.length; i += 3) {
          pos.push(pa[i], pa[i + 1], pa[i + 2]);
          norm.push(na[i], na[i + 1], na[i + 2]);
          col.push(tmpColor.r, tmpColor.g, tmpColor.b);
        }
        g.dispose();
        p.geo.dispose();
      });
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(norm, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      return geo;
    },

    // Low-poly tree geometries (unit height ~1, scaled per instance).
    // species: "broadleaf" (trunk + two blob spheres) | "conifer" (trunk + stacked cones)
    treeGeometry: function (species) {
      var mk = function (geo, color, x, y, z) {
        var m = new THREE.Matrix4().makeTranslation(x || 0, y || 0, z || 0);
        return { geo: geo, color: color, matrix: m };
      };
      if (species === "conifer") {
        return this.mergeGeoms([
          mk(new THREE.CylinderGeometry(0.05, 0.08, 0.3, 5), "#5a4630", 0, 0.15, 0),
          mk(new THREE.ConeGeometry(0.34, 0.55, 6), "#2e5d3a", 0, 0.5, 0),
          mk(new THREE.ConeGeometry(0.26, 0.5, 6), "#3a7046", 0, 0.82, 0)
        ]);
      }
      return this.mergeGeoms([
        mk(new THREE.CylinderGeometry(0.06, 0.09, 0.4, 5), "#6b5138", 0, 0.2, 0),
        mk(new THREE.SphereGeometry(0.34, 7, 6), "#4a7c3f", 0, 0.62, 0),
        mk(new THREE.SphereGeometry(0.24, 6, 5), "#568c48", 0.16, 0.5, 0.1)
      ]);
    },

    // Fluffy cloud billboard: overlapping soft blobs with a flat, slightly
    // shaded underside — reads as a cumulus puff instead of a radial smear.
    cloudTexture: function () {
      var w = 256, hgt = 128;
      var c = mkCanvas(w, hgt);
      var ctx = c.getContext("2d");
      ctx.clearRect(0, 0, w, hgt);
      var blobs = [
        [0.5, 0.52, 0.30], [0.32, 0.58, 0.22], [0.68, 0.58, 0.22],
        [0.42, 0.42, 0.20], [0.58, 0.40, 0.18], [0.22, 0.64, 0.14], [0.78, 0.64, 0.13]
      ];
      blobs.forEach(function (b) {
        var bx = b[0] * w, by = b[1] * hgt, br = b[2] * w;
        var g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, "rgba(255,255,255,0.85)");
        g.addColorStop(0.6, "rgba(252,253,255,0.5)");
        g.addColorStop(1, "rgba(250,252,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      });
      // shade the underside
      var shade = ctx.createLinearGradient(0, hgt * 0.55, 0, hgt);
      shade.addColorStop(0, "rgba(160,175,195,0)");
      shade.addColorStop(1, "rgba(150,165,190,0.35)");
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, w, hgt);
      ctx.globalCompositeOperation = "source-over";
      var tex = new THREE.CanvasTexture(c);
      return srgb(tex);
    }
  };

  global.Procgen = Procgen;
})(window);

/* terrain.js
 * Heightmap terrain mesh + terraforming brushes + the RTS-style city camera.
 * The camera lives here because it orbits a "focus point" that is always
 * pinned to the terrain surface — the two are naturally coupled.
 *
 * Heightmap storage: a flat Float32Array of (segs+1)^2 samples, independent
 * of the render resolution used by any particular quality tier — so
 * changing quality tiers mid-game just re-tessellates, it never touches
 * saved data. Saves always serialize this canonical array.
 */
(function (global) {
  "use strict";
  var util = Game.util, CFG = Game.CONFIG;

  var Terrain = {
    size: CFG.WORLD_SIZE,
    segs: 96,              // canonical heightmap resolution (independent of render LOD)
    heights: null,         // Float32Array (segs+1)^2
    mesh: null,
    geometry: null,
    waterLevel: CFG.WATER_LEVEL,

    init: function (savedHeights) {
      this.segs = 96;
      var n = this.segs + 1;
      this.heights = savedHeights && savedHeights.length === n * n ? savedHeights : this._generate(n);
      this._buildMesh();
      return this.mesh;
    },

    _generate: function (n) {
      var h = new Float32Array(n * n);
      var rand = util.mulberry32(20260721);
      // three octaves of value noise, biased so the north-west quadrant
      // dips into a lake basin and the south-east rises into hills.
      var noiseA = Procgen.valueNoise(n, n, 26, 3.1);
      var noiseB = Procgen.valueNoise(n, n, 11, 9.4);
      var noiseC = Procgen.valueNoise(n, n, 5, 17.8);
      for (var y = 0; y < n; y++) {
        for (var x = 0; x < n; x++) {
          var i = y * n + x;
          var fx = x / n, fy = y / n;
          var base = (noiseA[i] - 0.5) * 22 + (noiseB[i] - 0.5) * 8 + (noiseC[i] - 0.5) * 3;
          // gentle basin toward the corner (0,0) for a lake/coast, rise away from it
          var basin = (fx * 0.6 + fy * 0.6) * 16 - 6;
          var elevation = base + basin;
          // flatten a starter plateau near the center so first roads are easy
          var cx = fx - 0.55, cy = fy - 0.5;
          var centerDist = Math.sqrt(cx * cx + cy * cy);
          var flat = 1 - util.smoothstep(0.08, 0.22, centerDist);
          elevation = util.lerp(elevation, CFG.WATER_LEVEL + 3.2, flat * 0.85);
          h[i] = util.clamp(elevation, CFG.MIN_HEIGHT, CFG.MAX_HEIGHT);
        }
      }
      return h;
    },

    _buildMesh: function () {
      var renderSegs = QualityManager.settings.terrainSegments;
      var geo = new THREE.PlaneGeometry(this.size, this.size, renderSegs, renderSegs);
      geo.rotateX(-Math.PI / 2);
      var colors = new Float32Array(geo.attributes.position.count * 3);
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      this.geometry = geo;
      this._resample(renderSegs);

      var tex = Procgen.groundTexture(256);
      tex.repeat.set(this.size / 22, this.size / 22);
      var mat = new THREE.MeshLambertMaterial({ map: tex, vertexColors: true });
      this.mesh = new THREE.Mesh(geo, mat);
      this.mesh.receiveShadow = true;
      this.mesh.name = "terrain";
      this.renderSegs = renderSegs;
    },

    // Bilinear-sample the canonical heightmap at world (x,z).
    heightAt: function (x, z) {
      var n = this.segs + 1;
      var u = util.clamp((x + this.size / 2) / this.size, 0, 0.9999) * this.segs;
      var v = util.clamp((z + this.size / 2) / this.size, 0, 0.9999) * this.segs;
      var x0 = Math.floor(u), z0 = Math.floor(v);
      var tx = u - x0, tz = v - z0;
      var h00 = this.heights[z0 * n + x0];
      var h10 = this.heights[z0 * n + Math.min(x0 + 1, this.segs)];
      var h01 = this.heights[Math.min(z0 + 1, this.segs) * n + x0];
      var h11 = this.heights[Math.min(z0 + 1, this.segs) * n + Math.min(x0 + 1, this.segs)];
      var top = util.lerp(h00, h10, tx), bot = util.lerp(h01, h11, tx);
      return util.lerp(top, bot, tz);
    },

    slopeAt: function (x, z) {
      var e = 1.5;
      var hL = this.heightAt(x - e, z), hR = this.heightAt(x + e, z);
      var hD = this.heightAt(x, z - e), hU = this.heightAt(x, z + e);
      return (Math.abs(hR - hL) + Math.abs(hU - hD)) / (4 * e);
    },

    isFlatEnough: function (x, z, radius, tolerance) {
      tolerance = tolerance || 0.6;
      var samples = 5, base = this.heightAt(x, z);
      for (var i = 0; i < samples; i++) {
        var a = (i / samples) * Math.PI * 2;
        var h = this.heightAt(x + Math.cos(a) * radius, z + Math.sin(a) * radius);
        if (Math.abs(h - base) > tolerance) return false;
      }
      return true;
    },

    // ---- Re-tessellate render mesh at a new LOD (called on quality change) ----
    setRenderResolution: function (renderSegs) {
      if (renderSegs === this.renderSegs) return;
      var oldMesh = this.mesh;
      var parent = oldMesh.parent;
      var geo = new THREE.PlaneGeometry(this.size, this.size, renderSegs, renderSegs);
      geo.rotateX(-Math.PI / 2);
      var colors = new Float32Array(geo.attributes.position.count * 3);
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      this.geometry.dispose();
      this.geometry = geo;
      this.renderSegs = renderSegs;
      this._resample(renderSegs);
      this.mesh.geometry = geo;
    },

    // Push canonical heightmap samples into the (possibly lower-res) render mesh.
    _resample: function (renderSegs) {
      var pos = this.geometry.attributes.position;
      var col = this.geometry.attributes.color;
      var half = this.size / 2;
      var tmpColor = new THREE.Color();
      for (var iy = 0; iy <= renderSegs; iy++) {
        for (var ix = 0; ix <= renderSegs; ix++) {
          var idx = iy * (renderSegs + 1) + ix;
          var wx = (ix / renderSegs) * this.size - half;
          var wz = (iy / renderSegs) * this.size - half;
          var h = this.heightAt(wx, wz);
          pos.setY(idx, h);
          this._biomeColor(wx, wz, h, this.slopeAt(wx, wz), tmpColor);
          col.setXYZ(idx, tmpColor.r, tmpColor.g, tmpColor.b);
        }
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      this.geometry.computeVertexNormals();
    },

    // Biome tint v2. The ground texture carries the grass color; vertex
    // colors act as a tint/AO mask layered on top: wet dark sand at the
    // waterline fading through dry sand, moisture-darkened lowland grass,
    // sun-bleached dry grass on high ground, two-tone strata rock on slopes,
    // snow dusting the peaks — plus a concavity term that shades hollows
    // like cheap baked ambient occlusion.
    _biomeColors: {
      wetSand: new THREE.Color(0x8a7350).convertSRGBToLinear(),
      sand: new THREE.Color(0xd9c184).convertSRGBToLinear(),
      grass: new THREE.Color(0xffffff),
      lush: new THREE.Color(0xb8d6a0).convertSRGBToLinear(),
      dry: new THREE.Color(0xd8cf9a).convertSRGBToLinear(),
      rockLow: new THREE.Color(0x8d8578).convertSRGBToLinear(),
      rockHigh: new THREE.Color(0xa39d92).convertSRGBToLinear(),
      snow: new THREE.Color(0xeef2f7).convertSRGBToLinear()
    },
    _biomeColor: function (x, z, h, slope, out) {
      var c = this._biomeColors;
      var wl = this.waterLevel;
      // continuous cheap noise for patchy grass hue drift
      var n = Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2.1) * Math.sin(z * 0.13 + Math.sin(x * 0.05) * 1.7);

      if (h < wl + 1.6) {
        out.copy(c.wetSand).lerp(c.sand, util.smoothstep(wl - 0.6, wl + 0.7, h));
        out.lerp(c.grass, util.smoothstep(wl + 0.8, wl + 1.6, h));
      } else {
        out.copy(c.grass);
        // moisture gradient: lush near the waterline, dry/bleached uphill
        out.lerp(c.lush, util.smoothstep(wl + 3.5, wl + 1.6, h) * 0.5);
        out.lerp(c.dry, util.smoothstep(10, 26, h) * 0.55);
        // patchiness
        out.lerp(c.lush, Math.max(0, n) * 0.22);
        out.lerp(c.dry, Math.max(0, -n) * 0.18);
      }
      // rock strata on slopes: band the tone by height for a layered read
      if (slope > 0.45) {
        var strata = (Math.sin(h * 1.7) * 0.5 + 0.5);
        var rock = this._tmpRock || (this._tmpRock = new THREE.Color());
        rock.copy(c.rockLow).lerp(c.rockHigh, strata);
        out.lerp(rock, util.smoothstep(0.45, 1.3, slope));
      }
      // snow dusting on high, gentle ground
      if (h > CFG.MAX_HEIGHT * 0.66) {
        out.lerp(c.snow, util.smoothstep(CFG.MAX_HEIGHT * 0.66, CFG.MAX_HEIGHT * 0.92, h) * (1 - util.smoothstep(0.5, 1.0, slope)));
      }
      // baked AO: darken hollows (center below neighborhood average)
      var e = 3.5;
      var avg = (this.heightAt(x - e, z) + this.heightAt(x + e, z) + this.heightAt(x, z - e) + this.heightAt(x, z + e)) * 0.25;
      var occ = util.clamp((avg - h) / e * 0.9, 0, 0.45);
      out.multiplyScalar(1 - occ);
    },

    applyLoadedHeights: function (heights) {
      var n = this.segs + 1;
      if (heights && heights.length === n * n) this.heights = heights;
      this._resample(this.renderSegs);
    },

    // ---- Terraforming brush ----
    // mode: 'raise' | 'lower' | 'flatten' | 'smooth'
    applyBrush: function (x, z, mode, radius, strength, targetHeight) {
      var n = this.segs + 1;
      var cellSize = this.size / this.segs;
      var half = this.size / 2;
      var minX = Math.max(0, Math.floor((x - radius + half) / cellSize));
      var maxX = Math.min(this.segs, Math.ceil((x + radius + half) / cellSize));
      var minZ = Math.max(0, Math.floor((z - radius + half) / cellSize));
      var maxZ = Math.min(this.segs, Math.ceil((z + radius + half) / cellSize));
      var changed = false;

      var snapshot = mode === "smooth" ? this.heights.slice() : null;

      for (var gz = minZ; gz <= maxZ; gz++) {
        for (var gx = minX; gx <= maxX; gx++) {
          var wx = (gx / this.segs) * this.size - half;
          var wz = (gz / this.segs) * this.size - half;
          var d = Math.sqrt((wx - x) * (wx - x) + (wz - z) * (wz - z));
          if (d > radius) continue;
          var falloff = 1 - util.smoothstep(radius * 0.35, radius, d);
          var idx = gz * n + gx;
          var hh = this.heights[idx];

          if (mode === "raise") hh += strength * falloff;
          else if (mode === "lower") hh -= strength * falloff;
          else if (mode === "flatten") hh = util.lerp(hh, targetHeight, falloff * strength);
          else if (mode === "smooth") {
            var avg = 0, cnt = 0;
            for (var oz = -1; oz <= 1; oz++) for (var ox = -1; ox <= 1; ox++) {
              var sx = gx + ox, sz = gz + oz;
              if (sx < 0 || sx > this.segs || sz < 0 || sz > this.segs) continue;
              avg += snapshot[sz * n + sx]; cnt++;
            }
            avg /= cnt;
            hh = util.lerp(hh, avg, falloff * strength);
          }
          this.heights[idx] = util.clamp(hh, CFG.MIN_HEIGHT, CFG.MAX_HEIGHT);
          changed = true;
        }
      }
      if (changed) {
        this._updatePatch(minX, minZ, maxX, maxZ);
        if (Game.Water) Game.Water.markHeightsDirty();
        if (Game.Trees) Game.Trees.refreshArea(x, z, radius);
      }
      return changed;
    },

    // Only touches the render mesh vertices inside the dirty rect — keeps
    // brush strokes cheap even at high terrain LOD.
    _updatePatch: function (minXc, minZc, maxXc, maxZc) {
      var rs = this.renderSegs;
      var ratio = rs / this.segs;
      var rMinX = Math.max(0, Math.floor(minXc * ratio) - 1);
      var rMaxX = Math.min(rs, Math.ceil(maxXc * ratio) + 1);
      var rMinZ = Math.max(0, Math.floor(minZc * ratio) - 1);
      var rMaxZ = Math.min(rs, Math.ceil(maxZc * ratio) + 1);
      var pos = this.geometry.attributes.position;
      var col = this.geometry.attributes.color;
      var half = this.size / 2;
      var tmpColor = new THREE.Color();
      for (var iy = rMinZ; iy <= rMaxZ; iy++) {
        for (var ix = rMinX; ix <= rMaxX; ix++) {
          var idx = iy * (rs + 1) + ix;
          var wx = (ix / rs) * this.size - half;
          var wz = (iy / rs) * this.size - half;
          var h = this.heightAt(wx, wz);
          pos.setY(idx, h);
          this._biomeColor(wx, wz, h, this.slopeAt(wx, wz), tmpColor);
          col.setXYZ(idx, tmpColor.r, tmpColor.g, tmpColor.b);
        }
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
      this.geometry.computeVertexNormals();
    },

    // ============================================================
    // Camera — RTS focus-point orbit camera w/ touch + mouse/kbd input
    // ============================================================
    cam: {
      focus: new THREE.Vector3(0, 0, 30),
      distance: 140,
      minDistance: 22,
      maxDistance: 320,
      yaw: Math.PI * 0.22,
      pitch: 0.95, // radians above horizon-ish, clamped
      minPitch: 0.35,
      maxPitch: 1.45
    },

    initCamera: function (camera) {
      this.camera = camera;
      this._applyCamera();
    },

    panCamera: function (dx, dz) {
      var c = this.cam;
      var yawSin = Math.sin(c.yaw), yawCos = Math.cos(c.yaw);
      // dx/dz are in screen-drag space; rotate into world space by yaw
      var wx = dx * yawCos - dz * yawSin;
      var wz = dx * yawSin + dz * yawCos;
      c.focus.x = util.clamp(c.focus.x + wx, -this.size / 2 + 10, this.size / 2 - 10);
      c.focus.z = util.clamp(c.focus.z + wz, -this.size / 2 + 10, this.size / 2 - 10);
      this._applyCamera();
    },

    zoomCamera: function (delta) {
      var c = this.cam;
      c.distance = util.clamp(c.distance * (1 + delta), c.minDistance, c.maxDistance);
      this._applyCamera();
    },

    rotateCamera: function (dYaw, dPitch) {
      var c = this.cam;
      c.yaw += dYaw;
      c.pitch = util.clamp(c.pitch + dPitch, c.minPitch, c.maxPitch);
      this._applyCamera();
    },

    _applyCamera: function () {
      var c = this.cam;
      if (!this.camera) return;
      var groundY = this.heights ? this.heightAt(c.focus.x, c.focus.z) : 0;
      c.focus.y = groundY;
      var horiz = Math.sin(c.pitch) * c.distance;
      var vert = Math.cos(c.pitch) * c.distance;
      var ex = c.focus.x + Math.sin(c.yaw) * horiz;
      var ez = c.focus.z + Math.cos(c.yaw) * horiz;
      var ey = groundY + vert;
      this.camera.position.set(ex, ey, ez);
      this.camera.lookAt(c.focus.x, groundY + 4, c.focus.z);
      // Camera far stays fixed (large enough to always contain the sky dome);
      // perceived draw distance is instead controlled by fog (see lighting.js)
      // so lowering quality tiers fades geometry out smoothly instead of
      // popping the skybox through the clip plane.
    },

    getCameraSaveState: function () { return { focus: this.cam.focus.toArray(), distance: this.cam.distance, yaw: this.cam.yaw, pitch: this.cam.pitch }; },
    loadCameraSaveState: function (s) {
      if (!s) return;
      this.cam.focus.fromArray(s.focus);
      this.cam.distance = s.distance;
      this.cam.yaw = s.yaw;
      this.cam.pitch = s.pitch;
      this._applyCamera();
    }
  };

  Game.Terrain = Terrain;
})(window);

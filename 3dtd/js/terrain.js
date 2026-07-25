/* ============================================================
   VELL — procedural terrain: heightmap, classification, mesh
   ============================================================ */
(function (TD) {
  'use strict';

  var G = TD.G;
  var terrain = TD.terrain = {};

  var N;              // GRID
  var VN;             // GRID+1 vertices per side
  var vh;             // Float32Array vertex heights
  var mesh = null;

  terrain.mesh = null;
  terrain.spawns = [];
  terrain.base = { x: 0, z: 0, y: 0 };

  /* ---------- sampling ---------- */
  terrain.vertexHeight = function (i, j) {
    i = TD.util.clamp(i, 0, VN - 1) | 0;
    j = TD.util.clamp(j, 0, VN - 1) | 0;
    return vh[j * VN + i];
  };

  // bilinear height at world coords
  terrain.heightAt = function (wx, wz) {
    var fx = (wx + TD.HALF) / TD.CELL;
    var fz = (wz + TD.HALF) / TD.CELL;
    var i = Math.floor(fx), j = Math.floor(fz);
    var tx = fx - i, tz = fz - j;
    var h00 = terrain.vertexHeight(i, j), h10 = terrain.vertexHeight(i + 1, j);
    var h01 = terrain.vertexHeight(i, j + 1), h11 = terrain.vertexHeight(i + 1, j + 1);
    return TD.util.lerp(TD.util.lerp(h00, h10, tx), TD.util.lerp(h01, h11, tx), tz);
  };

  var _n = new THREE.Vector3();
  terrain.normalAt = function (wx, wz) {
    var e = TD.CELL * 0.75;
    var hl = terrain.heightAt(wx - e, wz), hr = terrain.heightAt(wx + e, wz);
    var hd = terrain.heightAt(wx, wz - e), hu = terrain.heightAt(wx, wz + e);
    _n.set(hl - hr, 2 * e, hd - hu).normalize();
    return _n;
  };

  terrain.slopeAt = function (wx, wz) { return 1 - terrain.normalAt(wx, wz).y; };

  /* ---------- generation ---------- */
  function generateHeights(seed) {
    var noise = TD.Noise(seed);
    var noise2 = TD.Noise(seed ^ 0x9e3779b9);
    var raw = new Float32Array(VN * VN);
    var i, j, k = 0;
    for (j = 0; j < VN; j++) {
      for (i = 0; i < VN; i++, k++) {
        var wx = -TD.HALF + i * TD.CELL;
        var wz = -TD.HALF + j * TD.CELL;
        var lowland = noise.fbm(wx * 0.012, wz * 0.012, 5, 2.1, 0.52);
        var basin = noise2.fbm(wx * 0.0065 + 40, wz * 0.0065 - 20, 3);
        var ridged = noise.ridge(wx * 0.026, wz * 0.026, 4);
        var rockMask = TD.util.smoothstep(0.05, 0.55, basin);
        var h = lowland * 6.4 + basin * 5.2 + ridged * 3.6 * rockMask;
        // gentle bowl toward map centre so the heart sits on a plain
        var d = Math.sqrt(wx * wx + wz * wz) / TD.HALF;
        h += TD.util.smoothstep(0.15, 1.0, d) * 1.4;
        h -= TD.util.smoothstep(0.55, 0.0, d) * 0.9;
        raw[k] = h;
      }
    }
    // normalise so ~32% of the map falls under water level (y = 0)
    var sample = [];
    for (k = 0; k < raw.length; k += 3) sample.push(raw[k]);
    sample.sort(function (a, b) { return a - b; });
    var waterLine = sample[Math.floor(sample.length * 0.32)];
    for (k = 0; k < raw.length; k++) raw[k] -= waterLine;
    return raw;
  }

  function flattenDisc(cx, cz, radius, targetY, blend) {
    var r2 = radius * radius;
    for (var j = 0; j < VN; j++) {
      for (var i = 0; i < VN; i++) {
        var wx = -TD.HALF + i * TD.CELL, wz = -TD.HALF + j * TD.CELL;
        var dx = wx - cx, dz = wz - cz;
        var d2 = dx * dx + dz * dz;
        if (d2 > r2 * 2.6) continue;
        var t = 1 - TD.util.smoothstep(radius * 0.55, radius * 1.5, Math.sqrt(d2));
        var k = j * VN + i;
        vh[k] = TD.util.lerp(vh[k], targetY, t * (blend === undefined ? 1 : blend));
      }
    }
  }

  function avgHeightAround(cx, cz, radius) {
    var sum = 0, n = 0;
    for (var a = 0; a < 12; a++) {
      var ang = a / 12 * 6.283;
      sum += terrain.heightAt(cx + Math.cos(ang) * radius, cz + Math.sin(ang) * radius); n++;
    }
    return sum / n;
  }

  /* carve a walkable corridor between two cells (raises water, shaves cliffs) */
  function carveCorridor(ax, az, bx, bz, seed) {
    var rng = TD.RNG(seed);
    var steps = Math.max(Math.abs(bx - ax), Math.abs(bz - az)) * 2 + 8;
    var wobble = rng.range(-0.35, 0.35);
    for (var s = 0; s <= steps; s++) {
      var t = s / steps;
      var bow = Math.sin(t * Math.PI) * wobble * TD.WORLD * 0.12;
      var wx = TD.util.lerp(TD.cellToWorldX(ax), TD.cellToWorldX(bx), t) + bow;
      var wz = TD.util.lerp(TD.cellToWorldZ(az), TD.cellToWorldZ(bz), t) - bow * 0.6;
      // lift the strip just above the shoreline and smooth it
      var target = Math.max(0.35, terrain.heightAt(wx, wz));
      flattenDisc(wx, wz, TD.CELL * 1.9, target, 0.85);
    }
  }

  function pickSpawns(seed) {
    var rng = TD.RNG(seed ^ 0x51ed27);
    var out = [];
    var count = 5;
    var startAng = rng.range(0, 6.283);
    for (var s = 0; s < count; s++) {
      var ang = startAng + s / count * 6.283 + rng.range(-0.22, 0.22);
      var rad = TD.HALF - TD.CELL * 2.2;
      var wx = Math.cos(ang) * rad, wz = Math.sin(ang) * rad;
      var cx = TD.util.clamp(TD.worldToCellX(wx), 1, N - 2);
      var cz = TD.util.clamp(TD.worldToCellZ(wz), 1, N - 2);
      out.push({ x: cx, z: cz, ang: ang });
    }
    return out;
  }

  /* ---------- classification ---------- */
  function classify() {
    var kind = TD.cellKind, ch = TD.cellH;
    for (var z = 0; z < N; z++) {
      for (var x = 0; x < N; x++) {
        var k = TD.idx(x, z);
        var wx = TD.cellToWorldX(x), wz = TD.cellToWorldZ(z);
        var h = terrain.heightAt(wx, wz);
        ch[k] = h;
        var slope = terrain.slopeAt(wx, wz);
        if (h < -TD.DEEP_DEPTH) kind[k] = G.DEEP;
        else if (h < -0.05) kind[k] = G.SHALLOW;
        else if (slope > 0.235) kind[k] = G.CLIFF;
        else kind[k] = G.GROUND;
      }
    }
  }

  /* ---------- mesh ---------- */
  function buildMesh(scene) {
    var geo = new THREE.PlaneGeometry(TD.WORLD, TD.WORLD, N, N);
    geo.rotateX(-Math.PI / 2);
    var pos = geo.attributes.position;
    var colors = new Float32Array(pos.count * 3);
    var wet = TD.C(0x4c5f3e), dry = TD.C(0x9caf7e), high = TD.C(0xb6bda8);
    var c = new THREE.Color();
    for (var v = 0; v < pos.count; v++) {
      var i = v % VN, j = Math.floor(v / VN);
      var h = vh[j * VN + i];
      pos.setY(v, h);
      var t = TD.util.smoothstep(-0.6, 2.6, h);
      c.copy(wet).lerp(dry, t);
      c.lerp(high, TD.util.smoothstep(4.0, 9.0, h));
      colors[v * 3] = c.r; colors[v * 3 + 1] = c.g; colors[v * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    var moss = TD.tex.moss(), silt = TD.tex.silt(), stone = TD.tex.stoneTex();
    moss.repeat.set(1, 1); silt.repeat.set(1, 1); stone.repeat.set(1, 1);

    var mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0.0
    });
    mat.userData.uniforms = null;
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uMoss = { value: moss };
      shader.uniforms.uSilt = { value: silt };
      shader.uniforms.uStone = { value: stone };
      shader.uniforms.uNight = { value: 0.0 };
      mat.userData.uniforms = shader.uniforms;

      shader.vertexShader = 'varying vec3 vWPos;\nvarying vec3 vWNrm;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\n  vWNrm = normalize(mat3(modelMatrix) * objectNormal);'
      );

      shader.fragmentShader =
        'uniform sampler2D uMoss;\nuniform sampler2D uSilt;\nuniform sampler2D uStone;\nuniform float uNight;\n' +
        'varying vec3 vWPos;\nvarying vec3 vWNrm;\n' + shader.fragmentShader.replace(
          '#include <color_fragment>',
          [
            '#include <color_fragment>',
            'vec2 tuv = vWPos.xz * 0.115;',
            'vec3 cMoss = mix(texture2D(uMoss, tuv).rgb, texture2D(uMoss, tuv * 0.23).rgb, 0.45);',
            'vec3 cSilt = texture2D(uSilt, tuv * 1.6).rgb;',
            'vec3 cStone = texture2D(uStone, tuv * 0.9).rgb;',
            'float shore = smoothstep(0.55, -0.35, vWPos.y);',
            'float steep = smoothstep(0.80, 0.55, vWNrm.y);',
            'vec3 blend = mix(cMoss, cSilt, shore);',
            'blend = mix(blend, cStone, steep);',
            'diffuseColor.rgb *= blend * 1.62;',
            // faint bioluminescent veins waking at night
            'float vein = smoothstep(0.62, 0.98, texture2D(uMoss, vWPos.xz * 0.052).b);',
            'vein *= smoothstep(0.35, 0.85, texture2D(uSilt, vWPos.xz * 0.017).g);',
            'diffuseColor.rgb += vec3(0.06,0.26,0.20) * vein * uNight * (1.0 - steep) * 0.55;'
          ].join('\n')
        ).replace(
          '#include <roughnessmap_fragment>',
          '#include <roughnessmap_fragment>\n  roughnessFactor *= mix(1.0, 0.45, smoothstep(0.35, -0.3, vWPos.y));'
        );
    };

    mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    scene.add(mesh);
    terrain.mesh = mesh;
    terrain.material = mat;
  }

  terrain.setNight = function (v) {
    if (terrain.material && terrain.material.userData.uniforms) {
      terrain.material.userData.uniforms.uNight.value = v;
    }
  };

  /* refresh mesh vertices after carving */
  function applyHeightsToMesh() {
    if (!mesh) return;
    var pos = mesh.geometry.attributes.position;
    for (var v = 0; v < pos.count; v++) {
      var i = v % VN, j = Math.floor(v / VN);
      pos.setY(v, vh[j * VN + i]);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  /* ---------- public build ---------- */
  terrain.generate = function (scene, seed) {
    N = TD.GRID; VN = N + 1;
    vh = generateHeights(seed);
    terrain.vh = vh;

    TD.cellKind = new Int8Array(N * N);
    TD.cellH = new Float32Array(N * N);
    TD.struct = new Array(N * N);

    // heart plateau at centre
    var bx = Math.floor(N / 2), bz = Math.floor(N / 2);
    var wbx = TD.cellToWorldX(bx), wbz = TD.cellToWorldZ(bz);
    var baseY = Math.max(0.9, avgHeightAround(wbx, wbz, TD.CELL * 4));
    flattenDisc(wbx, wbz, TD.CELL * 3.4, baseY, 1.0);
    terrain.base = { x: bx, z: bz, y: baseY, wx: wbx, wz: wbz };

    // spawn pads
    terrain.spawns = pickSpawns(seed);
    for (var s = 0; s < terrain.spawns.length; s++) {
      var sp = terrain.spawns[s];
      var swx = TD.cellToWorldX(sp.x), swz = TD.cellToWorldZ(sp.z);
      var sy = Math.max(0.5, avgHeightAround(swx, swz, TD.CELL * 3));
      flattenDisc(swx, swz, TD.CELL * 2.4, sy, 1.0);
      sp.y = sy; sp.wx = swx; sp.wz = swz;
      carveCorridor(sp.x, sp.z, bx, bz, seed + s * 733);
    }

    classify();
    // heart + spawn cells get their own kinds
    for (var dz = -2; dz <= 2; dz++) for (var dx = -2; dx <= 2; dx++) {
      if (dx * dx + dz * dz > 6) continue;
      var kk = TD.idx(bx + dx, bz + dz);
      TD.cellKind[kk] = G.BASE;
    }
    for (s = 0; s < terrain.spawns.length; s++) {
      var p = terrain.spawns[s];
      for (dz = -1; dz <= 1; dz++) for (dx = -1; dx <= 1; dx++) {
        if (!TD.inBounds(p.x + dx, p.z + dz)) continue;
        TD.cellKind[TD.idx(p.x + dx, p.z + dz)] = G.SPAWN;
      }
    }

    buildMesh(scene);
    terrain.applyHeightsToMesh = applyHeightsToMesh;
    return terrain;
  };

  /* ---------- walkability helpers ---------- */
  TD.kindWalkable = function (k) {
    return k === G.GROUND || k === G.SHALLOW || k === G.BASE || k === G.SPAWN;
  };
  TD.isWalkable = function (x, z) {
    if (!TD.inBounds(x, z)) return false;
    var i = TD.idx(x, z);
    if (!TD.kindWalkable(TD.cellKind[i])) return false;
    var st = TD.struct[i];
    if (st && st.blocks) return false;
    return true;
  };
  TD.moveCost = function (x, z) {
    var i = TD.idx(x, z);
    var k = TD.cellKind[i];
    var c = (k === G.SHALLOW) ? 1.85 : 1.0;
    var st = TD.struct[i];
    if (st && st.kind === 'trap') c += 0.35; // traps look inviting but nothing is free
    return c;
  };
  TD.isBuildable = function (x, z, kindWanted) {
    if (!TD.inBounds(x, z)) return false;
    var i = TD.idx(x, z);
    var k = TD.cellKind[i];
    if (TD.struct[i]) return false;
    if (k === G.BASE || k === G.SPAWN) return false;
    if (kindWanted === 'trap') return k === G.GROUND || k === G.SHALLOW;
    return k === G.GROUND;
  };

})(window.TD);

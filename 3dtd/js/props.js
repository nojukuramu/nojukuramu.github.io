/* ============================================================
   VELL — world dressing: groves, boulders, reeds, and relics
   ============================================================ */
(function (TD) {
  'use strict';

  var props = TD.props = {};
  var G = TD.G;
  var swayMats = [];
  var glowMats = [];
  var loreObjects = [];
  var glowPoints = null;

  var _up = new THREE.Vector3(0, 1, 0);
  var _nb = new THREE.Vector3();
  var _q = new THREE.Quaternion();
  var _qy = new THREE.Quaternion();
  var _pos = new THREE.Vector3();
  var _scl = new THREE.Vector3();
  var _m = new THREE.Matrix4();

  function alignQuat(wx, wz, blend, yaw) {
    _nb.copy(TD.terrain.normalAt(wx, wz)).lerp(_up, 1 - blend).normalize();
    _q.setFromUnitVectors(_up, _nb);
    _qy.setFromAxisAngle(_up, yaw);
    return _q.multiply(_qy);
  }
  props.alignQuat = alignQuat;

  function swayify(mat, amount) {
    mat.onBeforeCompile = function (sh) {
      sh.uniforms.uTime = { value: 0 };
      sh.uniforms.uSway = { value: amount };
      mat.userData.u = sh.uniforms;
      sh.vertexShader = 'uniform float uTime;\nuniform float uSway;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          '#ifdef USE_INSTANCING',
          '  vec3 iPos = instanceMatrix[3].xyz;',
          '#else',
          '  vec3 iPos = vec3(0.0);',
          '#endif',
          'float sy = max(transformed.y, 0.0);',
          'transformed.x += sin(uTime * 1.15 + iPos.x * 0.33 + iPos.z * 0.21) * uSway * sy;',
          'transformed.z += cos(uTime * 0.93 + iPos.z * 0.29 - iPos.x * 0.17) * uSway * sy * 0.8;'
        ].join('\n')
      );
    };
    swayMats.push(mat);
    return mat;
  }

  /* ---------------- lore relics ---------------- */
  var LORE = [
    {
      id: 'pylon', title: 'Leaning Pylon',
      text: 'A lattice mast, drowned to the shoulders. The cable it once carried runs east, then simply stops — the rest was reeled in by something that wanted the copper.'
    },
    {
      id: 'bell', title: 'The Drowned Bell',
      text: 'Cast for a town that no longer has a name. When the shallows are still you can hear it ring under the water, on the tide, roughly every ninth hour.'
    },
    {
      id: 'warden', title: 'Effigy of a Vell Warden',
      text: 'Stone, faceless, spear pointed downward — the old posture for "the ground is guarded". The Wardens were people once. Then they were an office. Then they were statues.'
    },
    {
      id: 'monolith', title: 'Glyph Stone',
      text: 'Six marks, repeated: seed, water, light, teeth, ash, seed. The Bloom has read this stone before. It is a calendar, and we are in the fifth mark.'
    },
    {
      id: 'cart', title: 'Ore Cart',
      text: 'Still loaded. The ore is red-brown, warm to the touch and faintly humming — not iron. The Foundry called it "willing metal" and fed it to their engines.'
    },
    {
      id: 'vent', title: 'Foundry Vent',
      text: 'Breath comes out of it. Not steam — exhaust, at a slow, deliberate rhythm. Something beneath the moor never finished its shift.'
    },
    {
      id: 'milestone', title: 'Milestone VII',
      text: 'VII to the capital, it says, in a direction that is now open water. Travellers used to leave a spore-cap on the top for luck. The habit outlived the road.'
    },
    {
      id: 'anchor', title: 'Anchor & Chain',
      text: 'Far too large for a moor barge, and the chain runs down, not out. Whatever it moored is still moored.'
    },
    {
      id: 'lantern', title: 'Wisp Lantern',
      text: 'Wardens hung these to mark the fordable shallows. The flame in it is not fire — it is a colony, the same colony as you, kept alive by three centuries of habit.'
    },
    {
      id: 'hull', title: 'Broken Hull',
      text: 'A walker, chest-deep in peat, hollowed out by roots. The cockpit is empty and the harness is fastened from the inside. They did not evacuate. They were assembled.'
    }
  ];
  props.LORE = LORE;

  function matStone() { return new THREE.MeshStandardMaterial({ map: TD.tex.stoneTex(), roughness: 0.95, metalness: 0.02, color: TD.C(0xa8a49c) }); }
  function matRust() { return new THREE.MeshStandardMaterial({ map: TD.tex.rust(), roughness: 0.85, metalness: 0.35, color: TD.C(0xb08060) }); }
  function matMetal() { return new THREE.MeshStandardMaterial({ map: TD.tex.metal(), roughness: 0.6, metalness: 0.6, color: TD.C(0x9aa2ab) }); }

  function buildRelic(id, mats) {
    var g = new THREE.Group();
    var m;
    switch (id) {
      case 'pylon':
        for (var l = 0; l < 4; l++) {
          m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.4, 0.12), mats.rust);
          m.position.set((l < 2 ? -0.5 : 0.5) * (1 - l * 0.06), 2.0, (l % 2 ? -0.5 : 0.5));
          g.add(m);
        }
        for (var b = 0; b < 3; b++) {
          m = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.09, 1.25), mats.rust);
          m.position.y = 0.7 + b * 1.35; g.add(m);
        }
        g.rotation.z = 0.16; g.rotation.x = -0.08;
        break;
      case 'bell':
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.42, 10), mats.stone);
        m.position.y = 0.2; g.add(m);
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.72, 1.05, 12, 1, true), mats.metal);
        m.material = mats.rust; m.position.set(0.18, 0.95, 0.05); m.rotation.z = 0.55; g.add(m);
        break;
      case 'warden':
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.3, 8), mats.stone); m.position.y = 0.15; g.add(m);
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 1.7, 8), mats.stone); m.position.y = 1.1; g.add(m);
        m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mats.stone); m.position.y = 2.1; m.scale.y = 1.15; g.add(m);
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 2.3, 6), mats.stone);
        m.position.set(0.42, 1.15, 0.1); m.rotation.z = 0.12; g.add(m);
        g.rotation.x = 0.07;
        break;
      case 'monolith':
        m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.1, 0.42), new THREE.MeshStandardMaterial({
          map: TD.tex.glyph(), emissiveMap: TD.tex.glyph(), emissive: TD.C(0x2ad6a8), emissiveIntensity: 0.0,
          roughness: 0.9, metalness: 0.05, color: TD.C(0x7f8a86)
        }));
        m.position.y = 1.5; g.add(m); glowMats.push(m.material);
        g.rotation.z = -0.09;
        break;
      case 'cart':
        m = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.62, 0.85), mats.rust); m.position.y = 0.55; g.add(m);
        m = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 6), new THREE.MeshStandardMaterial({
          color: TD.C(0x8a3820), emissive: TD.C(0xff5a1e), emissiveIntensity: 0.0, roughness: 0.7
        }));
        m.position.y = 0.86; m.scale.y = 0.5; g.add(m); glowMats.push(m.material);
        for (var w = 0; w < 4; w++) {
          m = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 10), mats.metal);
          m.rotation.x = Math.PI / 2;
          m.position.set(w < 2 ? -0.5 : 0.5, 0.25, w % 2 ? -0.42 : 0.42); g.add(m);
        }
        m = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.06, 0.1), mats.rust); m.position.set(0, 0.06, -0.42); g.add(m);
        m = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.06, 0.1), mats.rust); m.position.set(0, 0.06, 0.42); g.add(m);
        g.rotation.z = 0.05;
        break;
      case 'vent':
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.56, 1.5, 10), mats.rust); m.position.y = 0.75; g.add(m);
        m = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 6, 12), mats.metal);
        m.rotation.x = Math.PI / 2; m.position.y = 1.5; g.add(m);
        g.userData.smoke = new THREE.Vector3(0, 1.7, 0);
        break;
      case 'milestone':
        m = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.2, 0.3), mats.stone); m.position.y = 0.6; g.add(m);
        m = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), mats.stone); m.position.y = 1.2; g.add(m);
        g.rotation.z = 0.22; g.rotation.x = 0.1;
        break;
      case 'anchor':
        m = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.0, 0.18), mats.rust); m.position.y = 0.8; m.rotation.z = 0.5; g.add(m);
        m = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.13, 6, 10, Math.PI), mats.rust);
        m.position.set(-0.45, 0.25, 0); m.rotation.set(0, 0, 2.6); g.add(m);
        for (var c = 0; c < 5; c++) {
          m = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.05, 5, 8), mats.rust);
          m.position.set(0.6 + c * 0.28, 0.9 - c * 0.16, 0.05 * c);
          m.rotation.set(c % 2 ? 1.4 : 0, 0.3, 0.6); g.add(m);
        }
        break;
      case 'lantern':
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 2.2, 6), mats.rust); m.position.y = 1.1; g.add(m);
        m = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshStandardMaterial({
          color: TD.C(0x9ef7dd), emissive: TD.C(0x35f0c0), emissiveIntensity: 0.0, roughness: 0.35,
          transparent: true, opacity: 0.9
        }));
        m.position.set(0.16, 2.05, 0); g.add(m); glowMats.push(m.material);
        g.rotation.z = 0.12;
        break;
      default: // hull
        m = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 1.3), mats.rust); m.position.y = 0.5; m.rotation.z = 0.24; g.add(m);
        m = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 1.6, 8), mats.metal);
        m.position.set(-1.0, 0.9, 0.2); m.rotation.set(0.3, 0, 1.1); g.add(m);
        m = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), new THREE.MeshStandardMaterial({
          color: TD.C(0x2a1a16), emissive: TD.C(0xff4a12), emissiveIntensity: 0.0, roughness: 0.5
        }));
        m.position.set(0.7, 1.0, 0.25); g.add(m); glowMats.push(m.material);
        break;
    }
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return g;
  }

  /* ---------------- build ---------------- */
  props.build = function (scene, seed, quality) {
    var rng = TD.RNG(seed ^ 0x77aa33);
    var N = TD.GRID;
    var reserved = TD.path.reserved;
    var density = quality.propDensity;
    var noise = TD.Noise(seed + 17);

    var trees = [], snags = [], rocks = [], reeds = [], shrooms = [], tufts = [];

    for (var z = 0; z < N; z++) {
      for (var x = 0; x < N; x++) {
        var i = TD.idx(x, z);
        if (reserved[i]) continue;
        var kind = TD.cellKind[i];
        var wx = TD.cellToWorldX(x) + rng.range(-0.6, 0.6);
        var wz = TD.cellToWorldZ(z) + rng.range(-0.6, 0.6);
        var h = TD.terrain.heightAt(wx, wz);
        var slope = TD.terrain.slopeAt(wx, wz);
        var forest = noise.fbm(wx * 0.035, wz * 0.035, 3) * 0.5 + 0.5;

        if (kind === G.GROUND) {
          if (slope < 0.16 && rng.next() < forest * 0.42 * density) {
            trees.push({ x: wx, z: wz, y: h, s: rng.range(0.8, 1.55), yaw: rng.range(0, 6.283), type: rng.chance(0.55) ? 0 : 1 });
            TD.cellKind[i] = G.PROP;
          } else if (rng.next() < 0.07 * density) {
            rocks.push({ x: wx, z: wz, y: h, s: rng.range(0.45, 1.25), yaw: rng.range(0, 6.283) });
            TD.cellKind[i] = G.PROP;
          } else {
            if (rng.next() < 0.30 * density) tufts.push({ x: wx, z: wz, y: h, s: rng.range(0.5, 1.1), yaw: rng.range(0, 6.283) });
            if (rng.next() < 0.035 * density) shrooms.push({ x: wx, z: wz, y: h, s: rng.range(0.5, 1.2), yaw: rng.range(0, 6.283) });
          }
        } else if (kind === G.CLIFF) {
          if (rng.next() < 0.55 * density) rocks.push({ x: wx, z: wz, y: h, s: rng.range(0.7, 1.8), yaw: rng.range(0, 6.283) });
        } else if (kind === G.SHALLOW) {
          if (rng.next() < 0.34 * density) reeds.push({ x: wx, z: wz, y: h, s: rng.range(0.6, 1.3), yaw: rng.range(0, 6.283) });
          if (rng.next() < 0.05 * density) snags.push({ x: wx, z: wz, y: h, s: rng.range(0.7, 1.3), yaw: rng.range(0, 6.283) });
        } else if (kind === G.DEEP) {
          if (rng.next() < 0.02 * density) snags.push({ x: wx, z: wz, y: h, s: rng.range(0.8, 1.4), yaw: rng.range(0, 6.283) });
        }
      }
    }

    var group = new THREE.Group();
    group.name = 'props';
    scene.add(group);
    props.group = group;

    function instanced(geo, mat, list, alignBlend, castShadow) {
      if (!list.length) return null;
      var im = new THREE.InstancedMesh(geo, mat, list.length);
      im.castShadow = !!castShadow; im.receiveShadow = true;
      for (var k = 0; k < list.length; k++) {
        var it = list[k];
        _pos.set(it.x, it.y, it.z);
        alignQuat(it.x, it.z, alignBlend, it.yaw);
        _scl.set(it.s, it.s, it.s);
        _m.compose(_pos, _q, _scl);
        im.setMatrixAt(k, _m);
      }
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
      return im;
    }

    var barkMat = new THREE.MeshStandardMaterial({ map: TD.tex.bark(), roughness: 1.0, color: TD.C(0xa08a68) });
    var leafMat = swayify(new THREE.MeshStandardMaterial({ color: TD.C(0x3f6b32), roughness: 0.9, flatShading: true }), 0.030);
    var leafMat2 = swayify(new THREE.MeshStandardMaterial({ color: TD.C(0x5a7c38), roughness: 0.9, flatShading: true }), 0.026);
    var reedMat = swayify(new THREE.MeshStandardMaterial({ color: TD.C(0x6b7f3c), roughness: 0.95, flatShading: true }), 0.055);
    var tuftMat = swayify(new THREE.MeshStandardMaterial({
      color: TD.C(0x5d8a3c), roughness: 1.0, side: THREE.DoubleSide,
      map: TD.tex.leaf(), transparent: true, alphaTest: 0.4
    }), 0.05);
    var rockMat = new THREE.MeshStandardMaterial({ map: TD.tex.stoneTex(), roughness: 0.95, color: TD.C(0x8f8e88), flatShading: true });
    var shroomMat = new THREE.MeshStandardMaterial({ color: TD.C(0x2b6f6a), emissive: TD.C(0x27e0b4), emissiveIntensity: 0.0, roughness: 0.6 });
    glowMats.push(shroomMat);

    var typeA = trees.filter(function (t) { return t.type === 0; });
    var typeB = trees.filter(function (t) { return t.type === 1; });

    instanced(new THREE.CylinderGeometry(0.11, 0.20, 2.6, 6).translate(0, 1.3, 0), barkMat, typeA, 0.5, true);
    instanced(new THREE.ConeGeometry(0.95, 3.0, 7).translate(0, 3.4, 0), leafMat, typeA, 0.5, true);
    instanced(new THREE.CylinderGeometry(0.14, 0.24, 1.9, 6).translate(0, 0.95, 0), barkMat, typeB, 0.5, true);
    instanced(new THREE.IcosahedronGeometry(1.15, 0).translate(0, 2.5, 0), leafMat2, typeB, 0.5, true);
    instanced(new THREE.CylinderGeometry(0.08, 0.19, 2.9, 5).translate(0, 1.2, 0), barkMat, snags, 0.35, true);
    instanced(new THREE.DodecahedronGeometry(0.62, 0), rockMat, rocks, 1.0, true);
    instanced(new THREE.ConeGeometry(0.10, 1.5, 4).translate(0, 0.75, 0), reedMat, reeds, 0.25, false);
    instanced(new THREE.PlaneGeometry(0.7, 0.7).translate(0, 0.3, 0), tuftMat, tufts, 0.9, false);
    instanced(new THREE.SphereGeometry(0.20, 8, 6, 0, 6.283, 0, 1.7).translate(0, 0.28, 0), shroomMat, shrooms, 1.0, false);

    /* ---- relics ---- */
    var mats = { stone: matStone(), rust: matRust(), metal: matMetal() };
    var placed = 0, attempts = 0;
    var order = LORE.slice();
    while (placed < LORE.length && attempts++ < 4000) {
      var cx = rng.int(3, N - 4), cz = rng.int(3, N - 4);
      var ci = TD.idx(cx, cz);
      if (reserved[ci]) continue;
      var k2 = TD.cellKind[ci];
      if (k2 !== G.GROUND && k2 !== G.SHALLOW && k2 !== G.PROP) continue;
      var db = Math.abs(cx - TD.terrain.base.x) + Math.abs(cz - TD.terrain.base.z);
      if (db < 7) continue;
      var too = false;
      for (var p = 0; p < loreObjects.length; p++) {
        if (Math.abs(loreObjects[p].cx - cx) + Math.abs(loreObjects[p].cz - cz) < 9) { too = true; break; }
      }
      if (too) continue;
      var def = order[placed];
      var relic = buildRelic(def.id, mats);
      var rwx = TD.cellToWorldX(cx), rwz = TD.cellToWorldZ(cz);
      var ry = TD.terrain.heightAt(rwx, rwz);
      relic.position.set(rwx, ry - 0.1, rwz);
      relic.quaternion.premultiply(alignQuat(rwx, rwz, 0.8, rng.range(0, 6.283)));
      group.add(relic);
      TD.cellKind[ci] = G.PROP;
      loreObjects.push({ cx: cx, cz: cz, def: def, obj: relic, wx: rwx, wz: rwz, wy: ry });
      placed++;
    }
    props.lore = loreObjects;

    /* ---- night motes ---- */
    var count = quality.fireflies;
    var gp = new THREE.BufferGeometry();
    var arr = new Float32Array(count * 3);
    var phase = new Float32Array(count);
    for (var f = 0; f < count; f++) {
      var fx = rng.range(-TD.HALF, TD.HALF), fz = rng.range(-TD.HALF, TD.HALF);
      arr[f * 3] = fx; arr[f * 3 + 1] = Math.max(TD.terrain.heightAt(fx, fz), 0) + rng.range(0.4, 2.6); arr[f * 3 + 2] = fz;
      phase[f] = rng.range(0, 6.283);
    }
    gp.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    var pmat = new THREE.PointsMaterial({
      size: 0.42, map: TD.tex.spark(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: TD.C(0x9dffe0), opacity: 0
    });
    glowPoints = new THREE.Points(gp, pmat);
    glowPoints.userData.phase = phase;
    glowPoints.userData.base = arr.slice(0);
    scene.add(glowPoints);

    return props;
  };

  props.loreAt = function (x, z) {
    for (var i = 0; i < loreObjects.length; i++) {
      if (loreObjects[i].cx === x && loreObjects[i].cz === z) return loreObjects[i];
    }
    return null;
  };

  var t = 0;
  props.update = function (dt, night) {
    t += dt;
    var i;
    for (i = 0; i < swayMats.length; i++) {
      if (swayMats[i].userData.u) swayMats[i].userData.u.uTime.value = t;
    }
    for (i = 0; i < glowMats.length; i++) {
      glowMats[i].emissiveIntensity = 0.15 + night * 2.1;
    }
    if (glowPoints) {
      glowPoints.material.opacity = night * 0.9;
      var pos = glowPoints.geometry.attributes.position;
      var base = glowPoints.userData.base, ph = glowPoints.userData.phase;
      for (i = 0; i < ph.length; i++) {
        pos.array[i * 3] = base[i * 3] + Math.sin(t * 0.5 + ph[i]) * 1.4;
        pos.array[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.9 + ph[i] * 2.1) * 0.35;
        pos.array[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.43 + ph[i] * 1.3) * 1.4;
      }
      pos.needsUpdate = true;
    }
  };

})(window.TD);

/* ============================================================
   VELL — particle & impact effects (pooled)
   ============================================================ */
(function (TD) {
  'use strict';

  var fx = TD.fx = {};
  var MAX = 1200;
  var sys = [];          // two systems: additive sparks, soft smoke
  var rings = [], RING_N = 26;
  var scene = null;

  var P_VERT = [
    'attribute vec3 aColor;',
    'attribute float aSize;',
    'attribute float aAlpha;',
    'varying vec3 vCol;',
    'varying float vA;',
    'void main(){',
    '  vCol = aColor; vA = aAlpha;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = aSize * (300.0 / max(-mv.z, 0.1));',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var P_FRAG = [
    'uniform sampler2D uMap;',
    'varying vec3 vCol;',
    'varying float vA;',
    'void main(){',
    '  vec4 t = texture2D(uMap, gl_PointCoord);',
    '  if (t.a * vA < 0.01) discard;',
    '  gl_FragColor = vec4(vCol, t.a * vA);',
    '  #include <tonemapping_fragment>',
    '  #include <encodings_fragment>',
    '}'
  ].join('\n');

  function makeSystem(count, map, blending) {
    var geo = new THREE.BufferGeometry();
    var pos = new Float32Array(count * 3);
    var col = new Float32Array(count * 3);
    var siz = new Float32Array(count);
    var alp = new Float32Array(count);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alp, 1));
    var mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map } },
      vertexShader: P_VERT, fragmentShader: P_FRAG,
      transparent: true, depthWrite: false, blending: blending
    });
    var pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    return {
      pts: pts, geo: geo, count: count, head: 0,
      vx: new Float32Array(count), vy: new Float32Array(count), vz: new Float32Array(count),
      life: new Float32Array(count), max: new Float32Array(count),
      grav: new Float32Array(count), drag: new Float32Array(count),
      size0: new Float32Array(count), size1: new Float32Array(count),
      alive: 0
    };
  }

  fx.init = function (sc, quality) {
    scene = sc;
    MAX = quality.particles;
    sys[0] = makeSystem(MAX, TD.tex.spark(), THREE.AdditiveBlending);
    sys[1] = makeSystem(Math.floor(MAX * 0.5), TD.tex.smoke(), THREE.NormalBlending);
    scene.add(sys[0].pts); scene.add(sys[1].pts);

    var ringGeo = new THREE.PlaneGeometry(1, 1);
    for (var i = 0; i < RING_N; i++) {
      var m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        map: TD.tex.ring(), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0, side: THREE.DoubleSide, fog: false
      }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.userData = { t: 0, life: 0, r0: 1, r1: 4, vertical: false };
      scene.add(m);
      rings.push(m);
    }
    return fx;
  };

  function emit(s, x, y, z, vx, vy, vz, r, g, b, size0, size1, life, grav, drag) {
    var i = s.head;
    s.head = (s.head + 1) % s.count;
    var p = s.geo.attributes.position.array;
    var c = s.geo.attributes.aColor.array;
    p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z;
    c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b;
    s.vx[i] = vx; s.vy[i] = vy; s.vz[i] = vz;
    s.life[i] = life; s.max[i] = life;
    s.grav[i] = grav; s.drag[i] = drag;
    s.size0[i] = size0; s.size1[i] = size1;
    s.geo.attributes.aSize.array[i] = size0;
    s.geo.attributes.aAlpha.array[i] = 1;
  }

  var _c = new THREE.Color();
  function colorOf(col) { _c.set(col).convertSRGBToLinear(); return _c; }

  /* generic burst of sparks */
  fx.burst = function (pos, opt) {
    opt = opt || {};
    var n = opt.count || 12;
    var col = colorOf(opt.color === undefined ? 0xffffff : opt.color);
    var spd = opt.speed || 4;
    var life = opt.life || 0.6;
    var size = opt.size || 0.5;
    var spread = opt.spread === undefined ? 1 : opt.spread;
    var grav = opt.gravity === undefined ? -6 : opt.gravity;
    var dir = opt.dir;
    for (var i = 0; i < n; i++) {
      var vx = (Math.random() - 0.5) * 2, vy = (Math.random() - 0.5) * 2, vz = (Math.random() - 0.5) * 2;
      var len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
      vx /= len; vy /= len; vz /= len;
      if (dir) { vx = TD.util.lerp(dir.x, vx, spread); vy = TD.util.lerp(dir.y, vy, spread); vz = TD.util.lerp(dir.z, vz, spread); }
      var s = spd * (0.5 + Math.random());
      var jitter = 0.9 + Math.random() * 0.5;
      emit(sys[0], pos.x, pos.y, pos.z, vx * s, vy * s + (opt.lift || 0), vz * s,
        col.r * jitter, col.g * jitter, col.b * jitter,
        size * (0.6 + Math.random() * 0.8), (opt.size1 === undefined ? 0 : opt.size1),
        life * (0.7 + Math.random() * 0.6), grav, opt.drag === undefined ? 1.4 : opt.drag);
    }
  };

  fx.smoke = function (pos, opt) {
    opt = opt || {};
    var n = opt.count || 6;
    var col = colorOf(opt.color === undefined ? 0x9aa0a6 : opt.color);
    var life = opt.life || 1.6;
    var size = opt.size || 1.2;
    for (var i = 0; i < n; i++) {
      emit(sys[1],
        pos.x + (Math.random() - 0.5) * (opt.spread || 0.5),
        pos.y + Math.random() * 0.3,
        pos.z + (Math.random() - 0.5) * (opt.spread || 0.5),
        (Math.random() - 0.5) * 0.7, (opt.rise === undefined ? 1.1 : opt.rise) + Math.random() * 0.6, (Math.random() - 0.5) * 0.7,
        col.r, col.g, col.b,
        size * (0.6 + Math.random() * 0.5), size * (2.0 + Math.random()),
        life * (0.7 + Math.random() * 0.6), opt.gravity === undefined ? 0.2 : opt.gravity, 0.6);
    }
  };

  fx.trail = function (pos, color, size) {
    emit(sys[0], pos.x, pos.y, pos.z, 0, 0.2, 0,
      colorOf(color).r, _c.g, _c.b, size || 0.32, 0, 0.28, 0, 2.0);
  };

  fx.splash = function (x, z, scale) {
    var y = TD.WATER_Y + 0.05;
    fx.burst({ x: x, y: y, z: z }, {
      count: Math.round(8 * (scale || 1)), color: 0xbfeaf0, speed: 2.6 * (scale || 1),
      life: 0.5, size: 0.32, gravity: -9, lift: 1.6
    });
    fx.ring({ x: x, y: y + 0.02, z: z }, 0x9fe6f0, 0.4, 2.4 * (scale || 1), 0.55);
  };

  fx.ring = function (pos, color, r0, r1, life, vertical) {
    for (var i = 0; i < RING_N; i++) {
      var m = rings[i];
      if (m.visible) continue;
      m.visible = true;
      m.position.set(pos.x, pos.y, pos.z);
      m.material.color.copy(TD.C(color));
      m.material.opacity = 0.95;
      m.rotation.x = vertical ? 0 : -Math.PI / 2;
      m.scale.set(r0 * 2, r0 * 2, 1);
      m.userData.t = 0; m.userData.life = life || 0.5;
      m.userData.r0 = r0; m.userData.r1 = r1; m.userData.vertical = !!vertical;
      return m;
    }
    return null;
  };

  fx.beam = function (a, b, color, life, width) {
    var steps = Math.max(3, Math.floor(a.distanceTo(b) * 2.2));
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      emit(sys[0],
        TD.util.lerp(a.x, b.x, t) + (Math.random() - 0.5) * 0.12,
        TD.util.lerp(a.y, b.y, t) + (Math.random() - 0.5) * 0.12,
        TD.util.lerp(a.z, b.z, t) + (Math.random() - 0.5) * 0.12,
        0, 0.3, 0,
        colorOf(color).r, _c.g, _c.b, (width || 0.45), 0, life || 0.22, 0, 1.0);
    }
  };

  fx.update = function (dt) {
    for (var s = 0; s < sys.length; s++) {
      var S = sys[s];
      var pos = S.geo.attributes.position.array;
      var siz = S.geo.attributes.aSize.array;
      var alp = S.geo.attributes.aAlpha.array;
      var any = false;
      for (var i = 0; i < S.count; i++) {
        if (S.life[i] <= 0) { if (alp[i] !== 0) { alp[i] = 0; any = true; } continue; }
        any = true;
        S.life[i] -= dt;
        var t = 1 - TD.util.clamp(S.life[i] / S.max[i], 0, 1);
        S.vy[i] += S.grav[i] * dt;
        var d = Math.max(0, 1 - S.drag[i] * dt);
        S.vx[i] *= d; S.vy[i] *= d; S.vz[i] *= d;
        pos[i * 3] += S.vx[i] * dt;
        pos[i * 3 + 1] += S.vy[i] * dt;
        pos[i * 3 + 2] += S.vz[i] * dt;
        siz[i] = TD.util.lerp(S.size0[i], S.size1[i], t);
        alp[i] = s === 0 ? (1 - t) * (1 - t) : Math.sin(TD.util.clamp(t, 0, 1) * Math.PI) * 0.55;
        if (S.life[i] <= 0) alp[i] = 0;
      }
      if (any) {
        S.geo.attributes.position.needsUpdate = true;
        S.geo.attributes.aSize.needsUpdate = true;
        S.geo.attributes.aAlpha.needsUpdate = true;
        S.geo.attributes.aColor.needsUpdate = true;
      }
    }
    for (var r = 0; r < rings.length; r++) {
      var m = rings[r];
      if (!m.visible) continue;
      m.userData.t += dt;
      var tt = m.userData.t / m.userData.life;
      if (tt >= 1) { m.visible = false; m.material.opacity = 0; continue; }
      var rad = TD.util.lerp(m.userData.r0, m.userData.r1, TD.util.smooth(tt));
      m.scale.set(rad * 2, rad * 2, 1);
      m.material.opacity = (1 - tt) * 0.9;
    }
  };

})(window.TD);

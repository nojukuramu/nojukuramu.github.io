/* ============================================================
   VELL — structures: growing, promoting, and firing the Bloom
   ============================================================ */
(function (TD) {
  'use strict';

  var build = TD.build = {};
  var scene = null;
  var list = build.list = [];
  var projectiles = [];
  var geoCache = {};
  var heart = null;

  var _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

  function geo(key, make) { return geoCache[key] || (geoCache[key] = make()); }

  /* ---------------- meshes ---------------- */
  function glowSprite(color, size) {
    var s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TD.tex.spark(), color: TD.C(color), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0.5, fog: false
    }));
    s.scale.set(size, size, 1);
    return s;
  }

  function towerMesh(def, level, asc) {
    var g = new THREE.Group();
    var m = def.model;
    var col = TD.C(def.color);
    var glow = TD.C(def.glow);
    var body = new THREE.MeshStandardMaterial({ color: col, roughness: 0.72, metalness: 0.05, flatShading: true });
    var headMat = new THREE.MeshStandardMaterial({
      color: col.clone().multiplyScalar(0.86), roughness: 0.58, metalness: 0.06,
      emissive: glow, emissiveIntensity: 0.12, flatShading: true
    });
    var barkMat = new THREE.MeshStandardMaterial({ map: TD.tex.bark(), color: TD.C(0x9c8b6c), roughness: 1.0 });

    var hBase = m.base === 'trunk' ? 1.7 : (m.base === 'stump' ? 0.5 : 1.25);
    var rTop = m.base === 'trunk' ? 0.30 : (m.base === 'stump' ? 0.55 : 0.16);
    var rBot = m.base === 'trunk' ? 0.52 : (m.base === 'stump' ? 0.72 : 0.26);

    var stalk = new THREE.Mesh(geo('stalk' + m.base, function () {
      return new THREE.CylinderGeometry(rTop, rBot, hBase, 8).translate(0, hBase / 2, 0);
    }), barkMat);
    stalk.castShadow = true; stalk.receiveShadow = true;
    g.add(stalk);

    // root flare
    var roots = new THREE.Mesh(geo('roots', function () {
      return new THREE.ConeGeometry(0.62, 0.34, 8).translate(0, 0.17, 0);
    }), body);
    roots.castShadow = true;
    g.add(roots);

    var head;
    var hs = m.headScale || 1;
    switch (m.head) {
      case 'cone':
        head = new THREE.Mesh(geo('h_cone', function () { return new THREE.ConeGeometry(0.42, 0.95, 7); }), headMat);
        break;
      case 'lance':
        head = new THREE.Mesh(geo('h_lance', function () { return new THREE.ConeGeometry(0.24, 1.6, 6); }), headMat);
        break;
      case 'spike':
        head = new THREE.Mesh(geo('h_spike', function () { return new THREE.ConeGeometry(0.20, 2.0, 5); }), headMat);
        break;
      case 'bulb':
        head = new THREE.Mesh(geo('h_bulb', function () { return new THREE.SphereGeometry(0.5, 10, 8); }), headMat);
        break;
      case 'crystal':
        head = new THREE.Mesh(geo('h_crystal', function () { return new THREE.OctahedronGeometry(0.5, 0); }), headMat);
        break;
      case 'ring':
        head = new THREE.Mesh(geo('h_ring', function () { return new THREE.TorusGeometry(0.55, 0.14, 6, 14); }), headMat);
        head.rotation.x = Math.PI / 2;
        break;
      default:
        head = new THREE.Mesh(geo('h_cap', function () {
          return new THREE.SphereGeometry(0.55, 12, 8, 0, 6.283, 0, 1.45);
        }), headMat);
    }
    head.scale.setScalar(hs);
    head.position.y = hBase + (m.head === 'ring' ? 0.1 : 0.28) * hs;
    head.castShadow = true;
    g.add(head);

    // radial arms / petals
    if (m.arms) {
      var armMat = new THREE.MeshStandardMaterial({ color: col.clone().multiplyScalar(0.8), roughness: 0.8, flatShading: true, emissive: glow, emissiveIntensity: 0.12 });
      var armGeo = geo('arm', function () { return new THREE.ConeGeometry(0.10, 0.62, 4).translate(0, 0.31, 0); });
      for (var a = 0; a < m.arms; a++) {
        var arm = new THREE.Mesh(armGeo, armMat);
        var ang = a / m.arms * 6.283;
        arm.position.set(Math.cos(ang) * 0.42 * hs, hBase + 0.12, Math.sin(ang) * 0.42 * hs);
        arm.rotation.set(Math.cos(ang) * 0.55, -ang, Math.sin(ang) * -0.55);
        arm.castShadow = true;
        g.add(arm);
      }
    }

    var gs = glowSprite(def.glow, 1.5 + hs * 0.5);
    gs.position.y = head.position.y;
    g.add(gs);

    g.userData.head = head;
    g.userData.glowSprite = gs;
    g.userData.headMat = headMat;
    g.userData.muzzleY = head.position.y + 0.2 * hs;
    return g;
  }

  function trapMesh(def) {
    var g = new THREE.Group();
    var col = TD.C(def.color), glow = TD.C(def.glow);
    var plateMat = new THREE.MeshStandardMaterial({
      color: col.clone().multiplyScalar(1.25), roughness: 0.9, metalness: 0.0,
      emissive: glow, emissiveIntensity: 0.12, flatShading: true
    });
    var plate = new THREE.Mesh(geo('trapPlate', function () {
      return new THREE.CylinderGeometry(0.92, 0.98, 0.10, 12).translate(0, 0.05, 0);
    }), plateMat);
    plate.receiveShadow = true;
    g.add(plate);

    var accentMat = new THREE.MeshStandardMaterial({ color: glow, emissive: glow, emissiveIntensity: 0.6, roughness: 0.5, flatShading: true });
    var i, ang, m;
    switch (def.model.pattern) {
      case 'vine':
        for (i = 0; i < 4; i++) {
          m = new THREE.Mesh(geo('vineArc', function () { return new THREE.TorusGeometry(0.62, 0.055, 5, 12, 3.6); }), accentMat);
          m.rotation.set(Math.PI / 2, 0, i * 1.57);
          m.position.y = 0.11;
          g.add(m);
        }
        break;
      case 'ember':
        for (i = 0; i < 7; i++) {
          ang = i / 7 * 6.283;
          m = new THREE.Mesh(geo('emberShard', function () { return new THREE.BoxGeometry(0.42, 0.05, 0.10); }), accentMat);
          m.position.set(Math.cos(ang) * 0.42, 0.11, Math.sin(ang) * 0.42);
          m.rotation.y = -ang;
          g.add(m);
        }
        break;
      case 'wisp':
        m = new THREE.Mesh(geo('wispOrb', function () { return new THREE.OctahedronGeometry(0.24, 0); }), accentMat);
        m.position.y = 0.72;
        g.add(m);
        g.userData.orb = m;
        break;
      case 'maw':
        for (i = 0; i < 9; i++) {
          ang = i / 9 * 6.283;
          m = new THREE.Mesh(geo('mawTooth', function () { return new THREE.ConeGeometry(0.09, 0.42, 4); }), accentMat);
          m.position.set(Math.cos(ang) * 0.58, 0.22, Math.sin(ang) * 0.58);
          m.rotation.set(Math.cos(ang) * 0.5, 0, Math.sin(ang) * -0.5);
          g.add(m);
        }
        break;
      default: // mat
        m = new THREE.Mesh(geo('matRing', function () { return new THREE.TorusGeometry(0.72, 0.06, 5, 16); }), accentMat);
        m.rotation.x = Math.PI / 2; m.position.y = 0.11;
        g.add(m);
    }
    var gs = glowSprite(def.glow, 1.5);
    gs.position.y = 0.35;
    gs.material.opacity = 0.28;
    g.add(gs);
    g.userData.glowSprite = gs;
    g.userData.plateMat = plateMat;
    return g;
  }

  function wallMesh(def) {
    var g = new THREE.Group();
    var col = TD.C(def.color);
    var mat = new THREE.MeshStandardMaterial({
      color: col.clone().multiplyScalar(def.model.style === 'stone' ? 1.35 : 2.4), roughness: 0.95, metalness: 0.02,
      map: def.model.style === 'stone' ? TD.tex.stoneTex() : TD.tex.bark(),
      emissive: TD.C(def.glow), emissiveIntensity: 0.0, flatShading: false
    });
    var n = def.model.style === 'stone' ? 3 : 5;
    for (var i = 0; i < n; i++) {
      var m;
      if (def.model.style === 'stone') {
        m = new THREE.Mesh(geo('wallBlock', function () { return new THREE.BoxGeometry(0.56, 0.72, 0.72); }), mat);
        m.position.set(-0.55 + i * 0.55, 0.36 + (i % 2) * 0.12, (i % 2 ? 0.06 : -0.06));
        m.rotation.y = (i % 2 ? 0.12 : -0.09);
      } else {
        m = new THREE.Mesh(geo('wallPost', function () { return new THREE.CylinderGeometry(0.13, 0.16, 1.5, 6); }), mat);
        m.position.set(-0.68 + i * 0.34, 0.72 + (i % 2) * 0.12, (i % 2 ? 0.08 : -0.08));
        m.rotation.z = (i % 2 ? 0.06 : -0.05);
      }
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
    }
    var gs = glowSprite(def.glow, 1.1);
    gs.position.y = 0.9; gs.material.opacity = 0.18;
    g.add(gs);
    g.userData.glowSprite = gs;
    g.userData.mat = mat;
    return g;
  }

  function buildMeshFor(s) {
    var def = TD.defs.get(s.type);
    if (def.kind === 'tower') return towerMesh(def, s.level, s.asc);
    if (def.kind === 'trap') return trapMesh(def);
    return wallMesh(def);
  }

  /* ---------------- placement ---------------- */
  build.init = function (sc) {
    scene = sc;
    list.length = 0;
    projectiles.length = 0;
    buildHeart();
  };

  function buildHeart() {
    var b = TD.terrain.base;
    var g = new THREE.Group();
    var podMat = new THREE.MeshStandardMaterial({
      color: TD.C(0x9fd4b6), roughness: 0.45, metalness: 0.0,
      emissive: TD.C(0x35f0b0), emissiveIntensity: 0.4, flatShading: true
    });
    var rootMat = new THREE.MeshStandardMaterial({ map: TD.tex.bark(), color: TD.C(0x8c7a5c), roughness: 1.0 });

    var mound = new THREE.Mesh(new THREE.SphereGeometry(2.6, 18, 10, 0, 6.283, 0, 1.1), rootMat);
    mound.scale.y = 0.5; mound.castShadow = true; mound.receiveShadow = true;
    g.add(mound);

    var core = new THREE.Mesh(new THREE.SphereGeometry(1.25, 18, 14), podMat);
    core.position.y = 1.5; core.castShadow = true;
    g.add(core);

    for (var i = 0; i < 6; i++) {
      var ang = i / 6 * 6.283;
      var petal = new THREE.Mesh(new THREE.ConeGeometry(0.34, 2.2, 5), podMat);
      petal.position.set(Math.cos(ang) * 1.2, 1.5, Math.sin(ang) * 1.2);
      petal.rotation.set(Math.cos(ang) * 0.55, -ang, Math.sin(ang) * -0.55);
      petal.castShadow = true;
      g.add(petal);
    }
    var gs = glowSprite(0x5cffcc, 7.5);
    gs.position.y = 1.7; gs.material.opacity = 0.35;
    g.add(gs);

    g.position.set(b.wx, TD.terrain.heightAt(b.wx, b.wz), b.wz);
    scene.add(g);
    heart = { group: g, core: core, glow: gs, mat: podMat };
    build.heart = heart;
  }

  build.canPlace = function (kind, x, z) {
    if (!TD.inBounds(x, z)) return { ok: false, why: 'Outside the moor.' };
    var i = TD.idx(x, z);
    var k = TD.cellKind[i];
    if (TD.struct[i]) return { ok: false, why: 'Something already grows here.' };
    if (k === TD.G.BASE) return { ok: false, why: 'That is the Heartspore itself.' };
    if (k === TD.G.SPAWN) return { ok: false, why: 'The Rust comes through there.' };
    if (k === TD.G.DEEP) return { ok: false, why: 'Too deep to root.' };
    if (k === TD.G.CLIFF) return { ok: false, why: 'The rock will not take a root.' };
    if (k === TD.G.PROP) return { ok: false, why: 'Old growth is in the way.' };
    if (kind === 'trap') {
      if (k !== TD.G.GROUND && k !== TD.G.SHALLOW) return { ok: false, why: 'Traps need walkable ground.' };
    } else if (k !== TD.G.GROUND) {
      return { ok: false, why: 'Only firm ground will hold this.' };
    }
    var cost = TD.defs.rootCost(kind);
    if (TD.state.sap < cost) return { ok: false, why: 'Not enough sap (' + cost + ').', cost: cost };
    if (kind !== 'trap') {
      var enemyCells = TD.enemies ? TD.enemies.occupiedCells() : null;
      if (TD.path.wouldBlock([i], enemyCells)) {
        return { ok: false, why: 'This would seal the way. The Rust must always have a road.' };
      }
    }
    return { ok: true, cost: cost };
  };

  build.place = function (kind, x, z, silent) {
    var check = build.canPlace(kind, x, z);
    if (!check.ok) { if (!silent) TD.bus.emit('toast', { text: check.why, bad: true }); return null; }
    var typeId = TD.defs.roots[kind];
    var def = TD.defs.get(typeId);
    var wx = TD.cellToWorldX(x), wz = TD.cellToWorldZ(z);
    var wy = TD.terrain.heightAt(wx, wz);

    var s = {
      type: typeId, kind: kind, level: 1, asc: 0,
      x: x, z: z, wx: wx, wz: wz, wy: wy,
      blocks: kind !== 'trap',
      cool: 0, tick: 0, aim: 0,
      hp: 0, hpMax: 0
    };
    s.stats = TD.defs.statsFor(s);
    if (kind === 'wall') { s.hpMax = s.stats.hp; s.hp = s.hpMax; }

    s.group = buildMeshFor(s);
    s.group.position.set(wx, wy, wz);
    s.group.quaternion.copy(TD.props.alignQuat(wx, wz, kind === 'trap' ? 1.0 : 0.55, Math.random() * 6.283));
    scene.add(s.group);

    TD.struct[TD.idx(x, z)] = s;
    list.push(s);
    TD.state.sap -= check.cost;
    TD.path.rebuild();

    TD.fx.burst({ x: wx, y: wy + 0.5, z: wz }, {
      count: 22, color: def.glow, speed: 4.5, life: 0.7, size: 0.5, lift: 2.2, gravity: -7
    });
    TD.fx.ring({ x: wx, y: wy + 0.06, z: wz }, def.glow, 0.5, 3.0, 0.6);
    TD.fx.smoke({ x: wx, y: wy + 0.2, z: wz }, { count: 5, color: 0xcfe6d8, size: 0.9, life: 1.2 });
    TD.audio.play('place');
    TD.bus.emit('built', s);
    return s;
  };

  build.sell = function (s) {
    if (!s) return;
    var val = TD.defs.sellValue(s);
    TD.state.sap += val;
    removeStructure(s);
    TD.fx.burst({ x: s.wx, y: s.wy + 0.4, z: s.wz }, { count: 16, color: 0xffe08a, speed: 3.5, life: 0.6, size: 0.4, lift: 1.6 });
    TD.audio.play('sell');
    TD.bus.emit('toast', { text: 'Reclaimed ' + val + ' sap.' });
    TD.path.rebuild();
    TD.bus.emit('sold', s);
  };

  function removeStructure(s) {
    var i = list.indexOf(s);
    if (i >= 0) list.splice(i, 1);
    TD.struct[TD.idx(s.x, s.z)] = null;
    scene.remove(s.group);
    s.dead = true;
  }
  build.remove = removeStructure;

  /* ---------------- upgrade & promotion ---------------- */
  build.upgrade = function (s) {
    var cost = TD.defs.upgradeCost(s);
    if (TD.state.sap < cost) { TD.bus.emit('toast', { text: 'Not enough sap (' + cost + ').', bad: true }); return false; }
    var nextLevel = s.level + 1;
    if (nextLevel % 10 === 0) {
      var opts = TD.defs.promotionOptions(s);
      TD.bus.emit('promote', { s: s, options: opts, cost: cost });
      return 'promote';
    }
    TD.state.sap -= cost;
    applyLevel(s, nextLevel, s.type, s.asc);
    return true;
  };

  build.confirmPromotion = function (s, choiceId, cost) {
    if (TD.state.sap < cost) { TD.bus.emit('toast', { text: 'Not enough sap.', bad: true }); return false; }
    TD.state.sap -= cost;
    var asc = s.asc;
    var type = s.type;
    if (choiceId) type = choiceId; else asc = s.asc + 1;
    applyLevel(s, s.level + 1, type, asc);
    var def = TD.defs.get(type);
    TD.fx.burst({ x: s.wx, y: s.wy + 1.2, z: s.wz }, { count: 46, color: def.glow, speed: 7, life: 1.1, size: 0.7, lift: 3.4, gravity: -5 });
    TD.fx.ring({ x: s.wx, y: s.wy + 0.08, z: s.wz }, def.glow, 0.6, 6.0, 1.0);
    TD.audio.play('promote');
    TD.bus.emit('toast', { text: TD.defs.displayName(s) + ' — promoted.' });
    return true;
  };

  function applyLevel(s, level, type, asc) {
    var changed = (type !== s.type) || (asc !== s.asc);
    s.level = level; s.type = type; s.asc = asc;
    s.stats = TD.defs.statsFor(s);
    if (s.kind === 'wall') {
      var frac = s.hpMax > 0 ? s.hp / s.hpMax : 1;
      s.hpMax = s.stats.hp;
      s.hp = Math.max(s.hpMax * frac, s.hpMax * 0.5);
    }
    if (changed) {
      scene.remove(s.group);
      var q = s.group.quaternion.clone();
      s.group = buildMeshFor(s);
      s.group.position.set(s.wx, s.wy, s.wz);
      s.group.quaternion.copy(q);
      scene.add(s.group);
    }
    var grow = 1 + Math.min(0.55, (s.level - 1) * 0.012) + s.asc * 0.10;
    s.group.scale.setScalar(grow);
    TD.fx.burst({ x: s.wx, y: s.wy + 0.9, z: s.wz }, {
      count: 14, color: TD.defs.get(s.type).glow, speed: 3.4, life: 0.6, size: 0.42, lift: 2.0
    });
    TD.audio.play('upgrade');
    TD.bus.emit('structChanged', s);
  }

  /* ---------------- projectiles ---------------- */
  var projGeo = null, projMats = {};
  function spawnProjectile(s, target, dmg) {
    if (!projGeo) projGeo = new THREE.SphereGeometry(0.16, 6, 5);
    var def = TD.defs.get(s.type);
    var key = def.glow;
    if (!projMats[key]) {
      projMats[key] = new THREE.MeshBasicMaterial({ color: TD.C(def.glow), fog: false });
    }
    var mesh = new THREE.Mesh(projGeo, projMats[key]);
    var st = s.stats;
    var y = s.wy + (s.group.userData.muzzleY || 1.5) * s.group.scale.y;
    mesh.position.set(s.wx, y, s.wz);
    var sc = st.proj === 'sac' ? 2.0 : (st.proj === 'lance' ? 1.6 : 1.0);
    mesh.scale.set(sc, sc, sc);
    scene.add(mesh);
    projectiles.push({
      mesh: mesh, target: target, speed: st.projSpeed || 28, dmg: dmg,
      src: s, color: def.glow, life: 3.2, type: st.proj,
      splash: st.splash || 0, pierce: st.pierce || 0, hits: []
    });
  }

  function updateProjectiles(dt) {
    for (var i = projectiles.length - 1; i >= 0; i--) {
      var p = projectiles[i];
      p.life -= dt;
      var tgt = p.target;
      if (p.life <= 0 || !tgt || tgt.dead) {
        scene.remove(p.mesh); projectiles.splice(i, 1); continue;
      }
      _v.set(tgt.pos.x, tgt.pos.y + tgt.height * 0.5, tgt.pos.z).sub(p.mesh.position);
      var d = _v.length();
      var step = p.speed * dt;
      TD.fx.trail(p.mesh.position, p.color, p.type === 'sac' ? 0.5 : 0.3);
      if (d <= step) {
        impact(p, tgt);
        scene.remove(p.mesh);
        projectiles.splice(i, 1);
      } else {
        _v.multiplyScalar(step / d);
        p.mesh.position.add(_v);
      }
    }
  }

  function impact(p, tgt) {
    var s = p.src;
    var st = s.stats;
    var opts = { pierceArmor: st.pierceArmor || 0, source: s };
    TD.enemies.damage(tgt, p.dmg, opts);
    applyStatus(s, tgt);
    if (p.splash > 0) {
      var hit = TD.enemies.inRadius(tgt.pos, p.splash);
      for (var i = 0; i < hit.length; i++) {
        if (hit[i] === tgt) continue;
        TD.enemies.damage(hit[i], p.dmg * 0.6, opts);
        applyStatus(s, hit[i]);
      }
      TD.fx.ring({ x: tgt.pos.x, y: tgt.pos.y + 0.1, z: tgt.pos.z }, TD.defs.get(s.type).glow, 0.4, p.splash, 0.45);
    }
    TD.fx.burst({ x: tgt.pos.x, y: tgt.pos.y + tgt.height * 0.5, z: tgt.pos.z }, {
      count: p.splash ? 16 : 8, color: p.color, speed: p.splash ? 5 : 3.2, life: 0.42, size: 0.36, gravity: -6
    });
    TD.audio.play('hit');
  }

  function applyStatus(s, e) {
    var st = s.stats;
    if (st.slow) TD.enemies.addStatus(e, 'slow', st.slow, st.slowTime || 1.5);
    if (st.dot) TD.enemies.addStatus(e, 'dot', st.dot, st.dotTime || 2.0);
    if (st.stagger) TD.enemies.addStatus(e, 'root', 1, st.stagger);
  }

  /* ---------------- firing ---------------- */
  function pickTarget(s) {
    var best = null, bestScore = -1;
    var range = s.stats.range;
    var arr = TD.enemies.list;
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i];
      if (e.dead) continue;
      var dx = e.pos.x - s.wx, dz = e.pos.z - s.wz;
      var d2 = dx * dx + dz * dz;
      if (d2 > range * range) continue;
      // prefer whoever is closest to the Heartspore
      var score = 100000 - TD.path.distAt(e.cx, e.cz);
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  function fire(s, dt) {
    var st = s.stats;
    s.cool -= dt;
    if (st.proj === 'aura') {
      s.tick -= dt;
      if (s.tick <= 0) {
        s.tick = 1 / st.rate;
        var hit = TD.enemies.inRadius({ x: s.wx, y: s.wy, z: s.wz }, st.range);
        if (hit.length) {
          for (var i = 0; i < hit.length; i++) {
            TD.enemies.damage(hit[i], st.dmg, { pierceArmor: st.pierceArmor || 0, source: s });
            applyStatus(s, hit[i]);
          }
          TD.fx.ring({ x: s.wx, y: s.wy + 0.12, z: s.wz }, TD.defs.get(s.type).glow, 0.6, st.range, 0.5);
          TD.audio.play('aura');
        }
      }
      return;
    }
    if (s.cool > 0) return;
    var target = pickTarget(s);
    if (!target) return;
    s.cool = 1 / st.rate;
    s.aimTarget = target;

    var muzzle = _v2.set(s.wx, s.wy + (s.group.userData.muzzleY || 1.4) * s.group.scale.y, s.wz);

    if (st.proj === 'beam') {
      TD.fx.beam(muzzle, new THREE.Vector3(target.pos.x, target.pos.y + target.height * 0.5, target.pos.z),
        TD.defs.get(s.type).glow, 0.14, 0.4);
      TD.enemies.damage(target, st.dmg, { pierceArmor: st.pierceArmor || 0, source: s });
      applyStatus(s, target);
      TD.audio.play('beam');
    } else if (st.proj === 'arc') {
      var chained = [target];
      var cur = target, dmg = st.dmg;
      TD.fx.beam(muzzle, new THREE.Vector3(cur.pos.x, cur.pos.y + cur.height * 0.5, cur.pos.z), TD.defs.get(s.type).glow, 0.2, 0.5);
      TD.enemies.damage(cur, dmg, { pierceArmor: st.pierceArmor || 0, source: s });
      applyStatus(s, cur);
      for (var c = 1; c < (st.chain || 1); c++) {
        var near = TD.enemies.inRadius(cur.pos, st.chainRange || 5);
        var nxt = null;
        for (var n = 0; n < near.length; n++) {
          if (chained.indexOf(near[n]) === -1) { nxt = near[n]; break; }
        }
        if (!nxt) break;
        dmg *= (st.chainFalloff || 0.75);
        TD.fx.beam(
          new THREE.Vector3(cur.pos.x, cur.pos.y + cur.height * 0.5, cur.pos.z),
          new THREE.Vector3(nxt.pos.x, nxt.pos.y + nxt.height * 0.5, nxt.pos.z),
          TD.defs.get(s.type).glow, 0.2, 0.4);
        TD.enemies.damage(nxt, dmg, { pierceArmor: st.pierceArmor || 0, source: s });
        applyStatus(s, nxt);
        chained.push(nxt);
        cur = nxt;
      }
      TD.audio.play('arc');
    } else if (st.pierce) {
      // lance: everything along the line
      var dirx = target.pos.x - s.wx, dirz = target.pos.z - s.wz;
      var len = Math.hypot(dirx, dirz) || 1;
      dirx /= len; dirz /= len;
      var endx = s.wx + dirx * st.range, endz = s.wz + dirz * st.range;
      TD.fx.beam(muzzle, new THREE.Vector3(endx, s.wy + 1.0, endz), TD.defs.get(s.type).glow, 0.24, 0.55);
      var hits = TD.enemies.alongLine(s.wx, s.wz, endx, endz, 0.9, st.pierce);
      for (var h = 0; h < hits.length; h++) {
        TD.enemies.damage(hits[h], st.dmg, { pierceArmor: st.pierceArmor || 0, source: s });
        applyStatus(s, hits[h]);
      }
      TD.audio.play('lance');
    } else {
      spawnProjectile(s, target, st.dmg);
      TD.audio.play('shoot');
    }

    TD.fx.burst(muzzle, {
      count: 6, color: TD.defs.get(s.type).glow, speed: 2.4, life: 0.28, size: 0.34, gravity: -1.5,
      dir: { x: (target.pos.x - s.wx) * 0.2, y: 0.4, z: (target.pos.z - s.wz) * 0.2 }, spread: 0.7
    });
  }

  /* ---------------- traps ---------------- */
  function updateTrap(s, dt) {
    var st = s.stats;
    s.tick -= dt;
    var here = TD.enemies.onCell(s.x, s.z);
    if (here.length && s.tick <= 0) {
      s.tick = st.tick || 0.5;
      for (var i = 0; i < here.length; i++) {
        var e = here[i];
        TD.enemies.damage(e, st.dmg || 0, { source: s });
        if (st.slow) TD.enemies.addStatus(e, 'slow', st.slow, 1.0);
        if (st.burn) TD.enemies.addStatus(e, 'dot', st.burn, st.burnTime || 2);
        if (st.vuln) TD.enemies.addStatus(e, 'vuln', st.vuln, st.vulnTime || 2);
        if (st.rootChance && Math.random() < st.rootChance) TD.enemies.addStatus(e, 'root', 1, st.rootTime || 1);
        if (st.fear && Math.random() < 0.3) TD.enemies.addStatus(e, 'fear', 1, 0.6);
      }
      if (st.blast) {
        var blasted = TD.enemies.inRadius({ x: s.wx, y: s.wy, z: s.wz }, st.blast);
        for (var b = 0; b < blasted.length; b++) TD.enemies.damage(blasted[b], (st.dmg || 0) * 0.5, { source: s });
        TD.fx.ring({ x: s.wx, y: s.wy + 0.1, z: s.wz }, TD.defs.get(s.type).glow, 0.4, st.blast, 0.5);
        TD.fx.burst({ x: s.wx, y: s.wy + 0.3, z: s.wz }, { count: 22, color: TD.defs.get(s.type).glow, speed: 6, life: 0.6, size: 0.5, lift: 2.5 });
        TD.audio.play('blast');
      } else {
        TD.fx.burst({ x: s.wx, y: s.wy + 0.25, z: s.wz }, {
          count: 6, color: TD.defs.get(s.type).glow, speed: 1.8, life: 0.45, size: 0.3, lift: 1.0, gravity: -2
        });
      }
      if (st.spread) {
        TD.fx.smoke({ x: s.wx, y: s.wy + 0.3, z: s.wz }, { count: 3, color: 0x6a5a4a, size: 0.7, life: 1.3 });
      }
      TD.audio.play('trap');
    }
    if (s.group.userData.orb) {
      s.group.userData.orb.rotation.y += dt * 1.6;
      s.group.userData.orb.position.y = 0.72 + Math.sin(TD.state.time * 2.2 + s.x) * 0.08;
    }
  }

  /* ---------------- walls ---------------- */
  build.damageStructure = function (s, amount, attacker) {
    if (s.kind !== 'wall' && s.kind !== 'tower') return;
    if (s.kind === 'tower') { s.hpMax = s.hpMax || Math.max(200, s.stats.dmg * 12); s.hp = s.hp || s.hpMax; }
    s.hp -= amount;
    if (s.stats.thorns && attacker) TD.enemies.damage(attacker, s.stats.thorns, { source: s });
    TD.fx.burst({ x: s.wx, y: s.wy + 0.6, z: s.wz }, { count: 5, color: 0xd8b070, speed: 2.6, life: 0.35, size: 0.28 });
    if (s.group.userData.mat) {
      var frac = TD.util.clamp(s.hp / s.hpMax, 0, 1);
      s.group.userData.mat.color.copy(TD.C(TD.defs.get(s.type).color)).multiplyScalar(0.45 + frac * 0.55);
    }
    if (s.hp <= 0) {
      TD.fx.burst({ x: s.wx, y: s.wy + 0.7, z: s.wz }, { count: 26, color: 0xc0a070, speed: 5.5, life: 0.8, size: 0.5, lift: 1.6 });
      TD.fx.smoke({ x: s.wx, y: s.wy + 0.5, z: s.wz }, { count: 8, color: 0x8a7a66, size: 1.2, life: 1.6 });
      TD.audio.play('break');
      TD.bus.emit('toast', { text: TD.defs.displayName(s) + ' has fallen.', bad: true });
      removeStructure(s);
      TD.path.rebuild();
    }
  };

  /* ---------------- update ---------------- */
  build.update = function (dt, night) {
    var i;
    for (i = 0; i < list.length; i++) {
      var s = list[i];
      if (s.dead) continue;
      if (s.kind === 'tower') {
        fire(s, dt);
        var head = s.group.userData.head;
        if (head) {
          if (s.aimTarget && !s.aimTarget.dead) {
            var ang = Math.atan2(s.aimTarget.pos.x - s.wx, s.aimTarget.pos.z - s.wz);
            head.rotation.y = TD.util.dampen(head.rotation.y, ang, 8, dt);
          } else {
            head.rotation.y += dt * 0.25;
          }
        }
        if (s.group.userData.headMat) s.group.userData.headMat.emissiveIntensity = 0.10 + night * 1.6;
      } else if (s.kind === 'trap') {
        updateTrap(s, dt);
        if (s.group.userData.plateMat) s.group.userData.plateMat.emissiveIntensity = 0.18 + night * 1.3;
      } else if (s.kind === 'wall') {
        if (s.group.userData.mat) s.group.userData.mat.emissiveIntensity = night * 0.35;
      }
      if (s.group.userData.glowSprite) {
        s.group.userData.glowSprite.material.opacity = 0.12 + night * 0.55;
      }
    }
    updateProjectiles(dt);

    if (heart) {
      var pulse = 1 + Math.sin(TD.state.time * 1.6) * 0.045;
      heart.core.scale.setScalar(pulse);
      heart.mat.emissiveIntensity = 0.35 + night * 1.6 + Math.sin(TD.state.time * 2.4) * 0.1;
      heart.glow.material.opacity = 0.24 + night * 0.5;
      var frac = TD.state.baseHP / TD.state.baseHPMax;
      heart.mat.emissive.copy(TD.C(frac > 0.5 ? 0x35f0b0 : (frac > 0.22 ? 0xf0d035 : 0xf05a35)));
      if (Math.random() < dt * 2.2) {
        TD.fx.burst({ x: heart.group.position.x, y: heart.group.position.y + 2.2, z: heart.group.position.z }, {
          count: 2, color: 0x7cffd8, speed: 0.7, life: 2.2, size: 0.3, gravity: 0.4, drag: 0.4
        });
      }
    }
  };

  build.structAt = function (x, z) {
    if (!TD.inBounds(x, z)) return null;
    return TD.struct[TD.idx(x, z)] || null;
  };

  build.clearAll = function () {
    for (var i = list.length - 1; i >= 0; i--) removeStructure(list[i]);
    for (var p = projectiles.length - 1; p >= 0; p--) scene.remove(projectiles[p].mesh);
    projectiles.length = 0;
    if (heart) { scene.remove(heart.group); heart = null; }
  };

  /* ghost preview */
  build.makeGhost = function (kind) {
    var def = TD.defs.get(TD.defs.roots[kind]);
    var g = kind === 'tower' ? towerMesh(def, 1, 0) : (kind === 'trap' ? trapMesh(def) : wallMesh(def));
    g.traverse(function (o) {
      if (o.isMesh) {
        o.castShadow = false; o.receiveShadow = false;
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.55;
        o.material.depthWrite = false;
      }
    });
    return g;
  };

})(window.TD);

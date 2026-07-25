/* ============================================================
   VELL — the Rust: spawning, marching, dying
   ============================================================ */
(function (TD) {
  'use strict';

  var E = TD.enemies = {};
  var scene = null;
  var list = E.list = [];
  var queue = [];
  var geoCache = {};
  var matCache = {};
  var spawnTimer = 0;

  var _v = new THREE.Vector3();
  var _q = new THREE.Quaternion();
  var _up = new THREE.Vector3(0, 1, 0);

  function geo(key, make) { return geoCache[key] || (geoCache[key] = make()); }
  function mat(key, make) { return matCache[key] || (matCache[key] = make()); }

  /* ---------------- meshes ---------------- */
  function bodyMat(def) {
    return mat('body' + def.color, function () {
      return new THREE.MeshStandardMaterial({
        map: TD.tex.rust(), color: TD.C(def.color), roughness: 0.82, metalness: 0.35, flatShading: true
      });
    });
  }
  function eyeMat(def) {
    return mat('eye' + def.glow, function () {
      return new THREE.MeshStandardMaterial({
        color: TD.C(def.glow), emissive: TD.C(def.glow), emissiveIntensity: 1.2, roughness: 0.4
      });
    });
  }

  function makeMesh(def) {
    var g = new THREE.Group();
    var bm = bodyMat(def), em = eyeMat(def);
    var s = def.size;
    var body, i, ang, leg, eye;
    var legs = [];

    switch (def.shape) {
      case 'skitter':
        body = new THREE.Mesh(geo('sk_body', function () { return new THREE.IcosahedronGeometry(0.34, 0); }), bm);
        body.position.y = 0.42; body.scale.set(1.3, 0.7, 1); g.add(body);
        for (i = 0; i < 6; i++) {
          ang = (i / 6) * 6.283;
          leg = new THREE.Mesh(geo('sk_leg', function () { return new THREE.CylinderGeometry(0.035, 0.02, 0.62, 4).translate(0, -0.31, 0); }), bm);
          leg.position.set(Math.cos(ang) * 0.3, 0.44, Math.sin(ang) * 0.3);
          leg.rotation.set(Math.sin(ang) * 0.7, 0, -Math.cos(ang) * 0.7);
          g.add(leg); legs.push(leg);
        }
        eye = new THREE.Mesh(geo('eye_s', function () { return new THREE.SphereGeometry(0.09, 6, 5); }), em);
        eye.position.set(0, 0.5, 0.36); g.add(eye);
        break;
      case 'hulk':
        body = new THREE.Mesh(geo('hu_body', function () { return new THREE.BoxGeometry(1.1, 1.0, 0.9); }), bm);
        body.position.y = 1.05; g.add(body);
        var shoulder = new THREE.Mesh(geo('hu_sh', function () { return new THREE.BoxGeometry(1.5, 0.35, 1.0); }), bm);
        shoulder.position.y = 1.5; g.add(shoulder);
        for (i = 0; i < 2; i++) {
          leg = new THREE.Mesh(geo('hu_leg', function () { return new THREE.BoxGeometry(0.32, 0.85, 0.34).translate(0, -0.42, 0); }), bm);
          leg.position.set(i ? 0.3 : -0.3, 0.9, 0); g.add(leg); legs.push(leg);
        }
        eye = new THREE.Mesh(geo('eye_b', function () { return new THREE.BoxGeometry(0.62, 0.10, 0.06); }), em);
        eye.position.set(0, 1.3, 0.47); g.add(eye);
        break;
      case 'wader':
        body = new THREE.Mesh(geo('wa_body', function () { return new THREE.CylinderGeometry(0.3, 0.42, 0.6, 7); }), bm);
        body.position.y = 1.5; g.add(body);
        for (i = 0; i < 4; i++) {
          ang = (i / 4) * 6.283 + 0.7;
          leg = new THREE.Mesh(geo('wa_leg', function () { return new THREE.CylinderGeometry(0.05, 0.03, 1.7, 5).translate(0, -0.85, 0); }), bm);
          leg.position.set(Math.cos(ang) * 0.26, 1.45, Math.sin(ang) * 0.26);
          leg.rotation.set(Math.sin(ang) * 0.28, 0, -Math.cos(ang) * 0.28);
          g.add(leg); legs.push(leg);
        }
        eye = new THREE.Mesh(geo('eye_s', function () { return new THREE.SphereGeometry(0.09, 6, 5); }), em);
        eye.position.set(0, 1.72, 0.2); g.add(eye);
        break;
      case 'orb':
        body = new THREE.Mesh(geo('or_body', function () { return new THREE.SphereGeometry(0.44, 12, 9); }), bm);
        body.position.y = 0.95; g.add(body);
        var ring = new THREE.Mesh(geo('or_ring', function () { return new THREE.TorusGeometry(0.62, 0.06, 6, 16); }), em);
        ring.position.y = 0.95; ring.rotation.x = 1.1; g.add(ring);
        g.userData.ring = ring;
        break;
      case 'boss':
        body = new THREE.Mesh(geo('bo_body', function () { return new THREE.BoxGeometry(1.5, 1.7, 1.2); }), bm);
        body.position.y = 1.9; g.add(body);
        var head = new THREE.Mesh(geo('bo_head', function () { return new THREE.BoxGeometry(0.8, 0.6, 0.7); }), bm);
        head.position.y = 3.0; g.add(head);
        for (i = 0; i < 2; i++) {
          var horn = new THREE.Mesh(geo('bo_horn', function () { return new THREE.ConeGeometry(0.14, 0.9, 5); }), em);
          horn.position.set(i ? 0.42 : -0.42, 3.4, 0); horn.rotation.z = i ? -0.4 : 0.4; g.add(horn);
        }
        for (i = 0; i < 2; i++) {
          leg = new THREE.Mesh(geo('bo_leg', function () { return new THREE.BoxGeometry(0.42, 1.2, 0.45).translate(0, -0.6, 0); }), bm);
          leg.position.set(i ? 0.42 : -0.42, 1.3, 0); g.add(leg); legs.push(leg);
        }
        eye = new THREE.Mesh(geo('eye_bo', function () { return new THREE.BoxGeometry(0.55, 0.14, 0.08); }), em);
        eye.position.set(0, 3.02, 0.38); g.add(eye);
        break;
      default: // walker
        body = new THREE.Mesh(geo('wk_body', function () { return new THREE.BoxGeometry(0.62, 0.7, 0.52); }), bm);
        body.position.y = 0.92; g.add(body);
        var hd = new THREE.Mesh(geo('wk_head', function () { return new THREE.BoxGeometry(0.36, 0.3, 0.34); }), bm);
        hd.position.y = 1.4; g.add(hd);
        for (i = 0; i < 2; i++) {
          leg = new THREE.Mesh(geo('wk_leg', function () { return new THREE.BoxGeometry(0.17, 0.62, 0.2).translate(0, -0.31, 0); }), bm);
          leg.position.set(i ? 0.17 : -0.17, 0.62, 0); g.add(leg); legs.push(leg);
        }
        eye = new THREE.Mesh(geo('eye_w', function () { return new THREE.BoxGeometry(0.26, 0.08, 0.05); }), em);
        eye.position.set(0, 1.42, 0.19); g.add(eye);
    }
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; } });
    g.scale.setScalar(s / 0.5);
    g.userData.legs = legs;
    g.userData.eyeMat = em;

    // health bar
    var bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: TD.C(0x201014), depthTest: false, transparent: true, opacity: 0.8, fog: false }));
    var fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: TD.C(0xff7a4a), depthTest: false, transparent: true, fog: false }));
    var barY = (def.shape === 'boss' ? 4.0 : def.shape === 'hulk' ? 2.1 : def.shape === 'wader' ? 2.1 : 1.8) / (s / 0.5);
    bg.position.set(0, barY, 0); bg.scale.set(1.5, 0.16, 1);
    fg.position.set(0, barY, 0.01); fg.scale.set(1.44, 0.10, 1);
    bg.renderOrder = 20; fg.renderOrder = 21;
    g.add(bg); g.add(fg);
    g.userData.bar = fg; g.userData.barBg = bg; g.userData.barW = 1.44;
    return g;
  }

  /* ---------------- spawning ---------------- */
  E.init = function (sc) {
    scene = sc;
    list.length = 0;
    queue.length = 0;
  };

  E.startWave = function (w) {
    var comp = TD.defs.waveComp(w);
    var scale = TD.defs.waveScale(w);
    var spawns = TD.terrain.spawns;
    queue.length = 0;
    var t = 0;
    var rng = TD.RNG(TD.state.seed + w * 7717);
    for (var i = 0; i < comp.length; i++) {
      for (var n = 0; n < comp[i].n; n++) {
        var sp = spawns[rng.int(0, spawns.length - 1)];
        queue.push({ type: comp[i].type, at: t, spawn: sp, scale: scale });
        t += TD.defs.enemies[comp[i].type].boss ? 2.2 : (0.55 + rng.next() * 0.4);
      }
    }
    queue.sort(function (a, b) { return a.at - b.at; });
    spawnTimer = 0;
    TD.state.waveActive = true;
  };

  function spawn(entry) {
    var def = TD.defs.enemies[entry.type];
    var sp = entry.spawn;
    var e = {
      type: entry.type, def: def,
      hpMax: def.hp * entry.scale.hp, hp: def.hp * entry.scale.hp,
      baseSpeed: def.speed * entry.scale.speed,
      bounty: Math.ceil(def.bounty * entry.scale.bounty),
      pos: new THREE.Vector3(
        sp.wx + (Math.random() - 0.5) * 1.6,
        0,
        sp.wz + (Math.random() - 0.5) * 1.6),
      height: def.size * 2.2,
      cx: sp.x, cz: sp.z,
      wx: 0, wz: 0,
      offX: (Math.random() - 0.5) * 0.9, offZ: (Math.random() - 0.5) * 0.9,
      status: {}, attackCd: 0, phase: Math.random() * 6.283,
      dead: false, mesh: makeMesh(def), facing: 0
    };
    e.pos.y = TD.terrain.heightAt(e.pos.x, e.pos.z);
    e.mesh.position.copy(e.pos);
    scene.add(e.mesh);
    list.push(e);
    TD.fx.burst({ x: e.pos.x, y: e.pos.y + 0.6, z: e.pos.z }, {
      count: 14, color: def.glow, speed: 3.6, life: 0.6, size: 0.42, lift: 1.4
    });
    TD.fx.smoke({ x: e.pos.x, y: e.pos.y + 0.3, z: e.pos.z }, { count: 4, color: 0x6a5850, size: 0.9, life: 1.2 });
    if (def.boss) { TD.audio.play('boss'); TD.bus.emit('toast', { text: def.name + ' has come up out of the foundry.', bad: true }); }
    return e;
  }

  /* ---------------- queries ---------------- */
  E.occupiedCells = function () {
    var out = [];
    for (var i = 0; i < list.length; i++) if (!list[i].dead) out.push(TD.idx(list[i].cx, list[i].cz));
    return out;
  };
  E.onCell = function (x, z) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e.dead && e.cx === x && e.cz === z) out.push(e);
    }
    return out;
  };
  E.inRadius = function (pos, r) {
    var out = [], r2 = r * r;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead) continue;
      var dx = e.pos.x - pos.x, dz = e.pos.z - pos.z;
      if (dx * dx + dz * dz <= r2) out.push(e);
    }
    return out;
  };
  E.alongLine = function (x0, z0, x1, z1, width, maxHits) {
    var out = [];
    var dx = x1 - x0, dz = z1 - z0;
    var len2 = dx * dx + dz * dz;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (e.dead) continue;
      var t = ((e.pos.x - x0) * dx + (e.pos.z - z0) * dz) / len2;
      if (t < 0 || t > 1) continue;
      var px = x0 + dx * t, pz = z0 + dz * t;
      var d = Math.hypot(e.pos.x - px, e.pos.z - pz);
      if (d <= width + e.def.size) out.push({ e: e, t: t });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out.slice(0, maxHits || out.length).map(function (o) { return o.e; });
  };

  /* ---------------- status & damage ---------------- */
  E.addStatus = function (e, key, value, time) {
    var cur = e.status[key];
    if (!cur || value >= cur.v) e.status[key] = { v: value, t: Math.max(time, cur ? cur.t : 0) };
    else cur.t = Math.max(cur.t, time * 0.6);
  };

  E.damage = function (e, amount, opts) {
    if (!e || e.dead) return;
    opts = opts || {};
    var armor = Math.max(0, (e.def.armor || 0) - (opts.pierceArmor || 0));
    var dmg = amount * (1 - armor);
    var vuln = e.status.vuln;
    if (vuln) dmg *= (1 + vuln.v);
    e.hp -= dmg;
    e.hitFlash = 0.12;
    if (e.hp <= 0) kill(e, true);
  };

  function kill(e, byPlayer) {
    if (e.dead) return;
    e.dead = true;
    var def = e.def;
    if (byPlayer) {
      TD.state.sap += e.bounty;
      TD.state.kills++;
      TD.bus.emit('bounty', { amount: e.bounty, pos: e.pos });
    }
    TD.fx.burst({ x: e.pos.x, y: e.pos.y + e.height * 0.5, z: e.pos.z }, {
      count: def.boss ? 70 : 22, color: def.glow, speed: def.boss ? 9 : 5, life: 0.9, size: 0.5, lift: 2.0, gravity: -8
    });
    TD.fx.burst({ x: e.pos.x, y: e.pos.y + e.height * 0.4, z: e.pos.z }, {
      count: def.boss ? 40 : 14, color: 0x8a5a3a, speed: 4, life: 1.1, size: 0.42, gravity: -10
    });
    TD.fx.smoke({ x: e.pos.x, y: e.pos.y + 0.4, z: e.pos.z }, { count: def.boss ? 16 : 6, color: 0x4a4038, size: def.boss ? 2.2 : 1.1, life: 1.8 });
    if (def.boss) TD.fx.ring({ x: e.pos.x, y: e.pos.y + 0.1, z: e.pos.z }, def.glow, 1, 12, 0.9);
    TD.audio.play(def.boss ? 'bossdie' : 'die');
    if (def.spawnOnDeath) {
      for (var i = 0; i < 4; i++) {
        var child = spawn({
          type: def.spawnOnDeath, spawn: { wx: e.pos.x + (Math.random() - 0.5) * 2, wz: e.pos.z + (Math.random() - 0.5) * 2, x: e.cx, z: e.cz },
          scale: TD.defs.waveScale(Math.max(1, TD.state.wave))
        });
        child.pos.y = TD.terrain.heightAt(child.pos.x, child.pos.z);
      }
    }
    scene.remove(e.mesh);
  }
  E.kill = kill;

  /* ---------------- movement & combat ---------------- */
  function nearestStructure(e, radius) {
    var best = null, bd = radius * radius;
    var l = TD.build.list;
    for (var i = 0; i < l.length; i++) {
      var s = l[i];
      if (s.dead || !s.blocks) continue;
      var dx = s.wx - e.pos.x, dz = s.wz - e.pos.z;
      var d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = s; }
    }
    return best;
  }

  function moveEnemy(e, dt) {
    var st = e.status;
    var slow = st.slow ? st.slow.v : 0;
    var rooted = !!st.root;
    var feared = !!st.fear;
    var speed = e.baseSpeed * (1 - slow);

    var cellKind = TD.cellKind[TD.idx(e.cx, e.cz)];
    var inWater = cellKind === TD.G.SHALLOW;
    if (inWater && !e.def.amphibious) speed *= 0.55;
    if (rooted) speed = 0;

    // where to?
    var goalX, goalZ;
    var ni = TD.path.nextCell(e.cx, e.cz);
    var atBase = (cellKind === TD.G.BASE);
    if (atBase) {
      goalX = TD.terrain.base.wx; goalZ = TD.terrain.base.wz;
    } else if (ni >= 0) {
      var nx = ni % TD.GRID, nz = (ni / TD.GRID) | 0;
      goalX = TD.cellToWorldX(nx) + e.offX;
      goalZ = TD.cellToWorldZ(nz) + e.offZ;
    } else {
      goalX = TD.terrain.base.wx; goalZ = TD.terrain.base.wz;
    }

    var dx = goalX - e.pos.x, dz = goalZ - e.pos.z;
    var d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;

    // wisplights tug them off the straight line
    var lure = null, lureD = 6.5;
    var bl = TD.build.list;
    for (var i = 0; i < bl.length; i++) {
      var s = bl[i];
      if (s.dead || s.kind !== 'trap' || !s.stats.lure) continue;
      var lx = s.wx - e.pos.x, lz = s.wz - e.pos.z;
      var ld = Math.hypot(lx, lz);
      if (ld < lureD && ld > 0.4) { lure = { x: lx / ld, z: lz / ld, d: ld }; lureD = ld; }
    }
    if (lure) {
      var w = 0.45 * (1 - lure.d / 6.5);
      dx = dx * (1 - w) + lure.x * w;
      dz = dz * (1 - w) + lure.z * w;
      var n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
    }
    if (feared) { dx = -dx; dz = -dz; speed *= 0.8; }

    // structures in the way (or the sapper's favourite pastime)
    e.attackCd -= dt;
    var blocker = null;
    if (e.def.structFirst) blocker = nearestStructure(e, 2.6);
    if (!blocker) {
      var ax = e.pos.x + dx * 1.1, az = e.pos.z + dz * 1.1;
      var acx = TD.worldToCellX(ax), acz = TD.worldToCellZ(az);
      if (TD.inBounds(acx, acz)) {
        var s2 = TD.struct[TD.idx(acx, acz)];
        if (s2 && s2.blocks) blocker = s2;
      }
    }
    if (blocker && !rooted) {
      if (e.attackCd <= 0) {
        e.attackCd = 1.0;
        TD.build.damageStructure(blocker, e.def.dmg, e);
        TD.fx.burst({ x: blocker.wx, y: blocker.wy + 0.7, z: blocker.wz }, {
          count: 8, color: e.def.glow, speed: 3, life: 0.4, size: 0.32
        });
        TD.audio.play('clash');
      }
      speed *= 0.15;
    }

    if (atBase) {
      if (e.attackCd <= 0) {
        e.attackCd = 1.0;
        TD.state.baseHP -= e.def.dmg;
        TD.fx.burst({ x: TD.terrain.base.wx, y: TD.terrain.base.y + 1.8, z: TD.terrain.base.wz }, {
          count: 20, color: 0xff5a3a, speed: 5, life: 0.7, size: 0.5, lift: 1.5
        });
        TD.fx.ring({ x: TD.terrain.base.wx, y: TD.terrain.base.y + 0.2, z: TD.terrain.base.wz }, 0xff6a3a, 1.5, 5, 0.5);
        TD.audio.play('basehit');
        TD.bus.emit('baseHit', e.def.dmg);
      }
      speed *= 0.2;
    }

    e.pos.x += dx * speed * dt;
    e.pos.z += dz * speed * dt;
    e.pos.x = TD.util.clamp(e.pos.x, -TD.HALF + 0.5, TD.HALF - 0.5);
    e.pos.z = TD.util.clamp(e.pos.z, -TD.HALF + 0.5, TD.HALF - 0.5);

    var groundY = TD.terrain.heightAt(e.pos.x, e.pos.z);
    var standY = groundY;
    if (groundY < TD.WATER_Y && !e.def.amphibious) standY = Math.max(groundY, TD.WATER_Y - 0.45);
    var bob = Math.sin(TD.state.time * (6 + e.baseSpeed) + e.phase) * (speed > 0.2 ? 0.055 : 0.01);
    e.pos.y = standY + bob;

    e.cx = TD.util.clamp(TD.worldToCellX(e.pos.x), 0, TD.GRID - 1);
    e.cz = TD.util.clamp(TD.worldToCellZ(e.pos.z), 0, TD.GRID - 1);

    // orientation, tilted onto the slope
    if (speed > 0.05) e.facing = Math.atan2(dx, dz);
    e.mesh.position.copy(e.pos);
    _q.copy(TD.props.alignQuat(e.pos.x, e.pos.z, 0.7, e.facing));
    e.mesh.quaternion.slerp(_q, Math.min(1, dt * 8));

    // legs
    var legs = e.mesh.userData.legs;
    if (legs && legs.length) {
      var t = TD.state.time * (3 + e.baseSpeed * 1.8) + e.phase;
      for (var L = 0; L < legs.length; L++) {
        legs[L].rotation.x = Math.sin(t + L * 1.9) * (speed > 0.15 ? 0.55 : 0.03);
      }
    }
    if (e.mesh.userData.ring) e.mesh.userData.ring.rotation.z += dt * 2.2;

    // wake in the shallows
    if (inWater && speed > 0.4 && Math.random() < dt * 5) {
      TD.fx.splash(e.pos.x, e.pos.z, 0.45);
    }
  }

  function updateStatuses(e, dt) {
    for (var k in e.status) {
      var s = e.status[k];
      s.t -= dt;
      if (k === 'dot') {
        e.hp -= s.v * dt;
        if (Math.random() < dt * 3) {
          TD.fx.burst({ x: e.pos.x, y: e.pos.y + e.height * 0.4, z: e.pos.z }, {
            count: 1, color: 0x9cff6a, speed: 0.6, life: 0.6, size: 0.26, gravity: 0.6
          });
        }
        if (e.hp <= 0) { kill(e, true); return; }
      }
      if (s.t <= 0) delete e.status[k];
    }
  }

  E.update = function (dt, night) {
    var i;
    // spawn queue
    if (TD.state.waveActive) {
      spawnTimer += dt;
      while (queue.length && queue[0].at <= spawnTimer) spawn(queue.shift());
    }

    for (i = list.length - 1; i >= 0; i--) {
      var e = list[i];
      if (e.dead) { list.splice(i, 1); continue; }
      updateStatuses(e, dt);
      if (e.dead) { list.splice(i, 1); continue; }
      moveEnemy(e, dt);

      // corrosite mends its neighbours
      if (e.def.healer) {
        e.healTick = (e.healTick || 0) - dt;
        if (e.healTick <= 0) {
          e.healTick = 1.0;
          var near = E.inRadius(e.pos, e.def.healRange);
          for (var n = 0; n < near.length; n++) {
            var o = near[n];
            if (o === e || o.hp >= o.hpMax) continue;
            o.hp = Math.min(o.hpMax, o.hp + e.def.healer * TD.defs.waveScale(TD.state.wave).hp);
            TD.fx.beam(
              new THREE.Vector3(e.pos.x, e.pos.y + 1, e.pos.z),
              new THREE.Vector3(o.pos.x, o.pos.y + 1, o.pos.z), 0xc06aff, 0.3, 0.28);
          }
        }
      }

      // health bar + night glow
      var frac = TD.util.clamp(e.hp / e.hpMax, 0, 1);
      var bar = e.mesh.userData.bar;
      bar.scale.x = e.mesh.userData.barW * frac;
      bar.position.x = -(e.mesh.userData.barW * (1 - frac)) / 2;
      bar.material.color.copy(TD.C(frac > 0.5 ? 0xffa04a : frac > 0.22 ? 0xff7a2a : 0xff3a2a));
      var visible = frac < 0.999;
      bar.visible = visible; e.mesh.userData.barBg.visible = visible;
      if (e.mesh.userData.eyeMat) e.mesh.userData.eyeMat.emissiveIntensity = 0.9 + night * 1.8;
      if (e.hitFlash > 0) { e.hitFlash -= dt; }
    }

    if (TD.state.waveActive && queue.length === 0 && list.length === 0) {
      TD.state.waveActive = false;
      TD.bus.emit('waveClear', TD.state.wave);
    }
  };

  E.clearAll = function () {
    for (var i = list.length - 1; i >= 0; i--) { scene.remove(list[i].mesh); }
    list.length = 0; queue.length = 0;
  };

  E.remaining = function () { return list.length + queue.length; };

})(window.TD);

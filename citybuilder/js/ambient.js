/* ambient.js
 * Decorative life: bird flocks by day, fireflies by night, chimney smoke
 * over industry, sailboats on the lake, and one slow hot-air balloon.
 * Everything here is cosmetic — nothing is serialized, nothing affects the
 * simulation, and every effect is pooled/instanced so the whole layer costs
 * a handful of draw calls. Each subsystem reads Lighting.nightFactor to
 * decide when it belongs on screen (birds roost at night, fireflies only
 * come out after dusk).
 */
(function (global) {
  "use strict";
  var util = Game.util, CFG = Game.CONFIG;

  var Ambient = {
    time: 0,

    init: function (scene) {
      this.group = new THREE.Group();
      this.group.name = "ambient";
      scene.add(this.group);
      this._buildBirds();
      this._buildFireflies();
      this._buildSmoke();
      this._buildBoats();
      this._buildBalloon();
      return this;
    },

    // ---------------- birds ----------------
    // Each flock is one InstancedMesh of a shallow "V" glider. Flocks orbit
    // a wander-center that re-targets every so often; a sinusoidal roll +
    // bob reads as wingbeats from city-camera distance.
    _buildBirds: function () {
      var wing = new THREE.BufferGeometry();
      wing.setAttribute("position", new THREE.Float32BufferAttribute([
        0, 0, 0.45, -0.62, 0.1, -0.28, -0.08, 0.02, -0.2,
        0, 0, 0.45, 0.08, 0.02, -0.2, 0.62, 0.1, -0.28
      ], 3));
      wing.computeVertexNormals();
      var mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x1d232c).convertSRGBToLinear(), side: THREE.DoubleSide });

      this.flocks = [];
      for (var f = 0; f < 3; f++) {
        var count = 6 + f * 2;
        var mesh = new THREE.InstancedMesh(wing, mat, count);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        this.group.add(mesh);
        var birds = [];
        for (var i = 0; i < count; i++) {
          birds.push({
            angle: Math.random() * Math.PI * 2,
            radius: 8 + Math.random() * 14,
            speed: 0.35 + Math.random() * 0.25,
            alt: Math.random() * 8,
            phase: Math.random() * Math.PI * 2
          });
        }
        this.flocks.push({
          mesh: mesh, birds: birds,
          center: new THREE.Vector3((Math.random() - 0.5) * 200, 40 + Math.random() * 18, (Math.random() - 0.5) * 200),
          target: new THREE.Vector3(),
          retarget: 0
        });
        this._retargetFlock(this.flocks[f]);
      }
      this._m4 = new THREE.Matrix4();
      this._q = new THREE.Quaternion();
      this._e = new THREE.Euler();
    },

    _retargetFlock: function (flock) {
      var half = CFG.WORLD_SIZE / 2 - 30;
      flock.target.set((Math.random() * 2 - 1) * half, 36 + Math.random() * 22, (Math.random() * 2 - 1) * half);
      flock.retarget = 18 + Math.random() * 20;
    },

    _updateBirds: function (dt, night) {
      var roost = night > 0.55; // birds vanish after dusk
      for (var f = 0; f < this.flocks.length; f++) {
        var flock = this.flocks[f];
        flock.mesh.visible = !roost;
        if (roost) continue;
        flock.retarget -= dt;
        if (flock.retarget <= 0) this._retargetFlock(flock);
        flock.center.lerp(flock.target, dt * 0.04);

        for (var i = 0; i < flock.birds.length; i++) {
          var b = flock.birds[i];
          b.angle += b.speed * dt;
          var x = flock.center.x + Math.cos(b.angle) * b.radius;
          var z = flock.center.z + Math.sin(b.angle) * b.radius;
          var y = flock.center.y + b.alt + Math.sin(this.time * 1.6 + b.phase) * 1.2;
          var heading = b.angle + Math.PI / 2; // tangent to the orbit
          var roll = Math.sin(this.time * 9 + b.phase) * 0.45;
          this._e.set(0, heading, roll);
          this._q.setFromEuler(this._e);
          this._m4.compose(new THREE.Vector3(x, y, z), this._q, new THREE.Vector3(1.6, 1.6, 1.6));
          flock.mesh.setMatrixAt(i, this._m4);
        }
        flock.mesh.instanceMatrix.needsUpdate = true;
      }
    },

    // ---------------- fireflies ----------------
    // One Points cloud clustered around a few trees; per-point vertex color
    // is rewritten each frame for asynchronous twinkle. Only lit after dusk.
    _buildFireflies: function () {
      var COUNT = 64;
      var geo = new THREE.BufferGeometry();
      this._flyPos = new Float32Array(COUNT * 3);
      this._flyCol = new Float32Array(COUNT * 3);
      this._flySeeds = [];
      for (var i = 0; i < COUNT; i++) this._flySeeds.push({ phase: Math.random() * Math.PI * 2, speed: 1.5 + Math.random() * 2.5, drift: Math.random() * Math.PI * 2 });
      geo.setAttribute("position", new THREE.BufferAttribute(this._flyPos, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(this._flyCol, 3));
      this.fireflyMat = new THREE.PointsMaterial({
        map: Procgen.glowSprite("rgba(210,255,140,1)", 32), size: 1.1, transparent: true, opacity: 0,
        vertexColors: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
      });
      this.fireflies = new THREE.Points(geo, this.fireflyMat);
      this.fireflies.frustumCulled = false;
      this.group.add(this.fireflies);
      this._seedFireflies();
    },

    _seedFireflies: function () {
      // cluster around living trees (fallback: scatter near map center)
      var spots = [];
      if (Game.Trees && Game.Trees.placed.length) {
        var alive = Game.Trees.placed.filter(function (t) { return !t.cleared; });
        for (var s = 0; s < 8 && alive.length; s++) {
          spots.push(alive[Math.floor(Math.random() * alive.length)]);
        }
      }
      for (var i = 0; i < this._flySeeds.length; i++) {
        var spot = spots.length ? spots[i % spots.length] : { x: (Math.random() - 0.5) * 80, z: (Math.random() - 0.5) * 80 };
        var a = Math.random() * Math.PI * 2, r = 1 + Math.random() * 6;
        var x = spot.x + Math.cos(a) * r, z = spot.z + Math.sin(a) * r;
        this._flyPos[i * 3] = x;
        this._flyPos[i * 3 + 1] = Game.Terrain.heightAt(x, z) + 0.6 + Math.random() * 2.2;
        this._flyPos[i * 3 + 2] = z;
      }
      this.fireflies.geometry.attributes.position.needsUpdate = true;
    },

    _updateFireflies: function (dt, night) {
      var vis = util.smoothstep(0.6, 0.85, night);
      this.fireflyMat.opacity = vis * 0.9;
      if (vis <= 0.01) return;
      for (var i = 0; i < this._flySeeds.length; i++) {
        var s = this._flySeeds[i];
        var tw = Math.max(0, Math.sin(this.time * s.speed + s.phase));
        tw = tw * tw;
        this._flyCol[i * 3] = 0.7 * tw;
        this._flyCol[i * 3 + 1] = 1.0 * tw;
        this._flyCol[i * 3 + 2] = 0.35 * tw;
        // lazy wander
        this._flyPos[i * 3] += Math.cos(this.time * 0.4 + s.drift) * dt * 0.5;
        this._flyPos[i * 3 + 1] += Math.sin(this.time * 0.7 + s.phase) * dt * 0.25;
        this._flyPos[i * 3 + 2] += Math.sin(this.time * 0.35 + s.drift) * dt * 0.5;
      }
      this.fireflies.geometry.attributes.color.needsUpdate = true;
      this.fireflies.geometry.attributes.position.needsUpdate = true;
    },

    // ---------------- chimney smoke ----------------
    // A pooled set of sprites shared by every emitter (power plants +
    // industrial lots). Puffs rise, drift with the wind, grow and fade.
    _buildSmoke: function () {
      this.smokeTex = Procgen.glowSprite("rgba(190,195,205,1)", 64);
      this.smokePool = [];
      this._smokeCap = 20;
      for (var i = 0; i < this._smokeCap; i++) {
        var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, opacity: 0, depthWrite: false }));
        spr.visible = false;
        this.group.add(spr);
        this.smokePool.push({ spr: spr, life: 0, maxLife: 0 });
      }
      this._smokeTimer = 0;
      this._wind = new THREE.Vector2(0.9, 0.35).normalize();
    },

    _emitters: function () {
      var out = [];
      Game.Buildings.services.forEach(function (s) {
        if (s.type === "power_plant") out.push({ x: s.x, z: s.z, y: Game.Terrain.heightAt(s.x, s.z) + 17, big: true });
      });
      var count = 0;
      Game.Buildings.cellBuildings.forEach(function (b) {
        if (b.type === "industrial" && count < 5) { out.push({ x: b.x, z: b.z, y: Game.Terrain.heightAt(b.x, b.z) + b.height + 0.5, big: false }); count++; }
      });
      return out;
    },

    _updateSmoke: function (dt) {
      this._smokeTimer -= dt;
      if (this._smokeTimer <= 0) {
        this._smokeTimer = 0.5 + Math.random() * 0.4;
        var emitters = this._emitters();
        if (emitters.length) {
          var e = emitters[Math.floor(Math.random() * emitters.length)];
          var free = this.smokePool.find(function (p) { return p.life <= 0; });
          if (free) {
            free.life = free.maxLife = e.big ? 5 : 3.5;
            free.big = e.big;
            free.spr.visible = true;
            free.spr.position.set(e.x + (Math.random() - 0.5), e.y, e.z + (Math.random() - 0.5));
          }
        }
      }
      var windX = this._wind.x, windZ = this._wind.y;
      for (var i = 0; i < this.smokePool.length; i++) {
        var p = this.smokePool[i];
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { p.spr.visible = false; p.spr.material.opacity = 0; continue; }
        var t = 1 - p.life / p.maxLife;
        p.spr.position.y += dt * (p.big ? 2.6 : 1.8);
        p.spr.position.x += windX * dt * 1.4;
        p.spr.position.z += windZ * dt * 1.4;
        var s = (p.big ? 3 : 1.8) + t * (p.big ? 7 : 4);
        p.spr.scale.set(s, s, 1);
        p.spr.material.opacity = Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.3;
      }
    },

    // ---------------- sailboats ----------------
    _buildBoats: function () {
      var hullMat = new THREE.Matrix4().makeTranslation(0, 0.25, 0);
      var boatGeo = Procgen.mergeGeoms([
        { geo: new THREE.BoxGeometry(0.9, 0.5, 2.6), color: "#7a5236", matrix: hullMat },
        { geo: new THREE.BoxGeometry(0.08, 2.6, 0.08), color: "#5a4630", matrix: new THREE.Matrix4().makeTranslation(0, 1.6, 0.2) },
        { geo: new THREE.ConeGeometry(0.9, 2.2, 3), color: "#f2efe6", matrix: new THREE.Matrix4().makeRotationY(Math.PI / 3).setPosition(0.02, 1.7, -0.35) }
      ]);
      var mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      this.boats = [];
      for (var i = 0; i < 3; i++) {
        var mesh = new THREE.Mesh(boatGeo, mat);
        mesh.castShadow = true;
        mesh.visible = false;
        this.group.add(mesh);
        this.boats.push({ mesh: mesh, heading: Math.random() * Math.PI * 2, speed: 1.2 + Math.random(), turn: 0, alive: false, phase: Math.random() * 6 });
      }
    },

    _findWaterSpot: function () {
      for (var tries = 0; tries < 24; tries++) {
        var half = CFG.WORLD_SIZE / 2 - 20;
        var x = (Math.random() * 2 - 1) * half, z = (Math.random() * 2 - 1) * half;
        if (Game.Terrain.heightAt(x, z) < Game.Terrain.waterLevel - 2.2) return { x: x, z: z };
      }
      return null;
    },

    _updateBoats: function (dt) {
      for (var i = 0; i < this.boats.length; i++) {
        var b = this.boats[i];
        if (!b.alive) {
          var spot = this._findWaterSpot();
          if (spot) {
            b.alive = true;
            b.mesh.visible = true;
            b.mesh.position.set(spot.x, CFG.WATER_LEVEL, spot.z);
          }
          continue;
        }
        b.turn += (Math.random() - 0.5) * dt * 0.8;
        b.turn = util.clamp(b.turn, -0.5, 0.5);
        b.heading += b.turn * dt;
        var nx = b.mesh.position.x + Math.sin(b.heading) * b.speed * dt;
        var nz = b.mesh.position.z + Math.cos(b.heading) * b.speed * dt;
        // steer away from shallows: probe ahead, turn hard if ground rises
        var probeX = b.mesh.position.x + Math.sin(b.heading) * 10;
        var probeZ = b.mesh.position.z + Math.cos(b.heading) * 10;
        if (Game.Terrain.heightAt(probeX, probeZ) > Game.Terrain.waterLevel - 1.6) {
          b.heading += dt * 1.6;
        } else {
          b.mesh.position.x = nx;
          b.mesh.position.z = nz;
        }
        b.mesh.position.y = CFG.WATER_LEVEL + 0.05 + Math.sin(this.time * 1.3 + b.phase) * 0.08;
        b.mesh.rotation.set(Math.sin(this.time * 1.1 + b.phase) * 0.04, b.heading, Math.sin(this.time * 0.9 + b.phase) * 0.05);
      }
    },

    // ---------------- hot-air balloon ----------------
    _buildBalloon: function () {
      var geo = Procgen.mergeGeoms([
        { geo: new THREE.SphereGeometry(3.2, 10, 8), color: "#d9503f", matrix: new THREE.Matrix4().makeTranslation(0, 6.4, 0) },
        { geo: new THREE.SphereGeometry(3.22, 10, 8, 0, Math.PI * 0.5), color: "#f0c040", matrix: new THREE.Matrix4().makeTranslation(0, 6.4, 0) },
        { geo: new THREE.CylinderGeometry(0.9, 1.4, 2.4, 8, 1, true), color: "#c04434", matrix: new THREE.Matrix4().makeTranslation(0, 3.2, 0) },
        { geo: new THREE.BoxGeometry(1.4, 1.1, 1.4), color: "#6b5138", matrix: new THREE.Matrix4().makeTranslation(0, 0.55, 0) }
      ]);
      this.balloon = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
      this.balloon.castShadow = true;
      this.group.add(this.balloon);
      this._balloonT = Math.random();
      this._balloonPath = this._newBalloonPath();
    },

    _newBalloonPath: function () {
      var half = CFG.WORLD_SIZE / 2;
      var a = Math.random() * Math.PI * 2;
      var from = new THREE.Vector3(Math.cos(a) * half * 1.1, 0, Math.sin(a) * half * 1.1);
      var to = new THREE.Vector3(-from.x + (Math.random() - 0.5) * 120, 0, -from.z + (Math.random() - 0.5) * 120);
      return { from: from, to: to };
    },

    _updateBalloon: function (dt, night) {
      this.balloon.visible = night < 0.7;
      this._balloonT += dt * 0.004 * Game.timeScale;
      if (this._balloonT >= 1) { this._balloonT = 0; this._balloonPath = this._newBalloonPath(); }
      var p = this._balloonPath;
      var x = util.lerp(p.from.x, p.to.x, this._balloonT);
      var z = util.lerp(p.from.z, p.to.z, this._balloonT);
      var y = 64 + Math.sin(this.time * 0.3) * 4;
      this.balloon.position.set(x, y, z);
    },

    // ---------------- construction dust ----------------
    // buildings.js calls this when a lot starts growing.
    puffAt: function (x, z) {
      var free = this.smokePool.find(function (p) { return p.life <= 0; });
      if (!free) return;
      free.life = free.maxLife = 1.4;
      free.big = false;
      free.spr.visible = true;
      free.spr.position.set(x, Game.Terrain.heightAt(x, z) + 1, z);
    },

    update: function (dt) {
      this.time += dt;
      var night = Game.Lighting.nightFactor;
      this._updateBirds(dt, night);
      this._updateFireflies(dt, night);
      this._updateSmoke(dt);
      this._updateBoats(dt);
      this._updateBalloon(dt, night);
    }
  };

  Game.Ambient = Ambient;
})(window);

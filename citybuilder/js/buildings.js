/* buildings.js
 * Two building systems live here:
 *  1) Procedural RCI growth — zoned, road-adjacent cells (from zoning.js)
 *     spawn low/mid/high density buildings over sim time, driven by RCI
 *     demand from economy.js. Buildings are rendered via a small grid of
 *     InstancedMesh "buckets" (zoneType x level x visual variant), each
 *     sharing one procedurally generated facade texture — so hundreds of
 *     buildings cost a handful of draw calls instead of one each.
 *     Simplification: night-window randomness is achieved by spreading
 *     buildings across several baked lit-window variants per bucket (each
 *     with a different pattern + dusk threshold) rather than a unique
 *     texture per building — see procgen.js buildingTexture().
 *  2) Direct-placement service buildings (power, water, police, fire,
 *     hospital, park, landmark) — few enough per city that individual
 *     meshes are simpler and cheap enough without instancing.
 */
(function (global) {
  "use strict";
  var util = Game.util, CFG = Game.CONFIG;

  var ZONE_HUE = { residential: 130, commercial: 205, industrial: 42 };
  var LEVELS = ["low", "mid", "high"];
  var LEVEL_RANGES = {
    low:  { footMin: 5, footMax: 7,  hMin: 4,  hMax: 8,  cap: 6  },
    mid:  { footMin: 6, footMax: 9,  hMin: 9,  hMax: 18, cap: 16 },
    high: { footMin: 8, footMax: 13, hMin: 20, hMax: 42, cap: 40 }
  };
  var VARIANTS_PER_BUCKET = 4;
  var BUCKET_CAPACITY = 48;

  var SERVICE_DEFS = {
    power_plant: { name: "Power Plant", cost: 4200, footprint: 14, coverage: 90, ico: "⚡" },
    water_tower: { name: "Water Tower", cost: 1800, footprint: 6,  coverage: 80, ico: "🚰" },
    police:      { name: "Police Station", cost: 1600, footprint: 8, coverage: 55, ico: "🚓" },
    fire:        { name: "Fire Station", cost: 1600, footprint: 8, coverage: 55, ico: "🚒" },
    hospital:    { name: "Hospital", cost: 3000, footprint: 10, coverage: 65, ico: "🏥" },
    park:        { name: "Park", cost: 500, footprint: 8, coverage: 30, ico: "🌳" },
    landmark:    { name: "Landmark", cost: 6000, footprint: 12, coverage: 0, ico: "🗼" }
  };

  var Buildings = {
    SERVICE_DEFS: SERVICE_DEFS,
    buckets: {},        // key "type_level_variant" -> {mesh, used, capacity, freeList}
    cellBuildings: new Map(), // "gx,gz" -> {type, level, variant, instanceIndex, growTimer}
    services: [],        // {id, type, x, z, rot, mesh}
    growAccumulator: 0,
    _nextServiceId: 1,
    boxGeo: null,

    init: function (scene, saved) {
      this.scene = scene;
      this.group = new THREE.Group();
      this.group.name = "buildings";
      scene.add(this.group);
      this.serviceGroup = new THREE.Group();
      this.group.add(this.serviceGroup);

      this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
      this.boxGeo.translate(0, 0.5, 0);

      this._buildBuckets();
      if (saved) this._loadFromSave(saved);
      return this;
    },

    _bucketKey: function (type, level, variant) { return type + "_" + level + "_" + variant; },

    _buildBuckets: function () {
      var self = this;
      ["residential", "commercial", "industrial"].forEach(function (type) {
        LEVELS.forEach(function (level) {
          for (var v = 0; v < VARIANTS_PER_BUCKET; v++) {
            self._makeBucket(type, level, v);
          }
        });
      });
    },

    _makeBucket: function (type, level, variant) {
      var hue = ZONE_HUE[type] + (variant - VARIANTS_PER_BUCKET / 2) * 6;
      var rows = level === "high" ? 16 : level === "mid" ? 10 : 6;
      var tex = Procgen.buildingTexture({ hue: hue, cols: 5, rows: rows, light: level === "high" ? 22 : 30, litChance: 0.28 + variant * 0.08 });
      var mat = new THREE.MeshLambertMaterial({
        map: tex.map, emissive: 0xfff2c0, emissiveMap: tex.emissiveMap, emissiveIntensity: 0
      });
      var mesh = new THREE.InstancedMesh(this.boxGeo, mat, BUCKET_CAPACITY);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.duskThreshold = 0.3 + variant * 0.12 + (level === "high" ? -0.05 : 0.05);
      this.group.add(mesh);
      var key = this._bucketKey(type, level, variant);
      this.buckets[key] = { mesh: mesh, used: 0, freeList: [], type: type, level: level, variant: variant };
    },

    _growBucketCapacity: function (bucket) {
      var oldMesh = bucket.mesh;
      var newCap = oldMesh.instanceMatrix.count + BUCKET_CAPACITY;
      var newMesh = new THREE.InstancedMesh(this.boxGeo, oldMesh.material, newCap);
      newMesh.count = oldMesh.count;
      newMesh.castShadow = true; newMesh.receiveShadow = true;
      newMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      newMesh.userData.duskThreshold = oldMesh.userData.duskThreshold;
      for (var i = 0; i < oldMesh.count; i++) {
        var m = new THREE.Matrix4();
        oldMesh.getMatrixAt(i, m);
        newMesh.setMatrixAt(i, m);
      }
      this.group.remove(oldMesh);
      this.group.add(newMesh);
      bucket.mesh = newMesh;
    },

    // ---------------- growth simulation ----------------
    update: function (dt) {
      this.growAccumulator += dt * Game.timeScale;
      if (this.growAccumulator < 1.1) return;
      var ticks = Math.floor(this.growAccumulator / 1.1);
      this.growAccumulator -= ticks * 1.1;
      for (var i = 0; i < Math.min(ticks, 3); i++) this._growthTick();
    },

    _growthTick: function () {
      var econ = Game.Economy;
      var creative = Game.mode === "creative";
      var demand = econ.demand;
      var types = ["residential", "commercial", "industrial"];
      var self = this;

      types.forEach(function (type) {
        var d = demand[type] / 100;
        var chance = creative ? 0.9 : util.clamp(d * 0.55, 0.02, 0.5);
        if (Math.random() > chance) return;
        var candidates = Game.Zoning.getUnbuiltCellsOfType(type);
        if (!candidates.length) return;
        var cell = candidates[Math.floor(Math.random() * candidates.length)];
        self._spawnBuilding(cell, "low");
      });

      // level-ups
      this.cellBuildings.forEach(function (b, key) {
        if (b.level === "high") return;
        var d = demand[b.type] / 100;
        var covered = creative || self._hasServiceCoverage(b.x, b.z);
        if (!covered && !creative) return;
        var chance = creative ? 0.35 : util.clamp(d * 0.12, 0, 0.18);
        if (Math.random() < chance) self._levelUp(key, b);
      });
    },

    _hasServiceCoverage: function (x, z) {
      var hasPower = false, hasWater = false;
      this.services.forEach(function (s) {
        var d = Math.hypot(s.x - x, s.z - z);
        if (s.type === "power_plant" && d < SERVICE_DEFS.power_plant.coverage) hasPower = true;
        if (s.type === "water_tower" && d < SERVICE_DEFS.water_tower.coverage) hasWater = true;
      });
      return hasPower && hasWater;
    },

    _spawnBuilding: function (cell, level) {
      var type = cell.type;
      var variant = Math.floor(Math.random() * VARIANTS_PER_BUCKET);
      var key = this._bucketKey(type, level, variant);
      var bucket = this.buckets[key];
      if (bucket.mesh.count >= bucket.mesh.instanceMatrix.count) this._growBucketCapacity(bucket);
      var idx = bucket.mesh.count++;

      var center = Game.Zoning.cellCenter(cell.gx, cell.gz);
      var range = LEVEL_RANGES[level];
      var foot = util.lerp(range.footMin, range.footMax, Math.random());
      var height = util.lerp(range.hMin, range.hMax, Math.random());
      var rot = Math.round(Math.random() * 3) * (Math.PI / 2);
      var groundY = Game.Terrain.heightAt(center.x, center.z);

      var m = new THREE.Matrix4();
      var q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      m.compose(new THREE.Vector3(center.x, groundY, center.z), q, new THREE.Vector3(foot, height, foot));
      bucket.mesh.setMatrixAt(idx, m);
      bucket.mesh.instanceMatrix.needsUpdate = true;

      var ck = Game.Zoning.key(cell.gx, cell.gz);
      this.cellBuildings.set(ck, {
        type: type, level: level, variant: variant, bucketKey: key, idx: idx,
        gx: cell.gx, gz: cell.gz, x: center.x, z: center.z, height: height, foot: foot
      });
      Game.Zoning.markBuilt(cell.gx, cell.gz, true);
      if (Game.Economy) Game.Economy.onBuildingGrown(type, level);
    },

    _levelUp: function (ck, b) {
      // remove old instance (swap-pop within its bucket), spawn a fresh one at next level
      this._removeInstance(b);
      var idx = LEVELS.indexOf(b.level);
      var nextLevel = LEVELS[Math.min(idx + 1, LEVELS.length - 1)];
      var cell = { type: b.type, gx: b.gx, gz: b.gz };
      this.cellBuildings.delete(ck);
      Game.Zoning.markBuilt(b.gx, b.gz, false);
      this._spawnBuilding(cell, nextLevel);
    },

    _removeInstance: function (b) {
      var bucket = this.buckets[b.bucketKey];
      var mesh = bucket.mesh;
      var last = mesh.count - 1;
      if (b.idx !== last) {
        var m = new THREE.Matrix4();
        mesh.getMatrixAt(last, m);
        mesh.setMatrixAt(b.idx, m);
        // find the record pointing at `last` and repoint it to b.idx
        this.cellBuildings.forEach(function (other) {
          if (other.bucketKey === b.bucketKey && other.idx === last) other.idx = b.idx;
        });
      }
      mesh.count = Math.max(0, last);
      mesh.instanceMatrix.needsUpdate = true;
    },

    removeAt: function (gx, gz) {
      var ck = Game.Zoning.key(gx, gz);
      var b = this.cellBuildings.get(ck);
      if (!b) return false;
      this._removeInstance(b);
      this.cellBuildings.delete(ck);
      return true;
    },

    bulldozeNear: function (x, z) {
      var best = null, bestD = 6;
      this.cellBuildings.forEach(function (b, key) {
        var d = Math.hypot(b.x - x, b.z - z);
        if (d < bestD) { bestD = d; best = key; }
      });
      if (best) {
        var b = this.cellBuildings.get(best);
        this._removeInstance(b);
        this.cellBuildings.delete(best);
        Game.Zoning.markBuilt(b.gx, b.gz, false);
        return true;
      }
      var svc = this.services.find(function (s) { return Math.hypot(s.x - x, s.z - z) < s.footprint * 0.8; });
      if (svc) { this.removeService(svc.id); return true; }
      return false;
    },

    updateNightLights: function (nightFactor) {
      Object.keys(this.buckets).forEach(function (key) {
        var bucket = Game.Buildings.buckets[key];
        var thresh = bucket.mesh.userData.duskThreshold;
        var t = util.smoothstep(thresh, thresh + 0.22, nightFactor);
        bucket.mesh.material.emissiveIntensity = t * 1.6;
      });
    },

    // ---------------- service buildings ----------------
    canPlaceService: function (type, x, z) {
      var def = SERVICE_DEFS[type];
      if (!def) return false;
      if (Game.mode !== "creative" && Game.Roads.distanceToNearestRoad(x, z) > 20) return false;
      if (!Game.Terrain.isFlatEnough(x, z, def.footprint * 0.6, 1.4)) return false;
      var h = Game.Terrain.heightAt(x, z);
      if (h < Game.Terrain.waterLevel + 0.4) return false;
      for (var i = 0; i < this.services.length; i++) {
        if (Math.hypot(this.services[i].x - x, this.services[i].z - z) < (def.footprint + this.services[i].footprint) * 0.6) return false;
      }
      return true;
    },

    placeService: function (type, x, z, rot) {
      var def = SERVICE_DEFS[type];
      if (!this.canPlaceService(type, x, z)) return null;
      if (Game.mode !== "creative") {
        if (!Game.Economy.spend(def.cost, def.name)) return null;
      }
      var mesh = this._buildServiceMesh(type);
      var y = Game.Terrain.heightAt(x, z);
      mesh.position.set(x, y, z);
      mesh.rotation.y = rot || 0;
      this.serviceGroup.add(mesh);
      var rec = { id: this._nextServiceId++, type: type, x: x, z: z, rot: rot || 0, footprint: def.footprint, mesh: mesh };
      this.services.push(rec);
      return rec;
    },

    removeService: function (id) {
      var i = this.services.findIndex(function (s) { return s.id === id; });
      if (i < 0) return;
      this.serviceGroup.remove(this.services[i].mesh);
      this.services.splice(i, 1);
    },

    _buildServiceMesh: function (type) {
      var g = new THREE.Group();
      var mats = {
        power_plant: 0x8a5a3d, water_tower: 0x6f8ba8, police: 0x2e4d8a,
        fire: 0xb23a2e, hospital: 0xe6e6ee, park: 0x3f6b34, landmark: 0xbfa14a
      };
      var color = mats[type] || 0x888888;
      var mainMat = new THREE.MeshLambertMaterial({ color: color });
      if (type === "park") {
        var base = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 0.3, 10), new THREE.MeshLambertMaterial({ color: 0x4a7a3a }));
        base.position.y = 0.15; g.add(base);
        for (var i = 0; i < 5; i++) {
          var tspr = new THREE.Sprite(new THREE.SpriteMaterial({ map: Procgen.treeTexture(), transparent: true }));
          var a = (i / 5) * Math.PI * 2;
          tspr.position.set(Math.cos(a) * 2.4, 2.2, Math.sin(a) * 2.4);
          tspr.scale.set(3.4, 3.4, 1);
          g.add(tspr);
        }
      } else if (type === "power_plant") {
        var box = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 10), mainMat);
        box.position.y = 3; g.add(box);
        for (i = 0; i < 2; i++) {
          var stack = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, 12, 8), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
          stack.position.set(-3 + i * 6, 12, 0);
          g.add(stack);
        }
      } else if (type === "water_tower") {
        var tank = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 4, 12), mainMat);
        tank.position.y = 10; g.add(tank);
        var leg = new THREE.CylinderGeometry(0.35, 0.35, 10, 6);
        for (i = 0; i < 4; i++) {
          var a2 = (i / 4) * Math.PI * 2;
          var l = new THREE.Mesh(leg, new THREE.MeshLambertMaterial({ color: 0x555555 }));
          l.position.set(Math.cos(a2) * 2.2, 5, Math.sin(a2) * 2.2);
          g.add(l);
        }
      } else if (type === "landmark") {
        var tierGeo = [ [6, 6, 4], [4.4, 4.4, 8], [2.6, 2.6, 14] ];
        var y = 0;
        tierGeo.forEach(function (t) {
          var mesh = new THREE.Mesh(new THREE.BoxGeometry(t[0], t[2], t[1]), new THREE.MeshLambertMaterial({ color: color }));
          mesh.position.y = y + t[2] / 2; g.add(mesh); y += t[2];
        });
      } else {
        var b = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 8), mainMat);
        b.position.y = 2.5; g.add(b);
        var roof = new THREE.Mesh(new THREE.ConeGeometry(6.2, 2, 4), new THREE.MeshLambertMaterial({ color: 0x333333 }));
        roof.position.y = 6; roof.rotation.y = Math.PI / 4; g.add(roof);
      }
      g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      return g;
    },

    // ---------------- aggregate stats for economy.js ----------------
    getStats: function () {
      var pop = 0, jobsCom = 0, jobsInd = 0, resCap = 0, comCap = 0, indCap = 0;
      this.cellBuildings.forEach(function (b) {
        var cap = LEVEL_RANGES[b.level].cap * (b.foot / 6);
        if (b.type === "residential") resCap += cap;
        else if (b.type === "commercial") comCap += cap;
        else if (b.type === "industrial") indCap += cap;
      });
      return { resCap: Math.round(resCap), comCap: Math.round(comCap), indCap: Math.round(indCap) };
    },

    getResidentialBuildings: function () {
      var out = [];
      this.cellBuildings.forEach(function (b) { if (b.type === "residential") out.push(b); });
      return out;
    },
    getWorkplaceBuildings: function () {
      var out = [];
      this.cellBuildings.forEach(function (b) { if (b.type === "commercial" || b.type === "industrial") out.push(b); });
      return out;
    },

    clearAll: function () {
      var self = this;
      this.services.forEach(function (s) { self.serviceGroup.remove(s.mesh); });
      this.services = [];
      this.cellBuildings.clear();
      Object.keys(this.buckets).forEach(function (key) {
        var bucket = self.buckets[key];
        self.group.remove(bucket.mesh);
        bucket.mesh.geometry === self.boxGeo ? null : bucket.mesh.geometry.dispose();
        bucket.mesh.material.dispose();
      });
      this.buckets = {};
      this._buildBuckets();
    },

    // ---------------- save/load ----------------
    getSaveState: function () {
      var cells = [];
      this.cellBuildings.forEach(function (b, key) { cells.push(Object.assign({ ck: key }, b)); });
      return {
        cells: cells.map(function (b) { return { gx: b.gx, gz: b.gz, type: b.type, level: b.level }; }),
        services: this.services.map(function (s) { return { type: s.type, x: s.x, z: s.z, rot: s.rot }; })
      };
    },
    _loadFromSave: function (data) {
      var self = this;
      (data.services || []).forEach(function (s) {
        var mesh = self._buildServiceMesh(s.type);
        var y = Game.Terrain.heightAt(s.x, s.z);
        mesh.position.set(s.x, y, s.z);
        mesh.rotation.y = s.rot || 0;
        self.serviceGroup.add(mesh);
        self.services.push({ id: self._nextServiceId++, type: s.type, x: s.x, z: s.z, rot: s.rot, footprint: SERVICE_DEFS[s.type].footprint, mesh: mesh });
      });
      (data.cells || []).forEach(function (c) {
        Game.Zoning.cells.set(Game.Zoning.key(c.gx, c.gz), { type: c.type, gx: c.gx, gz: c.gz, hasBuilding: false, level: 0 });
        self._spawnBuilding({ type: c.type, gx: c.gx, gz: c.gz }, c.level);
      });
    }
  };

  Game.Buildings = Buildings;
})(window);

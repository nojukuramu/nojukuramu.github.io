/* trees.js
 * Scattered low-poly vegetation. Two InstancedMeshes (broadleaf + conifer),
 * each instance a merged trunk+foliage geometry with vertex colors, so the
 * whole forest costs two draw calls at any tree count.
 *
 * Trees are decorative and deterministic: scattered from a fixed seed, never
 * serialized. City growth carves clearings — roads, buildings and services
 * call `clearNear` (and save-load replays every clearance via
 * `reapplyClearances`), which just zero-scales the instance, keeping the
 * buffers stable. Species selection biases conifers uphill for a natural
 * treeline read.
 */
(function (global) {
  "use strict";
  var util = Game.util, CFG = Game.CONFIG;
  var SEED = 917;
  var CAPACITY = 320; // max per species; quality tier trims the drawn count

  var Trees = {
    meshes: {},   // species -> InstancedMesh
    placed: [],   // {species, idx, x, z, scale, cleared}
    _m4: new THREE.Matrix4(),
    _q: new THREE.Quaternion(),
    _up: new THREE.Vector3(0, 1, 0),

    init: function (scene) {
      this.group = new THREE.Group();
      this.group.name = "trees";
      scene.add(this.group);

      var mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      var self = this;
      ["broadleaf", "conifer"].forEach(function (species) {
        var mesh = new THREE.InstancedMesh(Procgen.treeGeometry(species), mat, CAPACITY);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        self.group.add(mesh);
        self.meshes[species] = mesh;
      });

      this.rescatter();
      return this;
    },

    rescatter: function () {
      var rand = util.mulberry32(SEED);
      var terrain = Game.Terrain;
      var half = CFG.WORLD_SIZE / 2 - 8;
      this.placed = [];
      var counts = { broadleaf: 0, conifer: 0 };
      var attempts = CAPACITY * 2 * 4;

      for (var i = 0; i < attempts && counts.broadleaf + counts.conifer < CAPACITY * 2; i++) {
        var x = (rand() * 2 - 1) * half;
        var z = (rand() * 2 - 1) * half;
        var h = terrain.heightAt(x, z);
        if (h < terrain.waterLevel + 1.3) continue;
        if (h > CFG.MAX_HEIGHT * 0.7) continue;       // no trees on peaks
        if (terrain.slopeAt(x, z) > 0.5) continue;
        // clump: accept more readily near a previous acceptance (soft forest patches)
        var nearTree = false;
        for (var j = this.placed.length - 1; j >= Math.max(0, this.placed.length - 12); j--) {
          if (Math.hypot(this.placed[j].x - x, this.placed[j].z - z) < 18) { nearTree = true; break; }
        }
        if (!nearTree && rand() > 0.42) continue;

        var uphill = util.smoothstep(6, 22, h);
        var species = rand() < 0.25 + uphill * 0.55 ? "conifer" : "broadleaf";
        if (counts[species] >= CAPACITY) species = species === "conifer" ? "broadleaf" : "conifer";
        if (counts[species] >= CAPACITY) continue;

        this.placed.push({
          species: species, idx: counts[species]++,
          x: x, z: z,
          scale: (3.4 + rand() * 3.2) * (species === "conifer" ? 1.25 : 1),
          rot: rand() * Math.PI * 2,
          cleared: false
        });
      }

      this._writeAll();
      this._applyTierCount();
    },

    _writeAll: function () {
      var self = this;
      this.placed.forEach(function (t) { self._writeOne(t); });
      Object.keys(this.meshes).forEach(function (s) { self.meshes[s].instanceMatrix.needsUpdate = true; });
    },

    _writeOne: function (t) {
      var mesh = this.meshes[t.species];
      if (t.cleared) {
        this._m4.makeScale(0.0001, 0.0001, 0.0001);
      } else {
        var y = Game.Terrain.heightAt(t.x, t.z);
        this._q.setFromAxisAngle(this._up, t.rot);
        this._m4.compose(
          new THREE.Vector3(t.x, y - 0.05, t.z),
          this._q,
          new THREE.Vector3(t.scale, t.scale, t.scale)
        );
      }
      mesh.setMatrixAt(t.idx, this._m4);
    },

    _applyTierCount: function () {
      // Trim draw counts to the quality tier; instances are scatter-ordered
      // randomly so trimming the tail thins the forest evenly.
      var target = QualityManager.settings.treeCount;
      var perSpecies = Math.ceil(target / 2);
      var counts = { broadleaf: 0, conifer: 0 };
      this.placed.forEach(function (t) { counts[t.species] = Math.max(counts[t.species], t.idx + 1); });
      this.meshes.broadleaf.count = Math.min(counts.broadleaf, perSpecies);
      this.meshes.conifer.count = Math.min(counts.conifer, perSpecies);
    },

    onQualityChange: function () { this._applyTierCount(); },

    // Carve a clearing (called by roads/buildings when they claim ground).
    clearNear: function (x, z, radius) {
      var touched = false;
      for (var i = 0; i < this.placed.length; i++) {
        var t = this.placed[i];
        if (t.cleared) continue;
        if (Math.hypot(t.x - x, t.z - z) < radius) {
          t.cleared = true;
          this._writeOne(t);
          touched = true;
        }
      }
      if (touched) {
        this.meshes.broadleaf.instanceMatrix.needsUpdate = true;
        this.meshes.conifer.instanceMatrix.needsUpdate = true;
      }
    },

    // Terraforming under a stand of trees: re-seat them on the new ground
    // (and clear any that ended up underwater).
    refreshArea: function (x, z, radius) {
      var touched = false;
      for (var i = 0; i < this.placed.length; i++) {
        var t = this.placed[i];
        if (t.cleared) continue;
        if (Math.hypot(t.x - x, t.z - z) < radius + 2) {
          if (Game.Terrain.heightAt(t.x, t.z) < Game.Terrain.waterLevel + 0.6) t.cleared = true;
          this._writeOne(t);
          touched = true;
        }
      }
      if (touched) {
        this.meshes.broadleaf.instanceMatrix.needsUpdate = true;
        this.meshes.conifer.instanceMatrix.needsUpdate = true;
      }
    },

    // Replay clearances for the whole current city (used after load).
    reapplyClearances: function () {
      var self = this;
      Game.Roads.edges.forEach(function (e) {
        var r = Game.Roads.TYPES[e.type].width * 0.9 + 2;
        e.pts.forEach(function (p) { self.clearNear(p.x, p.z, r); });
      });
      Game.Buildings.cellBuildings.forEach(function (b) { self.clearNear(b.x, b.z, 6); });
      Game.Buildings.services.forEach(function (s) { self.clearNear(s.x, s.z, s.footprint); });
    }
  };

  Game.Trees = Trees;
})(window);

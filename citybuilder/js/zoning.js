/* zoning.js
 * A coarse world-space grid of parcels (CFG.CELL_SIZE per cell). Painting a
 * zone just tags cells; buildings.js is the system that actually grows
 * structures on tagged cells over time, driven by RCI demand. Keeping the
 * two separate means the demand/growth simulation never has to know how
 * painting/brushing works, and vice versa.
 */
(function (global) {
  "use strict";
  var util = Game.util, CFG = Game.CONFIG;
  var COLORS = { residential: 0x4fd1a5, commercial: 0x4fa8ff, industrial: 0xffcf4f };

  var Zoning = {
    cellSize: CFG.CELL_SIZE,
    cells: null, // Map "gx,gz" -> { type, gx, gz, hasBuilding }
    dirty: true,

    init: function (scene, saved) {
      this.group = new THREE.Group();
      this.group.name = "zoning";
      scene.add(this.group);
      this.cells = new Map();
      this.mats = {
        residential: new THREE.MeshBasicMaterial({ color: COLORS.residential, transparent: true, opacity: 0.32, side: THREE.DoubleSide }),
        commercial: new THREE.MeshBasicMaterial({ color: COLORS.commercial, transparent: true, opacity: 0.32, side: THREE.DoubleSide }),
        industrial: new THREE.MeshBasicMaterial({ color: COLORS.industrial, transparent: true, opacity: 0.32, side: THREE.DoubleSide })
      };
      this.meshes = {};
      if (saved) this._loadFromSave(saved);
      this._rebuild();
      return this;
    },

    key: function (gx, gz) { return gx + "," + gz; },
    cellCenter: function (gx, gz) { return { x: gx * this.cellSize + this.cellSize / 2, z: gz * this.cellSize + this.cellSize / 2 }; },
    worldToCell: function (x, z) { return { gx: Math.floor(x / this.cellSize), gz: Math.floor(z / this.cellSize) }; },

    isZonable: function (x, z) {
      // FIX 4: reject cells inside/hugging the asphalt (d <= 1.0) as well as
      // cells too far from any road (d > 14) — distanceToNearestRoad already
      // subtracts the road half-width, so d <= 0 means literally on the road.
      var d = Game.Roads.distanceToNearestRoad(x, z);
      if (!(d > 1.0 && d <= 14)) return false;
      var h = Game.Terrain.heightAt(x, z);
      if (h < Game.Terrain.waterLevel + 0.6) return false;
      if (Game.Terrain.slopeAt(x, z) > 0.5) return false;
      return true;
    },

    paintAt: function (x, z, type, radius) {
      radius = radius || this.cellSize * 0.6;
      var c = this.worldToCell(x, z);
      var spread = Math.ceil(radius / this.cellSize);
      var painted = 0;
      for (var dz = -spread; dz <= spread; dz++) {
        for (var dx = -spread; dx <= spread; dx++) {
          var gx = c.gx + dx, gz = c.gz + dz;
          var center = this.cellCenter(gx, gz);
          if (Math.hypot(center.x - x, center.z - z) > radius) continue;
          if (!this.isZonable(center.x, center.z)) continue;
          var k = this.key(gx, gz);
          var existing = this.cells.get(k);
          if (existing && existing.hasBuilding && existing.type !== type) continue; // don't rezone occupied lots casually
          if (type === null) {
            if (existing && !existing.hasBuilding) this.cells.delete(k);
            else if (existing && existing.hasBuilding) { Game.Buildings.removeAt(gx, gz); this.cells.delete(k); }
            continue;
          }
          this.cells.set(k, existing || { type: type, gx: gx, gz: gz, hasBuilding: false, level: 0 });
          this.cells.get(k).type = type;
          painted++;
        }
      }
      if (painted) { this.dirty = true; this._rebuild(); }
      return painted;
    },

    onRoadsChanged: function () { /* zonability recalculated lazily on paint; no-op for now */ },

    markBuilt: function (gx, gz, built) {
      var c = this.cells.get(this.key(gx, gz));
      if (c) c.hasBuilding = built;
    },

    getUnbuiltCellsOfType: function (type) {
      var out = [];
      this.cells.forEach(function (c) { if (c.type === type && !c.hasBuilding) out.push(c); });
      return out;
    },

    getBuiltCellsOfType: function (type) {
      var out = [];
      this.cells.forEach(function (c) { if (c.type === type && c.hasBuilding) out.push(c); });
      return out;
    },

    _rebuild: function () {
      var self = this;
      ["residential", "commercial", "industrial"].forEach(function (type) {
        if (self.meshes[type]) { self.group.remove(self.meshes[type]); self.meshes[type].geometry.dispose(); }
        var positions = [], indices = [], vi = 0;
        self.cells.forEach(function (c) {
          if (c.type !== type) return;
          var cx = c.gx * self.cellSize, cz = c.gz * self.cellSize;
          var s = self.cellSize * 0.92;
          var pad = (self.cellSize - s) / 2;
          var corners = [
            [cx + pad, cz + pad], [cx + pad + s, cz + pad],
            [cx + pad + s, cz + pad + s], [cx + pad, cz + pad + s]
          ];
          corners.forEach(function (p) {
            var y = Game.Terrain.heightAt(p[0], p[1]) + 0.22;
            positions.push(p[0], y, p[1]);
          });
          indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
          vi += 4;
        });
        if (!positions.length) { self.meshes[type] = null; return; }
        var geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geo.setIndex(indices);
        var mesh = new THREE.Mesh(geo, self.mats[type]);
        mesh.renderOrder = 2;
        self.meshes[type] = mesh;
        self.group.add(mesh);
      });
    },

    setVisible: function (v) { this.group.visible = v; },

    clearAll: function () { this.cells.clear(); this._rebuild(); },

    getSaveState: function () {
      var arr = [];
      this.cells.forEach(function (c) { arr.push(c); });
      return arr;
    },
    _loadFromSave: function (arr) {
      var self = this;
      (arr || []).forEach(function (c) { self.cells.set(self.key(c.gx, c.gz), c); });
    }
  };

  Game.Zoning = Zoning;
})(window);

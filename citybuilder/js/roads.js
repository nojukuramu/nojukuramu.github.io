/* roads.js
 * Road network: nodes + edges graph, drag-to-place tool with grid/endpoint/
 * angle snapping, straight + quadratic-bezier curved placement, automatic
 * "intersection hub" discs where edges meet, terrain auto-grading along
 * new roads, and auto-bridging when a road crosses water.
 *
 * Simplification (documented per the design brief): rather than modeling
 * true tunnels/overpasses, new roads auto-grade the terrain beneath them
 * to a smooth interpolated height between endpoints; the only case that
 * gets explicit elevation geometry is a water crossing, which becomes a
 * bridge with support pylons. This covers the common cases in a vertical
 * slice without a full terrain-boolean tunneling system — swap in later
 * without touching the graph model.
 */
(function (global) {
  "use strict";
  var util = Game.util, CFG = Game.CONFIG;

  var TYPES = {
    street:  { width: 6,  color: 0x2b2f36, speed: 6,  cost: 40  },
    avenue:  { width: 10, color: 0x272b32, speed: 10, cost: 90  },
    highway: { width: 16, color: 0x22252b, speed: 18, cost: 180 }
  };

  var Roads = {
    TYPES: TYPES,
    nodes: [],   // {id,x,z}
    edges: [],   // {id,a,b,type,pts:[{x,z}],len,bridge:bool}
    _nextId: 1,
    curType: "street",
    curveMode: false,
    dragging: false,
    dragStartSnap: null,
    curvePending: null, // {a:{x,z}, b:{x,z}, handle:{x,z}} while adjusting bend

    init: function (scene, saved) {
      this.group = new THREE.Group();
      this.group.name = "roads";
      scene.add(this.group);

      this.previewMat = new THREE.MeshBasicMaterial({ color: 0x00d9c0, transparent: true, opacity: 0.55, depthTest: false });
      this.previewMesh = null;

      this.hubMat = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
      this.roadTextures = {
        street: Procgen.roadTexture("street"),
        avenue: Procgen.roadTexture("avenue"),
        highway: Procgen.roadTexture("highway")
      };
      this.streetLightGeo = new THREE.CylinderGeometry(0.12, 0.15, 4.2, 5);
      this.streetLightMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
      this.streetLampGlow = Procgen.glowSprite("rgba(255,224,150,1)", 64);
      this.streetLightsGroup = new THREE.Group();
      this.group.add(this.streetLightsGroup);

      if (saved) this._loadFromSave(saved);
      return this;
    },

    setType: function (t) { this.curType = t; },
    setCurveMode: function (b) { this.curveMode = !!b; },

    // ---------------- snapping helpers ----------------
    _findNearestNode: function (x, z, maxDist) {
      var best = null, bestD = maxDist;
      for (var i = 0; i < this.nodes.length; i++) {
        var n = this.nodes[i];
        var d = Math.hypot(n.x - x, n.z - z);
        if (d < bestD) { bestD = d; best = n; }
      }
      return best;
    },

    snapPoint: function (x, z, fromPoint) {
      var node = this._findNearestNode(x, z, 9);
      if (node) return { x: node.x, z: node.z, node: node };
      var gx = Math.round(x / 4) * 4, gz = Math.round(z / 4) * 4;
      if (fromPoint && !this.curveMode) {
        var dx = x - fromPoint.x, dz = z - fromPoint.z;
        var dist = Math.hypot(dx, dz);
        if (dist > 2) {
          var angle = Math.atan2(dz, dx);
          var snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
          gx = fromPoint.x + Math.cos(snapAngle) * dist;
          gz = fromPoint.z + Math.sin(snapAngle) * dist;
        }
      }
      return { x: gx, z: gz, node: null };
    },

    // ---------------- interaction ----------------
    startDrag: function (pt) {
      var snap = this.snapPoint(pt.x, pt.z);
      this.dragStartSnap = snap;
      this.dragging = true;
      this.curvePending = null;
    },

    updateDrag: function (pt) {
      if (!this.dragging || !this.dragStartSnap) return;
      var snap = this.snapPoint(pt.x, pt.z, this.dragStartSnap);
      this._updatePreview(this.dragStartSnap, snap, this.curveMode ? this._midHandle(this.dragStartSnap, snap) : null);
      this._lastEnd = snap;
    },

    endDrag: function (pt) {
      if (!this.dragging || !this.dragStartSnap) { this.dragging = false; return; }
      var snap = this.snapPoint(pt.x, pt.z, this.dragStartSnap);
      this.dragging = false;
      var dist = Math.hypot(snap.x - this.dragStartSnap.x, snap.z - this.dragStartSnap.z);
      if (dist < 3) { this._clearPreview(); this.dragStartSnap = null; return; }

      if (this.curveMode) {
        // enter bend-adjust mode: draw straight preview + draggable handle at midpoint
        this.curvePending = { a: this.dragStartSnap, b: snap, handle: this._midHandle(this.dragStartSnap, snap) };
        this._updatePreview(this.dragStartSnap, snap, this.curvePending.handle);
        if (Game.UI) Game.UI.showCurveConfirm();
      } else {
        this._commitEdge(this.dragStartSnap, snap, null);
        this._clearPreview();
      }
      this.dragStartSnap = null;
    },

    _midHandle: function (a, b) { return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }; },

    dragCurveHandle: function (pt) {
      if (!this.curvePending) return;
      this.curvePending.handle = { x: pt.x, z: pt.z };
      this._updatePreview(this.curvePending.a, this.curvePending.b, this.curvePending.handle);
    },

    confirmCurve: function () {
      if (!this.curvePending) return;
      this._commitEdge(this.curvePending.a, this.curvePending.b, this.curvePending.handle);
      this._clearPreview();
      this.curvePending = null;
    },
    cancelCurve: function () { this._clearPreview(); this.curvePending = null; },

    cancelDrag: function () { this.dragging = false; this.dragStartSnap = null; this._clearPreview(); },

    // ---------------- geometry / commit ----------------
    _sampleCurve: function (a, b, handle, steps) {
      steps = steps || 14;
      var pts = [];
      for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        var x, z;
        if (handle) {
          var mt = 1 - t;
          x = mt * mt * a.x + 2 * mt * t * handle.x + t * t * b.x;
          z = mt * mt * a.z + 2 * mt * t * handle.z + t * t * b.z;
        } else {
          x = util.lerp(a.x, b.x, t); z = util.lerp(a.z, b.z, t);
        }
        pts.push({ x: x, z: z });
      }
      return pts;
    },

    _getOrCreateNode: function (p) {
      if (p.node) return p.node;
      var existing = this._findNearestNode(p.x, p.z, 0.5);
      if (existing) return existing;
      var n = { id: this._nextId++, x: p.x, z: p.z };
      this.nodes.push(n);
      return n;
    },

    _commitEdge: function (aPt, bPt, handle) {
      var nodeA = this._getOrCreateNode(aPt);
      var nodeB = this._getOrCreateNode(bPt);
      if (nodeA === nodeB) return;
      var pts = this._sampleCurve(nodeA, nodeB, handle);
      var edge = { id: this._nextId++, a: nodeA.id, b: nodeB.id, type: this.curType, pts: pts, bridge: false };
      this._gradeAndElevate(edge);
      this.edges.push(edge);
      this._rebuildEdgeMesh(edge);
      this._rebuildHubs();
      this._rebuildStreetLights();
      this._adjacency = null;
      if (Game.Zoning) Game.Zoning.onRoadsChanged();
      if (Game.Economy) Game.Economy.spend(TYPES[edge.type].cost * (pts.length - 1) / 6, "Road construction");
      return edge;
    },

    // Auto-grade terrain under the road path; auto-bridge water crossings.
    _gradeAndElevate: function (edge) {
      var terrain = Game.Terrain;
      var wl = terrain.waterLevel;
      var startH = terrain.heightAt(edge.pts[0].x, edge.pts[0].z);
      var endH = terrain.heightAt(edge.pts[edge.pts.length - 1].x, edge.pts[edge.pts.length - 1].z);
      var crossesWater = false;
      edge.elev = [];
      for (var i = 0; i < edge.pts.length; i++) {
        var p = edge.pts[i];
        var t = i / (edge.pts.length - 1);
        var target = util.lerp(startH, endH, t);
        var groundH = terrain.heightAt(p.x, p.z);
        if (groundH < wl + 0.4) crossesWater = true;
        else if (Game.mode !== "creative" || true) {
          // grade a small radius flat toward the target height for a smooth road bed
          terrain.applyBrush(p.x, p.z, "flatten", TYPES[edge.type].width * 0.9, 0.9, target);
        }
      }
      if (crossesWater) {
        edge.bridge = true;
        for (i = 0; i < edge.pts.length; i++) {
          t = i / (edge.pts.length - 1);
          edge.elev.push(Math.max(util.lerp(startH, endH, t), wl + 2.2));
        }
      } else {
        for (i = 0; i < edge.pts.length; i++) {
          t = i / (edge.pts.length - 1);
          edge.elev.push(util.lerp(startH, endH, t) + 0.12);
        }
      }
    },

    _rebuildEdgeMesh: function (edge) {
      if (edge.mesh) { this.group.remove(edge.mesh); edge.mesh.geometry.dispose(); }
      var width = TYPES[edge.type].width;
      var half = width / 2;
      var pts = edge.pts, elev = edge.elev;
      var positions = [], uvs = [], indices = [];
      var totalLen = 0;
      var lens = [0];
      for (var i = 1; i < pts.length; i++) { totalLen += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); lens.push(totalLen); }
      edge.len = totalLen;

      for (i = 0; i < pts.length; i++) {
        var prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
        var tx = next.x - prev.x, tz = next.z - prev.z;
        var tl = Math.hypot(tx, tz) || 1;
        var nx = -tz / tl, nz = tx / tl;
        var y = elev[i];
        positions.push(pts[i].x + nx * half, y, pts[i].z + nz * half);
        positions.push(pts[i].x - nx * half, y, pts[i].z - nz * half);
        var v = lens[i] / (width * 2);
        uvs.push(1, v, 0, v);
        if (i < pts.length - 1) {
          var b0 = i * 2, b1 = i * 2 + 1, b2 = i * 2 + 2, b3 = i * 2 + 3;
          indices.push(b0, b2, b1, b1, b2, b3);
        }
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeVertexNormals();

      var mat = new THREE.MeshLambertMaterial({ map: this.roadTextures[edge.type] });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = edge.bridge;
      edge.mesh = mesh;
      this.group.add(mesh);

      // bridge pylons
      if (edge.pylons) { edge.pylons.forEach(function (p) { this.group.remove(p); }, this); }
      edge.pylons = [];
      if (edge.bridge) {
        for (i = 2; i < pts.length - 1; i += 3) {
          var h = elev[i] - Game.Terrain.heightAt(pts[i].x, pts[i].z);
          var geoP = new THREE.CylinderGeometry(0.6, 0.6, Math.max(0.5, h), 6);
          var pylon = new THREE.Mesh(geoP, this.hubMat);
          pylon.position.set(pts[i].x, elev[i] - h / 2, pts[i].z);
          this.group.add(pylon);
          edge.pylons.push(pylon);
        }
      }
    },

    _rebuildHubs: function () {
      if (this.hubGroup) this.group.remove(this.hubGroup);
      this.hubGroup = new THREE.Group();
      var deg = {};
      this.edges.forEach(function (e) {
        deg[e.a] = deg[e.a] || { count: 0, maxW: 0 };
        deg[e.b] = deg[e.b] || { count: 0, maxW: 0 };
        deg[e.a].count++; deg[e.b].count++;
        deg[e.a].maxW = Math.max(deg[e.a].maxW, TYPES[e.type].width);
        deg[e.b].maxW = Math.max(deg[e.b].maxW, TYPES[e.type].width);
      });
      var self = this;
      Object.keys(deg).forEach(function (id) {
        var info = deg[id];
        if (info.count < 2) return;
        var node = self.nodes.find(function (n) { return n.id == id; });
        if (!node) return;
        var r = info.maxW / 2 + (info.count > 2 ? 1.2 : 0.2);
        var h = Game.Terrain.heightAt(node.x, node.z) + 0.13;
        var geo = new THREE.CircleGeometry(r, 16);
        geo.rotateX(-Math.PI / 2);
        var mesh = new THREE.Mesh(geo, self.hubMat);
        mesh.position.set(node.x, h, node.z);
        mesh.receiveShadow = true;
        self.hubGroup.add(mesh);
      });
      this.group.add(this.hubGroup);
    },

    _rebuildStreetLights: function () {
      var settings = QualityManager.settings;
      this.streetLightsGroup.clear();
      var every = settings.streetLightEvery;
      var self = this;
      this.edges.forEach(function (edge) {
        var step = Math.max(2, Math.floor(6 * every));
        for (var i = 2; i < edge.pts.length - 1; i += step) {
          var p = edge.pts[i], next = edge.pts[Math.min(edge.pts.length - 1, i + 1)];
          var tx = next.x - p.x, tz = next.z - p.z, tl = Math.hypot(tx, tz) || 1;
          var nx = -tz / tl, nz = tx / tl;
          var side = (i % (step * 2) === 0) ? 1 : -1;
          var off = TYPES[edge.type].width / 2 + 0.8;
          var pole = new THREE.Mesh(self.streetLightGeo, self.streetLightMat);
          var y = edge.elev[i];
          pole.position.set(p.x + nx * off * side, y + 2.1, p.z + nz * off * side);
          pole.castShadow = false;
          self.streetLightsGroup.add(pole);
          var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: self.streetLampGlow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
          glow.scale.set(3.2, 3.2, 1);
          glow.position.set(pole.position.x, y + 4.1, pole.position.z);
          glow.userData.isLampGlow = true;
          self.streetLightsGroup.add(glow);
        }
      });
    },

    updateNightLights: function (nightFactor) {
      var opacity = util.smoothstep(0.35, 0.65, nightFactor);
      this.streetLightsGroup.children.forEach(function (c) {
        if (c.userData.isLampGlow) c.material.opacity = opacity * 0.95;
      });
    },

    // ---------------- preview ----------------
    _updatePreview: function (a, b, handle) {
      this._clearPreview();
      var pts = this._sampleCurve(a, b, handle, 10);
      var width = TYPES[this.curType].width;
      var half = width / 2;
      var positions = [], indices = [];
      for (var i = 0; i < pts.length; i++) {
        var prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
        var tx = next.x - prev.x, tz = next.z - prev.z, tl = Math.hypot(tx, tz) || 1;
        var nx = -tz / tl, nz = tx / tl;
        var y = Game.Terrain.heightAt(pts[i].x, pts[i].z) + 0.3;
        positions.push(pts[i].x + nx * half, y, pts[i].z + nz * half);
        positions.push(pts[i].x - nx * half, y, pts[i].z - nz * half);
        if (i < pts.length - 1) {
          var b0 = i * 2, b1 = i * 2 + 1, b2 = i * 2 + 2, b3 = i * 2 + 3;
          indices.push(b0, b2, b1, b1, b2, b3);
        }
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(indices);
      this.previewMesh = new THREE.Mesh(geo, this.previewMat);
      this.previewMesh.renderOrder = 10;
      this.group.add(this.previewMesh);

      if (handle) {
        if (!this._handleDot) {
          this._handleDot = new THREE.Mesh(new THREE.SphereGeometry(1.4, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffb020 }));
          this.group.add(this._handleDot);
        }
        this._handleDot.visible = true;
        this._handleDot.position.set(handle.x, Game.Terrain.heightAt(handle.x, handle.z) + 1.5, handle.z);
      } else if (this._handleDot) this._handleDot.visible = false;
    },
    _clearPreview: function () {
      if (this.previewMesh) { this.group.remove(this.previewMesh); this.previewMesh.geometry.dispose(); this.previewMesh = null; }
      if (this._handleDot) this._handleDot.visible = false;
    },

    // ---------------- bulldoze ----------------
    bulldozeNear: function (x, z) {
      var best = null, bestD = 6, bestI = -1;
      for (var i = 0; i < this.edges.length; i++) {
        var e = this.edges[i];
        for (var j = 0; j < e.pts.length - 1; j++) {
          var d = this._distToSeg(x, z, e.pts[j], e.pts[j + 1]);
          if (d < bestD) { bestD = d; best = e; bestI = i; }
        }
      }
      if (best) {
        this.group.remove(best.mesh);
        best.mesh.geometry.dispose();
        (best.pylons || []).forEach(function (p) { this.group.remove(p); }, this);
        this.edges.splice(bestI, 1);
        this._pruneOrphanNodes();
        this._rebuildHubs();
        this._rebuildStreetLights();
        this._adjacency = null;
        if (Game.Zoning) Game.Zoning.onRoadsChanged();
        return true;
      }
      return false;
    },
    _distToSeg: function (x, z, a, b) {
      var dx = b.x - a.x, dz = b.z - a.z;
      var len2 = dx * dx + dz * dz || 1;
      var t = util.clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
      var px = a.x + dx * t, pz = a.z + dz * t;
      return Math.hypot(x - px, z - pz);
    },
    _pruneOrphanNodes: function () {
      var used = {};
      this.edges.forEach(function (e) { used[e.a] = true; used[e.b] = true; });
      this.nodes = this.nodes.filter(function (n) { return used[n.id]; });
    },

    // ---------------- pathfinding (Dijkstra over the node graph) ----------------
    _buildAdjacency: function () {
      var adj = {};
      this.edges.forEach(function (e) {
        adj[e.a] = adj[e.a] || []; adj[e.b] = adj[e.b] || [];
        adj[e.a].push({ to: e.b, edge: e });
        adj[e.b].push({ to: e.a, edge: e });
      });
      this._adjacency = adj;
      return adj;
    },

    nearestNodeId: function (x, z) {
      var n = this._findNearestNode(x, z, Infinity);
      return n ? n.id : null;
    },

    // Returns an ordered list of {x,y,z} waypoints from node A to node B, or null.
    findPath: function (fromId, toId) {
      if (fromId === toId) return [];
      var adj = this._adjacency || this._buildAdjacency();
      var dist = {}, prevEdge = {}, prevNode = {}, visited = {};
      dist[fromId] = 0;
      var queue = [fromId];
      while (queue.length) {
        queue.sort(function (a, b) { return (dist[a] || Infinity) - (dist[b] || Infinity); });
        var cur = queue.shift();
        if (visited[cur]) continue;
        visited[cur] = true;
        if (cur === toId) break;
        (adj[cur] || []).forEach(function (link) {
          var w = link.edge.len || 1;
          var nd = dist[cur] + w;
          if (dist[link.to] === undefined || nd < dist[link.to]) {
            dist[link.to] = nd; prevEdge[link.to] = link.edge; prevNode[link.to] = cur;
            queue.push(link.to);
          }
        });
      }
      if (dist[toId] === undefined) return null;
      var chain = [], node = toId;
      while (node !== fromId) {
        var edge = prevEdge[node];
        if (!edge) return null;
        var reversed = edge.b === node ? edge.pts.slice().reverse() : edge.pts.slice();
        var elevReversed = edge.b === node ? edge.elev.slice().reverse() : edge.elev.slice();
        for (var i = 0; i < reversed.length; i++) chain.push({ x: reversed[i].x, z: reversed[i].z, y: elevReversed[i] });
        node = prevNode[node];
      }
      chain.reverse();
      return chain;
    },

    // ---------------- queries for zoning / citizens / traffic ----------------
    distanceToNearestRoad: function (x, z) {
      var best = Infinity;
      for (var i = 0; i < this.edges.length; i++) {
        var e = this.edges[i];
        for (var j = 0; j < e.pts.length - 1; j++) {
          var d = this._distToSeg(x, z, e.pts[j], e.pts[j + 1]) - TYPES[e.type].width / 2;
          if (d < best) best = d;
        }
      }
      return best;
    },

    randomPointOnNetwork: function (rand) {
      if (!this.edges.length) return null;
      var e = this.edges[Math.floor((rand ? rand() : Math.random()) * this.edges.length)];
      var i = Math.floor((rand ? rand() : Math.random()) * (e.pts.length - 1));
      return { x: e.pts[i].x, z: e.pts[i].z, y: e.elev[i], edge: e, idx: i };
    },

    pointAtEdgeDistance: function (edge, dist) {
      var d = 0;
      for (var i = 0; i < edge.pts.length - 1; i++) {
        var segLen = Math.hypot(edge.pts[i + 1].x - edge.pts[i].x, edge.pts[i + 1].z - edge.pts[i].z);
        if (d + segLen >= dist) {
          var t = segLen > 0 ? (dist - d) / segLen : 0;
          return {
            x: util.lerp(edge.pts[i].x, edge.pts[i + 1].x, t),
            z: util.lerp(edge.pts[i].z, edge.pts[i + 1].z, t),
            y: util.lerp(edge.elev[i], edge.elev[i + 1], t),
            heading: Math.atan2(edge.pts[i + 1].x - edge.pts[i].x, edge.pts[i + 1].z - edge.pts[i].z)
          };
        }
        d += segLen;
      }
      var last = edge.pts.length - 1;
      return { x: edge.pts[last].x, z: edge.pts[last].z, y: edge.elev[last], heading: 0 };
    },

    clearAll: function () {
      var self = this;
      this.edges.forEach(function (e) {
        if (e.mesh) { self.group.remove(e.mesh); e.mesh.geometry.dispose(); }
        (e.pylons || []).forEach(function (p) { self.group.remove(p); });
      });
      this.nodes = []; this.edges = []; this._nextId = 1; this._adjacency = null;
      this._rebuildHubs();
      this._rebuildStreetLights();
    },

    // ---------------- save/load ----------------
    getSaveState: function () {
      return {
        nextId: this._nextId,
        nodes: this.nodes,
        edges: this.edges.map(function (e) { return { id: e.id, a: e.a, b: e.b, type: e.type, pts: e.pts, bridge: e.bridge, elev: e.elev }; })
      };
    },
    _loadFromSave: function (data) {
      this._nextId = data.nextId || 1;
      this.nodes = data.nodes || [];
      this.edges = (data.edges || []).map(function (e) { return Object.assign({}, e); });
      var self = this;
      this.edges.forEach(function (e) { self._rebuildEdgeMesh(e); });
      this._rebuildHubs();
      this._rebuildStreetLights();
    },

    onQualityChange: function () { this._rebuildStreetLights(); },

    _wetness: 0,
    _wetColor: new THREE.Color(0x9fb4c2),
    _dryColor: new THREE.Color(0xffffff),
    update: function () {
      var w = this._wetness || 0;
      var c = this._dryColor.clone().lerp(this._wetColor, w * 0.7);
      for (var i = 0; i < this.edges.length; i++) {
        var mesh = this.edges[i].mesh;
        if (mesh) mesh.material.color.copy(c);
      }
    }
  };

  Game.Roads = Roads;
})(window);

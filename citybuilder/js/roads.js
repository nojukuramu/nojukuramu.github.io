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
      // One shared material per road type (FIX 11) — every edge mesh of a
      // given type reuses the same material instance instead of allocating
      // its own, so wet-road tinting is 3 color updates instead of N.
      this.roadMats = {
        street: new THREE.MeshLambertMaterial({ map: this.roadTextures.street }),
        avenue: new THREE.MeshLambertMaterial({ map: this.roadTextures.avenue }),
        highway: new THREE.MeshLambertMaterial({ map: this.roadTextures.highway })
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
      // FIX 1: snap onto the nearest point of an existing edge's polyline
      // (not just its endpoints) so a new road can T-branch mid-edge.
      var onEdge = this._findNearestEdgePoint(x, z, 9);
      if (onEdge) return { x: onEdge.point.x, z: onEdge.point.z, node: null, onEdge: onEdge };
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

    // Closest point on segment a->b to (x,z), with its parametric t in [0,1].
    _closestPointOnSeg: function (x, z, a, b) {
      var dx = b.x - a.x, dz = b.z - a.z;
      var len2 = dx * dx + dz * dz || 1;
      var t = util.clamp(((x - a.x) * dx + (z - a.z) * dz) / len2, 0, 1);
      return { x: a.x + dx * t, z: a.z + dz * t, t: t };
    },

    // Nearest point on ANY existing edge's polyline to (x,z), within maxDist.
    // Returns {edge, segIndex, point:{x,z}, t} or null.
    _findNearestEdgePoint: function (x, z, maxDist) {
      var best = null, bestD = maxDist;
      for (var i = 0; i < this.edges.length; i++) {
        var e = this.edges[i];
        for (var j = 0; j < e.pts.length - 1; j++) {
          var cp = this._closestPointOnSeg(x, z, e.pts[j], e.pts[j + 1]);
          var d = Math.hypot(x - cp.x, z - cp.z);
          if (d < bestD) { bestD = d; best = { edge: e, segIndex: j, point: { x: cp.x, z: cp.z }, t: cp.t }; }
        }
      }
      return best;
    },

    _nodeById: function (id) {
      return this.nodes.find(function (n) { return n.id === id; }) || null;
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
    // `steps` is an optional override (previews pass a fixed coarse value);
    // when omitted, steps scale with path length (~1 sample per 4 units,
    // clamped to [8,48]) so long roads stay finer than the terrain grid
    // (~4.2 units/cell) instead of skipping over undulations between samples.
    _sampleCurve: function (a, b, handle, steps) {
      if (!steps) {
        var approxLen = handle
          ? Math.hypot(handle.x - a.x, handle.z - a.z) + Math.hypot(b.x - handle.x, b.z - handle.z)
          : Math.hypot(b.x - a.x, b.z - a.z);
        steps = util.clamp(Math.round(approxLen / 4), 8, 48);
      }
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
      // FIX 1: point snapped mid-edge -> split that edge into two, return the new node.
      if (p.onEdge) return this._splitEdgeAt(p.onEdge);
      var existing = this._findNearestNode(p.x, p.z, 0.5);
      if (existing) return existing;
      var n = { id: this._nextId++, x: p.x, z: p.z };
      this.nodes.push(n);
      return n;
    },

    // Split `onEdge.edge` at `onEdge.point` (which lies on segment onEdge.segIndex),
    // replacing it with two edges that partition the original pts/elev arrays.
    // Used both for mid-edge endpoint snapping (FIX 1) and crossing detection (FIX 2).
    _splitEdgeAt: function (onEdge) {
      var terrain = Game.Terrain, wl = terrain.waterLevel;
      var edge = onEdge.edge, point = onEdge.point, segIndex = onEdge.segIndex;
      var idx = this.edges.indexOf(edge);
      if (idx < 0) {
        // The referenced edge was already replaced by an earlier split in this
        // same commit (e.g. two crossings landing on the same original edge).
        // Relocate the split point onto whichever surviving edge now carries it.
        var relocated = this._findNearestEdgePoint(point.x, point.z, 1.5);
        if (!relocated) {
          var coincident0 = this._findNearestNode(point.x, point.z, 0.5);
          if (coincident0) return coincident0;
          var n0 = { id: this._nextId++, x: point.x, z: point.z };
          this.nodes.push(n0);
          return n0;
        }
        edge = relocated.edge; point = relocated.point; segIndex = relocated.segIndex;
        idx = this.edges.indexOf(edge);
      }

      // If a node already sits (essentially) at this point, just reuse it.
      var coincident = this._findNearestNode(point.x, point.z, 0.5);
      if (coincident) return coincident;

      var pts = edge.pts, elev = edge.elev;
      var newNode = { id: this._nextId++, x: point.x, z: point.z };
      this.nodes.push(newNode);

      var segLen = Math.hypot(pts[segIndex + 1].x - pts[segIndex].x, pts[segIndex + 1].z - pts[segIndex].z);
      var t = segLen > 1e-6 ? Math.hypot(point.x - pts[segIndex].x, point.z - pts[segIndex].z) / segLen : 0;
      var splitElev = util.lerp(elev[segIndex], elev[segIndex + 1], t);
      // never let the interpolated split point sink below ground (sampled across
      // the strip's width, not just the centerline) or below water clearance
      var splitWidth = TYPES[edge.type].width;
      var nxTx = pts[segIndex + 1].x - pts[segIndex].x, nxTz = pts[segIndex + 1].z - pts[segIndex].z;
      var nxTl = Math.hypot(nxTx, nxTz) || 1;
      var nnx = -nxTz / nxTl, nnz = nxTx / nxTl, nHalf = splitWidth / 2 + 0.5;
      var maxGroundAtSplit = Math.max(
        terrain.heightAt(point.x, point.z),
        terrain.heightAt(point.x + nnx * nHalf, point.z + nnz * nHalf),
        terrain.heightAt(point.x - nnx * nHalf, point.z - nnz * nHalf)
      );
      var minAllowed = maxGroundAtSplit + 0.18;
      if (maxGroundAtSplit < wl) minAllowed = Math.max(minAllowed, wl + 2.0);
      if (splitElev < minAllowed) splitElev = minAllowed;

      var splitPt = { x: point.x, z: point.z };
      var ptsA = pts.slice(0, segIndex + 1).concat([splitPt]);
      var ptsB = [splitPt].concat(pts.slice(segIndex + 1));
      var elevA = elev.slice(0, segIndex + 1).concat([splitElev]);
      var elevB = [splitElev].concat(elev.slice(segIndex + 1));

      var edgeA = { id: this._nextId++, a: edge.a, b: newNode.id, type: edge.type, pts: ptsA, elev: elevA, bridge: edge.bridge };
      var edgeB = { id: this._nextId++, a: newNode.id, b: edge.b, type: edge.type, pts: ptsB, elev: elevB, bridge: edge.bridge };

      if (edge.mesh) { this.group.remove(edge.mesh); edge.mesh.geometry.dispose(); }
      (edge.pylons || []).forEach(function (p) { this.group.remove(p); }, this);
      this.edges.splice(idx, 1);
      this.edges.push(edgeA, edgeB);
      this._rebuildEdgeMesh(edgeA);
      this._rebuildEdgeMesh(edgeB);
      this._adjacency = null;
      return newNode;
    },

    // 2D segment-segment intersection (x,z plane). Returns {x,z,t,u} (t,u in [0,1]) or null.
    _segIntersect: function (p1, p2, p3, p4) {
      var x1 = p1.x, y1 = p1.z, x2 = p2.x, y2 = p2.z, x3 = p3.x, y3 = p3.z, x4 = p4.x, y4 = p4.z;
      var d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
      if (Math.abs(d) < 1e-9) return null;
      var t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
      var u = ((x1 - x3) * (y1 - y2) - (y1 - y3) * (x1 - x2)) / d;
      if (t < 0 || t > 1 || u < 0 || u > 1) return null;
      return { x: x1 + t * (x2 - x1), z: y1 + t * (y2 - y1), t: t, u: u };
    },

    // FIX 2: find every crossing between the new road's polyline `pts` and every
    // existing edge, skipping crossings within ~3 units of either road's endpoints
    // (those are already handled by node/edge snapping). Sorted by arc-length
    // along `pts` so multiple crossings on one placement come out in order.
    _findCrossings: function (pts, nodeA, nodeB) {
      var arcLens = [0];
      for (var i = 1; i < pts.length; i++) arcLens.push(arcLens[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));

      var crossings = [];
      for (i = 0; i < pts.length - 1; i++) {
        var p1 = pts[i], p2 = pts[i + 1];
        for (var e = 0; e < this.edges.length; e++) {
          var edge = this.edges[e];
          var nA = this._nodeById(edge.a), nB = this._nodeById(edge.b);
          for (var j = 0; j < edge.pts.length - 1; j++) {
            var hit = this._segIntersect(p1, p2, edge.pts[j], edge.pts[j + 1]);
            if (!hit) continue;
            var pt = { x: hit.x, z: hit.z };
            if (Math.hypot(pt.x - nodeA.x, pt.z - nodeA.z) < 3) continue;
            if (Math.hypot(pt.x - nodeB.x, pt.z - nodeB.z) < 3) continue;
            if (nA && Math.hypot(pt.x - nA.x, pt.z - nA.z) < 3) continue;
            if (nB && Math.hypot(pt.x - nB.x, pt.z - nB.z) < 3) continue;
            var arcLen = arcLens[i] + hit.t * (arcLens[i + 1] - arcLens[i]);
            crossings.push({ arcLen: arcLen, newSegIndex: i, point: pt, edge: edge, segIndex: j });
          }
        }
      }
      crossings.sort(function (a, b) { return a.arcLen - b.arcLen; });
      // dedupe near-duplicate hits (e.g. a shared vertex touched from both sides)
      var deduped = [];
      crossings.forEach(function (c) {
        var dup = deduped.some(function (d) { return Math.hypot(d.point.x - c.point.x, d.point.z - c.point.z) < 0.5; });
        if (!dup) deduped.push(c);
      });
      return deduped;
    },

    // Cuts the new road's `pts` into a chain of segments at every crossing,
    // splitting the crossed existing edges along the way. Returns an array of
    // {pts, startNode, endNode} to be committed as individual edges.
    _splitAtCrossings: function (pts, nodeA, nodeB) {
      var crossings = this._findCrossings(pts, nodeA, nodeB);
      if (!crossings.length) return [{ pts: pts, startNode: nodeA, endNode: nodeB }];

      var chain = [];
      var curPts = [pts[0]];
      var curStartNode = nodeA;
      var ci = 0;
      for (var i = 0; i < pts.length - 1; i++) {
        while (ci < crossings.length && crossings[ci].newSegIndex === i) {
          var c = crossings[ci];
          var crossNode = this._splitEdgeAt(c);
          var crossPt = { x: crossNode.x, z: crossNode.z };
          curPts.push(crossPt);
          chain.push({ pts: curPts, startNode: curStartNode, endNode: crossNode });
          curPts = [crossPt];
          curStartNode = crossNode;
          ci++;
        }
        curPts.push(pts[i + 1]);
      }
      chain.push({ pts: curPts, startNode: curStartNode, endNode: nodeB });
      return chain;
    },

    _commitEdge: function (aPt, bPt, handle) {
      var nodeA = this._getOrCreateNode(aPt);
      var nodeB = this._getOrCreateNode(bPt);
      if (nodeA === nodeB) return;
      var pts = this._sampleCurve(nodeA, nodeB, handle);
      // pin the sampled endpoints exactly to the (possibly just-split) node coords
      pts[0] = { x: nodeA.x, z: nodeA.z };
      pts[pts.length - 1] = { x: nodeB.x, z: nodeB.z };

      var chain = this._splitAtCrossings(pts, nodeA, nodeB);
      var createdEdges = [], totalCost = 0;
      for (var s = 0; s < chain.length; s++) {
        var seg = chain[s];
        var edge = { id: this._nextId++, a: seg.startNode.id, b: seg.endNode.id, type: this.curType, pts: seg.pts, bridge: false };
        this._gradeAndElevate(edge);
        this.edges.push(edge);
        this._rebuildEdgeMesh(edge);
        createdEdges.push(edge);
        totalCost += TYPES[edge.type].cost * (seg.pts.length - 1) / 6;
      }

      // FIX 10 robustness: grading the new road's bed (pass 1 above) can nudge
      // terrain right under a NEIGHBORING already-placed road (e.g. a T-branch
      // grading near the road it snapped onto). Re-clamp every edge's deck
      // against current ground so nothing ends up buried or submerged as a
      // side effect of a later placement.
      this._reclampAllEdges();

      this._rebuildHubs();
      this._rebuildStreetLights();
      this._adjacency = null;
      if (Game.Zoning) Game.Zoning.onRoadsChanged();
      if (Game.Economy) Game.Economy.spend(totalCost, "Road construction");
      return createdEdges[0];
    },

    // The road strip is `width` wide, not a zero-width line — on a cross-slope
    // the uphill shoulder can poke through a deck graded only to the centerline
    // height. Sample ground at the centerline AND both strip edges (offset by
    // width/2 + 0.5 along the perpendicular derived from neighboring pts, same
    // way _rebuildEdgeMesh derives its strip normal) and take the max.
    _groundMaxAt: function (pts, i, width) {
      var terrain = Game.Terrain;
      var prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
      var tx = next.x - prev.x, tz = next.z - prev.z;
      var tl = Math.hypot(tx, tz) || 1;
      var nx = -tz / tl, nz = tx / tl;
      var half = width / 2 + 0.5;
      var p = pts[i];
      var gC = terrain.heightAt(p.x, p.z);
      var gL = terrain.heightAt(p.x + nx * half, p.z + nz * half);
      var gR = terrain.heightAt(p.x - nx * half, p.z - nz * half);
      return Math.max(gC, gL, gR);
    },

    // Re-clamp every edge's elev array against the current terrain so a deck
    // point can never end up buried (or submerged over water) as a side
    // effect of grading done while placing a different road.
    _reclampAllEdges: function () {
      var terrain = Game.Terrain, wl = terrain.waterLevel;
      var self = this;
      this.edges.forEach(function (edge) {
        var width = TYPES[edge.type].width;
        var changed = false;
        for (var i = 0; i < edge.pts.length; i++) {
          var maxGround = self._groundMaxAt(edge.pts, i, width);
          var minAllowed = maxGround + 0.18;
          if (maxGround < wl) minAllowed = Math.max(minAllowed, wl + 2.0);
          if (edge.elev[i] < minAllowed) { edge.elev[i] = minAllowed; changed = true; }
        }
        if (changed) self._rebuildEdgeMesh(edge);
      });
    },

    // Auto-grade terrain under the road path; auto-bridge water crossings.
    // FIX 10: elevation is derived per-point from the (graded) ground height
    // rather than a single lerp between endpoints, so it can never bury or
    // submerge a deck segment on uneven terrain — followed by a few smoothing
    // passes (endpoints pinned) with a hard floor clamp after each pass.
    // Ground height uses _groundMaxAt (centerline + both strip edges) so a
    // cross-slope's uphill shoulder can't poke through the deck between
    // samples, and the grading brush is widened to cut the shoulders too.
    _gradeAndElevate: function (edge) {
      var terrain = Game.Terrain;
      var wl = terrain.waterLevel;
      var pts = edge.pts;
      var width = TYPES[edge.type].width;
      var startH = terrain.heightAt(pts[0].x, pts[0].z);
      var endH = terrain.heightAt(pts[pts.length - 1].x, pts[pts.length - 1].z);
      var i, t, p, target, maxGround;

      // Pass 1: grade a smooth bed (and shoulders) toward the endpoint-
      // interpolated line, skipping points that are underwater.
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        t = pts.length > 1 ? i / (pts.length - 1) : 0;
        target = util.lerp(startH, endH, t);
        if (terrain.heightAt(p.x, p.z) >= wl + 0.4) terrain.applyBrush(p.x, p.z, "flatten", width * 1.3, 0.9, target);
      }

      // Pass 2: per-point deck height from the max of centerline + both strip edges.
      edge.bridge = false;
      edge.elev = [];
      for (i = 0; i < pts.length; i++) {
        maxGround = this._groundMaxAt(pts, i, width);
        if (maxGround < wl + 0.4) {
          edge.bridge = true;
          edge.elev.push(wl + 2.2);
        } else {
          edge.elev.push(maxGround + 0.22);
        }
      }

      // Pass 3: 3 smoothing passes, endpoints pinned, clamped after each pass
      // to the same 3-sample max-ground floor (never dip below ground, or
      // below water clearance over water).
      for (var pass = 0; pass < 3; pass++) {
        var next = edge.elev.slice();
        for (i = 1; i < edge.elev.length - 1; i++) {
          next[i] = (edge.elev[i - 1] + edge.elev[i] + edge.elev[i + 1]) / 3;
        }
        edge.elev = next;
        for (i = 0; i < edge.elev.length; i++) {
          maxGround = this._groundMaxAt(pts, i, width);
          var minAllowed = maxGround + 0.18;
          if (maxGround < wl) minAllowed = Math.max(minAllowed, wl + 2.0);
          if (edge.elev[i] < minAllowed) edge.elev[i] = minAllowed;
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

      var mat = this.roadMats[edge.type]; // FIX 11: shared per-type material, not one per edge
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
          if (h <= 1.5) continue; // FIX 10: pylons only where the deck actually clears the ground
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
        deg[e.a] = deg[e.a] || { count: 0, maxW: 0, maxElev: -Infinity };
        deg[e.b] = deg[e.b] || { count: 0, maxW: 0, maxElev: -Infinity };
        deg[e.a].count++; deg[e.b].count++;
        deg[e.a].maxW = Math.max(deg[e.a].maxW, TYPES[e.type].width);
        deg[e.b].maxW = Math.max(deg[e.b].maxW, TYPES[e.type].width);
        // FIX 3: hub sits at deck height, not terrain height — take the max
        // of the connecting edges' elevation at their endpoint on this node.
        deg[e.a].maxElev = Math.max(deg[e.a].maxElev, e.elev[0]);
        deg[e.b].maxElev = Math.max(deg[e.b].maxElev, e.elev[e.elev.length - 1]);
      });
      var self = this;
      Object.keys(deg).forEach(function (id) {
        var info = deg[id];
        if (info.count < 2) return;
        var node = self.nodes.find(function (n) { return n.id == id; });
        if (!node) return;
        var r = info.maxW / 2 + (info.count > 2 ? 1.2 : 0.2);
        var h = info.maxElev + 0.02;
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
      // FIX 11: tint the 3 shared materials directly instead of looping every edge mesh.
      var self = this;
      Object.keys(this.roadMats).forEach(function (t) { self.roadMats[t].color.copy(c); });
    }
  };

  Game.Roads = Roads;
})(window);

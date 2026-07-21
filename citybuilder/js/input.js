/* input.js
 * Single place that turns raw pointer/touch/keyboard/wheel events into
 * either camera moves or tool actions. The split is: when the "select"
 * tool is active, a single finger/mouse drag pans the camera (this is the
 * idle/browsing mode); when any other tool is active, single-finger drag
 * performs that tool, and the camera is instead driven by the two-finger
 * gesture (pinch = zoom, twist = rotate yaw, vertical drag = tilt pitch) —
 * so tool use and camera control never fight over the same gesture.
 * Desktop mirrors this with left-drag = tool/pan, right-drag = rotate/tilt,
 * wheel = zoom, WASD/arrows = pan, Q/E = yaw.
 */
(function (global) {
  "use strict";
  var util = Game.util;

  var Input = {
    pointers: new Map(),
    keys: {},
    dragActive: false,
    lastSingle: null,
    twoFingerState: null,
    tapStart: null,

    init: function (dom) {
      this.dom = dom;
      var self = this;

      dom.addEventListener("pointerdown", function (e) { self._onDown(e); }, { passive: false });
      dom.addEventListener("pointermove", function (e) { self._onMove(e); }, { passive: false });
      dom.addEventListener("pointerup", function (e) { self._onUp(e); }, { passive: false });
      dom.addEventListener("pointercancel", function (e) { self._onUp(e); }, { passive: false });
      dom.addEventListener("pointerleave", function (e) { if (self.pointers.size === 1) self._onUp(e); });
      dom.addEventListener("wheel", function (e) { self._onWheel(e); }, { passive: false });
      dom.addEventListener("contextmenu", function (e) { e.preventDefault(); });
      window.addEventListener("keydown", function (e) { self.keys[e.code] = true; });
      window.addEventListener("keyup", function (e) { self.keys[e.code] = false; });

      this._buildBrushRing();
      this._buildGhost();
      return this;
    },

    _buildBrushRing: function () {
      var geo = new THREE.RingGeometry(1, 1.15, 32);
      geo.rotateX(-Math.PI / 2);
      var mat = new THREE.MeshBasicMaterial({ color: 0x00d9c0, transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide });
      this.brushRing = new THREE.Mesh(geo, mat);
      this.brushRing.visible = false;
      this.brushRing.renderOrder = 10;
      Game.scene.add(this.brushRing);
    },
    _buildGhost: function () {
      this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x00d9c0, transparent: true, opacity: 0.45 }));
      this.ghost.visible = false;
      Game.scene.add(this.ghost);
    },

    _raycastGround: function (clientX, clientY) {
      var rect = this.dom.getBoundingClientRect();
      var ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      Game.raycaster.setFromCamera(ndc, Game.camera);
      var hits = Game.raycaster.intersectObject(Game.Terrain.mesh);
      if (hits.length) return { x: hits[0].point.x, z: hits[0].point.z };
      return null;
    },

    // ---------------- pointer handling ----------------
    _onDown: function (e) {
      if (e.target !== this.dom) return;
      this.dom.setPointerCapture && this.dom.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button });
      e.preventDefault();

      if (this.pointers.size === 1) {
        this.tapStart = { x: e.clientX, y: e.clientY, moved: false };
        this._beginPrimary(e);
      } else if (this.pointers.size === 2) {
        this._cancelPrimary();
        this._beginTwoFinger();
      }
    },

    _onMove: function (e) {
      if (!this.pointers.has(e.pointerId)) return;
      var p = this.pointers.get(e.pointerId);
      var dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.tapStart && (Math.abs(e.clientX - this.tapStart.x) > 5 || Math.abs(e.clientY - this.tapStart.y) > 5)) this.tapStart.moved = true;

      if (this.pointers.size === 1) this._movePrimary(e, dx, dy);
      else if (this.pointers.size === 2) this._moveTwoFinger();
    },

    _onUp: function (e) {
      if (!this.pointers.has(e.pointerId)) return;
      var wasSize = this.pointers.size;
      this.pointers.delete(e.pointerId);
      if (wasSize === 1) this._endPrimary(e);
      if (wasSize >= 2) { this.twoFingerState = null; }
      if (this.pointers.size === 1) {
        // dropped from two to one finger — restart primary tracking cleanly
        var remaining = null;
        this.pointers.forEach(function (v) { remaining = v; });
      }
    },

    _onWheel: function (e) {
      e.preventDefault();
      Game.Terrain.zoomCamera(e.deltaY * 0.001);
    },

    // ---------------- primary (1-finger / left mouse) ----------------
    _beginPrimary: function (e) {
      var isRightMouse = e.pointerType === "mouse" && e.button === 2;
      if (isRightMouse) { this.rotating = true; return; }
      if (Game.Roads.curvePending) return; // curve handle drag handled in move
      var pt = this._raycastGround(e.clientX, e.clientY);
      if (!pt) return;
      this.primaryDown = true;

      if (Game.tool === "select") { this.panRef = pt; return; }
      if (Game.tool === "terrain") { this._applyTerrainBrush(pt); return; }
      if (Game.tool === "roads") { Game.Roads.startDrag(pt); return; }
      if (Game.tool === "zone") { Game.Zoning.paintAt(pt.x, pt.z, Game.zoneType, Game.zoneBrushRadius || 8); return; }
      if (Game.tool === "build") { this.ghost.visible = true; this._updateGhost(pt); return; }
      if (Game.tool === "bulldoze") { this._applyBulldoze(pt); return; }
    },

    _movePrimary: function (e, dx, dy) {
      if (this.rotating) {
        Game.Terrain.rotateCamera(dx * 0.005, -dy * 0.004);
        return;
      }
      if (Game.Roads.curvePending) {
        var pt2 = this._raycastGround(e.clientX, e.clientY);
        if (pt2) Game.Roads.dragCurveHandle(pt2);
        return;
      }
      if (!this.primaryDown) return;
      var pt = this._raycastGround(e.clientX, e.clientY);
      if (!pt) return;

      if (Game.tool === "select") {
        if (this.panRef) {
          var rect = this.dom.getBoundingClientRect();
          var scale = Game.Terrain.cam.distance * 0.0016;
          Game.Terrain.panCamera(-dx * scale, -dy * scale);
        }
        return;
      }
      if (Game.tool === "terrain") { this._applyTerrainBrush(pt); return; }
      if (Game.tool === "roads") { Game.Roads.updateDrag(pt); return; }
      if (Game.tool === "zone") { Game.Zoning.paintAt(pt.x, pt.z, Game.zoneType, Game.zoneBrushRadius || 8); return; }
      if (Game.tool === "build") { this._updateGhost(pt); return; }
      if (Game.tool === "bulldoze") { this._applyBulldoze(pt); return; }
    },

    _endPrimary: function (e) {
      this.rotating = false;
      var wasTap = this.tapStart && !this.tapStart.moved;
      this.tapStart = null;
      if (!this.primaryDown) { return; }
      this.primaryDown = false;
      var pt = this._raycastGround(e.clientX, e.clientY);
      if (Game.tool === "roads" && pt && !Game.Roads.curvePending) Game.Roads.endDrag(pt);
      if (Game.tool === "build" && pt) {
        this._commitBuild(pt);
      }
      this.panRef = null;
      this.brushRing.visible = false;
    },

    _cancelPrimary: function () {
      this.primaryDown = false;
      this.panRef = null;
      if (Game.tool === "roads" && !Game.Roads.curvePending) Game.Roads.cancelDrag();
      this.brushRing.visible = false;
    },

    // ---------------- two-finger camera gesture ----------------
    _beginTwoFinger: function () {
      var pts = Array.from(this.pointers.values());
      var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      var angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      var midY = (pts[0].y + pts[1].y) / 2;
      this.twoFingerState = { dist: dist, angle: angle, midY: midY };
    },
    _moveTwoFinger: function () {
      if (!this.twoFingerState) { this._beginTwoFinger(); return; }
      var pts = Array.from(this.pointers.values());
      var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      var angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      var midY = (pts[0].y + pts[1].y) / 2;

      var zoomDelta = (this.twoFingerState.dist - dist) * 0.0026;
      var yawDelta = angle - this.twoFingerState.angle;
      var pitchDelta = (midY - this.twoFingerState.midY) * 0.0035;

      Game.Terrain.zoomCamera(zoomDelta);
      Game.Terrain.rotateCamera(yawDelta, pitchDelta);

      this.twoFingerState = { dist: dist, angle: angle, midY: midY };
    },

    // ---------------- tool helpers ----------------
    _applyTerrainBrush: function (pt) {
      var b = Game.terrainBrush;
      this.brushRing.visible = true;
      this.brushRing.scale.set(b.radius, b.radius, b.radius);
      this.brushRing.position.set(pt.x, Game.Terrain.heightAt(pt.x, pt.z) + 0.4, pt.z);
      var target = b.mode === "flatten" ? Game.Terrain.heightAt(pt.x, pt.z) : 0;
      if (b.mode === "flatten" && b.flattenTarget != null) target = b.flattenTarget;
      Game.Terrain.applyBrush(pt.x, pt.z, b.mode, b.radius, b.strength * 0.16, target);
      if (Game.Roads) Game.Roads._rebuildHubs && null; // terrain edits don't require hub rebuild
    },

    _applyBulldoze: function (pt) {
      this.brushRing.visible = true;
      this.brushRing.scale.set(4, 4, 4);
      this.brushRing.position.set(pt.x, Game.Terrain.heightAt(pt.x, pt.z) + 0.4, pt.z);
      if (Game.Roads.bulldozeNear(pt.x, pt.z)) return;
      if (Game.Buildings.bulldozeNear(pt.x, pt.z)) return;
      Game.Zoning.paintAt(pt.x, pt.z, null, 4);
    },

    _updateGhost: function (pt) {
      var def = Game.Buildings.SERVICE_DEFS[Game.buildType];
      if (!def) { this.ghost.visible = false; return; }
      var ok = Game.Buildings.canPlaceService(Game.buildType, pt.x, pt.z);
      this.ghost.material.color.set(ok ? 0x00d9c0 : 0xff5470);
      this.ghost.scale.set(def.footprint, def.footprint * 0.6, def.footprint);
      this.ghost.position.set(pt.x, Game.Terrain.heightAt(pt.x, pt.z) + def.footprint * 0.3, pt.z);
      this.ghost.visible = true;
    },

    _commitBuild: function (pt) {
      if (!Game.buildType) return;
      Game.Buildings.placeService(Game.buildType, pt.x, pt.z, 0);
      this.ghost.visible = false;
    },

    onToolChanged: function () {
      this.brushRing.visible = false;
      this.ghost.visible = false;
      if (Game.Roads.curvePending) Game.Roads.cancelCurve();
      Game.Roads.cancelDrag();
    },

    // ---------------- keyboard continuous pan/rotate ----------------
    update: function (dt) {
      var k = this.keys, pan = 34 * dt, rot = 1.6 * dt;
      var dx = 0, dz = 0;
      if (k.KeyW || k.ArrowUp) dz -= 1;
      if (k.KeyS || k.ArrowDown) dz += 1;
      if (k.KeyA || k.ArrowLeft) dx -= 1;
      if (k.KeyD || k.ArrowRight) dx += 1;
      if (dx || dz) Game.Terrain.panCamera(dx * pan, dz * pan);
      if (k.KeyQ) Game.Terrain.rotateCamera(-rot, 0);
      if (k.KeyE) Game.Terrain.rotateCamera(rot, 0);
    }
  };

  Game.Input = Input;
})(window);

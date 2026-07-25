/* ============================================================
   VELL — free camera + picking (mouse, keyboard, touch)
   ============================================================ */
(function (TD) {
  'use strict';

  var I = TD.input = {};
  var camera, dom;
  var target = new THREE.Vector3(0, 0, 0);
  var yaw = 0.7, pitch = 0.92, dist = 46;
  var vYaw = 0, vPitch = 0, vDist = 0;
  var panV = new THREE.Vector2();
  var keys = {};
  var pointers = {};
  var dragMode = null;     // 'pan' | 'orbit'
  var dragMoved = 0;
  var lastPos = { x: 0, y: 0 };
  var pinch = { dist: 0, ang: 0, cx: 0, cy: 0 };
  var raycaster = new THREE.Raycaster();
  var ndc = new THREE.Vector2();
  var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  var _hit = new THREE.Vector3();

  I.enabled = true;
  I.hoverCell = { x: -1, z: -1, valid: false };

  var MIN_DIST = 8, MAX_DIST = 130;
  var MIN_PITCH = 0.18, MAX_PITCH = 1.45;

  I.init = function (cam, domEl) {
    camera = cam; dom = domEl;
    I.camera = cam;
    I.target = target;

    dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    dom.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey(true));
    window.addEventListener('keyup', onKey(false));

    target.set(TD.terrain.base.wx, TD.terrain.base.y, TD.terrain.base.wz);
    apply();
    return I;
  };

  function onKey(down) {
    return function (e) {
      var k = e.key.toLowerCase();
      keys[k] = down;
      if (!down) return;
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      TD.bus.emit('key', k);
    };
  }

  function pointerCount() { var n = 0; for (var k in pointers) n++; return n; }

  function onDown(e) {
    if (!I.enabled) return;
    dom.setPointerCapture && dom.setPointerCapture(e.pointerId);
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY, start: { x: e.clientX, y: e.clientY }, t: performance.now() };
    lastPos.x = e.clientX; lastPos.y = e.clientY;
    dragMoved = 0;
    var n = pointerCount();
    if (n === 1) {
      dragMode = (e.button === 2 || e.button === 1 || e.shiftKey) ? 'orbit' : 'pan';
    } else if (n === 2) {
      dragMode = 'pinch';
      var p = twoPointers();
      pinch.dist = p.d; pinch.ang = p.a; pinch.cx = p.cx; pinch.cy = p.cy;
    }
    TD.audio.resume();
  }

  function twoPointers() {
    var arr = [];
    for (var k in pointers) arr.push(pointers[k]);
    var dx = arr[1].x - arr[0].x, dy = arr[1].y - arr[0].y;
    return {
      d: Math.hypot(dx, dy), a: Math.atan2(dy, dx),
      cx: (arr[0].x + arr[1].x) / 2, cy: (arr[0].y + arr[1].y) / 2
    };
  }

  function onMove(e) {
    if (pointers[e.pointerId]) {
      pointers[e.pointerId].x = e.clientX;
      pointers[e.pointerId].y = e.clientY;
    }
    var n = pointerCount();

    if (n === 0) {
      if (e.pointerType === 'mouse') updateHover(e.clientX, e.clientY);
      return;
    }
    var dx = e.clientX - lastPos.x, dy = e.clientY - lastPos.y;
    lastPos.x = e.clientX; lastPos.y = e.clientY;
    dragMoved += Math.abs(dx) + Math.abs(dy);

    if (n === 1) {
      if (dragMode === 'orbit') {
        yaw -= dx * 0.006;
        pitch = TD.util.clamp(pitch - dy * 0.005, MIN_PITCH, MAX_PITCH);
      } else {
        panBy(dx, dy);
      }
    } else if (n === 2) {
      var p = twoPointers();
      var scale = p.d / Math.max(pinch.dist, 1);
      dist = TD.util.clamp(dist / scale, MIN_DIST, MAX_DIST);
      var da = p.a - pinch.ang;
      if (da > Math.PI) da -= 6.283; if (da < -Math.PI) da += 6.283;
      yaw -= da;
      pitch = TD.util.clamp(pitch - (p.cy - pinch.cy) * 0.004, MIN_PITCH, MAX_PITCH);
      panBy((p.cx - pinch.cx) * 0.45, 0);
      pinch = { dist: p.d, ang: p.a, cx: p.cx, cy: p.cy };
    }
    apply();
  }

  function onUp(e) {
    var had = pointers[e.pointerId];
    delete pointers[e.pointerId];
    if (!had) return;
    var n = pointerCount();
    if (n === 0) {
      var dt = performance.now() - had.t;
      var moved = Math.abs(e.clientX - had.start.x) + Math.abs(e.clientY - had.start.y);
      if (moved < 12 && dt < 550 && I.enabled) tap(e.clientX, e.clientY);
      dragMode = null;
    } else if (n === 1) {
      dragMode = 'pan';
      for (var k in pointers) { lastPos.x = pointers[k].x; lastPos.y = pointers[k].y; }
    }
  }

  function onWheel(e) {
    e.preventDefault();
    var f = Math.exp(TD.util.clamp(e.deltaY, -220, 220) * 0.0016);
    dist = TD.util.clamp(dist * f, MIN_DIST, MAX_DIST);
    apply();
  }

  function panBy(dx, dy) {
    var k = dist * 0.0016;
    var sinY = Math.sin(yaw), cosY = Math.cos(yaw);
    // screen-right and screen-forward in world space
    target.x -= (dx * cosY - dy * sinY) * k * 1.4;
    target.z -= (dx * sinY + dy * cosY) * k * 1.4;
    clampTarget();
  }

  function clampTarget() {
    var lim = TD.HALF + 12;
    target.x = TD.util.clamp(target.x, -lim, lim);
    target.z = TD.util.clamp(target.z, -lim, lim);
    target.y = TD.util.lerp(target.y, Math.max(TD.terrain.heightAt(target.x, target.z), TD.WATER_Y), 0.35);
  }

  function apply() {
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    camera.position.set(
      target.x + Math.sin(yaw) * cp * dist,
      target.y + sp * dist,
      target.z + Math.cos(yaw) * cp * dist
    );
    camera.lookAt(target);
  }

  /* ---------- picking ---------- */
  function screenToCell(cx, cy) {
    var rect = dom.getBoundingClientRect();
    ndc.x = ((cx - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((cy - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    var hits = TD.terrain.mesh ? raycaster.intersectObject(TD.terrain.mesh, false) : [];
    if (hits.length) _hit.copy(hits[0].point);
    else if (!raycaster.ray.intersectPlane(plane, _hit)) return null;
    var x = TD.worldToCellX(_hit.x), z = TD.worldToCellZ(_hit.z);
    if (!TD.inBounds(x, z)) return null;
    return { x: x, z: z, point: _hit.clone() };
  }
  I.screenToCell = screenToCell;

  function updateHover(cx, cy) {
    var c = screenToCell(cx, cy);
    if (!c) { I.hoverCell.x = -1; TD.bus.emit('hover', null); return; }
    if (c.x !== I.hoverCell.x || c.z !== I.hoverCell.z) {
      I.hoverCell.x = c.x; I.hoverCell.z = c.z;
      TD.bus.emit('hover', c);
    }
  }

  function tap(cx, cy) {
    var c = screenToCell(cx, cy);
    if (!c) return;
    TD.bus.emit('tap', c);
  }

  /* ---------- per-frame ---------- */
  I.update = function (dt) {
    var sp = dist * 0.9 * dt;
    var mx = 0, mz = 0;
    if (keys['w'] || keys['arrowup']) mz -= 1;
    if (keys['s'] || keys['arrowdown']) mz += 1;
    if (keys['a'] || keys['arrowleft']) mx -= 1;
    if (keys['d'] || keys['arrowright']) mx += 1;
    if (mx || mz) {
      var sinY = Math.sin(yaw), cosY = Math.cos(yaw);
      target.x += (mx * cosY - mz * sinY) * sp;
      target.z += (mx * sinY + mz * cosY) * sp;
      clampTarget();
    }
    if (keys['q']) yaw += dt * 1.2;
    if (keys['e']) yaw -= dt * 1.2;
    if (keys['r']) pitch = TD.util.clamp(pitch + dt * 0.8, MIN_PITCH, MAX_PITCH);
    if (keys['f']) pitch = TD.util.clamp(pitch - dt * 0.8, MIN_PITCH, MAX_PITCH);
    if (keys['=']||keys['+']) dist = TD.util.clamp(dist - dt * 30, MIN_DIST, MAX_DIST);
    if (keys['-']) dist = TD.util.clamp(dist + dt * 30, MIN_DIST, MAX_DIST);
    if (mx || mz || keys['q'] || keys['e'] || keys['r'] || keys['f'] || keys['=']||keys['+'] || keys['-']) apply();
    else {
      // keep the camera glued to terrain height as it drifts
      clampTarget();
      apply();
    }
  };

  I.focusOn = function (wx, wz, d) {
    target.x = wx; target.z = wz;
    if (d) dist = TD.util.clamp(d, MIN_DIST, MAX_DIST);
    clampTarget(); apply();
  };
  I.getDistance = function () { return dist; };

})(window.TD);

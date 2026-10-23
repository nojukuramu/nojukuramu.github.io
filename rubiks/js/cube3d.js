/* Rubiks — the cube in 3D
 *
 * Three.js is the build every 3D app here vendors (r160, lifted byte for
 * byte from ballzooka/vendor). It is 650 KB, so it is imported the first
 * time the 3D view opens, not on page load: a solver who never opens it
 * never parses it. The service worker still caches it, so it works offline.
 *
 * The state is not kept here. Every sticker mesh is tied to a sticker of the
 * cube.js model; a turn asks cube.js which pieces are in the layer, animates
 * them on a pivot, then lets cube.js turn the model and puts each sticker
 * back exactly where the model says. The 3D cube and the flat preview are
 * therefore the same cube, and rounding never accumulates over 100 moves.
 *
 * Rendering is on demand: a frame is drawn while a turn animates or the view
 * is being dragged, and not otherwise, so an open sheet costs no battery. */
"use strict";

var RK = RK || {};

RK.cube3d = (function () {
  var T = null;
  var SIZE = 3; // the whole cube is 3 units wide whatever N is, so the camera never moves

  function load() {
    if (T) return Promise.resolve(T);
    return import("three").then(function (m) { T = m; return m; });
  }

  function roundedSquare(w, r) {
    var s = new T.Shape(), h = w / 2;
    s.moveTo(-h + r, -h);
    s.lineTo(h - r, -h); s.quadraticCurveTo(h, -h, h, -h + r);
    s.lineTo(h, h - r); s.quadraticCurveTo(h, h, h - r, h);
    s.lineTo(-h + r, h); s.quadraticCurveTo(-h, h, -h, h - r);
    s.lineTo(-h, -h + r); s.quadraticCurveTo(-h, -h, -h + r, -h);
    return new T.ShapeGeometry(s, 4);
  }

  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  function create(host) {
    return load().then(function () {
      var canvas = document.createElement("canvas");
      var renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      host.appendChild(canvas);

      var scene = new T.Scene();
      var camera = new T.PerspectiveCamera(28, 1, 0.1, 100);
      scene.add(camera);
      scene.add(new T.HemisphereLight(0xffffff, 0x3a3d46, 1.6));
      /* The key light rides with the camera, so whichever side is turned
         towards you is the lit one. */
      var key = new T.DirectionalLight(0xffffff, 1.9);
      key.position.set(2, 4, 3);
      camera.add(key);

      var group = new T.Group();
      scene.add(group);

      var bodyMat = new T.MeshStandardMaterial({ color: 0x14161b, roughness: 0.55, metalness: 0.05 });
      var mats = {};
      for (var f in RK.cube.COLOR) mats[f] = new T.MeshStandardMaterial({ color: RK.cube.COLOR[f], roughness: 0.32, metalness: 0 });

      var n = 0, unit = 1, model = null, stickers = [], bodies = [];
      var bodyGeo = null, stickerGeo = null;
      var anim = null, raf = 0, dirty = false, dragging = false;
      var view = { theta: 0.62, phi: 0.52 };
      var DEFAULT = { theta: 0.62, phi: 0.52 };
      var Z = new T.Vector3(0, 0, 1), tmp = new T.Vector3();

      function place(mesh, p) {
        var k = Math.abs(p[0]) === n ? 0 : Math.abs(p[1]) === n ? 1 : 2;
        var nrm = [0, 0, 0];
        nrm[k] = p[k] > 0 ? 1 : -1;
        mesh.position.set(p[0] * unit / 2 + nrm[0] * 0.004, p[1] * unit / 2 + nrm[1] * 0.004, p[2] * unit / 2 + nrm[2] * 0.004);
        mesh.quaternion.setFromUnitVectors(Z, tmp.set(nrm[0], nrm[1], nrm[2]));
      }

      function clear() {
        while (group.children.length) group.remove(group.children[0]);
        if (bodyGeo) bodyGeo.dispose();
        if (stickerGeo) stickerGeo.dispose();
        stickers = []; bodies = [];
      }

      /* Build an N cube already at the state `alg` leaves it in. */
      function setup(size, alg) {
        finish();
        clear();
        n = size; unit = SIZE / n;
        bodyGeo = new T.BoxGeometry(unit * 0.97, unit * 0.97, unit * 0.97);
        stickerGeo = roundedSquare(unit * 0.86, unit * 0.15);
        for (var x = -(n - 1); x <= n - 1; x += 2)
          for (var y = -(n - 1); y <= n - 1; y += 2)
            for (var z = -(n - 1); z <= n - 1; z += 2) {
              if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== n - 1) continue;
              var b = new T.Mesh(bodyGeo, bodyMat);
              b.position.set(x * unit / 2, y * unit / 2, z * unit / 2);
              group.add(b);
              bodies.push({ mesh: b, c: [x, y, z] });
            }
        model = RK.cube.apply(RK.cube.solved(n), alg);
        model.st.forEach(function (s) {
          var m = new T.Mesh(stickerGeo, mats[s.c]);
          place(m, s.p);
          group.add(m);
          stickers.push({ mesh: m, ref: s });
        });
        request();
      }

      /* Animate one move; dir -1 plays it backwards. Resolves when done. */
      function turn(tok, dir, ms) {
        finish();
        var mv = RK.cube.parse(tok);
        if (!mv || !model) return Promise.resolve();
        if (dir < 0 && mv.turns !== 2) mv = { face: mv.face, depth: mv.depth, turns: 4 - mv.turns };
        var a = RK.cube.AXIS[mv.face];
        var angle = mv.turns === 2 ? -Math.PI * (dir < 0 ? -1 : 1) : mv.turns === 1 ? -Math.PI / 2 : Math.PI / 2;
        var pivot = new T.Object3D();
        group.add(pivot);
        var moving = [];
        bodies.forEach(function (b) { if (RK.cube.inLayer(n, b.c, mv)) { pivot.attach(b.mesh); moving.push(b); } });
        stickers.forEach(function (s) { if (RK.cube.inLayer(n, s.ref.p, mv)) { pivot.attach(s.mesh); moving.push(s); } });
        return new Promise(function (resolve) {
          anim = {
            start: performance.now(), ms: Math.max(1, ms), axis: new T.Vector3(a[0], a[1], a[2]), angle: angle, pivot: pivot,
            done: function () {
              moving.forEach(function (o) { group.attach(o.mesh); });
              group.remove(pivot);
              RK.cube.turn(model, mv);
              /* Back onto the grid from the model, not from the float
                 rotation: a body's layer lands on itself, a sticker goes
                 where cube.js put it. */
              moving.forEach(function (o) {
                if (o.ref) place(o.mesh, o.ref.p);
                else { o.mesh.position.set(o.c[0] * unit / 2, o.c[1] * unit / 2, o.c[2] * unit / 2); o.mesh.quaternion.identity(); }
              });
              anim = null;
              request();
              resolve();
            }
          };
          request();
        });
      }

      /* Snap a running animation to its end, so a quick second tap never
         starts a turn from a half-turned layer. */
      function finish() { if (anim) anim.done(); }

      function aim() {
        var w = host.clientWidth || 300, h = host.clientHeight || 300;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        var tv = Math.tan(camera.fov * Math.PI / 360), th = tv * camera.aspect;
        var d = (SIZE * 0.92) / Math.min(tv, th);
        camera.position.set(d * Math.cos(view.phi) * Math.sin(view.theta), d * Math.sin(view.phi), d * Math.cos(view.phi) * Math.cos(view.theta));
        camera.lookAt(0, 0, 0);
      }

      function resize() {
        var w = host.clientWidth, h = host.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        request();
      }

      function frame(now) {
        raf = 0;
        if (anim) {
          var t = Math.min(1, (now - anim.start) / anim.ms);
          anim.pivot.quaternion.setFromAxisAngle(anim.axis, anim.angle * ease(t));
          if (t >= 1) anim.done();
        }
        aim();
        renderer.render(scene, camera);
        dirty = false;
        if (anim || dirty) raf = requestAnimationFrame(frame);
      }

      function request() {
        dirty = true;
        if (!raf) raf = requestAnimationFrame(frame);
      }

      /* Drag to look round the cube; double-tap puts it back. */
      var last = null;
      canvas.style.touchAction = "none";
      canvas.addEventListener("pointerdown", function (e) {
        dragging = true; last = [e.clientX, e.clientY];
        try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      });
      canvas.addEventListener("pointermove", function (e) {
        if (!dragging) return;
        view.theta -= (e.clientX - last[0]) * 0.009;
        view.phi = Math.max(-1.35, Math.min(1.35, view.phi + (e.clientY - last[1]) * 0.009));
        last = [e.clientX, e.clientY];
        request();
      });
      function up() { dragging = false; }
      canvas.addEventListener("pointerup", up);
      canvas.addEventListener("pointercancel", up);
      canvas.addEventListener("dblclick", function () { resetView(); });

      function resetView() { view.theta = DEFAULT.theta; view.phi = DEFAULT.phi; request(); }

      if (typeof ResizeObserver === "function") new ResizeObserver(resize).observe(host);
      resize();

      return {
        setup: setup,
        turn: turn,
        finish: finish,
        resize: resize,
        resetView: resetView,
        busy: function () { return !!anim; },
        /* For the browser test: the model the meshes were placed from. */
        model: function () { return model; }
      };
    });
  }

  return { create: create };
})();

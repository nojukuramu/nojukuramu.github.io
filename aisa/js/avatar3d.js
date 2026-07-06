/* ============================================================
   avatar3d.js — Aisa's 3D rig. Toon-shaded chibi figurine,
   100% procedural (no model files): primitive hair, hoodie body,
   and an anime-style painted face — a CanvasTexture on a curved
   patch, so 3D-Aisa shares the same expressions & visemes as 2D.

   Lazy: nothing loads until stage.js calls AisaRig3DInit().
   three.js is vendored at js/vendor/ and resolved via importmap.
   ============================================================ */
(function () {
  "use strict";

  window.AisaRig3DInit = function (container) {
    return import("three").then(function (THREE) {
      return buildRig(THREE, container);
    });
  };

  function buildRig(THREE, container) {
    /* ---------- renderer / scene / camera ---------- */
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 1.6, 5.6);
    camera.lookAt(0, 1.12, 0);

    scene.add(new THREE.HemisphereLight(0x8d7cff, 0x16182a, 1.1));
    var key = new THREE.DirectionalLight(0xfff6ec, 1.4);
    key.position.set(2, 3, 4);
    scene.add(key);
    var rim = new THREE.DirectionalLight(0x35e0cf, 0.9);
    rim.position.set(-3, 1.5, -3);
    scene.add(rim);

    /* toon gradient (4 steps) */
    var grad = new THREE.DataTexture(new Uint8Array([90, 160, 220, 255]), 4, 1, THREE.RedFormat);
    grad.minFilter = grad.magFilter = THREE.NearestFilter;
    grad.needsUpdate = true;

    function toon(color) {
      return new THREE.MeshToonMaterial({ color: color, gradientMap: grad });
    }
    var M = {
      skin: toon(0xf7d3b8),
      hair: toon(0x7c6cf0),
      hairDark: toon(0x5b4bd6),
      hoodie: toon(0x1e2138),
      hoodie2: toon(0x2a2e4e),
      teal: new THREE.MeshToonMaterial({ color: 0x35e0cf, gradientMap: grad, emissive: 0x1a8f84 }),
      platform: toon(0x151830)
    };

    var root = new THREE.Group();
    scene.add(root);

    /* ---------- platform ---------- */
    var platform = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.55, 0.08, 48), M.platform);
    platform.position.y = -0.04;
    root.add(platform);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.018, 8, 64), M.teal);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.015;
    root.add(ring);

    /* ---------- body ---------- */
    var figure = new THREE.Group();
    root.add(figure);

    var torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.46, 0.55, 8, 20), M.hoodie);
    torso.scale.set(1, 0.85, 0.8);
    torso.position.y = 0.62;
    figure.add(torso);

    var hood = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.12, 12, 32), M.hoodie2);
    hood.rotation.x = 1.4;
    hood.position.set(0, 1.12, -0.12);
    figure.add(hood);

    [-1, 1].forEach(function (s) {
      var arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.5, 6, 14), M.hoodie);
      arm.position.set(0.5 * s, 0.55, 0);
      arm.rotation.z = 0.22 * s;
      figure.add(arm);
      var string = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.26, 6), M.teal);
      string.position.set(0.1 * s, 0.9, 0.37);
      string.rotation.x = -0.12;
      figure.add(string);
      var tip = new THREE.Mesh(new THREE.SphereGeometry(0.028, 10, 10), M.teal);
      tip.position.set(0.1 * s, 0.76, 0.39);
      figure.add(tip);
    });

    var chestStar = new THREE.Mesh(starGeo(THREE, 0.085, 0.034, 0.025), M.teal);
    chestStar.position.set(0, 0.5, 0.39);
    figure.add(chestStar);

    var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.3, 14), M.skin);
    neck.position.y = 1.12;
    figure.add(neck);

    /* ---------- head ---------- */
    var headGroup = new THREE.Group();
    headGroup.position.y = 1.62;
    figure.add(headGroup);

    var head = new THREE.Mesh(new THREE.SphereGeometry(0.62, 40, 28), M.skin);
    head.scale.set(1, 0.95, 0.92);
    headGroup.add(head);

    /* painted face — canvas texture on a curved front patch.
       Opaque skin background + toon material means the patch is lit
       exactly like the head sphere beneath, so the seam disappears. */
    var faceCanvas = document.createElement("canvas");
    faceCanvas.width = faceCanvas.height = 512;
    var fctx = faceCanvas.getContext("2d");
    var faceTex = new THREE.CanvasTexture(faceCanvas);
    faceTex.colorSpace = THREE.SRGBColorSpace;
    var facePatch = new THREE.Mesh(
      new THREE.SphereGeometry(0.632, 40, 28, Math.PI / 2 - 0.95, 1.9, 1.0, 1.15),
      new THREE.MeshToonMaterial({ map: faceTex, gradientMap: grad })
    );
    facePatch.scale.copy(head.scale);
    headGroup.add(facePatch);

    /* ---------- hair ---------- */
    var hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.66, 32, 20, 0, Math.PI * 2, 0, 1.9), M.hair);
    hairCap.scale.set(1.04, 1.0, 0.99);
    /* negative tilt lifts the front edge above the brows; back edge drops to the nape */
    hairCap.rotation.x = -0.62;
    hairCap.position.set(0, 0.08, -0.05);
    headGroup.add(hairCap);

    var backHair = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 16), M.hairDark);
    backHair.scale.set(1.05, 1.7, 0.8);
    backHair.position.set(0, -0.42, -0.28);
    headGroup.add(backHair);

    /* back strand tips */
    for (var i = -2; i <= 2; i++) {
      var a = Math.PI + i * 0.42;
      var strand = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.7, 7), M.hairDark);
      strand.position.set(Math.sin(a) * 0.42, -1.0, Math.cos(a) * 0.42 - 0.1);
      strand.rotation.x = Math.PI;
      headGroup.add(strand);
    }

    /* side locks */
    [-1, 1].forEach(function (s) {
      var lock = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.68, 6, 12), M.hair);
      lock.position.set(0.58 * s, -0.32, 0.14);
      lock.rotation.z = 0.1 * s;
      headGroup.add(lock);
    });

    /* bangs — cones fanned across the forehead */
    for (var b = -3; b <= 3; b++) {
      var ba = b * 0.24;
      var len = 0.55 + (b % 2 === 0 ? 0.1 : 0);
      var bang = new THREE.Mesh(new THREE.ConeGeometry(0.115, len, 7), M.hair);
      bang.position.set(Math.sin(ba) * 0.48, 0.24 - Math.abs(b) * 0.015, Math.cos(ba) * 0.42 + 0.14);
      bang.rotation.x = Math.PI - 0.3;
      bang.rotation.z = -ba * 0.35;
      headGroup.add(bang);
    }

    /* ahoge — her sassy antenna */
    var ahogeCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.6, 0.05),
      new THREE.Vector3(0.05, 0.85, 0.02),
      new THREE.Vector3(-0.08, 1.0, 0),
      new THREE.Vector3(0.07, 1.12, -0.03)
    ]);
    var ahoge = new THREE.Mesh(new THREE.TubeGeometry(ahogeCurve, 12, 0.022, 6), M.hair);
    var ahogePivot = new THREE.Group();
    ahogePivot.add(ahoge);
    headGroup.add(ahogePivot);

    /* star hairpin */
    var pin = new THREE.Mesh(starGeo(THREE, 0.11, 0.045, 0.03), M.teal);
    pin.position.set(0.5, 0.36, 0.44);
    pin.rotation.y = 0.6;
    headGroup.add(pin);

    /* ---------- particles ---------- */
    var P_N = 90;
    var pGeo = new THREE.BufferGeometry();
    var pPos = new Float32Array(P_N * 3), pCol = new Float32Array(P_N * 3);
    var violet = new THREE.Color(0x9a8cff), teal = new THREE.Color(0x35e0cf);
    for (var p = 0; p < P_N; p++) {
      var pr = 1.0 + Math.random() * 1.4, pa = Math.random() * Math.PI * 2;
      pPos[p * 3] = Math.cos(pa) * pr;
      pPos[p * 3 + 1] = Math.random() * 2.6;
      pPos[p * 3 + 2] = Math.sin(pa) * pr;
      (p % 5 === 0 ? teal : violet).toArray(pCol, p * 3);
    }
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
    var particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
      size: 0.035, vertexColors: true, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    root.add(particles);

    /* ============================================================
       face painting — same expression language as the 2D rig
       ============================================================ */
    var EXPR = {
      neutral:   { mouth: "closed", blush: 0.35, eyes: 1,    browTilt: 0,     browLift: 0 },
      happy:     { mouth: "smile",  blush: 0.55, eyes: 1,    browTilt: 0,     browLift: 8 },
      smug:      { mouth: "smug",   blush: 0.4,  eyes: 0.72, browTilt: -0.25, browLift: 4 },
      surprised: { mouth: "o",      blush: 0.45, eyes: 1.12, browTilt: 0,     browLift: 16 },
      thinking:  { mouth: "flat",   blush: 0.3,  eyes: 0.85, browTilt: 0.2,   browLift: 2 },
      annoyed:   { mouth: "flat",   blush: 0.3,  eyes: 0.7,  browTilt: 0.45,  browLift: -6 },
      shy:       { mouth: "closed", blush: 0.85, eyes: 0.9,  browTilt: 0.1,   browLift: 4 },
      sleepy:    { mouth: "small",  blush: 0.35, eyes: 0.35, browTilt: 0,     browLift: -4 },
      serious:   { mouth: "closed", blush: 0.2,  eyes: 0.95, browTilt: 0.15,  browLift: 0 }
    };

    var face = { expr: EXPR.neutral, mouth: "closed", open: 1, px: 0, py: 0 };
    var lastDraw = null;

    function drawFace() {
      var sig = [face.expr.mouth, face.mouth, face.open.toFixed(2), face.px.toFixed(1),
                 face.py.toFixed(1), face.expr.blush, face.expr.browTilt, face.expr.browLift].join("|");
      if (sig === lastDraw) return;
      lastDraw = sig;

      var c = fctx;
      c.fillStyle = "#f7d3b8"; /* same tone as M.skin so the patch blends into the head */
      c.fillRect(0, 0, 512, 512);

      /* blush */
      c.fillStyle = "rgba(255,143,163," + face.expr.blush * 0.65 + ")";
      ellipse(c, 148, 318, 38, 16);
      ellipse(c, 364, 318, 38, 16);

      /* eyes */
      drawEye(c, 162, 245, 1);
      drawEye(c, 350, 245, -1);

      /* brows */
      c.strokeStyle = "#4a3bbd";
      c.lineWidth = 10;
      c.lineCap = "round";
      var bl = face.expr.browLift, bt = face.expr.browTilt;
      brow(c, 118, 178 - bl, 206, 178 - bl, bt);
      brow(c, 306, 178 - bl, 394, 178 - bl, -bt);

      /* tiny nose */
      c.strokeStyle = "rgba(221,165,131,.8)";
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(254, 306); c.quadraticCurveTo(260, 312, 255, 318);
      c.stroke();

      /* mouth */
      drawMouth(c, face.mouth);
      faceTex.needsUpdate = true;
    }

    function ellipse(c, x, y, rx, ry) {
      c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fill();
    }

    function brow(c, x1, y1, x2, y2, tilt) {
      /* tilt > 0 = inner end pulled down (annoyed); < 0 = raised smugly */
      var inner = x1 > 256 ? { x: x1, y: y1 + tilt * 40 } : { x: x2, y: y2 + tilt * 40 };
      var outer = x1 > 256 ? { x: x2, y: y2 } : { x: x1, y: y1 };
      c.beginPath();
      c.moveTo(outer.x, outer.y);
      c.quadraticCurveTo((outer.x + inner.x) / 2, Math.min(outer.y, inner.y) - 14, inner.x, inner.y);
      c.stroke();
    }

    function drawEye(c, cx, cy, side) {
      var open = Math.max(0, Math.min(1.2, face.open));
      if (open < 0.15) {
        c.strokeStyle = "#2c2350"; c.lineWidth = 9; c.lineCap = "round";
        c.beginPath();
        c.moveTo(cx - 36, cy + 2);
        c.quadraticCurveTo(cx, cy + 16, cx + 36, cy + 2);
        c.stroke();
        return;
      }
      var ry = 36 * open;
      c.save();
      c.beginPath();
      c.ellipse(cx, cy, 42, ry, 0, 0, Math.PI * 2);
      c.fillStyle = "#fff";
      c.fill();
      c.clip();
      /* iris */
      var ix = cx + face.px, iy = cy + face.py;
      var g = c.createLinearGradient(ix, iy - 30, ix, iy + 30);
      g.addColorStop(0, "#35e0cf"); g.addColorStop(0.55, "#7c6cf0"); g.addColorStop(1, "#4a3bbd");
      c.fillStyle = g;
      ellipse(c, ix, iy, 27, 30);
      c.fillStyle = "#171233";
      ellipse(c, ix, iy, 12, 14);
      c.fillStyle = "#fff";
      ellipse(c, ix - 9, iy - 10, 7, 7);
      c.fillStyle = "rgba(255,255,255,.85)";
      ellipse(c, ix + 9, iy + 9, 3.5, 3.5);
      c.restore();
      /* upper lash */
      c.strokeStyle = "#2c2350"; c.lineWidth = 11; c.lineCap = "round";
      c.beginPath();
      c.moveTo(cx - 42, cy - ry * 0.35);
      c.quadraticCurveTo(cx, cy - ry - 12, cx + 42, cy - ry * 0.35);
      c.stroke();
    }

    function drawMouth(c, type) {
      var mx = 256, my = 352;
      c.strokeStyle = "#b56576"; c.fillStyle = "#8e3b52";
      c.lineWidth = 8; c.lineCap = "round";
      c.beginPath();
      switch (type) {
        case "smile":
          c.moveTo(mx - 34, my - 6); c.quadraticCurveTo(mx, my + 26, mx + 34, my - 6); c.stroke(); break;
        case "smug":
          c.moveTo(mx - 30, my - 2); c.quadraticCurveTo(mx - 12, my + 14, mx + 6, my + 2);
          c.quadraticCurveTo(mx + 18, my - 4, mx + 30, my + 4); c.stroke(); break;
        case "flat":
          c.moveTo(mx - 26, my + 2); c.lineTo(mx + 26, my + 2); c.stroke(); break;
        case "small":
          c.ellipse(mx, my + 2, 12, 9, 0, 0, Math.PI * 2); c.fill(); break;
        case "open":
          c.ellipse(mx, my + 4, 20, 17, 0, 0, Math.PI * 2); c.fill(); break;
        case "wide":
          c.ellipse(mx, my + 6, 28, 23, 0, 0, Math.PI * 2); c.fill(); break;
        case "o":
          c.ellipse(mx, my + 4, 13, 18, 0, 0, Math.PI * 2); c.fill(); break;
        default: /* closed */
          c.moveTo(mx - 28, my); c.quadraticCurveTo(mx, my + 12, mx + 28, my); c.stroke();
      }
    }

    /* ============================================================
       animation state (mirrors the 2D rig's brain-facing API)
       ============================================================ */
    var state = {
      expression: "neutral",
      speaking: false,
      nextViseme: 0,
      blinkT: 0,
      nextBlink: performance.now() + 1800,
      look: { x: 0, y: 0 },
      lookTarget: { x: 0, y: 0 },
      glanceUntil: 0,
      yaw: 0, yawTarget: 0,
      running: false
    };
    var VISEMES = ["small", "open", "wide", "small", "open", "o", "closed"];

    function setExpression(name) {
      state.expression = name in EXPR ? name : "neutral";
      face.expr = EXPR[state.expression];
      if (!state.speaking) face.mouth = face.expr.mouth;
    }

    function setSpeaking(on) {
      state.speaking = !!on;
      if (!on) face.mouth = face.expr.mouth;
    }

    /* gaze follows pointer anywhere on the page */
    document.addEventListener("pointermove", function (e) {
      var r = container.getBoundingClientRect();
      if (!r.width) return;
      state.lookTarget.x = clamp((e.clientX - (r.left + r.width / 2)) / r.width, -1, 1) * 1.6;
      state.lookTarget.y = clamp((e.clientY - (r.top + r.height * 0.4)) / r.height, -1, 1) * 1.6;
    });

    /* drag to orbit, tap head to pat */
    var drag = null;
    renderer.domElement.addEventListener("pointerdown", function (e) {
      drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    addEventListener("pointermove", function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      if (Math.abs(dx) > 4) drag.moved = true;
      state.yawTarget = clamp(state.yawTarget + dx * 0.006, -1.1, 1.1);
      drag.x = e.clientX; drag.y = e.clientY;
    });
    addEventListener("pointerup", function (e) {
      if (!drag) return;
      var wasTap = !drag.moved;
      drag = null;
      if (!wasTap || container.hidden) return;
      /* raycast the head */
      var r = renderer.domElement.getBoundingClientRect();
      var ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      );
      var ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      if (ray.intersectObject(head, false).length) {
        setExpression(Math.random() < 0.5 ? "shy" : "happy");
        setTimeout(function () { setExpression("neutral"); }, 1800);
        if (window.AisaRig) {
          if (window.AisaRig.emote) window.AisaRig.emote(Math.random() < 0.5 ? "💢" : "💜", 1400);
          if (window.AisaRig.onPat) window.AisaRig.onPat();
        }
      }
    });

    function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
    function lerp(a, b, k) { return a + (b - a) * k; }

    /* ---------- resize ---------- */
    function resize() {
      var w = container.clientWidth || 1, h = container.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(container);
    else addEventListener("resize", resize);
    resize();

    /* ---------- main loop ---------- */
    function tick() {
      if (!state.running) return;
      requestAnimationFrame(tick);
      var t = performance.now(), s = t / 1000;

      /* idle glances */
      if (t > state.glanceUntil) {
        state.glanceUntil = t + 1600 + Math.random() * 3000;
        if (Math.random() < 0.3) {
          state.lookTarget.x = (Math.random() * 2 - 1) * 0.8;
          state.lookTarget.y = (Math.random() * 2 - 1) * 0.5;
        }
      }
      state.look.x = lerp(state.look.x, state.lookTarget.x, 0.07);
      state.look.y = lerp(state.look.y, state.lookTarget.y, 0.07);

      /* breathing, bob, sway */
      var breathe = Math.sin(s * 1.4);
      figure.position.y = breathe * 0.012;
      torso.scale.y = 0.85 + breathe * 0.008;
      headGroup.rotation.y = state.look.x * 0.38 + Math.sin(s * 0.5) * 0.05;
      headGroup.rotation.x = state.look.y * 0.22 + Math.sin(s * 0.9) * 0.015;
      headGroup.rotation.z = Math.sin(s * 0.35) * 0.03;
      ahogePivot.rotation.z = Math.sin(s * 2.2) * 0.08 + state.look.x * 0.06;

      /* orbit */
      state.yaw = lerp(state.yaw, state.yawTarget, 0.1);
      root.rotation.y = state.yaw;

      /* particles drift upward */
      var pos = pGeo.attributes.position;
      for (var i = 0; i < P_N; i++) {
        var y = pos.getY(i) + 0.0022;
        pos.setY(i, y > 2.7 ? 0 : y);
      }
      pos.needsUpdate = true;
      particles.rotation.y = s * 0.05;

      /* blink */
      var open = face.expr.eyes;
      if (t > state.nextBlink) {
        state.blinkT = 1;
        state.nextBlink = t + 2200 + Math.random() * 3800;
        if (Math.random() < 0.18) state.nextBlink = t + 320;
      }
      if (state.blinkT > 0) {
        state.blinkT = Math.max(0, state.blinkT - 0.14);
        var phase = 1 - Math.abs(state.blinkT - 0.5) * 2;
        open = face.expr.eyes * (1 - phase * 0.96);
      }
      face.open = open;

      /* pupils in the painted face */
      face.px = state.look.x * 11;
      face.py = state.look.y * 8;

      /* mouth flaps */
      if (state.speaking && t > state.nextViseme) {
        state.nextViseme = t + 70 + Math.random() * 90;
        face.mouth = VISEMES[Math.floor(Math.random() * VISEMES.length)];
      }

      drawFace();
      renderer.render(scene, camera);
    }

    function setVisible(v) {
      if (v && !state.running) {
        state.running = true;
        resize();
        requestAnimationFrame(tick);
      } else if (!v) {
        state.running = false;
      }
    }

    drawFace();
    setExpression("neutral");

    return {
      setExpression: setExpression,
      setSpeaking: setSpeaking,
      setVisible: setVisible,
      expressions: Object.keys(EXPR)
    };
  }

  /* 4-point sparkle star, extruded */
  function starGeo(THREE, outer, inner, depth) {
    var shape = new THREE.Shape();
    for (var i = 0; i < 8; i++) {
      var r = i % 2 ? inner : outer;
      var a = (i * Math.PI) / 4 - Math.PI / 2;
      var x = Math.cos(a) * r, y = Math.sin(a) * r;
      i ? shape.lineTo(x, y) : shape.moveTo(x, y);
    }
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth: depth, bevelEnabled: false });
  }
})();

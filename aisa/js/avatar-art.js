/* ============================================================
   avatar-art.js — ART mode: Noju's canon Aisa (silver side-pony,
   crimson eyes, kuudere baseline), recreated as a layered rig and
   driven Live2D-style:
     · multi-layer parallax (face > bangs > head > back hair)
     · spring-physics ponytail (2 chained segments)
     · blink scheduler, gaze tracking, mouth visemes
   Same brain-facing API as the other rigs. No dependencies.
   Reference art: art/aisa-original.png (by nojukuramu).
   ============================================================ */
(function () {
  "use strict";

  var svg = document.getElementById("avatar-art");
  if (!svg) return;

  var head = document.getElementById("art-head");
  var faceL = document.getElementById("art-face");
  var bangs = document.getElementById("art-bangs");
  var backHair = document.getElementById("art-backhair");
  var body = document.getElementById("art-body");
  var pony = document.getElementById("art-pony");
  var pony2 = document.getElementById("art-pony2");
  var ahoge = document.getElementById("art-ahoge");
  var blush = document.getElementById("art-blush");
  var browL = document.getElementById("art-brow-l");
  var browR = document.getElementById("art-brow-r");
  var eyes = svg.querySelectorAll(".art-eye");
  var pupils = svg.querySelectorAll(".art-pupil");
  var mouthShapes = {};
  svg.querySelectorAll("#art-mouth [data-m]").forEach(function (el) {
    mouthShapes[el.getAttribute("data-m")] = el;
  });

  /* ---------- expressions ----------
     Canon Aisa runs cooler than the violet one: neutral is deadpan,
     annoyed is basically the reference drawing. */
  var EXPRESSIONS = {
    neutral: {
      browL: "M116 186 Q138 180 160 184", browR: "M244 186 Q222 180 200 184",
      mouth: "closed", blush: 0, eyes: 0.94
    },
    happy: {
      browL: "M116 182 Q138 174 160 179", browR: "M244 182 Q222 174 200 179",
      mouth: "smile", blush: 0.4, eyes: 1
    },
    smug: {
      browL: "M116 186 Q138 182 160 188", browR: "M244 178 Q222 172 200 177",
      mouth: "smug", blush: 0.15, eyes: 0.68
    },
    surprised: {
      browL: "M116 178 Q138 168 160 175", browR: "M244 178 Q222 168 200 175",
      mouth: "o", blush: 0.25, eyes: 1.14
    },
    thinking: {
      browL: "M116 184 Q138 182 160 190", browR: "M244 186 Q222 178 200 182",
      mouth: "flat", blush: 0, eyes: 0.82
    },
    annoyed: {
      browL: "M116 182 Q138 188 160 192", browR: "M244 182 Q222 188 200 192",
      mouth: "flat", blush: 0, eyes: 0.6
    },
    shy: {
      browL: "M116 184 Q138 179 160 184", browR: "M244 184 Q222 179 200 184",
      mouth: "small", blush: 0.85, eyes: 0.85
    },
    sleepy: {
      browL: "M116 188 Q138 184 160 187", browR: "M244 188 Q222 184 200 187",
      mouth: "small", blush: 0, eyes: 0.3
    },
    serious: {
      browL: "M116 184 Q138 180 160 186", browR: "M244 184 Q222 180 200 186",
      mouth: "closed", blush: 0, eyes: 0.9
    }
  };

  var state = {
    expression: "neutral",
    eyeOpen: 0.94,
    blinkT: 0,
    nextBlink: now() + 2000,
    speaking: false,
    nextViseme: 0,
    look: { x: 0, y: 0 },
    lookTarget: { x: 0, y: 0 },
    glanceUntil: 0,
    mouseSeen: false,
    /* ponytail springs: [angle, velocity] per segment */
    p1: { a: 0, v: 0 },
    p2: { a: 0, v: 0 },
    prevHeadX: 0,
    running: false
  };

  function now() { return performance.now(); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, k) { return a + (b - a) * k; }

  function setExpression(name) {
    var ex = EXPRESSIONS[name] || EXPRESSIONS.neutral;
    state.expression = name in EXPRESSIONS ? name : "neutral";
    browL.setAttribute("d", ex.browL);
    browR.setAttribute("d", ex.browR);
    blush.style.opacity = ex.blush;
    state.eyeOpen = ex.eyes;
    if (!state.speaking) showMouth(ex.mouth);
  }

  function showMouth(name) {
    for (var k in mouthShapes) {
      mouthShapes[k].setAttribute("visibility", k === name ? "visible" : "hidden");
    }
  }

  var SPEAK_VISEMES = ["small", "open", "wide", "small", "open", "o", "closed"];
  function setSpeaking(on) {
    state.speaking = !!on;
    if (!on) showMouth(EXPRESSIONS[state.expression].mouth);
  }

  /* ---------- gaze ---------- */
  document.addEventListener("pointermove", function (e) {
    if (!state.running) return;
    state.mouseSeen = true;
    var r = svg.getBoundingClientRect();
    if (!r.width) return;
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height * 0.3; /* her eye line sits high — full-body rig */
    state.lookTarget.x = clamp((e.clientX - cx) / (r.width * 0.8), -1, 1);
    state.lookTarget.y = clamp((e.clientY - cy) / (r.height * 0.8), -1, 1);
  });

  /* ---------- pat: tap the head ---------- */
  svg.addEventListener("pointerdown", function (e) {
    var r = svg.getBoundingClientRect();
    var y = (e.clientY - r.top) / r.height;
    if (y < 0.46) {
      /* canon Aisa is less demonstrative about it. slightly. */
      setExpression(Math.random() < 0.6 ? "annoyed" : "shy");
      setTimeout(function () { setExpression("neutral"); }, 1800);
      if (window.AisaRig) {
        if (window.AisaRig.emote) window.AisaRig.emote(Math.random() < 0.6 ? "💢" : "💜", 1400);
        if (window.AisaRig.onPat) window.AisaRig.onPat();
      }
    }
  });

  /* ---------- main loop ---------- */
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function tick() {
    if (!state.running) return;
    requestAnimationFrame(tick);
    var t = now(), s = t / 1000;

    /* idle glances */
    if (t > state.glanceUntil) {
      state.glanceUntil = t + 1500 + Math.random() * 3400;
      if (!state.mouseSeen || Math.random() < 0.25) {
        state.lookTarget.x = (Math.random() * 2 - 1) * 0.6;
        state.lookTarget.y = (Math.random() * 2 - 1) * 0.35;
      }
    }
    state.look.x = lerp(state.look.x, state.lookTarget.x, 0.08);
    state.look.y = lerp(state.look.y, state.lookTarget.y, 0.08);

    var breathe = Math.sin(s * 1.3);
    var sway = Math.sin(s * 0.5) * 1.4;
    var headX = sway + state.look.x * 6;
    var headY = breathe * 1.6 + state.look.y * 3.5;
    var tilt = Math.sin(s * 0.32) * 1.1 + state.look.x * 2.4;

    if (!reduceMotion) {
      /* Live2D-style depth: each layer moves at its own rate */
      body.setAttribute("transform", "translate(" + (sway * 0.3).toFixed(2) + "," + (breathe * 0.9).toFixed(2) + ")");
      backHair.setAttribute("transform", "translate(" + (headX * 0.45 - state.look.x * 2.5).toFixed(2) + "," + (headY * 0.5).toFixed(2) + ")");
      head.setAttribute("transform", "translate(" + headX.toFixed(2) + "," + headY.toFixed(2) + ") rotate(" + tilt.toFixed(2) + " 180 280)");
      faceL.setAttribute("transform", "translate(" + (state.look.x * 6).toFixed(2) + "," + (state.look.y * 4).toFixed(2) + ")");
      bangs.setAttribute("transform", "translate(" + (state.look.x * 2.8).toFixed(2) + "," + (state.look.y * 1.8).toFixed(2) + ")");
      ahoge.setAttribute("transform", "rotate(" + (Math.sin(s * 2.1) * 4 + state.look.x * 3).toFixed(2) + " 186 64)");

      /* ponytail spring chain — driven by head motion */
      var drive = -(headX - state.prevHeadX) * 6 - tilt * 0.6;
      state.prevHeadX = headX;
      spring(state.p1, drive, 0.045, 0.90);
      spring(state.p2, state.p1.a * 1.35, 0.06, 0.88);
      pony.setAttribute("transform",
        "translate(" + (headX * 0.8).toFixed(2) + "," + (headY * 0.8).toFixed(2) + ") rotate(" + state.p1.a.toFixed(2) + " 97 142)");
      pony2.setAttribute("transform", "rotate(" + state.p2.a.toFixed(2) + " 66 324)");
    }

    /* pupils */
    var px = (state.look.x * 7).toFixed(2), py = (state.look.y * 5).toFixed(2);
    pupils.forEach(function (g) { g.setAttribute("transform", "translate(" + px + "," + py + ")"); });

    /* blink */
    var open = state.eyeOpen;
    if (t > state.nextBlink) {
      state.blinkT = 1;
      state.nextBlink = t + 2400 + Math.random() * 3600;
      if (Math.random() < 0.15) state.nextBlink = t + 340;
    }
    if (state.blinkT > 0) {
      state.blinkT = Math.max(0, state.blinkT - 0.14);
      var phase = 1 - Math.abs(state.blinkT - 0.5) * 2;
      open = state.eyeOpen * (1 - phase * 0.95);
    }
    eyes.forEach(function (e) { e.style.transform = "scaleY(" + clamp(open, 0.05, 1.15) + ")"; });

    /* mouth flaps */
    if (state.speaking && t > state.nextViseme) {
      state.nextViseme = t + 70 + Math.random() * 90;
      showMouth(SPEAK_VISEMES[Math.floor(Math.random() * SPEAK_VISEMES.length)]);
    }
  }

  function spring(seg, target, stiffness, damping) {
    seg.v += (target - seg.a) * stiffness;
    seg.v *= damping;
    seg.a += seg.v;
    seg.a = clamp(seg.a, -14, 14);
  }

  function setVisible(v) {
    if (v && !state.running) {
      state.running = true;
      requestAnimationFrame(tick);
    } else if (!v) {
      state.running = false;
    }
  }

  setExpression("neutral");

  window.AisaRigArt = {
    setExpression: setExpression,
    setSpeaking: setSpeaking,
    setVisible: setVisible,
    expressions: Object.keys(EXPRESSIONS)
  };
})();

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
  /* Brows are drawn inner→outer with the canon wing-kick at the outer end. */
  var EXPRESSIONS = {
    neutral: {
      browL: "M162 179 Q144 176 128 178 L118 171", browR: "M198 179 Q216 176 232 178 L242 171",
      mouth: "closed", blush: 0, eyes: 0.94
    },
    happy: {
      browL: "M162 174 Q144 170 128 172 L118 165", browR: "M198 174 Q216 170 232 172 L242 165",
      mouth: "smile", blush: 0.4, eyes: 1
    },
    smug: {
      browL: "M162 181 Q144 179 128 181 L118 175", browR: "M198 172 Q216 167 232 169 L242 161",
      mouth: "smug", blush: 0.15, eyes: 0.68
    },
    surprised: {
      browL: "M162 170 Q144 164 128 166 L118 158", browR: "M198 170 Q216 164 232 166 L242 158",
      mouth: "o", blush: 0.25, eyes: 1.14
    },
    thinking: {
      browL: "M162 183 Q144 179 128 180 L118 173", browR: "M198 178 Q216 174 232 176 L242 168",
      mouth: "flat", blush: 0, eyes: 0.82
    },
    annoyed: {
      browL: "M162 186 Q144 179 128 176 L118 168", browR: "M198 186 Q216 179 232 176 L242 168",
      mouth: "flat", blush: 0, eyes: 0.6
    },
    shy: {
      browL: "M162 177 Q144 174 128 176 L118 170", browR: "M198 177 Q216 174 232 176 L242 170",
      mouth: "small", blush: 0.85, eyes: 0.85
    },
    sleepy: {
      browL: "M162 183 Q144 182 128 183 L118 178", browR: "M198 183 Q216 182 232 183 L242 178",
      mouth: "small", blush: 0, eyes: 0.3
    },
    serious: {
      browL: "M162 182 Q144 178 128 179 L118 172", browR: "M198 182 Q216 178 232 179 L242 172",
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

      /* ponytail spring chain — driven by head motion */
      var drive = -(headX - state.prevHeadX) * 6 - tilt * 0.6;
      state.prevHeadX = headX;
      spring(state.p1, drive, 0.045, 0.90);
      spring(state.p2, state.p1.a * 1.35, 0.06, 0.88);
      pony.setAttribute("transform",
        "translate(" + (headX * 0.8).toFixed(2) + "," + (headY * 0.8).toFixed(2) + ") rotate(" + state.p1.a.toFixed(2) + " 102 96)");
      pony2.setAttribute("transform", "rotate(" + state.p2.a.toFixed(2) + " 68 300)");
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

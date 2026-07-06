/* ============================================================
   avatar.js — Aisa's rig.
   Breathing, blinking, eye-tracking, head sway, mouth visemes,
   expressions, emote bubble, and the starfield behind her.
   No dependencies. Exposes window.AisaRig.
   ============================================================ */
(function () {
  "use strict";

  var svg = document.getElementById("avatar");
  if (!svg) return;

  var head = document.getElementById("head");
  var body = document.getElementById("body");
  var hairBack = document.getElementById("hair-back");
  var blush = document.getElementById("blush");
  var browL = document.getElementById("brow-l");
  var browR = document.getElementById("brow-r");
  var eyes = svg.querySelectorAll(".eye");
  var pupilGs = svg.querySelectorAll(".pupil-g");
  var mouthShapes = {};
  svg.querySelectorAll("#mouth [data-m]").forEach(function (el) {
    mouthShapes[el.getAttribute("data-m")] = el;
  });
  var emoteEl = document.getElementById("emote");

  /* ---------- expressions ----------
     brows are given as [dL, dR]; blush is opacity; eyes is open scale */
  var EXPRESSIONS = {
    neutral: {
      browL: "M98 184 Q116 174 136 180", browR: "M262 184 Q244 174 224 180",
      mouth: "closed", blush: 0.35, eyes: 1
    },
    happy: {
      browL: "M98 180 Q116 170 136 176", browR: "M262 180 Q244 170 224 176",
      mouth: "smile", blush: 0.55, eyes: 1
    },
    smug: {
      browL: "M98 182 Q116 176 136 184", browR: "M262 178 Q244 168 224 172",
      mouth: "smug", blush: 0.4, eyes: 0.72
    },
    surprised: {
      browL: "M98 176 Q116 164 136 172", browR: "M262 176 Q244 164 224 172",
      mouth: "o", blush: 0.45, eyes: 1.12
    },
    thinking: {
      browL: "M98 180 Q116 176 136 186", browR: "M262 182 Q244 172 224 176",
      mouth: "flat", blush: 0.3, eyes: 0.85
    },
    annoyed: {
      browL: "M98 178 Q116 184 136 188", browR: "M262 178 Q244 184 224 188",
      mouth: "flat", blush: 0.3, eyes: 0.7
    },
    shy: {
      browL: "M98 182 Q116 176 136 182", browR: "M262 182 Q244 176 224 182",
      mouth: "closed", blush: 0.85, eyes: 0.9
    },
    sleepy: {
      browL: "M98 186 Q116 180 136 184", browR: "M262 186 Q244 180 224 184",
      mouth: "small", blush: 0.35, eyes: 0.35
    },
    serious: {
      browL: "M98 180 Q116 176 136 182", browR: "M262 180 Q244 176 224 182",
      mouth: "closed", blush: 0.2, eyes: 0.95
    }
  };

  var state = {
    expression: "neutral",
    eyeOpen: 1,          // expression-level openness
    blinkT: 0,           // 1 while mid-blink
    nextBlink: now() + 1800,
    speaking: false,
    viseme: null,        // current forced viseme while speaking
    nextViseme: 0,
    lookTarget: { x: 0, y: 0 },  // -1..1
    look: { x: 0, y: 0 },
    glanceUntil: 0,
    mouseSeen: false
  };

  function now() { return performance.now(); }

  /* ---------- expression API ---------- */
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

  /* ---------- speaking / visemes ---------- */
  var SPEAK_VISEMES = ["small", "open", "wide", "small", "open", "o", "closed"];
  function setSpeaking(on) {
    state.speaking = !!on;
    if (!on) showMouth(EXPRESSIONS[state.expression].mouth);
  }

  /* ---------- emote bubble ---------- */
  var emoteTimer = null;
  function emote(glyph, ms) {
    if (!emoteEl) return;
    emoteEl.textContent = glyph;
    emoteEl.classList.add("show");
    clearTimeout(emoteTimer);
    emoteTimer = setTimeout(function () { emoteEl.classList.remove("show"); }, ms || 1800);
  }

  /* ---------- gaze ---------- */
  document.addEventListener("pointermove", function (e) {
    state.mouseSeen = true;
    var r = svg.getBoundingClientRect();
    var cx = r.left + r.width / 2;
    var cy = r.top + r.height * 0.42; // roughly her eye line
    state.lookTarget.x = clamp((e.clientX - cx) / (r.width * 0.9), -1, 1);
    state.lookTarget.y = clamp((e.clientY - cy) / (r.height * 0.9), -1, 1);
  });

  function randomGlance(t) {
    // when idle (no recent mouse on touch devices), look around now and then
    if (t > state.glanceUntil) {
      state.glanceUntil = t + 1400 + Math.random() * 3200;
      if (!state.mouseSeen || Math.random() < 0.25) {
        state.lookTarget.x = (Math.random() * 2 - 1) * 0.7;
        state.lookTarget.y = (Math.random() * 2 - 1) * 0.4;
      }
    }
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, k) { return a + (b - a) * k; }

  /* ---------- main loop ---------- */
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function tick() {
    var t = now();
    var s = t / 1000;

    /* breathing + sway */
    if (!reduceMotion) {
      var breathe = Math.sin(s * 1.4) * 2.2;
      var sway = Math.sin(s * 0.55) * 1.6;
      var tilt = Math.sin(s * 0.35) * 1.2 + state.look.x * 2.2;
      body.setAttribute("transform", "translate(0," + (breathe * 0.5).toFixed(2) + ")");
      hairBack.setAttribute("transform",
        "translate(" + (-sway * 0.5).toFixed(2) + "," + (breathe * 0.35).toFixed(2) + ")");
      head.setAttribute("transform",
        "translate(" + (sway + state.look.x * 5).toFixed(2) + "," +
        (breathe + state.look.y * 3).toFixed(2) + ") rotate(" + tilt.toFixed(2) + " 180 260)");
    }

    /* gaze */
    randomGlance(t);
    state.look.x = lerp(state.look.x, state.lookTarget.x, 0.08);
    state.look.y = lerp(state.look.y, state.lookTarget.y, 0.08);
    var px = (state.look.x * 6).toFixed(2), py = (state.look.y * 4).toFixed(2);
    pupilGs.forEach(function (g) { g.setAttribute("transform", "translate(" + px + "," + py + ")"); });

    /* blinking */
    var open = state.eyeOpen;
    if (t > state.nextBlink) {
      state.blinkT = 1;
      state.nextBlink = t + 2200 + Math.random() * 3800;
      // occasional double-blink, because she's got personality
      if (Math.random() < 0.18) state.nextBlink = t + 320;
    }
    if (state.blinkT > 0) {
      state.blinkT = Math.max(0, state.blinkT - 0.14);
      var phase = 1 - Math.abs(state.blinkT - 0.5) * 2; // 0→1→0
      open = state.eyeOpen * (1 - phase * 0.94);
    }
    eyes.forEach(function (e) { e.style.transform = "scaleY(" + clamp(open, 0.06, 1.15) + ")"; });

    /* mouth flaps while speaking */
    if (state.speaking && t > state.nextViseme) {
      state.nextViseme = t + 70 + Math.random() * 90;
      var v = SPEAK_VISEMES[Math.floor(Math.random() * SPEAK_VISEMES.length)];
      showMouth(v);
    }

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ---------- pat interaction: click her head ---------- */
  svg.addEventListener("pointerdown", function (e) {
    var r = svg.getBoundingClientRect();
    var y = (e.clientY - r.top) / r.height;
    if (y < 0.55) {
      setExpression(Math.random() < 0.5 ? "shy" : "happy");
      emote(Math.random() < 0.5 ? "💢" : "💜", 1400);
      if (window.AisaRig.onPat) window.AisaRig.onPat();
      setTimeout(function () { setExpression("neutral"); }, 1800);
    }
  });

  /* ---------- starfield ---------- */
  (function stars() {
    var c = document.getElementById("stars");
    if (!c) return;
    var ctx = c.getContext("2d");
    var pts = [];
    function resize() {
      c.width = innerWidth; c.height = innerHeight;
      pts = [];
      var n = Math.floor((c.width * c.height) / 16000);
      for (var i = 0; i < n; i++) {
        pts.push({
          x: Math.random() * c.width,
          y: Math.random() * c.height,
          r: Math.random() * 1.4 + 0.3,
          p: Math.random() * Math.PI * 2,
          v: 0.4 + Math.random() * 0.8
        });
      }
    }
    resize();
    addEventListener("resize", resize);
    (function draw() {
      ctx.clearRect(0, 0, c.width, c.height);
      var t = performance.now() / 1000;
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var a = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t * p.v + p.p));
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = i % 7 === 0 ? "rgba(53,224,207," + a + ")" : "rgba(160,150,255," + a + ")";
        ctx.fill();
      }
      if (!reduceMotion) requestAnimationFrame(draw);
    })();
  })();

  /* ---------- public API ---------- */
  window.AisaRig = {
    setExpression: setExpression,
    setSpeaking: setSpeaking,
    emote: emote,
    onPat: null,
    expressions: Object.keys(EXPRESSIONS)
  };

  setExpression("neutral");
})();

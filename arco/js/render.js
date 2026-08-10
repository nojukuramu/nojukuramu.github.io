/* ARCO — render.js
 * Canvas 2D. Draws the degree fan, the four strings, and the live readouts.
 * The strings are drawn with a real mode shape (pinned at both ends, bulging in
 * the middle) scaled by each string's actual measured energy, so you can see
 * what you are hearing.
 */
window.ARCO = window.ARCO || {};
(function (A) {
  "use strict";

  var T = A.theory;
  var cv = null, ctx = null, dpr = 1;
  var W = 0, H = 0;
  var t0 = performance.now();

  var THEME = {
    guitar: { accent: "#ffb454", accent2: "#ff8a3d", glow: "rgba(255,180,84,", name: "Pluck" },
    violin: { accent: "#6fd0ff", accent2: "#4aa8ff", glow: "rgba(111,208,255,", name: "Bow" }
  };
  var TONIC = "#34e0c0";

  function accent() {
    return THEME[A.input.state.instrument] || THEME.guitar;
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var r = cv.getBoundingClientRect();
    W = Math.max(320, r.width);
    H = Math.max(220, r.height);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    A.input.layout(W, H);
  }

  function arcPath(side, r, a0, a1) {
    var steps = Math.max(6, Math.round((a1 - a0) * 28));
    for (var i = 0; i <= steps; i++) {
      var a = a0 + (a1 - a0) * (i / steps);
      var p = side.point(r, a);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
  }

  /* An annulus sector: out along one edge, back along the other. */
  function sector(side, r0, r1, a0, a1) {
    ctx.beginPath();
    arcPath(side, r0, a0, a1);
    var steps = Math.max(6, Math.round((a1 - a0) * 28));
    for (var i = steps; i >= 0; i--) {
      var a = a0 + (a1 - a0) * (i / steps);
      var p = side.point(r1, a);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }

  function background() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#0a0c15");
    g.addColorStop(0.55, "#080910");
    g.addColorStop(1, "#05060b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* A faint pool of light under each thumb, so the two zones read as places. */
    var G = A.input.geom();
    if (!G) return;
    var ac = accent();
    [[G.L.px, G.L.py], [G.R.px, G.R.py]].forEach(function (p) {
      var rg = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], G.L.rMax * 1.15);
      rg.addColorStop(0, ac.glow + "0.07)");
      rg.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    });
  }

  function drawFan(now) {
    var S = A.input.state, G = A.input.geom();
    var L = G.L, ac = accent();
    var zones = G.zones;
    var live = S.left;
    var trainerTarget = A.app && A.app.trainerTarget ? A.app.trainerTarget() : null;

    for (var zi = 0; zi < zones.length; zi++) {
      var z = zones[zi];
      var isTonic = z.o === 0;
      for (var ring = 0; ring < G.rings; ring++) {
        var r0 = L.rMin + ring * G.ringH + 2;
        var r1 = r0 + G.ringH - 4;
        var pad = z.w * 0.055;
        var a0 = z.a0 + pad, a1 = z.a1 - pad;
        var on = live && live.offset === z.o && live.ring === ring;
        var rowOn = live && live.offset === z.o;

        sector(L, r0, r1, a0, a1);

        var base;
        if (on) base = ac.glow + "0.92)";
        else if (rowOn) base = ac.glow + "0.20)";
        else if (isTonic) base = "rgba(52,224,192," + (0.13 + ring * 0.015) + ")";
        else if (z.dia) base = "rgba(150,170,225," + (0.075 + ring * 0.014) + ")";
        else base = "rgba(120,130,170,0.035)";
        ctx.fillStyle = base;
        ctx.fill();

        ctx.lineWidth = on ? 2 : 1;
        ctx.strokeStyle = on ? "#fff"
          : isTonic ? "rgba(52,224,192,0.34)"
          : z.dia ? "rgba(165,185,240,0.16)" : "rgba(150,160,200,0.08)";
        ctx.stroke();

        if (on) {
          ctx.save();
          ctx.shadowColor = ac.accent;
          ctx.shadowBlur = 26;
          ctx.fill();
          ctx.restore();
        }

        /* Trainer target: a soft pulsing outline on the note to aim for. */
        if (trainerTarget && trainerTarget.offset === z.o && trainerTarget.ring === ring) {
          var pulse = 0.45 + 0.35 * Math.sin(now / 260);
          ctx.save();
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = "rgba(255,255,255," + pulse.toFixed(3) + ")";
          ctx.setLineDash([7, 5]);
          ctx.stroke();
          ctx.restore();
        }

        /* Labels. Solfège is the primary name because it is what stays constant
         * when the key changes; the letter name is secondary.
         *
         * Wedges get much narrower toward the pivot, so label size follows the
         * actual arc length available. Below a legible size the label is dropped
         * rather than drawn on top of its neighbour. */
        var rMid = (r0 + r1) / 2;
        var arcLen = (a1 - a0) * rMid;
        if (arcLen > 13) {
          var mid = L.point(rMid, (a0 + a1) / 2);
          var fs = Math.max(7.5, Math.min(z.dia ? 15 : 11, arcLen * 0.5, G.ringH * 0.34));
          var showName = z.dia && arcLen > 30 && G.ringH > 34;
          ctx.save();
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.font = (on ? "700 " : "600 ") + fs.toFixed(1) + "px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
          ctx.fillStyle = on ? "#0a0c15" : (isTonic ? "rgba(52,224,192,0.92)" : z.dia ? "rgba(228,235,255,0.78)" : "rgba(190,200,230,0.42)");
          ctx.fillText(T.solfege(z.o), mid.x, mid.y - (showName ? fs * 0.42 : 0));
          if (showName) {
            var midi = T.midiFor(z.o, ring, S.key, S.octave);
            ctx.font = "500 " + (fs * 0.7).toFixed(1) + "px ui-monospace, SFMono-Regular, Menlo, monospace";
            ctx.fillStyle = on ? "rgba(10,12,21,0.62)" : "rgba(190,205,245,0.36)";
            ctx.fillText(T.noteName(midi % 12, S.key) + (Math.floor(midi / 12) - 1), mid.x, mid.y + fs * 0.56);
          }
          ctx.restore();
        }
      }
    }

    /* Bend indicator — a bright bead that slides off the wedge centre as you
     * lean into a note, so vibrato is something you can see. */
    if (live && live.bend !== 0) {
      var zzi = A.input.zoneIndexOf(live.offset);
      if (zzi >= 0) {
        var zz = G.zones[zzi];
        var ba = zz.mid + (live.bend / 0.6) * (zz.w * 0.5);
        var br = L.rMin + live.ring * G.ringH + G.ringH * 0.5;
        var bp = L.point(br, ba);
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.shadowColor = "#fff";
        ctx.shadowBlur = 12;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    /* Ring rail with octave ticks. */
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(160,180,240,0.10)";
    for (var k = 0; k <= G.rings; k++) {
      ctx.beginPath();
      arcPath(L, L.rMin + k * G.ringH, L.a0 - 0.03, L.a1 + 0.03);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawStrings(now) {
    var S = A.input.state, G = A.input.geom();
    var R = G.R, ac = accent();
    var voi = A.input.voicing();

    for (var lane = 0; lane < 4; lane++) {
      var s = 3 - lane;
      var rc = R.rMin + (lane + 0.5) * G.laneH;
      var amp = S.ringVis[s] * G.laneH * 0.40;
      var thick = 1.2 + (3 - lane) * 0.9;              // bass strings look heavier
      var live = S.right && S.right.lane === lane;

      /* Lane bed */
      sector(R, rc - G.laneH * 0.46, rc + G.laneH * 0.46, R.a0, R.a1);
      ctx.fillStyle = live ? ac.glow + "0.12)" : "rgba(140,160,215,0.055)";
      ctx.fill();
      ctx.strokeStyle = "rgba(150,170,230,0.10)";
      ctx.lineWidth = 1;
      ctx.stroke();

      /* The string itself, bulging in a half-sine like a real vibrating mode. */
      var steps = 54;
      var phase = now / (52 - lane * 6);
      ctx.beginPath();
      for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        var a = R.a0 + (R.a1 - R.a0) * t;
        var env = Math.sin(t * Math.PI);
        var off = amp * env * Math.sin(t * Math.PI * 2 + phase);
        var p = R.point(rc + off, a);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.lineCap = "round";
      ctx.lineWidth = thick;
      var lit = Math.min(1, 0.34 + S.ringVis[s] * 1.5);
      ctx.strokeStyle = "rgba(232,240,255," + lit.toFixed(3) + ")";
      if (S.ringVis[s] > 0.03) {
        ctx.shadowColor = ac.accent;
        ctx.shadowBlur = 4 + S.ringVis[s] * 20;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      /* Which chord tone this string is currently holding. */
      var lp = R.point(rc, R.a0 - 0.055);
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = S.ringVis[s] > 0.05 ? ac.accent : "rgba(190,205,245,0.33)";
      var m = voi[s].midi;
      ctx.fillText(T.noteName(m % 12, S.key), lp.x, lp.y);
      ctx.restore();
    }

    /* Bow / pick contact point. */
    if (S.right) {
      var cp = R.point(S.right.r, S.right.a);
      var sp = Math.min(1, S.right.speed / 1200);
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 7 + sp * 9, 0, Math.PI * 2);
      ctx.fillStyle = ac.glow + (0.18 + sp * 0.4).toFixed(3) + ")";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }

    /* Hint arrows on the bow arc when nothing is happening yet. */
    if (!S.right && S.ringVis[0] + S.ringVis[1] + S.ringVis[2] + S.ringVis[3] < 0.02) {
      var fade = 0.14 + 0.10 * Math.sin(now / 520);
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = "rgba(220,232,255," + fade.toFixed(3) + ")";
      var hp = R.point(R.rMin + G.laneH * 2, (R.a0 + R.a1) / 2);
      ctx.fillText(S.instrument === "violin" ? "rub to bow" : "sweep to strum", hp.x, hp.y);
      ctx.restore();
    }
  }

  function drawReadout(now) {
    var S = A.input.state, G = A.input.geom();
    var ac = accent();
    var cx = W / 2;
    var live = S.left;
    var base = S.latch && S.latched ? S.latched : (live ? live : { offset: 0, ring: 0 });

    var name = T.chordName(base.offset, S.mode, S.key, S.sevenths);
    var rn = T.roman(base.offset, S.mode);
    var sol = T.solfege(base.offset);

    ctx.save();
    ctx.textAlign = "center";

    ctx.textBaseline = "alphabetic";
    ctx.font = "700 " + Math.min(40, H * 0.11) + "px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillStyle = live || (S.latch && S.latched) ? "rgba(240,246,255,0.96)" : "rgba(240,246,255,0.30)";
    ctx.fillText(name, cx, H * 0.47);

    ctx.font = "600 " + Math.min(15, H * 0.042) + "px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = ac.glow + "0.85)";
    ctx.fillText(rn + "  ·  " + sol, cx, H * 0.47 + Math.min(21, H * 0.058));

    /* Octave pips, one per ring. */
    var py = H * 0.47 + Math.min(40, H * 0.11);
    for (var i = 0; i < 3; i++) {
      var on = (live ? live.ring : (S.latched ? S.latched.ring : 0)) === i;
      ctx.beginPath();
      ctx.arc(cx + (i - 1) * 13, py, on ? 4 : 2.4, 0, Math.PI * 2);
      ctx.fillStyle = on ? ac.accent : "rgba(200,214,250,0.24)";
      ctx.fill();
    }
    ctx.restore();
  }

  function drawTilt() {
    var S = A.input.state;
    if (!S.motion) return;
    var cx = W / 2, cy = H - 30, w = 62, h = 20;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = "rgba(180,198,245,0.16)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2, -h / 2, w, h);

    ctx.rotate(S.tiltLR * 0.34);
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 5, -S.tiltFB * (h / 2 - 3));
    ctx.lineTo(w / 2 - 5, -S.tiltFB * (h / 2 - 3));
    ctx.strokeStyle = accent().glow + "0.75)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "500 8.5px ui-sans-serif, system-ui, sans-serif";
    ctx.fillStyle = "rgba(190,205,245,0.34)";
    ctx.fillText("tilt · tone / bend", cx, cy + 20);
    ctx.restore();
  }

  function draw() {
    var now = performance.now() - t0;
    if (!A.input.geom()) return;
    background();
    drawFan(now);
    drawStrings(now);
    drawReadout(now);
    drawTilt();
  }

  function init(canvasEl) {
    cv = canvasEl;
    ctx = cv.getContext("2d", { alpha: false });
    resize();
    window.addEventListener("resize", resize);
    if (screen.orientation && screen.orientation.addEventListener) {
      screen.orientation.addEventListener("change", function () { setTimeout(resize, 220); });
    }
  }

  A.render = { init: init, draw: draw, resize: resize, THEME: THEME, TONIC: TONIC };
})(window.ARCO);

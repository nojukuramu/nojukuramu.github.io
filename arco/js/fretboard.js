/* ARCO — fretboard.js
 * Draws the neck layout; render.js hands over to this when the neck is up.
 *
 * Three layers, bottom to top:
 *   base   the board, frets, inlays, the body and the rail — cached, redrawn
 *          only when the window, the tuning or the screen changes
 *   live   the strings, which vibrate between the fret you hold and the
 *          bridge with the energy the worklet actually reports
 *   marks  the key's scale — cached, and laid over the strings so a marker
 *          reads as a marker rather than as a bead threaded on a string
 * and then the fingers, picks and trainer targets on top of all of it.
 *
 * Everything is positioned in the neck's logical x and mirrored at the last
 * moment by X(), which is all the left-handed layout needs.
 */
window.ARCO = window.ARCO || {};
(function (A) {
  "use strict";

  var T = A.theory;
  var SANS = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  var MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
  var TEAL = "52,224,192";

  /* Intervals from the tonic, the way guitarists name the notes of a box. */
  var INTERVAL = ["1", "♭2", "2", "♭3", "3", "4", "♭5", "5", "♭6", "6", "♭7", "7"];
  var INLAY = { 3: 1, 5: 1, 7: 1, 9: 1, 15: 1, 17: 1, 19: 1, 21: 1 };

  var ctx = null, W = 0, H = 0, dpr = 1, S = null, g = null, N = null;
  var base = null, marks = null, cacheKey = "";

  function X(x) { return S.lefty ? W - x : x; }

  /* A rectangle given in logical x, which may come out mirrored. */
  function rect(c, xa, xb, y0, y1) {
    var a = X(xa), b = X(xb);
    c.rect(Math.min(a, b), y0, Math.abs(b - a), y1 - y0);
  }

  function theme() {
    return A.render.THEME[S.instrument] || A.render.THEME.guitar;
  }

  function layer(old) {
    var c = old || document.createElement("canvas");
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    var cx = c.getContext("2d");
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.clearRect(0, 0, W, H);
    return c;
  }

  /* ------------------------------------------------------------- base */

  function drawBase(c) {
    var bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#0a0c15");
    bg.addColorStop(0.55, "#080910");
    bg.addColorStop(1, "#05060b");
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    var ac = theme();
    var padY = g.laneH * 0.22;
    var yA = g.top - padY, yB = g.bottom + padY;
    var xEnd = g.xn + g.n * g.fw;

    /* The body: a pool of light where a soundhole would be, so the picking
     * area reads as a place rather than as leftover screen. */
    var cxb = X((g.xb + g.xm) / 2), cyb = (g.top + g.bottom) / 2;
    var rg = c.createRadialGradient(cxb, cyb, 0, cxb, cyb, (g.xe - g.xb) * 0.95);
    rg.addColorStop(0, ac.glow + "0.10)");
    rg.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = rg;
    c.beginPath(); rect(c, g.xb, g.xe, yA, yB); c.fill();

    /* The palm-mute strip: hatched, like a hand lying across the strings. */
    c.save();
    c.beginPath(); rect(c, g.xm, g.xe, yA, yB); c.clip();
    c.fillStyle = "rgba(255,255,255,0.025)";
    c.fillRect(0, yA, W, yB - yA);
    c.strokeStyle = "rgba(200,212,245,0.06)";
    c.lineWidth = 1;
    for (var hx = -H; hx < W + H; hx += 9) {
      c.beginPath(); c.moveTo(hx, yA); c.lineTo(hx + (yB - yA), yB); c.stroke();
    }
    c.restore();

    /* The bridge saddle, where every string ends. */
    c.fillStyle = "rgba(233,226,207,0.55)";
    c.beginPath(); rect(c, g.xe - 4, g.xe - 1, g.top - padY * 0.6, g.bottom + padY * 0.6); c.fill();

    /* The fingerboard itself. */
    var fb = c.createLinearGradient(0, yA, 0, yB);
    fb.addColorStop(0, "#161a2a");
    fb.addColorStop(0.5, "#121626");
    fb.addColorStop(1, "#0e111e");
    c.fillStyle = fb;
    c.beginPath(); rect(c, g.xn, xEnd, yA, yB); c.fill();

    /* The open column sits behind the nut, on the headstock side. */
    c.fillStyle = "rgba(12,14,24,0.9)";
    c.beginPath(); rect(c, g.x0, g.xn, yA, yB); c.fill();

    /* Inlays, in the usual places, so a player can find the fifth fret
     * without counting. */
    c.fillStyle = "rgba(220,228,255,0.085)";
    var dotR = Math.max(3, Math.min(g.fw, g.laneH) * 0.15);
    for (var k = 0; k < g.n; k++) {
      var f = S.pos + k;
      var mx = X(g.xn + (k + 0.5) * g.fw);
      if (INLAY[f]) {
        c.beginPath(); c.arc(mx, (g.top + g.bottom) / 2, dotR, 0, Math.PI * 2); c.fill();
      } else if (f % 12 === 0) {
        c.beginPath(); c.arc(mx, g.top + g.laneH * 1.5, dotR, 0, Math.PI * 2); c.fill();
        c.beginPath(); c.arc(mx, g.top + g.laneH * 4.5, dotR, 0, Math.PI * 2); c.fill();
      }
    }

    /* Fret wires. */
    for (k = 1; k <= g.n; k++) {
      var wx = X(g.xn + k * g.fw);
      c.fillStyle = "rgba(190,200,228,0.42)";
      c.fillRect(wx - 1, yA, 2, yB - yA);
      c.fillStyle = "rgba(255,255,255,0.10)";
      c.fillRect(wx - 1, yA, 1, yB - yA);
    }

    /* The nut when the window starts at the first fret; otherwise a plain
     * wire and a gap, so it is obvious the window is further up the neck. */
    if (S.pos === 1) {
      c.fillStyle = "rgba(233,226,207,0.85)";
      c.beginPath(); rect(c, g.xn - 3, g.xn + 3, yA, yB); c.fill();
    } else {
      c.fillStyle = "rgba(190,200,228,0.42)";
      c.beginPath(); rect(c, g.xn - 1, g.xn + 1, yA, yB); c.fill();
      c.fillStyle = "#080910";
      c.beginPath(); rect(c, g.xn - 5, g.xn - 2, yA, yB); c.fill();
    }

    drawRail(c);
  }

  function chevron(c, x, y, dir, size) {
    c.beginPath();
    c.moveTo(x - dir * size * 0.3, y - size * 0.5);
    c.lineTo(x + dir * size * 0.3, y);
    c.lineTo(x - dir * size * 0.3, y + size * 0.5);
    c.stroke();
  }

  /* Fret numbers under the neck. Dragging the rail moves the window up and
   * down the neck; the chevrons at its ends step one fret. */
  function drawRail(c) {
    var y = (g.railT + g.railB) / 2;
    var fs = Math.min(11, (g.railB - g.railT) * 0.55);
    c.save();
    c.fillStyle = "rgba(255,255,255,0.03)";
    c.beginPath(); rect(c, g.x0, g.xn + g.n * g.fw, g.railT, g.railB); c.fill();

    c.textAlign = "center";
    c.textBaseline = "middle";
    for (var k = 0; k < g.n; k++) {
      var f = S.pos + k;
      var mark = INLAY[f] || f % 12 === 0;
      c.font = (mark ? "700 " : "500 ") + fs.toFixed(1) + "px " + MONO;
      c.fillStyle = mark ? "rgba(225,233,255,0.62)" : "rgba(190,205,245,0.30)";
      c.fillText(String(f), X(g.xn + (k + 0.5) * g.fw), y + 0.5);
    }

    c.strokeStyle = "rgba(225,233,255,0.55)";
    c.lineWidth = 1.6;
    c.lineCap = "round";
    c.lineJoin = "round";
    if (S.pos > 1) {
      chevron(c, X((g.x0 + g.xn) / 2), y, S.lefty ? 1 : -1, fs);
    } else {
      c.font = "500 " + fs.toFixed(1) + "px " + MONO;
      c.fillStyle = "rgba(190,205,245,0.30)";
      c.fillText("0", X((g.x0 + g.xn) / 2), y + 0.5);
    }
    if (S.pos + g.n - 1 < A.neck.MAX_FRET) {
      chevron(c, X(g.xn + g.n * g.fw + 4), y, S.lefty ? -1 : 1, fs * 0.8);
    }

    /* What the body does, in two words each. */
    c.font = "600 " + Math.min(10, fs).toFixed(1) + "px " + SANS;
    c.fillStyle = "rgba(190,205,245,0.34)";
    c.fillText(S.instrument === "violin" ? "bow" : "pick · strum", X((g.xb + g.xm) / 2), y + 0.5);
    c.fillText("mute", X((g.xm + g.xe) / 2), y + 0.5);
    c.restore();
  }

  /* ------------------------------------------------------------- marks */

  function drawMarks(c) {
    var tun = A.neck.tuning();
    var scale = T.scaleOf(S.mode);
    var r = Math.max(5, Math.min(11, Math.min(g.laneH, g.fw) * 0.21));
    var fs = Math.max(7.5, Math.min(11, r * 1.05));

    c.textAlign = "center";
    c.textBaseline = "middle";

    for (var l = 0; l < 6; l++) {
      var s = A.neck.stringAtLane(l);
      var y = A.neck.laneY(l);

      /* The open column carries the tuning, like the tuners on a headstock,
       * tinted when the open string is in the key. */
      var off0 = ((tun[s] - S.key) % 12 + 12) % 12;
      c.font = "700 " + Math.min(13, g.laneH * 0.36).toFixed(1) + "px " + MONO;
      c.fillStyle = off0 === 0 ? "rgba(" + TEAL + ",0.95)"
        : (S.scaleDots && scale.indexOf(off0) >= 0) ? "rgba(228,235,255,0.72)" : "rgba(190,205,245,0.38)";
      c.fillText(T.noteName(tun[s] % 12, S.key), X((g.x0 + g.xn) / 2), y + 0.5);

      if (!S.scaleDots) continue;
      for (var k = 0; k < g.n; k++) {
        var f = S.pos + k;
        var off = ((tun[s] + f - S.key) % 12 + 12) % 12;
        if (scale.indexOf(off) < 0) continue;
        var x = X(g.xn + (k + 0.5) * g.fw);
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        if (off === 0) {
          c.fillStyle = "rgba(" + TEAL + ",0.30)";
          c.fill();
          c.strokeStyle = "rgba(" + TEAL + ",0.75)";
        } else {
          c.fillStyle = "rgba(20,24,40,0.78)";
          c.fill();
          c.strokeStyle = "rgba(165,185,240,0.30)";
        }
        c.lineWidth = 1;
        c.stroke();
        if (r >= 7) {
          c.font = "600 " + fs.toFixed(1) + "px " + SANS;
          c.fillStyle = off === 0 ? "rgba(" + TEAL + ",1)" : "rgba(214,224,255,0.62)";
          c.fillText(INTERVAL[off], x, y + 0.5);
        }
      }
    }
  }

  /* ------------------------------------------------------------- live */

  var THICK = [3.0, 2.5, 2.0, 1.6, 1.25, 1.0];

  function drawStrings(now, h) {
    var ac = theme();
    var scale = Math.min(1.15, Math.max(0.7, g.laneH / 44));
    for (var l = 0; l < 6; l++) {
      var s = A.neck.stringAtLane(l);
      var y = A.neck.laneY(l);
      var vis = S.ringVis[s];
      var amp = vis * g.laneH * 0.28;
      var hs = h[s];

      /* The string vibrates between where it is stopped and the bridge. With
       * a finger down that is the fret wire, pushed sideways by a bend; with
       * none, it is the nut. */
      var startX = g.xn, startY = y, fx = null, by = 0;
      if (hs && hs.f > 0) {
        var fg = hs.finger;
        if (fg.bend > 0) by = Math.max(-1.6 * g.laneH, Math.min(1.6 * g.laneH, fg.y - fg.yDown));
        if (A.neck.visible(hs.f)) {
          fx = A.neck.colMid(hs.f);
          startX = A.neck.colRange(hs.f)[1];
        } else {
          fx = hs.f < S.pos ? g.xn : g.xn + g.n * g.fw;
          startX = fx;
        }
        startY = y + by;
      }

      ctx.beginPath();
      ctx.moveTo(X(g.x0), y);
      ctx.lineTo(X(g.xn), y);
      if (fx !== null) ctx.lineTo(X(fx), y + by);
      ctx.lineTo(X(startX), startY);
      var steps = 40;
      var phase = now / (40 + s * 3);
      var len = g.xe - 2 - startX;
      for (var i = 1; i <= steps; i++) {
        var t = i / steps;
        var env = Math.sin(t * Math.PI);
        var off = amp * env * Math.sin(t * Math.PI * 2 + phase);
        ctx.lineTo(X(startX + len * t), startY + (y - startY) * t + off);
      }

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = THICK[s] * scale;
      var lit = Math.min(1, 0.36 + vis * 1.5);
      /* Wound strings are bronze, plain ones steel. */
      ctx.strokeStyle = (s <= 2 ? "rgba(236,214,178," : "rgba(228,236,252,") + lit.toFixed(3) + ")";
      if (vis > 0.03) {
        ctx.shadowColor = ac.accent;
        ctx.shadowBlur = 3 + vis * 16;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }

  /* The last shape played, big and faint in the body, where it is readable at
   * a glance and never in the way of a finger. */
  function drawReadout() {
    var fg = A.neck.latest() || lastShown;
    if (!fg) return;
    lastShown = fg;
    var fingers = A.neck.fingers();
    var on = !!fingers[fg.id] && fingers[fg.id] === fg;
    var nm = A.neck.shapeName(fg);
    var cx = X((g.xb + g.xm) / 2);
    var cy = g.top + (g.bottom - g.top) * 0.42;
    var big = Math.min(44, g.laneH * 1.3, (g.xm - g.xb) * 0.32);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "800 " + big.toFixed(1) + "px " + SANS;
    ctx.fillStyle = on ? "rgba(240,246,255,0.34)" : "rgba(240,246,255,0.12)";
    ctx.fillText(nm.big, cx, cy);
    ctx.font = "600 " + Math.max(10, big * 0.36).toFixed(1) + "px " + SANS;
    ctx.fillStyle = theme().glow + (on ? "0.55)" : "0.22)");
    ctx.fillText(nm.small, cx, cy + big * 0.72);
    ctx.restore();
  }
  var lastShown = null;

  function drawFingers(h) {
    var ac = theme();
    var fingers = A.neck.fingers();
    var r = Math.max(10, Math.min(20, Math.min(g.laneH, g.fw) * 0.36));
    var tun = A.neck.tuning();

    for (var id in fingers) {
      var fg = fingers[id];
      var by = fg.bend > 0 ? Math.max(-1.6 * g.laneH, Math.min(1.6 * g.laneH, fg.y - fg.yDown)) : 0;

      /* The strings a shape keeps quiet, marked the way a chord chart marks
       * them — an x at the nut. */
      for (var m = 0; m < fg.mutes.length; m++) {
        var ms = fg.mutes[m];
        if (h[ms]) continue;
        var my = A.neck.laneY(A.neck.stringAtLane(ms));
        var mx = X(g.xn + 9);
        ctx.save();
        ctx.strokeStyle = "rgba(255,150,130,0.75)";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(mx - 4, my - 4); ctx.lineTo(mx + 4, my + 4);
        ctx.moveTo(mx + 4, my - 4); ctx.lineTo(mx - 4, my + 4);
        ctx.stroke();
        ctx.restore();
      }

      for (var i = 0; i < fg.stops.length; i++) {
        var st = fg.stops[i];
        if (!A.neck.visible(st.f)) continue;
        var sounding = h[st.s] && h[st.s].finger === fg && h[st.s].f === st.f;
        var x = X(A.neck.colMid(st.f));
        var y = A.neck.laneY(A.neck.stringAtLane(st.s)) + (st.f > 0 ? by : 0);
        var rr = i === 0 ? r : r * 0.86;

        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        if (sounding) {
          ctx.fillStyle = ac.accent;
          ctx.shadowColor = ac.accent;
          ctx.shadowBlur = 18;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.lineWidth = i === 0 ? 2 : 1.2;
          ctx.strokeStyle = "#fff";
          ctx.stroke();
        } else {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = ac.glow + "0.6)";
          ctx.stroke();
        }
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "700 " + (rr * 0.82).toFixed(1) + "px " + SANS;
        ctx.fillStyle = sounding ? "#0a0c15" : "rgba(230,238,255,0.7)";
        ctx.fillText(T.noteName((tun[st.s] + st.f) % 12, S.key), x, y + 0.5);
        ctx.restore();
      }
    }
  }

  function drawPicks() {
    var ac = theme();
    var picks = A.neck.picks();
    for (var id in picks) {
      var p = picks[id];
      /* The lane the thumb is on lights up, so a strum can be aimed. */
      ctx.fillStyle = ac.glow + "0.08)";
      ctx.beginPath();
      rect(ctx, g.xb, g.xe, g.top + p.lane * g.laneH, g.top + (p.lane + 1) * g.laneH);
      ctx.fill();

      var sp = Math.min(1, p.speed / 1200);
      var x = X(p.x);
      ctx.beginPath();
      ctx.arc(x, p.y, 8 + sp * 9, 0, Math.PI * 2);
      ctx.fillStyle = ac.glow + (0.2 + sp * 0.4).toFixed(3) + ")";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }
  }

  function drawRailActive() {
    if (!A.neck.railActive()) return;
    ctx.fillStyle = theme().glow + "0.14)";
    ctx.beginPath();
    rect(ctx, g.x0, g.xn + g.n * g.fw, g.railT, g.railB);
    ctx.fill();
  }

  /* The trainer's next note, at every place on the visible neck it can be
   * played — so the melody can be found in whatever position the hand is. */
  function drawTargets(now) {
    var tgt = A.app && A.app.trainerTarget ? A.app.trainerTarget() : null;
    if (!tgt) return;
    var midi = A.app.targetMidi(tgt);
    var list = A.neck.positionsOf(midi);
    var pulse = 0.45 + 0.35 * Math.sin(now / 260);
    var r = Math.max(11, Math.min(21, Math.min(g.laneH, g.fw) * 0.38));
    ctx.save();
    ctx.lineWidth = 2.2;
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(255,255,255," + pulse.toFixed(3) + ")";
    for (var i = 0; i < list.length; i++) {
      var q = list[i];
      ctx.beginPath();
      ctx.arc(X(A.neck.colMid(q.f)), A.neck.laneY(A.neck.stringAtLane(q.s)), r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawTilt() {
    if (!S.motion) return;
    var cx = X((g.xb + g.xm) / 2), cy = g.top + 12, w = 46, hh = 14;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = "rgba(180,198,245,0.16)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-w / 2, -hh / 2, w, hh);
    ctx.rotate(S.tiltLR * 0.34);
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 4, -S.tiltFB * (hh / 2 - 2));
    ctx.lineTo(w / 2 - 4, -S.tiltFB * (hh / 2 - 2));
    ctx.strokeStyle = theme().glow + "0.75)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------- entry */

  function draw(c, w, hgt, ratio, now) {
    S = A.input.state;
    g = A.neck.geom();
    if (!g) return;
    ctx = c; W = w; H = hgt; dpr = ratio;

    var key = [W, H, dpr, S.pos, S.frets, S.key, S.mode, S.scaleDots, S.tuning, S.lefty, S.lowTop,
      S.instrument, g.top, g.xb, g.railT].join("|");
    if (key !== cacheKey) {
      cacheKey = key;
      base = layer(base);
      drawBase(base.getContext("2d"));
      marks = layer(marks);
      drawMarks(marks.getContext("2d"));
    }

    var h = A.neck.held();
    ctx.drawImage(base, 0, 0, W, H);
    drawRailActive();
    drawReadout();
    drawStrings(now, h);
    ctx.drawImage(marks, 0, 0, W, H);
    drawTargets(now);
    drawPicks();
    drawFingers(h);
    drawTilt();
  }

  A.fretboard = {
    draw: draw,
    invalidate: function () { cacheKey = ""; }
  };
})(window.ARCO);

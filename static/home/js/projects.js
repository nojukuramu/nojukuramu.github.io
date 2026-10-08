/* ============================================================
   nojukuramu — the projects

   The list every part of the homepage is drawn from — the shutter wheel,
   the contact sheet, the leader strips, the counters and the search
   palette — and a small drawn scene for each one: a spell circle tracing
   itself, a tower filling with light, an alarm going off, a skyline
   growing, four strings under a bow. They are twenty lines of canvas
   each, not screenshots, so there is nothing to load, and the same
   drawing turns up behind the lens's glass and in its frame on the
   contact sheet.

   This file used to be the ring of cards as well. The ring is gone — the
   wheel and the sheet do its two jobs, one frame at a time and all at
   once — but the list and the drawings are the same ones it carried.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* roundRect is Safari 16.4 and Firefox 127; two of the motifs draw with it,
     and a browser a year or two behind would show those two frames blank.
     Cheaper to carry the four arcs than to redraw the motifs without it. */
  if (typeof CanvasRenderingContext2D !== "undefined" && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      var k = typeof r === "number" ? r : (r && r[0]) || 0;
      k = Math.min(k, Math.abs(w) / 2, Math.abs(h) / 2);
      this.moveTo(x + k, y);
      this.lineTo(x + w - k, y);
      this.arcTo(x + w, y, x + w, y + k, k);
      this.lineTo(x + w, y + h - k);
      this.arcTo(x + w, y + h, x + w - k, y + h, k);
      this.lineTo(x + k, y + h);
      this.arcTo(x, y + h, x, y + h - k, k);
      this.lineTo(x, y + k);
      this.arcTo(x, y, x + k, y, k);
      return this;
    };
  }

  /* ---------- the motifs ----------
     Each is (ctx, w, h, phase, accent) and draws one frame. `phase` is
     seconds since the frame came up — behind the lens, since the iris
     opened on it; on the contact sheet, since the pointer arrived. */
  var MOTIF = {
    /* a polygon inscribing itself inside a circle, then another over it —
       on the twelve-node ring the game actually has you trace */
    circles: function (c, w, h, p, a) {
      var cx = w / 2, cy = h / 2, r = h * 0.34;
      c.strokeStyle = a; c.lineWidth = 1.4;
      c.globalAlpha = 0.55;
      c.beginPath(); c.arc(cx, cy, r, 0, 6.283); c.stroke();
      c.beginPath(); c.arc(cx, cy, r * 0.68, 0, 6.283); c.stroke();
      c.globalAlpha = 0.3;
      c.beginPath(); c.arc(cx, cy, r * 1.22, 0, 6.283); c.stroke();
      c.fillStyle = a;
      for (var n = 0; n < 12; n++) {
        var na = p * 0.35 + (n / 12) * 6.283 - 1.57;
        c.globalAlpha = 0.45 + 0.35 * Math.sin(p * 3 - n);
        c.beginPath(); c.arc(cx + Math.cos(na) * r, cy + Math.sin(na) * r, 1.8, 0, 6.283); c.fill();
        var ra = -p * 0.2 + (n / 12) * 6.283;
        c.globalAlpha = 0.35;
        c.fillRect(cx + Math.cos(ra) * r * 1.1 - 1, cy + Math.sin(ra) * r * 1.1 - 1, 2, 2);
      }
      c.globalAlpha = 1;
      var sides = 3 + (Math.floor(p / 3.2) % 4);
      var spin = p * 0.35;
      var drawn = clamp((p % 3.2) / 1.8, 0, 1);
      c.lineWidth = 2;
      c.beginPath();
      for (var i = 0; i <= sides * drawn; i++) {
        var ang = spin + (i / sides) * 6.283 - 1.57;
        var x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
      var tip = spin + drawn * 6.283 - 1.57;
      c.fillStyle = "#FFF3E2";
      c.beginPath(); c.arc(cx + Math.cos(tip) * r, cy + Math.sin(tip) * r, 2.6, 0, 6.283); c.fill();
    },

    /* floors of a tower filling with light, one at a time */
    tower: function (c, w, h, p, a) {
      var floors = 6, fw = h * 0.42, x = w / 2 - fw / 2, base = h * 0.86, fh = (h * 0.66) / floors;
      for (var i = 0; i < floors; i++) {
        var y = base - (i + 1) * fh;
        var on = ((p * 1.4) % (floors + 2)) > i;
        c.globalAlpha = on ? 1 : 0.28;
        c.fillStyle = on ? a : "rgba(255,243,226,.22)";
        c.fillRect(x + i * 1.4, y, fw - i * 2.8, fh - 2.5);
      }
      c.globalAlpha = 1;
      var g = c.createRadialGradient(w / 2, base - h * 0.66, 0, w / 2, base - h * 0.66, h * 0.4);
      g.addColorStop(0, a); g.addColorStop(1, "rgba(0,0,0,0)");
      c.globalAlpha = 0.4 + 0.3 * Math.sin(p * 2); c.fillStyle = g;
      c.beginPath(); c.arc(w / 2, base - h * 0.66, h * 0.4, 0, 6.283); c.fill();
      /* the island it stands on, and the motes the loom throws off */
      c.globalAlpha = 0.5; c.fillStyle = "rgba(255,243,226,.35)";
      c.beginPath();
      c.moveTo(x - fw * 0.5, base); c.lineTo(x + fw * 1.5, base);
      c.lineTo(x + fw * 0.8, base + h * 0.1); c.lineTo(x + fw * 0.35, base + h * 0.12); c.closePath(); c.fill();
      c.fillStyle = a;
      for (var m = 0; m < 9; m++) {
        var mt = (p * 0.35 + m / 9) % 1;
        c.globalAlpha = Math.sin(mt * Math.PI) * 0.9;
        c.beginPath();
        c.arc(w / 2 + Math.sin(m * 2.4 + p) * fw * 0.9, base - mt * h * 0.8, 1.4, 0, 6.283);
        c.fill();
      }
      c.globalAlpha = 1;
    },

    /* a crosshair, and a body bunny hopping across it in widening arcs */
    crosshair: function (c, w, h, p, a) {
      var cx = w / 2, cy = h / 2, r = h * 0.2;
      c.strokeStyle = a; c.lineWidth = 2;
      c.beginPath(); c.arc(cx, cy, r, 0, 6.283); c.stroke();
      c.beginPath();
      c.moveTo(cx, cy - r - 9); c.lineTo(cx, cy - r + 7); c.moveTo(cx, cy + r - 7); c.lineTo(cx, cy + r + 9);
      c.moveTo(cx - r - 9, cy); c.lineTo(cx - r + 7, cy); c.moveTo(cx + r - 7, cy); c.lineTo(cx + r + 9, cy);
      c.stroke();
      var t = p % 4, x = w * 0.12 + (w * 0.76) * (t / 4);
      var hop = Math.abs(Math.sin(t * 3.9)) * h * (0.12 + t * 0.03);
      var y = h * 0.8 - hop;
      c.globalAlpha = 0.35; c.fillStyle = "#FFF3E2";
      for (var k = 1; k < 8; k++) {
        var tk = Math.max(0, t - k * 0.06), xk = w * 0.12 + (w * 0.76) * (tk / 4);
        c.beginPath(); c.arc(xk, h * 0.8 - Math.abs(Math.sin(tk * 3.9)) * h * (0.12 + tk * 0.03), 1.6, 0, 6.283); c.fill();
      }
      c.globalAlpha = 1; c.fillStyle = "#FFF3E2";
      c.beginPath(); c.arc(x, y, 3.2, 0, 6.283); c.fill();
      c.font = "600 " + Math.round(h * 0.13) + "px ui-monospace, Menlo, monospace"; c.fillStyle = a; c.textAlign = "left";
      c.fillText("{ }", w * 0.08, h * 0.2);
    },

    /* three keycaps taking turns to be pressed, and a caret typing across a line beneath */
    keys: function (c, w, h, p, a) {
      var kw = h * 0.26, gap = h * 0.05, x0 = w / 2 - (kw * 3 + gap * 2) / 2, y0 = h * 0.2;
      var hot = Math.floor(p * 2.4) % 3;
      for (var i = 0; i < 3; i++) {
        var down = i === hot && (p * 2.4) % 1 < 0.6;
        c.globalAlpha = down ? 1 : 0.55;
        c.fillStyle = down ? a : "rgba(255,243,226,.12)";
        c.beginPath(); c.roundRect(x0 + i * (kw + gap), y0 + (down ? 3 : 0), kw, kw, 5); c.fill();
        c.strokeStyle = a; c.lineWidth = 1.2; c.stroke();
      }
      c.globalAlpha = 0.5; c.fillStyle = "#FFF3E2";
      var line = w * 0.64, lx = w / 2 - line / 2, ly = h * 0.72, done = clamp((p % 4) / 3, 0, 1);
      for (var k = 0; k < 14; k++) {
        var cw = line / 14 - 3;
        c.globalAlpha = k / 14 < done ? 0.85 : 0.22;
        c.fillRect(lx + k * (line / 14), ly, cw, 3);
      }
      c.globalAlpha = 1; c.fillStyle = a;
      c.fillRect(lx + done * line, ly - 6, 2, 14);
    },

    /* an alarm that will not be ignored */
    alarm: function (c, w, h, p, a) {
      var cx = w / 2, cy = h * 0.54, r = h * 0.30;
      var ringing = (p % 4) > 2.4;
      var shake = ringing ? Math.sin(p * 44) * 2.6 : 0;
      c.save(); c.translate(cx + shake, cy);
      c.strokeStyle = a; c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, r, 0, 6.283); c.stroke();
      c.beginPath(); c.moveTo(-r * 0.78, -r * 0.78); c.lineTo(-r * 0.5, -r * 1.06);
      c.moveTo(r * 0.78, -r * 0.78); c.lineTo(r * 0.5, -r * 1.06); c.stroke();
      c.strokeStyle = "#FFF3E2"; c.lineWidth = 1.7;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -r * 0.62); c.stroke();
      var m = p * 2.2;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(m - 1.57) * r * 0.82, Math.sin(m - 1.57) * r * 0.82); c.stroke();
      c.restore();
      if (ringing) {
        c.strokeStyle = a; c.globalAlpha = 0.5;
        for (var k = 1; k <= 2; k++) {
          c.beginPath(); c.arc(cx, cy, r + k * 9 + (p % 0.4) * 8, -2.4, -0.7); c.stroke();
          c.beginPath(); c.arc(cx, cy, r + k * 9 + (p % 0.4) * 8, 0.7, 2.4); c.stroke();
        }
        c.globalAlpha = 1;
      }
    },

    /* letter tiles turning over, one at a time */
    tiles: function (c, w, h, p, a) {
      var n = 5, s = h * 0.42, gap = 7;
      var total = n * s + (n - 1) * gap, x0 = w / 2 - total / 2, y = h / 2 - s / 2;
      var LETTERS = "ARAWSALITKISLAP";
      var flipping = Math.floor(p * 1.2) % n;
      var k2 = (p * 1.2) % 1;
      for (var i = 0; i < n; i++) {
        var sc = i === flipping ? Math.abs(Math.cos(k2 * Math.PI)) : 1;
        c.save();
        c.translate(x0 + i * (s + gap) + s / 2, y + s / 2);
        c.scale(clamp(sc, 0.06, 1), 1);
        c.fillStyle = i === flipping ? a : "rgba(255,243,226,.14)";
        c.beginPath(); c.roundRect(-s / 2, -s / 2, s, s, 5); c.fill();
        c.fillStyle = i === flipping ? "#1B1008" : "#FFF3E2";
        c.font = "600 " + (s * 0.52) + "px system-ui, sans-serif";
        c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(LETTERS[(i + Math.floor(p * 1.2 / n)) % LETTERS.length], 0, 1);
        c.restore();
      }
    },

    /* an eye that never blinks, which is the entire product */
    eye: function (c, w, h, p, a) {
      var cx = w / 2, cy = h / 2, rw = h * 0.42, rh = h * 0.26;
      c.strokeStyle = a; c.lineWidth = 2;
      c.beginPath();
      c.moveTo(cx - rw, cy);
      c.quadraticCurveTo(cx, cy - rh * 1.9, cx + rw, cy);
      c.quadraticCurveTo(cx, cy + rh * 1.9, cx - rw, cy);
      c.stroke();
      var dx = Math.sin(p * 0.6) * rw * 0.34, dy = Math.cos(p * 0.9) * rh * 0.22;
      c.fillStyle = "#FFF3E2";
      c.beginPath(); c.arc(cx + dx, cy + dy, rh * 0.52, 0, 6.283); c.fill();
      c.fillStyle = a;
      c.beginPath(); c.arc(cx + dx, cy + dy, rh * 0.26, 0, 6.283); c.fill();
    },

    /* frames going past, and the odd shutter */
    reel: function (c, w, h, p, a) {
      var fw = h * 0.46, gap = 8, y = h / 2 - fw * 0.36;
      var off = (p * 90) % (fw + gap);
      for (var i = -1; i < w / (fw + gap) + 1; i++) {
        var x = i * (fw + gap) - off;
        c.fillStyle = i % 3 === 0 ? a : "rgba(255,243,226,.16)";
        c.beginPath(); c.roundRect(x, y, fw, fw * 0.72, 4); c.fill();
      }
      c.fillStyle = "rgba(255,243,226,.10)";
      c.fillRect(0, y - 9, w, 5); c.fillRect(0, y + fw * 0.72 + 4, w, 5);
      var flashAt = (p % 2.6);
      if (flashAt < 0.10) {
        c.fillStyle = "rgba(255,255,255," + (0.10 - flashAt) * 5 + ")";
        c.fillRect(0, 0, w, h);
      }
    },

    /* a skyline zoning itself */
    skyline: function (c, w, h, p, a) {
      var n = 11, bw = w / n;
      for (var i = 0; i < n; i++) {
        var seed = Math.sin(i * 12.9898) * 43758.5453;
        var r = seed - Math.floor(seed);
        var target = 0.20 + r * 0.62;
        var grow = clamp((p * 0.6) - i * 0.14, 0, 1);
        var bh = h * target * (0.15 + 0.85 * grow);
        c.fillStyle = i % 3 === 0 ? a : "rgba(255,243,226,.20)";
        c.fillRect(i * bw + 1.5, h * 0.9 - bh, bw - 3, bh);
        if (grow > 0.9) {
          c.fillStyle = "rgba(255,231,166,.7)";
          for (var wy = 0; wy < bh - 8; wy += 9) {
            if ((i + wy) % 3 === 0) c.fillRect(i * bw + 5, h * 0.9 - bh + wy + 4, 3, 3);
          }
        }
      }
      c.fillStyle = "rgba(255,243,226,.16)";
      c.fillRect(0, h * 0.9, w, 1.5);
    },

    /* the Bloom spreading down a route */
    bloom: function (c, w, h, p, a) {
      c.strokeStyle = "rgba(255,243,226,.22)"; c.lineWidth = 2;
      c.beginPath();
      c.moveTo(0, h * 0.72);
      c.bezierCurveTo(w * 0.3, h * 0.28, w * 0.62, h * 0.94, w, h * 0.42);
      c.stroke();
      for (var i = 0; i < 7; i++) {
        var tt = i / 6;
        var x = bez(0, w * 0.3, w * 0.62, w, tt);
        var y = bez(h * 0.72, h * 0.28, h * 0.94, h * 0.42, tt);
        var pulse = 0.5 + 0.5 * Math.sin(p * 2.4 - i * 0.7);
        c.fillStyle = a;
        c.globalAlpha = 0.35 + pulse * 0.65;
        c.beginPath(); c.arc(x, y, 3 + pulse * 4, 0, 6.283); c.fill();
      }
      c.globalAlpha = 1;
    },

    /* a microphone, and the room answering */
    mic: function (c, w, h, p, a) {
      var cx = w / 2, cy = h * 0.52;
      for (var k = 0; k < 3; k++) {
        var ph = ((p * 0.8 + k / 3) % 1);
        c.strokeStyle = a; c.lineWidth = 2;
        c.globalAlpha = (1 - ph) * 0.6;
        c.beginPath(); c.arc(cx, cy, h * 0.18 + ph * h * 0.42, 0, 6.283); c.stroke();
      }
      c.globalAlpha = 1;
      c.fillStyle = a;
      c.beginPath(); c.roundRect(cx - h * 0.09, cy - h * 0.26, h * 0.18, h * 0.32, h * 0.09); c.fill();
      c.strokeStyle = a; c.lineWidth = 2;
      c.beginPath(); c.arc(cx, cy - h * 0.02, h * 0.17, 0.15, Math.PI - 0.15); c.stroke();
      c.beginPath(); c.moveTo(cx, cy + h * 0.15); c.lineTo(cx, cy + h * 0.27); c.stroke();
    },

    /* a village at night, and one window that should not be lit */
    houses: function (c, w, h, p, a) {
      var n = 5, bw = w / (n + 1);
      var lit = Math.floor(p * 0.5) % n;
      c.fillStyle = "#F3EEE0"; c.globalAlpha = 0.9;
      c.beginPath(); c.arc(w * 0.84, h * 0.24, h * 0.11, 0, 6.283); c.fill();
      c.globalAlpha = 1;
      for (var i = 0; i < n; i++) {
        var x = bw * 0.6 + i * bw, y = h * 0.86, hh = h * 0.34, ww = bw * 0.62;
        c.fillStyle = "rgba(255,243,226,.20)";
        c.beginPath();
        c.moveTo(x, y); c.lineTo(x, y - hh); c.lineTo(x + ww / 2, y - hh * 1.42);
        c.lineTo(x + ww, y - hh); c.lineTo(x + ww, y); c.closePath(); c.fill();
        c.fillStyle = i === lit ? a : "rgba(255,243,226,.12)";
        c.fillRect(x + ww * 0.34, y - hh * 0.66, ww * 0.32, hh * 0.34);
      }
    },

    /* a route, and the weather waiting on it */
    route: function (c, w, h, p, a) {
      c.strokeStyle = "rgba(255,243,226,.24)"; c.lineWidth = 2.4;
      c.beginPath();
      c.moveTo(w * 0.06, h * 0.80);
      c.bezierCurveTo(w * 0.34, h * 0.86, w * 0.42, h * 0.22, w * 0.94, h * 0.30);
      c.stroke();
      var tt = (p * 0.28) % 1;
      var x = bez(w * 0.06, w * 0.34, w * 0.42, w * 0.94, tt);
      var y = bez(h * 0.80, h * 0.86, h * 0.22, h * 0.30, tt);
      c.strokeStyle = "rgba(160,196,232,.75)"; c.lineWidth = 1.4;
      for (var r = 0; r < 14; r++) {
        var rx = w * 0.52 + (r % 7) * 13, ry = h * 0.10 + Math.floor(r / 7) * 15 + ((p * 60 + r * 9) % 26);
        c.beginPath(); c.moveTo(rx, ry); c.lineTo(rx - 3, ry + 8); c.stroke();
      }
      c.fillStyle = a;
      c.beginPath(); c.arc(x, y, 5.5, 0, 6.283); c.fill();
      c.globalAlpha = 0.35;
      c.beginPath(); c.arc(x, y, 5.5 + (p * 2 % 1) * 9, 0, 6.283); c.fill();
      c.globalAlpha = 1;
    },

    /* a route of stops, with something running along it and each stop
       lighting as it is reached — which is the app: the line is the
       knowledge, and the stops are what people wrote down */
    stops: function (c, w, h, p, a) {
      var y = h * 0.56, x0 = w * 0.10, x1 = w * 0.90;
      c.strokeStyle = "rgba(255,243,226,.24)"; c.lineWidth = 3;
      c.lineCap = "round";
      c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();

      var t = (p * 0.24) % 1;
      var vx = x0 + (x1 - x0) * t;

      for (var i = 0; i < 5; i++) {
        var sx = x0 + (x1 - x0) * (i / 4);
        var reached = vx >= sx - 2;
        c.fillStyle = reached ? a : "rgba(255,243,226,.28)";
        c.beginPath(); c.arc(sx, y, reached ? 4.4 : 3.2, 0, 6.283); c.fill();
        if (reached) {
          /* a vote rising off the stop it just left */
          var age = Math.min(1, (vx - sx) / ((x1 - x0) / 4));
          c.globalAlpha = 0.5 * (1 - age);
          c.strokeStyle = a; c.lineWidth = 1.6;
          c.beginPath();
          c.moveTo(sx, y - 8 - age * 14);
          c.lineTo(sx, y - 15 - age * 14);
          c.moveTo(sx - 3.4, y - 11.6 - age * 14);
          c.lineTo(sx, y - 15.4 - age * 14);
          c.lineTo(sx + 3.4, y - 11.6 - age * 14);
          c.stroke();
          c.globalAlpha = 1;
        }
      }

      c.fillStyle = "#FFF3E2";
      c.beginPath(); c.roundRect(vx - 9, y - 16, 18, 10, 3); c.fill();
      c.fillStyle = a;
      c.beginPath(); c.arc(vx - 4.5, y - 5, 2.2, 0, 6.283); c.fill();
      c.beginPath(); c.arc(vx + 4.5, y - 5, 2.2, 0, 6.283); c.fill();
    },

    /* ten ages in a row, each taller than the last, and the mist pulling back off them */
    ages: function (c, w, h, p, a) {
      var cols = ["#ff9a3c", "#ffb347", "#ffd27a", "#9fd0ff", "#ffe08a", "#ffcf6b", "#fff2b0", "#62e8ff", "#8da7ff", "#d38bff"];
      var n = 10, bw = (w - 20) / n, lit = (p * 1.6) % (n + 3);
      for (var i = 0; i < n; i++) {
        var bh = h * (0.12 + i * 0.06), x = 10 + i * bw, y = h * 0.88 - bh;
        c.globalAlpha = i < lit ? 1 : 0.22;
        c.fillStyle = cols[i];
        c.fillRect(x + bw * 0.18, y, bw * 0.64, bh);
        if (i === Math.floor(lit) && i < n) { c.globalAlpha = 0.35; c.beginPath(); c.arc(x + bw / 2, y, bw * 0.9, 0, 6.3); c.fill(); }
      }
      c.globalAlpha = 1;
      var edge = 10 + Math.min(lit, n) * bw;
      var g = c.createLinearGradient(edge, 0, edge + 40, 0);
      g.addColorStop(0, "rgba(40,24,60,0)"); g.addColorStop(1, "rgba(40,24,60,.85)");
      c.fillStyle = g; c.fillRect(edge, 0, w - edge, h);
      c.fillStyle = a; c.beginPath(); c.arc(14, h * 0.88 - 4 - Math.abs(Math.sin(p * 6)) * 3, 3, 0, 6.3); c.fill();
    },
    /* motes rolling down a track into a Hearth, and the grey turning green behind them */
    motes: function (c, w, h, p, a) {
      var y = h * 0.56, x0 = w * 0.12, x1 = w * 0.74, green = Math.min(1, (p * 0.12) % 1.4);
      c.fillStyle = "rgba(93,95,94,.55)"; c.fillRect(0, h * 0.7, w, h * 0.3);
      c.fillStyle = "rgba(111,170,74,.65)"; c.fillRect(0, h * 0.7, w * green, h * 0.3);
      c.strokeStyle = "rgba(176,100,58,.9)"; c.lineWidth = 5;
      c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
      for (var i = 0; i < 6; i++) {
        var t = ((p * 0.35 + i / 6) % 1), mx = x0 + (x1 - x0) * t;
        c.globalAlpha = 0.35; c.fillStyle = a;
        c.beginPath(); c.arc(mx, y, 6, 0, 6.283); c.fill();
        c.globalAlpha = 1; c.fillStyle = "#fff8e0";
        c.beginPath(); c.arc(mx, y, 2.4, 0, 6.283); c.fill();
      }
      var f = 1 + 0.15 * Math.sin(p * 9);
      c.fillStyle = "rgba(138,132,120,.95)"; c.fillRect(x1, y - 10, 22, 20);
      c.fillStyle = a; c.beginPath(); c.moveTo(x1 + 4, y - 4); c.quadraticCurveTo(x1 + 11, y - 26 * f, x1 + 18, y - 4); c.fill();
    },
    /* four strings, and a bow across them */
    strings: function (c, w, h, p, a) {
      for (var i = 0; i < 4; i++) {
        var y = h * (0.26 + i * 0.16);
        var amp = (3 + i * 1.6) * Math.max(0, Math.sin(p * 1.1 - i * 0.5));
        c.strokeStyle = amp > 0.6 ? a : "rgba(255,243,226,.26)";
        c.lineWidth = 1.2 + i * 0.35;
        c.beginPath();
        for (var x = 6; x <= w - 6; x += 4) {
          var env = Math.sin((x - 6) / (w - 12) * Math.PI);
          c.lineTo(x, y + Math.sin(x * 0.16 + p * 15 - i) * amp * env);
        }
        c.stroke();
      }
      var bx = w * (0.5 + Math.sin(p * 0.7) * 0.36);
      c.strokeStyle = "rgba(255,243,226,.5)"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(bx - 10, h * 0.16); c.lineTo(bx + 10, h * 0.86); c.stroke();
    }
  };

  function bez(a, b, c2, d, t) {
    var u = 1 - t;
    return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c2 + t * t * t * d;
  }

  /* ---------- the projects themselves ---------- */
  var PROJECTS = [
    { name: "Magic Circles", href: "magic_circles/", badge: "RPG", accent: "#F5A83C", kind: "games", motif: "circles",
      desc: "A magic-based RPG where spells are drawn, not picked from a menu.",
      hi: ["Trace polygons into elements and wrap them in circles", "Layers stack, so a spell is a drawing you invent", "Runs on Phaser, saves to your own browser"],
      tags: ["Phaser", "canvas", "procedural"] },
    { name: "Magic Sandbox", href: "magic_sandbox/", badge: "3D roguelite", accent: "#C1613F", kind: "games", motif: "tower",
      desc: "The Loom Tower — draw your own spells and climb ten floating islands, alone or with friends.",
      hi: ["Shapes are elements, circles are shots, runes aim them", "Co-op climbs, Wipe Out, deathmatches — rooms over WebRTC", "Phone, computer or gamepad, and it plays offline"],
      tags: ["Three.js", "WebGL", "multiplayer"] },
    { name: "Hacks", href: "hacks/", badge: "Movement shooter", accent: "#39C6E8", kind: "games", motif: "crosshair",
      desc: "A Source-style movement shooter where writing the cheats is the lesson.",
      hi: ["Bunny hop, air strafe, surf, wall climb, wall jump, lunge", "Write ESP, aimbots and bhop scripts in JavaScript, in game", "Bots, rooms with friends, phone controls you can rearrange"],
      tags: ["Three.js", "WebRTC", "learn to code"] },
    { name: "Type", href: "type/", badge: "Typing", accent: "#E0401F", kind: "games", motif: "keys",
      desc: "A typing trainer that never runs out of things to type, and will race you.",
      hi: ["Sentences, shell sessions, code in sixteen languages, random keys", "Race friends in a room, in public, or by quick match", "No box to click: the keyboard goes straight into the challenge"],
      tags: ["typing", "multiplayer", "offline"] },
    { name: "Task Notes", href: "task-notes/", badge: "PWA", accent: "#E8B44A", kind: "tools", motif: "alarm",
      desc: "A notebook with a real alarm clock inside it.",
      hi: ["Repeating alarms that ring until you answer them", "Markdown notes, notebooks, tags, five views", "Entirely offline, on IndexedDB"],
      tags: ["PWA", "offline", "IndexedDB"] },
    { name: "Pinoy Word Games", href: "pwg/", badge: "Word game", accent: "#D4756B", kind: "games", motif: "tiles",
      desc: "Hulaan ang dalawang salita — dagdag, bawas, kislap, o banat ng letra.",
      hi: ["100 cozy levels, all in Filipino", "Four ways a word can bend into another", "Progress saved on your device"],
      tags: ["Filipino", "puzzle", "100 levels"] },
    { name: "Anti-AFK", href: "antiafk/", badge: "Utility", accent: "#8FB0CB", kind: "tools", motif: "eye",
      desc: "Keep a screen awake without touching it.",
      hi: ["A decoy video player holds a Screen Wake Lock open", "Chromium, and Firefox 126 and up", "One page, and no permission beyond the lock"],
      tags: ["Wake Lock", "utility"] },
    { name: "Burst//Dump", href: "burst_dump/", badge: "Video", accent: "#E4794E", kind: "tools", motif: "reel",
      desc: "Drop in a folder of photos, get a fast, seeded photo-dump reel.",
      hi: ["Rhythms, styles, effects and music, all seeded", "Records straight to MP4 or WebM", "Your photos never leave the tab"],
      tags: ["canvas", "MediaRecorder", "reels"] },
    { name: "SkyLine", href: "citybuilder/", badge: "City builder", accent: "#F0A257", kind: "games", motif: "skyline",
      desc: "A pocket-sized city sim that grows its own skyline.",
      hi: ["Terraform the ground and lay the roads", "Zone it, and the buildings raise themselves", "Day turns to night, and the rain rolls in"],
      tags: ["Three.js", "procedural", "mobile"] },
    { name: "VELL", href: "3dtd/", badge: "Tower defense", accent: "#9CA86B", kind: "games", motif: "bloom",
      desc: "A drowned moor, procedurally grown, and a line to hold.",
      hi: ["Root the Bloom around a Heartspore", "Shape the route with towers, walls and walkable traps", "Endless waves of the Rust"],
      tags: ["Three.js", "procedural", "endless"] },
    { name: "KaraokeNatin", href: "karaokenatin/", badge: "Party", accent: "#D9634F", kind: "together", motif: "mic",
      desc: "Turn any screen into a karaoke machine.",
      hi: ["Guests scan a code and their phone is the remote", "Search, queue and skip from the couch", "Peer-to-peer over WebRTC — no server of mine"],
      tags: ["WebRTC", "P2P", "PWA"] },
    { name: "The Wolf Game", href: "the-wolf-game/", badge: "Party game", accent: "#6E86B8", kind: "together", motif: "houses",
      desc: "Werewolf for a room full of phones.",
      hi: ["The night runs for everyone at once, first come first served", "Pick a house, then decide what to do at its door", "35 roles, peer-to-peer over WebRTC"],
      tags: ["WebRTC", "P2P", "35 roles"] },
    { name: "RouteCast", href: "routecast/", badge: "Navigation", accent: "#5C93B8", kind: "tools", motif: "route",
      desc: "Plan a drive, then see the weather waiting along it.",
      hi: ["Every checkpoint forecast for the hour you arrive there", "Gear advice for a bike, not just a temperature", "Tells you if leaving an hour later dodges the rain"],
      tags: ["Leaflet", "OpenStreetMap", "forecast"] },
    { name: "TheCommuters", href: "komyut/", badge: "Commute", accent: "#4FB3A0", kind: "together", motif: "stops",
      desc: "Jeepney and tricycle routes, filed by the people who ride them.",
      hi: ["Anybody can file a route; the votes decide which ones stand", "Plans a trip across them, transfers and all", "Fares, a reliability meter, and the weather along the line"],
      tags: ["Supabase", "OpenStreetMap", "community"] },
    { name: "Aeons", href: "aeons/", badge: "Strategy", accent: "#E8963C", kind: "games", motif: "ages",
      desc: "An endless real-time strategy, from the first fire to the age of aether.",
      hi: ["Phases of enemy bases on a map that keeps growing", "Ten eras, buildings that level up into the next, champions you can drive", "Fog of war, contacts and automation for a realm too big to click"],
      tags: ["canvas", "RTS", "offline"] },
    { name: "Bloomworks", href: "bloomworks/", badge: "Idle game", accent: "#FFC861", kind: "games", motif: "motes",
      desc: "Glowing contraptions on an endless grey world, bringing it back to life.",
      hi: ["Every unit of Glow is a mote you can watch roll, fuse and sell", "Tinkers, Ghosts and Directives automate the automation", "Three reset layers, from Seasons to Planets, and no ceiling anywhere"],
      tags: ["Three.js", "idle", "offline"] },
    { name: "ARCO", href: "arco/", badge: "Instrument", accent: "#E0A24C", kind: "sound", motif: "strings",
      desc: "A guitar for a phone held sideways.",
      hi: ["A six-string neck that hammers, pulls, slides and bends", "Tap frets to play, or pick, strum and palm-mute the body", "Power chords under one thumb, in any tuning"],
      tags: ["AudioWorklet", "waveguide", "offline"] }
  ];

  var FILTERS = [
    { id: "all", label: "Everything" },
    { id: "games", label: "Games" },
    { id: "tools", label: "Tools" },
    { id: "together", label: "With people" },
    { id: "sound", label: "Sound" }
  ];

  /* Spelled out, because the heading that counts them is written in words.
     Past twenty it can have digits; that is a nice problem to have. */
  var WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
               "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
               "Eighteen", "Nineteen", "Twenty"];
  function inWords(n) { return WORDS[n] || String(n); }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function rgbOf(hexStr) {
    var h = hexStr.replace("#", "");
    return parseInt(h.slice(0, 2), 16) + "," + parseInt(h.slice(2, 4), 16) + "," + parseInt(h.slice(4, 6), 16);
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /* Draw project i's scene into a 2D context: w × h, `p` seconds into it.
     A motif that throws is a blank frame, never a broken page. */
  function draw(c, w, h, p, i) {
    var pr = PROJECTS[i];
    if (!pr || !MOTIF[pr.motif]) return;
    c.save();
    try { MOTIF[pr.motif](c, w, h, p, pr.accent); } catch (e) {}
    c.restore();
  }

  NJ.projects = {
    projects: PROJECTS,
    filters: FILTERS,
    motifs: MOTIF,
    draw: draw,
    inWords: inWords,
    rgbOf: rgbOf,
    pad: pad,
    esc: esc
  };
})(window);

/* ============================================================
   nojukuramu — the projects

   A ring of cards rather than a grid, and every card carries a small drawn
   scene of what the thing actually does: a spell circle tracing itself, a
   tower filling with light, an alarm going off, a skyline growing, four
   strings under a bow. They are twenty lines of canvas each, not
   screenshots — nothing to load, and they run on the same clock as the
   sky behind them.

   Only the card in the spotlight animates. The rest hold a single frame,
   so fourteen canvases cost about as much as one.

   The ring is laid out by hand, not by the browser's scroll snapping. One
   float, `pos`, says where the ring is; every card's transform is a
   function of its distance from it, and a spring pulls `pos` to the whole
   number it is heading for. Native scroll-snap could not put the side
   cards on a curve, could not loop, and fought the tour; a spring is forty
   lines and does all three. Touch still belongs to the page vertically —
   the stage only claims horizontal drags (`touch-action: pan-y`).

   The grid is the same fourteen cards with the transforms taken off, and
   where the browser has View Transitions the cards fly between the two.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* roundRect is Safari 16.4 and Firefox 127; two of the motifs draw with it,
     and a browser a year or two behind would show those two cards blank.
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
     seconds since the card took the spotlight. */
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
    { name: "ARCO", href: "arco/", badge: "Instrument", accent: "#E0A24C", kind: "sound", motif: "strings",
      desc: "A two-thumb instrument for a phone held sideways.",
      hi: ["One thumb sweeps the scale, the other plucks or bows", "Four modelled strings, and tilt shapes the tone", "Learn a melody once, play it in all twelve keys"],
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
  /* signed distance round a ring of n, in (-n/2, n/2] */
  function wrap(d, n) { d = ((d % n) + n) % n; return d > n / 2 ? d - n : d; }
  function mod(v, n) { return ((v % n) + n) % n; }

  var TOUR_KEY = "home.tour";
  var VIEW_KEY = "home.view";
  function recall(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function remember(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var OPEN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6.5l5.5 5.5L13 17.5"/></svg>';

  /* Seconds the tour spends on each card. Long enough to read the three
     highlights at an ordinary pace, which is the whole point of stopping. */
  var TOUR = 6.5;

  /* The spring. Stiff enough that a click feels answered inside a tenth of
     a second, damped just under critical so a flick lands with the
     smallest overshoot rather than a wobble. */
  var STIFF = 190, DAMP = 25;

  /* ---------- build ---------- */
  var carousel = {
    projects: PROJECTS,
    filters: FILTERS,
    current: 0,
    inWords: inWords,
    rgbOf: rgbOf,

    mount: function (root) {
      var stage = root.querySelector("[data-stage]");
      var dotsEl = root.querySelector("[data-dots]");
      var countEl = root.querySelector("[data-count]");
      var filterEl = root.querySelector("[data-filters]");
      var playBtn = root.querySelector("[data-play]");
      var viewEl = root.querySelector("[data-views]");

      /* --- markup --- */
      filterEl.innerHTML = '<span class="chip-pill" aria-hidden="true"></span>' + FILTERS.map(function (f, i) {
        var n = f.id === "all" ? PROJECTS.length
              : PROJECTS.filter(function (p) { return p.kind === f.id; }).length;
        return '<button class="chip' + (i === 0 ? " on" : "") + '" data-filter="' + f.id + '" aria-pressed="' + (i === 0) + '">' +
               esc(f.label) + "<i>" + n + "</i></button>";
      }).join("");
      var pill = filterEl.querySelector(".chip-pill");
      var chips = Array.prototype.slice.call(filterEl.querySelectorAll(".chip"));

      stage.innerHTML = PROJECTS.map(function (p, i) {
        return '<article class="slide" data-i="' + i + '" role="group" aria-roledescription="slide" aria-label="' + esc(p.name) +
               '" style="--accent:' + p.accent + ";--accent-rgb:" + rgbOf(p.accent) + '">' +
                 '<div class="slide-inner">' +
                   '<div class="slide-scene">' +
                     '<canvas data-motif="' + p.motif + '" aria-hidden="true"></canvas>' +
                     '<span class="slide-no" aria-hidden="true">' + pad(i + 1) + "</span>" +
                   "</div>" +
                   '<div class="slide-body">' +
                     '<span class="slide-badge">' + esc(p.badge) + "</span>" +
                     "<h3>" + esc(p.name) + "</h3>" +
                     '<p class="slide-desc">' + esc(p.desc) + "</p>" +
                     '<ul class="slide-highlights">' + p.hi.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
                     '<div class="slide-foot">' +
                       '<div class="slide-tags">' + p.tags.map(function (t) { return '<span class="slide-tag">' + esc(t) + "</span>"; }).join("") + "</div>" +
                       '<span class="slide-cta">Open' + OPEN_ICON + "</span>" +
                     "</div>" +
                   "</div>" +
                   '<span class="slide-sheen" aria-hidden="true"></span>' +
                 "</div>" +
                 '<a class="stretch" href="' + esc(p.href) + '" aria-label="Open ' + esc(p.name) + '"></a>' +
               "</article>";
      }).join("");

      dotsEl.innerHTML = PROJECTS.map(function (p, i) {
        return '<button class="car-dot" data-i="' + i + '" aria-label="' + esc(p.name) + '"></button>';
      }).join("");
      var dots = Array.prototype.slice.call(dotsEl.children);

      var S = Array.prototype.map.call(stage.children, function (el, i) {
        var cv = el.querySelector("canvas");
        return { i: i, el: el, inner: el.querySelector(".slide-inner"), cv: cv, ctx: cv.getContext("2d"),
                 fn: MOTIF[cv.getAttribute("data-motif")], w: 0, h: 0, since: 0 };
      });

      /* --- state --- */
      var vis = S.slice();            /* what the filter lets through, in order */
      var loop = vis.length > 3;      /* a ring needs enough cards to go round */
      var pos = 0, target = 0, vel = 0;
      var placedAt = NaN, stale = true;
      var activeK = -1;
      var grid = false;
      var L = null;
      var inView = !("IntersectionObserver" in global);
      var hover = false, focusWithin = false;
      var drag = null, suppressClick = false;
      var wheeling = false, wheelTimer = 0, wheelFrom = 0;
      var hot = null;                 /* the card under the pointer, in the grid */
      var tour = { on: !reduced && recall(TOUR_KEY) !== "off", t: 0 };

      /* --- layout ---
         Card width comes from CSS; everything else is a fraction of it, so
         the ring is the same shape on a phone as on a desk, only flatter —
         a steep angle on a narrow screen hides the neighbours entirely. */
      function measure() {
        var vw = root.clientWidth || global.innerWidth;
        var first = vis[0] || S[0];
        var cw = first.el.offsetWidth || 400;
        var narrow = vw < 720;
        var s2 = cw * (narrow ? 0.34 : 0.38);
        L = {
          s1: cw * (narrow ? 0.9 : 0.76),
          s2: s2,
          rot: narrow ? 16 : 30,
          depth: narrow ? 110 : 190,
          reach: narrow ? 1.3 : clamp((vw / 2 - cw * 0.5) / s2 + 0.6, 1.3, 3.4)
        };
        stale = true;
      }

      function place() {
        if (grid || !L) return;
        var n = vis.length;
        for (var k = 0; k < n; k++) {
          var s = vis[k], st = s.el.style;
          var d = loop ? wrap(k - pos, n) : k - pos;
          var ad = Math.abs(d), sd = d < 0 ? -1 : 1;
          var x = ad <= 1 ? d * L.s1 : sd * (L.s1 + (ad - 1) * L.s2);
          var ry = sd * Math.min(ad, 1) * L.rot;
          var z = -Math.pow(Math.min(ad, 4), 0.9) * L.depth;
          var sc = 1 - Math.min(ad, 3) * 0.035;
          var op = clamp(L.reach + 0.5 - ad, 0, 1);
          /* The card at the back of the ring swaps sides as the ring turns.
             Fade it out before it gets there, so the swap is never seen. */
          if (loop) op *= clamp((n / 2 - ad) * 1.6, 0, 1);
          st.transform = "translate3d(" + x.toFixed(1) + "px,0," + z.toFixed(1) + "px) rotateY(" +
                         ry.toFixed(2) + "deg) scale(" + sc.toFixed(3) + ")";
          st.opacity = op.toFixed(3);
          st.zIndex = String(1000 - Math.round(ad * 100));
          st.pointerEvents = op < 0.35 ? "none" : "";
          st.setProperty("--dim", Math.min(ad * 0.55, 0.78).toFixed(3));
        }
      }

      function spotlit() {
        var n = vis.length;
        if (!n) return -1;
        var r = Math.round(pos);
        return loop ? mod(r, n) : clamp(r, 0, n - 1);
      }

      function setActive(k, quiet) {
        if (k < 0 || k === activeK) return;
        var prev = vis[activeK];
        var s = vis[k];
        activeK = k;
        S.forEach(function (x) { x.el.classList.toggle("is-active", x === s); });
        if (prev && prev !== s) { untilt(prev); drawScene(prev, 1.4); }
        s.since = performance.now();
        carousel.current = s.i;
        countEl.innerHTML = "<b>" + pad(k + 1) + "</b> / " + pad(vis.length);
        dots.forEach(function (d, i) {
          d.classList.toggle("on", i === s.i);
          d.style.removeProperty("--p");
        });
        root.style.setProperty("--car-accent", PROJECTS[s.i].accent);
        root.style.setProperty("--car-accent-rgb", rgbOf(PROJECTS[s.i].accent));
        tour.t = 0;
        if (!quiet && NJ.ambience && NJ.ambience.tick) NJ.ambience.tick(s.i);
      }

      /* --- the spring --- */
      function physics(dt) {
        if ((drag && drag.live) || wheeling) return;
        if (reduced) { pos = target; vel = 0; return; }
        if (pos === target && vel === 0) return;
        /* fixed small steps: a long frame must not be able to fling it */
        var steps = Math.max(1, Math.ceil(dt * 240)), h = dt / steps;
        for (var i = 0; i < steps; i++) {
          vel += (STIFF * (target - pos) - DAMP * vel) * h;
          pos += vel * h;
        }
        if (Math.abs(target - pos) < 0.0004 && Math.abs(vel) < 0.004) {
          pos = target; vel = 0;
          /* keep the numbers small on a ring that has gone round a lot */
          if (loop && vis.length) { target = mod(target, vis.length); pos = target; stale = true; }
        }
      }

      function moving() {
        return (drag && drag.live) || wheeling || pos !== target || vel !== 0;
      }

      /* --- one frame loop for all of it --- */
      var raf = 0, last = 0;
      function kick() { if (!raf) raf = requestAnimationFrame(frame); }
      function frame(now) {
        raf = 0;
        /* The spring gets a capped step (it sub-steps anyway); the tour gets
           the real one, or a phone drawing fifteen frames a second would
           stay on each card twice as long as it says. */
        var real = last ? (now - last) / 1000 : 1 / 60;
        var dt = Math.min(0.1, real);
        last = now;
        if (!grid) {
          physics(dt);
          if (pos !== placedAt || stale) { place(); placedAt = pos; stale = false; }
          setActive(spotlit(), false);
        }
        runTour(Math.min(0.25, real));
        var s = grid ? hot : vis[activeK];
        if (s && !reduced) drawScene(s, (now - s.since) / 1000);
        /* Keep going while something moves, or while there is a scene on
           screen to animate. Off screen and settled, the loop stops. */
        if (moving() || (inView && !reduced)) raf = requestAnimationFrame(frame);
        else last = 0;
      }

      /* --- moving it --- */
      function go(delta) {
        var n = vis.length;
        if (!n || grid) return;
        var base = Math.round(target);
        target = loop ? base + delta : clamp(base + delta, 0, n - 1);
        if (reduced) pos = target;
        kick();
      }
      function goToK(k) {
        var n = vis.length;
        if (!n || k < 0 || grid) return;
        var base = Math.round(target);
        target = loop ? base + wrap(k - base, n) : k;
        if (reduced) pos = target;
        kick();
      }

      /* Anything the visitor does to the ring ends the tour — they are
         driving now. The play button is the only way back on. */
      function took() { if (tour.on) setTour(false, true); }

      function setTour(on, byHand) {
        tour.on = on; tour.t = 0;
        playBtn.classList.toggle("paused", !on);
        playBtn.setAttribute("aria-pressed", on ? "true" : "false");
        playBtn.setAttribute("aria-label", on ? "Pause the tour" : "Play the tour");
        playBtn.title = on ? "Pause the tour" : "Play the tour";
        dots.forEach(function (d) { d.style.removeProperty("--p"); });
        if (byHand) remember(TOUR_KEY, on ? "on" : "off");
        kick();
      }

      function runTour(dt) {
        if (!tour.on || grid || vis.length < 2) return;
        if (inView && !hover && !focusWithin && !(drag && drag.live) && !document.hidden) {
          tour.t += dt;
          if (tour.t >= TOUR) { tour.t = 0; go(1); }
        }
        var dot = dots[carousel.current];
        if (dot) dot.style.setProperty("--p", (tour.t / TOUR).toFixed(3));
      }

      /* --- scenes --- */
      function sizeScenes() {
        var dpr = Math.min(global.devicePixelRatio || 1, 2);
        S.forEach(function (s) {
          /* offset sizes, not the bounding box: the box of a card turned
             thirty degrees away is narrower than the canvas really is */
          var w = s.cv.offsetWidth, h = s.cv.offsetHeight;
          if (!w || !h || (w === s.w && h === s.h)) return;
          s.w = w; s.h = h;
          s.cv.width = Math.round(w * dpr);
          s.cv.height = Math.round(h * dpr);
          s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          drawScene(s, 1.4);
        });
      }

      function drawScene(s, p) {
        if (!s || !s.fn || !s.w) return;
        s.ctx.clearRect(0, 0, s.w, s.h);
        s.ctx.save();
        try { s.fn(s.ctx, s.w, s.h, p, PROJECTS[s.i].accent); } catch (e) {}
        s.ctx.restore();
      }

      function untilt(s) {
        if (!s) return;
        s.el.classList.remove("lit");
        s.inner.style.removeProperty("--rx");
        s.inner.style.removeProperty("--ry");
      }

      /* --- filters, and the pill that slides between them --- */
      function movePill() {
        var b = filterEl.querySelector(".chip.on");
        if (!b || !b.offsetWidth) return;
        pill.style.width = b.offsetWidth + "px";
        pill.style.height = b.offsetHeight + "px";
        pill.style.transform = "translate(" + b.offsetLeft + "px," + b.offsetTop + "px)";
        filterEl.classList.add("has-pill");
      }

      function applyFilter(id) {
        var keep = vis[activeK];
        chips.forEach(function (c) {
          var on = c.getAttribute("data-filter") === id;
          c.classList.toggle("on", on);
          c.setAttribute("aria-pressed", on ? "true" : "false");
        });
        movePill();
        vis = S.filter(function (s) { return id === "all" || PROJECTS[s.i].kind === id; });
        S.forEach(function (s) {
          var on = vis.indexOf(s) !== -1;
          s.el.hidden = !on;
          dots[s.i].hidden = !on;
        });
        loop = vis.length > 3;
        activeK = -1;
        var k = Math.max(0, vis.indexOf(keep));
        measure();
        sizeScenes();
        /* the new set turns into place rather than appearing */
        target = k;
        pos = reduced || grid ? k : k - 1.6;
        vel = 0;
        if (grid) setActive(k, true);
        kick();
      }

      filterEl.addEventListener("click", function (e) {
        var b = e.target.closest("[data-filter]");
        if (!b || b.classList.contains("on")) return;
        /* on a phone the row scrolls; bring the chosen chip fully into it */
        if (filterEl.scrollWidth > filterEl.clientWidth) {
          filterEl.scrollTo({ left: b.offsetLeft - 20, behavior: reduced ? "auto" : "smooth" });
        }
        var id = b.getAttribute("data-filter");
        if (grid) morph(function () { applyFilter(id); });
        else applyFilter(id);
      });

      /* --- ring and grid ---
         Where the browser has View Transitions, each card is given a name for
         the length of the switch and the browser flies it from where it was
         to where it lands. The page itself is not cross-faded: the old root
         is hidden and the new one shown at once, so only the cards move and
         the sky behind them never doubles. */
      function morph(change) {
        if (reduced || !document.startViewTransition) { change(); kick(); return; }
        var named = vis.slice();
        named.forEach(function (s) { s.el.style.viewTransitionName = "nj-card-" + s.i; });
        document.documentElement.classList.add("nj-vt");
        var done = function () {
          S.forEach(function (s) { s.el.style.viewTransitionName = ""; });
          document.documentElement.classList.remove("nj-vt");
          kick();
        };
        try {
          var vt = document.startViewTransition(function () {
            change();
            /* cards the change revealed need names too, or they just pop in */
            vis.forEach(function (s) { s.el.style.viewTransitionName = "nj-card-" + s.i; });
          });
          vt.finished.then(done, done);
        } catch (e) { change(); done(); }
      }

      function setView(mode, animate) {
        var on = mode === "grid";
        if (on === grid) return;
        var change = function () {
          grid = on;
          root.classList.toggle("is-grid", on);
          Array.prototype.forEach.call(viewEl.querySelectorAll("[data-view]"), function (b) {
            var m = b.getAttribute("data-view") === mode;
            b.classList.toggle("on", m);
            b.setAttribute("aria-pressed", m ? "true" : "false");
          });
          S.forEach(untilt);
          if (on) {
            S.forEach(function (s) {
              var st = s.el.style;
              st.transform = st.opacity = st.zIndex = st.pointerEvents = "";
              st.removeProperty("--dim");
            });
          } else {
            hot = null;
            pos = target = Math.max(0, activeK);
            vel = 0;
            /* coming back from a long grid, the ring may be above the fold */
            var r = root.getBoundingClientRect();
            if (r.top < 0) global.scrollBy(0, r.top - 90);
          }
          measure();
          sizeScenes();
          if (!on) { place(); placedAt = pos; }
        };
        if (animate) morph(change); else { change(); kick(); }
        remember(VIEW_KEY, mode);
      }

      viewEl.addEventListener("click", function (e) {
        var b = e.target.closest("[data-view]");
        if (b) setView(b.getAttribute("data-view"), true);
      });

      /* --- drag, for every kind of pointer ---
         A horizontal drag is the ring's; anything that starts out vertical
         is left alone so the page still scrolls under a thumb. */
      stage.addEventListener("pointerdown", function (e) {
        suppressClick = false;
        if (grid || e.button !== 0 || !vis.length) return;
        drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, p0: pos, live: false, samples: [[e.timeStamp, e.clientX]] };
      });

      stage.addEventListener("pointermove", function (e) {
        if (drag && e.pointerId === drag.id) {
          var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
          if (!drag.live) {
            if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
            if (Math.abs(dx) < 7) return;
            drag.live = true;
            drag.p0 = pos;
            drag.x0 = e.clientX;
            dx = 0;
            took();
            root.classList.add("dragging");
            try { stage.setPointerCapture(e.pointerId); } catch (err) {}
          }
          var raw = drag.p0 - dx / L.s1;
          var n = vis.length;
          /* past either end of a short row, give a little and pull back */
          pos = loop ? raw : raw < 0 ? raw * 0.3 : raw > n - 1 ? n - 1 + (raw - n + 1) * 0.3 : raw;
          target = pos; vel = 0;
          drag.samples.push([e.timeStamp, e.clientX]);
          if (drag.samples.length > 6) drag.samples.shift();
          kick();
          return;
        }
        lean(e);
      });

      function release(e, cancelled) {
        if (!drag || (e && e.pointerId !== drag.id)) return;
        var d = drag;
        drag = null;
        if (!d.live) return;
        root.classList.remove("dragging");
        suppressClick = true;
        var v = 0;
        if (!cancelled) {
          var sm = d.samples, a = sm[0], b = sm[sm.length - 1];
          /* a finger that stopped before it let go is not a flick */
          if (e.timeStamp - b[0] < 90) v = -((b[1] - a[1]) / Math.max(8, b[0] - a[0])) * 1000 / L.s1;
        }
        v = clamp(v, -14, 14);
        var dest = Math.round(clamp(pos + v * 0.2, pos - 4, pos + 4));
        dest = committed(d.p0, pos, dest);
        target = loop ? dest : clamp(dest, 0, vis.length - 1);
        vel = v * 0.5;
        if (reduced) { pos = target; vel = 0; }
        kick();
      }
      stage.addEventListener("pointerup", function (e) { release(e, false); });
      stage.addEventListener("pointercancel", function (e) { release(e, true); });
      /* Only the stage's own capture ending counts. A touch is implicitly
         captured by the link under the finger, and handing that capture to
         the stage makes the *link* lose it — an event that bubbles up here
         and, taken at face value, drops every touch drag as it starts. */
      stage.addEventListener("lostpointercapture", function (e) {
        if (e.target === stage && drag && drag.live) release(e, true);
      });
      /* links are draggable by default, which steals the gesture */
      stage.addEventListener("dragstart", function (e) { e.preventDefault(); });

      stage.addEventListener("click", function (e) {
        if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; return; }
        if (grid) return;
        var el = e.target.closest(".slide");
        if (!el) return;
        var k = vis.indexOf(S[+el.getAttribute("data-i")]);
        /* a card at the side comes to the middle first; only the one in the
           spotlight opens */
        if (k !== activeK) { e.preventDefault(); took(); goToK(k); }
      }, true);

      /* A deliberate push of a fifth of a card goes to the next card, even
         with no speed behind it. Rounding alone would need half a card —
         and a tilt-wheel mouse, whose notches arrive a few hundred
         milliseconds apart, would never get there at all. */
      function committed(from, now, dest) {
        var moved = now - from;
        if (dest === Math.round(from) && Math.abs(moved) > 0.18) return Math.round(from) + (moved > 0 ? 1 : -1);
        return dest;
      }

      /* --- a sideways swipe on a trackpad turns the ring --- */
      stage.addEventListener("wheel", function (e) {
        if (grid || !vis.length) return;
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) * 1.2) return;
        e.preventDefault();
        took();
        var unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? L.s1 : 1;
        if (!wheeling) wheelFrom = pos;
        pos += (e.deltaX * unit) / L.s1 * 0.8;
        if (!loop) pos = clamp(pos, -0.3, vis.length - 0.7);
        target = pos; vel = 0; wheeling = true;
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(function () {
          wheeling = false;
          var dest = committed(wheelFrom, pos, Math.round(pos));
          target = loop ? dest : clamp(dest, 0, vis.length - 1);
          kick();
        }, 140);
        kick();
      }, { passive: false });

      /* --- the card leans towards the pointer, and a light follows it --- */
      function lean(e) {
        if (reduced || e.pointerType === "touch") return;
        var el = e.target.closest && e.target.closest(".slide");
        var s = el ? S[+el.getAttribute("data-i")] : null;
        if (grid && s !== hot) {
          if (hot) { untilt(hot); drawScene(hot, 1.4); }
          hot = s;
          if (s) s.since = performance.now();
          kick();
        }
        if (!s || (!grid && !el.classList.contains("is-active"))) return;
        var r = s.inner.getBoundingClientRect();
        var nx = (e.clientX - r.left) / r.width, ny = (e.clientY - r.top) / r.height;
        var st = s.inner.style;
        st.setProperty("--rx", ((0.5 - ny) * 7).toFixed(2) + "deg");
        st.setProperty("--ry", ((nx - 0.5) * 9).toFixed(2) + "deg");
        st.setProperty("--mx", (nx * 100).toFixed(1) + "%");
        st.setProperty("--my", (ny * 100).toFixed(1) + "%");
        s.el.classList.add("lit");
      }

      stage.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") hover = true; });
      stage.addEventListener("pointerleave", function () {
        hover = false;
        S.forEach(untilt);
        if (grid && hot) { drawScene(hot, 1.4); hot = null; }
      });

      /* Tabbing through the cards turns the ring to each in turn. Only for
         keyboard focus — a mouse press focuses the link too, and that must
         not start the ring moving under a drag that is about to begin. */
      root.addEventListener("focusin", function (e) {
        focusWithin = true;
        if (grid) return;
        var el = e.target.closest && e.target.closest(".slide");
        if (!el) return;
        var kb = true;
        try { kb = e.target.matches(":focus-visible"); } catch (err) {}
        if (!kb) return;
        var k = vis.indexOf(S[+el.getAttribute("data-i")]);
        if (k >= 0 && k !== activeK) { took(); goToK(k); }
      });
      root.addEventListener("focusout", function (e) {
        if (!e.relatedTarget || !root.contains(e.relatedTarget)) focusWithin = false;
      });

      /* --- the controls --- */
      root.querySelector("[data-prev]").addEventListener("click", function () { took(); go(-1); });
      root.querySelector("[data-next]").addEventListener("click", function () { took(); go(1); });
      dotsEl.addEventListener("click", function (e) {
        var b = e.target.closest("[data-i]");
        if (!b) return;
        took();
        goToK(vis.indexOf(S[+b.getAttribute("data-i")]));
      });
      playBtn.addEventListener("click", function () { setTour(!tour.on, true); });

      var shuffle = root.querySelector("[data-shuffle]");
      if (shuffle) shuffle.addEventListener("click", function () {
        took();
        if (vis.length < 2) return;
        var k;
        do { k = (Math.random() * vis.length) | 0; } while (k === activeK);
        goToK(k);
      });

      document.addEventListener("keydown", function (e) {
        if (e.defaultPrevented || grid || e.altKey || e.metaKey || e.ctrlKey) return;
        var typing = /^(input|textarea|select)$/i.test(e.target.tagName || "") || e.target.isContentEditable;
        if (typing) return;
        var box = root.getBoundingClientRect();
        if (box.top > global.innerHeight * 0.75 || box.bottom < global.innerHeight * 0.25) return;
        if (e.key === "ArrowRight") { e.preventDefault(); took(); go(1); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); took(); go(-1); }
      });

      var resizeT = 0;
      global.addEventListener("resize", function () {
        clearTimeout(resizeT);
        resizeT = setTimeout(function () { measure(); sizeScenes(); movePill(); kick(); }, 60);
      });
      /* the face arrives late and every chip changes width when it does */
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { movePill(); measure(); kick(); });

      if ("IntersectionObserver" in global) {
        new IntersectionObserver(function (en) {
          inView = en[0].isIntersecting;
          if (inView) kick();
        }, { threshold: 0.12 }).observe(root);
      }

      carousel.goToIndex = function (i) {
        var s = S[i];
        if (!s) return;
        if (vis.indexOf(s) === -1) {
          if (grid) morph(function () { applyFilter("all"); }); else applyFilter("all");
        }
        took();
        if (grid) {
          s.el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
          s.el.classList.remove("ping");
          void s.el.offsetWidth;
          s.el.classList.add("ping");
          return;
        }
        goToK(vis.indexOf(s));
      };
      carousel.setView = function (mode) { setView(mode, true); };

      /* --- first paint --- */
      setTour(tour.on, false);
      measure();
      /* The ring starts a little way round and turns into place as it
         comes into view — the first thing it does is show that it moves. */
      if (!reduced && !inView) { pos = -2.2; }
      requestAnimationFrame(function () {
        if (recall(VIEW_KEY) === "grid") setView("grid", false);
        measure();
        sizeScenes();
        movePill();
        S.forEach(function (s) { drawScene(s, 1.4); });
        if (grid) setActive(0, true);
        stale = true;
        kick();
      });

      return carousel;
    }
  };

  NJ.projects = carousel;
})(window);

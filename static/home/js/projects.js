/* ============================================================
   nojukuramu — the projects

   A carousel rather than a grid, and every card carries a small drawn
   scene of what the thing actually does: a spell circle tracing itself, a
   tower filling with light, an alarm going off, a skyline growing, four
   strings under a bow. They are twenty lines of canvas each, not
   screenshots — nothing to load, and they run on the same clock as the
   sky behind them.

   Only the card in the spotlight animates. The rest hold a single frame,
   so twelve canvases cost about as much as one.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------- the motifs ----------
     Each is (ctx, w, h, phase, accent) and draws one frame. `phase` is
     seconds since the card took the spotlight. */
  var MOTIF = {
    /* a polygon inscribing itself inside a circle, then another over it */
    circles: function (c, w, h, p, a) {
      var cx = w / 2, cy = h / 2, r = h * 0.34;
      c.strokeStyle = a; c.lineWidth = 1.4;
      c.globalAlpha = 0.55;
      c.beginPath(); c.arc(cx, cy, r, 0, 6.283); c.stroke();
      c.beginPath(); c.arc(cx, cy, r * 0.68, 0, 6.283); c.stroke();
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
      c.globalAlpha = 1;
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
      desc: "The Loom Tower — a top-down spell-crafting roguelite.",
      hi: ["Weave runes into elemental circles in the Spellforge", "Ascend the tower one floor at a time", "Three.js and WebGL, no install"],
      tags: ["Three.js", "WebGL", "roguelite"] },
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

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function tint(hexStr, a) {
    var h = hexStr.replace("#", "");
    return "rgba(" + parseInt(h.slice(0, 2), 16) + "," + parseInt(h.slice(2, 4), 16) + "," + parseInt(h.slice(4, 6), 16) + "," + a + ")";
  }

  /* ---------- build ---------- */
  var carousel = {
    projects: PROJECTS,
    current: 0,

    mount: function (root) {
      var track = root.querySelector("[data-track]");
      var viewport = root.querySelector("[data-viewport]");
      var dotsEl = root.querySelector("[data-dots]");
      var countEl = root.querySelector("[data-count]");
      var filterEl = root.querySelector("[data-filters]");
      var glowEl = root.querySelector("[data-glow]");

      filterEl.innerHTML = FILTERS.map(function (f, i) {
        return '<button class="chip' + (i === 0 ? " on" : "") + '" data-filter="' + f.id + '">' + esc(f.label) + "</button>";
      }).join("");

      track.innerHTML = PROJECTS.map(function (p, i) {
        return '<article class="slide" data-i="' + i + '" data-kind="' + p.kind + '" style="--accent:' + p.accent +
               ';--accent-soft:' + tint(p.accent, 0.22) + '">' +
                 '<div class="slide-scene"><canvas data-motif="' + p.motif + '" aria-hidden="true"></canvas></div>' +
                 '<div class="slide-body">' +
                   '<div class="slide-top">' +
                     '<span class="slide-badge">' + esc(p.badge) + "</span>" +
                     '<span class="slide-no">' + String(i + 1).padStart(2, "0") + "</span>" +
                   "</div>" +
                   "<h3>" + esc(p.name) + "</h3>" +
                   '<p class="slide-desc">' + esc(p.desc) + "</p>" +
                   '<ul class="slide-highlights">' + p.hi.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" +
                   '<div class="slide-foot">' +
                     '<div class="slide-tags">' + p.tags.map(function (t) { return '<span class="slide-tag">' + esc(t) + "</span>"; }).join("") + "</div>" +
                     '<span class="slide-cta">Open<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6.5l5.5 5.5L13 17.5"/></svg></span>' +
                   "</div>" +
                 "</div>" +
                 '<a class="stretch" href="' + esc(p.href) + '" aria-label="Open ' + esc(p.name) + '"></a>' +
               "</article>";
      }).join("");

      var slides = Array.prototype.slice.call(track.children);

      dotsEl.innerHTML = PROJECTS.map(function (p, i) {
        return '<button class="car-dot' + (i === 0 ? " on" : "") + '" data-i="' + i + '" aria-label="' + esc(p.name) + '"></button>';
      }).join("");

      /* --- the motif canvases --- */
      var scenes = slides.map(function (sl) {
        var cv = sl.querySelector("canvas");
        return { el: cv, ctx: cv.getContext("2d"), fn: MOTIF[cv.dataset.motif], w: 0, h: 0 };
      });

      function sizeScenes() {
        var dpr = Math.min(global.devicePixelRatio || 1, 2);
        scenes.forEach(function (s) {
          var r = s.el.getBoundingClientRect();
          if (!r.width) return;
          s.w = r.width; s.h = r.height;
          s.el.width = Math.round(r.width * dpr);
          s.el.height = Math.round(r.height * dpr);
          s.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        });
      }

      function drawScene(i, p) {
        var s = scenes[i];
        if (!s || !s.fn || !s.w) return;
        s.ctx.clearRect(0, 0, s.w, s.h);
        s.ctx.save();
        try { s.fn(s.ctx, s.w, s.h, p, PROJECTS[i].accent); } catch (e) {}
        s.ctx.restore();
      }

      var t0 = performance.now();
      function frame(now) {
        var p = (now - t0) / 1000;
        drawScene(carousel.current, p);
        if (!reduced) requestAnimationFrame(frame);
      }

      /* --- position --- */
      function visible() {
        return slides.filter(function (s) { return !s.hidden; });
      }
      function centerOf(el) { return el.offsetLeft + el.offsetWidth / 2; }

      function markActive() {
        var vis = visible();
        if (!vis.length) return;
        var mid = viewport.scrollLeft + viewport.clientWidth / 2;
        var best = vis[0], bestD = Infinity;
        vis.forEach(function (s) {
          var d = Math.abs(centerOf(s) - mid);
          if (d < bestD) { bestD = d; best = s; }
        });
        var idx = +best.dataset.i;
        slides.forEach(function (s) { s.classList.toggle("is-active", s === best); });
        if (idx !== carousel.current) {
          carousel.current = idx;
          var p = PROJECTS[idx];
          countEl.innerHTML = "<b>" + String(vis.indexOf(best) + 1).padStart(2, "0") + "</b> / " + String(vis.length).padStart(2, "0");
          Array.prototype.forEach.call(dotsEl.children, function (d) { d.classList.toggle("on", +d.dataset.i === idx); });
          glowEl.style.background = "radial-gradient(60% 70% at 50% 50%, " + tint(p.accent, 0.30) + " 0%, transparent 70%)";
          drawScene(idx, 0);
        }
      }

      function goTo(el, smooth) {
        if (!el) return;
        viewport.scrollTo({ left: centerOf(el) - viewport.clientWidth / 2, behavior: (smooth && !reduced) ? "smooth" : "auto" });
      }
      function step(delta, smooth) {
        var vis = visible();
        var here = vis.indexOf(slides[carousel.current]);
        if (here < 0) here = 0;
        goTo(vis[clamp(here + delta, 0, vis.length - 1)], smooth);
      }
      carousel.goToIndex = function (i, smooth) { goTo(slides[i], smooth !== false); };

      viewport.addEventListener("scroll", markActive, { passive: true });
      root.querySelector("[data-prev]").addEventListener("click", function () { step(-1, true); });
      root.querySelector("[data-next]").addEventListener("click", function () { step(1, true); });
      dotsEl.addEventListener("click", function (e) {
        var b = e.target.closest("[data-i]");
        if (b) goTo(slides[+b.dataset.i], true);
      });

      var shuffle = root.querySelector("[data-shuffle]");
      if (shuffle) shuffle.addEventListener("click", function () {
        var vis = visible().filter(function (s) { return +s.dataset.i !== carousel.current; });
        if (vis.length) goTo(vis[(Math.random() * vis.length) | 0], true);
      });

      filterEl.addEventListener("click", function (e) {
        var b = e.target.closest("[data-filter]");
        if (!b) return;
        var id = b.dataset.filter;
        Array.prototype.forEach.call(filterEl.children, function (c) { c.classList.toggle("on", c === b); });
        slides.forEach(function (s) { s.hidden = !(id === "all" || s.dataset.kind === id); });
        requestAnimationFrame(function () {
          sizeScenes();
          var vis = visible();
          if (vis.length) { goTo(vis[0], false); markActive(); }
        });
      });

      /* drag, for a mouse */
      var down = false, startX = 0, startL = 0, moved = 0;
      viewport.addEventListener("pointerdown", function (e) {
        if (e.pointerType === "touch") return;
        down = true; moved = 0; startX = e.clientX; startL = viewport.scrollLeft;
        viewport.classList.add("dragging");
      });
      global.addEventListener("pointermove", function (e) {
        if (!down) return;
        var d = e.clientX - startX;
        moved = Math.max(moved, Math.abs(d));
        viewport.scrollLeft = startL - d;
      });
      global.addEventListener("pointerup", function () {
        if (!down) return;
        down = false; viewport.classList.remove("dragging");
        if (moved > 6) goTo(slides[carousel.current], true);
      });
      track.addEventListener("click", function (e) { if (moved > 6) { e.preventDefault(); moved = 0; } }, true);

      /* the card leans towards the pointer */
      if (!reduced) {
        track.addEventListener("pointermove", function (e) {
          var card = e.target.closest(".slide.is-active");
          if (!card) return;
          var r = card.getBoundingClientRect();
          var nx = (e.clientX - r.left) / r.width - 0.5;
          var ny = (e.clientY - r.top) / r.height - 0.5;
          card.style.setProperty("--rx", (-ny * 5).toFixed(2) + "deg");
          card.style.setProperty("--ry", (nx * 6).toFixed(2) + "deg");
        });
        track.addEventListener("pointerleave", function () {
          slides.forEach(function (s) { s.style.removeProperty("--rx"); s.style.removeProperty("--ry"); });
        });
      }

      document.addEventListener("keydown", function (e) {
        if (e.defaultPrevented) return;
        var typing = /^(input|textarea|select)$/i.test(e.target.tagName || "") || e.target.isContentEditable;
        if (typing) return;
        var box = root.getBoundingClientRect();
        if (box.top > global.innerHeight * 0.75 || box.bottom < global.innerHeight * 0.25) return;
        if (e.key === "ArrowRight") { e.preventDefault(); step(1, true); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1, true); }
      });

      global.addEventListener("resize", function () {
        sizeScenes();
        goTo(slides[carousel.current], false);
      });

      requestAnimationFrame(function () {
        sizeScenes();
        goTo(slides[0], false);
        markActive();
        countEl.innerHTML = "<b>01</b> / " + String(PROJECTS.length).padStart(2, "0");
        glowEl.style.background = "radial-gradient(60% 70% at 50% 50%, " + tint(PROJECTS[0].accent, 0.30) + " 0%, transparent 70%)";
        if (reduced) { scenes.forEach(function (s, i) { drawScene(i, 1.4); }); }
        else requestAnimationFrame(frame);
      });

      return carousel;
    }
  };

  NJ.projects = carousel;
})(window);

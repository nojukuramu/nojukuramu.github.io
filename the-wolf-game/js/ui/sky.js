/* sky.js — the sky, drawn rather than described.
 *
 * The theme already knew the hour; this paints it. One full-bleed canvas behind
 * everything, showing what the phase clock says is actually happening outside:
 *
 *   - a star field that fades in as the sun goes down, twinkling on its own
 *     slow cycle, with a scatter that never changes so the sky is the same sky
 *   - the sun and the moon on opposite ends of one arc, rising and setting
 *     across the phase, with a low warm glow when either is near the horizon
 *   - a few clouds, lit from wherever the sun is
 *   - hills and a treeline, so there is a ground for the village to stand on
 *   - blood: as the village loses people the edges darken and stain, and a
 *     fresh kill throws a spatter across the glass
 *
 * It costs one canvas and no libraries. Everything is derived from two numbers
 * the clock already produces — `hour` and `starlight` — so the sky cannot drift out
 * of step with the colour of the interface in front of it.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});

  /* Where the ground starts, as a fraction of the canvas height. The hills sit
   * just below it, so a rising sun genuinely comes up out of them. */
  var HORIZON = 0.72;

  var canvas = null, ctx = null, dpr = 1;
  var W = 0, H = 0;
  var source = null;            // () => the live view, or null
  var stars = [], clouds = [], hills = null, spatter = [];
  var raf = null, lastPaint = 0, flyers = [], flyerScene = null;
  var bloodLevel = 0, bloodTarget = 0;
  var reduced = false;

  /* A fixed scatter. Regenerating it per frame makes the sky boil; regenerating
   * it per resize makes the constellations move when you rotate the phone. */
  function seedField() {
    var rnd = mulberry(20260905);
    stars = [];
    for (var i = 0; i < 260; i++) {
      stars.push({
        x: rnd(), y: rnd() * (HORIZON - 0.04),   // never below the horizon
        r: 0.4 + rnd() * 1.5,
        mag: 0.35 + rnd() * 0.65,
        tw: rnd() * Math.PI * 2,
        sp: 0.6 + rnd() * 1.8
      });
    }
    clouds = [];
    for (var c = 0; c < 7; c++) {
      clouds.push({
        x: rnd(), y: 0.10 + rnd() * 0.38,
        w: 0.16 + rnd() * 0.26, h: 0.03 + rnd() * 0.05,
        a: 0.05 + rnd() * 0.10, sp: 0.004 + rnd() * 0.010
      });
    }
    hills = [];
    for (var k = 0; k < 3; k++) {
      var pts = [];
      for (var x = 0; x <= 24; x++) pts.push(0.5 + rnd());
      hills.push({ pts: pts, base: HORIZON + 0.04 + k * 0.06, amp: 0.06 - k * 0.014 });
    }
  }

  /** Small deterministic PRNG — the sky should look the same on every phone. */
  function mulberry(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(2, global.devicePixelRatio || 1);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function hex(h, a) {
    h = String(h || "#000000").trim();
    var r = parseInt(h.slice(1, 3), 16) || 0, g = parseInt(h.slice(3, 5), 16) || 0, b = parseInt(h.slice(5, 7), 16) || 0;
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  /* Where a body is on its arc. The sun rises in the east at 6, is overhead at
   * 12 and sets in the west at 18; the moon runs the same arc twelve hours out,
   * so it is highest at midnight. Close enough to true, and much easier to read
   * than the real thing. */
  function arc(hour, offset) {
    var h = (((hour + offset) % 24) + 24) % 24;
    var a = ((h - 6) / 12) * Math.PI;      // 0 at rise, PI/2 overhead, PI at set
    var sin = Math.sin(a);
    return {
      x: 0.5 - Math.cos(a) * 0.40,
      y: HORIZON - sin * 0.54,
      up: sin > -0.04,
      high: Math.max(0, sin),              // 1 overhead, 0 at the horizon
      elev: sin                            // signed: negative once it has set
    };
  }



  function paint(now) {
    if (!ctx || !W) return;
    var view = source && source();
    var mode = WG.theme ? WG.theme.resolved : "dark";
    var sky = null;

    if (view && view.phase && WG.clock && WG.clock.sky) {
      var on = !view.config || !view.config.look || view.config.look.timeOfDayTheme !== false;
      if (on) sky = WG.clock.skyAt(view, mode);
    }
    if (!sky) {
      var stop = WG.clock && WG.clock.sky ? WG.clock.sky.stops[mode === "dark" ? "night" : "noon"] : null;
      if (!stop) return;
      sky = Object.assign({}, stop[mode], { starlight: stop.starlight, hour: stop.hour, mix: stop.mix });
    }

    var T = now / 1000;
    ctx.clearRect(0, 0, W, H);

    /* --- the sky itself --- */
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, sky.sky1);
    g.addColorStop(0.55, sky.sky2);
    g.addColorStop(1, sky.sky3);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var dark = Math.max(0, Math.min(1, sky.starlight == null ? 1 : sky.starlight));
    var sun = arc(sky.hour == null ? 0 : sky.hour, 0);
    var moon = arc(sky.hour == null ? 0 : sky.hour, 12);

    /* --- stars --- */
    if (dark > 0.02) {
      ctx.save();
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        var tw = reduced ? 1 : 0.72 + 0.28 * Math.sin(T * s.sp + s.tw);
        ctx.globalAlpha = dark * s.mag * tw;
        ctx.fillStyle = "#eaf2fb";
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H, s.r, 0, 6.2832);
        ctx.fill();
      }
      ctx.restore();
    }

    /* --- the moon --- */
    if (moon.up && dark > 0.05) {
      var mx = moon.x * W, my = moon.y * H, mr = Math.max(14, Math.min(W, H) * 0.045);
      var halo = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 5);
      halo.addColorStop(0, hex("#cfe2f2", 0.34 * dark));
      halo.addColorStop(1, hex("#cfe2f2", 0));
      ctx.fillStyle = halo;
      ctx.fillRect(mx - mr * 5, my - mr * 5, mr * 10, mr * 10);
      /* The crescent is one path with two circles and an even-odd fill, not a
       * disc with a hole punched through it. Punching erased the halo as well
       * and left a black plate hanging in the sky. */
      ctx.globalAlpha = dark;
      ctx.fillStyle = "#dae8f4";
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, 6.2832);
      ctx.arc(mx + mr * 0.60, my - mr * 0.36, mr * 0.86, 0, 6.2832);
      ctx.fill("evenodd");
      ctx.globalAlpha = 1;
    }

    /* --- the sun, and the low glow it throws when it is near the horizon --- */
    if (sun.up) {
      var sx = sun.x * W, sy = sun.y * H, sr = Math.max(18, Math.min(W, H) * 0.055);
      var low = Math.max(0, 1 - sun.high * 2.6);                 // strongest at the horizon
      var warm = low > 0.15;
      var glow = ctx.createRadialGradient(sx, sy, sr * 0.4, sx, sy, sr * (warm ? 9 : 5));
      glow.addColorStop(0, hex(warm ? "#f2c093" : sky.glow, 0.5));
      glow.addColorStop(0.4, hex(warm ? "#e0a077" : sky.glow, 0.16));
      glow.addColorStop(1, hex(sky.glow, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      var rr = sr * (warm ? 1.05 : 0.8);
      var rim = ctx.createRadialGradient(sx, sy, rr * 0.2, sx, sy, rr * 1.5);
      rim.addColorStop(0, warm ? "#ffe6c6" : "#fffdf6");
      rim.addColorStop(0.66, warm ? "#f8c48f" : "#ffedc4");
      rim.addColorStop(1, hex(warm ? "#e0975f" : "#f2c98a", 0));
      ctx.fillStyle = rim;
      ctx.beginPath(); ctx.arc(sx, sy, rr * 1.5, 0, 6.2832); ctx.fill();
      ctx.fillStyle = warm ? "#ffe0b6" : "#fffef8";
      ctx.beginPath(); ctx.arc(sx, sy, rr, 0, 6.2832); ctx.fill();
    }

    /* --- what is in the air --- 
     * Birds cross in a loose skein by day and bats flit low at night. They are
     * four line segments each, and they are most of the difference between a
     * sky and a picture of a sky. */
    flock(dark > 0.5 ? "bats" : "birds", T, dark, sky);

    /* --- clouds, lit from wherever the sun is --- */
    for (var c = 0; c < clouds.length; c++) {
      var cl = clouds[c];
      var cx = ((cl.x + (reduced ? 0 : T * cl.sp * 0.05)) % 1.3 - 0.15) * W;
      var cy = cl.y * H;
      var cw = cl.w * W, ch = cl.h * H;
      var lit = sun.up ? 0.8 : 0.3;
      var cg = ctx.createLinearGradient(cx, cy - ch, cx, cy + ch);
      cg.addColorStop(0, hex(sun.up ? "#f4f8fc" : "#8ea6bd", cl.a * lit * (1 - dark * 0.55)));
      cg.addColorStop(1, hex(sky.sky2, 0));
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.ellipse(cx, cy, cw, ch, 0, 0, 6.2832);
      ctx.fill();
    }

    /* --- ground: three ridges, back to front --- */
    /* Ridges are drawn from the mid-sky tone and darkened towards the front, so
     * they read as silhouettes at every hour. Painting them in `sky3` made them
     * invisible at night, when `sky3` is already almost black. */
    for (var h = 0; h < hills.length; h++) {
      var hill = hills[h];
      var shade = 0.30 + h * 0.22;
      ctx.fillStyle = hex(WG.theme ? WG.theme.mix(sky.sky2, "#000000", 0.30 + h * 0.22) : sky.sky3, 0.96);
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (var x2 = 0; x2 <= 24; x2++) {
        var px = (x2 / 24) * W;
        var py = (hill.base - hill.amp * hill.pts[x2]) * H;
        if (x2 === 0) ctx.lineTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
      if (h === hills.length - 1) treeline(hill, sky, shade);
    }

    /* A warm band along the ridge when the sun is low. The sun itself is behind
     * the hills at that point — which is correct, and also means a sunrise with
     * nothing drawn on top of the ground reads as an ordinary grey morning. */
    /* The band is a sunrise/sunset, so it depends on how far the sun is from
     * the horizon in *either* direction. Keying it off `high` alone lit the
     * whole southern sky orange at midnight, when the sun is as far away as it
     * ever gets. */
    var low = Math.max(0, 1 - Math.abs(sun.elev) * 3.4);
    if (low > 0.04) {
      var band = ctx.createLinearGradient(0, HORIZON * H - Math.min(W, H) * 0.34, 0, (HORIZON + 0.10) * H);
      band.addColorStop(0, hex("#e8a06a", 0));
      band.addColorStop(0.72, hex("#e8a06a", 0.30 * low));
      band.addColorStop(1, hex("#c2643f", 0.16 * low));
      ctx.fillStyle = band;
      ctx.fillRect(0, HORIZON * H - Math.min(W, H) * 0.34, W, Math.min(W, H) * 0.44);
      // And the point on the ridge the light is coming from.
      var gx = sun.x * W;
      var pool = ctx.createRadialGradient(gx, HORIZON * H, 0, gx, HORIZON * H, Math.min(W, H) * 0.42);
      pool.addColorStop(0, hex("#ffcf9b", 0.42 * low));
      pool.addColorStop(1, hex("#ffcf9b", 0));
      ctx.fillStyle = pool;
      ctx.fillRect(0, 0, W, H);
    }

    /* A scrim under the interface. The sky is a backdrop, not a competitor:
     * without this, white text at noon sits on a pale cloud and disappears. */
    var scrim = ctx.createLinearGradient(0, 0, 0, H);
    scrim.addColorStop(0, hex(sky.sky3, 0.30));
    scrim.addColorStop(0.35, hex(sky.sky3, 0.06));
    scrim.addColorStop(1, hex(sky.sky3, 0.24));
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, W, H);

    /* --- blood --- */
    bloodLevel += (bloodTarget - bloodLevel) * (reduced ? 1 : 0.04);
    if (bloodLevel > 0.01) {
      var v = ctx.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.22, W / 2, H * 0.45, Math.max(W, H) * 0.78);
      v.addColorStop(0, "rgba(0,0,0,0)");
      v.addColorStop(1, hex("#6a1410", 0.55 * bloodLevel));
      ctx.fillStyle = v;
      ctx.fillRect(0, 0, W, H);
    }
    for (var sp = spatter.length - 1; sp >= 0; sp--) {
      var d = spatter[sp];
      d.life -= 0.0055;
      if (d.life <= 0) { spatter.splice(sp, 1); continue; }
      ctx.globalAlpha = Math.min(0.42, d.life) * 0.8;
      ctx.fillStyle = "#7d1a14";
      for (var b = 0; b < d.blobs.length; b++) {
        var bl = d.blobs[b];
        ctx.beginPath();
        ctx.ellipse(bl.x * W, bl.y * H, bl.r * Math.min(W, H) * 0.009,
          bl.r * Math.min(W, H) * 0.009 * bl.sq, bl.rot, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /** Birds or bats, seeded once per kind and left to drift across. */
  function flock(kind, T, dark, sky) {
    if (kind !== flyerScene) {
      flyerScene = kind;
      flyers = [];
      var rnd = mulberry(kind === "bats" ? 991 : 4242);
      var n = kind === "bats" ? 9 : 7;
      for (var i = 0; i < n; i++) {
        flyers.push({
          x: rnd(), y: 0.10 + rnd() * (kind === "bats" ? 0.42 : 0.30),
          vx: (kind === "bats" ? 0.010 : 0.016) * (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd()),
          amp: (kind === "bats" ? 0.035 : 0.008) * (0.5 + rnd()),
          rate: (kind === "bats" ? 2.4 : 0.7) * (0.6 + rnd()),
          size: (kind === "bats" ? 5 : 7) * (0.7 + rnd() * 0.7),
          ph: rnd() * 6.283
        });
      }
    }
    if (reduced) return;

    ctx.save();
    ctx.strokeStyle = hex(kind === "bats" ? "#0b1016" : sky.onSky, kind === "bats" ? 0.7 : 0.34);
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    for (var f = 0; f < flyers.length; f++) {
      var b = flyers[f];
      var x = (((b.x + T * b.vx) % 1.2) + 1.2) % 1.2 - 0.1;
      var y = b.y + Math.sin(T * b.rate + b.ph) * b.amp;
      var px = x * W, py = y * H;
      // Wings, opening and closing on their own beat.
      var beat = Math.sin(T * (kind === "bats" ? 11 : 4.5) + b.ph);
      var lift = b.size * (0.35 + 0.5 * Math.abs(beat));
      ctx.beginPath();
      if (kind === "bats") {
        ctx.moveTo(px - b.size, py + lift * 0.4);
        ctx.quadraticCurveTo(px - b.size * 0.4, py - lift, px, py);
        ctx.quadraticCurveTo(px + b.size * 0.4, py - lift, px + b.size, py + lift * 0.4);
      } else {
        ctx.moveTo(px - b.size, py + lift);
        ctx.lineTo(px, py);
        ctx.lineTo(px + b.size, py + lift);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function treeline(hill, sky, shade) {
    var rnd = mulberry(77);
    ctx.fillStyle = hex(WG.theme ? WG.theme.mix(sky.sky2, "#000000", 0.52) : sky.sky3, 0.96);
    for (var i = 0; i < 46; i++) {
      var x = rnd() * W;
      var idx = Math.round((x / W) * 24);
      var baseY = (hill.base - hill.amp * hill.pts[Math.min(24, idx)]) * H;
      var th = (10 + rnd() * 20) * (Math.min(W, H) / 700);
      ctx.beginPath();
      ctx.moveTo(x, baseY - th);
      ctx.lineTo(x - th * 0.32, baseY + 2);
      ctx.lineTo(x + th * 0.32, baseY + 2);
      ctx.closePath();
      ctx.fill();
    }
  }

  /* ---------------- public ---------------- */

  /** Somebody just died. Throw a spatter and darken the edges a little more. */
  function bleed(intensity) {
    // Thrown across the glass, not floating in the sky: it starts near an edge
    // and travels inward, in a fan of small irregular drops rather than a
    // handful of big round ones.
    var n = Math.round(16 + Math.random() * 18);
    var edge = Math.floor(Math.random() * 4);
    var ox = edge === 0 ? 0.06 : edge === 1 ? 0.94 : 0.12 + Math.random() * 0.76;
    var oy = edge === 2 ? 0.08 : edge === 3 ? 0.92 : 0.15 + Math.random() * 0.7;
    var dir = Math.atan2(0.5 - oy, 0.5 - ox) + (Math.random() - 0.5) * 0.8;
    var blobs = [];
    for (var i = 0; i < n; i++) {
      var spread = (Math.random() - 0.5) * 0.9;
      var reach = Math.pow(Math.random(), 1.7) * 0.30;
      blobs.push({
        x: ox + Math.cos(dir + spread) * reach,
        y: oy + Math.sin(dir + spread) * reach * 0.8,
        r: 0.18 + Math.random() * (i < 2 ? 1.5 : 0.75),
        sq: 0.4 + Math.random() * 0.9,
        rot: dir + spread
      });
    }
    spatter.push({ blobs: blobs, life: 1 });
    if (spatter.length > 4) spatter.shift();
    bloodTarget = Math.min(1, bloodTarget + (intensity || 0.22));
  }

  /** How bloody the village is overall — driven by the fraction who are dead. */
  function stain(level) { bloodTarget = Math.max(0, Math.min(1, level)); }

  function mount(node, getView) {
    canvas = node;
    ctx = canvas.getContext("2d");
    source = getView;
    reduced = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
      document.documentElement.getAttribute("data-motion") === "off";
    seedField();
    resize();
    global.addEventListener("resize", resize);
    if (global.visualViewport) global.visualViewport.addEventListener("resize", resize);
    start();
  }

  function start() {
    if (raf) return;
    var tick = function (t) {
      raf = global.requestAnimationFrame(tick);
      // The sky moves slowly; 20fps is invisible here and leaves the phone's
      // battery for the game.
      if (t - lastPaint < (reduced ? 900 : 48)) return;
      lastPaint = t;
      paint(t);
    };
    raf = global.requestAnimationFrame(tick);
  }

  WG.sky = { mount: mount, bleed: bleed, stain: stain, resize: resize, paint: function () { paint(performance.now()); } };
})(typeof window !== "undefined" ? window : globalThis);

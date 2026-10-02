/* sky.js — the sky, drawn rather than described.
 *
 * The theme already knew the hour; this paints it. One full-bleed canvas behind
 * everything, showing what the phase clock says is actually happening outside:
 *
 *   - a star field that fades in as the sun goes down, twinkling on its own
 *     slow cycle, with a scatter that never changes so the sky is the same sky;
 *     a band of Milky Way across it, and now and then a shooting star
 *   - the sun and the moon on opposite ends of one arc, rising and setting
 *     across the phase, with a low warm glow when either is near the horizon
 *   - a moon that fills out as the game goes on: a thin crescent the first
 *     night, full by the fifth, which is the only clock a werewolf ever kept
 *   - clouds built out of lobes and lit from wherever the light is
 *   - hills and a treeline, so there is a ground for the village to stand on
 *   - whatever the night's event does to the weather: a blood moon, fireworks
 *     for the festival, a green haze over the hills while the sickness spreads
 *   - blood: as the village loses people the edges darken and stain, and a
 *     fresh kill throws a spatter across the glass
 *
 * It costs one canvas and no libraries. Everything is derived from the numbers
 * the clock already produces — `hour` and `starlight`, plus the round and the
 * event off the same view — so the sky cannot drift out of step with the
 * colour of the interface in front of it.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});

  /* Where the ground starts, as a fraction of the canvas height. The hills sit
   * just below it, so a rising sun genuinely comes up out of them. */
  var HORIZON = 0.72;
  var TAU = Math.PI * 2;

  var canvas = null, ctx = null, dpr = 1;
  var W = 0, H = 0;
  var source = null;            // () => the live view, or null
  var stars = [], clouds = [], hills = null, spatter = [];
  var raf = null, lastPaint = 0, flyers = [], flyerScene = null;
  var bloodLevel = 0, bloodTarget = 0;
  var reduced = false;
  var milky = null;                          // the Milky Way, painted once per size
  var moonCanvas = null, moonKey = "";       // the moon, painted once per phase of it
  var meteors = [], nextMeteor = 4;
  var rockets = [], nextRocket = 0;
  var motionQuery = null;

  function motionOff() {
    return document.documentElement.getAttribute("data-motion") === "off" || !!(motionQuery && motionQuery.matches);
  }

  /* A fixed scatter. Regenerating it per frame makes the sky boil; regenerating
   * it per resize makes the constellations move when you rotate the phone. */
  function seedField() {
    var rnd = mulberry(20260905);
    stars = [];
    for (var i = 0; i < 260; i++) {
      var tint = rnd();
      stars.push({
        x: rnd(), y: rnd() * (HORIZON - 0.04),   // never below the horizon
        r: 0.4 + rnd() * 1.5,
        mag: 0.35 + rnd() * 0.65,
        tw: rnd() * Math.PI * 2,
        sp: 0.6 + rnd() * 1.8,
        /* Real stars are not all one white. A few warm ones and a few cold
         * ones is the difference between a starfield and a noise texture. */
        col: tint < 0.14 ? "#ffe0bd" : tint < 0.30 ? "#cddcff" : "#eaf2fb"
      });
    }
    // The brightest handful get a glint, so the eye has somewhere to land.
    stars.forEach(function (s) { s.glint = s.mag > 0.93 && s.r > 1.6; });

    clouds = [];
    for (var c = 0; c < 7; c++) {
      var lobes = [], n = 5 + Math.floor(rnd() * 3);
      for (var l = 0; l < n; l++) {
        var t = n === 1 ? 0 : l / (n - 1) * 2 - 1;          // -1 .. 1 across the cloud
        lobes.push({
          x: t * 0.72 + (rnd() - 0.5) * 0.12,
          r: (0.30 + rnd() * 0.16) * (1 - Math.abs(t) * 0.42),
          lift: rnd() * 0.18
        });
      }
      clouds.push({
        x: rnd(), y: 0.08 + rnd() * 0.36,
        w: 0.09 + rnd() * 0.12,
        a: 0.16 + rnd() * 0.22, sp: 0.004 + rnd() * 0.010,
        lobes: lobes
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
    milky = null; moonKey = "";
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

  /* ---------------- the Milky Way ----------------
   * Seven hundred faint points and a dozen soft glows along one diagonal. It
   * never moves, so it is painted once per canvas size onto its own canvas and
   * stamped at whatever strength the starlight allows. At a 1.5x ceiling: it is
   * a haze, and a haze does not need retina pixels. */
  function buildMilky() {
    var c = document.createElement("canvas");
    var k = Math.min(1.5, dpr);
    c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * HORIZON * k));
    var m = c.getContext("2d");
    m.setTransform(k, 0, 0, k, 0, 0);
    var rnd = mulberry(5150);
    var ax = -0.05 * W, ay = 0.06 * H, bx = 1.05 * W, by = 0.52 * H;
    var dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    var nx = -dy / len, ny = dx / len;
    var band = Math.min(W, H) * 0.11;

    for (var g = 0; g < 14; g++) {
      var t = g / 13, w = band * (1.6 + rnd() * 1.4);
      var gx = ax + dx * t + nx * (rnd() - 0.5) * band, gy = ay + dy * t + ny * (rnd() - 0.5) * band;
      var rg = m.createRadialGradient(gx, gy, 0, gx, gy, w);
      rg.addColorStop(0, "rgba(196,214,240,0.07)");
      rg.addColorStop(1, "rgba(196,214,240,0)");
      m.fillStyle = rg;
      m.fillRect(gx - w, gy - w, w * 2, w * 2);
    }
    for (var i = 0; i < 700; i++) {
      var tt = rnd();
      // Four uniforms summed is close enough to a bell curve for a galaxy.
      var off = (rnd() + rnd() + rnd() + rnd() - 2) * band * 0.9;
      var x = ax + dx * tt + nx * off, y = ay + dy * tt + ny * off;
      m.globalAlpha = 0.18 + rnd() * 0.45;
      m.fillStyle = rnd() < 0.2 ? "#ffe9d2" : "#e2ecfa";
      m.beginPath();
      m.arc(x, y, 0.3 + rnd() * 0.65, 0, TAU);
      m.fill();
    }
    milky = c;
  }

  /* ---------------- the moon ----------------
   * Drawn onto its own small canvas and only redrawn when its size or its phase
   * changes. The old crescent was one path of two circles under an even-odd
   * fill, which also filled the part of the second circle that hung outside the
   * first: two overlapping rings rather than a moon. This one is a lit disc
   * with a soft-edged shadow disc cut out of it, the dark limb put back in
   * faintly behind (earthshine), and a few maria so it reads as a surface.
   *
   * `full` runs 0 (a thin crescent) to 1 (full). A blood moon is always full —
   * it is an eclipse, which only ever happens to a full moon. */
  var MARIA = [[-0.30, -0.18, 0.22, 0.07], [0.10, -0.38, 0.15, 0.06], [-0.02, 0.22, 0.26, 0.06],
               [0.36, 0.06, 0.13, 0.05], [-0.44, 0.34, 0.11, 0.05], [0.18, 0.44, 0.09, 0.05]];

  function moonSprite(r, full, blood) {
    var key = Math.round(r) + "|" + full.toFixed(2) + "|" + (blood ? 1 : 0) + "|" + dpr;
    if (key === moonKey && moonCanvas) return moonCanvas;
    moonKey = key;
    var size = Math.ceil(r * 2 + 6);
    var c = moonCanvas || document.createElement("canvas");
    c.width = Math.ceil(size * dpr); c.height = Math.ceil(size * dpr);
    c.size = size;
    var m = c.getContext("2d");
    m.setTransform(dpr, 0, 0, dpr, 0, 0);
    m.clearRect(0, 0, size, size);
    var cx = size / 2, cy = size / 2;

    var g = m.createRadialGradient(cx - r * 0.35, cy + r * 0.25, r * 0.1, cx, cy, r);
    g.addColorStop(0, blood ? "#f08a64" : "#fbfdff");
    g.addColorStop(0.65, blood ? "#b83a28" : "#dfeaf5");
    g.addColorStop(1, blood ? "#5e160f" : "#b4c8dc");
    m.fillStyle = g;
    m.beginPath(); m.arc(cx, cy, r, 0, TAU); m.fill();

    m.globalCompositeOperation = "source-atop";
    for (var i = 0; i < MARIA.length; i++) {
      var mr = MARIA[i];
      m.fillStyle = blood ? "rgba(70,10,6," + (mr[3] * 1.6) + ")" : "rgba(104,128,152," + mr[3] + ")";
      m.beginPath(); m.arc(cx + mr[0] * r, cy + mr[1] * r, mr[2] * r, 0, TAU); m.fill();
    }

    if (!blood && full < 0.98) {
      // The shadow comes from the upper right, so the lit edge faces down and
      // left — towards the horizon, which is where the sun actually is.
      var off = r * (0.30 + full * 1.95);
      var sx = cx + off * 0.86, sy = cy - off * 0.5, sr = r * 1.02;
      m.globalCompositeOperation = "destination-out";
      var sg = m.createRadialGradient(sx, sy, sr * 0.86, sx, sy, sr * 1.04);
      sg.addColorStop(0, "rgba(0,0,0,1)");
      sg.addColorStop(1, "rgba(0,0,0,0)");
      m.fillStyle = sg;
      m.beginPath(); m.arc(sx, sy, sr * 1.05, 0, TAU); m.fill();
      m.globalCompositeOperation = "destination-over";
      m.fillStyle = "rgba(168,190,212,0.14)";
      m.beginPath(); m.arc(cx, cy, r, 0, TAU); m.fill();
    }
    m.globalCompositeOperation = "source-over";
    moonCanvas = c;
    return c;
  }

  /** How full the moon is: a sliver on night one, full by night five. */
  function fullness(view) {
    if (!view || !view.round) return 0.22;
    return Math.max(0, Math.min(1, (view.round - 1) / 4)) * 0.92 + 0.08;
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
    var ev = view && view.currentEvent ? view.currentEvent.id : null;
    var bloodMoon = ev === "blood_moon";

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
    // How near the sun is to the horizon, either side of it: the colour of a
    // sunrise and a sunset, and nothing at noon or midnight.
    var low = Math.max(0, 1 - Math.abs(sun.elev) * 3.4);

    /* --- the Milky Way, under the stars --- */
    if (dark > 0.25) {
      if (!milky) buildMilky();
      ctx.globalAlpha = Math.pow((dark - 0.25) / 0.75, 1.5) * 0.9;
      ctx.drawImage(milky, 0, 0, W, H * HORIZON);
      ctx.globalAlpha = 1;
    }

    /* --- stars --- */
    if (dark > 0.02) {
      ctx.save();
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        var tw = reduced ? 1 : 0.72 + 0.28 * Math.sin(T * s.sp + s.tw);
        var a = dark * s.mag * tw;
        ctx.globalAlpha = a;
        ctx.fillStyle = s.col;
        ctx.beginPath();
        ctx.arc(s.x * W, s.y * H, s.r, 0, TAU);
        ctx.fill();
        if (s.glint) {
          var gl = s.r * (3.2 + tw * 2.4);
          ctx.globalAlpha = a * 0.4;
          ctx.strokeStyle = s.col;
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(s.x * W - gl, s.y * H); ctx.lineTo(s.x * W + gl, s.y * H);
          ctx.moveTo(s.x * W, s.y * H - gl); ctx.lineTo(s.x * W, s.y * H + gl);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    meteorsStep(T, dark);

    /* --- the moon ---
     * Not on the home screen, which has a moon of its own with a wolf in front
     * of it; two moons one above the other is a different kind of story. */
    if (moon.up && dark > 0.05 && view) {
      var mx = moon.x * W, my = moon.y * H;
      var mr = Math.max(14, Math.min(W, H) * 0.045) * (bloodMoon ? 1.18 : 1);
      var haloR = mr * (bloodMoon ? 7 : 5);
      var halo = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, haloR);
      halo.addColorStop(0, hex(bloodMoon ? "#d2543c" : "#cfe2f2", (bloodMoon ? 0.42 : 0.30) * dark));
      halo.addColorStop(1, hex(bloodMoon ? "#d2543c" : "#cfe2f2", 0));
      ctx.fillStyle = halo;
      ctx.fillRect(mx - haloR, my - haloR, haloR * 2, haloR * 2);
      var sprite = moonSprite(mr, bloodMoon ? 1 : fullness(view), bloodMoon);
      ctx.globalAlpha = dark;
      ctx.drawImage(sprite, mx - sprite.size / 2, my - sprite.size / 2, sprite.size, sprite.size);
      ctx.globalAlpha = 1;
    }

    /* --- the sun, and the low glow it throws when it is near the horizon --- */
    if (sun.up) {
      var sx = sun.x * W, sy = sun.y * H, sr = Math.max(18, Math.min(W, H) * 0.055);
      var lowSun = Math.max(0, 1 - sun.high * 2.6);              // strongest at the horizon
      var warm = lowSun > 0.15;
      /* Rays, barely there and turning slowly. Without them a high sun is a
       * white dot; with them strong it is a children's drawing. This is the
       * narrow strip between. */
      if (!warm && !reduced) {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(T * 0.015);
        var rayLen = Math.min(W, H) * 0.62;
        for (var ry = 0; ry < 12; ry++) {
          ctx.rotate(TAU / 12);
          var rg = ctx.createLinearGradient(0, 0, rayLen, 0);
          rg.addColorStop(0, hex(sky.glow, 0.10 * (1 - dark)));
          rg.addColorStop(1, hex(sky.glow, 0));
          ctx.fillStyle = rg;
          ctx.beginPath();
          ctx.moveTo(sr * 0.8, 0);
          ctx.lineTo(rayLen, -rayLen * (ry % 2 ? 0.05 : 0.09));
          ctx.lineTo(rayLen, rayLen * (ry % 2 ? 0.05 : 0.09));
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
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
      ctx.beginPath(); ctx.arc(sx, sy, rr * 1.5, 0, TAU); ctx.fill();
      ctx.fillStyle = warm ? "#ffe0b6" : "#fffef8";
      ctx.beginPath(); ctx.arc(sx, sy, rr, 0, TAU); ctx.fill();
    }

    rocketsStep(T, ev === "festival", dark);

    /* --- what is in the air ---
     * Birds cross in a loose skein by day and bats flit low at night. They are
     * four line segments each, and they are most of the difference between a
     * sky and a picture of a sky. */
    flock(dark > 0.5 ? "bats" : "birds", T, dark, sky);

    /* --- clouds, lit from wherever the light is --- */
    drawClouds(T, sky, sun, dark, low);

    /* --- ground: three ridges, back to front --- */
    /* Ridges are drawn from the mid-sky tone and darkened towards the front, so
     * they read as silhouettes at every hour. Painting them in `sky3` made them
     * invisible at night, when `sky3` is already almost black. */
    for (var h = 0; h < hills.length; h++) {
      var hill = hills[h];
      ctx.fillStyle = hex(WG.theme ? WG.theme.mix(sky.sky2, "#000000", 0.30 + h * 0.22) : sky.sky3, 0.96);
      ctx.beginPath();
      ctx.moveTo(0, H);
      ridgeLine(hill, true);
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
      // Moonlight catches the top edge of the far ridge. One stroke, and the
      // hills stop being flat cut-outs.
      if (h === 0 && dark > 0.4) {
        ctx.strokeStyle = hex(bloodMoon ? "#e07a5f" : "#b9d0e4", 0.08 * dark);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ridgeLine(hill, false);
        ctx.stroke();
      }
      if (h === hills.length - 1) treeline(hill, sky);
    }

    /* A warm band along the ridge when the sun is low. The sun itself is behind
     * the hills at that point — which is correct, and also means a sunrise with
     * nothing drawn on top of the ground reads as an ordinary grey morning. */
    /* The band is a sunrise/sunset, so it depends on how far the sun is from
     * the horizon in *either* direction. Keying it off `high` alone lit the
     * whole southern sky orange at midnight, when the sun is as far away as it
     * ever gets. */
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

    /* --- the event, in the weather --- */
    if (bloodMoon) {
      // The whole sky takes the moon's colour from the horizon up.
      var red = ctx.createLinearGradient(0, 0, 0, H);
      red.addColorStop(0, hex("#5a120d", 0.10));
      red.addColorStop(HORIZON, hex("#8a2216", 0.26));
      red.addColorStop(1, hex("#3a0a07", 0.30));
      ctx.fillStyle = red;
      ctx.fillRect(0, 0, W, H);
    } else if (ev === "pandemic") {
      // A sickly haze lying in the valley, drifting.
      var drift = reduced ? 0 : Math.sin(T * 0.05) * 0.04;
      var haze = ctx.createLinearGradient(0, (HORIZON - 0.18) * H, 0, (HORIZON + 0.14) * H);
      haze.addColorStop(0, hex("#9bbf6a", 0));
      haze.addColorStop(0.55 + drift, hex("#8fb35c", 0.20));
      haze.addColorStop(1, hex("#5e7d3a", 0.10));
      ctx.fillStyle = haze;
      ctx.fillRect(0, (HORIZON - 0.18) * H, W, 0.32 * H);
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
          bl.r * Math.min(W, H) * 0.009 * bl.sq, bl.rot, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }

  /* The ridge, as a curve through the midpoints of its control points rather
   * than straight lines between them. Joined with lines it read as a jagged
   * mountain range, which is not the country a village sits in. */
  function ridgeLine(hill, joined) {
    function pt(i) { return [(i / 24) * W, (hill.base - hill.amp * hill.pts[i]) * H]; }
    var p0 = pt(0);
    if (joined) ctx.lineTo(p0[0], p0[1]); else ctx.moveTo(p0[0], p0[1]);
    for (var i = 1; i < 24; i++) {
      var a = pt(i), b = pt(i + 1);
      ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    }
    var end = pt(24);
    ctx.lineTo(end[0], end[1]);
  }

  /** The height of that curve at x, so the treeline stands on it. */
  function ridgeY(hill, x) {
    var u = Math.max(0, Math.min(24, (x / W) * 24));
    var i = Math.max(1, Math.min(23, Math.round(u)));
    function y(k) { return (hill.base - hill.amp * hill.pts[k]) * H; }
    var y0 = i === 1 ? y(0) : (y(i - 1) + y(i)) / 2, y2 = (y(i) + y(i + 1)) / 2;
    var t = Math.max(0, Math.min(1, u - (i - 0.5)));
    return (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * y(i) + t * t * y2;
  }

  /* Clouds are a handful of lobes sitting on a flat base, filled as one path so
   * the overlaps do not stack into darker seams, and cut off along the bottom
   * the way real cumulus is. The lit side is the top by day, the edge the moon
   * catches by night, and warm at either end of the day. */
  function drawClouds(T, sky, sun, dark, low) {
    for (var c = 0; c < clouds.length; c++) {
      var cl = clouds[c];
      // Sized to the screen, within reason: on a television an unbounded
      // cloud is a weather front.
      var cw = cl.w * Math.min(Math.max(W, 380), 900);
      var cx = ((cl.x + (reduced ? 0 : T * cl.sp * 0.05)) % 1.3 - 0.15) * W;
      var cy = cl.y * H;
      var alpha = cl.a * (sun.up ? 1 : 0.55) * (1 - dark * 0.45);
      if (alpha < 0.01) continue;

      ctx.save();
      ctx.beginPath();
      ctx.rect(cx - cw * 1.4, cy - cw * 1.4, cw * 2.8, cw * 1.4 + 2);
      ctx.clip();
      ctx.beginPath();
      for (var l = 0; l < cl.lobes.length; l++) {
        var lb = cl.lobes[l];
        var r = lb.r * cw;
        var lx = cx + lb.x * cw, ly = cy - r * (0.45 + lb.lift);
        ctx.moveTo(lx + r, ly);
        ctx.arc(lx, ly, r, 0, TAU);
      }
      var top = cy - cw * 0.75;
      var lit = low > 0.3 ? "#ffd9b4" : dark > 0.5 ? "#a9bfd6" : "#ffffff";
      var cg = ctx.createLinearGradient(cx, top, cx, cy);
      cg.addColorStop(0, hex(lit, alpha));
      cg.addColorStop(0.55, hex(WG.theme ? WG.theme.mix(lit, sky.sky2, 0.45) : lit, alpha * 0.85));
      cg.addColorStop(1, hex(sky.sky3, alpha * 0.55));
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.restore();
    }
  }

  /* A shooting star now and then, once it is properly dark. A line with a
   * fading tail, under a second long — common enough that a long night has a
   * few, rare enough that each one is a small event. */
  function meteorsStep(T, dark) {
    if (reduced || dark < 0.6) { meteors.length = 0; return; }
    if (T > nextMeteor) {
      var dir = Math.random() < 0.5 ? -1 : 1;
      var ang = (0.28 + Math.random() * 0.3) * (dir < 0 ? -1 : 1);
      meteors.push({
        x: (0.15 + Math.random() * 0.7) * W, y: (0.04 + Math.random() * 0.3) * H,
        vx: Math.cos(ang) * dir, vy: Math.abs(Math.sin(ang)),
        len: Math.min(W, H) * (0.2 + Math.random() * 0.14),
        t0: T, dur: 0.7 + Math.random() * 0.45
      });
      nextMeteor = T + 6 + Math.random() * 16;
    }
    for (var i = meteors.length - 1; i >= 0; i--) {
      var m = meteors[i], p = (T - m.t0) / m.dur;
      if (p >= 1) { meteors.splice(i, 1); continue; }
      var travel = m.len * 1.6 * p;
      var hx = m.x + m.vx * travel, hy = m.y + m.vy * travel;
      var tail = m.len * Math.min(1, p * 3) * (1 - p * 0.5);
      var fade = Math.sin(p * Math.PI) * dark;
      var gr = ctx.createLinearGradient(hx - m.vx * tail, hy - m.vy * tail, hx, hy);
      gr.addColorStop(0, "rgba(234,242,251,0)");
      gr.addColorStop(1, "rgba(234,242,251," + (0.85 * fade) + ")");
      ctx.strokeStyle = gr;
      ctx.lineWidth = 1.4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(hx - m.vx * tail, hy - m.vy * tail);
      ctx.lineTo(hx, hy);
      ctx.stroke();
    }
  }

  /* Fireworks, for as long as the festival lasts. A spark climbs from behind
   * the hills, stops, and opens into a ring that falls as it fades. Added light
   * rather than painted colour, so overlapping bursts brighten each other
   * instead of covering each other up. */
  var SPARKS = ["#ffd27a", "#ff9fb0", "#9fe6d6", "#b5d6ec", "#fff4dc"];
  function rocketsStep(T, on, dark) {
    if (!on || reduced) { rockets.length = 0; return; }
    if (T > nextRocket) {
      rockets.push({
        // High enough to open in the strip of sky above the village.
        x: (0.14 + Math.random() * 0.72) * W, top: (0.12 + Math.random() * 0.22) * H,
        t0: T, rise: 0.9 + Math.random() * 0.4, col: SPARKS[Math.floor(Math.random() * SPARKS.length)],
        v: Math.min(W, H) * (0.10 + Math.random() * 0.07),
        // Each spark its own speed and a little off the even spacing, or the
        // burst reads as a ring of beads instead of a spray.
        parts: (function () {
          var n = 30 + Math.floor(Math.random() * 16), out = [];
          for (var k = 0; k < n; k++) out.push({ a: (k + Math.random() * 0.6) / n * TAU, sp: 0.6 + Math.random() * 0.4 });
          return out;
        })()
      });
      nextRocket = T + 0.6 + Math.random() * 1.6;
    }
    var strength = 0.45 + dark * 0.55;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (var i = rockets.length - 1; i >= 0; i--) {
      var r = rockets[i], age = T - r.t0;
      if (age < r.rise) {
        var p = age / r.rise, ease = 1 - (1 - p) * (1 - p);
        var y = HORIZON * H + (r.top - HORIZON * H) * ease;
        ctx.fillStyle = hex("#ffe6b8", 0.8 * strength);
        ctx.beginPath(); ctx.arc(r.x, y, 1.6, 0, TAU); ctx.fill();
        continue;
      }
      var b = age - r.rise, life = 1.7;
      if (b > life) { rockets.splice(i, 1); continue; }
      var fade = 1 - b / life;
      if (b < 0.12) {
        var flash = ctx.createRadialGradient(r.x, r.top, 0, r.x, r.top, r.v * 0.8);
        flash.addColorStop(0, hex(r.col, 0.35 * strength));
        flash.addColorStop(1, hex(r.col, 0));
        ctx.fillStyle = flash;
        ctx.fillRect(r.x - r.v, r.top - r.v, r.v * 2, r.v * 2);
      }
      var reach = r.v * (1 - Math.pow(1 - Math.min(1, b / 0.9), 3));
      var tail = Math.min(reach, r.v * 0.22) * fade;
      var drop = b * b * r.v * 0.35;
      ctx.strokeStyle = hex(r.col, fade * strength * 0.8);
      ctx.fillStyle = hex(r.col, fade * strength);
      ctx.lineWidth = 1.3;
      ctx.lineCap = "round";
      for (var k = 0; k < r.parts.length; k++) {
        var pt = r.parts[k], cx = Math.cos(pt.a), cy = Math.sin(pt.a), d = reach * pt.sp;
        var px = r.x + cx * d, py = r.top + cy * d + drop;
        ctx.beginPath();
        ctx.moveTo(px - cx * tail * pt.sp, py - cy * tail * pt.sp - drop * 0.15);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(px, py, 1.4 * (0.6 + fade * 0.6), 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
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

  /* Conifers in two tiers rather than single triangles: still a silhouette,
   * but a silhouette of trees instead of a row of teeth. */
  function treeline(hill, sky) {
    var rnd = mulberry(77);
    ctx.fillStyle = hex(WG.theme ? WG.theme.mix(sky.sky2, "#000000", 0.52) : sky.sky3, 0.96);
    ctx.beginPath();
    for (var i = 0; i < 46; i++) {
      var x = rnd() * W;
      var baseY = ridgeY(hill, x);
      var th = (10 + rnd() * 20) * (Math.min(W, H) / 700);
      var wd = th * 0.34;
      ctx.moveTo(x, baseY - th);
      ctx.lineTo(x - wd * 0.7, baseY - th * 0.45);
      ctx.lineTo(x - wd * 0.35, baseY - th * 0.47);
      ctx.lineTo(x - wd, baseY + 2);
      ctx.lineTo(x + wd, baseY + 2);
      ctx.lineTo(x + wd * 0.35, baseY - th * 0.47);
      ctx.lineTo(x + wd * 0.7, baseY - th * 0.45);
      ctx.closePath();
    }
    ctx.fill();
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
    motionQuery = global.matchMedia ? global.matchMedia("(prefers-reduced-motion: reduce)") : null;
    reduced = motionOff();
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
      // battery for the game. Motion turned off mid-game is picked up here
      // rather than only at mount.
      reduced = motionOff();
      if (t - lastPaint < (reduced ? 900 : 48)) return;
      lastPaint = t;
      paint(t);
    };
    raf = global.requestAnimationFrame(tick);
  }

  WG.sky = { mount: mount, bleed: bleed, stain: stain, resize: resize, paint: function () { paint(performance.now()); } };
})(typeof window !== "undefined" ? window : globalThis);

/* ============================================================
   nojukuramu — the sky, drawn rather than described

   One canvas behind the whole page. Everything on it comes from a single
   number, `t`: how far through the evening we are, 0 at golden hour and 1
   at deep night. The scroll drives it, the dial in the corner can take it
   over, and a real forecast can set where it starts — but there is only
   ever the one clock, so nothing here can drift out of step with anything
   else in front of it.

   What is painted, in order: sky, stars, meteors, sun and its glow, the
   moon at tonight's real phase, cloud lit from underneath, flocks, four
   ridges with mist pooling at their feet, the lake carrying whichever
   light is above it, a treeline, fireflies, then whatever the weather is
   doing — rain, snow, fog, lightning — and a vignette so the type always
   has something to sit on.

   No libraries, one requestAnimationFrame, and a static single frame when
   the visitor has asked for reduced motion.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- colour ---------- */
  function hex(h) {
    h = h.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function mix(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function rgba(c, a) { return "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + "," + (a === undefined ? 1 : a) + ")"; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function ease(x) { return x * x * (3 - 2 * x); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* The evening as five stops. Every colour on the canvas is one of these
     six interpolated at `t` — which is why the sun, the water, the mist and
     the mountains can never disagree about what time it is. */
  var STOPS = [
    { at: 0.00, top: "#1D6193", mid: "#F0A257", hor: "#FFD79A", sun: "#FFE7A6", glow: "#FFB768", ink: "#3A2418" },
    { at: 0.28, top: "#1B3C6B", mid: "#DC6448", hor: "#F7AA5D", sun: "#FFD188", glow: "#F0873F", ink: "#341A14" },
    { at: 0.52, top: "#16274F", mid: "#7E3F61", hor: "#CA6140", sun: "#E88A52", glow: "#B4552F", ink: "#241228" },
    { at: 0.76, top: "#0C1533", mid: "#2B2A54", hor: "#5C3552", sun: "#8A5560", glow: "#4A305C", ink: "#120C24" },
    { at: 1.00, top: "#04081A", mid: "#0A1128", hor: "#26243F", sun: "#2A2A47", glow: "#3A2A46", ink: "#05080F" }
  ].map(function (s) {
    return { at: s.at, top: hex(s.top), mid: hex(s.mid), hor: hex(s.hor), sun: hex(s.sun), glow: hex(s.glow), ink: hex(s.ink) };
  });

  /* Where an overcast pulls every colour: warm slate by day, cold by night. */
  var SLATE_DAY = hex("#7C8390");
  var SLATE_NIGHT = hex("#141824");

  function palette(t, grey) {
    var i = 0;
    while (i < STOPS.length - 2 && t > STOPS[i + 1].at) i++;
    var a = STOPS[i], b = STOPS[i + 1];
    var k = ease(clamp((t - a.at) / (b.at - a.at), 0, 1));
    var P = {
      top: mix(a.top, b.top, k), mid: mix(a.mid, b.mid, k), hor: mix(a.hor, b.hor, k),
      sun: mix(a.sun, b.sun, k), glow: mix(a.glow, b.glow, k), ink: mix(a.ink, b.ink, k)
    };
    if (grey > 0.001) {
      var slate = mix(SLATE_DAY, SLATE_NIGHT, ease(clamp(t / 0.85, 0, 1)));
      var g = grey * 0.66;
      P.top = mix(P.top, mix(slate, [10, 14, 26], 0.45), g);
      P.mid = mix(P.mid, slate, g);
      P.hor = mix(P.hor, mix(slate, [190, 186, 182], 0.25), g * 0.9);
      P.sun = mix(P.sun, slate, g * 0.85);
      P.glow = mix(P.glow, slate, g * 0.9);
      P.ink = mix(P.ink, mix(slate, [8, 10, 18], 0.6), g * 0.7);
    }
    return P;
  }

  function mulberry(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- state ---------- */
  var canvas, ctx, W = 0, H = 0, dpr = 1;
  var HORIZON = 0.70;

  var stars = [], clouds = [], flocks = [], ranges = [], flies = [], shooters = [];
  var drops = [], flakes = [], splashes = [], bolt = null;
  var moonlight = null, pointer = { x: 0, y: 0, tx: 0, ty: 0 };

  var tBase = 0, tScroll = 0, tDial = null, tShown = 0;
  var flash = 0, nextBolt = 0;
  var lightningHandlers = [];
  /* Under prefers-reduced-motion nothing on the canvas moves, so repainting
     it sixty times a second is pure heat. The scene paints when something
     it draws from has actually changed, and otherwise sits still. */
  var dirty = true;

  /* Weather, as the handful of numbers the canvas actually draws with.
     Each one eases toward its target so a forecast arriving mid-scroll
     rolls in rather than snapping. */
  var wx = { rain: 0, snow: 0, fog: 0, storm: 0, cloud: 0.22, grey: 0, wind: 8 };
  var wxTarget = { rain: 0, snow: 0, fog: 0, storm: 0, cloud: 0.22, grey: 0, wind: 8 };
  var moonPhase = 0.5;

  /* ---------- one ridge, by midpoint displacement ----------
     The displaced values are normalised rather than clamped. Clamping is
     what put a flat-topped mountain on the skyline: every value that
     overshot got pinned to exactly 1 and the peak came out as a plateau. */
  function ridge(seed, n, rough) {
    var rnd = mulberry(seed);
    var pts = new Array(n + 1);
    pts[0] = rnd(); pts[n] = rnd();
    for (var step = n; step > 1; step >>= 1) {
      var amp = rough * Math.pow(step / n, 0.62);
      for (var i = 0; i < n; i += step) {
        var mid = i + (step >> 1);
        pts[mid] = (pts[i] + pts[i + step]) / 2 + (rnd() - 0.5) * amp;
      }
    }
    var lo = Infinity, hi = -Infinity;
    for (var j = 0; j <= n; j++) { if (pts[j] < lo) lo = pts[j]; if (pts[j] > hi) hi = pts[j]; }
    var span = hi - lo || 1;
    for (var k = 0; k <= n; k++) pts[k] = (pts[k] - lo) / span;
    return pts;
  }

  var RANGE_SPEC = [
    { seed: 1041, base: 0.575, amp: 0.150, rough: 2.3, dark: 0.34, drift: 0.014, look: 0.010, mist: 0.30 },
    { seed: 2207, base: 0.618, amp: 0.128, rough: 2.6, dark: 0.56, drift: 0.030, look: 0.020, mist: 0.26 },
    { seed: 3313, base: 0.658, amp: 0.096, rough: 2.9, dark: 0.76, drift: 0.052, look: 0.034, mist: 0.20 },
    { seed: 4409, base: 0.699, amp: 0.070, rough: 3.2, dark: 0.86, drift: 0.080, look: 0.050, mist: 0.00 }
  ];

  function makeFlock(rnd, spread) {
    var n = 3 + ((rnd() * 5) | 0), birds = [];
    for (var i = 0; i < n; i++) {
      birds.push({ dx: -i * (0.016 + rnd() * 0.012), dy: (i % 2 ? 1 : -1) * i * (0.006 + rnd() * 0.006), ph: rnd() * 6.283, sc: 0.75 + rnd() * 0.6 });
    }
    var dir = rnd() < 0.5 ? 1 : -1;
    return {
      x: spread ? rnd() : (dir > 0 ? -0.15 : 1.15),
      y: 0.14 + rnd() * 0.36,
      v: dir * (0.014 + rnd() * 0.016),
      flap: 2.6 + rnd() * 2.4, size: 5 + rnd() * 6, birds: birds
    };
  }

  function seedScene() {
    var rnd = mulberry(20260906);

    stars = [];
    for (var i = 0; i < 300; i++) {
      stars.push({ x: rnd(), y: rnd() * (HORIZON - 0.03), r: 0.4 + rnd() * 1.5,
                   mag: 0.3 + rnd() * 0.7, tw: rnd() * 6.283, sp: 0.5 + rnd() * 1.9 });
    }

    clouds = [];
    for (var c = 0; c < 18; c++) {
      var puffs = [], n = 3 + ((rnd() * 4) | 0);
      for (var p = 0; p < n; p++) {
        puffs.push({ dx: (p / n - 0.5) * 3.6 + (rnd() - 0.5) * 0.5, dy: (rnd() - 0.5) * 0.16, r: 0.34 + rnd() * 0.52 });
      }
      var lane = rnd(), cxs = rnd();
      /* A lane is kept clear around x=0.66, where the sun sits: a sunset
         with the sun permanently behind a cloud is just a grey evening.
         An overcast fills it in anyway, which is the point. */
      if (cxs > 0.56 && cxs < 0.78) cxs = cxs < 0.67 ? cxs - 0.20 : cxs + 0.20;
      clouds.push({
        x: cxs, y: 0.10 + lane * lane * 0.62, s: 30 + rnd() * 96,
        v: (0.0035 + rnd() * 0.010) * (rnd() < 0.25 ? -0.55 : 1),
        squash: 0.11 + rnd() * 0.11, puffs: puffs, a: 0.22 + rnd() * 0.34,
        low: lane > 0.62
      });
    }

    flocks = [];
    for (var f = 0; f < 4; f++) flocks.push(makeFlock(rnd, true));

    ranges = RANGE_SPEC.map(function (s) { return ridge(s.seed, 128, s.rough); });

    flies = [];
    for (var g = 0; g < 26; g++) {
      flies.push({ x: rnd(), y: 0.86 + rnd() * 0.14, ph: rnd() * 6.283, sp: 0.3 + rnd() * 0.8, r: 0.7 + rnd() * 1.2 });
    }
  }

  /* This scene is nothing but soft gradients, and its cost is almost purely
     fill rate: at a phone's device pixel ratio a full-screen backing store
     is four to nine times the work for a picture with no hard edge in it to
     resolve. So the canvas is given a pixel budget instead of a ratio, and
     the browser scales the result up — which for gradients is free and
     invisible. A retina laptop lands near 1.1x, a 3x phone near 2.2x. */
  var PIXEL_BUDGET = 1.6e6;

  /* ...and even that budget is a guess about hardware I cannot see, so the
     scene watches its own frame times and spends less when it is not
     keeping up: fewer pixels, coarser water, less rain. It settles within a
     second or two of arriving, and climbs back if the device turns out to
     have been busy rather than slow. 1 is everything; 0.35 is the floor,
     which still looks like the same evening. */
  var quality = 1;

  function resize() {
    W = global.innerWidth; H = global.innerHeight;
    var want = Math.min(global.devicePixelRatio || 1, 3);
    var area = Math.max(1, W * H);
    /* The floor is below 1 deliberately. There is not a hard edge anywhere in
       this scene, so an upscaled gradient is indistinguishable from a native
       one — and on a device that cannot keep up, halving the pixels is the
       only lever that actually matters. */
    dpr = Math.max(0.7, Math.min(want, Math.sqrt(PIXEL_BUDGET * quality / area)));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dirty = true;
  }

  /* ---------- rain, snow, lightning ---------- */
  function stockPrecipitation() {
    var want = Math.round(wx.rain * wx.rain * 900 * (W / 1400) * quality);
    while (drops.length < want) {
      drops.push({ x: Math.random(), y: Math.random(), len: 12 + Math.random() * 26,
                   sp: 0.010 + Math.random() * 0.016, z: 0.35 + Math.random() * 0.65 });
    }
    if (drops.length > want) drops.length = want;

    var wantS = Math.round(wx.snow * 260 * (W / 1400));
    while (flakes.length < wantS) {
      flakes.push({ x: Math.random(), y: Math.random(), r: 0.9 + Math.random() * 2.2,
                    sp: 0.0016 + Math.random() * 0.0028, ph: Math.random() * 6.283, sw: 0.4 + Math.random() * 1.4 });
    }
    if (flakes.length > wantS) flakes.length = wantS;
  }

  function fireLightning(now) {
    flash = 1;
    var rnd = mulberry((now | 0) * 7 + 13);
    var x = 0.15 + rnd() * 0.7, y = 0;
    var pts = [[x * W, 0]];
    var steps = 7 + ((rnd() * 5) | 0);
    for (var i = 1; i <= steps; i++) {
      x += (rnd() - 0.5) * 0.075;
      y = (i / steps) * HORIZON;
      pts.push([x * W, y * H]);
    }
    bolt = { pts: pts, life: 1 };
    for (var h = 0; h < lightningHandlers.length; h++) { try { lightningHandlers[h](); } catch (e) {} }
  }

  /* ---------- the moon, at tonight's real phase ----------
     Bright limb on the right while waxing, on the left while waning. The
     terminator is an ellipse whose width is cos(2*pi*phase): zero at the
     quarters (a straight edge), widening to the full disc at new and full. */
  function drawMoon(cx, cy, r, phase, bright, dark) {
    var k = Math.cos(2 * Math.PI * phase);
    var waxing = phase < 0.5;

    ctx.save();
    ctx.translate(cx, cy);
    if (!waxing) ctx.scale(-1, 1);

    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill();

    ctx.fillStyle = bright;
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);
    ctx.ellipse(0, 0, r * Math.abs(k), r, 0, Math.PI / 2, -Math.PI / 2, k > 0);
    ctx.closePath();
    ctx.fill();

    /* Seas, drawn last so they sit on whichever part is lit. */
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = "#9AA6BC";
    ctx.beginPath(); ctx.arc(-r * 0.32, -r * 0.22, r * 0.19, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.28, r * 0.18, r * 0.13, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.05, -r * 0.46, r * 0.10, 0, 6.283); ctx.fill();
    ctx.restore();
  }

  /* ---------- paint ---------- */
  function paint(now) {
    var P = palette(tShown, wx.grey);
    var hy = H * HORIZON;
    /* The water is the expensive part of this canvas — a few thousand small
       fills per frame. A phone gets a coarser step for the same picture. */
    var fine = W >= 760 && quality > 0.7;
    var rowStep = Math.round((fine ? 4 : 7) / Math.max(quality, 0.4));
    var night = clamp((tShown - 0.40) / 0.40, 0, 1);
    var wind = wx.wind;
    var windK = clamp(wind / 34, 0, 1.6);

    /* sky */
    var g = ctx.createLinearGradient(0, 0, 0, hy);
    g.addColorStop(0, rgba(P.top));
    g.addColorStop(0.58, rgba(P.mid));
    g.addColorStop(1, rgba(P.hor));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, hy + 1);

    /* stars — an overcast is the only thing that can take them away */
    var starA = night * (1 - wx.cloud * 0.85) * (1 - wx.fog * 0.7);
    if (starA > 0.01) {
      ctx.fillStyle = "#FFF6E4";
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        var tw = 0.62 + 0.38 * Math.sin(now * 0.0011 * s.sp + s.tw);
        ctx.globalAlpha = starA * s.mag * tw * 0.95;
        ctx.beginPath(); ctx.arc(s.x * W, s.y * H, s.r, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    for (var sh = shooters.length - 1; sh >= 0; sh--) {
      var m = shooters[sh];
      m.life -= 0.016;
      if (m.life <= 0) { shooters.splice(sh, 1); continue; }
      m.x += m.vx; m.y += m.vy;
      var grad = ctx.createLinearGradient(m.x, m.y, m.x - m.vx * 16, m.y - m.vy * 16);
      grad.addColorStop(0, "rgba(255,246,226," + clamp(m.life, 0, 1) * 0.95 + ")");
      grad.addColorStop(1, "rgba(255,246,226,0)");
      ctx.strokeStyle = grad; ctx.lineWidth = 1.8; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x - m.vx * 16, m.y - m.vy * 16); ctx.stroke();
    }

    /* sun */
    var sunX = W * (0.66 + pointer.x * 0.006);
    var sunY = H * (0.44 + 0.42 * ease(clamp(tShown / 0.66, 0, 1)));
    var R = Math.max(42, Math.min(W, H) * 0.085);
    var sunOut = (1 - wx.cloud * 0.55) * (1 - wx.rain * 0.75) * (1 - wx.fog * 0.8);

    if (tShown < 0.92) {
      var glowR = Math.max(W, H) * (0.72 - tShown * 0.24);
      var gg = ctx.createRadialGradient(sunX, sunY, R * 0.4, sunX, sunY, glowR);
      var ga = 0.55 * (1 - tShown * 0.72) * (0.35 + 0.65 * sunOut);
      gg.addColorStop(0, rgba(P.glow, ga));
      gg.addColorStop(0.34, rgba(P.glow, ga * 0.36));
      gg.addColorStop(1, rgba(P.glow, 0));
      ctx.fillStyle = gg; ctx.fillRect(0, 0, W, hy);
    }

    if (sunY - R < hy && sunOut > 0.05) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, hy); ctx.clip();
      ctx.globalAlpha = sunOut;
      var sg = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, R);
      sg.addColorStop(0, rgba(mix(P.sun, [255, 252, 240], 0.55), 1));
      sg.addColorStop(0.42, rgba(P.sun, 0.99));
      sg.addColorStop(0.78, rgba(mix(P.sun, P.glow, 0.6), 0.85));
      sg.addColorStop(1, rgba(P.glow, 0.0));
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.arc(sunX, sunY, R, 0, 6.283); ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    /* moon */
    moonlight = null;
    if (tShown > 0.50) {
      var mA = clamp((tShown - 0.50) / 0.28, 0, 1) * (1 - wx.cloud * 0.72) * (1 - wx.fog * 0.85);
      if (mA > 0.02) {
        var mX = W * (0.905 - pointer.x * 0.004);
        var mY = H * (0.60 - 0.44 * ease(clamp((tShown - 0.48) / 0.5, 0, 1)));
        var mR = Math.max(20, Math.min(W, H) * 0.033);
        var lit = (1 - Math.cos(moonPhase * 2 * Math.PI)) / 2;

        var mg = ctx.createRadialGradient(mX, mY, mR * 0.5, mX, mY, mR * 6);
        mg.addColorStop(0, "rgba(226,232,246," + 0.22 * mA * lit + ")");
        mg.addColorStop(1, "rgba(226,232,246,0)");
        ctx.fillStyle = mg; ctx.beginPath(); ctx.arc(mX, mY, mR * 6, 0, 6.283); ctx.fill();

        ctx.globalAlpha = mA;
        drawMoon(mX, mY, mR, moonPhase, "#F3EEE0", rgba(mix(P.top, [40, 46, 66], 0.5), 0.85));
        ctx.globalAlpha = 1;
        moonlight = { x: mX, y: mY, r: mR, a: mA * lit };
      }
    }

    /* cloud, lit from underneath because the light is low. How many of the
       pool get drawn is the forecast's cloud cover, straight through. */
    var lit2 = mix(P.sun, [255, 244, 222], 0.25);
    var shade = mix(P.mid, P.ink, 0.55 + wx.grey * 0.25);
    var shown = Math.round(lerp(4, clouds.length, ease(wx.cloud)));
    for (var c = 0; c < shown; c++) {
      var cl = clouds[c];
      if (!reduced) cl.x += cl.v * 0.026 * (0.35 + windK);
      if (cl.x > 1.35) cl.x = -0.35; else if (cl.x < -0.35) cl.x = 1.35;
      var cx = cl.x * W + pointer.x * 6, cy = cl.y * hy;
      var a = cl.a * (0.30 + 0.70 * (1 - night * 0.78)) * (0.55 + 0.85 * wx.cloud);
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.beginPath();
      for (var p = 0; p < cl.puffs.length; p++) {
        var pf = cl.puffs[p];
        ctx.ellipse(cx + pf.dx * cl.s, cy + pf.dy * cl.s, pf.r * cl.s, pf.r * cl.s * cl.squash, 0, 0, 6.283);
      }
      var cg = ctx.createLinearGradient(0, cy - cl.s * cl.squash * 2.2, 0, cy + cl.s * cl.squash * 2.2);
      cg.addColorStop(0, rgba(shade, 0.72));
      cg.addColorStop(0.5, rgba(mix(shade, lit2, 0.40 * (1 - wx.grey * 0.7)), 0.86));
      cg.addColorStop(1, rgba(mix(lit2, shade, wx.grey * 0.8), 0.95));
      ctx.fillStyle = cg; ctx.fill();
      ctx.restore();
    }

    /* an overcast reads as a lid, not as more clouds */
    if (wx.grey > 0.02) {
      var og = ctx.createLinearGradient(0, 0, 0, hy);
      og.addColorStop(0, rgba(mix(P.top, P.mid, 0.4), wx.grey * 0.34));
      og.addColorStop(1, rgba(P.mid, 0));
      ctx.fillStyle = og; ctx.fillRect(0, 0, W, hy);
    }

    /* birds — they land when the weather turns */
    var birdFade = clamp(1 - (tShown - 0.52) / 0.26, 0, 1) * (1 - clamp(wx.rain * 1.4, 0, 1)) * (1 - wx.fog);
    if (birdFade > 0.02) {
      ctx.strokeStyle = rgba(mix(P.ink, [0, 0, 0], 0.35), 0.72 * birdFade);
      ctx.lineWidth = 1.6; ctx.lineCap = "round";
      for (var f = 0; f < flocks.length; f++) {
        var fl = flocks[f];
        if (!reduced) fl.x += fl.v * 0.0016 * (0.7 + windK * 0.8);
        if (fl.x > 1.25 || fl.x < -0.25) { flocks[f] = makeFlock(mulberry((now | 0) + f * 977), false); continue; }
        for (var b = 0; b < fl.birds.length; b++) {
          var bd = fl.birds[b];
          var bx = (fl.x + bd.dx * (fl.v > 0 ? 1 : -1)) * W;
          var by = (fl.y + bd.dy) * H + Math.sin(now * 0.0007 + bd.ph) * 4;
          var w2 = fl.size * bd.sc;
          var flapv = Math.sin(now * 0.006 * fl.flap + bd.ph);
          var liftv = w2 * 0.42 * flapv;
          ctx.beginPath();
          ctx.moveTo(bx - w2, by + liftv * 0.4);
          ctx.quadraticCurveTo(bx - w2 * 0.45, by - liftv, bx, by);
          ctx.quadraticCurveTo(bx + w2 * 0.45, by - liftv, bx + w2, by + liftv * 0.4);
          ctx.stroke();
        }
      }
    }

    /* the last of the light, which never quite leaves the horizon */
    var ag = ctx.createLinearGradient(0, hy - H * 0.09, 0, hy);
    ag.addColorStop(0, "rgba(196,96,58,0)");
    ag.addColorStop(1, "rgba(196,96,58," + (0.10 + 0.10 * (1 - night)) * (1 - wx.grey * 0.7) + ")");
    ctx.fillStyle = ag; ctx.fillRect(0, hy - H * 0.09, W, H * 0.09);

    var hz = ctx.createLinearGradient(0, hy - H * 0.20, 0, hy);
    hz.addColorStop(0, rgba(P.hor, 0));
    hz.addColorStop(1, rgba(P.hor, 0.42 * (1 - night * 0.6)));
    ctx.fillStyle = hz; ctx.fillRect(0, hy - H * 0.20, W, H * 0.20);

    /* ridges */
    var sp = tScroll;
    for (var r2 = 0; r2 < ranges.length; r2++) {
      var spec = RANGE_SPEC[r2], pts = ranges[r2], n2 = pts.length - 1;
      var shift = -(sp * spec.drift * W * 3.2) - pointer.x * spec.look * 90;
      var body = mix(mix(P.hor, P.ink, spec.dark), P.top, 0.30 * (1 - spec.dark));
      ctx.fillStyle = rgba(body, 1);
      ctx.beginPath();
      ctx.moveTo(-0.2 * W + shift, hy + 2);
      for (var k2 = 0; k2 <= n2; k2++) {
        ctx.lineTo(-0.2 * W + shift + (k2 / n2) * W * 1.4, H * spec.base - pts[k2] * H * spec.amp);
      }
      ctx.lineTo(-0.2 * W + shift + W * 1.4, hy + 2);
      ctx.closePath(); ctx.fill();

      /* mist pooling at the foot of the range — aerial perspective, and the
         only reason four dark shapes read as four distances */
      if (spec.mist > 0) {
        var mTop = H * (spec.base - spec.amp) - 4;
        var mg2 = ctx.createLinearGradient(0, mTop, 0, hy);
        mg2.addColorStop(0, rgba(P.hor, 0));
        mg2.addColorStop(1, rgba(P.hor, (spec.mist + wx.fog * 0.5) * (1 - night * 0.72)));
        ctx.fillStyle = mg2;
        ctx.fillRect(0, mTop, W, hy - mTop);
      }

      if (tShown < 0.72 && r2 < 3 && sunOut > 0.2) {
        ctx.save();
        ctx.globalAlpha = (1 - tShown / 0.72) * (0.30 - r2 * 0.07) * sunOut;
        ctx.strokeStyle = rgba(P.sun, 1); ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (var k3 = 0; k3 <= n2; k3++) {
          var x3 = -0.2 * W + shift + (k3 / n2) * W * 1.4;
          var y3 = H * spec.base - pts[k3] * H * spec.amp;
          if (k3 === 0) ctx.moveTo(x3, y3); else ctx.lineTo(x3, y3);
        }
        ctx.stroke(); ctx.restore();
      }
    }

    /* the lake */
    var wg = ctx.createLinearGradient(0, hy, 0, H);
    wg.addColorStop(0, rgba(mix(P.hor, P.ink, 0.16), 1));
    wg.addColorStop(0.16, rgba(mix(P.hor, P.ink, 0.40), 1));
    wg.addColorStop(0.55, rgba(mix(P.mid, P.ink, 0.66), 1));
    wg.addColorStop(1, rgba(mix(P.ink, [0, 0, 0], 0.46), 1));
    ctx.fillStyle = wg; ctx.fillRect(0, hy, W, H - hy);

    /* whichever light is in the sky, laid out on the water */
    if (tShown < 0.90 && sunOut > 0.08) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, hy, W, H - hy); ctx.clip();
      var refl = clamp(1 - tShown / 0.9, 0, 1) * sunOut;

      for (var cy2 = hy; cy2 < H; cy2 += rowStep) {
        var cd = (cy2 - hy) / (H - hy);
        var half = R * (0.7 + cd * 3.4);
        var cga = ctx.createLinearGradient(sunX - half, 0, sunX + half, 0);
        var ca = refl * (0.26 - cd * 0.20);
        cga.addColorStop(0, rgba(P.sun, 0));
        cga.addColorStop(0.5, rgba(P.sun, Math.max(ca, 0)));
        cga.addColorStop(1, rgba(P.sun, 0));
        ctx.fillStyle = cga;
        ctx.fillRect(sunX - half, cy2, half * 2, rowStep + 0.4);
      }

      ctx.globalCompositeOperation = "lighter";
      var wr = mulberry(4242);
      for (var y4 = hy + 3; y4 < H; y4 += (fine ? 3.5 : 6)) {
        var d4 = (y4 - hy) / (H - hy);
        var rows = (fine ? 3 : 2) + ((d4 * (fine ? 5 : 3)) | 0);
        for (var q = 0; q < rows; q++) {
          var spread = R * (0.4 + d4 * 3.2);
          var ox = (wr() - 0.5) * 2 * spread;
          var swim = Math.sin(now * 0.0011 + d4 * 15 + q * 2.3) * (3 + d4 * 22) * (0.5 + windK);
          var len = (R * 0.10 + wr() * R * (0.30 + d4 * 0.55));
          var fade = Math.exp(-Math.pow(ox / (spread * 0.62), 2));
          var a4 = refl * fade * (0.20 - d4 * 0.13) * (0.45 + 0.55 * Math.sin(now * 0.0019 + d4 * 26 + q));
          if (a4 <= 0.004) continue;
          ctx.globalAlpha = a4;
          ctx.fillStyle = rgba(P.sun, 1);
          ctx.beginPath();
          ctx.ellipse(sunX + ox + swim, y4, len, 0.9 + d4 * 0.8, 0, 0, 6.283);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.restore(); ctx.globalAlpha = 1;
    }

    if (moonlight && moonlight.a > 0.02) {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, hy, W, H - hy); ctx.clip();
      ctx.globalCompositeOperation = "lighter";
      var mr = mulberry(3131);
      for (var my2 = hy + 2; my2 < H; my2 += rowStep) {
        var md = (my2 - hy) / (H - hy);
        var mhalf = moonlight.r * (0.5 + md * 2.2);
        for (var mq = 0; mq < 3; mq++) {
          var mox = (mr() - 0.5) * 2 * mhalf;
          var mfade = Math.exp(-Math.pow(mox / (mhalf * 0.6), 2));
          var ma = moonlight.a * mfade * (0.12 - md * 0.09) * (0.4 + 0.6 * Math.sin(now * 0.0015 + md * 24 + mq));
          if (ma <= 0.003) continue;
          ctx.globalAlpha = ma;
          ctx.fillStyle = "#CFE0F2";
          ctx.beginPath();
          ctx.ellipse(moonlight.x + mox + Math.sin(now * 0.0009 + md * 12) * 4, my2, moonlight.r * (0.10 + mr() * 0.4), 0.8, 0, 0, 6.283);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.restore(); ctx.globalAlpha = 1;
    }

    /* long flat ripples, so the whole lake reads as water */
    ctx.save();
    ctx.beginPath(); ctx.rect(0, hy, W, H - hy); ctx.clip();
    var rr = mulberry(9091);
    ctx.fillStyle = rgba(mix(P.hor, [255, 255, 255], 0.35), 1);
    for (var rp = 0, rpN = Math.round((fine ? 46 : 24) * quality); rp < rpN; rp++) {
      var rd = rr(), ry = hy + rd * rd * (H - hy), rx = rr() * W;
      ctx.globalAlpha = (0.05 + 0.07 * (1 - rd)) * (0.5 + 0.5 * (1 - wx.grey));
      ctx.beginPath();
      ctx.ellipse(rx + Math.sin(now * 0.0006 + rp) * 5 * (0.5 + windK), ry, 20 + rr() * 120, 0.8, 0, 0, 6.283);
      ctx.fill();
    }

    /* rain hitting the water */
    for (var sp2 = splashes.length - 1; sp2 >= 0; sp2--) {
      var s2 = splashes[sp2];
      s2.age += 0.055;
      if (s2.age >= 1) { splashes.splice(sp2, 1); continue; }
      ctx.globalAlpha = (1 - s2.age) * 0.30;
      ctx.strokeStyle = rgba(mix(P.hor, [255, 255, 255], 0.5), 1);
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.ellipse(s2.x, s2.y, 2 + s2.age * 13, (2 + s2.age * 13) * 0.28, 0, 0, 6.283);
      ctx.stroke();
    }
    ctx.restore(); ctx.globalAlpha = 1;

    /* the near shore, and its pines, leaning on the wind */
    var shoreY = H * 0.905;
    var shoreCol = mix(P.ink, [0, 0, 0], 0.52);
    ctx.fillStyle = rgba(shoreCol, 1);
    ctx.beginPath();
    ctx.moveTo(0, H); ctx.lineTo(0, shoreY + 14);
    for (var xs = 0; xs <= W; xs += 40) {
      ctx.lineTo(xs, shoreY + Math.sin(xs * 0.011 + 1.4) * 7 + Math.sin(xs * 0.037) * 3);
    }
    ctx.lineTo(W, H); ctx.closePath(); ctx.fill();

    var prn = mulberry(7717);
    for (var tr = 0; tr < 14; tr++) {
      var tx = prn() * W, th = 22 + prn() * 34, tw2 = th * 0.30;
      var ty = shoreY + Math.sin(tx * 0.011 + 1.4) * 7 - 2;
      var sway = Math.sin(now * 0.0013 + tx * 0.02) * windK * 5;
      ctx.beginPath();
      ctx.moveTo(tx + sway, ty - th);
      ctx.lineTo(tx + tw2, ty + 2);
      ctx.lineTo(tx - tw2, ty + 2);
      ctx.closePath(); ctx.fill();
    }

    /* fireflies — fair weather only */
    var flyA = clamp((night - 0.35) / 0.65, 0, 1) * (1 - clamp(wx.rain * 2, 0, 1)) * (1 - wx.fog);
    if (flyA > 0.02) {
      ctx.fillStyle = "#FFD98A";
      for (var fi = 0; fi < flies.length; fi++) {
        var fy = flies[fi];
        ctx.globalAlpha = flyA * (0.35 + 0.65 * Math.abs(Math.sin(now * 0.0016 * fy.sp + fy.ph)));
        ctx.beginPath();
        ctx.arc((fy.x + Math.sin(now * 0.0004 * fy.sp + fy.ph) * 0.02) * W,
                fy.y * H + Math.cos(now * 0.0006 * fy.sp + fy.ph) * 9, fy.r, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    /* ---- weather over the top of all of it ---- */
    var slant = clamp(wind / 26, 0, 1.5);

    if (wx.fog > 0.01) {
      for (var fg = 0; fg < 3; fg++) {
        var fyy = hy - H * (0.02 + fg * 0.055) + Math.sin(now * 0.0002 + fg) * 6;
        var fgg = ctx.createLinearGradient(0, fyy - H * 0.10, 0, fyy + H * 0.06);
        fgg.addColorStop(0, "rgba(206,209,214,0)");
        fgg.addColorStop(0.5, "rgba(206,209,214," + wx.fog * (0.16 - fg * 0.035) + ")");
        fgg.addColorStop(1, "rgba(206,209,214,0)");
        ctx.fillStyle = fgg;
        ctx.fillRect(0, fyy - H * 0.10, W, H * 0.16);
      }
    }

    if (drops.length) {
      ctx.strokeStyle = "rgba(206,222,238,0.55)";
      ctx.lineCap = "round";
      for (var dd = 0; dd < drops.length; dd++) {
        var dr = drops[dd];
        if (!reduced) {
          dr.y += dr.sp * dr.z * (0.7 + wx.rain * 0.9);
          dr.x += dr.sp * dr.z * slant * 0.42;
          if (dr.y > 1) {
            dr.y -= 1.05; dr.x = Math.random();
            if (Math.random() < 0.14 && splashes.length < 40) {
              splashes.push({ x: Math.random() * W, y: hy + Math.random() * (H - hy), age: 0 });
            }
          }
          if (dr.x > 1.1) dr.x -= 1.2; else if (dr.x < -0.1) dr.x += 1.2;
        }
        var dx0 = dr.x * W, dy0 = dr.y * H;
        ctx.globalAlpha = (0.22 + dr.z * 0.50) * (0.45 + 0.55 * wx.rain);
        ctx.lineWidth = 0.7 + dr.z * 0.9;
        ctx.beginPath();
        ctx.moveTo(dx0, dy0);
        ctx.lineTo(dx0 + dr.len * slant * 0.5, dy0 + dr.len * dr.z);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    if (flakes.length) {
      ctx.fillStyle = "#EFF4FA";
      for (var fk = 0; fk < flakes.length; fk++) {
        var fl2 = flakes[fk];
        if (!reduced) {
          fl2.y += fl2.sp;
          fl2.x += Math.sin(now * 0.0006 * fl2.sw + fl2.ph) * 0.0009 + slant * 0.0007;
          if (fl2.y > 1) { fl2.y -= 1.04; fl2.x = Math.random(); }
          if (fl2.x > 1.05) fl2.x -= 1.1; else if (fl2.x < -0.05) fl2.x += 1.1;
        }
        ctx.globalAlpha = 0.45 + 0.45 * Math.sin(now * 0.001 + fl2.ph);
        ctx.beginPath(); ctx.arc(fl2.x * W, fl2.y * H, fl2.r, 0, 6.283); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (wx.storm > 0.05 && !reduced) {
      if (now > nextBolt) {
        nextBolt = now + 3200 + Math.random() * 9000 / Math.max(wx.storm, 0.2);
        fireLightning(now);
      }
      if (bolt) {
        bolt.life -= 0.085;
        if (bolt.life <= 0) bolt = null;
        else {
          ctx.strokeStyle = "rgba(226,240,255," + clamp(bolt.life, 0, 1) * 0.9 + ")";
          ctx.lineWidth = 1.6 + bolt.life * 1.6; ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(bolt.pts[0][0], bolt.pts[0][1]);
          for (var bp = 1; bp < bolt.pts.length; bp++) ctx.lineTo(bolt.pts[bp][0], bolt.pts[bp][1]);
          ctx.stroke();
        }
      }
    }
    if (flash > 0.001) {
      flash *= 0.80;
      ctx.fillStyle = "rgba(214,232,255," + flash * 0.34 + ")";
      ctx.fillRect(0, 0, W, H);
    }

    /* vignette, so the type always has something to sit on */
    var vg = ctx.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.22, W * 0.5, H * 0.5, Math.max(W, H) * 0.82);
    vg.addColorStop(0, "rgba(4,8,18,0)");
    vg.addColorStop(1, "rgba(4,8,18," + (0.42 + tShown * 0.20) + ")");
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }

  var lastNow = 0;
  /* A rolling look at how long frames are taking. Judged on the median of a
     window rather than the mean, so one long garbage collection or a
     backgrounded tab does not permanently demote the scene. */
  var window60 = [], lastTune = 0, lastPainted = -1, calibrated = false, running = false;

  /* The first verdict is a calibration, not a nudge: it happens early, while
     the splash is still up, and it jumps straight to a level rather than
     creeping down one step per second in front of the visitor. Everything
     after it is the gentle version, because by then the only thing that
     changes is how busy the device is. */
  var settleResolve;
  var settled = new Promise(function (res) { settleResolve = res; });

  function calibrate(median) {
    calibrated = true;
    quality = median > 40 ? 0.35
            : median > 30 ? 0.50
            : median > 23 ? 0.70
            : median > 18 ? 0.85
            : 1;
    resize();
    settleResolve(quality);
  }

  function tune(now, dt) {
    window60.push(dt * 16.667);

    var need = calibrated ? 45 : 22;
    var gap = calibrated ? 1200 : 480;
    if (window60.length < need) return;
    if (now - lastTune < gap) { if (window60.length > 90) window60.shift(); return; }
    lastTune = now;

    var sorted = window60.slice().sort(function (a, b) { return a - b; });
    var median = sorted[sorted.length >> 1];
    window60.length = 0;

    if (!calibrated) { calibrate(median); return; }

    var before = quality;
    if (median > 22 && quality > 0.35) quality = Math.max(0.35, quality - 0.15);
    else if (median < 15 && quality < 1) quality = Math.min(1, quality + 0.08);
    /* Only the pixel budget needs the canvas rebuilding; the rest is read
       per frame. Redo it on a real change, not on floating-point noise. */
    if (Math.abs(quality - before) > 0.001) resize();
  }

  /* Every ease here is per-second, not per-frame: a 120 Hz laptop and a
     throttled phone have to arrive at the same colour at the same moment,
     and a frame-counted lerp does not. */
  function approach(current, target, perFrameRate, dt) {
    if (reduced) return target;
    var k = 1 - Math.pow(1 - perFrameRate, dt);
    return current + (target - current) * k;
  }

  function step(now) {
    var dt = lastNow ? Math.min(60, now - lastNow) / 16.667 : 1;
    lastNow = now;
    if (!reduced) tune(now, dt);

    /* the dial wins if it has been touched; otherwise the scroll runs the
       evening forward from wherever the real sky left it */
    var target = tDial === null ? (tBase + (1 - tBase) * tScroll) : tDial;
    tShown = approach(tShown, target, 0.09, dt);
    if (Math.abs(target - tShown) < 0.0006) tShown = target;

    for (var k in wxTarget) {
      if (!Object.prototype.hasOwnProperty.call(wxTarget, k)) continue;
      wx[k] = approach(wx[k], wxTarget[k], 0.035, dt);
      if (Math.abs(wxTarget[k] - wx[k]) < 0.0015) wx[k] = wxTarget[k];
    }
    stockPrecipitation();

    pointer.x = approach(pointer.x, pointer.tx, 0.06, dt);
    pointer.y = approach(pointer.y, pointer.ty, 0.06, dt);

    if (!reduced || dirty || tShown !== lastPainted) {
      paint(now);
      lastPainted = tShown;
      dirty = false;
    }
    requestAnimationFrame(step);
  }


  /* ---------- the public face ---------- */
  var sky = {
    HORIZON: HORIZON,

    /* Set up, but do not start drawing. Whoever mounts the scene decides
       when it begins — during the splash the main thread belongs to the
       logo, and a canvas repainting behind an opaque black rectangle would
       only stutter the one thing anybody can see. */
    mount: function (el) {
      canvas = el;
      ctx = canvas.getContext("2d");
      seedScene();
      resize();
      if (reduced) { calibrated = true; settleResolve(quality); }
      global.addEventListener("resize", resize);
      return sky;
    },

    start: function () {
      if (running) return sky;
      running = true;
      requestAnimationFrame(step);
      return sky;
    },

    /* A bounded burst of the real thing: the actual paint, at the actual
       size, on the actual device — not a synthetic benchmark that resembles
       it. Runs behind the splash, where a dropped frame costs nothing, and
       stops at eighteen frames or 600 ms, whichever comes first, so a slow
       phone is not punished with a long one. */
    probe: function () {
      if (reduced) return Promise.resolve(quality);
      return new Promise(function (resolve) {
        var frames = [], began = performance.now(), prev = began;
        function burst(now) {
          paint(now);
          frames.push(now - prev);
          prev = now;
          if (frames.length < 18 && now - began < 600) { requestAnimationFrame(burst); return; }
          /* the first frame includes one-time setup; it is not the device */
          frames.shift();
          frames.sort(function (a, b) { return a - b; });
          calibrate(frames.length ? frames[frames.length >> 1] : 16);
          resolve(quality);
        }
        requestAnimationFrame(burst);
      });
    },

    /* 0 = golden hour, 1 = deep night. `base` is where the real sky starts
       the page; `scroll` walks from there to night; `dial` overrides both. */
    setBase: function (v) { tBase = clamp(v, 0, 0.98); dirty = true; },
    setScroll: function (v) { tScroll = clamp(v, 0, 1); dirty = true; },
    setDial: function (v) { tDial = v === null ? null : clamp(v, 0, 1); dirty = true; },
    dialled: function () { return tDial !== null; },
    t: function () { return tShown; },
    /* what the dial would read right now if it were following along */
    auto: function () { return tBase + (1 - tBase) * tScroll; },

    pointer: function (x, y) { pointer.tx = x; pointer.ty = y; dirty = true; },

    setMoonPhase: function (p) { moonPhase = p; dirty = true; },

    /* what the scene decided it could afford — read by the splash and the tests */
    quality: function () { return quality; },
    /* resolves once the first measurement has been made */
    tuned: function () { return settled; },

    /* The forecast, reduced to what a canvas can draw. */
    setWeather: function (s) {
      dirty = true;
      if (!s) {
        wxTarget = { rain: 0, snow: 0, fog: 0, storm: 0, cloud: 0.22, grey: 0, wind: 8 };
        return;
      }
      var icon = s.icon;
      var rain = icon === "drizzle" ? 0.34 : icon === "rain" ? 0.66 :
                 icon === "heavy-rain" ? 1 : icon === "thunder" ? 0.88 : 0;
      var snow = icon === "snow" ? 0.75 : 0;
      var fog = icon === "fog" ? 0.85 : 0;
      var storm = icon === "thunder" ? 1 : 0;
      var cloud = Math.max(s.cloud || 0, rain > 0 ? 0.82 : 0, snow > 0 ? 0.8 : 0, fog > 0 ? 0.55 : 0);
      wxTarget = {
        rain: rain, snow: snow, fog: fog, storm: storm, cloud: cloud,
        grey: clamp(Math.max(rain * 0.9, snow * 0.6, fog * 0.8, storm,
                             Math.max(0, (cloud - 0.5) / 0.5) * 0.75), 0, 1),
        wind: s.wind == null ? 8 : s.wind
      };
      if (s.moon) moonPhase = s.moon.phase;
    },
    weather: function () { return wx; },
    onlightning: function (fn) { lightningHandlers.push(fn); },

    /* Click the sky: a flock takes off while there is still light, a meteor
       once there isn't. */
    poke: function (px, py) {
      dirty = true;
      var rnd = mulberry((Date.now() & 0xffff) + (px | 0));
      if (tShown < 0.62) {
        var fl = makeFlock(rnd, false);
        fl.x = px / W; fl.y = clamp(py / H, 0.06, 0.55);
        fl.v = (rnd() < 0.5 ? -1 : 1) * (0.02 + rnd() * 0.02);
        flocks.push(fl);
        if (flocks.length > 9) flocks.shift();
        return "birds";
      }
      shooters.push({ x: px, y: py, vx: (2.6 + rnd() * 3) * (rnd() < 0.5 ? -1 : 1), vy: 1.6 + rnd() * 2.2, life: 1 });
      return "meteor";
    }
  };

  NJ.sky = sky;
})(window);

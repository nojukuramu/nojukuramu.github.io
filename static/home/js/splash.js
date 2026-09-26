/* ============================================================
   nojukuramu — the splash

   The logo writes itself: a spark runs the outline of the square, a pen of
   light writes the four Poppins outlines in turn and sheds embers as it
   goes, the gold floods in with a shine across it and a ring of light
   leaving it — and then the mark flies up into its place in the header as
   the curtain lifts. Every one of those beats has a sound, and the two are
   not merely started together: they are the same plan.

   One plan, one clock. The plan is a list of moments in milliseconds. The
   drawing is not a set of CSS transitions left to run; it is computed each
   frame from the clock, so a stalled frame is dropped, never late. The
   sound (ambience.js) takes the same plan and books each beat on the audio
   clock for the moment it will be *heard* — output latency included, which
   on Bluetooth headphones is a fifth of a second — and the drawing waits
   that long before it starts, so the first frame and the first sound meet.
   The nib's scratch follows the pen's speed curve, the very curve that
   moves the pen and throws its embers, so the loudest scratch is the
   fastest stroke. The bell rings on the frame its letter lands.

   On a cold load browsers refuse audio until the visitor does something,
   so most first visits are silent: nothing is faked, and nothing is queued
   to startle anyone later. But the drawing keeps asking, and if a gesture
   arrives part-way through, the sound joins at the beat the picture has
   reached rather than never. "Replay the intro" in the search palette is a
   click, so it always has its sound.

   The order still matters. The first thing that happens is a short burst
   of the sky's real rendering behind the black (NJ.sky.probe) to decide
   how much drawing this device can afford; only then, on a quiet main
   thread, does the writing start. While the probe runs, the only things
   moving — the ember waiting at the corner of the square and the gauge
   under it — are compositor animations, so the measurement is not
   disturbed and they are not starved by it.

   If this file never loads, a CSS animation clears the splash on its own a
   few seconds in, so a failed script can never leave a black page. Once it
   has loaded it takes over that job itself, with a timer of its own.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var splash = document.getElementById("splash");
  if (!splash) return;

  /* The hero's words wait under `.intro` and rise on `.splashed`, so they
     arrive as the curtain lifts instead of finishing unseen behind it.
     `.splashed` is also set on a timer of its own here, independent of
     run() ever being called, so nothing can leave the headline hidden. */
  var docEl = document.documentElement;
  docEl.classList.add("intro");
  splash.classList.add("managed");
  setTimeout(function () { docEl.classList.add("splashed"); }, 6000);

  var mark = splash.querySelector(".splash-mark");
  var plate = splash.querySelector(".splash-plate");
  var ink = splash.querySelector(".splash-ink");
  var glyphs = ink ? Array.prototype.slice.call(ink.querySelectorAll("path")) : [];
  var gauge = document.getElementById("splash-gauge-fill");
  var ember = splash.querySelector(".splash-ember");
  var fx = splash.querySelector(".splash-fx");
  var fctx = fx && fx.getContext ? fx.getContext("2d") : null;

  /* ---------- the plan ----------
     Milliseconds from the first frame. The letters start while the square
     is still closing, so the two read as one gesture. */
  var PLATE = 480;        /* the spark round the square */
  var LEAD_IN = 300;      /* first letter starts */
  var STAGGER = 130;      /* between letters */
  var DRAW = 500;         /* each letter */
  var GAP = 50;           /* last bell to the flood */
  var SHINE = 720;        /* the shine crossing the letters */
  var SETTLE = 440;       /* a breath with it finished, before it leaves */
  var FLY = 780;          /* up into the header */
  var MIN_SHOW = reduced ? 400 : 1150;   /* never blink past too fast to read */
  var MAX_SHOW = 4600;                   /* never hold the page hostage */

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* CSS's cubic-bezier(), so the drawing can use the same curves the
     stylesheet does and ask them for their speed. */
  function bezier(x1, y1, x2, y2) {
    function A(a, b) { return 1 - 3 * b + 3 * a; }
    function B(a, b) { return 3 * b - 6 * a; }
    function C(a) { return 3 * a; }
    function at(t, a, b) { return ((A(a, b) * t + B(a, b)) * t + C(a)) * t; }
    function slope(t, a, b) { return 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a); }
    return function (x) {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      var t = x;
      for (var i = 0; i < 8; i++) {
        var s = slope(t, x1, x2);
        if (Math.abs(s) < 1e-6) break;
        t -= (at(t, x1, x2) - x) / s;
      }
      if (!(t >= 0 && t <= 1) || Math.abs(at(t, x1, x2) - x) > 1e-4) {
        var lo = 0, hi = 1;
        t = x;
        for (var j = 0; j < 32; j++) {
          var v = at(t, x1, x2);
          if (Math.abs(v - x) < 1e-5) break;
          if (v < x) lo = t; else hi = t;
          t = (lo + hi) / 2;
        }
      }
      return at(t, y1, y2);
    };
  }
  var pen = bezier(0.62, 0.03, 0.32, 1);    /* a letter: a slow start, a fast middle, a careful finish */
  var round = bezier(0.45, 0.05, 0.25, 1);  /* the square: steadier */
  var soft = bezier(0.22, 1, 0.36, 1);

  /* The pen's speed across a stroke, 0..1, sampled. The sound's nib is
     shaped by exactly this, and so are the spark and its embers. */
  var SPEED = (function () {
    var n = 40, out = [], max = 0, i;
    for (i = 0; i < n; i++) {
      var x = i / (n - 1);
      var v = pen(Math.min(1, x + 0.012)) - pen(Math.max(0, x - 0.012));
      out.push(v);
      if (v > max) max = v;
    }
    for (i = 0; i < n; i++) out[i] = max ? out[i] / max : 0;
    out[0] = 0; out[n - 1] = 0;
    return out;
  })();
  function speedAt(x) {
    var f = clamp(x, 0, 1) * (SPEED.length - 1), i = Math.floor(f);
    return i >= SPEED.length - 1 ? SPEED[i] : SPEED[i] + (SPEED[i + 1] - SPEED[i]) * (f - i);
  }

  function makePlan() {
    var letters = glyphs.map(function (_, i) { return { at: LEAD_IN + i * STAGGER, dur: DRAW }; });
    var last = letters.length ? letters[letters.length - 1] : { at: 0, dur: PLATE };
    var flood = last.at + last.dur + GAP;
    return {
      plate: { at: 0, dur: PLATE },
      letters: letters,
      flood: flood,
      shine: SHINE,
      end: flood + SETTLE,
      speed: SPEED
    };
  }

  /* The ember waits exactly where the spark will set off from: the start
     of the square's own outline, wherever the browser says that is. */
  (function () {
    if (!ember || !plate) return;
    var x = 118, y = 6;
    try { var p0 = plate.getPointAtLength(0); x = p0.x; y = p0.y; } catch (e) {}
    ember.style.left = (x / 512 * 100).toFixed(2) + "%";
    ember.style.top = (y / 512 * 100).toFixed(2) + "%";
  })();

  var sprite = null;
  function glowSprite() {
    if (sprite) return sprite;
    sprite = document.createElement("canvas");
    sprite.width = sprite.height = 64;
    var g = sprite.getContext("2d");
    var gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, "rgba(255,246,226,1)");
    gr.addColorStop(0.18, "rgba(255,217,138,.75)");
    gr.addColorStop(0.5, "rgba(245,168,60,.22)");
    gr.addColorStop(1, "rgba(245,168,60,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return sprite;
  }

  /* ---------- a run ---------- */
  var state = null;

  function run(hooks) {
    if (state && !state.done) return;
    hooks = hooks || {};
    reset();
    var st = state = {
      hooks: hooks, started: performance.now(), start: 0, plan: makePlan(),
      cue: null, flightCue: null, exiting: false, done: false, raf: 0, last: 0,
      parts: [], flashes: [], fired: {}, acc: 0, geo: null
    };

    wakeAudio();

    if (gauge && !reduced) {
      gauge.style.transition = "transform 420ms cubic-bezier(.3,.7,.3,1)";
      requestAnimationFrame(function () { gauge.style.transform = "scaleX(.55)"; });
    }

    var probe = hooks.probe ? hooks.probe() : Promise.resolve(null);
    /* never wait on a probe that has hung */
    var raced = Promise.race([
      probe,
      new Promise(function (res) { setTimeout(function () { res(null); }, 1800); })
    ]);

    raced.catch(function () { return null; }).then(function (quality) {
      if (st !== state || st.exiting) return;
      if (quality != null) splash.dataset.quality = (+quality).toFixed(2);
      if (gauge) {
        gauge.style.transition = "transform 320ms cubic-bezier(.22,1,.36,1)";
        gauge.style.transform = "scaleX(1)";
      }
      /* A replay comes from a click, but resume() is asynchronous: give the
         audio clock a moment to come up so the first beat is not lost. A
         cold load has no gesture to wait for, so it does not wait. */
      var ready = hooks.replay && NJ.ambience && NJ.ambience.wake ? NJ.ambience.wake(320) : Promise.resolve();
      return ready.then(function () { if (st === state && !st.exiting) write(st); });
    });

    /* Whatever happens — a thrown hook, a stalled promise — the page is
       never left behind a black rectangle, and the scene still starts. */
    st.safety = setTimeout(function () { if (st === state) leave(st); }, MAX_SHOW);
  }

  /* Try to bring the audio clock up now; a visitor who moves, scrolls or
     types before or during the writing hands it the gesture it needs, and
     the drawing's own loop notices and brings the sound in. */
  var unlockArmed = false;
  function wakeAudio() {
    if (!NJ.ambience || !NJ.ambience.ensure) return;
    NJ.ambience.ensure();
    if (unlockArmed) return;
    unlockArmed = true;
    var unlock = function () { if (state && !state.done && NJ.ambience.ensure) NJ.ambience.ensure(); };
    ["pointerdown", "pointermove", "wheel", "touchstart", "keydown"].forEach(function (ev) {
      document.addEventListener(ev, unlock, { passive: true });
    });
  }

  function reset() {
    splash.style.display = "";
    splash.removeAttribute("aria-hidden");
    ["gone", "lifting", "grounded", "writing", "filling", "plated", "still", "sparked", "closed"].forEach(function (c) {
      splash.classList.remove(c);
    });
    if (mark && mark.getAnimations) mark.getAnimations().forEach(function (a) { a.cancel(); });
    glyphs.forEach(function (p) { p.removeAttribute("style"); });
    if (plate) plate.removeAttribute("style");
    if (gauge) { gauge.style.transition = "none"; gauge.style.transform = "scaleX(0)"; void gauge.offsetWidth; }
    if (fctx && fx.width) fctx.clearRect(0, 0, fx.width, fx.height);
  }

  /* ---------- the writing ---------- */
  function write(st) {
    splash.classList.add("writing");
    if (reduced || !glyphs.length || !plate) {
      /* nothing to write when motion is not wanted: it is simply there */
      splash.classList.add("still", "plated", "filling", "sparked", "closed");
      setTimeout(function () { if (st === state) leave(st); },
                 Math.max(120, MIN_SHOW - (performance.now() - st.started)));
      return;
    }
    prime(st);
    measure(st);
    splash.classList.add("plated");

    /* Start late by exactly the speakers' lag, so the first spark and the
       first sound arrive together. */
    var lat = NJ.ambience && NJ.ambience.latency ? NJ.ambience.latency() : 0;
    st.start = performance.now() + 40 + lat;
    st.cue = cue(st);

    var loop = function (now) {
      if (st !== state || st.done) return;
      frame(st, now);
      st.raf = requestAnimationFrame(loop);
    };
    st.raf = requestAnimationFrame(loop);
  }

  function cue(st) {
    if (reduced || !NJ.ambience || !NJ.ambience.logo) return null;
    return NJ.ambience.logo(st.plan, st.start) || null;
  }

  function prime(st) {
    st.lens = glyphs.map(function (p) {
      var len;
      try { len = p.getTotalLength(); } catch (e) { len = 900; }
      /* a little slack, so the dash clears the join it started from */
      return Math.ceil(len) + 4;
    });
    try { st.plateLen = Math.ceil(plate.getTotalLength()) + 2; } catch (e) { st.plateLen = 1810; }
    glyphs.forEach(function (p, i) {
      p.style.strokeDasharray = st.lens[i];
      p.style.strokeDashoffset = st.lens[i];
      p.style.fillOpacity = "0";
    });
    plate.style.strokeDasharray = st.plateLen;
    plate.style.strokeDashoffset = st.plateLen;
    /* the four letters as one clip, for the shine */
    try { st.clip = new Path2D(glyphs.map(function (p) { return p.getAttribute("d"); }).join(" ")); } catch (e) { st.clip = null; }
  }

  /* Where the SVG's user units land on the effects canvas, which sits
     centred over the mark and overhangs it for the ring and the embers. */
  function measure(st) {
    if (!fx || !fctx) return;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var fr = fx.getBoundingClientRect(), mr = mark.getBoundingClientRect();
    fx.width = Math.max(1, Math.round(fr.width * dpr));
    fx.height = Math.max(1, Math.round(fr.height * dpr));
    var m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    try { var cons = ink.transform.baseVal.consolidate(); if (cons) m = cons.matrix; } catch (e) {}
    st.geo = {
      dpr: dpr, w: fr.width, h: fr.height, k: mr.width / 512, s: mr.width,
      ox: mr.left - fr.left, oy: mr.top - fr.top, m: m,
      cx: mr.left - fr.left + mr.width / 2, cy: mr.top - fr.top + mr.height / 2
    };
  }
  global.addEventListener("resize", function () { if (state && !state.done && state.geo) measure(state); });

  function fromBox(g, x, y) { return [g.ox + x * g.k, g.oy + y * g.k]; }
  function fromGlyph(g, x, y) {
    var m = g.m;
    return fromBox(g, m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f);
  }

  /* ---------- a frame ---------- */
  function frame(st, now) {
    var t = now - st.start;
    var dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 1 / 60;
    st.last = now;
    var P = st.plan;

    /* the sound joins late if the gesture arrived late */
    if (!st.cue && !st.exiting && t < P.flood && NJ.ambience && NJ.ambience.ready && NJ.ambience.ready()) {
      st.cue = cue(st);
    }

    var g = st.geo;
    if (g) {
      fctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
      fctx.clearRect(0, 0, g.w, g.h);
    }

    if (t >= 0 && !st.exiting) {
      /* the waiting ember hands over to the spark on the spark's first frame */
      if (!st.fired.spark) { st.fired.spark = 1; splash.classList.add("sparked"); }
      /* the square, run round by the spark */
      var praw = clamp(t / P.plate.dur, 0, 1), pp = round(praw);
      plate.style.strokeDashoffset = (st.plateLen * (1 - pp)).toFixed(1);
      if (g && praw > 0 && praw < 1) {
        var q = pointOn(plate, st.plateLen * pp);
        if (q) {
          var c = fromBox(g, q.x, q.y);
          spark(c, 0.95);
          shed(st, c, 0.55, dt);
        }
      }
      if (praw >= 1 && !st.fired.closed) {
        st.fired.closed = 1;
        splash.classList.add("closed");
        var s0 = pointOn(plate, 0);
        if (g && s0) flash(st, fromBox(g, s0.x, s0.y), 0.8, 6);
      }

      /* the letters, written by the pen */
      glyphs.forEach(function (p, i) {
        var L = P.letters[i];
        var raw = clamp((t - L.at) / L.dur, 0, 1), lp = pen(raw);
        p.style.strokeDashoffset = (st.lens[i] * (1 - lp)).toFixed(1);
        if (g && raw > 0 && raw < 1) {
          var q2 = pointOn(p, st.lens[i] * lp);
          if (q2) {
            var c2 = fromGlyph(g, q2.x, q2.y);
            var v = speedAt(raw);
            spark(c2, 0.65 + 0.55 * v);
            shed(st, c2, v, dt);
            st.tip = c2;
          }
        }
        /* the frame the bell rings */
        if (raw >= 1 && !st.fired["l" + i]) {
          st.fired["l" + i] = 1;
          if (g && st.tip) flash(st, st.tip, 1, 8);
        }
      });

      /* the flood */
      var ft = t - P.flood;
      if (ft >= 0) {
        if (!st.fired.flood) {
          st.fired.flood = 1;
          splash.classList.add("filling");
          if (g) burst(st);
        }
        var fp = soft(clamp(ft / 520, 0, 1)).toFixed(3);
        glyphs.forEach(function (p) { p.style.fillOpacity = fp; });
        if (g) {
          ring(g, clamp(ft / 900, 0, 1), 1);
          ring(g, clamp((ft - 140) / 1000, 0, 1), 0.45);
          var sp = clamp((ft - 40) / P.shine, 0, 1);
          if (sp > 0 && sp < 1 && st.clip) shine(st, g, sp);
        }
      }
    }

    if (g) particles(st, g, dt);

    if (!st.exiting && t >= P.end && now - st.started >= MIN_SHOW) leave(st);
  }

  function pointOn(el, len) {
    try { return el.getPointAtLength(len); } catch (e) { return null; }
  }

  /* ---------- the light ---------- */
  function spark(c, k) {
    var s = 30 * k;
    fctx.globalCompositeOperation = "lighter";
    fctx.globalAlpha = 0.95;
    fctx.drawImage(glowSprite(), c[0] - s / 2, c[1] - s / 2, s, s);
    fctx.globalAlpha = 1;
    fctx.fillStyle = "#FFF8EC";
    fctx.beginPath(); fctx.arc(c[0], c[1], 1.6 + k, 0, 6.283); fctx.fill();
    fctx.globalCompositeOperation = "source-over";
  }

  /* embers thrown off the pen, more of them the faster it moves */
  function shed(st, c, v, dt) {
    st.acc += (8 + v * 70) * dt;
    while (st.acc >= 1) {
      st.acc -= 1;
      var a = Math.random() * 6.283, sp = 12 + Math.random() * 38 * (0.4 + v);
      st.parts.push({ x: c[0], y: c[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 14,
                      life: 0.45 + Math.random() * 0.55, age: 0, r: 0.6 + Math.random() * 1.1 });
    }
    if (st.parts.length > 320) st.parts.splice(0, st.parts.length - 320);
  }

  function flash(st, c, k, n) {
    st.flashes.push({ x: c[0], y: c[1], age: 0, life: 0.32, k: k });
    for (var i = 0; i < n; i++) {
      var a = (i / n) * 6.283 + Math.random() * 0.4, sp = 40 + Math.random() * 50;
      st.parts.push({ x: c[0], y: c[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                      life: 0.35 + Math.random() * 0.3, age: 0, r: 0.8 + Math.random() * 0.8 });
    }
  }

  /* the flood throws embers off every letter, outward from the middle */
  function burst(st) {
    var g = st.geo;
    for (var i = 0; i < 46; i++) {
      var gi = (Math.random() * glyphs.length) | 0;
      var q = pointOn(glyphs[gi], Math.random() * st.lens[gi]);
      if (!q) continue;
      var c = fromGlyph(g, q.x, q.y);
      var dx = c[0] - g.cx, dy = c[1] - g.cy, d = Math.sqrt(dx * dx + dy * dy) || 1;
      var sp = 50 + Math.random() * 150;
      st.parts.push({ x: c[0], y: c[1], vx: dx / d * sp, vy: dy / d * sp - 10,
                      life: 0.7 + Math.random() * 0.7, age: 0, r: 0.7 + Math.random() * 1.4 });
    }
    st.flashes.push({ x: g.cx, y: g.cy, age: 0, life: 0.6, k: 4.2 });
  }

  function ring(g, p, strength) {
    if (p <= 0 || p >= 1) return;
    var e = soft(p);
    var r = g.s * 0.51 * (1 + e * 1.05);
    fctx.globalCompositeOperation = "lighter";
    fctx.strokeStyle = "rgba(255,209,143," + (0.55 * strength * Math.pow(1 - p, 1.6)).toFixed(3) + ")";
    fctx.lineWidth = 0.4 + 2.6 * (1 - p);
    var rr = g.s * 0.22 * (1 + e * 0.5);
    /* a rounded square, like the plate it leaves, loosening as it grows */
    fctx.beginPath();
    if (fctx.roundRect) fctx.roundRect(g.cx - r, g.cy - r, r * 2, r * 2, rr);
    else fctx.arc(g.cx, g.cy, r, 0, 6.283);
    fctx.stroke();
    fctx.globalCompositeOperation = "source-over";
  }

  /* a band of light crossing the letters, clipped to them */
  function shine(st, g, p) {
    var m = g.m, d = g.dpr, k = g.k;
    fctx.save();
    fctx.setTransform(d * k * m.a, d * k * m.b, d * k * m.c, d * k * m.d, d * (g.ox + k * m.e), d * (g.oy + k * m.f));
    fctx.clip(st.clip);
    fctx.setTransform(d, 0, 0, d, 0, 0);
    var bx = g.ox + g.s * (-0.35 + 1.7 * p), by = g.oy + g.s * 0.5, w = g.s * 0.16;
    var gr = fctx.createLinearGradient(bx - w, by - w, bx + w, by + w);
    gr.addColorStop(0, "rgba(255,250,236,0)");
    gr.addColorStop(0.5, "rgba(255,250,236,.85)");
    gr.addColorStop(1, "rgba(255,250,236,0)");
    fctx.fillStyle = gr;
    fctx.fillRect(g.ox, g.oy, g.s, g.s);
    fctx.restore();
  }

  function particles(st, g, dt) {
    var sp = glowSprite();
    fctx.globalCompositeOperation = "lighter";
    for (var f = st.flashes.length - 1; f >= 0; f--) {
      var fl = st.flashes[f];
      fl.age += dt;
      if (fl.age >= fl.life) { st.flashes.splice(f, 1); continue; }
      var fa = 1 - fl.age / fl.life, fs = 26 * fl.k * (0.7 + 0.5 * (1 - fa));
      fctx.globalAlpha = fa * fa * 0.9;
      fctx.drawImage(sp, fl.x - fs / 2, fl.y - fs / 2, fs, fs);
    }
    for (var i = st.parts.length - 1; i >= 0; i--) {
      var pt = st.parts[i];
      pt.age += dt;
      if (pt.age >= pt.life) { st.parts.splice(i, 1); continue; }
      pt.vx *= Math.pow(0.35, dt);
      pt.vy = pt.vy * Math.pow(0.35, dt) + 70 * dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      var a = 1 - pt.age / pt.life, s = pt.r * 7;
      fctx.globalAlpha = a * a;
      fctx.drawImage(sp, pt.x - s / 2, pt.y - s / 2, s, s);
    }
    fctx.globalAlpha = 1;
    fctx.globalCompositeOperation = "source-over";
  }

  /* ---------- leaving ----------
     The mark flies up into the header's own mark as the curtain lifts, and
     lands exactly on it: the two are the same geometry, so when the splash
     goes the logo is simply already there. The flight is a Web Animation,
     which runs on the compositor — the scene starts at the same moment and
     cannot make it stutter. */
  function leave(st) {
    if (st.exiting || st.done) return;
    st.exiting = true;
    clearTimeout(st.safety);
    complete(st);

    var target = document.querySelector(".site-header .brand-mark svg");
    var from = mark ? mark.getBoundingClientRect() : null;
    var to = target ? target.getBoundingClientRect() : null;
    var canFly = !reduced && mark && mark.animate && from && to && to.width > 4 && from.width > 4;
    var lat = NJ.ambience && NJ.ambience.latency ? NJ.ambience.latency() : 0;
    var delay = 30 + lat;

    splash.classList.add("lifting");
    if (!canFly) splash.classList.add("grounded");
    docEl.classList.add("splashed");
    if (st.hooks.reveal) { try { st.hooks.reveal(); } catch (e) {} }

    if (!canFly) {
      setTimeout(function () { land(st, false); }, reduced ? 60 : 620);
      return;
    }

    var dx = (to.left + to.width / 2) - (from.left + from.width / 2);
    var dy = (to.top + to.height / 2) - (from.top + from.height / 2);
    var s = to.width / from.width;
    if (NJ.ambience && NJ.ambience.flight) {
      st.flightCue = NJ.ambience.flight(FLY, performance.now() + delay, clamp(dx / (global.innerWidth / 2), -1, 1));
    }

    /* an arc, not a line: it rises first and then drifts across, turning
       slightly on the way the way a thrown card does */
    var frames = [];
    for (var i = 0; i <= 10; i++) {
      var u = i / 10, iu = 1 - u;
      var x = 2 * iu * u * (dx * 0.12) + u * u * dx;
      var y = 2 * iu * u * (dy * 1.05) + u * u * dy;
      var sc = 1 + (s - 1) * Math.pow(u, 0.75);
      var rot = -9 * Math.sin(Math.PI * u);
      frames.push({ transform: "translate(" + x.toFixed(1) + "px," + y.toFixed(1) + "px) scale(" + sc.toFixed(4) + ") rotate(" + rot.toFixed(2) + "deg)" });
    }
    try {
      var anim = mark.animate(frames, { duration: FLY, delay: delay, easing: "cubic-bezier(.6,0,.22,1)", fill: "forwards" });
      anim.onfinish = function () { land(st, true); };
    } catch (e) { splash.classList.add("grounded"); }
    /* in case onfinish never comes */
    setTimeout(function () { land(st, true); }, delay + FLY + 450);
  }

  /* Cutting in early — a skip, the safety timer — still leaves on a
     finished logo rather than a half-written one. */
  function complete(st) {
    glyphs.forEach(function (p) { p.style.strokeDashoffset = "0"; p.style.fillOpacity = "1"; });
    if (plate) plate.style.strokeDashoffset = "0";
    splash.classList.add("plated", "writing", "filling", "sparked", "closed");
  }

  function land(st, flew) {
    if (st.done) return;
    st.done = true;
    cancelAnimationFrame(st.raf);
    splash.classList.add("gone");
    splash.setAttribute("aria-hidden", "true");
    splash.style.display = "none";
    if (mark && mark.getAnimations) mark.getAnimations().forEach(function (a) { a.cancel(); });
    if (flew) {
      var brand = document.querySelector(".site-header .brand");
      if (brand) {
        brand.classList.remove("landed");
        void brand.offsetWidth;
        brand.classList.add("landed");
        setTimeout(function () { brand.classList.remove("landed"); }, 900);
      }
    }
  }

  /* Click the curtain, or press Escape, Enter or Space, to get on with it.
     What the sound had booked is let go, so nothing rings over the page. */
  function skip() {
    var st = state;
    if (!st || st.done || st.exiting) return;
    if (st.cue && st.cue.stop) st.cue.stop();
    st.cue = true;
    leave(st);
  }
  splash.addEventListener("click", skip);
  document.addEventListener("keydown", function (e) {
    /* a key something else has already acted on — the palette's Enter that
       just asked for a replay, say — is not a request to skip it */
    if (e.defaultPrevented || !state || state.done || state.exiting) return;
    if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      skip();
    }
  });

  /* The whole thing again, on purpose. It comes from a click, so it gets
     its sound; there is no probe to run, and the headline rises again as
     the curtain lifts. */
  function replay() {
    if (state && !state.done) return;
    /* after the event that asked for it has finished, so the same key or
       click cannot also reach the skip */
    setTimeout(function () {
      if (state && !state.done) return;
      docEl.classList.remove("splashed");
      run({ replay: true });
    }, 0);
  }

  /* If run() is never called at all — home.js failed — the splash still
     goes, because the CSS failsafe was stood down when this file loaded. */
  setTimeout(function () {
    if (!state) {
      state = { hooks: {}, started: 0, plan: makePlan(), fired: {}, parts: [], flashes: [] };
      leave(state);
    }
  }, MAX_SHOW + 400);

  /* `speed` is the pen's speed curve, for anything else that writes the
     mark with the same stroke and wants its nib to match */
  NJ.splash = {
    run: run, finish: skip, replay: replay, speed: SPEED,
    /* the running plan and the moment its zero lands on the page's clock —
       read by the tests, which hold the sound up against it */
    timeline: function () { return state && state.plan ? { start: state.start, plan: state.plan } : null; }
  };
})(window);

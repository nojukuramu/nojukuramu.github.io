/* ============================================================
   nojukuramu — the sound of the place

   Wind, crickets, birds, rain, water and thunder, all synthesised in the
   browser: filtered noise and a few oscillators. There are no audio files
   in this repository, nothing to download, and the whole thing is a couple
   of kilobytes of code — which is the only version of this idea that
   belongs on a site with no build step.

   It follows the same scene the canvas does. Birds sing while there is
   light, crickets take over once it is dark, the wind rises with the
   forecast's wind speed, rain arrives when it is raining, and thunder is
   fired by the same lightning that flashes the sky.

   Off until asked. Browsers block audio without a gesture anyway, so this
   only ever starts from a click, and the choice is remembered.

   NJ.ambience.toggle() / .start() / .stop() / .on
   NJ.ambience.setScene({ t: 0..1, wind: km/h, rain: 0..1, storm: 0..1 })
   NJ.ambience.thunder()
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var KEY = "sky.sound";

  var AC = global.AudioContext || global.webkitAudioContext;
  var ctx = null, master = null, started = false, buffers = null;
  var nodes = {};
  var scene = { t: 0, wind: 8, rain: 0, storm: 0 };
  var timer = null, chirpTimer = null;
  var listeners = [];
  var lastTick = 0;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* A few seconds of noise on a loop is cheaper and calmer than a
     ScriptProcessor, and it never glitches under load. */
  function noiseBuffer(seconds, brownness) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0), last = 0, peak = 0, i;
    for (i = 0; i < len; i++) {
      var white = Math.random() * 2 - 1;
      last = (last + brownness * white) / (1 + brownness);
      d[i] = brownness > 0 ? last : white;
      if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]);
    }
    /* Normalised rather than scaled by a guessed constant: a random walk's
       peak is itself random, and a fixed multiplier puts samples past 1.0
       often enough to matter. */
    if (peak > 0) { var k = 0.9 / peak; for (i = 0; i < len; i++) d[i] *= k; }
    return buf;
  }

  /* Made once and shared. The logo cue needs noise before the ambience bed
     has ever been built, and rebuilding four seconds of it per voice would
     be an audible hitch. */
  function stock() {
    if (!buffers) buffers = { white: noiseBuffer(4, 0), brown: noiseBuffer(4, 0.06) };
    return buffers;
  }

  function looper(buf) {
    var src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.start();
    return src;
  }

  function gain(v) { var g = ctx.createGain(); g.gain.value = v; return g; }

  function ramp(param, to, seconds) {
    var now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(to, now + (seconds || 1.5));
  }

  function build() {
    master = gain(0);
    master.connect(ctx.destination);

    var brown = stock().brown;
    var white = stock().white;

    /* --- wind: brown noise under a lowpass that breathes --- */
    var windSrc = looper(brown);
    var windFilter = ctx.createBiquadFilter();
    windFilter.type = "lowpass"; windFilter.frequency.value = 420; windFilter.Q.value = 0.7;
    var windGain = gain(0.0);
    windSrc.connect(windFilter); windFilter.connect(windGain); windGain.connect(master);

    /* the gust: a slow oscillator opening and closing the filter */
    var gustLfo = ctx.createOscillator();
    gustLfo.frequency.value = 0.07;
    var gustAmt = gain(220);
    gustLfo.connect(gustAmt); gustAmt.connect(windFilter.frequency);
    gustLfo.start();

    var gustGain = ctx.createOscillator();
    gustGain.frequency.value = 0.11;
    var gustGainAmt = gain(0.10);
    gustGain.connect(gustGainAmt); gustGainAmt.connect(windGain.gain);
    gustGain.start();

    /* --- water: the lake, well below everything --- */
    var lakeSrc = looper(brown);
    var lakeFilter = ctx.createBiquadFilter();
    lakeFilter.type = "lowpass"; lakeFilter.frequency.value = 240;
    var lakeGain = gain(0.05);
    lakeSrc.connect(lakeFilter); lakeFilter.connect(lakeGain); lakeGain.connect(master);
    var lapLfo = ctx.createOscillator();
    lapLfo.frequency.value = 0.17;
    var lapAmt = gain(0.035);
    lapLfo.connect(lapAmt); lapAmt.connect(lakeGain.gain);
    lapLfo.start();

    /* --- rain: white noise, shaped so it hisses rather than roars --- */
    var rainSrc = looper(white);
    var rainHi = ctx.createBiquadFilter();
    rainHi.type = "highpass"; rainHi.frequency.value = 700;
    var rainBand = ctx.createBiquadFilter();
    rainBand.type = "lowpass"; rainBand.frequency.value = 5200;
    var rainGain = gain(0);
    rainSrc.connect(rainHi); rainHi.connect(rainBand); rainBand.connect(rainGain); rainGain.connect(master);

    nodes = { windGain: windGain, windFilter: windFilter, rainGain: rainGain,
              rainBand: rainBand, lakeGain: lakeGain };
  }

  /* Bring the audio clock up without building or starting the ambience bed.
     Browsers will not let this run before a gesture on a cold load, which is
     fine — everything that uses it checks `ready()` and stays quiet. */
  function ensure() {
    if (!AC) return null;
    if (!ctx) { try { ctx = new AC(); } catch (e) { return null; } }
    if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  /* --- crickets: a chirp is a high sine chopped by a fast gate --- */
  function cricket(when, pitch) {
    var osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = pitch;
    var g = gain(0);
    var chop = ctx.createOscillator();
    chop.type = "square";
    chop.frequency.value = 52;
    var chopAmt = gain(0.5);
    chop.connect(chopAmt); chopAmt.connect(g.gain);

    var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    osc.connect(g);
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; g.connect(pan); pan.connect(master); }
    else g.connect(master);

    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.055, when + 0.02);
    g.gain.setValueAtTime(0.055, when + 0.26);
    g.gain.linearRampToValueAtTime(0, when + 0.32);

    osc.start(when); chop.start(when);
    osc.stop(when + 0.36); chop.stop(when + 0.36);
  }

  /* --- birds: two or three whistled notes that glide --- */
  function bird(when) {
    var notes = 2 + ((Math.random() * 3) | 0);
    var base = 1900 + Math.random() * 1700;
    for (var i = 0; i < notes; i++) {
      var t0 = when + i * (0.09 + Math.random() * 0.07);
      var osc = ctx.createOscillator();
      osc.type = "sine";
      var f0 = base * (0.85 + Math.random() * 0.4);
      var f1 = f0 * (0.75 + Math.random() * 0.7);
      osc.frequency.setValueAtTime(f0, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 120), t0 + 0.07);
      var g = gain(0);
      var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      osc.connect(g);
      if (pan) { pan.pan.value = Math.random() * 1.4 - 0.7; g.connect(pan); pan.connect(master); }
      else g.connect(master);
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.10);
      osc.start(t0); osc.stop(t0 + 0.12);
    }
  }

  /* --- thunder: a low burst with a long tail --- */
  function thunder() {
    if (!started || !ctx) return;
    var when = ctx.currentTime + 0.35 + Math.random() * 1.6;   /* the sound is behind the light */
    var src = ctx.createBufferSource();
    src.buffer = stock().brown; src.loop = true;
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(320, when);
    lp.frequency.exponentialRampToValueAtTime(70, when + 2.6);
    var g = gain(0);
    src.connect(lp); lp.connect(g); g.connect(master);
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.32, when + 0.10);
    g.gain.exponentialRampToValueAtTime(0.0008, when + 2.8);
    src.start(when); src.stop(when + 3.0);
  }

  /* Chirps are scheduled from a loose timer rather than a strict grid —
     a metronome of crickets is worse than none. */
  function chirp() {
    if (!started) return;
    var night = clamp((scene.t - 0.42) / 0.38, 0, 1);
    var day = 1 - clamp((scene.t - 0.18) / 0.34, 0, 1);
    var quiet = clamp(scene.rain * 1.6, 0, 1);

    if (night > 0.2 && Math.random() < night * 0.75 * (1 - quiet)) {
      var n = 1 + ((Math.random() * 3) | 0);
      for (var i = 0; i < n; i++) {
        cricket(ctx.currentTime + Math.random() * 1.4, 3600 + Math.random() * 1400);
      }
    }
    if (day > 0.25 && Math.random() < day * 0.5 * (1 - quiet)) {
      bird(ctx.currentTime + Math.random() * 1.2);
    }
    chirpTimer = setTimeout(chirp, 900 + Math.random() * 2200);
  }

  function apply() {
    if (!started) return;
    var windLevel = clamp(scene.wind / 40, 0, 1);
    ramp(nodes.windGain.gain, 0.05 + windLevel * 0.20, 2.5);
    ramp(nodes.windFilter.frequency, 320 + windLevel * 900, 2.5);
    ramp(nodes.rainGain.gain, scene.rain * 0.14, 2.5);
    ramp(nodes.rainBand.frequency, 3800 + scene.rain * 3000, 2.5);
    ramp(nodes.lakeGain.gain, 0.04 + windLevel * 0.05, 2.5);
  }

  /* ============================================================
     The logo cue

     Every sound here is a beat of the drawing, scheduled from the same plan
     the splash draws from — and scheduled for when it will be *heard*, not
     when it is queued (see audioTimeFor, below):

       the square   a low swell as the spark sets off, a ringing rim — a wet
                    finger round a glass — while it runs the outline, and a
                    small tick the instant the square closes
       each letter  a nib on paper whose loudness and brightness follow the
                    pen's own speed, and a bell the frame it lands: four
                    notes up a pentatonic, so there is no wrong interval
       the flood    an open fifth, and a shimmer that sweeps upward exactly
                    as the shine crosses the letters
       the flight   air moving as the mark flies up into the header, panned
                    towards it, and a soft tock when it lands

     Quiet on purpose: a cue, not a fanfare. Skipped outright if the visitor
     has muted the site. Each cue runs through its own bus, so skipping the
     splash can silence what it had already scheduled.
     ============================================================ */

  /* C5 D5 E5 G5 — a major pentatonic, so any order of these is consonant. */
  var LETTER_NOTES = [523.25, 587.33, 659.25, 783.99];

  function out(dest) { return dest || ctx.destination; }

  /* A moment on the page's clock (performance.now), as the audio clock
     time at which a sound must be scheduled to be *heard* then. Output
     latency is the whole point: it is ten milliseconds on a laptop and a
     fifth of a second on Bluetooth headphones, and a bell that lands a
     fifth of a second after its letter is not in time with anything.
     getOutputTimestamp pairs the two clocks at the speaker; where it is
     missing, the reported latencies stand in for it. */
  function audioTimeFor(perfMs) {
    try {
      var ts = ctx.getOutputTimestamp && ctx.getOutputTimestamp();
      if (ts && ts.performanceTime > 0 && ts.contextTime > 0) {
        return ts.contextTime + (perfMs - ts.performanceTime) / 1000;
      }
    } catch (e) {}
    var lat = (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
    return ctx.currentTime + (perfMs - performance.now()) / 1000 - lat;
  }

  function muted() {
    try { return localStorage.getItem(KEY) === "off"; } catch (e) { return false; }
  }

  /* nib on paper: noise through a narrow band. Given the pen's speed as a
     curve, the scratch swells and brightens where the stroke is fastest
     and all but stops where it slows into a corner — which is what a real
     nib does, and what makes it sound drawn rather than played. */
  function nib(at, dur, level, dest, speed) {
    var src = ctx.createBufferSource();
    src.buffer = stock().white;
    src.loop = true;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;

    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 0.8;
    var hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 900;

    var g = gain(0);
    /* a little tremble, so it is a nib and not a hiss — in its own stage,
       so it shakes the envelope rather than adding to it */
    var trem = gain(0.78);
    var wob = ctx.createOscillator();
    wob.type = "triangle";
    wob.frequency.value = 11 + Math.random() * 7;
    var wobAmt = gain(0.22);
    wob.connect(wobAmt); wobAmt.connect(trem.gain);

    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(trem); trem.connect(out(dest));

    if (speed && speed.length > 2 && g.gain.setValueCurveAtTime) {
      var n = speed.length, gc = new Float32Array(n), fc = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        gc[i] = level * Math.min(1, speed[i] * 1.15);
        fc[i] = 1300 + 2700 * speed[i];
      }
      gc[0] = 0; gc[n - 1] = 0;
      g.gain.setValueCurveAtTime(gc, at, dur);
      bp.frequency.setValueCurveAtTime(fc, at, dur);
    } else {
      bp.frequency.setValueAtTime(1500, at);
      bp.frequency.linearRampToValueAtTime(3400, at + dur);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level, at + 0.045);
      g.gain.setValueAtTime(level, at + dur * 0.72);
      g.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    }
    wob.start(at); wob.stop(at + dur + 0.05);
    src.start(at); src.stop(at + dur + 0.05);
  }

  /* the bell a letter lands on */
  function bell(at, freq, level, dest) {
    [[1, level], [2.01, level * 0.30], [3.02, level * 0.12]].forEach(function (p) {
      var osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * p[0];
      var g = gain(0);
      osc.connect(g); g.connect(out(dest));
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(p[1], at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0004, at + 0.75 / p[0]);
      osc.start(at); osc.stop(at + 0.8);
    });
  }

  /* the spark setting off */
  function swell(at, level, dest) {
    var src = ctx.createBufferSource();
    src.buffer = stock().brown; src.loop = true;
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(200, at);
    lp.frequency.exponentialRampToValueAtTime(1200, at + 0.34);
    var g = gain(0);
    src.connect(lp); lp.connect(g); g.connect(out(dest));
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.16);
    g.gain.exponentialRampToValueAtTime(0.0005, at + 0.5);
    src.start(at); src.stop(at + 0.55);

    var sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(150, at);
    sub.frequency.exponentialRampToValueAtTime(72, at + 0.32);
    var sg = gain(0);
    sub.connect(sg); sg.connect(out(dest));
    sg.gain.setValueAtTime(0, at);
    sg.gain.linearRampToValueAtTime(level * 1.3, at + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.0004, at + 0.45);
    sub.start(at); sub.stop(at + 0.5);
  }

  /* The rim: two sines a couple of hertz apart, so they beat slowly the way
     a glass does, rising while the spark runs the square's edge and let go
     as it closes — with a tick on the frame it does. */
  function rim(at, dur, level, dest) {
    var g = gain(0);
    g.connect(out(dest));
    [784.0, 786.6, 1568.0].forEach(function (f, i) {
      var o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      var og = gain(i === 2 ? 0.18 : 0.5);
      o.connect(og); og.connect(g);
      o.start(at); o.stop(at + dur + 0.7);
    });
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level * 0.35, at + dur * 0.25);
    g.gain.linearRampToValueAtTime(level, at + dur);
    g.gain.exponentialRampToValueAtTime(0.0004, at + dur + 0.6);
    tick(at + dur, level * 1.6, dest, 2093.0);
  }

  function tick(at, level, dest, freq) {
    var o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = freq;
    o.frequency.setValueAtTime(freq, at);
    o.frequency.exponentialRampToValueAtTime(freq * 0.7, at + 0.05);
    var g = gain(0);
    o.connect(g); g.connect(out(dest));
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0004, at + 0.07);
    o.start(at); o.stop(at + 0.09);
  }

  /* the fill flooding in: an open fifth, and a shimmer that sweeps up for
     exactly as long as the shine takes to cross the letters */
  function flood(at, level, dest, sweep) {
    sweep = sweep || 0.9;
    [261.63, 392.00, 523.25].forEach(function (f, i) {
      var osc = ctx.createOscillator();
      osc.type = i === 2 ? "triangle" : "sine";
      osc.frequency.value = f;
      var g = gain(0);
      osc.connect(g); g.connect(out(dest));
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level * (i === 0 ? 1 : 0.6), at + 0.13);
      g.gain.exponentialRampToValueAtTime(0.0004, at + 1.5);
      osc.start(at); osc.stop(at + 1.6);
    });
    bell(at + 0.02, 1046.50, level * 0.55, dest);

    var sh = ctx.createBufferSource();
    sh.buffer = stock().white; sh.loop = true;
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(2600, at);
    bp.frequency.exponentialRampToValueAtTime(9800, at + sweep);
    var g2 = gain(0);
    sh.connect(bp); bp.connect(g2); g2.connect(out(dest));
    g2.gain.setValueAtTime(0, at);
    g2.gain.linearRampToValueAtTime(level * 0.34, at + sweep * 0.45);
    g2.gain.exponentialRampToValueAtTime(0.0004, at + sweep + 0.25);
    sh.start(at); sh.stop(at + sweep + 0.3);
  }

  /* Air moving as the mark flies to the header: noise through a band that
     falls as it goes, panned towards where the mark is heading, and a soft
     wooden tock the moment it lands. */
  function whoosh(at, dur, level, pan, dest) {
    var src = ctx.createBufferSource();
    src.buffer = stock().white; src.loop = true;
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(2400, at);
    bp.frequency.exponentialRampToValueAtTime(520, at + dur);
    var g = gain(0);
    src.connect(bp); bp.connect(g);
    var tail = g;
    /* no StereoPannerNode on older WebKit; it is then simply centred */
    if (ctx.createStereoPanner) {
      var p = ctx.createStereoPanner();
      p.pan.setValueAtTime(0, at);
      p.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, pan || 0)), at + dur);
      g.connect(p); tail = p;
    }
    tail.connect(out(dest));
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0004, at + dur + 0.08);
    src.start(at); src.stop(at + dur + 0.12);

    var land = at + dur;
    var o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = 1318.5;
    o.frequency.setValueAtTime(1318.5, land);
    o.frequency.exponentialRampToValueAtTime(980, land + 0.06);
    var og = gain(0);
    o.connect(og); og.connect(out(dest));
    og.gain.setValueAtTime(0, land);
    og.gain.linearRampToValueAtTime(level * 1.5, land + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0004, land + 0.12);
    o.start(land); o.stop(land + 0.14);
    var th = ctx.createOscillator();
    th.type = "sine";
    th.frequency.setValueAtTime(190, land);
    th.frequency.exponentialRampToValueAtTime(90, land + 0.08);
    var tg = gain(0);
    th.connect(tg); tg.connect(out(dest));
    tg.gain.setValueAtTime(0, land);
    tg.gain.linearRampToValueAtTime(level * 2.2, land + 0.005);
    tg.gain.exponentialRampToValueAtTime(0.0004, land + 0.14);
    th.start(land); th.stop(land + 0.16);
  }

  /* One bus per cue, so a skipped splash can silence what it scheduled. */
  function cueBus() {
    var bus = gain(1);
    bus.connect(ctx.destination);
    return {
      node: bus,
      stop: function () {
        var n = ctx.currentTime;
        try {
          bus.gain.cancelScheduledValues(n);
          bus.gain.setValueAtTime(bus.gain.value, n);
          bus.gain.linearRampToValueAtTime(0, n + 0.12);
        } catch (e) {}
        setTimeout(function () { try { bus.disconnect(); } catch (e) {} }, 400);
      }
    };
  }

  var api = {
    on: false,
    available: !!AC,

    start: function () {
      if (!AC || started) return;
      if (!ctx) { ctx = new AC(); build(); }
      if (ctx.state === "suspended") ctx.resume();
      started = true; api.on = true;
      ramp(master.gain, 0.85, 2.0);
      apply();
      chirp();
      timer = setInterval(apply, 4000);
      try { localStorage.setItem(KEY, "on"); } catch (e) {}
      emit();
    },

    stop: function () {
      if (!started) return;
      ramp(master.gain, 0, 0.7);
      started = false; api.on = false;
      clearInterval(timer); clearTimeout(chirpTimer);
      try { localStorage.setItem(KEY, "off"); } catch (e) {}
      emit();
    },

    toggle: function () { if (api.on) api.stop(); else api.start(); },

    /* Was it on last time? Only a hint — the actual start still waits for a
       click, because browsers will not have it any other way. */
    remembered: function () {
      try { return localStorage.getItem(KEY) === "on"; } catch (e) { return false; }
    },

    setScene: function (s) {
      if (s.t != null) scene.t = s.t;
      if (s.wind != null) scene.wind = s.wind;
      if (s.rain != null) scene.rain = s.rain;
      if (s.storm != null) scene.storm = s.storm;
      apply();
    },

    thunder: thunder,
    onchange: function (fn) { listeners.push(fn); },

    /* A card coming into the spotlight rings a bell on the same pentatonic
       the logo's letters land on — an octave down for the second half of
       the list — so turning the ring plays a little tune in which no two
       neighbours can clash. Only for someone who turned the evening's sound
       on; never as a surprise. */
    tick: function (i) {
      if (!started || !ctx || ctx.state !== "running") return;
      var PENTA = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50];
      var now = ctx.currentTime;
      if (now - lastTick < 0.045) return;
      lastTick = now;
      bell(now + 0.005, PENTA[i % PENTA.length] * (i >= PENTA.length ? 0.5 : 1), 0.022);
    },

    /* Bring the clock up without starting the ambience bed. Returns null
       where there is no Web Audio at all. */
    ensure: ensure,
    ready: function () { return !!ctx && ctx.state === "running"; },

    /* Play the logo cue against a plan the drawing hands us, in
       milliseconds from `startPerf` on the page's clock:
         { plate: { at, dur }, letters: [{ at, dur }...], flood, shine, speed }
       (plate and letters may also be bare numbers, with a shared `draw`).
       Each beat is converted to the audio clock for the moment it will be
       heard, so it lands on the frame it belongs to. Beats already in the
       past are skipped rather than played late, which lets a cue join a
       drawing already under way. Returns { stop } or false. */
    logo: function (plan, startPerf) {
      /* An explicit mute is an explicit mute. Never has anything to do with
         autoplay policy — this is the visitor's own choice. */
      if (muted() || !ensure() || ctx.state !== "running") return false;

      var base = startPerf == null ? performance.now() + 30 : startPerf;
      var bus = cueBus();
      var floor = ctx.currentTime + 0.008;
      var at = function (ms) { return audioTimeFor(base + ms); };

      var plate = typeof plan.plate === "number" ? { at: plan.plate, dur: 0 } : plan.plate;
      if (plate && at(plate.at) >= floor) {
        swell(at(plate.at), 0.040, bus.node);
        if (plate.dur) rim(at(plate.at), plate.dur / 1000, 0.016, bus.node);
      }

      (plan.letters || []).forEach(function (l, i) {
        if (typeof l === "number") l = { at: l, dur: plan.draw };
        var s = at(l.at), e = at(l.at + l.dur);
        if (s >= floor) nib(s, l.dur / 1000, 0.015, bus.node, plan.speed);
        if (e >= floor) bell(e, LETTER_NOTES[i % LETTER_NOTES.length], 0.062, bus.node);
      });

      if (plan.flood != null && at(plan.flood) >= floor) {
        flood(at(plan.flood), 0.044, bus.node, plan.shine ? plan.shine / 1000 : 0.9);
      }
      return bus;
    },

    /* The mark's flight into the header: `dur` ms from `startPerf`, panned
       towards `pan` (-1 left .. 1 right). Returns { stop } or false. */
    flight: function (dur, startPerf, pan) {
      if (muted() || !ctx || ctx.state !== "running") return false;
      var bus = cueBus();
      var s = audioTimeFor(startPerf == null ? performance.now() + 30 : startPerf);
      if (s < ctx.currentTime) s = ctx.currentTime + 0.005;
      whoosh(s, dur / 1000, 0.028, pan, bus.node);
      return bus;
    },

    /* How far behind the page's clock the speakers are, in milliseconds —
       what a drawing should wait so its first frame and first sound arrive
       together. 0 when there is no running audio. */
    latency: function () {
      if (!ctx || ctx.state !== "running") return 0;
      try {
        var ts = ctx.getOutputTimestamp && ctx.getOutputTimestamp();
        if (ts && ts.performanceTime > 0 && ts.contextTime > 0) {
          /* the audio clock is scheduling ahead of what the speakers are
             playing; the gap between the two is the latency */
          var lag = (ctx.currentTime - ts.contextTime) * 1000 - (performance.now() - ts.performanceTime);
          if (lag >= 0 && lag < 500) return lag;
        }
      } catch (e) {}
      return Math.min(500, ((ctx.outputLatency || 0) + (ctx.baseLatency || 0)) * 1000);
    },

    /* Resolves once the audio clock is running, or after `ms` regardless —
       for a replay started from a click, where resume() is asynchronous and
       the first beat should not be lost to it. */
    wake: function (ms) {
      return new Promise(function (res) {
        if (!ensure()) { res(false); return; }
        if (ctx.state === "running") { res(true); return; }
        var t = setTimeout(function () { res(ctx.state === "running"); }, ms || 300);
        try { ctx.resume().then(function () { clearTimeout(t); res(true); }, function () {}); } catch (e) {}
      });
    }
  };

  function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](api.on); } catch (e) {} } }

  /* Nobody wants a cricket coming out of a tab they walked away from. */
  document.addEventListener("visibilitychange", function () {
    if (!ctx || !started) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });

  NJ.ambience = api;
})(window);

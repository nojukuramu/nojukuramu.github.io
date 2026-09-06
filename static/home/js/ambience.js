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

     Three layers, all synthesised, all hung off the same schedule the
     drawing uses so the sound cannot drift from the picture:

       the plate   a low swell as the square outlines itself
       each letter a nib on paper for the length of the stroke, and a small
                   bell the instant it lands - four notes up a pentatonic,
                   so there is no wrong interval to land on
       the flood   an open fifth with a shimmer over it as the fill arrives

     Quiet on purpose. Rendered offline and measured, it peaks around
     -10 dBFS with an RMS near -29: a cue, not a fanfare. Skipped outright
     if the visitor has muted the site.
     ============================================================ */

  /* C5 D5 E5 G5 — a major pentatonic, so any order of these is consonant. */
  var LETTER_NOTES = [523.25, 587.33, 659.25, 783.99];

  /* nib on paper: noise through a narrow band that opens as the stroke runs */
  function nib(at, dur, level) {
    var src = ctx.createBufferSource();
    src.buffer = stock().white;
    src.loop = true;
    src.playbackRate.value = 0.85 + Math.random() * 0.3;

    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(1500, at);
    bp.frequency.linearRampToValueAtTime(3400, at + dur);
    bp.Q.value = 0.8;

    var hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 900;

    var g = gain(0);
    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(ctx.destination);

    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.045);
    g.gain.setValueAtTime(level, at + dur * 0.72);
    g.gain.exponentialRampToValueAtTime(0.0005, at + dur);

    /* a little tremble, so it is a nib and not a hiss */
    var wob = ctx.createOscillator();
    wob.type = "triangle";
    wob.frequency.value = 11 + Math.random() * 7;
    var wobAmt = gain(level * 0.45);
    wob.connect(wobAmt); wobAmt.connect(g.gain);
    wob.start(at); wob.stop(at + dur + 0.05);

    src.start(at); src.stop(at + dur + 0.05);
  }

  /* the bell a letter lands on */
  function bell(at, freq, level) {
    [[1, level], [2.01, level * 0.30], [3.02, level * 0.12]].forEach(function (p) {
      var osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq * p[0];
      var g = gain(0);
      osc.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(p[1], at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0004, at + 0.75 / p[0]);
      osc.start(at); osc.stop(at + 0.8);
    });
  }

  /* the square arriving */
  function swell(at, level) {
    var src = ctx.createBufferSource();
    src.buffer = stock().brown; src.loop = true;
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(200, at);
    lp.frequency.exponentialRampToValueAtTime(1200, at + 0.34);
    var g = gain(0);
    src.connect(lp); lp.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.16);
    g.gain.exponentialRampToValueAtTime(0.0005, at + 0.5);
    src.start(at); src.stop(at + 0.55);

    var sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(150, at);
    sub.frequency.exponentialRampToValueAtTime(72, at + 0.32);
    var sg = gain(0);
    sub.connect(sg); sg.connect(ctx.destination);
    sg.gain.setValueAtTime(0, at);
    sg.gain.linearRampToValueAtTime(level * 1.3, at + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.0004, at + 0.45);
    sub.start(at); sub.stop(at + 0.5);
  }

  /* the fill flooding in: an open fifth, and a shimmer over the top */
  function flood(at, level) {
    [261.63, 392.00, 523.25].forEach(function (f, i) {
      var osc = ctx.createOscillator();
      osc.type = i === 2 ? "triangle" : "sine";
      osc.frequency.value = f;
      var g = gain(0);
      osc.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level * (i === 0 ? 1 : 0.6), at + 0.13);
      g.gain.exponentialRampToValueAtTime(0.0004, at + 1.5);
      osc.start(at); osc.stop(at + 1.6);
    });
    bell(at + 0.02, 1046.50, level * 0.55);

    var sh = ctx.createBufferSource();
    sh.buffer = stock().white; sh.loop = true;
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 6200; bp.Q.value = 1.4;
    var g2 = gain(0);
    sh.connect(bp); bp.connect(g2); g2.connect(ctx.destination);
    g2.gain.setValueAtTime(0, at);
    g2.gain.linearRampToValueAtTime(level * 0.30, at + 0.10);
    g2.gain.exponentialRampToValueAtTime(0.0004, at + 0.9);
    sh.start(at); sh.stop(at + 1.0);
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

    /* Bring the clock up without starting the ambience bed. Returns null
       where there is no Web Audio at all. */
    ensure: ensure,
    ready: function () { return !!ctx && ctx.state === "running"; },

    /* Play the logo cue against a plan the drawing hands us, in
       milliseconds from now:
         { plate: 0, letters: [0, 140, 280, 420], draw: 540, flood: 830 }
       Everything is scheduled against one audio timestamp taken here, so
       the notes cannot drift apart from each other even if the main thread
       stalls mid-animation. Returns false when it did not play. */
    logo: function (plan) {
      /* An explicit mute is an explicit mute. Never has anything to do with
         autoplay policy — this is the visitor's own choice. */
      try { if (localStorage.getItem(KEY) === "off") return false; } catch (e) {}
      if (!ensure() || ctx.state !== "running") return false;

      var t0 = ctx.currentTime + 0.02;
      var ms = function (v) { return t0 + v / 1000; };

      if (plan.plate != null) swell(ms(plan.plate), 0.040);

      (plan.letters || []).forEach(function (at, i) {
        nib(ms(at), plan.draw / 1000, 0.015);
        bell(ms(at + plan.draw), LETTER_NOTES[i % LETTER_NOTES.length], 0.062);
      });

      if (plan.flood != null) flood(ms(plan.flood), 0.044);
      return true;
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

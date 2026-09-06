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
  var ctx = null, master = null, started = false;
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

    var brown = noiseBuffer(4, 0.06);
    var white = noiseBuffer(4, 0);

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
              rainBand: rainBand, lakeGain: lakeGain, white: white, brown: brown };
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
    src.buffer = nodes.brown; src.loop = true;
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
    onchange: function (fn) { listeners.push(fn); }
  };

  function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](api.on); } catch (e) {} } }

  /* Nobody wants a cricket coming out of a tab they walked away from. */
  document.addEventListener("visibilitychange", function () {
    if (!ctx || !started) return;
    if (document.hidden) ctx.suspend(); else ctx.resume();
  });

  NJ.ambience = api;
})(window);

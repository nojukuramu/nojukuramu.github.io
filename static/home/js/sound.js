/* ============================================================
   nojukuramu — the camera's sounds

   A detent clicking under the thumb as the wheel turns, the shutter going
   as the iris shuts and opens, the two short beeps of focus found, and the
   motor of a film being rewound. All of it synthesised — filtered noise
   and a few oscillators, no audio files — and all of it off until asked.

   The shape is the old evening ambience's (ambience.js, before this page
   was a camera): the same noise buffer made once and shared, the same
   start / stop / toggle / remembered / onchange, and the same manners. It
   is off by default; a remembered "on" is only a hint, because browsers
   will not start audio without a click and a page that talks the moment
   it loads is rude even where it is allowed; and nothing plays in a tab
   nobody is looking at.
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});
  var KEY = "home.sound";
  var AC = global.AudioContext || global.webkitAudioContext;
  var ctx = null, master = null, noise = null;
  var listeners = [];
  var lastDetent = 0, motor = null;

  function noiseBuffer(seconds) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.9;
    return buf;
  }

  function ensure() {
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      /* a little compression, so a fast flick through the wheel — a
         dozen detents and shutters stacked up — never clips */
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 4;
      master.connect(comp); comp.connect(ctx.destination);
      noise = noiseBuffer(1.5);
    }
    if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  function live() { return api.on && ctx && ctx.state === "running" && !document.hidden; }

  /* noise through a band, shaped by an envelope: the body of every click */
  function burst(at, freq, q, level, decay, rate) {
    var src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = rate || 1;
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = freq; bp.Q.value = q;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0003, at + decay);
    src.connect(bp); bp.connect(g); g.connect(master);
    src.start(at, Math.random() * 1.2); src.stop(at + decay + 0.02);
  }

  function tone(at, type, f0, f1, level, dur) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0003, at + dur);
    o.connect(g); g.connect(master);
    o.start(at); o.stop(at + dur + 0.02);
  }

  function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](api.on); } catch (e) {} } }

  var api = {
    on: false,
    available: !!AC,

    start: function () {
      if (!ensure()) return;
      api.on = true;
      try { localStorage.setItem(KEY, "on"); } catch (e) {}
      emit();
      /* the answer to the click that turned it on */
      setTimeout(function () { api.beep(); }, 60);
    },
    stop: function () {
      api.on = false;
      api.whirr(0);
      try { localStorage.setItem(KEY, "off"); } catch (e) {}
      emit();
    },
    toggle: function () { if (api.on) api.stop(); else api.start(); },
    remembered: function () {
      try { return localStorage.getItem(KEY) === "on"; } catch (e) { return false; }
    },
    onchange: function (fn) { listeners.push(fn); },

    /* one stop of the dial: a hard little tick with a ring in it */
    detent: function () {
      if (!live()) return;
      var now = ctx.currentTime;
      if (now - lastDetent < 0.035) return;
      lastDetent = now;
      burst(now + 0.004, 3600, 7, 0.10, 0.022);
      burst(now + 0.004, 900, 2, 0.05, 0.012);
    },

    /* the shutter: the first curtain and the mirror's slap, then the
       second curtain a breath behind it */
    shutter: function () {
      if (!live()) return;
      var t = ctx.currentTime + 0.006;
      burst(t, 1900, 1.1, 0.22, 0.045, 0.9);
      tone(t, "sine", 150, 60, 0.12, 0.06);
      burst(t + 0.058, 2700, 1.8, 0.13, 0.032);
      burst(t + 0.058, 5200, 3, 0.05, 0.015);
    },

    /* focus found */
    beep: function () {
      if (!live()) return;
      var t = ctx.currentTime + 0.01;
      tone(t, "sine", 2793, 2793, 0.035, 0.05);
      tone(t + 0.085, "sine", 2793, 2793, 0.035, 0.05);
    },

    /* the rewind motor, for `ms`; 0 stops one already running */
    whirr: function (ms) {
      if (motor) {
        var m = motor; motor = null;
        try {
          var n = ctx.currentTime;
          m.g.gain.cancelScheduledValues(n);
          m.g.gain.setValueAtTime(m.g.gain.value, n);
          m.g.gain.linearRampToValueAtTime(0, n + 0.12);
          m.o.stop(n + 0.15); m.s.stop(n + 0.15);
        } catch (e) {}
      }
      if (!ms || !live()) return;
      var t = ctx.currentTime + 0.01, d = ms / 1000;
      var o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(70, t);
      o.frequency.linearRampToValueAtTime(140, t + d * 0.35);
      o.frequency.linearRampToValueAtTime(95, t + d);
      var lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 1100; lp.Q.value = 3;
      var s = ctx.createBufferSource();
      s.buffer = noise; s.loop = true;
      var bp = ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 1.4;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.08);
      g.gain.setValueAtTime(0.05, t + Math.max(0.1, d - 0.18));
      g.gain.linearRampToValueAtTime(0, t + d);
      o.connect(lp); lp.connect(g);
      s.connect(bp); bp.connect(g);
      g.connect(master);
      o.start(t); s.start(t);
      o.stop(t + d + 0.05); s.stop(t + d + 0.05);
      motor = { o: o, s: s, g: g };
    }
  };

  /* Nobody wants a shutter going off in a tab they walked away from. */
  document.addEventListener("visibilitychange", function () {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else if (api.on) ctx.resume();
  });

  NJ.sound = api;
})(window);

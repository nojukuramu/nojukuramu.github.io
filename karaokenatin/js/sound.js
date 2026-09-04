/* sound.js — the room's few sounds, synthesised rather than downloaded.
 *
 * A roulette needs a tick and a score needs a drumroll, and both of those are
 * normally three audio files and a loader. This app has no build step and no
 * assets to speak of, so they are built out of an oscillator and a buffer of
 * noise instead: a few hundred bytes of code rather than a few hundred KB of
 * WAV, and nothing to 404 on a bad connection mid-spin.
 *
 * Everything here is best-effort. A browser with no Web Audio, an audio
 * context the autoplay policy will not start, a phone on silent — all of them
 * end with the room getting the animation and no sound, which is the correct
 * failure. Nothing waits on audio and nothing reports its absence.
 *
 * The context is created on the first user gesture, because one created before
 * that starts `suspended` and every later sound is silently dropped.
 */
(function (global) {
  "use strict";

  var KN = (global.KN = global.KN || {});

  var ctx = null;
  var master = null;
  var noise = null;        // one second of white noise, reused by every hit
  var enabled = true;
  var broken = false;

  function context() {
    if (ctx || broken) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) { broken = true; return null; }
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.6;
      master.connect(ctx.destination);
    } catch (e) {
      broken = true;
      return null;
    }
    return ctx;
  }

  /** A context created before a gesture starts suspended; nudge it awake. */
  function resume() {
    var c = context();
    if (c && c.state === "suspended" && c.resume) c.resume().catch(function () {});
    return c;
  }

  function noiseBuffer(c) {
    if (noise) return noise;
    var buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise = buf;
    return noise;
  }

  function ready() {
    if (!enabled) return null;
    var c = context();
    if (!c) return null;
    if (c.state === "suspended") resume();
    return c;
  }

  /* ---------------- the sounds ---------------- */

  /**
   * A single click — the roulette's tick, and the beat of the score counting
   * up. Short, band-passed noise: a click with no pitch, so a hundred of them
   * in a row read as a mechanism rather than as a melody.
   *
   * `strength` scales it, so a spin can slow down and soften at the same time.
   */
  function tick(strength) {
    var c = ready();
    if (!c) return;
    var gain = Math.max(0, Math.min(1, strength === undefined ? 1 : strength));
    if (!gain) return;
    var t = c.currentTime;

    var src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;

    var band = c.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2600;
    band.Q.value = 1.6;

    var amp = c.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.16 * gain, t + 0.002);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);

    src.connect(band);
    band.connect(amp);
    amp.connect(master);
    src.start(t);
    src.stop(t + 0.06);
  }

  /**
   * The drumroll under a score reveal: a low tom struck fast, plus a hiss that
   * swells with it. Returns a handle — `stop()` ends it, `crest()` finishes it
   * with the hit the number lands on.
   */
  function drumroll(seconds) {
    var c = ready();
    if (!c) return { stop: function () {}, crest: function () {} };

    var span = Math.max(0.4, seconds || 2.6);
    var t0 = c.currentTime;
    var live = true;

    /* The hiss: one noise source swelling underneath the whole roll, so the
     * individual hits sit on something rather than in silence. */
    var hiss = c.createBufferSource();
    hiss.buffer = noiseBuffer(c);
    hiss.loop = true;
    var hissFilter = c.createBiquadFilter();
    hissFilter.type = "lowpass";
    hissFilter.frequency.value = 900;
    var hissGain = c.createGain();
    hissGain.gain.setValueAtTime(0.0001, t0);
    hissGain.gain.exponentialRampToValueAtTime(0.05, t0 + span * 0.85);
    hiss.connect(hissFilter);
    hissFilter.connect(hissGain);
    hissGain.connect(master);
    hiss.start(t0);

    /* The hits, scheduled up front: a setInterval competing with the main
     * thread would swing audibly, and a roll that swings is a stumble. They
     * tighten as they go, which is what makes a roll feel like it is building
     * towards something rather than just continuing. */
    var at = 0;
    var gap = 0.055;
    var offsets = [];
    while (at < span) {
      offsets.push(at);
      gap = Math.max(0.026, gap * 0.985);
      at += gap;
    }
    var hits = [];
    offsets.forEach(function (offset, i) {
      var t = t0 + offset;
      var body = c.createOscillator();
      body.type = "sine";
      body.frequency.setValueAtTime(150, t);
      body.frequency.exponentialRampToValueAtTime(72, t + 0.05);
      var amp = c.createGain();
      var loud = 0.06 + 0.09 * (i / offsets.length);
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(loud, t + 0.004);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      body.connect(amp);
      amp.connect(master);
      body.start(t);
      body.stop(t + 0.09);
      hits.push(body);
    });

    function silence() {
      if (!live) return;
      live = false;
      var t = c.currentTime;
      try {
        hissGain.gain.cancelScheduledValues(t);
        hissGain.gain.setValueAtTime(Math.max(0.0001, hissGain.gain.value), t);
        hissGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        hiss.stop(t + 0.16);
      } catch (e) { /* already stopped */ }
      hits.forEach(function (osc) { try { osc.stop(t); } catch (e) { /* already stopped */ } });
    }

    return {
      stop: silence,
      /** The landing: a cymbal-ish splash and a thump, then the roll ends. */
      crest: function () {
        silence();
        var t = c.currentTime;

        var crash = c.createBufferSource();
        crash.buffer = noiseBuffer(c);
        var hp = c.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 3200;
        var cg = c.createGain();
        cg.gain.setValueAtTime(0.22, t);
        cg.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
        crash.connect(hp);
        hp.connect(cg);
        cg.connect(master);
        crash.start(t);
        crash.stop(t + 1.2);

        var thump = c.createOscillator();
        thump.type = "sine";
        thump.frequency.setValueAtTime(140, t);
        thump.frequency.exponentialRampToValueAtTime(48, t + 0.22);
        var tg = c.createGain();
        tg.gain.setValueAtTime(0.24, t);
        tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
        thump.connect(tg);
        tg.connect(master);
        thump.start(t);
        thump.stop(t + 0.45);
      }
    };
  }

  /** Three rising notes, for a score worth making a noise about. */
  function fanfare() {
    var c = ready();
    if (!c) return;
    var t0 = c.currentTime;
    [0, 4, 7, 12].forEach(function (semitone, i) {
      var t = t0 + i * 0.11;
      var osc = c.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 392 * Math.pow(2, semitone / 12);
      var amp = c.createGain();
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      osc.connect(amp);
      amp.connect(master);
      osc.start(t);
      osc.stop(t + 0.55);
    });
  }

  /** A two-note chime — something was chosen, and the spin is over. */
  function chime() {
    var c = ready();
    if (!c) return;
    var t0 = c.currentTime;
    [880, 1318.5].forEach(function (hz, i) {
      var t = t0 + i * 0.09;
      var osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.value = hz;
      var amp = c.createGain();
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(0.14, t + 0.015);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(amp);
      amp.connect(master);
      osc.start(t);
      osc.stop(t + 0.65);
    });
  }

  /* The autoplay policy wants a gesture before any of this will make a sound,
   * and the gesture that matters is whichever one happens first — not one we
   * put a button in front of. */
  function arm() {
    ["pointerdown", "keydown", "touchstart"].forEach(function (name) {
      global.addEventListener(name, resume, { once: true, passive: true });
    });
  }

  KN.sound = {
    tick: tick,
    drumroll: drumroll,
    fanfare: fanfare,
    chime: chime,
    arm: arm,
    resume: resume,
    /** The host's Setup switch: silence without unwiring anything. */
    setEnabled: function (on) { enabled = !!on; },
    isEnabled: function () { return enabled; }
  };
})(typeof window !== "undefined" ? window : globalThis);

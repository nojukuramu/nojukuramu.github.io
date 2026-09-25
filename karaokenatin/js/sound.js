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
      /* Everything goes through a compressor so a fanfare on top of applause
       * on top of a drumroll gets louder without clipping, and through a small
       * synthetic room, so the sounds sit in the same space as the singer
       * instead of in a pair of headphones. The room is a buffer of decaying
       * noise built here — a reverb impulse is otherwise another file. */
      var comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.2;
      master.connect(comp);
      comp.connect(ctx.destination);
      try {
        var verb = ctx.createConvolver();
        verb.buffer = roomImpulse(ctx, 1.4);
        var send = ctx.createGain();
        send.gain.value = 0.22;
        master.connect(send);
        send.connect(verb);
        verb.connect(comp);
      } catch (e) { /* no convolver: the sounds are just drier */ }
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

  /** Stereo noise that dies away over `seconds`: a room, as an impulse. */
  function roomImpulse(c, seconds) {
    var len = Math.floor(c.sampleRate * seconds);
    var buf = c.createBuffer(2, len, c.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
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
   * `tone`, when given, adds a short pitched knock under the click: the
   * wheel's peg hitting the pointer, dropping in pitch as the wheel slows.
   */
  function tick(strength, tone) {
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

    if (tone) {
      var knock = c.createOscillator();
      knock.type = "triangle";
      knock.frequency.setValueAtTime(tone, t);
      knock.frequency.exponentialRampToValueAtTime(tone * 0.6, t + 0.05);
      var kg = c.createGain();
      kg.gain.setValueAtTime(0.0001, t);
      kg.gain.exponentialRampToValueAtTime(0.08 * gain, t + 0.003);
      kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      knock.connect(kg);
      kg.connect(master);
      knock.start(t);
      knock.stop(t + 0.08);
    }
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

  /* ---------------- shared voices ----------------
   * The celebrations below are all built out of the same two instruments, so
   * a fanfare and a sad trombone sound like they came from the same band. */

  /** One note: `type` oscillator(s), an envelope, optionally a filter sweep. */
  function note(c, t, hz, len, opts) {
    opts = opts || {};
    var peak = opts.gain || 0.1;
    var amp = c.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(peak, t + (opts.attack || 0.012));
    amp.gain.setValueAtTime(peak, t + Math.max(0.02, len * 0.6));
    amp.gain.exponentialRampToValueAtTime(0.0001, t + len);

    var out = amp;
    if (opts.cutoff) {
      /* Brass is a sawtooth whose brightness follows its loudness: open the
       * filter on the attack and let it close as the note settles. */
      var lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 2;
      lp.frequency.setValueAtTime(opts.cutoff * 0.35, t);
      lp.frequency.exponentialRampToValueAtTime(opts.cutoff, t + 0.05);
      lp.frequency.exponentialRampToValueAtTime(opts.cutoff * 0.5, t + len);
      lp.connect(amp);
      out = lp;
    }
    amp.connect(master);

    // Two slightly detuned voices: a section, not a single reed.
    var detunes = opts.detune === 0 ? [0] : [-(opts.detune || 7), opts.detune || 7];
    var oscs = detunes.map(function (cents) {
      var osc = c.createOscillator();
      osc.type = opts.type || "sawtooth";
      osc.frequency.setValueAtTime(hz, t);
      osc.detune.value = cents;
      if (opts.bendTo) osc.frequency.exponentialRampToValueAtTime(opts.bendTo, t + len * 0.9);
      if (opts.vibrato) {
        var lfo = c.createOscillator();
        var depth = c.createGain();
        lfo.frequency.value = 5.5;
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(hz * 0.03, t + len * 0.5);
        lfo.connect(depth);
        depth.connect(osc.frequency);
        lfo.start(t);
        lfo.stop(t + len + 0.05);
      }
      osc.connect(out);
      osc.start(t);
      osc.stop(t + len + 0.05);
      return osc;
    });
    return oscs;
  }

  function hz(semitonesFromA4) { return 440 * Math.pow(2, semitonesFromA4 / 12); }

  /** A bright bell, for sparkles and chimes: a sine and its octave-and-a-fifth. */
  function bell(c, t, f, gain, len) {
    [1, 3.01].forEach(function (mult, i) {
      var osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.value = f * mult;
      var amp = c.createGain();
      var g = (gain || 0.08) * (i ? 0.3 : 1);
      amp.gain.setValueAtTime(0.0001, t);
      amp.gain.exponentialRampToValueAtTime(g, t + 0.006);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + (len || 0.7) * (i ? 0.5 : 1));
      osc.connect(amp);
      amp.connect(master);
      osc.start(t);
      osc.stop(t + (len || 0.7) + 0.05);
    });
  }

  /* ---------------- the celebrations ---------------- */

  /**
   * A brass fanfare: three pickups and a held major chord, the shape every
   * game show uses for "and the winner is". `big` adds the octave on top and
   * holds it longer, for 101.
   */
  function brassFanfare(big) {
    var c = ready();
    if (!c) return;
    var t0 = c.currentTime + 0.02;
    var o = { gain: 0.07, cutoff: 3200 };
    // G4 G4 G4 | C5-E5-G5 held
    note(c, t0, hz(-2), 0.12, o);
    note(c, t0 + 0.14, hz(-2), 0.12, o);
    note(c, t0 + 0.28, hz(-2), 0.12, o);
    var hold = big ? 1.8 : 1.2;
    var chord = big ? [3, 7, 10, 15] : [3, 7, 10];
    chord.forEach(function (st) { note(c, t0 + 0.44, hz(st), hold, { gain: 0.06, cutoff: 3600 }); });
    note(c, t0 + 0.44, hz(3 - 12), hold, { gain: 0.07, cutoff: 1200, detune: 0 });
    sparkle(t0 + 0.5 - c.currentTime, big ? 12 : 7);
  }

  /** A short "ta-da": two chord stabs, the second one higher. */
  function taDa() {
    var c = ready();
    if (!c) return;
    var t0 = c.currentTime + 0.02;
    // G major, then C major a fourth up: the resolution is the "da".
    [-2, 2, 5].forEach(function (st) { note(c, t0, hz(st), 0.16, { gain: 0.05, cutoff: 2600 }); });
    [3, 7, 10].forEach(function (st) { note(c, t0 + 0.18, hz(st), 0.9, { gain: 0.05, cutoff: 3000 }); });
    sparkle(0.22, 4);
  }

  /** Warm and encouraging — a soft major arpeggio on bells. */
  function encourage() {
    var c = ready();
    if (!c) return;
    var t0 = c.currentTime + 0.02;
    [3, 7, 10, 15].forEach(function (st, i) { bell(c, t0 + i * 0.09, hz(st), 0.07, 0.9); });
  }

  /** Wah, wah, wah, waaah — the friendliest way to say "that was a 66". */
  function sadTrombone() {
    var c = ready();
    if (!c) return;
    var t0 = c.currentTime + 0.05;
    var o = { gain: 0.08, cutoff: 1400, attack: 0.04 };
    note(c, t0, hz(-5), 0.42, o);                       // E4
    note(c, t0 + 0.46, hz(-6), 0.42, o);                // D#4
    note(c, t0 + 0.92, hz(-7), 0.42, o);                // D4
    note(c, t0 + 1.38, hz(-8), 1.3, { gain: 0.08, cutoff: 1400, attack: 0.04, vibrato: true, bendTo: hz(-9) });
  }

  /**
   * A crowd clapping: a bed of hiss for the room, and hundreds of short,
   * randomly timed, randomly pitched noise bursts for the hands. Swells in,
   * holds, and tails off over `seconds`.
   */
  function applause(seconds, intensity) {
    var c = ready();
    if (!c) return;
    var span = Math.max(1, seconds || 3);
    var dense = Math.max(0.2, Math.min(1, intensity === undefined ? 1 : intensity));
    var t0 = c.currentTime + 0.02;

    var bed = c.createBufferSource();
    bed.buffer = noiseBuffer(c);
    bed.loop = true;
    var bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1500;
    bp.Q.value = 0.6;
    var bg = c.createGain();
    bg.gain.setValueAtTime(0.0001, t0);
    bg.gain.exponentialRampToValueAtTime(0.05 * dense, t0 + 0.35);
    bg.gain.setValueAtTime(0.05 * dense, t0 + span * 0.55);
    bg.gain.exponentialRampToValueAtTime(0.0001, t0 + span);
    bed.connect(bp);
    bp.connect(bg);
    bg.connect(master);
    bed.start(t0);
    bed.stop(t0 + span + 0.05);

    var claps = Math.round(span * 55 * dense);
    for (var i = 0; i < claps; i++) {
      // More of them early, fewer as the room sits back down.
      var at = t0 + span * Math.pow(Math.random(), 1.6);
      var fade = 1 - (at - t0) / span;
      var src = c.createBufferSource();
      src.buffer = noiseBuffer(c);
      var f = c.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 900 + Math.random() * 1800;
      f.Q.value = 1.2;
      var g = c.createGain();
      var loud = (0.05 + Math.random() * 0.07) * fade * dense;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, loud), at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.03 + Math.random() * 0.03);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      // Start somewhere random in the noise so no two claps are the same clap.
      src.start(at, Math.random() * 0.9, 0.08);
    }
  }

  /** A glitter of high bells, for confetti and a wheel that lands. */
  function sparkle(delay, count) {
    var c = ready();
    if (!c) return;
    var t0 = c.currentTime + Math.max(0, delay || 0);
    var n = count || 6;
    var scale = [15, 19, 22, 27, 31, 34];
    for (var i = 0; i < n; i++) {
      bell(c, t0 + i * 0.06 + Math.random() * 0.03, hz(scale[Math.floor(Math.random() * scale.length)]), 0.035, 0.5);
    }
  }

  /** A soft rising whoosh, for a card sweeping onto the stage. */
  function whoosh() {
    var c = ready();
    if (!c) return;
    var t = c.currentTime;
    var src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    var f = c.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.45);
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start(t, 0, 0.6);
  }

  /** A short pitched blip: countdown seconds, and a vote landing. */
  function blip(pitch, gain) {
    var c = ready();
    if (!c) return;
    var t = c.currentTime;
    var osc = c.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(pitch || 880, t);
    osc.frequency.exponentialRampToValueAtTime((pitch || 880) * 1.5, t + 0.05);
    var amp = c.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain || 0.09, t + 0.005);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(amp);
    amp.connect(master);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  /** Ding-dong: the next singer's doorbell. Quiet — someone is still singing. */
  function dingDong() {
    var c = ready();
    if (!c) return;
    var t = c.currentTime + 0.02;
    bell(c, t, hz(7), 0.045, 1.0);
    bell(c, t + 0.32, hz(3), 0.045, 1.3);
  }

  /** The reaction a score has earned, by band — the sound half of the card. */
  function celebrate(band) {
    if (band === "impossible") { brassFanfare(true); applause(4.5, 1); return; }
    if (band === "great") { brassFanfare(false); applause(3.6, 0.9); return; }
    if (band === "good") { taDa(); applause(2.4, 0.6); return; }
    if (band === "okay") { encourage(); applause(1.6, 0.35); return; }
    sadTrombone();
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
    fanfare: function () { brassFanfare(false); },
    chime: chime,
    celebrate: celebrate,
    applause: applause,
    sparkle: sparkle,
    whoosh: whoosh,
    blip: blip,
    dingDong: dingDong,
    arm: arm,
    resume: resume,
    /** The host's Setup switch: silence without unwiring anything. */
    setEnabled: function (on) { enabled = !!on; },
    isEnabled: function () { return enabled; }
  };
})(typeof window !== "undefined" ? window : globalThis);

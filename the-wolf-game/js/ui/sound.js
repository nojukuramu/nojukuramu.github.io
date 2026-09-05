/* sound.js — the valley, out loud.
 *
 * Every sound here is synthesised on the fly. There is not one audio file in
 * the repository and there is not one network request: the site stays a folder
 * of text that GitHub Pages serves, and the game still has crickets.
 *
 * That constraint is also why it sounds the way it does. You cannot sample a
 * wolf, so a howl is a glide on two detuned saws with vibrato and a long tail;
 * you cannot sample a cricket, so a cricket is a 4.6 kHz sine chopped at 42 Hz
 * for forty milliseconds. Recipes, not recordings.
 *
 * Three rules it follows:
 *
 *   Nothing plays until the player has touched the screen. Browsers require it,
 *   and a game that starts shouting before you have joined a room deserves the
 *   requirement.
 *
 *   The bed follows the phase clock, so the night has crickets and an owl and
 *   the morning has birds, and the crossfade between them happens on the same
 *   schedule as the colour.
 *
 *   One-shots duck the bed rather than stacking on it. A howl over crickets is
 *   a howl; a howl over crickets at the same volume is mud.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});

  var ctx = null, master = null, bedGain = null, verb = null, started = false;
  var enabled = true, scene = null, timer = null, bedNodes = [];

  function now() { return ctx ? ctx.currentTime : 0; }
  function rand(a, b) { return a + Math.random() * (b - a); }

  /* ---------------- plumbing ---------------- */

  /** A short synthetic impulse response: noise under an exponential decay.
   *  Two hundred lines of convolution reverb for eight lines of noise. */
  function makeVerb(seconds, decay) {
    var rate = ctx.sampleRate;
    var len = Math.floor(rate * seconds);
    var buf = ctx.createBuffer(2, len, rate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch);
      for (var i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    var c = ctx.createConvolver();
    c.buffer = buf;
    return c;
  }

  function noiseBuffer(seconds, brown) {
    var len = Math.floor(ctx.sampleRate * seconds);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) {
      var white = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * white) / 1.02; d[i] = last * 3.2; }
      else d[i] = white;
    }
    return buf;
  }

  function init() {
    if (ctx) return true;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = enabled ? 0.9 : 0;
    master.connect(ctx.destination);

    verb = makeVerb(2.6, 2.4);
    var verbGain = ctx.createGain();
    verbGain.gain.value = 0.32;
    verb.connect(verbGain);
    verbGain.connect(master);

    bedGain = ctx.createGain();
    bedGain.gain.value = 0.0;
    bedGain.connect(master);
    return true;
  }

  /** Route a voice to the dry master and to the reverb, at a given wetness. */
  function out(node, gain, wet) {
    var g = ctx.createGain();
    g.gain.value = gain == null ? 1 : gain;
    node.connect(g);
    g.connect(master);
    if (wet) {
      var w = ctx.createGain();
      w.gain.value = wet;
      node.connect(w);
      w.connect(verb);
    }
    return g;
  }

  function env(param, t0, peak, attack, decay, hold) {
    param.setValueAtTime(0.0001, t0);
    param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    if (hold) param.setValueAtTime(Math.max(0.0002, peak), t0 + attack + hold);
    param.exponentialRampToValueAtTime(0.0001, t0 + attack + (hold || 0) + decay);
  }

  /* ---------------- voices ---------------- */

  /** A cricket: a high sine chopped into a burst of pulses. */
  function cricket(t0, pan) {
    var osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = rand(4200, 5200);
    var chop = ctx.createOscillator();
    chop.type = "square";
    chop.frequency.value = rand(34, 48);
    var chopGain = ctx.createGain();
    chopGain.gain.value = 0.5;
    chop.connect(chopGain);

    var g = ctx.createGain();
    g.gain.value = 0;
    chopGain.connect(g.gain);
    osc.connect(g);

    var p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    var tail = g;
    if (p) { p.pan.value = pan; g.connect(p); tail = p; }
    var lvl = out(tail, 0.045, 0.25);
    env(lvl.gain, t0, 0.045, 0.02, 0.16, rand(0.08, 0.3));

    osc.start(t0); chop.start(t0);
    var stop = t0 + 0.7;
    osc.stop(stop); chop.stop(stop);
  }

  /** An owl: two soft breathy blips a fifth apart. */
  function owl(t0) {
    [0, 0.42].forEach(function (d, i) {
      var o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(i ? 330 : 420, t0 + d);
      o.frequency.exponentialRampToValueAtTime(i ? 300 : 380, t0 + d + 0.3);
      var lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 900;
      o.connect(lp);
      var g = out(lp, 0.1, 0.5);
      env(g.gain, t0 + d, 0.1, 0.06, 0.3, 0.06);
      o.start(t0 + d); o.stop(t0 + d + 0.6);
    });
  }

  /** A songbird: a cluster of quick upward chirps. */
  function bird(t0) {
    var n = Math.floor(rand(2, 5));
    for (var i = 0; i < n; i++) {
      var t = t0 + i * rand(0.07, 0.15);
      var o = ctx.createOscillator();
      o.type = "sine";
      var f = rand(2300, 3600);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * rand(1.2, 1.9), t + 0.05);
      o.frequency.exponentialRampToValueAtTime(f * 0.9, t + 0.09);
      var g = out(o, 0.05, 0.4);
      env(g.gain, t, 0.05, 0.008, 0.07);
      o.start(t); o.stop(t + 0.16);
    }
  }

  /** Wind or a river: brown noise under a slowly opening filter. */
  function bed(kind) {
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer(6, true);
    src.loop = true;
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = kind === "night" ? 320 : 620;
    var lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    var lfoGain = ctx.createGain();
    lfoGain.gain.value = kind === "night" ? 90 : 190;
    lfo.connect(lfoGain); lfoGain.connect(lp.frequency);
    src.connect(lp);
    var g = ctx.createGain();
    g.gain.value = kind === "night" ? 0.30 : 0.20;
    lp.connect(g); g.connect(bedGain);
    src.start(); lfo.start();
    return [src, lfo];
  }

  /* ---------------- one-shots ---------------- */

  var VOICES = {
    /* The one everybody is here for: a glide up, a long held note with a slow
     * vibrato, and a fall — on two saws detuned against each other so it beats
     * rather than sits still. */
    howl: function (t0) {
      // A mixing bus for the two saws. It has to pass signal — leaving it at
      // zero and shaping the stage after it renders a perfectly silent wolf.
      var g = ctx.createGain();
      g.gain.value = 0.5;
      var lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(700, t0);
      lp.frequency.linearRampToValueAtTime(1500, t0 + 0.7);
      lp.frequency.linearRampToValueAtTime(600, t0 + 2.6);
      g.connect(lp);
      var lvl = out(lp, 0.5, 0.9);

      var vib = ctx.createOscillator();
      vib.frequency.value = 5.2;
      var vibG = ctx.createGain();
      vibG.gain.value = 7;
      vib.connect(vibG);

      [0, 3].forEach(function (detune) {
        var o = ctx.createOscillator();
        o.type = "sawtooth";
        o.detune.value = detune;
        o.frequency.setValueAtTime(180, t0);
        o.frequency.exponentialRampToValueAtTime(430, t0 + 0.55);
        o.frequency.setValueAtTime(430, t0 + 1.7);
        o.frequency.exponentialRampToValueAtTime(190, t0 + 2.7);
        vibG.connect(o.frequency);
        o.connect(g);
        o.start(t0); o.stop(t0 + 2.9);
      });
      vib.start(t0); vib.stop(t0 + 2.9);
      env(lvl.gain, t0, 0.5, 0.35, 1.1, 1.2);
      duck(t0, 2.4);
    },

    /** A crow: a saw through a bandpass, chopped hard, two or three times. */
    crow: function (t0) {
      var n = Math.floor(rand(2, 4));
      for (var i = 0; i < n; i++) {
        var t = t0 + i * rand(0.24, 0.4);
        var o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(rand(320, 400), t);
        o.frequency.exponentialRampToValueAtTime(rand(180, 230), t + 0.22);
        var bp = ctx.createBiquadFilter();
        bp.type = "bandpass"; bp.frequency.value = 1400; bp.Q.value = 3;
        var am = ctx.createOscillator();
        am.type = "square"; am.frequency.value = 62;
        var amG = ctx.createGain(); amG.gain.value = 0.4;
        am.connect(amG);
        o.connect(bp);
        var g = out(bp, 0.22, 0.6);
        amG.connect(g.gain);
        env(g.gain, t, 0.22, 0.012, 0.18, 0.02);
        o.start(t); o.stop(t + 0.3);
        am.start(t); am.stop(t + 0.3);
      }
      duck(t0, 1.0);
    },

    /** Knuckles on a door: a click through a woody resonance. */
    knock: function (t0) {
      [0, 0.13].forEach(function (d) {
        var src = ctx.createBufferSource();
        src.buffer = noiseBuffer(0.1, false);
        var bp = ctx.createBiquadFilter();
        // A narrow band takes most of the energy out of a click, so the gain
        // has to be well above what looks reasonable on paper.
        bp.type = "bandpass"; bp.frequency.value = rand(180, 240); bp.Q.value = 4;
        src.connect(bp);
        var g = out(bp, 1.6, 0.3);
        env(g.gain, t0 + d, 1.6, 0.004, 0.12);
        src.start(t0 + d); src.stop(t0 + d + 0.16);
      });
    },

    /** The verdict bell: a struck partial stack with a long tail. */
    bell: function (t0) {
      [1, 2.76, 5.4].forEach(function (mult, i) {
        var o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = 300 * mult;
        var g = out(o, 0.26 / (i + 1), 0.8);
        env(g.gain, t0, 0.26 / (i + 1), 0.005, 3.2 / (i + 1));
        o.start(t0); o.stop(t0 + 3.4);
      });
      duck(t0, 1.4);
    },

    /** Somebody died: a low fall with a breath of noise under it. */
    death: function (t0) {
      var o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.setValueAtTime(190, t0);
      o.frequency.exponentialRampToValueAtTime(48, t0 + 1.5);
      var g = out(o, 0.35, 0.7);
      env(g.gain, t0, 0.35, 0.02, 1.4);
      o.start(t0); o.stop(t0 + 1.6);

      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer(1.2, false);
      var lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 500;
      src.connect(lp);
      var ng = out(lp, 0.2, 0.5);
      env(ng.gain, t0, 0.2, 0.05, 0.9);
      src.start(t0); src.stop(t0 + 1.2);
      duck(t0, 1.6);
    },

    /** Saved: a rising pair, deliberately small. Relief, not a fanfare. */
    saved: function (t0) {
      [440, 660].forEach(function (f, i) {
        var o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        var g = out(o, 0.14, 0.6);
        env(g.gain, t0 + i * 0.1, 0.14, 0.02, 0.4);
        o.start(t0 + i * 0.1); o.stop(t0 + i * 0.1 + 0.5);
      });
    },

    /** The clock is nearly out: two low thumps, once a second. */
    heart: function (t0) {
      [0, 0.22].forEach(function (d, i) {
        var o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.setValueAtTime(78, t0 + d);
        o.frequency.exponentialRampToValueAtTime(46, t0 + d + 0.16);
        var g = out(o, i ? 0.14 : 0.2, 0.15);
        env(g.gain, t0 + d, i ? 0.14 : 0.2, 0.01, 0.16);
        o.start(t0 + d); o.stop(t0 + d + 0.22);
      });
    },

    /** A door in the interface. Softer than a knock, drier. */
    tap: function (t0) {
      var o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(620, t0);
      o.frequency.exponentialRampToValueAtTime(300, t0 + 0.06);
      var g = out(o, 0.12, 0.1);
      env(g.gain, t0, 0.12, 0.004, 0.07);
      o.start(t0); o.stop(t0 + 0.12);
    },

    /** Dawn: a slow open fifth, the one warm sound in the set. */
    dawn: function (t0) {
      [262, 392, 523].forEach(function (f, i) {
        var o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = f;
        var g = out(o, 0.1, 0.9);
        env(g.gain, t0 + i * 0.28, 0.1, 0.5, 1.8);
        o.start(t0 + i * 0.28); o.stop(t0 + i * 0.28 + 2.6);
      });
      duck(t0, 2.0);
    }
  };

  /** Pull the ambience down under a one-shot and let it back up after. */
  function duck(t0, seconds) {
    if (!bedGain) return;
    var g = bedGain.gain;
    var target = sceneLevel();
    g.cancelScheduledValues(t0);
    g.setValueAtTime(g.value, t0);
    g.linearRampToValueAtTime(target * 0.35, t0 + 0.12);
    g.linearRampToValueAtTime(target, t0 + seconds);
  }

  function sceneLevel() {
    if (!enabled || !scene) return 0;
    return scene === "night" ? 0.55 : 0.4;
  }

  /* ---------------- the ambient bed ---------------- */

  function stopBed() {
    bedNodes.forEach(function (n) { try { n.stop(); } catch (e) { /* already stopped */ } });
    bedNodes = [];
    clearTimeout(timer);
    timer = null;
  }

  /**
   * Swap the ambience. `night` is crickets, an owl and low wind; `day` is
   * birds and a lighter breeze; `none` is silence, for the lobby and the
   * end of the game.
   */
  function setScene(next) {
    if (!enabled) { scene = next; return; }
    if (!init()) return;
    if (next === scene) return;
    scene = next;
    stopBed();
    if (!next || next === "none") {
      bedGain.gain.linearRampToValueAtTime(0, now() + 1.2);
      return;
    }
    bedNodes = bed(next);
    bedGain.gain.cancelScheduledValues(now());
    bedGain.gain.setValueAtTime(bedGain.gain.value, now());
    bedGain.gain.linearRampToValueAtTime(sceneLevel(), now() + 2.5);
    schedule();
  }

  /* Chirps are scheduled a little ahead in real time rather than sequenced, so
   * the bed never falls into a loop you can hear repeating. */
  function schedule() {
    if (!scene || scene === "none" || !enabled) return;
    var t = now() + 0.05;
    if (scene === "night") {
      var n = Math.floor(rand(2, 5));
      for (var i = 0; i < n; i++) cricket(t + rand(0, 2.4), rand(-0.8, 0.8));
      if (Math.random() < 0.14) owl(t + rand(0.5, 2));
    } else {
      if (Math.random() < 0.75) bird(t + rand(0, 2));
      if (Math.random() < 0.2) bird(t + rand(1, 2.8));
    }
    timer = setTimeout(schedule, rand(1600, 3200));
  }

  /* ---------------- public ---------------- */

  function play(name) {
    if (!enabled || !started) return;
    if (!init()) return;
    var v = VOICES[name];
    if (v) v(now() + 0.02);
  }

  /** Browsers will not make a sound until the player has touched something. */
  function unlock() {
    if (started) return;
    if (!init()) return;
    // resume() rejects on a context that cannot be resumed (an offline one, a
    // closed one). Neither is a reason to leave the game silent afterwards.
    try {
      if (ctx.state === "suspended" && ctx.resume) {
        var r = ctx.resume();
        if (r && r.catch) r.catch(function () { /* stays suspended; nothing to do */ });
      }
    } catch (e) { /* not resumable */ }
    started = true;
    if (scene) { var s = scene; scene = null; setScene(s); }
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!ctx) return;
    master.gain.linearRampToValueAtTime(enabled ? 0.9 : 0, now() + 0.25);
    if (!enabled) stopBed();
    else if (scene) { var s = scene; scene = null; setScene(s); }
  }

  WG.sound = {
    unlock: unlock, play: play, scene: setScene, setEnabled: setEnabled,
    get enabled() { return enabled; },
    get ready() { return started; },
    voices: Object.keys(VOICES)
  };
})(typeof window !== "undefined" ? window : globalThis);

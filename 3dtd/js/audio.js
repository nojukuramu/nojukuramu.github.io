/* ============================================================
   VELL — fully synthesised audio (no samples)
   ============================================================ */
(function (TD) {
  'use strict';

  var A = TD.audio = {};
  var ctx = null, master, sfxBus, ambBus, comp;
  var noiseBuf = null;
  var lastPlay = {};
  var started = false;
  var enabled = true;
  var ambient = {};

  var MIN_GAP = {
    shoot: 0.045, hit: 0.05, beam: 0.09, arc: 0.10, lance: 0.09, aura: 0.22,
    trap: 0.13, die: 0.07, clash: 0.14, basehit: 0.2, blast: 0.16
  };

  function makeNoise() {
    var len = ctx.sampleRate * 2;
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  A.init = function () {
    if (ctx) return true;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.85;
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 22; comp.ratio.value = 5;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.55;
    ambBus = ctx.createGain(); ambBus.gain.value = 0.32;
    sfxBus.connect(comp); ambBus.connect(comp);
    comp.connect(master); master.connect(ctx.destination);
    noiseBuf = makeNoise();
    A.ctx = ctx;
    return true;
  };

  A.resume = function () {
    if (!ctx) A.init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    if (ctx && !started) { started = true; startAmbient(); }
  };

  A.setEnabled = function (v) {
    enabled = v;
    if (master) master.gain.setTargetAtTime(v ? 0.85 : 0.0, ctx.currentTime, 0.1);
  };
  A.isEnabled = function () { return enabled; };

  /* ---------- primitives ---------- */
  function env(node, t0, a, d, peak, sustain, rel, dur) {
    var g = node.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
    g.exponentialRampToValueAtTime(Math.max(sustain, 0.0002), t0 + a + d);
    g.setValueAtTime(Math.max(sustain, 0.0002), t0 + Math.max(dur, a + d));
    g.exponentialRampToValueAtTime(0.0001, t0 + Math.max(dur, a + d) + rel);
  }

  function tone(opt) {
    if (!ctx || !enabled) return;
    var t0 = ctx.currentTime + (opt.delay || 0);
    var osc = ctx.createOscillator();
    osc.type = opt.type || 'sine';
    osc.frequency.setValueAtTime(opt.f0, t0);
    if (opt.f1 !== undefined) {
      if (opt.expo === false) osc.frequency.linearRampToValueAtTime(opt.f1, t0 + (opt.dur || 0.2));
      else osc.frequency.exponentialRampToValueAtTime(Math.max(opt.f1, 1), t0 + (opt.dur || 0.2));
    }
    var g = ctx.createGain();
    var filt = null;
    if (opt.filter) {
      filt = ctx.createBiquadFilter();
      filt.type = opt.filterType || 'lowpass';
      filt.frequency.setValueAtTime(opt.filter, t0);
      if (opt.filter1) filt.frequency.exponentialRampToValueAtTime(Math.max(opt.filter1, 40), t0 + (opt.dur || 0.2));
      filt.Q.value = opt.q || 1;
      osc.connect(filt); filt.connect(g);
    } else {
      osc.connect(g);
    }
    g.connect(opt.bus || sfxBus);
    var dur = opt.dur || 0.2;
    env(g, t0, opt.attack || 0.005, opt.decay || dur * 0.5, opt.gain || 0.3, (opt.gain || 0.3) * (opt.sustain || 0.15), opt.release || 0.08, dur);
    osc.start(t0);
    osc.stop(t0 + dur + (opt.release || 0.08) + 0.05);
    if (opt.detune) osc.detune.value = opt.detune;
  }

  function noise(opt) {
    if (!ctx || !enabled) return;
    var t0 = ctx.currentTime + (opt.delay || 0);
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    var filt = ctx.createBiquadFilter();
    filt.type = opt.filterType || 'bandpass';
    filt.frequency.setValueAtTime(opt.f0 || 800, t0);
    if (opt.f1) filt.frequency.exponentialRampToValueAtTime(Math.max(opt.f1, 40), t0 + (opt.dur || 0.2));
    filt.Q.value = opt.q || 1.2;
    var g = ctx.createGain();
    src.connect(filt); filt.connect(g); g.connect(opt.bus || sfxBus);
    var dur = opt.dur || 0.2;
    env(g, t0, opt.attack || 0.004, opt.decay || dur * 0.6, opt.gain || 0.25, (opt.gain || 0.25) * 0.1, opt.release || 0.08, dur);
    src.start(t0);
    src.stop(t0 + dur + 0.2);
  }

  /* ---------- ambience ---------- */
  function startAmbient() {
    if (!ctx) return;
    // wind / moor bed
    var wind = ctx.createBufferSource();
    wind.buffer = noiseBuf; wind.loop = true;
    var wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 420; wf.Q.value = 0.6;
    var wg = ctx.createGain(); wg.gain.value = 0.20;
    wind.connect(wf); wf.connect(wg); wg.connect(ambBus);
    wind.start();
    var lfo = ctx.createOscillator(); lfo.frequency.value = 0.06;
    var lfoG = ctx.createGain(); lfoG.gain.value = 180;
    lfo.connect(lfoG); lfoG.connect(wf.frequency); lfo.start();

    // water shimmer
    var wat = ctx.createBufferSource(); wat.buffer = noiseBuf; wat.loop = true;
    var watF = ctx.createBiquadFilter(); watF.type = 'bandpass'; watF.frequency.value = 2400; watF.Q.value = 0.8;
    var watG = ctx.createGain(); watG.gain.value = 0.035;
    wat.connect(watF); watF.connect(watG); watG.connect(ambBus); wat.start();

    // slow drone pad — two detuned saws through a lowpass
    var padG = ctx.createGain(); padG.gain.value = 0.0;
    var padF = ctx.createBiquadFilter(); padF.type = 'lowpass'; padF.frequency.value = 520; padF.Q.value = 3;
    padG.connect(ambBus);
    padF.connect(padG);
    var freqs = [55, 82.5, 110, 164.8];
    for (var i = 0; i < freqs.length; i++) {
      var o = ctx.createOscillator();
      o.type = i % 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = freqs[i];
      o.detune.value = (i - 1.5) * 7;
      var og = ctx.createGain(); og.gain.value = 0.16 / (i + 1);
      o.connect(og); og.connect(padF); o.start();
    }
    var padLfo = ctx.createOscillator(); padLfo.frequency.value = 0.045;
    var padLfoG = ctx.createGain(); padLfoG.gain.value = 260;
    padLfo.connect(padLfoG); padLfoG.connect(padF.frequency); padLfo.start();

    ambient = { windG: wg, watG: watG, padG: padG, padF: padF };
    padG.gain.setTargetAtTime(0.22, ctx.currentTime, 3.0);

    scheduleCritters();
  }

  var critterTimer = null;
  function scheduleCritters() {
    if (critterTimer) clearTimeout(critterTimer);
    var night = TD.sky ? TD.sky.night : 0;
    var delay = 900 + Math.random() * (night > 0.5 ? 1800 : 4200);
    critterTimer = setTimeout(function () {
      if (ctx && enabled && !document.hidden) {
        if (night > 0.45) {
          // night chorus: short chirp cluster
          for (var i = 0; i < 3; i++) {
            tone({
              f0: 2400 + Math.random() * 900, f1: 2100, type: 'triangle', dur: 0.05,
              gain: 0.05, delay: i * 0.07, bus: ambBus, filter: 5200
            });
          }
        } else {
          // day: a distant bird / creak
          tone({
            f0: 700 + Math.random() * 500, f1: 1200 + Math.random() * 600, type: 'sine',
            dur: 0.16, gain: 0.055, bus: ambBus, filter: 2800
          });
        }
      }
      scheduleCritters();
    }, delay);
  }

  A.updateAmbient = function (night, waterNear) {
    if (!ambient.padG || !ctx) return;
    ambient.padF.frequency.setTargetAtTime(360 + (1 - night) * 420, ctx.currentTime, 2.0);
    ambient.windG.gain.setTargetAtTime(0.13 + night * 0.10, ctx.currentTime, 2.0);
    ambient.watG.gain.setTargetAtTime(0.02 + (waterNear || 0) * 0.05, ctx.currentTime, 1.5);
  };

  /* ---------- sfx table ---------- */
  var SFX = {
    shoot: function () {
      tone({ f0: 640, f1: 190, type: 'triangle', dur: 0.11, gain: 0.16, filter: 2600, filter1: 700 });
      noise({ f0: 2400, f1: 700, dur: 0.07, gain: 0.05 });
    },
    hit: function () { noise({ f0: 1700, f1: 480, dur: 0.09, gain: 0.09, q: 0.8 }); },
    beam: function () {
      tone({ f0: 1500, f1: 1180, type: 'sawtooth', dur: 0.07, gain: 0.055, filter: 3200, filter1: 1400 });
    },
    arc: function () {
      tone({ f0: 300, f1: 1900, type: 'square', dur: 0.11, gain: 0.09, filter: 3600 });
      noise({ f0: 4200, f1: 1400, dur: 0.13, gain: 0.07 });
    },
    lance: function () {
      tone({ f0: 220, f1: 90, type: 'sawtooth', dur: 0.2, gain: 0.15, filter: 1600, filter1: 420 });
      noise({ f0: 900, f1: 260, dur: 0.18, gain: 0.09 });
    },
    aura: function () { tone({ f0: 120, f1: 74, type: 'sine', dur: 0.5, gain: 0.11, filter: 620 }); },
    trap: function () { tone({ f0: 180, f1: 62, type: 'square', dur: 0.16, gain: 0.10, filter: 900, filter1: 250 }); },
    blast: function () {
      noise({ f0: 900, f1: 90, dur: 0.5, gain: 0.26, filterType: 'lowpass', q: 1.4 });
      tone({ f0: 140, f1: 38, type: 'sine', dur: 0.45, gain: 0.24 });
    },
    place: function () {
      tone({ f0: 300, f1: 620, type: 'triangle', dur: 0.16, gain: 0.14, filter: 2400 });
      tone({ f0: 620, f1: 940, type: 'sine', dur: 0.2, gain: 0.09, delay: 0.05 });
    },
    upgrade: function () {
      tone({ f0: 440, f1: 660, type: 'triangle', dur: 0.14, gain: 0.13 });
      tone({ f0: 660, f1: 990, type: 'sine', dur: 0.22, gain: 0.10, delay: 0.09 });
    },
    promote: function () {
      var notes = [392, 523.25, 659.25, 783.99, 1046.5];
      for (var i = 0; i < notes.length; i++) {
        tone({ f0: notes[i], type: 'triangle', dur: 0.24, gain: 0.11, delay: i * 0.075, filter: 3400, release: 0.4 });
      }
      noise({ f0: 5200, f1: 1200, dur: 0.5, gain: 0.06 });
    },
    sell: function () { tone({ f0: 700, f1: 240, type: 'sine', dur: 0.2, gain: 0.11 }); },
    break: function () {
      noise({ f0: 1400, f1: 180, dur: 0.4, gain: 0.2, filterType: 'lowpass' });
      tone({ f0: 160, f1: 48, type: 'square', dur: 0.3, gain: 0.13, filter: 700 });
    },
    die: function () {
      noise({ f0: 1200, f1: 260, dur: 0.22, gain: 0.11 });
      tone({ f0: 260, f1: 70, type: 'sawtooth', dur: 0.24, gain: 0.09, filter: 1200, filter1: 300 });
    },
    bossdie: function () {
      noise({ f0: 800, f1: 60, dur: 1.3, gain: 0.3, filterType: 'lowpass' });
      tone({ f0: 120, f1: 28, type: 'sawtooth', dur: 1.2, gain: 0.22, filter: 900, filter1: 120 });
      tone({ f0: 60, f1: 22, type: 'sine', dur: 1.6, gain: 0.2 });
    },
    boss: function () {
      tone({ f0: 46, f1: 40, type: 'sawtooth', dur: 1.6, gain: 0.24, filter: 340, release: 0.6 });
      tone({ f0: 92, f1: 78, type: 'square', dur: 1.4, gain: 0.10, filter: 500, delay: 0.1 });
      noise({ f0: 260, f1: 90, dur: 1.5, gain: 0.10, filterType: 'lowpass' });
    },
    basehit: function () {
      tone({ f0: 90, f1: 40, type: 'sine', dur: 0.5, gain: 0.28 });
      noise({ f0: 500, f1: 90, dur: 0.4, gain: 0.14, filterType: 'lowpass' });
    },
    clash: function () {
      noise({ f0: 2600, f1: 900, dur: 0.11, gain: 0.10, q: 2.2 });
      tone({ f0: 380, f1: 190, type: 'square', dur: 0.09, gain: 0.06 });
    },
    wave: function () {
      var n = [110, 146.83, 174.61, 220];
      for (var i = 0; i < n.length; i++) tone({ f0: n[i], type: 'sawtooth', dur: 0.5, gain: 0.09, delay: i * 0.14, filter: 900, release: 0.5 });
      noise({ f0: 300, f1: 120, dur: 1.2, gain: 0.09, filterType: 'lowpass' });
    },
    clear: function () {
      var n = [523.25, 659.25, 783.99, 1046.5];
      for (var i = 0; i < n.length; i++) tone({ f0: n[i], type: 'triangle', dur: 0.35, gain: 0.10, delay: i * 0.1, release: 0.5, filter: 4000 });
    },
    ui: function () { tone({ f0: 880, f1: 1320, type: 'sine', dur: 0.05, gain: 0.06 }); },
    bad: function () { tone({ f0: 220, f1: 110, type: 'square', dur: 0.14, gain: 0.09, filter: 900 }); },
    lore: function () {
      tone({ f0: 196, type: 'sine', dur: 0.6, gain: 0.09, release: 0.6, filter: 1400 });
      tone({ f0: 293.66, type: 'sine', dur: 0.6, gain: 0.07, delay: 0.12, release: 0.6, filter: 1400 });
      tone({ f0: 440, type: 'triangle', dur: 0.5, gain: 0.05, delay: 0.24, release: 0.6, filter: 2400 });
    },
    over: function () {
      tone({ f0: 220, f1: 55, type: 'sawtooth', dur: 2.0, gain: 0.2, filter: 800, filter1: 120, release: 1.0 });
      noise({ f0: 400, f1: 60, dur: 2.2, gain: 0.14, filterType: 'lowpass' });
    }
  };

  A.play = function (key) {
    if (!ctx || !enabled) return;
    var now = ctx.currentTime;
    var gap = MIN_GAP[key] || 0;
    if (gap && lastPlay[key] && now - lastPlay[key] < gap) return;
    lastPlay[key] = now;
    var f = SFX[key];
    if (f) f();
  };

})(window.TD);

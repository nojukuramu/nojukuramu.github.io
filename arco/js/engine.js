/* ARCO — engine.js
 * Audio graph, instrument presets, and the bridge to the DSP worklet.
 *
 *   strings (AudioWorklet)  ->  body resonators  -+->  dry  -+->  limiter -> out
 *                                                 \-> verb -/
 *
 * The waveguide gives us a raw string. Real instruments are a string plus a
 * resonating box, and the box is most of what you actually recognise, so the
 * two presets differ mostly in their body filters and decay.
 */
window.ARCO = window.ARCO || {};
(function (A) {
  "use strict";

  var PRESETS = {
    guitar: {
      label: "Pluck",
      sustain: 0.9993,
      bright: 0.62,
      bowForce: 0.5,
      bowPosRange: [0.06, 0.28],   // pick position: neck -> bridge
      level: 0.42,
      wet: 0.16,
      verbTime: 1.5,
      bendRange: 2,
      body: [
        { type: "peaking",   f: 100,  Q: 1.1, g: 6 },
        { type: "peaking",   f: 215,  Q: 1.4, g: 4 },
        { type: "peaking",   f: 420,  Q: 2.0, g: 3 },
        { type: "highshelf", f: 3200, Q: 0.7, g: -2 }
      ]
    },
    violin: {
      label: "Bow",
      sustain: 0.9975,
      bright: 0.5,
      bowForce: 0.55,
      bowPosRange: [0.04, 0.20],   // sul tasto -> sul ponticello
      level: 0.45,
      wet: 0.34,
      verbTime: 2.6,
      bendRange: 1,
      body: [
        { type: "peaking",  f: 275,  Q: 1.2, g: 5 },   // A0 air resonance
        { type: "peaking",  f: 460,  Q: 1.5, g: 6 },   // main wood
        { type: "peaking",  f: 3000, Q: 0.8, g: 5 },   // bridge hill
        { type: "highpass", f: 140,  Q: 0.7, g: 0 }
      ]
    }
  };

  var ctx = null;
  var node = null;
  var bodyChain = [];
  var dry = null, wet = null, verb = null, master = null;
  var ready = false;
  var preset = PRESETS.guitar;
  var energy = [0, 0, 0, 0];
  var noiseBuf = null;

  function makeImpulse(seconds) {
    var len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    var buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c);
      for (var i = 0; i < len; i++) {
        var t = i / len;
        /* Slightly sparse early part, smooth exponential tail. */
        var env = Math.pow(1 - t, 2.6);
        d[i] = (Math.random() * 2 - 1) * env;
      }
    }
    return buf;
  }

  function makeNoise() {
    var len = Math.floor(ctx.sampleRate * 0.4);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  function applyBody() {
    for (var i = 0; i < bodyChain.length; i++) {
      var f = bodyChain[i], s = preset.body[i];
      f.type = s.type;
      f.frequency.setTargetAtTime(s.f, ctx.currentTime, 0.02);
      f.Q.setTargetAtTime(s.Q, ctx.currentTime, 0.02);
      f.gain.setTargetAtTime(s.g, ctx.currentTime, 0.02);
    }
  }

  function param(name) {
    return node.parameters.get(name);
  }

  function init() {
    if (ctx) return Promise.resolve(ready);
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return Promise.reject(new Error("Web Audio is not available in this browser."));
    ctx = new AC({ latencyHint: "interactive" });
    if (!ctx.audioWorklet) {
      return Promise.reject(new Error("This browser has no AudioWorklet, which ARCO's string model needs."));
    }

    return ctx.audioWorklet.addModule("js/dsp-worklet.js").then(function () {
      node = new AudioWorkletNode(ctx, "arco-strings", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });
      node.port.onmessage = function (e) {
        if (e.data && e.data.type === "energy") energy = e.data.e;
      };

      bodyChain = [];
      for (var i = 0; i < 4; i++) bodyChain.push(ctx.createBiquadFilter());
      for (var j = 0; j < bodyChain.length - 1; j++) bodyChain[j].connect(bodyChain[j + 1]);
      node.connect(bodyChain[0]);
      var bodyOut = bodyChain[bodyChain.length - 1];

      dry = ctx.createGain();
      wet = ctx.createGain();
      verb = ctx.createConvolver();
      master = ctx.createDynamicsCompressor();
      master.threshold.value = -8;
      master.knee.value = 6;
      master.ratio.value = 8;
      master.attack.value = 0.003;
      master.release.value = 0.2;

      verb.buffer = makeImpulse(preset.verbTime);
      bodyOut.connect(dry);
      bodyOut.connect(verb);
      verb.connect(wet);
      dry.connect(master);
      wet.connect(master);
      master.connect(ctx.destination);

      dry.gain.value = 1;
      wet.gain.value = preset.wet;
      noiseBuf = makeNoise();

      applyBody();
      applyPreset();
      ready = true;
      return true;
    });
  }

  function applyPreset() {
    if (!ready && !node) return;
    param("sustain").setTargetAtTime(preset.sustain, ctx.currentTime, 0.02);
    param("bright").setTargetAtTime(preset.bright, ctx.currentTime, 0.02);
    param("bowForce").setTargetAtTime(preset.bowForce, ctx.currentTime, 0.02);
    param("level").setTargetAtTime(preset.level, ctx.currentTime, 0.02);
  }

  function setInstrument(name) {
    preset = PRESETS[name] || PRESETS.guitar;
    if (!node) return;
    applyBody();
    applyPreset();
    wet.gain.setTargetAtTime(preset.wet, ctx.currentTime, 0.05);
    verb.buffer = makeImpulse(preset.verbTime);
    node.port.postMessage({ type: "clear" });
  }

  function resume() {
    if (ctx && ctx.state !== "running") return ctx.resume();
    return Promise.resolve();
  }

  function setFreq(i, hz) {
    if (!node) return;
    var p = param("freq" + i);
    /* The worklet glides internally, so a plain set is click-free and cheap. */
    p.setValueAtTime(Math.max(38, Math.min(4000, hz)), ctx.currentTime);
  }

  function setBow(i, v, fast) {
    if (!node) return;
    param("bow" + i).setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, fast ? 0.004 : 0.02);
  }

  function pluck(i, amp, tone) {
    if (!node) return;
    node.port.postMessage({ type: "pluck", s: i, amp: amp, tone: tone });
  }

  function damp(i, amt) {
    if (!node) return;
    node.port.postMessage({ type: "damp", s: i, amt: amt });
  }

  /* Percussive hit on the instrument body — triggered by tapping the phone. */
  function bodyHit(amp) {
    if (!ready) return;
    var t = ctx.currentTime;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    var bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 150 + Math.random() * 60;
    bp.Q.value = 2.2;
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(amp * 0.7, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.28);
    src.connect(bp); bp.connect(lp); lp.connect(g);
    g.connect(dry); g.connect(verb);
    src.start(t);
    src.stop(t + 0.35);
  }

  /* Continuous controls shared by both hands and the tilt sensors. */
  function setContact(pos01) {
    if (!node) return;
    var r = preset.bowPosRange;
    var v = r[0] + (r[1] - r[0]) * Math.max(0, Math.min(1, pos01));
    param("bowPos").setTargetAtTime(v, ctx.currentTime, 0.03);
  }

  function setBright(v) {
    if (!node) return;
    param("bright").setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, 0.03);
  }

  function setBowForce(v) {
    if (!node) return;
    param("bowForce").setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, 0.03);
  }

  A.engine = {
    PRESETS: PRESETS,
    init: init,
    resume: resume,
    isReady: function () { return ready; },
    context: function () { return ctx; },
    setInstrument: setInstrument,
    preset: function () { return preset; },
    setFreq: setFreq,
    setBow: setBow,
    pluck: pluck,
    damp: damp,
    bodyHit: bodyHit,
    setContact: setContact,
    setBright: setBright,
    setBowForce: setBowForce,
    energy: function () { return energy; },
    /* Final node before the speakers — for metering and level checks. */
    output: function () { return master; }
  };
})(window.ARCO);

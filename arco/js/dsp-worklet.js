/* ARCO — dsp-worklet.js
 *
 * Four digital-waveguide strings. Each string is a pair of delay lines split at
 * a contact point (the bow/pick position), with a damping filter at the bridge
 * and a hard reflection at the nut. That single structure covers both
 * instruments: feed it a noise burst and it is plucked, feed it a bow-friction
 * nonlinearity and it is bowed. Nothing here is a sample — the strings are
 * actually vibrating, which is why bends, slides and double-stops behave.
 *
 * Bow friction follows the classic Smith / STK bowed-string model: the
 * difference between bow velocity and string velocity is passed through a
 * sharply-peaked friction curve, so the string sticks to the bow and then slips
 * (Helmholtz motion). Stop moving your thumb and the note genuinely dies.
 */

var NUM_STRINGS = 4;
var MIN_FREQ = 38;
/* The excitation is written in musical 0..1 terms at the call sites; this is
 * what turns that into an amplitude the waveguide actually rings at. Tuned so a
 * hard pluck and a fast bow stroke land at roughly the same loudness. */
var EXC_GAIN = 10;

function Delay(max) {
  this.buf = new Float32Array(max);
  this.max = max;
  this.w = 0;
  this.d = 8;
  this.out = 0;
}
Delay.prototype.setDelay = function (d) {
  if (!(d >= 1)) d = 1;
  if (d > this.max - 2) d = this.max - 2;
  this.d = d;
};
Delay.prototype.tick = function (x) {
  var buf = this.buf, max = this.max;
  buf[this.w] = x;
  var rp = this.w - this.d;
  while (rp < 0) rp += max;
  var i = rp | 0;
  var f = rp - i;
  var a = buf[i];
  var b = buf[(i + 1) % max];
  this.out = a + (b - a) * f;
  this.w = (this.w + 1) % max;
  return this.out;
};
Delay.prototype.clear = function () {
  this.buf.fill(0);
  this.out = 0;
};

function StringVoice(sr) {
  var max = Math.ceil(sr / MIN_FREQ) + 4;
  this.sr = sr;
  this.neck = new Delay(max);
  this.bridge = new Delay(max);

  this.lp = 0;          // bridge damping filter state
  this.dc1 = 0;         // DC blocker
  this.dc2 = 0;

  this.pending = null;  // pluck queued from the message port
  this.exc = 0;         // remaining excitation samples
  this.excLen = 1;
  this.excAmp = 0;
  this.excLp = 0;
  this.excTone = 0.5;

  this.gain = 1;        // mute envelope
  this.gainTarget = 1;

  this.freq = 220;
  this.freqSmooth = 220;
  this.energy = 0;      // cheap RMS follower, reported back to the UI
}

/* Queued, not applied immediately: the excitation length depends on the note
 * the string is about to play, and that is only known inside process() where
 * the frequency parameter is readable. Plucking off a stale pitch made the
 * first note of a session swoop up into tune. */
StringVoice.prototype.pluck = function (amp, tone) {
  this.pending = { amp: amp, tone: tone };
  this.gainTarget = 1;
  this.gain = 1;
};

StringVoice.prototype.startPluck = function (freq) {
  var p = this.pending;
  this.pending = null;
  /* A silent string has no pitch to glide from, so start it in tune. */
  if (this.energy < 0.004) this.freqSmooth = freq;
  /* One period of shaped noise is the classic Karplus-Strong excitation. Capped
   * so low notes do not get a smeared, unfocused attack. */
  var period = this.sr / Math.max(MIN_FREQ, freq);
  this.excLen = Math.max(8, Math.min(period, this.sr * 0.018)) | 0;
  this.exc = this.excLen;
  this.excAmp = p.amp;
  this.excTone = p.tone;
  this.excLp = 0;
};

StringVoice.prototype.damp = function (amt) {
  this.gainTarget = 1 - 0.98 * amt;
};

StringVoice.prototype.clear = function () {
  this.neck.clear();
  this.bridge.clear();
  this.lp = this.dc1 = this.dc2 = 0;
  this.exc = 0;
  this.energy = 0;
};

/* Bow friction curve. `slope` rises as bow force falls, so a light bow slips
 * easily and a heavy bow grips. Clipped at 1 = fully stuck to the hair. */
function friction(dv, slope) {
  var s = Math.abs(dv * slope) + 0.75;
  var s2 = s * s;
  var f = 1 / (s2 * s2);
  return f > 1 ? 1 : f;
}

class ArcoProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    var p = [];
    for (var i = 0; i < NUM_STRINGS; i++) {
      p.push({ name: "freq" + i, defaultValue: 220, minValue: MIN_FREQ, maxValue: 4000, automationRate: "a-rate" });
      p.push({ name: "bow" + i, defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "a-rate" });
    }
    p.push({ name: "bowPos", defaultValue: 0.12, minValue: 0.02, maxValue: 0.45, automationRate: "k-rate" });
    p.push({ name: "bowForce", defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: "k-rate" });
    p.push({ name: "bright", defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: "k-rate" });
    p.push({ name: "sustain", defaultValue: 0.9985, minValue: 0.9, maxValue: 0.9999, automationRate: "k-rate" });
    p.push({ name: "level", defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: "k-rate" });
    return p;
  }

  constructor() {
    super();
    this.sr = sampleRate;
    this.voices = [];
    for (var i = 0; i < NUM_STRINGS; i++) this.voices.push(new StringVoice(this.sr));
    this.frame = 0;
    this.alive = true;
    this._energies = new Float64Array(NUM_STRINGS);
    this._report = { type: "energy", e: [0, 0, 0, 0] };

    this.port.onmessage = (e) => {
      var d = e.data;
      if (!d) return;
      if (d.type === "pluck") {
        var v = this.voices[d.s];
        if (v) v.pluck(d.amp, d.tone === undefined ? 0.5 : d.tone);
      } else if (d.type === "damp") {
        var w = this.voices[d.s];
        if (w) w.damp(d.amt);
      } else if (d.type === "clear") {
        for (var k = 0; k < this.voices.length; k++) this.voices[k].clear();
      } else if (d.type === "stop") {
        this.alive = false;
      }
    };
  }

  process(inputs, outputs, params) {
    var out = outputs[0];
    var L = out[0], R = out[1] || out[0];
    var n = L.length;

    var bowPos = params.bowPos[0];
    var bowForce = params.bowForce[0];
    var bright = params.bright[0];
    var sustain = params.sustain[0];
    var level = params.level[0];

    /* Bridge damping: brighter = less high-frequency loss per round trip. */
    var lpCoef = 0.62 - 0.5 * bright;
    if (lpCoef < 0.04) lpCoef = 0.04;
    /* Light bow -> high slope -> slips; heavy bow -> low slope -> grips. */
    var slope = 5.0 - 4.0 * bowForce;

    var energies = this._energies;
    var report = false;
    this.frame++;
    if (this.frame % 8 === 0) { energies.fill(0); report = true; }

    for (var s = 0; s < NUM_STRINGS; s++) {
      var v = this.voices[s];
      var fParam = params["freq" + s];
      var bParam = params["bow" + s];
      var fConst = fParam.length === 1;
      var bConst = bParam.length === 1;

      /* Pan the low strings left and the high strings right for a little width. */
      var pan = (s / (NUM_STRINGS - 1)) * 2 - 1;   // -1 .. 1  (bass .. treble)
      var gL = Math.cos((pan * 0.5 + 0.5) * Math.PI / 2);
      var gR = Math.sin((pan * 0.5 + 0.5) * Math.PI / 2);

      for (var i = 0; i < n; i++) {
        var f = fConst ? fParam[0] : fParam[i];
        var bowVel = bConst ? bParam[0] : bParam[i];

        if (v.pending) v.startPluck(f);

        /* Glide toward the target pitch. Instant jumps would click the delay
         * lines; this also gives slides and vibrato their smear. */
        v.freqSmooth += (f - v.freqSmooth) * 0.004;
        var total = this.sr / v.freqSmooth;
        v.neck.setDelay(total * bowPos);
        v.bridge.setDelay(total * (1 - bowPos));

        v.gain += (v.gainTarget - v.gain) * 0.0009;

        var bridgeOut = v.bridge.out;
        var neckOut = v.neck.out;

        /* Bridge: one-pole lowpass, phase-inverted reflection, slight loss. */
        v.lp = bridgeOut + lpCoef * (v.lp - bridgeOut);
        var bridgeRefl = -v.lp * sustain * (0.9 + 0.1 * v.gain);
        var nutRefl = -neckOut * 0.9995;

        var drive = 0;

        if (bowVel > 0.0008) {
          var stringVel = bridgeRefl + nutRefl;
          var dv = bowVel - stringVel;
          drive += dv * friction(dv, slope);
        }

        if (v.exc > 0) {
          var t = v.exc / v.excLen;
          var noise = Math.random() * 2 - 1;
          /* Darker pick tone = more lowpass on the excitation burst. */
          var a = 0.15 + 0.8 * v.excTone;
          v.excLp += (noise - v.excLp) * a;
          drive += v.excLp * v.excAmp * t * t * EXC_GAIN;
          v.exc--;
        }

        v.neck.tick(bridgeRefl + drive);
        var bo = v.bridge.tick(nutRefl + drive);

        /* DC blocker — the friction nonlinearity leaks offset. */
        var y = bo - v.dc1 + 0.995 * v.dc2;
        v.dc1 = bo;
        v.dc2 = y;

        y *= v.gain;

        if (report) energies[s] += y * y;

        var o = y * level;
        L[i] += o * gL;
        R[i] += o * gR;
      }

      if (report) {
        var rms = Math.sqrt(energies[s] / n);
        v.energy += (rms - v.energy) * 0.5;
      }
    }

    /* Soft clip so an over-excited string cannot spit. */
    for (var j = 0; j < n; j++) {
      var l = L[j], r = R[j];
      L[j] = l / (1 + Math.abs(l) * 0.7);
      R[j] = r / (1 + Math.abs(r) * 0.7);
    }

    if (report) {
      var msg = this._report;
      for (var q = 0; q < NUM_STRINGS; q++) msg.e[q] = this.voices[q].energy;
      this.port.postMessage(msg);
    }

    return this.alive;
  }
}

registerProcessor("arco-strings", ArcoProcessor);

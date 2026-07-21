/* audio.js
 * Fully procedural ambient soundscape — no audio files, everything is
 * synthesized in WebAudio: filtered-noise wind that breathes, songbird
 * chirps by day, cricket pulses by night, rain patter that follows the
 * weather system's intensity, and a faint traffic hum scaled by how many
 * cars are actually driving. The AudioContext can only start after a user
 * gesture, so init() arms a one-time pointerdown listener. A single master
 * gain implements the settings mute; the preference persists locally.
 */
(function (global) {
  "use strict";
  var util = Game.util;

  var Audio = {
    ctx: null,
    enabled: true,
    started: false,

    init: function () {
      try { this.enabled = localStorage.getItem("skyline:sound") !== "off"; } catch (e) {}
      var self = this;
      var unlock = function () {
        self._start();
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
      };
      window.addEventListener("pointerdown", unlock);
      window.addEventListener("keydown", unlock);
      return this;
    },

    setEnabled: function (on) {
      this.enabled = on;
      try { localStorage.setItem("skyline:sound", on ? "on" : "off"); } catch (e) {}
      if (this.master) {
        this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.2);
      }
    },

    _start: function () {
      if (this.started) return;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.started = true;
      var ctx = this.ctx = new AC();

      this.master = ctx.createGain();
      this.master.gain.value = this.enabled ? 1 : 0;
      this.master.connect(ctx.destination);

      // shared 2s noise buffer
      var len = ctx.sampleRate * 2;
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noiseBuf = buf;

      // wind: lowpassed noise, gain breathed by an LFO
      this.windGain = this._noiseVoice(380, "lowpass", 0.035);
      var lfo = ctx.createOscillator();
      lfo.frequency.value = 0.07;
      var lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.014;
      lfo.connect(lfoGain);
      lfoGain.connect(this.windGain.gain);
      lfo.start();

      // rain: bandpassed noise, silent until weather says otherwise
      this.rainGain = this._noiseVoice(2400, "bandpass", 0.0);

      // traffic: dark rumble, gain follows active vehicle count
      this.trafficGain = this._noiseVoice(160, "lowpass", 0.0);

      this._birdTimer = 2;
      this._cricketTimer = 1;
    },

    _noiseVoice: function (freq, type, gain) {
      var ctx = this.ctx;
      var src = ctx.createBufferSource();
      src.buffer = this._noiseBuf;
      src.loop = true;
      var filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = freq;
      var g = ctx.createGain();
      g.gain.value = gain;
      src.connect(filter);
      filter.connect(g);
      g.connect(this.master);
      src.start();
      return g;
    },

    // A short descending FM chirp — one synthesized bird call.
    _chirp: function () {
      var ctx = this.ctx;
      var t = ctx.currentTime;
      var notes = 1 + Math.floor(Math.random() * 3);
      for (var n = 0; n < notes; n++) {
        var start = t + n * (0.12 + Math.random() * 0.08);
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        var f0 = 2400 + Math.random() * 1600;
        osc.frequency.setValueAtTime(f0, start);
        osc.frequency.exponentialRampToValueAtTime(f0 * (0.6 + Math.random() * 0.25), start + 0.09);
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(0.022 + Math.random() * 0.012, start + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
        osc.connect(g);
        g.connect(this.master);
        osc.start(start);
        osc.stop(start + 0.13);
      }
    },

    // Cricket: a burst of rapid high pulses.
    _cricket: function () {
      var ctx = this.ctx;
      var t = ctx.currentTime;
      var pulses = 4 + Math.floor(Math.random() * 4);
      for (var n = 0; n < pulses; n++) {
        var start = t + n * 0.055;
        var osc = ctx.createOscillator();
        osc.frequency.value = 4100 + Math.random() * 400;
        var g = ctx.createGain();
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(0.008, start + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, start + 0.045);
        osc.connect(g);
        g.connect(this.master);
        osc.start(start);
        osc.stop(start + 0.05);
      }
    },

    update: function (dt) {
      if (!this.started || !this.enabled) return;
      var ctx = this.ctx;
      var night = Game.Lighting.nightFactor;
      var rain = Game.Weather.rainIntensity;

      this.rainGain.gain.setTargetAtTime(rain * 0.06, ctx.currentTime, 0.5);

      var cars = Game.Traffic.activePositions.length;
      this.trafficGain.gain.setTargetAtTime(Math.min(0.03, cars * 0.0022) * (1 - rain * 0.4), ctx.currentTime, 0.8);

      // birds by day (quiet in rain), crickets by night
      if (night < 0.45 && rain < 0.5) {
        this._birdTimer -= dt;
        if (this._birdTimer <= 0) {
          this._chirp();
          this._birdTimer = 2.5 + Math.random() * 6;
        }
      }
      if (night > 0.6) {
        this._cricketTimer -= dt;
        if (this._cricketTimer <= 0) {
          this._cricket();
          this._cricketTimer = 1.2 + Math.random() * 3;
        }
      }
    }
  };

  Game.Audio = Audio;
})(window);

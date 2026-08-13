/* audio.js — synthesised ringtones.
 *
 * No audio files ship with the app: every tone is built from oscillators, so
 * the whole thing stays a few kilobytes and works offline from first load.
 */
var Ringtone = (function () {
  'use strict';

  var _ctx = null;
  var _unlocked = false;
  var _active = [];

  /* Each tone is a list of {t, f, d, type, gain} notes plus a loop length.
   * t and d are seconds relative to the start of one repetition. */
  var TONES = {
    chime: {
      len: 2.4, label: 'Chime',
      notes: [
        { t: 0.00, f: 880, d: 0.9, type: 'sine', gain: 0.9 },
        { t: 0.22, f: 1174, d: 0.9, type: 'sine', gain: 0.7 },
        { t: 0.44, f: 1568, d: 1.2, type: 'sine', gain: 0.6 },
        { t: 0.90, f: 1046, d: 1.1, type: 'sine', gain: 0.5 }
      ]
    },
    bell: {
      len: 3.0, label: 'Bell',
      notes: [
        { t: 0.00, f: 660, d: 2.2, type: 'sine', gain: 1.0 },
        { t: 0.00, f: 1320, d: 1.6, type: 'sine', gain: 0.35 },
        { t: 0.00, f: 1980, d: 0.9, type: 'sine', gain: 0.18 },
        { t: 1.20, f: 660, d: 1.8, type: 'sine', gain: 0.7 },
        { t: 1.20, f: 1320, d: 1.2, type: 'sine', gain: 0.25 }
      ]
    },
    radar: {
      len: 2.0, label: 'Radar',
      notes: [
        { t: 0.00, f: 784, d: 0.18, type: 'triangle', gain: 0.9 },
        { t: 0.20, f: 988, d: 0.18, type: 'triangle', gain: 0.9 },
        { t: 0.40, f: 1175, d: 0.18, type: 'triangle', gain: 0.9 },
        { t: 0.60, f: 1568, d: 0.35, type: 'triangle', gain: 1.0 }
      ]
    },
    pulse: {
      len: 1.6, label: 'Pulse',
      notes: [
        { t: 0.00, f: 740, d: 0.12, type: 'square', gain: 0.55 },
        { t: 0.18, f: 740, d: 0.12, type: 'square', gain: 0.55 },
        { t: 0.36, f: 740, d: 0.12, type: 'square', gain: 0.55 },
        { t: 0.70, f: 988, d: 0.22, type: 'square', gain: 0.6 }
      ]
    },
    marimba: {
      len: 2.2, label: 'Marimba',
      notes: [
        { t: 0.00, f: 523, d: 0.4, type: 'triangle', gain: 0.9 },
        { t: 0.15, f: 659, d: 0.4, type: 'triangle', gain: 0.85 },
        { t: 0.30, f: 784, d: 0.4, type: 'triangle', gain: 0.8 },
        { t: 0.45, f: 1046, d: 0.6, type: 'triangle', gain: 0.9 },
        { t: 0.80, f: 784, d: 0.5, type: 'triangle', gain: 0.6 }
      ]
    },
    digital: {
      len: 1.4, label: 'Digital',
      notes: [
        { t: 0.00, f: 1200, d: 0.09, type: 'square', gain: 0.5 },
        { t: 0.12, f: 1600, d: 0.09, type: 'square', gain: 0.5 },
        { t: 0.30, f: 1200, d: 0.09, type: 'square', gain: 0.5 },
        { t: 0.42, f: 1600, d: 0.09, type: 'square', gain: 0.5 }
      ]
    },
    gentle: {
      len: 4.0, label: 'Gentle',
      notes: [
        { t: 0.00, f: 392, d: 1.8, type: 'sine', gain: 0.8 },
        { t: 0.90, f: 523, d: 1.8, type: 'sine', gain: 0.7 },
        { t: 1.80, f: 659, d: 2.0, type: 'sine', gain: 0.6 }
      ]
    },
    siren: {
      len: 2.0, label: 'Siren',
      sweep: true,
      notes: [
        { t: 0.00, f: 600, f2: 1200, d: 0.5, type: 'sawtooth', gain: 0.5 },
        { t: 0.50, f: 1200, f2: 600, d: 0.5, type: 'sawtooth', gain: 0.5 },
        { t: 1.00, f: 600, f2: 1200, d: 0.5, type: 'sawtooth', gain: 0.5 },
        { t: 1.50, f: 1200, f2: 600, d: 0.5, type: 'sawtooth', gain: 0.5 }
      ]
    }
  };

  function ctx() {
    if (!_ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { _ctx = new AC(); } catch (_) { return null; }
    }
    return _ctx;
  }

  /* Browsers only let audio start from a user gesture. Call this from the
   * first click/keypress so alarms can ring later without one. */
  function unlock() {
    var c = ctx();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(function () {});
    if (_unlocked) return;
    try {
      var osc = c.createOscillator();
      var g = c.createGain();
      g.gain.value = 0.0001;
      osc.connect(g);
      g.connect(c.destination);
      osc.start();
      osc.stop(c.currentTime + 0.02);
      _unlocked = true;
    } catch (_) {}
  }

  function isUnlocked() { return _unlocked; }

  function scheduleNote(c, master, note, startAt, volume) {
    var osc = c.createOscillator();
    var g = c.createGain();
    osc.type = note.type || 'sine';
    osc.frequency.setValueAtTime(note.f, startAt);
    if (note.f2) osc.frequency.linearRampToValueAtTime(note.f2, startAt + note.d);

    var peak = Math.max(0.0001, (note.gain == null ? 0.8 : note.gain) * volume * 0.28);
    g.gain.setValueAtTime(0.0001, startAt);
    g.gain.exponentialRampToValueAtTime(peak, startAt + Math.min(0.03, note.d / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, startAt + note.d);

    osc.connect(g);
    g.connect(master);
    osc.start(startAt);
    osc.stop(startAt + note.d + 0.05);
    return osc;
  }

  /* opts: {loop, volume, escalate, maxRepeats, onEnd} */
  function play(name, opts) {
    opts = opts || {};
    var c = ctx();
    if (!c) return { stop: function () {} };
    if (c.state === 'suspended') c.resume().catch(function () {});

    var tone = TONES[name] || TONES.chime;
    var volume = opts.volume == null ? 0.8 : opts.volume;
    var master = c.createGain();
    master.gain.value = 1;
    master.connect(c.destination);

    var stopped = false;
    var timer = null;
    var repeat = 0;

    function cycle() {
      if (stopped) return;
      var vol = volume;
      if (opts.escalate) {
        // Ramp from a third of the target up to full over ~6 repetitions, so a
        // sleeping alarm nudges before it shouts.
        vol = volume * Math.min(1, 0.35 + repeat * 0.12);
      }
      var start = c.currentTime + 0.02;
      tone.notes.forEach(function (n) {
        scheduleNote(c, master, n, start + n.t, vol);
      });
      repeat++;
      if (!opts.loop) {
        timer = setTimeout(function () { stop(); }, (tone.len + 0.2) * 1000);
        return;
      }
      if (opts.maxRepeats && repeat >= opts.maxRepeats) {
        timer = setTimeout(function () { stop(); }, (tone.len + 0.2) * 1000);
        return;
      }
      timer = setTimeout(cycle, tone.len * 1000);
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      try {
        master.gain.setTargetAtTime(0.0001, c.currentTime, 0.05);
        setTimeout(function () { try { master.disconnect(); } catch (_) {} }, 400);
      } catch (_) {}
      var i = _active.indexOf(handle);
      if (i > -1) _active.splice(i, 1);
      if (opts.onEnd) opts.onEnd();
    }

    var handle = { stop: stop, name: name };
    _active.push(handle);
    cycle();
    return handle;
  }

  function preview(name, volume) {
    stopAll();
    return play(name, { loop: false, volume: volume == null ? 0.8 : volume });
  }

  function stopAll() {
    _active.slice().forEach(function (h) { h.stop(); });
  }

  function list() {
    return Object.keys(TONES).map(function (k) {
      return { id: k, label: TONES[k].label };
    });
  }

  /* Short confirmation blips used by the UI. */
  function blip(kind) {
    var c = ctx();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(function () {});
    var master = c.createGain();
    master.gain.value = 1;
    master.connect(c.destination);
    var now = c.currentTime + 0.01;
    var notes = kind === 'error'
      ? [{ t: 0, f: 320, d: 0.14, type: 'square', gain: 0.5 }, { t: 0.13, f: 220, d: 0.18, type: 'square', gain: 0.5 }]
      : kind === 'done'
        ? [{ t: 0, f: 784, d: 0.1, type: 'sine', gain: 0.5 }, { t: 0.09, f: 1175, d: 0.16, type: 'sine', gain: 0.45 }]
        : [{ t: 0, f: 880, d: 0.08, type: 'sine', gain: 0.35 }];
    notes.forEach(function (n) { scheduleNote(c, master, n, now + n.t, 0.7); });
    setTimeout(function () { try { master.disconnect(); } catch (_) {} }, 800);
  }

  function vibrate(pattern) {
    if (!navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (_) {}
  }

  return {
    unlock: unlock,
    isUnlocked: isUnlocked,
    play: play,
    preview: preview,
    stopAll: stopAll,
    list: list,
    blip: blip,
    vibrate: vibrate
  };
})();

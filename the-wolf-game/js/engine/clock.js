/* clock.js — the phase machine, and the reason the room changes colour.
 *
 * A phase is a row in data/game_flow.json: a duration, a pair of sky stops, a
 * set of capabilities and the name of what comes next. Nothing in here knows
 * what "discussion" means. Reordering the round, adding a phase between two
 * others, or giving voting its own clock is an edit to that file and nothing
 * else — which was the point, because the flow is going to keep changing.
 *
 * The sky is the other half. Each phase names where the sun starts and where it
 * ends, and `skyAt` returns the blend for right now, so the village really does
 * go night → dawn → noon → dusk → night while you play it. You can tell how
 * much of the discussion is left by the colour of the room.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});

  var flow = null, sky = null, byId = {};

  function load(flowJson, skyJson) {
    flow = flowJson; sky = skyJson;
    byId = {};
    flow.phases.forEach(function (p) { byId[p.id] = p; });
    return flow;
  }

  function phase(id) { return byId[id] || null; }
  function phases() { return flow ? flow.phases : []; }

  /** How long this phase runs, in ms, with the room's own timing applied. */
  function durationMs(state, id) {
    var p = byId[id];
    if (!p || p.duration == null) return 0;
    var custom = ((state.config || {}).flow || {}).durations || {};
    var secs = typeof custom[id] === "number" ? custom[id] : p.duration;
    var scale = eventScale(state, id);
    return Math.max(3000, Math.round(secs * 1000 * scale));
  }

  /** Blood Moon shortens the night; Long Night stretches it. */
  function eventScale(state, id) {
    var ev = state.currentEvent;
    if (!ev || !ev.definition) return 1;
    var scale = 1;
    (ev.definition.effects || []).forEach(function (e) {
      if (e.kind === "scaleDuration" && e.phase === id) scale *= e.factor;
    });
    return scale;
  }

  function enter(state, id, at) {
    var p = byId[id];
    if (!p) throw new Error("[wg] no such phase: " + id);
    state.phase = id;
    state.phaseStartedAt = at || Date.now();
    var d = durationMs(state, id);
    state.phaseEndsAt = d ? state.phaseStartedAt + d : 0;
    state.paused = false;
    return p;
  }

  function next(state) {
    var p = byId[state.phase];
    return p ? p.next : null;
  }

  /** 0 at the start of the phase, 1 at its end. Untimed phases sit at 0. */
  function progress(state, at) {
    if (!state.phaseEndsAt) return 0;
    var t = (at || Date.now()) - state.phaseStartedAt;
    var span = state.phaseEndsAt - state.phaseStartedAt;
    if (span <= 0) return 1;
    return Math.max(0, Math.min(1, t / span));
  }

  function remainingMs(state, at) {
    if (!state.phaseEndsAt) return Infinity;
    return Math.max(0, state.phaseEndsAt - (at || Date.now()));
  }

  function expired(state, at) {
    return !!state.phaseEndsAt && (at || Date.now()) >= state.phaseEndsAt;
  }

  function can(state, capability) {
    var p = byId[state.phase];
    return !!(p && (p.capabilities || []).indexOf(capability) >= 0);
  }

  /* ---------------- the sky ---------------- */

  function hexToRgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  function rgbToHex(c) {
    return "#" + c.map(function (v) {
      var s = Math.max(0, Math.min(255, Math.round(v))).toString(16);
      return s.length < 2 ? "0" + s : s;
    }).join("");
  }
  function mixHex(a, b, t) {
    var x = hexToRgb(a), y = hexToRgb(b);
    return rgbToHex([0, 1, 2].map(function (i) { return x[i] + (y[i] - x[i]) * t; }));
  }

  /* Ease the crossfade rather than running it linearly. A linear ramp reads as
   * a slider being dragged; this one sits in each end for a moment, so "it is
   * getting late" arrives as a feeling before it arrives as a number. */
  function ease(t) { return t * t * (3 - 2 * t); }

  /**
   * The sky right now, as a flat set of tokens the theme can paint.
   * `mode` is "light" or "dark" — both are the same Ash Blue family, and the
   * time of day tints whichever one the viewer is in.
   */
  function skyAt(state, mode, at) {
    var p = byId[state.phase] || byId.lobby;
    var from = (sky.stops[(p.sky || {}).from] || sky.stops.night);
    var to = (sky.stops[(p.sky || {}).to] || from);
    var t = ease(progress(state, at));
    var a = from[mode] || from.light, b = to[mode] || to.light;
    var out = {};
    Object.keys(a).forEach(function (k) { out[k] = mixHex(a[k], b[k] || a[k], t); });
    out.mix = from.mix + (to.mix - from.mix) * t;
    out.label = t < 0.5 ? from.name : to.name;
    return out;
  }

  WG.clock = {
    load: load, phase: phase, phases: phases,
    enter: enter, next: next,
    durationMs: durationMs, progress: progress, remainingMs: remainingMs, expired: expired,
    can: can, skyAt: skyAt, mixHex: mixHex,
    get flow() { return flow; },
    get sky() { return sky; }
  };
})(typeof window !== "undefined" ? window : globalThis);

/* events.js — the things that go wrong on top of everything else.
 *
 * Each event is a row in data/list_of_events.json plus a handler here, keyed by
 * id. Adding one means adding both and nothing else: the clock reads
 * `scaleDuration` off the data, the resolver reads `restrictHouses`, and the
 * engine calls the hooks below at the two moments an event can matter.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});
  var data = null;

  function load(json) { data = json; return json; }
  function definition(id) {
    if (!data) return null;
    for (var i = 0; i < data.events.length; i++) if (data.events[i].id === id) return data.events[i];
    return null;
  }

  /** Rolled at the top of each night after the first round. */
  function maybeTrigger(state) {
    var cfg = (state.config || {}).events || {};
    if (!cfg.enabled || state.currentEvent) return null;
    if (state.round < (data.earliestRound || 2)) return null;
    if (Math.random() >= (cfg.chance == null ? data.chance : cfg.chance)) return null;

    var pool = (cfg.allowed || []).filter(function (id) {
      var d = definition(id);
      if (!d) return false;
      if (id === "pandemic" && state.pandemic) return false;    // one plague at a time
      return true;
    });
    if (!pool.length) return null;
    return trigger(state, pool[Math.floor(Math.random() * pool.length)]);
  }

  function trigger(state, id) {
    var def = definition(id);
    if (!def) return null;
    state.currentEvent = {
      id: id,
      definition: def,
      startedRound: state.round,
      remaining: def.duration
    };
    var start = HANDLERS[id] && HANDLERS[id].start;
    if (start) start(state);
    return state.currentEvent;
  }

  /** Called at dawn. An event with a finite duration burns down and clears. */
  function tick(state, out) {
    var ev = state.currentEvent;
    if (!ev) return;
    var h = HANDLERS[ev.id] || {};
    if (h.nightly) h.nightly(state, out);
    if (ev.remaining > 0) {
      ev.remaining--;
      if (ev.remaining <= 0) {
        if (h.end) h.end(state, out);
        state.currentEvent = null;
        state.curfew = false;
      }
    }
  }

  /** How many extra throats the pack gets tonight. */
  function extraKills(state) {
    var ev = state.currentEvent;
    if (!ev) return 0;
    var n = 0;
    (ev.definition.effects || []).forEach(function (e) {
      if (e.kind === "extraKill" && e.team === "werewolf") n += e.count || 1;
    });
    return n;
  }

  /** Festival: what you aimed at is not what you hit. */
  function redirect(state, actorId, chosenId, candidates) {
    var ev = state.currentEvent;
    if (!ev || ev.id !== "festival" || !candidates.length) return chosenId;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  var HANDLERS = {
    festival: {},

    curfew: {
      start: function (state) { state.curfew = true; },
      end: function (state) { state.curfew = false; }
    },

    blood_moon: {},
    long_night: {},

    /* The one event with a life of its own. It starts in one house, walks to a
     * neighbour each night, kills after three, and if it ever holds the whole
     * village it wins outright — a third side that nobody was playing. */
    pandemic: {
      start: function (state) {
        var alive = state.players.filter(function (p) { return p.alive; });
        if (!alive.length) return;
        var zero = alive[Math.floor(Math.random() * alive.length)];
        state.pandemic = { sick: {}, since: {} };
        state.pandemic.sick[zero.id] = true;
        state.pandemic.since[zero.id] = state.round;
      },

      nightly: function (state, out) {
        var P = state.pandemic;
        if (!P) return;
        var alive = state.players.filter(function (p) { return p.alive; });
        var ids = alive.map(function (p) { return p.id; });

        // Three nights with it and you do not get up.
        Object.keys(P.sick).forEach(function (id) {
          var p = state.players.filter(function (x) { return x.id === id; })[0];
          if (!p || !p.alive) return;
          if (state.round - P.since[id] >= 3) {
            WG.resolver.kill(state, id, { cause: "disease", byId: null, out: out, ignoreShields: true });
          }
        });

        // It walks to the house next door. Seats are the village's geography.
        Object.keys(P.sick).forEach(function (id) {
          var i = ids.indexOf(id);
          if (i < 0) return;
          var neighbours = [ids[(i + 1) % ids.length], ids[(i - 1 + ids.length) % ids.length]]
            .filter(function (n) { return n && !P.sick[n]; });
          if (!neighbours.length) return;
          var got = neighbours[Math.floor(Math.random() * neighbours.length)];
          P.sick[got] = true;
          P.since[got] = state.round;
          out.say(got, "🦠 You woke up burning. Three nights of this and you will not wake up at all.", "sick");
        });

        var living = alive.filter(function (p) { return p.alive; });
        var sick = living.filter(function (p) { return P.sick[p.id]; });
        if (living.length && sick.length >= living.length) state.pandemicWon = true;
        else if (sick.length) {
          out.say("all", "🦠 " + sick.length + " of " + living.length + " houses have the sickness in them.", "sick");
        }
      }
    }
  };

  WG.events = {
    load: load, definition: definition, maybeTrigger: maybeTrigger,
    trigger: trigger, tick: tick, extraKills: extraKills, redirect: redirect,
    get data() { return data; }
  };
})(typeof window !== "undefined" ? window : globalThis);

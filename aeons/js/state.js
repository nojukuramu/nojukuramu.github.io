/* state.js — the running game in one object, and a small event bus.
 *
 * The shape is Hacks' and Magic Sandbox's state.js: the simulation writes G,
 * and everything that only reacts — the renderer's sparks, the sound, the
 * HUD's toasts, the Codex — listens for events instead of reaching into the
 * simulation. That is what lets the simulation run headless in Node, under
 * tools/validate.js, with nothing listening at all. */

export const G = {
  mode: "title",       // title | play
  world: null,
  seed: 0,
  diff: "normal",
  time: 0,             // game seconds
  tick: 0,
  speed: 1,
  paused: false,
  nextId: 1,
  ents: new Map(),     // id -> unit or building (nodes live in world.nodes)
  units: [],
  blds: [],
  projs: [],
  res: { gold: 0, wood: 0, stone: 0, oil: 0, aether: 0 },
  supply: { used: 0, cap: 0 },
  era: 0,
  tech: {},            // category -> level reached
  tiers: {},           // line -> the era of the version you train
  doctrines: {},       // id -> true
  researching: {},     // key -> building id: one of each at a time
  heroes: {},          // id -> { uid, lvl, xp, dead, reviveAt, mode }
  phase: null,         // enemy.js
  bases: new Map(),    // enemy base id -> base
  intel: { contacts: [], alerts: [], nextContact: 1 },
  auto: null,          // auto.js settings
  codex: [],           // { t, text, kind }
  stats: { gathered: 0, killed: 0, lost: 0, built: 0, phases: 0, playtime: 0 },
  sel: [],             // selected ids
  groups: [[], [], [], [], [], [], [], [], [], []],
  ghosts: new Map(),   // enemy buildings as last seen, for the fog
  fogStamp: 1,
  over: false,
  complete: false,     // the Mirror has fallen
  beaconLit: false,
  temp: []             // temporary vision: { x, y, r, until }
};

const handlers = {};
export function on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); }
export function off(ev, fn) { if (handlers[ev]) handlers[ev] = handlers[ev].filter((f) => f !== fn); }
export function emit(ev, a, b, c) {
  const list = handlers[ev];
  if (!list) return;
  for (let i = 0; i < list.length; i++) { try { list[i](a, b, c); } catch (e) { console.error("[aeons] " + ev, e); } }
}

/** Back to nothing, ready for a new game or a load. */
export function resetState() {
  Object.assign(G, {
    mode: "title", world: null, time: 0, tick: 0, speed: 1, paused: false, nextId: 1,
    ents: new Map(), units: [], blds: [], projs: [],
    res: { gold: 0, wood: 0, stone: 0, oil: 0, aether: 0 }, supply: { used: 0, cap: 0 },
    era: 0, tech: {}, tiers: {}, doctrines: {}, researching: {}, heroes: {},
    phase: null, bases: new Map(), intel: { contacts: [], alerts: [], nextContact: 1 },
    codex: [], stats: { gathered: 0, killed: 0, lost: 0, built: 0, phases: 0, playtime: 0 },
    sel: [], groups: [[], [], [], [], [], [], [], [], [], []], ghosts: new Map(), fogStamp: 1,
    over: false, complete: false, beaconLit: false, temp: []
  });
}

/* state.js — the running game in one object, and a tiny event bus.
 *
 * The shape is Magic Sandbox's state.js: gameplay writes S, and everything
 * that only reacts — the HUD, the sound, the effects, the network, the hack
 * API — listens for events instead of reaching into gameplay. That is what
 * lets a gunshot's sound, its tracer, its packet and a hack's on("shot") be
 * four files that do not know about each other. */

export const S = {
  mode: "title",        // title | play
  match: null,          // { mode, settings, score, time, over, ... } — see game.js
  world: null,          // the brush world (map.js)
  nav: null,            // the bots' graph (nav.js), built on first need
  actors: [],           // every body in the match: you, bots, other people
  me: null,             // your actor
  projectiles: [],
  time: 0,              // match time in seconds (stops while paused)
  tick: 0,
  paused: false,
  net: { role: "solo", me: 0 },   // solo | host | client
  view: { yaw: 0, pitch: 0 },     // where your eyes point (the mouse owns this)
  cam: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fov: 90 },
  spectate: null
};

const handlers = {};
export function on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); }
export function off(ev, fn) { if (handlers[ev]) handlers[ev] = handlers[ev].filter((f) => f !== fn); }
export function emit(ev, ...args) {
  const list = handlers[ev];
  if (!list) return;
  for (const fn of list) { try { fn(...args); } catch (e) { console.error("[hacks] " + ev, e); } }
}

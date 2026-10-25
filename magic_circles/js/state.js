/* state.js — the running game, in one object, plus a tiny event bus.
 *
 * Lifted from Magic Sandbox (magic_sandbox/js/state.js), without the
 * multiplayer half. Gameplay modules read and write S; the HUD, the audio
 * and the menus never poke at gameplay directly but listen for events, so
 * the sound of a kill and the number that floats up from it are written in
 * different files without either knowing the other exists. */

export const S = {
  mode: "title",        // title | play
  world: null,          // world.js's createWorld() for this seed
  player: null,
  enemies: [],
  shots: [],            // the player's spells in flight
  eshots: [],           // enemy bolts
  pickups: [],
  zones: [],            // burning ground and the like
  time: 0,              // game time (stops while paused)
  day: 0.32,            // 0..1 through a day; 0.25 is morning, 0.75 dusk
  paused: false,
  over: false,
  boss: null,           // the Warden you are fighting, if any
  hitstop: 0,
  uiOpen: false
};

const handlers = {};
export function on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); }
export function emit(ev, a, b, c) {
  const list = handlers[ev];
  if (!list) return;
  for (const fn of list) { try { fn(a, b, c); } catch (e) { console.error("[mcircles] " + ev, e); } }
}

/* state.js — the running game, in one object, plus a tiny event bus.
 *
 * Gameplay modules (player, spells, enemies, game) all read and write S, and
 * none of them import each other's internals for data. The HUD, the audio
 * and the menus never poke at gameplay directly: they listen for events.
 * That is what lets the sound of a kill and the number that floats up from
 * it be written in different files without either knowing the other exists. */

export const S = {
  mode: "title",        // title | run | sandbox
  world: null,
  player: null,
  enemies: [],
  shots: [],
  eshots: [],
  zones: [],
  pickups: [],
  props: [],            // interactable things: chests, shrines, geodes, portal
  floor: 1,
  seed: 1,
  time: 0,              // game time (stops while paused)
  runTime: 0,           // wall-clock time spent in the run, for the record
  paused: false,
  over: false,
  boss: null,
  objective: null,      // { kind, done, total, text }
  kills: 0,
  hitstop: 0,
  slowmo: 0,
  sandbox: { infiniteMana: true, noDeath: true }
};

const handlers = {};
export function on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); }
export function emit(ev, a, b, c) {
  const list = handlers[ev];
  if (!list) return;
  for (const fn of list) { try { fn(a, b, c); } catch (e) { console.error("[msandbox] " + ev, e); } }
}

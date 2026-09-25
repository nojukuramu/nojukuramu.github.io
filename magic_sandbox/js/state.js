/* state.js — the running game, in one object, plus a tiny event bus.
 *
 * Gameplay modules (player, spells, enemies, game) all read and write S, and
 * none of them import each other's internals for data. The HUD, the audio
 * and the menus never poke at gameplay directly: they listen for events.
 * That is what lets the sound of a kill and the number that floats up from
 * it be written in different files without either knowing the other exists. */

export const S = {
  mode: "title",        // title | run | sandbox | coop | pvp
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
  sandbox: { infiniteMana: true, noDeath: true },
  /* Multiplayer. Solo play never touches any of this. */
  net: { role: "solo", me: 0 },   // solo | host | client; `me` is this mage's id in the room
  remotes: [],          // the other mages in a match, as puppets net.js moves
  match: null,          // { mode, settings, score, ... } while a match is on
  view: null,           // whom the camera follows while you are down
  uiOpen: false         // a menu is up during a match, which cannot pause
};

export const online = () => S.net.role !== "solo";
/* A client draws enemies the host simulates; it never decides what they do. */
export const isClient = () => S.net.role === "client";

/** Every mage in play, you first. Rebuilt per call: there are at most eight. */
export function players() {
  const out = S.player ? [S.player] : [];
  for (const r of S.remotes) out.push(r);
  return out;
}

const handlers = {};
export function on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); }
/* The host listens to everything said while enemies act, and passes the
   sounds of it on (net.js), so a client hears the slam it is shown. */
let tap = null;
export function setEmitTap(fn) { tap = fn; }
export function emit(ev, a, b, c) {
  if (tap) tap(ev, a, b, c);
  const list = handlers[ev];
  if (!list) return;
  for (const fn of list) { try { fn(a, b, c); } catch (e) { console.error("[msandbox] " + ev, e); } }
}

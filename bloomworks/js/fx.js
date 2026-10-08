/* fx.js — the bridge from what happened to what is seen and heard.
 *
 * The simulation calls these and moves on; the renderer drains RT.rings,
 * RT.pops, RT.sparks and RT.bolts, and audio.js plays the sounds. Keeping the
 * calls in one small module means the simulation imports no DOM, no canvas
 * and no AudioContext, so tools/validate.js can run it in Node. */

import { RT } from "./state.js";

let sound = null;
export function attachSound(s) { sound = s; }
const play = (name, a, b) => { if (sound && sound[name]) { try { sound[name](a, b); } catch (e) { /* sound is never worth a crash */ } } };

export function ringAt(x, y, radius, note, step) {
  if (RT.rings.length < 80) RT.rings.push({ x, y, r: radius, t: 0, note, step });
  play("chime", note, step);
}
export function pop(x, y, text, big, col) {
  if (RT.pops.length > 60) RT.pops.shift();
  RT.pops.push({ x, y, text, t: 0, big: !!big, col: col || null });
}
export function spark(x, y, col, n) {
  for (let i = 0; i < (n || 6) && RT.sparks.length < 400; i++) {
    const a = Math.random() * Math.PI * 2, s = 0.6 + Math.random() * 1.8;
    RT.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: 0, life: 0.5 + Math.random() * 0.5, col });
  }
}
export function sale(combo, lucky) { play("sale", combo, lucky); }
export function supernova(x, y) { RT.slowmo = 0.5; RT.flash = 1; spark(x, y, "#ffffff", 40); play("supernova"); }
export function thunder() { play("thunder"); }
export function milestone() { play("milestone"); }
export function chord() { play("chord"); }
export function click() { play("click"); }
export function moth() { play("moth"); }

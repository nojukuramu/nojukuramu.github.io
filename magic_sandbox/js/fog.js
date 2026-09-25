/* fog.js — fog of war, for rooms that ask for it.
 *
 * You see as far as a lantern reaches (SIGHT metres) and not through what is
 * solid: every tree, rock and column on the island throws a shadow away from
 * you. What stands in the dark is not drawn at all — an enemy, another mage,
 * their name — rather than merely dimmed, so the fog cannot be read around.
 * Teammates are always seen; that is what teammates are for.
 *
 * The shadow is a visibility polygon: RAYS rays cast from your feet across
 * the ground, each stopped where it first passes through a collider. Rays
 * test circles analytically against the few colliders within reach, so a
 * refresh costs a few thousand multiplications, twenty times a second. The
 * polygon is projected to the screen every frame and cut out of a dark sheet
 * on a 2D canvas above the game — softened with a blur where the browser has
 * one, hard-edged where it does not. */

import { S } from "./state.js";
import { worldToScreen } from "./gfx.js";
import { MODES, hostile } from "./modes.js";

export const SIGHT = 12.5;
const RAYS = 150, REFRESH = 0.05, SCALE = 0.5;
let on = false, cv = null, g = null, acc = 0;
let cand = [];
const ends = new Float32Array(RAYS * 2);
let ox = 0, oz = 0;
const scr = {};

export function start(v) {
  on = !!v;
  cv = document.getElementById("fog");
  if (cv) cv.hidden = !on;
  acc = REFRESH;
}
export function stop() {
  on = false;
  if (cv) cv.hidden = true;
  for (const e of S.enemies) if (e.fogHidden) { e.fogHidden = false; e.mesh.root.visible = true; }
  for (const Q of S.remotes) Q.fogHidden = false;
}
export const active = () => on;

function gather(x, z) {
  cand = [];
  const W = S.world;
  if (!W) return;
  const lim = SIGHT + 2;
  for (const c of W.colliders) {
    const dx = c.x - x, dz = c.z - z;
    if (dx * dx + dz * dz < (lim + c.r) * (lim + c.r)) cand.push(c);
  }
}
/** How far a ray from (x, z) heading (dx, dz) gets before something solid. */
function reach(x, z, dx, dz, max) {
  let t = max;
  for (const c of cand) {
    const fx = c.x - x, fz = c.z - z;
    const proj = fx * dx + fz * dz;
    if (proj <= 0 || proj - c.r > t) continue;
    const perp2 = fx * fx + fz * fz - proj * proj, r2 = c.r * c.r * 0.8;
    if (perp2 >= r2) continue;
    // the obstacle itself stays lit; the dark begins on its far side
    const far = proj + Math.sqrt(r2 - perp2);
    if (far < t) t = far;
  }
  return t;
}
/** Whether a point is in sight of where you stand. */
export function sees(x, z) {
  const dx = x - ox, dz = z - oz, d = Math.hypot(dx, dz);
  if (d > SIGHT) return false;
  if (d < 1.5) return true;
  return reach(ox, oz, dx / d, dz / d, d) >= d - 0.6;
}

export function update(dt) {
  if (!on || !cv) return;
  const V = S.view || S.player;
  if (!V || !S.world) { cv.hidden = true; return; }
  cv.hidden = false;
  acc += dt;
  // a jump (a respawn, a new floor) re-casts at once rather than a beat late
  if (acc >= REFRESH || Math.abs(V.x - ox) + Math.abs(V.z - oz) > 1.5) {
    acc = 0;
    ox = V.x; oz = V.z;
    gather(ox, oz);
    for (let i = 0; i < RAYS; i++) {
      const a = i / RAYS * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
      const t = reach(ox, oz, dx, dz, SIGHT);
      ends[i * 2] = ox + dx * t; ends[i * 2 + 1] = oz + dz * t;
    }
    hideUnseen(V);
  }
  draw();
}

function hideUnseen(V) {
  for (const e of S.enemies) {
    if (!e.alive) continue;
    const hide = !sees(e.x, e.z);
    if (hide !== !!e.fogHidden) { e.fogHidden = hide; e.mesh.root.visible = !hide; }
  }
  const M = S.match ? MODES[S.match.mode] : null;
  for (const Q of S.remotes) {
    const friend = !M || !hostile(S.match.mode, S.player, Q);
    Q.fogHidden = !friend && !sees(Q.x, Q.z);
  }
}

function draw() {
  const w = Math.max(1, Math.round(innerWidth * SCALE)), h = Math.max(1, Math.round(innerHeight * SCALE));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; g = null; }
  if (!g) g = cv.getContext("2d");
  g.globalCompositeOperation = "source-over";
  g.filter = "none";
  g.clearRect(0, 0, w, h);
  g.fillStyle = "rgba(4,7,12,0.86)";
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "destination-out";
  if ("filter" in g) g.filter = "blur(" + Math.round(9 * SCALE * 2) + "px)";
  g.beginPath();
  for (let i = 0; i < RAYS; i++) {
    worldToScreen(ends[i * 2], 0, ends[i * 2 + 1], scr);
    const x = scr.x * SCALE, y = scr.y * SCALE;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
  g.fillStyle = "#000";
  g.fill();
  g.filter = "none";
  g.globalCompositeOperation = "source-over";
}

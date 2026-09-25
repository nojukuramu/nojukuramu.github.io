/* map.js — the arena, "Relay": one quarter drawn by hand and turned four ways.
 *
 * Built for moving, and for shooting while you move. Every quarter has the
 * same set of places to practise in, so no corner of the map is a worse
 * place to spawn and every technique is a short run from anywhere:
 *
 *   - a surf ridge: a long 50-degree ridge that falls as it runs, too steep
 *     to stand on, entered from a launch deck at its high end;
 *   - a wall-jump shaft: two walls 3.2 m apart, one tall, one topped by a
 *     sniper's nest you can only reach by kicking between them;
 *   - a slide hill: a long shallow slope down towards the middle;
 *   - a canopy: a slab on stilts, whose underside is a ceiling to lunge up
 *     and stick to;
 *   - a perch in the corner, climbable, with a ramp for the bots;
 *   - a jump pad that throws you onto the launch deck.
 *
 * The middle is the Core: two climbable tiers with a ramp up each side.
 *
 * Everything is a brush (brush.js). `kind` decides the colour and nothing
 * else — any wall can be climbed, any ceiling stuck to. Positions are metres,
 * y is up, and the floor is y = 0. */

import { box, prism, makeBrush, turned, buildWorld } from "./brush.js";

export const MAP_NAME = "Relay";
export const HALF = 64;          // the arena is 128 m across

/* The colours of kinds, shared with the renderer and the hack API's map export. */
export const KINDS = {
  floor:  { color: 0x8a93a2, grid: 1 },
  wall:   { color: 0x6b80a2, grid: 2 },
  trim:   { color: 0x3a4558, grid: 2 },
  block:  { color: 0x7486a0, grid: 1 },
  core:   { color: 0xe0954a, grid: 1 },
  surf:   { color: 0x7d66d0, grid: 2 },
  slope:  { color: 0x5aa38a, grid: 1 },
  shaft:  { color: 0xd0654e, grid: 1 },
  canopy: { color: 0x4aaccc, grid: 1 },
  pad:    { color: 0x5ee08a, grid: 0 },
  crate:  { color: 0xae8d5f, grid: 1 },
  clip:   { color: 0x000000, grid: 0, invisible: true }
};

/* One quarter: x and z both from 0 to 64. */
function quarter() {
  const B = [];
  // the outer walls of this quarter (turned four ways they close the arena)
  B.push(box(0, 0, 62, 64, 18, 64, { kind: "wall" }));
  B.push(box(62, 0, 0, 64, 18, 62, { kind: "wall" }));
  B.push(box(60.5, 0, 60.5, 62, 18, 62, { kind: "trim" }));

  // the perch: high ground in the corner, a ramp up for anyone who cannot climb
  B.push(box(48, 0, 48, 62, 6, 62, { kind: "block" }));
  B.push(prism([[36, 0], [48, 0], [48, 6]], "z", 54.5, 61.5, { kind: "slope" }));
  B.push(box(48, 6, 48, 49, 7, 54, { kind: "trim" }));

  // the wall-jump shaft: kick between the two walls to reach the nest
  B.push(box(51.8, 0, 22, 52.6, 11, 36, { kind: "shaft" }));
  B.push(box(55.8, 0, 22, 56.6, 7.5, 36, { kind: "shaft" }));
  B.push(box(55.8, 7.5, 22, 62, 8, 36, { kind: "canopy" }));        // the nest, on the short wall
  B.push(box(58, 8, 22, 62, 9.2, 23, { kind: "trim" }));            // a lip to crouch behind
  B.push(box(58, 8, 35, 62, 9.2, 36, { kind: "trim" }));

  // the surf ridge: 50 degrees each side, falling from 6 m to 3.5 m along its length
  {
    const x0 = 20.5, x1 = 31.5, xm = 26, top = 6.5, z0 = 14, z1 = 46, fall = 2.5;
    const sec = (z, dy) => [[x0, -1 + dy, z], [x1, -1 + dy, z], [xm, top + dy, z]];
    const a = sec(z0, 0), b = sec(z1, -fall);
    B.push(makeBrush([...a, ...b], [[0, 1, 2], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5]], { kind: "surf" }));
  }
  // the launch deck at the ridge's high end
  B.push(box(21, 0, 6.5, 31, 7.2, 13.2, { kind: "block" }));
  B.push(box(21, 7.2, 6.5, 31, 8.2, 7.5, { kind: "trim" }));

  // the slide hill, running down towards the middle
  B.push(prism([[16, 0], [30, 3.2], [30, 0]], "x", 36, 46, { kind: "slope" }));
  B.push(box(36, 0, 30, 46, 3.2, 36, { kind: "slope" }));

  // the canopy: a slab on stilts; its underside is a ceiling to lunge up to
  B.push(box(6, 6.2, 22, 16, 6.8, 30, { kind: "canopy" }));
  for (const [x, z] of [[6.2, 22.2], [15, 22.2], [6.2, 29], [15, 29]]) B.push(box(x, 0, z, x + 0.8, 6.2, z + 0.8, { kind: "trim" }));

  // a jump pad that throws you onto the launch deck
  B.push(box(14, 0, 16, 17, 0.2, 19, { kind: "pad", push: [7.5, 18.5, -5.5] }));

  // cover
  B.push(box(10, 0, 40, 12.5, 1.25, 42.5, { kind: "crate" }));
  B.push(box(12.5, 0, 40, 14, 2.5, 41.5, { kind: "crate" }));
  B.push(box(38, 0, 8, 40.5, 2.5, 10.5, { kind: "crate" }));
  B.push(box(40.5, 0, 8.5, 42, 1.25, 10, { kind: "crate" }));
  B.push(box(40, 0, 50, 42, 2.6, 58, { kind: "wall" }));
  B.push(box(33, 0, 52, 34, 1.2, 60, { kind: "crate" }));
  B.push(box(8, 0, 52, 18, 3.5, 53, { kind: "wall" }));
  B.push(box(44, 0, 18, 45, 4, 26, { kind: "wall" }));
  // the long lane by the outer wall: a corridor to bunny hop down
  B.push(box(2, 0, 57, 30, 1.1, 58, { kind: "trim" }));
  return B;
}

/* The Core, in the middle: two tiers and a ramp up each side. */
function core() {
  const B = [];
  B.push(box(-6, 0, -6, 6, 4.5, 6, { kind: "core" }));
  B.push(box(-3, 4.5, -3, 3, 9, 3, { kind: "core" }));
  const ramp = prism([[6, 0], [15, 0], [6, 4.5]], "z", -1.6, 1.6, { kind: "slope" });
  for (let q = 0; q < 4; q++) B.push(turned(ramp, q));
  return B;
}

export function buildMap() {
  const brushes = [];
  brushes.push(box(-HALF, -2, -HALF, HALF, 0, HALF, { kind: "floor" }));
  const Q = quarter();
  for (let q = 0; q < 4; q++) for (const b of Q) brushes.push(turned(b, q));
  brushes.push(...core());
  // a lid over everything, so a pad and a lunge cannot throw anyone out
  brushes.push(box(-HALF, 26, -HALF, HALF, 28, HALF, { kind: "clip" }));
  const W = buildWorld(brushes);
  W.name = MAP_NAME;
  W.spawns = spawns();
  W.killY = -20;
  return W;
}

/* Spawn points: four a quarter, facing the middle. */
function spawns() {
  const one = [[6, 44], [36, 3], [56, 12], [30, 56], [58, 42], [3, 18]];
  const out = [];
  for (let q = 0; q < 4; q++) for (const [x0, z0] of one) {
    let x = x0, z = z0;
    for (let i = 0; i < q; i++) { const t = x; x = -z; z = t; }
    out.push({ x, y: 0.02, z, yaw: Math.atan2(x, z), q });
  }
  return out;
}

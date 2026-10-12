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
 *   - a jump pad that throws you onto the launch deck;
 *   - the slipway: a steep slide-in down beside a bright panel on the outer
 *     wall, and an alley under the sniper's nest with a panel on each side —
 *     slide fast along one and you ride it, jump and you kick off it, onto
 *     the other;
 *   - the bank: where the alley comes out, the floor curves up into the
 *     outer wall and round the corner into the perch's face, like the turn
 *     of a race track — so a ride out of the alley can be carried round and
 *     out along the perch at speed instead of stopping at the wall.
 *
 * The middle is the Core: two climbable tiers with a ramp up each side.
 *
 * Above all that is a second map, for fighting in the air:
 *
 *   - the Skyway: a ring of bridges twelve metres up, all the way round, with
 *     a ramp up to it in every quarter and a pad beside each corner tower.
 *     Halfway along each side the bridge breaks, and a stepping stone in the
 *     gap is a jump either way — or a fall;
 *   - the Halo: a square ring of slabs floating sixteen metres over the Core,
 *     thrown up to by four pads; drop through its middle onto the Core;
 *   - kites: small platforms hanging in the air between the two, that only a
 *     grapple (or a very good lunge) reaches.
 *
 * Long sightlines run along the Skyway, the Halo looks down on everything,
 * and every pad, drop and swing between them crosses open air.
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
  bridge: { color: 0x5b7fd0, grid: 1 },
  halo:   { color: 0xe0b84a, grid: 1 },
  kite:   { color: 0xff8a3d, grid: 1 },
  crate:  { color: 0xae8d5f, grid: 1 },
  ride:   { color: 0x2fe0c8, grid: 1 },
  bank:   { color: 0xd8608e, grid: 1 },
  clip:   { color: 0x000000, grid: 0, invisible: true }
};

/* ---------------------------------------------------------------
   Banks
   --------------------------------------------------------------- */
/*
 * A bank's cross-section is a quarter circle of radius BANK_R: flat at its
 * foot, vertical where it meets its wall. A curve cannot be a brush, so it is
 * cut into BANK_STEPS slabs, each a convex solid from one chord of the circle
 * back into the wall — stacked, they are the curve. Every slab has its own
 * flat face, and what that face's angle is decides what it is: the lower ones
 * are ground to run up, the middle ones too steep to stand on (you surf them),
 * and the top ones steep enough to count as a wall, so a crouch there is a
 * wall ride. None of that is special-cased; it is the same rules as anywhere.
 *
 * `at(e, w, h)` places a point of the cross-section in the world: end e (0 or
 * 1) of the piece, w metres out in front of the wall line, h up. Writing the
 * pieces that way lets the straight runs and the slices of a turn share one
 * slab, and lets a straight run taper (see below).
 */
const BANK_R = 4, BANK_STEPS = 8, BANK_TOP = 6;
/* The cross-section for a radius of one metre: [w, h] from the foot to the top of the wall. Scaling
   it scales about the wall's base, which is what keeps a tapering run's faces flat (see bankRun). */
const BANK_PROFILE = (() => {
  const out = [];
  for (let k = 0; k <= BANK_STEPS; k++) { const t = (k / BANK_STEPS) * Math.PI / 2; out.push([1 - Math.sin(t), 1 - Math.cos(t)]); }
  return out;
})();
/* One slab: between profile points a and b (metres; a[e] and b[e] at end e), back into the wall. */
function bankSlab(at, a, b, back) {
  const v = [];
  for (const e of [0, 1]) v.push(at(e, a[e][0], a[e][1]), at(e, b[e][0], b[e][1]), at(e, -back, b[e][1]), at(e, -back, a[e][1]));
  return makeBrush(v, [[0, 1, 2, 3], [4, 5, 6, 7], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]], { kind: "bank" });
}
/* A straight run along a wall: the wall line from p0 to p1 (plan [x, z]), n the way the bank faces,
   its radius going from r0 at p0 to r1 at p1. An open end at full size would be a quarter-circle face
   as tall as the bank, a wall to run into, so an open end tapers away to a lip low enough to step
   over: the bank rises out of the floor under whatever arrives along the wall. Each slab's corners at
   both ends are the same profile point scaled, so its faces are still flat and it is still convex. */
function bankRun(p0, p1, n, r0, r1) {
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), d = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
  const at = (e, w, h) => { const s = e ? len : 0; return [p0[0] + d[0] * s + n[0] * w, h, p0[1] + d[1] * s + n[1] * w]; };
  const P = (k) => [[BANK_PROFILE[k][0] * r0, BANK_PROFILE[k][1] * r0], [BANK_PROFILE[k][0] * r1, BANK_PROFILE[k][1] * r1]];
  const out = [];
  for (let k = 0; k < BANK_STEPS; k++) out.push(bankSlab(at, P(k), P(k + 1), 0.5));
  return out;
}
/* A turn: the wall line a quarter circle of radius R about c, from angle a0 to a1, in `slices`
   pieces. Its outside is filled back to the square corner it sits in (corner, plan [x, z]), and it
   goes on up past the bank's own height to BANK_TOP, so the turn ends in a wall, not a ledge. */
function bankTurn(c, R, a0, a1, slices, corner) {
  const out = [];
  const prof = BANK_PROFILE.map(([w, h]) => [w * BANK_R, h * BANK_R]).concat([[0, BANK_TOP]]);
  for (let i = 0; i < slices; i++) {
    const f0 = a0 + ((a1 - a0) * i) / slices, f1 = a0 + ((a1 - a0) * (i + 1)) / slices;
    const ang = [f0, f1];
    const at = (e, w, h) => { const ca = Math.cos(ang[e]), sa = Math.sin(ang[e]); return [c[0] + ca * (R - w), h, c[1] + sa * (R - w)]; };
    // back far enough that the chord at the back covers the corner: the farthest the square's sides
    // (or its corner, if this slice faces it) are from c, inside this slice
    const hit = (f) => Math.min(Math.abs((corner[0] - c[0]) / (Math.cos(f) || 1e-9)), Math.abs((corner[1] - c[1]) / (Math.sin(f) || 1e-9)));
    let far = Math.max(hit(f0), hit(f1));
    const fc = Math.atan2(corner[1] - c[1], corner[0] - c[0]);
    if (fc > Math.min(f0, f1) && fc < Math.max(f0, f1)) far = Math.max(far, Math.hypot(corner[0] - c[0], corner[1] - c[1]));
    const back = far / Math.cos(Math.abs(f1 - f0) / 2) - R + 0.05;
    for (let k = 0; k < prof.length - 1; k++) out.push(bankSlab(at, [prof[k], prof[k]], [prof[k + 1], prof[k + 1]], back));
  }
  return out;
}

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

  // the slipway: a ramp steep enough to slide from a standstill drops you beside a panel on the outer
  // wall, and the panel runs on into the alley under the nest, where the shaft's short wall has one too
  B.push(box(54.5, 0, 0.5, 60.9, 2.4, 2.5, { kind: "slope" }));
  B.push(prism([[2.5, 0], [2.5, 2.4], [11, 0]], "x", 54.5, 60.9, { kind: "slope" }));
  B.push(box(60.9, 0, 0.5, 61.99, 4.2, 36, { kind: "ride" }));
  B.push(box(56.6, 0, 22, 57.2, 4.2, 36, { kind: "ride" }));

  // the bank: out of the alley, the floor curves up into the outer wall, round the corner, and along
  // the perch's face. Both open ends rise out of the floor, so the alley's ride runs straight onto it.
  {
    const C = [55, 41], R = 7;
    B.push(...bankRun([62, 36], [62, C[1]], [-1, 0], 0.3, BANK_R));
    B.push(...bankTurn(C, R, 0, Math.PI / 2, 6, [62, 48]));
    B.push(...bankRun([C[0], 48], [48, 48], [0, -1], BANK_R, 0.3));
  }

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

  /* --- the air --- */
  // the Skyway: this quarter's two bridges meet at its corner tower; turned four ways they make the ring
  const SKY = 12, T = 0.6;
  B.push(box(5, SKY - T, 39.5, 44, SKY, 42.5, { kind: "bridge" }));
  B.push(box(39.5, SKY - T, 5, 42.5, SKY, 39.5, { kind: "bridge" }));
  B.push(box(-2, SKY - T, 39.5, 2, SKY, 42.5, { kind: "bridge" }));          // the stepping stone in the gap
  B.push(box(39.5, 0, 39.5, 42.5, SKY - T, 42.5, { kind: "trim" }));        // the corner tower
  B.push(box(15.5, 0, 40.5, 16.5, SKY - T, 41.5, { kind: "trim" }));        // stilts
  B.push(box(40.5, 0, 12, 41.5, SKY - T, 13, { kind: "trim" }));
  // cover up there: low blocks to fight along the bridges from, and one on the tower's outer corner
  // (each against one edge, so there is always a lane past it)
  B.push(box(22, SKY, 39.5, 23.6, SKY + 1.2, 40.7, { kind: "crate" }));
  B.push(box(31, SKY, 41.3, 32.2, SKY + 1.2, 42.5, { kind: "crate" }));
  B.push(box(39.5, SKY, 22, 40.7, SKY + 1.2, 23.6, { kind: "crate" }));
  B.push(box(41.3, SKY, 30, 42.5, SKY + 1.2, 31.2, { kind: "crate" }));
  B.push(box(42.5, SKY, 41, 44, SKY + 1.2, 42.5, { kind: "trim" }));
  // the on-ramp: a slab on its edge rising beside the bridge, open underneath
  B.push(prism([[1, 0], [20, SKY], [20, SKY - T], [1.95, 0]], "z", 42.5, 45.5, { kind: "bridge" }));
  // a pad beside the tower that throws you up onto the Skyway
  B.push(box(34, 0, 44.5, 37, 0.2, 47.5, { kind: "pad", push: [0, 23.5, -2.8] }));

  // the Halo: one side of the square ring of slabs over the Core, and the pad that throws you up to it
  B.push(box(-6, 15.4, 6, 10, 16, 10, { kind: "halo" }));
  B.push(box(14.5, 0, 6, 17.5, 0.2, 9, { kind: "pad", push: [-4.4, 26.8, 0] }));

  // a kite: hanging in the air over the surf ridge, for the grapple
  B.push(box(26, 13.4, 24, 30, 14, 28, { kind: "kite" }));
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
  const one = [[6, 49], [36, 3], [56, 12], [30, 56], [50, 40], [3, 18]];
  const out = [];
  for (let q = 0; q < 4; q++) for (const [x0, z0] of one) {
    let x = x0, z = z0;
    for (let i = 0; i < q; i++) { const t = x; x = -z; z = t; }
    out.push({ x, y: 0.02, z, yaw: Math.atan2(x, z), q });
  }
  return out;
}

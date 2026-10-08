/* rng.js — seeded randomness and noise.
 *
 * Lifted from Aeons (aeons/js/rng.js) unchanged: Bloomworks' world is an
 * endless grid of plots grown from one seed, which is exactly the problem
 * Aeons' endless map already solved.
 *
 * The world is infinite, so it is never stored: every tile is a pure function
 * of the seed and its coordinates, and only what the player changed is saved.
 * That makes everything here deterministic on purpose — Math.random() is for
 * sparks and dust, never for terrain, nodes or enemy bases. */

/** mulberry32: small, fast, and good enough for a game. */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A 32-bit hash of integers: the same inputs, the same answer, forever. */
export function hash(seed, x, y, z) {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13) ^ (y | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16) ^ ((z | 0) + 0x27d4eb2f), 0x165667b1);
  h ^= h >>> 15;
  return h >>> 0;
}
export const hash01 = (seed, x, y, z) => hash(seed, x, y, z) / 4294967296;

const fade = (t) => t * t * (3 - 2 * t);

/** Value noise in [-1, 1], smooth between integer lattice points. */
export function noise2(seed, x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash01(seed, xi, yi), b = hash01(seed, xi + 1, yi);
  const c = hash01(seed, xi, yi + 1), d = hash01(seed, xi + 1, yi + 1);
  const u = fade(xf), v = fade(yf);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/** Fractal noise: octaves of value noise, each finer and fainter. */
export function fbm(seed, x, y, oct) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let i = 0; i < (oct || 4); i++) {
    sum += noise2(seed + i * 1013, x * f, y * f) * amp;
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return sum / norm;
}

export function pick(r, list) { return list[Math.floor(r() * list.length) % list.length]; }
export function seedFromString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

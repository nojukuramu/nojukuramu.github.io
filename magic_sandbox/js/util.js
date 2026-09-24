/* util.js — the small maths every other module leans on.
 *
 * Pure: no DOM, no three.js. tools/validate.js imports this (and spellcore.js,
 * which uses it) straight into Node, so anything that touches `document` or
 * `window` belongs somewhere else. */

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const dist = (x1, z1, x2, z2) => Math.hypot(x2 - x1, z2 - z1);
export const dist2 = (x1, z1, x2, z2) => (x2 - x1) * (x2 - x1) + (z2 - z1) * (z2 - z1);
/** Signed shortest difference between two angles, in (-PI, PI]. */
export const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
/** Frame-rate independent exponential approach: the same feel at 30 and 144 fps. */
export const damp = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));

export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;

/** Seeded PRNG. Floors are generated from a seed so a layout can be rebuilt
 *  identically — the smoke test relies on that, and so does "retry floor". */
export function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + next() * (hi - lo);
  next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  return next;
}

/** 2D value noise with smooth interpolation — enough for ground patches and
 *  island coastlines, far cheaper than simplex and with no table to ship. */
export function valueNoise(seed) {
  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
}

export function fbm(noise, x, y, oct) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < (oct || 3); i++) { s += noise(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
  return s / norm;
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0");
}

export function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

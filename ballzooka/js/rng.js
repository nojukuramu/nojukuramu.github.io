/* rng.js — seeded randomness.
 *
 * The mulberry32, pick() and seedFromString() here are lifted from
 * Bloomworks (bloomworks/js/rng.js), which lifted them from Aeons. The noise
 * functions there are left behind: nothing in Ballzooka is a landscape.
 *
 * A run is a pure function of its seed, so the Daily is the same level for
 * everybody on the same day, and tools/validate.js can replay a level and get
 * the same result twice. Math.random() is for sparks only. */

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

export function pick(r, list) { return list[Math.floor(r() * list.length) % list.length]; }
export function seedFromString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Weighted pick: list of [item, weight]. */
export function weighted(r, list) {
  let sum = 0;
  for (const it of list) sum += it[1];
  let x = r() * sum;
  for (const it of list) { x -= it[1]; if (x <= 0) return it[0]; }
  return list[list.length - 1][0];
}
export const rint = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

/* ============================================================
   Type — a seeded random source

   Every challenge is a pure function of (category, length, seed). That is
   what makes "restart this one" exact, lets the validator regenerate a
   thousand challenges and count the repeats, and means a seed is all it takes
   to ask somebody else to type the same thing.

   mulberry32 is enough: this picks sentences, not keys.
   ============================================================ */

export function hash(str) {
  // FNV-1a, 32 bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function makeRng(seed) {
  let a = (typeof seed === "string" ? hash(seed) : seed >>> 0) || 1;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    shuffle: (arr) => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); const t = out[i]; out[i] = out[j]; out[j] = t; }
      return out;
    },
    /** n distinct picks, in random order */
    some: (arr, n) => rng.shuffle(arr).slice(0, Math.min(n, arr.length))
  };
  return rng;
}

/** A short, readable seed: it is shown on the results line. */
export function freshSeed() {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

/* num.js — numbers with no ceiling.
 *
 * "No number has a cap. Numbers grow past 10^308." A double cannot hold
 * that, but its logarithm can: every currency, every mote Value and every
 * Bloom XP total in Bloomworks is stored as log10 of itself — an "L-number".
 * Zero is -Infinity. Multiplying is adding, which is most of what an idle
 * game does; adding and subtracting go through lAdd and lSub below.
 *
 * Why not a mantissa/exponent class like break_infinity: motes are the hot
 * loop, and a mote's whole life is multiplications (stamps, Lucky, Charged,
 * Chains) plus one four-way sum (fusion). As a single double each of those
 * is one add and no allocation. Precision is fine: at 10^300 a double's log
 * still carries about thirteen significant digits of the value. */

export const ZERO = -Infinity;
export const L = (x) => (x > 0 ? Math.log10(x) : ZERO);
/** Back to a plain number; Infinity past 10^308, which only display avoids. */
export const N = (l) => (l === ZERO ? 0 : Math.pow(10, l));

/** log10(10^a + 10^b), stable at any size. */
export function lAdd(a, b) {
  if (a === ZERO) return b;
  if (b === ZERO) return a;
  if (a < b) { const t = a; a = b; b = t; }
  const d = b - a;
  if (d < -17) return a;
  return a + Math.log10(1 + Math.pow(10, d));
}

/** log10(10^a - 10^b), for a >= b. Anything at or under zero is ZERO. */
export function lSub(a, b) {
  if (b === ZERO) return a;
  if (b >= a) return ZERO;
  const d = b - a;
  if (d < -17) return a;
  return a + Math.log10(1 - Math.pow(10, d));
}

/** a >= b, forgiving the last bits so 5 Glow buys a 5 Glow track. */
export const lGte = (a, b) => b === ZERO || a >= b - 1e-9;
export const lMin = (a, b) => (a < b ? a : b);
export const lMax = (a, b) => (a > b ? a : b);

/** An integer from an L-number when it fits, for counts like Stars on a chart. */
export function lInt(l, cap) {
  if (l === ZERO) return 0;
  if (l > 15) return cap || Number.MAX_SAFE_INTEGER;
  const n = Math.floor(Math.pow(10, l) + 1e-7);
  return cap ? Math.min(cap, n) : n;
}

/* ---------- display ----------
   Short names run K, M, B, T, Qa, Qi, Sx, Sp, Oc, No, Dc; after Dc, letter
   pairs aa..zz, then three letters, and so on for ever. Scientific and
   engineering notation are a setting. */
const SHORT = ["", "K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
let notation = "short";
export function setNotation(n) { notation = n === "sci" || n === "eng" ? n : "short"; }
export function getNotation() { return notation; }

function letters(i) {
  // i = 0 -> "aa". Two letters cover 676 groups, then three, and so on.
  let len = 2, span = 676;
  while (i >= span) { i -= span; len++; span *= 26; }
  let s = "";
  for (let k = 0; k < len; k++) { s = String.fromCharCode(97 + (i % 26)) + s; i = Math.floor(i / 26); }
  return s;
}
export function suffix(group) { return group < SHORT.length ? SHORT[group] : letters(group - SHORT.length); }

function mant(m, digits) {
  // Three significant figures, trailing zeros trimmed: 1.23, 12.3, 123.
  const d = m >= 100 ? 0 : m >= 10 ? 1 : 2;
  let s = m.toFixed(Math.min(d, digits));
  if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/** Format an L-number. */
export function fmtL(l, digits) {
  if (digits == null) digits = 2;
  if (l === ZERO || l < -6) return "0";
  if (l < 3) {
    const v = Math.pow(10, l);
    if (v < 10 && Math.abs(v - Math.round(v)) > 1e-6) return v.toFixed(v < 1 ? 2 : 1).replace(/\.?0+$/, "");
    return String(Math.floor(v + 1e-6));
  }
  let e = Math.floor(l + 1e-12);
  let m = Math.pow(10, l - e);
  if (m >= 9.995) { m = 1; e += 1; }
  if (notation === "sci") return mant(m, digits) + "e" + e;
  const g = Math.floor(e / 3);
  const mm = m * Math.pow(10, e - g * 3);
  if (notation === "eng") return mant(mm, digits) + "e" + g * 3;
  return mant(mm, digits) + suffix(g);
}
/** Format a plain number. */
export const fmt = (x, digits) => (x <= 0 ? (x === 0 ? "0" : "-" + fmtL(L(-x), digits)) : fmtL(L(x), digits));

/** A multiplier given as an L-number, "x1.5", "x3.2K". */
export function fmtMulL(l) {
  if (l < 3) { const v = Math.pow(10, l); return "×" + (v >= 100 ? Math.round(v) : v >= 10 ? v.toFixed(1) : v.toFixed(2)).replace(/\.?0+$/, ""); }
  return "×" + fmtL(l);
}

export function fmtTime(s) {
  s = Math.max(0, Math.round(s));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m " + String(s % 60).padStart(2, "0") + "s";
  const h = Math.floor(m / 60);
  if (h < 48) return h + "h " + String(m % 60).padStart(2, "0") + "m";
  return Math.floor(h / 24) + "d " + (h % 24) + "h";
}

/** JSON has no -Infinity: L-numbers are written as null when zero. */
export const enc = (l) => (l === ZERO || l == null || Number.isNaN(l) ? null : Math.round(l * 1e12) / 1e12);
export const dec = (v) => (v == null || typeof v !== "number" || Number.isNaN(v) ? ZERO : v);

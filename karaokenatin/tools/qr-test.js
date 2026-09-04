/* tools/qr-test.js — conformance checks for js/qr.js, no dependencies.
 *
 * The encoder was validated against a reference implementation and its output
 * decoded with OpenCV's reader during development. This keeps the invariants
 * that caught the one real bug (alignment patterns wrongly omitted where they
 * cross the timing lines, which silently shifted every data module from
 * version 7 up) from coming back.
 *
 * Run: node tools/qr-test.js
 */
"use strict";

const QR = require("../js/qr.js");

let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || extra === undefined ? "" : "  → " + extra));
  if (!ok) failures++;
}

/* Total codewords and remainder bits per version (ISO/IEC 18004 table 1). */
const TOTAL = {
  1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346, 11: 404, 12: 466,
  13: 532, 14: 581, 15: 655, 16: 733, 17: 815, 18: 901, 19: 991, 20: 1085, 21: 1156, 22: 1258,
  23: 1364, 24: 1474, 25: 1588
};
/* Remainder bits: 0 at v1, 7 for v2–6, 0 for v7–13, 3 for v14–20, 4 for v21–27. */
const REMAINDER = {};
for (let v = 1; v <= 25; v++) REMAINDER[v] = v === 1 ? 0 : v <= 6 ? 7 : v <= 13 ? 0 : v <= 20 ? 3 : 4;

const MAX = QR.MAX_VERSION;

/* Every symbol must leave exactly the standard number of free data modules. */
let countOk = true;
for (let v = 1; v <= MAX; v++) {
  const grid = QR._internal.makeMatrix(v);
  let free = 0;
  for (let y = 0; y < grid.size; y++) {
    for (let x = 0; x < grid.size; x++) if (!grid.reserved[y][x]) free++;
  }
  const expected = TOTAL[v] * 8 + REMAINDER[v];
  if (free !== expected) {
    countOk = false;
    console.log("       version " + v + ": " + free + " free modules, expected " + expected);
  }
}
check("data module counts match the specification for versions 1–" + MAX, countOk);

/* Block structure must account for every codeword in the symbol. */
let blockOk = true;
["L", "M"].forEach((ecc) => {
  for (let v = 1; v <= MAX; v++) {
    const b = QR._internal.BLOCKS[ecc][v];
    const blocks = b[1] + b[3];
    const total = b[1] * b[2] + b[3] * b[4] + blocks * b[0];
    if (total !== TOTAL[v]) {
      blockOk = false;
      console.log("       " + ecc + v + ": blocks total " + total + ", expected " + TOTAL[v]);
    }
  }
});
check("block layouts sum to the total codeword count", blockOk);

/* Finder patterns anchor the three corners; a reader finds nothing without them. */
function finderAt(m, ox, oy) {
  const want = [
    "1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"
  ];
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      if ((m[oy + y][ox + x] ? "1" : "0") !== want[y][x]) return false;
    }
  }
  return true;
}
const sample = QR.encode("https://nojukuramu.github.io/karaokenatin/#/r/ABC123", { ecc: "M" });
check(
  "finder patterns are intact in all three corners",
  finderAt(sample.modules, 0, 0) &&
    finderAt(sample.modules, sample.size - 7, 0) &&
    finderAt(sample.modules, 0, sample.size - 7)
);

/* Timing patterns alternate across the symbol. */
let timingOk = true;
for (let i = 8; i < sample.size - 8; i++) {
  if (sample.modules[6][i] !== (i % 2 === 0)) timingOk = false;
  if (sample.modules[i][6] !== (i % 2 === 0)) timingOk = false;
}
check("timing patterns alternate correctly", timingOk);

/* A join URL should stay small enough to scan from across a room. */
check("a join URL fits in version 4 or smaller at ECC M", sample.version <= 4, "version " + sample.version);

/* Version selection tracks the documented byte-mode capacities. */
const CAPACITY_M = {
  1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213, 11: 251, 12: 287,
  13: 331, 14: 362, 15: 412, 16: 450, 17: 504, 18: 560, 19: 624, 20: 666, 21: 711, 22: 779,
  23: 857, 24: 911, 25: 997
};
let capOk = true;
for (let v = 1; v <= MAX; v++) {
  const got = QR.encode("a".repeat(CAPACITY_M[v]), { ecc: "M" }).version;
  if (got > v) { capOk = false; console.log("       " + CAPACITY_M[v] + " bytes chose version " + got + ", expected ≤ " + v); }
}
check("version selection matches byte-mode capacities at ECC M", capOk);

/* Oversized payloads fail loudly rather than producing an unreadable symbol. */
let threw = false;
try { QR.encode("x".repeat(CAPACITY_M[MAX] + 40), { ecc: "M" }); } catch (e) { threw = true; }
check("payloads beyond version " + MAX + " are rejected", threw);

/* Library sharing splits a payload by QR.capacity(); a chunk that size has to
 * actually fit, or every share would fail on its last few bytes. */
const room = QR.capacity("L");
check(
  "a full-capacity chunk encodes at ECC L",
  QR.encode("x".repeat(room), { ecc: "L" }).version === MAX,
  "capacity " + room
);

console.log(failures ? "\n" + failures + " failure(s)" : "\nall qr checks passed");
process.exit(failures ? 1 : 0);

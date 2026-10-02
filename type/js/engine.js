/* ============================================================
   Type — the typing arithmetic, with no DOM in it

   The page holds one hidden textarea. Whatever it contains is what the player
   has typed so far, and this file compares that against the target: which
   characters are right, wrong or still to come, where the caret is, and the
   numbers at the end. Keeping it free of the page is what lets
   tools/validate.js check the arithmetic in Node.

   Words per minute is the usual one: five characters make a word, and only
   characters that ended up right count. Accuracy is about keystrokes, not the
   final text: a mistake you backspace over still cost you.
   ============================================================ */

/** per-character state of `typed` against `target`: 0 pending, 1 right, 2 wrong */
export function compare(target, typed) {
  const out = new Array(target.length);
  for (let i = 0; i < target.length; i++) out[i] = i >= typed.length ? 0 : typed[i] === target[i] ? 1 : 2;
  return out;
}

export function isComplete(target, typed) { return typed === target; }

/** First wrong index, or -1. */
export function firstError(target, typed) {
  for (let i = 0; i < typed.length; i++) if (typed[i] !== target[i]) return i;
  return -1;
}

/**
 * A keystroke ledger. `input(prev, next, target)` is called with the
 * textarea's value before and after every change.
 */
export function makeLedger() {
  return { keys: 0, right: 0, wrong: 0, fixed: 0 };
}

export function record(ledger, prev, next, target) {
  if (next.length > prev.length && next.startsWith(prev)) {
    for (let i = prev.length; i < next.length; i++) {
      ledger.keys++;
      if (next[i] === target[i]) ledger.right++; else ledger.wrong++;
    }
  } else if (next.length < prev.length) {
    // backspaced over something that was wrong: that is a fix, not a loss
    for (let i = next.length; i < prev.length; i++) if (prev[i] !== target[i]) ledger.fixed++;
  }
}

export function wpm(chars, ms) { return ms > 0 ? Math.round(((chars / 5) / (ms / 60000)) * 10) / 10 : 0; }
export function accuracy(ledger) { return ledger.keys ? Math.round((ledger.right / ledger.keys) * 1000) / 10 : 100; }

/** Words-per-minute at each second, for the little consistency figure. */
export function consistency(samples) {
  if (samples.length < 3) return 100;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  if (!mean) return 100;
  const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / samples.length);
  return Math.max(0, Math.round((1 - sd / mean) * 100));
}

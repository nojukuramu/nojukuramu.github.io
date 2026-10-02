/* ============================================================
   Type — what is remembered

   Your settings, your best score for each category and length, a short run of
   recent results for the little graph, and a fingerprint of the last couple of
   hundred challenges so the same text is not dealt twice in a row of sittings.

   All of it stays in this browser. Storage can be blocked (a private window,
   a locked-down profile) or can throw on write, so every access is wrapped and
   the page works the same, minus the memory, without it.
   ============================================================ */

const KEY = "type:v1";
const SEEN_MAX = 300, HISTORY_MAX = 30;

const data = { prefs: { category: "all", length: "medium" }, best: {}, history: [], seen: [] };

try {
  const raw = JSON.parse(localStorage.getItem(KEY) || "null");
  if (raw && typeof raw === "object") {
    if (raw.prefs) Object.assign(data.prefs, raw.prefs);
    if (raw.best && typeof raw.best === "object") data.best = raw.best;
    if (Array.isArray(raw.history)) data.history = raw.history.slice(-HISTORY_MAX);
    if (Array.isArray(raw.seen)) data.seen = raw.seen.slice(-SEEN_MAX);
  }
} catch (e) { /* storage blocked or corrupt: start clean */ }

export function commit() {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* storage blocked or full */ }
}

export const prefs = data.prefs;
export const key = (cat, len) => cat + ":" + len;
export function best(cat, len) { const b = data.best[key(cat, len)]; return typeof b === "number" ? b : 0; }
export function history() { return data.history; }

/** Record a finished challenge. Returns true when it is a new best. */
export function submit(cat, len, r) {
  const k = key(cat, len), was = data.best[k] || 0;
  const isBest = r.wpm > was;
  if (isBest) data.best[k] = r.wpm;
  data.history.push({ wpm: r.wpm, acc: r.acc, cat, len, at: Date.now() });
  if (data.history.length > HISTORY_MAX) data.history.shift();
  commit();
  return isBest && was > 0;
}

export function wasSeen(h) { return data.seen.indexOf(h) >= 0; }
export function markSeen(h) {
  data.seen.push(h);
  if (data.seen.length > SEEN_MAX) data.seen.shift();
}

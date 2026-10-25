/* save.js — one save, in this browser's localStorage.
 *
 * The shape is Ballzooka's (ballzooka/js/save.js): defaults, a merge of
 * whatever was stored over them, one key. A night is never saved — a house
 * resumed from a snapshot would be a house with its answers already known,
 * and the research is clear that what keeps a night frightening is not
 * knowing. What is kept is the settings and a record of past nights. */

const KEY = "lastflame-save-v1";

function defaults() {
  return {
    v: 1,
    set: {
      fear: "normal", mode: "lola", scares: "full", motion: true, quality: "auto",
      sens: 1, invert: false, fov: 72, bright: 0.5, volume: 0.85, captions: false, crouchToggle: true, textures: "high"
    },
    stats: { nights: 0, escaped: 0, deaths: 0, best: 0, lampsLit: 0 },
    seenIntro: false
  };
}

export const S = defaults();

function merge(into, from) {
  for (const k of Object.keys(from)) {
    if (from[k] && typeof from[k] === "object" && !Array.isArray(from[k]) && into[k] && typeof into[k] === "object" && !Array.isArray(into[k])) merge(into[k], from[k]);
    else if (k in into) into[k] = from[k];
  }
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const o = JSON.parse(raw);
    if (!o || typeof o !== "object" || o.v !== 1) return false;
    merge(S, o);
    return true;
  } catch (e) { return false; }
}
export function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); return true; } catch (e) { return false; } }
export function wipe() {
  try { localStorage.removeItem(KEY); } catch (e) { /* nothing to wipe */ }
  const d = defaults();
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, d);
}

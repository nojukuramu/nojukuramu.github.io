/* save.js — one save, in this browser's localStorage.
 *
 * A run is never saved: a level is two or three minutes long, and a level
 * resumed from a snapshot would be a level replayed with the answers. What
 * is kept is everything around the runs — the next level, coins, the shop,
 * skins, trophies, bests and settings. */

const KEY = "ballzooka-save-v1";

function defaults() {
  return {
    v: 1, level: 1, cleared: 0, coins: 0, spent: 0,
    upg: {}, cannon: "classic", ball: "classic",
    owned: { cannons: ["classic"], balls: ["classic"] },
    ach: {}, stars: {},
    best: { endless: 0, endlessWave: 0, daily: {} },
    stats: { kills: 0, fired: 0, bosses: 0, plays: 0, peak: 0 },
    set: { sound: true, music: true, haptics: true, motion: true, fx: true },
    seenHelp: false
  };
}

export const S = defaults();

function merge(into, from) {
  for (const k of Object.keys(from)) {
    if (from[k] && typeof from[k] === "object" && !Array.isArray(from[k]) && into[k] && typeof into[k] === "object" && !Array.isArray(into[k])) merge(into[k], from[k]);
    else into[k] = from[k];
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

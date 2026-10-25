/* save.js — two saves, in this browser's localStorage.
 *
 * The shape is Last Flame's (lastflame/js/save.js), which is Ballzooka's
 * (ballzooka/js/save.js): defaults, a merge of whatever was stored over
 * them, one key. Unlike a night in Lola's house, a journey here is long, and
 * a phone gets put down mid-walk: so the journey has a key of its own
 * (game.js's snapshot), written every twenty seconds and whenever the game
 * is put away, and cleared when a new journey begins. Settings and the
 * record of past journeys stay in the first. Nothing leaves the device. */

const KEY = "longlight-save-v1", JOURNEY = "longlight-journey-v1";

function defaults() {
  return {
    v: 1,
    set: {
      diff: "normal", quality: "auto", assets: "packed", motion: true,
      sens: 1, invert: false, fov: 72, bright: 0.5, volume: 0.85, captions: false
    },
    stats: { journeys: 0, arrived: 0, beacons: 0, km: 0 },
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

/** The journey under way, or null. */
export function loadJourney() {
  try { const raw = localStorage.getItem(JOURNEY); const o = raw && JSON.parse(raw); return o && o.v === 1 ? o : null; } catch (e) { return null; }
}
export function saveJourney(snap) { try { localStorage.setItem(JOURNEY, JSON.stringify(snap)); return true; } catch (e) { return false; } }
export function clearJourney() { try { localStorage.removeItem(JOURNEY); } catch (e) { /* nothing to clear */ } }

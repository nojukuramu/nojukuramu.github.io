/* save.js — the one record this game keeps, in this browser only.
 *
 * Shape lifted from Magic Sandbox (magic_sandbox/js/save.js): one
 * localStorage key, one JSON object, read once at boot and written whenever
 * something worth keeping changes, and every field re-validated on the way
 * back in, because localStorage is editable by anyone with devtools.
 * Nothing is ever sent anywhere.
 *
 * What it holds: your eight scrolls, your settings, and the journey under
 * way — its seed, where you stand, your level, rank and potions, which
 * waystones you have touched, which Wardens you have beaten, and which
 * chests you have opened. The Phaser build kept none of it: a reload was a
 * new world and eight blank scrolls. */

import { normalizeDesign, starterSpells, SLOTS, MAX_RANK } from "./spellcore.js";

const KEY = "mcircles:v1";
export { SLOTS };

export const DEFAULT_SETTINGS = {
  quality: "auto",     // auto | low | medium | high
  master: 0.8, music: 0.5, sfx: 0.8,
  shake: true, numbers: true, flashes: true, autoAim: true
};
export const LOOKS = ["people/character-male-a", "people/character-female-a", "people/character-male-d", "people/character-female-c"];

function fresh() {
  return {
    v: 1,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    spells: starterSpells(),
    journey: null,
    best: { distance: 0, sigils: 0, level: 1 },
    stats: { journeys: 0, kills: 0, deaths: 0 },
    tutorial: {}
  };
}

const isNum = (v) => typeof v === "number" && isFinite(v);
const ids = (a, re, max) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && re.test(x)).slice(-max) : []);

function cleanJourney(J) {
  if (!J || typeof J !== "object" || typeof J.seed !== "string") return null;
  const seed = J.seed.replace(/[^\w\- ]/g, "").slice(0, 32);
  if (!seed) return null;
  const pos = (v, d) => (isNum(v) && Math.abs(v) < 1e7 ? v : d);
  return {
    seed,
    look: LOOKS.includes(J.look) ? J.look : LOOKS[0],
    x: pos(J.x, 0), z: pos(J.z, 3),
    level: isNum(J.level) ? Math.max(1, Math.min(99, J.level | 0)) : 1,
    xp: isNum(J.xp) ? Math.max(0, J.xp) : 0,
    rank: isNum(J.rank) ? Math.max(1, Math.min(MAX_RANK, J.rank | 0)) : 1,
    potions: isNum(J.potions) ? Math.max(0, Math.min(5, J.potions | 0)) : 2,
    hp: isNum(J.hp) ? Math.max(1, J.hp) : null,
    time: isNum(J.time) ? Math.max(0, J.time) : 0,
    day: isNum(J.day) ? ((J.day % 1) + 1) % 1 : 0.32,
    kills: isNum(J.kills) ? Math.max(0, J.kills | 0) : 0,
    home: J.home && isNum(J.home.x) && isNum(J.home.z) ? { x: pos(J.home.x, 0), z: pos(J.home.z, 3) } : { x: 0, z: 3 },
    waystones: ids(J.waystones, /^w-?\d+_-?\d+$/, 400),
    sigils: ids(J.sigils, /^s-?\d+_-?\d+$/, 400),
    chests: ids(J.chests, /^s-?\d+_-?\d+$/, 2000),
    seen: ids(J.seen, /^s-?\d+_-?\d+$/, 2000)
  };
}

function clean(raw) {
  const d = fresh();
  if (!raw || typeof raw !== "object") return d;
  const s = raw.settings || {};
  if (["auto", "low", "medium", "high"].includes(s.quality)) d.settings.quality = s.quality;
  for (const k of ["master", "music", "sfx"]) if (isNum(s[k])) d.settings[k] = Math.min(1, Math.max(0, s[k]));
  for (const k of ["shake", "numbers", "flashes", "autoAim"]) if (typeof s[k] === "boolean") d.settings[k] = s[k];
  if (Array.isArray(raw.spells)) for (let i = 0; i < SLOTS; i++) if (raw.spells[i]) d.spells[i] = normalizeDesign(raw.spells[i]);
  d.journey = cleanJourney(raw.journey);
  const b = raw.best || {};
  for (const k of ["distance", "sigils", "level"]) if (isNum(b[k]) && b[k] >= 0) d.best[k] = b[k];
  const st = raw.stats || {};
  for (const k of ["journeys", "kills", "deaths"]) if (isNum(st[k]) && st[k] >= 0) d.stats[k] = st[k];
  if (raw.tutorial && typeof raw.tutorial === "object")
    for (const k in raw.tutorial) if (raw.tutorial[k] === true && /^[a-z]{2,12}$/.test(k)) d.tutorial[k] = true;
  return d;
}

let data = fresh();
try { data = clean(JSON.parse(localStorage.getItem(KEY))); } catch (e) { data = fresh(); }

/* Ask the browser to keep this origin's storage out of eviction, as Magic
   Sandbox does; a refusal is only logged. */
try {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((already) => already || navigator.storage.persist()).catch(() => {});
  }
} catch (e) {}

let pending = 0;
export function commit() { clearTimeout(pending); pending = setTimeout(flush, 250); }
export function flush() {
  clearTimeout(pending);
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
}
if (typeof addEventListener === "function") addEventListener("pagehide", flush);

export const save = {
  get data() { return data; },
  get settings() { return data.settings; },
  get journey() { return data.journey; },
  spell(i) { return data.spells[i]; },
  setSpell(i, design) { data.spells[i] = normalizeDesign(design); commit(); },
  startJourney(seed, look) {
    data.journey = cleanJourney({ seed, look });
    data.stats.journeys++;
    flush();
    return data.journey;
  },
  setJourney(J) { data.journey = cleanJourney(J); commit(); },
  endJourney() { data.journey = null; flush(); },
  tutorialDone(k) { return !!data.tutorial[k]; },
  markTutorial(k) { if (!data.tutorial[k]) { data.tutorial[k] = true; commit(); } },
  resetAll() { data = fresh(); flush(); },
  clean, commit, flush
};

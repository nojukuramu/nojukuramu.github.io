/* save.js — the one record this game keeps, in this browser only.
 *
 * Everything lives under a single localStorage key as one JSON object, read
 * once at boot and written whenever something worth keeping changes: your
 * four pages, what you have discovered, your settings, your best climb, and
 * the landing you can retry from, and the name you go by in multiplayer.
 * Nothing is sent anywhere — except, once you join a room, your name and
 * your four pages, to the mages in it.
 *
 * The record is untrusted on the way back in — localStorage is editable by
 * anyone with devtools — so every field is re-validated rather than merged
 * blindly, and spells go through spellcore's normalizeDesign(). */

import { normalizeDesign, starterSpells, ELEMENT_IDS, FORM_IDS, REACTION_IDS, MAX_RANK } from "./spellcore.js";
import { BOON_BY_ID } from "./boons.js";

const KEY = "msandbox:v2";
export const SLOTS = 4;

export const DEFAULT_SETTINGS = {
  quality: "auto",     // auto | low | medium | high
  master: 0.8, music: 0.55, sfx: 0.8,
  shake: true, numbers: true, flashes: true, autoAim: true
};

function fresh() {
  return {
    v: 2,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    spells: starterSpells(),
    grimoire: { elements: [], forms: [], reactions: [] },
    best: { floor: 0, time: 0, wins: 0 },
    stats: { runs: 0, kills: 0, deaths: 0 },
    landing: null,
    tutorial: {},
    name: ""
  };
}

const isNum = (v) => typeof v === "number" && isFinite(v);

function clean(raw) {
  const d = fresh();
  if (!raw || typeof raw !== "object") return d;
  const s = raw.settings || {};
  if (["auto", "low", "medium", "high"].includes(s.quality)) d.settings.quality = s.quality;
  for (const k of ["master", "music", "sfx"]) if (isNum(s[k])) d.settings[k] = Math.min(1, Math.max(0, s[k]));
  for (const k of ["shake", "numbers", "flashes", "autoAim"]) if (typeof s[k] === "boolean") d.settings[k] = s[k];
  if (Array.isArray(raw.spells)) for (let i = 0; i < SLOTS; i++) if (raw.spells[i]) d.spells[i] = normalizeDesign(raw.spells[i]);
  const g = raw.grimoire || {};
  const known = { elements: ELEMENT_IDS.concat(["arcane"]), forms: FORM_IDS, reactions: REACTION_IDS };
  for (const k in known) if (Array.isArray(g[k])) d.grimoire[k] = g[k].filter((x) => known[k].includes(x));
  const b = raw.best || {};
  for (const k of ["floor", "time", "wins"]) if (isNum(b[k]) && b[k] >= 0) d.best[k] = b[k];
  const st = raw.stats || {};
  for (const k of ["runs", "kills", "deaths"]) if (isNum(st[k]) && st[k] >= 0) d.stats[k] = st[k];
  d.landing = cleanLanding(raw.landing);
  if (typeof raw.name === "string") d.name = raw.name.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 16);
  if (raw.tutorial && typeof raw.tutorial === "object")
    for (const k in raw.tutorial) if (raw.tutorial[k] === true && /^[a-z]{2,12}$/.test(k)) d.tutorial[k] = true;
  return d;
}

function cleanLanding(L) {
  if (!L || typeof L !== "object" || !isNum(L.floor) || L.floor < 1 || L.floor > 999) return null;
  const boons = {};
  if (L.boons && typeof L.boons === "object")
    for (const id in L.boons) if (BOON_BY_ID[id] && isNum(L.boons[id])) boons[id] = Math.min(BOON_BY_ID[id].max, Math.max(0, L.boons[id] | 0));
  return {
    floor: L.floor | 0,
    level: isNum(L.level) ? Math.max(1, Math.min(99, L.level | 0)) : 1,
    xp: isNum(L.xp) ? Math.max(0, L.xp) : 0,
    rank: isNum(L.rank) ? Math.max(1, Math.min(MAX_RANK, L.rank | 0)) : 1,
    potions: isNum(L.potions) ? Math.max(0, Math.min(6, L.potions | 0)) : 2,
    time: isNum(L.time) ? Math.max(0, L.time) : 0,
    kills: isNum(L.kills) ? Math.max(0, L.kills | 0) : 0,
    boons
  };
}

let data = fresh();
try { data = clean(JSON.parse(localStorage.getItem(KEY))); } catch (e) { data = fresh(); }

/* Ask the browser to keep this origin's storage out of eviction — Chrome
   under disk pressure, Safari's seven-day wipe of sites with no recent
   visit — so a week away does not cost you your spellbook. Same request the
   first version of this game made; a refusal is only logged. */
try {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted()
      .then((already) => already || navigator.storage.persist())
      .then((granted) => { if (!granted) console.warn("[msandbox] persistent storage was not granted"); })
      .catch(() => {});
  }
} catch (e) {}

let pending = 0;
export function commit() {
  // Coalesce bursts (dragging a slider writes on every tick) into one write.
  clearTimeout(pending);
  pending = setTimeout(flush, 250);
}
export function flush() {
  clearTimeout(pending);
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {}
}
if (typeof addEventListener === "function") addEventListener("pagehide", flush);

export const save = {
  get data() { return data; },
  get settings() { return data.settings; },
  spell(i) { return data.spells[i]; },
  setSpell(i, design) { data.spells[i] = normalizeDesign(design); commit(); },
  discover(kind, id) {
    const list = data.grimoire[kind];
    if (!list || list.includes(id)) return false;
    list.push(id); commit(); return true;
  },
  knows(kind, id) { return !!(data.grimoire[kind] && data.grimoire[kind].includes(id)); },
  setLanding(l) { data.landing = cleanLanding(l); flush(); },
  clearLanding() { data.landing = null; flush(); },
  tutorialDone(k) { return !!data.tutorial[k]; },
  markTutorial(k) { if (!data.tutorial[k]) { data.tutorial[k] = true; commit(); } },
  resetAll() { data = fresh(); flush(); },
  commit, flush
};

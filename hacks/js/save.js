/* save.js — the one record this game keeps, in this browser only.
 *
 * Same stance as Magic Sandbox's save.js: one localStorage key, one JSON
 * object, read once at boot and written when something worth keeping
 * changes — settings, key binds, both touch layouts, your loadout, your
 * name, and your hacks (their code included). Nothing is sent anywhere.
 *
 * Everything read back is re-checked rather than merged blindly, because
 * localStorage is editable by anyone with devtools and a bad bind or a
 * layout with a button off-screen would otherwise survive every reload. */

import { ACTION_IDS, defaultBinds, validCode, TOUCH_IDS, TOUCH_LAYOUTS } from "./controls.js";
import { cleanLoadout, DEFAULT_LOADOUT } from "./weapons.js";
import { starterHacks } from "./hackdocs.js";

const KEY = "hacks:v1";
export const MAX_HACKS = 40;
export const MAX_CODE = 100000;

export const DEFAULT_SETTINGS = {
  sens: 1.6, invertY: false, fov: 95, adsSens: 0.8,
  sprintMode: "hold",        // hold | toggle | auto
  crouchMode: "hold",        // hold | toggle
  quality: "auto",           // auto | low | medium | high
  master: 0.8, sfx: 0.9,
  showSpeed: true, showFps: false,
  crosshair: "#ffffff",
  pauseEditing: true,        // solo play pauses while the hacks panel is open
  touchLook: 1.0,
  touchAutoSprint: true
};

const isNum = (v) => typeof v === "number" && isFinite(v);
const clampN = (v, a, b, d) => (isNum(v) ? Math.max(a, Math.min(b, v)) : d);

function freshTouch() { return JSON.parse(JSON.stringify(TOUCH_LAYOUTS)); }

function fresh() {
  return {
    v: 1,
    name: "",
    settings: Object.assign({}, DEFAULT_SETTINGS),
    binds: defaultBinds(),
    touch: freshTouch(),
    loadout: Object.assign({}, DEFAULT_LOADOUT),
    hacks: starterHacks(),
    solo: { mode: "ffa", bots: 5, diff: "normal", target: 25 },
    stats: { kills: 0, deaths: 0, topSpeed: 0 },
    lessons: []
  };
}

export function cleanHack(h, i) {
  if (!h || typeof h !== "object") return null;
  const code = typeof h.code === "string" ? h.code.slice(0, MAX_CODE) : "";
  const name = String(h.name || "Hack " + (i + 1)).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 32) || "Hack " + (i + 1);
  const id = typeof h.id === "string" && /^[a-z0-9]{4,16}$/.test(h.id) ? h.id : newId();
  return { id, name, code, on: !!h.on };
}
export function newId() { return Math.random().toString(36).slice(2, 10).padEnd(8, "0"); }

function clean(raw) {
  const d = fresh();
  if (!raw || typeof raw !== "object") return d;
  if (typeof raw.name === "string") d.name = raw.name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 16);
  const s = raw.settings || {};
  const S = d.settings;
  S.sens = clampN(s.sens, 0.1, 10, S.sens);
  S.fov = clampN(s.fov, 70, 120, S.fov);
  S.adsSens = clampN(s.adsSens, 0.2, 2, S.adsSens);
  S.master = clampN(s.master, 0, 1, S.master);
  S.sfx = clampN(s.sfx, 0, 1, S.sfx);
  S.touchLook = clampN(s.touchLook, 0.2, 3, S.touchLook);
  for (const k of ["invertY", "showSpeed", "showFps", "pauseEditing", "touchAutoSprint"]) if (typeof s[k] === "boolean") S[k] = s[k];
  if (["hold", "toggle", "auto"].includes(s.sprintMode)) S.sprintMode = s.sprintMode;
  if (["hold", "toggle"].includes(s.crouchMode)) S.crouchMode = s.crouchMode;
  if (["auto", "low", "medium", "high"].includes(s.quality)) S.quality = s.quality;
  if (typeof s.crosshair === "string" && /^#[0-9a-f]{6}$/i.test(s.crosshair)) S.crosshair = s.crosshair;

  const b = raw.binds || {};
  for (const id of ACTION_IDS) if (Array.isArray(b[id])) d.binds[id] = [0, 1].map((i) => (validCode(b[id][i]) ? b[id][i] : ""));

  const t = raw.touch || {};
  for (const o of ["landscape", "portrait"]) {
    const src = t[o] || {};
    for (const id of TOUCH_IDS) {
      const q = src[id];
      if (!q || typeof q !== "object") continue;
      const def = d.touch[o][id];
      // a button can be moved anywhere, but never off the screen
      d.touch[o][id] = { x: clampN(q.x, 0.03, 0.97, def.x), y: clampN(q.y, 0.03, 0.97, def.y), s: clampN(q.s, 32, 220, def.s), a: clampN(q.a, 0.25, 1, 1) };
    }
  }
  d.loadout = cleanLoadout(raw.loadout);
  if (Array.isArray(raw.hacks)) {
    const seen = new Set();
    d.hacks = raw.hacks.slice(0, MAX_HACKS).map(cleanHack).filter((h) => h && !seen.has(h.id) && seen.add(h.id));
  }
  const so = raw.solo || {};
  if (["ffa", "tdm", "practice"].includes(so.mode)) d.solo.mode = so.mode;
  d.solo.bots = Math.round(clampN(so.bots, 0, 11, d.solo.bots));
  if (["easy", "normal", "hard", "insane"].includes(so.diff)) d.solo.diff = so.diff;
  d.solo.target = Math.round(clampN(so.target, 5, 100, d.solo.target));
  const st = raw.stats || {};
  for (const k of ["kills", "deaths", "topSpeed"]) d.stats[k] = clampN(st[k], 0, 1e9, 0);
  if (Array.isArray(raw.lessons)) d.lessons = raw.lessons.filter((x) => typeof x === "string").slice(0, 64);
  return d;
}

function load() {
  try { return clean(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { return fresh(); }
}

export const save = {
  data: load(),
  get settings() { return this.data.settings; },
  commit() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); return true; } catch (e) { return false; }
  },
  resetBinds() { this.data.binds = defaultBinds(); this.commit(); },
  resetTouch(orient) { this.data.touch[orient] = freshTouch()[orient]; this.commit(); }
};

// A browser that is running out of room evicts the least-used origin first;
// asking for persistence is how a player's hacks survive that.
try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* not offered */ }

/* save.js — a fourteen-hour game has to survive a closed tab.
 *
 * Two stores. Settings are small and live in localStorage under one key, as
 * every app here keeps them. Games are not small — a realm hours in has
 * thousands of felled trees and a long memory of explored ground — so they go
 * to IndexedDB, which has room for them: an autosave slot written every
 * minute and whenever the page is hidden, and three slots of your own.
 *
 * The world itself is never saved. It is regenerated from the seed, and only
 * the chunks somebody changed are written out, along with what has been
 * explored as one bit per tile. Units are saved by their orders, not their
 * paths: on load every unit simply starts its order again. */

import { G, emit, resetState } from "./state.js";
import { CHUNK } from "./data.js";
import { World } from "./world.js";
import { refreshUnit, refreshBuilding, recountSupply } from "./entities.js";
import { setOrder } from "./units.js";
import { updateFog } from "./fog.js";
import { defaultAuto } from "./auto.js";

export const SAVE_VERSION = 1;
const SKEY = "aeons:settings";

/* ---------------- settings ---------------- */
export const DEFAULT_SETTINGS = {
  master: 0.8, sfx: 0.9, music: 0.45,
  edgePan: true, panSpeed: 1, quality: "auto", lights: true, weather: true,
  forceLandscape: true,       // phones: lock or turn the game sideways (orient.js)
  hints: true, autosave: true, speed: 1
};
function loadSettings() {
  const s = Object.assign({}, DEFAULT_SETTINGS);
  try {
    const raw = JSON.parse(localStorage.getItem(SKEY) || "null");
    if (raw && typeof raw === "object") for (const k in DEFAULT_SETTINGS) if (typeof raw[k] === typeof DEFAULT_SETTINGS[k]) s[k] = raw[k];
  } catch (e) { /* storage blocked: defaults */ }
  s.master = clamp(s.master, 0, 1); s.sfx = clamp(s.sfx, 0, 1); s.music = clamp(s.music, 0, 1); s.panSpeed = clamp(s.panSpeed, 0.3, 3);
  if (["auto", "low", "high"].indexOf(s.quality) < 0) s.quality = "auto";   // auto: high, until a phone shows it cannot keep up
  if ([0.5, 1, 1.5, 2, 3].indexOf(s.speed) < 0) s.speed = 1;
  return s;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, +v || 0));
export const settings = loadSettings();
export function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch (e) { /* not kept */ } }

/* ---------------- bytes ---------------- */
function b64(u8) {
  if (typeof Buffer !== "undefined" && typeof window === "undefined") return Buffer.from(u8).toString("base64");
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str, n) {
  let u8;
  if (typeof Buffer !== "undefined" && typeof window === "undefined") u8 = new Uint8Array(Buffer.from(str, "base64"));
  else { const s = atob(str); u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); }
  if (n && u8.length !== n) { const o = new Uint8Array(n); o.set(u8.subarray(0, n)); return o; }
  return u8;
}
function packBits(a) { const o = new Uint8Array(Math.ceil(a.length / 8)); for (let i = 0; i < a.length; i++) if (a[i]) o[i >> 3] |= 1 << (i & 7); return o; }
function unpackBits(o, n) { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = (o[i >> 3] >> (i & 7)) & 1; return a; }

/* ---------------- the record ---------------- */
const UNIT_KEYS = ["id", "line", "tier", "team", "hero", "x", "y", "hp", "order", "oq", "carry", "stance", "base", "boost", "lvl", "xp", "skcd", "free", "drone", "turret", "expire", "face", "dropId", "post"];
const BLD_KEYS = ["id", "type", "team", "tx", "ty", "level", "hp", "built", "q", "qt", "loop", "rally", "base", "boost", "node", "seen", "cost", "prod"];

export function serialize() {
  const W = G.world;
  const chunks = [], explored = [];
  for (const c of W.chunks.values()) {
    if (c.mod) chunks.push([c.cx, c.cy, b64(c.t), b64(c.wood)]);
    let any = 0;
    for (let i = 0; i < c.exp.length; i++) if (c.exp[i]) { any = 1; break; }
    if (any) explored.push([c.cx, c.cy, b64(packBits(c.exp))]);
  }
  const byKey = (a, b) => a[0] - b[0] || a[1] - b[1];
  chunks.sort(byKey); explored.sort(byKey);
  const pick = (o, keys) => { const r = {}; for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== false) r[k] = o[k]; return r; };
  const units = G.units.filter((u) => !u.dead).map((u) => {
    const r = pick(u, UNIT_KEYS);
    // an order that points at an object is saved by the object's id
    r.order = cleanOrder(u.order);
    r.oq = (u.oq || []).map(cleanOrder);
    r.hp = Math.round(u.hp * 10) / 10; r.x = Math.round(u.x); r.y = Math.round(u.y);
    return r;
  });
  const blds = G.blds.filter((b) => !b.dead).map((b) => pick(b, BLD_KEYS));
  return {
    v: SAVE_VERSION, savedAt: Date.now(),
    seed: G.seed, diff: G.diff, time: G.time, tick: G.tick, nextId: G.nextId,
    world: { bounds: W.bounds, nextNode: W.nextNode, chunks, explored, nodes: [...W.nodes.values()].map((n) => [n.id, n.type, n.tx, n.ty, Math.round(n.amount), n.max, n.building]) },
    res: G.res, era: G.era, tech: G.tech, tiers: G.tiers, doctrines: G.doctrines, researching: G.researching, heroes: G.heroes,
    phase: G.phase, bases: [...G.bases.values()], contacts: G.intel.contacts, nextContact: G.intel.nextContact,
    auto: G.auto, codex: G.codex, stats: G.stats, groups: G.groups, ghosts: [...G.ghosts.values()], loreSeen: G.loreSeen || [],
    beaconLit: G.beaconLit, complete: G.complete, units, blds
  };
}
function cleanOrder(o) {
  if (!o) return { t: "idle" };
  const r = {};
  for (const k in o) if (typeof o[k] !== "object" || o[k] === null) r[k] = o[k];
  return r;
}

export function deserialize(d) {
  if (!d || d.v !== SAVE_VERSION) throw new Error("This save is from a version of the game that cannot be read.");
  resetState();
  G.seed = d.seed >>> 0; G.diff = d.diff || "normal"; G.time = d.time || 0; G.tick = d.tick || 0; G.nextId = d.nextId || 1;
  const W = G.world = new World(G.seed);
  W.bounds = Object.assign({}, d.world.bounds);
  W.nextNode = d.world.nextNode;
  // every chunk inside the border, without rolling its nodes: the save has them
  const b = W.bounds;
  for (let cy = Math.floor(b.y0 / CHUNK); cy < Math.ceil(b.y1 / CHUNK); cy++) for (let cx = Math.floor(b.x0 / CHUNK); cx < Math.ceil(b.x1 / CHUNK); cx++) W.gen(cx, cy, false);
  const N = CHUNK * CHUNK;
  for (const [cx, cy, t, wood] of d.world.chunks) { const c = W.chunks.get((cx + 32768) * 65536 + (cy + 32768)) || W.gen(cx, cy, false); c.t = unb64(t, N); c.wood = unb64(wood, N); c.mod = true; }
  for (const [cx, cy, bits] of d.world.explored) { const c = W.chunks.get((cx + 32768) * 65536 + (cy + 32768)); if (c) c.exp = unpackBits(unb64(bits), N); }
  for (const [id, type, tx, ty, amount, max, building] of d.world.nodes) {
    const n = W.addNode(type, tx, ty, 0, amount);
    W.nodes.delete(n.id); n.id = id; n.max = max || amount; W.nodes.set(id, n);
    W.occupyArea(tx, ty, n.w, n.h, id);
    n.building = building || 0;
  }
  Object.assign(G.res, d.res);
  G.era = d.era || 0; G.tech = d.tech || {}; G.tiers = d.tiers || {}; G.doctrines = d.doctrines || {}; G.researching = d.researching || {}; G.heroes = d.heroes || {};
  G.phase = d.phase; G.bases = new Map((d.bases || []).map((x) => [x.id, x]));
  G.intel.contacts = d.contacts || []; G.intel.nextContact = d.nextContact || 1;
  G.auto = Object.assign(defaultAuto(), d.auto || {});
  G.codex = d.codex || []; G.stats = Object.assign(G.stats, d.stats || {}); G.groups = d.groups || G.groups;
  G.ghosts = new Map((d.ghosts || []).map((g) => [g.id, g]));
  G.loreSeen = d.loreSeen || []; G.beaconLit = !!d.beaconLit; G.complete = !!d.complete; G.zones = [];
  G.mode = "play";
  for (const s of d.blds) {
    const bd = Object.assign({
      kind: "bld", team: 0, w: 0, h: 0, r: 0, maxHp: 0, q: [], qt: 0, loop: false, rally: null, cd: 0, tgt: 0, base: 0, node: 0, dead: false, lastHit: -99, bThis: 0, sel: false, boost: 1, seen: false, level: 1, built: 1, prod: 0
    }, s);
    const def = BUILDING_DEFS()[bd.type];
    bd.w = def.w; bd.h = def.h; bd.x = (bd.tx + def.w / 2) * 32; bd.y = (bd.ty + def.h / 2) * 32; bd.r = Math.max(def.w, def.h) * 16;
    const hp = bd.hp; bd.maxHp = 0; refreshBuilding(bd); bd.hp = Math.min(bd.maxHp, hp);
    W.occupyArea(bd.tx, bd.ty, bd.w, bd.h, bd.id);
    G.ents.set(bd.id, bd); G.blds.push(bd);
  }
  for (const s of d.units) {
    const def = LINE_DEFS()[s.line];
    const u = Object.assign({
      kind: "unit", hero: null, px: s.x, py: s.y, r: { inf: 9, mnt: 13, sie: 14, nav: 17, air: 14 }[def.cls], cls: def.cls, move: def.move,
      maxHp: 0, st: null, order: { t: "idle" }, oq: [], path: null, pi: 0, goal: null, waitPath: false, partial: false, tgt: 0, cd: 0, face: 0, anim: Math.random() * 10,
      moving: false, atkAnim: 0, carry: null, gs: "", gt: 0, stance: "aggr", manual: false, buffs: {}, stun: 0, idleT: 0, lastHit: -99, hidden: false, base: 0, scan: 0,
      stuck: 0, lastPos: 0, home: null, xp: 0, lvl: 1, dead: false, boost: 1, sel: false, tier: 0, team: 0
    }, s);
    if (u.hero) { u.r = 11; u.skcd = u.skcd || [0, 0, 0, 0]; }
    if (u.turret) { u.cls = "sie"; u.r = 12; }
    const hp = u.hp; u.maxHp = 0; refreshUnit(u); u.hp = Math.min(u.maxHp, hp);
    if (u.turret) { u.st.range = 5.5; u.st.speed = 0; u.st.hitsAir = true; }
    if (u.drone) { u.st.atk *= 0.25; u.st.sight += 3; }
    G.ents.set(u.id, u); G.units.push(u);
  }
  // orders start again, now that everything they point at exists
  for (const u of G.units) { const o = u.order, q = u.oq; u.order = { t: "idle" }; u.oq = []; setOrder(u, o); u.oq = q || []; }
  for (const id in G.heroes) { const h = G.heroes[id]; if (h.uid && !G.ents.has(h.uid)) { h.uid = 0; h.dead = true; } }
  recountSupply();
  updateFog();
  emit("loaded");
}
// late-bound to keep this file's imports short
import { BUILDINGS, LINES } from "./data.js";
const BUILDING_DEFS = () => BUILDINGS, LINE_DEFS = () => LINES;

/* ---------------- slots, in IndexedDB ---------------- */
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("no-idb")); return; }
    const r = indexedDB.open("aeons", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("saves"); r.result.createObjectStore("meta"); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode), s = t.objectStore(store);
    const req = fn(s);
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
export function metaOf() {
  return { era: G.era, phase: G.phase ? G.phase.n : 0, playtime: Math.round(G.stats.playtime), savedAt: Date.now(), diff: G.diff, seed: G.seed, complete: G.complete };
}
export function saveSlot(slot) {
  let rec;
  try { rec = serialize(); } catch (e) { return Promise.reject(e); }
  const meta = metaOf();
  return tx("saves", "readwrite", (s) => s.put(rec, slot)).then(() => tx("meta", "readwrite", (s) => s.put(meta, slot))).then(() => { emit("saved", slot); return meta; });
}
export function loadSlot(slot) {
  return tx("saves", "readonly", (s) => s.get(slot)).then((rec) => { if (!rec) throw new Error("That slot is empty."); deserialize(rec); return rec; });
}
export function listSlots() {
  return Promise.all(["auto", "1", "2", "3"].map((k) => tx("meta", "readonly", (s) => s.get(k)).then((m) => ({ slot: k, meta: m || null }), () => ({ slot: k, meta: null }))));
}
export function deleteSlot(slot) { return tx("saves", "readwrite", (s) => s.delete(slot)).then(() => tx("meta", "readwrite", (s) => s.delete(slot))); }
/** A save as a file, for keeping anywhere. */
export function exportJSON() { return JSON.stringify(serialize()); }
export function importJSON(text) { deserialize(JSON.parse(text)); }

// a browser running out of room evicts the least-used origin first; a long game should not be that
try { if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* not offered */ }

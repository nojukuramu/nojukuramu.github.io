/* spellcore.js — what a drawing means.
 *
 * A spell is a drawing, and this file is the only place that decides what a
 * drawing does. The forge's readout, the forge's little preview arena and the
 * game itself all call compileSpell() on the same design, so what the page
 * promises is exactly what the staff fires. It is pure (no DOM, no three.js)
 * so tools/validate.js can import it into Node and hold it to that.
 *
 * The grammar, in one breath:
 *
 *   GLYPH  a closed shape traced through the twelve dots of the ring.
 *          Its number of sides is its element: 3 Air, 4 Fire, 5 Earth,
 *          6 Water. More glyphs hit harder and cost more.
 *   SEAL   a circle drawn anywhere on the page. Each seal is a muzzle, and
 *          its size is its form: small Needle, medium Bolt, large Orb,
 *          huge Nova. Where it sits is where the shot leaves from.
 *   RUNE   a notch on a seal's rim. Each rune is a barrel: one shot in that
 *          direction, the top of the page being "where I am aiming".
 *   LAYER  a second page stacked on the first. When a shot of layer 1 ends —
 *          or when you pull the trigger — layer 2 bursts out of it.
 *
 * Two different elements in one layer make a reaction (Fire + Water is
 * Steam, and so on); the six pairs are the six reactions.
 *
 * The old forge scaled the whole ring with potency and stacked elements with
 * a hidden "counter" rule that silently deleted glyphs. Both were removed:
 * the ring is a fixed size so a seal's size means the same thing on every
 * page, and nothing you draw is ever discarded behind your back. */

import { TAU, clamp } from "./util.js";

export const RING_R = 160;          // design units: radius of the dotted ring
export const NODES = 12;            // dots on the ring
export const UNIT = 60;             // design units per metre of seal offset
export const SEAL_MIN_R = 16;
export const SEAL_MAX_R = 240;
export const PAGE_R = 260;          // nothing may be drawn further out than this
export const MAX_NAME = 22;

export function nodePos(i) {
  const a = -Math.PI / 2 + i * (TAU / NODES);
  return { x: Math.cos(a) * RING_R, y: Math.sin(a) * RING_R };
}

export const ELEMENTS = {
  fire:  { id: "fire",  sides: 4, name: "Fire",  adj: "Ember", color: "#ff7043", hex: 0xff7043, stamp: [0, 3, 6, 9] },
  water: { id: "water", sides: 6, name: "Water", adj: "Tidal", color: "#42a5f5", hex: 0x42a5f5, stamp: [0, 2, 4, 6, 8, 10] },
  earth: { id: "earth", sides: 5, name: "Earth", adj: "Stone", color: "#9ccc65", hex: 0x9ccc65, stamp: [0, 2, 5, 7, 10] },
  air:   { id: "air",   sides: 3, name: "Air",   adj: "Gale",  color: "#cfd8ff", hex: 0xcfd8ff, stamp: [0, 4, 8] }
};
export const ELEMENT_IDS = ["fire", "water", "earth", "air"];
export const ARCANE = { id: "arcane", name: "Arcane", adj: "Arcane", color: "#b39dff", hex: 0xb39dff };

export function elementForSides(n) {
  for (const id of ELEMENT_IDS) if (ELEMENTS[id].sides === n) return id;
  return null;
}
export function elementInfo(id) { return ELEMENTS[id] || ARCANE; }

/* Seal size → form. The thresholds sit between the ring's dots on purpose:
   a seal the size of the gap between two dots is a Needle, one reaching a
   third of the way to the ring is a Bolt, and so on, so the page itself is
   the ruler. */
export const FORMS = {
  needle: { id: "needle", name: "Needle", maxR: 45,       dmg: 0.8, speed: 30, radius: 0.16, pierce: 2,  range: 24, kb: 0.4, splash: 0,   cost: 0.8, cd: 0 },
  bolt:   { id: "bolt",   name: "Bolt",   maxR: 85,       dmg: 1.0, speed: 20, radius: 0.28, pierce: 0,  range: 19, kb: 1.2, splash: 0,   cost: 1.0, cd: 0 },
  orb:    { id: "orb",    name: "Orb",    maxR: 125,      dmg: 1.6, speed: 11, radius: 0.55, pierce: 0,  range: 14, kb: 3.5, splash: 1.6, cost: 1.5, cd: 0.15 },
  nova:   { id: "nova",   name: "Nova",   maxR: Infinity, dmg: 1.2, speed: 0,  radius: 0,    pierce: 99, range: 0,  kb: 5,   splash: 0,   cost: 1.8, cd: 0.25 }
};
export const FORM_IDS = ["needle", "bolt", "orb", "nova"];
export function formForRadius(r) {
  for (const id of FORM_IDS) if (r < FORMS[id].maxR) return id;
  return "nova";
}
/** A Nova's reach in metres grows with the seal past the Orb threshold. */
export function novaRadius(r) { return clamp(2.2 + (r - FORMS.orb.maxR) / 45, 2.2, 5); }

export const REACTIONS = {
  steam:    { id: "steam",    pair: ["fire", "water"],  name: "Steam",    color: "#e8eef5", desc: "Leaves a scalding cloud where it lands." },
  magma:    { id: "magma",    pair: ["fire", "earth"],  name: "Magma",    color: "#ff9a3c", desc: "Leaves a pool of burning rock." },
  wildfire: { id: "wildfire", pair: ["fire", "air"],    name: "Wildfire", color: "#ffc15e", desc: "Bigger blasts, and the burning spreads." },
  mire:     { id: "mire",     pair: ["water", "earth"], name: "Mire",     color: "#7fa36a", desc: "Leaves mud that bogs enemies down." },
  storm:    { id: "storm",    pair: ["water", "air"],   name: "Storm",    color: "#9fe3ff", desc: "Lightning arcs to nearby enemies." },
  shrapnel: { id: "shrapnel", pair: ["earth", "air"],   name: "Shrapnel", color: "#d8cfa8", desc: "Shatters into shards on impact." }
};
export const REACTION_IDS = Object.keys(REACTIONS);

/* Circle rank: how much one page can hold. It rises by one for every Warden
   you defeat, so the spell you could not afford to draw on floor one is the
   reward for floor four. Sandbox mode runs at the top rank. */
export const RANKS = [
  null,
  { glyphs: 2, seals: 2, runes: 3, layers: 1, power: 2, shots: 6 },
  { glyphs: 3, seals: 3, runes: 4, layers: 2, power: 3, shots: 12 },
  { glyphs: 4, seals: 4, runes: 5, layers: 2, power: 4, shots: 20 },
  { glyphs: 5, seals: 5, runes: 6, layers: 3, power: 5, shots: 30 },
  { glyphs: 6, seals: 6, runes: 8, layers: 3, power: 5, shots: 40 }
];
export const MAX_RANK = RANKS.length - 1;
export const HARD = RANKS[MAX_RANK];

/* ---------------------------------------------------------------
   Designs: a plain object that survives JSON and localStorage.
   --------------------------------------------------------------- */
export function emptyLayer() { return { power: 1, glyphs: [], seals: [] }; }
export function emptyDesign() { return { name: "", layers: [emptyLayer()] }; }
export function cloneDesign(d) { return JSON.parse(JSON.stringify(d)); }

const num = (v, lo, hi, dflt) => (typeof v === "number" && isFinite(v) ? clamp(v, lo, hi) : dflt);

/** Anything read back from storage (or pasted by a curious player editing
 *  localStorage) goes through here. Junk is dropped, never "fixed" into
 *  something the player did not draw. */
export function normalizeDesign(raw) {
  const out = emptyDesign();
  if (!raw || typeof raw !== "object") return out;
  if (typeof raw.name === "string") out.name = raw.name.replace(/[\u0000-\u001f]/g, "").slice(0, MAX_NAME);
  const layers = Array.isArray(raw.layers) ? raw.layers.slice(0, HARD.layers) : [];
  out.layers = layers.map((L) => {
    const layer = emptyLayer();
    if (!L || typeof L !== "object") return layer;
    layer.power = Math.round(num(L.power, 1, HARD.power, 1));
    (Array.isArray(L.glyphs) ? L.glyphs : []).slice(0, HARD.glyphs).forEach((g) => {
      if (!g || !Array.isArray(g.nodes)) return;
      const nodes = g.nodes.filter((n) => Number.isInteger(n) && n >= 0 && n < NODES);
      if (nodes.length !== g.nodes.length || new Set(nodes).size !== nodes.length) return;
      if (!elementForSides(nodes.length)) return;
      layer.glyphs.push({ nodes });
    });
    (Array.isArray(L.seals) ? L.seals : []).slice(0, HARD.seals).forEach((s) => {
      if (!s || typeof s !== "object") return;
      const r = num(s.r, SEAL_MIN_R, SEAL_MAX_R, NaN);
      if (isNaN(r)) return;
      const runes = (Array.isArray(s.runes) ? s.runes : [])
        .filter((a) => typeof a === "number" && isFinite(a)).slice(0, HARD.runes);
      layer.seals.push({ x: num(s.x, -PAGE_R, PAGE_R, 0), y: num(s.y, -PAGE_R, PAGE_R, 0), r, runes });
    });
    return layer;
  });
  if (!out.layers.length) out.layers = [emptyLayer()];
  return out;
}

export function isEmptyDesign(d) {
  return !d || !d.layers || d.layers.every((L) => !L.glyphs.length && !L.seals.length);
}

/* ---------------------------------------------------------------
   Balance: a drawing that mirrors left-to-right flies true.
   The forward axis is the page's vertical, so symmetry is judged across it.
   Lopsided pages still work — they just scatter and hit a little softer,
   which is a nudge, not a wall.
   --------------------------------------------------------------- */
export function balanceOf(design) {
  const feats = [];
  for (const L of design.layers) {
    for (const g of L.glyphs) for (const i of g.nodes) { const p = nodePos(i); feats.push(["p", p.x, p.y]); }
    for (const s of L.seals) {
      feats.push(["s", s.x, s.y, s.r]);
      for (const a of s.runes) feats.push(["r", s.x + Math.cos(a) * s.r, s.y + Math.sin(a) * s.r]);
    }
  }
  if (!feats.length) return 1;
  const TOL = 18;
  let hits = 0;
  for (const f of feats) {
    const mx = -f[1], my = f[2];
    if (feats.some((o) => o[0] === f[0] && Math.hypot(o[1] - mx, o[2] - my) < TOL &&
        (f[0] !== "s" || Math.abs(o[3] - f[3]) < TOL))) hits++;
  }
  return hits / feats.length;
}

/* ---------------------------------------------------------------
   Compile: design → everything the game needs to fire it.
   --------------------------------------------------------------- */
const NO_MODS = { dmg: 1, cost: 1, cd: 1, speed: 1, range: 1, kb: 1, burn: 1, chill: 0 };

function reactionsFor(els) {
  const out = [];
  for (const id of REACTION_IDS) {
    const [a, b] = REACTIONS[id].pair;
    if (els.includes(a) && els.includes(b)) out.push(id);
  }
  return out;
}

function compileLayer(L, index, parent, balance, mods) {
  const counts = {};
  const own = [];
  for (const g of L.glyphs) {
    const el = elementForSides(g.nodes.length);
    if (!el) continue;
    if (!counts[el]) { counts[el] = 0; own.push(el); }
    counts[el]++;
  }
  // A payload page with no glyphs of its own carries its parent's elements,
  // so "a fire orb that bursts into needles" does not need the fire drawn twice.
  const inherits = !own.length && !!parent && parent.elements.length > 0;
  const elements = inherits ? parent.elements.slice() : own;
  const ec = inherits ? parent.counts : counts;
  const has = (e) => elements.includes(e);
  const glyphN = inherits ? 1 : L.glyphs.length;
  const reactions = reactionsFor(elements);
  const power = clamp(Math.round(L.power || 1), 1, HARD.power);
  const pm = 1 + 0.45 * (power - 1);
  const glyphBonus = glyphN > 0 ? 1 + 0.3 * (glyphN - 1) : 1;
  const elemDmg = !elements.length ? 0.85 : (has("earth") ? 1.2 : 1) * (has("air") ? 0.9 : 1);
  const balanceMult = 0.75 + 0.25 * balance;

  const seals = L.seals.length ? L.seals : (index === 0 || L.glyphs.length ? [{ x: 0, y: 0, r: 62, runes: [], implicit: true }] : []);
  const shots = [];
  for (const s of seals) {
    const form = formForRadius(s.r);
    const F = FORMS[form];
    let ox = s.x / UNIT, oz = -s.y / UNIT;
    const om = Math.hypot(ox, oz);
    if (om > 3) { ox *= 3 / om; oz *= 3 / om; }
    // Novas ignore runes: a ring has no barrel to point.
    const dirs = form === "nova" || !s.runes.length ? [0] : s.runes.map((a) => Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2)));
    let splash = F.splash;
    if (has("fire") && form !== "nova") splash += form === "orb" ? 0.8 : form === "needle" ? 0.6 : 1.1;
    if (reactions.includes("wildfire")) splash *= 1.8;
    const shot = {
      form, sealR: s.r, implicit: !!s.implicit,
      dmg: 10 * glyphBonus * pm * F.dmg * elemDmg * balanceMult * mods.dmg,
      speed: F.speed * (has("air") ? 1.35 : 1) * (has("earth") ? 0.82 : 1) * (has("water") ? 0.95 : 1) * mods.speed,
      radius: F.radius * (1 + 0.1 * (power - 1)) * (has("earth") ? 1.2 : 1),
      range: F.range * (has("air") ? 1.2 : 1) * (1 + 0.06 * (power - 1)) * mods.range,
      pierce: F.pierce + (has("earth") ? 1 : 0),
      kb: F.kb * (has("earth") ? 1.7 : 1) * (has("air") ? 1.4 : 1) * (1 + 0.15 * (power - 1)) * mods.kb,
      splash,
      novaR: form === "nova" ? novaRadius(s.r) : 0,
      bounce: has("air") && form !== "nova" ? 1 : 0,
      burn: has("fire") ? 2.5 * (ec.fire || 1) * pm * mods.burn : 0,
      chill: has("water") ? Math.min(0.65, 0.3 + 0.1 * ((ec.water || 1) - 1) + mods.chill) : 0,
      cost: (glyphN ? 3 + 2.5 * glyphN : 2.4) * F.cost * (1 + 0.55 * (power - 1)) * (index ? 0.6 : 1),
      ox, oz,
      dirs
    };
    shots.push(shot);
  }
  return { index, power, elements, counts: ec, inherits, reactions, shots,
           shotCount: shots.reduce((n, s) => n + s.dirs.length, 0) };
}

/**
 * compileSpell(design, mods?) → {
 *   layers[], name, cost, cooldown, balance, spread, totalShots,
 *   elements, forms, reactions (union over layers, for the grimoire),
 *   dps: a rough single-target figure for the readout
 * }
 */
export function compileSpell(design, mods) {
  mods = Object.assign({}, NO_MODS, mods || {});
  const d = design && design.layers ? design : emptyDesign();
  const balance = balanceOf(d);
  const layers = [];
  let parent = null;
  for (let i = 0; i < d.layers.length; i++) {
    const L = compileLayer(d.layers[i], i, parent, balance, mods);
    if (i > 0 && !L.shots.length) break;          // an empty page ends the chain
    layers.push(L);
    parent = L;
  }
  // Every shot of a layer carries the whole next layer, so counts multiply.
  let mult = 1, totalShots = 0, cost = 0, powerSum = 0, formCd = 0;
  layers.forEach((L, i) => {
    const perShotCost = L.shots.reduce((c, s) => c + s.cost * s.dirs.length, 0);
    cost += perShotCost * mult;
    mult *= Math.max(1, L.shotCount);
    totalShots += mult;
    powerSum += L.power - 1;
    if (i === 0) for (const s of L.shots) formCd = Math.max(formCd, FORMS[s.form].cd);
  });
  const cooldown = clamp(0.2 + 0.03 * totalShots + 0.05 * powerSum + formCd, 0.2, 3) * mods.cd;
  cost = Math.max(1, Math.round(cost * mods.cost));

  const elements = new Set(), forms = new Set(), reactions = new Set();
  for (const L of layers) {
    if (!L.elements.length) elements.add("arcane");
    L.elements.forEach((e) => elements.add(e));
    L.shots.forEach((s) => forms.add(s.form));
    L.reactions.forEach((r) => reactions.add(r));
  }
  const L0 = layers[0];
  const hitDmg = L0 && L0.shots.length ? L0.shots[0].dmg : 0;
  const volley = layers.reduce((sum, L, i) => {
    const m = layers.slice(0, i).reduce((x, P) => x * Math.max(1, P.shotCount), 1);
    return sum + L.shots.reduce((c, s) => c + s.dmg * s.dirs.length, 0) * m;
  }, 0);
  const out = {
    layers, balance, spread: (1 - balance) * 0.3, cooldown, cost, totalShots,
    elements: [...elements], forms: [...forms], reactions: [...reactions],
    hitDmg, volley, dps: volley / cooldown
  };
  out.name = (d.name && d.name.trim()) || autoName(out);
  out.autoName = autoName(out);
  return out;
}

export function autoName(c) {
  const L0 = c.layers[0];
  if (!L0 || !L0.shots.length) return "Blank page";
  const adj = L0.reactions.length ? REACTIONS[L0.reactions[0]].name : elementInfo(L0.elements[0]).adj;
  let n = adj + " " + FORMS[L0.shots[0].form].name;
  if (L0.shotCount > 1) n += " ×" + L0.shotCount;
  const L1 = c.layers[1];
  if (L1 && L1.shots.length) n += " → " + FORMS[L1.shots[0].form].name;
  return n;
}

/** Which rank a design needs, and — against a given rank — what is over. */
export function rankNeeded(design, compiled) {
  const c = compiled || compileSpell(design);
  for (let r = 1; r <= MAX_RANK; r++) if (!overLimits(design, r, c).length) return r;
  return Infinity;
}

export function overLimits(design, rank, compiled) {
  const lim = RANKS[clamp(rank | 0, 1, MAX_RANK)];
  const c = compiled || compileSpell(design);
  const out = [];
  if (design.layers.length > lim.layers) out.push(design.layers.length + " layers (rank " + rank + " holds " + lim.layers + ")");
  design.layers.forEach((L, i) => {
    const tag = design.layers.length > 1 ? "Layer " + (i + 1) + ": " : "";
    if (L.glyphs.length > lim.glyphs) out.push(tag + L.glyphs.length + " glyphs (max " + lim.glyphs + ")");
    if (L.seals.length > lim.seals) out.push(tag + L.seals.length + " seals (max " + lim.seals + ")");
    if (L.power > lim.power) out.push(tag + "power " + L.power + " (max " + lim.power + ")");
    for (const s of L.seals) if (s.runes.length > lim.runes) { out.push(tag + "a seal has " + s.runes.length + " runes (max " + lim.runes + ")"); break; }
  });
  if (c.totalShots > lim.shots) out.push(c.totalShots + " shots in one cast (max " + lim.shots + ")");
  return out;
}

/* ---------------------------------------------------------------
   The pages you start with, and the examples the forge can load.
   Starters cover all four elements and all four forms between them, so
   the first minute of play is also the tutorial for the forge.
   --------------------------------------------------------------- */
const TOP = -Math.PI / 2;
const deg = (d) => (d * Math.PI) / 180;
const glyph = (el) => ({ nodes: ELEMENTS[el].stamp.slice() });

export function starterSpells() {
  return [
    { name: "", layers: [{ power: 1, glyphs: [glyph("fire")], seals: [{ x: 0, y: 0, r: 62, runes: [] }] }] },
    { name: "", layers: [{ power: 1, glyphs: [glyph("air")], seals: [{ x: 0, y: 0, r: 34, runes: [TOP - deg(20), TOP, TOP + deg(20)] }] }] },
    { name: "", layers: [{ power: 1, glyphs: [glyph("earth")], seals: [{ x: 0, y: 0, r: 100, runes: [] }] }] },
    { name: "", layers: [{ power: 1, glyphs: [glyph("water")], seals: [{ x: 0, y: 0, r: 150, runes: [] }] }] }
  ];
}

export const PRESETS = [
  { name: "Twin Embers", layers: [{ power: 1, glyphs: [glyph("fire")], seals: [{ x: -70, y: 0, r: 55, runes: [] }, { x: 70, y: 0, r: 55, runes: [] }] }] },
  { name: "Steam Lance", layers: [{ power: 1, glyphs: [glyph("fire"), glyph("water")], seals: [{ x: 0, y: 0, r: 32, runes: [] }] }] },
  { name: "Magma Ring", layers: [{ power: 1, glyphs: [glyph("fire"), glyph("earth")], seals: [{ x: 0, y: 0, r: 160, runes: [] }] }] },
  { name: "Shrapnel Shot", layers: [{ power: 1, glyphs: [glyph("earth"), glyph("air")], seals: [{ x: 0, y: 0, r: 105, runes: [] }] }] },
  { name: "Storm Fan", layers: [{ power: 1, glyphs: [glyph("water"), glyph("air")], seals: [{ x: 0, y: 0, r: 34, runes: [TOP - deg(24), TOP - deg(8), TOP + deg(8), TOP + deg(24)] }] }] },
  { name: "Mire Mine", layers: [
    { power: 1, glyphs: [glyph("water"), glyph("earth")], seals: [{ x: 0, y: 0, r: 100, runes: [] }] },
    { power: 1, glyphs: [], seals: [{ x: 0, y: 0, r: 150, runes: [] }] }] },
  { name: "Cluster Bomb", layers: [
    { power: 2, glyphs: [glyph("fire")], seals: [{ x: 0, y: 0, r: 100, runes: [] }] },
    { power: 1, glyphs: [glyph("air")], seals: [{ x: 0, y: 0, r: 34, runes: [TOP, TOP + deg(72), TOP + deg(144), TOP - deg(72), TOP - deg(144)] }] }] },
  { name: "Wildfire Wall", layers: [{ power: 2, glyphs: [glyph("fire"), glyph("air")],
    seals: [{ x: -120, y: 0, r: 60, runes: [] }, { x: -40, y: 0, r: 60, runes: [] }, { x: 40, y: 0, r: 60, runes: [] }, { x: 120, y: 0, r: 60, runes: [] }] }] }
];

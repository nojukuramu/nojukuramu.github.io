/* spellcore.js — what a drawing means, in Magic Circles.
 *
 * The page you draw on is Magic Sandbox's (magic_sandbox/js/spellcore.js):
 * the same twelve dots, the same plain JSON for a design, the same glyphs,
 * seals and runes, so the spellbook (forge.js) and the drawing routine
 * (glyphart.js) are lifted from there nearly whole. What a drawing *does* is
 * this game's own, carried over from the Phaser build's GameScene.castSpell(),
 * SpellTier.js and Config.js:
 *
 *   GLYPH     a closed shape through the dots; its sides are its element:
 *             3 Air, 4 Fire, 5 Earth, 6 Water. Every glyph is fuel: it adds
 *             damage and power, and costs mana from its element's own pool.
 *   PREDATORS glyphs are read bottom to top, layer by layer, onto a stack.
 *             Water ▶ Fire ▶ Earth ▶ Air ▶ Water: a glyph that preys on the
 *             one below it annihilates with it, and both are lost (the mana
 *             is still spent). Draw Fire then Earth and you have both; draw
 *             Earth then Fire and you have nothing. The old game did this
 *             silently; here the page shows it and the readout says it.
 *   SEALS     the circles of layer 0 are what you throw. A seal's spectrum
 *             is its power divided by its size — a small seal with a lot of
 *             power behind it is a Needle, a big one with little is a Cannon
 *             — ten kinds in all, from Flicker to Nova.
 *   RUNES     notches on a seal's rim. Each is one shot in that direction,
 *             the top of the page being where you aim. (The Phaser build
 *             averaged them into one turn; Magic Sandbox's reading, one rune
 *             one barrel, is kept so the two pages mean the same thing.)
 *   LAYERS    layer 1 bursts out of every shot of layer 0 when you pull the
 *             trigger (right click), or when the shot runs out; layer 2 out of
 *             layer 1, and so on. Each burst inherits the power above it, so
 *             its spectrum is worked out again for its own seals: a slow
 *             Cannon that bursts into a swarm of Needles.
 *   POWER     layer 0 carries a power from ×1 to ×10. It pushes every seal
 *             toward the piercing end of the spectrum, reaches further, and
 *             costs 20% more mana per step.
 *   TIER      the whole page is scored, E to SSS (SpellTier.js, unchanged),
 *             and the tier sets the cooldown and a mana tax on top.
 *   BALANCE   a page that mirrors left to right flies true; a lopsided one
 *             scatters and loses up to half its power and damage. (The old
 *             random element swap at low balance is gone: a spell that
 *             sometimes turns into another element cannot be learned.)
 *
 * Pure: no DOM, no three.js. tools/validate.js imports it into Node. */

import { TAU, clamp } from "./util.js";

export const RING_R = 160;
export const NODES = 12;
export const UNIT = 60;             // design units per metre of seal offset
export const SEAL_MIN_R = 16;
export const SEAL_MAX_R = 240;
export const PAGE_R = 260;
export const MAX_NAME = 22;
export const SLOTS = 8;

export function nodePos(i) {
  const a = -Math.PI / 2 + i * (TAU / NODES);
  return { x: Math.cos(a) * RING_R, y: Math.sin(a) * RING_R };
}

/* Colours are the Phaser build's getElementColor(); costs and regen are its
   Config.ManaCost / ManaRegen, rescaled so a fight is not mostly waiting. */
export const ELEMENTS = {
  air:   { id: "air",   sides: 3, name: "Air",   adj: "Gale",  color: "#a0e0e0", hex: 0xa0e0e0, cost: 8,  regen: 10, stamp: [0, 4, 8] },
  fire:  { id: "fire",  sides: 4, name: "Fire",  adj: "Ember", color: "#ff6633", hex: 0xff6633, cost: 10, regen: 7,  stamp: [0, 3, 6, 9] },
  earth: { id: "earth", sides: 5, name: "Earth", adj: "Stone", color: "#80c060", hex: 0x80c060, cost: 12, regen: 5,  stamp: [0, 2, 5, 7, 10] },
  water: { id: "water", sides: 6, name: "Water", adj: "Tidal", color: "#4488ff", hex: 0x4488ff, cost: 10, regen: 8,  stamp: [0, 2, 4, 6, 8, 10] }
};
export const ELEMENT_IDS = ["air", "fire", "earth", "water"];
export const ARCANE = { id: "arcane", name: "Arcane", adj: "Arcane", color: "#b8a6ff", hex: 0xb8a6ff };
export function elementForSides(n) {
  for (const id of ELEMENT_IDS) if (ELEMENTS[id].sides === n) return id;
  return null;
}
export function elementInfo(id) { return ELEMENTS[id] || ARCANE; }

/** Predator ▶ prey. */
export const PREYS_ON = { water: "fire", fire: "earth", earth: "air", air: "water" };

/* ---------------------------------------------------------------
   The spectrum. Power over radius, with the Phaser build's ten names.
   Speeds and sizes are metres; dmg and kb multiply the cast's own.
   --------------------------------------------------------------- */
export const SPECTRA = {
  NEEDLE:  { id: "NEEDLE",  name: "Needle",  sharp: true,  speed: 30, size: 0.14, pierce: 4, dmg: 0.55, kb: 0,   range: 26, desc: "Fast and thin; passes through four." },
  LANCE:   { id: "LANCE",   name: "Lance",   sharp: true,  speed: 26, size: 0.18, pierce: 3, dmg: 0.75, kb: 0.1, range: 24, desc: "Passes through three." },
  BEAM:    { id: "BEAM",    name: "Beam",    sharp: true,  speed: 36, size: 0.17, pierce: 2, dmg: 0.85, kb: 0.2, range: 32, desc: "The longest reach; passes through two." },
  DART:    { id: "DART",    name: "Dart",    sharp: false, speed: 21, size: 0.26, pierce: 0, dmg: 1.0,  kb: 0.3, range: 20, desc: "A plain, honest throw." },
  WAVE:    { id: "WAVE",    name: "Wave",    sharp: false, speed: 15, size: 0.9,  pierce: 99, dmg: 0.8, kb: 0.5, range: 13, desc: "A wide crescent that sweeps through everything once." },
  BURST:   { id: "BURST",   name: "Burst",   sharp: false, speed: 14, size: 0.36, pierce: 0, dmg: 1.2,  kb: 0.6, range: 16, blast: 2.6, desc: "Bursts where it lands." },
  BOULDER: { id: "BOULDER", name: "Boulder", sharp: false, speed: 9,  size: 0.75, pierce: 99, dmg: 0.8, kb: 1.0, range: 17, push: true, desc: "Slow and heavy; bulldozes whatever it meets." },
  CANNON:  { id: "CANNON",  name: "Cannon",  sharp: false, speed: 11, size: 0.62, pierce: 0, dmg: 1.5,  kb: 1.5, range: 18, blast: 3.6, desc: "A heavy shell with a big blast." },
  NOVA:    { id: "NOVA",    name: "Nova",    sharp: false, speed: 0,  size: 0,    pierce: 99, dmg: 2.0, kb: 2.0, range: 0,  blast: 5,   desc: "Erupts all around where its seal sits." },
  FLICKER: { id: "FLICKER", name: "Flicker", sharp: false, speed: 24, size: 0.12, pierce: 0, dmg: 0.3,  kb: 0,   range: 12, desc: "A weak spark: too little power for its circle." }
};
export const SPECTRUM_IDS = Object.keys(SPECTRA);
const BASE_POWER = 50;
const POWER_PER_ELEMENT = 25;
const DMG_PER_ELEMENT = 25;

export function spectrumFor(power, r) {
  if (r >= 190 && power >= 300) return "NOVA";
  if (power <= 60 && r < 40) return "FLICKER";
  const d = power / Math.max(1, r);
  if (d > 6) return "NEEDLE";
  if (d > 4) return "LANCE";
  if (d > 2.6) return "BEAM";
  if (d > 1.6) return "DART";
  if (d > 1.1) return "WAVE";
  if (d > 0.75) return "BURST";
  if (d > 0.45) return "BOULDER";
  return "CANNON";
}

/* ---------------------------------------------------------------
   Tiers — SpellTier.js, carried over as it was.
   --------------------------------------------------------------- */
const SPECTRUM_CEILING = { FLICKER: 0.3, DART: 1.0, WAVE: 1.2, BURST: 1.6, BOULDER: 1.4, BEAM: 1.8, LANCE: 2.2, NEEDLE: 2.0, CANNON: 2.0, NOVA: 3.0 };
const TIER_CUTOFFS = [["SSS", 2000], ["SS", 1300], ["S", 850], ["A", 550], ["B", 300], ["C", 150], ["D", 60], ["E", 0]];
export const TIER_COLORS = { SSS: "#ff4444", SS: "#ff8844", S: "#ffdd44", A: "#88ff44", B: "#44ffdd", C: "#44aaff", D: "#8888ff", E: "#9a9a9a" };
export function threatScore(o) {
  const ceiling = SPECTRUM_CEILING[o.spectrum] || 1;
  const diversity = 1 + 0.2 * Math.max(0, (o.uniqueElements || 0) - 1);
  const payload = 1 + 0.5 * (o.payloadLayers || 0);
  const multishot = 1 + 0.35 * Math.max(0, (o.shots || 1) - 1);
  const harmony = 0.5 + 0.5 * clamp(isFinite(o.stability) ? o.stability : 1, 0, 1);
  return (isFinite(o.power) ? o.power : 0) * ceiling * diversity * payload * multishot * harmony;
}
export function tierFor(score) {
  for (let i = 0; i < TIER_CUTOFFS.length; i++) if (score >= TIER_CUTOFFS[i][1]) return { tier: TIER_CUTOFFS[i][0], index: TIER_CUTOFFS.length - 1 - i };
  return { tier: "E", index: 0 };
}
/* SpellTier.js charged 1.4× mana and 0.6 s more per tier; at the faster pace of
   this build that made anything above C a spell you cast twice a fight. */
export const tierBalance = (index) => ({ manaMult: Math.pow(1.25, index), cooldown: 0.45 + 0.4 * index });
export const MIN_COOLDOWN = 0.5;

/* ---------------------------------------------------------------
   Circle rank: how much a page may hold. A Sigil, taken from a Warden,
   raises it by one.
   --------------------------------------------------------------- */
export const RANKS = [
  null,
  { glyphs: 3, seals: 2, runes: 3, layers: 1, power: 3,  shots: 6 },
  { glyphs: 4, seals: 3, runes: 4, layers: 2, power: 4,  shots: 12 },
  { glyphs: 5, seals: 4, runes: 5, layers: 2, power: 5,  shots: 20 },
  { glyphs: 6, seals: 5, runes: 6, layers: 3, power: 7,  shots: 30 },
  { glyphs: 7, seals: 6, runes: 8, layers: 3, power: 9,  shots: 40 },
  { glyphs: 8, seals: 8, runes: 10, layers: 4, power: 10, shots: 60 }
];
export const MAX_RANK = RANKS.length - 1;
export const HARD = RANKS[MAX_RANK];

/* ---------------------------------------------------------------
   Designs
   --------------------------------------------------------------- */
export function emptyLayer() { return { power: 1, glyphs: [], seals: [] }; }
export function emptyDesign() { return { name: "", layers: [emptyLayer()] }; }
export function cloneDesign(d) { return JSON.parse(JSON.stringify(d)); }
const num = (v, lo, hi, dflt) => (typeof v === "number" && isFinite(v) ? clamp(v, lo, hi) : dflt);

/** Anything read back from storage goes through here; junk is dropped, never "fixed". */
export function normalizeDesign(raw) {
  const out = emptyDesign();
  if (!raw || typeof raw !== "object") return out;
  if (typeof raw.name === "string") out.name = raw.name.replace(/[\u0000-\u001f<>]/g, "").slice(0, MAX_NAME);
  const layers = Array.isArray(raw.layers) ? raw.layers.slice(0, HARD.layers) : [];
  out.layers = layers.map((L, li) => {
    const layer = emptyLayer();
    if (!L || typeof L !== "object") return layer;
    layer.power = li === 0 ? Math.round(num(L.power, 1, HARD.power, 1)) : 1;
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
      const runes = (Array.isArray(s.runes) ? s.runes : []).filter((a) => typeof a === "number" && isFinite(a)).slice(0, HARD.runes);
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
   Balance: Magic Sandbox's mirror test, which is the Phaser build's
   symmetry check done once instead of per frame.
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
    if (feats.some((o) => o[0] === f[0] && Math.hypot(o[1] - mx, o[2] - my) < TOL && (f[0] !== "s" || Math.abs(o[3] - f[3]) < TOL))) hits++;
  }
  return hits / feats.length;
}

/* ---------------------------------------------------------------
   The stack: glyphs bottom to top, predators eating their prey.
   `drop` is a set of elements you cannot afford right now — their glyphs
   are left out before the stack is read, as the old game did.
   --------------------------------------------------------------- */
export function readStack(design, drop) {
  const stack = [], quenched = [], dropped = [];
  design.layers.forEach((L, li) => L.glyphs.forEach((g, gi) => {
    const el = elementForSides(g.nodes.length);
    if (!el) return;
    const ref = { layer: li, glyph: gi, el };
    if (drop && drop.has(el)) { dropped.push(ref); return; }
    const top = stack[stack.length - 1];
    if (top && PREYS_ON[el] === top.el) { stack.pop(); quenched.push(top, ref); }
    else stack.push(ref);
  }));
  return { stack, quenched, dropped };
}

/** Mana per element for the glyphs on a page, before the tier's tax. */
export function glyphCost(design) {
  const mult = 1 + ((design.layers[0] && design.layers[0].power || 1) - 1) * 0.2;
  const cost = { air: 0, fire: 0, earth: 0, water: 0 };
  for (const L of design.layers) for (const g of L.glyphs) {
    const el = elementForSides(g.nodes.length);
    if (el) cost[el] += Math.ceil(ELEMENTS[el].cost * mult);
  }
  return cost;
}

/* ---------------------------------------------------------------
   compileSpell(design, opts?) → everything the game needs to fire it.
   opts.drop: Set of unaffordable elements (see readStack).
   --------------------------------------------------------------- */
function shotFor(spectrum, sealR, power, dmg, elements, balanceMult) {
  const S = SPECTRA[spectrum];
  const has = (e) => elements.includes(e);
  const elSpeed = elements.length ? elements.reduce((s, e) => s + ({ air: 1.15, fire: 1.05, water: 1, earth: 0.9 })[e], 0) / elements.length : 1;
  const reach = clamp(0.8 + power / 500, 0.8, 1.7);
  return {
    spectrum, sharp: S.sharp, sealR, power,
    dmg: dmg * S.dmg * balanceMult,
    speed: S.speed * elSpeed * (S.sharp ? 1 : clamp(1.15 - power / 1500, 0.7, 1.1)),
    size: S.size * (S.sharp ? 1 : clamp(0.75 + sealR / 220, 0.8, 1.8)),
    range: S.range * reach * (has("air") ? 1.15 : 1),
    pierce: S.pierce + (has("earth") && S.pierce < 50 ? 1 : 0),
    kb: S.kb * (has("air") ? 1.8 : 1) * (has("earth") ? 1.3 : 1),
    blast: S.blast ? S.blast * clamp(0.85 + sealR / 400 + power / 2500, 0.85, 1.6) : 0,
    push: !!S.push || (has("earth") && !S.sharp),
    burn: has("fire") ? 5 * elements.filter((e) => e === "fire").length : 0,
    slow: has("water") ? 0.3 : 0,
    propel: has("air") ? 1 : 0
  };
}

function sealShots(L, power, dmg, elements, balanceMult) {
  const seals = L.seals.length ? L.seals : [{ x: 0, y: 0, r: 30, runes: [], virtual: true }];
  const shots = [];
  for (const s of seals) {
    const spectrum = spectrumFor(power, s.r);
    const sh = shotFor(spectrum, s.r, power, dmg, elements, balanceMult);
    let ox = s.x / UNIT, oz = -s.y / UNIT;
    const om = Math.hypot(ox, oz);
    if (om > 3) { ox *= 3 / om; oz *= 3 / om; }
    sh.ox = ox; sh.oz = oz;
    sh.virtual = !!s.virtual;
    // a rune is a barrel; a Nova has none to point
    sh.dirs = spectrum === "NOVA" || !s.runes.length ? [0] : s.runes.map((a) => Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2)));
    shots.push(sh);
  }
  return shots;
}

export function compileSpell(design, opts) {
  opts = opts || {};
  const d = design && design.layers ? design : emptyDesign();
  const balance = balanceOf(d);
  const instab = clamp(1 - balance, 0, 1);
  const { stack, quenched, dropped } = readStack(d, opts.drop);
  const elements = stack.map((r) => r.el);
  const unique = [...new Set(elements)];
  const powerMult = clamp(Math.round(d.layers[0].power || 1), 1, HARD.power);
  let power = (BASE_POWER + POWER_PER_ELEMENT * elements.length) * powerMult;
  let dmg = (elements.length ? elements.length * DMG_PER_ELEMENT : 10) * (1 + 0.15 * (powerMult - 1));
  power *= 1 - instab * 0.5;
  dmg *= 1 - instab * 0.5;
  const balanceMult = 1;

  const glyphs = d.layers.reduce((n, L) => n + L.glyphs.length, 0);
  const anySeals = d.layers.some((L) => L.seals.length);
  // Nothing to throw, or glyphs drawn but none affordable: the plain grey bolt.
  const fallback = (!glyphs && !anySeals) || (glyphs > 0 && !elements.length && dropped.length > 0 && !quenched.length);

  // layer 0 is the container; every later layer with seals is the next stage of the payload
  const layers = [];
  const chain = d.layers.filter((L, i) => i === 0 || L.seals.length);
  let parentShots = 1, totalShots = 0;
  chain.forEach((L, i) => {
    const shotsHere = sealShots(L, power, dmg, elements, balanceMult);
    const count = shotsHere.reduce((n, s) => n + s.dirs.length, 0);
    // A carrier does little itself; what it carries does the damage. The old
    // game split it evenly between the shards, which made a burst of five
    // weaker than the one shot it came out of; the square root keeps a burst
    // worth drawing without making it free.
    const carries = i < chain.length - 1;
    for (const s of shotsHere) {
      if (i > 0) s.dmg /= Math.sqrt(Math.max(1, count));
      if (carries) s.dmg *= 0.5;
      if (fallback) { s.spectrum = "FLICKER"; s.dmg = 8; s.speed = 16; s.size = 0.16; s.range = 11; }
    }
    layers.push({ index: i, shots: shotsHere, shotCount: count });
    parentShots *= Math.max(1, count);
    totalShots += parentShots;
  });

  const first = layers[0].shots[0];
  const threat = threatScore({
    power, spectrum: first.spectrum, uniqueElements: unique.length,
    payloadLayers: layers.length - 1, shots: layers[0].shotCount, stability: balance
  });
  const { tier, index } = tierFor(threat);
  const bal = tierBalance(index);
  const base = glyphCost(d);
  const cost = {};
  let costTotal = 0;
  for (const el of ELEMENT_IDS) {
    cost[el] = opts.drop && opts.drop.has(el) ? 0 : Math.ceil(base[el] * bal.manaMult);
    costTotal += cost[el];
  }
  const cooldown = Math.max(MIN_COOLDOWN, bal.cooldown);

  const volley = layers.reduce((sum, L, i) => {
    const m = layers.slice(0, i).reduce((x, P) => x * Math.max(1, P.shotCount), 1);
    return sum + L.shots.reduce((c, s) => c + s.dmg * s.dirs.length, 0) * m;
  }, 0);

  const out = {
    elements, unique, quenched, dropped, power, powerMult, balance, spread: instab * 0.52,
    layers, totalShots, tier, tierIndex: index, threat, cost, costTotal, cooldown,
    fallback, volley, dps: volley / cooldown
  };
  out.autoName = autoName(out);
  out.name = (d.name && d.name.trim()) || out.autoName;
  return out;
}

export function autoName(c) {
  if (c.fallback) return "Base magic";
  const L0 = c.layers[0];
  const adj = c.unique.length > 1 ? "Mixed" : elementInfo(c.unique[0]).adj;
  let n = adj + " " + SPECTRA[L0.shots[0].spectrum].name;
  if (L0.shotCount > 1) n += " ×" + L0.shotCount;
  const L1 = c.layers[1];
  if (L1) n += " → " + SPECTRA[L1.shots[0].spectrum].name;
  return n;
}

/** Which rank a design needs, and — against a given rank — what is over. */
export function overLimits(design, rank, compiled) {
  const lim = RANKS[clamp(rank | 0, 1, MAX_RANK)];
  const c = compiled || compileSpell(design);
  const out = [];
  if (design.layers.length > lim.layers) out.push(design.layers.length + " layers (rank " + rank + " holds " + lim.layers + ")");
  if ((design.layers[0].power || 1) > lim.power) out.push("power ×" + design.layers[0].power + " (max ×" + lim.power + ")");
  design.layers.forEach((L, i) => {
    const tag = design.layers.length > 1 ? "Layer " + (i + 1) + ": " : "";
    if (L.glyphs.length > lim.glyphs) out.push(tag + L.glyphs.length + " glyphs (max " + lim.glyphs + ")");
    if (L.seals.length > lim.seals) out.push(tag + L.seals.length + " seals (max " + lim.seals + ")");
    for (const s of L.seals) if (s.runes.length > lim.runes) { out.push(tag + "a seal has " + s.runes.length + " runes (max " + lim.runes + ")"); break; }
  });
  if (c.totalShots > lim.shots) out.push(c.totalShots + " shots in one cast (max " + lim.shots + ")");
  return out;
}
export function rankNeeded(design, compiled) {
  const c = compiled || compileSpell(design);
  for (let r = 1; r <= MAX_RANK; r++) if (!overLimits(design, r, c).length) return r;
  return Infinity;
}

/* ---------------------------------------------------------------
   Starting scrolls and the examples the spellbook can load. The four
   starters are one per element and four different spectra, so the first
   minute of play is also the first lesson in the spectrum.
   --------------------------------------------------------------- */
const TOP = -Math.PI / 2;
const deg = (x) => (x * Math.PI) / 180;
const glyph = (el) => ({ nodes: ELEMENTS[el].stamp.slice() });

export function starterSpells() {
  const out = [
    { name: "", layers: [{ power: 1, glyphs: [glyph("fire")], seals: [{ x: 0, y: 0, r: 40, runes: [] }] }] },
    { name: "", layers: [{ power: 3, glyphs: [glyph("air")], seals: [{ x: 0, y: 0, r: 30, runes: [TOP - deg(18), TOP, TOP + deg(18)] }] }] },
    { name: "", layers: [{ power: 1, glyphs: [glyph("earth")], seals: [{ x: 0, y: 0, r: 110, runes: [] }] }] },
    { name: "", layers: [{ power: 1, glyphs: [glyph("water")], seals: [{ x: 0, y: 0, r: 56, runes: [] }] }] }
  ];
  while (out.length < SLOTS) out.push(emptyDesign());
  return out;
}

export const PRESETS = [
  { name: "Ember Fan", layers: [{ power: 2, glyphs: [glyph("fire")], seals: [{ x: 0, y: 0, r: 26, runes: [TOP - deg(20), TOP, TOP + deg(20)] }] }] },
  { name: "Twin Lances", layers: [{ power: 2, glyphs: [glyph("air")], seals: [{ x: -60, y: 0, r: 30, runes: [] }, { x: 60, y: 0, r: 30, runes: [] }] }] },
  { name: "Tide Cannon", layers: [{ power: 1, glyphs: [glyph("water"), glyph("earth")], seals: [{ x: 0, y: 0, r: 200, runes: [] }] }] },
  { name: "Scorched Earth", layers: [{ power: 2, glyphs: [glyph("fire"), glyph("earth")], seals: [{ x: 0, y: 0, r: 150, runes: [] }] }] },
  { name: "Cannon to Needles", layers: [
    { power: 1, glyphs: [glyph("fire"), { nodes: [1, 5, 7, 11] }], seals: [{ x: 0, y: 0, r: 230, runes: [] }] },
    { power: 1, glyphs: [], seals: [{ x: 0, y: 0, r: 16, runes: [TOP, TOP + deg(72), TOP + deg(144), TOP - deg(72), TOP - deg(144)] }] }] },
  { name: "Ring of Fire", layers: [{ power: 4, glyphs: [glyph("fire")], seals: [{ x: 0, y: 0, r: 200, runes: [] }] }] },
  { name: "Gale Wall", layers: [{ power: 1, glyphs: [glyph("air"), glyph("air")],
    seals: [{ x: -110, y: 0, r: 50, runes: [] }, { x: 0, y: 0, r: 50, runes: [] }, { x: 110, y: 0, r: 50, runes: [] }] }] },
  { name: "Quench (a lesson)", layers: [{ power: 1, glyphs: [glyph("fire"), glyph("water")], seals: [{ x: 0, y: 0, r: 40, runes: [] }] }] }
];

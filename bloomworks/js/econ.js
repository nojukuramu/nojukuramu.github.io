/* econ.js — every multiplier, every cost, every formula from "Economy and
 * formulas".
 *
 *   Glow  = Value × HearthSale × ComboMultiplier × GlobalMultiplier
 *   Value = SourceValue × Richness × ∏Stamps × ∏(FusionBonus × HueBonus)
 *           × 10^Lucky × 2^Charged × ChainBonus
 *   GlobalMultiplier = Workshop × (1 + 0.05 Seeds) × (1 + 0.25 Stars)
 *           × Constellations × 2^HeartStages × 3^Planets × (1 + 0.01 Feats) × Relics
 *
 * Bloom, terrain, Mods and boosters act on the Power of single copies, so
 * they sit inside Value. All of it is computed here and nowhere else; the
 * simulation asks, it never multiplies on its own. Results are L-numbers
 * (log10) wherever they can grow without bound. */

import { S, RT, pk } from "./state.js";
import { ZERO, L, lAdd, lGte, N } from "./num.js";
import {
  TYPES, levelGrowth, BUILD_GROWTH, WORKSHOP, WORKSHOP_GROWTH, SEASON_KINDS, DAY_S, NIGHT_S, HUE_BONUS, primaries,
  rarityStrength, CONSTELLATIONS, CONSTELLATION_EXTRA, HARVEST_AT, ECLIPSE_AT, BIOMES, CRITTERS, WONDERS, WILD_EFFECTS
} from "./data.js";
import { hasLaw, getPlot, plotCostL, ringOf } from "./world.js";

/* ---------- small lookups ---------- */
export const lvlKey = (type) => (type === "splitter" ? "track" : type);
export const level = (type) => S.season.levels[lvlKey(type)] || 1;
export const milestones = (type) => Math.floor(level(type) / 25);
export const ws = (k) => S.season.workshop[k] || 0;
export const tree = (k) => S.eclipse.tree[k] || 0;
export const cosmos = (k) => S.meta.cosmos[k] || 0;
export const relic = (k) => S.meta.relics[k] || 0;
export const trialRank = (k) => S.world.trials[k] || 0;
export const lawTraits = (law) => S.meta.planets.filter((p) => p.law === law).length;
export const seasonKind = () => SEASON_KINDS[(S.seasonNo - 1) % 4];
export const inTrial = (k) => S.season.trial === k;
export function spec(type) {
  const s = S.meta.specs && S.meta.specs[type];
  return level(type) >= 100 && s != null ? s : -1;
}
export function count(type) { let n = 0; for (const c of S.season.copies) if (c.type === type) n++; return n; }
export function countFam(fam) { let n = 0; for (const c of S.season.copies) if (TYPES[c.type].fam === fam) n++; return n; }

/* ---------- unlocks ---------- */
export function unlocked(type) {
  const T = TYPES[type];
  if (!T) return false;
  if (T.fam === "wonder") return !!S.meta.discovered.wonders[type];
  if (T.fam === "heart") return S.world.eclipses > 0;
  if (T.unlock.cosmos) return cosmos(T.unlock.cosmos) > 0;
  return !!S.meta.discovered.types[type];
}
/** Check every unlock rule against what has happened; true if anything new opened. */
export function refreshUnlocks() {
  let changed = [];
  const d = S.meta.discovered.types;
  for (const k in TYPES) {
    if (d[k]) continue;
    const u = TYPES[k].unlock;
    let ok = false;
    if (u.start) ok = true;
    else if (u.glow != null) ok = lGte(S.season.glowSeason, L(u.glow)) || lGte(S.meta.bestGlowSeason, L(u.glow));
    else if (u.season != null) ok = S.seasonNo >= u.season;
    else if (u.plot) {
      for (const key in S.season.plots) {
        const [a, b] = key.split(",").map(Number);
        const p = getPlot(a, b);
        if (u.plot === "river" ? p.hasRiver : p.biome === u.plot) { ok = true; break; }
      }
    }
    if (ok) { d[k] = 1; changed.push(k); }
  }
  return changed;
}
export function workshopOpen(k) {
  const a = WORKSHOP[k].at;
  if (a.glow) return lGte(S.season.glowSeason, L(a.glow)) || lGte(S.meta.bestGlowSeason, L(a.glow));
  if (a.plot) return Object.keys(S.season.plots).length > 1;
  if (a.fuser) return !!S.meta.discovered.types.fuser;
  return true;
}

/* ---------- costs ---------- */
export function buildCostL(type) {
  const T = TYPES[type];
  if (T.fam === "wonder" || T.fam === "heart") return ZERO;
  if (type === "track") return L(T.build);
  const n = count(type);
  if ((type === "wellspring" || type === "hearth") && n === 0) return ZERO;
  return L(T.build) + n * Math.log10(BUILD_GROWTH);
}
/** Cost of the next k Levels from the current one, as an L-number. */
export function levelCostL(type, k) {
  const key = lvlKey(type), T = TYPES[key];
  if (!T.level) return ZERO;
  const g = levelGrowth(key), Lv = level(key);
  k = k || 1;
  // base × g^(L-1) × (g^k - 1)/(g - 1)
  return Math.log10(T.level) + (Lv - 1) * Math.log10(g) + Math.log10((Math.pow(g, k) - 1) / (g - 1));
}
/** How many Levels the given Glow buys, at most `limit`. */
export function affordLevels(type, glowL, limit) {
  const key = lvlKey(type), T = TYPES[key];
  if (!T.level) return 0;
  const g = levelGrowth(key), Lv = level(key);
  const first = Math.log10(T.level) + (Lv - 1) * Math.log10(g);
  if (!lGte(glowL, first)) return 0;
  // glow >= first × (g^k - 1)/(g - 1)  ->  k <= log_g(1 + glow/first × (g - 1))
  const ratioL = glowL - first + Math.log10(g - 1);
  const k = Math.floor(lAdd(0, ratioL) / Math.log10(g) + 1e-9);
  return Math.max(0, Math.min(limit == null ? Infinity : limit, k));
}
export function workshopCostL(k) { return Math.log10(WORKSHOP[k].base) + ws(k) * Math.log10(WORKSHOP_GROWTH); }

export function plotDiscountL() {
  return ws("survey") * Math.log10(0.95) + relic("compass") * Math.log10(0.95) + tree("plotcost") * Math.log10(0.9);
}
export const claimCostL = (px, py) => plotCostL(px, py, plotDiscountL());
export const rockCostL = (px, py) => claimCostL(px, py) + Math.log10(0.05);
export const digCostL = (px, py) => claimCostL(px, py) + 1;

/* ---------- day, night and weather ---------- */
export function dayLengths() {
  const k = seasonKind().id;
  let d = DAY_S, n = NIGHT_S;
  if (k === "summer") { d = 600; n = 120; }
  if (k === "winter") { d = 240; n = 480; }
  return [d, n];
}
export function alwaysNight() { return hasLaw("eternalnight") || inTrial("darkness") || RT.eclipseShow > 0; }
/** Day in this plot? A Sundial makes its plot's days last twice as long. */
export function isDay(plotKey) {
  if (alwaysNight()) return false;
  let [d, n] = dayLengths();
  if (plotKey && RT.sundials && RT.sundials.has(plotKey)) d *= 2;
  return S.t % (d + n) < d;
}
/** 0 midnight .. 0.5 noon .. 1, for the sky. */
export function dayPhase() {
  if (alwaysNight()) return 0;
  const [d, n] = dayLengths(), t = S.t % (d + n);
  return t < d ? 0.25 + 0.5 * (t / d) : (0.75 + 0.5 * ((t - d) / n)) % 1;
}
export function weatherOf(biome) { const w = S.weather[biome]; return w ? w.cur : "clear"; }
export function anyWeather(kind) { for (const b in S.weather) if (S.weather[b].cur === kind) return true; return false; }

/* ---------- Lucky ---------- */
export function lensLucky() {
  const l = ws("lens");
  return l <= 250 ? l * 0.001 : 0.25 + (l - 250) * 0.0005;
}
export function modSum(c, kind) {
  let s = 0;
  if (!c || !c.mods) return 0;
  for (const id of c.mods) { const m = modById(id); if (m && m.k === kind) s += rarityStrength(m.r); }
  return s;
}
export function modById(id) { return S.meta.mods.find((m) => m.id === id) || null; }
export function wildBonus(kind) {
  let m = 1;
  for (const w of wildList()) if (w.fx === kind) m *= w.mult;
  return m;
}
export function luckyChance(c) {
  const k = c && c.k;
  let ch = 0.01 + lensLucky() + relic("clover") * 0.005 + tree("luck") * 0.002 + lawTraits("drought") * 0.01;
  ch += (wildBonus("lucky") - 1) * 0.02;
  if (c) {
    ch += modSum(c, "lucky") * 0.005;
    if (k && k.crystal) ch += 0.02;
    if (k && k.biome === "crystal") ch += 0.02;
    if (c.fly && c.fly > S.t) ch += 0.05;
    if (c.type === "polisher" && spec("polisher") === 0) ch += 0.05;
    const v = voidFx(c); if (v && v.lucky) ch += v.lucky;
  }
  let mul = 1;
  const b = k ? k.biome : "meadow";
  if (weatherOf(b) === "fog") mul *= 1.5;
  if (weatherOf(b) === "aurora") mul *= 3;
  if (rushOn()) mul *= 2 * rushStrength();
  if (S.windfalls.luckyrain > S.t) mul *= 10;
  if (k && k.rules && k.rules.includes("luckyAir")) mul *= 2;
  if (hasLaw("drought")) mul /= 4;
  return ch * mul;
}
export const luckyStepL = () => (hasLaw("drought") ? 2 : 1);

/* ---------- Rush ---------- */
export const rushOn = () => S.rush.until > S.t;
export const rushStrength = () => 1 + 0.1 * tree("rush");
export const rushLength = () => 20 + 5 * tree("rush");

/* ---------- void tiles ---------- */
export function voidFx(c) {
  if (!c || !c.k || !c.k.voidKey) return null;
  const v = S.voids[c.k.voidKey];
  return v && v.until > S.t ? v.fx : null;
}

/* ---------- Tempo ---------- */
export function tempoCapMul() { return 1 + 0.05 * ws("tuning") + 0.1 * cosmos("cosmictempo"); }
export function baseTempo(type) {
  const T = TYPES[type];
  if (!T.tempo) return 0;
  const [b, cap] = T.tempo;
  if (T.fam === "wonder" || T.fam === "heart") return b;
  return Math.min(b * (1 + 0.1 * (level(type) - 1)), cap * tempoCapMul());
}
/** Levels past the Tempo Cap. On a Source, each one is +5% of base Value. */
export function overclock(type) {
  const T = TYPES[type];
  if (!T.tempo || T.fam !== "source") return 0;
  const [b, cap] = T.tempo;
  const atCap = 1 + Math.ceil(((cap * tempoCapMul()) / b - 1) / 0.1 - 1e-9);
  return Math.max(0, level(type) - atCap);
}
export function tempo(c) {
  const T = TYPES[c.type], k = c.k || {};
  let t = baseTempo(c.type);
  if (!t) return 0;
  t *= 1 + 0.05 * modSum(c, "swift");
  t *= 1 + (k.lantern || 0) * (isDay(k.plot) ? 1 : 2);
  if (k.clock) t *= 1.5;
  if (rushOn()) t *= 2 * rushStrength();
  if (c.tapUntil && c.tapUntil > S.t) t *= 2;
  if (weatherOf(k.biome) === "fog") t *= 0.9;
  if (c.type === "moonwell" && c.owl && c.owl > S.t && !isDay(k.plot)) t *= 1.2;
  if (c.type === "kiln" && spec("kiln") === 1) t *= 2;
  if ((c.type === "hearth") && spec("hearth") === 0) t *= 0.5;
  if (c.type === "polisher" && spec("polisher") === 1) t *= 0.5;
  if ((c.type === "launcher" || c.type === "cometlauncher") && constellationOn("loom")) t *= 2 * constellationMul("loom");
  if (k.rules) { if (T.fam === "source" && k.rules.includes("eagerSources")) t *= 2; if (k.rules.includes("heavyAir")) t *= 0.75; }
  t *= wildBonus("tempo");
  const v = voidFx(c); if (v && v.tempo != null) t *= v.tempo;
  if (c.off) t = 0;
  return t;
}

/* ---------- Track ---------- */
export function trackSpeed(x, y, plotKey, biome, rules, onIce) {
  let s = Math.min(2 * (1 + 0.1 * (level("track") - 1)), 12 * tempoCapMul());
  s *= 1 + 0.1 * ws("grease");
  if (onIce) s *= 2;
  if (weatherOf(biome) === "snow") s *= 0.75;
  if (hasLaw("heavymotes")) s *= 0.5;
  if (constellationOn("loom")) s *= 2 * constellationMul("loom");
  s *= Math.pow(1.5, trialRank("rails") + lawTraits("heavymotes"));
  if (rules) { if (rules.includes("fastTracks")) s *= 2; if (rules.includes("slowTracks")) s *= 0.5; }
  if (rushOn()) s *= 1.5;
  return s;
}
export const trackCap = () => 4 + milestones("track");

/* ---------- Power ---------- */
export function bloomOfPlot(key) { const p = S.season.plots[key]; return p ? p.bloom : 0; }
/** The Power multiplier one copy gets from where it stands and what it carries. */
export function powerMul(c) {
  const k = c.k || {}, type = c.type;
  let m = 1;
  const bloom = bloomOfPlot(k.plot);
  m *= Math.pow(1.1, bloom);
  if (k.ley) m *= 1.5;
  m *= 1 + 0.05 * modSum(c, "mighty");
  m *= 1 + 0.02 * bloom * modSum(c, "rooted");
  if (k.orrery) m *= 1 + S.meta.planets.length;
  const v = voidFx(c); if (v && v.power) m *= v.power;
  const w = weatherOf(k.biome), kind = seasonKind().id;
  if (k.rules) {
    if (type === "kiln" && k.rules.includes("hotKilns")) m *= 3;
    if (type === "extractor" && k.rules.includes("richNodes")) m *= 4;
    if (TYPES[type].fam === "source" && k.rules.includes("dimSources")) m *= 0.5;
    if (TYPES[type].fam === "processor" && k.rules.includes("doubleStamp")) m *= 1.5;
    if (TYPES[type].fam === "hearth" && k.rules.includes("greedyHearth")) m *= 2;
  }
  if (type === "kiln" || type === "nebulakiln") {
    if (k.vent) m *= 2;
    if (k.biome === "ember") m *= 1.5;
    if (w === "heatwave") m *= 1.5;
    let heat = (spec("kiln") === 0 ? 0.4 : 0.2) + 0.05 * relic("emberheart") + 0.2 * lawTraits("tinyplots");
    if (hasLaw("tinyplots")) heat *= 2;
    m *= 1 + heat * (k.kilns || 0);
    if (c.newt && c.newt > S.t) m *= 1.25;
  }
  if (type === "polisher") { if (w === "sandstorm") m *= 2; if (spec("polisher") === 1) m *= 2; }
  if (type === "sundish") { if (k.biome === "dune") m *= 2; if (w === "heatwave") m *= 1.5; if (kind === "summer") m *= 1.5; }
  if (type === "moonwell") {
    if (k.biome === "frost") m *= 2;
    if (w === "snow") m *= 1.5;
    if (kind === "winter") m *= 1.5;
    if (hasLaw("eternalnight")) m *= 5;
    m *= Math.pow(2, trialRank("darkness") + lawTraits("eternalnight"));
    if (RT.eclipseShow > 0) m *= 10;
  }
  if (type === "waterwheel") { if (k.biome === "tide") m *= 2; if (w === "rain") m *= 2; }
  if (type === "extractor" && k.star) m *= 10;
  return m;
}

/** A Source's Value per mote, as an L-number, before Richness. */
export function sourceValueL(c) {
  const T = TYPES[c.type];
  let v = Math.log10(T.power) + Math.log10(1 + 0.05 * overclock(c.type)) + milestones(c.type) * Math.log10(2) + Math.log10(powerMul(c));
  if (hasLaw("heavymotes")) v += Math.log10(3);
  if (c.type === "wellspring" && spec("wellspring") === 1) v += Math.log10(1.5);
  return v;
}
/** A processor's multiplier on the base it was given, with Milestones: +10% of base Power each. */
export function procPower(c) {
  const T = TYPES[c.type];
  return T.power * (1 + 0.1 * milestones(c.type)) * powerMul(c);
}
export function mirrorChance(c) { return (0.1 + 0.02 * milestones("mirror")) * powerMul(c); }
export function prismShare(c) { return (0.5 + 0.05 * milestones("prism")) * powerMul(c); }
export function hearthSaleL(c) {
  let s = (TYPES[c.type].power || 1) * (1 + 0.5 * milestones(c.type));
  s += trialRank("solitude") + 2 * lawTraits("lonely");
  s *= powerMul(c);
  if (c.type === "hearth" && spec("hearth") === 0) s *= 2;
  if (hasLaw("lonely")) s *= 10;
  return Math.log10(s);
}
export function fusionBonus(c) {
  let f = 1.25 + 0.05 * milestones("fuser") + 0.02 * ws("flux");
  if (c && c.k && c.k.rules && c.k.rules.includes("fusionBoon")) f += 0.5;
  return f;
}
export function hueBonus(h) {
  const p = primaries(h);
  let b = HUE_BONUS[p];
  if (p === 3 && hasLaw("chaoshues")) b = 6;
  if (p >= 2) {
    b *= 1 + 0.1 * relic("shard") + (spec("fuser") === 1 ? 0.5 : 0) + 0.5 * lawTraits("chaoshues");
    if (constellationOn("serpent")) b *= 2 * constellationMul("serpent");
  }
  return b;
}
export function maxFuseTier() { return 1 + Math.floor(level("fuser") / 50); }
export function comboMul(combo) { return 1 + 0.5 * Math.log2(1 + combo / 100); }
export function comboDecay() {
  // Combo loses 10% of its value each second; Keepers and the tree slow that.
  return 0.1 * Math.pow(0.95, ws("keeper")) * (tree("combodecay") ? 0.9 : 1);
}
export function wishMul() { return spec("hearth") === 1 ? 5 : 3; }
export function launcherRange(c) {
  if (c.type === "cometlauncher") return 60;
  let r = 4 + 2 * milestones("launcher") + modSum(c, "farshot") + 4 * lawTraits("archipelago");
  const k = c.k || {};
  if (k.biome === "highland") r += 2;
  if (c.goat && c.goat > S.t) r += 2;
  if (spec("launcher") === 0) r *= 2;
  if (k.biome === "sky") r *= 2;
  if (hasLaw("archipelago")) r *= 2;
  const w = weatherOf(k.biome);
  if (w === "wind") r *= 1.5;
  if (w === "sandstorm") r *= 0.5;
  return Math.max(1, Math.round(r));
}
export function warpRange() { return 10 * (1 + milestones("warppipe")); }
export function chimeNeed(c) {
  let n = Math.max(4, 10 - milestones("chime"));
  if (constellationOn("bell")) n = Math.max(2, n - 2);
  if (c && c.k && c.k.rules && c.k.rules.includes("chimeEcho")) n = Math.max(2, Math.ceil(n / 2));
  return n;
}
export function chimeRadius() { return 3 + relic("fork") + tree("chimer") + (spec("chime") === 0 ? 2 : 0); }
export function chainBonus() {
  let b = 1;
  if (spec("chime") === 1) b *= 2;
  if (constellationOn("bell")) b *= 2 * constellationMul("bell");
  b *= 1 + 0.5 * trialRank("silence");
  if (hasLaw("fragile")) b *= 5;
  b *= Math.pow(2, lawTraits("fragile"));
  return b;
}
export function lanternPower() { return 0.25 + 0.05 * milestones("lantern"); }
export function lanternRadius() { return 2 + Math.floor(milestones("lantern") / 2); }
export function sprinklerRadius() { return 3 + milestones("sprinkler"); }

/* ---------- Bloom XP ---------- */
export function xpMulL(plotKey) {
  const ps = S.season.plots[plotKey];
  if (!ps) return 0;
  const [a, b] = plotKey.split(",").map(Number);
  const p = getPlot(a, b);
  let m = 1 + 0.1 * ws("fert") + 0.25 * relic("glove") + 0.2 * tree("sap");
  if (p.biome === "meadow") m *= 1.25;
  if (weatherOf(p.biome) === "rain") m *= 1.5;
  if (seasonKind().id === "spring") m *= 2;
  if (codexBiomeDone(p.biome)) m *= 1.1;
  if (hasLaw("wildgrowth")) m *= 5;
  m *= Math.pow(2, trialRank("grey") + lawTraits("wildgrowth"));
  if (p.rules.includes("bloomRush")) m *= 3;
  if (p.rules.includes("noBloom")) m *= 0.25;
  m *= wildBonus("bloom");
  return Math.log10(m);
}
export function codexBiomeDone(biome) {
  const seen = S.meta.discovered.critters;
  for (const id in CRITTERS) if (CRITTERS[id].biome === biome && !seen[id]) return false;
  return true;
}
export const allWonders = () => WONDERS.every((w) => S.meta.discovered.wonders[w]);
export function modSlots(type) { return 1 + Math.floor(level(type) / 100) + (allWonders() ? 1 : 0); }

/* ---------- Constellations ---------- */
export function constellationPoints(i) {
  // Each named Constellation owns `stars` points and CONSTELLATION_EXTRA extra ones.
  const C = CONSTELLATIONS[i];
  const pts = [];
  for (let j = 0; j < C.stars; j++) pts.push(C.id + ":" + j);
  const extra = [];
  for (let j = 0; j < CONSTELLATION_EXTRA; j++) extra.push(C.id + ":x" + j);
  return { pts, extra };
}
export function constellationOn(id) {
  if (id === "lantern" && cosmos("sky")) return true;
  const i = CONSTELLATIONS.findIndex((c) => c.id === id);
  if (i < 0) return false;
  return constellationPoints(i).pts.every((p) => S.world.sky[p]);
}
export function constellationMul(id) {
  const i = CONSTELLATIONS.findIndex((c) => c.id === id);
  if (i < 0) return 1;
  const e = constellationPoints(i).extra.filter((p) => S.world.sky[p]).length;
  return 1 + 0.1 * e;
}
export function completedConstellations() {
  let n = 0;
  for (const c of CONSTELLATIONS) if (constellationOn(c.id)) n++;
  return n + wildList().filter((w) => w.done).length;
}
/** Wild Constellations: 16 Stars and up, made by the Sky for ever. */
export function wildList() {
  const out = [];
  if (!S.world) return out;
  const n = S.world.wild || 0;
  for (let i = 0; i < n; i++) {
    const size = 16 + i;
    const fx = WILD_EFFECTS[(S.world.seed + i * 7) % WILD_EFFECTS.length].id;
    const mult = 1.5 + 0.25 * (i % 3);
    const pts = [];
    for (let j = 0; j < size; j++) pts.push("w" + i + ":" + j);
    const done = pts.every((p) => S.world.sky[p]);
    out.push({ i, size, fx, mult: done ? mult : 1, baseMult: mult, pts, done });
  }
  return out;
}
export function starsTotal() { return S.world.starsEarned === ZERO ? 0 : Math.min(1e6, Math.floor(N(S.world.starsEarned) + 1e-6)); }
export function starsPlaced() { return Object.keys(S.world.sky).length; }

/* ---------- the Global Multiplier ---------- */
export function featCount() {
  let n = 0;
  for (const k in S.meta.feats.tiers) n += S.meta.feats.tiers[k];
  return n + Object.keys(S.meta.feats.hidden).length;
}
export function globalL() {
  let g = Math.log10(1 + 0.1 * ws("polish"));
  g += lAdd(0, S.eclipse.seedsEarned + Math.log10(0.05));         // 1 + 0.05 Seeds
  g += lAdd(0, S.world.starsEarned + Math.log10(0.25));           // 1 + 0.25 Stars
  if (constellationOn("lantern")) g += Math.log10(3 * constellationMul("lantern"));
  if (constellationOn("spiral")) g += lAdd(0, S.world.starsEarned + Math.log10(0.05 * constellationMul("spiral")));
  g += S.world.heart.stage * Math.log10(2);
  g += S.meta.planets.length * Math.log10(3);
  g += Math.log10(1 + 0.01 * featCount());
  g += Math.log10(1 + 0.25 * tree("fertile"));
  g += Math.log10(wildBonus("glow"));
  if (S.windfalls.frenzy > S.t) g += Math.log10(7);
  return g;
}

/* ---------- prestige formulas ---------- */
/** SeedsEarned = floor(10 × (L / 10^6)^(1/3)), L = all Glow since the last Eclipse. */
export function seedsFormulaL(glowSinceL) {
  if (glowSinceL === ZERO || glowSinceL < 6 - 9) return ZERO;
  let l = 1 + (glowSinceL - 6) / 3;
  l += Math.log10(Math.pow(3, hasLaw("shortseasons") ? 1 : 0) * Math.pow(1.5, lawTraits("shortseasons")) * wildBonus("seeds"));
  if (l < 15) { const f = Math.floor(Math.pow(10, l) + 1e-9); return f > 0 ? Math.log10(f) : ZERO; }
  return l;
}
/** What a Harvest would pay now. Autumn's +25% is on the gain. */
export function harvestGainL() {
  const total = seedsFormulaL(S.eclipse.glowSince);
  if (total === ZERO || total <= S.eclipse.seedsEarned + 1e-12) return ZERO;
  let gain = S.eclipse.seedsEarned === ZERO ? total : (function () {
    const a = N(total), b = N(S.eclipse.seedsEarned);
    if (isFinite(a) && a - b < 1e15) return a - b >= 1 ? Math.log10(Math.floor(a - b + 1e-9)) : ZERO;
    return lSubSafe(total, S.eclipse.seedsEarned);
  })();
  if (gain !== ZERO && seasonKind().id === "autumn") gain += Math.log10(1.25);
  return gain;
}
function lSubSafe(a, b) { const d = b - a; return a + Math.log10(1 - Math.pow(10, d)); }
export function harvestReady() {
  const firstOk = lGte(S.season.glowSeason, L(HARVEST_AT)) || S.meta.stats.harvests > 0;
  return firstOk && lGte(harvestGainL(), 0);
}
/** StarsEarned = floor(3 × (S / 10^6)^(1/2)), S = all Seeds since the last Genesis. */
export function starsFormulaL(seedsSinceL) {
  if (seedsSinceL === ZERO) return ZERO;
  const l = Math.log10(3) + (seedsSinceL - 6) / 2;
  if (l < 15) { const f = Math.floor(Math.pow(10, l) + 1e-9); return f > 0 ? Math.log10(f) : ZERO; }
  return l;
}
export function eclipseReady() { return lGte(S.eclipse.seedsEarned, L(ECLIPSE_AT)); }
export function eclipseGainL() {
  const total = starsFormulaL(S.world.seedsSince);
  let gain;
  if (total === ZERO) gain = ZERO;
  else if (S.world.starsEarned === ZERO) gain = total;
  else if (total <= S.world.starsEarned) gain = ZERO;
  else gain = lSubSafe(total, S.world.starsEarned);
  // The first Eclipse pays at least 3 Stars.
  if (S.world.eclipses === 0 && (gain === ZERO || gain < Math.log10(3))) gain = Math.log10(3);
  if (S.world.forgeStars) gain = lAdd(gain, Math.log10(S.world.forgeStars));
  return gain;
}
export function stardustGain() {
  const stars = S.world.starsEarned === ZERO ? 0 : N(S.world.starsEarned);
  return Math.floor(stars / 10) + 25 * (S.meta.depth + 1);
}

/* ---------- production estimates ---------- */
/** Glow per second as measured, an L-number. */
export const perSecL = () => RT.rate.perSec;
export function ringOfKey(key) { const [a, b] = key.split(",").map(Number); return ringOf(a, b); }
export const plotKeyOf = (px, py) => pk(px, py);
export { BIOMES };

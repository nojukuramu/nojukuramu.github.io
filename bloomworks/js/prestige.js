/* prestige.js — the three reset layers.
 *
 *   Season  -> Harvest  pays Seeds    (resets Glow, Levels, copies, plots, Workshop, Bloom to Overgrowth)
 *   Eclipse -> Eclipse  pays Stars    (also resets Seeds, the Seed Tree, Overgrowth)
 *   Genesis -> Genesis  pays a Planet and Stardust (also resets the world, Stars, the Sky, Trials, the World Heart)
 *
 * No layer ever resets Discoveries, Blueprints, Mods, Relics, Feats, or the
 * Codex. Every copy placed when a Season ends becomes a Ghost, so Builders
 * can put the old factory back, faster every Season. */

import { S, RT, freshSeason, freshEclipse, freshWorld, resetRuntime } from "./state.js";
import { ZERO, L, lAdd, lSub, lGte, N, fmtL } from "./num.js";
import { SEED_TREE, COSMOS_TREE, CONSTELLATIONS, CONSTELLATION_EXTRA, TRIALS, TRIAL_GOAL, LAWS, LAW_KEYS, HEART_STAGES, TYPES } from "./data.js";
import * as E from "./econ.js";
import { claimStartRings, rebuildLayout } from "./build.js";
import { seedFromString } from "./rng.js";

let notify = () => {};
export function onNotify(fn) { notify = fn; }
let hooks = { harvest: null, eclipse: null, genesis: null };
export function on(name, fn) { hooks[name] = fn; }

/* ---------- Harvest ---------- */
export function harvest(opts) {
  opts = opts || {};
  if (!opts.force && !E.harvestReady()) return false;
  const gain = E.harvestGainL();
  const before = { seeds: S.eclipse.seeds, season: S.seasonNo, glow: S.season.glowSeason };
  if (gain !== ZERO) {
    S.eclipse.seeds = lAdd(S.eclipse.seeds, gain);
    S.eclipse.seedsEarned = lAdd(S.eclipse.seedsEarned, gain);
    S.world.seedsSince = lAdd(S.world.seedsSince, gain);
  }
  // Overgrowth: half the Bloom, rounded down, if that beats what the plot kept before.
  for (const key in S.season.plots) {
    const og = Math.floor(S.season.plots[key].bloom / 2);
    if (og > (S.eclipse.overgrowth[key] || 0)) S.eclipse.overgrowth[key] = og;
  }
  endSeason();
  S.meta.stats.harvests++;
  if (S.world.skyEdit && S.world.eclipses > 0) S.world.skyEdit = false;
  startSeason(opts.trial || null);
  notify("Harvest: +" + fmtL(gain) + " Seeds. Season " + S.seasonNo + " begins.", "big", "seed");
  if (hooks.harvest) hooks.harvest(before, gain);
  return true;
}

/** Copies become Ghosts; Mods come off and wait for the rebuild. */
function endSeason() {
  const old = S.season;
  const ghosts = old.ghosts.slice();
  const order = old.copies.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const c of order) {
    if (ghosts.some((g) => g.x === c.x && g.y === c.y)) continue;
    ghosts.push({ id: S.nextId++, type: c.type, x: c.x, y: c.y, rot: c.rot, mods: c.mods.slice(), filter: c.filter || null, group: c.group || null, order: ghosts.length });
  }
  for (const m of S.meta.mods) m.on = null;
  // Levels kept: Muscle Memory keeps 10% per level; the Hare adds 10 to every type.
  const keep = 0.1 * E.tree("keep");
  const kept = {};
  for (const k in old.levels) if (keep > 0) kept[k] = Math.max(1, Math.floor(old.levels[k] * keep));
  RT.keptLevels = kept;
  // Commissions carry on, with their clocks moved into the new Season.
  for (const g of S.commissions.list) g.until = Math.max(60, g.until - old.seasonT);
  S.commissions.next = Math.max(0, S.commissions.next - old.seasonT);
  S.season.ghosts = ghosts;
}
function startSeason(trial) {
  const ghosts = S.season.ghosts, jars = S.season.jars;
  S.season = freshSeason();
  S.season.ghosts = ghosts;
  S.season.jars = jars;
  S.season.trial = trial && S.world.eclipses > 0 ? trial : null;
  S.seasonNo++;
  const kept = RT.keptLevels || {};
  const hare = E.constellationOn("hare") ? Math.round(10 * E.constellationMul("hare")) : 0;
  for (const k in TYPES) {
    const lv = (kept[k] || 1) + hare;
    if (lv > 1) S.season.levels[k] = lv;
  }
  RT.keptLevels = null;
  S.season.plots["0,0"] = { xp: ZERO, bloom: 0 };
  const og = S.eclipse.overgrowth["0,0"] || (E.tree("deeproots") ? 1 : 0);
  if (og && !E.inTrial("grey")) S.season.plots["0,0"] = { xp: og + 1, bloom: og };
  resetRuntime();
  claimStartRings();
  E.refreshUnlocks();
  S.specFreeUntil = S.t + 180;
  RT.layoutDirty = true;
  rebuildLayout();
}

/* ---------- Trials ---------- */
export const trialGoalL = (id) => Math.log10(TRIAL_GOAL) + E.trialRank(id);
export function trialTick() {
  const tr = S.season.trial;
  if (tr && !S.season.trialDone && lGte(S.season.glowSeason, trialGoalL(tr))) {
    S.world.trials[tr] = E.trialRank(tr) + 1;
    S.season.trialDone = true;
    RT.lastGlobalAt = -1; RT.layoutDirty = true;
    notify("Trial " + TRIALS[tr].name + " passed: Rank " + S.world.trials[tr] + ". " + TRIALS[tr].reward + ".", "big", "medal");
  }
  // Haste ends the Season at 15 minutes; Short Seasons at 20.
  const lim = seasonLimit();
  if (lim && S.season.seasonT >= lim) { notify("The Season is over.", "big", "seed"); return harvest({ force: true }); }
  return false;
}
export function seasonLimit() {
  if (S.season.trial === "haste") return 900;
  if (S.meta.laws.includes("shortseasons")) return 1200;
  return 0;
}

/* ---------- Seed Tree ---------- */
export function seedNode(id) {
  for (const br of SEED_TREE) { const i = br.nodes.findIndex((n) => n.id === id); if (i >= 0) return { br, i, node: br.nodes[i] }; }
  return null;
}
export function seedCostL(id) {
  const f = seedNode(id);
  return Math.log10(5) + f.i * Math.log10(4) + E.tree(id) * Math.log10(2);
}
export function seedOpen(id) {
  const f = seedNode(id);
  if (!f) return false;
  if (f.i > 0 && !E.tree(f.br.nodes[f.i - 1].id)) return false;
  return f.node.max == null || E.tree(id) < f.node.max;
}
export function buySeed(id) {
  if (!seedOpen(id)) return false;
  const cost = seedCostL(id);
  if (!lGte(S.eclipse.seeds, cost)) return false;
  S.eclipse.seeds = lSub(S.eclipse.seeds, cost);
  S.eclipse.tree[id] = E.tree(id) + 1;
  RT.layoutDirty = true; RT.lastGlobalAt = -1;
  return true;
}

/* ---------- Eclipse ---------- */
export function beginEclipse() {
  if (!E.eclipseReady() || RT.eclipseShow > 0) return false;
  // A last show for the old run: the sun goes dark for 30 s and every Moon Well works at ×10.
  RT.eclipseShow = 30;
  RT.layoutDirty = true;
  notify("The sun goes dark. Eclipse in 30 seconds.", "big", "moon");
  return true;
}
export function eclipseTick(dt) {
  if (!(RT.eclipseShow > 0)) return;
  RT.eclipseShow -= dt;
  if (RT.eclipseShow <= 0) { RT.eclipseShow = 0; doEclipse(); }
}
export function doEclipse() {
  const gain = E.eclipseGainL();
  S.world.starsEarned = lAdd(S.world.starsEarned, gain);
  S.world.forgeStars = 0;
  const keepSeeds = 0.1 * E.cosmos("eternal");
  const seeds = keepSeeds > 0 && S.eclipse.seeds !== ZERO ? S.eclipse.seeds + Math.log10(keepSeeds) : ZERO;
  const earned = keepSeeds > 0 && S.eclipse.seedsEarned !== ZERO ? S.eclipse.seedsEarned + Math.log10(keepSeeds) : ZERO;
  const og = E.constellationOn("gardener") ? S.eclipse.overgrowth : {};
  const heir = 0.01 * E.cosmos("heirloom");
  const kept = {};
  if (heir > 0) for (const k in S.season.levels) kept[k] = Math.max(1, Math.floor(S.season.levels[k] * heir));
  endSeason();
  S.eclipse = freshEclipse();
  S.eclipse.seeds = seeds; S.eclipse.seedsEarned = earned; S.eclipse.overgrowth = og;
  S.world.eclipses++;
  S.world.skyEdit = true;
  S.meta.everEclipsed = true;
  S.meta.stats.eclipses++;
  RT.keptLevels = kept;
  startSeason(null);
  updateWild();
  notify("Eclipse: +" + fmtL(gain) + " Stars. Place them in the Sky.", "big", "star");
  if (hooks.eclipse) hooks.eclipse(gain);
  return true;
}

/* ---------- the Sky ---------- */
export function namedPointCount() { return CONSTELLATIONS.reduce((n, c) => n + c.stars + CONSTELLATION_EXTRA, 0); }
export function updateWild() {
  // The first Wild Constellation appears once you hold more Stars than the
  // named ones need; each next one once you could have filled the last.
  const total = E.starsTotal();
  let cap = CONSTELLATIONS.reduce((n, c) => n + c.stars, 0), w = 0;
  while (w < 1000 && total > cap) { cap += 16 + w; w++; }
  if (w > (S.world.wild || 0)) { S.world.wild = w; notify("A Wild Constellation appears in the Sky.", "info", "star"); }
}
export function placeStar(pt) {
  if (S.world.sky[pt]) return false;
  if (E.starsPlaced() >= E.starsTotal()) return false;
  S.world.sky[pt] = true;
  RT.lastGlobalAt = -1; RT.layoutDirty = true;
  updateWild();
  return true;
}
export function liftStar(pt) {
  if (!S.world.skyEdit || !S.world.sky[pt]) return false;
  delete S.world.sky[pt];
  RT.lastGlobalAt = -1; RT.layoutDirty = true;
  return true;
}
export function directiveSlots() {
  if (S.seasonNo < 3 && !S.meta.everEclipsed) return 0;
  return 2 + E.tree("slots") + E.completedConstellations();
}

/* ---------- World Heart and Genesis ---------- */
export function heartNeed() {
  const st = HEART_STAGES[S.world.heart.stage];
  if (!st) return null;
  return Object.assign({}, st, { tier: st.tier + 2 * S.meta.depth });
}
export const genesisReady = () => S.world.heart.stage >= HEART_STAGES.length;
export function lawChoices() {
  if (!S.world.lawOffer) {
    const free = LAW_KEYS.filter((k) => !S.meta.laws.includes(k));
    const pool = free.length >= 3 ? free : LAW_KEYS.slice();
    const n = E.cosmos("mastery") ? 4 : 3;
    const out = [];
    while (out.length < Math.min(n, pool.length)) { const k = pool[Math.floor(Math.random() * pool.length)]; if (!out.includes(k)) out.push(k); }
    S.world.lawOffer = out;
  }
  return S.world.lawOffer;
}
export function genesis(law) {
  if (!genesisReady() || !lawChoices().includes(law)) return false;
  const dust = E.stardustGain();
  const thisLaw = S.meta.laws.length ? S.meta.laws[S.meta.laws.length - 1] : null;
  S.meta.planets.push({ name: planetName(S.world.seed), law: thisLaw, seed: S.world.seed, depth: S.meta.depth, stars: E.starsTotal() });
  S.meta.stardust = lAdd(S.meta.stardust, Math.log10(dust));
  S.meta.depth++;
  S.meta.laws.push(law);
  for (const m of S.meta.mods) m.on = null;
  S.world = freshWorld(seedFromString("world" + Date.now() + ":" + Math.random()));
  S.eclipse = freshEclipse();
  S.season.ghosts = [];
  S.season = null;
  S.season = freshSeason();
  S.seasonNo++;
  S.weather = {}; S.voids = {}; S.meteors = []; S.ruins = {}; S.hiddenRuins = {};
  RT.plotCache.clear();
  resetRuntime();
  claimStartRings();
  E.refreshUnlocks();
  RT.layoutDirty = true;
  rebuildLayout();
  notify("Genesis. A new world under " + LAWS[law].name + ". +" + dust + " Stardust.", "big", "planet");
  if (hooks.genesis) hooks.genesis(law, dust);
  return true;
}
const SYL = ["ae", "lo", "ri", "va", "en", "tho", "mi", "sa", "ku", "ne", "or", "ys", "bel", "da", "fen", "ia"];
export function planetName(seed) {
  let s = "", x = seed >>> 0;
  for (let i = 0; i < 3; i++) { s += SYL[x % SYL.length]; x = Math.floor(x / SYL.length) + 7 * i; }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ---------- Cosmos Tree ---------- */
export function cosmosCostL(id) {
  const n = COSMOS_TREE.find((x) => x.id === id);
  return Math.log10(n.cost) + E.cosmos(id) * Math.log10(2);
}
export function buyCosmos(id) {
  const n = COSMOS_TREE.find((x) => x.id === id);
  if (!n || (n.max != null && E.cosmos(id) >= n.max)) return false;
  const cost = cosmosCostL(id);
  if (!lGte(S.meta.stardust, cost)) return false;
  S.meta.stardust = lSub(S.meta.stardust, cost);
  S.meta.cosmos[id] = E.cosmos(id) + 1;
  RT.lastGlobalAt = -1; RT.layoutDirty = true;
  return true;
}

/* ---------- Specializations ---------- */
export function canPickSpec(type) {
  if (E.level(type) < 100) return false;
  const cur = S.meta.specs && S.meta.specs[type];
  return cur == null || S.t < (S.specFreeUntil || 0);
}
export function pickSpec(type, i) {
  if (!canPickSpec(type)) return false;
  S.meta.specs = S.meta.specs || {};
  S.meta.specs[type] = i;
  RT.layoutDirty = true;
  return true;
}
export { N, L, TRIALS, LAWS };

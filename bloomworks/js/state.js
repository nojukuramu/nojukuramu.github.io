/* state.js — the one game state, and the runtime that hangs off it.
 *
 * S is everything that is saved. It is one object for the life of the page:
 * a new game or a load empties it and fills it again in place, so every
 * module can import it once and never hold a stale reference.
 *
 * It is laid out by what resets it, outermost first, because the three reset
 * layers are the spine of the game and a reset should be one line per layer:
 *   meta    — never reset (Discoveries, Blueprints, Mods, Relics, Feats, Codex,
 *             Planets, Stardust, the Cosmos Tree, settings)
 *   world   — reset by Genesis (Stars, the Sky, Trials, the World Heart)
 *   eclipse — reset by an Eclipse (Seeds, the Seed Tree, Overgrowth)
 *   season  — reset by a Harvest (Glow, Levels, copies, plots, the Workshop)
 *
 * RT is the runtime: caches rebuilt from S, things on screen that are never
 * worth saving (pops, sparks), and the measured rates. */

import { ZERO } from "./num.js";

export const S = {};
export const RT = {
  occ: new Map(),          // tile key -> copy
  byId: new Map(),         // copy id -> copy
  plotCache: new Map(),    // plot key -> generated plot
  layoutDirty: true,
  chimeAt: new Map(),      // tile key -> chimes whose 8-neighbourhood holds it
  pops: [], sparks: [], rings: [], bolts: [],
  flying: [], floating: [],
  chain: null,
  rate: { buckets: new Array(30).fill(ZERO), at: 0, perSec: ZERO, xp: new Map() },
  globalL: 0, lastGlobalAt: -1,
  slowmo: 0,
  flash: 0,
  replay: null,
  hover: null,
  zenSince: 0
};

export const tk = (x, y) => (x + 0x8000) * 0x10000 + (y + 0x8000);
export const tx = (k) => Math.floor(k / 0x10000) - 0x8000;
export const ty = (k) => (k % 0x10000) - 0x8000;
export const pk = (px, py) => px + "," + py;

export function freshSeason() {
  return {
    glow: Math.log10(50),          // a little to place the first Track or two
    glowSeason: ZERO,
    seasonT: 0,
    plots: { "0,0": { xp: ZERO, bloom: 0, cleared: [], dug: false } },
    copies: [],
    levels: {},
    workshop: {},
    ghosts: S.season ? S.season.ghosts : [],
    jars: S.season ? S.season.jars : 0,
    strays: [],
    trial: null
  };
}

export function freshEclipse() {
  return {
    seeds: ZERO, seedsEarned: ZERO, glowSince: ZERO,
    tree: {}, overgrowth: {}
  };
}

export function freshWorld(seed) {
  return {
    seed: seed >>> 0,
    starsEarned: ZERO,
    sky: {},                  // point id -> true
    wild: 0,                  // Wild Constellations revealed
    trials: {},               // trial id -> rank
    heart: { stage: 0, n: 0 },
    seedsSince: ZERO,
    eclipses: 0,
    forge: 0,                 // Star Forge motes toward the next Star
    forgeStars: 0,
    skyEdit: true,
    cleared: {}, dug: {}, regrown: {}
  };
}

export function freshMeta() {
  return {
    discovered: { types: { wellspring: 1, track: 1, hearth: 1 }, wonders: {}, critters: {}, biomes: { meadow: 1 }, weather: { clear: 1 }, lore: {} },
    blueprints: [],
    mods: [],                 // { id, k, r, on: copy id | null }
    nextMod: 1,
    relics: {},
    feats: { tiers: {}, hidden: {} },
    planets: [],
    stardust: ZERO,
    cosmos: {},
    depth: 0,
    laws: [],
    rank: 0,                  // Commission Rank
    mothsCaught: 0,
    everEclipsed: false,
    bestGlowSeason: ZERO,
    stats: { harvests: 0, eclipses: 0, played: 0, sold: 0 },
    settings: { notation: "short", sound: true, music: false, pops: true, quality: "high" }
  };
}

export function newGame(seed) {
  for (const k of Object.keys(S)) delete S[k];
  S.v = 1;
  S.meta = freshMeta();
  S.world = freshWorld(seed);
  S.eclipse = freshEclipse();
  S.season = null;
  S.season = freshSeason();
  S.seasonNo = 1;
  S.t = 150;                // world clock, starting mid-morning, seconds; day, night and weather run on it
  S.nextId = 1;
  S.tinkers = [];           // { id, job, rule, pinned, link }
  S.directives = [];
  S.weather = {};           // biome -> { cur, until, next }
  S.voids = {};             // tile key -> { fx, until }
  S.meteors = [];           // { x, y, until }
  S.moth = { next: 120, at: null };
  S.merchant = { next: 20 * 60, until: 0, stock: [] };
  S.commissions = { list: [], next: 0 };
  S.rush = { meter: 0, until: 0 };
  S.windfalls = { frenzy: 0, luckyrain: 0 };
  S.vaneAt = -1e9;
  S.logbook = null;
  S.savedAt = Date.now();
  S.ruins = {};             // plot key -> { until, done }
  S.hiddenRuins = {};       // plot key -> true once a riddle opened it
  S.counters = { nightSales: 0, nightIdx: -1, comboHold: {} };
  resetRuntime();
}

export function resetRuntime() {
  RT.occ.clear(); RT.byId.clear(); RT.plotCache.clear(); RT.chimeAt.clear();
  RT.pops.length = 0; RT.sparks.length = 0; RT.rings.length = 0; RT.bolts.length = 0;
  RT.flying.length = 0; RT.floating.length = 0;
  RT.chain = null; RT.layoutDirty = true; RT.lastGlobalAt = -1;
  RT.rate.buckets.fill(ZERO); RT.rate.perSec = ZERO; RT.rate.xp.clear();
  RT.critters = []; RT.tinkerBots = []; RT.strays = [];
}

export const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);

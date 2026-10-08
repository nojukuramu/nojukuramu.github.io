/* goals.js — short goals and secrets: Commissions, Golden Moths and their
 * Windfalls, the Wandering Merchant, Feats, the Codex, loot from Ruins, and
 * the four kinds of secret. Every goal system scales up with no end:
 * Commission Rank, Feat tiers and Mod rarity never stop. */

import { S, RT, pk } from "./state.js";
import { ZERO, L, lAdd, lSub, lGte, fmtL, N } from "./num.js";
import {
  WINDFALLS, COMMISSIONS, FEAT_TIERS, HIDDEN_FEATS, LORE, MOD_KEYS, MODS, RELIC_KEYS, RELICS, WONDERS, TYPES, HUES,
  BIOMES, rarityName, COMMISSION_EVERY, MERCHANT_EVERY, MERCHANT_STAY, CRITTERS
} from "./data.js";
import * as E from "./econ.js";
import { getPlot, plotSize, frontier, owned, ringOf, plotsOwned } from "./world.js";
import { copyAt, startDig } from "./build.js";
import { gain, ringAll } from "./sim.js";

let notify = () => {};
export function onNotify(fn) { notify = fn; }
const say = (text, kind, icon) => notify(text, kind || "info", icon);

/* ---------- loot ---------- */
export function addMod(k, r) {
  const m = { id: S.meta.nextMod++, k: k || MOD_KEYS[Math.floor(Math.random() * MOD_KEYS.length)], r: r || 0, on: null };
  S.meta.mods.push(m);
  return m;
}
/** A random rarity: grade shifts the odds upward, minR is a floor. */
export function rollRarity(grade, minR) {
  let r = 0;
  const x = Math.random();
  if (x < 0.4) r = 0; else if (x < 0.7) r = 1; else if (x < 0.88) r = 2; else if (x < 0.96) r = 3; else if (x < 0.993) r = 4; else r = 5;
  r += Math.floor((grade || 0) / 2);
  return Math.max(minR || 0, r);
}
export function dropMod(grade, minR, quiet) {
  const m = addMod(null, rollRarity(grade, minR));
  if (!quiet) say("Mod: " + rarityName(m.r) + " " + MODS[m.k].name, "loot", "gem");
  return m;
}
export function dropRelic(quiet) {
  const k = RELIC_KEYS[Math.floor(Math.random() * RELIC_KEYS.length)];
  S.meta.relics[k] = (S.meta.relics[k] || 0) + 1;
  RT.layoutDirty = true;
  if (!quiet) say("Relic: " + RELICS[k].name + (S.meta.relics[k] > 1 ? " (Level " + S.meta.relics[k] + ")" : ""), "loot", "relic");
  return k;
}
export function findLore(quiet) {
  const left = LORE.filter((l) => !S.meta.discovered.lore[l.id]);
  if (!left.length) return null;
  const l = left[Math.floor(Math.random() * left.length)];
  S.meta.discovered.lore[l.id] = 1;
  if (!quiet) say("Lore page: " + l.title, "loot", "book");
  return l;
}
export function findWonder(id, quiet) {
  const left = id ? [id] : WONDERS.filter((w) => !S.meta.discovered.wonders[w]);
  if (!left.length) return null;
  const w = left[Math.floor(Math.random() * left.length)];
  if (S.meta.discovered.wonders[w]) return null;
  S.meta.discovered.wonders[w] = 1;
  if (!quiet) say("Wonder found: " + TYPES[w].name, "big", "star");
  return w;
}
/** Merge 3 identical Mods of one Rarity into 1 of the next. No cap. */
export function merge(k, r) {
  const free = S.meta.mods.filter((m) => m.k === k && m.r === r && !m.on);
  if (free.length < 3) return null;
  for (const m of free.slice(0, 3)) S.meta.mods.splice(S.meta.mods.indexOf(m), 1);
  return addMod(k, r + 1);
}
export function modFits(m, c) {
  const f = MODS[m.k].fits, T = TYPES[c.type];
  if (f === "any") return T.fam !== "wonder" || true;
  if (f === "processor") return T.fam === "processor";
  if (f === "launcher") return c.type === "launcher" || c.type === "warppipe" || c.type === "cometlauncher";
  if (f === "fuser") return c.type === "fuser";
  return false;
}
export function equip(modId, c) {
  const m = S.meta.mods.find((q) => q.id === modId);
  if (!m || m.on || !modFits(m, c)) return false;
  if (c.mods.length >= E.modSlots(c.type)) return false;
  m.on = c.id; c.mods.push(m.id); RT.layoutDirty = true;
  return true;
}
export function unequip(modId, c) {
  const m = S.meta.mods.find((q) => q.id === modId);
  if (m) m.on = null;
  c.mods = c.mods.filter((x) => x !== modId);
  RT.layoutDirty = true;
}

/** Ruins: a Wonder, a Relic, or Mods, and often a Lore page. Quality rises with Ring. */
export function ruinsLoot(px, py) {
  const ring = ringOf(px, py), grade = Math.floor(ring / 3) + E.tree("ruinsgrade");
  const x = Math.random(), got = [];
  if (x < 0.25 + ring * 0.01 && WONDERS.some((w) => !S.meta.discovered.wonders[w])) got.push("Wonder: " + TYPES[findWonder(null, true)].name);
  else if (x < 0.5) got.push("Relic: " + RELICS[dropRelic(true)].name);
  else { const n = 1 + Math.floor(ring / 4); for (let i = 0; i < n; i++) { const m = dropMod(grade, 0, true); got.push(rarityName(m.r) + " " + MODS[m.k].name); } }
  if (Math.random() < 0.6) { const l = findLore(true); if (l) got.push("Lore: " + l.title); }
  say("Ruins excavated: " + got.join(", "), "big", "pick");
  return got;
}

/* ---------- production ---------- */
/** Glow for `secs` seconds of production at the measured rate (at least a little). */
export function productionL(secs) {
  const ps = RT.rate.perSec === ZERO ? 0 : RT.rate.perSec;
  return Math.max(ps, 0) + Math.log10(secs);
}

/* ---------- Golden Moths and Windfalls ---------- */
export function mothInterval() { return (180 + Math.random() * 180) * Math.pow(0.85, E.relic("mothlamp")); }
export function spawnMoth() {
  const keys = Object.keys(S.season.plots);
  const key = keys[Math.floor(Math.random() * keys.length)];
  const [px, py] = key.split(",").map(Number), P = plotSize();
  RT.moth = { x: px * P + Math.random() * P, y: py * P + Math.random() * P, t: 0, until: S.t + 12, vx: (Math.random() - 0.5) * 1.6, vy: (Math.random() - 0.5) * 1.6, keeperAt: S.t + 5 };
  say("A Golden Moth is out. Tap it.", "moth", "moth");
}
export function rollWindfall() {
  let x = Math.random();
  for (const w of WINDFALLS) { if (x < w.p) return w; x -= w.p; }
  return WINDFALLS[0];
}
/** share is 1 when you catch it yourself, 0.5 for a Keeper. */
export function windfall(share, w) {
  w = w || rollWindfall();
  if (w.id === "burst") { const g = productionL(900) + Math.log10(share); gain(g); say("Glow Burst: +" + fmtL(g) + " Glow", "big", "moth"); }
  if (w.id === "frenzy") { S.windfalls.frenzy = Math.max(S.windfalls.frenzy, S.t) + 60 * share; say("Frenzy: ×7 Glow", "big", "moth"); }
  if (w.id === "luckyrain") { S.windfalls.luckyrain = Math.max(S.windfalls.luckyrain, S.t) + 30 * share; say("Lucky Rain: ×10 Lucky chance", "big", "moth"); }
  if (w.id === "chainstorm") { ringAll(); say("Chain Storm: every Chime rings", "big", "moth"); }
  if (w.id === "moddrop") { dropMod(2, share < 1 ? 1 : 2); }
  return w;
}
export function catchMoth(byKeeper) {
  if (!RT.moth) return null;
  RT.moth = null;
  if (!byKeeper) { S.meta.mothsCaught++; if (S.meta.mothsCaught >= 25) hiddenFeat("mothcatcher"); }
  return windfall(byKeeper ? 0.5 : 1);
}
export function openJar() {
  if (S.season.jars <= 0) return null;
  S.season.jars--;
  return windfall(1);
}

/* ---------- Commissions ---------- */
function pickKind() {
  const kinds = Object.keys(COMMISSIONS).filter((k) => {
    const n = COMMISSIONS[k].needs;
    return !n || S.meta.discovered.types[n];
  });
  return kinds[Math.floor(Math.random() * kinds.length)];
}
export function newCommission() {
  const rank = S.meta.rank, kind = pickKind();
  const g = { kind, rank, got: 0, done: false };
  const C = COMMISSIONS[kind];
  g.until = S.season.seasonT + C.min * 60;
  g.limit = C.min * 60;
  if (kind === "sellHue") {
    const seen = [...(RT.seenHues || new Set([0]))].filter((h) => h !== 0);
    g.hue = seen.length ? seen[Math.floor(Math.random() * seen.length)] : 0;
    g.hueName = HUES[g.hue].name;
    g.n = Math.round(60 * Math.pow(1.35, rank) / 10) * 10;
  }
  if (kind === "combo") g.n = Math.round(50 * Math.pow(1.6, rank));
  if (kind === "chain") g.n = 3 + Math.floor(rank / 2);
  if (kind === "lucky") g.n = 1 + Math.floor(rank / 4);
  if (kind === "tier") g.n = Math.min(E.maxFuseTier() + 1, 2 + Math.floor(rank / 3));
  if (kind === "claim") {
    const opts = frontier().map(([a, b]) => getPlot(a, b).biome);
    g.biome = opts.length ? opts[Math.floor(Math.random() * opts.length)] : "meadow";
    g.biomeName = BIOMES[g.biome].name;
  }
  if (kind === "glow") { g.amount = productionL(600) + Math.log10(1.5); g.amountText = fmtL(g.amount); g.sum = ZERO; }
  g.text = C.text(g);
  return g;
}
export function commissionTick() {
  const C = S.commissions;
  C.list = C.list.filter((g) => g.done || S.season.seasonT < g.until);
  if (C.list.length < 3 && (S.season.seasonT >= C.next || C.list.length === 0)) {
    C.list.push(newCommission());
    C.next = S.season.seasonT + COMMISSION_EVERY;
  }
}
export function commissionProgress(kind, a, b) {
  for (const g of S.commissions.list) {
    if (g.done || g.kind !== kind) continue;
    if (kind === "sellHue" && a === g.hue) g.got++;
    if (kind === "lucky" && a >= g.n) g.got = g.n;
    if (kind === "chain" && a >= g.n) g.got = g.n;
    if (kind === "tier" && a >= g.n) g.got = g.n;
    if (kind === "claim" && a === g.biome) g.got = 1;
    if (kind === "combo") { if (a >= g.n) { g.held = (g.held || 0) + b; g.got = Math.min(60, Math.floor(g.held)); } else g.held = 0; }
    if (kind === "glow") { g.sum = lAdd(g.sum, a); if (lGte(g.sum, g.amount)) g.got = 1; }
    const need = kind === "sellHue" ? g.n : kind === "combo" ? 60 : kind === "lucky" || kind === "chain" || kind === "tier" ? g.n : 1;
    g.need = need;
    if (g.got >= need) { g.done = true; say("Commission done: " + g.text, "good", "check"); }
  }
}
/** Collect a finished Commission: 10 minutes of production, one Mod, a 1% chance of a Relic. */
export function collect(g) {
  if (!g.done) return false;
  const glow = productionL(600);
  gain(glow);
  dropMod(Math.floor(g.rank / 3), 0, true);
  if (Math.random() < 0.01) dropRelic();
  S.meta.rank++;
  S.commissions.list.splice(S.commissions.list.indexOf(g), 1);
  S.commissions.list.push(newCommission());
  say("Collected: +" + fmtL(glow) + " Glow and a Mod. Rank " + S.meta.rank, "good", "check");
  return true;
}

/* ---------- the Merchant ---------- */
export function merchantTick() {
  const M = S.merchant;
  if (M.until && S.t >= M.until) { M.until = 0; M.stock = []; M.next = S.t + MERCHANT_EVERY; }
  if (!M.until && S.t >= M.next) {
    M.until = S.t + MERCHANT_STAY;
    M.stock = [];
    const per = productionL(1);
    for (let i = 0; i < 4; i++) {
      const x = Math.random();
      if (x < 0.06) M.stock.push({ kind: "relic", price: Math.log10(5 * Math.pow(2, RELIC_KEYS.reduce((n, k) => n + E.relic(k), 0))), cur: "seeds" });
      else if (x < 0.5) { const r = rollRarity(1, 1); M.stock.push({ kind: "mod", k: MOD_KEYS[Math.floor(Math.random() * MOD_KEYS.length)], r, price: per + Math.log10(300 * Math.pow(2.5, r)), cur: "glow" }); }
      else if (x < 0.75) M.stock.push({ kind: "jar", price: per + Math.log10(600), cur: "glow" });
      else M.stock.push({ kind: "charm", price: per + Math.log10(200), cur: "glow" });
    }
    say("The Merchant is here for 5 minutes.", "info", "bag");
  }
}
export function buy(item, biome, weather) {
  const pool = item.cur === "seeds" ? "seeds" : "glow";
  const have = pool === "seeds" ? S.eclipse.seeds : S.season.glow;
  if (!lGte(have, item.price) || item.sold) return false;
  if (pool === "seeds") S.eclipse.seeds = lSub(S.eclipse.seeds, item.price); else S.season.glow = lSub(S.season.glow, item.price);
  if (item.kind === "relic") dropRelic();
  if (item.kind === "mod") { addMod(item.k, item.r); say("Bought " + rarityName(item.r) + " " + MODS[item.k].name, "loot", "gem"); }
  if (item.kind === "jar") S.season.jars = Math.min(9, S.season.jars + 1);
  if (item.kind === "charm" && biome && weather) { const w = S.weather[biome] || (S.weather[biome] = { cur: "clear", until: S.t + 60 }); w.next = weather; w.until = Math.min(w.until, S.t + 120); }
  item.sold = true;
  return true;
}

/* ---------- Feats ---------- */
export function featNext(kind) { return FEAT_TIERS[kind].from + (S.meta.feats.tiers[kind] || 0); }
export function featCheck(kind, value) {
  let got = 0;
  while (value >= featNext(kind)) { S.meta.feats.tiers[kind] = (S.meta.feats.tiers[kind] || 0) + 1; got++; }
  if (!got) return;
  // Several tiers at once are one toast, not a flood.
  say("Feat: " + FEAT_TIERS[kind].text(featNext(kind) - 1) + (got > 1 ? " (+" + got + "% Glow)" : " (+1% Glow)"), "feat", "medal");
  RT.lastGlobalAt = -1;
}
export function hiddenFeat(id) {
  if (S.meta.feats.hidden[id]) return;
  S.meta.feats.hidden[id] = 1;
  RT.lastGlobalAt = -1;
  say("Hidden Feat: " + HIDDEN_FEATS[id].name + " (+1% Glow)", "feat", "medal");
}

/* ---------- secrets ---------- */
/** Hidden sales: a Prismatic T7 mote sold during an Aurora finds a Relic, once per Aurora. */
export function hiddenSale(hearth, m) {
  if (m.h !== 7 || m.t < 7) return;
  const w = S.weather[hearth.k.biome];
  if (!w || w.cur !== "aurora" || w.relicGiven) return;
  w.relicGiven = true;
  say("A hidden sale. Something was waiting under the Aurora.", "big", "relic");
  dropRelic();
}
/** Chime songs: a Chain that plays a known Lore melody reveals its Wonder. */
export function chimeSong(notes) {
  if (notes.length < 5) return;
  const s = notes.join("");
  for (const l of LORE) {
    if (!l.melody || !S.meta.discovered.lore[l.id] || S.meta.discovered.wonders[l.wonder]) continue;
    if (s.includes(l.melody.join(""))) { say("The Chimes played \"" + l.title + "\".", "big", "bell"); findWonder(l.wonder); }
  }
}
/** Ruins riddles: build the right pattern on the right plot and a hidden Ruins site opens. */
export function riddleCheck() {
  for (const l of LORE) {
    const r = l.riddle;
    if (!r || !S.meta.discovered.lore[l.id]) continue;
    const key = pk(r.px, r.py);
    if (S.hiddenRuins[key] || S.world.dug[key + "#h"] || !owned(r.px, r.py)) continue;
    const P = plotSize(), x0 = r.px * P, y0 = r.py * P;
    const is = (x, y) => { const c = copyAt(x, y); return c && c.type === r.type; };
    let ok = false;
    if (r.pattern === "corners") ok = is(x0, y0) && is(x0 + P - 1, y0) && is(x0, y0 + P - 1) && is(x0 + P - 1, y0 + P - 1);
    if (r.pattern === "ring") { const c = Math.floor(P / 2); ok = is(x0 + c, y0 + c - 1) && is(x0 + c + 1, y0 + c) && is(x0 + c, y0 + c + 1) && is(x0 + c - 1, y0 + c) && !copyAt(x0 + c, y0 + c); }
    if (r.pattern === "row3") {
      const kilns = S.season.copies.filter((c) => c.type === "kiln" && c.k && c.k.plot === key);
      ok = kilns.some((a) => kilns.some((b) => b.y === a.y && b.x === a.x + 2 && kilns.some((d) => d.y === a.y && d.x === a.x + 4)));
    }
    if (ok) { S.hiddenRuins[key] = true; hiddenFeat("riddle"); say("\"" + l.title + "\": a hidden Ruins site opens.", "big", "pick"); }
  }
}

/* ---------- the Codex ---------- */
export function codexCounts() {
  const d = S.meta.discovered;
  return {
    types: Object.keys(d.types).length, wonders: Object.keys(d.wonders).length, critters: Object.keys(d.critters).length,
    biomes: Object.keys(d.biomes).length, weather: Object.keys(d.weather).length, lore: Object.keys(d.lore).length,
    ofCritters: Object.keys(CRITTERS).length
  };
}

/* ---------- once a second ---------- */
export function goalsTick() {
  commissionTick();
  merchantTick();
  featCheck("glow", Math.floor(S.season.glowSeason + 1e-9));
  featCheck("plots", plotsOwned());
  let best = 0;
  for (const h of RT.hearths || []) best = Math.max(best, h.combo);
  if (best > 0) featCheck("combo", Math.floor(Math.log10(best) + 1e-9));
  commissionProgress("combo", best, 1);
  riddleCheck();
  // Ruins being dug
  for (const key in S.ruins) {
    const r = S.ruins[key];
    if (r.done) continue;
    const scouts = (S.tinkers || []).some((t) => t.job === "scout");
    r.left -= scouts ? 2 : 1;
    if (r.left <= 0) {
      r.done = true;
      if (S.hiddenRuins[key]) { delete S.hiddenRuins[key]; S.world.dug[key + "#h"] = 1; } else S.world.dug[key] = 1;
      const [a, b] = key.split(",").map(Number);
      ruinsLoot(a, b);
      RT.layoutDirty = true;
      delete S.ruins[key];
    }
  }
}
export { startDig, N };

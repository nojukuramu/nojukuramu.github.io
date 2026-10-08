/* auto.js — automating the automation. Tinkers that walk the world and do
 * one Job each, Ghosts and Blueprints that tell Builders what to put back,
 * and Directives: IF-THEN rules the game checks once a second, top down.
 * By the first Eclipse the game can run, rebuild and reset itself while you
 * choose the strategy. */

import { S, RT, pk } from "./state.js";
import { ZERO, L, lGte, lSub, N, lAdd } from "./num.js";
import { TYPES, JOBS, WORKSHOP, LAWS } from "./data.js";
import * as E from "./econ.js";
import { place, whyNot, claim, sizeOf, copyAt } from "./build.js";
import { frontier, plotSize, owned, getPlot } from "./world.js";
import { offer, sell, deliver } from "./sim.js";
import { catchMoth, collect, openJar } from "./goals.js";
import { harvest, beginEclipse, directiveSlots } from "./prestige.js";
import { buildCostL, levelCostL } from "./econ.js";

let notify = () => {};
export function onNotify(fn) { notify = fn; }

/* ---------- Tinkers ---------- */
export function tinkerCount() {
  let n = 0;
  for (const h of RT.huts || []) n += 2 + E.milestones("tinkerhut");
  if (!n) return 0;
  n += E.tree("tinker") + E.trialRank("haste");
  if (E.constellationOn("tinker")) n += 3;
  return n;
}
export function tinkerSpeed() {
  let s = 2.2 * (1 + 0.05 * (E.level("tinkerhut") - 1)) * (1 + 0.15 * E.relic("wrench"));
  if (E.constellationOn("tinker")) s *= 2 * E.constellationMul("tinker");
  return s;
}
/** Tinker settings live in S.tinkers (saved); their bodies in RT.tinkerBots. */
export function syncTinkers() {
  const n = tinkerCount();
  while (S.tinkers.length < n) S.tinkers.push({ id: S.tinkers.length + 1, job: ["builder", "upgrader", "scout", "keeper", "courier"][S.tinkers.length % 5], rule: "value", pinned: [] });
  const bots = RT.tinkerBots;
  while (bots.length < Math.min(n, S.tinkers.length)) {
    const hut = RT.huts[bots.length % RT.huts.length];
    bots.push({ i: bots.length, x: hut.x + 1, y: hut.y + 1, task: null, carry: null, work: 0, face: 1 });
  }
  if (bots.length > n) bots.length = n;
}
function walk(b, x, y, dt) {
  const dx = x - b.x, dy = y - b.y, d = Math.hypot(dx, dy);
  if (d < 0.08) return true;
  const s = Math.min(d, tinkerSpeed() * dt);
  b.x += (dx / d) * s; b.y += (dy / d) * s; b.face = dx < 0 ? -1 : 1;
  return false;
}
function home(b) { const h = RT.huts[b.i % RT.huts.length]; return h ? [h.x + 1, h.y + 1] : [b.x, b.y]; }

/* What a Builder builds next: the first Ghost in build order that can be paid for and placed. */
function nextGhost() {
  const gs = S.season.ghosts.slice().sort((a, b) => a.order - b.order);
  for (const g of gs) {
    if (g.claimed) continue;
    if (!E.unlocked(g.type)) continue;
    if (whyNot(g.type, g.x, g.y)) continue;
    if (!lGte(S.season.glow, buildCostL(g.type))) return null;      // in order: wait for this one
    return g;
  }
  return null;
}
export function buildGhost(g) {
  const c = place(g.type, g.x, g.y, g.rot, { order: g.order });
  if (!c) return null;
  if (g.filter) c.filter = g.filter;
  if (g.group) c.group = g.group;
  for (const id of g.mods || []) { const m = S.meta.mods.find((q) => q.id === id); if (m && !m.on && c.mods.length < E.modSlots(c.type)) { m.on = c.id; c.mods.push(id); } }
  S.season.ghosts = S.season.ghosts.filter((x) => x !== g);
  return c;
}

/* Upgrader rules. */
function upgradeTarget(rule, pinned) {
  const types = [...new Set(S.season.copies.map((c) => E.lvlKey(c.type)))].filter((k) => TYPES[k].level);
  if (!types.length) return null;
  if (rule === "pinned") { for (const p of pinned || []) if (types.includes(p)) return p; return null; }
  if (rule === "cheapest") return types.sort((a, b) => levelCostL(a, 1) - levelCostL(b, 1))[0];
  if (rule === "bottleneck") {
    // The family with the least total Tempo relative to the flow it has to carry.
    let worst = null, lo = Infinity;
    for (const k of types) {
      const fam = TYPES[k].fam;
      if (!["source", "processor", "hearth", "fuser"].includes(fam)) continue;
      const cap = S.season.copies.filter((c) => c.type === k).reduce((n, c) => n + E.tempo(c), 0);
      const q = S.season.copies.filter((c) => c.type === k).reduce((n, c) => n + (c.inq ? c.inq.length : 0), 0);
      const score = fam === "source" ? cap * 1.5 : cap - q * 2;
      if (score < lo) { lo = score; worst = k; }
    }
    return worst;
  }
  // Best value: Sources first while under the cap, then the cheapest per copy.
  return types.sort((a, b) => (levelCostL(a, 1) - Math.log10(1 + E.count(a))) - (levelCostL(b, 1) - Math.log10(1 + E.count(b))))[0];
}
export function buyLevels(type, n) {
  const key = E.lvlKey(type);
  if (!TYPES[key].level) return 0;
  let k = n === "max" ? E.affordLevels(key, S.season.glow) : n === "ms" ? Math.min(25 - (E.level(key) % 25), E.affordLevels(key, S.season.glow)) : n;
  if (n !== "max" && n !== "ms" && E.affordLevels(key, S.season.glow, n) < n) return 0;
  if (k <= 0) return 0;
  const cost = levelCostL(key, k);
  if (!lGte(S.season.glow, cost)) return 0;
  const before = E.milestones(key);
  S.season.glow = lSub(S.season.glow, cost);
  S.season.levels[key] = E.level(key) + k;
  if (E.milestones(key) > before) { RT.waves = RT.waves || []; RT.waves.push({ type: key, t: 0 }); notify(TYPES[key].name + " Milestone: " + E.level(key) + ". " + materialLine(key), "milestone", "up"); }
  RT.layoutDirty = true;
  return k;
}
function materialLine(key) { const m = Math.floor(E.level(key) / 25); const names = ["Wood", "Copper", "Iron", "Silver", "Gold", "Crystal", "Starmetal", "Voidglass"]; return "Material: " + names[Math.min(7, m)] + (m > 7 ? ", " + (m - 7) + " star marks" : ""); }

/* Scouts: the cheapest plot next to yours, when you hold 3× its cost. */
function cheapestFrontier() {
  let best = null, bc = Infinity;
  for (const [a, b] of frontier()) { const c = E.claimCostL(a, b); if (c < bc) { bc = c; best = [a, b]; } }
  return best ? { px: best[0], py: best[1], cost: bc } : null;
}

export function tinkersTick(dt) {
  if (!RT.huts || !RT.huts.length) { RT.tinkerBots.length = 0; return; }
  syncTinkers();
  const P = plotSize();
  for (const b of RT.tinkerBots) {
    const cfg = S.tinkers[b.i];
    if (!cfg) continue;
    const job = cfg.job;
    if (!b.task) {
      b.idle = (b.idle || 0) - dt;
      if (b.idle > 0) continue;
      b.idle = 0.6;
      if (job === "builder") { const g = nextGhost(); if (g) { g.claimed = true; b.task = { kind: "build", g, x: g.x + sizeOf(g.type) / 2, y: g.y + sizeOf(g.type) / 2 }; } }
      if (job === "upgrader") {
        const t = upgradeTarget(cfg.rule, cfg.pinned);
        if (t && lGte(S.season.glow, levelCostL(t, 1))) { const c = S.season.copies.find((o) => E.lvlKey(o.type) === t); if (c) b.task = { kind: "level", type: t, x: c.x + 0.5, y: c.y + 0.5 }; }
      }
      if (job === "scout") {
        const f = cheapestFrontier();
        if (f && lGte(S.season.glow, f.cost + Math.log10(3))) b.task = { kind: "claim", px: f.px, py: f.py, x: f.px * P + P / 2, y: f.py * P + P / 2 };
        else { const dig = Object.keys(S.ruins)[0]; if (dig) { const [a, c] = dig.split(",").map(Number); b.task = { kind: "dig", x: a * P + P / 2, y: c * P + P / 2 }; } }
      }
      if (job === "keeper") {
        if (RT.moth && S.t >= RT.moth.keeperAt) b.task = { kind: "moth", x: RT.moth.x, y: RT.moth.y };
        else { const g = S.commissions.list.find((x) => x.done); if (g) b.task = { kind: "collect", g, x: 5, y: 5 }; }
      }
      if (job === "courier") {
        const s = S.season.strays[0];
        if (s) { S.season.strays.shift(); b.task = { kind: "carry", m: s.m, x: s.x, y: s.y, picked: false }; }
        else if (cfg.link && cfg.link.length === 2) {
          const a = RT.byId.get(cfg.link[0]), z = RT.byId.get(cfg.link[1]);
          if (a && z && a.outq.length) b.task = { kind: "link", a, z, x: a.x + 0.5, y: a.y + 0.5, picked: false };
        }
      }
      if (!b.task) { const [hx, hy] = home(b); walk(b, hx + Math.sin(S.t + b.i) * 0.8, hy + Math.cos(S.t * 0.7 + b.i) * 0.6, dt); }
      continue;
    }
    const t = b.task;
    if (t.kind === "moth" && RT.moth) { t.x = RT.moth.x; t.y = RT.moth.y; }
    if (!walk(b, t.x, t.y, dt)) continue;
    b.work += dt * (E.tree("quick") && job === "builder" ? 2 : 1);
    if (b.work < 0.5) continue;
    b.work = 0;
    if (t.kind === "build") { t.g.claimed = false; if (S.season.ghosts.includes(t.g)) buildGhost(t.g); }
    if (t.kind === "level") buyLevels(t.type, 1);
    if (t.kind === "claim") { const f = cheapestFrontier(); if (f && f.px === t.px && f.py === t.py && lGte(S.season.glow, f.cost + Math.log10(3))) claim(t.px, t.py); }
    if (t.kind === "moth") { if (RT.moth) catchMoth(true); }
    if (t.kind === "collect") { if (S.commissions.list.includes(t.g)) collect(t.g); }
    if (t.kind === "carry") {
      if (!t.picked) {
        t.picked = true;
        let best = null, bd = 1e9;
        for (const tr of RT.tracks) { const d = Math.hypot(tr.x - b.x, tr.y - b.y); if (d < bd) { bd = d; best = tr; } }
        if (!best) { S.season.strays.push({ x: b.x, y: b.y, m: t.m, plot: pk(Math.floor(b.x / P), Math.floor(b.y / P)) }); b.task = null; continue; }
        t.x = best.x + 0.5; t.y = best.y + 0.5; t.tr = best;
        continue;
      }
      if (offer(t.tr.x, t.tr.y, t.m, t.tr.rot, null) !== 1) { t.picked = false; continue; }
    }
    if (t.kind === "link") {
      if (!t.picked) { if (!t.a.outq.length) { b.task = null; continue; } t.m = t.a.outq.shift(); t.picked = true; t.x = t.z.x + 0.5; t.y = t.z.y + 0.5; continue; }
      // Into the far contraption by any side.
      if (deliver(t.z, t.m) !== 1) continue;
    }
    b.task = null;
  }
}

/* ---------- Blueprints ---------- */
/** Save every copy (and Ghost) inside a rectangle as a Blueprint. */
export function saveBlueprint(name, x0, y0, x1, y1) {
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1);
  const parts = [];
  const inside = (c) => c.x >= xa && c.y >= ya && c.x + sizeOf(c.type) - 1 <= xb && c.y + sizeOf(c.type) - 1 <= yb;
  for (const c of S.season.copies) if (inside(c) && TYPES[c.type].fam !== "heart") parts.push({ t: c.type, x: c.x - xa, y: c.y - ya, r: c.rot });
  for (const g of S.season.ghosts) if (inside(g)) parts.push({ t: g.type, x: g.x - xa, y: g.y - ya, r: g.rot });
  if (!parts.length) return null;
  const bp = { id: "bp" + Date.now().toString(36), name: name || "Blueprint " + (S.meta.blueprints.length + 1), w: xb - xa + 1, h: yb - ya + 1, parts };
  S.meta.blueprints.push(bp);
  return bp;
}
/** A part's place after the Blueprint is turned `rot` quarter turns. */
export function rotPart(bp, p, rot) {
  const n = sizeOf(p.t);
  let x = p.x, y = p.y, w = bp.w, h = bp.h;
  for (let i = 0; i < rot; i++) { const nx = h - y - n, ny = x; x = nx; y = ny; const t = w; w = h; h = t; }
  return { x, y, r: (p.r + rot) & 3 };
}
/** Stamp a Blueprint: it places Ghosts, and Builders do the rest. */
export function stampBlueprint(bp, x0, y0, rot) {
  let order = S.season.ghosts.reduce((m, g) => Math.max(m, g.order), 0) + 1;
  let n = 0;
  for (const p of bp.parts) {
    const q = rotPart(bp, p, rot || 0);
    const x = x0 + q.x, y = y0 + q.y;
    if (S.season.ghosts.some((g) => g.x === x && g.y === y)) continue;
    const c = copyAt(x, y);
    if (c && c.type === p.t) continue;
    S.season.ghosts.push({ id: S.nextId++, type: p.t, x, y, rot: q.r, mods: [], order: order++ });
    n++;
  }
  return n;
}
/** Share a Blueprint as a text code. */
export function blueprintCode(bp) {
  const json = JSON.stringify({ n: bp.name, w: bp.w, h: bp.h, p: bp.parts.map((p) => [p.t, p.x, p.y, p.r]) });
  return "BW1:" + btoa(unescape(encodeURIComponent(json)));
}
export function blueprintFromCode(code) {
  const m = String(code || "").trim().match(/^BW1:([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  try {
    const o = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
    const parts = (o.p || []).filter((p) => Array.isArray(p) && TYPES[p[0]] && TYPES[p[0]].fam !== "heart").map((p) => ({ t: p[0], x: p[1] | 0, y: p[2] | 0, r: (p[3] | 0) & 3 }));
    if (!parts.length) return null;
    const bp = { id: "bp" + Date.now().toString(36), name: String(o.n || "Shared").slice(0, 40), w: Math.max(1, o.w | 0), h: Math.max(1, o.h | 0), parts };
    S.meta.blueprints.push(bp);
    return bp;
  } catch (e) { return null; }
}
export const missingParts = (bp) => bp.parts.filter((p) => !E.unlocked(p.t)).map((p) => p.t);

/* ---------- Directives ---------- */
export function newDirective() { return { on: true, conds: [{ k: "glowX", x: 2 }], act: { k: "levels", type: "wellspring", amount: 1 }, fired: 0 }; }
function actionCostL(a) {
  if (a.k === "levels") return levelCostL(a.type, a.amount === "ms" ? Math.max(1, 25 - (E.level(a.type) % 25)) : a.amount || 1);
  if (a.k === "claim") { const f = cheapestFrontier(); return f ? f.cost : Infinity; }
  if (a.k === "workshop") return E.workshopCostL(a.ws);
  if (a.k === "blueprint") { const bp = S.meta.blueprints.find((b) => b.id === a.bp); if (!bp) return Infinity; let c = ZERO; for (const p of bp.parts) c = lAdd(c, buildCostL(p.t)); return c; }
  return ZERO;
}
function condOk(c, a) {
  switch (c.k) {
    case "glowX": { const cost = actionCostL(a); return cost !== Infinity && lGte(S.season.glow, cost + Math.log10(Math.max(1, c.x || 1))); }
    case "combo": return (RT.hearths || []).some((h) => h.combo >= (c.n || 0));
    case "seasonT": return S.season.seasonT >= (c.t || 0) * 60;
    case "harvestX": { const g = E.harvestGainL(); if (g === ZERO) return false; return S.eclipse.seeds === ZERO ? true : lGte(g, S.eclipse.seeds + Math.log10(Math.max(0.001, c.x || 1))); }
    case "weather": return E.weatherOf(c.b || "meadow") === c.w;
    case "day": return E.isDay();
    case "night": return !E.isDay();
    case "bloom": return Object.values(S.season.plots).some((p) => p.bloom >= (c.n || 0));
    case "rush": return S.rush.meter >= (c.n || 0);
  }
  return false;
}
export function actionAllowed(k) {
  if (k === "harvest") return !!E.tree("selfseed");
  if (k === "eclipse") return E.constellationOn("crown") || !!E.cosmos("autoeclipse");
  return true;
}
function doAction(a) {
  switch (a.k) {
    case "levels": return buyLevels(a.type, a.amount || 1) > 0;
    case "blueprint": { const bp = S.meta.blueprints.find((b) => b.id === a.bp); if (!bp) return false; return stampBlueprint(bp, a.x || 0, a.y || 0, a.rot || 0) > 0; }
    case "claim": { const f = cheapestFrontier(); return f ? claim(f.px, f.py) : false; }
    case "workshop": { const cost = E.workshopCostL(a.ws); if (!E.workshopOpen(a.ws) || !lGte(S.season.glow, cost)) return false; S.season.glow = lSub(S.season.glow, cost); S.season.workshop[a.ws] = E.ws(a.ws) + 1; RT.lastGlobalAt = -1; RT.layoutDirty = true; return true; }
    case "group": { let n = 0; for (const c of S.season.copies) if (c.group && c.group === a.group) { const off = a.state === "off"; if (!!c.off !== off) { c.off = off; n++; } } return n > 0; }
    case "filter": { let n = 0; for (const c of S.season.copies) if (c.type === "splitter" && c.group === a.group) { c.filter = a.filter || null; n++; } return n > 0; }
    case "jar": return !!openJar();
    case "harvest": return actionAllowed("harvest") && harvest();
    case "eclipse": return actionAllowed("eclipse") && beginEclipse();
  }
  return false;
}
export function directivesTick() {
  const slots = directiveSlots();
  const list = S.directives.slice(0, slots);
  for (const d of list) {
    if (!d.on || !d.act) continue;
    if (!actionAllowed(d.act.k)) continue;
    if (!d.conds.slice(0, 3).every((c) => condOk(c, d.act))) continue;
    if (doAction(d.act)) d.fired = (d.fired || 0) + 1;
  }
}
export { JOBS, WORKSHOP, LAWS, N, getPlot, owned, sell };

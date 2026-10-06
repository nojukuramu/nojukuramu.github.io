/* auto.js — the automation, and the intelligence that lets one hand hold a large realm.
 *
 * Two jobs.
 *
 * Intel. Every enemy you have seen becomes part of a contact: a cluster with
 * a position, a heading, a size and the time you last saw it. Contacts stay
 * on the map after they leave your sight, fading, so a wave that walks into
 * the dark is still a mark moving on the minimap. Radar adds what radar can
 * hear but nobody can see. Alerts are the other half: anything of yours that
 * is struck makes one, at most one per place every few seconds.
 *
 * Doctrines. Each is a researched habit (data.js DOCTRINES) with a switch in
 * the Automation panel: workers who find their own work, houses raised before
 * supply runs out, soldiers who answer alarms, a research plan, a high
 * command that strikes when the army is ready. None of them play the game for
 * you; each one takes away a thing you would otherwise do a hundred times. */

import { G, emit, on } from "./state.js";
import { TILE, BUILDINGS, LINES, supplyMax, TECH_CATS, DOCTRINES } from "./data.js";
import { near, own, spawnUnit, canAfford, rectDist, lvl } from "./entities.js";
import { setOrder, moveGroup, nearestDrop, isMilitary } from "./units.js";
import { canPlace, startBuilding, act, actions, inTerritory } from "./buildings.js";
import { explored, seen } from "./fog.js";
import { T } from "./world.js";
import { liveBases } from "./enemy.js";
import { updateSquads } from "./squads.js";
import { bldCost, TRAINED } from "./data.js";

export function defaultAuto() {
  return {
    foreman: true, quarter: true, repair: true, signal: true, census: true, workerTarget: 24,
    ratio: { gold: 40, wood: 40, stone: 20 }, keep: {}, keepRefit: false, keepLevels: false, keepEra: false,
    command: false, commandAt: 40, muster: null, drones: true, satellite: true, overmind: true,
    captains: true, masons: true, sentinels: true, colonists: true, standing: false, rebirth: true, demand: false,
    army: { target: 40, mix: { melee: 3, ranged: 3, mender: 1, mounted: 2, siege: 1, naval: 0, air: 1 } },
    wake: false, wakeAt: 10
  };
}
export const has = (id) => !!G.doctrines[id] && G.auto[id] !== false;

/* ---------------- alerts ---------------- */
on("hit", (t, dmg, by) => {
  if (!t || t.team !== 0 || !by || by.team === 0) return;
  const A = G.intel.alerts;
  for (let i = A.length - 1; i >= 0; i--) {
    const a = A[i];
    if (G.time - a.t > 15) break;
    if (Math.hypot(a.x - t.x, a.y - t.y) < 12 * TILE) { a.t = G.time; a.n++; return; }
  }
  const a = { id: G.intel.nextContact++, x: t.x, y: t.y, t: G.time, t0: G.time, n: 1, kind: t.kind, what: t.kind === "bld" ? BUILDINGS[t.type].names[t.level - 1] : t.hero ? "a champion" : LINES[t.line].names[t.tier] };
  A.push(a);
  if (A.length > 24) A.shift();
  emit("alert", a);
});

/* ---------------- contacts ---------------- */
function updateIntel() {
  const C = G.intel.contacts;
  const radars = own("radar");
  const cell = 10 * TILE, groups = new Map();
  for (const u of G.units) {
    if (u.dead || u.team !== 1) continue;
    let src = 0;
    if (seen(u)) src = 2;
    else for (const r of radars) if (Math.hypot(r.x - u.x, r.y - u.y) < (BUILDINGS.radar.detect + 4 * (r.level - 6)) * TILE) { src = 1; break; }
    if (!src) continue;
    const k = Math.floor(u.x / cell) * 100003 + Math.floor(u.y / cell);
    let g = groups.get(k);
    if (!g) groups.set(k, g = { x: 0, y: 0, n: 0, str: 0, src: 0, air: 0 });
    g.x += u.x; g.y += u.y; g.n++; g.str += (u.st.atk / u.st.cd) * u.maxHp; g.src = Math.max(g.src, src); if (u.st.air) g.air++;
  }
  const used = new Set();
  for (const g of groups.values()) {
    g.x /= g.n; g.y /= g.n;
    let best = null, bd = 14 * TILE;
    for (const c of C) { if (used.has(c.id)) continue; const d = Math.hypot(c.x - g.x, c.y - g.y); if (d < bd) { bd = d; best = c; } }
    if (best) {
      const dt = Math.max(0.5, G.time - best.seen);
      const vx = (g.x - best.x) / dt, vy = (g.y - best.y) / dt;
      best.vx = best.vx * 0.6 + vx * 0.4; best.vy = best.vy * 0.6 + vy * 0.4;
      best.x = g.x; best.y = g.y; best.n = g.n; best.str = g.str; best.seen = G.time; best.src = g.src; best.air = g.air;
      used.add(best.id);
    } else {
      const c = { id: G.intel.nextContact++, x: g.x, y: g.y, vx: 0, vy: 0, n: g.n, str: g.str, seen: G.time, first: G.time, src: g.src, air: g.air };
      C.push(c); used.add(c.id);
      if (g.n >= 4) emit("contact", c);
    }
  }
  // contacts that fell out of sight keep drifting along their last heading, a little, then fade
  G.intel.contacts = C.filter((c) => {
    const age = G.time - c.seen;
    if (age > 0.6 && age < 20) { c.x += c.vx * 0.5 * 0.5; c.y += c.vy * 0.5 * 0.5; }
    return age < 120;
  });
}
/** Where a contact is heading, if the Watchmen are trained: the nearest thing of yours along its course. */
export function headingOf(c) {
  if (!G.doctrines.watch) return null;
  const sp = Math.hypot(c.vx, c.vy);
  if (sp < 4) return null;
  const hx = c.vx / sp, hy = c.vy / sp;
  let best = null, bs = 1e18;
  for (const b of G.blds) {
    if (b.dead || b.team !== 0) continue;
    const dx = b.x - c.x, dy = b.y - c.y, along = dx * hx + dy * hy;
    if (along <= 0) continue;
    const off = Math.abs(dx * hy - dy * hx);
    const s = off * 3 + along;
    if (off < 10 * TILE && s < bs) { bs = s; best = b; }
  }
  return best ? { to: best, eta: Math.hypot(best.x - c.x, best.y - c.y) / sp } : { to: null, x: c.x + hx * 30 * sp, y: c.y + hy * 30 * sp };
}

/* ---------------- doctrines ---------------- */
function workers() { return G.units.filter((u) => !u.dead && u.team === 0 && u.line === "worker" && !u.hero && !u.manual); }
function foreman() {
  const ws = workers();
  const count = { gold: 0, wood: 0, stone: 0 };
  for (const w of ws) if (w.order.t === "gather") count[w.order.res]++;
  for (const w of ws) {
    if (w.order.t !== "idle" || w.idleT < 2.5 || w.oq.length) continue;
    if (w.carry) { setOrder(w, { t: "return" }); continue; }
    const res = pickRes(count, ws.length);
    if (assign(w, res) || assign(w, "wood") || assign(w, "gold")) count[w.order.res]++;
  }
}
/** What the realm is waiting for: everything a building offers but cannot pay for, by resource. */
export function demand() {
  const need = { gold: 0, wood: 0, stone: 0 };
  for (const b of G.blds) {
    if (b.dead || b.team !== 0 || b.built < 1) continue;
    for (const a of actions(b)) {
      if (a.ok || a.why !== "Not enough resources" || !a.cost) continue;
      for (const r in need) need[r] += Math.max(0, Math.min(5000, (a.cost[r] || 0) - G.res[r]));
    }
  }
  return need;
}
let demandCache = null, demandAt = -99;
function pickRes(count, total) {
  let R = G.doctrines.governor ? G.auto.ratio : { gold: 45, wood: 45, stone: 10 };
  // Stewards following demand lean the split towards whatever the realm is short of
  if (G.doctrines.governor && G.auto.demand) {
    if (G.time - demandAt > 10) { demandCache = demand(); demandAt = G.time; }
    const sum = demandCache.gold + demandCache.wood + demandCache.stone;
    if (sum > 0) R = { gold: R.gold * 0.4 + 60 * demandCache.gold / sum, wood: R.wood * 0.4 + 60 * demandCache.wood / sum, stone: R.stone * 0.4 + 60 * demandCache.stone / sum };
  }
  const sum = R.gold + R.wood + R.stone || 1;
  let best = "wood", bd = -1e9;
  for (const r of ["gold", "wood", "stone"]) {
    const want = R[r] / sum * (total + 1), d = want - count[r];
    if (d > bd) { bd = d; best = r; }
  }
  return best;
}
function assign(w, res) {
  if (res === "wood") {
    const drop = nearestDrop(w, "wood");
    const from = drop || w;
    const t = G.world.nearestTree(Math.floor(from.x / TILE), Math.floor(from.y / TILE), 22, (x, y) => !explored(x, y));
    if (!t) return false;
    setOrder(w, { t: "gather", res: "wood", tx: t.tx, ty: t.ty });
    return true;
  }
  let best = null, bd = 1e18;
  for (const n of G.world.nodes.values()) {
    if (n.type !== res || n.amount <= 0 || !explored(n.tx, n.ty)) continue;
    let dd = 1e18;
    for (const b of G.blds) if (!b.dead && b.team === 0 && b.built >= 1 && BUILDINGS[b.type].drop && BUILDINGS[b.type].drop.includes(res)) dd = Math.min(dd, rectDist(n.x, n.y, b));
    if (dd > 22 * TILE) continue;
    const d = Math.hypot(n.x - w.x, n.y - w.y) + dd;
    if (d < bd) { bd = d; best = n; }
  }
  if (!best) return false;
  setOrder(w, { t: "gather", res, node: best.id });
  return true;
}

function quarter() {
  const S = G.supply;
  if (S.cap >= supplyMax(G.era)) return;
  if (S.cap - S.used > 3 + Math.floor(S.cap / 18)) return;
  if (G.blds.some((b) => !b.dead && b.team === 0 && b.type === "house" && b.built < 1)) return;
  const hall = own("hall")[0] || own("outpost")[0];
  if (!hall) return;
  if (!canAfford({ wood: 60 })) return;
  const spot = findSpot("house", hall);
  if (!spot) return;
  const w = nearestWorker(spot.tx * TILE, spot.ty * TILE);
  if (!w) return;
  if (startBuilding("house", spot.tx, spot.ty, [w])) emit("toast", "A house is going up", "auto");
}
export function findSpot(type, around) {
  const d = BUILDINGS[type];
  const cx = Math.floor(around.x / TILE), cy = Math.floor(around.y / TILE);
  for (let r = 4; r < 18; r++) {
    for (let k = 0; k < r * 8; k++) {
      const a = k / (r * 8) * Math.PI * 2 + r;
      const tx = Math.round(cx + Math.cos(a) * r) - (d.w >> 1), ty = Math.round(cy + Math.sin(a) * r) - (d.h >> 1);
      if (!canPlace(type, tx, ty, 0).ok) continue;
      // leave a lane round every building
      let clear = true;
      for (let j = -1; j <= d.h && clear; j++) for (let i = -1; i <= d.w; i++) if (G.world.occ(tx + i, ty + j)) { clear = false; break; }
      if (clear) return { tx, ty };
    }
  }
  return null;
}
function nearestWorker(x, y) {
  let best = null, bd = 1e18;
  for (const w of workers()) {
    if (w.order.t === "build" || w.order.t === "repair" || w.hidden) continue;
    const d = Math.hypot(w.x - x, w.y - y) + (w.order.t === "idle" ? 0 : 300) + (w.carry ? 200 : 0);
    if (d < bd) { bd = d; best = w; }
  }
  return best;
}

function repair() {
  for (const b of G.blds) {
    if (b.dead || b.team !== 0 || b.built < 1 || b.hp > b.maxHp * 0.85 || G.time - b.lastHit < 8) continue;
    if (!inTerritory(b.tx, b.ty, b.w, b.h, 0) && b.type !== "outpost") continue;
    const on = G.units.filter((u) => !u.dead && u.order.t === "repair" && u.order.id === b.id).length;
    if (on >= 2) continue;
    const w = nearestWorker(b.x, b.y);
    if (w && Math.hypot(w.x - b.x, w.y - b.y) < 30 * TILE) setOrder(w, { t: "repair", id: b.id });
  }
}

function signal() {
  for (const a of G.intel.alerts) {
    if (G.time - a.t > 6 || a.answered) continue;
    a.answered = true;
    const r = 30 * TILE;
    const go = G.units.filter((u) => isMilitary(u) && u.team === 0 && !u.manual && !u.hero && u.stance === "aggr" && (u.order.t === "idle" || u.order.t === "guard") && Math.hypot(u.x - a.x, u.y - a.y) < r);
    if (!go.length) continue;
    for (const u of go) if (!u.post) u.post = { x: u.x, y: u.y, since: G.time };
    moveGroup(go, a.x, a.y, "amove");
    emit("toast", go.length + " answering the alarm", "auto");
  }
  // and when it is quiet again, back to where they were
  for (const u of G.units) {
    if (!u.post || u.dead || u.order.t !== "idle" || G.time - u.post.since < 25 || u.idleT < 8) continue;
    const p = u.post; u.post = null;
    setOrder(u, { t: "move", x: p.x, y: p.y });
  }
}

function census() {
  const ws = workers().length;
  let queued = 0;
  const halls = G.blds.filter((b) => !b.dead && b.team === 0 && (b.type === "hall" || b.type === "outpost") && b.built >= 1);
  for (const h of halls) queued += h.q.filter((it) => it.line === "worker").length;
  if (ws + queued >= G.auto.workerTarget) return;
  for (const h of halls) {
    if (h.q.length) continue;
    if (act(h, "train:worker")) return;
  }
}

function bureau() {
  const keep = G.auto.keep;
  const wanted = (a) => (a.kind === "tech" && keep[a.cat]) || (a.kind === "refit" && G.auto.keepRefit) || (a.kind === "level" && G.auto.keepLevels) || (a.kind === "era" && G.auto.keepEra);
  for (const b of G.blds) {
    if (b.dead || b.team !== 0 || b.built < 1 || b.q.length) continue;
    for (const a of actions(b)) {
      if (!wanted(a) || !a.ok) continue;
      if (act(b, a.id)) break;
    }
  }
}

function command() {
  if (!G.auto.command) return;
  const army = G.units.filter((u) => isMilitary(u) && u.team === 0 && !u.manual && !u.free && u.order.t === "idle" && u.stance === "aggr");
  let sup = 0;
  for (const u of army) sup += u.hero ? 4 : LINES[u.line].supply;
  if (sup < G.auto.commandAt) return;
  // the nearest enemy building you know of, belonging to a base still standing
  let tgt = null, bd = 1e18;
  const live = new Set(liveBases().map((b) => b.id));
  for (const gh of G.ghosts.values()) {
    const b = G.ents.get(gh.id);
    if (!b || b.dead || !live.has(b.base)) continue;
    const d = army.reduce((a, u) => a + Math.hypot(u.x - b.x, u.y - b.y), 0) / army.length;
    if (d < bd) { bd = d; tgt = b; }
  }
  if (!tgt) return;
  moveGroup(army, tgt.x, tgt.y, "amove");
  emit("toast", "High Command: " + army.length + " marching on a known base", "auto");
}

let satAt = 0, droneAt = 0;
function satellite() {
  if (G.time < satAt) return;
  satAt = G.time + 45;
  let t = G.intel.contacts.filter((c) => G.time - c.seen > 2).sort((a, b) => b.n - a.n)[0];
  let x, y;
  if (t) { x = t.x; y = t.y; }
  else {
    const base = liveBases().find((b) => !G.ghosts.has(b.core));
    if (base) { x = base.x + (Math.random() - 0.5) * 20 * TILE; y = base.y + (Math.random() - 0.5) * 20 * TILE; }
    else { const b = G.world.bounds; x = (b.x0 + Math.random() * (b.x1 - b.x0)) * TILE; y = (b.y0 + Math.random() * (b.y1 - b.y0)) * TILE; }
  }
  G.temp.push({ x, y, r: 14, until: G.time + 8 });
  emit("scan", x, y);
}
function drones() {
  if (G.time < droneAt) return;
  droneAt = G.time + 30;
  const want = 2 + Math.max(0, G.era - 7) * 2;
  const have = G.units.filter((u) => !u.dead && u.drone).length;
  if (have >= want) return;
  const hall = own("hall")[0] || own("outpost")[0];
  if (!hall) return;
  const u = spawnUnit("air", Math.max(7, G.era), 0, hall.x, hall.y, { free: true, drone: true, stance: "scout" });
  u.st.atk *= 0.25; u.st.sight += 3;
  setOrder(u, { t: "scout" });
}
function overmind() {
  const healers = G.units.filter((u) => !u.dead && u.team === 0 && u.line === "mender");
  for (const u of G.units) {
    if (u.dead || u.team !== 0 || u.manual || u.hero || !isMilitary(u) || u.retreating > G.time || u.st.mech) continue;
    if (u.hp / u.maxHp > 0.3 || G.time - u.lastHit > 3) continue;
    let to = null, bd = 30 * TILE;
    for (const h of healers) { const d = Math.hypot(h.x - u.x, h.y - u.y); if (d < bd && d > 3 * TILE) { bd = d; to = h; } }
    if (!to) continue;
    u.retreating = G.time + 12;
    setOrder(u, { t: "move", x: to.x, y: to.y });
  }
}

/* ---------------- Masons: raise again what was destroyed ---------------- */
on("death", (b) => {
  if (b.kind !== "bld" || b.team !== 0 || b.built < 1 || BUILDINGS[b.type].unique && b.type !== "altar" && b.type !== "academy") return;
  const R = G.rebuild || (G.rebuild = []);
  R.push({ type: b.type, tx: b.tx, ty: b.ty, at: G.time });
  if (R.length > 60) R.shift();
});
function masons() {
  const R = G.rebuild || [];
  for (let i = 0; i < R.length; i++) {
    const p = R[i];
    if (G.time - p.at < 20) continue;   // let the fighting move on first
    let hot = false;
    for (const u of G.units) if (!u.dead && u.team !== 0 && Math.hypot(u.x - (p.tx + 1) * TILE, u.y - (p.ty + 1) * TILE) < 12 * TILE) { hot = true; break; }
    if (hot) continue;
    const c = canPlace(p.type, p.tx, p.ty, 0);
    if (!c.ok) { if (c.why !== "Not enough resources" && G.time - p.at > 600) { R.splice(i, 1); i--; } continue; }
    if (!canAfford(bldCost(p.type))) continue;
    const w = nearestWorker((p.tx + 1) * TILE, (p.ty + 1) * TILE);
    if (!w) return;
    if (startBuilding(p.type, p.tx, p.ty, [w])) { R.splice(i, 1); emit("toast", "Masons are raising a " + BUILDINGS[p.type].names[0].toLowerCase() + " again", "auto"); return; }
  }
}

/* ---------------- Sentinels: a tower where the alarms keep ringing ---------------- */
const sentinelCool = new Map();
function sentinels() {
  const A = G.intel.alerts.filter((a) => G.time - a.t0 < 180);
  const cells = new Map();
  for (const a of A) { const k = Math.floor(a.x / (10 * TILE)) * 10007 + Math.floor(a.y / (10 * TILE)); const c = cells.get(k) || { n: 0, x: a.x, y: a.y, k }; c.n += a.n; cells.set(k, c); }
  for (const c of cells.values()) {
    if (c.n < 4 || (sentinelCool.get(c.k) || -1e9) > G.time) continue;
    if (G.blds.some((b) => !b.dead && b.team === 0 && b.type === "tower" && Math.hypot(b.x - c.x, b.y - c.y) < 7 * TILE)) continue;
    if (!canAfford(bldCost("tower"))) return;
    const spot = findSpot("tower", c);
    const w = spot && nearestWorker(c.x, c.y);
    if (!w) continue;
    sentinelCool.set(c.k, G.time + 240);
    if (startBuilding("tower", spot.tx, spot.ty, [w])) { emit("toast", "Sentinels: a tower goes up where the alarms ring", "auto"); return; }
  }
}

/* ---------------- Colonists: an outpost by a vein too far to carry from ---------------- */
function colonists() {
  if (G.blds.some((b) => !b.dead && b.team === 0 && b.type === "outpost" && b.built < 1)) return;
  if (!canAfford(bldCost("outpost"))) return;
  const mine = G.blds.filter((b) => !b.dead && b.team === 0);
  const drops = mine.filter((b) => b.built >= 1 && BUILDINGS[b.type].drop);
  let best = null, bs = -1e18;
  for (const n of G.world.nodes.values()) {
    if ((n.type !== "gold" && n.type !== "stone") || n.amount < 600 || !explored(n.tx, n.ty)) continue;
    let dd = 1e18; for (const b of drops) dd = Math.min(dd, rectDist(n.x, n.y, b));
    if (dd < 14 * TILE) continue;
    let dm = 1e18; for (const b of mine) dm = Math.min(dm, Math.hypot(b.x - n.x, b.y - n.y));
    if (dm > 48 * TILE) continue;
    let danger = false;
    for (const gh of G.ghosts.values()) if (Math.hypot((gh.tx + 1) * TILE - n.x, (gh.ty + 1) * TILE - n.y) < 20 * TILE) { danger = true; break; }
    if (danger) continue;
    const s = n.amount / 1000 - dm / TILE * 0.2;
    if (s > bs) { bs = s; best = n; }
  }
  if (!best) return;
  const spot = findSpot("outpost", best);
  const w = spot && nearestWorker(best.x, best.y);
  if (w && startBuilding("outpost", spot.tx, spot.ty, [w])) emit("toast", "Colonists set out to raise an outpost by a far vein", "auto");
}

/* ---------------- Standing Army: keep the army at its size and mix ---------------- */
export function armySupply() {
  let n = 0;
  for (const u of G.units) if (!u.dead && u.team === 0 && isMilitary(u) && !u.hero && !u.free) n += LINES[u.line].supply;
  for (const b of G.blds) if (!b.dead && b.team === 0) for (const it of b.q) if (it.k === "unit" && it.line !== "worker") n += LINES[it.line].supply;
  return n;
}
function standing() {
  const A = G.auto.army;
  if (armySupply() >= A.target) return;
  const have = {};
  for (const u of G.units) if (!u.dead && u.team === 0 && isMilitary(u) && !u.hero && !u.free) have[u.line] = (have[u.line] || 0) + 1;
  const total = Object.values(have).reduce((a, b) => a + b, 0) + 1;
  const wsum = Object.values(A.mix).reduce((a, b) => a + b, 0) || 1;
  for (const b of G.blds) {
    if (b.dead || b.team !== 0 || b.built < 1 || b.q.length) continue;
    const lines = (BUILDINGS[b.type].trains || []).filter((l) => l !== "worker" && LINES[l].first <= G.era && (A.mix[l] || 0) > 0);
    if (!lines.length) continue;
    lines.sort((x, y) => ((have[y] || 0) / total - A.mix[y] / wsum) - ((have[x] || 0) / total - A.mix[x] / wsum)).reverse();
    for (const l of lines) if (act(b, "train:" + l)) { have[l] = (have[l] || 0) + 1; break; }
    if (armySupply() >= A.target) return;
  }
}

/* ---------------- Rebirth: champions called back ---------------- */
function rebirth() {
  const altar = G.blds.find((b) => !b.dead && b.team === 0 && b.type === "altar" && b.built >= 1 && !b.q.length);
  if (!altar) return;
  for (const id in G.heroes) if (G.heroes[id].dead && act(altar, "hero:" + id)) { emit("toast", "The altar calls a champion back", "auto"); return; }
}

/* ---------------- waking you up ---------------- */
let wakeCool = -99;
const woke = new Set();
function wake() {
  if (G.time < wakeCool) return;
  const homes = G.blds.filter((b) => !b.dead && b.team === 0 && (b.type === "hall" || b.type === "outpost"));
  for (const c of G.intel.contacts) {
    if (woke.has(c.id) || c.n < G.auto.wakeAt || G.time - c.seen > 3) continue;
    if (!homes.some((h) => Math.hypot(h.x - c.x, h.y - c.y) < 26 * TILE)) continue;
    woke.add(c.id); wakeCool = G.time + 90;
    G.paused = true;
    emit("wake", c);
    return;
  }
}

on("phase", (n, line, bases) => {
  if (!G.doctrines.continuum) return;
  for (const b of bases) G.temp.push({ x: b.x, y: b.y, r: 12, until: G.time + 25 });
});

export function updateAuto() {
  if (!G.auto) return;
  const t = G.tick;
  if (t % 5 === 0) updateIntel();
  if (t % 10 === 0) {
    if (has("foreman")) foreman();
    if (has("signal")) signal();
    if (has("overmind")) overmind();
  }
  if (t % 20 === 3) {
    if (has("quarter")) quarter();
    if (has("repair")) repair();
    if (has("census")) census();
    if (G.doctrines.bureau) bureau();
  }
  if (t % 100 === 7 && G.doctrines.command) command();
  if (t % 10 === 2) updateSquads();
  if (t % 20 === 11) {
    if (has("masons")) masons();
    if (has("sentinels")) sentinels();
    if (has("standing")) standing();
    if (has("rebirth")) rebirth();
  }
  if (t % 200 === 17 && has("colonists")) colonists();
  if (t % 5 === 1 && G.auto.wake) wake();
  if (t % 10 === 5) {
    if (has("satellite")) satellite();
    if (has("drones")) drones();
  }
}
export { TECH_CATS, DOCTRINES, lvl, near, T };

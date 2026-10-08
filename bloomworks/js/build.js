/* build.js — putting contraptions down, picking them up, and the layout.
 *
 * A copy is a plain object in S.season.copies: where it stands, which way it
 * faces, what it carries. Everything a copy gets from where it stands — the
 * tile under it, its plot's Bloom and biome, Kilns beside it, Lanterns and
 * Chimes around it — is worked out once in rebuildLayout() and cached on the
 * copy as `k`, because a layout changes when you build and not otherwise.
 * The simulation reads `k`; it never searches the map in its hot loop. */

import { S, RT, tk, pk } from "./state.js";
import { ZERO, lGte, lSub, lAdd } from "./num.js";
import { TYPES, DX, DY, WONDERS } from "./data.js";
import { T, tileAt, getPlot, plotOfTile, plotSize, owned, claimable, ringOf, hasLaw, nodeAt, localIndex } from "./world.js";
import { buildCostL, unlocked, count, countFam, claimCostL, rockCostL, digCostL, lanternRadius, lanternPower, sprinklerRadius, chimeRadius, inTrial, tree, cosmos } from "./econ.js";

export const sizeOf = (type) => TYPES[type].size;

/** The tile a copy pushes motes into: the middle of the side it faces. */
export function outTile(c) {
  const n = sizeOf(c.type), off = (n - 1) >> 1;
  switch (c.rot) {
    case 0: return [c.x + n, c.y + off];
    case 1: return [c.x + n - 1 - off, c.y + n];
    case 2: return [c.x - 1, c.y + n - 1 - off];
    default: return [c.x + off, c.y - 1];
  }
}
export function footprint(type, x, y) {
  const n = sizeOf(type), out = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push([x + i, y + j]);
  return out;
}
export const copyAt = (x, y) => RT.occ.get(tk(x, y)) || null;
export const centre = (c) => { const n = sizeOf(c.type); return [c.x + n / 2, c.y + n / 2]; };
/** Chebyshev distance from a tile to a copy's footprint. */
export function distTo(c, x, y) {
  const n = sizeOf(c.type);
  const dx = x < c.x ? c.x - x : x > c.x + n - 1 ? x - (c.x + n - 1) : 0;
  const dy = y < c.y ? c.y - y : y > c.y + n - 1 ? y - (c.y + n - 1) : 0;
  return Math.max(dx, dy);
}

/** Why a type cannot go here, or "" if it can. */
export function whyNot(type, x, y, ignore) {
  const Ty = TYPES[type];
  if (!Ty) return "Unknown contraption.";
  if (!unlocked(type)) return "Not discovered yet.";
  if (Ty.fam === "wonder" && S.season.copies.some((c) => c.type === type && c !== ignore)) return "You can place one copy of each Wonder.";
  if (Ty.fam === "heart") {
    if (S.season.copies.some((c) => c.type === type && c !== ignore)) return "There is one World Heart.";
    const [px, py] = plotOfTile(x, y), [qx, qy] = plotOfTile(x + 4, y + 4);
    if (px !== 0 || py !== 0 || qx !== 0 || qy !== 0) return "The World Heart grows in the Home Plot.";
  }
  if (type === "hearth" || type === "singularity") {
    if (hasLaw("lonely") && countFam("hearth") - (ignore && TYPES[ignore.type].fam === "hearth" ? 1 : 0) >= 1) return "Lonely Hearth: one Hearth only.";
  }
  if (inTrial("solitude")) {
    const fam = Ty.fam;
    if ((fam === "source" || fam === "hearth") && countFam(fam) - (ignore && TYPES[ignore.type].fam === fam ? 1 : 0) >= 1) return "Solitude: one Source and one Hearth.";
  }
  if (inTrial("rails") && (type === "launcher" || type === "warppipe" || type === "cometlauncher")) return "Rails: no Launchers or Warp Pipes.";
  if (inTrial("silence") && type === "chime") return "Silence: no Chimes.";
  let onNode = false, onRiver = 0;
  for (const [a, b] of footprint(type, x, y)) {
    const [px, py] = plotOfTile(a, b);
    if (!owned(px, py)) return "Claim this plot first.";
    const o = copyAt(a, b);
    if (o && o !== ignore) return "Something is already here.";
    const t = tileAt(a, b);
    if (t === T.rock) return "Clear the Rock first.";
    if (t === T.ruins) return "Excavate the Ruins first.";
    if (t === T.lake || t === T.cliff || t === T.gap) return "Nothing can stand on " + (t === T.lake ? "a Lake." : t === T.cliff ? "a Cliff." : "a Sky Gap.");
    if (t === T.river) { if (type !== "waterwheel") return "Only a Waterwheel stands on a River."; onRiver++; }
    if (t === T.node || t === T.star) { if (type !== "extractor") return "Only an Extractor sits on a Node."; onNode = true; }
    if (t === T.ice && type !== "track") return "Only Tracks run on Ice.";
  }
  if (type === "extractor" && !onNode) return "An Extractor must sit on a Node.";
  if (type === "waterwheel" && !onRiver) return "A Waterwheel must sit on a River.";
  return "";
}

let placedSeq = 0;
/** Place a copy. Pays for it unless free. Returns the copy, or null. */
export function place(type, x, y, rot, opts) {
  opts = opts || {};
  if (whyNot(type, x, y)) return null;
  const cost = opts.free ? ZERO : buildCostL(type);
  if (!lGte(S.season.glow, cost)) return null;
  S.season.glow = lSub(S.season.glow, cost);
  const c = { id: S.nextId++, type, x, y, rot: rot || 0, mods: [], paid: cost, order: opts.order != null ? opts.order : ++placedSeq + S.season.copies.length * 1000 };
  initCopy(c);
  S.season.copies.push(c);
  if (type === "warppipe") {
    // Pipes go down in pairs: a pipe with no partner waits for the next one.
    const lone = S.season.copies.find((o) => o !== c && o.type === "warppipe" && !o.link && !o.linkFrom);
    if (lone) { lone.link = c.id; c.linkFrom = lone.id; }
  }
  // A Ghost under the new copy is the plan it fulfils.
  S.season.ghosts = S.season.ghosts.filter((g) => !(g.type === type && g.x === x && g.y === y));
  if (TYPES[type].fam === "wonder") S.meta.discovered.wonders[type] = 1;
  RT.layoutDirty = true;
  rebuildLayout();
  return c;
}
export function initCopy(c) {
  c.inq = c.inq || []; c.outq = c.outq || []; c.work = c.work || 0;
  if (TYPES[c.type].fam === "hearth") { c.combo = c.combo || 0; c.wish = c.wish == null ? -1 : c.wish; c.wishAt = c.wishAt || 0; }
  if (c.type === "chime" || c.type === "echobell") c.charge = c.charge || 0;
  if (c.type === "fuser") c.bins = c.bins || {};
  if (c.type === "track") c.m = c.m || [];
}

/** Pick a copy up: 100% of what it cost comes back. */
export function remove(c, opts) {
  const i = S.season.copies.indexOf(c);
  if (i < 0) return;
  S.season.copies.splice(i, 1);
  if (!(opts && opts.noRefund)) S.season.glow = lAdd(S.season.glow, c.paid || ZERO);
  // Motes it held go to the ground beside it, never into nothing.
  const spill = [].concat(c.inq || [], c.outq || [], c.m || []);
  if (c.bins) for (const t in c.bins) spill.push(...c.bins[t]);
  for (const m of spill) addStray(c.x, c.y, m);
  for (const id of c.mods) { const m = S.meta.mods.find((q) => q.id === id); if (m) m.on = null; }
  for (const o of S.season.copies) { if (o.link === c.id) o.link = null; if (o.linkFrom === c.id) o.linkFrom = null; }
  RT.layoutDirty = true;
  rebuildLayout();
}
export function rotate(c) { c.rot = (c.rot + 1) & 3; RT.layoutDirty = true; rebuildLayout(); }
export function move(c, x, y) {
  if (whyNot(c.type, x, y, c)) return false;
  c.x = x; c.y = y; RT.layoutDirty = true; rebuildLayout(); return true;
}

export function addStray(x, y, m) {
  const P = plotSize();
  const [px, py] = plotOfTile(Math.floor(x), Math.floor(y));
  const key = pk(px, py);
  const strays = S.season.strays || (S.season.strays = []);
  let here = 0;
  for (const s of strays) if (s.plot === key) here++;
  if (here >= 50) {
    // Past fifty, a Stray turns into Bloom XP for its plot.
    const ps = S.season.plots[key];
    if (ps) ps.xp = lAdd(ps.xp, m.v);
    return;
  }
  delete m.p; delete m.d;
  strays.push({ x: x + 0.2 + Math.random() * 0.6, y: y + 0.2 + Math.random() * 0.6, m, plot: key });
  void P;
}

/* ---------- plots ---------- */
export function claim(px, py, opts) {
  if (!claimable(px, py) && !(opts && opts.force)) return false;
  const cost = opts && opts.free ? ZERO : claimCostL(px, py);
  if (!lGte(S.season.glow, cost)) return false;
  S.season.glow = lSub(S.season.glow, cost);
  const key = pk(px, py);
  const og = Math.max(S.eclipse.overgrowth[key] || 0, tree("deeproots") ? 1 : 0);
  S.season.plots[key] = { xp: og > 0 ? og + 1 : ZERO, bloom: inTrial("grey") ? 0 : og };
  const p = getPlot(px, py);
  S.meta.discovered.biomes[p.biome] = 1;
  RT.layoutDirty = true;
  return true;
}
/** Start each Season with Ring 1 claimed (Home Fields), or Ring 2 (Head Start). */
export function claimStartRings() {
  const r = cosmos("headstart") ? 2 : tree("ringstart") ? 1 : 0;
  for (let ring = 1; ring <= r; ring++)
    for (let a = -ring; a <= ring; a++) for (let b = -ring; b <= ring; b++)
      if (Math.max(Math.abs(a), Math.abs(b)) === ring) claim(a, b, { free: true, force: true });
}

export function clearRock(x, y) {
  if (tileAt(x, y) !== T.rock) return false;
  const [px, py] = plotOfTile(x, y);
  if (!owned(px, py)) return false;
  const cost = rockCostL(px, py);
  if (!lGte(S.season.glow, cost)) return false;
  S.season.glow = lSub(S.season.glow, cost);
  const key = pk(px, py), li = localIndex(x, y);
  const w = S.world;
  if (w.regrown && w.regrown[key] && w.regrown[key].includes(li)) w.regrown[key] = w.regrown[key].filter((i) => i !== li);
  else (w.cleared[key] = w.cleared[key] || []).push(li);
  RT.layoutDirty = true;
  return true;
}

export function startDig(px, py) {
  const key = pk(px, py), p = getPlot(px, py);
  if (!owned(px, py) || S.ruins[key]) return false;
  if (!S.hiddenRuins[key] && (!p.ruins || S.world.dug[key])) return false;
  const cost = digCostL(px, py);
  if (!lGte(S.season.glow, cost)) return false;
  S.season.glow = lSub(S.season.glow, cost);
  const secs = 120 + Math.min(8, p.ring) * 60;
  S.ruins[key] = { left: secs, total: secs };
  return true;
}

/* ---------- the layout cache ---------- */
export function rebuildLayout() {
  if (!RT.layoutDirty) return;
  RT.layoutDirty = false;
  RT.occ.clear(); RT.byId.clear(); RT.chimeAt.clear();
  const copies = S.season.copies;
  for (const c of copies) {
    initCopy(c);
    RT.byId.set(c.id, c);
    for (const [a, b] of footprint(c.type, c.x, c.y)) RT.occ.set(tk(a, b), c);
  }
  RT.tracks = []; RT.actors = []; RT.chimes = []; RT.lanterns = []; RT.sprinklers = []; RT.hearths = []; RT.huts = [];
  RT.sundials = new Set(); RT.clockPlots = new Set(); RT.orreryPlots = new Set(); RT.gravity = []; RT.rods = []; RT.wheels = new Map();
  for (const c of copies) {
    const f = TYPES[c.type].fam;
    if (c.type === "track") RT.tracks.push(c); else RT.actors.push(c);
    if (c.type === "chime" || c.type === "echobell") RT.chimes.push(c);
    if (c.type === "lantern") RT.lanterns.push(c);
    if (c.type === "sprinkler") RT.sprinklers.push(c);
    if (f === "hearth") RT.hearths.push(c);
    if (c.type === "tinkerhut") RT.huts.push(c);
    if (c.type === "gravity") RT.gravity.push(c);
    if (c.type === "stormrod") RT.rods.push(c);
    if (c.type === "waterwheel") RT.wheels.set(tk(c.x, c.y), c);
    const [px, py] = plotOfTile(c.x, c.y), key = pk(px, py);
    if (c.type === "sundial") RT.sundials.add(key);
    if (c.type === "clocktower") RT.clockPlots.add(key);
    if (c.type === "orrery") RT.orreryPlots.add(key);
  }
  const lr = lanternRadius(), lp = lanternPower(), sr = sprinklerRadius(), cr = chimeRadius();
  for (const c of copies) {
    const [px, py] = plotOfTile(c.x, c.y), key = pk(px, py);
    const p = getPlot(px, py);
    const k = { plot: key, biome: p.biome, rules: p.rules.length ? p.rules : null, ring: p.ring };
    const n = sizeOf(c.type);
    let ley = false, vent = false, crystal = false, star = false, voidKey = null;
    for (const [a, b] of footprint(c.type, c.x, c.y)) {
      const t = tileAt(a, b);
      if (t === T.ley) ley = true;
      if (t === T.vent) vent = true;
      if (t === T.crystal) crystal = true;
      if (t === T.star) star = true;
      if (t === T.void) voidKey = tk(a, b);
      if (t === T.ice) k.ice = true;
    }
    Object.assign(k, { ley, vent, crystal, star, voidKey });
    if (c.type === "extractor") {
      // The Node under it sets Hue, Tier and Richness; Wide Bore also draws from Nodes beside it.
      let node = null, extra = 0;
      for (const [a, b] of footprint(c.type, c.x, c.y)) { const nd = nodeAt(a, b); if (nd && (!node || nd.star)) node = nd; }
      for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) {
        if (i >= 0 && i < n && j >= 0 && j < n) continue;
        if (nodeAt(c.x + i, c.y + j)) extra++;
      }
      k.node = node; k.wideNodes = extra;
    }
    k.out = outTile(c);
    k.clock = RT.clockPlots.has(key);
    k.orrery = RT.orreryPlots.has(key);
    // Kiln heat: +20% Power for each Kiln next to it.
    if (c.type === "kiln" || c.type === "nebulakiln") {
      const seen = new Set();
      for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) {
        const o = copyAt(c.x + i, c.y + j);
        if (o && o !== c && (o.type === "kiln" || o.type === "nebulakiln")) seen.add(o.id);
      }
      k.kilns = seen.size;
    }
    let lan = 0;
    for (const l of RT.lanterns) if (l !== c && distTo(c, l.x, l.y) <= lr) lan += lp * (hasLaw("tinyplots") ? 2 : 1);
    k.lantern = lan;
    let spr = false;
    for (const s of RT.sprinklers) if (distTo(c, s.x, s.y) <= sr) { spr = true; break; }
    k.sprinkled = spr;
    // Chimes on the 8 tiles around: +1 Charge each time this copy finishes an action.
    k.adjChimes = RT.chimes.filter((ch) => ch !== c && distTo(c, ch.x, ch.y) === 1);
    c.k = k;
  }
  for (const ch of RT.chimes) {
    ch.k.inRange = copies.filter((o) => o !== ch && o.type !== "track" && distTo(o, ch.x, ch.y) <= cr);
    ch.k.nearChimes = RT.chimes.filter((o) => o !== ch && Math.max(Math.abs(o.x - ch.x), Math.abs(o.y - ch.y)) <= 3);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      if (!i && !j) continue;
      const key = tk(ch.x + i, ch.y + j);
      const list = RT.chimeAt.get(key);
      if (list) list.push(ch); else RT.chimeAt.set(key, [ch]);
    }
  }
  // A track's speed parts that do not change with time.
  for (const c of RT.tracks) {
    c.k.next = [c.x + DX[c.rot], c.y + DY[c.rot]];
  }
  // What feeds each Track, so the renderer can draw it joined to its neighbours.
  for (const c of RT.tracks) {
    const ins = [];
    for (let d = 0; d < 4; d++) {
      const o = copyAt(c.x - DX[d], c.y - DY[d]);
      if (!o) continue;
      if (o.type === "splitter") { if (d !== ((o.rot + 2) & 3)) ins.push(d); continue; }
      const [ox, oy] = o.k.out;
      if (ox === c.x && oy === c.y) ins.push(d);
    }
    c.k.ins = ins;
  }
  RT.layoutVersion = (RT.layoutVersion || 0) + 1;
}

/** Every wonder you can place now. */
export const wondersInHand = () => WONDERS.filter((w) => S.meta.discovered.wonders[w] && count(w) === 0);
export { ringOf };

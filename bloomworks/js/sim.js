/* sim.js — the mote loop.
 *
 * Every unit of value is a mote that moves on screen. A Source makes one, a
 * Track carries it, processors stamp it, a Fuser folds four into one, and a
 * Hearth sells it for Glow. This file is that loop and the spectacle that
 * rides on it (Combo, Lucky, Chimes and Chains, Rush), run at a fixed step.
 *
 * A mote is a small plain object:
 *   v  Value as log10      t  Tier            h  Hue bits (R=1, B=2, Y=4)
 *   s  Stamps as bits      L  Lucky level     c  Charged
 *   b  born (world time)   f  flags (1 = a Dune Skink has crossed it)
 *   p  progress across its tile, d  the way it came in (both while on a Track)
 *
 * The one rule that keeps motes honest: nothing here ever deletes a mote
 * except a Hearth (or the World Heart, or a Star Forge) taking it. Blocked
 * motes wait; motes off a path become Strays. */

import { S, RT, tk, pk } from "./state.js";
import { ZERO, L, lAdd, lGte, N } from "./num.js";
import { TYPES, DX, DY, HUES, primaries, PENTATONIC, HEART_STAGES } from "./data.js";
import { T, tileAt, riverFlow, plotOfTile, hasLaw } from "./world.js";
import * as E from "./econ.js";
import { copyAt, addStray, rebuildLayout, distTo, sizeOf } from "./build.js";
import * as fx from "./fx.js";

export const STEP = 1 / 30;
let hooks = { sale: null, lucky: null, chain: null, bloom: null, mod: null, heart: null };
export function on(name, fn) { hooks[name] = fn; }
const emit = (name, a, b, c) => { const h = hooks[name]; if (h) h(a, b, c); };

/* ---------- motes ---------- */
export function mote(v, t, h, born) { return { v, t: t || 1, h: h || 0, s: 0, L: 0, c: false, b: born == null ? S.t : born, f: 0 }; }
function seeHue(h) { RT.seenHues = RT.seenHues || new Set([0]); RT.seenHues.add(h); }

/** Roll for Lucky on a stamp. Each hit is one Lucky level: ×10 Value (×100 in a Drought). */
function rollLucky(c, m) {
  const ch = E.luckyChance(c);
  let lv = Math.floor(ch);
  if (Math.random() < ch - lv) lv++;
  if (!lv) return;
  m.L += lv;
  m.v += lv * E.luckyStepL();
  emit("lucky", c, m);
}

/** Bloom XP: the Value of every mote a contraption in the plot processes or sells. */
function bloomXp(c, vL) {
  const key = c.k.plot, ps = S.season.plots[key];
  if (!ps || E.inTrial("grey")) return;
  let x = vL + E.xpMulL(key);
  if (c.k.sprinkled) x += Math.log10(2);
  ps.xp = lAdd(ps.xp, x);
  RT.rate.xp.set(key, lAdd(RT.rate.xp.get(key) || ZERO, x));
  const lvl = ps.xp === ZERO ? 0 : Math.max(0, Math.floor(ps.xp + 1e-9) - 1);
  if (lvl > ps.bloom) {
    ps.bloom = lvl;
    RT.layoutDirty = true;
    emit("bloom", key, lvl, c);
  }
}

/* ---------- handing a mote on ----------
   offer() answers 1 (taken), 0 (full: wait) or -1 (nothing there to take it). */
export function offer(x, y, m, dir, from) {
  const c = RT.occ.get(tk(x, y));
  if (!c) {
    if (tileAt(x, y) === T.river) { float(x, y, m); return 1; }
    return -1;
  }
  if (c === from) return 0;
  if (c.type === "track") return trackTake(c, m, dir);
  if (c.type === "waterwheel") { wheelStamp(c, m); float(x, y, m); return 1; }
  return take(c, m, from);
}

function trackTake(c, m, dir) {
  const cap = E.trackCap();
  const q = c.m;
  if (q.length >= cap) return 0;
  if (q.length && q[q.length - 1].p < 1 / cap) return 0;
  m.p = 0; m.d = dir;
  q.push(m);
  if (m.c) { const near = RT.chimeAt.get(tk(c.x, c.y)); if (near) for (const ch of near) ch.charge += 3; }
  return 1;
}

function isOutTile(c, from) {
  if (!from || !c.k) return false;
  const [ox, oy] = c.k.out;
  return from.x <= ox && ox < from.x + sizeOf(from.type) && from.y <= oy && oy < from.y + sizeOf(from.type);
}

/** A contraption taking a mote into its input. */
function take(c, m, from) {
  if (c.off) return 0;
  const Ty = TYPES[c.type], fam = Ty.fam;
  if (isOutTile(c, from)) return 0;
  if (fam === "processor") {
    if ((m.s & Ty.stamp) || (c.type === "prism" && m.h !== 0)) {
      // Already stamped: through with no change and no wait.
      if (c.outq.length >= 3) return 0;
      c.outq.push(m); return 1;
    }
    if (c.inq.length >= 2) return 0;
    c.inq.push(m); return 1;
  }
  if (fam === "fuser") {
    if (m.t > E.maxFuseTier()) { if (c.outq.length >= 3) return 0; c.outq.push(m); return 1; }
    const bin = c.bins[m.t] || (c.bins[m.t] = []);
    if (bin.length >= 4) return 0;
    let total = 0; for (const t in c.bins) total += c.bins[t].length;
    if (total >= 12) return 0;
    bin.push(m); return 1;
  }
  if (fam === "hearth") { if (c.inq.length >= 6) return 0; c.inq.push(m); return 1; }
  if (fam === "heart") { if (c.inq.length >= 8) return 0; c.inq.push(m); return 1; }
  if (c.type === "starforge") { if (m.t < 10) return 0; if (c.inq.length >= 8) return 0; c.inq.push(m); return 1; }
  if (c.type === "launcher" || c.type === "cometlauncher" || c.type === "ferris" || c.type === "wishing" || c.type === "gravity") {
    if (c.inq.length >= 4) return 0; c.inq.push(m); return 1;
  }
  if (c.type === "warppipe") { if (!c.link || c.inq.length >= 4) return 0; c.inq.push(m); return 1; }
  if (c.type === "splitter") { if (c.inq.length >= 2) return 0; c.inq.push(m); return 1; }
  return -1;
}

/** Straight into a copy, by any side: a Courier's delivery. */
export function deliver(c, m) { return c.type === "track" ? trackTake(c, m, c.rot) : take(c, m, null); }

/* ---------- rivers ---------- */
function float(x, y, m) { delete m.p; RT.floating.push({ x, y, p: 0, m }); }
function wheelStamp(c, m) {
  if (m.s & TYPES.waterwheel.stamp) return;
  stampWith(c, m, Math.log10(E.procPower(c)));
  m.s |= TYPES.waterwheel.stamp;
}
function stepFloating(dt) {
  const F = RT.floating;
  for (let i = F.length - 1; i >= 0; i--) {
    const f = F[i];
    f.p += 1.5 * dt;
    if (f.p < 1) continue;
    const d = riverFlow(f.x, f.y);
    if (d < 0) { F.splice(i, 1); addStray(f.x, f.y, f.m); continue; }
    const nx = f.x + DX[d], ny = f.y + DY[d];
    const w = RT.wheels.get(tk(nx, ny));
    if (tileAt(nx, ny) === T.river && (!copyAt(nx, ny) || w)) {
      if (w) wheelStamp(w, f.m);
      f.x = nx; f.y = ny; f.p -= 1; continue;
    }
    const r = offer(nx, ny, f.m, d, null);
    if (r === 1) F.splice(i, 1);
    else if (r === -1) { F.splice(i, 1); addStray(f.x, f.y, f.m); }
    else f.p = 1;
  }
}

/* ---------- actions ---------- */
function stampWith(c, m, multL) {
  m.v += multL;
  rollLucky(c, m);
  bloomXp(c, m.v);
}
function chimeTick(c, n) {
  const adj = c.k.adjChimes;
  if (!adj || !adj.length) return;
  const extra = E.modSum(c, "resonant");
  for (const ch of adj) ch.charge += n * (1 + extra);
}

function emitMote(c, chainL) {
  const Ty = TYPES[c.type];
  const k = c.k;
  let hue = 0, tier = 1, v = E.sourceValueL(c);
  if (c.type === "extractor") {
    const nd = k.node;
    if (!nd) return false;
    hue = nd.hue; tier = nd.tier + (E.spec("extractor") === 0 ? 1 : 0);
    v += Math.log10(nd.rich);
    if (E.spec("extractor") === 1) v += Math.log10(1 + k.wideNodes);
  }
  if (c.type === "sundish") hue = 4;
  if (c.type === "moonwell") hue = 2;
  const m = mote(v + (chainL || 0), tier, hue);
  seeHue(hue);
  if (E.anyWeather("aurora") && 0) m.L = 0;
  c.outq.push(m);
  void Ty;
  return true;
}

/** One action of one copy. chainL is the Chain bonus when a Chime gave it. */
function act(c, chainL) {
  const Ty = TYPES[c.type], fam = Ty.fam;
  chainL = chainL || 0;
  if (fam === "source") {
    if (c.type === "stormrod") return false;
    if (c.type === "sundish" && !E.isDay(c.k.plot)) return false;
    if (c.type === "moonwell" && E.isDay(c.k.plot)) return false;
    if (c.type === "wellspring" && E.spec("wellspring") === 0 && !chainL) return false;   // Geyser bursts on its own clock
    if (c.outq.length >= 2) return false;
    return emitMote(c, chainL);
  }
  if (fam === "processor") {
    if (!c.inq.length || c.outq.length >= 3) return false;
    const m = c.inq.shift();
    if (c.type === "prism") {
      // A Plain mote becomes Red, Blue and Yellow at half Value each.
      const share = Math.log10(E.prismShare(c));
      for (const h of [1, 2, 4]) {
        const o = { v: m.v + share + chainL, t: m.t, h, s: m.s | Ty.stamp, L: m.L, c: m.c, b: m.b, f: m.f };
        rollLucky(c, o); seeHue(h);
        c.outq.push(o);
      }
      bloomXp(c, m.v);
      return true;
    }
    let mult = E.procPower(c);
    if (c.type === "engraver") mult = 1 + E.procPower(c) * popcount(m.s);
    if (c.type === "hourglass") { const age = S.t - m.b; mult = 1 + E.procPower(c) * age; if (age >= 120) emit("feat", "patience"); }
    if (c.type === "gardenpress") mult = 1 + E.procPower(c) * E.bloomOfPlot(c.k.plot);
    if (c.type === "mirror") mult = 1;
    stampWith(c, m, Math.log10(mult) + chainL);
    m.s |= Ty.stamp;
    if (c.type === "charger") { m.c = true; m.v += Math.log10(2); }
    c.outq.push(m);
    if (c.type === "mirror") {
      // A copy of the mote; above 100%, more than one.
      const ch = E.mirrorChance(c);
      let n = Math.floor(ch); if (Math.random() < ch - n) n++;
      for (let i = 0; i < n; i++) c.outq.push(Object.assign({}, m));
    }
    return true;
  }
  if (fam === "fuser") {
    if (c.outq.length >= 3) return false;
    let tier = 0;
    for (const t in c.bins) if (c.bins[t].length >= 4) { tier = +t; break; }
    if (!tier) return false;
    const ins = c.bins[tier].splice(0, 4);
    let v = ZERO, h = 0, st = ~0;
    for (const m of ins) { v = lAdd(v, m.v); h |= m.h; st &= m.s; }
    if (hasLaw("chaoshues")) h = [0, 1, 2, 4, 3, 6, 5, 7][Math.floor(Math.random() * 8)];
    v += Math.log10(E.fusionBonus(c) * E.hueBonus(h)) + chainL;
    const out = { v, t: tier + 1, h, s: st, L: 0, c: false, b: Math.min(...ins.map((m) => m.b)), f: 0 };
    seeHue(h);
    c.outq.push(out);
    bloomXp(c, v);
    const twin = (E.spec("fuser") === 0 ? 0.1 : 0) + 0.01 * E.modSum(c, "twin");
    if (twin && Math.random() < twin) c.outq.push(Object.assign({}, out));
    emit("fuse", c, out);
    return true;
  }
  if (fam === "hearth") {
    if (!c.inq.length) return false;
    sell(c, c.inq.shift(), chainL);
    return true;
  }
  if (fam === "heart") {
    if (!c.inq.length) return false;
    heartTake(c.inq.shift());
    return true;
  }
  if (c.type === "starforge") {
    if (!c.inq.length) return false;
    c.inq.shift();
    S.world.forge++;
    if (S.world.forge >= 1000) { S.world.forge -= 1000; S.world.forgeStars++; }
    return true;
  }
  if (c.type === "ferris") {
    if (!c.inq.length || c.outq.length >= 3) return false;
    const m = c.inq.shift();
    m.v += 3 * Math.log10(1.2) + chainL;
    c.outq.push(m);
    return true;
  }
  if (c.type === "wishing") {
    if (!c.inq.length || c.outq.length >= 3) return false;
    const m = c.inq.shift();
    if (m.L > 0 && Math.random() < 0.02) emit("mod", c, null);
    c.outq.push(m);
    return true;
  }
  if (c.type === "gravity") {
    if (c.outq.length >= 3) return false;
    let m = c.inq.shift();
    if (!m) m = pullStray(c);
    if (!m) return false;
    m.v += Math.log10(1.5);
    c.outq.push(m);
    return true;
  }
  if (c.type === "launcher" || c.type === "cometlauncher") {
    if (!c.inq.length) return false;
    return launch(c, c.inq.shift());
  }
  if (c.type === "warppipe") {
    if (!c.inq.length) return false;
    const to = RT.byId.get(c.link);
    if (!to || to.outq.length >= 4) return false;
    to.outq.push(c.inq.shift());
    return true;
  }
  if (c.type === "splitter") {
    if (!c.inq.length) return false;
    return split(c);
  }
  return false;
}
function popcount(x) { let n = 0; while (x) { n += x & 1; x >>>= 1; } return n; }

function pullStray(c) {
  const strays = S.season.strays;
  if (!strays || !strays.length) return null;
  const [cx, cy] = [c.x + 1.5, c.y + 1.5];
  for (let i = 0; i < strays.length; i++) {
    const s = strays[i];
    if (Math.max(Math.abs(s.x - cx), Math.abs(s.y - cy)) <= 7.5) { strays.splice(i, 1); return s.m; }
  }
  return null;
}

/* ---------- the Splitter ---------- */
function filterMatch(f, m) {
  if (!f) return false;
  if (f.kind === "hue") return m.h === f.val;
  if (f.kind === "tier") return m.t >= f.val;
  if (f.kind === "trait") return f.val === "lucky" ? m.L > 0 : m.c;
  return false;
}
function split(c) {
  const m = c.inq[0];
  const fwd = c.rot, right = (c.rot + 1) & 3, left = (c.rot + 3) & 3;
  let order;
  if (c.filter && S.seasonNo >= 2) order = filterMatch(c.filter, m) ? [fwd] : [left, right];
  else { order = [fwd, right, left]; const r = (c.rr || 0) % 3; order = order.slice(r).concat(order.slice(0, r)); }
  for (const d of order) {
    const res = offer(c.x + DX[d], c.y + DY[d], m, d, c);
    if (res === 1) { c.inq.shift(); c.rr = (c.rr || 0) + 1; return true; }
  }
  return false;
}

/* ---------- Launchers ---------- */
function launch(c, m) {
  const range = E.launcherRange(c);
  const targets = [];
  for (let d = range; d >= 2 && targets.length < 3; d--) {
    const x = c.x + DX[c.rot] * d, y = c.y + DY[c.rot] * d;
    const o = copyAt(x, y);
    if (o && o !== c && (o.type === "track" || TYPES[o.type].fam !== "source")) targets.push([x, y]);
  }
  let tgt;
  if (!targets.length) tgt = [c.x + DX[c.rot] * range, c.y + DY[c.rot] * range];
  else if (E.spec("launcher") === 1 && c.type === "launcher") { c.jug = ((c.jug || 0) + 1) % targets.length; tgt = targets[c.jug]; }
  else tgt = targets[0];
  const dist = Math.max(Math.abs(tgt[0] - c.x), Math.abs(tgt[1] - c.y));
  RT.flying.push({ m, x0: c.x + 0.5, y0: c.y + 0.5, x1: tgt[0], y1: tgt[1], t: 0, dur: 0.35 + dist * 0.06, dir: c.rot, from: c.id });
  return true;
}
function stepFlying(dt) {
  const F = RT.flying;
  for (let i = F.length - 1; i >= 0; i--) {
    const f = F[i];
    f.t += dt;
    if (f.t < f.dur) continue;
    const r = offer(f.x1, f.y1, f.m, f.dir, RT.byId.get(f.from));
    if (r === 1) { F.splice(i, 1); continue; }
    if (r === 0 && f.t < f.dur + 3) continue;          // a full target: hover, then give up
    F.splice(i, 1);
    // A missed shot: a Gravity Well within 6 tiles catches it, or it lands as a Stray.
    const g = RT.gravity.find((w) => distTo(w, f.x1, f.y1) <= 6 && w.inq.length < 4);
    if (g) g.inq.push(f.m); else addStray(f.x1, f.y1, f.m);
  }
}

/* ---------- selling ---------- */
function sell(c, m, chainL) {
  let g = m.v + E.hearthSaleL(c) + Math.log10(E.comboMul(c.combo)) + RT.globalL + (chainL || 0);
  const wished = c.wish === m.h;
  if (wished) g += Math.log10(E.wishMul());
  gain(g);
  c.combo += 1;
  bloomXp(c, m.v);
  S.meta.stats.sold++;
  // Rush: every Lucky level on a sold mote is a point; Charged motes a tenth.
  if (!E.rushOn()) {
    S.rush.meter += m.L + (m.c ? 0.1 : 0);
    if (S.rush.meter >= 100) startRush();
  }
  RT.bucketSales = (RT.bucketSales || 0) + 1;
  emit("sale", c, m, g, wished);
}
export function gain(g) {
  S.season.glow = lAdd(S.season.glow, g);
  S.season.glowSeason = lAdd(S.season.glowSeason, g);
  S.eclipse.glowSince = lAdd(S.eclipse.glowSince, g);
  if (S.season.glowSeason > S.meta.bestGlowSeason) S.meta.bestGlowSeason = S.season.glowSeason;
  const b = RT.rate.buckets, i = Math.floor(S.t) % b.length;
  if (RT.rate.at !== Math.floor(S.t)) { RT.rate.at = Math.floor(S.t); b[i] = ZERO; }
  b[i] = lAdd(b[i], g);
}
export function startRush() { S.rush.meter = 0; S.rush.until = S.t + E.rushLength(); emit("rush"); }

function heartTake(m) {
  const H = S.world.heart;
  if (H.stage >= HEART_STAGES.length) return;
  const st = HEART_STAGES[H.stage];
  const tier = st.tier + 2 * S.meta.depth;
  if (m.t < tier) return;
  if (st.prism && m.h !== 7) return;
  if (st.lucky && m.L < st.lucky) return;
  H.n++;
  if (H.n >= st.n) { H.stage++; H.n = 0; emit("heart", H.stage); }
}

/* ---------- pushing outputs ---------- */
function flush(c) {
  const q = c.outq;
  if (!q.length) return;
  const [ox, oy] = c.k.out;
  let moved = 0;
  while (q.length && moved < 4) {
    const r = offer(ox, oy, q[0], c.rot, c);
    if (r !== 1) break;
    q.shift(); moved++;
  }
}

/* ---------- Tracks ---------- */
function stepTracks(dt) {
  const cap = E.trackCap(), gap = 1 / cap;
  const speedCache = new Map();
  for (const c of RT.tracks) {
    const q = c.m;
    if (!q.length) continue;
    const k = c.k;
    const sk = k.plot + (k.ice ? "i" : "");
    let sp = speedCache.get(sk);
    if (sp == null) { sp = E.trackSpeed(c.x, c.y, k.plot, k.biome, k.rules, k.ice); speedCache.set(sk, sp); }
    const adv = sp * dt;
    for (let i = 0; i < q.length; i++) {
      const lim = i === 0 ? 1 : q[i - 1].p - gap;
      q[i].p = Math.max(q[i].p, Math.min(q[i].p + adv, lim));
    }
    if (q[0].p >= 1) {
      const [nx, ny] = k.next;
      const r = offer(nx, ny, q[0], c.rot, c);
      if (r === 1) q.shift();
      else if (r === -1) addStray(c.x, c.y, q.shift());
    }
  }
}

/* ---------- Chimes and Chains ---------- */
function stepChimes() {
  const ch = RT.chain;
  if (ch && S.t - ch.last > 0.2) { emit("chain", ch); RT.chain = null; }
  for (const c of RT.chimes) {
    if (c.off) continue;
    const need = E.chimeNeed(c);
    if (c.charge < need) continue;
    if (hasLaw("fragile") && c.lastRing && S.t - c.lastRing < 60) continue;
    const chain = RT.chain;
    const times = c.type === "echobell" ? 2 : 1;
    if (chain && (chain.rung.get(c.id) || 0) >= times) continue;
    ring(c);
  }
}
export function ring(c) {
  c.charge = 0;
  c.lastRing = S.t;
  let chain = RT.chain;
  if (!chain || S.t - chain.last > 0.2) chain = RT.chain = { steps: 0, rung: new Map(), last: S.t, notes: [] };
  chain.steps++;
  chain.last = S.t;
  chain.rung.set(c.id, (chain.rung.get(c.id) || 0) + 1);
  const note = chimeNote(c.x, c.y);
  chain.notes.push(note);
  const k = chain.steps;
  const chainL = Math.log10(1 + 0.1 * k * E.chainBonus());
  for (const o of c.k.inRange || []) if (!o.off) act(o, chainL);
  for (const o of c.k.nearChimes || []) o.charge += 5;
  if (!E.rushOn()) { S.rush.meter += 1; if (S.rush.meter >= 100) startRush(); }
  fx.ringAt(c.x + 0.5, c.y + 0.5, E.chimeRadius(), note, k);
}
/** Each Chime plays one note of a pentatonic scale, set by its tile. */
export function chimeNote(x, y) { return (((x * 3 + y * 2) % 5) + 5) % 5; }
export const noteSemis = (n) => PENTATONIC[n];

/* ---------- Storm Rods ---------- */
function stepRods(dt) {
  for (const c of RT.rods) {
    if (E.weatherOf(c.k.biome) !== "storm") { c.strikeIn = null; continue; }
    if (c.strikeIn == null) c.strikeIn = 4 + Math.random() * 8;
    c.strikeIn -= dt;
    if (c.strikeIn > 0) continue;
    c.strikeIn = 6 + Math.random() * 8;
    strike(c.x, c.y);
    const n = Math.round(20 * (1 + 0.1 * (E.level("stormrod") - 1)));
    const v = E.sourceValueL(c);
    for (let i = 0; i < n && c.outq.length < 64; i++) { const m = mote(v, 1, 0); m.c = true; m.v += Math.log10(2); c.outq.push(m); }
  }
}
export function strike(x, y) {
  RT.bolts.push({ x: x + 0.5, y: y + 0.5, t: 0 });
  for (const ch of RT.chimes) if (Math.max(Math.abs(ch.x - x), Math.abs(ch.y - y)) <= 3) ch.charge += 3;
  fx.thunder();
}

/* ---------- Geysers ---------- */
function stepGeysers() {
  if (E.spec("wellspring") !== 0) return;
  for (const c of RT.actors) {
    if (c.type !== "wellspring" || c.off) continue;
    if (c.geyserAt == null) c.geyserAt = S.t + 8;
    if (S.t < c.geyserAt) continue;
    c.geyserAt = S.t + 8;
    // A burst of 8 carries what the steady flow would have, plus +4 Charge to adjacent Chimes.
    const each = E.sourceValueL(c) + Math.log10(Math.max(1, E.tempo(c)));
    for (let i = 0; i < 8; i++) c.outq.push(mote(each, 1, 0));
    for (const ch of c.k.adjChimes) ch.charge += 4;
  }
}

/* ---------- Hearth Wishes and Combo ---------- */
function stepHearths(dt) {
  const decay = Math.pow(1 - E.comboDecay(), dt);
  for (const c of RT.hearths) {
    c.combo *= decay;
    if (c.combo < 0.01) c.combo = 0;
    if (S.t >= c.wishAt) {
      // A Wish is for a colour: until a coloured mote has been made, there is none.
      const seen = [...(RT.seenHues || new Set([0]))].filter((h) => h !== 0);
      c.wish = seen.length ? seen[Math.floor(Math.random() * seen.length)] : -1;
      c.wishAt = S.t + 60;
    }
  }
}

/* ---------- the step ---------- */
export function step(dt) {
  rebuildLayout();
  if (S.t - RT.lastGlobalAt >= 1 || RT.lastGlobalAt < 0) { RT.globalL = E.globalL(); RT.lastGlobalAt = S.t; measure(); }
  stepGeysers();
  stepRods(dt);
  for (const c of RT.actors) {
    const tp = E.tempo(c);
    if (tp > 0) {
      c.work += tp * dt;
      let n = 0;
      while (c.work >= 1 && n < 8) {
        if (!act(c, 0)) { c.work = Math.min(c.work, 1); break; }
        c.work -= 1; n++;
        chimeTick(c, 1);
        if (c.mods.length && Math.random() < 0.02 * E.modSum(c, "echo")) act(c, 0);
      }
    }
    if (c.outq.length) flush(c);
  }
  stepTracks(dt);
  stepFloating(dt);
  stepFlying(dt);
  stepHearths(dt);
  stepChimes();
}

/** Glow per second, measured over the last 30 seconds of world time. */
function measure() {
  const b = RT.rate.buckets, now = Math.floor(S.t);
  let tot = ZERO, n = 0;
  for (let i = 1; i <= b.length; i++) { const t = now - i; if (t < 0) break; tot = lAdd(tot, b[((t % b.length) + b.length) % b.length]); n++; }
  RT.rate.perSec = n ? tot - Math.log10(n) : ZERO;
}

/** Tap a copy: a Wellspring emits now; anything else gets ×2 Tempo for 10 s, then waits 30 s. */
export function tap(c) {
  if (c.type === "wellspring") {
    if (c.outq.length < 4) { emitMote(c, 0); flush(c); return "emit"; }
    return "full";
  }
  if (TYPES[c.type].fam === "wonder" || c.type === "track") return "";
  if (c.tapReady && c.tapReady > S.t) return "wait";
  c.tapUntil = S.t + 10;
  c.tapReady = S.t + 40;
  return "boost";
}
/** A Chime field's free action on everything (Chain Storm). */
export function ringAll() { for (const c of RT.chimes) c.charge = Math.max(c.charge, E.chimeNeed(c)); }
export { act, sell, flush, hooks, popcount, HUES, primaries, N, L, lGte, pk };

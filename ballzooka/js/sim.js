/* sim.js — the game itself: a cannon, a stream of balls, gates that
 * multiply them, a horde walking down, and everything that happens when
 * the three meet.
 *
 * Pure: no DOM, no canvas, no audio. The page calls step() with a time and
 * reads the state back; anything worth a sound or a spark is pushed onto
 * g.events and drained by whoever is drawing. That is what lets
 * tools/validate.js import this file into Node, play whole levels with a
 * simple autopilot, and check the numbers.
 *
 * The one hard limit is the number of ball objects (MAX_BALLS). Past it, a
 * gate stops making new balls and makes the existing ones heavier instead:
 * every ball carries a weight `n`, damage scales with it, and the counter on
 * screen is the sum of the weights. So ×3 always means ×3 — the phone just
 * draws fewer, fatter balls to say so.
 *
 * Every random choice — the waves, the gates, crits, drops, the fan a gate
 * throws its clones in — comes from the run's own seeded generator, never
 * Math.random() (which only picks the seed when none is given): the Daily
 * has to be the same level for everybody. */

import { rng, pick, weighted, rint } from "./rng.js";
import { ENEMY, BOSS, BOSS_ORDER, PICKUP, DROP, PERKS } from "./data.js";

export const W = 400, H = 720;
export const CANNON_Y = H - 58;
export const LINE_Y = H - 128;
export const MAX_BALLS = 600;
const BALL_R = 5;
const FIRE = 1, GOLD = 2, ICE = 4;
const FEVER_T = 7;

let uid = 1;

/* ---------- permanent stats, from the shop ---------- */
export function metaStats(meta) {
  const u = (meta && meta.upg) || {};
  const lv = (k) => u[k] | 0;
  return {
    rate: 3.2 * Math.pow(1.08, lv("rate")),
    volley: 1 + lv("volley"),
    dmg: 1 + 0.15 * lv("dmg"),
    speed: 560 * (1 + 0.06 * lv("speed")),
    crit: 0.05 + 0.03 * lv("crit"),
    hearts: 3 + lv("hearts"),
    coinMul: 1 + 0.1 * lv("coin"),
    head: lv("head")
  };
}

/* The level's base health: what one Blob takes to pop. The curve is
   steeper than one free perk a level and gentler than a shop that is
   being used, so the shop is where a stuck player goes. */
export function hpBase(L) { return 2 * Math.pow(1.19, L - 1) + 0.25 * (L - 1); }
/* Endless has no shop between waves, only perks, and perks multiply: its
   curve is the campaign's plus a little interest, so a run always ends. */
export const difficulty = (g) => g.mode === "campaign" ? g.level : 1 + g.wave * 0.7;
const hpOf = (g, L) => hpBase(L) * (g.mode === "campaign" ? 1 : Math.pow(1.065, g.wave));

/* ---------- a run ---------- */
export function newRun(o) {
  o = o || {};
  const ms = metaStats(o.meta);
  const seed = o.seed != null ? o.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
  const g = {
    mode: o.mode || "campaign", level: o.level || 1, seed, rng: rng(seed), mod: o.modifier || null,
    t: 0, state: "play",
    cannon: { x: W / 2, tx: W / 2, recoil: 0, cool: 0.2, tilt: 0 },
    s: {
      rate: ms.rate, volley: ms.volley, dmg: ms.dmg, speed: ms.speed, crit: ms.crit, critMul: 2.5,
      pierce: 0, ricochet: 0, splash: 0, homing: 0, shrapnel: 0, freeze: 0, gateBonus: 0, magnet: 0,
      mirror: 0, big: 0, arc: 0, feverGain: 1, volatile: 0, rubber: 0, coinMul: ms.coinMul, dropMul: 1
    },
    balls: [], enemies: [], gates: [], pickups: [], drops: [],
    hearts: ms.hearts, maxHearts: ms.hearts, lostHearts: 0,
    coins: 0, score: 0, kills: 0, fired: 0,
    combo: 0, comboT: 0, bestCombo: 0, fever: 0, feverT: 0, fevers: 0,
    xp: 0, xpNext: 8, plevel: 0, draft: null, drafts: 0, perks: {}, rerolls: 1,
    waves: [], wave: -1, waveT: 0, queue: [], bosses: 0,
    temp: { rapid: 0, mega: 0, freeze: 0, twin: 0 },
    revived: false, events: [], ballCount: 0, peakBalls: 0, flags: {}, gateSerial: 0,
    hitstop: 0, slowmo: 0, flipT: 0
  };
  if (g.mod === "glass") { g.s.dmg *= 2; g.hearts = g.maxHearts = 1; }
  if (g.mod === "storm") g.s.gateBonus += 1;
  if (g.mod === "payday") { g.s.coinMul *= 3; g.s.dropMul = 0; }
  if (g.mod === "giants") g.s.coinMul *= 2;
  // Endless and the Daily pay half: they never end on their own, and a mode
  // that farms faster than the campaign would make the campaign pointless.
  if (g.mode !== "campaign") g.s.coinMul *= 0.5;
  if (g.mode === "campaign") g.waves = planCampaign(g);
  nextWave(g);
  for (let i = 0; i < ms.head; i++) g.pendingDrafts = (g.pendingDrafts || 0) + 1;
  if (g.pendingDrafts) { g.pendingDrafts--; openDraft(g); }
  return g;
}

const ev = (g, type, o) => { o = o || {}; o.type = type; g.events.push(o); return o; };

/* ---------- waves ---------- */
function planCampaign(g) {
  const L = g.level, n = Math.min(3 + Math.floor((L - 1) / 2), 8), out = [];
  for (let i = 0; i < n; i++) out.push(makeWave(g, L, i));
  if (L % 5 === 0) out.push({ boss: BOSS_ORDER[(L / 5 - 1) % BOSS_ORDER.length], spawns: [] });
  return out;
}

function unlocked(L) {
  const list = [];
  for (const k of Object.keys(ENEMY)) {
    if (k === "gold" || ENEMY[k].from > L) continue;
    list.push([k, k === "grunt" ? 4 : k === "runner" ? 2.5 : 1.6]);
  }
  return list;
}

/* A wave is a string of formations — rows, columns, chevrons, rushes —
   each drawn from the kinds this level has unlocked. */
function makeWave(g, L, i) {
  const r = g.rng, kinds = unlocked(L), spawns = [];
  let want = Math.min(48, Math.round(6 + L * 0.9 + i * 1.8));
  if (g.mod === "swarm") want *= 2;
  let t = 0;
  const gap = Math.max(0.7, 2.2 - L * 0.06);
  while (want > 0) {
    const kind = weighted(r, kinds);
    const shape = pick(r, L < 2 ? ["row", "trickle"] : ["row", "row", "column", "vee", "trickle", "rush", "ring"]);
    let made = 0;
    if (shape === "row") {
      const k = Math.min(want, rint(r, 3, 6));
      for (let j = 0; j < k; j++) spawns.push({ at: t, kind, x: 40 + (W - 80) * (k === 1 ? 0.5 : j / (k - 1)) });
      made = k; t += gap;
    } else if (shape === "column") {
      const k = Math.min(want, rint(r, 3, 5)), x = rint(r, 50, W - 50);
      for (let j = 0; j < k; j++) spawns.push({ at: t + j * 0.7, kind, x });
      made = k; t += k * 0.7 + gap * 0.5;
    } else if (shape === "vee") {
      const k = Math.min(want, 5), cx = rint(r, 120, W - 120);
      for (let j = 0; j < k; j++) { const o = j - (k - 1) / 2; spawns.push({ at: t + Math.abs(o) * 0.45, kind, x: cx + o * 42 }); }
      made = k; t += 2 + gap * 0.5;
    } else if (shape === "trickle") {
      const k = Math.min(want, rint(r, 3, 6));
      for (let j = 0; j < k; j++) spawns.push({ at: t + j * 0.55, kind, x: rint(r, 30, W - 30) });
      made = k; t += k * 0.55 + gap * 0.4;
    } else if (shape === "rush") {
      const k = Math.min(want, rint(r, 4, 8)), rk = L >= 2 ? "runner" : "grunt";
      for (let j = 0; j < k; j++) spawns.push({ at: t + Math.floor(j / 4) * 0.5, kind: rk, x: 50 + ((j % 4) / 3) * (W - 100) });
      made = k; t += 1 + gap;
    } else {
      const cx = rint(r, 110, W - 110), center = L >= 3 ? "tank" : kind;
      spawns.push({ at: t + 0.3, kind: center, x: cx });
      const k = Math.min(want - 1, 5);
      for (let j = 0; j < k; j++) { const a = (j / k) * Math.PI * 2; spawns.push({ at: t + 0.3 - Math.sin(a) * 0.9, kind, x: cx + Math.cos(a) * 48 }); }
      made = k + 1; t += 2.2 + gap * 0.5;
    }
    want -= made;
  }
  if (r() < 0.3) spawns.push({ at: rint(r, 1, Math.max(2, Math.floor(t))), kind: "gold", x: rint(r, 40, W - 40) });
  return { spawns, pickup: i > 0 && (i % 2 === 1 || r() < 0.25), gates: i === 0 || r() < 0.65 };
}

function nextWave(g) {
  g.wave++;
  g.waveT = 0;
  if (g.mode !== "campaign" && g.wave >= g.waves.length) {
    const L = difficulty(g);
    g.waves.push(g.wave > 0 && (g.wave + 1) % 10 === 0
      ? { boss: BOSS_ORDER[((g.wave + 1) / 10 - 1) % BOSS_ORDER.length], spawns: [] }
      : makeWave(g, L, g.wave % 6));
  }
  const w = g.waves[g.wave];
  if (!w) return;
  let delay = 0.6;
  if (w.boss) { layGates(g, true); spawnBoss(g, w.boss); ev(g, "boss", { kind: w.boss }); return; }
  if (w.gates || !g.gates.length) layGates(g, false);
  if (w.pickup) { spawnPickup(g); delay = 2.4; }
  g.queue = w.spawns.map((s) => ({ at: s.at + delay, kind: s.kind, x: s.x })).sort((a, b) => a.at - b.at);
  ev(g, "wave", { n: g.wave + 1, of: g.mode === "campaign" ? g.waves.length : 0 });
}

/* ---------- gates ---------- */
function gateOp(g, L, good) {
  const r = g.rng;
  if (!good) return weighted(r, [[{ op: "div", v: 2 }, 3], [{ op: "div", v: 3 }, L >= 6 ? 1.5 : 0], [{ op: "mul", v: 1 }, 0.4]]);
  return weighted(r, [
    [{ op: "mul", v: 2 }, 5], [{ op: "mul", v: 3 }, 3.5], [{ op: "mul", v: 4 }, L >= 4 ? 1.6 : 0.2], [{ op: "mul", v: 5 }, L >= 8 ? 0.8 : 0.1],
    [{ op: "charge", v: 1 }, L >= 3 ? 2 : 0], [{ op: "mystery" }, L >= 2 ? 1.4 : 0],
    [{ op: "fire" }, L >= 5 ? 1 : 0], [{ op: "gold" }, 0.6], [{ op: "big" }, L >= 6 ? 0.9 : 0], [{ op: "ice" }, L >= 4 ? 0.8 : 0]
  ]);
}

export function layGates(g, boss) {
  const r = g.rng, L = difficulty(g);
  if (g.gates.length) ev(g, "gatesOut", { gates: g.gates.slice() });
  g.gates = [];
  let rows = L < 2 ? 1 : r() < 0.55 ? 1 : 2;
  if (g.mod === "storm") rows++;
  if (boss) rows = Math.max(rows, 2);
  const ys = rows === 1 ? [400] : rows === 2 ? [440, 320] : [460, 375, 290];
  for (let ri = 0; ri < rows; ri++) {
    const count = r() < 0.5 ? 2 : 3, w = count === 2 ? 128 : 98;
    const xs = count === 2 ? [W * 0.27, W * 0.73] : [W * 0.18, W * 0.5, W * 0.82];
    const bad = L >= 2 && r() < 0.45 ? rint(r, 0, count - 1) : -1;
    const slide = L >= 4 && r() < 0.35;
    const amp = slide ? rint(r, 26, 56) : 0, spd = 0.6 + r() * 0.7, ph = r() * 6.28;
    for (let i = 0; i < count; i++) {
      const o = gateOp(g, L, i !== bad);
      const n = g.gateSerial++ % 30;
      g.gates.push({
        id: uid++, bit: 1 << n, x: xs[i], bx: xs[i], y: ys[ri], w, h: 18,
        op: o.op, v: o.v || 0, charge: 0, need: Math.round(6 + L * 1.5), cnt: 0,
        amp, spd, ph, born: g.t, flash: 0, hits: 0, was: null
      });
    }
  }
  ev(g, "gatesIn");
}

/* Every ball that passes a gate is cloned (k extra) at a small fan of
   angles. Past MAX_BALLS the weight goes onto the balls that already exist,
   so the total is exactly what the gate said. */
function clone(g, b, k) {
  if (k <= 0) return;
  const room = Math.max(0, MAX_BALLS - g.balls.length), m = Math.min(k, room);
  const total = b.n * (k + 1), each = total / (m + 1);
  b.n = each;
  const sp = Math.hypot(b.vx, b.vy), base = Math.atan2(b.vy, b.vx);
  for (let j = 1; j <= m; j++) {
    const off = (j % 2 ? 1 : -1) * Math.ceil(j / 2) * 0.07 * (0.6 + g.rng() * 0.8);
    const a = base + off;
    g.balls.push({ x: b.x + Math.cos(a) * 2, y: b.y, px: b.x, py: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, n: each, r: b.r, mask: b.mask, fx: b.fx, pierce: b.pierce, bounce: b.bounce, rubber: b.rubber, last: 0, dead: false });
  }
}

function passGate(g, b, gt) {
  gt.flash = 0.14; gt.hits++;
  switch (gt.op) {
    case "mul": {
      const v = gt.v + (gt.v > 1 ? g.s.gateBonus : 0);
      if (v >= 5) g.flags.x5 = true;
      clone(g, b, v - 1);
      break;
    }
    case "charge": {
      gt.charge += 1;
      const v = Math.min(6, 1 + Math.floor(gt.charge / gt.need));
      if (v > gt.v) { gt.v = v; ev(g, "gateUp", { x: gt.x, y: gt.y, v }); }
      if (gt.v > 1) clone(g, b, gt.v - 1 + g.s.gateBonus);
      break;
    }
    case "div":
      gt.cnt++;
      if (gt.cnt % gt.v !== 0) b.dead = true;
      break;
    case "mystery": {
      const o = weighted(g.rng, [[{ op: "mul", v: 2 }, 3], [{ op: "mul", v: 3 }, 3], [{ op: "mul", v: 4 }, 2], [{ op: "mul", v: 10 }, 1], [{ op: "div", v: 2 }, 2], [{ op: "fire" }, 1], [{ op: "gold" }, 1]]);
      gt.op = o.op; gt.v = o.v || 0; gt.revealed = true;
      if (o.op === "mul" && o.v === 10) g.flags.jackpot = true;
      ev(g, "reveal", { x: gt.x, y: gt.y, op: gt.op, v: gt.v });
      passGate(g, b, gt);
      break;
    }
    case "fire": b.fx |= FIRE; break;
    case "gold": b.fx |= GOLD; break;
    case "ice": b.fx |= ICE; break;
    case "big": if (b.r < 11) { b.r *= 1.6; b.n *= 2; } break;
  }
  if (g.events.length < 400 && gt.hits % 6 === 1) ev(g, "gate", { x: gt.x, y: gt.y, op: gt.op, v: gt.v });
}

/* ---------- pickups: the runner half of the ad ---------- */
function spawnPickup(g) {
  const r = g.rng, keys = Object.keys(PICKUP);
  const a = pick(r, keys), b = pick(r, keys);
  const mk = (stat, good, x0, x1) => {
    const P = PICKUP[stat];
    let v;
    if (stat === "volley") v = good ? rint(r, 1, 2) : -rint(r, 1, 3);
    else v = good ? rint(r, 2, 5) * 5 : -rint(r, 2, 6) * 5;
    return { stat, v, start: v, x0, x1, flash: 0, min: P.min, max: P.max };
  };
  const goodLeft = r() < 0.5, bothBad = r() < 0.3;
  g.pickups.push({
    id: uid++, y: -40, h: 38, vy: 70,
    panels: [mk(a, goodLeft && !bothBad, 0, W / 2), mk(b, !goodLeft && !bothBad, W / 2, W)]
  });
}

function takePickup(g, p) {
  const pan = g.cannon.x < W / 2 ? p.panels[0] : p.panels[1];
  const s = g.s;
  if (pan.stat === "volley") s.volley = Math.max(1, s.volley + Math.round(pan.v));
  else if (pan.stat === "rate") s.rate *= Math.max(0.4, 1 + pan.v / 100);
  else s.dmg *= Math.max(0.4, 1 + pan.v / 100);
  ev(g, "pickup", { stat: pan.stat, v: pan.v, x: (pan.x0 + pan.x1) / 2, y: p.y, good: pan.v >= 0 });
}

/* ---------- the horde ---------- */
function spawnEnemy(g, kind, x, y, hpMul) {
  const E = ENEMY[kind], L = difficulty(g);
  let hp = hpOf(g, L) * E.hp * (hpMul || 1);
  let r = E.r;
  if (g.mod === "giants") { hp *= 2; r *= 1.4; }
  if (g.mod === "swarm") hp *= 0.5;
  const e = {
    id: uid++, kind, x, y: y == null ? -r - 4 : y, r, hp, maxHp: hp, v: E.v * (0.9 + g.rng() * 0.2) * (g.mode === "campaign" ? 1 : 1 + Math.min(0.8, g.wave * 0.012)),
    armor: E.armor ? Math.round(E.armor + L * 0.6) : 0, flash: 0, frozen: 0, kb: 0, born: g.t,
    healT: 2, vx: kind === "gold" ? (g.rng() < 0.5 ? -70 : 70) : 0, dead: false
  };
  e.maxArmor = e.armor;
  g.enemies.push(e);
  return e;
}

function spawnBoss(g, kind) {
  const L = difficulty(g), B = BOSS[kind];
  const hp = hpOf(g, L) * (kind === "hydra" ? 70 : 110) * (g.mod === "giants" ? 2 : 1);
  g.enemies.push({
    id: uid++, kind: "boss", boss: kind, gen: 0, name: B.name, color: B.color, x: W / 2, y: -60, r: 46, hp, maxHp: hp,
    v: 40, armor: 0, flash: 0, frozen: 0, kb: 0, born: g.t, spawnT: 3, trickT: 5, dead: false, vx: 0
  });
  g.queue = [];
}

function bossTick(g, e, dt) {
  const slow = e.frozen > 0 || g.temp.freeze > 0 ? 0.25 : 1;
  if (e.y < 130) e.y += 50 * dt * slow;
  else e.y += 2.6 * dt * slow * (e.hp < e.maxHp * 0.5 ? 1.6 : 1);
  e.x = W / 2 + Math.sin(g.t * 0.55 + e.id) * (W / 2 - e.r - 16);
  const enraged = e.hp < e.maxHp * 0.5;
  e.spawnT -= dt * slow;
  if (e.spawnT <= 0) {
    e.spawnT = enraged ? 2.4 : 3.8;
    const kind = e.boss === "king" ? (enraged ? "runner" : "grunt") : "grunt";
    const n = e.boss === "king" ? 3 : 1;
    for (let i = 0; i < n; i++) spawnEnemy(g, kind, e.x + (i - (n - 1) / 2) * 34, e.y + e.r, 0.8);
    ev(g, "bossCall", { x: e.x, y: e.y });
  }
  e.trickT -= dt * slow;
  if (e.trickT <= 0) {
    e.trickT = enraged ? 5 : 7.5;
    if (e.boss === "golem") {
      for (let i = 0; i < 5; i++) spawnEnemy(g, "shield", 50 + i * (W - 100) / 4, e.y + e.r + 10, 0.7);
      ev(g, "wall", { x: e.x, y: e.y });
    } else if (e.boss === "magus") {
      let best = null;
      for (const gt of g.gates) if ((gt.op === "mul" || gt.op === "charge") && gt.v > 1 && (!best || gt.v > best.v)) best = gt;
      if (best) { best.was = { op: best.op, v: best.v }; best.op = "div"; best.v = 2; best.cursed = 4; ev(g, "curse", { x: best.x, y: best.y }); }
    }
  }
  if (e.boss === "hydra" && e.gen === 0 && e.hp < e.maxHp * 0.5) {
    e.dead = true;
    for (const s of [-1, 1]) {
      const c = Object.assign({}, e, { id: uid++, gen: 1, x: e.x + s * 40, r: 34, hp: e.hp * 0.6, maxHp: e.maxHp * 0.3, dead: false, flash: 0.2, spawnT: 2 + (s + 1), trickT: 99 });
      g.enemies.push(c);
    }
    ev(g, "split", { x: e.x, y: e.y, r: e.r, color: e.color });
  }
}

function damage(g, e, d, crit) {
  if (e.dead) return;
  e.hp -= d; e.flash = 0.07;
  g.score += Math.min(d, Math.max(0, e.hp + d));
  if (crit || g.events.length < 300) ev(g, "hit", { x: e.x, y: e.y - e.r, d, crit: !!crit, id: e.id });
  if (e.hp <= 0) kill(g, e);
}

function explode(g, x, y, rad, d, depth) {
  ev(g, "boom", { x, y, r: rad });
  let n = 0;
  for (const o of g.enemies) {
    if (o.dead) continue;
    const dx = o.x - x, dy = o.y - y;
    if (dx * dx + dy * dy < (rad + o.r) * (rad + o.r)) { o.chain = depth + 1; damage(g, o, o.boss ? d * 0.3 : d, false); n++; }
  }
  return n;
}

function kill(g, e) {
  e.dead = true;
  g.kills++;
  g.flags.first = true;
  const E = ENEMY[e.kind] || { xp: 25, coin: 60, color: e.color };
  const L = difficulty(g);
  g.combo = g.comboT > 0 ? g.combo + 1 : 1;
  g.comboT = 1.6;
  if (g.combo > g.bestCombo) g.bestCombo = g.combo;
  if (g.combo >= 50) g.flags.combo50 = true;
  if (g.feverT <= 0) {
    g.fever += (0.014 + 0.0016 * Math.min(g.combo, 40)) * g.s.feverGain;
    if (g.fever >= 1) { g.fever = 1; g.feverT = FEVER_T; g.fevers++; if (g.fevers >= 3) g.flags.fever3 = true; ev(g, "fever"); }
  }
  let coins = E.coin * g.s.coinMul * (1 + L * 0.08) * (e.goldHit ? 2 : 1);
  if (e.boss) coins = 60 * (1 + L * 0.2) * g.s.coinMul;
  coins = Math.max(1, Math.round(coins));
  g.coins += coins;
  g.score += Math.round(e.maxHp * (1 + Math.min(g.combo, 50) / 10));
  ev(g, "kill", { x: e.x, y: e.y, r: e.r, color: e.color || E.color, coins, kind: e.kind, combo: g.combo, boss: !!e.boss });
  if ((e.chain || 0) >= 1) { g.chainCount = (g.chainCount || 0) + 1; if (g.chainCount >= 8) g.flags.chain = true; }

  if (e.kind === "splitter" && !e.child) {
    for (const s of [-1, 1]) { const c = spawnEnemy(g, "grunt", e.x + s * 12, e.y, 0.9); c.child = true; c.kb = 40; }
  }
  if (e.kind === "bomber") explode(g, e.x, e.y, 72, hpBase(L) * 3, e.chain || 0);
  if (g.s.volatile && e.kind !== "bomber") explode(g, e.x, e.y, 30 + 12 * g.s.volatile, hpBase(L) * 0.6 * g.s.volatile, e.chain || 0);
  if (g.s.shrapnel) {
    for (let i = 0; i < g.s.shrapnel && g.balls.length < MAX_BALLS; i++) {
      const a = -Math.PI / 2 + (g.rng() - 0.5) * 1.6;
      g.balls.push(newBall(g, e.x, e.y, a, 1));
    }
  }
  if (e.boss) {
    g.bosses++;
    g.flags.boss = true;
    g.hitstop = 0.12; g.slowmo = 1.4;
    ev(g, "bossDown", { x: e.x, y: e.y, color: e.color });
  }
  g.xp += E.xp * (e.boss ? 1 : 1);
  if (g.xp >= g.xpNext && g.state === "play") {
    g.xp -= g.xpNext; g.plevel++;
    g.xpNext = Math.round(8 * Math.pow(1.45, g.plevel));
    g.pendingDrafts = (g.pendingDrafts || 0) + 1;
  }
  if (g.s.dropMul > 0 && !e.boss && g.rng() < 0.028 * g.s.dropMul * (1 + 0.5 * g.s.magnet)) {
    const pool = Object.keys(DROP).filter((k) => k !== "heart" || g.hearts < g.maxHearts).map((k) => [k, DROP[k].w]);
    g.drops.push({ id: uid++, kind: weighted(g.rng, pool), x: e.x, y: e.y, vy: -60 });
  }
}

/* ---------- balls ---------- */
function newBall(g, x, y, a, n) {
  const sp = g.s.speed;
  return {
    x, y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, n: n || 1,
    r: BALL_R * (1 + 0.35 * g.s.big), mask: 0, fx: 0, pierce: g.s.pierce, bounce: g.s.ricochet, rubber: g.s.rubber, last: 0, dead: false
  };
}

function fire(g) {
  const s = g.s, c = g.cannon;
  const muzzles = [c.x];
  if (g.temp.twin > 0) muzzles.push(c.x - 20, c.x + 20);
  if (s.mirror && Math.abs(W - c.x - c.x) > 24) muzzles.push(W - c.x);
  const n = s.volley, step = Math.min(0.075, 0.55 / n);
  for (const mx of muzzles) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - (n - 1) / 2) * step + (g.rng() - 0.5) * 0.03 + c.tilt * 0.15;
      if (g.balls.length < MAX_BALLS) g.balls.push(newBall(g, mx, CANNON_Y - 26, a, 1));
      else g.balls[(g.fired + i) % g.balls.length].n += 1;
      g.fired++;
    }
  }
  c.recoil = 1;
  ev(g, "shot", { x: c.x });
}

/* ---------- perks ---------- */
function openDraft(g) {
  const pool = Object.keys(PERKS).filter((k) => (g.perks[k] || 0) < PERKS[k].max);
  const out = [];
  while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(g.rng() * pool.length), 1)[0]);
  g.draft = out;
  g.state = "draft";
  g.drafts++;
  ev(g, "draft");
}

export function choosePerk(g, i) {
  if (g.state !== "draft" || !g.draft || !g.draft[i]) return false;
  const k = g.draft[i], s = g.s;
  g.perks[k] = (g.perks[k] || 0) + 1;
  switch (k) {
    case "rapid": s.rate *= 1.25; break;
    case "volley": s.volley += 1; break;
    case "dmg": s.dmg *= 1.3; break;
    case "pierce": s.pierce++; break;
    case "ricochet": s.ricochet++; break;
    case "splash": s.splash += 0.3; break;
    case "crit": s.crit += 0.12; break;
    case "homing": s.homing++; break;
    case "shrapnel": s.shrapnel += 2; break;
    case "frost": s.freeze += 0.1; break;
    case "gates": s.gateBonus++; break;
    case "magnet": s.magnet++; break;
    case "mirror": s.mirror = 1; break;
    case "big": s.big++; s.dmg *= 1.2; break;
    case "arc": s.arc += 2; break;
    case "heart": g.maxHearts++; g.hearts = Math.min(g.maxHearts, g.hearts + 1); break;
    case "party": s.feverGain *= 1.5; break;
    case "volatile": s.volatile++; break;
    case "rubber": s.rubber++; break;
  }
  g.draft = null;
  g.state = "play";
  ev(g, "perk", { id: k });
  return true;
}

export function reroll(g) {
  if (g.state !== "draft" || g.rerolls <= 0) return false;
  g.rerolls--;
  g.state = "play";
  openDraft(g);
  g.drafts--;
  return true;
}

/* ---------- the loop ---------- */
export function step(g, dt) {
  if (g.state !== "play") return;
  if (g.hitstop > 0) { g.hitstop -= dt; return; }
  if (g.slowmo > 0) { g.slowmo -= dt; dt *= 0.35; }
  if (g.mod === "turbo") dt *= 1.25;
  g.t += dt;
  g.waveT += dt;
  const c = g.cannon, s = g.s, T = g.temp;
  for (const k in T) if (T[k] > 0) T[k] = Math.max(0, T[k] - dt);

  // the cannon chases its target; a lean shows which way it is going
  const dx = c.tx - c.x;
  const mv = Math.max(-900 * dt, Math.min(900 * dt, dx * Math.min(1, dt * 18)));
  c.x = Math.max(22, Math.min(W - 22, c.x + mv));
  c.tilt += ((mv / Math.max(dt, 1e-4)) / 900 - c.tilt) * Math.min(1, dt * 10);
  c.recoil = Math.max(0, c.recoil - dt * 8);

  // fire
  const rate = s.rate * (g.feverT > 0 ? 2 : 1) * (T.rapid > 0 ? 2 : 1);
  c.cool -= dt;
  let guard = 0;
  while (c.cool <= 0 && guard++ < 4) { fire(g); c.cool += 1 / rate; }
  if (c.cool < 0) c.cool = 0;

  // combo and fever
  if (g.comboT > 0) { g.comboT -= dt; if (g.comboT <= 0) { g.combo = 0; g.chainCount = 0; } }
  if (g.feverT > 0) { g.feverT -= dt; g.fever = Math.max(0, g.feverT / FEVER_T); if (g.feverT <= 0) { g.fever = 0; ev(g, "feverEnd"); } }

  // gates slide, recover from a curse
  for (const gt of g.gates) {
    if (gt.amp) gt.x = gt.bx + Math.sin(g.t * gt.spd + gt.ph) * gt.amp;
    if (gt.flash > 0) gt.flash -= dt;
    if (gt.cursed > 0) { gt.cursed -= dt; if (gt.cursed <= 0 && gt.was) { gt.op = gt.was.op; gt.v = gt.was.v; gt.was = null; ev(g, "uncurse", { x: gt.x, y: gt.y }); } }
  }

  // spawn
  while (g.queue.length && g.queue[0].at <= g.waveT) { const q = g.queue.shift(); spawnEnemy(g, q.kind, q.x); }

  // pickups
  for (const p of g.pickups) {
    p.y += p.vy * dt;
    for (const pan of p.panels) if (pan.flash > 0) pan.flash -= dt;
    if (p.y + p.h >= CANNON_Y - 22) { takePickup(g, p); p.dead = true; }
  }

  // homing aims at whatever is closest to the line
  let homeX = null;
  if (s.homing) { let best = -1e9; for (const e of g.enemies) if (!e.dead && e.y > best) { best = e.y; homeX = e.x; } }

  // balls
  const balls = g.balls, en = g.enemies;
  let count = 0;
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    if (b.dead) continue;
    b.px = b.x; b.py = b.y;
    if (homeX != null) {
      b.vx += Math.sign(homeX - b.x) * 260 * s.homing * dt;
      const sp = Math.hypot(b.vx, b.vy), want = s.speed;
      b.vx *= want / sp; b.vy *= want / sp;
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); }
    else if (b.x > W - b.r) { b.x = W - b.r; b.vx = -Math.abs(b.vx); }
    if (b.y < 4 && b.vy < 0) {
      if (b.bounce > 0) { b.bounce--; b.vy = -b.vy; b.mask = 0; } else { b.dead = true; continue; }
    }
    if (b.y > H + 10) { b.dead = true; continue; }
    // gates
    for (const gt of g.gates) {
      if (b.mask & gt.bit) continue;
      if ((b.py >= gt.y && b.y < gt.y) || (b.py <= gt.y && b.y > gt.y)) {
        if (Math.abs(b.x - gt.x) <= gt.w / 2 + b.r * 0.5) { b.mask |= gt.bit; passGate(g, b, gt); if (b.dead) break; }
      }
    }
    if (b.dead) continue;
    // pickup panels eat balls and grow
    for (const p of g.pickups) {
      if (p.dead || b.vy > 0) continue;
      if (b.y <= p.y + p.h && b.y >= p.y) {
        const pan = b.x < W / 2 ? p.panels[0] : p.panels[1];
        const P = PICKUP[pan.stat], before = pan.v;
        pan.v = Math.min(pan.max, pan.v + P.step * b.n);
        pan.flash = 0.08;
        if (before < 0 && pan.v >= 0) { g.flags.flip = true; ev(g, "flip", { x: (pan.x0 + pan.x1) / 2, y: p.y }); }
        b.dead = true; break;
      }
    }
    if (b.dead) continue;
    // the horde
    for (let j = 0; j < en.length; j++) {
      const e = en[j];
      if (e.dead || e.id === b.last) continue;
      const ddx = b.x - e.x, ddy = b.y - e.y, rr = b.r + e.r;
      if (ddx * ddx + ddy * ddy > rr * rr) continue;
      hitEnemy(g, b, e, ddx, ddy);
      if (b.dead) break;
    }
    if (!b.dead) count += b.n;
  }
  // compact in place
  let w = 0;
  for (let i = 0; i < balls.length; i++) if (!balls[i].dead) balls[w++] = balls[i];
  balls.length = w;
  g.ballCount = count;
  if (count > g.peakBalls) g.peakBalls = count;
  if (count >= 1000) g.flags.pit = true;

  // the horde moves
  for (const e of en) {
    if (e.dead) continue;
    if (e.flash > 0) e.flash -= dt;
    if (e.frozen > 0) e.frozen -= dt;
    if (e.boss) { bossTick(g, e, dt); if (e.y - e.r * 0.2 > LINE_Y) breach(g, e); continue; }
    const slow = T.freeze > 0 ? 0.08 : e.frozen > 0 ? 0.3 : 1;
    e.y += (e.v * slow - e.kb) * dt;
    e.kb *= Math.pow(0.02, dt);
    if (e.kind === "gold") { e.x += e.vx * dt * slow; if (e.x < e.r || e.x > W - e.r) e.vx = -e.vx; }
    else e.x += Math.sin(g.t * 1.7 + e.id) * 7 * dt;
    if (e.kind === "healer") {
      e.healT -= dt;
      if (e.healT <= 0) {
        e.healT = 2.2;
        let n = 0;
        for (const o of en) if (!o.dead && o !== e && !o.boss && (o.x - e.x) ** 2 + (o.y - e.y) ** 2 < 90 * 90) { o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.15); n++; }
        if (n) ev(g, "heal", { x: e.x, y: e.y });
      }
    }
    if (e.y - e.r * 0.3 > LINE_Y) breach(g, e);
  }
  // a little personal space, so a crowd reads as a crowd
  for (let i = 0; i < en.length; i++) {
    const a = en[i];
    if (a.dead || a.boss) continue;
    for (let j = i + 1; j < en.length; j++) {
      const b = en[j];
      if (b.dead || b.boss) continue;
      const dx2 = b.x - a.x, dy2 = b.y - a.y, rr = (a.r + b.r) * 0.92, d2 = dx2 * dx2 + dy2 * dy2;
      if (d2 < rr * rr && d2 > 0.01) {
        const d = Math.sqrt(d2), push = (rr - d) * 0.5, nx = dx2 / d, ny = dy2 / d;
        a.x -= nx * push; a.y -= ny * push * 0.3; b.x += nx * push; b.y += ny * push * 0.3;
      }
    }
    a.x = Math.max(a.r, Math.min(W - a.r, a.x));
  }
  g.enemies = en.filter((e) => !e.dead);

  // drops fall to the cannon
  for (const d of g.drops) {
    d.vy = Math.min(170, d.vy + 260 * dt);
    d.y += d.vy * dt;
    const reach = 30 * (1 + 0.6 * s.magnet);
    if (d.y >= CANNON_Y - 30 && d.y <= CANNON_Y + 20 && Math.abs(d.x - c.x) < reach) { catchDrop(g, d); d.dead = true; }
    else if (d.y > H + 20) d.dead = true;
  }
  g.drops = g.drops.filter((d) => !d.dead);
  g.pickups = g.pickups.filter((p) => !p.dead);

  if (g.pendingDrafts > 0 && g.state === "play") { g.pendingDrafts--; openDraft(g); }

  // the wave is done when its queue is empty and the field mostly clear
  const w8 = g.waves[g.wave];
  if (w8 && !g.queue.length && g.state === "play") {
    const left = g.enemies.filter((e) => e.kind !== "gold").length;
    const last = g.mode === "campaign" && g.wave >= g.waves.length - 1;
    if (last) {
      if (!left && !g.pickups.length) { g.state = "won"; ev(g, "won"); }
    } else if (!w8.boss ? (left <= 2 || g.waveT > 24) : !left) nextWave(g);
  }
}

function hitEnemy(g, b, e, ddx, ddy) {
  const s = g.s;
  // a Knight's shield takes the hit from below, one point per ball whatever it weighs
  if (e.armor > 0 && b.vy < 0 && ddy > -e.r * 0.2) {
    e.armor -= 1;
    e.flash = 0.05;
    if (e.armor <= 0) ev(g, "shieldBreak", { x: e.x, y: e.y });
    else if (g.events.length < 300) ev(g, "clang", { x: b.x, y: b.y });
    b.dead = true;
    return;
  }
  const crit = g.rng() < s.crit + (g.feverT > 0 ? 0.25 : 0);
  let d = s.dmg * b.n * (1 + 0.2 * s.big);
  if (b.fx & FIRE) d *= 1.5;
  if (g.temp.mega > 0) d *= 3;
  if (crit) d *= s.critMul;
  if (b.fx & GOLD) e.goldHit = true;
  e.kb = Math.min(60, e.kb + (e.boss ? 0 : 18 * Math.min(3, b.n)));
  damage(g, e, d, crit);
  const splash = s.splash + (b.fx & FIRE ? 0.25 : 0);
  if (splash > 0) {
    for (const o of g.enemies) {
      if (o === e || o.dead) continue;
      const dx = o.x - e.x, dy = o.y - e.y, rad = e.r + o.r + 18;
      if (dx * dx + dy * dy < rad * rad) damage(g, o, d * splash, false);
    }
  }
  if ((b.fx & ICE) || (s.freeze > 0 && g.rng() < s.freeze)) e.frozen = 1.6;
  if (crit && s.arc) {
    const near = g.enemies.filter((o) => o !== e && !o.dead).sort((a, c) => ((a.x - e.x) ** 2 + (a.y - e.y) ** 2) - ((c.x - e.x) ** 2 + (c.y - e.y) ** 2)).slice(0, s.arc);
    if (near.length) { ev(g, "arc", { pts: [[e.x, e.y]].concat(near.map((o) => [o.x, o.y])) }); for (const o of near) damage(g, o, d * 0.5, false); }
  }
  if (b.pierce > 0) { b.pierce--; b.last = e.id; }
  else if (b.rubber > 0) {
    b.rubber--; b.last = e.id;
    const d2 = Math.hypot(ddx, ddy) || 1, nx = ddx / d2, ny = ddy / d2, dot = b.vx * nx + b.vy * ny;
    b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny;
  } else b.dead = true;
}

function breach(g, e) {
  e.dead = true;
  if (e.kind === "gold") { ev(g, "escape", { x: e.x, y: e.y }); return; }
  const harm = e.boss ? g.hearts : (ENEMY[e.kind].harm || 1);
  g.hearts -= harm; g.lostHearts += harm;
  g.combo = 0; g.comboT = 0;
  ev(g, "breach", { x: e.x, y: LINE_Y, harm });
  if (g.hearts <= 0) { g.hearts = 0; g.state = "lost"; ev(g, "lost"); }
}

function catchDrop(g, d) {
  const T = g.temp, D = DROP[d.kind];
  if (d.kind === "heart") g.hearts = Math.min(g.maxHearts, g.hearts + 1);
  else if (d.kind === "bomb") {
    const L = difficulty(g);
    for (const e of g.enemies.slice()) damage(g, e, e.boss ? e.maxHp * 0.06 : Math.max(e.maxHp * 0.6, hpBase(L) * 2), false);
    ev(g, "bomb");
  } else T[d.kind] = Math.max(T[d.kind], D.t);
  ev(g, "catch", { kind: d.kind, x: d.x, y: d.y });
}

/* ---------- after a loss ---------- */
export function revive(g) {
  if (g.state !== "lost" || g.revived) return false;
  g.revived = true;
  g.hearts = Math.max(1, Math.ceil(g.maxHearts / 2));
  for (const e of g.enemies) if (!e.boss && e.y > LINE_Y - 260) e.dead = true;
  for (const e of g.enemies) if (e.boss) e.y = Math.min(e.y, 140);
  g.enemies = g.enemies.filter((e) => !e.dead);
  g.temp.freeze = 3;
  g.state = "play";
  g.flags.revive = true;
  ev(g, "revive");
  return true;
}

/** Progress through the level, 0..1, for the bar at the top. */
export function progress(g) {
  if (g.mode !== "campaign") return 0;
  const n = g.waves.length, w = g.waves[g.wave];
  if (!w) return 1;
  if (w.boss) { const b = g.enemies.find((e) => e.boss); return (g.wave + (b ? 1 - Math.max(0, b.hp) / b.maxHp : 1)) / n; }
  const tot = w.spawns.length || 1;
  return Math.min(1, (g.wave + (tot - g.queue.length) / tot * 0.9) / n);
}

export function stars(g) {
  if (g.state !== "won") return 0;
  if (!g.lostHearts) return 3;
  return g.hearts >= g.maxHearts / 2 ? 2 : 1;
}

export const BALL_FX = { FIRE, GOLD, ICE };

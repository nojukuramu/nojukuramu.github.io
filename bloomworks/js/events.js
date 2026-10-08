/* events.js — the living world. Weather per biome with a forecast, Void
 * tiles rolling their effects, Meteor Showers, critters going about their
 * jobs, Rocks regrowing under Wild Growth. None of it is needed for the
 * factory to run; all of it changes what each contraption does best. */

import { S, RT, tk, pk } from "./state.js";
import { BIOMES, WEATHER, VOID_EFFECTS, CRITTERS, TYPES } from "./data.js";
import * as E from "./econ.js";
import { getPlot, plotSize, tileAt, T, ringOf, hasLaw, localIndex } from "./world.js";
import { copyAt, addStray, sizeOf } from "./build.js";
import { offer } from "./sim.js";
import { HUES } from "./data.js";

let notify = () => {};
export function onNotify(fn) { notify = fn; }

/* ---------- weather ---------- */
function ownedBiomes() {
  const out = new Set(["meadow"]);
  for (const k in S.season.plots) { const [a, b] = k.split(",").map(Number); out.add(getPlot(a, b).biome); }
  return [...out];
}
export function rollWeather(biome) {
  const list = BIOMES[biome].weather;
  const w = [];
  for (const k of list) {
    let p = k === "clear" ? 4 : 1.5;
    if (k === "storm") p *= 1 + 0.25 * E.relic("lightning");
    if (k === "snow" && E.seasonKind().id === "winter") p *= 2;
    if (k === "aurora") p *= 0.35;
    w.push([k, p]);
  }
  let tot = 0; for (const [, p] of w) tot += p;
  let x = Math.random() * tot;
  for (const [k, p] of w) { if (x < p) return k; x -= p; }
  return "clear";
}
export function weatherTick() {
  for (const b of ownedBiomes()) {
    let w = S.weather[b];
    if (!w) { w = S.weather[b] = { cur: "clear", until: S.t + 120 + Math.random() * 120, next: rollWeather(b) }; continue; }
    if (S.t < w.until) continue;
    let cur = w.next || rollWeather(b);
    // Aurora is a night weather: rolled by day, the sky stays clear.
    if (WEATHER[cur].night && E.isDay()) cur = "clear";
    w.cur = cur; w.next = rollWeather(b); w.until = S.t + 240 + Math.random() * 240; w.relicGiven = false;
    if (!S.meta.discovered.weather[cur]) { S.meta.discovered.weather[cur] = 1; notify("New weather in the Codex: " + WEATHER[cur].name, "info", "cloud"); }
    RT.layoutDirty = true;
  }
  // Meteor Showers: any biome, rare, about once an hour.
  if (S.meteorAt == null) S.meteorAt = S.t + 2400 + Math.random() * 2400;
  if (S.t >= S.meteorAt) {
    S.meteorAt = S.t + 2400 + Math.random() * 2400;
    meteorShower();
  }
  S.meteors = S.meteors.filter((m) => m.until > S.t);
}
export function forecast(biome) {
  const w = S.weather[biome];
  if (!w) return null;
  return w.until - S.t <= 120 ? w.next : null;
}
export function meteorShower() {
  const keys = Object.keys(S.season.plots);
  const n = 3 + Math.floor(Math.random() * 6);
  const P = plotSize();
  for (let i = 0; i < n; i++) {
    const key = keys[Math.floor(Math.random() * keys.length)];
    const [px, py] = key.split(",").map(Number);
    for (let tries = 0; tries < 20; tries++) {
      const x = px * P + Math.floor(Math.random() * P), y = py * P + Math.floor(Math.random() * P);
      if (tileAt(x, y) !== T.soil || copyAt(x, y)) continue;
      const ring = ringOf(px, py);
      S.meteors.push({ x, y, until: S.t + 300, hue: [0, 1, 2, 4][Math.floor(Math.random() * 4)], tier: 2 + Math.floor(ring / 3), rich: Math.pow(1.6, ring + 1) });
      RT.bolts.push({ x: x + 0.5, y: y + 0.5, t: 0, meteor: true });
      break;
    }
  }
  S.meta.discovered.weather.meteor = 1;
  notify("A Meteor Shower. Starstone nodes for 5 minutes: an Extractor on one gets ×10.", "big", "star");
  RT.layoutDirty = true;
}

/* ---------- Void tiles ---------- */
export function voidTick() {
  for (const c of RT.actors || []) {
    const key = c.k && c.k.voidKey;
    if (!key) continue;
    const v = S.voids[key];
    const every = E.weatherOf(c.k.biome) === "rift" ? 20 : 60;
    if (!v || S.t >= v.rolled + every) S.voids[key] = { fx: VOID_EFFECTS[Math.floor(Math.random() * VOID_EFFECTS.length)], until: S.t + 60, rolled: S.t };
  }
}

/* ---------- Wild Growth ---------- */
export function regrowTick() {
  if (!hasLaw("wildgrowth")) return;
  const keys = Object.keys(S.season.plots);
  const key = keys[Math.floor(Math.random() * keys.length)];
  const [px, py] = key.split(",").map(Number), P = plotSize();
  const x = px * P + Math.floor(Math.random() * P), y = py * P + Math.floor(Math.random() * P);
  if (tileAt(x, y) !== T.soil || copyAt(x, y)) return;
  (S.world.regrown[key] = S.world.regrown[key] || []).push(localIndex(x, y));
}

/* ---------- critters ---------- */
let cid = 1;
function pickCritter(biome) {
  const w = E.weatherOf(biome);
  const meteorOn = S.meteors.length > 0;
  const commons = [], rares = [];
  for (const id in CRITTERS) {
    const c = CRITTERS[id];
    if (c.biome !== biome) continue;
    if (!c.rare) commons.push(id);
    else if (c.rare === w || (c.rare === "meteor" && meteorOn)) rares.push(id);
  }
  if (rares.length && Math.random() < 0.2) return rares[0];
  return commons[Math.floor(Math.random() * commons.length)];
}
function randTile(key) { const [px, py] = key.split(",").map(Number), P = plotSize(); return [px * P + Math.random() * P, py * P + Math.random() * P]; }
export function critterTick(dt) {
  const list = RT.critters;
  // Spawning: plots with Bloom 2 or more hold as many critters as their Bloom level.
  RT.critterClock = (RT.critterClock || 0) + dt;
  if (RT.critterClock >= 2) {
    RT.critterClock = 0;
    const per = new Map();
    for (const c of list) per.set(c.plot, (per.get(c.plot) || 0) + 1);
    for (const key in S.season.plots) {
      const ps = S.season.plots[key];
      if (ps.bloom < 2) continue;
      const have = per.get(key) || 0;
      if (have >= Math.min(ps.bloom, 8)) continue;
      const spr = (RT.sprinklers || []).some((s) => s.k && s.k.plot === key);
      if (Math.random() > (spr ? 0.2 : 0.1)) continue;
      const [a, b] = key.split(",").map(Number);
      const biome = getPlot(a, b).biome;
      const id = pickCritter(biome);
      if (!id) continue;
      const [x, y] = randTile(key);
      list.push({ id: cid++, kind: id, eff: CRITTERS[id].kind, plot: key, x, y, tx: x, ty: y, wait: 0, carry: null, on: null });
      if (!S.meta.discovered.critters[id]) {
        S.meta.discovered.critters[id] = 1;
        notify("New critter: " + CRITTERS[id].name + (CRITTERS[id].rare ? " (rare)" : ""), "info", "leaf");
        if (E.codexBiomeDone(biome)) notify("Every critter of " + BIOMES[biome].name + " seen: +10% Bloom XP there, for ever.", "big", "book");
      }
    }
  }
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (!S.season.plots[c.plot]) { list.splice(i, 1); continue; }
    behave(c, dt);
  }
}
function copiesIn(key, pred) { return (RT.actors || []).filter((c) => c.k && c.k.plot === key && pred(c)); }
function goTo(c, x, y, speed, dt) {
  const dx = x - c.x, dy = y - c.y, d = Math.hypot(dx, dy);
  if (d < 0.05) { c.x = x; c.y = y; return true; }
  const s = Math.min(d, speed * dt);
  c.x += (dx / d) * s; c.y += (dy / d) * s;
  c.face = dx < 0 ? -1 : 1;
  return false;
}
function wander(c, dt, speed) {
  if (goTo(c, c.tx, c.ty, speed || 0.8, dt)) {
    c.wait -= dt;
    if (c.wait <= 0) { const [x, y] = randTile(c.plot); c.tx = x; c.ty = y; c.wait = 1 + Math.random() * 3; }
  }
}
function behave(c, dt) {
  const e = c.eff;
  if (e === "lucky") {
    if (!c.target || !RT.byId.has(c.target.id)) { const opts = copiesIn(c.plot, () => true); c.target = opts.length ? opts[Math.floor(Math.random() * opts.length)] : null; }
    if (!c.target) return wander(c, dt);
    const n = sizeOf(c.target.type);
    if (goTo(c, c.target.x + n / 2, c.target.y + n / 2, 0.9, dt)) { c.target.fly = S.t + 5; c.target = null; }
    return;
  }
  if (e === "stray" || e === "shore") {
    const speed = e === "shore" ? 1 : 1.3;
    if (!c.carry) {
      const strays = S.season.strays;
      let best = -1, bd = 1e9;
      for (let i = 0; i < strays.length; i++) if (strays[i].plot === c.plot) { const d = Math.hypot(strays[i].x - c.x, strays[i].y - c.y); if (d < bd) { bd = d; best = i; } }
      if (best < 0) return wander(c, dt);
      const s = strays[best];
      if (goTo(c, s.x, s.y, speed, dt)) { strays.splice(best, 1); c.carry = s.m; c.drop = null; }
      return;
    }
    if (!c.drop) {
      let bd = 1e9;
      for (const t of RT.tracks || []) { const d = Math.hypot(t.x + 0.5 - c.x, t.y + 0.5 - c.y); if (d < bd && d < 14) { bd = d; c.drop = t; } }
      if (!c.drop) { addStray(Math.floor(c.x), Math.floor(c.y), c.carry); c.carry = null; return wander(c, dt); }
    }
    if (goTo(c, c.drop.x + 0.5, c.drop.y + 0.5, speed, dt)) {
      if (offer(c.drop.x, c.drop.y, c.carry, c.drop.rot, null) === 1) c.carry = null;
      else c.drop = null;
    }
    return;
  }
  if (e === "kiln" || e === "goat") {
    const want = e === "kiln" ? (o) => o.type === "kiln" : (o) => o.type === "launcher";
    if (!c.target || !RT.byId.has(c.target.id)) { const opts = copiesIn(c.plot, want); c.target = opts.length ? opts[Math.floor(Math.random() * opts.length)] : null; }
    if (!c.target) return wander(c, dt);
    const n = sizeOf(c.target.type);
    if (goTo(c, c.target.x + n / 2, c.target.y + n / 2 - 0.2, 0.7, dt)) { if (e === "kiln") c.target.newt = S.t + 1; else c.target.goat = S.t + 1; }
    return;
  }
  if (e === "owl") {
    wander(c, dt, 0.5);
    if (!E.isDay(c.plot)) for (const o of RT.actors || []) if (o.type === "moonwell" && Math.abs(o.x + 1 - c.x) <= 3 && Math.abs(o.y + 1 - c.y) <= 3) o.owl = S.t + 1;
    return;
  }
  if (e === "skink" || e === "prism") {
    wander(c, dt, 1.1);
    const t = copyAt(Math.floor(c.x), Math.floor(c.y));
    if (t && t.type === "track") for (const m of t.m) {
      if (e === "skink" && !(m.f & 1)) { m.f |= 1; m.v += Math.log10(1.1); }
      if (e === "prism" && m.h === 0) m.h = [1, 2, 4][Math.floor(Math.random() * 3)];
    }
  }
}

/* ---------- Night Shift ---------- */
export function nightIndex() {
  const [d, n] = E.dayLengths();
  return Math.floor(S.t / (d + n));
}
export { HUES, TYPES, pk, tk };

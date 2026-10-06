/* heroes.js — champions: their skills, their judgement, and your hands on them.
 *
 * A champion runs in one of two modes, switched any time:
 *   - auto: it takes orders like any unit, and on top of them it decides for
 *     itself when each of its four skills is worth casting (autoCast below);
 *   - manual: you drive it, the way a champion is driven in a MOBA — a stick
 *     to walk, an attack button that picks the nearest foe, four skills you
 *     tap to cast at the obvious target or drag to aim.
 * Any ordinary unit can be taken in hand the same way; it just has no skills.
 *
 * Skills scale with the champion's attack, which scales with its level and
 * with your era — so a champion is never left behind by an era change. */

import { G, emit, on } from "./state.js";
import { TILE, HEROES, HERO_MAX_LEVEL, heroXpFor } from "./data.js";
import { damage, heal, near, hostile, findTarget, spawnUnit, refreshUnit, gap, tileOf } from "./entities.js";
import { skillshot, burst } from "./combat.js";
import { fight, step, requestPath, tryMove, speedOf, setOrder } from "./units.js";
import { HERO_LINES } from "./lore.js";

export const manual = { uid: 0, mx: 0, my: 0, attack: false, moveTo: null, target: 0 };

/* ---------------- experience ---------------- */
on("xp", (u, v) => {
  if (!u.hero || u.dead) return;
  u.xp += v;
  let up = false;
  while (u.lvl < HERO_MAX_LEVEL && u.xp >= heroXpFor(u.lvl)) { u.xp -= heroXpFor(u.lvl); u.lvl++; up = true; }
  const h = G.heroes[u.hero];
  if (h) { h.lvl = u.lvl; h.xp = u.xp; }
  if (up) { refreshUnit(u); u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.3); emit("heroLevel", u); }
});
on("death", (e) => { if (e.hero && e.team === 0) emit("toast", HEROES[e.hero].name + ": " + HERO_LINES[e.hero].fall, "bad"); if (manual.uid === e.id) release(); });

export function skillsOf(u) {
  if (!u.hero) return [];
  return HEROES[u.hero].skills.map((s, i) => ({ ...s, i, ready: (u.skcd[i] || 0) <= 0, cd: u.skcd[i] || 0, locked: i === 3 && u.lvl < 6 }));
}

/* ---------------- taking control ---------------- */
export function possess(u) {
  if (!u || u.dead || u.team !== 0) return;
  if (manual.uid && manual.uid !== u.id) release();
  u.manual = true; manual.uid = u.id; manual.mx = manual.my = 0; manual.attack = false; manual.moveTo = null; manual.target = 0;
  if (u.hero && G.heroes[u.hero]) G.heroes[u.hero].mode = "manual";
  u.oq.length = 0; u.order = { t: "idle" }; u.path = null;
  emit("possess", u);
}
export function release() {
  const u = G.ents.get(manual.uid);
  if (u) { u.manual = false; u.home = { x: u.x, y: u.y }; u.order = { t: "idle" }; if (u.hero && G.heroes[u.hero]) G.heroes[u.hero].mode = "auto"; }
  manual.uid = 0;
  emit("possess", null);
}
export const controlled = () => { const u = manual.uid && G.ents.get(manual.uid); return u && !u.dead ? u : null; };

/* ---------------- the tick ---------------- */
/** Returns true if it took the unit's whole tick (dashing, or under your hand). */
export function updateHero(u, dt) {
  if (u.hero) {
    for (let i = 0; i < 4; i++) if (u.skcd[i] > 0) u.skcd[i] -= dt;
    if (G.time - u.lastHit > 5 && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.012 * dt);
  }
  if (u.dash) {
    const d = u.dash;
    if (G.time >= d.until) { u.dash = null; }
    else {
      const sp = d.speed * dt;
      if (!tryMove(u, u.x + d.vx * sp, u.y + d.vy * sp)) u.dash = null;
      if (d.dmg) near(u.x, u.y, 40, (e) => {
        if (!hostile(u, e) || e.kind !== "unit" || d.hit.has(e.id) || Math.hypot(e.x - u.x, e.y - u.y) > u.r + e.r + 6) return;
        d.hit.add(e.id); damage(e, d.dmg, u, "dash");
        tryMove(e, e.x + d.vx * 24, e.y + d.vy * 24);
        e.stun = Math.max(e.stun, G.time + 0.5);
      });
      u.moving = true; u.face = Math.atan2(d.vy, d.vx);
      return true;
    }
  }
  if (u.stun > G.time) return true;
  if (u.manual) { manualTick(u, dt); return true; }
  if (u.hero) {
    u.think = (u.think || 0) - dt;
    if (u.think <= 0) { u.think = 0.45; autoCast(u); retreat(u); }
  }
  return false;
}

function manualTick(u, dt) {
  if (u.cd > 0) u.cd -= dt * (u.buffs.rally > G.time ? 1.3 : 1) * (u.buffs.overclock > G.time ? 1.6 : 1);
  if (u.atkAnim > 0) u.atkAnim -= dt;
  const m = manual;
  const mag = Math.hypot(m.mx, m.my);
  if (mag > 0.15) {
    m.moveTo = null; m.target = 0; u.path = null;
    const sp = speedOf(u) * Math.min(1, mag) * dt, nx = m.mx / mag, ny = m.my / mag;
    if (!tryMove(u, u.x + nx * sp, u.y + ny * sp)) { if (!tryMove(u, u.x + nx * sp, u.y)) tryMove(u, u.x, u.y + ny * sp); }
    u.face = Math.atan2(ny, nx); u.moving = true;
    return;
  }
  let t = m.target && G.ents.get(m.target);
  if (t && (t.dead || !hostile(u, t))) { t = null; m.target = 0; }
  if (!t && m.attack) {
    t = findTarget(u, (u.st.range + 4) * TILE);
    if (t) m.target = t.id;
    m.attack = false;
  }
  if (t) { fight(u, t, dt, true); return; }
  if (m.moveTo) {
    if (!u.goal || u.goal !== m.moveTo) requestPath(u, m.moveTo);
    if (step(u, dt) === "arrived") m.moveTo = null;
    return;
  }
  u.moving = false;
  // standing still, a champion still swings at whatever walks into reach
  const near1 = findTarget(u, u.st.range * TILE + 4);
  if (near1) fight(u, near1, dt, false);
}

/* ---------------- casting ---------------- */
/** aim: { x, y } a point, or { id } a target, or nothing (the obvious choice). */
export function cast(u, i, aim) {
  if (!u || !u.hero || u.dead || u.stun > G.time) return false;
  const S = HEROES[u.hero].skills[i];
  if (!S || (u.skcd[i] || 0) > 0 || (i === 3 && u.lvl < 6)) return false;
  const p = u.st.atk, R = S.range * TILE;
  const foe = (r) => findTarget(u, r);
  let tx, ty, t = null;
  if (aim && aim.id) t = G.ents.get(aim.id);
  if (aim && aim.x !== undefined) { tx = aim.x; ty = aim.y; }
  if (S.aim === "target") {
    if (!t || t.dead || !hostile(u, t)) t = aim && aim.x !== undefined ? nearestTo(u, tx, ty, R + TILE) : foe(R + TILE);
    if (!t || gap(u, t) > R + TILE) return false;
  }
  if (S.aim === "dir" || S.aim === "ground") {
    if (tx === undefined) {
      const f = foe(R + 2 * TILE);
      if (f) { tx = f.x; ty = f.y; } else if (S.aim === "dir") { tx = u.x + Math.cos(u.face) * R; ty = u.y + Math.sin(u.face) * R; } else return false;
    }
    if (S.aim === "ground") { const d = Math.hypot(tx - u.x, ty - u.y); if (d > R) { tx = u.x + (tx - u.x) / d * R; ty = u.y + (ty - u.y) / d * R; } }
  }
  const dx = (tx || 0) - u.x, dy = (ty || 0) - u.y, dl = Math.hypot(dx, dy) || 1;
  const allies = (r, fn) => near(u.x, u.y, r, (e) => { if (!e.dead && e.team === u.team && Math.hypot(e.x - u.x, e.y - u.y) <= r + (e.r || 0)) fn(e); });
  switch (S.id) {
    case "bash": damage(t, p * 1.6, u, "bash"); t.stun = G.time + 1.2; u.face = Math.atan2(t.y - u.y, t.x - u.x); break;
    case "rally": allies(R, (e) => { if (e.kind === "unit") e.buffs.rally = G.time + 6; }); break;
    case "charge": u.dash = { vx: dx / dl, vy: dy / dl, speed: R / 0.35, until: G.time + 0.35, dmg: p * 1.2, hit: new Set() }; break;
    case "bulwark": u.buffs.bulwark = G.time + 6; u.taunt = G.time + 6; break;
    case "volley": for (let k = -3; k <= 3; k++) { const a = Math.atan2(dy, dx) + k * 0.13; skillshot(u, u.x, u.y, Math.cos(a), Math.sin(a), 6, p * 0.9, { shot: "hero" }); } break;
    case "mark": t.buffs.marked = G.time + 8; G.temp.push({ x: t.x, y: t.y, r: 3, until: G.time + 2 }); break;
    case "tumble": { const k = aim ? 1 : -1; u.dash = { vx: k * dx / dl, vy: k * dy / dl, speed: R / 0.25, until: G.time + 0.25, hit: new Set() }; u.buffs.tumble = G.time + 4; break; }
    case "hail": zone({ x: tx, y: ty, r: S.radius * TILE, every: 0.5, n: 6, dmg: p * 0.8, team: u.team, by: u.id, kind: "hail" }); break;
    case "bolt": skillshot(u, u.x, u.y, dx, dy, 8, p * 2.8, { shot: "bolt2", splash: 1.2, speed: 16 }); break;
    case "mend": allies(R, (e) => { if (e.kind === "unit") heal(e, e.maxHp * 0.25 + p * 0.5, u); }); break;
    case "blink": {
      let o = { tx: tileOf(tx), ty: tileOf(ty) };
      if (!G.world.passable(o.tx, o.ty, "land")) o = G.world.nearestOpen(o.tx, o.ty, "land", 4);
      if (!o) return false;
      emit("blink", u, u.x, u.y);
      u.x = u.px = (o.tx + 0.5) * TILE; u.y = u.py = (o.ty + 0.5) * TILE; u.path = null;
      break;
    }
    case "cataclysm": zone({ x: tx, y: ty, r: S.radius * TILE, at: G.time + 1.5, dmg: p * 6, team: u.team, by: u.id, kind: "cataclysm" }); break;
    case "rend": {
      const a = Math.atan2(u.y - t.y, u.x - t.x);
      if (tryMove(u, t.x + Math.cos(a) * (t.r + u.r + 2), t.y + Math.sin(a) * (t.r + u.r + 2))) { u.px = u.x; u.py = u.y; }
      damage(t, p * 2.6, u, "rend"); u.face = Math.atan2(t.y - u.y, t.x - u.x);
      break;
    }
    case "veil": u.buffs.veil = G.time + 5; break;
    case "caltrops": zone({ x: tx, y: ty, r: S.radius * TILE, every: 0.5, n: 10, dmg: p * 0.3, slow: true, team: u.team, by: u.id, kind: "caltrops" }); break;
    case "execute": damage(t, t.kind === "bld" ? p * 2 : p * 4 + 0.4 * (t.maxHp - t.hp), u, "execute"); break;
    case "turret": {
      const tu = spawnUnit("ranged", Math.max(0, G.era), u.team, tx, ty, { free: true, expire: G.time + 20, stance: "hold", turret: true, cls: "sie", r: 12 });
      tu.st.range = 5.5; tu.st.speed = 0; tu.st.atk = p * 0.6; tu.st.hitsAir = true; tu.st.shot = tu.st.shot || "arrow";
      setOrder(tu, { t: "hold" });
      break;
    }
    case "pulse": allies(R, (e) => { if (e.kind === "bld" || (e.st && e.st.mech)) heal(e, e.maxHp * 0.2, u); }); break;
    case "mine": zone({ x: tx, y: ty, r: S.radius * TILE, trap: true, until: G.time + 90, dmg: p * 3.5, team: u.team, by: u.id, kind: "mine" }); break;
    case "overclock": allies(R, (e) => { if (e.kind === "unit") e.buffs.overclock = G.time + 8; }); break;
  }
  u.skcd[i] = S.cd;
  u.atkAnim = 0.3;
  if (u.buffs.veil > G.time && S.id !== "veil") u.buffs.veil = 0;   // striking breaks the veil
  emit("skill", u, S, { x: tx, y: ty, t });
  return true;
}
function nearestTo(u, x, y, r) {
  let best = null, bd = r;
  near(x, y, r, (e) => { if (!hostile(u, e)) return; const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; } });
  return best;
}

/* ---------------- lingering effects ---------------- */
function zone(z) { (G.zones || (G.zones = [])).push(Object.assign({ t0: G.time, next: G.time }, z)); emit("zone", z); }
export function updateZones() {
  if (!G.zones || !G.zones.length) return;
  for (const z of G.zones) {
    const src = G.ents.get(z.by) || { team: z.team, dead: true };
    if (z.at !== undefined) { if (G.time >= z.at) { burst(z.x, z.y, z.r, z.dmg, src); z.done = true; emit("zoneHit", z); } continue; }
    if (z.trap) {
      if (G.time > z.until) { z.done = true; continue; }
      let hit = false;
      near(z.x, z.y, 40, (e) => { if (!hit && hostile({ team: z.team }, e) && e.kind === "unit" && !e.st.air && Math.hypot(e.x - z.x, e.y - z.y) < 28) hit = true; });
      if (hit) { burst(z.x, z.y, z.r, z.dmg, src); z.done = true; emit("zoneHit", z); }
      continue;
    }
    if (G.time >= z.next) {
      z.next = G.time + z.every; z.n--;
      burst(z.x, z.y, z.r, z.dmg, src, z.slow ? { each: (e) => { e.slow = G.time + 1; } } : null);
      if (z.n <= 0) z.done = true;
    }
  }
  G.zones = G.zones.filter((z) => !z.done);
}

/* ---------------- judgement ---------------- */
function autoCast(u) {
  const S = HEROES[u.hero].skills;
  const ready = (i) => (u.skcd[i] || 0) <= 0 && !(i === 3 && u.lvl < 6);
  const foes = [];
  near(u.x, u.y, u.st.sight * TILE, (e) => { if (hostile(u, e) && e.kind === "unit" && !e.st.air && Math.hypot(e.x - u.x, e.y - u.y) < u.st.sight * TILE) foes.push(e); });
  if (!foes.length) {
    if (u.hero === "sage" && ready(1) && hurtAllies(u, 5, 0.7) >= 2) cast(u, 1);
    if (u.hero === "artificer" && ready(1) && damagedMachines(u, 6) >= 1) cast(u, 1);
    return;
  }
  const dist = (e) => Math.hypot(e.x - u.x, e.y - u.y);
  foes.sort((a, b) => dist(a) - dist(b));
  const f0 = foes[0], d0 = dist(f0) / TILE;
  const cluster = (r) => { let best = null, bn = 0; for (const a of foes) { let n = 0; for (const b of foes) if (Math.hypot(a.x - b.x, a.y - b.y) < r * TILE) n++; if (n > bn) { bn = n; best = a; } } return { at: best, n: bn }; };
  const hpK = u.hp / u.maxHp;
  switch (u.hero) {
    case "warden":
      if (ready(3) && hpK < 0.55 && foes.length >= 3) cast(u, 3);
      if (ready(0) && d0 < 2.4) cast(u, 0, { id: f0.id });
      if (ready(2) && d0 > 3 && d0 < 6) cast(u, 2, { x: f0.x, y: f0.y });
      if (ready(1) && foes.length >= 3) cast(u, 1);
      break;
    case "huntress": {
      if (ready(2) && d0 < 1.6) cast(u, 2, { x: u.x - (f0.x - u.x) * 4, y: u.y - (f0.y - u.y) * 4 });
      const c = cluster(4);
      if (ready(3) && c.n >= 4 && dist(c.at) < S[3].range * TILE) cast(u, 3, { x: c.at.x, y: c.at.y });
      const big = foes.slice().sort((a, b) => b.maxHp - a.maxHp)[0];
      if (ready(1) && dist(big) < S[1].range * TILE) cast(u, 1, { id: big.id });
      if (ready(0) && d0 < 5.5 && foes.length >= 2) cast(u, 0, { x: f0.x, y: f0.y });
      break;
    }
    case "sage": {
      if (ready(2) && hpK < 0.35 && d0 < 2.5) cast(u, 2, { x: u.x - (f0.x - u.x) * 3, y: u.y - (f0.y - u.y) * 3 });
      if (ready(1) && (hurtAllies(u, 5, 0.7) >= 2 || hpK < 0.5)) cast(u, 1);
      const c = cluster(5);
      if (ready(3) && c.n >= 5 && dist(c.at) < S[3].range * TILE) cast(u, 3, { x: c.at.x, y: c.at.y });
      if (ready(0) && d0 < 8) cast(u, 0, { x: f0.x, y: f0.y });
      break;
    }
    case "shade": {
      if (ready(1) && hpK < 0.35) cast(u, 1);
      const weak = foes.filter((e) => dist(e) < 3 * TILE && e.hp / e.maxHp < 0.45)[0];
      if (ready(3) && weak) cast(u, 3, { id: weak.id });
      const c = cluster(3);
      if (ready(2) && c.n >= 3 && dist(c.at) < 6 * TILE) cast(u, 2, { x: c.at.x, y: c.at.y });
      if (ready(0) && d0 < 5) cast(u, 0, { id: foes.slice().sort((a, b) => a.hp - b.hp)[0].id });
      break;
    }
    case "artificer": {
      if (ready(0) && d0 < 6) cast(u, 0, { x: u.x + (f0.x - u.x) * 0.4, y: u.y + (f0.y - u.y) * 0.4 });
      if (ready(1) && damagedMachines(u, 6) >= 1) cast(u, 1);
      if (ready(2) && d0 < 5) cast(u, 2, { x: f0.x, y: f0.y });
      if (ready(3) && foes.length >= 3 && alliesNear(u, 8) >= 4) cast(u, 3);
      break;
    }
  }
}
function hurtAllies(u, r, k) { let n = 0; near(u.x, u.y, r * TILE, (e) => { if (e.kind === "unit" && e.team === u.team && !e.dead && e.hp / e.maxHp < k) n++; }); return n; }
function damagedMachines(u, r) { let n = 0; near(u.x, u.y, r * TILE, (e) => { if (e.team === u.team && !e.dead && (e.kind === "bld" || (e.st && e.st.mech)) && e.hp / e.maxHp < 0.8) n++; }); return n; }
function alliesNear(u, r) { let n = 0; near(u.x, u.y, r * TILE, (e) => { if (e.kind === "unit" && e.team === u.team && !e.dead) n++; }); return n; }
/** A champion on its own judgement does not die for nothing: badly hurt, it walks home. */
function retreat(u) {
  if (u.hp / u.maxHp > 0.2 || u.order.t === "move" || G.time - u.lastHit > 4) return;
  const hall = G.blds.find((b) => !b.dead && b.team === 0 && (b.type === "hall" || b.type === "outpost") && b.built >= 1);
  if (hall) setOrder(u, { t: "move", x: hall.x, y: hall.y + hall.h * TILE * 0.7 });
}

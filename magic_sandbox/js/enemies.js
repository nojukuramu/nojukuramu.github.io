/* enemies.js — the Unravelled, the Anchors that hold them, and the Wardens.
 *
 * The rule every attack here follows: it is announced before it lands. A
 * Knot crouches and a lane lights up on the ground before it lunges; a Golem
 * raises its fists over a circle that fills as the slam comes due; a Spindle
 * glows before it fires. The first version's enemies mostly did damage by
 * touching you, which is not a fight, it is a tax. If you get hit here, you
 * were shown where and when.
 *
 * Status effects from spells live on the enemy: burning (damage over time),
 * chill (slows, and three stacks freeze), mire (slowed while standing in it)
 * and a Weaver's shield (absorbs damage before health). */

import * as THREE from "three";
import { S, emit } from "./state.js";
import { scene, camera, addShake } from "./gfx.js";
import * as fx from "./fx.js";
import { buildEnemy, buildAnchor, buildWarden, buildHeart, halo } from "./models.js";
import { enemyShot } from "./spells.js";
import { floorScale, DANGER, ENEMY_SHOT } from "./themes.js";
import { TAU, clamp, dist, rand, pick, angDiff } from "./util.js";

export const TYPES = {
  mote:    { name: "Mote",    hp: 10,   speed: 6.0, r: 0.38, dmg: 6,  xp: 2,   aggro: 15, kbRes: 1.2 },
  knot:    { name: "Knot",    hp: 30,   speed: 3.6, r: 0.62, dmg: 12, xp: 5,   aggro: 13, kbRes: 1 },
  spindle: { name: "Spindle", hp: 24,   speed: 3.0, r: 0.55, dmg: 7,  xp: 6,   aggro: 15, kbRes: 1 },
  golem:   { name: "Golem",   hp: 95,   speed: 2.2, r: 1.05, dmg: 18, xp: 12,  aggro: 12, kbRes: 0.35 },
  weaver:  { name: "Weaver",  hp: 34,   speed: 2.8, r: 0.5,  dmg: 0,  xp: 8,   aggro: 16, kbRes: 1 },
  anchor:  { name: "Anchor",  hp: 300,  speed: 0,   r: 1.5,  dmg: 0,  xp: 30,  aggro: 20, kbRes: 0 },
  dummy:   { name: "Dummy",   hp: 1e9,  speed: 0,   r: 0.45, dmg: 0,  xp: 0,   aggro: 0,  kbRes: 0 },
  geode:   { name: "Geode",   hp: 14,   speed: 0,   r: 0.8,  dmg: 0,  xp: 0,   aggro: 0,  kbRes: 0 },
  warden:  { name: "Warden",  hp: 720,  speed: 2.8, r: 1.55, dmg: 16, xp: 80,  aggro: 0,  kbRes: 0.06 },
  heart:   { name: "The Loom Heart", hp: 2100, speed: 0, r: 2.2, dmg: 18, xp: 200, aggro: 0, kbRes: 0 }
};
const ELITES = {
  swift:    { name: "Swift",    color: 0x7fe0ff },
  hardy:    { name: "Hardy",    color: 0xffd97a },
  volatile: { name: "Volatile", color: 0xff7043 }
};

/* ---------------------------------------------------------------
   Health bars that float over hurt enemies (pooled, camera-facing)
   --------------------------------------------------------------- */
const barGeo = new THREE.PlaneGeometry(1, 0.13).translate(0.5, 0, 0);
const bars = [];
function getBar() {
  let b = bars.find((x) => !x.used);
  if (!b) {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0x0b0e14, transparent: true, opacity: 0.75, depthTest: false }));
    const shield = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0x9fe3ff, depthTest: false }));
    const fill = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({ color: 0xe05555, depthTest: false }));
    bg.scale.set(1.04, 1.5, 1); bg.position.set(-0.02, 0, 0);
    [bg, shield, fill].forEach((m, i) => { m.renderOrder = 20 + i; g.add(m); });
    shield.position.z = 0.001; fill.position.z = 0.002;
    scene.add(g);
    b = { g, fill, shield, used: false };
    bars.push(b);
  }
  b.used = true; b.g.visible = true;
  return b;
}
function freeBar(b) { if (b) { b.used = false; b.g.visible = false; } }

/* ---------------------------------------------------------------
   Spawning
   --------------------------------------------------------------- */
export function spawnEnemy(type, x, z, opts) {
  opts = opts || {};
  const T = TYPES[type];
  const sc = floorScale(S.floor);
  const accent = S.world ? S.world.theme.accent : 0xff5ea8;
  let built;
  if (type === "anchor") built = buildAnchor(accent);
  else if (type === "warden") built = buildWarden(accent);
  else if (type === "heart") built = buildHeart(accent);
  else built = buildEnemy(type, accent);
  const hp = T.hp * (type === "dummy" ? 1 : sc.hp);
  const e = {
    type, name: T.name, x, z, vx: 0, vz: 0, r: T.r, hp, maxHp: hp, dmg: T.dmg * sc.dmg, speed: T.speed,
    xp: Math.round(T.xp * (1 + 0.08 * (S.floor - 1))), kbRes: T.kbRes, aggroR: T.aggro,
    alive: true, aggro: !!opts.aggro, home: { x, z }, face: rand(0, TAU),
    state: "idle", t: rand(0.5, 2), atkCd: rand(0.6, 2.2), wander: null,
    kbx: 0, kbz: 0, burn: null, chill: 0, chillT: 0, chillSlow: 0, frozen: 0, mire: 0, mireT: 0, shield: 0,
    flashT: 0, hpShowT: 0, pop: 0, anim: rand(0, 10), mesh: built, bar: null, owner: opts.owner || null, spawned: 0,
    boss: type === "warden" || type === "heart", phase: 0, dmgLog: []
  };
  if (!e.boss && type !== "anchor" && type !== "dummy" && type !== "geode" && opts.elite !== false && S.floor >= 3 && Math.random() < 0.06 + S.floor * 0.012) {
    e.elite = pick(Object.keys(ELITES));
    e.xp *= 2;
    if (e.elite === "swift") e.speed *= 1.45;
    else if (e.elite === "hardy") { e.hp *= 2.2; e.maxHp *= 2.2; e.r *= 1.2; built.root.scale.setScalar(1.25); }
    const h = halo(ELITES[e.elite].color, e.r * 5, 0.45);
    h.position.y = 0.8; built.root.add(h);
  }
  if ((type === "anchor" || type === "geode") && S.world) e.collider = S.world.addDynamic(x, z, e.r);
  built.root.position.set(x, 0, z);
  scene.add(built.root);
  S.enemies.push(e);
  if (opts.pop) { e.pop = 0.001; fx.burst(x, 0.8, z, accent, 14, 5, { size: 0.35 }); fx.ring(x, z, accent, 0.3, 2, 0.4); }
  return e;
}

/* ---------------------------------------------------------------
   Queries
   --------------------------------------------------------------- */
export function enemiesNear(x, z, r) {
  const out = [];
  for (const e of S.enemies) {
    if (!e.alive) continue;
    const dx = e.x - x, dz = e.z - z, rr = r + e.r;
    if (dx * dx + dz * dz <= rr * rr) out.push(e);
  }
  return out;
}

/* ---------------------------------------------------------------
   Being hurt
   --------------------------------------------------------------- */
let quietNumberT = 0;
export function hurtEnemy(e, dmg, o) {
  if (!e.alive) return;
  o = o || {};
  if (e.invuln) { if (!o.quiet) fx.number(e.x, 2.2, e.z, "immune", "info"); return; }
  if (!e.aggro && e.type !== "geode") alert(e);
  if (e.type === "dummy") {
    e.dmgLog.push({ t: S.time, d: dmg });
    e.flashT = 0.12; e.wobble = 1;
    if (!o.quiet || quietNumberT <= 0) fx.number(e.x, 2.1, e.z, Math.round(dmg), dmg >= 40 ? "big" : "");
    if (o.quiet) quietNumberT = 0.25;
    if (o.burn) e.burn = { dps: Math.max(o.burn, e.burn ? e.burn.dps : 0), t: 3, acc: 0 };
    if (o.chill) applyChill(e, o.chill);
    return;
  }
  if (e.shield > 0) {
    const took = Math.min(e.shield, dmg);
    e.shield -= took; dmg -= took;
    fx.burst(e.x, 1.2, e.z, 0x9fe3ff, 4, 3, { size: 0.25 });
    if (e.shield <= 0) { e.shield = 0; setBubble(e, false); fx.ring(e.x, e.z, 0x9fe3ff, 0.5, 1.8, 0.3, 1); emit("shieldBreak"); }
  }
  if (dmg > 0) {
    e.hp -= dmg;
    e.flashT = 0.1;
    e.hpShowT = 3;
    const big = dmg >= 40;
    if (!o.quiet || quietNumberT <= 0) fx.number(e.x + rand(-0.3, 0.3), (e.boss ? 3.6 : 1.9), e.z, Math.max(1, Math.round(dmg)), big ? "big" : o.quiet ? "tick" : "");
    if (o.quiet) quietNumberT = 0.2;
    emit("hitEnemy", e, dmg);
  }
  if (o.kbx || o.kbz) { e.kbx += (o.kbx || 0) * e.kbRes; e.kbz += (o.kbz || 0) * e.kbRes; }
  if (o.burn) e.burn = { dps: Math.max(o.burn, e.burn ? e.burn.dps : 0), t: 3 * (1 + (S.player ? S.player.mods.burn * 0.5 : 0)), acc: 0 };
  if (o.chill) applyChill(e, o.chill);
  if (o.slow) { e.mire = Math.max(e.mire, o.slow); e.mireT = 0.45; }
  if (e.hp <= 0) kill(e);
}

function applyChill(e, slow) {
  const freezeAt = S.player && S.player.mods.chill > 0 ? 2 : 3;
  e.chill = Math.min(freezeAt, e.chill + 1);
  e.chillT = 2.2; e.chillSlow = Math.max(e.chillSlow, slow);
  if (e.chill >= freezeAt && !e.boss && e.type !== "anchor") {
    e.frozen = 1.3; e.chill = 0;
    fx.burst(e.x, 1, e.z, 0xbfe8ff, 12, 4, { size: 0.3, grav: 4 });
    emit("freeze");
  }
}

function alert(e) {
  if (e.aggro || e.type === "anchor" || e.type === "dummy" || e.boss) { e.aggro = true; return; }
  e.aggro = true;
  fx.number(e.x, 2.4, e.z, "!", "alert");
  // wake the rest of the camp
  for (const o of S.enemies) if (!o.aggro && o.alive && !o.boss && o.type !== "anchor" && dist(o.x, o.z, e.x, e.z) < 7) { o.aggro = true; }
}

export function kill(e, silent) {
  if (!e.alive) return;
  e.alive = false;
  e.dying = e.boss ? 2.2 : e.type === "anchor" ? 1.4 : 0.45;
  e.dieMax = e.dying;
  freeBar(e.bar); e.bar = null;
  setBubble(e, false);
  if (e.collider) e.collider.on = false;
  if (silent) return;
  const accent = S.world ? S.world.theme.accent : 0xffffff;
  fx.burst(e.x, 1, e.z, accent, e.boss ? 60 : e.type === "anchor" ? 40 : 14, e.boss ? 10 : 6, { size: 0.4 });
  fx.burst(e.x, 1, e.z, 0xffffff, e.boss ? 20 : 6, 4, { size: 0.3 });
  fx.ring(e.x, e.z, accent, 0.4, e.boss ? 9 : e.type === "anchor" ? 6 : 2.4, e.boss ? 0.9 : 0.4);
  if (e.elite === "volatile") {
    for (let k = 0; k < 8; k++) enemyShot(e.x, e.z, k / 8 * TAU, 8, e.dmg * 0.8, { src: "a volatile blast" });
    fx.flash(e.x, 1.5, e.z, 0xff7043, 20, 0.3, 10);
  }
  if (e.boss || e.type === "anchor") { addShake(e.boss ? 1.2 : 0.6); S.slowmo = e.boss ? 1.4 : 0.35; }
  else S.hitstop = Math.max(S.hitstop, e.type === "golem" ? 0.06 : 0.025);
  if (e.type !== "geode") S.kills++;
  emit("kill", e);
}

/* ---------------------------------------------------------------
   Movement helpers
   --------------------------------------------------------------- */
function steer(e, ang, speed) {
  // Probe ahead; if something solid is in the way, try turning around it.
  const W = S.world;
  if (W) {
    const probe = e.r + 1.1;
    for (const off of [0, 0.7, -0.7, 1.35, -1.35, 2.1, -2.1]) {
      const a = ang + off * (e.steerSide || 1);
      if (!W.hitCollider(e.x + Math.cos(a) * probe, e.z + Math.sin(a) * probe, e.r * 0.8)) {
        if (off !== 0 && !e.steerSide) e.steerSide = Math.random() < 0.5 ? 1 : -1;
        e.vx = Math.cos(a) * speed; e.vz = Math.sin(a) * speed; return;
      }
    }
  }
  e.vx = Math.cos(ang) * speed; e.vz = Math.sin(ang) * speed;
}
function stop(e) { e.vx = 0; e.vz = 0; }

/* ---------------------------------------------------------------
   Per frame
   --------------------------------------------------------------- */
export function update(dt) {
  const P = S.player;
  quietNumberT -= dt;
  for (let i = S.enemies.length - 1; i >= 0; i--) {
    const e = S.enemies[i];
    if (!e.alive) { if (dieStep(e, dt)) { disposeEnemy(e); S.enemies.splice(i, 1); } continue; }
    e.anim += dt;
    if (e.pop > 0 && e.pop < 1) e.pop = Math.min(1, e.pop + dt / 0.3);
    // statuses
    if (e.burn) {
      e.burn.t -= dt; e.burn.acc += dt;
      if (Math.random() < dt * 12) fx.emit(e.x + rand(-0.3, 0.3), 0.8 + rand(0, 1), e.z + rand(-0.3, 0.3), 0, rand(1, 2.2), 0, 0.45, 0.28, 0.02, 0xff7a2a, 1, -1, 0.5);
      if (e.burn.acc >= 0.5) { e.burn.acc -= 0.5; hurtEnemy(e, e.burn.dps * 0.5, { quiet: true }); if (!e.alive) continue; }
      if (e.burn && e.burn.t <= 0) e.burn = null;
    }
    if (e.chillT > 0) { e.chillT -= dt; if (e.chillT <= 0) { e.chill = 0; e.chillSlow = 0; } }
    if (e.mireT > 0) { e.mireT -= dt; if (e.mireT <= 0) e.mire = 0; }
    const slow = e.frozen > 0 ? 1 : clamp(Math.max(e.chillT > 0 ? e.chillSlow : 0, e.mire), 0, 0.85);
    if (e.frozen > 0) e.frozen -= dt;
    // aggro
    const dP = P ? dist(e.x, e.z, P.x, P.z) : 999;
    const aP = P ? Math.atan2(P.z - e.z, P.x - e.x) : 0;
    if (P && P.alive && !e.aggro && e.aggroR && dP < e.aggroR) alert(e);
    if (e.aggro && !e.boss && e.type !== "anchor" && dP > 34) { e.aggro = false; e.state = "idle"; }
    // behaviour
    const brain = BRAINS[e.type];
    if (e.frozen > 0) stop(e);
    else if (brain) brain(e, dt, dP, aP, P);
    // move
    const k = e.frozen > 0 ? 0 : 1 - slow;
    e.x += (e.vx * k + e.kbx) * dt;
    e.z += (e.vz * k + e.kbz) * dt;
    const dk = Math.exp(-7 * dt); e.kbx *= dk; e.kbz *= dk;
    if (e.speed > 0) {
      if (S.world && e.type !== "heart") S.world.resolve(e, e.r);
      if (e.boss && S.world && S.world.arena) keepIn(e, S.world.arena, e.r);
      // separation
      for (const o of S.enemies) {
        if (o === e || !o.alive) continue;
        const dx = e.x - o.x, dz = e.z - o.z, min = e.r + o.r;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (min - d) * (o.speed === 0 || o.boss ? 1 : 0.5);
          e.x += dx / d * push; e.z += dz / d * push;
        }
      }
    }
    // contact damage for the things that bite
    if (P && P.alive && e.dmg > 0 && (e.type === "mote" || (e.type === "knot" && e.state === "lunge") || (e.boss && e.state === "charge"))) {
      if (dP < e.r + P.r + 0.15 && !e.bit) {
        const mult = e.type === "knot" ? 1 : e.boss ? 1.3 : 1;
        if (P.hurt(e.dmg * mult, aP, "a " + e.name)) {
          e.bit = true;
          if (e.type === "mote") { e.kbx -= Math.cos(aP) * 9; e.kbz -= Math.sin(aP) * 9; e.biteCd = 1; }
        }
      }
    }
    if (e.biteCd > 0) { e.biteCd -= dt; if (e.biteCd <= 0) e.bit = false; }
    if (e.type === "mote" && !e.biteCd) e.bit = false;
    // facing
    const moving = Math.hypot(e.vx, e.vz) > 0.2;
    const want = e.lockFace !== undefined ? e.lockFace : e.aggro && P ? aP : moving ? Math.atan2(e.vz, e.vx) : e.face;
    e.face += angDiff(e.face, want) * Math.min(1, dt * (e.type === "golem" ? 4 : 9));
    animate(e, dt, moving, slow);
    updateBar(e, dt);
  }
}

function keepIn(e, A, r) {
  const d = dist(e.x, e.z, A.x, A.z), lim = A.r - r - 0.3;
  if (d > lim) { e.x = A.x + (e.x - A.x) / d * lim; e.z = A.z + (e.z - A.z) / d * lim; }
}

function wander(e, dt) {
  if (dist(e.x, e.z, e.home.x, e.home.z) > 6) { returnHome(e); return; }
  e.t -= dt;
  if (!e.wander || e.t <= 0) {
    const a = rand(0, TAU), r = rand(0, 3);
    e.wander = { x: e.home.x + Math.cos(a) * r, z: e.home.z + Math.sin(a) * r };
    e.t = rand(1.5, 4);
  }
  const d = dist(e.x, e.z, e.wander.x, e.wander.z);
  if (d > 0.4) steer(e, Math.atan2(e.wander.z - e.z, e.wander.x - e.x), e.speed * 0.3); else stop(e);
}

function returnHome(e) {
  const d = dist(e.x, e.z, e.home.x, e.home.z);
  if (d > 1.5) steer(e, Math.atan2(e.home.z - e.z, e.home.x - e.x), e.speed * 0.8); else stop(e);
}

/* ---------------------------------------------------------------
   Brains
   --------------------------------------------------------------- */
const BRAINS = {
  mote(e, dt, dP, aP) {
    if (!e.aggro) { wander(e, dt); return; }
    const weave = Math.sin(e.anim * 5 + e.home.x) * 0.7;
    steer(e, aP + weave * clamp(dP / 6, 0, 1), e.speed);
  },
  knot(e, dt, dP, aP, P) {
    if (!e.aggro) { wander(e, dt); return; }
    e.atkCd -= dt;
    if (e.state === "wind") {
      stop(e); e.t -= dt;
      if (e.t <= 0) { e.state = "lunge"; e.t = 0.42; e.bit = false; emit("lunge", e); }
    } else if (e.state === "lunge") {
      e.vx = Math.cos(e.lockFace) * 17; e.vz = Math.sin(e.lockFace) * 17;
      e.t -= dt;
      if (Math.random() < 0.6) fx.emit(e.x, 0.5, e.z, 0, 0.5, 0, 0.3, 0.4, 0.05, S.world.theme.accent, 0.8, 0, 0);
      if (e.t <= 0) { e.state = "rest"; e.t = 0.65; }
    } else if (e.state === "rest") {
      stop(e); e.t -= dt;
      if (e.t <= 0) { e.state = "chase"; e.lockFace = undefined; }
    } else {
      e.state = "chase";
      e.lockFace = undefined;
      if (dP < 7.5 && e.atkCd <= 0 && S.world.clearLine(e.x, e.z, P.x, P.z)) {
        e.state = "wind"; e.t = 0.6; e.atkCd = 2.3; e.lockFace = aP;
        fx.decal(1, e.x, e.z, 0.7, DANGER, 0.6, { ang: aP, len: 8.5 });
      } else steer(e, aP, e.speed);
    }
  },
  spindle(e, dt, dP, aP, P) {
    if (!e.aggro) { wander(e, dt); return; }
    e.atkCd -= dt;
    if (e.state === "charge") {
      stop(e); e.t -= dt; e.lockFace = aP;
      if (e.t <= 0) {
        const n = S.floor >= 5 ? 5 : 3, spread = 0.24;
        for (let k = 0; k < n; k++) enemyShot(e.x, e.z, aP + (k - (n - 1) / 2) * spread / (n > 3 ? 1.6 : 1), 7.5 + S.floor * 0.2, e.dmg, { y: 1.2, src: "a Spindle's bolt" });
        e.state = "chase"; e.atkCd = rand(2.4, 3.2); e.lockFace = undefined;
        fx.flash(e.x, 1.2, e.z, S.world.theme.accent, 10, 0.2, 6);
        emit("enemyFire", e);
      }
      return;
    }
    if (dP > 11) steer(e, aP, e.speed);
    else if (dP < 7) steer(e, aP + Math.PI, e.speed);
    else { if (!e.strafe || Math.random() < dt * 0.4) e.strafe = Math.random() < 0.5 ? 1 : -1; steer(e, aP + e.strafe * Math.PI / 2, e.speed * 0.6); }
    if (e.atkCd <= 0 && dP < 14 && S.world.clearLine(e.x, e.z, P.x, P.z)) {
      e.state = "charge"; e.t = 0.75;
      fx.decal(1, e.x, e.z, 0.18, ENEMY_SHOT, 0.75, { ang: aP, len: Math.min(dP, 11), opacity: 0.5, fill: true });
    }
  },
  golem(e, dt, dP, aP, P) {
    if (!e.aggro) { wander(e, dt); return; }
    e.atkCd -= dt;
    if (e.state === "raise") {
      stop(e); e.t -= dt;
      if (e.t <= 0) {
        e.state = "rest"; e.t = 0.9;
        const R = 3.5;
        fx.ring(e.x, e.z, S.world.theme.accent, 0.5, R + 0.4, 0.45, 0.15);
        fx.burst(e.x, 0.3, e.z, 0x9a8f80, 22, 7, { size: 0.45, plain: true, grav: 10 });
        addShake(0.45);
        emit("slam", e);
        if (P && dist(e.x, e.z, P.x, P.z) < R + P.r) P.hurt(e.dmg, aP, "a Golem's slam", 14);
      }
    } else if (e.state === "rest") {
      stop(e); e.t -= dt; if (e.t <= 0) e.state = "chase";
    } else {
      e.state = "chase";
      if (dP < 3.3 && e.atkCd <= 0) {
        e.state = "raise"; e.t = 0.85; e.atkCd = 2.6;
        fx.decal(0, e.x, e.z, 3.5, DANGER, 0.85);
      } else steer(e, aP, e.speed);
    }
  },
  weaver(e, dt, dP, aP) {
    if (!e.aggro) { wander(e, dt); return; }
    e.atkCd -= dt;
    if (dP < 7) steer(e, aP + Math.PI, e.speed);
    else if (dP > 13) steer(e, aP, e.speed);
    else stop(e);
    if (e.state === "weave") {
      e.t -= dt;
      if (e.t <= 0) {
        e.state = "chase";
        let n = 0;
        for (const o of S.enemies) {
          if (n >= 3 || o === e || !o.alive || o.boss || o.type === "anchor" || o.type === "weaver") continue;
          if (dist(o.x, o.z, e.x, e.z) > 9) continue;
          o.shield = 22 + 7 * S.floor; setBubble(o, true);
          fx.bolt(e.x, 2.4, e.z, o.x, 1, o.z, 0x9fe3ff);
          n++;
        }
        if (n) emit("shield");
      }
    } else if (e.atkCd <= 0) { e.state = "weave"; e.t = 0.8; e.atkCd = 5.5; }
  },
  anchor(e, dt, dP) {
    stop(e);
    e.atkCd -= dt;
    if (dP < 20 && e.atkCd <= 0) {
      e.atkCd = 6.5;
      const mine = S.enemies.filter((o) => o.alive && o.owner === e).length;
      if (mine < 5) {
        const roll = Math.random();
        const kinds = S.floor >= 5 && roll < 0.3 ? ["spindle"] : S.floor >= 3 && roll < 0.6 ? ["knot"] : ["mote", "mote"];
        kinds.forEach((k) => {
          const a = rand(0, TAU);
          spawnEnemy(k, e.x + Math.cos(a) * 2.8, e.z + Math.sin(a) * 2.8, { aggro: true, pop: true, owner: e, elite: false });
        });
        emit("anchorSpawn", e);
      }
    }
  },
  geode(e) { stop(e); e.kbx = 0; e.kbz = 0; },
  dummy(e) {
    stop(e);
    e.dmgLog = e.dmgLog.filter((l) => S.time - l.t < 4);
  },
  warden(e, dt, dP, aP, P) { bossBrain(e, dt, dP, aP, P); },
  heart(e, dt, dP, aP, P) { bossBrain(e, dt, dP, aP, P); }
};

/* ---------------------------------------------------------------
   Bosses: one state machine, a library of announced attacks, and a
   set per theme. Floor 10's Loom Heart draws from all of them.
   --------------------------------------------------------------- */
const SETS = {
  verdant: ["ring", "slam", "summon", "charge"],
  sanctum: ["ring", "slam", "summon", "charge"],
  ember: ["rain", "ring", "charge", "slam"],
  frost: ["lances", "slam", "ring", "spiral"],
  void: ["blink", "spiral", "ring", "summon"],
  storm: ["lances", "rain", "charge", "ring"]
};
const HEART_SETS = [["ring", "spiral", "rain"], ["ring", "spiral", "rain", "lances", "summon"], ["spiral", "rain", "lances", "summon", "ring"]];

function phaseOf(e) {
  const r = e.hp / e.maxHp;
  if (e.type === "heart") return r > 0.66 ? 0 : r > 0.33 ? 1 : 2;
  return r > 0.5 ? 0 : 1;
}

function bossBrain(e, dt, dP, aP, P) {
  const A = S.world && S.world.arena;
  if (e.state === "idle" || e.state === "sleep") {
    e.state = "sleep"; stop(e); e.invuln = true;
    if (P && A && dist(P.x, P.z, A.x, A.z) < A.r - 1.2) {
      e.state = "intro"; e.t = 1.8; e.aggro = true;
      emit("bossIntro", e);
      fx.ring(e.x, e.z, S.world.theme.accent, 1, A.r, 1.2, 0.2);
      addShake(0.5);
    }
    return;
  }
  if (e.state === "intro") {
    stop(e); e.t -= dt;
    if (e.t <= 0) { e.state = "move"; e.t = 0.8; e.invuln = false; e.phase = 0; }
    return;
  }
  const ph = phaseOf(e);
  if (ph !== e.phase) {
    e.phase = ph;
    emit("bossPhase", e, ph);
    fx.ring(e.x, e.z, DANGER, 1, 9, 0.8, 0.3);
    addShake(0.6);
    // a phase change clears the air: every warning in flight resolves normally
  }
  if (e.state === "move") {
    e.t -= dt;
    if (e.type === "warden") {
      if (dP > 8) steer(e, aP, e.speed); else if (dP < 5) steer(e, aP + Math.PI, e.speed * 0.8);
      else steer(e, aP + Math.PI / 2 * (e.strafe || 1), e.speed * 0.7);
      if (Math.random() < dt * 0.5) e.strafe = -(e.strafe || 1);
    } else stop(e);
    if (e.t <= 0) startAttack(e, dP);
    return;
  }
  if (e.act) {
    const done = ACTS[e.act.name](e, e.act, dt, dP, aP, P);
    if (done) {
      e.act = null; e.state = "move"; e.lockFace = undefined;
      e.t = rand(0.9, 1.5) * (e.phase ? 0.7 : 1) * (e.type === "heart" ? 0.8 : 1);
    }
  }
}

function startAttack(e, dP) {
  const theme = S.world.theme.id;
  let set = e.type === "heart" ? HEART_SETS[e.phase || 0] : SETS[theme] || SETS.verdant;
  const adds = S.enemies.filter((o) => o.alive && !o.boss).length;
  set = set.filter((n) => n !== e.lastAct && !(n === "summon" && adds >= 4) && !(n === "slam" && dP > 12));
  const name = pick(set.length ? set : ["ring"]);
  e.lastAct = name;
  e.state = "act";
  e.act = { name, t: 0, step: 0 };
  emit("bossAttack", e, name);
}

const hot = (e) => (e.phase ? 1 : 0) + (e.type === "heart" ? e.phase * 0.5 : 0);

const ACTS = {
  ring(e, a, dt) {
    stop(e);
    if (a.step === 0) { a.step = 1; a.t = 0.6; fx.decal(0, e.x, e.z, 2.6, ENEMY_SHOT, 0.6, { opacity: 0.6 }); }
    a.t -= dt;
    if (a.step === 1 && a.t <= 0) {
      const n = 14 + Math.round(hot(e) * 6), off = rand(0, TAU);
      for (let k = 0; k < n; k++) enemyShot(e.x, e.z, off + k / n * TAU, 7.5, e.dmg * 0.7, { src: "the " + e.name, y: 1.4 });
      emit("bossFire", e); fx.flash(e.x, 2, e.z, ENEMY_SHOT, 18, 0.3, 12);
      if (hot(e) >= 1) { a.step = 2; a.t = 0.4; a.off = off + Math.PI / n; return false; }
      return true;
    }
    if (a.step === 2 && a.t <= 0) {
      const n = 20;
      for (let k = 0; k < n; k++) enemyShot(e.x, e.z, a.off + k / n * TAU, 6.5, e.dmg * 0.7, { src: "the " + e.name, y: 1.4 });
      return true;
    }
    return false;
  },
  slam(e, a, dt, dP, aP) {
    const R = 4.6;
    if (a.step === 0) {
      steer(e, aP, e.speed * 2);
      a.t += dt;
      if (dP < 3.6 || a.t > 0.8) { a.step = 1; a.t = 0.85 - hot(e) * 0.15; stop(e); fx.decal(0, e.x, e.z, R, DANGER, a.t); }
      return false;
    }
    stop(e);
    a.t -= dt;
    if (a.step === 1 && a.t <= 0) {
      fx.ring(e.x, e.z, S.world.theme.accent, 0.5, R + 0.5, 0.5, 0.15);
      fx.burst(e.x, 0.4, e.z, 0xa09080, 30, 9, { size: 0.5, plain: true });
      addShake(0.8); emit("slam", e);
      const P = S.player;
      if (P && dist(e.x, e.z, P.x, P.z) < R + P.r) P.hurt(e.dmg * 1.4, aP, "the " + e.name + "'s slam", 18);
      if (hot(e) >= 1) for (let k = 0; k < 12; k++) enemyShot(e.x, e.z, k / 12 * TAU, 6, e.dmg * 0.6, { src: "the " + e.name });
      a.step = 2; a.t = 0.5;
      return false;
    }
    return a.step === 2 && a.t <= 0;
  },
  charge(e, a, dt, dP, aP) {
    const W = S.world;
    if (a.step === 0) {
      stop(e); a.step = 1; a.t = 0.8 - hot(e) * 0.15; a.ang = aP; e.lockFace = aP;
      a.len = 15;
      fx.decal(1, e.x, e.z, 1.6, DANGER, a.t, { ang: aP, len: a.len });
      return false;
    }
    if (a.step === 1) { stop(e); a.t -= dt; if (a.t <= 0) { a.step = 2; a.dist = 0; e.state = "charge"; e.bit = false; emit("charge", e); } return false; }
    const sp = 22;
    e.vx = Math.cos(a.ang) * sp; e.vz = Math.sin(a.ang) * sp;
    a.dist += sp * dt;
    fx.emit(e.x, 0.5, e.z, 0, 1, 0, 0.35, 0.6, 0.1, W.theme.accent, 0.8, 0, 0);
    if (a.dist >= a.len || (W.arena && dist(e.x, e.z, W.arena.x, W.arena.z) > W.arena.r - e.r - 0.5)) {
      stop(e); e.state = "act"; addShake(0.3); return true;
    }
    return false;
  },
  rain(e, a, dt) {
    stop(e);
    const P = S.player;
    if (a.step === 0) { a.step = 1; a.n = 5 + Math.round(hot(e) * 3); a.k = 0; a.t = 0; a.drops = []; }
    a.t -= dt;
    if (a.k < a.n && a.t <= 0 && P) {
      a.t = 0.13;
      const off = a.k === 0 ? 0 : rand(1, 4.2), ang = rand(0, TAU);
      const x = P.x + Math.cos(ang) * off + P.vx * 0.35, z = P.z + Math.sin(ang) * off + P.vz * 0.35;
      a.drops.push({ x, z, t: 1.1 });
      fx.decal(0, x, z, 1.8, DANGER, 1.1);
      a.k++;
    }
    for (const d of a.drops) {
      if (d.t <= 0) continue;
      d.t -= dt;
      if (d.t <= 0) {
        fx.burst(d.x, 0.5, d.z, S.world.theme.accent, 14, 6, { size: 0.4 });
        fx.ring(d.x, d.z, S.world.theme.accent, 0.3, 2.1, 0.35);
        fx.emit(d.x, 6, d.z, 0, -40, 0, 0.14, 1.2, 0.4, S.world.theme.accent, 1, 0, 0);
        emit("impact");
        if (P && dist(d.x, d.z, P.x, P.z) < 1.8 + P.r) P.hurt(e.dmg, Math.atan2(P.z - d.z, P.x - d.x), "the falling sky");
      }
    }
    return a.k >= a.n && a.drops.every((d) => d.t <= 0);
  },
  lances(e, a, dt, dP, aP) {
    stop(e);
    if (a.step === 0) {
      a.step = 1; a.t = 0.8;
      const n = 3 + Math.round(hot(e) * 2);
      a.angs = [];
      for (let k = 0; k < n; k++) a.angs.push(aP + (k - (n - 1) / 2) * 0.38);
      a.angs.forEach((g) => fx.decal(1, e.x, e.z, 1.0, DANGER, 0.8, { ang: g, len: 16 }));
      e.lockFace = aP;
      return false;
    }
    a.t -= dt;
    if (a.step === 1 && a.t <= 0) {
      const P = S.player;
      for (const g of a.angs) {
        for (let d = 1; d < 16; d += 0.8) fx.emit(e.x + Math.cos(g) * d, 0.2, e.z + Math.sin(g) * d, 0, rand(3, 6), 0, 0.35, 0.45, 0.05, S.world.theme.accent, 1, 14, 0);
        if (P) {
          const px = P.x - e.x, pz = P.z - e.z;
          const along = px * Math.cos(g) + pz * Math.sin(g), across = Math.abs(-px * Math.sin(g) + pz * Math.cos(g));
          if (along > 0 && along < 16 && across < 0.55 + P.r) P.hurt(e.dmg * 1.1, g, "the " + e.name + "'s lance");
        }
      }
      addShake(0.4); emit("lances", e);
      a.step = 2; a.t = 0.4;
      return false;
    }
    return a.step === 2 && a.t <= 0;
  },
  summon(e, a, dt) {
    stop(e);
    if (a.step === 0) { a.step = 1; a.t = 0.8; fx.ring(e.x, e.z, S.world.theme.accent, 3, 0.5, 0.8, 0.3); }
    a.t -= dt;
    if (a.t <= 0) {
      const kinds = e.type === "heart" ? (e.phase >= 1 ? ["weaver", "knot", "mote", "mote"] : ["mote", "mote", "mote"]) : e.phase ? ["knot", "mote", "mote", "mote"] : ["mote", "mote", "mote"];
      kinds.forEach((k, i) => {
        const g = i / kinds.length * TAU + rand(-0.3, 0.3);
        spawnEnemy(k, e.x + Math.cos(g) * 3.2, e.z + Math.sin(g) * 3.2, { aggro: true, pop: true, elite: false });
      });
      emit("bossSummon", e);
      return true;
    }
    return false;
  },
  spiral(e, a, dt) {
    stop(e);
    if (a.step === 0) { a.step = 1; a.t = 2.4; a.ang = rand(0, TAU); a.acc = 0; }
    a.t -= dt; a.acc += dt;
    const every = 0.09 - hot(e) * 0.015;
    while (a.acc >= every) {
      a.acc -= every;
      a.ang += 0.38;
      const arms = e.phase ? 2 : 1;
      for (let k = 0; k < arms + (e.type === "heart" && e.phase === 2 ? 1 : 0); k++)
        enemyShot(e.x, e.z, a.ang + k * TAU / (arms + (e.type === "heart" && e.phase === 2 ? 1 : 0)), 7, e.dmg * 0.55, { src: "the " + e.name, y: 1.4 });
    }
    return a.t <= 0;
  },
  blink(e, a, dt) {
    const P = S.player, A = S.world.arena;
    if (a.step === 0) {
      a.step = 1; a.t = 0.45; e.invuln = true;
      fx.burst(e.x, 1.5, e.z, S.world.theme.accent, 30, 6, { size: 0.4 });
      e.mesh.root.visible = false; stop(e);
      emit("blink", e);
      return false;
    }
    a.t -= dt;
    if (a.step === 1 && a.t <= 0) {
      const g = rand(0, TAU);
      let x = P.x + Math.cos(g) * 3.4, z = P.z + Math.sin(g) * 3.4;
      if (A) { const d = dist(x, z, A.x, A.z); if (d > A.r - 2) { x = A.x + (x - A.x) / d * (A.r - 2); z = A.z + (z - A.z) / d * (A.r - 2); } }
      e.x = x; e.z = z;
      e.mesh.root.visible = true; e.invuln = false;
      fx.burst(e.x, 1.5, e.z, S.world.theme.accent, 30, 6, { size: 0.4 });
      a.step = 2; a.t = 0.6 - hot(e) * 0.1;
      fx.decal(0, e.x, e.z, 3.8, DANGER, a.t);
      return false;
    }
    if (a.step === 2 && a.t <= 0) {
      fx.ring(e.x, e.z, S.world.theme.accent, 0.5, 4.2, 0.45, 0.15);
      addShake(0.6); emit("slam", e);
      if (P && dist(e.x, e.z, P.x, P.z) < 3.8 + P.r) P.hurt(e.dmg * 1.2, Math.atan2(P.z - e.z, P.x - e.x), "the " + e.name, 14);
      a.step = 3; a.t = 0.5;
      return false;
    }
    return a.step === 3 && a.t <= 0;
  }
};

/* ---------------------------------------------------------------
   Looks
   --------------------------------------------------------------- */
const WHITE = new THREE.Color(0xffffff);
function setFlash(e, f) {
  for (const m of e.mesh.flash) {
    if (!m.userData.base) m.userData.base = { e: m.emissive.clone(), i: m.emissiveIntensity };
    const b = m.userData.base;
    if (f <= 0) { m.emissive.copy(b.e); m.emissiveIntensity = b.i; }
    else { m.emissive.copy(b.e).lerp(WHITE, f); m.emissiveIntensity = b.i + f * 2; }
  }
}

const bubbleGeo = new THREE.IcosahedronGeometry(1, 1);
const bubbleMat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true });
function setBubble(e, on) {
  if (on && !e.bubble) {
    e.bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
    e.bubble.scale.setScalar(e.r * 1.9 + 0.3); e.bubble.position.y = 0.9;
    e.mesh.root.add(e.bubble);
  } else if (!on && e.bubble) { e.mesh.root.remove(e.bubble); e.bubble = null; }
}

function animate(e, dt, moving, slow) {
  const M = e.mesh, P = M.parts || {}, root = M.root;
  root.position.set(e.x, 0, e.z);
  root.rotation.y = Math.PI / 2 - e.face;
  const pop = e.pop > 0 && e.pop < 1 ? e.pop : 1;
  if (e.flashT > 0) { e.flashT -= dt; setFlash(e, Math.max(0, e.flashT / 0.1)); if (e.flashT <= 0) setFlash(e, 0); }
  const tAnim = e.frozen > 0 ? 0 : e.anim * (1 - slow * 0.6);
  let sx = 1, sy = 1;
  if (e.type === "mote") {
    M.body.position.y = Math.sin(tAnim * 6) * 0.12;
    const f = Math.sin(tAnim * 38) * 0.9;
    if (P.wl) { P.wl.rotation.z = f; P.wr.rotation.z = -f; }
  } else if (e.type === "knot") {
    if (moving && P.ball) P.ball.rotation.x += dt * Math.hypot(e.vx, e.vz) * 1.4;
    if (e.state === "wind") { M.body.position.x = Math.sin(e.anim * 60) * 0.06; sy = 0.82; sx = 1.12; }
    else M.body.position.x = 0;
    if (e.state === "lunge") { sx = 0.85; sy = 1.15; }
  } else if (e.type === "spindle") {
    M.body.position.y = Math.sin(tAnim * 2) * 0.12;
    const charging = e.state === "charge";
    if (P.spindle) P.spindle.rotation.y += dt * (charging ? 9 : 1.6);
    if (P.r1) { P.r1.rotation.z += dt * (charging ? 12 : 2); P.r2.rotation.z -= dt * (charging ? 10 : 1.6); }
    if (P.halo) P.halo.material.opacity = charging ? 0.9 : 0.35;
  } else if (e.type === "golem") {
    const w = moving ? Math.sin(tAnim * 5) : 0;
    if (P.ll) { P.ll.rotation.x = w * 0.5; P.lr.rotation.x = -w * 0.5; }
    let arm = w * 0.35;
    if (e.state === "raise") arm = -2.6 * clamp(1 - e.t / 0.85, 0, 1) - 0.3;
    else if (e.state === "rest" && e.t > 0.6) arm = 0.4;
    if (P.al) { P.al.rotation.x = arm; P.ar.rotation.x = e.state === "raise" || e.state === "rest" ? arm : -arm; }
    if (P.torso) P.torso.rotation.z = w * 0.06;
    M.body.position.y = moving ? Math.abs(Math.sin(tAnim * 5)) * 0.06 : 0;
  } else if (e.type === "weaver") {
    M.body.position.y = 0.2 + Math.sin(tAnim * 1.7) * 0.15;
    if (P.loom) P.loom.rotation.y += dt * (e.state === "weave" ? 10 : 1.2);
  } else if (e.type === "anchor") {
    M.knot.rotation.y += dt * 0.8; M.knot.rotation.x += dt * 0.3;
    M.cage.rotation.y -= dt * 0.25;
    const pulse = 0.5 + Math.sin(e.anim * 3) * 0.2;
    M.halo.material.opacity = pulse;
    M.beam.material.opacity = 0.14 + Math.sin(e.anim * 2) * 0.06;
    M.knot.position.y = 3 + Math.sin(e.anim * 1.3) * 0.2;
  } else if (e.type === "dummy") {
    e.wobble = Math.max(0, (e.wobble || 0) - dt * 2.5);
    M.body.rotation.z = Math.sin(e.anim * 18) * 0.12 * e.wobble;
  } else if (e.type === "warden") {
    M.body.position.y = Math.sin(tAnim * 1.5) * 0.12;
    const act = e.act && e.act.name;
    M.hands.forEach((h, i) => {
      const s = i ? -1 : 1;
      const up = (act === "slam" && e.act.step === 1) || (act === "summon") ? 1.4 : 0;
      h.position.set(s * (1.7 + Math.sin(tAnim * 2 + i) * 0.1), 1.9 + up + Math.sin(tAnim * 2.4 + i) * 0.15, 0.6);
      h.rotation.y += dt * 2;
    });
    M.shards.rotation.y += dt * (e.phase ? 2.4 : 0.9);
    M.shards.children.forEach((s, i) => { const a = s.userData.a; s.position.set(Math.cos(a) * 2.6, Math.sin(tAnim * 2 + i) * 0.4, Math.sin(a) * 2.6); });
    M.crown.rotation.y += dt;
    M.halo.material.opacity = e.state === "act" ? 0.45 : 0.25;
    if (e.state === "sleep") M.body.position.y = -0.2;
  } else if (e.type === "heart") {
    const beat = 1 + Math.pow(Math.max(0, Math.sin(tAnim * (2.2 + e.phase))), 12) * 0.12;
    M.core.scale.setScalar(beat);
    M.core.rotation.y += dt * 0.6;
    M.cage.rotation.y -= dt * 0.4; M.cage.rotation.x += dt * 0.2;
    M.rings.forEach((r, i) => { r.rotation.x += dt * (0.4 + i * 0.25) * (1 + e.phase * 0.6); r.rotation.y += dt * (0.3 - i * 0.12); });
    M.shards.rotation.y += dt * (0.8 + e.phase * 0.7);
    M.shards.children.forEach((s, i) => { const a = s.userData.a; s.position.set(Math.cos(a) * 3.6, Math.sin(tAnim * 1.5 + i) * 0.6, Math.sin(a) * 3.6); });
    root.rotation.y = 0;
  }
  M.body && M.body.scale.set(sx * pop, sy * pop, sx * pop);
  if (e.bubble) { e.bubble.rotation.y += dt; }
  if (e.frozen > 0 && Math.random() < dt * 8) fx.emit(e.x + rand(-0.4, 0.4), rand(0.3, 1.6), e.z + rand(-0.4, 0.4), 0, 0.2, 0, 0.5, 0.2, 0.05, 0xdff4ff, 1, 0, 0);
  else if (e.chillT > 0 && Math.random() < dt * 4) fx.emit(e.x + rand(-0.4, 0.4), rand(0.3, 1.4), e.z + rand(-0.4, 0.4), 0, -0.4, 0, 0.6, 0.14, 0.02, 0x9fd8ff, 1, 0, 0);
}

const camQ = new THREE.Quaternion();
function updateBar(e, dt) {
  e.hpShowT -= dt;
  const show = !e.boss && e.type !== "dummy" && (e.hpShowT > 0 || e.elite || e.type === "anchor" || e.shield > 0) && e.hp < e.maxHp + 1 && (e.aggro || e.type === "anchor");
  if (!show) { if (e.bar) { freeBar(e.bar); e.bar = null; } return; }
  if (!e.bar) e.bar = getBar();
  const w = e.type === "anchor" ? 2.6 : e.type === "golem" ? 1.5 : 1.0;
  const b = e.bar;
  camQ.copy(camera.quaternion);
  b.g.quaternion.copy(camQ);
  const h = e.type === "anchor" ? 5 : e.type === "weaver" ? 3.1 : e.type === "golem" ? 2.9 : e.type === "spindle" ? 2.3 : 1.7;
  b.g.position.set(e.x, h, e.z);
  b.g.scale.set(w, 1, 1);
  const ratio = clamp(e.hp / e.maxHp, 0, 1);
  b.fill.scale.x = Math.max(0.001, ratio);
  b.fill.position.x = -0.5;
  b.fill.material.color.setHex(e.elite ? ELITES[e.elite].color : e.type === "anchor" ? (S.world ? S.world.theme.accent : 0xe05555) : 0xe05555);
  b.shield.scale.x = Math.max(0.001, clamp(e.shield / e.maxHp, 0, 1 - ratio + 0.001) + ratio);
  b.shield.visible = e.shield > 0;
  b.shield.position.x = -0.5;
  b.g.children[0].position.x = -0.52;
}

function dieStep(e, dt) {
  e.dying -= dt;
  const t = 1 - clamp(e.dying / e.dieMax, 0, 1);
  const M = e.mesh;
  if (e.boss) {
    if (Math.random() < 0.5) fx.burst(e.x + rand(-1.5, 1.5), rand(0.5, 4), e.z + rand(-1.5, 1.5), S.world ? S.world.theme.accent : 0xffffff, 4, 5, { size: 0.4 });
    M.root.position.y = -t * 1.5;
    M.root.rotation.y += dt * t * 6;
    M.root.scale.setScalar(1 - t * 0.7);
  } else {
    M.root.scale.setScalar(Math.max(0.01, (1 - t) * (e.elite === "hardy" ? 1.25 : 1)));
    M.root.rotation.y += dt * 10 * t;
    M.root.position.y = t * 0.4;
  }
  return e.dying <= 0;
}

export function disposeEnemy(e) {
  freeBar(e.bar); e.bar = null;
  scene.remove(e.mesh.root);
  e.mesh.root.traverse((o) => {
    if (o.isMesh && o.material && o.material !== bubbleMat) {
      [].concat(o.material).forEach((m) => m.dispose());
    }
    if (o.isSprite && o.material) o.material.dispose();
  });
}

export function clearAll() {
  for (const e of S.enemies) disposeEnemy(e);
  S.enemies = [];
}

export function dummyDps(e) {
  const recent = e.dmgLog.filter((l) => S.time - l.t < 3);
  if (!recent.length) return 0;
  const span = Math.max(1, S.time - recent[0].t);
  return recent.reduce((s, l) => s + l.d, 0) / span;
}


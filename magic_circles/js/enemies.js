/* enemies.js — what lives in the wilds, and the Wardens of the great places.
 *
 * The Phaser build had three archetypes (Chaser, Brute, Skirmisher) and four
 * bosses with one gimmick each (Themes.js). All seven are here, with the
 * same roles and the same numbers rescaled to metres, and a fourth common
 * kind for the swamps and graveyards:
 *
 *   prowler   the Chaser: quick, closes in, lunges        a Graveyard zombie
 *   brute     slow, heavy, slams the ground               the Mini Dungeon orc
 *   hexer     the Skirmisher: keeps its distance, casts   a vampire, or a skeleton
 *   wisp      flits in and out; little to it              a Graveyard ghost
 *
 *   Wardens   Verdant (heals itself), Ashfall (sets the ground burning),
 *             Depths (steps through to behind you), Void (unmakes your next
 *             spell) — each a great figure on a great structure, asleep
 *             until you come near.
 *
 * Every attack is shown before it lands, Magic Sandbox's rule
 * (magic_sandbox/js/enemies.js): a lane before a lunge, a filling circle
 * before a slam, a glow before a bolt. A dash passes through any of them.
 *
 * They are as strong as the land they live in: world.js's danger, one step
 * every 150 m from the start. */

import * as THREE from "three";
import { S, emit } from "./state.js";
import { scene, addShake } from "./gfx.js";
import * as fx from "./fx.js";
import { makeCharacter } from "./assets.js";
import { blobTexture, glowTexture } from "./textures.js";
import * as phys from "./physics.js";
import { isWater, isLoaded } from "./chunks.js";
import { enemyBolt } from "./spells.js";
import { rand, TAU, clamp, dist, damp, angDiff } from "./util.js";

export const KINDS = {
  prowler: { name: "Prowler", hp: 100, speed: 4.4, mass: 50, r: 0.42, contact: 10, xp: 8, model: "grave/character-zombie", h: 1.45 },
  brute:   { name: "Brute",   hp: 220, speed: 3.0, mass: 90, r: 0.62, contact: 18, xp: 16, model: "dungeon/character-orc", h: 2.0 },
  hexer:   { name: "Hexer",   hp: 80,  speed: 3.6, mass: 40, r: 0.4,  contact: 5,  xp: 12, model: "grave/character-vampire", alt: "grave/character-skeleton", h: 1.5, ranged: { cd: 2.5, power: 40, dmg: 12, speed: 9 } },
  wisp:    { name: "Wisp",    hp: 45,  speed: 5.4, mass: 20, r: 0.35, contact: 8,  xp: 6, model: "grave/character-ghost", h: 1.3, flies: true }
};
export const WARDENS = {
  verdant: { name: "Verdant Warden", hp: 760, speed: 2.4, mass: 200, r: 1.2, contact: 22, aggro: 14, enrage: 0.3, gimmick: "selfHeal", color: 0x6fe08a, model: "dungeon/character-orc", h: 4.2, attack: { cd: 1.7, power: 80, dmg: 16, speed: 8, n: 3 } },
  ashfall: { name: "Ashfall Tyrant", hp: 700, speed: 2.6, mass: 180, r: 1.1, contact: 20, aggro: 13, enrage: 0.35, gimmick: "groundBurn", color: 0xff7a3c, model: "grave/character-keeper", h: 4.0, attack: { cd: 1.4, power: 70, dmg: 13, speed: 9, n: 3 } },
  depths:  { name: "Depths Harbinger", hp: 880, speed: 2.0, mass: 220, r: 1.2, contact: 26, aggro: 15, enrage: 0.25, gimmick: "teleport", color: 0x5aa8ff, model: "grave/character-skeleton", h: 4.4, attack: { cd: 2.2, power: 100, dmg: 18, speed: 7.5, n: 5 } },
  void:    { name: "Void Sentinel", hp: 600, speed: 3.0, mass: 160, r: 1.0, contact: 18, aggro: 14, enrage: 0.4, gimmick: "nullify", color: 0xb36bff, model: "grave/character-vampire", h: 3.8, attack: { cd: 1.2, power: 60, dmg: 11, speed: 10, n: 3 } }
};

/* How much stronger each step of danger makes a creature. The Phaser build's
   statScalePerDepth was 0.12 for everything; health here grows a little
   faster so that Sigils (which raise your damage too) are what lets you go
   further, not levels alone. */
export const scaleOf = (danger) => ({ hp: 1 + 0.2 * (danger - 1), dmg: 1 + 0.1 * (danger - 1), speed: Math.min(1.25, 1 + 0.025 * (danger - 1)) });

/* ---------------------------------------------------------------
   Bodies
   --------------------------------------------------------------- */
const blobGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
const blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false });
function makeBody(key, h, opts) {
  const root = new THREE.Group();
  const blob = new THREE.Mesh(blobGeo, blobMat);
  blob.scale.setScalar(h * 0.38); blob.position.y = 0.02; blob.renderOrder = 1;
  root.add(blob);
  const ch = makeCharacter(key, h, Object.assign({ emissive: 0x000000, ei: 0 }, opts || {}));
  if (ch) { root.add(ch.root); ch.play("idle", 0); }
  else {
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(h * 0.22, h * 0.5, 4, 8), new THREE.MeshStandardMaterial({ color: 0x664455 }));
    m.position.y = h * 0.5; m.castShadow = true; root.add(m);
  }
  scene.add(root);
  // every material of this one creature, for the hit flash
  const mats = [];
  root.traverse((o) => { if (o.isMesh && o.material && o.material.userData.owned) mats.push(o.material); });
  return { root, ch, mats };
}

/* ---------------------------------------------------------------
   Spawning
   --------------------------------------------------------------- */
export function spawn(kind, x, z, danger, home) {
  const K = KINDS[kind];
  if (!K) return null;
  const sc = scaleOf(danger);
  const modelKey = kind === "hexer" && home && /Ruins|Cave|Rocky/.test(home.biome || "") ? K.alt : K.model;
  const body = makeBody(modelKey, K.h, kind === "wisp" ? { opacity: 0.72, emissive: 0x8fd8ff, ei: 0.5 } : {});
  const e = {
    kind, type: kind, name: K.name, K, x, z, vx: 0, vz: 0, kbx: 0, kbz: 0, r: K.r, mass: K.mass,
    hp: K.hp * sc.hp, maxHp: K.hp * sc.hp, speed: K.speed * sc.speed, dmgMult: sc.dmg, danger,
    alive: true, deadT: 0, state: "idle", t: rand(0, 2), atkT: rand(1, 2.5), contactT: 0, flash: 0,
    burnT: 0, burnDps: 0, burnTick: 0, slowT: 0, home: home ? home.key : null, hx: x, hz: z, wanderA: rand(0, TAU),
    body, anim: "idle", facing: rand(0, TAU), tele: null
  };
  S.enemies.push(e);
  return e;
}

export function spawnWarden(W) {
  const B = WARDENS[W.type];
  if (!B) return null;
  const sc = scaleOf(W.danger);
  const body = makeBody(B.model, B.h, { tint: B.color, emissive: B.color, ei: 0.25 });
  // a crown of light over its head, so it reads as more than a big one of the others
  const crown = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(B.color).multiplyScalar(2) }));
    m.position.set(Math.cos(i / 6 * TAU) * 0.8, 0, Math.sin(i / 6 * TAU) * 0.8); m.scale.set(0.7, 1.6, 0.7);
    crown.add(m);
  }
  crown.position.y = B.h + 0.5;
  body.root.add(crown);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: B.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 }));
  halo.scale.setScalar(B.h * 1.6); halo.position.y = B.h * 0.55;
  body.root.add(halo);
  const e = {
    kind: "warden", type: W.type, name: B.name, K: B, boss: true, id: W.id, x: W.x, z: W.z, vx: 0, vz: 0, kbx: 0, kbz: 0, r: B.r, mass: B.mass,
    hp: B.hp * sc.hp, maxHp: B.hp * sc.hp, speed: B.speed * sc.speed, dmgMult: sc.dmg, danger: W.danger,
    alive: true, deadT: 0, state: "sleep", t: 0, atkT: 2, gimT: 6, contactT: 0, flash: 0,
    burnT: 0, burnDps: 0, burnTick: 0, slowT: 0, home: null, hx: W.x, hz: W.z, dormant: true,
    body, crown, halo, anim: "idle", facing: Math.PI / 2, enraged: false, tele: null
  };
  body.root.position.set(e.x, 0, e.z);
  S.enemies.push(e);
  return e;
}

export function despawn(e) {
  e.alive = false;
  e.gone = true;
  scene.remove(e.body.root);
  if (e.body.ch) e.body.ch.dispose();
  if (e.tele && e.tele.alive) e.tele.end();
}
export function despawnHome(key) {
  for (const e of S.enemies) if (e.home === key && !e.gone && (e.state === "idle" || !e.alive)) despawn(e);
  S.enemies = S.enemies.filter((e) => !e.gone);
}
export function clearEnemies() {
  for (const e of S.enemies) if (!e.gone) despawn(e);
  S.enemies.length = 0;
}

export function enemiesNear(x, z, r) {
  const out = [];
  for (const e of S.enemies) {
    if (!e.alive || e.dormant) continue;
    const rr = r + e.r;
    if ((e.x - x) * (e.x - x) + (e.z - z) * (e.z - z) <= rr * rr) out.push(e);
  }
  return out;
}

/* ---------------------------------------------------------------
   Being hurt
   --------------------------------------------------------------- */
export function hurtEnemy(e, dmg, o) {
  if (!e.alive || !isFinite(dmg)) return;
  o = o || {};
  if (e.dormant) wake(e);
  e.hp -= dmg;
  e.flash = 0.1;
  if (e.state === "idle") e.state = "chase";
  const res = clamp(60 / e.mass, 0.15, 1.6);
  if (o.kbx) { e.kbx += o.kbx * res; e.kbz += o.kbz * res; }
  if (o.burn) { e.burnT = 3; e.burnDps = Math.max(e.burnDps, o.burn * 2); }
  if (o.slow) e.slowT = 3;
  if (!o.quiet) {
    fx.number(e.x, (e.K.h || 1.5) + 0.3, e.z, Math.round(dmg), dmg >= 40 ? "big" : "");
    fx.burst(e.x, 1, e.z, o.color || 0xffffff, 5, 3, { size: 0.24 });
  }
  emit("hitEnemy", e, dmg);
  if (e.hp <= 0) kill(e);
}

function kill(e) {
  e.alive = false; e.deadT = 0; e.hp = 0;
  if (e.body.ch) e.body.ch.play("die", 0.1, true);
  if (e.tele && e.tele.alive) e.tele.end();
  fx.burst(e.x, 1, e.z, e.boss ? e.K.color : 0xd8c8ff, e.boss ? 60 : 14, e.boss ? 9 : 5, { size: e.boss ? 0.5 : 0.3 });
  if (e.boss) { fx.ring(e.x, e.z, e.K.color, 0.5, 10, 0.9, 0.3); fx.flash(e.x, 3, e.z, e.K.color, 50, 0.8, 30); addShake(1); S.hitstop = 0.12; }
  emit("kill", e);
}

function wake(e) {
  if (!e.dormant) return;
  e.dormant = false; e.state = "chase";
  emit("bossIntro", e);
}

/* ---------------------------------------------------------------
   Thinking
   --------------------------------------------------------------- */
export function updateEnemies(dt) {
  const P = S.player;
  for (const e of S.enemies) {
    if (e.gone) continue;
    if (!e.alive) {
      e.deadT += dt;
      if (e.body.ch) e.body.ch.update(dt);
      if (e.deadT > 1.6) { e.body.root.position.y = -(e.deadT - 1.6) * 1.2; }
      if (e.deadT > 2.6) despawn(e);
      continue;
    }
    try { think(e, P, dt); } catch (err) { console.warn("[mcircles] enemy dropped", err); despawn(e); }
    // one that chased you out of its chunk, gave up, and whose home has since
    // been unloaded goes with it; a sleeping Warden likewise (its chunk raises
    // it again on the way back)
    if (!e.gone && (e.state === "idle" || e.dormant) && !isLoaded(e.hx, e.hz)) despawn(e);
  }
  if (S.enemies.some((e) => e.gone)) S.enemies = S.enemies.filter((e) => !e.gone);
}

function think(e, P, dt) {
  e.t += dt;
  e.atkT -= dt; e.contactT -= dt;
  // burning and slowed, as the old Fire and Water effects
  if (e.burnT > 0) {
    e.burnT -= dt; e.burnTick -= dt;
    if (e.burnTick <= 0) { e.burnTick = 0.5; hurtEnemy(e, e.burnDps * 0.5, { quiet: true }); fx.burst(e.x, 1.2, e.z, 0xff7a3c, 3, 1.5, { size: 0.2, grav: -3 }); if (!e.alive) return; }
  }
  e.slowT = Math.max(0, e.slowT - dt);
  const wet = !e.K.flies && isWater(e.x, e.z);
  const spd = e.speed * (e.slowT > 0 ? 0.3 : 1) * (wet ? 0.6 : 1);
  const d = P && P.alive ? dist(e.x, e.z, P.x, P.z) : Infinity;
  const toP = P ? Math.atan2(P.z - e.z, P.x - e.x) : 0;

  let mvx = 0, mvz = 0, run = false;
  if (e.boss) {
    if (e.dormant) {
      if (d < e.K.aggro) wake(e);
      e.facing = damp(e.facing, toP, 1, dt);
    } else bossThink(e, P, d, toP, dt, spd);
    mvx = e.mvx || 0; mvz = e.mvz || 0;
  } else {
    if (e.state === "idle") {
      if (d < 11 || (d < 16 && e.K.ranged)) { e.state = "chase"; emit("aggro", e); }
      // wander about home
      if (Math.sin(e.t * 0.7 + e.wanderA) > 0.3) {
        const hx = e.hx - e.x, hz = e.hz - e.z;
        const a = Math.hypot(hx, hz) > 4 ? Math.atan2(hz, hx) : e.wanderA + Math.sin(e.t * 0.3) * 1.5;
        mvx = Math.cos(a) * spd * 0.35; mvz = Math.sin(a) * spd * 0.35;
      }
    } else if (e.state === "chase") {
      if (d > 26 || dist(e.x, e.z, e.hx, e.hz) > 40) { e.state = "idle"; }
      else if (e.K.ranged) {
        // keep about seven metres away, sidestepping; fire when the glow has shown long enough
        const want = 7;
        const side = Math.sin(e.t * 0.9 + e.wanderA) > 0 ? 1 : -1;
        const a = d > want + 1.5 ? toP : d < want - 1.5 ? toP + Math.PI : toP + side * Math.PI / 2;
        mvx = Math.cos(a) * spd; mvz = Math.sin(a) * spd;
        if (e.atkT <= 0 && d < 15 && phys.clearLine(e.x, e.z, P.x, P.z, 0.2)) { e.state = "charge"; e.stT = 0.55; }
      } else {
        mvx = Math.cos(toP) * spd; mvz = Math.sin(toP) * spd; run = true;
        if (e.kind === "prowler" && e.atkT <= 0 && d < 6 && d > 2) {
          e.state = "lunge-warn"; e.stT = 0.5; e.lungeA = toP;
          e.tele = fx.decal(1, e.x, e.z, 0.7, 0xff5a5a, 0.5, { len: 6.5, ang: toP });
        }
        if (e.kind === "brute" && e.atkT <= 0 && d < 2.8) {
          e.state = "slam-warn"; e.stT = 0.85;
          e.tele = fx.decal(0, e.x + Math.cos(toP) * 1.4, e.z + Math.sin(toP) * 1.4, 2.4, 0xff5a5a, 0.85);
          e.slamX = e.x + Math.cos(toP) * 1.4; e.slamZ = e.z + Math.sin(toP) * 1.4;
        }
        if (e.kind === "wisp" && e.atkT <= 0 && d < 5) { e.state = "lunge-warn"; e.stT = 0.3; e.lungeA = toP; }
      }
    } else if (e.state === "charge") {
      e.stT -= dt;
      fx.emit(e.x + Math.cos(e.facing) * 0.5, 1.4, e.z + Math.sin(e.facing) * 0.5, 0, 0.4, 0, 0.2, 0.35, 0.05, 0xc04bff, 0.9, 0, 0);
      if (e.stT <= 0) {
        const R = e.K.ranged;
        enemyBolt(e.x + Math.cos(toP) * 0.6, e.z + Math.sin(toP) * 0.6, toP, { speed: R.speed, dmg: R.dmg * e.dmgMult, power: R.power, src: "a " + e.name, color: 0xc04bff });
        emit("enemyFire");
        e.atkT = R.cd * rand(0.8, 1.2); e.state = "chase";
      }
    } else if (e.state === "lunge-warn") {
      e.stT -= dt;
      if (e.stT <= 0) { e.state = "lunge"; e.stT = 0.32; emit("lunge"); }
    } else if (e.state === "lunge") {
      e.stT -= dt;
      mvx = Math.cos(e.lungeA) * 15; mvz = Math.sin(e.lungeA) * 15; run = true;
      if (e.stT <= 0) { e.state = "chase"; e.atkT = rand(1.8, 2.8); }
    } else if (e.state === "slam-warn") {
      e.stT -= dt;
      if (e.stT <= 0) {
        fx.ring(e.slamX, e.slamZ, 0xd8b080, 0.3, 2.6, 0.4);
        fx.burst(e.slamX, 0.3, e.slamZ, 0x9a8a70, 18, 5, { plain: true, size: 0.35 });
        addShake(0.3);
        emit("slam");
        if (P && P.alive && !P.dashing && dist(P.x, P.z, e.slamX, e.slamZ) < 2.4 + P.r) P.hurt(e.K.contact * 1.6 * e.dmgMult, Math.atan2(P.z - e.slamZ, P.x - e.slamX), "a Brute", 10);
        e.state = "chase"; e.atkT = rand(2, 3);
      }
    }
    e.mvx = mvx; e.mvz = mvz;
  }

  // touch damage (the old handlePlayerEnemyCollision)
  if (P && P.alive && !P.dashing && d < e.r + P.r + 0.1 && e.contactT <= 0 && !e.dormant) {
    e.contactT = 0.9;
    P.hurt(e.K.contact * e.dmgMult, toP, e.boss ? e.name : "a " + e.name, e.boss ? 9 : 6);
  }

  // move, with knockback decaying and creatures keeping out of each other
  e.kbx = damp(e.kbx, 0, 5, dt); e.kbz = damp(e.kbz, 0, 5, dt);
  e.vx = damp(e.vx, mvx, 8, dt); e.vz = damp(e.vz, mvz, 8, dt);
  const ox = e.x, oz = e.z;
  e.x += (e.vx + e.kbx) * dt; e.z += (e.vz + e.kbz) * dt;
  for (const o of S.enemies) {
    if (o === e || !o.alive || o.gone) continue;
    const dx = e.x - o.x, dz = e.z - o.z, m = Math.hypot(dx, dz), min = e.r + o.r;
    if (m > 0.0001 && m < min) { const push = (min - m) * 0.5; e.x += dx / m * push; e.z += dz / m * push; }
  }
  if (!e.K.flies || e.boss) phys.resolve(e);
  if (!isFinite(e.x) || !isFinite(e.z)) { e.x = ox; e.z = oz; e.vx = e.vz = e.kbx = e.kbz = 0; }

  // looks
  const sp = Math.hypot(e.vx, e.vz);
  if (sp > 0.3) e.facing = Math.atan2(e.vz, e.vx);
  else if (e.state !== "idle" && P) e.facing = e.facing + angDiff(e.facing, toP) * Math.min(1, dt * 6);
  const B = e.body;
  const bob = e.K.flies ? 0.35 + Math.sin(e.t * 3) * 0.15 : wet ? -0.3 : 0;
  B.root.position.set(e.x, bob, e.z);
  B.root.rotation.y = Math.PI / 2 - e.facing;
  if (B.ch) {
    B.ch.update(dt);
    const want = e.state === "charge" ? "holding-right-shoot" : e.state === "slam-warn" ? "attack-melee-right" : sp > 2.8 || run ? "sprint" : sp > 0.3 ? "walk" : "idle";
    if (want !== e.anim) { B.ch.play(want, 0.15, want === "attack-melee-right"); e.anim = want; }
  }
  e.flash = Math.max(0, e.flash - dt);
  const glow = e.flash > 0 ? 1.4 : e.burnT > 0 ? 0.35 : 0;
  for (const m of B.mats) {
    if (e.boss) { m.emissiveIntensity = 0.25 + glow + (e.enraged ? 0.3 + Math.sin(e.t * 8) * 0.15 : 0); continue; }
    m.emissive.setHex(e.flash > 0 ? 0xffffff : e.burnT > 0 ? 0xff5a20 : e.slowT > 0 ? 0x3070ff : 0x000000);
    m.emissiveIntensity = e.flash > 0 ? 1 : e.burnT > 0 || e.slowT > 0 ? 0.35 : 0;
  }
  if (e.crown) { e.crown.rotation.y += dt * 1.2; e.crown.position.y = e.K.h + 0.5 + Math.sin(e.t * 2) * 0.1; }
}

/* ---------------------------------------------------------------
   Wardens (BossSprite.js, with every gimmick telegraphed)
   --------------------------------------------------------------- */
function bossThink(e, P, d, toP, dt, spd) {
  const B = e.K;
  e.gimT -= dt;
  if (!e.enraged && e.hp / e.maxHp < B.enrage) {
    e.enraged = true;
    fx.ring(e.x, e.z, B.color, 0.5, 6, 0.6, 0.3);
    emit("bossPhase", e);
  }
  e.mvx = 0; e.mvz = 0;
  if (!P || !P.alive) return;
  // leash: a Warden does not leave its ground
  const home = dist(e.x, e.z, e.hx, e.hz);
  if (home > 22 || d > 34) {
    const a = Math.atan2(e.hz - e.z, e.hx - e.x);
    e.mvx = Math.cos(a) * spd; e.mvz = Math.sin(a) * spd;
    if (home < 2) { e.dormant = true; e.state = "sleep"; e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.25); emit("bossLost", e); }
    return;
  }
  if (e.state === "blink") {
    e.stT -= dt;
    if (e.stT <= 0) {
      fx.burst(e.x, 2, e.z, B.color, 30, 6, { size: 0.4 });
      e.x = e.blinkX; e.z = e.blinkZ;
      fx.ring(e.x, e.z, B.color, 0.4, 4, 0.4);
      fx.burst(e.x, 2, e.z, B.color, 30, 6, { size: 0.4 });
      e.state = "chase"; e.atkT = 0.6;
    }
    return;
  }
  if (d > 3.2) { e.mvx = Math.cos(toP) * spd; e.mvz = Math.sin(toP) * spd; }
  const cd = B.attack.cd * (e.enraged ? 0.5 : 1);
  if (e.atkT <= 0 && d < 18) {
    // a fan of bolts at you; more of them when it is angry
    const n = B.attack.n + (e.enraged ? 2 : 0);
    for (let i = 0; i < n; i++) {
      const a = toP + (i - (n - 1) / 2) * 0.2;
      enemyBolt(e.x + Math.cos(a) * 1.2, e.z + Math.sin(a) * 1.2, a, { speed: B.attack.speed, dmg: B.attack.dmg * e.dmgMult, power: B.attack.power, r: 0.35, src: "the " + B.name, color: B.color, life: 3.5 });
    }
    emit("bossFire");
    e.atkT = cd;
  }
  if (e.gimT <= 0) { e.gimT = rand(8, 14) * (e.enraged ? 0.7 : 1); gimmick(e, P); }
}

function gimmick(e, P) {
  const B = e.K;
  if (B.gimmick === "selfHeal") {
    const n = e.maxHp * 0.05;
    e.hp = Math.min(e.maxHp, e.hp + n);
    fx.number(e.x, B.h + 0.8, e.z, "+" + Math.round(n), "heal");
    fx.ring(e.x, e.z, 0x6fe08a, 0.5, 4, 0.8, 0.2);
    fx.burst(e.x, 2, e.z, 0x6fe08a, 30, 4, { size: 0.4, grav: -3 });
    emit("bossHeal", e);
  } else if (B.gimmick === "groundBurn") {
    // three patches round where you stand: a warning, then fire on the ground
    for (let i = 0; i < 3; i++) {
      const a = rand(0, TAU), r = i ? rand(1.5, 4) : 0;
      const x = P.x + Math.cos(a) * r, z = P.z + Math.sin(a) * r;
      fx.decal(0, x, z, 2.2, 0xff7a3c, 0.9);
      S.zones.push({ x, z, r: 2.2, t: -0.9, life: 4.5, dps: 14 * e.dmgMult, color: 0xff7a3c, src: "the Ashfall's fire" });
    }
    emit("bossBurn", e);
  } else if (B.gimmick === "teleport") {
    const a = Math.atan2(P.vz || 0.01, P.vx || 0.01) + Math.PI;
    e.blinkX = P.x + Math.cos(a) * 4; e.blinkZ = P.z + Math.sin(a) * 4;
    e.state = "blink"; e.stT = 0.7;
    fx.decal(0, e.blinkX, e.blinkZ, 1.6, B.color, 0.7);
    emit("bossBlink", e);
  } else if (B.gimmick === "nullify") {
    // the old bossNullifyCast: your next spell is unmade as it leaves the staff
    S.nullify = true;
    fx.ring(P.x, P.z, B.color, 0.4, 2, 0.6, 0.3);
    emit("toast", "The Sentinel has unmade your next spell");
    emit("bossNullify", e);
  }
}

/* Burning ground: hurts while you stand in it. */
export function updateZones(dt) {
  const P = S.player;
  for (let i = S.zones.length - 1; i >= 0; i--) {
    const z = S.zones[i];
    z.t += dt;
    if (z.t >= z.life) { S.zones.splice(i, 1); continue; }
    if (z.t < 0) continue;
    if (!z.lit) { z.lit = true; fx.decal(2, z.x, z.z, z.r, z.color, z.life); }
    if (Math.random() < 0.6) fx.emit(z.x + rand(-z.r, z.r) * 0.7, 0.2, z.z + rand(-z.r, z.r) * 0.7, 0, rand(1, 2.5), 0, 0.5, 0.35, 0.05, z.color, 0.8, -1, 0);
    if (P && P.alive && dist(P.x, P.z, z.x, z.z) < z.r) { z.acc = (z.acc || 0) + dt; if (z.acc > 0.5) { z.acc = 0; P.hurt(z.dps * 0.5, 0, z.src, 0); } }
  }
}

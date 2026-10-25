/* spells.js — what happens after the staff fires.
 *
 * compileSpell() (spellcore.js) turns a drawing into numbers; this turns the
 * numbers into things flying across the world. The behaviour is the Phaser
 * build's ProjectileSprite and GameScene, kept where it was the game:
 *
 *   sharp shots (Needle, Lance, Beam) pass through enemies, never push
 *   blunt shots push what they hit by the ratio of power to mass, and a
 *     Boulder bulldozes everything in its path
 *   Burst and Cannon blow up where they stop; a Nova erupts where its seal is
 *   Fire burns, Water slows, Air throws, Earth shoves
 *   the trigger (right click) releases the next layer from every shot in
 *     flight at once; a shot that runs out releases it anyway (the old game
 *     lost it)
 *   two spells that meet: the one with half again the other's power wins
 *     and loses half of the loser's; closer than that, both go
 *
 * and the Phaser build's README is honoured in the other direction: nothing
 * here can throw inside the frame. A shot whose numbers go bad is dropped.
 *
 * Shot bodies are pooled and share materials per colour (Magic Sandbox's
 * spells.js does the same), so a forty-shard burst allocates nothing. */

import * as THREE from "three";
import { S, emit } from "./state.js";
import { scene, addShake } from "./gfx.js";
import * as fx from "./fx.js";
import { elementInfo } from "./spellcore.js";
import { glowTexture } from "./textures.js";
import * as phys from "./physics.js";
import { damageObject } from "./chunks.js";
import { hurtEnemy, enemiesNear } from "./enemies.js";
import { rand, TAU, clamp, dist } from "./util.js";

const PVP_RATIO = 1.5;

/* ---------------------------------------------------------------
   Colour: the stack's elements, averaged (the old setTintFromElements)
   --------------------------------------------------------------- */
const tc = new THREE.Color(), acc = new THREE.Color();
function colorOf(elements) {
  if (!elements.length) return elementInfo("arcane").hex;
  acc.setRGB(0, 0, 0);
  for (const e of elements) acc.add(tc.setHex(elementInfo(e).hex));
  acc.multiplyScalar(1 / elements.length);
  return acc.getHex();
}

/* ---------------------------------------------------------------
   Pooled bodies, one shape per family
   --------------------------------------------------------------- */
const GEO = {
  sharp: new THREE.OctahedronGeometry(1, 0).scale(0.55, 0.55, 2.2),
  blunt: new THREE.IcosahedronGeometry(1, 1),
  rock: new THREE.IcosahedronGeometry(1, 0),
  wave: new THREE.TorusGeometry(1, 0.16, 6, 18, Math.PI * 0.8).rotateX(Math.PI / 2).rotateY(Math.PI / 2 - Math.PI * 0.4)
};
const coreMats = new Map(), haloMats = new Map();
function coreMat(hex) {
  if (!coreMats.has(hex)) coreMats.set(hex, new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(2.4) }));
  return coreMats.get(hex);
}
const rockMat = new THREE.MeshStandardMaterial({ color: 0x7a6a50, roughness: 0.9, flatShading: true, emissive: 0x80c060, emissiveIntensity: 0.25 });
function haloMat(hex) {
  if (!haloMats.has(hex)) haloMats.set(hex, new THREE.SpriteMaterial({ map: glowTexture(), color: hex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }));
  return haloMats.get(hex);
}
const pools = { sharp: [], blunt: [], rock: [], wave: [] };
function body(shape, hex) {
  let b = pools[shape].pop();
  if (!b) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(GEO[shape], shape === "rock" ? rockMat : coreMat(hex));
    m.castShadow = shape === "rock";
    const h = new THREE.Sprite(haloMat(hex));
    g.add(m, h);
    b = { g, m, h, shape };
  }
  if (shape !== "rock") b.m.material = coreMat(hex);
  b.h.material = haloMat(hex);
  b.g.visible = true;
  scene.add(b.g);
  return b;
}
function free(b) { if (!b) return; scene.remove(b.g); pools[b.shape].push(b); }

/* ---------------------------------------------------------------
   Firing a layer
   --------------------------------------------------------------- */
/**
 * Fire layer `li` of compiled spell `c` from (x, z), facing `heading`.
 * Layer 0 leaves the staff; later layers burst from where a shot ended.
 */
export function fireLayer(c, li, x, z, heading, owner) {
  const L = c.layers[li];
  if (!L) return;
  const fxd = Math.cos(heading), fzd = Math.sin(heading);
  const col = colorOf(c.elements);
  const carries = li + 1 < c.layers.length;
  for (const s of L.shots) {
    // a seal's place on the page is where its shots leave from: right is right of your aim
    const ox = x - fzd * s.ox + fxd * s.oz, oz = z + fxd * s.ox + fzd * s.oz;
    if (s.spectrum === "NOVA") { nova(c, li, s, ox, oz, heading, owner, col); continue; }
    for (const d of s.dirs) {
      const spread = li === 0 ? (Math.random() - 0.5) * 2 * c.spread : (Math.random() - 0.5) * 0.08;
      const a = heading + d + spread;
      const start = li === 0 ? 0.8 : 0.1;
      const shape = s.sharp ? "sharp" : s.spectrum === "BOULDER" ? "rock" : s.spectrum === "WAVE" ? "wave" : "blunt";
      const sh = {
        c, li, s, owner, col, carries, heading: a,
        x: ox + Math.cos(a) * start, z: oz + Math.sin(a) * start, y: 1.0,
        vx: Math.cos(a) * s.speed, vz: Math.sin(a) * s.speed,
        trav: 0, pierce: s.pierce, power: s.power, hits: new Set(), alive: true, age: 0,
        b: body(shape, col), spin: rand(0, TAU)
      };
      const k = s.size;
      if (shape === "sharp") sh.b.m.scale.set(k, k, k);
      else if (shape === "wave") sh.b.m.scale.set(k, k, k);
      else sh.b.m.scale.setScalar(k);
      sh.b.h.scale.setScalar(k * (shape === "sharp" ? 6 : 4.2));
      S.shots.push(sh);
    }
  }
  if (li > 0) emit("payload", li);
  else emit("castFired", c);
}

function nova(c, li, s, x, z, heading, owner, col) {
  const R = s.blast;
  fx.ring(x, z, col, 0.4, R, 0.45, 0.2);
  fx.ring(x, z, 0xffffff, 0.3, R * 0.7, 0.3, 0.25, 0.6);
  fx.burst(x, 0.8, z, col, 40, 9, { size: 0.45 });
  fx.flash(x, 1.5, z, col, 30, 0.35, R * 3);
  blast(c, s, x, z, R, s.dmg * ((owner && owner.dmgMult) || 1), col, null);
  addShake(0.5);
  emit("nova");
  if (li + 1 < c.layers.length) fireLayer(c, li + 1, x, z, heading, owner);
}

/** Damage and shove everything within R of (x, z), falling off toward the edge. */
function blast(c, s, x, z, R, dmg, col, sh) {
  for (const e of enemiesNear(x, z, R)) {
    const d = dist(x, z, e.x, e.z), k = 1 - 0.5 * clamp(d / R, 0, 1);
    const a = Math.atan2(e.z - z, e.x - x);
    hurtEnemy(e, dmg * k, effectOf(s, a, k * (1 + s.kb), col));
  }
  phys.within(x, z, R, (o) => {
    if (o.owner) damageObject(o.owner, dmg * 0.6, o.x, o.z);
    if (o.moveable) { const a = Math.atan2(o.z - z, o.x - x); phys.shove(o, Math.cos(a) * 8 * (1 + s.kb), Math.sin(a) * 8 * (1 + s.kb), s.power); }
  });
  // your own blast can catch you, at a quarter
  const P = S.player;
  if (P && P.alive && dist(x, z, P.x, P.z) < R * 0.8 && s.spectrum !== "NOVA") P.hurt(dmg * 0.25, Math.atan2(P.z - z, P.x - x), "your own blast", 6);
}

/* A shot hits as hard as its page says, times what its caster has grown into. */
const dmgOf = (sh, base) => base * ((sh && sh.owner && sh.owner.dmgMult) || 1);

function effectOf(s, ang, kbMult, col) {
  const kb = (2 + s.kb * 7) * (kbMult || 1) * (s.propel ? 1.6 : 1);
  return {
    kbx: Math.cos(ang) * kb, kbz: Math.sin(ang) * kb,
    burn: s.burn, slow: s.slow, color: col, power: s.power
  };
}

/* ---------------------------------------------------------------
   Per frame
   --------------------------------------------------------------- */
export function updateShots(dt) {
  for (let i = S.shots.length - 1; i >= 0; i--) {
    const sh = S.shots[i];
    if (!sh.alive) { S.shots.splice(i, 1); continue; }
    try { stepShot(sh, dt); } catch (e) { console.warn("[mcircles] shot dropped", e); end(sh, true); }
    if (!sh.alive) S.shots.splice(i, 1);
  }
  for (let i = S.eshots.length - 1; i >= 0; i--) {
    const b = S.eshots[i];
    stepEnemyShot(b, dt);
    if (!b.alive) { free(b.b); S.eshots.splice(i, 1); }
  }
  clash();
}

function stepShot(sh, dt) {
  const s = sh.s;
  sh.age += dt;
  const ox = sh.x, oz = sh.z;
  const nx = sh.x + sh.vx * dt, nz = sh.z + sh.vz * dt;
  if (!isFinite(nx) || !isFinite(nz)) { end(sh, true); return; }
  // the world first: a wall stops everything, a tree or crate stops all but the heavy
  const hit = phys.sweep(ox, oz, nx, nz, Math.max(0.12, s.size * 0.6), (c) => c.hitBy === sh);
  if (hit) {
    const o = hit.c;
    o.hitBy = sh;
    if (o.owner) damageObject(o.owner, dmgOf(sh, s.sharp ? s.dmg : s.dmg * 0.7), hit.x, hit.z);
    if (o.moveable && !s.sharp) phys.shove(o, sh.vx * 0.6, sh.vz * 0.6, sh.power);
    const stops = o.immortal || !o.owner || (!s.push && sh.power <= 150) || o.kind === "tree" && !s.push;
    if (stops) { sh.x = hit.x; sh.z = hit.z; end(sh, false); return; }
  }
  sh.x = nx; sh.z = nz;
  sh.trav += Math.hypot(nx - ox, nz - oz);
  // creatures
  const r = s.spectrum === "WAVE" ? s.size * 1.1 : Math.max(0.15, s.size);
  for (const e of enemiesNear(sh.x, sh.z, r)) {
    if (sh.hits.has(e)) { if (s.push) bulldoze(sh, e, dt); continue; }
    sh.hits.add(e);
    const a = Math.atan2(sh.vz, sh.vx);
    hurtEnemy(e, dmgOf(sh, s.dmg), effectOf(s, a, 1, sh.col));
    if (s.blast) { end(sh, false); return; }
    if (--sh.pierce < 0) { end(sh, false); return; }
  }
  // visuals
  const B = sh.b;
  B.g.position.set(sh.x, sh.y, sh.z);
  if (B.shape === "sharp" || B.shape === "wave") B.g.rotation.y = Math.PI / 2 - Math.atan2(sh.vz, sh.vx);
  else { sh.spin += dt * (B.shape === "rock" ? 6 : 3); B.m.rotation.set(sh.spin, sh.spin * 0.7, 0); }
  if (Math.random() < 0.7) fx.emit(sh.x + rand(-0.1, 0.1), sh.y + rand(-0.1, 0.1), sh.z + rand(-0.1, 0.1), -sh.vx * 0.05, rand(0, 0.4), -sh.vz * 0.05, 0.25 + s.size * 0.4, Math.max(0.14, s.size * 0.9), 0.02, sh.col, 0.8, 0, 2);
  if (B.shape === "rock" && Math.random() < 0.3) fx.emit(sh.x, 0.1, sh.z, rand(-1, 1), rand(0.5, 2), rand(-1, 1), 0.5, 0.25, 0.1, 0x8a7a5a, 0.8, 9, 1, true);
  if (sh.trav >= s.range) end(sh, false);
}

/* Earth's old pushEntitiesOnPath: a Boulder carries what it hits ahead of it,
   less so the heavier it is, and grinds it while it does. */
function bulldoze(sh, e, dt) {
  const k = clamp((sh.power / Math.max(1, e.mass) - 0.2) / 1.8, 0, 1);
  if (k <= 0) return;
  const sp = Math.hypot(sh.vx, sh.vz) || 1;
  e.kbx += sh.vx / sp * 14 * k * dt * 10; e.kbz += sh.vz / sp * 14 * k * dt * 10;
  e.grind = (e.grind || 0) + dt;
  if (e.grind > 0.35) { e.grind = 0; hurtEnemy(e, 6, { kbx: 0, kbz: 0, color: sh.col, quiet: true }); }
}

function end(sh, quiet) {
  if (!sh.alive) return;
  sh.alive = false;
  free(sh.b); sh.b = null;
  if (quiet) return;
  const s = sh.s;
  if (s.blast) {
    fx.ring(sh.x, sh.z, sh.col, 0.3, s.blast, 0.35);
    fx.burst(sh.x, 0.9, sh.z, sh.col, 22, 7, { size: 0.4 });
    fx.flash(sh.x, 1.2, sh.z, sh.col, 14, 0.25, s.blast * 3);
    blast(sh.c, s, sh.x, sh.z, s.blast, dmgOf(sh, s.dmg), sh.col, sh);
    addShake(0.2 + s.blast * 0.06);
    emit("boom", s.blast);
  } else fx.burst(sh.x, 0.9, sh.z, sh.col, 6, 3, { size: 0.24 });
  if (sh.carries) fireLayer(sh.c, sh.li + 1, sh.x, sh.z, Math.atan2(sh.vz, sh.vx), sh.owner);
}

/** The trigger: every shot carrying a next layer lets it go, now. */
export function triggerPayloads(owner) {
  let n = 0;
  for (const sh of S.shots.slice()) if (sh.alive && sh.owner === owner && sh.carries && sh.age > 0.08) { end(sh, false); n++; }
  return n;
}
export function pendingPayloads(owner) {
  let n = 0;
  for (const sh of S.shots) if (sh.alive && sh.owner === owner && sh.carries) n++;
  return n;
}

/* ---------------------------------------------------------------
   Enemy bolts
   --------------------------------------------------------------- */
export function enemyBolt(x, z, ang, o) {
  const b = {
    x, z, vx: Math.cos(ang) * o.speed, vz: Math.sin(ang) * o.speed, r: o.r || 0.25, dmg: o.dmg, power: o.power || 40,
    life: o.life || 3, color: o.color || 0xc04bff, src: o.src || "a bolt", alive: true, b: body("blunt", o.color || 0xc04bff)
  };
  b.b.m.scale.setScalar(b.r); b.b.h.scale.setScalar(b.r * 5);
  b.b.g.position.set(x, 1, z);
  S.eshots.push(b);
  return b;
}
function stepEnemyShot(b, dt) {
  b.life -= dt;
  const nx = b.x + b.vx * dt, nz = b.z + b.vz * dt;
  if (b.life <= 0 || !isFinite(nx) || !isFinite(nz)) { b.alive = false; return; }
  const hit = phys.sweep(b.x, b.z, nx, nz, b.r, (c) => c.moveable || c.low);
  if (hit) { fx.burst(hit.x, 1, hit.z, b.color, 6, 3, { size: 0.2 }); b.alive = false; return; }
  b.x = nx; b.z = nz;
  b.b.g.position.set(b.x, 1, b.z);
  if (Math.random() < 0.5) fx.emit(b.x, 1, b.z, 0, 0.2, 0, 0.3, 0.3, 0.02, b.color, 0.7, 0, 0);
  const P = S.player;
  if (P && P.alive && !P.dashing && dist(b.x, b.z, P.x, P.z) < b.r + P.r) {
    P.hurt(b.dmg, Math.atan2(b.vz, b.vx), b.src, 4);
    b.alive = false;
  }
}

/* Two spells meeting (resolveProjectilePvP): the stronger by half again wins. */
function clash() {
  for (const a of S.shots) {
    if (!a.alive) continue;
    for (const b of S.eshots) {
      if (!b.alive) continue;
      if (dist(a.x, a.z, b.x, b.z) > Math.max(0.2, a.s.size) + b.r) continue;
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      fx.burst(mx, 1, mz, 0xffffff, 10, 4, { size: 0.25 });
      if (a.power > b.power * PVP_RATIO) { b.alive = false; a.power -= b.power * 0.5; }
      else if (b.power > a.power * PVP_RATIO) { end(a, true); b.power -= a.power * 0.5; }
      else { b.alive = false; end(a, true); }
      emit("clash");
    }
  }
}

export function clearShots() {
  for (const sh of S.shots) { if (sh.b) free(sh.b); sh.alive = false; }
  for (const b of S.eshots) { free(b.b); b.alive = false; }
  S.shots.length = 0; S.eshots.length = 0;
}

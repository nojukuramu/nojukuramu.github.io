/* spells.js — what happens after the staff fires.
 *
 * compileSpell() (spellcore.js) turns a drawing into numbers; this file turns
 * those numbers into things flying through the world: shots, the rings of a
 * Nova, the clouds and pools reactions leave behind, the chained layers that
 * burst out of a shot when it lands or when you pull the trigger.
 *
 * Shot meshes are pooled and share one material per colour, so a
 * forty-shard spell costs forty matrix updates and no allocations. */

import * as THREE from "three";
import { S, emit } from "./state.js";
import { scene } from "./gfx.js";
import * as fx from "./fx.js";
import { REACTIONS, elementInfo } from "./spellcore.js";
import { rand, TAU, clamp, dist } from "./util.js";
import { hurtEnemy, enemiesNear } from "./enemies.js";
import { ENEMY_SHOT } from "./themes.js";

/* ---------------------------------------------------------------
   Pooled shot bodies
   --------------------------------------------------------------- */
const coreGeo = new THREE.IcosahedronGeometry(1, 1);
const coreMats = new Map(), haloMats = new Map();
const glowTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(32, 32, 1, 32, 32, 31);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,0.45)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
function coreMat(hex) {
  if (!coreMats.has(hex)) coreMats.set(hex, new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(2.6) }));
  return coreMats.get(hex);
}
function haloMat(hex) {
  if (!haloMats.has(hex)) haloMats.set(hex, new THREE.SpriteMaterial({ map: glowTex, color: hex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }));
  return haloMats.get(hex);
}
const pool = [];
function body(core, glow) {
  let b = pool.pop();
  if (!b) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(coreGeo, coreMat(core));
    const h = new THREE.Sprite(haloMat(glow));
    g.add(m, h);
    b = { g, m, h };
  }
  b.m.material = coreMat(core);
  b.h.material = haloMat(glow);
  scene.add(b.g);
  b.g.visible = true;
  return b;
}
function release(b) { if (!b) return; scene.remove(b.g); pool.push(b); }

const colorOf = (els) => (els.length ? elementInfo(els[0]).hex : elementInfo("arcane").hex);
const glowOf = (els) => (els.length > 1 ? elementInfo(els[1]).hex : colorOf(els));

/* ---------------------------------------------------------------
   Casting
   --------------------------------------------------------------- */
/**
 * Fire layer `li` of a compiled spell from (x, z) heading `aim`.
 * Layer 0 comes from the caster; later layers from wherever their parent ended.
 */
export function fireLayer(spell, li, x, z, aim, fromCaster) {
  const L = spell.layers[li];
  if (!L) return 0;
  let n = 0;
  const fwdX = Math.cos(aim), fwdZ = Math.sin(aim), rtX = -fwdZ, rtZ = fwdX;
  for (const s of L.shots) {
    const ox = x + rtX * s.ox + fwdX * s.oz, oz = z + rtZ * s.ox + fwdZ * s.oz;
    if (s.form === "nova") { spawnNova(spell, li, L, s, ox, oz, aim); n++; continue; }
    for (const d of s.dirs) {
      const spread = fromCaster ? (Math.random() - 0.5) * spell.spread : 0;
      spawnShot(spell, li, L, s, ox + (fromCaster ? fwdX * 0.7 : 0), oz + (fromCaster ? fwdZ * 0.7 : 0), aim + d + spread);
      n++;
    }
  }
  return n;
}

function spawnShot(spell, li, L, s, x, z, dir) {
  const els = L.elements;
  const col = colorOf(els);
  const b = body(col, glowOf(els));
  const r = s.radius;
  if (s.form === "needle") b.m.scale.set(r * 0.9, r * 0.9, r * 4.2); else b.m.scale.setScalar(r);
  b.h.scale.setScalar(r * (s.form === "orb" ? 6 : s.form === "needle" ? 9 : 8) + 0.6);
  const shot = {
    spell, li, L, s, x, z, y: 1.0, dir, vx: Math.cos(dir) * s.speed, vz: Math.sin(dir) * s.speed,
    speed: s.speed, r, traveled: 0, pierce: s.pierce, bounce: s.bounce, hit: new Set(),
    col, b, trail: 0, done: false, payload: li + 1 < spell.layers.length, spin: rand(0, TAU)
  };
  b.g.position.set(x, shot.y, z);
  b.g.rotation.set(0, Math.atan2(shot.vx, shot.vz), 0);
  S.shots.push(shot);
  return shot;
}

function spawnNova(spell, li, L, s, x, z, aim) {
  const col = colorOf(L.elements);
  fx.ring(x, z, col, 0.4, s.novaR, 0.32, 0.15, 1);
  fx.ring(x, z, glowOf(L.elements), 0.2, s.novaR * 0.8, 0.45, 0.35, 0.6);
  fx.flash(x, 1.2, z, col, 22, 0.25, s.novaR * 3);
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * TAU;
    fx.emit(x + Math.cos(a) * 0.4, 0.5, z + Math.sin(a) * 0.4, Math.cos(a) * s.novaR * 3.4, 0.6, Math.sin(a) * s.novaR * 3.4, 0.3, 0.45, 0.1, col, 1, 0, 5);
  }
  S.shots.push({ nova: true, spell, li, L, s, x, z, dir: aim, r0: 0.4, t: 0, dur: 0.3, hit: new Set(), col, done: false, payload: li + 1 < spell.layers.length });
  emit("nova", L.elements);
}

/* ---------------------------------------------------------------
   Per frame
   --------------------------------------------------------------- */
export function update(dt) {
  const W = S.world;
  for (let i = S.shots.length - 1; i >= 0; i--) {
    const p = S.shots[i];
    if (p.done) { S.shots.splice(i, 1); continue; }
    if (p.nova) { stepNova(p, dt); if (p.done) S.shots.splice(i, 1); continue; }
    const ox = p.x, oz = p.z;
    p.x += p.vx * dt; p.z += p.vz * dt;
    p.traveled += p.speed * dt;
    p.b.g.position.set(p.x, p.y, p.z);
    if (p.s.form === "orb") { p.spin += dt * 4; p.b.m.rotation.set(p.spin, p.spin * 0.7, 0); }
    // trail
    p.trail -= dt;
    if (p.trail <= 0) {
      p.trail = p.s.form === "needle" ? 0.012 : 0.02;
      const jitter = p.r * 0.5;
      fx.emit(p.x + (Math.random() - 0.5) * jitter, p.y + (Math.random() - 0.5) * jitter, p.z + (Math.random() - 0.5) * jitter,
        -p.vx * 0.05, 0.2, -p.vz * 0.05, p.s.form === "orb" ? 0.45 : 0.28, p.r * 2.6 + 0.12, 0.02, p.col, 0.9, 0, 2);
      if (p.L.elements.includes("fire") && Math.random() < 0.5) fx.emit(p.x, p.y, p.z, rand(-1, 1), rand(0.5, 2), rand(-1, 1), 0.35, 0.18, 0.02, 0xffc15e, 1, -1, 1);
    }
    // enemies
    let ended = false;
    for (const e of enemiesNear(p.x, p.z, p.r + 2.2)) {
      if (p.hit.has(e) || !e.alive) continue;
      if (dist(p.x, p.z, e.x, e.z) > p.r + e.r) continue;
      p.hit.add(e);
      directHit(p, e);
      if (p.s.splash > 0 && p.pierce <= 0) { ended = true; break; }
      if (p.pierce > 0) p.pierce--; else { ended = true; break; }
    }
    // the world
    if (!ended && W) {
      const col = W.hitCollider(p.x, p.z, p.r * 0.6);
      if (col) {
        if (p.bounce > 0) {
          p.bounce--;
          const nx = p.x - col.x, nz = p.z - col.z, nl = Math.hypot(nx, nz) || 1;
          const dot = (p.vx * nx + p.vz * nz) / nl;
          p.vx -= 2 * dot * nx / nl; p.vz -= 2 * dot * nz / nl;
          p.x = ox; p.z = oz;
          p.dir = Math.atan2(p.vz, p.vx);
          p.b.g.rotation.y = Math.atan2(p.vx, p.vz);
          fx.burst(p.x, p.y, p.z, p.col, 6, 4, { size: 0.2 });
          emit("bounce");
        } else ended = true;
      } else if (!W.inside(p.x, p.z, -1.5)) ended = true;
    }
    if (!ended && p.traveled >= p.s.range) ended = true;
    if (ended) { finish(p); S.shots.splice(i, 1); }
  }
  // enemy shots
  for (let i = S.eshots.length - 1; i >= 0; i--) {
    const q = S.eshots[i];
    q.x += q.vx * dt; q.z += q.vz * dt; q.life -= dt;
    q.b.g.position.set(q.x, q.y, q.z);
    q.trail -= dt;
    if (q.trail <= 0) { q.trail = 0.03; fx.emit(q.x, q.y, q.z, 0, 0, 0, 0.22, q.r * 3, 0.02, ENEMY_SHOT, 0.7, 0, 0); }
    let dead = q.life <= 0 || (W && (!W.inside(q.x, q.z, -1) || W.hitCollider(q.x, q.z, q.r * 0.5)));
    const P = S.player;
    if (!dead && P && P.alive && dist(q.x, q.z, P.x, P.z) < q.r + P.r) {
      if (P.hurt(q.dmg, Math.atan2(q.vz, q.vx), q.src || "a bolt")) dead = true;
      else if (!P.dashing) dead = true;
    }
    if (dead) {
      fx.burst(q.x, q.y, q.z, ENEMY_SHOT, 5, 3, { size: 0.22 });
      release(q.b); S.eshots.splice(i, 1);
    }
  }
  // zones
  for (let i = S.zones.length - 1; i >= 0; i--) {
    const z = S.zones[i];
    z.t += dt; z.tick -= dt;
    if (Math.random() < dt * 14) {
      const a = rand(0, TAU), d = Math.sqrt(Math.random()) * z.r;
      const zx = z.x + Math.cos(a) * d, zz = z.z + Math.sin(a) * d;
      if (z.type === "steam") fx.emit(zx, 0.3, zz, 0, rand(0.8, 1.6), 0, 1.1, 0.6, 1.2, 0xdfe8f0, 0.35, -0.2, 0.5, true);
      else if (z.type === "magma") fx.emit(zx, 0.1, zz, 0, rand(1, 2.4), 0, 0.6, 0.2, 0.02, 0xff8a2a, 1, 2, 0);
      else if (z.type === "mire") fx.emit(zx, 0.1, zz, 0, rand(0.3, 0.8), 0, 0.8, 0.25, 0.05, 0x6f8f4a, 0.8, 1, 0, true);
    }
    if (z.tick <= 0) {
      z.tick = 0.3;
      for (const e of enemiesNear(z.x, z.z, z.r + 1.5)) {
        if (dist(z.x, z.z, e.x, e.z) > z.r + e.r * 0.5) continue;
        hurtEnemy(e, z.dps * 0.3, { burn: z.burn, slow: z.slow, quiet: true, color: z.col });
      }
    }
    if (z.t >= z.dur) S.zones.splice(i, 1);
  }
}

function stepNova(p, dt) {
  p.t += dt;
  const t = clamp(p.t / p.dur, 0, 1);
  const rad = p.r0 + (p.s.novaR - p.r0) * (1 - Math.pow(1 - t, 2));
  for (const e of enemiesNear(p.x, p.z, rad + 2)) {
    if (p.hit.has(e) || !e.alive) continue;
    const d = dist(p.x, p.z, e.x, e.z);
    if (d > rad + e.r) continue;
    p.hit.add(e);
    const a = Math.atan2(e.z - p.z, e.x - p.x);
    directHit(p, e, a);
  }
  if (t >= 1) finish(p);
}

/* ---------------------------------------------------------------
   Landing
   --------------------------------------------------------------- */
function directHit(p, e, angOverride) {
  const s = p.s, L = p.L;
  const a = angOverride !== undefined ? angOverride : p.dir;
  hurtEnemy(e, s.dmg, { kbx: Math.cos(a) * s.kb, kbz: Math.sin(a) * s.kb, burn: s.burn, chill: s.chill, color: p.col, elements: L.elements });
  if (!p.nova) fx.burst(e.x, 1, e.z, p.col, 7, 5, { size: 0.28 });
  if (L.reactions.includes("storm")) chain(e, s.dmg * 0.55, p);
}

function chain(from, dmg, p) {
  let src = from;
  const done = new Set([from]);
  for (let k = 0; k < 3; k++) {
    let best = null, bd = 6.5;
    for (const e of enemiesNear(src.x, src.z, 6.5)) {
      if (done.has(e) || !e.alive) continue;
      const d = dist(src.x, src.z, e.x, e.z);
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) break;
    fx.bolt(src.x, 1.2, src.z, best.x, 1.2, best.z, REACTIONS.storm.color);
    hurtEnemy(best, dmg, { chill: p.s.chill * 0.5, color: 0x9fe3ff });
    done.add(best);
    src = best;
  }
  if (done.size > 1) { fx.flash(from.x, 1.5, from.z, 0x9fe3ff, 14, 0.15, 9); emit("zap"); }
}

/** End a shot: splash, reactions, and the next layer. */
export function finish(p) {
  if (p.done) return;
  p.done = true;
  const s = p.s, L = p.L, x = p.x, z = p.z;
  if (!p.nova) {
    release(p.b); p.b = null;
    fx.burst(x, p.y, z, p.col, 8, 4, { size: 0.3 });
  }
  if (!p.nova && s.splash > 0) {
    const R = s.splash;
    fx.ring(x, z, p.col, 0.3, R, 0.3, 0.2);
    fx.burst(x, 0.8, z, p.col, 18, 7, { size: 0.4 });
    fx.burst(x, 0.8, z, 0xffffff, 6, 4, { size: 0.3 });
    fx.flash(x, 1.2, z, p.col, 18, 0.22, R * 4);
    emit("boom", R);
    for (const e of enemiesNear(x, z, R + 2)) {
      if (!e.alive) continue;
      const d = dist(x, z, e.x, e.z);
      if (d > R + e.r) continue;
      const a = Math.atan2(e.z - z, e.x - x);
      const fall = p.hit.has(e) ? 0.5 : Math.max(0.4, 1 - d / (R + e.r));
      hurtEnemy(e, s.dmg * 0.8 * fall, { kbx: Math.cos(a) * s.kb * 1.2, kbz: Math.sin(a) * s.kb * 1.2, burn: s.burn, chill: s.chill * 0.5, color: p.col });
    }
  }
  // Reactions happen wherever the shot ends — at the end of its flight, on
  // a wall, or wherever it was when you pulled the trigger.
  for (const r of L.reactions) reactAt(r, x, z, p);
  if (p.payload) {
    p.payload = false;
    const heading = p.nova ? p.dir : Math.atan2(p.vz, p.vx);
    fireLayer(p.spell, p.li + 1, x, z, heading, false);
    fx.burst(x, 1, z, 0xffffff, 6, 3, { size: 0.3 });
    emit("payload");
  }
}

function reactAt(id, x, z, p) {
  const dmg = p.s.dmg;
  if (id === "steam") addZone("steam", x, z, 2.2, 3, Math.max(4, dmg * 0.45), { col: 0xdfe8f0 });
  else if (id === "magma") addZone("magma", x, z, 1.8, 4, Math.max(3, dmg * 0.35), { col: 0xff8a2a, burn: p.s.burn || 3 });
  else if (id === "mire") addZone("mire", x, z, 2.5, 4.5, 1, { col: 0x7fa36a, slow: 0.6 });
  else if (id === "shrapnel" && !p.shard) {
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * TAU + rand(-0.2, 0.2);
      const sh = spawnShot(p.spell, p.li, p.L, Object.assign({}, p.s, { form: "needle", radius: 0.12, speed: 22, range: 7, dmg: dmg * 0.35, splash: 0, pierce: 0, bounce: 0 }), x, z, a);
      sh.shard = true; sh.payload = false;
      sh.L = Object.assign({}, p.L, { reactions: [] });
    }
  }
  // wildfire's bigger blast is already in the compiled splash; storm fires on hit
}

export function addZone(type, x, z, r, dur, dps, o) {
  o = o || {};
  const zone = { type, x, z, r, dur, t: 0, tick: 0.05, dps, slow: o.slow || 0, burn: o.burn || 0, col: o.col || 0xffffff };
  fx.decal(2, x, z, r, zone.col, dur, { opacity: type === "steam" ? 0.35 : 0.75 });
  S.zones.push(zone);
  emit("zone", type);
  return zone;
}

/** Pull the trigger: every shot still carrying a layer releases it now. */
export function triggerPayloads() {
  let n = 0;
  for (const p of S.shots) if (p.payload && !p.done && !p.nova) { finish(p); n++; }
  S.shots = S.shots.filter((p) => !p.done);
  return n;
}
export function pendingPayloads() {
  for (const p of S.shots) if (p.payload && !p.done && !p.nova) return true;
  return false;
}

/* ---------------------------------------------------------------
   Enemy shots
   --------------------------------------------------------------- */
export function enemyShot(x, z, ang, speed, dmg, opts) {
  opts = opts || {};
  const b = body(ENEMY_SHOT, ENEMY_SHOT);
  const r = opts.r || 0.24;
  b.m.scale.setScalar(r); b.h.scale.setScalar(r * 8 + 0.5);
  const q = { x, z, y: opts.y || 1.0, vx: Math.cos(ang) * speed, vz: Math.sin(ang) * speed, r, dmg, life: opts.life || 5, b, trail: 0, src: opts.src };
  b.g.position.set(x, q.y, z);
  S.eshots.push(q);
  return q;
}

export function clearAll() {
  for (const p of S.shots) if (p.b) release(p.b);
  for (const q of S.eshots) release(q.b);
  S.shots = []; S.eshots = []; S.zones = [];
}

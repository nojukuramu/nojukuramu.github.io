/* game.js — the journey: what you are doing out there, and what it gets you.
 *
 * The Phaser build's last form was a stack of walled arenas with an exit
 * gate; its endless world (ChunkManager) sat unused. This brings the endless
 * world back and gives it a shape:
 *
 *   waystones   one on every road hub. Walk onto one and it is yours: it
 *               heals you, it is where you wake if you fall, and from the map
 *               you can step between any two you hold.
 *   danger      the further from where you began, the stronger everything is
 *               (world.js dangerAt), so a direction is a choice.
 *   Wardens     every great structure — fortress, mage tower, plaza,
 *               courtyard — is held by one of the four. Beat it and it drops a
 *               Sigil, and a Sigil raises your circle rank: more glyphs,
 *               seals, runes, layers and power to a page.
 *   chests      the other structures each hide one: potions, and a wash of
 *               experience.
 *   levels      experience from everything you beat; each level is more
 *               health and deeper mana pools.
 *
 * Nothing here draws: it moves the pieces and says what happened (state.js
 * events), and the HUD, the audio and the effects listen. */

import * as THREE from "three";
import { S, emit, on } from "./state.js";
import { scene, setDay, nightness, snapCamera } from "./gfx.js";
import * as fx from "./fx.js";
import { createWorld, CHUNK, STRUCTURE_NAMES } from "./world.js";
import * as chunks from "./chunks.js";
import { createPlayer, updatePlayer } from "./player.js";
import { spawn, spawnWarden, despawnHome, clearEnemies, updateEnemies, updateZones } from "./enemies.js";
import { updateShots, clearShots } from "./spells.js";
import { ELEMENT_IDS, elementInfo, MAX_RANK } from "./spellcore.js";
import { glowTexture } from "./textures.js";
import { single } from "./assets.js";
import { save } from "./save.js";
import { rand, dist, TAU } from "./util.js";

const DAY_SECONDS = 14 * 60;
const PACK_RESPAWN = 240;
let J = null;                       // the journey record, as saved
const attuned = new Set(), sigils = new Set(), chests = new Set(), seen = new Set();
const cleared = new Map();          // chunk key → game time its pack was beaten
let saveT = 0;

export function journey() { return J; }
export const isAttuned = (id) => attuned.has(id);
export const hasSigil = (id) => sigils.has(id);
export const seenSet = () => seen;
export const attunedSet = () => attuned;

/* ---------------------------------------------------------------
   Starting and stopping
   --------------------------------------------------------------- */
export function start(record) {
  stop();
  J = record;
  S.world = createWorld(J.seed);
  S.mode = "play"; S.over = false; S.paused = false; S.time = J.time || 0; S.day = J.day; S.nullify = false;
  attuned.clear(); sigils.clear(); chests.clear(); seen.clear(); cleared.clear();
  J.waystones.forEach((w) => attuned.add(w)); J.sigils.forEach((s) => sigils.add(s));
  J.chests.forEach((c) => chests.add(c)); J.seen.forEach((s) => seen.add(s));
  attuned.add("w0_0");
  chunks.setHooks({ spawnPack, despawnChunk: despawnHome });
  S.player = createPlayer(J);
  chunks.loadAround(J.x, J.z);
  snapCamera(J.x, J.z);
  setDay(S.day);
  emit("journeyStart", J);
}

export function stop() {
  if (S.player) { S.player.dispose(); S.player = null; }
  clearShots();
  clearEnemies();
  for (const p of S.pickups) removePickup(p);
  S.pickups.length = 0; S.zones.length = 0;
  chunks.clear();
  fx.clearAll();
  S.boss = null;
}

export function persist() {
  if (!J || !S.player) return;
  const P = S.player;
  Object.assign(J, {
    x: P.alive ? P.x : J.home.x, z: P.alive ? P.z : J.home.z,
    level: P.level, xp: P.xp, rank: P.rank, potions: P.potions, hp: P.alive ? P.hp : null,
    time: S.time, day: S.day,
    waystones: [...attuned], sigils: [...sigils], chests: [...chests], seen: [...seen]
  });
  save.setJourney(J);
  const best = save.data.best, far = Math.hypot(P.x, P.z);
  if (far > best.distance) best.distance = Math.round(far);
  if (sigils.size > best.sigils) best.sigils = sigils.size;
  if (P.level > best.level) best.level = P.level;
  save.commit();
}

/* ---------------------------------------------------------------
   Creatures, by chunk
   --------------------------------------------------------------- */
function spawnPack(C) {
  if (C.warden && !sigils.has(C.warden.id) && !S.enemies.some((e) => e.boss && e.id === C.warden.id)) spawnWarden(C.warden);
  if (!C.pack.length) return;
  const t = cleared.get(C.key);
  if (t !== undefined && S.time - t < PACK_RESPAWN) return;
  for (const p of C.pack) spawn(p.kind, p.x, p.z, C.danger, C);
}

on("kill", (e) => {
  const P = S.player;
  if (!P) return;
  save.data.stats.kills++;
  J.kills = (J.kills || 0) + 1;
  const xp = e.boss ? 120 * e.danger : e.K.xp * (1 + 0.3 * (e.danger - 1));
  // experience comes out as orbs that drift to you
  const n = e.boss ? 14 : 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) drop("xp", e.x + rand(-0.6, 0.6), e.z + rand(-0.6, 0.6), xp / n);
  if (Math.random() < (e.boss ? 1 : 0.35)) drop("mana", e.x + rand(-0.8, 0.8), e.z + rand(-0.8, 0.8), 0, ELEMENT_IDS[Math.floor(Math.random() * 4)]);
  if (Math.random() < (e.boss ? 1 : 0.12)) drop("hp", e.x + rand(-0.8, 0.8), e.z + rand(-0.8, 0.8), 18);
  if (Math.random() < (e.boss ? 1 : 0.025)) drop("potion", e.x, e.z + 0.8);
  if (e.boss) {
    drop("sigil", e.hx, e.hz, 0, null, e.id);
    S.boss = null;
  }
  if (e.home && !S.enemies.some((o) => o !== e && o.alive && o.home === e.home)) cleared.set(e.home, S.time);
});
on("bossIntro", (e) => { S.boss = e; });
on("bossLost", (e) => { if (S.boss === e) S.boss = null; });

on("objectBroken", (o, x, z) => {
  const K = o.kind;
  if ((K === "crate" || K === "barrel") && Math.random() < 0.45) {
    const r = Math.random();
    if (r < 0.55) drop("mana", x, z, 0, ELEMENT_IDS[Math.floor(Math.random() * 4)]);
    else if (r < 0.9) drop("hp", x, z, 14);
    else drop("potion", x, z);
  }
});

/* ---------------------------------------------------------------
   Pickups
   --------------------------------------------------------------- */
const orbGeo = new THREE.IcosahedronGeometry(1, 0);
const orbMats = new Map();
function orbMat(hex) {
  if (!orbMats.has(hex)) orbMats.set(hex, new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(2) }));
  return orbMats.get(hex);
}
const PICK = {
  xp: { color: 0xc8a8ff, size: 0.12 },
  mana: { size: 0.2 },
  hp: { color: 0xff5a7a, size: 0.2 },
  potion: { color: 0xff5a7a, size: 0.3 },
  sigil: { color: 0xffd97a, size: 0.5 }
};
function drop(type, x, z, amount, el, id) {
  const D = PICK[type];
  const color = type === "mana" ? elementInfo(el).hex : D.color;
  const g = new THREE.Group();
  let mesh;
  if (type === "potion") mesh = single("dungeon/potion", { h: 0.6 });
  else if (type === "sigil") {
    mesh = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 6, 28), orbMat(color));
    const tri = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.05, 3, 3), orbMat(color));
    mesh.add(ring, tri);
  }
  if (!mesh) { mesh = new THREE.Mesh(orbGeo, orbMat(color)); mesh.scale.setScalar(D.size); }
  g.add(mesh);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 }));
  halo.scale.setScalar(D.size * (type === "sigil" ? 6 : 5));
  g.add(halo);
  g.position.set(x, 0.6, z);
  scene.add(g);
  const a = rand(0, TAU), sp = type === "sigil" ? 0 : rand(1, 3);
  S.pickups.push({ type, x, z, y: 0.6, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: type === "sigil" ? 0 : 4, amount, el, id, g, mesh, halo, t: 0, life: type === "sigil" ? Infinity : 60 });
}
function removePickup(p) { scene.remove(p.g); p.halo.material.dispose(); }

function updatePickups(dt) {
  const P = S.player;
  for (let i = S.pickups.length - 1; i >= 0; i--) {
    const p = S.pickups[i];
    p.t += dt;
    if (p.t > p.life) { removePickup(p); S.pickups.splice(i, 1); continue; }
    p.vy -= 14 * dt; p.y += p.vy * dt;
    if (p.y < 0.5) { p.y = 0.5; p.vy = Math.abs(p.vy) * 0.3; }
    p.vx *= Math.exp(-3 * dt); p.vz *= Math.exp(-3 * dt);
    if (P && P.alive) {
      const d = dist(p.x, p.z, P.x, P.z);
      const pull = p.type === "xp" ? 5.5 : p.type === "sigil" ? 2.4 : 3.5;
      if (d < pull && p.t > 0.35) { const a = Math.atan2(P.z - p.z, P.x - p.x), s = 14 * (1 - d / pull) + 3; p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; }
      if (d < 0.7 && p.t > 0.3) { collect(p); removePickup(p); S.pickups.splice(i, 1); continue; }
    }
    p.x += p.vx * dt; p.z += p.vz * dt;
    p.g.position.set(p.x, p.y + Math.sin(p.t * 3) * 0.08, p.z);
    p.mesh.rotation.y += dt * 2; p.mesh.rotation.x += dt * (p.type === "sigil" ? 0.7 : 1.3);
  }
}

function collect(p) {
  const P = S.player;
  if (p.type === "xp") P.gainXp(p.amount);
  else if (p.type === "mana") { P.addMana(p.el, 35); fx.number(P.x, 2, P.z, "+35 " + elementInfo(p.el).name, "info"); }
  else if (p.type === "hp") P.heal(p.amount);
  else if (p.type === "potion") { if (P.potions < 5) P.potions++; else P.heal(30); emit("toast", "A potion"); }
  else if (p.type === "sigil") claimSigil(p.id);
  emit("pickup", p.type);
}

function claimSigil(id) {
  const P = S.player;
  sigils.add(id);
  const before = P.rank;
  if (P.rank < MAX_RANK) P.rank++;
  P.recompute();
  P.hp = P.maxHp;
  for (const e of ELEMENT_IDS) P.mana[e] = P.maxMana;
  P.recompile();
  fx.ring(P.x, P.z, 0xffd97a, 0.5, 9, 0.9, 0.3);
  fx.burst(P.x, 1.2, P.z, 0xffd97a, 60, 8, { size: 0.45, grav: -2 });
  emit("rankUp", P.rank, before === P.rank);
  persist();
}

/* ---------------------------------------------------------------
   Waystones and chests
   --------------------------------------------------------------- */
function updateInteract(dt) {
  const P = S.player;
  if (!P || !P.alive) return;
  for (const it of chunks.interactables.slice()) {
    const d = dist(P.x, P.z, it.x, it.z);
    if (it.type === "waystone" && d < it.r) {
      if (!attuned.has(it.id)) {
        attuned.add(it.id);
        fx.ring(it.x, it.z, 0x8fd8ff, 0.5, 5, 0.8, 0.1);
        fx.burst(it.x, 2.4, it.z, 0x8fd8ff, 40, 6, { size: 0.35, grav: -2 });
        emit("attune", it);
      }
      if (!J.home || J.home.x !== it.x || J.home.z !== it.z) { J.home = { x: it.x, z: it.z }; persist(); }
      // a held waystone tops you up while you stand on it
      P.heal(P.maxHp * 0.25 * dt, true);
      for (const e of ELEMENT_IDS) P.mana[e] = Math.min(P.maxMana, P.mana[e] + 20 * dt);
    } else if (it.type === "chest" && d < it.r && !chests.has(it.id)) {
      chests.add(it.id);
      chunks.removeInteractable(it);
      fx.burst(it.x, 1, it.z, 0xffd97a, 40, 6, { size: 0.35 });
      fx.ring(it.x, it.z, 0xffd97a, 0.3, 3, 0.5);
      for (let i = 0; i < 6; i++) drop("xp", it.x, it.z, 10 + 4 * S.world.dangerAt(it.x, it.z));
      drop("potion", it.x, it.z);
      drop("mana", it.x, it.z, 0, ELEMENT_IDS[Math.floor(Math.random() * 4)]);
      emit("chest", it);
      persist();
    }
  }
  // chests already opened in an earlier session stay gone
  for (const it of chunks.interactables.slice()) if (it.type === "chest" && chests.has(it.id)) chunks.removeInteractable(it);
}

/* Step to a waystone you hold, from the map. */
export function travelTo(w) {
  const P = S.player;
  if (!P || !P.alive || !attuned.has(w.id)) return false;
  if (S.boss && !S.boss.dormant) { emit("toast", "Not while a Warden is awake"); return false; }
  clearShots();
  clearEnemies();
  chunks.clear();
  P.x = w.x; P.z = w.z + 3; P.vx = P.vz = 0;
  J.home = { x: w.x, z: w.z };
  chunks.loadAround(P.x, P.z);
  snapCamera(P.x, P.z);
  fx.ring(P.x, P.z, 0x8fd8ff, 0.4, 4, 0.6);
  emit("travel", w);
  persist();
  return true;
}

/* ---------------------------------------------------------------
   Falling, and waking
   --------------------------------------------------------------- */
on("playerDied", () => { save.data.stats.deaths++; persist(); });
export function wake() {
  const P = S.player;
  if (!P) return;
  clearShots();
  const h = J.home || { x: 0, z: 3 };
  const far = dist(P.x, P.z, h.x, h.z) > CHUNK * 3;
  if (far) { clearEnemies(); chunks.clear(); }
  P.respawn(h.x, h.z + 3);
  if (far) chunks.loadAround(P.x, P.z);
  snapCamera(P.x, P.z);
  S.boss = null;
  for (const e of S.enemies) if (e.boss && e.alive) { e.dormant = true; e.state = "sleep"; e.x = e.hx; e.z = e.hz; e.hp = e.maxHp; }
  persist();
}

/* ---------------------------------------------------------------
   What to do next: the nearest Warden you have not beaten
   --------------------------------------------------------------- */
let objT = 0, objective = null;
export function getObjective() { return objective; }
function updateObjective(dt) {
  objT -= dt;
  if (objT > 0 || !S.player) return;
  objT = 1;
  const P = S.player;
  const near = S.world.structuresNear(P.x, P.z, 900);
  for (const s of near) {
    if (!seen.has(s.id) && dist(P.x, P.z, s.x, s.z) < 36) { seen.add(s.id); emit("discover", s); }
  }
  const target = near.find((s) => s.great && !sigils.has(s.id));
  objective = target ? { s: target, name: STRUCTURE_NAMES[target.type], d: dist(P.x, P.z, target.x, target.z), ang: Math.atan2(target.z - P.z, target.x - P.x), danger: S.world.dangerAt(target.x, target.z) } : null;
}

/* ---------------------------------------------------------------
   Per frame
   --------------------------------------------------------------- */
export function update(dt, input) {
  const P = S.player;
  if (!P || S.paused) return;
  S.time += dt;
  S.day = (S.day + dt / DAY_SECONDS) % 1;
  setDay(S.day);
  // the Void Sentinel's curse: the next cast fizzles (the old bossNullifyCast)
  if (S.nullify && input.cast && P.castCd <= 0 && P.alive) {
    S.nullify = false; P.castCd = 0.6;
    fx.burst(P.x, 1.4, P.z, 0xb36bff, 20, 4, { size: 0.3 });
    emit("fizzle");
    input.cast = false;
  }
  updatePlayer(P, dt, input);
  chunks.update(P.x, P.z, dt);
  updateEnemies(dt);
  updateZones(dt);
  updateShots(dt);
  updatePickups(dt);
  updateInteract(dt);
  updateObjective(dt);
  chunks.tickWaystones(S.time, attuned);
  saveT += dt;
  if (saveT > 6) { saveT = 0; persist(); }
}

/* For the title screen: the world drawn with nobody in it. */
export function titleWorld(seedText) {
  stop();
  S.world = createWorld(seedText);
  chunks.setHooks({ spawnPack: () => {}, despawnChunk: () => {} });
  chunks.loadAround(0, 0);
}
export { nightness };

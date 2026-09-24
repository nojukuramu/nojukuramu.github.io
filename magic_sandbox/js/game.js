/* game.js — a run from the first floor to the top, and the rules between.
 *
 * What a floor asks, what drops, what a chest holds, when the portal opens,
 * where you start again after a fall. The pacing it is built around:
 *
 *   Every other floor is a landing. Odd floors (1, 3, 5, 7, 9) record a
 *   checkpoint the moment you arrive, and a death offers that landing back
 *   with the level, boons and circle rank you arrived with. The first version
 *   sent every death back to floor one with nothing — the one rule that did
 *   most to make the tower feel unwinnable.
 *
 *   Stepping through a portal heals a third of your health and fills your
 *   mana. Shrines heal and hand back a potion. Nothing respawns on a timer:
 *   a cleared camp stays cleared, so exploring is safe once it is earned.
 *
 *   Wardens raise your circle rank by one, which is what unlocks bigger
 *   pages in the spellbook. Floor ten's Loom Heart is the end; Endless
 *   carries on past it for anyone who wants to see how far a page can go. */

import * as THREE from "three";
import { S, emit, on } from "./state.js";
import { scene, snapCamera, applyTheme } from "./gfx.js";
import * as fx from "./fx.js";
import { buildWorld } from "./world.js";
import { THEMES, themeForFloor, floorKind } from "./themes.js";
import { createPlayer, updatePlayer } from "./player.js";
import * as enemies from "./enemies.js";
import * as spells from "./spells.js";
import { buildPortal, modelInstance, std, halo, blobShadow } from "./models.js";
import { rollBoons } from "./boons.js";
import { save } from "./save.js";
import { MAX_RANK } from "./spellcore.js";
import { TAU, rand, dist, mulberry32, clamp } from "./util.js";

/* ---------------------------------------------------------------
   Pickups: little glowing things that fly to you
   --------------------------------------------------------------- */
const PICK = {
  xp:     { color: 0xb39dff, size: 0.14 },
  hp:     { color: 0xff5a74, size: 0.2 },
  mana:   { color: 0x4fb4ff, size: 0.18 },
  potion: { color: 0xff6f8a, size: 0.26 },
  thread: { color: 0xffd97a, size: 0.34 }
};
const orbGeo = new THREE.IcosahedronGeometry(1, 0);
const orbMats = {};
function orbMat(type) {
  return orbMats[type] || (orbMats[type] = new THREE.MeshBasicMaterial({ color: new THREE.Color(PICK[type].color).multiplyScalar(2.2) }));
}
export function drop(type, x, z, value) {
  const d = PICK[type];
  const g = new THREE.Group();
  const m = new THREE.Mesh(orbGeo, orbMat(type));
  m.scale.setScalar(d.size);
  g.add(m, halo(d.color, d.size * 9, 0.7));
  const a = rand(0, TAU), sp = rand(1.5, 4);
  const p = { type, x, z, y: 0.6, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: rand(3, 5), value, t: 0, g, m, drawn: false };
  g.position.set(x, 0.6, z);
  scene.add(g);
  S.pickups.push(p);
  return p;
}
function updatePickups(dt) {
  const P = S.player;
  const magnet = 4.5 * (1 + (P ? P.mods.magnet : 0));
  for (let i = S.pickups.length - 1; i >= 0; i--) {
    const p = S.pickups[i];
    p.t += dt;
    if (P && P.alive) {
      const d = dist(p.x, p.z, P.x, P.z);
      // Experience and a Warden's thread find you by themselves after a moment:
      // progress should never be lost to not walking over a dot. Health and
      // mana stay where they fell — picking those up is a choice in a fight.
      const homes = (p.type === "xp" && p.t > 2.5) || (p.type === "thread" && p.t > 1.2);
      if ((d < magnet || p.drawn || homes) && p.t > 0.35) {
        p.drawn = true;
        const a = Math.atan2(P.z - p.z, P.x - p.x), sp = 7 + p.t * 6;
        p.vx = Math.cos(a) * sp; p.vz = Math.sin(a) * sp;
      }
      if (d < 0.8 && p.t > 0.3) { collect(p); scene.remove(p.g); S.pickups.splice(i, 1); continue; }
    }
    if (!p.drawn) { const k = Math.exp(-3 * dt); p.vx *= k; p.vz *= k; }
    p.vy -= 14 * dt; p.y = Math.max(0.45, p.y + p.vy * dt); if (p.y === 0.45) p.vy = Math.abs(p.vy) * 0.3;
    p.x += p.vx * dt; p.z += p.vz * dt;
    if (S.world && !p.drawn) S.world.resolve(p, 0.2, true);
    p.g.position.set(p.x, p.y + Math.sin(p.t * 4) * 0.06, p.z);
    p.m.rotation.y += dt * 3;
    if (p.t > 40 && p.type !== "thread" && p.type !== "potion") { scene.remove(p.g); S.pickups.splice(i, 1); }
  }
}
function collect(p) {
  const P = S.player;
  if (p.type === "xp") P.gainXp(p.value);
  else if (p.type === "hp") P.heal(p.value);
  else if (p.type === "mana") P.addMana(p.value);
  else if (p.type === "potion") {
    if (P.potions < P.potionCap) { P.potions++; emit("toast", "Potion"); }
    else { P.heal(P.maxHp * 0.2); }
  } else if (p.type === "thread") {
    if (P.rank < MAX_RANK) {
      P.rank++; P.recompile();
      emit("rankUp", P.rank);
    }
  }
  emit("pickup", p.type);
}
function dropXp(x, z, total) {
  while (total > 0) {
    const v = total > 20 ? 10 : total > 6 ? 4 : total;
    drop("xp", x, z, v); total -= v;
  }
}

/* ---------------------------------------------------------------
   Props: chests, shrines, the portal
   --------------------------------------------------------------- */
function addChest(x, z) {
  let mesh = modelInstance("chest", 0.9);
  if (!mesh) {
    mesh = new THREE.Group();
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.75), std(0x8a5a30));
    b.position.y = 0.35; b.castShadow = true; mesh.add(b);
  }
  mesh.add(blobShadow(0.9));
  const glow = halo(0xffd97a, 2.4, 0.35); glow.position.y = 0.8; mesh.add(glow);
  mesh.position.set(x, 0, z); mesh.rotation.y = rand(0, TAU);
  S.world.group.add(mesh);
  const col = S.world.addDynamic(x, z, 0.55);
  S.props.push({ kind: "chest", x, z, mesh, glow, col, used: false, label: "Open the chest" });
}
function addShrine(x, z) {
  let mesh = modelInstance("shrine", 1.5, { emissive: 0x7f6cff, ei: 0.06 });
  if (!mesh) {
    mesh = new THREE.Group();
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.5, 8), std(0x5a6070));
    b.position.y = 0.25; mesh.add(b);
  }
  const glow = halo(0xff8fb0, 4, 0.55); glow.position.y = 1.3; mesh.add(glow);
  mesh.position.set(x, 0, z);
  S.world.group.add(mesh);
  const col = S.world.addDynamic(x, z, 1.1);
  S.props.push({ kind: "shrine", x, z, mesh, glow, col, used: false, label: "Rest at the shrine" });
}
function addPortal(x, z) {
  const b = buildPortal(S.world.theme.accent);
  b.root.position.set(x, 0, z);
  S.world.group.add(b.root);
  const p = { kind: "portal", x, z, mesh: b.root, b, on: false, t: 0, label: "Step into the portal" };
  S.props.push(p);
  S.portal = p;
}
function openPortal(final) {
  const p = S.portal;
  if (!p || p.on) return;
  p.on = true; p.final = !!final;
  if (final) p.b.poolMat.uniforms.uColor.value.set(0xffd97a);
  fx.ring(p.x, p.z, S.world.theme.accent, 0.5, 6, 0.8, 0.2);
  emit("portalOpen", final);
}

function nearestProp(P) {
  let best = null, bd = 2.6;
  for (const p of S.props) {
    if (p.used || (p.kind === "portal")) continue;
    const d = dist(p.x, p.z, P.x, P.z);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
export function interactTarget() { return S.player && S.player.alive ? nearestProp(S.player) : null; }

function useProp(p) {
  const P = S.player;
  if (p.kind === "chest") {
    p.used = true; p.col.on = false;
    p.glow.material.opacity = 0;
    p.mesh.children[0].rotation.x = -0.25;
    fx.burst(p.x, 1, p.z, 0xffd97a, 24, 5, { size: 0.35 });
    fx.ring(p.x, p.z, 0xffd97a, 0.3, 2.4, 0.4);
    emit("chest");
    const roll = Math.random();
    if (roll < 0.45) offerBoons("chest");
    else {
      dropXp(p.x, p.z, 10 + S.floor * 3);
      drop("potion", p.x, p.z, 1);
      for (let k = 0; k < 3; k++) drop("mana", p.x, p.z, 20);
    }
  } else if (p.kind === "shrine") {
    p.used = true;
    p.glow.material.opacity = 0.08;
    P.heal(P.maxHp * 0.5);
    P.mana = P.maxMana;
    if (P.potions < P.potionCap) P.potions++;
    fx.ring(p.x, p.z, 0xff8fb0, 0.5, 4, 0.6, 0.2);
    fx.burst(P.x, 1.2, P.z, 0xff8fb0, 30, 4, { size: 0.35, grav: -3 });
    emit("shrine");
    emit("toast", "The shrine mends you");
  }
}

/* ---------------------------------------------------------------
   Floors
   --------------------------------------------------------------- */
function campRoster(floor, rng) {
  const pool = ["mote", "knot", "knot"];
  if (floor >= 2) pool.push("golem", "knot");
  if (floor >= 3) pool.push("spindle", "spindle");
  if (floor >= 4) pool.push("weaver");
  if (floor >= 5) pool.push("golem", "spindle", "knot");
  const size = 2 + Math.floor(rng() * 2) + Math.floor(floor / 3);
  const out = [];
  while (out.length < size) {
    const t = pool[Math.floor(rng() * pool.length)];
    if (t === "mote") { out.push("mote", "mote", "mote"); continue; }
    if (t === "weaver" && out.includes("weaver")) continue;
    out.push(t);
  }
  return out;
}

function clearFloor() {
  spells.clearAll();
  enemies.clearAll();
  for (const p of S.pickups) scene.remove(p.g);
  S.pickups = [];
  S.props = [];
  S.portal = null;
  S.boss = null;
  if (S.barrier) { scene.remove(S.barrier); S.barrier.geometry.dispose(); S.barrier.material.dispose(); S.barrier = null; }
  if (S.world) { scene.remove(S.world.group); S.world.dispose(); S.world = null; }
  fx.clearAll();
}

export function buildFloor(floor, seed) {
  clearFloor();
  S.floor = floor;
  S.seed = seed;
  const sandbox = S.mode === "sandbox";
  const kind = sandbox ? "sandbox" : floorKind(floor);
  const theme = sandbox ? THEMES.sanctum : themeForFloor(floor);
  const W = buildWorld({ floor, seed, kind, theme });
  S.world = W;
  scene.add(W.group);
  applyTheme(theme);
  W.onThunder = () => { emit("thunder"); fx.flash(S.player ? S.player.x : 0, 30, S.player ? S.player.z : 0, 0xcfe0ff, 60, 0.35, 120); };
  const rng = mulberry32(seed ^ 0x9e3779b9);

  const P = S.player;
  P.x = W.spawn.x; P.z = W.spawn.z; P.vx = P.vz = 0; P.iframe = 1.2;
  P.aim = Math.atan2(-W.spawn.z, -W.spawn.x);
  snapCamera(P.x, P.z);

  if (sandbox) {
    W.dummies.forEach((d) => enemies.spawnEnemy("dummy", d.x, d.z, { elite: false }));
    S.objective = { kind: "sandbox", text: "Practice freely" };
  } else {
    W.camps.forEach((c) => campRoster(floor, rng).forEach((t, i) => {
      const a = i / 5 * TAU + rng(), r = 0.8 + rng() * 2.2;
      enemies.spawnEnemy(t, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r);
    }));
    W.anchors.forEach((a) => enemies.spawnEnemy("anchor", a.x, a.z, { aggro: true }));
    W.geodes.forEach((g) => enemies.spawnEnemy("geode", g.x, g.z));
    W.chests.forEach((c) => addChest(c.x, c.z));
    W.shrines.forEach((s) => addShrine(s.x, s.z));
    addPortal(W.portal.x, W.portal.z);
    if (kind === "anchors") S.objective = { kind, done: 0, total: W.anchors.length };
    else {
      const b = enemies.spawnEnemy(kind === "heart" ? "heart" : "warden", W.arena.x, W.arena.z, { elite: false });
      b.state = "sleep";
      S.boss = b;
      S.objective = { kind, done: 0, total: 1 };
    }
  }
  S.objective.text = objectiveText();
  emit("floorStart", floor, theme, kind);
  // Odd floors are landings: remember how you arrived, to come back to.
  if (!sandbox && floor % 2 === 1) {
    save.setLanding(Object.assign(P.snapshot(), { floor, time: S.runTime, kills: S.kills }));
  }
}

export function objectiveText() {
  const o = S.objective;
  if (!o) return "";
  if (o.kind === "sandbox") return "Practice freely";
  if (S.portal && S.portal.on) return S.portal.final ? "The crown is open" : "The portal is open";
  if (o.kind === "anchors") return "Sever the Anchors " + o.done + "/" + o.total;
  if (o.kind === "heart") return "Unmake the Loom Heart";
  return "Defeat the Warden";
}

/* ---------------------------------------------------------------
   Runs
   --------------------------------------------------------------- */
function newPlayer(snap) {
  if (S.player) S.player.dispose();
  S.player = createPlayer(snap);
}

export function startRun(fromLanding) {
  const L = fromLanding ? save.data.landing : null;
  S.mode = "run";
  S.over = false; S.paused = false;
  S.runTime = L ? L.time : 0;
  S.kills = L ? L.kills : 0;
  S.time = 0;
  newPlayer(L ? { level: L.level, xp: L.xp, boons: L.boons, rank: L.rank, potions: L.potions } : null);
  save.data.stats.runs++; save.commit();
  buildFloor(L ? L.floor : 1, (Math.random() * 1e9) | 0);
  emit("runStart", !!L);
}

export function startSandbox() {
  S.mode = "sandbox";
  S.over = false; S.paused = false; S.time = 0; S.runTime = 0; S.kills = 0;
  newPlayer({ rank: MAX_RANK, level: 1, potions: 3 });
  S.player.noDeath = S.sandbox.noDeath;
  S.player.infiniteMana = S.sandbox.infiniteMana;
  buildFloor(1, 7777);
  emit("runStart", false);
}

export function quitToTitle() {
  clearFloor();
  if (S.player) { S.player.dispose(); S.player = null; }
  S.mode = "title";
  S.over = false; S.paused = false;
  emit("title");
}

let transition = null;
function ascend() {
  const P = S.player;
  const p = S.portal;
  if (transition) return;
  if (p.final) {
    S.over = true;
    save.data.best.wins++;
    save.data.best.floor = Math.max(save.data.best.floor, S.floor);
    if (!save.data.best.time || S.runTime < save.data.best.time) save.data.best.time = S.runTime;
    save.clearLanding();
    emit("victory");
    return;
  }
  // experience, potions and a Warden's thread still in flight come along;
  // stepping through quickly must never cost you a rank
  for (const q of S.pickups) if (q.type === "xp" || q.type === "thread" || q.type === "potion") collect(q);
  emit("ascend");
  transition = { t: 0, next: S.floor + 1 };
  P.iframe = 3;
}
export function continueEndless() {
  S.over = false;
  const P = S.player;
  P.heal(P.maxHp); P.mana = P.maxMana;
  emit("ascend");
  transition = { t: 0, next: S.floor + 1 };
}

export function sandboxSpawn(type) {
  const P = S.player;
  if (!P || S.mode !== "sandbox") return;
  const a = P.aim, d = type === "warden" ? 12 : 9;
  let x = P.x + Math.cos(a) * d, z = P.z + Math.sin(a) * d;
  if (!S.world.inside(x, z, 2)) { x = P.x * 0.5; z = P.z * 0.5; }
  if (type === "warden") {
    if (S.boss && S.boss.alive) return;
    S.world.arena = { x, z, r: 11 };
    const b = enemies.spawnEnemy("warden", x, z, { elite: false, pop: true });
    b.state = "intro"; b.t = 1.4; b.aggro = true; b.invuln = true;
    S.boss = b;
    emit("bossIntro", b);
    return;
  }
  const kinds = type === "mote" ? ["mote", "mote", "mote"] : [type];
  kinds.forEach((k, i) => enemies.spawnEnemy(k, x + i * 0.8, z, { aggro: true, pop: true, elite: false }));
}
export function sandboxClear() {
  for (const e of S.enemies) if (e.alive && e.type !== "dummy") enemies.kill(e, true);
  if (S.boss) { S.boss = null; S.world.arena = null; }
  emit("bossGone");
}

/* ---------------------------------------------------------------
   Level-ups and boon cards
   --------------------------------------------------------------- */
let offerQueue = [];
function offerBoons(source) {
  offerQueue.push(source);
}
function pumpOffers() {
  if (!offerQueue.length || S.paused || S.over || !S.player || !S.player.alive || transition) return;
  const source = offerQueue.shift();
  const choices = rollBoons(S.player.boons, 3);
  if (!choices.length) return;
  emit("offerBoons", choices, source);
}
export function takeBoon(id) {
  S.player.addBoon(id);
  emit("boonTaken", id);
}

/* ---------------------------------------------------------------
   Events from the fight
   --------------------------------------------------------------- */
on("kill", (e) => {
  const P = S.player;
  if (!P || S.mode === "title") return;
  if (e.type === "geode") {
    for (let k = 0; k < 3; k++) drop("mana", e.x, e.z, 18);
    drop("hp", e.x, e.z, 10);
    if (Math.random() < 0.12) drop("potion", e.x, e.z, 1);
    return;
  }
  dropXp(e.x, e.z, e.xp);
  if (Math.random() < (e.type === "golem" ? 0.5 : 0.18)) drop("hp", e.x, e.z, 8);
  if (Math.random() < 0.3) drop("mana", e.x, e.z, 14);
  if (P.mods.siphon) { P.addMana(4 * P.mods.siphon); P.heal(P.mods.siphon, true); }
  if (e.type === "anchor") {
    for (const o of S.enemies) if (o.owner === e && o.alive) enemies.kill(o);
    S.objective.done++;
    drop("hp", e.x, e.z, 15);
    if (Math.random() < 0.5) drop("potion", e.x, e.z, 1);
    emit("anchorDown", S.objective.done, S.objective.total);
    if (S.objective.done >= S.objective.total) openPortal(false);
  }
  if (e.boss) {
    S.boss = null;
    if (S.mode === "sandbox") { emit("bossDown", e); return; }
    for (const o of S.enemies) if (o.alive && dist(o.x, o.z, e.x, e.z) < 16) enemies.kill(o);
    drop("thread", e.x, e.z, 1);
    drop("potion", e.x, e.z, 1);
    for (let k = 0; k < 4; k++) drop("hp", e.x, e.z, 10);
    S.objective.done = 1;
    offerBoons("warden");
    emit("bossDown", e);
    openPortal(e.type === "heart");
  }
  if (S.objective) S.objective.text = objectiveText();
});
on("levelUp", () => offerBoons("level"));
on("portalOpen", () => { if (S.objective) S.objective.text = objectiveText(); });
on("playerDied", () => {
  if (S.mode !== "run") return;
  save.data.stats.deaths++;
  save.data.best.floor = Math.max(save.data.best.floor, S.floor);
  save.commit();
});
on("bossIntro", () => {
  const A = S.world.arena;
  if (!A) return;
  const g = new THREE.CylinderGeometry(A.r, A.r, 3.2, 72, 1, true);
  const m = new THREE.MeshBasicMaterial({ color: S.world.theme.accent, map: curtainTex(), transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const bar = new THREE.Mesh(g, m);
  bar.position.set(A.x, 1.6, A.z);
  bar.scale.y = 0.01;
  scene.add(bar);
  S.barrier = bar;
});
/* A wall of light that is brightest at the ground and gone by head height:
   enough to say "you are shut in", not enough to hide the fight. */
let curtain = null;
function curtainTex() {
  if (curtain) return curtain;
  const c = document.createElement("canvas"); c.width = 4; c.height = 64;
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(0.7, "rgba(255,255,255,0.35)"); gr.addColorStop(1, "rgba(255,255,255,1)");
  g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
  curtain = new THREE.CanvasTexture(c);
  return curtain;
}
on("bossDown", () => { if (S.barrier) S.barrier.userData.fall = true; });
on("bossGone", () => { if (S.barrier) S.barrier.userData.fall = true; });

/* ---------------------------------------------------------------
   Per frame
   --------------------------------------------------------------- */
let deathShown = false;
export function update(dt, input) {
  const P = S.player;
  if (!P) return;
  S.time += dt;
  if (S.mode === "run" && !S.over) S.runTime += dt;
  if (S.mode === "sandbox") { P.infiniteMana = S.sandbox.infiniteMana; P.noDeath = S.sandbox.noDeath; }

  updatePlayer(P, dt, input);
  enemies.update(dt);
  spells.update(dt);
  updatePickups(dt);
  if (S.world) S.world.update(dt, S.time, P.x, P.z);

  // interact
  if (input.interact && P.alive) { const t = nearestProp(P); if (t) useProp(t); }

  // portal
  const p = S.portal;
  if (p) {
    p.t += dt;
    const u = p.b.poolMat.uniforms;
    u.uTime.value = S.time;
    u.uOn.value = clamp(u.uOn.value + (p.on ? dt : -dt) * 1.5, 0, 1);
    p.b.beam.material.opacity = u.uOn.value * (0.2 + Math.sin(S.time * 3) * 0.05);
    p.b.runeM.emissiveIntensity = 0.2 + u.uOn.value * 2.2;
    if (p.on && Math.random() < dt * 20) {
      const a = rand(0, TAU), r = rand(0, 2);
      fx.emit(p.x + Math.cos(a) * r, 0.2, p.z + Math.sin(a) * r, 0, rand(2, 5), 0, 1.2, 0.2, 0.05, p.final ? 0xffd97a : S.world.theme.accent, 1, -1, 0);
    }
    if (p.on && P.alive && !transition && !S.over && dist(P.x, P.z, p.x, p.z) < 1.9) ascend();
  }
  // props idle
  for (const q of S.props) if (q.glow && !q.used) q.glow.material.opacity = (q.kind === "chest" ? 0.3 : 0.5) + Math.sin(S.time * 2.5 + q.x) * 0.12;

  // barrier
  if (S.barrier) {
    const b = S.barrier;
    if (b.userData.fall) { b.scale.y = Math.max(0.01, b.scale.y - dt * 1.5); b.material.opacity *= Math.exp(-3 * dt); if (b.scale.y <= 0.02) { scene.remove(b); b.geometry.dispose(); b.material.dispose(); S.barrier = null; } }
    else { b.scale.y = Math.min(1, b.scale.y + dt * 1.2); b.material.opacity = 0.28 + Math.sin(S.time * 2) * 0.06; }
  }

  // transition between floors
  if (transition) {
    transition.t += dt;
    if (transition.t > 0.55 && !transition.built) {
      transition.built = true;
      P.heal(P.maxHp * 0.35, true); P.mana = P.maxMana;
      buildFloor(transition.next, (Math.random() * 1e9) | 0);
    }
    if (transition.t > 1.1) transition = null;
  }
  emit("fade", transition ? (transition.t < 0.55 ? transition.t / 0.55 : Math.max(0, 1 - (transition.t - 0.55) / 0.55)) : 0);

  if (!P.alive && !deathShown && P.deadT > 1.3) { deathShown = true; S.over = true; emit("deathScreen", P.killedBy); }
  if (P.alive) deathShown = false;
  pumpOffers();
}

export function inTransition() { return !!transition; }

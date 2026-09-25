/* player.js — the mage: moving, dashing, casting, being hurt, growing.
 *
 * Four spell slots, each a page from the spellbook compiled against your
 * current boons. Hold to cast: the selected page fires whenever it is off
 * cooldown and you can pay for it, so there is no clicking-per-shot and no
 * reason to ever mash. A blank page, a page drawn beyond your circle's rank
 * or an empty mana pool each say so once, in a line, and then stay quiet.
 *
 * One bar of mana instead of the first version's four elemental pools. The
 * four bars were four things to watch for one decision; the cost of a spell
 * already depends on what is drawn in it.
 *
 * The same function builds the other mages in a multiplayer match (remote:
 * true). Those are puppets: net.js moves them and they never run
 * updatePlayer, but they are real players in every other way — they carry
 * their owner's pages, compiled with their owner's boons, so a spell they
 * cast here flies exactly as it did there. */

import * as THREE from "three";
import { S, emit, players } from "./state.js";
import { scene, addShake, kick } from "./gfx.js";
import * as fx from "./fx.js";
import { buildMage } from "./models.js";
import { compileSpell, overLimits, isEmptyDesign, elementInfo, rankNeeded, emptyDesign } from "./spellcore.js";
import { hostile } from "./modes.js";
import { BOONS, BOON_BY_ID } from "./boons.js";
import { fireLayer, triggerPayloads } from "./spells.js";
import { save, SLOTS } from "./save.js";
import { drawDesign, fitScale } from "./glyphart.js";
import { damp, clamp, dist, angDiff, rand, mulberry32 } from "./util.js";

export function freshMods() {
  const m = {};
  for (const b of BOONS) m[b.stat] = 0;
  return m;
}
export const xpNeed = (lv) => Math.round(18 + lv * 12 + lv * lv * 1.2);

export function createPlayer(snap, opts) {
  snap = snap || {};
  opts = opts || {};
  const remote = !!opts.remote;
  const mesh = buildMage();
  scene.add(mesh.root);
  // Other mages carry no light of their own: every light added mid-fight
  // makes three recompile every lit shader, and eight would be eight times.
  const light = remote ? { intensity: 0, color: new THREE.Color() } : new THREE.PointLight(0xb39dff, 8, 9, 2);
  if (!remote) { light.position.set(0, 2, 0); mesh.root.add(light); }
  if (opts.robe !== undefined) tintRobe(mesh, opts.robe);
  const circleCanvas = document.createElement("canvas");
  circleCanvas.width = circleCanvas.height = 256;
  const circleTex = new THREE.CanvasTexture(circleCanvas);
  mesh.circleMat.map = circleTex;

  const P = {
    x: 0, z: 0, vx: 0, vz: 0, r: 0.45, aim: -Math.PI / 2, alive: true,
    level: snap.level || 1, xp: snap.xp || 0, boons: Object.assign({}, snap.boons || {}),
    rank: snap.rank || 1, potions: snap.potions === undefined ? 2 : snap.potions,
    hp: 100, mana: 100, mods: freshMods(), iframe: 1, hurtT: 0,
    dashT: 0, dashCd: 0, dashAng: 0, dashing: false,
    selected: 0, cd: new Array(SLOTS).fill(0), gcd: 0, compiled: [], blocked: [], empty: [],
    castT: 0, circleT: 0, revivesUsed: 0, pendingLevels: 0, echoQ: [],
    mesh, light, circleCanvas, circleTex, circleKey: "", nagT: 0, lowManaT: 0, walk: 0, deadT: 0,
    infiniteMana: false, noDeath: false, rankFloor: 1,
    isMage: true, remote, id: opts.id || 0, team: opts.team || 0, name: opts.name || "", designs: null, killedById: null
  };
  /* Whose pages this mage draws from: yours from the save, another mage's
     from what their machine sent. */
  P.designOf = (i) => (remote ? (P.designs && P.designs[i]) || emptyDesign() : save.spell(i));

  P.recompute = function () {
    const m = freshMods();
    for (const id in P.boons) { const b = BOON_BY_ID[id]; if (b) m[b.stat] += b.add * P.boons[id]; }
    P.mods = m;
    P.maxHp = 100 + m.maxHp;
    P.maxMana = 100 + m.maxMana;
    P.potionCap = 3 + m.potionCap;
    P.hp = Math.min(P.hp, P.maxHp); P.mana = Math.min(P.mana, P.maxMana);
    P.recompile();
  };
  P.spellMods = () => ({ dmg: 1 + P.mods.dmg, cost: Math.max(0.4, 1 + P.mods.cost), cd: Math.max(0.4, 1 + P.mods.cd),
    speed: 1 + P.mods.shotSpeed, range: 1 + P.mods.shotSpeed, kb: 1 + P.mods.kb, burn: 1 + P.mods.burn, chill: P.mods.chill });
  P.recompile = function () {
    const mods = P.spellMods();
    for (let i = 0; i < SLOTS; i++) {
      const d = P.designOf(i);
      const c = compileSpell(d, mods);
      P.compiled[i] = c;
      P.empty[i] = isEmptyDesign(d);
      const over = overLimits(d, P.rank, c);
      P.blocked[i] = over.length ? rankNeeded(d, c) : 0;
    }
    P.circleKey = "";
    if (!remote) emit("spellsChanged");
  };
  P.select = function (i) {
    if (i < 0 || i >= SLOTS || i === P.selected) return;
    P.selected = i;
    P.circleKey = "";
    emit("select", i);
  };

  P.hurt = function (dmg, ang, src, kb, by) {
    if (!P.alive || P.iframe > 0) return false;
    dmg *= 1 - Math.min(0.5, P.mods.armor);
    P.hp -= dmg;
    P.iframe = 0.6; P.hurtT = 0.25;
    const k = kb === undefined ? 6 : kb;
    P.vx += Math.cos(ang) * k; P.vz += Math.sin(ang) * k;
    addShake(0.35 + Math.min(0.5, dmg / 60));
    fx.number(P.x, 2, P.z, "-" + Math.round(dmg), "hurt");
    fx.burst(P.x, 1, P.z, 0xff4f6a, 10, 4, { size: 0.3 });
    emit("playerHurt", dmg, src);
    if (P.hp <= 0) {
      if (P.noDeath) { P.hp = 1; return true; }
      if (P.mods.revive > P.revivesUsed) { P.revivesUsed++; revive(); return true; }
      P.hp = 0; P.alive = false; P.deadT = 0; P.killedBy = src || "the dark"; P.killedById = by === undefined ? null : by;
      emit("playerDied", src, P.killedById);
    }
    return true;
  };
  function revive() {
    P.hp = P.maxHp * 0.5; P.iframe = 2.5;
    fx.ring(P.x, P.z, 0xffc15e, 0.5, 8, 0.7, 0.3);
    fx.burst(P.x, 1, P.z, 0xffc15e, 50, 9, { size: 0.5 });
    fx.flash(P.x, 2, P.z, 0xffc15e, 40, 0.6, 18);
    for (const e of S.enemies) {
      if (!e.alive) continue;
      const d = dist(P.x, P.z, e.x, e.z);
      if (d < 8) { const a = Math.atan2(e.z - P.z, e.x - P.x); e.kbx += Math.cos(a) * 20 * e.kbRes; e.kbz += Math.sin(a) * 20 * e.kbRes; }
    }
    addShake(1);
    emit("revive");
  }
  P.heal = function (n, quiet) {
    const before = P.hp;
    P.hp = Math.min(P.maxHp, P.hp + n);
    if (!quiet && P.hp - before >= 1) fx.number(P.x, 2.1, P.z, "+" + Math.round(P.hp - before), "heal");
  };
  P.addMana = function (n) { P.mana = Math.min(P.maxMana, P.mana + n); };
  P.gainXp = function (n) {
    P.xp += n;
    let need = xpNeed(P.level);
    while (P.xp >= need) {
      P.xp -= need; P.level++; P.pendingLevels++;
      need = xpNeed(P.level);
      emit("levelUp", P.level);
    }
  };
  P.addBoon = function (id) {
    const b = BOON_BY_ID[id];
    if (!b) return;
    P.boons[id] = (P.boons[id] || 0) + 1;
    const oldMax = P.maxHp || 100;
    P.recompute();
    if (b.stat === "maxHp") P.heal(P.maxHp - oldMax, true);
    if (b.stat === "potionCap") P.potions = Math.min(P.potionCap, P.potions + 1);
    if (b.stat === "maxMana") P.mana = P.maxMana;
  };
  P.snapshot = () => ({ level: P.level, xp: P.xp, boons: Object.assign({}, P.boons), rank: P.rank, potions: P.potions });
  P.drinkPotion = function () {
    if (!P.alive || P.potions <= 0) return false;
    if (P.hp >= P.maxHp - 0.5) { emit("toast", "Already at full health"); return false; }
    P.potions--;
    P.heal(P.maxHp * 0.4);
    fx.burst(P.x, 1.2, P.z, 0xff6f8a, 18, 3, { size: 0.35, grav: -2 });
    fx.ring(P.x, P.z, 0xff6f8a, 0.4, 2.2, 0.4);
    emit("potion");
    return true;
  };
  P.dispose = function () {
    scene.remove(mesh.root);
    circleTex.dispose();
  };
  /** Back on your feet: a respawn, a new round, a teammate's hand. */
  P.respawn = function (x, z, frac) {
    if (x !== null && x !== undefined) { P.x = x; P.z = z; }
    P.vx = P.vz = 0;
    P.alive = true; P.deadT = 0; P.killedBy = null; P.killedById = null;
    P.hp = Math.max(1, P.maxHp * (frac === undefined ? 1 : frac)); P.mana = P.maxMana;
    P.iframe = 2; P.dashT = 0; P.echoQ = [];
    mesh.body.rotation.set(0, 0, 0); mesh.body.position.y = 0;
    if (!remote) light.intensity = 8;
    fx.ring(P.x, P.z, 0xb39dff, 0.4, 3, 0.5, 0.2);
    fx.burst(P.x, 1, P.z, 0xb39dff, 20, 5, { size: 0.3, grav: -2 });
    if (!remote) emit("respawn");
  };

  P.recompute();
  P.hp = P.maxHp; P.mana = P.maxMana;
  return P;
}

/* ---------------------------------------------------------------
   Per frame
   --------------------------------------------------------------- */
export function updatePlayer(P, dt, input) {
  const W = S.world;
  P.iframe = Math.max(0, P.iframe - dt);
  P.hurtT = Math.max(0, P.hurtT - dt);
  P.gcd = Math.max(0, P.gcd - dt);
  P.nagT = Math.max(0, P.nagT - dt);
  for (let i = 0; i < P.cd.length; i++) P.cd[i] = Math.max(0, P.cd[i] - dt);
  P.dashCd = Math.max(0, P.dashCd - dt);

  if (!P.alive) { P.deadT += dt; animate(P, dt, 0); return; }

  if (input.select >= 0) P.select(input.select);
  if (input.cycle) P.select((P.selected + input.cycle + P.cd.length) % P.cd.length);

  // aim
  if (input.aimAng !== null && input.aimAng !== undefined) P.aim = input.aimAng;
  else if (input.aimX !== null && input.aimX !== undefined) P.aim = Math.atan2(input.aimZ - P.z, input.aimX - P.x);
  if (input.autoAim) { const t = autoTarget(P); if (t) P.aim = Math.atan2(t.z - P.z, t.x - P.x); }

  // move
  const spd = 6.6 * (1 + P.mods.speed);
  if (input.dash && P.dashCd <= 0) {
    const m = Math.hypot(input.mx, input.mz);
    P.dashAng = m > 0.15 ? Math.atan2(input.mz, input.mx) : P.aim;
    P.dashT = 0.18; P.dashCd = 1.1 * Math.max(0.35, 1 + P.mods.dashCd);
    P.iframe = Math.max(P.iframe, 0.3);
    emit("dash");
  }
  if (P.dashT > 0) {
    P.dashT -= dt; P.dashing = true;
    P.vx = Math.cos(P.dashAng) * 26; P.vz = Math.sin(P.dashAng) * 26;
    for (let k = 0; k < 3; k++) fx.emit(P.x + rand(-0.3, 0.3), rand(0.3, 1.6), P.z + rand(-0.3, 0.3), 0, 0, 0, 0.3, 0.45, 0.05, 0x9d8cff, 0.7, 0, 0);
    if (P.dashT <= 0) { P.vx *= 0.35; P.vz *= 0.35; }
  } else {
    P.dashing = false;
    P.vx = damp(P.vx, input.mx * spd, 14, dt);
    P.vz = damp(P.vz, input.mz * spd, 14, dt);
  }
  P.x += P.vx * dt; P.z += P.vz * dt;
  if (W) {
    W.resolve(P, P.r);
    const A = W.arena, B = S.boss;
    if (A && B && B.alive && B.state !== "sleep") {
      const d = dist(P.x, P.z, A.x, A.z), lim = A.r - P.r - 0.25;
      if (d > lim) { P.x = A.x + (P.x - A.x) / d * lim; P.z = A.z + (P.z - A.z) / d * lim; }
    }
    W.reveal(P.x, P.z, 13);
  }

  // regenerate
  if (P.infiniteMana) P.mana = P.maxMana;
  else P.mana = Math.min(P.maxMana, P.mana + 15 * (1 + P.mods.manaRegen) * dt);
  if (P.mods.regen) P.heal(P.mods.regen * dt, true);

  // cast
  if (input.cast) tryCast(P);
  for (let i = P.echoQ.length - 1; i >= 0; i--) {
    const q = P.echoQ[i]; q.t -= dt;
    if (q.t <= 0) {
      const seed = (Math.random() * 1e9) | 0;
      fireLayer(q.c, 0, P.x, P.z, P.aim, true, P, mulberry32(seed));
      emit("castAt", q.i, P.x, P.z, P.aim, seed);
      fx.ring(P.x, P.z, 0xffd97a, 0.3, 1.4, 0.3); P.echoQ.splice(i, 1); emit("echo");
    }
  }
  if (input.trigger) { const n = triggerPayloads(P); if (n) emit("trigger", n); }
  if (input.potion) P.drinkPotion();

  animate(P, dt, Math.hypot(P.vx, P.vz));
}

function nag(P, msg) {
  if (P.nagT > 0) return;
  P.nagT = 2.2;
  emit("toast", msg);
}

function tryCast(P) {
  const i = P.selected, c = P.compiled[i];
  if (P.cd[i] > 0 || P.gcd > 0) return;
  if (P.empty[i]) { nag(P, "This page is blank — draw it in the Spellbook"); return; }
  if (P.blocked[i]) { nag(P, "This page needs circle rank " + P.blocked[i]); emit("denied"); return; }
  if (c.cost > P.maxMana) { nag(P, "This page costs more mana than you have"); emit("denied"); return; }
  if (P.mana < c.cost) { P.lowManaT = 0.5; if (P.nagT <= 0) emit("noMana"); P.nagT = Math.max(P.nagT, 0.6); return; }
  P.mana -= c.cost;
  P.cd[i] = c.cooldown;
  P.gcd = 0.08;
  // One seed decides the scatter, and it travels with the cast, so every
  // mage in a room sees the same lopsided page scatter the same way.
  const seed = (Math.random() * 1e9) | 0;
  fireLayer(c, 0, P.x, P.z, P.aim, true, P, mulberry32(seed));
  emit("castAt", i, P.x, P.z, P.aim, seed);
  if (P.mods.echo && Math.random() < P.mods.echo) P.echoQ.push({ c, t: 0.14, i });
  P.castT = 0.22; P.circleT = 0.7;
  kick(P.aim, Math.min(0.35, 0.08 + c.totalShots * 0.02));
  const col = c.elements[0] ? elementInfo(c.elements[0]).hex : 0xb39dff;
  fx.burst(P.x + Math.cos(P.aim) * 0.9, 1.2, P.z + Math.sin(P.aim) * 0.9, col, 5, 3, { size: 0.25, grav: 0 });
  for (const e of c.elements) if (save.discover("elements", e)) emit("discover", "elements", e);
  for (const f of c.forms) if (save.discover("forms", f)) emit("discover", "forms", f);
  for (const r of c.reactions) if (save.discover("reactions", r)) emit("discover", "reactions", r);
  emit("cast", c);
}

function autoTarget(P) {
  let best = null, bd = 16;
  for (const e of S.enemies) {
    if (!e.alive || e.type === "geode" || (e.type === "dummy" && S.mode !== "sandbox")) continue;
    if (e.boss && e.state === "sleep") continue;
    if (e.fogHidden) continue;
    const d = dist(P.x, P.z, e.x, e.z);
    if (d < bd) { bd = d; best = e; }
  }
  if (S.match) for (const Q of players()) {
    if (!Q.alive || Q.fogHidden || !hostile(S.match.mode, P, Q)) continue;
    const d = dist(P.x, P.z, Q.x, Q.z);
    if (d < bd) { bd = d; best = Q; }
  }
  return best;
}

/* ---------------------------------------------------------------
   Looks
   --------------------------------------------------------------- */
function tintRobe(mesh, hex) {
  const c = new THREE.Color(hex);
  mesh.mats[0].color.copy(c);
  mesh.mats[1].color.copy(c).multiplyScalar(0.68);
}
export { tintRobe };

/** Pose a puppet mage where net.js put it. */
export function animateRemote(P, dt) {
  P.iframe = Math.max(0, P.iframe - dt);
  P.hurtT = Math.max(0, P.hurtT - dt);
  if (!P.alive) P.deadT += dt;
  animate(P, dt, P.alive ? Math.hypot(P.vx, P.vz) : 0);
}

const tmpC = new THREE.Color();
function animate(P, dt, speed) {
  const M = P.mesh;
  M.root.position.set(P.x, 0, P.z);
  if (!P.alive) {
    const t = Math.min(1, P.deadT / 0.8);
    M.body.rotation.x = -t * 1.35;
    M.body.position.y = -t * 0.2;
    M.circleMat.opacity = 0;
    P.light.intensity = 8 * (1 - t);
    return;
  }
  M.root.rotation.y = Math.PI / 2 - P.aim;
  P.walk += dt * speed * 1.6;
  const moving = speed > 0.5;
  // lean into movement relative to facing
  const mvA = Math.atan2(P.vz, P.vx);
  const rel = angDiff(P.aim, mvA);
  const lean = moving ? clamp(speed / 7, 0, 1) : 0;
  M.body.rotation.x = damp(M.body.rotation.x, Math.cos(rel) * 0.16 * lean + (P.dashing ? 0.35 : 0), 12, dt);
  M.body.rotation.z = damp(M.body.rotation.z, -Math.sin(rel) * 0.14 * lean, 12, dt);
  M.body.position.y = moving ? Math.abs(Math.sin(P.walk * 2.2)) * 0.07 : Math.sin(S.time * 2) * 0.02;
  M.tip.rotation.x = -0.35 + Math.sin(S.time * 2.3) * 0.05 - lean * 0.18;
  M.tip.rotation.z = Math.sin(P.walk * 1.1) * 0.08 * lean;
  // cast: thrust the staff
  P.castT = Math.max(0, P.castT - dt);
  const th = P.castT > 0 ? Math.sin((1 - P.castT / 0.22) * Math.PI) : 0;
  M.arm.rotation.x = -th * 0.9;
  M.staff.position.z = 0.3 + th * 0.2;
  M.orb.scale.setScalar(1 + th * 0.8);
  M.orbHalo.scale.setScalar(1.1 + th * 1.4);
  // hurt: flash the robe and blink through i-frames
  const hurt = P.hurtT > 0 ? P.hurtT / 0.25 : 0;
  for (const m of M.mats) { m.emissive.setHex(0xff2244); m.emissiveIntensity = hurt * 1.4; }
  M.body.visible = !(P.iframe > 0 && P.iframe < 0.55 && !P.dashing && Math.floor(S.time * 20) % 2 === 0);
  // the selected page glows on the floor while you cast
  const c = P.compiled[P.selected];
  const key = P.selected + "|" + (c ? c.name + c.cost + c.totalShots : "");
  if (key !== P.circleKey) {
    P.circleKey = key;
    const el = c && c.elements[0] ? c.elements[0] : "arcane";
    const col = elementInfo(el).color;
    const g = P.circleCanvas.getContext("2d");
    g.clearRect(0, 0, 256, 256);
    const d = P.designOf(P.selected);
    drawDesign(g, d, { cx: 128, cy: 128, scale: fitScale(d, 250), line: 2.4, mono: col, outer: true, nodes: false });
    P.circleTex.needsUpdate = true;
    tmpC.set(col);
    M.orbMat.emissive.copy(tmpC);
    M.orbHalo.material.color.copy(tmpC);
    P.light.color.copy(tmpC);
  }
  P.circleT = Math.max(0, P.circleT - dt);
  M.circleMat.opacity = Math.min(0.85, P.circleT * 1.6);
  // The page's top is its forward: turned so it points where you aim, as drawn.
  M.circle.rotation.y = Math.PI;
  M.circle.visible = M.circleMat.opacity > 0.01;
  P.light.intensity = 7 + th * 14;
}


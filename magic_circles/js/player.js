/* player.js — the mage: walking, dashing, casting, being hurt, growing.
 *
 * Shape lifted from Magic Sandbox (magic_sandbox/js/player.js): one record
 * per mage, hold to cast, a page that cannot be cast says why once and then
 * stays quiet, the selected page glowing on the ground under you as you
 * cast. What is this game's own, from the Phaser build's PlayerSprite:
 *
 *   four mana pools, one per element, each refilling at its own pace, so a
 *     page of Earth is slow to come back and a page of Air is quick
 *   vigor, which a dash spends
 *   eight scrolls instead of four, and one staff: every page shares one
 *     cooldown, set by its tier
 *   a page you can only partly pay for still goes, with what you can pay
 *     for (spellcore.js readStack's `drop`), and one you cannot pay for at
 *     all throws the grey bolt instead of nothing
 *
 * The body is a Kenney Mini Character in a felt hat with a staff, both made
 * here and hung on the rig's head and right arm, so they move with every
 * clip the character comes with. */

import * as THREE from "three";
import { S, emit } from "./state.js";
import { scene, addShake, kick, nightness } from "./gfx.js";
import * as fx from "./fx.js";
import { makeCharacter } from "./assets.js";
import { blobTexture, glowTexture } from "./textures.js";
import { compileSpell, overLimits, isEmptyDesign, elementInfo, rankNeeded, ELEMENTS, ELEMENT_IDS, glyphCost, SLOTS } from "./spellcore.js";
import { fireLayer, triggerPayloads } from "./spells.js";
import { save } from "./save.js";
import { drawDesign, fitScale } from "./glyphart.js";
import { isWater } from "./chunks.js";
import * as phys from "./physics.js";
import { damp, clamp, dist, angDiff, rand } from "./util.js";

export const xpNeed = (lv) => Math.round(30 + lv * 18 + lv * lv * 2);
export const POOL = (lv) => 100 + (lv - 1) * 6;
const SPEED = 6.2;
const DASH = { t: 0.2, speed: 22, cost: 18, cd: 0.45 };

function buildBody(look) {
  const root = new THREE.Group();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false }));
  blob.position.y = 0.02; blob.renderOrder = 1;
  root.add(blob);
  const ch = makeCharacter(look, 1.5);
  const robe = new THREE.MeshStandardMaterial({ color: 0x3b2f7a, roughness: 0.85, flatShading: true });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd8b25e, roughness: 0.4, metalness: 0.6, flatShading: true });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.9, flatShading: true });
  const orbMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xb8a6ff, emissiveIntensity: 3, roughness: 0.4 });
  const add = (parent, geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  // the hat: brim, band, and a crown in three frusta, each tipped back so it droops like felt
  const hat = new THREE.Group();
  add(hat, new THREE.CylinderGeometry(0.44, 0.44, 0.04, 14), robe, 0, 0, 0);
  add(hat, new THREE.CylinderGeometry(0.25, 0.27, 0.07, 12), brass, 0, 0.05, 0);
  add(hat, new THREE.CylinderGeometry(0.16, 0.26, 0.3, 12), robe, 0, 0.22, 0);
  const tip = new THREE.Group(); tip.position.set(0, 0.37, -0.02); tip.rotation.x = -0.4; hat.add(tip);
  add(tip, new THREE.CylinderGeometry(0.07, 0.16, 0.26, 10), robe, 0, 0.12, 0);
  const tip2 = new THREE.Group(); tip2.position.set(0, 0.25, 0); tip2.rotation.x = -0.6; tip.add(tip2);
  add(tip2, new THREE.ConeGeometry(0.07, 0.24, 10), robe, 0, 0.11, 0);
  add(tip2, new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xffd97a, emissiveIntensity: 2.5 }), 0, 0.24, 0);
  // the staff, with the selected page's colour in its orb
  const staff = new THREE.Group();
  add(staff, new THREE.CylinderGeometry(0.03, 0.04, 1.45, 6), wood, 0, 0.35, 0);
  const crown = add(staff, new THREE.TorusGeometry(0.1, 0.02, 5, 12), brass, 0, 1.08, 0);
  crown.rotation.y = Math.PI / 2;
  const orb = add(staff, new THREE.IcosahedronGeometry(0.085, 1), orbMat, 0, 1.08, 0);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xb8a6ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }));
  halo.scale.setScalar(0.8); halo.position.y = 1.08; staff.add(halo);

  let body;
  if (ch) {
    root.add(ch.root);
    body = ch.root;
    const s = ch.model.scale.x;
    // the rig's head node sits at the neck; the head mesh tops out ~0.5 model units above it
    if (ch.nodes.head) { hat.scale.setScalar(1 / s * 1.05); hat.position.set(0, 0.47, 0); ch.nodes.head.add(hat); }
    if (ch.nodes["arm-right"]) { staff.scale.setScalar(1 / s); staff.position.set(-0.06, -0.12, 0.04); staff.rotation.x = 0.15; ch.nodes["arm-right"].add(staff); }
    ch.play("idle");
  } else {
    // a model that failed to load must never stop the game: a robe of primitives stands in
    body = new THREE.Group(); root.add(body);
    add(body, new THREE.CylinderGeometry(0.22, 0.5, 1.0, 8), robe, 0, 0.5, 0);
    add(body, new THREE.IcosahedronGeometry(0.2, 1), new THREE.MeshStandardMaterial({ color: 0xe8c39e }), 0, 1.15, 0);
    hat.position.set(0, 1.3, 0); body.add(hat);
    staff.position.set(0.32, 0.2, 0.15); body.add(staff);
  }
  // the page you cast, glowing on the ground
  const circleCanvas = document.createElement("canvas");
  circleCanvas.width = circleCanvas.height = 256;
  const circleTex = new THREE.CanvasTexture(circleCanvas);
  const circleMat = new THREE.MeshBasicMaterial({ map: circleTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const circle = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8).rotateX(-Math.PI / 2), circleMat);
  circle.position.y = 0.05; circle.renderOrder = 4;
  root.add(circle);
  return { root, body, ch, hat, tip, staff, orb, orbMat, halo, circle, circleMat, circleCanvas, circleTex };
}

export function createPlayer(J) {
  const M = buildBody(J.look);
  scene.add(M.root);
  const light = new THREE.PointLight(0xffd9a0, 0, 11, 1.6);
  light.position.set(0, 2.2, 0);
  M.root.add(light);

  const P = {
    x: J.x, z: J.z, vx: 0, vz: 0, r: 0.42, mass: 80, aim: Math.PI / 2, alive: true,
    level: J.level, xp: J.xp, rank: J.rank, potions: J.potions,
    hp: 120, maxHp: 120, vigor: 100, maxVigor: 100,
    mana: { air: 100, fire: 100, earth: 100, water: 100 }, maxMana: 100,
    iframe: 1, hurtT: 0, dashT: 0, dashCd: 0, dashAng: 0, dashing: false, wading: false,
    selected: 0, castCd: 0, compiled: [], status: [], blocked: [], empty: [],
    castT: 0, circleT: 0, nagT: 0, walk: 0, deadT: 0, slowT: 0, burnT: 0,
    mesh: M, light, circleKey: "", anim: "idle", isMage: true
  };

  P.recompute = function () {
    // what you have grown into: each level 6% more spell damage, each Sigil 12%
    P.dmgMult = 1 + 0.06 * (P.level - 1) + 0.12 * (P.rank - 1);
    P.maxHp = 120 + (P.level - 1) * 8;
    P.maxMana = POOL(P.level);
    P.hp = Math.min(P.hp, P.maxHp);
    for (const e of ELEMENT_IDS) P.mana[e] = Math.min(P.mana[e], P.maxMana);
    P.recompile();
  };
  P.recompile = function () {
    for (let i = 0; i < SLOTS; i++) {
      const d = save.spell(i);
      const c = compileSpell(d);
      P.compiled[i] = c;
      P.empty[i] = isEmptyDesign(d);
      P.blocked[i] = overLimits(d, P.rank, c).length ? rankNeeded(d, c) : 0;
    }
    P.circleKey = "";
    emit("spellsChanged");
  };
  /** ready: every glyph paid for; partial: some; fallback: the grey bolt. */
  P.castStatus = function (i) {
    const c = P.compiled[i];
    if (!c || P.empty[i] || c.fallback) return "fallback";
    let can = 0, need = 0;
    for (const e of ELEMENT_IDS) if (c.cost[e] > 0) { need++; if (P.mana[e] >= c.cost[e]) can++; }
    if (!need || can === need) return "ready";
    return can ? "partial" : "fallback";
  };
  P.select = function (i) {
    if (i < 0 || i >= SLOTS || i === P.selected) return;
    P.selected = i; P.circleKey = "";
    emit("select", i);
  };
  P.hurt = function (dmg, ang, src, kb) {
    if (!P.alive || P.iframe > 0) return false;
    P.hp -= dmg;
    P.iframe = 0.55; P.hurtT = 0.25;
    const k = kb === undefined ? 6 : kb;
    P.vx += Math.cos(ang) * k; P.vz += Math.sin(ang) * k;
    addShake(0.3 + Math.min(0.5, dmg / 60));
    fx.number(P.x, 2, P.z, "-" + Math.round(dmg), "hurt");
    fx.burst(P.x, 1, P.z, 0xff4f6a, 10, 4, { size: 0.3 });
    emit("playerHurt", dmg, src);
    if (P.hp <= 0) {
      P.hp = 0; P.alive = false; P.deadT = 0; P.killedBy = src || "the wilds";
      if (M.ch) M.ch.play("die", 0.1, true);
      emit("playerDied", P.killedBy);
    }
    return true;
  };
  P.heal = function (n, quiet) {
    const before = P.hp;
    P.hp = Math.min(P.maxHp, P.hp + n);
    if (!quiet && P.hp - before >= 1) fx.number(P.x, 2.1, P.z, "+" + Math.round(P.hp - before), "heal");
  };
  P.addMana = function (el, n) {
    if (el === "all") { for (const e of ELEMENT_IDS) P.mana[e] = Math.min(P.maxMana, P.mana[e] + n); return; }
    P.mana[el] = Math.min(P.maxMana, P.mana[el] + n);
  };
  P.gainXp = function (n) {
    P.xp += n;
    let need = xpNeed(P.level);
    while (P.xp >= need) {
      P.xp -= need; P.level++;
      need = xpNeed(P.level);
      P.recompute();
      P.hp = P.maxHp;
      emit("levelUp", P.level);
    }
  };
  P.drinkPotion = function () {
    if (!P.alive || P.potions <= 0) return false;
    if (P.hp >= P.maxHp - 0.5) { emit("toast", "Already at full health"); return false; }
    P.potions--;
    P.heal(P.maxHp * 0.45);
    fx.burst(P.x, 1.2, P.z, 0xff6f8a, 18, 3, { size: 0.35, grav: -2 });
    fx.ring(P.x, P.z, 0xff6f8a, 0.4, 2.2, 0.4);
    emit("potion");
    return true;
  };
  P.respawn = function (x, z) {
    P.x = x; P.z = z; P.vx = P.vz = 0;
    P.alive = true; P.deadT = 0; P.killedBy = null;
    P.hp = P.maxHp; P.vigor = P.maxVigor;
    for (const e of ELEMENT_IDS) P.mana[e] = P.maxMana;
    P.iframe = 2; P.dashT = 0; P.slowT = 0; P.burnT = 0;
    if (M.ch) { M.ch.play("idle", 0); P.anim = "idle"; }
    fx.ring(P.x, P.z, 0x8fd8ff, 0.4, 3, 0.5, 0.2);
    fx.burst(P.x, 1, P.z, 0x8fd8ff, 24, 5, { size: 0.3, grav: -2 });
    emit("respawn");
  };
  P.dispose = function () {
    scene.remove(M.root);
    if (M.ch) M.ch.dispose();
    M.circleTex.dispose();
  };
  P.recompute();
  P.hp = J.hp ? Math.min(P.maxHp, J.hp) : P.maxHp;
  return P;
}

/* ---------------------------------------------------------------
   Per frame
   --------------------------------------------------------------- */
export function updatePlayer(P, dt, input) {
  P.iframe = Math.max(0, P.iframe - dt);
  P.hurtT = Math.max(0, P.hurtT - dt);
  P.nagT = Math.max(0, P.nagT - dt);
  P.castCd = Math.max(0, P.castCd - dt);
  P.dashCd = Math.max(0, P.dashCd - dt);
  P.slowT = Math.max(0, P.slowT - dt);
  if (!P.alive) { P.deadT += dt; animate(P, dt, 0); return; }

  if (input.select >= 0) P.select(input.select);
  if (input.cycle) P.select((P.selected + input.cycle + SLOTS) % SLOTS);

  // aim
  if (input.aimAng !== null && input.aimAng !== undefined) P.aim = input.aimAng;
  else if (input.aimX !== null && input.aimX !== undefined) P.aim = Math.atan2(input.aimZ - P.z, input.aimX - P.x);
  if (input.autoAim) { const t = autoTarget(P); if (t) P.aim = Math.atan2(t.z - P.z, t.x - P.x); }

  // move: water and a Water spell both slow you, as they slow everything
  P.wading = isWater(P.x, P.z);
  const spd = SPEED * (P.wading ? 0.62 : 1) * (P.slowT > 0 ? 0.55 : 1);
  if (input.dash && P.dashCd <= 0 && P.vigor >= DASH.cost) {
    const m = Math.hypot(input.mx, input.mz);
    P.dashAng = m > 0.15 ? Math.atan2(input.mz, input.mx) : P.aim;
    P.dashT = DASH.t; P.dashCd = DASH.cd; P.vigor -= DASH.cost;
    P.iframe = Math.max(P.iframe, 0.3);
    emit("dash");
  } else if (input.dash && P.vigor < DASH.cost && P.nagT <= 0) { P.nagT = 1.2; emit("toast", "Out of vigor"); }
  if (P.dashT > 0) {
    P.dashT -= dt; P.dashing = true;
    P.vx = Math.cos(P.dashAng) * DASH.speed; P.vz = Math.sin(P.dashAng) * DASH.speed;
    for (let k = 0; k < 3; k++) fx.emit(P.x + rand(-0.3, 0.3), rand(0.3, 1.4), P.z + rand(-0.3, 0.3), 0, 0, 0, 0.3, 0.45, 0.05, 0xb8a6ff, 0.7, 0, 0);
    if (P.dashT <= 0) { P.vx *= 0.35; P.vz *= 0.35; }
  } else {
    P.dashing = false;
    P.vx = damp(P.vx, input.mx * spd, 14, dt);
    P.vz = damp(P.vz, input.mz * spd, 14, dt);
  }
  const ox = P.x, oz = P.z;
  P.x += P.vx * dt; P.z += P.vz * dt;
  phys.resolve(P);
  if (!isFinite(P.x) || !isFinite(P.z)) { P.x = ox; P.z = oz; P.vx = P.vz = 0; }

  // regenerate: vigor quickly, each element at its own pace, a little faster as you grow
  P.vigor = Math.min(P.maxVigor, P.vigor + (P.dashing ? 4 : 24) * dt);
  const lvl = 1 + (P.level - 1) * 0.04;
  for (const e of ELEMENT_IDS) P.mana[e] = Math.min(P.maxMana, P.mana[e] + ELEMENTS[e].regen * lvl * dt);

  if (input.cast) tryCast(P);
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
  const i = P.selected;
  if (P.castCd > 0) return;
  if (P.blocked[i]) { nag(P, "This scroll needs circle rank " + P.blocked[i]); emit("denied"); return; }
  const d = save.spell(i);
  // what you cannot pay for is left out of the stack, as the old game did
  const full = glyphCost(d), drop = new Set();
  const c0 = P.compiled[i];
  for (const e of ELEMENT_IDS) if (full[e] > 0 && P.mana[e] < c0.cost[e]) drop.add(e);
  const c = drop.size ? compileSpell(d, { drop }) : c0;
  for (const e of ELEMENT_IDS) P.mana[e] -= c.cost[e];
  P.castCd = c.cooldown;
  if (drop.size && !c.fallback) nag(P, "Not enough " + [...drop].map((e) => ELEMENTS[e].name).join(" or ") + " — cast without it");
  else if (c.fallback && !P.empty[i]) nag(P, "No mana for this scroll — base magic instead");
  fireLayer(c, 0, P.x, P.z, P.aim, P);
  P.castT = 0.3; P.circleT = 0.8;
  kick(P.aim, Math.min(0.35, 0.08 + c.totalShots * 0.02));
  const col = c.elements[0] ? elementInfo(c.elements[0]).hex : 0xb8a6ff;
  fx.burst(P.x + Math.cos(P.aim) * 0.9, 1.2, P.z + Math.sin(P.aim) * 0.9, col, 5 + Math.min(10, c.totalShots), 3, { size: 0.25, grav: 0 });
  if (c.tierIndex >= 5) { fx.flash(P.x, 2, P.z, col, 18, 0.25, 12); addShake(0.2); }
  emit("cast", c);
}

function autoTarget(P) {
  let best = null, bd = 18;
  for (const e of S.enemies) {
    if (!e.alive || e.dormant) continue;
    const d = dist(P.x, P.z, e.x, e.z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

/* ---------------------------------------------------------------
   Looks
   --------------------------------------------------------------- */
const tmpC = new THREE.Color();
function animate(P, dt, speed) {
  const M = P.mesh;
  const sink = P.wading ? -0.3 : 0;
  M.root.position.set(P.x, sink, P.z);
  M.root.rotation.y = Math.PI / 2 - P.aim;
  // the lantern in the staff: off at noon, warm in the dark
  P.light.intensity = damp(P.light.intensity, 2 + nightness() * 26 + (P.castT > 0 ? 10 : 0), 6, dt);
  if (M.ch) {
    M.ch.update(dt);
    let want = !P.alive ? "die" : P.dashing ? "sprint" : P.castT > 0 ? "holding-right-shoot" : speed > 0.6 ? "walk" : "holding-right";
    if (want !== P.anim && P.alive) { M.ch.play(want, 0.12); P.anim = want; }
    if (P.anim === "walk") M.ch.setSpeed(clamp(speed / 4.5, 0.6, 1.6));
  } else {
    P.walk += dt * speed * 1.6;
    M.body.position.y = speed > 0.5 ? Math.abs(Math.sin(P.walk * 2.2)) * 0.07 : 0;
  }
  if (!P.alive) { M.circleMat.opacity = 0; return; }
  M.tip.rotation.z = Math.sin(S.time * 2.1) * 0.06;
  P.castT = Math.max(0, P.castT - dt);
  const th = P.castT > 0 ? Math.sin((1 - P.castT / 0.3) * Math.PI) : 0;
  M.orb.scale.setScalar(1 + th * 0.9);
  M.halo.scale.setScalar(0.8 + th * 1.4);
  // blink through i-frames
  M.body.visible = !(P.iframe > 0 && P.iframe < 0.5 && !P.dashing && Math.floor(S.time * 20) % 2 === 0);
  const c = P.compiled[P.selected];
  const key = P.selected + "|" + (c ? c.name + c.costTotal + c.totalShots : "");
  if (key !== P.circleKey) {
    P.circleKey = key;
    const col = elementInfo(c && c.elements[0] ? c.elements[0] : "arcane").color;
    const g = M.circleCanvas.getContext("2d");
    g.clearRect(0, 0, 256, 256);
    const d = save.spell(P.selected);
    drawDesign(g, d, { cx: 128, cy: 128, scale: fitScale(d, 250), line: 2.4, mono: col, outer: true, nodes: false });
    M.circleTex.needsUpdate = true;
    tmpC.set(col);
    M.orbMat.emissive.copy(tmpC);
    M.halo.material.color.copy(tmpC);
  }
  P.circleT = Math.max(0, P.circleT - dt);
  M.circleMat.opacity = Math.min(0.85, P.circleT * 1.6);
  M.circle.rotation.y = Math.PI;
  M.circle.visible = M.circleMat.opacity > 0.01;
}

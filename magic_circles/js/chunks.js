/* chunks.js — the world near you, built as you walk and taken down behind.
 *
 * The shape is the Phaser build's ChunkManager.update(): load what is within
 * a radius of you, unload what has fallen outside a larger one, and skip the
 * sweep entirely while you stay in one chunk. What a chunk becomes is new:
 *
 *   its ground, roads, floors and water   terrain.js
 *   its objects                           Kenney models chosen by kind and
 *                                         biome, through assets.js's pools,
 *                                         each with a collider (physics.js)
 *   its decor                             terrain.js's scatter
 *   a waystone, a chest, a great tower    when world.js says it holds one
 *   its creatures                         handed to enemies.js
 *
 * Building is spread over frames (two chunks a frame at most, nearest
 * first) so walking never hitches; the first ring round you is built at
 * once, behind the loading curtain.
 *
 * What you change stays changed while you are near and for the rest of the
 * session: a crate you smash is still smashed when you come back, a rock you
 * pushed is where you pushed it. (Not across a reload: the world is the seed,
 * and only what matters — waystones, Wardens, chests — is saved.) */

import * as THREE from "three";
import { S, emit } from "./state.js";
import { scene } from "./gfx.js";
import { CHUNK, CELL, GRID, KINDS, key, rnd } from "./world.js";
import { buildChunkGround, scatterDecor } from "./terrain.js";
import { place, size, single, has } from "./assets.js";
import * as phys from "./physics.js";
import { glowTexture } from "./textures.js";
import * as fx from "./fx.js";

export const LOAD_R = 3;      // chunks round you that are built
const UNLOAD_R = 4;
const live = new Map();
const queue = [];
let lastCx = null, lastCz = null;
const broken = new Set();     // "chunkKey:id" of objects destroyed this session
const movedTo = new Map();    // "chunkKey:id" → [x, z] of objects pushed this session
const flashing = new Set();
export const interactables = []; // waystones and chests in reach of being used

/* ---------------------------------------------------------------
   Which model a kind of thing is, in which land
   --------------------------------------------------------------- */
const TREES = {
  Plains: [["nature/tree_default", 3.6], ["nature/tree_small", 2.6], ["nature/tree_simple", 3.4], ["nature/plant_bushLarge", 1.4]],
  Clearing: [["nature/tree_default", 3.6], ["nature/tree_small", 2.6]],
  Forest: [["nature/tree_oak", 4.2], ["nature/tree_detailed", 4.6], ["nature/tree_fat", 4.2], ["nature/tree_tall", 5.2], ["nature/tree_pineDefaultA", 5], ["nature/tree_default", 4.4]],
  Rocky: [["nature/tree_pineRoundA", 4], ["nature/tree_pineRoundC", 4.4], ["nature/tree_pineTallA", 5.4], ["nature/tree_pineDefaultB", 4.6]],
  Cave: [["nature/tree_pineRoundA", 3.6], ["nature/tree_pineTallA", 4.6]],
  Swamp: [["nature/tree_default_dark", 4], ["nature/tree_oak_dark", 4], ["nature/tree_thin_dark", 4.6]],
  Desert: [["nature/cactus_tall", 2.4], ["nature/tree_palmTall", 5], ["nature/tree_palmBend", 4.4], ["nature/cactus_short", 1.4]],
  Graveyard: [["grave/pine-crooked", 4.2], ["grave/pine-fall-crooked", 4.2], ["nature/tree_thin_dark", 4.2]],
  Ruins: [["nature/tree_default_fall", 4], ["nature/tree_oak_fall", 4], ["nature/tree_plateau", 4.2]],
  Village: [["town/tree-high-round", 4.4], ["nature/tree_default", 3.8], ["nature/tree_oak", 3.8]],
  Camp: [["nature/tree_pineDefaultA", 4.6], ["nature/tree_default_fall", 3.8]],
  Lake: [["nature/tree_default", 3.8], ["nature/tree_plateau", 4], ["nature/tree_small", 2.8]]
};
const ROCKS_GREY = ["nature/stone_largeA", "nature/stone_largeB", "nature/stone_largeC"];
const ROCKS = ["nature/rock_largeA", "nature/rock_largeB", "nature/rock_largeC", "nature/rock_largeD", "nature/rock_largeE", "nature/rock_largeF"];
const CLIFFS = ["nature/rock_tallA", "nature/rock_tallB", "nature/rock_tallC", "nature/rock_tallD", "nature/rock_tallE"];
const CLIFFS_GREY = ["nature/stone_tallA", "nature/stone_tallB", "nature/stone_tallC"];
const pickOf = (list, v) => list[Math.min(list.length - 1, Math.floor(v * list.length))];
const GREY = { Cave: 1, Ruins: 1, Graveyard: 1 };

function wallStyle(C) {
  const st = C.structure;
  if (st && (st.type === "fortress" || st.type === "mage_tower")) return { key: "castle/wall", along: "x", h: 2.3 };
  if (st && (st.type === "central_plaza" || st.type === "grand_bridge")) return { key: "town/wall", along: "z", h: 2.2, broken: "town/wall-broken" };
  if (C.biome === "Village" || C.biome === "Camp" || (st && (st.type === "long_market" || st.type === "village_corner"))) return { key: "town/wall-wood", along: "z", h: 2.1, broken: "town/wall-wood-broken" };
  return { key: "grave/stone-wall", along: "x", h: 1.5, broken: "grave/stone-wall-damaged" };
}

/** Place a wall model stretched to `len` metres along the rotation's x axis. */
function placeWall(st, x, z, rot, len, v) {
  const k = st.broken && v < 0.3 && has(st.broken) ? st.broken : st.key;
  const sz = size(k);
  const along = st.along === "x" ? sz[0] : sz[2];
  const s = st.h / Math.max(0.01, sz[1]);
  const stretch = len / Math.max(0.01, along * s);
  const r = st.along === "x" ? rot : rot + Math.PI / 2;
  return place(k, x, z, r, { s }, 0, st.along === "x" ? [stretch, 1, 1.4] : [1.4, 1, stretch]);
}

function visualFor(C, o) {
  const b = C.biome;
  switch (o.kind) {
    case "tree": { const [k, h] = pickOf(TREES[b] || TREES.Plains, o.v); return place(k, o.x, o.z, o.rot, { h: h * o.s }); }
    case "rock": {
      if (b === "Desert") return place(pickOf(["survival/rock-sand-a", "survival/rock-sand-b", "survival/rock-sand-c"], o.v), o.x, o.z, o.rot, { w: 1.5 * o.s });
      return place(pickOf(GREY[b] ? ROCKS_GREY : ROCKS, o.v), o.x, o.z, o.rot, { w: 1.6 * o.s });
    }
    case "cliff": {
      // inside a structure a cliff is its outer wall of rock: grey, and a little lower
      const grey = GREY[b] || !!C.structure;
      return place(pickOf(grey ? CLIFFS_GREY : CLIFFS, o.v), o.x, o.z, Math.floor(o.v * 4) * Math.PI / 2, { w: 2.4 }, 0, [1, (grey ? 0.55 : 0.75) + o.s * 0.3, 1]);
    }
    case "wall": return placeWall(wallStyle(C), o.x, o.z, o.rot, Math.abs(Math.sin(o.rot * 2)) > 0.5 ? CELL * 1.45 : CELL * 1.04, o.v);
    case "crate": return place(o.v < 0.3 ? "survival/box-large" : "survival/box", o.x, o.z, o.rot, { w: 1.0 });
    case "barrel": return place("survival/barrel", o.x, o.z, o.rot, { h: 1.1 });
    case "stairs": return place(C.structure ? "castle/stairs-stone" : "town/stairs-stone", o.x, o.z, Math.round(o.v * 4) * Math.PI / 2, { w: 1.9 });
  }
  return null;
}

/* ---------------------------------------------------------------
   Dressing: what each structure has lying about, so a market is a market.
   [model, how many across the whole structure, height, blocks the way]
   --------------------------------------------------------------- */
const DRESS = {
  long_market: [["town/stall-red", 2, 2.4, 1], ["town/stall-green", 2, 2.4, 1], ["town/stall-bench", 3, 0.9, 0], ["town/cart", 1, 1.6, 1], ["town/banner-red", 1, 2.6, 1], ["town/lantern", 2, 2.2, 1]],
  village_corner: [["town/hedge", 3, 1.1, 1], ["town/cart", 1, 1.6, 1], ["nature/pot_large", 2, 0.8, 1], ["town/lantern", 1, 2.2, 1]],
  central_plaza: [["town/pillar-stone", 4, 2.6, 1], ["town/banner-red", 2, 2.6, 1], ["town/banner-green", 2, 2.6, 1], ["town/lantern", 3, 2.2, 1], ["town/stall-bench", 3, 0.9, 0]],
  fortress: [["castle/flag", 3, 2.4, 1], ["survival/barrel", 3, 1.0, 1], ["grave/fire-basket", 2, 1.1, 1]],
  mage_tower: [["nature/statue_ring", 1, 2.2, 1], ["nature/statue_column", 3, 2.6, 1], ["grave/pillar-obelisk", 2, 2.4, 1], ["grave/candle-multiple", 3, 0.5, 0]],
  u_courtyard: [["grave/crypt", 1, 2.8, 1], ["grave/coffin", 2, 0.8, 0], ["grave/gravestone-bevel", 3, 0.9, 1], ["grave/iron-fence", 3, 1.3, 1], ["grave/lightpost-single", 2, 2.4, 1], ["grave/stone-wall-column", 2, 1.6, 1]],
  huge_grove: [["nature/plant_bushDetailed", 5, 1.0, 0], ["nature/tent_detailedOpen", 1, 2.2, 1], ["nature/campfire_stones", 1, 1.1, 0]],
  big_lake: [["nature/sign", 1, 1.2, 1], ["nature/fence_simple", 4, 0.9, 1], ["nature/log", 1, 1.2, 1]],
  grand_bridge: [["town/lantern", 3, 2.2, 1], ["town/banner-green", 2, 2.6, 1]],
  camp: [["survival/tent", 1, 2.0, 1], ["survival/fence-fortified", 3, 1.2, 1], ["nature/campfire_stones", 1, 1.1, 0]],
  ruins: [["grave/debris", 2, 0.6, 0]]
};
function dress(L, C, occupied) {
  const S0 = C.structure;
  const list = S0 ? DRESS[S0.type] : C.biome === "Camp" ? DRESS.camp : C.biome === "Ruins" ? DRESS.ruins : null;
  if (!list) return;
  const seed = S.world.seed;
  const parts = S0 ? S0.w * S0.h : 1;
  let salt = 900;
  for (const [k, total, h, solid] of list) {
    for (let n = 0; n < total; n++, salt++) {
      // each piece belongs to one chunk of the structure, chosen by the structure's own seed
      if (S0) {
        const pick = Math.floor(rnd(seed, S0.ax * 31 + n, S0.az * 17 + salt, 91) * parts);
        if (S0.ax + (pick % S0.w) !== C.cx || S0.az + Math.floor(pick / S0.w) !== C.cz) continue;
      }
      for (let tries = 0; tries < 6; tries++) {
        const i = Math.floor(rnd(seed, C.cx * 64 + n * 7 + tries, C.cz + salt, 92) * GRID * GRID);
        if (occupied[i] || C.water[i] || C.roadCells.has(i)) continue;
        const x = C.x0 + (i % GRID) * CELL + CELL / 2, z = C.z0 + Math.floor(i / GRID) * CELL + CELL / 2;
        if (S0 && S0.great && Math.hypot(x - S0.x, z - S0.z) < 6) continue;
        const p = place(k, x, z, Math.floor(rnd(seed, i, salt, 93) * 4) * Math.PI / 2, { h });
        if (!p) break;
        L.decor.push({ handle: p, key: k, x, z, r: 0 });   // its collider is added here, not by the decor pass
        if (solid) phys.addCollider(C.key, { x, z, r: 0.5, solid: true, immortal: true, kind: "decor" });
        occupied[i] = 1;
        break;
      }
    }
  }
}

/* ---------------------------------------------------------------
   The waystone's circle: a magic circle on the ground, drawn once
   --------------------------------------------------------------- */
let circleTex = null;
function circleTexture() {
  if (circleTex) return circleTex;
  const n = 256, c = document.createElement("canvas"); c.width = c.height = n;
  const g = c.getContext("2d");
  g.translate(n / 2, n / 2); g.strokeStyle = "#fff"; g.lineCap = "round";
  g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 118, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, 104, 0, Math.PI * 2); g.stroke();
  const poly = (n2, r, rot) => { g.beginPath(); for (let i = 0; i <= n2; i++) { const a = rot + i / n2 * Math.PI * 2; i ? g.lineTo(Math.cos(a) * r, Math.sin(a) * r) : g.moveTo(Math.cos(a) * r, Math.sin(a) * r); } g.stroke(); };
  g.lineWidth = 3; poly(3, 100, -Math.PI / 2); poly(3, 100, Math.PI / 2); poly(6, 56, 0);
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.beginPath(); g.arc(Math.cos(a) * 111, Math.sin(a) * 111, 3.5, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill(); }
  circleTex = new THREE.CanvasTexture(c);
  return circleTex;
}
const circleGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

function buildWaystone(L, W) {
  const g = new THREE.Group();
  g.position.set(W.x, 0, W.z);
  const mat = new THREE.MeshBasicMaterial({ map: circleTexture(), color: 0x8fd8ff, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(circleGeo, mat);
  ring.scale.setScalar(5.2); ring.position.y = 0.04; ring.renderOrder = 3;
  g.add(ring);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x8fd8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }));
  glow.position.y = 2.6; glow.scale.setScalar(2.6);
  g.add(glow);
  scene.add(g);
  const stone = place("nature/statue_obelisk", W.x, W.z, 0.3, { h: 2.8 });
  // a signpost by every waystone, and a lamp where people live
  const sign = place("survival/signpost", W.x + 2.9, W.z - 1.2, -0.4, { h: 1.7 });
  const lamp = /Village|Graveyard|Camp/.test(L.C.biome) ? place("grave/lightpost-single", W.x - 2.9, W.z - 1.2, 0, { h: 2.6 }) : null;
  const col = phys.addCollider(L.key, { x: W.x, z: W.z, r: 0.55, solid: true, immortal: true, owner: null, kind: "waystone" });
  const it = { type: "waystone", id: W.id, x: W.x, z: W.z, r: 3.2, group: g, ring, mat, glow, stone, sign, lamp, collider: col };
  L.extras.push(it);
  interactables.push(it);
  emit("waystoneLoaded", it);
}

function buildChest(L, Ch) {
  const handle = place("survival/chest", Ch.x, Ch.z, 0, { w: 1.1 });
  const col = phys.addCollider(L.key, { x: Ch.x, z: Ch.z, r: 0.5, solid: true, immortal: true, owner: null, kind: "chest" });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffd97a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
  glow.position.set(Ch.x, 0.8, Ch.z); glow.scale.setScalar(1.8);
  scene.add(glow);
  const it = { type: "chest", id: Ch.id, x: Ch.x, z: Ch.z, r: 1.8, handle, collider: col, glow };
  L.extras.push(it);
  interactables.push(it);
  emit("chestLoaded", it);
}

/* The great structures' centrepieces: a tower to see from far off, and the Warden's ground. */
function buildCentrepiece(L, cp) {
  const parts = [];
  const add = (k, y, h, w, rot) => { const p = place(k, cp.x, cp.z, rot || 0, w ? { w } : { h }, y); if (p) parts.push(p); return p; };
  let r = 2;
  if (cp.type === "fortress") {
    let y = 0;
    for (const [k, h] of [["castle/tower-square-base", 2.2], ["castle/tower-square-mid", 2.2], ["castle/tower-square-mid", 2.2], ["castle/tower-square-top-roof-high", 3.4]]) { add(k, y, h); y += h; }
    r = 2.1;
  } else if (cp.type === "mage_tower") {
    let y = 0;
    for (const [k, h] of [["castle/tower-hexagon-base", 2.6], ["castle/tower-hexagon-mid", 2.6], ["castle/tower-hexagon-mid", 2.6], ["castle/tower-hexagon-top", 1.4], ["castle/tower-hexagon-roof", 2.8]]) { add(k, y, h); y += h; }
    r = 2.2;
  } else if (cp.type === "central_plaza") {
    add("town/fountain-round", 0, 0, 4.4);
    r = 2.2;
  } else {
    add("grave/altar-stone", 0, 0, 2.6);
    for (const s of [-1, 1]) { const p = place("grave/pillar-large", cp.x + s * 2.6, cp.z - 1, 0, { h: 3 }); if (p) parts.push(p); phys.addCollider(L.key, { x: cp.x + s * 2.6, z: cp.z - 1, r: 0.45, solid: true, immortal: true }); }
    r = 1.3;
  }
  phys.addCollider(L.key, { x: cp.x, z: cp.z, r, solid: true, immortal: true, kind: "centre" });
  L.extras.push({ type: "centre", parts });
}

/* ---------------------------------------------------------------
   Loading and unloading
   --------------------------------------------------------------- */
let hooks = { spawnPack: null, despawnChunk: null };
export function setHooks(h) { hooks = Object.assign(hooks, h); }

function buildChunk(cx, cz) {
  const C = S.world.chunk(cx, cz);
  const L = { key: C.key, C, ground: null, objects: [], decor: [], extras: [] };
  L.ground = buildChunkGround(S.world, C);
  scene.add(L.ground);
  const occupied = new Uint8Array(GRID * GRID);
  for (const o of C.objects) {
    const id = C.key + ":" + o.id;
    if (broken.has(id)) continue;
    const K = KINDS[o.kind];
    const mv = movedTo.get(id);
    const x = mv ? mv[0] : o.x, z = mv ? mv[1] : o.z;
    const handle = visualFor(C, Object.assign({}, o, { x, z }));
    const obj = { id, kind: o.kind, def: o, handle, hp: K.hp, maxHp: K.hp, immortal: K.immortal, flash: 0 };
    if (K.solid) {
      const c = o.kind === "wall"
        ? { x, z, hx: (Math.abs(Math.sin(o.rot * 2)) > 0.5 ? CELL * 1.45 : CELL * 1.04) / 2, hz: KINDS.wall.box[1], rot: o.rot }
        : { x, z, r: o.kind === "cliff" ? 1.2 : o.kind === "tree" ? 0.45 * o.s : K.r * (o.kind === "rock" ? o.s : 1) };
      Object.assign(c, { solid: true, moveable: K.moveable, mass: K.mass, immortal: K.immortal, owner: obj, kind: o.kind, low: o.kind === "crate" || o.kind === "barrel" });
      obj.collider = phys.addCollider(C.key, c);
    }
    L.objects.push(obj);
    occupied[o.id] = 1;
  }
  L.decor = scatterDecor(S.world, C, occupied);
  dress(L, C, occupied);
  for (const d of L.decor) if (d.r) phys.addCollider(C.key, { x: d.x, z: d.z, r: d.r, solid: true, immortal: true, kind: "decor" });
  if (C.waystone) buildWaystone(L, C.waystone);
  if (C.chest) buildChest(L, C.chest);
  if (C.centrepiece) buildCentrepiece(L, C.centrepiece);
  live.set(C.key, L);
  if (hooks.spawnPack) hooks.spawnPack(C);
  emit("chunkLoaded", C);
  return L;
}

function unloadChunk(L) {
  scene.remove(L.ground);
  L.ground.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  for (const o of L.objects) {
    if (o.handle) o.handle.remove();
    if (o.collider && o.collider.moved) movedTo.set(o.id, [o.collider.x, o.collider.z]);
    flashing.delete(o);
  }
  for (const d of L.decor) d.handle.remove();
  for (const e of L.extras) {
    if (e.group) { scene.remove(e.group); e.mat.dispose(); e.glow.material.dispose(); }
    if (e.stone) e.stone.remove();
    if (e.sign) e.sign.remove();
    if (e.lamp) e.lamp.remove();
    if (e.handle) e.handle.remove();
    if (e.glow && !e.group) { scene.remove(e.glow); e.glow.material.dispose(); }
    if (e.parts) e.parts.forEach((p) => p.remove());
    const i = interactables.indexOf(e);
    if (i >= 0) interactables.splice(i, 1);
  }
  phys.dropChunk(L.key);
  live.delete(L.key);
  if (hooks.despawnChunk) hooks.despawnChunk(L.key);
}

/** Load everything in reach at once (behind the curtain at the start of a journey). */
export function loadAround(x, z) {
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  for (let r = 0; r <= LOAD_R; r++) for (let i = cx - r; i <= cx + r; i++) for (let j = cz - r; j <= cz + r; j++) {
    if (Math.max(Math.abs(i - cx), Math.abs(j - cz)) !== r || live.has(key(i, j))) continue;
    buildChunk(i, j);
  }
  lastCx = cx; lastCz = cz;
  queue.length = 0;
}

export function update(x, z, dt) {
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  if (cx !== lastCx || cz !== lastCz) {
    lastCx = cx; lastCz = cz;
    for (const L of [...live.values()]) if (Math.max(Math.abs(L.C.cx - cx), Math.abs(L.C.cz - cz)) > UNLOAD_R) unloadChunk(L);
    queue.length = 0;
    for (let i = cx - LOAD_R; i <= cx + LOAD_R; i++) for (let j = cz - LOAD_R; j <= cz + LOAD_R; j++) if (!live.has(key(i, j))) queue.push([i, j]);
    queue.sort((a, b) => Math.hypot(b[0] - cx, b[1] - cz) - Math.hypot(a[0] - cx, a[1] - cz));
  }
  for (let n = 0; n < 2 && queue.length; n++) { const [i, j] = queue.pop(); if (!live.has(key(i, j))) buildChunk(i, j); }

  // pushed props follow their colliders; struck ones flash
  const movers = [];
  for (const L of live.values()) for (const o of L.objects) if (o.collider && o.collider.moveable && (o.collider.vx || o.collider.vz)) movers.push(o.collider);
  phys.stepProps(movers, dt);
  for (const c of movers) {
    const o = c.owner;
    if (o && o.handle && c.moved) { o.handle.x = c.x; o.handle.z = c.z; o.handle.update(); }
  }
  for (const o of flashing) {
    o.flash -= dt;
    if (o.flash <= 0) { flashing.delete(o); if (o.handle) o.handle.tint(1, 1, 1); }
  }
}

export function clear() {
  for (const L of [...live.values()]) unloadChunk(L);
  broken.clear(); movedTo.clear(); flashing.clear();
  interactables.length = 0;
  phys.clearAll();
  lastCx = lastCz = null;
  queue.length = 0;
}
export const loadedCount = () => live.size;
export const pending = () => queue.length;
export function isLoaded(x, z) { return live.has(key(Math.floor(x / CHUNK), Math.floor(z / CHUNK))); }

/* ---------------------------------------------------------------
   The ground under a point
   --------------------------------------------------------------- */
export function isWater(x, z) {
  if (!S.world) return false;
  const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
  const C = S.world.chunk(cx, cz);
  const col = Math.floor((x - cx * CHUNK) / CELL), row = Math.floor((z - cz * CHUNK) / CELL);
  return !!C.water[row * GRID + col];
}

/* ---------------------------------------------------------------
   Hurting the world
   --------------------------------------------------------------- */
const COLORS = { tree: 0x5f8a3a, rock: 0x8a8577, crate: 0xb08550, barrel: 0x8a5a32, cliff: 0x7a7468, wall: 0x9a958a };
/** Damage an object; returns true if it broke. */
export function damageObject(obj, dmg, x, z) {
  if (!obj || obj.dead) return false;
  const px = obj.collider ? obj.collider.x : obj.def.x, pz = obj.collider ? obj.collider.z : obj.def.z;
  fx.burst(x === undefined ? px : x, 0.8, z === undefined ? pz : z, COLORS[obj.kind] || 0x999999, 4, 3, { plain: true, size: 0.22 });
  if (obj.immortal || !isFinite(obj.hp)) return false;
  obj.hp -= dmg;
  if (obj.handle) { obj.handle.tint(2.2, 2.2, 2.2); obj.flash = 0.08; flashing.add(obj); }
  if (obj.hp > 0) return false;
  obj.dead = true;
  broken.add(obj.id);
  if (obj.handle) obj.handle.remove();
  if (obj.collider) phys.removeCollider(obj.collider);
  fx.burst(px, 0.8, pz, COLORS[obj.kind] || 0x999999, 14, 5, { plain: true, size: 0.3 });
  emit("objectBroken", obj, px, pz);
  return true;
}

/** Take a used chest out of the world (it stays opened in the save). */
export function removeInteractable(it) {
  const i = interactables.indexOf(it);
  if (i >= 0) interactables.splice(i, 1);
  if (it.handle) it.handle.remove();
  if (it.glow) { scene.remove(it.glow); it.glow.material.dispose(); it.glow = null; }
  if (it.collider) phys.removeCollider(it.collider);
}

export function tickWaystones(t, attuned) {
  for (const it of interactables) {
    if (it.type !== "waystone") continue;
    const on = attuned.has(it.id);
    it.mat.opacity = on ? 0.55 + Math.sin(t * 2) * 0.12 : 0.2;
    it.mat.color.setHex(on ? 0x8fd8ff : 0x9a9aa8);
    it.ring.rotation.y = t * (on ? 0.3 : 0.05);
    it.glow.material.opacity = on ? 0.6 : 0.15;
  }
}
export function chunkSeedFor(cx, cz, salt) { return rnd(S.world.seed, cx, cz, salt); }

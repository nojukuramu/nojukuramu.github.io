/* terrain.js — the ground of one chunk: soil, roads, floors, water, and
 * what grows on it.
 *
 * The Phaser build filled each chunk with one flat colour and laid tile
 * sprites over the cells that had a floor or a road. Here:
 *
 *   ground   a 16 m mesh, one vertex a metre, coloured by the biome under
 *            each vertex (so borders blend over a few metres instead of
 *            stepping at a chunk edge), mottled by noise, with the painted
 *            grain of textures.js on top. Water cells are dug out of it.
 *   water    one sheet a little below the ground, so it shows only in the
 *            basins: the shore is wherever the dug ground meets it, and it
 *            curves, because the ground does.
 *   roads    ribbons from the chunk's centre out to each side the road
 *            leaves by, fading at their edges, with a round patch at the
 *            centre so a bend is a bend.
 *   floors   the stone and cobble cells of a structure, as slabs.
 *   decor    grass, flowers, pebbles, mushrooms, cacti, lilies — Kenney's,
 *            scattered by the chunk's own seed where nothing else stands.
 *
 * Everything stays at y = 0 apart from the basins: the game is played on a
 * plane and only drawn in depth. */

import * as THREE from "three";
import { CELL, GRID, CHUNK, BIOMES, DIR, rnd, fbm } from "./world.js";
import { groundDetail, pathTexture, floorTexture } from "./textures.js";
import { place } from "./assets.js";

const SEG = 16;                 // vertices per side - 1: a metre each
export const WATER_Y = -0.16;
const DIG = 0.6;

const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
let detail = null;
const waterMat = new THREE.MeshStandardMaterial({ color: 0x3f86b8, roughness: 0.18, metalness: 0.05, transparent: true, opacity: 0.82 });
waterMat.onBeforeCompile = (sh) => {
  // a slow shimmer, so still water reads as water from above
  sh.uniforms.uTime = waterUniform;
  sh.fragmentShader = sh.fragmentShader
    .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying vec3 vWPos;")
    .replace("#include <dithering_fragment>", "#include <dithering_fragment>\n  float sh = sin(vWPos.x * 1.7 + uTime * 1.3) * sin(vWPos.z * 1.3 - uTime * 1.1);\n  gl_FragColor.rgb += vec3(0.06, 0.09, 0.1) * smoothstep(0.55, 1.0, sh);");
  sh.vertexShader = sh.vertexShader
    .replace("#include <common>", "#include <common>\nvarying vec3 vWPos;")
    .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
};
const waterUniform = { value: 0 };
export function tickWater(t) { waterUniform.value = t; }

const pathMats = {};
function pathMat(kind) {
  if (!pathMats[kind]) pathMats[kind] = new THREE.MeshStandardMaterial({ map: pathTexture(kind), vertexColors: true, transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return pathMats[kind];
}
const floorMats = {};
function floorMat(kind) {
  if (!floorMats[kind]) floorMats[kind] = new THREE.MeshStandardMaterial({ map: floorTexture(kind), vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  return floorMats[kind];
}

const col = new THREE.Color(), colB = new THREE.Color();
const SAND = new THREE.Color(0xc8b07a), MUD = new THREE.Color(0x6e6248);

/** Water depth (0..1) at a vertex: the share of the cells touching it that are water. */
function waterAt(world, x, z) {
  let w = 0, n = 0;
  for (const dx of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) {
    const px = x + dx * 0.98, pz = z + dz * 0.98;
    const cx = Math.floor(px / CHUNK), cz = Math.floor(pz / CHUNK);
    const C = world.chunk(cx, cz);
    const col = Math.floor((px - cx * CHUNK) / CELL), row = Math.floor((pz - cz * CHUNK) / CELL);
    w += C.water[row * GRID + col]; n++;
  }
  return w / n;
}

export function buildChunkGround(world, C) {
  if (!detail) { detail = groundDetail(); groundMat.map = detail; groundMat.needsUpdate = true; }
  const group = new THREE.Group();
  const seed = world.seed;

  /* ----- ground ----- */
  const geo = new THREE.PlaneGeometry(CHUNK, CHUNK, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  geo.translate(C.x0 + CHUNK / 2, 0, C.z0 + CHUNK / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const colors = new Float32Array(pos.count * 3);
  let anyWater = false;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const b = BIOMES[world.biomeAt(x, z)] || BIOMES.Plains;
    const n = fbm(seed + 3, x / 7, z / 7, 3);
    col.setHex(b.ground).lerp(colB.setHex(b.alt), Math.min(1, Math.max(0, (n - 0.35) * 2.2)));
    const fine = fbm(seed + 9, x * 0.6, z * 0.6, 2);
    col.multiplyScalar(0.9 + fine * 0.2);
    const w = waterAt(world, x, z);
    if (w > 0) {
      anyWater = true;
      pos.setY(i, -DIG * w);
      col.lerp(w > 0.6 ? MUD : SAND, Math.min(1, w * 1.6));
    }
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    uv.setXY(i, x / 6, z / 6);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  group.add(ground);

  /* ----- water: a sheet that shows only where the ground was dug ----- */
  if (anyWater) {
    const wg = new THREE.PlaneGeometry(CHUNK, CHUNK);
    wg.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(wg, waterMat);
    water.position.set(C.x0 + CHUNK / 2, WATER_Y, C.z0 + CHUNK / 2);
    water.receiveShadow = true;
    water.renderOrder = 1;
    group.add(water);
  }

  /* ----- road ----- */
  if (C.road) {
    const kind = (BIOMES[C.biome] || BIOMES.Plains).path;
    const P = [], CO = [], UV = [], IDX = [];
    const half = 1.9, cxm = C.x0 + CHUNK / 2, czm = C.z0 + CHUNK / 2;
    const vert = (x, z, a) => { P.push(x, 0.015, z); CO.push(1, 1, 1, a); UV.push(x / 4, z / 4); return P.length / 3 - 1; };
    const ACROSS = [-1.25, -0.7, 0, 0.7, 1.25], ALPHA = [0, 1, 1, 1, 0];
    const strip = (dx, dz) => {
      // from the centre to the chunk edge; across it the alpha fades to nothing at the verge
      const px = -dz, pz = dx, steps = 4, base = P.length / 3;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps * (CHUNK / 2);
        for (let k = 0; k < ACROSS.length; k++) {
          const wob = (rnd(seed, Math.round(cxm + dx * t), Math.round(czm + dz * t), 61) - 0.5) * 0.25;
          vert(cxm + dx * t + px * (ACROSS[k] * half + wob), czm + dz * t + pz * (ACROSS[k] * half + wob), ALPHA[k]);
        }
      }
      for (let s = 0; s < steps; s++) for (let k = 0; k < ACROSS.length - 1; k++) {
        const a = base + s * ACROSS.length + k, b = a + 1, c = a + ACROSS.length, d = c + 1;
        IDX.push(a, b, c, b, d, c);
      }
    };
    if (C.road & DIR.N) strip(0, -1);
    if (C.road & DIR.S) strip(0, 1);
    if (C.road & DIR.E) strip(1, 0);
    if (C.road & DIR.W) strip(-1, 0);
    // the round patch in the middle
    const c0 = vert(cxm, czm, 1);
    const RIM = 16;
    for (let k = 0; k <= RIM; k++) {
      const a = k / RIM * Math.PI * 2;
      vert(cxm + Math.cos(a) * half * 1.15, czm + Math.sin(a) * half * 1.15, k === RIM ? 1 : 1);
    }
    for (let k = 0; k < RIM; k++) IDX.push(c0, c0 + 2 + k, c0 + 1 + k);
    const rimBase = P.length / 3;
    for (let k = 0; k <= RIM; k++) {
      const a = k / RIM * Math.PI * 2;
      vert(cxm + Math.cos(a) * half * 1.55, czm + Math.sin(a) * half * 1.55, 0);
    }
    for (let k = 0; k < RIM; k++) { const i0 = c0 + 1 + k, i1 = rimBase + k; IDX.push(i0, i0 + 1, i1, i0 + 1, i1 + 1, i1); }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
    rg.setAttribute("color", new THREE.Float32BufferAttribute(CO, 4));
    rg.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
    rg.setIndex(IDX);
    rg.computeVertexNormals();
    const m = new THREE.Mesh(rg, pathMat(kind));
    m.material.vertexColors = true;
    m.receiveShadow = true;
    m.renderOrder = 2;
    group.add(m);
  }

  /* ----- floors ----- */
  if (C.floors.length) {
    const byKind = {};
    for (const f of C.floors) (byKind[f.code] = byKind[f.code] || []).push(f.i);
    for (const kind in byKind) {
      const P = [], CO = [], UV = [], IDX = [];
      for (const i of byKind[kind]) {
        const col0 = i % GRID, row = Math.floor(i / GRID);
        const x = C.x0 + col0 * CELL, z = C.z0 + row * CELL;
        const y = 0.03 + rnd(seed, Math.floor(x), Math.floor(z), 71) * 0.03;
        const sh = 0.82 + rnd(seed, Math.floor(x), Math.floor(z), 72) * 0.22;
        const b = P.length / 3;
        for (const [dx, dz] of [[0, 0], [CELL, 0], [0, CELL], [CELL, CELL]]) { P.push(x + dx, y, z + dz); CO.push(sh, sh, sh); UV.push((x + dx) / 4, (z + dz) / 4); }
        IDX.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
      fg.setAttribute("color", new THREE.Float32BufferAttribute(CO, 3));
      fg.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
      fg.setIndex(IDX);
      fg.computeVertexNormals();
      const m = new THREE.Mesh(fg, floorMat(kind));
      m.receiveShadow = true;
      group.add(m);
    }
  }

  return group;
}

/* ---------------------------------------------------------------
   Decor: what grows, by biome. Each entry is [model, count per chunk, size].
   --------------------------------------------------------------- */
const DECOR = {
  Plains:    [["nature/grass", 18, 0.5], ["nature/grass_large", 6, 0.7], ["nature/flower_yellowA", 4, 0.35], ["nature/flower_redA", 3, 0.35], ["nature/rock_smallA", 2, 0.35]],
  Clearing:  [["nature/grass", 14, 0.5], ["nature/flower_purpleA", 5, 0.35], ["nature/flower_yellowA", 4, 0.35]],
  Forest:    [["nature/grass_leafs", 10, 0.6], ["nature/grass", 8, 0.5], ["nature/mushroom_red", 3, 0.35], ["nature/mushroom_tanGroup", 2, 0.4], ["nature/plant_bush", 3, 0.8], ["nature/stump_round", 1, 0.6]],
  Rocky:     [["nature/rock_smallA", 7, 0.45], ["nature/rock_smallC", 6, 0.4], ["nature/grass", 5, 0.45]],
  Ruins:     [["nature/grass", 10, 0.5], ["nature/rock_smallC", 4, 0.35], ["nature/statue_columnDamaged", 0.35, 2.2], ["nature/statue_head", 0.15, 1.2]],
  Village:   [["nature/grass", 12, 0.5], ["nature/flower_redA", 5, 0.35], ["nature/flower_purpleA", 4, 0.35], ["nature/crop_pumpkin", 1, 0.45], ["town/lantern", 0.25, 2.2]],
  Swamp:     [["nature/grass_leafsLarge", 8, 0.8], ["nature/mushroom_tanGroup", 3, 0.4], ["nature/log", 0.6, 1.2], ["nature/stump_round", 1, 0.6]],
  Desert:    [["nature/cactus_short", 1.4, 0.9], ["survival/rock-sand-b", 2, 0.6], ["survival/rock-sand-c", 2, 0.5], ["nature/rock_smallC", 2, 0.3]],
  Graveyard: [["grave/gravestone-round", 3, 0.9], ["grave/gravestone-cross", 2, 1.0], ["grave/gravestone-broken", 2, 0.7], ["grave/candle-multiple", 0.6, 0.5], ["grave/pumpkin-carved", 0.5, 0.5], ["nature/grass", 5, 0.45]],
  Camp:      [["nature/grass", 8, 0.5], ["nature/log_stack", 0.6, 1.2], ["survival/campfire-pit", 0.5, 1.4], ["nature/tent_smallClosed", 0.35, 2.4], ["grave/fire-basket", 0.3, 1.0]],
  Lake:      [["nature/grass", 12, 0.5], ["nature/grass_large", 6, 0.7], ["nature/flower_purpleA", 3, 0.35]],
  Cave:      [["nature/rock_smallC", 6, 0.45], ["nature/rock_smallA", 4, 0.4], ["nature/mushroom_tanGroup", 2, 0.4]]
};
// Built things that stand in the way: these get a collider (see chunks.js).
export const SOLID_DECOR = /statue|gravestone|tent|log_stack|lantern|cactus|log$|stump/;

/** Scatter one chunk's decor; returns [{ handle, key, x, z, r }]. */
export function scatterDecor(world, C, occupied) {
  const out = [];
  const list = DECOR[C.biome] || DECOR.Plains;
  const seed = world.seed;
  let salt = 800;
  for (const [key, per, size] of list) {
    let n = Math.floor(per) + (rnd(seed, C.cx, C.cz, salt) < per % 1 ? 1 : 0);
    salt++;
    for (let k = 0; k < n; k++, salt++) {
      const lx = rnd(seed, C.cx, C.cz * 7 + k, salt) * CHUNK, lz = rnd(seed, C.cx * 7 + k, C.cz, salt + 1) * CHUNK;
      const col = Math.min(GRID - 1, Math.floor(lx / CELL)), row = Math.min(GRID - 1, Math.floor(lz / CELL)), i = row * GRID + col;
      const solid = SOLID_DECOR.test(key);
      if (C.water[i] || C.roadCells.has(i) || occupied[i] || (solid && C.floors.some((f) => f.i === i))) continue;
      const x = C.x0 + lx, z = C.z0 + lz;
      if (Math.hypot(x, z) < 6 || (C.waystone && Math.hypot(x - C.waystone.x, z - C.waystone.z) < 4)) continue;
      if (C.structure && C.structure.great && Math.hypot(x - C.structure.x, z - C.structure.z) < 6) continue;
      const s = size * (0.8 + 0.4 * rnd(seed, Math.floor(x * 3), Math.floor(z * 3), 9));
      const h = place(key, x, z, rnd(seed, Math.floor(x * 5), Math.floor(z * 5), 10) * Math.PI * 2, { h: s });
      if (h) { out.push({ handle: h, key, x, z, r: solid ? Math.max(0.25, s * 0.3) : 0 }); if (solid) occupied[i] = 1; }
    }
  }
  // lilies on open water
  for (let i = 0; i < GRID * GRID; i++) {
    if (!C.water[i] || rnd(seed, C.cx * 64 + i, C.cz, 33) > 0.12) continue;
    const x = C.x0 + (i % GRID) * CELL + CELL / 2 + (rnd(seed, i, C.cx, 34) - 0.5), z = C.z0 + Math.floor(i / GRID) * CELL + CELL / 2 + (rnd(seed, i, C.cz, 35) - 0.5);
    const h = place(rnd(seed, i, C.cz, 36) < 0.5 ? "nature/lily_large" : "nature/lily_small", x, z, rnd(seed, i, i, 37) * 6.28, { w: 0.9 }, WATER_Y + 0.01);
    if (h) out.push({ handle: h, key: "lily", x, z, r: 0 });
  }
  return out;
}

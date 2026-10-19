/* house.js — Lola's house, built fresh from a seed.
 *
 * A bahay na bato's upper floor: a grid of 4 m cells cut into rooms, the
 * rooms named the way the old houses name them (caida, sala, comedor,
 * cocina, cuartos, an oratorio), joined by doorways, lit by nothing.
 *
 * The research this game is built on (README) asks for a layout randomized
 * per run, so that a death or a second night is never a route learnt by
 * heart. So nothing here is drawn by hand: the rooms are a random partition,
 * the doors a random spanning tree plus a few loops (a stealth game without
 * loops is a corridor with a monster in it), and the furniture is placed
 * against the walls by each room's recipe. tools/validate.js builds hundreds
 * of houses and refuses any where a lamp, a closet or the front door cannot
 * be walked to.
 *
 * Pure: no DOM, no three.js. Everything is metres on the floor plane — x to
 * the east, z to the south, y up — and the renderer, the collision and the
 * hunter's map are all read off the one layout this returns. */

import { rng, pick } from "./rng.js";
import { buildGrid, cellOf } from "./nav.js";

export const CELL = 4;          // metres per grid cell
export const GW = 6, GH = 5;    // the house, in cells: 24 m by 20 m
export const WALL_H = 3.3;      // to the ceiling
export const SOLID_H = 2.6;     // interior walls are solid to here; the calado fretwork is above
export const DOOR_W = 1.1, DOOR_H = 2.3;
export const INT_T = 0.14, EXT_T = 0.3;
export const WIN_Y0 = 0.9, WIN_Y1 = 2.55, WIN_W = 1.9;
export const POOL_R = 2.6;      // how far a relit lamp's light reaches, for the rules

/* What each room is, and what goes in it. `door`: the doorways into it get a
   door you can shut, not an open arch. A want is [kind, chance, count?]. */
export const ROOMS = {
  caida: { name: "Caida", floor: "wood", tint: [1, 0.96, 0.9] },
  sala: { name: "Sala", floor: "wood", tint: [0.95, 0.97, 0.92] },
  comedor: { name: "Comedor", floor: "wood", tint: [1, 0.93, 0.86] },
  cocina: { name: "Cocina", floor: "tiles", tint: [0.92, 0.9, 0.84] },
  banyo: { name: "Banyo", floor: "tiles", door: true, tint: [0.86, 0.92, 0.92] },
  oratorio: { name: "Oratorio", floor: "wood", door: true, tint: [0.98, 0.88, 0.86] },
  cuarto: { name: "Cuarto", floor: "wood", door: true, tint: [0.9, 0.94, 1] },
  despensa: { name: "Despensa", floor: "wood", door: true, tint: [0.88, 0.86, 0.8] },
  estudio: { name: "Estudio", floor: "wood", door: true, tint: [0.94, 0.92, 0.86] },
  pasillo: { name: "Pasillo", floor: "wood", tint: [0.96, 0.94, 0.9] }
};

/* Furniture: footprint (w along the wall, d out from it), height, and how it
   behaves. `tall` blocks sight; `top` is a surface something can stand on.
   The sizes are the models' own (assets/models, measured when they were
   packed), so a box here is where the model's legs really are. */
export const PROPS = {
  sofa: { w: 2.29, d: 0.97, h: 0.86 },
  armchair: { w: 0.85, d: 0.79, h: 1.59 },
  tea_table: { w: 0.84, d: 0.84, h: 0.5, top: 0.5, center: true },
  rocking_chair: { w: 0.71, d: 0.83, h: 0.99 },
  grandfather_clock: { w: 0.63, d: 0.43, h: 2.19, tall: true },
  screen: { w: 1.29, d: 0.38, h: 1.6, tall: true },
  china_cabinet: { w: 2.02, d: 0.67, h: 2.23, tall: true },
  dining_table: { w: 2.26, d: 1.39, h: 0.88, top: 0.88, center: true },
  chair: { w: 0.43, d: 0.54, h: 0.96 },
  bed: { w: 1.49, d: 2.04, h: 1.53 },
  iron_bed: { w: 0.9, d: 2.0, h: 1.2 },
  nightstand: { w: 0.57, d: 0.42, h: 0.7, top: 0.7 },
  commode: { w: 1.2, d: 0.58, h: 1.21, top: 1.21 },
  drawers: { w: 1.72, d: 1.01, h: 1.09, top: 1.09 },
  side_table: { w: 0.83, d: 0.52, h: 0.49, top: 0.49 },
  santo: { w: 1.46, d: 1.56, h: 1.73, tall: true },
  bench: { w: 1.16, d: 0.5, h: 0.89 },
  gallinera: { w: 0.58, d: 0.6, h: 1.03 },
  bookshelf: { w: 1.37, d: 0.58, h: 2.06, tall: true },
  stool: { w: 0.42, d: 0.44, h: 0.44 },
  crate: { w: 0.82, d: 0.41, h: 0.35 },
  bucket: { w: 0.37, d: 0.34, h: 0.55 },
  palayok: { w: 0.27, d: 0.26, h: 0.22, small: true },
  pot: { w: 0.26, d: 0.18, h: 0.18, small: true },
  jug: { w: 0.27, d: 0.17, h: 0.21, small: true },
  vase: { w: 0.25, d: 0.26, h: 0.44, small: true },
  sungka: { w: 0.14, d: 0.6, h: 0.04, small: true },
  candlestick: { w: 0.1, d: 0.1, h: 0.22, small: true },
  table: { w: 0.3, d: 0.3, h: 0.42, top: 0.42 },
  // on the wall, not the floor: no footprint
  painting: { w: 0.6, d: 0.02, h: 0.46, wall: 1.75 },
  photo: { w: 0.75, d: 0.03, h: 0.5, wall: 1.7 },
  mirror: { w: 0.49, d: 0.03, h: 0.74, wall: 2.05 },
  // built here, not loaded: the aparador you hide in
  closet: { w: 1.1, d: 0.62, h: 2.15, tall: true }
};

/* Recipes. Each want: [kind, chance, count]. Lamp hosts and closets are
   placed first and separately, so a recipe is only the rest of the room. */
const RECIPES = {
  caida: [["gallinera", 0.9, 2], ["bench", 0.6, 1], ["painting", 0.8, 1], ["photo", 0.5, 1], ["vase", 0.5, 1], ["rocking_chair", 0.25, 1]],
  sala: [["sofa", 0.95, 1], ["armchair", 0.9, 2], ["tea_table", 0.85, 1], ["rocking_chair", 0.8, 1], ["grandfather_clock", 0.75, 1], ["screen", 0.5, 1], ["painting", 0.9, 2], ["vase", 0.5, 1]],
  comedor: [["dining_table", 1, 1], ["china_cabinet", 0.8, 1], ["commode", 0.5, 1], ["painting", 0.6, 1], ["photo", 0.5, 1]],
  cocina: [["drawers", 0.8, 1], ["side_table", 0.7, 1], ["stool", 0.9, 2], ["crate", 0.8, 2], ["bucket", 0.8, 1], ["palayok", 0.9, 2], ["pot", 0.8, 1], ["bookshelf", 0.4, 1]],
  banyo: [["bucket", 1, 2], ["palayok", 0.8, 1], ["stool", 0.7, 1], ["mirror", 0.8, 1]],
  oratorio: [["santo", 1, 1], ["bench", 0.9, 2], ["side_table", 0.6, 1], ["painting", 0.6, 1]],
  cuarto: [["bed|iron_bed", 1, 1], ["nightstand", 0.8, 1], ["commode|drawers", 0.6, 1], ["mirror", 0.6, 1], ["chair", 0.5, 1], ["photo", 0.5, 1], ["rocking_chair", 0.2, 1]],
  despensa: [["crate", 1, 3], ["bookshelf", 0.6, 1], ["bucket", 0.7, 1], ["palayok", 0.8, 2], ["stool", 0.4, 1]],
  estudio: [["bookshelf", 1, 2], ["drawers", 0.6, 1], ["chair", 0.8, 1], ["armchair", 0.5, 1], ["painting", 0.6, 1], ["screen", 0.3, 1]],
  pasillo: [["bench", 0.7, 1], ["gallinera", 0.6, 1], ["painting", 0.8, 2], ["vase", 0.5, 1], ["photo", 0.4, 1]]
};
const CLOSET_CHANCE = { caida: 1, cuarto: 1, sala: 0.6, comedor: 0.45, estudio: 0.6, despensa: 0.45, pasillo: 0.35, cocina: 0.3, oratorio: 0.25, banyo: 0 };
const LAMP_HOSTS = ["side_table", "commode", "drawers", "nightstand"];

/* ------------------------------------------------------------------ */

/** Build a house. Retries the partition until it holds every room a house needs. */
export function generate(seed) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const L = tryGenerate((seed + attempt * 7919) >>> 0);
    if (L) { L.seed = seed >>> 0; L.attempt = attempt; return L; }
  }
  throw new Error("house: no layout for seed " + seed);
}

function tryGenerate(seed) {
  const r = rng(seed);
  const rects = [];
  partition(r, { x: 0, z: 0, w: GW, h: GH }, rects);
  if (rects.length < 10 || rects.length > 16) return null;
  const L = {
    CELL, GW, GH, W: GW * CELL, D: GH * CELL,
    rooms: rects.map((q, id) => ({ id, x: q.x, z: q.z, w: q.w, h: q.h, type: null })),
    cellRoom: new Int16Array(GW * GH).fill(-1),
    doors: [], windows: [], props: [], closets: [], lamps: [], tins: [], notes: [], creaks: [],
    walls: [], blocks: [], start: null, exit: null
  };
  for (const rm of L.rooms) {
    for (let i = rm.x; i < rm.x + rm.w; i++) for (let j = rm.z; j < rm.z + rm.h; j++) L.cellRoom[j * GW + i] = rm.id;
    rm.cx = (rm.x + rm.w / 2) * CELL; rm.cz = (rm.z + rm.h / 2) * CELL; rm.area = rm.w * rm.h;
  }
  const adj = adjacency(L);
  if (!assignTypes(L, r, adj)) return null;
  doors(L, r, adj);
  if (!frontDoor(L, r)) return null;
  windows(L, r);
  walls(L);
  if (!furnish(L, r)) return null;
  extras(L, r);
  L.blocks = blocksOf(L);
  if (!walkable(L)) return null;
  return L;
}

/* Every doorway, lamp, closet and the front door on one piece of floor.
   Furniture placed against the walls of a room with three doors can still
   wall one of them off; when it does, the thing standing nearest the
   blocked doorway goes, until nothing is cut off (or the layout is thrown
   away and built again). */
function keySpots(L) {
  const out = [{ x: L.start.x, z: L.start.z, room: -1 }, { x: L.exit.x, z: L.exit.z, room: -1 }];
  for (const l of L.lamps) out.push({ x: l.front.x, z: l.front.z, room: l.room });
  for (const c of L.closets) out.push({ x: c.front.x, z: c.front.z, room: c.room });
  for (const d of L.doors) {
    if (d.b < 0 || d.sealed) continue;
    // a step either side of the doorway
    const k = 0.45;
    out.push({ x: d.x + (d.v ? -k : 0), z: d.z + (d.v ? 0 : -k), room: -1, door: d.id });
    out.push({ x: d.x + (d.v ? k : 0), z: d.z + (d.v ? 0 : k), room: -1, door: d.id });
  }
  return out;
}
export function cutOff(L) {
  const G = buildGrid(L);
  return keySpots(L).filter((sp) => { const c = cellOf(G, sp.x, sp.z); return G.label[c] !== G.main && !nearMain(G, c); });
}
function nearMain(G, c) {
  // the spot itself may sit just inside a table's reach; one ring round it will do
  const i = c % G.nx, j = Math.floor(c / G.nx);
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const n = (j + dj) * G.nx + i + di; if (n >= 0 && n < G.label.length && G.label[n] === G.main) return true; }
  return false;
}
function walkable(L) {
  for (let tries = 0; tries < 12; tries++) {
    const bad = cutOff(L);
    if (!bad.length) return true;
    // the nearest removable thing to the first spot that is cut off
    const sp = bad[0];
    let best = null, bd = Infinity;
    for (const p of L.props) {
      if (!p.solid || p.lampHost || p.kind === "closet" || p.gone) continue;
      const d = Math.hypot(p.x - sp.x, p.z - sp.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best || bd > 5) return false;
    best.gone = true; best.solid = false;
    // whatever stood on it goes with it; a tin or a note ends up on the floor
    for (const q of L.props) if (q.on === best.id) q.gone = true;
    for (const q of L.tins.concat(L.notes)) if (q.on === best.id) q.y = 0.005;
    L.blocks = blocksOf(L);
  }
  return false;
}

/* Cut the grid into rooms: split anything bigger than six cells or longer
   than three, and split smaller rectangles often enough that a house has
   ten to sixteen rooms. */
function partition(r, q, out) {
  const area = q.w * q.h;
  const must = area > 6 || q.w > 3 || q.h > 3;
  const may = area >= 2 && r() < (area >= 4 ? 0.62 : 0.22);
  if (!must && !may) { out.push(q); return; }
  let vertical = q.w > q.h ? true : q.h > q.w ? false : r() < 0.5;
  if (vertical && q.w < 2) vertical = false;
  if (!vertical && q.h < 2) vertical = true;
  const n = vertical ? q.w : q.h;
  const at = 1 + Math.floor(r() * (n - 1));
  if (vertical) { partition(r, { x: q.x, z: q.z, w: at, h: q.h }, out); partition(r, { x: q.x + at, z: q.z, w: q.w - at, h: q.h }, out); }
  else { partition(r, { x: q.x, z: q.z, w: q.w, h: at }, out); partition(r, { x: q.x, z: q.z + at, w: q.w, h: q.h - at }, out); }
}

/* Every unit edge two rooms share. An edge is { v: vertical?, i, j }: a
   vertical edge at x = i spanning z j..j+1, or a horizontal one at z = j
   spanning x i..i+1. */
function adjacency(L) {
  const m = new Map();
  const add = (a, b, e) => {
    const k = a < b ? a + ":" + b : b + ":" + a;
    if (!m.has(k)) m.set(k, { a: Math.min(a, b), b: Math.max(a, b), edges: [] });
    m.get(k).edges.push(e);
  };
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const c = L.cellRoom[j * GW + i];
    if (i + 1 < GW) { const d = L.cellRoom[j * GW + i + 1]; if (d !== c) add(c, d, { v: true, i: i + 1, j }); }
    if (j + 1 < GH) { const d = L.cellRoom[(j + 1) * GW + i]; if (d !== c) add(c, d, { v: false, i, j: j + 1 }); }
  }
  return [...m.values()];
}
const neighbours = (adj, id) => adj.filter((p) => p.a === id || p.b === id).map((p) => (p.a === id ? p.b : p.a));

function assignTypes(L, r, adj) {
  const free = new Set(L.rooms.map((x) => x.id));
  const take = (id, type) => { L.rooms[id].type = type; free.delete(id); };
  const rooms = () => [...free].map((id) => L.rooms[id]);
  // the caida: on the front (south) wall, as near the middle as can be, not huge
  const front = rooms().filter((x) => x.z + x.h === GH && x.area <= 4);
  if (!front.length) return false;
  front.sort((a, b) => Math.abs(a.cx - L.W / 2) - Math.abs(b.cx - L.W / 2) + (r() - 0.5) * 6);
  take(front[0].id, "caida");
  const caida = front[0];
  // the sala: the biggest room beside the caida
  const nb = neighbours(adj, caida.id).map((id) => L.rooms[id]).filter((x) => free.has(x.id));
  if (!nb.length) return false;
  nb.sort((a, b) => b.area - a.area || r() - 0.5);
  take(nb[0].id, "sala");
  // the cocina: at the back, far from the front door
  const back = rooms().filter((x) => x.z === 0 && x.area <= 4);
  if (!back.length) return false;
  back.sort((a, b) => dist(b, caida) - dist(a, caida));
  take(back[0].id, "cocina");
  const cocina = back[0];
  // the comedor: the biggest left, beside the cocina or the sala if it can be
  const near = (x) => neighbours(adj, x.id).some((id) => id === cocina.id || L.rooms[id].type === "sala");
  const com = rooms().sort((a, b) => (near(b) ? 3 : 0) + b.area - (near(a) ? 3 : 0) - a.area);
  if (!com.length) return false;
  take(com[0].id, "comedor");
  // the banyo: one cell, beside the cocina or anything
  const ban = rooms().filter((x) => x.area === 1).sort((a, b) => (neighbours(adj, b.id).includes(cocina.id) ? 1 : 0) - (neighbours(adj, a.id).includes(cocina.id) ? 1 : 0));
  if (!ban.length) return false;
  take(ban[0].id, "banyo");
  // the oratorio: small, and as far from the cocina as can be
  const ora = rooms().filter((x) => x.area <= 2).sort((a, b) => dist(b, cocina) - dist(a, cocina));
  if (!ora.length) return false;
  take(ora[0].id, "oratorio");
  // the cuartos: two or three of what is left, the middling ones
  const mid = rooms().filter((x) => x.area >= 2).sort(() => r() - 0.5);
  const nCuarto = Math.min(mid.length, 2 + (r() < 0.5 ? 1 : 0));
  if (nCuarto < 2) return false;
  for (let k = 0; k < nCuarto; k++) take(mid[k].id, "cuarto");
  // whatever is left: a despensa, an estudio, and long thin ones are passages
  for (const x of rooms().sort((a, b) => a.area - b.area)) {
    if (!L.rooms.some((q) => q.type === "despensa") && x.area <= 2) take(x.id, "despensa");
    else if ((x.w === 1 && x.h >= 2) || (x.h === 1 && x.w >= 2)) take(x.id, r() < 0.6 ? "pasillo" : "estudio");
    else take(x.id, r() < 0.5 ? "estudio" : "cuarto");
  }
  for (const rm of L.rooms) { rm.name = ROOMS[rm.type].name; rm.floor = ROOMS[rm.type].floor; rm.tint = ROOMS[rm.type].tint; }
  return true;
}
const dist = (a, b) => Math.hypot(a.cx - b.cx, a.cz - b.cz);

/* A random spanning tree, then loops: about four in ten of the remaining
   walls between rooms get a doorway too, and never fewer than two. */
function doors(L, r, adj) {
  const parent = L.rooms.map((x) => x.id);
  const find = (a) => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  // the caida opens onto the sala, always: the first thing the player sees is the house
  const order = adj.map((p) => ({ p, k: r() - (isPair(L, p, "caida", "sala") ? 10 : 0) - (isPair(L, p, "cocina", "comedor") ? 0.5 : 0) })).sort((a, b) => a.k - b.k).map((o) => o.p);
  const rest = [];
  for (const p of order) {
    // the banyo is a dead end: one door
    const ra = find(p.a), rb = find(p.b);
    if (ra !== rb) { parent[ra] = rb; place(L, r, p); } else rest.push(p);
  }
  let loops = 0;
  for (const p of rest) {
    if (L.rooms[p.a].type === "banyo" || L.rooms[p.b].type === "banyo") continue;
    if (r() < 0.42 || loops < 2) { place(L, r, p); loops++; }
  }
  L.loops = loops;
}
const isPair = (L, p, t1, t2) => (L.rooms[p.a].type === t1 && L.rooms[p.b].type === t2) || (L.rooms[p.a].type === t2 && L.rooms[p.b].type === t1);

function place(L, r, p) {
  const e = p.edges[Math.floor(r() * p.edges.length)];
  const off = (r() - 0.5) * (CELL - DOOR_W - 1.0);
  const wantsDoor = ROOMS[L.rooms[p.a].type].door || ROOMS[L.rooms[p.b].type].door;
  const d = {
    id: L.doors.length, a: p.a, b: p.b, v: e.v, kind: wantsDoor ? "door" : "arch",
    x: e.v ? e.i * CELL : e.i * CELL + CELL / 2 + off,
    z: e.v ? e.j * CELL + CELL / 2 + off : e.j * CELL,
    w: DOOR_W, open: wantsDoor ? (r() < 0.55 ? 1 : 0) : 1, sealed: false
  };
  L.doors.push(d);
}

/* The front door: in the caida's south wall. Locked until the end. */
function frontDoor(L, r) {
  const c = L.rooms.find((x) => x.type === "caida");
  const i = c.x + Math.floor(r() * c.w);
  const d = { id: L.doors.length, a: c.id, b: -1, v: false, kind: "front", x: i * CELL + CELL / 2, z: GH * CELL, w: 1.4, open: 0, sealed: false, locked: true };
  L.doors.push(d);
  L.exit = { door: d.id, x: d.x, z: d.z - 0.6, out: { x: d.x, z: d.z + 1.5 } };
  L.start = { x: d.x + (r() - 0.5) * 0.6, z: d.z - 1.6, yaw: Math.PI };
  return true;
}

/* Capiz windows in the outside walls, about one cell edge in two, never
   where the front door is. */
function windows(L, r) {
  const fd = L.doors.find((d) => d.kind === "front");
  for (let i = 0; i < GW; i++) for (const [j, n] of [[0, -1], [GH, 1]]) {
    const room = L.cellRoom[(n < 0 ? 0 : GH - 1) * GW + i];
    if (n > 0 && Math.abs(fd.x - (i * CELL + CELL / 2)) < 1) continue;
    if (r() < 0.55) L.windows.push({ id: L.windows.length, v: false, x: i * CELL + CELL / 2, z: j * CELL, room, n: [0, n] });
  }
  for (let j = 0; j < GH; j++) for (const [i, n] of [[0, -1], [GW, 1]]) {
    const room = L.cellRoom[j * GW + (n < 0 ? 0 : GW - 1)];
    if (r() < 0.55) L.windows.push({ id: L.windows.length, v: true, x: i * CELL, z: j * CELL + CELL / 2, room, n: [n, 0] });
  }
  // the banyo gets one if it touches the outside at all, small rooms need air
}

/* Walls: every unit edge between two rooms or between a room and outside,
   merged into straight runs, each with its holes (doorways and windows). */
function walls(L) {
  const runs = new Map();
  const key = (v, c) => (v ? "v" : "h") + c;
  const edge = (v, i, j, ext) => {
    const k = key(v, v ? i : j);
    if (!runs.has(k)) runs.set(k, { v, c: (v ? i : j) * CELL, segs: [] });
    runs.get(k).segs.push({ a: (v ? j : i) * CELL, b: (v ? j : i) * CELL + CELL, ext });
  };
  for (let j = 0; j <= GH; j++) for (let i = 0; i < GW; i++) {
    const up = j > 0 ? L.cellRoom[(j - 1) * GW + i] : -1, dn = j < GH ? L.cellRoom[j * GW + i] : -1;
    if (up !== dn) edge(false, i, j, up < 0 || dn < 0);
  }
  for (let i = 0; i <= GW; i++) for (let j = 0; j < GH; j++) {
    const lf = i > 0 ? L.cellRoom[j * GW + i - 1] : -1, rt = i < GW ? L.cellRoom[j * GW + i] : -1;
    if (lf !== rt) edge(true, i, j, lf < 0 || rt < 0);
  }
  for (const run of runs.values()) {
    run.segs.sort((p, q) => p.a - q.a);
    // merge touching segments of the same kind into one wall
    let cur = null;
    for (const s of run.segs) {
      if (cur && Math.abs(cur.b - s.a) < 1e-6 && cur.ext === s.ext) cur.b = s.b;
      else { if (cur) L.walls.push(cur); cur = { v: run.v, c: run.c, a: s.a, b: s.b, ext: s.ext, t: s.ext ? EXT_T : INT_T, holes: [] }; }
    }
    if (cur) L.walls.push(cur);
  }
  for (const w of L.walls) {
    for (const d of L.doors) if (d.v === w.v && Math.abs((d.v ? d.x : d.z) - w.c) < 1e-6) {
      const at = d.v ? d.z : d.x;
      if (at > w.a && at < w.b) w.holes.push({ door: d.id, a: at - d.w / 2, b: at + d.w / 2, y0: 0, y1: d.kind === "front" ? 2.5 : DOOR_H });
    }
    for (const win of L.windows) if (win.v === w.v && Math.abs((win.v ? win.x : win.z) - w.c) < 1e-6) {
      const at = win.v ? win.z : win.x;
      if (at > w.a && at < w.b) w.holes.push({ window: win.id, a: at - WIN_W / 2, b: at + WIN_W / 2, y0: WIN_Y0, y1: WIN_Y1 });
    }
    w.holes.sort((p, q) => p.a - q.a);
  }
}

/* ------------------------------------------------------------------ */
/* Furniture                                                          */

/* The room's floor, inset from its walls. */
function inner(L, rm) {
  const pad = 0.12;
  const x0 = rm.x * CELL, z0 = rm.z * CELL, x1 = (rm.x + rm.w) * CELL, z1 = (rm.z + rm.h) * CELL;
  const t = (onEdge) => (onEdge ? EXT_T / 2 : INT_T / 2) + pad;
  return { x0: x0 + t(rm.x === 0), z0: z0 + t(rm.z === 0), x1: x1 - t(rm.x + rm.w === GW), z1: z1 - t(rm.z + rm.h === GH) };
}

/* Places in a room where nothing may stand: a square inside every doorway
   (and the arc a door leaf swings through), and around the start. */
function keepClear(L, rm) {
  const out = [];
  for (const d of L.doors) {
    if (d.a !== rm.id && d.b !== rm.id) continue;
    const reach = d.kind === "door" || d.kind === "front" ? 1.5 : 1.25;
    if (d.v) out.push({ x0: d.x - reach, x1: d.x + reach, z0: d.z - d.w / 2 - 0.35, z1: d.z + d.w / 2 + 0.35 });
    else out.push({ x0: d.x - d.w / 2 - 0.35, x1: d.x + d.w / 2 + 0.35, z0: d.z - reach, z1: d.z + reach });
  }
  if (rm.type === "caida") out.push({ x0: L.start.x - 1.1, x1: L.start.x + 1.1, z0: L.start.z - 1.4, z1: L.start.z + 1.6 });
  return out;
}
const overlap = (a, b, m) => a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;

/* Spots along a room's walls where a thing w wide and d deep can stand with
   its back to the wall, facing in. Windows only take things lower than the sill. */
function wallSpots(L, rm, w, d, h, r) {
  const q = inner(L, rm), out = [];
  const sides = [
    { n: [0, 1], along: "x", fixed: q.z0, lo: q.x0, hi: q.x1, wallZ: rm.z * CELL, isV: false },
    { n: [0, -1], along: "x", fixed: q.z1, lo: q.x0, hi: q.x1, wallZ: (rm.z + rm.h) * CELL, isV: false },
    { n: [1, 0], along: "z", fixed: q.x0, lo: q.z0, hi: q.z1, wallX: rm.x * CELL, isV: true },
    { n: [-1, 0], along: "z", fixed: q.x1, lo: q.z0, hi: q.z1, wallX: (rm.x + rm.w) * CELL, isV: true }
  ];
  for (const s of sides) {
    for (let t = s.lo + w / 2; t <= s.hi - w / 2 + 1e-6; t += 0.25) {
      let box;
      if (s.along === "x") { const zc = s.fixed + s.n[1] * d / 2; box = { x0: t - w / 2, x1: t + w / 2, z0: zc - d / 2, z1: zc + d / 2, x: t, z: zc }; }
      else { const xc = s.fixed + s.n[0] * d / 2; box = { x0: xc - d / 2, x1: xc + d / 2, z0: t - w / 2, z1: t + w / 2, x: xc, z: t }; }
      // under a window only if it is lower than the sill
      if (h > WIN_Y0 - 0.05 && L.windows.some((wi) => wi.v === s.isV && (s.isV ? Math.abs(wi.x - s.wallX) < 0.01 && Math.abs(wi.z - t) < (WIN_W + w) / 2 : Math.abs(wi.z - s.wallZ) < 0.01 && Math.abs(wi.x - t) < (WIN_W + w) / 2))) continue;
      out.push({ box, rot: Math.atan2(s.n[0], s.n[1]), n: s.n });
    }
  }
  // shuffled, so the same recipe never furnishes two rooms the same way
  for (let i = out.length - 1; i > 0; i--) { const k = Math.floor(r() * (i + 1)); const t = out[i]; out[i] = out[k]; out[k] = t; }
  return out;
}

function furnish(L, r) {
  const taken = new Map(); // room id -> boxes used
  const used = (id) => taken.get(id) || (taken.set(id, []), taken.get(id));
  const fits = (rm, box, m) => !keepClear(L, rm).some((k) => overlap(box, k, 0)) && !used(rm.id).some((u) => overlap(box, u, m));
  const put = (rm, kind, spot, extra) => {
    const P = PROPS[kind];
    const p = Object.assign({ id: L.props.length, kind, room: rm.id, x: spot.box.x, z: spot.box.z, y: 0, rot: spot.rot, box: spot.box, h: P.h, tall: !!P.tall, solid: !P.small && !P.wall }, extra || {});
    L.props.push(p);
    if (p.solid) used(rm.id).push(spot.box);
    return p;
  };
  // the floor in front of a lamp's table or a closet's doors stays clear: you
  // have to be able to reach the one and get into the other
  const reserveFront = (rm, p) => {
    const n = [Math.sin(p.rot), Math.cos(p.rot)], dd = PROPS[p.kind].d / 2 + 0.55;
    const x = p.x + n[0] * dd, z = p.z + n[1] * dd;
    used(rm.id).push({ x0: x - 0.5, x1: x + 0.5, z0: z - 0.5, z1: z + 0.5, x, z, reserved: true });
  };
  const tryWall = (rm, kind, extra) => {
    const P = PROPS[kind];
    for (const s of wallSpots(L, rm, P.w, P.d, P.h, r)) if (fits(rm, s.box, 0.18)) return put(rm, kind, s, extra);
    return null;
  };
  const tryCenter = (rm, kind) => {
    const P = PROPS[kind], q = inner(L, rm);
    for (let k = 0; k < 30; k++) {
      const rot = r() < 0.5 ? 0 : Math.PI / 2;
      const w = rot ? P.d : P.w, d = rot ? P.w : P.d;
      const x = q.x0 + 1.1 + w / 2 + r() * Math.max(0, q.x1 - q.x0 - 2.2 - w);
      const z = q.z0 + 1.1 + d / 2 + r() * Math.max(0, q.z1 - q.z0 - 2.2 - d);
      const box = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, x, z };
      if (box.x0 < q.x0 + 0.9 || box.x1 > q.x1 - 0.9 || box.z0 < q.z0 + 0.9 || box.z1 > q.z1 - 0.9) continue;
      if (fits(rm, box, 0.6)) return put(rm, kind, { box, rot });
    }
    return null;
  };
  // chairs round a table: two on each long side, sometimes one at each end
  const chairsAround = (rm, t) => {
    const P = PROPS.chair, long = t.rot ? "z" : "x";
    const T = PROPS[t.kind], half = T.w / 2, side = T.d / 2 + 0.32;
    const seats = [[-half * 0.5, side], [half * 0.5, side], [-half * 0.5, -side], [half * 0.5, -side], [half + 0.32, 0], [-half - 0.32, 0]];
    for (const [a, b] of seats) {
      if (r() < 0.2) continue;
      const x = t.x + (long === "x" ? a : b), z = t.z + (long === "x" ? b : a);
      // facing the table, pushed back a little crooked, the way chairs are left
      const rot = Math.atan2(t.x - x, t.z - z) + (r() - 0.5) * 0.4;
      const box = { x0: x - P.w / 2, x1: x + P.w / 2, z0: z - P.w / 2, z1: z + P.w / 2, x, z };
      if (!keepClear(L, rm).some((k) => overlap(box, k, 0))) put(rm, "chair", { box, rot });
    }
  };

  // 1. lamps. The first is in the caida, a few steps from the front door; the
  //    other four as far from each other as the house allows.
  const graph = roomGraph(L);
  const lampRooms = [L.rooms.find((x) => x.type === "caida").id];
  const okLamp = (x) => !["banyo", "caida", "despensa", "pasillo"].includes(x.type);
  while (lampRooms.length < 5) {
    let best = -1, bestScore = -1;
    for (const rm of L.rooms) {
      if (lampRooms.includes(rm.id) || !okLamp(rm)) continue;
      const dmin = Math.min(...lampRooms.map((id) => graph.hops[id][rm.id]));
      const score = dmin + r() * 0.9;
      if (score > bestScore) { bestScore = score; best = rm.id; }
    }
    if (best < 0) return false;
    lampRooms.push(best);
  }
  for (let i = 0; i < 5; i++) {
    const rm = L.rooms[lampRooms[i]];
    let host = null;
    const hosts = i === 0 ? ["side_table", "commode"] : rm.type === "comedor" ? ["commode", "side_table"] : rm.type === "cuarto" ? ["nightstand", "commode", "drawers"] : LAMP_HOSTS;
    for (const k of hosts) {
      if (i === 0) {
        // the first lamp: four to six metres from where the player wakes
        const P = PROPS[k];
        const spots = wallSpots(L, rm, P.w, P.d, P.h, r).filter((s) => { const dd = Math.hypot(s.box.x - L.start.x, s.box.z - L.start.z); return dd > 3.2 && dd < 6.5; });
        for (const s of spots) if (fits(rm, s.box, 0.18)) { host = put(rm, k, s); break; }
      } else host = tryWall(rm, k);
      if (host) break;
    }
    if (!host) return false;
    host.lampHost = true;
    reserveFront(rm, host);
    const n = [Math.sin(host.rot), Math.cos(host.rot)], reach = PROPS[host.kind].d / 2 + 0.55;
    L.lamps.push({ id: i, room: rm.id, host: host.id, x: host.x, y: PROPS[host.kind].top, z: host.z, lit: false, refilled: false, front: { x: host.x + n[0] * reach, z: host.z + n[1] * reach } });
  }
  // 2. closets: one in the caida within reach of the first lamp, one in every
  //    cuarto, and a fair chance anywhere else
  for (const rm of L.rooms) {
    if (r() > CLOSET_CHANCE[rm.type]) continue;
    const c = rm.type === "caida" ? tryCloset(L, rm, r, fits, put, true) : tryWall(rm, "closet");
    if (c) { addCloset(L, c); reserveFront(rm, c); }
    else if (rm.type === "caida") return false;
  }
  if (L.closets.length < 6) {
    for (const rm of L.rooms.slice().sort(() => r() - 0.5)) {
      if (L.closets.length >= 6) break;
      if (rm.type === "banyo" || L.closets.some((c) => c.room === rm.id)) continue;
      const c = tryWall(rm, "closet");
      if (c) { addCloset(L, c); reserveFront(rm, c); }
    }
  }
  if (L.closets.length < 5) return false;
  // 3. each room's own things
  for (const rm of L.rooms) {
    for (const [kinds, chance, count] of RECIPES[rm.type]) {
      for (let n = 0; n < (count || 1); n++) {
        if (r() > chance) continue;
        const kind = pick(r, kinds.split("|"));
        const P = PROPS[kind];
        if (P.wall) { wallHang(L, rm, kind, r); continue; }
        if (P.small) { smallThing(L, rm, kind, r, used); continue; }
        const p = P.center ? tryCenter(rm, kind) : tryWall(rm, kind);
        if (p && kind === "dining_table") chairsAround(rm, p);
        if (p && kind === "tea_table" && r() < 0.6) L.props.push({ id: L.props.length, kind: "sungka", room: rm.id, x: p.x, y: PROPS.tea_table.top, z: p.z, rot: r() * Math.PI, h: 0.04, solid: false, small: true });
      }
    }
  }
  // candles for the santo, a jug on the dining table
  for (const p of L.props.slice()) {
    if (p.kind === "dining_table") L.props.push({ id: L.props.length, kind: "jug", room: p.room, x: p.x + (r() - 0.5) * 0.6, y: PROPS.dining_table.top, z: p.z + (r() - 0.5) * 0.3, rot: r() * 6.28, h: 0.2, solid: false, small: true });
    if (p.kind === "santo") for (let k = 0; k < 3; k++) {
      const a = p.rot, s = (k - 1) * 0.55;
      L.props.push({ id: L.props.length, kind: "candlestick", room: p.room, x: p.x + Math.cos(a) * s + Math.sin(a) * 0.95, y: 0, z: p.z - Math.sin(a) * s + Math.cos(a) * 0.95, rot: 0, h: 0.22, solid: false, small: true });
    }
  }
  L.graph = graph;
  return true;
}

function tryCloset(L, rm, r, fits, put) {
  const P = PROPS.closet;
  const lamp = L.lamps[0];
  const spots = wallSpots(L, rm, P.w, P.d, P.h, r).sort((a, b) => Math.hypot(a.box.x - lamp.x, a.box.z - lamp.z) - Math.hypot(b.box.x - lamp.x, b.box.z - lamp.z));
  for (const s of spots) if (fits(rm, s.box, 0.18)) return put(rm, "closet", s);
  return null;
}

function addCloset(L, p) {
  const n = [Math.sin(p.rot), Math.cos(p.rot)];
  const d = PROPS.closet.d;
  L.closets.push({
    id: L.closets.length, prop: p.id, room: p.room, x: p.x, z: p.z, rot: p.rot, n,
    // where you stand to open it, and where your eyes are once inside
    front: { x: p.x + n[0] * (d / 2 + 0.55), z: p.z + n[1] * (d / 2 + 0.55) },
    inside: { x: p.x + n[0] * 0.02, z: p.z + n[1] * 0.02 }
  });
  p.closet = L.closets.length - 1;
}

function wallHang(L, rm, kind, r) {
  const P = PROPS[kind], q = inner(L, rm);
  for (let k = 0; k < 12; k++) {
    const side = Math.floor(r() * 4);
    const t = r();
    let x, z, rot;
    if (side === 0) { x = q.x0 + 0.6 + t * (q.x1 - q.x0 - 1.2); z = q.z0 - 0.1; rot = 0; }
    else if (side === 1) { x = q.x0 + 0.6 + t * (q.x1 - q.x0 - 1.2); z = q.z1 + 0.1; rot = Math.PI; }
    else if (side === 2) { z = q.z0 + 0.6 + t * (q.z1 - q.z0 - 1.2); x = q.x0 - 0.1; rot = Math.PI / 2; }
    else { z = q.z0 + 0.6 + t * (q.z1 - q.z0 - 1.2); x = q.x1 + 0.1; rot = -Math.PI / 2; }
    // not over a doorway, a window, a tall thing or another picture
    const near = (o, m) => Math.hypot(o.x - x, o.z - z) < m;
    if (L.doors.some((d) => near(d, 1.3)) || L.windows.some((w) => near(w, 1.4))) continue;
    if (L.props.some((p) => p.room === rm.id && (p.tall || PROPS[p.kind].wall) && near(p, 1.1))) continue;
    L.props.push({ id: L.props.length, kind, room: rm.id, x, y: P.wall, z, rot, h: P.h, solid: false, wall: true });
    return;
  }
}

/* Small things go on a surface if the room has one free, else on the floor by a wall. */
function smallThing(L, rm, kind, r, used) {
  const tops = L.props.filter((p) => p.room === rm.id && PROPS[p.kind].top && !p.lampHost && !L.props.some((o) => o.on === p.id));
  if (tops.length && r() < 0.6) {
    const t = pick(r, tops);
    L.props.push({ id: L.props.length, kind, room: rm.id, x: t.x + (r() - 0.5) * 0.2, y: PROPS[t.kind].top, z: t.z + (r() - 0.5) * 0.15, rot: r() * 6.28, h: PROPS[kind].h, solid: false, small: true, on: t.id });
    return;
  }
  const q = inner(L, rm);
  for (let k = 0; k < 10; k++) {
    const x = q.x0 + 0.25 + r() * (q.x1 - q.x0 - 0.5), z = q.z0 + 0.25 + r() * (q.z1 - q.z0 - 0.5);
    const box = { x0: x - 0.2, x1: x + 0.2, z0: z - 0.2, z1: z + 0.2 };
    // hug the walls: a pot in the middle of the floor is a pot to trip on
    const wallGap = Math.min(x - q.x0, q.x1 - x, z - q.z0, q.z1 - z);
    if (wallGap > 0.5) continue;
    if (keepClearOf(L, rm).some((c) => overlap(box, c, 0)) || used(rm.id).some((u) => overlap(box, u, 0.05))) continue;
    L.props.push({ id: L.props.length, kind, room: rm.id, x, y: 0, z, rot: r() * 6.28, h: PROPS[kind].h, solid: false, small: true });
    return;
  }
}
const keepClearOf = (L, rm) => keepClear(L, rm);

/* Oil tins, Lola's notes, and the boards that creak. */
function extras(L, r) {
  const lampRoom = new Set(L.lamps.map((l) => l.room));
  const surfaces = L.props.filter((p) => PROPS[p.kind].top && !p.lampHost && !lampRoom.has(p.room));
  const shuffled = surfaces.sort(() => r() - 0.5);
  for (let k = 0; k < 3 && k < shuffled.length; k++) {
    const s = shuffled[k];
    L.tins.push({ id: k, room: s.room, x: s.x + (r() - 0.5) * 0.2, y: PROPS[s.kind].top, z: s.z, taken: false, on: s.id });
  }
  // notes: the tiktik in the sala or comedor, the closets in a cuarto, the light in the oratorio
  const noteRoom = [["sala", "comedor"], ["cuarto"], ["oratorio", "estudio"]];
  for (let k = 0; k < 3; k++) {
    const rm = L.rooms.filter((x) => noteRoom[k].includes(x.type)).sort(() => r() - 0.5)[0];
    if (!rm) continue;
    const tops = L.props.filter((p) => p.room === rm.id && PROPS[p.kind].top && !L.tins.some((t) => t.on === p.id));
    if (tops.length) { const t = pick(r, tops); L.notes.push({ id: k, room: rm.id, x: t.x + 0.15, y: PROPS[t.kind].top + 0.005, z: t.z - 0.05, rot: r() * 6.28, read: false, on: t.id }); }
    else { const q = inner(L, rm); L.notes.push({ id: k, room: rm.id, x: (q.x0 + q.x1) / 2 + (r() - 0.5), y: 0.005, z: (q.z0 + q.z1) / 2 + (r() - 0.5), rot: r() * 6.28, read: false }); }
  }
  // creaking boards: one or two per room, out on the open floor
  for (const rm of L.rooms) {
    const q = inner(L, rm), n = rm.area >= 3 ? 2 : 1;
    for (let k = 0; k < n; k++) for (let tries = 0; tries < 20; tries++) {
      const x = q.x0 + 0.5 + r() * (q.x1 - q.x0 - 1), z = q.z0 + 0.5 + r() * (q.z1 - q.z0 - 1);
      if (L.props.some((p) => p.solid && p.box && x > p.box.x0 - 0.3 && x < p.box.x1 + 0.3 && z > p.box.z0 - 0.3 && z < p.box.z1 + 0.3)) continue;
      if (Math.hypot(x - L.start.x, z - L.start.z) < 2.5) continue;
      L.creaks.push({ x, z, r: 0.45, v: r() < 0.5 });
      break;
    }
  }
}

/* Rooms as a graph: who opens onto whom, and how many doorways apart. */
export function roomGraph(L) {
  const n = L.rooms.length, links = L.rooms.map(() => []);
  for (const d of L.doors) if (d.b >= 0 && !d.sealed) { links[d.a].push(d.b); links[d.b].push(d.a); }
  const hops = [];
  for (let s = 0; s < n; s++) {
    const h = new Array(n).fill(Infinity); h[s] = 0;
    const q = [s];
    while (q.length) { const c = q.shift(); for (const t of links[c]) if (h[t] === Infinity) { h[t] = h[c] + 1; q.push(t); } }
    hops.push(h);
  }
  return { links, hops };
}

/* ------------------------------------------------------------------ */
/* Collision                                                          */

/** Axis-aligned boxes for everything solid that never moves: walls
 * (with their doorways cut out) and furniture. Doors are separate — they open. */
export function blocksOf(L) {
  const out = [];
  for (const w of L.walls) {
    let a = w.a - w.t / 2;
    const end = w.b + w.t / 2;
    for (const h of w.holes) {
      // a window is wall to a body, and so is a doorway boarded up
      if (h.window !== undefined || (h.door !== undefined && L.doors[h.door].sealed)) continue;
      if (h.a > a) out.push(wallBox(w, a, h.a));
      a = h.b;
    }
    if (end > a) out.push(wallBox(w, a, end));
  }
  for (const p of L.props) if (p.solid && p.box) out.push({ x0: p.box.x0, x1: p.box.x1, z0: p.box.z0, z1: p.box.z1, prop: p.id, tall: p.tall });
  return out;
}
function wallBox(w, a, b) {
  return w.v ? { x0: w.c - w.t / 2, x1: w.c + w.t / 2, z0: a, z1: b, wall: true, tall: true } : { x0: a, x1: b, z0: w.c - w.t / 2, z1: w.c + w.t / 2, wall: true, tall: true };
}

/** The box a shut door fills in its doorway. */
export function doorBox(d) {
  const t = 0.12;
  return d.v ? { x0: d.x - t, x1: d.x + t, z0: d.z - d.w / 2, z1: d.z + d.w / 2, door: d.id, tall: true } : { x0: d.x - d.w / 2, x1: d.x + d.w / 2, z0: d.z - t, z1: d.z + t, door: d.id, tall: true };
}

export function roomAt(L, x, z) {
  const i = Math.floor(x / CELL), j = Math.floor(z / CELL);
  if (i < 0 || j < 0 || i >= GW || j >= GH) return -1;
  return L.cellRoom[j * GW + i];
}

/* ------------------------------------------------------------------ */
/* The house changes                                                  */

/**
 * When the fifth lamp is lit, the way back is not the way in: one doorway on
 * the shortest route to the front door is boarded up, a wall elsewhere is
 * broken through, and the furniture is not where it was. The front door must
 * stay reachable from everywhere — `connected` checks, and the change is
 * skipped rather than ever trapping anyone.
 */
export function alter(L, fromRoom, r, keep) {
  const fine = () => cutOff(L).length === 0 && (!keep || true);
  const caida = L.rooms.find((x) => x.type === "caida").id;
  const changes = { sealed: [], opened: [], moved: [] };
  // the route as it was: rooms from the last lamp to the caida
  const path = roomPath(L, fromRoom, caida);
  for (let k = 0; k + 1 < path.length && !changes.sealed.length; k++) {
    const d = L.doors.find((q) => !q.sealed && q.b >= 0 && ((q.a === path[k] && q.b === path[k + 1]) || (q.b === path[k] && q.a === path[k + 1])));
    // never the doorway someone is standing in
    if (!d || (keep && Math.hypot(d.x - keep.x, d.z - keep.z) < 2.5)) continue;
    d.sealed = true;
    L.blocks = blocksOf(L);
    // still one house: every lamp, closet, doorway and the front door on one floor
    if (connected(L) && fine()) changes.sealed.push(d.id);
    else { d.sealed = false; L.blocks = blocksOf(L); }
  }
  // a wall broken through somewhere that had none, near the middle of the way
  const adj = adjacency(L).filter((p) => !L.doors.some((d) => d.b >= 0 && ((d.a === p.a && d.b === p.b) || (d.a === p.b && d.b === p.a))));
  const mid = path.slice(1, -1);
  adj.sort((p, q) => (mid.includes(q.a) || mid.includes(q.b) ? 1 : 0) - (mid.includes(p.a) || mid.includes(p.b) ? 1 : 0) || r() - 0.5);
  for (const p of adj) {
    if (L.rooms[p.a].type === "banyo" || L.rooms[p.b].type === "banyo") continue;
    const before = L.doors.length;
    place(L, r, p);
    const d = L.doors[before];
    // a hole in the wall where nothing stands in the way of it
    const blocked = L.props.some((q) => q.solid && q.box && overlap(q.box, d.v ? { x0: d.x - 1, x1: d.x + 1, z0: d.z - 0.7, z1: d.z + 0.7 } : { x0: d.x - 0.7, x1: d.x + 0.7, z0: d.z - 1, z1: d.z + 1 }, 0));
    if (blocked) { L.doors.pop(); continue; }
    d.kind = "broken"; d.open = 1;
    changes.opened.push(d.id);
    break;
  }
  // the chairs have turned to face the way you will come
  for (const p of L.props) {
    if (!["chair", "rocking_chair", "gallinera", "armchair"].includes(p.kind)) continue;
    if (r() < 0.65) { p.rot = Math.atan2(L.exit.x - p.x, L.exit.z - p.z) + Math.PI; changes.moved.push(p.id); }
  }
  // and wall boxes change with the doorways
  walls2(L);
  L.blocks = blocksOf(L);
  L.graph = roomGraph(L);
  return changes;
}

function walls2(L) {
  // a sealed doorway keeps its hole (the boards are drawn across it; blocksOf
  // makes it solid), and a broken-through wall gets a new one
  for (const w of L.walls) {
    for (const d of L.doors) if (!d.sealed && d.kind === "broken" && d.v === w.v && Math.abs((d.v ? d.x : d.z) - w.c) < 1e-6 && !w.holes.some((h) => h.door === d.id)) {
      const at = d.v ? d.z : d.x;
      if (at > w.a && at < w.b) w.holes.push({ door: d.id, a: at - d.w / 2, b: at + d.w / 2, y0: 0, y1: DOOR_H });
    }
    w.holes.sort((p, q) => p.a - q.a);
  }
}

export function roomPath(L, from, to) {
  const g = roomGraph(L);
  const prev = new Array(L.rooms.length).fill(-1), seen = new Set([from]), q = [from];
  while (q.length) { const c = q.shift(); if (c === to) break; for (const t of g.links[c]) if (!seen.has(t)) { seen.add(t); prev[t] = c; q.push(t); } }
  const out = [to];
  while (out[0] !== from && prev[out[0]] >= 0) out.unshift(prev[out[0]]);
  return out[0] === from ? out : [from];
}

export function connected(L) {
  const g = roomGraph(L);
  return g.hops[0].every((h) => h < Infinity);
}

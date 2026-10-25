/* scenery.js — everything on the land that people put there, and the
 * weather moving over it.
 *
 * The huts are built in code from the layout (places.js): corrugated sheet
 * outside, planks inside, on stilts, with a door that swings and windows the
 * low sun comes through, and the snow drifted up against the windward wall.
 * Boxes with world-sized UVs, merged per material — Last Flame's Acc and
 * carve() (lastflame/js/render.js), lifted. In them and round them, the Poly
 * Haven models where places.js put them.
 *
 * The beacons: a tripod of steel pipe with a fire basket, or the station's
 * tower. Lit, each is flames, a glow, a column of smoke the wind leans over,
 * and — for anyone far away — a point of light that does not shrink with
 * distance: a small quiet glow in daylight, a bright point across the whole
 * coast in the polar night. The nearest few have real lights.
 *
 * Footprints are pressed into the snow behind you, and the wind fills them
 * in: the stronger it blows, the sooner the world forgets you. When a
 * whiteout clears, they are gone. */

import * as THREE from "three";
import { mergeGeometries } from "../vendor/jsm/utils/BufferGeometryUtils.js";
import * as T from "./textures.js";
import { heightAt, normalAt, SEA_ICE_Y } from "./world.js";
import { CAT, hutLocal } from "./places.js";

let C = null;              // { scene, camera, renderer, lit, tex, bind, tpl }
let quality = "high";
let root = null, propsGroup = null, G = null;
const M = {};
const H = { huts: [], props: [], beacons: [], flags: [], masts: [], posts: [], cairns: [], loose: [], holes: [], stoves: [], tents: [] };
let water = null, prints = null, drift = null, fall = null, breath = null, rareSprite = null, answerSprite = null;
const fireLights = [], stoveLight = { l: null };
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpS = new THREE.Vector3(), tmpN = {};
let printI = 0, printDrift = 0, breathT = 2;

/* ------------------------------------------------------------------ */
/* Setup                                                              */

export function init(ctx) {
  C = ctx;
  materials();
  // the fires' lights: a fixed pool, so the number of lights never changes
  // (a change recompiles every shader, and would land on the moment a beacon catches)
  for (let i = 0; i < 3; i++) { const l = new THREE.PointLight("#ff8a3a", 0, 60, 2); C.scene.add(l); fireLights.push(l); }
  stoveLight.l = new THREE.PointLight("#ff7a30", 0, 9, 2);
  C.scene.add(stoveLight.l);
  waterMesh();
  particles();
  printsMesh();
  breathSprite();
  rareSprite = farSprite("#ffd9a8");
  answerSprite = farSprite("#ffe2b8");
  C.scene.add(rareSprite, answerSprite);
}

function std(o) { return C.lit(new THREE.MeshStandardMaterial(o)); }
function pbr(name, o, scale) {
  const m = std(Object.assign({ roughness: 1, metalness: 0 }, o || {}));
  C.bind(name, "c", (t) => { m.map = t; m.needsUpdate = true; });
  C.bind(name, "n", (t) => { m.normalMap = t; m.needsUpdate = true; });
  C.bind(name, "arm", (t) => { m.roughnessMap = t; m.aoMap = t; m.needsUpdate = true; });
  void scale;
  return m;
}
function materials() {
  M.hutRed = pbr("hut_red", { metalness: 0.25, color: "#ffffff" });
  M.hutGrey = pbr("hut_grey", { metalness: 0.55, color: "#d8dde2" });
  M.planks = pbr("planks", { color: "#d8cbb8" });
  M.floor = pbr("floor", { color: "#c9b8a8" });
  M.metal = pbr("metal", { metalness: 0.6, color: "#9c9590" });
  M.wood = pbr("planks", { color: "#b49a7a" });
  M.trim = std({ color: "#2b2723", roughness: 0.6, metalness: 0.2 });
  M.dark = std({ color: "#0a0a0c", roughness: 1 });
  M.glass = std({ color: "#1b2530", roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.55, depthWrite: false });
  M.snow = std({ color: "#eef3fa", roughness: 0.85 });
  C.bind("snow_soft", "n", (t) => { M.snow.normalMap = t; M.snow.needsUpdate = true; });
  M.bamboo = std({ color: "#b3965a", roughness: 0.7 });
  M.canvasY = std({ map: T.canvasCloth("yellow"), roughness: 0.95, side: THREE.DoubleSide });
  M.canvasO = std({ map: T.canvasCloth("orange"), roughness: 0.95, side: THREE.DoubleSide });
  M.flagR = wave(std({ map: T.flagCloth("red"), roughness: 0.8, side: THREE.DoubleSide }));
  M.flagG = wave(std({ map: T.flagCloth("green"), roughness: 0.8, side: THREE.DoubleSide }));
  M.water = std({ color: "#06121b", roughness: 0.06, metalness: 0.0, normalMap: T.ripples(), normalScale: new THREE.Vector2(0.35, 0.35) });
  M.water.normalMap.repeat.set(1, 1);
  M.water.userData.patch = (sh) => {
    sh.uniforms.wTime = WAVE.time;
    sh.fragmentShader = "uniform float wTime;\n" + sh.fragmentShader.replace("#include <normal_fragment_maps>", `
      {
        vec3 wp = ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz + cameraPosition;
        vec3 a = texture2D( normalMap, wp.xz / 9.0 + vec2( wTime * 0.013, wTime * 0.007 ) ).xyz * 2.0 - 1.0;
        vec3 b = texture2D( normalMap, wp.xz / 23.0 - vec2( wTime * 0.005, wTime * 0.011 ) ).xyz * 2.0 - 1.0;
        vec3 nW = normalize( vec3( ( a.x + b.x ) * normalScale.x, 1.0, ( a.y + b.y ) * normalScale.y ) );
        normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
      }`);
  };
  M.water.userData.patchKey = "water";
  C.lit(M.water);
  M.rope = new THREE.LineBasicMaterial({ color: "#3a3a3a", transparent: true, opacity: 0.7 });
  M.flame = new THREE.SpriteMaterial({ map: T.flame(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  M.glow = new THREE.SpriteMaterial({ map: C.glow, color: "#ff8a35", blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6, fog: false });
  M.slush = new THREE.MeshBasicMaterial({ map: T.slush(), transparent: true, depthWrite: false, fog: true });
}

/* Cloth that flaps: a vertex shader pushes the fly end about in the wind. */
const WAVE = { time: { value: 0 }, wind: { value: 0.3 } };
function wave(m) {
  m.userData.patch = (sh) => {
    sh.uniforms.wTime = WAVE.time; sh.uniforms.wWind = WAVE.wind;
    sh.vertexShader = "uniform float wTime, wWind;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      float fly = uv.x;
      float ph = wTime * ( 6.0 + wWind * 9.0 ) - uv.x * 7.0 + position.y * 3.0 + modelMatrix[3][0];
      transformed.z += sin( ph ) * fly * ( 0.04 + 0.11 * wWind );
      transformed.y += cos( ph * 0.7 ) * fly * 0.03 * wWind - fly * 0.08 * ( 1.0 - wWind );`);
  };
  m.userData.patchKey = "wave";
  return m;
}

/* ------------------------------------------------------------------ */
/* Box geometry with world-sized UVs (Last Flame's Acc, lifted)          */

class Acc {
  constructor() { this.p = []; this.n = []; this.u = []; }
  quad(a, b, c, d, n, ua, ub, uc, ud) {
    for (const [v, uv] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]) { this.p.push(v[0], v[1], v[2]); this.n.push(n[0], n[1], n[2]); this.u.push(uv[0], uv[1]); }
  }
  /* A box, UVs in metres divided by `s` (the texture's size in metres). skip: faces to leave out. */
  box(x0, y0, z0, x1, y1, z1, s, skip) {
    skip = skip || "";
    const k = 1 / (s || 1);
    if (!skip.includes("+x")) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], [-z1 * k, y0 * k], [-z0 * k, y0 * k], [-z0 * k, y1 * k], [-z1 * k, y1 * k]);
    if (!skip.includes("-x")) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], [z0 * k, y0 * k], [z1 * k, y0 * k], [z1 * k, y1 * k], [z0 * k, y1 * k]);
    if (!skip.includes("+z")) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], [x0 * k, y0 * k], [x1 * k, y0 * k], [x1 * k, y1 * k], [x0 * k, y1 * k]);
    if (!skip.includes("-z")) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], [-x1 * k, y0 * k], [-x0 * k, y0 * k], [-x0 * k, y1 * k], [-x1 * k, y1 * k]);
    if (!skip.includes("+y")) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [x0 * k, -z1 * k], [x1 * k, -z1 * k], [x1 * k, -z0 * k], [x0 * k, -z0 * k]);
    if (!skip.includes("-y")) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [x0 * k, z0 * k], [x1 * k, z0 * k], [x1 * k, z1 * k], [x0 * k, z1 * k]);
  }
  /* A triangle, both faces. */
  tri(a, b, c, s) {
    const k = 1 / (s || 1);
    const u = (v) => [(v[0] + v[2]) * k, v[1] * k];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(...n) || 1;
    for (const [v, nn] of [[a, 1], [b, 1], [c, 1]]) { this.p.push(...v); this.n.push(n[0] / l * nn, n[1] / l * nn, n[2] / l * nn); this.u.push(...u(v)); }
    for (const v of [a, c, b]) { this.p.push(...v); this.n.push(-n[0] / l, -n[1] / l, -n[2] / l); this.u.push(...u(v)); }
  }
  geo() {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
    return g;
  }
}
/* A rectangle of wall with a hole taken out of it: up to four rectangles. (Last Flame's.) */
function carve(rects, h) {
  const out = [];
  for (const q of rects) {
    const [p0, p1, y0, y1] = q;
    if (h.b <= p0 || h.a >= p1 || h.y1 <= y0 || h.y0 >= y1) { out.push(q); continue; }
    const a = Math.max(p0, h.a), b = Math.min(p1, h.b), c = Math.max(y0, h.y0), d = Math.min(y1, h.y1);
    if (a > p0) out.push([p0, a, y0, y1]);
    if (b < p1) out.push([b, p1, y0, y1]);
    if (c > y0) out.push([a, b, y0, c]);
    if (d < y1) out.push([a, b, d, y1]);
  }
  return out;
}
function meshOf(acc, mat, shadow) {
  const g = acc.geo();
  if (!g) return null;
  const m = new THREE.Mesh(g, mat);
  m.castShadow = shadow !== false; m.receiveShadow = true;
  return m;
}

/* ------------------------------------------------------------------ */
/* Building a journey's scenery                                       */

export function build(g) {
  G = g;
  if (root) { C.scene.remove(root); root.traverse((o) => { if (o.isMesh && o.geometry && !o.userData.shared) o.geometry.dispose(); }); }
  root = new THREE.Group();
  root.name = "scenery";
  C.scene.add(root);
  for (const k in H) H[k] = [];
  const P = g.P, W = g.W;
  for (const h of P.huts) H.huts[h.id] = hutMesh(h, W);
  propsGroup = new THREE.Group(); root.add(propsGroup);
  props();
  for (const b of W.beacons) H.beacons[b.id] = beaconMesh(b, W);
  for (const f of P.flags) H.flags.push(flagMesh(f));
  for (const t of P.tents) H.tents.push(tentMesh(t));
  for (const s of P.sleds) sledMesh(s);
  for (const m of P.masts) H.masts[m.id] = mastMesh(m, W);
  for (const q of P.posts) H.posts[q.id] = postMesh(q);
  for (const c of P.cairns) H.cairns[c.id] = cairnMesh(c);
  for (const l of P.loose) H.loose[l.id] = stoneMesh(l.kind, l.x, l.y, l.z, l.rot, 3.2);
  // already burning when the journey was saved: no catching, just fire
  for (let i = 0; i < H.beacons.length; i++) if (g.lit[i]) H.beacons[i].litT = 10;
  for (const h of P.holes) H.holes[h.id] = holeMesh(h);
  clearPrints();
  rareSprite.visible = false; answerSprite.visible = false;
}

/* When the models change (Packed <-> Full) the scenery is built again: it
   holds no state of its own that the game does not (draw() reads it all). */
export function rebuildProps() { if (G) build(G); }

function props() {
  for (const q of G.P.props) {
    const o = model(q.kind);
    o.position.set(q.x, q.y, q.z);
    o.rotation.y = q.rot;
    o.scale.setScalar(q.scale || 1);
    if (q.onPost) {
      // a lifebuoy on a post by the shore
      o.position.y = q.y + 1.25;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.6, 8), M.wood);
      post.position.set(q.x, q.y + 0.8, q.z); post.castShadow = true;
      root.add(post);
      o.position.z += 0.08;
    }
    o.userData.q = q;
    o.visible = !G.taken[q.id];
    propsGroup.add(o);
    H.props[q.id] = o;
  }
}

function model(kind) {
  const t = C.tpl[kind];
  if (t) { const c = t.clone(true); c.traverse((o) => { if (o.isMesh) o.userData.shared = true; }); return c; }
  // until (or unless) the model arrives: a box its size
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), M.metal);
  m.position.y = 0.15;
  const grp = new THREE.Group(); grp.add(m);
  return grp;
}

/* A hut: floor, walls with their holes, a pitched roof, stilts, steps, a door. */
function hutMesh(h, W) {
  const grp = new THREE.Group();
  grp.position.set(h.x, h.floor, h.z);
  grp.rotation.y = h.rot;
  root.add(grp);
  const w = h.w / 2, d = h.d / 2, Ht = h.h, T = 0.07, roofH = 0.5;
  const outer = new Acc(), inner = new Acc(), floor = new Acc(), trim = new Acc(), metal = new Acc(), glass = new Acc(), snow = new Acc();
  const dl = h.door.off - h.door.w / 2, dr = h.door.off + h.door.w / 2, DH = 2.0;
  const win = (a, b) => ({ a, b, y0: 1.0, y1: 1.65 });
  const holes = { front: [{ a: dl, b: dr, y0: -1, y1: DH }], back: [], left: [], right: [] };
  if (h.w > 4) { const wx = h.door.off > 0 ? -w / 2 : w / 2; holes.front.push(win(wx - 0.38, wx + 0.38)); holes.back.push(win(-0.45, 0.45)); }
  if (h.d > 3.5) holes.left.push(win(-0.35, 0.35));
  // a wall along its own axis s (x for front/back, z for left/right) at offset c
  const wall = (side, s0, s1, c, sign) => {
    let pieces = [[s0, s1, 0, Ht]];
    for (const ho of holes[side]) pieces = carve(pieces, ho);
    for (const [a, b, y0, y1] of pieces) {
      if (b - a < 0.005 || y1 - y0 < 0.005) continue;
      if (side === "front" || side === "back") {
        outer.box(a - (a <= s0 + 1e-3 ? T : 0), y0, sign > 0 ? c : c - T, b + (b >= s1 - 1e-3 ? T : 0), y1, sign > 0 ? c + T : c, 2);
        inner.box(a, y0, sign > 0 ? c - 0.03 : c, b, y1, sign > 0 ? c : c + 0.03, 2.2);
      } else {
        outer.box(sign > 0 ? c : c - T, y0, a, sign > 0 ? c + T : c, y1, b, 2);
        inner.box(sign > 0 ? c - 0.03 : c, y0, a, sign > 0 ? c : c + 0.03, y1, b, 2.2);
      }
    }
    // frames and glass in the holes
    for (const ho of holes[side]) {
      const fw = 0.06, y1 = ho.y1, y0 = Math.max(0, ho.y0);
      const fr = (a, b, ya, yb) => { if (side === "front" || side === "back") trim.box(a, ya, c - 0.06, b, yb, c + T + 0.02, 1); else trim.box(c - 0.06, ya, a, c + T + 0.02, yb, b, 1); };
      fr(ho.a - fw, ho.a, y0, y1 + fw); fr(ho.b, ho.b + fw, y0, y1 + fw); fr(ho.a - fw, ho.b + fw, y1, y1 + fw);
      if (ho.y0 > 0) {
        fr(ho.a - fw, ho.b + fw, y0 - fw, y0);
        if (side === "front" || side === "back") glass.box(ho.a, y0, c + T * 0.4, ho.b, y1, c + T * 0.5, 1);
        else glass.box(c + T * 0.4, y0, ho.a, c + T * 0.5, y1, ho.b, 1);
      }
    }
  };
  wall("front", -w, w, d, 1); wall("back", -w, w, -d, -1); wall("left", -d, d, -w, -1); wall("right", -d, d, w, 1);
  // the gables over the short walls, and the roof
  for (const sx of [-1, 1]) { const x = sx * (w + T * 0.5); outer.tri([x, Ht, -d - T], [x, Ht, d + T], [x, Ht + roofH, 0], 2); }
  const eave = 0.3, rt = 0.05;
  for (const sz of [-1, 1]) {
    const z0 = sz * (d + eave), y0 = Ht - eave * (roofH / d), y1 = Ht + roofH;
    const a = [-w - eave, y0, z0], b = [w + eave, y0, z0], c = [w + eave, y1, 0], e = [-w - eave, y1, 0];
    const n = [0, d, sz * roofH], nl = Math.hypot(...n); n[0] /= nl; n[1] /= nl; n[2] /= nl;
    const L = Math.hypot(d + eave, roofH + eave * (roofH / d)) / 2;
    if (sz > 0) outer.quad(a, b, c, e, n, [-w / 2, 0], [w / 2, 0], [w / 2, L], [-w / 2, L]);
    else outer.quad(b, a, e, c, n, [w / 2, 0], [-w / 2, 0], [-w / 2, L], [w / 2, L]);
    // its underside
    const dn = [-n[0], -n[1], -n[2]], lo = (v) => [v[0], v[1] - rt, v[2]];
    if (sz > 0) metal.quad(lo(b), lo(a), lo(e), lo(c), dn, [0, 0], [1, 0], [1, 1], [0, 1]);
    else metal.quad(lo(a), lo(b), lo(c), lo(e), dn, [0, 0], [1, 0], [1, 1], [0, 1]);
    // a crust of snow on the windward slope
    const windward = (sz * Math.cos(h.rot) * -W.wind.z + sz * Math.sin(h.rot) * -W.wind.x) > 0;
    if (windward) snow.quad([a[0] + 0.3, a[1] + 0.04, a[2] * 0.97], [b[0] - 0.3, b[1] + 0.04, b[2] * 0.97], [c[0] - 0.4, c[1] - 0.12, z0 * 0.3], [e[0] + 0.4, e[1] - 0.12, z0 * 0.3], n, [0, 0], [1, 0], [1, 1], [0, 1]);
  }
  // the ceiling and the floor
  inner.box(-w, Ht - 0.04, -d, w, Ht, d, 2.2, "+y+x-x+z-z");
  floor.box(-w, -0.12, -d, w, 0, d, 2.2, "-y");
  metal.box(-w - 0.02, -0.3, -d - 0.02, w + 0.02, -0.12, d + 0.02, 1, "+y");
  // corner posts
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) trim.box(sx * w - 0.05 + sx * T * 0.5, 0, sz * d - 0.05 + sz * T * 0.5, sx * w + 0.05 + sx * T * 0.5, Ht, sz * d + 0.05 + sz * T * 0.5, 1);
  // stilts down to the snow, and steps to the door
  const toLocalY = (lx, lz) => { const c = Math.cos(h.rot), s = Math.sin(h.rot); return heightAt(W, h.x + lx * c + lz * s, h.z - lx * s + lz * c) - h.floor; };
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) {
    const lx = sx * (w - 0.15), lz = sz * (d - 0.15), gy = toLocalY(lx, lz);
    metal.box(lx - 0.06, gy - 0.3, lz - 0.06, lx + 0.06, -0.3, lz + 0.06, 1);
  }
  const gy = toLocalY(h.door.off, d + 0.5);
  if (gy < -0.15) for (let k = 0; k < 2; k++) {
    const yy = gy + (-gy) * (k + 1) / 3;
    metal.box(dl, gy - 0.2, d + 0.12 + (1 - k) * 0.28, dr, yy, d + 0.4 + (1 - k) * 0.28, 1);
  }
  // a drift against the windward wall
  {
    const ws = [[0, -1, "back"], [0, 1, "front"], [-1, 0, "left"], [1, 0, "right"]];
    let best = null, bd = -2;
    for (const [sx, sz, name] of ws) {
      const c = Math.cos(h.rot), s = Math.sin(h.rot);
      const nx = sx * c + sz * s, nz = -sx * s + sz * c;
      const dot = -(nx * W.wind.x + nz * W.wind.z);
      if (dot > bd && name !== "front") { bd = dot; best = [sx, sz]; }
    }
    if (best) {
      const [sx, sz] = best, len = sx ? d : w, out = 1.6, hgt = 0.75;
      const base = toLocalY(sx * (w + 0.8), sz * (d + 0.8)) - 0.05;
      const P0 = (s, o, y) => (sx ? [sx * (w + T + o), y, s] : [s, y, sz * (d + T + o)]);
      const n = sx ? [sx * hgt, out, 0] : [0, out, sz * hgt];
      const nl = Math.hypot(...n);
      const nn = [n[0] / nl, n[1] / nl, n[2] / nl];
      const A = P0(-len - 0.6, out, base), B = P0(len + 0.6, out, base), Cc = P0(len, 0, Math.max(base, -0.25) + hgt), D = P0(-len, 0, Math.max(base, -0.25) + hgt);
      if ((sx || sz) > 0) snow.quad(A, B, Cc, D, nn, [0, 0], [1, 0], [1, 1], [0, 1]); else snow.quad(B, A, D, Cc, nn, [0, 0], [1, 0], [1, 1], [0, 1]);
      snow.tri(A, D, P0(-len - 0.6, 0, base), 1); snow.tri(B, Cc, P0(len + 0.6, 0, base), 1);
    }
  }
  const mat = h.color === "red" ? M.hutRed : M.hutGrey;
  for (const [acc, m, sh] of [[outer, mat], [inner, M.planks], [floor, M.floor], [trim, M.trim], [metal, M.metal], [glass, M.glass, false], [snow, M.snow]]) {
    const me = meshOf(acc, m, sh);
    if (me) grp.add(me);
  }
  // the door: a leaf on its hinge, swinging out
  const pivot = new THREE.Group();
  pivot.position.set(dl, 0, d + T);
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(h.door.w - 0.02, DH - 0.02, 0.05), mat);
  leaf.position.set((h.door.w - 0.02) / 2, DH / 2, -0.02);
  leaf.castShadow = true; leaf.receiveShadow = true;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.05), M.trim);
  handle.position.set(h.door.w - 0.12, DH * 0.5, 0.03);
  pivot.add(leaf, handle);
  grp.add(pivot);
  return { grp, pivot, a: 0 };
}

/* A beacon: a tripod of pipe with a basket on top; at the station, a tower. */
function beaconMesh(b, W) {
  const grp = new THREE.Group();
  const y = heightAt(W, b.x, b.z);
  grp.position.set(b.x, y, b.z);
  root.add(grp);
  const H0 = b.big ? 7.5 : 3.1;
  const parts = [];
  const pipe = (x0, y0, z0, x1, y1, z1, r) => {
    const a = new THREE.Vector3(x0, y0, z0), c = new THREE.Vector3(x1, y1, z1), l = a.distanceTo(c);
    const g = new THREE.CylinderGeometry(r, r, l, 6, 1);
    g.translate(0, l / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize());
    g.applyQuaternion(q); g.translate(x0, y0, z0);
    parts.push(g);
  };
  const legs = b.big ? 4 : 3, spread = b.big ? 1.6 : 0.9;
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * Math.PI * 2 + 0.3;
    pipe(Math.cos(a) * spread, -0.3, Math.sin(a) * spread, Math.cos(a) * 0.32, H0 - 0.25, Math.sin(a) * 0.32, b.big ? 0.07 : 0.04);
    if (b.big) for (let k = 1; k < 4; k++) {
      const t0 = k / 4, a2 = ((i + 1) / legs) * Math.PI * 2 + 0.3;
      const r0 = spread + (0.32 - spread) * t0;
      pipe(Math.cos(a) * r0, -0.3 + (H0) * t0, Math.sin(a) * r0, Math.cos(a2) * r0, -0.3 + H0 * t0, Math.sin(a2) * r0, 0.035);
    }
  }
  // the basket: a ring of bars round a grate
  const bR = b.big ? 0.75 : 0.42, bH = b.big ? 0.7 : 0.45;
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; pipe(Math.cos(a) * bR * 0.75, H0 - 0.25, Math.sin(a) * bR * 0.75, Math.cos(a) * bR, H0 + bH, Math.sin(a) * bR, 0.018); }
  const ring = new THREE.TorusGeometry(bR, 0.025, 4, 18); ring.rotateX(Math.PI / 2); ring.translate(0, H0 + bH, 0); parts.push(ring);
  const grate = new THREE.CylinderGeometry(bR * 0.75, bR * 0.72, 0.06, 14); grate.translate(0, H0 - 0.25, 0); parts.push(grate);
  const geo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  const mesh = new THREE.Mesh(geo, M.metal);
  mesh.castShadow = true; mesh.receiveShadow = true;
  grp.add(mesh);
  // the fuel in the basket: dark lumps, unlit
  const fuel = new THREE.Mesh(new THREE.CylinderGeometry(bR * 0.62, bR * 0.7, 0.2, 10), M.dark);
  fuel.position.y = H0 - 0.12; grp.add(fuel);
  // the fire, waiting
  const fire = new THREE.Group();
  fire.position.y = H0 + 0.05;
  const flames = [];
  for (let i = 0; i < (b.big ? 5 : 3); i++) { const f = new THREE.Sprite(M.flame.clone()); f.userData.ph = i * 1.7; fire.add(f); flames.push(f); }
  const glow = new THREE.Sprite(M.glow.clone()); glow.scale.setScalar(b.big ? 6 : 3.5); fire.add(glow);
  const far = farSprite("#ffb070"); far.position.y = 0.4; fire.add(far);
  const smoke = smokeColumn(b.big ? 1.6 : 1);
  fire.add(smoke);
  fire.visible = false;
  grp.add(fire);
  return { grp, fire, flames, glow, far, smoke, y: y + H0, big: b.big, litT: -1, x: b.x, z: b.z };
}

/* A light seen from far away: a point that keeps its size on screen. */
function farSprite(color) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, sizeAttenuation: false, fog: false }));
  s.scale.set(0.02, 0.02, 1);
  s.renderOrder = 5;
  return s;
}

/* Smoke: puffs rising and leaning downwind, drawn by the GPU from a seed each. */
const SMOKE = { time: { value: 0 }, wind: { value: new THREE.Vector2(0, 1) }, windK: { value: 0.3 }, light: { value: new THREE.Color("#ffffff") } };
let smokeTex = null;
function smokeColumn(k) {
  const n = 46, seed = new Float32Array(n);
  for (let i = 0; i < n; i++) seed[i] = i / n;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  if (!smokeTex) smokeTex = T.smoke();
  const m = new THREE.ShaderMaterial({
    uniforms: Object.assign({ map: { value: smokeTex }, k: { value: k }, op: { value: 1 } }, SMOKE),
    vertexShader: `attribute float aSeed; uniform float time, windK, k; uniform vec2 wind; varying float vA;
      void main() {
        float life = 26.0, age = mod( time + aSeed * life, life ), t = age / life;
        vec3 p = vec3( sin( aSeed * 91.0 ) * 0.2, age * ( 1.4 + 0.6 * k ) * ( 1.0 - windK * 0.5 ), cos( aSeed * 57.0 ) * 0.2 );
        p.xz += wind * pow( age, 1.25 ) * ( 0.3 + windK * 2.6 );
        vec4 mv = modelViewMatrix * vec4( p, 1.0 );
        gl_Position = projectionMatrix * mv;
        gl_PointSize = ( 1.2 + t * 7.0 ) * k * 300.0 / max( 1.0, - mv.z );
        vA = smoothstep( 0.0, 0.08, t ) * ( 1.0 - t ) * 0.55;
      }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 light; uniform float op; varying float vA;
      void main() { vec4 c = texture2D( map, gl_PointCoord ); gl_FragColor = vec4( light * 0.62, c.a * vA * op ); }`,
    transparent: true, depthWrite: false
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

/* A route flag: a bamboo stake, a scrap of nylon. */
let poleGeo = null, flagGeo = null;
function flagMesh(f) {
  if (!poleGeo) { poleGeo = new THREE.CylinderGeometry(0.012, 0.016, 2.2, 5); poleGeo.translate(0, 1.1, 0); flagGeo = new THREE.PlaneGeometry(0.42, 0.3, 8, 3); flagGeo.translate(0.21, 0, 0); }
  const grp = new THREE.Group();
  grp.position.set(f.x, f.y - f.buried, f.z);
  grp.rotation.set(0, f.rot, f.lean);
  const pole = new THREE.Mesh(poleGeo, M.bamboo); pole.castShadow = true; pole.userData.shared = true;
  const flag = new THREE.Mesh(flagGeo, f.color === "red" ? M.flagR : M.flagG); flag.position.y = 2.0; flag.castShadow = true; flag.userData.shared = true;
  grp.add(pole, flag);
  root.add(grp);
  return { grp, flag };
}

/* A polar pyramid tent, pitched, with its snow valance and guy lines. */
function tentMesh(t) {
  const grp = new THREE.Group();
  grp.position.set(t.x, t.y, t.z); grp.rotation.y = t.rot;
  const g = new THREE.ConeGeometry(1.35, 2.3, 4, 1, true); g.rotateY(Math.PI / 4); g.translate(0, 1.15, 0);
  const m = new THREE.Mesh(g, t.color === "orange" ? M.canvasO : M.canvasY); m.castShadow = true; m.receiveShadow = true;
  const val = new THREE.Mesh(new THREE.CylinderGeometry(1.55, 1.8, 0.35, 4, 1, true), M.snow); val.rotation.y = Math.PI / 4; val.position.y = 0.12; val.castShadow = true;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.9), M.dark); door.position.set(0, 0.55, 0.62); door.rotation.x = -0.5;
  const pts = [];
  for (let i = 0; i < 4; i++) { const a = (i / 4) * Math.PI * 2 + Math.PI / 4; pts.push(0, 2.1, 0, Math.cos(a) * 2.8, -0.1, Math.sin(a) * 2.8); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  grp.add(m, val, door, new THREE.LineSegments(lg, M.rope));
  root.add(grp);
  return grp;
}

/* A Nansen sledge, left where it stuck: runners, slats, a load lashed on. */
function sledMesh(s) {
  const grp = new THREE.Group();
  grp.position.set(s.x, s.y - 0.12, s.z); grp.rotation.set(0.04, s.rot, -0.05);
  const a = new Acc();
  for (const sx of [-0.36, 0.36]) { a.box(sx - 0.03, 0, -1.4, sx + 0.03, 0.06, 1.3, 1); a.box(sx - 0.03, 0.06, 1.25, sx + 0.03, 0.3, 1.36, 1); }
  for (let k = 0; k < 7; k++) { const z = -1.3 + k * 0.42; a.box(-0.42, 0.28, z - 0.04, 0.42, 0.31, z + 0.04, 1); for (const sx of [-0.36, 0.36]) a.box(sx - 0.02, 0.06, z - 0.02, sx + 0.02, 0.28, z + 0.02, 1); }
  const m = meshOf(a, M.wood); grp.add(m);
  const crate = model("crate_open"); crate.position.set(0, 0.31, -0.35); crate.rotation.y = Math.PI / 2; crate.scale.setScalar(0.85); grp.add(crate);
  const can = model("jerrycan"); can.position.set(0.15, 0.31, 0.75); grp.add(can);
  // half drifted over
  const d = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.snow); d.scale.set(0.9, 0.35, 1.3); d.position.set(-0.6, 0, -0.4); d.receiveShadow = true;
  grp.add(d);
  root.add(grp);
}

/* Masts: the base's flagpole, a weather mast, the station's radio mast. */
function mastMesh(m, W) {
  const grp = new THREE.Group();
  const y = heightAt(W, m.x, m.z);
  grp.position.set(m.x, y, m.z);
  root.add(grp);
  const arm = new THREE.Group();     // what falls over and stands up again
  grp.add(arm);
  let flag = null, cups = null;
  if (m.kind === "flagpole") {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, m.h, 8), M.metal); pole.position.y = m.h / 2; pole.castShadow = true;
    flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.8, 12, 4), M.flagR); flag.geometry.translate(0.6, 0, 0); flag.position.y = m.h - 0.5; flag.castShadow = true;
    arm.add(pole, flag);
  } else {
    // a lattice: three legs and their zigzag
    const parts = [], H0 = m.h, r = m.kind === "radio" ? 0.35 : 0.18;
    const pipe = (a, b, rr) => { const l = a.distanceTo(b); const g = new THREE.CylinderGeometry(rr, rr, l, 5); g.translate(0, l / 2, 0); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())); g.translate(a.x, a.y, a.z); parts.push(g); };
    const leg = (i, yy) => new THREE.Vector3(Math.cos(i * 2.094) * r, yy, Math.sin(i * 2.094) * r);
    for (let i = 0; i < 3; i++) pipe(leg(i, 0), leg(i, H0), 0.025);
    for (let yy = 0, k = 0; yy < H0 - 0.5; yy += 0.6, k++) for (let i = 0; i < 3; i++) pipe(leg(i, yy), leg(i + 1, yy + 0.6), 0.01);
    const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
    const lat = new THREE.Mesh(geo, M.metal); lat.castShadow = true;
    arm.add(lat);
    if (m.kind === "weather") {
      cups = new THREE.Group(); cups.position.y = H0 + 0.15;
      for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6, 0, Math.PI), M.metal); c.position.set(Math.cos(i * 2.094) * 0.22, 0, Math.sin(i * 2.094) * 0.22); c.rotation.y = -i * 2.094; cups.add(c); }
      arm.add(cups);
    } else {
      // guy wires to the snow
      const pts = [];
      for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; pts.push(0, H0 * 0.85, 0, Math.cos(a) * H0 * 0.6, 0, Math.sin(a) * H0 * 0.6); }
      const lg = new THREE.BufferGeometry(); lg.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      grp.add(new THREE.LineSegments(lg, M.rope));
    }
  }
  const down = m.down ? 1 : 0;
  arm.rotation.z = down * 1.48;
  return { grp, arm, flag, cups, up: 1 - down, target: 1 - down, h: m.h };
}

/* A lantern post on the old route: a stake, an arm, a lantern hung from it. */
function postMesh(q) {
  const grp = new THREE.Group();
  grp.position.set(q.x, q.y, q.z);
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 0.08), M.wood); post.position.y = 1.05 - 0.15; post.castShadow = true;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.05), M.wood); arm.position.set(0.22, 1.85, 0); arm.castShadow = true;
  const lan = model("lantern"); lan.position.set(0.42, 1.52, 0);
  const flame = new THREE.Sprite(M.flame.clone()); flame.scale.set(0.035, 0.07, 1); flame.position.set(0.42, 1.64, 0); flame.visible = false;
  const glow = new THREE.Sprite(M.glow.clone()); glow.scale.setScalar(1.2); glow.position.copy(flame.position); glow.visible = false;
  const far = farSprite("#ffb070"); far.position.copy(flame.position); far.visible = false; far.scale.set(0.008, 0.008, 1);
  grp.add(post, arm, lan, flame, glow, far);
  root.add(grp);
  return { grp, flame, glow, far, lan };
}

/* A cairn: stones piled into a cone, as many as have been carried to it. */
function cairnMesh(c) {
  const grp = new THREE.Group();
  grp.position.set(c.x, c.y, c.z);
  root.add(grp);
  const stones = [];
  for (let i = 0; i < c.full; i++) {
    const layer = i < 4 ? 0 : i < 7 ? 1 : 2, inLayer = i < 4 ? i : i < 7 ? i - 4 : 0, n = layer === 0 ? 4 : layer === 1 ? 3 : 1;
    const a = (inLayer / n) * Math.PI * 2 + layer, r = layer === 0 ? 0.28 : layer === 1 ? 0.16 : 0;
    const s = stoneMesh(i % 2 ? "stone_a" : "stone_b", r ? Math.cos(a) * r : 0, layer * 0.2 + (layer === 2 ? 0.05 : 0), r ? Math.sin(a) * r : 0, a * 3.1 + i, layer === 2 ? 3.6 : 4.4 - layer * 0.5, grp);
    s.visible = i < (G ? G.cairns[c.id] : c.stones);
    stones.push(s);
  }
  return { grp, stones };
}
function stoneMesh(kind, x, y, z, rot, scale, parent) {
  const o = model(kind);
  o.position.set(x, y, z); o.rotation.set(rot * 0.3, rot, rot * 0.17); o.scale.setScalar(scale);
  (parent || root).add(o);
  return o;
}

/* A hole kept open in the sea ice: black water, a rim of slush, a bucket. */
function holeMesh(h) {
  const grp = new THREE.Group();
  grp.position.set(h.x, SEA_ICE_Y + 0.005, h.z);
  const w = new THREE.Mesh(new THREE.CircleGeometry(0.5, 20), M.water); w.rotation.x = -Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), M.slush); rim.rotation.x = -Math.PI / 2; rim.position.y = 0.01;
  const b = model("bucket"); b.position.set(0.9, 0, 0.3);
  grp.add(w, rim, b);
  root.add(grp);
  return grp;
}

/* The sea: one plane, following the eye; the land covers it wherever it is above water. */
function waterMesh() {
  water = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000, 1, 1), M.water);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.05;
  water.receiveShadow = true;
  C.scene.add(water);
}

/* ------------------------------------------------------------------ */
/* Footprints                                                         */

const PRINT = { drift: { value: 0 }, life: { value: 520 }, cut: { value: -1e9 } };
function printsMesh(cap) {
  cap = cap || (quality === "ultra" ? 4000 : quality === "low" ? 700 : 2000);
  if (prints) { C.scene.remove(prints); prints.geometry.dispose(); }
  const g = new THREE.PlaneGeometry(0.13, 0.31);
  g.rotateX(-Math.PI / 2);
  const born = new Float32Array(cap).fill(-1e9);
  g.setAttribute("aBorn", new THREE.InstancedBufferAttribute(born, 1));
  const m = new THREE.MeshStandardMaterial({ color: "#d6e2f0", roughness: 0.9, normalMap: T.bootprint(), normalScale: new THREE.Vector2(1.6, 1.6), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.userData.patch = (sh) => {
    Object.assign(sh.uniforms, PRINT);
    sh.vertexShader = "attribute float aBorn;\nuniform float drift, life, cut;\nvarying float vFade;\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\nvFade = aBorn < cut ? 0.0 : clamp( 1.0 - ( drift - aBorn ) / life, 0.0, 1.0 );");
    sh.fragmentShader = "varying float vFade;\n" + sh.fragmentShader.replace("#include <alphamap_fragment>", "#include <alphamap_fragment>\ndiffuseColor.a *= texture2D( normalMap, vNormalMapUv ).a * vFade;");
  };
  m.userData.patchKey = "prints";
  C.lit(m);
  prints = new THREE.InstancedMesh(g, m, cap);
  prints.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < cap; i++) prints.setMatrixAt(i, tmpM.makeScale(0, 0, 0));
  prints.frustumCulled = false;
  prints.receiveShadow = true;
  prints.renderOrder = 1;
  C.scene.add(prints);
  printI = 0;
}
function addPrint(e) {
  if (!prints) return;
  const W = G.W, cap = prints.count;
  const side = e.foot ? 1 : -1, yaw = e.yaw;
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
  const x = e.x + rx * side * 0.11, z = e.z + rz * side * 0.11;
  const n = normalAt(W, x, z, 0.25, tmpN);
  const up = tmpV.set(n.x, n.y, n.z);
  const fwd = tmpV2.set(fx, 0, fz);
  fwd.addScaledVector(up, -fwd.dot(up)).normalize();
  const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
  tmpM.makeBasis(right, up, fwd);
  tmpM.setPosition(x, heightAt(W, x, z) + 0.012, z);
  const s = e.brisk ? 1.06 : 1;
  tmpM.scale(tmpS.set(s, 1, s));
  const i = printI % cap;
  prints.setMatrixAt(i, tmpM);
  prints.geometry.attributes.aBorn.array[i] = printDrift;
  prints.geometry.attributes.aBorn.needsUpdate = true;
  prints.instanceMatrix.needsUpdate = true;
  printI++;
}
function clearPrints() { PRINT.cut.value = printDrift + 1e-3; }

/* ------------------------------------------------------------------ */
/* Snow in the air                                                    */

const AIR = { time: { value: 0 }, cam: { value: new THREE.Vector3() }, wind: { value: new THREE.Vector2(0, 1) }, windK: { value: 0.3 }, ground: { value: 0 }, white: { value: 0 }, light: { value: new THREE.Color("#ffffff") }, map: { value: null } };
function particles() {
  AIR.map.value = T.flake();
  const make = (n, box, hgt, low) => {
    const seed = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) seed[i] = Math.random();
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 3));
    const m = new THREE.ShaderMaterial({
      uniforms: Object.assign({ box: { value: box }, hgt: { value: hgt }, low: { value: low ? 1 : 0 } }, AIR),
      vertexShader: `attribute vec3 aSeed; uniform float time, box, hgt, low, windK, ground, white; uniform vec3 cam; uniform vec2 wind; varying float vA;
        void main() {
          float sp = ( low > 0.5 ? 2.0 + 9.0 * windK : 1.5 + 12.0 * windK ) * ( 0.6 + aSeed.y * 0.8 );
          vec3 p = aSeed * vec3( box, hgt, box );
          p.xz += wind * time * sp;
          p.y += low > 0.5 ? sin( time * 2.0 + aSeed.x * 40.0 ) * 0.15 : - time * ( 0.8 + aSeed.z ) ;
          p.y = mod( p.y, hgt );
          p.xz = mod( p.xz - cam.xz + box * 0.5, box ) - box * 0.5 + cam.xz;
          p.y += low > 0.5 ? ground : cam.y - hgt * 0.4;
          vec4 mv = modelViewMatrix * vec4( p, 1.0 );
          gl_Position = projectionMatrix * mv;
          float d = length( p.xz - cam.xz );
          float amount = low > 0.5 ? smoothstep( 0.25, 0.8, windK ) : white;
          vA = amount * smoothstep( box * 0.5, box * 0.2, d ) * ( low > 0.5 ? smoothstep( 1.6, 0.0, p.y - ground ) : 1.0 );
          gl_PointSize = ( low > 0.5 ? 0.06 : 0.05 ) * 300.0 / max( 0.3, - mv.z );
        }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 light; varying float vA;
        void main() { vec4 c = texture2D( map, gl_PointCoord ); gl_FragColor = vec4( light, c.a * vA * 0.8 ); }`,
      transparent: true, depthWrite: false
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    C.scene.add(pts);
    return pts;
  };
  const k = quality === "ultra" ? 2 : quality === "low" ? 0.4 : 1;
  if (drift) { C.scene.remove(drift); C.scene.remove(fall); }
  drift = make(Math.round(1400 * k), 46, 1.6, true);
  fall = make(Math.round(3500 * k), 44, 22, false);
}

/* Breath: in this cold, every breath out is a little cloud. */
function breathSprite() {
  breath = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.smoke(), color: "#ffffff", transparent: true, depthWrite: false, opacity: 0, fog: false }));
  breath.scale.setScalar(0.3);
  C.camera.add(breath);
}

/* ------------------------------------------------------------------ */
/* Events                                                             */

export function feed(events, g) {
  for (const e of events) {
    switch (e.type) {
      case "step": if (!e.floor && !e.rock) addPrint(e); break;
      case "clear": clearPrints(); break;
      case "beaconLit": { const b = H.beacons[e.beacon]; if (b) b.litT = 0; break; }
      case "rare": if (e.kind === "light" && g.rare.light) { rareSprite.position.set(g.rare.light.x, g.rare.light.y, g.rare.light.z); rareSprite.visible = true; rareSprite.userData.t = 0; } break;
      case "rareGone": rareSprite.visible = false; break;
      case "answer": answerSprite.position.set(e.x, g.P.answer.y, e.z); answerSprite.visible = true; answerSprite.userData.t = 0; break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* The frame                                                          */

export function draw(g, dt, k) {
  if (!root) return;
  const p = g.p, cam = k.camera, t = k.t;
  WAVE.time.value = t; WAVE.wind.value = Math.min(1, k.wind);
  // what the sun leaves on things in the air: lit by it, or by the sky after it has gone
  const skyLight = Math.max(0.05, k.strength) * (1 - k.night * 0.85);
  SMOKE.time.value = t; SMOKE.wind.value.set(g.W.wind.x, g.W.wind.z); SMOKE.windK.value = k.wind; SMOKE.light.value.setRGB(skyLight, skyLight, skyLight * 1.04);
  AIR.time.value = t; AIR.cam.value.copy(cam.position); AIR.wind.value.set(g.W.wind.x, g.W.wind.z); AIR.windK.value = k.wind; AIR.ground.value = p.y;
  AIR.white.value = k.wo; AIR.light.value.setRGB(0.8 * skyLight + 0.12, 0.84 * skyLight + 0.12, 0.9 * skyLight + 0.14);
  // footprints fill in: faster the harder it blows
  printDrift += dt * (0.3 + k.wind * k.wind * 4 + k.wo * 6);
  PRINT.drift.value = printDrift;
  if (water) { water.position.x = Math.round(cam.position.x / 50) * 50; water.position.z = Math.round(cam.position.z / 50) * 50; }

  // props: only those near enough to matter are drawn
  for (const o of H.props) {
    if (!o) continue;
    const q = o.userData.q;
    if (g.taken[q.id]) { o.visible = false; continue; }
    const d = Math.abs(q.x - p.x) + Math.abs(q.z - p.z);
    o.visible = d < (q.inside >= 0 ? 60 : 260);
  }
  for (let i = 0; i < H.loose.length; i++) if (H.loose[i]) H.loose[i].visible = !g.loose[i];
  for (let i = 0; i < H.cairns.length; i++) { const c = H.cairns[i]; if (c) for (let j = 0; j < c.stones.length; j++) c.stones[j].visible = j < g.cairns[i]; }
  for (let i = 0; i < H.posts.length; i++) { const q = H.posts[i]; if (q) q.flame.visible = q.glow.visible = q.far.visible = !!g.posts[i]; }
  for (let i = 0; i < H.masts.length; i++) if (H.masts[i]) H.masts[i].target = g.masts[i] ? 1 : 0;
  for (const f of H.flags) f.grp.visible = Math.abs(f.grp.position.x - p.x) + Math.abs(f.grp.position.z - p.z) < 1400;
  // doors swing
  for (let i = 0; i < H.huts.length; i++) {
    const h = H.huts[i];
    h.a += ((g.doors[i] > 0.5 ? 1 : 0) - h.a) * Math.min(1, dt * 4);
    h.pivot.rotation.y = -h.a * 1.7;
  }
  // masts going up
  for (const m of H.masts) {
    if (!m) continue;
    m.up += Math.sign(m.target - m.up) * Math.min(Math.abs(m.target - m.up), dt * 0.5);
    m.arm.rotation.z = (1 - m.up) * 1.48;
    if (m.cups) m.cups.rotation.y += dt * (1 + k.wind * 14) * m.up;
  }

  // --- fire ---
  const night = k.night;
  const lit = [];
  for (let i = 0; i < H.beacons.length; i++) {
    const b = H.beacons[i];
    if (!b) continue;
    b.fire.visible = !!g.lit[i];
    if (!g.lit[i]) continue;
    if (b.litT < 0) b.litT = 10;
    b.litT += dt;
    const catchK = Math.min(1, b.litT / 3);
    const s = b.big ? 1.8 : 1;
    b.flames.forEach((f, j) => {
      const ph = t * (7 + j) + f.userData.ph;
      const fl = 1 + 0.18 * Math.sin(ph) + 0.1 * Math.sin(ph * 2.3) + (Math.random() - 0.5) * 0.12;
      f.scale.set(0.9 * s * fl * catchK, 1.8 * s * fl * catchK, 1);
      f.position.set(Math.sin(j * 2.1) * 0.15 * s + g.W.wind.x * 0.2 * k.wind, 0.7 * s * fl * catchK, Math.cos(j * 2.1) * 0.15 * s + g.W.wind.z * 0.2 * k.wind);
    });
    b.glow.material.opacity = (0.25 + 0.5 * night) * catchK;
    const d = Math.hypot(b.x - p.x, b.z - p.z);
    // the far light: atmospheric extinction, and a size that does not fall off
    const ext = Math.exp(-(0.00008 + k.wo * 0.08) * d);
    b.far.material.opacity = Math.min(1, (0.18 + 0.95 * night) * ext * catchK * (d > 25 ? 1 : d / 25));
    const px = (b.big ? 0.026 : 0.016) * (0.6 + 0.6 * night);
    b.far.scale.set(px, px, 1);
    // smoke is a daylight thing: at night only the fire shows
    b.smoke.material.uniforms.op.value = catchK * (1 - k.wo * 0.7) * (1 - night * 0.9);
    lit.push({ b, d });
  }
  lit.sort((a, c) => a.d - c.d);
  for (let i = 0; i < fireLights.length; i++) {
    const l = fireLights[i], q = lit[i];
    if (q && q.d < 200) {
      l.position.set(q.b.x, q.b.y + 0.7, q.b.z);
      l.intensity = (q.b.big ? 260 : 120) * Math.min(1, q.b.litT / 3) * (1 + 0.12 * Math.sin(t * 9 + i) + (Math.random() - 0.5) * 0.1);
    } else l.intensity = 0;
  }
  // stoves: the nearest burning one gets the light
  let best = null, bd = 25;
  for (let i = 0; i < g.P.huts.length; i++) {
    if (!(g.stoves[i] > 0)) continue;
    const h = g.P.huts[i], st = g.P.props[h.stove];
    if (!st) continue;
    const d = Math.hypot(st.x - p.x, st.z - p.z);
    if (d < bd) { bd = d; best = st; }
  }
  if (best) { stoveLight.l.position.set(best.x, best.y + 0.95, best.z); stoveLight.l.intensity = 9 * (1 + 0.15 * Math.sin(t * 7) + (Math.random() - 0.5) * 0.12); }
  else stoveLight.l.intensity = 0;
  // lantern posts
  for (const q of H.posts) {
    if (!q || !q.flame.visible) continue;
    const fl = 1 + 0.08 * Math.sin(t * 11 + q.grp.position.x) + (Math.random() - 0.5) * 0.08;
    q.flame.scale.set(0.035 * fl, 0.07 * fl, 1);
    q.glow.material.opacity = (0.2 + 0.6 * night) * fl;
    q.far.material.opacity = 0.1 + 0.8 * night;
  }

  // --- the rare light, and the answer ---
  if (rareSprite.visible) {
    rareSprite.userData.t += dt;
    const tt = rareSprite.userData.t;
    rareSprite.material.opacity = Math.min(1, tt / 6) * (0.7 + 0.3 * Math.sin(tt * 1.3)) * Math.max(0, 1 - (tt - 50) / 15);
    rareSprite.scale.set(0.009, 0.009, 1);
  }
  if (answerSprite.visible) {
    answerSprite.userData.t += dt;
    const tt = answerSprite.userData.t;
    // it flickers, as if someone were feeding it, and then it holds
    const flick = tt < 8 ? (Math.sin(tt * 9) > 0.2 ? 1 : 0.25) * Math.min(1, tt / 2) : 0.85 + 0.15 * Math.sin(tt * 2.2);
    answerSprite.material.opacity = flick;
    answerSprite.scale.set(0.011, 0.011, 1);
  }

  // --- breath ---
  breathT -= dt;
  const cold = 1 - Math.min(1, Math.max(0, (p.warmth - 0.2) / 1.2));
  if (breathT <= 0 && p.inside < 0) { breathT = p.brisk ? 1.6 : 3.4; breath.userData.t = 0; }
  const bt = breath.userData.t === undefined ? 9 : (breath.userData.t += dt);
  breath.visible = bt < 1.6 && !k.view.title;
  if (breath.visible) {
    breath.position.set(0, -0.12 - bt * 0.03, -0.42 - bt * 0.25);
    breath.scale.setScalar(0.12 + bt * 0.35);
    breath.material.opacity = Math.max(0, (bt < 0.25 ? bt / 0.25 : 1 - (bt - 0.25) / 1.35)) * 0.2 * (0.5 + cold) * Math.max(0.15, skyLight);
  }
}

export function setQuality(q) {
  const changed = q !== quality;
  quality = q;
  if (!C) return;
  if (changed) { printsMesh(); particles(); }
}

export const _debug = () => ({ H, prints, drift, fall, M, fireLights });
void hutLocal; void CAT;

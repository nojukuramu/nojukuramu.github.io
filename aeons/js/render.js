/* render.js — the world, drawn: ground, water, things, light, fog and the Veil.
 *
 * One 2D canvas, drawn back to front every frame:
 *   water pattern -> terrain chunks -> decals -> things sorted by their feet
 *   -> shots and sparks -> aircraft -> cloud shadows -> night -> fog -> the Veil
 *   -> overlays (selection, health, placement, aim, pings, contacts).
 * The camera is a point and a zoom; everything in between is world pixels.
 * Positions are interpolated between the last two simulation ticks, so the
 * picture is smooth at any frame rate while the simulation stays at 10 Hz.
 *
 * Night is a darkness layer with holes cut in it wherever something gives
 * light — buildings, champions, fires, every muzzle flash — and the colour of
 * that light follows the era: firelight early, white light later, then cyan,
 * then violet. */

import { G } from "./state.js";
import { TILE, CHUNK, BUILDINGS, ERAS, LINES } from "./data.js";
import { T } from "./world.js";
import { Terrain, waterTile, shimmerTile, mistTile, cloudTile, mk } from "./terrain.js";
import { unitSprite, buildingSprite, nodeSprite, drawWall, blit, rotates, TEAM, hexA, HEIGHT, clearCache } from "./sprites.js";
import { seen, visible, explored, bldVisible } from "./fog.js";
import * as fx from "./fx.js";
import { headingOf } from "./auto.js";
import { manual } from "./heroes.js";

export const view = { cam: { x: 0, y: 0, z: 1 }, W: 1, H: 1, dpr: 1, box: null, ghost: null, aim: null, wallLine: null, pings: [], quality: 1, lights: true, weather: true, hiRes: true, showTerritory: false, follow: 0 };
let cv, ctx, terrain = null, waterPat, shimmerPat, mistPat, cloudCv, lightCv, lightCtx, fogCv, fogCtx, lightSprite;
let realT = 0;
const tinted = new Map();

export function init(canvas) {
  cv = canvas; ctx = cv.getContext("2d", { alpha: false });
  waterPat = ctx.createPattern(waterTile(), "repeat");
  shimmerPat = ctx.createPattern(shimmerTile(), "repeat");
  mistPat = ctx.createPattern(mistTile(), "repeat");
  cloudCv = cloudTile();
  lightCv = mk(4, 4); lightCtx = lightCv.getContext("2d");
  fogCv = mk(4, 4); fogCtx = fogCv.getContext("2d");
  lightSprite = mk(64, 64);
  const lx = lightSprite.getContext("2d"), g = lx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.45, "rgba(255,255,255,0.6)"); g.addColorStop(1, "rgba(255,255,255,0)");
  lx.fillStyle = g; lx.fillRect(0, 0, 64, 64);
  fx.init();
}
export function setWorld(world) {
  terrain = new Terrain(world);
  world.onChange = (cx, cy) => terrain.invalidate(cx, cy);
  clearCache();
}
export function resize(W, H, dpr) {
  view.W = W; view.H = H; view.dpr = dpr;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  lightCv.width = Math.ceil(W / 4); lightCv.height = Math.ceil(H / 4);
}

/* ---------------- coordinates ---------------- */
export function toWorld(sx, sy) { const c = view.cam; return { x: c.x + (sx - view.W / 2) / c.z, y: c.y + (sy - view.H / 2) / c.z }; }
export function toScreen(x, y) { const c = view.cam; return { x: (x - c.x) * c.z + view.W / 2, y: (y - c.y) * c.z + view.H / 2 }; }
export function clampCam() {
  const c = view.cam, b = G.world.bounds, m = 6 * TILE;
  c.z = Math.max(0.3, Math.min(2.4, c.z));
  c.x = Math.max(b.x0 * TILE - m, Math.min(b.x1 * TILE + m, c.x));
  c.y = Math.max(b.y0 * TILE - m, Math.min(b.y1 * TILE + m, c.y));
}
const lerp = (a, b, k) => a + (b - a) * k;
export const posOf = (u, k) => ({ x: lerp(u.px, u.x, k), y: lerp(u.py, u.y, k) });

/* ---------------- picking ---------------- */
export function pickAt(sx, sy, k) {
  const p = toWorld(sx, sy), z = view.cam.z;
  let best = null, bd = 1e9;
  for (const u of G.units) {
    if (u.dead || u.hidden || !seen(u)) continue;
    const q = posOf(u, k || 1), lift = u.move === "air" ? 20 : 8;
    const d = Math.hypot(q.x - p.x, q.y - lift - p.y) - u.r;
    const slack = Math.max(6, 14 / z);
    if (d < slack && d < bd) { bd = d; best = u; }
  }
  if (best) return { ent: best, x: p.x, y: p.y };
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  for (const b of G.blds) {
    if (b.dead) continue;
    if (b.team !== 0 && !bldVisible(b) && !G.ghosts.has(b.id)) continue;
    const top = (HEIGHT[b.type] || 20) * 0.6;
    if (p.x >= b.tx * TILE && p.x < (b.tx + b.w) * TILE && p.y >= b.ty * TILE - top && p.y < (b.ty + b.h) * TILE) return { ent: b, x: p.x, y: p.y };
  }
  const o = G.world.occ(tx, ty);
  if (o < 0 && explored(tx, ty)) { const n = G.world.nodes.get(o); if (n) return { ent: n, x: p.x, y: p.y }; }
  if (G.world.terrain(tx, ty) === T.FOREST && explored(tx, ty)) return { tree: { tx, ty }, x: p.x, y: p.y };
  return { x: p.x, y: p.y };
}
export function unitsInBox(x0, y0, x1, y1, k) {
  const a = toWorld(Math.min(x0, x1), Math.min(y0, y1)), b = toWorld(Math.max(x0, x1), Math.max(y0, y1));
  return G.units.filter((u) => { if (u.dead || u.team !== 0 || u.hidden) return false; const q = posOf(u, k || 1); return q.x >= a.x - u.r && q.x <= b.x + u.r && q.y >= a.y - u.r && q.y <= b.y + u.r + 10; });
}

/* ---------------- the frame ---------------- */
export function frame(k, dt) {
  if (!terrain || !G.world) return;
  realT += dt;
  fx.update(dt);
  const { W, H, dpr } = view, c = view.cam, z = c.z;
  const sh = fx.shakeAmt ? (Math.random() - 0.5) * fx.shakeAmt : 0;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#07060c"; ctx.fillRect(0, 0, W, H);
  ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - c.x * z + sh), dpr * (H / 2 - c.y * z + sh));
  const x0 = c.x - W / 2 / z, y0 = c.y - H / 2 / z, x1 = c.x + W / 2 / z, y1 = c.y + H / 2 / z;
  const B = G.world.bounds, bx0 = B.x0 * TILE, by0 = B.y0 * TILE, bx1 = B.x1 * TILE, by1 = B.y1 * TILE;
  const ix0 = Math.max(x0, bx0), iy0 = Math.max(y0, by0), ix1 = Math.min(x1, bx1), iy1 = Math.min(y1, by1);

  // water, moving two ways
  if (ix1 > ix0 && iy1 > iy0 && view.quality <= 0.5) { ctx.fillStyle = waterPat; ctx.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0); }
  else if (ix1 > ix0 && iy1 > iy0) {
    const ox = (realT * 6) % 256, oy = (realT * 3) % 256;
    ctx.save(); ctx.translate(ox, oy); ctx.fillStyle = waterPat; ctx.fillRect(ix0 - ox, iy0 - oy, ix1 - ix0, iy1 - iy0); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.55; const sx = -(realT * 9) % 256, sy = (realT * 7) % 256;
    ctx.translate(sx, sy); ctx.fillStyle = shimmerPat; ctx.fillRect(ix0 - sx, iy0 - sy, ix1 - ix0, iy1 - iy0); ctx.restore();
  }
  // ground
  const wantHi = view.hiRes && z * dpr > 0.42;
  const cs = CHUNK * TILE;
  for (let cy = Math.floor(Math.max(y0, by0) / cs); cy <= Math.floor((Math.min(y1, by1) - 1) / cs); cy++) {
    for (let cx = Math.floor(Math.max(x0, bx0) / cs); cx <= Math.floor((Math.min(x1, bx1) - 1) / cs); cx++) {
      const ch = G.world.chunk(cx, cy);
      if (!chunkSeen(ch)) continue;
      const img = terrain.get(cx, cy, wantHi);
      ctx.drawImage(img, cx * cs, cy * cs, cs, cs);
    }
  }
  terrain.pump(6);
  fx.drawDecals(ctx, x0, y0, x1, y1);
  territory();

  // things, back to front
  const list = [], air = [];
  for (const n of G.world.nodes.values()) if (n.x > x0 - 80 && n.x < x1 + 80 && n.y > y0 - 60 && n.y < y1 + 120 && explored(n.tx, n.ty) && !n.building) list.push(n);
  for (const b of G.blds) {
    if (b.dead || b.x < x0 - 200 || b.x > x1 + 200 || b.y < y0 - 60 || b.y > y1 + 220) continue;
    if (b.team !== 0 && !bldVisible(b)) continue;
    list.push(b);
  }
  for (const gh of G.ghosts.values()) {
    const b = G.ents.get(gh.id);
    if (b && !b.dead && bldVisible(b)) continue;
    if (gh.tx * TILE < x0 - 200 || gh.tx * TILE > x1 + 40 || gh.ty * TILE < y0 - 60 || gh.ty * TILE > y1 + 220) continue;
    list.push({ kind: "ghost", gh, y: (gh.ty + gh.h / 2) * TILE, x: (gh.tx + gh.w / 2) * TILE });
  }
  for (const u of G.units) {
    if (u.dead || u.hidden) continue;
    const q = posOf(u, k);
    if (q.x < x0 - 60 || q.x > x1 + 60 || q.y < y0 - 60 || q.y > y1 + 80) continue;
    if (!seen(u)) continue;
    u.dx = q.x; u.dy = q.y;
    (u.move === "air" ? air : list).push(u);
  }
  list.sort((a, b) => footY(a) - footY(b));
  for (const u of list) if (u.kind === "unit" && u.sel) ring(u);
  for (const e of list) {
    if (e.kind === "unit") drawUnit(e, dt);
    else if (e.kind === "bld") drawBuilding(e);
    else if (e.kind === "node") drawNode(e);
    else drawGhost(e.gh);
  }
  drawZones();
  drawProjectiles(x0, y0, x1, y1);
  fx.drawParts(ctx, x0, y0, x1, y1, z);
  for (const u of air) { ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(u.dx + 10, u.dy + 14, u.r * 1.1, u.r * 0.55, 0, 0, 6.3); ctx.fill(); }
  air.sort((a, b) => a.dy - b.dy);
  for (const u of air) { if (u.sel) ring(u, -22); drawUnit(u, dt); }

  // weather of the sky: cloud shadows by day
  const dark = view.lights ? darkness() : 0;
  if (view.quality > 0.5 && dark < 0.5) {
    ctx.save(); ctx.globalAlpha = 0.16 * (1 - dark * 2); ctx.globalCompositeOperation = "multiply";
    const s = 14, ox = (realT * 9) % (256 * s), oy = (realT * 4) % (256 * s);
    const sx0 = Math.floor((x0 - ox) / (256 * s)), sy0 = Math.floor((y0 - oy) / (256 * s));
    for (let j = sy0; j * 256 * s + oy < y1; j++) for (let i = sx0; i * 256 * s + ox < x1; i++) ctx.drawImage(cloudCv, i * 256 * s + ox, j * 256 * s + oy, 256 * s, 256 * s);
    ctx.restore();
  }
  overlaysUnder(k);
  // night
  if (dark > 0.02) night(dark, x0, y0, x1, y1, k);
  // fog of war
  fog(x0, y0, x1, y1);
  veil(x0, y0, x1, y1);
  overlays(k);
  // screen space
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (view.weather) { fx.updateWeather(dt, G.world.biome(Math.floor(c.x / TILE), Math.floor(c.y / TILE)), W, H, true); fx.drawWeather(ctx, W, H); }
  if (fx.eraFlash > 0) { ctx.fillStyle = "rgba(255,240,210," + fx.eraFlash * 0.5 + ")"; ctx.fillRect(0, 0, W, H); }
  if (view.box) {
    const bx = view.box;
    ctx.strokeStyle = "#7dffb0"; ctx.lineWidth = 1.5; ctx.fillStyle = "rgba(125,255,176,0.08)";
    ctx.fillRect(Math.min(bx.x0, bx.x1), Math.min(bx.y0, bx.y1), Math.abs(bx.x1 - bx.x0), Math.abs(bx.y1 - bx.y0));
    ctx.strokeRect(Math.min(bx.x0, bx.x1), Math.min(bx.y0, bx.y1), Math.abs(bx.x1 - bx.x0), Math.abs(bx.y1 - bx.y0));
  }
  // a vignette, a little stronger at night
  if (view.quality > 0.5) {
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0," + (0.32 + dark * 0.3) + ")");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}
const footY = (e) => e.kind === "unit" ? e.dy : e.kind === "ghost" ? (e.gh.ty + e.gh.h) * TILE : (e.ty + e.h) * TILE - 2;
const seenChunk = new WeakMap();
function chunkSeen(ch) {
  const r = ch.expRev || 0, s = seenChunk.get(ch);
  if (s && s.r === r) return s.v;
  let v = false;
  for (let i = 0; i < ch.exp.length; i++) if (ch.exp[i]) { v = true; break; }
  seenChunk.set(ch, { r, v });
  return v;
}

/* ---------------- day and night ---------------- */
export const DAY = 600;
// a realm begins in the morning: the clock is offset so that time 0 is mid-morning
export function sun() { return Math.cos(2 * Math.PI * (((G.time + DAY * 0.14) % DAY) / DAY - 0.3)); }
export function darkness() { return Math.max(0, Math.min(1, (0.25 - sun()) / 0.7)) * 0.66; }
function lightColor(e, team) {
  if (team === 1) return "#b48cff";
  return ERAS[Math.max(0, Math.min(9, e))].light;
}
function tint(col) {
  let t = tinted.get(col);
  if (t) return t;
  t = mk(64, 64); const x = t.getContext("2d");
  x.drawImage(lightSprite, 0, 0); x.globalCompositeOperation = "source-in"; x.fillStyle = col; x.fillRect(0, 0, 64, 64);
  tinted.set(col, t);
  return t;
}
function night(dark, x0, y0, x1, y1, k) {
  const lights = [];
  const add = (x, y, r, col, a) => { if (x > x0 - r && x < x1 + r && y > y0 - r && y < y1 + r) lights.push([x, y, r, col, a || 1]); };
  for (const b of G.blds) {
    if (b.dead || b.built < 0.3) continue;
    if (b.team !== 0 && !bldVisible(b)) continue;
    const e = b.level - 1;
    add(b.x, b.y - 8, (2.2 + Math.max(b.w, b.h) * 0.9) * TILE, lightColor(e, b.team));
  }
  for (const u of G.units) {
    if (u.dead || u.hidden || u.dx === undefined) continue;
    if (u.team !== 0 && !seen(u)) continue;
    if (u.hero) add(u.dx, u.dy, 4 * TILE, ERAS[G.era].energy);
    else if (u.team === 0) add(u.dx, u.dy, 1.7 * TILE, lightColor(u.tier, 0), 0.7);
  }
  for (const f of fx.flashes) add(f.x, f.y, f.r, f.col, 1 - f.t / f.max);
  for (const p of G.projs) if (!p.dead && (p.line || p.shot === "photon" || p.shot === "plasma" || p.shot === "star" || p.shot === "aether" || p.shot === "missile" || p.shot === "rocket")) add(p.x, p.y, 2.2 * TILE, "#ffd8a0", 0.8);
  for (const n of G.world.nodes.values()) if (n.type === "aether" && explored(n.tx, n.ty)) add(n.x, n.y, 3 * TILE, "#d38bff", 0.8);
  for (const z of G.zones || []) add(z.x, z.y, z.r * 1.4, ERAS[G.era].energy, 0.7);
  // darkness, with holes
  const { W, H } = view, lw = lightCv.width, lh = lightCv.height, sc = lw / W, c = view.cam;
  lightCtx.setTransform(1, 0, 0, 1, 0, 0);
  lightCtx.globalCompositeOperation = "source-over";
  lightCtx.clearRect(0, 0, lw, lh);
  const dusk = sun() > -0.3 ? 1 : 0;
  lightCtx.fillStyle = dusk ? "rgba(26,16,40," + dark + ")" : "rgba(6,10,30," + dark + ")";
  lightCtx.fillRect(0, 0, lw, lh);
  lightCtx.globalCompositeOperation = "destination-out";
  for (const [x, y, r, , a] of lights) {
    const s = toScreen(x, y), rr = r * c.z * sc;
    lightCtx.globalAlpha = a;
    lightCtx.drawImage(lightSprite, s.x * sc - rr, s.y * sc - rr, rr * 2, rr * 2);
  }
  lightCtx.globalAlpha = 1;
  ctx.save();
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(lightCv, 0, 0, W, H);
  // and the light itself, warm and additive
  ctx.globalCompositeOperation = "lighter";
  for (const [x, y, r, col, a] of lights) {
    const s = toScreen(x, y), rr = r * c.z * 0.7;
    ctx.globalAlpha = 0.22 * dark * a;
    ctx.drawImage(tint(col), s.x - rr, s.y - rr, rr * 2, rr * 2);
  }
  ctx.restore();
}

/* ---------------- fog and the Veil ---------------- */
function fog(x0, y0, x1, y1) {
  const tx0 = Math.floor(x0 / TILE) - 1, ty0 = Math.floor(y0 / TILE) - 1, tx1 = Math.ceil(x1 / TILE) + 1, ty1 = Math.ceil(y1 / TILE) + 1;
  const w = tx1 - tx0, h = ty1 - ty0;
  if (fogCv.width !== w || fogCv.height !== h) { fogCv.width = w; fogCv.height = h; }
  const img = fogCtx.createImageData(w, h), d = img.data, W = G.world, s = G.fogStamp;
  for (let j = 0; j < h; j++) {
    const ty = ty0 + j;
    for (let i = 0; i < w; i++) {
      const tx = tx0 + i, o = (j * w + i) * 4;
      d[o] = 4; d[o + 1] = 5; d[o + 2] = 10;
      if (!W.inBounds(tx, ty)) { d[o + 3] = 255; continue; }
      const c = W.chunkAt(tx, ty), k = W.idx(tx, ty);
      d[o + 3] = c.vis[k] === s ? 0 : c.exp[k] ? 140 : 255;
    }
  }
  fogCtx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(fogCv, tx0 * TILE, ty0 * TILE, w * TILE, h * TILE);
}
function veil(x0, y0, x1, y1) {
  const B = G.world.bounds, bx0 = B.x0 * TILE, by0 = B.y0 * TILE, bx1 = B.x1 * TILE, by1 = B.y1 * TILE;
  ctx.save();
  const ox = (realT * 11) % 256, oy = (realT * 5) % 256;
  ctx.translate(ox, oy); ctx.fillStyle = mistPat;
  const R = (ax, ay, bx, by) => { if (bx > ax && by > ay) ctx.fillRect(ax - ox, ay - oy, bx - ax, by - ay); };
  R(x0, y0, x1, by0); R(x0, by1, x1, y1); R(x0, Math.max(y0, by0), bx0, Math.min(y1, by1)); R(bx1, Math.max(y0, by0), x1, Math.min(y1, by1));
  ctx.restore();
  // the edge: a faint seam of light where the world is still being made
  const pulse = 0.5 + 0.5 * Math.sin(realT * 1.3);
  ctx.strokeStyle = "rgba(190,150,255," + (0.18 + pulse * 0.12) + ")"; ctx.lineWidth = 14;
  ctx.strokeRect(bx0 - 7, by0 - 7, bx1 - bx0 + 14, by1 - by0 + 14);
  ctx.strokeStyle = "rgba(235,215,255,0.5)"; ctx.lineWidth = 1.5;
  ctx.strokeRect(bx0, by0, bx1 - bx0, by1 - by0);
}

/* ---------------- things ---------------- */
function ring(u, lift) {
  ctx.strokeStyle = u.team === 0 ? "#7dffb0" : "#ff6a6a"; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.ellipse(u.dx, u.dy + 5 + (lift || 0), u.r * 1.15, u.r * 0.62, 0, 0, 6.3); ctx.stroke();
}
function drawUnit(u, dt) {
  const air = u.move === "air";
  u.anim = (u.anim || 0) + dt * (u.moving ? 1 : 0.3);
  let frame = 6;
  if (u.atkAnim > 0) frame = u.line === "worker" && (u.order.t === "gather" || u.order.t === "build" || u.order.t === "repair") ? 5 : 4;
  else if (u.moving) frame = Math.floor(u.anim * 7) % 4;
  const rot = !u.hero && rotates(u.line, u.tier);
  if (rot && (air || u.line === "naval" || u.tier >= 5)) frame = Math.floor(realT * 10) % 4;
  const s = unitSprite(u, frame);
  const x = u.dx, y = u.dy - (air ? 22 + Math.sin(realT * 2 + u.id) * 2 : 0);
  if (!rot && !air) { ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.beginPath(); ctx.ellipse(x + 2, u.dy + 6, u.r * 0.9, u.r * 0.42, 0, 0, 6.3); ctx.fill(); }
  if (u.hero) {
    ctx.strokeStyle = hexA(ERAS[G.era].energy, 0.55 + 0.25 * Math.sin(realT * 3)); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, u.dy + 6, 13, 6, 0, 0, 6.3); ctx.stroke();
  }
  if (u.line === "naval" && u.moving && Math.random() < 0.4) fx.smoke(x - Math.cos(u.face) * 30, u.dy - Math.sin(u.face) * 30, 1, "#cfe8f0");
  const veiled = u.buffs.veil > G.time;
  if (veiled) ctx.globalAlpha = 0.45;
  blit(ctx, s, x, y, !rot && Math.cos(u.face) < 0, rot ? u.face : 0);
  if (G.time - u.lastHit < 0.12) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.45; blit(ctx, s, x, y, !rot && Math.cos(u.face) < 0, rot ? u.face : 0); ctx.globalCompositeOperation = "source-over"; }
  ctx.globalAlpha = 1;
  if (u.carry && !u.hidden) {
    const col = u.carry.r === "gold" ? "#f4d03f" : u.carry.r === "wood" ? "#8a6236" : "#9ea2a8";
    const bx = x - Math.cos(u.face) * 5, by = y - 10;
    if (u.carry.r === "wood") { ctx.fillStyle = col; ctx.fillRect(bx - 5, by - 2, 10, 3); ctx.fillRect(bx - 4, by - 5, 9, 3); }
    else { ctx.fillStyle = "#7a5a3a"; ctx.beginPath(); ctx.arc(bx, by, 3.6, 0, 6.3); ctx.fill(); ctx.fillStyle = col; ctx.beginPath(); ctx.arc(bx, by - 1.5, 2, 0, 6.3); ctx.fill(); }
  }
  if (u.stun > G.time) { ctx.strokeStyle = "#ffe9a8"; ctx.lineWidth = 1; for (let i = 0; i < 3; i++) { const a = realT * 5 + i * 2.1; ctx.beginPath(); ctx.arc(x + Math.cos(a) * 7, y - 24 + Math.sin(a) * 2, 1.4, 0, 6.3); ctx.stroke(); } }
  if (u.buffs.bulwark > G.time) { ctx.strokeStyle = "rgba(255,233,168,0.7)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y - 8, 17, 0, 6.3); ctx.stroke(); }
  if (u.manual) { ctx.strokeStyle = "#ffe9a8"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x - 4, y - 34); ctx.lineTo(x, y - 29); ctx.lineTo(x + 4, y - 34); ctx.stroke(); }
}
function drawNode(n) {
  const k = n.max ? n.amount / n.max : 1;
  const s = nodeSprite(n, k);
  ctx.drawImage(s.c, n.tx * TILE - s.ox, n.ty * TILE - s.oy, s.w, s.h);
  if (n.type === "aether") { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.3 + 0.2 * Math.sin(realT * 2 + n.id); ctx.drawImage(tint("#d38bff"), n.x - 40, n.y - 50, 80, 80); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; }
  if (n.type === "gold" && Math.random() < 0.03) fx.sparks(n.x + (Math.random() - 0.5) * 40, n.y - 10, 1, "#ffe680", 0.2);
  if (n.type === "oil" && Math.random() < 0.02) fx.smoke(n.x, n.y, 1, "#222");
}
function wallNeighbours(b) {
  const W = G.world, same = (tx, ty) => { const o = W.occ(tx, ty); if (o <= 0) return 0; const e = G.ents.get(o); return e && e.type === "wall" && e.team === b.team ? 1 : 0; };
  return { n: same(b.tx, b.ty - 1), s: same(b.tx, b.ty + 1), e: same(b.tx + 1, b.ty), w: same(b.tx - 1, b.ty) };
}
function drawBuilding(b) {
  const era = Math.min(9, b.level - 1);
  if (b.type === "wall") { ctx.globalAlpha = b.built < 1 ? 0.5 : 1; drawWall(ctx, b.tx, b.ty, era, b.team, wallNeighbours(b)); ctx.globalAlpha = 1; hpBarB(b); return; }
  const s = buildingSprite(b, era);
  const x = b.tx * TILE, y = b.ty * TILE;
  if (b.type === "shipyard") piers(b);
  if (b.built < 1) {
    const p = b.built;
    ctx.fillStyle = "rgba(120,100,70,0.5)"; ctx.fillRect(x + 2, y + 2, b.w * TILE - 4, b.h * TILE - 4);
    if (p > 0.12) {
      const full = s.h, show = full * Math.min(1, (p - 0.1) / 0.9);
      ctx.save(); ctx.beginPath(); ctx.rect(x - s.ox, y - s.oy + full - show, s.w, show); ctx.clip();
      ctx.globalAlpha = 0.9; ctx.drawImage(s.c, x - s.ox, y - s.oy, s.w, s.h); ctx.restore(); ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = "#8a6a3a"; ctx.lineWidth = 1.5;
    const hgt = (HEIGHT[b.type] || 20) * Math.max(0.3, p);
    for (let i = 0; i <= b.w; i++) { const px = x + i * TILE; ctx.beginPath(); ctx.moveTo(px, y + b.h * TILE - 2); ctx.lineTo(px, y + b.h * TILE - 2 - hgt - 8); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(x, y + b.h * TILE - hgt * 0.5); ctx.lineTo(x + b.w * TILE, y + b.h * TILE - hgt * 0.5); ctx.stroke();
    if (b.bThis && Math.random() < 0.2) fx.dust(x + Math.random() * b.w * TILE, y + b.h * TILE - 4, 1, "#c8b08a");
    hpBarB(b, true);
    return;
  }
  ctx.drawImage(s.c, x - s.ox, y - s.oy, s.w, s.h);
  dynamic(b, era);
  if (b.sel) { ctx.strokeStyle = b.team === 0 ? "#7dffb0" : "#ff6a6a"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.strokeRect(x + 1, y + 1, b.w * TILE - 2, b.h * TILE - 2); ctx.setLineDash([]); }
  const k = b.hp / b.maxHp;
  if (k < 0.6 && Math.random() < (0.6 - k) * 0.9 * view.quality) fx.fireOn(b.x + (Math.random() - 0.5) * b.w * 18, b.y - (HEIGHT[b.type] || 20) * 0.4, k < 0.3 ? 1.4 : 1);
  if ((b.type === "forge" || (era >= 4 && era <= 5 && (b.type === "hall" || b.type === "house" || b.type === "workshop"))) && Math.random() < 0.05 * view.quality) fx.smoke(x + b.w * TILE * 0.74, y - 10 - (era >= 5 ? 20 : 0), 1, "#6a6660");
  hpBarB(b);
}
function drawGhost(gh) {
  const era = Math.min(9, gh.level - 1);
  if (gh.type === "wall") { drawWall(ctx, gh.tx, gh.ty, era, gh.team, { n: 0, s: 0, e: 0, w: 0 }); return; }
  const s = buildingSprite(gh, era);
  ctx.drawImage(s.c, gh.tx * TILE - s.ox, gh.ty * TILE - s.oy, s.w, s.h);
}
function piers(b) {
  if (!b.piers) {
    b.piers = [];
    for (let i = -1; i <= b.w; i++) for (let j = -1; j <= b.h; j++) {
      if (i >= 0 && j >= 0 && i < b.w && j < b.h) continue;
      const t = G.world.terrain(b.tx + i, b.ty + j);
      if (t === T.WATER || t === T.DEEP) b.piers.push([b.tx + i, b.ty + j]);
    }
  }
  const era = b.level - 1;
  ctx.fillStyle = era <= 4 ? "#7a5634" : "#8c9094";
  for (const [tx, ty] of b.piers) { ctx.fillRect(tx * TILE + 4, ty * TILE + 4, TILE - 8, TILE - 8); ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(tx * TILE + 4, ty * TILE + TILE - 6, TILE - 8, 2); ctx.fillStyle = era <= 4 ? "#7a5634" : "#8c9094"; }
}
function dynamic(b, era) {
  const x = b.tx * TILE, y = b.ty * TILE, W = b.w * TILE, H = b.h * TILE;
  if (b.type === "radar") {
    const a = realT * 1.6;
    ctx.save(); ctx.translate(x + W / 2, y + H * 0.4 - 22); ctx.scale(Math.cos(a), 1);
    ctx.fillStyle = "#d3dbe3"; ctx.beginPath(); ctx.ellipse(0, 0, 12, 7, 0, 0, 6.3); ctx.fill(); ctx.strokeStyle = "#7c8084"; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore(); ctx.strokeStyle = "#7c8084"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + W / 2, y + H * 0.4 - 22); ctx.lineTo(x + W / 2, y + H * 0.4 - 8); ctx.stroke();
  } else if (b.type === "derrick") {
    const a = Math.sin(realT * 2.4) * 0.35;
    ctx.save(); ctx.translate(x + W * 0.45, y + H * 0.5 - 18);
    ctx.strokeStyle = era >= 7 ? "#c1c9d2" : "#3a3a3e"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-8, 18); ctx.lineTo(0, 0); ctx.lineTo(8, 18); ctx.stroke();
    ctx.rotate(a); ctx.fillStyle = era >= 7 ? "#dfe4ea" : "#d8a83a"; ctx.fillRect(-18, -3, 30, 5); ctx.beginPath(); ctx.ellipse(-18, 0, 4, 7, 0, 0, 6.3); ctx.fill();
    ctx.restore();
  } else if (b.type === "siphon") {
    const fy = Math.sin(realT * 2 + b.id) * 4;
    ctx.save(); ctx.translate(x + W / 2, y + H * 0.5 - 30 + fy); ctx.rotate(realT * 0.6);
    ctx.fillStyle = "#e8d4ff"; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(7, 0); ctx.lineTo(0, 12); ctx.lineTo(-7, 0); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.5; ctx.drawImage(tint("#d38bff"), x + W / 2 - 30, y + H * 0.5 - 60 + fy, 60, 60); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  } else if (b.type === "beacon" && G.beaconLit) {
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createLinearGradient(0, y - 2000, 0, y);
    g.addColorStop(0, "rgba(255,233,168,0)"); g.addColorStop(1, "rgba(255,233,168,0.45)");
    ctx.fillStyle = g; ctx.fillRect(x + W / 2 - 10 - Math.sin(realT * 3) * 2, y - 2000, 20 + Math.sin(realT * 3) * 4, 2000 - 80);
    ctx.globalCompositeOperation = "source-over";
  }
  if (BUILDINGS[b.type].attack && b.fired && G.time - b.fired < 0.15) { ctx.globalCompositeOperation = "lighter"; ctx.drawImage(tint(ERAS[era].energy), b.x - 16, b.y - (HEIGHT[b.type] || 30) - 16, 32, 32); ctx.globalCompositeOperation = "source-over"; }
}
const bars = [];
function hpBarB(b, building) {
  if (!(b.sel || b.hp < b.maxHp * 0.98 || building)) return;
  bars.push({ x: b.x, y: b.ty * TILE - (HEIGHT[b.type] || 20) * 0.9 - 6, w: Math.min(64, b.w * 20), k: b.hp / b.maxHp, team: b.team, prog: b.built < 1 ? b.built : b.q && b.q.length && b.team === 0 && b.sel ? b.qt / b.q[0].time : -1 });
}

function drawZones() {
  for (const z of G.zones || []) {
    if (z.team !== 0 && !visible(Math.floor(z.x / TILE), Math.floor(z.y / TILE))) continue;
    const col = ERAS[G.era].energy;
    if (z.kind === "mine") { if (z.team === 0) { ctx.fillStyle = Math.sin(realT * 8) > 0 ? "#ff5a4a" : "#552a20"; ctx.beginPath(); ctx.arc(z.x, z.y, 3.5, 0, 6.3); ctx.fill(); } continue; }
    if (z.at !== undefined) {
      const k = 1 - (z.at - G.time) / 1.5;
      ctx.strokeStyle = hexA(col, 0.8); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.62, 0, 0, 6.3); ctx.stroke();
      ctx.fillStyle = hexA(col, 0.12 + 0.25 * k); ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r * k, z.r * 0.62 * k, 0, 0, 6.3); ctx.fill();
      continue;
    }
    ctx.fillStyle = hexA(z.kind === "caltrops" ? "#c8c0b0" : col, 0.12); ctx.beginPath(); ctx.ellipse(z.x, z.y, z.r, z.r * 0.62, 0, 0, 6.3); ctx.fill();
    if (z.kind === "hail" && Math.random() < 0.8) { const a = Math.random() * 6.28, r = Math.random() * z.r; fx.sparks(z.x + Math.cos(a) * r, z.y + Math.sin(a) * r * 0.62, 1, col, 0.3); }
    if (z.kind === "caltrops") { ctx.fillStyle = "#6a6660"; for (let i = 0; i < 14; i++) { const a = i * 2.4, r = (i * 37 % 100) / 100 * z.r; ctx.fillRect(z.x + Math.cos(a) * r, z.y + Math.sin(a) * r * 0.62, 2, 2); } }
  }
}

function drawProjectiles(x0, y0, x1, y1) {
  for (const p of G.projs) {
    if (p.dead || p.x < x0 - 40 || p.x > x1 + 40 || p.y < y0 - 80 || p.y > y1 + 40) continue;
    if (p.team !== 0 && !visible(Math.floor(p.x / TILE), Math.floor(p.y / TILE))) continue;
    const col = fx.shotColor(p.shot);
    let h = 0;
    if (p.lob) { const rem = Math.hypot(p.tx - p.x, p.ty - p.y), k = 1 - rem / Math.max(1, p.dist); h = Math.sin(Math.PI * Math.max(0, Math.min(1, k))) * Math.min(120, p.dist * 0.3); }
    const dx = p.line ? p.vx : p.tx - p.x, dy = p.line ? p.vy : p.ty - p.y, a = Math.atan2(dy, dx);
    const x = p.x, y = p.y - h - 8;
    if (p.lob) { ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(p.x, p.y, 4, 2, 0, 0, 6.3); ctx.fill(); }
    switch (p.shot) {
      case "arrow": case "bolt": case "spear":
        ctx.strokeStyle = "#e8dcc0"; ctx.lineWidth = p.shot === "spear" ? 2 : 1.2;
        ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * 9, y - Math.sin(a) * 9); ctx.lineTo(x, y); ctx.stroke(); break;
      case "stone": case "boulder":
        ctx.fillStyle = "#7a746c"; ctx.beginPath(); ctx.arc(x, y, p.shot === "boulder" ? 5 : 2, 0, 6.3); ctx.fill(); break;
      case "shell":
        ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(x, y, 3, 0, 6.3); ctx.fill(); if (Math.random() < 0.3) fx.smoke(x, y + h + 8, 1, "#aaa"); break;
      case "rocket": case "missile":
        ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.fillStyle = "#d8dde4"; ctx.fillRect(-7, -1.6, 10, 3.2); ctx.fillStyle = "#ff9a3c"; ctx.fillRect(-11, -1.2, 4, 2.4); ctx.restore();
        if (Math.random() < 0.6) fx.smoke(x - Math.cos(a) * 10, y + h + 8 - Math.sin(a) * 10, 1, "#bbb"); break;
      default: {
        const r = p.shot === "singularity" ? 7 : p.shot === "bolt2" ? 6 : p.shot === "lance" ? 3 : 4;
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(tint(p.shot === "hero" || p.shot === "bolt2" ? ERAS[G.era].energy : col), x - r * 3, y - r * 3, r * 6, r * 6);
        ctx.fillStyle = p.shot === "singularity" ? "#07040e" : "#ffffff"; ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, 6.3); ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }
    }
  }
}

/* ---------------- overlays ---------------- */
function territory() {
  if (!view.showTerritory) return;
  ctx.setLineDash([10, 8]); ctx.lineWidth = 2;
  for (const b of G.blds) {
    if (b.dead || b.team !== 0 || !BUILDINGS[b.type].territory) continue;
    const r = (BUILDINGS[b.type].territory + 2 * (b.level - 1)) * TILE;
    ctx.strokeStyle = "rgba(125,255,176,0.45)"; ctx.fillStyle = "rgba(125,255,176,0.05)";
    ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, 6.3); ctx.fill(); ctx.stroke();
  }
  ctx.setLineDash([]);
}
function overlaysUnder(k) {
  // where a selected building sends new units
  for (const id of G.sel) {
    const b = G.ents.get(id);
    if (!b || b.kind !== "bld" || !b.rally) continue;
    ctx.strokeStyle = "rgba(125,255,176,0.7)"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.rally.x, b.rally.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = "#ddd"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(b.rally.x, b.rally.y); ctx.lineTo(b.rally.x, b.rally.y - 18); ctx.stroke();
    ctx.fillStyle = TEAM[0].main; ctx.beginPath(); ctx.moveTo(b.rally.x, b.rally.y - 18); ctx.lineTo(b.rally.x + 10, b.rally.y - 15); ctx.lineTo(b.rally.x, b.rally.y - 12); ctx.fill();
  }
  if (G.auto && G.auto.muster && G.doctrines.logistics) {
    const m = G.auto.muster; ctx.strokeStyle = "#ffe9a8"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(m.x, m.y - 20); ctx.stroke();
    ctx.fillStyle = "#ffe9a8"; ctx.beginPath(); ctx.moveTo(m.x, m.y - 20); ctx.lineTo(m.x + 11, m.y - 16); ctx.lineTo(m.x, m.y - 12); ctx.fill();
  }
  // orders of the selected, as faint lines to where they are going
  let n = 0;
  for (const id of G.sel) {
    const u = G.ents.get(id);
    if (!u || u.kind !== "unit" || n++ > 40) continue;
    const o = u.order;
    const tx = o.x !== undefined ? o.x : o.bx, ty = o.y !== undefined ? o.y : o.by;
    if (tx === undefined || !u.moving) continue;
    ctx.strokeStyle = o.t === "amove" || o.t === "patrol" ? "rgba(255,120,110,0.35)" : "rgba(125,255,176,0.3)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(u.dx, u.dy); ctx.lineTo(tx, ty); ctx.stroke();
  }
}
function overlays(k) {
  const z = view.cam.z;
  // contacts the eyes have lost, still marked where they were last seen
  for (const c of G.intel.contacts) {
    const age = G.time - c.seen;
    if (age < 0.8 && c.src === 2) continue;
    const a = Math.max(0.15, 1 - age / 120);
    ctx.globalAlpha = a;
    const s = 8 + Math.min(10, c.n);
    ctx.fillStyle = c.src === 1 ? "rgba(255,190,90,0.35)" : "rgba(255,90,90,0.35)"; ctx.strokeStyle = c.src === 1 ? "#ffbe5a" : "#ff6a6a"; ctx.lineWidth = 1.5 / Math.max(0.5, z);
    ctx.beginPath(); ctx.moveTo(c.x, c.y - s); ctx.lineTo(c.x + s, c.y); ctx.lineTo(c.x, c.y + s); ctx.lineTo(c.x - s, c.y); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "700 " + Math.round(11 / Math.max(0.6, z)) + "px system-ui"; ctx.textAlign = "center"; ctx.fillText(String(c.n), c.x, c.y + 4 / Math.max(0.6, z));
    const hd = headingOf(c);
    if (hd) { const tx = hd.to ? hd.to.x : hd.x, ty = hd.to ? hd.to.y : hd.y; ctx.setLineDash([6, 6]); ctx.strokeStyle = "rgba(255,106,106,0.6)"; ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]); }
    ctx.globalAlpha = 1;
  }
  // health bars above everything, so nothing hides them
  for (const id of G.sel) { const u = G.ents.get(id); if (u && u.kind === "unit" && u.dx !== undefined) bars.push({ x: u.dx, y: u.dy - (u.move === "air" ? 46 : u.hero ? 36 : 28), w: Math.max(16, u.r * 2.2), k: u.hp / u.maxHp, team: u.team }); }
  for (const u of G.units) {
    if (u.dead || u.sel || u.dx === undefined || u.hidden) continue;
    if ((u.hp < u.maxHp && G.time - u.lastHit < 6) || u.hero) { if (u.team !== 0 && !seen(u)) continue; bars.push({ x: u.dx, y: u.dy - (u.move === "air" ? 46 : u.hero ? 36 : 28), w: Math.max(16, u.r * 2.2), k: u.hp / u.maxHp, team: u.team, hero: u.hero ? u.lvl : 0 }); }
  }
  const th = Math.max(2.5, 3.2 / z);
  for (const b of bars) {
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(b.x - b.w / 2 - 1, b.y - 1, b.w + 2, th + 2);
    ctx.fillStyle = b.k > 0.6 ? (b.team === 0 ? "#5ae27a" : "#e25a5a") : b.k > 0.3 ? "#e8c040" : "#e84a3a";
    ctx.fillRect(b.x - b.w / 2, b.y, b.w * Math.max(0, b.k), th);
    if (b.prog >= 0) { ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(b.x - b.w / 2 - 1, b.y + th + 2, b.w + 2, th); ctx.fillStyle = "#7ac8ff"; ctx.fillRect(b.x - b.w / 2, b.y + th + 2.5, b.w * b.prog, th - 1); }
    if (b.hero) { ctx.fillStyle = "#ffe9a8"; ctx.font = "700 " + Math.round(9 / Math.max(0.6, z)) + "px system-ui"; ctx.textAlign = "right"; ctx.fillText(String(b.hero), b.x - b.w / 2 - 3, b.y + th + 1); }
  }
  bars.length = 0;
  // placing a building
  const gh = view.ghost;
  if (gh) {
    const d = BUILDINGS[gh.type];
    if (gh.type !== "wall") {
      const s = buildingSprite({ type: gh.type, w: d.w, h: d.h, team: 0 }, G.era);
      ctx.globalAlpha = 0.55; ctx.drawImage(s.c, gh.tx * TILE - s.ox, gh.ty * TILE - s.oy, s.w, s.h); ctx.globalAlpha = 1;
    }
    for (let j = 0; j < d.h; j++) for (let i = 0; i < d.w; i++) {
      const ok = gh.ok && G.world.buildable(gh.tx + i, gh.ty + j);
      ctx.fillStyle = gh.ok ? "rgba(90,255,140,0.28)" : ok ? "rgba(255,200,90,0.3)" : "rgba(255,70,70,0.35)";
      ctx.fillRect((gh.tx + i) * TILE + 1, (gh.ty + j) * TILE + 1, TILE - 2, TILE - 2);
    }
    if (view.wallLine) {
      const w = view.wallLine; ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo((w.tx0 + 0.5) * TILE, (w.ty0 + 0.5) * TILE); ctx.lineTo((w.tx1 + 0.5) * TILE, (w.ty1 + 0.5) * TILE); ctx.stroke(); ctx.setLineDash([]);
    }
    if (gh.why && !gh.ok) { ctx.fillStyle = "#fff"; ctx.font = "600 " + Math.round(12 / Math.max(0.6, z)) + "px system-ui"; ctx.textAlign = "center"; ctx.fillText(gh.why, (gh.tx + d.w / 2) * TILE, gh.ty * TILE - 10); }
  }
  // aiming a skill
  const am = view.aim;
  if (am) {
    const u = G.ents.get(am.uid);
    if (u) {
      const col = ERAS[G.era].energy;
      ctx.strokeStyle = hexA(col, 0.5); ctx.lineWidth = 1.5; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.ellipse(u.dx, u.dy, am.range, am.range * 0.62, 0, 0, 6.3); ctx.stroke(); ctx.setLineDash([]);
      if (am.kind === "dir") {
        const a = Math.atan2(am.y - u.y, am.x - u.x), L = am.range;
        ctx.fillStyle = hexA(col, 0.25); ctx.save(); ctx.translate(u.dx, u.dy); ctx.rotate(a); ctx.fillRect(0, -8, L, 16); ctx.restore();
      } else if (am.kind === "ground") {
        ctx.fillStyle = hexA(col, 0.25); ctx.beginPath(); ctx.ellipse(am.x, am.y, am.r || 20, (am.r || 20) * 0.62, 0, 0, 6.3); ctx.fill();
        ctx.strokeStyle = hexA(col, 0.9); ctx.stroke();
      } else if (am.target) {
        const t = G.ents.get(am.target); if (t) { ctx.strokeStyle = "#ff6a6a"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(t.dx || t.x, (t.dy || t.y) - 6, 16, 0, 6.3); ctx.stroke(); }
      }
    }
  }
  // pings: alarms, scans, rumours
  const now = performance.now() / 1000;
  view.pings = view.pings.filter((p) => now - p.t < (p.life || 2.5));
  for (const p of view.pings) {
    const k = (now - p.t) / (p.life || 2.5);
    for (let i = 0; i < 2; i++) {
      const kk = (k * 2 + i * 0.5) % 1;
      ctx.strokeStyle = hexA(p.col, (1 - kk) * 0.8); ctx.lineWidth = 2 / Math.max(0.5, z);
      ctx.beginPath(); ctx.ellipse(p.x, p.y, (p.r || 40) * kk + 6, ((p.r || 40) * kk + 6) * 0.62, 0, 0, 6.3); ctx.stroke();
    }
  }
}
export function ping(x, y, col, r, life) { view.pings.push({ x, y, col, r, life, t: performance.now() / 1000 }); }
export function follow() {
  const u = manual.uid ? G.ents.get(manual.uid) : view.follow ? G.ents.get(view.follow) : null;
  if (!u || u.dead) { view.follow = 0; return false; }
  const c = view.cam;
  c.x += (u.x - c.x) * 0.15; c.y += (u.y - c.y) * 0.15;
  return true;
}
export { LINES };

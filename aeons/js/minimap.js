/* minimap.js — the whole realm, small.
 *
 * One pixel per tile, kept in an offscreen picture the size of the border and
 * repainted a chunk at a time when that chunk is explored further or changes.
 * Over it, every frame it is drawn: your things, enemies in sight, the ghosts
 * of enemy buildings you have seen, contacts (the red diamonds — enemies you
 * saw and lost, or that radar hears), alarms, and the camera's frame. The map
 * grows with the border, and is redrawn whole when it does. */

import { G } from "./state.js";
import { TILE, CHUNK } from "./data.js";
import { T } from "./world.js";
import { seen } from "./fog.js";
import { mk } from "./terrain.js";
import { TEAM } from "./sprites.js";
import { view } from "./render.js";

let cv, ctx, img = null, ictx = null, bkey = "", revs = new Map();
const COL = {
  [T.DEEP]: [30, 74, 104], [T.WATER]: [45, 106, 136], [T.SAND]: [205, 185, 133], [T.DIRT]: [138, 106, 72], [T.ROCK]: [128, 122, 114]
};
const GRASS = [[90, 138, 60], [164, 154, 90], [214, 222, 226]], FOREST = [[47, 90, 40], [106, 106, 52], [42, 74, 58]];

export function initMinimap(canvas) { cv = canvas; ctx = cv.getContext("2d"); }
export function size() { return { w: cv.clientWidth, h: cv.clientHeight }; }
function layout() {
  const b = G.world.bounds, bw = b.x1 - b.x0, bh = b.y1 - b.y0, w = cv.width, h = cv.height;
  const s = Math.min(w / bw, h / bh);
  return { s, ox: (w - bw * s) / 2, oy: (h - bh * s) / 2, b };
}
/** A point on the minimap (CSS px inside the canvas) as a world point. */
export function toWorld(mx, my) {
  const L = layout(), k = cv.width / cv.clientWidth;
  return { x: ((mx * k - L.ox) / L.s + L.b.x0) * TILE, y: ((my * k - L.oy) / L.s + L.b.y0) * TILE };
}

function paintChunk(c) {
  const b = G.world.bounds, W = G.world;
  const x0 = c.cx * CHUNK, y0 = c.cy * CHUNK;
  const d = ictx.createImageData(CHUNK, CHUNK), p = d.data;
  for (let j = 0; j < CHUNK; j++) for (let i = 0; i < CHUNK; i++) {
    const k = j * CHUNK + i, o = k * 4;
    if (!c.exp[k]) { p[o] = 6; p[o + 1] = 7; p[o + 2] = 12; p[o + 3] = 255; continue; }
    const t = c.t[k];
    let col = COL[t];
    if (!col) { const bio = W.biome(x0 + i, y0 + j); col = t === T.FOREST ? FOREST[bio] : GRASS[bio]; }
    p[o] = col[0]; p[o + 1] = col[1]; p[o + 2] = col[2]; p[o + 3] = 255;
  }
  ictx.putImageData(d, x0 - b.x0, y0 - b.y0);
}

export function drawMinimap() {
  if (!cv || !G.world) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const want = Math.round(cv.clientWidth * dpr), wantH = Math.round(cv.clientHeight * dpr);
  if (cv.width !== want || cv.height !== wantH) { cv.width = want; cv.height = wantH; }
  const b = G.world.bounds, key = b.x0 + "," + b.y0 + "," + b.x1 + "," + b.y1;
  if (key !== bkey) { bkey = key; img = mk(b.x1 - b.x0, b.y1 - b.y0); ictx = img.getContext("2d"); ictx.fillStyle = "#06070c"; ictx.fillRect(0, 0, img.width, img.height); revs = new Map(); }
  for (const c of G.world.chunks.values()) {
    const x0 = c.cx * CHUNK, y0 = c.cy * CHUNK;
    if (x0 < b.x0 || y0 < b.y0 || x0 >= b.x1 || y0 >= b.y1) continue;
    const r = (c.rev || 0) * 100000 + (c.expRev || 0) + 1;
    const k = c.cx * 100003 + c.cy;
    if (revs.get(k) === r) continue;
    revs.set(k, r);
    paintChunk(c);
  }
  const L = layout(), s = L.s;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#04050a"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, L.ox, L.oy, img.width * s, img.height * s);
  const P = (x, y) => [L.ox + (x / TILE - b.x0) * s, L.oy + (y / TILE - b.y0) * s];
  const dot = Math.max(1.5, s * 1.2) * dpr * 0.8;
  // ghosts first, then what is really there
  ctx.fillStyle = "rgba(200,60,70,0.6)";
  for (const gh of G.ghosts.values()) { const [x, y] = P(gh.tx * TILE, gh.ty * TILE); ctx.fillRect(x, y, Math.max(2, gh.w * s), Math.max(2, gh.h * s)); }
  for (const n of G.world.nodes.values()) {
    if (!G.world.chunkAt(n.tx, n.ty).exp[G.world.idx(n.tx, n.ty)]) continue;
    ctx.fillStyle = n.type === "gold" ? "#f4d03f" : n.type === "stone" ? "#c8ccd0" : n.type === "oil" ? "#222" : n.type === "aether" ? "#d38bff" : "#9fe8d0";
    const [x, y] = P(n.x, n.y); ctx.fillRect(x - dot, y - dot, dot * 2, dot * 2);
  }
  for (const bd of G.blds) {
    if (bd.dead || (bd.team !== 0 && !seen(bd))) continue;
    ctx.fillStyle = TEAM[bd.team].main;
    const [x, y] = P(bd.tx * TILE, bd.ty * TILE); ctx.fillRect(x, y, Math.max(2.5, bd.w * s), Math.max(2.5, bd.h * s));
  }
  for (const u of G.units) {
    if (u.dead || u.hidden || (u.team !== 0 && !seen(u))) continue;
    ctx.fillStyle = u.hero ? "#ffe9a8" : u.team === 0 ? TEAM[0].light : "#ff5a5a";
    const [x, y] = P(u.x, u.y); const r = u.hero ? dot * 1.6 : dot;
    ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
  // contacts and alarms
  const now = G.time;
  for (const c of G.intel.contacts) {
    const age = now - c.seen;
    if (age < 0.8 && c.src === 2) continue;
    const [x, y] = P(c.x, c.y), r = (3 + Math.min(5, c.n * 0.4)) * dpr;
    ctx.globalAlpha = Math.max(0.25, 1 - age / 120);
    ctx.strokeStyle = c.src === 1 ? "#ffbe5a" : "#ff5a5a"; ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.stroke();
    const sp = Math.hypot(c.vx, c.vy);
    if (sp > 4) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + c.vx / sp * r * 2.5, y + c.vy / sp * r * 2.5); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  for (const a of G.intel.alerts) {
    const age = now - a.t;
    if (age > 12) continue;
    const [x, y] = P(a.x, a.y), r = (4 + (age * 8) % 8) * dpr;
    ctx.strokeStyle = "rgba(255,80,70," + (1 - age / 12) + ")"; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.stroke();
  }
  for (const p of view.pings) { const [x, y] = P(p.x, p.y); ctx.strokeStyle = p.col; ctx.lineWidth = dpr; ctx.beginPath(); ctx.arc(x, y, ((p.r || 40) / TILE) * s + 3 * dpr, 0, 6.3); ctx.stroke(); }
  // the camera
  const c = view.cam, hw = view.W / 2 / c.z, hh = view.H / 2 / c.z;
  const [ax, ay] = P(c.x - hw, c.y - hh), [bx, by] = P(c.x + hw, c.y + hh);
  ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = dpr; ctx.strokeRect(ax, ay, bx - ax, by - ay);
}

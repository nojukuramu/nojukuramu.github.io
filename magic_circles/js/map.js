/* map.js — the world, from above, as far as you care to drag it.
 *
 * The Phaser build's MinimapSystem drew the walled arena it was in. An
 * endless world needs a map you can move, and a reason to open it: every
 * waystone you hold is a place you can step to. So: the lands coloured by
 * biome, the roads, every waystone (held ones lit), every structure you
 * have come within sight of (the great ones gold once their Warden is
 * beaten), you, and the seed in the corner. Tap a held waystone to go.
 *
 * It paints from world.js's cheap answers only — a chunk's biome, a chunk's
 * roads, a structure cell — never whole chunks, so a 900 m square costs a
 * few thousand lookups, all of them cached after the first time. */

import { S, emit } from "./state.js";
import { BIOMES, CHUNK, DIR, STRUCT_CELL, STRUCTURE_NAMES } from "./world.js";
import { seenSet, hasSigil, isAttuned, travelTo, journey } from "./game.js";

const $ = (id) => document.getElementById(id);
const V = { open: false, cx: 0, cz: 0, mpp: 2.2, drag: null, raf: 0, hits: [] };
const hex = (n) => "#" + n.toString(16).padStart(6, "0");

export function isOpen() { return V.open; }
export function openMap() {
  const P = S.player;
  if (!P) return;
  V.open = true; V.cx = P.x; V.cz = P.z;
  $("map").hidden = false;
  $("mapSeed").textContent = "Seed: " + (journey() ? journey().seed : "");
  requestDraw();
  emit("mapOpened");
}
export function closeMap() {
  if (!V.open) return;
  V.open = false;
  $("map").hidden = true;
  emit("mapClosed");
}
function requestDraw() { if (!V.raf) V.raf = requestAnimationFrame(() => { V.raf = 0; draw(); }); }

function draw() {
  if (!V.open || !S.world) return;
  const cv = $("mapCanvas"), W = S.world;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#0b1018"; g.fillRect(0, 0, w, h);
  const mpp = V.mpp;
  const X = (x) => w / 2 + (x - V.cx) / mpp, Z = (z) => h / 2 + (z - V.cz) / mpp;
  const x0 = V.cx - w / 2 * mpp, x1 = V.cx + w / 2 * mpp, z0 = V.cz - h / 2 * mpp, z1 = V.cz + h / 2 * mpp;
  const c0x = Math.floor(x0 / CHUNK), c1x = Math.floor(x1 / CHUNK), c0z = Math.floor(z0 / CHUNK), c1z = Math.floor(z1 / CHUNK);
  const px = CHUNK / mpp;
  for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
    const b = W.chunkBiome(cx, cz);
    g.fillStyle = hex(b === "Lake" ? 0x5d97b8 : BIOMES[b].ground);
    g.fillRect(X(cx * CHUNK) - 0.5, Z(cz * CHUNK) - 0.5, px + 1, px + 1);
  }
  g.strokeStyle = "rgba(240,224,186,0.85)"; g.lineWidth = Math.max(1, 3.2 / mpp); g.lineCap = "round";
  g.beginPath();
  for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
    const d = W.roadDirs(cx, cz);
    if (!d) continue;
    const mx = X(cx * CHUNK + CHUNK / 2), mz = Z(cz * CHUNK + CHUNK / 2);
    if (d & DIR.E) { g.moveTo(mx, mz); g.lineTo(mx + px, mz); }
    if (d & DIR.S) { g.moveTo(mx, mz); g.lineTo(mx, mz + px); }
  }
  g.stroke();
  // structures you have seen
  const seen = seenSet();
  const s0x = Math.floor((c0x + STRUCT_CELL / 2) / STRUCT_CELL) - 1, s1x = Math.floor((c1x + STRUCT_CELL / 2) / STRUCT_CELL) + 1;
  const s0z = Math.floor((c0z + STRUCT_CELL / 2) / STRUCT_CELL) - 1, s1z = Math.floor((c1z + STRUCT_CELL / 2) / STRUCT_CELL) + 1;
  g.font = "600 11px system-ui, sans-serif"; g.textAlign = "center";
  for (let i = s0x; i <= s1x; i++) for (let j = s0z; j <= s1z; j++) {
    const s = W.structureInCell(i, j);
    if (!s || !seen.has(s.id)) continue;
    g.strokeStyle = "rgba(0,0,0,0.5)"; g.lineWidth = 1;
    g.fillStyle = s.great ? (hasSigil(s.id) ? "#ffd97a" : "#ff6a7a") : "#e8ddc8";
    g.globalAlpha = 0.35;
    g.fillRect(X(s.ax * CHUNK), Z(s.az * CHUNK), s.w * px, s.h * px);
    g.globalAlpha = 1;
    g.beginPath(); g.arc(X(s.x), Z(s.z), s.great ? 6 : 4, 0, 7); g.fill(); g.stroke();
    if (mpp < 3.5) { g.fillStyle = "#fff"; g.fillText(STRUCTURE_NAMES[s.type], X(s.x), Z(s.z) - 10); }
  }
  // waystones
  V.hits = [];
  for (const ws of W.waystonesNear(V.cx, V.cz, Math.hypot(w, h) * mpp / 2 + CHUNK * 10)) {
    const sx = X(ws.x), sz = Z(ws.z);
    if (sx < -10 || sz < -10 || sx > w + 10 || sz > h + 10) continue;
    const held = isAttuned(ws.id);
    g.fillStyle = held ? "#8fd8ff" : "rgba(220,220,230,0.65)";
    g.strokeStyle = "#0b1018"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(sx, sz - 8); g.lineTo(sx + 5, sz + 5); g.lineTo(sx - 5, sz + 5); g.closePath(); g.fill(); g.stroke();
    if (held) { g.strokeStyle = "#8fd8ff"; g.lineWidth = 1.5; g.beginPath(); g.arc(sx, sz, 10, 0, 7); g.stroke(); V.hits.push({ ws, sx, sz }); }
  }
  // you
  const P = S.player;
  if (P) {
    g.save(); g.translate(X(P.x), Z(P.z)); g.rotate(P.aim);
    g.fillStyle = "#fff"; g.strokeStyle = "#000"; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(9, 0); g.lineTo(-6, 5.5); g.lineTo(-3, 0); g.lineTo(-6, -5.5); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
  // a scale bar: 100 m
  g.fillStyle = "#e8ddc8"; g.fillRect(16, h - 22, 100 / mpp, 3);
  g.font = "11px system-ui, sans-serif"; g.textAlign = "left"; g.fillText("100 m", 16, h - 28);
}

function tryTravel(px, pz) {
  let best = null, bd = 18;
  for (const h of V.hits) { const d = Math.hypot(h.sx - px, h.sz - pz); if (d < bd) { bd = d; best = h; } }
  if (!best) return;
  if (!confirm("Step through to this waystone?")) return;
  if (travelTo(best.ws)) closeMap();
}

export function init() {
  const cv = $("mapCanvas");
  const pointers = new Map();
  cv.addEventListener("pointerdown", (e) => {
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) V.drag = { x: e.clientX, y: e.clientY, cx: V.cx, cz: V.cz, moved: false };
    else if (pointers.size === 2) { const [a, b] = [...pointers.values()]; V.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mpp: V.mpp }; V.drag = null; }
  });
  cv.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (V.pinch && pointers.size >= 2) { const [a, b] = [...pointers.values()]; V.mpp = Math.min(8, Math.max(0.8, V.pinch.mpp * V.pinch.d / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)))); requestDraw(); return; }
    if (!V.drag) return;
    const dx = e.clientX - V.drag.x, dy = e.clientY - V.drag.y;
    if (Math.hypot(dx, dy) > 6) V.drag.moved = true;
    V.cx = V.drag.cx - dx * V.mpp; V.cz = V.drag.cz - dy * V.mpp;
    requestDraw();
  });
  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) V.pinch = null;
    if (V.drag && !V.drag.moved && e.type === "pointerup") { const r = cv.getBoundingClientRect(); tryTravel(e.clientX - r.left, e.clientY - r.top); }
    V.drag = null;
  };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);
  cv.addEventListener("wheel", (e) => { e.preventDefault(); V.mpp = Math.min(8, Math.max(0.8, V.mpp * Math.pow(1.0015, e.deltaY))); requestDraw(); }, { passive: false });
  $("mapClose").addEventListener("click", closeMap);
  $("mapHome").addEventListener("click", () => { if (S.player) { V.cx = S.player.x; V.cz = S.player.z; requestDraw(); } });
  addEventListener("resize", () => { if (V.open) requestDraw(); });
}

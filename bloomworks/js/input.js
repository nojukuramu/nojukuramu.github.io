/* input.js — fingers and mice on the world.
 *
 * One finger drags the camera; two pinch; a wheel zooms. A tap is a tap on
 * whatever is under it, and what that means depends on the mode the UI has
 * put us in: placing a type, laying Track (drag paints a path, each tile
 * pointing at the next), moving a copy, choosing a Blueprint's area or where
 * to stamp it, or linking a Courier. In no mode, a tap selects and taps. */

import { S, RT } from "./state.js";
import { cam, toWorld, toScreen, size } from "./render.js";
import { DX, DY, TYPES } from "./data.js";
import { copyAt, place, whyNot, sizeOf } from "./build.js";

export const mode = { kind: null, type: null, rot: 0, plan: false, copy: null, a: null, b: null, bp: null, onTap: null };
let handlers = {};
export function on(h) { handlers = h; }
const call = (name, ...a) => handlers[name] && handlers[name](...a);

const pointers = new Map();
let downAt = null, moved = false, pinch = null, laying = null, rectDrag = null, lastTapAt = 0;

export function init(canvas) {
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", cancel);
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("keydown", key);
}
function tileAtScreen(x, y) { const [wx, wy] = toWorld(x, y); return [Math.floor(wx), Math.floor(wy)]; }
export function zoomAt(f, sx, sy) {
  const [W, H] = size();
  if (sx == null) { sx = W / 2; sy = H / 2; }
  const [wx, wy] = toWorld(sx, sy);
  cam.z = Math.max(7, Math.min(110, cam.z * f));
  const [nx, ny] = toWorld(sx, sy);
  cam.x += wx - nx; cam.y += wy - ny;
}
function wheel(e) { e.preventDefault(); zoomAt(Math.pow(1.0015, -e.deltaY), e.offsetX, e.offsetY); call("interact"); }

function down(e) {
  call("interact");
  e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
  if (pointers.size === 2) {
    laying = null; rectDrag = null;
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
    return;
  }
  const [wx0, wy0] = toWorld(e.offsetX, e.offsetY);
  downAt = { x: e.offsetX, y: e.offsetY, cx: cam.x, cy: cam.y, wx: wx0, wy: wy0, button: e.button };
  moved = false;
  const pan = e.button === 1 || e.button === 2;
  if (!pan && mode.kind === "place" && mode.type === "track") {
    const [x, y] = tileAtScreen(e.offsetX, e.offsetY);
    laying = { last: null, placed: 0 };
    layTo(x, y);
  }
  if (!pan && mode.kind === "bpArea") {
    const [x, y] = tileAtScreen(e.offsetX, e.offsetY);
    rectDrag = { x0: x, y0: y, x1: x, y1: y };
    mode.a = [x, y]; mode.b = [x, y];
  }
}
function move(e) {
  const p = pointers.get(e.pointerId);
  if (p) { p.x = e.offsetX; p.y = e.offsetY; }
  if (!p) { RT.hover = tileAtScreen(e.offsetX, e.offsetY); return; }
  RT.hover = tileAtScreen(e.offsetX, e.offsetY);
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    zoomAt(d / pinch.d, cx, cy);
    const [ax, ay] = toWorld(pinch.cx, pinch.cy), [bx, by] = toWorld(cx, cy);
    cam.x += ax - bx; cam.y += ay - by;
    pinch.d = d; pinch.cx = cx; pinch.cy = cy;
    moved = true;
    return;
  }
  if (!downAt) return;
  const dx = e.offsetX - downAt.x, dy = e.offsetY - downAt.y;
  if (Math.hypot(dx, dy) > 8) moved = true;
  if (laying) { const [x, y] = tileAtScreen(e.offsetX, e.offsetY); layTo(x, y); return; }
  if (rectDrag) { const [x, y] = tileAtScreen(e.offsetX, e.offsetY); mode.b = [x, y]; return; }
  if (moved) {
    // Keep the ground point that was under the finger under the finger.
    cam.x = downAt.cx; cam.y = downAt.cy;
    const [wx, wy] = toWorld(e.offsetX, e.offsetY);
    cam.x += downAt.wx - wx; cam.y += downAt.wy - wy;
  }
}
function up(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size) return;
  if (laying) { const n = laying.placed; laying = null; downAt = null; if (n) call("changed"); return; }
  if (rectDrag) { rectDrag = null; downAt = null; call("bpAreaDone", mode.a, mode.b); return; }
  if (downAt && !moved && downAt.button !== 2) tap(e.offsetX, e.offsetY);
  downAt = null;
}
function cancel(e) { pointers.delete(e.pointerId); pinch = null; laying = null; rectDrag = null; downAt = null; }

/* Laying Track by drag: each new tile is placed, and the tile before it is
   turned to point at it, so a dragged path is a path motes follow. */
function layTo(x, y) {
  const L = laying;
  if (L.last && L.last[0] === x && L.last[1] === y) return;
  if (L.last) {
    // Fill a diagonal jump with an elbow so the path stays 4-connected.
    const [lx, ly] = L.last;
    if (lx !== x && ly !== y) { layTo(x, ly); return layTo(x, y); }
    if (Math.abs(lx - x) + Math.abs(ly - y) > 1) {
      const sx = Math.sign(x - lx), sy = Math.sign(y - ly);
      layTo(lx + sx, ly + sy); return layTo(x, y);
    }
    const dir = x > lx ? 0 : y > ly ? 1 : x < lx ? 2 : 3;
    const prev = copyAt(lx, ly);
    if (prev && prev.type === "track" && prev.rot !== dir) { prev.rot = dir; RT.layoutDirty = true; }
    mode.rot = dir;
  }
  const here = copyAt(x, y);
  if (!here) {
    const ok = call("placeAt", "track", x, y, L.last ? mode.rot : smartRot(x, y));
    if (ok) L.placed++;
  } else if (here.type === "track" && L.last) { here.rot = mode.rot; RT.layoutDirty = true; L.placed++; }
  L.last = [x, y];
}
/** A single Track tap faces away from whatever feeds it, or towards whatever will take from it. */
export function smartRot(x, y) {
  for (let d = 0; d < 4; d++) {
    const o = copyAt(x - DX[d], y - DY[d]);
    if (o && o.k && o.k.out && o.k.out[0] === x && o.k.out[1] === y) return d;
  }
  for (let d = 0; d < 4; d++) {
    const o = copyAt(x + DX[d], y + DY[d]);
    if (o && o.type !== "track" && TYPES[o.type].fam !== "source") return d;
  }
  return mode.rot;
}

function tap(sx, sy) {
  const [x, y] = tileAtScreen(sx, sy);
  const now = performance.now();
  const dbl = now - lastTapAt < 300; lastTapAt = now;
  // The Golden Moth is caught by a tap near it, whatever the mode.
  if (RT.moth) {
    const [mx, my] = toScreen(RT.moth.x, RT.moth.y, 1.4);
    if (Math.hypot(mx - sx, my - sy) < Math.max(40, cam.z * 1.2)) { call("moth"); return; }
  }
  if (mode.kind === "place") { const n = sizeOf(mode.type), ox = x - Math.floor((n - 1) / 2), oy = y - Math.floor((n - 1) / 2); call("placeAt", mode.type, ox, oy, mode.type === "track" ? smartRot(x, y) : mode.rot, true); return; }
  if (mode.kind === "move") { call("moveTo", mode.copy, x - Math.floor((sizeOf(mode.copy.type) - 1) / 2), y - Math.floor((sizeOf(mode.copy.type) - 1) / 2)); return; }
  if (mode.kind === "stamp") { call("stampAt", x, y); return; }
  if (mode.kind === "link") { const c = copyAt(x, y); call("linkTo", c); return; }
  if (mode.kind === "bpArea") { return; }
  call("tapTile", x, y, dbl);
}

function key(e) {
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA")) return;
  call("interact");
  const k = e.key.toLowerCase();
  if (k === "r") { mode.rot = (mode.rot + 1) & 3; call("rotated"); }
  else if (k === "escape") call("escape");
  else if (k === "z") call("zen");
  else if (k === "b") call("panel", "build");
  else if (k === "l") call("panel", "levels");
  else if (k === "=" || k === "+") zoomAt(1.2);
  else if (k === "-") zoomAt(1 / 1.2);
  else if (k === "arrowleft" || k === "a") cam.x -= 2;
  else if (k === "arrowright" || k === "d") cam.x += 2;
  else if (k === "arrowup" || k === "w") cam.y -= 2;
  else if (k === "arrowdown" || k === "s") cam.y += 2;
  else if (k === "h") { cam.x = 5; cam.y = 5; }
}
export { place, whyNot };

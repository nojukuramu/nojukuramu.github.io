/* input.js — fingers, a mouse and a keyboard, turned into orders.
 *
 * Touch first. One finger drags the camera; two pinch and pan it. A tap does
 * the obvious thing: selects what is yours, or — with units selected — sends
 * them at whatever was tapped (ground, an enemy, a tree, a vein, a
 * foundation). Press and hold, then drag, and you draw a selection box;
 * press and hold without dragging and the selection attack-moves there.
 * Double-tap a unit for every one of its kind on screen.
 *
 * With a mouse it is the classic arrangement: left selects (drag for a box),
 * right orders, the wheel zooms, the edges and WASD pan.
 *
 * Every screen position comes in through toApp() (orient.js), so all of this
 * still works when the whole game has been turned a quarter turn to play
 * sideways on a phone held upright. */

import { G, emit } from "./state.js";
import { TILE, BUILDINGS, HEROES, LINES } from "./data.js";
import { view, toWorld, pickAt, unitsInBox, clampCam, ping, posOf } from "./render.js";
import { toApp, appRect } from "./orient.js";
import { smart, setOrder, moveGroup, patrol, stop, isMilitary } from "./units.js";
import { canPlace, startBuilding, wallLine, snap, cancel as cancelQ } from "./buildings.js";
import { manual, possess, release, cast, controlled, skillsOf } from "./heroes.js";
import { settings } from "./save.js";
import { toWorld as mmWorld } from "./minimap.js";
import * as audio from "./audio.js";
import { seen } from "./fog.js";

export const mode = { kind: null, type: null, cmd: null, label: "", tx: 0, ty: 0, wall0: null, src: null };
export let hotkey = null;
export function onHotkey(fn) { hotkey = fn; }
let lastAlpha = 1;
export function setAlpha(k) { lastAlpha = k; }

/* ---------------- selection ---------------- */
export function selected() { return G.sel.map((id) => G.ents.get(id) || G.world.nodes.get(id)).filter((e) => e && !e.dead); }
export function select(list, add) {
  for (const e of selected()) e.sel = false;
  let ids = add ? G.sel.slice() : [];
  for (const e of list) {
    if (!e) continue;
    const i = ids.indexOf(e.id);
    if (add && i >= 0 && list.length === 1) ids.splice(i, 1);
    else if (i < 0) ids.push(e.id);
  }
  // units and buildings do not mix; yours and theirs do not mix
  const ents = ids.map((id) => G.ents.get(id) || G.world.nodes.get(id)).filter(Boolean);
  const mineUnits = ents.filter((e) => e.kind === "unit" && e.team === 0);
  let keep = mineUnits.length ? mineUnits : ents.filter((e) => e.team === 0).length ? ents.filter((e) => e.team === 0) : ents.slice(-1);
  if (keep.length > 1 && keep.some((e) => e.kind === "bld")) { const t = keep[0].type; keep = keep.filter((e) => e.kind === "bld" && e.type === t); }
  keep = keep.slice(0, 120);
  G.sel = keep.map((e) => e.id);
  for (const e of keep) e.sel = true;
  emit("selection", keep);
}
export function clearSel() { select([]); }
const myUnits = () => selected().filter((e) => e.kind === "unit" && e.team === 0);

/* ---------------- modes: placing and targeting ---------------- */
export function beginPlace(type) {
  cancelMode();
  mode.kind = "place"; mode.type = type;
  const c = toWorld(view.W / 2, view.H * 0.45), d = BUILDINGS[type];
  mode.tx = Math.floor(c.x / TILE - d.w / 2 + 0.5); mode.ty = Math.floor(c.y / TILE - d.h / 2 + 0.5);
  view.showTerritory = !d.anywhere;
  updateGhost();
  emit("mode", mode);
}
export function beginTarget(cmd, label, src) {
  cancelMode();
  mode.kind = "target"; mode.cmd = cmd; mode.label = label; mode.src = src || null;
  emit("mode", mode);
}
export function cancelMode() {
  mode.kind = null; mode.type = null; mode.cmd = null; mode.wall0 = null; mode.src = null;
  view.ghost = null; view.wallLine = null; view.showTerritory = false;
  emit("mode", mode);
}
function updateGhost() {
  const s = snap(mode.type, mode.tx, mode.ty);
  const c = canPlace(mode.type, s.tx, s.ty, 0);
  view.ghost = { type: mode.type, tx: s.tx, ty: s.ty, ok: c.ok, why: c.why };
}
export function confirmPlace(keep) {
  if (mode.kind !== "place") return;
  const ws = myUnits().filter((u) => u.line === "worker");
  if (mode.type === "wall" && mode.wall0) {
    wallLine(mode.wall0.tx, mode.wall0.ty, mode.tx, mode.ty, ws);
    mode.wall0 = null; view.wallLine = null;
    if (!keep) cancelMode();
    return;
  }
  const g = view.ghost;
  if (!g || !g.ok) { audio.play("error"); emit("toast", (g && g.why) || "Cannot build there", "bad"); return; }
  const b = startBuilding(mode.type, g.tx, g.ty, ws, keep);
  if (b) { audio.play("build"); if (!keep) cancelMode(); else updateGhost(); }
}
function placeAt(x, y) {
  const d = BUILDINGS[mode.type];
  mode.tx = Math.floor(x / TILE - d.w / 2 + 0.5); mode.ty = Math.floor(y / TILE - d.h / 2 + 0.5);
  if (mode.wall0) view.wallLine = { tx0: mode.wall0.tx, ty0: mode.wall0.ty, tx1: mode.tx, ty1: mode.ty };
  updateGhost();
}
function doTarget(p, queue) {
  const us = myUnits(), cmd = mode.cmd;
  if (cmd === "rally" || cmd === "muster") {
    const r = { x: p.x, y: p.y };
    if (p.ent && p.ent.kind === "node") r.node = p.ent.id;
    if (p.tree) r.tree = p.tree;
    if (cmd === "muster") G.auto.muster = r;
    else for (const b of selected()) if (b.kind === "bld") b.rally = r;
    ping(p.x, p.y, "#7dffb0", 20, 1);
  } else if (cmd === "amove") { moveGroup(us, p.x, p.y, "amove", queue); ping(p.x, p.y, "#ff6a6a", 24, 0.8); }
  else if (cmd === "move") { moveGroup(us, p.x, p.y, "move", queue); ping(p.x, p.y, "#7dffb0", 24, 0.8); }
  else if (cmd === "patrol") { patrol(us, p.x, p.y); ping(p.x, p.y, "#ffe9a8", 24, 0.8); }
  else if (cmd === "attack") { if (p.ent && p.ent.team === 1) for (const u of us) setOrder(u, { t: "attack", id: p.ent.id }, queue); else moveGroup(us, p.x, p.y, "amove", queue); }
  else if (cmd === "repair") { if (p.ent && p.ent.kind === "bld" && p.ent.team === 0) for (const u of us.filter((u) => u.line === "worker")) setOrder(u, { t: p.ent.built < 1 ? "build" : "repair", id: p.ent.id }, queue); }
  else if (cmd && cmd.startsWith("skill:")) {
    const i = +cmd.slice(6), u = mode.src && G.ents.get(mode.src);
    if (u) cast(u, i, p.ent && p.ent.team === 1 ? { id: p.ent.id, x: p.x, y: p.y } : { x: p.x, y: p.y });
  }
  audio.play("ack");
  if (!queue) cancelMode();
}

/* ---------------- what a tap or a click means ---------------- */
let lastTap = { t: 0, id: 0 };
function tap(sx, sy, touch, shift) {
  const p = pickAt(sx, sy, lastAlpha);
  if (mode.kind === "target") { doTarget(p, shift); return; }
  if (mode.kind === "place") {
    if (touch) { placeAt(p.x, p.y); if (mode.type === "wall" && !mode.wall0) { mode.wall0 = { tx: mode.tx, ty: mode.ty }; emit("mode", mode); } }
    else { if (mode.type === "wall" && !mode.wall0) { mode.wall0 = { tx: mode.tx, ty: mode.ty }; emit("mode", mode); } else confirmPlace(shift); }
    return;
  }
  const hero = controlled();
  if (hero) {
    if (p.ent && (p.ent.kind === "unit" || p.ent.kind === "bld") && p.ent.team === 1) { manual.target = p.ent.id; manual.moveTo = null; }
    else { manual.moveTo = { x: p.x, y: p.y }; manual.target = 0; ping(p.x, p.y, "#7dffb0", 14, 0.6); }
    return;
  }
  const e = p.ent;
  const now = performance.now(), dbl = e && lastTap.id === e.id && now - lastTap.t < 340;
  lastTap = { t: now, id: e ? e.id : 0 };
  const us = myUnits();
  if (e && e.kind === "unit" && e.team === 0) {
    if (dbl) { select(onScreen((u) => u.team === 0 && u.line === e.line && !!u.hero === !!e.hero)); return; }
    select([e], shift); audio.play("select"); return;
  }
  if (touch && us.length && e && e.kind === "bld" && e.team === 0 && us.some((u) => u.line === "worker") && (e.built < 1 || e.hp < e.maxHp)) { smart(us, p.x, p.y, e, null, shift); audio.play("ack"); return; }
  if (e && e.kind === "bld" && e.team === 0) {
    if (dbl) { select(G.blds.filter((b) => !b.dead && b.team === 0 && b.type === e.type && onScreenPt(b.x, b.y))); return; }
    select([e], shift); audio.play("select"); return;
  }
  if (touch && us.length) { order(us, p, shift); return; }
  if (e) { select([e]); return; }
  if (!shift) clearSel();
}
function order(us, p, queue) {
  smart(us, p.x, p.y, p.ent, p.tree, queue);
  audio.play("ack");
  const col = p.ent && p.ent.team === 1 ? "#ff6a6a" : p.ent || p.tree ? "#ffe9a8" : "#7dffb0";
  ping(p.ent ? p.ent.x : p.x, p.ent ? p.ent.y : p.y, col, 18, 0.7);
}
/** Press-and-hold, released without moving: attack-move there. */
function hold(sx, sy) {
  const us = myUnits();
  if (!us.length || mode.kind) return;
  const p = toWorld(sx, sy);
  moveGroup(us, p.x, p.y, "amove");
  ping(p.x, p.y, "#ff6a6a", 30, 1);
  audio.play("ack");
  emit("toast", "Attack-move", "info");
}
function onScreenPt(x, y) { const a = toWorld(0, 0), b = toWorld(view.W, view.H); return x >= a.x && x <= b.x && y >= a.y && y <= b.y; }
function onScreen(f) { return G.units.filter((u) => !u.dead && !u.hidden && f(u) && onScreenPt(u.x, u.y)); }

/* ---------------- pointers on the battlefield ---------------- */
const pts = new Map();
let single = null, pinch = null, boxMode = false;
export function setBoxMode(on) { boxMode = on; }
export const isBoxMode = () => boxMode;

function down(e) {
  if (e.target.id !== "view") return;
  audio.unlock();
  const a = toApp(e.clientX, e.clientY), touch = e.pointerType !== "mouse";
  pts.set(e.pointerId, { x: a.x, y: a.y });
  try { e.target.setPointerCapture(e.pointerId); } catch (er) {}
  if (!touch) {
    if (e.button === 2) { rightClick(a.x, a.y, e.shiftKey); return; }
    if (e.button === 1) { single = { x0: a.x, y0: a.y, pan: true, cam: { ...view.cam }, mouse: true, mid: true }; return; }
    single = { x0: a.x, y0: a.y, t0: performance.now(), moved: false, box: false, mouse: true, shift: e.shiftKey, cam: { ...view.cam } };
    return;
  }
  if (pts.size === 1) {
    single = { x0: a.x, y0: a.y, t0: performance.now(), moved: false, box: boxMode && !mode.kind && !controlled(), lp: false, cam: { ...view.cam }, id: e.pointerId };
    single.timer = setTimeout(() => { if (single && !single.moved && !single.box) { single.lp = true; single.box = !mode.kind && !controlled(); if (navigator.vibrate) try { navigator.vibrate(12); } catch (er) {} } }, 430);
    if (mode.kind === "place") { const p = toWorld(a.x, a.y - 56); placeAt(p.x, p.y); }
  } else if (pts.size === 2) {
    if (single && single.timer) clearTimeout(single.timer);
    single = null; view.box = null;
    const [p1, p2] = [...pts.values()];
    pinch = { d0: Math.hypot(p1.x - p2.x, p1.y - p2.y), m0: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, cam: { ...view.cam } };
  }
}
function move(e) {
  const a = toApp(e.clientX, e.clientY);
  if (e.pointerType === "mouse") { mouse.x = a.x; mouse.y = a.y; mouse.in = true; if (mode.kind === "place" && !single) { const p = toWorld(a.x, a.y); placeAt(p.x, p.y); } }
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, { x: a.x, y: a.y });
  if (pinch && pts.size >= 2) {
    const [p1, p2] = [...pts.values()];
    const d = Math.hypot(p1.x - p2.x, p1.y - p2.y), m = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const c = view.cam, z = Math.max(0.3, Math.min(2.4, pinch.cam.z * d / Math.max(20, pinch.d0)));
    // the point under the fingers stays under the fingers
    const wx = pinch.cam.x + (pinch.m0.x - view.W / 2) / pinch.cam.z, wy = pinch.cam.y + (pinch.m0.y - view.H / 2) / pinch.cam.z;
    c.z = z; c.x = wx - (m.x - view.W / 2) / z; c.y = wy - (m.y - view.H / 2) / z;
    clampCam();
    return;
  }
  if (!single) return;
  const dx = a.x - single.x0, dy = a.y - single.y0, dist = Math.hypot(dx, dy);
  if (single.mid) { view.cam.x = single.cam.x - dx / view.cam.z; view.cam.y = single.cam.y - dy / view.cam.z; clampCam(); return; }
  if (!single.moved && dist > (single.mouse ? 6 : 10)) { single.moved = true; if (single.timer) clearTimeout(single.timer); if (single.mouse && !mode.kind) single.box = true; }
  if (!single.moved) return;
  if (mode.kind === "place" && (!single.mouse || mode.type === "wall")) { const p = toWorld(a.x, a.y - (single.mouse ? 0 : 56)); placeAt(p.x, p.y); return; }
  if (single.box) { view.box = { x0: single.x0, y0: single.y0, x1: a.x, y1: a.y }; return; }
  if (!single.mouse) { view.cam.x = single.cam.x - dx / view.cam.z; view.cam.y = single.cam.y - dy / view.cam.z; clampCam(); view.follow = 0; }
}
function up(e) {
  const had = pts.has(e.pointerId);
  pts.delete(e.pointerId);
  if (!had) return;
  const a = toApp(e.clientX, e.clientY);
  if (pinch) { if (pts.size < 2) pinch = null; single = null; return; }
  const s = single; single = null;
  if (!s) return;
  if (s.timer) clearTimeout(s.timer);
  if (s.mid) return;
  if (s.box && view.box) {
    const us = unitsInBox(view.box.x0, view.box.y0, view.box.x1, view.box.y1, lastAlpha);
    view.box = null;
    select(us, s.shift); if (us.length) audio.play("select");
    return;
  }
  view.box = null;
  if (s.lp && !s.moved) { hold(a.x, a.y); return; }
  if (!s.moved) tap(a.x, a.y, !s.mouse, s.shift || e.shiftKey);
  else if (mode.kind === "place" && !s.mouse && mode.type === "wall" && !mode.wall0) { mode.wall0 = { tx: mode.tx, ty: mode.ty }; emit("mode", mode); }
}
function rightClick(sx, sy, shift) {
  if (mode.kind) { cancelMode(); return; }
  const p = pickAt(sx, sy, lastAlpha);
  const hero = controlled();
  if (hero) { if (p.ent && p.ent.team === 1) { manual.target = p.ent.id; manual.moveTo = null; } else { manual.moveTo = { x: p.x, y: p.y }; manual.target = 0; ping(p.x, p.y, "#7dffb0", 14, 0.6); } return; }
  const us = myUnits();
  if (us.length) { order(us, p, shift); return; }
  // a building selected: right click sets its rally point
  const bs = selected().filter((b) => b.kind === "bld" && b.team === 0);
  if (bs.length) { mode.cmd = "rally"; doTarget(p, false); }
}
const mouse = { x: 0, y: 0, in: false };
function wheel(e) {
  if (e.target.id !== "view") return;
  e.preventDefault();
  const a = toApp(e.clientX, e.clientY), c = view.cam;
  const w = toWorld(a.x, a.y);
  c.z = Math.max(0.3, Math.min(2.4, c.z * Math.pow(1.0018, -e.deltaY)));
  c.x = w.x - (a.x - view.W / 2) / c.z; c.y = w.y - (a.y - view.H / 2) / c.z;
  clampCam();
}

/* ---------------- the minimap ---------------- */
function minimapDrag(el) {
  let dragging = false;
  const go = (e) => {
    const r = appRect(el.getBoundingClientRect()), a = toApp(e.clientX, e.clientY);
    const w = mmWorld(a.x - r.left, a.y - r.top);
    if (e.button === 2 && myUnits().length) { order(myUnits(), { x: w.x, y: w.y }, e.shiftKey); return; }
    view.cam.x = w.x; view.cam.y = w.y; view.follow = 0; clampCam();
  };
  el.addEventListener("pointerdown", (e) => { audio.unlock(); dragging = e.button !== 2; try { el.setPointerCapture(e.pointerId); } catch (er) {} go(e); e.preventDefault(); });
  el.addEventListener("pointermove", (e) => { if (dragging) go(e); });
  el.addEventListener("pointerup", () => { dragging = false; });
  el.addEventListener("contextmenu", (e) => e.preventDefault());
}

/* ---------------- the champion's stick and skills ---------------- */
function stick() {
  const zone = document.getElementById("stickZone"), base = document.getElementById("stickBase"), knob = document.getElementById("stickKnob");
  let id = null, cx = 0, cy = 0;
  const R = 46;
  const set = (x, y) => {
    let dx = x - cx, dy = y - cy; const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knob.style.transform = "translate(" + dx + "px," + dy + "px)";
    manual.mx = dx / R; manual.my = dy / R;
  };
  zone.addEventListener("pointerdown", (e) => {
    if (id !== null) return;
    id = e.pointerId; try { zone.setPointerCapture(id); } catch (er) {}
    const a = toApp(e.clientX, e.clientY), r = appRect(zone.getBoundingClientRect());
    cx = a.x; cy = a.y;
    base.style.left = (a.x - r.left) + "px"; base.style.top = (a.y - r.top) + "px"; base.classList.add("on");
    set(a.x, a.y); e.preventDefault();
  });
  zone.addEventListener("pointermove", (e) => { if (e.pointerId !== id) return; const a = toApp(e.clientX, e.clientY); set(a.x, a.y); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; manual.mx = manual.my = 0; knob.style.transform = ""; base.classList.remove("on"); };
  zone.addEventListener("pointerup", end); zone.addEventListener("pointercancel", end);

  const atk = document.getElementById("mAttack");
  let atkTimer = null;
  atk.addEventListener("pointerdown", (e) => { manual.attack = true; manual.target = 0; atkTimer = setInterval(() => { if (!manual.target) manual.attack = true; }, 300); e.preventDefault(); });
  const atkEnd = () => { clearInterval(atkTimer); atkTimer = null; };
  atk.addEventListener("pointerup", atkEnd); atk.addEventListener("pointercancel", atkEnd);
  document.getElementById("mRelease").addEventListener("click", () => release());

  document.querySelectorAll("#skillPad .sk").forEach((btn) => {
    let aim = null;
    btn.addEventListener("pointerdown", (e) => {
      const u = controlled(); if (!u) return;
      const a = toApp(e.clientX, e.clientY);
      aim = { x0: a.x, y0: a.y, i: +btn.dataset.sk, moved: false, id: e.pointerId };
      try { btn.setPointerCapture(e.pointerId); } catch (er) {}
      e.preventDefault();
    });
    btn.addEventListener("pointermove", (e) => {
      if (!aim || e.pointerId !== aim.id) return;
      const u = controlled(); if (!u) return;
      const a = toApp(e.clientX, e.clientY), dx = a.x - aim.x0, dy = a.y - aim.y0, d = Math.hypot(dx, dy);
      if (d > 14) aim.moved = true;
      if (!aim.moved || !u.hero) return;
      const S = HEROES[u.hero].skills[aim.i], range = S.range * TILE;
      const k = Math.min(1, d / 90);
      const px = u.x + (d ? dx / d : 0) * range * (S.aim === "dir" ? 1 : k), py = u.y + (d ? dy / d : 0) * range * (S.aim === "dir" ? 1 : k);
      view.aim = { uid: u.id, kind: S.aim === "target" ? "target" : S.aim, x: px, y: py, range, r: (S.radius || 1.2) * TILE, cancel: d < 14 };
      if (S.aim === "target") { const p = pickNear(px, py, u); view.aim.target = p ? p.id : 0; }
    });
    const end = (e) => {
      if (!aim || e.pointerId !== aim.id) return;
      const u = controlled(), a = aim; aim = null;
      const am = view.aim; view.aim = null;
      if (!u) return;
      if (!a.moved) { if (cast(u, a.i)) audio.play("magic"); else audio.play("error"); return; }
      if (!am || am.cancel) return;
      const ok = am.kind === "target" ? (am.target ? cast(u, a.i, { id: am.target }) : false) : cast(u, a.i, { x: am.x, y: am.y });
      audio.play(ok ? "magic" : "error");
    };
    btn.addEventListener("pointerup", end); btn.addEventListener("pointercancel", end);
  });
}
function pickNear(x, y, u) {
  let best = null, bd = 3 * TILE;
  for (const e of G.units) { if (e.dead || e.team === u.team || !seen(e)) continue; const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; } }
  return best;
}

/* ---------------- keys ---------------- */
const keys = new Set();
let lastGroup = { i: -1, t: 0 };
function keydown(e) {
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (document.body.classList.contains("atTitle")) return;
  audio.unlock();
  const k = e.key, low = k.length === 1 ? k.toLowerCase() : k;
  keys.add(low);
  const hero = controlled();
  if (k === "Escape") {
    if (view.aim) { view.aim = null; return; }
    if (mode.kind) { cancelMode(); return; }
    if (hero) { release(); return; }
    if (G.sel.length) { clearSel(); return; }
    emit("wantPanel", "menu"); return;
  }
  if (k === "Pause" || (low === "p" && e.ctrlKey)) { e.preventDefault(); emit("togglePause"); return; }
  if (hero) {
    const i = "qwer".indexOf(low);
    if (i >= 0) { const w = toWorld(mouse.x, mouse.y), t = pickNear(w.x, w.y, hero); cast(hero, i, t && HEROES[hero.hero] && HEROES[hero.hero].skills[i].aim === "target" ? { id: t.id } : { x: w.x, y: w.y }) ? audio.play("magic") : audio.play("error"); e.preventDefault(); return; }
    if (k === " ") { manual.attack = true; manual.target = 0; e.preventDefault(); return; }
    if ("wasd".includes(low) || k.startsWith("Arrow")) { e.preventDefault(); return; }
  }
  if (/^[0-9]$/.test(k)) {
    const i = +k;
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); G.groups[i] = G.sel.filter((id) => { const x = G.ents.get(id); return x && x.team === 0; }); emit("toast", "Group " + i + " saved", "info"); emit("groups"); return; }
    const ids = G.groups[i].filter((id) => G.ents.has(id));
    if (!ids.length) return;
    select(ids.map((id) => G.ents.get(id)), e.shiftKey);
    const now = performance.now();
    if (lastGroup.i === i && now - lastGroup.t < 400) centerOn(selected());
    lastGroup = { i, t: now };
    return;
  }
  if (k === " ") { e.preventDefault(); emit("jumpAlert"); return; }
  if (k === "." || k === ",") { emit("nextIdle"); return; }
  if (low === "f" && !e.ctrlKey) { const s = selected()[0]; if (s && s.kind === "unit") view.follow = view.follow === s.id ? 0 : s.id; return; }
  if (k === "+" || k === "=") { view.cam.z = Math.min(2.4, view.cam.z * 1.15); clampCam(); return; }
  if (k === "-" || k === "_") { view.cam.z = Math.max(0.3, view.cam.z / 1.15); clampCam(); return; }
  if (hotkey && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { if (hotkey(k.toUpperCase(), e.shiftKey)) { e.preventDefault(); return; } }
}
function keyup(e) { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; keys.delete(k); }
export function centerOn(list) {
  if (!list.length) return;
  let x = 0, y = 0; for (const e of list) { x += e.x; y += e.y; }
  view.cam.x = x / list.length; view.cam.y = y / list.length; clampCam();
}

/* ---------------- every frame ---------------- */
export function update(dt) {
  const hero = controlled();
  if (hero && !document.body.classList.contains("touchUI")) {
    let mx = 0, my = 0;
    if (keys.has("a") || keys.has("ArrowLeft")) mx--; if (keys.has("d") || keys.has("ArrowRight")) mx++;
    if (keys.has("w") || keys.has("ArrowUp")) my--; if (keys.has("s") || keys.has("ArrowDown")) my++;
    if (mx || my || manual.kb) { const d = Math.hypot(mx, my) || 1; manual.mx = mx / d; manual.my = my / d; manual.kb = !!(mx || my); }
  }
  if (hero) return;
  const c = view.cam, sp = 700 * settings.panSpeed * dt / c.z;
  let moved = false;
  // arrows only: the letters belong to the command card (A attack-move, S stop, ...)
  if (keys.has("ArrowUp")) { c.y -= sp; moved = true; }
  if (keys.has("ArrowDown")) { c.y += sp; moved = true; }
  if (keys.has("ArrowLeft")) { c.x -= sp; moved = true; }
  if (keys.has("ArrowRight")) { c.x += sp; moved = true; }
  if (settings.edgePan && mouse.in && document.hasFocus() && !single && !document.body.classList.contains("touchUI")) {
    const m = 6;
    if (mouse.x < m) { c.x -= sp; moved = true; } if (mouse.x > view.W - m) { c.x += sp; moved = true; }
    if (mouse.y < m) { c.y -= sp; moved = true; } if (mouse.y > view.H - m) { c.y += sp; moved = true; }
  }
  if (moved) { view.follow = 0; clampCam(); }
}

export function init() {
  const cv = document.getElementById("view");
  cv.addEventListener("pointerdown", down);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (single && single.timer) clearTimeout(single.timer); single = null; view.box = null; });
  cv.addEventListener("wheel", wheel, { passive: false });
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  cv.addEventListener("pointerleave", () => { mouse.in = false; });
  window.addEventListener("keydown", keydown);
  window.addEventListener("keyup", keyup);
  window.addEventListener("blur", () => keys.clear());
  minimapDrag(document.getElementById("minimap"));
  stick();
}
export { stop, possess, release, isMilitary, skillsOf, cancelQ, LINES };

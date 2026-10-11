/* touch.js — the on-screen controls, and the editor that moves them.
 *
 * Every button is on screen the whole time you play: a phone has no keys to
 * remember, so the controls are the reminder. Where each one sits is yours —
 * "Move buttons" (Settings, Touch) lets you drag any of them anywhere, size
 * it and fade it, separately for a phone held sideways and one held upright.
 * Both layouts are kept (save.js) and re-checked so a button can never be
 * stored off the edge of the screen.
 *
 * How touches split: the stick moves you; Fire and Aim are held, and a drag
 * that starts on either also turns your view (you can aim while you shoot,
 * the way mobile shooters work); a touch anywhere that is not a button looks
 * around — except low on the left, where it is the stick, which comes to
 * your thumb (a floating stick, as CODM and PUBG Mobile have it) instead of
 * your thumb having to find it. Aim, crouch, sprint and the scoreboard each
 * hold, toggle or do both (Settings, Touch): input.js keeps the latches, and
 * a latched button stays lit. Aim starts as a toggle, since holding it would
 * cost a thumb.
 *
 * Running, the mobile way: push the stick out past its ring and you sprint;
 * keep going up to the lock above it and let go there, and you keep running
 * with no thumb on the stick (auto-run) until you touch the stick again.
 *
 * The buttons say what they do with what is in your hands: Fire shows the
 * hook with the grapple out and the blade with the blade, and Aim becomes the
 * lunge; the grapple's button is dimmed when you are not carrying one.
 *
 * Hack buttons. A phone has no keys, so a hack that waits for one — every
 * ui.key(…) a running hack made, "Hold to fly" and the like — gets a button
 * of its own, named after it, that presses that key while it is held
 * (input.js virtualDown), so the hack cannot tell it from the keyboard. They
 * come and go with the hacks, start in the first free place below the top
 * row, and the layout editor moves and sizes them like any other; where each
 * was put is kept by its label (save.js touchHack). */

import { S, emit, on } from "./state.js";
import { save } from "./save.js";
import { TOUCH } from "./controls.js";
import { icon } from "./icons.js";
import { touchState, touchPress, touchRelease, look, latched, setAutoRun, autoRunning, virtualDown, virtualUp } from "./input.js";
import { keyButtons } from "./hackapi.js";
import { grappleSlot, grappleOut, bladeOut, utilOut } from "./weapons.js";
import { clamp } from "./util.js";
import { appSize, toApp, appRect } from "./orient.js";

/* Every position here is in the game's own frame (orient.js): the screen's, or the screen's turned a
   quarter turn under Force landscape. Fingers come in through toApp(), sizes from appSize(). */
const root = () => document.getElementById("touch");
const orient = () => { const s = appSize(); return s.w >= s.h ? "landscape" : "portrait"; };
const fingerAt = (e) => toApp(e.clientX, e.clientY);
const els = new Map();
const active = new Map();          // pointerId -> { kind, id, x, y, ... }
let editing = false, selected = null;

export const isTouch = () => matchMedia("(pointer: coarse)").matches || ("ontouchstart" in window && navigator.maxTouchPoints > 0);

/* The buttons: the fixed ones, then one for each key a running hack is waiting on. */
let custom = [];                   // [{ id: "h:<label>", label, code, short, custom: true }]
const allDefs = () => TOUCH.concat(custom);
/** A hack button's face: the label without "Hold to", short enough to fit. */
function shortOf(label) { const t = String(label).replace(/^(hold|press|tap|toggle)( to)?\s+/i, "").trim() || String(label); return t.length > 7 ? t.slice(0, 6) + "." : t; }
function layout() {
  const o = orient(), L = save.data.touch[o];
  const H = save.data.touchHack[o] = save.data.touchHack[o] || {};
  // a hack button with no place yet gets the first free one below the top row, down the middle-left
  custom.forEach((c, i) => {
    if (L[c.id]) return;
    if (!H[c.label]) {
      const { w, h } = appSize(), sz = 50;
      L[c.id] = { x: 0.4, y: 0.3, s: sz, a: 1 };
      const p = freeSpot(c.id, w * 0.4, h * (0.26 + i * 0.13), sz / 2, hudRects()) || { x: w * 0.4, y: h * 0.3 };
      H[c.label] = { x: clamp(p.x / w, 0.03, 0.97), y: clamp(p.y / h, 0.03, 0.97), s: sz, a: 1 };
    }
    L[c.id] = H[c.label];
  });
  return L;
}

export function build() {
  const r = root();
  r.innerHTML = '<div id="touchLook"></div>';
  els.clear(); shown.clear();
  for (const t of allDefs()) {
    const el = document.createElement("div");
    el.className = "tbtn" + (t.id === "stick" ? " stick" : "") + (t.custom ? " custom" : "");
    el.dataset.id = t.id;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", t.custom ? t.label + " (a hack's key)" : t.label);
    el.innerHTML = t.id === "stick" ? '<div class="knob"></div><div class="runlock" aria-hidden="true">' + icon("sprint") + "</div>" : t.custom ? '<span class="tlab"></span>' : icon(t.icon);
    if (t.custom) el.firstChild.textContent = t.short;
    r.appendChild(el);
    els.set(t.id, el);
  }
  place();
}
/** The hacks' keys changed (one started, stopped, or was rebound): their buttons follow. */
function hackButtons() {
  const want = [];
  const seen = new Set();
  for (const k of keyButtons()) {
    const id = "h:" + k.label;
    if (seen.has(id) || !k.code) continue;
    seen.add(id);
    want.push({ id, label: k.label, code: k.code, short: shortOf(k.label), custom: true });
  }
  const sig = (l) => l.map((c) => c.id + "=" + c.code).join("|");
  if (sig(want) === sig(custom)) return;
  // let go of any hack key a vanishing button was holding
  for (const [pid, p] of [...active]) if (p.kind === "btn" && p.custom) { virtualUp(p.code); active.delete(pid); }
  for (const c of custom) delete save.data.touch.landscape[c.id], delete save.data.touch.portrait[c.id];
  custom = want;
  if (els.size) { build(); if (editing) { select(selected && els.has(selected) ? selected : "fire"); separate(); } }
}
export const hackButtonCount = () => custom.length;
export function place() {
  const L = layout(), { w, h } = appSize();
  for (const [id, el] of els) {
    const q = L[id];
    if (!q) continue;
    el.style.width = el.style.height = q.s + "px";
    el.style.left = clamp(q.x * w - q.s / 2, 0, w - q.s) + "px";
    el.style.top = clamp(q.y * h - q.s / 2, 0, h - q.s) + "px";
    el.style.opacity = q.a == null ? 1 : q.a;
    el.classList.toggle("sel", editing && selected === id);
  }
}

/* ---------------------------------------------------------------
   Playing
   --------------------------------------------------------------- */
const def = (id) => allDefs().find((t) => t.id === id);
function down(e) {
  if (!document.body.classList.contains("touchOn")) return;
  const tgt = e.target.closest ? e.target.closest(".tbtn") : null;
  e.preventDefault();
  const id = tgt ? tgt.dataset.id : null;
  if (editing) { if (id) startDrag(e, id); return; }
  const f = fingerAt(e);
  const stickFree = ![...active.values()].some((q) => q.kind === "stick");
  if (!id && stickFree && inStickZone(f)) { grabStick(e, f, true); return; }
  if (!id) { active.set(e.pointerId, { kind: "look", x: f.x, y: f.y }); return; }
  const t = def(id);
  if (!t) return;
  if (id === "stick") { if (stickFree) grabStick(e, f, false); return; }
  if (t.custom) {
    // a hack's key: down while held, as the keyboard would have it
    const again = [...active.values()].some((q) => q.kind === "btn" && q.id === id);
    active.set(e.pointerId, { kind: "btn", id, custom: true, code: t.code, x: f.x, y: f.y });
    tgt.classList.add("on");
    if (!again) virtualDown(t.code);
    return;
  }
  active.set(e.pointerId, { kind: "btn", id, x: f.x, y: f.y, look: !!t.look });
  tgt.classList.add("on");
  touchState.held.add(t.action);
  touchPress(t.action);
  sync();
}
function move(e) {
  const p = active.get(e.pointerId);
  if (!p) { if (editing) dragMove(e); return; }
  e.preventDefault();
  if (p.kind === "stick") { moveStick(e, p); return; }
  if (p.kind === "look" || p.look) {
    const k = save.settings.touchLook * 3.2, f = fingerAt(e);
    look((f.x - p.x) * k, (f.y - p.y) * k, 1);
    p.x = f.x; p.y = f.y;
  }
}
function up(e) {
  const p = active.get(e.pointerId);
  if (editing) { endDrag(); return; }
  if (!p) return;
  active.delete(e.pointerId);
  if (p.kind === "stick") {
    touchState.fwd = touchState.side = 0; touchState.autoSprint = false;
    // let go on the lock: keep running
    if (p.lock) setAutoRun(true);
    stickIdle();
    return;
  }
  if (p.kind === "btn" && p.custom) {
    const still = [...active.values()].some((q) => q.kind === "btn" && q.id === p.id);
    if (!still) { const el = els.get(p.id); if (el) el.classList.remove("on"); virtualUp(p.code); }
    return;
  }
  if (p.kind === "btn") {
    const t = def(p.id);
    els.get(p.id).classList.remove("on");
    // two buttons may share an action (both Fire buttons): release only when neither is held
    const still = [...active.values()].some((q) => q.kind === "btn" && def(q.id).action === t.action);
    if (!still) { touchState.held.delete(t.action); touchRelease(t.action); }
    sync();
  }
}
/** Light the buttons that are latched on, and show what Fire and Aim do with what is in your hands;
    once a frame, since a sprint can unlatch by itself. */
const shown = new Map();         // button id -> the icon it shows now, so it is only redrawn on a change
function iconFor(t) {
  const A = S.me ? S.me.arms : null;
  if (t.action === "fire") return A && grappleOut(A) ? "hook" : A && bladeOut(A) ? "blade" : A && utilOut(A) ? "grenade" : "fire";
  if (t.action === "ads") return A && bladeOut(A) ? "lunge" : "scope";
  if (t.action === "util") return A && A.util === "flash" ? "flash" : A && A.util !== "frag" ? "mine" : "grenade";
  return t.icon;
}
export function sync() {
  if (!els.size || editing) return;
  const A = S.me ? S.me.arms : null;
  for (const t of TOUCH) {
    const el = els.get(t.id);
    if (!el) continue;
    el.classList.toggle("latched", t.action === "hook" ? !!A && grappleOut(A) : latched(t.action));
    if (t.action === "hook") el.classList.toggle("na", !!A && grappleSlot(A) < 0);
    if (t.action === "util") el.classList.toggle("na", !!A && A.utilN <= 0);
    if (t.id === "stick") continue;
    const ic = iconFor(t);
    if (shown.get(t.id) !== ic) { shown.set(t.id, ic); el.innerHTML = icon(ic); el.dataset.icon = ic; }
  }
  const st = els.get("stick");
  if (st) st.classList.toggle("autorun", autoRunning());
}

/* ---------------------------------------------------------------
   The stick
   --------------------------------------------------------------- */
/*
 * The floating stick is Magic Sandbox's idea (magic_sandbox/js/input.js): it centres where the thumb
 * lands, on the left. Its other half — a thumb past the rim drags the stick along — is not kept,
 * because here past the rim is the run, and on up is the lock.
 *
 * Where a thumb that misses the stick still means "move": the lower part of the left side, below
 * the buttons up there. A touch on a button is always that button; only empty screen counts.
 */
function inStickZone(f) {
  if (!save.settings.touchFloat) return false;
  const { w, h } = appSize();
  return orient() === "landscape" ? f.x < w * 0.42 && f.y > h * 0.32 : f.x < w * 0.5 && f.y > h * 0.55;
}
/* Past the ring is a run; this far out, up, is the lock (in radii from the centre). */
const RUN_AT = 1.0, LOCK_AT = 1.85;
function grabStick(e, f, float) {
  const el = els.get("stick");
  // touching the stick is how auto-run ends: your thumb is back in charge
  setAutoRun(false);
  const r = appRect(el.getBoundingClientRect()), rad = r.width / 2;
  let cx = r.left + rad, cy = r.top + rad;
  if (float) {
    // the stick comes to the thumb, kept on screen
    const { w, h } = appSize();
    cx = clamp(f.x, rad, w - rad); cy = clamp(f.y, rad, h - rad);
    el.style.left = (cx - rad) + "px"; el.style.top = (cy - rad) + "px";
  }
  const p = { kind: "stick", id: "stick", cx, cy, rad, lock: false };
  active.set(e.pointerId, p);
  el.classList.add("on");
  moveStick(e, p);
}
function moveStick(e, p) {
  const el = els.get("stick"), f = fingerAt(e);
  let dx = (f.x - p.cx) / p.rad, dy = (f.y - p.cy) / p.rad;
  const l = Math.hypot(dx, dy);
  const up = l > 0 ? -dy / l : 0;
  // out past the ring, pointing forward: a run; carried on up to the lock: auto-run on release
  const run = save.settings.touchAutoSprint && l > RUN_AT && up > 0.6;
  p.lock = run && l > LOCK_AT && up > 0.8;
  if (l > 1) { dx /= l; dy /= l; }
  touchState.side = dx; touchState.fwd = -dy;
  touchState.autoSprint = run;
  el.classList.toggle("run", run);
  el.classList.toggle("armed", p.lock);
  el.firstChild.style.transform = "translate(" + (dx * p.rad * 0.55).toFixed(1) + "px," + (dy * p.rad * 0.55).toFixed(1) + "px)";
}
function stickIdle() {
  const el = els.get("stick");
  if (!el) return;
  el.classList.remove("on", "run", "armed");
  el.firstChild.style.transform = "";
  place();
}

/* ---------------------------------------------------------------
   The layout editor
   --------------------------------------------------------------- */
/*
 * No button may cover another, or sit under the editor's own bar: a button you
 * cannot see the edge of is one you can no longer pick up and move. A drop on
 * top of something slides to the nearest free place (and a drag that cannot
 * find one stays where it last fitted); a size that would not fit is refused.
 * The readouts that cannot be moved — the score line, health and speed, ammo —
 * are shown faintly while you edit and are kept clear the same way, so no
 * button ever sits on your health. The bar puts itself wherever it covers
 * nothing, top first. Overlaps a layout already had are pulled apart when the
 * editor opens.
 */
const GAP = 4;
let drag = null;
const W = () => appSize().w, H = () => appSize().h;
function circleOf(id) {
  const q = layout()[id], w = W(), h = H();
  return { x: clamp(q.x * w, q.s / 2, w - q.s / 2), y: clamp(q.y * h, q.s / 2, h - q.s / 2), r: q.s / 2 };
}
const barEl = () => document.querySelector("#touchEdit .bar");
const FIXED = ["#hudTop .pill", "#hudBL", "#hudBR"];
const rectOf = (el) => { if (!el) return null; const r = appRect(el.getBoundingClientRect()); return r.width && r.height ? r : null; };
/** The HUD readouts no button may cover. */
const hudRects = () => FIXED.map((q) => rectOf(document.querySelector(q))).filter(Boolean);
/** Everything a button must keep clear of while editing: the bar, and the readouts. */
const fixedRects = () => (editing ? [rectOf(barEl())].concat(hudRects()).filter(Boolean) : []);
/** How far a circle at (x, y) of radius r pushes into a rectangle (0: clear of it). */
function intoRect(x, y, r, b) {
  const cx = clamp(x, b.left, b.right), cy = clamp(y, b.top, b.bottom);
  const d = Math.hypot(x - cx, y - cy);
  if (x > b.left && x < b.right && y > b.top && y < b.bottom) return r + GAP + Math.min(x - b.left, b.right - x, y - b.top, b.bottom - y);
  return Math.max(0, r + GAP - d);
}
/** The nearest place to (x, y) where button `id`, radius r, touches nothing; null if pushing could not find one. */
function freeSpot(id, x, y, r, rects) {
  const w = W(), h = H();
  const x0 = Math.max(r, w * 0.03), x1 = Math.min(w - r, w * 0.97), y0 = Math.max(r, h * 0.03), y1 = Math.min(h - r, h * 0.97);
  x = clamp(x, x0, x1); y = clamp(y, y0, y1);
  for (let it = 0; it < 80; it++) {
    let hit = false;
    for (const t of allDefs()) {
      if (t.id === id || !layout()[t.id]) continue;
      const o = circleOf(t.id);
      let dx = x - o.x, dy = y - o.y, d = Math.hypot(dx, dy);
      const need = r + o.r + GAP;
      if (d >= need) continue;
      hit = true;
      if (d < 0.01) { dx = w / 2 - o.x || 1; dy = h / 2 - o.y; d = Math.hypot(dx, dy); }
      x += dx / d * (need - d + 0.5); y += dy / d * (need - d + 0.5);
    }
    for (const bar of rects || []) {
      if (intoRect(x, y, r, bar) === 0) continue;
      hit = true;
      // out through whichever side of the rectangle is nearest
      const outs = [[bar.left - r - GAP - 0.5, y], [bar.right + r + GAP + 0.5, y], [x, bar.top - r - GAP - 0.5], [x, bar.bottom + r + GAP + 0.5]]
        .map(([px, py]) => [clamp(px, x0, x1), clamp(py, y0, y1)])
        .filter(([px, py]) => intoRect(px, py, r, bar) === 0);
      if (outs.length) { outs.sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y)); [x, y] = outs[0]; }
    }
    x = clamp(x, x0, x1); y = clamp(y, y0, y1);
    if (!hit) return { x, y };
  }
  return null;
}
function setCentre(id, p) { const q = layout()[id]; q.x = clamp(p.x / W(), 0.03, 0.97); q.y = clamp(p.y / H(), 0.03, 0.97); }
/** Put the bar where it covers no button: the first free spot from the top down, centred first. */
function placeBar() {
  const box = document.getElementById("touchEdit"), el = barEl();
  if (!editing || !el) return;
  const w = W(), h = H(), bw = el.offsetWidth, bh = el.offsetHeight;
  const xs = [(w - bw) / 2, 8, w - bw - 8];
  const hud = hudRects();
  let best = null;
  for (let k = 0; k <= 12 && !(best && best.cost === 0); k++) {
    const y = 8 + k * Math.max(0, h - bh - 16) / 12;
    for (const x of xs) {
      const b = { left: x, right: x + bw, top: y, bottom: y + bh };
      let cost = 0;
      for (const t of allDefs()) { const c = circleOf(t.id); cost += intoRect(c.x, c.y, c.r, b); }
      // covering a readout is not as bad as covering a button, but still worse than covering nothing
      for (const q of hud) cost += Math.max(0, Math.min(b.right, q.right) - Math.max(b.left, q.left)) * Math.max(0, Math.min(b.bottom, q.bottom) - Math.max(b.top, q.top)) / 400;
      if (!best || cost < best.cost) best = { x, y, cost };
      if (cost === 0) break;
    }
  }
  box.style.left = Math.round(best.x) + "px";
  box.style.top = Math.round(best.y) + "px";
}
/** Pull apart whatever a layout already had overlapping. */
function separate() {
  const bar = fixedRects();
  for (let pass = 0; pass < 3; pass++) for (const t of allDefs()) {
    const c = circleOf(t.id);
    const p = freeSpot(t.id, c.x, c.y, c.r, bar);
    if (p && (Math.abs(p.x - c.x) > 0.5 || Math.abs(p.y - c.y) > 0.5)) setCentre(t.id, p);
  }
  place();
}
function startDrag(e, id) {
  select(id);
  const c = circleOf(id);
  const f = fingerAt(e);
  drag = { id, pid: e.pointerId, ox: f.x - c.x, oy: f.y - c.y };
}
function dragMove(e) {
  if (!drag || e.pointerId !== drag.pid) return;
  const r = layout()[drag.id].s / 2;
  const f = fingerAt(e);
  const p = freeSpot(drag.id, f.x - drag.ox, f.y - drag.oy, r, fixedRects());
  if (p) { setCentre(drag.id, p); place(); }
}
function endDrag() { if (drag) { drag = null; save.commit(); } }
function resize(v) {
  if (!selected) return;
  const q = layout()[selected], was = q.s;
  q.s = v;
  const c = circleOf(selected);
  const p = freeSpot(selected, c.x, c.y, v / 2, fixedRects());
  if (p) setCentre(selected, p); else q.s = was;
  document.getElementById("teSize").value = q.s;
  place();
}
function select(id) {
  selected = id;
  const q = layout()[id];
  document.getElementById("teSel").textContent = def(id) ? def(id).label : "";
  document.getElementById("teSize").value = q.s;
  document.getElementById("teAlpha").value = q.a == null ? 1 : q.a;
  place();
}
export function edit(on) {
  editing = !!on;
  document.body.classList.toggle("touchEditing", editing);
  document.getElementById("touchEdit").hidden = !editing;
  if (editing) { emit("touchEditing"); build(); show(true); select(selected || "fire"); placeBar(); separate(); }
  else { show(S.mode === "play"); save.commit(); emit("touchEditDone"); }
}
export const isEditing = () => editing;

export function show(on) {
  const want = !!on && (isTouch() || editing);
  document.body.classList.toggle("touchOn", want);
  root().hidden = !want;
  if (want && !els.size) build();
  if (!want) { for (const id of [...active.keys()]) up({ pointerId: id }); touchState.held.clear(); }
}

export function init() {
  const r = root();
  r.addEventListener("pointerdown", down, { passive: false });
  addEventListener("pointermove", move, { passive: false });
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
  addEventListener("resize", () => { if (!els.size) return; place(); if (editing) { placeBar(); separate(); } });
  document.getElementById("teSize").addEventListener("input", (e) => resize(+e.target.value));
  document.getElementById("teAlpha").addEventListener("input", (e) => { if (selected) { layout()[selected].a = +e.target.value; place(); } });
  document.getElementById("teAlpha").addEventListener("change", () => save.commit());
  document.getElementById("teSize").addEventListener("change", () => save.commit());
  document.getElementById("teReset").addEventListener("click", () => { for (const c of custom) delete save.data.touch[orient()][c.id]; save.data.touchHack[orient()] = {}; save.resetTouch(orient()); place(); placeBar(); separate(); if (selected && els.has(selected)) select(selected); });
  document.getElementById("teDone").addEventListener("click", () => edit(false));
  on("matchStart", () => show(true));
  // turned or straightened: the other layout, and the buttons put where it says
  on("turned", () => { if (!els.size) return; place(); if (editing) { placeBar(); separate(); } });
  on("quit", () => show(false));
  on("hacksChanged", hackButtons);
  on("hackButtons", hackButtons);
}

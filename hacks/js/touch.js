/* touch.js — the on-screen controls, and the editor that moves them.
 *
 * Every button is on screen the whole time you play: a phone has no keys to
 * remember, so the controls are the reminder. Where each one sits is yours —
 * "Move buttons" (Settings, Touch) lets you drag any of them anywhere, size
 * it and fade it, separately for a phone held sideways and one held upright.
 * Both layouts are kept (save.js) and re-checked so a button can never be
 * stored off the edge of the screen.
 *
 * How touches split: the stick moves you; Fire and Lunge are held, and a
 * drag that starts on either also turns your view (you can aim while you
 * shoot, the way mobile shooters work); a touch anywhere that is not a
 * button looks around. Aim is a toggle on touch, since holding it would
 * cost a thumb. */

import { S, emit, on } from "./state.js";
import { save } from "./save.js";
import { TOUCH } from "./controls.js";
import { icon } from "./icons.js";
import { touchState, touchPress, touchRelease, look } from "./input.js";
import { clamp } from "./util.js";

const root = () => document.getElementById("touch");
const orient = () => (window.innerWidth >= window.innerHeight ? "landscape" : "portrait");
const els = new Map();
const active = new Map();          // pointerId -> { kind, id, x, y, ... }
let editing = false, selected = null;
let adsOn = false;

export const isTouch = () => matchMedia("(pointer: coarse)").matches || ("ontouchstart" in window && navigator.maxTouchPoints > 0);

function layout() { return save.data.touch[orient()]; }

export function build() {
  const r = root();
  r.innerHTML = '<div id="touchLook"></div>';
  els.clear();
  for (const t of TOUCH) {
    const el = document.createElement("div");
    el.className = "tbtn" + (t.id === "stick" ? " stick" : "");
    el.dataset.id = t.id;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", t.label);
    el.innerHTML = t.id === "stick" ? '<div class="knob"></div>' : icon(t.icon);
    r.appendChild(el);
    els.set(t.id, el);
  }
  place();
}
export function place() {
  const L = layout(), w = window.innerWidth, h = window.innerHeight;
  for (const [id, el] of els) {
    const q = L[id];
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
const def = (id) => TOUCH.find((t) => t.id === id);
function down(e) {
  if (!document.body.classList.contains("touchOn")) return;
  const tgt = e.target.closest ? e.target.closest(".tbtn") : null;
  e.preventDefault();
  const id = tgt ? tgt.dataset.id : null;
  if (editing) { if (id) startDrag(e, id); return; }
  if (!id) { active.set(e.pointerId, { kind: "look", x: e.clientX, y: e.clientY }); return; }
  const t = def(id);
  if (id === "stick") { active.set(e.pointerId, { kind: "stick", id }); moveStick(e, tgt); return; }
  active.set(e.pointerId, { kind: "btn", id, x: e.clientX, y: e.clientY, look: !!t.look });
  tgt.classList.add("on");
  if (t.action === "ads") { adsOn = !adsOn; tgt.classList.toggle("latched", adsOn); if (adsOn) touchState.held.add("ads"); else touchState.held.delete("ads"); return; }
  if (t.action === "sprint") { touchState.sprintToggle = true; touchPress("sprint"); tgt.classList.toggle("latched"); return; }
  touchState.held.add(t.action);
  touchPress(t.action);
}
function move(e) {
  const p = active.get(e.pointerId);
  if (!p) { if (editing) dragMove(e); return; }
  e.preventDefault();
  if (p.kind === "stick") { moveStick(e, els.get("stick")); return; }
  if (p.kind === "look" || p.look) {
    const k = save.settings.touchLook * 3.2;
    look((e.clientX - p.x) * k, (e.clientY - p.y) * k, 1);
    p.x = e.clientX; p.y = e.clientY;
  }
}
function up(e) {
  const p = active.get(e.pointerId);
  if (editing) { endDrag(); return; }
  if (!p) return;
  active.delete(e.pointerId);
  if (p.kind === "stick") {
    touchState.fwd = touchState.side = 0; touchState.autoSprint = false;
    const k = els.get("stick").firstChild; k.style.transform = "";
    return;
  }
  if (p.kind === "btn") {
    const t = def(p.id);
    els.get(p.id).classList.remove("on");
    if (t.action !== "ads" && t.action !== "sprint") {
      // two buttons may share an action (both Fire buttons): release only when neither is held
      const still = [...active.values()].some((q) => q.kind === "btn" && def(q.id).action === t.action);
      if (!still) touchState.held.delete(t.action);
      touchRelease(t.action);
    }
  }
}
function moveStick(e, el) {
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2, rad = r.width / 2;
  let dx = (e.clientX - cx) / rad, dy = (e.clientY - cy) / rad;
  const l = Math.hypot(dx, dy);
  if (l > 1) { dx /= l; dy /= l; }
  touchState.side = dx; touchState.fwd = -dy;
  touchState.autoSprint = save.settings.touchAutoSprint && l > 0.92 && -dy > 0.5;
  el.firstChild.style.transform = "translate(" + (dx * rad * 0.55).toFixed(1) + "px," + (dy * rad * 0.55).toFixed(1) + "px)";
}

/* ---------------------------------------------------------------
   The layout editor
   --------------------------------------------------------------- */
let drag = null;
function startDrag(e, id) {
  select(id);
  const L = layout()[id];
  drag = { id, pid: e.pointerId, ox: e.clientX - L.x * window.innerWidth, oy: e.clientY - L.y * window.innerHeight };
}
function dragMove(e) {
  if (!drag || e.pointerId !== drag.pid) return;
  const L = layout()[drag.id];
  L.x = clamp((e.clientX - drag.ox) / window.innerWidth, 0.03, 0.97);
  L.y = clamp((e.clientY - drag.oy) / window.innerHeight, 0.03, 0.97);
  place();
}
function endDrag() { if (drag) { drag = null; save.commit(); } }
function select(id) {
  selected = id;
  const q = layout()[id];
  document.getElementById("teSel").textContent = def(id).label;
  document.getElementById("teSize").value = q.s;
  document.getElementById("teAlpha").value = q.a == null ? 1 : q.a;
  place();
}
export function edit(on) {
  editing = !!on;
  document.body.classList.toggle("touchEditing", editing);
  document.getElementById("touchEdit").hidden = !editing;
  if (editing) { build(); show(true); select(selected || "fire"); }
  else { show(S.mode === "play"); save.commit(); emit("touchEditDone"); }
}
export const isEditing = () => editing;

export function show(on) {
  const want = !!on && (isTouch() || editing);
  document.body.classList.toggle("touchOn", want);
  root().hidden = !want;
  if (want && !els.size) build();
  if (!want) { for (const id of [...active.keys()]) up({ pointerId: id }); touchState.held.clear(); adsOn = false; }
}

export function init() {
  const r = root();
  r.addEventListener("pointerdown", down, { passive: false });
  addEventListener("pointermove", move, { passive: false });
  addEventListener("pointerup", up);
  addEventListener("pointercancel", up);
  addEventListener("resize", () => { if (els.size) place(); });
  document.getElementById("teSize").addEventListener("input", (e) => { if (selected) { layout()[selected].s = +e.target.value; place(); } });
  document.getElementById("teAlpha").addEventListener("input", (e) => { if (selected) { layout()[selected].a = +e.target.value; place(); } });
  document.getElementById("teAlpha").addEventListener("change", () => save.commit());
  document.getElementById("teSize").addEventListener("change", () => save.commit());
  document.getElementById("teReset").addEventListener("click", () => { save.resetTouch(orient()); place(); if (selected) select(selected); });
  document.getElementById("teDone").addEventListener("click", () => edit(false));
  on("matchStart", () => show(true));
  on("quit", () => show(false));
}

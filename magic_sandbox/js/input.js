/* input.js — keyboard and mouse, touch, and gamepads, folded into one shape.
 *
 * Whatever the device, gameplay reads the same per-frame record: a move
 * vector, an aim, and a handful of "pressed this frame" flags. The rest of the
 * game never asks what is holding it.
 *
 * On a phone the first version pinned two joysticks to the bottom corners and
 * scattered six labelled buttons around them, and locked the game to
 * landscape. Here the sticks float: put a thumb down anywhere on the left
 * half and that is where the stick is; the right half aims. Holding the right
 * side without dragging casts at the nearest enemy, so a thumb that only
 * wants to survive does not also have to aim. The buttons that remain are the
 * few that are verbs — dash, potion, trigger — and they sit where a right
 * thumb already is. */

import { screenToGround, IS_TOUCH } from "./gfx.js";
import { S } from "./state.js";

export const input = {
  mx: 0, mz: 0, aimAng: null, aimX: null, aimZ: null, autoAim: false,
  cast: false, dash: false, trigger: false, interact: false, potion: false,
  select: -1, cycle: 0
};
export let device = IS_TOUCH ? "touch" : "mouse";
const listeners = [];
export function onDevice(fn) { listeners.push(fn); }
function setDevice(d) { if (d !== device) { device = d; listeners.forEach((f) => f(d)); document.body.dataset.device = d; } }

const keys = new Set();
const edge = { dash: false, trigger: false, interact: false, potion: false, select: -1, cycle: 0 };
let mouse = { x: innerWidth / 2, y: innerHeight / 2, down: false, has: false };
let handlers = { pause: () => {}, book: () => {} };

export function initInput(h) {
  handlers = Object.assign(handlers, h);
  document.body.dataset.device = device;

  addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) {
      // typing a spell's name is typing, except Escape, which still closes
      if (e.key !== "Escape") return;
      e.target.blur();
    }
    if (e.repeat) { if (["Tab", "Space"].includes(e.code)) e.preventDefault(); return; }
    setDevice("mouse");
    keys.add(e.code);
    const c = e.code;
    if (c === "Escape" || c === "KeyP") { handlers.pause(); return; }
    if (c === "Tab" || c === "KeyB") { e.preventDefault(); handlers.book(); return; }
    if (S.paused || S.uiOpen) return;
    if (c === "Space" || c === "ShiftLeft" || c === "ShiftRight") { e.preventDefault(); edge.dash = true; }
    if (c === "KeyF") edge.trigger = true;
    if (c === "KeyE") edge.interact = true;
    if (c === "KeyQ") edge.potion = true;
    const d = /^Digit([1-4])$/.exec(c);
    if (d) edge.select = +d[1] - 1;
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  addEventListener("blur", () => { keys.clear(); mouse.down = false; });

  const gl = document.getElementById("gl");
  gl.addEventListener("mousemove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.has = true; setDevice("mouse"); });
  gl.addEventListener("mousedown", (e) => {
    setDevice("mouse");
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.has = true;
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) edge.trigger = true;
  });
  addEventListener("mouseup", (e) => { if (e.button === 0) mouse.down = false; });
  addEventListener("contextmenu", (e) => { if (e.target === gl) e.preventDefault(); });
  gl.addEventListener("wheel", (e) => { if (!S.paused && Math.abs(e.deltaY) > 2) edge.cycle = e.deltaY > 0 ? 1 : -1; }, { passive: true });

  initTouch();
}

/* ---------------------------------------------------------------
   Touch: two floating sticks
   --------------------------------------------------------------- */
const STICK_R = 58;
const sticks = {
  L: { id: null, ox: 0, oy: 0, x: 0, y: 0, t0: 0, el: null, nub: null },
  R: { id: null, ox: 0, oy: 0, x: 0, y: 0, t0: 0, moved: false, el: null, nub: null }
};
let tapCast = 0;

function initTouch() {
  const zone = document.getElementById("touchzone");
  sticks.L.el = document.getElementById("stickL"); sticks.L.nub = sticks.L.el.querySelector(".nub");
  sticks.R.el = document.getElementById("stickR"); sticks.R.nub = sticks.R.el.querySelector(".nub");
  zone.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    setDevice("touch");
    const side = e.clientX < innerWidth * 0.5 ? "L" : "R";
    const s = sticks[side];
    if (s.id !== null) return;
    s.id = e.pointerId; s.ox = e.clientX; s.oy = e.clientY; s.x = 0; s.y = 0; s.t0 = performance.now(); s.moved = false;
    try { zone.setPointerCapture(e.pointerId); } catch (err) {}
    s.el.style.transform = "translate(" + (s.ox - STICK_R) + "px," + (s.oy - STICK_R) + "px)";
    s.el.classList.add("on");
    s.nub.style.transform = "translate(0px,0px)";
    e.preventDefault();
  });
  zone.addEventListener("pointermove", (e) => {
    for (const k of ["L", "R"]) {
      const s = sticks[k];
      if (s.id !== e.pointerId) continue;
      let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
      const m = Math.hypot(dx, dy);
      if (m > 12) s.moved = true;
      // a thumb that runs past the rim drags the stick with it
      if (m > STICK_R * 1.35) { const over = m - STICK_R * 1.35; s.ox += dx / m * over; s.oy += dy / m * over; dx = e.clientX - s.ox; dy = e.clientY - s.oy; s.el.style.transform = "translate(" + (s.ox - STICK_R) + "px," + (s.oy - STICK_R) + "px)"; }
      const mm = Math.hypot(dx, dy), cl = Math.min(STICK_R, mm);
      s.x = mm ? dx / mm * Math.min(1, mm / STICK_R) : 0;
      s.y = mm ? dy / mm * Math.min(1, mm / STICK_R) : 0;
      s.nub.style.transform = "translate(" + (mm ? dx / mm * cl : 0) + "px," + (mm ? dy / mm * cl : 0) + "px)";
    }
  });
  const end = (e) => {
    for (const k of ["L", "R"]) {
      const s = sticks[k];
      if (s.id !== e.pointerId) continue;
      if (k === "R" && !s.moved && performance.now() - s.t0 < 260) tapCast = 2;   // a tap: one auto-aimed cast
      s.id = null; s.x = s.y = 0;
      s.el.classList.remove("on");
    }
  };
  zone.addEventListener("pointerup", end);
  zone.addEventListener("pointercancel", end);

  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); setDevice(e.pointerType === "mouse" ? device : "touch"); fn(); });
  };
  bind("tDash", () => { edge.dash = true; });
  bind("tPotion", () => { edge.potion = true; });
  bind("tTrigger", () => { edge.trigger = true; });
  bind("tUse", () => { edge.interact = true; });
}
export function selectSlot(i) { edge.select = i; }

/* ---------------------------------------------------------------
   Gamepad
   --------------------------------------------------------------- */
let padPrev = [];
const DZ = 0.22;
function readPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p && p.connected && p.axes.length >= 4) return p;
  return null;
}

/* ---------------------------------------------------------------
   Per frame
   --------------------------------------------------------------- */
export function poll() {
  const I = input;
  I.mx = 0; I.mz = 0; I.aimAng = null; I.aimX = null; I.aimZ = null; I.autoAim = false; I.cast = false;
  I.dash = edge.dash; I.trigger = edge.trigger; I.interact = edge.interact; I.potion = edge.potion;
  I.select = edge.select; I.cycle = edge.cycle;
  edge.dash = edge.trigger = edge.interact = edge.potion = false; edge.select = -1; edge.cycle = 0;
  if (S.paused || S.uiOpen) { mouse.down = false; return I; }

  // keyboard
  const kx = (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) - (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0);
  const kz = (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0) - (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0);
  if (kx || kz) { const m = Math.hypot(kx, kz); I.mx = kx / m; I.mz = kz / m; }
  if (device === "mouse" && mouse.has) {
    const g = screenToGround(mouse.x, mouse.y, 1);
    if (g) { I.aimX = g.x; I.aimZ = g.z; }
    I.cast = mouse.down;
  }

  // touch
  const L = sticks.L, R = sticks.R;
  if (L.id !== null) { I.mx = L.x; I.mz = L.y; }
  if (R.id !== null) {
    if (R.moved && Math.hypot(R.x, R.y) > 0.2) { I.aimAng = Math.atan2(R.y, R.x); I.cast = true; }
    else if (performance.now() - R.t0 > 260) { I.cast = true; I.autoAim = true; }
  }
  if (tapCast > 0) { tapCast--; I.cast = true; I.autoAim = true; }

  // gamepad
  const pad = readPad();
  if (pad) {
    const b = (i) => !!(pad.buttons[i] && (pad.buttons[i].pressed || pad.buttons[i].value > 0.5));
    const pressed = (i) => b(i) && !padPrev[i];
    const ax = pad.axes[0], az = pad.axes[1], rx = pad.axes[2], rz = pad.axes[3];
    const any = Math.hypot(ax, az) > DZ || Math.hypot(rx, rz) > DZ || pad.buttons.some((x) => x && x.pressed);
    if (any) setDevice("pad");
    if (device === "pad") {
      if (Math.hypot(ax, az) > DZ) { const m = Math.min(1, Math.hypot(ax, az)); I.mx = ax / Math.hypot(ax, az) * m; I.mz = az / Math.hypot(ax, az) * m; }
      if (Math.hypot(rx, rz) > 0.35) I.aimAng = Math.atan2(rz, rx);
      if (b(7)) { I.cast = true; if (I.aimAng === null && Math.hypot(rx, rz) < 0.35 && !padAimed) I.autoAim = true; }
      if (pressed(0)) I.dash = true;
      if (pressed(6)) I.trigger = true;
      if (pressed(2)) I.interact = true;
      if (pressed(3)) I.potion = true;
      if (pressed(4)) I.cycle = -1;
      if (pressed(5)) I.cycle = 1;
      if (pressed(9)) handlers.pause();
      if (pressed(8)) handlers.book();
      padAimed = Math.hypot(rx, rz) > 0.35 ? 1 : Math.max(0, padAimed - 0.02);
    }
    padPrev = pad.buttons.map((x) => !!(x && (x.pressed || x.value > 0.5)));
  }
  return I;
}
let padAimed = 0;

/** Menus can be driven by a pad too: this reports fresh presses only. */
export function padMenuPress() {
  const pad = readPad();
  if (!pad) return null;
  const now = pad.buttons.map((x) => !!(x && (x.pressed || x.value > 0.5)));
  const out = { a: now[0] && !padPrev[0], b: now[1] && !padPrev[1], start: now[9] && !padPrev[9], back: now[8] && !padPrev[8] };
  padPrev = now;
  return out;
}

export function resetInput() {
  keys.clear(); mouse.down = false;
  for (const k of ["L", "R"]) { const s = sticks[k]; s.id = null; s.x = s.y = 0; if (s.el) s.el.classList.remove("on"); }
}

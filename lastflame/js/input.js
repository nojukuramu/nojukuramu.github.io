/* input.js — hands: keyboard and mouse, a phone's touch screen, a gamepad.
 *
 * Everything becomes the same few things game.js wants each step — which way
 * to walk, where to look, and a handful of buttons, some held and some
 * pressed once. Presses are edges: read() reports one once and forgets it.
 *
 * On a computer the mouse is captured (pointer lock) while a night is on; on
 * a phone the left half of the screen is a stick that appears where the
 * thumb lands, the right half is for looking, and the buttons sit under the
 * right thumb. Push the stick all the way to run. */

const keys = new Set();
const edges = new Set();
let yaw = 0, pitch = 0, sens = 1, invert = false, crouchToggle = true, crouched = false;
let raise = false, enabled = false, isTouch = false;
const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
const look = { id: null, x: 0, y: 0 };
const held = { use: false, breath: false, run: false };
let canvas = null, onPause = null, onLock = null;
let pad = null, padPrev = {};

export function init(o) {
  canvas = o.canvas; onPause = o.pause; onLock = o.lock;
  window.addEventListener("keydown", (e) => {
    if (!enabled) return;
    const k = key(e);
    if (!k) return;
    if (!keys.has(k)) edges.add(k);
    keys.add(k);
    e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { const k = key(e); if (k) keys.delete(k); });
  window.addEventListener("blur", () => keys.clear());
  document.addEventListener("mousemove", (e) => {
    if (!enabled || document.pointerLockElement !== canvas) return;
    turn(e.movementX, e.movementY, 0.0022);
  });
  canvas.addEventListener("mousedown", (e) => {
    if (!enabled) return;
    if (document.pointerLockElement !== canvas) { lock(); return; }
    if (e.button === 2) raise = true;
    if (e.button === 0) { edges.add("use"); held.mouseUse = true; }
  });
  window.addEventListener("mouseup", (e) => { if (e.button === 2) raise = false; if (e.button === 0) held.mouseUse = false; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  document.addEventListener("pointerlockchange", () => {
    const locked = document.pointerLockElement === canvas;
    if (onLock) onLock(locked);
    if (!locked && enabled && !isTouch && onPause) onPause();
  });
  // touch: a stick on the left, looking on the right
  canvas.addEventListener("touchstart", touch, { passive: false });
  canvas.addEventListener("touchmove", touch, { passive: false });
  canvas.addEventListener("touchend", touchEnd, { passive: false });
  canvas.addEventListener("touchcancel", touchEnd, { passive: false });
  window.addEventListener("gamepadconnected", (e) => { pad = e.gamepad.index; });
}

const MAP = {
  KeyW: "fwd", ArrowUp: "fwd", KeyS: "back", ArrowDown: "back", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right",
  ShiftLeft: "run", ShiftRight: "run", KeyC: "crouch", ControlLeft: "crouchHold", ControlRight: "crouchHold",
  KeyE: "use", KeyF: "lantern", Space: "breath", KeyQ: "raise", Escape: "pause", KeyP: "pause"
};
function key(e) { return MAP[e.code] || null; }

function turn(dx, dy, k) {
  yaw -= dx * k * sens;
  pitch -= dy * k * sens * (invert ? -1 : 1);
  pitch = Math.max(-1.35, Math.min(1.35, pitch));
}

export function lock() {
  if (isTouch || !canvas.requestPointerLock) return;
  try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* not allowed here */ }
}
export function unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

function touch(e) {
  if (!enabled) return;
  isTouch = true;
  e.preventDefault();
  const w = window.innerWidth;
  for (const t of e.changedTouches) {
    if (e.type === "touchstart") {
      if (t.clientX < w * 0.45 && stick.id === null) { stick.id = t.identifier; stick.ox = stick.x = t.clientX; stick.oy = stick.y = t.clientY; showStick(true); }
      else if (look.id === null) { look.id = t.identifier; look.x = t.clientX; look.y = t.clientY; }
    } else {
      if (t.identifier === stick.id) { stick.x = t.clientX; stick.y = t.clientY; showStick(true); }
      if (t.identifier === look.id) { turn(t.clientX - look.x, t.clientY - look.y, 0.0055); look.x = t.clientX; look.y = t.clientY; }
    }
  }
}
function touchEnd(e) {
  for (const t of e.changedTouches) {
    if (t.identifier === stick.id) { stick.id = null; showStick(false); }
    if (t.identifier === look.id) look.id = null;
  }
}
const STICK_R = 56;
function showStick(on) {
  const base = document.getElementById("stick"), knob = document.getElementById("stick-knob");
  if (!base) return;
  base.hidden = !on;
  if (!on) return;
  base.style.left = stick.ox + "px"; base.style.top = stick.oy + "px";
  let dx = stick.x - stick.ox, dy = stick.y - stick.oy;
  const d = Math.hypot(dx, dy);
  if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
  knob.style.transform = "translate(" + dx + "px," + dy + "px)";
}

/* The on-screen buttons (index.html) report here. */
export function button(name, down) {
  isTouch = true;
  if (name === "use") { if (down) edges.add("use"); held.use = down; }
  else if (name === "breath") held.breath = down;
  else if (name === "lantern" && down) edges.add("lantern");
  else if (name === "crouch" && down) edges.add("crouch");
  else if (name === "raise") raise = down;
}

function readPad() {
  if (pad === null || !navigator.getGamepads) return null;
  const gp = navigator.getGamepads()[pad];
  if (!gp) return null;
  const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
  const now = { a: b(0), b: b(1), x: b(2), y: b(3), lt: b(6), rt: b(7), start: b(9), l3: b(10) };
  for (const k in now) if (now[k] && !padPrev[k]) edges.add({ a: "use", x: "lantern", b: "crouch", start: "pause" }[k] || "_");
  padPrev = now;
  const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
  turn(dz(gp.axes[2]) * 14, dz(gp.axes[3]) * 10, 0.0055);
  return { mx: dz(gp.axes[0]), my: dz(gp.axes[1]), use: now.a, breath: now.lt, run: now.rt || now.l3, raise: now.y };
}

/** This step's input for game.step(). Edges are consumed. */
export function read() {
  const gp = readPad();
  let fwd = (keys.has("fwd") ? 1 : 0) - (keys.has("back") ? 1 : 0);
  let side = (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0);
  let run = keys.has("run");
  if (stick.id !== null) {
    const dx = stick.x - stick.ox, dy = stick.y - stick.oy, d = Math.hypot(dx, dy);
    const k = Math.min(1, d / STICK_R);
    if (d > 6) { fwd = (-dy / d) * k; side = (dx / d) * k; }
    run = d > STICK_R * 1.35;
  }
  if (gp) { if (gp.mx || gp.my) { fwd = -gp.my; side = gp.mx; } run = run || gp.run; }
  if (edges.has("crouch")) crouched = !crouched;
  const crouch = crouchToggle ? crouched || keys.has("crouchHold") : keys.has("crouch") || keys.has("crouchHold");
  if (run) crouched = false;
  const out = {
    fwd, side, run, crouch, yaw, pitch,
    use: keys.has("use") || held.use || held.mouseUse || (gp && gp.use),
    usePress: edges.has("use"),
    lanternPress: edges.has("lantern"),
    breath: keys.has("breath") || held.breath || (gp && gp.breath),
    raise: raise || keys.has("raise") || (gp && gp.raise),
    pause: edges.has("pause")
  };
  edges.clear();
  return out;
}

export function setEnabled(v) { enabled = v; if (!v) { keys.clear(); edges.clear(); held.use = held.breath = held.mouseUse = false; raise = false; stick.id = look.id = null; showStick(false); } }
export function setLook(y, p) { yaw = y; pitch = p || 0; }
export function getLook() { return { yaw, pitch }; }
export function clampYaw(center, half) {
  let d = yaw - center;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) > half) yaw = center + Math.sign(d) * half;
}
export function configure(o) { sens = o.sens; invert = o.invert; crouchToggle = o.crouchToggle !== false; }
export function resetCrouch() { crouched = false; }
export const touchMode = () => isTouch;
export const isLocked = () => document.pointerLockElement === canvas;

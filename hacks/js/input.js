/* input.js — keys, mouse and wheel in; one command per tick out.
 *
 * Every action is looked up through the player's binds (controls.js, stored
 * by save.js), two per action, so nothing about the keyboard is hard-coded
 * but Escape — which always opens the menu, because a player must always
 * have a way out that no bind can take away.
 *
 * The mouse turns your view directly (Source's m_yaw 0.022 degrees per
 * count, times your sensitivity), and the view is what each tick's command
 * carries. The wheel produces presses one tick long with a released tick
 * between them, so a wheel bound to jump is a fresh press every notch — the
 * way Source players bunny hop by hand.
 *
 * Touch (touch.js) feeds the same command through `touchState`.
 *
 * Aim, crouch, sprint, lunge and the scoreboard can each be held, toggled or
 * "mixed" — a tap toggles, a longer press holds — chosen separately for keys
 * and for touch (controls.js MODAL). Each source keeps its own latch, and an
 * action is on when either source says so. */

import { S, emit, on } from "./state.js";
import { save } from "./save.js";
import { ACTIONS, MODAL_IDS, MIXED_HOLD } from "./controls.js";
import { B } from "./movement.js";
import { clamp } from "./util.js";

const down = new Set();              // codes held right now
const edges = new Set();             // actions pressed since the last command
let wheelQueue = [];                 // actions, one press per notch
let wheelNow = null, wheelGap = false;
let capture = null;                  // the settings screen, waiting for a key
export const touchState = { fwd: 0, side: 0, held: new Set(), taps: new Set() };

const actionFor = (code) => { const out = []; const b = save.data.binds; for (const a of ACTIONS) if (b[a.id] && (b[a.id][0] === code || b[a.id][1] === code)) out.push(a.id); return out; };
const keyHeld = (action) => { const b = save.data.binds[action]; return !!b && ((b[0] && down.has(b[0])) || (b[1] && down.has(b[1]))); };

/* ---------------------------------------------------------------
   Hold, toggle, mixed
   --------------------------------------------------------------- */
const MODAL = new Set(MODAL_IDS);
const latch = { key: {}, touch: {} };       // action -> on, for toggle and mixed
const since = { key: {}, touch: {} };       // action -> when a mixed press switched it on (-1: that press switched it off)
const modeOf = (src, a) => (src === "key" ? save.settings.keyModes : save.settings.touchModes)[a] || "hold";
const now = () => performance.now() / 1000;
function modalDown(src, a) {
  const m = modeOf(src, a);
  if (m === "toggle") latch[src][a] = !latch[src][a];
  else if (m === "mixed") {
    if (latch[src][a]) { latch[src][a] = false; since[src][a] = -1; }
    else { latch[src][a] = true; since[src][a] = now(); }
  }
  changed(a);
}
function modalUp(src, a) {
  // a mixed press that lasted was a hold: it ends with the press
  if (modeOf(src, a) === "mixed" && latch[src][a] && since[src][a] >= 0 && now() - since[src][a] > MIXED_HOLD) latch[src][a] = false;
  changed(a);
}
function sourceOn(src, a) {
  const m = modeOf(src, a);
  if (m === "always") return true;
  if (m === "hold") return src === "key" ? keyHeld(a) : touchState.held.has(a);
  return !!latch[src][a];
}
/** Is an action on right now, from any source, in whatever mode each source uses? */
function held(action) {
  if (wheelNow === action) return true;
  if (MODAL.has(action)) return sourceOn("key", action) || sourceOn("touch", action);
  return keyHeld(action) || touchState.held.has(action);
}
/** For touch.js: is this button latched on (toggle and mixed, or always)? */
export function latched(action) {
  const m = modeOf("touch", action);
  return m === "always" || ((m === "toggle" || m === "mixed") && !!latch.touch[action]);
}
let scoreShown = false, lastFwd = 0;
function changed(a) {
  if (a !== "score") return;
  const v = held("score");
  if (v !== scoreShown) { scoreShown = v; emit("scoreboard", v); }
}
/** Every latch off: a new life starts standing, unaimed, with the board closed. */
export function resetLatches() {
  for (const src of ["key", "touch"]) { latch[src] = {}; since[src] = {}; }
  changed("score");
}
on("spawn", (a) => { if (a === S.me) resetLatches(); });
on("matchStart", resetLatches);

export const locked = () => document.pointerLockElement === document.getElementById("gl");
export function lock() {
  const c = document.getElementById("gl");
  if (!c.requestPointerLock || locked()) return;
  try { const p = c.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { c.requestPointerLock(); } catch (e) {} }); } catch (e) { try { c.requestPointerLock(); } catch (e2) {} }
}
export function unlock() { if (locked()) document.exitPointerLock(); }

/** Is the game taking input right now (not a menu, not the editor)? */
export const playing = () => S.mode === "play" && !document.body.classList.contains("menuOpen") && !document.body.classList.contains("hacking");

function press(code) {
  if (capture) return;
  if (down.has(code)) return;
  down.add(code);
  if (!playing()) return;
  for (const a of actionFor(code)) {
    edges.add(a);
    if (MODAL.has(a)) modalDown("key", a);
    if (a === "hacks") emit("toggleHacks");
  }
  emit("hackKey", code);
}
function release(code) {
  if (!down.delete(code)) return;
  // the action lets go only when neither of its keys is still down
  for (const a of actionFor(code)) if (MODAL.has(a) && !keyHeld(a)) modalUp("key", a);
}

/** Touch buttons press actions directly; touch.js keeps touchState.held. */
export function touchPress(action) {
  if (!playing()) { if (action === "menu") emit("menu"); return; }
  edges.add(action);
  if (MODAL.has(action)) modalDown("touch", action);
  if (action === "hacks") emit("toggleHacks");
  if (action === "menu") emit("menu");
}
export function touchRelease(action) { if (MODAL.has(action)) modalUp("touch", action); }

/* ---------------------------------------------------------------
   The command for one tick
   --------------------------------------------------------------- */
export function buildCmd() {
  // the wheel: one tick pressed, one tick released, per notch
  if (wheelGap) { wheelNow = null; wheelGap = false; }
  else if (wheelNow) { wheelNow = null; wheelGap = true; }
  else if (wheelQueue.length) {
    wheelNow = wheelQueue.shift(); edges.add(wheelNow);
    // a notch on a toggled or mixed action is a tap
    if (MODAL.has(wheelNow) && modeOf("key", wheelNow) !== "hold") { const a = wheelNow; wheelNow = null; modalDown("key", a); modalUp("key", a); }
  }

  const fwd = clamp((held("forward") ? 1 : 0) - (held("back") ? 1 : 0) + touchState.fwd, -1, 1);
  const side = clamp((held("right") ? 1 : 0) - (held("left") ? 1 : 0) + touchState.side, -1, 1);
  let b = 0;
  if (held("jump")) b |= B.JUMP;
  if (held("crouch")) b |= B.CROUCH;
  if (held("sprint") || touchState.autoSprint) b |= B.SPRINT;
  // a toggled sprint ends when you stop running (not merely before you start: Shift then W still sprints)
  if (fwd <= 0 && lastFwd > 0) { latch.key.sprint = false; latch.touch.sprint = false; }
  lastFwd = fwd;
  if (held("fire")) b |= B.FIRE;
  if (held("ads")) b |= B.ADS;
  if (held("reload")) b |= B.RELOAD;
  if (held("lunge")) b |= B.LUNGE;
  if (held("melee")) b |= B.MELEE;
  if (held("hook")) b |= B.HOOK;
  // a zoom step is a press; one shorter than a tick still counts
  if (held("zoom") || edges.has("zoom")) b |= B.ZOOM;
  // with the blade in hand, aiming is lunging
  if (S.me && S.me.arms.cur === 2 && (b & B.ADS)) b |= B.LUNGE;
  let slot = 0;
  if (edges.has("slot1")) slot = 1;
  else if (edges.has("slot2")) slot = 2;
  else if (edges.has("slot3")) slot = 3;
  else if (edges.has("last")) slot = -1;
  else if (edges.has("next") && S.me) slot = ((S.me.arms.cur + 1) % 3) + 1;
  edges.clear();
  return { fwd, side, yaw: S.view.yaw, pitch: S.view.pitch, buttons: b, slot };
}
/** What the player is holding now, for the hack API's `input` (before any hack changes it). */
export function heldCodes() { return [...down]; }

/* ---------------------------------------------------------------
   Looking
   --------------------------------------------------------------- */
const DEG = Math.PI / 180;
export function look(dx, dy, scale) {
  const a = S.me;
  let k = save.settings.sens * 0.022 * DEG * (scale || 1);
  if (a && a.arms) {
    const zoom = S.cam.zoom || 1;
    k *= 1 + (save.settings.adsSens / zoom - 1) * a.arms.ads;
  }
  S.view.yaw -= dx * k;
  S.view.pitch = clamp(S.view.pitch - dy * k * (save.settings.invertY ? -1 : 1), -1.55, 1.55);
}

/* ---------------------------------------------------------------
   Rebinding (the settings screen)
   --------------------------------------------------------------- */
/** Resolves with a code, "" to clear, or null if cancelled. */
export function captureBind() {
  return new Promise((resolve) => { capture = resolve; });
}
function captured(code) { const r = capture; capture = null; r(code); }

/* ---------------------------------------------------------------
   Wiring
   --------------------------------------------------------------- */
export function init() {
  const gl = document.getElementById("gl");
  addEventListener("keydown", (e) => {
    if (capture) {
      e.preventDefault();
      if (e.code === "Escape") captured(null);
      else if (e.code === "Backspace") captured("");
      else captured(e.code);
      return;
    }
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (e.code === "Escape") return;          // menus.js owns Escape
    if (e.repeat) { if (playing()) e.preventDefault(); return; }
    if (playing() && (e.code === "Tab" || e.code === "Space" || e.ctrlKey || e.code.startsWith("Arrow") || e.code === "Backquote")) e.preventDefault();
    press(e.code);
  });
  addEventListener("keyup", (e) => release(e.code));
  addEventListener("blur", () => { for (const c of [...down]) release(c); });
  gl.addEventListener("mousedown", (e) => {
    if (capture) return;
    if (S.mode === "play" && playing() && !locked() && !matchMedia("(pointer: coarse)").matches) { lock(); return; }
    press("Mouse" + e.button);
  });
  addEventListener("mousedown", (e) => {
    if (capture) { e.preventDefault(); captured("Mouse" + e.button); return; }
    if (e.target !== gl && locked()) press("Mouse" + e.button);
  }, true);
  addEventListener("mouseup", (e) => release("Mouse" + e.button));
  addEventListener("contextmenu", (e) => { if (S.mode === "play" && (locked() || e.target === gl)) e.preventDefault(); });
  addEventListener("mousemove", (e) => { if (locked() && playing()) look(e.movementX || 0, e.movementY || 0); });
  addEventListener("wheel", (e) => {
    const code = e.deltaY < 0 ? "WheelUp" : "WheelDown";
    if (capture) { e.preventDefault(); captured(code); return; }
    if (!locked() || !playing()) return;
    e.preventDefault();
    for (const a of actionFor(code)) if (wheelQueue.length < 6) wheelQueue.push(a);
  }, { passive: false });
  document.addEventListener("pointerlockchange", () => {
    // Escape releases the pointer before any key event arrives: that is the menu.
    if (!locked() && playing()) emit("menu");
    for (const c of [...down]) release(c);
  });
}

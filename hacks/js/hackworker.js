/* hackworker.js — where your hacks run.
 *
 * The language is JavaScript: the one every browser already runs, so a hack
 * is real code with no interpreter in between, what you learn here works
 * everywhere else, and the game can hand you the same maths it uses.
 *
 * Hacks run in this Web Worker, not in the page. That is the whole safety
 * story, and it is structural rather than a list of rules:
 *
 *   - A worker has no access to the page, the game's objects or the network
 *     connection to other players. Everything a hack knows arrives here as a
 *     copy, once a frame; everything it does leaves as a request the page
 *     checks (hackapi.js) before it touches anything.
 *   - The requests that exist are: press your own buttons, turn your own
 *     view, change your own body (velocity, gravity, speed, jump, where you
 *     stand), and draw on your own screen. There is no request that names
 *     another player, or anyone's health, ammo or score — so no hack can.
 *   - Other players arrive frozen. `enemy.hp = 0` is a TypeError, and the
 *     console says why: you can read them, never write them.
 *   - A hack that loops forever freezes only this worker; the page notices
 *     within a second, stops that hack, and starts the others again.
 *   - The network doors (fetch, WebSocket …) are closed before any hack
 *     runs. Hacks are for this game; nothing a hack sees leaves the device.
 *
 * Inside a hack, these are globals: me, players, enemies, allies,
 * projectiles, world, input, draw, screen, view, keys, vec, physics, match,
 * time, dt, BONES, LINKS, and deg/rad/wrap/clamp/lerp. These are the hack's
 * own: on(event, fn), ui, log/print, and `hack` (its name and id).
 * The full reference is the API tab of the hacks panel (hackdocs.js). */

import { importWorld, trace, newTrace } from "./brush.js";
import { newBody, pmove, TICK, B, PM } from "./movement.js";
import { BONES, LINKS } from "./skeleton.js";

/* Keep what the scaffold needs, then close the doors. */
const post = self.postMessage.bind(self);
const listen = self.addEventListener.bind(self);
const clock = () => performance.now();
for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "WebTransport", "EventSource", "BroadcastChannel", "importScripts", "indexedDB", "caches", "postMessage", "close", "Worker", "SharedWorker", "RTCPeerConnection"]) {
  try { Object.defineProperty(self, k, { value: undefined, writable: false, configurable: false }); } catch (e) { /* already gone */ }
}

const TR = newTrace();
let W = null, spawns = [];
let cur = null;                  // this frame, as the page described it (a stand-in until the first)
let out = null;                  // what this frame's hacks asked for
let running = null;              // the hack whose code is running now
const hacks = new Map();         // id -> hack
let order = [];
const LEVEL = { visual: 1, assist: 2, full: 3 };
let rules = "full";

/* Where a line in a stack trace is in the hack's own code: a Function body
   starts a couple of lines into what the engine counts, and how many varies. */
const PRELUDE = 1;
const OFFSET = (() => {
  try { new Function('"use strict";\nthrow new Error("x");\n//# sourceURL=hk-calibrate.js')(); } catch (e) {
    const m = /hk-calibrate\.js:(\d+)/.exec(String(e.stack));
    if (m) return +m[1] - 2;
  }
  return 2;
})();
function lineOf(err, id) {
  const m = new RegExp("hack-" + id + "\\.js:(\\d+)(?::(\\d+))?").exec(String(err && err.stack));
  return m ? Math.max(1, +m[1] - OFFSET - PRELUDE) : 0;
}

/* ---------------------------------------------------------------
   Small maths, shared by every hack
   --------------------------------------------------------------- */
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d === undefined ? 0 : d);
const V = (x, y, z) => ({ x: num(x), y: num(y), z: num(z) });
const pt = (p) => (Array.isArray(p) ? V(p[0], p[1], p[2]) : p && typeof p === "object" ? V(p.x, p.y, p.z) : V(0, 0, 0));
const vec = Object.freeze({
  v: V,
  add: (a, b) => V(a.x + b.x, a.y + b.y, a.z + b.z),
  sub: (a, b) => V(a.x - b.x, a.y - b.y, a.z - b.z),
  scale: (a, k) => V(a.x * k, a.y * k, a.z * k),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a, b) => V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x),
  len: (a) => Math.hypot(a.x, a.y, a.z),
  len2d: (a) => Math.hypot(a.x, a.z),
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  norm: (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return V(a.x / l, a.y / l, a.z / l); },
  lerp: (a, b, t) => V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t),
  /** The yaw and pitch (radians) that look from a to b. Yaw 0 faces -z. */
  angles: (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z; return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) }; },
  /** The unit vector a yaw and pitch look along. */
  fromAngles: (yaw, pitch) => { const c = Math.cos(pitch || 0); return V(-Math.sin(yaw) * c, Math.sin(pitch || 0), -Math.cos(yaw) * c); }
});
const deg = (r) => r * 180 / Math.PI;
const rad = (d) => d * Math.PI / 180;
const wrap = (a) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); }
  return o;
}

/* ---------------------------------------------------------------
   The world: the map, for raycasts you can make yourself
   --------------------------------------------------------------- */
function hitOut(tr, a, b) {
  const hit = tr.fraction < 1 || tr.startsolid;
  const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * tr.fraction;
  return Object.freeze({ hit, fraction: tr.fraction, distance: d, point: Object.freeze(V(tr.x, tr.y, tr.z)), normal: Object.freeze(V(tr.nx, tr.ny, tr.nz)), kind: tr.brush ? tr.brush.kind || "" : "" });
}
const world = Object.freeze({
  /** Cast a ray through the map (players do not block it). */
  raycast(from, to) { const a = pt(from), b = pt(to); if (!W) return hitOut({ fraction: 1, x: b.x, y: b.y, z: b.z, nx: 0, ny: 0, nz: 0 }, a, b); trace(W, a.x, a.y, a.z, b.x, b.y, b.z, 0, 0, 0, TR); return hitOut(TR, a, b); },
  /** Sweep a box of half-size `half` ({x,y,z}) from one centre to another. */
  traceBox(from, to, half) { const a = pt(from), b = pt(to), h = pt(half); trace(W, a.x, a.y, a.z, b.x, b.y, b.z, Math.abs(h.x), Math.abs(h.y), Math.abs(h.z), TR); return hitOut(TR, a, b); },
  /** Can a straight line get from a to b without hitting the map? */
  visible(from, to) { const a = pt(from), b = pt(to); if (!W) return true; trace(W, a.x, a.y, a.z, b.x, b.y, b.z, 0, 0, 0, TR); return TR.fraction === 1; },
  get time() { return cur ? cur.time : 0; },
  get tick() { return cur ? cur.tick : 0; },
  get spawns() { return spawns; },
  gravity: PM.gravity,
  tickRate: 1 / TICK,
  physics: Object.freeze(Object.assign({}, PM)),
  name: "Relay"
});

/* ---------------------------------------------------------------
   Physics: the game's own movement code, for predicting
   --------------------------------------------------------------- */
const BTN = { jump: B.JUMP, crouch: B.CROUCH, sprint: B.SPRINT };
function bodyFrom(p) {
  const s = p || cur.me;
  const b = newBody(s.position.x, s.position.y, s.position.z, s.yaw);
  b.vx = s.velocity.x; b.vy = s.velocity.y; b.vz = s.velocity.z;
  b.pitch = s.pitch || 0;
  b.onGround = !!s.onGround; b.crouched = !!s.crouched; b.eye = s.crouched ? PM.eyeCrouch : PM.eyeStand;
  if (s.gravityScale) b.gravityScale = s.gravityScale;
  if (s.speedScale) b.speedScale = s.speedScale;
  if (s.jumpScale) b.jumpScale = s.jumpScale;
  b.jumpHeld = true;
  return b;
}
const physics = Object.freeze({
  /**
   * Run the game's movement on a copy of a player for `ticks` ticks (64 a
   * second), pressing `cmd` every tick: { forward, side, yaw, pitch, jump,
   * crouch, sprint }. Returns where they end up and what happened on the way.
   * Nothing real moves.
   */
  simulate(player, cmd, ticks) {
    if (!W) return null;
    const b = bodyFrom(player);
    const c = cmd || {};
    const n = clamp(Math.floor(num(ticks, 1)), 1, 640);
    const events = [], path = [];
    let landedAt = -1;
    for (let i = 0; i < n; i++) {
      let bt = 0;
      for (const k in BTN) if (c[k]) bt |= BTN[k];
      pmove(W, b, { fwd: num(c.forward), side: num(c.side), yaw: num(c.yaw, b.yaw), pitch: num(c.pitch, b.pitch), buttons: bt }, TICK, {});
      for (const e of b.ev) { events.push({ tick: i + 1, type: e }); if (e === "land" && landedAt < 0) landedAt = i + 1; }
      b.ev.length = 0;
      if ((i & 3) === 3) path.push(V(b.x, b.y, b.z));
    }
    return deepFreeze({ position: V(b.x, b.y, b.z), velocity: V(b.vx, b.vy, b.vz), onGround: b.onGround, crouched: b.crouched, landedAt, events, path });
  },
  /** Where a player will be after `seconds` if they press nothing (friction, gravity, walls and all). */
  predict(player, seconds) {
    const r = this.simulate(player, { yaw: player.yaw }, Math.max(1, Math.round(num(seconds) / TICK)));
    return r ? r.position : null;
  },
  tick: TICK
});

/* ---------------------------------------------------------------
   Drawing: commands the page draws on its overlay
   --------------------------------------------------------------- */
const MAX_DRAW = 6000;
const col = (c, d) => (typeof c === "string" && c.length < 40 ? c : d || "#ffffff");
function cmd(a) { if (!live("draw")) return; if (out.draw.length < MAX_DRAW) out.draw.push(a); else if (!out.drawFull) { out.drawFull = true; warn("draw: more than " + MAX_DRAW + " shapes this frame; the rest were skipped"); } }
const draw = Object.freeze({
  line(x1, y1, x2, y2, color, width) { cmd(["l", num(x1), num(y1), num(x2), num(y2), col(color), num(width, 1)]); },
  rect(x, y, w, h, color, width) { cmd(["r", num(x), num(y), num(w), num(h), col(color), num(width, 1)]); },
  fillRect(x, y, w, h, color) { cmd(["R", num(x), num(y), num(w), num(h), col(color)]); },
  circle(x, y, r, color, width) { cmd(["c", num(x), num(y), Math.abs(num(r)), col(color), num(width, 1)]); },
  fillCircle(x, y, r, color) { cmd(["C", num(x), num(y), Math.abs(num(r)), col(color)]); },
  text(str, x, y, color, size, align) { cmd(["t", String(str).slice(0, 200), num(x), num(y), col(color), clamp(num(size, 14), 6, 96), align === "center" || align === "right" ? align : "left"]); },
  poly(points, color, fill) { if (Array.isArray(points)) cmd(["p", points.slice(0, 256).map((q) => [num(q.x), num(q.y)]), col(color), !!fill]); },
  /* In the world: the page projects these with this frame's camera, so they sit on the scene. */
  line3d(a, b, color, width) { a = pt(a); b = pt(b); cmd(["L", a.x, a.y, a.z, b.x, b.y, b.z, col(color), num(width, 1)]); },
  box3d(min, max, color, width) { const a = pt(min), b = pt(max); cmd(["B", a.x, a.y, a.z, b.x, b.y, b.z, col(color), num(width, 1)]); },
  circle3d(center, radius, color, width) { const c = pt(center); cmd(["O", c.x, c.y, c.z, Math.abs(num(radius, 1)), col(color), num(width, 1)]); },
  dot3d(p, r, color) { const c = pt(p); cmd(["D", c.x, c.y, c.z, Math.abs(num(r, 3)), col(color)]); },
  text3d(str, p, color, size) { const c = pt(p); cmd(["T", String(str).slice(0, 200), c.x, c.y, c.z, col(color), clamp(num(size, 13), 6, 96)]); },
  /** Show a player through walls, in a colour: the classic "chams". */
  highlight(player, color) { const id = player && typeof player === "object" ? player.id : player; if (typeof id === "number" && live("draw.highlight")) out.hl.push([id, col(color, "#ff3b6b")]); }
});
function project(p) {
  const e = cur.cam.vp, x = num(p.x), y = num(p.y), z = num(p.z);
  const cx = e[0] * x + e[4] * y + e[8] * z + e[12], cy = e[1] * x + e[5] * y + e[9] * z + e[13], cw = e[3] * x + e[7] * y + e[11] * z + e[15];
  if (cw <= 0.0001) return Object.freeze({ x: -9999, y: -9999, visible: false, behind: true });
  const nx = cx / cw, ny = cy / cw;
  return Object.freeze({ x: (nx * 0.5 + 0.5) * cur.cam.w, y: (-ny * 0.5 + 0.5) * cur.cam.h, visible: Math.abs(nx) <= 1 && Math.abs(ny) <= 1, behind: false });
}
const screen = Object.freeze({
  get width() { return cur ? cur.cam.w : 0; },
  get height() { return cur ? cur.cam.h : 0; },
  get center() { return cur ? { x: cur.cam.w / 2, y: cur.cam.h / 2 } : { x: 0, y: 0 }; },
  /** Where a point in the world lands on your screen: { x, y, visible, behind }. */
  toScreen(p) { return cur ? project(pt(p)) : { x: 0, y: 0, visible: false, behind: true }; }
});

/* ---------------------------------------------------------------
   What a hack may change: its own inputs, its own view, its own body
   --------------------------------------------------------------- */
const warned = new Set();
function warn(msg) {
  const key = (running ? running.id : "") + msg;
  if (warned.has(key)) return;
  warned.add(key);
  (out ? out.logs : pending).push([running ? running.id : "", "warn", msg]);
}
function need(level, what) {
  if (LEVEL[rules] >= LEVEL[level]) return true;
  warn(what + " needs the room's hack rules to be " + (level === "full" ? "Full self" : "Assist") + " (they are " + rules + "); ignored.");
  return false;
}
const INPUT_FIELDS = { forward: "n", side: "n", yaw: "a", pitch: "a", jump: "b", crouch: "b", sprint: "b", fire: "b", aim: "b", reload: "b", lunge: "b", melee: "b", slot: "i" };
const input = {};
for (const f in INPUT_FIELDS) {
  Object.defineProperty(input, f, {
    enumerable: true,
    get() { return out && f in out.input ? out.input[f] : cur ? cur.input[f] : 0; },
    set(v) {
      if (!live("input." + f) || !need("assist", "input." + f)) return;
      const t = INPUT_FIELDS[f];
      out.input[f] = t === "b" ? !!v : t === "i" ? clamp(Math.round(num(v)), -1, 3) : t === "a" ? num(v, cur.input[f]) : clamp(num(v), -1, 1);
    }
  });
}
Object.defineProperty(input, "lookAt", { value(p) { const a = vec.angles(cur.me.eye, pt(p)); input.yaw = a.yaw; input.pitch = a.pitch; return a; } });
Object.freeze(input);

/* A setting a hack makes (a wider view, lower gravity) stays until that
   hack changes it again or is stopped. Each hack keeps its own; later hacks
   in the list win where two disagree. */
function sticky(k) { let v = null; for (const id of order) { const h = hacks.get(id); if (h && !h.dead && h.sticky[k] != null) v = h.sticky[k]; } return v; }
function setSticky(k, v) { const h = running; if (h) h.sticky[k] = v; }
const view = Object.freeze({
  get fov() { const v = sticky("fov"); return v != null ? v : cur ? cur.cam.hfov : 90; },
  set fov(v) { setSticky("fov", clamp(num(v, 90), 30, 150)); },
  get thirdPerson() { return !!sticky("third"); },
  set thirdPerson(v) { setSticky("third", !!v); }
});

/* One-off changes only mean something during a frame. */
function live(what) { if (out) return true; warn(what + " only works inside a handler, such as on(\"tick\", …)"); return false; }
const meProto = {
  setVelocity(x, y, z) { if (live("me.setVelocity") && need("full", "me.setVelocity")) { const v = arguments.length === 1 ? pt(x) : V(x, y, z); out.self.vel = [v.x, v.y, v.z]; } },
  addVelocity(x, y, z) { if (live("me.addVelocity") && need("full", "me.addVelocity")) { const v = arguments.length === 1 ? pt(x) : V(x, y, z); const a = out.self.add || [0, 0, 0]; out.self.add = [a[0] + v.x, a[1] + v.y, a[2] + v.z]; } },
  teleport(x, y, z) { if (live("me.teleport") && need("full", "me.teleport")) { const v = arguments.length === 1 ? pt(x) : V(x, y, z); out.self.tp = [v.x, v.y, v.z]; } },
  get gravityScale() { const v = sticky("gravityScale"); return v != null ? v : 1; },
  set gravityScale(v) { if (need("full", "me.gravityScale")) setSticky("gravityScale", clamp(num(v, 1), -1, 4)); },
  get speedScale() { const v = sticky("speedScale"); return v != null ? v : 1; },
  set speedScale(v) { if (need("full", "me.speedScale")) setSticky("speedScale", clamp(num(v, 1), 0.1, 4)); },
  get jumpScale() { const v = sticky("jumpScale"); return v != null ? v : 1; },
  set jumpScale(v) { if (need("full", "me.jumpScale")) setSticky("jumpScale", clamp(num(v, 1), 0.1, 4)); }
};

const keys = Object.freeze({
  isDown(code) { return !!(cur && cur.keys.includes(String(code))); },
  get down() { return cur ? cur.keys.slice() : []; }
});

/* ---------------------------------------------------------------
   Players, as frozen copies with a few conveniences
   --------------------------------------------------------------- */
function player(p) {
  const o = Object.assign({}, p);
  let vis;
  Object.defineProperty(o, "visible", {
    enumerable: true,
    // is their chest in a straight line from your eye? (computed when asked)
    get() { if (vis === undefined) vis = !!(cur && cur.me && W) && world.visible(cur.me.eye, o.bones.chest); return vis; }
  });
  return deepFreeze(o);
}
function prepare(snap) {
  const meP = Object.create(meProto);
  Object.assign(meP, snap.me);
  deepFreeze(meP);
  const list = snap.players.map(player);
  snap.meObj = meP;
  snap.playersArr = Object.freeze(list);
  snap.enemiesArr = Object.freeze(list.filter((p) => p.enemy && p.alive));
  snap.alliesArr = Object.freeze(list.filter((p) => !p.enemy));
  snap.projArr = deepFreeze(snap.projectiles || []);
  snap.matchObj = deepFreeze(snap.match || {});
  return snap;
}

const GLOBALS = {
  me: () => (cur ? cur.meObj : null),
  players: () => (cur ? cur.playersArr : []),
  enemies: () => (cur ? cur.enemiesArr : []),
  allies: () => (cur ? cur.alliesArr : []),
  projectiles: () => (cur ? cur.projArr : []),
  match: () => (cur ? cur.matchObj : {}),
  time: () => (cur ? cur.time : 0),
  dt: () => (cur ? cur.dt : 0)
};
for (const k in GLOBALS) Object.defineProperty(self, k, { get: GLOBALS[k], configurable: false });
const CONSTS = { world, input, draw, screen, view, keys, vec, physics, BONES: Object.freeze(BONES.slice()), LINKS: deepFreeze(LINKS.map((l) => l.slice())), deg, rad, wrap, clamp, lerp };
for (const k in CONSTS) Object.defineProperty(self, k, { value: CONSTS[k], writable: false, configurable: false });

/* ---------------------------------------------------------------
   Loading a hack
   --------------------------------------------------------------- */
function fmt(v, depth) {
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  if (typeof v === "function") return "function " + (v.name || "") + "()";
  if (v === undefined) return "undefined";
  if (v === null || typeof v !== "object") return String(v);
  if ((depth || 0) > 2) return Array.isArray(v) ? "[…]" : "{…}";
  try {
    if (Array.isArray(v)) return "[" + v.slice(0, 20).map((x) => fmt(x, (depth || 0) + 1)).join(", ") + (v.length > 20 ? ", …" : "") + "]";
    const ks = Object.keys(v).slice(0, 16);
    return "{ " + ks.map((k) => k + ": " + fmt(v[k], (depth || 0) + 1)).join(", ") + (Object.keys(v).length > 16 ? ", …" : "") + " }";
  } catch (e) { return "[object]"; }
}
function makeHackScope(h) {
  const log = (...a) => {
    if (!out) { pending.push([h.id, "log", a.map((x) => fmt(x)).join(" ")]); return; }
    if (h.logCount++ < 40) out.logs.push([h.id, "log", a.map((x) => fmt(x)).join(" ").slice(0, 2000)]);
  };
  const on = (ev, fn) => {
    if (typeof fn !== "function") throw new TypeError('on("' + ev + '", fn): the second argument must be a function');
    (h.handlers[String(ev)] = h.handlers[String(ev)] || []).push(fn);
  };
  const control = (kind, label, a, b, c, d) => {
    label = String(label).slice(0, 40);
    let ctl = h.ui.find((x) => x.label === label);
    if (!ctl) {
      ctl = { kind, label };
      if (kind === "toggle") ctl.def = !!a;
      else if (kind === "slider") { ctl.min = num(a, 0); ctl.max = num(b, 1); ctl.def = clamp(num(c, ctl.min), ctl.min, ctl.max); ctl.step = num(d, (ctl.max - ctl.min) / 100); }
      else if (kind === "key") ctl.def = String(a || "");
      else if (kind === "color") ctl.def = col(a, "#ff3b6b");
      const saved = h.saved && h.saved[label];
      ctl.value = saved !== undefined && typeof saved === typeof ctl.def ? saved : ctl.def;
      if (kind === "slider") ctl.value = clamp(num(ctl.value, ctl.def), ctl.min, ctl.max);
      h.ui.push(ctl);
    }
    const handle = {};
    Object.defineProperty(handle, "value", { get: () => ctl.value, enumerable: true });
    if (kind === "key") Object.defineProperty(handle, "down", { get: () => keys.isDown(ctl.value) });
    return Object.freeze(handle);
  };
  const ui = Object.freeze({
    toggle: (label, def) => control("toggle", label, def),
    slider: (label, min, max, def, step) => control("slider", label, min, max, def, step),
    key: (label, def) => control("key", label, def),
    color: (label, def) => control("color", label, def)
  });
  return { on, ui, log, print: log, hack: Object.freeze({ id: h.id, name: h.name }) };
}
const pending = [];

/* new Function says a syntax error happened, never where. So: compile the
   first line, the first two, and so on — each with whatever brackets,
   strings and templates it leaves open closed off at the end — and the
   first prefix that is wrong (not merely unfinished), and stays wrong one
   line later, is where the mistake is. */
function closers(src) {
  const stack = [];
  let mode = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    if (mode === "//") { if (c === "\n") mode = null; continue; }
    if (mode === "/*") { if (c === "*" && d === "/") { mode = null; i++; } continue; }
    if (mode === '"' || mode === "'") { if (c === "\\") i++; else if (c === mode || c === "\n") mode = null; continue; }
    if (mode === "`") { if (c === "\\") i++; else if (c === "`") mode = null; else if (c === "$" && d === "{") { stack.push("}`"); mode = null; i++; } continue; }
    if (c === "/" && d === "/") { mode = "//"; i++; }
    else if (c === "/" && d === "*") { mode = "/*"; i++; }
    else if (c === '"' || c === "'" || c === "`") mode = c;
    else if (c === "(") stack.push(")");
    else if (c === "[") stack.push("]");
    else if (c === "{") stack.push("}");
    else if (c === ")" || c === "]" || c === "}") { if (stack.pop() === "}`") mode = "`"; }
  }
  let out = mode === "/*" ? "*/" : mode === '"' || mode === "'" || mode === "`" ? mode : "";
  out += "\n";
  for (let k = stack.length - 1; k >= 0; k--) out += stack[k];
  return out;
}
function wrongAt(lines, i) {
  const src = lines.slice(0, i).join("\n");
  try { new Function('"use strict";\n' + src + closers(src)); return false; }
  catch (e) { return !/end of input|Unterminated|unterminated|Unexpected end/.test(e.message); }
}
function syntaxLine(code) {
  const lines = code.split("\n");
  for (let i = 1; i <= lines.length; i++) if (wrongAt(lines, i) && (i === lines.length || wrongAt(lines, i + 1))) return i;
  return lines.length;
}

function load(msg) {
  unload(msg.id);
  const h = { id: msg.id, name: msg.name, handlers: {}, ui: [], saved: msg.ui || {}, sticky: {}, time: 0, logCount: 0, dead: false };
  const scope = makeHackScope(h);
  let fn;
  try {
    fn = new Function("on", "ui", "log", "print", "hack", '"use strict";\n' + msg.code + "\n//# sourceURL=hack-" + msg.id + ".js");
  } catch (e) {
    post({ t: "loaded", id: h.id, ok: false, error: e.name + ": " + e.message, line: syntaxLine(msg.code) });
    return;
  }
  hacks.set(h.id, h);
  if (!order.includes(h.id)) order.push(h.id);
  running = h;
  const t0 = clock();
  try { fn.call(undefined, scope.on, scope.ui, scope.log, scope.print, scope.hack); }
  catch (e) { running = null; hacks.delete(h.id); post({ t: "loaded", id: h.id, ok: false, error: explain(e), line: lineOf(e, h.id), logs: pending.splice(0) }); return; }
  running = null;
  post({ t: "loaded", id: h.id, ok: true, ui: h.ui, ms: clock() - t0, events: Object.keys(h.handlers), logs: pending.splice(0) });
}
function unload(id) { hacks.delete(id); order = order.filter((x) => x !== id); for (const k of [...warned]) if (k.startsWith(id)) warned.delete(k); }

/* A few errors every beginner meets, said plainly. */
function explain(e) {
  let m = (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e));
  if (/read only property|Cannot assign to read only|object is not extensible|Cannot add property/.test(m)) m += " — other players (and your own stats) are read-only. A hack changes only its own inputs (input.*), view (view.*) and body (me.setVelocity, me.teleport, me.gravityScale…).";
  else if (/is not defined/.test(m)) m += " — declare it with let or const first, or check the spelling.";
  else if (/Cannot read propert(y|ies) of (undefined|null)/.test(m)) m += " — something you expected to exist is not there (a player who has left? an empty list?). Check it before you use it.";
  return m;
}

/* ---------------------------------------------------------------
   A frame
   --------------------------------------------------------------- */
function runHandlers(h, ev, arg) {
  const list = h.handlers[ev];
  if (!list || h.dead) return;
  for (const fn of list) {
    running = h;
    try { fn(arg); }
    catch (e) {
      h.dead = true;
      out.errors.push([h.id, explain(e), lineOf(e, h.id), ev]);
      break;
    } finally { running = null; }
  }
}
function frame(snap) {
  cur = prepare(snap);
  rules = LEVEL[snap.rules] ? snap.rules : "visual";
  out = { t: "out", n: snap.n, input: {}, self: {}, view: {}, draw: [], hl: [], logs: pending.splice(0), errors: [], perf: {}, drawFull: false };
  for (const id of order) {
    const h = hacks.get(id);
    if (!h || h.dead) continue;
    h.logCount = 0;
    post({ t: "at", id });                       // for the watchdog, if this one never returns
    const t0 = clock();
    for (const e of snap.events) runHandlers(h, e.type, deepFreeze(e));
    for (const k of snap.pressed) runHandlers(h, "key", k);
    runHandlers(h, "tick", snap.dt);
    runHandlers(h, "draw", snap.dt);
    h.time = h.time * 0.9 + (clock() - t0) * 0.1;
    out.perf[id] = Math.round(h.time * 100) / 100;
  }
  delete out.drawFull;
  for (const k of ["gravityScale", "speedScale", "jumpScale"]) out.self[k] = sticky(k);
  out.view = { fov: sticky("fov"), third: !!sticky("third") };
  post(out);
  out = null;
}

/* Before the first frame (a hack loaded at the title screen) the globals
   still work: `me` is a stand-in at the origin, and the lists are empty. */
function placeholder() {
  const z = { x: 0, y: 0, z: 0 };
  const bones = {};
  for (const b of BONES) bones[b] = z;
  const me = { id: 0, name: "you", team: 0, bot: false, alive: false, hp: 100, maxHp: 100, position: z, velocity: z, speed: 0, yaw: 0, pitch: 0, eye: { x: 0, y: 1.62, z: 0 },
    onGround: true, crouched: false, sliding: false, climbing: false, lunge: "idle", bones, kills: 0, deaths: 0, sprinting: false, groundKind: "", groundNormal: { x: 0, y: 1, z: 0 },
    jumpHeld: false, slideCooldown: 0, wallJumpReady: true, climbLeft: PM.climbTime, lungeCharge: 0, lungeStuck: false, lungeNormal: null, respawnIn: 0,
    weapon: { slot: 1, id: "", name: "", cls: "", melee: false, ammo: 0, mag: 0, reloading: false, ads: 0, auto: false, rpm: 0, spread: 0, projectile: null, lastKick: { pitch: 0, yaw: 0 }, shots: 0, damage: 0, pellets: 1 },
    loadout: {} };
  return prepare({ n: 0, time: 0, tick: 0, dt: 0, rules: "full", me, players: [], projectiles: [], cam: { vp: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], w: 1, h: 1, hfov: 90 },
    input: { forward: 0, side: 0, yaw: 0, pitch: 0, jump: false, crouch: false, sprint: false, fire: false, aim: false, reload: false, lunge: false, melee: false, slot: 1 },
    keys: [], pressed: [], events: [], match: { mode: "", time: 0, timeLeft: 0, target: 0, rules: "full", over: false, score: { kills: {}, deaths: {}, teams: [0, 0] } } });
}
cur = placeholder();

listen("message", (e) => {
  const m = e.data;
  if (!m || typeof m !== "object") return;
  if (m.t === "init") { W = importWorld(m.world); spawns = deepFreeze((m.spawns || []).map((s) => ({ position: V(s.x, s.y, s.z), yaw: s.yaw }))); }
  else if (m.t === "load") load(m);
  else if (m.t === "unload") unload(m.id);
  else if (m.t === "frame") frame(m.snap);
  else if (m.t === "ui") { const h = hacks.get(m.id); const c = h && h.ui.find((x) => x.label === m.label); if (c) c.value = m.value; }
});
post({ t: "ready" });

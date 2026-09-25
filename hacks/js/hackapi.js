/* hackapi.js — the page's side of hacks: what they are shown, what they
 * may do, and the one place that decides.
 *
 * Once a frame the page describes the match to the worker (hackworker.js):
 * you, everyone else as frozen copies, the camera, your inputs, what just
 * happened. The worker answers with requests. This file is the only code
 * that turns a request into a change, and it only knows how to change four
 * things, all of them yours:
 *
 *   input     your next ticks' buttons, move keys, aim and weapon slot
 *   self      your body's velocity, gravity, speed, jump, and a teleport
 *   view      your field of view, and a third-person camera
 *   drawing   lines, boxes, text and see-through highlights on your screen
 *
 * each gated by the match's hack rules (modes.js HACK_RULES). Everything
 * else in a reply is ignored. That is why a hack cannot hurt the game: not
 * a filter on what is dangerous, but a short list of what is possible.
 *
 * A hack that never returns freezes only the worker. The watchdog here sees
 * no answer for a second, finds which hack was running (the worker says
 * each time it starts one), turns that hack off, and restarts the rest. */

import { S, on, emit } from "./state.js";
import { save } from "./save.js";
import { exportWorld } from "./brush.js";
import { world, isEnemy } from "./game.js";
import { bonesObject } from "./skeleton.js";
import { MELEE, gunOf, spreadOf } from "./weapons.js";
import { B, PM, LUNGE, placeBody } from "./movement.js";
import { worldToScreen, viewProjection } from "./render.js";
import { heldCodes } from "./input.js";
import { HACK_RULES } from "./modes.js";
import { clamp } from "./util.js";

const LEVEL = { visual: 1, assist: 2, full: 3 };
const WATCHDOG_MS = 1200;
const STALE_MS = 250;

let worker = null, ready = false, waiting = false, sentAt = 0, lastAt = null, frameNo = 0;
let latest = null, latestAt = 0, applied = -1, slotUsed = -1;
const status = new Map();          // hack id -> { state, error, line, ui, perf, events, ms }
export const logs = [];            // [{ id, kind, text }]
const events = [];
const pressed = [];
let rawCmd = { fwd: 0, side: 0, yaw: 0, pitch: 0, buttons: 0, slot: 0 };

export function rules() { return S.match && S.match.settings && HACK_RULES[S.match.settings.hacks] ? S.match.settings.hacks : "full"; }
const allowed = (lvl) => LEVEL[rules()] >= LEVEL[lvl];
export const statusOf = (id) => status.get(id) || { state: "off" };
export const running = () => [...status.values()].filter((s) => s.state === "on").length;

/* ---------------------------------------------------------------
   The worker
   --------------------------------------------------------------- */
export function start() {
  if (worker) return;
  try { worker = new Worker(new URL("./hackworker.js", import.meta.url), { type: "module" }); }
  catch (e) { log("", "error", "This browser cannot run hacks: " + e.message); return; }
  ready = false; waiting = false;
  worker.onmessage = (e) => onMessage(e.data);
  worker.onerror = (e) => { log("", "error", "The hack runner failed: " + (e.message || "unknown error")); e.preventDefault(); };
  const W = world();
  worker.postMessage({ t: "init", world: exportWorld(W), spawns: W.spawns });
  for (const h of save.data.hacks) if (h.on) sendLoad(h);
}
function restart(culprit) {
  if (worker) worker.terminate();
  worker = null;
  if (culprit) {
    const h = save.data.hacks.find((x) => x.id === culprit);
    if (h) { h.on = false; save.commit(); }
    status.set(culprit, { state: "error", error: "Stopped: it ran for over a second without finishing — an endless loop?", line: 0 });
    log(culprit, "error", "Stopped: it ran for over a second without finishing — an endless loop? It is switched off; fix it and press Run.");
  }
  resetBody();
  start();
  emit("hacksChanged");
}
function sendLoad(h) {
  status.set(h.id, { state: "loading" });
  worker.postMessage({ t: "load", id: h.id, name: h.name, code: h.code, ui: (h.ui && typeof h.ui === "object") ? h.ui : {} });
}

function onMessage(m) {
  if (!m || typeof m !== "object") return;
  if (m.t === "ready") { ready = true; return; }
  if (m.t === "at") { lastAt = typeof m.id === "string" ? m.id : null; return; }
  if (m.t === "loaded") {
    const h = save.data.hacks.find((x) => x.id === m.id);
    if (Array.isArray(m.logs)) takeLogs(m.logs);
    if (!h || !h.on) return;
    if (m.ok) {
      status.set(m.id, { state: "on", ui: Array.isArray(m.ui) ? m.ui : [], events: m.events || [], perf: 0 });
      log(m.id, "info", "Running" + (m.events && m.events.length ? " — listening for " + m.events.join(", ") : " — it has no on(…) handlers, so it only ran once"));
    } else {
      status.set(m.id, { state: "error", error: String(m.error || "error"), line: m.line | 0 });
      log(m.id, "error", String(m.error) + (m.line ? " (line " + m.line + ")" : ""));
    }
    emit("hacksChanged");
    return;
  }
  if (m.t === "out") {
    waiting = false;
    latest = m; latestAt = performance.now();
    takeLogs(m.logs);
    if (Array.isArray(m.errors)) for (const [id, msg, line, ev] of m.errors) {
      status.set(id, { state: "error", error: String(msg), line: line | 0 });
      log(id, "error", String(msg) + (line ? " (line " + line + ", in on(\"" + ev + "\"))" : ""));
      emit("hacksChanged");
    }
    if (m.perf) for (const id in m.perf) { const s = status.get(id); if (s) s.perf = m.perf[id]; }
    S.highlights = new Map(Array.isArray(m.hl) && allowed("visual") ? m.hl.slice(0, 64).filter((x) => Array.isArray(x)).map((x) => [x[0] | 0, String(x[1]).slice(0, 32)]) : []);
  }
}
function takeLogs(list) { if (Array.isArray(list)) for (const l of list.slice(0, 200)) if (Array.isArray(l)) log(String(l[0] || ""), l[1] === "warn" ? "warn" : "log", String(l[2]).slice(0, 2000)); }
export function log(id, kind, text) {
  logs.push({ id, kind, text, t: S.time });
  if (logs.length > 400) logs.splice(0, logs.length - 400);
  emit("hackLog");
}

/* ---------------------------------------------------------------
   Turning hacks on and off
   --------------------------------------------------------------- */
export function run(id) {
  const h = save.data.hacks.find((x) => x.id === id);
  if (!h) return;
  h.on = true; save.commit();
  if (!worker) start(); else sendLoad(h);
  emit("hacksChanged");
}
export function stop(id) {
  const h = save.data.hacks.find((x) => x.id === id);
  if (h) { h.on = false; save.commit(); }
  if (worker) worker.postMessage({ t: "unload", id });
  status.set(id, { state: "off" });
  resetBody();
  log(id, "info", "Stopped");
  emit("hacksChanged");
}
export function setUi(id, label, value) {
  const h = save.data.hacks.find((x) => x.id === id);
  if (!h) return;
  h.ui = Object.assign({}, h.ui || {}, { [label]: value });
  save.commit();
  const s = status.get(id);
  if (s && s.ui) { const c = s.ui.find((x) => x.label === label); if (c) c.value = value; }
  if (worker) worker.postMessage({ t: "ui", id, label, value });
}
/** A hack's changes to your body end when the hack does. */
function resetBody() {
  if (S.me) { S.me.body.gravityScale = 1; S.me.body.speedScale = 1; S.me.body.jumpScale = 1; }
  S.hackView = null;
  S.highlights = null;
  latest = null;
}

/* ---------------------------------------------------------------
   Applying a reply
   --------------------------------------------------------------- */
const fresh = () => latest && performance.now() - latestAt < STALE_MS;

/** Once a frame, before the ticks: your body and your view. */
export function beforeTicks() {
  S.hackCount = running();
  if (!latest || !S.me) { S.hackView = null; return; }
  const view = latest.view || {};
  S.hackView = { fov: typeof view.fov === "number" && isFinite(view.fov) ? clamp(view.fov, 30, 150) : null, thirdPerson: !!view.third };
  const body = S.me.body;
  const self = latest.self || {};
  if (!allowed("full")) { body.gravityScale = body.speedScale = body.jumpScale = 1; return; }
  const sc = (v, a, b) => (typeof v === "number" && isFinite(v) ? clamp(v, a, b) : 1);
  body.gravityScale = sc(self.gravityScale, -1, 4);
  body.speedScale = sc(self.speedScale, 0.1, 4);
  body.jumpScale = sc(self.jumpScale, 0.1, 4);
  if (applied === latest.n || !S.me.alive) return;
  applied = latest.n;
  const v3 = (a) => Array.isArray(a) && a.length === 3 && a.every((x) => typeof x === "number" && isFinite(x));
  if (v3(self.vel)) { body.vx = self.vel[0]; body.vy = self.vel[1]; body.vz = self.vel[2]; if (body.vy > 0.5) body.onGround = false; }
  if (v3(self.add)) { body.vx += self.add[0]; body.vy += self.add[1]; body.vz += self.add[2]; if (self.add[1] > 0.5) body.onGround = false; }
  const s = Math.hypot(body.vx, body.vy, body.vz);
  if (s > PM.maxvelocity) { const k = PM.maxvelocity / s; body.vx *= k; body.vy *= k; body.vz *= k; }
  if (v3(self.tp)) {
    const W = world(), [x, y, z] = self.tp;
    // somewhere inside the arena, and somewhere a body fits
    const inside = x > W.min[0] && x < W.max[0] && z > W.min[2] && z < W.max[2] && y > -1 && y < 25;
    if (!inside || !placeBody(W, body, x, y, z)) log("", "warn", "me.teleport: there is no room for you there; ignored.");
    else { S.me.px = x; S.me.py = y; S.me.pz = z; }
  }
}

/** Every tick: your command, with whatever the hacks asked for on top. */
export function patch(cmd) {
  rawCmd = cmd;
  if (!fresh() || !allowed("assist") || !latest.input) return cmd;
  const i = latest.input;
  const c = Object.assign({}, cmd);
  const n = (v) => typeof v === "number" && isFinite(v);
  if (n(i.forward)) c.fwd = clamp(i.forward, -1, 1);
  if (n(i.side)) c.side = clamp(i.side, -1, 1);
  if (n(i.yaw)) { c.yaw = i.yaw; S.view.yaw = i.yaw; }
  if (n(i.pitch)) { c.pitch = clamp(i.pitch, -1.55, 1.55); S.view.pitch = c.pitch; }
  const btn = { jump: B.JUMP, crouch: B.CROUCH, sprint: B.SPRINT, fire: B.FIRE, aim: B.ADS, reload: B.RELOAD, lunge: B.LUNGE, melee: B.MELEE };
  for (const k in btn) if (typeof i[k] === "boolean") c.buttons = i[k] ? c.buttons | btn[k] : c.buttons & ~btn[k];
  if (n(i.slot) && slotUsed !== latest.n) { c.slot = clamp(Math.round(i.slot), -1, 3); slotUsed = latest.n; }
  return c;
}

/* ---------------------------------------------------------------
   Describing the match to the worker
   --------------------------------------------------------------- */
const v3o = (x, y, z) => ({ x: +x.toFixed(4), y: +y.toFixed(4), z: +z.toFixed(4) });
const lungeState = (b) => (b.lunge === LUNGE.CHARGE ? "charging" : b.lunge === LUNGE.DASH ? "dashing" : "idle");
function weaponOf(a, full) {
  const A = a.arms, g = gunOf(A);
  if (!g) { const m = MELEE[A.melee]; return { slot: 3, id: m.id, name: m.name, cls: "Melee", melee: true }; }
  const w = { slot: A.cur + 1, id: g.id, name: g.name, cls: g.cls, melee: false };
  if (full) Object.assign(w, {
    ammo: A.ammo[A.cur], mag: g.mag, reloading: A.reloadT > 0, ads: +A.ads.toFixed(3), auto: g.auto, rpm: g.rpm,
    spread: +spreadOf(A, a.body).toFixed(3), projectile: g.projectile ? { speed: g.projectile.speed, gravity: g.projectile.gravity } : null,
    lastKick: { pitch: A.lastKick.pitch, yaw: A.lastKick.yaw }, shots: A.shots, damage: g.dmg, pellets: g.pellets || 1
  });
  return w;
}
function common(a) {
  const b = a.body;
  return {
    id: a.id, name: a.name, team: a.team, bot: a.kind === "bot", alive: a.alive, hp: Math.max(0, Math.round(a.hp)), maxHp: a.maxHp,
    position: v3o(b.x, b.y, b.z), velocity: v3o(b.vx, b.vy, b.vz), speed: +Math.hypot(b.vx, b.vz).toFixed(3),
    yaw: +b.yaw.toFixed(5), pitch: +b.pitch.toFixed(5), eye: v3o(b.x, b.y + b.eye, b.z),
    onGround: b.onGround, crouched: b.crouched, sliding: b.sliding, climbing: b.climbing, lunge: lungeState(b),
    bones: bonesObject(a.bones), kills: a.kills, deaths: a.deaths
  };
}
function snapshot(dt) {
  const me = S.me;
  const m = common(me);
  const b = me.body, A = me.arms;
  Object.assign(m, {
    weapon: weaponOf(me, true), loadout: { primary: A.slots[0], secondary: A.slots[1], melee: A.melee },
    sprinting: b.sprinting, groundKind: b.groundKind, groundNormal: v3o(b.gnx, b.gny, b.gnz), jumpHeld: b.jumpHeld,
    slideCooldown: +b.slideCd.toFixed(3), wallJumpReady: b.wallCd <= 0, climbLeft: +b.climbBudget.toFixed(3),
    lungeCharge: +b.lungeCharge.toFixed(3), lungeStuck: b.lungeStuck, lungeNormal: b.lungeStuck ? v3o(b.lnx, b.lny, b.lnz) : null,
    respawnIn: me.alive ? 0 : +me.respawnT.toFixed(2)
  });
  const players = [];
  for (const a of S.actors) {
    if (a === me || !a.heard) continue;
    const p = common(a);
    p.enemy = isEnemy(me, a);
    p.weapon = weaponOf(a, false);
    p.distance = +Math.hypot(a.body.x - b.x, a.body.y - b.y, a.body.z - b.z).toFixed(3);
    players.push(p);
  }
  const M = S.match;
  return {
    n: ++frameNo, time: +S.time.toFixed(4), tick: S.tick, dt: +dt.toFixed(5), rules: rules(),
    me: m, players,
    projectiles: S.projectiles.map((p) => ({ owner: p.owner, position: v3o(p.x, p.y, p.z), velocity: v3o(p.vx, p.vy, p.vz), gravity: p.g })),
    cam: { vp: viewProjection(), w: window.innerWidth, h: window.innerHeight, hfov: (S.hackView && S.hackView.fov) || save.settings.fov },
    input: { forward: rawCmd.fwd, side: rawCmd.side, yaw: S.view.yaw, pitch: S.view.pitch, jump: !!(rawCmd.buttons & B.JUMP), crouch: !!(rawCmd.buttons & B.CROUCH),
      sprint: !!(rawCmd.buttons & B.SPRINT), fire: !!(rawCmd.buttons & B.FIRE), aim: !!(rawCmd.buttons & B.ADS), reload: !!(rawCmd.buttons & B.RELOAD),
      lunge: !!(rawCmd.buttons & B.LUNGE), melee: !!(rawCmd.buttons & B.MELEE), slot: me.arms.cur + 1 },
    keys: heldCodes(), pressed: pressed.splice(0),
    events: events.splice(0, 200),
    match: { mode: M.mode, time: +S.time.toFixed(3), timeLeft: +M.timeLeft.toFixed(2), target: M.settings.target, rules: rules(), over: M.over,
      score: { kills: Object.assign({}, M.score.k), deaths: Object.assign({}, M.score.d), teams: M.score.tk.slice() } }
  };
}

/** Once a frame, after drawing: tell the worker about it, or notice it has hung. */
export function afterFrame(dt) {
  if (!worker || !ready) return;
  if (!running()) { events.length = 0; pressed.length = 0; return; }
  if (waiting) {
    if (performance.now() - sentAt > WATCHDOG_MS) restart(lastAt);
    return;
  }
  if (!S.match || !S.me || S.mode !== "play") return;
  waiting = true; sentAt = performance.now(); lastAt = null;
  worker.postMessage({ t: "frame", snap: snapshot(dt) });
}

/* ---------------------------------------------------------------
   What just happened, for on("…") handlers
   --------------------------------------------------------------- */
const pos = (a) => v3o(a.body.x, a.body.y, a.body.z);
function ev(e) { if (running() && events.length < 400) events.push(e); }
on("tracer", (a, o, h, gun) => ev({ type: "shot", by: a.id, mine: a === S.me, weapon: gun, from: v3o(o[0], o[1], o[2]), to: v3o(h.x, h.y, h.z), hit: h.actor ? h.actor.id : null, part: h.part || null }));
on("hit", (a, b, dmg, info) => { if (a === S.me) ev({ type: "hit", target: b.id, damage: dmg, part: info && info.part, weapon: info && info.weapon }); });
on("hurt", (b, dmg, by) => { if (b === S.me) ev({ type: "hurt", by, damage: dmg }); });
on("killfeed", (k) => ev({ type: "kill", killer: k.killer ? k.killer.id : null, victim: k.victim ? k.victim.id : null, weapon: k.weapon, head: k.head }));
on("died", (b, by) => { if (b === S.me) ev({ type: "death", by }); });
on("spawn", (a) => { if (a === S.me) ev({ type: "spawn", position: pos(a) }); });
on("move", (a, e) => { if (a === S.me) ev({ type: e, position: pos(a), speed: +Math.hypot(a.body.vx, a.body.vz).toFixed(3) }); });
on("hackKey", (code) => { if (running() && pressed.length < 32) pressed.push(code); });

/* ---------------------------------------------------------------
   Drawing a reply on the overlay
   --------------------------------------------------------------- */
const canvas = () => document.getElementById("overlay");
let ctx = null, cw = 0, ch = 0, dpr = 1;
const A = {}, Bp = {};
function nearClip(a, b) {
  // keep a segment in front of the camera before projecting it
  const fx = -Math.sin(S.cam.yaw) * Math.cos(S.cam.pitch), fy = Math.sin(S.cam.pitch), fz = -Math.cos(S.cam.yaw) * Math.cos(S.cam.pitch);
  const da = (a[0] - S.cam.x) * fx + (a[1] - S.cam.y) * fy + (a[2] - S.cam.z) * fz - 0.1;
  const db = (b[0] - S.cam.x) * fx + (b[1] - S.cam.y) * fy + (b[2] - S.cam.z) * fz - 0.1;
  if (da < 0 && db < 0) return false;
  if (da < 0) { const t = da / (da - db); a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  if (db < 0) { const t = db / (db - da); b = [b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t, b[2] + (a[2] - b[2]) * t]; }
  worldToScreen(a[0], a[1], a[2], A); worldToScreen(b[0], b[1], b[2], Bp);
  return true;
}
function seg3(g, a, b) { if (nearClip(a, b)) { g.moveTo(A.x, A.y); g.lineTo(Bp.x, Bp.y); } }
export function drawOverlay() {
  const c = canvas();
  if (!ctx) ctx = c.getContext("2d");
  const w = window.innerWidth, h = window.innerHeight, r = Math.min(2, window.devicePixelRatio || 1);
  if (w !== cw || h !== ch || r !== dpr) { cw = w; ch = h; dpr = r; c.width = w * r; c.height = h * r; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  // a hack that has stopped answering leaves its last frame up for a second, then nothing
  if (!latest || performance.now() - latestAt > 1000 || S.mode !== "play" || !Array.isArray(latest.draw)) return;
  const g = ctx;
  g.lineJoin = "round"; g.lineCap = "round";
  for (const d of latest.draw) {
    if (!Array.isArray(d)) continue;
    try {
      switch (d[0]) {
        case "l": g.strokeStyle = d[5]; g.lineWidth = d[6]; g.beginPath(); g.moveTo(d[1], d[2]); g.lineTo(d[3], d[4]); g.stroke(); break;
        case "r": g.strokeStyle = d[5]; g.lineWidth = d[6]; g.strokeRect(d[1], d[2], d[3], d[4]); break;
        case "R": g.fillStyle = d[5]; g.fillRect(d[1], d[2], d[3], d[4]); break;
        case "c": g.strokeStyle = d[4]; g.lineWidth = d[5]; g.beginPath(); g.arc(d[1], d[2], d[3], 0, Math.PI * 2); g.stroke(); break;
        case "C": g.fillStyle = d[4]; g.beginPath(); g.arc(d[1], d[2], d[3], 0, Math.PI * 2); g.fill(); break;
        case "t": g.fillStyle = d[4]; g.font = "600 " + d[5] + "px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"; g.textAlign = d[6]; g.textBaseline = "top";
          g.strokeStyle = "rgba(0,0,0,0.65)"; g.lineWidth = 3; g.strokeText(d[1], d[2], d[3]); g.fillText(d[1], d[2], d[3]); break;
        case "p": if (Array.isArray(d[1]) && d[1].length > 1) { g.beginPath(); d[1].forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath(); if (d[3]) { g.fillStyle = d[2]; g.fill(); } else { g.strokeStyle = d[2]; g.lineWidth = 1.5; g.stroke(); } } break;
        case "L": g.strokeStyle = d[7]; g.lineWidth = d[8]; g.beginPath(); seg3(g, [d[1], d[2], d[3]], [d[4], d[5], d[6]]); g.stroke(); break;
        case "B": {
          const [x0, y0, z0, x1, y1, z1] = d.slice(1, 7);
          const P = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
          g.strokeStyle = d[7]; g.lineWidth = d[8]; g.beginPath();
          for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]) seg3(g, P[i], P[j]);
          g.stroke(); break;
        }
        case "O": {
          g.strokeStyle = d[5]; g.lineWidth = d[6]; g.beginPath();
          for (let i = 0; i < 28; i++) {
            const a0 = i / 28 * Math.PI * 2, a1 = (i + 1) / 28 * Math.PI * 2;
            seg3(g, [d[1] + Math.cos(a0) * d[4], d[2], d[3] + Math.sin(a0) * d[4]], [d[1] + Math.cos(a1) * d[4], d[2], d[3] + Math.sin(a1) * d[4]]);
          }
          g.stroke(); break;
        }
        case "D": worldToScreen(d[1], d[2], d[3], A); if (!A.behind) { g.fillStyle = d[5]; g.beginPath(); g.arc(A.x, A.y, d[4], 0, Math.PI * 2); g.fill(); } break;
        case "T": worldToScreen(d[2], d[3], d[4], A); if (!A.behind) { g.fillStyle = d[5]; g.font = "600 " + d[6] + "px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"; g.textAlign = "center"; g.textBaseline = "bottom"; g.strokeStyle = "rgba(0,0,0,0.65)"; g.lineWidth = 3; g.strokeText(d[1], A.x, A.y); g.fillText(d[1], A.x, A.y); } break;
      }
    } catch (e) { /* a malformed shape is only a shape */ }
  }
}

on("quit", () => { latest = null; S.highlights = null; S.hackView = null; events.length = 0; drawOverlay(); });
on("matchStart", () => { events.length = 0; applied = -1; });

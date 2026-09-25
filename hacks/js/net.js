/* net.js — one match, kept in step across a room.
 *
 * The same split Magic Sandbox's net.js makes, for a shooter:
 *
 *   - Your body is yours. Your machine moves it, fires its guns and decides
 *     what its shots hit, against the other bodies as your screen shows them
 *     (favour the shooter: if it was on your crosshair, it was hit). A hit is
 *     sent to whoever owns the body that was hit, and that machine applies
 *     the damage and decides whether it died.
 *   - The host owns the bots, the clock and the score. It runs the bots'
 *     brains, applies hits to them, counts every death and calls the end.
 *   - Everything is relayed by the host, which is also a player: a client
 *     only talks to the host.
 *
 * Messages, small JSON on the one ordered channel peer.js gives us:
 *   start      the host starts (or catches a latecomer up on) a match
 *   bots       the host's bot roster, whenever it changes
 *   st / ps    one body's state at 30 Hz; the host sends all of them together
 *   sh         somebody fired: where from, where each round ended up
 *   hit        a shot landed on a body somebody else owns
 *   die        the owner of a body says it died (and who did it)
 *   kill       the host's word on a death, with the whole score
 *   end        the host calls the match
 *
 * Other bodies are drawn 100 ms in the past, between the two states either
 * side of that moment — smooth, at the cost of a tenth of a second. Your hacks
 * see them exactly where they are drawn, which is also where your shots are
 * tested. The room itself (roster, settings, phase) is lobby.js's. */

import { S, on, emit } from "./state.js";
import * as game from "./game.js";
import { save } from "./save.js";
import { cleanLoadout, GUNS, MELEE } from "./weapons.js";
import { cleanSettings } from "./modes.js";
import { pose, stepPhase } from "./skeleton.js";
import { holdOf } from "./weapons.js";
import { PM, LUNGE } from "./movement.js";
import { wrapAngle } from "./util.js";

const HOST = 1;
const ST_MS = 33, INTERP_MS = 100;
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d || 0);
const r3 = (v) => Math.round(v * 1000) / 1000;

let room = null;
let stAcc = 0, psAcc = 0;
const latest = new Map();          // host: id -> last packed state
let moveEv = [];                   // your movement sounds since the last state

export const isHost = () => S.net.role === "host";
export const inMatch = () => S.net.role !== "solo" && !!S.match;

/* ---------------------------------------------------------------
   Room attachment
   --------------------------------------------------------------- */
export function attach(r) {
  detach();
  room = r;
  r.on("msg", onMsg);
  r.on("roster", () => { if (inMatch()) syncRemotes(); });
  r.on("join", (id) => { if (inMatch() && isHost() && !S.match.over) catchUp(id); });
  r.on("leave", () => { if (inMatch() && isHost()) refill(); });
}
export function detach() {
  if (inMatch()) leaveMatch();
  room = null;
  S.net.role = "solo";
}
export function leaveMatch() {
  if (S.match) emit("quitMatch");
  S.net.role = "solo";
  latest.clear();
}

/* ---------------------------------------------------------------
   Starting
   --------------------------------------------------------------- */
const botList = () => S.actors.filter((a) => a.kind === "bot").map((b) => ({ id: b.id, name: b.name, team: b.team, l: b.loadout, d: b.diff }));

/** Host: the Start button. */
export function hostStart() {
  if (!room || room.role !== "host") return;
  const s = cleanSettings(room.settings);
  room.setPhase("playing");
  begin({ s, late: false }, true);
  room.broadcast({ t: "start", s, bots: botList(), score: S.match.score, tl: S.match.timeLeft });
}
function begin(m, host) {
  const s = cleanSettings(m.s);
  S.net.role = host ? "host" : "client";
  const self = room.self() || { team: 0, name: save.data.name };
  S.topSpeed = 0;
  game.startMatch(s, { me: { id: room.me, name: self.name, team: self.team, loadout: save.data.loadout }, humans: room.present().length });
  if (!host) {
    if (m.score) S.match.score = m.score;
    if (typeof m.tl === "number") S.match.timeLeft = m.tl;
    setBots(m.bots);
  }
  syncRemotes();
  emit("netMatch");
}

/* ---------------------------------------------------------------
   Remote bodies
   --------------------------------------------------------------- */
function syncRemotes() {
  if (!room || !S.match) return;
  const want = room.roster.filter((p) => p.id !== room.me);
  for (const a of S.actors.slice()) {
    if (a.kind !== "remote") continue;
    const p = want.find((w) => w.id === a.id);
    if (!p) { game.removeActor(a); continue; }
    a.name = p.name; a.team = p.team;
  }
  for (const p of want) {
    if (S.actors.some((a) => a.id === p.id)) continue;
    const a = game.makeActor({ id: p.id, name: p.name, team: p.team, kind: "remote" });
    a.net = { buf: [] };
    a.heard = false;
    game.addActor(a);
  }
  const me = room.self();
  if (me && S.me && S.me.team !== me.team) S.me.team = me.team;
  game.recolor();
}
/** Client: the host's bots, as puppets. */
function setBots(list) {
  if (!Array.isArray(list)) return;
  const ids = new Set();
  for (const b of list.slice(0, 16)) {
    const id = b.id | 0;
    if (id < 1000) continue;
    ids.add(id);
    let a = game.actorById(id);
    if (!a) {
      a = game.makeActor({ id, name: String(b.name || "Bot").slice(0, 16), team: b.team === 1 ? 1 : 0, kind: "bot", loadout: cleanLoadout(b.l) });
      a.net = { buf: [] }; a.heard = false; a.alive = false;
      game.addActor(a);
    }
  }
  for (const a of S.actors.slice()) if (a.kind === "bot" && !ids.has(a.id)) game.removeActor(a);
}
/** Host: after someone joins or leaves, the bots make up the numbers. */
function refill() {
  game.fillBots(room.present().length);
  room.broadcast({ t: "bots", a: botList() });
}

/* ---------------------------------------------------------------
   State: yours out, everyone's in
   --------------------------------------------------------------- */
function flags(a) {
  const b = a.body;
  return (a.alive ? 1 : 0) | (b.onGround ? 2 : 0) | (b.crouched ? 4 : 0) | (b.sliding ? 8 : 0) | (b.climbing ? 16 : 0) |
    (b.lunge === LUNGE.CHARGE ? 32 : 0) | (b.lunge === LUNGE.DASH ? 64 : 0) | (b.sprinting ? 128 : 0) | (a.arms.ads > 0.5 ? 256 : 0);
}
function pack(a, ev) {
  const b = a.body, A = a.arms;
  const w = A.cur < 2 ? A.slots[A.cur] : A.melee;
  return [a.id, r3(b.x), r3(b.y), r3(b.z), r3(b.vx), r3(b.vy), r3(b.vz), r3(b.yaw), r3(b.pitch), flags(a), Math.ceil(a.hp), A.cur, w, ev && ev.length ? ev : 0];
}
function unpack(x) {
  if (!Array.isArray(x) || x.length < 13) return null;
  return { id: x[0] | 0, x: num(x[1]), y: num(x[2]), z: num(x[3]), vx: num(x[4]), vy: num(x[5]), vz: num(x[6]), yaw: num(x[7]), pitch: num(x[8]), f: x[9] | 0, hp: num(x[10], 100), cur: x[11] | 0, w: String(x[12] || ""), ev: Array.isArray(x[13]) ? x[13].slice(0, 8) : null };
}
function heard(s) {
  if (!s) return;
  const a = game.actorById(s.id);
  if (!a || a === S.me || game.owns(a)) return;
  if (!a.net) a.net = { buf: [] };
  a.net.buf.push({ t: performance.now(), s });
  if (a.net.buf.length > 30) a.net.buf.shift();
  // their movement sounds (and swings), for your ears
  if (s.ev) for (const e of s.ev) if (typeof e === "string" && e.length < 12) emit("move", a, e);
}

/** Place every puppet where it was INTERP_MS ago. */
function puppets(dt) {
  const t = performance.now() - INTERP_MS;
  for (const a of S.actors) {
    if (game.owns(a) || !a.net) continue;
    const buf = a.net.buf;
    if (!buf.length) continue;
    let i = buf.length - 1;
    while (i > 0 && buf[i - 1].t > t) i--;
    const B = buf[i], A = buf[i - 1] || B;
    const span = B.t - A.t;
    const k = span > 0 ? Math.max(0, Math.min(1, (t - A.t) / span)) : 1;
    const s0 = A.s, s1 = B.s;
    const b = a.body;
    b.x = s0.x + (s1.x - s0.x) * k; b.y = s0.y + (s1.y - s0.y) * k; b.z = s0.z + (s1.z - s0.z) * k;
    b.vx = s1.vx; b.vy = s1.vy; b.vz = s1.vz;
    b.yaw = s0.yaw + wrapAngle(s1.yaw - s0.yaw) * k; b.pitch = s0.pitch + (s1.pitch - s0.pitch) * k;
    const f = s1.f;
    b.onGround = !!(f & 2); b.crouched = !!(f & 4); b.sliding = !!(f & 8); b.climbing = !!(f & 16);
    b.lunge = f & 64 ? LUNGE.DASH : f & 32 ? LUNGE.CHARGE : LUNGE.IDLE; b.sprinting = !!(f & 128);
    b.eye += ((b.crouched ? PM.eyeCrouch : PM.eyeStand) - b.eye) * Math.min(1, dt * 14);
    a.arms.ads = f & 256 ? 1 : 0;
    const alive = !!(f & 1);
    if (alive && !a.alive) { a.alive = true; emit("spawn", a); }
    else if (!alive && a.alive) a.alive = false;
    a.hp = s1.hp;
    a.arms.cur = Math.max(0, Math.min(2, s1.cur));
    if (a.arms.cur < 2 && GUNS[s1.w]) a.arms.slots[a.arms.cur] = s1.w;
    else if (a.arms.cur === 2 && MELEE[s1.w]) a.arms.melee = s1.w;
    a.heard = true;
    a.phase = stepPhase(a.phase, Math.hypot(b.vx, b.vz), dt, b.onGround);
    a.bones = pose(game.poseState(a), holdOf(a.arms), a.bones);
  }
}

/* ---------------------------------------------------------------
   Messages
   --------------------------------------------------------------- */
function onMsg(from, m) {
  if (!m || typeof m !== "object") return;
  const host = isHost();
  if (m.t === "start") { if (!host) begin(m, false); return; }
  if (!S.match) return;
  switch (m.t) {
    case "st": if (host) { const s = unpack(m.a); if (s && s.id === from) { latest.set(from, m.a); heard(s); } } break;
    case "ps": if (!host && Array.isArray(m.a)) { for (const x of m.a) heard(unpack(x)); if (typeof m.tl === "number") S.match.timeLeft = m.tl; } break;
    case "bots": if (!host) setBots(m.a); break;
    case "sh": {
      const by = host ? from : m.by | 0;
      if (host) room.broadcast(Object.assign({}, m, { by }), from);
      if (by !== room.me) foreignShot(by, m);
      break;
    }
    case "hit": {
      const v = m.v | 0, by = host ? from : m.by | 0;
      const target = game.actorById(v);
      if (!target) break;
      if (game.owns(target)) game.applyDamage(target, Math.min(250, Math.max(0, num(m.d))), by, { weapon: String(m.w || "").slice(0, 12), part: m.p === "head" ? "head" : m.p === "arm" || m.p === "leg" ? m.p : "body" });
      else if (host && target.kind === "remote") room.to(v, Object.assign({}, m, { by }));
      break;
    }
    case "die": if (host) { const v = m.v | 0; if (v === from) game.scoreKill(v, m.by == null ? null : m.by | 0, { weapon: String(m.w || "").slice(0, 12), part: m.p === "head" ? "head" : "body" }); } break;
    case "kill": if (!host) game.killNews(m); break;
    case "end": if (!host) { if (m.sc) S.match.score = m.sc; game.endMatch(m.w); } break;
  }
}
function foreignShot(by, m) {
  const a = game.actorById(by);
  if (!a || !Array.isArray(m.o) || !Array.isArray(m.e)) return;
  const o = m.o.slice(0, 3).map((v) => num(v));
  emit("fired", a, { gun: GUNS[m.w] ? m.w : "kestrel", dirs: [], remote: true });
  for (const e of m.e.slice(0, 12)) {
    if (!Array.isArray(e)) continue;
    const h = { x: num(e[0]), y: num(e[1]), z: num(e[2]), actor: null, world: true };
    emit("tracer", a, o, h, m.w);
  }
  if (Array.isArray(m.p) && GUNS[m.w] && GUNS[m.w].projectile) game.addForeignProjectile(by, m.w, o, m.p.slice(0, 3).map((v) => num(v)));
}

/* Your shots, hits and deaths go out as they happen. A shot's tracers are
   emitted straight after it is fired, so their ends are gathered and the
   shot is sent once the tick is done. */
let shots = [], curShot = null, flushing = false;
on("fired", (a, e) => {
  if (!inMatch() || e.remote || !game.owns(a)) return;
  curShot = { t: "sh", by: a.id, w: e.gun, o: game.eyeOf(a).map(r3), e: [], p: e.proj && e.dirs[0] ? e.dirs[0].map((v) => r3(v * GUNS[e.gun].projectile.speed)) : null };
  shots.push(curShot);
  if (!flushing) { flushing = true; setTimeout(flushShots, 0); }
});
on("tracer", (a, o, h) => { if (curShot && curShot.by === a.id && curShot.e.length < 12) curShot.e.push([r3(h.x), r3(h.y), r3(h.z)]); });
function flushShots() {
  flushing = false;
  const list = shots; shots = []; curShot = null;
  if (!room || !inMatch()) return;
  for (const m of list) { if (isHost()) room.broadcast(m); else room.send(m); }
}
on("netHit", (b, dmg, byId, info) => {
  if (!inMatch()) return;
  const m = { t: "hit", v: b.id, d: Math.round(dmg * 10) / 10, p: info.part || "body", w: info.weapon || "", by: byId };
  if (isHost()) { if (b.kind === "remote") room.to(b.id, m); }
  else room.send(m);
});
on("died", (b, byId, info) => {
  if (!inMatch() || isHost() || b !== S.me) return;
  room.send({ t: "die", v: b.id, by: byId, w: info.weapon || "", p: info.part || "" });
});
on("killScored", (news) => { if (inMatch() && isHost()) room.broadcast(Object.assign({ t: "kill" }, news)); });
on("matchEnd", (m) => {
  if (!inMatch() || !isHost()) return;
  room.broadcast({ t: "end", w: m.winner, sc: m.score });
  room.setPhase("lobby");
});
on("move", (a, ev) => { if (a === S.me && inMatch() && moveEv.length < 8) moveEv.push(ev); });
on("arms", (a, e) => { if (a === S.me && inMatch() && e.type === "swing" && moveEv.length < 8) moveEv.push("swing"); });
on("quit", () => { latest.clear(); moveEv = []; });

/** Host: a latecomer gets the match as it stands. */
function catchUp(id) {
  room.to(id, { t: "start", s: S.match.settings, bots: botList(), score: S.match.score, tl: S.match.timeLeft, late: true });
  refill();
}

/* ---------------------------------------------------------------
   Per frame
   --------------------------------------------------------------- */
export function update(dt) {
  if (!inMatch() || !room || !S.me) return;
  const host = isHost();
  stAcc += dt * 1000;
  if (stAcc >= ST_MS) {
    stAcc = 0;
    const mine = pack(S.me, moveEv.splice(0));
    if (host) latest.set(HOST, mine); else room.send({ t: "st", a: mine });
  }
  if (host) {
    psAcc += dt * 1000;
    if (psAcc >= ST_MS) {
      psAcc = 0;
      // everyone's newest state since the last batch, and every bot's
      const a = [...latest.values()];
      latest.clear();
      for (const b of S.actors) if (b.kind === "bot") a.push(pack(b));
      if (a.length) room.broadcast({ t: "ps", a, tl: Math.round(S.match.timeLeft * 10) / 10 });
    }
  }
  puppets(dt);
}

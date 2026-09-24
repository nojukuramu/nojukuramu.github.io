/* net.js — one match, kept in step across a room.
 *
 * Who decides what, which is the whole design:
 *
 *   - Your own mage is yours. Your machine moves it, casts its spells and
 *     decides whether something hurt it — an enemy's bolt, another mage's
 *     spell. Everyone else's screen shows it where you said it was. Being hit
 *     by what *you* saw coming is the only rule that feels fair on a phone
 *     with a hundred milliseconds of lag.
 *   - Everything else is the host's. The host runs the enemies' brains and
 *     every blow they land on an area, keeps the score, calls the rounds and
 *     moves the room between floors. Clients draw the enemies as puppets of
 *     the host's 10 Hz snapshot, and hear and see every warning the host's
 *     enemies make because the host copies them (fx.js / state.js taps).
 *   - Spells are flown everywhere. A cast travels as "slot, where, which way,
 *     and a seed", every end flies the same page from the same numbers, and
 *     the page itself travels once, when it changes (normalised on the way in
 *     like anything read from storage).
 *
 * Everything goes through the host, which is also a player: a client talks
 * only to the host, and the host passes on what the others need. The room
 * itself (who is in it, its settings, its phase) is lobby.js's; this file is
 * only the match.
 *
 * Messages, all small JSON on one ordered channel:
 *   st/ps     a mage's position, aim and state (15 Hz; the host batches)
 *   cast trig book     spells, the trigger, a mage's pages and boons
 *   ev        the host's enemy events: spawns, deaths, bolts, warnings
 *   en        the host's enemy snapshot (10 Hz)
 *   hurt      an enemy's blow on a client's mage, from the host
 *   die kill  a mage fell (the victim says who did it; the host scores it)
 *   rstart round asc floor end revive   the host running the match */

import { S, on, emit, setEmitTap, players } from "./state.js";
import * as fx from "./fx.js";
import * as game from "./game.js";
import * as enemies from "./enemies.js";
import { enemyShot, fireLayer, triggerPayloads } from "./spells.js";
import { createPlayer, animateRemote, tintRobe } from "./player.js";
import { save, SLOTS } from "./save.js";
import { normalizeDesign, MAX_RANK } from "./spellcore.js";
import { BOON_BY_ID } from "./boons.js";
import { MODES, TEAMS, ROBES, newScore, recordKill, roundCheck, leader, RESPAWN_S, ROUND_BREAK_S, hostile } from "./modes.js";
import { worldToScreen } from "./gfx.js";
import * as fog from "./fog.js";
import { mulberry32, dist, damp, escHtml } from "./util.js";

const $ = (id) => document.getElementById(id);
const HOST = 1;
const ST_MS = 66, SNAP_MS = 100, EV_MS = 33;
const FX_OK = new Set(["burst", "bolt", "ring", "decal", "flash", "number"]);
const EMIT_OK = new Set(["slam", "impact", "lances", "enemyFire", "bossFire", "lunge", "shield", "shieldBreak", "freeze", "charge", "blink", "bossSummon", "anchorSpawn"]);
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d || 0);

let room = null;
let outbox = [];
let stAcc = 0, snapAcc = 0, evAcc = 0, psAcc = 0;
let lastObj = "";
const books = new Map();          // host: id -> last book message, for latecomers
const latest = new Map();         // host: id -> last state line
let respawnT = 0, reviveT = 0, reviveWho = null, ascT = -1, ascLast = -1, wipeT = 0, ascending = false;
let roundAlive = new Set(), roundPresent = new Set(), roundBreak = false;
let bookTimer = 0;

export const isHost = () => S.net.role === "host";
export const inMatch = () => !!S.match;
export function currentRoom() { return room; }

/* ---------------------------------------------------------------
   Room attachment
   --------------------------------------------------------------- */
/** Called once a room is open (hosted or joined). */
export function attach(r) {
  detach();
  room = r;
  S.net.role = "solo";
  S.net.me = r.me;
  r.on("msg", onMsg);
  r.on("roster", () => { if (S.match) syncRemotes(); });
  r.on("join", (id) => { if (S.match && !S.match.over && isHost()) catchUp(id); });
  r.on("leave", (id) => { if (S.match && isHost()) leftMatch(id); });
  r.on("open", () => { S.net.me = r.me; });
}
export function detach() {
  if (S.match) teardown();
  room = null;
  S.net.role = "solo"; S.net.me = 0;
}

/* ---------------------------------------------------------------
   Starting and ending
   --------------------------------------------------------------- */
/** Host: the Start button. */
export function hostStart() {
  if (!room || room.role !== "host") return;
  const s = room.settings;
  const M = MODES[s.mode];
  const ids = room.present();
  const msg = { t: "start", mode: s.mode, s, seed: (Math.random() * 1e9) | 0, score: M.pvp ? newScore(ids, s.target) : null };
  room.setPhase("playing");
  room.broadcast(msg);
  begin(msg, false);
  if (M.id === "coop") newFloor(s.floor);
  else if (M.id === "wipeout") startRound(1);
}

/** Everyone: a match begins (or, for a latecomer, is already going). */
function begin(msg, late) {
  if (S.match) teardown();
  const s = msg.s;
  const M = MODES[msg.mode] || MODES.coop;
  S.net.role = room.role === "host" ? "host" : "client";
  S.net.me = room.me;
  const self = room.self() || { team: 0, name: save.data.name };
  S.match = {
    mode: M.id, settings: s, score: msg.score || null, round: msg.score ? msg.score.round : 1, over: false,
    hpScale: 1, startedAt: performance.now(), late: !!late
  };
  if (M.id === "coop") game.startCoop({ floor: s.floor, name: self.name });
  else game.startPvp({ name: self.name, team: self.team });
  const P = S.player;
  P.team = self.team;
  tintRobe(P.mesh, robeFor(P.id, P.team));
  if (M.pvp) {
    const sp = game.spawnPoint(P.team);
    P.x = sp.x; P.z = sp.z;
    if (late && M.id === "wipeout") down(P, "Waiting for the next round");
  }
  syncRemotes();
  if (isHost()) {
    fx.setTap((name, args) => outbox.push({ e: "fx", f: name, a: args }));
    setEmitTap((ev) => { if (EMIT_OK.has(ev) && fx.isTapping()) outbox.push({ e: "em", n: ev }); });
    roundPresent = new Set(room.present());
    roundAlive = new Set(roundPresent);
  }
  sendBook();
  fog.start(!!s.fog);
  document.body.classList.add("online");
  emit("matchStart", M.id);
  updateObjective();
}
function down(P, why) {
  P.alive = false; P.hp = 0; P.deadT = 10; P.waiting = why;
}

function teardown() {
  for (const Q of S.remotes) { Q.dispose(); if (Q.tag) Q.tag.remove(); }
  S.remotes = [];
  S.match = null;
  S.view = null;
  fx.setTap(null);
  setEmitTap(null);
  outbox = [];
  books.clear(); latest.clear();
  ascT = -1; ascending = false; wipeT = 0; respawnT = 0; reviveT = 0; roundBreak = false;
  fog.stop();
  setLine("");
  document.body.classList.remove("online");
  S.net.role = "solo";
}

/** Leave the match for the room's lobby (or the title, if the room is gone). */
export function leaveMatch() {
  if (S.match) teardown();
  if (S.mode !== "title") game.quitToTitle();
}

/* ---------------------------------------------------------------
   Remote mages
   --------------------------------------------------------------- */
function robeFor(id, team) {
  const M = S.match && MODES[S.match.mode];
  if (M && M.teams) return TEAMS[team === 1 ? 1 : 0].hex;
  return ROBES[(Math.max(1, id) - 1) % ROBES.length];
}
function syncRemotes() {
  if (!room || !S.match) return;
  const want = room.roster.filter((p) => p.id !== room.me);
  for (let i = S.remotes.length - 1; i >= 0; i--) {
    const Q = S.remotes[i];
    const p = want.find((w) => w.id === Q.id);
    if (!p) { Q.dispose(); if (Q.tag) Q.tag.remove(); S.remotes.splice(i, 1); continue; }
    Q.name = p.name; Q.away = p.away;
    if (Q.team !== p.team) { Q.team = p.team; tintRobe(Q.mesh, robeFor(Q.id, Q.team)); }
  }
  for (const p of want) {
    if (S.remotes.some((Q) => Q.id === p.id)) continue;
    const Q = createPlayer({ rank: MAX_RANK, level: 1 }, { remote: true, id: p.id, team: p.team, name: p.name, robe: robeFor(p.id, p.team) });
    Q.tx = Q.x = S.player ? S.player.x : 0; Q.tz = Q.z = S.player ? S.player.z : 0;
    Q.heard = false;
    Q.mesh.root.visible = false;        // until the first word of where it is
    Q.hurt = (d, a, src, k) => remoteHurt(Q, d, a, src, k);
    Q.tag = makeTag(Q);
    S.remotes.push(Q);
    if (books.has(p.id)) applyBook(Q, books.get(p.id));
  }
  // your own team may have moved (the room balanced it)
  const me = room.self();
  if (me && S.player && S.player.team !== me.team) { S.player.team = me.team; tintRobe(S.player.mesh, robeFor(S.player.id, me.team)); }
}
const remote = (id) => S.remotes.find((Q) => Q.id === id) || null;

/* An enemy's blow on somebody else's mage, as the host saw it. Their machine
   has the final say (their dash, their i-frames); this only guesses, so a
   Knot does not bite the same mage twice in one lunge. */
function remoteHurt(Q, d, a, src, k) {
  if (!isHost() || !Q.alive || Q.iframe > 0 || Q.dashing) return false;
  room.to(Q.id, { t: "hurt", d: Math.round(d * 10) / 10, a: Math.round(a * 100) / 100, s: String(src || "").slice(0, 40), k: k === undefined ? 6 : k });
  Q.iframe = 0.6;
  return true;
}

/* ---------------------------------------------------------------
   Messages
   --------------------------------------------------------------- */
function send(m) {
  if (!room) return;
  if (isHost()) onMsg(HOST, m, true);
  else room.send(m);
}
/** The host passes a player's own news to everyone else. */
function relay(from, m) { if (isHost()) { m.i = from; room.broadcast(m, from); } }

function onMsg(from, m, local) {
  if (!m || typeof m !== "object") return;
  const host = isHost();
  if (m.t === "start") {
    if (host) return;
    // A client that dropped and came back mid-match keeps its mage; the
    // host's catch-up that follows puts the floor right again.
    if (m.late && S.match && !S.match.over && S.match.mode === m.mode) return;
    begin(m, !!m.late);
    return;
  }
  if (!S.match) { if (m.t === "book") books.set(host ? from : m.i | 0, Object.assign({}, m, { i: host ? from : m.i | 0 })); return; }
  switch (m.t) {
    // a mage's own news: applied here, and passed on by the host
    case "st": if (host) { latest.set(from, packState(from, m)); if (!local) applyState(remote(from), m); } break;
    case "ps": if (!host && Array.isArray(m.a)) for (const a of m.a) { if (Array.isArray(a) && a[0] !== S.net.me) applyState(remote(a[0]), unpackState(a)); } break;
    case "cast": fromMage(from, m, local, (Q) => remoteCast(Q, m)); break;
    case "trig": fromMage(from, m, local, (Q) => triggerPayloads(Q)); break;
    case "book": {
      const who = host ? from : m.i | 0;
      books.set(who, Object.assign({}, m, { i: who }));
      fromMage(from, m, local, (Q) => applyBook(Q, m));
      break;
    }
    // a mage's news for the host alone
    case "die": if (host) mageFell(from, m.by === null || m.by === undefined ? null : m.by | 0, String(m.s || "").slice(0, 40)); break;
    case "rev": if (host) { const id = m.v | 0; if (id === HOST) revived(from); else room.to(id, { t: "revived", by: from }); } break;
    // the host running the match
    case "hurt": if (!host && S.player) S.player.hurt(num(m.d), num(m.a), String(m.s || "the dark"), num(m.k, 6)); break;
    case "revived": revived(m.by); break;
    case "ev": if (!host && Array.isArray(m.a)) for (const e of m.a) applyEvent(e); break;
    case "en": if (!host && Array.isArray(m.a)) applySnap(m.a); break;
    case "kill": if (!host) onKillNews(m); break;
    case "rstart": if (!host) roundStarts(m); break;
    case "round": if (!host) roundEnds(m); break;
    case "asc": if (!host) { game.coopAscendFade(); setLine(""); } break;
    case "ascT": if (!host) setLine(m.s > 0 ? "Going up in " + (m.s | 0) : ""); break;
    case "floor": if (!host) { game.coopFloor(m.f | 0, m.seed | 0); flushLateBooks(); } break;
    case "end": if (!host) matchOver(m); break;
  }
}
/** Something a mage did: everyone but that mage acts on it, and the host
    passes it to everyone who did not send it. */
function fromMage(from, m, local, apply) {
  const who = isHost() ? from : m.i | 0;
  if (who !== S.net.me) { const Q = remote(who); if (Q) apply(Q); }
  if (isHost()) room.broadcast(Object.assign({}, m, { i: who }), local ? undefined : from);
}
function flushLateBooks() { for (const Q of S.remotes) if (!Q.designs && books.has(Q.id)) applyBook(Q, books.get(Q.id)); }

/* ---------------------------------------------------------------
   Mages' state
   --------------------------------------------------------------- */
function localState() {
  const P = S.player;
  const f = (P.alive ? 1 : 0) | (P.dashing ? 2 : 0) | (P.iframe > 0 ? 4 : 0) | (P.hurtT > 0 ? 8 : 0);
  const r = (v) => Math.round(v * 100) / 100;
  return { t: "st", x: r(P.x), z: r(P.z), vx: r(P.vx), vz: r(P.vz), a: r(P.aim), f, hp: Math.ceil(P.hp), mh: Math.round(P.maxHp), s: P.selected };
}
function packState(id, m) { return [id, num(m.x), num(m.z), num(m.vx), num(m.vz), num(m.a), m.f | 0, num(m.hp), num(m.mh, 100), m.s | 0]; }
function unpackState(a) { return { x: a[1], z: a[2], vx: a[3], vz: a[4], a: a[5], f: a[6], hp: a[7], mh: a[8], s: a[9] }; }
function applyState(Q, m) {
  if (!Q) return;
  Q.tx = num(m.x, Q.tx); Q.tz = num(m.z, Q.tz);
  Q.vx = num(m.vx); Q.vz = num(m.vz); Q.aim = num(m.a, Q.aim);
  const f = m.f | 0, alive = !!(f & 1);
  Q.dashing = !!(f & 2);
  if (f & 4) Q.iframe = Math.max(Q.iframe, 0.1);
  if (f & 8 && Q.hurtT <= 0) Q.hurtT = 0.25;
  Q.maxHp = Math.max(1, num(m.mh, 100)); Q.hp = Math.max(0, num(m.hp));
  if (!Q.heard) { Q.heard = true; Q.x = Q.tx; Q.z = Q.tz; Q.mesh.root.visible = true; }
  if (alive && !Q.alive) Q.respawn(Q.tx, Q.tz, Q.hp / Q.maxHp);
  else if (!alive && Q.alive) { Q.alive = false; Q.deadT = 0; }
  const sel = (m.s | 0) % SLOTS;
  if (sel !== Q.selected) { Q.selected = sel; Q.circleKey = ""; }
  Q.lastHeard = performance.now();
}

function remoteCast(Q, m) {
  if (!Q || !Q.alive) return;
  const slot = (m.s | 0) % SLOTS;
  const c = Q.compiled[slot];
  // A page the room's rank does not allow does not fly here, whatever the
  // caster's own machine thinks of it.
  if (!c || Q.empty[slot] || Q.blocked[slot]) return;
  fireLayer(c, 0, num(m.x, Q.x), num(m.z, Q.z), num(m.a, Q.aim), true, Q, mulberry32(m.r | 0));
  Q.castT = 0.22; Q.circleT = 0.7;
  if (Q.selected !== slot) { Q.selected = slot; Q.circleKey = ""; }
}

function sendBook() {
  const P = S.player;
  if (!P) return;
  const d = [];
  for (let i = 0; i < SLOTS; i++) d.push(save.spell(i));
  send({ t: "book", d, b: P.boons, r: P.rank });
}
function applyBook(Q, m) {
  if (!Q || !Array.isArray(m.d)) return;
  Q.designs = m.d.slice(0, SLOTS).map((x) => normalizeDesign(x));
  const boons = {};
  if (m.b && typeof m.b === "object") for (const id in m.b) if (BOON_BY_ID[id]) boons[id] = Math.max(0, Math.min(BOON_BY_ID[id].max, m.b[id] | 0));
  Q.boons = boons;
  let rank = Math.max(1, Math.min(MAX_RANK, m.r | 0 || 1));
  if (S.match && MODES[S.match.mode].pvp) rank = Math.min(rank, S.match.settings.rank);
  Q.rank = rank;
  Q.recompute();
}

/* ---------------------------------------------------------------
   Enemies: the host's events and snapshots, a client's puppets
   --------------------------------------------------------------- */
on("netSpawn", (e, pop) => {
  if (!isHost() || !S.match) return;
  outbox.push({ e: "sp", n: e.nid, k: e.type, x: r2(e.x), z: r2(e.z), el: e.elite || 0, mh: Math.round(e.maxHp), hp: Math.round(e.hp), o: e.owner ? e.owner.nid : 0, p: pop ? 1 : 0, st: e.state === "sleep" ? 1 : 0 });
});
on("netRemove", (e) => { if (isHost() && S.match) outbox.push({ e: "rm", n: e.nid }); });
on("netEshot", (args) => {
  if (!isHost() || !S.match) return;
  const o = args[5] || {};
  outbox.push({ e: "es", a: [r2(args[0]), r2(args[1]), r2(args[2]), args[3], Math.round(args[4] * 10) / 10, { y: o.y, r: o.r, life: o.life, src: o.src }] });
});
on("kill", (e) => { if (isHost() && S.match && e.nid) outbox.push({ e: "kl", n: e.nid }); });
on("bossIntro", (b) => { if (isHost() && S.match && b && b.nid) outbox.push({ e: "bi", n: b.nid }); });
on("bossPhase", (b, ph) => { if (isHost() && S.match && b && b.nid) outbox.push({ e: "bp", n: b.nid, p: ph }); });
on("portalOpen", (final) => { if (isHost() && S.match) outbox.push({ e: "portal", f: final ? 1 : 0 }); });
const r2 = (v) => Math.round(v * 100) / 100;

function applyEvent(ev) {
  if (!ev || typeof ev !== "object") return;
  switch (ev.e) {
    case "sp": {
      if (enemies.byNid(ev.n)) return;
      if (!enemies.TYPES[ev.k]) return;
      const owner = ev.o ? enemies.byNid(ev.o) : null;
      const e = enemies.spawnEnemy(ev.k, num(ev.x), num(ev.z), { nid: ev.n, elite: typeof ev.el === "string" ? ev.el : false, pop: !!ev.p, owner });
      e.maxHp = num(ev.mh, e.maxHp); e.hp = num(ev.hp, e.hp);
      if (ev.st) e.state = "sleep";
      break;
    }
    case "kl": { const e = enemies.byNid(ev.n); if (e) enemies.kill(e); break; }
    case "rm": { const e = enemies.byNid(ev.n); if (e) enemies.kill(e, true); break; }
    case "es": if (Array.isArray(ev.a)) enemyShot(num(ev.a[0]), num(ev.a[1]), num(ev.a[2]), num(ev.a[3], 7), num(ev.a[4], 5), ev.a[5] || {}); break;
    case "fx": if (FX_OK.has(ev.f) && Array.isArray(ev.a)) { try { fx[ev.f].apply(null, ev.a); } catch (err) { /* a malformed effect is only an effect */ } } break;
    case "em": if (EMIT_OK.has(ev.n)) emit(ev.n); break;
    case "boss": { S.boss = ev.n ? enemies.byNid(ev.n) : null; break; }
    case "bi": { const e = enemies.byNid(ev.n); if (e) { S.boss = e; emit("bossIntro", e); } break; }
    case "bp": { const e = enemies.byNid(ev.n); if (e) emit("bossPhase", e, ev.p | 0); break; }
    case "obj": if (S.objective && ev.o) { S.objective.done = ev.o.done | 0; S.objective.total = ev.o.total | 0; S.objective.text = game.objectiveText(); } break;
    case "portal": game.openPortalNet(!!ev.f); break;
  }
}
function applySnap(list) {
  const seen = new Set();
  for (const a of list) {
    if (!Array.isArray(a)) continue;
    const e = enemies.byNid(a[0]);
    if (e) { enemies.applySnapshot(e, a); seen.add(e); }
  }
  // Something the host no longer has: after three snapshots, believe it.
  for (const e of S.enemies) if (e.alive && !seen.has(e) && ++e.seen > 3) enemies.kill(e, true);
}

/* ---------------------------------------------------------------
   Falling, scoring, rounds
   --------------------------------------------------------------- */
on("playerDied", (src, by) => {
  if (!S.match || !room) return;
  send({ t: "die", by: by === undefined ? null : by, s: src });
  if (MODES[S.match.mode].respawn) respawnT = RESPAWN_S;
});

const nameOf = (id) => { const p = room && room.player(id); return p ? p.name : id === S.net.me && S.player ? S.player.name : "A mage"; };
const teamOf = (id) => { const p = room && room.player(id); return p ? p.team : 0; };

/** Host: somebody fell. */
function mageFell(victim, killer, src) {
  const M = MODES[S.match.mode];
  if (!M.pvp) { room.broadcast({ t: "kill", v: victim, k: null, s: src }); onKillNews({ v: victim, k: null, s: src }); return; }
  const sc = S.match.score;
  if (!sc || sc.over) return;
  const res = recordKill(sc, S.match.mode, teamOf, victim, killer);
  const news = { t: "kill", v: victim, k: killer, s: src, sc };
  room.broadcast(news); onKillNews(news);
  if (M.id === "wipeout" && !roundBreak) {
    roundAlive.delete(victim);
    checkRound();
  } else if (res.over) finishMatch(res.winner);
}
function onKillNews(m) {
  if (m.sc && S.match) S.match.score = m.sc;
  const v = m.v | 0, k = m.k === null || m.k === undefined ? null : m.k | 0;
  const vn = nameOf(v), kn = k !== null ? nameOf(k) : null;
  emit("toast", kn && k !== v ? kn + " undid " + vn : vn + " fell", "skull");
  if (k === S.net.me && v !== S.net.me) S.kills++;
  updateObjective();
}
function checkRound() {
  const present = [...roundPresent].filter((id) => room.player(id)).map((id) => ({ id, team: teamOf(id) }));
  const alive = [...roundAlive].filter((id) => room.player(id)).map((id) => ({ id, team: teamOf(id) }));
  const res = roundCheck(S.match.score, present, alive);
  if (!res) return;
  roundBreak = true;
  const m = { t: "round", w: res.round, sc: S.match.score };
  room.broadcast(m); roundEnds(m);
  setTimeout(() => {
    if (!S.match || !isHost()) return;
    if (res.over) finishMatch(res.winner);
    else startRound(S.match.score.round);
  }, ROUND_BREAK_S * 1000);
}
function startRound(n) {
  roundBreak = false;
  roundPresent = new Set(room.present());
  roundAlive = new Set(roundPresent);
  const m = { t: "rstart", n, sc: S.match.score };
  room.broadcast(m); roundStarts(m);
}
function roundStarts(m) {
  if (m.sc) S.match.score = m.sc;
  S.match.round = m.n | 0;
  const P = S.player;
  const sp = game.spawnPoint(P.team);
  P.respawn(sp.x, sp.z, 1);
  P.potions = 2; P.waiting = null;
  S.view = null;
  emit("banner", "Round " + S.match.round, "Last team standing takes it");
  updateObjective();
}
function roundEnds(m) {
  if (m.sc) S.match.score = m.sc;
  const w = m.w | 0;
  emit("banner", w < 0 ? "Nobody stands" : TEAMS[w].name + " take the round", S.match.score.r[0] + " — " + S.match.score.r[1], w === (S.player ? S.player.team : -2) ? "gold" : "");
  updateObjective();
}
function finishMatch(winner) {
  if (!S.match || S.match.over) return;
  const m = { t: "end", w: winner, sc: S.match.score, mode: S.match.mode };
  room.broadcast(m);
  room.setPhase("lobby");
  matchOver(m);
}
function matchOver(m) {
  if (!S.match || S.match.over) return;
  S.match.over = true;
  if (m.sc) S.match.score = m.sc;
  S.match.winner = m.w;
  setLine("");
  emit("matchEnd", m.w, S.match);
}
/** Host: a mage left the room mid-match. */
function leftMatch(id) {
  if (!S.match) return;
  roundPresent.delete(id); roundAlive.delete(id);
  if (S.match.mode === "wipeout" && !roundBreak) checkRound();
}

/** Host: a latecomer gets the match as it stands. */
function catchUp(id) {
  const s = room.settings;
  room.to(id, { t: "start", mode: s.mode, s, seed: 0, score: S.match.score, late: true });
  for (const b of books.values()) if (b.i !== id) room.to(id, b);
  if (S.match.mode === "coop" && S.world) {
    room.to(id, { t: "floor", f: S.floor, seed: S.seed });
    const a = [];
    for (const e of S.enemies) if (e.alive) a.push({ e: "sp", n: e.nid, k: e.type, x: r2(e.x), z: r2(e.z), el: e.elite || 0, mh: Math.round(e.maxHp), hp: Math.round(e.hp), o: e.owner ? e.owner.nid : 0, p: 0, st: e.state === "sleep" ? 1 : 0 });
    a.push({ e: "boss", n: S.boss ? S.boss.nid : 0 });
    if (S.objective) a.push({ e: "obj", o: { done: S.objective.done, total: S.objective.total } });
    if (S.portal && S.portal.on) a.push({ e: "portal", f: S.portal.final ? 1 : 0 });
    room.to(id, { t: "ev", a });
  }
}

/* ---------------------------------------------------------------
   Co-op: floors, the portal, falling together
   --------------------------------------------------------------- */
function newFloor(f) {
  const seed = (Math.random() * 1e9) | 0;
  flushEvents();
  // Enemies get tougher with every mage in the room, not linearly: four mages
  // are not four times the danger to one Golem.
  S.match.hpScale = 1 + 0.6 * (room.present().length - 1);
  room.broadcast({ t: "floor", f, seed });
  game.coopFloor(f, seed);
  outbox.push({ e: "boss", n: S.boss ? S.boss.nid : 0 });
  lastObj = "";
  ascending = false;
}
function coopHost(dt) {
  const p = S.portal;
  const all = players().filter((Q) => !Q.away);
  // the portal: everyone in it, or a countdown once anyone is
  if (p && p.on && !ascending && !S.match.over) {
    const standing = all.filter((Q) => Q.alive);
    const inside = standing.filter((Q) => dist(Q.x, Q.z, p.x, p.z) < 2.2);
    if (inside.length && inside.length === standing.length) ascT = 0;
    else if (inside.length && ascT < 0) ascT = 6;
    else if (!inside.length) ascT = -1;
    if (ascT >= 0) {
      ascT -= dt;
      const s = Math.max(0, Math.ceil(ascT));
      if (s !== ascLast) { ascLast = s; room.broadcast({ t: "ascT", s }); setLine(s > 0 ? "Going up in " + s : ""); }
      if (ascT <= 0) {
        ascT = -1; ascLast = -1;
        if (p.final) { finishMatch("climb"); return; }
        ascending = true;
        room.broadcast({ t: "asc" });
        game.coopAscendFade();
        setTimeout(() => { if (S.match && isHost()) newFloor(S.floor + 1); }, 600);
      }
    }
  } else if (ascT >= 0 && !(p && p.on)) ascT = -1;
  // nobody left standing
  if (all.length && all.every((Q) => !Q.alive)) { wipeT += dt; if (wipeT > 2) finishMatch("wipe"); }
  else wipeT = 0;
  // the objective, whenever it moves
  const o = S.objective ? S.objective.done + "/" + S.objective.total : "";
  if (o !== lastObj) { lastObj = o; outbox.push({ e: "obj", o: { done: S.objective.done, total: S.objective.total } }); }
}
function revived(by) {
  const P = S.player;
  if (!P || P.alive || !S.match || S.match.mode !== "coop") return;
  P.respawn(null, null, 0.4);
  S.view = null;
  emit("toast", nameOf(by | 0) + " stood you up", "hand");
}

/* ---------------------------------------------------------------
   Per frame
   --------------------------------------------------------------- */
export function update(dt) {
  if (!S.match || !S.player || !room) { return; }
  const P = S.player;
  const M = MODES[S.match.mode];
  const host = isHost();

  stAcc += dt * 1000;
  if (stAcc >= ST_MS) {
    stAcc = 0;
    const st = localState();
    if (host) latest.set(HOST, packState(HOST, st)); else room.send(st);
  }
  if (host) {
    psAcc += dt * 1000;
    if (psAcc >= ST_MS) { psAcc = 0; if (latest.size) room.broadcast({ t: "ps", a: [...latest.values()] }); }
    evAcc += dt * 1000;
    if (evAcc >= EV_MS) { evAcc = 0; flushEvents(); }
    snapAcc += dt * 1000;
    if (snapAcc >= SNAP_MS && S.enemies.length) {
      snapAcc = 0;
      flushEvents();
      const a = [];
      for (const e of S.enemies) if (e.alive) a.push(enemies.snapshotOf(e));
      room.broadcast({ t: "en", a });
    }
    if (M.id === "coop") coopHost(dt);
  }

  // puppets
  for (const Q of S.remotes) {
    if (Q.heard) {
      const lead = 0.08;
      Q.x = damp(Q.x, Q.tx + Q.vx * lead, 14, dt); Q.z = damp(Q.z, Q.tz + Q.vz * lead, 14, dt);
      if (dist(Q.x, Q.z, Q.tx, Q.tz) > 6) { Q.x = Q.tx; Q.z = Q.tz; }
    }
    animateRemote(Q, dt);
    if (Q.mesh.root.visible !== (Q.heard && !Q.fogHidden)) Q.mesh.root.visible = Q.heard && !Q.fogHidden;
  }

  // falling and getting up
  if (!P.alive) {
    if (M.respawn && !S.match.over) {
      respawnT -= dt;
      setLine(respawnT > 0 ? "Back in " + Math.ceil(respawnT) : "");
      if (respawnT <= 0) { const sp = game.spawnPoint(P.team); P.respawn(sp.x, sp.z, 1); P.potions = 2; }
    } else {
      const v = spectate();
      if (!S.match.over) setLine(P.waiting ? P.waiting + (v ? " · watching " + v.name : "") : v ? "Watching " + v.name : "");
    }
  } else {
    S.view = null;
    if (/^(Back in|Watching|Waiting)/.test(lineNow)) setLine("");
    if (M.id === "coop") reviveNear(dt);
  }
  fog.update(dt);
  tags();
}
function flushEvents() {
  if (!outbox.length || !room) return;
  room.broadcast({ t: "ev", a: outbox });
  outbox = [];
}

/* Whom the camera watches while you are down: a teammate if you have one,
   anyone standing if not. */
function spectate() {
  const M = MODES[S.match.mode];
  const ok = (Q) => Q.alive && Q.heard && (!M.teams || Q.team === S.player.team);
  if (!S.view || !ok(S.view) || !S.remotes.includes(S.view)) S.view = S.remotes.find(ok) || null;
  return S.view;
}

/* Co-op: stand by a fallen friend for a moment and they are back. */
const REVIVE_S = 2.5;
function reviveNear(dt) {
  const P = S.player;
  let who = null;
  for (const Q of S.remotes) if (!Q.alive && Q.heard && dist(P.x, P.z, Q.x, Q.z) < 1.8) { who = Q; break; }
  if (who !== reviveWho) { reviveWho = who; reviveT = 0; }
  if (!who) { setLineIf("Standing"); return; }
  reviveT += dt;
  setLine("Standing " + who.name + " up · " + Math.min(100, Math.round(reviveT / REVIVE_S * 100)) + "%");
  if (reviveT >= REVIVE_S) { send({ t: "rev", v: who.id }); reviveT = -3; }
}

/* ---------------------------------------------------------------
   Words on screen: one line, name tags, the score
   --------------------------------------------------------------- */
let lineNow = "";
function setLine(t) {
  if (t === lineNow) return;
  lineNow = t;
  const el = $("netLine");
  if (el) { el.textContent = t; el.hidden = !t; }
}
function setLineIf(prefix) { if (lineNow.startsWith(prefix)) setLine(""); }

function makeTag(Q) {
  const d = document.createElement("div");
  d.className = "ntag";
  d.innerHTML = "<b></b><i><s></s></i>";
  const layer = $("tags");
  if (layer) layer.appendChild(d);
  return d;
}
const scr = {};
function tags() {
  const M = MODES[S.match.mode];
  for (const Q of S.remotes) {
    const d = Q.tag;
    if (!d) continue;
    if (!Q.heard || Q.fogHidden || Q.away) { d.style.display = "none"; continue; }
    worldToScreen(Q.x, 2.55, Q.z, scr);
    if (scr.behind) { d.style.display = "none"; continue; }
    const foe = hostile(S.match.mode, S.player, Q);
    const cls = "ntag" + (foe ? " foe" : " ally") + (Q.alive ? "" : " down") + (M.teams ? " t" + Q.team : "");
    if (d.className !== cls) d.className = cls;
    const label = Q.alive ? Q.name : Q.name + (M.id === "coop" ? " — stand by to raise" : "");
    const b = d.firstChild;
    if (b.textContent !== label) b.textContent = label;
    d.lastChild.firstChild.style.width = Math.round(Math.max(0, Math.min(1, Q.hp / Q.maxHp)) * 100) + "%";
    d.style.display = "block";
    d.style.transform = "translate(" + scr.x.toFixed(0) + "px," + scr.y.toFixed(0) + "px) translate(-50%,-100%)";
  }
}

/** The one line under the floor name: the score as it stands. */
export function scoreLine() {
  const m = S.match;
  if (!m || !m.score) return "";
  const sc = m.score, M = MODES[m.mode];
  if (m.mode === "wipeout") return TEAMS[0].name + " " + sc.r[0] + " — " + sc.r[1] + " " + TEAMS[1].name + " · first to " + sc.target;
  if (M.teams) return TEAMS[0].name + " " + sc.tk[0] + " — " + sc.tk[1] + " " + TEAMS[1].name + " · to " + sc.target;
  const me = sc.k[S.net.me] || 0;
  const lead = leader(sc, m.mode);
  const top = lead !== null ? sc.k[lead] : 0;
  return "You " + me + " · best " + top + " · to " + sc.target;
}
function updateObjective() {
  if (!S.match || !S.objective) return;
  if (S.match.mode !== "coop") S.objective.text = scoreLine();
}

/** A scoreboard, for the pause sheet and the results. Trusted markup; every
    name in it is escaped. */
export function scoreboardHtml() {
  const m = S.match;
  if (!m || !room) return "";
  const M = MODES[m.mode];
  const sc = m.score;
  const rows = room.roster.map((p) => {
    const k = sc ? sc.k[p.id] || 0 : 0, d = sc ? sc.d[p.id] || 0 : 0;
    return { p, k, d };
  });
  rows.sort((a, b) => (M.teams ? a.p.team - b.p.team : 0) || b.k - a.k || a.d - b.d);
  const head = M.pvp ? "<tr><th>Mage</th><th>Kills</th><th>Falls</th></tr>" : "<tr><th>Mage</th><th></th><th></th></tr>";
  const body = rows.map(({ p, k, d }) => {
    const me = p.id === S.net.me ? " class=\"me\"" : "";
    const dot = M.teams ? '<i class="tdot t' + p.team + '"></i>' : "";
    return "<tr" + me + "><td>" + dot + escHtml(p.name) + (p.host ? ' <small class="muted">host</small>' : "") + (p.away ? ' <small class="muted">away</small>' : "") + "</td><td>" + (M.pvp ? k : "") + "</td><td>" + (M.pvp ? d : "") + "</td></tr>";
  }).join("");
  return '<table class="board">' + head + body + "</table>";
}

on("spellsChanged", () => {
  if (!S.match) return;
  clearTimeout(bookTimer);
  bookTimer = setTimeout(sendBook, 300);
});
on("castAt", (slot, x, z, aim, seed) => { if (S.match && room) send({ t: "cast", s: slot, x: r2(x), z: r2(z), a: r2(aim), r: seed }); });
on("trigger", () => { if (S.match && room) send({ t: "trig" }); });
on("title", () => { if (S.match) teardown(); });

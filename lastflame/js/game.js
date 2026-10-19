/* game.js — the rules of the night.
 *
 * Carry a draining lantern through a dark house to relight five lamps, hide
 * when the hunter comes, then escape through a house where light has become
 * the danger. That one sentence is the research's (README); this file is it
 * as rules:
 *
 *   1. You cannot fight. Walk, run, crouch, hide, turn the wick up or down.
 *   2. The lantern burns oil, faster at a run. At zero it goes out.
 *   3. Light shows the way and shows you to it. Darkness hides you, and the
 *      dark gets into you: dread, which you are never shown as a number.
 *   4. Running is loud and crouching is quiet. It goes to what it hears.
 *   5. A relit lamp gives back some oil, once. The house is new every night.
 *   6. Every lamp lit makes it hunt harder.
 *   7. A closet hides you if it did not see you get in.
 *   8. Caught is caught; the restart is short.
 *
 * The director lives here too: one stress number, one threat level, the
 * Relax timer after a peak, a d20 against the threat for which room the
 * hunter tries next, and a nudge toward your part of the house every minute
 * or so — never to where you are standing. The pacing is the research's
 * escalation table: calm, unease, pressure, dread, a breather, the peak.
 *
 * Pure: no DOM, no three.js. step() takes the frame's input and leaves
 * events behind for the renderer and the speakers, and the validator plays
 * whole nights with it in Node. */

import { generate, doorBox, roomAt, alter, POOL_R, PROPS } from "./house.js";
import { buildGrid, rebuild, move, sees, nearestFree, cx, cz } from "./nav.js";
import * as hunt from "./hunter.js";
import { rng } from "./rng.js";

export const PLAYER_R = 0.28;
export const EYE = 1.62, EYE_CROUCH = 1.05;
export const SPEED = { walk: 2.05, run: 4.3, crouch: 1.05 };
export const NOISE = { walk: 3.2, run: 9, crouch: 0.9, creakWalk: 7.5, creakCrouch: 3.2, kick: 6.5, door: 4.5, closet: 3.5, gasp: 4.5, breathe: 2.2, pant: 3.6, rattle: 5 };
export const OIL = { start: 0.62, burn: 1 / 175, runMul: 1.5, refill: 0.45, tin: 0.3, borrow: 0.14 };
const LIGHT_TIME = 1.0;     // seconds holding the flame to a wick
const REACH = 1.75;

/* How afraid the player asked to be (Settings). The research says to tune
   fear through the threat's parameters, never its damage: how far it sees,
   how fast it gets, how long it stays away. */
export const FEAR = {
  gentle: { sight: 0.8, detect: 0.7, vmax: 4.35, relax: 1.4, nudge: 1.45, label: "Gentle" },
  normal: { sight: 1, detect: 1, vmax: 4.95, relax: 1, nudge: 1, label: "Normal" },
  merciless: { sight: 1.15, detect: 1.3, vmax: 5.4, relax: 0.7, nudge: 0.75, label: "Merciless" }
};
/* The research's escalation table, as numbers. */
export const PHASES = {
  intro: { relax: 45, nudge: 0, label: "Calm" },
  unease: { relax: 45, nudge: 0, label: "Unease" },
  pressure: { relax: 38, nudge: 85, label: "Pressure" },
  dread: { relax: 30, nudge: 65, label: "Dread" },
  breather: { relax: 40, nudge: 0, label: "Breather" },
  peak: { relax: 16, nudge: 30, label: "Peak" }
};

export function newRun(o) {
  o = o || {};
  const seed = (o.seed === undefined ? (Math.random() * 2 ** 32) >>> 0 : o.seed) >>> 0;
  const L = generate(seed);
  const G = buildGrid(L);
  const r = rng(seed ^ 0x5eed);
  const g = {
    seed, L, G, r, mode: o.mode || "lola", fear: o.fear || "normal", tune: FEAR[o.fear || "normal"],
    t: 0, state: "play", phase: "intro", phaseT: 0, flipped: false, lit: 0,
    player: {
      x: L.start.x, z: L.start.z, yaw: L.start.yaw, pitch: 0, vx: 0, vz: 0, crouch: false, running: false, eye: EYE,
      lantern: true, oil: OIL.start, hiding: -1, hideT: 0, breath: 1, holding: false, gaspLock: 0,
      exert: 0, winded: false, dread: 0, stepD: 0, moving: false, speed: 0, lastCreak: -1, creakT: 0, pantT: 0, breatheT: 3
    },
    hunter: hunt.newHunter(),
    dir: { stress: 0, relaxT: 0, nudgeT: 70, rollT: 7, T: 0, wantRelax: false, advance: false },
    events: [], hints: {}, hint: null, flags: {}, inPool: false, lanternPower: 1, hunterDist: 99, litT: 0,
    act: null, actT: 0, lightning: 18 + r() * 20, kicked: {}, caughtT: 0, respawnAt: null, lastLamp: 0,
    stats: { deaths: 0, hides: 0, oilUsed: 0, tins: 0, notes: 0, lampsAt: [], escapedAt: 0, time: 0 },
    noise: null, pickRoom: null, caught: null, relax: null, passDone: null
  };
  bind(g);
  if (o.skipIntro) { g.phase = "unease"; g.flags.passDone = true; }
  hint(g, "goal", "Relight the lamps.", 9);
  return g;
}

/* The hunter calls back into the game for these. */
function bind(g) {
  g.noise = (x, z, rad, kind, fromHunter) => { if (!fromHunter) hunt.hear(g, x, z, rad, kind); g.events.push({ type: "noise", x, z, r: rad, kind }); };
  g.pickRoom = () => pickRoom(g);
  g.caught = (how) => caught(g, how);
  g.relax = () => relax(g);
  g.passDone = () => { g.flags.passDone = true; relax(g, 30); if (g.phase === "intro") setPhase(g, "unease"); hint(g, "after", "It hunts by sound and by light. [lantern] turns your wick down.", 7); };
}

const ev = (g, e) => g.events.push(e);
function hint(g, id, text, secs) {
  if (g.hints[id]) return;
  g.hints[id] = g.t;
  g.hint = { id, text, until: g.t + (secs || 6) };
  ev(g, { type: "hint", id, text });
}

function setPhase(g, p) {
  if (g.phase === p) return;
  g.phase = p; g.phaseT = 0;
  ev(g, { type: "phase", phase: p });
}

/* ---------- the director ---------- */

function relax(g, secs) {
  const d = g.dir, base = secs || PHASES[g.phase].relax;
  d.relaxT = base * g.tune.relax;
  d.wantRelax = false;
  hunt.retreat(g);
  ev(g, { type: "relax", secs: d.relaxT });
}

/* Which room the hunter walks to next. Early on it keeps its distance; as
   the lamps are lit it drifts closer; a d20 under the threat level sends it
   one room nearer the player; a nudge sends it next door. Never the spot. */
function pickRoom(g) {
  const L = g.L, d = g.dir, h = g.hunter, r = g.r;
  const pr = Math.max(0, roomAt(L, g.player.x, g.player.z));
  const hops = L.graph.hops[pr];
  if (d.advance) {
    d.advance = false;
    // early on, an advance is one room nearer than where it stands; from the
    // third lamp, it is next door to you
    const close = g.phase === "pressure" || g.phase === "dread" || g.phase === "peak";
    const hh = h.room >= 0 ? hops[h.room] : 9;
    const near = L.rooms.filter((x) => x.id !== h.room && (close ? hops[x.id] <= 1 : hops[x.id] === Math.max(1, hh - 1)));
    if (near.length) return near[Math.floor(r() * near.length)].id;
  }
  const close = g.phase === "pressure" || g.phase === "dread" || g.phase === "peak";
  let total = 0;
  const w = L.rooms.map((rm) => {
    if (hops[rm.id] === Infinity || rm.id === h.room) return 0;
    let x = close ? 1 / (1 + hops[rm.id]) + 0.15 : 0.35 + hops[rm.id] * 0.4;
    if (d.relaxT > 0) x = hops[rm.id] >= 2 ? hops[rm.id] : 0.01;
    // the end: the lit lamps are its route
    if (g.flipped && L.lamps.some((l) => l.room === rm.id)) x += 1.5;
    // not where it has just been
    const ago = g.t - (h.visited[rm.id] || -999);
    if (ago < 40) x *= 0.25;
    total += x;
    return x;
  });
  let k = r() * total;
  for (let i = 0; i < w.length; i++) { k -= w[i]; if (k <= 0 && w[i] > 0) return i; }
  return (pr + 1) % L.rooms.length;
}

function director(g, dt) {
  const d = g.dir, h = g.hunter, P = PHASES[g.phase];
  // the threat level: lamps lit, and a little for every minute taken
  d.T = Math.min(20, g.flipped ? 20 : 2 + g.lit * 3 + Math.floor((g.t / 60) * 0.7));
  // stress: near, seen, chased; it fades when nothing is happening
  if (h.active) {
    const near = Math.max(0, 1 - g.hunterDist / 10);
    const rise = 0.3 * near + (h.sees ? 0.35 : 0) + (h.state === "chase" ? 0.45 : 0);
    d.stress = Math.max(0, Math.min(1.5, d.stress + (rise - (rise ? 0 : 0.06)) * dt - (d.relaxT > 0 ? 0.1 * dt : 0)));
  }
  if (d.stress >= 1 && g.phase !== "peak" && g.phase !== "intro" && g.phase !== "breather" && d.relaxT <= 0) {
    // too much: as soon as the chase is over, it goes away for a while
    if (h.state === "chase") d.wantRelax = true;
    else if (h.state !== "rip") { relax(g); d.stress = 0.6; }
  }
  if (d.relaxT > 0) d.relaxT -= dt;
  if (!h.active || d.relaxT > 0 || g.phase === "intro" || g.phase === "breather") return;
  // a d20 against the threat level
  d.rollT -= dt;
  if (d.rollT <= 0) {
    d.rollT = 7;
    const roll = 1 + Math.floor(g.r() * 20);
    if (roll <= d.T) d.advance = true;
  }
  // the nudge, from the third lamp on
  if (P.nudge > 0) {
    d.nudgeT -= dt;
    if (d.nudgeT <= 0) {
      d.nudgeT = P.nudge * g.tune.nudge * (0.8 + g.r() * 0.4) - d.T;
      if (h.state === "patrol" || h.state === "investigate") { d.advance = true; ev(g, { type: "nudge" }); if (h.state === "patrol") { h.path = null; h.wait = 0; } }
    }
  }
}

/* ---------- the player ---------- */

export function lanternPower(p) {
  if (!p.lantern || p.oil <= 0) return 0;
  // the flame holds up until the oil is low, then gutters down
  return Math.min(1, 0.25 + p.oil * 2.2);
}

function boxes(g) {
  const out = g.L.blocks.slice();
  for (const d of g.L.doors) if (!d.sealed && d.open < 0.5) out.push(doorBox(d));
  return out;
}

function inPool(g, x, z) {
  for (const l of g.L.lamps) if (l.lit && Math.hypot(l.x - x, l.z - z) < POOL_R) return true;
  return false;
}

/** What the player would act on now, if anything: the nearest thing in front within reach. */
export function target(g) {
  const p = g.player, L = g.L;
  if (p.hiding >= 0) return { kind: "closetOut", id: p.hiding };
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  let best = null, bs = Infinity;
  const consider = (kind, id, x, z, reach) => {
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d > (reach || REACH)) return;
    const facing = (dx * fx + dz * fz) / (d || 1);
    if (facing < 0.35 && d > 0.7) return;
    const s = d * (1.6 - facing);
    if (s < bs) { bs = s; best = { kind, id, x, z, d }; }
  };
  // a lit lamp is nothing to act on while your own flame burns, and must not
  // stand in the way of the closet beside it
  for (const l of L.lamps) if (!(l.lit && p.lantern && p.oil > 0)) consider("lamp", l.id, l.x, l.z, REACH + 0.2);
  for (const c of L.closets) consider("closet", c.id, c.x, c.z, 1.5);
  for (const d of L.doors) if (!d.sealed && (d.kind === "door" || d.kind === "front")) consider(d.kind === "front" ? "front" : "door", d.id, d.x, d.z, 1.6);
  for (const t of L.tins) if (!t.taken) consider("tin", t.id, t.x, t.z, 1.6);
  for (const n of L.notes) consider("note", n.id, n.x, n.z, 1.6);
  if (best && best.kind === "lamp" && L.lamps[best.id].lit) best.kind = "borrow";
  // you cannot reach through a wall (a closet is reached at its doors, which are its front)
  if (best && best.kind !== "door" && best.kind !== "front") {
    const at = best.kind === "closet" ? L.closets[best.id].front : best;
    if (!sees(g.G, p.x, p.z, at.x, at.z)) return null;
  }
  return best;
}

function interact(g, t, held, pressed, dt) {
  const p = g.player, L = g.L;
  if (!t) { g.act = null; g.actT = 0; return; }
  if (t.kind === "lamp" || t.kind === "borrow") {
    if (!held) { g.act = null; g.actT = 0; return; }
    if (t.kind === "lamp" && !(p.lantern && p.oil > 0)) { if (pressed) hint(g, "noflame", p.oil > 0 ? "Turn your wick up first. [lantern]" : "Your lantern is out. A lit lamp can light it again.", 5); return; }
    if (!g.act || g.act.id !== t.id || g.act.kind !== t.kind) { g.act = t; g.actT = 0; ev(g, { type: "lightStart", id: t.id }); }
    g.actT += dt;
    if (g.actT >= LIGHT_TIME) {
      g.act = null; g.actT = 0;
      if (t.kind === "lamp") lightLamp(g, L.lamps[t.id]);
      else { p.oil = Math.max(p.oil, OIL.borrow); p.lantern = true; ev(g, { type: "borrow", id: t.id }); }
    }
    return;
  }
  g.act = null; g.actT = 0;
  if (!pressed) return;
  if (t.kind === "closet") enterCloset(g, L.closets[t.id]);
  else if (t.kind === "closetOut") leaveCloset(g);
  else if (t.kind === "door") {
    const d = L.doors[t.id];
    d.open = d.open > 0.5 ? 0 : 1;
    ev(g, { type: "door", id: d.id, open: d.open > 0.5, who: "player" });
    g.noise(d.x, d.z, NOISE.door, "door");
    // a door shut on yourself pushes you out of the doorway
    const r = move(p.x, p.z, 0, 0, PLAYER_R, boxes(g)); p.x = r.x; p.z = r.z;
  } else if (t.kind === "front") {
    const d = L.doors[t.id];
    if (d.locked) { hint(g, "locked", g.lit < 5 ? "Locked. Not until every lamp is lit." : "Not yet.", 4); ev(g, { type: "rattle", id: d.id }); g.noise(d.x, d.z, NOISE.rattle, "rattle"); }
    else escape(g);
  } else if (t.kind === "tin") {
    const tin = L.tins[t.id];
    tin.taken = true;
    p.oil = Math.min(1, p.oil + OIL.tin);
    g.stats.tins++;
    ev(g, { type: "tin", id: tin.id });
  } else if (t.kind === "note") {
    const n = L.notes[t.id];
    if (!n.read) g.stats.notes++;
    n.read = true;
    ev(g, { type: "note", id: n.id });
  }
}

function lightLamp(g, l) {
  const p = g.player;
  l.lit = true;
  g.lit++;
  g.lastLamp = l.id;
  g.stats.lampsAt.push(Math.round(g.t));
  if (!l.refilled) { l.refilled = true; p.oil = Math.min(1, p.oil + OIL.refill); }
  ev(g, { type: "lampLit", id: l.id, n: g.lit });
  if (g.lit === 1) hint(g, "oil", "Your lantern drinks oil. Every lamp you light gives a little back.", 7);
  if (g.lit >= 2 && g.phase === "intro") { g.flags.passDone = true; setPhase(g, "unease"); }
  if (g.lit === 3) setPhase(g, "pressure");
  if (g.lit === 4) setPhase(g, "dread");
  if (g.lit === 5) {
    setPhase(g, "breather");
    relax(g, PHASES.breather.relax);
    hint(g, "lit", "The house is lit.", 6);
    ev(g, { type: "silence" });
  }
  if (g.lit >= 2 && !g.hunter.active) arrive(g);
}

function enterCloset(g, c) {
  const p = g.player, h = g.hunter;
  p.hiding = c.id; p.hideT = 0; p.vx = p.vz = 0;
  p.x = c.inside.x; p.z = c.inside.z; p.yaw = c.rot;
  g.stats.hides++;
  ev(g, { type: "closetIn", id: c.id });
  g.noise(c.x, c.z, NOISE.closet, "closet");
  // rule 7: if it saw you go in, it knows (the scripted first visit only looks)
  if (h.active && h.state !== "pass" && (h.sees || (h.state === "chase" && g.hunterDist < 9 && h.lostT < 0.8))) { h.sawHide = c.id; ev(g, { type: "spotted" }); }
  if (p.lantern && p.oil > 0) hint(g, "closetlight", "Your light shows through the slats. [lantern]", 5);
}

function leaveCloset(g) {
  const p = g.player, c = g.L.closets[p.hiding];
  p.hiding = -1;
  p.x = c.front.x; p.z = c.front.z; p.yaw = c.rot;
  const r = move(p.x, p.z, 0, 0, PLAYER_R, boxes(g)); p.x = r.x; p.z = r.z;
  ev(g, { type: "closetOut", id: c.id });
  g.noise(c.x, c.z, NOISE.closet, "closet");
}

/* The hunter's first entrance: through a window in a room away from you. */
function arrive(g) {
  const pr = Math.max(0, roomAt(g.L, g.player.x, g.player.z));
  const hops = g.L.graph.hops[pr];
  const wins = g.L.windows.filter((w) => hops[w.room] >= 2 && hops[w.room] < Infinity).sort((a, b) => hops[b.room] - hops[a.room]);
  const w = wins.length ? wins[Math.floor(g.r() * Math.min(3, wins.length))] : g.L.windows[0];
  hunt.enter(g, w);
  relax(g, 20);
}

/* The scripted first visit (the research's onboarding, 30–45 s): a flicker,
   a step, a closet two strides away, and it walks past. */
function startPass(g) {
  const L = g.L, p = g.player;
  const pr = Math.max(0, roomAt(L, p.x, p.z));
  const hops = L.graph.hops[pr];
  const wins = L.windows.filter((w) => hops[w.room] === 1 || hops[w.room] === 2);
  if (!wins.length) { arrive(g); g.flags.passDone = true; setPhase(g, "unease"); return; }
  const win = wins[Math.floor(g.r() * wins.length)];
  // it walks to the doorway of your room, looks in, and leaves the way it came
  const door = L.doors.filter((d) => (d.a === pr || d.b === pr) && d.b >= 0 && !d.sealed).sort((a, b) => Math.hypot(a.x - win.x, a.z - win.z) - Math.hypot(b.x - win.x, b.z - win.z))[0];
  const rm = L.rooms[pr];
  const via = door ? { x: door.x + (rm.cx - door.x) * 0.25, z: door.z + (rm.cz - door.z) * 0.25 } : { x: rm.cx, z: rm.cz };
  const out = { x: win.x - win.n[0] * 1.2, z: win.z - win.n[1] * 1.2 };
  hunt.startPass(g, win, via, out);
  ev(g, { type: "flicker", strong: true });
  hint(g, "hide", "Something is coming. Hide in the aparador. [interact]", 8);
}

function caught(g, how) {
  if (g.state !== "play") return;
  g.state = "caught";
  g.caughtT = 0;
  g.stats.deaths++;
  g.player.vx = g.player.vz = 0;
  ev(g, { type: "kill", how, x: g.hunter.x, z: g.hunter.z });
}

/* Lola's Rules: you wake by the last lamp you lit, and it has gone far away. */
function respawn(g) {
  const p = g.player, L = g.L;
  const lit = L.lamps.filter((l) => l.lit);
  const l = lit.length ? L.lamps[g.lastLamp] : null;
  if (p.hiding >= 0) p.hiding = -1;
  // on open floor in front of the lamp, facing it
  const at = l ? l.front : L.start;
  const c = nearestFree(g.G, at.x, at.z);
  p.x = c >= 0 ? cx(g.G, c) : at.x; p.z = c >= 0 ? cz(g.G, c) : at.z;
  p.yaw = l ? Math.atan2(l.x - p.x, l.z - p.z) : L.start.yaw;
  const r = move(p.x, p.z, 0, 0, PLAYER_R, boxes(g)); p.x = r.x; p.z = r.z;
  p.oil = Math.max(p.oil, 0.5); p.lantern = !g.flipped; p.dread = 0.3; p.exert = 0; p.breath = 1; p.crouch = false;
  g.state = "play";
  hunt.placeFar(g);
  g.dir.stress = 0; g.dir.relaxT = 30 * g.tune.relax;
  ev(g, { type: "respawn" });
}

/* The fifth lamp's breather is over: the house turns on you. */
function flip(g) {
  g.flipped = true;
  setPhase(g, "peak");
  const from = g.L.lamps[g.lastLamp].room;
  const changes = alter(g.L, from, g.r, g.player);
  // and if a wall closed where you stand, you are put back on the floor
  const r = move(g.player.x, g.player.z, 0, 0, PLAYER_R, boxes(g)); g.player.x = r.x; g.player.z = r.z;
  rebuild(g.G);
  g.hunter.field = null;
  const fd = g.L.doors.find((d) => d.kind === "front");
  fd.locked = false;
  ev(g, { type: "flip", changes, door: fd.id });
  ev(g, { type: "lightning", power: 1, thunder: 0.15, scripted: true });
  hint(g, "flip", "It was waiting for the light. Put yours out, and find the front door.", 9);
  g.dir.relaxT = 0;
  g.dir.nudgeT = 20;
  hunt.patrolNext(g);
  ev(g, { type: "scream", x: g.hunter.x, z: g.hunter.z });
}

function escape(g) {
  g.state = "won";
  g.stats.escapedAt = Math.round(g.t);
  g.stats.time = g.t;
  ev(g, { type: "won" });
}

/* ---------- the step ---------- */

/**
 * input: { fwd, side (−1..1), run, crouch, yaw, pitch, use (held), usePress,
 * lanternPress, breath (held) }
 */
export function step(g, dt, input) {
  input = input || {};
  g.events.length = 0;
  if (g.state === "won" || g.state === "dead") return;
  g.t += dt; g.phaseT += dt;
  const p = g.player, h = g.hunter;

  if (g.state === "caught") {
    g.caughtT += dt;
    if (g.caughtT > 2.6) {
      if (g.mode === "onenight") { g.state = "dead"; ev(g, { type: "dead" }); }
      else respawn(g);
    }
    return;
  }

  if (typeof input.yaw === "number") p.yaw = input.yaw;
  if (typeof input.pitch === "number") p.pitch = input.pitch;

  // the lantern's wick
  if (input.lanternPress) {
    if (p.oil > 0) { p.lantern = !p.lantern; ev(g, { type: "lantern", on: p.lantern }); }
    else hint(g, "noflame", "Your lantern is out. A lit lamp can light it again.", 5);
  }
  const wasLit = p.lantern && p.oil > 0;
  if (wasLit) {
    const burn = OIL.burn * (p.running ? OIL.runMul : 1) * dt;
    p.oil = Math.max(0, p.oil - burn);
    g.stats.oilUsed += burn;
    if (p.oil <= 0) { p.lantern = false; ev(g, { type: "lanternDie" }); hint(g, "dead", "Your lantern is out. A lit lamp can light it again.", 6); }
  }
  g.lanternPower = lanternPower(p);
  g.litT = p.lantern && p.oil > 0 ? g.litT + dt : 0;
  if (g.flipped && g.litT > 0.3) hint(g, "beacon", "It sees your lantern. Put it out. [lantern]", 5);

  // breath: held on purpose, or given up in a gasp
  p.gaspLock = Math.max(0, p.gaspLock - dt);
  p.holding = !!input.breath && p.gaspLock <= 0 && p.breath > 0;
  if (p.holding) {
    p.breath = Math.max(0, p.breath - dt / 7);
    if (p.breath <= 0) {
      p.holding = false; p.gaspLock = 2.5;
      ev(g, { type: "gasp" });
      g.noise(p.x, p.z, NOISE.gasp, "gasp");
    }
  } else p.breath = Math.min(1, p.breath + dt / 4);

  if (p.hiding >= 0) {
    p.hideT += dt;
    p.running = false; p.moving = false; p.speed = 0;
    // close quarters: if it is near enough to hear, your breathing gives you away
    if (h.active && g.hunterDist < 2.6 && !p.holding && p.dread > 0.55) {
      p.breatheT -= dt;
      if (p.breatheT <= 0) { p.breatheT = 2.2; ev(g, { type: "breathe", loud: true }); g.noise(p.x, p.z, NOISE.breathe * (0.6 + p.dread), "gasp"); }
    }
    if (h.active && g.hunterDist < 4.5) hint(g, "holdbreath", "Hold your breath. [breath]", 5);
  } else {
    // walking
    const T = g.tune;
    p.crouch = !!input.crouch;
    p.running = !!input.run && !p.crouch && !p.winded && (input.fwd || 0) > 0.1;
    let mf = input.fwd || 0, ms = input.side || 0;
    const ml = Math.hypot(mf, ms);
    if (ml > 1) { mf /= ml; ms /= ml; }
    const sp = p.running ? SPEED.run : p.crouch ? SPEED.crouch : SPEED.walk;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    // right of facing (fx, fz) is (-fz, fx) in this frame: x east, z south, yaw from +z
    const wx = (fx * mf - fz * ms) * sp, wz = (fz * mf + fx * ms) * sp;
    const acc = ml > 0.05 ? 10 : 12;
    p.vx += (wx - p.vx) * Math.min(1, acc * dt);
    p.vz += (wz - p.vz) * Math.min(1, acc * dt);
    const ox = p.x, oz = p.z;
    const r = move(p.x, p.z, p.vx * dt, p.vz * dt, PLAYER_R, boxes(g));
    p.x = r.x; p.z = r.z;
    const moved = Math.hypot(p.x - ox, p.z - oz);
    p.speed = moved / dt; p.moving = p.speed > 0.3;
    p.eye += ((p.crouch ? EYE_CROUCH : EYE) - p.eye) * Math.min(1, dt * 8);
    // steps: each one is a sound the hunter may hear
    p.stepD += moved;
    const stride = p.running ? 1.05 : p.crouch ? 0.55 : 0.78;
    if (p.stepD >= stride) {
      p.stepD -= stride;
      const kind = p.running ? "run" : p.crouch ? "crouch" : "walk";
      ev(g, { type: "step", who: "player", x: p.x, z: p.z, kind, tiles: g.L.rooms[Math.max(0, roomAt(g.L, p.x, p.z))].floor === "tiles" });
      g.noise(p.x, p.z, NOISE[kind], "step");
      if (p.running && h.active && h.state !== "retreat") hint(g, "run", "Running is loud. [crouch] to crouch and creep.", 6);
    }
    // boards that creak
    p.creakT = Math.max(0, p.creakT - dt);
    if (p.moving && p.creakT <= 0) {
      for (let i = 0; i < g.L.creaks.length; i++) {
        const c = g.L.creaks[i];
        if (Math.hypot(c.x - p.x, c.z - p.z) < c.r) {
          p.creakT = 1.6;
          ev(g, { type: "creak", x: c.x, z: c.z, soft: p.crouch });
          g.noise(c.x, c.z, p.crouch ? NOISE.creakCrouch : NOISE.creakWalk, "creak");
          break;
        }
      }
    }
    // pots and buckets on the floor, kicked by anyone not watching their feet
    if (p.moving && !p.crouch) for (const q of g.L.props) {
      if (!q.small || q.y > 0.01) continue;
      if (Math.hypot(q.x - p.x, q.z - p.z) < 0.4 && g.t - (g.kicked[q.id] || -9) > 3) {
        g.kicked[q.id] = g.t;
        ev(g, { type: "kick", prop: q.id, x: q.x, z: q.z, dx: p.vx, dz: p.vz });
        g.noise(q.x, q.z, NOISE.kick, "kick");
      }
    }
    // running winds you; winded, you pant, and panting carries
    p.exert = Math.max(0, Math.min(1.2, p.exert + (p.running ? dt / 6 : -dt / 7)));
    if (p.exert >= 1) p.winded = true;
    if (p.winded && p.exert < 0.35) p.winded = false;
    if (p.winded && !p.holding) {
      p.pantT -= dt;
      if (p.pantT <= 0) { p.pantT = 1.4; ev(g, { type: "pant" }); g.noise(p.x, p.z, NOISE.pant, "pant"); }
    }
    // the dark gets in: past a point, you breathe loud enough to hear
    if (p.dread > 0.8 && !p.holding && !p.winded) {
      p.breatheT -= dt;
      if (p.breatheT <= 0) { p.breatheT = 2.6; ev(g, { type: "breathe", loud: true }); g.noise(p.x, p.z, NOISE.breathe, "breathe"); hint(g, "dread", "The dark is getting to you. Hold [breath], or find light.", 6); }
    }
  }

  // dread, never shown as a number
  g.inPool = inPool(g, p.x, p.z);
  const dark = !(p.lantern && p.oil > 0) && !(g.inPool && !g.flipped);
  let dd = dark ? (g.flipped ? 0.006 : 0.012) : -0.03;
  if (p.hiding >= 0) dd += 0.018;
  if (h.active && g.hunterDist < 7) dd += 0.05 * (1 - g.hunterDist / 7) + (h.sees ? 0.05 : 0);
  if (h.state === "chase") dd += 0.06;
  p.dread = Math.max(0, Math.min(1, p.dread + dd * dt));

  // hands
  interact(g, target(g), !!input.use, !!input.usePress, dt);

  // the one minute of script, then the director
  if (g.phase === "intro" && g.lit >= 1 && !g.flags.passStarted) {
    const l = g.L.lamps[g.lastLamp];
    const away = Math.hypot(p.x - l.x, p.z - l.z);
    const since = g.t - g.stats.lampsAt[0];
    if (since > 14 || (away > 7 && since > 4)) { g.flags.passStarted = true; startPass(g); }
  }
  // however the first pass ends — walked out, or cut short — the night proper begins
  if (g.phase === "intro" && g.flags.passStarted && !g.flags.passDone && h.state !== "pass" && h.state !== "stare") g.passDone();
  if (g.phase === "breather" && g.phaseT > PHASES.breather.relax * 0.85) flip(g);

  director(g, dt);
  hunt.step(g, dt);

  // weather: lightning, and its thunder a moment later
  g.lightning -= dt;
  if (g.lightning <= 0) {
    g.lightning = g.flipped ? 10 + g.r() * 14 : 20 + g.r() * 40;
    ev(g, { type: "lightning", power: 0.4 + g.r() * 0.6, thunder: 0.5 + g.r() * 2.8 });
  }
  if (g.hint && g.t > g.hint.until) g.hint = null;
}

/* For the UI: what pressing [interact] would do here. */
export function prompt(g) {
  if (g.state !== "play") return null;
  const t = target(g);
  if (!t) return null;
  const L = g.L, p = g.player;
  switch (t.kind) {
    case "lamp": return { verb: p.lantern && p.oil > 0 ? "Hold to light the lamp" : "Your lantern is out", hold: true, progress: g.act ? g.actT / LIGHT_TIME : 0 };
    case "borrow": return { verb: "Hold to light your lantern", hold: true, progress: g.act ? g.actT / LIGHT_TIME : 0 };
    case "closet": return { verb: "Hide" };
    case "closetOut": return { verb: "Step out" };
    case "door": return { verb: L.doors[t.id].open > 0.5 ? "Close the door" : "Open the door" };
    case "front": return { verb: L.doors[t.id].locked ? "The front door" : "Get out" };
    case "tin": return { verb: "Take the oil" };
    case "note": return { verb: "Read" };
  }
  return null;
}

export { PROPS };

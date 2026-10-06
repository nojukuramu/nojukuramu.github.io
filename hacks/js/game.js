/* game.js — a match: who is in it, what each tick does, and who hurt whom.
 *
 * Every body moves the same way — a command in, movement.js and weapons.js
 * out — whether the command came from your keys, a bot's brain, or a hack.
 * That is the promise the hack API rests on: a hack gets the same buttons
 * and the same body everyone else has, and nothing more.
 *
 * Who decides what (the same split as Magic Sandbox's net.js):
 *   - Your body is yours: your machine moves it, fires its shots and decides
 *     whether they hit (favour the shooter — what you saw is what you hit).
 *     Whoever owns a body applies damage to it and decides it died.
 *   - Bots belong to the host (or to you, alone).
 *   - Everything that is somebody else's is a puppet here, drawn where its
 *     owner last said it was (net.js fills in its state).
 * In solo play all of it is yours.
 *
 * The tick is fixed (movement.js's TICK, 64 a second); the renderer draws
 * between ticks. */

import { S, emit } from "./state.js";
import { newBody, pmove, TICK, B, LUNGE, HOOK, PM, lookDir, placeBody } from "./movement.js";
import { newArms, armsTick, GUNS, MELEE, damageFor, speedMulOf, holdOf, cleanLoadout, speedBonus, bladeOut, grappleOut } from "./weapons.js";
import { pose, stepPhase, rayBones, BONES, BI } from "./skeleton.js";
import { ray, newTrace } from "./brush.js";
import { buildMap } from "./map.js";
import { buildNav } from "./nav.js";
import { MODES, COLORS, TEAMS, RESPAWN_S, newScore, recordKill, timeUp, hostile, cleanSettings, botCount } from "./modes.js";
import { mulberry32 } from "./util.js";
import * as bots from "./bots.js";

const TR = newTrace();
export const MAX_HP = 100;
const REGEN_DELAY = 4.5, REGEN_RATE = 22;

/* ---------------------------------------------------------------
   The world
   --------------------------------------------------------------- */
export function world() {
  if (!S.world) S.world = buildMap();
  return S.world;
}
export function nav() {
  if (!S.nav) S.nav = buildNav(world());
  return S.nav;
}

/* ---------------------------------------------------------------
   Actors
   --------------------------------------------------------------- */
let nextBotId = 1000;
export function makeActor(o) {
  const a = {
    id: o.id, name: o.name || "Player", team: o.team | 0, kind: o.kind,     // local | bot | remote
    color: 0xffffff,
    loadout: cleanLoadout(o.loadout),
    body: newBody(0, 0.02, 0, 0),
    arms: null,
    hp: MAX_HP, maxHp: MAX_HP, alive: false, respawnT: o.kind === "remote" ? 1e9 : 0.3,
    lastHurt: -99, lastAttacker: null,
    kills: 0, deaths: 0, streak: 0,
    bones: new Float32Array(BONES.length * 3), phase: 0,
    rng: mulberry32(o.seed || ((Math.random() * 1e9) | 0)),
    px: 0, py: 0, pz: 0,
    lungeHits: new Set(),
    aim: { yaw: 0, pitch: 0 },
    brain: null, diff: o.diff || "normal",
    net: null, heard: o.kind !== "remote",
    spawnedAt: 0
  };
  a.arms = newArms(a.loadout);
  if (o.kind === "bot") a.brain = bots.newBrain(a);
  return a;
}
export const actorById = (id) => S.actors.find((a) => a.id === id) || null;
export function addActor(a) { S.actors.push(a); recolor(); emit("actors"); return a; }
export function removeActor(a) {
  const i = S.actors.indexOf(a);
  if (i >= 0) S.actors.splice(i, 1);
  emit("actorGone", a);
  emit("actors");
}
/** Team colours in team play; one colour each otherwise. */
export function recolor() {
  const M = S.match && MODES[S.match.mode];
  S.actors.forEach((a, i) => { a.color = M && M.teams ? TEAMS[a.team].hex : COLORS[i % COLORS.length]; });
}
/** Is this body's truth kept on this machine? */
export const owns = (a) => a.kind === "local" || (a.kind === "bot" && S.net.role !== "client");
export const isEnemy = (a, b) => !!S.match && (S.match.mode === "practice" ? a.id !== b.id : hostile(S.match.mode, a, b));

/* ---------------------------------------------------------------
   Starting and ending
   --------------------------------------------------------------- */
const BOT_LOADOUTS = [
  { primary: "kestrel", secondary: "wasp", melee: "katana" },
  { primary: "hornet", secondary: "brick", melee: "lancer" },
  { primary: "mauler", secondary: "wasp", melee: "katana" },
  { primary: "talon", secondary: "hornet", melee: "lancer" },
  { primary: "kestrel", secondary: "mauler", melee: "lancer" },
  { primary: "hornet", secondary: "talon", melee: "katana" },
  { primary: "condor", secondary: "wasp", melee: "katana" }
];
const BOT_NAMES = ["Nullptr", "Segfault", "Heisenbug", "Off-by-one", "Deadlock", "Race", "Stack", "Overflow", "Leak", "Sudo", "Regex", "Cache", "Kernel", "Daemon", "Fork", "Mutex"];

/**
 * A match. settings: modes.js settings. opts: { me: {id, name, team, loadout},
 * humans (for bot count), seed }.
 */
export function startMatch(settings, opts) {
  opts = opts || {};
  const s = cleanSettings(settings);
  world();
  S.actors = [];
  S.projectiles = [];
  S.time = 0; S.tick = 0; S.paused = false;
  S.match = { mode: s.mode, settings: s, score: newScore(s.target), timeLeft: s.time ? s.time * 60 : 0, over: false, winner: null, startedAt: performance.now() };
  S.mode = "play";
  const me = makeActor({ id: opts.me.id || 1, name: opts.me.name, team: opts.me.team || 0, kind: "local", loadout: opts.me.loadout });
  S.me = me;
  addActor(me);
  if (S.net.role !== "client") fillBots(opts.humans || 1);
  spawn(me);
  emit("matchStart", S.match);
  return S.match;
}

/** Host or solo: bring the bots to the number the settings want for these humans. */
export function fillBots(humans) {
  const M = S.match;
  if (!M) return;
  const want = botCount(M.settings, humans);
  let have = S.actors.filter((a) => a.kind === "bot");
  const pool = BOT_NAMES.filter((n) => !have.some((b) => b.name === n));
  while (have.length < want) {
    const teams = [0, 0];
    for (const a of S.actors) teams[a.team]++;
    const team = MODES[M.mode].teams ? (teams[1] < teams[0] ? 1 : 0) : 0;
    const name = pool.length ? pool.splice(Math.floor(Math.random() * pool.length), 1)[0] : "Bot " + nextBotId;
    const b = makeActor({ id: nextBotId++, name, team, kind: "bot", diff: M.settings.diff, loadout: BOT_LOADOUTS[Math.floor(Math.random() * BOT_LOADOUTS.length)] });
    if (M.mode === "practice") b.passive = true;
    addActor(b);
    have.push(b);
    nav();
  }
  while (have.length > want) { const b = have.pop(); removeActor(b); }
}

export function endMatch(winner) {
  const M = S.match;
  if (!M || M.over) return;
  M.over = true; M.winner = winner;
  emit("matchEnd", M);
}
export function quit() {
  S.match = null; S.actors = []; S.me = null; S.projectiles = []; S.mode = "title";
  emit("quit");
}

/* ---------------------------------------------------------------
   Spawning
   --------------------------------------------------------------- */
/** The spawn point furthest from every enemy, with a little chance in it. */
export function pickSpawn(a) {
  const W = world();
  let best = null, bs = -Infinity;
  for (const sp of W.spawns) {
    let near = 1e9;
    for (const b of S.actors) if (b !== a && b.alive && isEnemy(a, b)) near = Math.min(near, Math.hypot(b.body.x - sp.x, b.body.z - sp.z));
    if (MODES[S.match.mode].teams) {
      // teams start on their own side
      const side = a.team === 0 ? sp.z : -sp.z;
      near += side > 0 ? 20 : 0;
    }
    const score = Math.min(near, 60) + Math.random() * 14;
    if (score > bs) { bs = score; best = sp; }
  }
  return best || W.spawns[0];
}
export function spawn(a, at) {
  const sp = at || pickSpawn(a);
  const body = newBody(sp.x, sp.y, sp.z, sp.yaw);
  body.gravityScale = a.body.gravityScale; body.speedScale = a.body.speedScale; body.jumpScale = a.body.jumpScale;
  placeBody(world(), body, sp.x, sp.y, sp.z);
  a.body = body;
  a.px = body.x; a.py = body.y; a.pz = body.z;
  a.arms = newArms(a.loadout);
  a.hp = a.maxHp; a.alive = true; a.lastHurt = -99; a.lastAttacker = null;
  a.aim.yaw = sp.yaw; a.aim.pitch = 0;
  a.spawnedAt = S.time;
  a.lungeHits.clear();
  if (a.kind === "local") { S.view.yaw = sp.yaw; S.view.pitch = 0; }
  if (a.brain) bots.reset(a);
  a.bones = pose(poseState(a), holdOf(a.arms), a.bones);
  emit("spawn", a);
}

/* ---------------------------------------------------------------
   The tick
   --------------------------------------------------------------- */
let localCmd = () => ({ fwd: 0, side: 0, yaw: S.view.yaw, pitch: S.view.pitch, buttons: 0, slot: 0 });
/** input.js (through hackapi.js) supplies your command for each tick. */
export function setLocalCmd(fn) { localCmd = fn; }

export function tick(dt) {
  const M = S.match;
  if (!M || S.paused) return;
  S.tick++; S.time += dt;
  for (const a of S.actors) {
    if (!owns(a)) continue;
    if (!a.alive) {
      if (M.over) continue;
      a.respawnT -= dt;
      if (a.respawnT <= 0) spawn(a);
      continue;
    }
    const cmd = a.kind === "local" ? localCmd(dt) : bots.think(a, dt);
    a.body.yank = yankOf(a);
    simulate(a, cmd, dt);
  }
  projectiles(dt);
  if (S.net.role !== "client" && M.timeLeft > 0 && !M.over) {
    M.timeLeft -= dt;
    if (M.timeLeft <= 0) { M.timeLeft = 0; const w = timeUp(M.score, M.mode); emit("scoreChanged", M.score); endMatch(w); }
  }
}

export function poseState(a) {
  const b = a.body;
  return { x: b.x, y: b.y, z: b.z, yaw: b.yaw, pitch: b.pitch, vx: b.vx, vz: b.vz, onGround: b.onGround, crouched: b.crouched, sliding: b.sliding, climbing: b.climbing, lunge: b.lunge, eye: b.eye, phase: a.phase,
    hook: b.hook, hx: b.hx, hy: b.hy, hz: b.hz };
}

function simulate(a, cmd, dt) {
  const W = world(), body = a.body, A = a.arms;
  a.px = body.x; a.py = body.y; a.pz = body.z;
  const busy = A.cur < 2 && (cmd.buttons & (B.FIRE | B.ADS));
  hookTick(a, cmd, dt);
  // the lunge is the blade's: with a gun or the grapple out, the button does nothing
  pmove(W, body, cmd, dt, { melee: bladeOut(A) ? MELEE[A.melee] : null, speedMul: speedMulOf(A), noSprint: !!busy });
  for (const ev of body.ev) {
    if (ev === "swing") armsSwing(a);
    emit("move", a, ev);
  }
  body.ev.length = 0;
  const evs = armsTick(A, cmd, body, dt, a.rng, B);
  for (const e of evs) {
    if (e.type === "fire") fire(a, e);
    else if (e.type === "swing") swingHit(a);
    emit("arms", a, e);
  }
  if (body.lunge === LUNGE.DASH) lungeHit(a); else if (a.lungeHits.size) a.lungeHits.clear();
  a.phase = stepPhase(a.phase, Math.hypot(body.vx, body.vz), dt, body.onGround);
  a.bones = pose(poseState(a), holdOf(A), a.bones);
  // health comes back when nothing has hurt you for a while
  if (a.hp < a.maxHp && S.time - a.lastHurt > REGEN_DELAY) a.hp = Math.min(a.maxHp, a.hp + REGEN_RATE * dt);
  if (body.y < W.killY) die(a, null, { weapon: "fall" });
  if (a.kind === "local") S.topSpeed = Math.max(S.topSpeed || 0, Math.hypot(body.vx, body.vz));
}
/* A lunge (Aim with the blade out) tapped rather than held is a quick swing (movement.js says which). */
function armsSwing(a) {
  const A = a.arms;
  if (A.swingCd > 0) return false;
  const m = MELEE[A.melee];
  A.swingCd = m.swingCd; A.swingT = 0.25;
  emit("arms", a, { type: "swing", melee: m.id });
  swingHit(a);
  return true;
}

/* Recoil lifts your aim, and it stays lifted: pull down against it. */
function kick(a, k) {
  if (a.kind === "local") { S.view.pitch = Math.min(1.55, S.view.pitch + k.pitch); S.view.yaw += k.yaw; }
  else { a.aim.pitch = Math.min(1.55, a.aim.pitch + k.pitch); a.aim.yaw += k.yaw; }
}

/* ---------------------------------------------------------------
   Shots
   --------------------------------------------------------------- */
export function eyeOf(a) { return [a.body.x, a.body.y + a.body.eye, a.body.z]; }

/**
 * What a ray from o along d meets first within range: the world, or a body
 * that `shooter` may hurt. Bodies are tested bone by bone (skeleton.js).
 */
export function castRay(shooter, o, d, range, skip) {
  const W = world();
  ray(W, o[0], o[1], o[2], o[0] + d[0] * range, o[1] + d[1] * range, o[2] + d[2] * range, TR);
  let t = TR.fraction * range;
  let hit = { t, actor: null, part: null, nx: TR.nx, ny: TR.ny, nz: TR.nz, kind: TR.brush ? TR.brush.kind : "", world: TR.fraction < 1 };
  for (const b of S.actors) {
    if (b === shooter || !b.alive || !b.heard || !isEnemy(shooter, b) || (skip && skip.has(b.id))) continue;
    // cheap reject: the ray passes nowhere near this body
    const cx = b.body.x - o[0], cy = b.body.y + 0.9 - o[1], cz = b.body.z - o[2];
    const along = cx * d[0] + cy * d[1] + cz * d[2];
    if (along < -1 || along > t + 1) continue;
    const px = cx - d[0] * along, py = cy - d[1] * along, pz = cz - d[2] * along;
    if (px * px + py * py + pz * pz > 2.6) continue;
    const r = rayBones(b.bones, o[0], o[1], o[2], d[0], d[1], d[2], t);
    if (r && r.t < t) { t = r.t; hit = { t, actor: b, part: r.part, box: r.box, world: false }; }
  }
  hit.x = o[0] + d[0] * t; hit.y = o[1] + d[1] * t; hit.z = o[2] + d[2] * t;
  return hit;
}

/** Is a body off the ground (not on it, not on a wall)? A kill up there is a mid-air one. */
export const airborne = (b) => !b.body.onGround && !b.body.climbing;

/* A round goes on through a body if its gun can (pen: how many, and how much damage it keeps through
   each), so one bullet can drop two people standing in a line: a collateral. Each stretch between bodies
   is its own tracer, so the hack API, the network and the effects all see where it went. */
function fire(a, e) {
  kick(a, e.kick);
  const g = GUNS[e.gun];
  const o = eyeOf(a);
  const shot = a.id * 100000 + (e.shot || 0);
  emit("fired", a, e);
  for (const d of e.dirs) {
    if (e.proj) { spawnProjectile(a, g, o, d, shot); continue; }
    let from = o, went = 0, keep = 1, left = g.pen ? g.pen[0] : 0, skip = null;
    for (;;) {
      const h = castRay(a, from, d, 400 - went, skip);
      if (from !== o) h.from = from;
      emit("tracer", a, o, h, g.id);
      if (!h.actor) break;
      went += h.t;
      hitActor(h.actor, damageFor(g, went, h.part) * keep, a, { weapon: g.id, part: h.part, shot, through: skip ? skip.size : 0, dist: went, air: airborne(h.actor) });
      if (left-- <= 0) break;
      (skip = skip || new Set()).add(h.actor.id);
      keep *= g.pen[1];
      from = [h.x + d[0] * 0.02, h.y + d[1] * 0.02, h.z + d[2] * 0.02];
    }
  }
}

/* A sniper's round flies: it has speed, it falls, and it can miss a moving target. The first stretch
   (projectile.instant metres) is covered on the tick it is fired, so a close shot is where the reticle
   was; past that it is in the air, and far away it has to be led. */
function spawnProjectile(a, g, o, d, shot) {
  const P = g.projectile;
  const p = { owner: a.id, mine: owns(a), gun: g.id, x: o[0], y: o[1], z: o[2], vx: d[0] * P.speed, vy: d[1] * P.speed, vz: d[2] * P.speed, g: P.gravity, life: 3, id: (Math.random() * 1e9) | 0,
    dist: 0, pen: g.pen ? g.pen[0] : 0, keep: 1, skip: null, shot };
  S.projectiles.push(p);
  emit("projectile", p);
  if (P.instant && !flyRound(p, d, P.instant)) S.projectiles.splice(S.projectiles.indexOf(p), 1);
  return p;
}
/** Somebody else's round, as their machine reported it: drawn here, judged there. */
export function addForeignProjectile(owner, gun, o, v) {
  const g = GUNS[gun];
  if (!g || !g.projectile) return;
  const sp = Math.hypot(v[0], v[1], v[2]) || 1;
  const p = { owner, mine: false, gun, x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2], g: g.projectile.gravity, life: 3, id: 0, dist: 0, pen: g.pen ? g.pen[0] : 0, keep: 1, skip: null };
  S.projectiles.push(p);
  if (g.projectile.instant && !flyRound(p, [v[0] / sp, v[1] / sp, v[2] / sp], g.projectile.instant)) S.projectiles.splice(S.projectiles.indexOf(p), 1);
}
/** Move a round `step` metres along d, through whatever bodies its gun goes through. False once it has stopped. */
function flyRound(p, d, step) {
  const owner = actorById(p.owner) || { id: p.owner, team: -1, body: null };
  const g = GUNS[p.gun];
  let o = [p.x, p.y, p.z], left = step;
  for (let n = 0; n < 6; n++) {
    const h = castRay(owner, o, d, left, p.skip);
    if (h.t >= left - 1e-6) break;
    p.dist += h.t; left -= h.t;
    p.x = h.x; p.y = h.y; p.z = h.z;
    emit("impact", p, h);
    if (!h.actor) return false;
    if (p.mine) hitActor(h.actor, damageFor(g, p.dist, h.part) * p.keep, owner, { weapon: p.gun, part: h.part, shot: p.shot, through: p.skip ? p.skip.size : 0, dist: p.dist, air: airborne(h.actor) });
    if (p.pen <= 0) return false;
    p.pen--; p.keep *= g.pen[1];
    (p.skip = p.skip || new Set()).add(h.actor.id);
    o = [h.x + d[0] * 0.02, h.y + d[1] * 0.02, h.z + d[2] * 0.02];
  }
  p.x = o[0] + d[0] * left; p.y = o[1] + d[1] * left; p.z = o[2] + d[2] * left;
  p.dist += left;
  return true;
}
function projectiles(dt) {
  for (let i = S.projectiles.length - 1; i >= 0; i--) {
    const p = S.projectiles[i];
    p.life -= dt;
    const vx = p.vx, vy = p.vy - p.g * dt * 0.5, vz = p.vz;
    const sp = Math.hypot(vx, vy, vz);
    p.px = p.x; p.py = p.y; p.pz = p.z;
    if (p.life <= 0 || !flyRound(p, [vx / sp, vy / sp, vz / sp], sp * dt)) { S.projectiles.splice(i, 1); continue; }
    p.vy -= p.g * dt;
  }
}

/* ---------------------------------------------------------------
   The grapple
   --------------------------------------------------------------- */
/*
 * Everybody carries one, in the fourth slot. Draw it and hold Fire: the
 * hook flies where you look (PM.hookSpeed, out to PM.hookRange). If it meets
 * the level it holds there and movement.js reels you in; if it meets an
 * enemy it holds them, and each of you is pulled towards the other —
 * whoever owns each body does the pulling (yankOf), so it works the same
 * over the network as alone. Let go and it lets go; when the pull is
 * complete it lets go by itself. The rope cannot pass through a wall, and
 * the invisible lid over the arena gives the hook nothing to bite.
 */
const HTR = newTrace();
function hookTick(a, cmd, dt) {
  const b = a.body, A = a.arms;
  // The grapple is a gun: out of your hands it does nothing, and in them Fire is its trigger
  // (B.HOOK is the same trigger, for hacks and bots that name it). Put it away and the rope goes.
  let held = grappleOut(A) && !!(cmd.buttons & (B.FIRE | B.HOOK));
  // still coming up: a trigger held through the draw fires the moment it is ready, not never
  if (b.hook === HOOK.IDLE && A.swapT > 0) held = false;
  b.hookCd = Math.max(0, b.hookCd - dt);
  if (b.hook !== HOOK.IDLE && !held) hookOff(a, "hookoff");
  else if (b.hook === HOOK.IDLE) { if (held && !b.hookHeld && b.hookCd <= 0) launchHook(a, cmd); }
  else if (b.hook === HOOK.FLY) flyHook(a, dt);
  else if (b.hook === HOOK.ON) holdHook(a, dt);
  b.hookHeld = held;
}
/* It flies where this tick's command looks (the body only turns to it in pmove, after this). */
function launchHook(a, cmd) {
  const b = a.body, e = eyeOf(a);
  const d = lookDir(isFinite(cmd.yaw) ? cmd.yaw : b.yaw, isFinite(cmd.pitch) ? Math.max(-1.55, Math.min(1.55, cmd.pitch)) : b.pitch);
  b.hook = HOOK.FLY; b.hx = e[0]; b.hy = e[1]; b.hz = e[2]; b.hdx = d[0]; b.hdy = d[1]; b.hdz = d[2];
  b.hookT = 0; b.hTarget = -1; b.hookBlocked = 0;
  b.ev.push("hookfire");
}
/* The hook is a claw, not a bullet: it catches a body it passes within HOOK_CATCH of (its chest or hips),
   so a moving target can be grabbed by a fair aim rather than a perfect one. */
const HOOK_CATCH = 0.55;
function hookCatch(a, o, d, maxT) {
  let best = null, bt = maxT;
  for (const v of S.actors) {
    if (v === a || !v.alive || !v.heard || !isEnemy(a, v)) continue;
    for (const bi of [BI.chest, BI.pelvis]) {
      const px = v.bones[bi * 3] - o[0], py = v.bones[bi * 3 + 1] - o[1], pz = v.bones[bi * 3 + 2] - o[2];
      const t = px * d[0] + py * d[1] + pz * d[2];
      if (t < 0 || t > bt) continue;
      const qx = px - d[0] * t, qy = py - d[1] * t, qz = pz - d[2] * t;
      if (qx * qx + qy * qy + qz * qz <= HOOK_CATCH * HOOK_CATCH) { best = v; bt = t; }
    }
  }
  return best;
}
function flyHook(a, dt) {
  const b = a.body, step = PM.hookSpeed * dt;
  const o = [b.hx, b.hy, b.hz], d = [b.hdx, b.hdy, b.hdz];
  const h = castRay(a, o, d, step);
  b.hookT += dt;
  const caught = h.actor || hookCatch(a, o, d, h.t);
  if (caught) {
    h.actor = caught;
    b.hook = HOOK.ON; b.hTarget = h.actor.id;
    const i = BI.chest * 3;
    b.hx = h.actor.bones[i]; b.hy = h.actor.bones[i + 1]; b.hz = h.actor.bones[i + 2];
    attached(b);
    b.ev.push("hookgrab");
    emit("hooked", a, h.actor);
  } else if (h.t < step - 1e-6 && h.world) {
    if (h.kind === "clip") { hookOff(a, "hookmiss"); return; }
    b.hook = HOOK.ON; b.hTarget = -1;
    b.hx = h.x; b.hy = h.y; b.hz = h.z;
    attached(b);
    b.ev.push("hookhit");
  } else {
    b.hx += b.hdx * step; b.hy += b.hdy * step; b.hz += b.hdz * step;
    if (b.hookT * PM.hookSpeed > PM.hookRange) hookOff(a, "hookmiss");
  }
}
function attached(b) {
  b.hookT = 0; b.hookBlocked = 0;
  b.hLen = b.hStart = Math.hypot(b.hx - b.x, b.hy - (b.y + 0.9), b.hz - b.z);
  b.hFrom = Math.hypot(b.vx, b.vy, b.vz);
}
function holdHook(a, dt) {
  const b = a.body;
  b.hookT += dt;
  if (b.hTarget >= 0) {
    const t = actorById(b.hTarget);
    if (!t || !t.alive) { hookOff(a, "hookoff"); return; }
    const i = BI.chest * 3;
    b.hx = t.bones[i]; b.hy = t.bones[i + 1]; b.hz = t.bones[i + 2];
  }
  // the rope cannot pass through the level: a quarter of a second cut off and it lets go
  const cx = b.x, cy = b.y + 0.9, cz = b.z;
  const dx = b.hx - cx, dy = b.hy - cy, dz = b.hz - cz, l = Math.hypot(dx, dy, dz) || 1;
  const back = Math.min(0.3, l * 0.5) / l;
  ray(world(), cx, cy, cz, b.hx - dx * back, b.hy - dy * back, b.hz - dz * back, HTR);
  b.hookBlocked = HTR.fraction < 1 ? (b.hookBlocked || 0) + dt : 0;
  if (b.hookBlocked > 0.25 || b.hookT > 8) hookOff(a, "hookoff");
}
function hookOff(a, ev) {
  const b = a.body;
  if (b.hook === HOOK.IDLE) return;
  b.hook = HOOK.IDLE; b.hTarget = -1;
  b.hookCd = ev === "hookmiss" ? PM.hookCooldown * 0.5 : PM.hookCooldown;
  b.ev.push(ev);
}
/** Is somebody's hook in this body? Then where it is pulled to this tick (their middle), else null. */
function yankOf(a) {
  for (const x of S.actors) {
    if (x === a || !x.alive || x.body.hook !== HOOK.ON || x.body.hTarget !== a.id || !isEnemy(x, a)) continue;
    return [x.body.x, x.body.y + 0.9, x.body.z];
  }
  return null;
}

/* ---------------------------------------------------------------
   Blades
   --------------------------------------------------------------- */
function inCone(a, b, dir, reach, coneDeg) {
  const e = eyeOf(a);
  const cx = b.body.x - e[0], cy = b.body.y + 1.1 - e[1], cz = b.body.z - e[2];
  const dist = Math.hypot(cx, cy, cz);
  if (dist > reach + 0.4) return false;
  if (dist < 0.6) return true;
  const c = (cx * dir[0] + cy * dir[1] + cz * dir[2]) / dist;
  return c >= Math.cos(coneDeg * Math.PI / 180);
}
/* A blade hits harder the faster you are going when it lands (weapons.js speedBonus). */
const speedOf = (a) => Math.hypot(a.body.vx, a.body.vy, a.body.vz);
function swingHit(a) {
  const m = MELEE[a.arms.melee];
  const dir = lookDir(a.body.yaw, a.body.pitch);
  const k = speedBonus(speedOf(a));
  for (const b of S.actors) {
    if (b === a || !b.alive || !isEnemy(a, b)) continue;
    if (inCone(a, b, dir, m.swingReach, m.swingCone)) hitActor(b, m.swingDmg * k, a, { weapon: m.id, part: "body", melee: true, speedMul: k, air: airborne(b) });
  }
}
function lungeHit(a) {
  const m = MELEE[a.arms.melee];
  const body = a.body;
  for (const b of S.actors) {
    if (b === a || !b.alive || a.lungeHits.has(b.id) || !isEnemy(a, b)) continue;
    if (inCone(a, b, body.lungeDir, m.lungeReach, m.lungeCone)) {
      a.lungeHits.add(b.id);
      const k = speedBonus(speedOf(a));
      hitActor(b, m.lungeDmg * (0.4 + 0.6 * Math.min(1, body.lungePower / 0.8)) * k, a, { weapon: m.id, part: "body", melee: true, lunge: true, speedMul: k, air: airborne(b) });
    }
  }
}

/* ---------------------------------------------------------------
   Damage and death
   --------------------------------------------------------------- */
/** `a` hit `b` for `dmg`. Applied here if b's truth is ours; sent to its owner if not. */
export function hitActor(b, dmg, a, info) {
  if (!b.alive || dmg <= 0) return;
  dmg = Math.round(dmg * 10) / 10;
  emit("hit", a, b, dmg, info);
  if (owns(b)) applyDamage(b, dmg, a ? a.id : null, info);
  else emit("netHit", b, dmg, a ? a.id : null, info);
}
export function applyDamage(b, dmg, byId, info) {
  if (!b.alive) return;
  if (S.match && S.match.mode === "practice" && b.kind === "local") return;   // practice: dummies cannot hurt you
  b.hp -= dmg;
  b.lastHurt = S.time;
  b.lastAttacker = byId;
  emit("hurt", b, dmg, byId, info);
  if (b.hp <= 0) die(b, byId, info);
}
export function die(b, byId, info) {
  if (!b.alive) return;
  b.alive = false; b.hp = 0;
  b.respawnT = S.match && S.match.mode === "practice" ? 1.2 : RESPAWN_S;
  b.body.vx = b.body.vy = b.body.vz = 0;
  b.body.lunge = LUNGE.IDLE; b.body.lungeStuck = false;
  b.body.hook = HOOK.IDLE; b.body.hTarget = -1;
  // nobody looks down a scope from the grave: the death camera starts from a plain view
  if (b.arms) { b.arms.ads = 0; b.arms.zoom = 0; b.arms.reloadT = 0; }
  emit("died", b, byId, info || {});
  if (S.net.role !== "client") scoreKill(b.id, byId, info || {});
}

/** Host or solo: count a death, tell everyone, and end the match if it is won. */
export function scoreKill(victim, killer, info) {
  const M = S.match;
  if (!M) return;
  const teamOf = (id) => { const x = actorById(id); return x ? x.team : 0; };
  const res = recordKill(M.score, M.mode, teamOf, victim, killer);
  const news = { v: victim, k: killer, w: info.weapon || "", h: info.part === "head" ? 1 : 0, n: info.part === "nut" ? 1 : 0, sc: M.score };
  killNews(news);
  emit("killScored", news);
  if (res.over) endMatch(res.winner);
}
/** Everyone: somebody died (a client hears this from the host). */
export function killNews(n) {
  const M = S.match;
  if (!M) return;
  if (n.sc) M.score = n.sc;
  for (const a of S.actors) { a.kills = M.score.k[a.id] || 0; a.deaths = M.score.d[a.id] || 0; }
  const v = actorById(n.v), k = n.k != null ? actorById(n.k) : null;
  if (v) { v.lastStreak = v.streak || 0; v.streak = 0; }
  if (k && k !== v) k.streak = (k.streak || 0) + 1;
  // a streak ended here, and how long it was, for the announcer (medals.js)
  emit("killfeed", { victim: v, killer: k, weapon: n.w, head: !!n.h, nut: !!n.n, ended: v ? v.lastStreak || 0 : 0 });
  emit("scoreChanged", M.score);
}

/* ---------------------------------------------------------------
   Per frame: puppets and interpolation
   --------------------------------------------------------------- */
/** Where to draw a body this frame: between its last two ticks. */
export function renderPos(a, alpha) {
  if (!owns(a)) return [a.body.x, a.body.y, a.body.z];
  return [a.px + (a.body.x - a.px) * alpha, a.py + (a.body.y - a.py) * alpha, a.pz + (a.body.z - a.pz) * alpha];
}

export { TICK };

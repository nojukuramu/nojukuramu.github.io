/* movement.js — how a body moves: Source's player movement, and Apex's on top.
 *
 * The core is a port of the released Source SDK's gamemovement.cpp (which is
 * Quake's pmove grown up): Friction, Accelerate, AirAccelerate with its 30
 * unit cap, TryPlayerMove's clip-and-slide against up to five planes,
 * StepMove, StayOnGround and CategorizePosition, in that order, once per tick.
 * Nothing in here says "bunny hop" or "air strafe" or "surf". They are what
 * that code does when somebody plays it well:
 *
 *   - Bunny hop.   Friction only runs on a tick that starts on the ground.
 *                  Jump on the tick you land and it never runs at all.
 *   - Air strafe.  In the air, acceleration is capped along the direction
 *                  you are asking for, not along the one you are going. Ask
 *                  for a direction almost at right angles to your velocity —
 *                  hold A or D and turn with the mouse — and every tick adds
 *                  a sliver of speed that the cap never sees.
 *   - Surf.        A slope steeper than 45 degrees is not ground. You are in
 *                  the air on it, the slope clips your fall into sideways
 *                  speed, and there is no friction to take it away.
 *
 * Two small mercies over Source, both so the techniques are learnable on a
 * phone and a 60 Hz screen without being automatic: a jump pressed on the
 * tick before landing is remembered for that one tick, and the first tick on
 * the ground has no friction either. Holding jump never hops — Source's
 * "fresh press" rule is kept, which is exactly what a bhop hack is for.
 *
 * On top of Source, the Apex-style moves: sprint, crouch-slide (downhill
 * speeds it up), wall climb (jump into a wall and hold), wall jump (tap jump
 * beside a wall; your speed along the wall is kept), and the melee lunge
 * (hold to stick to whatever surface you touch, release to launch where you
 * look — harder the more squarely you face away from the surface).
 *
 * Units are metres and seconds. One Source unit is an inch; where a constant
 * below is Source's, its original value is in the comment.
 *
 * Pure: bodies, commands and a brush world in, bodies out. The game, the
 * bots, the hack worker's movement prediction and tools/validate.js all run
 * this same file. */

import { trace, newTrace } from "./brush.js";

export const TICK = 1 / 64;

/** Buttons in a command, one bit each. Players, bots and hacks all make these. */
export const B = { JUMP: 1, CROUCH: 2, SPRINT: 4, FIRE: 8, ADS: 16, RELOAD: 32, MELEE: 64, LUNGE: 128 };

export const PM = {
  gravity: 19,            // sv_gravity 800 u/s²
  jump: 6.4,              // ~1.08 m, a touch under Source's 45 units
  run: 5.4,               // cl_forwardspeed, scaled to Apex's jog
  sprint: 7.4,            // Apex's sprint
  crouch: 2.6,
  accelerate: 10,         // sv_accelerate 10 (HL2)
  airaccelerate: 12,      // sv_airaccelerate 12 (CS:GO)
  aircap: 0.76,           // the 30 u/s cap in AirAccelerate
  friction: 6,            // sv_friction 4–5.2
  stopspeed: 2.5,         // sv_stopspeed 100 u/s
  maxvelocity: 60,        // sv_maxvelocity 3500 u/s
  stepsize: 0.45,         // 18 units
  walkable: 0.7,          // a surface flatter than this is ground; steeper is a ramp to surf
  standHeight: 1.8,
  crouchHeight: 1.2,
  halfWidth: 0.4,
  eyeStand: 1.62,
  eyeCrouch: 1.02,
  jumpBuffer: 1.5 / 64,   // the one-tick mercy before landing
  slideStart: 5.8,        // slower than this and crouch is only crouch
  slideBoost: 2.0,
  slideBoostCap: 10,
  slideCooldown: 1.8,
  slideFriction: 0.35,    // proportional, per second: on the flat a boosted slide lasts about two seconds
  slideDrag: 1.0,         // m/s² on top, so a slide on the flat ends; on a slope of ~13° it holds ~9 m/s
  slideEnd: 3.2,
  climbSpeed: 5.0,
  climbTime: 0.9,
  mantle: 4.8,
  wallPush: 5.5,
  wallUp: 6.0,
  wallCooldown: 0.18,
  wallReach: 0.35,
  lungeTap: 0.18,         // released sooner than this, a lunge is a swing
  lungeStick: 0.3,        // how near a surface must be to stick to it
  lungeMaxHold: 4,
  lungeCooldown: 0.5
};

const L_IDLE = 0, L_CHARGE = 1, L_DASH = 2;
export const LUNGE = { IDLE: L_IDLE, CHARGE: L_CHARGE, DASH: L_DASH };

export function newBody(x, y, z, yaw) {
  return {
    x: x || 0, y: y || 0, z: z || 0, vx: 0, vy: 0, vz: 0,
    yaw: yaw || 0, pitch: 0,
    onGround: false, gnx: 0, gny: 1, gnz: 0, groundKind: "", groundTicks: -1,
    crouched: false, eye: PM.eyeStand, sprinting: false,
    sliding: false, slideCd: 0,
    climbing: false, climbBudget: PM.climbTime,
    wallCd: 0, lastWall: null,
    jumpHeld: false, jumpBuf: 0, crouchHeld: false,
    lunge: L_IDLE, lungeT: 0, lungeCharge: 0, lungeStuck: false, lnx: 0, lny: 0, lnz: 0, lungeHeld: false, lungeCd: 0, lungePower: 0,
    lungeDir: [0, 0, 0],
    // what a hack may change about its own body (see hackapi.js)
    gravityScale: 1, speedScale: 1, jumpScale: 1,
    ev: []
  };
}

/* ---------------------------------------------------------------
   Small helpers
   --------------------------------------------------------------- */
const TR = newTrace();
const halfH = (p) => (p.crouched ? PM.crouchHeight : PM.standHeight) / 2;
/** Sweep the body's box from feet position a to b. TR.x/y/z come back as the box centre. */
function sweep(W, p, x0, y0, z0, x1, y1, z1) {
  const h = halfH(p);
  return trace(W, x0, y0 + h, z0, x1, y1 + h, z1, PM.halfWidth, h, PM.halfWidth, TR);
}
function sweepH(W, h, x0, y0, z0, x1, y1, z1) {
  return trace(W, x0, y0 + h, z0, x1, y1 + h, z1, PM.halfWidth, h, PM.halfWidth, TR);
}
export function forward(yaw) { return [-Math.sin(yaw), 0, -Math.cos(yaw)]; }
export function right(yaw) { return [Math.cos(yaw), 0, -Math.sin(yaw)]; }
export function lookDir(yaw, pitch) { const c = Math.cos(pitch); return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c]; }
export const hspeed = (p) => Math.hypot(p.vx, p.vz);
export const eyeY = (p) => p.y + p.eye;

/* Source's ClipVelocity, in place on the body. */
const STOP_EPS = 0.0025;
function clipVel(p, nx, ny, nz, over) {
  const back = (p.vx * nx + p.vy * ny + p.vz * nz) * over;
  p.vx -= nx * back; p.vy -= ny * back; p.vz -= nz * back;
  const adj = p.vx * nx + p.vy * ny + p.vz * nz;
  if (adj < 0) { p.vx -= nx * adj; p.vy -= ny * adj; p.vz -= nz * adj; }
  if (p.vx > -STOP_EPS && p.vx < STOP_EPS) p.vx = 0;
  if (p.vy > -STOP_EPS && p.vy < STOP_EPS) p.vy = 0;
  if (p.vz > -STOP_EPS && p.vz < STOP_EPS) p.vz = 0;
}

/* ---------------------------------------------------------------
   TryPlayerMove: move, and where blocked, slide along what blocked you
   --------------------------------------------------------------- */
const planes = new Float64Array(15);
function slideMove(W, p, dt) {
  let np = 0, tl = dt;
  const px = p.vx, py = p.vy, pz = p.vz;               // primal velocity
  let ox = p.vx, oy = p.vy, oz = p.vz;                  // original velocity
  let blocked = 0;
  const h = halfH(p);
  for (let bump = 0; bump < 4; bump++) {
    if (p.vx === 0 && p.vy === 0 && p.vz === 0) break;
    sweep(W, p, p.x, p.y, p.z, p.x + p.vx * tl, p.y + p.vy * tl, p.z + p.vz * tl);
    if (TR.allsolid) { p.vx = p.vy = p.vz = 0; return 3; }
    if (TR.fraction > 0) { p.x = TR.x; p.y = TR.y - h; p.z = TR.z; ox = p.vx; oy = p.vy; oz = p.vz; np = 0; }
    if (TR.fraction === 1) break;
    if (TR.ny > PM.walkable) blocked |= 1;
    if (TR.ny === 0) blocked |= 2;
    tl -= tl * TR.fraction;
    if (np >= 5) { p.vx = p.vy = p.vz = 0; break; }
    planes[np * 3] = TR.nx; planes[np * 3 + 1] = TR.ny; planes[np * 3 + 2] = TR.nz; np++;
    if (np === 1 && !p.onGround) {
      p.vx = ox; p.vy = oy; p.vz = oz;
      clipVel(p, TR.nx, TR.ny, TR.nz, 1);
      ox = p.vx; oy = p.vy; oz = p.vz;
    } else {
      let i;
      for (i = 0; i < np; i++) {
        p.vx = ox; p.vy = oy; p.vz = oz;
        clipVel(p, planes[i * 3], planes[i * 3 + 1], planes[i * 3 + 2], 1);
        let j;
        for (j = 0; j < np; j++) if (j !== i && p.vx * planes[j * 3] + p.vy * planes[j * 3 + 1] + p.vz * planes[j * 3 + 2] < 0) break;
        if (j === np) break;
      }
      if (i === np) {
        // wedged between two planes: go along the crease
        if (np !== 2) { p.vx = p.vy = p.vz = 0; break; }
        let cx = planes[1] * planes[5] - planes[2] * planes[4];
        let cy = planes[2] * planes[3] - planes[0] * planes[5];
        let cz = planes[0] * planes[4] - planes[1] * planes[3];
        const l = Math.hypot(cx, cy, cz) || 1; cx /= l; cy /= l; cz /= l;
        const d = cx * p.vx + cy * p.vy + cz * p.vz;
        p.vx = cx * d; p.vy = cy * d; p.vz = cz * d;
      }
      // turned back on ourselves: stop dead, rather than jitter in a corner
      if (p.vx * px + p.vy * py + p.vz * pz <= 0) { p.vx = p.vy = p.vz = 0; break; }
    }
  }
  return blocked;
}

/* StepMove: slide along the ground, or step up and over, whichever goes further. */
function stepMove(W, p, dt) {
  const x0 = p.x, y0 = p.y, z0 = p.z, vx0 = p.vx, vy0 = p.vy, vz0 = p.vz;
  const h = halfH(p);
  slideMove(W, p, dt);
  const dx = p.x, dy = p.y, dz = p.z, dvx = p.vx, dvy = p.vy, dvz = p.vz;
  p.x = x0; p.y = y0; p.z = z0; p.vx = vx0; p.vy = vy0; p.vz = vz0;
  sweep(W, p, x0, y0, z0, x0, y0 + PM.stepsize, z0);
  if (!TR.startsolid && !TR.allsolid) p.y = TR.y - h;
  slideMove(W, p, dt);
  sweep(W, p, p.x, p.y, p.z, p.x, p.y - PM.stepsize - 0.001, p.z);
  if (!TR.startsolid && !TR.allsolid) p.y = TR.y - h;
  if (TR.fraction < 1 && TR.ny < PM.walkable) {
    p.x = dx; p.y = dy; p.z = dz; p.vx = dvx; p.vy = dvy; p.vz = dvz;
    return;
  }
  const up = (p.x - x0) ** 2 + (p.z - z0) ** 2, down = (dx - x0) ** 2 + (dz - z0) ** 2;
  if (down > up) { p.x = dx; p.y = dy; p.z = dz; p.vx = dvx; p.vy = dvy; p.vz = dvz; }
  else p.vy = dvy;
}

/* StayOnGround: walking down a slope or a step keeps your feet on it. */
function stayOnGround(W, p) {
  const h = halfH(p);
  sweep(W, p, p.x, p.y, p.z, p.x, p.y + 0.05, p.z);
  const sy = TR.y - h;
  sweep(W, p, p.x, sy, p.z, p.x, p.y - PM.stepsize, p.z);
  if (TR.fraction > 0 && TR.fraction < 1 && !TR.startsolid && TR.ny >= PM.walkable) {
    const ny = TR.y - h;
    if (Math.abs(p.y - ny) > 0.0005) p.y = ny;
  }
}

/* ---------------------------------------------------------------
   Friction, acceleration
   --------------------------------------------------------------- */
function friction(p, dt) {
  const speed = Math.hypot(p.vx, p.vy, p.vz);
  if (speed < 0.01) return;
  const control = speed < PM.stopspeed ? PM.stopspeed : speed;
  const drop = control * PM.friction * dt;
  const ns = Math.max(0, speed - drop) / speed;
  p.vx *= ns; p.vy *= ns; p.vz *= ns;
}
function accelerate(p, wx, wz, wishspeed, accel, dt) {
  const cur = p.vx * wx + p.vz * wz;
  const add = wishspeed - cur;
  if (add <= 0) return;
  let a = accel * dt * wishspeed;
  if (a > add) a = add;
  p.vx += a * wx; p.vz += a * wz;
}
function airAccelerate(p, wx, wz, wishspeed, accel, dt) {
  const capped = wishspeed > PM.aircap ? PM.aircap : wishspeed;
  const cur = p.vx * wx + p.vz * wz;
  const add = capped - cur;
  if (add <= 0) return;
  let a = accel * wishspeed * dt;       // the uncapped speed, as Source has it
  if (a > add) a = add;
  p.vx += a * wx; p.vz += a * wz;
}

/** The direction and speed a command asks for, flat on the ground. */
function wish(p, cmd, maxspeed) {
  const f = forward(p.yaw), r = right(p.yaw);
  const fm = clamp1(cmd.fwd), sm = clamp1(cmd.side);
  let wx = f[0] * fm + r[0] * sm, wz = f[2] * fm + r[2] * sm;
  const l = Math.hypot(wx, wz);
  if (l < 1e-6) return [0, 0, 0];
  const speed = Math.min(1, l) * maxspeed;
  return [wx / l, wz / l, speed];
}
const clamp1 = (v) => (typeof v === "number" && isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);

export function maxSpeed(p, o) {
  const base = p.sprinting ? PM.sprint : p.crouched ? PM.crouch : PM.run;
  return base * (o && o.speedMul ? o.speedMul : 1) * p.speedScale;
}

/* ---------------------------------------------------------------
   Ducking, sliding
   --------------------------------------------------------------- */
const DH = PM.standHeight - PM.crouchHeight;
function duck(W, p, want) {
  if (want && !p.crouched) {
    if (p.onGround) { p.crouched = true; }
    else {
      // In the air a crouch pulls your feet up, and your head stays put.
      p.crouched = true;
      p.y += DH; p.eye -= DH;
      if (sweep(W, p, p.x, p.y, p.z, p.x, p.y, p.z).startsolid) { p.y -= DH; p.eye += DH; }
    }
  } else if (!want && p.crouched) {
    const hs = PM.standHeight / 2;
    if (p.onGround) {
      if (!sweepH(W, hs, p.x, p.y, p.z, p.x, p.y, p.z).startsolid) { p.crouched = false; p.sliding = false; }
    } else if (!sweepH(W, hs, p.x, p.y - DH, p.z, p.x, p.y - DH, p.z).startsolid) {
      p.crouched = false; p.y -= DH; p.eye += DH;
    } else if (!sweepH(W, hs, p.x, p.y, p.z, p.x, p.y, p.z).startsolid) {
      p.crouched = false;
    }
  }
}
function startSlide(p, boost) {
  const s = hspeed(p);
  if (s < PM.slideStart) return false;
  p.sliding = true;
  if (boost && p.slideCd <= 0 && s < PM.slideBoostCap) {
    const k = (s + PM.slideBoost) / s;
    p.vx *= k; p.vz *= k;
    p.slideCd = PM.slideCooldown;
  }
  p.ev.push("slide");
  return true;
}
function slideTick(p, cmd, dt) {
  const s = hspeed(p);
  // gravity along the slope: nothing on the flat, a push down any hill
  const g = PM.gravity * p.gravityScale;
  p.vx += g * p.gnx * p.gny * dt;
  p.vz += g * p.gnz * p.gny * dt;
  if (s > 0.01) {
    const ns = Math.max(0, s - (s * PM.slideFriction + PM.slideDrag) * dt) / s;
    p.vx *= ns; p.vz *= ns;
  }
  const w = wish(p, cmd, 1.2);
  if (w[2] > 0) accelerate(p, w[0], w[1], w[2], 6, dt);
  if (hspeed(p) < PM.slideEnd) p.sliding = false;
}

/* ---------------------------------------------------------------
   Walls: what is in front, what is beside
   --------------------------------------------------------------- */
const wallN = [0, 0, 0];
function wallAhead(W, p) {
  const f = forward(p.yaw);
  const y = p.y + (p.crouched ? 0.8 : 1.1);
  trace(W, p.x, y, p.z, p.x + f[0] * (PM.halfWidth + 0.45), y, p.z + f[2] * (PM.halfWidth + 0.45), 0.15, 0.15, 0.15, TR);
  if (TR.fraction < 1 && Math.abs(TR.ny) < 0.35 && -(f[0] * TR.nx + f[2] * TR.nz) > 0.55) {
    wallN[0] = TR.nx; wallN[1] = TR.ny; wallN[2] = TR.nz;
    return wallN;
  }
  return null;
}
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, 0.7071], [-0.7071, -0.7071]];
function wallBeside(W, p) {
  let best = 2, bn = null;
  const r = PM.wallReach;
  for (const d of DIRS8) {
    sweep(W, p, p.x, p.y, p.z, p.x + d[0] * r, p.y, p.z + d[1] * r);
    if (TR.fraction < best && TR.fraction < 1 && !TR.startsolid && Math.abs(TR.ny) < 0.35) { best = TR.fraction; bn = [TR.nx, TR.ny, TR.nz]; }
  }
  return bn;
}
function tryWallJump(W, p) {
  if (p.wallCd > 0 || p.lunge !== L_IDLE) return false;
  const n = wallBeside(W, p);
  if (!n) return false;
  const hl = Math.hypot(n[0], n[2]) || 1, nx = n[0] / hl, nz = n[2] / hl;
  const plane = p.x * nx + p.z * nz;
  // the same wall twice in a row is a ladder, not a technique
  if (p.lastWall && p.lastWall[0] * nx + p.lastWall[1] * nz > 0.95 && Math.abs(plane - p.lastWall[2]) < 0.8) return false;
  const vn = p.vx * nx + p.vz * nz;
  const tx = p.vx - vn * nx, tz = p.vz - vn * nz;
  const out = Math.max(vn, 0) + PM.wallPush;
  p.vx = tx + nx * out; p.vz = tz + nz * out;
  p.vy = Math.max(p.vy, PM.wallUp * p.jumpScale);
  p.wallCd = PM.wallCooldown;
  p.lastWall = [nx, nz, plane];
  p.climbing = false;
  p.ev.push("walljump");
  return true;
}

/* ---------------------------------------------------------------
   The lunge
   --------------------------------------------------------------- */
const STICK_DIRS = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]];
function stick(W, p) {
  if (p.onGround) return setStuck(p, p.gnx, p.gny, p.gnz);
  const h = halfH(p);
  let best = 2, bx = 0, by = 0, bz = 0, n = null;
  const dirs = STICK_DIRS.slice();
  const s = Math.hypot(p.vx, p.vy, p.vz);
  if (s > 0.5) dirs.push([p.vx / s, p.vy / s, p.vz / s]);
  for (const d of dirs) {
    sweep(W, p, p.x, p.y, p.z, p.x + d[0] * PM.lungeStick, p.y + d[1] * PM.lungeStick, p.z + d[2] * PM.lungeStick);
    if (TR.fraction < 1 && !TR.startsolid && TR.fraction < best) { best = TR.fraction; n = [TR.nx, TR.ny, TR.nz]; bx = TR.x; by = TR.y - h; bz = TR.z; }
  }
  if (!n) return false;
  p.x = bx; p.y = by; p.z = bz;
  return setStuck(p, n[0], n[1], n[2]);
}
function setStuck(p, nx, ny, nz) {
  p.lungeStuck = true; p.lnx = nx; p.lny = ny; p.lnz = nz;
  p.vx = p.vy = p.vz = 0;
  p.sliding = false; p.climbing = false;
  p.ev.push("stick");
  return true;
}
/**
 * How hard a lunge launches, 0..1, before the weapon's own speed: the charge,
 * and how squarely you look away from the surface you are stuck to. Looking
 * into the surface skims along it, weakly. Exported for the HUD, the hack API
 * and the checks, so all three agree with the launch itself.
 */
export function lungeFactor(charge, stuck, nx, ny, nz, dir) {
  const c = 0.35 + 0.65 * Math.max(0, Math.min(1, charge));
  if (!stuck) return c * 0.45;
  const perp = dir[0] * nx + dir[1] * ny + dir[2] * nz;
  return c * (perp <= 0 ? 0.3 : 0.3 + 0.7 * perp);
}
function release(W, p, m) {
  const tap = p.lungeT < PM.lungeTap;
  const stuck = p.lungeStuck;
  p.lungeStuck = false;
  if (tap) { p.lunge = L_IDLE; p.ev.push("swing"); return; }
  let dir = lookDir(p.yaw, p.pitch);
  const f = lungeFactor(p.lungeCharge, stuck, p.lnx, p.lny, p.lnz, dir);
  if (stuck) {
    const perp = dir[0] * p.lnx + dir[1] * p.lny + dir[2] * p.lnz;
    if (perp < 0) {
      // looking into the surface: skim along it instead of through it
      const d = [dir[0] - p.lnx * perp, dir[1] - p.lny * perp, dir[2] - p.lnz * perp];
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      dir = [d[0] / l, d[1] / l, d[2] / l];
    }
  }
  const spd = m.speed * f;
  if (stuck) { p.vx = dir[0] * spd; p.vy = dir[1] * spd; p.vz = dir[2] * spd; }
  else { p.vx = p.vx * 0.5 + dir[0] * spd; p.vy = p.vy * 0.5 + dir[1] * spd; p.vz = p.vz * 0.5 + dir[2] * spd; }
  p.lunge = L_DASH; p.lungeT = m.dash; p.lungePower = f;
  p.lungeDir = dir;
  if (p.vy > 0.5) p.onGround = false;
  p.ev.push("lunge");
}
function lungeInput(W, p, held, dt, m) {
  if (p.lunge === L_IDLE) {
    if (held && !p.lungeHeld && p.lungeCd <= 0 && m) {
      p.lunge = L_CHARGE; p.lungeT = 0; p.lungeCharge = 0; p.lungeStuck = false;
      stick(W, p);
    }
  } else if (p.lunge === L_CHARGE) {
    p.lungeT += dt;
    p.lungeCharge = Math.min(1, p.lungeT / m.charge);
    if (!p.lungeStuck) stick(W, p);
    if (!held || p.lungeT > PM.lungeMaxHold) release(W, p, m);
  } else if (p.lunge === L_DASH) {
    p.lungeT -= dt;
    if (p.lungeT <= 0) { p.lunge = L_IDLE; p.lungeCd = PM.lungeCooldown; }
  }
  p.lungeHeld = held;
}

/* ---------------------------------------------------------------
   CategorizePosition
   --------------------------------------------------------------- */
function categorize(W, p) {
  const was = p.onGround;
  const h = halfH(p);
  if (p.vy > 3.5) p.onGround = false;               // Source: moving up faster than 140 u/s
  else {
    sweep(W, p, p.x, p.y, p.z, p.x, p.y - 0.06, p.z);
    if (TR.fraction < 1 && TR.ny >= PM.walkable && !TR.allsolid) {
      p.onGround = true;
      p.gnx = TR.nx; p.gny = TR.ny; p.gnz = TR.nz;
      p.groundKind = TR.brush ? TR.brush.kind : "";
      p.groundBrush = TR.brush;
      if (!TR.startsolid) p.y = TR.y - h;
    } else p.onGround = false;
  }
  if (p.onGround && !was) {
    p.landSpeed = -p.vy;
    if (p.vy < 0) p.vy = 0;
    p.groundTicks = 0;
    p.climbBudget = PM.climbTime;
    p.lastWall = null;
    p.climbing = false;
    p.ev.push("land");
  } else if (p.onGround) p.groundTicks++;
  else p.groundTicks = -1;
}

/* ---------------------------------------------------------------
   One tick
   --------------------------------------------------------------- */
/**
 * Move a body by one command.
 *   cmd: { fwd, side (-1..1), yaw, pitch (radians), buttons (B bits) }
 *   o:   { melee: { charge, speed, dash } | null, speedMul, noSprint }
 */
export function pmove(W, p, cmd, dt, o) {
  o = o || {};
  const btn = cmd.buttons | 0;
  p.yaw = isFinite(cmd.yaw) ? cmd.yaw : p.yaw;
  p.pitch = isFinite(cmd.pitch) ? Math.max(-1.55, Math.min(1.55, cmd.pitch)) : p.pitch;
  const jump = !!(btn & B.JUMP);
  if (jump && !p.jumpHeld) p.jumpBuf = PM.jumpBuffer;
  p.jumpHeld = jump;
  const crouch = !!(btn & B.CROUCH);
  const crouchEdge = crouch && !p.crouchHeld;
  p.crouchHeld = crouch;
  p.slideCd = Math.max(0, p.slideCd - dt);
  p.wallCd = Math.max(0, p.wallCd - dt);
  p.lungeCd = Math.max(0, p.lungeCd - dt);
  const g = PM.gravity * p.gravityScale;

  // The eye follows a crouch smoothly; a crouch in the air already moved it.
  const eyeT = p.crouched ? PM.eyeCrouch : PM.eyeStand;
  p.eye += (eyeT - p.eye) * Math.min(1, dt * 14);

  if (sweep(W, p, p.x, p.y, p.z, p.x, p.y, p.z).startsolid) unstick(W, p);
  lungeInput(W, p, !!(btn & B.LUNGE), dt, o.melee);
  if (p.lunge === L_CHARGE && p.lungeStuck) {
    // Stuck to a surface: nothing moves until you let go.
    p.vx = p.vy = p.vz = 0; p.jumpBuf = 0; p.sprinting = false;
    return;
  }

  duck(W, p, crouch);
  if (p.onGround && crouchEdge && !p.sliding && p.crouched) startSlide(p, true);
  if (!crouch) p.sliding = false;
  p.sprinting = !!(btn & B.SPRINT) && !o.noSprint && cmd.fwd > 0.3 && !p.crouched && p.lunge === L_IDLE;

  const dash = p.lunge === L_DASH;
  const gk = dash ? 0.3 : 1;
  if (!p.onGround && !p.climbing) p.vy -= g * gk * 0.5 * dt;

  // Jump: off the ground, off a wall, or held for a landing one tick away.
  if (p.jumpBuf > 0 && p.lunge !== L_CHARGE) {
    if (p.onGround) {
      p.vy = PM.jump * p.jumpScale;
      p.onGround = false; p.groundTicks = -1;
      p.sliding = false;
      p.jumpBuf = 0;
      p.ev.push("jump");
    } else if (!p.climbing && p.jumpBuf === PM.jumpBuffer && !(cmd.fwd > 0.5 && wallAhead(W, p)) && tryWallJump(W, p)) p.jumpBuf = 0;
    // (facing a wall and pushing into it is the start of a climb, not a kick off it)
  }
  p.jumpBuf = Math.max(0, p.jumpBuf - dt);

  // Wall climb: in the air, into a wall, holding jump and forward.
  if (!p.onGround && !p.climbing && jump && cmd.fwd > 0.5 && p.climbBudget > 0.05 && p.vy > -8 && p.lunge === L_IDLE && wallAhead(W, p)) {
    p.climbing = true;
    p.ev.push("climb");
  }
  if (p.climbing) {
    const n = wallAhead(W, p);
    if (!jump || cmd.fwd <= 0.3 || p.climbBudget <= 0 || p.onGround) {
      p.climbing = false;
      if (p.vy > 2) p.vy = 2;
    } else if (!n) {
      // over the top: pop up and forward onto the ledge
      const f = forward(p.yaw);
      p.climbing = false;
      p.vy = PM.mantle;
      p.vx = f[0] * 3.2; p.vz = f[2] * 3.2;
      p.ev.push("mantle");
    } else {
      const k = Math.min(1, p.climbBudget / (PM.climbTime * 0.3));
      p.vy = PM.climbSpeed * (0.4 + 0.6 * k);
      const vn = p.vx * n[0] + p.vz * n[2];
      p.vx = (p.vx - vn * n[0]) * 0.8 - n[0];
      p.vz = (p.vz - vn * n[2]) * 0.8 - n[2];
      p.climbBudget -= dt;
    }
  }

  if (p.onGround) {
    p.vy = 0;
    if (p.sliding) slideTick(p, cmd, dt);
    else if (!dash && p.groundTicks > 0) friction(p, dt);
    walkMove(W, p, cmd, dt, o);
  } else {
    if (!p.climbing) {
      const w = wish(p, cmd, maxSpeed(p, o));
      if (w[2] > 0) airAccelerate(p, w[0], w[1], w[2], PM.airaccelerate, dt);
    }
    slideMove(W, p, dt);
  }

  const wasGround = p.onGround;
  categorize(W, p);
  if (!p.onGround && !p.climbing) p.vy -= g * gk * 0.5 * dt;
  if (p.onGround && !wasGround && crouch && !p.sliding) { if (!p.crouched) duck(W, p, true); startSlide(p, false); }
  if (!p.onGround && p.sliding) p.sliding = false;

  // Jump pads push whatever lands on them.
  if (p.onGround && p.groundKind === "pad" && p.groundBrush && p.groundBrush.push) {
    const q = p.groundBrush.push;
    p.vx = p.vx * 0.5 + q[0]; p.vy = q[1]; p.vz = p.vz * 0.5 + q[2];
    p.onGround = false; p.groundTicks = -1;
    p.ev.push("pad");
  }

  const s = Math.hypot(p.vx, p.vy, p.vz);
  if (s > PM.maxvelocity) { const k = PM.maxvelocity / s; p.vx *= k; p.vy *= k; p.vz *= k; }
}

function walkMove(W, p, cmd, dt, o) {
  if (!p.sliding) {
    const w = wish(p, cmd, maxSpeed(p, o));
    if (w[2] > 0) accelerate(p, w[0], w[1], w[2], PM.accelerate, dt);
  }
  p.vy = 0;
  const s = hspeed(p);
  if (s < 0.02) { p.vx = p.vz = 0; return; }
  const h = halfH(p);
  sweep(W, p, p.x, p.y, p.z, p.x + p.vx * dt, p.y, p.z + p.vz * dt);
  if (TR.fraction === 1) { p.x = TR.x; p.y = TR.y - h; p.z = TR.z; stayOnGround(W, p); return; }
  stepMove(W, p, dt);
  stayOnGround(W, p);
}

/* Source's CheckStuck, simplified: a body found inside something (a rounding
   error, a teleport from a hack, a door of a crouch) is moved to the nearest
   free spot within a metre, upwards first. */
const NUDGE = [[0, 0.1, 0], [0, 0.3, 0], [0, 0.6, 0], [0.3, 0, 0], [-0.3, 0, 0], [0, 0, 0.3], [0, 0, -0.3], [0, 1, 0], [0.6, 0.3, 0], [-0.6, 0.3, 0], [0, 0.3, 0.6], [0, 0.3, -0.6], [0, -0.3, 0]];
function unstick(W, p) {
  for (const d of NUDGE) {
    if (!sweep(W, p, p.x + d[0], p.y + d[1], p.z + d[2], p.x + d[0], p.y + d[1], p.z + d[2]).startsolid) { p.x += d[0]; p.y += d[1]; p.z += d[2]; return true; }
  }
  return false;
}

/** Put a body somewhere without it being inside anything; false if it would be. */
export function placeBody(W, p, x, y, z) {
  if (sweep(W, p, x, y, z, x, y, z).startsolid) return false;
  p.x = x; p.y = y; p.z = z;
  return true;
}

/** Does a body of this posture fit here? */
export function fits(W, x, y, z, crouched) {
  const h = (crouched ? PM.crouchHeight : PM.standHeight) / 2;
  return !sweepH(W, h, x, y, z, x, y, z).startsolid;
}

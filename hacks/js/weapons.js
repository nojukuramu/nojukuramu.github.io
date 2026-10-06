/* weapons.js — seven guns, two blades, and what a trigger pull does.
 *
 *   Handguns   Wasp P9 (fast semi-auto), Brick .50 (six heavy rounds)
 *   Full auto  Hornet SMG (close, fast), Kestrel AR (the all-rounder)
 *   Shotgun    Mauler (ten pellets, pump)
 *   Snipers    Talon .338 and Condor .50 — the guns whose bullets fly: they
 *              have travel time and drop, so hitting a moving target far away
 *              means leading it. (That is on purpose. It is the lesson in
 *              projectile motion.) The first stretch of the flight is covered
 *              the instant the trigger breaks, so a close shot lands where the
 *              reticle was. Both are bolt actions: every shot is followed by
 *              the bolt being worked, and the scope shakes while it is. The
 *              Condor is heavy: slow to aim, slow to move with, and a hit
 *              anywhere kills. Both scopes have a second, doubled zoom.
 *
 *   Melee      Katana and Lancer. Both lunge (movement.js): hold to stick to
 *              a surface and charge, release to launch. The Katana charges
 *              fast, lunges short and cuts wide; the Lancer charges slowly,
 *              lunges far and hard, and only hits what is in front of its tip.
 *              Either hits harder the faster you are going (speedBonus).
 *
 *   Grapple   The grappling gun, slot 4. It is a gun like the others: draw it
 *              and Fire sends the hook (game.js), held for as long as you want
 *              the rope. It deals no damage and has no magazine; what it
 *              costs is a draw, so you cannot shoot and swing at once.
 *
 * Every round goes through a body into the next one if its gun can (pen:
 * how many bodies, and how much damage it keeps through each) — a collateral.
 *
 * Every other gun is hitscan. Recoil moves your view and does not come back
 * by itself — pulling down against it is the skill, and reading the kick is
 * what a recoil-control hack does. Spread grows while moving, more in the
 * air, and shrinks when aiming down sights.
 *
 * Pure: the arms state machine takes a command and returns what happened;
 * the game resolves where the bullets went. */

const R = Math.PI / 180;

export const GUNS = {
  wasp:    { id: "wasp",    name: "Wasp P9",    cls: "Handgun",    hold: "pistol", auto: false, rpm: 420, dmg: 17, head: 1.9, limb: 0.85, mag: 14, reload: 1.25, spread: [0.9, 0.25], move: 1.0, air: 2.2, bloom: 0.35, recoil: [0.9, 0.35], range: [18, 40, 0.6], speedMul: 1.0, adsZoom: 1.25, adsTime: 0.12, swap: 0.25, pen: [1, 0.35] },
  brick:   { id: "brick",   name: "Brick .50",  cls: "Hand cannon", hold: "pistol", auto: false, rpm: 115, dmg: 52, head: 2.0, limb: 0.8, mag: 6, reload: 2.0, spread: [1.3, 0.1], move: 1.2, air: 3.0, bloom: 0.8, recoil: [4.2, 0.8], range: [25, 60, 0.7], speedMul: 1.0, adsZoom: 1.35, adsTime: 0.14, swap: 0.3, pen: [2, 0.6] },
  hornet:  { id: "hornet",  name: "Hornet SMG", cls: "SMG",        hold: "rifle",  auto: true,  rpm: 900, dmg: 11, head: 1.5, limb: 0.9, mag: 30, reload: 1.6, spread: [1.8, 0.8], move: 0.6, air: 1.2, bloom: 0.08, recoil: [0.55, 0.45], range: [12, 30, 0.55], speedMul: 1.0, adsZoom: 1.3, adsTime: 0.14, swap: 0.3, pen: [1, 0.3] },
  kestrel: { id: "kestrel", name: "Kestrel AR", cls: "Rifle",      hold: "rifle",  auto: true,  rpm: 620, dmg: 15, head: 1.75, limb: 0.9, mag: 28, reload: 2.0, spread: [1.4, 0.25], move: 1.0, air: 2.5, bloom: 0.12, recoil: [0.85, 0.35], range: [30, 70, 0.7], speedMul: 0.95, adsZoom: 1.5, adsTime: 0.18, swap: 0.35, pen: [1, 0.55] },
  mauler:  { id: "mauler",  name: "Mauler",     cls: "Shotgun",    hold: "rifle",  auto: false, rpm: 75,  dmg: 10, pellets: 10, head: 1.5, limb: 0.9, mag: 6, reload: 2.4, spread: [6.5, 5.0], move: 0.5, air: 1.0, bloom: 0, recoil: [5, 1], range: [6, 16, 0.25], speedMul: 0.97, adsZoom: 1.2, adsTime: 0.15, swap: 0.35, pen: [1, 0.2], pump: true },
  talon:   { id: "talon",   name: "Talon .338", cls: "Sniper",     hold: "rifle",  auto: false, rpm: 42,  dmg: 92, head: 2.2, limb: 0.8, mag: 5, reload: 2.8, spread: [6, 0.0], move: 3.0, air: 6.0, bloom: 0, recoil: [6, 1], range: [200, 300, 1], speedMul: 0.88, adsZoom: 4, adsTime: 0.3, swap: 0.45, projectile: { speed: 330, gravity: 9, instant: 40 }, pen: [2, 0.75], scope: true, bolt: 0.55 },
  condor:  { id: "condor",  name: "Condor .50", cls: "Heavy sniper", hold: "rifle", auto: false, rpm: 32, dmg: 150, head: 2.0, limb: 0.75, mag: 4, reload: 3.6, spread: [9, 0.0], move: 4.0, air: 8.0, bloom: 0, recoil: [10, 2], range: [500, 600, 1], speedMul: 0.8, adsZoom: 5, adsTime: 0.42, swap: 0.6, projectile: { speed: 380, gravity: 7, instant: 50 }, pen: [3, 0.85], scope: true, bolt: 1 }
};
/* A shot between the legs: more than the body, less than the head — and it is announced. */
export const NUT = 1.6;
export const GUN_IDS = Object.keys(GUNS);

export const MELEE = {
  katana: { id: "katana", name: "Katana", hold: "melee", charge: 0.45, speed: 18, dash: 0.32, swingDmg: 50, swingReach: 2.3, swingCone: 70, swingCd: 0.5, lungeDmg: 85, lungeReach: 2.2, lungeCone: 75 },
  lancer: { id: "lancer", name: "Lancer", hold: "lance", charge: 0.8, speed: 25, dash: 0.42, swingDmg: 40, swingReach: 3.2, swingCone: 22, swingCd: 0.7, lungeDmg: 110, lungeReach: 3.3, lungeCone: 28 }
};
export const MELEE_IDS = Object.keys(MELEE);

/* The fourth slot. Not in GUNS, so nothing that walks the guns (bots picking one, the loadout
   screen, damage) ever mistakes it for one; gunOf() is null for it, as for a blade. */
export const GRAPPLE = { id: "grapple", name: "Grappling gun", cls: "Grapple", hold: "pistol", swap: 0.15 };
export const SLOT_GRAPPLE = 3;

/**
 * How much harder a blade hits for how fast you are going (m/s, all three
 * axes, so a dive counts): nothing extra at a run, twice as hard at 18 m/s,
 * two and a half times at 24 and beyond. Shared by the game, the HUD's
 * readout and the hack API, so all three agree.
 */
export function speedBonus(speed) { return 1 + Math.max(0, Math.min(1.5, (speed - 6) / 12)); }

export const DEFAULT_LOADOUT = { primary: "kestrel", secondary: "wasp", melee: "katana" };
export function cleanLoadout(l) {
  l = l && typeof l === "object" ? l : {};
  return {
    primary: GUNS[l.primary] ? l.primary : DEFAULT_LOADOUT.primary,
    secondary: GUNS[l.secondary] ? l.secondary : DEFAULT_LOADOUT.secondary,
    melee: MELEE[l.melee] ? l.melee : DEFAULT_LOADOUT.melee
  };
}

/** Damage at a distance, and on a body part. */
export function damageFor(gun, dist, part) {
  const [a, b, m] = gun.range;
  const f = dist <= a ? 1 : dist >= b ? m : 1 + (m - 1) * (dist - a) / (b - a);
  const p = part === "head" ? gun.head : part === "nut" ? NUT : part === "body" ? 1 : gun.limb;
  return gun.dmg * f * p;
}

export function newArms(loadout) {
  const l = cleanLoadout(loadout);
  return {
    slots: [l.primary, l.secondary], melee: l.melee,
    cur: 0, last: 1,
    ammo: [GUNS[l.primary].mag, GUNS[l.secondary].mag],
    reloadT: 0, cool: 0, cycle: 1, swapT: 0, ads: 0, bloom: 0, zoom: 0, zoomHeld: false,
    trig: false, reloadHeld: false, meleeHeld: false, swingCd: 0, swingT: 0,
    lastKick: { pitch: 0, yaw: 0 }, shots: 0,
    ev: []
  };
}
export const gunOf = (A) => (A.cur < 2 ? GUNS[A.slots[A.cur]] : null);
export const meleeOf = (A) => MELEE[A.melee];
export const bladeOut = (A) => A.cur === 2;
export const grappleOut = (A) => A.cur === SLOT_GRAPPLE;
export function holdOf(A) { const g = gunOf(A); return g ? g.hold : grappleOut(A) ? GRAPPLE.hold : meleeOf(A).hold; }
/** What is in your hands, by name, whichever of the four it is. */
export function heldName(A) { const g = gunOf(A); return g ? g.name : grappleOut(A) ? GRAPPLE.name : meleeOf(A).name; }

/** How far a scope (or the sights) magnifies right now: the gun's zoom, doubled on a scope's second step. */
export function zoomOf(A) {
  const g = gunOf(A);
  return g ? 1 + (g.adsZoom * (g.scope && A.zoom ? 2 : 1) - 1) * A.ads : 1;
}
/** Working a bolt after a shot: 0 when there is nothing to do, else how far into it (0..1). */
export function boltOf(A) {
  const g = gunOf(A);
  if (!g || !g.bolt || A.cool <= 0 || A.reloadT > 0) return 0;
  return 1 - A.cool / A.cycle;
}

/** The mobility of what is in your hands, and while aiming. */
export function speedMulOf(A) {
  const g = gunOf(A);
  return (g ? g.speedMul : 1.05) * (1 - 0.35 * A.ads);
}

/** Current spread, in degrees, for the HUD's crosshair and for firing. */
export function spreadOf(A, body) {
  const g = gunOf(A);
  if (!g) return 0;
  const s = g.spread[0] + (g.spread[1] - g.spread[0]) * A.ads;
  const hs = Math.hypot(body.vx, body.vz);
  const moving = !body.onGround ? g.air : Math.min(1, hs / 7) * g.move;
  return s + moving * (1 - 0.5 * A.ads) + A.bloom;
}

function selectSlot(A, i) {
  if (i === A.cur || i < 0 || i > SLOT_GRAPPLE) return;
  A.last = A.cur; A.cur = i;
  const g = gunOf(A);
  A.swapT = g ? g.swap : grappleOut(A) ? GRAPPLE.swap : 0.2;
  A.reloadT = 0; A.zoom = 0;
  A.ev.push({ type: "swap", slot: i });
}

/**
 * One tick of whatever is in your hands. `cmd` carries buttons (movement.js's
 * B), and `slot` (1–4 picks, 4 being the grapple; -1 means the last one). Returns A.ev: fire,
 * dry, reload, reloaded, swap, swing.
 */
export function armsTick(A, cmd, body, dt, rng, B) {
  A.ev.length = 0;
  const btn = cmd.buttons | 0;
  if (cmd.slot === -1) selectSlot(A, A.last);
  else if (cmd.slot >= 1 && cmd.slot <= SLOT_GRAPPLE + 1) selectSlot(A, cmd.slot - 1);
  A.cool = Math.max(0, A.cool - dt);
  A.swapT = Math.max(0, A.swapT - dt);
  A.swingCd = Math.max(0, A.swingCd - dt);
  A.swingT = Math.max(0, A.swingT - dt);
  const g = gunOf(A);
  A.bloom = Math.max(0, A.bloom - dt * 5);

  const fire = !!(btn & B.FIRE), wantAds = !!(btn & B.ADS) && !!g && A.reloadT <= 0 && !body.sprinting && body.lunge === 0;
  A.ads = g ? Math.max(0, Math.min(1, A.ads + (wantAds ? 1 : -1) * dt / g.adsTime)) : 0;
  // a scope's second zoom: a press while looking through it steps in, the next steps back; letting go of aim resets it
  const zoomBtn = !!(btn & B.ZOOM);
  if (zoomBtn && !A.zoomHeld && g && g.scope && A.ads > 0.5) { A.zoom = A.zoom ? 0 : 1; A.ev.push({ type: "zoom", level: A.zoom }); }
  A.zoomHeld = zoomBtn;
  if (A.ads === 0) A.zoom = 0;

  // quick melee, from any slot
  const melee = !!(btn & B.MELEE);
  if (melee && !A.meleeHeld) swing(A);
  A.meleeHeld = melee;

  if (g) {
    const i = A.cur;
    const reload = !!(btn & B.RELOAD);
    if (A.reloadT > 0) {
      A.reloadT -= dt;
      if (A.reloadT <= 0) { A.ammo[i] = g.mag; A.reloadT = 0; A.ev.push({ type: "reloaded" }); }
    } else if (reload && !A.reloadHeld && A.ammo[i] < g.mag && A.swapT <= 0) startReload(A, g);
    A.reloadHeld = reload;

    const pressed = fire && !A.trig;
    if (fire && A.swapT <= 0 && A.reloadT <= 0 && A.cool <= 0 && (g.auto || pressed) && body.lunge === 0) {
      if (A.ammo[i] > 0) shoot(A, g, body, rng);
      else if (pressed) { A.ev.push({ type: "dry" }); startReload(A, g); }
    }
  } else if (bladeOut(A) && fire && !A.trig) swing(A);
  // (the grapple's trigger is game.js's: it fires a hook, not a round)
  A.trig = fire;
  return A.ev;
}
function startReload(A, g) { A.reloadT = g.reload; A.ads = 0; A.zoom = 0; A.ev.push({ type: "reload", time: g.reload, gun: g.id }); }
export function swing(A) {
  if (A.swingCd > 0) return false;
  const m = MELEE[A.melee];
  A.swingCd = m.swingCd; A.swingT = 0.25;
  A.ev.push({ type: "swing", melee: m.id });
  return true;
}

function shoot(A, g, body, rng) {
  A.ammo[A.cur]--;
  A.cool += 60 / g.rpm;
  A.cycle = A.cool;
  A.shots++;
  const spread = spreadOf(A, body) * R;
  const n = g.pellets || 1;
  const yaw = body.yaw, pitch = body.pitch;
  const cp = Math.cos(pitch);
  const f = [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  const r = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const dirs = [];
  for (let k = 0; k < n; k++) {
    const a = spread * Math.sqrt(rng()), t = rng() * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a), ct = Math.cos(t) * sa, st = Math.sin(t) * sa;
    dirs.push([f[0] * ca + r[0] * ct + u[0] * st, f[1] * ca + r[1] * ct + u[1] * st, f[2] * ca + r[2] * ct + u[2] * st]);
  }
  A.bloom = Math.min(4, A.bloom + g.bloom);
  const calm = 1 - 0.25 * A.ads;
  const kick = { pitch: g.recoil[0] * (0.8 + 0.4 * rng()) * calm * R, yaw: (rng() - 0.5) * 2 * g.recoil[1] * calm * R };
  A.lastKick = kick;
  A.ev.push({ type: "fire", gun: g.id, dirs, kick, proj: g.projectile || null, shot: A.shots });
}

/* combat.js — what flies between a shooter and the shot.
 *
 * Three kinds of projectile, because they behave differently and the
 * difference is the game:
 *   - homing (arrows, bolts, photons): follow the target and always land;
 *   - lobbed (boulders, shells, rockets): aimed at where the target WAS and
 *     burst there, so a moving army dodges siege and a standing one does not;
 *   - skillshots (a champion's Bolt or Volley): fly in a straight line and hit
 *     the first enemy in the way, or nothing.
 * Bullets, rails and lasers are instant — the tracer is drawn, the damage is
 * already done. */

import { G, emit } from "./state.js";
import { TILE } from "./data.js";
import { damage, near, hostile, canHit } from "./entities.js";

const INSTANT = { bullet: 1, musket: 1, rail: 1, laser: 1, ion: 1 };
const LOB = { boulder: 1, shell: 1, rocket: 1, singularity: 1, missile: 1 };
const SPEED = { stone: 9, arrow: 13, bolt: 15, spear: 11, boulder: 7, shell: 11, rocket: 9, missile: 12, photon: 18, plasma: 14, lance: 24, star: 17, aether: 14, singularity: 6, hero: 15, ember: 12 };

/** src shoots t for dmg. opts: { shot, splash (tiles), speed } */
export function fire(src, t, dmg, opts) {
  const st = src.st || {};
  const shot = (opts && opts.shot) || st.shot || src.shot || "arrow";
  const splash = ((opts && opts.splash !== undefined) ? opts.splash : st.splash || 0) * TILE;
  const era = src.kind === "bld" ? src.level - 1 : src.tier || G.era;
  if (INSTANT[shot]) {
    emit("tracer", src, t, shot);
    if (splash) burst(t.x, t.y, splash, dmg, src);
    else damage(t, dmg, src, shot);
    return;
  }
  const sp = ((opts && opts.speed) || SPEED[shot] || 12) * TILE;
  const p = { x: src.x, y: src.y - (src.kind === "bld" ? 18 : 6), sx: src.x, sy: src.y, tid: t.id, tx: t.x, ty: t.y, sp, dmg, splash, team: src.team, shot, by: src.id, era, t: 0, lob: !!LOB[shot], dead: false };
  p.dist = Math.hypot(p.tx - p.x, p.ty - p.y);
  G.projs.push(p);
  emit("shot", src, p);
}

/** A straight-line shot from (x, y) in direction (dx, dy). It bursts on the first enemy it meets. */
export function skillshot(src, x, y, dx, dy, range, dmg, opts) {
  const n = Math.hypot(dx, dy) || 1;
  const p = { x, y, sx: x, sy: y, vx: dx / n, vy: dy / n, range: range * TILE, sp: ((opts && opts.speed) || 15) * TILE, dmg, splash: ((opts && opts.splash) || 0) * TILE,
    team: src.team, shot: (opts && opts.shot) || "hero", by: src.id, era: G.era, t: 0, line: true, pierce: !!(opts && opts.pierce), hit: new Set(), dead: false, tag: opts && opts.tag };
  G.projs.push(p);
  emit("shot", src, p);
  return p;
}

/** Damage everything hostile within r of (x, y); full at the middle, half at the edge. */
export function burst(x, y, r, dmg, src, opts) {
  const team = src.team;
  near(x, y, r + 48, (e) => {
    if (e.dead || e.team === team || e.team === 2) return;
    if (e.kind === "unit" && (e.hidden || (e.st.air && !(opts && opts.air)))) return;
    const d = e.kind === "bld" ? distRect(x, y, e) : Math.hypot(e.x - x, e.y - y) - e.r;
    if (d > r) return;
    const k = 1 - 0.5 * Math.max(0, d) / r;
    damage(e, dmg * k, src.dead ? null : src, "splash");
    if (opts && opts.each) opts.each(e);
  });
  emit("burst", x, y, r, src);
}
function distRect(x, y, b) {
  const x0 = b.tx * TILE, y0 = b.ty * TILE, x1 = x0 + b.w * TILE, y1 = y0 + b.h * TILE;
  const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0, dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
  return Math.hypot(dx, dy);
}

export function updateProjectiles(dt) {
  for (const p of G.projs) {
    if (p.dead) continue;
    p.t += dt;
    const src = G.ents.get(p.by) || { team: p.team, dead: true, id: p.by };
    if (p.line) {
      const s = p.sp * dt;
      p.x += p.vx * s; p.y += p.vy * s;
      let hitOne = null;
      near(p.x, p.y, 40, (e) => {
        if (!hostile({ team: p.team }, e) || p.hit.has(e.id)) return false;
        if (e.kind === "unit" && e.st.air) return false;
        const d = e.kind === "bld" ? distRect(p.x, p.y, e) : Math.hypot(e.x - p.x, e.y - p.y) - e.r;
        if (d < 8) { hitOne = e; return true; }
        return false;
      });
      if (hitOne) {
        p.hit.add(hitOne.id);
        if (p.splash) burst(p.x, p.y, p.splash, p.dmg, src); else damage(hitOne, p.dmg, src.dead ? null : src, p.shot);
        emit("impact", p, hitOne);
        if (!p.pierce) { p.dead = true; continue; }
      }
      if (Math.hypot(p.x - p.sx, p.y - p.sy) >= p.range) { p.dead = true; if (p.splash && p.tag === "burstEnd") burst(p.x, p.y, p.splash, p.dmg, src); emit("impact", p, null); }
      continue;
    }
    const t = p.tid && G.ents.get(p.tid);
    if (!p.lob && t && !t.dead) { p.tx = t.x; p.ty = t.y; }
    const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy), s = p.sp * dt;
    if (d <= s + 2) {
      p.x = p.tx; p.y = p.ty; p.dead = true;
      if (p.splash) burst(p.x, p.y, p.splash, p.dmg, src);
      else if (t && !t.dead && (p.lob ? Math.hypot(t.x - p.x, t.y - p.y) < t.r + 10 || t.kind === "bld" : true)) damage(t, p.dmg, src.dead ? null : src, p.shot);
      emit("impact", p, t);
      continue;
    }
    p.x += dx / d * s; p.y += dy / d * s;
  }
  if (G.tick % 10 === 0) G.projs = G.projs.filter((p) => !p.dead);
}
export { canHit };

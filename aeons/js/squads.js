/* squads.js — named groups with standing jobs.
 *
 * A control group is a shortcut for your hand; a squad is a job for the
 * army. Make one from a selection, give it a role and a place, and it goes on
 * doing that job until you change it:
 *   - defend: hold a place, meet whatever comes within reach of it, go back;
 *   - patrol: walk the round of your halls, outposts and towers, fighting;
 *   - strike: wait until it is at strength, then march on the nearest enemy
 *     base you know of; fall back to refill when it is badly hurt;
 *   - hunt:   chase the nearest contact near its place, then come home;
 *   - escort: stand by whichever far drop-off has the most workers at it.
 * With the Captains doctrine new soldiers join the squad shortest of its number.
 *
 * A squad steers its members only when they are idle or doing its bidding, so
 * an order of yours always wins — for as long as it lasts. */

import { G, emit, on } from "./state.js";
import { TILE, BUILDINGS, LINES } from "./data.js";
import { setOrder, moveGroup, isMilitary } from "./units.js";
import { liveBases } from "./enemy.js";

export const ROLES = {
  defend: { name: "Defend", line: "Hold a place and answer what comes near it." },
  patrol: { name: "Patrol", line: "Walk the round of your halls, outposts and towers." },
  strike: { name: "Strike", line: "At strength, march on the nearest known enemy base." },
  hunt:   { name: "Hunt",   line: "Chase contacts that come near its place." },
  escort: { name: "Escort", line: "Stand by the far drop-off where most workers are." }
};
const NAMES = ["Ash", "Flint", "Bronze", "Iron", "Crown", "Powder", "Steam", "Engine", "Signal", "Star", "Aether", "Ember", "Thorn", "Raven", "Lantern", "Tide"];

export function squads() { return G.squads || (G.squads = []); }
export function squadOf(u) { return squads().find((s) => s.ids.includes(u.id)); }
const members = (s) => s.ids.map((id) => G.ents.get(id)).filter((u) => u && !u.dead);
const centre = (us) => ({ x: us.reduce((a, u) => a + u.x, 0) / us.length, y: us.reduce((a, u) => a + u.y, 0) / us.length });

export function create(units, role) {
  const us = units.filter((u) => u && !u.dead && u.team === 0 && isMilitary(u) && !u.free);
  if (!us.length) return null;
  for (const u of us) { const o = squadOf(u); if (o) o.ids = o.ids.filter((id) => id !== u.id); }
  const S = squads();
  const used = new Set(S.map((s) => s.name));
  const name = NAMES.find((n) => !used.has(n)) || "Squad " + (S.length + 1);
  const c = centre(us);
  const s = { id: (G.nextSquad = (G.nextSquad || 0) + 1), name, ids: us.map((u) => u.id), role: role || "defend", anchor: { x: c.x, y: c.y }, size: Math.max(us.length, 6), leg: 0, state: "", since: G.time };
  S.push(s);
  prune();
  emit("squads");
  return s;
}
export function disband(s) { G.squads = squads().filter((x) => x !== s); emit("squads"); }
export function setRole(s, role) { s.role = role; s.state = ""; s.leg = 0; emit("squads"); }
function prune() { G.squads = squads().filter((s) => { s.ids = s.ids.filter((id) => { const u = G.ents.get(id); return u && !u.dead; }); return s.ids.length || s.size > 0; }); }

/** Members that are free for the squad to steer: idle, or still on the squad's own last order. */
const free = (s) => members(s).filter((u) => !u.manual && (u.order.t === "idle" || u.order.sq === s.id));
function send(s, us, x, y, t) {
  moveGroup(us, x, y, t || "amove");
  for (const u of us) u.order.sq = s.id;
}

/* the round a patrol walks: everything of yours that marks the edge of the realm */
function round() {
  const pts = G.blds.filter((b) => !b.dead && b.team === 0 && b.built >= 1 && (b.type === "hall" || b.type === "outpost" || b.type === "tower")).map((b) => ({ x: b.x, y: b.y + b.h * TILE * 0.7 }));
  if (pts.length < 2) return pts;
  // nearest-neighbour order, so the round is a loop and not a zigzag
  const out = [pts.shift()];
  while (pts.length) { const l = out[out.length - 1]; pts.sort((a, b) => Math.hypot(a.x - l.x, a.y - l.y) - Math.hypot(b.x - l.x, b.y - l.y)); out.push(pts.shift()); }
  return out;
}
function knownTarget(from) {
  const live = new Set(liveBases().map((b) => b.id));
  let best = null, bd = 1e18;
  for (const gh of G.ghosts.values()) {
    const b = G.ents.get(gh.id);
    if (!b || b.dead || !live.has(b.base) || b.type === "wall") continue;
    const d = Math.hypot(b.x - from.x, b.y - from.y);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

export function updateSquads() {
  const S = squads();
  if (!S.length) return;
  prune();
  for (const s of S) {
    const us = members(s);
    if (!us.length) continue;
    const idle = free(s);
    const c = centre(us);
    switch (s.role) {
      case "defend": {
        // an alarm near the post is answered; otherwise everyone back to it
        const a = G.intel.alerts.find((x) => G.time - x.t < 8 && Math.hypot(x.x - s.anchor.x, x.y - s.anchor.y) < 18 * TILE);
        if (a && s.state !== "answer") { s.state = "answer"; s.since = G.time; send(s, idle, a.x, a.y); }
        else if (s.state === "answer" && G.time - s.since > 30) s.state = "";
        if (!s.state) for (const u of idle) if (u.order.t === "idle" && Math.hypot(u.x - s.anchor.x, u.y - s.anchor.y) > 5 * TILE) { setOrder(u, { t: "guard", x: s.anchor.x + (Math.random() - 0.5) * 4 * TILE, y: s.anchor.y + (Math.random() - 0.5) * 4 * TILE, sq: s.id }); }
        break;
      }
      case "patrol": {
        const R = round();
        if (!R.length) break;
        s.leg %= R.length;
        const p = R[s.leg];
        const there = us.filter((u) => Math.hypot(u.x - p.x, u.y - p.y) < 5 * TILE).length;
        if (there >= Math.ceil(us.length * 0.6) || (idle.length === us.length && us.every((u) => u.order.t === "idle"))) {
          if (there >= Math.ceil(us.length * 0.6)) s.leg = (s.leg + 1) % R.length;
          send(s, idle, R[s.leg].x, R[s.leg].y);
        }
        break;
      }
      case "strike": {
        const hp = us.reduce((a, u) => a + u.hp / u.maxHp, 0) / us.length;
        if (s.state === "march" && (hp < 0.4 || us.length < s.size * 0.35)) { s.state = "regroup"; send(s, idle.length ? idle : us, s.anchor.x, s.anchor.y, "move"); emit("toast", "Squad " + s.name + " falls back to regroup", "auto"); break; }
        if (s.state !== "march") {
          if (us.length >= s.size && hp > 0.75) {
            const t = knownTarget(c);
            if (t) { s.state = "march"; s.target = t.id; send(s, us.filter((u) => !u.manual), t.x, t.y); emit("toast", "Squad " + s.name + " marches", "auto"); }
          } else for (const u of idle) if (u.order.t === "idle" && Math.hypot(u.x - s.anchor.x, u.y - s.anchor.y) > 5 * TILE) setOrder(u, { t: "move", x: s.anchor.x, y: s.anchor.y, sq: s.id });
        } else if (idle.length === us.length) {
          const t = knownTarget(c);
          if (t) send(s, idle, t.x, t.y); else { s.state = ""; send(s, idle, s.anchor.x, s.anchor.y, "move"); }
        }
        break;
      }
      case "hunt": {
        const C = G.intel.contacts.filter((k) => G.time - k.seen < 30 && Math.hypot(k.x - s.anchor.x, k.y - s.anchor.y) < 30 * TILE).sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
        if (C && idle.length) { send(s, idle, C.x, C.y); s.state = "hunt"; }
        else if (!C && s.state === "hunt" && idle.length === us.length) { s.state = ""; send(s, idle, s.anchor.x, s.anchor.y, "move"); }
        break;
      }
      case "escort": {
        let best = null, bn = 0;
        for (const b of G.blds) {
          if (b.dead || b.team !== 0 || b.built < 1 || b.type === "hall" || !BUILDINGS[b.type].drop) continue;
          let n = 0; for (const w of G.units) if (!w.dead && w.team === 0 && w.line === "worker" && Math.hypot(w.x - b.x, w.y - b.y) < 12 * TILE) n++;
          if (n > bn) { bn = n; best = b; }
        }
        if (best && (!s.post || s.post !== best.id)) { s.post = best.id; s.anchor = { x: best.x, y: best.y + best.h * TILE }; for (const u of idle) setOrder(u, { t: "guard", x: s.anchor.x, y: s.anchor.y, sq: s.id }); }
        break;
      }
    }
  }
}

/* Captains: a new soldier fills the squad that is shortest of its number. */
on("trained", (u) => {
  if (u.team !== 0 || !G.doctrines.captains || G.auto && G.auto.captains === false || !isMilitary(u)) return;
  let best = null, bd = 0;
  for (const s of squads()) { const d = s.size - s.ids.length; if (d > bd) { bd = d; best = s; } }
  if (!best) return;
  best.ids.push(u.id);
  setOrder(u, { t: "move", x: best.anchor.x, y: best.anchor.y, sq: best.id });
});
export { LINES };

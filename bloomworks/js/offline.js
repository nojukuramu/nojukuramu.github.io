/* offline.js — the game keeps running while it is closed.
 *
 * Offline Glow = online Glow × Offline Rate. The rate starts at 50% and the
 * Seed Tree raises it to 100%; the time cap starts at 12 h, the Seed Tree
 * raises it by days and each Cracked Hourglass Relic Level adds 12 h more.
 *
 * Simulating every mote for hours would be both slow and pointless, so the
 * time away is cut into chunks. Each chunk pays the measured Glow rate,
 * grows each plot by its measured Bloom XP rate, turns the weather, lets
 * Tinkers spend (Builders, Upgraders, Scouts), lets Directives fire, and
 * counts Golden Moths: a Keeper catches them at half a Windfall, the rest
 * become Moth Jars, up to 3. Commissions do not expire while you are away.
 * Every chunk is also a frame of the Time-lapse the Logbook plays. */

import { S, RT } from "./state.js";
import { ZERO, lAdd, lGte, lSub } from "./num.js";
import * as E from "./econ.js";
import { gain } from "./sim.js";
import { weatherTick } from "./events.js";
import { directivesTick, buildGhost, buyLevels } from "./auto.js";
import { claim, rebuildLayout } from "./build.js";
import { frontier } from "./world.js";
import { windfall, mothInterval } from "./goals.js";

export function offlineCap() { return 3600 * (12 + 24 * E.tree("offcap") + 12 * E.relic("hourglass")); }
export function offlineRate() { return Math.min(1, 0.5 + 0.1 * E.tree("offrate")); }

function snapshot() {
  const plots = {};
  for (const k in S.season.plots) plots[k] = S.season.plots[k].bloom;
  return { plots, copies: S.season.copies.map((c) => [c.type, c.x, c.y, c.rot]), ghosts: S.season.ghosts.length, t: S.t };
}

/** Catch up `secs` of time away. Returns the Logbook. */
export function catchUp(secs) {
  const capped = Math.min(secs, offlineCap());
  const rate = offlineRate();
  const perSec = S.lastPerSec != null ? S.lastPerSec : ZERO;
  const log = {
    away: secs, counted: capped, rate, glow: ZERO, plots: 0, built: 0, levels: 0, bloom: 0, caught: 0, jars: 0, harvests: 0,
    seasonStart: S.seasonNo, frames: [snapshot()]
  };
  if (capped < 5) return log;
  const chunks = Math.max(1, Math.min(240, Math.floor(capped / 30)));
  const dt = capped / chunks;
  const hasJob = (j) => (S.tinkers || []).slice(0, tinkersOwned()).some((t) => t.job === j);
  let mothClock = S.moth.next;
  rebuildLayout();
  for (let i = 0; i < chunks; i++) {
    S.t += dt; S.season.seasonT += 0;   // Season time stands still: Commissions never expire offline
    S.meta.stats.played += dt;
    if (perSec !== ZERO) {
      const g = perSec + Math.log10(rate * dt);
      gain(g);
      log.glow = lAdd(log.glow, g);
    }
    // Bloom keeps growing at the rate it was growing.
    for (const k in S.xpRate || {}) {
      const ps = S.season.plots[k];
      if (!ps || E.inTrial("grey")) continue;
      ps.xp = lAdd(ps.xp, S.xpRate[k] + Math.log10(rate * dt));
      const lvl = Math.max(0, Math.floor(ps.xp + 1e-9) - 1);
      if (lvl > ps.bloom) { log.bloom += lvl - ps.bloom; ps.bloom = lvl; }
    }
    weatherTick();
    // Tinkers work while you are away.
    if (hasJob("builder")) {
      for (let n = 0; n < 40; n++) {
        const g = S.season.ghosts.slice().sort((a, b) => a.order - b.order).find((x) => E.unlocked(x.type));
        if (!g || !lGte(S.season.glow, E.buildCostL(g.type))) break;
        if (!buildGhost(g)) { S.season.ghosts.splice(S.season.ghosts.indexOf(g), 1); continue; }
        log.built++;
      }
    }
    if (hasJob("upgrader")) {
      const types = [...new Set(S.season.copies.map((c) => E.lvlKey(c.type)))].filter((k) => E.levelCostL(k, 1) !== ZERO);
      for (let n = 0; n < 60 && types.length; n++) {
        types.sort((a, b) => E.levelCostL(a, 1) - E.levelCostL(b, 1));
        const k = types[0];
        // Spend at most half of what is held, so the Builders still have something.
        if (!lGte(lSub(S.season.glow, E.levelCostL(k, 1)), S.season.glow - Math.log10(2))) break;
        if (!buyLevels(k, 1)) break;
        log.levels++;
      }
    }
    if (hasJob("scout")) {
      let best = null, bc = Infinity;
      for (const [a, b] of frontier()) { const c = E.claimCostL(a, b); if (c < bc) { bc = c; best = [a, b]; } }
      if (best && lGte(S.season.glow, bc + Math.log10(3)) && claim(best[0], best[1])) log.plots++;
    }
    mothClock -= dt;
    while (mothClock <= 0) {
      mothClock += mothInterval();
      if (hasJob("keeper")) { windfall(0.5, { id: "burst" }); log.caught++; }
      else if (S.season.jars < 3) { S.season.jars++; log.jars++; }
    }
    const before = S.seasonNo;
    directivesTick();
    if (S.seasonNo !== before) log.harvests++;
    if (i % Math.max(1, Math.floor(chunks / 40)) === 0 || i === chunks - 1) log.frames.push(snapshot());
  }
  S.moth.next = Math.max(30, mothClock);
  rebuildLayout();
  return log;
}
function tinkersOwned() {
  let n = 0;
  for (const c of S.season.copies) if (c.type === "tinkerhut") n += 2 + E.milestones("tinkerhut");
  if (!n) return 0;
  return n + E.tree("tinker") + E.trialRank("haste") + (E.constellationOn("tinker") ? 3 : 0);
}

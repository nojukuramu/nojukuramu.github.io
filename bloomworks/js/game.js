/* game.js — one tick of the whole game, and the wiring between systems.
 *
 * sim.js moves motes; events.js runs the living world; auto.js the helpers;
 * goals.js and prestige.js the goals and resets. This file calls them in
 * order at a fixed step, runs the once-a-second work, and turns what the
 * simulation reports (a sale, a Lucky hit, a Chain ending, a Bloom level)
 * into Feats, Commission progress, secrets, sparks and sounds. */

import { S, RT } from "./state.js";
import { ZERO, L, lAdd, fmtL, N } from "./num.js";
import { TYPES, HUES } from "./data.js";
import * as E from "./econ.js";
import * as sim from "./sim.js";
import * as ev from "./events.js";
import * as goals from "./goals.js";
import * as auto from "./auto.js";
import * as pr from "./prestige.js";
import * as fx from "./fx.js";
import { centre } from "./build.js";

let notify = () => {};
export function onNotify(fn) {
  notify = fn;
  goals.onNotify(fn); ev.onNotify(fn); auto.onNotify(fn); pr.onNotify(fn);
}

/* ---------- what the simulation reports ---------- */
sim.on("sale", (c, m, g, wished) => {
  goals.commissionProgress("sellHue", m.h);
  goals.commissionProgress("glow", g);
  if (m.L) { goals.commissionProgress("lucky", m.L); goals.featCheck("lucky", m.L); }
  if (m.h === 7) goals.hiddenFeat("rainbow");
  if (m.L >= 4) goals.hiddenFeat("supernova");
  goals.hiddenSale(c, m);
  if (!E.isDay(c.k.plot)) {
    const ni = ev.nightIndex();
    if (S.counters.nightIdx !== ni) { S.counters.nightIdx = ni; S.counters.nightSales = 0; }
    if (++S.counters.nightSales >= 1000) goals.hiddenFeat("nightshift");
  }
  // A number pops above each sale worth at least 1% of your Glow per second.
  if (S.meta.settings.pops && (RT.rate.perSec === ZERO || g >= RT.rate.perSec - 2) && (m.L > 0 || wished || !(c.popAt > S.t - 0.4))) {
    c.popAt = S.t;
    const [x, y] = centre(c);
    fx.pop(x, y - 0.6, "+" + fmtL(g), m.L > 0 || wished, m.L > 0 ? "#fff3a0" : wished ? HUES[m.h].col : null);
  }
  fx.sale(c.combo, m.L);
});
sim.on("lucky", (c, m) => {
  const [x, y] = centre(c);
  fx.spark(x, y, m.L >= 3 ? "#ffffff" : "#fff3a0", 4 + m.L * 4);
  if (m.L >= 4) fx.supernova(x, y);
});
sim.on("fuse", (c, out) => {
  goals.featCheck("tier", out.t);
  goals.commissionProgress("tier", out.t);
  const [x, y] = centre(c);
  fx.spark(x, y, HUES[out.h].col, 10);
});
sim.on("chain", (ch) => {
  goals.featCheck("chain", ch.steps);
  goals.commissionProgress("chain", ch.steps);
  goals.chimeSong(ch.notes);
});
sim.on("bloom", (key, lvl, c) => {
  RT.bloomWaves = RT.bloomWaves || [];
  const [x, y] = centre(c);
  RT.bloomWaves.push({ plot: key, x, y, t: 0, lvl });
  if (lvl >= 8) goals.hiddenFeat("overgrown");
  fx.chord();
});
sim.on("mod", () => goals.dropMod(1, 0));
sim.on("heart", (stage) => { notify("The World Heart grows: Stage " + stage + ". ×2 all Glow until Genesis.", "big", "heart"); RT.lastGlobalAt = -1; });
sim.on("rush", () => notify("Rush! Every Tempo ×2 and Lucky chance ×2.", "big", "bolt"));
sim.on("feat", (id) => goals.hiddenFeat(id));

/* ---------- the tick ---------- */
export function tick(dt) {
  S.t += dt;
  S.season.seasonT += dt;
  S.meta.stats.played += dt;
  sim.step(dt);
  ev.critterTick(dt);
  auto.tinkersTick(dt);
  pr.eclipseTick(dt);
  mothTick(dt);
  RT.secAcc = (RT.secAcc || 0) + dt;
  if (RT.secAcc >= 1) { RT.secAcc -= 1; perSecond(); }
}

function mothTick(dt) {
  const m = RT.moth;
  if (m) {
    m.t += dt;
    m.x += m.vx * dt + Math.sin(m.t * 2.3) * dt * 0.6;
    m.y += m.vy * dt + Math.cos(m.t * 1.7) * dt * 0.6;
    if (S.t >= m.until) RT.moth = null;
  }
}

function perSecond() {
  ev.weatherTick();
  ev.voidTick();
  goals.goalsTick();
  auto.directivesTick();
  pr.trialTick();
  const opened = E.refreshUnlocks();
  for (const k of opened) notify("Discovered: " + TYPES[k].name, "unlock", "spark");
  if (Math.floor(S.t) % 120 === 0) ev.regrowTick();
  // Golden Moths: every 3 to 6 minutes over a plot you own.
  S.moth.next -= 1;
  if (S.moth.next <= 0) { S.moth.next = goals.mothInterval(); if (!RT.moth) goals.spawnMoth(); }
  // Bloom XP rate per plot, for offline growth.
  RT.xpClock = (RT.xpClock || 0) + 1;
  if (RT.xpClock >= 30) {
    RT.xpClock = 0;
    S.xpRate = {};
    for (const [k, v] of RT.rate.xp) S.xpRate[k] = v - Math.log10(30);
    RT.rate.xp.clear();
  }
}

/** Run `secs` of game time at the fixed step, for catching up a background tab. */
export function advance(secs) {
  let n = Math.min(Math.floor(secs / sim.STEP), 30 * 120);
  while (n-- > 0) tick(sim.STEP);
}
export { fx, N, L, lAdd };

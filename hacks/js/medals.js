/* medals.js — what each of your kills was worth.
 *
 * Every kill of yours is looked at once, here, and given its medals: first
 * blood, a double, triple or multi kill, a streak, a headshot, a nut shot, a
 * collateral (one round, two bodies), a revenge, a combo breaker (you ended
 * somebody's streak), a long shot, a mid-air kill, a speed kill with a blade,
 * one reeled in on your grapple — and the one or two worth the announcer
 * saying out loud. hud.js shows them under the crosshair, audio.js says the
 * lines and rings the kill a little higher for each one that comes quickly.
 *
 * Only listens (state.js events) and emits "medals" and "announce"; it never
 * touches the match. The details of a kill come from your own last hit on
 * that body — the part, the round, the distance, whether they were in the
 * air, how fast you were going — since that is the machine that knew. */

import { S, on, emit } from "./state.js";
import { GUNS, MELEE } from "./weapons.js";

const QUICK_S = 4.5;          // kills closer together than this chain into a double, a triple …
const RECENT_S = 1.5;         // a hit this recent is the one that killed
let lastKillAt = -99, quick = 0, run = 0, anyKill = false, myKiller = null, finalSaid = false;
const lastHit = new Map();    // victim id -> { info, t }
const shotKills = new Map();  // round id -> how many it has killed
const hookedAt = new Map();   // victim id -> when your grapple caught them

const STREAKS = { 3: ["Rampage", "rampage"], 5: ["Dominating", "dominating"], 8: ["Unstoppable", "unstoppable"], 12: ["Annihilation", "annihilation"] };
const QUICK = { 2: ["Double kill", "double_kill", 80], 3: ["Triple kill", "triple_kill", 85] };

function reset() { lastKillAt = -99; quick = 0; run = 0; anyKill = false; myKiller = null; finalSaid = false; lastHit.clear(); shotKills.clear(); hookedAt.clear(); }

on("matchStart", (m) => { reset(); if (m.mode !== "practice") emit("announce", [m.mode === "tdm" ? "team_deathmatch" : "fight"]); });
on("quit", reset);
on("hit", (a, b, dmg, info) => { if (a === S.me && b) lastHit.set(b.id, { info: info || {}, t: S.time }); });
on("hooked", (a, b) => { if (a === S.me && b) hookedAt.set(b.id, S.time); });

on("killfeed", (k) => {
  const v = k.victim, by = k.killer;
  const first = !anyKill && v && by && by !== v;
  if (v && by && by !== v) anyKill = true;
  if (v === S.me) { run = 0; quick = 0; myKiller = by && by !== S.me ? by.id : null; return; }
  if (by !== S.me || !v) return;

  const now = S.time || 0;
  quick = now - lastKillAt < QUICK_S ? quick + 1 : 1;
  lastKillAt = now;
  run++;
  const h = lastHit.get(v.id);
  const info = h && now - h.t < RECENT_S ? h.info : {};
  const list = [];
  // id, the words, how loud it is on screen (1-3), the announcer's line and how much it wants to be said
  const add = (id, text, tier, say, pri) => list.push({ id, text, tier, say: say || null, pri: pri || 0 });

  if (k.nut) add("nut", "Nut shot", 3, "!Nut shot!", 100);
  if (info.shot != null) {
    const n = (shotKills.get(info.shot) || 0) + 1;
    shotKills.set(info.shot, n);
    if (n >= 2) add("collateral", n > 2 ? "Collateral ×" + n : "Collateral", 3, "!Collateral!", 90);
  }
  if (quick >= 4) add("multi", "Multi kill", 3, "multi_kill", 88);
  else if (QUICK[quick]) add("quick", QUICK[quick][0], quick === 3 ? 3 : 2, QUICK[quick][1], QUICK[quick][2]);
  if (first) add("first", "First blood", 2, "first_blood", 75);
  if (myKiller === v.id) { add("revenge", "Revenge", 2, "revenge_kill", 70); myKiller = null; }
  if (k.ended >= 3) add("breaker", "Combo breaker", 2, "combo_breaker", 65);
  if (STREAKS[run]) add("streak", STREAKS[run][0], run >= 8 ? 3 : 2, STREAKS[run][1], 60);
  else if (run > 12 && run % 4 === 0) add("streak", run + " in a row", 3, "unstoppable", 60);
  const g = GUNS[k.weapon];
  if (g && g.scope && info.dist >= 60) add("long", "Long shot " + Math.round(info.dist) + " m", 2, "precision_kill", 55);
  if (k.head) add("head", "Headshot", 1, "headshot", 50);
  if (info.air) add("air", "Mid-air", 2, null, 0);
  if (MELEE[k.weapon] && info.speedMul >= 1.5) add("speed", "Speed kill ×" + info.speedMul.toFixed(1), 2, null, 0);
  if (hookedAt.has(v.id) && now - hookedAt.get(v.id) < 3) add("reeled", "Reeled in", 2, null, 0);
  if (k.weapon === "condor" && !list.some((m) => m.say)) add("oneshot", "One shot", 1, "killshot", 30);
  lastHit.delete(v.id);

  // at most two lines, the most notable first: a voice queue that runs behind the fight is worse than none
  const say = list.filter((m) => m.say).sort((a, b) => b.pri - a.pri).slice(0, 2).map((m) => m.say);
  emit("medals", { victim: v, head: !!k.head, nut: !!k.nut, quick, run, list, say });
  if (say.length) emit("announce", say);
});

/* One kill from winning: said once a match. */
on("scoreChanged", (sc) => {
  const m = S.match;
  if (!m || m.over || finalSaid || !S.me || !sc || m.mode === "practice") return;
  const mine = m.mode === "tdm" ? (sc.tk || [])[S.me.team] || 0 : (sc.k || {})[S.me.id] || 0;
  if (sc.target && mine === sc.target - 1) { finalSaid = true; emit("announce", ["final_round"]); }
});
on("matchEnd", (m) => {
  if (!S.me || m.mode === "practice") return;
  const won = m.mode === "tdm" ? m.winner === S.me.team : m.winner === S.me.id;
  const deaths = (m.score && m.score.d && m.score.d[S.me.id]) || 0;
  emit("announce", won ? (deaths === 0 ? ["flawless_victory"] : ["round_winner"]) : ["game_over"]);
});

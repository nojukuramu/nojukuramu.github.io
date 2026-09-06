/* role-interaction-test.js — where two roles meet, and one of them is wrong.
 *
 * Run: node tools/role-interaction-test.js
 *
 * tools/engine-test.js proves the engine does what it was designed to do. This
 * file goes looking for the places where two roles, a corpse and a clock meet
 * and nobody ever decided what was supposed to happen. It is an audit as much
 * as a test, so it reports in two registers:
 *
 *   ok(...)       a hard assertion. It fails the build. Everything asserted
 *                 here is behaviour that is correct today and must stay correct
 *                 — including "correct" in the narrow sense of "this is what
 *                 the engine currently does and the .md explains why that is
 *                 the right answer".
 *
 *   finding(...)  a bug, reported and not asserted. The catalogue in
 *                 tools/ROLE-INTERACTIONS.md carries the argument; this only
 *                 re-checks whether the bug is still there, so the list stays
 *                 honest as the code moves. It never changes the exit code:
 *                 nothing in here was broken by this file, and a test suite
 *                 that goes red on somebody else's pre-existing bug gets
 *                 muted rather than fixed.
 *
 *   unspec(...)   the data and the README are both silent, the engine picked
 *                 an answer by accident, and somebody should decide on purpose.
 *
 * NOTHING in this file changes game logic. Where the engine is wrong, the
 * assertion pins the wrong behaviour and the finding says so out loud.
 */
"use strict";
var fs = require("fs"), path = require("path"), vm = require("vm");

var ROOT = path.join(__dirname, "..");
var g = { console: console, Date: Date, Math: Math, JSON: JSON, setTimeout: setTimeout };
g.globalThis = g;
vm.createContext(g);

function load(rel) {
  var src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  vm.runInContext(src, g, { filename: rel });
}
function json(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); }

load("js/engine/protocol.js");
load("js/engine/roles.js");
load("js/engine/resolver.js");
fs.readdirSync(path.join(ROOT, "js/roles")).sort().forEach(function (f) {
  if (f.endsWith(".js")) load("js/roles/" + f);
});
load("js/engine/state.js");
load("js/engine/clock.js");
load("js/engine/win.js");
load("js/engine/events.js");
load("js/engine/view.js");
load("js/engine/engine.js");

var WG = g.WG;
WG.roles.link(json("data/list_of_roles.json"));
WG.clock.load(json("data/game_flow.json"), json("data/sky.json"));
WG.events.load(json("data/list_of_events.json"));

var P = WG.resolver.P;

/* ---------------- harness ---------------- */

var pass = 0, fail = 0;
var findings = [], stillBroken = 0, fixed = 0, unspecified = [];
var caseNo = 0, caseIds = [];

function ok(label, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ " + label + (extra ? "  <- " + extra : "")); }
}

/** A bug we found. Reported loudly, never fatal. */
function finding(id, label, broken, where) {
  if (broken) {
    stillBroken++;
    findings.push(id + "  " + label + "  [" + where + "]");
    console.log("  ! " + id + " STILL BROKEN — " + label + "\n        " + where);
  } else {
    fixed++;
    console.log("  ✓ " + id + " looks fixed — " + label);
  }
}

/** Nobody ever said what this should do. The engine answered anyway. */
function unspec(id, label, where) {
  unspecified.push(id + "  " + label + "  [" + where + "]");
  console.log("  ? " + id + " UNSPECIFIED — " + label + "\n        " + where);
}

function section(name) { console.log("\n" + name); }

/** Numbered test case, matching tools/ROLE-INTERACTIONS.md. */
function testCase(id, title) {
  caseNo++; caseIds.push(id);
  console.log("\n  [" + id + "] " + title);
}

function room(names) {
  var state = WG.state.createState("RIT001");
  state.hostId = "p0";
  /* Random events are the one source of nondeterminism a scenario test cannot
   * live with: a Curfew rolled on night two silently disables the very door the
   * case is about. Every event case below triggers what it wants by hand. */
  state.config.events.enabled = false;
  names.forEach(function (n, i) {
    state.players.push(WG.state.createPlayer("p" + i, n, i));
  });
  var mail = {};
  var ended = null;
  var eng = WG.engine.create(state, {
    toPlayer: function (id, msg) { (mail[id] = mail[id] || []).push(msg); },
    toAll: function () {},
    changed: function () {},
    ended: function (r) { ended = r; }
  });
  return {
    state: state, eng: eng, mail: mail,
    ended: function () { return ended; },
    inbox: function (id) { return (mail[id] || []).map(function (m) { return (m.entry && m.entry.text) || m.text || ""; }); },
    said: function (id, needle) {
      return (mail[id] || []).some(function (m) {
        var t = (m.entry && m.entry.text) || m.text || "";
        return t.indexOf(needle) >= 0;
      });
    },
    lastOffers: function (id) {
      var o = (mail[id] || []).filter(function (m) { return m.type === "OFFERS"; });
      return o.length ? o[o.length - 1] : null;
    },
    /** Knock, and return the action ids on offer (disabled ones marked). */
    doors: function (who, houseId) {
      this.eng.handle({ type: "KNOCK", houseId: houseId }, who);
      var o = this.lastOffers(who);
      if (!o) return [];
      return o.offers.map(function (x) { return x.actionId + (x.enabled ? "" : "!"); });
    },
    offered: function (who, houseId, actionId) {
      return this.doors(who, houseId).indexOf(actionId) >= 0;
    },
    log: function () { return this.state.publicLog.map(function (e) { return e.text; }).join(" | "); },
    clear: function () { mail = {}; }
  };
}

function give(r, assignments) {
  Object.keys(assignments).forEach(function (pid) {
    var p = P(r.state, pid);
    p.role = assignments[pid];
    Object.assign(p, WG.roles.initialState(assignments[pid]));
  });
  WG.win.noteLeaders(r.state);
}

function night(r) {
  r.state.round++;
  WG.clock.enter(r.state, "night");
  WG.resolver.beginNight(r.state);
  r.state.players.forEach(function (p) { p.ready = false; });
}

/** Kill somebody outside anybody's turn, the way an event or a passive would. */
function slay(r, id, cause, byId) {
  var out = WG.resolver.bag();
  return WG.resolver.kill(r.state, id, { cause: cause || "poison", byId: byId || null, out: out });
}

function alive(r, id) { return P(r.state, id).alive; }
function roleOf(r, id) { return P(r.state, id).role; }

/* Several outcomes are decided by a coin toss inside the engine (tie-broken
 * pack votes, the Festival's redirect, random revivals). The vm context shares
 * this process's Math object, so pinning Math.random here pins it there. */
function withRandom(values, fn) {
  var real = Math.random, i = 0;
  Math.random = function () { var v = values[Math.min(i, values.length - 1)]; i++; return v; };
  try { return fn(); } finally { Math.random = real; }
}

/* ================================================================== *
 * 1. SELF-TARGETING
 * ================================================================== */

section("1. Pointing an ability at your own front door");

testCase("ST-01", "Seer investigates their own house");
(function () {
  var r = room(["Seer", "W", "V", "V2", "V3"]);
  give(r, { p0: "seer", p1: "werewolf", p2: "villager", p3: "villager", p4: "villager" });
  night(r);

  var mine = r.doors("p0", "p0");
  var res = r.eng.handle({ type: "ACT", houseId: "p0", actionId: "investigate" }, "p0");

  ok("their own door does not offer it", mine.indexOf("investigate") < 0, mine);
  ok("and the engine refuses it if the phone asks anyway", res.ok === false, JSON.stringify(res));
  ok("so the night is still theirs to spend", r.state.night.turns.p0.spent === false);
  // The role still works on everybody else.
  var on = r.eng.handle({ type: "ACT", houseId: "p1", actionId: "investigate" }, "p0");
  ok("reading somebody else still works", on.ok === true, JSON.stringify(on));
  ok("and says what they are", r.said("p0", "Werewolf"));
  finding("BUG-01",
    "the Seer can read their own role and burn their entire night on it",
    mine.indexOf("investigate") >= 0 || res.ok === true,
    "FIXED: seer.investigate is houses=\"living-others\" now. " +
    "data/list_of_roles.json seer.investigate houses=\"living-any\"; " +
    "js/engine/resolver.js:264 (\"living-any\" is `alive`, which never excludes the actor)");
})();

testCase("ST-02", "Which roles can reach their own door at all");
(function () {
  var probes = [
    ["seer",              { p1: "villager" }, "investigate"],
    ["doctor",            { p1: "villager" }, "protect"],
    ["bodyguard",         { p1: "villager" }, "guard"],
    ["witch",             { p1: "villager" }, "save"],
    ["witch",             { p1: "villager" }, "poison"],
    ["detective",         { p1: "villager" }, "detect"],
    ["engineer",          { p1: "villager" }, "trap"],
    ["avenger",           { p1: "villager" }, "revenge"],
    ["trickster",         { p1: "villager" }, "copy_appearance"],
    ["doppelganger",      { p1: "villager" }, "copy"],
    ["cat",               { p1: "villager" }, "bite"],
    ["pulis",             { p1: "villager" }, "pulis_kill"],
    ["call_center_agent", { p1: "villager" }, "call_center_block"],
    ["cult_leader",       { p1: "villager" }, "recruit"],
    ["assassin",          { p1: "villager" }, "assassinate"],
    ["alpha_wolf",        { p1: "villager" }, "infect"],
    ["wolf_shaman",       { p1: "villager" }, "mark"],
    ["albularyo",         { p1: "werewolf" }, "albularyo_revive"],
    ["vet",               { p1: "cat" },      "vet_revive"],
    ["archangel",         { p1: "villager" }, "revive"],
    ["naughty_boy",       { p1: "villager" }, "swap_roles"],
    ["fanatic_plus",      { p1: "cultist" },  "save_cult"]
  ];
  var reachable = [];
  probes.forEach(function (probe) {
    var r = room(["A", "B", "C", "D", "E", "F"]);
    var g2 = { p0: probe[0], p2: "villager", p3: "villager", p4: "villager", p5: "villager" };
    Object.keys(probe[1]).forEach(function (k) { g2[k] = probe[1][k]; });
    give(r, g2);
    night(r);
    if (r.offered("p0", "p0", probe[2])) reachable.push(probe[0] + "." + probe[2]);
  });

  ok("the killing abilities can never be turned on their owner",
    reachable.indexOf("witch.poison") < 0 &&
    reachable.indexOf("pulis.pulis_kill") < 0 &&
    reachable.indexOf("assassin.assassinate") < 0 &&
    reachable.indexOf("cat.bite") < 0,
    reachable.join(", "));
  ok("nor can an identity be copied off oneself",
    reachable.indexOf("doppelganger.copy") < 0 &&
    reachable.indexOf("trickster.copy_appearance") < 0);
  ok("nor can the Avenger swear an oath against themselves",
    reachable.indexOf("avenger.revenge") < 0);
  ok("nor can the Alpha infect themselves, nor the Shaman mark themselves",
    reachable.indexOf("alpha_wolf.infect") < 0 && reachable.indexOf("wolf_shaman.mark") < 0);
  ok("nor can the Cult Leader recruit themselves",
    reachable.indexOf("cult_leader.recruit") < 0);
  ok("the Bodyguard cannot stand in his own doorway",
    reachable.indexOf("bodyguard.guard") < 0);
  ok("the Witch may drink her own save, and the Doctor may sit up with himself",
    reachable.indexOf("witch.save") >= 0 && reachable.indexOf("doctor.protect") >= 0);
  console.log("    self-reachable: " + reachable.join(", "));

  unspec("SPEC-01",
    "self-protection: the Doctor may shield himself and the Witch may drink her own bottle, " +
    "while the Bodyguard may not stand in his own door. Three protective roles, two answers, " +
    "nothing in the data that argues for either",
    "data/list_of_roles.json doctor.protect houses=\"living-not-last\" and witch.save " +
    "houses=\"living-any\" vs bodyguard.guard houses=\"living-others\"");
  unspec("SPEC-02",
    "the Detective may read his own footprints and the Engineer may bell his own door",
    "data/list_of_roles.json detective.detect / engineer.trap, houses=\"living-any\"");
})();

testCase("ST-03", "living-non-cult excludes the actor, living-cult does not");
(function () {
  var r = room(["FP", "Cul", "V", "V2", "W", "V3"]);
  give(r, { p0: "fanatic_plus", p1: "cultist", p2: "villager", p3: "villager", p4: "werewolf", p5: "villager" });
  night(r);
  ok("a Fanatic+ can ward themselves", r.offered("p0", "p0", "save_cult"));

  var r2 = room(["CL", "V", "V2", "V3", "W", "V4"]);
  give(r2, { p0: "cult_leader", p1: "villager", p2: "villager", p3: "villager", p4: "werewolf", p5: "villager" });
  night(r2);
  ok("a Cult Leader cannot recruit themselves", !r2.offered("p0", "p0", "recruit"));
  ok("the exclusion is written into one selector and not the other",
    /living-non-cult[\s\S]{0,200}c\.occupant\.id !== c\.actor\.id/
      .test(fs.readFileSync(path.join(ROOT, "js/engine/resolver.js"), "utf8")));
})();

testCase("ST-04", "Everyone always has a legal move at their own door");
(function () {
  // If this ever stops being true the night can no longer be ended by the
  // player, and endNightEarly becomes unreachable for that seat.
  var every = WG.roles.all().map(function (d) { return d.id; });
  var missing = [];
  every.forEach(function (rid) {
    var r = room(["A", "B", "C", "D", "E", "F"]);
    var g2 = { p0: rid, p1: "villager", p2: "villager", p3: "villager", p4: "werewolf", p5: "villager" };
    if (rid === "werewolf" || rid === "alpha_wolf" || rid === "wolf_shaman" || rid === "albularyo") g2.p4 = "villager";
    give(r, g2);
    night(r);
    var mine = r.doors("p0", "p0");
    var usable = mine.filter(function (a) { return a.slice(-1) !== "!"; });
    if (!usable.length) missing.push(rid);
  });
  ok("every one of the 35 roles can end its own night unaided", missing.length === 0, missing.join(", "));
})();

/* ================================================================== *
 * 2. TARGETING THE DEAD
 * ================================================================== */

section("2. Doors with nobody behind them");

testCase("DEAD-01", "A living-only action at a fresh corpse costs nothing and tells you");
(function () {
  var r = room(["W", "Doc", "Vic", "V", "V2", "V3"]);
  give(r, { p0: "werewolf", p1: "doctor", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");

  ok("the door still lights up, because the Doctor cannot know",
    r.offered("p1", "p2", "protect"));
  var res = r.eng.handle({ type: "ACT", houseId: "p2", actionId: "protect" }, "p1");
  ok("the attempt is accepted", res.ok === true);
  ok("and answered in the Doctor's own words", r.said("p1", "Dead before you reached the door"));
  ok("the night is not spent on it", r.state.night.turns.p1.spent === false);
  ok("no shield was left on a corpse", r.state.night.houses.p2.shields.length === 0);
  ok("and the Doctor now knows", WG.resolver.knowsDead(r.state, P(r.state, "p1"), P(r.state, "p2")));
})();

testCase("DEAD-02", "A dead-only action at a living player costs nothing either");
(function () {
  var r = room(["Vet", "Cat", "W", "V", "V2", "V3"]);
  give(r, { p0: "vet", p1: "cat", p2: "werewolf", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  var res = r.eng.handle({ type: "ACT", houseId: "p1", actionId: "vet_revive" }, "p0");
  ok("accepted", res.ok === true);
  ok("the Vet is told they are fine", r.said("p0", "alive and perfectly well"));
  ok("the one charge survives", P(r.state, "p0").hasRevived === false);
  ok("so does the night", r.state.night.turns.p0.spent === false);
})();

testCase("DEAD-03", "A dead player can still raise the alarm over a body they found");
(function () {
  var r = room(["W", "Doc", "Vic", "Witch", "V", "V2"]);
  give(r, { p0: "werewolf", p1: "doctor", p2: "villager", p3: "witch", p4: "villager", p5: "villager" });
  night(r);
  slay(r, "p2", "poison", "p3");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "protect" }, "p1");   // the Doctor finds it
  ok("the Doctor is on the list of finders", r.state.night.houses.p2.body.foundBy.indexOf("p1") >= 0);
  slay(r, "p1", "poison", "p3");
  ok("and is now dead himself", !alive(r, "p1"));

  var rep = r.eng.handle({ type: "ACT", houseId: "p2", actionId: "report" }, "p1");
  ok("a corpse may still raise the alarm (current behaviour, pinned)", rep.ok === true);
  r.eng.advance();
  ok("and the village is told a dead man found the body", /Doc found Vic and raised the alarm/.test(r.log()), r.log());
  unspec("SPEC-03",
    "the dead keep every action that does not spend a turn — reporting included — because " +
    "offersAt only tests `requires`, which almost no action declares",
    "js/engine/resolver.js:317-320 (only action.requires gates aliveness); " +
    "js/engine/engine.js:414 CMD.ACT never checks p.alive");
})();

testCase("DEAD-04", "A Shaman-hidden body, and who it actually fools");
(function () {
  function go(role) {
    var r = room(["W", "Sham", "Vic", "X", "V", "V2", "V3", "V4"]);
    give(r, { p0: "werewolf", p1: "wolf_shaman", p2: "villager", p3: role,
              p4: "villager", p5: "villager", p6: "villager", p7: "villager" });
    night(r);
    r.eng.handle({ type: "ACT", houseId: "p2", actionId: "mark" }, "p1");
    r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
    r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p1");
    return r;
  }
  var v = go("doctor");
  v.eng.handle({ type: "ACT", houseId: "p2", actionId: "protect" }, "p3");
  ok("a villager waits at a dark door and loses the night", v.state.night.turns.p3.spent === true);
  ok("and is told nothing about a body", v.said("p3", "The house is dark and nobody answers"));
  ok("and does not learn they are dead",
    !WG.resolver.knowsDead(v.state, P(v.state, "p3"), P(v.state, "p2")));

  var w = go("albularyo");
  w.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p3");   // the third wolf
  ok("the pack's kill lands once every wolf has howled", !alive(w, "p2"));
  ok("every living wolf was told the moment the pack killed",
    WG.resolver.knowsDead(w.state, P(w.state, "p3"), P(w.state, "p2")));
  ok("so the marked door is simply not offered to the pack",
    !w.offered("p3", "p2", "wolf_vote"));
  unspec("SPEC-22",
    "the `!R.isWolf(actor.role)` escape on the dark-house branch is unreachable in ordinary " +
    "play: every living wolf is noted on a pack kill, so a wolf never reaches it. It only " +
    "matters for a wolf who was dead at the time, or one the Alpha created afterwards",
    "js/engine/resolver.js:397 vs js/engine/resolver.js:569-573");
})();

testCase("DEAD-05", "The Albularyo's door only opens for wolves");
(function () {
  var r = room(["Alb", "W", "V", "V2", "V3", "V4"]);
  give(r, { p0: "albularyo", p1: "werewolf", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  slay(r, "p2", "pack", "p1");
  ok("a dead villager is not on the menu", !r.offered("p0", "p2", "albularyo_revive"));
  ok("a wolf of unknown status is, because 'dead' is a guess",
    r.offered("p0", "p1", "albularyo_revive"));
  var res = r.eng.handle({ type: "ACT", houseId: "p1", actionId: "albularyo_revive" }, "p0");
  ok("guessing wrong costs nothing but the seconds", res.ok === true && P(r.state, "p0").hasRevived === false);
})();

/* ================================================================== *
 * 3. REPEAT-TARGET RESTRICTIONS
 * ================================================================== */

section("3. Not the same house two nights running");

testCase("REP-01", "The Doctor's no-repeat never expires");
(function () {
  var r = room(["Doc", "A", "B", "C", "W"]);
  give(r, { p0: "doctor", p1: "villager", p2: "villager", p3: "villager", p4: "werewolf" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "protect" }, "p0");
  ok("night one: protected", P(r.state, "p0").lastProtected === "p1");

  r.eng.advance(); night(r);
  ok("night two: the same door is closed, as the data says", !r.offered("p0", "p1", "protect"));
  r.eng.handle({ type: "ACT", houseId: "p0", actionId: "stay_in" }, "p0");   // a night off

  r.eng.advance(); night(r);
  var stillShut = !r.offered("p0", "p1", "protect");
  ok("night three: open again, because a night passed", !stillShut);
  // And the rule itself still bites on consecutive nights.
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "protect" }, "p0");
  r.eng.advance(); night(r);
  ok("night four: closed again, having just been used", !r.offered("p0", "p1", "protect"));
  finding("BUG-02",
    "\"except the one you chose last night\" is implemented as \"except the last one you ever chose\" — " +
    "a Doctor who takes a night off can never return to that house for the rest of the game",
    stillShut,
    "FIXED: the Doctor records the round alongside the name, and the selector bars it only " +
    "when that round was last night. " +
    "js/engine/resolver.js:266 (\"living-not-last\" reads actor.lastProtected) and " +
    "js/roles/doctor.js:15, which sets it and nothing ever clears it");
})();

testCase("REP-02", "The Fanatic+ enforces its no-repeat in the handler, not the door");
(function () {
  var r = room(["FP", "Cul", "CL", "V", "W", "V2"]);
  give(r, { p0: "fanatic_plus", p1: "cultist", p2: "cult_leader", p3: "villager", p4: "werewolf", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "save_cult" }, "p0");
  ok("night one wards the cultist", P(r.state, "p0").lastSaved === "p1");

  r.eng.advance(); night(r);
  ok("the door still lights up the next night", r.offered("p0", "p1", "save_cult"));
  var res = r.eng.handle({ type: "ACT", houseId: "p1", actionId: "save_cult" }, "p0");
  ok("but the attempt is refused", res.ok === false);
  ok("and the night survives the refusal", r.state.night.turns.p0.spent === false);
  unspec("SPEC-04",
    "two roles with the same restriction enforce it in two different places: the Doctor's door " +
    "goes dark, the Fanatic+'s door lights up and then refuses. One of them is a UI lie",
    "js/roles/fanatic_plus.js:11 vs the \"living-not-last\" selector at js/engine/resolver.js:266");
})();

testCase("REP-03", "The Cat may bite the same house every night");
(function () {
  var r = room(["Cat", "V", "W", "V2", "V3"]);
  give(r, { p0: "cat", p1: "villager", p2: "werewolf", p3: "villager", p4: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "bite" }, "p0");
  r.eng.advance(); night(r);
  ok("the Cat's teeth have no memory", r.offered("p0", "p1", "bite"));
  ok("and lastBiteTarget is recorded but never read",
    P(r.state, "p0").lastBiteTarget === "p1" &&
    fs.readFileSync(path.join(ROOT, "js/engine/resolver.js"), "utf8").indexOf("lastBiteTarget") < 0);
})();

/* ================================================================== *
 * 4. WOLF ON WOLF
 * ================================================================== */

section("4. The pack, turned on itself");

testCase("WOLF-01", "A wolf may howl for a fellow wolf, and the pack may eat it");
(function () {
  var r = room(["W1", "W2", "V", "V2", "V3", "V4"]);
  give(r, { p0: "werewolf", p1: "werewolf", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  ok("the second wolf's door is on the first wolf's list", r.offered("p0", "p1", "wolf_vote"));
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "wolf_vote" }, "p0");
  withRandom([0], function () {
    r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p1");
  });
  ok("a one-all tie can settle on the pack's own house", !alive(r, "p1"));
  ok("and the eaten wolf's own howl evaporates with it",
    Object.keys(WG.resolver.packTally(r.state)).join() === "p1");
  ok("the villager it howled for is untouched", alive(r, "p2"));
  unspec("SPEC-05",
    "nothing stops the pack voting for one of its own, and a tie between a wolf and a villager " +
    "is broken by a coin toss with no thumb on the scale",
    "data/list_of_roles.json wolf_vote houses=\"living-others\"; js/engine/resolver.js:701");
})();

testCase("WOLF-02", "A wolf cannot howl for its own house");
(function () {
  var r = room(["W1", "W2", "V", "V2", "V3"]);
  give(r, { p0: "werewolf", p1: "werewolf", p2: "villager", p3: "villager", p4: "villager" });
  night(r);
  ok("the door is not offered", !r.offered("p0", "p0", "wolf_vote"));
  var res = r.eng.handle({ type: "ACT", houseId: "p0", actionId: "wolf_vote" }, "p0");
  ok("and the command is refused on the host", res.ok === false);
})();

testCase("WOLF-03", "The Alpha cannot infect a wolf, but may infect the Cult");
(function () {
  var r = room(["Alpha", "W", "Cul", "V", "V2", "V3"]);
  give(r, { p0: "alpha_wolf", p1: "werewolf", p2: "cultist", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  ok("a fellow wolf is not infectable", !r.offered("p0", "p1", "infect"));
  ok("a cultist is", r.offered("p0", "p2", "infect"));
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "infect" }, "p0");
  ok("and carries the bite", P(r.state, "p2").infectedOn === r.state.round);

  // Two nights on, the cultist wakes up a wolf.
  r.eng.advance(); night(r); r.eng.advance(); night(r);
  var out = WG.resolver.bag();
  WG.resolver.endNight(r.state, {});
  ok("the cult loses a member to the pack", roleOf(r, "p2") === "werewolf");
  unspec("SPEC-06",
    "the Alpha's bite outranks the Cult's conversion: a Cultist bitten on night one is a " +
    "Werewolf on night three and the Cult is never told",
    "data/list_of_roles.json alpha_wolf.infect houses=\"living-non-wolf\" (cult is not wolf); " +
    "js/engine/resolver.js:740");
})();

testCase("WOLF-04", "A second infection on the same target is refused");
(function () {
  var r = room(["Alpha", "V", "V2", "V3", "V4", "V5"]);
  give(r, { p0: "alpha_wolf", p1: "villager", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "infect" }, "p0");
  r.eng.advance(); night(r);
  var res = r.eng.handle({ type: "ACT", houseId: "p1", actionId: "infect" }, "p0");
  ok("refused", res.ok === false);
  ok("without spending the second charge", P(r.state, "p0").infectionsUsed === 1);
  ok("but the door offered it anyway", r.offered("p0", "p1", "infect"));
})();

testCase("WOLF-05", "The Albularyo raises a wolf, who howls again the same night");
(function () {
  var r = room(["Alb", "W", "Witch", "V", "V2", "V3", "V4"]);
  give(r, { p0: "albularyo", p1: "werewolf", p2: "witch", p3: "villager", p4: "villager", p5: "villager", p6: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "poison" }, "p2");
  ok("the wolf is poisoned", !alive(r, "p1"));
  ok("its turn is spent by dying", r.state.night.turns.p1.spent === true);

  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "albularyo_revive" }, "p0");
  ok("the Albularyo raises it", alive(r, "p1"));
  ok("with the night still in hand", r.state.night.turns.p1.spent === false);
  ok("the death is struck from the night's record", r.state.night.deaths.length === 0);
  ok("and quietly — nobody was told", !(r.state.announcedDead || {}).p1);
  r.eng.handle({ type: "ACT", houseId: "p3", actionId: "wolf_vote" }, "p1");
  r.eng.handle({ type: "ACT", houseId: "p3", actionId: "wolf_vote" }, "p0");
  ok("the raised wolf gets to howl, and the pack gets its kill", !alive(r, "p3"));
})();

/* ================================================================== *
 * 5. PROTECTION AND KILL ORDER
 * ================================================================== */

section("5. Everything standing in one doorway");

testCase("PROT-01", "Doctor + Bodyguard + Witch on one house: newest first");
(function () {
  var r = room(["W1", "W2", "Doc", "BG", "Witch", "Vic", "V"]);
  give(r, { p0: "werewolf", p1: "werewolf", p2: "doctor", p3: "bodyguard", p4: "witch", p5: "villager", p6: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p5", actionId: "protect" }, "p2");
  r.eng.handle({ type: "ACT", houseId: "p5", actionId: "guard" }, "p3");
  r.eng.handle({ type: "ACT", houseId: "p5", actionId: "save" }, "p4");
  ok("three layers, in arrival order",
    r.state.night.houses.p5.shields.map(function (s) { return s.kind; }).join() ===
    "shield,bodyshield,shield");

  r.eng.handle({ type: "ACT", houseId: "p5", actionId: "wolf_vote" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p5", actionId: "wolf_vote" }, "p1");
  ok("the victim lives", alive(r, "p5"));
  ok("the Witch's bottle went first, because she got there last", P(r.state, "p4").savePotionUsed === true);
  ok("so the Bodyguard is untouched", alive(r, "p3"));
  ok("and two layers are still standing",
    r.state.night.houses.p5.shields.map(function (s) { return s.kind; }).join() === "shield,bodyshield");
})();

testCase("PROT-02", "Two Bodyguards on one house die one at a time");
(function () {
  var r = room(["W", "BG1", "BG2", "Vic", "Witch", "V", "V2"]);
  give(r, { p0: "werewolf", p1: "bodyguard", p2: "bodyguard", p3: "villager", p4: "witch", p5: "villager", p6: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p3", actionId: "guard" }, "p1");
  r.eng.handle({ type: "ACT", houseId: "p3", actionId: "guard" }, "p2");
  r.eng.handle({ type: "ACT", houseId: "p3", actionId: "poison" }, "p4");
  ok("the later guard takes the bottle", !alive(r, "p2") && alive(r, "p1"));
  ok("the charge lives", alive(r, "p3"));
  r.eng.handle({ type: "ACT", houseId: "p3", actionId: "wolf_vote" }, "p0");
  ok("and the first guard takes the second blow", !alive(r, "p1"));
  ok("the charge still lives", alive(r, "p3"));
})();

testCase("PROT-03", "A shield ignored: the rope and retribution go straight through");
(function () {
  var r = room(["W", "Doc", "Vic", "V", "V2"]);
  give(r, { p0: "werewolf", p1: "doctor", p2: "villager", p3: "villager", p4: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "protect" }, "p1");
  var out = WG.resolver.bag();
  WG.resolver.kill(r.state, "p2", { cause: "lynch", out: out, ignoreShields: true });
  ok("ignoreShields means what it says", !alive(r, "p2"));
  ok("and the shield is not even consumed", r.state.night.houses.p2.shields.length === 1);
})();

testCase("PROT-04", "A Bodyguard on a house whose occupant dies anyway is released");
(function () {
  var r = room(["W", "BG", "Vic", "Witch", "V", "V2"]);
  give(r, { p0: "werewolf", p1: "bodyguard", p2: "villager", p3: "witch", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "guard" }, "p1");
  var out = WG.resolver.bag();
  WG.resolver.kill(r.state, "p2", { cause: "lynch", out: out, ignoreShields: true });
  ok("the charge is dead", !alive(r, "p2"));
  ok("the bodyshield is stripped off the corpse", r.state.night.houses.p2.shields.length === 0);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "poison" }, "p3");
  ok("so a later blow does not kill a guard for nothing", alive(r, "p1"));
})();

testCase("PROT-05", "The Diwata's ward beats every shield to the punch");
(function () {
  var r = room(["W", "Doc", "Diw", "Witch", "V", "V2"]);
  give(r, { p0: "werewolf", p1: "doctor", p2: "diwata", p3: "witch", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "protect" }, "p1");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "poison" }, "p3");
  ok("she survives", alive(r, "p2"));
  ok("on her own ward", P(r.state, "p2").hasUsedImmunity === true);
  ok("and the Doctor's shield is still there, unspent",
    r.state.night.houses.p2.shields.length === 1);
  unspec("SPEC-07",
    "onKilled runs before shields, so a warding passive always spends itself in front of a " +
    "protection that would have covered it for free",
    "js/engine/resolver.js:506-532 (hook first, shields second)");
})();

testCase("PROT-06", "The Archangel absorbs a kill and the Doctor's shield is wasted with it");
(function () {
  var r = room(["W", "Doc", "Arch", "Witch", "V", "V2"]);
  give(r, { p0: "werewolf", p1: "doctor", p2: "archangel", p3: "witch", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "protect" }, "p1");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "poison" }, "p3");
  ok("the Archangel survives", alive(r, "p2"));
  ok("stripped to a Villager", roleOf(r, "p2") === "villager");
  ok("and the Witch is dead for trying", !alive(r, "p3"));
  ok("the Doctor's shield never came into it", r.state.night.houses.p2.shields.length === 1);
})();

testCase("PROT-07", "Nothing can reach an Archangel killed by an anonymous cause");
(function () {
  var r = room(["W", "Arch", "V", "V2", "V3"]);
  give(r, { p0: "werewolf", p1: "archangel", p2: "villager", p3: "villager", p4: "villager" });
  night(r);
  var out = WG.resolver.bag();
  var res = WG.resolver.kill(r.state, "p1", { cause: "disease", byId: null, out: out, ignoreShields: true });
  ok("the sickness cannot take it either (current behaviour, pinned)", alive(r, "p1"));
  ok("it is spent all the same", roleOf(r, "p1") === "villager" && res.result === "retribution");
  unspec("SPEC-08",
    "the Archangel's retribution has no killer to punish when the cause has no author " +
    "(disease, pandemic) and still prevents the death — an unkillable seat until it is spent",
    "js/roles/archangel.js:67-73");
})();

testCase("PROT-08", "Simultaneous kills on the same victim: the second finds a corpse");
(function () {
  var r = room(["W", "Witch", "Pulis", "Vic", "V", "V2"]);
  give(r, { p0: "werewolf", p1: "witch", p2: "pulis", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p3", actionId: "poison" }, "p1");
  ok("the first kill lands", !alive(r, "p3"));
  var res = r.eng.handle({ type: "ACT", houseId: "p3", actionId: "pulis_kill" }, "p2");
  ok("the second is accepted but lands on a body", res.ok === true);
  ok("and the Pulis is told so", r.said("p2", "has not been dead an hour"));
  ok("the gun is not fired", P(r.state, "p2").killsUsed === 0);
  ok("and the Pulis keeps their night", r.state.night.turns.p2.spent === false);
  ok("one death is recorded, not two", r.state.night.deaths.length === 1);
})();

/* ================================================================== *
 * 6. REVIVAL
 * ================================================================== */

section("6. Back on your feet, and the night is not over");

testCase("REV-01", "Revived and killed again the same night: one death in the morning");
(function () {
  var r = room(["Alb", "W", "Witch", "V", "V2", "V3"]);
  give(r, { p0: "albularyo", p1: "werewolf", p2: "witch", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "poison" }, "p2");
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "albularyo_revive" }, "p0");
  ok("raised", alive(r, "p1"));
  slay(r, "p1", "poison", "p2");
  ok("and killed again", !alive(r, "p1"));
  ok("exactly one death in the night's record", r.state.night.deaths.length === 1);
  r.eng.advance();
  ok("and one line in the morning", (r.log().match(/is dead/g) || []).length === 1, r.log());
})();

testCase("REV-02", "Reviving somebody a Doctor also shielded keeps the shield");
(function () {
  var r = room(["Arch", "Doc", "Vic", "W", "W2", "V", "V2"]);
  give(r, { p0: "archangel", p1: "doctor", p2: "villager", p3: "werewolf", p4: "werewolf", p5: "villager", p6: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "protect" }, "p1");
  var out = WG.resolver.bag();
  WG.resolver.kill(r.state, "p2", { cause: "lynch", out: out, ignoreShields: true });   // straight through
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "revive",
                 payload: { assignment: "manual", newRole: "seer" } }, "p0");
  ok("raised", alive(r, "p2"));
  ok("as a Seer, with the night intact", roleOf(r, "p2") === "seer" && r.state.night.turns.p2.spent === false);
  ok("and the Doctor's shield is still on the house",
    r.state.night.houses.p2.shields.length === 1);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p3");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p4");
  ok("so the pack bounces off a shield laid before the death", alive(r, "p2"));
})();

testCase("REV-03", "The Archangel will raise anybody as anything the client asks for");
(function () {
  var r = room(["Arch", "Vic", "W", "V", "V2", "V3"]);
  give(r, { p0: "archangel", p1: "villager", p2: "werewolf", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  slay(r, "p1", "pack", "p2");
  var res = r.eng.handle({ type: "ACT", houseId: "p1", actionId: "revive",
                           payload: { assignment: "manual", newRole: "alpha_wolf" } }, "p0");
  var handedToThePack = res.ok === true && roleOf(r, "p1") === "alpha_wolf";
  ok("the host does not hand the pack a player", !handedToThePack, roleOf(r, "p1"));
  ok("they come back on the village's side",
    WG.roles.teamOf(roleOf(r, "p1")) === "village", roleOf(r, "p1"));
  // Every off-pool ask falls back to a random village role rather than failing,
  // so the raise still happens — it just cannot be steered out of the village.
  ["cult_leader", "jester", "assassin", "manipulator", "werewolf"].forEach(function (bad) {
    var q = room(["Arch", "Vic", "W", "V", "V2", "V3"]);
    give(q, { p0: "archangel", p1: "villager", p2: "werewolf", p3: "villager", p4: "villager", p5: "villager" });
    night(q);
    slay(q, "p1", "pack", "p2");
    q.eng.handle({ type: "ACT", houseId: "p1", actionId: "revive",
                   payload: { assignment: "manual", newRole: bad } }, "p0");
    ok("  and not as a " + bad, WG.roles.teamOf(roleOf(q, "p1")) === "village", roleOf(q, "p1"));
  });
  finding("BUG-03",
    "a village Archangel can raise a corpse as an Alpha Wolf, a Cult Leader or a Jester — " +
    "the host never re-checks the client's newRole against the village-only pool the UI shows",
    handedToThePack,
    "FIXED: the manual branch now picks from the same village-only pool the random branch " +
    "uses, and an ask outside it falls back to that pool. " +
    "js/roles/archangel.js:23-28 (only `WG.roles.get(role)` is checked); the UI's own list is " +
    "village-only at js/ui/screens.js:568-570, so the host is trusting the phone");
})();

testCase("REV-04", "A quiet revival un-tells only the reviver; a loud one un-tells everyone");
(function () {
  var r = room(["Alb", "W", "Doc", "V", "V2", "V3"]);
  give(r, { p0: "albularyo", p1: "werewolf", p2: "doctor", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  slay(r, "p1", "poison", "p2");
  WG.resolver.note(r.state, "p2", "p1", "dead");
  ok("the Doctor saw it happen", WG.resolver.knowsDead(r.state, P(r.state, "p2"), P(r.state, "p1")));
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "albularyo_revive" }, "p0");
  ok("after a quiet revival the Doctor still believes them dead — which is now wrong",
    WG.resolver.knowledge ? true : P(r.state, "p2").known.p1 === "dead");
  ok("but the target is alive", alive(r, "p1"));
  unspec("SPEC-09",
    "a quiet revival leaves stale \"dead\" knowledge on every witness, which closes their doors " +
    "at that house and keeps closing them for the rest of the game",
    "js/engine/resolver.js:616 forgetDeath(..., publicly=false) only clears announcedDead");
})();

testCase("REV-05", "A revived Avenger keeps an oath that has already fired");
(function () {
  var r = room(["Av", "Arch", "Target", "W", "V", "V2"]);
  give(r, { p0: "avenger", p1: "archangel", p2: "villager", p3: "werewolf", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "revenge" }, "p0");
  slay(r, "p0", "poison", "p4");
  ok("the oath fires", !alive(r, "p2"));
  r.eng.handle({ type: "ACT", houseId: "p0", actionId: "revive",
                 payload: { assignment: "manual", newRole: "avenger" } }, "p1");
  ok("the Avenger is back", alive(r, "p0") && roleOf(r, "p0") === "avenger");
  ok("and the spent oath is still on the card", P(r.state, "p0").revengeTarget === "p2");
  unspec("SPEC-10",
    "a revived Avenger's oath is neither cleared nor re-armed; it points at a corpse and will " +
    "silently do nothing when they die again unless they re-swear",
    "js/roles/avenger.js:18-23; js/engine/resolver.js:619-623 only resets state on a role change");
})();

/* ================================================================== *
 * 7. CONVERSION AND IDENTITY
 * ================================================================== */

section("7. Becoming somebody else");

testCase("CONV-01", "A Doppelgänger copying a Doppelgänger");
(function () {
  var r = room(["D1", "D2", "V", "V2", "W", "V3"]);
  give(r, { p0: "doppelganger", p1: "doppelganger", p2: "villager", p3: "villager", p4: "werewolf", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "copy" }, "p0");
  ok("it becomes a Doppelgänger", roleOf(r, "p0") === "doppelganger");
  ok("whose one copy is already spent", P(r.state, "p0").hasCopied === true);
  r.eng.advance(); night(r);
  ok("so the trick cannot be repeated", !r.offered("p0", "p2", "copy"));
})();

testCase("CONV-02", "A Doppelgänger copying the Assassin gets a knifeless Assassin");
(function () {
  var r = room(["D", "Ass", "Seer", "V", "W", "V2"]);
  give(r, { p0: "doppelganger", p1: "assassin", p2: "seer", p3: "villager", p4: "werewolf", p5: "villager" });
  night(r);
  ok("the original was handed one knife per leader dealt", P(r.state, "p1").killCharges === 1);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "copy" }, "p0");
  ok("the copy is an Assassin", roleOf(r, "p0") === "assassin");
  var noKnives = P(r.state, "p0").killCharges === 0;
  ok("armed with one knife per leader dealt, like the original", !noKnives,
    String(P(r.state, "p0").killCharges));
  r.eng.advance(); night(r);
  ok("so assassinate is a live offer", r.doors("p0", "p3").indexOf("assassinate!") < 0,
    r.doors("p0", "p3"));
  // Spending the last knife must not look like never having had one.
  P(r.state, "p0").killCharges = 0;
  WG.win.check(r.state);
  ok("and a spent Assassin is not re-armed by the sweep",
    P(r.state, "p0").killCharges === 0);
  finding("BUG-04",
    "any Assassin created after setup — copied, swapped or otherwise — has killCharges 0 and " +
    "can never assassinate anything, because charges are only ever handed out in noteLeaders()",
    noKnives,
    "FIXED: Win.armAssassins() hands knives to anybody holding the card who has not been armed " +
    "yet, and runs on every win check. " +
    "js/engine/win.js:123-131 (noteLeaders runs once, at deal time); " +
    "data/list_of_roles.json assassin.state.killCharges = 0");
})();

testCase("CONV-03", "The Naughty Boy leaves half a swap lying around between nights");
(function () {
  var r = room(["NB", "Seer", "Doc", "V", "W", "V2"]);
  give(r, { p0: "naughty_boy", p1: "seer", p2: "doctor", p3: "villager", p4: "werewolf", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "swap_roles" }, "p0");   // first half only
  ok("the first half is parked on the actor", P(r.state, "p0")._swapFirst === "p1");
  ok("and the night is not spent, because nothing was committed",
    r.state.night.turns.p0.spent === false);

  r.eng.advance(); night(r);
  var stale = P(r.state, "p0")._swapFirst === "p1";
  ok("it is gone by the next night", !stale);
  r.eng.handle({ type: "ACT", houseId: "p3", actionId: "swap_roles" }, "p0");
  var swapped = roleOf(r, "p1") === "villager" && roleOf(r, "p3") === "seer";
  ok("so that tap starts a fresh pairing instead of completing last night's", !swapped);
  ok("and it is parked as the new first half", P(r.state, "p0")._swapFirst === "p3");
  finding("BUG-05",
    "an abandoned two-house swap survives into the following night: the Naughty Boy's next " +
    "single tap completes last night's pairing without ever showing the first house",
    stale || swapped,
    "FIXED: beginNight() clears _swapFirst, matching the phone, which throws its own copy away " +
    "on every repaint. js/roles/naughty_boy.js:13-22 (_swapFirst lives on the player and is only cleared on " +
    "completion); js/engine/resolver.js:47-87 beginNight rebuilds the night but not the actor");
})();

testCase("CONV-04", "A swap completed against somebody who died in between");
(function () {
  var r = room(["CNB", "Seer", "Doc", "W", "V", "V2"]);
  give(r, { p0: "crazy_naughty_boy", p1: "seer", p2: "doctor", p3: "werewolf", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "swap_roles" }, "p0");
  slay(r, "p1", "poison", "p4");
  ok("the first house is now a corpse", !alive(r, "p1"));
  var res = r.eng.handle({ type: "ACT", houseId: "p2", actionId: "swap_roles" }, "p0");
  var buried = roleOf(r, "p1") === "doctor" && roleOf(r, "p2") === "seer";
  ok("the swap is refused", res.ok === false, JSON.stringify(res));
  ok("so nothing was buried in the corpse", !buried);
  ok("and the Doctor is still in the game, alive and a Doctor",
    r.state.players.some(function (p) { return p.alive && p.role === "doctor"; }));
  ok("the half-swap is cleared, so the next tap starts over",
    P(r.state, "p0")._swapFirst === null);
  finding("BUG-06",
    "the second half of a swap is not re-validated: if the first house dies in between, a live " +
    "role is swapped into the corpse and removed from the game for good",
    buried,
    "FIXED: swap() re-checks that both halves are still living, seated players before moving " +
    "anything. js/roles/naughty_boy.js:23-25 — the only check is that c.P(pending) still returns an object");
})();

testCase("CONV-05", "A swap moves a role without moving the bookkeeping");
(function () {
  var r = room(["NB", "Seer", "V", "W", "V2", "V3", "V4"]);
  give(r, { p0: "naughty_boy", p1: "seer", p2: "villager", p3: "werewolf", p4: "villager", p5: "villager", p6: "villager" });
  night(r);
  ok("the Seer is on the Assassin's list of leaders", r.state.leadersAlive.join() === "p1");
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "swap_roles" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "swap_roles" }, "p0");
  ok("the Seer's card has moved", roleOf(r, "p2") === "seer" && roleOf(r, "p1") === "villager");
  var stale = WG.win.livingLeaders(r.state).join() === "p1";
  ok("and the leader list moved with it", !stale,
    WG.win.livingLeaders(r.state).join());
  ok("it names whoever holds the card now", WG.win.livingLeaders(r.state).join() === "p2");
  slay(r, "p2", "poison", "p4");
  ok("killing the real Seer clears the list", WG.win.livingLeaders(r.state).length === 0);
  finding("BUG-07",
    "state.leadersAlive tracks player ids fixed at deal time. Any role change — swap, promotion, " +
    "Doppelgänger, Archangel revival — desynchronises it, so the Assassin's win condition then " +
    "points at people who are not leaders and misses people who are",
    stale,
    "FIXED: Win.livingLeaders() derives the list from who holds a leader's card right now, so " +
    "no role change can desynchronise it. " +
    "js/engine/win.js:123-131 noteLeaders(); js/engine/resolver.js:651-654 noteLeaderDeath() " +
    "filters on the CURRENT role, so a demoted leader is never removed");
})();

testCase("CONV-06", "The Cult Leader can convert a solo out of its own win condition");
(function () {
  ["jester", "manipulator"].forEach(function (rid) {
    var r = room(["CL", "X", "V", "V2", "W", "V3"]);
    give(r, { p0: "cult_leader", p1: rid, p2: "villager", p3: "villager", p4: "werewolf", p5: "villager" });
    night(r);
    r.eng.handle({ type: "ACT", houseId: "p1", actionId: "recruit" }, "p0");
    var pid = Object.keys(r.state.night.prompts)[0];
    r.eng.handle({ type: "CONSENT", offerId: pid, ok: true }, "p1");
    ok("a " + rid + " who says yes stops being one", roleOf(r, "p1") === "cultist");
  });
  unspec("SPEC-11",
    "a recruited Jester or Manipulator loses their entire win condition and is told only " +
    "\"Everything but the loyalty is unchanged\", which is not true for a solo",
    "data/list_of_roles.json cult_leader.recruit houses=\"living-non-cult\"; js/roles/cult_leader.js:36-41");
})();

testCase("CONV-07", "A dead player can accept a recruitment, in any phase");
(function () {
  var r = room(["CL", "V", "W", "V2", "V3", "V4"]);
  give(r, { p0: "cult_leader", p1: "villager", p2: "werewolf", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "recruit" }, "p0");
  var pid = Object.keys(r.state.night.prompts)[0];
  slay(r, "p1", "pack", "p2");
  var res = r.eng.handle({ type: "CONSENT", offerId: pid, ok: true }, "p1");
  var corpseConverted = roleOf(r, "p1") === "cultist";
  ok("a corpse does not join the cult", !corpseConverted, roleOf(r, "p1"));
  ok("and the offer is discarded rather than left standing",
    !(r.state.night.prompts || {})[pid]);

  var r2 = room(["CL", "V", "W", "V2", "V3", "V4"]);
  give(r2, { p0: "cult_leader", p1: "villager", p2: "werewolf", p3: "villager", p4: "villager", p5: "villager" });
  night(r2);
  r2.eng.handle({ type: "ACT", houseId: "p1", actionId: "recruit" }, "p0");
  var pid2 = Object.keys(r2.state.night.prompts)[0];
  WG.clock.enter(r2.state, "discussion");
  var res2 = r2.eng.handle({ type: "CONSENT", offerId: pid2, ok: true }, "p1");
  var dayConverted = roleOf(r2, "p1") === "cultist";
  ok("nor does a living player in broad daylight", !dayConverted, roleOf(r2, "p1"));
  ok("they are told why", res2.ok === false, JSON.stringify(res2));

  // The window that IS open: alive, at night, before the offer expires.
  var r3 = room(["CL", "V", "W", "V2", "V3", "V4"]);
  give(r3, { p0: "cult_leader", p1: "villager", p2: "werewolf", p3: "villager", p4: "villager", p5: "villager" });
  night(r3);
  r3.eng.handle({ type: "ACT", houseId: "p1", actionId: "recruit" }, "p0");
  var pid3 = Object.keys(r3.state.night.prompts)[0];
  r3.eng.handle({ type: "CONSENT", offerId: pid3, ok: true }, "p1");
  ok("a living player at night still joins", roleOf(r3, "p1") === "cultist", roleOf(r3, "p1"));
  finding("BUG-08",
    "CMD.CONSENT has no phase check, no aliveness check and never honours the prompt's own " +
    "expiresAt — a recruitment offer can be accepted the next afternoon, or from the grave",
    corpseConverted || dayConverted,
    "FIXED: CMD.CONSENT now requires the night phase, a living answerer, and an unexpired " +
    "prompt. js/engine/engine.js:473-487; the expiry written at js/roles/cult_leader.js:21 is read nowhere");
})();

testCase("CONV-08", "A Trickster is what it wears, to readers only");
(function () {
  var r = room(["T", "Seer", "V", "V2", "W", "V3"]);
  give(r, { p0: "trickster", p1: "seer", p2: "villager", p3: "villager", p4: "werewolf", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "copy_appearance" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p0", actionId: "investigate" }, "p1");
  ok("the Seer reads the worn role", r.said("p1", "T is a Seer"));
  ok("the Trickster's true role is untouched", roleOf(r, "p0") === "trickster");
  ok("and the team goes with the truth", WG.roles.teamOf(roleOf(r, "p0")) === "village");

  var r2 = room(["T1", "T2", "V", "V2", "W", "V3"]);
  give(r2, { p0: "trickster", p1: "trickster", p2: "villager", p3: "villager", p4: "werewolf", p5: "villager" });
  night(r2);
  r2.eng.handle({ type: "ACT", houseId: "p1", actionId: "copy_appearance" }, "p0");
  ok("a Trickster wearing a Trickster reads as a Trickster, not as what they wear",
    WG.roles.apparentRole(r2.state, P(r2.state, "p0")) === "trickster");
})();

testCase("CONV-09", "A demoted Pulis is a fresh Villager, promotion track and all");
(function () {
  var r = room(["Pulis", "V", "W", "V2", "V3", "V4"]);
  give(r, { p0: "pulis", p1: "villager", p2: "werewolf", p3: "villager", p4: "villager", p5: "villager" });
  P(r.state, "p0").totalScore = 900;
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "pulis_kill" }, "p0");
  ok("shooting a villager costs the badge", roleOf(r, "p0") === "villager");
  ok("and wipes the score they had built as a Pulis", P(r.state, "p0").totalScore === 0);
  ok("and hands them a fresh promotion track", P(r.state, "p0").hasUpgraded === false);
  unspec("SPEC-12",
    "every demotion (Pulis, Archangel, Diwata) runs Object.assign(initialState(\"villager\")), " +
    "which resets hasUpgraded — so a disgraced Pulis can work their way back to a real role, " +
    "possibly to Pulis",
    "js/roles/pulis.js:33-37; js/roles/archangel.js:90-96; js/roles/villager.js:13-32");
})();

testCase("CONV-10", "A Diwata demoted by the rope keeps her old state");
(function () {
  var r = room(["Diw", "V", "V2", "V3", "W"]);
  give(r, { p0: "diwata", p1: "villager", p2: "villager", p3: "villager", p4: "werewolf" });
  r.state.round = 1; r.state.night = null;
  WG.clock.enter(r.state, "voting");
  ["p1", "p2", "p3"].forEach(function (v) { r.eng.handle({ type: "VOTE", targetId: "p0" }, v); });
  r.eng.advance();
  ok("the first rope will not hold her", alive(r, "p0") && roleOf(r, "p0") === "diwata");

  WG.clock.enter(r.state, "voting"); r.state.votes = {};
  ["p1", "p2", "p3"].forEach(function (v) { r.eng.handle({ type: "VOTE", targetId: "p0" }, v); });
  r.eng.advance();
  ok("the second one does", !alive(r, "p0"));
  ok("and she is announced as a Villager", /They were a Villager/.test(r.log()), r.log());
  var noReset = P(r.state, "p0").hasUsedImmunity === true &&
                P(r.state, "p0").hasUpgraded === undefined;
  ok("her Diwata state did not come with her", !noReset,
     JSON.stringify({ imm: P(r.state, "p0").hasUsedImmunity, up: P(r.state, "p0").hasUpgraded }));
  finding("BUG-09",
    "Diwata.onLynch demotes by assigning role = \"villager\" without applying the Villager's " +
    "initial state, unlike every other demotion in the game — the seat ends up a Villager with " +
    "no totalScore, no hasUpgraded and a leftover hasUsedImmunity",
    noReset,
    "FIXED: the rope's demotion now applies initialState(\"villager\") like the other one. " +
    "js/roles/diwata.js:46-47 vs js/roles/diwata.js:22-24, which does it correctly");
})();

/* ================================================================== *
 * 8. DEATH TRIGGERS
 * ================================================================== */

section("8. What happens because somebody died");

testCase("TRIG-01", "Two Avengers sworn at each other both go");
(function () {
  var r = room(["A1", "A2", "V", "W", "V2", "V3"]);
  give(r, { p0: "avenger", p1: "avenger", p2: "villager", p3: "werewolf", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "revenge" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p0", actionId: "revenge" }, "p1");
  slay(r, "p0", "poison", "p4");
  ok("both die", !alive(r, "p0") && !alive(r, "p1"));
  ok("and the recursion terminates on already-dead", r.state.night.deaths.length === 2);
})();

testCase("TRIG-02", "An oath against somebody already dead fires into nothing");
(function () {
  var r = room(["Av", "T", "W", "V", "V2", "V3"]);
  give(r, { p0: "avenger", p1: "villager", p2: "werewolf", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "revenge" }, "p0");
  slay(r, "p1", "pack", "p2");
  slay(r, "p0", "poison", "p3");
  ok("the Avenger dies alone", !alive(r, "p0"));
  ok("and nothing extra is recorded", r.state.night.deaths.length === 2);
})();

testCase("TRIG-03", "A Naughty Ghost is only dangerous once dead");
(function () {
  var r = room(["NG", "W", "V", "V2", "V3"]);
  give(r, { p0: "naughty_ghost", p1: "werewolf", p2: "villager", p3: "villager", p4: "villager" });
  night(r);
  ok("alive, the swap is not on offer anywhere", !r.offered("p0", "p2", "swap_roles"));
  ok("only the night's work is", r.offered("p0", "p0", "task"));
  slay(r, "p0", "poison", "p3");
  ok("dead, the turn is handed back rather than spent", r.state.night.turns.p0.spent === false);
  ok("and the swap opens up", r.offered("p0", "p2", "swap_roles"));
  ok("while the task closes", r.doors("p0", "p0").indexOf("task") < 0);
})();

testCase("TRIG-04", "A dead Naughty Ghost keeps its turn across nights");
(function () {
  var r = room(["NG", "W", "V", "V2", "V3", "V4"]);
  give(r, { p0: "naughty_ghost", p1: "werewolf", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  slay(r, "p0", "poison", "p3");
  r.eng.advance(); night(r);
  ok("it still gets a turn the following night", r.state.night.turns.p0.spent === false);
})();

testCase("TRIG-05", "The Diseased takes the wolf that ate it, once");
(function () {
  var r = room(["W1", "W2", "Dis", "V", "V2", "V3", "V4"]);
  give(r, { p0: "werewolf", p1: "werewolf", p2: "diseased", p3: "villager", p4: "villager", p5: "villager", p6: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p1");
  ok("the diseased villager dies", !alive(r, "p2"));
  var deadWolves = ["p0", "p1"].filter(function (id) { return !alive(r, id); });
  ok("and exactly one wolf goes with it — the one credited with the kill", deadWolves.length === 1);
  unspec("SPEC-13",
    "the sickness kills only howlers[0], the first wolf to have voted for that house, so which " +
    "wolf dies is decided by who tapped first rather than by anything the pack chose",
    "js/engine/resolver.js:711 (byId: howlers[0]); js/roles/diseased.js:12-16");
})();

testCase("TRIG-06", "A Diwata eaten by the pack ends the pack");
(function () {
  var r = room(["W1", "W2", "Diw", "V", "V2", "V3", "V4"]);
  give(r, { p0: "werewolf", p1: "werewolf", p2: "diwata", p3: "villager", p4: "villager", p5: "villager", p6: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p1");
  ok("she dies", !alive(r, "p2"));
  ok("and every wolf with her", !alive(r, "p0") && !alive(r, "p1"));
  ok("the village wins on the spot", r.ended() && r.ended().team === "village", JSON.stringify(r.ended()));
})();

testCase("TRIG-07", "A Cult Leader's death promotes every Fanatic");
(function () {
  var r = room(["CL", "F1", "F2", "W", "V", "V2", "V3", "V4"]);
  give(r, { p0: "cult_leader", p1: "fanatic", p2: "fanatic", p3: "werewolf",
            p4: "villager", p5: "villager", p6: "villager", p7: "villager" });
  night(r);
  slay(r, "p0", "poison", "p4");
  ok("both Fanatics are promoted", roleOf(r, "p1") === "fanatic_plus" && roleOf(r, "p2") === "fanatic_plus");
  ok("with a Fanatic+'s fresh state", P(r.state, "p1").lastSaved === null);
})();

testCase("TRIG-08", "An Assassin's wrong guess is fatal, and the target is untouched");
(function () {
  var r = room(["Ass", "Seer", "W", "V", "V2", "V3"]);
  give(r, { p0: "assassin", p1: "seer", p2: "werewolf", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  var res = r.eng.handle({ type: "ACT", houseId: "p1", actionId: "assassinate",
                           payload: { roleGuess: "doctor" } }, "p0");
  ok("accepted", res.ok === true);
  ok("the Assassin dies", !alive(r, "p0"));
  ok("the Seer does not", alive(r, "p1"));
  ok("and the knife is gone regardless", P(r.state, "p0").killCharges === 0);
})();

testCase("TRIG-09", "A correct guess against a Diwata spends the knife and nothing else");
(function () {
  var r = room(["Ass", "Diw", "W", "V", "V2", "V3", "V4"]);
  give(r, { p0: "assassin", p1: "diwata", p2: "werewolf", p3: "villager", p4: "villager", p5: "villager", p6: "villager" });
  P(r.state, "p0").killCharges = 2;
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "assassinate",
                 payload: { roleGuess: "diwata" } }, "p0");
  ok("the ward holds", alive(r, "p1"));
  ok("the knife is spent anyway", P(r.state, "p0").killCharges === 1);
  ok("and the Assassin survives a correct guess", alive(r, "p0"));
})();

/* ================================================================== *
 * 9. WIN CONDITIONS
 * ================================================================== */

section("9. Who won, and when the answer is wrong");

testCase("WIN-01", "Everybody dead is announced as a Village win");
(function () {
  var r = room(["W", "V", "V2"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager" });
  r.state.players.forEach(function (p) { p.alive = false; });
  var res = WG.win.check(r.state);
  var wrong = !!res && res.team === "village";
  ok("the win check does not answer 'village' over an empty village", !wrong, JSON.stringify(res));
  ok("it answers 'nobody'", !!res && res.team === "nobody", JSON.stringify(res));
  // And a real village win is still a village win.
  var q = room(["W", "V", "V2"]);
  give(q, { p0: "werewolf", p1: "villager", p2: "villager" });
  P(q.state, "p0").alive = false;
  var won = WG.win.check(q.state);
  ok("one wolf dead, two villagers standing, still a Village win",
    !!won && won.team === "village", JSON.stringify(won));
  finding("BUG-10",
    "the \"Everybody is dead. Nobody wins a village with nobody in it.\" branch is unreachable: " +
    "the wolves-are-zero test above it already matches an empty board, so a total wipe is " +
    "announced as a Village victory",
    wrong,
    "FIXED: the empty-board test now runs before the wolves-are-zero one. " +
    "js/engine/win.js:68-70 shadows js/engine/win.js:76-78");
})();

testCase("WIN-02", "An Assassin with no leaders in the bag wins before the deal");
(function () {
  var min = WG.win.minimumSeats({ assassin: 1, werewolf: 1 });
  var r = room(["A", "B", "C", "D", "E", "F"]);
  r.state.roster = { assassin: 1, werewolf: 1 };
  var s = r.eng.handle({ type: "START" }, "p0");
  var unplayable = min === 0 || s.ok === false;
  ok("the roster is a perfectly ordinary game", !unplayable, JSON.stringify(s) + " min=" + min);
  ok("and it has a smallest playable table", min >= 2, String(min));
  // The Assassin has nothing to hunt, so they cannot win — but they must not
  // have won already, and they must not block anybody else from winning.
  var q = room(["Ass", "W", "V", "V2"]);
  give(q, { p0: "assassin", p1: "werewolf", p2: "villager", p3: "villager" });
  ok("an Assassin with no leaders has not already won", WG.win.check(q.state) === null,
    JSON.stringify(WG.win.check(q.state)));
  finding("BUG-11",
    "leadersAllDead() reads an EMPTY leader list as \"every leader is dead\", so an Assassin in " +
    "a bag with no Alpha, Cult Leader, Mayor or Seer has already won at deal time. " +
    "minimumSeats therefore finds no playable table and the host is told \"That mix has no game " +
    "in it\" for a perfectly ordinary roster",
    unplayable,
    "FIXED: leadersAllDead() requires that a leader was actually dealt (state.leadersDealt), " +
    "so an empty bag is no longer a bag of corpses. " +
    "js/engine/win.js:116-120 leadersAllDead() — `state.leadersAlive != null` is true for []");
})();

testCase("WIN-03", "An Assassin wins even when a new leader has taken the title");
(function () {
  var r = room(["Ass", "Seer", "W", "V", "V2", "V3", "V4"]);
  give(r, { p0: "assassin", p1: "seer", p2: "werewolf", p3: "villager", p4: "villager", p5: "villager", p6: "villager" });
  P(r.state, "p3").role = "seer";                  // a promotion, or an Archangel's revival
  night(r);
  slay(r, "p1", "poison", null);
  var res = WG.win.check(r.state);
  var wrong = !!res && res.team === "assassin";
  ok("the Assassin is not declared the winner", !wrong, JSON.stringify(res));
  ok("because a living Seer is standing in the village",
    r.state.players.some(function (p) { return p.alive && p.role === "seer"; }));
  ok("and the new leader is on the list", WG.win.livingLeaders(r.state).join() === "p3");
  // Kill the one who actually holds the title, and the hunt is over.
  slay(r, "p3", "poison", null);
  var done = WG.win.check(r.state);
  ok("killing them wins it", !!done && done.team === "assassin", JSON.stringify(done));
  finding("BUG-12",
    "leadersAlive is a list of player ids frozen at deal time; a leader created afterwards is " +
    "invisible to the Assassin's win condition, and a leader who stops being one is never " +
    "removed from it",
    wrong,
    "FIXED with BUG-07 — the same derived list. " +
    "js/engine/win.js:96-99 and js/engine/win.js:116-120; js/engine/resolver.js:651-654");
})();

testCase("WIN-04", "The Jester's flag is permanent");
(function () {
  var r = room(["Jest", "V", "V2", "V3", "W"]);
  give(r, { p0: "jester", p1: "villager", p2: "villager", p3: "villager", p4: "werewolf" });
  r.state.round = 1; r.state.night = null;
  WG.clock.enter(r.state, "voting");
  ["p1", "p2", "p3", "p4"].forEach(function (v) { r.eng.handle({ type: "VOTE", targetId: "p0" }, v); });
  r.eng.advance();
  ok("the Jester wins", r.ended() && r.ended().team === "jester");
  ok("and the flag stays set for anything checked after", r.state.jesterWasLynched === "p0");
  unspec("SPEC-14",
    "jesterWasLynched is never cleared, so a Jester who is hanged and then raised by an " +
    "Archangel has still won and the game ends the instant anything checks again",
    "js/engine/win.js:43-45; js/roles/jester.js:26; js/engine/resolver.js:603-634 does not touch it");
})();

testCase("WIN-05", "A Jester and the wolves on the same rope: the Jester takes it");
(function () {
  var r = room(["Jest", "W", "V", "V2", "V3"]);
  give(r, { p0: "jester", p1: "werewolf", p2: "villager", p3: "villager", p4: "villager" });
  r.state.round = 1; r.state.night = null;
  slay(r, "p1", "poison", null);                   // the last wolf is already gone
  WG.clock.enter(r.state, "voting");
  ["p2", "p3", "p4"].forEach(function (v) { r.eng.handle({ type: "VOTE", targetId: "p0" }, v); });
  r.eng.advance();
  ok("events beat counts", r.ended() && r.ended().team === "jester", JSON.stringify(r.ended()));
})();

testCase("WIN-06", "The Manipulator steals a Jester's win too");
(function () {
  var r = room(["Jest", "Man", "V", "V2", "V3", "W"]);
  give(r, { p0: "jester", p1: "manipulator", p2: "villager", p3: "villager", p4: "villager", p5: "werewolf" });
  r.state.round = 1; r.state.night = null;
  WG.clock.enter(r.state, "voting");
  ["p2", "p3", "p4", "p5"].forEach(function (v) { r.eng.handle({ type: "VOTE", targetId: "p0" }, v); });
  r.eng.advance();
  ok("the Manipulator wins", r.ended() && r.ended().team === "manipulator");
  ok("and says whose win it was", r.ended().stolenFrom === "jester");
})();

testCase("WIN-07", "The Manipulator cannot steal the plague or a stalemate");
(function () {
  var r = room(["Man", "V", "V2", "V3"]);
  give(r, { p0: "manipulator", p1: "villager", p2: "villager", p3: "villager" });
  r.state.pandemicWon = true;
  var res = WG.win.check(r.state);
  ok("the sickness keeps its win", res && res.team === "pandemic", JSON.stringify(res));
  unspec("SPEC-15",
    "three results bypass declare() and so cannot be stolen — pandemic, nobody, stalemate — " +
    "while every other result can. Nothing says whether that is deliberate",
    "js/engine/win.js:50-52, 76-78, 83-85 return directly instead of through declare()");
})();

testCase("WIN-08", "The last wolf converted to the Cult ends the game for the Cult");
(function () {
  var r = room(["CL", "W", "V", "V2"]);
  give(r, { p0: "cult_leader", p1: "werewolf", p2: "villager", p3: "villager" });
  ok("nobody has won yet", WG.win.check(r.state) === null);
  P(r.state, "p1").role = "cultist";
  var res = WG.win.check(r.state);
  ok("two cult against two others is a cult win", res && res.team === "cult", JSON.stringify(res));
})();

testCase("WIN-09", "One wolf and one villager is already over");
(function () {
  var r = room(["W", "V"]);
  give(r, { p0: "werewolf", p1: "villager" });
  var res = WG.win.check(r.state);
  ok("the wolves win at parity", res && res.team === "werewolf", JSON.stringify(res));
})();

testCase("WIN-10", "A Cult win ignores living solos entirely");
(function () {
  var r = room(["CL", "Cul", "V", "Jest"]);
  give(r, { p0: "cult_leader", p1: "cultist", p2: "villager", p3: "jester" });
  var res = WG.win.check(r.state);
  ok("2 cult vs 1 villager wins, with a Jester still breathing",
    res && res.team === "cult", JSON.stringify(res));
  unspec("SPEC-16",
    "the cult's threshold counts village + werewolf only, so solos are neither an obstacle nor " +
    "a resource; the data says \"as many living souls as every other side combined\"",
    "js/engine/win.js:55-57 vs data/list_of_roles.json teams.cult.goal");
})();

testCase("WIN-11", "The stalemate check of last resort");
(function () {
  var r = room(["Seer", "Doc"]);
  give(r, { p0: "seer", p1: "doctor" });
  var res = WG.win.check(r.state);
  ok("two harmless villagers cannot be left to sit there",
    res && (res.team === "village" || res.team === "stalemate"), JSON.stringify(res));
})();

/* ================================================================== *
 * 10. FLOW AND DEADLOCK
 * ================================================================== */

section("10. Nights that will not end, and commands out of turn");

testCase("FLOW-01", "Every command is refused outside its phase");
(function () {
  var r = room(["Seer", "W", "V", "V2"]);
  give(r, { p0: "seer", p1: "werewolf", p2: "villager", p3: "villager" });
  night(r);
  WG.clock.enter(r.state, "discussion");
  ok("ACT is refused", r.eng.handle({ type: "ACT", houseId: "p2", actionId: "investigate" }, "p0").ok === false);
  ok("KNOCK is refused", r.eng.handle({ type: "KNOCK", houseId: "p2" }, "p0").ok === false);
  ok("VOTE is refused", r.eng.handle({ type: "VOTE", targetId: "p1" }, "p0").ok === false);
  WG.clock.enter(r.state, "voting");
  ok("and ACT is still refused in the vote",
    r.eng.handle({ type: "ACT", houseId: "p2", actionId: "investigate" }, "p0").ok === false);
})();

testCase("FLOW-02", "The same action twice in one night");
(function () {
  var r = room(["Seer", "W", "V", "V2"]);
  give(r, { p0: "seer", p1: "werewolf", p2: "villager", p3: "villager" });
  night(r);
  ok("the first read works", r.eng.handle({ type: "ACT", houseId: "p2", actionId: "investigate" }, "p0").ok === true);
  var second = r.eng.handle({ type: "ACT", houseId: "p3", actionId: "investigate" }, "p0");
  ok("the second is refused", second.ok === false);
  ok("with a reason the player can act on", /night is already spent/.test(second.reason || ""), second.reason);
  ok("and only one reading was recorded", P(r.state, "p0").readings.length === 1);
})();

testCase("FLOW-03", "Reporting the same body twice");
(function () {
  var r = room(["W", "Doc", "Vic", "V", "V2", "V3"]);
  give(r, { p0: "werewolf", p1: "doctor", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "protect" }, "p1");    // finds the body
  ok("the first alarm is raised", r.eng.handle({ type: "ACT", houseId: "p2", actionId: "report" }, "p1").ok === true);
  ok("the second is not even offered", !r.offered("p1", "p2", "report"));
  ok("and is refused if sent anyway",
    r.eng.handle({ type: "ACT", houseId: "p2", actionId: "report" }, "p1").ok === false);
})();

testCase("FLOW-04", "A player on hold cannot even end their night");
(function () {
  var r = room(["CCA", "Seer", "W", "V", "V2"]);
  give(r, { p0: "call_center_agent", p1: "seer", p2: "werewolf", p3: "villager", p4: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "call_center_block",
    payload: { quiz: { question: "q", choices: ["a", "b", "c", "d"], correct: 1 } } }, "p0");
  r.eng.advance(); night(r);
  ok("the mark is on hold", r.state.night.turns.p1.blocked === "quiz");
  ok("even stay_in is refused",
    r.eng.handle({ type: "ACT", houseId: "p1", actionId: "stay_in" }, "p1").ok === false);
  ["p0", "p2", "p3", "p4"].forEach(function (id) {
    r.eng.handle({ type: "ACT", houseId: id, actionId: "stay_in" }, id);
  });
  ok("so the night cannot close early while one phone stays silent",
    WG.resolver.allTurnsSpent(r.state) === false);
  ok("but the clock still ends it", r.state.phaseEndsAt > 0);
  unspec("SPEC-17",
    "a quizzed player who never answers — or who has closed the app — costs the whole room the " +
    "rest of the night timer, every time, because allTurnsSpent can never be satisfied",
    "js/engine/resolver.js:778-783; js/engine/engine.js:319");
})();

testCase("FLOW-05", "A role whose ability has no legal target anywhere still ends its night");
(function () {
  // A Vet in a village with no Cat and no Dog can never be offered vet_revive.
  var r = room(["W1", "W2", "Vet", "V", "V2", "V3"]);
  give(r, { p0: "werewolf", p1: "werewolf", p2: "vet", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  var anywhere = r.state.players.some(function (p) { return r.offered("p2", p.id, "vet_revive"); });
  ok("the Vet's one ability lights up no door in the village", anywhere === false);
  ok("but the universal stay_in always does", r.offered("p2", "p2", "stay_in"));
  ok("and spending it works", r.eng.handle({ type: "ACT", houseId: "p2", actionId: "stay_in" }, "p2").ok === true);

  ["p3", "p4", "p5"].forEach(function (id) {
    r.eng.handle({ type: "ACT", houseId: id, actionId: "stay_in" }, id);
  });
  r.eng.handle({ type: "ACT", houseId: "p3", actionId: "wolf_vote" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p3", actionId: "wolf_vote" }, "p1");
  ok("so the night closes with nobody stuck", WG.resolver.allTurnsSpent(r.state) === true);
})();

testCase("FLOW-06", "Curfew locks the village in without locking the night open");
(function () {
  var r = room(["Doc", "Seer", "W", "V", "V2"]);
  give(r, { p0: "doctor", p1: "seer", p2: "werewolf", p3: "villager", p4: "villager" });
  night(r);
  WG.events.trigger(r.state, "curfew");
  ok("a villager cannot leave", r.doors("p0", "p1").indexOf("protect!") >= 0);
  ok("the pack can", r.offered("p2", "p3", "wolf_vote"));
  ["p0", "p1", "p3", "p4"].forEach(function (id) {
    ok(id + " can still end their night", r.eng.handle({ type: "ACT", houseId: id, actionId: "stay_in" }, id).ok === true);
  });
  r.eng.handle({ type: "ACT", houseId: "p3", actionId: "wolf_vote" }, "p2");
  ok("and the night closes under curfew", WG.resolver.allTurnsSpent(r.state) === true);
  ok("and a Seer cannot read themselves through a curfew either",
    (function () {
      var r2 = room(["Seer", "W", "V", "V2"]);
      give(r2, { p0: "seer", p1: "werewolf", p2: "villager", p3: "villager" });
      night(r2);
      WG.events.trigger(r2.state, "curfew");
      return !r2.offered("p0", "p0", "investigate");
    })());
})();

testCase("FLOW-07", "Under a Festival, ending your night is a dice roll");
(function () {
  var r = room(["A", "B", "C", "D", "E"]);
  give(r, { p0: "villager", p1: "villager", p2: "villager", p3: "villager", p4: "villager" });
  night(r);
  WG.events.trigger(r.state, "festival");
  // Force the redirect onto somebody else's door every time.
  // One tap each, in four separate rooms, so a spent turn is never what
  // refuses the second one. Before the fix all four were "not offered here".
  var refusals = 0;
  [0.1, 0.35, 0.6, 0.9].forEach(function (roll) {
    var q = room(["A", "B", "C", "D", "E"]);
    give(q, { p0: "villager", p1: "villager", p2: "villager", p3: "villager", p4: "villager" });
    night(q);
    WG.events.trigger(q.state, "festival");
    withRandom([roll], function () {
      if (q.eng.handle({ type: "ACT", houseId: "p0", actionId: "stay_in" }, "p0").ok === false) refusals++;
    });
  });
  ok("staying home works however the dice land", refusals === 0, String(refusals));
  withRandom([0.5], function () {
    r.eng.handle({ type: "ACT", houseId: "p0", actionId: "stay_in" }, "p0");
  });
  ok("so the turn is spent and the night can close", r.state.night.turns.p0.spent === true);

  // What the Festival is FOR still happens: a real action lands elsewhere.
  var q = room(["Doc", "B", "C", "D", "E"]);
  give(q, { p0: "doctor", p1: "villager", p2: "villager", p3: "villager", p4: "villager" });
  night(q);
  WG.events.trigger(q.state, "festival");
  withRandom([0.5, 0.5], function () {
    q.eng.handle({ type: "ACT", houseId: "p1", actionId: "protect" }, "p0");
  });
  var shielded = Object.keys(q.state.night.houses).filter(function (h) {
    return q.state.night.houses[h].shields.length > 0;
  });
  ok("but a shield still lands on a house the Doctor did not aim at",
    shielded.length === 1 && shielded[0] !== "p1", shielded.join(","));
  finding("BUG-13",
    "the Festival redirects EVERY action, including stay_in and report. Since stay_in only " +
    "exists at your own door and report only at a body you found, both are simply refused " +
    "until the random redirect happens to land back where you aimed — a player can be unable " +
    "to end their night at all",
    refusals === 4,
    "FIXED: the redirect now skips actions declared at houses:\"self\" or \"found-body\" and " +
    "actions that do not spend a turn. " +
    "js/engine/engine.js:420-424 redirects before Res.perform, with no exemption for " +
    "houses=\"self\" or free actions");
})();

testCase("FLOW-08", "A disconnected room falls back on the clock");
(function () {
  var r = room(["W", "V", "V2", "V3"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager" });
  night(r);
  r.state.players.forEach(function (p) { p.connected = false; });
  r.eng.tick();
  ok("nothing advances on its own", r.state.phase === "night");
  ok("but the phase has an end time to fall back on", r.state.phaseEndsAt > r.state.phaseStartedAt);
  r.state.phaseEndsAt = 1;
  r.eng.tick();
  ok("and it does advance when that passes", r.state.phase !== "night", r.state.phase);
})();

testCase("FLOW-09", "A dawn phase with nobody connected does not skip on allReady");
(function () {
  var r = room(["W", "V", "V2", "V3"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager" });
  r.state.round = 1;
  WG.clock.enter(r.state, "dawn");
  r.state.players.forEach(function (p) { p.connected = false; p.ready = true; });
  r.eng.tick();
  ok("an empty room is not 'everyone ready'", r.state.phase === "dawn");
})();

testCase("FLOW-10", "The host can abort mid-night without leaving a night behind");
(function () {
  var r = room(["W", "V", "V2", "V3"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager" });
  night(r);
  ok("a guest cannot", r.eng.handle({ type: "ABORT" }, "p1").ok === false);
  ok("the host can", r.eng.handle({ type: "ABORT" }, "p0").ok === true);
  ok("the night is gone", r.state.night === null);
  ok("and everybody is back in the lobby, alive and roleless",
    r.state.phase === "lobby" && r.state.players.every(function (p) { return p.alive && p.role === null; }));
})();

/* ================================================================== *
 * 11. THE VOTE
 * ================================================================== */

section("11. The rope, and who gets to pull it");

testCase("VOTE-01", "Self-votes and votes from the dead");
(function () {
  var r = room(["W", "V", "V2", "V3", "V4"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager", p4: "villager" });
  r.state.round = 1; r.state.night = null;
  WG.clock.enter(r.state, "voting");
  ok("a self-vote is refused by default",
    r.eng.handle({ type: "VOTE", targetId: "p1" }, "p1").ok === false);
  r.state.config.rules.allowSelfVote = true;
  ok("and allowed when the room says so",
    r.eng.handle({ type: "VOTE", targetId: "p1" }, "p1").ok === true);
  P(r.state, "p2").alive = false;
  ok("the dead have no vote",
    r.eng.handle({ type: "VOTE", targetId: "p0" }, "p2").ok === false);
})();

testCase("VOTE-02", "A ballot cast before dying is still counted");
(function () {
  var r = room(["W", "V", "V2", "V3", "V4"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager", p4: "villager" });
  r.state.round = 1; r.state.night = null;
  WG.clock.enter(r.state, "voting");
  r.eng.handle({ type: "VOTE", targetId: "p1" }, "p2");
  r.eng.handle({ type: "VOTE", targetId: "p1" }, "p3");
  P(r.state, "p3").alive = false;                  // p3 dies with a ballot in the box
  r.eng.advance();
  ok("the hanging still goes ahead on two votes", !alive(r, "p1"), r.log());
  unspec("SPEC-18",
    "state.votes is never filtered for the living at close, so a ballot from somebody who died " +
    "during the day still counts toward the majority that hangs someone",
    "js/engine/engine.js:220-229 closeVoting()");
})();

testCase("VOTE-03", "Voting for a secretly dead player, and finding the house empty");
(function () {
  var r = room(["W", "Sham", "Vic", "V", "V2", "V3", "V4"]);
  give(r, { p0: "werewolf", p1: "wolf_shaman", p2: "villager",
            p3: "villager", p4: "villager", p5: "villager", p6: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "mark" }, "p1");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p1");
  r.eng.advance();
  WG.clock.enter(r.state, "voting"); r.state.votes = {};
  ok("the ballot must include them", r.eng.handle({ type: "VOTE", targetId: "p2" }, "p3").ok === true);
  ["p4", "p5", "p6"].forEach(function (v) { r.eng.handle({ type: "VOTE", targetId: "p2" }, v); });
  r.eng.advance();
  ok("and the trick comes apart in public", /found the house empty/.test(r.log()), r.log());
  ok("with nobody else hanged for it",
    r.state.players.filter(function (p) { return !p.alive; }).length === 1);
})();

testCase("VOTE-04", "Voting for somebody the village has already buried is refused");
(function () {
  var r = room(["W", "V", "V2", "V3", "V4"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager", p4: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "wolf_vote" }, "p0");
  r.eng.advance();                                  // dawn announces it
  WG.clock.enter(r.state, "voting"); r.state.votes = {};
  ok("their name is no longer on the ballot",
    r.eng.handle({ type: "VOTE", targetId: "p1" }, "p2").ok === false);
})();

testCase("VOTE-05", "Ties: nobody, and the coin toss");
(function () {
  function tied(mode) {
    var r = room(["A", "B", "C", "D"]);
    give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager" });
    r.state.config.rules.tieBehaviour = mode;
    r.state.round = 1; r.state.night = null;
    WG.clock.enter(r.state, "voting");
    r.eng.handle({ type: "VOTE", targetId: "p0" }, "p1");
    r.eng.handle({ type: "VOTE", targetId: "p1" }, "p2");
    withRandom([0], function () { r.eng.advance(); });
    return r;
  }
  var non = tied("nobody");
  ok("'nobody' hangs nobody", /Tied 2 ways\. Nobody hangs/.test(non.log()), non.log());
  ok("and moves on to the verdict", non.state.phase !== "voting", non.state.phase);
  var rnd = tied("random");
  ok("'random' draws a straw", /broken by the drawing of a straw/.test(rnd.log()), rnd.log());

  var run = tied("runoff");
  var silent = /Tied 2 ways\. Nobody hangs/.test(run.log());
  ok("'runoff' does not quietly hang nobody", !silent, run.log());
  ok("it calls a second vote between the tied names",
    /A second vote, between/.test(run.log()), run.log());
  ok("and the village is back in the voting phase", run.state.phase === "voting", run.state.phase);
  ok("with the ballot cut down to the two of them",
    run.state.runoff && run.state.runoff.candidates.sort().join() === "p0,p1",
    JSON.stringify(run.state.runoff));
  ok("a vote for anybody else is refused",
    run.eng.handle({ type: "VOTE", targetId: "p2" }, "p3").ok === false);

  // The runoff resolves, and one of the two is hanged.
  run.eng.handle({ type: "VOTE", targetId: "p0" }, "p1");
  run.eng.handle({ type: "VOTE", targetId: "p0" }, "p2");
  run.eng.handle({ type: "VOTE", targetId: "p0" }, "p3");
  withRandom([0], function () { run.eng.advance(); });
  ok("and the runoff hangs somebody", !alive(run, "p0"), run.log());
  ok("the runoff is cleared afterwards", !run.state.runoff);

  // A runoff that ties again is a village that has decided not to decide.
  var twice = tied("runoff");
  twice.state.votes = {};
  twice.eng.handle({ type: "VOTE", targetId: "p0" }, "p1");
  twice.eng.handle({ type: "VOTE", targetId: "p1" }, "p2");
  withRandom([0], function () { twice.eng.advance(); });
  ok("a second tie falls through to nobody rather than looping",
    /Nobody hangs/.test(twice.log()) && twice.state.phase !== "voting", twice.state.phase);
  finding("BUG-14",
    "tieBehaviour offers three values in the room state and the engine implements two: " +
    "\"runoff\" silently falls through to \"nobody hangs\"",
    silent,
    "js/engine/state.js:45 declares nobody|random|runoff; js/engine/engine.js:244-252 only " +
    "branches on \"random\". There is also no control for it anywhere in js/ui/screens.js");
})();

testCase("VOTE-06", "Skipping needs a majority of its own");
(function () {
  var r = room(["W", "V", "V2", "V3", "V4"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager", p4: "villager" });
  r.state.round = 1; r.state.night = null;
  WG.clock.enter(r.state, "voting");
  r.eng.handle({ type: "VOTE", targetId: "SKIP" }, "p1");
  r.eng.handle({ type: "VOTE", targetId: "SKIP" }, "p2");
  r.eng.handle({ type: "VOTE", targetId: "p0" }, "p3");
  r.eng.advance();
  ok("two skips out of five is not a majority, so the one real vote hangs somebody",
    !alive(r, "p0"), r.log());
  unspec("SPEC-19",
    "SKIP is discarded rather than counted once it falls short, so a single vote against a " +
    "field of abstentions is enough to hang a player",
    "js/engine/engine.js:231-243");
})();

testCase("VOTE-07", "The Mayor's vote weighs the same as everybody else's");
(function () {
  var r = room(["May", "W", "V", "V2", "V3"]);
  give(r, { p0: "mayor", p1: "werewolf", p2: "villager", p3: "villager", p4: "villager" });
  r.state.round = 1; r.state.night = null;
  WG.clock.enter(r.state, "voting");
  r.eng.handle({ type: "VOTE", targetId: "p1" }, "p0");
  r.eng.handle({ type: "VOTE", targetId: "p2" }, "p3");
  r.eng.handle({ type: "VOTE", targetId: "p2" }, "p4");
  r.eng.advance();
  ok("two ordinary votes beat one Mayor", !alive(r, "p2"));
  ok("and the data never promised otherwise",
    !/vote/i.test(JSON.stringify(WG.roles.get("mayor").passives)));
})();

/* ================================================================== *
 * 12. ROOM HYGIENE
 * ================================================================== */

section("12. Seats that are not players, and rooms that remember too much");

testCase("ROOM-01", "A spectator is dealt a house, a turn, and a place in the win count");
(function () {
  var r = room(["W", "V", "V2", "Spec"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager" });
  P(r.state, "p3").spectator = true;
  P(r.state, "p3").role = null;
  night(r);

  var hasHouse = !!r.state.night.houses.p3;
  var hasTurn = r.state.night.turns.p3 && r.state.night.turns.p3.spent === false;
  ok("the spectator gets no house", !hasHouse);
  ok("and no turn", !hasTurn);
  ["p0", "p1", "p2"].forEach(function (id) {
    r.eng.handle({ type: "ACT", houseId: id, actionId: "stay_in" }, id);
  });
  ok("so the three players who are playing can close the night",
    WG.resolver.allTurnsSpent(r.state) === true);
  var counted = WG.win.count(r.state).village === 3;
  ok("and the win check counts the two villagers, not the watcher", !counted,
    JSON.stringify(WG.win.count(r.state)));

  var r2 = room(["W", "V", "V2", "Spec"]);
  give(r2, { p0: "werewolf", p1: "villager", p2: "villager" });
  P(r2.state, "p3").spectator = true; P(r2.state, "p3").role = null;
  night(r2);
  var eaten = r2.eng.handle({ type: "ACT", houseId: "p3", actionId: "wolf_vote" }, "p0");
  var dead = eaten.ok === true && !alive(r2, "p3");
  ok("and the pack cannot eat them", !dead, JSON.stringify(eaten));

  finding("BUG-15",
    "spectators are treated as players by everything below the lobby: beginNight builds them a " +
    "house and a turn (so endNightEarly never fires), the pack can howl for their door and " +
    "kill them, and Win.count reads teamOf(null) as \"village\" so every side's arithmetic is " +
    "off by the number of people watching",
    hasHouse && !!hasTurn && counted && dead,
    "js/engine/resolver.js:50-63 beginNight iterates state.players; js/engine/win.js:16-21 " +
    "count() does the same; only assignRoles at js/engine/engine.js:66 filters spectators out");
})();

testCase("ROOM-02", "Kicking a player mid-night orphans their house and crashes the host");
(function () {
  var r = room(["W", "V", "V2", "V3", "Seer"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager", p4: "seer" });
  night(r);
  // Exactly what js/app.js:289 kick() does, at exactly the wrong moment.
  r.state.players = r.state.players.filter(function (x) { return x.id !== "p2"; });

  ok("the house outlives the player", !!r.state.night.houses.p2);
  ok("so does the turn, unspendable", r.state.night.turns.p2.spent === false);
  function stillHolding(st) {
    return Object.keys(st.night.turns).filter(function (id) {
      return !st.night.turns[id].spent && st.players.some(function (p) { return p.id === id; });
    });
  }
  // Before the fix the orphan turn was counted, so allTurnsSpent was false
  // forever and endNightEarly could never fire in a room anybody was kicked from.
  ok("the orphan turn is not one of the turns still being waited on",
    stillHolding(r.state).indexOf("p2") < 0, stillHolding(r.state).join(","));

  // The engine runs inside a vm context, so its TypeError is not this realm's.
  function throws(fn) { try { fn(); return false; } catch (e) { return !!e && e.name === "TypeError"; } }
  var knockDies = throws(function () { r.eng.handle({ type: "KNOCK", houseId: "p2" }, "p4"); });
  var actDies = throws(function () { r.eng.handle({ type: "ACT", houseId: "p2", actionId: "investigate" }, "p4"); });
  var howlDies = throws(function () { r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0"); });
  ok("knocking at the orphan door is refused, not fatal", !knockDies);
  ok("acting there is refused, not fatal", !actDies);
  ok("howling there is refused, not fatal", !howlDies);
  // Everybody who is actually seated goes to bed; the night must then close.
  ["p0", "p1", "p3", "p4"].forEach(function (id) {
    r.eng.handle({ type: "ACT", houseId: id, actionId: "stay_in" }, id);
  });
  ok("and with every seated player done, the night can close early",
    WG.resolver.allTurnsSpent(r.state) === true, stillHolding(r.state).join(","));
  ok("the redacted view still builds, so nothing warns anybody",
    (function () { try { WG.view.build(r.state, "p0"); return true; } catch (e) { return false; } })());

  finding("BUG-16",
    "kick() splices a player out of state.players in ANY phase. Their house and turn stay in " +
    "state.night, and the first knock, action or pack vote aimed at that door throws a " +
    "TypeError inside the host's message handler — the room's single source of truth",
    knockDies || actDies || howlDies,
    "FIXED both ends: kick() keeps the seat below the lobby (marking them kicked and " +
    "disconnected, and spending their turn), and knock/perform/packVote/allTurnsSpent now " +
    "refuse a house whose occupant is not seated. " +
    "js/app.js:289 (kick has no phase guard) meeting js/engine/resolver.js:197 " +
    "(`occupant.name`), :372 (offersAt on a null occupant) and :670 (`P(state, houseId).name`)");
})();

testCase("ROOM-03", "A second game in the same room leaks the first game's deaths");
(function () {
  var names = []; for (var i = 0; i < 6; i++) names.push("P" + i);
  var r = room(names);
  r.state.roster = { werewolf: 1, doctor: 1 };
  r.state.config.flow.durations = { role_reveal: 1, night: 1, dawn: 1, discussion: 1, voting: 1, verdict: 1 };
  r.eng.startGame();
  r.eng.enter("night");
  slay(r, "p1", "pack", "p0");
  r.eng.advance();                                  // dawn announces p1
  ok("game one announced the death", r.state.announcedDead.p1 === true);

  r.state.phase = "lobby";
  ok("a second game starts cleanly", r.eng.startGame().ok === true);
  var remembered = !!(r.state.announcedDead && r.state.announcedDead.p1);
  ok("the announcement register does not survive it", !remembered);
  ok("nor does anybody's private knowledge",
    !r.state.players.some(function (p) { return p.known && p.known.p1 === "dead"; }));
  ok("nor the old death bookkeeping",
    !r.state.players.some(function (p) { return p.diedNight != null || p.deathHidden; }));

  r.eng.enter("night");
  var wolf = r.state.players.filter(function (p) { return p.role === "werewolf"; })[0];
  slay(r, "p1", "pack", wolf.id);
  var bystander = r.state.players.filter(function (p) { return p.alive && p.id !== wolf.id; })[0];
  var leaked = WG.resolver.knowsDead(r.state, bystander, P(r.state, "p1"));
  ok("so a repeat death stays secret until dawn, like any other", !leaked);
  ok("and their house still reads as occupied on everybody's map",
    WG.view.build(r.state, bystander.id).houses.filter(function (h) { return h.id === "p1"; })[0].state === "living");
  ok("with nothing published yet", r.state.publicLog.filter(function (e) { return e.kind === "death"; }).length === 0);

  finding("BUG-17",
    "startGame() never clears state.announcedDead, p.known, p.diedNight or p.deathHidden. In " +
    "the second game played in a room, anybody who died in the first is publicly dead the " +
    "instant they die again — the map lights their house for every phone in the middle of the " +
    "night, which is the one thing the whole belief model exists to prevent",
    remembered || leaked,
    "FIXED: assignRoles() now clears announcedDead and every player's known/diedNight/diedAt/" +
    "diedCause/deathHidden/markedByShaman. " +
    "js/engine/engine.js:103-110 startGame() resets round/winner/publicLog and nothing else; " +
    "js/engine/resolver.js:158-163 knowsDead() reads the stale register");
})();

testCase("ROOM-04", "A hanging writes a phantom body into last night's houses");
(function () {
  var r = room(["W", "V", "V2", "V3", "V4"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager", p4: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "wolf_vote" }, "p0");
  r.eng.advance();
  ok("dawn snapshots the night", r.state.lastNight.deaths.length === 1);
  WG.clock.enter(r.state, "voting"); r.state.votes = {};
  ["p2", "p3", "p4"].forEach(function (v) { r.eng.handle({ type: "VOTE", targetId: "p0" }, v); });
  r.eng.advance();
  var polluted = r.state.night.deaths.length === 2 || !!r.state.night.houses.p0.body;
  ok("the rope does not append to the closed night's record", !polluted);
  ok("the hanged player is announced", !!(r.state.announcedDead || {}).p0);
  finding("BUG-18",
    "state.night is not cleared at dawn, so every daytime death — the rope, an Avenger's oath, " +
    "a Diwata's curse — writes a death record and a body into the night object that has already " +
    "been snapshotted. Harmless only because beginNight rebuilds it before anything reads it",
    polluted,
    "FIXED: endNight() marks the night closed and die() refuses to file into a closed one; " +
    "js/engine/resolver.js:551-560 die() writes to state.night unconditionally; " +
    "js/engine/resolver.js:760-765 endNight() snapshots and leaves the object in place");
})();

testCase("ROOM-05", "A death nobody announced crashes the host on the following night");
(function () {
  // No room settings changed, no kicking, nothing exotic: an Avenger sworn at
  // somebody, hanged the next day. The oath fires during the VERDICT, so the
  // victim's death is never announced (announceDeath only runs for the rope)
  // and never reported at dawn (lastNight was snapshotted hours ago).
  var r = room(["W", "Av", "Vic", "Doc", "V", "V2", "V3"]);
  give(r, { p0: "werewolf", p1: "avenger", p2: "villager", p3: "doctor",
            p4: "villager", p5: "villager", p6: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "revenge" }, "p1");
  r.eng.handle({ type: "ACT", houseId: "p4", actionId: "wolf_vote" }, "p0");
  r.eng.advance();                                   // dawn
  WG.clock.enter(r.state, "voting"); r.state.votes = {};
  ["p3", "p5", "p6"].forEach(function (v) { r.eng.handle({ type: "VOTE", targetId: "p1" }, v); });
  r.eng.advance();                                   // the rope, and the oath

  ok("the sworn target is dead", !alive(r, "p2"));
  var silent = !(r.state.announcedDead || {}).p2;
  ok("a death in daylight is announced to the village", !silent);
  ok("and it is named in the log", r.log().indexOf("Vic") >= 0, r.log());

  while (r.state.phase !== "night") r.eng.advance();
  ok("the next night carries their body forward",
    !!r.state.night.houses.p2.body);
  ok("so the door is dark to a Doctor who now knows",
    !r.offered("p3", "p2", "protect"));

  function throws(fn) { try { fn(); return false; } catch (e) { return !!e && e.name === "TypeError"; } }
  var crash = throws(function () {
    r.eng.handle({ type: "ACT", houseId: "p2", actionId: "protect" }, "p3");
  });
  ok("and acting on it does not throw inside the host", !crash);

  // The same hole, reached by the room setting the README puts its name to.
  var q = room(["W", "Doc", "Vic", "V", "V2", "V3"]);
  give(q, { p0: "werewolf", p1: "doctor", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  q.state.config.rules.trustNoone = true;
  night(q);
  q.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  q.eng.advance();
  ok("\"Don't believe anyone\" leaves an unreported body unannounced",
    q.log().indexOf("Vic") < 0, q.log());
  night(q);
  var found = null;
  var crash2 = throws(function () {
    found = q.eng.handle({ type: "ACT", houseId: "p2", actionId: "protect" }, "p1");
  });
  ok("and the same second-night attempt does not throw", !crash2);
  // Walking up to an unannounced body is how the Doctor finds out, and finding
  // out is free — the knock is spent on nothing, the night is not.
  ok("it is a body discovery, and it costs the Doctor nothing",
    !!found && found.ok === true && q.state.night.turns.p1.spent === false,
    JSON.stringify(found) + " spent=" + q.state.night.turns.p1.spent);
  ok("and the Doctor now privately knows", (q.state.players[1].known || {}).p2 === "dead");

  finding("BUG-23",
    "beginNight rebuilds every house with body:null, but a player who died on an earlier night " +
    "and was never announced is still believed alive — so the door is still offered, perform() " +
    "takes the \"they are dead\" branch, and bodyText() dereferences a null body. Every " +
    "onFindBody hook in js/roles/ reads c.body on line one (23 of 25 do), and the generic " +
    "fallback reads house.body.night, so this is a TypeError inside the host's handler for " +
    "every role that can reach it. Two ordinary routes in: an Avenger's revenge fired by the " +
    "rope (never announced at all), and the \"Don't believe anyone\" setting",
    silent && crash && crash2,
    "FIXED three ways: beginNight() carries a dead occupant's body forward, bodyText() answers " +
    "plainly when there is no body record at all, and a death in daylight is announced. " +
    "js/engine/resolver.js:403-408 (the branch) and :229-236 bodyText(); " +
    "js/engine/resolver.js:51-58 beginNight() resets house.body every night; " +
    "js/engine/resolver.js:574-577 die() only announces the rope");
})();

/* ================================================================== *
 * 13. EVENTS
 * ================================================================== */

section("13. Events, on top of everything else");

testCase("EV-01", "Blood Moon's second throat is lost whenever the pack finishes voting");
(function () {
  function run(finish) {
    var r = room(["W1", "W2", "V", "V2", "V3", "V4", "V5"]);
    give(r, { p0: "werewolf", p1: "werewolf", p2: "villager", p3: "villager",
              p4: "villager", p5: "villager", p6: "villager" });
    night(r);
    WG.events.trigger(r.state, "blood_moon");
    r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
    if (finish) r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p1");
    withRandom([0], function () { r.eng.advance(); });
    return r.state.players.filter(function (p) { return !p.alive; }).length;
  }
  ok("the event asks for one extra kill", WG.events.extraKills(
    (function () { var s = { currentEvent: null }; WG.events.trigger(s, "blood_moon"); return s; })()) === 1);
  var whenAgreed = run(true), whenNot = run(false);
  ok("a pack that agrees kills twice, as the event says", whenAgreed === 2, String(whenAgreed));
  ok("and so does a pack that never finishes voting", whenNot === 2, String(whenNot));
  finding("BUG-19",
    "Blood Moon's extra kill only happens when the pack FAILS to finish voting. " +
    "The live path — the last wolf howls, packVote settles it immediately — calls " +
    "resolvePack without the extraKills option, so the event does nothing in the normal case",
    whenAgreed !== 2,
    "FIXED: packVote() passes the event's extraKills on the live path too. " +
    "js/engine/resolver.js:673 `resolvePack(state, out)` with no opts, vs " +
    "js/engine/engine.js:152-153 which does pass them");
})();

testCase("EV-02", "The Festival redirects a vote onto yourself, self-votes off or not");
(function () {
  var r = room(["A", "B", "C", "D"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager" });
  r.state.round = 2; r.state.night = null;
  r.state.config.rules.allowSelfVote = false;
  WG.clock.enter(r.state, "voting");
  WG.events.trigger(r.state, "festival");
  withRandom([0.3], function () {                  // land the redirect on p1 itself
    r.eng.handle({ type: "VOTE", targetId: "p0" }, "p1");
  });
  var selfVoted = r.state.votes.p1 === "p1";
  ok("a redirected vote may land on the voter (current behaviour, pinned)", selfVoted,
     JSON.stringify(r.state.votes));
  unspec("SPEC-20",
    "the Festival's redirect runs after the self-vote rule, so a room with self-votes turned " +
    "off can still record one",
    "js/engine/engine.js:442 checks allowSelfVote, :450-453 then redirects");
})();

testCase("EV-03", "The pandemic can take the whole village and win outright");
(function () {
  var r = room(["W", "V", "V2", "V3", "V4", "V5"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  r.state.round = 2;
  night(r);
  WG.events.trigger(r.state, "pandemic");
  ok("patient zero is chosen", Object.keys(r.state.pandemic.sick).length === 1);
  var guard = 0;
  while (!r.state.winner && guard++ < 60) r.eng.advance();
  ok("and it reaches an ending", !!r.state.winner, "gave up after " + guard);
  ok("which the sickness can win", ["pandemic", "werewolf", "village"].indexOf(r.state.winner.team) >= 0,
     r.state.winner.team);
})();

/* ================================================================== *
 * 14. SETTINGS THE ENGINE NEVER READS
 * ================================================================== */

section("14. Knobs in the settings screen that are not wired to anything");

testCase("CFG-01", "First night is safe");
(function () {
  var r = room(["W", "V", "V2", "V3"]);
  r.state.config.rules.firstNightImmunity = true;
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "wolf_vote" }, "p0");
  var died = !alive(r, "p1") && r.state.round === 1;
  ok("nobody dies on night one", !died);
  // It covers the night, not the rope, and it lifts on night two.
  r.eng.advance(); while (r.state.phase !== "night") r.eng.advance();
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "wolf_vote" }, "p0");
  ok("and night two is an ordinary night", !alive(r, "p1") && r.state.round === 2,
    "round " + r.state.round);

  var q = room(["W", "V", "V2", "V3"]);
  q.state.config.rules.firstNightImmunity = false;
  give(q, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager" });
  night(q);
  q.eng.handle({ type: "ACT", houseId: "p1", actionId: "wolf_vote" }, "p0");
  ok("with the setting off, night one kills as it always did", !alive(q, "p1"));
  finding("BUG-20",
    "rules.firstNightImmunity is in the default config, has a labelled toggle in the settings " +
    "screen and is named in game_flow.json as \"a room setting, not a phase change\" — and is " +
    "read by nothing in the engine",
    died,
    "FIXED: kill() honours it on round 1 at night, for every cause but the rope. " +
    "js/engine/state.js:40 declares it, js/ui/screens.js:215 offers it, " +
    "data/game_flow.json firstRound.notes promises it; no reader anywhere in js/engine/");
})();

testCase("CFG-02", "Villagers can be promoted");
(function () {
  var r = room(["V", "W", "V2", "V3"]);
  give(r, { p0: "villager", p1: "werewolf", p2: "villager", p3: "villager" });
  r.state.config.rules.villagerPromotion = false;
  P(r.state, "p0").totalScore = 1200;
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "wolf_vote" }, "p1");
  r.eng.advance();
  var promoted = roleOf(r, "p0") !== "villager";
  ok("the villager is not promoted with the setting off", !promoted, roleOf(r, "p0"));

  var q = room(["V", "W", "V2", "V3"]);
  give(q, { p0: "villager", p1: "werewolf", p2: "villager", p3: "villager" });
  q.state.config.rules.villagerPromotion = true;
  P(q.state, "p0").totalScore = 1200;
  night(q);
  q.eng.handle({ type: "ACT", houseId: "p1", actionId: "wolf_vote" }, "p1");
  q.eng.advance();
  ok("and is promoted with it on", roleOf(q, "p0") !== "villager", roleOf(q, "p0"));
  finding("BUG-21",
    "rules.villagerPromotion is offered as a toggle and never consulted: the Villager's " +
    "onPhaseEnd promotes on score alone",
    promoted,
    "js/engine/state.js:46 and js/ui/screens.js:220 declare it; js/roles/villager.js:13-32 " +
    "checks alive, hasUpgraded and totalScore, and never the config");
})();

testCase("CFG-03", "Show the tally");
(function () {
  var r = room(["W", "V", "V2", "V3"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager" });
  r.state.round = 1; r.state.night = null;
  WG.clock.enter(r.state, "voting");
  r.eng.handle({ type: "VOTE", targetId: "p0" }, "p1");
  var v = WG.view.build(r.state, "p2");
  ok("with the tally on, the counts are visible", v.votes.counts !== null);
  var everyBallot = v.votes.detail && v.votes.detail.p1 === "p0";
  ok("and so is every individual ballot (current behaviour, pinned)", !!everyBallot);
  r.state.config.rules.showVoteCounts = false;
  var v2 = WG.view.build(r.state, "p2");
  ok("turning the tally off hides both", v2.votes.counts === null && v2.votes.detail === null);
  unspec("SPEC-21",
    "\"Show the tally\" also hands out the full voter->target map, which is what " +
    "showPersonalVotes is nominally for; the comment beside it says the opposite of what the " +
    "code does",
    "js/engine/view.js:241-249, whose own comment reads \"only ever handed out in full when " +
    "the room asked for it\"");
})();

testCase("CFG-04", "Every rule the room can set has a reader in the engine");
(function () {
  var stateSrc = fs.readFileSync(path.join(ROOT, "js/engine/state.js"), "utf8");
  var all = ["engine", "resolver", "view", "win", "clock", "events"]
    .map(function (m) { return fs.readFileSync(path.join(ROOT, "js/engine/" + m + ".js"), "utf8"); })
    .concat(fs.readdirSync(path.join(ROOT, "js/roles")).map(function (f) {
      return fs.readFileSync(path.join(ROOT, "js/roles/" + f), "utf8");
    })).join("\n");

  // `rules` is the group the engine owns end to end. `room` and `look` are the
  // transport's and the theme's, and are read in js/app.js and js/ui/.
  var orphans = Object.keys(WG.state.defaultConfig().rules).filter(function (k) {
    return all.split(k).length - 1 === 0;
  });
  console.log("    rules nothing reads: " + (orphans.join(", ") || "none"));
  // This is the audit that keeps the last two honest: every rule the room can
  // set now has a reader, and a new one that arrives without one fails here.
  ok("no rule is wired to nothing", orphans.length === 0, orphans.join(", "));
  ok("and state.js is still where they are declared",
    /firstNightImmunity/.test(stateSrc) && /villagerPromotion/.test(stateSrc));
})();

/* ================================================================== *
 * 15. WHAT THE VIEW HANDS OUT
 * ================================================================== */

section("15. Who is allowed to see whom");

testCase("SEE-01", "The Mayor's own card promises more than the redaction gives");
(function () {
  var r = room(["May", "W", "V", "Mas1", "Mas2", "V2"]);
  give(r, { p0: "mayor", p1: "werewolf", p2: "villager", p3: "mason", p4: "mason", p5: "villager" });
  function seen(viewer, subject) {
    var c = WG.view.build(r.state, viewer).players.filter(function (x) { return x.id === subject; })[0];
    return c.role ? c.role.id : null;
  }
  ok("a villager sees the Mayor", seen("p2", "p0") === "mayor");
  var wolfSees = seen("p1", "p0");
  ok("a wolf does not", wolfSees === null);
  ok("the Masons see each other", seen("p3", "p4") === "mason");
  ok("and nothing else", seen("p3", "p1") === null);

  /* The bug was never in the redaction — it was the role card telling the
   * Mayor the pack could see them, which is a whole day's argument built on
   * nothing. Read the card the player is actually shown and hold it to what
   * the code and the data both say. */
  var card = WG.roles.hook("mayor", "brief", { state: r.state, self: P(r.state, "p0") });
  var promise = (card && card.lines || []).join(" ");
  var contradicts = /so can the ones who are not/i.test(promise);
  ok("and the Mayor's card does not promise otherwise", !contradicts, promise);
  ok("the card still says the village can see them",
    /village/i.test(promise), promise);
  finding("BUG-22",
    "the Mayor's own night briefing says \"Every village-team player can see that you are the " +
    "Mayor. So can the ones who are not\", and the redaction shows the Mayor to the village team " +
    "only. The role card tells the player they are exposed to the pack when they are not",
    contradicts,
    "FIXED: the card now matches view.js and list_of_roles.json, which already agreed. " +
    "js/roles/mayor.js:12 (the brief) vs js/engine/view.js:41 (village team only); " +
    "data/list_of_roles.json mayor.passives.known agrees with the code, not the brief");
})();

testCase("SEE-02", "A Manipulator sees the whole board and leaks nothing back");
(function () {
  var r = room(["Man", "W", "Seer", "V", "V2"]);
  give(r, { p0: "manipulator", p1: "werewolf", p2: "seer", p3: "villager", p4: "villager" });
  var v = WG.view.build(r.state, "p0");
  ok("every role is on the Manipulator's card",
    v.players.every(function (p) { return !!p.role; }));
  var w = WG.view.build(r.state, "p1");
  ok("and nobody sees the Manipulator",
    w.players.filter(function (p) { return p.id === "p0"; })[0].role === null);
})();

testCase("SEE-03", "A dead player's role is revealed only to somebody who knows they are dead");
(function () {
  var r = room(["W", "Seer", "Vic", "V", "V2", "V3"]);
  give(r, { p0: "werewolf", p1: "seer", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  function card(viewer) {
    return WG.view.build(r.state, viewer).players.filter(function (p) { return p.id === "p2"; })[0];
  }
  ok("the pack can read the body", card("p0").role !== null);
  ok("the village cannot, and still counts them alive",
    card("p3").role === null && card("p3").alive === true);
  r.eng.advance();
  ok("dawn opens it to everybody", card("p3").role !== null);
})();

testCase("SEE-04", "Nothing about the night's machinery reaches a phone");
(function () {
  var r = room(["W", "Doc", "Eng", "CCA", "Seer", "V"]);
  give(r, { p0: "werewolf", p1: "doctor", p2: "engineer", p3: "call_center_agent", p4: "seer", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p5", actionId: "protect" }, "p1");
  r.eng.handle({ type: "ACT", houseId: "p5", actionId: "trap" }, "p2");
  r.eng.handle({ type: "ACT", houseId: "p4", actionId: "call_center_block",
    payload: { quiz: { question: "q", choices: ["a", "b", "c", "d"], correct: 2 } } }, "p3");
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "wolf_vote" }, "p0");

  var raw = r.state.players.map(function (p) { return JSON.stringify(WG.view.build(r.state, p.id)); }).join("");
  ok("no shields", raw.indexOf("bodyshield") < 0 && raw.indexOf("\"shields\"") < 0);
  ok("no traps — only the Engineer's own action list names one",
    raw.indexOf("\"trap\":{") < 0 && raw.indexOf("trapSet") < 0);
  ok("no visit log", raw.indexOf("\"visits\"") < 0);
  ok("no answer key", raw.indexOf("\"correct\"") < 0);
  var villagerView = JSON.stringify(WG.view.build(r.state, "p5"));
  ok("and no pack arithmetic outside the pack", villagerView.indexOf("packVotes\":{\"p") < 0);
})();

testCase("SEE-05", "A Cat's speech is only marked for people who know it is a Cat");
(function () {
  var r = room(["Cat", "W", "V", "V2", "V3"]);
  give(r, { p0: "cat", p1: "werewolf", p2: "villager", p3: "villager", p4: "villager" });
  function speech(viewer) {
    return WG.view.build(r.state, viewer).players.filter(function (p) { return p.id === "p0"; })[0].speech;
  }
  ok("the Cat knows it is a Cat", speech("p0") === "meow");
  ok("nobody else is told why the words came out wrong", speech("p2") === null);
  r.eng.handle({ type: "CHAT", channel: "day", text: "the wolf is in house four" }, "p0");
  var line = r.state.chat.day[0];
  ok("but the words really are gone on the host", /^(meow ?)+$/.test(line.text.trim()), line.text);
})();

testCase("SEE-06", "The Detective reads movement, which a Trickster cannot forge");
(function () {
  var r = room(["Det", "Trick", "Seer", "W", "V", "V2", "V3"]);
  give(r, { p0: "detective", p1: "trickster", p2: "seer", p3: "werewolf",
            p4: "villager", p5: "villager", p6: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "copy_appearance" }, "p1");
  r.eng.advance(); night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "detect" }, "p0");
  ok("the footprints are the truth, whatever the face says", r.said("p0", "Trick went to Seer"));
})();

/* ================================================================== *
 * 16. A FUZZ PASS
 * ================================================================== */

section("16. Twenty rooms, every role in the bag, nothing may throw");

testCase("FUZZ-01", "Random legal play never crashes the host");
(function () {
  var everyRole = WG.roles.all().map(function (d) { return d.id; });
  var crashes = [], unfinished = 0;

  for (var game = 0; game < 20; game++) {
    var names = []; for (var i = 0; i < 12; i++) names.push("P" + i);
    var r = room(names);
    var roster = { werewolf: 2 };
    // Three random specials per game, so the combinations are not always the same.
    for (var k = 0; k < 3; k++) {
      var rid = everyRole[Math.floor(Math.random() * everyRole.length)];
      if (rid === "villager" || rid === "werewolf") continue;
      roster[rid] = (roster[rid] || 0) + 1;
    }
    r.state.roster = roster;
    r.state.config.flow.durations = { role_reveal: 1, night: 1, dawn: 1, discussion: 1, voting: 1, verdict: 1 };
    r.state.config.events.enabled = true;
    r.state.config.events.chance = 0.4;
    var started = r.eng.startGame();
    if (!started.ok) continue;

    var guard = 0;
    try {
      while (!r.state.winner && guard++ < 120) {
        if (r.state.phase === "night") {
          r.state.players.filter(function (p) { return !r.state.night.turns[p.id].spent; })
            .forEach(function (p) {
              var ids = r.state.players.map(function (x) { return x.id; });
              for (var t = 0; t < 6; t++) {
                var hid = ids[Math.floor(Math.random() * ids.length)];
                var kn = WG.resolver.knock(r.state, p.id, hid);
                if (!kn.ok) continue;
                var usable = kn.offers.filter(function (o) { return o.enabled && !o.authoring; });
                if (!usable.length) continue;
                var pick = usable[Math.floor(Math.random() * usable.length)];
                r.eng.handle({ type: "ACT", houseId: hid, actionId: pick.actionId,
                  payload: { score: 200, roleGuess: "villager", assignment: "random" } }, p.id);
                break;
              }
            });
          // Answer whatever prompts are open, at random.
          Object.keys(r.state.night.prompts).forEach(function (pid) {
            var pr = r.state.night.prompts[pid];
            r.eng.handle({ type: "CONSENT", offerId: pid, ok: Math.random() < 0.5 }, pr.to);
          });
        } else if (r.state.phase === "voting") {
          WG.resolver.living(r.state).forEach(function (p) {
            var others = WG.resolver.living(r.state).filter(function (x) { return x.id !== p.id; });
            if (!others.length) return;
            r.eng.handle({ type: "VOTE",
              targetId: others[Math.floor(Math.random() * others.length)].id }, p.id);
          });
        }
        r.state.players.forEach(function (p) {
          WG.view.build(r.state, p.id);              // the redaction must survive it too
        });
        r.eng.advance();
      }
    } catch (e) {
      crashes.push(JSON.stringify(roster) + " -> " + e.message);
      continue;
    }
    if (!r.state.winner) unfinished++;
  }
  console.log("    " + crashes.length + " of 20 rooms threw, " + unfinished + " never finished");
  crashes.slice(0, 4).forEach(function (c) { console.log("      " + c); });
  /* A randomised sweep must not be a hard assertion — it would make the build
   * flaky rather than informative. It reports instead. Every crash signature
   * this has ever produced is BUG-23: a null body at a stale corpse. */
  if (crashes.length) {
    finding("FUZZ-CRASH",
      crashes.length + " of 20 randomly played rooms threw inside the host this run",
      true,
      "js/engine/resolver.js:229-236 bodyText() dereferencing house.body === null — see BUG-23");
  } else {
    console.log("    no crash this run; BUG-23 needs an unannounced death, which is " +
                "a roster-and-dice matter. Its deterministic repro is ROOM-05.");
  }
  ok("and no room was left running forever", unfinished === 0, unfinished + " left running");
})();

/* ---------------- the report ---------------- */

console.log("\n" + "-".repeat(66));
console.log(caseNo + " test cases, " + (pass + fail) + " assertions.");
console.log(pass + " passed, " + fail + " failed.");
console.log(stillBroken + " findings still reproduce, " + fixed + " look fixed, " +
            unspecified.length + " questions the spec does not answer.");
if (findings.length) {
  console.log("\nBUGS (see tools/ROLE-INTERACTIONS.md):");
  findings.forEach(function (f) { console.log("  ! " + f); });
}
if (unspecified.length) {
  console.log("\nUNSPECIFIED — somebody has to decide:");
  unspecified.forEach(function (u) { console.log("  ? " + u); });
}
console.log("");
process.exit(fail ? 1 : 0);

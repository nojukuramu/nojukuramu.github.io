/* engine-test.js — the engine, with no browser and no network.
 *
 * Run: node tools/engine-test.js
 *
 * Every module here is a plain IIFE hung off a global, which is what makes this
 * possible: the same files the page loads are loaded into a bare object, and
 * the whole game is driven by calling handle() with the commands a phone would
 * have sent. The scenarios below are the ones the redesign turns on — a late
 * Bodyguard, an early Doctor, a mid-night revival — because those are exactly
 * the cases a pass-the-phone engine could not have had.
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

/* ---------------- harness ---------------- */

var pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + label); }
  else { fail++; console.log("  ✗ " + label + (extra ? "  <- " + extra : "")); }
}
function section(name) { console.log("\n" + name); }

function room(names) {
  var state = WG.state.createState("TEST01");
  state.hostId = "p0";
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
    clear: function () { mail = {}; }
  };
}

/** Turn on "Don't believe anyone" for this room. */
function trustNoone(r) { r.state.config.rules.trustNoone = true; return r; }

function give(r, assignments) {
  Object.keys(assignments).forEach(function (pid) {
    var p = WG.resolver.P(r.state, pid);
    p.role = assignments[pid];
    Object.assign(p, WG.roles.initialState(assignments[pid]));
  });
  WG.win.noteLeaders(r.state);
}

function night(r) {
  r.state.round++;
  WG.clock.enter(r.state, "night");
  WG.resolver.beginNight(r.state);
}

/* ---------------- data integrity ---------------- */

section("Role data and behaviour agree");
(function () {
  var roles = WG.roles.all();
  ok("35 roles linked", roles.length === 35, roles.length + " found");
  ok("every role has a behaviour module", roles.every(function (r) { return !!r.behaviour; }));
  ok("every action has a handler", roles.every(function (r) {
    return (r.actions || []).every(function (a) { return !!WG.roles.handler(r.id, a.id); });
  }));
  ok("every team is a declared team", roles.every(function (r) { return !!WG.roles.teams[r.team]; }));
  var teams = {};
  roles.forEach(function (r) { teams[r.team] = (teams[r.team] || 0) + 1; });
  console.log("    teams: " + JSON.stringify(teams));
})();

/* ---------------- the late bodyguard ---------------- */

section("The map never says who died");
(function () {
  var r = room(["Wolf", "Guard", "Vic", "Vil", "Vil2", "Vil3"]);
  give(r, { p0: "werewolf", p1: "bodyguard", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  ok("the victim really is dead", !WG.resolver.P(r.state, "p2").alive);

  // The board a villager is looking at, one minute after the killing.
  var v = WG.view.build(r.state, "p3");
  var house = v.houses.filter(function (h) { return h.id === "p2"; })[0];
  ok("their house looks like every other house", house.state === "living", house.state);
  ok("and the roster still counts them", v.players.filter(function (p) { return p.id === "p2"; })[0].alive === true);
  ok("nothing about the body is in the view",
    JSON.stringify(v).indexOf("dead-tonight") < 0);

  // The pack knows, because the pack did it.
  var w = WG.view.build(r.state, "p0");
  ok("the pack knows what it did",
    w.houses.filter(function (h) { return h.id === "p2"; })[0].state === "dead-tonight");
})();

section("Standing at a door tells you nothing");
(function () {
  var r = room(["Wolf", "Guard", "Vic", "Vil", "Vil2", "Vil3"]);
  give(r, { p0: "werewolf", p1: "bodyguard", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");

  r.eng.handle({ type: "KNOCK", houseId: "p2" }, "p1");
  var offers = r.lastOffers("p1");
  ok("the door gives nothing away", offers.discovery === null);
  ok("the house still reads as lived-in", offers.state === "living", offers.state);
  ok("guarding is still on the menu, because he cannot know",
    offers.offers.some(function (o) { return o.actionId === "guard" && o.enabled; }));
  ok("raising the alarm is not — he has found nothing",
    !offers.offers.some(function (o) { return o.actionId === "report"; }));
  ok("knocking costs nothing", r.state.night.turns.p1.spent === false);
})();

section("A Bodyguard finds the body when he tries to guard");
(function () {
  var r = room(["Wolf", "Guard", "Vic", "Vil", "Vil2", "Vil3"]);
  give(r, { p0: "werewolf", p1: "bodyguard", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");

  // 00:41 — he commits to standing at that door.
  var res = r.eng.handle({ type: "ACT", houseId: "p2", actionId: "guard" }, "p1");
  ok("the attempt is accepted, not refused", res.ok === true);
  ok("he is told, in the Bodyguard's own words, that he was late",
    r.said("p1", "found them already dead inside"), r.inbox("p1").join(" | "));

  // The attempt could not be carried out, so it cost him nothing but the time.
  ok("his night is still his", r.state.night.turns.p1.spent === false);
  ok("nobody was guarded", r.state.night.houses.p2.shields.length === 0);

  // And now he knows, so the house changes for him and only for him.
  var his = WG.view.build(r.state, "p1");
  ok("the house is a crime scene to him now",
    his.houses.filter(function (h) { return h.id === "p2"; })[0].state === "dead-tonight");
  var theirs = WG.view.build(r.state, "p3");
  ok("and still an ordinary house to everyone else",
    theirs.houses.filter(function (h) { return h.id === "p2"; })[0].state === "living");

  // Raising the alarm is now offered, and is free.
  r.eng.handle({ type: "KNOCK", houseId: "p2" }, "p1");
  ok("reporting is offered once he has found them",
    r.lastOffers("p1").offers.some(function (o) { return o.actionId === "report" && o.enabled; }));
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "report" }, "p1");
  ok("and it is free", r.state.night.turns.p1.spent === false);
  ok("the finder is recorded", r.state.night.houses.p2.reportedBy === "p1");

  // He can still do his actual job, somewhere that is still breathing.
  r.eng.handle({ type: "ACT", houseId: "p3", actionId: "guard" }, "p1");
  ok("he can still guard somebody living", r.state.night.turns.p1.spent === true);
})();

section("An action on somebody perfectly well costs nothing either");
(function () {
  var r = room(["Vet", "Cat", "V", "V2", "W"]);
  give(r, { p0: "vet", p1: "cat", p2: "villager", p3: "villager", p4: "werewolf" });
  night(r);
  var res = r.eng.handle({ type: "ACT", houseId: "p1", actionId: "vet_revive" }, "p0");
  ok("the attempt is accepted", res.ok === true);
  ok("the vet is told they are fine", r.said("p0", "alive and perfectly well"));
  ok("the charge is not spent", WG.resolver.P(r.state, "p0").hasRevived === false);
  ok("nor is the night", r.state.night.turns.p0.spent === false);
  ok("and now the vet knows they are alive",
    WG.resolver.knowsStatus(r.state, WG.resolver.P(r.state, "p0"), WG.resolver.P(r.state, "p1")));
})();

section("A Vet can still reach a Cat that died an hour ago");
(function () {
  var r = room(["Vet", "Cat", "V", "V2", "W", "W2"]);
  give(r, { p0: "vet", p1: "cat", p2: "villager", p3: "villager", p4: "werewolf", p5: "werewolf" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "wolf_vote" }, "p4");
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "wolf_vote" }, "p5");
  ok("the cat is dead", !WG.resolver.P(r.state, "p1").alive);

  // The Vet cannot know — and the door is still offered, which is the point.
  r.eng.handle({ type: "KNOCK", houseId: "p1" }, "p0");
  ok("treating is offered at a door of unknown status",
    r.lastOffers("p0").offers.some(function (o) { return o.actionId === "vet_revive" && o.enabled; }));
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "vet_revive" }, "p0");
  ok("and it works", WG.resolver.P(r.state, "p1").alive);
  ok("the night is spent on it", r.state.night.turns.p0.spent === true);
})();

section("Dawn tells the village, reported or not");
(function () {
  var r = room(["Wolf", "Guard", "Vic", "Vil", "Vil2", "Vil3"]);
  give(r, { p0: "werewolf", p1: "bodyguard", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  ok("the room announces its dead by default", r.state.config.rules.trustNoone === false);
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");

  // Nobody went round, so nobody reported it.
  ok("nothing is public during the night",
    !r.state.announcedDead || !r.state.announcedDead.p2);
  r.eng.advance();

  var log = r.state.publicLog.map(function (e) { return e.text; }).join(" | ");
  ok("dawn names them anyway", /Vic is dead/.test(log), log);
  ok("with no finder, because there was none", log.indexOf("raised the alarm") < 0);
  ok("and now the whole village knows", r.state.announcedDead.p2 === true);

  var v = WG.view.build(r.state, "p3");
  ok("the roster greys them out from here on",
    v.players.filter(function (p) { return p.id === "p2"; })[0].alive === false);
})();

section("Reporting adds a name to the morning, it does not unlock it");
(function () {
  var r = room(["Wolf", "Guard", "Vic", "Vil", "Vil2", "Vil3"]);
  give(r, { p0: "werewolf", p1: "bodyguard", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "guard" }, "p1");     // finds the body
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "report" }, "p1");
  r.eng.advance();

  var log = r.state.publicLog.map(function (e) { return e.text; }).join(" | ");
  ok("the death is named", /Vic is dead/.test(log), log);
  ok("and so is the finder", /Guard found Vic and raised the alarm/.test(log), log);
})();

section("The mark stays on the house for the rest of the game");
(function () {
  var r = room(["Wolf", "Guard", "Vic", "Vil", "Vil2", "Vil3"]);
  give(r, { p0: "werewolf", p1: "bodyguard", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  r.eng.advance();                                   // dawn announces it

  function houseFor(viewerId) {
    return WG.view.build(r.state, viewerId).houses.filter(function (h) { return h.id === "p2"; })[0];
  }
  ok("dead tonight, on the morning it happened", houseFor("p3").state === "dead-tonight");
  night(r);                                          // the next night
  ok("and simply dead from then on", houseFor("p3").state === "dead", houseFor("p3").state);
  ok("for everybody", houseFor("p4").state === "dead");
})();

section("Don't believe anyone: dawn names only what was reported");
(function () {
  var quiet = room(["Wolf", "Guard", "Vic", "Vil", "Vil2", "Vil3"]);
  trustNoone(quiet);
  give(quiet, { p0: "werewolf", p1: "bodyguard", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  night(quiet);
  quiet.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  quiet.eng.advance();
  var qlog = quiet.state.publicLog.map(function (e) { return e.text; }).join(" | ");
  ok("an unreported death is never announced", qlog.indexOf("Vic") < 0, qlog);
  ok("the roster goes on counting them",
    WG.view.build(quiet.state, "p3").players.filter(function (p) { return p.id === "p2"; })[0].alive === true);
  ok("but the pack still knows what it did",
    WG.view.build(quiet.state, "p0").players.filter(function (p) { return p.id === "p2"; })[0].alive === false);

  var loud = room(["Wolf", "Guard", "Vic", "Vil", "Vil2", "Vil3"]);
  trustNoone(loud);
  give(loud, { p0: "werewolf", p1: "bodyguard", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  night(loud);
  loud.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  loud.eng.handle({ type: "ACT", houseId: "p2", actionId: "guard" }, "p1");
  loud.eng.handle({ type: "ACT", houseId: "p2", actionId: "report" }, "p1");
  loud.eng.advance();
  var llog = loud.state.publicLog.map(function (e) { return e.text; }).join(" | ");
  ok("a reported one is", /Vic is dead/.test(llog), llog);
  ok("and it names who found them", /raised the alarm/.test(llog), llog);
})();

section("A Shaman's mark hides the body in either mode");
(function () {
  [false, true].forEach(function (mode) {
    var r = room(["W", "Shaman", "Vic", "V", "V2", "V3", "V4"]);
    r.state.config.rules.trustNoone = mode;
    give(r, {
      p0: "werewolf", p1: "wolf_shaman", p2: "villager",
      p3: "villager", p4: "villager", p5: "villager", p6: "villager"
    });
    night(r);
    r.eng.handle({ type: "ACT", houseId: "p2", actionId: "mark" }, "p1");
    r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
    r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p1");
    var label = mode ? "trust nobody" : "normal";
    var v = WG.view.build(r.state, "p3");
    ok(label + ": the village sees nothing",
      v.houses.filter(function (h) { return h.id === "p2"; })[0].state === "living");
    var w = WG.view.build(r.state, "p0");
    ok(label + ": the pack does",
      w.houses.filter(function (h) { return h.id === "p2"; })[0].state === "dead-tonight");

    // And going round does not turn one up either — that is the whole role.
    var probe = r.eng.handle({ type: "ACT", houseId: "p2", actionId: "task" }, "p3");
    r.eng.handle({ type: "ACT", houseId: "p2", actionId: "guard" }, "p3");
    ok(label + ": walking up to the door finds nothing",
      WG.view.build(r.state, "p3").houses.filter(function (h) { return h.id === "p2"; })[0].state === "living");

    r.eng.advance();
    ok(label + ": and the morning does not mention it",
      r.state.publicLog.map(function (e) { return e.text; }).join(" ").indexOf("Vic") < 0);
  });
})();

section("A Bodyguard who arrives first takes the blow");
(function () {
  var r = room(["Wolf", "Guard", "Vic", "Vil"]);
  give(r, { p0: "werewolf", p1: "bodyguard", p2: "villager", p3: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "guard" }, "p1");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  ok("the charge lives", WG.resolver.P(r.state, "p2").alive);
  ok("the guard does not", !WG.resolver.P(r.state, "p1").alive);
})();

section("A Doctor's shield only covers what arrives after it");
(function () {
  var early = room(["Wolf", "Doc", "Vic", "V"]);
  give(early, { p0: "werewolf", p1: "doctor", p2: "villager", p3: "villager" });
  night(early);
  early.eng.handle({ type: "ACT", houseId: "p2", actionId: "protect" }, "p1");
  early.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  ok("arriving first saves them", WG.resolver.P(early.state, "p2").alive);
  ok("the Doctor is told it mattered", early.said("p1", "did not get through"));

  var late = room(["Wolf", "Doc", "Vic", "V", "V2", "V3"]);
  give(late, { p0: "werewolf", p1: "doctor", p2: "villager", p3: "villager", p4: "villager", p5: "villager" });
  night(late);
  late.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  late.eng.handle({ type: "ACT", houseId: "p2", actionId: "protect" }, "p1");
  ok("arriving second does not", !WG.resolver.P(late.state, "p2").alive);
  ok("the Doctor gets a Doctor's version of it",
    late.said("p1", "Nothing left to treat"), late.inbox("p1").join(" | "));
})();

/* ---------------- revival is instant ---------------- */

section("A revived player gets the same night back");
(function () {
  var r = room(["Wolf", "Vet", "Cat", "Vil", "Vil2"]);
  give(r, { p0: "werewolf", p1: "vet", p2: "cat", p3: "villager", p4: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  ok("the cat is killed", !WG.resolver.P(r.state, "p2").alive);
  ok("its turn is marked spent while dead", r.state.night.turns.p2.spent === true);

  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "vet_revive" }, "p1");
  ok("the cat is alive again", WG.resolver.P(r.state, "p2").alive);
  ok("and has its turn back, tonight", r.state.night.turns.p2.spent === false);
  ok("the body is no longer at the house", r.state.night.houses.p2.body === null);

  // It can now go and bite something in the same night it died in.
  r.eng.handle({ type: "ACT", houseId: "p3", actionId: "bite" }, "p2");
  ok("it acts in the night it died in", r.state.night.turns.p2.spent === true);
  ok("the bitten player is told", r.said("p3", "bit you in the night"));
})();

section("A Cat that bites a wolf dies of it");
(function () {
  var r = room(["Wolf", "Cat", "V", "V2"]);
  give(r, { p0: "werewolf", p1: "cat", p2: "villager", p3: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p0", actionId: "bite" }, "p1");
  ok("the cat is dead", !WG.resolver.P(r.state, "p1").alive);
  ok("the wolf is not", WG.resolver.P(r.state, "p0").alive);
})();

/* ---------------- the pack, and hiding its work ---------------- */

section("The pack resolves when the last wolf howls, not at dawn");
(function () {
  var r = room(["W1", "W2", "Alpha", "V", "V2", "V3", "V4", "V5", "V6"]);
  give(r, {
    p0: "werewolf", p1: "werewolf", p2: "alpha_wolf",
    p3: "villager", p4: "villager", p5: "villager", p6: "villager", p7: "villager", p8: "villager"
  });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p3", actionId: "wolf_vote" }, "p0");
  ok("nothing happens on the first howl", WG.resolver.P(r.state, "p3").alive);
  r.eng.handle({ type: "ACT", houseId: "p4", actionId: "wolf_vote" }, "p1");
  ok("nor the second", WG.resolver.P(r.state, "p4").alive);
  r.eng.handle({ type: "ACT", houseId: "p4", actionId: "wolf_vote" }, "p2");
  ok("the Alpha's double vote settles it", !WG.resolver.P(r.state, "p4").alive);
  ok("and it settled the way the weights said", WG.resolver.P(r.state, "p3").alive);
  ok("the Alpha still has its own action", r.state.night.turns.p2.spent === false);
})();

section("A Shaman's mark deletes the morning report entry");
(function () {
  var r = room(["W", "Shaman", "Vic", "V", "V2", "V3", "V4"]);
  give(r, {
    p0: "werewolf", p1: "wolf_shaman", p2: "villager",
    p3: "villager", p4: "villager", p5: "villager", p6: "villager"
  });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "mark" }, "p1");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p1");
  ok("the victim is dead", !WG.resolver.P(r.state, "p2").alive);
  ok("the death is flagged hidden", r.state.night.deaths[0].hidden === true);

  r.eng.advance();
  var report = r.state.publicLog.map(function (e) { return e.text; }).join(" | ");
  ok("no name appears in the morning report", report.indexOf("Vic") < 0, report);

  /* And it stays hidden. A death that is never announced is never known, so the
   * village goes on counting a player it does not have — which the old build
   * gave away instantly by greying them out in the roster. */
  var v = WG.view.build(r.state, "p3");
  ok("the roster still lists them as standing",
    v.players.filter(function (p) { return p.id === "p2"; })[0].alive === true);
  ok("and does not reveal their role",
    v.players.filter(function (p) { return p.id === "p2"; })[0].role === null);
  var w = WG.view.build(r.state, "p0");
  ok("the pack knows", w.players.filter(function (p) { return p.id === "p2"; })[0].alive === false);
})();

/* ---------------- passives ---------------- */

section("Diwata takes the whole pack with her");
(function () {
  var r = room(["W1", "W2", "Diwata", "V", "V2", "V3"]);
  give(r, { p0: "werewolf", p1: "werewolf", p2: "diwata", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p1");
  ok("she dies", !WG.resolver.P(r.state, "p2").alive);
  ok("and so does every wolf",
    !WG.resolver.P(r.state, "p0").alive && !WG.resolver.P(r.state, "p1").alive);
})();

section("Archangel survives the attempt and takes the howlers with it");
(function () {
  var r = room(["W1", "W2", "Angel", "V", "V2", "V3"]);
  give(r, { p0: "werewolf", p1: "werewolf", p2: "archangel", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p1");
  ok("the Archangel lives", WG.resolver.P(r.state, "p2").alive);
  ok("stripped to a Villager", WG.resolver.P(r.state, "p2").role === "villager");
  ok("both howlers are dead",
    !WG.resolver.P(r.state, "p0").alive && !WG.resolver.P(r.state, "p1").alive);
})();

section("Diseased poisons the wolf that ate it");
(function () {
  var r = room(["W", "Sick", "V", "V2"]);
  give(r, { p0: "werewolf", p1: "diseased", p2: "villager", p3: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "wolf_vote" }, "p0");
  ok("the diseased villager dies", !WG.resolver.P(r.state, "p1").alive);
  ok("so does the wolf", !WG.resolver.P(r.state, "p0").alive);
})();

section("Avenger's oath fires on any death");
(function () {
  var r = room(["W", "Aveng", "Mark", "V", "V2"]);
  give(r, { p0: "werewolf", p1: "avenger", p2: "villager", p3: "villager", p4: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "revenge" }, "p1");
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "wolf_vote" }, "p0");
  ok("the avenger dies", !WG.resolver.P(r.state, "p1").alive);
  ok("and takes the sworn target", !WG.resolver.P(r.state, "p2").alive);
})();

section("Assassin: right guess kills, wrong guess is suicide");
(function () {
  var r = room(["Ass", "Seer", "V", "V2"]);
  give(r, { p0: "assassin", p1: "seer", p2: "villager", p3: "villager" });
  WG.resolver.P(r.state, "p0").killCharges = 2;
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "assassinate", payload: { roleGuess: "seer" } }, "p0");
  ok("a correct name kills", !WG.resolver.P(r.state, "p1").alive);

  var r2 = room(["Ass", "Seer", "V", "V2"]);
  give(r2, { p0: "assassin", p1: "seer", p2: "villager", p3: "villager" });
  WG.resolver.P(r2.state, "p0").killCharges = 2;
  night(r2);
  r2.eng.handle({ type: "ACT", houseId: "p1", actionId: "assassinate", payload: { roleGuess: "doctor" } }, "p0");
  ok("a wrong one is fatal to the assassin", !WG.resolver.P(r2.state, "p0").alive);
  ok("and harmless to the target", WG.resolver.P(r2.state, "p1").alive);
})();

section("Engineer's trap reports live");
(function () {
  var r = room(["Eng", "Seer", "V", "V2", "W"]);
  give(r, { p0: "engineer", p1: "seer", p2: "villager", p3: "villager", p4: "werewolf" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "trap" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "investigate" }, "p1");
  ok("the engineer is named the visitor at once", r.said("p0", "Trap:"), r.inbox("p0").join(" | "));
  ok("by name", r.said("p0", "Seer"));
})();

section("Seer reads a Lycan as a Werewolf");
(function () {
  var r = room(["Seer", "Lycan", "V", "V2"]);
  give(r, { p0: "seer", p1: "lycan", p2: "villager", p3: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "investigate" }, "p0");
  ok("the read comes back Werewolf", r.said("p0", "Werewolf"));
})();

section("Doppelgänger changes teams for real");
(function () {
  var r = room(["Dop", "Wolf", "V", "V2"]);
  give(r, { p0: "doppelganger", p1: "werewolf", p2: "villager", p3: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "copy" }, "p0");
  ok("it takes the role", WG.resolver.P(r.state, "p0").role === "werewolf");
  ok("and the team", WG.roles.teamOf(WG.resolver.P(r.state, "p0").role) === "werewolf");
  ok("the original keeps theirs", WG.resolver.P(r.state, "p1").role === "werewolf");
})();

section("Call Center Agent blocks the following night");
(function () {
  var r = room(["Agent", "Seer", "V", "V2"]);
  give(r, { p0: "call_center_agent", p1: "seer", p2: "villager", p3: "villager" });
  night(r);
  r.eng.handle({
    type: "ACT", houseId: "p1", actionId: "call_center_block",
    payload: { quiz: { question: "Ilan?", choices: ["1", "2", "3", "4"], correct: 2 } }
  }, "p0");
  ok("the quiz is parked for tomorrow", !!r.state.pendingQuizzes.p1);
  night(r);
  ok("and comes due", r.state.night.turns.p1.blocked === "quiz");
  var blocked = r.eng.handle({ type: "ACT", houseId: "p2", actionId: "investigate" }, "p1");
  ok("the seer cannot act while on hold", blocked.ok === false);
  r.eng.handle({ type: "QUIZ_ANSWER", choice: 0 }, "p1");
  ok("a wrong answer keeps them on hold", r.state.night.turns.p1.blocked === "quiz");
  r.eng.handle({ type: "QUIZ_ANSWER", choice: 2 }, "p1");
  ok("the right one releases them", r.state.night.turns.p1.blocked === null);
  var okAct = r.eng.handle({ type: "ACT", houseId: "p2", actionId: "investigate" }, "p1");
  ok("and then they can act", okAct.ok === true);
})();

section("Cult recruitment is a real offer, answered by the target");
(function () {
  var r = room(["Leader", "Mark", "V", "V2", "V3"]);
  give(r, { p0: "cult_leader", p1: "villager", p2: "villager", p3: "villager", p4: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p1", actionId: "recruit" }, "p0");
  var promptId = Object.keys(r.state.night.prompts)[0];
  ok("the target is asked", !!promptId);
  ok("and is still a villager while deciding", WG.resolver.P(r.state, "p1").role === "villager");
  r.eng.handle({ type: "CONSENT", offerId: promptId, ok: true }, "p1");
  ok("accepting converts them", WG.resolver.P(r.state, "p1").role === "cultist");

  var r2 = room(["Leader", "Mark", "V", "V2", "V3"]);
  give(r2, { p0: "cult_leader", p1: "villager", p2: "villager", p3: "villager", p4: "villager" });
  night(r2);
  r2.eng.handle({ type: "ACT", houseId: "p1", actionId: "recruit" }, "p0");
  var pid2 = Object.keys(r2.state.night.prompts)[0];
  r2.eng.handle({ type: "CONSENT", offerId: pid2, ok: false }, "p1");
  ok("refusing does not", WG.resolver.P(r2.state, "p1").role === "villager");
  ok("but still costs the charge", WG.resolver.P(r2.state, "p0").recruitsLeft === 2);
})();

/* ---------------- day, votes, wins ---------------- */

section("Voting and the rope");
(function () {
  var r = room(["W", "V", "V2", "V3", "V4"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager", p4: "villager" });
  r.state.round = 1;
  WG.clock.enter(r.state, "voting");
  r.state.votes = {};
  ["p1", "p2", "p3"].forEach(function (v) { r.eng.handle({ type: "VOTE", targetId: "p0" }, v); });
  r.eng.handle({ type: "VOTE", targetId: "SKIP" }, "p4");
  r.eng.advance();
  ok("the majority hangs", !WG.resolver.P(r.state, "p0").alive);
  ok("and the village wins", r.ended() && r.ended().team === "village", JSON.stringify(r.ended()));
})();

section("The village can vote for somebody the Shaman already buried");
(function () {
  var r = room(["W", "Shaman", "Vic", "V", "V2", "V3", "V4"]);
  give(r, {
    p0: "werewolf", p1: "wolf_shaman", p2: "villager",
    p3: "villager", p4: "villager", p5: "villager", p6: "villager"
  });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "mark" }, "p1");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p1");
  r.eng.advance();                       // dawn, and it is not mentioned
  WG.clock.enter(r.state, "voting");
  r.state.votes = {};

  // The ballot has to include them: leaving them off would give it away.
  var cast = r.eng.handle({ type: "VOTE", targetId: "p2" }, "p3");
  ok("a villager may vote for the missing player", cast.ok === true);
  ["p4", "p5", "p6"].forEach(function (v) { r.eng.handle({ type: "VOTE", targetId: "p2" }, v); });
  r.eng.advance();

  var log = r.state.publicLog.map(function (e) { return e.text; }).join(" | ");
  ok("the village finds the house empty", /found the house empty/.test(log), log);
  ok("and now everybody knows", r.state.announcedDead.p2 === true);
  ok("nobody was hanged for it",
    r.state.players.filter(function (p) { return !p.alive; }).length === 1);
})();

section("A Jester who gets the rope wins over the village");
(function () {
  var r = room(["Jest", "V", "V2", "V3"]);
  give(r, { p0: "jester", p1: "villager", p2: "villager", p3: "villager" });
  r.state.round = 1;
  WG.clock.enter(r.state, "voting");
  ["p1", "p2", "p3"].forEach(function (v) { r.eng.handle({ type: "VOTE", targetId: "p0" }, v); });
  r.eng.advance();
  ok("the Jester takes it", r.ended() && r.ended().team === "jester", JSON.stringify(r.ended()));
})();

section("A live Manipulator steals whatever result was coming");
(function () {
  var r = room(["W", "Man", "V", "V2", "V3"]);
  give(r, { p0: "werewolf", p1: "manipulator", p2: "villager", p3: "villager", p4: "villager" });
  r.state.round = 1;
  WG.clock.enter(r.state, "voting");
  ["p2", "p3", "p4"].forEach(function (v) { r.eng.handle({ type: "VOTE", targetId: "p0" }, v); });
  r.eng.advance();
  ok("the Manipulator wins instead", r.ended() && r.ended().team === "manipulator", JSON.stringify(r.ended()));
  ok("and it says whose win it took", r.ended().stolenFrom === "village");
})();

section("Archangel walks away from the rope");
(function () {
  var r = room(["Angel", "W", "V", "V2", "V3"]);
  give(r, { p0: "archangel", p1: "werewolf", p2: "villager", p3: "villager", p4: "villager" });
  r.state.round = 1;
  WG.clock.enter(r.state, "voting");
  ["p1", "p2", "p3"].forEach(function (v) { r.eng.handle({ type: "VOTE", targetId: "p0" }, v); });
  r.eng.advance();
  ok("still alive", WG.resolver.P(r.state, "p0").alive);
  ok("and demoted", WG.resolver.P(r.state, "p0").role === "villager");
})();

/* ---------------- redaction ---------------- */

section("Nobody can see anything they should not");
(function () {
  var r = room(["W1", "W2", "Seer", "Mayor", "V", "Mason1", "Mason2"]);
  give(r, {
    p0: "werewolf", p1: "werewolf", p2: "seer", p3: "mayor",
    p4: "villager", p5: "mason", p6: "mason"
  });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "protect" }, "p4");  // not a doctor; refused

  var vView = WG.view.build(r.state, "p4");
  var roleOf = function (v, id) {
    var c = v.players.filter(function (x) { return x.id === id; })[0];
    return c && c.role ? c.role.id : null;
  };
  ok("a villager cannot see a wolf's role", roleOf(vView, "p0") === null);
  ok("a villager can see the Mayor", roleOf(vView, "p3") === "mayor");
  ok("a villager sees their own", roleOf(vView, "p4") === "villager");

  var wView = WG.view.build(r.state, "p0");
  ok("a wolf sees the other wolf", roleOf(wView, "p1") === "werewolf");
  ok("a wolf cannot see the Seer", roleOf(wView, "p2") === null);
  ok("a wolf gets the pack tally", wView.night.packTally !== null);
  ok("a villager does not", vView.night.packTally === null);

  var mView = WG.view.build(r.state, "p5");
  ok("a Mason sees the other Mason", roleOf(mView, "p6") === "mason");
  ok("and nothing else", roleOf(mView, "p0") === null);

  var raw = JSON.stringify(vView);
  ok("no shields leak into any view", raw.indexOf("bodyshield") < 0 && raw.indexOf("shields") < 0);
  ok("no visit log leaks", raw.indexOf("packVotes\":{\"p") < 0);
  ok("no quiz answer key leaks", raw.indexOf("correct") < 0);
  ok("houses are exposed without their contents",
    vView.houses.length === 7 && vView.houses.every(function (h) { return h.id && !h.shields && !h.visits; }));
})();

section("Cats and dogs really cannot speak");
(function () {
  var r = room(["Cat", "V", "V2", "V3"]);
  give(r, { p0: "cat", p1: "villager", p2: "villager", p3: "villager" });
  r.state.round = 1;
  WG.clock.enter(r.state, "discussion");
  r.eng.handle({ type: "CHAT", text: "p1 is the wolf, I saw them", channel: "day" }, "p0");
  var line = r.state.chat.day[0];
  ok("the words are gone", line.text.indexOf("wolf") < 0, line.text);
  ok("only meows are left", /^(meow ?)+$/.test(line.text.trim()), line.text);
  r.eng.handle({ type: "CHAT", text: "p0 is acting strange", channel: "day" }, "p1");
  ok("a human is unaffected", r.state.chat.day[1].text.indexOf("strange") >= 0);
})();

section("The night is not a live feed");
(function () {
  var r = room(["W1", "W2", "Sick", "V", "V2", "V3"]);
  give(r, { p0: "werewolf", p1: "werewolf", p2: "diseased", p3: "villager", p4: "villager", p5: "villager" });
  night(r);
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p0");
  r.eng.handle({ type: "ACT", houseId: "p2", actionId: "wolf_vote" }, "p1");
  ok("the diseased villager takes a wolf with them", !WG.resolver.P(r.state, "p0").alive);
  ok("and the village is told none of it yet", r.state.publicLog.length === 0);
  r.eng.advance();
  ok("it all lands at dawn instead", r.state.publicLog.length > 0);
  ok("including the wolf that ate the wrong person",
    r.state.publicLog.some(function (e) { return e.text.indexOf("W1") >= 0; }));
})();

/* ---------------- the clock and the sky ---------------- */

section("The phase clock and the sky it paints");
(function () {
  var r = room(["A", "B", "C", "D"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager" });
  WG.clock.enter(r.state, "discussion");
  var t0 = r.state.phaseStartedAt;
  var a = WG.clock.skyAt(r.state, "light", t0);
  var b = WG.clock.skyAt(r.state, "light", t0 + WG.clock.durationMs(r.state, "discussion"));
  ok("morning and noon are different colours", a.sky1 !== b.sky1, a.sky1 + " vs " + b.sky1);
  ok("it starts at morning", a.label === "Morning", a.label);
  ok("and ends at noon", b.label === "Noon", b.label);
  ok("every stop resolves in dark too", WG.clock.skyAt(r.state, "dark", t0).sky1.length === 7);

  // The sky now carries an hour and a starlight level, and both must move.
  var t1 = t0 + WG.clock.durationMs(r.state, "discussion");
  ok("the hour advances with the phase",
    WG.clock.skyAt(r.state, "light", t0).hour < WG.clock.skyAt(r.state, "light", t1).hour);
  var nightSky = { phase: "night", phaseStartedAt: 0, phaseEndsAt: 1000, config: r.state.config };
  ok("night has stars and noon does not",
    WG.clock.skyAt(nightSky, "dark", 0).starlight === 1 &&
    WG.clock.skyAt(r.state, "dark", t1).starlight === 0);

  var order = [];
  var id = "night";
  for (var i = 0; i < 6 && id; i++) { order.push(id); id = WG.clock.phase(id).next; }
  ok("the round loops back to night",
    order.join(">") === "night>dawn>discussion>voting>verdict>night", order.join(">"));

  // The flow is data: a room can retime it without touching a line of code.
  r.state.config.flow.durations.discussion = 42;
  ok("room timing overrides the file", WG.clock.durationMs(r.state, "discussion") === 42000);
})();

section("Events bend the round without special-casing it");
(function () {
  var r = room(["A", "B", "C", "D"]);
  give(r, { p0: "werewolf", p1: "villager", p2: "villager", p3: "villager" });
  r.state.round = 3;
  WG.events.trigger(r.state, "long_night");
  WG.clock.enter(r.state, "night");
  ok("Long Night stretches the clock", WG.clock.durationMs(r.state, "night") === 180 * 1500);
  WG.events.trigger(r.state, "curfew");
  r.state.currentEvent = { id: "curfew", definition: WG.events.definition("curfew"), remaining: 1 };
  r.state.curfew = true;
  WG.resolver.beginNight(r.state);
  var offers = WG.resolver.offersAt(r.state, WG.resolver.P(r.state, "p1"),
    r.state.night.houses.p2, WG.resolver.P(r.state, "p2"));
  ok("Curfew locks a villager out of other houses",
    offers.every(function (o) { return !o.spendsTurn || !o.enabled; }));
  var wolfOffers = WG.resolver.offersAt(r.state, WG.resolver.P(r.state, "p0"),
    r.state.night.houses.p2, WG.resolver.P(r.state, "p2"));
  ok("but not the pack",
    wolfOffers.some(function (o) { return o.actionId === "wolf_vote" && o.enabled; }));
})();

/* ---------------- a whole game ---------------- */

section("A full game runs to a winner without falling over");
(function () {
  var names = [];
  for (var i = 0; i < 9; i++) names.push("P" + i);
  var r = room(names);
  r.state.roster = { werewolf: 2, seer: 1, doctor: 1, bodyguard: 1, villager: 3, jester: 1 };
  r.state.config.flow.durations = { role_reveal: 1, night: 1, dawn: 1, discussion: 1, voting: 1, verdict: 1 };
  var s = r.eng.startGame();
  ok("the game starts", s.ok === true, s.reason);
  ok("everyone got a role", r.state.players.every(function (p) { return !!p.role; }));

  var guard = 0;
  while (!r.state.winner && guard++ < 200) {
    if (r.state.phase === "night") {
      // Everybody does something legal, chosen at random from what is offered.
      r.state.players.filter(function (p) { return !r.state.night.turns[p.id].spent; }).forEach(function (p) {
        var houses = r.state.players.map(function (x) { return x.id; });
        for (var k = 0; k < houses.length; k++) {
          var hid = houses[Math.floor(Math.random() * houses.length)];
          var kn = WG.resolver.knock(r.state, p.id, hid);
          if (!kn.ok) continue;
          var usable = kn.offers.filter(function (o) { return o.enabled && o.spendsTurn && o.arity === 1 && !o.authoring; });
          if (!usable.length) continue;
          var pick = usable[Math.floor(Math.random() * usable.length)];
          r.eng.handle({ type: "ACT", houseId: hid, actionId: pick.actionId, payload: {} }, p.id);
          break;
        }
      });
    } else if (r.state.phase === "voting") {
      WG.resolver.living(r.state).forEach(function (p) {
        var others = WG.resolver.living(r.state).filter(function (x) { return x.id !== p.id; });
        if (!others.length) return;
        r.eng.handle({ type: "VOTE", targetId: others[Math.floor(Math.random() * others.length)].id }, p.id);
      });
    }
    r.eng.advance();
  }
  ok("it reached an ending", !!r.state.winner, "gave up after " + guard + " phases");
  ok("in a sane number of rounds", r.state.round < 40, "round " + r.state.round);
  console.log("    winner: " + (r.state.winner ? r.state.winner.team : "-") +
    " after " + r.state.round + " rounds, " + r.state.publicLog.length + " report lines");
})();

console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);

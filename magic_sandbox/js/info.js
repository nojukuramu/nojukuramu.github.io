/* ============================================================
   Magic Sandbox — the info sheet

   Lifted from RouteCast (routecast/static/js/info.js) with the namespace
   changed and the topics rewritten for this game: one sheet, one scrim, one
   registry, delegated clicks on anything carrying data-info="<key>". The
   house rule it exists for is the same one — the interface says one line,
   and the explanation lives behind a small (i) beside the thing it explains.

   Copy lives here rather than in index.html so the same explanation can be
   reached from the spellbook, the pause menu and the title screen without
   three copies drifting apart. Bodies are trusted HTML written in this file;
   nothing from storage or the network ever reaches the sheet.
   ============================================================ */

import { icon } from "./icons.js";

const k = (s) => '<kbd>' + s + '</kbd>';

const TOPICS = {
  howto: {
    title: "How to play",
    body:
      "<p>Climb the Loom Tower: ten floating floors, two per land. Odd floors end when you " +
      "sever three <b>Anchors</b>; even floors end at a <b>Warden</b>. Floor ten is the Loom Heart.</p>" +
      "<p>Kill things to level up. Every level offers three <b>boons</b> — pick one. Wardens " +
      "raise your <b>circle rank</b>, which lets you draw bigger spells.</p>" +
      "<p>Every attack is shown on the ground before it lands. Red means move; " +
      "a dash passes straight through danger.</p>" +
      "<p>Floors 1, 3, 5, 7 and 9 are <b>landings</b>: if you fall, you can start again from the " +
      "last one with the level and boons you arrived with.</p>" +
      "<p>The tower starts slow and presses a little harder every floor. Past the Heart, <b>Endless</b> never stops " +
      "getting harder — and never stops paying: bigger mana orbs, and Wardens that attune you.</p>"
  },
  controls: {
    title: "Controls",
    body:
      "<p><b>Keyboard and mouse</b><br>" + k("W A S D") + " move · aim with the mouse · hold " + k("Left click") + " to cast<br>" +
      k("1") + "–" + k("4") + " or the wheel choose a spell · " + k("Space") + " dash · " + k("F") + " or " + k("Right click") + " trigger<br>" +
      k("E") + " interact · " + k("Q") + " potion · " + k("B") + " spellbook · " + k("Esc") + " pause</p>" +
      "<p><b>Touch</b><br>Left thumb anywhere on the left half moves. On the right half, drag to aim and cast; " +
      "hold still to cast at the nearest enemy; tap for a single shot. Buttons for dash, potion and trigger sit by your right thumb.</p>" +
      "<p><b>Gamepad</b><br>Left stick move · right stick aim · RT cast · LT trigger · A dash · X interact · Y potion · " +
      "LB/RB change spell · Start pause · Back spellbook.</p>"
  },
  spells: {
    title: "Drawing a spell",
    body:
      "<p>A spell is a drawing on a page. Four things can go on it:</p>" +
      "<p>" + icon("toolGlyph") + " <b>Glyphs</b> — trace a closed shape through the ring's dots. " +
      "The number of sides is the element: <b>3 Air</b>, <b>4 Fire</b>, <b>5 Earth</b>, <b>6 Water</b>. " +
      "More glyphs hit harder and cost more.</p>" +
      "<p>" + icon("toolSeal") + " <b>Seals</b> — drag out a circle anywhere. Each seal is a muzzle; its size is its form " +
      "(Needle, Bolt, Orb, Nova) and its position is where the shot leaves from.</p>" +
      "<p>" + icon("toolRune") + " <b>Runes</b> — tap a seal's rim. Each rune is one shot in that direction. The top of " +
      "the page is where you aim. A seal with no runes fires straight ahead.</p>" +
      "<p>" + icon("layers") + " <b>Layers</b> — a second page fires out of every shot of the first when it lands, or " +
      "when you pull the trigger.</p>"
  },
  elements: {
    title: "Elements",
    body:
      "<p>" + icon("fire") + " <b>Fire</b> (4 sides) — burns, and splashes where it lands.</p>" +
      "<p>" + icon("water") + " <b>Water</b> (6 sides) — chills. Three chills freeze.</p>" +
      "<p>" + icon("earth") + " <b>Earth</b> (5 sides) — heavy: hits harder, pierces, shoves; flies slower.</p>" +
      "<p>" + icon("air") + " <b>Air</b> (3 sides) — fast and far, pushes hard, ricochets once off rocks and trees.</p>" +
      "<p>A page with no glyphs fires plain <b>Arcane</b> bolts: cheap, and weak.</p>"
  },
  forms: {
    title: "Forms",
    body:
      "<p>The size of a seal decides its form. The page is the ruler: the gap between two dots is about a Needle.</p>" +
      "<p>" + icon("needle") + " <b>Needle</b> — small seal. Fast, long, pierces two.</p>" +
      "<p>" + icon("bolt") + " <b>Bolt</b> — medium seal. The all-rounder.</p>" +
      "<p>" + icon("orb") + " <b>Orb</b> — large seal. Slow, heavy, bursts where it lands.</p>" +
      "<p>" + icon("nova") + " <b>Nova</b> — huge seal. No flight at all: a ring bursts out around where the seal sits. " +
      "Runes on a Nova do nothing.</p>"
  },
  reactions: {
    title: "Reactions",
    body:
      "<p>Two different elements in one layer react:</p>" +
      "<p>" + icon("steam") + " <b>Steam</b> fire + water — a scalding cloud.<br>" +
      icon("magma") + " <b>Magma</b> fire + earth — a burning pool.<br>" +
      icon("wildfire") + " <b>Wildfire</b> fire + air — much bigger blasts.<br>" +
      icon("mire") + " <b>Mire</b> water + earth — mud that bogs enemies down.<br>" +
      icon("storm") + " <b>Storm</b> water + air — lightning jumps to nearby enemies.<br>" +
      icon("shrapnel") + " <b>Shrapnel</b> earth + air — shatters into shards.</p>" +
      "<p>Draw three or four elements and every pair reacts. Your grimoire remembers what you have found.</p>"
  },
  balance: {
    title: "Balance",
    body:
      "<p>A page that mirrors itself left to right flies true. A lopsided one still works, but its shots " +
      "scatter and hit up to a quarter softer.</p>" +
      "<p>Every glyph corner, seal and rune counts. The easiest way to a balanced page is to draw things in pairs.</p>"
  },
  rank: {
    title: "Circle rank",
    body:
      "<p>Your rank decides how much one page can hold: glyphs and seals per layer, runes per seal, how many layers, " +
      "how much power, and how many shots one cast may make.</p>" +
      "<p>You start at rank 1. Every Warden you defeat drops a thread that raises it by one, up to 5. " +
      "Past rank 5 a thread <b>attunes</b> you instead: +8% spell damage and +10 mana, with no limit. " +
      "The Sandbox always runs at rank 5, so you can design ahead — a page beyond your rank shows a lock until you reach it.</p>"
  },
  price: {
    title: "Cost and cooldown",
    body:
      "<p>" + icon("spark") + " is everything one cast can deal: every shot of every layer, what a blast or a Nova " +
      "catches, what a pierce passes through, burns, chills and reactions.</p>" +
      "<p>" + icon("clock") + " <b>Cooldown</b> grows with it in a straight line, so a big page is a big hit on a long " +
      "wait — no page can be held down like a hose. " + icon("drop") + " <b>Mana</b> grows a little faster, so small " +
      "pages are the thrifty ones.</p>" +
      "<p>Mana comes back slowly while you cast and twice as fast once you hold off for a moment. Keep a cheap page " +
      "for the trickle and a big one for when it counts.</p>" +
      "<p>Boons that add damage do not raise the price.</p>"
  },
  power: {
    title: "Power",
    body: "<p>Power turns a layer up: more damage, bigger shots, a longer reach — and a steeper mana cost. " +
      "Your circle rank sets how high it goes.</p>"
  },
  sandbox: {
    title: "The Sandbox",
    body:
      "<p>A quiet island to try pages on. Straw dummies show your damage per second; the side panel " +
      "summons any enemy in front of you, or a Warden.</p>" +
      "<p>Everything is unlocked (rank 5), mana is endless and you cannot fall — both can be switched off. " +
      "Nothing here counts toward your climb, but your spellbook is shared, so a page drawn here is ready in the tower.</p>"
  },
  update: {
    title: "Updates",
    body:
      "<p>Magic Sandbox installs its own copy so it opens instantly and plays offline. That copy is replaced " +
      "when a new version is published.</p>" +
      "<p>A new version never swaps itself in mid-floor. It waits, and the bar at the top offers it; reloading keeps " +
      "your spellbook, grimoire, settings and your last landing.</p>"
  },
  quality: {
    title: "Graphics",
    body:
      "<p><b>Auto</b> starts at High on computers and Medium on phones, and steps down once by itself if the game " +
      "cannot keep a smooth frame rate.</p><p><b>High</b> adds glow to spells. <b>Medium</b> keeps soft shadows. " +
      "<b>Low</b> drops both and renders at a lower resolution — for older phones.</p>"
  },
  privacy: {
    title: "What is stored",
    body:
      "<p>Your spellbook, grimoire, settings, best climb, last landing and multiplayer name — in this browser only, under one key. " +
      "There are no accounts.</p>" +
      "<p>Playing alone sends nothing anywhere. Multiplayer sends only what a room needs, and only once you open it — " +
      "see <b>Multiplayer</b> in the title's multiplayer screen.</p>"
  },
  multiplayer: {
    title: "Multiplayer",
    body:
      "<p>There is no game server. Your browser talks straight to the other mages' browsers. A free public " +
      "meeting point (a PeerJS broker) only introduces them; it never sees the game.</p>" +
      "<p><b>What you share.</b> Browsing servers shares nothing but the asking. Joining a room sends your name and " +
      "your four spell pages to the mages in it. During a match, where your mage is and what it casts. Nothing else, " +
      "and nothing is kept once the room closes.</p>" +
      "<p><b>Stopping.</b> Leave is on every multiplayer screen and in the pause menu of every match. Closing the page " +
      "leaves the room too.</p>" +
      "<p>Everyone in a room needs the same version of the game. If a room says it runs another one, reload to update.</p>"
  },
  servers: {
    title: "Servers",
    body:
      "<p>Each server is a list of rooms, named after one of the tower's lands. They are all the same; pick any, or " +
      "use <b>Quick join</b> to take the busiest open room anywhere (or open one if nobody is waiting).</p>" +
      "<p>A server's list is kept by whichever player's browser opened it first. When that player leaves, another " +
      "takes it over, and the rooms reappear within a few seconds — so a list that looks empty for a moment is " +
      "just changing hands.</p>" +
      "<p>A <b>private</b> room is left off the list. Share its six-letter code instead.</p>"
  },
  modes: {
    title: "Modes",
    body:
      "<p>" + icon("tower") + " <b>Co-op climb</b> — the tower, together. Enemies are tougher for each mage in the room. " +
      "Loot is everyone's own: every chest, shrine and orb is there for each of you. A fallen mage watches until the next floor " +
      "— or until a friend stands beside them for a moment. The floor changes when everyone steps into the portal, or a few " +
      "seconds after anyone does.</p>" +
      "<p>" + icon("swords") + " <b>Wipe Out</b> — two teams, one life each per round. The last team standing takes the round; " +
      "the first to the set number of rounds (4 unless the room says otherwise) wins.</p>" +
      "<p>" + icon("swords") + " <b>Team deathmatch</b> — two teams, and you come back after a few seconds. The first team to " +
      "the kill count wins.</p>" +
      "<p>" + icon("swords") + " <b>Free for all</b> — no teammates. The first mage to the kill count wins.</p>" +
      "<p>In every fight between mages, everyone starts equal: level one, no boons, and the circle rank the room sets. " +
      "A spell hits another mage at a little under half the force it hits the Unravelled.</p>"
  },
  fog: {
    title: "Fog of war",
    body:
      "<p>You see as far as a lantern reaches, and not through trees, rocks or pillars — they throw shadows away from you. " +
      "Enemies and other mages in the dark are not drawn at all, not even on the map.</p>" +
      "<p>Your teammates are always shown.</p>"
  }
};

let sheet = null, scrim = null, titleEl = null, bodyEl = null, lastFocus = null;
const el = (id) => document.getElementById(id);

function ensure() {
  if (sheet) return true;
  sheet = el("info-sheet"); scrim = el("info-scrim"); titleEl = el("info-title"); bodyEl = el("info-body");
  return !!(sheet && titleEl && bodyEl);
}

export function open(key) {
  if (!ensure()) return false;
  const topic = TOPICS[key];
  if (!topic) return false;
  try { lastFocus = document.activeElement; } catch (e) { lastFocus = null; }
  titleEl.textContent = topic.title;
  bodyEl.innerHTML = topic.body;
  sheet.hidden = false;
  if (scrim) scrim.hidden = false;
  const close = el("info-close");
  if (close && close.focus) { try { close.focus(); } catch (e) {} }
  return true;
}

export function close() {
  if (!ensure() || sheet.hidden) return false;
  sheet.hidden = true;
  if (scrim) scrim.hidden = true;
  if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
  lastFocus = null;
  return true;
}
export function isOpen() { return ensure() && !sheet.hidden; }

export function init() {
  if (!ensure()) return;
  const closeBtn = el("info-close");
  if (closeBtn) closeBtn.addEventListener("click", close);
  if (scrim) scrim.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && isOpen()) { e.stopImmediatePropagation(); close(); } }, true);
  /* Delegated: the spellbook and the menus rebuild their markup constantly,
     and re-wiring every (i) on each render is how a button ends up dead. */
  document.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-info]") : null;
    if (!btn) return;
    e.preventDefault();
    open(btn.getAttribute("data-info"));
  });
}

export const has = (key) => !!TOPICS[key];
/* For the validator: every data-info in the page must name a topic here. */
export const keys = () => Object.keys(TOPICS);

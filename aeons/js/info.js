/* ============================================================
   Aeons — the info sheet

   Lifted from Hacks (hacks/js/info.js), which lifted it from Magic Sandbox
   and RouteCast (routecast/static/js/info.js): one sheet, one scrim, one
   registry, delegated clicks on anything carrying data-info="<key>". The
   house rule it exists for is the same — the interface says one line, and
   the explanation lives behind a small (i) beside the thing it explains.
   Changed: the topics, which are this game's.

   Bodies are trusted HTML written in this file; nothing from storage or the
   network ever reaches the sheet.
   ============================================================ */

const k = (s) => "<kbd>" + s + "</kbd>";

const TOPICS = {
  about: {
    title: "What this is",
    body:
      "<p>A real-time strategy game in the old style: gather, build, train, research, and fight across a map you cannot see " +
      "until you send someone to look.</p>" +
      "<p>There is no last battle. The enemy comes in <b>phases</b>: one base, somewhere in the mist. Break it and the next " +
      "phase begins — more bases, or stronger ones, and sometimes more land. The map has no edge but the one you have reached.</p>" +
      "<p>You begin with fire and sticks. Ten ages later you are somewhere else entirely. Getting everything to its last level " +
      "is a long road — the better part of fourteen hours.</p>"
  },
  howto: {
    title: "Playing on a phone",
    body:
      "<p><b>Tap</b> something of yours to select it. With units selected, <b>tap the ground</b> to move, an enemy to attack, " +
      "a tree or a vein to gather, a foundation to build.</p>" +
      "<p><b>Drag</b> one finger to look around; <b>pinch</b> to zoom. <b>Press and hold</b>, then drag, to draw a box round " +
      "units; press and hold without dragging to <b>attack-move</b> there. <b>Double-tap</b> a unit for all of its kind on screen.</p>" +
      "<p>The buttons at the bottom right are whatever is selected can do. A button that cannot be pressed yet says why in " +
      "the line above it.</p>" +
      "<p>The minimap moves the camera. The strip on the left holds your champions, your groups (tap to select, hold to " +
      "save the selection), idle workers and your army.</p>"
  },
  keys: {
    title: "Mouse and keys",
    body:
      "<p>" + k("Left") + " select, drag for a box · " + k("Right") + " the obvious order · " + k("Shift") + " queue orders or add to the selection · " +
      "double-click for all of a kind · " + k("Wheel") + " zoom · the arrow keys or the screen's edges pan.</p>" +
      "<p>" + k("A") + " attack-move · " + k("S") + " stop · " + k("H") + " hold · " + k("P") + " patrol · " + k("B") + " build · " +
      k("Ctrl") + "+" + k("1-9") + " save a group, " + k("1-9") + " select it (twice to go there) · " + k("Space") + " the last alarm · " +
      k(".") + " next idle worker · " + k("F") + " follow the selection · " + k("Esc") + " cancel, then the menu · " + k("Pause") + " pause.</p>" +
      "<p>Controlling a champion: " + k("WASD") + " walk, " + k("Q W E R") + " cast toward the pointer, " + k("Right") + " move or attack, " + k("Space") + " attack the nearest, " + k("Esc") + " let go.</p>"
  },
  phases: {
    title: "Phases",
    body:
      "<p>Each phase is one or more enemy bases somewhere you have not looked. Destroy every building in them that is not a wall " +
      "or a house and the phase is cleared; after a short breath, the next one begins.</p>" +
      "<p>A new phase may push the border outwards, opening land nobody has seen. Bases come from there more often than not.</p>" +
      "<p>The enemy fights in the era you could have reached by now. Linger, and they grow stronger than their era.</p>" +
      "<p>Clearing phases is also what opens the next era: each one asks for a number of phases cleared, as well as its price.</p>"
  },
  eras: {
    title: "Eras and levels",
    body:
      "<p>Ten eras: Ember, Bronze, Iron, Crowns, Powder, Steam, Engines, Signal, Stars, Aether. The next era is researched at " +
      "your hall, once the hall itself has been raised as far as this era allows and enough phases are cleared.</p>" +
      "<p>Every building has a level, and its level is the era it is built in: raising a hut to level five turns it into a " +
      "house of the Age of Powder. Higher levels are tougher, train faster, see further and — for towers — hit harder.</p>" +
      "<p>Units do not change by themselves. Each line (workers, foot soldiers, shooters, menders, mounts, siege, ships, " +
      "aircraft) is <b>retrained</b> into its next version at the building that makes it, and every one you already have changes " +
      "with it.</p>"
  },
  champions: {
    title: "Champions",
    body:
      "<p>Champions are called at the altar, five of them, each with four skills (the fourth opens at level 6). They learn from " +
      "every fight near them and keep up with your era by themselves. A fallen champion can be brought back.</p>" +
      "<p><b>Auto</b>: a champion takes orders like anyone else and decides for itself when to use its skills.</p>" +
      "<p><b>Control</b>: you drive it. A stick on the left walks; the big button attacks the nearest foe; tap a skill to cast it " +
      "at the obvious target, or drag from it to aim, and let go to cast. Drag back onto the button to change your mind.</p>" +
      "<p>Any unit can be taken in hand the same way — it simply has no skills.</p>"
  },
  automation: {
    title: "Automation",
    body:
      "<p>A large realm is held with habits, not clicks. Each doctrine is researched once at the academy, and then has a switch " +
      "in this panel.</p>" +
      "<p><b>Foremen</b> send idle workers to work. <b>Stewards</b> let you set how they split between gold, wood and stone. " +
      "<b>Quartermasters</b> raise houses before supply runs out. <b>Census</b> keeps training workers up to a number. " +
      "<b>Wardens of Stone</b> repair what is damaged inside your borders.</p>" +
      "<p><b>Signal Fires</b> send idle soldiers to an alarm near them, and back again afterwards. <b>Watchmen</b> show where " +
      "a contact is heading. <b>Bureaucracy</b> keeps the research you tick going whenever a building is free. <b>Logistics</b> " +
      "marches new soldiers to a muster point. <b>High Command</b> strikes the nearest known enemy base once your idle army " +
      "is big enough.</p>" +
      "<p>Later: <b>Satellites</b>, <b>Drone Wing</b>, <b>Overmind</b> and <b>Continuum</b>, which do what their names suggest.</p>"
  },
  intel: {
    title: "Fog, contacts and alarms",
    body:
      "<p>You see only what your units and buildings see. Ground you have seen stays mapped; enemy buildings stay where you last " +
      "saw them, even if they have since been destroyed.</p>" +
      "<p>Enemies you see become <b>contacts</b>: red diamonds that stay on the map and the minimap after they leave your sight, " +
      "with the direction they were going. Radar adds amber ones: things it can hear but nobody can see.</p>" +
      "<p>Anything of yours that is struck raises an <b>alarm</b>. The alarm button and " + k("Space") + " take you to the latest.</p>"
  },
  territory: {
    title: "Borders",
    body:
      "<p>Most buildings must stand inside your borders: the circle round your hall and each outpost. Outposts, towers, walls, " +
      "derricks and a few others can stand anywhere you have explored, and an outpost brings a new circle with it.</p>" +
      "<p>An outpost is also a drop-off for every resource and trains workers, so a far vein is worked from beside it.</p>"
  },
  landscape: {
    title: "Force landscape",
    body:
      "<p>Plays sideways however you hold the phone. On by default on phones; computers ignore it.</p>" +
      "<p>Where the browser allows it — Android, or the game installed to your home screen — the screen is locked sideways " +
      "(it may go fullscreen to do it). Where it does not, like Safari on iPhone, or while your phone's own rotation lock is on, " +
      "the game is drawn sideways instead: hold the phone with its top to your left.</p>"
  },
  saves: {
    title: "Saving",
    body:
      "<p>The game saves itself every minute and whenever you leave the page, to the autosave slot. Three more slots are yours. " +
      "Everything stays in this browser; export a save as a file to keep it anywhere else, or to move it to another device.</p>" +
      "<p>The world itself is never stored: it is grown again from its seed, and only what you changed is written down.</p>"
  },
  privacy: {
    title: "What is stored",
    body:
      "<p>Your settings, in this browser's local storage, and your saved games, in its IndexedDB. Nothing is sent anywhere. " +
      "There are no accounts and nothing here needs a connection once the game is installed.</p>"
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
  document.addEventListener("click", (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-info]") : null;
    if (!btn) return;
    e.preventDefault();
    open(btn.getAttribute("data-info"));
  });
}

export const has = (key) => !!TOPICS[key];
export const keys = () => Object.keys(TOPICS);

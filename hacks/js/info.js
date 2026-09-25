/* ============================================================
   Hacks — the info sheet

   Lifted from Magic Sandbox (magic_sandbox/js/info.js), which lifted it from
   RouteCast (routecast/static/js/info.js): one sheet, one scrim, one
   registry, delegated clicks on anything carrying data-info="<key>". The
   house rule it exists for is the same — the interface says one line, and
   the explanation lives behind a small (i) beside the thing it explains.
   Changed: the topics, which are this game's.

   Bodies are trusted HTML written in this file; nothing from storage or the
   network ever reaches the sheet. The long teaching material — the lessons
   and the API reference — lives in hackdocs.js, in the hacks panel.
   ============================================================ */

const k = (s) => "<kbd>" + s + "</kbd>";

const TOPICS = {
  about: {
    title: "What this is",
    body:
      "<p>A movement shooter in the style of Source and Apex, with one difference: <b>cheating is the point</b>. " +
      "Press " + k("H") + " in a match and you can write hacks — ESP, bone drawing, aimbots, bunny hop and strafe " +
      "scripts, radars — in JavaScript, and watch them run.</p>" +
      "<p>It is a place to learn to program. Every lesson in the hacks panel is a real technique (vectors, " +
      "trigonometry, projectile motion, state machines) wearing a game's clothes.</p>" +
      "<p>Hacks can read everything, but can only ever change <i>you</i>. There is no way for a hack to touch " +
      "another player, anyone's health, or the score.</p>"
  },
  howto: {
    title: "How to play",
    body:
      "<p><b>Keys</b> (all rebindable): " + k("W A S D") + " move · " + k("Space") + " or the wheel jump · " + k("Ctrl") + " crouch / slide · " +
      k("Shift") + " sprint · " + k("Mouse 1") + " fire · " + k("Mouse 2") + " aim · " + k("R") + " reload · " + k("F") + " lunge · " +
      k("V") + " quick melee · " + k("1") + k("2") + k("3") + " weapons · " + k("Tab") + " scores · " + k("H") + " hacks · " + k("Esc") + " menu.</p>" +
      "<p><b>Bunny hop.</b> Friction only happens on the ground. Press jump the moment you land — not before, not held — and you keep all your speed.</p>" +
      "<p><b>Air strafe.</b> In the air, hold " + k("A") + " or " + k("D") + " (not " + k("W") + ") and turn the mouse the same way, smoothly. " +
      "Each turn adds a little speed. Chain it with hops and you get faster every jump.</p>" +
      "<p><b>Surf.</b> The purple ridges are too steep to stand on. Land on a side, hold into it with " + k("A") + " or " + k("D") + ", and you glide along it with no friction.</p>" +
      "<p><b>Slide.</b> Crouch while sprinting. Downhill, a slide speeds up; jump out of it to keep the speed.</p>" +
      "<p><b>Wall climb.</b> Jump into a wall and keep holding jump and forward. Over the top, you mantle.</p>" +
      "<p><b>Wall jump.</b> Beside a wall in the air, tap jump. You keep your speed along the wall. The red shafts are made for it.</p>" +
      "<p><b>Lunge.</b> Hold " + k("F") + " on any surface — floor, wall, ceiling — and you stick to it and charge. Let go to launch where you look. " +
      "Facing straight away from the surface is the strongest launch.</p>"
  },
  bots: {
    title: "Bots",
    body:
      "<p>Bots play by the same rules as people: they move with the same physics, have to see you before they shoot, " +
      "and turn no faster than their difficulty allows. Harder bots react sooner, aim closer, strafe more and bunny hop.</p>" +
      "<p>They find their way on a map of where a body can walk, jump, climb and fall, worked out from the level itself.</p>"
  },
  weapons: {
    title: "Weapons",
    body:
      "<p><b>Handguns.</b> Wasp P9 — quick and accurate. Brick .50 — six heavy rounds.</p>" +
      "<p><b>Full auto.</b> Hornet SMG — fast, close. Kestrel AR — the all-rounder.</p>" +
      "<p><b>Shotgun.</b> Mauler — ten pellets, deadly up close.</p>" +
      "<p><b>Sniper.</b> Talon .338 — the only gun whose round flies. It takes time to arrive and it drops, so a moving target " +
      "has to be led. Aim down its sights, or it sprays.</p>" +
      "<p>Recoil lifts your view and does not come back on its own; pull down against it. Moving spreads your shots, jumping more.</p>"
  },
  lunge: {
    title: "The lunge",
    body:
      "<p>Both blades lunge. Hold " + k("F") + " (or aim with the blade out): if you are touching anything — the floor, a wall, a ceiling — you stick to it and charge. Release to launch where you look.</p>" +
      "<p>The more squarely you face away from the surface, the harder the launch: looking straight up off the floor is full power; looking along it is weak. " +
      "In the air with nothing to push from, a lunge is a short dash.</p>" +
      "<p><b>Katana:</b> charges fast, lunges short, cuts a wide arc. <b>Lancer:</b> charges slowly, lunges far and hard, and only hits what is at its tip.</p>" +
      "<p>A lunge that meets someone hits them. A tap instead of a hold is a quick swing.</p>"
  },
  touch: {
    title: "Touch controls",
    body:
      "<p>The stick moves you; push it to the edge to sprint. Drag anywhere that is not a button to look.</p>" +
      "<p>Fire and Lunge can be dragged while held, so you can aim as you shoot. Aim is a toggle.</p>" +
      "<p><b>Move buttons</b> lets you drag every button where your thumbs are, size it and fade it. " +
      "Sideways and upright each keep their own layout. Buttons can never be hidden — there is always one for everything.</p>"
  },
  multiplayer: {
    title: "Multiplayer",
    body:
      "<p>Browsers connect directly to each other. A public signalling service introduces them and then steps aside; " +
      "there is no game server.</p>" +
      "<p><b>What you share:</b> your name while you are in a room, and while a match is on, where you are, where you aim, " +
      "and what you shoot. Your hacks' code never leaves your browser — other people see what your hacks <i>do</i>, not what they are.</p>" +
      "<p>Leave is one tap from every multiplayer screen and from the pause menu.</p>"
  },
  servers: {
    title: "Servers",
    body:
      "<p>A server is a list of rooms. Whoever opens a server first keeps its list for everyone else, and when they leave the next browser takes over. " +
      "Nothing is stored anywhere once everyone has gone.</p><p>A private room is never listed; share its six-letter code.</p>"
  },
  rules: {
    title: "Hack rules",
    body:
      "<p>The room decides how much hacks may do:</p>" +
      "<p><b>Visual only</b> — read everything, draw on your own screen. ESP, bone drawing, radar, speedometers.</p>" +
      "<p><b>Assist</b> — and press your buttons and move your aim. Aimbots, triggerbots, bunny hop and strafe scripts, recoil control.</p>" +
      "<p><b>Full self</b> — and change your own body: velocity, gravity, speed, jump height, where you stand.</p>" +
      "<p>No setting lets a hack change another player, or anyone's health, ammo or score. A room's rules are applied by each player's own game.</p>"
  },
  update: {
    title: "Updates",
    body:
      "<p>Hacks installs its own copy so it opens instantly and plays offline. A new version never swaps itself in mid-match: " +
      "it waits, and the bar at the top offers it. Reloading keeps your hacks, binds and settings.</p>"
  },
  privacy: {
    title: "What is stored",
    body:
      "<p>Your settings, key binds, touch layouts, loadout, name and your hacks' code — in this browser only, under one key. " +
      "There are no accounts. Save a hack as a file to keep a copy anywhere else.</p>"
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

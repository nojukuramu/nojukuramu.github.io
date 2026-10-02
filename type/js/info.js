/* ============================================================
   Type — the info sheet

   Lifted from Hacks (hacks/js/info.js), which lifted it from Magic Sandbox and
   RouteCast: one sheet, one scrim, one registry, delegated clicks on anything
   carrying data-info="<key>". The house rule it exists for is the same — the
   page says one line, and the explanation lives behind a small (i).
   Changed: the topics, which are this app's.

   Bodies are trusted HTML written in this file; nothing from storage or the
   network ever reaches the sheet.
   ============================================================ */

const k = (s) => "<kbd>" + s + "</kbd>";

const TOPICS = {
  about: {
    title: "What this is",
    body:
      "<p>A typing trainer that never runs out of things to type. Every challenge is built on the spot from word lists and templates, so " +
      "the next one is almost never one you have seen.</p>" +
      "<p>There is no text box to click. Whatever you type goes straight into the challenge, the way it does in Monkeytype or TypeRacer, " +
      "so your hands can stay where they are.</p>" +
      "<p>Nothing is sent anywhere. Your best scores and settings live in this browser.</p>"
  },
  keys: {
    title: "Keys",
    body:
      "<p>" + k("Esc") + " a new challenge · " + k("Tab") + " the same challenge again · " + k("Enter") + " the next one, once you have finished.</p>" +
      "<p>" + k("Alt") + " + " + k("1") + " to " + k("5") + " switch category. Backspace works as you would expect; " +
      "mistakes stay on screen in red until you fix them, and the challenge ends when the whole thing is right.</p>" +
      "<p>Pasting is switched off, on purpose. In a race, none of the shortcuts apply: it is the same challenge for everyone.</p>"
  },
  categories: {
    title: "Categories",
    body:
      "<p><b>Mixed</b> picks Text, Terminal or Code at random each time. Random keys are left out of it, because they are a drill and not a mix-in.</p>" +
      "<p><b>Text</b> is ordinary sentences: short sayings and made-up little scenes.</p>" +
      "<p><b>Terminal</b> is shell commands from bash, zsh, fish, PowerShell, cmd, a Python prompt and SQLite. " +
      "Longer ones are a session: several commands in a row, with Enter between them. The prompt follows <code>cd</code> and is not typed.</p>" +
      "<p><b>Code</b> is small snippets from sixteen languages, in an editor.</p>" +
      "<p><b>Keys</b> is random characters from a random part of the keyboard: brackets and operators one time, digits and the shifted row the next.</p>"
  },
  length: {
    title: "Length",
    body:
      "<p><b>Short</b> is a sentence, a single command, a small snippet. <b>Medium</b> is a few sentences or a four-to-six step session. " +
      "<b>Long</b> is a paragraph, two sessions back to back, or several snippets.</p>"
  },
  versus: {
    title: "Racing",
    body:
      "<p>A race is the same challenge for everyone, typed at the same moment. Pick a way in:</p>" +
      "<p><b>Private room</b> gives you a code to send to friends. <b>Public rooms</b> lists rooms that hosts have opened to anyone. " +
      "<b>Quick match</b> walks you into an open room, or starts one and waits for the next person; the race begins a few seconds after a second player arrives.</p>" +
      "<p><b>What is shared:</b> your name, how far along you are, your speed, and your finishing time. Never the text you type, " +
      "and nothing at all unless you open this screen. Leaving a room stops it at once.</p>" +
      "<p>There is no game server. Players connect straight to each other, and a free public service only introduces them. " +
      "The host acts as referee, and a time faster than thirty characters a second is not ranked.</p>"
  },
  scoring: {
    title: "Scoring",
    body:
      "<p><b>WPM</b> counts five characters as a word, and only characters that ended up right. The clock starts on your first key.</p>" +
      "<p><b>Accuracy</b> is about keystrokes, not the final text: a mistake you backspace over still cost you.</p>" +
      "<p><b>Steadiness</b> is how even your speed was from second to second. 100 is metronome-flat.</p>"
  },
  code: {
    title: "Typing code",
    body:
      "<p>Indentation is shown but not typed. When you press " + k("Enter") + " the cursor lands on the first character of the next line, " +
      "as an editor with auto-indent would put it.</p>" +
      "<p>Everything else is typed exactly: brackets, quotes, semicolons and the blank lines between snippets.</p>"
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
  // hands back to whatever had focus: for this page, the capture box
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

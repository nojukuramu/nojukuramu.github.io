/* ============================================================
   Type — the page

   One hidden textarea receives every keystroke; this file keeps it focused
   and turns what is in it into the picture. The picture changes shape with
   the challenge: a document for sentences, a terminal for commands, an editor
   for code, big keycaps for random keys, a chat for the rare conversation.
   The arithmetic is engine.js, the challenges are gen.js, and neither knows
   a DOM exists.
   ============================================================ */

import * as update from "./update.js";
import * as info from "./info.js";
import * as store from "./store.js";
import { generate, CATEGORIES, LENGTHS } from "./gen.js";
import { freshSeed, hash } from "./rng.js";
import { compare, makeLedger, record, wpm, accuracy, consistency, firstError } from "./engine.js";
import * as mp from "./mp.js";
import { classify } from "./highlight.js";
import { LANG } from "./gen-code.js";

const $ = (id) => document.getElementById(id);
const cap = $("cap"), stage = $("stage");
const params = new URLSearchParams(location.search);
// ?seed=abc123 replays a challenge, ?convo shows the rare conversation (?convo=left, explain, sweet, ghost, funny, casual
// picks the kind), ?lang=rust picks a language
const URL_SEED = params.get("seed"), FORCE_CONVO = params.has("convo") ? (params.get("convo") || true) : false, FORCE_LANG = params.get("lang");

const S = {
  cat: CATEGORIES.indexOf(store.prefs.category) >= 0 ? store.prefs.category : "all",
  len: LENGTHS.indexOf(store.prefs.length) >= 0 ? store.prefs.length : "medium",
  ch: null, target: "", typed: "", ledger: makeLedger(), state: "idle",
  t0: 0, tEnd: 0, idleMs: 0, waitFrom: 0, doneAt: 0, fixedMs: null,
  last: [], chars: [], hook: null, correct: 0, samples: [], lastSecond: 0,
  turn: 0, typedTotal: 0, timers: [],
  race: false            // a race hands the challenge over; mp.js owns the clock's start and the results
};

function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/* ---------- building the faces ---------- */

/** characters of `text` as spans, grouped into words so a line breaks between them and not inside */
function buildWords(root, text, base) {
  clear(root);
  const chars = [];
  let word = null;
  for (const ch of text) {
    if (ch === " ") {
      word = null;
      const sp = mk("span", "c sp", " "); root.appendChild(sp); chars.push(sp);
    } else {
      if (!word) { word = mk("span", "w"); root.appendChild(word); }
      const s = mk("span", "c", ch); word.appendChild(s); chars.push(s);
    }
  }
  return chars;
}

function buildTerminal(ch) {
  const body = $("termBody"); clear(body);
  $("termTitle").textContent = ch.shell === "python" ? "python3" : ch.shell === "sqlite" ? "sqlite3" : ch.shell;
  const chars = [], lines = [];
  let pos = 0;
  ch.lines.forEach((l, i) => {
    const row = mk("div", "tline");
    row.appendChild(mk("span", "prompt", l.prompt + " "));
    const cmd = mk("span", "cmd");
    for (const c of l.cmd) { const s = mk("span", "c", c); cmd.appendChild(s); chars.push(s); }
    row.appendChild(cmd);
    const last = i === ch.lines.length - 1;
    if (!last) { const nl = mk("span", "c nl"); row.appendChild(nl); chars.push(nl); }
    body.appendChild(row);
    const out = l.out ? mk("div", "out", l.out) : null;
    if (out) body.appendChild(out);
    lines.push({ row, out, start: pos, end: pos + l.cmd.length, last });
    pos += l.cmd.length + 1;
  });
  return { chars, hook: (n) => {
    lines.forEach((L) => {
      const active = n >= L.start && n <= L.end;
      const done = L.last ? S.state === "done" : n > L.end;
      L.row.classList.toggle("active", active);
      L.row.classList.toggle("done", done);
      if (L.out) L.out.hidden = !done;
      if (active && L.row.scrollIntoView) L.row.scrollIntoView({ block: "nearest" });
    });
  } };
}

function buildCode(ch) {
  const lang = LANG[ch.lang];
  const body = $("codeBody"); clear(body);
  $("codeFile").textContent = ch.file;
  $("codeLang").textContent = ch.label;
  const chars = [], lines = [];
  let pos = 0;
  ch.lines.forEach((l, i) => {
    const row = mk("div", "cline");
    row.appendChild(mk("span", "ln", String(i + 1)));
    const ind = mk("span", "ind"); ind.style.width = l.indent + "ch"; row.appendChild(ind);
    const cls = classify(l.text, lang);
    const code = mk("span", "code");
    for (let k = 0; k < l.text.length; k++) {
      const s = mk("span", "c" + (cls[k] ? " t-" + cls[k] : ""), l.text[k]);
      code.appendChild(s); chars.push(s);
    }
    row.appendChild(code);
    const last = i === ch.lines.length - 1;
    if (!last) { const nl = mk("span", "c nl"); row.appendChild(nl); chars.push(nl); }
    body.appendChild(row);
    lines.push({ row, start: pos, end: pos + l.text.length });
    pos += l.text.length + 1;
  });
  return { chars, hook: (n) => {
    let at = lines[lines.length - 1];
    for (const L of lines) if (n >= L.start && n <= L.end) { at = L; break; }
    lines.forEach((L) => L.row.classList.toggle("active", L === at));
    $("codePos").textContent = "Ln " + (lines.indexOf(at) + 1) + ", Col " + (Math.max(0, Math.min(n, at.end) - at.start) + 1);
    // the caret itself, not the row: on a phone a long line scrolls sideways and the caret must stay in view
    const cur = chars[Math.min(n, chars.length - 1)];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest", inline: "nearest" });
  } };
}

function buildKeys(ch) {
  const chars = buildWords($("keysText"), ch.text);
  const key = $("nextKey");
  return { chars, hook: (n) => {
    const c = ch.text[n];
    key.textContent = c == null ? "" : c === " " ? "space" : c;
    key.classList.toggle("word", c === " ");
  } };
}

function buildText(ch) { return { chars: buildWords($("docText"), ch.text), hook: null }; }

/* ---------- the conversation ---------- */

function bubble(who, text, me) {
  const m = mk("div", "msg " + (me ? "me" : "them"));
  if (!me) m.appendChild(mk("span", "who", who));
  m.appendChild(mk("p", null, text));
  $("chatBody").appendChild(m);
  m.scrollIntoView({ block: "nearest" });
  return m;
}

function later(fn, ms) { const t = setTimeout(fn, ms); S.timers.push(t); }
function stopTimers() { S.timers.forEach(clearTimeout); S.timers = []; }

function beginWait() { if (S.state !== "waiting") { S.waitFrom = performance.now(); S.prev = S.state; S.state = "waiting"; } }
function endWait() { if (S.state === "waiting") { S.idleMs += performance.now() - S.waitFrom; S.state = S.prev === "done" ? "done" : (S.t0 ? "typing" : "idle"); } }

/** Show the room's turns up to the player's next one (or the end), each after a short typing pause. */
function playReplies(first) {
  const turns = S.ch.turns;
  const run = () => {
    if (S.turn >= turns.length) { endWait(); onChatEnd(); return; }
    const t = turns[S.turn];
    if (t.me) { endWait(); offerTurn(t); return; }
    if (t.sys) {
      const note = mk("div", "sys", t.text); $("chatBody").appendChild(note); note.scrollIntoView({ block: "nearest" });
      S.turn++; later(run, 550); return;
    }
    const dots = mk("div", "msg them typing"); dots.appendChild(mk("span", "who", t.who)); dots.appendChild(mk("p", null, "...")); 
    const wait = first && S.turn === 0 ? 0 : 450 + Math.min(900, t.text.length * 14);
    if (wait) { $("chatBody").appendChild(dots); dots.scrollIntoView({ block: "nearest" }); }
    later(() => { if (dots.parentNode) dots.parentNode.removeChild(dots); bubble(t.who, t.text, false); S.turn++; later(run, 250); }, wait);
  };
  beginWait(); run();
}

function offerTurn(t) {
  S.target = t.text; S.typed = ""; cap.value = "";
  S.chars = buildWords($("chatInput"), t.text); S.last = [];
  paint();
}

function onChatEnd() {
  if (S.state === "done" && !$("result").hidden) return;
  showResult();
}

function startConvo(ch) {
  clear($("chatBody"));
  $("chatTitle").textContent = ch.title;
  clear($("chatInput"));
  S.turn = 0; S.typedTotal = 0; S.chars = []; S.target = ""; S.typed = "";
  playReplies(true);
}

/* ---------- loading a challenge ---------- */

const VIEWS = { text: "v-text", terminal: "v-terminal", code: "v-code", keys: "v-keys", convo: "v-convo" };

function load(ch, opts) {
  stopTimers();
  S.race = !!(opts && opts.race);
  S.ch = ch; S.typed = ""; S.ledger = makeLedger(); S.state = S.race ? "locked" : "idle"; S.t0 = 0; S.tEnd = 0; S.idleMs = 0; S.fixedMs = null;
  S.samples = []; S.lastSecond = 0; S.last = []; S.correct = 0; cap.value = "";
  S.target = ch.text;
  for (const k of Object.keys(VIEWS)) $(VIEWS[k]).hidden = k !== ch.kind;
  stage.dataset.kind = ch.kind; stage.dataset.state = "idle";
  $("result").hidden = true;
  if (S.race) { $("raceResult").hidden = true; }
  let built;
  if (ch.kind === "terminal") built = buildTerminal(ch);
  else if (ch.kind === "code") built = buildCode(ch);
  else if (ch.kind === "keys") built = buildKeys(ch);
  else if (ch.kind === "convo") built = { chars: [], hook: null };
  else built = buildText(ch);
  S.chars = built.chars; S.hook = built.hook;
  $("seedLine").textContent = label(ch) + " · " + ch.seed;
  const b = store.best(S.cat, S.len);
  $("bestWpm").textContent = b ? String(Math.round(b)) : "--";
  $("liveWpm").textContent = "0"; $("liveAcc").textContent = "100"; $("liveTime").textContent = "0.0"; $("prog").style.width = "0%";
  if (ch.kind === "convo") startConvo(ch); else paint();
  focusCap();
}

function label(ch) {
  if (ch.kind === "terminal") return ch.shell;
  if (ch.kind === "code") return ch.label;
  if (ch.kind === "convo") return "conversation";
  return ch.kind;
}

function fresh() {
  let ch = null;
  const opts = { forceConvo: S.cat === "keys" ? false : FORCE_CONVO, lang: FORCE_LANG };
  for (let i = 0; i < 10; i++) {
    const seed = (i === 0 && URL_SEED && !S.usedUrlSeed) ? URL_SEED : freshSeed();
    ch = generate(S.cat, S.len, seed, opts);
    const h = hash(ch.text + "|" + ch.kind);
    if (!store.wasSeen(h) || (URL_SEED && !S.usedUrlSeed)) { store.markSeen(h); break; }
  }
  S.usedUrlSeed = true;
  return ch;
}

function newChallenge() { load(fresh()); }
function restart() { if (S.ch) load(S.ch); }

/* ---------- painting ---------- */

function paint() {
  const n = S.typed.length, states = compare(S.target, S.typed);
  let correct = 0;
  const chars = S.chars;
  for (let i = 0; i < chars.length; i++) {
    const st = states[i] | 0;
    if (st === 1) correct++;
    const want = i === n ? st + 3 : st;
    if (S.last[i] !== want) {
      S.last[i] = want;
      const e = chars[i];
      e.classList.toggle("ok", st === 1);
      e.classList.toggle("bad", st === 2);
      e.classList.toggle("cur", i === n);
    }
  }
  // the caret past the final character
  if (chars.length && n >= chars.length) chars[chars.length - 1].classList.add("cur-end"); else if (chars.length) chars[chars.length - 1].classList.remove("cur-end");
  S.correct = correct;
  if (S.hook) S.hook(n);
  const cur = chars[Math.min(n, chars.length - 1)];
  if (cur && S.ch.kind !== "convo" && S.ch.kind !== "terminal" && S.ch.kind !== "code" && cur.getBoundingClientRect) {
    const r = cur.getBoundingClientRect();
    if (r.top < 90 || r.bottom > innerHeight - 90) cur.scrollIntoView({ block: "center" });
  }
  const total = S.ch.kind === "convo" ? S.ch.text.replace(/\n/g, "").length : S.target.length;
  const done = (S.ch.kind === "convo" ? S.typedTotal : 0) + n;
  $("prog").style.width = Math.min(100, (done / Math.max(1, total)) * 100) + "%";
  if (S.race && S.state === "typing") {
    // progress is the run of right characters from the start: a wrong key holds you in place
    const fe = firstError(S.target, S.typed);
    mp.progress(fe < 0 ? n : fe, wpm(S.correct, elapsed()));
  }
}

function elapsed() { if (S.fixedMs != null) return S.fixedMs; return S.t0 ? Math.max(0, (S.state === "done" ? S.tEnd : performance.now()) - S.t0 - S.idleMs - (S.state === "waiting" ? performance.now() - S.waitFrom : 0)) : 0; }
function goodChars() { return (S.ch.kind === "convo" ? S.typedTotal : 0) + S.correct; }

function tick() {
  if (S.state !== "typing") return;
  const ms = elapsed(), w = wpm(goodChars(), ms);
  $("liveWpm").textContent = String(Math.round(w));
  $("liveAcc").textContent = String(Math.round(accuracy(S.ledger)));
  $("liveTime").textContent = (ms / 1000).toFixed(1);
  const sec = Math.floor(ms / 1000);
  if (sec > S.lastSecond) { S.lastSecond = sec; S.samples.push(w); }
}

/* ---------- typing ---------- */

function onInput() {
  if (S.state === "done" || S.state === "waiting" || !S.target) { cap.value = S.state === "done" ? "" : S.typed; return; }
  let v = cap.value.replace(/\r/g, "");
  if (v.length > S.target.length) { v = v.slice(0, S.target.length); cap.value = v; }
  if (S.state === "idle" && v.length) { S.state = "typing"; S.t0 = performance.now(); stage.dataset.state = "typing"; }
  record(S.ledger, S.typed, v, S.target);
  S.typed = v;
  paint();
  if (v === S.target) turnDone();
}

function turnDone() {
  if (S.ch.kind !== "convo") { finish(); return; }
  const t = S.ch.turns[S.turn];
  bubble("you", t.text, true);
  S.typedTotal += t.text.length; S.correct = 0; S.turn++; S.typed = ""; cap.value = ""; S.target = "";
  clear($("chatInput")); S.chars = []; S.last = [];
  const more = S.ch.turns.slice(S.turn).some((x) => x.me);
  // the clock stops on the last letter typed, not when the room has finished answering
  if (!more) { S.fixedMs = elapsed(); S.tEnd = performance.now(); S.state = "done"; stage.dataset.state = "done"; }
  playReplies(false);
}

function finish() {
  S.tEnd = performance.now(); S.state = "done"; S.doneAt = S.tEnd;
  stage.dataset.state = "done";
  paint();
  if (S.race) {
    const ms = Math.max(1, elapsed());
    mp.finished({ ms, wpm: wpm(S.ch.text.length, ms), acc: accuracy(S.ledger) });
    return;
  }
  showResult();
}

function showResult() {
  const ch = S.ch;
  const chars = ch.kind === "convo" ? S.typedTotal : ch.text.length;
  const ms = Math.max(1, elapsed());
  const w = wpm(chars, ms), acc = accuracy(S.ledger), steady = consistency(S.samples);
  S.doneAt = performance.now();
  $("rWpm").textContent = String(Math.round(w));
  $("rAcc").textContent = acc.toFixed(1).replace(/\.0$/, "") + "%";
  $("rTime").textContent = (ms / 1000).toFixed(1) + "s";
  $("rChars").textContent = String(chars);
  $("rSteady").textContent = String(steady);
  $("liveWpm").textContent = String(Math.round(w));
  $("liveTime").textContent = (ms / 1000).toFixed(1);
  const wasBest = store.best(S.cat, S.len);
  const isBest = store.submit(S.cat, S.len, { wpm: w, acc });
  $("bestWpm").textContent = String(Math.round(Math.max(wasBest, w)));
  $("rNote").textContent = isBest ? "A new best for this category and length." : wasBest ? "Best here: " + Math.round(wasBest) + " wpm." : "First score here.";
  drawSpark();
  stage.dataset.state = "done";
  $("result").hidden = false;
  S.state = "done";
  // a phone leaves the editor scrolled sideways at the last character; show it from the start again
  if (ch.kind === "code" && $("codeBody").scrollTo) $("codeBody").scrollTo(0, 0);
  // a long chat or a tall editor can push the numbers below the fold
  if ($("result").scrollIntoView) $("result").scrollIntoView({ block: "nearest" });
  if (S.hook) S.hook(S.typed.length);
}

function drawSpark() {
  const h = store.history().map((x) => x.wpm);
  const poly = $("spark").querySelector("polyline");
  // two points make a meaningless V; a trend needs a few
  $("spark").style.visibility = h.length < 4 ? "hidden" : "visible";
  if (h.length < 2) { poly.setAttribute("points", ""); return; }
  const lo = Math.min.apply(null, h), hi = Math.max.apply(null, h), span = Math.max(1, hi - lo);
  poly.setAttribute("points", h.map((v, i) => (i / (h.length - 1) * 160).toFixed(1) + "," + (34 - ((v - lo) / span) * 32).toFixed(1)).join(" "));
}

/* ---------- keeping the box focused ---------- */

function focusCap() { try { cap.focus({ preventScroll: true }); } catch (e) {} }

cap.addEventListener("input", onInput);
cap.addEventListener("paste", (e) => e.preventDefault());
cap.addEventListener("drop", (e) => e.preventDefault());
cap.addEventListener("focus", () => { $("focusHint").hidden = true; });
cap.addEventListener("blur", () => { if (!info.isOpen()) setTimeout(() => { if (document.activeElement !== cap && !info.isOpen() && S.state !== "done" && typingScreen()) $("focusHint").hidden = false; }, 120); });
// the capture box only owns the keyboard on the typing screens; the race lobby has real inputs of its own
const typingScreen = () => document.body.dataset.screen !== "mp";
window.addEventListener("focus", () => { if (!info.isOpen() && typingScreen()) focusCap(); });
document.addEventListener("click", (e) => { if (!info.isOpen() && typingScreen() && !(e.target.closest && e.target.closest("input"))) focusCap(); });
$("focusHint").addEventListener("click", focusCap);

const NEWLINE_KINDS = { terminal: 1, code: 1 };

document.addEventListener("keydown", (e) => {
  if (info.isOpen() || document.body.dataset.screen === "mp") return;
  const k = e.key;
  if (S.race) {
    // in a race nothing restarts, skips or switches: the challenge is the same one for everybody
    if (k === "Tab" || k === "Escape" || (e.altKey && /^[1-5]$/.test(k))) { e.preventDefault(); return; }
    if (k === "Enter" && (S.state === "done" || !NEWLINE_KINDS[S.ch.kind])) { e.preventDefault(); return; }
    if (document.activeElement !== cap && !e.ctrlKey && !e.metaKey && k.length === 1) focusCap();
    return;
  }
  if (k === "Escape") { e.preventDefault(); newChallenge(); return; }
  if (k === "Tab") { e.preventDefault(); restart(); return; }
  if (e.altKey && /^[1-5]$/.test(k)) { e.preventDefault(); setCat(CATEGORIES[+k - 1]); return; }
  if (k === "Enter") {
    if (S.state === "done") { e.preventDefault(); if (performance.now() - S.doneAt > 350) newChallenge(); return; }
    if (!NEWLINE_KINDS[S.ch.kind]) { e.preventDefault(); return; }
  }
  if (document.activeElement !== cap && !e.ctrlKey && !e.metaKey && k.length === 1) focusCap();
}, true);

/* ---------- the controls ---------- */

function setCat(c) {
  S.cat = c; store.prefs.category = c; store.commit(); syncControls(); newChallenge();
}
function setLen(l) {
  S.len = l; store.prefs.length = l; store.commit(); syncControls(); newChallenge();
}
function syncControls() {
  document.querySelectorAll("#cats [data-cat]").forEach((b) => { const on = b.dataset.cat === S.cat; b.setAttribute("aria-selected", on); b.classList.toggle("on", on); });
  document.querySelectorAll("#lens [data-len]").forEach((b) => { const on = b.dataset.len === S.len; b.setAttribute("aria-pressed", on); b.classList.toggle("on", on); });
}
$("cats").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b) setCat(b.dataset.cat); });
$("lens").addEventListener("click", (e) => { const b = e.target.closest("[data-len]"); if (b) setLen(b.dataset.len); });
$("btnNext").addEventListener("click", newChallenge);
$("btnRetry").addEventListener("click", restart);

/* ---------- boot ---------- */

info.init();
syncControls();
mp.init({
  loadRace: (ch) => load(ch, { race: true }),
  // the clock starts at the signal for everybody, not at each person's first key
  unlock: (t0) => { if (S.race && S.state === "locked") { S.state = "typing"; S.t0 = t0; stage.dataset.state = "typing"; focusCap(); } },
  finishRace: () => { if (S.race && S.state !== "done") { S.state = "done"; S.tEnd = performance.now(); stage.dataset.state = "done"; } },
  stopRaceUI: () => { S.race = false; },
  toSolo: () => { S.race = false; newChallenge(); focusCap(); }
});
setInterval(tick, 150);
newChallenge();

$("verLine").textContent = "Version " + update.version();
$("btnCheckUpdate").addEventListener("click", async () => {
  const r = await update.checkNow();
  const b = $("btnCheckUpdate");
  b.textContent = r === "ready" ? "Update ready" : r === "current" ? "Up to date" : r === "offline" ? "Offline" : r === "downloading" ? "Downloading..." : "Check for updates";
});

// reloading mid-challenge throws the challenge away, so the update flow asks first
const busy = () => (S.state === "typing" && S.typed.length > 0) || mp.inRoom() || mp.racing();
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").then((reg) => update.init(reg, busy)).catch(() => update.init(null, busy));
} else update.init(null, busy);

// tools/e2e.js drives the page through this; nobody else sees it
try { if (localStorage.getItem("type:debug") === "1") window.TY_DEBUG = { S, load, newChallenge }; } catch (e) { /* storage blocked */ }

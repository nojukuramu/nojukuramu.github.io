/* ============================================================
   Type — racing other people

   Three ways in, one race:
     Private room   a six-letter code; whoever has it can walk in
     Public rooms   hosts list themselves in a shared directory; anyone can see
                    the list and join
     Quick match    walk into the fullest open room, or start one and wait for
                    the next person; it starts itself a few seconds after a
                    second player arrives

   There is no server. Rooms are WebRTC data channels, the room code is the
   host's peer id, and the public list is a directory held by whichever browser
   got there first (peer.js and lobby.js, lifted from Hacks). A race sends only
   progress: how many characters you have right, your speed, and when you
   finished. The text is never sent; every browser builds the same challenge
   from the seed the host picked.

   The host is the referee. It hands out the seed, counts the clock, relays
   everyone's progress, and ranks the finishers. A time that would need more
   than thirty characters a second is not ranked.
   ============================================================ */

import * as lobby from "./lobby.js";
import { generate } from "./gen.js";
import { freshSeed } from "./rng.js";
import * as R from "./race.js";
import * as store from "./store.js";

const $ = (id) => document.getElementById(id);
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };

const HOST_ID = 1;
const M = { room: null, race: null, name: "", searching: 0, auto: null, joinTimer: 0, err: "" };
let api = null;

const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
const autoMs = () => num(window.TY_AUTO_MS, R.AUTO_START_MS);
const countMs = () => num(window.TY_COUNTDOWN_MS, R.COUNTDOWN_MS);

function setScreen(s) { document.body.dataset.screen = s; }
function showHome() { $("mp-home").hidden = false; $("mp-room").hidden = true; }
function showRoomView() { $("mp-home").hidden = true; $("mp-room").hidden = false; }
function error(msg) { M.err = msg; $("mpError").hidden = !msg; $("mpError").textContent = msg || ""; }

export const inRoom = () => !!M.room || M.searching > 0;
export const racing = () => !!M.race && !M.race.over;

/* ---------- entering and leaving ---------- */

export function open() {
  setScreen("mp"); showHome(); error("");
  $("mpName").value = M.name;
  lobby.openDirectories();
  renderList();
}

function closeAll() {
  endSearch();
  if (M.room) { try { M.room.leave(); } catch (e) {} M.room = null; }
  clearInterval(M.auto); M.auto = null; clearTimeout(M.joinTimer);
  stopRace(true);
  lobby.closeDirectories();
}

function backToSolo() {
  closeAll();
  setScreen("solo");
  api.toSolo();
}

/* ---------- the public list ---------- */

function renderList() {
  const ul = $("mpList"); clear(ul);
  const rooms = lobby.allRooms().filter((r) => !r.s.priv);
  const note = $("mpListNote");
  if (!rooms.length) note.textContent = M.heard ? "Nobody is hosting right now." : "Looking for rooms...";
  else note.textContent = rooms.length + (rooms.length === 1 ? " room" : " rooms") + " open";
  for (const r of rooms) {
    const li = mk("li");
    const g = mk("div", "grow");
    g.appendChild(mk("b", null, r.host));
    g.appendChild(mk("span", null, R.describe(r.s) + (r.s.auto ? " · quick match" : "")));
    li.appendChild(g);
    li.appendChild(mk("span", null, r.n + "/" + r.s.max));
    const b = mk("button", null, r.phase === "lobby" ? "Join" : "Racing");
    b.disabled = r.phase !== "lobby" || r.n >= r.s.max || r.v !== lobby.version();
    b.addEventListener("click", () => joinByCode(r.code));
    li.appendChild(b);
    ul.appendChild(li);
  }
}

/* ---------- rooms ---------- */

function mySettings(over) { return Object.assign({ cat: "all", len: "medium", max: 6, priv: false, auto: false }, over || {}); }

function createRoom(priv) {
  error("");
  const room = lobby.hostRoom({ name: M.name, settings: mySettings({ priv }) });
  attach(room);
}

function joinByCode(code) {
  error("");
  code = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length !== 6) { error("A room code is six letters and numbers."); return; }
  const room = lobby.joinRoom(code, M.name);
  attach(room);
  // a code nobody holds never says "no such room": the link just keeps trying, so say it ourselves
  clearTimeout(M.joinTimer);
  M.joinTimer = setTimeout(() => { if (M.room === room && room.state !== "open") { leaveRoom(); error("Could not find that room."); } }, 14000);   // leaving first: it clears the error line
}

function attach(room) {
  M.room = room;
  showRoomView();
  $("roomCode").textContent = room.code;
  render();
  const again = () => render();
  room.on("roster", again); room.on("settings", again); room.on("open", () => { clearTimeout(M.joinTimer); render(); });
  room.on("state", again);
  room.on("phase", again);
  room.on("msg", (id, m) => onMessage(room, id, m));
  room.on("join", (id) => { if (room.role === "host") { render(); } });
  room.on("leave", () => { if (room.role === "host") maybeFinishRace(); render(); });
  room.on("away", () => { if (room.role === "host") maybeFinishRace(); });
  room.on("denied", (why) => {
    if (M.room !== room) return;
    M.room = null; showHome();
    error(why === "full" ? "That room is full." : why === "version" ? "That room runs a different version of Type. Reload and try again." : "The room turned you away.");
  });
  room.on("closed", (why) => {
    if (M.room !== room) return;
    M.room = null; stopRace(true); showHome(); setScreen("mp");
    error(why === "kicked" ? "You were removed from the room." : why === "left" ? "" : "The host left, so the room closed.");
  });
  if (room.role === "host" && room.settings.auto) startAutoLoop(room);
}

function leaveRoom() {
  clearTimeout(M.joinTimer);
  clearInterval(M.auto); M.auto = null;
  endSearch();
  if (M.room) { try { M.room.leave(); } catch (e) {} M.room = null; }
  stopRace(true);
  setScreen("mp"); showHome();
}

function render() {
  const room = M.room;
  if (!room) return;
  const host = room.role === "host", s = room.settings || mySettings();
  $("roomKind").textContent = s.auto ? "Quick match" : s.priv ? "Private" : "Public";
  const hostP = room.roster.find((p) => p.host);
  $("roomTitle").textContent = host ? "Your room" : (hostP ? hostP.name + "'s room" : "Joining...");
  const ul = $("roster"); clear(ul);
  for (const p of room.roster) {
    const li = mk("li", (p.ready || p.host ? "ready " : "") + (p.away ? "away " : "") + (p.id === room.me ? "me" : ""));
    li.appendChild(mk("i", "dot"));
    li.appendChild(mk("span", "nm", p.name + (p.id === room.me ? " (you)" : "")));
    li.appendChild(mk("span", "st", p.host ? "host" : p.away ? "away" : s.auto ? "in" : p.ready ? "ready" : "not ready"));
    if (host && !p.host) {
      const k = mk("button", "ghost", "Remove"); k.style.padding = "2px 8px";
      k.addEventListener("click", () => room.kick(p.id));
      li.appendChild(k);
    }
    ul.appendChild(li);
  }
  document.querySelectorAll("#setCats [data-set-cat]").forEach((b) => b.classList.toggle("on", b.dataset.setCat === s.cat));
  document.querySelectorAll("#setLens [data-set-len]").forEach((b) => b.classList.toggle("on", b.dataset.setLen === s.len));
  $("roomSet").classList.toggle("locked", !host || s.auto);
  $("roomSummary").textContent = R.describe(s) + " · up to " + s.max + " players";
  const present = room.present().length;
  const waiting = room.roster.filter((p) => !p.host && !p.away && !p.ready);
  $("roomStart").hidden = !host || s.auto;
  $("roomStart").disabled = present < 2 || waiting.length > 0 || room.phase !== "lobby";
  const me = room.self();
  $("roomReady").hidden = host || s.auto;
  $("roomReady").textContent = me && me.ready ? "Not ready" : "I am ready";
  if (!M.autoNote) $("roomNote").textContent = host
    ? (s.auto ? (present < 2 ? "Waiting for someone to join. The race starts by itself." : "") : present < 2 ? "Share the code and wait for someone to join." : waiting.length ? "Waiting for " + waiting.map((p) => p.name).join(", ") + "." : "Everyone is ready.")
    : (s.auto ? "" : me && me.ready ? "Waiting for the host to start." : "Press ready when you are.");
}

/* ---------- quick match ---------- */

function endSearch() { M.searching = 0; }

async function quick() {
  error("");
  const token = ++M.searching;
  showRoomView();
  $("roomKind").textContent = "Quick match"; $("roomTitle").textContent = "Finding a match..."; $("roomCode").textContent = "------";
  clear($("roster")); $("roomNote").textContent = "Looking for an open room."; $("roomStart").hidden = true; $("roomReady").hidden = true;
  lobby.openDirectories();
  await lobby.settled(3500);
  const skip = [];
  for (let tries = 0; tries < 4; tries++) {
    if (M.searching !== token) return;
    const pick = R.quickPick(lobby.allRooms(), lobby.version(), skip);
    if (!pick) break;
    skip.push(pick.code);
    const ok = await tryJoin(pick.code, token);
    if (M.searching !== token) return;
    if (ok) { endSearch(); return; }
  }
  if (M.searching !== token) return;
  endSearch();
  // nobody to join: be the room, and wait for the next person to press the same button
  const room = lobby.hostRoom({ name: M.name, settings: mySettings({ auto: true }) });
  attach(room);
}

/** Join and wait to be welcomed or turned away. Resolves true once inside. */
function tryJoin(code, token) {
  return new Promise((resolve) => {
    const room = lobby.joinRoom(code, M.name);
    let done = false;
    const finish = (ok) => { if (done) return; done = true; clearTimeout(t); if (!ok) { try { room.leave(); } catch (e) {} } resolve(ok); };
    const t = setTimeout(() => finish(false), 7000);
    room.on("open", () => { if (done || M.searching !== token) { finish(false); return; } finish(true); attach(room); });
    room.on("denied", () => finish(false));
    room.on("closed", () => finish(false));
  });
}

/* A quick-match host: starts the race a few seconds after a second player arrives, and gives way to
   a smaller-coded room if two people searched at the same instant and both hosted. */
function startAutoLoop(room) {
  let deadline = 0;
  clearInterval(M.auto);
  M.auto = setInterval(async () => {
    if (M.room !== room) { clearInterval(M.auto); return; }
    if (room.phase !== "lobby") { deadline = 0; M.autoNote = false; return; }
    const present = room.present().length;
    if (present === 1) {
      const other = R.yieldTo(room.code, lobby.allRooms(), lobby.version());
      if (other) {
        clearInterval(M.auto); M.auto = null;
        try { room.leave(); } catch (e) {}
        M.room = null;
        const token = ++M.searching;
        showRoomView(); $("roomTitle").textContent = "Finding a match...";
        const ok = await tryJoin(other.code, token);
        if (!ok && M.searching === token) { endSearch(); const again = lobby.hostRoom({ name: M.name, settings: mySettings({ auto: true }) }); attach(again); }
        else endSearch();
        return;
      }
    }
    if (present >= 2) {
      if (!deadline) { deadline = Date.now() + autoMs(); room.broadcast({ t: "auto", in: autoMs() }); }
      const left = Math.max(0, deadline - Date.now());
      M.autoNote = true;
      $("roomNote").textContent = "Starting in " + Math.ceil(left / 1000) + "...";
      if (left <= 0) { deadline = 0; M.autoNote = false; startRace(); }
    } else if (deadline) {
      deadline = 0; M.autoNote = false; room.broadcast({ t: "auto", in: 0 }); render();
    }
  }, 500);
}

/* ---------- messages ---------- */

function onMessage(room, id, m) {
  if (!m || typeof m !== "object") return;
  if (room.role === "host") {
    if (m.t === "p") { const p = M.race && M.race.players.get(id); if (p && !p.fin) { const c = R.cleanProgress(m, M.race.total); p.n = c.n; p.w = c.w; } }
    else if (m.t === "fin") hostFinish(id, m);
  } else {
    if (m.t === "go") onGo(m);
    else if (m.t === "prog" && M.race && Array.isArray(m.a)) {
      for (const row of m.a.slice(0, 16)) {
        const p = M.race.players.get(row[0] | 0);
        if (!p || p.me) continue;
        const c = R.cleanProgress({ n: row[1], w: row[2] }, M.race.total);
        p.n = c.n; p.w = c.w;
        if (row[3] > 0) { p.fin = true; p.ms = row[3] | 0; }
      }
      drawLanes();
    }
    else if (m.t === "end" && Array.isArray(m.res)) showFinal(m.res);
    else if (m.t === "auto") {
      clearInterval(M.autoTick);
      const end = Date.now() + (m.in | 0);
      M.autoNote = (m.in | 0) > 0;
      if (M.autoNote) M.autoTick = setInterval(() => { const l = Math.max(0, end - Date.now()); $("roomNote").textContent = "Starting in " + Math.ceil(l / 1000) + "..."; if (!l) { clearInterval(M.autoTick); M.autoNote = false; } }, 250);
      else { render(); }
    }
  }
}

/* ---------- the race ---------- */

function startRace() {
  const room = M.room;
  if (!room || room.role !== "host" || room.phase !== "lobby" || room.present().length < 2) return;
  const s = room.settings;
  room.setPhase("playing");
  const m = { t: "go", seed: freshSeed(), cat: s.cat, len: s.len, in: countMs() };
  room.broadcast(m);
  onGo(m);
}

function onGo(m) {
  const room = M.room;
  if (!room || (M.race && !M.race.over)) return;
  const seed = String(m.seed || "").slice(0, 24), cat = R.CATS.indexOf(m.cat) >= 0 ? m.cat : "all", len = R.LENS.indexOf(m.len) >= 0 ? m.len : "medium";
  const ch = generate(cat, len, seed, { noConvo: true });
  const players = new Map();
  for (const p of room.roster) if (!p.away) players.set(p.id, { name: p.name, n: 0, w: 0, fin: false, ms: 0, acc: 0, me: p.id === room.me });
  const race = M.race = { ch, total: ch.text.length, players, over: false, started: 0, timers: [], iv: 0, lastSent: -1, firstFin: 0, host: room.role === "host" };
  clearInterval(M.autoTick); M.autoNote = false;
  setScreen("race");
  $("lanes").hidden = false; $("raceResult").hidden = true;
  api.loadRace(ch);
  drawLanes();
  const inMs = Math.max(500, Math.min(15000, m.in | 0 || countMs()));
  const count = $("count");
  const show = (txt) => { count.hidden = !txt; count.textContent = txt || ""; };
  for (let k = 3; k >= 1; k--) {
    const at = inMs - k * 1000;
    race.timers.push(setTimeout(() => show(String(k)), Math.max(0, at)));
  }
  race.timers.push(setTimeout(() => {
    show("GO");
    race.started = performance.now();
    api.unlock(race.started);
    race.timers.push(setTimeout(() => show(""), 600));
    race.iv = setInterval(tick, 200);
  }, inMs));
}

function tick() {
  const race = M.race, room = M.room;
  if (!race || race.over || !room) return;
  const me = [...race.players.values()].find((p) => p.me);
  if (me && !me.fin && me.n !== race.lastSent) {
    race.lastSent = me.n;
    if (room.role === "host") { /* the host's own numbers are already in the table */ }
    else room.send({ t: "p", n: me.n, w: me.w });
  }
  if (room.role === "host") {
    const a = [];
    for (const [id, p] of race.players) a.push([id, p.n, p.w, p.fin ? p.ms : 0]);
    room.broadcast({ t: "prog", a });
  }
  drawLanes();
}

/** main.js calls this after every keystroke while a race is on. */
export function progress(n, wpm) {
  const race = M.race;
  if (!race || race.over) return;
  const me = [...race.players.values()].find((p) => p.me);
  if (me && !me.fin) { me.n = n; me.w = Math.round(wpm); drawLanes(); }
}

/** main.js calls this when the player has typed the whole challenge. */
export function finished(r) {
  const race = M.race, room = M.room;
  if (!race || race.over || !room) return;
  const meId = room.me;
  const me = race.players.get(meId);
  if (!me) return;
  me.fin = true; me.ms = Math.max(1, Math.round(r.ms)); me.n = race.total; me.w = Math.round(r.wpm); me.acc = Math.round(r.acc);
  drawLanes();
  showTable(false);
  // after the table above, not before: the last finisher's own report can end the race right here,
  // and the final ranking must not be overwritten by "waiting for the others"
  if (room.role === "host") hostFinish(meId, { ms: me.ms, w: me.w, acc: me.acc });
  else room.send({ t: "fin", ms: me.ms, w: me.w, acc: me.acc });
}

function hostFinish(id, m) {
  const race = M.race, room = M.room;
  if (!race || race.over || !room) return;
  const p = race.players.get(id);
  if (!p || (p.fin && !p.me)) return;
  const c = R.cleanFinish(m, race.total);
  p.fin = true; p.n = race.total; p.w = c.w; p.acc = c.acc; p.ms = c.ok ? c.ms : 0;
  if (!race.firstFin) race.firstFin = setTimeout(() => endRace(), R.STRAGGLER_MS);
  maybeFinishRace();
}

function maybeFinishRace() {
  const race = M.race, room = M.room;
  if (!race || race.over || !room || room.role !== "host") return;
  const waiting = [...race.players].filter(([id, p]) => !p.fin && room.roster.some((r) => r.id === id && !r.away));
  if (!waiting.length) endRace();
}

function endRace() {
  const race = M.race, room = M.room;
  if (!race || race.over || !room) return;
  clearTimeout(race.firstFin);
  const rows = [...race.players].map(([id, p]) => ({ id, name: p.name, ms: p.ms, n: p.n, w: p.w, acc: p.acc }));
  const res = R.rank(rows);
  room.broadcast({ t: "end", res });
  showFinal(res);
  room.setPhase("lobby");
  room.resetReady();
}

function drawLanes() {
  const race = M.race;
  if (!race) return;
  const box = $("lanes");
  const rows = [...race.players.values()];
  if (box.children.length !== rows.length) { clear(box); rows.forEach(() => { const l = mk("div", "lane"); l.appendChild(mk("span", "nm")); const t = mk("div", "track"); t.appendChild(mk("i", "fill")); l.appendChild(t); l.appendChild(mk("span", "wp")); box.appendChild(l); }); }
  rows.forEach((p, i) => {
    const l = box.children[i];
    l.className = "lane" + (p.me ? " me" : "") + (p.fin ? " fin" : "");
    l.children[0].textContent = p.name;
    l.children[1].firstChild.style.width = Math.min(100, (p.n / Math.max(1, race.total)) * 100) + "%";
    l.children[2].textContent = p.fin && p.ms ? (p.ms / 1000).toFixed(1) + "s" : p.w + " wpm";
  });
  if (!$("raceResult").hidden && !race.over) showTable(false);
}

/** The results table. `final` is the host's ranking; before that it is a live one. */
function showTable(final, res) {
  const race = M.race, room = M.room;
  if (!race || !room) return;
  const rows = res || R.rank([...race.players].map(([id, p]) => ({ id, name: p.name, ms: p.fin ? p.ms : 0, n: p.n, w: p.w, acc: p.acc, live: !p.fin })));
  const body = $("rrBody"); clear(body);
  rows.forEach((r, i) => {
    const tr = mk("tr", r.id === room.me ? "me" : "");
    const done = r.ms > 0;
    tr.appendChild(mk("td", null, done ? String(i + 1) : "-"));
    tr.appendChild(mk("td", null, r.name));
    tr.appendChild(mk("td", null, done ? (r.ms / 1000).toFixed(1) + "s" : final ? "DNF" : "typing..."));
    tr.appendChild(mk("td", null, done ? r.w + " wpm" : ""));
    tr.appendChild(mk("td", null, done ? r.acc + "%" : ""));
    body.appendChild(tr);
  });
  $("raceResult").hidden = false;
  $("rrTitle").textContent = final ? "Results" : "Finished - waiting for the others";
  $("rrBack").disabled = !final; $("rrLeave").disabled = false;
  if ($("raceResult").scrollIntoView) $("raceResult").scrollIntoView({ block: "nearest" });
}

function showFinal(res) {
  const race = M.race, room = M.room;
  if (!race || !room) return;
  const clean = res.slice(0, R.MAX_PLAYERS).map((r) => ({ id: r && r.id | 0, name: R.cleanName(r && r.name, "Player"), ms: Math.max(0, r && r.ms | 0), n: r && r.n | 0, w: Math.max(0, r && r.w | 0), acc: Math.max(0, Math.min(100, r && r.acc | 0)) }));
  race.over = true;
  race.timers.forEach(clearTimeout); clearInterval(race.iv);
  api.finishRace();
  showTable(true, clean);
  const mine = clean.findIndex((r) => r.id === room.me);
  $("rrTitle").textContent = mine === 0 && clean[0].ms > 0 ? (clean.length > 1 ? "You won" : "Finished") : mine > 0 && clean[mine].ms > 0 ? "You came " + ordinal(mine + 1) : "Results";
  $("rrNote").textContent = room.settings && room.settings.auto ? "The next race starts when two or more are here." : "";
}
const ordinal = (n) => n + (["th", "st", "nd", "rd"][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || "th");

function stopRace(hard) {
  const race = M.race;
  if (race) { race.timers.forEach(clearTimeout); clearTimeout(race.firstFin); clearInterval(race.iv); }
  M.race = null;
  $("lanes").hidden = true; $("raceResult").hidden = true; $("count").hidden = true;
  if (hard) api.stopRaceUI();
}

function backToRoom() {
  stopRace(false);
  api.stopRaceUI();
  setScreen("mp"); showRoomView(); render();
}

/* ---------- wiring ---------- */

export function init(a) {
  api = a;
  // tools/mp-e2e.js looks at the race through this; nobody else sees it
  try { if (localStorage.getItem("type:debug") === "1") window.TY_MP = { M }; } catch (e) { /* storage blocked */ }
  M.name = R.cleanName(store.prefs.name, "") || R.randomName();
  $("mpName").value = M.name;
  $("btnVersus").addEventListener("click", () => { if (document.body.dataset.screen === "solo") open(); });
  $("mpBack").addEventListener("click", backToSolo);
  $("mpName").addEventListener("input", () => {
    M.name = R.cleanName($("mpName").value, "") || M.name;
    store.prefs.name = M.name; store.commit();
  });
  $("mpCreate").addEventListener("click", () => createRoom(true));
  $("mpHostPublic").addEventListener("click", () => createRoom(false));
  $("mpJoinForm").addEventListener("submit", (e) => { e.preventDefault(); joinByCode($("mpCode").value); });
  $("mpQuick").addEventListener("click", quick);
  $("roomLeave").addEventListener("click", leaveRoom);
  $("roomStart").addEventListener("click", startRace);
  $("roomReady").addEventListener("click", () => { const me = M.room && M.room.self(); if (me && M.room) M.room.setReady(!me.ready); });
  $("rrBack").addEventListener("click", backToRoom);
  $("rrLeave").addEventListener("click", () => { stopRace(false); api.stopRaceUI(); leaveRoom(); });
  $("roomCopy").addEventListener("click", async () => {
    const link = location.origin + location.pathname + "?room=" + $("roomCode").textContent;
    try { await navigator.clipboard.writeText(link); $("roomCopy").textContent = "Copied"; setTimeout(() => { $("roomCopy").textContent = "Copy link"; }, 1500); } catch (e) { $("roomCopy").textContent = $("roomCode").textContent; }
  });
  $("setCats").addEventListener("click", (e) => { const b = e.target.closest("[data-set-cat]"); if (b && M.room && M.room.role === "host") M.room.setSettings(Object.assign({}, M.room.settings, { cat: b.dataset.setCat })); });
  $("setLens").addEventListener("click", (e) => { const b = e.target.closest("[data-set-len]"); if (b && M.room && M.room.role === "host") M.room.setSettings(Object.assign({}, M.room.settings, { len: b.dataset.setLen })); });
  lobby.onLobby(() => { M.heard = true; if (document.body.dataset.screen === "mp" && !$("mp-home").hidden) renderList(); });
  // a shared link opens straight into the room
  const code = new URLSearchParams(location.search).get("room");
  if (code) { open(); joinByCode(code); }
}

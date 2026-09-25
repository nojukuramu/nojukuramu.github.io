/* mpui.js — the multiplayer screens: servers, a server's rooms, setting a
 * room up, the room itself, and the results.
 *
 * The same shape as a lobby in any online game, and the same rules as every
 * other screen here (menus.js): one stack, one Escape, one line of copy per
 * thing and the rest behind an (i). Two exceptions to Escape: it never leaves
 * a room or the results — a room is left with its own button, because
 * leaving one by accident costs the whole room its place.
 *
 * What you share is said before you share it (info "multiplayer"): joining
 * a room sends your name and your four pages to the mages in it, and your
 * position while a match is on. Browsing the server list sends nothing but
 * the asking. Leave is one tap from every multiplayer screen and the pause
 * sheet of every match. */

import { S, on, emit } from "./state.js";
import { save } from "./save.js";
import * as lobby from "./lobby.js";
import * as net from "./net.js";
import * as menus from "./menus.js";
import { MODES, MODE_IDS, MAPS, MAP_BY_ID, TEAMS, START_FLOORS, defaultSettings, cleanSettings, describe, quickPick, balanceTeams, cleanName } from "./modes.js";
import { icon, hydrateIcons } from "./icons.js";
import { escHtml } from "./util.js";

const $ = (id) => document.getElementById(id);
let room = null;
let viewServer = lobby.SERVERS[0].code;
let editing = false, draft = null;
let quickSkip = [], quickOn = false;
let status = "";

export const inRoom = () => !!room;

/* ---------------------------------------------------------------
   Names
   --------------------------------------------------------------- */
function myName() {
  let n = cleanName(save.data.name);
  if (!n) {
    n = "Mage " + Math.floor(100 + Math.random() * 900);
    save.data.name = n; save.commit();
  }
  return n;
}

/* ---------------------------------------------------------------
   Servers
   --------------------------------------------------------------- */
function openServers() {
  myName();
  $("mpName").value = save.data.name;
  lobby.openDirectories();
  setStatus("");
  renderServers();
  menus.show("servers");
}
function setStatus(t) { status = t; const el = $("mpStatus"); if (el) el.textContent = t; }

function serverWord(d) {
  if (!d) return "";
  if (d.state === "connecting" && !d.heard) return "Connecting…";
  const c = d.count();
  if (!c.rooms) return "No rooms yet";
  return c.rooms + (c.rooms === 1 ? " room" : " rooms") + " · " + c.players + (c.players === 1 ? " mage" : " mages");
}
function renderServers() {
  const box = $("serverList");
  box.innerHTML = lobby.SERVERS.map((sv) => {
    const d = lobby.directory(sv.code);
    return '<button class="mrow" data-server="' + sv.code + '" style="--c:' + sv.color + '">' + icon("server") +
      '<span class="mt"><b>' + escHtml(sv.name) + "</b><small>" + escHtml(serverWord(d)) + "</small></span>" + icon("up", "chev") + "</button>";
  }).join("");
  box.querySelectorAll("[data-server]").forEach((b) => b.addEventListener("click", () => { emit("ui"); openRooms(b.dataset.server); }));
}

/* ---------------------------------------------------------------
   A server's rooms
   --------------------------------------------------------------- */
function openRooms(code) {
  viewServer = code;
  renderRooms();
  menus.show("rooms");
}
function renderRooms() {
  const sv = lobby.SERVERS.find((s) => s.code === viewServer);
  const d = lobby.directory(viewServer);
  $("roomsTitle").textContent = sv.name;
  $("roomsSub").textContent = d && d.state === "holding" ? "You are keeping this server's list for now" : serverWord(d);
  const list = d ? d.rooms() : [];
  const box = $("roomList");
  if (!list.length) { box.innerHTML = '<p class="muted empty">' + (d && d.heard ? "No rooms yet — make one" : "Looking…") + "</p>"; return; }
  const v = lobby.version();
  box.innerHTML = list.map((r) => {
    const M = MODES[r.s.mode];
    const full = r.n >= r.s.max, old = r.v !== v;
    const tags = (r.s.fog ? icon("eye") : "") + (M.pvp ? icon("swords") : icon("tower"));
    const word = old ? "Another version" : full ? "Full" : r.phase === "playing" ? "Playing — join in" : "In the lobby";
    return '<button class="mrow' + (full || old ? " off" : "") + '" data-room="' + r.code + '"' + (full || old ? " disabled" : "") + ">" + tags +
      '<span class="mt"><b>' + escHtml(r.s.name || r.host + "'s room") + "</b><small>" + escHtml(describe(r.s)) + " · " + escHtml(word) + "</small></span>" +
      '<span class="cnt">' + icon("users") + r.n + "/" + r.s.max + "</span></button>";
  }).join("");
  box.querySelectorAll("[data-room]").forEach((b) => b.addEventListener("click", () => { emit("ui"); join(b.dataset.room); }));
}

/* ---------------------------------------------------------------
   Setting a room up (new, or the host changing it)
   --------------------------------------------------------------- */
function openRoomset(existing) {
  editing = !!existing;
  draft = existing ? Object.assign({}, existing) : Object.assign(defaultSettings("coop"), { name: myName() + "'s room" });
  $("roomsetTitle").textContent = editing ? "Room setup" : "New room";
  $("btnRoomsetGo").textContent = editing ? "Save" : "Create";
  $("rsName").value = draft.name;
  $("rsMap").innerHTML = MAPS.map((m) => '<option value="' + m.id + '">' + escHtml(m.name) + "</option>").join("");
  $("rsFloor").innerHTML = START_FLOORS.map((f) => '<option value="' + f + '">' + f + "</option>").join("");
  renderRoomset();
  menus.show("roomset");
}
const MODE_NOTE = {
  coop: "The climb, together. Enemies grow with the room.",
  wipeout: "Two teams, one life a round.",
  tdm: "Two teams race to the kill count.",
  ffa: "Everyone against everyone."
};
function renderRoomset() {
  const d = draft, M = MODES[d.mode];
  $("rsMode").innerHTML = MODE_IDS.map((id) => '<button type="button" data-mode="' + id + '" class="' + (id === d.mode ? "on" : "") + '">' + escHtml(MODES[id].short) + "</button>").join("");
  $("rsMode").querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => {
    emit("ui");
    const keep = { name: draft.name, fog: draft.fog, priv: draft.priv, map: draft.map };
    draft = Object.assign(defaultSettings(b.dataset.mode), keep);
    renderRoomset();
  }));
  $("rsModeNote").textContent = MODE_NOTE[d.mode];
  $("rsMapRow").hidden = !M.pvp;
  $("rsFloorRow").hidden = M.pvp;
  $("rsRankRow").hidden = !M.pvp;
  $("rsTargetRow").hidden = !M.target;
  $("rsMap").value = d.map;
  $("rsFloor").value = String(d.floor);
  $("rsMax").value = d.max; $("rsMaxN").textContent = d.max;
  if (M.target) {
    const t = $("rsTarget");
    t.min = M.target.min; t.max = M.target.max; t.step = M.target.step;
    t.value = d.target;
    $("rsTargetL").textContent = M.target.label;
    $("rsTargetN").textContent = d.target;
  }
  $("rsRank").value = d.rank; $("rsRankN").textContent = d.rank;
  $("rsFog").checked = d.fog;
  $("rsPriv").checked = d.priv;
}
function roomsetGo() {
  draft.name = cleanName($("rsName").value, myName() + "'s room").slice(0, 24);
  const s = cleanSettings(draft);
  if (editing && room && room.role === "host") {
    if (room.roster.length > s.max) s.max = room.roster.length;
    room.setSettings(s);
    menus.back();
    renderRoom();
    return;
  }
  host(s);
}

/* ---------------------------------------------------------------
   Being in a room
   --------------------------------------------------------------- */
function host(settings, server) {
  leaveRoom(true);
  room = lobby.hostRoom({ settings, name: myName(), server: server || viewServer });
  wire(room);
  showRoom();
}
function join(code) {
  const c = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (c.length !== 6) { setStatus("A room code is six letters and numbers"); return; }
  leaveRoom(true);
  room = lobby.joinRoom(c, myName());
  wire(room);
  showRoom();
}
function wire(r) {
  net.attach(r);
  const again = () => { if (room === r) renderRoom(); };
  r.on("roster", again); r.on("settings", again); r.on("phase", again); r.on("state", again); r.on("open", again);
  r.on("net", (s) => { if (room === r && r.state === "connecting") $("roomState").textContent = s === "retrying" ? "Still looking for this room…" : "Joining…"; });
  r.on("denied", (why) => {
    if (room !== r) return;
    room = null; net.detach();
    if (quickOn && why === "full") { quickSkip.push(r.code); quick(); return; }
    back2rooms(why === "full" ? "That room is full" : why === "version" ? "That room runs another version — reload to update" : "The room did not let you in");
  });
  r.on("closed", (why) => {
    if (room !== r) return;
    room = null;
    const inGame = S.match || S.mode !== "title";
    net.detach();
    if (inGame) menus.toTitle();
    if (why !== "left") back2rooms(why === "kicked" ? "The host removed you from the room" : why === "lost" ? "Lost the room's host — the room has closed" : "The host closed the room");
  });
}
function back2rooms(msg) {
  quickOn = false;
  if (S.mode !== "title") menus.toTitle();
  openServers();
  setStatus(msg || "");
}
function showRoom() {
  renderRoom();
  menus.show("room");
}
function leaveRoom(quiet) {
  if (!room) return;
  const r = room;
  room = null;
  r.leave();
  net.detach();
  if (!quiet) { if (S.mode !== "title") menus.toTitle(); openServers(); }
}

function renderRoom() {
  if (!room) return;
  const r = room, s = r.settings, me = r.self();
  if (r.state === "connecting" || !s) {
    $("roomName").textContent = "Room " + r.code;
    $("roomDesc").textContent = "";
    $("roomCode").textContent = r.code;
    $("roomState").textContent = "Joining…";
    $("roomPlayers").innerHTML = "";
    $("btnRoomStart").hidden = true; $("btnRoomReady").hidden = true; $("btnRoomEdit").hidden = true;
    return;
  }
  const M = MODES[s.mode];
  $("roomName").textContent = s.name || (r.roster[0] ? r.roster[0].name + "'s room" : "Room");
  $("roomDesc").textContent = describe(s) + (s.fog ? " · fog of war" : "") + (s.priv ? " · private" : "");
  $("roomCode").textContent = r.code;
  const host = r.role === "host";
  const present = r.roster.filter((p) => !p.away);
  // who is here
  const row = (p) => '<div class="prow' + (p.id === r.me ? " me" : "") + (p.away ? " away" : "") + '">' +
    (M.teams ? '<i class="tdot t' + p.team + '"></i>' : "") +
    "<b>" + escHtml(p.name) + "</b>" + (p.host ? '<small class="muted">host</small>' : p.away ? '<small class="muted">reconnecting</small>' : "") +
    '<span class="spacer"></span>' + (p.host ? "" : p.ready ? '<span class="rdy">' + icon("check") + "Ready</span>" : '<span class="muted">Not ready</span>') +
    (host && !p.host ? '<button class="iconBtn small" data-kick="' + p.id + '" aria-label="Remove ' + escHtml(p.name) + '">' + icon("close") + "</button>" : "") + "</div>";
  let html = "";
  if (M.teams) {
    html = '<div class="teams">' + [0, 1].map((t) => '<div class="team t' + t + '"><h3>' + TEAMS[t].name +
      (me && me.team !== t && r.phase === "lobby" ? ' <button class="btn ghost small" data-team="' + t + '">Join</button>' : "") + "</h3>" +
      r.roster.filter((p) => p.team === t).map(row).join("") + "</div>").join("") + "</div>";
  } else html = r.roster.map(row).join("");
  $("roomPlayers").innerHTML = html;
  $("roomPlayers").querySelectorAll("[data-kick]").forEach((b) => b.addEventListener("click", () => {
    const p = r.player(+b.dataset.kick);
    if (p && confirm("Remove " + p.name + " from the room?")) r.kick(p.id);
  }));
  $("roomPlayers").querySelectorAll("[data-team]").forEach((b) => b.addEventListener("click", () => { emit("ui"); r.setTeam(+b.dataset.team); }));
  // what can happen next
  const guests = present.filter((p) => !p.host);
  const allReady = guests.every((p) => p.ready);
  let why = "";
  if (M.pvp && present.length < 2) why = "Waiting for a second mage";
  else if (!allReady) why = "Waiting for everyone to be ready";
  const playing = r.phase === "playing";
  $("roomState").textContent = r.state === "reconnecting" ? "Reconnecting…" : playing ? "A match is on" : host ? why || "Everyone is ready" : "The host starts the match";
  $("btnRoomStart").hidden = !host;
  $("btnRoomStart").disabled = !!why || playing;
  $("btnRoomStart").querySelector("span").textContent = playing ? "Match in progress" : "Start";
  $("btnRoomReady").hidden = host || playing;
  $("btnRoomReady").querySelector("span").textContent = me && me.ready ? "Not ready" : "Ready";
  $("btnRoomReady").classList.toggle("primary", !(me && me.ready));
  $("btnRoomEdit").hidden = !host || playing;
}

function startMatch() {
  if (!room || room.role !== "host") return;
  const M = MODES[room.settings.mode];
  if (M.teams) {
    const bal = balanceTeams(room.roster.filter((p) => !p.away));
    room.setTeams(bal);
    const n = [0, 0];
    for (const p of bal) n[p.team]++;
    if (!n[0] || !n[1]) { $("roomState").textContent = "Both teams need a mage"; return; }
  }
  net.hostStart();
}

/* ---------------------------------------------------------------
   Quick join: the best open room anywhere, or a new one
   --------------------------------------------------------------- */
async function quick() {
  if (!quickOn) { quickOn = true; quickSkip = []; }
  if (!menus.isShown("servers")) openServers();
  setStatus("Looking for a room…");
  $("btnQuickJoin").disabled = true;
  await lobby.settled(6000);
  $("btnQuickJoin").disabled = false;
  if (!quickOn) return;
  const pick = quickPick(lobby.allRooms(), lobby.version(), quickSkip);
  if (pick) { setStatus("Joining " + (pick.s.name || pick.host + "'s room") + "…"); viewServer = pick.server; join(pick.code); return; }
  quickOn = false;
  // Nobody is waiting anywhere: open a room where the fewest are, and wait
  // for the next person to press the same button.
  let best = lobby.SERVERS[0].code, bn = 1e9;
  for (const sv of lobby.SERVERS) { const d = lobby.directory(sv.code); const c = d ? d.count().rooms : 0; if (c < bn) { bn = c; best = sv.code; } }
  viewServer = best;
  setStatus("");
  host(Object.assign(defaultSettings("coop"), { name: myName() + "'s room" }), best);
}

/* ---------------------------------------------------------------
   Matches starting and ending
   --------------------------------------------------------------- */
on("matchStart", () => {
  quickOn = false;
  menus.leaveTitle();
  menus.syncPause();
});
on("matchEnd", (w, m) => {
  const M = MODES[m.mode];
  let title = "", sub = "", win = false;
  if (m.mode === "coop") {
    win = w === "climb";
    title = win ? "The Loom is unmade" : "The loom unravels";
    sub = win ? "You climbed the tower together" : "Everyone fell on floor " + S.floor;
  } else if (M.teams) {
    win = w === (S.player ? S.player.team : -1);
    title = w === -1 ? "A draw" : TEAMS[w].name + " win";
    sub = win ? "Your side took it" : "The other side took it";
  } else {
    const p = room && room.player(+w);
    win = +w === S.net.me;
    title = win ? "You win" : (p ? p.name : "Somebody") + " wins";
    sub = "First to " + m.settings.target;
  }
  $("resTitle").textContent = title;
  $("resTitle").className = win ? "gold" : "";
  $("resSub").textContent = sub;
  $("resBoard").innerHTML = net.scoreboardHtml();
  menus.show("results");
});

function mpPause() {
  const r = room;
  $("pauseStats").textContent = r ? MODES[r.settings.mode].name + " · room " + r.code : "";
  $("pauseBoard").innerHTML = net.scoreboardHtml();
  $("pauseBoons").innerHTML = "";
}

/* ---------------------------------------------------------------
   Wiring
   --------------------------------------------------------------- */
const click = (id, fn) => $(id).addEventListener("click", (e) => { emit("ui"); fn(e); });

export function init() {
  hydrateIcons(document);
  menus.setHooks({
    escapeGuard: (top) => top === "room" || top === "results",
    inRoom,
    pause: mpPause
  });
  click("btnMulti", openServers);
  click("btnQuickTitle", () => { openServers(); quick(); });
  click("btnQuickJoin", () => { quickOn = false; quick(); });
  click("btnServersBack", () => { quickOn = false; lobby.closeDirectories(); menus.back(); });
  click("btnJoinCode", () => join($("joinCode").value));
  $("joinCode").addEventListener("keydown", (e) => { if (e.key === "Enter") join($("joinCode").value); });
  $("mpName").addEventListener("change", (e) => {
    save.data.name = cleanName(e.target.value) || save.data.name;
    e.target.value = save.data.name;
    save.commit();
  });
  click("btnCreateRoom", () => openRoomset(null));
  click("btnRoomsBack", () => menus.back());
  click("btnRoomsetGo", roomsetGo);
  click("btnRoomsetBack", () => menus.back());
  click("btnRoomStart", startMatch);
  click("btnRoomReady", () => { const me = room && room.self(); if (room) room.setReady(!(me && me.ready)); });
  click("btnRoomEdit", () => { if (room) openRoomset(room.settings); });
  click("btnRoomLeave", () => leaveRoom(false));
  click("btnResBack", () => {
    net.leaveMatch();
    menus.toTitle();
    showRoom();
  });
  click("btnResLeave", () => leaveRoom(false));
  $("rsMap").addEventListener("change", (e) => { draft.map = e.target.value; });
  $("rsFloor").addEventListener("change", (e) => { draft.floor = +e.target.value; });
  $("rsMax").addEventListener("input", (e) => { draft.max = +e.target.value; $("rsMaxN").textContent = draft.max; });
  $("rsTarget").addEventListener("input", (e) => { draft.target = +e.target.value; $("rsTargetN").textContent = draft.target; });
  $("rsRank").addEventListener("input", (e) => { draft.rank = +e.target.value; $("rsRankN").textContent = draft.rank; });
  $("rsFog").addEventListener("change", (e) => { draft.fog = e.target.checked; });
  $("rsPriv").addEventListener("change", (e) => { draft.priv = e.target.checked; });
  $("rsName").addEventListener("input", (e) => { draft.name = e.target.value; });
  on("mpLeave", () => { if (confirm("Leave the room? The match goes on without you.")) leaveRoom(false); });
  lobby.onLobby(() => {
    if (menus.isShown("servers")) renderServers();
    if (menus.isShown("rooms")) renderRooms();
  });
  // leaving the page leaves the room properly, so the others are told now
  addEventListener("pagehide", () => { if (room) room.leave(); });
}

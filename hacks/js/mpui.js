/* mpui.js — the multiplayer screens: servers, a server's rooms, setting a
 * room up, and the room itself.
 *
 * The shape and most of the behaviour are Magic Sandbox's mpui.js (on its
 * multiplayer branch): one stack shared with menus.js, Escape never leaves
 * a room (it is left with its own button), Quick join that finds the
 * busiest open room or makes one and waits, a latecomer walking into a
 * match in progress. What changed is what a room is set up with — mode,
 * players, kill count, time, bots and their difficulty, and the hack rules —
 * and that a match here starts straight into the shooter.
 *
 * What you share is said before you share it (info "multiplayer"): your
 * name, and during a match your position, aim and shots. Your hacks' code
 * is never sent. */

import { S, on, emit } from "./state.js";
import { save } from "./save.js";
import * as lobby from "./lobby.js";
import * as net from "./net.js";
import * as menus from "./menus.js";
import { MODES, ROOM_MODES, DIFFS, DIFF_IDS, HACK_RULES, HACK_RULE_IDS, TEAMS, defaultSettings, cleanSettings, describe, quickPick, balanceTeams, cleanName } from "./modes.js";
import { icon, hydrateIcons } from "./icons.js";
import { $, escHtml } from "./util.js";

let room = null;
let viewServer = lobby.SERVERS[0].code;
let editing = false, draft = null;
let quickSkip = [], quickOn = false;

export const inRoom = () => !!room;
function myName() {
  let n = cleanName(save.data.name);
  if (!n) { n = "Player " + Math.floor(100 + Math.random() * 900); save.data.name = n; save.commit(); }
  return n;
}

/* ---------------------------------------------------------------
   Servers and their rooms
   --------------------------------------------------------------- */
function openServers() {
  myName();
  $("mpName").value = save.data.name;
  lobby.openDirectories();
  setStatus("");
  renderServers();
  menus.show("servers");
}
function setStatus(t) { const el = $("mpStatus"); if (el) el.textContent = t; }
function serverWord(d) {
  if (!d) return "";
  if (d.state === "connecting" && !d.heard) return "Connecting…";
  const c = d.count();
  if (!c.rooms) return "No rooms yet";
  return c.rooms + (c.rooms === 1 ? " room" : " rooms") + " · " + c.players + (c.players === 1 ? " player" : " players");
}
function renderServers() {
  $("serverList").innerHTML = lobby.SERVERS.map((sv) => {
    const d = lobby.directory(sv.code);
    return '<button class="mrow" data-server="' + sv.code + '" style="--c:' + sv.color + '">' + icon("server") +
      '<span class="mt"><b>' + escHtml(sv.name) + "</b><small>" + escHtml(serverWord(d)) + "</small></span>" + icon("up", "chev") + "</button>";
  }).join("");
}
function openRooms(code) { viewServer = code; renderRooms(); menus.show("rooms"); }
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
    const full = r.n >= r.s.max, old = r.v !== v;
    const word = old ? "Another version" : full ? "Full" : r.phase === "playing" ? "Playing — join in" : "In the lobby";
    return '<button class="mrow' + (full || old ? " off" : "") + '" data-room="' + r.code + '"' + (full || old ? " disabled" : "") + ">" + icon(MODES[r.s.mode].teams ? "users" : "swords") +
      '<span class="mt"><b>' + escHtml(r.s.name || r.host + "'s room") + "</b><small>" + escHtml(describe(r.s)) + " · " + escHtml(word) + "</small></span>" +
      '<span class="cnt">' + icon("users") + r.n + "/" + r.s.max + "</span></button>";
  }).join("");
}

/* ---------------------------------------------------------------
   Setting a room up
   --------------------------------------------------------------- */
function openRoomset(existing) {
  editing = !!existing;
  draft = existing ? Object.assign({}, existing) : Object.assign(defaultSettings("ffa"), { name: myName() + "'s room" });
  $("roomsetTitle").textContent = editing ? "Room setup" : "New room";
  $("btnRoomsetGo").textContent = editing ? "Save" : "Create";
  $("rsName").value = draft.name;
  renderRoomset();
  menus.show("roomset");
}
function segHtml(ids, cur, name) { return ids.map((id) => '<button type="button" data-v="' + id + '" class="' + (id === cur ? "on" : "") + '">' + escHtml(name(id)) + "</button>").join(""); }
function renderRoomset() {
  const d = draft, M = MODES[d.mode];
  $("rsMode").innerHTML = segHtml(ROOM_MODES, d.mode, (id) => MODES[id].short);
  $("rsDiff").innerHTML = segHtml(DIFF_IDS, d.diff, (id) => DIFFS[id].name);
  $("rsHacks").innerHTML = segHtml(HACK_RULE_IDS, d.hacks, (id) => HACK_RULES[id].name);
  const t = $("rsTarget");
  t.min = M.target.min; t.max = M.target.max; t.step = M.target.step; t.value = d.target;
  $("rsTargetN").textContent = d.target;
  $("rsMax").value = d.max; $("rsMaxN").textContent = d.max;
  $("rsTime").value = d.time; $("rsTimeN").textContent = d.time ? d.time + " min" : "none";
  $("rsBots").value = d.bots; $("rsBotsN").textContent = d.bots ? d.bots + " players" : "no bots";
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
    back2servers(why === "full" ? "That room is full" : why === "version" ? "That room runs another version — reload to update" : "The room did not let you in");
  });
  r.on("closed", (why) => {
    if (room !== r) return;
    room = null;
    net.detach();
    if (why !== "left") back2servers(why === "kicked" ? "The host removed you from the room" : why === "lost" ? "Lost the room's host — the room has closed" : "The host closed the room");
  });
}
function back2servers(msg) {
  quickOn = false;
  if (S.mode !== "title") emit("quitMatch");
  menus.toTitle();
  openServers();
  setStatus(msg || "");
}
function showRoom() { renderRoom(); menus.show("room"); }
function leaveRoom(quiet) {
  if (!room) return;
  const r = room;
  room = null;
  r.leave();
  net.detach();
  if (!quiet) { if (S.mode !== "title") emit("quitMatch"); menus.toTitle(); openServers(); }
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
  $("roomDesc").textContent = describe(s) + (s.priv ? " · private" : "");
  $("roomCode").textContent = r.code;
  const isHost = r.role === "host";
  const present = r.roster.filter((p) => !p.away);
  const row = (p) => '<div class="prow' + (p.id === r.me ? " me" : "") + (p.away ? " away" : "") + '">' +
    (M.teams ? '<i class="tdot t' + p.team + '"></i>' : "") +
    "<b>" + escHtml(p.name) + "</b>" + (p.host ? '<small class="muted">host</small>' : p.away ? '<small class="muted">reconnecting</small>' : "") +
    '<span class="spacer"></span>' + (p.host ? "" : p.ready ? '<span class="rdy">' + icon("check") + "Ready</span>" : '<span class="muted">Not ready</span>') +
    (isHost && !p.host ? '<button class="iconBtn small" data-kick="' + p.id + '" aria-label="Remove ' + escHtml(p.name) + '">' + icon("close") + "</button>" : "") + "</div>";
  let html;
  if (M.teams) {
    html = '<div class="teams">' + [0, 1].map((t) => '<div class="team t' + t + '"><h3>' + TEAMS[t].name +
      (me && me.team !== t && r.phase === "lobby" ? ' <button class="btn ghost small" data-team="' + t + '">Join</button>' : "") + "</h3>" +
      r.roster.filter((p) => p.team === t).map(row).join("") + "</div>").join("") + "</div>";
  } else html = r.roster.map(row).join("");
  if (s.bots > present.length) html += '<p class="muted small">' + (s.bots - present.length) + " bots will make up the numbers.</p>";
  $("roomPlayers").innerHTML = html;
  const guests = present.filter((p) => !p.host);
  const allReady = guests.every((p) => p.ready);
  const playing = r.phase === "playing";
  let why = "";
  if (present.length + Math.max(0, s.bots - present.length) < 2) why = "Waiting for someone to play against (or add bots)";
  else if (!allReady) why = "Waiting for everyone to be ready";
  $("roomState").textContent = r.state === "reconnecting" ? "Reconnecting…" : playing ? "A match is on" + (S.match ? "" : " — you will join it") : isHost ? why || "Everyone is ready" : "The host starts the match";
  $("btnRoomStart").hidden = !isHost;
  $("btnRoomStart").disabled = !!why || playing;
  $("btnRoomStart").querySelector("span").textContent = playing ? "Match in progress" : "Start";
  $("btnRoomReady").hidden = isHost || playing;
  $("btnRoomReady").querySelector("span").textContent = me && me.ready ? "Not ready" : "Ready";
  $("btnRoomReady").classList.toggle("primary", !(me && me.ready));
  $("btnRoomEdit").hidden = !isHost || playing;
}
function startMatch() {
  if (!room || room.role !== "host") return;
  if (MODES[room.settings.mode].teams) room.setTeams(balanceTeams(room.roster.filter((p) => !p.away)));
  net.hostStart();
}

/* ---------------------------------------------------------------
   Quick join
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
  // nobody waiting anywhere: open a room where the fewest are, with bots, and wait for the next person
  let best = lobby.SERVERS[0].code, bn = 1e9;
  for (const sv of lobby.SERVERS) { const d = lobby.directory(sv.code); const c = d ? d.count().rooms : 0; if (c < bn) { bn = c; best = sv.code; } }
  viewServer = best;
  setStatus("");
  host(Object.assign(defaultSettings("ffa"), { name: myName() + "'s room" }), best);
}

/* ---------------------------------------------------------------
   Wiring
   --------------------------------------------------------------- */
const click = (id, fn) => $(id).addEventListener("click", (e) => { emit("ui"); fn(e); });

export function init() {
  hydrateIcons(document);
  menus.setHooks({
    escapeGuard: (top) => top === "room" || (top === "results" && inRoom()),
    inRoom,
    pause: () => { if (room) $("pauseStats").textContent = MODES[room.settings.mode].name + " · room " + room.code + " · hacks: " + HACK_RULES[room.settings.hacks].name.toLowerCase(); }
  });
  click("btnMulti", openServers);
  click("btnQuickTitle", () => { openServers(); quick(); });
  click("btnQuickJoin", () => { quickOn = false; quick(); });
  click("btnServersBack", () => { quickOn = false; lobby.closeDirectories(); menus.back(); });
  $("serverList").addEventListener("click", (e) => { const b = e.target.closest("[data-server]"); if (b) { emit("ui"); openRooms(b.dataset.server); } });
  $("roomList").addEventListener("click", (e) => { const b = e.target.closest("[data-room]"); if (b && !b.disabled) { emit("ui"); join(b.dataset.room); } });
  click("btnJoinCode", () => join($("joinCode").value));
  $("joinCode").addEventListener("keydown", (e) => { if (e.key === "Enter") join($("joinCode").value); });
  $("mpName").addEventListener("change", (e) => { save.data.name = cleanName(e.target.value) || save.data.name; e.target.value = save.data.name; save.commit(); });
  click("btnCreateRoom", () => openRoomset(null));
  click("btnRoomsBack", () => menus.back());
  click("btnRoomsetGo", roomsetGo);
  click("btnRoomsetBack", () => menus.back());
  click("btnRoomStart", startMatch);
  click("btnRoomReady", () => { const me = room && room.self(); if (room) room.setReady(!(me && me.ready)); });
  click("btnRoomEdit", () => { if (room) openRoomset(room.settings); });
  click("btnRoomLeave", () => leaveRoom(false));
  click("btnRoomLoadout", () => menus.show("loadout"));
  click("btnRoomHacks", () => emit("openHacks"));
  click("btnResBack", () => { if (!room) return; emit("quitMatch"); showRoom(); });
  $("roomPlayers").addEventListener("click", (e) => {
    const k = e.target.closest("[data-kick]"), t = e.target.closest("[data-team]");
    if (k && room) { const p = room.player(+k.dataset.kick); if (p && confirm("Remove " + p.name + " from the room?")) room.kick(p.id); }
    if (t && room) { emit("ui"); room.setTeam(+t.dataset.team); }
  });
  const segClick = (id, key) => $(id).addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    emit("ui");
    if (key === "mode") { const keep = { name: draft.name, priv: draft.priv, bots: draft.bots, diff: draft.diff, hacks: draft.hacks, max: draft.max, time: draft.time }; draft = Object.assign(defaultSettings(b.dataset.v), keep); }
    else draft[key] = b.dataset.v;
    renderRoomset();
  });
  segClick("rsMode", "mode"); segClick("rsDiff", "diff"); segClick("rsHacks", "hacks");
  const rng = (id, key, word) => $(id).addEventListener("input", (e) => { draft[key] = +e.target.value; $(id + "N").textContent = word(draft[key]); });
  rng("rsMax", "max", (v) => v); rng("rsTarget", "target", (v) => v);
  rng("rsTime", "time", (v) => (v ? v + " min" : "none")); rng("rsBots", "bots", (v) => (v ? v + " players" : "no bots"));
  $("rsPriv").addEventListener("change", (e) => { draft.priv = e.target.checked; });
  $("rsName").addEventListener("input", (e) => { draft.name = e.target.value; });
  on("mpLeave", () => { if (confirm("Leave the room? The match goes on without you.")) leaveRoom(false); });
  on("netMatch", () => { quickOn = false; });
  lobby.onLobby(() => {
    if (menus.isShown("servers")) renderServers();
    if (menus.isShown("rooms")) renderRooms();
  });
  addEventListener("pagehide", () => { if (room) room.leave(); });
}

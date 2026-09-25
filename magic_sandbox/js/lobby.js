/* lobby.js — the server list, the rooms in each server, and the room you are in.
 *
 * There is no game server. Rooms work exactly the way KaraokeNatin's and
 * RouteCast's do: the room code is the host's peer id, and everything after
 * the first handshake runs over a direct WebRTC channel (peer.js).
 *
 * A "server" is the one thing those apps did not need: a list of the rooms
 * somebody could walk into. Nothing static can hold a list that changes, so a
 * server here is a *directory* that whoever arrives first holds:
 *
 *   - Each server has a fixed code (VERD01, EMBR02 …). Every code carries a
 *     0, which room codes never do, so a server and a room cannot collide.
 *   - Opening a server tries to register that code on the brokers. If the
 *     brokers say it is free, this browser now holds the directory. If they
 *     say it is taken, somebody else holds it, and this browser joins them as
 *     a guest instead. Asking to register is the fastest honest answer to "is
 *     anyone here?" — a guest's offer to an empty id takes half a minute to
 *     expire on the public broker.
 *   - A room's host announces its row to the directory every few seconds; the
 *     holder forgets rows that stop being announced, and pushes the list to
 *     every guest when it changes.
 *   - When the holder leaves, its guests' links close and each tries to take
 *     the code over, a random moment apart. One wins, the rest join it, and
 *     the rooms announce themselves again within one beat.
 *
 * So the list is soft state that heals itself, and holding a directory costs
 * a browser a few hundred bytes of JSON every few seconds. Nothing is kept
 * anywhere once the last person has left.
 *
 * The room protocol keeps KaraokeNatin's vocabulary where it can: a guest says
 * hello, the host answers welcome or deny, the host sends the whole roster on
 * every change rather than patches, and a guest who drops keeps their seat for
 * a grace period so a phone that blinked does not lose its place. */

import "./peer.js";
import { cleanListing, cleanSettings, cleanName, pickTeam, MAX_PLAYERS } from "./modes.js";

const NET = () => window.MSN.net;
export const version = () => String(window.MS_VERSION || "?");

export const SERVERS = [
  { code: "VERD01", name: "Verdant Reach", color: "#8fc25e" },
  { code: "EMBR02", name: "Ember Wastes",  color: "#ffb13b" },
  { code: "FROS03", name: "Frostreach",    color: "#5fe3ff" },
  { code: "HOLL04", name: "The Hollow",    color: "#d58bff" },
  { code: "STRM05", name: "Stormspire",    color: "#f6e55a" }
];

const LIST_TTL = 25000;       // a row nobody has re-announced for this long is gone
const ANNOUNCE_MS = 8000;     // how often a room host re-announces its row
const PUSH_MS = 400;          // at most this often does the holder push the list
const AWAY_GRACE_MS = 15000;  // a guest whose link dropped keeps their seat this long
const HOST_GONE_MS = 20000;   // a host silent this long, after the grace, is gone

function emitter() {
  const map = {};
  return {
    on(n, fn) { (map[n] = map[n] || []).push(fn); return this; },
    off(n, fn) { map[n] = (map[n] || []).filter((f) => f !== fn); return this; },
    emit(n, a, b, c) { (map[n] || []).slice().forEach((fn) => { try { fn(a, b, c); } catch (e) { console.error("[ms] lobby " + n, e); } }); }
  };
}
function randomToken() {
  const b = new Uint8Array(9);
  try { crypto.getRandomValues(b); } catch (e) { for (let i = 0; i < b.length; i++) b[i] = Math.random() * 256; }
  return Array.from(b, (x) => (x % 36).toString(36)).join("");
}
/* A reload keeps the same broker token, so a holder or a host that reloads
   gets its own id back instead of being told it is taken by its own ghost. */
function sessionToken(key) {
  try {
    let t = sessionStorage.getItem(key);
    if (!t) { t = randomToken(); sessionStorage.setItem(key, t); }
    return t;
  } catch (e) { return randomToken(); }
}

/* ---------------------------------------------------------------
   A server: one directory, held here or joined
   --------------------------------------------------------------- */
function Directory(server) {
  const self = emitter();
  self.server = server;
  self.state = "connecting";      // connecting | holding | joined
  self.heard = false;             // a list has arrived (or we hold it)
  const rows = new Map();         // code -> { r, at, via }
  const mine = new Map();         // code -> listing this browser announces
  const browsers = new Map();     // holder: link id -> link
  let hostH = null, guestH = null, stopped = false, claimTimer = null, pushTimer = null, fails = 0;
  let held = new Set();

  function setState(s) { if (self.state !== s) { self.state = s; self.emit("change"); } }

  function dropHost() { if (hostH) { const h = hostH; hostH = null; h.stop(); } browsers.clear(); held = new Set(); }
  function dropGuest() { if (guestH) { const g = guestH; guestH = null; g.stop(); } }

  function claim() {
    if (stopped) return;
    clearTimeout(claimTimer); claimTimer = null;
    dropGuest(); dropHost();
    setState("connecting");
    const h = NET().host(server.code, { token: sessionToken("msandbox:dir:" + server.code) });
    hostH = h;
    h.on("broker", (b) => {
      if (hostH !== h || !b.up) return;
      held.add(b.index);
      if (self.state !== "holding") {
        rows.clear();
        for (const [code, r] of mine) rows.set(code, { r, at: Date.now(), via: "self" });
        self.heard = true;
        setState("holding");
        changed();
      }
    });
    h.on("id-taken", (index) => {
      if (hostH !== h) return;
      held.delete(index);
      // Somebody holds it on a broker at least as early in the list as any we
      // hold: theirs is the copy a guest walking the brokers in order finds.
      const lowest = held.size ? Math.min(...held) : Infinity;
      if (index <= lowest) join();
    });
    h.on("guest-message", (link, m) => { if (hostH === h) onGuest(link, m); });
    h.on("guest-close", (link) => { browsers.delete(link.id); });
  }

  function join() {
    if (stopped) return;
    clearTimeout(claimTimer); claimTimer = null;
    dropHost(); dropGuest();
    setState("connecting");
    fails = 0;
    const g = NET().join(server.code);
    guestH = g;
    g.on("open", () => {
      if (guestH !== g) return;
      fails = 0;
      setState("joined");
      g.send({ t: "hi" });
      for (const r of mine.values()) g.send({ t: "ann", r });
    });
    g.on("message", (m) => { if (guestH === g) onList(m); });
    // The holder went away: take the code over, a random moment after
    // everyone else noticed too, so one of us wins and the rest join them.
    g.on("closed", () => { if (guestH === g) later(300 + Math.random() * 1500); });
    g.on("state", (s) => {
      if (guestH !== g || s !== "retrying") return;
      if (++fails >= 2) later(Math.random() * 1200);
    });
  }
  function later(ms) { clearTimeout(claimTimer); claimTimer = setTimeout(claim, ms); }

  function onGuest(link, m) {
    if (!m || typeof m !== "object") return;
    if (m.t === "hi") { browsers.set(link.id, link); link.send({ t: "list", a: listing() }); }
    else if (m.t === "ann") {
      const r = cleanListing(m.r);
      if (!r) return;
      const had = rows.get(r.code);
      rows.set(r.code, { r, at: Date.now(), via: link.id });
      if (!had || JSON.stringify(had.r) !== JSON.stringify(r)) changed();
    } else if (m.t === "bye") {
      const code = String(m.code || "");
      const row = rows.get(code);
      if (row && row.via === link.id) { rows.delete(code); changed(); }
    }
  }
  function onList(m) {
    if (!m || m.t !== "list" || !Array.isArray(m.a)) return;
    rows.clear();
    for (const raw of m.a.slice(0, 200)) { const r = cleanListing(raw); if (r) rows.set(r.code, { r, at: Date.now(), via: "holder" }); }
    self.heard = true;
    self.emit("change");
  }
  function listing() { return [...rows.values()].map((x) => x.r); }
  function changed() {
    self.emit("change");
    if (self.state !== "holding" || pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      const msg = { t: "list", a: listing() };
      for (const link of browsers.values()) link.send(msg);
    }, PUSH_MS);
  }

  const beat = setInterval(() => {
    if (self.state === "holding") {
      const now = Date.now();
      let dirty = false;
      for (const [code, x] of rows) {
        if (x.via === "self") { if (mine.has(code)) x.at = now; else { rows.delete(code); dirty = true; } continue; }
        if (now - x.at > LIST_TTL) { rows.delete(code); dirty = true; }
      }
      if (dirty) changed();
    } else if (self.state === "joined" && guestH) {
      for (const r of mine.values()) guestH.send({ t: "ann", r });
    }
  }, ANNOUNCE_MS);

  self.rooms = () => listing().sort((a, b) => (a.phase === "lobby" ? 0 : 1) - (b.phase === "lobby" ? 0 : 1) || b.n - a.n);
  self.count = () => { const l = listing(); return { rooms: l.length, players: l.reduce((s, r) => s + r.n, 0) }; };
  self.announce = (listingRow) => {
    const r = cleanListing(listingRow);
    if (!r) return;
    mine.set(r.code, r);
    if (self.state === "holding") { rows.set(r.code, { r, at: Date.now(), via: "self" }); changed(); }
    else if (self.state === "joined" && guestH) guestH.send({ t: "ann", r });
  };
  self.unannounce = (code) => {
    if (!mine.delete(code)) return;
    if (self.state === "holding") { rows.delete(code); changed(); }
    else if (guestH) guestH.send({ t: "bye", code });
  };
  self.announcing = () => mine.size > 0;
  self.stop = () => {
    if (stopped) return;
    for (const code of [...mine.keys()]) self.unannounce(code);
    stopped = true;
    clearInterval(beat); clearTimeout(claimTimer); clearTimeout(pushTimer);
    // let a last "bye" leave before the channel goes
    setTimeout(() => { dropGuest(); dropHost(); }, 150);
  };
  claim();
  return self;
}

const dirs = new Map();
const lobbyBus = emitter();
export const onLobby = (fn) => lobbyBus.on("change", fn);

export function directory(code) {
  let d = dirs.get(code);
  if (!d) {
    const server = SERVERS.find((s) => s.code === code);
    if (!server) return null;
    d = Directory(server);
    d.on("change", () => lobbyBus.emit("change", code));
    dirs.set(code, d);
  }
  return d;
}
export function openDirectories() { for (const s of SERVERS) directory(s.code); }
/** Close every directory this browser is not announcing a room in. */
export function closeDirectories() {
  for (const [code, d] of dirs) if (!d.announcing()) { d.stop(); dirs.delete(code); }
}
export function allRooms() {
  const out = [];
  for (const [code, d] of dirs) for (const r of d.rooms()) out.push(Object.assign({ server: code }, r));
  return out;
}
/** Resolves once every open directory has answered, or after `ms`. */
export function settled(ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    (function poll() {
      const all = [...dirs.values()];
      if (all.length && all.every((d) => d.heard)) return resolve(true);
      if (Date.now() - t0 > ms) return resolve(false);
      setTimeout(poll, 150);
    })();
  });
}

/* ---------------------------------------------------------------
   Rooms
   --------------------------------------------------------------- */
const HOST_ID = 1;

function baseRoom(role) {
  const R = emitter();
  R.role = role;
  R.me = role === "host" ? HOST_ID : 0;
  R.code = "";
  R.roster = [];
  R.settings = null;
  R.phase = "lobby";
  R.state = "connecting";          // connecting | open | reconnecting | denied | closed
  R.hostId = HOST_ID;
  R.player = (id) => R.roster.find((p) => p.id === id) || null;
  R.self = () => R.player(R.me);
  return R;
}

/** Host a room: this browser is the room. */
export function hostRoom(opts) {
  const R = baseRoom("host");
  const net = NET();
  R.code = net.makeCode();
  R.settings = cleanSettings(opts.settings);
  R.server = opts.server || SERVERS[0].code;
  R.roster = [{ id: HOST_ID, name: cleanName(opts.name, "Host"), team: 0, ready: true, host: true, away: false }];
  const byLink = new Map();        // connection id -> player id
  const links = new Map();         // player id -> link
  const awayTimers = new Map();
  let nextId = HOST_ID + 1, closed = false;
  const h = net.host(R.code, { token: sessionToken("msandbox:room") });
  R.state = "open";

  const dir = directory(R.server);
  function announce() {
    if (closed || !dir) return;
    if (R.settings.priv) { dir.unannounce(R.code); return; }
    dir.announce({ code: R.code, s: R.settings, host: R.roster[0].name, n: R.roster.length, phase: R.phase, v: version() });
  }
  function sendRoster() { R.broadcast({ t: "roster", a: R.roster }); R.emit("roster"); announce(); }

  h.on("guest-message", (link, m) => {
    if (closed || !m || typeof m !== "object") return;
    let id = byLink.get(link.id);
    if (m.t === "hello") {
      if (String(m.v) !== version()) { link.send({ t: "deny", why: "version" }); setTimeout(() => h.kick(link.id), 400); return; }
      const back = id && R.player(id);
      if (!back && R.roster.length >= R.settings.max) { link.send({ t: "deny", why: "full" }); setTimeout(() => h.kick(link.id), 400); return; }
      if (back) {
        back.away = false; back.name = cleanName(m.name, back.name);
        clearTimeout(awayTimers.get(id)); awayTimers.delete(id);
      } else {
        id = nextId++;
        byLink.set(link.id, id);
        R.roster.push({ id, name: cleanName(m.name, "Mage " + id), team: pickTeam(R.roster), ready: false, host: false, away: false });
      }
      links.set(id, link);
      link.send({ t: "welcome", me: id, code: R.code, s: R.settings, phase: R.phase, roster: R.roster });
      sendRoster();
      R.emit("join", id, !!back);
      return;
    }
    if (!id || !R.player(id)) return;
    const p = R.player(id);
    if (m.t === "ready") { p.ready = !!m.v; sendRoster(); }
    else if (m.t === "team") { if (m.v === 0 || m.v === 1) { p.team = m.v; sendRoster(); } }
    else if (m.t === "leave") { drop(id); }
    else R.emit("msg", id, m);
  });
  h.on("guest-close", (link) => {
    const id = byLink.get(link.id);
    if (!id || links.get(id) !== link) return;
    links.delete(id);
    const p = R.player(id);
    if (!p) return;
    p.away = true;
    sendRoster();
    R.emit("away", id);
    clearTimeout(awayTimers.get(id));
    awayTimers.set(id, setTimeout(() => drop(id), AWAY_GRACE_MS));
  });
  function drop(id) {
    clearTimeout(awayTimers.get(id)); awayTimers.delete(id);
    const i = R.roster.findIndex((p) => p.id === id);
    if (i < 0) return;
    R.roster.splice(i, 1);
    const link = links.get(id);
    links.delete(id);
    for (const [cid, pid] of byLink) if (pid === id) { byLink.delete(cid); if (link) link.send({ t: "closed", why: "left" }); }
    sendRoster();
    R.emit("leave", id);
  }

  R.send = (m) => R.emit("msg", HOST_ID, m);                       // the host talking to itself
  R.to = (id, m) => { if (id === HOST_ID) R.emit("msg", HOST_ID, m); else { const l = links.get(id); if (l) l.send(m); } };
  R.broadcast = (m, except) => { for (const [id, l] of links) if (id !== except) l.send(m); };
  R.present = () => R.roster.filter((p) => !p.away).map((p) => p.id);
  R.setSettings = (s) => { R.settings = cleanSettings(s, R.settings); R.broadcast({ t: "set", s: R.settings }); R.emit("settings"); announce(); };
  R.setPhase = (p) => { R.phase = p; R.broadcast({ t: "phase", p }); R.emit("phase"); announce(); };
  R.setTeams = (list) => { for (const q of list) { const p = R.player(q.id); if (p) p.team = q.team; } sendRoster(); };
  R.setReady = () => {};
  R.setTeam = (t) => { R.roster[0].team = t; sendRoster(); };
  R.kick = (id) => {
    const link = links.get(id);
    if (link) { link.send({ t: "closed", why: "kicked" }); for (const [cid, pid] of byLink) if (pid === id) setTimeout(() => h.kick(cid), 200); }
    drop(id);
  };
  R.leave = () => {
    if (closed) return;
    R.broadcast({ t: "closed", why: "host-left" });
    closed = true;
    R.state = "closed";
    if (dir) dir.unannounce(R.code);
    for (const t of awayTimers.values()) clearTimeout(t);
    setTimeout(() => h.stop(), 250);
    R.emit("closed", "left");
  };
  R.announce = announce;
  announce();
  return R;
}

/** Join somebody else's room by its code. */
export function joinRoom(code, name) {
  const R = baseRoom("guest");
  const net = NET();
  R.code = net.normalizeCode(code);
  let done = false, welcomed = false, goneTimer = 0;
  const g = net.join(R.code);
  g.on("open", () => { if (!done) g.send({ t: "hello", name: cleanName(name, "Mage"), v: version() }); });
  // A host that closed its tab says goodbye; one whose phone died cannot. The
  // link retries by itself, and past the grace a guest is told the room is gone.
  g.on("closed", () => {
    if (done || !welcomed) return;
    R.state = "reconnecting"; R.emit("state");
    clearTimeout(goneTimer);
    goneTimer = setTimeout(() => { if (R.state === "reconnecting") end("closed", "lost"); }, AWAY_GRACE_MS + HOST_GONE_MS);
  });
  g.on("state", (s, why) => { if (!done) R.emit("net", s, why); });
  g.on("message", (m) => {
    if (done || !m || typeof m !== "object") return;
    if (m.t === "welcome") {
      welcomed = true;
      clearTimeout(goneTimer);
      R.me = m.me | 0; R.settings = cleanSettings(m.s); R.phase = m.phase === "playing" ? "playing" : "lobby";
      R.roster = cleanRoster(m.roster);
      const was = R.state;
      R.state = "open";
      R.emit(was === "reconnecting" ? "state" : "open");
      R.emit("roster");
    } else if (m.t === "deny") { end("denied", m.why === "full" ? "full" : m.why === "version" ? "version" : "denied"); }
    else if (m.t === "closed") { end("closed", m.why === "kicked" ? "kicked" : m.why === "left" ? "left" : "host-left"); }
    else if (m.t === "roster") { R.roster = cleanRoster(m.a); R.emit("roster"); }
    else if (m.t === "set") { R.settings = cleanSettings(m.s); R.emit("settings"); }
    else if (m.t === "phase") { R.phase = m.p === "playing" ? "playing" : "lobby"; R.emit("phase"); }
    else R.emit("msg", HOST_ID, m);
  });
  function end(state, why) {
    if (done) return;
    done = true; R.state = state;
    clearTimeout(goneTimer);
    setTimeout(() => g.stop(), 100);
    R.emit(state === "denied" ? "denied" : "closed", why);
  }
  R.send = (m) => { if (!done) g.send(m); };
  R.to = () => {}; R.broadcast = () => {};
  R.present = () => R.roster.filter((p) => !p.away).map((p) => p.id);
  R.setReady = (v) => R.send({ t: "ready", v: !!v });
  R.setTeam = (t) => R.send({ t: "team", v: t });
  R.leave = () => { if (done) return; R.send({ t: "leave" }); end("closed", "left"); };
  return R;
}

function cleanRoster(a) {
  if (!Array.isArray(a)) return [];
  return a.slice(0, MAX_PLAYERS).map((p) => ({
    id: p && typeof p.id === "number" ? p.id | 0 : 0,
    name: cleanName(p && p.name, "Mage"),
    team: p && p.team === 1 ? 1 : 0,
    ready: !!(p && p.ready), host: !!(p && p.host), away: !!(p && p.away)
  })).filter((p) => p.id > 0);
}

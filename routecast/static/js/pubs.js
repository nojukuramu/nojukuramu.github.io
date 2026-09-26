/* ============================================================
   RouteCast — PUBs

   A group ride is a room you are invited into. A PUB is the opposite: the
   public road. Turn PUBs on and you appear on the map of everyone else who
   has turned PUBs on near you; open a PUB room and anyone can walk in and
   talk. No invitation, no approval, no list of friends.

   Two separate things, and they are deliberately separate
   -------------------------------------------------------
   1. **Being visible.** Your name and your position, shared with the area.
      Off by default. One switch, one line of consequence, and a Go dark
      button that is always within one tap.
   2. **A PUB room.** A chat room with the door wedged open. Anyone with the
      code can enter, and the codes are published to the area, so in practice
      anyone nearby can enter. It is a chat room; it is not a ride, it carries
      no positions and no voice.

   You can do either without the other. Chatting in a PUB does not put you on
   the map, and being on the map does not put you in a room.

   What the area carries besides dots
   ----------------------------------
   Once you are visible, the area is a small road-side conversation of its
   own, all of it riding the same hub connection the dots already use:

   * **Shouts** — one short line, drawn over the sender's head on everybody's
     map for a few seconds. The hub attributes it from the connection it
     arrived on, so nobody can put words over somebody else's marker.
   * **Beeps** — a friendly horn from one rider to another. Addressed, not
     broadcast: the hub hands it to one connection and nobody else sees it.
   * **Road reports** — traffic, a crash, a hazard, a flood, a closed road, a
     checkpoint. Pinned where the reporter IS (the hub refuses a pin more than
     a short ride from the reporter's own last position), carried in the area
     packet with relative ages so no phone's clock matters, confirmed or
     voted away by whoever rides past, and forgotten on their own after a
     lifetime that depends on what they are. A hub that hands over passes
     them on; nothing is kept once the area empties.

   Where the "area" comes from, with no server
   -------------------------------------------
   The whole app already knows how to introduce two browsers with nothing but
   a six-character code (see peer.js). A private ride's code is random and
   secret. A PUB's is neither: it is DERIVED FROM WHERE YOU ARE — one code per
   ~1 degree cell of the world, about 110 km across — so two riders in the
   same region compute the same code without ever having spoken.

   Somebody still has to hold that room. So the first phone to arrive in an
   area becomes its hub: every client tries to JOIN the area code first, and
   only takes it over as host if nothing answers. If two phones start at the
   same instant, one of them is told the code is taken and quietly becomes a
   guest of the other. The hub is a relay and nothing more — it holds the
   area's presence list for as long as it is there, and when it leaves, the
   next phone to notice picks the room up. Nobody's location is stored
   anywhere, by anyone, ever.

   Area codes cannot collide with ride codes
   ----------------------------------------
   Ride codes are drawn from an alphabet with no 0, 1, I or O in it — the
   characters that get misread aloud. PUB codes start with one of those
   characters on purpose ("0" for an area hub, "1" for a room), so no PUB can
   ever land on somebody's private ride, and no ride can ever be mistaken for
   a PUB.

   What this is careful about
   --------------------------
   Everything that arrives from a stranger is treated as a stranger's claim:
   names and messages are stripped of control characters and capped, fixes
   that are not plausible coordinates are dropped rather than drawn at (0,0),
   one loud rider cannot flood the room, and there is a local block list that
   takes effect where the message ARRIVES rather than in a UI that could be
   talked out of hiding it. A hub relays; it does not moderate, because a
   self-appointed relay moderating a public channel is worse than one that
   does not.
   ============================================================ */
var RC = RC || {};

RC.pubs = (function () {
  "use strict";

  var MSG = {
    HI: "hi",              // -> hub: who I am, where I am
    WORLD: "world",        // hub -> everyone: the area
    ROOM_OPEN: "room+",    // -> hub: I am holding a room, publish it
    ROOM_SHUT: "room-",    // -> hub: it is gone
    SAY: "say",            // in a room: one line
    LOG: "log",            // room host -> a newcomer: what has been said
    ROSTER: "roster",      // room host -> everyone: who is in
    HELLO: "hello",        // -> room host: my name
    SHOUT: "shout",        // area: one short line over the sender's head
    BEEP: "beep",          // area: one rider's horn, addressed to one other
    REPORT: "rep+",        // -> hub: something on the road, right here
    VOTE: "rep?"           // -> hub: still there / not there
  };

  // The world, divided. One degree is roughly 110 km of latitude — big enough
  // that a region shares one hub, small enough that the hub is not relaying a
  // continent. Riders near a boundary see the cell they are in; that is a
  // real edge, and the alternative (overlapping cells) costs every client a
  // second connection for a case that resolves itself the moment they move.
  var AREA_DEG = 1;

  var NAME_MAX = 22;
  var TEXT_MAX = 280;
  var CHAT_KEEP = 80;            // lines a room host remembers for newcomers
  var CHAT_MIN_GAP_MS = 900;     // one rider cannot flood a public room
  var POS_MS = 4000;             // presence cadence — slower than a ride's
  var POS_MOVE_M = 60;           // ...or sooner, on real movement
  var STALE_MS = 45000;          // a fix older than this is nobody
  var WORLD_MS = 3000;           // how often a hub publishes the area
  var HUB_PROBE_MS = 7000;       // wait this long for an existing hub
  var HUB_MAX = 60;              // presences one hub will relay
  var ROOM_MAX = 40;             // people in one PUB room
  var ROOMS_MAX = 24;            // rooms one area advertises

  // The area's own talk. A shout is a speech bubble on a moving map, so it is
  // short and it is rationed harder than a room line: a bubble that is
  // replaced before it can be read was not worth drawing.
  var SHOUT_MAX = 120;
  var SHOUT_KEEP = 60;
  var SHOUT_MIN_GAP_MS = 2500;
  var BEEP_MIN_GAP_MS = 15000;   // one horn per rider per rider, hub-enforced
  var BEEP_HEAR_GAP_MS = 4000;   // ...and never a phone honking continuously

  // Road reports. Each kind lives as long as the thing it describes usually
  // does; a confirmation from somebody riding past buys it another lifetime,
  // and enough "not there" votes end it early.
  var REPORT_LIFE_MIN = {
    traffic: 20, crash: 45, hazard: 60, flood: 120, closed: 180, checkpoint: 60
  };
  var REPORTS_MAX = 40;          // pins one area holds
  var REPORT_MIN_GAP_MS = 20000; // one rider, one pin per twenty seconds
  var REPORT_NEAR_M = 1500;      // a pin goes where the reporter is, or nowhere
  var REPORT_SAME_M = 150;       // same kind this close: a confirmation instead

  // What a marker on somebody else's map may look like. A closed list, so a
  // stranger chooses among our glyphs rather than supplying one.
  var AVATARS = ["moto", "car", "bike", "scooter", "truck", "walk"];

  // Precision, deliberately blunted. A public broadcast does not need to say
  // which side of the road you are on, and five decimal places of somebody
  // else's business is not a thing to hand out to a region. ~11 m.
  var SHARE_DP = 4;

  var st = null;          // presence + rooms, or null when PUBs are off
  var room = null;        // the PUB room we are in, or null

  /* ---------------- helpers ---------------- */

  function now() { return Date.now(); }

  function clean(s, max) {
    s = String(s == null ? "" : s)
      .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/g, " ")
      .replace(/\s+/g, " ").trim();
    return s.slice(0, max);
  }

  function cleanName(s) { return clean(s, NAME_MAX); }
  function cleanText(s) { return clean(s, TEXT_MAX); }
  function cleanShout(s) { return clean(s, SHOUT_MAX); }
  function cleanId(s) { return String(s == null ? "" : s).replace(/[^A-Za-z0-9]/g, "").slice(0, 16); }
  function cleanAvatar(s) { return AVATARS.indexOf(String(s || "")) >= 0 ? String(s) : null; }

  function num(v) { var n = Number(v); return isFinite(n) ? n : null; }

  function cleanFix(p) {
    if (!p) return null;
    var lat = num(p.lat), lon = num(p.lon);
    if (lat == null || lon == null) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    var speed = num(p.speedKmh), course = num(p.courseDeg);
    return {
      lat: lat, lon: lon,
      speedKmh: speed == null ? null : Math.max(0, Math.min(400, speed)),
      courseDeg: course == null ? null : ((course % 360) + 360) % 360,
      at: now()     // always our clock: a stranger's cannot be allowed to age a marker
    };
  }

  function blunt(v) {
    var f = Math.pow(10, SHARE_DP);
    return Math.round(v * f) / f;
  }

  function rid(n) {
    var a = "abcdefghijklmnopqrstuvwxyz0123456789", out = "";
    for (var i = 0; i < n; i++) out += a.charAt(Math.floor(Math.random() * a.length));
    return out;
  }

  /* The one id this phone is known by on the public road, whether or not it
     is visible right now — a room line carries it too, so ignoring somebody
     on the map also silences them in a PUB. */
  function stableId() {
    if (st) return st.meId;
    var id = RC.store.get("pubsId", null);
    if (!id) { id = rid(10); RC.store.set("pubsId", id); }
    return id;
  }

  /* ---------------- area codes ---------------- */

  /* One code per AREA_DEG cell, six characters, always beginning with "0" —
     a character a random ride code can never start with. The cell index is
     packed in base 36 because that is what fits five characters and stays
     readable when somebody reads it off a screen. */
  function areaCode(lat, lon) {
    var la = Math.floor((RC.clamp(lat, -90, 89.999) + 90) / AREA_DEG);
    var lo = Math.floor((((lon + 180) % 360 + 360) % 360) / AREA_DEG);
    var span = Math.ceil(360 / AREA_DEG);
    var n = la * span + lo;
    var s = n.toString(36).toUpperCase();
    while (s.length < 5) s = "0" + s;
    return "0" + s.slice(-5);
  }

  /* A room code anyone can be given. "1" for the same reason: it cannot be a
     ride, and it cannot be an area. */
  function makeRoomCode() {
    var A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", out = "1";
    for (var i = 0; i < 5; i++) out += A.charAt(Math.floor(Math.random() * A.length));
    return out;
  }

  function isPubCode(code) {
    var c = RC.net.normalizeCode(code);
    return c.length === 6 && (c.charAt(0) === "0" || c.charAt(0) === "1");
  }

  function isRoomCode(code) {
    return RC.net.normalizeCode(code).charAt(0) === "1";
  }

  /* ---------------- events ---------------- */

  function fire(name, detail) {
    var fn = api["on" + name];
    if (typeof fn === "function") { try { fn(detail); } catch (e) {} }
  }

  function changed() { fire("Change", api.snapshot()); }

  function notice(text, kind) { fire("Notice", { text: text, kind: kind || "" }); }

  /* ---------------- the block list ----------------
     Local, permanent, and applied at the point a message ARRIVES. A public
     channel needs a way to make one person stop existing for you, and it must
     not be a UI filter: a filter is something a cleverly-formed message can
     talk its way around, and this is not. */

  var blocked = null;

  function blockList() {
    if (!blocked) blocked = RC.store.get("pubsBlocked", {}) || {};
    return blocked;
  }

  function isBlocked(id) { return !!blockList()[String(id || "")]; }

  /* ---------------- presence: the area hub ---------------- */

  function hubBroadcast(obj) {
    if (!st || !st.net) return;
    if (st.role === "host") st.net.broadcast(obj);
    else st.net.send(obj);
  }

  /* The area as the hub currently understands it. Sent whole rather than as
     deltas: it is at most a few dozen names and coordinates, it is idempotent,
     and a client that missed one is correct again three seconds later without
     anybody having to reason about ordering. */
  function packWorld() {
    var people = [];
    var ids = Object.keys(st.people);
    for (var i = 0; i < ids.length && people.length < HUB_MAX; i++) {
      var p = st.people[ids[i]];
      if (!p.fix || now() - p.fix.at > STALE_MS) continue;
      people.push({
        id: p.id, name: p.name, room: p.room || null, av: p.av || null,
        lat: p.fix.lat, lon: p.fix.lon,
        speedKmh: p.fix.speedKmh, courseDeg: p.fix.courseDeg
      });
    }
    var rooms = [];
    var codes = Object.keys(st.rooms);
    for (var j = 0; j < codes.length && rooms.length < ROOMS_MAX; j++) {
      var r = st.rooms[codes[j]];
      if (now() - r.at > STALE_MS * 2) continue;
      rooms.push({ code: r.code, name: r.name, by: r.by, people: r.people || 1 });
    }
    // Ages rather than timestamps: every phone reads them against its own
    // clock, so a hub whose clock is wrong cannot make a pin immortal.
    var t = now();
    var reports = [];
    Object.keys(st.reports).forEach(function (rid2) {
      var rp = st.reports[rid2];
      if (t > rp.until) { delete st.reports[rid2]; return; }
      reports.push({
        id: rp.id, kind: rp.kind, lat: rp.lat, lon: rp.lon, by: rp.by, byId: rp.byId,
        age: t - rp.at, seen: t - rp.seen, left: rp.until - t, ups: rp.ups, downs: rp.downs
      });
    });
    return { t: MSG.WORLD, people: people, rooms: rooms, reports: reports, at: t };
  }

  function publishWorld() {
    if (!st || st.role !== "host") return;
    var w = packWorld();
    st.net.broadcast(w);
    // The host is in its own area too, and reads it through the same door
    // everyone else does — one code path, so the map cannot be right for
    // guests and wrong for the phone holding the room.
    applyWorld(w, true);
  }

  function applyWorld(w, mine) {
    if (!st) return;
    var seen = {};
    var list = [];
    var arr = w.people || [];
    for (var i = 0; i < arr.length; i++) {
      var raw = arr[i];
      var id = cleanId(raw.id);
      if (!id || id === st.meId) continue;       // your own dot is drawn elsewhere
      if (isBlocked(id)) continue;
      var fix = cleanFix(raw);
      if (!fix) continue;
      var name = cleanName(raw.name) || "Someone";
      seen[id] = true;
      list.push({
        id: id, name: name, fix: fix,
        room: raw.room ? RC.net.normalizeCode(raw.room) : null,
        av: cleanAvatar(raw.av),
        color: colorFor(id)
      });
    }
    st.world = list;
    st.worldAt = now();

    var rooms = [];
    var rr = w.rooms || [];
    for (var j = 0; j < rr.length; j++) {
      var code = RC.net.normalizeCode(rr[j].code);
      if (!isRoomCode(code)) continue;
      rooms.push({
        code: code,
        name: cleanName(rr[j].name) || "A PUB",
        by: cleanName(rr[j].by) || "Someone",
        people: Math.max(1, Math.min(ROOM_MAX, num(rr[j].people) || 1))
      });
    }
    st.roomList = rooms;
    applyReports(w.reports || []);
    if (!mine) st.lastHeardAt = now();
    changed();
  }

  /* A stranger's pin, read as a claim like everything else off the wire. */
  function cleanReport(raw) {
    if (!raw) return null;
    var kind = String(raw.kind || "");
    if (!REPORT_LIFE_MIN[kind]) return null;
    var id = cleanId(raw.id);
    var fix = cleanFix(raw);
    if (!id || !fix) return null;
    var life = REPORT_LIFE_MIN[kind] * 60000;
    var t = now();
    var age = RC.clamp(num(raw.age) || 0, 0, life * 4);
    var seen = RC.clamp(num(raw.seen) || 0, 0, age);
    var left = RC.clamp(num(raw.left) || 0, 0, life);
    return {
      id: id, kind: kind, lat: fix.lat, lon: fix.lon,
      by: cleanName(raw.by) || "Someone",
      byId: cleanId(raw.byId) || null,
      at: t - age, seen: t - seen, until: t + left,
      ups: RC.clamp(Math.round(num(raw.ups) || 0), 0, 99),
      downs: RC.clamp(Math.round(num(raw.downs) || 0), 0, 99)
    };
  }

  function applyReports(arr) {
    var list = [];
    for (var i = 0; i < arr.length && list.length < REPORTS_MAX; i++) {
      var r = cleanReport(arr[i]);
      if (!r) continue;
      if (r.byId && isBlocked(r.byId)) continue;
      r.mine = !!(st && r.byId === st.meId);
      list.push(r);
    }
    st.reportList = list;
    // Announce each pin once, the first time this phone hears of it — a hub
    // handing over re-sends the whole list and that is not news.
    for (var j = 0; j < list.length; j++) {
      if (st.reportSeen[list[j].id]) continue;
      st.reportSeen[list[j].id] = 1;
      if (!list[j].mine) fire("Report", list[j]);
    }
  }

  var COLORS = [
    "#1F7A99", "#B0544B", "#5B7A2E", "#8C4FA8", "#C07A1E",
    "#2E6FD8", "#A83E7B", "#3F8F63", "#7A6A1E", "#4F5D75"
  ];

  /* A stable colour per stranger, from their id, so the same dot is the same
     colour for the whole time it is on your screen — and the same colour on
     everybody's screen, which matters when two riders are talking about it. */
  function colorFor(id) {
    var h = 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return COLORS[h % COLORS.length];
  }

  var CLAIM_QUIET_MS = 10000;   // an id whose link has been silent this long can move

  function touchPerson(connId, m) {
    if (!st || st.role !== "host") return;
    var id = cleanId(m.id) || cleanId(connId);
    if (!id || isBlocked(id)) return;
    var fix = cleanFix(m);
    var p = st.people[id];
    if (!p) {
      if (Object.keys(st.people).length >= HUB_MAX) return;
      p = st.people[id] = { id: id, conn: connId, name: "Someone", fix: null, room: null };
    }
    // An id is held by the link that is using it. A second link claiming it
    // while the first is still talking is somebody trying to wear another
    // rider's marker — and, now that shouts are attributed by link, put words
    // over it. A rider who reloaded gets their id back once the old link has
    // gone quiet, which is a few seconds, not a lockout.
    if (p.conn !== connId && p.heardAt && now() - p.heardAt < CLAIM_QUIET_MS) return;
    p.conn = connId;
    p.heardAt = now();
    p.name = cleanName(m.name) || p.name;
    p.room = m.room ? RC.net.normalizeCode(m.room) : null;
    p.av = cleanAvatar(m.av) || p.av || null;
    if (fix) p.fix = fix;
  }

  function personByConn(connId) {
    var ids = Object.keys(st.people);
    for (var i = 0; i < ids.length; i++) {
      if (st.people[ids[i]].conn === connId) return st.people[ids[i]];
    }
    return null;
  }

  function sendToConn(connId, obj) {
    var list = st.net && st.net.guests ? st.net.guests() : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === connId) { try { list[i].send(obj); } catch (e) {} return true; }
    }
    return false;
  }

  /* ---------------- the area's own talk, hub side ----------------

     Every one of these is attributed from the CONNECTION it arrived on, not
     from anything written inside it: a shout carries the name the hub has on
     file for that link, so nobody can speak from over somebody else's
     marker. The hub rations; it does not read. */

  function hubShout(p, text) {
    var t = now();
    if (p.shoutAt && t - p.shoutAt < SHOUT_MIN_GAP_MS) return null;
    var line = cleanShout(text);
    if (!line) return null;
    p.shoutAt = t;
    var out = { t: MSG.SHOUT, id: p.id, name: p.name, text: line };
    st.net.broadcast(out);
    return out;
  }

  function hubBeep(p, to) {
    var target = st.people[cleanId(to)];
    if (!target || target.id === p.id) return;
    p.beeps = p.beeps || {};
    if (p.beeps[target.id] && now() - p.beeps[target.id] < BEEP_MIN_GAP_MS) return;
    p.beeps[target.id] = now();
    var msg = { t: MSG.BEEP, from: p.id, name: p.name };
    if (target.conn === "self") applyBeep(msg);
    else sendToConn(target.conn, msg);
  }

  function reportLife(kind) { return REPORT_LIFE_MIN[kind] * 60000; }

  function hubReport(p, m) {
    var kind = String(m.kind || "");
    if (!REPORT_LIFE_MIN[kind]) return;
    var fix = cleanFix(m);
    if (!fix || !p.fix) return;
    if (RC.haversine(p.fix, fix) > REPORT_NEAR_M) return;
    var t = now();
    if (p.reportAt && t - p.reportAt < REPORT_MIN_GAP_MS) return;
    p.reportAt = t;

    // The same thing reported twice is one thing seen twice.
    var ids = Object.keys(st.reports);
    for (var i = 0; i < ids.length; i++) {
      var r0 = st.reports[ids[i]];
      if (r0.kind === kind && RC.haversine(r0, fix) < REPORT_SAME_M) {
        hubVote(p, { rid: r0.id, up: true });
        return;
      }
    }
    if (ids.length >= REPORTS_MAX) {
      // Full: the pin closest to expiring makes room.
      ids.sort(function (a, b) { return st.reports[a].until - st.reports[b].until; });
      delete st.reports[ids[0]];
    }
    var id = rid(8);
    var voters = {};
    voters[p.id] = 1;
    st.reports[id] = {
      id: id, kind: kind, lat: blunt(fix.lat), lon: blunt(fix.lon),
      by: p.name, byId: p.id, at: t, seen: t, until: t + reportLife(kind),
      ups: 1, downs: 0, voters: voters
    };
    publishWorld();
  }

  function hubVote(p, m) {
    var r = st.reports[cleanId(m.rid)];
    if (!r) return;
    // The reporter taking their own pin back needs nobody's agreement.
    if (!m.up && r.byId === p.id) { delete st.reports[r.id]; publishWorld(); return; }
    if (r.voters[p.id]) return;          // one say per rider per pin
    r.voters[p.id] = m.up ? 1 : -1;
    if (m.up) {
      r.ups++;
      r.seen = now();
      r.until = Math.max(r.until, now() + reportLife(r.kind));
    } else {
      r.downs++;
      if (r.downs >= Math.max(2, r.ups)) delete st.reports[r.id];
    }
    publishWorld();
  }

  /* ---------------- the area's own talk, arriving ---------------- */

  function applyShout(m, mine) {
    if (!st) return;
    var id = mine ? st.meId : cleanId(m.id);
    if (!id) return;
    if (!mine && (id === st.meId || isBlocked(id))) return;
    var text = cleanShout(m.text);
    if (!text) return;
    var line = {
      id: rid(6), from: id,
      name: mine ? st.myName : (cleanName(m.name) || "Someone"),
      text: text, at: now(), mine: !!mine, color: colorFor(id)
    };
    st.shouts.push(line);
    while (st.shouts.length > SHOUT_KEEP) st.shouts.shift();
    fire("Shout", line);
  }

  function applyBeep(m) {
    if (!st) return;
    var id = cleanId(m.from);
    if (!id || id === st.meId || isBlocked(id)) return;
    var t = now();
    if (st.beepHeard[id] && t - st.beepHeard[id] < BEEP_HEAR_GAP_MS) return;
    st.beepHeard[id] = t;
    fire("Beep", { id: id, name: cleanName(m.name) || "Someone", color: colorFor(id) });
  }

  function dropByConn(connId) {
    if (!st || st.role !== "host") return;
    Object.keys(st.people).forEach(function (id) {
      if (st.people[id].conn === connId) delete st.people[id];
    });
    Object.keys(st.rooms).forEach(function (code) {
      if (st.rooms[code].conn === connId) delete st.rooms[code];
    });
  }

  /* ---------------- hub election ----------------

     Join first, host second. A phone that can find a hub must never make a
     second one, or an area ends up with two halves that cannot see each
     other — so hosting is what happens when joining has demonstrably failed,
     not what happens first. */

  function startHub(code) {
    st.code = code;
    st.role = "seeking";
    changed();
    tryJoinHub(code);
  }

  function tryJoinHub(code) {
    if (!st) return;
    var mine = st.gen;
    var probe = RC.net.join(code, {
      state: function (s) {
        if (!st || st.gen !== mine) return;
        st.link = s;
        changed();
      },
      open: function () {
        if (!st || st.gen !== mine) return;
        clearTimeout(st.probeTimer);
        st.probeTimer = null;
        st.role = "guest";
        st.lastHeardAt = now();
        sendHi(true);
        changed();
      },
      message: function (m) {
        if (!st || st.gen !== mine || !m) return;
        if (m.t === MSG.WORLD) applyWorld(m, false);
        else if (m.t === MSG.SHOUT) applyShout(m, false);
        else if (m.t === MSG.BEEP) applyBeep(m);
      },
      closed: function () {
        // The join keeps retrying on its own; what matters here is that the
        // area map stops claiming to be current.
        if (!st || st.gen !== mine) return;
        changed();
      }
    });
    st.net = probe;

    // Nothing answered. Either this area is empty or its hub has gone; either
    // way somebody has to hold it, and we are here.
    clearTimeout(st.probeTimer);
    st.probeTimer = setTimeout(function () {
      if (!st || st.gen !== mine || st.role === "guest") return;
      st.probeTimer = null;
      try { probe.stop(); } catch (e) {}
      becomeHub(code);
    }, HUB_PROBE_MS);
  }

  function becomeHub(code) {
    if (!st) return;
    var mine = st.gen;
    st.role = "host";
    st.people = {};
    st.rooms = {};
    // The last hub's pins, as this phone last heard them, so a handover does
    // not wipe the road clean of the crash everybody is still riding past.
    st.reports = {};
    for (var i = 0; i < st.reportList.length; i++) {
      var r = st.reportList[i];
      if (now() > r.until) continue;
      st.reports[r.id] = {
        id: r.id, kind: r.kind, lat: r.lat, lon: r.lon, by: r.by, byId: r.byId,
        at: r.at, seen: r.seen, until: r.until, ups: r.ups, downs: r.downs, voters: {}
      };
    }
    st.net = RC.net.host(code, {
      on: {
        "code-taken": function () {
          // Somebody else got there first, or came back. Stand down and join
          // them rather than splitting the area in two.
          if (!st || st.gen !== mine) return;
          try { st.net.stop(); } catch (e) {}
          st.role = "seeking";
          changed();
          tryJoinHub(code);
        },
        "guest-open": function () { if (st && st.gen === mine) changed(); },
        "guest-message": function (link, m) {
          if (!st || st.gen !== mine || !m) return;
          onHubMessage(link, m);
        },
        "guest-close": function (link) {
          if (!st || st.gen !== mine) return;
          dropByConn(link.id);
          changed();
        }
      }
    });
    changed();
  }

  function onHubMessage(link, m) {
    if (m.t === MSG.HI) {
      touchPerson(link.id, m);
      // A newcomer should not wait up to WORLD_MS to see anybody.
      if (m.first) { try { link.send(packWorld()); } catch (e) {} }
      return;
    }
    // Everything below needs to know who is talking, and only a rider who has
    // said HI is somebody.
    var who = personByConn(link.id);
    if (m.t === MSG.SHOUT) {
      if (!who) return;
      var out = hubShout(who, m.text);
      if (out) applyShout(out, false);
      return;
    }
    if (m.t === MSG.BEEP) { if (who) hubBeep(who, m.to); return; }
    if (m.t === MSG.REPORT) { if (who) hubReport(who, m); return; }
    if (m.t === MSG.VOTE) { if (who) hubVote(who, m); return; }
    if (m.t === MSG.ROOM_OPEN) {
      var code = RC.net.normalizeCode(m.code);
      if (!isRoomCode(code)) return;
      if (!st.rooms[code] && Object.keys(st.rooms).length >= ROOMS_MAX) return;
      st.rooms[code] = {
        code: code,
        name: cleanName(m.name) || "A PUB",
        by: cleanName(m.by) || "Someone",
        people: Math.max(1, Math.min(ROOM_MAX, num(m.people) || 1)),
        conn: link.id,
        at: now()
      };
      changed();
      return;
    }
    if (m.t === MSG.ROOM_SHUT) {
      var shut = RC.net.normalizeCode(m.code);
      if (st.rooms[shut] && st.rooms[shut].conn === link.id) {
        delete st.rooms[shut];
        changed();
      }
    }
  }

  /* ---------------- my own position ---------------- */

  function sendHi(first) {
    if (!st) return;
    var fix = st.myFix;
    var msg = {
      t: MSG.HI,
      id: st.meId,
      name: st.myName,
      av: st.av,
      room: room ? room.code : null,
      first: !!first
    };
    if (fix) {
      msg.lat = blunt(fix.lat);
      msg.lon = blunt(fix.lon);
      msg.speedKmh = fix.speedKmh == null ? null : Math.round(fix.speedKmh);
      msg.courseDeg = fix.courseDeg == null ? null : Math.round(fix.courseDeg);
    }
    if (st.role === "host") {
      // The hub is a person in its own area. It writes itself into the same
      // table it writes everyone else into, rather than being a special case
      // that gets forgotten every time the table is rebuilt.
      touchPerson("self", msg);
    } else {
      st.net.send(msg);
    }
    st.lastSentAt = now();
    st.lastSentFix = fix ? { lat: fix.lat, lon: fix.lon } : null;
  }

  function maybeSend() {
    if (!st || !st.myFix) return;
    var due = now() - st.lastSentAt >= POS_MS;
    if (!due && st.lastSentFix) {
      var moved = RC.haversine(st.lastSentFix, st.myFix);
      if (moved < POS_MOVE_M) return;
    } else if (!due) { return; }
    sendHi(false);
  }

  function startWatch() {
    if (!st || st.watchId != null || !navigator.geolocation) return;
    st.watchId = navigator.geolocation.watchPosition(function (pos) {
      if (!st) return;
      var c = pos.coords || {};
      var fix = cleanFix({
        lat: c.latitude, lon: c.longitude,
        speedKmh: c.speed == null ? null : c.speed * 3.6,
        courseDeg: c.heading == null ? null : c.heading
      });
      if (!fix) return;
      st.myFix = fix;
      // Riding out of one cell and into the next means a different area, and
      // a different hub. Cheap to check, and the only thing that makes PUBs
      // work on a long ride rather than on a city block.
      var code = areaCode(fix.lat, fix.lon);
      if (code !== st.code) {
        notice("You have ridden into a new area.", "");
        reseat(code);
        return;
      }
      maybeSend();
      changed();
    }, function (err) {
      if (err && err.code === 1) {
        notice("Location is blocked, so PUBs cannot show you the area.", "warn");
        api.stop();
      }
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }

  function stopWatch() {
    if (st && st.watchId != null && navigator.geolocation) {
      try { navigator.geolocation.clearWatch(st.watchId); } catch (e) {}
    }
    if (st) st.watchId = null;
  }

  /* Move to another area's hub without losing the room you are chatting in:
     the room is a separate connection on a separate code and has nothing to
     do with where you are. */
  function reseat(code) {
    if (!st) return;
    st.gen++;
    clearTimeout(st.probeTimer);
    st.probeTimer = null;
    if (st.net) { try { st.net.stop(); } catch (e) {} st.net = null; }
    // Same area, a hub that went quiet: the pins are still true, and this
    // phone may be the one that carries them to the next hub. A new area's
    // pins are somebody else's road.
    if (code !== st.code) { st.reportList = []; st.shouts = []; }
    st.people = {};
    st.rooms = {};
    st.world = [];
    st.roomList = [];
    startHub(code);
  }

  function tick() {
    if (!st) return;
    if (st.role === "host") {
      // Prune before publishing, so a hub never advertises a rider who has
      // been in a tunnel for a minute as if they were still moving.
      Object.keys(st.people).forEach(function (id) {
        var p = st.people[id];
        if (!p.fix || now() - p.fix.at > STALE_MS) delete st.people[id];
      });
      sendHi(false);
      publishWorld();
    } else if (st.role === "guest") {
      maybeSend();
      // A hub that stopped talking is a hub that has gone. Rather than sitting
      // on a frozen map, go and find out — the join is still retrying, and if
      // there is genuinely nothing there the probe will make us the hub.
      if (st.lastHeardAt && now() - st.lastHeardAt > STALE_MS) {
        st.lastHeardAt = now();
        reseat(st.code);
      }
    }
  }

  /* ---------------- PUB rooms ----------------

     A room is a chat room and only a chat room. It carries no positions, no
     voice and no planned route, which is not an omission: a public room is a
     place to ask whether the pass is open, and handing a stranger a live
     track of where you are is a different decision that has its own switch
     three centimetres away. */

  function roomFire() { fire("Room", api.roomSnapshot()); }

  function roomLine(kind, name, text) {
    return { kind: kind, name: name, text: text, at: now(), id: rid(6) };
  }

  function pushLine(line) {
    if (!room) return;
    room.log.push(line);
    while (room.log.length > CHAT_KEEP) room.log.shift();
    roomFire();
  }

  function roomBroadcast(obj) {
    if (!room || !room.net) return;
    if (room.role === "host") room.net.broadcast(obj);
    else room.net.send(obj);
  }

  function packRoster() {
    var people = [room.myName];
    Object.keys(room.people).forEach(function (k) { people.push(room.people[k].name); });
    return { t: MSG.ROSTER, people: people.slice(0, ROOM_MAX) };
  }

  function onRoomMessage(link, m) {
    if (!room || !m) return;

    if (m.t === MSG.HELLO) {
      if (room.role !== "host") return;
      if (Object.keys(room.people).length >= ROOM_MAX) {
        try { link.send({ t: MSG.SAY, kind: "system", text: "This PUB is full." }); } catch (e) {}
        return;
      }
      room.people[link.id] = { id: cleanId(m.id) || link.id, name: cleanName(m.name) || "Someone", at: now() };
      // What was said before they arrived, so a room is a conversation rather
      // than an empty screen with an unexplained roster.
      try { link.send({ t: MSG.LOG, lines: room.log.slice(-30) }); } catch (e) {}
      var join = roomLine("system", "", (room.people[link.id].name) + " came in.");
      pushLine(join);
      room.net.broadcast({ t: MSG.SAY, line: join });
      room.net.broadcast(packRoster());
      announceRoom();
      return;
    }

    if (m.t === MSG.SAY) {
      if (room.role === "host") {
        var who = room.people[link.id];
        if (!who) return;                       // has not said who they are yet
        if (isBlocked(who.id)) return;
        var t = now();
        if (who.lastAt && t - who.lastAt < CHAT_MIN_GAP_MS) return;
        who.lastAt = t;
        var text = cleanText(m.text);
        if (!text) return;
        var line = roomLine("said", who.name, text);
        line.from = who.id;
        pushLine(line);
        room.net.broadcast({ t: MSG.SAY, line: line });
      } else {
        var l = m.line || m;
        if (l.from && isBlocked(l.from)) return;
        var text2 = cleanText(l.text);
        if (!text2) return;
        pushLine({
          kind: l.kind === "system" ? "system" : "said",
          name: cleanName(l.name), text: text2,
          from: l.from ? String(l.from) : null,
          at: now(), id: rid(6)
        });
      }
      return;
    }

    if (m.t === MSG.LOG && room.role === "guest") {
      var lines = m.lines || [];
      room.log = [];
      for (var i = 0; i < lines.length; i++) {
        var raw = lines[i];
        var txt = cleanText(raw.text);
        if (!txt) continue;
        if (raw.from && isBlocked(raw.from)) continue;
        room.log.push({
          kind: raw.kind === "system" ? "system" : "said",
          name: cleanName(raw.name), text: txt,
          from: raw.from ? String(raw.from) : null,
          at: now(), id: rid(6)
        });
      }
      roomFire();
      return;
    }

    if (m.t === MSG.ROSTER && room.role === "guest") {
      var names = [];
      var arr = m.people || [];
      for (var j = 0; j < arr.length && j < ROOM_MAX; j++) {
        var n = cleanName(arr[j]);
        if (n) names.push(n);
      }
      room.roster = names;
      roomFire();
    }
  }

  /* Tell the area a room exists. Only the host does this: a room is
     advertised by the phone that is holding it, so an advert cannot outlive
     the thing it advertises by more than one prune. */
  function announceRoom() {
    if (!st || !room || room.role !== "host") return;
    hubBroadcast({
      t: MSG.ROOM_OPEN,
      code: room.code,
      name: room.name,
      by: room.myName,
      people: Object.keys(room.people).length + 1
    });
  }

  function roomTick() {
    if (!room) return;
    if (room.role === "host") announceRoom();
  }

  /* ---------------- the clock ---------------- */

  var timer = null;

  function startTimer() {
    if (timer) return;
    timer = setInterval(function () { tick(); roomTick(); }, WORLD_MS);
  }

  function stopTimer() {
    if (!timer) return;
    if (st || room) return;      // somebody still needs it
    clearInterval(timer);
    timer = null;
  }

  /* ---------------- public ---------------- */

  var api = {
    AREA_DEG: AREA_DEG,
    areaCode: areaCode,
    isPubCode: isPubCode,
    isRoomCode: isRoomCode,

    /** Go visible. Needs a name and a position — a nameless dot on a public
        map is worse than no dot, because there is no way to talk about it. */
    start: function (name) {
      if (st) return Promise.resolve(true);
      var myName = cleanName(name);
      if (!myName) return Promise.reject(new Error("Pick a name the area can call you."));
      if (!navigator.geolocation) {
        return Promise.reject(new Error("This browser will not share a location."));
      }

      return new Promise(function (resolve, reject) {
        navigator.geolocation.getCurrentPosition(function (pos) {
          var c = pos.coords || {};
          var fix = cleanFix({ lat: c.latitude, lon: c.longitude });
          if (!fix) { reject(new Error("Could not work out where you are.")); return; }

          st = {
            gen: 1,
            meId: RC.store.get("pubsId", null) || rid(10),
            myName: myName,
            code: areaCode(fix.lat, fix.lon),
            role: "seeking",
            net: null,
            link: "connecting",
            people: {},
            rooms: {},
            world: [],
            roomList: [],
            myFix: fix,
            av: cleanAvatar(RC.store.get("pubsAv", null)) || null,
            shouts: [],
            reports: {},
            reportList: [],
            reportSeen: {},
            myVotes: {},
            beepHeard: {},
            beepSent: {},
            lastShoutAt: 0,
            lastReportAt: 0,
            lastSentAt: 0,
            lastSentFix: null,
            lastHeardAt: 0,
            worldAt: 0,
            watchId: null,
            probeTimer: null
          };
          // A stable id across sessions, so a rider who reloads keeps their
          // colour and their block-list identity instead of reappearing as a
          // brand new stranger.
          RC.store.set("pubsId", st.meId);
          RC.store.set("pubsName", myName);

          startHub(st.code);
          startWatch();
          startTimer();
          // A room already open keeps running; it now gets advertised.
          announceRoom();
          if (RC.background) RC.background.hold("pubs");
          changed();
          resolve(true);
        }, function () {
          reject(new Error("Location permission was refused."));
        }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
      });
    },

    /** Go dark. Everything about you stops leaving the phone immediately; the
        area finds out you are gone when your last fix goes stale, which is the
        same way it finds out about a tunnel. */
    stop: function () {
      if (!st) return false;
      var was = st;
      st = null;
      clearTimeout(was.probeTimer);
      if (was.watchId != null && navigator.geolocation) {
        try { navigator.geolocation.clearWatch(was.watchId); } catch (e) {}
      }
      if (was.net) { try { was.net.stop(); } catch (e) {} }
      if (RC.background) RC.background.release("pubs");
      stopTimer();
      changed();
      return true;
    },

    isOn: function () { return !!st; },
    myName: function () { return st ? st.myName : RC.store.get("pubsName", ""); },
    myId: function () { return st ? st.meId : null; },
    /** Where PUBs last had you, at full precision — for this phone's own
        drawing and alerts. What leaves the phone is blunted in sendHi. */
    myFix: function () {
      if (!st || !st.myFix) return null;
      var f = st.myFix;
      return { lat: f.lat, lon: f.lon, speedKmh: f.speedKmh, courseDeg: f.courseDeg };
    },
    code: function () { return st ? st.code : null; },
    role: function () { return st ? st.role : null; },

    /** Everyone visible in this area right now, already cleaned and coloured. */
    world: function () { return st ? st.world.slice() : []; },

    /** The PUB rooms this area is advertising. */
    rooms: function () { return st ? st.roomList.slice() : []; },

    snapshot: function () {
      return {
        on: !!st,
        code: st ? st.code : null,
        role: st ? st.role : null,
        link: st ? st.link : null,
        name: st ? st.myName : null,
        people: st ? st.world.length : 0,
        rooms: st ? st.roomList.length : 0,
        reports: st ? st.reportList.length : 0,
        fresh: st ? (st.worldAt && now() - st.worldAt < STALE_MS) : false
      };
    },

    /* ---- rooms ---- */

    /** Open a room. The code is generated, published to the area and printed
        for the rider — a PUB is meant to be walked into, so it is findable
        three ways: from the area's list, from the code, and from a link. */
    openRoom: function (name, myName) {
      if (room) return Promise.reject(new Error("You are already in a PUB."));
      var who = cleanName(myName) || api.myName();
      if (!who) return Promise.reject(new Error("Pick a name first."));
      var code = makeRoomCode();
      room = {
        code: code,
        name: cleanName(name) || "A PUB",
        role: "host",
        myName: who,
        net: null,
        log: [],
        people: {},
        roster: [who],
        lastSaidAt: 0
      };
      // Named, because one of these handlers re-registers the whole set when
      // it has to take a different code, and an object literal cannot refer
      // to itself.
      var handlers = {
        "code-taken": function () {
          // Vanishingly unlikely, and survivable: take another code and
          // re-advertise rather than making the rider start again.
          if (!room) return;
          try { room.net.stop(); } catch (e) {}
          room.code = makeRoomCode();
          room.net = RC.net.host(room.code, { on: handlers });
          announceRoom();
          roomFire();
        },
        "guest-message": function (link, m) { onRoomMessage(link, m); },
        "guest-close": function (link) {
          if (!room || !room.people[link.id]) return;
          var gone = room.people[link.id].name;
          delete room.people[link.id];
          var line = roomLine("system", "", gone + " left.");
          pushLine(line);
          room.net.broadcast({ t: MSG.SAY, line: line });
          room.net.broadcast(packRoster());
          announceRoom();
        }
      };
      room.net = RC.net.host(code, { on: handlers });
      pushLine(roomLine("system", "", "You opened " + room.name + ". Anyone nearby can walk in."));
      announceRoom();
      startTimer();
      roomFire();
      return Promise.resolve(room.code);
    },

    /** Walk into one. No approval, by design — that is what makes it a PUB
        rather than a ride. */
    enterRoom: function (code, myName) {
      code = RC.net.normalizeCode(code);
      if (!isRoomCode(code)) return Promise.reject(new Error("That is not a PUB code."));
      if (room && room.code === code) return Promise.resolve(code);
      if (room) api.leaveRoom();
      var who = cleanName(myName) || api.myName();
      if (!who) return Promise.reject(new Error("Pick a name first."));

      var listed = null;
      if (st) {
        for (var i = 0; i < st.roomList.length; i++) {
          if (st.roomList[i].code === code) listed = st.roomList[i];
        }
      }

      room = {
        code: code,
        name: listed ? listed.name : "A PUB",
        role: "guest",
        myName: who,
        net: null,
        log: [],
        people: {},
        roster: [],
        lastSaidAt: 0
      };
      room.net = RC.net.join(code, {
        state: function (s) { if (room) { room.link = s; roomFire(); } },
        open: function () {
          if (!room) return;
          room.net.send({ t: MSG.HELLO, name: room.myName, id: stableId() });
          roomFire();
        },
        message: function (m) { onRoomMessage(null, m); },
        closed: function () { if (room) roomFire(); }
      });
      startTimer();
      roomFire();
      return Promise.resolve(code);
    },

    leaveRoom: function () {
      if (!room) return false;
      var was = room;
      room = null;
      if (was.role === "host" && st) {
        hubBroadcast({ t: MSG.ROOM_SHUT, code: was.code });
      }
      if (was.net) { try { was.net.stop(); } catch (e) {} }
      stopTimer();
      roomFire();
      return true;
    },

    say: function (text) {
      if (!room) return false;
      var t = cleanText(text);
      if (!t) return false;
      var at = now();
      if (room.lastSaidAt && at - room.lastSaidAt < CHAT_MIN_GAP_MS) return false;
      room.lastSaidAt = at;

      if (room.role === "host") {
        var line = roomLine("said", room.myName, t);
        line.from = stableId();
        line.mine = true;
        pushLine(line);
        room.net.broadcast({ t: MSG.SAY, line: line });
      } else {
        room.net.send({ t: MSG.SAY, text: t });
        // Shown locally straight away rather than waiting for the host to
        // echo it back: a public room over a public broker is a round trip,
        // and a chat box that pauses before showing your own words reads as
        // broken even when it is not.
        var mine = roomLine("said", room.myName, t);
        mine.mine = true;
        pushLine(mine);
      }
      return true;
    },

    inRoom: function () { return !!room; },
    roomCode: function () { return room ? room.code : null; },
    roomLog: function () { return room ? room.log.slice() : []; },

    roomSnapshot: function () {
      if (!room) return { in: false };
      return {
        "in": true,
        code: room.code,
        name: room.name,
        role: room.role,
        link: room.role === "host" ? "connected" : (room.link || "connecting"),
        people: room.role === "host"
          ? Object.keys(room.people).length + 1
          : (room.roster.length || 1),
        roster: room.role === "host"
          ? [room.myName].concat(Object.keys(room.people).map(function (k) { return room.people[k].name; }))
          : room.roster.slice()
      };
    },

    /* ---- the area's own talk ---- */

    AVATARS: AVATARS.slice(),
    REPORT_KINDS: Object.keys(REPORT_LIFE_MIN),
    SHOUT_MAX: SHOUT_MAX,

    avatar: function () {
      return st ? st.av : cleanAvatar(RC.store.get("pubsAv", null));
    },

    /** Pick how you look on other people's maps. Takes effect with the next
        presence packet, which is at most a few seconds away. */
    setAvatar: function (av) {
      var v = cleanAvatar(av);
      RC.store.set("pubsAv", v);
      if (st) { st.av = v; if (st.role === "host" || st.role === "guest") sendHi(false); }
      changed();
      return v;
    },

    /** Say one short line to the whole area, over your own head. False when it
        was refused — nothing to say, not connected yet, or too soon. */
    shout: function (text) {
      if (!st || (st.role !== "host" && st.role !== "guest")) return false;
      var t = cleanShout(text);
      if (!t) return false;
      var at = now();
      if (st.lastShoutAt && at - st.lastShoutAt < SHOUT_MIN_GAP_MS) return false;
      st.lastShoutAt = at;
      if (st.role === "host") {
        var me = st.people[st.meId];
        if (me) hubShout(me, t);
      } else {
        st.net.send({ t: MSG.SHOUT, text: t });
      }
      // Shown straight away; the hub's echo of our own line is dropped.
      applyShout({ text: t }, true);
      return true;
    },

    shouts: function () { return st ? st.shouts.slice() : []; },

    /** A horn for one rider. Rationed at both ends. */
    beep: function (id) {
      if (!st || (st.role !== "host" && st.role !== "guest")) return false;
      id = cleanId(id);
      if (!id || id === st.meId) return false;
      var at = now();
      if (st.beepSent[id] && at - st.beepSent[id] < BEEP_MIN_GAP_MS) return false;
      st.beepSent[id] = at;
      if (st.role === "host") {
        var me = st.people[st.meId];
        if (me) hubBeep(me, id);
      } else {
        st.net.send({ t: MSG.BEEP, to: id });
      }
      return true;
    },

    /** Pin something on the road, where you are now. */
    report: function (kind) {
      if (!st || !REPORT_LIFE_MIN[kind] || !st.myFix) return false;
      if (st.role !== "host" && st.role !== "guest") return false;
      var at = now();
      if (st.lastReportAt && at - st.lastReportAt < REPORT_MIN_GAP_MS) return false;
      st.lastReportAt = at;
      var msg = { t: MSG.REPORT, kind: kind, lat: blunt(st.myFix.lat), lon: blunt(st.myFix.lon) };
      if (st.role === "host") {
        var me = st.people[st.meId];
        if (me) hubReport(me, msg);
      } else {
        st.net.send(msg);
      }
      return true;
    },

    /** Still there (true) or not there (false). One say per pin; the
        reporter's "not there" takes their own pin down. */
    vote: function (reportId, up) {
      if (!st || (st.role !== "host" && st.role !== "guest")) return false;
      reportId = cleanId(reportId);
      if (!reportId || st.myVotes[reportId]) return false;
      st.myVotes[reportId] = up ? "up" : "down";
      var msg = { t: MSG.VOTE, rid: reportId, up: !!up };
      if (st.role === "host") {
        var me = st.people[st.meId];
        if (me) hubVote(me, msg);
      } else {
        st.net.send(msg);
      }
      changed();
      return true;
    },

    myVote: function (reportId) { return st ? (st.myVotes[cleanId(reportId)] || null) : null; },

    /** The pins this area is carrying, cleaned, newest first. */
    reports: function () {
      if (!st) return [];
      return st.reportList.slice().sort(function (a, b) { return b.at - a.at; });
    },

    /** How long a kind of pin lives, in minutes — for the sheet's one line. */
    reportLife: function (kind) { return REPORT_LIFE_MIN[kind] || 0; },

    /* ---- the block list ---- */

    block: function (id) {
      id = String(id || "");
      if (!id) return false;
      var list = blockList();
      list[id] = 1;
      RC.store.set("pubsBlocked", list);
      if (st) {
        st.world = st.world.filter(function (p) { return p.id !== id; });
        st.shouts = st.shouts.filter(function (l) { return l.from !== id; });
        st.reportList = st.reportList.filter(function (r) { return r.byId !== id; });
        if (st.role === "host") delete st.people[id];
      }
      if (room) room.log = room.log.filter(function (l) { return l.from !== id; });
      changed();
      return true;
    },

    unblockAll: function () {
      blocked = {};
      RC.store.set("pubsBlocked", {});
      changed();
      return true;
    },

    blockedCount: function () { return Object.keys(blockList()).length; },

    /* Exposed for the harness: the pure parts, with no browser in them. */
    _clean: { name: cleanName, text: cleanText, fix: cleanFix, blunt: blunt,
              shout: cleanShout, id: cleanId, avatar: cleanAvatar, report: cleanReport },
    _areaCode: areaCode,
    // The hub's own doors, for the harness to knock on as somebody else.
    _tick: function () { tick(); },
    _hiAs: function (connId, m) { touchPerson(connId, m); },
    _hubReportAs: function (id, m) {
      if (st && st.role === "host" && st.people[id]) hubReport(st.people[id], m);
    },

    onChange: null,
    onRoom: null,
    onNotice: null,
    onShout: null,
    onBeep: null,
    onReport: null
  };

  return api;
})();

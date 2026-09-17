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
    HELLO: "hello"         // -> room host: my name
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
        id: p.id, name: p.name, room: p.room || null,
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
    return { t: MSG.WORLD, people: people, rooms: rooms, at: now() };
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
      var id = String(raw.id || "");
      if (!id || id === st.meId) continue;       // your own dot is drawn elsewhere
      if (isBlocked(id)) continue;
      var fix = cleanFix(raw);
      if (!fix) continue;
      var name = cleanName(raw.name) || "Someone";
      seen[id] = true;
      list.push({
        id: id, name: name, fix: fix,
        room: raw.room ? RC.net.normalizeCode(raw.room) : null,
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
    if (!mine) st.lastHeardAt = now();
    changed();
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

  function touchPerson(connId, m) {
    if (!st || st.role !== "host") return;
    var id = String(m.id || connId);
    if (isBlocked(id)) return;
    var fix = cleanFix(m);
    var p = st.people[id];
    if (!p) {
      if (Object.keys(st.people).length >= HUB_MAX) return;
      p = st.people[id] = { id: id, conn: connId, name: "Someone", fix: null, room: null };
    }
    p.conn = connId;
    p.name = cleanName(m.name) || p.name;
    p.room = m.room ? RC.net.normalizeCode(m.room) : null;
    if (fix) p.fix = fix;
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
      room.people[link.id] = { id: link.id, name: cleanName(m.name) || "Someone", at: now() };
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
          room.net.send({ t: MSG.HELLO, name: room.myName });
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
        line.from = st ? st.meId : "host";
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

    /* ---- the block list ---- */

    block: function (id) {
      id = String(id || "");
      if (!id) return false;
      var list = blockList();
      list[id] = 1;
      RC.store.set("pubsBlocked", list);
      if (st) {
        st.world = st.world.filter(function (p) { return p.id !== id; });
        if (st.role === "host") delete st.people[id];
      }
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
    _clean: { name: cleanName, text: cleanText, fix: cleanFix, blunt: blunt },
    _areaCode: areaCode,

    onChange: null,
    onRoom: null,
    onNotice: null
  };

  return api;
})();

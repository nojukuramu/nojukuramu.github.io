/* ============================================================
   RouteCast — group ride

   A room of riders on one map. No backend: RC.net (static/js/peer.js) borrows
   a public PeerJS broker to introduce browsers to each other and then gets out
   of the way, so everything below travels directly between phones.

   The shape is a star, not a mesh
   -------------------------------
   The host holds the room. Guests talk to the host and the host relays to
   everyone. That costs the host one connection per rider and gives the room a
   single source of truth — which is the only reason the planned route can be
   "the same line on every phone" instead of "whatever each phone last
   computed". A mesh would halve the host's uplink and destroy that.

   What crosses the wire
   ---------------------
   POS      a rider's fix, every couple of seconds, batched by the host
   PLAN     the planned route: simplified, rounded to ~1 m, sent in chunks
   CHAT     text, capped and rate limited
   VOICE    a push-to-talk clip, Opus in a container, chunked like the plan
   STATE    the room itself: who is in it, who is waiting, what the settings are

   The door
   --------
   A room code is six characters against a PUBLIC broker. Somebody will
   eventually guess one. So a guest that has not been approved can do exactly
   two things — say who they are, and ask for a snapshot — and every other
   message is refused where it arrives, not filtered out of a UI they are not
   obliged to be running. Approval defaults to ON, and a name is required,
   because "who is that dot" is a safety question when you are driving.

   Cost
   ----
   Nothing polls a server. One geolocation watch feeds presence (the same fix
   nav.js is already getting, when it is running), positions go out on a timer
   OR on real movement, and voice costs nothing at all until a thumb is on the
   button.
   ============================================================ */
var RC = RC || {};

RC.group = (function () {
  "use strict";

  var MSG = {
    HELLO: "hello",          // guest -> host: this is my name
    WELCOME: "welcome",      // host -> guest: you are in, here is who you are
    WAIT: "wait",            // host -> guest: the host has not let you in yet
    STATE: "state",          // host -> guest: the room
    POS: "pos",              // guest -> host: my fix
    POSB: "posb",            // host -> guests: everyone's fixes, batched
    CHAT: "chat",
    VOICE: "voice",
    PLAN_META: "plan-meta",
    PLAN_CHUNK: "plan-chunk",
    PLAN_CLEAR: "plan-clear",
    NOTICE: "notice",
    BYE: "bye",
    RESYNC: "resync",
    APPROVE: "approve",      // guest(co-nothing) -> host is refused; host uses it locally
    NUDGE: "nudge"           // "where are you?" ping, host relays
  };

  var NAME_MAX = 22;
  var CHAT_MAX = 280;
  var CHAT_KEEP = 120;            // messages the host remembers for newcomers
  var CHAT_MIN_GAP_MS = 600;      // one rider cannot flood the room
  var MEMBER_MAX = 12;            // a host's uplink, not a licence limit
  var POS_MS = 2500;              // presence cadence
  var POS_MOVE_M = 30;            // ...or sooner, if the rider actually moved
  var STALE_MS = 25000;           // a fix older than this is "no signal"
  var PLAN_CHUNK_POINTS = 250;
  var PLAN_MAX_POINTS = 1800;
  var PLAN_SIMPLIFY_M = 10;
  var VOICE_CHUNK_B = 12000;      // base64 chars per data-channel message
  var VOICE_MAX_B = 400000;       // a clip bigger than this is dropped
  var VOICE_MAX_MS = 20000;       // a stuck thumb is not a 10-minute broadcast
  var HANDS_FREE_MS = 4000;       // segment length when the mic is left open

  /* A rider is a colour on a map before they are a name in a list. These are
     picked to stay apart from the route palette (matcha green, the four risk
     colours) and from each other in both themes. */
  var COLORS = [
    "#2E6FD8", "#C0399B", "#D97706", "#0E9AA7", "#7C4DD1",
    "#B03434", "#3F8F63", "#7A6A1E", "#D45087", "#1F7A99",
    "#8C5A2B", "#4F5D75"
  ];

  var st = null;   // the whole room, or null when we are not in one

  /* ---------------- small helpers ---------------- */

  function now() { return Date.now(); }

  /* A control character becomes a space rather than vanishing: "A\nB" is two
     words somebody typed, and silently gluing them into "AB" puts a name on a
     map that nobody in the room recognises. */
  function cleanName(s) {
    s = String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
    return s.slice(0, NAME_MAX);
  }

  function cleanText(s) {
    s = String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
    return s.slice(0, CHAT_MAX);
  }

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  /** A fix off the wire is a stranger's claim, not data. Anything that is not
      a plausible coordinate is dropped rather than drawn at (0, 0). */
  function cleanFix(p) {
    if (!p) return null;
    var lat = num(p.lat), lon = num(p.lon);
    if (lat == null || lon == null) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    var speed = num(p.speedKmh);
    var course = num(p.courseDeg);
    return {
      lat: lat, lon: lon,
      speedKmh: speed == null ? null : Math.max(0, Math.min(400, speed)),
      courseDeg: course == null ? null : ((course % 360) + 360) % 360,
      accuracy: num(p.accuracy),
      at: now()   // always ours: a clock we do not own cannot age a marker
    };
  }

  function rid(n) {
    var a = "abcdefghijklmnopqrstuvwxyz0123456789", out = "";
    var buf = new Uint8Array(n);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buf);
    else for (var i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256);
    for (var j = 0; j < n; j++) out += a[buf[j] % a.length];
    return out;
  }

  function fire(name, a, b) {
    var fn = api["on" + name];
    if (typeof fn === "function") {
      try { fn(a, b); } catch (e) { console.error("[rc] group " + name, e); }
    }
  }

  function changed() { fire("Change"); }

  function notice(text, kind) { fire("Notice", text, kind || ""); }

  /* ---------------- the roster ---------------- */

  function colorFor(index) { return COLORS[index % COLORS.length]; }

  function member(id, name) {
    return {
      id: id,
      name: name,
      color: colorFor(st.colorSeq++),
      fix: null,
      joinedAt: now(),
      approved: false,
      online: true,
      host: false
    };
  }

  function rosterOut() {
    // What guests are told about each other. `fix` goes out on its own channel
    // at its own cadence, so it is deliberately not in here.
    return st.order.map(function (id) {
      var m = st.members[id];
      return { id: m.id, name: m.name, color: m.color, host: m.host,
               approved: m.approved, online: m.online, joinedAt: m.joinedAt };
    });
  }

  function pendingOut() {
    return st.order.filter(function (id) { return !st.members[id].approved; })
      .map(function (id) { return { id: id, name: st.members[id].name }; });
  }

  function snapshot() {
    return {
      rev: ++st.rev,
      code: st.code,
      hostName: st.hostName,
      settings: { approval: !!st.settings.approval, chat: st.settings.chat !== false,
                  voice: st.settings.voice !== false },
      members: rosterOut(),
      pending: pendingOut(),
      chat: st.chat.slice(-40),
      hasPlan: !!st.planned
    };
  }

  function broadcast(obj, exceptId) {
    if (!st || !st.net || st.role !== "host") return;
    st.net.guests().forEach(function (link) {
      if (exceptId && link.id === exceptId) return;
      if (!st.members[link.id] || !st.members[link.id].approved) return;
      link.send(obj);
    });
  }

  function linkFor(id) {
    if (!st || !st.net || st.role !== "host") return null;
    var found = null;
    st.net.guests().forEach(function (l) { if (l.id === id) found = l; });
    return found;
  }

  function pushState() {
    if (!st || st.role !== "host") return;
    var snap = snapshot();
    st.snap = snap;
    broadcast({ type: MSG.STATE, state: snap });
    changed();
  }

  /* ---------------- the planned route ---------------- */

  /** Prepare a route for the wire: simplified, rounded, and small enough that
      a phone on a bad connection still gets all of it. */
  function packPlan(plan) {
    var coords = plan.coords || [];
    var tol = PLAN_SIMPLIFY_M;
    var line = RC.rejoin.simplify(coords, tol);
    // A very long ride can still be too many points after one pass; loosen the
    // tolerance rather than truncating, because a truncated route is a lie
    // about where the ride ends.
    while (line.length > PLAN_MAX_POINTS && tol < 160) {
      tol *= 2;
      line = RC.rejoin.simplify(coords, tol);
    }
    return {
      id: plan.id || rid(8),
      coords: RC.rejoin.compact(line),
      stops: (plan.stops || []).map(function (s) {
        return { lat: Math.round(s.lat * 1e5) / 1e5, lon: Math.round(s.lon * 1e5) / 1e5,
                 name: cleanName(s.name) || "Stop" };
      }),
      distance: num(plan.distance) || 0,
      duration: num(plan.duration) || 0,
      by: cleanName(plan.by) || st.hostName,
      at: now(),
      vehicle: plan.vehicle === "motorcycle" ? "motorcycle" : "car"
    };
  }

  function sendPlanTo(send, plan) {
    if (!plan) return;
    var chunks = [];
    for (var i = 0; i < plan.coords.length; i += PLAN_CHUNK_POINTS) {
      chunks.push(plan.coords.slice(i, i + PLAN_CHUNK_POINTS));
    }
    send({
      type: MSG.PLAN_META, id: plan.id, n: chunks.length, stops: plan.stops,
      distance: plan.distance, duration: plan.duration, by: plan.by,
      at: plan.at, vehicle: plan.vehicle
    });
    for (var c = 0; c < chunks.length; c++) {
      send({ type: MSG.PLAN_CHUNK, id: plan.id, i: c, coords: chunks[c] });
    }
  }

  function onPlanMeta(m) {
    st.planIn = {
      id: m.id, n: Math.max(0, Math.min(400, num(m.n) || 0)), got: 0, parts: [],
      stops: Array.isArray(m.stops) ? m.stops.slice(0, 25) : [],
      distance: num(m.distance) || 0, duration: num(m.duration) || 0,
      by: cleanName(m.by), at: now(),
      vehicle: m.vehicle === "motorcycle" ? "motorcycle" : "car"
    };
    if (st.planIn.n === 0) finishPlanIn();
  }

  function onPlanChunk(m) {
    var p = st.planIn;
    if (!p || p.id !== m.id || !Array.isArray(m.coords)) return;
    var i = num(m.i);
    if (i == null || i < 0 || i >= p.n || p.parts[i]) return;
    p.parts[i] = m.coords;
    p.got++;
    if (p.got >= p.n) finishPlanIn();
  }

  function finishPlanIn() {
    var p = st.planIn;
    st.planIn = null;
    if (!p) return;
    var coords = [];
    for (var i = 0; i < p.n; i++) {
      var part = p.parts[i];
      if (!part) return;   // a hole means an incomplete road; wait for a resend
      for (var j = 0; j < part.length; j++) {
        var c = part[j];
        var lat = num(c && c[0]), lon = num(c && c[1]);
        if (lat == null || lon == null) continue;
        coords.push([lat, lon]);
      }
    }
    if (coords.length < 2) return;
    st.planned = {
      id: p.id, coords: coords, stops: p.stops.filter(function (s) {
        return num(s && s.lat) != null && num(s && s.lon) != null;
      }), distance: p.distance, duration: p.duration, by: p.by, at: p.at, vehicle: p.vehicle
    };
    fire("Planned", st.planned);
    changed();
  }

  /* ---------------- chat ---------------- */

  function pushChat(msg) {
    st.chat.push(msg);
    if (st.chat.length > CHAT_KEEP) st.chat.splice(0, st.chat.length - CHAT_KEEP);
    fire("Chat", msg);
    changed();
  }

  function chatMessage(fromId, name, text, kind) {
    return { id: rid(8), from: fromId, name: name, text: text, at: now(), kind: kind || "say" };
  }

  /* ---------------- voice: push to talk ----------------
     Opus in a container, recorded whole and sent whole. A live audio track
     would mean renegotiating every peer connection in the room whenever
     somebody joins; a clip needs none of that, survives a tunnel (it simply
     arrives late), and matches how people actually talk on a ride: in bursts,
     with a thumb on a button, eyes on the road. */

  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    var want = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"];
    for (var i = 0; i < want.length; i++) {
      if (MediaRecorder.isTypeSupported(want[i])) return want[i];
    }
    return "";
  }

  function toBase64(buf) {
    var bytes = new Uint8Array(buf);
    var out = "";
    // 8k at a time: String.fromCharCode.apply over a whole clip blows the
    // argument limit on some engines.
    for (var i = 0; i < bytes.length; i += 8192) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return window.btoa(out);
  }

  function fromBase64(s) {
    var bin = window.atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function micStream() {
    if (st.mic) return Promise.resolve(st.mic);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.reject(new Error("This browser will not share a microphone."));
    }
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    }).then(function (stream) {
      if (!st) { stream.getTracks().forEach(function (t) { t.stop(); }); throw new Error("Left the room."); }
      st.mic = stream;
      return stream;
    });
  }

  function releaseMic() {
    if (st && st.mic) {
      try { st.mic.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      st.mic = null;
    }
  }

  function recordOnce(ms) {
    return micStream().then(function (stream) {
      var mime = pickMime();
      var rec;
      try {
        rec = mime ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 24000 })
                   : new MediaRecorder(stream);
      } catch (e) {
        return Promise.reject(new Error("This browser cannot record audio."));
      }
      st.rec = rec;
      var parts = [];
      return new Promise(function (resolve, reject) {
        var stopTimer = setTimeout(function () { try { rec.stop(); } catch (e) {} },
                                   Math.min(ms || VOICE_MAX_MS, VOICE_MAX_MS));
        rec.ondataavailable = function (e) { if (e.data && e.data.size) parts.push(e.data); };
        rec.onerror = function () { clearTimeout(stopTimer); reject(new Error("Recording failed.")); };
        rec.onstop = function () {
          clearTimeout(stopTimer);
          if (st) st.rec = null;
          if (!parts.length) { resolve(null); return; }
          resolve(new Blob(parts, { type: rec.mimeType || mime || "audio/webm" }));
        };
        rec.start();
      });
    });
  }

  function sendClip(blob) {
    if (!blob || !st) return Promise.resolve(false);
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { resolve(null); };
      fr.readAsArrayBuffer(blob);
    }).then(function (buf) {
      if (!buf || !st) return false;
      var b64 = toBase64(buf);
      if (b64.length > VOICE_MAX_B) {
        notice("That clip was too long to send.", "warn");
        return false;
      }
      var clip = {
        cid: rid(10), mime: blob.type || "audio/webm",
        from: st.meId, name: st.myName, at: now()
      };
      var n = Math.ceil(b64.length / VOICE_CHUNK_B);
      var parts = [];
      for (var i = 0; i < n; i++) parts.push(b64.slice(i * VOICE_CHUNK_B, (i + 1) * VOICE_CHUNK_B));

      function emit(msg) {
        if (st.role === "host") broadcast(msg);
        else st.net.send(msg);
      }
      for (var c = 0; c < parts.length; c++) {
        emit({ type: MSG.VOICE, cid: clip.cid, i: c, n: n, data: parts[c],
               mime: clip.mime, from: clip.from, name: clip.name });
      }
      // The speaker hears their own clip nowhere: a rider does not need an echo
      // of their own voice a second after saying it.
      return true;
    });
  }

  function onVoiceChunk(m, fromLink) {
    var cid = String(m.cid || "");
    var n = num(m.n);
    var i = num(m.i);
    if (!cid || n == null || i == null || n < 1 || n > 400 || i < 0 || i >= n) return;
    if (typeof m.data !== "string" || m.data.length > VOICE_CHUNK_B + 64) return;

    var key = cid;
    var acc = st.voiceIn[key];
    if (!acc) {
      acc = st.voiceIn[key] = { n: n, got: 0, parts: [], mime: String(m.mime || "audio/webm"),
                                from: String(m.from || ""), name: cleanName(m.name) || "Someone",
                                bytes: 0, at: now() };
    }
    if (acc.parts[i]) return;
    acc.parts[i] = m.data;
    acc.got++;
    acc.bytes += m.data.length;
    if (acc.bytes > VOICE_MAX_B) { delete st.voiceIn[key]; return; }

    // The host is a relay as well as a listener.
    if (st.role === "host") broadcast(m, fromLink && fromLink.id);

    if (acc.got >= acc.n) {
      delete st.voiceIn[key];
      var b64 = acc.parts.join("");
      var bytes;
      try { bytes = fromBase64(b64); } catch (e) { return; }
      playClip(new Blob([bytes], { type: acc.mime }), acc.name, acc.from);
    }

    // Nothing here waits forever: a clip whose tail never arrived is swept on
    // the same timer that ages members out.
  }

  function playClip(blob, name, fromId) {
    fire("Voice", { name: name, from: fromId, at: now() });
    if (st.muted) return;
    st.playQueue.push({ blob: blob, name: name, from: fromId });
    drainQueue();
  }

  function drainQueue() {
    if (!st || st.playing || !st.playQueue.length) return;
    var item = st.playQueue.shift();
    st.playing = true;
    st.speaking = { name: item.name, from: item.from, at: now() };
    changed();
    var url = URL.createObjectURL(item.blob);
    var audio = new Audio(url);
    audio.volume = 1;
    function done() {
      try { URL.revokeObjectURL(url); } catch (e) {}
      if (!st) return;
      st.playing = false;
      st.speaking = null;
      changed();
      drainQueue();
    }
    audio.onended = done;
    audio.onerror = done;
    var p = audio.play();
    if (p && p.catch) {
      p.catch(function () {
        // Autoplay was refused — the room has not been touched yet on this
        // phone. Say so once rather than silently swallowing every clip.
        if (st && !st.autoplayWarned) {
          st.autoplayWarned = true;
          notice("Tap anywhere to let RouteCast play voice from the room.", "warn");
        }
        done();
      });
    }
  }

  /* ---------------- presence ---------------- */

  function setMyFix(fix) {
    if (!st) return;
    var f = cleanFix(fix);
    if (!f) return;
    st.myFix = f;
    var me = st.members[st.meId];
    if (me) me.fix = f;
    var moved = st.lastSentFix
      ? RC.rejoin.metres(st.lastSentFix.lat, st.lastSentFix.lon, f.lat, f.lon)
      : Infinity;
    if (moved >= POS_MOVE_M) flushPos();
    fire("Fix", f);
  }

  function flushPos() {
    if (!st) return;
    var f = st.myFix;
    if (!f) return;
    st.lastSentFix = f;
    if (st.role === "guest") {
      st.net.send({ type: MSG.POS, lat: f.lat, lon: f.lon, speedKmh: f.speedKmh,
                    courseDeg: f.courseDeg, accuracy: f.accuracy });
    }
  }

  /** The host is the only one who knows everybody's position, so it is the
      host that sends the batch. One message per tick beats one per rider per
      tick, which on a room of eight is the difference between a trickle and a
      stutter. */
  function pushPositions() {
    if (!st || st.role !== "host") return;
    var list = [];
    st.order.forEach(function (id) {
      var m = st.members[id];
      if (!m.approved || !m.fix) return;
      list.push({ id: id, lat: m.fix.lat, lon: m.fix.lon, speedKmh: m.fix.speedKmh,
                  courseDeg: m.fix.courseDeg, accuracy: m.fix.accuracy,
                  age: Math.round((now() - m.fix.at) / 1000) });
    });
    if (list.length) broadcast({ type: MSG.POSB, list: list });
  }

  function ageOut() {
    if (!st) return;
    var dirty = false;
    st.order.forEach(function (id) {
      var m = st.members[id];
      var stale = !m.fix || now() - m.fix.at > STALE_MS;
      if (m.stale !== stale) { m.stale = stale; dirty = true; }
    });
    // Voice clips whose tail never arrived.
    Object.keys(st.voiceIn).forEach(function (k) {
      if (now() - st.voiceIn[k].at > 30000) delete st.voiceIn[k];
    });
    if (dirty) changed();
  }

  /* ---------------- geolocation ----------------
     One watch for the whole room. nav.js and free.js run their own for the
     dashboard; this one exists so presence works when neither of them is on —
     a rider sitting in the car park is still in the room. */

  function startWatch() {
    if (!st || st.watchId != null) return;
    if (!navigator.geolocation) {
      notice("This browser will not share a location, so the room cannot see you.", "warn");
      return;
    }
    st.watchId = navigator.geolocation.watchPosition(function (pos) {
      var c = pos.coords || {};
      setMyFix({
        lat: c.latitude, lon: c.longitude, accuracy: c.accuracy,
        speedKmh: c.speed == null ? null : c.speed * 3.6,
        courseDeg: c.heading == null ? null : c.heading
      });
    }, function (err) {
      if (err && err.code === 1) notice("Location is blocked, so the room cannot see you.", "warn");
    }, { enableHighAccuracy: true, maximumAge: 4000, timeout: 20000 });
  }

  function stopWatch() {
    if (st && st.watchId != null && navigator.geolocation) {
      try { navigator.geolocation.clearWatch(st.watchId); } catch (e) {}
    }
    if (st) st.watchId = null;
  }

  /* ---------------- host ---------------- */

  function waiting(id) {
    return !!(st.role === "host" && st.settings.approval && st.members[id] && !st.members[id].approved);
  }

  function hostReceive(link, data) {
    if (!st || st.role !== "host" || !data || typeof data !== "object") return;
    var id = link.id;
    var m = st.members[id];

    if (data.type === MSG.HELLO) {
      var name = cleanName(data.name) || "Rider";
      if (!m) {
        if (st.order.length >= MEMBER_MAX) {
          link.send({ type: MSG.BYE, reason: "full" });
          setTimeout(function () { if (st && st.net) st.net.kick(id); }, 150);
          return;
        }
        m = st.members[id] = member(id, name);
        st.order.push(id);
      } else {
        m.name = name;
        m.online = true;
      }
      if (!st.settings.approval) m.approved = true;

      link.send({ type: MSG.WELCOME, youId: id, color: m.color, approved: m.approved });
      if (m.approved) {
        sendStateTo(link);
        pushChat(chatMessage("system", m.name, m.name + " joined the ride.", "system"));
        pushState();
      } else {
        link.send({ type: MSG.WAIT });
        notice(m.name + " is asking to join.", "warn");
        changed();
      }
      return;
    }

    if (!m) return;                       // a message before a name: nothing to attribute
    if (data.type === MSG.RESYNC) {
      if (waiting(id)) { link.send({ type: MSG.WAIT }); return; }
      sendStateTo(link);
      return;
    }

    /* The door. Everything below this line needs a rider the host let in. */
    if (waiting(id)) {
      link.send({ type: MSG.WAIT });
      link.send({ type: MSG.NOTICE, text: "The host has not let you into the ride yet.", kind: "warn" });
      return;
    }

    switch (data.type) {
      case MSG.POS: {
        var f = cleanFix(data);
        if (f) { m.fix = f; changed(); }
        break;
      }
      case MSG.CHAT: {
        if (st.settings.chat === false) {
          link.send({ type: MSG.NOTICE, text: "Chat is off in this ride.", kind: "warn" });
          return;
        }
        var text = cleanText(data.text);
        if (!text) return;
        if (m.lastChatAt && now() - m.lastChatAt < CHAT_MIN_GAP_MS) return;
        m.lastChatAt = now();
        var msg = chatMessage(id, m.name, text);
        pushChat(msg);
        broadcast({ type: MSG.CHAT, msg: msg });
        break;
      }
      case MSG.VOICE:
        if (st.settings.voice === false) return;
        onVoiceChunk(data, link);
        break;
      case MSG.NUDGE: {
        var who = cleanName(data.name) || m.name;
        var n = chatMessage("system", who, who + " asked where everyone is.", "system");
        pushChat(n);
        broadcast({ type: MSG.CHAT, msg: n });
        break;
      }
      default:
        break;   // an unknown message from a guest is not an error, just noise
    }
  }

  function sendStateTo(link) {
    var snap = snapshot();
    st.snap = snap;
    link.send({ type: MSG.STATE, state: snap });
    if (st.planned) sendPlanTo(function (o) { link.send(o); }, st.planned);
  }

  function hostRoom(opts) {
    var name = cleanName(opts.name);
    if (!name) return Promise.reject(new Error("Put your name in first — the room needs to know who you are."));
    var code = opts.code ? RC.net.normalizeCode(opts.code) : RC.net.makeCode();
    if (code.length !== 6) code = RC.net.makeCode();

    st = baseState("host", name, code);
    st.settings.approval = opts.approval !== false;
    st.hostName = name;
    st.meId = "host";
    st.members[st.meId] = member(st.meId, name);
    st.members[st.meId].approved = true;
    st.members[st.meId].host = true;
    st.order.push(st.meId);

    st.net = RC.net.host(code, {
      on: {
        "guest-open": function (link) { /* named on HELLO, not before */ },
        "guest-message": function (link, data) { hostReceive(link, data); },
        "guest-close": function (link) {
          var m = st && st.members[link.id];
          if (!m) return;
          m.online = false;
          m.fix = m.fix;   // keep the last known dot; it is still information
          pushChat(chatMessage("system", m.name, m.name + " dropped out of the ride.", "system"));
          pushState();
        },
        "broker": function () { changed(); },
        "code-taken": function () {
          notice("That room code is already in use. Pick another one.", "error");
          leave();
        }
      }
    });

    startTimers();
    startWatch();
    changed();
    return Promise.resolve({ code: code });
  }

  /* ---------------- guest ---------------- */

  function guestReceive(data) {
    if (!st || st.role !== "guest" || !data || typeof data !== "object") return;
    switch (data.type) {
      case MSG.WELCOME:
        st.meId = String(data.youId || "me");
        st.myColor = typeof data.color === "string" ? data.color : COLORS[0];
        st.waiting = !data.approved;
        changed();
        break;
      case MSG.WAIT:
        st.waiting = true;
        changed();
        break;
      case MSG.STATE: {
        var s = data.state || {};
        st.waiting = false;
        st.rev = num(s.rev) || 0;
        st.hostName = cleanName(s.hostName);
        st.settings = {
          approval: !!(s.settings && s.settings.approval),
          chat: !(s.settings && s.settings.chat === false),
          voice: !(s.settings && s.settings.voice === false)
        };
        st.order = [];
        st.members = {};
        (Array.isArray(s.members) ? s.members : []).slice(0, MEMBER_MAX + 2).forEach(function (m) {
          var id = String(m && m.id || "");
          if (!id) return;
          st.members[id] = {
            id: id, name: cleanName(m.name) || "Rider",
            color: typeof m.color === "string" ? m.color : COLORS[0],
            host: !!m.host, approved: !!m.approved, online: m.online !== false,
            fix: st.members[id] ? st.members[id].fix : null,
            joinedAt: num(m.joinedAt) || now()
          };
          st.order.push(id);
        });
        if (Array.isArray(s.chat) && !st.chat.length) {
          s.chat.forEach(function (m) {
            if (!m || !m.text) return;
            st.chat.push({ id: String(m.id || rid(8)), from: String(m.from || ""),
                           name: cleanName(m.name) || "Rider", text: cleanText(m.text),
                           at: num(m.at) || now(), kind: m.kind === "system" ? "system" : "say" });
          });
        }
        changed();
        break;
      }
      case MSG.POSB: {
        var list = Array.isArray(data.list) ? data.list : [];
        for (var i = 0; i < list.length; i++) {
          var id = String(list[i] && list[i].id || "");
          var m2 = st.members[id];
          if (!m2 || id === st.meId) continue;
          var f = cleanFix(list[i]);
          if (f) m2.fix = f;
        }
        changed();
        break;
      }
      case MSG.CHAT: {
        var msg = data.msg;
        if (!msg || !msg.text) return;
        pushChat({ id: String(msg.id || rid(8)), from: String(msg.from || ""),
                   name: cleanName(msg.name) || "Rider", text: cleanText(msg.text),
                   at: now(), kind: msg.kind === "system" ? "system" : "say" });
        break;
      }
      case MSG.VOICE:
        if (st.settings.voice === false) return;
        onVoiceChunk(data, null);
        break;
      case MSG.PLAN_META: onPlanMeta(data); break;
      case MSG.PLAN_CHUNK: onPlanChunk(data); break;
      case MSG.PLAN_CLEAR:
        st.planned = null;
        st.planIn = null;
        fire("Planned", null);
        changed();
        break;
      case MSG.NOTICE:
        notice(cleanText(data.text), data.kind === "error" ? "error" : (data.kind || ""));
        break;
      case MSG.BYE:
        st.byeReason = String(data.reason || "");
        notice(data.reason === "kicked" ? "The host removed you from the ride."
             : data.reason === "refused" ? "The host did not let you in."
             : data.reason === "full" ? "That ride is full."
             : "The ride ended.", "warn");
        leave({ silent: true });
        break;
      default: break;
    }
  }

  function joinRoom(opts) {
    var name = cleanName(opts.name);
    var code = RC.net.normalizeCode(opts.code);
    if (!name) return Promise.reject(new Error("Put your name in first — the room needs to know who you are."));
    if (code.length !== 6) return Promise.reject(new Error("A room code is six characters."));

    st = baseState("guest", name, code);
    st.waiting = true;

    /* RC.net.join never gives up — it walks the broker list and backs off for
       as long as the room is open, which is exactly what you want halfway
       through a tunnel and exactly what you do not want while somebody is
       standing there having mistyped a code. So the caller's promise gets its
       own deadline, and the last retry reason phrases the failure. */
    return new Promise(function (resolve, reject) {
      var settled = false;
      var lastWhy = "";
      var giveUp = setTimeout(function () {
        if (settled) return;
        settled = true;
        var msg = lastWhy === "no-host"
          ? "Nobody is hosting code " + code + " right now."
          : "Could not reach a ride on code " + code + ".";
        leave({ silent: true });
        reject(new Error(msg));
      }, 25000);

      function hello() {
        if (st && st.net) st.net.send({ type: MSG.HELLO, name: st.myName });
      }

      st.net = RC.net.join(code, {
        state: function (s, detail) {
          if (!st) return;
          st.link = s;
          if (s === "retrying" && detail) lastWhy = String(detail);
          changed();
          if (s === "connected" && !settled) {
            settled = true;
            clearTimeout(giveUp);
            resolve({ code: code });
          }
        },
        // Every fresh channel re-introduces us: a reconnect the rider never saw
        // must not leave the host holding a nameless link.
        open: hello,
        message: function (data) { guestReceive(data); }
      });

      startTimers();
      startWatch();
      changed();
    });
  }

  /* ---------------- lifecycle ---------------- */

  function baseState(role, name, code) {
    return {
      role: role,
      code: code,
      myName: name,
      hostName: role === "host" ? name : "",
      meId: role === "host" ? "host" : "",
      myColor: COLORS[0],
      members: {},
      order: [],
      colorSeq: 0,
      chat: [],
      settings: { approval: true, chat: true, voice: true },
      planned: null,
      planIn: null,
      rev: 0,
      snap: null,
      myFix: null,
      lastSentFix: null,
      watchId: null,
      timers: [],
      net: null,
      link: "connecting",
      waiting: false,
      voiceIn: {},
      playQueue: [],
      playing: false,
      speaking: null,
      muted: false,
      handsFree: false,
      talking: false,
      mic: null,
      rec: null,
      autoplayWarned: false,
      byeReason: ""
    };
  }

  function startTimers() {
    st.timers.push(setInterval(function () {
      if (!st) return;
      flushPos();
      pushPositions();
    }, POS_MS));
    st.timers.push(setInterval(ageOut, 5000));
  }

  function leave(opts) {
    if (!st) return;
    var was = st;
    var silent = opts && opts.silent;
    if (was.role === "host" && was.net) {
      try { was.net.broadcast({ type: MSG.BYE, reason: "ended" }); } catch (e) {}
    }
    was.timers.forEach(function (t) { clearInterval(t); });
    stopWatch();
    setHandsFree(false);
    releaseMic();
    try { if (was.rec) was.rec.stop(); } catch (e) {}
    try { if (was.net) was.net.stop(); } catch (e) {}
    st = null;
    fire("Planned", null);
    changed();
    if (!silent) notice("You left the ride.", "");
    return was.code;
  }

  /* ---------------- public surface ---------------- */

  function requireHost() { return !!(st && st.role === "host"); }

  var api = {
    MSG: MSG,
    COLORS: COLORS,
    NAME_MAX: NAME_MAX,
    CHAT_MAX: CHAT_MAX,
    MEMBER_MAX: MEMBER_MAX,

    host: hostRoom,
    join: joinRoom,
    leave: leave,

    isActive: function () { return !!st; },
    isHost: function () { return !!(st && st.role === "host"); },
    isWaiting: function () { return !!(st && st.waiting); },
    code: function () { return st ? st.code : ""; },
    myId: function () { return st ? st.meId : ""; },
    myName: function () { return st ? st.myName : ""; },
    linkState: function () { return st ? (st.role === "host" ? "host" : st.link) : "off"; },
    settings: function () {
      return st ? { approval: !!st.settings.approval, chat: st.settings.chat !== false,
                    voice: st.settings.voice !== false } : null;
    },

    /** The roster, host first, then join order. `me` marks the local rider. */
    members: function () {
      if (!st) return [];
      return st.order.map(function (id) {
        var m = st.members[id];
        return {
          id: m.id, name: m.name, color: m.color, host: !!m.host, approved: !!m.approved,
          online: m.online !== false, me: id === st.meId, fix: m.fix || null,
          stale: !m.fix || now() - m.fix.at > STALE_MS
        };
      });
    },
    pending: function () {
      if (!st || st.role !== "host") return [];
      return st.order.filter(function (id) { return !st.members[id].approved; })
        .map(function (id) { return { id: id, name: st.members[id].name }; });
    },
    chat: function () { return st ? st.chat.slice() : []; },
    planned: function () { return st ? st.planned : null; },
    speaking: function () { return st ? st.speaking : null; },
    isMuted: function () { return !!(st && st.muted); },
    isTalking: function () { return !!(st && st.talking); },
    isHandsFree: function () { return !!(st && st.handsFree); },
    myFix: function () { return st ? st.myFix : null; },

    /** Feed a fix in from nav.js or free.js so the room does not pay for a
        second high-accuracy watch while the dashboard is already running. */
    pushFix: setMyFix,

    setApproval: function (on) {
      if (!requireHost()) return false;
      st.settings.approval = !!on;
      if (!on) {
        // Switching the door off opens it, rather than leaving a lobby full of
        // people the room no longer has any way of admitting.
        st.order.forEach(function (id) {
          if (!st.members[id].approved) {
            st.members[id].approved = true;
            var l = linkFor(id);
            if (l) l.send({ type: MSG.NOTICE, text: "You are in. Ride safe.", kind: "ok" });
          }
        });
      }
      pushState();
      return true;
    },

    setChatEnabled: function (on) {
      if (!requireHost()) return false;
      st.settings.chat = !!on;
      pushState();
      return true;
    },

    setVoiceEnabled: function (on) {
      if (!requireHost()) return false;
      st.settings.voice = !!on;
      if (!on) setHandsFree(false);
      pushState();
      return true;
    },

    approve: function (id, ok) {
      if (!requireHost()) return false;
      var m = st.members[id];
      if (!m) return false;
      var link = linkFor(id);
      if (ok) {
        m.approved = true;
        if (link) {
          link.send({ type: MSG.NOTICE, text: "You are in. Ride safe.", kind: "ok" });
          sendStateTo(link);
        }
        pushChat(chatMessage("system", m.name, m.name + " joined the ride.", "system"));
      } else {
        // Refused, not merely ignored: otherwise their own retry loop keeps
        // dialling all afternoon.
        if (link) link.send({ type: MSG.BYE, reason: "refused" });
        var gone = id;
        setTimeout(function () { if (st && st.net) st.net.kick(gone); }, 150);
        delete st.members[id];
        st.order = st.order.filter(function (x) { return x !== id; });
      }
      pushState();
      return true;
    },

    kick: function (id) {
      if (!requireHost() || id === st.meId) return false;
      var m = st.members[id];
      if (!m) return false;
      var link = linkFor(id);
      if (link) link.send({ type: MSG.BYE, reason: "kicked" });
      setTimeout(function () { if (st && st.net) st.net.kick(id); }, 150);
      delete st.members[id];
      st.order = st.order.filter(function (x) { return x !== id; });
      pushChat(chatMessage("system", m.name, m.name + " was removed from the ride.", "system"));
      pushState();
      return true;
    },

    /** Set the planned route for the whole room. The host's alone: one line,
        one owner, or it is not a plan. */
    setPlanned: function (plan) {
      if (!requireHost()) return false;
      if (!plan || !plan.coords || plan.coords.length < 2) return false;
      st.planned = packPlan(plan);
      sendPlanTo(function (o) { broadcast(o); }, st.planned);
      var msg = chatMessage("system", st.myName,
        st.myName + " set the planned route (" + Math.round(st.planned.distance / 1000) + " km).", "system");
      pushChat(msg);
      broadcast({ type: MSG.CHAT, msg: msg });
      fire("Planned", st.planned);
      pushState();
      return true;
    },

    clearPlanned: function () {
      if (!requireHost()) return false;
      st.planned = null;
      broadcast({ type: MSG.PLAN_CLEAR });
      fire("Planned", null);
      pushState();
      return true;
    },

    say: function (text) {
      if (!st) return false;
      var t = cleanText(text);
      if (!t) return false;
      if (st.settings.chat === false) { notice("Chat is off in this ride.", "warn"); return false; }
      if (st.role === "host") {
        var msg = chatMessage(st.meId, st.myName, t);
        pushChat(msg);
        broadcast({ type: MSG.CHAT, msg: msg });
      } else {
        st.net.send({ type: MSG.CHAT, text: t });
        // Shown locally straight away; the host's copy is the one of record and
        // arrives back as an ordinary CHAT, which is why ids are generated
        // there and not here.
        pushChat(chatMessage(st.meId, st.myName, t, "mine"));
      }
      return true;
    },

    nudge: function () {
      if (!st) return false;
      if (st.role === "host") {
        var n = chatMessage("system", st.myName, st.myName + " asked where everyone is.", "system");
        pushChat(n);
        broadcast({ type: MSG.CHAT, msg: n });
      } else {
        st.net.send({ type: MSG.NUDGE, name: st.myName });
      }
      return true;
    },

    /* ---- voice ---- */
    canTalk: function () {
      return !!(st && st.settings.voice !== false && window.MediaRecorder &&
                navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    },

    startTalking: function () {
      if (!st || st.talking || !api.canTalk()) return Promise.resolve(false);
      st.talking = true;
      changed();
      return recordOnce(VOICE_MAX_MS).then(function (blob) {
        if (!st) return false;
        st.talking = false;
        changed();
        return sendClip(blob);
      }, function (err) {
        if (st) { st.talking = false; changed(); }
        notice(err && err.message ? err.message : "Could not record.", "error");
        return false;
      });
    },

    stopTalking: function () {
      if (!st || !st.rec) return false;
      try { st.rec.stop(); } catch (e) {}
      return true;
    },

    setMuted: function (on) {
      if (!st) return false;
      st.muted = !!on;
      if (on) st.playQueue.length = 0;
      changed();
      return true;
    },

    setHandsFree: function (on) { return setHandsFree(on); },

    /* Exposed for the harness: the pure bits, with no browser in them. */
    _clean: { name: cleanName, text: cleanText, fix: cleanFix },
    _packPlan: function (plan, hostName) {
      var restore = st;
      st = st || baseState("host", hostName || "Host", "AAAAAA");
      var out = packPlan(plan);
      st = restore;
      return out;
    },

    onChange: null,
    onChat: null,
    onNotice: null,
    onVoice: null,
    onPlanned: null,
    onFix: null
  };

  /** Hands-free: the mic stays open and goes out as back-to-back segments.
      Each segment is a complete recording, so it plays anywhere a single clip
      plays — no streaming container to keep alive across a tunnel. */
  function setHandsFree(on) {
    if (!st) return false;
    on = !!on;
    if (st.handsFree === on) return true;
    st.handsFree = on;
    changed();
    if (!on) {
      try { if (st.rec) st.rec.stop(); } catch (e) {}
      releaseMic();
      return true;
    }
    if (!api.canTalk()) { st.handsFree = false; changed(); return false; }

    (function loop() {
      if (!st || !st.handsFree) return;
      recordOnce(HANDS_FREE_MS).then(function (blob) {
        if (!st || !st.handsFree) return;
        sendClip(blob);
        loop();
      }, function (err) {
        if (!st) return;
        st.handsFree = false;
        changed();
        notice(err && err.message ? err.message : "Could not record.", "error");
      });
    })();
    return true;
  }

  return api;
})();

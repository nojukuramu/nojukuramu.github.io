/* ============================================================
   RouteCast — the proximity mic

   PUBs puts strangers on your map. This lets the ones standing next to you
   talk to you: switch it on and every rider within fifty metres who has also
   switched it on is connected to you, and you to them, and each voice is as
   loud as its rider is close — full at arm's length, gone at fifty metres.
   A fuel stop, a car park, a jam that has not moved for ten minutes: the
   conversation you would have through a visor if visors let you.

   Why it is phone to phone, and not through the area's hub
   --------------------------------------------------------
   The area already has a relay that hears everyone: its hub. Routing voice
   through it would have been the short path — the ride does exactly that,
   mixing at the host — and it would have been wrong three times over. The hub
   is a stranger who may be a hundred kilometres away, so everybody's voice
   would be decoded on a phone nobody nearby chose; it would be the round trip
   to wherever that phone is and back for two riders three metres apart; and
   one phone would be mixing a whole region's fuel-stop chatter. So the hub
   does the one thing it is good at — it knows who is near whom, and it
   attributes every message by the connection it arrived on — and introduces
   the two phones. The voice then goes directly between them, over a link of
   their own, and the hub never carries a syllable of it.

   Who connects to whom
   --------------------
   A small mesh, one link per pair. Both ends make the same decision from the
   same area packet — the riders with the mic on, nearest first, up to a cap —
   and only one of them acts on it: the one whose id sorts first dials, the
   other answers. Nobody has to agree on anything for that to come out the
   same on both phones, and a pair can never end up with two links.

   The area packet is a few seconds old by the time it arrives, and at sixty
   kilometres an hour a few seconds is the whole range. So links are opened
   early — at a hundred metres, silent — and dropped late, at a hundred and
   fifty after a grace period, and the volume is worked out from positions the
   two phones send each other directly, once a second. The connection is a
   question of "might we be talking soon"; the volume is the answer to "how
   far apart are we right now".

   What it costs, and what it shares
   ---------------------------------
   Nothing until somebody is near. The area is told one bit — that your mic
   is on — so other mics can find you. A rider you are linked to gets your
   position at about a metre rather than the area's eleven, because the level
   needs it and because they are already within shouting distance of you;
   nobody else does. The microphone opens on the button (or on Open mic), not
   when the switch goes on, and the voice engine is its own: the ride's mixer
   never sees any of this, and nothing said at a fuel stop reaches a ride.

   Ignore works here too. An ignored rider is hung up on and never dialled.
   ============================================================ */
var RC = RC || {};

RC.proxmic = (function () {
  "use strict";

  var RANGE_M = 50;              // heard at all
  var FULL_M = 5;                // heard at full volume
  var LINK_M = 100;              // dial this early, so the first word is not a handshake
  var DROP_M = 150;              // let go beyond this...
  var DROP_GRACE_MS = 8000;      // ...once it has been true for this long
  var LOST_MS = 20000;           // no position from either source: gone
  var MAX_PEERS = 10;            // each one is a peer connection and a decoder
  var TICK_MS = 1000;
  var POS_FRESH_MS = 6000;       // a direct fix older than this gives way to the area's
  var TALK_FRESH_MS = 4000;      // a talk flag not repeated this long is over
  var DIAL_TIMEOUT_MS = 15000;
  var CAND_BATCH_MS = 250;       // trickle candidates through the hub in handfuls
  var SHARE_DP = 5;              // ~1 m, and only to a rider already beside you

  // How long not to redial somebody, by why the last attempt ended. A refusal
  // because they are full is a "not now"; a link that dropped is "try again".
  var COOL_MS = {
    fail: 15000, full: 30000, closed: 3000, far: 10000, off: 30000,
    noaudio: 120000, blocked: Infinity, rule: 60000, bye: 10000
  };

  var on = false;
  var openMic = false;           // hands-free
  var holding = false;           // a thumb on the button
  var muted = false;
  var engine = null;
  var peers = {};                // rider id -> peer record
  var cool = {};                 // rider id -> do not dial before
  var timer = null;
  var lastSig = "";

  function now() { return Date.now(); }

  /* ---------------- the arithmetic ---------------- */

  /** Loudness for a distance, 0 to 1. Linear in amplitude from full at five
      metres to nothing at fifty: about half as loud at twenty-seven metres, a
      murmur at forty-five, and exactly silent at the edge, so a rider walking
      out of range fades out rather than being cut off. */
  function volumeFor(d) {
    if (d == null || !isFinite(d) || d < 0) return 0;
    if (d <= FULL_M) return 1;
    if (d >= RANGE_M) return 0;
    return 1 - (d - FULL_M) / (RANGE_M - FULL_M);
  }

  /** Who this phone would like to be linked to, from the area as it last
      heard it: riders with the mic on, not ignored, inside the dialling
      radius, nearest first, up to the cap. Pure, so both ends of a pair can be
      shown to reach the same answer. */
  function wanted(me, world, blocked, max) {
    if (!me) return [];
    var out = [];
    for (var i = 0; i < world.length; i++) {
      var p = world[i];
      if (!p || !p.mic || !p.fix || (blocked && blocked(p.id))) continue;
      var d = RC.haversine(me, p.fix);
      if (d <= LINK_M) out.push({ id: p.id, name: p.name, d: d });
    }
    out.sort(function (a, b) { return a.d - b.d; });
    return out.slice(0, max == null ? MAX_PEERS : max);
  }

  /** The dialling rule. Both phones evaluate it on the same pair of ids and
      get opposite answers, which is the whole of the negotiation. */
  function dials(myId, theirId) { return String(myId) < String(theirId); }

  function round(v) {
    var f = Math.pow(10, SHARE_DP);
    return Math.round(v * f) / f;
  }

  /* What arrives over a link is a stranger's claim like everything else. */
  function cleanPos(m) {
    if (!m) return null;
    var lat = Number(m.lat), lon = Number(m.lon);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat: lat, lon: lon };
  }

  function cleanCid(c) { return String(c == null ? "" : c).replace(/[^A-Za-z0-9_]/g, "").slice(0, 24); }

  function cleanSdp(sdp, type) {
    if (!sdp || sdp.type !== type || typeof sdp.sdp !== "string") return null;
    if (sdp.sdp.length > 15000 || sdp.sdp.indexOf("v=0") !== 0) return null;
    return { type: type, sdp: sdp.sdp };
  }

  function cleanCands(list) {
    var out = [];
    if (!list || !list.length) return out;
    for (var i = 0; i < list.length && out.length < 30; i++) {
      var c = list[i];
      if (!c || typeof c.candidate !== "string" || c.candidate.length > 600) continue;
      out.push({
        candidate: c.candidate,
        sdpMid: c.sdpMid == null ? null : String(c.sdpMid).slice(0, 16),
        sdpMLineIndex: typeof c.sdpMLineIndex === "number" ? c.sdpMLineIndex : null
      });
    }
    return out;
  }

  /* ---------------- events ---------------- */

  function notice(text, kind) {
    if (typeof api.onNotice === "function") { try { api.onNotice({ text: text, kind: kind || "" }); } catch (e) {} }
  }

  /** Tell the screen, but only when something it draws has changed: the tick
      runs every second, and most seconds nothing has. */
  function changed(force) {
    var snap = api.snapshot();
    var sig = JSON.stringify([snap.on, snap.open, snap.talking, snap.muted, snap.near.map(function (n) {
      return [n.id, n.state, Math.round(n.level * 20), n.talking, Math.round((n.dist || 0) / 5)];
    })]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    if (typeof api.onChange === "function") { try { api.onChange(snap); } catch (e) {} }
  }

  /* ---------------- where everybody is ---------------- */

  function worldIndex() {
    var map = {};
    var list = RC.pubs.world();
    for (var i = 0; i < list.length; i++) map[list[i].id] = list[i];
    return map;
  }

  /** The best distance there is to a peer: its own last fix over the link if
      that is fresh, the area's otherwise. */
  function distanceTo(p, me, world) {
    if (!me) return null;
    if (p.fix && now() - p.fixAt < POS_FRESH_MS) return RC.haversine(me, p.fix);
    var w = world[p.id];
    return w && w.fix ? RC.haversine(me, w.fix) : null;
  }

  function transmitting() { return on && (holding || openMic); }

  /* Talking, as far as this phone is concerned: the link is up, the flag is
     fresh, and they are close enough to be heard. A rider eighty metres off is
     linked and silent, and lighting their name up would be a voice nobody can
     hear. (Muting does not count: muted, you still see who is talking.) */
  function talkingNow(p, t) {
    return p.state === "open" && p.talking && t - p.talkAt < TALK_FRESH_MS && p.level > 0;
  }

  /* ---------------- links ---------------- */

  function newPeer(id, name, cid, role) {
    var p = {
      id: id, name: name || "Someone", cid: cid, role: role,
      link: null, state: "connecting", startedAt: now(),
      fix: null, fixAt: 0, seenAt: now(), farSince: 0,
      level: 0, dist: null, talking: false, talkAt: 0,
      signalled: false, candOut: [], candTimer: null
    };
    peers[id] = p;
    return p;
  }

  function queueCand(p, c) {
    p.candOut.push(c);
    if (p.signalled && !p.candTimer) p.candTimer = setTimeout(function () { flushCands(p); }, CAND_BATCH_MS);
  }

  function flushCands(p) {
    p.candTimer = null;
    if (peers[p.id] !== p || !p.candOut.length) return;
    RC.pubs.micSignal(p.id, "cand", { c: p.cid, list: p.candOut.splice(0, 20) });
    if (p.candOut.length) p.candTimer = setTimeout(function () { flushCands(p); }, CAND_BATCH_MS);
  }

  function makeLink(p, initiator) {
    p.link = RC.net.link({
      initiator: initiator,
      connectionId: p.cid,
      remote: p.id,
      // The end of the line for this audio, always — even on a phone that is
      // also a ride's host and relaying that room with no buffer at all.
      jitterMs: RC.net.AUDIO_JITTER_MS,
      onCandidate: function (c) { queueCand(p, c); }
    });

    p.link.on("open", function () {
      if (peers[p.id] !== p) return;
      p.state = "open";
      p.seenAt = now();
      // Whatever the engine still holds under this id belongs to a link that
      // has been replaced; the engine's own answer to a second add is no.
      if (engine && engine.linkOf(p.id) && engine.linkOf(p.id) !== p.link) engine.removePeer(p.id);
      if (!engine || !engine.addPeer(p.id, p.link, p.level)) {
        // Data but no audio: a browser that would not negotiate the voice
        // section. A link that can only carry positions is no use here.
        hangUp(p.id, "noaudio");
        return;
      }
      sendPos(p);
      changed(true);
    });

    p.link.on("message", function (m) {
      if (peers[p.id] !== p || !m) return;
      onLinkMessage(p, m);
    });

    p.link.on("close", function () {
      if (peers[p.id] !== p) return;   // already let go of on purpose
      drop(p);
      cool[p.id] = now() + COOL_MS.closed;
      changed(true);
    });
  }

  function dial(id, name) {
    var p = newPeer(id, name, "m" + Math.random().toString(36).slice(2, 12), "dial");
    try { makeLink(p, true); } catch (e) { drop(p); cool[id] = now() + COOL_MS.fail; return; }
    p.link.createOffer().then(function (offer) {
      if (peers[id] !== p) return;
      if (!RC.pubs.micSignal(id, "offer", { c: p.cid, sdp: { type: offer.type, sdp: offer.sdp } })) {
        hangUp(id, "fail");
        return;
      }
      p.signalled = true;
      flushCands(p);
    }, function () {
      if (peers[id] === p) hangUp(id, "fail");
    });
  }

  function answer(from, name, d) {
    var sdp = cleanSdp(d.sdp, "offer");
    var cid = cleanCid(d.c);
    if (!sdp || !cid) return;
    var old = peers[from];
    if (old && old.cid === cid) return;           // the same offer, twice
    if (old) drop(old);                           // they redialled: theirs is newer
    var p = newPeer(from, name, cid, "answer");
    try { makeLink(p, false); } catch (e) { drop(p); return; }
    p.link.acceptOffer(sdp).then(function (ans) {
      if (peers[from] !== p) return;
      RC.pubs.micSignal(from, "answer", { c: cid, sdp: { type: ans.type, sdp: ans.sdp } });
      p.signalled = true;
      flushCands(p);
    }, function () {
      if (peers[from] === p) hangUp(from, "fail");
    });
  }

  /** Let go of a peer without telling anybody: the link, the voice, the
      timers. Everything that ends a peer comes through here. */
  function drop(p) {
    if (peers[p.id] === p) delete peers[p.id];
    clearTimeout(p.candTimer);
    p.candTimer = null;
    if (engine && engine.linkOf(p.id) === p.link) engine.removePeer(p.id);
    if (p.link) { try { p.link.destroy("bye"); } catch (e) {} }
  }

  /** End a peer and say so, by whichever path still reaches them: the link
      itself if it is up, the hub if the link never got that far. */
  function hangUp(id, why) {
    var p = peers[id];
    if (!p) return;
    var told = false;
    if (p.link && p.link.isOpen()) told = p.link.send({ t: "bye", why: why });
    if (!told && p.signalled) RC.pubs.micSignal(id, "bye", { c: p.cid, why: why });
    drop(p);
    cool[id] = now() + (COOL_MS[why] || COOL_MS.bye);
  }

  function refuse(to, cid, why) {
    RC.pubs.micSignal(to, "bye", { c: cid, why: why });
  }

  /* ---------------- the introductions, arriving ---------------- */

  function onSignal(msg) {
    if (!msg || !msg.from) return;
    var d = msg.d || {};
    var cid = cleanCid(d.c);
    if (!cid) return;
    var from = msg.from;

    if (msg.k === "offer") {
      if (!on) { refuse(from, cid, "off"); return; }
      var myId = RC.pubs.myId();
      // Only the lower id dials. An offer from the other side of the rule is a
      // client that disagrees about who we are; answering it could leave the
      // pair with two links.
      if (!myId || !dials(from, myId)) { refuse(from, cid, "rule"); return; }
      var others = Object.keys(peers).filter(function (k) { return k !== from; }).length;
      if (others >= MAX_PEERS) { refuse(from, cid, "full"); return; }
      // The hub has already checked they are near by its own record; ours may
      // be fresher, and a rider who is plainly far away is not answered.
      var me = RC.pubs.myFix();
      var w = worldIndex()[from];
      if (me && w && w.fix && RC.haversine(me, w.fix) > DROP_M) { refuse(from, cid, "far"); return; }
      answer(from, msg.name, d);
      return;
    }

    var p = peers[from];
    if (!p || p.cid !== cid) return;            // about a link we no longer hold

    if (msg.k === "answer") {
      var sdp = cleanSdp(d.sdp, "answer");
      if (!sdp || p.role !== "dial" || p.link.signalingState() !== "have-local-offer") return;
      p.link.acceptAnswer(sdp).then(null, function () {
        if (peers[from] === p) hangUp(from, "fail");
      });
    } else if (msg.k === "cand") {
      cleanCands(d.list).forEach(function (c) { p.link.addCandidate(c); });
    } else if (msg.k === "bye") {
      drop(p);
      var why = String(d.why || "bye");
      cool[from] = now() + (COOL_MS[why] || COOL_MS.bye);
      changed(true);
    }
  }

  /* ---------------- what travels on a link ---------------- */

  function onLinkMessage(p, m) {
    if (m.t === "pos") {
      var fix = cleanPos(m);
      if (fix) { p.fix = fix; p.fixAt = now(); p.seenAt = now(); }
      p.talking = !!m.talk;
      p.talkAt = now();
      level(p);
      changed();
    } else if (m.t === "talk") {
      p.talking = !!m.on;
      p.talkAt = now();
      changed();
    } else if (m.t === "bye") {
      drop(p);
      cool[p.id] = now() + (COOL_MS[String(m.why || "")] || COOL_MS.bye);
      changed(true);
    }
  }

  function sendPos(p) {
    if (!p.link || !p.link.isOpen()) return;
    var me = RC.pubs.myFix();
    var msg = { t: "pos", talk: transmitting() ? 1 : 0 };
    if (me) { msg.lat = round(me.lat); msg.lon = round(me.lon); }
    p.link.send(msg);
  }

  /** The talk flag goes out at once on a change, rather than waiting for the
      next position, because a name lighting up a second late is a second of
      not knowing who said that. */
  function sendTalk() {
    var on2 = transmitting();
    Object.keys(peers).forEach(function (id) {
      var p = peers[id];
      if (p.state === "open" && p.link.isOpen()) p.link.send({ t: "talk", on: on2 });
    });
    changed(true);
  }

  function level(p) {
    var me = RC.pubs.myFix();
    p.dist = distanceTo(p, me, worldIndex());
    p.level = volumeFor(p.dist);
    if (engine && p.state === "open") engine.setPeerVolume(p.id, p.level);
  }

  /* ---------------- the heartbeat ---------------- */

  function tick() {
    if (!on) return;
    if (!RC.pubs.isOn()) { api.stop(); return; }

    var t = now();
    var me = RC.pubs.myFix();
    var myId = RC.pubs.myId();
    var world = worldIndex();

    Object.keys(peers).forEach(function (id) {
      var p = peers[id];
      if (RC.pubs.isBlocked(id)) { hangUp(id, "blocked"); return; }
      if (p.state !== "open" && t - p.startedAt > DIAL_TIMEOUT_MS) { hangUp(id, "fail"); return; }
      if (world[id]) {
        p.seenAt = Math.max(p.seenAt, world[id].fix.at || 0);
        p.name = world[id].name || p.name;
      }
      p.dist = distanceTo(p, me, world);
      if (p.dist == null) {
        if (t - p.seenAt > LOST_MS) { hangUp(id, "far"); return; }
      } else if (p.dist > DROP_M) {
        p.farSince = p.farSince || t;
        if (t - p.farSince > DROP_GRACE_MS) { hangUp(id, "far"); return; }
      } else {
        p.farSince = 0;
      }
      p.level = volumeFor(p.dist);
      if (p.state === "open") {
        if (engine) engine.setPeerVolume(id, p.level);
        sendPos(p);
      }
      if (p.talking && t - p.talkAt > TALK_FRESH_MS) p.talking = false;
    });

    // Introductions need a hub to go through and a position to be near.
    var role = RC.pubs.role();
    if (me && myId && (role === "host" || role === "guest")) {
      var want = wanted(me, RC.pubs.world(), RC.pubs.isBlocked, MAX_PEERS);
      for (var i = 0; i < want.length; i++) {
        var w = want[i];
        if (peers[w.id] || (cool[w.id] && cool[w.id] > t)) continue;
        if (!dials(myId, w.id)) continue;           // theirs to dial, not ours
        if (Object.keys(peers).length >= MAX_PEERS) break;
        dial(w.id, w.name);
      }
    }
    changed();
  }

  /* ---------------- public ---------------- */

  var api = {
    RANGE_M: RANGE_M,
    FULL_M: FULL_M,

    supported: function () { return !!(RC.voice && RC.voice.supported() && RC.net && RC.net.link); },

    /** Switch it on. PUBs has to be on — this is a part of being on the public
        road, not a way onto it — and the microphone is asked for now, while a
        thumb is on the switch, so the permission prompt does not arrive in the
        middle of somebody's first sentence. Refused, it still listens. */
    start: function () {
      if (on) return Promise.resolve(true);
      if (!RC.pubs.isOn()) return Promise.reject(new Error("Go public first."));
      if (!api.supported()) return Promise.reject(new Error("This browser cannot do live voice."));
      engine = engine || RC.voice.create();
      if (!engine.start("guest")) return Promise.reject(new Error("This browser cannot do live voice."));
      engine.warm();
      engine.setMuted(muted);
      engine.onBlocked = function () { notice("Tap anywhere to hear the riders near you.", "warn"); };
      on = true;
      holding = false;
      openMic = false;
      cool = {};
      RC.pubs.setMic(true);
      if (!timer) timer = setInterval(tick, TICK_MS);
      tick();
      changed(true);
      return engine.prime().then(function (ok) {
        if (!on) return false;
        if (!ok) notice("No microphone — you can hear riders near you, not talk to them.", "warn");
        // Primed, not open: the gate is shut, and the idle timer will let the
        // device go if the button is not pressed for a while.
        if (!transmitting()) engine.setTransmit(false);
        return true;
      });
    },

    /** Switch it off. Everyone linked is told, the microphone is let go, and
        the area stops being told the mic is on. */
    stop: function () {
      if (!on) return false;
      on = false;
      holding = false;
      openMic = false;
      Object.keys(peers).forEach(function (id) { hangUp(id, "off"); });
      peers = {};
      clearInterval(timer);
      timer = null;
      if (engine) {
        engine.onBlocked = null;
        try { engine.setTransmit(false); } catch (e) {}
        try { engine.stop(); } catch (e) {}
      }
      if (RC.pubs.isOn()) RC.pubs.setMic(false);
      changed(true);
      return true;
    },

    isOn: function () { return on; },

    /** Push to talk. Resolves once the microphone is actually open. */
    talk: function (down) {
      if (!on) return Promise.resolve(false);
      if (!down) {
        if (!holding) return Promise.resolve(true);
        holding = false;
        // Open mic outranks the button: letting go must not close it.
        if (!openMic) engine.setTransmit(false);
        sendTalk();
        return Promise.resolve(true);
      }
      if (holding) return Promise.resolve(true);
      holding = true;
      sendTalk();
      return engine.setTransmit(true).then(function () {
        return true;
      }, function (err) {
        holding = false;
        sendTalk();
        notice(err && err.message ? err.message : "Could not open the microphone.", "warn");
        return false;
      });
    },

    /** Hands-free: the gate stays open. Opus DTX makes a quiet open mic close
        to free, so this costs a link almost nothing until somebody speaks. */
    setOpenMic: function (v) {
      if (!on) return Promise.resolve(false);
      v = !!v;
      if (v === openMic) return Promise.resolve(true);
      openMic = v;
      sendTalk();
      if (!v) {
        if (!holding) engine.setTransmit(false);
        return Promise.resolve(true);
      }
      return engine.setTransmit(true).then(function () { return true; }, function (err) {
        openMic = false;
        sendTalk();
        notice(err && err.message ? err.message : "Could not open the microphone.", "warn");
        return false;
      });
    },

    /** Stop hearing them. You still send; the far ends are not told. */
    setMuted: function (v) {
      muted = !!v;
      if (engine && on) engine.setMuted(muted);
      changed(true);
      return true;
    },

    /** Run the heartbeat now — after an Ignore, so the link goes with the
        marker instead of a second later. */
    refresh: function () { tick(); },

    /** One rider, as the map wants to draw them: are we linked, how loud, are
        they talking. Null for anybody we are not linked to. */
    peerState: function (id) {
      var p = peers[String(id || "")];
      if (!p) return null;
      return { state: p.state, level: p.level, dist: p.dist, talking: talkingNow(p, now()) };
    },

    snapshot: function () {
      var t = now();
      var near = Object.keys(peers).map(function (id) {
        var p = peers[id];
        return {
          id: id, name: p.name, state: p.state, level: p.level, dist: p.dist,
          talking: talkingNow(p, t)
        };
      }).sort(function (a, b) {
        return (a.dist == null ? Infinity : a.dist) - (b.dist == null ? Infinity : b.dist);
      });
      return {
        on: on,
        open: openMic,
        talking: transmitting(),
        muted: muted,
        near: near,
        // In earshot: linked, and close enough to hear and be heard.
        audible: near.filter(function (n) { return n.state === "open" && n.level > 0; }).length
      };
    },

    /* Exposed for the harness: the parts with no browser in them. */
    _volume: volumeFor,
    _want: wanted,
    _dials: dials,
    _clean: { pos: cleanPos, sdp: cleanSdp, cands: cleanCands, cid: cleanCid },

    onChange: null,
    onNotice: null
  };

  if (RC.pubs) RC.pubs.onMic = onSignal;

  return api;
})();

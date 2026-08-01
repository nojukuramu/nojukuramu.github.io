/* peer.js — WebRTC data channels over a public signalling rendezvous.
 *
 * There is no backend here. GitHub Pages serves static files, so the only thing
 * missing for peer-to-peer is a "meeting point": somewhere two browsers can
 * swap SDP offers/answers before they talk directly. We borrow the public
 * PeerJS broker for exactly that and nothing else — it relays a handful of JSON
 * messages keyed by peer id, then gets out of the way. No PeerJS library: the
 * broker protocol is ~40 lines of WebSocket, implemented below.
 *
 * The room code *is* the host's peer id (kn-<code>), so a guest needs no
 * out-of-band exchange: type the code, find the host.
 *
 * Robustness comes from redundancy at every layer:
 *   - the host registers on every broker at once; a guest tries them in turn
 *   - ICE uses several STUN servers plus a public TURN relay for hard NATs
 *   - data channels are heartbeated and torn down on silence
 *   - guests reconnect with exponential backoff + jitter, and flush the
 *     commands they queued while offline
 */
(function (global) {
  "use strict";

  var KN = (global.KN = global.KN || {});

  /* ---------------- configuration ---------------- */

  // Public PeerJS-protocol brokers. Order matters: first is tried first.
  // `window.KN_BROKERS` overrides the list — the end-to-end test in tools/
  // points it at a local stand-in so the suite never depends on a public host.
  var BROKERS = global.KN_BROKERS || [
    { host: "0.peerjs.com", port: 443, path: "/", key: "peerjs" },
    { host: "peerjs.92k.de", port: 443, path: "/", key: "peerjs" }
  ];

  var ICE = {
    iceServers: [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
      { urls: ["stun:stun.cloudflare.com:3478"] },
      {
        urls: [
          "turn:openrelay.metered.ca:80",
          "turn:openrelay.metered.ca:443",
          "turns:openrelay.metered.ca:443?transport=tcp"
        ],
        username: "openrelayproject",
        credential: "openrelayproject"
      }
    ],
    iceCandidatePoolSize: 2
  };

  var HEARTBEAT_MS = 5000;      // broker keep-alive + data-channel ping
  var SILENCE_MS = 20000;       // no pong for this long => assume dead
  var OFFER_TIMEOUT_MS = 12000; // per-broker join attempt

  /* ---------------- small helpers ---------------- */

  function randomBytes(n) {
    var buf = new Uint8Array(n);
    if (global.crypto && global.crypto.getRandomValues) global.crypto.getRandomValues(buf);
    else for (var i = 0; i < n; i++) buf[i] = Math.floor(Math.random() * 256);
    return buf;
  }

  function pick(alphabet, n) {
    var buf = randomBytes(n);
    var out = "";
    for (var i = 0; i < n; i++) out += alphabet[buf[i] % alphabet.length];
    return out;
  }

  function rid(n) { return pick("abcdefghijklmnopqrstuvwxyz0123456789", n); }

  /** Room codes drop I/O/0/1 so they survive being read aloud or typed. */
  var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  function makeCode() { return pick(CODE_ALPHABET, 6); }

  function normalizeCode(s) {
    return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  }

  function peerIdFor(code) {
    return "kn-" + normalizeCode(code).toLowerCase();
  }

  function emitter(obj) {
    var map = {};
    obj.on = function (name, fn) {
      (map[name] = map[name] || []).push(fn);
      return obj;
    };
    obj.off = function (name, fn) {
      map[name] = (map[name] || []).filter(function (f) { return f !== fn; });
      return obj;
    };
    obj.emit = function (name) {
      var args = [].slice.call(arguments, 1);
      (map[name] || []).slice().forEach(function (fn) {
        try { fn.apply(null, args); } catch (e) { console.error("[kn] handler", name, e); }
      });
    };
    return obj;
  }

  /* ---------------- broker socket ----------------
   * Speaks the PeerServer wire protocol: connect with ?key&id&token, wait for
   * OPEN, then exchange {type, src, dst, payload} envelopes. Everything the
   * broker sees is signalling — media and app data never touch it.
   */
  function Broker(cfg, id, token) {
    var self = emitter({});
    var ws = null;
    var hb = null;
    var closed = false;
    var retry = 0;

    self.cfg = cfg;
    self.id = id;
    self.open = false;

    function url() {
      var scheme = cfg.port === 443 ? "wss" : "ws";
      var p = cfg.path === "/" ? "/" : cfg.path;
      return (
        scheme + "://" + cfg.host + ":" + cfg.port + p + "peerjs" +
        "?key=" + encodeURIComponent(cfg.key) +
        "&id=" + encodeURIComponent(id) +
        "&token=" + encodeURIComponent(token)
      );
    }

    function beat() {
      clearInterval(hb);
      hb = setInterval(function () {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "HEARTBEAT" }));
      }, HEARTBEAT_MS);
    }

    function connect() {
      if (closed) return;
      var sock;
      try {
        sock = new WebSocket(url());
      } catch (e) {
        return schedule();
      }
      ws = sock;

      sock.onopen = function () { /* wait for OPEN before declaring ready */ };

      sock.onmessage = function (ev) {
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        switch (msg.type) {
          case "OPEN":
            self.open = true;
            retry = 0;
            beat();
            self.emit("open");
            break;
          case "ID-TAKEN":
            self.emit("id-taken");
            self.close();
            break;
          case "ERROR":
            self.emit("error", (msg.payload && msg.payload.msg) || "broker error");
            break;
          default:
            self.emit("message", msg);
        }
      };

      sock.onclose = function () {
        self.open = false;
        clearInterval(hb);
        if (!closed) { self.emit("down"); schedule(); }
      };

      sock.onerror = function () { /* onclose follows */ };
    }

    function schedule() {
      if (closed) return;
      retry++;
      var wait = Math.min(30000, 800 * Math.pow(1.8, retry - 1));
      wait += Math.random() * 500; // jitter, so many clients don't sync up
      setTimeout(connect, wait);
    }

    self.send = function (type, dst, payload) {
      if (!ws || ws.readyState !== 1) return false;
      ws.send(JSON.stringify({ type: type, dst: dst, payload: payload }));
      return true;
    };

    self.close = function () {
      closed = true;
      clearInterval(hb);
      if (ws) { try { ws.close(); } catch (e) { /* already gone */ } }
      ws = null;
      self.open = false;
    };

    connect();
    return self;
  }

  /* ---------------- one peer-to-peer link ----------------
   * Wraps RTCPeerConnection + a single reliable data channel, plus the
   * bookkeeping WebRTC leaves to you: buffering ICE candidates that arrive
   * before the remote description, and noticing a channel that has gone quiet.
   */
  function Link(opts) {
    var self = emitter({});
    var pc = new RTCPeerConnection(ICE);
    var dc = null;
    var pending = [];      // ICE candidates received before setRemoteDescription
    var remoteSet = false;
    var lastSeen = Date.now();
    var watchdog = null;
    var dead = false;

    self.id = opts.connectionId;
    self.remote = opts.remote;
    self.pc = pc;

    function attach(channel) {
      dc = channel;
      dc.onopen = function () {
        lastSeen = Date.now();
        startWatchdog();
        self.emit("open");
      };
      dc.onclose = function () { self.destroy("closed"); };
      dc.onerror = function () { /* onclose follows */ };
      dc.onmessage = function (ev) {
        lastSeen = Date.now();
        var data;
        try { data = JSON.parse(ev.data); } catch (e) { return; }
        if (data.t === "__ping") { self.raw({ t: "__pong", n: data.n }); return; }
        if (data.t === "__pong") return;
        self.emit("message", data);
      };
    }

    function startWatchdog() {
      clearInterval(watchdog);
      var n = 0;
      watchdog = setInterval(function () {
        if (dead) return;
        self.raw({ t: "__ping", n: ++n });
        if (Date.now() - lastSeen > SILENCE_MS) self.destroy("timeout");
      }, HEARTBEAT_MS);
    }

    pc.onicecandidate = function (ev) {
      if (ev.candidate) opts.onCandidate(ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate);
    };

    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "failed") self.destroy("ice-failed");
    };

    if (opts.initiator) {
      attach(pc.createDataChannel("kn", { ordered: true }));
    } else {
      pc.ondatachannel = function (ev) { attach(ev.channel); };
    }

    self.createOffer = function () {
      return pc
        .createOffer()
        .then(function (offer) { return pc.setLocalDescription(offer); })
        .then(function () { return waitForIce(); })
        .then(function () { return pc.localDescription; });
    };

    self.acceptOffer = function (sdp) {
      return pc
        .setRemoteDescription(new RTCSessionDescription(sdp))
        .then(function () { remoteSet = true; drain(); return pc.createAnswer(); })
        .then(function (answer) { return pc.setLocalDescription(answer); })
        .then(function () { return waitForIce(); })
        .then(function () { return pc.localDescription; });
    };

    self.acceptAnswer = function (sdp) {
      return pc.setRemoteDescription(new RTCSessionDescription(sdp)).then(function () {
        remoteSet = true;
        drain();
      });
    };

    self.addCandidate = function (cand) {
      if (!remoteSet) { pending.push(cand); return; }
      pc.addIceCandidate(new RTCIceCandidate(cand)).catch(function () { /* stale candidate */ });
    };

    function drain() {
      pending.splice(0).forEach(self.addCandidate);
    }

    /* Trickle ICE would be faster, but half of the public brokers drop
     * messages under load. Waiting briefly for a usable candidate set and
     * sending one complete description is markedly more reliable. */
    function waitForIce() {
      if (pc.iceGatheringState === "complete") return Promise.resolve();
      return new Promise(function (resolve) {
        var done = false;
        function finish() {
          if (done) return;
          done = true;
          pc.removeEventListener("icegatheringstatechange", check);
          resolve();
        }
        function check() { if (pc.iceGatheringState === "complete") finish(); }
        pc.addEventListener("icegatheringstatechange", check);
        setTimeout(finish, 2500);
      });
    }

    self.raw = function (obj) {
      if (!dc || dc.readyState !== "open") return false;
      try { dc.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    };

    self.send = function (obj) { return self.raw(obj); };

    self.isOpen = function () { return !!dc && dc.readyState === "open"; };

    self.destroy = function (reason) {
      if (dead) return;
      dead = true;
      clearInterval(watchdog);
      try { if (dc) dc.close(); } catch (e) { /* ignore */ }
      try { pc.close(); } catch (e) { /* ignore */ }
      self.emit("close", reason || "closed");
    };

    return self;
  }

  /* ---------------- host side ----------------
   * Registers `kn-<code>` on every broker simultaneously, so a guest that can
   * only reach one of them still finds the room.
   */
  function host(code, opts) {
    opts = opts || {};
    var self = emitter({});
    var id = peerIdFor(code);
    // Reusing the token across reloads lets the broker recognise a returning
    // host and hand back the same id instead of reporting it as taken.
    var token = opts.token || rid(12);
    var links = {};          // connectionId -> Link
    var brokers = [];
    var taken = {};
    var stopped = false;

    self.code = normalizeCode(code);
    self.peerId = id;
    self.token = token;

    BROKERS.forEach(function (cfg) {
      var b = Broker(cfg, id, token);
      brokers.push(b);

      b.on("open", function () { delete taken[cfg.host]; self.emit("broker", { host: cfg.host, up: true }); });
      b.on("down", function () { self.emit("broker", { host: cfg.host, up: false }); });
      b.on("id-taken", function () {
        // One broker refusing the id is survivable — guests will find us on
        // another. Only a clean sweep means the code is genuinely in use.
        taken[cfg.host] = true;
        self.emit("broker", { host: cfg.host, up: false });
        if (Object.keys(taken).length >= BROKERS.length) self.emit("code-taken");
      });
      b.on("message", function (msg) { onSignal(b, msg); });
    });

    function onSignal(broker, msg) {
      var p = msg.payload || {};
      var cid = p.connectionId;
      if (!cid) return;

      if (msg.type === "OFFER") {
        // A rejoining guest reuses its connection id; drop the stale link.
        if (links[cid]) links[cid].destroy("replaced");

        var link = Link({
          initiator: false,
          connectionId: cid,
          remote: msg.src,
          onCandidate: function (c) {
            broker.send("CANDIDATE", msg.src, { candidate: c, connectionId: cid, type: "data" });
          }
        });
        links[cid] = link;

        link.on("open", function () { self.emit("guest-open", link); });
        link.on("message", function (data) { self.emit("guest-message", link, data); });
        link.on("close", function (reason) {
          if (links[cid] === link) delete links[cid];
          self.emit("guest-close", link, reason);
        });

        link
          .acceptOffer(p.sdp)
          .then(function (answer) {
            broker.send("ANSWER", msg.src, {
              sdp: { type: answer.type, sdp: answer.sdp },
              connectionId: cid,
              type: "data"
            });
          })
          .catch(function (e) {
            console.warn("[kn] answer failed", e);
            link.destroy("answer-failed");
          });
      } else if (msg.type === "CANDIDATE") {
        if (links[cid] && p.candidate) links[cid].addCandidate(p.candidate);
      }
    }

    self.broadcast = function (obj) {
      Object.keys(links).forEach(function (k) { links[k].send(obj); });
    };

    self.guests = function () {
      return Object.keys(links).map(function (k) { return links[k]; });
    };

    self.onlineBrokers = function () {
      return brokers.filter(function (b) { return b.open; }).length;
    };

    self.stop = function () {
      if (stopped) return;
      stopped = true;
      brokers.forEach(function (b) { b.close(); });
      Object.keys(links).forEach(function (k) { links[k].destroy("host-stopped"); });
      links = {};
    };

    if (opts.on) {
      Object.keys(opts.on).forEach(function (k) { self.on(k, opts.on[k]); });
    }
    return self;
  }

  /* ---------------- guest side ----------------
   * Walks the broker list until one of them can reach the host, then keeps the
   * link alive: any close reconnects with backoff, and commands issued while
   * offline are queued and flushed on the next open channel.
   */
  function join(code, handlers) {
    var self = emitter({});
    var target = peerIdFor(code);
    var connectionId = "kn_" + rid(10);   // stable across reconnects
    var link = null;
    var broker = null;
    var attempt = 0;
    var stopped = false;
    var outbox = [];
    var brokerIndex = 0;

    self.code = normalizeCode(code);
    self.state = "connecting";

    function setState(s, detail) {
      self.state = s;
      self.emit("state", s, detail);
    }

    function cleanup() {
      if (link) { link.destroy("retry"); link = null; }
      if (broker) { broker.close(); broker = null; }
    }

    function tryBroker() {
      if (stopped) return;
      var cfg = BROKERS[brokerIndex % BROKERS.length];
      setState("connecting", cfg.host);

      var myId = "knc-" + rid(10);
      var b = Broker(cfg, myId, rid(12));
      broker = b;

      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        fail("timeout");
      }, OFFER_TIMEOUT_MS);

      function fail(why) {
        clearTimeout(timer);
        cleanup();
        brokerIndex++;
        attempt++;
        var wait = Math.min(15000, 700 * Math.pow(1.7, Math.min(attempt, 6))) + Math.random() * 400;
        setState("retrying", why);
        setTimeout(tryBroker, wait);
      }

      b.on("open", function () {
        var l = Link({
          initiator: true,
          connectionId: connectionId,
          remote: target,
          onCandidate: function (c) {
            b.send("CANDIDATE", target, { candidate: c, connectionId: connectionId, type: "data" });
          }
        });
        link = l;

        l.on("open", function () {
          if (!settled) { settled = true; clearTimeout(timer); }
          attempt = 0;
          setState("connected", cfg.host);
          self.emit("open");
          outbox.splice(0).forEach(function (m) { l.send(m); });
        });
        l.on("message", function (data) { self.emit("message", data); });
        l.on("close", function (reason) {
          if (link !== l) return;
          link = null;
          if (stopped) return;
          self.emit("closed", reason);
          settled = true;      // the attempt itself succeeded; this is a drop
          clearTimeout(timer);
          fail(reason);
        });

        l.createOffer()
          .then(function (offer) {
            b.send("OFFER", target, {
              sdp: { type: offer.type, sdp: offer.sdp },
              connectionId: connectionId,
              type: "data",
              label: "kn",
              reliable: true,
              serialization: "json",
              browser: "kn"
            });
          })
          .catch(function () { if (!settled) { settled = true; fail("offer-failed"); } });
      });

      b.on("message", function (msg) {
        var p = msg.payload || {};
        if (msg.type === "ANSWER" && link && p.connectionId === connectionId) {
          link.acceptAnswer(p.sdp).catch(function () { /* renegotiation race */ });
        } else if (msg.type === "CANDIDATE" && link && p.connectionId === connectionId) {
          if (p.candidate) link.addCandidate(p.candidate);
        } else if (msg.type === "EXPIRE" || msg.type === "LEAVE") {
          // The broker knows nothing about this room id — look elsewhere.
          if (!settled) { settled = true; fail("no-host"); }
        }
      });

      b.on("id-taken", function () { if (!settled) { settled = true; fail("id-taken"); } });
    }

    self.send = function (obj) {
      if (link && link.isOpen()) return link.send(obj);
      outbox.push(obj);
      if (outbox.length > 50) outbox.shift();
      return false;
    };

    self.isOpen = function () { return !!link && link.isOpen(); };

    self.retryNow = function () {
      if (stopped || self.state === "connected") return;
      attempt = 0;
      cleanup();
      tryBroker();
    };

    // A phone that was asleep comes back holding a dead socket it does not know
    // is dead. Nudge it the moment the tab is visible or the network returns.
    function onOnline() { self.retryNow(); }
    function onVisible() { if (!document.hidden && !self.isOpen()) self.retryNow(); }

    self.stop = function () {
      stopped = true;
      cleanup();
      global.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      setState("stopped");
    };

    if (handlers) {
      Object.keys(handlers).forEach(function (k) { self.on(k, handlers[k]); });
    }

    tryBroker();
    global.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);

    return self;
  }

  KN.net = {
    host: host,
    join: join,
    makeCode: makeCode,
    normalizeCode: normalizeCode,
    peerIdFor: peerIdFor,
    BROKERS: BROKERS
  };
})(typeof window !== "undefined" ? window : globalThis);

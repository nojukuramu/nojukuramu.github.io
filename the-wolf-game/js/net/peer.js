/* peer.js — WebRTC data channels over a public signalling rendezvous.
 *
 * Lifted wholesale from KaraokeNatin, where it has already survived a room full
 * of phones going into pockets mid-song. Only the namespace changed (KN -> WG)
 * and the peer-id prefix (kn- -> wg-), so the two apps cannot collide on a
 * broker. Everything below is the same battle-tested transport.
 *
 * There is no backend here. GitHub Pages serves static files, so the only thing
 * missing for peer-to-peer is a "meeting point": somewhere two browsers can
 * swap SDP offers/answers before they talk directly. We borrow the public
 * PeerJS broker for exactly that and nothing else — it relays a handful of JSON
 * messages keyed by peer id, then gets out of the way. No PeerJS library: the
 * broker protocol is ~40 lines of WebSocket, implemented below.
 *
 * The room code *is* the host's peer id (wg-<code>), so a guest needs no
 * out-of-band exchange: type the code, find the host.
 *
 * Robustness comes from redundancy at every layer:
 *   - the host registers on every broker at once; a guest tries them in turn
 *   - ICE uses several STUN servers plus a public TURN relay for hard NATs
 *   - data channels are heartbeated, and *probed* rather than assumed dead
 *   - one attempt is in flight at a time, so a wake-up never starts a stampede
 *   - both roles wake on visibility, network, bfcache restore and clock gaps
 *   - guests reconnect with exponential backoff + jitter, and flush the
 *     commands they queued while offline
 *
 * The hard case this is built around is a phone that was put away mid-song.
 * Everything about that moment is a lie: the socket still says "open", the
 * timers that would have noticed did not run, and the browser reports nothing.
 * So on every wake-up we re-establish the truth by asking — a probe down the
 * channel, a liveness check on the signalling socket — instead of trusting
 * state that was frozen along with the page.
 */
(function (global) {
  "use strict";

  var WG = (global.WG = global.WG || {});

  /* ---------------- configuration ---------------- */

  // Public PeerJS-protocol brokers. Order matters: first is tried first.
  // `window.WG_BROKERS` overrides the list — the end-to-end test in tools/
  // points it at a local stand-in so the suite never depends on a public host.
  var BROKERS = global.WG_BROKERS || [
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

  var HEARTBEAT_MS = 5000;        // broker keep-alive + data-channel ping
  var SILENCE_MS = 20000;         // no traffic for this long => assume dead
  var PROBE_MS = 2500;            // a wake-up probe waits this long for a pong
  var ICE_GRACE_MS = 8000;        // "disconnected" often heals; give it a moment
  var OFFER_TIMEOUT_MS = 12000;   // per-attempt ceiling for reaching the host
  var ANSWER_OPEN_MS = 8000;      // answer accepted but channel never opened
  var SOCKET_STALE_MS = 25000;    // signalling socket idle this long => recycle
  var TIMESKIP_MS = 8000;         // clock jump that means the machine slept
  var SOFT_REOFFERS = 3;          // re-asks on one broker before moving on
  var ID_TAKEN_ROUNDS = 3;        // sweeps before a host surrenders its code

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
    return "wg-" + normalizeCode(code).toLowerCase();
  }

  function hidden() {
    return typeof document !== "undefined" && document.hidden;
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
        try { fn.apply(null, args); } catch (e) { console.error("[wg] handler", name, e); }
      });
    };
    return obj;
  }

  /* ---------------- the wake bus ----------------
   * Every way a browser can tell us "you were away and now you are back",
   * collapsed into one signal that both roles subscribe to.
   *
   * `visibilitychange` covers a backgrounded tab, `pageshow` a bfcache restore
   * (iOS Safari, where nothing else fires), `online` a network that returned.
   * The clock-gap check covers the case none of those do: a laptop that slept
   * with this tab in front, where the page never lost focus and every timer in
   * it simply stopped for twenty minutes.
   *
   * Wakes are debounced, because `focus` alone would otherwise fire on every
   * click back into the window.
   */
  var wakeBus = (function () {
    var subs = [];
    var started = false;
    var last = 0;

    function fire(reason, force) {
      var now = Date.now();
      if (!force && now - last < 2000) return;
      last = now;
      subs.slice().forEach(function (fn) {
        try { fn(reason); } catch (e) { console.error("[wg] wake", e); }
      });
    }

    function start() {
      if (started) return;
      started = true;

      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", function () {
          if (!document.hidden) fire("visible", true);
        });
        // Cordova/WebView lifecycle, harmless where it never fires.
        document.addEventListener("resume", function () { fire("resume", true); });
      }
      if (global.addEventListener) {
        global.addEventListener("online", function () { fire("online", true); });
        global.addEventListener("pageshow", function (e) {
          fire(e && e.persisted ? "bfcache" : "pageshow", true);
        });
        global.addEventListener("focus", function () { fire("focus"); });
      }

      var tick = Date.now();
      setInterval(function () {
        var now = Date.now();
        var gap = now - tick;
        tick = now;
        // A hidden tab has its timers throttled to about once a minute, so a
        // gap there proves nothing. Only trust this while we are on screen.
        if (gap > TIMESKIP_MS && !hidden()) fire("timeskip", true);
      }, 1000);
    }

    return {
      on: function (fn) {
        start();
        subs.push(fn);
        return function () {
          subs = subs.filter(function (f) { return f !== fn; });
        };
      }
    };
  })();

  /* ---------------- broker socket ----------------
   * Speaks the PeerServer wire protocol: connect with ?key&id&token, wait for
   * OPEN, then exchange {type, src, dst, payload} envelopes. Everything the
   * broker sees is signalling — media and app data never touch it.
   *
   * Reconnection is the socket's own business: one timer, always cancellable,
   * and a `check()` the owner calls on wake-up to recycle a socket that says
   * "open" but has been asleep in a pocket for ten minutes.
   */
  function Broker(cfg, idSource, token) {
    var self = emitter({});
    var ws = null;
    var hb = null;
    var timer = null;
    var closed = false;
    var retry = 0;
    var lastActivity = 0;
    var idTaken = 0;

    self.cfg = cfg;
    self.open = false;
    self.id = typeof idSource === "function" ? null : idSource;

    function url(id) {
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
        if (ws && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: "HEARTBEAT" }));
          lastActivity = Date.now();
        }
      }, HEARTBEAT_MS);
    }

    function drop() {
      clearInterval(hb);
      if (ws) {
        ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
        try { ws.close(); } catch (e) { /* already gone */ }
      }
      ws = null;
      self.open = false;
    }

    function connect() {
      if (closed) return;
      clearTimeout(timer);
      timer = null;

      self.id = typeof idSource === "function" ? idSource() : idSource;

      var sock;
      try {
        sock = new WebSocket(url(self.id));
      } catch (e) {
        return schedule();
      }
      ws = sock;
      lastActivity = Date.now();

      sock.onopen = function () { lastActivity = Date.now(); };

      sock.onmessage = function (ev) {
        if (sock !== ws) return;
        lastActivity = Date.now();
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        switch (msg.type) {
          case "OPEN":
            self.open = true;
            retry = 0;
            idTaken = 0;
            beat();
            self.emit("open");
            break;
          case "ID-TAKEN":
            // Almost always our own registration from a second ago: the server
            // has not reaped the socket we just lost. Retrying with the same
            // token gets the id back. Only a caller counting rounds can tell
            // that apart from someone else genuinely holding the id.
            idTaken++;
            self.emit("id-taken", idTaken);
            drop();
            schedule(Math.min(20000, 1500 * Math.pow(1.8, idTaken - 1)));
            break;
          case "ERROR":
            self.emit("error", (msg.payload && msg.payload.msg) || "broker error");
            break;
          default:
            self.emit("message", msg);
        }
      };

      sock.onclose = function () {
        if (sock !== ws) return;
        var was = self.open;
        drop();
        if (closed) return;
        if (was) self.emit("down");
        schedule();
      };

      sock.onerror = function () { /* onclose follows */ };
    }

    function schedule(fixed) {
      if (closed || timer) return;
      retry++;
      var wait = fixed != null
        ? fixed
        : Math.min(20000, 700 * Math.pow(1.8, Math.min(retry, 6) - 1));
      // While we are on screen someone is watching the badge; do not make them
      // wait out a backoff that was earned while the phone was in a pocket.
      if (!hidden()) wait = Math.min(wait, 6000);
      wait += Math.random() * 400; // jitter, so many clients don't sync up
      timer = setTimeout(function () { timer = null; connect(); }, wait);
    }

    /** Reconnect right now, backoff forgiven. */
    self.retryNow = function () {
      if (closed) return;
      clearTimeout(timer);
      timer = null;
      retry = 0;
      drop();
      connect();
    };

    /**
     * Called on every wake-up. A socket that has not carried a byte since
     * before the nap is assumed dead however cheerful `readyState` looks —
     * checking costs one WebSocket handshake, being wrong costs the room.
     */
    self.check = function () {
      if (closed) return;
      if (!ws || ws.readyState > 1) { self.retryNow(); return; }
      if (Date.now() - lastActivity > SOCKET_STALE_MS) { self.retryNow(); return; }
      if (!self.open && !timer) self.retryNow();
    };

    self.send = function (type, dst, payload) {
      if (!ws || ws.readyState !== 1) return false;
      ws.send(JSON.stringify({ type: type, dst: dst, payload: payload }));
      lastActivity = Date.now();
      return true;
    };

    self.isOpen = function () { return self.open && !!ws && ws.readyState === 1; };

    self.close = function () {
      closed = true;
      clearTimeout(timer);
      timer = null;
      drop();
    };

    connect();
    return self;
  }

  /* ---------------- one peer-to-peer link ----------------
   * Wraps RTCPeerConnection + a single reliable data channel, plus the
   * bookkeeping WebRTC leaves to you: buffering ICE candidates that arrive
   * before the remote description, and telling a quiet channel from a dead one.
   */
  function Link(opts) {
    var self = emitter({});
    var pc = new RTCPeerConnection(ICE);
    var dc = null;
    var pending = [];      // ICE candidates received before setRemoteDescription
    var remoteSet = false;
    var lastSeen = Date.now();
    var watchdog = null;
    var iceGrace = null;
    var dead = false;
    var pingSeq = 0;
    var probes = {};       // probe id -> resolve

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
        if (data.t === "__pong") {
          var waiting = probes[data.n];
          if (waiting) { delete probes[data.n]; waiting(true); }
          return;
        }
        self.emit("message", data);
      };
    }

    /**
     * Ask the far end to say something, now. This is the only honest way to
     * know a channel is alive after the page was frozen: every local signal
     * (readyState, ICE state, time since last message) was frozen with it.
     */
    self.probe = function (ms) {
      return new Promise(function (resolve) {
        if (dead || !self.isOpen()) return resolve(false);
        var n = "p" + (++pingSeq);
        var settled = false;
        function finish(ok) {
          if (settled) return;
          settled = true;
          delete probes[n];
          resolve(ok);
        }
        probes[n] = function () { finish(true); };
        if (!self.raw({ t: "__ping", n: n })) return finish(false);
        var sentAt = Date.now();
        setTimeout(function () {
          // Any traffic at all counts as alive — a snapshot landing mid-probe
          // is better evidence than the pong we were waiting for.
          finish(lastSeen > sentAt);
        }, ms || PROBE_MS);
      });
    };

    /* A chained timeout rather than an interval, so the tick can see how long
     * it was actually away. Twenty seconds of silence means death; twenty
     * seconds of *not running* means nothing at all, and killing a good link
     * on that evidence is how a returning phone ends up rebuilding a channel
     * that was fine. */
    function startWatchdog() {
      stopWatchdog();
      var last = Date.now();
      function tick() {
        if (dead) return;
        var now = Date.now();
        var gap = now - last;
        last = now;
        if (gap > HEARTBEAT_MS * 4) {
          lastSeen = now;
          self.probe(PROBE_MS).then(function (alive) {
            if (!alive && !dead) self.destroy("stale");
          });
        } else {
          self.raw({ t: "__ping", n: ++pingSeq });
          if (now - lastSeen > SILENCE_MS) { self.destroy("timeout"); return; }
        }
        watchdog = setTimeout(tick, HEARTBEAT_MS);
      }
      watchdog = setTimeout(tick, HEARTBEAT_MS);
    }

    function stopWatchdog() { clearTimeout(watchdog); watchdog = null; }

    pc.onicecandidate = function (ev) {
      if (ev.candidate) opts.onCandidate(ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate);
    };

    pc.onconnectionstatechange = function () {
      if (pc.connectionState === "failed") self.destroy("ice-failed");
    };

    /* "disconnected" is routinely transient — a Wi-Fi handover, a few lost
     * packets — and heals itself. Only a stretch of it is a real loss. */
    pc.oniceconnectionstatechange = function () {
      var s = pc.iceConnectionState;
      clearTimeout(iceGrace);
      if (s === "disconnected") {
        iceGrace = setTimeout(function () {
          if (!dead && pc.iceConnectionState === "disconnected") self.destroy("ice-disconnected");
        }, ICE_GRACE_MS);
      } else if (s === "failed") {
        self.destroy("ice-failed");
      }
    };

    if (opts.initiator) {
      attach(pc.createDataChannel("wg", { ordered: true }));
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

    self.signalingState = function () { return pc.signalingState; };

    self.addCandidate = function (cand) {
      if (!remoteSet) { pending.push(cand); return; }
      pc.addIceCandidate(new RTCIceCandidate(cand)).catch(function () { /* stale candidate */ });
    };

    function drain() {
      pending.splice(0).forEach(self.addCandidate);
    }

    /* Candidates are trickled through the broker as they arrive, but half of
     * the public brokers drop messages under load — so the description also
     * carries everything gathered by the time it is sent. Waiting for the full
     * set is the reliable path; waiting for it *forever* is not, hence the
     * early exit once we hold something usable. */
    function waitForIce() {
      if (pc.iceGatheringState === "complete") return Promise.resolve();
      return new Promise(function (resolve) {
        var done = false;
        var got = 0;
        function finish() {
          if (done) return;
          done = true;
          pc.removeEventListener("icegatheringstatechange", check);
          pc.removeEventListener("icecandidate", count);
          clearTimeout(early);
          clearTimeout(hard);
          resolve();
        }
        function check() { if (pc.iceGatheringState === "complete") finish(); }
        function count(ev) { if (ev.candidate) got++; }
        pc.addEventListener("icegatheringstatechange", check);
        pc.addEventListener("icecandidate", count);
        var early = setTimeout(function () { if (got > 0) finish(); }, 1200);
        var hard = setTimeout(finish, 2500);
      });
    }

    self.raw = function (obj) {
      if (!dc || dc.readyState !== "open") return false;
      try { dc.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
    };

    self.send = function (obj) { return self.raw(obj); };

    self.isOpen = function () { return !dead && !!dc && dc.readyState === "open"; };

    self.destroy = function (reason) {
      if (dead) return;
      dead = true;
      stopWatchdog();
      clearTimeout(iceGrace);
      Object.keys(probes).forEach(function (k) {
        var fn = probes[k];
        delete probes[k];
        fn(false);
      });
      try { if (dc) dc.close(); } catch (e) { /* ignore */ }
      try { pc.close(); } catch (e) { /* ignore */ }
      self.emit("close", reason || "closed");
    };

    return self;
  }

  /* ---------------- host side ----------------
   * Registers `wg-<code>` on every broker simultaneously, so a guest that can
   * only reach one of them still finds the room. The host is the thing guests
   * are looking *for*, so its own recovery matters most: a laptop that slept
   * has to be back on the brokers before anyone can find it again.
   */
  function host(code, opts) {
    opts = opts || {};
    var self = emitter({});
    var id = peerIdFor(code);
    // Reusing the token across reloads lets the broker recognise a returning
    // host and hand back the same id instead of reporting it as taken.
    var token = opts.token || rid(12);
    var links = {};          // connectionId -> Link
    var banned = {};         // connectionId -> true; kicked, and staying out
    var brokers = [];
    var takenRounds = {};    // broker host -> consecutive ID-TAKEN answers
    var surrendered = false;
    var stopped = false;
    var unwake = null;

    self.code = normalizeCode(code);
    self.peerId = id;
    self.token = token;

    BROKERS.forEach(function (cfg) {
      var b = Broker(cfg, id, token);
      brokers.push(b);

      b.on("open", function () {
        delete takenRounds[cfg.host];
        self.emit("broker", { host: cfg.host, up: true });
      });
      b.on("down", function () { self.emit("broker", { host: cfg.host, up: false }); });
      b.on("id-taken", function (round) {
        // One broker refusing the id is survivable — guests will find us on
        // another — and the usual cause is our own socket from a moment ago,
        // which the server has not reaped yet. The broker keeps retrying with
        // the same token; only a clean sweep that survives several rounds
        // means someone else really is on this code.
        takenRounds[cfg.host] = round;
        self.emit("broker", { host: cfg.host, up: false });
        var sweep = BROKERS.every(function (c) {
          return (takenRounds[c.host] || 0) >= ID_TAKEN_ROUNDS;
        });
        if (sweep && !surrendered) {
          surrendered = true;
          self.emit("code-taken");
        }
      });
      b.on("message", function (msg) { onSignal(b, msg); });
    });

    function onSignal(broker, msg) {
      var p = msg.payload || {};
      var cid = p.connectionId;
      if (!cid) return;

      if (banned[cid]) return;   // kicked: their offers stop being interesting

      if (msg.type === "OFFER") {
        // A rejoining guest reuses its connection id. If the link we already
        // hold is genuinely alive the guest would not be re-offering, so the
        // old one goes — but quietly, as a replacement rather than a guest
        // leaving, so the room does not flash someone out and back in.
        if (links[cid]) {
          var old = links[cid];
          delete links[cid];
          old.destroy("replaced");
        }

        var link = Link({
          initiator: false,
          connectionId: cid,
          remote: msg.src,
          onCandidate: function (c) {
            broker.send("CANDIDATE", msg.src, { candidate: c, connectionId: cid, type: "data" });
          }
        });
        links[cid] = link;

        link.on("open", function () { if (links[cid] === link) self.emit("guest-open", link); });
        link.on("message", function (data) {
          if (links[cid] === link) self.emit("guest-message", link, data);
        });
        link.on("close", function (reason) {
          if (links[cid] !== link) return;   // already replaced; not a departure
          delete links[cid];
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
            console.warn("[wg] answer failed", e);
            link.destroy("answer-failed");
          });
      } else if (msg.type === "CANDIDATE") {
        if (links[cid] && p.candidate) links[cid].addCandidate(p.candidate);
      }
    }

    /* Coming back from sleep, the host has two kinds of stale state: signalling
     * sockets nobody can reach it on, and data channels to guests who left
     * while the tab was frozen. Fix the first so it can be found, and prove the
     * second so the guest list is not a room full of ghosts. */
    function onWake() {
      if (stopped) return;
      brokers.forEach(function (b) { b.check(); });
      Object.keys(links).forEach(function (k) {
        var link = links[k];
        link.probe(PROBE_MS).then(function (alive) {
          if (!alive && links[k] === link) link.destroy("stale");
        });
      });
      self.emit("wake");
    }

    self.broadcast = function (obj) {
      Object.keys(links).forEach(function (k) { links[k].send(obj); });
    };

    self.guests = function () {
      return Object.keys(links)
        .map(function (k) { return links[k]; })
        .filter(function (l) { return l.isOpen(); });
    };

    /* Kicking is two things, and only doing the first is why "removed" guests
     * reappear a second later: drop the channel, and refuse the reconnect the
     * guest's own retry loop is already dialling. The ban is per connection id
     * and lives only as long as this room does. */
    self.kick = function (id) {
      var link = links[id];
      banned[id] = true;
      if (!link) return false;
      delete links[id];
      link.destroy("kicked");
      return true;
    };

    self.onlineBrokers = function () {
      return brokers.filter(function (b) { return b.isOpen(); }).length;
    };

    self.wake = onWake;

    self.stop = function () {
      if (stopped) return;
      stopped = true;
      if (unwake) { unwake(); unwake = null; }
      brokers.forEach(function (b) { b.close(); });
      Object.keys(links).forEach(function (k) { links[k].destroy("host-stopped"); });
      links = {};
    };

    if (opts.on) {
      Object.keys(opts.on).forEach(function (k) { self.on(k, opts.on[k]); });
    }

    unwake = wakeBus.on(onWake);
    return self;
  }

  /* ---------------- guest side ----------------
   * Walks the broker list until one of them can reach the host, then keeps the
   * link alive.
   *
   * Exactly one attempt is ever in flight. That is the whole design: the old
   * shape here started a fresh attempt on every wake-up without cancelling the
   * one already scheduled, so a phone picked up twice was suddenly racing two
   * handshakes that shared a connection id — each one making the host discard
   * the other's link, each discard scheduling another attempt. A generation
   * counter makes stale callbacks harmless, and every timer that could revive
   * an abandoned attempt is owned and cleared.
   */
  function join(code, handlers) {
    var self = emitter({});
    var target = peerIdFor(code);
    var connectionId = "wg_" + rid(10);   // stable across reconnects
    var gen = 0;
    var att = null;          // the one attempt in flight
    var retryTimer = null;
    var attempt = 0;
    var brokerIndex = 0;
    var lastGood = 0;
    var stopped = false;
    var outbox = [];
    var unwake = null;

    self.code = normalizeCode(code);
    self.state = "connecting";

    function setState(s, detail) {
      self.state = s;
      self.emit("state", s, detail);
    }

    function teardown() {
      if (!att) return;
      var a = att;
      att = null;
      // Retire the attempt *before* tearing it down. Destroying its link fires
      // a close handler, and a close handler that still recognised itself as
      // current would schedule a retry of its own — the abandoned attempt
      // reaching out of the grave to start the very stampede this replaces.
      a.gen = -1;
      clearTimeout(a.timer);
      clearTimeout(a.soft);
      if (a.link) a.link.destroy("retry");
      if (a.broker) a.broker.close();
    }

    function armTimeout(a, ms) {
      clearTimeout(a.timer);
      a.timer = setTimeout(function () {
        if (a.gen !== gen) return;
        fail("timeout");
      }, ms || OFFER_TIMEOUT_MS);
    }

    function startAttempt() {
      if (stopped) return;
      clearTimeout(retryTimer);
      retryTimer = null;
      teardown();

      var myGen = ++gen;
      var cfg = BROKERS[brokerIndex % BROKERS.length];
      var a = {
        gen: myGen,
        cfg: cfg,
        myId: "wgc-" + rid(10),
        broker: null,
        link: null,
        offer: null,
        reoffers: 0,
        connected: false,
        timer: null,
        soft: null
      };
      att = a;
      setState("connecting", cfg.host);

      a.broker = Broker(cfg, function () { return a.myId; }, rid(12));
      armTimeout(a);

      a.broker.on("open", function () {
        if (a.gen !== gen) return;
        // The socket can open more than once — it reconnects underneath us.
        // A second OPEN must not build a second link; re-asking with the offer
        // we already have is both cheaper and correct.
        if (!a.link) buildLink(a);
        else if (!a.link.isOpen() && a.offer) sendOffer(a);
      });

      a.broker.on("id-taken", function () {
        if (a.gen !== gen) return;
        a.myId = "wgc-" + rid(10);   // ours to choose; just pick another
      });

      a.broker.on("message", function (msg) {
        if (a.gen !== gen) return;
        var p = msg.payload || {};
        if (p.connectionId && p.connectionId !== connectionId) return;

        if (msg.type === "ANSWER" && a.link) {
          // A duplicate answer to a re-offer would land on a settled peer
          // connection and throw; only the one we are still waiting for counts.
          if (a.link.signalingState() !== "have-local-offer") return;
          a.link.acceptAnswer(p.sdp).then(
            function () { armTimeout(a, ANSWER_OPEN_MS); },
            function () { fail("answer-rejected"); }
          );
        } else if (msg.type === "CANDIDATE" && a.link) {
          if (p.candidate) a.link.addCandidate(p.candidate);
        } else if (msg.type === "EXPIRE" || msg.type === "LEAVE") {
          // This broker has never heard of the room. The host may simply be
          // re-registering after its own nap, so ask again here a few times
          // before writing the broker off.
          softRetry(a);
        }
      });
    }

    function buildLink(a) {
      var l = Link({
        initiator: true,
        connectionId: connectionId,
        remote: target,
        onCandidate: function (c) {
          a.broker.send("CANDIDATE", target, { candidate: c, connectionId: connectionId, type: "data" });
        }
      });
      a.link = l;

      l.on("open", function () {
        if (a.gen !== gen) return;
        clearTimeout(a.timer);
        clearTimeout(a.soft);
        a.connected = true;
        attempt = 0;
        lastGood = brokerIndex;
        setState("connected", a.cfg.host);
        self.emit("open");
        outbox.splice(0).forEach(function (m) { l.send(m); });
      });

      l.on("message", function (data) {
        if (a.gen === gen) self.emit("message", data);
      });

      l.on("close", function (reason) {
        if (a.gen !== gen || a.link !== l) return;
        a.link = null;
        if (stopped) return;
        if (a.connected) self.emit("closed", reason);
        // A link that was up and dropped usually comes straight back; a link
        // that never opened has something to work around, so it waits.
        fail(reason, a.connected ? 400 : null);
      });

      l.createOffer()
        .then(function (offer) {
          if (a.gen !== gen) return;
          a.offer = { type: offer.type, sdp: offer.sdp };
          sendOffer(a);
        })
        .catch(function () { if (a.gen === gen) fail("offer-failed"); });
    }

    function sendOffer(a) {
      if (!a.offer || !a.broker) return;
      a.broker.send("OFFER", target, {
        sdp: a.offer,
        connectionId: connectionId,
        type: "data",
        label: "wg",
        reliable: true,
        serialization: "json",
        browser: "wg"
      });
      armTimeout(a);
    }

    /** The host is not on this broker *yet*. Ask again before giving up on it. */
    function softRetry(a) {
      if (a.gen !== gen || a.connected) return;
      if (!a.offer || a.reoffers >= SOFT_REOFFERS || !a.broker.isOpen()) {
        fail("no-host");
        return;
      }
      a.reoffers++;
      setState("waiting", a.cfg.host);
      clearTimeout(a.soft);
      a.soft = setTimeout(function () {
        if (a.gen !== gen || a.connected) return;
        if (a.link && a.link.isOpen()) return;
        sendOffer(a);
      }, 900 * a.reoffers + Math.random() * 300);
    }

    function fail(why, immediateMs) {
      if (stopped) return;
      teardown();
      brokerIndex++;
      attempt++;

      var wait;
      if (immediateMs != null) {
        wait = immediateMs;
      } else {
        wait = Math.min(20000, 500 * Math.pow(1.6, Math.min(attempt, 8)));
        // A host that is merely re-registering is back within seconds; never
        // sit on a twenty-second timer waiting for someone who already is.
        if (why === "no-host" || why === "timeout") wait = Math.min(wait, 5000);
        // And while the tab is on screen, someone is watching this happen.
        if (!hidden()) wait = Math.min(wait, 6000);
      }
      wait += Math.random() * 400;

      setState("retrying", why);
      clearTimeout(retryTimer);
      retryTimer = setTimeout(function () {
        retryTimer = null;
        startAttempt();
      }, wait);
    }

    /* Back from the pocket. Anything the page believed about the connection was
     * frozen along with it, so re-establish it by asking rather than trusting:
     * probe a channel that claims to be open, and if it does not answer, start
     * over immediately instead of waiting out a backoff earned while away. */
    function onWake(reason) {
      if (stopped) return;

      var a = att;
      if (a && a.link && a.link.isOpen()) {
        if (a.broker) a.broker.check();
        var l = a.link;
        l.probe(PROBE_MS).then(function (alive) {
          if (stopped || att !== a || a.link !== l) return;
          if (alive) { self.emit("wake", reason); return; }
          attempt = 0;
          brokerIndex = lastGood;
          l.destroy("stale");     // its close handler restarts us straight away
        });
        return;
      }

      // Mid-handshake or waiting on a retry: neither deserves to survive a nap.
      attempt = 0;
      brokerIndex = lastGood;
      startAttempt();
    }

    self.send = function (obj) {
      if (att && att.link && att.link.isOpen()) return att.link.send(obj);
      outbox.push(obj);
      if (outbox.length > 50) outbox.shift();
      return false;
    };

    self.isOpen = function () { return !!(att && att.link && att.link.isOpen()); };

    self.retryNow = function () {
      if (stopped) return;
      attempt = 0;
      brokerIndex = lastGood;
      startAttempt();
    };

    self.stop = function () {
      if (stopped) return;
      stopped = true;
      gen++;
      clearTimeout(retryTimer);
      retryTimer = null;
      teardown();
      if (unwake) { unwake(); unwake = null; }
      setState("stopped");
    };

    if (handlers) {
      Object.keys(handlers).forEach(function (k) { self.on(k, handlers[k]); });
    }

    startAttempt();
    unwake = wakeBus.on(onWake);

    return self;
  }

  WG.net = {
    host: host,
    join: join,
    makeCode: makeCode,
    normalizeCode: normalizeCode,
    peerIdFor: peerIdFor,
    BROKERS: BROKERS
  };
})(typeof window !== "undefined" ? window : globalThis);

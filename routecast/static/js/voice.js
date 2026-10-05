/* ============================================================
   RouteCast — live voice

   The room used to talk in recordings: hold the button, let go, and only then
   did anything leave the phone. That is a floor of one whole utterance of delay
   before the network has even been asked, plus a container to build, a base64
   pass over it, and a queue at the far end that plays clips one after another —
   so two people talking at once became two people talking in turn, a second
   late each. On a ride, a warning that arrives after the corner is not a
   warning.

   This is the radio version. Voice rides the peer connection's own audio path:
   Opus over SRTP, packetised every 20 ms, with the browser's echo canceller,
   loss concealment and de-jitter buffer doing the work they exist to do. The
   thumb on the button no longer starts a recording, it opens a microphone that
   is already connected.

   What makes it instant
   ---------------------
   The audio transceiver is negotiated when the link is built, empty (see
   peer.js). Pressing talk is `replaceTrack()` plus a gain ramp — no offer, no
   answer, no broker round trip. The microphone is kept warm for a while after
   a release, so the second press costs nothing either.

   The star still holds
   --------------------
   Guests send one stream to the host and receive one back. The host is a
   mixer: for every guest it builds the sum of everyone *else* plus its own
   microphone, which is both how a guest hears the whole room over a single
   stream and why nobody ever hears themselves. That mix is what the guest's
   transceiver has been holding a slot for since the link opened.

   Cost while nobody is talking is a comfort-noise packet now and then: the
   codec is negotiated with DTX, so an open microphone on a quiet rider is
   close to free.

   A second engine, for the people next to you
   -------------------------------------------
   The PUBs proximity mic (proxmic.js) is the guest half of this file with
   more than one peer: one microphone track handed to every link, one element
   per voice. It gets its own engine from RC.voice.create() rather than
   sharing the ride's, and it is the reason a peer has a level — the ride
   plays everybody at full volume; the road plays them by distance.
   ============================================================ */
var RC = RC || {};

RC.voice = (function (global) {
  "use strict";

  // A warm microphone is the difference between a thumb press and a thumb
  // press plus a permission-checked device open. Hold it after a release, but
  // not forever: an open mic is a battery cost and a red dot in the status bar.
  var IDLE_RELEASE_MS = 90000;
  var RAMP_S = 0.015;          // gate ramp; a hard cut clicks in a helmet speaker

  /* ---------------- capability ---------------- */

  /** Live voice needs three things, and degrades to nothing rather than to
      something broken: transceivers (so the audio slot can be pre-negotiated),
      a microphone, and — for a host, which has to mix — Web Audio. */
  function supported() {
    if (typeof RTCPeerConnection !== "function") return false;
    if (!RTCPeerConnection.prototype || !RTCPeerConnection.prototype.addTransceiver) return false;
    if (!global.navigator || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    if (!global.MediaStream) return false;
    return true;
  }

  function canMix() {
    return !!(global.AudioContext || global.webkitAudioContext);
  }

  /** Can this browser turn one voice down? iOS answers no: an element's
      volume is read-only there and always reads back 1, so a distance-based
      level has to be applied in Web Audio instead. Asked once, by trying. */
  var volumeWorks = null;
  function canSetVolume() {
    if (volumeWorks !== null) return volumeWorks;
    try {
      var probe = new Audio();
      probe.volume = 0.5;
      volumeWorks = Math.abs(probe.volume - 0.5) < 0.01;
    } catch (e) {
      volumeWorks = false;
    }
    return volumeWorks;
  }

  /* ---------------- one engine ----------------
     Everything below is per engine. The ride has one (RC.voice itself); the
     proximity mic has another (RC.voice.create()), because a host's mixing
     graph is the ride's and nobody standing next to you at a fuel stop should
     ever be mixed into it — or hear it. */

  function engine() {
    var role = null;             // "host" | "guest" | null
    var ctx = null;
    var mic = null;              // MediaStream from getUserMedia
    var micTrack = null;
    var micSrc = null;           // host only: the mic inside the mixing graph
    var micGain = null;          // host only: the push-to-talk gate
    var micPromise = null;
    var peers = {};              // id -> peer record
    var order = [];
    var sending = false;
    var muted = false;
    var idleTimer = null;
    var blockedTold = false;
    var unlocked = false;

    function audioCtx() {
      if (ctx) return ctx;
      var AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      try {
        ctx = new AC({ latencyHint: "interactive", sampleRate: 48000 });
      } catch (e) {
        // A device that will not run at 48 kHz resamples; that is still better
        // than no mixing at all.
        try { ctx = new AC({ latencyHint: "interactive" }); } catch (e2) { ctx = null; }
      }
      return ctx;
    }

    /* ---------------- autoplay ----------------
       A phone that has not been touched yet will refuse to make a sound, and the
       refusal is silent. Every user gesture retries everything that is stalled,
       and the app is told once so it can say so out loud. */

    function unlock() {
      unlocked = true;
      if (ctx && ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
      order.forEach(function (id) {
        var el = peers[id] && peers[id].el;
        if (!el || !el.paused) return;
        var p = el.play();
        if (p && p.catch) p.catch(function () {});
      });
    }

    function blocked() {
      if (blockedTold) return;
      blockedTold = true;
      if (typeof api.onBlocked === "function") {
        try { api.onBlocked(); } catch (e) {}
      }
    }

    if (global.addEventListener) {
      ["pointerdown", "touchend", "keydown"].forEach(function (ev) {
        global.addEventListener(ev, function () { if (role) unlock(); }, true);
      });
    }

    /* ---------------- the microphone ---------------- */

    /** Ask for the quietest, narrowest, lowest-latency capture the device will
        give us. Every hint here is optional by construction — the basic
        constraint set treats plain values as preferences — so the fallback is
        only for a browser that rejects the shape outright. */
    function primeMic() {
      if (mic && micTrack && micTrack.readyState === "live") return Promise.resolve(mic);
      if (micPromise) return micPromise;
      if (!supported()) return Promise.reject(new Error("This browser will not share a microphone."));

      var want = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
          latency: 0.01,
          // Legacy Chrome equivalents, ignored where they are not understood.
          googEchoCancellation: true,
          googNoiseSuppression: true,
          googAutoGainControl: true,
          googHighpassFilter: true,
          googAudioMirroring: false
        },
        video: false
      };

      micPromise = navigator.mediaDevices.getUserMedia(want)
        .catch(function () { return navigator.mediaDevices.getUserMedia({ audio: true, video: false }); })
        .then(function (stream) {
          micPromise = null;
          if (!role) {
            stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
            throw new Error("Left the room.");
          }
          mic = stream;
          micTrack = stream.getAudioTracks()[0] || null;
          if (micTrack) {
            micTrack.addEventListener("ended", function () { releaseMic(); });
          }
          if (role === "host") buildMicNode();
          applyGate();
          wireSenders();
          return stream;
        }, function (err) {
          micPromise = null;
          throw err;
        });

      return micPromise;
    }

    function buildMicNode() {
      var c = audioCtx();
      if (!c || !mic || micSrc) return;
      try {
        micSrc = c.createMediaStreamSource(mic);
        micGain = c.createGain();
        micGain.gain.value = sending ? 1 : 0;
        micSrc.connect(micGain);
      } catch (e) {
        micSrc = null;
        micGain = null;
      }
      rewire();
    }

    function releaseMic() {
      clearTimeout(idleTimer);
      idleTimer = null;
      try { if (micSrc) micSrc.disconnect(); } catch (e) {}
      try { if (micGain) micGain.disconnect(); } catch (e) {}
      micSrc = null;
      micGain = null;
      if (mic) {
        try { mic.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      }
      mic = null;
      micTrack = null;
      // A guest sends the microphone straight down the wire, so letting go of it
      // means telling the sender too. A host sends a mix, which simply goes quiet.
      if (role === "guest") {
        order.forEach(function (id) {
          var p = peers[id];
          if (p && p.link && p.link.setAudioTrack) p.link.setAudioTrack(null);
        });
      }
    }

    /** Open or close the gate. A guest cuts the track itself, which with DTX
        costs the uplink nothing while quiet; a host rides a gain ramp, because
        its microphone is one voice inside a mix that has to keep flowing. */
    function applyGate() {
      if (role === "guest") {
        if (micTrack) micTrack.enabled = sending;
        return;
      }
      if (!micGain || !ctx) return;
      var target = sending ? 1 : 0;
      try {
        micGain.gain.cancelScheduledValues(ctx.currentTime);
        micGain.gain.setValueAtTime(micGain.gain.value, ctx.currentTime);
        micGain.gain.linearRampToValueAtTime(target, ctx.currentTime + RAMP_S);
      } catch (e) {
        micGain.gain.value = target;
      }
    }

    /* ---------------- the graph ----------------
       Host only. One destination per guest, carrying everyone but that guest. */

    function rewire() {
      if (role !== "host") return;
      try { if (micGain) micGain.disconnect(); } catch (e) {}
      order.forEach(function (id) {
        var p = peers[id];
        if (p && p.gain) { try { p.gain.disconnect(); } catch (e) {} }
      });
      order.forEach(function (id) {
        var p = peers[id];
        if (!p || !p.dest) return;
        if (micGain) { try { micGain.connect(p.dest); } catch (e) {} }
        order.forEach(function (other) {
          if (other === id) return;      // nobody is sent their own voice back
          var q = peers[other];
          if (q && q.gain && q.dest !== p.dest) {
            try { q.gain.connect(p.dest); } catch (e) {}
          }
        });
      });
    }

    /* ---------------- playback ----------------
       Straight to an <audio> element: the browser's own path is the shortest one
       there is, and it is the path its de-jitter buffer and loss concealment were
       written for. The element also sinks the stream, which is what keeps it
       flowing into the mixing graph on a host. */

    function playbackElement(stream) {
      var el;
      try { el = new Audio(); } catch (e) { return null; }
      try { el.srcObject = stream; } catch (e) { return null; }
      el.autoplay = true;
      el.playsInline = true;
      el.preload = "none";
      // volume rather than muted: a muted element is allowed to stop pulling on
      // the stream, and on a host that would silence the mix as well as the room.
      el.volume = muted ? 0 : 1;
      var p = el.play();
      if (p && p.catch) {
        p.catch(function () { if (!unlocked) blocked(); });
      }
      return el;
    }

    function applyMute() {
      order.forEach(function (id) {
        if (peers[id]) applyLevel(peers[id]);
      });
    }

    /* ---------------- one voice louder than another ----------------
       The ride plays everybody at full volume. The proximity mic does not: a
       rider two metres away and one forty metres away are not the same voice,
       and the level is what says so. Each peer carries its own level, muting
       still wins over all of them, and a change is ramped over a quarter of a
       second, because the level moves every time a position does and a step
       in it is a click in a helmet speaker.

       The short path is the element's own volume. Where the browser will not
       let a page set that (iOS), the voice goes through a gain node instead
       and the element is muted, kept only so the stream keeps arriving. That
       detour is for a guest engine only: on a host the element is what keeps
       the mix fed, and muting it there would silence the room. */

    var LEVEL_STEPS = 6;
    var LEVEL_STEP_MS = 40;

    function levelOf(p) { return muted ? 0 : p.level; }

    function clampLevel(v) {
      v = Number(v);
      return isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
    }

    function viaGraph(p) {
      if (p.out) return true;
      if (role !== "guest") return false;
      var c = audioCtx();
      if (!c) return false;
      try {
        p.outSrc = c.createMediaStreamSource(p.stream);
        p.out = c.createGain();
        p.out.gain.value = 0;
        p.outSrc.connect(p.out);
        p.out.connect(c.destination);
      } catch (e) {
        try { if (p.outSrc) p.outSrc.disconnect(); } catch (e2) {}
        p.outSrc = null;
        p.out = null;
        return false;
      }
      if (p.el) p.el.muted = true;
      if (c.state === "suspended") { try { c.resume(); } catch (e) {} }
      return true;
    }

    function applyLevel(p, now) {
      var target = levelOf(p);
      if (!p.out && !canSetVolume() && target < 1) viaGraph(p);
      if (p.out && ctx) {
        try {
          p.out.gain.cancelScheduledValues(ctx.currentTime);
          p.out.gain.setValueAtTime(p.out.gain.value, ctx.currentTime);
          p.out.gain.linearRampToValueAtTime(target, ctx.currentTime + (now ? 0.005 : LEVEL_STEPS * LEVEL_STEP_MS / 1000));
        } catch (e) {
          p.out.gain.value = target;
        }
        return;
      }
      var el = p.el;
      if (!el) return;
      clearInterval(p.ramp);
      p.ramp = null;
      var from = el.volume;
      if (now || Math.abs(target - from) < 0.02) { try { el.volume = target; } catch (e) {} return; }
      var i = 0;
      p.ramp = setInterval(function () {
        i++;
        try { el.volume = Math.max(0, Math.min(1, from + (target - from) * i / LEVEL_STEPS)); } catch (e) {}
        if (i >= LEVEL_STEPS) { clearInterval(p.ramp); p.ramp = null; }
      }, LEVEL_STEP_MS);
    }

    /** A guest's microphone goes to the host unchanged. Called both when a link
        appears and when the microphone does, because either can be second. */
    function wireSenders() {
      if (role !== "guest" || !micTrack) return;
      order.forEach(function (id) {
        var p = peers[id];
        if (p && p.link && p.link.setAudioTrack) p.link.setAudioTrack(micTrack);
      });
    }

    /* ---------------- public surface ---------------- */

    var api = {
      supported: supported,

      /** Live voice needs a mixer on the host side only; a guest with no Web
          Audio can still talk and listen, it just could not host. */
      available: function (asRole) {
        if (!supported()) return false;
        return asRole === "host" ? canMix() : true;
      },

      start: function (asRole) {
        if (role) return role === asRole;
        if (!api.available(asRole)) return false;
        role = asRole === "host" ? "host" : "guest";
        sending = false;
        muted = false;
        blockedTold = false;
        unlocked = false;
        if (role === "host") audioCtx();
        return true;
      },

      /** Get the audio path ready from inside a tap. Where levels have to go
          through Web Audio (iOS), the context must be started by a gesture or it
          stays suspended and every voice routed through it is silent; nowhere
          else is a context created for a guest at all. */
      warm: function () {
        if (!role) return false;
        if (!canSetVolume()) audioCtx();
        unlock();
        return true;
      },

      stop: function () {
        order.slice().forEach(function (id) { api.removePeer(id); });
        releaseMic();
        role = null;
        sending = false;
        if (ctx) {
          try { ctx.close(); } catch (e) {}
          ctx = null;
        }
      },

      active: function () { return !!role; },

      /** Attach an open link whose audio survived negotiation. Returns false for
          a peer we cannot talk to — an older client, or a browser that rejected
          the m=audio section — and the caller falls back to recorded clips. */
      addPeer: function (id, link, level) {
        id = String(id || "");
        if (!role || !id || !link || peers[id]) return false;
        if (!link.audioReady || !link.audioReady()) return false;
        var stream = link.remoteAudio && link.remoteAudio();
        if (!stream) return false;

        var p = {
          id: id, link: link, stream: stream, el: null, src: null, gain: null, dest: null,
          level: level == null ? 1 : clampLevel(level), out: null, outSrc: null, ramp: null
        };
        peers[id] = p;
        order.push(id);

        p.el = playbackElement(stream);
        // Arriving already quiet, not arriving loud and then being turned down.
        if (p.level !== 1) applyLevel(p, true);

        if (role === "host") {
          var c = audioCtx();
          if (c) {
            try {
              p.src = c.createMediaStreamSource(stream);
              p.gain = c.createGain();
              p.gain.gain.value = 1;
              p.src.connect(p.gain);
              p.dest = c.createMediaStreamDestination();
            } catch (e) {
              p.src = null; p.gain = null; p.dest = null;
            }
          }
          if (p.dest) {
            var track = p.dest.stream.getAudioTracks()[0];
            if (track && link.setAudioTrack) link.setAudioTrack(track);
          }
          rewire();
        } else {
          wireSenders();
        }

        if (unlocked) unlock();
        return true;
      },

      removePeer: function (id) {
        id = String(id || "");
        var p = peers[id];
        if (!p) return false;
        delete peers[id];
        order = order.filter(function (k) { return k !== id; });
        if (p.el) {
          try { p.el.pause(); } catch (e) {}
          try { p.el.srcObject = null; } catch (e) {}
        }
        clearInterval(p.ramp);
        try { if (p.src) p.src.disconnect(); } catch (e) {}
        try { if (p.gain) p.gain.disconnect(); } catch (e) {}
        try { if (p.outSrc) p.outSrc.disconnect(); } catch (e) {}
        try { if (p.out) p.out.disconnect(); } catch (e) {}
        try { if (p.link && p.link.setAudioTrack) p.link.setAudioTrack(null); } catch (e) {}
        rewire();
        return true;
      },

      /** How loud one voice is, 0 to 1, under the mute. The proximity mic sets
          this from distance every time a position arrives. */
      setPeerVolume: function (id, level) {
        var p = peers[String(id || "")];
        if (!p) return false;
        var v = clampLevel(level);
        if (Math.abs(v - p.level) < 0.005) return true;
        p.level = v;
        applyLevel(p);
        return true;
      },

      peerVolume: function (id) {
        var p = peers[String(id || "")];
        return p ? p.level : null;
      },

      peerIds: function () { return order.slice(); },

      /** Which link a peer id is currently wired to. A guest that reconnects
          keeps its id but arrives on a brand new peer connection, so "is this
          still the link I attached?" is the question callers actually have. */
      linkOf: function (id) {
        var p = peers[String(id || "")];
        return p ? p.link : null;
      },

      /** Is there anybody on the other end of a live audio path right now? */
      ready: function () {
        return !!role && order.some(function (id) {
          var p = peers[id];
          return !!(p && p.link && p.link.audioReady && p.link.audioReady());
        });
      },

      /** Push to talk. Resolves once the microphone is actually open — which on
          the first press is a device open, and on every press after that is
          nothing at all, because the microphone was kept. */
      setTransmit: function (on) {
        on = !!on;
        if (!role) return Promise.resolve(false);
        clearTimeout(idleTimer);
        idleTimer = null;

        if (!on) {
          sending = false;
          applyGate();
          idleTimer = setTimeout(function () {
            idleTimer = null;
            if (!sending) releaseMic();
          }, IDLE_RELEASE_MS);
          return Promise.resolve(true);
        }

        sending = true;
        unlock();
        return primeMic().then(function () {
          if (!role) return false;
          applyGate();
          return true;
        }, function (err) {
          sending = false;
          applyGate();
          throw err;
        });
      },

      /** Open the device ahead of the thumb. The talk button calls this the
          moment it becomes usable, so the first press is as quick as the tenth. */
      prime: function () {
        if (!role) return Promise.resolve(false);
        return primeMic().then(function () { return true; }, function () { return false; });
      },

      transmitting: function () { return sending; },

      setMuted: function (on) {
        muted = !!on;
        applyMute();
        return true;
      },

      isMuted: function () { return muted; },

      unlock: unlock,

      /* Called once if the browser refused to play without a gesture. */
      onBlocked: null
    };

    return api;
  }

  var main = engine();
  main.create = engine;
  return main;
})(typeof window !== "undefined" ? window : globalThis);

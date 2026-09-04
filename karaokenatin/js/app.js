/* app.js — screens, wiring, and the two roles.
 *
 * One UI serves both roles. The host additionally owns the video player and the
 * authoritative state; a guest's identical-looking controls just send requests
 * over the data channel. `dispatch()` is the seam: on the host it applies
 * locally, on a guest it goes down the wire.
 *
 * A guest request is a request, not an order: `onGuestCommand` checks it
 * against the host's live state before `handle()` ever touches the player —
 * rejecting anything built on a stale mirror (a queue position, an sid, a
 * "now playing" that has since moved on) and anything that doesn't make sense
 * against the current state (skipping when nothing plays, seeking past the
 * end). A rejected guest gets a fresh snapshot instead of a state mutation.
 */
(function (global) {
  "use strict";

  var KN = global.KN;
  var R = KN.room;
  var CMD = R.CMD;
  var MSG = R.MSG;

  /* ---------------- tiny DOM helpers ---------------- */
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return [].slice.call((root || document).querySelectorAll(sel)); };

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  /** Fills every `[data-icon]` under `root` with the icon it names. Markup
   *  stays declarative and the icon set stays the one source of drawings. */
  function paintIcons(root) {
    $$("[data-icon]", root || document).forEach(function (node) {
      if (node.firstChild) return;               // already painted
      try { KN.setIcon(node, node.getAttribute("data-icon")); }
      catch (e) { /* an icon name that does not exist is a typo, not a crash */ }
    });
  }

  function toast(text, kind) {
    var stack = $("#toasts");
    var t = el("div", { class: "toast" + (kind ? " toast-" + kind : ""), text: text });
    stack.appendChild(t);
    setTimeout(function () { t.classList.add("out"); }, 3200);
    setTimeout(function () { t.remove(); }, 3600);
  }

  /* ---------------- session memory ----------------
   * Reloading the host page should not end the party. The room code and queue
   * live in localStorage, so a refresh (or an accidental close) re-registers
   * the same code and guests reconnect on their own.
   */
  var STORE = {
    host: "kn:host",
    guest: "kn:guest",
    name: "kn:name",
    installDismissed: "kn:install-dismissed"
  };
  var RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;

  /* Without this, the saved library and room state are "best-effort"
   * storage: Chrome can clear them under disk pressure and Safari's ITP
   * wipes script-writable storage after ~7 days with no visit. It's a
   * heuristic grant, not a promise, so log a denial — otherwise there's no
   * way to tell "the browser said no" apart from "the library really did
   * get wiped" if someone reports it later. */
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(function (already) {
      if (already) return true;
      return navigator.storage.persist();
    }).then(function (granted) {
      if (!granted) console.warn("[karaokenatin] persistent storage was not granted; the saved library may be evicted by the browser");
    }).catch(function () {});
  }

  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }
  function load(key) {
    try {
      var v = JSON.parse(localStorage.getItem(key));
      if (v && v.at && Date.now() - v.at > RESUME_WINDOW_MS) return null;
      return v;
    } catch (e) { return null; }
  }
  function forget(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  /* ---------------- app state ---------------- */

  var app = {
    role: null,        // 'host' | 'guest'
    state: null,       // room state (authoritative on host, mirror on guest)
    net: null,         // KN.net host/join handle
    player: null,      // host only
    clientId: null,
    name: "",
    connection: "offline",
    guestNames: {},    // host only: link.id -> display name
    searchBusy: false,
    playerError: false,    // host only: the stage is showing a load failure
    lastResults: [],
    searchSweep: null,   // in-flight playability sweep; cancelled by the next search
    searchRun: null,     // the multi-round search it belongs to
    waiting: false,      // guest only: still in the lobby
    tab: "queue",
    openPlaylists: {},   // pid -> expanded in the library view
    pickerSong: null,
    railOpen: true,
    hostWasListed: false,  // host only: has any broker ever answered?
    pendingJoin: null,     // room code waiting behind the name gate
    cohosts: {},           // host only: guest id -> true
    lastScoreAt: 0,        // guest only: the score already announced here
    upNextFor: null,       // host only: the song whose "up next" has been shown
    approved: {},          // host only: guest id -> let in
    dragSid: null,         // the queue row currently being dragged
    offerSeenAt: 0,        // when this device first saw a "spin again" offer
    curfewDone: false      // this page has already had its 10pm moment
  };

  /* ================= HOST ================= */

  function startHost(code, resumed) {
    app.role = "host";
    app.state = R.createState(code);
    app.name = app.name || loadName() || "Host";
    app.hostToken = (resumed && resumed.token) || null;
    app.hostWasListed = false;
    app.approved = {};

    if (resumed && resumed.queue) {
      app.state.queue = resumed.queue;
      app.state.now = resumed.now || null;
      // A guest that survived the reload is still holding whatever rev it
      // last saw; restarting ours from 0 would make every fresh snapshot
      // look "old" to it (data.rev < app.state.rev, app.js onHostMessage)
      // and every one of its requests look "stale" to us forever after.
      if (typeof resumed.rev === "number") app.state.rev = resumed.rev;
      if (resumed.config) app.state.config = R.sanitizeConfig(resumed.config);
      if (Array.isArray(resumed.scores)) app.state.scores = resumed.scores;
      if (resumed.roulette) app.state.roulette = KN.games.sanitizeRoulette(resumed.roulette);
      /* Who has already been let in survives the reload with everything else.
       * Without this a host refreshing the page — or recovering from a crash —
       * silently ejects the whole room back into the lobby and has to admit
       * everybody a second time, which is worse than not asking at all. */
      if (resumed.approved && typeof resumed.approved === "object") app.approved = resumed.approved;
    }
    app.state.hostName = app.name;
    app.cohosts = {};
    app.approved = app.approved || {};

    app.net = KN.net.host(code, {
      token: app.hostToken,
      on: {
        "guest-open": function (link) {
          app.guestNames[link.id] = app.guestNames[link.id] || "Guest";
          link.send({ type: MSG.WELCOME, clientId: link.id, code: code });
          refreshGuestList();
          sendStateTo(link);
          render();
        },
        "guest-message": function (link, data) { onGuestCommand(link, data); },
        "guest-close": function (link) {
          delete app.guestNames[link.id];
          refreshGuestList();
          // Who's in the room isn't something a guest's queue/playback
          // request could go stale against — don't bump rev over it.
          broadcastState({ progress: true });
        },
        broker: function () { render(); },
        wake: function () {
          // Back from sleep: the guest list has just been re-proved, and any
          // guest that stayed is holding a snapshot from before the nap.
          refreshGuestList();
          broadcastState({ progress: true });
          render();
        },
        "code-taken": function () {
          // Every broker says the id is in use, so someone else really is on
          // this code. Move rather than fight over it — but keep the queue.
          toast("That room code was taken — switching to a new one.", "warn");
          var carry = { queue: app.state.queue, now: app.state.now, at: Date.now() };
          app.net.stop();
          startHost(KN.net.makeCode(), carry);
        }
      }
    });
    app.hostToken = app.net.token;

    app.connection = "hosting";
    if (KN.sound) KN.sound.setEnabled(app.state.config.sounds !== false);
    if (KN.stats) KN.stats.startSession({ code: code, role: "host" });
    persistHost();
    showRoom();
    setupPlayer();
    keepAwake();
    // The watch is armed at boot, before there is a room to be late in — so a
    // host opening one at half past ten is asked the question right away
    // rather than up to a poll later.
    checkCurfew();
  }

  function setupPlayer() {
    var mount = $("#yt-mount");
    // The API replaces its target element with the iframe, so give it a fresh
    // placeholder — but leave the overlay button in the mount alone.
    var stale = $("#yt-frame");
    if (stale) stale.remove();
    var err = $(".player-error");
    if (err) err.remove();
    app.playerError = false;
    mount.insertBefore(el("div", { id: "yt-frame" }), mount.firstChild);

    KN.player
      .create("yt-frame")
      .then(function (p) {
        app.player = p;
        p.volume(app.state.player.volume);
        p.mute(app.state.player.muted);

        p.on("ended", function () { songFinished(); });
        p.on("blocked", function () { $("#tap-to-play").hidden = false; });
        p.on("playing", function () {
          $("#tap-to-play").hidden = true;
          app.state.player.status = "playing";
          var m = p.meta();
          if (m && app.state.now && !adPlaying()) {
            if (m.duration) app.state.now.duration = m.duration;
            if (m.title && app.state.now.title === "YouTube video") app.state.now.title = m.title;
            if (m.author && !app.state.now.author) app.state.now.author = m.author;
          }
          broadcastState();
        });
        p.on("paused", function () { app.state.player.status = "paused"; broadcastState(); });
        p.on("buffering", function () { app.state.player.status = "loading"; broadcastState(); });
        p.on("error", function (msg) {
          notice(msg + " Skipping.", "warn");
          setTimeout(nextSong, 1200);
        });

        // Resume whatever was loaded before a refresh.
        if (app.state.now) p.load(app.state.now.id);
        else if (app.state.queue.length) nextSong();
        render();
        startTicker();
      })
      .catch(function (err) {
        /* A stage that cannot play anything has nothing to say about an empty
         * queue: the error is the only thing worth reading, and worth being
         * able to press. */
        app.playerError = true;
        renderNow();

        /* Not the end of the road: the API load is retryable now, and the
         * usual fixes for this (turn the blocker off, leave the lift, come
         * back onto wifi) are all things the user does and then wants to try
         * again — without losing the room by reloading the page. */
        $("#yt-mount").appendChild(
          el("div", { class: "player-error" }, [
            el("p", { class: "player-error-text", text: err.message }),
            el("button", {
              class: "btn btn-primary btn-sm",
              type: "button",
              onclick: function () { setupPlayer(); }
            }, ["Try again"])
          ])
        );
      });
  }

  /* ---------------- adverts ----------------
   * YouTube serves adverts inside its own player and there is no API to ask
   * about one, let alone to skip it. Nor should there be from here: clicking
   * "Skip ad" from a page, hiding one, or stripping it out is a breach of
   * YouTube's terms that gets embeds killed, and this app plays entirely
   * through their player by design. So the honest move is the only one — say
   * what is happening, so a room staring at an unfamiliar video for twenty
   * seconds knows the app has not hung, and let the advert finish.
   *
   * There is no flag to read, so this is inferred: an advert makes the
   * player's reported duration disagree wildly with the duration the search
   * mirror gave for the song. It is a heuristic, and it is used for exactly
   * one thing — a label. Nothing skips, scores or advances on the strength of
   * it, so being wrong costs a caption and not a turn.
   */
  function adPlaying() {
    var s = app.state;
    if (!s || !s.now || s.now.kind === "game") return false;
    var known = s.now.duration || 0;
    var live = app.player ? app.player.duration() : 0;
    if (!known || !live) return false;
    var slack = Math.max(15, known * 0.2);
    return Math.abs(live - known) > slack;
  }

  /* ---------------- up next ----------------
   * Three-quarters of the way through is when the next singer needs to start
   * moving, and the end of the song is far too late to say so. Small, in a
   * corner, and gone again in a few seconds: the point is that one person gets
   * up, not that the room stops watching the person still singing.
   */
  var UP_NEXT_AT = 0.77;
  var UP_NEXT_MS = 7000;
  var upNextTimer = null;

  function showUpNext() {
    var s = app.state;
    var next = s.queue[0];
    var box = $("#up-next");
    if (!box || !next) return;
    $("#up-next-title").textContent = KN.games.isGameCard(next) ? "Song Roulette" : next.title;
    $("#up-next-who").textContent = KN.games.isGameCard(next) ? "the wheel decides" : next.addedBy;
    box.hidden = false;
    box.classList.remove("in");
    void box.offsetWidth;
    box.classList.add("in");
    clearTimeout(upNextTimer);
    upNextTimer = setTimeout(hideUpNext, UP_NEXT_MS);
  }

  function hideUpNext() {
    clearTimeout(upNextTimer);
    var box = $("#up-next");
    if (box) { box.hidden = true; box.classList.remove("in"); }
  }

  var ticker = null;
  function startTicker() {
    clearInterval(ticker);
    ticker = setInterval(function () {
      if (app.role !== "host" || !app.player) return;
      var t = app.player.time();
      var d = app.player.duration();
      var moved = Math.abs(t - app.state.player.time) > 0.4 || Math.abs(d - app.state.player.duration) > 0.5;
      app.state.player.time = t;
      app.state.player.duration = d;

      var ad = adPlaying();
      var note = $("#ad-note");
      if (note) note.hidden = !ad;

      /* An advert's clock is not the song's, so nothing timed off the song
       * may run while one is playing — least of all a card announcing that we
       * are three-quarters through something that has not started. */
      if (!ad && d && app.state.now && app.state.queue.length && app.upNextFor !== app.state.now.sid) {
        if (t / d >= UP_NEXT_AT) {
          app.upNextFor = app.state.now.sid;
          showUpNext();
        }
      }

      renderProgress();
      if (moved) broadcastState({ quiet: true, progress: true });
    }, 1000);
  }

  function onGuestCommand(link, data) {
    if (!data || typeof data.type !== "string") return;

    if (data.type === CMD.HELLO || data.type === CMD.NAME) {
      var nm = String(data.name || "").slice(0, 24).trim() || "Guest";
      var renaming = app.guestNames[link.id] && app.guestNames[link.id] !== nm;
      app.guestNames[link.id] = nm;
      refreshGuestList();
      /* A guest still in the lobby is told so on arrival and on every
       * reconnect — otherwise a phone that reconnects mid-evening sits
       * looking at a room it silently cannot touch. */
      if (waiting(link.id)) {
        link.send({ type: MSG.WAIT });
        if (!renaming) toast(nm + " is asking to join.", "warn");
        render();
      }
      broadcastState({ progress: true });
      return;
    }
    if (data.type === CMD.RESYNC) { sendStateTo(link); return; }

    /* ── the door ──
     * With approval on, a guest that has not been let in can do exactly two
     * things: say who they are, and ask for a fresh snapshot. Every other
     * command is refused where it arrives rather than filtered out of a UI
     * they are not obliged to be running. This is the whole point: the room
     * code is six guessable characters against a public broker, and a
     * stranger who guesses one should reach a lobby, not a queue.
     */
    if (waiting(link.id)) {
      link.send({ type: MSG.WAIT });
      link.send({
        type: MSG.NOTICE,
        text: "The host has not let you into the room yet.",
        kind: "warn"
      });
      return;
    }

    var s = app.state;

    /* Room administration is not something a guest can simply ask for. ROLE is
     * the host's alone — a co-host that could appoint co-hosts is a room with
     * no owner — while everything else here is open to co-hosts too. */
    if (data.type === CMD.ROLE) {
      link.send({ type: MSG.NOTICE, text: "Only the host can change roles.", kind: "warn" });
      return;
    }
    if ((data.type === CMD.CONFIG || data.type === CMD.KICK || data.type === CMD.CLEAR ||
         data.type === CMD.APPROVE || data.type === CMD.GAME_CONFIG ||
         data.type === CMD.GAME_QUEUE || data.type === CMD.GAME_AGAIN) && !app.cohosts[link.id]) {
      link.send({ type: MSG.NOTICE, text: "Only the host and co-hosts can do that.", kind: "warn" });
      return;
    }
    // Whoever the sender claims to be, a song is credited to the link it came
    // in on. Nothing else would survive one guest typing another's client id.
    if (data.type === CMD.ADD) data.byId = link.id;

    // A request built on a mirror that has since moved on can ask for
    // something that no longer makes sense — skip a song that already ended,
    // move one that's gone. ADD is order-independent and safe regardless of
    // staleness; everything else gets dropped and the sender resynced rather
    // than applied against state it never actually saw. rev 0 means the guest
    // hasn't got its first snapshot yet — nothing to compare against, so let
    // it through rather than bouncing a brand-new guest's very first tap.
    if (data.type !== CMD.ADD && data.rev > 0 && data.rev < s.rev) {
      link.send({ type: MSG.NOTICE, text: "That was out of date — refreshed.", kind: "warn" });
      sendStateTo(link);
      return;
    }

    var reason = illegalReason(data, s);
    if (reason) {
      link.send({ type: MSG.NOTICE, text: reason, kind: "warn" });
      sendStateTo(link);
      return;
    }

    handle(data, app.guestNames[link.id] || "Guest", link.id);
  }

  /** Is this guest still outside the door? Only ever true while the room asks
   *  for approval — turning the setting off lets in everyone already waiting. */
  function waiting(id) {
    var c = app.state && app.state.config;
    return !!(app.role === "host" && c && c.joinApproval && !app.approved[id]);
  }

  /** Rejects a request that is well-formed but doesn't make sense against the
   * host's current, authoritative state. Returns a reason to show the sender,
   * or null if the request stands. */
  function illegalReason(cmd, s) {
    switch (cmd.type) {
      case CMD.SKIP:
      case CMD.RESTART:
        return s.now ? null : "Nothing is playing.";
      case CMD.PAUSE:
        return s.player.status === "playing" || s.player.status === "loading" ? null : "Not playing.";
      case CMD.PLAY:
        return s.now && s.player.status === "playing" ? "Already playing." : null;
      case CMD.SEEK: {
        if (!s.now) return "Nothing is playing.";
        var t = Number(cmd.t);
        if (!isFinite(t) || t < 0) return "Invalid seek position.";
        if (s.player.duration && t > s.player.duration + 2) return "Invalid seek position.";
        return null;
      }
      case CMD.PLAY_NOW:
        return s.now && s.now.sid === cmd.sid ? "Already playing." : null;
      default:
        return null;
    }
  }

  /** The one place a command changes anything, whoever sent it. */
  function handle(cmd, who, fromId) {
    var s = app.state;
    switch (cmd.type) {
      case CMD.PLAY:
        if (!s.now && s.queue.length) { nextSong(); return; }
        if (app.player) app.player.play();
        break;
      case CMD.PAUSE:
        if (app.player) app.player.pause();
        break;
      case CMD.SKIP:
        nextSong();
        return;
      case CMD.RESTART:
        if (app.player) { app.player.seek(0); app.player.play(); }
        break;
      case CMD.SEEK:
        if (app.player) app.player.seek(Number(cmd.t) || 0);
        break;
      case CMD.VOLUME: {
        var v = Math.max(0, Math.min(100, Math.round(Number(cmd.v) || 0)));
        s.player.volume = v;
        if (app.player) app.player.volume(v);
        break;
      }
      case CMD.MUTE:
        s.player.muted = !!cmd.on;
        if (app.player) app.player.mute(s.player.muted);
        break;
      case CMD.CONFIG: {
        var was = s.config;
        s.config = R.sanitizeConfig(cmd.config);
        // Turning the cap on is only meaningful if it acts on the queue that
        // is already there, not just on whatever is added next.
        if (s.config.maxRun && !was.maxRun) R.rebalance(s);
        if (!s.config.leaderboard && was.leaderboard) s.scores = [];
        // Switching the door off opens it, rather than leaving a lobby full
        // of people the room no longer has any way of admitting.
        if (!s.config.joinApproval && was.joinApproval) {
          (s.pending || []).forEach(function (g) { app.approved[g.id] = true; });
          refreshGuestList();
        }
        if (KN.sound) KN.sound.setEnabled(s.config.sounds !== false);
        break;
      }
      case CMD.KICK: {
        var target = (s.guests || []).find(function (g) { return g.id === cmd.id; });
        if (!target || !app.net) break;
        delete app.cohosts[cmd.id];
        // Say why before the channel goes: a guest whose link simply vanishes
        // spends the next minute watching its own reconnect loop.
        var gone = app.net.guests().find(function (l) { return l.id === cmd.id; });
        if (gone) gone.send({ type: MSG.BYE, reason: "kicked" });
        setTimeout(function () { if (app.net) app.net.kick(cmd.id); }, 150);
        delete app.guestNames[cmd.id];
        refreshGuestList();
        notice(target.name + " was removed from the room.", "warn");
        break;
      }
      case CMD.ROLE: {
        var g = (s.guests || []).find(function (x) { return x.id === cmd.id; });
        if (!g) break;
        if (cmd.cohost) app.cohosts[cmd.id] = true;
        else delete app.cohosts[cmd.id];
        refreshGuestList();
        notice(g.name + (cmd.cohost ? " is now a co-host." : " is no longer a co-host."));
        break;
      }
      case CMD.APPROVE: {
        var arrival = app.guestNames[cmd.id] || "Someone";
        var theirLink = app.net && app.net.guests().find(function (l) { return l.id === cmd.id; });
        if (cmd.ok) {
          app.approved[cmd.id] = true;
          if (theirLink) theirLink.send({ type: MSG.NOTICE, text: "You are in. Welcome to the room.", kind: "ok" });
          notice(arrival + " was let into the room.");
        } else {
          // Refused rather than merely ignored: the same treatment a kick
          // gets, so a refused arrival cannot sit there retrying all night.
          if (theirLink) theirLink.send({ type: MSG.BYE, reason: "refused" });
          setTimeout(function () { if (app.net) app.net.kick(cmd.id); }, 150);
          delete app.guestNames[cmd.id];
          delete app.approved[cmd.id];
          notice(arrival + " was not let in.", "warn");
        }
        refreshGuestList();
        break;
      }

      case CMD.GAME_ADD: {
        var out = KN.games.addToPool(s.roulette, cmd.video, who, cmd.byId || fromId);
        if (!out.added) { toast(out.reason, "warn"); broadcastState({ quiet: true, progress: true }); return; }
        notice(who + " put “" + out.entry.title + "” in the roulette", null, fromId);
        break;
      }
      case CMD.GAME_REMOVE:
        if (!KN.games.removeFromPool(s.roulette, cmd.rid)) return;
        break;
      case CMD.GAME_CONFIG:
        s.roulette.includeHost = !!cmd.includeHost;
        break;
      case CMD.GAME_QUEUE: {
        if (!KN.games.canSpin(s.roulette)) {
          toast("A roulette round needs at least " + KN.games.MIN_POOL + " songs in the pot.", "warn");
          return;
        }
        if (s.queue.length >= R.QUEUE_LIMIT) { toast("The queue is full.", "warn"); return; }
        s.queue.push(KN.games.queueCard("roulette", who, cmd.byId || fromId));
        notice(who + " queued a round of Song Roulette");
        if (!s.now && s.player.status === "idle") { nextSong(); return; }
        break;
      }
      case CMD.GAME_AGAIN:
        // Only meaningful inside the few seconds the offer is up.
        if (!s.spinOffer) return;
        spinAgain();
        return;

      case CMD.PLAY_NOW: {
        var i = R.indexOfSid(s.queue, cmd.sid);
        if (i < 0) break;
        var song = s.queue.splice(i, 1)[0];
        if (s.now) s.queue.unshift(s.now);
        s.now = song;
        s.player.time = 0;
        s.player.status = "loading";
        if (app.player) { app.player.load(song.id); app.player.play(); }
        break;
      }
      default: {
        var result = R.apply(s, cmd, who);
        // The sender already gave themselves feedback locally; tell everyone else.
        if (result.notice) notice(result.notice, null, fromId);
        if (!result.changed) { broadcastState({ quiet: true, progress: true }); return; }
        // First song added to an idle room starts playing by itself.
        if (!s.now && s.queue.length && s.player.status === "idle") { nextSong(); return; }
        break;
      }
    }
    broadcastState();
  }

  /* ---------------- scoring ----------------
   * The score is the punchline of a karaoke song, so it lands on the stage
   * itself — which means it survives fullscreen, where every other panel in
   * the app is off-screen. A skipped song never gets one: half a chorus is not
   * a performance, and scoring it would make the number worthless.
   *
   * It is not simply printed any more. A number that appears is information;
   * a number that climbs, under a drumroll, in front of the person who just
   * sang, is the moment the whole app exists for. The count-up eases out, so
   * it races through the seventies and then agonises over the last three —
   * which is where the room actually makes noise. The leaderboard slides in
   * underneath afterwards and physically moves the singer to their new place,
   * because "you went up two" is worth watching happen.
   */
  var SCORE_COUNT_MS = 2800;      // the climb to the number
  var SCORE_BOARD_MS = 1100;      // the pause before the table reshuffles
  var SCORE_HOLD_MS = 5200;       // and how long the whole thing stays up
  var SCORE_MS = SCORE_COUNT_MS + SCORE_BOARD_MS + SCORE_HOLD_MS;
  var SPIN_OFFER_MS = 3000;       // the window to go round again

  var scoreTimer = null;
  var scoreAnim = null;

  function reducedMotion() {
    return !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function sfxOn() {
    var c = app.state && app.state.config;
    return !c || c.sounds !== false;
  }

  function songFinished() {
    var s = app.state;
    var song = s.now;
    if (!song || !s.config || !s.config.scoring) { nextSong(); return; }

    // The table as it stood before this song, so the card can show the move
    // rather than the destination.
    var before = R.standings(s);
    var entry = R.recordScore(s, song);
    var after = R.standings(s);
    judgeRoulette(entry, song);

    noteMyScore(entry, song);
    showScore(entry, before, after);
    broadcastState();

    clearTimeout(scoreTimer);
    scoreTimer = setTimeout(function () {
      s.lastScore = null;
      // A roulette round earns the room a few seconds to go again on the spot.
      if (song.viaGame === "roulette" && KN.games.hasSongs(s.roulette) && app.role === "host") {
        offerSpinAgain();
        return;
      }
      nextSong();
    }, SCORE_MS);
  }

  /* Only this phone's own songs go into this phone's own statistics. On the
   * host, "mine" is the host; on a guest it is whatever client id the host
   * gave it. Names are not good enough — two Jos are two singers. */
  function noteMyScore(entry, song) {
    if (!KN.stats) return;
    var me = app.role === "host" ? "host" : app.clientId;
    if (!me || entry.by !== me) return;
    KN.stats.recordSong({
      title: entry.title,
      score: entry.score,
      seconds: (song && song.duration) || entry.seconds || 0
    });
    if (entry.game === "roulette") noteRouletteRound(entry);
  }

  /**
   * A roulette round is won by taking the top roulette score of the night —
   * the crown changes hands or it does not. The first round of an evening has
   * nothing to beat, so it takes the crown and counts as neither: a win handed
   * out for being first would make every winrate meaningless.
   *
   * The host decides this once and writes the answer onto the score entry.
   * Every phone then reads the same verdict off the same snapshot, rather than
   * each racing the crown it can see against the score that just changed it.
   */
  function judgeRoulette(entry, song) {
    if (!song || song.viaGame !== "roulette") return;
    var rl = app.state.roulette;
    if (!rl) return;
    var crown = rl.crown;
    entry.gameResult = !crown ? null : entry.score > crown.score ? "win" : "loss";
    if (!crown || entry.score > crown.score) {
      rl.crown = { name: entry.name, by: entry.by, score: entry.score, at: entry.at };
    }
  }

  function noteRouletteRound(entry) {
    if (entry.gameResult) KN.stats.recordGame("roulette", entry.gameResult);
  }

  function showScore(entry, before, after) {
    var card = $("#score-card");
    if (!card) return;
    var value = $("#score-value");
    var line = $("#score-line");
    $("#score-who").textContent = entry.name;
    line.textContent = entry.line;
    card.dataset.band = entry.band;
    card.hidden = false;
    card.classList.remove("revealed");
    // Restart the entrance animation even when two songs end back to back.
    card.classList.remove("in");
    void card.offsetWidth;
    card.classList.add("in");

    var board = $("#score-board");
    if (board) { board.hidden = true; board.innerHTML = ""; }

    countUp(value, entry.score, function () {
      card.classList.add("revealed");
      if (sfxOn() && entry.score >= 95) KN.sound.fanfare();
      speak(entry.line);
      setTimeout(function () { revealBoard(before, after, entry); }, SCORE_BOARD_MS);
    });
  }

  /**
   * Counts `node` from zero to `target`, easing out, and ticks as it goes.
   * The ticks are paced off the same curve as the number, so they thin out as
   * it settles — which is what makes it read as a wheel slowing down rather
   * than as a progress bar filling.
   */
  function countUp(node, target, done) {
    if (scoreAnim) { cancelAnimationFrame(scoreAnim.frame); if (scoreAnim.roll) scoreAnim.roll.stop(); }
    if (reducedMotion()) { node.textContent = String(target); done(); return; }

    var roll = sfxOn() ? KN.sound.drumroll(SCORE_COUNT_MS / 1000) : null;
    var began = 0;
    var lastTick = 0;
    var state = { frame: 0, roll: roll };
    scoreAnim = state;

    function step(now) {
      if (scoreAnim !== state) return;
      if (!began) began = now;
      var p = Math.min(1, (now - began) / SCORE_COUNT_MS);
      var eased = 1 - Math.pow(1 - p, 3);
      node.textContent = String(Math.round(target * eased));

      // 40ms between ticks at the start, a third of a second by the end.
      var gap = 40 + 300 * p * p;
      if (sfxOn() && now - lastTick >= gap) {
        lastTick = now;
        KN.sound.tick(1 - 0.5 * p);
      }

      if (p < 1) { state.frame = requestAnimationFrame(step); return; }
      node.textContent = String(target);
      if (roll) roll.crest();
      scoreAnim = null;
      done();
    }
    state.frame = requestAnimationFrame(step);
  }

  /** The table, drawn where it was and then moved to where it is now. */
  function revealBoard(before, after, entry) {
    var board = $("#score-board");
    if (!board || !after.length || !(app.state.config && app.state.config.leaderboard)) return;
    var top = after.slice(0, 5);
    var wasRank = {};
    before.forEach(function (r, i) { wasRank[r.name] = i; });

    /* Painted in the *old* order first — including the singer at their old
     * place — so the move that follows is the animation rather than the
     * table simply appearing already sorted. */
    var opening = top.slice().sort(function (a, b) {
      var ai = wasRank[a.name], bi = wasRank[b.name];
      if (ai === undefined) return 1;
      if (bi === undefined) return -1;
      return ai - bi;
    });

    board.innerHTML = "";
    opening.forEach(function (row) { board.appendChild(stageBoardRow(row, top.indexOf(row) + 1)); });
    board.hidden = false;

    if (reducedMotion()) { paintStageBoard(board, top, entry); return; }
    requestAnimationFrame(function () {
      withClimb(board, function () { paintStageBoard(board, top, entry); });
    });
  }

  function paintStageBoard(board, top, entry) {
    board.innerHTML = "";
    top.forEach(function (row, i) {
      var node = stageBoardRow(row, i + 1);
      if (entry && row.name === entry.name) node.classList.add("sb-you");
      board.appendChild(node);
    });
  }

  function stageBoardRow(row, rank) {
    var node = el("li", { class: "sb-row" }, [
      el("span", { class: "sb-rank", text: String(rank) }),
      el("span", { class: "sb-name", text: row.name }),
      el("span", { class: "sb-score", text: String(row.best) })
    ]);
    node.setAttribute("data-key", row.name);
    return node;
  }

  /**
   * Re-render `container`, then slide every row that moved from where it was
   * to where it now is. The rows are keyed by `data-key`, so this works on any
   * list that labels them — the stage card and the Scores tab both use it.
   *
   * Measured against the viewport rather than the offset parent: the stage
   * card is inside a fullscreen element whose offset parent changes underneath
   * it, and a delta measured against a moving origin animates rows to places
   * they were never in.
   */
  function withClimb(container, render) {
    var before = {};
    $$("[data-key]", container).forEach(function (n) {
      before[n.getAttribute("data-key")] = n.getBoundingClientRect().top;
    });
    render();
    if (reducedMotion()) return;
    $$("[data-key]", container).forEach(function (n) {
      var key = n.getAttribute("data-key");
      if (!(key in before)) { n.classList.add("row-enter"); return; }
      var delta = before[key] - n.getBoundingClientRect().top;
      if (!delta) return;
      n.style.transition = "none";
      n.style.transform = "translateY(" + delta + "px)";
      // Moving up the table is the thing worth celebrating; moving down
      // happens to you and does not need a highlight.
      if (delta > 0) n.classList.add("row-climb");
      requestAnimationFrame(function () {
        n.style.transition = "";
        n.style.transform = "";
      });
    });
  }

  function hideScore() {
    var card = $("#score-card");
    if (card) { card.hidden = true; card.classList.remove("in", "revealed"); }
    if (scoreAnim) {
      cancelAnimationFrame(scoreAnim.frame);
      if (scoreAnim.roll) scoreAnim.roll.stop();
      scoreAnim = null;
    }
  }

  /* Speech synthesis is the one text-to-speech every browser already has: no
   * key, no network, no library. Voices differ wildly, so the line has to read
   * well flat — and a browser with the API missing or muted simply gets the
   * card without the shouting. */
  function speak(text) {
    var synth = global.speechSynthesis;
    if (!synth || typeof global.SpeechSynthesisUtterance !== "function") return;
    try {
      synth.cancel();
      var u = new global.SpeechSynthesisUtterance(text);
      u.rate = 0.98;
      u.pitch = 1.15;
      u.volume = 1;
      synth.speak(u);
    } catch (e) { /* a voice list that never loaded — not worth reporting */ }
  }

  /* ---------------- Song Roulette ----------------
   * A game card reaching the front of the queue is the room stopping to spin.
   * Both wheels run on the host screen, because that is the screen everybody
   * is already looking at — the same reasoning that puts the score there. A
   * guest sees the state change and is told the outcome; a phone in a pocket
   * showing its own private wheel would be a second thing to watch during the
   * one moment the room is watching together.
   */
  var SPIN_STEP_MS = 3400;
  var spinTimers = [];

  /* The countdown is an interval and everything else is a timeout, and the two
   * id spaces are only the same one by convention — so cancel both ways rather
   * than leaving a ticking clock behind on an engine that keeps them apart. */
  function clearSpinTimers() {
    spinTimers.forEach(function (id) { clearTimeout(id); clearInterval(id); });
    spinTimers = [];
  }
  function later(fn, ms) {
    var id = setTimeout(fn, ms);
    spinTimers.push(id);
    return id;
  }

  function runRoulette() {
    var s = app.state;
    var G = KN.games;
    clearSpinTimers();

    if (!G.hasSongs(s.roulette)) {
      notice("The roulette ran out of songs — skipping the round.", "warn");
      s.spin = null;
      nextSong();
      return;
    }
    var people = G.candidates(s);
    var singer = G.spinSinger(s);
    if (!singer) { s.spin = null; nextSong(); return; }

    spinPhase("singer", "Who is singing?",
      G.reel(people.map(function (p) { return p.name; }), singer.name),
      singer.name,
      function () {
        var song = G.spinSong(s.roulette);
        if (!song) { s.spin = null; nextSong(); return; }
        spinPhase("song", singer.name + " is singing…",
          G.reel(s.roulette.pool.concat([song]).map(function (e) { return e.title; }), song.title),
          song.title,
          function () { startRouletteSong(singer, song); });
      });
  }

  function spinPhase(phase, label, names, landing, done) {
    var s = app.state;
    s.spin = { phase: phase, label: label, landing: landing, at: Date.now() };
    broadcastState();
    animateReel(label, names, landing, function () {
      later(done, 900);
    });
  }

  /**
   * The wheel itself: names flashing past, slowing to a stop. The interval
   * lengthens on the same curve the score's count-up uses, so a spin and a
   * score feel like the same machine, and every step ticks.
   */
  function animateReel(label, names, landing, done) {
    var card = $("#spin-card");
    var reel = $("#spin-reel");
    if (!card || !reel) { done(); return; }
    hideScore();
    hideUpNext();
    $("#spin-label").textContent = label;
    $("#spin-sub").textContent = "";
    card.hidden = false;
    card.classList.remove("landed");

    if (reducedMotion() || !names.length) {
      reel.textContent = landing;
      card.classList.add("landed");
      if (sfxOn()) KN.sound.chime();
      later(done, 700);
      return;
    }

    var i = 0;
    var began = Date.now();
    function step() {
      var p = Math.min(1, (Date.now() - began) / SPIN_STEP_MS);
      reel.textContent = names[i % names.length];
      reel.classList.remove("flip");
      void reel.offsetWidth;
      reel.classList.add("flip");
      if (sfxOn()) KN.sound.tick(1 - 0.4 * p);
      i++;
      if (p >= 1) {
        reel.textContent = landing;
        card.classList.add("landed");
        if (sfxOn()) KN.sound.chime();
        later(done, 700);
        return;
      }
      later(step, 55 + 340 * p * p);
    }
    step();
  }

  function startRouletteSong(singer, pick) {
    var s = app.state;
    var song = R.toSong(pick, singer.name, singer.id);
    song.viaGame = "roulette";
    s.roulette.lastSingerId = singer.id;
    s.roulette.rounds++;
    s.now = song;
    s.player.time = 0;
    s.player.duration = song.duration || 0;
    s.player.status = "loading";
    s.spin = null;

    $("#spin-card").hidden = true;
    notice("Song Roulette: " + singer.name + " sings “" + song.title + "”");
    if (app.player) { app.player.load(song.id); app.player.play(); }
    broadcastState();
  }

  function offerSpinAgain() {
    var s = app.state;
    s.spinOffer = { at: Date.now(), ms: SPIN_OFFER_MS };
    broadcastState();

    var box = $("#spin-again");
    var count = $("#spin-again-count");
    if (box) {
      mountOffer("stage");
      box.hidden = false;
      var left = Math.round(SPIN_OFFER_MS / 1000);
      if (count) count.textContent = String(left);
      var beat = setInterval(function () {
        left--;
        if (count) count.textContent = String(Math.max(0, left));
        if (left <= 0) clearInterval(beat);
      }, 1000);
      spinTimers.push(beat);
    }
    later(function () {
      if (!app.state || !app.state.spinOffer) return;
      clearSpinOffer();
      nextSong();
    }, SPIN_OFFER_MS);
  }

  function clearSpinOffer() {
    clearSpinTimers();
    var box = $("#spin-again");
    if (box) box.hidden = true;
    app.offerSeenAt = 0;
    if (app.state) app.state.spinOffer = null;
  }

  /** The offer is one element with two homes: inside the stage on the host,
   *  where it survives fullscreen, and in the room body on a phone. */
  function mountOffer(slotId) {
    var box = $("#spin-again");
    var slot = $("#" + slotId);
    if (box && slot && box.parentNode !== slot) slot.appendChild(box);
  }

  /**
   * A co-host is usually holding a phone, not the host screen, and the offer
   * is explicitly theirs to take too — so it has to exist somewhere they can
   * reach it. The countdown is measured from when *this* device first saw the
   * offer rather than from the host's timestamp: two phones at a party do not
   * agree about the time to the second, and a countdown that starts at -2 is
   * worse than one that is a beat late.
   */
  function renderSpinOffer() {
    if (app.role === "host") return;          // the host runs its own countdown
    var box = $("#spin-again");
    if (!box) return;
    var offer = app.state && app.state.spinOffer;
    if (!offer || !canManage()) {
      box.hidden = true;
      app.offerSeenAt = 0;
      return;
    }
    if (!app.offerSeenAt) app.offerSeenAt = Date.now();
    mountOffer("spin-slot-guest");
    box.hidden = false;
    var left = Math.ceil((offer.ms - (Date.now() - app.offerSeenAt)) / 1000);
    $("#spin-again-count").textContent = String(Math.max(0, Math.min(Math.round(offer.ms / 1000), left)));
  }

  /** "Spin again" — from the host's own button or a co-host's phone. */
  function spinAgain() {
    if (app.role !== "host") return;
    var s = app.state;
    clearSpinOffer();
    hideScore();
    s.lastScore = null;
    if (!KN.games.hasSongs(s.roulette)) {
      notice("The roulette pot is empty — add some songs first.", "warn");
      nextSong();
      return;
    }
    broadcastState();
    runRoulette();
  }

  function nextSong() {
    var s = app.state;
    clearTimeout(scoreTimer);
    clearSpinOffer();
    s.lastScore = null;
    s.spin = null;
    hideScore();
    hideUpNext();
    var spin = $("#spin-card");
    if (spin) spin.hidden = true;
    var next = R.advance(s);

    // A roulette card is not a video: it is the room stopping to spin one up.
    if (next && KN.games.isGameCard(next)) {
      broadcastState();
      runRoulette();
      return;
    }
    if (app.player) {
      if (next) { app.player.load(next.id); app.player.play(); }
      else app.player.stop();
    }
    broadcastState();
  }

  function refreshGuestList() {
    var links = app.net.guests();
    /* Someone in the lobby is connected but is not in the room: they are not
     * a singer, they cannot be picked by the roulette, and they do not count
     * towards the guest tally on the header. */
    app.state.guests = links
      .filter(function (l) { return !waiting(l.id); })
      .map(function (l) {
        return { id: l.id, name: app.guestNames[l.id] || "Guest", cohost: !!app.cohosts[l.id] };
      });
    app.state.pending = links
      .filter(function (l) { return waiting(l.id); })
      .map(function (l) { return { id: l.id, name: app.guestNames[l.id] || "Guest", at: Date.now() }; });
    app.state.cohosts = app.cohosts;
    app.state.hostName = app.name || "Host";
  }

  /**
   * What a given link is allowed to see. Someone still in the lobby gets the
   * shape of a room and nothing that is in it: no queue, no guest list, no
   * scores, no roulette pot. Refusing their commands but handing them the
   * whole room to read would be a lock on a door with the window open.
   */
  function snapshotFor(link) {
    var s = app.state;
    if (!waiting(link.id)) return s;
    return {
      code: s.code,
      rev: s.rev,
      now: null,
      queue: [],
      guests: [],
      pending: [],
      cohosts: {},
      hostName: s.hostName,
      player: { status: "idle", time: 0, duration: 0, volume: s.player.volume, muted: s.player.muted },
      config: s.config,
      scores: [],
      lastScore: null,
      roulette: KN.games.createRoulette(),
      spin: null,
      spinOffer: null,
      lobby: true,
      startedAt: s.startedAt
    };
  }

  function sendStateTo(link) {
    link.send({ type: MSG.STATE, rev: app.state.rev, state: snapshotFor(link) });
  }

  var lastBroadcast = 0;
  var broadcastPending = null;
  function broadcastState(opts) {
    if (app.role !== "host") return;
    // A guest stamps its requests with the rev it last saw, and the host uses
    // that to tell a fresh request from a stale one. Playback progress ticks
    // every second regardless of anything a guest could be acting on, so it
    // must not count as a revision — otherwise a guest's view is "stale" the
    // instant a song is playing and every real command gets bounced.
    if (!(opts && opts.progress)) app.state.rev++;
    render();
    persistHost();

    // Progress ticks would otherwise flood the channel once a second per guest.
    var quiet = opts && opts.quiet;
    var progress = opts && opts.progress;
    var now = Date.now();
    if (quiet && now - lastBroadcast < 2500) {
      clearTimeout(broadcastPending);
      broadcastPending = setTimeout(function () {
        broadcastState({ quiet: true, progress: progress });
      }, 2500);
      return;
    }
    clearTimeout(broadcastPending);
    lastBroadcast = now;
    /* One snapshot per link rather than one for the room: what a guest in the
     * lobby may see is different from what a guest in the room may see, and
     * `broadcast` cannot tell them apart. When nobody is waiting this is the
     * same message sent the same number of times. */
    app.net.guests().forEach(function (link) { sendStateTo(link); });
  }

  function notice(text, kind, exceptId) {
    toast(text, kind);
    if (app.role !== "host" || !app.net) return;
    app.net.guests().forEach(function (link) {
      if (link.id === exceptId) return;
      link.send({ type: MSG.NOTICE, text: text, kind: kind });
    });
  }

  function persistHost() {
    if (app.role !== "host") return;
    save(STORE.host, {
      at: Date.now(),
      code: app.state.code,
      token: app.hostToken,
      queue: app.state.queue,
      now: app.state.now,
      rev: app.state.rev,
      config: app.state.config,
      scores: app.state.scores,
      roulette: app.state.roulette,
      approved: app.approved
    });
  }

  /* ================= GUEST ================= */

  function startGuest(code) {
    app.role = "guest";
    app.state = R.createState(code);
    app.name = app.name || loadName() || "";

    app.net = KN.net.join(code, {
      state: function (s, detail) {
        app.connection = s;
        renderConnection(detail);
      },
      open: function () {
        app.net.send({ type: CMD.HELLO, name: app.name || "Guest" });
        app.net.send({ type: CMD.RESYNC });
      },
      message: function (data) { onHostMessage(data); },
      closed: function () { renderConnection(); },
      wake: function () {
        // The channel proved itself alive, but it was deaf while we were away.
        app.net.send({ type: CMD.HELLO, name: app.name || "Guest" });
        app.net.send({ type: CMD.RESYNC });
      }
    });

    save(STORE.guest, { at: Date.now(), code: code });
    if (KN.stats) KN.stats.startSession({ code: code, role: "guest" });
    showRoom();
  }

  function onHostMessage(data) {
    if (!data || !data.type) return;
    switch (data.type) {
      case MSG.WELCOME:
        app.clientId = data.clientId;
        break;
      case MSG.STATE: {
        // Snapshots are authoritative; an out-of-order straggler is dropped.
        if (app.state && data.rev < app.state.rev) return;
        app.state = data.state;
        app.waiting = !!app.state.lobby;
        if (KN.sound) KN.sound.setEnabled(!app.state.config || app.state.config.sounds !== false);
        // A guest has no stage to put the score on, so it arrives as a toast —
        // once, on the snapshot that first carried it.
        var sc = app.state.lastScore;
        if (sc && sc.at !== app.lastScoreAt) {
          app.lastScoreAt = sc.at;
          toast(sc.name + " scored " + sc.score + " — " + sc.line, sc.score >= 95 ? "ok" : null);
          // The host is the one that scored it; this phone still keeps its own
          // half of the record when the song was this phone's.
          noteMyScore(sc, null);
        }
        render();
        break;
      }
      case MSG.NOTICE:
        toast(data.text, data.kind);
        break;
      case MSG.WAIT:
        app.waiting = true;
        renderLobby();
        break;
      case MSG.BYE: {
        var why = {
          kicked: "You were removed from the room.",
          refused: "The host did not let you into the room."
        };
        toast(why[data.reason] || "The host closed the room.", "warn");
        leave();
        break;
      }
    }
  }

  /* ================= shared ================= */

  /** Host applies; guest asks. A guest stamps its request with the revision
   * its own mirror is on, so the host can tell a fresh request from one built
   * on a view that has since moved on. */
  function dispatch(cmd) {
    if (cmd.type === CMD.ADD && !cmd.byId) cmd.byId = app.role === "host" ? "host" : app.clientId;
    if (app.role === "host") handle(cmd, app.name || "Host");
    else if (app.net) {
      cmd.rev = app.state ? app.state.rev : 0;
      app.net.send(cmd);
      if (!app.net.isOpen()) toast("Offline — queued until you reconnect.", "warn");
    }
  }

  /** The host, and anyone it has made a co-host, can run the room. */
  function canManage() {
    if (app.role === "host") return true;
    var s = app.state;
    return !!(s && s.cohosts && app.clientId && s.cohosts[app.clientId]);
  }

  function displayName() {
    return app.name || (app.role === "host" ? "Host" : "Guest");
  }

  function loadName() {
    try { return localStorage.getItem(STORE.name) || ""; } catch (e) { return ""; }
  }
  function saveName(n) {
    app.name = n;
    try { localStorage.setItem(STORE.name, n); } catch (e) { /* ignore */ }
    if (app.role === "guest" && app.net) app.net.send({ type: CMD.NAME, name: n });
    else if (app.role === "host") { app.state.hostName = n; broadcastState({ progress: true }); }
    else render();
  }

  function leave() {
    var net = app.net;
    if (app.role === "host" && net) {
      net.broadcast({ type: MSG.BYE, reason: "closed" });
      forget(STORE.host);
      // Give the goodbye a moment to leave the wire before tearing it down.
      setTimeout(function () { net.stop(); }, 200);
    } else if (net) net.stop();
    if (app.player) app.player.destroy();
    clearInterval(ticker);
    clearTimeout(scoreTimer);
    clearSpinOffer();
    hideScore();
    hideUpNext();
    if (KN.stats) KN.stats.endSession();
    forget(STORE.guest);
    app.role = null;
    app.net = null;
    app.player = null;
    app.state = null;
    app.guestNames = {};
    app.cohosts = {};
    app.approved = {};
    app.waiting = false;
    app.upNextFor = null;
    app.lastScoreAt = 0;
    document.body.classList.remove("can-manage");
    location.hash = "#/";
    showHome();
  }

  /* ---------------- screen: home ---------------- */

  function showLibrary() {
    $("#view-home").hidden = true;
    $("#view-room").hidden = true;
    $("#view-stats").hidden = true;
    $("#view-library").hidden = false;
    document.body.classList.remove("in-room", "is-host");
    mountInto("search-root", "search-slot-library");
    mountLibrary("library-slot-standalone");
  }

  /* ---------------- screen: statistics ----------------
   * A page about you, made only of things this browser already knew. It is
   * worth being handsome — a wall of numbers nobody looks at twice is a wall
   * of numbers that may as well not be collected — and worth being honest
   * about where it lives, which the banner at the top does in plain words.
   */

  function showStats() {
    $("#view-home").hidden = true;
    $("#view-room").hidden = true;
    $("#view-library").hidden = true;
    $("#view-stats").hidden = false;
    document.body.classList.remove("in-room", "is-host");
    renderStats();
  }

  function fmtSpan(ms) {
    var mins = Math.round(ms / 60000);
    if (!mins) return "—";
    if (mins < 60) return mins + "m";
    var hours = Math.floor(mins / 60);
    var rest = mins % 60;
    return rest ? hours + "h " + rest + "m" : hours + "h";
  }

  function fmtDate(at) {
    if (!at) return "";
    try { return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
    catch (e) { return ""; }
  }

  function statCard(label, value, sub, tone) {
    return el("div", { class: "stat" + (tone ? " stat-" + tone : "") }, [
      el("div", { class: "stat-value", text: value }),
      el("div", { class: "stat-label", text: label }),
      sub ? el("div", { class: "stat-sub", text: sub }) : null
    ]);
  }

  function renderStats() {
    if (!KN.stats) return;
    var empty = KN.stats.isEmpty();
    $("#stats-empty").hidden = !empty;
    $("#stats-body").hidden = empty;
    $("#stats-clear").hidden = empty;
    if (empty) return;

    var sum = KN.stats.summary();
    var cards = $("#stats-cards");
    cards.innerHTML = "";
    [
      statCard("Average score", String(sum.average || "—"), sum.songs + (sum.songs === 1 ? " song" : " songs"), "hero"),
      statCard("Best score", String(sum.best || "—"), sum.best > 100 ? "you broke the machine" : ""),
      statCard("Songs sung", String(sum.songs), sum.worst ? "lowest " + sum.worst : ""),
      statCard("Time at the microphone", fmtSpan(sum.singMs), ""),
      statCard("Karaoke sessions", String(sum.sessions), sum.hosted ? sum.hosted + " hosted" : "none hosted"),
      statCard("Time in rooms", fmtSpan(sum.roomMs), sum.firstAt ? "since " + fmtDate(sum.firstAt) : "")
    ].forEach(function (c) { cards.appendChild(c); });

    if (sum.bestSession) {
      cards.appendChild(statCard(
        "Best night",
        String(sum.bestSession.average),
        "room " + (sum.bestSession.code || "—") + " · " + sum.bestSession.songs + " songs · " + fmtDate(sum.bestSession.at)
      ));
    }

    var games = $("#stats-games");
    games.innerHTML = "";
    if (!sum.games.length) {
      games.appendChild(el("p", { class: "empty", text: "No games played yet. Try Song Roulette in a room." }));
    }
    var NAMES = { roulette: "Song Roulette" };
    sum.games.forEach(function (g) {
      games.appendChild(
        el("div", { class: "game-stat" }, [
          el("div", { class: "game-stat-head" }, [
            el("span", { class: "game-stat-ico" }, [KN.icon("dice")]),
            el("strong", { text: NAMES[g.game] || g.game })
          ]),
          el("div", { class: "game-stat-bar" }, [
            el("span", {
              class: "game-stat-fill",
              style: "width:" + (g.winrate === null ? 0 : g.winrate) + "%"
            })
          ]),
          el("div", { class: "game-stat-nums", text:
            (g.winrate === null ? "no decided rounds yet" : g.winrate + "% winrate") +
            " · " + g.played + " played · " + g.wins + "W " + g.losses + "L" })
        ])
      );
    });
    games.appendChild(el("p", {
      class: "side-note",
      text: "A round of Song Roulette is won by taking the night's top roulette score. The first round of an evening has nothing to beat, so it counts as neither."
    }));

    var list = $("#stats-sessions");
    list.innerHTML = "";
    KN.stats.sessions().slice(0, 20).forEach(function (n) {
      list.appendChild(
        el("li", { class: "row" }, [
          el("span", { class: "score-pill", text: String(n.average || "—") }),
          el("div", { class: "row-meta" }, [
            el("div", { class: "row-title", text: "Room " + (n.code || "—") + (n.role === "host" ? " · hosted" : "") }),
            el("div", { class: "row-sub", text:
              fmtDate(n.startedAt) + " · " + n.songs + (n.songs === 1 ? " song" : " songs") +
              " · " + fmtSpan(n.ms) + (n.best ? " · best " + n.best : "") })
          ]),
          n.open ? el("span", { class: "row-flag", text: "open" }) : null
        ])
      );
    });

    var songs = $("#stats-songs");
    songs.innerHTML = "";
    KN.stats.songs().slice(0, 25).forEach(function (row) {
      songs.appendChild(
        el("li", { class: "row" }, [
          el("span", { class: "score-pill", "data-band": R.scoreBand(row.score), text: String(row.score) }),
          el("div", { class: "row-meta" }, [
            el("div", { class: "row-title", text: row.title || "A song" }),
            el("div", { class: "row-sub", text: fmtDate(row.at) + (row.ms ? " · " + fmtSpan(row.ms) : "") })
          ])
        ])
      );
    });
  }

  function renderStatsTeaser() {
    var line = $("#stats-teaser");
    if (!line || !KN.stats) return;
    if (KN.stats.isEmpty()) { line.textContent = "Your scores, once you have some"; return; }
    var sum = KN.stats.summary();
    line.textContent =
      sum.songs + (sum.songs === 1 ? " song" : " songs") +
      " · avg " + sum.average +
      " · " + sum.sessions + (sum.sessions === 1 ? " session" : " sessions");
  }

  function showHome() {
    $("#view-home").hidden = false;
    $("#view-room").hidden = true;
    $("#view-library").hidden = true;
    $("#view-stats").hidden = true;
    document.body.classList.remove("in-room", "is-host");
    renderLibrary();
    renderStatsTeaser();
    $("#join-name").value = app.name || loadName() || "";

    // Offer to pick up wherever this browser left off — hosting outranks
    // guesting, since a host walking away ends everyone else's night.
    var host = load(STORE.host);
    var guest = load(STORE.guest);
    var box = $("#resume");

    if (host) {
      app.resume = { kind: "host", data: host };
      $("#resume-text").innerHTML =
        "You left a room open — <strong>" + host.code + "</strong>, " +
        host.queue.length + (host.queue.length === 1 ? " song" : " songs") + " waiting.";
      $("#resume-btn").textContent = "Reopen it";
    } else if (guest) {
      app.resume = { kind: "guest", data: guest };
      $("#resume-text").innerHTML = "You were in room <strong>" + guest.code + "</strong>.";
      $("#resume-btn").textContent = "Rejoin";
    } else {
      app.resume = null;
    }
    box.hidden = !app.resume;
  }

  /* ---------------- fullscreen ---------------- */

  /** The element the browser considers fullscreen, whatever it calls it. */
  function fsElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  /** Fullscreen the video stage, or leave it if it is already there. */
  function toggleFullscreen() {
    var stage = $("#stage");
    if (fsElement()) {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      return;
    }
    var req = stage.requestFullscreen || stage.webkitRequestFullscreen;
    if (!req) {
      toast("This browser will not let the page go fullscreen.");
      return;
    }
    var out = req.call(stage);
    if (out && out.catch) out.catch(function () { /* refused — nothing to undo */ });
  }

  /** Keeps the body flag and the button's icon honest about the current state. */
  function syncFullscreen() {
    var on = fsElement() === $("#stage");
    document.body.classList.toggle("stage-fullscreen", on);
    var btn = $("#fs-btn");
    if (!btn) return;
    KN.setIcon(btn, on ? "fullscreen-exit" : "fullscreen");
    btn.title = on ? "Exit fullscreen" : "Fullscreen";
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("aria-pressed", String(on));
  }

  /* ---------------- screen: room ---------------- */

  function showRoom() {
    $("#view-home").hidden = true;
    $("#view-library").hidden = true;
    $("#view-stats").hidden = true;
    $("#view-room").hidden = false;
    document.body.classList.add("in-room");
    document.body.classList.toggle("is-host", app.role === "host");
    $("#room-code").textContent = app.state.code;
    $("#room-code-2").textContent = app.state.code;
    $("#room-code-3").textContent = app.state.code;
    $("#room-code-4").textContent = app.state.code;
    $("#name-input").value = app.name;
    renderShare();
    render();
  }

  function joinUrl() {
    return location.origin + location.pathname + "#/r/" + app.state.code;
  }

  function renderShare() {
    $("#share-url").textContent = joinUrl().replace(/^https?:\/\//, "");
    var url = joinUrl();
    var ok = true;

    /* The corner code on a fullscreen stage should be the smallest thing a
     * camera can still lock onto, and "smallest" depends entirely on how far
     * away the screen is — which the page can only guess at from its width. A
     * phone held at arm's length reads 2 pixels per module happily; a TV
     * across a living room needs the extra ones. */
    var opts = [
      ["#qr", { px: 260 }],
      ["#qr-rail", { px: 180 }],
      ["#qr-fs", { scale: fsModuleScale() }]
    ];
    opts.forEach(function (pair) {
      var canvas = $(pair[0]);
      if (!canvas) return;
      try {
        var o = { ecc: "M", dark: "#0b0b12", light: "#ffffff", quiet: 3 };
        Object.keys(pair[1]).forEach(function (k) { o[k] = pair[1][k]; });
        QR.draw(canvas, url, o);
        canvas.hidden = false;
      } catch (e) {
        canvas.hidden = true;
        ok = false;
      }
    });
    $("#qr-fallback").hidden = ok;

    // The rail is the host's always-visible copy; a guest already has the room.
    var rail = $("#invite-rail");
    rail.hidden = app.role !== "host";
    rail.classList.toggle("collapsed", !app.railOpen);
    $("#rail-toggle").setAttribute("aria-expanded", String(app.railOpen));
  }

  /** Device-independent pixels per QR module for the fullscreen corner code. */
  function fsModuleScale() {
    var w = global.innerWidth || 1280;
    if (w < 760) return 2;    // a phone, held at arm's length
    if (w < 1400) return 3;   // a laptop across a table
    if (w < 2000) return 4;   // a monitor or a small television
    return 5;                 // a big screen, read from the far sofa
  }

  function renderConnection(detail) {
    var badge = $("#conn");
    if (!badge) return;
    // A host with no broker left is still hosting, but nobody new can find it
    // — and that is exactly the moment worth showing. Before the first one
    // answers there is nothing to have lost yet, so that reads as connecting.
    if (app.role === "host" && app.net) {
      var listed = app.net.onlineBrokers() > 0;
      if (listed) app.hostWasListed = true;
      app.connection = listed ? "hosting" : (app.hostWasListed ? "unlisted" : "connecting");
    }
    var map = {
      connected: ["ok", "connected"],
      connecting: ["warn", "connecting…"],
      waiting: ["warn", "waiting for the host…"],
      retrying: ["warn", "reconnecting…"],
      stopped: ["bad", "left"],
      hosting: ["ok", "hosting"],
      unlisted: ["warn", "reconnecting…"]
    };
    var e = map[app.connection] || ["bad", app.connection];
    badge.className = "conn conn-" + e[0];
    badge.textContent = e[1];
    badge.title = detail ? "via " + detail : "";
    $("#retry-btn").hidden = app.role !== "guest" || app.connection === "connected";
  }

  function render() {
    if (!app.state) return;
    var manage = canManage();
    document.body.classList.toggle("can-manage", manage);

    renderConnection();
    renderLobby();
    renderSpinOffer();
    renderNow();
    renderQueue();
    renderProgress();
    renderSingers();
    renderScores();
    renderGames();
    renderConfig();

    var s = app.state;
    $("#guest-count").textContent = String(s.guests.length);
    $("#vol").value = s.player.volume;
    KN.setIcon($("#mute-btn"), s.player.muted ? "volume-off" : "volume-on");
    $("#mute-btn").setAttribute("aria-pressed", String(s.player.muted));
    KN.setIcon($("#play-btn"), s.player.status === "playing" ? "pause" : "play");
    $("#play-btn").setAttribute("aria-label", s.player.status === "playing" ? "Pause" : "Play");
    if (app.role === "host") $("#broker-count").textContent = String(app.net ? app.net.onlineBrokers() : 0);
  }

  function renderNow() {
    var s = app.state;
    var box = $("#now");
    var idle = $("#stage-idle");
    box.innerHTML = "";

    if (idle) idle.hidden = !(app.role === "host" && !s.now && !app.playerError);

    if (!s.now) {
      box.appendChild(el("p", { class: "empty", text: "Nothing playing. Add a song to start." }));
      return;
    }

    var song = s.now;

    /* A roulette card sitting in `now` is the room stopping to spin, not a
     * song: there is nothing to save to a library and nothing to file into a
     * playlist, and offering both would be two buttons that do nothing. */
    if (KN.games.isGameCard(song)) {
      box.appendChild(
        el("div", { class: "now-card" }, [
          el("span", { class: "row-gameicon now-gameicon" }, [KN.icon("dice")]),
          el("div", { class: "now-meta" }, [
            el("div", { class: "now-title", text: "Song Roulette" }),
            el("div", { class: "now-artist", text: "spinning for a singer and a song" })
          ])
        ])
      );
      return;
    }

    /* The song you are listening to is exactly when you decide you want to
     * keep it, and until now that meant finding it in search again. */
    var saved = LIB.hasSong(song.id);
    var star = el("button", {
      class: "icon-btn star" + (saved ? " on" : ""),
      title: saved ? "Saved to your library" : "Save to your library",
      "aria-label": "Save to your library",
      "aria-pressed": saved ? "true" : "false",
      onclick: function () {
        var on = LIB.toggleSong(song);
        toast(on ? "Saved “" + song.title + "”" : "Removed from saved");
        renderLibrary();
        renderNow();
      }
    }, [KN.icon(saved ? "star-filled" : "star")]);

    box.appendChild(
      el("div", { class: "now-card" }, [
        thumb("now-thumb", song.thumb),
        el("div", { class: "now-meta" }, [
          el("div", { class: "now-title", text: song.title }),
          el("div", { class: "now-artist", text: song.author || "—" }),
          el("div", { class: "now-by", text: "queued by " + song.addedBy })
        ]),
        el("div", { class: "now-actions" }, [
          star,
          btn("plus", "Add to a playlist", function () { openPicker(song); })
        ])
      ])
    );
  }

  /* ---------------- the lobby ----------------
   * On a guest: am I still outside? On the host: who is knocking? */

  function renderLobby() {
    var s = app.state;
    var stuck = app.role === "guest" && !!(app.waiting || (s && s.lobby));
    var banner = $("#lobby-wait");
    if (banner) banner.hidden = !stuck;
    document.body.classList.toggle("in-lobby", stuck);

    var pending = (s && s.pending) || [];
    var badge = $("#pending-count");
    if (badge) {
      badge.hidden = !pending.length || !canManage();
      badge.textContent = String(pending.length);
    }

    var box = $("#lobby");
    var list = $("#pending");
    if (!box || !list) return;
    box.hidden = !pending.length || !canManage();
    list.innerHTML = "";
    pending.forEach(function (g) {
      list.appendChild(
        el("li", { class: "row row-pending" }, [
          el("span", { class: "singer-dot singer-dot-wait" }),
          el("div", { class: "row-meta" }, [
            el("div", { class: "row-title", text: g.name }),
            el("div", { class: "row-sub", text: "asking to join" })
          ]),
          el("div", { class: "row-actions" }, [
            btn("check", "Let " + g.name + " in", function () {
              dispatch({ type: CMD.APPROVE, id: g.id, ok: true });
            }, "on"),
            btn("close", "Refuse " + g.name, function () {
              dispatch({ type: CMD.APPROVE, id: g.id, ok: false });
            })
          ])
        ])
      );
    });
  }

  /* ---------------- games ---------------- */

  function renderGames() {
    var s = app.state;
    if (!s) return;
    var G = KN.games;
    var rl = s.roulette || G.createRoulette();
    var pool = rl.pool || [];

    var count = $("#games-count");
    if (count) {
      count.hidden = !pool.length;
      count.textContent = String(pool.length);
    }

    var box = $("#cfg-roulette-host");
    if (box) {
      box.checked = rl.includeHost !== false;
      box.disabled = !canManage();
    }

    var list = $("#roulette-pool");
    if (!list) return;
    list.innerHTML = "";
    if (!pool.length) {
      list.appendChild(el("li", { class: "empty", text: "The pot is empty. Add songs from Search — the ＋ on a result offers the roulette." }));
    }
    pool.forEach(function (e) {
      list.appendChild(
        el("li", { class: "row" }, [
          thumb("row-thumb", e.thumb),
          el("div", { class: "row-meta" }, [
            el("div", { class: "row-title", text: e.title }),
            el("div", { class: "row-sub", text: "added by " + e.addedBy })
          ]),
          el("div", { class: "row-actions" }, [
            btn("close", "Take it out of the pot", function () {
              dispatch({ type: CMD.GAME_REMOVE, rid: e.rid });
            })
          ])
        ])
      );
    });

    var short = Math.max(0, G.MIN_POOL - pool.length);
    var hint = $("#roulette-hint");
    if (hint) {
      hint.textContent = short
        ? short + " more " + (short === 1 ? "song" : "songs") + " and this can go in the queue."
        : pool.length + " in the pot · " + pool.length + " " + (pool.length === 1 ? "round" : "rounds") +
          " before it runs dry" + (rl.rounds ? " · " + rl.rounds + " played" : "");
    }
    var go = $("#roulette-queue");
    if (go) {
      go.disabled = !G.canSpin(rl) || !canManage();
      go.title = canManage()
        ? (G.canSpin(rl) ? "" : "Needs at least " + G.MIN_POOL + " songs")
        : "Only the host and co-hosts can start a round";
    }
    var wipe = $("#roulette-clear");
    if (wipe) wipe.hidden = !canManage() || !pool.length;
  }

  /* ---------------- singers ---------------- */

  function renderSingers() {
    var s = app.state;
    var list = $("#singers");
    if (!list) return;
    list.innerHTML = "";

    var me = app.role === "host" ? "host" : app.clientId;
    var rows = [{ id: "host", name: s.hostName || "Host", role: "host" }].concat(
      (s.guests || []).map(function (g) {
        return { id: g.id, name: g.name, role: g.cohost ? "cohost" : "guest" };
      })
    );

    rows.forEach(function (g) {
      var actions = [];
      // The room's owner is not a role anyone can hand back — there would be
      // nobody left holding the player.
      if (app.role === "host" && g.role !== "host") {
        actions.push(btn(g.role === "cohost" ? "star-filled" : "star",
          g.role === "cohost" ? "Remove co-host" : "Make co-host",
          function () { dispatch({ type: CMD.ROLE, id: g.id, cohost: g.role !== "cohost" }); },
          g.role === "cohost" ? "on" : null));
      }
      if (canManage() && g.role !== "host" && g.id !== me) {
        actions.push(btn("close", "Remove from the room", function () {
          if (confirm("Remove " + g.name + " from the room?")) dispatch({ type: CMD.KICK, id: g.id });
        }));
      }

      list.appendChild(
        el("li", { class: "row singer" }, [
          el("span", { class: "singer-dot" + (g.role === "guest" ? "" : " singer-dot-lead") }),
          el("div", { class: "row-meta" }, [
            el("div", { class: "row-title", text: g.name + (g.id === me ? " (you)" : "") }),
            el("div", { class: "row-sub", text: g.role === "host" ? "Host" : g.role === "cohost" ? "Co-host" : "Singer" })
          ]),
          el("div", { class: "row-actions" }, actions)
        ])
      );
    });
  }

  /* ---------------- scores ---------------- */

  function renderScores() {
    var board = $("#board");
    if (!board) { paintScores(); return; }
    withClimb(board, paintScores);
  }

  function paintScores() {
    var s = app.state;
    var on = !!(s.config && s.config.leaderboard);
    var tab = $(".tab-scores");
    if (tab) tab.hidden = !on;
    if (!on && app.tab === "scores") switchTab("queue");

    var board = $("#board");
    var log = $("#score-log");
    if (!board || !log) return;

    board.innerHTML = "";
    log.innerHTML = "";
    if (!on) return;

    var table = R.standings(s);
    if (!table.length) {
      board.appendChild(el("li", { class: "empty", text: "No scores yet. Finish a song to get one." }));
    }
    table.forEach(function (row, i) {
      var node = el("li", { class: "board-row" + (i === 0 ? " board-lead" : "") }, [
        el("span", { class: "board-rank", text: String(i + 1) }),
        el("div", { class: "board-meta" }, [
          el("div", { class: "board-name", text: row.name }),
          el("div", { class: "board-sub", text: row.songs + (row.songs === 1 ? " song" : " songs") + " · avg " + row.average })
        ]),
        el("span", { class: "board-score", text: String(row.best) })
      ]);
      // Keyed so the same climb animation that runs on the stage runs here.
      node.setAttribute("data-key", row.name);
      board.appendChild(node);
    });

    (s.scores || []).slice(0, 12).forEach(function (e) {
      log.appendChild(
        el("li", { class: "row score-row" }, [
          el("span", { class: "score-pill", "data-band": e.band, text: String(e.score) }),
          el("div", { class: "row-meta" }, [
            el("div", { class: "row-title", text: e.name }),
            el("div", { class: "row-sub", text: e.title })
          ])
        ])
      );
    });
  }

  /* ---------------- configuration ---------------- */

  var CFG_FIELDS = {
    "cfg-scoring": "scoring",
    "cfg-leaderboard": "leaderboard",
    "cfg-maxrun": "maxRun",
    "cfg-approval": "joinApproval",
    "cfg-sounds": "sounds"
  };

  function renderConfig() {
    var c = (app.state && app.state.config) || R.defaultConfig();
    var manage = canManage();
    Object.keys(CFG_FIELDS).forEach(function (id) {
      var box = $("#" + id);
      if (!box) return;
      box.checked = !!c[CFG_FIELDS[id]];
      box.disabled = !manage;
    });
    if (!manage && app.tab === "config") switchTab("queue");
  }

  function pushConfig() {
    var c = {};
    Object.keys(CFG_FIELDS).forEach(function (id) {
      var box = $("#" + id);
      c[CFG_FIELDS[id]] = !!(box && box.checked);
    });
    dispatch({ type: CMD.CONFIG, config: c });
  }

  function renderProgress() {
    var s = app.state;
    if (!s) return;
    var d = s.player.duration || (s.now && s.now.duration) || 0;
    var t = Math.min(s.player.time, d || s.player.time);
    $("#t-now").textContent = R.fmtTime(t);
    $("#t-end").textContent = d ? R.fmtTime(d) : "--:--";
    var bar = $("#seek");
    if (document.activeElement !== bar) {
      bar.max = String(Math.max(1, Math.round(d)));
      bar.value = String(Math.round(t));
    }
    bar.disabled = !d;
  }

  function renderQueue() {
    var s = app.state;
    var list = $("#queue");
    list.innerHTML = "";
    $("#queue-count").textContent = String(s.queue.length);
    // Emptying somebody else's night out is a host's call, not a guest's.
    $("#clear-btn").hidden = !canManage();

    if (!s.queue.length) {
      list.appendChild(el("li", { class: "empty", text: "Queue is empty — search for a song." }));
      return;
    }

    s.queue.forEach(function (song, i) {
      var game = KN.games.isGameCard(song);

      /* The handle exists to say the row can be picked up. Arrows alone never
       * did: everyone tries to drag a queue, and a list that does not move
       * reads as broken rather than as a list with buttons. */
      var handle = el("button", {
        class: "row-grip",
        type: "button",
        title: "Drag to reorder",
        "aria-label": "Drag “" + song.title + "” to reorder"
      }, [KN.icon("grip")]);

      var row = el("li", { class: "row" + (game ? " row-game" : "") }, [
        handle,
        el("span", { class: "row-num", text: String(i + 1) }),
        game
          ? el("span", { class: "row-gameicon" }, [KN.icon("dice")])
          : thumb("row-thumb", song.thumb),
        el("div", { class: "row-meta" }, [
          el("div", { class: "row-title", text: song.title }),
          el("div", { class: "row-sub", text: game
            ? "the wheel picks the singer and the song · queued by " + song.addedBy
            : (song.author || "—") + " · " + song.addedBy })
        ]),
        el("span", { class: "row-time", text: song.duration ? R.fmtTime(song.duration) : "" }),
        el("div", { class: "row-actions" }, [
          btn("to-top", "Play next", function () { dispatch({ type: CMD.MOVE, sid: song.sid, dir: "top" }); }),
          btn("chevron-up", "Move up", function () { dispatch({ type: CMD.MOVE, sid: song.sid, dir: "up" }); }, "opt"),
          btn("chevron-down", "Move down", function () { dispatch({ type: CMD.MOVE, sid: song.sid, dir: "down" }); }, "opt"),
          btn("play", "Play now", function () { dispatch({ type: CMD.PLAY_NOW, sid: song.sid }); }),
          btn("close", "Remove", function () { dispatch({ type: CMD.REMOVE, sid: song.sid }); })
        ])
      ]);
      row.setAttribute("data-sid", song.sid);
      armDrag(row, handle, song.sid);
      list.appendChild(row);
    });
  }

  /* ---------------- dragging a queue row ----------------
   * Pointer events rather than HTML5 drag-and-drop, because the queue that
   * most needs reordering is the one on a phone and the drag API has never
   * worked with touch. One code path serves mouse, pen and finger.
   *
   * Rows are measured once when the drag starts and moved with transforms
   * afterwards, so nothing re-lays-out mid-gesture. The queue is shared and
   * live: somebody else's song can arrive while a finger is down, which is why
   * the drop sends the index it landed on rather than a swap of two rows the
   * host may no longer agree about.
   */
  function armDrag(row, handle, sid) {
    handle.addEventListener("pointerdown", function (down) {
      if (down.button) return;            // a right-click is not a drag
      down.preventDefault();

      var list = $("#queue");
      var rows = $$(".row", list);
      var from = rows.indexOf(row);
      if (from < 0) return;
      var rects = rows.map(function (r) { return r.getBoundingClientRect(); });
      var to = from;
      var startY = down.clientY;
      var moved = false;

      list.classList.add("list-dragging");
      row.classList.add("row-dragging");
      try { handle.setPointerCapture(down.pointerId); } catch (e) { /* older engines */ }

      function place(next) {
        to = next;
        var order = rows.slice();
        order.splice(from, 1);
        order.splice(to, 0, row);
        order.forEach(function (r, index) {
          if (r === row) return;
          var was = rows.indexOf(r);
          var shift = rects[index].top - rects[was].top;
          r.style.transform = shift ? "translateY(" + shift + "px)" : "";
        });
      }

      function onMove(ev) {
        var dy = ev.clientY - startY;
        if (!moved && Math.abs(dy) < 4) return;
        moved = true;
        row.style.transform = "translateY(" + dy + "px)";
        var mid = rects[from].top + rects[from].height / 2 + dy;
        var next = from;
        for (var i = 0; i < rects.length; i++) {
          if (i === from) continue;
          var centre = rects[i].top + rects[i].height / 2;
          if (i < from && mid < centre) next = Math.min(next, i);
          if (i > from && mid > centre) next = Math.max(next, i);
        }
        if (next !== to) place(next);
      }

      function onUp() {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        try { handle.releasePointerCapture(down.pointerId); } catch (e) { /* already gone */ }
        list.classList.remove("list-dragging");
        row.classList.remove("row-dragging");
        rows.forEach(function (r) { r.style.transform = ""; });
        if (moved && to !== from) dispatch({ type: CMD.MOVE, sid: sid, dir: "to", to: to });
        else render();
      }

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }

  /** An icon button: `name` is an entry in the KN.icon set, `title` is both the
   * tooltip and the accessible name, since the drawing carries neither. */
  function btn(name, title, onClick, cls) {
    return el("button", {
      class: "icon-btn" + (cls ? " " + cls : ""),
      title: title,
      "aria-label": title,
      onclick: onClick
    }, [KN.icon(name)]);
  }

  function thumb(cls, src) {
    return el("img", {
      class: cls,
      src: src,
      alt: "",
      loading: "lazy",
      onerror: function () { this.classList.add("thumb-missing"); this.removeAttribute("src"); }
    });
  }

  /* ---------------- search ----------------
   * A mirror returns far more than anyone scrolls through, and every extra
   * result costs a probe. Vetting the top of the list keeps the sweep short
   * without ever showing a page the user could reach and find empty.
   */
  var SEARCH_CHECK_LIMIT = 24;
  /* Under this many rows a result list is a dead end rather than a choice, so
   * the same song gets asked for again in different words. Three rounds and
   * then it stops: a fourth costs another several seconds of probing for the
   * long tail of a query that has already given what it has. */
  var SEARCH_TARGET = 10;
  var SEARCH_ROUNDS = 3;

  function runSearch() {
    var input = $("#q");
    var q = input.value.trim();
    if (!q || app.searchBusy) return;

    var results = $("#results");
    var status = $("#search-status");

    // A new search abandons the previous sweep rather than making it queue
    // behind results nobody is looking at any more.
    if (app.searchSweep) { app.searchSweep.cancel(); app.searchSweep = null; }

    /* A pasted link never needs a search mirror — and never goes through the
     * karaoke filter either. Someone who pastes a URL has already decided
     * what they want, and second-guessing that is the app arguing with an
     * explicit instruction. */
    if (KN.search.parseVideoId(q)) {
      status.textContent = "Reading link…";
      results.innerHTML = "";
      app.searchBusy = true;
      KN.search
        .resolve(q)
        .then(function (video) {
          // The same gate the search results go through: a link that cannot be
          // embedded is a song that dies on the host screen, so say so here
          // rather than in front of everybody three turns from now.
          status.textContent = "Checking it can play here…";
          return KN.embed.check(video.id).then(function (verdict) {
            if (verdict === KN.embed.NO) {
              throw new Error("That video cannot be played in an embed — the owner disallowed it, or it is private or gone.");
            }
            return video;
          });
        })
        .then(function (video) {
          input.value = "";
          status.textContent = "";
          if (app.role) {
            dispatch({ type: CMD.ADD, video: video });
            confirmAdded(video.title);
            switchTab("queue");
          } else {
            // Outside a room there is no queue to add to, so a pasted link
            // goes where it can still be useful later.
            if (!LIB.hasSong(video.id)) LIB.toggleSong(video);
            renderLibrary();
            toast("Saved “" + video.title + "” to your library");
          }
        })
        .catch(function (e) { status.textContent = e.message; })
        .finally(function () { app.searchBusy = false; });
      return;
    }

    app.searchBusy = true;
    status.textContent = "Searching…";
    results.innerHTML = "";
    app.lastResults = [];

    /* One search is now potentially several. Everything a round needs to know
     * about the rounds before it lives here: what has already been shown, what
     * has already been asked about, and where the next round's rows sort. */
    var run = {
      token: {},
      seen: {},
      shown: 0,
      dropped: 0,     // refused by the embed probe
      unsure: 0,      // shown, but the probe never actually answered
      notKaraoke: 0,  // almost certainly not something anyone can sing to
      round: 0,
      source: null
    };
    app.searchRun = run;

    function stopped() { return app.searchRun !== run; }

    function finish() {
      if (stopped()) return;
      app.searchBusy = false;
      app.searchSweep = null;
      if (!run.shown) {
        status.textContent =
          "Nothing here can be sung to. " +
          (run.notKaraoke ? run.notKaraoke + " result" + (run.notKaraoke === 1 ? " was" : "s were") + " music videos or clips rather than karaoke tracks. " : "") +
          "Try the song title with the artist, or paste a YouTube link.";
        return;
      }
      status.textContent =
        (run.shown - run.unsure) + " playable" +
        (run.unsure ? " · " + run.unsure + " unchecked" : "") +
        (run.dropped ? " · " + run.dropped + " cannot be embedded" : "") +
        (run.notKaraoke ? " · " + run.notKaraoke + " not karaoke" : "") +
        (run.source ? " · " + run.source : "");
    }

    function round() {
      if (stopped()) return;
      run.round++;
      KN.search
        .search(q, run.round - 1)
        .then(function (out) {
          if (stopped()) return;
          run.source = out.source;

          /* Two filters, cheapest first. Reading a title costs nothing and
           * throws out the music videos and reaction clips before we spend a
           * real YouTube embed asking whether each one would play. */
          var fresh = [];
          out.results.forEach(function (v) {
            if (run.seen[v.id]) return;
            run.seen[v.id] = true;
            if (KN.search.karaokeVerdict(v) === "no") { run.notKaraoke++; return; }
            fresh.push(v);
          });

          if (!fresh.length) { nextRound(); return; }

          status.textContent = "Checking which of these can play here…";
          var base = (run.round - 1) * 1000;   // later rounds sort after earlier ones
          app.searchSweep = KN.embed.filter(fresh, {
            limit: SEARCH_CHECK_LIMIT,
            onAccept: function (video, rank, verdict) {
              if (stopped()) return;
              app.lastResults.push(video);
              run.shown++;
              insertResult(video, base + rank, verdict === KN.embed.UNKNOWN);
            },
            onProgress: function (p) {
              if (stopped()) return;
              status.textContent = run.shown
                ? run.shown + " playable so far · checking " + p.checked + "/" + p.total + "…"
                : "Checking " + p.checked + "/" + p.total + "…";
            },
            onDone: function (p) {
              if (stopped()) return;
              app.searchSweep = null;
              run.dropped += p.dropped;
              run.unsure += p.unsure;
              nextRound();
            }
          });
        })
        .catch(function (e) {
          if (stopped()) return;
          // A later round failing is not worth losing the rows we already have.
          if (run.shown) { finish(); return; }
          app.searchBusy = false;
          status.textContent = e.message;
          results.innerHTML = "";
        });
    }

    function nextRound() {
      if (stopped()) return;
      if (run.shown >= SEARCH_TARGET || run.round >= SEARCH_ROUNDS) { finish(); return; }
      status.textContent = "Only " + run.shown + " so far — looking a bit harder…";
      round();
    }

    round();
  }

  /* The host already hears about its own additions through notice(); only a
   * guest needs local confirmation that the tap landed. */
  function confirmAdded(title) {
    if (app.role !== "host") toast("Added “" + title + "”");
  }

  /* Verdicts arrive out of order — POOL_SIZE probes run at once and a cached
   * one returns instantly — but the mirror's ranking is the useful one, so
   * each row is placed by its original rank rather than appended. The list
   * stays in relevance order while still filling in as fast as answers come. */
  function insertResult(v, rank, unchecked) {
    var box = $("#results");
    var row = resultRow(v, unchecked);
    row.setAttribute("data-rank", String(rank));
    var before = null;
    var rows = box.children;
    for (var i = 0; i < rows.length; i++) {
      if (Number(rows[i].getAttribute("data-rank")) > rank) { before = rows[i]; break; }
    }
    box.insertBefore(row, before);
  }

  function resultRow(v, unchecked) {
    var star = el("button", {
      class: "icon-btn star" + (LIB.hasSong(v.id) ? " on" : ""),
      title: "Save to your library",
      "aria-label": "Save to your library",
      "aria-pressed": LIB.hasSong(v.id) ? "true" : "false",
      onclick: function () {
        var saved = LIB.toggleSong(v);
        KN.setIcon(this, saved ? "star-filled" : "star");
        this.setAttribute("aria-pressed", String(saved));
        this.classList.toggle("on", saved);
        toast(saved ? "Saved “" + v.title + "”" : "Removed from saved");
        renderLibrary();
      }
    }, [KN.icon(LIB.hasSong(v.id) ? "star-filled" : "star")]);

    /* Nine times in ten this is what the room came for, and it should be
     * findable at a glance in a list of twenty. The badge is only put on the
     * ones the title and the uploader both agree about — a badge handed out
     * on a hunch stops meaning anything by the third search. */
    var sure = KN.search.karaokeVerdict(v) === "sure";

    var row = el("li", { class: "row row-result" + (sure ? " row-karaoke" : "") }, [
      thumb("row-thumb", v.thumb),
      el("div", { class: "row-meta" }, [
        el("div", { class: "row-title", text: v.title }),
        el("div", { class: "row-sub" }, [
          document.createTextNode(v.author || ""),
          /* The probe could not get an answer for this one, so it is here on
           * benefit of the doubt rather than on a verdict. Saying so is the
           * difference between "we checked" and "we could not". */
          unchecked
            ? el("span", {
                class: "row-flag",
                title: "We could not confirm this one plays in an embed — it may fail on the host screen."
              }, [document.createTextNode("unchecked")])
            : null
        ])
      ]),
      el("span", { class: "row-time", text: v.duration ? R.fmtTime(v.duration) : "" }),
      el("div", { class: "row-actions" }, [
        star,
        btn("plus", app.role ? "Add to a playlist or the roulette" : "Add to a playlist", function () { openPicker(v); })
      ]),
      app.role
        ? el("button", {
            class: "add-btn",
            text: "Add",
            onclick: function () {
              dispatch({ type: CMD.ADD, video: v });
              confirmAdded(v.title);
            }
          })
        : null
    ]);
    if (sure) row.appendChild(el("span", { class: "karaoke-badge", text: "Karaoke" }));
    return row;
  }

  /* ---------------- library ----------------
   * The same markup serves the standalone view and the in-room tab — it is
   * moved between mount points rather than rendered twice, so there is one
   * set of handlers and no chance of the two drifting apart.
   */

  var LIB = KN.library;

  function mountInto(rootId, slotId) {
    var root = $("#" + rootId);
    var slot = $("#" + slotId);
    if (slot && root.parentNode !== slot) slot.appendChild(root);
    root.hidden = false;
  }

  function mountLibrary(slotId) {
    mountInto("library-root", slotId);
    renderLibrary();
  }

  function renderLibrary() {
    var songs = LIB.songs();
    var lists = LIB.playlists();
    $("#lib-song-count").textContent = String(songs.length);
    $("#lib-list-count").textContent = String(lists.length);

    var box = $("#lib-songs");
    box.innerHTML = "";
    if (!songs.length) {
      box.appendChild(el("li", {
        class: "empty",
        text: "No saved songs yet. Tap the star on a search result to keep it here."
      }));
    } else {
      songs.forEach(function (song) {
        box.appendChild(songRow(song, [
          queueButton(song),
          btn("plus", "Add to a playlist", function () { openPicker(song); }),
          btn("close", "Remove from saved", function () {
            LIB.removeSong(song.id);
            renderLibrary();
          })
        ]));
      });
    }

    var lp = $("#lib-playlists");
    lp.innerHTML = "";
    if (!lists.length) {
      lp.appendChild(el("p", { class: "empty", text: "No playlists yet. Make one below." }));
    }
    lists.forEach(function (p) {
      var open = app.openPlaylists[p.pid];
      var head = el("div", { class: "pl-head" }, [
        el("button", {
          class: "pl-toggle",
          "aria-expanded": open ? "true" : "false",
          onclick: function () {
            app.openPlaylists[p.pid] = !open;
            renderLibrary();
          }
        }, [
          KN.icon(open ? "chevron-down" : "chevron-right", "pl-caret"),
          el("span", { text: p.name })
        ]),
        el("span", { class: "pl-count", text: p.songs.length + (p.songs.length === 1 ? " song" : " songs") }),
        el("div", { class: "pl-actions" }, [
          app.role
            ? btn("play", "Queue this playlist", function () { queuePlaylist(p); })
            : null,
          btn("pencil", "Rename playlist", function () {
            var name = prompt("Rename playlist", p.name);
            if (name !== null) { LIB.renamePlaylist(p.pid, name); renderLibrary(); }
          }),
          btn("close", "Delete playlist", function () {
            if (confirm("Delete “" + p.name + "”? The songs stay in Saved songs if you saved them there.")) {
              LIB.deletePlaylist(p.pid);
              renderLibrary();
            }
          })
        ])
      ]);

      var body = el("ul", { class: "list pl-songs" });
      if (open) {
        if (!p.songs.length) {
          body.appendChild(el("li", { class: "empty", text: "Empty — add songs from search or your saved songs." }));
        }
        p.songs.forEach(function (song) {
          body.appendChild(songRow(song, [
            queueButton(song),
            btn("chevron-up", "Move up", function () { LIB.moveInPlaylist(p.pid, song.id, "up"); renderLibrary(); }),
            btn("chevron-down", "Move down", function () { LIB.moveInPlaylist(p.pid, song.id, "down"); renderLibrary(); }),
            btn("close", "Remove from playlist", function () { LIB.removeFromPlaylist(p.pid, song.id); renderLibrary(); })
          ]));
        });
      }

      lp.appendChild(el("div", { class: "pl" }, [head, open ? body : null]));
    });

    // Handing your library to someone else is a between-parties thing; inside
    // a room the useful gesture is queueing a song, not exporting the lot.
    var shareBtn = $("#lib-share");
    if (shareBtn) shareBtn.hidden = !!app.role;

    $("#library-stats").textContent =
      songs.length || lists.length ? "· " + songs.length + " songs, " + lists.length + " playlists" : "";
  }

  function songRow(song, actions) {
    return el("li", { class: "row" }, [
      thumb("row-thumb", song.thumb),
      el("div", { class: "row-meta" }, [
        el("div", { class: "row-title", text: song.title }),
        el("div", { class: "row-sub", text: song.author || "" })
      ]),
      el("span", { class: "row-time", text: song.duration ? R.fmtTime(song.duration) : "" }),
      el("div", { class: "row-actions" }, actions.filter(Boolean))
    ]);
  }

  /** Queueing is only meaningful inside a room; outside one the button is absent. */
  function queueButton(song) {
    if (!app.role) return null;
    return btn("arrow-up-right", "Add to the room queue", function () {
      dispatch({ type: CMD.ADD, video: song });
      confirmAdded(song.title);
    });
  }

  function queuePlaylist(p) {
    if (!app.role || !p.songs.length) return;
    p.songs.forEach(function (song) { dispatch({ type: CMD.ADD, video: song }); });
    toast("Queued " + p.songs.length + " from “" + p.name + "”");
    switchTab("queue");
  }

  /* ---------------- sharing a library ----------------
   * Three routes out, because the useful one depends entirely on who is in the
   * room: the share sheet (messages, mail, AirDrop) when the two phones can
   * talk to each other at all, and a run of QR codes when they cannot — no
   * account, no network, no cable, just one screen pointed at another camera.
   */

  var libShare = { parts: [], at: 0, auto: null, scan: null };

  function libraryFile() {
    return new File([LIB.exportAll()], "karaokenatin-library.json", { type: "application/json" });
  }

  function openLibShare() {
    lsPhase("menu");
    $("#libshare").hidden = false;
  }

  function closeLibShare() {
    stopAuto();
    stopScan();
    $("#libshare").hidden = true;
  }

  function lsPhase(name) {
    $$("#libshare .ls-phase").forEach(function (p) { p.hidden = p.dataset.ls !== name; });
  }

  function sendLibraryFile() {
    var stats = LIB.stats();
    if (!stats.songs && !stats.playlists) { toast("Your library is empty.", "warn"); return; }

    var file = null;
    try { file = libraryFile(); } catch (e) { /* no File constructor — fall through */ }
    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      navigator.share({ files: [file], title: "My KaraokeNatin library" }).catch(function () { /* dismissed */ });
      closeLibShare();
      return;
    }
    // No share sheet for files here — a download is the same file by another
    // road, and every mail and messaging app takes an attachment.
    $("#lib-export").click();
    toast("Saved the file — send it however you like.");
    closeLibShare();
  }

  /* One code cannot hold a library, so it becomes a short slideshow of them.
   * Order does not matter on the other end, which is what makes a hand-held
   * scan of six codes survivable. */
  function showLibQr() {
    var stats = LIB.stats();
    if (!stats.songs && !stats.playlists) { toast("Your library is empty.", "warn"); return; }
    try {
      // Leave room for the "KNL1:i:n:" header at the front of every part.
      libShare.parts = LIB.shareParts(QR.capacity("L") - 16);
    } catch (e) {
      toast("Could not prepare the codes.", "warn");
      return;
    }
    libShare.at = 0;
    lsPhase("show");
    drawSharePart();
  }

  function drawSharePart() {
    var n = libShare.parts.length;
    $("#ls-step").textContent = "Code " + (libShare.at + 1) + " of " + n;
    $("#ls-prev").disabled = n < 2;
    $("#ls-next").disabled = n < 2;
    /* A library code is a dense one, so it gets every pixel the dialog can
     * spare — and QR.draw rounds down to a whole number of pixels per module,
     * which is the difference between a big code and a scannable one. Never
     * resize the canvas in CSS afterwards: that smears the modules. */
    var modal = $("#libshare .modal");
    var room = Math.max(220, Math.min(420, (modal ? modal.clientWidth : 340) - 48));
    try {
      QR.draw($("#ls-canvas"), libShare.parts[libShare.at], {
        ecc: "L", px: room, dark: "#0b0b12", light: "#ffffff", quiet: 3
      });
    } catch (e) {
      toast("That library is too large to share by QR — send the file instead.", "warn");
      lsPhase("menu");
    }
  }

  function stepShare(by) {
    var n = libShare.parts.length;
    if (!n) return;
    libShare.at = (libShare.at + by + n) % n;
    drawSharePart();
  }

  function stopAuto() {
    clearInterval(libShare.auto);
    libShare.auto = null;
    var b = $("#ls-auto");
    if (b) b.textContent = "Auto-play";
  }

  function toggleAuto() {
    if (libShare.auto) { stopAuto(); return; }
    libShare.auto = setInterval(function () { stepShare(1); }, 2600);
    $("#ls-auto").textContent = "Stop";
  }

  /* Scanning leans on the browser's own barcode reader. Where it is missing
   * (Safari and Firefox at the time of writing) there is no honest fallback
   * short of shipping a decoder, so say which road is still open rather than
   * showing a camera that will never find anything. */
  function startScan() {
    if (typeof global.BarcodeDetector !== "function") {
      toast("This browser cannot scan QR codes — import the file instead.", "warn");
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast("No camera available in this browser.", "warn");
      return;
    }

    lsPhase("scan");
    var status = $("#ls-scan-status");
    status.textContent = "Starting the camera…";

    var video = $("#ls-video");
    var detector = new global.BarcodeDetector({ formats: ["qr_code"] });
    var got = {};
    var expect = 0;

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(function (stream) {
        libShare.scan = { stream: stream, timer: null };
        video.srcObject = stream;
        return video.play();
      })
      .then(function () {
        status.textContent = "Point the camera at each code.";
        libShare.scan.timer = setInterval(function () {
          detector.detect(video).then(function (codes) {
            codes.forEach(function (c) { onScanned(c.rawValue); });
          }, function () { /* a frame the detector could not use */ });
        }, 400);
      })
      .catch(function () {
        status.textContent = "The camera could not be opened.";
      });

    function onScanned(text) {
      var part = LIB.readPart(text);
      if (!part) return;
      if (expect && part.count !== expect) return;   // a different share
      expect = part.count;
      if (got[part.index]) return;
      got[part.index] = part.chunk;

      var have = Object.keys(got).length;
      status.textContent = "Got " + have + " of " + expect + " codes.";
      if (have < expect) return;

      var chunks = [];
      for (var i = 1; i <= expect; i++) chunks.push(got[i]);
      stopScan();
      try {
        finishImport(LIB.joinParts(chunks));
      } catch (e) {
        toast(e.message, "warn");
      }
    }
  }

  function stopScan() {
    if (!libShare.scan) return;
    clearInterval(libShare.scan.timer);
    libShare.scan.stream.getTracks().forEach(function (t) { t.stop(); });
    var video = $("#ls-video");
    if (video) video.srcObject = null;
    libShare.scan = null;
  }

  /* ---------------- importing ----------------
   * The same landing point for a file and for a scan: check what it collides
   * with first, and only ask when there is actually something to ask about.
   */

  var pendingImport = null;

  function finishImport(text) {
    var found;
    try { found = LIB.inspectImport(text); } catch (e) { toast(e.message, "warn"); return; }

    if (!found.dupSongs && !found.dupPlaylists) { runImport(text, "skip"); return; }

    pendingImport = text;
    $("#dupes-body").textContent =
      describe(found.dupSongs, "song", "songs") +
      (found.dupSongs && found.dupPlaylists ? " and " : "") +
      describe(found.dupPlaylists, "playlist", "playlists") +
      " already in your library. " +
      (found.songs || found.playlists
        ? "The other " + (found.songs + found.playlists) + " will be added either way."
        : "Everything in this file is already here.");
    $("#dupes").hidden = false;
  }

  function describe(n, one, many) {
    return n ? n + " " + (n === 1 ? one : many) : "";
  }

  function runImport(text, duplicates) {
    try {
      var added = LIB.importAll(text, { duplicates: duplicates });
      renderLibrary();
      closeLibShare();
      toast(added.songs || added.playlists
        ? "Imported " + added.songs + " songs and " + added.playlists + " playlists"
        : "Nothing new to import.");
    } catch (err) {
      toast(err.message, "warn");
    }
  }

  /* ---------------- add-to-playlist picker ---------------- */

  function openPicker(video) {
    app.pickerSong = video;
    $("#picker-song").textContent = video.title;
    var list = $("#picker-list");
    list.innerHTML = "";
    var lists = LIB.playlists();
    if (!lists.length) {
      list.appendChild(el("li", { class: "empty", text: "No playlists yet — name one below." }));
    }
    lists.forEach(function (p) {
      var already = p.songs.some(function (x) { return x.id === video.id; });
      list.appendChild(
        el("li", {}, [
          el("button", {
            class: "picker-item" + (already ? " on" : ""),
            disabled: already ? "disabled" : null,
            onclick: function () {
              if (LIB.addToPlaylist(p.pid, video)) {
                toast("Added to “" + p.name + "”");
                closePicker();
                renderLibrary();
              }
            }
          }, [
            already ? KN.icon("check", "picker-tick") : null,
            el("span", { text: p.name })
          ])
        ])
      );
    });
    var toPot = $("#picker-roulette");
    if (toPot) toPot.hidden = !app.role;
    $("#picker").hidden = false;
    $("#picker-new-name").value = "";
  }

  function closePicker() {
    $("#picker").hidden = true;
    app.pickerSong = null;
  }

  /* ---------------- tabs ---------------- */

  function switchTab(name) {
    app.tab = name;
    $$(".tab").forEach(function (b) {
      var on = b.dataset.tab === name;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    });
    $$(".panel").forEach(function (p) { p.hidden = p.dataset.panel !== name; });

    /* Six tabs outgrow a narrow side column. The row scrolls, so the tab that
     * was just chosen has to be brought into view — and the edge fade is only
     * honest while there is actually something past it. */
    var caption = $("#tab-caption");
    var active = $(".tab[data-tab='" + name + "']");
    if (caption) caption.textContent = (active && active.getAttribute("aria-label")) || "";

    var strip = $(".tabs");
    if (strip) {
      strip.classList.toggle("tabs-overflow", strip.scrollWidth > strip.clientWidth + 1);
      if (active && active.scrollIntoView) {
        active.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
    if (name === "search") mountInto("search-root", "search-slot-room");
    if (name === "library") mountLibrary("library-slot-room");
    if (name === "games") renderGames();
  }

  /* ---------------- the 10pm rule ----------------
   * Somewhere around here every karaoke night stops being the singers' problem
   * and starts being the neighbours'. Once, at 10pm, the room says so and
   * takes the volume down to half — and then leaves it alone. Turning it back
   * up is allowed: this is a nudge, not a curfew, and a nudge that fights you
   * is just a broken volume knob.
   */
  var CURFEW_KEY = "kn:curfew";
  var CURFEW_HOUR = 22;
  var CURFEW_TEXT =
    "ITS 10:00PM. NEIGHBORS ARE ALREADY SLEEPING. YOU KNOW WHAT TO DO 👀. Turning volume to 50%";

  function curfewStamp(d) {
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  function startCurfewWatch() {
    checkCurfew();
    setInterval(checkCurfew, 30000);
  }

  function checkCurfew() {
    if (app.role !== "host" || app.curfewDone) return;
    var d = new Date();
    if (d.getHours() !== CURFEW_HOUR) return;
    var stamp = curfewStamp(d);
    var seen = null;
    try { seen = localStorage.getItem(CURFEW_KEY); } catch (e) { /* private mode */ }
    if (seen === stamp) { app.curfewDone = true; return; }
    app.curfewDone = true;
    try { localStorage.setItem(CURFEW_KEY, stamp); } catch (e) { /* private mode */ }
    runCurfew();
  }

  function runCurfew() {
    var bar = $("#curfew");
    if (bar) {
      $("#curfew-text").textContent = CURFEW_TEXT;
      bar.hidden = false;
      bar.classList.remove("run");
      void bar.offsetWidth;
      bar.classList.add("run");
      setTimeout(function () { bar.hidden = true; bar.classList.remove("run"); }, 22000);
    }
    speak("It is ten p m. The neighbours are already sleeping. Turning the volume down to fifty percent.");
    notice("10:00PM — volume easing down to 50%.", "warn");
    fadeVolume(50);
  }

  /** Walk the volume to `target` over a few seconds, through the same command
   *  path a slider drag uses, so every phone in the room sees it move. */
  function fadeVolume(target) {
    if (!app.state) return;
    var from = app.state.player.volume;
    if (from <= target) return;
    var steps = 20;
    var step = 0;
    var timer = setInterval(function () {
      step++;
      var v = Math.round(from + (target - from) * (step / steps));
      dispatch({ type: CMD.VOLUME, v: v });
      if (step >= steps) clearInterval(timer);
    }, 180);
  }

  /* ---------------- wake lock ---------------- */

  function keepAwake() {
    if (!navigator.wakeLock) return;
    var lock = null;
    function acquire() {
      navigator.wakeLock.request("screen").then(
        function (l) { lock = l; l.addEventListener("release", function () { lock = null; }); },
        function () { /* denied — not important enough to report */ }
      );
    }
    acquire();
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && !lock) acquire();
    });
  }

  /* ---------------- install (PWA) ----------------
   * Installed, the app opens full-screen with no browser chrome — which for a
   * TV or a phone-as-remote is the difference between a web page and an app.
   *
   * Chromium-family browsers hand us a deferred prompt we can fire on a click.
   * Safari and Firefox never do, so rather than showing a button that does
   * nothing, those get the same button with the manual steps behind it.
   */

  function installedAlready() {
    return (
      (global.matchMedia && global.matchMedia("(display-mode: standalone)").matches) ||
      global.navigator.standalone === true
    );
  }

  function manualInstallSteps() {
    var ua = navigator.userAgent;
    var iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (iOS) return "In Safari, tap the Share button, then choose “Add to Home Screen”.";
    if (/Firefox/.test(ua)) return "In Firefox, open the ⋯ menu and choose “Install” or “Add to Home screen”.";
    if (/Android/.test(ua)) return "Open your browser's ⋮ menu and choose “Install app” or “Add to Home screen”.";
    return "Open your browser's menu and look for “Install app”, “Add to Home screen”, or an install icon in the address bar.";
  }

  function setupInstall() {
    var bar = $("#install-bar");
    var deferred = null;

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("sw.js").then(setupUpdates, function () {
        // Offline support and installability are both nice-to-have; a browser
        // that refuses the worker still gets a fully working app.
      });
    }

    function show() {
      if (installedAlready() || load(STORE.installDismissed)) return;
      bar.hidden = false;
    }

    global.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();       // keep the browser's own mini-bar out of the way
      deferred = e;
      show();
    });

    global.addEventListener("appinstalled", function () {
      deferred = null;
      bar.hidden = true;
      toast("Installed — you can open KaraokeNatin from your home screen.");
    });

    $("#install-btn").addEventListener("click", function () {
      if (deferred) {
        deferred.prompt();
        deferred.userChoice.then(function (choice) {
          if (choice && choice.outcome === "accepted") bar.hidden = true;
          deferred = null;
        });
        return;
      }
      $("#install-help-body").textContent = manualInstallSteps();
      $("#install-help").hidden = false;
    });

    $("#install-dismiss").addEventListener("click", function () {
      bar.hidden = true;
      // No `at`, so this is not on the 12-hour resume clock: "not now" from a
      // user who knows where their browser menu is should mean not again.
      save(STORE.installDismissed, { dismissed: true });
    });

    $("#install-help-close").addEventListener("click", function () { $("#install-help").hidden = true; });
    $("#install-help").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });

    // No beforeinstallprompt is coming on Safari or Firefox, and it can also
    // be missed on a warm load in Chromium. Offer the manual route instead of
    // leaving the option invisible.
    setTimeout(function () { if (!deferred) show(); }, 2500);
  }

  /* ---------------- updates ----------------
   * Installed from the home screen, there is no address bar to reload from and
   * no visible clue that a newer build exists — the cached shell will happily
   * serve last month's app forever. So the page asks: on every load, when it
   * comes back to the foreground, and on a button, with the answer offered
   * rather than forced, because nobody wants a reload mid-song.
   */

  /* Also the ?v= on every asset in index.html and in sw.js SHELL_FILES.
   * tools/version-check.js fails the build if the three drift apart. */
  var APP_VERSION = "2.5.0";
  var UPDATE_CHECK_MS = 30 * 60 * 1000;

  var swReg = null;
  var lastUpdateCheck = 0;
  var updateReady = false;
  var reloading = false;
  var hadController = false;

  function announceUpdate() {
    if (updateReady) return;
    updateReady = true;
    $("#update-bar").hidden = false;
    var check = $("#update-check");
    check.hidden = false;
    check.textContent = "Update ready";
    // Mid-room, the bar is off-screen behind the room view; a toast is the
    // only way the news reaches a host who never goes back home.
    if (app.role) toast("A new version is ready — reload when the room is done.");
  }

  function watchWorker(worker) {
    if (!worker) return;
    worker.addEventListener("statechange", function () {
      // A worker that reaches "installed" while another one is already in
      // charge is by definition a newer build waiting its turn.
      if (worker.state === "installed" && navigator.serviceWorker.controller) announceUpdate();
    });
  }

  function setupUpdates(reg) {
    if (!reg) return;
    swReg = reg;
    hadController = !!navigator.serviceWorker.controller;

    if (reg.waiting && hadController) announceUpdate();
    watchWorker(reg.installing);
    reg.addEventListener("updatefound", function () { watchWorker(reg.installing); });

    navigator.serviceWorker.addEventListener("controllerchange", function () {
      // The very first worker claiming an uncontrolled page is not an update.
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });

    $("#update-check").hidden = false;
    checkForUpdate(false);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) return;
      if (Date.now() - lastUpdateCheck < UPDATE_CHECK_MS) return;
      checkForUpdate(false);
    });
    setInterval(function () { if (!document.hidden) checkForUpdate(false); }, UPDATE_CHECK_MS);
  }

  function checkForUpdate(manual) {
    if (updateReady) { if (manual) announceUpdate(); return; }
    if (!swReg) {
      if (manual) toast("This browser cannot check for updates — reload the page instead.", "warn");
      return;
    }
    lastUpdateCheck = Date.now();
    if (manual) toast("Checking for updates…");

    swReg.update().then(function () {
      // update() resolves as soon as the new worker starts installing, so give
      // the install a beat to land before calling it a day.
      setTimeout(function () {
        if (updateReady || swReg.waiting || swReg.installing) {
          if (swReg.waiting) announceUpdate();
          else if (manual && !updateReady) toast("A new version is downloading — hold on a moment.");
          return;
        }
        if (manual) toast("You are on the latest version (" + APP_VERSION + ").");
      }, 1500);
    }, function () {
      if (manual) toast("Could not check right now — try again when you are online.", "warn");
    });
  }

  function applyUpdate() {
    $("#update-bar").hidden = true;
    if (swReg && swReg.waiting) {
      // The waiting worker takes over, which fires controllerchange above and
      // reloads us onto the new build.
      swReg.waiting.postMessage("skip-waiting");
      setTimeout(function () { if (!reloading) { reloading = true; location.reload(); } }, 2000);
      return;
    }
    reloading = true;
    location.reload();
  }

  function setupUpdateUI() {
    $("#app-version").textContent = "v" + APP_VERSION;
    $("#update-apply").addEventListener("click", applyUpdate);
    $("#update-later").addEventListener("click", function () { $("#update-bar").hidden = true; });
    $("#update-check").addEventListener("click", function () {
      if (updateReady) { applyUpdate(); return; }
      checkForUpdate(true);
    });
  }

  /* ---------------- theme ----------------
   * Light and dark, with "no choice yet" meaning "follow the system". The
   * stored choice is applied by a tiny inline script in the document head, so
   * this only has to handle the flip and keep the button's label honest.
   */

  var THEME_KEY = "kn.theme";

  function effectiveTheme() {
    var set = document.documentElement.dataset.theme;
    if (set === "light" || set === "dark") return set;
    return global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function setupTheme() {
    var buttons = $$("[data-theme-toggle]");

    /* The button shows the theme you are *in*, not the one you would get: a
     * moon while it is dark, a sun while it is light. Showing the destination
     * reads as a state indicator that is lying about the state. The moon is
     * the warm yellow of a light left on, which is the whole idea. */
    function relabel() {
      var now = effectiveTheme();
      var next = now === "dark" ? "light" : "dark";
      buttons.forEach(function (b) {
        b.setAttribute("aria-label", "Switch to the " + next + " theme");
        b.title = "Switch to the " + next + " theme";
        b.classList.toggle("theme-btn-dark", now === "dark");
        var slot = $("[data-theme-icon]", b);
        if (slot) KN.setIcon(slot, now === "dark" ? "moon" : "sun");
      });
    }

    buttons.forEach(function (b) {
      b.addEventListener("click", function () {
        var next = effectiveTheme() === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* private mode */ }
        relabel();
      });
    });

    // Until someone picks a side, the system preference is the side.
    var mq = global.matchMedia && global.matchMedia("(prefers-color-scheme: dark)");
    if (mq && mq.addEventListener) mq.addEventListener("change", relabel);

    relabel();
  }

  /* ---------------- the name gate ----------------
   * A queue is a list of turns, and a turn belongs to somebody. Arriving as
   * "Guest" makes the room unreadable the moment more than one phone is in it,
   * so a name is the price of entry: typed on the home form, or asked for here
   * when someone lands straight on a join link from a QR code.
   */

  /* The name is remembered, and the question is still asked. Those are two
   * separate things and conflating them was the bug: someone who lent their
   * phone to a friend, or is the friend, joined the room silently as whoever
   * used it last, and only found out when the queue said so. Arriving at a
   * room is exactly the moment to confirm — so the gate always opens, with
   * the remembered name already typed into it and one tap to accept. */
  function enterRoom(code) {
    openNameGate(code);
  }

  function openNameGate(code) {
    app.pendingJoin = code;
    $("#name-gate-code").textContent = code;
    var remembered = app.name || loadName() || "";
    var box = $("#name-gate-input");
    box.value = remembered;
    $("#name-gate").hidden = false;
    // Autofocus loses to the modal's own reveal on some mobile browsers.
    setTimeout(function () {
      try {
        box.focus();
        // Filled in, so the fast path is one tap — but selected, so replacing
        // it is also one tap rather than a fight with a text cursor.
        if (remembered) box.select();
      } catch (e) { /* ignore */ }
    }, 30);
  }

  function closeNameGate() {
    app.pendingJoin = null;
    $("#name-gate").hidden = true;
  }

  function setupNameGate() {
    $("#name-gate-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("#name-gate-input");
      var name = input.value.slice(0, 24).trim();
      if (!name) {
        toast("Type a name so the room knows whose turn it is.", "warn");
        input.focus();
        return;
      }
      var code = app.pendingJoin;
      saveName(name);
      closeNameGate();
      if (code) startGuest(code);
    });

    $("#name-gate-cancel").addEventListener("click", function () {
      closeNameGate();
      location.hash = "#/";
      showHome();
    });
  }

  /* ---------------- routing ---------------- */

  function route() {
    var hash = location.hash || "#/";
    var m = hash.match(/^#\/r\/([A-Za-z0-9]+)/);

    if (m) {
      var code = KN.net.normalizeCode(m[1]);
      if (code.length !== 6) {
        toast("That room code is not valid.", "warn");
        location.hash = "#/";
        return;
      }
      if (app.role && app.state && app.state.code === code) return;
      if (app.pendingJoin === code) return;   // the name gate is already up for it
      if (app.role) {
        if (app.net) app.net.stop();
        if (app.player) app.player.destroy();
        clearInterval(ticker);
      }
      enterRoom(code);
      return;
    }
    if (hash.indexOf("#/stats") === 0) {
      // Statistics are about nights you have had, not the one you are in.
      if (app.role) { location.hash = app.role === "host" ? "#/host" : "#/r/" + app.state.code; return; }
      showStats();
      return;
    }
    if (hash.indexOf("#/library") === 0) {
      // Reachable mid-room too: leaving the room to browse would be absurd, so
      // in that case the Library tab is the right destination instead.
      if (app.role) { switchTab("library"); location.hash = app.role === "host" ? "#/host" : "#/r/" + app.state.code; return; }
      showLibrary();
      return;
    }
    if (hash.indexOf("#/host") === 0) {
      if (app.role === "host") return;
      // Landing on #/host after a refresh should pick the room back up, not
      // silently mint a new code and strand everyone holding the old one.
      var saved = load(STORE.host);
      startHost(saved ? saved.code : KN.net.makeCode(), saved);
      return;
    }
    if (app.role) return; // stay in the room; the room's Leave button routes out
    showHome();
  }

  /* ---------------- boot ---------------- */

  function boot() {
    // home screen
    $("#host-btn").addEventListener("click", function () {
      if (app.role === "host") return;
      forget(STORE.host);           // an explicit "start a room" means a fresh one
      history.replaceState(null, "", "#/host");
      startHost(KN.net.makeCode());
    });

    $("#join-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("#join-name").value.slice(0, 24).trim();
      if (!name) {
        toast("Enter a name before you join.", "warn");
        $("#join-name").focus();
        return;
      }
      var code = KN.net.normalizeCode($("#join-code").value);
      if (code.length !== 6) { toast("Room codes are 6 characters.", "warn"); $("#join-code").focus(); return; }
      saveName(name);
      location.hash = "#/r/" + code;
    });

    $("#join-code").addEventListener("input", function () {
      this.value = KN.net.normalizeCode(this.value);
    });

    $("#resume-btn").addEventListener("click", function () {
      if (!app.resume) return;
      var r = app.resume;
      if (r.kind === "host") {
        history.replaceState(null, "", "#/host");
        startHost(r.data.code, r.data);
      } else {
        location.hash = "#/r/" + r.data.code;
      }
    });
    $("#resume-dismiss").addEventListener("click", function () {
      forget(STORE.host);
      forget(STORE.guest);
      showHome();
    });

    // room chrome
    $("#leave-btn").addEventListener("click", function () {
      if (app.role === "host" && !confirm("Close the room? Guests will be disconnected.")) return;
      leave();
    });
    $("#retry-btn").addEventListener("click", function () { if (app.net) app.net.retryNow(); });

    $("#copy-btn").addEventListener("click", function () {
      var url = joinUrl();
      var done = function () { toast("Join link copied"); };
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { prompt("Copy this link:", url); });
      else prompt("Copy this link:", url);
    });

    $("#share-btn").addEventListener("click", function () {
      if (navigator.share) {
        navigator.share({ title: "KaraokeNatin room " + app.state.code, url: joinUrl() }).catch(function () { /* dismissed */ });
      } else {
        $("#copy-btn").click();
      }
    });

    $("#name-input").addEventListener("change", function () {
      var name = this.value.slice(0, 24).trim();
      if (!name) {
        this.value = app.name;
        toast("Your name cannot be empty.", "warn");
        return;
      }
      saveName(name);
      toast("Name saved");
    });

    // transport
    $("#play-btn").addEventListener("click", function () {
      dispatch({ type: app.state.player.status === "playing" ? CMD.PAUSE : CMD.PLAY });
    });
    $("#skip-btn").addEventListener("click", function () { dispatch({ type: CMD.SKIP }); });
    $("#restart-btn").addEventListener("click", function () { dispatch({ type: CMD.RESTART }); });
    $("#mute-btn").addEventListener("click", function () {
      dispatch({ type: CMD.MUTE, on: !app.state.player.muted });
    });
    $("#vol").addEventListener("input", function () {
      dispatch({ type: CMD.VOLUME, v: Number(this.value) });
    });
    $("#seek").addEventListener("change", function () {
      dispatch({ type: CMD.SEEK, t: Number(this.value) });
    });
    $("#clear-btn").addEventListener("click", function () {
      if (confirm("Clear the whole queue?")) dispatch({ type: CMD.CLEAR });
    });

    // The click itself is the user gesture the browser was holding out for.
    $("#tap-to-play").addEventListener("click", function () {
      this.hidden = true;
      if (app.player) app.player.play();
    });

    $("#fs-btn").addEventListener("click", toggleFullscreen);

    /* ---- room setup ---- */
    Object.keys(CFG_FIELDS).forEach(function (id) {
      $("#" + id).addEventListener("change", pushConfig);
    });

    /* ---- the idle stage doubles as a search box ----
     * A host screen with an empty queue used to be a black rectangle with the
     * search two tabs away. Typing here is the same search; the results panel
     * comes forward on the first keystroke so the answer is never hidden
     * behind the thing that asked for it. */
    var stageQ = $("#stage-q");
    stageQ.addEventListener("input", function () {
      $("#q").value = this.value;
      if (this.value && app.tab !== "search") switchTab("search");
    });
    $("#stage-search").addEventListener("submit", function (e) {
      e.preventDefault();
      $("#q").value = stageQ.value;
      switchTab("search");
      runSearch();
      stageQ.value = "";
    });

    // The wide invite rail shows the same code/QR as the fullscreen corner
    // badges — hide it whenever the stage actually goes fullscreen, however
    // that was triggered (the button, Esc, browser chrome, F11…).
    document.addEventListener("fullscreenchange", syncFullscreen);
    document.addEventListener("webkitfullscreenchange", syncFullscreen);
    syncFullscreen();

    // search
    $("#search-form").addEventListener("submit", function (e) { e.preventDefault(); runSearch(); });

    /* ---- library ---- */
    $("#library-btn").addEventListener("click", function () { location.hash = "#/library"; });
    $("#lib-back").addEventListener("click", function () { location.hash = "#/"; });

    /* ---- statistics ---- */
    $("#stats-btn").addEventListener("click", function () { location.hash = "#/stats"; });
    $("#stats-back").addEventListener("click", function () { location.hash = "#/"; });
    $("#stats-clear").addEventListener("click", function () {
      if (!confirm("Erase every statistic stored on this device? This cannot be undone.")) return;
      KN.stats.clear();
      renderStats();
      renderStatsTeaser();
      toast("Your statistics were erased.");
    });

    /* ---- games ---- */
    $("#roulette-queue").addEventListener("click", function () {
      dispatch({ type: CMD.GAME_QUEUE });
    });
    $("#roulette-clear").addEventListener("click", function () {
      var pool = (app.state.roulette && app.state.roulette.pool) || [];
      if (!pool.length || !confirm("Empty the roulette pot?")) return;
      pool.slice().forEach(function (e) { dispatch({ type: CMD.GAME_REMOVE, rid: e.rid }); });
    });
    $("#cfg-roulette-host").addEventListener("change", function () {
      dispatch({ type: CMD.GAME_CONFIG, includeHost: this.checked });
    });
    $("#spin-again-yes").addEventListener("click", function () {
      if (app.role === "host") spinAgain();
      else dispatch({ type: CMD.GAME_AGAIN });
    });
    $("#spin-again-no").addEventListener("click", function () {
      if (app.role !== "host") return;
      clearSpinOffer();
      nextSong();
    });
    $("#picker-roulette").addEventListener("click", function () {
      if (!app.pickerSong) return;
      dispatch({ type: CMD.GAME_ADD, video: app.pickerSong });
      if (app.role !== "host") toast("Sent “" + app.pickerSong.title + "” to the roulette");
      closePicker();
    });

    $$(".lib-tab").forEach(function (b) {
      b.addEventListener("click", function () {
        $$(".lib-tab").forEach(function (o) {
          var on = o === b;
          o.classList.toggle("on", on);
          o.setAttribute("aria-selected", String(on));
        });
        $$(".lib-panel").forEach(function (p) { p.hidden = p.dataset.libpanel !== b.dataset.libtab; });
      });
    });

    $("#new-playlist-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var input = $("#new-playlist-name");
      var name = input.value.trim();
      if (!name) return;
      var p = LIB.createPlaylist(name);
      app.openPlaylists[p.pid] = true;
      input.value = "";
      renderLibrary();
      toast("Created “" + p.name + "”");
    });

    $("#lib-export").addEventListener("click", function () {
      var blob = new Blob([LIB.exportAll()], { type: "application/json" });
      var a = el("a", { href: URL.createObjectURL(blob), download: "karaokenatin-library.json" });
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    });

    $("#lib-import").addEventListener("click", function () { $("#lib-import-file").click(); });
    $("#lib-import-file").addEventListener("change", function () {
      var file = this.files && this.files[0];
      this.value = "";
      if (!file) return;
      file.text().then(
        function (text) { finishImport(text); },
        function () { toast("Could not read that file.", "warn"); }
      );
    });

    /* ---- sharing a library ---- */
    $("#lib-share").addEventListener("click", openLibShare);
    $("#libshare-close").addEventListener("click", closeLibShare);
    $("#libshare").addEventListener("click", function (e) { if (e.target === this) closeLibShare(); });
    $("#ls-send").addEventListener("click", sendLibraryFile);
    $("#ls-qr").addEventListener("click", showLibQr);
    $("#ls-scan").addEventListener("click", startScan);
    $("#ls-scan-stop").addEventListener("click", function () { stopScan(); lsPhase("menu"); });
    $("#ls-prev").addEventListener("click", function () { stopAuto(); stepShare(-1); });
    $("#ls-next").addEventListener("click", function () { stopAuto(); stepShare(1); });
    $("#ls-auto").addEventListener("click", toggleAuto);

    $("#dupes-close").addEventListener("click", function () { $("#dupes").hidden = true; pendingImport = null; });
    $("#dupes").addEventListener("click", function (e) { if (e.target === this) { this.hidden = true; pendingImport = null; } });
    $("#dupes-skip").addEventListener("click", function () {
      $("#dupes").hidden = true;
      if (pendingImport) runImport(pendingImport, "skip");
      pendingImport = null;
    });
    $("#dupes-again").addEventListener("click", function () {
      $("#dupes").hidden = true;
      if (pendingImport) runImport(pendingImport, "again");
      pendingImport = null;
    });

    LIB.onChange(function (kind, detail) {
      if (kind === "error") toast(detail, "warn");
    });

    /* ---- add-to-playlist picker ---- */
    $("#picker-close").addEventListener("click", closePicker);
    $("#picker").addEventListener("click", function (e) { if (e.target === this) closePicker(); });
    $("#picker-new").addEventListener("submit", function (e) {
      e.preventDefault();
      var name = $("#picker-new-name").value.trim();
      if (!name || !app.pickerSong) return;
      var p = LIB.createPlaylist(name);
      LIB.addToPlaylist(p.pid, app.pickerSong);
      toast("Added to “" + p.name + "”");
      closePicker();
      renderLibrary();
    });

    /* ---- invite rail ---- */
    $("#rail-toggle").addEventListener("click", function () {
      app.railOpen = !app.railOpen;
      $("#invite-rail").classList.toggle("collapsed", !app.railOpen);
      this.setAttribute("aria-expanded", String(app.railOpen));
    });

    /* ---- disclaimer ---- */
    $$(".disclaimer-open").forEach(function (b) {
      b.addEventListener("click", function () { $("#disclaimer").hidden = false; });
    });
    $$(".disclaimer-close").forEach(function (b) {
      b.addEventListener("click", function () { $("#disclaimer").hidden = true; });
    });
    $("#disclaimer").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (!$("#picker").hidden) closePicker();
      else if (!$("#dupes").hidden) { $("#dupes").hidden = true; pendingImport = null; }
      else if (!$("#libshare").hidden) closeLibShare();
      else if (!$("#disclaimer").hidden) $("#disclaimer").hidden = true;
    });
    $$(".tab").forEach(function (b) {
      b.addEventListener("click", function () { switchTab(b.dataset.tab); });
    });

    /* The fullscreen corner code is sized off the viewport, and the Invite tab
     * disappears at the width where the invite rail takes over — so both have
     * to be revisited when the window changes shape. */
    var resizeTimer = null;
    global.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        if (!app.state) return;
        renderShare();
        var tab = $(".tab[data-tab='" + app.tab + "']");
        // A resize can both reveal the whole tab row and hide the tab that was
        // selected — switchTab settles the fade and the scroll either way.
        switchTab(tab && tab.offsetParent === null ? "queue" : app.tab);
      }, 200);
    });

    global.addEventListener("hashchange", route);
    global.addEventListener("beforeunload", function () {
      if (app.role === "host") persistHost();
      // A room that ends because the tab did still had a length; record it
      // rather than leaving an open session growing forever.
      if (app.role && KN.stats) KN.stats.touchSession();
    });

    paintIcons();
    if (KN.sound) KN.sound.arm();
    setupTheme();
    setupNameGate();
    setupUpdateUI();
    switchTab("queue");
    startLocalClock();
    startCurfewWatch();
    setupInstall();
    route();
  }

  /* The host ticks off the real player position; a guest only hears about it
   * every couple of seconds, so it advances its own copy in between to keep
   * the progress bar from stuttering. */
  function startLocalClock() {
    setInterval(function () {
      if (app.role !== "guest" || !app.state) return;
      if (app.state.spinOffer) renderSpinOffer();
      if (app.state.player.status !== "playing") return;
      var d = app.state.player.duration || 0;
      app.state.player.time = d ? Math.min(d, app.state.player.time + 1) : app.state.player.time + 1;
      renderProgress();
    }, 1000);
  }

  /* The live room, for the end-to-end suites and for anyone poking at a room
   * from the browser console. Nothing here is a secret the page does not
   * already show — a room's only secret is its code, and that is printed on
   * the wall. */
  KN.app = app;
  KN.refresh = render;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : globalThis);

/* app.js — screens, wiring, and the two roles.
 *
 * One UI serves both roles. The host additionally owns the video player and the
 * authoritative state; a guest's identical-looking controls just send commands
 * over the data channel. `dispatch()` is the seam: on the host it applies
 * locally, on a guest it goes down the wire.
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
    name: "kn:name"
  };
  var RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;

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
    lastResults: [],
    tab: "queue"
  };

  /* ================= HOST ================= */

  function startHost(code, resumed) {
    app.role = "host";
    app.state = R.createState(code);
    app.name = app.name || loadName() || "Host";
    app.hostToken = (resumed && resumed.token) || null;

    if (resumed && resumed.queue) {
      app.state.queue = resumed.queue;
      app.state.now = resumed.now || null;
    }

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
          broadcastState();
        },
        broker: function () { render(); },
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
    persistHost();
    showRoom();
    setupPlayer();
    keepAwake();
  }

  function setupPlayer() {
    var mount = $("#yt-mount");
    // The API replaces its target element with the iframe, so give it a fresh
    // placeholder — but leave the overlay button in the mount alone.
    var stale = $("#yt-frame");
    if (stale) stale.remove();
    var err = $(".player-error");
    if (err) err.remove();
    mount.insertBefore(el("div", { id: "yt-frame" }), mount.firstChild);

    KN.player
      .create("yt-frame")
      .then(function (p) {
        app.player = p;
        p.volume(app.state.player.volume);
        p.mute(app.state.player.muted);

        p.on("ended", function () { nextSong(); });
        p.on("blocked", function () { $("#tap-to-play").hidden = false; });
        p.on("playing", function () {
          $("#tap-to-play").hidden = true;
          app.state.player.status = "playing";
          var m = p.meta();
          if (m && app.state.now) {
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
        $("#yt-mount").appendChild(el("p", { class: "player-error", text: err.message }));
      });
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
      renderProgress();
      if (moved) broadcastState({ quiet: true });
    }, 1000);
  }

  function onGuestCommand(link, data) {
    if (!data || typeof data.type !== "string") return;

    if (data.type === CMD.HELLO || data.type === CMD.NAME) {
      var nm = String(data.name || "").slice(0, 24).trim() || "Guest";
      app.guestNames[link.id] = nm;
      refreshGuestList();
      broadcastState();
      return;
    }
    if (data.type === CMD.RESYNC) { sendStateTo(link); return; }

    handle(data, app.guestNames[link.id] || "Guest", link.id);
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
        if (!result.changed) { broadcastState({ quiet: true }); return; }
        // First song added to an idle room starts playing by itself.
        if (!s.now && s.queue.length && s.player.status === "idle") { nextSong(); return; }
        break;
      }
    }
    broadcastState();
  }

  function nextSong() {
    var s = app.state;
    var next = R.advance(s);
    if (app.player) {
      if (next) { app.player.load(next.id); app.player.play(); }
      else app.player.stop();
    }
    broadcastState();
  }

  function refreshGuestList() {
    app.state.guests = app.net.guests().map(function (l) {
      return { id: l.id, name: app.guestNames[l.id] || "Guest" };
    });
  }

  function sendStateTo(link) {
    link.send({ type: MSG.STATE, rev: app.state.rev, state: app.state });
  }

  var lastBroadcast = 0;
  var broadcastPending = null;
  function broadcastState(opts) {
    if (app.role !== "host") return;
    app.state.rev++;
    render();
    persistHost();

    // Progress ticks would otherwise flood the channel once a second per guest.
    var quiet = opts && opts.quiet;
    var now = Date.now();
    if (quiet && now - lastBroadcast < 2500) {
      clearTimeout(broadcastPending);
      broadcastPending = setTimeout(function () { broadcastState({ quiet: true }); }, 2500);
      return;
    }
    clearTimeout(broadcastPending);
    lastBroadcast = now;
    app.net.broadcast({ type: MSG.STATE, rev: app.state.rev, state: app.state });
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
      now: app.state.now
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
      closed: function () { renderConnection(); }
    });

    save(STORE.guest, { at: Date.now(), code: code });
    showRoom();
  }

  function onHostMessage(data) {
    if (!data || !data.type) return;
    switch (data.type) {
      case MSG.WELCOME:
        app.clientId = data.clientId;
        break;
      case MSG.STATE:
        // Snapshots are authoritative; an out-of-order straggler is dropped.
        if (app.state && data.rev < app.state.rev) return;
        app.state = data.state;
        render();
        break;
      case MSG.NOTICE:
        toast(data.text, data.kind);
        break;
      case MSG.BYE:
        toast("The host closed the room.", "warn");
        leave();
        break;
    }
  }

  /* ================= shared ================= */

  /** Host applies; guest asks. */
  function dispatch(cmd) {
    if (app.role === "host") handle(cmd, app.name || "Host");
    else if (app.net) {
      app.net.send(cmd);
      if (!app.net.isOpen()) toast("Offline — queued until you reconnect.", "warn");
    }
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
    forget(STORE.guest);
    app.role = null;
    app.net = null;
    app.player = null;
    app.state = null;
    app.guestNames = {};
    location.hash = "#/";
    showHome();
  }

  /* ---------------- screen: home ---------------- */

  function showHome() {
    $("#view-home").hidden = false;
    $("#view-room").hidden = true;
    document.body.classList.remove("in-room", "is-host");

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

  /* ---------------- screen: room ---------------- */

  function showRoom() {
    $("#view-home").hidden = true;
    $("#view-room").hidden = false;
    document.body.classList.add("in-room");
    document.body.classList.toggle("is-host", app.role === "host");
    $("#room-code").textContent = app.state.code;
    $("#room-code-2").textContent = app.state.code;
    $("#name-input").value = app.name;
    renderShare();
    render();
  }

  function joinUrl() {
    return location.origin + location.pathname + "#/r/" + app.state.code;
  }

  function renderShare() {
    $("#share-url").textContent = joinUrl().replace(/^https?:\/\//, "");
    var canvas = $("#qr");
    try {
      QR.draw(canvas, joinUrl(), {
        ecc: "M",
        px: 260,
        dark: "#0b0b12",
        light: "#ffffff",
        quiet: 3
      });
      canvas.hidden = false;
      $("#qr-fallback").hidden = true;
    } catch (e) {
      canvas.hidden = true;
      $("#qr-fallback").hidden = false;
    }
  }

  function renderConnection(detail) {
    var badge = $("#conn");
    if (!badge) return;
    var map = {
      connected: ["ok", "connected"],
      connecting: ["warn", "connecting…"],
      retrying: ["warn", "reconnecting…"],
      stopped: ["bad", "left"],
      hosting: ["ok", "hosting"]
    };
    var e = map[app.connection] || ["bad", app.connection];
    badge.className = "conn conn-" + e[0];
    badge.textContent = e[1];
    badge.title = detail ? "via " + detail : "";
    $("#retry-btn").hidden = app.role !== "guest" || app.connection === "connected";
  }

  function render() {
    if (!app.state) return;
    renderConnection();
    renderNow();
    renderQueue();
    renderProgress();

    var s = app.state;
    $("#guest-count").textContent = String(s.guests.length);
    $("#vol").value = s.player.volume;
    $("#mute-btn").textContent = s.player.muted ? "🔇" : "🔊";
    $("#mute-btn").setAttribute("aria-pressed", String(s.player.muted));
    $("#play-btn").textContent = s.player.status === "playing" ? "⏸" : "▶";
    $("#play-btn").setAttribute("aria-label", s.player.status === "playing" ? "Pause" : "Play");
    if (app.role === "host") $("#broker-count").textContent = String(app.net ? app.net.onlineBrokers() : 0);
  }

  function renderNow() {
    var s = app.state;
    var box = $("#now");
    box.innerHTML = "";
    if (!s.now) {
      box.appendChild(el("p", { class: "empty", text: "Nothing playing. Add a song to start." }));
      return;
    }
    box.appendChild(
      el("div", { class: "now-card" }, [
        thumb("now-thumb", s.now.thumb),
        el("div", { class: "now-meta" }, [
          el("div", { class: "now-title", text: s.now.title }),
          el("div", { class: "now-artist", text: s.now.author || "—" }),
          el("div", { class: "now-by", text: "queued by " + s.now.addedBy })
        ])
      ])
    );
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

    if (!s.queue.length) {
      list.appendChild(el("li", { class: "empty", text: "Queue is empty — search for a song." }));
      return;
    }

    s.queue.forEach(function (song, i) {
      list.appendChild(
        el("li", { class: "row" }, [
          el("span", { class: "row-num", text: String(i + 1) }),
          thumb("row-thumb", song.thumb),
          el("div", { class: "row-meta" }, [
            el("div", { class: "row-title", text: song.title }),
            el("div", { class: "row-sub", text: (song.author || "—") + " · " + song.addedBy })
          ]),
          el("span", { class: "row-time", text: song.duration ? R.fmtTime(song.duration) : "" }),
          el("div", { class: "row-actions" }, [
            btn("⤒", "Play next", function () { dispatch({ type: CMD.MOVE, sid: song.sid, dir: "top" }); }),
            btn("▲", "Move up", function () { dispatch({ type: CMD.MOVE, sid: song.sid, dir: "up" }); }),
            btn("▼", "Move down", function () { dispatch({ type: CMD.MOVE, sid: song.sid, dir: "down" }); }),
            btn("▶", "Play now", function () { dispatch({ type: CMD.PLAY_NOW, sid: song.sid }); }),
            btn("✕", "Remove", function () { dispatch({ type: CMD.REMOVE, sid: song.sid }); })
          ])
        ])
      );
    });
  }

  function btn(label, title, onClick) {
    return el("button", { class: "icon-btn", title: title, "aria-label": title, onclick: onClick, text: label });
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

  /* ---------------- search ---------------- */

  function runSearch() {
    var input = $("#q");
    var q = input.value.trim();
    if (!q || app.searchBusy) return;

    var results = $("#results");
    var status = $("#search-status");

    // A pasted link never needs a search mirror.
    if (KN.search.parseVideoId(q)) {
      status.textContent = "Reading link…";
      results.innerHTML = "";
      app.searchBusy = true;
      KN.search
        .resolve(q)
        .then(function (video) {
          dispatch({ type: CMD.ADD, video: video });
          input.value = "";
          status.textContent = "";
          confirmAdded(video.title);
          switchTab("queue");
        })
        .catch(function (e) { status.textContent = e.message; })
        .finally(function () { app.searchBusy = false; });
      return;
    }

    app.searchBusy = true;
    status.textContent = "Searching…";
    results.innerHTML = "";

    KN.search
      .search(q)
      .then(function (out) {
        app.lastResults = out.results;
        status.textContent = out.results.length
          ? out.results.length + " results · " + out.source
          : "No results.";
        renderResults(out.results);
      })
      .catch(function (e) {
        status.textContent = e.message;
        results.innerHTML = "";
      })
      .finally(function () { app.searchBusy = false; });
  }

  /* The host already hears about its own additions through notice(); only a
   * guest needs local confirmation that the tap landed. */
  function confirmAdded(title) {
    if (app.role !== "host") toast("Added “" + title + "”");
  }

  function renderResults(results) {
    var box = $("#results");
    box.innerHTML = "";
    results.forEach(function (v) {
      box.appendChild(
        el("li", { class: "row row-result" }, [
          thumb("row-thumb", v.thumb),
          el("div", { class: "row-meta" }, [
            el("div", { class: "row-title", text: v.title }),
            el("div", { class: "row-sub", text: v.author || "" })
          ]),
          el("span", { class: "row-time", text: v.duration ? R.fmtTime(v.duration) : "" }),
          el("button", {
            class: "add-btn",
            text: "Add",
            onclick: function () {
              dispatch({ type: CMD.ADD, video: v });
              confirmAdded(v.title);
            }
          })
        ])
      );
    });
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
      if (app.role) {
        if (app.net) app.net.stop();
        if (app.player) app.player.destroy();
        clearInterval(ticker);
      }
      startGuest(code);
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
      var code = KN.net.normalizeCode($("#join-code").value);
      if (code.length !== 6) { toast("Room codes are 6 characters.", "warn"); return; }
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
      saveName(this.value.slice(0, 24).trim());
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

    $("#fs-btn").addEventListener("click", function () {
      var stage = $("#stage");
      if (document.fullscreenElement) document.exitFullscreen();
      else if (stage.requestFullscreen) stage.requestFullscreen().catch(function () { /* refused */ });
    });

    // search
    $("#search-form").addEventListener("submit", function (e) { e.preventDefault(); runSearch(); });
    $$(".tab").forEach(function (b) {
      b.addEventListener("click", function () { switchTab(b.dataset.tab); });
    });

    global.addEventListener("hashchange", route);
    global.addEventListener("beforeunload", function () {
      if (app.role === "host") persistHost();
    });

    switchTab("queue");
    startLocalClock();
    route();
  }

  /* The host ticks off the real player position; a guest only hears about it
   * every couple of seconds, so it advances its own copy in between to keep
   * the progress bar from stuttering. */
  function startLocalClock() {
    setInterval(function () {
      if (app.role !== "guest" || !app.state) return;
      if (app.state.player.status !== "playing") return;
      var d = app.state.player.duration || 0;
      app.state.player.time = d ? Math.min(d, app.state.player.time + 1) : app.state.player.time + 1;
      renderProgress();
    }, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : globalThis);

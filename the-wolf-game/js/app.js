/* app.js — the part with a screen in it.
 *
 * Host and guest run the same file. The host is the only place the game exists:
 * it owns the state, runs the engine, and answers every guest with a snapshot
 * built for that guest alone. A guest holds a mirror it is not allowed to
 * reason about — it renders what it was sent and asks for everything else.
 *
 * That asymmetry is the whole security model. There is no server to check
 * anything, so "can I see this" and "may I do this" are decided once, on the
 * host, in engine/view.js and engine/engine.js. Nothing below this line is
 * trusted to enforce a rule; the UI hides what you cannot do because showing it
 * would be rude, not because hiding it is what stops you.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  var CMD = WG.protocol.CMD, MSG = WG.protocol.MSG;
  var doc = document;

  var APP_VERSION = "1.0.0";
  var STORE = { name: "wg.name", host: "wg.host", guest: "wg.guest", avatar: "wg.avatar" };

  /* ---------------- tiny DOM ---------------- */

  function el(tag, attrs, kids) {
    var n = doc.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "text") n.textContent = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "class") n.className = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    [].concat(kids || []).forEach(function (c) {
      if (c == null || c === false) return;
      n.appendChild(typeof c === "string" ? doc.createTextNode(c) : c);
    });
    return n;
  }
  function $(id) { return doc.getElementById(id); }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); return n; }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function drop(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  var TOAST_ICON = { warn: "hourglass", bad: "blood", ok: "check" };
  function toast(text, kind) {
    var box = $("toasts");
    if (!box) return;
    var t = el("div", { class: "toast " + (kind || "") }, [
      WG.icons.node(TOAST_ICON[kind] || "star", 16),
      el("span", { class: "grow", text: text })
    ]);
    box.appendChild(t);
    setTimeout(function () {
      t.style.transition = "opacity .3s, transform .3s";
      t.style.opacity = "0"; t.style.transform = "translateY(6px)";
      setTimeout(function () { t.remove(); }, 320);
    }, kind === "bad" ? 6000 : 3800);
  }

  function fmt(ms) {
    if (!isFinite(ms)) return "—";
    var s = Math.max(0, Math.round(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  /* ---------------- app ---------------- */

  var app = {
    role: null,            // "host" | "guest"
    screen: "home",        // home | room
    net: null,
    state: null,           // host: authoritative. guest: the mirror it was sent.
    view: null,            // what is actually rendered, both roles
    engine: null,          // host only
    clientId: null,
    name: "",
    avatar: null,
    connection: "offline",
    waiting: false,
    tab: "village",
    settingsTab: "flow",
    sheet: null,           // { houseId, offers, discovery, ... }
    pendingSwap: null,     // a two-house action waiting for its second door
    guestNames: {},        // host only
    approved: {},          // host only
    installPrompt: null,
    lastLogLen: 0
  };

  /* ================= HOST ================= */

  function startHost(code, resumed) {
    app.role = "host";
    app.name = app.name || load(STORE.name) || "Host";
    var state = WG.state.createState(code);
    state.hostId = "host";
    state.hostName = app.name;
    state.players.push(Object.assign(WG.state.createPlayer("host", app.name, 0), { avatar: app.avatar }));
    state.roster = suggestRoster(1);
    if (resumed && resumed.config) state.config = WG.state.sanitizeConfig(resumed.config);
    if (resumed && resumed.roster) state.roster = resumed.roster;
    app.state = state;
    app.approved = (resumed && resumed.approved) || {};
    app.clientId = "host";

    app.engine = WG.engine.create(state, {
      toPlayer: function (id, msg) {
        if (id === "host") return onHostSelfMessage(msg);
        var link = linkFor(id);
        if (link) link.send(msg);
      },
      toAll: function () {},
      changed: function () { broadcast(); },
      ended: function (result) {
        // The room's last state is worth keeping around: a host who reloads
        // after the reveal should still be able to show everybody the board.
        persistHost();
        toast(result && result.message ? result.message : "That is the game.", "ok");
      }
    });

    app.net = WG.net.host(code, {
      token: (resumed && resumed.token) || null,
      on: {
        "guest-open": function (link) {
          app.guestNames[link.id] = app.guestNames[link.id] || "Player";
          link.send({ type: MSG.WELCOME, clientId: link.id, code: code, version: APP_VERSION });
          admit(link);
          broadcast();
        },
        "guest-message": function (link, data) { onGuestCommand(link, data); },
        "guest-close": function (link) {
          var p = playerOf(link.id);
          if (p) p.connected = false;
          // Somebody who never got past the door is not a departure worth
          // remembering; somebody mid-game keeps their seat and their role.
          if (state.phase === "lobby") {
            state.players = state.players.filter(function (x) { return x.id !== link.id; });
            reseat();
          }
          state.pending = state.pending.filter(function (x) { return x.id !== link.id; });
          broadcast();
        },
        broker: function () { render(); },
        wake: function () { broadcast(); },
        "code-taken": function () {
          toast("That room code was taken — moving to a new one.", "warn");
          var carry = { config: state.config, roster: state.roster, approved: app.approved };
          app.net.stop();
          startHost(WG.net.makeCode(), carry);
        }
      }
    });

    persistHost();
    showRoom();
    startLoop();
  }

  function linkFor(id) {
    if (!app.net || !app.net.guests) return null;
    var all = app.net.guests();
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function playerOf(id) {
    if (!app.state) return null;
    for (var i = 0; i < app.state.players.length; i++) if (app.state.players[i].id === id) return app.state.players[i];
    return null;
  }
  function reseat() { app.state.players.forEach(function (p, i) { p.seat = i; }); }

  /* The door. With approval on, a guest gets a lobby view and nothing else
   * until somebody lets them in — because a six-character code against a public
   * broker is guessable, and "anyone who guesses is in the room" is a worse
   * default than one tap from the host. */
  function admit(link) {
    var s = app.state;
    var needsApproval = s.config.room.joinApproval && !app.approved[link.id];
    if (needsApproval) {
      if (!s.pending.some(function (x) { return x.id === link.id; })) {
        s.pending.push({ id: link.id, name: app.guestNames[link.id], at: Date.now() });
      }
      link.send({ type: MSG.WAIT });
      link.send({ type: MSG.STATE, rev: s.rev, state: WG.view.lobbyView(s, app.guestNames[link.id]) });
      return;
    }
    seat(link.id);
  }

  function seat(id) {
    var s = app.state;
    var existing = playerOf(id);
    if (existing) { existing.connected = true; existing.name = app.guestNames[id] || existing.name; return existing; }
    if (s.phase !== "lobby") {
      // Arriving mid-game means watching it, not joining it.
      var spec = WG.state.createPlayer(id, app.guestNames[id] || "Watcher", s.players.length);
      spec.spectator = true; spec.role = "villager"; spec.alive = false;
      s.players.push(spec);
      return spec;
    }
    if (s.players.length >= s.config.room.maxPlayers) return null;
    var p = WG.state.createPlayer(id, app.guestNames[id] || "Player", s.players.length);
    s.players.push(p);
    s.roster = suggestRoster(s.players.length);
    return p;
  }

  function onGuestCommand(link, data) {
    if (!data || !data.type) return;
    var s = app.state;

    if (data.type === CMD.HELLO || data.type === CMD.NAME) {
      var nm = String(data.name || "Player").slice(0, 20).trim() || "Player";
      app.guestNames[link.id] = nm;
      var p = playerOf(link.id);
      if (p) p.name = nm;
      s.pending.forEach(function (x) { if (x.id === link.id) x.name = nm; });
      if (data.type === CMD.HELLO) {
        if (data.avatar && typeof data.avatar === "string" && data.avatar.length < 40000) {
          if (p) p.avatar = data.avatar;
        }
        admit(link);
      }
      broadcast();
      return;
    }

    if (waiting(link.id)) {
      link.send({ type: MSG.WAIT });
      link.send({ type: MSG.NOTICE, text: "The host has not let you in yet.", kind: "warn" });
      return;
    }
    if (data.type === CMD.RESYNC) { sendStateTo(link); return; }

    // Room administration the engine does not own, because it is about links.
    if (data.type === CMD.APPROVE) {
      if (!WG.view.isManager(s, link.id)) {
        link.send({ type: MSG.NOTICE, text: "Only the host and co-hosts can do that.", kind: "warn" });
        return;
      }
      return approve(data.id, data.ok);
    }
    if (data.type === CMD.KICK) {
      if (!WG.view.isManager(s, link.id)) {
        link.send({ type: MSG.NOTICE, text: "Only the host and co-hosts can do that.", kind: "warn" });
        return;
      }
      return kick(data.id);
    }

    app.engine.handle(data, link.id);
  }

  function waiting(id) {
    return app.state.pending.some(function (x) { return x.id === id; });
  }

  function approve(id, ok) {
    var s = app.state;
    s.pending = s.pending.filter(function (x) { return x.id !== id; });
    var link = linkFor(id);
    if (ok) {
      app.approved[id] = true;
      seat(id);
      if (link) link.send({ type: MSG.NOTICE, text: "You are in.", kind: "ok" });
    } else if (link) {
      link.send({ type: MSG.BYE, reason: "refused" });
    }
    broadcast();
  }

  function kick(id) {
    var s = app.state;
    delete app.approved[id];
    delete s.cohosts[id];
    var link = linkFor(id);
    if (link) {
      link.send({ type: MSG.BYE, reason: "kicked" });
      // Dropping the channel is only half of it — the guest's retry loop is
      // already dialling back. peer.js keeps a per-connection ban for exactly
      // this, so use it rather than destroying the link and hoping.
      setTimeout(function () { if (app.net && app.net.kick) app.net.kick(id); else link.destroy("kicked"); }, 250);
    }
    s.players = s.players.filter(function (x) { return x.id !== id; });
    s.pending = s.pending.filter(function (x) { return x.id !== id; });
    reseat();
    broadcast();
  }

  /** The host is a player too, so its own private messages go here. */
  function onHostSelfMessage(msg) {
    if (msg.type === MSG.PRIVATE) return pushPrivate(msg.entry);
    if (msg.type === MSG.NOTICE) return toast(msg.text, msg.kind);
    if (msg.type === MSG.OFFERS) return openSheet(msg);
  }

  var lastBroadcast = 0, broadcastTimer = null;
  function broadcast(opts) {
    if (app.role !== "host") return;
    var s = app.state;
    s.rev++;
    render();
    persistHost();

    // Snapshots are per recipient — a lobby view for the people at the door, a
    // redacted game view for everybody else — so this cannot be one message
    // sent to everyone the way a karaoke queue could.
    var now = Date.now();
    if (opts && opts.quiet && now - lastBroadcast < 700) {
      clearTimeout(broadcastTimer);
      broadcastTimer = setTimeout(function () { broadcast({ quiet: true }); }, 700);
      return;
    }
    clearTimeout(broadcastTimer);
    lastBroadcast = now;
    (app.net.guests() || []).forEach(sendStateTo);
  }

  function sendStateTo(link) {
    var s = app.state;
    var view = waiting(link.id)
      ? WG.view.lobbyView(s, app.guestNames[link.id])
      : WG.view.build(s, link.id);
    link.send({ type: MSG.STATE, rev: s.rev, state: view });
  }

  function persistHost() {
    if (app.role !== "host") return;
    save(STORE.host, {
      at: Date.now(), code: app.state.code, token: app.net && app.net.token,
      config: app.state.config, roster: app.state.roster, approved: app.approved
    });
  }

  /* The clock. One interval for the whole game: it nudges the engine, which
   * decides whether anything is actually due, and repaints the countdown. */
  var loop = null;
  function startLoop() {
    if (loop) return;
    loop = setInterval(function () {
      if (app.role === "host" && app.engine) {
        var before = app.state.phase + ":" + app.state.round;
        app.engine.tick();
        if (before !== app.state.phase + ":" + app.state.round) broadcast();
        else if (Date.now() - lastBroadcast > 4000) broadcast({ quiet: true });
      }
      paintClock();
      updateAudio();
    }, 500);
  }

  /* ================= GUEST ================= */

  function startGuest(code) {
    app.role = "guest";
    app.name = app.name || load(STORE.name) || "";
    app.net = WG.net.join(code, {
      state: function (s) { app.connection = s; renderConnection(); },
      open: function () {
        app.net.send({ type: CMD.HELLO, name: app.name || "Player", avatar: app.avatar });
        app.net.send({ type: CMD.RESYNC });
      },
      message: function (data) { onHostMessage(data); },
      closed: function () { renderConnection(); },
      wake: function () {
        // The channel proved itself alive but it was deaf while we were away.
        app.net.send({ type: CMD.HELLO, name: app.name || "Player", avatar: app.avatar });
        app.net.send({ type: CMD.RESYNC });
      }
    });
    save(STORE.guest, { at: Date.now(), code: code });
    showRoom();
    startLoop();
  }

  function onHostMessage(data) {
    if (!data || !data.type) return;
    switch (data.type) {
      case MSG.WELCOME:
        app.clientId = data.clientId;
        break;
      case MSG.STATE:
        // Snapshots are authoritative; a straggler from before the last one is
        // not an update, it is a rollback.
        if (app.view && data.rev < app.view.rev) return;
        app.view = data.state;
        app.waiting = !!data.state.lobby;
        render();
        break;
      case MSG.NOTICE: toast(data.text, data.kind); break;
      case MSG.PRIVATE: pushPrivate(data.entry); break;
      case MSG.OFFERS: openSheet(data); break;
      case MSG.WAIT: app.waiting = true; render(); break;
      case MSG.BYE:
        toast({ kicked: "You were removed from the room.", refused: "The host did not let you in." }[data.reason] ||
          "The host closed the room.", "warn");
        leave();
        break;
    }
  }

  /* ================= shared ================= */

  /** Host applies; guest asks. Same call either way. */
  function dispatch(cmd) {
    if (app.role === "host") {
      if (cmd.type === CMD.APPROVE) return approve(cmd.id, cmd.ok);
      if (cmd.type === CMD.KICK) return kick(cmd.id);
      app.engine.handle(cmd, "host");
      return;
    }
    if (!app.net) return;
    app.net.send(cmd);
    if (!app.net.isOpen()) toast("Offline — queued until you reconnect.", "warn");
  }

  function currentView() {
    if (app.role === "host") return WG.view.build(app.state, "host");
    return app.view;
  }

  var privateLog = [];
  var PRIVATE_SOUND = { death: "death", saved: "saved", revive: "saved", bite: "tap", trap: "tap" };
  function pushPrivate(entry) {
    privateLog.push(entry);
    if (privateLog.length > 120) privateLog.shift();
    var cue = PRIVATE_SOUND[entry.kind];
    if (cue) WG.sound.play(cue);
    // Anything with a body in it deserves more than a line in a list.
    toast(entry.text, entry.kind === "death" || entry.kind === "warn" ? "bad" :
      entry.kind === "saved" || entry.kind === "revive" ? "ok" : null);
    render();
  }

  function leave() {
    if (app.net) app.net.stop();
    app.net = null; app.role = null; app.state = null; app.view = null;
    app.engine = null; privateLog = [];
    drop(STORE.guest);
    showHome();
  }

  /* ================= screens ================= */

  function showHome() { app.screen = "home"; render(); }
  function showRoom() { app.screen = "room"; render(); }

  /* The frame is fixed and the stage is the only part that changes, so a
   * screen returns { stage, dock } — the thing you look at, and the thing you
   * press. Nothing here is allowed to make the page taller than the viewport. */
  function render() {
    var stage = $("stage"), dock = $("dock");
    if (!stage) return;
    clear(stage); clear(dock);
    var out = app.screen === "home" ? renderHome()
      : app.waiting ? renderLobbyWait()
      : renderRoom();
    if (out.stage) stage.appendChild(out.stage); else stage.appendChild(out);
    if (out.dock) dock.appendChild(out.dock);
    renderTopbar();
    updateGore();
    updateAudio();
  }

  /* Sound and blood both key off the same thing: what changed since the last
   * render. Nothing here polls, and nothing fires twice for one event. */
  var lastPhase = null, lastRound = 0, lastLogLen = 0, lastHeart = 0;

  function updateAudio() {
    var v = currentView();
    if (!v || !v.phase) { WG.sound.scene("none"); lastPhase = null; return; }
    var soundOn = !v.config || !v.config.look || v.config.look.sound !== false;
    WG.sound.setEnabled(soundOn);
    if (!soundOn) return;

    var dark = v.phase === "night" || v.phase === "verdict" || v.phase === "role_reveal";
    WG.sound.scene(v.phase === "lobby" || v.phase === "game_over" ? "none" : dark ? "night" : "day");

    if (v.phase !== lastPhase || v.round !== lastRound) {
      if (v.phase === "night") WG.sound.play("howl");
      else if (v.phase === "dawn") WG.sound.play(deathsThisRound(v) ? "crow" : "dawn");
      else if (v.phase === "verdict") WG.sound.play("bell");
      if (lastPhase) sweep(v.phase);
      lastPhase = v.phase; lastRound = v.round;
    }

    // The last ten seconds of a timed phase get a pulse under them.
    if (v.phaseEndsAt) {
      var left = v.phaseEndsAt - Date.now();
      if (left > 0 && left < 10000 && Date.now() - lastHeart > 950) {
        lastHeart = Date.now();
        WG.sound.play("heart");
      }
    }
  }

  /* A phase change is the biggest thing that happens without anybody pressing
   * anything, so it gets a sweep across the screen — dark when the sun is going
   * down, light when it is coming up. Half a second, once, never on the first
   * render. */
  function sweep(phase) {
    var dark = phase === "night" || phase === "verdict";
    var el2 = doc.getElementById("sweep");
    if (!el2) return;
    el2.className = "sweep " + (dark ? "to-night" : "to-day");
    el2.style.animation = "none";
    void el2.offsetWidth;
    el2.style.animation = "";
  }

  function deathsThisRound(v) {
    return v.publicLog.some(function (e) { return e.round === v.round && e.kind === "death"; });
  }

  /* How bloody the room is. A death lands as a flash and a spatter; the running
   * stain is the fraction of the village that is gone, so a game that is going
   * badly looks like it. */
  var lastDeadCount = 0;
  function updateGore() {
    var v = currentView();
    if (!v || !v.players || !v.players.length) {
      document.documentElement.style.setProperty("--gore", "0");
      lastDeadCount = 0;
      if (WG.sky) WG.sky.stain(0);
      return;
    }
    var seats = v.players.filter(function (p) { return !p.spectator; });
    var dead = seats.filter(function (p) { return !p.alive; }).length;
    if (dead > lastDeadCount && v.phase !== "lobby") {
      for (var i = 0; i < dead - lastDeadCount; i++) if (WG.sky) WG.sky.bleed(0.18);
      document.body.classList.add("struck");
      setTimeout(function () { document.body.classList.remove("struck"); }, 520);
    }
    lastDeadCount = dead;
    var level = seats.length ? Math.min(1, (dead / seats.length) * 2) : 0;
    document.documentElement.style.setProperty("--gore", String(level * 0.9));
    if (WG.sky) WG.sky.stain(level);
  }

  function renderTopbar() {
    var bar = $("topbar");
    if (!bar) return;
    clear(bar);
    var v = currentView();
    bar.appendChild(el("div", { class: "brand" }, [
      el("span", { class: "brand-mark" }, [WG.icons.node("moon", 17)]),
      el("span", { class: "grow" }, [
        el("div", { class: "brand-name", text: "The Wolf Game" }),
        el("div", { class: "brand-sub", text: v && v.code ? v.code : "" })
      ])
    ]));
    if (app.role) bar.appendChild(renderConnPill());
    if (app.installPrompt) {
      bar.appendChild(el("button", {
        class: "btn ghost icon", title: "Install", "aria-label": "Install", onclick: doInstall
      }, [WG.icons.node("download", 18)]));
    }
    bar.appendChild(el("button", {
      class: "btn ghost icon", title: "Theme", "aria-label": "Change theme",
      onclick: function () { WG.theme.cycle(); render(); }
    }, [WG.icons.node("contrast", 18)]));
    if (fullscreenAvailable()) {
      bar.appendChild(el("button", {
        class: "btn ghost icon", id: "fs-btn", title: "Fullscreen", "aria-label": "Fullscreen",
        onclick: toggleFullscreen
      }, [WG.icons.node(fullscreenElement() ? "contract" : "expand", 18)]));
    }
  }

  function renderConnPill() {
    // A host is "online" when at least one broker can still hand out its code.
    // Guests already have a real connection state; a host only has reachability.
    var s = app.role === "host"
      ? (app.net && app.net.onlineBrokers && app.net.onlineBrokers() > 0 ? "online" : "retrying")
      : app.connection;
    var label = app.role === "host"
      ? { online: "open", retrying: "reopening", offline: "offline", stopped: "closed" }
      : { online: "linked", retrying: "reconnecting", waiting: "finding host", offline: "offline", stopped: "offline" };
    return el("span", { class: "conn " + (s === "online" ? "online" : s === "offline" || s === "stopped" ? "offline" : "retrying"), id: "conn" },
      [el("span", { class: "dot" }), el("span", { class: "hide-tight", text: label[s] || s })]);
  }
  function renderConnection() { renderTopbar(); }

  /* ---------------- home ---------------- */

  function renderHome() {
    var stage = el("div", { class: "pane grow center reveal" });
    var dock = el("div");

    stage.appendChild(el("div", { style: "text-align:center;margin-bottom:14px" }, [
      el("div", { style: "color:var(--accent);display:flex;justify-content:center" },
        [WG.icons.node("moon", 54, { weight: 1.1 })]),
      el("h1", { style: "margin:8px 0 2px", text: "The Wolf Game" }),
      el("p", { class: "muted small", style: "max-width:30ch;margin:0 auto",
        text: "A village. A pack. Everyone on their own phone." })
    ]));

    var nameInput = el("input", {
      type: "text", value: app.name || "", maxlength: "20", placeholder: "Your name",
      oninput: function (e) { app.name = e.target.value.slice(0, 20); save(STORE.name, app.name); }
    });
    var codeInput = el("input", {
      type: "text", class: "code-input", maxlength: "6", placeholder: "CODE",
      autocapitalize: "characters", autocomplete: "off", spellcheck: "false",
      oninput: function (e) { e.target.value = WG.net.normalizeCode(e.target.value); }
    });

    stage.appendChild(el("div", { class: "card" }, [
      el("label", { class: "field" }, [el("span", { text: "Name" }), nameInput]),
      el("label", { class: "field", style: "margin-bottom:0" }, [el("span", { text: "Room code" }), codeInput])
    ]));

    var prev = load(STORE.guest);
    if (prev && Date.now() - prev.at < 6 * 3600 * 1000) {
      stage.appendChild(el("div", { class: "card spread" }, [
        WG.icons.node("back", 17),
        el("div", { class: "grow" }, [el("div", { class: "row-title", text: "Rejoin " + prev.code })]),
        el("button", { class: "btn small", onclick: function () { startGuest(prev.code); } }, ["Rejoin"])
      ]));
    }

    stage.appendChild(el("div", { style: "margin-top:10px;text-align:center" }, [
      el("button", {
        class: "btn ghost small", onclick: function () { showCast(); }
      }, [WG.icons.node("users", 15), "All 35 roles"])
    ]));

    dock.appendChild(el("div", { class: "spread" }, [
      el("button", {
        class: "btn big grow", id: "btn-join", onclick: function () {
          var code = WG.net.normalizeCode(codeInput.value);
          if (code.length !== 6) return toast("Room codes are six characters.", "warn");
          if (!app.name.trim()) return toast("Put a name in first.", "warn");
          save(STORE.name, app.name);
          startGuest(code);
        }
      }, [WG.icons.node("door", 18), "Join"]),
      el("button", {
        class: "btn primary big grow", id: "btn-host", onclick: function () {
          if (!app.name.trim()) return toast("Put a name in first.", "warn");
          startHost(WG.net.makeCode());
        }
      }, [WG.icons.node("village", 18), "Open a village"])
    ]));

    return { stage: stage, dock: dock };
  }

  /** The whole cast, browsable before anybody has dealt anything. */
  function showCast() {
    var body = el("div");
    ["village", "werewolf", "cult", "solo"].forEach(function (team) {
      var list = WG.roles.all().filter(function (r) { return r.team === team; });
      body.appendChild(el("div", { class: "spread", style: "margin:12px 0 6px" }, [
        el("span", { class: "team-dot team-" + team }),
        el("h3", { style: "margin:0", text: WG.roles.teams[team].name }),
        el("span", { class: "pill", text: String(list.length) })
      ]));
      var grid = el("div", { class: "roster" });
      list.forEach(function (r) {
        grid.appendChild(el("button", {
          class: "roster-item team-" + team, onclick: function () { showRoleCard(r.id); }
        }, [
          WG.icons.node(r.icon, 20),
          el("span", { class: "grow" }, [
            el("div", { class: "rn", text: r.name }),
            el("div", { class: "rd", text: r.tagline })
          ])
        ]));
      });
      body.appendChild(grid);
    });
    openModal(el("div", {}, [el("h2", { text: "The cast" }), body]));
  }

  function renderLobbyWait() {
    return {
      stage: el("div", { class: "pane grow center reveal" }, [
        el("div", { class: "empty" }, [
          WG.icons.node("door", 44, { weight: 1.2 }),
          el("h2", { text: "At the door" }),
          el("p", { class: "muted small", text: "Waiting to be let in." })
        ])
      ]),
      dock: el("button", { class: "btn wide", onclick: leave }, ["Leave"])
    };
  }

  /* ---------------- room ---------------- */

  function renderRoom() {
    var v = currentView();
    if (!v) {
      return { stage: el("div", { class: "pane grow center" }, [
        el("div", { class: "empty" }, [WG.icons.node("link", 40), "Finding the room"])
      ]) };
    }

    var stage = el("div", { class: "pane grow", style: "display:flex;flex-direction:column;gap:8px;min-height:0" });
    if (v.phase !== "lobby") stage.appendChild(renderPhaseHeader(v));
    if (v.currentEvent) {
      stage.appendChild(el("div", { class: "turn-state", style: "border-color:var(--accent-line)" }, [
        WG.icons.node(v.currentEvent.icon, 17),
        el("span", { class: "grow" }, [
          el("b", { text: v.currentEvent.name }), " ",
          el("span", { class: "dim", text: v.currentEvent.shortDescription || "" })
        ])
      ]));
    }

    var S = WG.screens;
    var draw = {
      lobby: S.lobby, role_reveal: S.reveal, night: S.night, dawn: S.dawn,
      discussion: S.discussion, voting: S.voting, verdict: S.dawn, game_over: S.gameOver
    }[v.phase] || S.lobby;

    var out = draw(v) || {};
    if (out.body) stage.appendChild(out.body);

    var dock = el("div", { style: "display:flex;flex-direction:column;gap:6px" });
    if (out.dock) dock.appendChild(out.dock);
    if (v.phase !== "lobby" && v.phase !== "game_over" && canManage(v)) dock.appendChild(S.hostControls(v));

    return { stage: stage, dock: dock };
  }

  function renderPhaseHeader(v) {
    var p = WG.clock.phase(v.phase) || { name: v.phase, icon: "star" };
    var remain = v.phaseEndsAt ? v.phaseEndsAt - Date.now() : Infinity;
    var frac = v.phaseEndsAt ? Math.max(0, Math.min(1, (v.phaseEndsAt - Date.now()) / (v.phaseEndsAt - v.phaseStartedAt))) : 1;
    var urgent = isFinite(remain) && remain < 20000;
    return el("div", { class: "phase" + (urgent ? " urgent" : ""), id: "phase-head" }, [
      el("span", { class: "phase-icon" }, [WG.icons.node(p.icon, 22)]),
      el("span", { class: "grow" }, [
        el("div", { class: "phase-name", text: p.name + (p.showRound && v.round ? " " + v.round : "") }),
        el("div", { class: "phase-sub", text: p.description || "" })
      ]),
      v.phaseEndsAt ? el("span", { class: "phase-clock", id: "phase-clock", text: fmt(remain) }) : null,
      el("i", { class: "phase-bar", id: "phase-bar", style: "width:" + (frac * 100) + "%" })
    ]);
  }

  function paintClock() {
    var v = currentView();
    if (!v || !v.phaseEndsAt) return;
    var c = $("phase-clock"), b = $("phase-bar"), h = $("phase-head");
    var remain = v.phaseEndsAt - Date.now();
    if (c) c.textContent = fmt(remain);
    if (b) {
      var frac = Math.max(0, Math.min(1, remain / Math.max(1, v.phaseEndsAt - v.phaseStartedAt)));
      b.style.width = (frac * 100) + "%";
    }
    var urgent = remain < 20000;
    if (c) c.classList.toggle("urgent", urgent);
    if (h) h.classList.toggle("urgent", urgent);
  }

  /** The host, and anyone it has made a co-host, can run the room. */
  function canManage(v) {
    if (app.role === "host") return true;
    return !!(v && v.me && v.me.cohost);
  }

  WG.app = { render: render, toast: toast, el: el, dispatch: dispatch, currentView: currentView,
             get state() { return app; }, privateLog: function () { return privateLog; } };

  /* The rest of the screens live in js/ui/screens.js — this file is the wiring,
   * that one is the drawing, and keeping them apart is what stops either from
   * becoming the four-thousand-line file the legacy game had. */
  global.WG_APP = app;
  global.WG_HELPERS = {
    el: el, $: $, clear: clear, toast: toast, fmt: fmt, dispatch: dispatch,
    save: save, load: load, STORE: STORE, canManage: canManage, leave: leave,
    isStandalone: isStandalone, install: doInstall, toggleFullscreen: toggleFullscreen
  };

  /* ---------------- fullscreen ---------------- */

  function fullscreenElement() { return doc.fullscreenElement || doc.webkitFullscreenElement || null; }
  function fullscreenAvailable() {
    return !!(doc.documentElement.requestFullscreen || doc.documentElement.webkitRequestFullscreen);
  }
  function toggleFullscreen() {
    var root = doc.documentElement;
    if (fullscreenElement()) {
      (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
      return;
    }
    var req = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!req) return toast("This browser will not let the page go fullscreen.", "warn");
    var r = req.call(root);
    if (r && r.catch) r.catch(function () { toast("Fullscreen was refused.", "warn"); });
  }
  function syncFullscreen() {
    doc.body.classList.toggle("fullscreen", !!fullscreenElement());
    renderTopbar();
  }

  /* ---------------- install ---------------- */

  function isStandalone() {
    return !!(global.matchMedia && global.matchMedia("(display-mode: standalone)").matches) ||
      global.navigator.standalone === true;
  }
  function doInstall() {
    if (!app.installPrompt) return;
    app.installPrompt.prompt();
    app.installPrompt.userChoice.then(function (c) {
      if (c && c.outcome === "accepted") toast("Installed. It opens like an app now.", "ok");
      app.installPrompt = null;
      renderTopbar();
    });
  }

  /* ---------------- role card modal ---------------- */

  function showRoleCard(roleId) {
    var r = WG.roles.get(roleId);
    if (!r) return;
    openModal(el("div", { class: "rolecard team-" + r.team, style: "border:none;padding:0;background:none;backdrop-filter:none" }, [
      el("div", { class: "crest" }, [WG.icons.node(r.icon, 44, { weight: 1.2 })]),
      el("div", { class: "name", text: r.name }),
      el("div", { class: "tagline", text: r.tagline }),
      el("p", { text: r.description }),
      r.lore ? el("div", { class: "lore", text: r.lore }) : null,
      el("dl", { style: "margin:0" }, [
        el("dt", { text: "Wins by" }), el("dd", { text: r.winCondition }),
        el("dt", { text: "Side" }), el("dd", { text: WG.roles.teams[r.team].name })
      ]),
      abilityList(r)
    ]));
  }

  /** Actions then passives, as one list — the player does not care which is which. */
  function abilityList(r) {
    var items = (r.actions || []).map(function (a) {
      return el("li", {}, [WG.icons.node(a.icon, 17),
        el("span", {}, [el("b", { text: a.label }), " — ", a.description])]);
    }).concat((r.passives || []).map(function (pp) {
      return el("li", {}, [WG.icons.node("star", 17),
        el("span", {}, [el("b", { text: pp.name }), " — ", pp.description])]);
    }));
    return items.length ? el("ul", { class: "abilities" }, items) : null;
  }

  var modalNode = null;
  function openModal(content, opts) {
    closeModal();
    var back = el("div", { class: "sheet-backdrop", onclick: closeModal });
    var sheet = el("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, [
      el("div", { class: "sheet-grab" }), content,
      (opts && opts.noClose) ? null : el("button", { class: "btn wide", style: "margin-top:14px", onclick: closeModal }, ["Close"])
    ]);
    doc.body.appendChild(back);
    doc.body.appendChild(sheet);
    modalNode = [back, sheet];
  }
  function closeModal() {
    if (!modalNode) return;
    modalNode.forEach(function (n) { n.remove(); });
    modalNode = null;
    app.sheet = null;
  }
  WG_HELPERS.openModal = openModal;
  WG_HELPERS.closeModal = closeModal;
  WG_HELPERS.showRoleCard = showRoleCard;
  WG_HELPERS.abilityList = abilityList;
  WG_HELPERS.icon = function (n, size, o) { return WG.icons.node(n, size, o); };

  function openSheet(data) {
    app.sheet = data;
    WG.sound.play("knock");
    if (WG.screens && WG.screens.doorSheet) openModal(WG.screens.doorSheet(data));
  }

  /* ---------------- roster suggestion ---------------- */

  /** A sane bag for N players, so a host never faces 35 steppers at zero. */
  function suggestRoster(n) {
    var wolves = Math.max(1, Math.round(n / 4.5));
    var roster = { werewolf: wolves };
    var specials = ["seer", "doctor", "bodyguard", "detective", "witch", "engineer", "mayor", "avenger"];
    var slots = Math.max(1, Math.floor((n - wolves) * 0.55));
    for (var i = 0; i < Math.min(slots, specials.length); i++) roster[specials[i]] = 1;
    var used = Object.keys(roster).reduce(function (s, k) { return s + roster[k]; }, 0);
    if (n - used > 0) roster.villager = n - used;
    return roster;
  }
  WG_HELPERS.suggestRoster = suggestRoster;

  /* ---------------- boot ---------------- */

  function boot() {
    app.name = load(STORE.name) || "";
    app.avatar = load(STORE.avatar) || null;
    WG.theme.init();
    var liveView = function () {
      var v = currentView();
      return v && v.phase ? v : null;
    };
    WG.theme.follow(liveView);
    // One canvas behind everything, painting the hour the clock is already on.
    var canvas = $("sky");
    if (canvas) WG.sky.mount(canvas, liveView);

    // Browsers will not make a sound before a gesture, and a game that starts
    // howling before you have joined a room deserves the rule.
    ["pointerdown", "keydown", "touchstart"].forEach(function (ev) {
      doc.addEventListener(ev, function once() {
        WG.sound.unlock();
        ["pointerdown", "keydown", "touchstart"].forEach(function (e2) {
          doc.removeEventListener(e2, once);
        });
      }, { passive: true });
    });

    doc.addEventListener("fullscreenchange", syncFullscreen);
    doc.addEventListener("webkitfullscreenchange", syncFullscreen);
    global.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      app.installPrompt = e;
      renderTopbar();
    });
    global.addEventListener("appinstalled", function () { app.installPrompt = null; renderTopbar(); });
    global.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
      if (e.key === "f" && e.target === doc.body) toggleFullscreen();
    });
    // Closing the tab mid-game takes the whole room with it, so say so.
    global.addEventListener("beforeunload", function (e) {
      if (app.role === "host" && app.state && app.state.phase !== "lobby" && !app.state.winner) {
        e.preventDefault(); e.returnValue = "";
      }
    });

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      navigator.serviceWorker.register("./sw.js").catch(function () { /* offline is a bonus, not a requirement */ });
    }
    if (isStandalone()) doc.body.classList.add("standalone");

    var hash = (location.hash || "").replace(/^#\/?/, "");
    render();
    if (hash === "host" && app.name) startHost(WG.net.makeCode());
    else if (/^join\/([A-Z0-9]{6})$/i.test(hash) && app.name) startGuest(WG.net.normalizeCode(RegExp.$1));
  }

  WG.boot = boot;
})(typeof window !== "undefined" ? window : globalThis);

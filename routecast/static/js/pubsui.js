/* ============================================================
   RouteCast — PUBs, on the screen

   RC.pubs owns the public road; this owns everything the rider sees of it.
   Same split as RC.group / RC.groupui, and for the same reason: the transport
   should not know what a list item looks like, and the list should not know
   what a broker is.

   What it draws
   -------------
   * A layer of hollow dots — strangers. Deliberately NOT the same marker as a
     rider in your ride: a mate in a group ride is a solid dot in their own
     colour and a name you chose to see, and a stranger on the public road must
     never be mistakable for one at a glance on a moving map. Hollow ring, one
     colour derived from their id, and a name only when the map is zoomed in
     far enough for names to mean anything.
   * The Pubs pane: the area, who is out there, the rooms, and the room you
     are in.
   * One badge on the rail, which is how a rider knows PUBs is on without
     opening anything. It is the only always-visible reminder, so it is the
     one piece of this that is never hidden.
   ============================================================ */
var RC = RC || {};

RC.pubsui = (function () {
  "use strict";

  var LABEL_ZOOM = 13;       // below this, dots only
  var LIST_MAX = 30;

  var bridge = null;
  var map = null;
  var layer = null;
  var PANE = "rcPubs";

  function el(id) { return RC.el(id); }
  function on(id, ev, fn) { var n = el(id); if (n) n.addEventListener(ev, fn); }
  function show(id, yes) { var n = el(id); if (n) n.hidden = !yes; }
  function text(id, s) { var n = el(id); if (n) n.textContent = s; }
  function units() { return bridge.units(); }

  /* ---------------------------------------------------------
     Strangers on the map
     --------------------------------------------------------- */
  function drawWorld() {
    if (!map) return;
    if (!layer) layer = L.layerGroup().addTo(map);
    layer.clearLayers();
    if (!RC.pubs.isOn()) return;

    var withNames = map.getZoom() >= LABEL_ZOOM;
    var list = RC.pubs.world();
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var speed = p.fix.speedKmh;
      var label = withNames
        ? '<span class="rc-pub-name">' + RC.escapeHtml(p.name) +
          (speed > 3 ? " <b>" + Math.round(speed) + "</b>" : "") + "</span>"
        : "";
      var arrow = p.fix.courseDeg == null ? ""
        : '<span class="rc-pub-arrow" style="transform: rotate(' + Math.round(p.fix.courseDeg) + 'deg)"></span>';
      L.marker([p.fix.lat, p.fix.lon], {
        icon: L.divIcon({
          className: "",
          html: '<span class="rc-pub" style="--pub: ' + p.color + '">' +
                arrow + '<span class="rc-pub-dot"></span>' + label + "</span>",
          iconSize: [16, 16], iconAnchor: [8, 8]
        }),
        zIndexOffset: 200 + i,
        keyboard: false,
        title: p.name
      }).addTo(layer);
    }
  }

  /* ---------------------------------------------------------
     The rail badge — the always-on reminder
     --------------------------------------------------------- */
  function renderBadge() {
    var btn = el("pubs-btn");
    var badge = el("pubs-count");
    if (!btn) return;
    var live = RC.pubs.isOn();
    btn.setAttribute("data-on", live ? "true" : "false");
    btn.title = live
      ? "PUBs is on — you are visible to the area"
      : "PUBs — the public road";
    if (!badge) return;
    var n = RC.pubs.world().length;
    badge.hidden = !live;
    badge.textContent = live ? String(n) : "";
  }

  /* ---------------------------------------------------------
     The pane
     --------------------------------------------------------- */
  function renderArea() {
    var live = RC.pubs.isOn();
    show("pubs-off", !live);
    show("pubs-on", live);
    show("pubs-rooms-block", live || RC.pubs.inRoom());
    if (!live) return;

    var snap = RC.pubs.snapshot();
    text("pubs-area-code", snap.code || "------");

    var state = snap.role === "host"
      ? { key: "host", text: "Holding this area" }
      : snap.role === "guest"
        ? (snap.fresh ? { key: "live", text: "Connected" } : { key: "lost", text: "Reconnecting…" })
        : { key: "connecting", text: "Finding the area…" };
    var pill = el("pubs-state");
    if (pill) pill.setAttribute("data-state", state.key);
    text("pubs-state-text", state.text);

    // One line. The paragraph that used to live here is the "pubs-area" topic,
    // one tap away behind the (i) on the Area label.
    text("pubs-area-note", snap.role === "host"
      ? "Your phone is holding this area for everyone in it."
      : "You are visible to this area.");

    renderPeople();
    renderRooms();
  }

  function renderPeople() {
    var box = el("pubs-people");
    if (!box) return;
    var list = RC.pubs.world();
    text("pubs-people-count", list.length ? String(list.length) : "");

    if (!list.length) {
      box.innerHTML = '<p class="rc-chat-sys">Nobody else out here right now.</p>';
      return;
    }

    var me = myFix();
    var rows = list.slice(0, LIST_MAX).map(function (p) {
      var away = me ? RC.haversine(me, p.fix) : null;
      var sub = [];
      if (away != null) sub.push(RC.fmtDist(away, units()) + " away");
      if (p.fix.speedKmh != null && p.fix.speedKmh > 3) sub.push(RC.fmtSpeed(p.fix.speedKmh, units()));
      if (p.room) sub.push("in " + p.room);
      return { p: p, away: away == null ? Infinity : away, sub: sub.join(" · ") };
    });
    // Nearest first: on a public map the only ordering anybody wants is "who
    // is about to be in my mirror".
    rows.sort(function (a, b) { return a.away - b.away; });

    var html = "";
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i].p;
      html += '<div class="rc-mate-row" data-pub-id="' + RC.escapeHtml(p.id) + '">' +
        '<span class="rc-mate-swatch" style="background:' + p.color + '"></span>' +
        '<span class="rc-mate-meta">' +
          '<span class="rc-mate-rowname">' + RC.escapeHtml(p.name) + "</span>" +
          '<span class="rc-mate-sub">' + RC.escapeHtml(rows[i].sub || "somewhere nearby") + "</span>" +
        "</span>" +
        '<button type="button" class="rc-act rc-act-danger rc-act-sm" data-pub-block="' +
          RC.escapeHtml(p.id) + '">Ignore</button>' +
        "</div>";
    }
    box.innerHTML = html;
  }

  function myFix() {
    var f = bridge.myFix && bridge.myFix();
    return f && typeof f.lat === "number" ? f : null;
  }

  function renderRooms() {
    var box = el("pubs-rooms");
    if (!box) return;
    var rooms = RC.pubs.rooms();
    var here = RC.pubs.roomCode();
    text("pubs-rooms-count", rooms.length ? String(rooms.length) : "");

    if (!rooms.length) {
      box.innerHTML = '<p class="rc-chat-sys">No PUB open around here.</p>';
      return;
    }
    var html = "";
    for (var i = 0; i < rooms.length; i++) {
      var r = rooms[i];
      var mine = r.code === here;
      html += '<div class="rc-saved-row">' +
        '<span class="rc-saved-load rc-saved-static">' +
          '<span class="rc-saved-name">' + RC.escapeHtml(r.name) + "</span>" +
          '<span class="rc-saved-meta">' + RC.escapeHtml(r.code) + " · " +
            r.people + (r.people === 1 ? " person" : " people") + " · by " +
            RC.escapeHtml(r.by) + "</span>" +
        "</span>" +
        (mine
          ? '<span class="rc-mate-tag">you are in</span>'
          : '<button type="button" class="rc-act rc-act-sm" data-pub-enter="' +
            RC.escapeHtml(r.code) + '">Walk in</button>') +
        "</div>";
    }
    box.innerHTML = html;
  }

  function renderRoom() {
    var snap = RC.pubs.roomSnapshot();
    show("pubs-room-block", !!snap["in"]);
    if (!snap["in"]) { renderRooms(); return; }

    text("pubs-room-title", snap.name);
    var pill = el("pubs-room-state");
    var state = snap.role === "host"
      ? { key: "host", text: "You are holding it" }
      : snap.link === "connected" ? { key: "live", text: "In" }
      : snap.link === "retrying" ? { key: "lost", text: "Reconnecting…" }
      : { key: "connecting", text: "Walking in…" };
    if (pill) pill.setAttribute("data-state", state.key);
    text("pubs-room-state-text", state.text);
    text("pubs-room-note", snap.code + " · " + snap.people +
      (snap.people === 1 ? " person" : " people") +
      (snap.role === "host" ? " · yours" : ""));

    var log = el("pubs-chat-log");
    if (log) {
      var lines = RC.pubs.roomLog();
      var html = "";
      for (var i = 0; i < lines.length; i++) {
        var m = lines[i];
        if (m.kind === "system") {
          html += '<p class="rc-chat-sys">' + RC.escapeHtml(m.text) + "</p>";
        } else {
          html += '<p class="rc-chat-line' + (m.mine ? " is-mine" : "") + '">' +
            '<span class="rc-chat-who">' + RC.escapeHtml(m.name) + "</span>" +
            '<span class="rc-chat-text">' + RC.escapeHtml(m.text) + "</span>" +
            '<span class="rc-chat-at">' + RC.fmtTime(new Date(m.at)) + "</span>" +
            "</p>";
        }
      }
      log.innerHTML = html || '<p class="rc-chat-sys">Nothing said yet.</p>';
      log.scrollTop = log.scrollHeight;
    }
    renderRooms();
  }

  /* The ignore list only exists on the screen once there is something in it.
     An empty list explaining itself is a paragraph nobody asked for; the (i)
     beside it says what Ignore does for anyone who wants to know. */
  function renderBlocked() {
    var n = RC.pubs.blockedCount();
    show("pubs-blocked-block", n > 0);
    if (!n) return;
    text("pubs-blocked-note", "Ignoring " + n + (n === 1 ? " rider." : " riders."));
  }

  function renderAll() {
    renderBadge();
    renderArea();
    renderRoom();
    renderBlocked();
    drawWorld();
  }

  /* ---------------------------------------------------------
     Wiring
     --------------------------------------------------------- */
  function startPubs() {
    var input = el("pubs-name");
    var name = input ? input.value : "";
    bridge.setStatus("Finding the area…", "busy");
    RC.pubs.start(name).then(function () {
      bridge.setStatus("PUBs is on — you are visible.", "");
      bridge.flashStatus(4000);
      renderAll();
    }, function (err) {
      bridge.setStatus(err && err.message ? err.message : "Could not go public.", "error");
    });
  }

  function stopPubs() {
    RC.pubs.stop();
    bridge.setStatus("PUBs is off.", "");
    bridge.flashStatus(3000);
    renderAll();
  }

  function enterRoom(code) {
    RC.pubs.enterRoom(code, nameForRoom()).then(function () {
      renderAll();
      var log = el("pubs-chat-log");
      if (log && log.scrollIntoView) { try { log.scrollIntoView({ block: "center" }); } catch (e) {} }
    }, function (err) {
      bridge.setStatus(err && err.message ? err.message : "Could not walk in.", "error");
    });
  }

  /* A room needs a name too, and it is the same name — but a rider who has
     not gone public has never typed one, so the Pubs field is read first and
     the ride's name is the fallback. */
  function nameForRoom() {
    var input = el("pubs-name");
    var typed = input && input.value ? input.value : "";
    return typed || RC.pubs.myName() || (RC.group && RC.group.myName && RC.group.myName()) || "";
  }

  function openRoom() {
    var input = el("pubs-room-name");
    RC.pubs.openRoom(input ? input.value : "", nameForRoom()).then(function (code) {
      if (input) input.value = "";
      bridge.setStatus("PUB open — " + code, "");
      bridge.flashStatus(5000);
      renderAll();
    }, function (err) {
      bridge.setStatus(err && err.message ? err.message : "Could not open a PUB.", "error");
    });
  }

  function sendChat() {
    var input = el("pubs-chat-input");
    if (!input || !input.value.trim()) return;
    if (!RC.pubs.say(input.value)) {
      // The only reason a line is refused is the flood gate, and silently
      // eating somebody's sentence is how a chat box gets called broken.
      bridge.setStatus("Give it a second between lines.", "");
      bridge.flashStatus(2500);
      return;
    }
    input.value = "";
    renderRoom();
  }

  function init(b) {
    bridge = b;
    map = b.map;
    try {
      map.createPane(PANE);
      map.getPane(PANE).style.zIndex = 395;
    } catch (e) {}

    var saved = RC.pubs.myName();
    var nameInput = el("pubs-name");
    if (nameInput && saved) nameInput.value = saved;

    on("pubs-start", "click", startPubs);
    on("pubs-stop", "click", stopPubs);
    on("pubs-room-open", "click", openRoom);
    on("pubs-room-leave", "click", function () { RC.pubs.leaveRoom(); renderAll(); });
    on("pubs-room-enter", "click", function () {
      var input = el("pubs-room-code");
      if (input && input.value.trim()) { enterRoom(input.value); input.value = ""; }
    });
    on("pubs-room-code", "keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (this.value.trim()) { enterRoom(this.value); this.value = ""; }
    });
    on("pubs-chat-send", "click", sendChat);
    on("pubs-chat-input", "keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); sendChat(); }
    });
    on("pubs-room-copy", "click", function () {
      var code = RC.pubs.roomCode();
      if (!code || !navigator.clipboard) return;
      navigator.clipboard.writeText(code).then(function () {
        bridge.setStatus("PUB code copied.", "");
        bridge.flashStatus(2500);
      }, function () {});
    });
    on("pubs-unblock", "click", function () { RC.pubs.unblockAll(); renderAll(); });

    // Delegated, because both lists are rebuilt from scratch on every change.
    var peopleBox = el("pubs-people");
    if (peopleBox) peopleBox.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-pub-block]") : null;
      if (!btn) return;
      RC.pubs.block(btn.getAttribute("data-pub-block"));
      renderAll();
    });
    var roomsBox = el("pubs-rooms");
    if (roomsBox) roomsBox.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-pub-enter]") : null;
      if (!btn) return;
      enterRoom(btn.getAttribute("data-pub-enter"));
    });

    on("pubs-btn", "click", function () { bridge.openPubs(); });

    RC.pubs.onChange = renderAll;
    RC.pubs.onRoom = function () { renderRoom(); renderBadge(); };
    RC.pubs.onNotice = function (n) {
      bridge.setStatus(n.text, n.kind === "warn" ? "error" : "");
      bridge.flashStatus(4500);
    };

    map.on("zoomend", drawWorld);

    // A ?pub= link walks somebody straight to the door of a room, and no
    // further: entering is still a tap, for the same reason a ?ride= link
    // never joins on its own.
    try {
      var code = new URLSearchParams(location.search).get("pub");
      if (code && RC.pubs.isRoomCode(code)) {
        var field = el("pubs-room-code");
        if (field) field.value = RC.net.normalizeCode(code);
        bridge.openPubs();
      }
    } catch (e) {}

    renderAll();
  }

  return {
    init: init,
    render: renderAll,
    drawWorld: drawWorld
  };
})();

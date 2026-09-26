/* ============================================================
   RouteCast — PUBs, on the screen

   RC.pubs owns the public road; this owns everything the rider sees of it.
   Same split as RC.group / RC.groupui, and for the same reason: the transport
   should not know what a list item looks like, and the list should not know
   what a broker is.

   The public road is meant to be LIVED ON, not administered. So most of it is
   on the map rather than in the planner:

   * People — a round badge per stranger with the glyph they chose (a
     motorbike, a car, a bicycle…) or their initial, a ring in their colour
     and a wedge for where they are heading. Deliberately NOT a ride-mate's
     marker: a mate is a solid dot you chose to see, and a stranger must never
     be mistaken for one at a glance on a moving map. Tap one for a card: beep
     them, walk into their PUB, or make them disappear.
   * Bubbles — what somebody says to the area floats over their head for a
     few seconds and then goes, the way a shout does.
   * Pins — what is on the road: traffic, a crash, a hazard, a flood, a closed
     road, a checkpoint. Tap one to say it is still there or gone; ride up to
     one and you are asked. Riding towards one, you are told — once, spoken,
     at a distance there is still time to do something about it.
   * One round button by the map controls that opens the six report buttons
     and a line of chat without opening anything else. Big targets, one tap,
     because it is used at a red light with gloves on.

   The Pubs pane is for everything that needs reading: the area, the talk so
   far, the pins as a list, the people as a list, the rooms. Four sub-tabs,
   and each one carries the switches for how its own part is drawn on the map.

   Markers are kept, not rebuilt: every fix used to throw the whole layer away
   and draw it again, which cost a DOM rebuild a second and would restart any
   animation on it. Now a marker moves when its rider moves and is redrawn
   only when what it shows has changed.
   ============================================================ */
var RC = RC || {};

RC.pubsui = (function () {
  "use strict";

  var LABEL_ZOOM = 13;          // "zoomed in", for names
  var LIST_MAX = 30;
  var BUBBLE_MS = 8000;         // how long a shout hangs over somebody's head
  var BEEP_SHOW_MS = 2600;      // how long a beeping marker honks
  var ALERT_AHEAD_M = 1200;     // tell a rider about a pin this far up the road
  var ALERT_NEAR_M = 400;       // ...or this close in any direction, when slow
  var ALERT_CONE_DEG = 40;      // "ahead" is within this much of your heading
  var PASS_ASK_M = 120;         // this close to a pin: is it still there?
  var PASS_ASK_MS = 12000;      // and the question goes away on its own

  var AVATAR_ICON = { moto: "motorcycle", car: "car", bike: "bike", scooter: "scooter", truck: "truck", walk: "walk" };
  var AVATAR_LABEL = { moto: "Motorbike", car: "Car", bike: "Bicycle", scooter: "Scooter", truck: "Truck", walk: "On foot" };

  /* The six things worth telling the road about, with the words for the
     button and the words for the voice. */
  var REPORTS = [
    { kind: "traffic", label: "Traffic", said: "Traffic" },
    { kind: "crash", label: "Crash", said: "A crash" },
    { kind: "hazard", label: "Hazard", said: "A hazard" },
    { kind: "flood", label: "Flood", said: "Flooding" },
    { kind: "closed", label: "Closed", said: "A closed road" },
    { kind: "checkpoint", label: "Checkpoint", said: "A checkpoint" }
  ];
  var REPORT = {};
  for (var ri = 0; ri < REPORTS.length; ri++) REPORT[REPORTS[ri].kind] = REPORTS[ri];

  /* One-tap lines for the area. Short enough to be a bubble, useful enough
     to be worth a tap. */
  var SAYS = ["Hi all", "Road's clear", "Heavy rain here", "Slow traffic ahead", "Anyone riding north?", "Thanks!"];

  var VIEW_DEFAULTS = { names: "zoom", bubbles: true, pins: true, alerts: true };

  var bridge = null;
  var map = null;
  var view = null;
  var subs = null;

  var PANE = "rcPubs";          // strangers
  var PANE_REPORTS = "rcReports";
  var PANE_BUBBLES = "rcBubbles";

  var peopleLayer = null, reportLayer = null, bubbleLayer = null;
  var peopleCache = {}, reportCache = {}, bubbleCache = {};

  var bubbles = {};             // person id -> { text, until, color, mine }
  var bubbleTimer = null;
  var beeping = {};             // person id -> until
  var alerted = {};             // report id -> true, once per pin
  var asked = {};               // report id -> true, once per pin
  var unreadShouts = 0;
  var audio = null;
  var askingId = null;          // the pin whose card is asking "still there?"

  function el(id) { return RC.el(id); }
  function on(id, ev, fn) { var n = el(id); if (n) n.addEventListener(ev, fn); }
  function show(id, yes) { var n = el(id); if (n) n.hidden = !yes; }
  function text(id, s) { var n = el(id); if (n) n.textContent = s; }
  function units() { return bridge.units(); }
  function esc(s) { return RC.escapeHtml(s); }

  function loadView() {
    var saved = RC.store.get("pubsView", null) || {};
    var v = {};
    for (var k in VIEW_DEFAULTS) {
      if (VIEW_DEFAULTS.hasOwnProperty(k)) v[k] = saved.hasOwnProperty(k) ? saved[k] : VIEW_DEFAULTS[k];
    }
    if (["always", "zoom", "never"].indexOf(v.names) < 0) v.names = "zoom";
    return v;
  }

  function setView(key, value) {
    view[key] = value;
    RC.store.set("pubsView", view);
    renderViewControls();
    drawWorld();
  }

  function myFix() {
    var f = RC.pubs.myFix() || (bridge.myFix && bridge.myFix());
    return f && typeof f.lat === "number" ? f : null;
  }

  function riding() {
    var m = bridge.mode ? bridge.mode() : "plan";
    return m === "nav" || m === "free";
  }

  function defaultAvatar() {
    return bridge.vehicle && bridge.vehicle() === "motorcycle" ? "moto" : "car";
  }

  function initial(name) {
    var c = String(name || "?").trim().charAt(0);
    return c ? c.toUpperCase() : "?";
  }

  function speedText(kmh) {
    return String(Math.round(units() === "imperial" ? kmh / 1.609344 : kmh));
  }

  function ago(t) {
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return "just now";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    return Math.floor(m / 60) + " h " + (m % 60) + " min ago";
  }

  function faceHtml(p) {
    return p.av && AVATAR_ICON[p.av]
      ? RC.icons.ui(AVATAR_ICON[p.av])
      : '<b class="rc-pub-initial">' + esc(initial(p.name)) + "</b>";
  }

  /* ---------------------------------------------------------
     Markers that are kept, not rebuilt
     --------------------------------------------------------- */
  function sync(cache, group, items) {
    var seen = {};
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      seen[it.key] = true;
      var c = cache[it.key];
      if (!c) {
        var m = L.marker(it.at, {
          pane: it.pane,
          icon: L.divIcon({ className: "", html: it.html, iconSize: it.size, iconAnchor: it.anchor }),
          interactive: !!it.click,
          keyboard: false,
          title: it.title || "",
          zIndexOffset: it.z || 0
        }).addTo(group);
        if (it.click) m.on("click", it.click);
        cache[it.key] = { m: m, html: it.html };
      } else {
        c.m.setLatLng(it.at);
        if (c.html !== it.html) {
          c.m.setIcon(L.divIcon({ className: "", html: it.html, iconSize: it.size, iconAnchor: it.anchor }));
          c.html = it.html;
        }
      }
    }
    for (var k in cache) {
      if (cache.hasOwnProperty(k) && !seen[k]) { group.removeLayer(cache[k].m); delete cache[k]; }
    }
  }

  /* ---------------------------------------------------------
     Strangers on the map
     --------------------------------------------------------- */
  function drawPeople() {
    var items = [];
    if (RC.pubs.isOn()) {
      var names = view.names === "always" || (view.names === "zoom" && map.getZoom() >= LABEL_ZOOM);
      var list = RC.pubs.world();
      var t = Date.now();
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var speed = p.fix.speedKmh;
        var label = names
          ? '<span class="rc-pub-name">' + esc(p.name) +
            (speed > 3 ? " <b>" + speedText(speed) + "</b>" : "") + "</span>"
          : "";
        var arrow = p.fix.courseDeg == null ? ""
          : '<span class="rc-pub-arrow" style="transform: rotate(' + Math.round(p.fix.courseDeg) + 'deg)"></span>';
        var cls = "rc-pub" +
          (beeping[p.id] > t ? " is-beeping" : "") +
          (RC.who.isOpen("pub:" + p.id) ? " is-picked" : "") +
          (p.room ? " is-in-room" : "");
        items.push({
          key: p.id, at: [p.fix.lat, p.fix.lon], pane: PANE,
          html: '<span class="' + cls + '" style="--pub: ' + p.color + '">' + arrow +
                '<span class="rc-pub-face">' + faceHtml(p) + "</span>" + label + "</span>",
          size: [30, 30], anchor: [15, 15], title: p.name, z: i,
          click: personClick(p.id)
        });
      }
    }
    sync(peopleCache, peopleLayer, items);
  }

  /* ---------------------------------------------------------
     Bubbles: what the area just said, over the head that said it
     --------------------------------------------------------- */
  function drawBubbles() {
    clearTimeout(bubbleTimer);
    var items = [];
    var t = Date.now();
    var soonest = Infinity;
    if (RC.pubs.isOn() && view.bubbles) {
      var where = {};
      var list = RC.pubs.world();
      for (var i = 0; i < list.length; i++) where[list[i].id] = list[i].fix;
      var me = myFix();
      var myId = RC.pubs.myId();
      if (me && myId) where[myId] = me;
      for (var id in bubbles) {
        if (!bubbles.hasOwnProperty(id)) continue;
        var b = bubbles[id];
        if (t > b.until) { delete bubbles[id]; continue; }
        soonest = Math.min(soonest, b.until);
        var at = where[id];
        if (!at) continue;
        items.push({
          key: id + ":" + b.n, at: [at.lat, at.lon], pane: PANE_BUBBLES,
          html: '<span class="rc-bubble' + (b.mine ? " is-mine" : "") + '" style="--pub: ' + b.color + '">' +
                "<span>" + esc(b.text) + "</span></span>",
          size: [0, 0], anchor: [0, 0]
        });
      }
    } else {
      bubbles = {};
    }
    sync(bubbleCache, bubbleLayer, items);
    unstackBubbles();
    // One timer, for whichever bubble is due to go next.
    if (soonest < Infinity) bubbleTimer = setTimeout(drawBubbles, Math.max(200, soonest - t + 30));
  }

  /* Riders stopped together say things on top of each other. A bubble that
     would land on one already placed is lifted clear of it — by moving the
     element that is already there, so its fade is not restarted. Lowest on
     the screen first: it keeps its place, and the ones above make room. */
  var BUBBLE_GAP = 21;
  function unstackBubbles() {
    var list = [];
    for (var k in bubbleCache) {
      if (!bubbleCache.hasOwnProperty(k)) continue;
      var m = bubbleCache[k].m;
      var node = m.getElement ? m.getElement() : null;
      var inner = node ? node.querySelector(".rc-bubble > span") : null;
      if (!inner) continue;
      var pt = map.latLngToContainerPoint(m.getLatLng());
      list.push({ inner: inner, x: pt.x, y: pt.y, w: inner.offsetWidth, h: inner.offsetHeight });
    }
    list.sort(function (a, b) { return b.y - a.y; });
    var placed = [];
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      var lift = 0;
      for (var pass = 0; pass < 8; pass++) {
        var bottom = b.y - BUBBLE_GAP - lift, top = bottom - b.h;
        var left = b.x - b.w / 2, right = b.x + b.w / 2;
        var hit = null;
        for (var j = 0; j < placed.length; j++) {
          var p = placed[j];
          if (left < p.right + 4 && right > p.left - 4 && top < p.bottom + 4 && bottom > p.top - 4) { hit = p; break; }
        }
        if (!hit) break;
        lift += bottom - (hit.top - 6);
      }
      b.inner.style.bottom = (BUBBLE_GAP + lift) + "px";
      placed.push({
        left: b.x - b.w / 2, right: b.x + b.w / 2,
        top: b.y - BUBBLE_GAP - lift - b.h, bottom: b.y - BUBBLE_GAP - lift
      });
    }
  }

  var bubbleSeq = 0;
  function addBubble(line) {
    bubbles[line.from] = {
      text: line.text, until: Date.now() + BUBBLE_MS, color: line.color, mine: line.mine, n: ++bubbleSeq
    };
    drawBubbles();
  }

  /* ---------------------------------------------------------
     Pins: what is on the road
     --------------------------------------------------------- */
  function drawReports() {
    var items = [];
    if (RC.pubs.isOn() && view.pins) {
      var list = RC.pubs.reports();
      for (var i = 0; i < list.length; i++) {
        var r = list[i];
        var meta = REPORT[r.kind];
        items.push({
          key: r.id, at: [r.lat, r.lon], pane: PANE_REPORTS,
          html: '<span class="rc-rep" data-kind="' + r.kind + '"' +
                (RC.who.isOpen("rep:" + r.id) ? ' data-picked="yes"' : "") + ">" +
                '<span class="rc-rep-pin">' + RC.icons.ui(r.kind) + "</span>" +
                (r.ups > 1 ? '<b class="rc-rep-n">' + r.ups + "</b>" : "") + "</span>",
          size: [34, 40], anchor: [17, 38],
          title: meta ? meta.label : r.kind, z: i,
          click: reportClick(r.id)
        });
      }
    }
    sync(reportCache, reportLayer, items);
  }

  // Leaflet hands a click handler the event as its first argument; these
  // make sure it never arrives where an option is expected.
  function personClick(id) { return function () { openPerson(id); }; }
  function reportClick(id) { return function () { openReport(id, false); }; }

  function drawWorld() {
    if (!map) return;
    drawReports();
    drawPeople();
    drawBubbles();
  }

  /* ---------------------------------------------------------
     A stranger, tapped
     --------------------------------------------------------- */
  function personById(id) {
    var list = RC.pubs.world();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function roomName(code) {
    var rooms = RC.pubs.rooms();
    for (var i = 0; i < rooms.length; i++) if (rooms[i].code === code) return rooms[i].name;
    return code;
  }

  function personSpec(p) {
    var me = myFix();
    var sub = [];
    if (me) sub.push(RC.fmtDist(RC.haversine(me, p.fix), units()) + " away");
    sub.push(p.fix.speedKmh != null && p.fix.speedKmh > 3 ? RC.fmtSpeed(p.fix.speedKmh, units()) : "stopped");
    if (p.room) sub.push("in " + roomName(p.room));
    var acts = [{
      label: "Beep", icon: "horn", kind: "primary", keep: true,
      run: function () { beepAt(p.id, p.name); }
    }];
    if (p.room && p.room !== RC.pubs.roomCode()) {
      acts.push({ label: "Their PUB", icon: "door", run: function () { enterRoom(p.room, true); } });
    }
    acts.push({
      label: "Ignore", icon: "eye-off", kind: "danger",
      run: function () {
        RC.pubs.block(p.id);
        bridge.toast("You will not see or hear " + p.name + " again.", "ok");
        renderAll();
      }
    });
    return {
      key: "pub:" + p.id, kind: "pub", color: p.color,
      face: '<span class="rc-who-pub">' + faceHtml(p) + "</span>",
      name: p.name, sub: sub.join(" · "), actions: acts,
      onClose: function () { drawPeople(); }
    };
  }

  function openPerson(id, opts) {
    var p = personById(id);
    if (!p) return;
    var spec = personSpec(p);
    if (opts && opts.ttl) spec.ttl = opts.ttl;
    RC.who.open(spec);
    drawPeople();
  }

  function beepAt(id, name) {
    primeAudio();
    if (RC.pubs.beep(id)) {
      bridge.toast("Beeped " + name + ".", "pubs");
    } else {
      bridge.toast("You beeped " + name + " a moment ago.", "");
    }
  }

  /* ---------------------------------------------------------
     A pin, tapped — or ridden up to
     --------------------------------------------------------- */
  function reportById(id) {
    var list = RC.pubs.reports();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function reportSpec(r, asking) {
    var meta = REPORT[r.kind] || { label: r.kind };
    var me = myFix();
    var sub = [ago(r.at)];
    if (me) sub.push(RC.fmtDist(RC.haversine(me, r), units()) + " away");
    sub.push(r.mine ? "yours" : "by " + r.by);
    if (r.ups > 1) sub.push("seen by " + r.ups);
    var vote = RC.pubs.myVote(r.id);
    var acts = [];
    if (r.mine) {
      acts.push({ label: "Take it down", icon: "close", kind: "danger", run: function () { voteOn(r, false); } });
    } else if (vote) {
      sub.push(vote === "up" ? "you said still there" : "you said gone");
    } else {
      acts.push({ label: "Still there", icon: "check", kind: "primary", run: function () { voteOn(r, true); } });
      acts.push({ label: "Not there", icon: "close", run: function () { voteOn(r, false); } });
    }
    return {
      key: "rep:" + r.id, kind: "rep",
      face: '<span class="rc-rep-face" data-kind="' + r.kind + '">' + RC.icons.ui(r.kind) + "</span>",
      name: asking ? meta.label + " here — still there?" : meta.label,
      sub: sub.join(" · "), actions: acts,
      onClose: function () { if (askingId === r.id) askingId = null; drawReports(); }
    };
  }

  function openReport(id, asking) {
    var r = reportById(id);
    if (!r) return;
    var spec = reportSpec(r, asking);
    if (asking) spec.ttl = PASS_ASK_MS;
    askingId = asking ? r.id : null;
    RC.who.open(spec);
    drawReports();
  }

  function voteOn(r, up) {
    if (RC.pubs.vote(r.id, up)) {
      bridge.toast(up ? "Thanks — kept on the map." : r.mine ? "Taken down." : "Thanks — noted as gone.", "ok");
    }
    renderAll();
  }

  /** Something on the road, where you are now. */
  function doReport(kind) {
    var meta = REPORT[kind];
    if (!meta) return;
    if (!RC.pubs.myFix()) {
      bridge.toast("Waiting for your position first.", "");
      return;
    }
    if (RC.pubs.report(kind)) {
      bridge.toast(meta.label + " reported here — thank you.", "ok");
      closeSheet();
      if (subs && panelShowsPubs()) subs.select("road");
    } else {
      bridge.toast("Give it a moment between reports.", "");
    }
  }

  /* ---------------------------------------------------------
     Riding towards a pin

     Told once per pin, at a distance there is still time to act on: up the
     road inside a cone around your heading, or close by in any direction if
     you are going too slowly for a heading to mean anything. Ride right up to
     one and the card asks whether it is still there — two buttons, and it
     goes away by itself, because a question nobody answered should not be
     left covering the road.
     --------------------------------------------------------- */
  function angleGap(a, b) {
    var d = ((a - b) % 360 + 540) % 360 - 180;
    return Math.abs(d);
  }

  function checkAhead() {
    if (!RC.pubs.isOn() || !riding()) return;
    var me = RC.pubs.myFix();
    if (!me) return;
    var list = RC.pubs.reports();
    var moving = me.speedKmh != null && me.speedKmh >= 8 && me.courseDeg != null;
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (r.mine) continue;
      var d = RC.haversine(me, r);
      if (view.alerts && !alerted[r.id] && d > PASS_ASK_M) {
        var ahead = moving
          ? d < ALERT_AHEAD_M && angleGap(RC.bearing(me, r), me.courseDeg) < ALERT_CONE_DEG
          : d < ALERT_NEAR_M;
        if (ahead) { alerted[r.id] = true; announce(r, d); }
      }
      if (!asked[r.id] && d <= PASS_ASK_M && !RC.pubs.myVote(r.id)) {
        asked[r.id] = true;
        alerted[r.id] = true;
        if (!RC.who.isOpen()) openReport(r.id, true);
      }
    }
  }

  function announce(r, d) {
    var meta = REPORT[r.kind];
    if (!meta) return;
    bridge.toast(meta.label + " reported ahead — " + RC.fmtDist(d, units()), "alert");
    if (RC.guide) {
      RC.guide.say(meta.said + " reported ahead, " + RC.guide.spokenDistance(d, units()) + ".");
      RC.guide.buzz([80, 60, 80]);
    }
  }

  /* ---------------------------------------------------------
     A horn, for a beep

     Two short tones from the page itself — no audio file to cache, nothing to
     fetch. Browsers only let a page make a sound after a tap, so the context
     is woken on the taps that lead here (Go public, the map button, Beep).
     Follows the spoken-guidance switch: a rider who has silenced the voice
     has silenced the horn too.
     --------------------------------------------------------- */
  function primeAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === "suspended") audio.resume();
    } catch (e) {}
  }

  function horn() {
    if (!audio || (RC.guide && !RC.guide.settings().voice)) return;
    try {
      var t0 = audio.currentTime + 0.02;
      [0, 0.17].forEach(function (off) {
        var o = audio.createOscillator();
        var g = audio.createGain();
        o.type = "square";
        o.frequency.value = off ? 587 : 494;
        g.gain.setValueAtTime(0.0001, t0 + off);
        g.gain.exponentialRampToValueAtTime(0.07, t0 + off + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + 0.13);
        o.connect(g);
        g.connect(audio.destination);
        o.start(t0 + off);
        o.stop(t0 + off + 0.14);
      });
    } catch (e) {}
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
    show("pubs-fab", live);
    if (!live && el("pubs-sheet") && !el("pubs-sheet").hidden) closeSheet();
    if (!badge) return;
    var n = RC.pubs.world().length;
    badge.hidden = !live;
    badge.textContent = live ? String(unreadShouts || n) : "";
    badge.setAttribute("data-kind", unreadShouts ? "chat" : "count");
  }

  /* ---------------------------------------------------------
     The pane
     --------------------------------------------------------- */
  function panelShowsPubs() {
    var pane = el("pane-pubs");
    return !!(pane && !pane.hidden && bridge.isPanelOpen && bridge.isPanelOpen());
  }

  function panelShowsChat() {
    return panelShowsPubs() && !!subs && subs.current() === "chat";
  }

  function renderSubBadges() {
    var live = RC.pubs.isOn();
    function badge(id, n, alert) {
      var b = el(id);
      if (!b) return;
      b.textContent = n ? String(n) : "";
      b.hidden = !live || !n;
      if (alert) b.classList.add("is-alert");
    }
    badge("pubs-sub-chat-n", unreadShouts, true);
    badge("pubs-sub-road-n", RC.pubs.reports().length);
    badge("pubs-sub-people-n", RC.pubs.world().length);
    badge("pubs-sub-rooms-n", RC.pubs.rooms().length);
  }

  /* The room you are in has one chat box, and it has to be somewhere you can
     see it whether or not you are visible — so it is moved rather than
     drawn twice: into the PUBs sub-tab while PUBs is on, back under the
     "Just the chat" field when it is off. */
  function placeRoomBlock() {
    var block = el("pubs-room-block");
    if (!block) return;
    if (RC.pubs.isOn()) {
      var host = document.querySelector('[data-sub-pane="pubs:rooms"]');
      if (host && block.parentNode !== host) host.insertBefore(block, host.firstChild);
    } else {
      var pane = el("pane-pubs");
      var before = el("pubs-blocked-block");
      if (pane && block.parentNode !== pane) pane.insertBefore(block, before);
    }
  }

  function renderArea() {
    var live = RC.pubs.isOn();
    show("pubs-off", !live);
    show("pubs-on", live);
    placeRoomBlock();
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
    var n = snap.people;
    text("pubs-area-note", (snap.role === "host"
      ? "Your phone is holding this area. "
      : "You are visible to this area. ") +
      (n ? n + (n === 1 ? " other rider." : " other riders.") : "Nobody else yet."));

    renderShouts();
    renderRoad();
    renderPeople();
    renderRooms();
  }

  function renderShouts() {
    var log = el("pubs-shout-log");
    if (!log) return;
    var lines = RC.pubs.shouts();
    var html = "";
    for (var i = Math.max(0, lines.length - 40); i < lines.length; i++) {
      var m = lines[i];
      html += '<p class="rc-chat-line' + (m.mine ? " is-mine" : "") + '">' +
        '<span class="rc-chat-who" style="color:' + (m.mine ? "" : m.color) + '">' + esc(m.name) + "</span>" +
        '<span class="rc-chat-text">' + esc(m.text) + "</span>" +
        '<span class="rc-chat-at">' + RC.fmtTime(new Date(m.at)) + "</span>" +
        "</p>";
    }
    log.innerHTML = html || '<p class="rc-chat-sys">Quiet out here. Say hello.</p>';
    log.scrollTop = log.scrollHeight;
  }

  function renderRoad() {
    var box = el("pubs-reports");
    if (!box) return;
    var list = RC.pubs.reports();
    if (!list.length) {
      box.innerHTML = '<p class="rc-chat-sys">Nothing reported around here.</p>';
      return;
    }
    var me = myFix();
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var meta = REPORT[r.kind] || { label: r.kind };
      var sub = [ago(r.at)];
      if (me) sub.push(RC.fmtDist(RC.haversine(me, r), units()));
      sub.push(r.mine ? "yours" : "by " + r.by);
      if (r.ups > 1) sub.push("seen by " + r.ups);
      html += '<button type="button" class="rc-report-row" data-report-id="' + esc(r.id) + '">' +
        '<span class="rc-rep-face" data-kind="' + r.kind + '">' + RC.icons.ui(r.kind) + "</span>" +
        '<span class="rc-mate-meta">' +
          '<span class="rc-mate-rowname">' + esc(meta.label) + "</span>" +
          '<span class="rc-mate-sub">' + esc(sub.join(" · ")) + "</span>" +
        "</span>" + RC.icons.ui("chevron") + "</button>";
    }
    box.innerHTML = html;
  }

  function renderPeople() {
    var box = el("pubs-people");
    if (!box) return;
    var list = RC.pubs.world();

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
      if (p.room) sub.push("in " + roomName(p.room));
      return { p: p, away: away == null ? Infinity : away, sub: sub.join(" · ") };
    });
    // Nearest first: on a public map the only ordering anybody wants is "who
    // is about to be in my mirror".
    rows.sort(function (a, b) { return a.away - b.away; });

    var html = "";
    for (var i = 0; i < rows.length; i++) {
      var p = rows[i].p;
      html += '<div class="rc-mate-row is-tappable" data-pub-id="' + esc(p.id) + '" role="button" tabindex="0" ' +
        'aria-label="' + esc(p.name) + ' — show on the map">' +
        '<span class="rc-pub-chip" style="--pub:' + p.color + '">' + faceHtml(p) + "</span>" +
        '<span class="rc-mate-meta">' +
          '<span class="rc-mate-rowname">' + esc(p.name) + "</span>" +
          '<span class="rc-mate-sub">' + esc(rows[i].sub || "somewhere nearby") + "</span>" +
        "</span>" + RC.icons.ui("chevron") +
        "</div>";
    }
    box.innerHTML = html;
  }

  function renderRooms() {
    var box = el("pubs-rooms");
    if (!box) return;
    var rooms = RC.pubs.rooms();
    var here = RC.pubs.roomCode();

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
          '<span class="rc-saved-name">' + esc(r.name) + "</span>" +
          '<span class="rc-saved-meta">' + esc(r.code) + " · " +
            r.people + (r.people === 1 ? " person" : " people") + " · by " +
            esc(r.by) + "</span>" +
        "</span>" +
        (mine
          ? '<span class="rc-mate-tag">you are in</span>'
          : '<button type="button" class="rc-act rc-act-sm" data-pub-enter="' +
            esc(r.code) + '">Walk in</button>') +
        "</div>";
    }
    box.innerHTML = html;
  }

  function renderRoom() {
    var snap = RC.pubs.roomSnapshot();
    placeRoomBlock();
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
          html += '<p class="rc-chat-sys">' + esc(m.text) + "</p>";
        } else {
          html += '<p class="rc-chat-line' + (m.mine ? " is-mine" : "") + '">' +
            '<span class="rc-chat-who">' + esc(m.name) + "</span>" +
            '<span class="rc-chat-text">' + esc(m.text) + "</span>" +
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

  function renderViewControls() {
    var btns = document.querySelectorAll("[data-pub-names]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-pressed", btns[i].getAttribute("data-pub-names") === view.names ? "true" : "false");
    }
    var b = el("pubs-bubbles"); if (b) b.checked = !!view.bubbles;
    var p = el("pubs-pins"); if (p) p.checked = !!view.pins;
    var a = el("pubs-alerts"); if (a) a.checked = !!view.alerts;
  }

  function renderAvatars() {
    var mine = RC.pubs.avatar() || defaultAvatar();
    var html = "";
    for (var k in AVATAR_ICON) {
      if (!AVATAR_ICON.hasOwnProperty(k)) continue;
      html += '<button type="button" class="rc-avatar" data-pub-av="' + k + '" aria-pressed="' +
        (k === mine ? "true" : "false") + '" aria-label="' + AVATAR_LABEL[k] + '" title="' + AVATAR_LABEL[k] + '">' +
        RC.icons.ui(AVATAR_ICON[k]) + "</button>";
    }
    var boxes = document.querySelectorAll(".rc-avatars");
    for (var i = 0; i < boxes.length; i++) if (boxes[i].innerHTML !== html) boxes[i].innerHTML = html;
  }

  /* Written once: the six report buttons and the one-tap lines, in the pane
     and in the map's sheet alike. */
  function renderStatic() {
    var grid = "";
    for (var i = 0; i < REPORTS.length; i++) {
      grid += '<button type="button" class="rc-report-btn" data-report="' + REPORTS[i].kind + '">' +
        '<span class="rc-rep-face" data-kind="' + REPORTS[i].kind + '">' + RC.icons.ui(REPORTS[i].kind) + "</span>" +
        "<span>" + esc(REPORTS[i].label) + "</span></button>";
    }
    var grids = document.querySelectorAll("[data-report-grid]");
    for (var g = 0; g < grids.length; g++) grids[g].innerHTML = grid;

    var says = "";
    for (var j = 0; j < SAYS.length; j++) {
      says += '<button type="button" class="rc-say" data-shout="' + j + '">' + esc(SAYS[j]) + "</button>";
    }
    var sb = ["pubs-says", "pubs-sheet-says"];
    for (var s = 0; s < sb.length; s++) { var box = el(sb[s]); if (box) box.innerHTML = says; }
  }

  /* Everything that is cheap and always visible is drawn on every change;
     the lists in the pane only when the pane can actually be seen. A fix a
     second rebuilding four lists nobody is looking at is a battery cost with
     no reader. */
  function renderAll() {
    renderBadge();
    renderSubBadges();
    drawWorld();
    checkAhead();
    refreshCard();
    if (panelShowsPubs() || !RC.pubs.isOn()) {
      renderArea();
      renderRoom();
      renderBlocked();
      renderAvatars();
      renderViewControls();
    }
  }

  function renderPane() {
    renderBadge();
    renderSubBadges();
    renderArea();
    renderRoom();
    renderBlocked();
    renderAvatars();
    renderViewControls();
    drawWorld();
  }

  /* An open card follows what it describes: the rider moved, the pin was
     confirmed — or it is gone, and so is the card. */
  function refreshCard() {
    var key = RC.who.current();
    if (!key) return;
    if (key.indexOf("pub:") === 0) {
      var p = personById(key.slice(4));
      if (!p) RC.who.close(key); else RC.who.update(key, personSpec(p));
    } else if (key.indexOf("rep:") === 0) {
      var r = reportById(key.slice(4));
      // A card that is asking keeps asking while it is refreshed.
      if (!r) RC.who.close(key); else RC.who.update(key, reportSpec(r, askingId === r.id));
    }
  }

  /* ---------------------------------------------------------
     The sheet by the map controls
     --------------------------------------------------------- */
  function openSheet() {
    primeAudio();
    RC.who.close();
    var sheet = el("pubs-sheet");
    if (!sheet) return;
    sheet.hidden = false;
    sheet.classList.remove("is-in");
    void sheet.offsetWidth;
    sheet.classList.add("is-in");
    var fab = el("pubs-fab");
    if (fab) fab.setAttribute("aria-expanded", "true");
  }

  function closeSheet() {
    show("pubs-sheet", false);
    var fab = el("pubs-fab");
    if (fab) fab.setAttribute("aria-expanded", "false");
  }

  /* ---------------------------------------------------------
     Wiring
     --------------------------------------------------------- */
  function startPubs() {
    primeAudio();
    var input = el("pubs-name");
    var name = input ? input.value : "";
    if (!RC.pubs.avatar()) RC.pubs.setAvatar(defaultAvatar());
    bridge.setStatus("Finding the area…", "busy");
    RC.pubs.start(name).then(function () {
      bridge.setStatus("PUBs is on — you are visible.", "");
      bridge.flashStatus(4000);
      renderPane();
    }, function (err) {
      bridge.setStatus(err && err.message ? err.message : "Could not go public.", "error");
    });
  }

  function stopPubs() {
    RC.pubs.stop();
    bubbles = {};
    beeping = {};
    unreadShouts = 0;
    RC.who.close();
    closeSheet();
    bridge.setStatus("PUBs is off.", "");
    bridge.flashStatus(3000);
    renderPane();
  }

  function enterRoom(code, fromMap) {
    RC.pubs.enterRoom(code, nameForRoom()).then(function () {
      if (fromMap) {
        bridge.openPubs();
        if (subs) subs.select("rooms");
      }
      renderPane();
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
      renderPane();
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

  function doShout(line, input) {
    if (!line || !line.trim()) return;
    if (!RC.pubs.shout(line)) {
      bridge.toast(RC.pubs.role() === "host" || RC.pubs.role() === "guest"
        ? "Give it a couple of seconds between lines." : "Still finding the area…", "");
      return;
    }
    if (input) input.value = "";
    renderShouts();
  }

  function bindShoutField(inputId, sendId, closeAfter) {
    function go() {
      var input = el(inputId);
      if (!input) return;
      var before = input.value;
      doShout(input.value, input);
      if (closeAfter && before && !input.value) closeSheet();
    }
    on(sendId, "click", go);
    on(inputId, "keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); go(); }
    });
  }

  function onClickIn(selector, attr, fn) {
    document.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest(selector) : null;
      if (b) fn(b.getAttribute(attr), b);
    });
  }

  function init(b) {
    bridge = b;
    map = b.map;
    view = loadView();

    // Strangers above the route lines and below your own ride's riders (the
    // marker pane, 600), so a mate is never hidden under somebody you do not
    // know. Pins over the people: a pin is dropped exactly where its reporter
    // is standing, and it is the pin that needs tapping. Bubbles over it all.
    try {
      if (!map.getPane(PANE)) map.createPane(PANE);
      map.getPane(PANE).style.zIndex = 585;
      if (!map.getPane(PANE_REPORTS)) map.createPane(PANE_REPORTS).style.zIndex = 590;
      if (!map.getPane(PANE_BUBBLES)) map.createPane(PANE_BUBBLES).style.zIndex = 640;
    } catch (e) {}
    reportLayer = L.layerGroup().addTo(map);
    peopleLayer = L.layerGroup().addTo(map);
    bubbleLayer = L.layerGroup().addTo(map);

    var saved = RC.pubs.myName();
    var nameInput = el("pubs-name");
    if (nameInput && saved) nameInput.value = saved;

    subs = RC.subtabs("pubs", function (key) {
      if (key === "chat") unreadShouts = 0;
      renderPane();
    });
    renderStatic();

    on("pubs-start", "click", startPubs);
    on("pubs-stop", "click", stopPubs);
    on("pubs-to-map", "click", function () { bridge.closePanel(); });
    on("pubs-room-open", "click", openRoom);
    on("pubs-room-leave", "click", function () { RC.pubs.leaveRoom(); renderPane(); });
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
    on("pubs-unblock", "click", function () { RC.pubs.unblockAll(); renderPane(); });

    bindShoutField("pubs-shout-input", "pubs-shout-send", false);
    bindShoutField("pubs-sheet-input", "pubs-sheet-send", true);

    on("pubs-fab", "click", function () {
      var sheet = el("pubs-sheet");
      if (sheet && !sheet.hidden) closeSheet(); else openSheet();
    });
    on("pubs-sheet-close", "click", closeSheet);
    document.addEventListener("keydown", function (e) {
      var sheet = el("pubs-sheet");
      if (e.key === "Escape" && sheet && !sheet.hidden) closeSheet();
    });

    on("pubs-bubbles", "change", function () { setView("bubbles", this.checked); });
    on("pubs-pins", "change", function () { setView("pins", this.checked); });
    on("pubs-alerts", "change", function () { setView("alerts", this.checked); });

    // Delegated, because every one of these is rebuilt from scratch on render
    // and several exist twice (the pane and the map's sheet).
    onClickIn("[data-pub-names]", "data-pub-names", function (v) { setView("names", v); });
    onClickIn("[data-pub-av]", "data-pub-av", function (v) { RC.pubs.setAvatar(v); renderAvatars(); });
    onClickIn("[data-report]", "data-report", doReport);
    onClickIn("[data-shout]", "data-shout", function (i, btn) {
      doShout(SAYS[+i]);
      if (btn.closest("#pubs-sheet")) closeSheet();
    });
    onClickIn("[data-report-id]", "data-report-id", function (id) {
      var r = reportById(id);
      if (!r) return;
      bridge.closePanel();
      if (RC.follow.isEnabled()) RC.follow.looked();
      RC.follow.silently(function () { map.flyTo([r.lat, r.lon], Math.max(map.getZoom(), 15), { duration: 0.9 }); });
      openReport(id, false);
    });
    function pickPerson(id) {
      var p = personById(id);
      if (!p) return;
      bridge.closePanel();
      if (RC.follow.isEnabled()) RC.follow.looked();
      RC.follow.silently(function () { map.flyTo([p.fix.lat, p.fix.lon], Math.max(map.getZoom(), 15), { duration: 0.9 }); });
      openPerson(id);
    }
    onClickIn("#pubs-people [data-pub-id]", "data-pub-id", pickPerson);
    var peopleBox = el("pubs-people");
    if (peopleBox) peopleBox.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var row = e.target.closest ? e.target.closest("[data-pub-id]") : null;
      if (!row || e.target !== row) return;
      e.preventDefault();
      pickPerson(row.getAttribute("data-pub-id"));
    });
    var roomsBox = el("pubs-rooms");
    if (roomsBox) roomsBox.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-pub-enter]") : null;
      if (!btn) return;
      enterRoom(btn.getAttribute("data-pub-enter"));
    });

    on("pubs-btn", "click", function () {
      bridge.openPubs();
      if (unreadShouts && subs && RC.pubs.isOn()) subs.select("chat");
    });

    RC.pubs.onChange = renderAll;
    RC.pubs.onRoom = function () { renderRoom(); renderBadge(); };
    RC.pubs.onNotice = function (n) {
      bridge.setStatus(n.text, n.kind === "warn" ? "error" : "");
      bridge.flashStatus(4500);
    };
    RC.pubs.onShout = function (line) {
      if (view.bubbles) addBubble(line);
      if (!line.mine) {
        if (!panelShowsChat()) unreadShouts++;
        // The bubble is the message when the sender is on screen and bubbles
        // are on; otherwise it would be said to nobody, so it is a toast.
        var p = personById(line.from);
        var seen = view.bubbles && p && map.getBounds().contains(L.latLng(p.fix.lat, p.fix.lon));
        if (!panelShowsPubs() && !seen) bridge.toast(line.name + ": " + line.text, "pubs");
      }
      renderShouts();
      renderBadge();
      renderSubBadges();
    };
    RC.pubs.onBeep = function (bp) {
      beeping[bp.id] = Date.now() + BEEP_SHOW_MS;
      setTimeout(drawPeople, BEEP_SHOW_MS + 50);
      drawPeople();
      horn();
      if (RC.guide) RC.guide.buzz([60, 70, 60]);
      bridge.toast(bp.name + " beeped at you", "pubs");
      // Standing still, the card is a chance to beep back. Riding, it would
      // be a card over the dashboard nobody asked for.
      if (!riding() && !RC.who.isOpen()) openPerson(bp.id, { ttl: 9000 });
    };
    RC.pubs.onReport = function () {
      renderSubBadges();
      if (panelShowsPubs()) renderRoad();
      drawReports();
      checkAhead();
    };

    map.on("zoomend", function () { drawPeople(); unstackBubbles(); });

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

    renderPane();
  }

  return {
    init: init,
    render: renderPane,
    drawWorld: drawWorld
  };
})();

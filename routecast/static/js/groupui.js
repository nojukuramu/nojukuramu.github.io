/* ============================================================
   RouteCast — group ride, on the screen

   RC.group owns the room; this owns everything the rider sees of it. Kept out
   of app.js on purpose: app.js is the render pipeline for ONE rider's trip, and
   a room of riders is a second, independent thing drawn over the same map.

   What it draws, and in what order (Leaflet panes, bottom to top)
   ---------------------------------------------------------------
   1. the PLANNED route — indigo, casing underneath, the group's agreed line.
      It is static. It does not move when you do, it is not re-routed when you
      leave it, and it is the same geometry on every phone in the room.
   2. the SUGGESTED ways back — grey, all of them, so the choice is visible
      rather than decided for you. The selected one is drawn over the top in
      the accent colour.
   3. each rider's TRAIL — a short tail of where they have just been, fading
      out, so a dot on a map also says which road it is on and how it got
      there.
   4. the RIDERS — one dot per member in their own colour, with a name. Tap
      one for a card (who.js): find them, ride to them, or — for the host —
      remove them.

   How much of that is drawn is the rider's own business and nobody else's:
   names always / zoomed in / never, speeds on the labels, trails, the list
   over the dashboard and the planned line itself are switches on the Map
   sub-tab, kept on this phone only.

   The rule the rest of the app lives by holds here too: nothing grows into the
   middle of the viewport. The room is a tab in the planner, a button on the
   rail, a strip of chips, and one card that only appears when you have actually
   left the planned route.
   ============================================================ */
var RC = RC || {};

RC.groupui = (function () {
  "use strict";

  // How often we are willing to spend routing requests on ways back, and how
  // far a rider has to have moved for the last answer to be stale. Being lost
  // is not a reason to hammer a public demo server.
  var SUGGEST_MIN_GAP_MS = 45000;
  var SUGGEST_MOVE_M = 400;

  var TOAST_MS = 5200;
  var MEMBER_LABEL_ZOOM = 12;   // below this, dots only: names would be a wall

  // A trail is the last few minutes, not the whole ride: enough to show which
  // road somebody is on, short enough never to become a second route line.
  var TRAIL_MS = 150000;
  var TRAIL_MAX = 48;
  var TRAIL_STEP_M = 12;

  /* One-tap lines for the chat. Said at a fuel stop with gloves on, so each is
     a whole sentence somebody would otherwise have to type. */
  var SAYS = ["On my way", "Wait up", "Stopping for fuel", "All good", "Regroup at the next stop"];

  var VIEW_DEFAULTS = { names: "zoom", speeds: true, trails: true, rail: true, plan: true };

  var bridge = null;
  var map = null;

  var plannedLayer = null;      // L.LayerGroup: casing + line + stop pins
  var suggestLayer = null;      // L.LayerGroup: the ways back
  var memberLayer = null;       // L.LayerGroup: everyone's dots
  var trailLayer = null;        // L.LayerGroup: the tails behind them
  var trails = {};              // member id -> [[lat, lon, t], ...]
  var view = null;              // how the ride is drawn, on this phone only
  var subs = null;              // the in-ride sub-tabs

  /* Two panes of our own, both UNDER Leaflet's overlay pane (400). Order by
     insertion would otherwise put the planned route on top of the rider's own
     line simply because it was set second, which is backwards: the group's line
     is the background the rider's route is read against. */
  var PANE_PLANNED = "rcPlanned";
  var PANE_SUGGEST = "rcSuggest";
  var PANE_TRAILS = "rcTrails";

  var suggestions = [];
  var selectedId = null;
  var suggestState = {
    busy: false, at: 0, from: null, offRoute: false, distM: null, token: 0, cardOpen: false
  };

  var unread = 0;
  var toastTimer = null;
  var pttHold = false;

  var qrOpen = false;       // the host has asked for the code as a picture
  var qrDrawn = null;       // the URL currently on the canvas
  var scan = null;          // { stream, timer, detector } while the camera is on

  function el(id) { return RC.el(id); }
  function on(id, ev, fn) {
    var node = el(id);
    if (node) node.addEventListener(ev, fn);
  }
  function show(id, yes) {
    var node = el(id);
    if (node) node.hidden = !yes;
  }
  function text(id, s) {
    var node = el(id);
    if (node) node.textContent = s;
  }

  function colors() { return bridge.themeColors(); }
  function units() { return bridge.units(); }

  function loadView() {
    var saved = RC.store.get("groupView", null) || {};
    var v = {};
    for (var k in VIEW_DEFAULTS) {
      if (VIEW_DEFAULTS.hasOwnProperty(k)) v[k] = saved.hasOwnProperty(k) ? saved[k] : VIEW_DEFAULTS[k];
    }
    if (["always", "zoom", "never"].indexOf(v.names) < 0) v.names = "zoom";
    return v;
  }

  function setView(key, value) {
    view[key] = value;
    RC.store.set("groupView", view);
    renderViewControls();
    if (key === "plan") drawPlanned();
    if (key === "trails" && !value) trails = {};
    drawMembers();
    renderMatesRail();
  }

  function renderViewControls() {
    var btns = document.querySelectorAll("[data-mate-names]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-pressed", btns[i].getAttribute("data-mate-names") === view.names ? "true" : "false");
    }
    var sp = el("group-speeds"); if (sp) sp.checked = !!view.speeds;
    var tr = el("group-trails"); if (tr) tr.checked = !!view.trails;
    var ra = el("group-rail"); if (ra) ra.checked = !!view.rail;
    var pv = el("group-plan-visible"); if (pv) pv.checked = !!view.plan;
  }

  /* ---------------------------------------------------------
     The planned route — drawn once, never re-fitted
     --------------------------------------------------------- */
  function drawPlanned() {
    if (plannedLayer) { map.removeLayer(plannedLayer); plannedLayer = null; }
    var plan = RC.group.planned();
    if (!plan || !plan.coords || plan.coords.length < 2) { renderPlanBlock(); return; }
    // Hidden is a drawing choice, not a leaving of the plan: off-line
    // detection and the ways back still read the line underneath.
    if (!view.plan) { renderPlanBlock(); return; }

    var c = colors();
    plannedLayer = L.layerGroup().addTo(map);
    // Casing first so the line reads over any tile, then a dashed overlay so it
    // is never confused with the rider's own route even at a glance.
    L.polyline(plan.coords, { pane: PANE_PLANNED, color: c.casing, weight: 11, opacity: 0.2, interactive: false }).addTo(plannedLayer);
    L.polyline(plan.coords, { pane: PANE_PLANNED, color: c.planned, weight: 6, opacity: 0.95, interactive: false }).addTo(plannedLayer);
    L.polyline(plan.coords, {
      pane: PANE_PLANNED, color: "#FFFFFF", weight: 2, opacity: 0.55, dashArray: "1 12", interactive: false
    }).addTo(plannedLayer);

    for (var i = 0; i < plan.stops.length; i++) {
      var s = plan.stops[i];
      var last = i === plan.stops.length - 1;
      L.marker([s.lat, s.lon], {
        icon: L.divIcon({
          className: "",
          html: '<span class="rc-marker rc-marker-pin rc-marker-planned">' +
                RC.icons.ui(last ? "flag" : "pin") + "</span>",
          iconSize: [26, 26], iconAnchor: [13, 24]
        }),
        zIndexOffset: 120,
        keyboard: false,
        title: s.name || (last ? "Destination" : "Stop")
      }).addTo(plannedLayer);
    }
    renderPlanBlock();
  }

  function fitPlanned() {
    var plan = RC.group.planned();
    if (!plan || !plan.coords.length) return;
    RC.follow.silently(function () {
      map.fitBounds(L.latLngBounds(plan.coords).pad(0.12));
    });
  }

  /* Everybody at once: every rider with a fix, and you. A look rather than a
     new camera — while riding, the follow camera comes back on its own. */
  function fitEveryone() {
    var pts = [];
    var list = RC.group.members();
    for (var i = 0; i < list.length; i++) if (list[i].fix) pts.push([list[i].fix.lat, list[i].fix.lon]);
    var me = RC.group.myFix();
    if (me) pts.push([me.lat, me.lon]);
    if (!pts.length) {
      bridge.setStatus("Nobody has a position yet.", "");
      bridge.flashStatus(2500);
      return;
    }
    if (RC.follow.isEnabled()) RC.follow.looked();
    RC.follow.silently(function () {
      if (pts.length === 1) map.flyTo(pts[0], Math.max(map.getZoom(), 15), { duration: 0.8 });
      else map.flyToBounds(L.latLngBounds(pts).pad(0.25), { duration: 0.9, maxZoom: 16 });
    });
  }

  function findMate(m) {
    if (!m || !m.fix) return;
    if (RC.follow.isEnabled()) RC.follow.looked();
    RC.follow.silently(function () {
      map.flyTo([m.fix.lat, m.fix.lon], Math.max(map.getZoom(), 15), { duration: 0.9 });
    });
  }

  /* ---------------------------------------------------------
     The ways back
     --------------------------------------------------------- */
  function drawSuggestions() {
    if (suggestLayer) { map.removeLayer(suggestLayer); suggestLayer = null; }
    if (!suggestions.length) return;
    var c = colors();
    suggestLayer = L.layerGroup().addTo(map);

    // Every unselected candidate in grey, then the selected one on top in the
    // accent colour. Drawing in two passes is what keeps the highlight visible
    // where lines share a road.
    suggestions.forEach(function (cand) {
      if (cand.id === selectedId) return;
      var line = L.polyline(cand.coords, {
        pane: PANE_SUGGEST, color: c.ghost, weight: 5, opacity: 0.75, interactive: true
      }).addTo(suggestLayer);
      line.on("click", function () { selectSuggestion(cand.id); });
    });
    suggestions.forEach(function (cand) {
      if (cand.id !== selectedId) return;
      L.polyline(cand.coords, { pane: PANE_SUGGEST, color: c.casing, weight: 10, opacity: 0.22, interactive: false }).addTo(suggestLayer);
      L.polyline(cand.coords, { pane: PANE_SUGGEST, color: c.accent, weight: 5.5, opacity: 1, interactive: false }).addTo(suggestLayer);
    });
  }

  function selectSuggestion(id) {
    selectedId = id;
    drawSuggestions();
    renderRejoinCard();
  }

  function clearSuggestions() {
    suggestions = [];
    selectedId = null;
    suggestState.token++;
    drawSuggestions();
    renderRejoinCard();
  }

  /** Ask the router for ways back. Rate limited, and never for a rider who is
      not actually off the line. */
  function askForWaysBack(force) {
    var plan = RC.group.planned();
    var fix = RC.group.myFix();
    if (!plan || !fix) return;
    if (suggestState.busy) return;

    var moved = suggestState.from
      ? RC.rejoin.metres(suggestState.from.lat, suggestState.from.lon, fix.lat, fix.lon)
      : Infinity;
    var aged = Date.now() - suggestState.at;
    if (!force && suggestions.length && moved < SUGGEST_MOVE_M && aged < SUGGEST_MIN_GAP_MS) return;
    if (!force && aged < 6000) return;

    var token = ++suggestState.token;
    suggestState.busy = true;
    renderRejoinCard();

    RC.rejoin.suggest({
      from: fix,
      planned: plan,
      vehicle: bridge.vehicle(),
      avoidMotorways: bridge.avoidMotorways()
    }).then(function (list) {
      if (token !== suggestState.token) return;
      suggestState.busy = false;
      suggestState.at = Date.now();
      suggestState.from = { lat: fix.lat, lon: fix.lon };
      suggestions = list;
      // Keep the rider's own pick across a refresh where it still exists;
      // otherwise fall back to the recommendation.
      var kept = null;
      for (var i = 0; i < list.length; i++) if (list[i].id === selectedId) kept = list[i].id;
      selectedId = kept || (list.length ? list[0].id : null);
      drawSuggestions();
      renderRejoinCard();
      if (!list.length) bridge.setStatus("Could not work out a way back from here.", "error");
    }, function () {
      if (token !== suggestState.token) return;
      suggestState.busy = false;
      renderRejoinCard();
      bridge.setStatus("Could not work out a way back from here.", "error");
    });
  }

  /* Off-route detection runs on the room's own fixes, not on nav.js, because a
     rider can be off the PLANNED route while perfectly on a route of their own
     — or on no route at all. Hysteresis on the way back in, so a road running
     parallel to the planned one does not flash the card on and off. */
  function onFix(fix) {
    var plan = RC.group.planned();
    if (!plan || !plan.coords.length) {
      if (suggestState.offRoute) { suggestState.offRoute = false; clearSuggestions(); }
      renderOffPlan();
      return;
    }
    var d = RC.rejoin.distanceToLine(plan.coords, fix.lat, fix.lon);
    suggestState.distM = d;
    var was = suggestState.offRoute;
    if (!was && d > RC.rejoin.OFF_ROUTE_M) suggestState.offRoute = true;
    else if (was && d < RC.rejoin.BACK_ON_M) suggestState.offRoute = false;

    if (suggestState.offRoute && !was) {
      askForWaysBack(true);
    } else if (!suggestState.offRoute && was) {
      clearSuggestions();
      bridge.setStatus("Back on the planned route.", "");
      bridge.flashStatus(3000);
    } else if (suggestState.offRoute && suggestions.length) {
      askForWaysBack(false);
    }
    renderOffPlan();
    renderMembers();
    renderMatesRail();
  }

  function renderOffPlan() {
    var box = el("offplan-alert");
    if (!box) return;
    var plan = RC.group.planned();
    // While the card is open it is already saying all of this, at greater
    // length; two of them is just less map.
    if (!plan || !suggestState.offRoute || suggestState.cardOpen) { box.hidden = true; return; }
    box.hidden = false;
    text("offplan-text", "You are " + RC.fmtDist(suggestState.distM, units()) +
                         " off the planned route.");
  }

  /* ---------------------------------------------------------
     Riders on the map
     --------------------------------------------------------- */
  function bearingArrow(deg) {
    if (deg == null) return "";
    return '<span class="rc-mate-arrow" style="transform: rotate(' + Math.round(deg) + 'deg)"></span>';
  }

  /* Where each rider has just been. Recorded here rather than in group.js
     because it is a drawing, not a fact about the room: nothing is sent, and
     a phone that turns trails off keeps nothing. */
  function recordTrails(list) {
    var t = Date.now();
    var live = {};
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m.fix || m.me) continue;
      live[m.id] = true;
      var tr = trails[m.id] || (trails[m.id] = []);
      var last = tr[tr.length - 1];
      if (!last || RC.rejoin.metres(last[0], last[1], m.fix.lat, m.fix.lon) >= TRAIL_STEP_M) {
        tr.push([m.fix.lat, m.fix.lon, t]);
      }
      while (tr.length && (tr.length > TRAIL_MAX || t - tr[0][2] > TRAIL_MS)) tr.shift();
    }
    for (var id in trails) if (trails.hasOwnProperty(id) && !live[id]) delete trails[id];
  }

  function drawTrails(list) {
    if (!trailLayer) trailLayer = L.layerGroup().addTo(map);
    trailLayer.clearLayers();
    if (!view.trails) return;
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var tr = trails[m.id];
      if (!tr || tr.length < 2) continue;
      // Three pieces, oldest faintest: a fade without a gradient, which
      // Leaflet's SVG lines cannot do on their own.
      var n = tr.length, cut1 = Math.floor(n / 3), cut2 = Math.floor(2 * n / 3);
      var parts = [[0, cut1 + 1, 0.16], [cut1, cut2 + 1, 0.32], [cut2, n, 0.55]];
      for (var p = 0; p < parts.length; p++) {
        var seg = tr.slice(parts[p][0], parts[p][1]);
        if (seg.length < 2) continue;
        L.polyline(seg.map(function (q) { return [q[0], q[1]]; }), {
          pane: PANE_TRAILS, color: m.color, weight: 4, opacity: parts[p][2],
          lineCap: "round", lineJoin: "round", interactive: false
        }).addTo(trailLayer);
      }
    }
  }

  function withNames() {
    return view.names === "always" || (view.names === "zoom" && map.getZoom() >= MEMBER_LABEL_ZOOM);
  }

  function drawMembers() {
    if (!memberLayer) memberLayer = L.layerGroup().addTo(map);
    memberLayer.clearLayers();
    if (!RC.group.isActive()) {
      trails = {};
      if (trailLayer) trailLayer.clearLayers();
      return;
    }
    var names = withNames();
    var list = RC.group.members();
    if (view.trails) recordTrails(list);
    drawTrails(list);
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (!m.fix || m.me) continue;     // your own dot is the rider marker app.js draws
      var cls = "rc-mate" + (m.stale ? " is-stale" : "") + (RC.who.isOpen("mate:" + m.id) ? " is-picked" : "");
      var label = names
        ? '<span class="rc-mate-name">' + RC.escapeHtml(m.name) +
          // A stationary rider's "0" is noise on a map label; their dot already
          // says where they are.
          (view.speeds && m.fix.speedKmh > 3 ? ' <b>' + Math.round(
            units() === "imperial" ? m.fix.speedKmh / 1.609344 : m.fix.speedKmh) + '</b>' : "") + "</span>"
        : "";
      var marker = L.marker([m.fix.lat, m.fix.lon], {
        icon: L.divIcon({
          className: "",
          html: '<span class="' + cls + '" style="--rider: ' + m.color + '">' +
                bearingArrow(m.fix.courseDeg) + '<span class="rc-mate-dot"></span>' + label + "</span>",
          iconSize: [16, 16], iconAnchor: [8, 8]
        }),
        zIndexOffset: 400 + i,
        keyboard: false,
        title: m.name
      }).addTo(memberLayer);
      marker.on("click", mateClick(m.id));
    }
  }

  /* ---------------------------------------------------------
     A rider, tapped
     --------------------------------------------------------- */
  function memberById(id) {
    var list = RC.group.members();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function mateSpec(m) {
    var me = RC.group.myFix();
    var sub = [];
    if (!m.online) sub.push("offline");
    else if (m.stale) sub.push("quiet for a while");
    if (m.fix && me && !m.me) sub.push(RC.fmtDist(RC.rejoin.metres(me.lat, me.lon, m.fix.lat, m.fix.lon), units()) + " away");
    if (m.fix && m.fix.speedKmh != null) sub.push(m.fix.speedKmh > 3 ? RC.fmtSpeed(m.fix.speedKmh, units()) : "stopped");
    if (!m.fix) sub.push("no position yet");
    if (m.host) sub.push("host");
    var acts = [];
    if (m.fix) acts.push({ label: "Find", icon: "location", keep: true, run: function () { findMate(memberById(m.id) || m); } });
    if (m.fix && !m.me && bridge.planTo) {
      acts.push({ label: "Ride to them", icon: "go", kind: "primary", run: function () {
        var now = memberById(m.id) || m;
        bridge.planTo([{ lat: now.fix.lat, lon: now.fix.lon, name: now.name }], now.name);
      } });
    }
    if (RC.group.isHost() && !m.me) {
      acts.push({ label: "Remove", icon: "close", kind: "danger", run: function () { RC.group.kick(m.id); } });
    }
    return {
      key: "mate:" + m.id,
      kind: "mate",
      color: m.color,
      face: '<span class="rc-who-dot"></span>',
      name: m.me ? m.name + " (you)" : m.name,
      sub: sub.join(" · "),
      actions: acts,
      onClose: function () { drawMembers(); }
    };
  }

  function mateClick(id) { return function () { openMate(id); }; }

  function openMate(id) {
    var m = memberById(id);
    if (!m) return;
    RC.who.open(mateSpec(m));
    drawMembers();
  }

  function refreshMateCard() {
    var key = RC.who.current();
    if (!key || key.indexOf("mate:") !== 0) return;
    var m = memberById(key.slice(5));
    if (!m) { RC.who.close(key); return; }
    RC.who.update(key, mateSpec(m));
  }


  /* ---------------------------------------------------------
     The rest of the ride, above the speedometer

     The map answers "where is everybody" for the riders who happen to be on
     the screen. It answers nothing at all for the ones who are not — and in a
     real group ride that is most of them most of the time, because the moment
     you are following somebody the map is zoomed to the road in front of you
     and the rider four minutes up it is off the top of it.

     So: one line each, in the strip between the map and the dashboard. The
     design constraint is that this is read at 80 km/h through a visor, which
     rules out almost everything:

     * MAX_ROWS rows, never more. A list that grows pushes the map away, and
       the map is the point. Six riders on a five-row rail means the least
       interesting one is folded into "+2".
     * Sorted by how much you need to know about them, not alphabetically and
       not by joining order. A rider whose phone has gone quiet outranks one
       who is merrily 400 m ahead, because the quiet one is the one you might
       have to turn round for.
     * Offscreen riders first among equals, because the onscreen ones are
       already answered by the map.
     * An arrow per row that points at them RELATIVE TO WHERE YOU ARE
       POINTING, so it is read as "look over your left shoulder" rather than
       as a compass bearing that has to be converted in your head. On a
       course-up map that is simply their bearing minus yours; on a north-up
       one it is the same arithmetic, which is why it is done here rather than
       leaned on the map's rotation.
     * Gap along the PLANNED LINE when there is one, because "1.2 km ahead"
       is a useful number and "1.2 km away" is not when the road bends back on
       itself. Straight-line distance is the fallback and says "away" rather
       than "ahead", so the two are never confused.

     Everything is one row of glass: no cards, no avatars, no chrome.
     --------------------------------------------------------- */
  var MATES_MAX_ROWS = 4;
  var MATES_QUIET_MS = 20000;     // no fix this long: they are the story

  /* Distance along the planned line, for the one comparison that matters in a
     group ride: who is in front. RC.rejoin already knows how to project a
     point onto a polyline properly — perpendicular, clamped per segment, with
     the along-distance interpolated — and reusing it means the gap in this
     rail and the "you are off the line" card can never be computed two
     different ways and disagree.

     The cumulative table is the expensive half and depends only on the line,
     which does not change during a ride, so it is worked out once per plan
     rather than once per rider per fix.

     Returns null for a rider far enough off the line that a projection would
     be a fiction: somebody who has taken a different road entirely is not
     "800 m ahead", they are elsewhere, and the rail says "off" instead. */
  var planCum = null, planCumFor = null;

  function planCumulative(plan) {
    if (planCumFor !== plan) {
      planCumFor = plan;
      planCum = RC.rejoin.cumulative(plan.coords);
    }
    return planCum;
  }

  var PLAN_GAP_MAX_M = 1200;   // further off the line than this: not a gap

  function alongPlan(plan, lat, lon) {
    if (!plan || !plan.coords || plan.coords.length < 2) return null;
    var n = RC.rejoin.nearestOn(plan.coords, lat, lon, planCumulative(plan));
    if (!n || n.distM > PLAN_GAP_MAX_M) return null;
    return n.alongM;
  }

  function bearingBetween(a, b) {
    return RC.bearing({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
  }

  function onScreen(fix) {
    if (!map || !fix) return false;
    try { return map.getBounds().pad(-0.08).contains(L.latLng(fix.lat, fix.lon)); }
    catch (e) { return false; }
  }

  function renderMatesRail() {
    var rail = el("mates-rail");
    if (!rail) return;

    var live = RC.group.isActive();
    var riding = bridge.mode() === "nav" || bridge.mode() === "free";
    var me = RC.group.myFix();
    if (!live || !riding || !view.rail) {
      rail.hidden = true;
      rail.innerHTML = "";
      if (typeof RC.onMatesRailChange === "function") RC.onMatesRailChange();
      return;
    }

    var plan = RC.group.planned();
    var myAlong = me && plan ? alongPlan(plan, me.lat, me.lon) : null;
    var myCourse = me && me.courseDeg != null ? me.courseDeg
      : (RC.compass && RC.compass.isRotated() ? -RC.compass.getBearing() : 0);

    var rows = [];
    var list = RC.group.members();
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.me || !m.approved) continue;

      var quiet = m.stale || !m.fix;
      var seen = !quiet && onScreen(m.fix);
      var gapM = null, ahead = null, awayM = null, look = null;

      if (m.fix && me) {
        awayM = RC.rejoin.metres(me.lat, me.lon, m.fix.lat, m.fix.lon);
        look = bearingBetween(me, m.fix) - myCourse;
        if (myAlong != null) {
          var theirs = alongPlan(plan, m.fix.lat, m.fix.lon);
          if (theirs != null) { gapM = Math.abs(theirs - myAlong); ahead = theirs > myAlong; }
        }
      }

      rows.push({
        m: m, quiet: quiet, seen: seen,
        gapM: gapM, ahead: ahead, awayM: awayM, look: look,
        /* The sort key, and the whole judgement of the feature. Lower is more
           urgent. A rider whose phone has gone quiet is the top of the list
           whatever else is true, because they are the one you might have to
           turn round for. Then whoever is off the screen, because the map is
           already answering for everyone on it. Within a band, nearest first —
           capped at 99 km so one rider who went home does not sort ahead of a
           band below them. */
        rank: (quiet ? 0 : seen ? 200 : 100) +
              Math.min(99, awayM == null ? 99 : awayM / 1000)
      });
    }

    if (!rows.length) {
      rail.hidden = true;
      rail.innerHTML = "";
      if (typeof RC.onMatesRailChange === "function") RC.onMatesRailChange();
      return;
    }
    rows.sort(function (a, b) { return a.rank - b.rank; });

    var shown = rows.slice(0, MATES_MAX_ROWS);
    var rest = rows.length - shown.length;
    var html = "";

    for (var j = 0; j < shown.length; j++) {
      var r = shown[j];
      var f = r.m.fix;
      var speed = (!r.quiet && f && f.speedKmh != null) ? Math.round(
        units() === "imperial" ? f.speedKmh / 1.609344 : f.speedKmh) : null;

      var gap = r.quiet ? "quiet"
        : r.gapM != null ? RC.fmtDist(r.gapM, units()) + (r.ahead ? " up" : " back")
        : r.awayM != null ? RC.fmtDist(r.awayM, units()) + " off"
        : "—";

      html += '<div class="rc-mate-chip' + (r.quiet ? " is-quiet" : "") +
              (r.seen ? " is-seen" : "") + '" style="--rider: ' + r.m.color + '">' +
        (r.look == null ? '<span class="rc-mate-chip-dot"></span>'
          : '<span class="rc-mate-chip-look" style="transform: rotate(' +
            Math.round(r.look) + 'deg)"></span>') +
        '<span class="rc-mate-chip-name">' + RC.escapeHtml(r.m.name) + '</span>' +
        '<span class="rc-mate-chip-speed">' +
          (speed == null ? '<i>--</i>' : speed) + '</span>' +
        '<span class="rc-mate-chip-gap">' + RC.escapeHtml(gap) + '</span>' +
        '</div>';
    }
    if (rest > 0) {
      html += '<div class="rc-mate-chip is-more"><span class="rc-mate-chip-name">+' +
        rest + ' more</span></div>';
    }

    rail.innerHTML = html;
    rail.hidden = false;
    // The rail just changed height; everything below it is measured from that.
    if (typeof RC.onMatesRailChange === "function") RC.onMatesRailChange();
  }

  /* ---------------------------------------------------------
     The planner's Ride tab
     --------------------------------------------------------- */
  /** The room's state as one word and one colour. Four situations that used to
      be told apart only by reading an 11.5px grey sentence: hosting, in and
      connected, still looking, and in the lobby waiting to be let in. */
  function stateOf() {
    if (RC.group.isWaiting()) return { key: "waiting", text: "Waiting at the door" };
    if (RC.group.isHost()) return { key: "host", text: "Hosting" };
    var link = RC.group.linkState();
    if (link === "connected") return { key: "live", text: "Connected" };
    if (link === "retrying") return { key: "lost", text: "Reconnecting…" };
    return { key: "connecting", text: "Finding the ride…" };
  }

  /** The one definition of what an invite link is. Copy, Invite, the line
      under the code and the QR code all read it, so they cannot drift apart. */
  function inviteUrl() {
    var code = RC.group.code();
    return code ? location.origin + location.pathname + "?ride=" + code : "";
  }

  /* ---------------------------------------------------------
     The room code as a picture

     Six characters read aloud across a car park is fine until it is windy, or
     the other rider still has their helmet on, or the code has an O and a 0 in
     it. The QR carries the whole invite link, so there is nothing to hear and
     nothing to type — and because it is only the link, it opens the same door
     as the link does: the newcomer still has to give a name, and the host
     still has to let them in.
     --------------------------------------------------------- */
  function renderQr() {
    var box = el("group-qr");
    var canvas = el("group-qr-canvas");
    var btn = el("group-qr-btn");
    if (!box || !canvas) return;

    var url = inviteUrl();
    var can = !!url && !!RC.qr;
    if (btn) btn.hidden = !can;
    if (!can || !qrOpen) {
      box.hidden = true;
      if (btn) btn.setAttribute("aria-expanded", "false");
      return;
    }

    box.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    if (qrDrawn === url) return;    // redrawing on every tick would flicker

    try {
      // The card is the width budget; 260px is as big as a phone panel gives
      // us and comfortably more than a reader needs.
      RC.qr.draw(canvas, url, { px: 260, dark: "#000000", light: "#FFFFFF" });
      qrDrawn = url;
    } catch (e) {
      // A link too long for version 25 cannot happen with a six-character
      // code, but a drawing surface can still be refused.
      box.hidden = true;
      qrDrawn = null;
    }
  }

  function toggleQr() {
    qrOpen = !qrOpen;
    text("group-qr-label", qrOpen ? "Hide" : "QR");
    renderQr();
  }

  /* ---------------------------------------------------------
     Reading somebody else's code

     Leans on the browser's own barcode reader, as KaraokeNatin's library
     sharing does. Where it is missing — Safari and Firefox at the time of
     writing — there is no honest fallback short of shipping a decoder, so the
     button says which road is still open rather than opening a camera that
     will never find anything.

     A scan never joins on its own. It fills the code in and stops, for the
     same reason the ?ride= link does: a room is somewhere you choose to be,
     and pointing a camera at a poster is not that choice.
     --------------------------------------------------------- */
  function scanSupported() {
    return typeof window.BarcodeDetector === "function" &&
           !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /** Pull a room code out of whatever the camera read. Accepts a full invite
      link, a bare code, and the link with anything else hung off it — but
      never anything that merely looks code-shaped inside a longer string, so
      a stray poster cannot drop a rider into a stranger's room. */
  function codeFromScan(raw) {
    var text = String(raw || "").trim();
    if (!text) return "";
    var m = /[?&]ride=([A-Za-z0-9]{4,8})\b/.exec(text);
    if (m) return RC.net.normalizeCode(m[1]);
    if (/^[A-Za-z0-9]{6}$/.test(text)) return RC.net.normalizeCode(text);
    return "";
  }

  function scanStatus(msg) { text("group-scan-status", msg); }

  function startScan() {
    if (scan) return;
    if (!scanSupported()) {
      toast("This browser cannot scan QR codes — type the six characters instead.", "warn");
      var codeInput = el("group-code");
      if (codeInput) codeInput.focus();
      return;
    }

    show("group-scan", true);
    show("group-scan-btn", false);
    scanStatus("Starting the camera…");
    // The viewfinder opens below the code field, which on a phone is below the
    // fold. Somebody who has just tapped "Scan" is holding the phone up at a
    // screen, not scrolling.
    var box = el("group-scan");
    if (box && box.scrollIntoView) {
      try { box.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { box.scrollIntoView(); }
    }
    var video = el("group-scan-video");
    var detector;
    try {
      detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    } catch (e) {
      show("group-scan", false);
      toast("This browser cannot read QR codes.", "warn");
      return;
    }

    scan = { stream: null, timer: null };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then(function (stream) {
        if (!scan) {                       // stopped while the camera opened
          stream.getTracks().forEach(function (t) { t.stop(); });
          return;
        }
        scan.stream = stream;
        video.srcObject = stream;

        // play() is asked for but never waited on. It rejects on an autoplay
        // policy and simply never settles until a first frame arrives, and in
        // both cases the camera is open and the detector can already be
        // reading it — so hanging the scan loop off this promise is how a
        // working camera reports itself as broken.
        var p = video.play();
        if (p && p.catch) p.catch(function () {});

        scanStatus("Point the camera at the host's code.");
        scan.timer = setInterval(function () {
          if (!scan) return;
          detector.detect(video).then(function (codes) {
            for (var i = 0; i < codes.length; i++) {
              var code = codeFromScan(codes[i].rawValue);
              if (code) { onScanned(code); return; }
            }
          }, function () { /* a frame the detector could not use */ });
        }, 350);
      })
      .catch(function () {
        // Only getUserMedia reaching here is a real failure: no camera, or a
        // permission the rider refused.
        stopScan();
        scanStatus("");
        toast("The camera could not be opened.", "warn");
      });
  }

  function onScanned(code) {
    stopScan();
    var input = el("group-code");
    if (input) input.value = code;
    var name = el("group-name");
    toast("Ride code " + code + " scanned — add your name to join.", "ok");
    // The name is the only thing still missing, so put the cursor in it.
    if (name && !name.value.trim()) name.focus();
    else if (name) el("group-join-btn").focus();
  }

  function stopScan() {
    if (scan) {
      clearInterval(scan.timer);
      if (scan.stream) scan.stream.getTracks().forEach(function (t) { t.stop(); });
      scan = null;
    }
    var video = el("group-scan-video");
    if (video) { try { video.pause(); video.srcObject = null; } catch (e) {} }
    show("group-scan", false);
    show("group-scan-btn", true);
  }

  /* ---------------------------------------------------------
     Out of a room: start one, or join one

     One question first, then only what that answer needs. A joiner never
     sees the door switch or the "choose your own code" field; a host never
     sees the scanner. The last choice is remembered, and an invite link
     answers the question for you.
     --------------------------------------------------------- */
  var setupMode = "start";

  function setMode(m) {
    setupMode = m === "join" ? "join" : "start";
    var off = el("group-off");
    if (off) off.setAttribute("data-mode", setupMode);
    var btns = document.querySelectorAll("[data-group-mode]");
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute("aria-pressed", btns[i].getAttribute("data-group-mode") === setupMode ? "true" : "false");
    }
    show("group-start-box", setupMode === "start");
    show("group-join-box", setupMode === "join");
    if (setupMode === "start" && scan) { stopScan(); scanStatus(""); }
    RC.store.set("groupMode", setupMode);
    renderStartPlan();
  }

  /* What goes out with the ride if it is started now: the route on the
     planner, said as a destination and three numbers, with a switch to keep
     it back. Read fresh every time the pane is shown, because the rider may
     have planned something since. */
  function renderStartPlan() {
    var plan = bridge.currentPlan ? bridge.currentPlan() : null;
    var card = el("group-start-plan");
    if (card) card.setAttribute("data-has", plan ? "yes" : "no");
    show("group-start-share-row", !!plan);
    if (!plan) {
      text("group-start-plan-title", "No route planned");
      text("group-start-plan-sub", "You can share one once the ride is open.");
      return;
    }
    var last = plan.stops[plan.stops.length - 1];
    text("group-start-plan-title", "To " + (last && last.name ? last.name : "your destination"));
    text("group-start-plan-sub", RC.fmtDist(plan.distance, units()) + " · " + RC.fmtDur(plan.duration) +
      (plan.stops.length > 1 ? " · " + plan.stops.length + " stops" : ""));
  }

  function panelShowsTalk() {
    return panelShowsRide() && !!subs && subs.current() === "talk";
  }

  /* The small numbers on the sub-tabs: how many are riding, what has been
     said that you have not seen, and a dot on Route while you are off it. */
  function renderSubBadges() {
    var live = RC.group.isActive();
    var n = live ? RC.group.members().filter(function (m) { return m.approved; }).length : 0;
    var rn = el("group-sub-riders-n");
    if (rn) { rn.textContent = n > 1 ? String(n) : ""; rn.hidden = n < 2; }
    var tn = el("group-sub-talk-n");
    if (tn) { tn.textContent = unread ? String(unread) : ""; tn.hidden = !unread; }
    var rd = el("group-sub-route-dot");
    if (rd) rd.hidden = !(live && RC.group.planned() && suggestState.offRoute);
  }

  function renderLobby() {
    var live = RC.group.isActive();
    show("group-off", !live);
    show("group-on", live);
    // In a room there is nothing left to scan, and a camera nobody is looking
    // at is a red dot in the status bar and a battery cost.
    if (live && scan) { stopScan(); scanStatus(""); }
    if (!live) {
      qrOpen = false;
      qrDrawn = null;
      renderStartPlan();
      RC.who.close();
      return;
    }

    text("group-code-out", RC.group.code());
    var state = stateOf();
    var pill = el("group-state");
    if (pill) pill.setAttribute("data-state", state.key);
    text("group-state-text", state.text);

    // The invite link, spelled out, for the phone that has neither a share
    // sheet nor a clipboard — and so that "Invite" is not a button whose whole
    // result happened somewhere the rider cannot see.
    var linkEl = el("group-link");
    if (linkEl) {
      linkEl.hidden = !RC.group.code();
      linkEl.textContent = inviteUrl();
    }
    renderQr();

    var host = RC.group.isHost();
    show("group-host-tools", host);
    var s = RC.group.settings() || {};
    var ap = el("group-approval-on"); if (ap) ap.checked = !!s.approval;
    var ch = el("group-chat-on"); if (ch) ch.checked = s.chat !== false;
    var vo = el("group-voice-on"); if (vo) vo.checked = s.voice !== false;

    renderPending();
    renderMembers();
    renderPlanBlock();
    renderChat();
    renderVoice();
    renderViewControls();
    renderSubBadges();
  }

  function renderPending() {
    var box = el("group-pending");
    if (!box) return;
    var list = RC.group.pending();
    if (!list.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    var html = '<p class="rc-door-head">' + RC.icons.ui("knock") +
      (list.length === 1 ? "Someone is asking to join" : list.length + " riders are asking to join") + "</p>";
    for (var i = 0; i < list.length; i++) {
      html += '<div class="rc-pending">' +
        '<span class="rc-pending-name">' + RC.escapeHtml(list[i].name) + "</span>" +
        '<button type="button" class="rc-act rc-act-primary" data-approve="' + RC.escapeHtml(list[i].id) + '">Let in</button>' +
        '<button type="button" class="rc-act rc-act-danger" data-refuse="' + RC.escapeHtml(list[i].id) + '">Refuse</button>' +
        "</div>";
    }
    box.innerHTML = html;
  }

  function renderMembers() {
    var box = el("group-members");
    var live = RC.group.isActive();
    if (el("group-count")) {
      var n = live ? RC.group.members().filter(function (m) { return m.approved; }).length : 0;
      var badge = el("group-count");
      badge.textContent = unread ? String(unread) : (n ? String(n) : "");
      badge.hidden = !live || (!unread && !n);
      badge.setAttribute("data-kind", unread ? "chat" : "count");
    }
    if (!box) return;
    if (!live) { box.innerHTML = ""; return; }

    var me = RC.group.myFix();
    var plan = RC.group.planned();
    var list = RC.group.members();
    var html = "";
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      var away = "";
      if (m.fix && me && !m.me) {
        away = RC.fmtDist(RC.rejoin.metres(me.lat, me.lon, m.fix.lat, m.fix.lon), units()) + " away";
      } else if (m.me) {
        away = "you";
      }
      var offPlan = false;
      if (plan && m.fix) {
        var d = RC.rejoin.distanceToLine(plan.coords, m.fix.lat, m.fix.lon);
        offPlan = d > RC.rejoin.OFF_ROUTE_M;
      }
      var speed = m.fix && m.fix.speedKmh != null ? RC.fmtSpeed(m.fix.speedKmh, units()) : null;
      // The sub-line is facts about where somebody is; anything that is a
      // STATE — host, waiting, off the line, offline — is a tag, because a
      // rider scanning the list is looking for the odd one out, not reading.
      var sub = [];
      if (!m.fix) sub.push("no fix yet");
      else if (away) sub.push(away);
      if (speed) sub.push(speed);
      html += '<div class="rc-mate-row is-tappable' + (m.stale ? " is-stale" : "") +
        '" data-mate="' + RC.escapeHtml(m.id) + '" role="button" tabindex="0" aria-label="' +
        RC.escapeHtml(m.name) + ' — show on the map">' +
        '<span class="rc-mate-swatch" style="background:' + m.color + '"></span>' +
        '<span class="rc-mate-meta">' +
          '<span class="rc-mate-rowname">' + RC.escapeHtml(m.name) +
            (m.host ? ' <span class="rc-mate-tag">host</span>' : "") +
            (m.approved ? "" : ' <span class="rc-mate-tag is-waiting">waiting</span>') +
            (offPlan ? ' <span class="rc-mate-tag is-off">off the line</span>' : "") +
            (m.online ? "" : ' <span class="rc-mate-tag is-off">offline</span>') + "</span>" +
          '<span class="rc-mate-sub">' + RC.escapeHtml(sub.join(" · ") || "—") + "</span>" +
        "</span>" +
        (RC.group.isHost() && !m.me
          ? '<button type="button" class="rc-act rc-act-danger" data-kick="' + RC.escapeHtml(m.id) + '">Remove</button>'
          : "") +
        "</div>";
    }
    box.innerHTML = html;
    var countEl = el("group-members-count");
    if (countEl) {
      var inRoom = list.filter(function (m2) { return m2.approved; }).length;
      countEl.textContent = inRoom > 1 ? inRoom + " on the ride. Tap one to find them."
        : "Just you so far — Invite puts the code on their phone.";
    }
    drawMembers();
    renderMatesRail();
    refreshMateCard();
    renderSubBadges();
  }

  /* The same route twice is not a new route. Compared on what survives the
     trip to the room — the distance and the stops — rather than point by
     point, because the shared copy is simplified on the way out and never
     has the same number of points as the planner's. */
  function samePlan(a, b) {
    if (!a || !b || !a.stops || !b.stops) return false;
    if (Math.abs((a.distance || 0) - (b.distance || 0)) > 1) return false;
    if (a.stops.length !== b.stops.length) return false;
    for (var i = 0; i < a.stops.length; i++) {
      if (RC.rejoin.metres(a.stops[i].lat, a.stops[i].lon, b.stops[i].lat, b.stops[i].lon) > 30) return false;
    }
    return true;
  }

  function renderPlanBlock() {
    var box = el("group-plan-info");
    if (!box) return;
    var plan = RC.group.planned();
    var host = RC.group.isHost();
    var mine = host && bridge.currentPlan ? bridge.currentPlan() : null;

    show("group-plan-steps", !plan && host);
    show("group-plan-stats", !!plan);
    show("group-plan-show", !!plan);
    show("group-plan-ride", !!plan && !!bridge.planTo);
    show("group-rejoin-btn", !!plan);
    show("group-plan-clear", host && !!plan);
    // Share is offered when there is something new to share: the host has a
    // route of their own that is not already the ride's.
    var canShare = host && !!mine && (!plan || !samePlan(plan, mine));
    show("group-plan-set", canShare);
    text("group-plan-set", plan ? "Replace with my route" : "Share my planned route");

    if (!plan) {
      show("group-plan-off", false);
      show("group-plan-stoplist", false);
      if (host) {
        var step1 = el("group-step-plan");
        if (step1) step1.setAttribute("data-done", mine ? "yes" : "no");
        show("group-plan-goto", !mine);
        if (mine) {
          var last = mine.stops[mine.stops.length - 1];
          text("group-step-plan-sub", RC.fmtDist(mine.distance, units()) + " to " +
            (last && last.name ? last.name : "your destination") + ".");
        } else {
          text("group-step-plan-sub", "On the Route tab, like any trip.");
        }
        box.textContent = "";
        box.hidden = true;
      } else {
        box.hidden = false;
        box.textContent = "The host has not shared a route yet.";
      }
      return;
    }
    box.hidden = false;
    text("group-plan-dist", RC.fmtDist(plan.distance, units()));
    text("group-plan-time", RC.fmtDur(plan.duration));
    text("group-plan-stops", String(plan.stops.length));
    box.textContent = "Set by " + plan.by + ". The same line on every phone." +
      (view.plan ? "" : " Hidden on your map.");

    // The stops, in order, with the ones already behind you greyed — "where
    // are we stopping next" is the question this list answers.
    var sl = el("group-plan-stoplist");
    if (sl) {
      var me = RC.group.myFix();
      var myAlong = me ? alongPlan(plan, me.lat, me.lon) : null;
      var html = "";
      for (var i = 0; i < plan.stops.length; i++) {
        var st = plan.stops[i];
        var at = myAlong != null ? alongPlan(plan, st.lat, st.lon) : null;
        var passed = at != null && at < myAlong - 150;
        var isLast = i === plan.stops.length - 1;
        html += '<li class="rc-plan-stop' + (passed ? " is-passed" : "") + (isLast ? " is-last" : "") + '">' +
          RC.escapeHtml(st.name || (isLast ? "Destination" : "Stop " + (i + 1))) + "</li>";
      }
      sl.innerHTML = html;
      sl.hidden = !plan.stops.length;
    }

    // How far off the line you are is the one number here that changes while
    // riding, so it gets its own coloured row rather than a clause at the end
    // of a sentence nobody re-reads.
    var off = el("group-plan-off");
    if (off) {
      var d = suggestState.distM;
      var isOff = d != null && d > RC.rejoin.OFF_ROUTE_M;
      off.hidden = d == null;
      off.textContent = d == null ? "" :
        isOff ? "You are " + RC.fmtDist(d, units()) + " off the planned line."
              : "You are on the planned line.";
      off.setAttribute("data-off", isOff ? "yes" : "no");
    }
    renderSubBadges();
  }

  /* Riding the agreed line: the stops still ahead of you, from where you are,
     through the ordinary planner. Stops already behind you are dropped, so a
     rider who joins at the second fuel stop is not sent back to the first. */
  function rideThePlan() {
    var plan = RC.group.planned();
    if (!plan || !plan.stops.length || !bridge.planTo) return;
    var stops = plan.stops.slice();
    var me = RC.group.myFix();
    var myAlong = me ? alongPlan(plan, me.lat, me.lon) : null;
    if (myAlong != null) {
      var ahead = stops.filter(function (st) {
        var at = alongPlan(plan, st.lat, st.lon);
        return at == null || at > myAlong + 150;
      });
      stops = ahead.length ? ahead : stops.slice(-1);
    }
    var last = stops[stops.length - 1];
    bridge.planTo(stops, last && last.name ? last.name : "the destination");
  }

  function renderSays() {
    var box = el("group-says");
    if (!box) return;
    var html = "";
    for (var i = 0; i < SAYS.length; i++) {
      html += '<button type="button" class="rc-say" data-say="' + i + '">' + RC.escapeHtml(SAYS[i]) + "</button>";
    }
    box.innerHTML = html;
  }

  function renderChat() {
    var log = el("group-chat-log");
    if (!log) return;
    var msgs = RC.group.chat();
    var html = "";
    for (var i = Math.max(0, msgs.length - 60); i < msgs.length; i++) {
      var m = msgs[i];
      if (m.kind === "system") {
        html += '<p class="rc-chat-sys">' + RC.escapeHtml(m.text) + "</p>";
      } else {
        html += '<p class="rc-chat-line' + (m.from === RC.group.myId() ? " is-mine" : "") + '">' +
          '<span class="rc-chat-who">' + RC.escapeHtml(m.name) + "</span>" +
          '<span class="rc-chat-text">' + RC.escapeHtml(m.text) + "</span>" +
          '<span class="rc-chat-at">' + RC.fmtTime(new Date(m.at)) + "</span>" +
          "</p>";
      }
    }
    log.innerHTML = html || '<p class="rc-chat-sys">Nothing said yet.</p>';
    log.scrollTop = log.scrollHeight;
    var s = RC.group.settings() || {};
    var input = el("group-chat-input");
    if (input) input.disabled = s.chat === false;
    var says = el("group-says");
    if (says) says.hidden = s.chat === false;
  }

  function renderVoice() {
    var can = RC.group.canTalk();
    var s = RC.group.settings() || {};
    var live = RC.group.isActive() && s.voice !== false;
    show("group-voice-row", live);
    show("ptt-btn", live && can);
    var hf = el("group-handsfree");
    if (hf) hf.checked = RC.group.isHandsFree();
    var mute = el("group-mute");
    if (mute) mute.checked = RC.group.isMuted();
    var who = RC.group.speaking();
    var ptt = el("ptt-btn");
    var isLive = RC.group.isLive();
    if (ptt) {
      ptt.setAttribute("aria-pressed", RC.group.isTalking() ? "true" : "false");
      ptt.setAttribute("data-state", RC.group.isTalking() ? "talking"
        : who ? "hearing" : "idle");
      // Live is the normal case; the recorded fallback is worth saying out loud,
      // because on it nobody hears a word until the button comes back up.
      ptt.setAttribute("data-mode", isLive ? "live" : "clip");
      ptt.title = isLive
        ? "Hold to talk — the room hears you as you speak."
        : "Hold to talk — the room hears the clip once you let go.";
    }
    var strip = el("voice-now");
    if (strip) {
      strip.hidden = !who;
      if (who) strip.textContent = who.name + " is talking";
    }

    /* Which of the two voice paths the room is actually on is not cosmetic:
       on the live one the room hears you mid-sentence, and on the recorded
       fallback nobody hears a syllable until the button comes back up. That
       used to be visible only as a tooltip on a button on the other side of
       the screen. */
    var pill = el("group-voice-state");
    var liveMode = RC.group.isLiveMode();
    var alone = RC.group.members().length < 2;
    var state = !live ? { key: "off", text: "Off" }
      : RC.group.isMuted() ? { key: "lost", text: "Muted" }
      : RC.group.isTalking() ? { key: "live", text: "You are talking" }
      : who ? { key: "live", text: who.name + " is talking" }
      : !can ? { key: "off", text: "Listen only" }
      : isLive ? { key: "live", text: "Live" }
      // On the live path with an empty room: the microphone works, there is
      // simply no one to hear it. Saying "Recorded clips" here was a lie that
      // made riders think the mic was broken.
      : liveMode && alone ? { key: "waiting", text: "Live — room is empty" }
      : liveMode ? { key: "connecting", text: "Live — linking up" }
      : { key: "waiting", text: "Recorded clips" };
    if (pill) pill.setAttribute("data-state", state.key);
    // textContent, so a rider called <b>Bea</b> is a rider called <b>Bea</b>.
    text("group-voice-state-text", state.text);

    var noteEl = el("group-voice-note");
    if (noteEl) {
      /* One line each. The four-way explanation these used to carry is the
         "voice" topic behind the (i) on the heading. */
      noteEl.textContent = !can
        ? "No microphone here — you can listen, not talk."
        : isLive ? "Hold the microphone button by the map controls."
        : liveMode && alone ? "Hold the mic button. Hands-free works on your own too."
        : liveMode ? "Hold the mic button — the room hears you once the link is up."
        : "Recorded bursts: nobody hears you until you let go.";
    }
  }

  /* ---------------------------------------------------------
     The rejoin card
     --------------------------------------------------------- */
  function renderRejoinCard() {
    var card = el("rejoin-card");
    if (!card) return;
    if (!suggestState.cardOpen) { card.hidden = true; return; }
    card.hidden = false;

    var listEl = el("rejoin-list");
    if (suggestState.busy) {
      listEl.innerHTML = '<p class="rc-field-hint">Working out the ways back…</p>';
      return;
    }
    if (!suggestions.length) {
      listEl.innerHTML = '<p class="rc-field-hint">No way back worked out yet. ' +
        "Tap Refresh once you have a signal.</p>";
      return;
    }
    var html = "";
    for (var i = 0; i < suggestions.length; i++) {
      var c = suggestions[i];
      html += '<button type="button" class="rc-way' + (c.id === selectedId ? " is-selected" : "") +
        '" data-way="' + RC.escapeHtml(c.id) + '">' +
        '<span class="rc-way-top">' +
          '<span class="rc-way-label">' + RC.escapeHtml(c.label) + "</span>" +
          (c.recommended ? '<span class="rc-badge is-clear">Best</span>' : "") +
        "</span>" +
        '<span class="rc-way-stats">' + RC.escapeHtml(RC.fmtDist(c.distance, units())) + " · " +
          RC.escapeHtml(RC.fmtDur(c.duration)) +
          (c.offCorridorM > 200 ? " · " + RC.escapeHtml(RC.fmtDist(c.offCorridorM, units())) + " off the line" : "") +
        "</span>" +
        '<span class="rc-way-why">' + RC.escapeHtml(c.why) + "</span>" +
        "</button>";
    }
    listEl.innerHTML = html;
    var drive = el("rejoin-drive");
    if (drive) drive.disabled = !selectedId;
  }

  function openRejoin() {
    suggestState.cardOpen = true;
    renderOffPlan();
    renderRejoinCard();
    if (!suggestions.length) askForWaysBack(true);
  }

  function closeRejoin() {
    suggestState.cardOpen = false;
    renderRejoinCard();
    renderOffPlan();
  }

  function driveSelected() {
    var cand = null;
    for (var i = 0; i < suggestions.length; i++) if (suggestions[i].id === selectedId) cand = suggestions[i];
    if (!cand) return;
    closeRejoin();
    bridge.driveRoute(cand.route, cand.target ? [cand.target] : []);
  }

  /* ---------------------------------------------------------
     Toasts — the room talking while the planner is shut
     --------------------------------------------------------- */
  function toast(msg, kind) {
    var box = el("group-toast");
    if (!box) return;
    box.hidden = false;
    box.setAttribute("data-kind", kind || "");
    box.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      var b = el("group-toast");
      if (b) b.hidden = true;
    }, TOAST_MS);
  }

  function panelShowsRide() {
    var pane = el("pane-group");
    return !!(pane && !pane.hidden && bridge.isPanelOpen());
  }

  /* ---------------------------------------------------------
     Wiring
     --------------------------------------------------------- */
  function bindRoomEvents() {
    RC.group.onChange = function () { renderLobby(); renderOffPlan(); renderPlanBlock(); };
    RC.group.onFix = onFix;
    RC.group.onPlanned = function (plan) {
      clearSuggestions();
      suggestState.offRoute = false;
      suggestState.distM = null;
      drawPlanned();
      if (plan) {
        toast("Planned route set by " + plan.by + " — " + RC.fmtDist(plan.distance, units()), "ok");
        fitPlanned();
      }
      renderLobby();
    };
    RC.group.onChat = function (msg) {
      renderChat();
      if (msg.kind === "mine" || msg.from === RC.group.myId()) return;
      // Unread is anything said while the chat itself was not on screen —
      // including while the Ride tab was open on another sub-tab, which is
      // what the number on Talk is for. The toast is only for when the
      // planner is shut: an open Ride tab already has the number.
      if (!panelShowsTalk()) unread++;
      if (!panelShowsRide()) toast(msg.kind === "system" ? msg.text : msg.name + ": " + msg.text, "chat");
      renderMembers();
    };
    RC.group.onVoice = function (v) {
      renderVoice();
      // Live voice is already audible by the time this fires, so the toast names
      // the speaker; a clip is an event that happened and is being played back.
      if (!panelShowsRide()) {
        toast(v.live ? v.name + " is talking" : v.name + " sent a voice message", "voice");
      }
    };
    RC.group.onNotice = function (t, kind) {
      bridge.setStatus(t, kind === "error" ? "error" : "");
      bridge.flashStatus(4500);
      renderLobby();
    };
  }

  function startHosting() {
    var name = el("group-name").value;
    var own = el("group-own-code");
    var code = own ? own.value : "";
    var approval = el("group-approval") ? el("group-approval").checked : true;
    var shareBox = el("group-start-share");
    var share = !!(shareBox && shareBox.checked && !el("group-start-share-row").hidden);
    bridge.setStatus("Opening the ride…", "busy");
    RC.group.host({ name: name, code: code, approval: approval }).then(function (out) {
      RC.store.set("groupName", RC.group.myName());
      bridge.setStatus("Ride open on code " + out.code + ".", "");
      bridge.flashStatus(5000);
      // The route goes out with the ride when the host asked for that, read
      // now rather than when the form was drawn: it carries the host's name.
      var plan = share ? bridge.currentPlan() : null;
      if (plan && RC.group.setPlanned(plan)) drawPlanned();
      if (subs) subs.select("riders", true);
      renderLobby();
    }, function (err) {
      bridge.setStatus(err && err.message ? err.message : "Could not open the ride.", "error");
    });
  }

  function startJoining() {
    var name = el("group-name").value;
    var code = el("group-code").value;
    if (!code.trim()) {
      bridge.setStatus("Type the room code, or scan it.", "error");
      el("group-code").focus();
      return;
    }
    bridge.setStatus("Looking for the ride…", "busy");
    RC.group.join({ name: name, code: code }).then(function (out) {
      RC.store.set("groupName", RC.group.myName());
      bridge.setStatus("Found ride " + out.code + ".", "");
      bridge.flashStatus(4000);
      renderLobby();
    }, function (err) {
      bridge.setStatus(err && err.message ? err.message : "Could not join that ride.", "error");
      renderLobby();
    });
  }

  function leaveRoom() {
    RC.group.leave();
    clearSuggestions();
    closeRejoin();
    if (plannedLayer) { map.removeLayer(plannedLayer); plannedLayer = null; }
    if (memberLayer) memberLayer.clearLayers();
    if (trailLayer) trailLayer.clearLayers();
    trails = {};
    RC.who.close();
    suggestState.offRoute = false;
    suggestState.distM = null;
    unread = 0;
    renderLobby();
    renderOffPlan();
  }

  function shareCurrentPlan() {
    var plan = bridge.currentPlan();
    if (!plan) {
      bridge.setStatus("Plan a route first — the Route tab.", "error");
      return;
    }
    if (RC.group.setPlanned(plan)) {
      drawPlanned();
      renderPlanBlock();
      bridge.setStatus("Planned route sent to the ride.", "");
      bridge.flashStatus(4000);
    }
  }

  function sendChat() {
    var input = el("group-chat-input");
    if (!input || !input.value.trim()) return;
    RC.group.say(input.value);
    input.value = "";
    renderChat();
  }

  /* Push to talk: press and hold. Pointer events so a thumb, a mouse and a
     stylus all behave, and a pointer that leaves the button or is cancelled by
     the browser still releases the mic — a stuck open mic in a car is the one
     failure mode worth defending against twice. */
  function bindPtt() {
    var btn = el("ptt-btn");
    if (!btn) return;
    function down(e) {
      if (pttHold) return;
      pttHold = true;
      btn.setAttribute("data-state", "talking");
      try { btn.setPointerCapture(e.pointerId); } catch (err) {}
      RC.group.startTalking();
    }
    // A thumb resting on the button before it presses is free warning: open the
    // capture device then, so the press itself is instantaneous.
    btn.addEventListener("pointerenter", function () { RC.group.primeVoice(); });
    btn.addEventListener("focus", function () { RC.group.primeVoice(); });
    function up() {
      if (!pttHold) return;
      pttHold = false;
      RC.group.stopTalking();
      renderVoice();
    }
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("pointerleave", up);
    // A button that only answers to a thumb is a button a keyboard cannot use,
    // and the browser's own click-on-Space would not hold anything down.
    btn.addEventListener("keydown", function (e) {
      if (e.key !== " " && e.key !== "Enter") return;
      e.preventDefault();
      if (!e.repeat) down({ pointerId: null });
    });
    btn.addEventListener("keyup", function (e) {
      if (e.key === " " || e.key === "Enter") up();
    });
    btn.addEventListener("blur", up);
    window.addEventListener("blur", up);
    btn.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }

  function init(b) {
    bridge = b;
    map = b.map;

    if (!map.getPane(PANE_PLANNED)) map.createPane(PANE_PLANNED).style.zIndex = 370;
    if (!map.getPane(PANE_TRAILS)) map.createPane(PANE_TRAILS).style.zIndex = 380;
    if (!map.getPane(PANE_SUGGEST)) map.createPane(PANE_SUGGEST).style.zIndex = 385;

    view = loadView();
    memberLayer = L.layerGroup().addTo(map);
    trailLayer = L.layerGroup().addTo(map);

    subs = RC.subtabs("group", function (key) {
      if (key === "talk") unread = 0;
      if (key === "route") renderPlanBlock();
      renderMembers();
    });
    var modeBtns = document.querySelectorAll("[data-group-mode]");
    for (var mb = 0; mb < modeBtns.length; mb++) {
      modeBtns[mb].addEventListener("click", function () { setMode(this.getAttribute("data-group-mode")); });
    }
    setMode(RC.store.get("groupMode", "start"));
    renderSays();

    var savedName = RC.store.get("groupName", "");
    if (savedName && el("group-name")) el("group-name").value = savedName;

    on("group-host-btn", "click", startHosting);
    on("group-join-btn", "click", startJoining);
    on("group-leave", "click", leaveRoom);
    on("group-copy", "click", function () {
      var code = RC.group.code();
      if (!code) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(function () {
          bridge.setStatus("Room code copied.", "");
          bridge.flashStatus(2500);
        }, function () {});
      }
    });
    on("group-share", "click", function () {
      var code = RC.group.code();
      if (!code) return;
      var url = inviteUrl();
      if (navigator.share) {
        navigator.share({ title: "RouteCast group ride", text: "Join my ride — code " + code, url: url })
          .catch(function () {});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          bridge.setStatus("Invite link copied.", "");
          bridge.flashStatus(2500);
        }, function () {});
      }
    });

    on("group-qr-btn", "click", toggleQr);
    on("group-scan-btn", "click", startScan);
    on("group-scan-stop", "click", function () { stopScan(); scanStatus(""); });

    on("group-approval-on", "change", function () { RC.group.setApproval(this.checked); });
    on("group-chat-on", "change", function () { RC.group.setChatEnabled(this.checked); });
    on("group-voice-on", "change", function () { RC.group.setVoiceEnabled(this.checked); });

    on("group-plan-set", "click", shareCurrentPlan);
    on("group-plan-goto", "click", function () { bridge.openPanel("route"); });
    on("group-plan-ride", "click", rideThePlan);
    on("group-fit", "click", function () { bridge.closePanel(); fitEveryone(); });

    var nameBtns = document.querySelectorAll("[data-mate-names]");
    for (var nb = 0; nb < nameBtns.length; nb++) {
      nameBtns[nb].addEventListener("click", function () { setView("names", this.getAttribute("data-mate-names")); });
    }
    on("group-speeds", "change", function () { setView("speeds", this.checked); });
    on("group-trails", "change", function () { setView("trails", this.checked); });
    on("group-rail", "change", function () { setView("rail", this.checked); });
    on("group-plan-visible", "change", function () { setView("plan", this.checked); renderPlanBlock(); });

    var says = el("group-says");
    if (says) says.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-say]") : null;
      if (!b) return;
      RC.group.say(SAYS[+b.getAttribute("data-say")]);
      renderChat();
    });
    on("group-plan-clear", "click", function () { RC.group.clearPlanned(); drawPlanned(); clearSuggestions(); });
    on("group-plan-show", "click", function () { fitPlanned(); bridge.closePanel(); });
    on("group-rejoin-btn", "click", function () { bridge.closePanel(); openRejoin(); askForWaysBack(true); });

    on("group-chat-send", "click", sendChat);
    on("group-nudge", "click", function () { RC.group.nudge(); });
    on("group-chat-input", "keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); sendChat(); }
    });

    on("group-handsfree", "change", function () { RC.group.setHandsFree(this.checked); renderVoice(); });
    on("group-mute", "change", function () { RC.group.setMuted(this.checked); });

    var members = el("group-members");
    function pickRow(row) {
      var m = memberById(row.getAttribute("data-mate"));
      if (!m) return;
      // The card and the rider are both on the map, and the planner is on
      // top of the map: close it, go there, then say who it is.
      bridge.closePanel();
      if (m.fix && !m.me) findMate(m);
      openMate(m.id);
    }
    if (members) members.addEventListener("click", function (e) {
      var kick = e.target.closest ? e.target.closest("[data-kick]") : null;
      if (kick) { RC.group.kick(kick.getAttribute("data-kick")); return; }
      var row = e.target.closest ? e.target.closest("[data-mate]") : null;
      if (row) pickRow(row);
    });
    if (members) members.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var row = e.target.closest ? e.target.closest("[data-mate]") : null;
      if (!row || e.target !== row) return;
      e.preventDefault();
      pickRow(row);
    });
    var pending = el("group-pending");
    if (pending) pending.addEventListener("click", function (e) {
      var ok = e.target.closest ? e.target.closest("[data-approve]") : null;
      if (ok) { RC.group.approve(ok.getAttribute("data-approve"), true); return; }
      var no = e.target.closest ? e.target.closest("[data-refuse]") : null;
      if (no) RC.group.approve(no.getAttribute("data-refuse"), false);
    });

    on("offplan-open", "click", openRejoin);
    on("rejoin-close", "click", closeRejoin);
    on("rejoin-refresh", "click", function () { askForWaysBack(true); });
    on("rejoin-drive", "click", driveSelected);
    var ways = el("rejoin-list");
    if (ways) ways.addEventListener("click", function (e) {
      var w = e.target.closest ? e.target.closest("[data-way]") : null;
      if (w) selectSuggestion(w.getAttribute("data-way"));
    });

    on("group-btn", "click", function () {
      bridge.openPanel("group");
      // Something was said while the planner was shut: that is what the
      // number on the button meant, so that is where the button goes.
      if (unread && subs && RC.group.isActive()) subs.select("talk");
      renderMembers();
    });

    // Escape closes the ways-back card, like every other card in the app.
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && suggestState.cardOpen) closeRejoin();
    });

    bindPtt();
    bindRoomEvents();

    map.on("zoomend", drawMembers);

    // A shared invite link (?ride=CODE) fills the code in and says so, rather
    // than joining on its own: a room is somewhere you choose to be, and the
    // name is still required.
    try {
      var m = /[?&]ride=([A-Za-z0-9]{4,8})/.exec(location.search);
      if (m && el("group-code")) {
        setMode("join");
        el("group-code").value = RC.net.normalizeCode(m[1]);
        toast("Ride code " + RC.net.normalizeCode(m[1]) + " is filled in — add your name to join.", "ok");
      }
    } catch (e) {}

    renderLobby();
    renderOffPlan();
  }

  return {
    init: init,
    toast: toast,
    redraw: function () { drawPlanned(); drawSuggestions(); drawMembers(); renderMatesRail(); },
    refresh: function () { renderLobby(); },
    plannedRoute: function () { return RC.group.planned(); },
    pushFix: function (fix) { if (RC.group.isActive()) RC.group.pushFix(fix); },
    isActive: function () { return RC.group.isActive(); }
  };
})();

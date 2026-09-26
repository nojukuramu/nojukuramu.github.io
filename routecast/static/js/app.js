/* ============================================================
   RouteCast — the glue.

   Owns the map, the three modes, and the render pipeline:
     geocode -> route -> sample -> forecast -> score -> draw

   Three modes, one screen
   -----------------------
   PLAN  the dock is up, the planner opens over the map on request.
   NAV   a planned line, turn by turn, the HUD counting it down.
   FREE  no line at all. Speed, distance, the sky where you are, and the
         same ride recorder navigation runs — because a road you rode
         without planning it is still a road you know.

   The mode lives on <html data-mode>, so the stylesheet can move the
   furniture without JavaScript measuring anything. Nothing here ever grows
   into the middle of the viewport: that space belongs to the map.
   ============================================================ */
(function () {
  "use strict";

  var MAP_START = { lat: 14.5995, lon: 120.9842, zoom: 6 };
  var NAV_ZOOM = 16;

  var state = {
    mode: "plan",
    vehicle: RC.store.get("vehicle", "car"),
    units: RC.store.get("units", "metric"),
    interval: RC.store.get("interval", "auto"),
    avoidMotorways: RC.store.get("avoidMotorways", true),
    departMode: "now",
    departAt: null,          // Date
    endpoints: [],           // [{key, place, inputEl, resultsEl}]
    routes: [],
    routeIndex: 0,
    checkpoints: [],
    series: null,
    trip: null,
    profile: null,
    traffic: null,
    calibration: null,
    preferredByHistory: false,
    selected: -1,
    planToken: 0,
    elevToken: 0,
    freeSummary: null
  };

  var map, routeLayers = [], dotLayer, chipLayer, endpointLayer, markLayer, activeRequest = null;
  var freeTrackLayer = null;

  // Live navigation
  var riderMarker = null, riderArrow = null, lastHudRenderTs = 0, lastFreeTrackTs = 0;
  // The last place this phone knew it was, whoever produced it. Cheap, and it
  // saves every panel that wants "how far away is that" from starting a
  // geolocation watch of its own.
  var lastOwnFix = null;
  var navTargets = [];
  var navRerouteToken = 0;

  var WX_REUSE_MS = 10 * 60 * 1000;
  var WX_REFRESH_MAX_POINTS = 24;

  /* The ride as it happened, kept for the card at the end of it: the line
     actually travelled (decimated like free drive's), the last dashboard
     state, and when it began. Free drive keeps its own track; navigation
     never had one, because until now nothing looked back at a ride. */
  var ride = { track: [], last: null, startedAt: 0, introduced: false, dest: "" };
  var RIDE_TRACK_GAP_M = 15;
  var RIDE_TRACK_MAX = 6000;
  var RECAP_MIN_M = 200;           // shorter than this is not a ride worth a card

  // The forecast where a free ride actually is, kept whole so the dashboard
  // can say when the next rain arrives without asking again.
  var localSeries = null;

  // What the map overlays were last drawn from, so a five-second refresh
  // that changes nothing costs nothing. See refreshRideOverlays().
  var overlaySig = "", tickSig = "", overlayLevels = null;

  // The opening of a freshly planned route: fly to it, then draw it on.
  var chipIntro = null;            // null | "wait" | "pop"
  var drawOnTimer = null;

  var activePickTrigger = null, pickReopenPanel = false;

  // 76px screen-space decluttering threshold for weather chips.
  var CHIP_W = 84, CHIP_H = 34, CHIP_GAP = 4;
  var PIN_LIFT = 30;

  /* ---------------------------------------------------------
     Map
     --------------------------------------------------------- */
  function initMap() {
    map = L.map("map", { zoomControl: false, attributionControl: false })
      .setView([MAP_START.lat, MAP_START.lon], MAP_START.zoom);

    /* The ground the app is drawn on belongs to RC.layers now — raster tiles
       or a vector style, whichever is chosen, and a different one again once
       a ride starts. Everything below still talks to Leaflet and never has
       to know which is up. */
    RC.layers.init({
      map: map,
      bridge: { setStatus: setStatus, flashStatus: flashStatus },
      onChange: function () { RC.layersui.render(); }
    });

    dotLayer = L.layerGroup().addTo(map);
    chipLayer = L.layerGroup().addTo(map);
    markLayer = L.layerGroup().addTo(map);
    endpointLayer = L.layerGroup().addTo(map);

    map.on("zoomend", redrawChips);
    map.on("moveend", function () { if (state.mode === "plan") redrawChips(); });

    RC.compass.init({
      map: map,
      mapEl: RC.el("map"),
      wrapEl: RC.el("map-wrap"),
      onModeChange: onCompassModeChange
    });
    renderCompassBtn(RC.compass.getMode());

    /* The camera. Everything that moves the map while a ride is running goes
       through it, so "the app is following you" and "you are looking at
       something" are one piece of state rather than two that disagree. */
    RC.follow.init({
      map: map,
      container: map.getContainer(),
      onChange: renderRecentre
    });

    // Long-press / right-click drops a point into the first empty field.
    map.on("contextmenu", function (e) {
      if (state.mode !== "plan") return;
      setEndpointFromLatLon(lastEmptyEndpoint(), e.latlng.lat, e.latlng.lng);
      setStatus("Point dropped. Open the planner to see it.", "");
      flashStatus();
    });
  }

  function lastEmptyEndpoint() {
    for (var i = 0; i < state.endpoints.length; i++) {
      if (!state.endpoints[i].place) return state.endpoints[i];
    }
    return state.endpoints[state.endpoints.length - 1];
  }

  /* Set an endpoint from a raw coordinate — a long-press, a GPS fix, a
     confirmed pin. The coordinate IS the point; a reverse geocode is asked
     for afterwards purely so the field can show a readable name, and its own
     lat/lon are thrown away. `precise: true` records that, and survives a
     save. A mark already sitting on the spot beats the geocoder outright:
     you named it, so it is called what you called it. */
  function setEndpointFromLatLon(ep, lat, lon, opts) {
    if (!ep) return;
    opts = opts || {};
    var label = RC.coords.format(lat, lon);
    var mark = RC.marks.nearest(lat, lon, 40);
    ep.place = {
      name: opts.name || (mark ? mark.name : label),
      address: opts.address || (mark ? (mark.address || label) : label),
      lat: lat,
      lon: lon,
      precise: true
    };
    ep.inputEl.value = ep.place.name;
    drawEndpoints();
    saveTrip();
    renderDock();
    if (opts.skipReverse || mark) return;

    RC.geocode.reverse(lat, lon).then(function (place) {
      if (ep.place && ep.place.lat === lat && ep.place.lon === lon) {
        ep.place = { name: place.name, address: place.address, lat: lat, lon: lon, precise: true };
        ep.inputEl.value = place.name;
        drawEndpoints();
        saveTrip();
        renderDock();
      }
    }, function () { /* the raw coordinates are a fine fallback */ });
  }

  /* ---------------------------------------------------------
     Endpoints

     What a field accepts, in order: a coordinate (typed or pasted, in any of
     the forms coords.js knows), one of your marks, or a place to search for.
     What it never does is quietly resolve free text to the first search hit
     and route you to a landmark you did not name. When several places match,
     it says so and shows them; when one does, it takes it; when the text is
     a position, no request is made at all.
     --------------------------------------------------------- */
  function makeEndpoint(key, inputEl, resultsEl) {
    var ep = { key: key, place: null, inputEl: inputEl, resultsEl: resultsEl, seq: 0, active: -1, items: [] };

    var run = RC.debounce(function () {
      var q = inputEl.value.trim();
      if (!q) { closeResults(ep); return; }

      var local = localSuggestions(q);
      // A coordinate is an answer, not a query: offer it immediately and do
      // not spend a Nominatim call on it.
      if (local.length && local[0].kind === "coord") { renderResults(ep, local); return; }
      if (q.length < 3) { renderResults(ep, local); return; }

      var mySeq = ++ep.seq;
      var near = map ? { lat: map.getCenter().lat, lon: map.getCenter().lng } : null;
      RC.geocode.search(q, { limit: 6, near: near }).then(function (places) {
        if (mySeq !== ep.seq) return;
        renderResults(ep, local.concat(places || []));
      }, function () {
        if (mySeq !== ep.seq) return;
        renderResults(ep, local);
      });
    }, 320);

    inputEl.addEventListener("input", function () { ep.place = null; run(); });
    inputEl.addEventListener("focus", function () { if (ep.items.length) resultsEl.hidden = false; });
    inputEl.addEventListener("keydown", function (e) {
      if (resultsEl.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        ep.active = RC.clamp(ep.active + (e.key === "ArrowDown" ? 1 : -1), 0, ep.items.length - 1);
        highlight(ep);
      } else if (e.key === "Enter" && ep.active >= 0) {
        e.preventDefault();
        choose(ep, ep.items[ep.active]);
      } else if (e.key === "Escape") {
        closeResults(ep);
      }
    });
    inputEl.addEventListener("blur", function () {
      setTimeout(function () { closeResults(ep); }, 160);
    });
    return ep;
  }

  /* The rows that cost nothing: a coordinate the text already is, and the
     marks whose names match it. Both go above the search results, because
     both are exact and the search results are opinions. */
  function localSuggestions(q) {
    var out = [];
    var c = RC.coords.parse(q);
    if (c) {
      var mark = RC.marks.nearest(c.lat, c.lon, 40);
      out.push({
        name: mark ? mark.name : RC.coords.format(c.lat, c.lon),
        address: mark ? "A mark at this coordinate" : "Use this exact coordinate",
        lat: c.lat, lon: c.lon, precise: true, kind: "coord"
      });
    }
    var marks = RC.marks.find(q, 4);
    for (var i = 0; i < marks.length; i++) {
      var p = RC.marks.toPlace(marks[i]);
      p.kind = "mark";
      out.push(p);
    }
    return out;
  }

  function renderResults(ep, places) {
    ep.items = places || [];
    ep.active = -1;
    if (!ep.items.length) { closeResults(ep); return; }
    var html = "";
    for (var i = 0; i < ep.items.length; i++) {
      var p = ep.items[i];
      var tag = p.kind === "coord"
        ? '<span class="rc-result-tag is-coord">exact</span>'
        : (p.kind === "mark" ? '<span class="rc-result-tag">mark</span>' : "");
      html += '<li class="rc-result" data-i="' + i + '" role="option">' +
                '<span class="rc-result-name">' + RC.escapeHtml(p.name) + tag + "</span>" +
                '<span class="rc-result-addr">' + RC.escapeHtml(p.address || "") + "</span>" +
              "</li>";
    }
    ep.resultsEl.innerHTML = html;
    ep.resultsEl.hidden = false;
    ep.resultsEl.onmousedown = function (e) {
      var li = e.target.closest ? e.target.closest(".rc-result") : null;
      if (!li) return;
      e.preventDefault();
      choose(ep, ep.items[+li.getAttribute("data-i")]);
    };
  }

  function highlight(ep) {
    var nodes = ep.resultsEl.querySelectorAll(".rc-result");
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle("is-active", i === ep.active);
    if (nodes[ep.active] && nodes[ep.active].scrollIntoView) {
      nodes[ep.active].scrollIntoView({ block: "nearest" });
    }
  }

  function choose(ep, place) {
    if (!place) return;
    ep.place = place;
    ep.inputEl.value = place.name;
    if (place.markId) RC.marks.touch(place.markId);
    closeResults(ep);
    drawEndpoints();
    saveTrip();
    renderDock();
  }

  function closeResults(ep) {
    ep.resultsEl.hidden = true;
    ep.items = [];
    ep.active = -1;
  }

  /* Pins that were already on the map stay put when the set is redrawn;
     only a pin that is genuinely new drops in. Without the memory, choosing
     a destination made the start pin bounce as well, which reads as the
     start having changed. */
  var drawnPins = {};

  function drawEndpoints() {
    endpointLayer.clearLayers();
    var pts = [];
    var nowPins = {};
    for (var i = 0; i < state.endpoints.length; i++) {
      var ep = state.endpoints[i];
      if (!ep.place) continue;
      var isFirst = i === 0, isLast = i === state.endpoints.length - 1;
      var pinKey = (isFirst ? "s" : isLast ? "e" : "m") + ep.place.lat.toFixed(5) + "," + ep.place.lon.toFixed(5);
      nowPins[pinKey] = true;
      var cls = "rc-marker rc-marker-pin " + (isFirst ? "rc-marker-start" : isLast ? "rc-marker-end" : "rc-marker-stop") +
        (drawnPins[pinKey] ? "" : " is-new");
      var icon = L.divIcon({
        className: "",
        html: '<span class="' + cls + '">' + RC.icons.ui(isLast && !isFirst ? "flag" : "pin") + "</span>",
        iconSize: [30, 30],
        iconAnchor: [15, 28]
      });
      L.marker([ep.place.lat, ep.place.lon], { icon: icon, title: ep.place.name }).addTo(endpointLayer);
      pts.push([ep.place.lat, ep.place.lon]);
    }
    drawnPins = nowPins;
    if (pts.length && !state.routes.length && state.mode === "plan") {
      flyToBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 13 });
    }
  }

  /* Every planning-screen camera move that is the app's own idea goes
     through here: a flight rather than a jump, so the eye can follow where
     the map went — and a jump anyway when the flight would be a slideshow,
     or the rider asked for less motion or less battery. */
  function flyToBounds(bounds, opts) {
    opts = opts || {};
    RC.follow.silently(function () {
      if (quietMotion()) { map.fitBounds(bounds, { maxZoom: opts.maxZoom }); return; }
      map.flyToBounds(bounds, { maxZoom: opts.maxZoom, duration: opts.duration || 0.85, easeLinearity: 0.35 });
    });
  }

  function quietMotion() {
    if (RC.power && RC.power.saving()) return true;
    try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (e) { return false; }
  }

  /* Marks on the map. Small, quiet and only in planning mode: a screen full
     of your own pins is not what you want to see at 80 km/h. */
  function drawMarks() {
    if (!markLayer) return;
    markLayer.clearLayers();
    if (state.mode !== "plan") return;
    var items = RC.marks.list();
    for (var i = 0; i < items.length; i++) {
      (function (m) {
        var icon = L.divIcon({
          className: "",
          html: '<span class="rc-marker rc-marker-pin rc-marker-mark">' + RC.icons.ui("pin") + "</span>",
          iconSize: [24, 24],
          iconAnchor: [12, 22]
        });
        var marker = L.marker([m.lat, m.lon], { icon: icon, title: m.name, opacity: 0.75 });
        marker.on("click", function () {
          setEndpointFromLatLon(lastEmptyEndpoint(), m.lat, m.lon, { name: m.name, address: m.address, skipReverse: true });
        });
        marker.addTo(markLayer);
      })(items[i]);
    }
  }

  /* ---------------------------------------------------------
     Stops
     --------------------------------------------------------- */
  function addStop() {
    var wrap = RC.el("stops");
    var row = document.createElement("div");
    row.className = "rc-stop-row";
    var id = "stop-" + Date.now() + "-" + Math.round(Math.random() * 1000);
    row.innerHTML =
      '<div class="rc-field-group">' +
        '<div class="rc-input-row">' +
          '<span class="rc-input-dot" aria-hidden="true"></span>' +
          '<input type="text" class="rc-input" id="' + id + '" placeholder="Stop along the way" autocomplete="off" spellcheck="false" />' +
          '<button type="button" class="rc-inputbtn rc-stop-pick" aria-label="Pick on map" title="Pick on map">' + RC.icons.ui("pin") + "</button>" +
        "</div>" +
        '<ul class="rc-results" id="' + id + '-results" hidden></ul>' +
      "</div>" +
      '<button type="button" class="rc-stop-remove" aria-label="Remove this stop">' + RC.icons.ui("close") + "</button>";
    wrap.appendChild(row);

    var ep = makeEndpoint("stop", row.querySelector("input"), row.querySelector(".rc-results"));
    state.endpoints.splice(state.endpoints.length - 1, 0, ep);

    var pickBtn = row.querySelector(".rc-stop-pick");
    pickBtn.addEventListener("click", function () { openPicker(ep, "Set this stop", pickBtn); });

    row.querySelector(".rc-stop-remove").addEventListener("click", function () {
      var idx = state.endpoints.indexOf(ep);
      if (idx > -1) state.endpoints.splice(idx, 1);
      wrap.removeChild(row);
      drawEndpoints();
    });
    return ep;
  }

  /* ---------------------------------------------------------
     Planning
     --------------------------------------------------------- */
  function departureDate() {
    if (state.departMode === "custom") {
      var v = RC.el("depart-at").value;
      if (v) {
        var d = new Date(v);
        if (!isNaN(d.getTime())) return d;
      }
    }
    return new Date();
  }

  function resolveEndpoints() {
    var jobs = [];
    for (var i = 0; i < state.endpoints.length; i++) {
      (function (ep) {
        if (ep.place) { jobs.push(Promise.resolve(ep.place)); return; }
        var q = ep.inputEl.value.trim();
        if (!q) { jobs.push(Promise.resolve(null)); return; }

        // A coordinate needs no network and no interpretation.
        var c = RC.coords.parse(q);
        if (c) {
          var mark = RC.marks.nearest(c.lat, c.lon, 40);
          ep.place = {
            name: mark ? mark.name : RC.coords.format(c.lat, c.lon),
            address: mark ? (mark.address || "") : RC.coords.format(c.lat, c.lon),
            lat: c.lat, lon: c.lon, precise: true
          };
          ep.inputEl.value = ep.place.name;
          jobs.push(Promise.resolve(ep.place));
          return;
        }

        // A mark whose name is exactly what was typed is not ambiguous.
        var marks = RC.marks.find(q, 5);
        for (var m = 0; m < marks.length; m++) {
          if (marks[m].name.toLowerCase() === q.toLowerCase()) {
            ep.place = RC.marks.toPlace(marks[m]);
            RC.marks.touch(marks[m].id);
            jobs.push(Promise.resolve(ep.place));
            return;
          }
        }

        /* Free text. One hit is an answer; several are a question, and
           answering it by silently taking the first is how a rider ends up
           at the wrong Poblacion. Show them and stop. */
        jobs.push(RC.geocode.search(q, { limit: 5 }).then(function (places) {
          if (!places || !places.length) throw RC.error('Could not find "' + q + '".', "geocode");
          if (places.length === 1) {
            ep.place = places[0];
            ep.inputEl.value = places[0].name;
            return places[0];
          }
          renderResults(ep, localSuggestions(q).concat(places));
          try { ep.inputEl.focus(); } catch (e) {}
          throw RC.error('Several places match "' + q + '" — pick the one you mean.', "input");
        }));
      })(state.endpoints[i]);
    }
    return Promise.all(jobs).then(function (places) {
      var used = places.filter(function (p) { return !!p; });
      if (used.length < 2) throw RC.error("Give me a start and a destination.", "input");
      return used;
    });
  }

  function plan(e) {
    if (e) e.preventDefault();
    var token = ++state.planToken;
    if (activeRequest) activeRequest.abort();
    activeRequest = ("AbortController" in window) ? new AbortController() : null;
    var signal = activeRequest ? activeRequest.signal : undefined;

    setStatus("Finding your places…", "busy");
    RC.el("plan-btn").disabled = true;

    resolveEndpoints()
      .then(function (places) {
        if (token !== state.planToken) return null;
        drawEndpoints();
        setStatus("Drawing the route…", "busy");
        return RC.router.route(places, {
          vehicle: state.vehicle,
          alternatives: true,
          avoidMotorways: state.avoidMotorways,
          signal: signal
        });
      })
      .then(function (routes) {
        if (token !== state.planToken || !routes) return null;

        var depart = departureDate();
        state.departAt = depart;

        /* Two passes before anything is drawn. First: rank by how much of
           each line runs over roads this rider has actually used — only when
           it is meaningfully more familiar AND not meaningfully slower.
           Second: calibrate the timings, because the checkpoint ETAs are the
           hours the forecast gets read at. */
        routes = RC.history.rankRoutes(routes, state.vehicle);
        state.preferredByHistory = !!routes.preferredByHistory;

        var calibrated = [];
        for (var i = 0; i < routes.length; i++) {
          calibrated.push(RC.eta.plan(routes[i], depart, state.vehicle).route);
        }
        state.routes = calibrated;
        state.routeIndex = 0;
        return loadWeatherFor(calibrated[0], token, signal);
      })
      .then(function () {
        if (token !== state.planToken) return;
        RC.el("plan-btn").disabled = false;
      })
      .catch(function (err) {
        if (token !== state.planToken) return;
        RC.el("plan-btn").disabled = false;
        if (err && err.kind === "abort") return;
        setStatus(err && err.message ? err.message : "Something went wrong.", "error");
      });
  }

  function loadWeatherFor(route, token, signal) {
    var depart = departureDate();
    state.departAt = depart;
    state.calibration = route.calibration || null;
    var sampleOpts = { departAt: depart };
    if (state.interval !== "auto") sampleOpts.everyKm = parseInt(state.interval, 10);
    var checkpoints = RC.sampler.sample(route, sampleOpts);
    setStatus("Reading the sky at " + checkpoints.length + " points along the way…", "busy");

    loadElevation(route, token);

    return RC.weather.forecastSeries(checkpoints, { signal: signal }).then(function (series) {
      if (token !== state.planToken) return;
      state.series = series;
      for (var i = 0; i < checkpoints.length; i++) {
        checkpoints[i].wx = RC.weather.sampleSeries(series, i, checkpoints[i].eta);
      }
      state.checkpoints = checkpoints;
      state.trip = RC.risk.trip(checkpoints, state.vehicle);
      state.traffic = RC.traffic.forecast(checkpoints, state.vehicle);
      state.selected = -1;
      labelCheckpoints();
      render();
      setStatus("", "");
      return departureOptions(token);
    });
  }

  /* Terrain — one Open-Meteo elevation request per route, cached by
     coordinate. Failure is silent by design. */
  function loadElevation(route, token) {
    var myToken = ++state.elevToken;
    state.profile = null;
    renderElevation();
    RC.elevation.profile(route).then(function (profile) {
      if (myToken !== state.elevToken || token !== state.planToken) return;
      state.profile = profile;
      renderElevation();
      renderFacts();
      if (RC.nav.isActive()) RC.nav.setProfile(profile);
    }, function () {
      if (myToken !== state.elevToken) return;
      state.profile = null;
      renderElevation();
    });
  }

  function labelCheckpoints() {
    var cps = state.checkpoints;
    if (!cps.length) return;
    var first = state.endpoints[0], last = state.endpoints[state.endpoints.length - 1];
    cps[0].label = first && first.place ? first.place.name : "Start";
    cps[cps.length - 1].label = last && last.place ? last.place.name : "Destination";
    for (var i = 1; i < cps.length - 1; i++) {
      cps[i].label = RC.fmtDist(cps[i].distance, state.units) + " in";
    }
  }

  function departureOptions(token) {
    var route = state.routes[state.routeIndex];
    if (!state.series || !state.checkpoints.length || !route) return;

    var sample = function (distanceMeters, date) {
      var cps = state.checkpoints, best = 0, bestGap = Infinity;
      for (var i = 0; i < cps.length; i++) {
        var gap = Math.abs(cps[i].distance - distanceMeters);
        if (gap < bestGap) { bestGap = gap; best = i; }
      }
      return RC.weather.sampleSeries(state.series, best, date);
    };

    return Promise.resolve(
      RC.risk.bestDeparture(route, state.departAt, state.vehicle, sample)
    ).then(function (options) {
      if (token !== state.planToken) return;
      renderDeparture(options);
    }, function () { /* the planner is a bonus */ });
  }

  /* ---------------------------------------------------------
     Rendering
     --------------------------------------------------------- */
  function render() {
    var empty = RC.el("empty-state");
    if (empty) empty.hidden = true;
    // A route on the screen is a ride about to start; the 3D engine can be
    // in the cache by then instead of downloading at the kerb.
    RC.layers.warm();
    drawRoute();
    drawWeatherMarkers();
    renderSummary();
    renderFacts();
    renderElevation();
    renderAlternatives();
    renderTimeline();
    renderDetails();
    renderDock();
    renderSavedRoutes();
    renderHistoryPanel();
    updateMapControls();
    // A plan that lands while the planner is open should show its answer,
    // not leave the rider looking at the form they just submitted.
    if (isPanelOpen() && !RC.el("pane-route").hidden) selectTab("trip");
  }

  function levelOf(cp) {
    if (!cp || !cp.wx) return "clear";
    return RC.risk.score(cp.wx, state.vehicle).level;
  }

  var themeCache = null;

  function themeColors() {
    if (themeCache) return themeCache;
    var cs = getComputedStyle(document.documentElement);
    function v(name, fallback) {
      var got = cs.getPropertyValue(name);
      got = got && got.trim();
      return got || fallback;
    }
    themeCache = {
      clear:   v("--rc-clear", "#3F8F63"),
      watch:   v("--rc-watch", "#B8892A"),
      caution: v("--rc-caution", "#C9702F"),
      danger:  v("--rc-danger", "#B03434"),
      accent:  v("--matcha", "#4F7A38"),
      casing:  v("--ink", "#1A2018"),
      ghost:   v("--faint", "#939C8A"),
      planned: v("--rc-planned", "#4B5BC4")
    };
    return themeCache;
  }

  function forgetThemeColors() { themeCache = null; }

  function colorFor(level) {
    var c = themeColors();
    return c[level] || c.clear;
  }

  function drawRoute(opts) {
    for (var i = 0; i < routeLayers.length; i++) map.removeLayer(routeLayers[i]);
    routeLayers = [];
    var route = state.routes[state.routeIndex];
    if (!route) { RC.layers.sync(); return; }

    for (var a = 0; a < state.routes.length; a++) {
      if (a === state.routeIndex) continue;
      (function (idx) {
        var ghost = L.polyline(state.routes[idx].coords, {
          color: themeColors().ghost, weight: 5, opacity: 0.45, interactive: true
        }).addTo(map);
        ghost.on("click", function () { selectRoute(idx); });
        routeLayers.push(ghost);
      })(a);
    }

    var casing = L.polyline(route.coords, { color: themeColors().casing, weight: 9, opacity: 0.18 }).addTo(map);
    routeLayers.push(casing);
    var drawn = [casing];
    var cps = state.checkpoints;
    if (cps.length < 2) {
      var plain = L.polyline(route.coords, { color: themeColors().accent, weight: 5 }).addTo(map);
      routeLayers.push(plain);
      drawn.push(plain);
    } else {
      for (var c = 0; c < cps.length - 1; c++) {
        var seg = route.coords.slice(cps[c].i, cps[c + 1].i + 1);
        if (seg.length < 2) continue;
        var la = levelOf(cps[c]), lb = levelOf(cps[c + 1]);
        var rank = { clear: 0, watch: 1, caution: 2, danger: 3 };
        var worse = rank[lb] > rank[la] ? lb : la;
        var part = L.polyline(seg, { color: colorFor(worse), weight: 5, opacity: 0.95 }).addTo(map);
        routeLayers.push(part);
        drawn.push(part);
      }
    }
    // The 3D view mirrors these very polylines, so it only needs telling
    // that they changed.
    RC.layers.sync();
    if (!opts || opts.fit !== false) {
      /* A new route: the camera goes to it first, and only once it has
         arrived does the line draw itself on, start to finish, with the
         weather chips appearing as the line reaches each one. In that order
         because Leaflet re-projects every path when a move ends, and a line
         half-way through drawing on would be measured against the old one. */
      var bounds = L.latLngBounds(route.coords).pad(0.12);
      if (quietMotion() || state.mode !== "plan") {
        flyToBounds(bounds);
      } else {
        prepareDrawOn(drawn);
        var started = false;
        var go = function () { if (started) return; started = true; drawOn(drawn); };
        map.once("moveend", function () { setTimeout(go, 30); });
        setTimeout(go, 1300);   // a route that already fits produces no move at all
        flyToBounds(bounds);
      }
    }
  }

  /* ---------- a route drawing itself on ----------
     SVG paths with their dash pattern set to their own length and offset by
     all of it are invisible; easing the offset to zero draws them. Each
     stretch starts when the one before it has finished, so the line runs
     from the start pin to the flag in one stroke. The styles are removed
     afterwards: a dash pattern measured at one zoom is wrong at every other. */
  var DRAW_ON_MS = 1150;

  function pathsOf(layers) {
    var out = [];
    for (var i = 0; i < layers.length; i++) {
      var p = layers[i] && layers[i]._path;
      if (p && p.getTotalLength) out.push(p);
    }
    return out;
  }

  function prepareDrawOn(layers) {
    clearDrawOn();
    chipIntro = "wait";
    var paths = pathsOf(layers);
    for (var i = 0; i < paths.length; i++) paths[i].style.opacity = "0";
  }

  function drawOn(layers) {
    if (drawOnTimer) { clearTimeout(drawOnTimer); drawOnTimer = null; }
    // A plan replaced before its opening finished: the old line is gone.
    if (!layers.length || !map.hasLayer(layers[0])) return;
    var paths = pathsOf(layers);
    if (!paths.length) { clearDrawOn(); return; }
    // The casing is the first layer; it fades in under the line rather than
    // racing it.
    var casing = paths[0], parts = paths.slice(1);
    var lens = [], total = 0;
    for (var i = 0; i < parts.length; i++) {
      var len = 0;
      try { len = parts[i].getTotalLength(); } catch (e) { len = 0; }
      lens.push(len);
      total += len;
    }
    casing.style.transition = "opacity " + (DRAW_ON_MS * 0.8) + "ms ease";
    casing.style.opacity = "";
    if (!(total > 0)) { clearDrawOn(); return; }
    var acc = 0;
    for (var j = 0; j < parts.length; j++) {
      var p = parts[j], l = lens[j];
      p.style.transition = "none";
      p.style.strokeDasharray = l + " " + l;
      p.style.strokeDashoffset = String(l);
      p.style.opacity = "";
    }
    void (parts[0] && parts[0].getBoundingClientRect());
    for (var k = 0; k < parts.length; k++) {
      var delay = acc / total * DRAW_ON_MS, dur = Math.max(40, lens[k] / total * DRAW_ON_MS);
      acc += lens[k];
      parts[k].style.transition = "stroke-dashoffset " + dur.toFixed(0) + "ms linear " + delay.toFixed(0) + "ms";
      parts[k].style.strokeDashoffset = "0";
    }
    chipIntro = "pop";
    redrawChips();
    // Any zoom re-projects the paths, and a dash measured against the old
    // ones is wrong; the line is simply shown whole instead.
    map.once("zoomstart", clearDrawOn);
    map.once("zoomend", clearDrawOn);
    drawOnTimer = setTimeout(clearDrawOn, DRAW_ON_MS + 120);
  }

  function clearDrawOn() {
    if (drawOnTimer) { clearTimeout(drawOnTimer); drawOnTimer = null; }
    var hadIntro = chipIntro != null;
    chipIntro = null;
    var paths = pathsOf(routeLayers);
    for (var i = 0; i < paths.length; i++) {
      var s = paths[i].style;
      s.transition = ""; s.strokeDasharray = ""; s.strokeDashoffset = ""; s.opacity = "";
    }
    if (hadIntro) redrawChips();
  }

  function drawWeatherMarkers() {
    dotLayer.clearLayers();
    var cps = state.checkpoints;
    for (var i = 0; i < cps.length; i++) {
      (function (cp, idx) {
        var level = levelOf(cp);
        var html = '<span class="rc-dot is-' + level + (idx === state.selected ? " is-selected" : "") + '"></span>';
        var m = L.marker([cp.lat, cp.lon], {
          icon: L.divIcon({ className: "", html: html, iconSize: [10, 10], iconAnchor: [5, 5] }),
          zIndexOffset: 200 + idx,
          keyboard: false
        });
        m.on("click", function () { selectCheckpoint(idx); });
        m.addTo(dotLayer);
      })(cps[i], i);
    }
    redrawChips();
  }

  function chipLift(i, total) {
    return (i === 0 || i === total - 1) ? PIN_LIFT : 0;
  }

  function declutterIndices(cps) {
    var kept = [];
    if (!map || !cps.length) return kept;

    function boxAt(cp, i) {
      var pt = map.latLngToContainerPoint([cp.lat, cp.lon]);
      var y = pt.y - chipLift(i, cps.length);
      return {
        l: pt.x - CHIP_W / 2 - CHIP_GAP,
        r: pt.x + CHIP_W / 2 + CHIP_GAP,
        t: y - CHIP_H - CHIP_GAP,
        b: y + CHIP_GAP
      };
    }
    function hits(a, b) { return !(a.r < b.l || a.l > b.r || a.b < b.t || a.t > b.b); }

    var boxes = [];
    function place(i) {
      var box = boxAt(cps[i], i);
      for (var n = 0; n < boxes.length; n++) if (hits(box, boxes[n])) return false;
      kept.push(i);
      boxes.push(box);
      return true;
    }

    place(0);
    for (var i = 1; i < cps.length - 1; i++) place(i);

    if (cps.length > 1) {
      var last = cps.length - 1;
      var lastBox = boxAt(cps[last], last);
      for (var k = kept.length - 1; k > 0; k--) {
        if (hits(lastBox, boxes[k])) { kept.splice(k, 1); boxes.splice(k, 1); }
      }
      kept.push(last);
      boxes.push(lastBox);
    }

    kept.sort(function (a, b) { return a - b; });
    return kept;
  }

  function redrawChips() {
    if (!chipLayer) return;
    chipLayer.clearLayers();
    var cps = state.checkpoints;
    if (!cps.length || !map) return;
    var keep = declutterIndices(cps);
    var route = state.routes[state.routeIndex];
    var total = (route && route.distance) || 1;
    for (var k = 0; k < keep.length; k++) {
      (function (cp, idx) {
        var level = levelOf(cp);
        var wx = cp.wx || {};
        var desc = wx.outOfRange ? { icon: "cloud" } : RC.weather.describe(wx.code, wx.isDay);
        /* While a new route is drawing itself on, each chip waits for the
           line to reach it and then pops up out of the road. */
        var intro = "", introStyle = "";
        if (chipIntro === "wait") intro = " is-wait";
        else if (chipIntro === "pop") {
          intro = " is-pop";
          introStyle = ' style="animation-delay:' + Math.round(RC.clamp(cp.distance / total, 0, 1) * DRAW_ON_MS) + 'ms"';
        }
        var html =
          '<div style="width:100%;height:100%;display:flex;align-items:flex-end;justify-content:center;">' +
            '<span class="rc-marker is-' + level + (idx === state.selected ? " is-selected" : "") + intro + '"' + introStyle + ">" +
              '<span class="rc-marker-icon">' + RC.icons.weather(desc.icon) + "</span>" +
              '<span class="rc-marker-temp">' + (wx.outOfRange ? "—" : RC.fmtTemp(wx.tempC, state.units)) + "</span>" +
              '<span class="rc-marker-stem"></span>' +
            "</span>" +
          "</div>";
        var m = L.marker([cp.lat, cp.lon], {
          icon: L.divIcon({
            className: "",
            html: html,
            iconSize: [CHIP_W, CHIP_H],
            iconAnchor: [CHIP_W / 2, CHIP_H + chipLift(idx, cps.length)]
          }),
          zIndexOffset: 500 + idx,
          keyboard: false
        });
        m.on("click", function () { selectCheckpoint(idx); });
        m.addTo(chipLayer);
      })(cps[keep[k]], keep[k]);
    }
  }

  function renderSummary() {
    var route = state.routes[state.routeIndex];
    var trip = state.trip;
    var box = RC.el("summary");
    if (!route || !trip) { box.hidden = true; return; }
    box.hidden = false;

    var arrival = new Date(state.departAt.getTime() + route.duration * 1000);
    RC.el("summary-dist").textContent = RC.fmtDist(route.distance, state.units);
    RC.el("summary-dur").textContent = RC.fmtDur(route.duration);
    RC.el("summary-eta").textContent = RC.fmtTime(arrival) + " · " + RC.fmtDay(arrival);

    var verdict = RC.el("summary-verdict");
    verdict.className = "rc-badge is-" + trip.level;
    verdict.textContent = RC.risk.LEVELS[trip.level].label;

    RC.el("summary-rain").textContent = trip.rainMinutes > 0
      ? "About " + RC.fmtDur(trip.rainMinutes * 60) + " of this ride is in the wet."
      : "No precipitation expected on the way.";

    var etaNote = RC.el("summary-eta-note");
    if (etaNote) etaNote.textContent = RC.eta.explain(state.calibration, state.vehicle);

    // Riders are legally barred from PH expressways — never silently pretend
    // the avoidance worked (or did not) when it is not true.
    var notes = [];
    if (state.avoidMotorways) {
      if (route.motorwayAvoidanceFailed) {
        notes.push(route.motorwayAvoidanceReason === "no-route"
          ? "No expressway-free route exists between these points — this route may use expressways, which motorcycles cannot legally ride in the Philippines."
          : "The routing server could not exclude expressways, so RouteCast picked the offered line that spends the fewest kilometres on one — check the signage yourself and take the surface roads.");
      } else if (route.avoidedMotorways) {
        notes.push(route.excludeApplied === "motorway,toll"
          ? "Expressways and toll roads both excluded — the strictest exclusion the router accepted."
          : "Expressways avoided — this route asked the router to keep off motorway-class roads.");
      }
      var named = route.expresswayNames || [];
      if (named.length) {
        notes.push("This route still names " + named.slice(0, 3).join(", ") +
          " — motorcycles are barred from Philippine expressways, so treat that stretch as a road to leave before, not to ride.");
      }
    }

    if (state.preferredByHistory && route.familiarity && route.familiarity.score > 0) {
      notes.push("Chosen over the fastest line because " +
        Math.round(route.familiarity.score * 100) + "% of it runs on roads you have already ridden.");
    }

    // Night falling part-way through is the one daylight fact worth a line.
    var light = daylight();
    if (light && light.darkMin >= 10 && !light.allDark && light.change && light.change.kind === "sunset") {
      notes.push("Sunset catches you" + (light.change.at ? " at " + RC.fmtTime(light.change.at) : "") +
        " — the last " + RC.fmtDur(light.darkMin * 60) + " is after dark." +
        (state.vehicle === "motorcycle" ? " A clear visor and something reflective." : " Lights on before it does."));
    }

    var advice = notes.concat(trip.advice).concat(trip.reasons);
    var html = "";
    for (var i = 0; i < Math.min(advice.length, 7); i++) {
      html += '<li class="rc-advice">' + RC.escapeHtml(advice[i]) + "</li>";
    }
    RC.el("summary-advice").innerHTML = html;
  }

  function renderFacts() {
    var wrap = RC.el("trip-facts");
    if (!wrap) return;
    var route = state.routes[state.routeIndex];
    if (!route) { wrap.innerHTML = ""; return; }

    var facts = [];

    var worst = state.checkpoints.length ? RC.traffic.worst(state.checkpoints, state.vehicle) : null;
    if (worst) {
      facts.push({ k: "Traffic", v: worst.label, sub: "worst around " + RC.fmtTime(worst.at), level: trafficLevelClass(worst.level) });
    } else if (state.checkpoints.length) {
      facts.push({ k: "Traffic", v: "Free flowing", sub: "all the way", level: "clear" });
    }

    if (state.profile) {
      facts.push({ k: "Climb", v: "+" + RC.fmtDist(state.profile.climbM, state.units) });
      facts.push({ k: "Descent", v: "-" + RC.fmtDist(state.profile.descentM, state.units) });
      facts.push({ k: "Highest", v: RC.fmtDist(Math.round(state.profile.maxM), state.units) });
    }

    if (route.expresswayM != null) {
      facts.push({
        k: "Expressway",
        v: route.expresswayM > 0 ? RC.fmtDist(route.expresswayM, state.units) : "None found",
        sub: route.expresswayM > 0 ? "named in the steps" : "by name, not by promise",
        level: route.expresswayM > 0 ? (state.avoidMotorways ? "danger" : "watch") : "clear"
      });
    }

    var fam = route.familiarity;
    if (fam && fam.totalM > 0) {
      facts.push({
        k: "Roads you know",
        v: Math.round(fam.score * 100) + "%",
        sub: fam.knownM > 0 ? RC.fmtDist(fam.knownM, state.units) + " ridden before" : "all new to you"
      });
    }

    var light = daylight();
    if (light) {
      if (light.darkMin === 0) {
        facts.push({ k: "Daylight", v: "All the way", level: "clear",
          sub: light.after && light.after.kind === "sunset" ? "sunset " + RC.fmtTime(light.after.at) : "no dark stretch" });
      } else if (light.allDark) {
        facts.push({ k: "Daylight", v: "After dark", level: state.vehicle === "motorcycle" ? "watch" : null,
          sub: light.after && light.after.kind === "sunrise" ? "sunrise " + RC.fmtTime(light.after.at) : "the whole ride" });
      } else {
        facts.push({ k: "Daylight", v: RC.fmtDur(light.darkMin * 60) + " dark", level: "watch",
          sub: light.change ? light.change.kind + (light.change.at ? " " + RC.fmtTime(light.change.at) : "") : "" });
      }
    }

    var avg = route.duration > 0 ? (route.distance / route.duration) * 3.6 : 0;
    facts.push({ k: "Door to door", v: RC.fmtSpeed(avg, state.units), sub: "average, stops included" });

    var html = "";
    for (var i = 0; i < facts.length; i++) {
      var f = facts[i];
      html += '<div class="rc-fact' + (f.level ? " is-" + f.level : "") + '">' +
                '<span class="rc-fact-k">' + RC.escapeHtml(f.k) + "</span>" +
                '<span class="rc-fact-v">' + RC.escapeHtml(f.v) + "</span>" +
                (f.sub ? '<span class="rc-fact-sub">' + RC.escapeHtml(f.sub) + "</span>" : "") +
              "</div>";
    }
    wrap.innerHTML = html;
  }

  function trafficLevelClass(level) {
    return { free: "clear", moderate: "watch", heavy: "caution", severe: "danger" }[level] || "clear";
  }

  /* ---------------------------------------------------------
     Daylight, and the wind against the road

     Both are read off the forecast already in memory: the sunrise and
     sunset times come back in the same request as the weather (see
     weather.js), and the wind's direction is one more hourly field. Neither
     costs a request of its own.
     --------------------------------------------------------- */
  function darkAt(i) {
    var cp = state.checkpoints[i];
    if (!cp) return null;
    var s = state.series && state.series.sun ? state.series.sun(i, cp.eta) : null;
    if (s && s.dark != null) return s.dark;
    // No sun timeline (an older cached series, a stub): the hourly flag.
    return cp.wx && !cp.wx.outOfRange ? !cp.wx.isDay : null;
  }

  /* How much of the ride is in the dark, where the light changes, and what
     the sun does next after arrival. Legs are charged by their own travel
     time, and a leg that crosses sunset counts half — the same trick the
     rain estimate uses, for the same reason. */
  function daylight() {
    var cps = state.checkpoints;
    if (!cps.length || !state.series) return null;
    var darks = [], known = 0;
    for (var i = 0; i < cps.length; i++) { darks.push(darkAt(i)); if (darks[i] != null) known++; }
    if (!known) return null;
    var darkS = 0, totalS = 0, change = null;
    for (var j = 0; j < cps.length - 1; j++) {
      var a = darks[j], b = darks[j + 1];
      if (a == null || b == null) continue;
      var leg = Math.max(0, (cps[j + 1].etaSeconds || 0) - (cps[j].etaSeconds || 0));
      totalS += leg;
      darkS += (a && b) ? leg : (a || b) ? leg / 2 : 0;
      if (!change && a !== b) {
        var sn = state.series.sun ? state.series.sun(j, cps[j].eta) : null;
        change = (sn && sn.next && sn.next.at <= cps[j + 1].eta) ? sn.next : { at: null, kind: b ? "sunset" : "sunrise" };
      }
    }
    if (cps.length === 1) { totalS = 1; darkS = darks[0] ? 1 : 0; }
    var lastIdx = cps.length - 1;
    var after = state.series.sun ? state.series.sun(lastIdx, cps[lastIdx].eta).next : null;
    return {
      darkMin: Math.round(darkS / 60),
      allDark: totalS > 0 && darkS >= totalS - 1 && darks[0] === true,
      change: change,
      after: after
    };
  }

  // The road's own bearing at a coordinate index, looking a few points ahead
  // so one kinked vertex does not swing it.
  function roadBearingAt(route, i) {
    var c = route && route.coords;
    if (!c || c.length < 2) return null;
    var a = Math.max(0, Math.min(i, c.length - 2));
    var b = Math.min(c.length - 1, a + 4);
    return RC.bearing({ lat: c[a][0], lon: c[a][1] }, { lat: c[b][0], lon: c[b][1] });
  }

  function windArrowHtml(rel, kmh) {
    return '<span class="rc-windarrow" style="transform:rotate(' + Math.round(rel + 180) + 'deg)">' +
      RC.icons.ui("arrow") + "</span><span>" + RC.escapeHtml(RC.fmtSpeed(kmh, state.units).split(" ")[0]) + "</span>";
  }

  function windLevel(gustKmh) {
    if (gustKmh == null) return null;
    if (state.vehicle === "motorcycle") return gustKmh > 60 ? "danger" : gustKmh > 45 ? "caution" : gustKmh > 30 ? "watch" : "clear";
    return gustKmh > 80 ? "caution" : gustKmh > 60 ? "watch" : "clear";
  }

  /* The ride profile — an inline SVG drawn from what is already in memory:
     the DEM samples for the shape of the ground, a band under it in the
     colour the forecast gave each stretch, and bars for the rain. One
     picture that answers "where is the climb, and is it wet up there". The
     point is the SHAPE of the ride; a finger along it reads any point. */
  var ELEV_W = 320, ELEV_H = 96, ELEV_PAD = 6;
  var ELEV_TOP = 4, ELEV_BASE = 62;          // the ground chart
  var BAND_Y = 67, BAND_H = 6;               // the forecast band
  var RAIN_BASE = 94, RAIN_MAX = 17;         // rain bars grow up from here

  function profileGeometry() {
    var route = state.routes[state.routeIndex];
    var p = state.profile;
    var hasElev = !!(p && p.points && p.points.length >= 2);
    var totalM = (route && route.distance) || (hasElev ? p.points[p.points.length - 1].distance : 0) || 1;
    var span = hasElev ? Math.max(p.maxM - p.minM, 40) : 1;
    var mid = hasElev ? (p.maxM + p.minM) / 2 : 0;
    var lo = mid - span / 2, hi = mid + span / 2;
    return {
      route: route, p: hasElev ? p : null, totalM: totalM,
      x: function (d) { return ELEV_PAD + (d / totalM) * (ELEV_W - ELEV_PAD * 2); },
      y: function (e) { return ELEV_BASE - ((e - lo) / (hi - lo)) * (ELEV_BASE - ELEV_TOP); },
      d: function (px) { return RC.clamp((px - ELEV_PAD) / (ELEV_W - ELEV_PAD * 2), 0, 1) * totalM; }
    };
  }

  function renderElevation() {
    var box = RC.el("elev-profile");
    if (!box) return;
    var g = profileGeometry();
    var cps = state.checkpoints;
    if (!g.route || (!g.p && cps.length < 2)) { box.hidden = true; box.innerHTML = ""; return; }
    var x = g.x, y = g.y;

    var ground = "";
    if (g.p) {
      var pts = g.p.points, line = "";
      for (var i = 0; i < pts.length; i++) {
        line += (i === 0 ? "M" : "L") + x(pts[i].distance).toFixed(1) + " " + y(pts[i].elevationM).toFixed(1);
      }
      var area = line + "L" + x(g.totalM).toFixed(1) + " " + ELEV_BASE + "L" + x(0).toFixed(1) + " " + ELEV_BASE + "Z";
      ground = '<path class="rc-elev-area" d="' + area + '"/><path class="rc-elev-line" d="' + line + '"/>';
    } else {
      ground = '<path class="rc-elev-flat" d="M' + x(0) + " " + ELEV_BASE + "L" + x(g.totalM) + " " + ELEV_BASE + '"/>';
    }

    var band = "", rain = "";
    for (var c = 0; c < cps.length - 1; c++) {
      var x0 = x(cps[c].distance), x1 = x(cps[c + 1].distance);
      if (!(x1 > x0)) continue;
      var la = levelOf(cps[c]), lb = levelOf(cps[c + 1]);
      var rank = { clear: 0, watch: 1, caution: 2, danger: 3 };
      band += '<rect class="rc-prof-band is-' + (rank[lb] > rank[la] ? lb : la) + '" x="' + x0.toFixed(1) +
              '" y="' + BAND_Y + '" width="' + (x1 - x0 + 0.4).toFixed(1) + '" height="' + BAND_H + '"/>';
      var wa = cps[c].wx, wb = cps[c + 1].wx;
      if (wa && wb && !wa.outOfRange && !wb.outOfRange) {
        var mm = (wa.precipMm + wb.precipMm) / 2;
        if (mm >= 0.05) {
          var h = Math.max(1.5, Math.min(1, mm / 6) * RAIN_MAX);
          rain += '<rect class="rc-prof-rain" x="' + (x0 + 0.6).toFixed(1) + '" y="' + (RAIN_BASE - h).toFixed(1) +
                  '" width="' + Math.max(0.8, x1 - x0 - 1.2).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1"/>';
        }
      }
    }

    var meta = g.p
      ? RC.fmtDist(Math.round(g.p.minM), state.units) + " – " + RC.fmtDist(Math.round(g.p.maxM), state.units)
      : "Weather along the way";
    var label = g.p
      ? "Ride profile: climbs " + RC.fmtDist(g.p.climbM, state.units) + ", descends " + RC.fmtDist(g.p.descentM, state.units)
      : "Weather along the ride";

    box.hidden = false;
    box.innerHTML =
      '<div class="rc-elev-head">' +
        '<span class="rc-elev-title">Profile</span>' +
        '<span class="rc-elev-meta">' + RC.escapeHtml(meta) + "</span>" +
      "</div>" +
      '<svg class="rc-elev-svg" viewBox="0 0 ' + ELEV_W + " " + ELEV_H +
        '" preserveAspectRatio="none" role="img" aria-label="' + RC.escapeHtml(label) + '">' +
        ground + band + rain +
        (navElevMarker(x, g.totalM) || "") +
        '<g class="rc-prof-cursor" visibility="hidden"><path class="rc-prof-cursor-line" d="M0 ' + ELEV_TOP +
          "L0 " + RAIN_BASE + '"/><circle class="rc-prof-cursor-dot" cx="0" cy="0" r="3.2"/></g>' +
      "</svg>" +
      '<p class="rc-prof-read" aria-live="polite">Slide along it to read any point.</p>';
  }

  var navDistanceAlong = 0;
  function navElevMarker(x, totalM) {
    if (!RC.nav.isActive() || !(navDistanceAlong > 0)) return null;
    var px = x(RC.clamp(navDistanceAlong, 0, totalM));
    return '<path class="rc-elev-here" d="M' + px.toFixed(1) + " " + ELEV_TOP +
           "L" + px.toFixed(1) + " " + ELEV_BASE + '"/>';
  }

  /* ---------- reading the profile with a finger ----------
     Drag along it and it says what is at that point: how far in, how high,
     when you get there and what the sky is doing — and a ring on the map
     shows where that is. Nothing is fetched; it is all interpolated from
     the route and the checkpoints already in memory. */
  var scrubMarker = null, scrubHideTimer = null;

  function pointAtDistance(route, d) {
    var cum = route.cumDist, c = route.coords;
    var lo = 0, hi = cum.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (cum[mid] < d) lo = mid + 1; else hi = mid; }
    var i = Math.max(1, lo);
    var span = cum[i] - cum[i - 1] || 1;
    var t = RC.clamp((d - cum[i - 1]) / span, 0, 1);
    return [c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t, c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t];
  }

  // When a point along the route is reached, from the checkpoints either side
  // of it — which navigation keeps re-timing, so this is the live answer.
  function etaAtDistance(d) {
    var cps = state.checkpoints;
    if (!cps.length) return null;
    for (var i = 0; i < cps.length - 1; i++) {
      if (d <= cps[i + 1].distance) {
        var span = cps[i + 1].distance - cps[i].distance || 1;
        var t = RC.clamp((d - cps[i].distance) / span, 0, 1);
        return new Date(cps[i].eta.getTime() + (cps[i + 1].eta.getTime() - cps[i].eta.getTime()) * t);
      }
    }
    return cps[cps.length - 1].eta;
  }

  function nearestCheckpoint(d) {
    var cps = state.checkpoints, best = -1, gap = Infinity;
    for (var i = 0; i < cps.length; i++) {
      var g = Math.abs(cps[i].distance - d);
      if (g < gap) { gap = g; best = i; }
    }
    return best;
  }

  function scrubAt(clientX) {
    var box = RC.el("elev-profile");
    var svg = box && box.querySelector(".rc-elev-svg");
    if (!svg) return;
    var g = profileGeometry();
    if (!g.route) return;
    var r = svg.getBoundingClientRect();
    if (!(r.width > 0)) return;
    var px = RC.clamp((clientX - r.left) / r.width, 0, 1) * ELEV_W;
    var d = g.d(px);
    var cx = g.x(d);

    var cursor = svg.querySelector(".rc-prof-cursor");
    var elev = g.p ? g.p.at(d) : null;
    if (cursor) {
      cursor.setAttribute("visibility", "visible");
      cursor.querySelector(".rc-prof-cursor-line").setAttribute("d", "M" + cx.toFixed(1) + " " + ELEV_TOP + "L" + cx.toFixed(1) + " " + RAIN_BASE);
      var dot = cursor.querySelector(".rc-prof-cursor-dot");
      dot.setAttribute("cx", cx.toFixed(1));
      dot.setAttribute("cy", (elev ? g.y(elev.elevationM) : ELEV_BASE).toFixed(1));
    }

    var bits = [RC.fmtDist(d, state.units) + " in"];
    if (elev) bits.push(RC.fmtDist(Math.round(elev.elevationM), state.units) + " up");
    var eta = etaAtDistance(d);
    if (eta) bits.push(RC.fmtTime(eta));
    var ci = nearestCheckpoint(d);
    var wx = ci > -1 ? state.checkpoints[ci].wx : null;
    if (wx && !wx.outOfRange) {
      bits.push(RC.fmtTemp(wx.tempC, state.units) + " " + RC.weather.describe(wx.code, wx.isDay).text.toLowerCase());
    }
    var read = box.querySelector(".rc-prof-read");
    if (read) read.textContent = bits.join(" · ");

    var ll = pointAtDistance(g.route, d);
    if (scrubHideTimer) { clearTimeout(scrubHideTimer); scrubHideTimer = null; }
    if (!scrubMarker) {
      scrubMarker = L.circleMarker(ll, {
        radius: 8, weight: 3, color: themeColors().accent, fillColor: "#FFFFFF", fillOpacity: 0.9,
        interactive: false, className: "rc-scrub-ring"
      }).addTo(map);
    } else {
      scrubMarker.setLatLng(ll);
    }
  }

  function endScrub() {
    if (scrubHideTimer) clearTimeout(scrubHideTimer);
    scrubHideTimer = setTimeout(function () {
      scrubHideTimer = null;
      if (scrubMarker) { map.removeLayer(scrubMarker); scrubMarker = null; }
      var box = RC.el("elev-profile");
      var cursor = box && box.querySelector(".rc-prof-cursor");
      if (cursor) cursor.setAttribute("visibility", "hidden");
    }, 1600);
  }

  function initProfileScrub() {
    var box = RC.el("elev-profile");
    if (!box) return;
    var down = false;
    box.addEventListener("pointerdown", function (e) {
      if (!e.target.closest || !e.target.closest(".rc-elev-svg")) return;
      down = true;
      try { box.setPointerCapture(e.pointerId); } catch (err) {}
      scrubAt(e.clientX);
    });
    box.addEventListener("pointermove", function (e) {
      // A mouse reads on hover; a finger only while it is down, or the page
      // could never be scrolled past the chart.
      if (down || e.pointerType === "mouse") {
        if (e.target.closest && e.target.closest(".rc-elev-svg")) scrubAt(e.clientX);
        else if (down) scrubAt(e.clientX);
      }
    });
    ["pointerup", "pointercancel"].forEach(function (ev) {
      box.addEventListener(ev, function () { down = false; endScrub(); });
    });
    box.addEventListener("pointerleave", function () { if (!down) endScrub(); });
  }

  function renderAlternatives() {
    var wrap = RC.el("alts");
    if (state.routes.length < 2) { wrap.innerHTML = ""; wrap.hidden = true; return; }
    wrap.hidden = false;
    var html = "";
    for (var i = 0; i < state.routes.length; i++) {
      var r = state.routes[i];
      var fam = r.familiarity;
      var tags = "";
      if (fam && fam.score >= 0.35) {
        tags += '<span class="rc-alt-tag">' + Math.round(fam.score * 100) + "% familiar</span>";
      }
      if (state.avoidMotorways) {
        tags += (r.expresswayM > 0)
          ? '<span class="rc-alt-tag is-danger">' + RC.escapeHtml(RC.fmtDist(r.expresswayM, state.units)) + " on " +
            RC.escapeHtml((r.expresswayNames && r.expresswayNames[0]) || "an expressway") + "</span>"
          : '<span class="rc-alt-tag is-clear">no expressway found</span>';
      }
      html += '<button type="button" class="rc-alt' + (i === state.routeIndex ? " is-active" : "") +
                '" data-i="' + i + '">' +
                '<span class="rc-alt-name">' + RC.escapeHtml(r.summary || ("Route " + (i + 1))) + "</span>" +
                '<span class="rc-alt-meta">' + RC.fmtDur(r.duration) + " · " + RC.fmtDist(r.distance, state.units) + "</span>" +
                (tags ? '<span class="rc-alt-tags">' + tags + "</span>" : "") +
              "</button>";
    }
    wrap.innerHTML = html;
  }

  function renderTimeline() {
    var wrap = RC.el("timeline");
    var cps = state.checkpoints;
    if (!cps.length) { wrap.innerHTML = ""; return; }
    var html = "";
    for (var i = 0; i < cps.length; i++) {
      var cp = cps[i], wx = cp.wx || {};
      var level = levelOf(cp);
      var desc = wx.outOfRange ? { icon: "cloud", text: "Beyond the forecast" } : RC.weather.describe(wx.code, wx.isDay);
      var meta = wx.outOfRange ? "no data"
        : Math.round(wx.precipProb) + "% · " + RC.fmtSpeed(wx.windKmh, state.units);
      html +=
        '<button type="button" class="rc-chip is-' + level + (i === state.selected ? " is-selected" : "") +
          '" data-i="' + i + '" title="' + RC.escapeHtml(desc.text) + '">' +
          '<span class="rc-chip-day">' + RC.fmtDay(cp.eta) + "</span>" +
          '<span class="rc-chip-time">' + RC.fmtTime(cp.eta) + "</span>" +
          '<span class="rc-chip-icon">' + RC.icons.weather(desc.icon) + "</span>" +
          '<span class="rc-chip-temp">' + (wx.outOfRange ? "—" : RC.fmtTemp(wx.tempC, state.units)) + "</span>" +
          '<span class="rc-chip-place">' + RC.escapeHtml(cp.label || "") + "</span>" +
          '<span class="rc-chip-meta">' + RC.escapeHtml(meta) + "</span>" +
        "</button>";
    }
    wrap.innerHTML = html;
  }

  function renderDeparture(options) {
    var wrap = RC.el("depart-planner");
    if (!options || !options.length) { wrap.innerHTML = ""; wrap.hidden = true; return; }
    wrap.hidden = false;
    var best = options[0];
    for (var b = 1; b < options.length; b++) if (options[b].score < best.score) best = options[b];

    var html = '<p class="rc-planner-label">Leaving later or earlier</p><div class="rc-planner-row">';
    for (var i = 0; i < options.length; i++) {
      var o = options[i];
      var label = o.offsetH === 0 ? "now" : (o.offsetH > 0 ? "+" + o.offsetH : String(o.offsetH)) + "h";
      html += '<button type="button" class="rc-offset is-' + o.level +
                (o.offsetH === 0 ? " is-active" : "") + (o === best && best.offsetH !== 0 ? " is-best" : "") +
                '" data-h="' + o.offsetH + '" title="Arrive ' + RC.escapeHtml(RC.fmtTime(o.eta)) + '">' +
                '<span class="rc-offset-dot"></span><span class="rc-offset-h">' + label + "</span>" +
              "</button>";
    }
    html += "</div>";
    if (best.offsetH !== 0 && best.score < (options.filter(function (o) { return o.offsetH === 0; })[0] || best).score - 8) {
      html += '<p class="rc-planner-hint">' + RC.icons.ui("clock") + " Leaving " +
              (best.offsetH > 0 ? best.offsetH + " h later" : Math.abs(best.offsetH) + " h earlier") +
              " looks noticeably kinder.</p>";
    }
    wrap.innerHTML = html;
  }

  function renderDetails() {
    var box = RC.el("details");
    var cp = state.checkpoints[state.selected];
    if (!cp) { box.hidden = true; box.innerHTML = ""; return; }
    var wx = cp.wx || {};
    box.hidden = false;

    if (wx.outOfRange) {
      box.innerHTML = "<h3>" + RC.escapeHtml(cp.label || "Checkpoint") + "</h3>" +
        '<p class="rc-empty">This point is further out than the free forecast reaches (16 days).</p>';
      return;
    }
    var desc = RC.weather.describe(wx.code, wx.isDay);
    var risk = RC.risk.score(wx, state.vehicle);

    var rows = [
      ["Arriving", RC.fmtTime(cp.eta) + " · " + RC.fmtDay(cp.eta)],
      ["Distance in", RC.fmtDist(cp.distance, state.units)],
      ["Sky", desc.text],
      ["Temperature", RC.fmtTemp(wx.tempC, state.units) + " (feels " + RC.fmtTemp(wx.feelsC, state.units) + ")"],
      ["Rain", wx.precipMm.toFixed(1) + " mm/h · " + Math.round(wx.precipProb) + "% chance"],
      ["Wind", RC.fmtSpeed(wx.windKmh, state.units) + ", gusting " + RC.fmtSpeed(wx.gustKmh, state.units)],
      ["Visibility", wx.visibilityM == null ? "—" : RC.fmtDist(wx.visibilityM, state.units)],
      ["Humidity", Math.round(wx.humidity) + "%"],
      ["Traffic", RC.traffic.LEVELS[RC.traffic.level(cp.eta)].label]
    ];
    /* Where the wind hits, which is the part of it a rider feels: the same
       gust is a shove in the back on one heading and a push into the next
       lane on another. */
    var rel = RC.risk.wind(wx.windDir, roadBearingAt(state.routes[state.routeIndex], cp.i), wx.gustKmh);
    if (rel) {
      rows.splice(5, 0, ["Wind hits", RC.risk.windWords(rel) +
        (rel.kind === "cross" ? " · " + RC.fmtSpeed(Math.abs(rel.crossKmh), state.units) + " gusts" : "")]);
    }
    var dark = darkAt(state.selected);
    if (dark != null) {
      var sun = state.series && state.series.sun ? state.series.sun(state.selected, cp.eta) : null;
      rows.push(["Light", (dark ? "After dark" : "Daylight") +
        (sun && sun.next ? " · " + sun.next.kind + " " + RC.fmtTime(sun.next.at) : "")]);
    }
    if (state.profile) {
      var terrain = state.profile.at(cp.distance);
      rows.push(["Elevation", RC.fmtDist(Math.round(terrain.elevationM), state.units) +
        " · " + (terrain.gradePct >= 0 ? "+" : "") + terrain.gradePct.toFixed(1) + "% grade"]);
    }
    var html = '<div class="rc-detail-head">' +
                 "<h3>" + RC.escapeHtml(cp.label || "Checkpoint") + "</h3>" +
                 '<span class="rc-badge is-' + risk.level + '">' + RC.risk.LEVELS[risk.level].label + "</span>" +
               "</div>" +
               '<div class="rc-detail-grid">';
    for (var i = 0; i < rows.length; i++) {
      html += '<div class="rc-detail-k">' + rows[i][0] + "</div>" +
              '<div class="rc-detail-v">' + RC.escapeHtml(rows[i][1]) + "</div>";
    }
    html += "</div>";
    if (risk.reasons.length) {
      html += "<ul>";
      for (var r = 0; r < risk.reasons.length; r++) html += '<li class="rc-reason">' + RC.escapeHtml(risk.reasons[r]) + "</li>";
      html += "</ul>";
    }
    if (risk.advice.length) {
      html += "<ul>";
      for (var a = 0; a < risk.advice.length; a++) html += '<li class="rc-advice">' + RC.escapeHtml(risk.advice[a]) + "</li>";
      html += "</ul>";
    }
    box.innerHTML = html;
  }

  /* ---------------------------------------------------------
     The dock
     --------------------------------------------------------- */
  function renderDock() {
    var primary = RC.el("dock-primary");
    var secondary = RC.el("dock-secondary");
    var badge = RC.el("dock-badge");
    var go = RC.el("dock-go");
    if (!primary || !secondary || !badge) return;

    var route = state.routes[state.routeIndex];
    var trip = state.trip;

    if (route && trip) {
      var arrival = new Date(state.departAt.getTime() + route.duration * 1000);
      primary.textContent = RC.fmtDist(route.distance, state.units) + " · " + RC.fmtDur(route.duration);
      secondary.textContent = "Arrive " + RC.fmtTime(arrival) +
        (route.summary ? " · " + route.summary : "");
      badge.className = "rc-badge is-" + trip.level;
      badge.textContent = RC.risk.LEVELS[trip.level].label;
      if (go) {
        // A route that has just become rideable says so, once: two soft rings
        // round Go, the button the rider is about to want.
        if (go.hidden) {
          go.hidden = false;
          go.classList.remove("is-ready");
          void go.offsetWidth;
          go.classList.add("is-ready");
        }
      }
    } else {
      var from = state.endpoints[0] && state.endpoints[0].place;
      var to = state.endpoints[state.endpoints.length - 1] && state.endpoints[state.endpoints.length - 1].place;
      primary.textContent = to ? to.name : "Where to?";
      secondary.textContent = to
        ? (from ? "from " + from.name : "Set a starting point")
        : "Plan a route, or just drive";
      badge.className = "rc-badge";
      badge.textContent = "";
      if (go) { go.hidden = true; go.classList.remove("is-ready"); }
    }
    renderQuick();
    updateBottomVar();
  }

  /* ---------------------------------------------------------
     One tap to somewhere you have been before

     Your marks and saved routes as chips over the map, while nothing is
     planned. A mark is a trip from WHERE YOU ARE — the whole reason to tap
     "Home" is that you want to go home from here — so it asks for a fix,
     sets it as the start, and plans. A saved route loads as it always has.
     --------------------------------------------------------- */
  var QUICK_MARKS = 4, QUICK_ROUTES = 2;

  function renderQuick() {
    var el = RC.el("quick");
    if (!el) return;
    var show = state.mode === "plan" && !state.routes.length && !RC.pick.isActive();
    var marks = show ? RC.marks.list().slice(0, QUICK_MARKS) : [];
    var routes = show ? RC.routes.list().slice(0, QUICK_ROUTES) : [];
    if (!marks.length && !routes.length) {
      if (!el.hidden) { el.hidden = true; el.innerHTML = ""; }
      return;
    }
    var html = "";
    for (var i = 0; i < marks.length; i++) {
      html += '<button type="button" class="rc-quick-chip" data-quick-mark="' + RC.escapeHtml(marks[i].id) + '" ' +
        'title="Ride to ' + RC.escapeHtml(marks[i].name) + ' from here" style="--i:' + i + '">' +
        RC.icons.ui("pin") + "<span>" + RC.escapeHtml(marks[i].name) + "</span></button>";
    }
    for (var r = 0; r < routes.length; r++) {
      html += '<button type="button" class="rc-quick-chip is-route" data-quick-route="' + RC.escapeHtml(routes[r].id) + '" ' +
        'title="Load ' + RC.escapeHtml(routes[r].name) + '" style="--i:' + (marks.length + r) + '">' +
        RC.icons.ui("route") + "<span>" + RC.escapeHtml(routes[r].name) + "</span></button>";
    }
    if (el.innerHTML !== html) el.innerHTML = html;
    el.hidden = false;
  }

  function quickToMark(id) {
    var m = RC.marks.get(id);
    if (!m) return;
    RC.el("stops").innerHTML = "";
    state.endpoints = [state.endpoints[0], state.endpoints[state.endpoints.length - 1]];
    var end = state.endpoints[state.endpoints.length - 1];
    end.place = RC.marks.toPlace(m);
    end.inputEl.value = m.name;
    RC.marks.touch(m.id);
    saveTrip();
    if (!navigator.geolocation) { drawEndpoints(); openPanel("route"); return; }
    setStatus("Finding you, then " + m.name + "…", "busy");
    navigator.geolocation.getCurrentPosition(function (pos) {
      setEndpointFromLatLon(state.endpoints[0], pos.coords.latitude, pos.coords.longitude);
      plan();
    }, function () {
      // No fix is not the end of it: the destination is set, and the planner
      // is the place to say where from.
      setStatus("Could not find you — set a start and plan.", "error");
      flashStatus(4000);
      drawEndpoints();
      openPanel("route");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  /* Somewhere to go that did not come from the search box: the ride's
     planned stops still ahead, or where a mate is right now. The same two
     moves a quick destination makes — the places go into the fields, then
     "from where you are" — so what comes out is an ordinary route that can be
     looked at, saved, re-planned and started like any other. */
  function planFromHere(places, label) {
    if (!places || !places.length) return;
    RC.el("stops").innerHTML = "";
    state.endpoints = [state.endpoints[0], state.endpoints[state.endpoints.length - 1]];
    for (var m = 0; m < places.length - 1; m++) addStop();
    for (var i = 0; i < places.length; i++) {
      var ep = state.endpoints[i + 1];
      var p = places[i];
      ep.place = { name: p.name || "Stop", address: p.address || p.name || "",
                   lat: p.lat, lon: p.lon, precise: true };
      ep.inputEl.value = ep.place.name;
    }
    drawEndpoints();
    saveTrip();
    if (!navigator.geolocation) { openPanel("route"); return; }
    setStatus("Finding you, then " + (label || places[places.length - 1].name || "the way") + "…", "busy");
    navigator.geolocation.getCurrentPosition(function (pos) {
      setEndpointFromLatLon(state.endpoints[0], pos.coords.latitude, pos.coords.longitude);
      plan();
    }, function () {
      setStatus("Could not find you — set a start and plan.", "error");
      flashStatus(4000);
      drawEndpoints();
      openPanel("route");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  /* ---------------------------------------------------------
     Saved routes
     --------------------------------------------------------- */
  function currentPlaces() {
    var places = [];
    for (var i = 0; i < state.endpoints.length; i++) {
      if (state.endpoints[i].place) places.push(state.endpoints[i].place);
    }
    return places;
  }

  function saveCurrentRoute() {
    var places = currentPlaces();
    if (places.length < 2) { setStatus("Plan a route before saving it.", "error"); return; }
    var suggestion = RC.routes.suggestName(places);
    var name = window.prompt("Name this route", suggestion);
    if (name === null) return;
    try {
      RC.routes.save({ name: name, places: places, vehicle: state.vehicle, interval: state.interval });
    } catch (err) {
      setStatus(err && err.message ? err.message : "Could not save that route.", "error");
      return;
    }
    renderSavedRoutes();
    setStatus("Saved.", "");
    flashStatus();
  }

  function renderSavedRoutes() {
    var section = RC.el("saved-routes");
    var list = RC.el("saved-list");
    if (!section || !list) return;
    var items = RC.routes.list();
    renderQuick();
    updateBottomVar();
    if (!items.length) { section.hidden = true; list.innerHTML = ""; return; }
    section.hidden = false;

    var html = "";
    for (var i = 0; i < items.length; i++) {
      var r = items[i];
      var stopCount = Math.max(0, r.places.length - 2);
      var meta = (r.vehicle === "motorcycle" ? "Motorcycle" : "Car") +
        (stopCount ? " · " + stopCount + " stop" + (stopCount > 1 ? "s" : "") : "") +
        (r.useCount ? " · used " + r.useCount + "×" : "");
      html +=
        '<div class="rc-saved-row">' +
          '<button type="button" class="rc-saved-load" data-id="' + RC.escapeHtml(r.id) + '">' +
            '<span class="rc-saved-name">' + RC.escapeHtml(r.name) + "</span>" +
            '<span class="rc-saved-meta">' + RC.escapeHtml(meta) + "</span>" +
          "</button>" +
          '<button type="button" class="rc-saved-del" data-del="' + RC.escapeHtml(r.id) + '" ' +
            'aria-label="Delete ' + RC.escapeHtml(r.name) + '" title="Delete this saved route">' +
            RC.icons.ui("close") +
          "</button>" +
        "</div>";
    }
    list.innerHTML = html;
  }

  function loadSavedRoute(id) {
    var entry = RC.routes.get(id);
    if (!entry) return;

    RC.el("stops").innerHTML = "";
    state.endpoints = [state.endpoints[0], state.endpoints[state.endpoints.length - 1]];
    for (var i = 0; i < state.endpoints.length; i++) {
      state.endpoints[i].place = null;
      state.endpoints[i].inputEl.value = "";
    }

    var mid = entry.places.slice(1, entry.places.length - 1);
    for (var m = 0; m < mid.length; m++) addStop();

    for (var e = 0; e < state.endpoints.length && e < entry.places.length; e++) {
      state.endpoints[e].place = entry.places[e];
      state.endpoints[e].inputEl.value = entry.places[e].name;
    }

    if (entry.interval) {
      state.interval = entry.interval;
      RC.store.set("interval", entry.interval);
      RC.el("interval").value = entry.interval;
    }
    RC.routes.touch(entry.id);
    renderSavedRoutes();
    drawEndpoints();
    saveTrip();
    var hadRoute = state.routes.length > 0;
    setVehicle(entry.vehicle);
    if (!hadRoute || state.vehicle === entry.vehicle) plan();
  }

  /* ---------------------------------------------------------
     Marks
     --------------------------------------------------------- */
  function renderMarks() {
    var list = RC.el("marks-list");
    if (!list) return;
    var items = RC.marks.list();
    renderQuick();
    updateBottomVar();
    if (!items.length) {
      list.innerHTML = '<p class="rc-history-empty">No marks yet. A mark is a one-tap destination.</p>';
      drawMarks();
      return;
    }
    var html = "";
    for (var i = 0; i < items.length; i++) {
      var m = items[i];
      var meta = RC.coords.format(m.lat, m.lon) + (m.useCount ? " · used " + m.useCount + "×" : "");
      html +=
        '<div class="rc-saved-row">' +
          '<button type="button" class="rc-saved-load" data-mark="' + RC.escapeHtml(m.id) + '">' +
            '<span class="rc-saved-name">' + RC.escapeHtml(m.name) + "</span>" +
            '<span class="rc-saved-meta">' + RC.escapeHtml(meta) + "</span>" +
          "</button>" +
          '<button type="button" class="rc-saved-act" data-mark-to="' + RC.escapeHtml(m.id) + '" ' +
            'aria-label="Route to ' + RC.escapeHtml(m.name) + '" title="Set as destination">' +
            RC.icons.ui("flag") +
          "</button>" +
          '<button type="button" class="rc-saved-del" data-mark-del="' + RC.escapeHtml(m.id) + '" ' +
            'aria-label="Delete ' + RC.escapeHtml(m.name) + '" title="Delete this mark">' +
            RC.icons.ui("close") +
          "</button>" +
        "</div>";
    }
    list.innerHTML = html;
    drawMarks();
  }

  function saveMark(lat, lon, suggested) {
    var name = window.prompt("Name this mark", suggested || RC.coords.format(lat, lon));
    if (name === null) return null;
    try {
      var entry = RC.marks.save({ name: name, lat: lat, lon: lon, address: RC.coords.format(lat, lon) });
      renderMarks();
      setStatus("Mark saved.", "");
      flashStatus();
      return entry;
    } catch (err) {
      setStatus(err && err.message ? err.message : "Could not save that mark.", "error");
      return null;
    }
  }

  function markMapCentre() {
    if (!map) return;
    var c = map.getCenter();
    saveMark(c.lat, c.lng, "");
  }

  function markMyLocation() {
    if (!navigator.geolocation) { setStatus("This browser will not share a location.", "error"); return; }
    setStatus("Finding you…", "busy");
    navigator.geolocation.getCurrentPosition(function (pos) {
      setStatus("", "");
      saveMark(pos.coords.latitude, pos.coords.longitude, "");
    }, function () {
      setStatus("Location permission was refused.", "error");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }

  /* ---------------------------------------------------------
     Your roads
     --------------------------------------------------------- */
  function renderHistoryPanel() {
    var box = RC.el("history-summary");
    if (!box) return;
    var st = RC.history.stats();
    if (!st.edges && !st.trips) {
      box.innerHTML = '<p class="rc-history-empty">Nothing recorded yet. Ride, and the roads ' +
        'write themselves down here.</p>';
      return;
    }

    var carBias = RC.history.etaBias("car", null);
    var motoBias = RC.history.etaBias("motorcycle", null);
    var rows = [
      ["Road segments known", String(st.edges)],
      ["Distance recorded", RC.fmtDist(st.metersRecorded, state.units)],
      ["Completed rides", String(st.trips)]
    ];
    if (carBias) rows.push(["Car pace", "×" + carBias.ratio.toFixed(2) + " of the router's estimate"]);
    if (motoBias) rows.push(["Motorcycle pace", "×" + motoBias.ratio.toFixed(2) + " of the router's estimate"]);

    var html = '<div class="rc-detail-grid">';
    for (var i = 0; i < rows.length; i++) {
      html += '<div class="rc-detail-k">' + RC.escapeHtml(rows[i][0]) + "</div>" +
              '<div class="rc-detail-v">' + RC.escapeHtml(rows[i][1]) + "</div>";
    }
    html += "</div>";
    box.innerHTML = html;
  }

  function renderFreeSummary() {
    var box = RC.el("free-summary");
    if (!box) return;
    var s = state.freeSummary;
    if (!s) {
      box.innerHTML = '<p class="rc-history-empty">No free ride recorded in this session yet.</p>';
      return;
    }
    var rows = [
      ["Distance", RC.fmtDist(s.distanceM, state.units)],
      ["Total time", RC.fmtDur(s.elapsedS)],
      ["Moving", RC.fmtDur(s.movingS)],
      ["Stopped", RC.fmtDur(s.stoppedS)]
    ];
    if (s.avgMovingKmh != null) rows.push(["Average while moving", RC.fmtSpeed(s.avgMovingKmh, state.units)]);
    if (s.maxSpeedKmh != null) rows.push(["Top speed", RC.fmtSpeed(s.maxSpeedKmh, state.units)]);
    if (s.climbM > 0) rows.push(["Climb", "+" + RC.fmtDist(s.climbM, state.units)]);
    if (s.descentM > 0) rows.push(["Descent", "-" + RC.fmtDist(s.descentM, state.units)]);

    var html = '<div class="rc-detail-grid">';
    for (var i = 0; i < rows.length; i++) {
      html += '<div class="rc-detail-k">' + RC.escapeHtml(rows[i][0]) + "</div>" +
              '<div class="rc-detail-v">' + RC.escapeHtml(rows[i][1]) + "</div>";
    }
    html += "</div>";
    box.innerHTML = html;
  }

  function clearHistory() {
    if (!window.confirm("Forget every road RouteCast has recorded, and the timings learned from them? This cannot be undone.")) return;
    RC.history.clear();
    renderHistoryPanel();
    setStatus("Recorded roads cleared.", "");
    flashStatus();
  }

  /* ---------------------------------------------------------
     Selection
     --------------------------------------------------------- */
  function selectCheckpoint(i) {
    state.selected = (state.selected === i) ? -1 : i;
    var cp = state.checkpoints[state.selected];
    if (cp) {
      // Looking at a checkpoint is a decision, not a stray pan: the camera
      // stands down until Re-centre rather than snatching the view back.
      if (RC.follow.isFollowing()) RC.follow.release();
      if (!RC.layers.lookAt(cp.lat, cp.lon)) {
        RC.follow.silently(function () { map.panTo([cp.lat, cp.lon], { animate: !quietMotion(), duration: 0.6 }); });
      }
    }
    drawWeatherMarkers();
    renderTimeline();
    renderDetails();
    var chip = RC.el("timeline").querySelector('.rc-chip[data-i="' + i + '"]');
    if (chip && chip.scrollIntoView) chip.scrollIntoView({ block: "nearest", inline: "center" });
  }

  function selectRoute(i) {
    if (i === state.routeIndex || !state.routes[i]) return;
    state.routeIndex = i;
    var token = ++state.planToken;
    setStatus("Re-reading the sky for that route…", "busy");
    loadWeatherFor(state.routes[i], token).then(function () {
      setStatus("", "");
    }, function (err) {
      setStatus(err && err.message ? err.message : "Could not load that route.", "error");
    });
  }

  /* ---------------------------------------------------------
     Chrome
     --------------------------------------------------------- */
  var statusTimer = null;

  /* kind: "" | "busy" | "error", or a risk level — "watch", "caution",
     "danger" — for the notices a ride raises about what is ahead. */
  function setStatus(msg, kind) {
    var el = RC.el("status");
    if (!el) return;
    var level = kind === "watch" || kind === "caution" || kind === "danger" ? kind : "";
    el.className = "rc-status" + (kind === "error" ? " rc-error" : kind === "busy" ? " rc-busy" : "") +
      (level ? " is-" + level : "");
    el.innerHTML = msg
      ? (kind === "busy" ? '<span class="rc-spinner" aria-hidden="true"></span>'
         : level ? RC.icons.ui("alert") : "") + RC.escapeHtml(msg)
      : "";
  }

  // A message that has done its job should get out of the way of the map.
  function flashStatus(ms) {
    if (statusTimer) clearTimeout(statusTimer);
    var el = RC.el("status");
    if (!el) return;
    var was = el.textContent;
    statusTimer = setTimeout(function () {
      statusTimer = null;
      if (el.textContent === was) setStatus("", "");
    }, ms || 2600);
  }

  function setVehicle(v) {
    state.vehicle = v;
    RC.store.set("vehicle", v);
    RC.el("vehicle-car").setAttribute("aria-pressed", String(v === "car"));
    RC.el("vehicle-moto").setAttribute("aria-pressed", String(v === "motorcycle"));
    document.body.setAttribute("data-vehicle", v);

    // Picking the motorcycle turns the exclusion on; picking the car leaves
    // whatever the rider last chose, because a car driver avoiding tollways
    // to save money is a perfectly reasonable thing to want.
    if (v === "motorcycle") setAvoidMotorways(true, true);
    syncVehicleHint();
    if (state.routes.length) plan();
  }

  function setAvoidMotorways(on, quiet) {
    state.avoidMotorways = !!on;
    RC.store.set("avoidMotorways", state.avoidMotorways);
    var box = RC.el("avoid-motorway");
    if (box) box.checked = state.avoidMotorways;
    syncVehicleHint();
    if (!quiet && state.routes.length) plan();
  }

  function syncVehicleHint() {
    var hint = RC.el("vehicle-hint");
    if (!hint) return;
    if (state.vehicle === "motorcycle") {
      hint.textContent = state.avoidMotorways
        ? "Philippine expressways are closed to motorcycles. RouteCast asks the router to exclude motorway and toll classes, drops to a plain motorway exclusion if that is refused, and then reads the line's own step names and refs to name anything that slipped through."
        : "Exclusion is off — this route may put a motorcycle on an expressway it is not allowed to ride.";
    } else {
      hint.textContent = state.avoidMotorways
        ? "Motorway and toll classes are excluded where the router supports it."
        : "";
    }
  }

  function setUnits(u) {
    state.units = u;
    RC.store.set("units", u);
    RC.el("units").textContent = u === "metric" ? "km" : "mi";
    RC.el("units").title = u === "metric" ? "Metric — tap for miles and °F" : "Imperial — tap for km and °C";
    if (state.checkpoints.length) { labelCheckpoints(); render(); }
    renderMarks();
    renderFreeSummary();
    // The dashboard's speed warning is offered in the rider's own units.
    if (RC.hud) RC.hud.refresh();
    // Every distance the room shows — how far away each rider is, how far off
    // the planned route — is in these units too.
    RC.groupui.refresh();
  }

  function toggleTheme() {
    var cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    var next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) {}
    forgetThemeColors();
    if (state.routes.length) { drawRoute({ fit: false }); drawWeatherMarkers(); }
    // The 3D view draws the rider in the accent, which the two palettes do
    // not share; nothing else it draws is ours to recolour.
    RC.layers.sync();
    renderElevation();
    RC.groupui.redraw();
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setStatus("This browser will not share a location.", "error"); return; }
    setStatus("Asking for your location…", "busy");
    navigator.geolocation.getCurrentPosition(function (pos) {
      setStatus("", "");
      setEndpointFromLatLon(state.endpoints[0], pos.coords.latitude, pos.coords.longitude);
      RC.follow.silently(function () {
        map.setView([pos.coords.latitude, pos.coords.longitude], Math.max(map.getZoom(), 16));
      });
    }, function () {
      setStatus("Location permission was refused.", "error");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }

  function swapEnds() {
    var a = state.endpoints[0], b = state.endpoints[state.endpoints.length - 1];
    if (a === b) return;
    var pa = a.place, va = a.inputEl.value;
    a.place = b.place; a.inputEl.value = b.inputEl.value;
    b.place = pa; b.inputEl.value = va;
    drawEndpoints();
    renderDock();
  }

  function resetAll() {
    state.planToken++;
    if (activeRequest) activeRequest.abort();
    if (RC.nav.isActive()) stopNav();
    if (RC.free.isActive()) stopFree();
    state.routes = []; state.checkpoints = []; state.series = null; state.trip = null; state.selected = -1;
    state.profile = null; state.traffic = null; state.calibration = null; state.preferredByHistory = false;
    state.elevToken++;
    RC.el("stops").innerHTML = "";
    state.endpoints = [state.endpoints[0], state.endpoints[state.endpoints.length - 1]];
    for (var i = 0; i < state.endpoints.length; i++) {
      state.endpoints[i].place = null;
      state.endpoints[i].inputEl.value = "";
    }
    for (var r = 0; r < routeLayers.length; r++) map.removeLayer(routeLayers[r]);
    routeLayers = [];
    RC.layers.sync();
    dotLayer.clearLayers();
    chipLayer.clearLayers();
    endpointLayer.clearLayers();
    if (freeTrackLayer) { map.removeLayer(freeTrackLayer); freeTrackLayer = null; }
    RC.el("summary").hidden = true;
    RC.el("details").hidden = true;
    RC.el("alts").hidden = true;
    RC.el("depart-planner").hidden = true;
    RC.el("timeline").innerHTML = "";
    var elev = RC.el("elev-profile");
    if (elev) { elev.hidden = true; elev.innerHTML = ""; }
    var facts = RC.el("trip-facts");
    if (facts) facts.innerHTML = "";
    var empty = RC.el("empty-state");
    if (empty) empty.hidden = false;
    setStatus("", "");
    renderDock();
    renderSavedRoutes();
    renderHistoryPanel();
    updateMapControls();
    RC.follow.silently(function () { map.setView([MAP_START.lat, MAP_START.lon], MAP_START.zoom); });
  }

  function saveTrip() {
    RC.store.set("lastTrip", currentPlaces());
  }

  function restoreTrip() {
    var places = RC.store.get("lastTrip", null);
    if (!places || places.length < 2) return;
    var mid = places.length - 2;
    for (var m = 0; m < mid; m++) addStop();
    for (var i = 0; i < state.endpoints.length && i < places.length; i++) {
      state.endpoints[i].place = places[i];
      state.endpoints[i].inputEl.value = places[i].name || "";
    }
    drawEndpoints();
  }

  /* ---------------------------------------------------------
     Map controls and the camera
     --------------------------------------------------------- */
  function updateMapControls() {
    var riding = state.mode !== "plan";
    var overviewBtn = RC.el("ctl-overview");
    var locateBtn = RC.el("ctl-locate");
    var markBtn = RC.el("ctl-mark");
    var lockBtn = RC.el("ctl-lock");
    var heatBtn = RC.el("ctl-heat");
    if (overviewBtn) overviewBtn.hidden = !state.routes.length;
    if (markBtn) markBtn.hidden = riding;
    /* Riding swaps one button for another: the heat map is a thing you look
       at over a coffee (it is still in Layers), the rain lock is a thing you
       reach for at 60 km/h. The column stays the same height either way. */
    if (lockBtn) lockBtn.hidden = !riding;
    if (heatBtn) heatBtn.hidden = riding;
    if (locateBtn) {
      var label = riding ? "Re-centre on me" : "Use my location";
      locateBtn.setAttribute("aria-label", label);
      locateBtn.title = label;
    }
    updateBottomVar();
  }

  /* How much room the bottom overlay is taking. The map controls, the
     re-centre pill and the alert all clear it, in every mode, without any of
     them having to know which overlay is up.

     Two numbers, not one, and the difference matters:
       --rc-hud-h     the dashboard alone. The rail of other riders stacks
                      directly on top of it, so that is what it measures from.
       --rc-bottom-h  everything at the bottom, rail included. That is what
                      the controls and the re-centre pill clear. */
  function updateBottomVar() {
    var el = state.mode === "plan" ? RC.el("dock") : RC.el("hud");
    var root = document.documentElement;
    var h = 0;
    if (el && !el.hidden) {
      var rect = el.getBoundingClientRect();
      // In landscape the HUD is a side column and takes no bottom room.
      var landscapeColumn = window.matchMedia &&
        window.matchMedia("(orientation: landscape) and (max-height: 620px)").matches;
      if (!(landscapeColumn && el.id === "hud")) h = Math.round(rect.height) + 6;
      if (el.id === "dock") root.style.setProperty("--rc-dock-h", Math.round(rect.height) + "px");
      // The quick destinations stack on the dock, so the controls clear both.
      var quick = RC.el("quick");
      if (el.id === "dock" && quick && !quick.hidden && !landscapeColumn) {
        h += Math.round(quick.getBoundingClientRect().height) + 6;
      }
    }
    root.style.setProperty("--rc-hud-h", h + "px");

    var rail = RC.el("mates-rail");
    var railH = 0;
    if (rail && !rail.hidden) railH = Math.round(rail.getBoundingClientRect().height) + 4;
    root.style.setProperty("--rc-bottom-h", (h + railH) + "px");
  }

  /* The rail changes height whenever a rider joins, leaves or drops off the
     screen, and everything below it is positioned from that height. Exposed
     so RC.groupui can say so the moment it redraws, rather than leaving the
     map controls sitting under a row that has just appeared. */
  RC.onMatesRailChange = updateBottomVar;

  function renderRecentre(following) {
    var btn = RC.el("recentre");
    if (!btn) return;
    btn.hidden = !(RC.follow.isEnabled() && !following);
  }

  function locateOnMap() {
    if (state.mode !== "plan" && riderMarker) {
      // Keep whatever zoom the rider chose; they asked to be re-centred,
      // not zoomed back in over the top of a look at the road ahead.
      RC.follow.recenter();
      return;
    }
    if (!navigator.geolocation) { setStatus("This browser will not share a location.", "error"); return; }
    setStatus("Finding you…", "busy");
    navigator.geolocation.getCurrentPosition(function (pos) {
      setStatus("", "");
      RC.follow.silently(function () {
        map.setView([pos.coords.latitude, pos.coords.longitude], Math.max(map.getZoom(), 15));
      });
    }, function () {
      setStatus("Location permission was refused.", "error");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  function showOverview() {
    var route = state.routes[state.routeIndex];
    if (!route) return;
    var bounds = L.latLngBounds(route.coords).pad(0.12);
    // Deliberate: the camera stands down until Re-centre rather than
    // undoing this on the next fix.
    RC.follow.release();
    /* With the 3D camera up, the camera itself pulls up — level, north up,
       the whole route under it — and Re-centre dives back down. Asking the
       hidden flat map to do it, as this used to, changed nothing anybody
       could see. */
    if (RC.layers.overview(bounds)) return;
    if (RC.compass.isRotated()) RC.compass.setMode("north", { gesture: false });
    flyToBounds(bounds);
  }

  function zoomBy(delta) {
    if (!map) return;
    // While the camera is tilted the GL map owns the zoom; Leaflet is told
    // where it ended up rather than asked where to go.
    if (RC.layers.zoomBy(delta)) return;
    RC.follow.silently(function () {
      map.setZoomAround(map.getCenter(), map.getZoom() + delta);
    });
    // A tap on + or - is as deliberate as a pinch, and must survive the next
    // fix. silently() hides it from the gesture heuristics, so say it here.
    RC.follow.setZoom(map.getZoom());
  }

  /* Course-up is a way of riding, not a per-trip whim: a rider who wants the
     map turned wants it turned on every ride, and having to reach for the
     compass button after every start was the other half of "it just locks on
     north". The mode itself still drops back to north between rides — the
     planner is read north-up, and a map that spins while you are looking for
     a fuel stop helps nobody — but the PREFERENCE is remembered and re-applied
     the moment the next ride starts. */
  function rememberCompassMode(mode) {
    RC.store.set("compassMode", mode === "course" ? "course" : "north");
  }

  function restoreCompassMode() {
    if (RC.store.get("compassMode", "north") !== "course") return;
    // gesture:false: asking iOS for the magnetometer needs a tap, and there is
    // not one here. GPS course needs no permission and is the better source at
    // riding speed anyway, so course-up works regardless; the magnetometer
    // joins in next time the button is tapped.
    RC.compass.setMode("course", { gesture: false });
  }

  function onCompassModeChange(mode) {
    renderCompassBtn(mode);
    // Course-up rotates the map element about its centre, so the rider has
    // to BE at the centre for it to mean anything. Switching into it is
    // therefore also a request to be followed again.
    if (mode === "course" && RC.follow.isEnabled()) RC.follow.recenter();
  }

  function renderCompassBtn(mode) {
    var btn = RC.el("ctl-compass");
    if (!btn) return;
    var label = mode === "course"
      ? "Following your heading — tap for north up"
      : "North is up — tap to follow your heading";
    btn.setAttribute("data-mode", mode);
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }

  /* ---------------------------------------------------------
     The heat map

     The switch, the four questions, the legend, and one paragraph of what the
     record actually contains. The drawing itself is RC.heat's business; this
     is only the panel and the map button, which have to agree with each other
     and with whatever the layer is currently doing.
     --------------------------------------------------------- */
  function initHeatUi() {
    var toggle = RC.el("heat-on");
    if (toggle) toggle.addEventListener("change", function () {
      if (this.checked) {
        // show() refuses when there is not enough recorded road to say
        // anything, and says so; the switch must follow the truth.
        if (!RC.heat.show()) this.checked = false;
      } else {
        RC.heat.hide();
      }
      renderHeatPanel();
    });

    var btn = RC.el("ctl-heat");
    if (btn) btn.addEventListener("click", function () {
      RC.heat.toggle();
      renderHeatPanel();
    });

    var segs = document.querySelectorAll("[data-metric]");
    for (var i = 0; i < segs.length; i++) {
      segs[i].addEventListener("click", function () {
        RC.heat.setMetric(this.getAttribute("data-metric"));
        renderHeatPanel();
      });
    }
    renderHeatPanel();
  }

  function renderHeatPanel() {
    var st = RC.heat.state();
    var def = RC.heat.METRICS[st.metric] || RC.heat.METRICS.visits;

    var toggle = RC.el("heat-on");
    if (toggle) toggle.checked = st.on;
    var btn = RC.el("ctl-heat");
    if (btn) btn.setAttribute("aria-pressed", st.on ? "true" : "false");

    var segs = document.querySelectorAll("[data-metric]");
    for (var i = 0; i < segs.length; i++) {
      var on = segs[i].getAttribute("data-metric") === st.metric;
      segs[i].setAttribute("aria-pressed", on ? "true" : "false");
    }
    var note = RC.el("heat-metric-note");
    if (note) note.textContent = def.note;

    // The legend is built from the same ramp the layer draws with, so the two
    // cannot drift apart when somebody retunes the colours.
    var legend = RC.el("heat-legend");
    if (legend) {
      var ends = st.metric === "speed" ? ["quickest", "slowest"]
        : st.metric === "dwell" ? ["straight through", "longest held up"]
        : st.metric === "recent" ? ["longest ago", "most recent"]
        : ["ridden once", "ridden most"];
      var html = '<span class="rc-heat-end">' + RC.escapeHtml(ends[0]) + "</span>";
      html += '<span class="rc-heat-ramp">';
      for (var r = 0; r < RC.heat.RAMP.length; r++) {
        html += '<i style="background:' + RC.heat.RAMP[r] + '"></i>';
      }
      html += "</span>";
      html += '<span class="rc-heat-end">' + RC.escapeHtml(ends[1]) + "</span>";
      legend.innerHTML = html;
    }

    var box = RC.el("heat-summary");
    if (!box) return;
    var d = RC.heat.describe();
    if (!d || !d.segments) {
      box.innerHTML = '<p class="rc-history-empty">Nothing recorded yet.</p>';
      return;
    }
    var bits = [
      { k: "Stretches", v: String(d.segments) },
      { k: "Distance", v: d.distance },
      { k: "Time on the road", v: d.time }
    ];
    if (d.pace) bits.push({ k: "Your real pace", v: d.pace });
    if (d.busiest > 1) bits.push({ k: "Most ridden", v: d.busiest + " times" });
    if (d.slowest) bits.push({ k: "Slowest stretch", v: d.slowest });

    // Same two-column grid the rest of the You tab reads in, rather than a
    // fourth way of laying out a list of facts.
    var out = '<div class="rc-detail-grid">';
    for (var b = 0; b < bits.length; b++) {
      out += '<div class="rc-detail-k">' + RC.escapeHtml(bits[b].k) + "</div>" +
             '<div class="rc-detail-v">' + RC.escapeHtml(bits[b].v) + "</div>";
    }
    out += "</div>";
    box.innerHTML = out;
  }

  /* ---------------------------------------------------------
     Running in a pocket
     --------------------------------------------------------- */
  function initBackgroundUi() {
    var toggle = RC.el("background-on");
    if (toggle) {
      toggle.checked = RC.background.isEnabled();
      toggle.addEventListener("change", function () {
        RC.background.setEnabled(this.checked);
        renderBackgroundPanel();
      });
    }
    RC.background.on("enabled", renderBackgroundPanel);
    RC.background.on("show", renderBackgroundPanel);
    renderBackgroundPanel();
  }

  function renderBackgroundPanel() {
    var note = RC.el("background-note");
    var toggle = RC.el("background-on");
    if (toggle) toggle.checked = RC.background.isEnabled();
    if (!note) return;
    // Three states, one line each. The paragraph is the "background" topic.
    if (!RC.background.isEnabled()) { note.textContent = "Off — a ride in a pocket may stop."; return; }
    note.textContent = RC.background.held()
      ? "Running — this ride survives the screen going off."
      : "Ready. It starts with the next ride.";
  }

  /* ---------------------------------------------------------
     The version, and asking about it

     The bar over the map is RC.update's, and it only ever appears when there
     genuinely is a new build waiting. This is the other half: a line in the
     You tab saying what you are running, and a button for the rider who has
     been told a fix exists and wants to go and get it rather than wait for
     the next check.
     --------------------------------------------------------- */
  function initVersionUi() {
    var btn = RC.el("version-check");
    if (btn) btn.addEventListener("click", function () {
      if (RC.update.isReady()) { RC.update.apply(); return; }
      setStatus("Checking for updates…", "busy");
      RC.update.check().then(function (result) {
        if (result === "ready") { setStatus("", ""); renderVersionPanel(); return; }
        setStatus(
          result === "downloading" ? "A new version is downloading."
          : result === "offline" ? "Could not check — try again when you are online."
          : result === "unsupported" ? "This browser cannot check; reload the page instead."
          : "You are on the latest version.", result === "offline" ? "error" : "");
        flashStatus(4000);
        renderVersionPanel();
      });
    });
    RC.update.onState(renderVersionPanel);
    renderVersionPanel();
  }

  function renderVersionPanel() {
    var st = RC.update.state();
    var note = RC.el("version-note");
    if (note) {
      note.textContent = st.ready
        ? "Version " + st.version + " — a newer one is ready."
        : "Version " + st.version + (st.supported ? "" : " — this browser does not cache the app.");
    }
    var btn = RC.el("version-check");
    if (btn) btn.textContent = st.ready ? "Reload to update" : "Check for updates";
  }

  /* ---------------------------------------------------------
     Centre-pin picker
     --------------------------------------------------------- */
  function clearPickActiveClass() {
    if (activePickTrigger && activePickTrigger.classList) activePickTrigger.classList.remove("is-active");
    activePickTrigger = null;
  }

  function openPicker(ep, title, triggerBtn) {
    if (!map || !ep) return;
    var center = ep.place
      ? { lat: ep.place.lat, lon: ep.place.lon }
      : { lat: map.getCenter().lat, lon: map.getCenter().lng };

    // The picker needs the map, so the planner gets out of the way — and
    // comes back by itself the moment the pin is confirmed or cancelled.
    pickReopenPanel = isPanelOpen();
    closePanel();

    clearPickActiveClass();
    if (triggerBtn && triggerBtn.classList) triggerBtn.classList.add("is-active");
    activePickTrigger = triggerBtn || null;

    RC.pick.start(ep, { center: center, title: title });
    // The picker has the bottom of the screen; the quick chips step aside.
    renderQuick();
  }

  function initPick() {
    RC.pick.init({
      map: map,
      els: {
        root: RC.el("pick-root"),
        card: RC.el("pick-card"),
        pin: RC.el("pick-pin"),
        title: RC.el("pick-title"),
        label: RC.el("pick-label"),
        sub: RC.el("pick-sub"),
        coord: RC.el("pick-coord"),
        confirm: RC.el("pick-confirm"),
        cancel: RC.el("pick-cancel")
      }
    });

    RC.pick.onConfirm = function (target, place) {
      var ep = target;
      clearPickActiveClass();
      if (!ep) { if (pickReopenPanel) openPanel(); return; }
      ep.place = place;
      ep.inputEl.value = place.name;
      drawEndpoints();
      saveTrip();
      renderDock();
      if (pickReopenPanel) openPanel("route");
      pickReopenPanel = false;
    };

    RC.pick.onCancel = function () {
      clearPickActiveClass();
      if (pickReopenPanel) openPanel("route");
      pickReopenPanel = false;
      renderQuick();
      updateBottomVar();
    };

    var saveBtn = RC.el("pick-save");
    if (saveBtn) saveBtn.addEventListener("click", function () {
      var p = RC.pick.current();
      if (!p) return;
      saveMark(p.lat, p.lon, p.name);
    });
  }

  /* ---------------------------------------------------------
     The planner — open, closed, and nothing in between
     --------------------------------------------------------- */
  function isPanelOpen() {
    var panel = RC.el("panel");
    return !!(panel && panel.getAttribute("data-open") === "true");
  }

  function openPanel(tab) {
    var panel = RC.el("panel");
    if (!panel) return;
    if (tab) selectTab(tab);
    panel.setAttribute("data-open", "true");
    panel.setAttribute("aria-hidden", "false");
    document.documentElement.setAttribute("data-panel", "open");
    var scrim = RC.el("scrim");
    if (scrim) scrim.hidden = false;
    var btn = RC.el("menu-btn");
    if (btn) btn.setAttribute("aria-expanded", "true");
  }

  function closePanel() {
    var panel = RC.el("panel");
    if (!panel) return;
    panel.setAttribute("data-open", "false");
    panel.setAttribute("aria-hidden", "true");
    document.documentElement.setAttribute("data-panel", "closed");
    panel.style.transform = "";
    var scrim = RC.el("scrim");
    if (scrim) scrim.hidden = true;
    var btn = RC.el("menu-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function togglePanel() {
    if (isPanelOpen()) closePanel();
    else openPanel(state.routes.length ? "trip" : "route");
  }

  function selectTab(name) {
    var tabs = document.querySelectorAll(".rc-tab");
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute("data-pane") === name;
      tabs[i].classList.toggle("is-active", on);
      tabs[i].setAttribute("aria-selected", String(on));
    }
    var panes = document.querySelectorAll(".rc-pane");
    for (var p = 0; p < panes.length; p++) {
      panes[p].hidden = panes[p].id !== ("pane-" + name);
    }
    var scroll = RC.el("panel-scroll");
    if (scroll) scroll.scrollTop = 0;
    /* Seven tabs do not fit across a 320px phone, so the strip scrolls — and
       a tab selected from somewhere else (the map's Layers button, say) could
       be highlighted somewhere off the side of it, which reads as the button
       having done nothing. */
    var active = document.querySelector(".rc-tab.is-active");
    if (active && active.scrollIntoView) {
      try { active.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
    }
    if (name === "group") RC.groupui.refresh();
    if (name === "marks") renderMarks();
    // Mid-ride the timeline and profile are only kept current while they
    // can be seen (see refreshRideOverlays), so opening them brings them up
    // to date first.
    if (name === "trip" && state.mode !== "plan" && state.checkpoints.length) {
      renderTimeline(); renderElevation(); renderDetails();
    }
    if (name === "you") {
      renderHistoryPanel(); renderFreeSummary();
      renderBackgroundPanel(); renderVersionPanel();
      renderGuidePanel(); RC.hud.renderSettings();
    }
    if (name === "pubs") RC.pubsui.render();
    if (name === "layers") { RC.layersui.render(); renderHeatPanel(); }
  }

  /* A drag on the sheet's head closes it or springs it back — two outcomes,
     both of which end with the inline transform cleared. The listeners live
     on the window for the life of the gesture, so a pointer that leaves the
     element, or a capture the browser refuses, still ends the drag instead
     of stranding the panel half way up. */
  function initPanelDrag() {
    var panel = RC.el("panel");
    var head = document.querySelector(".rc-panel-head");
    if (!panel || !head) return;

    var drag = null;

    function isSheet() {
      return !(window.matchMedia &&
        (window.matchMedia("(orientation: landscape)").matches || window.matchMedia("(min-width: 900px)").matches));
    }

    function detach() {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
    }

    function onDown(e) {
      if (drag || !isSheet() || !isPanelOpen()) return;
      if (e.target && e.target.closest && e.target.closest("button")) return;
      if (e.button != null && e.button !== 0) return;
      drag = { id: e.pointerId, startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, v: 0, moved: false };
      panel.classList.add("is-dragging");
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancel, true);
    }

    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dt = e.timeStamp - drag.lastT;
      if (dt > 0) drag.v = (e.clientY - drag.lastY) / dt;
      drag.lastY = e.clientY;
      drag.lastT = e.timeStamp;
      var dy = Math.max(0, e.clientY - drag.startY);
      if (dy > 6) drag.moved = true;
      if (drag.moved && e.cancelable) e.preventDefault();
      panel.style.transform = "translateY(" + dy + "px)";
    }

    function finish(cancelled) {
      var d = drag;
      drag = null;
      detach();
      panel.classList.remove("is-dragging");
      panel.style.transform = "";
      if (!d || cancelled) return;
      var dy = Math.max(0, d.lastY - d.startY);
      var height = panel.getBoundingClientRect().height || 1;
      if (d.v > 0.6 || dy > height * 0.3) closePanel();
    }

    function onUp(e) { if (drag && e.pointerId === drag.id) finish(false); }
    function onCancel(e) { if (drag && e.pointerId === drag.id) finish(true); }

    head.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", function () { if (drag) finish(true); });
    window.addEventListener("orientationchange", function () { if (drag) finish(true); });
  }

  /* ---------------------------------------------------------
     Modes
     --------------------------------------------------------- */
  function setMode(mode) {
    state.mode = mode;
    document.documentElement.setAttribute("data-mode", mode);
    RC.el("hud").hidden = mode === "plan";
    RC.el("turn-banner").hidden = mode !== "nav";
    RC.el("free-banner").hidden = mode !== "free";
    var railTitle = RC.el("rail-title");
    if (railTitle) railTitle.textContent = mode === "plan" ? "Plan" : (mode === "free" ? "Free drive" : "Trip");
    if (mode !== "plan") closePanel();
    /* A ride gets its own map and its own camera; planning gets the one the
       rider picked. This is the whole of the switch — layers.js decides
       whether that means changing anything. */
    if (mode === "plan") RC.layers.leaveDrive(); else RC.layers.enterDrive();
    lastHudRenderTs = 0;
    overlaySig = "";
    tickSig = "";
    overlayLevels = null;
    RC.hud.setMode(mode === "plan" ? null : mode);
    turnKey = "";
    document.documentElement.setAttribute("data-then", "no");
    // The lock is a riding thing; planning never inherits one.
    if (mode === "plan" && RC.lock.isLocked()) RC.lock.unlock();
    drawMarks();
    renderQuick();
    updateMapControls();
    updateBottomVar();
  }

  /* ---------------------------------------------------------
     Live navigation
     --------------------------------------------------------- */
  function rebuildNavTargets(route, places) {
    if (places) {
      navTargets = places.map(function (p) { return { lat: p.lat, lon: p.lon, name: p.name, atM: 0 }; });
    }
    var legs = (route && route.legs) || [];
    var acc = 0;
    for (var i = 0; i < navTargets.length; i++) {
      acc += (legs[i] && legs[i].distance) || 0;
      navTargets[i].atM = acc;
    }
    if (navTargets.length && route && route.distance) {
      navTargets[navTargets.length - 1].atM = route.distance;
    }
  }

  function dropPassedTargets(distanceAlong) {
    while (navTargets.length > 1 && navTargets[0].atM <= distanceAlong + 150) navTargets.shift();
  }

  function startNav() {
    if (RC.nav.isActive()) { stopNav(); return; }
    if (RC.free.isActive()) stopFree();
    var route = state.routes[state.routeIndex];
    if (!route || !state.checkpoints.length) {
      setStatus("Plan a route before navigating.", "error");
      return;
    }
    var places = [];
    for (var i = 1; i < state.endpoints.length; i++) {
      if (state.endpoints[i].place) places.push(state.endpoints[i].place);
    }
    if (!places.length) { setStatus("Plan a route before navigating.", "error"); return; }
    rebuildNavTargets(route, places);

    // Inside the tap: the voice needs a gesture before it may speak at all.
    beginRide("nav", places[places.length - 1].name);
    setStatus("Starting navigation…", "busy");
    RC.nav.start({
      map: map,
      route: route,
      checkpoints: state.checkpoints,
      vehicle: state.vehicle,
      series: state.series,
      profile: state.profile,
      departedAt: new Date()
    }).then(function () {
      setStatus("", "");
      setMode("nav");
      // The opening shot: a flight down to the rider, flat or tilted.
      RC.follow.enable({ zoom: Math.max(map.getZoom(), NAV_ZOOM), intro: true });
      RC.layers.intro();
      restoreCompassMode();
    }, function (err) {
      RC.guide.end();
      setStatus(err && err.message ? err.message : "Could not start navigation.", "error");
      setMode("plan");
    });
  }

  function stopNav(opts) {
    opts = opts || {};
    var learned = RC.nav.stop();
    navTargets = [];
    navRerouteToken++;
    navDistanceAlong = 0;
    RC.compass.reset();
    RC.compass.setMode("north", { gesture: false });
    RC.follow.disable();
    if (riderMarker) { map.removeLayer(riderMarker); riderMarker = null; riderArrow = null; }
    RC.guide.end({ keep: !!opts.arrived });
    setMode("plan");
    renderHistoryPanel();
    RC.heat.invalidate();
    renderHeatPanel();
    var note = "";
    if (learned) {
      var pct = Math.round((learned.actualS / learned.plannedS - 1) * 100);
      note = pct === 0
        ? "That one ran exactly to the estimate."
        : "You ran " + Math.abs(pct) + "% " + (pct > 0 ? "slower" : "faster") +
          " than the estimate. Future ETAs will account for it.";
    }
    if (!finishRide("nav", { arrived: !!opts.arrived, note: note }) && note) {
      setStatus("Ride recorded — " + note.charAt(0).toLowerCase() + note.slice(1), "");
      flashStatus(5000);
    }
  }

  /* Rerouting — fired by RC.nav only once the rider is convincingly on a
     different road. One routing request, no alternatives, from where they
     are through whatever waypoints are left, facing the way they point. */
  function reroute(ns) {
    var token = ++navRerouteToken;
    dropPassedTargets(ns.distanceAlong);
    if (!navTargets.length) return Promise.resolve();

    var waypoints = [{ lat: ns.lat, lon: ns.lon }].concat(navTargets.map(function (t) {
      return { lat: t.lat, lon: t.lon };
    }));
    var bearings = [ns.courseDeg == null ? null : { deg: ns.courseDeg, range: 75 }];

    setStatus("Off route — finding a new way…", "busy");
    RC.guide.rerouting();

    return RC.router.route(waypoints, {
      vehicle: state.vehicle,
      alternatives: false,
      avoidMotorways: state.avoidMotorways,
      bearings: bearings
    }).then(function (routes) {
      if (token !== navRerouteToken || !RC.nav.isActive()) return;
      var raw = routes && routes[0];
      if (!raw) throw RC.error("Could not find a new route.", "route");
      raw.familiarity = RC.history.familiarity(raw.coords, state.vehicle);
      var route = RC.eta.plan(raw, new Date(), state.vehicle).route;
      state.calibration = route.calibration || null;

      var sampleOpts = { departAt: new Date() };
      if (state.interval !== "auto") sampleOpts.everyKm = parseInt(state.interval, 10);
      var checkpoints = RC.sampler.sample(route, sampleOpts);

      return RC.weather.forecastSeries(checkpoints, { maxAgeMs: WX_REUSE_MS }).then(function (series) {
        if (token !== navRerouteToken || !RC.nav.isActive()) return;
        for (var i = 0; i < checkpoints.length; i++) {
          checkpoints[i].wx = RC.weather.sampleSeries(series, i, checkpoints[i].eta);
        }
        state.routes = [route];
        state.routeIndex = 0;
        state.checkpoints = checkpoints;
        state.series = series;
        state.trip = RC.risk.trip(checkpoints, state.vehicle);
        state.selected = -1;
        state.traffic = RC.traffic.forecast(checkpoints, state.vehicle);
        rebuildNavTargets(route, null);
        labelCheckpoints();
        checkpoints[0].label = "You are here";
        RC.nav.setRoute(route, checkpoints, series);
        RC.guide.routeChanged();
        overlaySig = "";
        tickSig = "";
        overlayLevels = null;
        drawRoute({ fit: false });
        drawWeatherMarkers();
        renderSummary();
        renderFacts();
        renderAlternatives();
        renderTimeline();
        renderDetails();
        renderDock();
        setStatus("", "");
        loadElevation(route, state.planToken);
      });
    }, function (err) {
      if (token !== navRerouteToken) return;
      setStatus(err && err.message ? err.message : "Could not find a new route.", "error");
      flashStatus(4000);
    });
  }

  function refreshDownstreamWeather(ns) {
    var cps = state.checkpoints;
    var series = state.series;
    if (!series || !cps.length) return Promise.resolve();

    var from = 0;
    while (from < cps.length && cps[from].distance <= ns.distanceAlong + 0.5) from++;
    var ahead = cps.slice(from, from + WX_REFRESH_MAX_POINTS);
    if (!ahead.length) return Promise.resolve();

    return RC.weather.forecastSeries(ahead, { maxAgeMs: WX_REUSE_MS }).then(function (fresh) {
      if (!RC.nav.isActive() || state.series !== series) return;
      for (var i = 0; i < ahead.length; i++) {
        series.perCheckpoint[from + i] = fresh.perCheckpoint[i];
        cps[from + i].wx = RC.weather.sampleSeries(series, from + i, cps[from + i].eta);
      }
      state.trip = RC.risk.trip(cps, state.vehicle);
      drawWeatherMarkers();
      renderTimeline();
      renderDetails();
    }, function () { /* a missed refresh just means the last forecast stands */ });
  }

  /* ---------------------------------------------------------
     Free driving
     --------------------------------------------------------- */
  function startFree() {
    if (RC.free.isActive()) { stopFree(); return; }
    if (RC.nav.isActive()) stopNav();
    beginRide("free", "");
    setStatus("Starting the recorder…", "busy");
    RC.free.start({ vehicle: state.vehicle }).then(function () {
      setStatus("", "");
      setMode("free");
      state.freeSummary = null;
      localSeries = null;
      if (!freeTrackLayer) {
        freeTrackLayer = L.polyline([], { color: themeColors().accent, weight: 5, opacity: 0.9 }).addTo(map);
      } else {
        freeTrackLayer.setLatLngs([]);
      }
      RC.follow.enable({ zoom: Math.max(map.getZoom(), NAV_ZOOM), intro: true });
      RC.layers.intro();
      restoreCompassMode();
    }, function (err) {
      RC.guide.end();
      setStatus(err && err.message ? err.message : "Could not start recording.", "error");
      setMode("plan");
    });
  }

  function stopFree() {
    var summary = RC.free.stop();
    state.freeSummary = summary;
    RC.compass.reset();
    RC.compass.setMode("north", { gesture: false });
    RC.follow.disable();
    if (riderMarker) { map.removeLayer(riderMarker); riderMarker = null; riderArrow = null; }
    RC.guide.end();
    setMode("plan");
    renderHistoryPanel();
    renderFreeSummary();
    RC.heat.invalidate();
    renderHeatPanel();
    if (summary && summary.distanceM > RECAP_MIN_M) {
      // The line stays on the map until the next ride or a reset: it is the
      // only record of the shape of the ride, and throwing it away the
      // instant you stop is the wrong instinct.
      if (freeTrackLayer) freeTrackLayer.setLatLngs(summary.track || []);
      finishRide("free", { summary: summary, note: "The roads are yours now — they count toward your heat map." });
    } else {
      if (freeTrackLayer) { map.removeLayer(freeTrackLayer); freeTrackLayer = null; }
      setStatus("Ride was too short to keep.", "");
      flashStatus();
    }
  }

  /* ---------------------------------------------------------
     Riding a line somebody else worked out

     The group ride's "ways back" hand over a finished route object. Adopting
     one is exactly what a re-plan already does — take the geometry, sample it,
     read the sky along it, draw it — and then it drives. Nothing here knows or
     cares that a room produced it.
     --------------------------------------------------------- */
  function driveRoute(raw, targets) {
    if (!raw || !raw.coords || raw.coords.length < 2) return Promise.resolve(false);
    if (RC.nav.isActive()) stopNav();
    if (RC.free.isActive()) stopFree();

    var token = ++state.planToken;
    if (activeRequest) { activeRequest.abort(); activeRequest = null; }

    raw.familiarity = RC.history.familiarity(raw.coords, state.vehicle);
    var route = RC.eta.plan(raw, new Date(), state.vehicle).route;
    state.routes = [route];
    state.routeIndex = 0;
    state.selected = -1;

    var ends = targets && targets.length ? targets : [{
      lat: route.coords[route.coords.length - 1][0],
      lon: route.coords[route.coords.length - 1][1],
      name: "the end of this way"
    }];

    setStatus("Taking that way…", "busy");
    beginRide("nav", ends[ends.length - 1].name);
    return loadWeatherFor(route, token).then(function () {
      if (token !== state.planToken) return false;
      rebuildNavTargets(route, ends);
      return RC.nav.start({
        map: map,
        route: route,
        checkpoints: state.checkpoints,
        vehicle: state.vehicle,
        series: state.series,
        profile: state.profile,
        departedAt: new Date()
      }).then(function () {
        setStatus("", "");
        setMode("nav");
        RC.follow.enable({ zoom: Math.max(map.getZoom(), NAV_ZOOM), intro: true });
        RC.layers.intro();
        return true;
      });
    }).catch(function (err) {
      if (token !== state.planToken) return false;
      RC.guide.end();
      setStatus(err && err.message ? err.message : "Could not take that way.", "error");
      return false;
    });
  }

  /* What the host would share as the ride's planned route: the line currently
     selected, and the named places it was built from. Deliberately a snapshot
     — once it is the room's planned route it stops following this rider's
     re-plans, which is the entire point of a planned route. */
  function currentPlanForGroup() {
    var route = state.routes[state.routeIndex];
    if (!route || !route.coords || route.coords.length < 2) return null;
    var stops = [];
    for (var i = 1; i < state.endpoints.length; i++) {
      var p = state.endpoints[i].place;
      if (p) stops.push({ lat: p.lat, lon: p.lon, name: p.name });
    }
    if (!stops.length) {
      var last = route.coords[route.coords.length - 1];
      stops = [{ lat: last[0], lon: last[1], name: "Destination" }];
    }
    return {
      coords: route.coords,
      stops: stops,
      distance: route.distance,
      duration: route.duration,
      vehicle: state.vehicle,
      by: RC.group.myName()
    };
  }

  // One forecast for where the rider actually is, on free drive's own gate.
  function fetchLocalWeather(fs) {
    var point = [{ lat: fs.lat, lon: fs.lon, eta: new Date() }];
    return RC.weather.forecastSeries(point, { maxAgeMs: WX_REUSE_MS }).then(function (series) {
      if (!RC.free.isActive()) return;
      var wx = RC.weather.sampleSeries(series, 0, new Date());
      // Kept whole: "rain in forty minutes" and the sunset are in here too.
      localSeries = series;
      RC.free.setWeather(wx);
    }, function () { /* no forecast is not a reason to stop the ride */ });
  }

  /* ---------------------------------------------------------
     A ride's beginning and end
     --------------------------------------------------------- */
  function beginRide(kind, dest) {
    ride = { track: [], last: null, startedAt: Date.now(), introduced: kind !== "nav", dest: dest || "", kind: kind };
    RC.recap.hide();
    RC.guide.begin({ mode: kind });
  }

  function recordRideTrack(lat, lon) {
    var t = ride.track;
    if (t.length) {
      var last = t[t.length - 1];
      if (RC.haversine({ lat: last[0], lon: last[1] }, { lat: lat, lon: lon }) < RIDE_TRACK_GAP_M) return;
    }
    t.push([lat, lon]);
    if (t.length > RIDE_TRACK_MAX) t.splice(0, t.length - RIDE_TRACK_MAX);
  }

  function trackLength(track) {
    var m = 0;
    for (var i = 1; i < track.length; i++) {
      m += RC.haversine({ lat: track[i - 1][0], lon: track[i - 1][1] }, { lat: track[i][0], lon: track[i][1] });
    }
    return m;
  }

  // Metres climbed along the profile between two distances — the DEM, not
  // the phone's altitude, which is why a navigated ride's climb is steady.
  function profileClimb(fromM, toM) {
    var p = state.profile;
    if (!p || !p.points || p.points.length < 2) return null;
    var up = 0, prev = null;
    for (var i = 0; i < p.points.length; i++) {
      var pt = p.points[i];
      if (pt.distance < fromM || pt.distance > toM) continue;
      if (prev != null && pt.elevationM > prev) up += pt.elevationM - prev;
      prev = pt.elevationM;
    }
    return up;
  }

  function whenText(fromMs, toMs) {
    var a = new Date(fromMs), b = new Date(toMs);
    return RC.fmtDay(a) + " · " + RC.fmtTime(a) + " – " + RC.fmtTime(b);
  }

  /* The card at the end of a ride, and the camera pulling back to show the
     whole of it. Returns false when there was not enough ride for a card. */
  function finishRide(kind, info) {
    info = info || {};
    var stats = [], track, distanceM, title, kicker, startedAt = ride.startedAt || Date.now();
    if (kind === "free") {
      var s = info.summary;
      track = s.track || [];
      distanceM = s.distanceM;
      kicker = "Free drive recorded";
      title = RC.fmtDist(s.distanceM, state.units) + " in " + RC.fmtDur(s.elapsedS);
      stats.push({ k: "Distance", v: RC.fmtDist(s.distanceM, state.units) });
      stats.push({ k: "Time", v: RC.fmtDur(s.elapsedS) });
      stats.push({ k: "Moving", v: RC.fmtDur(s.movingS) });
      if (s.avgMovingKmh != null) stats.push({ k: "Average", v: RC.fmtSpeed(s.avgMovingKmh, state.units) });
      if (s.maxSpeedKmh != null) stats.push({ k: "Top speed", v: RC.fmtSpeed(s.maxSpeedKmh, state.units) });
      stats.push({ k: "Climb", v: s.climbM > 0 ? "+" + RC.fmtDist(s.climbM, state.units) : "—" });
    } else {
      track = ride.track;
      distanceM = trackLength(track);
      var last = ride.last || {};
      if (!(distanceM > RECAP_MIN_M)) return false;
      kicker = info.arrived ? "Arrived" : "Ride ended";
      title = info.arrived ? (ride.dest || "Destination") : (RC.fmtDist(distanceM, state.units) + " ridden");
      var elapsed = last.elapsedS || (Date.now() - startedAt) / 1000;
      stats.push({ k: "Distance", v: RC.fmtDist(distanceM, state.units) });
      stats.push({ k: "Time", v: RC.fmtDur(elapsed) });
      if (last.avgSpeedKmh != null) stats.push({ k: "Average", v: RC.fmtSpeed(last.avgSpeedKmh, state.units) });
      if (last.maxSpeedKmh) stats.push({ k: "Top speed", v: RC.fmtSpeed(last.maxSpeedKmh, state.units) });
      var climb = profileClimb(0, last.distanceAlong || 0);
      if (climb != null) stats.push({ k: "Climb", v: "+" + RC.fmtDist(Math.round(climb), state.units) });
      // What the forecast said about this route — labelled as a forecast,
      // because nothing measured whether it actually rained.
      var wet = state.trip ? state.trip.rainMinutes : 0;
      stats.push({ k: "Forecast rain", v: wet > 0 ? RC.fmtDur(wet * 60) : "None" });
    }
    if (!(distanceM > RECAP_MIN_M) || !track || track.length < 2) return false;

    var dateText;
    try {
      dateText = new Date(startedAt).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    } catch (e) { dateText = new Date(startedAt).toDateString(); }
    var shown = RC.recap.show({
      kicker: kicker, title: title, sub: whenText(startedAt, Date.now()), when: dateText,
      track: track, stats: stats, note: info.note || ""
    });
    if (shown) pullBackTo(track);
    return shown;
  }

  /* After the ride, the camera rises to show all of it, framed above the
     card rather than behind it — and waits for the tilted view to level out
     first, so the two moves read as one. */
  function pullBackTo(track) {
    var bounds = L.latLngBounds(track);
    var route = state.routes[state.routeIndex];
    if (route && route.coords && route.coords.length) bounds.extend(L.latLngBounds(route.coords));
    setTimeout(function () {
      if (state.mode !== "plan") return;
      var card = RC.el("recap");
      var cardH = card && !card.hidden ? card.getBoundingClientRect().height : 0;
      var landscape = window.matchMedia && window.matchMedia("(orientation: landscape) and (max-height: 620px)").matches;
      RC.follow.silently(function () {
        var opts = {
          paddingTopLeft: [30, 80],
          paddingBottomRight: landscape ? [Math.min(460, window.innerWidth * 0.62) + 20, 30] : [30, cardH + 30],
          maxZoom: 16
        };
        if (quietMotion()) { map.fitBounds(bounds, opts); return; }
        opts.duration = 1.1;
        opts.easeLinearity = 0.3;
        map.flyToBounds(bounds, opts);
      });
    }, (RC.gl.UNTILT_MS || 0) + 80);
  }

  /* ---------------------------------------------------------
     The HUD

     app.js works out every tile's value for the ride in progress, because
     this is where the route, the forecast and the fix all are; RC.hud
     decides which of them are on the screen and how they look, because the
     rider decides that. See static/js/hud.js.
     --------------------------------------------------------- */
  function gpsLevel(accuracy) {
    if (accuracy == null) return "clear";
    return accuracy > 40 ? "caution" : accuracy > 20 ? "watch" : "clear";
  }

  var CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  function headingPod(deg) {
    if (deg == null || isNaN(deg)) return { v: "—" };
    var d = ((deg % 360) + 360) % 360;
    return { html: '<span class="rc-windarrow" style="transform:rotate(' + Math.round(d) + 'deg)">' +
      RC.icons.ui("arrow") + "</span><span>" + CARDINALS[Math.round(d / 45) % 8] + "</span>" };
  }

  function batteryPod() {
    var b = RC.power.battery();
    if (!b) return { v: "—" };
    var pct = Math.round(b.level * 100);
    return {
      html: (b.charging ? RC.icons.ui("bolt") : "") + "<span>" + pct + "%</span>",
      level: b.charging ? null : pct <= 20 ? "caution" : pct <= 35 ? "watch" : null
    };
  }

  function skyPod(wx) {
    if (!wx) return { v: "—" };
    if (wx.outOfRange) return { html: RC.icons.weather("cloud") + "<span>—</span>" };
    var desc = RC.weather.describe(wx.code, wx.isDay);
    return {
      html: RC.icons.weather(desc.icon) + "<span>" + RC.escapeHtml(RC.fmtTemp(wx.tempC, state.units)) + "</span>",
      level: RC.risk.score(wx, state.vehicle).level
    };
  }

  function windPod(wx, courseDeg) {
    if (!wx || wx.outOfRange || wx.windKmh == null) return { v: "—" };
    var rel = RC.risk.wind(wx.windDir, courseDeg, wx.gustKmh);
    if (!rel) return { v: RC.fmtSpeed(wx.windKmh, state.units), level: windLevel(wx.gustKmh) };
    return { html: windArrowHtml(rel.rel, wx.windKmh), level: windLevel(wx.gustKmh) };
  }

  function minutesText(ms) {
    var m = Math.max(1, Math.round(ms / 60000));
    return m < 90 ? "in " + m + " min" : RC.fmtTime(new Date(Date.now() + ms));
  }

  /* When the next rain reaches the rider, along the route: the stretch they
     are on, then each checkpoint ahead at the time they reach it. */
  function rainPodAhead(ns) {
    var cps = state.checkpoints, now = Date.now();
    var from = 0;
    while (from < cps.length && cps[from].distance <= ns.distanceAlong + 0.5) from++;
    var a = cps[from - 1], b = cps[from];
    if (a && b && a.wx && b.wx && !a.wx.outOfRange && !b.wx.outOfRange) {
      var here = (a.wx.precipMm + b.wx.precipMm) / 2;
      if (here >= 0.3) return { v: "Now", level: here > 2.5 ? "caution" : "watch" };
    }
    for (var i = from; i < cps.length; i++) {
      var wx = cps[i].wx;
      if (!wx || wx.outOfRange) continue;
      if (wx.precipMm >= 0.3) {
        var ms = cps[i].eta.getTime() - now;
        if (ms > 4 * 3600000) break;
        return { v: minutesText(ms), level: ms < 30 * 60000 ? "watch" : null };
      }
    }
    return { v: "Dry", level: "clear" };
  }

  function rainPodLocal() {
    if (!localSeries || !localSeries.rain) return { v: "—" };
    var r = localSeries.rain(0, new Date(), 6);
    if (r.now) return { v: "Now", level: "watch" };
    if (r.at) {
      var ms = r.at.getTime() - Date.now();
      return { v: minutesText(ms), level: ms < 30 * 60000 ? "watch" : null };
    }
    return { v: "Dry", level: "clear" };
  }

  function sunPodFrom(sun) {
    if (!sun || !sun.next) return { v: "—" };
    var ms = sun.next.at.getTime() - Date.now();
    var isSet = sun.next.kind === "sunset";
    return {
      label: isSet ? "Sunset" : "Sunrise",
      v: RC.fmtTime(sun.next.at),
      level: isSet && ms < 45 * 60000 ? "watch" : null
    };
  }

  function sunPodAhead(ns) {
    var cps = state.checkpoints;
    if (!cps.length || !state.series || !state.series.sun) return { v: "—" };
    var i = 0;
    while (i < cps.length - 1 && cps[i].distance <= ns.distanceAlong) i++;
    return sunPodFrom(state.series.sun(i, new Date()));
  }

  function commonPods(fix, traffic) {
    return {
      average: { v: fix.avgSpeedKmh == null ? "—" : RC.fmtSpeed(fix.avgSpeedKmh, state.units) },
      top: { v: fix.maxSpeedKmh == null ? "—" : RC.fmtSpeed(fix.maxSpeedKmh, state.units) },
      elev: { v: fix.elevationM == null ? "—" : RC.fmtDist(Math.round(fix.elevationM), state.units) },
      elapsed: { v: RC.fmtDur(fix.elapsedS) },
      traffic: { v: RC.traffic.LEVELS[traffic].label, level: trafficLevelClass(traffic) },
      heading: headingPod(fix.courseDeg),
      clock: { v: RC.fmtTime(new Date()) },
      battery: batteryPod(),
      gps: { v: fix.accuracy == null ? "—" : ("±" + RC.fmtDist(fix.accuracy, state.units)), level: gpsLevel(fix.accuracy) }
    };
  }

  /* One line over the map for what is wrong ahead. Written only when it
     changes: the same sentence rebuilt on every fix is a relayout a second
     for nothing. */
  var alertKey = "";
  function setAlert(level, text) {
    var alertEl = RC.el("nav-alert");
    if (!alertEl) return;
    var key = level ? level + "|" + text : "";
    if (key === alertKey) return;
    alertKey = key;
    if (!level) { alertEl.hidden = true; return; }
    alertEl.setAttribute("data-level", level);
    alertEl.innerHTML = RC.icons.ui("alert") + "<span>" + RC.escapeHtml(text) + "</span>";
    alertEl.hidden = false;
  }

  function renderNavHud(ns) {
    navDistanceAlong = ns.distanceAlong;
    ride.last = ns;
    recordRideTrack(ns.lat, ns.lon);

    var next = ns.nextCheckpoint;
    var nextLevel = next ? levelOf(next) : "clear";
    var traffic = RC.traffic.level(new Date());

    var pods = commonPods(ns, traffic);
    pods.left = { v: RC.fmtDist(ns.remainingM, state.units) };
    pods.arrive = { v: RC.fmtTime(ns.etaDate) };
    pods.time = { v: RC.fmtDur(ns.remainingS) };
    pods.sky = next ? skyPod(next.wx || { outOfRange: true }) : { v: "—" };
    pods.rain = rainPodAhead(ns);
    pods.wind = windPod(next && next.wx, ns.courseDeg);
    pods.grade = { v: ns.gradePct == null ? "—" : ((ns.gradePct > 0 ? "+" : "") + ns.gradePct.toFixed(1) + "%") };
    pods.sun = sunPodAhead(ns);
    RC.hud.render(ns.displaySpeedKmh, pods);
    setLockHint(pods.rain.v === "Now");

    var fill = RC.el("hud-progress-fill");
    if (fill) fill.style.width = (ns.progress * 100).toFixed(1) + "%";
    renderHudTicks();
    renderTurn(ns);

    if (ns.offRoute) {
      setAlert("caution", "You're off the planned route.");
    } else if (nextLevel === "caution" || nextLevel === "danger") {
      var place = (next && next.label) || "the next checkpoint";
      setAlert(nextLevel, (nextLevel === "danger" ? "Danger conditions ahead at " : "Caution ahead at ") + place);
    } else {
      setAlert(null);
    }

    // What the camera frames by: faster is further ahead, a junction is closer.
    RC.layers.context({ speedKmh: ns.displaySpeedKmh, turnM: ns.nextStep ? ns.nextStep.distanceM : null });

    if (!ride.introduced) {
      ride.introduced = true;
      RC.guide.introduce(ride.dest, ns.remainingM, RC.fmtTime(ns.etaDate));
    }
    RC.guide.nav(ns, state.vehicle);

    var t = Date.now();
    if (t - lastHudRenderTs >= 5000) {
      lastHudRenderTs = t;
      refreshRideOverlays();
    }
  }

  /* The map's own overlays, mid-ride. The weather chips used to be torn
     down and rebuilt every five seconds whether anything had changed or not
     — and in the 3D view every rebuild threw away and re-created every
     mirrored marker with it. Now they are redrawn when what they SHOW
     changes, and the panel's timeline and profile only while the panel is
     open to show them. */
  function refreshRideOverlays() {
    var cps = state.checkpoints;
    var levels = "", sig = "";
    for (var i = 0; i < cps.length; i++) {
      var wx = cps[i].wx;
      var lv = levelOf(cps[i]);
      levels += lv + ",";
      sig += lv + ":" + (wx && !wx.outOfRange ? Math.round(wx.tempC) + ":" + wx.code : "x") + "|";
    }
    sig += "#" + state.selected;
    if (sig !== overlaySig) {
      overlaySig = sig;
      // A stretch that changed colour is a route that has to be repainted.
      if (overlayLevels != null && overlayLevels !== levels) drawRoute({ fit: false });
      overlayLevels = levels;
      drawWeatherMarkers();
    }
    if (isPanelOpen() && !RC.el("pane-trip").hidden) {
      renderTimeline();
      renderElevation();
    }
  }

  function renderHudTicks() {
    var track = RC.el("hud-progress");
    if (!track) return;
    var route = state.routes[state.routeIndex];
    var cps = state.checkpoints;
    var sig = route ? route.distance + "|" : "";
    for (var s = 0; s < cps.length; s++) sig += Math.round(cps[s].distance) + levelOf(cps[s]) + ",";
    // The ticks only move when the checkpoints or their colours do.
    if (sig === tickSig) return;
    tickSig = sig;
    var old = track.querySelectorAll(".rc-hud-tick");
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    if (!route || !cps.length || !route.distance) return;
    for (var j = 0; j < cps.length; j++) {
      var pct = RC.clamp(cps[j].distance / route.distance * 100, 0, 100);
      var tick = document.createElement("span");
      tick.className = "rc-hud-tick is-" + levelOf(cps[j]);
      tick.style.left = pct + "%";
      track.appendChild(tick);
    }
  }

  /* The next turn: an arrow drawn the way a road sign draws it, how far,
     and the words — with the manoeuvre after it hanging underneath when the
     two are close enough to be one. A new instruction slides in, so the eye
     catches that it changed without having to read it; the bar along the
     bottom fills over the last few hundred metres. */
  var TURN_APPROACH_M = 400;
  var turnKey = "";

  function renderTurn(ns) {
    var box = RC.el("turn-banner");
    var textEl = RC.el("turn-text");
    var distEl = RC.el("turn-dist");
    var glyphEl = RC.el("turn-glyph");
    var thenEl = RC.el("turn-then");
    var bar = RC.el("turn-approach");
    if (!box || !textEl || !distEl) return;
    var step = ns.nextStep;
    var key = step ? step.index + "|" + step.text : "end";
    if (key !== turnKey) {
      turnKey = key;
      textEl.textContent = step ? step.text : "Continue to your destination";
      if (glyphEl) glyphEl.innerHTML = step ? RC.guide.glyph(step) : RC.icons.turn("arrive");
      box.classList.remove("is-new");
      void box.offsetWidth;
      box.classList.add("is-new");
      if (thenEl) {
        var then = step && step.then;
        var showThen = !!(then && then.gapM < 300 && then.type !== "arrive");
        if (showThen) {
          thenEl.innerHTML = "<span>Then</span>" + RC.guide.glyph(then);
          thenEl.setAttribute("title", "Then " + then.text);
        }
        thenEl.hidden = !showThen;
        // Everything that stacks under the banner moves down to clear it.
        document.documentElement.setAttribute("data-then", showThen ? "yes" : "no");
      }
    }
    if (!step) {
      distEl.textContent = "";
      box.removeAttribute("data-soon");
      if (bar) bar.style.transform = "scaleX(0)";
      return;
    }
    distEl.textContent = RC.fmtDist(step.distanceM, state.units);
    if (step.distanceM < 150) box.setAttribute("data-soon", "yes");
    else box.removeAttribute("data-soon");
    if (bar) bar.style.transform = "scaleX(" + (1 - RC.clamp(step.distanceM / TURN_APPROACH_M, 0, 1)).toFixed(3) + ")";
  }

  function renderFreeHud(fs) {
    ride.last = fs;
    var traffic = RC.traffic.level(new Date());
    var pods = commonPods(fs, traffic);
    pods.distance = { v: RC.fmtDist(fs.distanceM, state.units) };
    pods.moving = { v: RC.fmtDur(fs.movingS) };
    pods.sky = fs.wx ? skyPod(fs.wx) : { v: "—" };
    pods.rain = rainPodLocal();
    pods.wind = windPod(fs.wx, fs.courseDeg);
    pods.climb = { v: fs.climbM > 0 ? "+" + RC.fmtDist(fs.climbM, state.units) : "—" };
    pods.sun = localSeries && localSeries.sun ? sunPodFrom(localSeries.sun(0, new Date())) : { v: "—" };
    RC.hud.render(fs.displaySpeedKmh, pods);
    setLockHint(pods.rain.v === "Now");

    RC.layers.context({ speedKmh: fs.displaySpeedKmh, turnM: null });
    RC.guide.free(fs);

    var label = RC.el("free-label");
    if (label) {
      label.textContent = "Recording · " + RC.fmtDist(fs.distanceM, state.units) + " · " + RC.fmtDur(fs.elapsedS);
    }

    var t = Date.now();
    /* The travelled line. In 3D it is mirrored by re-reading the lines, which
       is a whole pass over every line on the map — so there it is refreshed
       less often than on the flat map, where it is one path. */
    var every = RC.layers.isCameraOn() ? 5000 : 2000;
    if (freeTrackLayer && t - lastFreeTrackTs >= every) {
      lastFreeTrackTs = t;
      freeTrackLayer.setLatLngs(fs.track);
      if (RC.layers.isCameraOn()) RC.layers.sync();
    }
  }

  function riderIconHtml() {
    return '<span class="rc-rider-wrap"><span class="rc-rider-halo"></span>' +
      '<span class="rc-rider"><svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 3.2 18.4 19 12 15.4 5.6 19 12 3.2Z" fill="currentColor"/></svg></span></span>';
  }

  /* The marker moves; the CAMERA is RC.follow's business. Keeping those two
     apart is what stopped the map fighting the rider's thumb.

     Two things it does now that it did not: it glides between fixes (a CSS
     transition on the marker's own transform — composited, and switched off
     around a zoom so it never slides across the screen after one), and it
     carries a halo the size of the fix's own error circle, because "the GPS
     is guessing" is information a dot cannot otherwise give. */
  function updateRiderMarker(lat, lon, courseDeg, accuracy) {
    if (!map) return;
    lastOwnFix = { lat: lat, lon: lon, courseDeg: courseDeg };
    var latlng = [lat, lon];
    if (!riderMarker) {
      riderMarker = L.marker(latlng, {
        icon: L.divIcon({ className: "rc-rider-marker", html: riderIconHtml(), iconSize: [26, 26], iconAnchor: [13, 13] }),
        zIndexOffset: 1000,
        keyboard: false,
        /* The 3D view draws the rider as geometry on the road surface, so
           mirroring this flat one as well would stand a second rider on top
           of the first. */
        rcSkipGl: true
      }).addTo(map);
      riderArrow = null;
    } else {
      riderMarker.setLatLng(latlng);
    }

    var el = riderMarker.getElement ? riderMarker.getElement() : null;
    if (!riderArrow && el) riderArrow = el.querySelector(".rc-rider");
    if (riderArrow && courseDeg != null) {
      riderArrow.style.transform = "rotate(" + Math.round(courseDeg) + "deg)";
    }
    if (el) {
      var px = 0;
      if (typeof accuracy === "number" && accuracy > 0) {
        var mPerPx = 40075016.686 * Math.abs(Math.cos(lat * Math.PI / 180)) / Math.pow(2, map.getZoom() + 8);
        px = RC.clamp(accuracy / (mPerPx || 1) * 2, 0, 260);
      }
      el.style.setProperty("--acc", Math.round(px) + "px");
    }

    RC.follow.setTarget(lat, lon, { rotated: RC.compass.isRotated(), minZoom: NAV_ZOOM });
    // The camera behind the machine, when one is up. A no-op otherwise.
    RC.layers.rider(lat, lon, courseDeg);
  }

  RC.nav.onUpdate = function (ns) {
    RC.compass.setCourse(ns.headingDeg, ns.speedKmh, ns.routeBearingDeg);
    renderNavHud(ns);
    updateRiderMarker(ns.lat, ns.lon, ns.courseDeg, ns.accuracy);
    dropPassedTargets(ns.distanceAlong);
    RC.groupui.pushFix({ lat: ns.lat, lon: ns.lon, speedKmh: ns.speedKmh,
                         courseDeg: ns.courseDeg, accuracy: ns.accuracy });
  };
  RC.nav.onArrive = function () {
    RC.guide.arrived(ride.dest);
    stopNav({ arrived: true });
  };
  RC.nav.onOffRoute = function (ns) {
    if (ns && ns.error) { setStatus(ns.error, "error"); return; }
    if (ns) setAlert("caution", "You're off the planned route.");
  };
  RC.nav.onReroute = reroute;
  RC.nav.onWeatherRefresh = refreshDownstreamWeather;

  RC.free.onUpdate = function (fs) {
    RC.compass.setCourse(fs.headingDeg, fs.speedKmh, null);
    renderFreeHud(fs);
    updateRiderMarker(fs.lat, fs.lon, fs.courseDeg, fs.accuracy);
    RC.groupui.pushFix({ lat: fs.lat, lon: fs.lon, speedKmh: fs.speedKmh,
                         courseDeg: fs.courseDeg, accuracy: fs.accuracy });
  };
  RC.free.onWeather = fetchLocalWeather;
  RC.free.onError = function (msg) { setStatus(msg, "error"); };

  /* ---------------------------------------------------------
     Guidance, power, the lock — the You tab and the ride's own buttons
     --------------------------------------------------------- */
  function renderVoiceButtons() {
    var on = RC.guide.settings().voice && RC.guide.canSpeak();
    ["nav-voice", "free-voice"].forEach(function (id) {
      var b = RC.el(id);
      if (!b) return;
      b.innerHTML = RC.icons.ui(on ? "speaker" : "speaker-off");
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.title = on ? "Voice on — tap to silence" : "Voice off — tap to hear guidance";
      b.hidden = !RC.guide.canSpeak();
    });
  }

  function toggleVoice() {
    var on = !RC.guide.settings().voice;
    RC.guide.set("voice", on);
    if (on) { RC.guide.prime(); RC.guide.say("Voice on."); }
    renderVoiceButtons();
    renderGuidePanel();
  }

  function renderGuidePanel() {
    var s = RC.guide.settings();
    var v = RC.el("guide-voice"), b = RC.el("guide-buzz"), br = RC.el("guide-break"), note = RC.el("guide-note");
    if (v) { v.checked = s.voice; v.disabled = !RC.guide.canSpeak(); }
    if (b) { b.checked = s.buzz; b.disabled = !RC.guide.canBuzz(); }
    if (br) br.value = String(s.breakMin);
    if (note) {
      note.textContent = !RC.guide.canSpeak() ? "This browser has no voice to speak with."
        : !RC.guide.canBuzz() ? "This phone cannot vibrate from a web page; the voice still works."
        : "";
    }
  }

  function renderPowerPanel() {
    var mode = RC.power.mode();
    var segs = document.querySelectorAll("[data-power-mode]");
    for (var i = 0; i < segs.length; i++) {
      segs[i].setAttribute("aria-pressed", segs[i].getAttribute("data-power-mode") === mode ? "true" : "false");
    }
    var note = RC.el("power-note");
    if (!note) return;
    var b = RC.power.battery();
    var pct = b ? Math.round(b.level * 100) + "%" : null;
    if (RC.power.saving()) {
      note.textContent = RC.power.isAuto()
        ? "Saving now — the battery is at " + pct + " and not charging."
        : "Saving: a calmer camera, flat buildings, fewer refreshes.";
    } else if (mode === "auto") {
      note.textContent = b ? "Waiting. Starts by itself at 20% — now " + pct + (b.charging ? ", charging." : ".")
        : "This browser will not say how the battery is; use On to save.";
    } else {
      note.textContent = "Never saves, whatever the battery says.";
    }
  }

  function setLockHint(raining) {
    var btn = RC.el("ctl-lock");
    if (btn) btn.setAttribute("data-hint", raining ? "rain" : "none");
  }

  function openDashSettings() {
    openPanel("you");
    var dash = RC.el("dash-panel");
    if (dash && dash.scrollIntoView) { try { dash.scrollIntoView({ block: "start" }); } catch (e) {} }
  }

  /* An ETA is the thing people at the other end actually want, and a phone
     can say it in one line to whoever the rider picks — nothing is sent
     anywhere else, and there is no link to a live position to leak. */
  function shareEta() {
    var route = state.routes[state.routeIndex];
    if (!route) return;
    var end = state.endpoints[state.endpoints.length - 1];
    var dest = ride.dest || (end && end.place && end.place.name) || "my destination";
    var live = RC.nav.isActive() && ride.last && ride.last.etaDate;
    var eta = live ? ride.last.etaDate : new Date(state.departAt.getTime() + route.duration * 1000);
    var left = live ? ride.last.remainingM : route.distance;
    var text = (live ? "On my way to " : "Heading to ") + dest + " — arriving about " + RC.fmtTime(eta) +
      (RC.fmtDay(eta) === "Today" ? "" : " " + RC.fmtDay(eta).toLowerCase()) +
      " (" + RC.fmtDist(left, state.units) + " to go).";
    if (navigator.share) {
      navigator.share({ title: "My ETA", text: text }).catch(function () {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        setStatus("ETA copied — paste it anywhere.", "");
        flashStatus(3000);
      }, function () { setStatus(text, ""); flashStatus(8000); });
    } else {
      setStatus(text, "");
      flashStatus(8000);
    }
  }

  function initRideUi() {
    RC.hud.init({
      units: function () { return state.units; },
      onLayout: updateBottomVar,
      onChange: updateBottomVar,
      openSettings: openDashSettings
    });
    RC.guide.init({
      units: function () { return state.units; },
      toast: function (msg, level) { setStatus(msg, level); flashStatus(7000); },
      onChange: function () { renderVoiceButtons(); renderGuidePanel(); }
    });
    RC.lock.init();

    ["nav-voice", "free-voice"].forEach(function (id) {
      var b = RC.el(id);
      if (b) b.addEventListener("click", toggleVoice);
    });
    RC.el("ctl-lock").addEventListener("click", function () { RC.lock.lock(); });

    RC.el("guide-voice").addEventListener("change", function () {
      RC.guide.set("voice", this.checked);
      if (this.checked) RC.guide.prime();
    });
    RC.el("guide-buzz").addEventListener("change", function () {
      RC.guide.set("buzz", this.checked);
      if (this.checked) RC.guide.buzz([60, 60, 60]);
    });
    RC.el("guide-break").addEventListener("change", function () { RC.guide.set("breakMin", parseInt(this.value, 10) || 0); });
    RC.el("guide-test").addEventListener("click", function () {
      RC.guide.prime();
      var said = RC.guide.say(RC.guide.phraseFar({ text: "Turn left onto Rizal Avenue" }, 300));
      RC.guide.buzz([80, 70, 80]);
      if (!said) { setStatus(RC.guide.settings().voice ? "No voice available here." : "Speaking is switched off.", ""); flashStatus(); }
    });

    var bg = RC.el("background-panel");
    if (bg) bg.addEventListener("click", function (e) {
      var seg = e.target.closest ? e.target.closest("[data-power-mode]") : null;
      if (seg) { RC.power.setMode(seg.getAttribute("data-power-mode")); renderPowerPanel(); }
    });
    RC.power.on("change", function (d) {
      renderPowerPanel();
      // Said once, when the phone decided on its own: a choppier camera
      // deserves a reason.
      if (d && d.auto && state.mode !== "plan") {
        setStatus("Battery low — saver on: calmer camera, flat buildings.", "watch");
        flashStatus(6000);
      }
    });
    RC.power.on("battery", renderPowerPanel);

    var az = RC.el("drive-autozoom");
    if (az) {
      az.checked = RC.layers.autoZoom();
      az.addEventListener("change", function () { RC.layers.setAutoZoom(this.checked); });
    }

    RC.el("recap-close").addEventListener("click", RC.recap.hide);
    RC.el("recap-done").addEventListener("click", RC.recap.hide);
    RC.el("recap-share").addEventListener("click", function () {
      RC.recap.share().then(function (r) {
        if (r === "saved") { setStatus("Picture saved.", ""); flashStatus(); }
        else if (r === "failed") { setStatus("Could not draw the picture here.", "error"); flashStatus(); }
      });
    });
    RC.el("share-eta").addEventListener("click", shareEta);

    RC.el("quick").addEventListener("click", function (e) {
      var m = e.target.closest ? e.target.closest("[data-quick-mark]") : null;
      if (m) { quickToMark(m.getAttribute("data-quick-mark")); return; }
      var r = e.target.closest ? e.target.closest("[data-quick-route]") : null;
      if (r) loadSavedRoute(r.getAttribute("data-quick-route"));
    });

    initProfileScrub();

    /* The rider marker glides between fixes, but must not glide after a
       zoom: every marker is repositioned when the scale changes, and a
       transition would slide it across the screen from where it used to
       be. So the glide is suspended from the moment a zoom starts. */
    var container = map.getContainer();
    var settleZoom = null;
    map.on("zoomstart viewreset", function () {
      container.classList.add("rc-zooming");
      if (settleZoom) { clearTimeout(settleZoom); settleZoom = null; }
    });
    map.on("zoomend viewreset", function () {
      if (settleZoom) clearTimeout(settleZoom);
      settleZoom = setTimeout(function () { settleZoom = null; container.classList.remove("rc-zooming"); }, 80);
    });

    renderVoiceButtons();
    renderGuidePanel();
    renderPowerPanel();
  }

  /* ---------------------------------------------------------
     Wiring
     --------------------------------------------------------- */
  function init() {
    initMap();
    initPick();
    initRideUi();

    state.endpoints = [
      makeEndpoint("from", RC.el("from-input"), RC.el("from-results")),
      makeEndpoint("to", RC.el("to-input"), RC.el("to-results"))
    ];

    RC.el("plan-form").addEventListener("submit", plan);
    RC.el("add-stop").addEventListener("click", function () { addStop().inputEl.focus(); });
    RC.el("use-location").addEventListener("click", useMyLocation);
    RC.el("swap-btn").addEventListener("click", swapEnds);
    RC.el("reset-btn").addEventListener("click", resetAll);
    RC.el("theme-toggle").addEventListener("click", toggleTheme);
    RC.el("vehicle-car").addEventListener("click", function () { setVehicle("car"); });
    RC.el("vehicle-moto").addEventListener("click", function () { setVehicle("motorcycle"); });
    RC.el("avoid-motorway").addEventListener("change", function () { setAvoidMotorways(this.checked); });
    RC.el("units").addEventListener("click", function () {
      setUnits(state.units === "metric" ? "imperial" : "metric");
    });

    var fromPickBtn = RC.el("from-pick");
    if (fromPickBtn) fromPickBtn.addEventListener("click", function () {
      openPicker(state.endpoints[0], "Set your start", fromPickBtn);
    });
    var toPickBtn = RC.el("to-pick");
    if (toPickBtn) toPickBtn.addEventListener("click", function () {
      openPicker(state.endpoints[state.endpoints.length - 1], "Set your destination", toPickBtn);
    });

    RC.el("ctl-locate").addEventListener("click", locateOnMap);
    RC.el("ctl-compass").addEventListener("click", function () {
      RC.compass.cycle().then(rememberCompassMode, function () {});
    });
    RC.el("ctl-overview").addEventListener("click", showOverview);
    RC.el("ctl-mark").addEventListener("click", markMapCentre);
    // The map chooser is two taps deep in a panel otherwise, and choosing a
    // map is something you do while looking at the map.
    RC.el("ctl-layers").addEventListener("click", function () { openPanel("layers"); });
    RC.el("ctl-zoom-in").addEventListener("click", function () { zoomBy(1); });
    RC.el("ctl-zoom-out").addEventListener("click", function () { zoomBy(-1); });
    RC.el("recentre").addEventListener("click", function () { RC.follow.recenter(); });

    RC.el("nav-stop").addEventListener("click", stopNav);
    RC.el("free-stop").addEventListener("click", stopFree);
    RC.el("dock-free").addEventListener("click", startFree);
    RC.el("dock-go").addEventListener("click", startNav);
    RC.el("dock-search").addEventListener("click", function () {
      openPanel(state.routes.length ? "trip" : "route");
    });

    RC.el("menu-btn").addEventListener("click", togglePanel);
    RC.el("panel-close").addEventListener("click", closePanel);
    RC.el("scrim").addEventListener("click", closePanel);
    RC.el("tabs").addEventListener("click", function (e) {
      var tab = e.target.closest ? e.target.closest(".rc-tab") : null;
      if (tab) selectTab(tab.getAttribute("data-pane"));
    });
    initPanelDrag();

    RC.el("save-route").addEventListener("click", saveCurrentRoute);
    RC.el("mark-add").addEventListener("click", markMapCentre);
    RC.el("mark-here").addEventListener("click", markMyLocation);

    RC.el("saved-list").addEventListener("click", function (e) {
      var del = e.target.closest ? e.target.closest(".rc-saved-del") : null;
      if (del) { RC.routes.remove(del.getAttribute("data-del")); renderSavedRoutes(); return; }
      var load = e.target.closest ? e.target.closest(".rc-saved-load") : null;
      if (load) { loadSavedRoute(load.getAttribute("data-id")); closePanel(); }
    });

    RC.el("marks-list").addEventListener("click", function (e) {
      var del = e.target.closest ? e.target.closest("[data-mark-del]") : null;
      if (del) { RC.marks.remove(del.getAttribute("data-mark-del")); renderMarks(); return; }
      var to = e.target.closest ? e.target.closest("[data-mark-to]") : null;
      if (to) {
        var m = RC.marks.get(to.getAttribute("data-mark-to"));
        if (m) {
          var end = state.endpoints[state.endpoints.length - 1];
          end.place = RC.marks.toPlace(m);
          end.inputEl.value = m.name;
          RC.marks.touch(m.id);
          drawEndpoints();
          saveTrip();
          renderDock();
          selectTab("route");
        }
        return;
      }
      var show = e.target.closest ? e.target.closest("[data-mark]") : null;
      if (show) {
        var mk = RC.marks.get(show.getAttribute("data-mark"));
        if (mk) {
          RC.follow.silently(function () { map.setView([mk.lat, mk.lon], Math.max(map.getZoom(), 15)); });
          closePanel();
        }
      }
    });

    RC.el("history-clear").addEventListener("click", clearHistory);

    RC.el("depart-mode").addEventListener("change", function () {
      state.departMode = this.value;
      var at = RC.el("depart-at");
      at.hidden = this.value !== "custom";
      if (this.value === "custom" && !at.value) {
        var d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
        at.value = d.toISOString().slice(0, 16);
      }
    });

    RC.el("interval").addEventListener("change", function () {
      state.interval = this.value;
      RC.store.set("interval", this.value);
      if (state.routes.length) plan();
    });

    RC.el("timeline").addEventListener("click", function (e) {
      var chip = e.target.closest ? e.target.closest(".rc-chip") : null;
      if (chip) selectCheckpoint(+chip.getAttribute("data-i"));
    });

    RC.el("alts").addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".rc-alt") : null;
      if (btn) selectRoute(+btn.getAttribute("data-i"));
    });

    RC.el("depart-planner").addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".rc-offset") : null;
      if (!btn) return;
      var h = parseInt(btn.getAttribute("data-h"), 10);
      var at = RC.el("depart-at");
      var when = new Date(Date.now() + h * 3600000);
      RC.el("depart-mode").value = "custom";
      state.departMode = "custom";
      at.hidden = false;
      at.value = new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      plan();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (RC.pick.isActive()) return;         // the picker owns Escape
      if (RC.recap.isOpen()) { RC.recap.hide(); return; }
      if (isPanelOpen()) { closePanel(); return; }
      state.selected = -1;
      drawWeatherMarkers();
      renderTimeline();
      renderDetails();
    });

    var onViewportChange = RC.debounce(function () {
      updateBottomVar();
      redrawChips();
      if (map) map.invalidateSize();
    }, 150);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);

    /* One card for anything tapped on the map — a mate, a stranger, a pin.
       Before the two modules that fill it. */
    RC.who.init(map);

    /* The room is its own thing drawn over the same map. It gets the handful of
       app-level answers it cannot work out for itself and nothing else. */
    RC.groupui.init({
      map: map,
      themeColors: themeColors,
      units: function () { return state.units; },
      vehicle: function () { return state.vehicle; },
      avoidMotorways: function () { return state.avoidMotorways; },
      currentPlan: currentPlanForGroup,
      driveRoute: driveRoute,
      planTo: planFromHere,
      setStatus: setStatus,
      flashStatus: flashStatus,
      openPanel: openPanel,
      closePanel: closePanel,
      isPanelOpen: isPanelOpen,
      // The rail of other riders only exists while this phone is actually
      // riding; on the planning screen the map has the whole viewport and
      // there is nothing to stack above.
      mode: function () { return state.mode; }
    });

    /* PUBs is the public road, drawn over the same map and kept as far away
       from the ride's own machinery as the two ideas are from each other. */
    RC.pubsui.init({
      map: map,
      units: function () { return state.units; },
      setStatus: setStatus,
      flashStatus: flashStatus,
      myFix: function () {
        // Whichever of the three watches is running; PUBs keeps its own too,
        // but the panel wants a distance the moment the pane is opened.
        return RC.group.myFix() || lastOwnFix;
      },
      openPubs: function () { openPanel("pubs"); },
      closePanel: closePanel,
      isPanelOpen: isPanelOpen,
      // Alerts about the road ahead are for a rider who is riding.
      mode: function () { return state.mode; },
      vehicle: function () { return state.vehicle; },
      // The room's own notice line, so the map has one toast rather than two
      // that land on top of each other.
      toast: function (msg, kind) { RC.groupui.toast(msg, kind); }
    });

    /* The heat map is a second reading of the same record the planner uses,
       so it takes the map and nothing else. */
    RC.heat.init({
      map: map,
      bridge: {
        units: function () { return state.units; },
        setStatus: setStatus,
        flashStatus: flashStatus
      },
      onChange: renderHeatPanel
    });
    initHeatUi();
    RC.layersui.init();
    initBackgroundUi();
    initVersionUi();
    // The sheet every (i) in the panel opens. Delegated, so the lists that are
    // rebuilt on each render need no wiring of their own.
    RC.info.init();

    setVehicle(state.vehicle);
    setAvoidMotorways(state.avoidMotorways, true);
    setUnits(state.units);
    RC.el("interval").value = state.interval;
    restoreTrip();
    setMode("plan");
    renderDock();
    renderSavedRoutes();
    renderMarks();
    renderHistoryPanel();
    renderFreeSummary();
    updateMapControls();
    updateBottomVar();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

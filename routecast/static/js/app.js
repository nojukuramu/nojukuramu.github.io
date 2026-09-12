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

  var map, tileLayer, routeLayers = [], dotLayer, chipLayer, endpointLayer, markLayer, activeRequest = null;
  var freeTrackLayer = null;

  // Live navigation
  var riderMarker = null, riderArrow = null, lastHudRenderTs = 0, lastFreeTrackTs = 0;
  var navTargets = [];
  var navRerouteToken = 0;

  var WX_REUSE_MS = 10 * 60 * 1000;
  var WX_REFRESH_MAX_POINTS = 24;

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
    tileLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      crossOrigin: true
    }).addTo(map);
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

  function drawEndpoints() {
    endpointLayer.clearLayers();
    var pts = [];
    for (var i = 0; i < state.endpoints.length; i++) {
      var ep = state.endpoints[i];
      if (!ep.place) continue;
      var isFirst = i === 0, isLast = i === state.endpoints.length - 1;
      var cls = "rc-marker rc-marker-pin " + (isFirst ? "rc-marker-start" : isLast ? "rc-marker-end" : "rc-marker-stop");
      var icon = L.divIcon({
        className: "",
        html: '<span class="' + cls + '">' + RC.icons.ui(isLast && !isFirst ? "flag" : "pin") + "</span>",
        iconSize: [30, 30],
        iconAnchor: [15, 28]
      });
      L.marker([ep.place.lat, ep.place.lon], { icon: icon, title: ep.place.name }).addTo(endpointLayer);
      pts.push([ep.place.lat, ep.place.lon]);
    }
    if (pts.length && !state.routes.length && state.mode === "plan") {
      RC.follow.silently(function () {
        map.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 13 });
      });
    }
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
      ghost:   v("--faint", "#939C8A")
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
    if (!route) return;

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

    routeLayers.push(L.polyline(route.coords, { color: themeColors().casing, weight: 9, opacity: 0.18 }).addTo(map));
    var cps = state.checkpoints;
    if (cps.length < 2) {
      routeLayers.push(L.polyline(route.coords, { color: themeColors().accent, weight: 5 }).addTo(map));
    } else {
      for (var c = 0; c < cps.length - 1; c++) {
        var seg = route.coords.slice(cps[c].i, cps[c + 1].i + 1);
        if (seg.length < 2) continue;
        var la = levelOf(cps[c]), lb = levelOf(cps[c + 1]);
        var rank = { clear: 0, watch: 1, caution: 2, danger: 3 };
        var worse = rank[lb] > rank[la] ? lb : la;
        routeLayers.push(L.polyline(seg, { color: colorFor(worse), weight: 5, opacity: 0.95 }).addTo(map));
      }
    }
    if (!opts || opts.fit !== false) {
      RC.follow.silently(function () {
        map.fitBounds(L.latLngBounds(route.coords).pad(0.12));
      });
    }
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
    for (var k = 0; k < keep.length; k++) {
      (function (cp, idx) {
        var level = levelOf(cp);
        var wx = cp.wx || {};
        var desc = wx.outOfRange ? { icon: "cloud" } : RC.weather.describe(wx.code, wx.isDay);
        var html =
          '<div style="width:100%;height:100%;display:flex;align-items:flex-end;justify-content:center;">' +
            '<span class="rc-marker is-' + level + (idx === state.selected ? " is-selected" : "") + '">' +
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

  /* Elevation profile — an inline SVG area chart, drawn from the DEM
     samples. The point is the SHAPE of the ride, not a reading. */
  var ELEV_W = 320, ELEV_H = 72, ELEV_PAD = 6;

  function renderElevation() {
    var box = RC.el("elev-profile");
    if (!box) return;
    var p = state.profile;
    if (!p || p.points.length < 2) { box.hidden = true; box.innerHTML = ""; return; }

    var pts = p.points;
    var totalM = pts[pts.length - 1].distance || 1;
    var span = Math.max(p.maxM - p.minM, 40);
    var mid = (p.maxM + p.minM) / 2;
    var lo = mid - span / 2, hi = mid + span / 2;

    function x(d) { return ELEV_PAD + (d / totalM) * (ELEV_W - ELEV_PAD * 2); }
    function y(e) { return ELEV_H - ELEV_PAD - ((e - lo) / (hi - lo)) * (ELEV_H - ELEV_PAD * 2); }

    var line = "";
    for (var i = 0; i < pts.length; i++) {
      line += (i === 0 ? "M" : "L") + x(pts[i].distance).toFixed(1) + " " + y(pts[i].elevationM).toFixed(1);
    }
    var area = line + "L" + x(totalM).toFixed(1) + " " + (ELEV_H - ELEV_PAD) +
               "L" + x(0).toFixed(1) + " " + (ELEV_H - ELEV_PAD) + "Z";

    box.hidden = false;
    box.innerHTML =
      '<div class="rc-elev-head">' +
        '<span class="rc-elev-title">Elevation</span>' +
        '<span class="rc-elev-meta">' +
          RC.escapeHtml(RC.fmtDist(Math.round(p.minM), state.units)) + " – " +
          RC.escapeHtml(RC.fmtDist(Math.round(p.maxM), state.units)) +
        "</span>" +
      "</div>" +
      '<svg class="rc-elev-svg" viewBox="0 0 ' + ELEV_W + " " + ELEV_H +
        '" preserveAspectRatio="none" role="img" aria-label="Elevation profile: climbs ' +
        RC.escapeHtml(RC.fmtDist(p.climbM, state.units)) + ', descends ' +
        RC.escapeHtml(RC.fmtDist(p.descentM, state.units)) + '">' +
        '<path class="rc-elev-area" d="' + area + '"/>' +
        '<path class="rc-elev-line" d="' + line + '"/>' +
        (navElevMarker(x, totalM) || "") +
      "</svg>";
  }

  var navDistanceAlong = 0;
  function navElevMarker(x, totalM) {
    if (!RC.nav.isActive() || !(navDistanceAlong > 0)) return null;
    var px = x(RC.clamp(navDistanceAlong, 0, totalM));
    return '<path class="rc-elev-here" d="M' + px.toFixed(1) + " " + ELEV_PAD +
           "L" + px.toFixed(1) + " " + (ELEV_H - ELEV_PAD) + '"/>';
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
      if (go) go.hidden = false;
    } else {
      var from = state.endpoints[0] && state.endpoints[0].place;
      var to = state.endpoints[state.endpoints.length - 1] && state.endpoints[state.endpoints.length - 1].place;
      primary.textContent = to ? to.name : "Where to?";
      secondary.textContent = to
        ? (from ? "from " + from.name : "Set a starting point")
        : "Plan a route, or just drive";
      badge.className = "rc-badge";
      badge.textContent = "";
      if (go) go.hidden = true;
    }
    updateBottomVar();
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
    if (!items.length) {
      list.innerHTML = '<p class="rc-history-empty">No marks yet. Drop a pin, or mark the centre of the map, ' +
        'and it becomes a one-tap destination that goes exactly where you put it.</p>';
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
      box.innerHTML = '<p class="rc-history-empty">Nothing recorded yet. Navigate a route — or just hit ' +
        'Free drive — and RouteCast remembers the roads you actually took, never the ones it merely ' +
        'suggested, so later trips can prefer them. It stays on this device.</p>';
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
      RC.follow.silently(function () { map.panTo([cp.lat, cp.lon]); });
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

  function setStatus(msg, kind) {
    var el = RC.el("status");
    if (!el) return;
    el.className = "rc-status" + (kind === "error" ? " rc-error" : kind === "busy" ? " rc-busy" : "");
    el.innerHTML = msg
      ? (kind === "busy" ? '<span class="rc-spinner" aria-hidden="true"></span>' : "") + RC.escapeHtml(msg)
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
  }

  function toggleTheme() {
    var cur = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    var next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem("theme", next); } catch (e) {}
    forgetThemeColors();
    if (state.routes.length) { drawRoute({ fit: false }); drawWeatherMarkers(); }
    renderElevation();
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
    if (overviewBtn) overviewBtn.hidden = !state.routes.length;
    if (markBtn) markBtn.hidden = riding;
    if (locateBtn) {
      var label = riding ? "Re-centre on me" : "Use my location";
      locateBtn.setAttribute("aria-label", label);
      locateBtn.title = label;
    }
    updateBottomVar();
  }

  /* How much room the bottom overlay is taking. The map controls, the
     re-centre pill and the alert all clear it, in every mode, without any of
     them having to know which overlay is up. */
  function updateBottomVar() {
    var el = state.mode === "plan" ? RC.el("dock") : RC.el("hud");
    var h = 0;
    if (el && !el.hidden) {
      var rect = el.getBoundingClientRect();
      // In landscape the HUD is a side column and takes no bottom room.
      var landscapeColumn = window.matchMedia &&
        window.matchMedia("(orientation: landscape) and (max-height: 620px)").matches;
      if (!(landscapeColumn && el.id === "hud")) h = Math.round(rect.height) + 6;
    }
    document.documentElement.style.setProperty("--rc-bottom-h", h + "px");
  }

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
    if (RC.compass.isRotated()) RC.compass.setMode("north", { gesture: false });
    // Deliberate: the camera stands down until Re-centre rather than
    // undoing this on the next fix.
    RC.follow.release();
    RC.follow.silently(function () {
      map.fitBounds(L.latLngBounds(route.coords).pad(0.12));
    });
  }

  function zoomBy(delta) {
    if (!map) return;
    RC.follow.silently(function () {
      map.setZoomAround(map.getCenter(), map.getZoom() + delta);
    });
    // A tap on + or - is as deliberate as a pinch, and must survive the next
    // fix. silently() hides it from the gesture heuristics, so say it here.
    RC.follow.setZoom(map.getZoom());
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
    if (name === "marks") renderMarks();
    if (name === "you") { renderHistoryPanel(); renderFreeSummary(); }
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
    lastHudRenderTs = 0;
    hudPodKeys = "";
    drawMarks();
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
      RC.follow.enable({ zoom: Math.max(map.getZoom(), NAV_ZOOM) });
    }, function (err) {
      setStatus(err && err.message ? err.message : "Could not start navigation.", "error");
      setMode("plan");
    });
  }

  function stopNav() {
    var learned = RC.nav.stop();
    navTargets = [];
    navRerouteToken++;
    navDistanceAlong = 0;
    RC.compass.reset();
    RC.compass.setMode("north", { gesture: false });
    RC.follow.disable();
    if (riderMarker) { map.removeLayer(riderMarker); riderMarker = null; riderArrow = null; }
    setMode("plan");
    renderHistoryPanel();
    if (learned) {
      var pct = Math.round((learned.actualS / learned.plannedS - 1) * 100);
      setStatus(pct === 0
        ? "Ride recorded — that one ran exactly to the estimate."
        : "Ride recorded — you ran " + Math.abs(pct) + "% " + (pct > 0 ? "slower" : "faster") +
          " than the estimate. Future ETAs will account for it.", "");
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
    setStatus("Starting the recorder…", "busy");
    RC.free.start({ vehicle: state.vehicle }).then(function () {
      setStatus("", "");
      setMode("free");
      state.freeSummary = null;
      if (!freeTrackLayer) {
        freeTrackLayer = L.polyline([], { color: themeColors().accent, weight: 5, opacity: 0.9 }).addTo(map);
      } else {
        freeTrackLayer.setLatLngs([]);
      }
      RC.follow.enable({ zoom: Math.max(map.getZoom(), NAV_ZOOM) });
    }, function (err) {
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
    setMode("plan");
    renderHistoryPanel();
    renderFreeSummary();
    if (summary && summary.distanceM > 200) {
      setStatus("Ride recorded — " + RC.fmtDist(summary.distanceM, state.units) + " in " +
        RC.fmtDur(summary.elapsedS) + ". The roads are yours now.", "");
      flashStatus(5000);
      // The line stays on the map until the next ride or a reset: it is the
      // only record of the shape of the ride, and throwing it away the
      // instant you stop is the wrong instinct.
    } else {
      if (freeTrackLayer) { map.removeLayer(freeTrackLayer); freeTrackLayer = null; }
      setStatus("Ride was too short to keep.", "");
      flashStatus();
    }
  }

  // One forecast for where the rider actually is, on free drive's own gate.
  function fetchLocalWeather(fs) {
    var point = [{ lat: fs.lat, lon: fs.lon, eta: new Date() }];
    return RC.weather.forecastSeries(point, { maxAgeMs: WX_REUSE_MS }).then(function (series) {
      if (!RC.free.isActive()) return;
      var wx = RC.weather.sampleSeries(series, 0, new Date());
      RC.free.setWeather(wx);
    }, function () { /* no forecast is not a reason to stop the ride */ });
  }

  /* ---------------------------------------------------------
     The HUD

     Pods are rebuilt only when the SET of them changes; otherwise their
     values are written in place. Rebuilding ten elements four times a second
     under a moving map is how a dashboard starts dropping frames.
     --------------------------------------------------------- */
  var hudPodKeys = "";
  var hudPodEls = {};

  function setPods(defs) {
    var wrap = RC.el("hud-pods");
    if (!wrap) return;
    var keys = defs.map(function (d) { return d.k; }).join("|");
    if (keys !== hudPodKeys) {
      var html = "";
      for (var i = 0; i < defs.length; i++) {
        html += '<div class="rc-pod" data-k="' + RC.escapeHtml(defs[i].k) + '">' +
                  '<span class="rc-pod-k">' + RC.escapeHtml(defs[i].k) + "</span>" +
                  '<span class="rc-pod-v"></span>' +
                "</div>";
      }
      wrap.innerHTML = html;
      hudPodKeys = keys;
      hudPodEls = {};
      var nodes = wrap.querySelectorAll(".rc-pod");
      for (var n = 0; n < nodes.length; n++) {
        hudPodEls[nodes[n].getAttribute("data-k")] = {
          pod: nodes[n],
          v: nodes[n].querySelector(".rc-pod-v")
        };
      }
    }
    for (var d = 0; d < defs.length; d++) {
      var def = defs[d];
      var el = hudPodEls[def.k];
      if (!el) continue;
      if (def.html != null) el.v.innerHTML = def.html;
      else el.v.textContent = def.v == null ? "—" : def.v;
      el.pod.className = "rc-pod" + (def.level ? " is-" + def.level : "") + (def.wide ? " is-wide" : "");
    }
  }

  function renderSpeed(kmh) {
    var el = RC.el("hud-speed");
    var unit = RC.el("hud-speed-unit");
    if (!el) return;
    if (kmh == null) {
      el.textContent = "no fix";
      el.setAttribute("data-empty", "yes");
    } else {
      el.textContent = String(state.units === "imperial" ? Math.round(kmh / 1.609344) : Math.round(kmh));
      el.removeAttribute("data-empty");
    }
    if (unit) unit.textContent = state.units === "imperial" ? "mph" : "km/h";
  }

  function gpsLevel(accuracy) {
    if (accuracy == null) return "clear";
    return accuracy > 40 ? "caution" : accuracy > 20 ? "watch" : "clear";
  }

  function renderNavHud(ns) {
    navDistanceAlong = ns.distanceAlong;

    renderSpeed(ns.displaySpeedKmh);

    var next = ns.nextCheckpoint;
    var nextHtml = "—";
    var nextLevel = "clear";
    if (next) {
      var wx = next.wx || {};
      nextLevel = levelOf(next);
      var desc = wx.outOfRange ? { icon: "cloud" } : RC.weather.describe(wx.code, wx.isDay);
      nextHtml = RC.icons.weather(desc.icon) +
        "<span>" + (wx.outOfRange ? "—" : RC.escapeHtml(RC.fmtTemp(wx.tempC, state.units))) + "</span>";
    }

    var traffic = RC.traffic.level(new Date());

    setPods([
      { k: "Left", v: RC.fmtDist(ns.remainingM, state.units) },
      { k: "Arrive", v: RC.fmtTime(ns.etaDate) },
      { k: "Time", v: RC.fmtDur(ns.remainingS) },
      { k: "Sky ahead", html: nextHtml, level: nextLevel },
      { k: "Elapsed", v: RC.fmtDur(ns.elapsedS) },
      { k: "Average", v: ns.avgSpeedKmh == null ? "—" : RC.fmtSpeed(ns.avgSpeedKmh, state.units) },
      { k: "Elev", v: ns.elevationM == null ? "—" : RC.fmtDist(Math.round(ns.elevationM), state.units) },
      { k: "Grade", v: ns.gradePct == null ? "—" : ((ns.gradePct > 0 ? "+" : "") + ns.gradePct.toFixed(1) + "%") },
      { k: "Traffic", v: RC.traffic.LEVELS[traffic].label, level: trafficLevelClass(traffic) },
      { k: "GPS", v: ns.accuracy == null ? "—" : ("±" + RC.fmtDist(ns.accuracy, state.units)), level: gpsLevel(ns.accuracy) }
    ]);

    var fill = RC.el("hud-progress-fill");
    if (fill) fill.style.width = Math.round(ns.progress * 100) + "%";
    renderHudTicks();
    renderTurn(ns);

    var alertEl = RC.el("nav-alert");
    var cautionAhead = nextLevel === "caution" || nextLevel === "danger";
    if (alertEl) {
      if (ns.offRoute) {
        alertEl.hidden = false;
        alertEl.setAttribute("data-level", "caution");
        alertEl.innerHTML = RC.icons.ui("alert") + "<span>You're off the planned route.</span>";
      } else if (cautionAhead) {
        alertEl.hidden = false;
        alertEl.setAttribute("data-level", nextLevel);
        var place = (next && next.label) || "the next checkpoint";
        alertEl.innerHTML = RC.icons.ui("alert") + "<span>" +
          RC.escapeHtml((nextLevel === "danger" ? "Danger conditions ahead at " : "Caution ahead at ") + place) +
          "</span>";
      } else {
        alertEl.hidden = true;
      }
    }

    var t = Date.now();
    if (t - lastHudRenderTs >= 5000) {
      lastHudRenderTs = t;
      renderTimeline();
      drawWeatherMarkers();
      renderElevation();
    }
  }

  function renderHudTicks() {
    var track = RC.el("hud-progress");
    if (!track) return;
    var old = track.querySelectorAll(".rc-hud-tick");
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    var route = state.routes[state.routeIndex];
    var cps = state.checkpoints;
    if (!route || !cps.length || !route.distance) return;
    for (var j = 0; j < cps.length; j++) {
      var pct = RC.clamp(cps[j].distance / route.distance * 100, 0, 100);
      var tick = document.createElement("span");
      tick.className = "rc-hud-tick is-" + levelOf(cps[j]);
      tick.style.left = pct + "%";
      track.appendChild(tick);
    }
  }

  function renderTurn(ns) {
    var box = RC.el("turn-banner");
    var textEl = RC.el("turn-text");
    var distEl = RC.el("turn-dist");
    if (!box || !textEl || !distEl) return;
    if (!ns.nextStep) {
      textEl.textContent = "Continue to your destination";
      distEl.textContent = "";
      box.removeAttribute("data-soon");
      return;
    }
    textEl.textContent = ns.nextStep.text;
    distEl.textContent = RC.fmtDist(ns.nextStep.distanceM, state.units);
    if (ns.nextStep.distanceM < 150) box.setAttribute("data-soon", "yes");
    else box.removeAttribute("data-soon");
  }

  function renderFreeHud(fs) {
    renderSpeed(fs.displaySpeedKmh);

    var wxHtml = "—";
    var wxLevel = null;
    if (fs.wx && !fs.wx.outOfRange) {
      var desc = RC.weather.describe(fs.wx.code, fs.wx.isDay);
      wxHtml = RC.icons.weather(desc.icon) + "<span>" + RC.escapeHtml(RC.fmtTemp(fs.wx.tempC, state.units)) + "</span>";
      wxLevel = RC.risk.score(fs.wx, state.vehicle).level;
    }
    var traffic = RC.traffic.level(new Date());

    setPods([
      { k: "Distance", v: RC.fmtDist(fs.distanceM, state.units) },
      { k: "Elapsed", v: RC.fmtDur(fs.elapsedS) },
      { k: "Moving", v: RC.fmtDur(fs.movingS) },
      { k: "Average", v: fs.avgSpeedKmh == null ? "—" : RC.fmtSpeed(fs.avgSpeedKmh, state.units) },
      { k: "Top", v: fs.maxSpeedKmh == null ? "—" : RC.fmtSpeed(fs.maxSpeedKmh, state.units) },
      { k: "Sky here", html: wxHtml, level: wxLevel },
      { k: "Elev", v: fs.elevationM == null ? "—" : RC.fmtDist(Math.round(fs.elevationM), state.units) },
      { k: "Climb", v: fs.climbM > 0 ? "+" + RC.fmtDist(fs.climbM, state.units) : "—" },
      { k: "Traffic", v: RC.traffic.LEVELS[traffic].label, level: trafficLevelClass(traffic) },
      { k: "GPS", v: fs.accuracy == null ? "—" : ("±" + RC.fmtDist(fs.accuracy, state.units)), level: gpsLevel(fs.accuracy) }
    ]);

    var label = RC.el("free-label");
    if (label) {
      label.textContent = "Recording · " + RC.fmtDist(fs.distanceM, state.units) + " · " + RC.fmtDur(fs.elapsedS);
    }

    var t = Date.now();
    if (freeTrackLayer && t - lastFreeTrackTs >= 2000) {
      lastFreeTrackTs = t;
      freeTrackLayer.setLatLngs(fs.track);
    }
  }

  function riderIconHtml() {
    return '<span class="rc-rider"><svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 3.2 18.4 19 12 15.4 5.6 19 12 3.2Z" fill="currentColor"/></svg></span>';
  }

  /* The marker moves; the CAMERA is RC.follow's business. Keeping those two
     apart is what stopped the map fighting the rider's thumb. */
  function updateRiderMarker(lat, lon, courseDeg) {
    if (!map) return;
    var latlng = [lat, lon];
    if (!riderMarker) {
      riderMarker = L.marker(latlng, {
        icon: L.divIcon({ className: "", html: riderIconHtml(), iconSize: [26, 26], iconAnchor: [13, 13] }),
        zIndexOffset: 1000,
        keyboard: false
      }).addTo(map);
      riderArrow = null;
    } else {
      riderMarker.setLatLng(latlng);
    }

    if (!riderArrow && riderMarker.getElement) {
      var el = riderMarker.getElement();
      riderArrow = el ? el.querySelector(".rc-rider") : null;
    }
    if (riderArrow && courseDeg != null) {
      riderArrow.style.transform = "rotate(" + Math.round(courseDeg) + "deg)";
    }

    RC.follow.setTarget(lat, lon, { rotated: RC.compass.isRotated(), minZoom: NAV_ZOOM });
  }

  RC.nav.onUpdate = function (ns) {
    RC.compass.setCourse(ns.headingDeg, ns.speedKmh, ns.courseDeg);
    renderNavHud(ns);
    updateRiderMarker(ns.lat, ns.lon, ns.courseDeg);
    dropPassedTargets(ns.distanceAlong);
  };
  RC.nav.onArrive = function () { setStatus("You've arrived.", ""); flashStatus(5000); stopNav(); };
  RC.nav.onOffRoute = function (ns) {
    var alertEl = RC.el("nav-alert");
    if (ns && ns.error) { setStatus(ns.error, "error"); return; }
    if (alertEl && ns) {
      alertEl.hidden = false;
      alertEl.setAttribute("data-level", "caution");
      alertEl.innerHTML = RC.icons.ui("alert") + "<span>You're off the planned route.</span>";
    }
  };
  RC.nav.onReroute = reroute;
  RC.nav.onWeatherRefresh = refreshDownstreamWeather;

  RC.free.onUpdate = function (fs) {
    RC.compass.setCourse(fs.headingDeg, fs.speedKmh, null);
    renderFreeHud(fs);
    updateRiderMarker(fs.lat, fs.lon, fs.courseDeg);
  };
  RC.free.onWeather = fetchLocalWeather;
  RC.free.onError = function (msg) { setStatus(msg, "error"); };

  /* ---------------------------------------------------------
     Wiring
     --------------------------------------------------------- */
  function init() {
    initMap();
    initPick();

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
    RC.el("ctl-compass").addEventListener("click", function () { RC.compass.cycle(); });
    RC.el("ctl-overview").addEventListener("click", showOverview);
    RC.el("ctl-mark").addEventListener("click", markMapCentre);
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

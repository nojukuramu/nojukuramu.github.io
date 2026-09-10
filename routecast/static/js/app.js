/* ============================================================
   RouteCast — the glue.
   Owns the map, the form, and the render pipeline:
     geocode -> route -> sample -> forecast -> score -> draw
   ============================================================ */
(function () {
  "use strict";

  var MAP_START = { lat: 14.5995, lon: 120.9842, zoom: 6 };

  var state = {
    vehicle: RC.store.get("vehicle", "car"),
    units: RC.store.get("units", "metric"),
    interval: RC.store.get("interval", "auto"),
    departMode: "now",
    departAt: null,          // Date
    endpoints: [],           // [{key, place, inputEl, resultsEl}]
    routes: [],
    routeIndex: 0,
    checkpoints: [],
    series: null,
    trip: null,
    profile: null,          // elevation profile for the selected route
    traffic: null,          // per-checkpoint congestion readings
    calibration: null,      // where this ETA's numbers came from
    preferredByHistory: false,
    selected: -1,
    planToken: 0,
    elevToken: 0
  };

  var map, tileLayer, routeLayers = [], dotLayer, chipLayer, endpointLayer, activeRequest = null;

  // Live navigation
  var riderMarker = null, riderArrow = null, navFollowStarted = false, lastNavRenderTs = 0;
  // The places still to be reached, in order, with where each one falls along
  // the CURRENT route. Rebuilt whenever the route is replaced; a reroute asks
  // OSRM for a line from where the rider is now through whatever is left.
  var navTargets = [];
  var navRerouteToken = 0;

  // Live weather refresh: a checkpoint that was refetched less than this ago
  // is left alone. Open-Meteo publishes hourly, so anything shorter is spend
  // for spend's sake.
  var WX_REUSE_MS = 10 * 60 * 1000;
  // How far ahead a live refresh bothers looking. A forecast eight hours out
  // is a mood, not a fact; refetching it every quarter hour buys nothing.
  var WX_REFRESH_MAX_POINTS = 24;

  // Centre-pin picker
  var pickPrevSheet = null, activePickTrigger = null;

  // 76px screen-space decluttering threshold for weather chips (CONTRACT2.md).
  var CHIP_W = 84, CHIP_H = 34, CHIP_GAP = 4;
  // The start and destination pins stand on the same coordinate as the first
  // and last checkpoints, so those chips are lifted clear of the pin.
  var PIN_LIFT = 30;

  /* ---------------------------------------------------------
     Map
     --------------------------------------------------------- */
  function initMap() {
    map = L.map("map", { zoomControl: false, attributionControl: false })
      .setView([MAP_START.lat, MAP_START.lon], MAP_START.zoom);
    // No Leaflet zoom control: it lives inside the rotated map element, so
    // course-up both tilts it and pushes it off screen (which is why it used
    // to be hidden outright in that mode, leaving a rider with no zoom at
    // all). RouteCast's own buttons sit outside the rotated element in
    // #map-controls and work in every mode.
    tileLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      crossOrigin: true
    }).addTo(map);
    dotLayer = L.layerGroup().addTo(map);
    chipLayer = L.layerGroup().addTo(map);
    endpointLayer = L.layerGroup().addTo(map);

    // Re-declutter the weather chips whenever the screen-space layout changes.
    // While navigating, the map moves with every GPS fix and the chips are
    // already redrawn on renderNavHud's 5-second throttle — re-declutterng 48
    // markers once a second on top of that is pure waste.
    map.on("zoomend", redrawChips);
    map.on("moveend", function () { if (!RC.nav.isActive()) redrawChips(); });

    RC.compass.init({
      map: map,
      mapEl: RC.el("map"),
      wrapEl: RC.el("map-wrap"),
      onModeChange: renderCompassBtn
    });
    renderCompassBtn(RC.compass.getMode());

    // Right-click / long-press to drop a destination.
    map.on("contextmenu", function (e) {
      setEndpointFromLatLon(lastEmptyEndpoint(), e.latlng.lat, e.latlng.lng);
    });
  }

  function lastEmptyEndpoint() {
    for (var i = 0; i < state.endpoints.length; i++) {
      if (!state.endpoints[i].place) return state.endpoints[i];
    }
    return state.endpoints[state.endpoints.length - 1];
  }

  /* Set an endpoint from a raw coordinate — a long-press on the map, a GPS
     fix, a confirmed pin.

     The coordinate is the point. A reverse geocode is asked for afterwards
     purely so the field can show a readable NAME, and its own lat/lon are
     thrown away: Nominatim answers with the centroid of whatever feature it
     matched, which is routinely a block away and occasionally on the far
     side of a river. Marking a spot and being routed to the nearest
     landmark's front door instead is exactly the behaviour this avoids.
     `precise: true` records that this point came from a real coordinate and
     not from a search result, and it survives being saved and reloaded. */
  function setEndpointFromLatLon(ep, lat, lon, opts) {
    if (!ep) return;
    opts = opts || {};
    var label = fmtCoordLabel(lat, lon);
    ep.place = {
      name: opts.name || label,
      address: opts.address || label,
      lat: lat,
      lon: lon,
      precise: true
    };
    ep.inputEl.value = ep.place.name;
    drawEndpoints();
    saveTrip();
    if (opts.skipReverse) return;

    RC.geocode.reverse(lat, lon).then(function (place) {
      // Still the same pin? Take the label only — never the coordinates.
      if (ep.place && ep.place.lat === lat && ep.place.lon === lon) {
        ep.place = {
          name: place.name,
          address: place.address,
          lat: lat,
          lon: lon,
          precise: true
        };
        ep.inputEl.value = place.name;
        drawEndpoints();
        saveTrip();
      }
    }, function () { /* the raw coordinates are a fine fallback */ });
  }

  // Five decimals is about a metre — the resolution the pin actually has.
  function fmtCoordLabel(lat, lon) {
    return lat.toFixed(5) + ", " + lon.toFixed(5);
  }

  /* ---------------------------------------------------------
     Endpoints (from / stops / to) with Nominatim autocomplete
     --------------------------------------------------------- */
  function makeEndpoint(key, inputEl, resultsEl) {
    var ep = { key: key, place: null, inputEl: inputEl, resultsEl: resultsEl, seq: 0, active: -1, items: [] };

    var run = RC.debounce(function () {
      var q = inputEl.value.trim();
      if (q.length < 3) { closeResults(ep); return; }
      var mySeq = ++ep.seq;
      var near = map ? { lat: map.getCenter().lat, lon: map.getCenter().lng } : null;
      RC.geocode.search(q, { limit: 6, near: near }).then(function (places) {
        if (mySeq !== ep.seq) return;   // a newer keystroke already won
        renderResults(ep, places);
      }, function () {
        if (mySeq !== ep.seq) return;
        closeResults(ep);
      });
    }, 350);

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
      setTimeout(function () { closeResults(ep); }, 150);
    });
    return ep;
  }

  function renderResults(ep, places) {
    ep.items = places || [];
    ep.active = -1;
    if (!ep.items.length) { closeResults(ep); return; }
    var html = "";
    for (var i = 0; i < ep.items.length; i++) {
      var p = ep.items[i];
      html += '<li class="rc-result" data-i="' + i + '" role="option">' +
                '<span class="rc-result-name">' + RC.escapeHtml(p.name) + "</span>" +
                '<span class="rc-result-addr">' + RC.escapeHtml(p.address) + "</span>" +
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
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle("is-active", i === ep.active);
    }
    if (nodes[ep.active] && nodes[ep.active].scrollIntoView) {
      nodes[ep.active].scrollIntoView({ block: "nearest" });
    }
  }

  function choose(ep, place) {
    if (!place) return;
    ep.place = place;
    ep.inputEl.value = place.name;
    closeResults(ep);
    drawEndpoints();
    saveTrip();
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
    if (pts.length && !state.routes.length) {
      map.fitBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 13 });
    }
  }

  /* ---------------------------------------------------------
     Stops
     --------------------------------------------------------- */
  function addStop() {
    var wrap = RC.el("stops");
    var row = document.createElement("div");
    row.className = "rc-stop-row";
    var id = "stop-" + Date.now();
    row.innerHTML =
      '<div class="rc-field-group">' +
        '<div class="rc-input-row">' +
          '<input type="text" class="rc-input" id="' + id + '" placeholder="Stop along the way" autocomplete="off" spellcheck="false" />' +
          '<button type="button" class="rc-stop-pick" aria-label="Pick on map" title="Pick on map">' + RC.icons.ui("pin") + "</button>" +
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
    ep.inputEl.focus();
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
    // Anything typed but never picked from the list gets geocoded now.
    var jobs = [];
    for (var i = 0; i < state.endpoints.length; i++) {
      (function (ep) {
        if (ep.place) { jobs.push(Promise.resolve(ep.place)); return; }
        var q = ep.inputEl.value.trim();
        if (!q) { jobs.push(Promise.resolve(null)); return; }
        jobs.push(RC.geocode.search(q, { limit: 1 }).then(function (places) {
          if (!places || !places.length) throw RC.error('Could not find "' + q + '".', "geocode");
          ep.place = places[0];
          ep.inputEl.value = places[0].name;
          return places[0];
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
        return RC.router.route(places, { vehicle: state.vehicle, alternatives: true, signal: signal });
      })
      .then(function (routes) {
        if (token !== state.planToken || !routes) return null;

        var depart = departureDate();
        state.departAt = depart;

        /* Two passes over the alternatives before anything is drawn.

           First: rank them by how much of each runs over roads this rider
           has actually used. A line you know is worth a few minutes — you
           know where the potholes are, where the flooding sits, and which
           junction is a nightmare at six. rankRoutes only promotes a route
           that is meaningfully more familiar AND not meaningfully slower,
           so this never quietly hands you a scenic detour.

           Second: calibrate every route's timings (see eta.js). This must
           happen before sampling, because the checkpoint ETAs are what the
           forecast hour is read at — an ETA that runs half an hour fast
           fetches the wrong weather for the right place. */
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
    // The route handed in here is already calibrated, so its cumDur is what
    // the rider will really experience and the sampler's ETAs are honest.
    state.calibration = route.calibration || null;
    // "auto" leaves everyKm unset so RC.sampler falls back to its own
    // autoSpacingKm ladder, and maxPoints unset so it defaults to 48.
    var sampleOpts = { departAt: depart };
    if (state.interval !== "auto") sampleOpts.everyKm = parseInt(state.interval, 10);
    var checkpoints = RC.sampler.sample(route, sampleOpts);
    setStatus("Reading the sky at " + checkpoints.length + " points along the way…", "busy");

    // The terrain runs in parallel and is never allowed to hold the weather
    // up or fail the plan — a route without an elevation profile is still a
    // perfectly good route.
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

  /* ---------------------------------------------------------
     Terrain — one Open-Meteo elevation request per route, cached by
     coordinate so alternatives that share most of their line are nearly
     free. Failure is silent by design: the profile is a bonus panel, and a
     rider who cannot see the climb is no worse off than before it existed.
     --------------------------------------------------------- */
  function loadElevation(route, token) {
    var myToken = ++state.elevToken;
    state.profile = null;
    renderElevation();
    RC.elevation.profile(route).then(function (profile) {
      if (myToken !== state.elevToken || token !== state.planToken) return;
      state.profile = profile;
      renderElevation();
      renderFacts();
      // A ride already under way gets the profile as soon as it lands, so
      // the elevation tile stops reading "—" mid-route.
      if (RC.nav.isActive()) RC.nav.setProfile(profile);
    }, function () {
      if (myToken !== state.elevToken) return;
      state.profile = null;
      renderElevation();
    });
  }

  // Name the first and last checkpoints after the places the user typed; leave the
  // middle ones showing distance travelled, which is more useful than a reverse geocode.
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

    // risk.js asks about arbitrary distances along the route; answer with the
    // nearest checkpoint we already have a forecast series for, so re-scoring
    // ten departure times costs no extra requests.
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
    }, function () { /* the planner is a bonus; a failure here is not fatal */ });
  }

  /* ---------------------------------------------------------
     Rendering
     --------------------------------------------------------- */
  function render() {
    var empty = RC.el("empty-state");
    if (empty) empty.hidden = true;
    // Results are inserted above the form, and the browser's scroll anchoring
    // compensates to keep the just-pressed button still — which lands the
    // rider in the middle of the form instead of on their trip. Go to the top.
    var scroller = document.querySelector(".rc-panel-scroll");
    if (scroller) scroller.scrollTop = 0;
    drawRoute();
    drawWeatherMarkers();
    renderSummary();
    renderFacts();
    renderElevation();
    renderAlternatives();
    renderTimeline();
    renderDetails();
    renderPeekBar();
    renderSavedRoutes();
    renderHistoryPanel();
    updateNavControlsVisibility();
    if (sheetIsMobile() && !sheetIsDrawer()) setSheet("half");
  }

  function levelOf(cp) {
    if (!cp || !cp.wx) return "clear";
    return RC.risk.score(cp.wx, state.vehicle).level;
  }

  /* Route colours come from the stylesheet, not from a second copy of the
     palette hard-coded here — otherwise a theme change repaints the panel
     and leaves the line on the map in last season's colours. Read once per
     theme and cached, because getComputedStyle in a redraw loop is not free. */
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

  // opts.fit === false keeps the current view — a live reroute redraws the
  // line under a moving rider and must not yank the map back to a whole-route
  // overview mid-ride.
  function drawRoute(opts) {
    for (var i = 0; i < routeLayers.length; i++) map.removeLayer(routeLayers[i]);
    routeLayers = [];
    var route = state.routes[state.routeIndex];
    if (!route) return;

    // Ghost the alternatives underneath so they stay clickable.
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

    // Casing, then one coloured segment per checkpoint span.
    routeLayers.push(L.polyline(route.coords, { color: themeColors().casing, weight: 9, opacity: 0.18 }).addTo(map));
    var cps = state.checkpoints;
    if (cps.length < 2) {
      routeLayers.push(L.polyline(route.coords, { color: themeColors().accent, weight: 5 }).addTo(map));
    } else {
      for (var c = 0; c < cps.length - 1; c++) {
        var seg = route.coords.slice(cps[c].i, cps[c + 1].i + 1);
        if (seg.length < 2) continue;
        // A span is as bad as the worse of the two checkpoints that bracket it.
        var la = levelOf(cps[c]), lb = levelOf(cps[c + 1]);
        var rank = { clear: 0, watch: 1, caution: 2, danger: 3 };
        var worse = rank[lb] > rank[la] ? lb : la;
        routeLayers.push(L.polyline(seg, { color: colorFor(worse), weight: 5, opacity: 0.95 }).addTo(map));
      }
    }
    if (!opts || opts.fit !== false) map.fitBounds(L.latLngBounds(route.coords).pad(0.12));
  }

  // Every checkpoint gets a small dot exactly on its coordinate; a subset
  // that survives screen-space decluttering also gets a weather chip.
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

  // Screen-space decluttering: with up to 48 checkpoints, every one gets a
  // dot but only those whose chips do not collide get a chip. Recomputed on
  // zoomend/moveend as well as on redraw.
  function chipLift(i, total) {
    return (i === 0 || i === total - 1) ? PIN_LIFT : 0;
  }

  function declutterIndices(cps) {
    var kept = [];
    if (!map || !cps.length) return kept;

    // A chip is CHIP_W x CHIP_H, anchored bottom-centre on its coordinate, so
    // its box runs from (x - CHIP_W/2, y - CHIP_H) to (x + CHIP_W/2, y).
    // Testing real boxes rather than a single radius matters because chips
    // stacked vertically need far less room than chips side by side.
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
    function hits(a, b) {
      return !(a.r < b.l || a.l > b.r || a.b < b.t || a.t > b.b);
    }

    var boxes = [];
    function place(i) {
      var box = boxAt(cps[i], i);
      for (var n = 0; n < boxes.length; n++) {
        if (hits(box, boxes[n])) return false;
      }
      kept.push(i);
      boxes.push(box);
      return true;
    }

    // The start always gets a chip.
    place(0);
    for (var i = 1; i < cps.length - 1; i++) place(i);

    // So does the destination — and it outranks whatever it lands on top of,
    // otherwise the one checkpoint the rider most wants to read is the one
    // that gets dropped.
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
        // The stem tip must land exactly on the coordinate: the wrapper is
        // sized to the divIcon's iconSize and centres/bottoms the chip
        // inside it, so iconAnchor (bottom-centre of that box) lines up
        // with where the chip's stem points.
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

    // The badge stays a short level label — the reasons live in the advice
    // list below it, where there's room to wrap instead of overflowing.
    var verdict = RC.el("summary-verdict");
    verdict.className = "rc-badge is-" + trip.level;
    verdict.textContent = RC.risk.LEVELS[trip.level].label;

    RC.el("summary-rain").textContent = trip.rainMinutes > 0
      ? "About " + RC.fmtDur(trip.rainMinutes * 60) + " of this ride is in the wet."
      : "No precipitation expected on the way.";

    // Where this ETA came from, in a sentence. The forecast is timed off it,
    // so a rider is entitled to know whether it is a model or a measurement.
    var etaNote = RC.el("summary-eta-note");
    if (etaNote) etaNote.textContent = RC.eta.explain(state.calibration, state.vehicle);

    // Riders are legally barred from PH expressways — never silently pretend
    // motorcycle avoidance worked (or didn't) when it's not true.
    var motorNote = [];
    if (state.vehicle === "motorcycle") {
      if (route.motorwayAvoidanceFailed) {
        motorNote.push(route.motorwayAvoidanceReason === "no-route"
          ? "No expressway-free route exists between these points — this route may use expressways, which motorcycles cannot legally ride in the Philippines."
          : "The routing server could not exclude expressways, so RouteCast picked the offered route that spends the fewest kilometres on one — check the signage yourself and take the surface roads.");
      } else if (route.avoidedMotorways) {
        motorNote.push("Expressways avoided — this route asked the router to keep off motorway-class roads.");
      }
      // A second, independent check on the line we actually got back. An
      // accepted exclusion still cannot catch an expressway that OSM has
      // tagged as trunk rather than motorway, and the rider would rather be
      // warned by name than discover it at the toll gate.
      var named = route.expresswayNames || [];
      if (named.length) {
        motorNote.push("This route names " + named.slice(0, 3).join(", ") +
          " — motorcycles are barred from Philippine expressways, so treat that stretch as a road to leave before, not to ride.");
      }
    }

    if (state.preferredByHistory && route.familiarity && route.familiarity.score > 0) {
      motorNote.push("Chosen over the fastest line because " +
        Math.round(route.familiarity.score * 100) + "% of it runs on roads you have already ridden.");
    }

    var advice = motorNote.concat(trip.advice).concat(trip.reasons);
    var html = "";
    for (var i = 0; i < Math.min(advice.length, 7); i++) {
      html += '<li class="rc-advice">' + RC.escapeHtml(advice[i]) + "</li>";
    }
    RC.el("summary-advice").innerHTML = html;
  }

  /* ---------------------------------------------------------
     Trip facts — the numbers that matter to a driver and that nothing else
     on the page was saying: terrain, congestion, and how much of this road
     is already yours.
     --------------------------------------------------------- */
  function renderFacts() {
    var wrap = RC.el("trip-facts");
    if (!wrap) return;
    var route = state.routes[state.routeIndex];
    if (!route) { wrap.innerHTML = ""; return; }

    var facts = [];

    var worst = state.checkpoints.length ? RC.traffic.worst(state.checkpoints, state.vehicle) : null;
    if (worst) {
      facts.push({
        k: "Traffic", v: worst.label,
        sub: "worst around " + RC.fmtTime(worst.at), level: trafficLevelClass(worst.level)
      });
    } else if (state.checkpoints.length) {
      facts.push({ k: "Traffic", v: "Free flowing", sub: "all the way", level: "clear" });
    }

    if (state.profile) {
      facts.push({ k: "Climb", v: "+" + RC.fmtDist(state.profile.climbM, state.units) });
      facts.push({ k: "Descent", v: "-" + RC.fmtDist(state.profile.descentM, state.units) });
      facts.push({ k: "Highest", v: RC.fmtDist(Math.round(state.profile.maxM), state.units) });
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

  /* ---------------------------------------------------------
     Elevation profile — an inline SVG area chart, drawn from the DEM
     samples. Deliberately small and unlabelled except for its extremes:
     the point is the SHAPE of the ride, not a reading you take numbers off.
     --------------------------------------------------------- */
  var ELEV_W = 320, ELEV_H = 72, ELEV_PAD = 6;

  function renderElevation() {
    var box = RC.el("elev-profile");
    if (!box) return;
    var p = state.profile;
    if (!p || p.points.length < 2) { box.hidden = true; box.innerHTML = ""; return; }

    var pts = p.points;
    var totalM = pts[pts.length - 1].distance || 1;
    // A flat road would otherwise be drawn as a dramatic mountain range,
    // because the chart would scale a three-metre range to full height.
    var span = Math.max(p.maxM - p.minM, 40);
    var mid = (p.maxM + p.minM) / 2;
    var lo = mid - span / 2, hi = mid + span / 2;

    function x(d) { return ELEV_PAD + (d / totalM) * (ELEV_W - ELEV_PAD * 2); }
    function y(e) {
      return ELEV_H - ELEV_PAD - ((e - lo) / (hi - lo)) * (ELEV_H - ELEV_PAD * 2);
    }

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

  // A tick showing where the rider currently is on the profile, while riding.
  var navDistanceAlong = 0;
  function navElevMarker(x, totalM) {
    if (!RC.nav.isActive() || !(navDistanceAlong > 0)) return null;
    var px = x(RC.clamp(navDistanceAlong, 0, totalM));
    return '<path class="rc-elev-here" d="M' + px.toFixed(1) + " " + ELEV_PAD +
           "L" + px.toFixed(1) + " " + (ELEV_H - ELEV_PAD) + '"/>';
  }

  function renderPeekBar() {
    var primary = RC.el("peek-bar-primary");
    var secondary = RC.el("peek-bar-secondary");
    var badge = RC.el("peek-bar-badge");
    if (!primary || !secondary || !badge) return;
    var route = state.routes[state.routeIndex];
    var trip = state.trip;
    if (!route || !trip) {
      primary.textContent = "Where to?";
      secondary.textContent = "";
      badge.textContent = "";
      badge.className = "rc-badge";
      return;
    }
    var arrival = new Date(state.departAt.getTime() + route.duration * 1000);
    primary.textContent = RC.fmtDist(route.distance, state.units) + " · " + RC.fmtDur(route.duration);
    secondary.textContent = "Arrive " + RC.fmtTime(arrival);
    badge.className = "rc-badge is-" + trip.level;
    badge.textContent = RC.risk.LEVELS[trip.level].label;
  }

  function peekBarTap() {
    var panel = RC.el("panel");
    if (!panel) return;
    // In landscape the panel is a side drawer with no snap points; the bar
    // collapses it to a strip so the map can own a short screen, and opens
    // it again. Snapping a drawer through three heights would be nonsense.
    if (sheetIsDrawer()) {
      panel.classList.toggle("is-collapsed");
      scheduleSheetVarSync();
      return;
    }
    if (!state.routes.length) { setSheet("open"); return; }
    var cur = panel.getAttribute("data-sheet");
    setSheet(cur === "open" ? "half" : "open");
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
      if (state.vehicle === "motorcycle" && r.expresswayNames && r.expresswayNames.length) {
        tags += '<span class="rc-alt-tag is-danger">uses ' + RC.escapeHtml(r.expresswayNames[0]) + "</span>";
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
      var meta = wx.outOfRange
        ? "no data"
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
      box.innerHTML = '<h3>' + RC.escapeHtml(cp.label || "Checkpoint") + "</h3>" +
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
      // Predicted for the hour you arrive here, not for the hour you left.
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
     Saved routes — a trip worth riding twice, kept by its points rather
     than its geometry (see routes.js for why).
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
    if (name === null) return;   // cancelled — not the same as an empty name
    try {
      RC.routes.save({
        name: name,
        places: places,
        vehicle: state.vehicle,
        interval: state.interval
      });
    } catch (err) {
      setStatus(err && err.message ? err.message : "Could not save that route.", "error");
      return;
    }
    renderSavedRoutes();
    setStatus("Saved.", "");
    setTimeout(function () {
      var el = RC.el("status");
      if (el && el.textContent === "Saved.") setStatus("", "");
    }, 2500);
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
        (r.useCount ? " · used " + r.useCount + "\u00d7" : "");
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

  /* Reload a saved route: rebuild the endpoints (stops included), restore the
     vehicle and spacing it was planned with, then plan it fresh. Nothing is
     replayed from a cached line — the roads, the traffic model and the sky
     have all moved on since it was saved. */
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
      var place = entry.places[e];
      state.endpoints[e].place = place;
      state.endpoints[e].inputEl.value = place.name;
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
    // setVehicle replans on its own when a route is already up; when there
    // isn't one, plan explicitly so a tapped saved route always does
    // something visible.
    var hadRoute = state.routes.length > 0;
    setVehicle(entry.vehicle);
    if (!hadRoute || state.vehicle === entry.vehicle) plan();
  }

  /* ---------------------------------------------------------
     Your roads — what the recorder has learned, and the one button that
     throws it away. Data collected about someone should always come with a
     way to see it and a way to delete it.
     --------------------------------------------------------- */
  function renderHistoryPanel() {
    var box = RC.el("history-summary");
    if (!box) return;
    var st = RC.history.stats();
    if (!st.edges && !st.trips) {
      box.innerHTML = '<p class="rc-history-empty">Nothing recorded yet. Navigate a route and ' +
        'RouteCast remembers the roads you actually took — never the ones it merely suggested — ' +
        'so later trips can prefer them and the ETA can learn how long you really take. ' +
        'It stays on this device.</p>';
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

  function clearHistory() {
    if (!window.confirm("Forget every road RouteCast has recorded, and the timings learned from them? This cannot be undone.")) return;
    RC.history.clear();
    renderHistoryPanel();
    setStatus("Recorded roads cleared.", "");
  }

  /* ---------------------------------------------------------
     Selection
     --------------------------------------------------------- */
  function selectCheckpoint(i) {
    state.selected = (state.selected === i) ? -1 : i;
    var cp = state.checkpoints[state.selected];
    if (cp) map.panTo([cp.lat, cp.lon]);
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
  function setStatus(msg, kind) {
    var el = RC.el("status");
    el.className = "rc-status" + (kind === "error" ? " rc-error" : kind === "busy" ? " rc-busy" : "");
    el.innerHTML = msg
      ? (kind === "busy" ? '<span class="rc-spinner" aria-hidden="true"></span>' : "") + RC.escapeHtml(msg)
      : "";
  }

  function setVehicle(v) {
    state.vehicle = v;
    RC.store.set("vehicle", v);
    RC.el("vehicle-car").setAttribute("aria-pressed", String(v === "car"));
    RC.el("vehicle-moto").setAttribute("aria-pressed", String(v === "motorcycle"));
    document.body.setAttribute("data-vehicle", v);
    var hint = RC.el("vehicle-hint");
    if (hint) {
      hint.textContent = v === "motorcycle"
        ? "Routes ask the router to exclude motorway-class roads: Philippine expressways are closed to motorcycles."
        : "";
    }
    if (state.routes.length) plan();
  }

  function setUnits(u) {
    state.units = u;
    RC.store.set("units", u);
    RC.el("units").textContent = u === "metric" ? "km" : "mi";
    RC.el("units").title = u === "metric" ? "Metric — tap for miles and °F" : "Imperial — tap for km and °C";
    if (state.checkpoints.length) { labelCheckpoints(); render(); }
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
      // The fix itself is the start, to the metre. Zoom in far enough that
      // the pin is visibly on a road rather than somewhere in a suburb.
      setEndpointFromLatLon(state.endpoints[0], pos.coords.latitude, pos.coords.longitude);
      map.setView([pos.coords.latitude, pos.coords.longitude], Math.max(map.getZoom(), 16));
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
  }

  function resetAll() {
    state.planToken++;
    if (activeRequest) activeRequest.abort();
    if (RC.nav.isActive()) stopNav();
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
    renderPeekBar();
    renderSavedRoutes();
    renderHistoryPanel();
    updateNavControlsVisibility();
    map.setView([MAP_START.lat, MAP_START.lon], MAP_START.zoom);
  }

  function saveTrip() {
    var places = [];
    for (var i = 0; i < state.endpoints.length; i++) {
      if (state.endpoints[i].place) places.push(state.endpoints[i].place);
    }
    RC.store.set("lastTrip", places);
  }

  function restoreTrip() {
    var places = RC.store.get("lastTrip", null);
    if (!places || places.length < 2) return;
    // Stops were being dropped on reload: only the two ends came back, and a
    // rider who had carefully placed three fuel stops found them gone. Rebuild
    // the middle rows first, then fill every endpoint in order.
    var mid = places.length - 2;
    for (var m = 0; m < mid; m++) addStop();
    for (var i = 0; i < state.endpoints.length && i < places.length; i++) {
      state.endpoints[i].place = places[i];
      state.endpoints[i].inputEl.value = places[i].name || "";
    }
    drawEndpoints();
  }

  /* ---------------------------------------------------------
     Floating map controls — #map-controls (zoom, compass, locate, overview, go)
     --------------------------------------------------------- */
  /* While navigating the control stack changes job. Starting a ride is no
     longer an option (the HUD owns stopping it), the overview button becomes
     the way back from a stray pan, and Locate re-centres on the rider rather
     than asking the browser for a fresh fix it already has. */
  function updateNavControlsVisibility() {
    var has = state.routes.length > 0;
    var navving = RC.nav.isActive();
    var navBtn = RC.el("ctl-nav");
    var overviewBtn = RC.el("ctl-overview");
    var locateBtn = RC.el("ctl-locate");
    if (navBtn) navBtn.hidden = !has || navving;
    if (overviewBtn) overviewBtn.hidden = !has;
    if (locateBtn) {
      var label = navving ? "Re-centre on me" : "Use my location";
      locateBtn.setAttribute("aria-label", label);
      locateBtn.title = label;
    }
    updateSheetVars();
  }

  function locateOnMap() {
    // Mid-ride the rider's position is already arriving several times a
    // minute. Spending a fresh high-accuracy fix — and the seconds it takes
    // to acquire — to answer "where am I" would be daft.
    if (RC.nav.isActive() && riderMarker) {
      navFollowStarted = true;
      map.setView(riderMarker.getLatLng(), Math.max(map.getZoom(), 16));
      return;
    }
    if (!navigator.geolocation) { setStatus("This browser will not share a location.", "error"); return; }
    setStatus("Finding you…", "busy");
    navigator.geolocation.getCurrentPosition(function (pos) {
      setStatus("", "");
      map.setView([pos.coords.latitude, pos.coords.longitude], Math.max(map.getZoom(), 15));
    }, function () {
      setStatus("Location permission was refused.", "error");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  function showOverview() {
    var route = state.routes[state.routeIndex];
    if (!route) return;
    // A whole-route overview is a north-up thing; leave course-up first.
    if (RC.compass.isRotated()) RC.compass.setMode("north", { gesture: false });
    map.fitBounds(L.latLngBounds(route.coords).pad(0.12));
    // Panning away mid-ride would otherwise be undone by the next fix; drop
    // out of follow so the overview actually stays on screen long enough to
    // read. The Locate button puts the rider back.
    navFollowStarted = false;
  }

  /* Zoom is RouteCast's own rather than Leaflet's, because Leaflet's control
     lives inside the rotated map element and course-up leaves it tilted and
     off screen. Anchoring to the centre matches what compass.js does with
     scroll zoom, so both behave the same in both modes. */
  function zoomBy(delta) {
    if (!map) return;
    map.setZoomAround(map.getCenter(), map.getZoom() + delta);
  }

  /* ---------------------------------------------------------
     Centre-pin picker (RC.pick) — Start, any Stop, Destination
     --------------------------------------------------------- */
  function clearPickActiveClass() {
    if (activePickTrigger && activePickTrigger.classList) activePickTrigger.classList.remove("is-active");
    activePickTrigger = null;
  }

  function restoreSheetAfterPick() {
    if (pickPrevSheet) { setSheet(pickPrevSheet); pickPrevSheet = null; }
  }

  // opts.ep: the endpoint object to fill in on confirm.
  function openPicker(ep, title, triggerBtn) {
    if (!map || !ep) return;
    var center = ep.place
      ? { lat: ep.place.lat, lon: ep.place.lon }
      : { lat: map.getCenter().lat, lon: map.getCenter().lng };

    var panel = RC.el("panel");
    pickPrevSheet = panel ? panel.getAttribute("data-sheet") : null;
    setSheet("peek");

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
      restoreSheetAfterPick();
      if (!ep) return;
      // place.lat/lon are the map centre to five decimals — the exact point
      // the pin was over, never the geocoder's idea of the nearest address.
      ep.place = place;
      ep.inputEl.value = place.name;
      drawEndpoints();
      saveTrip();
    };

    RC.pick.onCancel = function () {
      clearPickActiveClass();
      restoreSheetAfterPick();
    };
  }

  /* ---------------------------------------------------------
     Live navigation (RC.nav) driving #nav-hud
     --------------------------------------------------------- */
  function enterNavUI() {
    document.documentElement.setAttribute("data-nav", "on");
    setSheet("peek");
    var hud = RC.el("nav-hud");
    if (hud) hud.hidden = false;
    var navBtn = RC.el("ctl-nav");
    if (navBtn) { navBtn.setAttribute("aria-label", "Stop navigation"); navBtn.title = "Stop navigation"; }
    navFollowStarted = false;
    lastNavRenderTs = 0;
    updateNavControlsVisibility();
  }

  function exitNavUI() {
    document.documentElement.removeAttribute("data-nav");
    var hud = RC.el("nav-hud");
    if (hud) hud.hidden = true;
    var alertEl = RC.el("nav-alert");
    if (alertEl) alertEl.hidden = true;
    var navBtn = RC.el("ctl-nav");
    if (navBtn) { navBtn.setAttribute("aria-label", "Start navigation"); navBtn.title = "Start navigation"; }
    if (riderMarker) { map.removeLayer(riderMarker); riderMarker = null; }
    navFollowStarted = false;
    updateNavControlsVisibility();
  }

  /* Where each remaining waypoint falls along `route`, so we know which ones
     the rider has already passed and which a reroute still has to include.
     OSRM returns one leg per gap between waypoints, so the prefix sums of the
     leg distances are exactly the waypoint boundaries. */
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
    // The destination is the destination however the legs add up.
    if (navTargets.length && route && route.distance) {
      navTargets[navTargets.length - 1].atM = route.distance;
    }
  }

  // Drop the waypoints already behind the rider. The last one is never
  // dropped — arriving is what ends the ride, not a reroute.
  function dropPassedTargets(distanceAlong) {
    while (navTargets.length > 1 && navTargets[0].atM <= distanceAlong + 150) {
      navTargets.shift();
    }
  }

  function startNav() {
    if (RC.nav.isActive()) { stopNav(); return; }
    var route = state.routes[state.routeIndex];
    if (!route || !state.checkpoints.length) {
      setStatus("Plan a route before navigating.", "error");
      return;
    }
    var places = [];
    for (var i = 1; i < state.endpoints.length; i++) {
      if (state.endpoints[i].place) places.push(state.endpoints[i].place);
    }
    if (!places.length) {
      setStatus("Plan a route before navigating.", "error");
      return;
    }
    rebuildNavTargets(route, places);

    setStatus("Starting navigation…", "busy");
    RC.nav.start({
      map: map,
      route: route,
      checkpoints: state.checkpoints,
      vehicle: state.vehicle,
      series: state.series,
      // The terrain profile drives the elevation and grade tiles. It may not
      // have landed yet; loadElevation hands it over as soon as it does.
      profile: state.profile,
      departedAt: new Date()
    }).then(function () {
      setStatus("", "");
      enterNavUI();
    }, function (err) {
      setStatus(err && err.message ? err.message : "Could not start navigation.", "error");
      exitNavUI();
    });
  }

  function stopNav() {
    // nav.js closes the recording session and hands back the timing record
    // it kept, or null when the ride was too short or too incomplete to teach
    // anything. Either way the next plan re-reads the history.
    var learned = RC.nav.stop();
    navTargets = [];
    navRerouteToken++;
    navDistanceAlong = 0;
    RC.compass.reset();
    RC.compass.setMode("north", { gesture: false });
    exitNavUI();
    renderHistoryPanel();
    if (learned) {
      var pct = Math.round((learned.actualS / learned.plannedS - 1) * 100);
      setStatus(pct === 0
        ? "Ride recorded — that one ran exactly to the estimate."
        : "Ride recorded — you ran " + Math.abs(pct) + "% " + (pct > 0 ? "slower" : "faster") +
          " than the estimate. Future ETAs will account for it.", "");
    }
  }

  /* ---------------------------------------------------------
     Rerouting — fired by RC.nav only once the rider is convincingly on a
     different road (see nav.js for the gate). One routing request, no
     alternatives, from where they are through whatever waypoints are left,
     started facing the way they are actually pointing. The forecast for the
     new line reuses RC.weather's grid cache, so a detour that rejoins the
     old corridor usually costs no weather request at all.
     --------------------------------------------------------- */
  function reroute(ns) {
    var token = ++navRerouteToken;
    dropPassedTargets(ns.distanceAlong);
    if (!navTargets.length) return Promise.resolve();

    var waypoints = [{ lat: ns.lat, lon: ns.lon }].concat(navTargets.map(function (t) {
      return { lat: t.lat, lon: t.lon };
    }));
    var bearings = [];
    bearings.push(ns.courseDeg == null ? null : { deg: ns.courseDeg, range: 75 });

    setStatus("Off route — finding a new way…", "busy");

    return RC.router.route(waypoints, {
      vehicle: state.vehicle,
      alternatives: false,
      bearings: bearings
    }).then(function (routes) {
      if (token !== navRerouteToken || !RC.nav.isActive()) return;
      var raw = routes && routes[0];
      if (!raw) throw RC.error("Could not find a new route.", "route");
      // A reroute gets the same treatment as a plan: the router's timings are
      // just as optimistic mid-ride as they were at the kerb, and the weather
      // for the new line is about to be read off these ETAs.
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
        renderPeekBar();
        setStatus("", "");
        // The old terrain profile belongs to a line that is no longer under
        // the rider; fetch the new one rather than reporting the wrong hill.
        loadElevation(route, state.planToken);
      });
    }, function (err) {
      if (token !== navRerouteToken) return;
      // A failed reroute is not fatal: the old line is still on screen and
      // nav.js will back off before trying again.
      setStatus(err && err.message ? err.message : "Could not find a new route.", "error");
    });
  }

  /* ---------------------------------------------------------
     Live weather — the cheap half runs constantly inside nav.js (downstream
     ETAs are re-sampled against the hourly series already in memory, once a
     minute, for free). This is the expensive half: an actual refetch, only
     for the checkpoints still ahead, capped at WX_REFRESH_MAX_POINTS, and
     only for points whose data is older than WX_REUSE_MS.
     --------------------------------------------------------- */
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
      // Splice the refreshed entries back into the live series in place —
      // nav.js holds a reference to it and re-times against it every minute.
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

  function renderNavTicks() {
    var track = RC.el("nav-progress");
    if (!track) return;
    var old = track.querySelectorAll(".rc-nav-tick");
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
    var route = state.routes[state.routeIndex];
    var cps = state.checkpoints;
    if (!route || !cps.length || !route.distance) return;
    for (var j = 0; j < cps.length; j++) {
      var pct = RC.clamp(cps[j].distance / route.distance * 100, 0, 100);
      var tick = document.createElement("span");
      tick.className = "rc-nav-tick is-" + levelOf(cps[j]);
      tick.style.left = pct + "%";
      track.appendChild(tick);
    }
  }

  function renderNavHud(ns) {
    var remaining = RC.el("nav-remaining");
    var eta = RC.el("nav-eta");
    var next = RC.el("nav-next");
    var fill = RC.el("nav-progress-fill");
    var alertEl = RC.el("nav-alert");

    navDistanceAlong = ns.distanceAlong;

    if (remaining) remaining.textContent = RC.fmtDist(ns.remainingM, state.units) + " · " + RC.fmtDur(ns.remainingS);
    if (eta) eta.textContent = "Arrive " + RC.fmtTime(ns.etaDate);

    renderSpeedo(ns);
    renderNavStep(ns);
    renderNavTiles(ns);

    if (next) {
      if (ns.nextCheckpoint) {
        var cp = ns.nextCheckpoint;
        var wx = cp.wx || {};
        var level = levelOf(cp);
        var desc = wx.outOfRange ? { icon: "cloud" } : RC.weather.describe(wx.code, wx.isDay);
        next.innerHTML =
          '<span class="rc-nav-next-icon" style="color:' + colorFor(level) + '">' + RC.icons.weather(desc.icon) + "</span>" +
          "<span>" + (wx.outOfRange ? "—" : RC.fmtTemp(wx.tempC, state.units)) +
          " in " + RC.fmtDist(ns.distanceToNextM, state.units) + "</span>";
      } else {
        next.innerHTML = "";
      }
    }

    if (fill) fill.style.width = Math.round(ns.progress * 100) + "%";
    renderNavTicks();

    var nextLevel = ns.nextCheckpoint ? levelOf(ns.nextCheckpoint) : "clear";
    var cautionAhead = nextLevel === "caution" || nextLevel === "danger";
    if (alertEl) {
      if (ns.offRoute) {
        alertEl.hidden = false;
        alertEl.setAttribute("data-level", "caution");
        alertEl.innerHTML = RC.icons.ui("alert") + "<span>You're off the planned route.</span>";
      } else if (cautionAhead) {
        alertEl.hidden = false;
        alertEl.setAttribute("data-level", nextLevel);
        var place = (ns.nextCheckpoint && ns.nextCheckpoint.label) || "the next checkpoint";
        alertEl.innerHTML = RC.icons.ui("alert") + "<span>" +
          RC.escapeHtml((nextLevel === "danger" ? "Danger conditions ahead at " : "Caution ahead at ") + place) +
          "</span>";
      } else {
        alertEl.hidden = true;
      }
    }

    // Nav re-times downstream checkpoints and re-samples their weather at
    // most once a minute; re-render the timeline/markers on a much shorter
    // throttle so the rider's forecast catches up without redrawing on
    // every single GPS fix.
    var t = Date.now();
    if (t - lastNavRenderTs >= 5000) {
      lastNavRenderTs = t;
      renderTimeline();
      drawWeatherMarkers();
      renderElevation();
    }
  }

  /* The speedometer. Large, high contrast and the only thing on the HUD that
     is safe to read at a glance — everything else is a tile you look at when
     stopped. It shows the SMOOTHED figure: a raw GPS speed flickers several
     km/h between fixes, and a number that will not sit still is a number
     nobody reads. */
  function renderSpeedo(ns) {
    var el = RC.el("nav-speed");
    var unit = RC.el("nav-speed-unit");
    if (!el) return;
    var kmh = ns.displaySpeedKmh;
    if (kmh == null) {
      el.textContent = "no fix";
      el.setAttribute("data-empty", "yes");
    } else {
      el.textContent = String(state.units === "imperial"
        ? Math.round(kmh / 1.609344)
        : Math.round(kmh));
      el.removeAttribute("data-empty");
    }
    if (unit) unit.textContent = state.units === "imperial" ? "mph" : "km/h";
  }

  /* The next instruction, in the one place a driver's eyes already go. OSRM
     gives us the manoeuvre list for free; nothing was doing anything with it
     before, so a rider following RouteCast had a weather HUD and no turns. */
  function renderNavStep(ns) {
    var box = RC.el("nav-step");
    var textEl = RC.el("nav-step-text");
    var distEl = RC.el("nav-step-dist");
    if (!box || !textEl || !distEl) return;
    if (!ns.nextStep) {
      textEl.textContent = "Continue to your destination";
      distEl.textContent = "";
      box.removeAttribute("data-soon");
      return;
    }
    textEl.textContent = ns.nextStep.text;
    distEl.textContent = RC.fmtDist(ns.nextStep.distanceM, state.units);
    // Inside 150 m the instruction is imminent; the styling picks that up.
    if (ns.nextStep.distanceM < 150) box.setAttribute("data-soon", "yes");
    else box.removeAttribute("data-soon");
  }

  function renderNavTiles(ns) {
    var avg = RC.el("nav-avg");
    var elev = RC.el("nav-elev");
    var grade = RC.el("nav-grade");
    var elapsed = RC.el("nav-elapsed");
    var traffic = RC.el("nav-traffic");
    var accuracy = RC.el("nav-accuracy");

    if (avg) avg.textContent = ns.avgSpeedKmh == null ? "—" : RC.fmtSpeed(ns.avgSpeedKmh, state.units);
    if (elapsed) elapsed.textContent = RC.fmtDur(ns.elapsedS);

    if (elev) {
      elev.textContent = ns.elevationM == null ? "—" : RC.fmtDist(Math.round(ns.elevationM), state.units);
      // Say which source it is: a DEM reading and a phone's GPS altitude are
      // not the same claim, and the GPS one can be 50 m out on a good day.
      elev.title = ns.elevationSource === "dem"
        ? "From the terrain model along your route"
        : (ns.elevationSource === "gps" ? "From your device's GPS — approximate" : "");
    }

    if (grade) {
      if (ns.gradePct == null) {
        grade.textContent = "—";
        grade.removeAttribute("data-sign");
      } else {
        var g = Math.round(ns.gradePct * 10) / 10;
        grade.textContent = (g > 0 ? "+" : "") + g.toFixed(1) + "%";
        grade.setAttribute("data-sign", g > 0.5 ? "up" : (g < -0.5 ? "down" : "flat"));
      }
    }

    if (traffic) {
      var lvl = RC.traffic.level(new Date());
      traffic.textContent = RC.traffic.LEVELS[lvl].label;
      traffic.setAttribute("data-level", trafficLevelClass(lvl));
    }

    if (accuracy) {
      accuracy.textContent = ns.accuracy == null ? "—" : ("±" + RC.fmtDist(ns.accuracy, state.units));
      accuracy.setAttribute("data-level",
        ns.accuracy == null ? "clear" : (ns.accuracy > 40 ? "caution" : ns.accuracy > 20 ? "watch" : "clear"));
    }
  }

  function riderIconHtml() {
    return '<span class="rc-rider"><svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 3.2 18.4 19 12 15.4 5.6 19 12 3.2Z" fill="currentColor"/></svg></span>';
  }

  function updateRiderMarker(ns) {
    if (!map) return;
    var latlng = [ns.lat, ns.lon];
    if (!riderMarker) {
      var icon = L.divIcon({
        className: "",
        html: riderIconHtml(),
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });
      riderMarker = L.marker(latlng, { icon: icon, zIndexOffset: 1000, keyboard: false }).addTo(map);
      riderArrow = null;
    } else {
      riderMarker.setLatLng(latlng);
    }

    // The arrow lives inside the (possibly rotated) map, so pointing it at
    // the course in map space is all that's needed — course-up then shows it
    // upright for free.
    if (!riderArrow && riderMarker.getElement) {
      var el = riderMarker.getElement();
      riderArrow = el ? el.querySelector(".rc-rider") : null;
    }
    if (riderArrow && ns.courseDeg != null) {
      riderArrow.style.transform = "rotate(" + Math.round(ns.courseDeg) + "deg)";
    }

    // Course-up rotates about the map centre, so the rider has to be at it.
    if (RC.compass.isRotated()) {
      map.setView(latlng, navFollowStarted ? map.getZoom() : Math.max(map.getZoom(), 16), { animate: false });
      navFollowStarted = true;
    } else if (!navFollowStarted) {
      // Follow is off — the rider is looking at the overview, or has dragged
      // the map to see what is ahead. Move the marker, leave the view alone.
      // Locate (or a compass switch to course-up) is how you get back.
      return;
    } else {
      map.panTo(latlng, { animate: true });
    }
  }

  RC.nav.onUpdate = function (ns) {
    RC.compass.setCourse(ns.headingDeg, ns.speedKmh, ns.courseDeg);
    renderNavHud(ns);
    updateRiderMarker(ns);
    dropPassedTargets(ns.distanceAlong);
  };
  RC.nav.onArrive = function () { setStatus("You've arrived.", ""); stopNav(); };
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

  /* ---------------------------------------------------------
     Compass button
     --------------------------------------------------------- */
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
     --sheet-h / --rc-controls-h — kept current so the map controls and
     Leaflet's zoom control stack above the sheet at every snap point.
     --------------------------------------------------------- */
  function updateSheetVars() {
    var root = document.documentElement;
    var panel = RC.el("panel");
    if (panel) {
      var h = 0;
      // A side drawer takes width, not height: the map controls must not be
      // pushed up by a panel that does not sit under them.
      if (sheetIsMobile() && !sheetIsDrawer()) {
        var rect = panel.getBoundingClientRect();
        h = Math.max(0, Math.round(window.innerHeight - rect.top));
      }
      root.style.setProperty("--sheet-h", h + "px");
    }
    var controls = RC.el("map-controls");
    if (controls) {
      var ch = Math.round(controls.getBoundingClientRect().height) || 0;
      root.style.setProperty("--rc-controls-h", ch + "px");
    }
  }

  // Keep the vars in sync for the ~280ms the sheet's CSS transition runs.
  function scheduleSheetVarSync() {
    updateSheetVars();
    var ticks = 0;
    function tick() {
      updateSheetVars();
      ticks++;
      if (ticks < 20) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  /* ---------------------------------------------------------
     Bottom sheet — drag, flick and tap between three heights.

     What was wrong with it
     ----------------------
     Only the 4px grab bar was draggable. Everything a thumb naturally
     reaches for — the summary line right underneath it, the padding around
     it, the top edge of the sheet — did nothing, which on a phone reads as
     "the overlay is stuck". Worse, the whole gesture lived on listeners
     attached to the handle itself: if the pointer left the element and the
     capture was refused (which happens on some Android browsers, and always
     if the element is re-rendered mid-drag), no pointerup ever arrived, the
     sheet kept its inline transform and the panel was left half way up,
     frozen, until a reload.

     What it does now
     ----------------
     * The grab area is the handle AND the peek bar — the whole top of the
       sheet, which is what a thumb goes for.
     * move/up/cancel are bound to the WINDOW for the duration of a drag, so
       the gesture completes wherever the pointer ends up, capture or no
       capture. They are removed the moment it ends.
     * A drag started on the peek bar that never really moves is still a tap,
       so the bar keeps its old behaviour.
     * A resize or an orientation change during a drag aborts it cleanly
       rather than leaving the sheet mid-air with a stale transform.
     --------------------------------------------------------- */
  var SHEET_SNAPS = ["peek", "half", "open"];
  var SHEET_TAP_MOVE = 8;      // px — under this, a release counts as a tap
  var SHEET_TAP_TIME = 400;    // ms — under this, a release counts as a tap
  var SHEET_FLICK_VELOCITY = 0.5; // px/ms — over this, carry one snap further

  /* The sheet exists wherever the panel is a sheet rather than a sidebar:
     narrow portrait phones, and short landscape ones, which is why this is
     not a bare width test. The value must agree with the CSS breakpoints —
     see the "Panel as a bottom sheet" and landscape blocks in app.css. */
  function sheetIsMobile() {
    if (!window.matchMedia) return false;
    return window.matchMedia("(max-width: 820px) and (orientation: portrait)").matches ||
           window.matchMedia("(max-height: 560px) and (orientation: landscape) and (max-width: 900px)").matches;
  }

  // In landscape the panel is a side drawer, not a sheet, so it never snaps.
  function sheetIsDrawer() {
    return !!(window.matchMedia &&
      window.matchMedia("(orientation: landscape) and (max-height: 560px)").matches);
  }

  function setSheet(snap, persist) {
    var panel = RC.el("panel");
    if (!panel) return;
    if (SHEET_SNAPS.indexOf(snap) < 0) snap = "peek";
    panel.setAttribute("data-sheet", snap);
    if (persist !== false) RC.store.set("sheet", snap);
    scheduleSheetVarSync();
  }

  function initSheet() {
    var panel = RC.el("panel");
    var handle = RC.el("sheet-handle");
    var peekBar = RC.el("peek-bar");
    if (!panel) return;

    // Restore where the user left the sheet — but never open it over the whole
    // map on startup. A phone should always come up showing the map.
    var stored = RC.store.get("sheet", null);
    if (stored && SHEET_SNAPS.indexOf(stored) > -1) {
      if (sheetIsMobile() && stored === "open") stored = "half";
      panel.setAttribute("data-sheet", stored);
    }

    function currentSnap() {
      var v = panel.getAttribute("data-sheet");
      return SHEET_SNAPS.indexOf(v) > -1 ? v : "peek";
    }

    // Reads the natural (untransformed) viewport top of the panel at each
    // snap point, without letting the browser paint any intermediate state —
    // the whole loop runs inside one synchronous task, so nothing flashes.
    function measureTops() {
      var was = panel.getAttribute("data-sheet");
      var prevTransition = panel.style.transition;
      panel.style.transition = "none";
      var tops = {};
      for (var i = 0; i < SHEET_SNAPS.length; i++) {
        panel.setAttribute("data-sheet", SHEET_SNAPS[i]);
        tops[SHEET_SNAPS[i]] = panel.getBoundingClientRect().top;
      }
      panel.setAttribute("data-sheet", was);
      // Force the untransitioned state to be committed before the transition
      // property comes back, so restoring it cannot animate the snapshot.
      void panel.offsetHeight;
      panel.style.transition = prevTransition;
      return tops;
    }

    var drag = null;

    function detach() {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
    }

    function attach() {
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancel, true);
    }

    function onDown(e) {
      if (drag) return;                        // a second finger is not a drag
      if (!sheetIsMobile() || sheetIsDrawer()) return;
      if (e.button != null && e.button !== 0) return;

      var tops = measureTops();
      var startTop = panel.getBoundingClientRect().top;
      var minTop = Math.min(tops.peek, tops.half, tops.open);
      var maxTop = Math.max(tops.peek, tops.half, tops.open);
      drag = {
        id: e.pointerId,
        target: e.currentTarget,
        startY: e.clientY,
        startT: e.timeStamp,
        lastY: e.clientY,
        lastT: e.timeStamp,
        velocity: 0,
        moved: false,
        tops: tops,
        minOffset: minTop - startTop,
        maxOffset: maxTop - startTop
      };
      // Capture when the browser will give it; the window listeners mean the
      // gesture works either way, so a refusal is not worth reporting.
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
      attach();
      panel.classList.add("is-dragging");
    }

    function onMove(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dt = e.timeStamp - drag.lastT;
      if (dt > 0) drag.velocity = (e.clientY - drag.lastY) / dt;
      drag.lastY = e.clientY;
      drag.lastT = e.timeStamp;
      var dy = e.clientY - drag.startY;
      if (Math.abs(dy) > SHEET_TAP_MOVE) drag.moved = true;
      // Only swallow the gesture once it is clearly a drag, so a tap on the
      // peek bar still behaves like a button press.
      if (drag.moved && e.cancelable) e.preventDefault();
      var offset = RC.clamp(dy, drag.minOffset, drag.maxOffset);
      panel.style.transform = "translateY(" + offset + "px)";
      updateSheetVars();
    }

    function finish(e, cancelled) {
      var d = drag;
      drag = null;
      detach();
      panel.classList.remove("is-dragging");
      panel.style.transform = "";
      if (d && d.target) {
        try { d.target.releasePointerCapture(d.id); } catch (err) {}
      }
      if (!d) return;

      var endY = e ? e.clientY : d.lastY;
      var endT = e ? e.timeStamp : d.lastT;
      var totalDy = endY - d.startY;
      var duration = endT - d.startT;
      var isTap = !cancelled && Math.abs(totalDy) <= SHEET_TAP_MOVE && duration <= SHEET_TAP_TIME;

      if (isTap) { peekBarTap(); return; }
      if (cancelled) { setSheet(currentSnap()); return; }

      // Snap to whichever point the release position is nearest, but let a
      // fast flick carry it one point further in the direction of travel.
      var offset = RC.clamp(totalDy, d.minOffset, d.maxOffset);
      var list = [];
      for (var i = 0; i < SHEET_SNAPS.length; i++) {
        list.push({ name: SHEET_SNAPS[i], top: d.tops[SHEET_SNAPS[i]] });
      }
      list.sort(function (a, b) { return a.top - b.top; });

      // Recover the absolute top the panel was released at from the offset
      // (list[0].top - d.minOffset is the pointerdown-time natural top).
      var releaseAbsTop = (list[0].top - d.minOffset) + offset;

      var nearestIdx = 0, bestGap = Infinity;
      for (var n = 0; n < list.length; n++) {
        var gap = Math.abs(list[n].top - releaseAbsTop);
        if (gap < bestGap) { bestGap = gap; nearestIdx = n; }
      }
      if (Math.abs(d.velocity) > SHEET_FLICK_VELOCITY) {
        nearestIdx += d.velocity > 0 ? 1 : -1;
        nearestIdx = RC.clamp(nearestIdx, 0, list.length - 1);
      }
      setSheet(list[nearestIdx].name);
    }

    function onUp(e) { if (drag && e.pointerId === drag.id) finish(e, false); }
    function onCancel(e) { if (drag && e.pointerId === drag.id) finish(e, true); }

    // Abort rather than carry a stale measurement across a layout change.
    function abortDrag() { if (drag) finish(null, true); }
    window.addEventListener("resize", abortDrag);
    window.addEventListener("orientationchange", abortDrag);

    var grabs = [handle, peekBar];
    for (var g = 0; g < grabs.length; g++) {
      if (grabs[g]) grabs[g].addEventListener("pointerdown", onDown);
    }

    // The peek bar is still a button on desktop, and on mobile when the
    // gesture never became a drag; onDown/finish own the mobile case, so the
    // click handler only has to cover the pointer-less paths (keyboard,
    // assistive tech, desktop mouse).
    if (peekBar) {
      peekBar.addEventListener("click", function (e) {
        if (sheetIsMobile() && !sheetIsDrawer() && e.detail !== 0) return;
        peekBarTap();
      });
    }
  }

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
    RC.el("add-stop").addEventListener("click", addStop);
    RC.el("use-location").addEventListener("click", useMyLocation);
    RC.el("swap-btn").addEventListener("click", swapEnds);
    RC.el("reset-btn").addEventListener("click", resetAll);
    RC.el("theme-toggle").addEventListener("click", toggleTheme);
    RC.el("vehicle-car").addEventListener("click", function () { setVehicle("car"); });
    RC.el("vehicle-moto").addEventListener("click", function () { setVehicle("motorcycle"); });
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

    var ctlLocate = RC.el("ctl-locate");
    if (ctlLocate) ctlLocate.addEventListener("click", locateOnMap);
    var ctlNav = RC.el("ctl-nav");
    if (ctlNav) ctlNav.addEventListener("click", startNav);
    var ctlCompass = RC.el("ctl-compass");
    if (ctlCompass) ctlCompass.addEventListener("click", function () { RC.compass.cycle(); });
    var ctlOverview = RC.el("ctl-overview");
    if (ctlOverview) ctlOverview.addEventListener("click", showOverview);
    var zoomIn = RC.el("ctl-zoom-in");
    if (zoomIn) zoomIn.addEventListener("click", function () { zoomBy(1); });
    var zoomOut = RC.el("ctl-zoom-out");
    if (zoomOut) zoomOut.addEventListener("click", function () { zoomBy(-1); });
    var navStop = RC.el("nav-stop");
    if (navStop) navStop.addEventListener("click", stopNav);

    var saveBtn = RC.el("save-route");
    if (saveBtn) saveBtn.addEventListener("click", saveCurrentRoute);

    var savedList = RC.el("saved-list");
    if (savedList) savedList.addEventListener("click", function (e) {
      var del = e.target.closest ? e.target.closest(".rc-saved-del") : null;
      if (del) {
        RC.routes.remove(del.getAttribute("data-del"));
        renderSavedRoutes();
        return;
      }
      var load = e.target.closest ? e.target.closest(".rc-saved-load") : null;
      if (load) loadSavedRoute(load.getAttribute("data-id"));
    });

    var histClear = RC.el("history-clear");
    if (histClear) histClear.addEventListener("click", clearHistory);

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

    initSheet();

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { state.selected = -1; drawWeatherMarkers(); renderTimeline(); renderDetails(); }
    });

    var onViewportChange = RC.debounce(function () {
      updateSheetVars();
      redrawChips();
      // Rotating the phone swaps the panel between sheet and drawer; a
      // drawer that is still carrying a collapsed class from the last
      // orientation would come back as a stump.
      var panel = RC.el("panel");
      if (panel && !sheetIsDrawer()) panel.classList.remove("is-collapsed");
    }, 150);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);

    setVehicle(state.vehicle);
    setUnits(state.units);
    RC.el("interval").value = state.interval;
    restoreTrip();
    renderPeekBar();
    renderSavedRoutes();
    renderHistoryPanel();
    updateNavControlsVisibility();
    updateSheetVars();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

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
    selected: -1,
    planToken: 0
  };

  var map, tileLayer, routeLayers = [], markerLayer, endpointLayer, activeRequest = null;

  /* ---------------------------------------------------------
     Map
     --------------------------------------------------------- */
  function initMap() {
    map = L.map("map", { zoomControl: false, attributionControl: false })
      .setView([MAP_START.lat, MAP_START.lon], MAP_START.zoom);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    tileLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      crossOrigin: true
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    endpointLayer = L.layerGroup().addTo(map);

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

  function setEndpointFromLatLon(ep, lat, lon) {
    if (!ep) return;
    var label = lat.toFixed(4) + ", " + lon.toFixed(4);
    ep.place = { name: label, address: label, lat: lat, lon: lon };
    ep.inputEl.value = label;
    drawEndpoints();
    RC.geocode.reverse(lat, lon).then(function (place) {
      if (ep.place && ep.place.lat === lat && ep.place.lon === lon) {
        ep.place = place;
        ep.inputEl.value = place.name;
        drawEndpoints();
      }
    }, function () { /* the raw coordinates are a fine fallback */ });
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
        '<input type="text" class="rc-input" id="' + id + '" placeholder="Stop along the way" autocomplete="off" spellcheck="false" />' +
        '<ul class="rc-results" id="' + id + '-results" hidden></ul>' +
      "</div>" +
      '<button type="button" class="rc-stop-remove" aria-label="Remove this stop">' + RC.icons.ui("close") + "</button>";
    wrap.appendChild(row);

    var ep = makeEndpoint("stop", row.querySelector("input"), row.querySelector(".rc-results"));
    state.endpoints.splice(state.endpoints.length - 1, 0, ep);

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

  function intervalKm(distanceM) {
    if (state.interval !== "auto") return parseInt(state.interval, 10);
    var km = distanceM / 1000;
    if (km < 60) return 10;
    if (km < 200) return 20;
    if (km < 600) return 40;
    return 80;
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
        state.routes = routes;
        state.routeIndex = 0;
        return loadWeatherFor(routes[0], token, signal);
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
    var checkpoints = RC.sampler.sample(route, {
      everyKm: intervalKm(route.distance),
      maxPoints: 24,
      departAt: depart
    });
    setStatus("Reading the sky at " + checkpoints.length + " points along the way…", "busy");

    return RC.weather.forecastSeries(checkpoints, { signal: signal }).then(function (series) {
      if (token !== state.planToken) return;
      state.series = series;
      for (var i = 0; i < checkpoints.length; i++) {
        checkpoints[i].wx = RC.weather.sampleSeries(series, i, checkpoints[i].eta);
      }
      state.checkpoints = checkpoints;
      state.trip = RC.risk.trip(checkpoints, state.vehicle);
      state.selected = -1;
      labelCheckpoints();
      render();
      setStatus("", "");
      return departureOptions(token);
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
    drawRoute();
    drawWeatherMarkers();
    renderSummary();
    renderAlternatives();
    renderTimeline();
    renderDetails();
    var panel = RC.el("panel");
    if (panel && window.matchMedia && window.matchMedia("(max-width: 820px)").matches) {
      setSheet("half");
    }
  }

  function levelOf(cp) {
    if (!cp || !cp.wx) return "clear";
    return RC.risk.score(cp.wx, state.vehicle).level;
  }

  function colorFor(level) {
    var map = { clear: "#4E8C6A", watch: "#C79A2E", caution: "#C1613F", danger: "#A63232" };
    return map[level] || map.clear;
  }

  function drawRoute() {
    for (var i = 0; i < routeLayers.length; i++) map.removeLayer(routeLayers[i]);
    routeLayers = [];
    var route = state.routes[state.routeIndex];
    if (!route) return;

    // Ghost the alternatives underneath so they stay clickable.
    for (var a = 0; a < state.routes.length; a++) {
      if (a === state.routeIndex) continue;
      (function (idx) {
        var ghost = L.polyline(state.routes[idx].coords, {
          color: "#8a8175", weight: 5, opacity: 0.45, interactive: true
        }).addTo(map);
        ghost.on("click", function () { selectRoute(idx); });
        routeLayers.push(ghost);
      })(a);
    }

    // Casing, then one coloured segment per checkpoint span.
    routeLayers.push(L.polyline(route.coords, { color: "#1B1A18", weight: 9, opacity: 0.18 }).addTo(map));
    var cps = state.checkpoints;
    if (cps.length < 2) {
      routeLayers.push(L.polyline(route.coords, { color: "#C1613F", weight: 5 }).addTo(map));
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
    map.fitBounds(L.latLngBounds(route.coords).pad(0.12));
  }

  function drawWeatherMarkers() {
    markerLayer.clearLayers();
    var cps = state.checkpoints;
    for (var i = 0; i < cps.length; i++) {
      (function (cp, idx) {
        var level = levelOf(cp);
        var wx = cp.wx || {};
        var desc = wx.outOfRange ? { icon: "cloud" } : RC.weather.describe(wx.code, wx.isDay);
        var html =
          '<span class="rc-marker is-' + level + (idx === state.selected ? " is-selected" : "") + '">' +
            '<span class="rc-marker-icon">' + RC.icons.weather(desc.icon) + "</span>" +
            '<span class="rc-marker-temp">' + (wx.outOfRange ? "—" : RC.fmtTemp(wx.tempC, state.units)) + "</span>" +
          "</span>";
        var m = L.marker([cp.lat, cp.lon], {
          icon: L.divIcon({ className: "", html: html, iconSize: [58, 26], iconAnchor: [29, 13] }),
          zIndexOffset: 400 + idx,
          keyboard: false
        });
        m.on("click", function () { selectCheckpoint(idx); });
        m.addTo(markerLayer);
      })(cps[i], i);
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
    verdict.textContent = RC.risk.LEVELS[trip.level].label +
      (trip.level === "clear" ? " run" : " — " + (trip.reasons[0] || "watch the sky"));

    RC.el("summary-rain").textContent = trip.rainMinutes > 0
      ? "About " + RC.fmtDur(trip.rainMinutes * 60) + " of this ride is in the wet."
      : "No precipitation expected on the way.";

    var advice = trip.advice.concat(trip.reasons.slice(1));
    var html = "";
    for (var i = 0; i < Math.min(advice.length, 5); i++) {
      html += '<li class="rc-advice">' + RC.escapeHtml(advice[i]) + "</li>";
    }
    RC.el("summary-advice").innerHTML = html;
  }

  function renderAlternatives() {
    var wrap = RC.el("alts");
    if (state.routes.length < 2) { wrap.innerHTML = ""; wrap.hidden = true; return; }
    wrap.hidden = false;
    var html = "";
    for (var i = 0; i < state.routes.length; i++) {
      var r = state.routes[i];
      html += '<button type="button" class="rc-alt' + (i === state.routeIndex ? " is-active" : "") +
                '" data-i="' + i + '">' +
                '<span class="rc-alt-name">' + RC.escapeHtml(r.summary || ("Route " + (i + 1))) + "</span>" +
                '<span class="rc-alt-meta">' + RC.fmtDur(r.duration) + " · " + RC.fmtDist(r.distance, state.units) + "</span>" +
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
      ["Humidity", Math.round(wx.humidity) + "%"]
    ];
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
  }

  function useMyLocation() {
    if (!navigator.geolocation) { setStatus("This browser will not share a location.", "error"); return; }
    setStatus("Asking for your location…", "busy");
    navigator.geolocation.getCurrentPosition(function (pos) {
      setStatus("", "");
      setEndpointFromLatLon(state.endpoints[0], pos.coords.latitude, pos.coords.longitude);
      map.setView([pos.coords.latitude, pos.coords.longitude], 12);
    }, function () {
      setStatus("Location permission was refused.", "error");
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
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
    state.routes = []; state.checkpoints = []; state.series = null; state.trip = null; state.selected = -1;
    RC.el("stops").innerHTML = "";
    state.endpoints = [state.endpoints[0], state.endpoints[state.endpoints.length - 1]];
    for (var i = 0; i < state.endpoints.length; i++) {
      state.endpoints[i].place = null;
      state.endpoints[i].inputEl.value = "";
    }
    for (var r = 0; r < routeLayers.length; r++) map.removeLayer(routeLayers[r]);
    routeLayers = [];
    markerLayer.clearLayers();
    endpointLayer.clearLayers();
    RC.el("summary").hidden = true;
    RC.el("details").hidden = true;
    RC.el("alts").hidden = true;
    RC.el("depart-planner").hidden = true;
    RC.el("timeline").innerHTML = "";
    var empty = RC.el("empty-state");
    if (empty) empty.hidden = false;
    setStatus("", "");
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
    state.endpoints[0].place = places[0];
    state.endpoints[0].inputEl.value = places[0].name;
    var last = state.endpoints[state.endpoints.length - 1];
    last.place = places[places.length - 1];
    last.inputEl.value = places[places.length - 1].name;
    drawEndpoints();
  }

  /* ---------------------------------------------------------
     Bottom sheet (mobile drag / tap, desktop no-op)
     --------------------------------------------------------- */
  var SHEET_SNAPS = ["peek", "half", "open"];
  var SHEET_TAP_MOVE = 8;      // px — under this, a release counts as a tap
  var SHEET_TAP_TIME = 300;    // ms — under this, a release counts as a tap
  var SHEET_FLICK_VELOCITY = 0.5; // px/ms — over this, carry one snap further

  function sheetIsMobile() {
    return window.matchMedia && window.matchMedia("(max-width: 820px)").matches;
  }

  function setSheet(snap, persist) {
    var panel = RC.el("panel");
    if (!panel) return;
    if (SHEET_SNAPS.indexOf(snap) < 0) snap = "peek";
    panel.setAttribute("data-sheet", snap);
    if (persist !== false) RC.store.set("sheet", snap);
  }

  function initSheet() {
    var panel = RC.el("panel");
    var handle = RC.el("sheet-handle");
    if (!panel) return;

    var stored = RC.store.get("sheet", null);
    if (stored && SHEET_SNAPS.indexOf(stored) > -1) {
      panel.setAttribute("data-sheet", stored);
    }

    if (!handle) return;

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
      panel.style.transition = prevTransition;
      return tops;
    }

    var drag = null;

    handle.addEventListener("pointerdown", function (e) {
      if (!sheetIsMobile()) return;
      if (e.button != null && e.button !== 0) return;
      var tops = measureTops();
      var startTop = panel.getBoundingClientRect().top;
      var minTop = Math.min(tops.peek, tops.half, tops.open);
      var maxTop = Math.max(tops.peek, tops.half, tops.open);
      drag = {
        id: e.pointerId,
        startY: e.clientY,
        startT: e.timeStamp,
        lastY: e.clientY,
        lastT: e.timeStamp,
        velocity: 0,
        tops: tops,
        minOffset: minTop - startTop,
        maxOffset: maxTop - startTop
      };
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      panel.classList.add("is-dragging");
    });

    handle.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      e.preventDefault();
      var dt = e.timeStamp - drag.lastT;
      if (dt > 0) drag.velocity = (e.clientY - drag.lastY) / dt;
      drag.lastY = e.clientY;
      drag.lastT = e.timeStamp;
      var dy = e.clientY - drag.startY;
      var offset = RC.clamp(dy, drag.minOffset, drag.maxOffset);
      panel.style.transform = "translateY(" + offset + "px)";
    });

    function endDrag(e, cancelled) {
      var d = drag;
      drag = null;
      panel.classList.remove("is-dragging");
      panel.style.transform = "";
      try { handle.releasePointerCapture(d.id); } catch (err) {}

      var totalDy = e.clientY - d.startY;
      var duration = e.timeStamp - d.startT;
      var isTap = !cancelled && Math.abs(totalDy) <= SHEET_TAP_MOVE && duration <= SHEET_TAP_TIME;

      if (isTap) {
        var order = ["peek", "half", "open"];
        var idx = order.indexOf(currentSnap());
        setSheet(order[(idx + 1) % order.length]);
        return;
      }
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

    handle.addEventListener("pointerup", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      endDrag(e, false);
    });
    handle.addEventListener("pointercancel", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      endDrag(e, true);
    });
  }

  /* ---------------------------------------------------------
     Wiring
     --------------------------------------------------------- */
  function init() {
    initMap();

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

    setVehicle(state.vehicle);
    setUnits(state.units);
    RC.el("interval").value = state.interval;
    restoreTrip();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* ============================================================
   KomyutApp — the map, and everything drawn on it

   One Leaflet map, four layer groups, and a rule: every other module asks
   this one to draw, and nothing else touches L directly. That is what keeps
   the builder's line, the planner's itinerary and the browsed route from
   fighting over the same map — each owns a group, and showing one clears
   the others.

   The base map is the plain OpenStreetMap raster tile set. There is no
   vector map here and no engine to download: this app is used standing on a
   street corner deciding which jeepney to flag down, and a megabyte of map
   renderer on mobile data is the wrong trade for a nicer-looking road.
   ============================================================ */
var KM = KM || {};

KM.map = (function () {
  "use strict";

  var map = null;
  var groups = {};
  var meMarker = null, meCircle = null;
  var watchId = null;
  var lastFix = null;
  var onPick = null;

  /* The line colours. Deliberately off the app's own accent so a route is
     never mistaken for a control, and so an itinerary's legs alternate
     visibly without needing a legend. */
  var COLOURS = {
    build: "#1F7A6B",
    route: "#2F6FBF",
    ride: ["#2F6FBF", "#B4562B", "#6C4BB6", "#2E7D4F"],
    walk: "#7C8578",
    ghost: "#9AA79B"
  };

  function init() {
    var last = KM.store.get("view", null);
    var centre = last || { lat: KM.config.DEFAULT_CENTER.lat, lon: KM.config.DEFAULT_CENTER.lon, z: KM.config.DEFAULT_ZOOM };

    map = L.map("map", {
      zoomControl: false,
      attributionControl: true,
      /* A phone in one hand, on a bus. Inertia on makes the map feel like
         the rest of the operating system; the tap tolerance is up because
         a thumb on a moving vehicle is not a mouse. */
      tap: true,
      tapTolerance: 22,
      maxZoom: 19
    }).setView([centre.lat, centre.lon], centre.z);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap"
    }).addTo(map);

    L.control.zoom({ position: "topright" }).addTo(map);

    ["build", "route", "plan", "pins"].forEach(function (name) {
      groups[name] = L.layerGroup().addTo(map);
    });

    map.on("moveend", function () {
      var c = map.getCenter();
      KM.store.set("view", { lat: c.lat, lon: c.lng, z: map.getZoom() });
      if (onPick) onPick(centreCoord());
    });

    return map;
  }

  function centreCoord() {
    var c = map.getCenter();
    return { lat: c.lat, lon: c.lng };
  }

  function clear(name) {
    if (groups[name]) groups[name].clearLayers();
  }

  function clearAll() {
    Object.keys(groups).forEach(clear);
  }

  /* ---------------------------------------------------------
     Drawing
     --------------------------------------------------------- */

  /* A route's line. `style` is "build", "route", "ghost", or an explicit
     colour. Drawn as two polylines — a wide pale casing under a narrower
     coloured core — because a single 4px line vanishes over a busy OSM
     tile at street zoom. */
  function line(group, path, opts) {
    opts = opts || {};
    var colour = opts.colour || COLOURS[opts.style || "route"] || COLOURS.route;
    var latlngs = path.map(function (p) { return [p[0], p[1]]; });

    var casing = L.polyline(latlngs, {
      color: "#FFFFFF", weight: (opts.weight || 6) + 4, opacity: 0.75,
      lineCap: "round", lineJoin: "round", interactive: false
    });
    var core = L.polyline(latlngs, {
      color: colour, weight: opts.weight || 6, opacity: opts.opacity == null ? 0.95 : opts.opacity,
      lineCap: "round", lineJoin: "round", dashArray: opts.dashed ? "2 9" : null,
      interactive: !!opts.onClick
    });

    if (opts.onClick) core.on("click", opts.onClick);
    groups[group].addLayer(casing);
    groups[group].addLayer(core);
    return core;
  }

  /* A small round marker with a glyph or a number in it. Built from a
     divIcon whose HTML is assembled here, from values this module chose —
     never from a route name or anything else off the network. */
  function dot(group, coord, opts) {
    opts = opts || {};
    var cls = "km-mark" + (opts.className ? " " + opts.className : "");
    var inner = opts.icon ? KM.icons.ui(opts.icon) : (opts.text != null ? String(opts.text) : "");
    if (opts.ride) inner = KM.icons.ride(opts.ride);

    var icon = L.divIcon({
      className: "km-mark-wrap",
      html: '<span class="' + cls + '" style="--mark:' + (opts.colour || COLOURS.route) + '">' + inner + "</span>",
      iconSize: [opts.size || 26, opts.size || 26],
      iconAnchor: [(opts.size || 26) / 2, (opts.size || 26) / 2]
    });
    var m = L.marker([coord.lat, coord.lon], {
      icon: icon,
      keyboard: false,
      title: opts.title ? String(opts.title) : undefined,
      zIndexOffset: opts.z || 0
    });
    if (opts.onClick) m.on("click", opts.onClick);
    groups[group].addLayer(m);
    return m;
  }

  function fit(path, opts) {
    opts = opts || {};
    if (!path || !path.length) return;
    var bounds = L.latLngBounds(path.map(function (p) { return [p[0], p[1]]; }));
    if (!bounds.isValid()) return;
    map.fitBounds(bounds, {
      /* The sheet covers the bottom of the screen, so a route fitted to the
         whole viewport is half hidden under it. */
      paddingTopLeft: [28, 70],
      paddingBottomRight: [28, opts.bottom == null ? 220 : opts.bottom],
      maxZoom: opts.maxZoom || 16,
      animate: true
    });
  }

  function centreOn(coord, zoom) {
    map.setView([coord.lat, coord.lon], zoom || Math.max(map.getZoom(), 15), { animate: true });
  }

  /* ---------------------------------------------------------
     Where you are

     Asked for, never assumed: nothing here starts a watch until somebody
     presses the locate button or picks "where I am". The fix stays on the
     phone — it is not sent anywhere, and a route you file records the
     stops you placed, not the track you walked.
     --------------------------------------------------------- */
  function locate(opts) {
    opts = opts || {};
    if (!navigator.geolocation) {
      return Promise.reject(KM.error("This browser cannot find where you are.", "geo"));
    }
    return new Promise(function (resolve, reject) {
      navigator.geolocation.getCurrentPosition(function (pos) {
        var fix = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        };
        lastFix = fix;
        showMe(fix);
        if (opts.centre !== false) centreOn(fix, 16);
        resolve(fix);
      }, function (err) {
        reject(KM.error(
          err && err.code === 1
            ? "Location is blocked for this site."
            : "Could not find where you are.",
          "geo"));
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
    });
  }

  function showMe(fix) {
    if (meMarker) { map.removeLayer(meMarker); meMarker = null; }
    if (meCircle) { map.removeLayer(meCircle); meCircle = null; }
    meCircle = L.circle([fix.lat, fix.lon], {
      radius: Math.min(fix.accuracy || 40, 200),
      color: "#2F6FBF", weight: 1, opacity: 0.4, fillOpacity: 0.10, interactive: false
    }).addTo(map);
    meMarker = L.circleMarker([fix.lat, fix.lon], {
      radius: 7, color: "#FFFFFF", weight: 3, fillColor: "#2F6FBF", fillOpacity: 1, interactive: false
    }).addTo(map);
  }

  function lastKnown() { return lastFix; }

  /* ---------------------------------------------------------
     Picking a point

     The pin is fixed at the centre of the map and the MAP moves under it,
     rather than a draggable marker. On a phone that is the difference
     between placing a point precisely and placing it under your own thumb.
     --------------------------------------------------------- */
  function startPick(cb) {
    onPick = cb;
    var root = KM.el("pick-root");
    if (root) root.hidden = false;
    if (cb) cb(centreCoord());
  }

  function stopPick() {
    onPick = null;
    var root = KM.el("pick-root");
    if (root) root.hidden = true;
  }

  function instance() { return map; }
  function invalidate() { if (map) map.invalidateSize(); }

  return {
    init: init,
    instance: instance,
    invalidate: invalidate,
    clear: clear,
    clearAll: clearAll,
    line: line,
    dot: dot,
    fit: fit,
    centreOn: centreOn,
    centreCoord: centreCoord,
    locate: locate,
    showMe: showMe,
    lastKnown: lastKnown,
    startPick: startPick,
    stopPick: stopPick,
    COLOURS: COLOURS
  };
})();

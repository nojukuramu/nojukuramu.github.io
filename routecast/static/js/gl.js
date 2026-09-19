/* ============================================================
   RouteCast — the vector engine, and the camera that rides behind you

   Leaflet draws a map by moving pictures of one around. That is the right
   answer for a planning screen and the wrong one for a windscreen: a
   picture cannot be tilted, and a road you are about to take looks exactly
   like a road you are not. This module adds the other kind of map —
   MapLibre GL, drawing vector tiles on the GPU — and the one thing that
   buys that Leaflet cannot do at all: a camera behind the rider, looking
   along the road, with the buildings standing up.

   What owns what
   --------------
   Leaflet stays the app. Every coordinate, every overlay, every marker and
   every bit of code that asks "where is the map looking" keeps talking to
   Leaflet, and none of it had to change. MapLibre is a canvas underneath
   the Leaflet panes, in one of two arrangements:

     flat     GL renders exactly Leaflet's view: same centre, same zoom,
              north up. The overlays land where they always did because the
              projection is the same one. This is the basemap swap.
     drive    GL takes the camera: heading up, tilted, buildings standing,
              and the rider low in the frame with the road running away
              ahead. Leaflet's flat overlays cannot follow a tilted camera,
              so the whole pane stack is hidden and MIRRORED into the scene
              instead — see below. Leaflet is still told where the camera
              ended up, so everything that reads the map's centre and zoom
              (the heat map's culling, the chip declutter, "mark the centre
              of the map") keeps getting the truth.

   The mirror, and why it is one adapter rather than six
   ----------------------------------------------------
   The route, the weather chips, the checkpoint dots, your marks, the other
   riders, the strangers on the public road, the free-drive track and the
   heat map are seven features that all draw themselves as Leaflet markers
   and polylines. Teaching each of them to draw itself a second time in 3D
   would be seven copies of one idea, drifting apart one release at a time.

   So nothing was taught anything. This walks Leaflet's own layers and
   mirrors them: a polyline becomes a GL line with the colour and width
   Leaflet was given, and a marker becomes a GL marker holding the very
   same markup, so every icon, every chip and every rider name is drawn in
   the 3D scene by the code that already drew it flat. A feature added to
   the flat map tomorrow is in the 3D view the same day, for free.

   Markers are scaled by how far away they are — measured rather than
   guessed, by projecting a twenty-metre stick at the marker's own feet —
   so an icon at the far end of the street is smaller than the one at your
   wheel, which is what makes them read as standing IN the scene instead of
   floating over a picture of it.

   The rider is the exception, and is real geometry: a chevron and a disc
   built in metres on the road surface and extruded, so it is foreshortened
   by the camera like everything else around it. A flat sprite pinned to
   the middle of the screen looked fine until the first time somebody
   dragged the map.

   Moving the map while riding
   ---------------------------
   The camera is not a cage. Dragging, pinching, twisting and two-finger
   tilting all work while riding: the gesture is reported to RC.follow,
   which is already the arbitration between the rider's hands and the app's
   camera, the Re-centre pill appears exactly as it does on the flat map,
   and the chase resumes when it says so. One idea of "who owns the map",
   not two.

   Cost
   ----
   The vendor bundle is a megabyte and is fetched the first time a vector
   basemap is chosen, not on load. The mirror runs on a timer at walking
   pace (TICK_MS) rather than per frame, and rebuilds lines only when
   Leaflet says a layer came or went.
   ============================================================ */
var RC = RC || {};

RC.gl = (function () {
  "use strict";

  var JS = "vendor/maplibre/maplibre-gl.js";
  var CSS = "vendor/maplibre/maplibre-gl.css";

  /* The chase camera. PITCH is as far as it can tilt before the horizon
     eats half the screen and the far tiles cost more than they show;
     RIDER_DROP is how far below centre the rider sits, which is what makes
     it a view from behind rather than a view from above. */
  var PITCH = 58;
  var RIDER_DROP = 0.18;         // of container height, below centre
  var DRIVE_MIN_ZOOM = 16.4;     // MapLibre zoom: 512px tiles, so Leaflet + 1

  var TICK_MS = 120;             // the drive heartbeat: camera, mirror, scales
  var PUSH_EVERY = 2;            // ticks between telling Leaflet where we are
  var MAX_LINES = 6000;          // a ceiling on one mirror pass
  var MAX_MARKERS = 160;

  var map = null;                // the Leaflet map
  var follow = null;             // RC.follow — who owns the map right now
  var gl = null;                 // the MapLibre map
  var host = null;               // the canvas container
  var loading = null;            // the vendor-script promise
  var currentId = null;
  var driving = false;
  var styleReady = false;
  var tickTimer = null;
  var ticks = 0;
  var savedZoomAnimation = null;
  var savedDragging = null;
  var target = { lat: null, lon: null, bearing: 0 };
  /* Who is deciding which way is up. While the compass is driving the
     camera (the usual case), a GPS course arriving with a fix must not
     overwrite the smoothed heading it has just written. */
  var bearingFromCompass = false;
  var driveZoom = null;          // GL owns the zoom while riding; see below
  var drivePitch = PITCH;        // and the tilt, once the rider has set one
  var onChange = null;

  var markers = {};              // leaflet layer id -> mirrored GL marker
  var linesDirty = true;
  var lineCount = 0;
  var mirroring = false;
  var rider = null;              // { lat, lon, bearing } as last drawn

  function norm(d) { return ((d % 360) + 360) % 360; }
  function delta(a, b) { var d = norm(b - a); return d > 180 ? d - 360 : d; }

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      v = v && v.trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  /* ---------------------------------------------------------
     Loading the vendor bundle, once
     --------------------------------------------------------- */
  function load() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      try {
        var link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = CSS;
        document.head.appendChild(link);
      } catch (e) {}
      var s = document.createElement("script");
      s.src = JS;
      s.async = true;
      s.onload = function () {
        if (window.maplibregl) resolve(window.maplibregl);
        else reject(new Error("The 3D map engine did not load."));
      };
      s.onerror = function () { reject(new Error("The 3D map engine could not be downloaded.")); };
      document.head.appendChild(s);
    });
    loading.catch(function () { loading = null; });
    return loading;
  }

  function ensureHost() {
    if (host) return host;
    var container = map.getContainer();
    host = document.createElement("div");
    host.className = "rc-gl";
    host.setAttribute("aria-hidden", "true");
    // First child, so every Leaflet pane stacks above it.
    container.insertBefore(host, container.firstChild);
    return host;
  }

  /* ---------------------------------------------------------
     Flat: GL renders exactly what Leaflet is looking at.
     512px vector tiles are one zoom level "bigger" than Leaflet's
     256px raster ones, which is the whole of the -1.
     --------------------------------------------------------- */
  function syncFlat() {
    if (!gl || driving) return;
    var c = map.getCenter();
    try {
      gl.jumpTo({
        center: [c.lng, c.lat], zoom: map.getZoom() - 1, bearing: 0, pitch: 0,
        padding: { top: 0, bottom: 0, left: 0, right: 0 }
      });
    } catch (e) {}
  }

  function resize() {
    if (!gl) return;
    try { gl.resize(); } catch (e) {}
    if (!driving) syncFlat();
  }

  /* ---------------------------------------------------------
     The drive camera

     While the rider is being followed this drives the camera. While they
     are not — they dragged, they twisted, they are looking at the junction
     two streets over — it drives nothing at all and MapLibre's own
     handlers have the map, which is the whole of "the camera is not a
     cage".
     --------------------------------------------------------- */
  /* One heartbeat for the whole 3D view: move the camera, re-read the
     overlays, re-scale the markers, and tell Leaflet where we ended up.

     It is a timer rather than a frame loop, and that is not a shortcut. A
     camera that writes the view on every frame fires MapLibre's whole
     movestart/move/moveend cascade sixty times a second AND fights the
     map's own gesture handlers for the camera — which is exactly how a
     drag ends up doing nothing at all. Setting a target eight times a
     second and letting MapLibre interpolate between them is smoother, an
     order of magnitude cheaper, and leaves the gestures alone. */
  function tick() {
    if (!gl || !driving) return;
    ticks++;
    if (document.visibilityState === "hidden") return;

    if (isFollowing() && target.lat != null) {
      try {
        gl.easeTo({
          center: [target.lon, target.lat],
          zoom: driveZoom,
          bearing: target.bearing,
          pitch: drivePitch,
          /* The rider is not the centre of the picture: the road ahead is.
             Padding the top of the frame pushes the camera target down the
             screen, which is what turns an overhead follow into a view from
             just behind the machine. */
          padding: { top: (host.clientHeight || 0) * RIDER_DROP * 2, bottom: 0, left: 0, right: 0 },
          duration: TICK_MS * 1.7,
          // Linear: an ease-in-out on every tick is a camera that lurches.
          easing: function (t) { return t; },
          /* This is the instrument, not decoration. A rider who has asked
             their phone for less motion has not asked for a navigation
             camera that teleports once a second. */
          essential: true
        });
      } catch (e) {}
    }

    // Sized in pixels, so a zoom or a tilt is as much a reason to redraw it
    // as a new fix is.
    drawRider();
    if (linesDirty) { linesDirty = false; mirrorLines(); }
    mirrorMarkers();
    scaleMarkers();
    if (ticks % PUSH_EVERY === 0) pushViewToLeaflet();
  }

  function startTick() {
    stopTick();
    ticks = 0;
    tickTimer = setInterval(tick, TICK_MS);
    tick();
  }

  function stopTick() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  function isFollowing() {
    return !follow || !follow.isEnabled() ? true : follow.isFollowing();
  }

  /* Leaflet is hidden while riding, but it is not idle: the heat map culls
     by its bounds, the chip declutter measures in its pixels, and "mark the
     centre of the map" means the centre of THIS map. So it is told where
     the camera went — cheaply, a few times a second, and never in a way
     that looks like the rider's own gesture. */
  function pushViewToLeaflet() {
    if (!gl || !driving) return;
    var c = gl.getCenter();
    var z = Math.round(gl.getZoom() + 1);
    try {
      var lc = map.getCenter();
      if (Math.abs(lc.lat - c.lat) < 1e-6 && Math.abs(lc.lng - c.lng) < 1e-6 &&
          map.getZoom() === z) return;
      var apply = function () { map.setView([c.lat, c.lng], z, { animate: false }); };
      if (follow && follow.silently) follow.silently(apply); else apply();
    } catch (e) {}
  }

  /* ---------------------------------------------------------
     The rider, as geometry rather than as a sprite

     Metres, on the road surface, extruded — so the camera foreshortens it
     exactly as it foreshortens the building it is riding past. Rebuilt
     every frame it moves, which is a four-point polygon and costs nothing.
     --------------------------------------------------------- */
  function metresToLngLat(lat, lon, dx, dy) {
    var dLat = dy / 111320;
    var dLon = dx / (111320 * Math.cos(lat * Math.PI / 180) || 1);
    return [lon + dLon, lat + dLat];
  }

  /* The rider is drawn in metres on the road surface, but it is SIZED in
     pixels: a puck eleven metres across is a readable badge at one zoom
     and four pixels of nothing at another. Metres per pixel are measured
     at the rider's own position, which is also the only place the answer
     is exactly right on a tilted map — so the marker keeps one size on the
     screen while still lying on the road and foreshortening with it. */
  var RIDER_PX = { nose: 23, tail: 14, half: 13, disc: 27, height: 10 };

  function riderShapes(lat, lon, bearingDeg) {
    var px = stickPx(lat, lon) / 20;               // pixels per metre, here
    var m = px > 0.0001 ? 1 / px : 1;              // metres per pixel
    var b = bearingDeg * Math.PI / 180;
    var cos = Math.cos(b), sin = Math.sin(b);
    var nose = [
      [0, RIDER_PX.nose * m],
      [RIDER_PX.half * m, -RIDER_PX.tail * m],
      [0, -RIDER_PX.tail * m * 0.45],
      [-RIDER_PX.half * m, -RIDER_PX.tail * m]
    ];
    var ring = [];
    for (var i = 0; i < nose.length; i++) {
      var x = nose[i][0], y = nose[i][1];
      ring.push(metresToLngLat(lat, lon, x * cos + y * sin, -x * sin + y * cos));
    }
    ring.push(ring[0]);

    var disc = [], r = RIDER_PX.disc * m;
    for (var a = 0; a <= 24; a++) {
      var t = (a / 24) * Math.PI * 2;
      disc.push(metresToLngLat(lat, lon, Math.cos(t) * r, Math.sin(t) * r));
    }

    return {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { part: "disc" }, geometry: { type: "Polygon", coordinates: [disc] } },
        { type: "Feature", properties: { part: "arrow", height: Math.max(2, RIDER_PX.height * m) },
          geometry: { type: "Polygon", coordinates: [ring] } }
      ]
    };
  }

  function drawRider() {
    if (!gl || !styleReady) return;
    var src = gl.getSource("rc-rider");
    if (!src) return;
    if (!driving || !rider || rider.lat == null) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    src.setData(riderShapes(rider.lat, rider.lon, rider.bearing));
  }

  /* ---------------------------------------------------------
     The mirror
     --------------------------------------------------------- */
  function ensureLayers() {
    if (!gl || !styleReady) return false;
    if (gl.getSource("rc-mirror")) return true;
    var accent = cssVar("--matcha", "#4F7A38");

    gl.addSource("rc-mirror", { type: "geojson", data: emptyFC() });
    gl.addLayer({
      id: "rc-mirror-lines", type: "line", source: "rc-mirror",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["coalesce", ["get", "color"], accent],
        "line-width": ["coalesce", ["get", "width"], 5],
        "line-opacity": ["coalesce", ["get", "opacity"], 1]
      }
    });

    gl.addSource("rc-rider", { type: "geojson", data: emptyFC() });
    gl.addLayer({
      id: "rc-rider-disc", type: "fill", source: "rc-rider",
      filter: ["==", ["get", "part"], "disc"],
      paint: { "fill-color": accent, "fill-opacity": 0.14 }
    });
    /* The footprint, drawn as a line: an extrusion has no outline of its
       own, and without one the chevron dissolves into a pale road surface
       exactly when it matters. It doubles as the contact shadow that makes
       it look like it is standing on the road rather than hovering. */
    gl.addLayer({
      id: "rc-rider-foot", type: "line", source: "rc-rider",
      filter: ["==", ["get", "part"], "arrow"],
      paint: { "line-color": "#0B0E12", "line-width": 1.4, "line-opacity": 0.35 }
    });
    gl.addLayer({
      id: "rc-rider-arrow", type: "fill-extrusion", source: "rc-rider",
      filter: ["==", ["get", "part"], "arrow"],
      paint: {
        "fill-extrusion-color": accent,
        "fill-extrusion-height": ["coalesce", ["get", "height"], 3],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.95,
        "fill-extrusion-vertical-gradient": true
      }
    });
    return true;
  }

  function emptyFC() { return { type: "FeatureCollection", features: [] }; }

  /* A Leaflet polyline carries everything needed to draw it again: the
     coordinates, and the colour, width and opacity it was given. Nothing is
     re-derived here, so a route coloured amber by the forecast is amber in
     the 3D view because it is the same amber. */
  function mirrorLines() {
    if (!ensureLayers()) return;
    var features = [];
    map.eachLayer(function (l) {
      if (features.length >= MAX_LINES) return;
      if (!l || (l.options && l.options.rcSkipGl)) return;
      if (typeof L.Polyline !== "function" || !(l instanceof L.Polyline)) return;
      if (typeof L.Polygon === "function" && l instanceof L.Polygon) return;
      var pts = l.getLatLngs ? l.getLatLngs() : null;
      if (!pts || !pts.length || !pts[0] || pts[0].lat == null) return;
      var coords = [];
      for (var i = 0; i < pts.length; i++) coords.push([pts[i].lng, pts[i].lat]);
      var o = l.options || {};
      features.push({
        type: "Feature",
        properties: {
          color: o.color || null,
          width: typeof o.weight === "number" ? o.weight : 5,
          opacity: typeof o.opacity === "number" ? o.opacity : 1
        },
        geometry: { type: "LineString", coordinates: coords }
      });
    });
    lineCount = features.length;
    try { gl.getSource("rc-mirror").setData({ type: "FeatureCollection", features: features }); } catch (e) {}
  }

  /* The markers keep their own markup — the chip, the dot, the rider name,
     the mark's flag — so whatever the app drew flat is what stands in the
     scene. Only the position and the scale are ours. */
  function mirrorMarkers() {
    if (!gl || !styleReady) return;
    var seen = {}, count = 0;
    map.eachLayer(function (l) {
      if (count >= MAX_MARKERS) return;
      if (!l || (l.options && l.options.rcSkipGl)) return;
      if (typeof L.Marker !== "function" || !(l instanceof L.Marker)) return;
      var ll = l.getLatLng ? l.getLatLng() : null;
      if (!ll) return;
      var el = l.getElement ? l.getElement() : null;
      var html = el ? el.innerHTML : "";
      if (!html) return;

      var id = L.Util.stamp(l);
      seen[id] = true;
      count++;
      var rec = markers[id];
      if (!rec) {
        var wrap = document.createElement("div");
        wrap.className = "rc-gl-marker";
        // A mirror of something already in the document: one copy in the
        // accessibility tree, not two.
        wrap.setAttribute("aria-hidden", "true");
        var inner = document.createElement("div");
        inner.className = "rc-gl-marker-in";
        wrap.appendChild(inner);
        var icon = (l.options && l.options.icon && l.options.icon.options) || {};
        var size = icon.iconSize || [24, 24];
        var anchor = icon.iconAnchor || [size[0] / 2, size[1] / 2];
        var m = new window.maplibregl.Marker({
          element: wrap,
          anchor: "center",
          // Leaflet anchors from the icon's top-left; MapLibre from its centre.
          offset: [size[0] / 2 - anchor[0], size[1] / 2 - anchor[1]],
          pitchAlignment: "viewport",
          rotationAlignment: "viewport"
        }).setLngLat([ll.lng, ll.lat]).addTo(gl);
        rec = markers[id] = { m: m, wrap: wrap, inner: inner, html: "" };
      }
      if (rec.html !== html) { rec.inner.innerHTML = html; rec.html = html; }
      rec.m.setLngLat([ll.lng, ll.lat]);
      rec.lat = ll.lat; rec.lng = ll.lng;
    });

    for (var id2 in markers) {
      if (!seen[id2]) { try { markers[id2].m.remove(); } catch (e) {} delete markers[id2]; }
    }
  }

  /* How big is a marker that is over there rather than here? Measured, not
     guessed: project a twenty-metre stick at the marker's own feet and see
     how many pixels it covers compared with one at the camera's target.
     Two projections per marker, and it is what stops a chip at the end of
     the street being the same size as the one at your wheel. */
  function scaleMarkers() {
    if (!gl || !driving) return;
    var ref = stickPx(gl.getCenter().lat, gl.getCenter().lng);
    if (!ref) return;
    for (var id in markers) {
      var rec = markers[id];
      if (rec.lat == null) continue;
      var px = stickPx(rec.lat, rec.lng);
      var s = px && ref ? px / ref : 1;
      s = Math.max(0.45, Math.min(1.25, s));
      if (rec.scale === undefined || Math.abs(rec.scale - s) > 0.02) {
        rec.scale = s;
        /* The INNER element, not the wrapper: the wrapper is MapLibre's own
           marker element and it rewrites transform on it every frame to
           position it. Scaling that is a scale that lasts until the next
           frame. */
        rec.inner.style.transform = "scale(" + s.toFixed(3) + ")";
        // Far markers stack up into a wall of chips; fading them keeps the
        // near ones readable without hiding anything outright.
        rec.inner.style.opacity = s < 0.62 ? String(0.45 + (s - 0.45) * 3) : "1";
      }
    }
  }

  function stickPx(lat, lng) {
    try {
      var a = gl.project([lng, lat]);
      var b = gl.project(metresToLngLat(lat, lng, 0, 20));
      var dx = a.x - b.x, dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    } catch (e) { return 0; }
  }

  function startMirror() {
    linesDirty = true;
    if (mirroring) return;
    mirroring = true;
    map.on("layeradd", onLayerChange);
    map.on("layerremove", onLayerChange);
  }

  function stopMirror() {
    mirroring = false;
    map.off("layeradd", onLayerChange);
    map.off("layerremove", onLayerChange);
    for (var id in markers) { try { markers[id].m.remove(); } catch (e) {} }
    markers = {};
    if (gl && styleReady && gl.getSource("rc-mirror")) {
      try { gl.getSource("rc-mirror").setData(emptyFC()); } catch (e) {}
    }
  }

  function onLayerChange() { linesDirty = true; }

  /* The rider is drawn in the app's own accent, which is a different green
     in the dark palette. The mirrored overlays carry their own colours, so
     this is the only thing a theme change has to repaint. */
  function repaintAccent() {
    if (!gl || !styleReady || !gl.getLayer("rc-rider-arrow")) return;
    var accent = cssVar("--matcha", "#4F7A38");
    try {
      gl.setPaintProperty("rc-rider-arrow", "fill-extrusion-color", accent);
      gl.setPaintProperty("rc-rider-disc", "fill-color", accent);
    } catch (e) {}
  }

  function onStyleData() {
    if (!gl || !gl.isStyleLoaded || !gl.isStyleLoaded()) return;
    styleReady = true;
    if (gl.getSource("rc-mirror")) return;   // nothing was lost
    ensureLayers();
    setBuildings(driving);
    linesDirty = true;
    if (driving) { startMirror(); tick(); }
  }

  function setBuildings(visible) {
    if (!gl || !styleReady) return;
    try {
      if (gl.getLayer("rc-building-3d")) {
        gl.setLayoutProperty("rc-building-3d", "visibility", visible ? "visible" : "none");
      }
    } catch (e) {}
  }

  /* ---------------------------------------------------------
     Gestures while riding

     Every one of them means the same thing the flat map means by a drag:
     "let me look". RC.follow already knows what to do about that, and
     already owns the Re-centre pill, so it is told rather than second-
     guessed.
     --------------------------------------------------------- */
  /* MapLibre fires movestart, zoomstart and the rest for the camera's own
     moves as well as for the rider's, and the camera moves on every frame.
     An event with no originalEvent came from us, and mistaking one for a
     gesture means the chase switches itself off the instant it starts. */
  function fromHand(e) { return !!(e && e.originalEvent); }

  function onGesture(e) {
    if (!driving || !fromHand(e)) return;
    if (follow && follow.looked) follow.looked();
    remember();
  }

  /* Whatever the rider zooms or tilts to is what the chase resumes at —
     the same rule RC.follow already applies to a zoom on the flat map. A
     camera that springs back to its own idea of the right angle the moment
     you let go is a camera you stop touching. */
  function remember() {
    driveZoom = gl.getZoom();
    drivePitch = gl.getPitch();
  }

  function onGlMove(e) {
    if (!driving || !fromHand(e)) return;
    remember();
  }

  function setInteractive(on) {
    if (!gl) return;
    ["dragPan", "dragRotate", "touchZoomRotate", "touchPitch", "doubleClickZoom",
     "scrollZoom", "keyboard"].forEach(function (name) {
      var h = gl[name];
      if (!h) return;
      try { on ? h.enable() : h.disable(); } catch (e) {}
    });
    if (on && gl.touchZoomRotate && gl.touchZoomRotate.enableRotation) {
      try { gl.touchZoomRotate.enableRotation(); } catch (e) {}
    }
  }

  function attachListeners() {
    map.on("move", syncFlat);
    map.on("zoom", syncFlat);
    map.on("viewreset", syncFlat);
    map.on("resize", resize);
  }

  function detachListeners() {
    map.off("move", syncFlat);
    map.off("zoom", syncFlat);
    map.off("viewreset", syncFlat);
    map.off("resize", resize);
  }

  function fire() {
    if (typeof onChange === "function") { try { onChange(api.state()); } catch (e) {} }
  }

  var api = {
    init: function (opts) {
      map = opts.map;
      follow = opts.follow || null;
      onChange = opts.onChange || null;
    },

    /** Is this browser going to be able to draw any of this at all? A
        phone with WebGL switched off gets told once, and keeps its raster
        map, rather than being handed a blank rectangle. */
    supported: function () {
      try {
        var c = document.createElement("canvas");
        return !!(window.WebGLRenderingContext &&
                  (c.getContext("webgl") || c.getContext("experimental-webgl")));
      } catch (e) { return false; }
    },

    /** Fetch the engine without putting a map up. Called once a route is on
        the screen, because the alternative is a rider pressing Start and
        then waiting on a megabyte over whatever signal a car park has. */
    warm: function () {
      if (!api.supported()) return Promise.resolve(false);
      return load().then(function () { return true; }, function () { return false; });
    },

    isOn: function () { return !!gl; },
    isDriving: function () { return driving; },
    baseId: function () { return currentId; },

    /** Put a vector basemap up. Resolves once the style is drawable. */
    use: function (id) {
      var spec = RC.mapstyles.spec(id);
      if (!spec) return Promise.reject(new Error("Not a vector map."));
      if (!api.supported()) return Promise.reject(new Error("This browser cannot draw 3D maps."));
      currentId = id;
      return load().then(function (maplibregl) {
        ensureHost();
        if (gl) {
          styleReady = false;
          gl.setStyle(spec);
          return waitForStyle();
        }
        var c = map.getCenter();
        gl = new maplibregl.Map({
          container: host,
          style: spec,
          center: [c.lng, c.lat],
          zoom: map.getZoom() - 1,
          attributionControl: false,
          // Leaflet owns every gesture on the flat map; drive() hands the
          // gestures over when there is a camera to move.
          interactive: false,
          fadeDuration: 0,
          refreshExpiredTiles: false
        });
        ["dragstart", "rotatestart", "pitchstart", "zoomstart", "wheel", "touchstart"]
          .forEach(function (name) { gl.on(name, onGesture); });
        gl.on("move", onGlMove);
        /* Changing the map under a running ride throws away every source and
           layer this module added — the mirror, the rider, all of it — and
           the rider is left looking at an empty world with a ride in
           progress. Rebuilding them whenever the style says it is ready is
           cheaper than trying to remember every way a style can change. */
        gl.on("styledata", onStyleData);
        /* Leaflet's zoom animation and a GL canvas cannot agree on where
           the world is during the animation: a Leaflet zoom scales a pane
           of images and swaps them at the end, and a GL canvas cannot be
           scaled without re-projecting every line on it. An honest instant
           zoom beats a quarter second of two maps sliding apart. */
        savedZoomAnimation = map.options.zoomAnimation;
        map.options.zoomAnimation = false;
        attachListeners();
        return waitForStyle();
      }).then(function () {
        styleReady = true;
        ensureLayers();
        setBuildings(driving);
        if (driving) { startMirror(); drawRider(); }
        syncFlat();
        fire();
        return true;
      });
    },

    /** Back to a raster basemap: the GL canvas goes away entirely rather
        than sitting behind the tiles burning a GPU context. */
    release: function () {
      if (driving) api.drive(false);
      if (gl) {
        detachListeners();
        try { gl.remove(); } catch (e) {}
        gl = null;
        if (savedZoomAnimation != null) map.options.zoomAnimation = savedZoomAnimation;
        savedZoomAnimation = null;
      }
      if (host && host.parentNode) { host.parentNode.removeChild(host); host = null; }
      styleReady = false;
      currentId = null;
      fire();
    },

    /** The chase camera. Only meaningful while a vector basemap is up. */
    drive: function (on) {
      on = !!on && !!gl;
      if (on === driving) return driving;
      driving = on;
      document.documentElement.setAttribute("data-gl3d", on ? "on" : "off");
      setBuildings(on);
      if (on) {
        /* Leaflet's own dragging would move a map nobody can see. The
           gestures belong to the GL camera now — which can actually turn
           and tilt, which is the whole reason for being here. */
        try {
          savedDragging = !!(map.dragging && map.dragging.enabled());
          if (map.dragging) map.dragging.disable();
        } catch (e) {}
        driveZoom = Math.max(map.getZoom() - 1, DRIVE_MIN_ZOOM);
        drivePitch = PITCH;
        setInteractive(true);
        startMirror();
        drawRider();
        startTick();
      } else {
        stopTick();
        setInteractive(false);
        stopMirror();
        drawRider();
        try { if (savedDragging && map.dragging) map.dragging.enable(); } catch (e) {}
        savedDragging = null;
        bearingFromCompass = false;
        driveZoom = null;
        syncFlat();
      }
      fire();
      return driving;
    },

    /** Every fix, while driving. Heading is degrees clockwise from north —
        the direction of travel, not Leaflet's negated rotation angle. */
    setRider: function (lat, lon, headingDeg) {
      target.lat = lat;
      target.lon = lon;
      if (!bearingFromCompass && typeof headingDeg === "number" && !isNaN(headingDeg)) {
        target.bearing = norm(headingDeg);
      }
      rider = { lat: lat, lon: lon, bearing: target.bearing };
    },

    /** Which way is up, fed by the compass — which already decides whether
        a GPS course or the magnetometer is telling the truth, and has
        already smoothed it. Nothing here second-guesses that. */
    setBearing: function (deg) {
      if (typeof deg !== "number" || isNaN(deg)) return;
      bearingFromCompass = true;
      target.bearing = norm(deg);
      /* The compass writes a heading up to once a frame. Redrawing four
         points of geometry that often is waste; the heartbeat picks it up. */
      if (rider) rider.bearing = target.bearing;
    },

    /** Something on the flat map changed — a new route, a cleared plan, a
        theme swap. Re-read it rather than waiting for the next tick. */
    sync: function () {
      linesDirty = true;
      repaintAccent();
      if (driving) tick();
    },

    /** The app's own zoom buttons, while the GL camera has the map. */
    zoomBy: function (d) {
      if (!gl || !driving) return false;
      driveZoom = Math.max(1, Math.min(21, (driveZoom == null ? gl.getZoom() : driveZoom) + d));
      if (!isFollowing()) { try { gl.easeTo({ zoom: driveZoom, duration: 180 }); } catch (e) {} }
      return true;
    },

    /* Where the camera actually is, read off the live map rather than off
       what we last asked for — the panel says "camera is up", and a panel
       that says that while the view is flat is worse than one that says
       nothing. */
    state: function () {
      var bearing = 0, pitch = 0;
      if (gl) {
        try { bearing = gl.getBearing(); pitch = gl.getPitch(); } catch (e) {}
      }
      var c = null;
      try { if (gl) { var g = gl.getCenter(); c = [g.lat, g.lng]; } } catch (e) {}
      return {
        on: !!gl, driving: driving, base: currentId, ready: styleReady,
        bearing: bearing, pitch: pitch, centre: c,
        following: driving ? isFollowing() : null,
        lines: lineCount,
        rider: !!(driving && rider && rider.lat != null),
        grabbable: !!(gl && gl.dragPan && gl.dragPan.isEnabled()),
        markers: Object.keys(markers).length
      };
    }
  };

  function waitForStyle() {
    return new Promise(function (resolve, reject) {
      var done = false;
      function ok() { if (!done) { done = true; resolve(true); } }
      function bad(e) {
        if (done) return;
        done = true;
        reject(new Error((e && e.error && e.error.message) || "The map style failed to load."));
      }
      if (gl.isStyleLoaded && gl.isStyleLoaded()) return ok();
      gl.once("style.load", ok);
      /* A tile server that is simply down must not leave the app waiting on
         a promise forever: the style itself is local, so if it has not
         parsed in five seconds something is wrong with the engine, not the
         network. */
      setTimeout(function () { if (gl && gl.isStyleLoaded && gl.isStyleLoaded()) ok(); else bad(null); }, 5000);
    });
  }

  return api;
})();

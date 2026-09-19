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
   Leaflet stays the app. Every coordinate, every overlay, every marker,
   every bit of code that asks "where is the map looking" keeps talking to
   Leaflet, and none of it had to change. MapLibre is a canvas underneath
   the Leaflet panes, told where to look:

     flat     GL renders exactly Leaflet's view: same centre, same zoom,
              north up. The overlays land where they always did because
              the projection is the same one. This is the basemap swap,
              and everything in the app keeps working.
     drive    GL takes the camera: the rider's heading becomes the bearing,
              the view tilts, the buildings come up, and the rider sits low
              in the frame with the road running away ahead. Leaflet's flat
              overlays cannot follow a tilted camera, so they are hidden and
              GL draws the two that matter — the route and where you are.

   Why Leaflet's zoom animation is switched off while GL is the basemap
   -------------------------------------------------------------------
   A Leaflet zoom animates by scaling a pane of images and swapping them at
   the end. A GL canvas cannot be scaled without re-projecting every line on
   it, so during those 250ms the basemap and the route would disagree about
   where north is. An honest instant zoom beats a quarter second of two maps
   sliding apart, so the animation is disabled while GL is on and restored
   when it goes.

   Why the camera interpolates here instead of using easeTo
   -------------------------------------------------------
   Fixes arrive about once a second and the heading changes every frame. Two
   overlapping easeTo animations fight, and the map wobbles. So one rAF loop
   holds a target and eases the live camera towards it — position, bearing
   and zoom together, on the shortest arc — and writes it with jumpTo. It
   runs only while the drive camera is on and the page is visible.

   Cost
   ----
   The vendor bundle is a megabyte and is fetched the first time a vector
   basemap is chosen, not on load: somebody who never leaves the Standard
   map never pays for it. After that the service worker has it like any
   other same-origin file.
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
  var EASE_POS = 0.16;           // per frame, towards the last fix
  var EASE_BEARING = 0.14;

  var map = null;                // the Leaflet map
  var gl = null;                 // the MapLibre map
  var host = null;               // the canvas container
  var riderEl = null;
  var loading = null;            // the vendor-script promise
  var currentId = null;
  var driving = false;
  var styleReady = false;
  var frame = null;
  var savedZoomAnimation = null;
  var pendingRoute = null;
  var savedDragging = null;
  var target = { lat: null, lon: null, bearing: 0 };
  /* Who is deciding which way is up. While the compass is driving the
     camera (the usual case), a GPS course arriving with a fix must not
     overwrite the smoothed heading it has just written. */
  var bearingFromCompass = false;
  var cam = { lat: null, lon: null, bearing: 0 };
  var onChange = null;

  function norm(d) { return ((d % 360) + 360) % 360; }
  function delta(a, b) { var d = norm(b - a); return d > 180 ? d - 360 : d; }

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

  /* ---------------------------------------------------------
     The canvas
     --------------------------------------------------------- */
  function ensureHost() {
    if (host) return host;
    var container = map.getContainer();
    host = document.createElement("div");
    host.className = "rc-gl";
    host.setAttribute("aria-hidden", "true");
    // First child, so every Leaflet pane stacks above it.
    container.insertBefore(host, container.firstChild);

    riderEl = document.createElement("div");
    riderEl.className = "rc-gl-rider";
    riderEl.hidden = true;
    riderEl.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 2.6 19 20l-7-4.1L5 20 12 2.6Z" fill="currentColor"/></svg>';
    container.appendChild(riderEl);
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
    placeRider();
  }

  function placeRider() {
    if (!riderEl || !host) return;
    var h = host.clientHeight || 0;
    riderEl.style.transform = "translate(-50%, -50%) translateY(" + Math.round(h * RIDER_DROP) + "px)";
  }

  /* ---------------------------------------------------------
     The drive camera
     --------------------------------------------------------- */
  function driveFrame() {
    frame = null;
    if (!gl || !driving) return;
    if (target.lat == null) { schedule(); return; }
    if (document.visibilityState === "hidden") { schedule(); return; }

    if (cam.lat == null) { cam.lat = target.lat; cam.lon = target.lon; cam.bearing = target.bearing; }
    else {
      cam.lat += (target.lat - cam.lat) * EASE_POS;
      cam.lon += (target.lon - cam.lon) * EASE_POS;
      cam.bearing = norm(cam.bearing + delta(cam.bearing, target.bearing) * EASE_BEARING);
    }

    var zoom = Math.max(map.getZoom() - 1, DRIVE_MIN_ZOOM);
    try {
      gl.jumpTo({
        center: [cam.lon, cam.lat],
        zoom: zoom,
        bearing: cam.bearing,
        pitch: PITCH,
        /* The rider is not the centre of the picture: the road ahead is.
           Padding the top of the frame pushes the camera target down the
           screen, which is what turns an overhead follow into a view from
           just behind the machine. (jumpTo honours padding; `offset` is an
           animation option and would be silently ignored here.) */
        padding: { top: (host.clientHeight || 0) * RIDER_DROP * 2, bottom: 0, left: 0, right: 0 }
      });
    } catch (e) {}
    schedule();
  }

  function schedule() {
    if (frame != null || !driving) return;
    frame = requestAnimationFrame(driveFrame);
  }

  /* ---------------------------------------------------------
     What GL draws for itself while the Leaflet overlays are hidden
     --------------------------------------------------------- */
  function ensureRouteSource() {
    if (!gl || !styleReady) return false;
    if (gl.getSource("rc-route")) return true;
    gl.addSource("rc-route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    gl.addLayer({
      id: "rc-route-case", type: "line", source: "rc-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#0B0E12", "line-width": 13, "line-opacity": 0.35 }
    });
    gl.addLayer({
      id: "rc-route-line", type: "line", source: "rc-route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["coalesce", ["get", "color"], "#4F7A38"], "line-width": 8 }
    });
    return true;
  }

  function pushRoute(segments) {
    pendingRoute = segments || [];
    renderRoute();
  }

  /* The route is only drawn by GL while the flat Leaflet overlays are
     hidden — that is, while driving. The rest of the time Leaflet draws it,
     and drawing it twice would be two lines one pixel apart. */
  function renderRoute() {
    if (!gl || !styleReady) return;
    if (!ensureRouteSource()) return;
    var list = driving ? (pendingRoute || []) : [];
    var features = [];
    for (var i = 0; i < list.length; i++) {
      var seg = list[i];
      if (!seg || !seg.coords || seg.coords.length < 2) continue;
      var line = [];
      for (var j = 0; j < seg.coords.length; j++) line.push([seg.coords[j][1], seg.coords[j][0]]);
      features.push({
        type: "Feature",
        properties: { color: seg.color || null },
        geometry: { type: "LineString", coordinates: line }
      });
    }
    try {
      gl.getSource("rc-route").setData({ type: "FeatureCollection", features: features });
    } catch (e) {}
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
     Turning it on and off
     --------------------------------------------------------- */
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
          interactive: false,      // Leaflet owns every gesture; GL only renders
          fadeDuration: 0,
          refreshExpiredTiles: false
        });
        /* Leaflet's zoom animation and a GL canvas cannot agree on where
           the world is during the animation; see the header. */
        savedZoomAnimation = map.options.zoomAnimation;
        map.options.zoomAnimation = false;
        attachListeners();
        return waitForStyle();
      }).then(function () {
        styleReady = true;
        setBuildings(driving);
        renderRoute();
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
      if (riderEl && riderEl.parentNode) { riderEl.parentNode.removeChild(riderEl); riderEl = null; }
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
      if (riderEl) riderEl.hidden = !on;
      if (on) {
        /* A drag would move a map nobody can see — the camera is on the
           rider, not on Leaflet's centre — so the gesture is taken away
           rather than left doing nothing. Zoom still works, because the
           camera reads its zoom from Leaflet. */
        try {
          savedDragging = !!(map.dragging && map.dragging.enabled());
          if (map.dragging) map.dragging.disable();
        } catch (e) {}
        cam.lat = cam.lon = null;
        placeRider();
        renderRoute();
        schedule();
      } else {
        if (frame != null) { cancelAnimationFrame(frame); frame = null; }
        try { if (savedDragging && map.dragging) map.dragging.enable(); } catch (e) {}
        savedDragging = null;
        bearingFromCompass = false;
        renderRoute();
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
      if (driving) schedule();
    },

    /** Which way is up, fed by the compass — which already decides whether
        a GPS course or the magnetometer is telling the truth, and has
        already smoothed it. Nothing here second-guesses that. */
    setBearing: function (deg) {
      if (typeof deg !== "number" || isNaN(deg)) return;
      bearingFromCompass = true;
      target.bearing = norm(deg);
      if (driving) schedule();
    },

    /** The route, as the app already coloured it: [{coords:[[lat,lon]…],
        color}]. Handed over rather than re-derived, so the 3D view and the
        flat one can never disagree about what the weather is doing. */
    setRoute: function (segments) { pushRoute(segments); },

    /* Where the camera actually is, read off the live map rather than off
       what we last asked for — the panel says "camera is up", and a panel
       that says that while the view is flat is worse than one that says
       nothing. */
    state: function () {
      var bearing = 0, pitch = 0;
      if (gl) {
        try { bearing = gl.getBearing(); pitch = gl.getPitch(); } catch (e) {}
      }
      return {
        on: !!gl, driving: driving, base: currentId, ready: styleReady,
        bearing: bearing, pitch: pitch
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

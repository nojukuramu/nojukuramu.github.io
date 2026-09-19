/* ============================================================
   RouteCast — Layers

   Everything the map is made of, in one place and under one name: what the
   ground is drawn from, and what RouteCast draws on top of it.

     The base      one map at a time, either a raster tile layer drawn by
                   Leaflet or a vector style drawn by MapLibre (gl.js).
     The drive map a SECOND choice, used only while a ride is running. This
                   is not a duplicated setting for its own sake: the map you
                   want while planning at a table — labelled, familiar,
                   flat — is not the map you want on a bar mount at 80km/h,
                   and having to switch it by hand twice a ride is how a
                   setting ends up never being used.
     The draws     the heat map, and whatever joins it. These sit over
                   whichever base is up and are unaffected by it.

   The chase camera
   ----------------
   With a vector base up, a ride gets a camera behind the machine: the view
   tilts, the buildings stand up, and the map turns so the road ahead is
   always up the screen. The rotation is the same compass module that
   already decides between a GPS course and the magnetometer — it simply
   hands the heading to a camera instead of to a CSS transform, so north-up
   and course-up still mean what they meant, and the compass button still
   does what it did.

   The trade it makes is stated rather than hidden: a tilted camera and
   Leaflet's flat overlays cannot both be right, so while the camera is
   tilted the overlays are hidden and the vector engine draws the two things
   that matter at speed — the route, in the colours the forecast gave it,
   and where you are. Weather chips, other riders and marks are a tap away
   again the moment you go flat or stop.

   Falling back
   ------------
   Every failure ends the same way: back on the raster map, with one line
   saying why. No WebGL, a vendor bundle that will not download, a style
   that will not parse — none of them is allowed to leave a rider looking at
   a blank rectangle.
   ============================================================ */
var RC = RC || {};

RC.layers = (function () {
  "use strict";

  var DEFAULT_BASE = "osm";
  var DEFAULT_DRIVE_BASE = "streets";

  var map = null;
  var bridge = null;
  var raster = null;          // the Leaflet tile layer, when one is up
  var applied = null;         // the base id currently on the map
  var base = DEFAULT_BASE;    // what the rider chose for planning
  var driveBase = DEFAULT_DRIVE_BASE;
  var drive3d = true;
  var driving = false;
  var onChange = null;
  var lastRoute = null;

  function say(msg) {
    if (!bridge || !bridge.setStatus) return;
    bridge.setStatus(msg, "");
    if (bridge.flashStatus) bridge.flashStatus(5000);
  }

  function fire() {
    if (typeof onChange === "function") { try { onChange(api.state()); } catch (e) {} }
  }

  /* ---------------------------------------------------------
     Putting a base on the map
     --------------------------------------------------------- */
  function addRaster(def) {
    if (raster) map.removeLayer(raster);
    raster = L.tileLayer(def.url, { maxZoom: def.maxZoom || 19, crossOrigin: true });
    // Underneath every other layer, wherever it was added from.
    raster.addTo(map);
    try { raster.bringToBack(); } catch (e) {}
  }

  function dropRaster() {
    if (!raster) return;
    map.removeLayer(raster);
    raster = null;
  }

  function apply(id, opts) {
    opts = opts || {};
    var def = RC.mapstyles.get(id) || RC.mapstyles.get(DEFAULT_BASE);
    if (applied === def.id && !opts.force) return Promise.resolve(def.id);

    if (def.kind === "raster") {
      RC.gl.release();
      addRaster(def);
      applied = def.id;
      document.documentElement.setAttribute("data-basemap", "raster");
      fire();
      return Promise.resolve(def.id);
    }

    if (!RC.gl.supported()) {
      say("This browser cannot draw 3D maps, so the standard map stays up.");
      return fallback();
    }

    return RC.gl.use(def.id).then(function () {
      /* The tiles go only once the vector map is actually drawable: a
         rider watching a blank rectangle while a megabyte downloads has no
         way of telling it from a crash. */
      dropRaster();
      applied = def.id;
      document.documentElement.setAttribute("data-basemap", "gl");
      fire();
      return def.id;
    }, function (err) {
      say((err && err.message) || "That map could not be loaded.");
      return fallback();
    });
  }

  function fallback() {
    base = DEFAULT_BASE;
    RC.store.set("mapBase", base);
    return apply(DEFAULT_BASE, { force: true });
  }

  /* ---------------------------------------------------------
     Riding
     --------------------------------------------------------- */
  function cameraOn() {
    if (!drive3d || !RC.gl.isOn()) return;
    RC.gl.drive(true);
    /* The compass keeps choosing the heading and keeps smoothing it; it
       just writes it to the camera now instead of to a CSS transform. */
    RC.compass.setRenderer(RC.gl.setBearing);
    if (lastRoute) RC.gl.setRoute(lastRoute);
  }

  function cameraOff() {
    RC.compass.setRenderer(null);
    RC.gl.drive(false);
  }

  var api = {
    init: function (opts) {
      map = opts.map;
      bridge = opts.bridge || null;
      onChange = opts.onChange || null;

      base = RC.store.get("mapBase", DEFAULT_BASE);
      driveBase = RC.store.get("driveBase", DEFAULT_DRIVE_BASE);
      drive3d = RC.store.get("drive3d", true) !== false;
      if (!RC.mapstyles.has(base)) base = DEFAULT_BASE;
      if (!RC.mapstyles.has(driveBase)) driveBase = DEFAULT_DRIVE_BASE;

      document.documentElement.setAttribute("data-gl3d", "off");
      RC.gl.init({ map: map, onChange: fire });
      return apply(base);
    },

    /* ---- the base ---- */
    base: function () { return base; },
    appliedBase: function () { return applied; },

    setBase: function (id) {
      if (!RC.mapstyles.has(id)) return base;
      base = id;
      RC.store.set("mapBase", id);
      if (!driving) apply(id);
      fire();
      return base;
    },

    /* ---- driving ---- */
    driveBase: function () { return driveBase; },

    setDriveBase: function (id) {
      if (!RC.mapstyles.has(id)) return driveBase;
      driveBase = id;
      RC.store.set("driveBase", id);
      if (driving) {
        apply(id).then(function () { if (drive3d) cameraOn(); else cameraOff(); });
      }
      fire();
      return driveBase;
    },

    drive3d: function () { return drive3d; },

    setDrive3d: function (on) {
      drive3d = !!on;
      RC.store.set("drive3d", drive3d);
      if (driving) { if (drive3d) cameraOn(); else cameraOff(); }
      fire();
      return drive3d;
    },

    /** A ride started. The drive map goes up, and the camera with it. */
    enterDrive: function () {
      if (driving) return;
      driving = true;
      apply(driveBase).then(function () { if (drive3d) cameraOn(); });
      fire();
    },

    /** Back to planning: the camera lets go and the chosen base comes back. */
    leaveDrive: function () {
      if (!driving) return;
      driving = false;
      cameraOff();
      apply(base);
      fire();
    },

    /** There is a route on the screen, so a ride is plausible: get the
        engine into the cache now rather than at the kerb. */
    warm: function () {
      var def = RC.mapstyles.get(driveBase);
      if (def && def.kind === "gl") RC.gl.warm();
    },

    isDriving: function () { return driving; },
    isCameraOn: function () { return RC.gl.isDriving(); },

    /* ---- what the vector engine is given to draw ---- */

    /** The route exactly as the app coloured it for Leaflet — handed over,
        never re-derived, so the two views cannot disagree about what the
        weather is doing on a stretch. */
    setRoute: function (segments) {
      lastRoute = segments || null;
      RC.gl.setRoute(lastRoute);
    },

    rider: function (lat, lon, courseDeg) {
      if (RC.gl.isDriving()) RC.gl.setRider(lat, lon, courseDeg);
    },

    state: function () {
      return {
        base: base,
        applied: applied,
        driveBase: driveBase,
        drive3d: drive3d,
        driving: driving,
        camera: RC.gl.isDriving(),
        gl: RC.gl.isOn(),
        view: RC.gl.state()
      };
    }
  };

  return api;
})();

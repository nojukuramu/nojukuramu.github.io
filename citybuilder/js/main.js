/* main.js
 * Boots the engine, wires quality-tier change callbacks across every
 * module, drives the render/simulation loop, and owns the small amount of
 * top-level game-flow state (new game / continue / load / autosave) that
 * doesn't belong to any single system.
 */
(function () {
  "use strict";

  function boot() {
    var canvas = document.getElementById("game-canvas");
    Game.UI.init();
    Game.UI.setBootProgress(5, "measuring your device…");

    var settings = QualityManager.init();
    Game.UI.setBootProgress(15, "tuning graphics for your device…");

    Game.scene = new THREE.Scene();
    // Far plane is fixed (not quality-scaled) so the sky dome never clips —
    // perceived draw distance is controlled by fog instead, see lighting.js.
    Game.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 950);
    Game.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
    Game.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.pixelRatioCap));
    Game.renderer.setSize(window.innerWidth, window.innerHeight);
    Game.renderer.shadowMap.enabled = settings.shadows;
    Game.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Filmic color pipeline: ACES tonemapping + sRGB output. Every color
    // texture is tagged sRGB in procgen.js, sky/water shaders opt in via
    // <tonemapping_fragment>/<encodings_fragment> includes, and the light
    // rig in lighting.js is tuned against this curve — change one, retune all.
    Game.renderer.outputEncoding = THREE.sRGBEncoding;
    Game.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    Game.renderer.toneMappingExposure = 1.12;
    Game.clock = new THREE.Clock();
    Game.raycaster = new THREE.Raycaster();

    Game.UI.setBootProgress(30, "raising the terrain…");
    Game.Terrain.init();
    Game.scene.add(Game.Terrain.mesh);
    // Cap zoom-out distance to roughly the fog draw distance on lower tiers
    // so players can't zoom past the fog into a flat haze.
    Game.Terrain.cam.maxDistance = Math.min(320, settings.fogFar * 0.9);
    Game.Terrain.initCamera(Game.camera);

    Game.UI.setBootProgress(42, "filling the lake…");
    Game.scene.add(Game.Water.init());

    Game.UI.setBootProgress(48, "planting forests…");
    Game.Trees.init(Game.scene);

    Game.UI.setBootProgress(52, "raising the sun…");
    Game.Lighting.init(Game.scene);

    Game.UI.setBootProgress(62, "paving roads…");
    Game.Roads.init(Game.scene);

    Game.UI.setBootProgress(70, "zoning the district…");
    Game.Zoning.init(Game.scene);

    Game.UI.setBootProgress(76, "growing buildings…");
    Game.Buildings.init(Game.scene);

    Game.UI.setBootProgress(84, "waking the citizens…");
    Game.Citizens.init(Game.scene);
    Game.Traffic.init(Game.scene);

    Game.UI.setBootProgress(90, "loading the forecast…");
    Game.Weather.init(Game.scene);
    Game.Economy.init();

    Game.UI.setBootProgress(95, "wiring the controls…");
    Game.Input.init(canvas);
    Game.UI.populateBuildingDrawer();

    QualityManager.onChange(onQualityChange);
    window.addEventListener("resize", onResize);

    Game.UI.setBootProgress(100, "ready");

    Game.Save.init().then(function () {
      setTimeout(async function () {
        Game.UI.hideBoot();
        await Game.UI.showModeSelect();
      }, 260);
    }).catch(function (err) {
      console.error("IndexedDB unavailable, saves disabled", err);
      setTimeout(async function () { Game.UI.hideBoot(); await Game.UI.showModeSelect(); }, 260);
    });

    setInterval(function () { if (Game.running) Game.Save.autosave(); }, 3 * 60 * 1000);

    requestAnimationFrame(loop);
  }

  function onQualityChange(settings) {
    Game.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, settings.pixelRatioCap));
    Game.renderer.shadowMap.enabled = settings.shadows;
    Game.Terrain.cam.maxDistance = Math.min(320, settings.fogFar * 0.9);
    Game.Terrain.cam.distance = Math.min(Game.Terrain.cam.distance, Game.Terrain.cam.maxDistance);
    Game.Terrain.setRenderResolution(settings.terrainSegments);
    Game.Lighting.onQualityChange(settings);
    Game.Roads.onQualityChange();
    Game.Citizens.onQualityChange(settings);
    Game.Traffic.onQualityChange(settings);
    Game.Weather.onQualityChange();
    Game.Trees.onQualityChange(settings);
    Game.UI.toast("Graphics: " + settings.name);
  }

  function onResize() {
    Game.camera.aspect = window.innerWidth / window.innerHeight;
    Game.camera.updateProjectionMatrix();
    Game.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  // ---------------- game flow ----------------
  Game.startNewGame = function (mode) {
    Game.mode = mode;
    Game.UI.hideModeSelect();
    Game.beginRunningState();
    Game.UI.toast(mode === "creative" ? "Creative mode — build freely" : "Normal mode — welcome, mayor");
  };

  Game.continueLatest = async function () {
    var slots = await Game.Save.listSlots();
    if (!slots.length) { Game.UI.toast("No saves found"); return; }
    Game.Save.applyCityData(slots[0].data);
    Game.UI.hideModeSelect();
    Game.beginRunningState();
    Game.UI.toast("Welcome back, mayor");
  };

  Game.beginRunningState = function () {
    Game.running = true;
    Game.paused = false;
    Game.UI.enterGameUI();
  };

  Game.returnToModeSelect = function () { location.reload(); };

  Game.loadCityData = function (data) {
    Game.mode = data.mode || "normal";
    Game.Terrain.applyLoadedHeights(data.terrain ? data.terrain.heights : null);
    Game.Roads.clearAll();
    Game.Roads._loadFromSave(data.roads || { nodes: [], edges: [] });
    Game.Zoning.clearAll();
    Game.Zoning._loadFromSave(data.zoning || []);
    Game.Buildings.clearAll();
    Game.Buildings._loadFromSave(data.buildings || { cells: [], services: [] });
    Game.Economy.loadSaveState(data.economy);
    Game.Lighting.loadSaveState(data.lighting);
    Game.Weather.loadSaveState(data.weather);
    Game.Terrain.loadCameraSaveState(data.camera);
    // trees are decorative + deterministic (fixed seed), so they aren't
    // serialized — re-scatter and re-carve clearings around the loaded city
    Game.Trees.rescatter();
    Game.Trees.reapplyClearances();
  };

  Game.captureThumbnail = function () {
    try {
      var src = Game.renderer.domElement;
      var w = 160, h = Math.round(160 * (src.height / src.width));
      var c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(src, 0, 0, w, h);
      return c.toDataURL("image/jpeg", 0.6);
    } catch (e) { return null; }
  };

  // ---------------- main loop ----------------
  var fpsFrames = 0, fpsTimer = 0, hudTimer = 0;

  function loop() {
    requestAnimationFrame(loop);
    var dt = Math.min(Game.clock.getDelta(), 0.1);

    Game.Input.update(dt);
    Game.Lighting.syncToCamera();

    if (Game.running && !Game.paused) {
      Game.Lighting.update(dt);
      Game.Weather.update(dt, Game.camera);
      Game.Water.update(dt, Game.camera);
      Game.Roads.update();
      Game.Roads.updateNightLights(Game.Lighting.nightFactor);
      Game.Buildings.update(dt);
      Game.Buildings.updateNightLights(Game.Lighting.nightFactor);
      Game.Citizens.update(dt);
      Game.Traffic.update(dt);
      Game.Economy.update(dt);
    } else if (Game.running) {
      // even paused, keep water/sky gently subtle-static (no update) but lights stay put
    }

    if (Game.running) {
      hudTimer += dt;
      if (hudTimer > 0.2) { hudTimer = 0; Game.UI.updateHud(); }
    }

    Game.renderer.render(Game.scene, Game.camera);

    fpsFrames++; fpsTimer += dt;
    if (fpsTimer >= 1) {
      var fps = fpsFrames / fpsTimer;
      QualityManager.reportFPS(fps, performance.now());
      Game.UI.updateFps(fps);
      fpsFrames = 0; fpsTimer = 0;
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

/* weather.js
 * Weather state machine (clear -> cloudy -> rain -> cloudy -> clear ...)
 * with smoothly-interpolated intensity driving three effects: GPU-instanced
 * rain streaks spawned in a camera-relative volume (so particle count never
 * depends on map size), a wet-road darkening pass applied to the existing
 * road meshes, and a cloud-cover dimming factor fed into lighting.js.
 */
(function (global) {
  "use strict";
  var util = Game.util;

  var Weather = {
    enabled: true,
    state: "clear",
    timer: 18,
    rainIntensity: 0,   // smoothed 0..1
    targetRain: 0,
    cloudFactor: 0,
    targetCloud: 0,

    init: function (scene) {
      this.group = new THREE.Group();
      this.group.name = "weather";
      scene.add(this.group);
      this._buildRain();
      this._buildClouds();
      return this;
    },

    setEnabled: function (b) {
      this.enabled = b;
      if (!b) { this.state = "clear"; this.targetRain = 0; this.targetCloud = 0; }
    },

    _buildRain: function () {
      var count = QualityManager.settings.rainCount;
      var geo = new THREE.PlaneGeometry(0.06, 0.9);
      this.rainMat = new THREE.MeshBasicMaterial({
        map: Procgen.rainStreakTexture(), transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide
      });
      this.rain = new THREE.InstancedMesh(geo, this.rainMat, count);
      this.rain.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.rainData = [];
      var radius = 70;
      for (var i = 0; i < count; i++) {
        var d = { x: (Math.random() - 0.5) * radius * 2, y: Math.random() * 50, z: (Math.random() - 0.5) * radius * 2, speed: 24 + Math.random() * 12 };
        this.rainData.push(d);
        this._placeRain(i, d);
      }
      this.group.add(this.rain);
    },

    _placeRain: function (i, d) {
      var m = new THREE.Matrix4();
      m.makeRotationX(Math.PI / 2.3);
      m.setPosition(d.x, d.y, d.z);
      this.rain.setMatrixAt(i, m);
    },

    _buildClouds: function () {
      this.cloudGroup = new THREE.Group();
      var tex = Procgen.cloudTexture();
      for (var i = 0; i < 14; i++) {
        var spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
        var a = Math.random() * Math.PI * 2, r = 60 + Math.random() * 160;
        spr.position.set(Math.cos(a) * r, 58 + Math.random() * 26, Math.sin(a) * r);
        var w = 55 + Math.random() * 50;
        spr.scale.set(w, w * 0.45, 1);
        spr.userData.speed = 1.2 + Math.random();
        // a few "ambient" clouds stay faintly visible even in clear weather
        spr.userData.ambient = i < 6;
        this.cloudGroup.add(spr);
      }
      this.group.add(this.cloudGroup);
    },

    onQualityChange: function () {
      this.group.remove(this.rain);
      this.rain.geometry.dispose();
      this._buildRain();
    },

    _stepStateMachine: function (dt) {
      this.timer -= dt * Game.timeScale;
      if (this.timer > 0) return;
      if (this.state === "clear") { this.state = "cloudy"; this.timer = 18 + Math.random() * 20; this.targetCloud = 0.6; }
      else if (this.state === "cloudy") {
        if (Math.random() < 0.55) { this.state = "rain"; this.timer = 30 + Math.random() * 60; this.targetRain = 1; this.targetCloud = 1; }
        else { this.state = "clear"; this.timer = 60 + Math.random() * 90; this.targetCloud = 0; this.targetRain = 0; }
      } else if (this.state === "rain") { this.state = "cloudy"; this.timer = 15 + Math.random() * 20; this.targetRain = 0; this.targetCloud = 0.5; }
    },

    update: function (dt, camera) {
      if (this.enabled) this._stepStateMachine(dt);
      else { this.targetRain = 0; this.targetCloud = 0; }

      this.rainIntensity = util.lerp(this.rainIntensity, this.targetRain, dt * 0.5);
      this.cloudFactor = util.lerp(this.cloudFactor, this.targetCloud, dt * 0.3);
      Game.Lighting.weatherDim = this.cloudFactor;

      this.rainMat.opacity = this.rainIntensity * 0.75;
      if (this.rainIntensity > 0.01) {
        var focus = Game.Terrain.cam.focus;
        for (var i = 0; i < this.rainData.length; i++) {
          var d = this.rainData[i];
          d.y -= d.speed * dt * Game.timeScale;
          if (d.y < -2) {
            d.y = 45 + Math.random() * 10;
            d.x = focus.x + (Math.random() - 0.5) * 140;
            d.z = focus.z + (Math.random() - 0.5) * 140;
          }
          this._placeRain(i, d);
        }
        this.rain.instanceMatrix.needsUpdate = true;
      }

      var dayGlow = 1 - Game.Lighting.nightFactor * 0.75; // clouds fade at night
      this.cloudGroup.children.forEach(function (c) {
        var base = c.userData.ambient ? 0.16 : 0;
        c.material.opacity = (base + Weather.cloudFactor * 0.5) * dayGlow;
        c.position.x += c.userData.speed * dt * Game.timeScale;
        if (c.position.x > 260) c.position.x = -260;
      });

      if (Game.Roads) Game.Roads._wetness = this.rainIntensity;
      if (Game.Water) Game.Water.setWet(this.rainIntensity);
    },

    getSaveState: function () { return { enabled: this.enabled, state: this.state, timer: this.timer, rainIntensity: this.rainIntensity, targetRain: this.targetRain, cloudFactor: this.cloudFactor, targetCloud: this.targetCloud }; },
    loadSaveState: function (s) {
      if (!s) return;
      this.enabled = s.enabled !== false;
      this.state = s.state || "clear";
      this.timer = s.timer != null ? s.timer : 18;
      this.rainIntensity = s.rainIntensity || 0;
      this.targetRain = s.targetRain || 0;
      this.cloudFactor = s.cloudFactor || 0;
      this.targetCloud = s.targetCloud || 0;
    }
  };

  Game.Weather = Weather;
})(window);

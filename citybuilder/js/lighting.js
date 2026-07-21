/* lighting.js
 * Owns the game clock (hours-of-day, day counter), the sun/moon directional
 * lights, procedural sky dome, stars, ambient/hemisphere/fog color grading,
 * and exposes `Lighting.nightFactor` (0=full day, 1=full night) which
 * buildings.js and roads.js read to decide when to switch on emissive
 * windows / street lamps — keeping "who turns on when" in one place.
 */
(function (global) {
  "use strict";
  var util = Game.util, CFG = Game.CONFIG;

  var skyVert = [
    "varying vec3 vDir;",
    "void main(){",
    "  vDir = normalize(position);",
    "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
    "}"
  ].join("\n");

  var skyFrag = [
    "uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform float uStars;",
    "varying vec3 vDir;",
    "void main(){",
    "  vec3 d = normalize(vDir);",
    "  float h = clamp(d.y*0.5+0.5, 0.0, 1.0);",
    "  vec3 col = mix(uHorizon, uTop, pow(h, 0.55));",
    "  float sunDot = max(dot(d, normalize(uSunDir)), 0.0);",
    "  col += vec3(1.0, 0.85, 0.55) * pow(sunDot, 250.0) * 1.4;",
    "  col += vec3(1.0, 0.75, 0.45) * pow(sunDot, 12.0) * 0.18;",
    "  gl_FragColor = vec4(col, 1.0);",
    "}"
  ].join("\n");

  var Lighting = {
    hours: 6.2,
    day: 1,
    dayLengthMinutes: 8,
    nightFactor: 0,
    weatherDim: 0, // 0..1, set by weather.js to darken during storms

    init: function (scene) {
      this.scene = scene;

      this.sun = new THREE.DirectionalLight(0xfff3d6, 1.1);
      this.sun.position.set(60, 90, 40);
      var q = QualityManager.settings;
      this.sun.castShadow = q.shadows;
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.camera.left = -140;
      this.sun.shadow.camera.right = 140;
      this.sun.shadow.camera.top = 140;
      this.sun.shadow.camera.bottom = -140;
      this.sun.shadow.camera.far = 320;
      this.sun.shadow.bias = -0.0015;
      scene.add(this.sun);
      scene.add(this.sun.target);

      this.moon = new THREE.DirectionalLight(0x9fb6ff, 0.0);
      scene.add(this.moon);
      scene.add(this.moon.target);

      this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x5f8a4a, 0.6);
      scene.add(this.hemi);

      this.ambient = new THREE.AmbientLight(0xffffff, 0.25);
      scene.add(this.ambient);

      // sky dome
      this.skyMat = new THREE.ShaderMaterial({
        vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color(0x2f7fd8) },
          uHorizon: { value: new THREE.Color(0xbfe3ff) },
          uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.3) },
          uStars: { value: 0 }
        }
      });
      this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 16), this.skyMat);
      scene.add(this.skyMesh);

      // stars
      var starCount = 900;
      var starGeo = new THREE.BufferGeometry();
      var starPos = new Float32Array(starCount * 3);
      for (var i = 0; i < starCount; i++) {
        var theta = Math.random() * Math.PI * 2;
        var phi = Math.acos(Math.random() * 0.85); // upper hemisphere-ish
        var r = 850;
        starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        starPos[i * 3 + 1] = r * Math.cos(phi) + 40;
        starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      }
      starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
      this.starMat = new THREE.PointsMaterial({
        size: 3.4, map: Procgen.starTexture(), transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false
      });
      this.stars = new THREE.Points(starGeo, this.starMat);
      scene.add(this.stars);

      // moon billboard
      this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: Procgen.glowSprite("rgba(210,222,255,1)", 128), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending
      }));
      this.moonSprite.scale.set(40, 40, 1);
      scene.add(this.moonSprite);

      // fog
      scene.fog = new THREE.Fog(0xbfe3ff, q.fogFar * 0.35, q.fogFar);
      this.fog = scene.fog;

      this._tmpColor1 = new THREE.Color();
      this._tmpColor2 = new THREE.Color();
      this._applyPhase();
      return this;
    },

    setDayLength: function (minutes) { this.dayLengthMinutes = util.clamp(minutes, 1, 60); },

    update: function (dt) {
      var hoursPerSecond = 24 / (this.dayLengthMinutes * 60);
      this.hours += dt * hoursPerSecond * Game.timeScale;
      if (this.hours >= 24) { this.hours -= 24; this.day++; }
      this._applyPhase();
      this.syncToCamera();
    },

    // The sky dome + starfield are re-centered on the camera every frame
    // (the classic skybox trick) — otherwise, as the camera roams away from
    // the world origin, the far side of a world-centered sphere can exceed
    // the camera's far clip plane and punch a hole in the sky.
    syncToCamera: function () {
      if (!Game.camera) return;
      this.skyMesh.position.copy(Game.camera.position);
      this.stars.position.copy(Game.camera.position);
    },

    _applyPhase: function () {
      var t = this.hours / 24;
      var sunAngle = t * Math.PI * 2 - Math.PI / 2;
      var elevation = Math.sin(sunAngle);
      var sunDir = new THREE.Vector3(Math.cos(sunAngle), elevation, 0.35).normalize();
      var moonDir = sunDir.clone().multiplyScalar(-1);

      var focus = Game.Terrain.cam.focus;
      this.sun.position.copy(focus).addScaledVector(sunDir, 220);
      this.sun.target.position.copy(focus);
      this.moon.position.copy(focus).addScaledVector(moonDir, 220);
      this.moon.target.position.copy(focus);
      this.moonSprite.position.copy(focus).addScaledVector(moonDir, 400);

      var dayFactor = util.smoothstep(-0.12, 0.2, elevation);
      var duskFactor = 1 - Math.min(1, Math.abs(elevation) / 0.28); // peaks near horizon
      duskFactor = util.clamp(duskFactor, 0, 1);
      this.nightFactor = 1 - dayFactor;

      var nightTop = new THREE.Color(0x050912), nightHorizon = new THREE.Color(0x0c1830);
      var dawnTop = new THREE.Color(0x35538f), dawnHorizon = new THREE.Color(0xff9d5c);
      var dayTop = new THREE.Color(0x2f7fd8), dayHorizon = new THREE.Color(0xbfe3ff);

      var top = this._tmpColor1, horizon = this._tmpColor2;
      if (elevation < 0) {
        top.copy(nightTop).lerp(dawnTop, duskFactor);
        horizon.copy(nightHorizon).lerp(dawnHorizon, duskFactor);
      } else {
        top.copy(dawnTop).lerp(dayTop, dayFactor).lerp(nightTop, 0); // day side
        top.copy(nightTop).lerp(dawnTop, duskFactor).lerp(dayTop, util.smoothstep(0.0, 0.32, elevation));
        horizon.copy(nightHorizon).lerp(dawnHorizon, duskFactor).lerp(dayHorizon, util.smoothstep(0.0, 0.32, elevation));
      }

      // dim everything a bit during storms
      var dim = 1 - this.weatherDim * 0.45;
      top.multiplyScalar(dim); horizon.multiplyScalar(dim);

      this.skyMat.uniforms.uTop.value.copy(top);
      this.skyMat.uniforms.uHorizon.value.copy(horizon);
      this.skyMat.uniforms.uSunDir.value.copy(sunDir);

      this.sun.intensity = Math.max(0, elevation) * 1.3 * dim;
      this.sun.color.setHSL(0.13, 0.55, util.lerp(0.55, 0.92, dayFactor));
      this.moon.intensity = (1 - dayFactor) * 0.28;
      this.moonSprite.material.opacity = util.clamp((1 - dayFactor) * 1.4, 0, 0.9);

      this.hemi.intensity = util.lerp(0.12, 0.65, dayFactor) * dim;
      this.hemi.color.copy(horizon);
      this.hemi.groundColor.set(0x4a3f33).lerp(new THREE.Color(0x5f8a4a), dayFactor);
      this.ambient.intensity = util.lerp(0.14, 0.28, dayFactor);

      this.starMat.opacity = util.clamp((1 - dayFactor) * 1.3 - 0.15, 0, 0.9);

      this.fog.color.copy(horizon);
      var q = QualityManager.settings;
      this.fog.far = q.fogFar * util.lerp(0.7, 1, dayFactor + 0.2);
      this.fog.near = this.fog.far * 0.35;

      if (Game.Water) Game.Water.setSkyColors(top, horizon, sunDir, this.sun.color, this.sun.intensity);
    },

    onQualityChange: function (settings) {
      this.sun.castShadow = settings.shadows;
      this.sun.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
      this.sun.shadow.map && this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
      this.fog.far = settings.fogFar;
      this.fog.near = settings.fogFar * 0.35;
    },

    getSaveState: function () { return { hours: this.hours, day: this.day, dayLengthMinutes: this.dayLengthMinutes }; },
    loadSaveState: function (s) {
      if (!s) return;
      this.hours = s.hours; this.day = s.day; this.dayLengthMinutes = s.dayLengthMinutes || 8;
      this._applyPhase();
    }
  };

  Game.Lighting = Lighting;
})(window);

/* lighting.js
 * Owns the game clock (hours-of-day, day counter), the sun/moon directional
 * lights, procedural sky dome, stars, ambient/hemisphere/fog color grading,
 * and exposes `Lighting.nightFactor` (0=full day, 1=full night) which
 * buildings.js and roads.js read to decide when to switch on emissive
 * windows / street lamps — keeping "who turns on when" in one place.
 *
 * The look is driven by a KEYFRAME TABLE rather than computed formulas:
 * each key pins a full palette (sky zenith/mid/horizon, sun color and
 * intensity, hemisphere/ambient levels) at a given hour, and _applyPhase
 * interpolates between the surrounding keys. That makes the golden hours,
 * blue dusk and deep night art-directable — tweak a hex, not an equation.
 * All authored hexes are sRGB and converted to linear on load because the
 * renderer runs a linear pipeline with sRGB output (see main.js).
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

  // Three-stop gradient + sun disc/corona + forward-scattered horizon glow
  // around a low sun + blue-noise dither to kill gradient banding. Ends with
  // the standard tonemapping/encoding chunks so the sky passes through the
  // same ACES + sRGB pipeline as the lit scene.
  var skyFrag = [
    "uniform vec3 uZenith; uniform vec3 uMid; uniform vec3 uHorizon;",
    "uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunI;",
    "uniform float uDusk;",
    "varying vec3 vDir;",
    "void main(){",
    "  vec3 d = normalize(vDir);",
    "  float h = clamp(d.y, -0.08, 1.0);",
    "  vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.28, h));",
    "  col = mix(col, uZenith, smoothstep(0.22, 0.75, h));",
    "  vec3 sd = normalize(uSunDir);",
    "  float sunDot = max(dot(d, sd), 0.0);",
    // forward-scattering: warm wedge hugging the horizon on the sun side
    "  float azimuth = max(dot(normalize(vec2(d.x, d.z)), normalize(vec2(sd.x, sd.z))), 0.0);",
    "  float lowBand = 1.0 - smoothstep(0.0, 0.38, h);",
    "  col += uSunColor * pow(azimuth, 3.0) * lowBand * uDusk * 0.55;",
    // sun disc + corona
    "  float disc = smoothstep(0.9994, 0.99975, sunDot);",
    "  col += uSunColor * disc * (2.2 * max(uSunI, 0.12));",
    "  col += uSunColor * pow(sunDot, 90.0) * 0.35 * max(uSunI, 0.1);",
    // dither to break gradient banding on mobile 8-bit targets
    "  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);",
    "  col += (n - 0.5) * 0.004;",
    "  gl_FragColor = vec4(col, 1.0);",
    "#include <tonemapping_fragment>",
    "#include <encodings_fragment>",
    "}"
  ].join("\n");

  function C(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }

  // hour, zenith, mid, horizon, sunColor, sunIntensity, hemi, ambient, dusk(sun-side horizon wedge)
  var KEYS = [
    { t: 0.0,  zen: C(0x040711), mid: C(0x0a1226), hor: C(0x14203c), sun: C(0x9fb6ff), sunI: 0.00, hemi: 0.14, amb: 0.16, dusk: 0.0 },
    { t: 4.6,  zen: C(0x050a16), mid: C(0x0e1730), hor: C(0x1b2a4a), sun: C(0xff9d5c), sunI: 0.00, hemi: 0.15, amb: 0.17, dusk: 0.15 },
    { t: 5.8,  zen: C(0x172a52), mid: C(0x4a4a7d), hor: C(0xd8814f), sun: C(0xffb36b), sunI: 0.28, hemi: 0.26, amb: 0.20, dusk: 1.0 },
    { t: 6.8,  zen: C(0x2b5aa3), mid: C(0x7d9fd4), hor: C(0xf7c988), sun: C(0xffd9a0), sunI: 0.85, hemi: 0.45, amb: 0.24, dusk: 0.75 },
    { t: 8.5,  zen: C(0x2a6ccc), mid: C(0x74a8e6), hor: C(0xd6e9f5), sun: C(0xfff0d4), sunI: 1.25, hemi: 0.62, amb: 0.27, dusk: 0.1 },
    { t: 13.0, zen: C(0x2260c2), mid: C(0x6ba4e8), hor: C(0xcde6f6), sun: C(0xfff8e8), sunI: 1.45, hemi: 0.68, amb: 0.28, dusk: 0.0 },
    { t: 16.8, zen: C(0x2b62b5), mid: C(0x7ba5da), hor: C(0xe8dfc2), sun: C(0xffe9b8), sunI: 1.15, hemi: 0.58, amb: 0.26, dusk: 0.25 },
    { t: 18.4, zen: C(0x2f3f74), mid: C(0xb0718a), hor: C(0xff9052), sun: C(0xffab5e), sunI: 0.55, hemi: 0.36, amb: 0.22, dusk: 1.0 },
    { t: 19.6, zen: C(0x141d40), mid: C(0x3d3a6e), hor: C(0xc45f56), sun: C(0xff8046), sunI: 0.10, hemi: 0.20, amb: 0.18, dusk: 0.8 },
    { t: 20.8, zen: C(0x070c1c), mid: C(0x101a38), hor: C(0x233054), sun: C(0x9fb6ff), sunI: 0.00, hemi: 0.15, amb: 0.16, dusk: 0.2 },
    { t: 24.0, zen: C(0x040711), mid: C(0x0a1226), hor: C(0x14203c), sun: C(0x9fb6ff), sunI: 0.00, hemi: 0.14, amb: 0.16, dusk: 0.0 }
  ];

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
          uZenith: { value: new THREE.Color(0x2f7fd8) },
          uMid: { value: new THREE.Color(0x6ba4e8) },
          uHorizon: { value: new THREE.Color(0xbfe3ff) },
          uSunDir: { value: new THREE.Vector3(0.3, 0.6, 0.3) },
          uSunColor: { value: new THREE.Color(0xfff2c0) },
          uSunI: { value: 1 },
          uDusk: { value: 0 }
        }
      });
      this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 20), this.skyMat);
      this.skyMesh.renderOrder = -1;
      scene.add(this.skyMesh);

      // stars — two layers (faint field + a few bright ones) for depth
      this.starLayers = [];
      var starSpecs = [
        { count: 700, size: 2.6, opacity: 0.7 },
        { count: 90, size: 4.6, opacity: 0.95 }
      ];
      for (var s = 0; s < starSpecs.length; s++) {
        var spec = starSpecs[s];
        var starGeo = new THREE.BufferGeometry();
        var starPos = new Float32Array(spec.count * 3);
        for (var i = 0; i < spec.count; i++) {
          var theta = Math.random() * Math.PI * 2;
          var phi = Math.acos(Math.random() * 0.88);
          var r = 850;
          starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
          starPos[i * 3 + 1] = r * Math.cos(phi) + 40;
          starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
        }
        starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
        var starMat = new THREE.PointsMaterial({
          size: spec.size, map: Procgen.starTexture(), transparent: true, opacity: 0,
          depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false
        });
        starMat.userData.maxOpacity = spec.opacity;
        var stars = new THREE.Points(starGeo, starMat);
        this.starLayers.push(stars);
        scene.add(stars);
      }
      this.stars = this.starLayers[0]; // legacy alias used by syncToCamera

      // moon billboard
      this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: Procgen.glowSprite("rgba(210,222,255,1)", 128), transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending
      }));
      this.moonSprite.scale.set(40, 40, 1);
      scene.add(this.moonSprite);

      // fog
      scene.fog = new THREE.Fog(0xbfe3ff, q.fogFar * 0.48, q.fogFar);
      this.fog = scene.fog;

      this._k = { zen: new THREE.Color(), mid: new THREE.Color(), hor: new THREE.Color(), sun: new THREE.Color() };
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
      for (var i = 0; i < this.starLayers.length; i++) this.starLayers[i].position.copy(Game.camera.position);
    },

    // Interpolate the keyframe table at the current hour.
    _sampleKeys: function (hour) {
      var i = 0;
      while (i < KEYS.length - 2 && KEYS[i + 1].t <= hour) i++;
      var a = KEYS[i], b = KEYS[i + 1];
      var t = util.clamp((hour - a.t) / (b.t - a.t || 1), 0, 1);
      t = t * t * (3 - 2 * t); // ease between keys
      var k = this._k;
      k.zen.copy(a.zen).lerp(b.zen, t);
      k.mid.copy(a.mid).lerp(b.mid, t);
      k.hor.copy(a.hor).lerp(b.hor, t);
      k.sun.copy(a.sun).lerp(b.sun, t);
      k.sunI = util.lerp(a.sunI, b.sunI, t);
      k.hemi = util.lerp(a.hemi, b.hemi, t);
      k.amb = util.lerp(a.amb, b.amb, t);
      k.dusk = util.lerp(a.dusk, b.dusk, t);
      return k;
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
      this.nightFactor = 1 - dayFactor;

      var k = this._sampleKeys(this.hours);
      var dim = 1 - this.weatherDim * 0.5;

      this.skyMat.uniforms.uZenith.value.copy(k.zen).multiplyScalar(dim);
      this.skyMat.uniforms.uMid.value.copy(k.mid).multiplyScalar(dim);
      this.skyMat.uniforms.uHorizon.value.copy(k.hor).multiplyScalar(dim);
      this.skyMat.uniforms.uSunDir.value.copy(sunDir);
      this.skyMat.uniforms.uSunColor.value.copy(k.sun);
      this.skyMat.uniforms.uSunI.value = k.sunI * dim;
      this.skyMat.uniforms.uDusk.value = k.dusk * dim;

      this.sun.color.copy(k.sun);
      this.sun.intensity = k.sunI * dim;
      this.moon.intensity = (1 - dayFactor) * 0.26;
      this.moonSprite.material.opacity = util.clamp((1 - dayFactor) * 1.4, 0, 0.85);

      this.hemi.intensity = k.hemi * dim;
      this.hemi.color.copy(k.mid);
      this.hemi.groundColor.copy(k.hor).multiplyScalar(0.45);
      this.ambient.intensity = k.amb;

      var starVis = util.clamp((1 - dayFactor) * 1.3 - 0.12, 0, 1);
      for (var i = 0; i < this.starLayers.length; i++) {
        var m = this.starLayers[i].material;
        m.opacity = starVis * m.userData.maxOpacity;
      }

      this.fog.color.copy(k.hor).multiplyScalar(dim);
      var q = QualityManager.settings;
      this.fog.far = q.fogFar * util.lerp(0.7, 1, dayFactor + 0.2);
      this.fog.near = this.fog.far * 0.48;

      if (Game.Water) Game.Water.setSkyColors(k.mid, k.hor, sunDir, k.sun, k.sunI * dim);
    },

    onQualityChange: function (settings) {
      this.sun.castShadow = settings.shadows;
      this.sun.shadow.mapSize.set(settings.shadowMapSize, settings.shadowMapSize);
      this.sun.shadow.map && this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
      this.fog.far = settings.fogFar;
      this.fog.near = settings.fogFar * 0.48;
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

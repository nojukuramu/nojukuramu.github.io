/* water.js
 * A single large water plane at CFG.WATER_LEVEL. The fragment shader gets a
 * downsampled copy of the terrain heightmap as a texture, so every pixel
 * knows the ground depth beneath it: shorelines get an animated foam line
 * and a turquoise shallow tint that fades to the deep color, all without
 * any per-shoreline geometry. Terraforming marks the height texture dirty
 * and it re-uploads at most twice a second.
 *
 * Reflection strategy: a fresnel blend between sky colors fed from the
 * lighting keyframes plus an analytic multi-wave normal (computed per-pixel
 * — no mesh-resolution faceting) with sun glint. One draw call; a true
 * planar-reflection pass remains the documented upgrade path for high tier.
 */
(function (global) {
  "use strict";
  var CFG = Game.CONFIG;

  var vertexShader = [
    "uniform float uTime;",
    "varying vec2 vUv;",
    "varying vec3 vWorldPos;",
    "void main(){",
    "  vUv = uv;",
    "  vec3 pos = position;",
    "  float w1 = sin(pos.x * 0.18 + uTime * 1.1) * 0.09;",
    "  float w2 = cos(pos.z * 0.22 - uTime * 0.9) * 0.07;",
    "  pos.y += w1 + w2;",
    "  vec4 world = modelMatrix * vec4(pos, 1.0);",
    "  vWorldPos = world.xyz;",
    "  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);",
    "}"
  ].join("\n");

  var fragmentShader = [
    "uniform vec3 uSkyTop;",
    "uniform vec3 uSkyHorizon;",
    "uniform vec3 uDeep;",
    "uniform vec3 uShallow;",
    "uniform vec3 uSunDir;",
    "uniform vec3 uSunColor;",
    "uniform float uTime;",
    "uniform float uOpacity;",
    "uniform vec3 uCamPos;",
    "uniform sampler2D uHeightMap;",
    "uniform float uWorldSize;",
    "uniform float uHeightMin;",
    "uniform float uHeightRange;",
    "uniform float uWaterLevel;",
    "varying vec2 vUv;",
    "varying vec3 vWorldPos;",
    // Analytic gradient of a sum of 4 sine wave trains at incommensurate
    // frequencies/directions/speeds — smooth, non-repeating, no dot pattern.
    "vec2 waveGradient(vec2 p, float t) {",
    "  vec2 g = vec2(0.0);",
    "  vec2 k1 = vec2(0.045, 0.091); g += k1 * 0.30 * cos(dot(p, k1) + t * 0.35);",
    "  vec2 k2 = vec2(-0.071, 0.033); g += k2 * 0.22 * cos(dot(p, k2) - t * 0.27);",
    "  vec2 k3 = vec2(0.113, -0.052); g += k3 * 0.14 * cos(dot(p, k3) + t * 0.51);",
    "  vec2 k4 = vec2(0.021, -0.064); g += k4 * 0.09 * cos(dot(p, k4) - t * 0.16);",
    "  return g;",
    "}",
    "void main(){",
    "  vec3 viewDir = normalize(uCamPos - vWorldPos);",
    "  vec2 grad = waveGradient(vWorldPos.xz, uTime);",
    "  vec3 normal = normalize(vec3(-grad.x, 1.0, -grad.y));",
    "  float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 3.0);",
    "  vec3 reflection = mix(uSkyHorizon, uSkyTop, fresnel);",
    "  vec3 base = mix(uDeep, reflection, clamp(fresnel + 0.15, 0.0, 1.0));",

    // ground depth from the heightmap → shallow tint + shore foam.
    // Outside the terrain bounds the heightmap clamps and would smear its
    // border row into wide foam bands, so fade to "deep ocean" past the edge.
    "  vec2 huvRaw = vWorldPos.xz / uWorldSize + 0.5;",
    "  vec2 huv = clamp(huvRaw, 0.0, 1.0);",
    "  float outside = max(max(-huvRaw.x, huvRaw.x - 1.0), max(-huvRaw.y, huvRaw.y - 1.0));",
    "  float inMap = 1.0 - smoothstep(0.0, 0.02, outside);",
    "  float groundH = texture2D(uHeightMap, huv).r * uHeightRange + uHeightMin;",
    "  float depth = mix(12.0, uWaterLevel - groundH, inMap);",
    "  float shallow = 1.0 - smoothstep(0.0, 2.4, depth);",
    "  base = mix(base, uShallow, shallow * 0.5);",
    "  float foamWobble = sin(vWorldPos.x * 1.9 + uTime * 1.7) * sin(vWorldPos.z * 1.6 - uTime * 1.3) * 0.16;",
    "  float foam = smoothstep(0.7, 0.06, depth + foamWobble) * inMap;",
    "  foam *= 0.5 + 0.5 * sin(uTime * 1.8 + vWorldPos.x * 0.7 + vWorldPos.z * 0.9);",
    "  base += vec3(0.85, 0.9, 0.92) * foam * 0.5;",

    "  vec3 reflected = reflect(-uSunDir, normal);",
    "  float spec = pow(max(dot(reflected, viewDir), 0.0), 60.0);",
    "  base += uSunColor * spec * 0.9;",
    "  float glint = pow(max(dot(reflected, viewDir), 0.0), 240.0);",
    "  base += vec3(1.0) * glint * 1.1 * (0.35 + fresnel);",

    "  float alpha = uOpacity * mix(1.0, 0.78, shallow);",
    "  gl_FragColor = vec4(base, alpha);",
    "#include <tonemapping_fragment>",
    "#include <encodings_fragment>",
    "}"
  ].join("\n");

  var Water = {
    mesh: null,
    material: null,
    time: 0,
    _heightsDirty: false,
    _lastHeightUpload: 0,

    init: function () {
      var geo = new THREE.PlaneGeometry(CFG.WORLD_SIZE * 1.4, CFG.WORLD_SIZE * 1.4, 48, 48);
      geo.rotateX(-Math.PI / 2);

      this._buildHeightTexture();

      function lin(hex) { return new THREE.Color(hex).convertSRGBToLinear(); }
      this.material = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        transparent: true,
        uniforms: {
          uTime: { value: 0 },
          uSkyTop: { value: lin(0x8fd8ff) },
          uSkyHorizon: { value: lin(0xbfe9ff) },
          uDeep: { value: lin(0x0d4257) },
          uShallow: { value: lin(0x3d9aa6) },
          uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
          uSunColor: { value: lin(0xfff2c0) },
          uOpacity: { value: 0.92 },
          uCamPos: { value: new THREE.Vector3() },
          uHeightMap: { value: this.heightTex },
          uWorldSize: { value: CFG.WORLD_SIZE },
          uHeightMin: { value: CFG.MIN_HEIGHT },
          uHeightRange: { value: CFG.MAX_HEIGHT - CFG.MIN_HEIGHT },
          uWaterLevel: { value: CFG.WATER_LEVEL }
        }
      });
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.position.y = CFG.WATER_LEVEL;
      this.mesh.renderOrder = 1;
      this.mesh.name = "water";
      return this.mesh;
    },

    // Terrain heights → luminance texture (8-bit is plenty: the shader only
    // needs coarse depth for shore blending, not exact elevation).
    _buildHeightTexture: function () {
      var n = Game.Terrain.segs + 1;
      this._heightData = new Uint8Array(n * n);
      this._fillHeightData();
      this.heightTex = new THREE.DataTexture(this._heightData, n, n, THREE.LuminanceFormat, THREE.UnsignedByteType);
      this.heightTex.minFilter = THREE.LinearFilter;
      this.heightTex.magFilter = THREE.LinearFilter;
      this.heightTex.wrapS = this.heightTex.wrapT = THREE.ClampToEdgeWrapping;
      this.heightTex.needsUpdate = true;
    },

    _fillHeightData: function () {
      var heights = Game.Terrain.heights;
      var range = CFG.MAX_HEIGHT - CFG.MIN_HEIGHT;
      for (var i = 0; i < heights.length; i++) {
        this._heightData[i] = Math.max(0, Math.min(255, Math.round((heights[i] - CFG.MIN_HEIGHT) / range * 255)));
      }
    },

    markHeightsDirty: function () { this._heightsDirty = true; },

    setSkyColors: function (top, horizon, sunDir, sunColor, sunIntensity) {
      this.material.uniforms.uSkyTop.value.copy(top);
      this.material.uniforms.uSkyHorizon.value.copy(horizon);
      this.material.uniforms.uSunDir.value.copy(sunDir);
      this.material.uniforms.uSunColor.value.copy(sunColor).multiplyScalar(Math.max(0.15, sunIntensity));
    },

    setWet: function (wetness) {
      // rain darkens + stills the water slightly (handled visually via deep color)
      this.material.uniforms.uDeep.value.lerp(new THREE.Color(0x05242f).convertSRGBToLinear(), wetness * 0.02);
    },

    update: function (dt, camera) {
      this.time += dt;
      this.material.uniforms.uTime.value = this.time;
      if (camera) this.material.uniforms.uCamPos.value.copy(camera.position);
      if (this._heightsDirty && this.time - this._lastHeightUpload > 0.5) {
        this._fillHeightData();
        this.heightTex.needsUpdate = true;
        this._heightsDirty = false;
        this._lastHeightUpload = this.time;
      }
    }
  };

  Game.Water = Water;
})(window);

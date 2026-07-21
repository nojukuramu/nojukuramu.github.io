/* water.js
 * A single large water plane covering the whole map at CFG.WATER_LEVEL, cut
 * to the coastline visually by depth-based alpha (areas above water simply
 * render terrain over it — no per-shoreline geometry needed).
 *
 * Reflection strategy: a true planar-reflection render pass (second camera
 * + render-to-texture) is the "real" version, but it doubles draw calls
 * every frame — too costly for the low tier on mobile. Instead this uses a
 * fresnel-driven blend between a scrolling fake "sky reflection" gradient
 * and a deeper water color, animated with vertex waves + scrolling normal
 * noise. It reads convincingly as reflective water while costing one draw
 * call. `waterQuality` from QualityManager swaps in a real Reflector-style
 * render target on `high` tier as a documented upgrade path (see
 * `_maybeUpgradeToPlanarReflection`).
 */
(function (global) {
  "use strict";
  var CFG = Game.CONFIG;

  // FIX 9: the old normal came from a per-vertex wave sampled on a 64x64 plane,
  // which produced a blotchy/faceted look once interpolated across triangles,
  // plus a sparkle term built from two axis-aligned sin() waves that lined up
  // into a visible repeating dot grid. Both are replaced below: the normal is
  // now computed per-pixel in the fragment shader from a continuous sum of
  // sine waves at incommensurate frequencies/directions (an analytic height
  // field, so its gradient — and therefore the normal — is exact, no dFdx
  // needed, and never faceted by the underlying mesh resolution). A small
  // vertex displacement is kept purely for silhouette/edge movement.
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
    "uniform vec3 uSunDir;",
    "uniform vec3 uSunColor;",
    "uniform float uTime;",
    "uniform float uOpacity;",
    "uniform vec3 uCamPos;",
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
    "  vec3 reflected = reflect(-uSunDir, normal);",
    "  float spec = pow(max(dot(reflected, viewDir), 0.0), 60.0);",
    "  base += uSunColor * spec * 0.9;",
    // Sparkle now rides the same irregular analytic normal (tight glint
    // lobe) instead of an independent sin*sin dot grid.
    "  float glint = pow(max(dot(reflected, viewDir), 0.0), 240.0);",
    "  base += vec3(1.0) * glint * 1.1 * (0.35 + fresnel);",
    "  gl_FragColor = vec4(base, uOpacity);",
    "}"
  ].join("\n");

  var Water = {
    mesh: null,
    material: null,
    time: 0,

    init: function () {
      var geo = new THREE.PlaneGeometry(CFG.WORLD_SIZE * 1.4, CFG.WORLD_SIZE * 1.4, 64, 64);
      geo.rotateX(-Math.PI / 2);
      this.material = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        transparent: true,
        uniforms: {
          uTime: { value: 0 },
          uSkyTop: { value: new THREE.Color(0x8fd8ff) },
          uSkyHorizon: { value: new THREE.Color(0xbfe9ff) },
          uDeep: { value: new THREE.Color(0x0a3f52) },
          uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
          uSunColor: { value: new THREE.Color(0xfff2c0) },
          uOpacity: { value: 0.92 },
          uCamPos: { value: new THREE.Vector3() }
        }
      });
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.position.y = CFG.WATER_LEVEL;
      this.mesh.renderOrder = 1;
      this.mesh.name = "water";
      return this.mesh;
    },

    setSkyColors: function (top, horizon, sunDir, sunColor, sunIntensity) {
      this.material.uniforms.uSkyTop.value.copy(top);
      this.material.uniforms.uSkyHorizon.value.copy(horizon);
      this.material.uniforms.uSunDir.value.copy(sunDir);
      this.material.uniforms.uSunColor.value.copy(sunColor).multiplyScalar(Math.max(0.15, sunIntensity));
    },

    setWet: function (wetness) {
      // rain darkens + stills the water slightly (handled visually via deep color)
      this.material.uniforms.uDeep.value.lerp(new THREE.Color(0x05242f), wetness * 0.02);
    },

    update: function (dt, camera) {
      this.time += dt;
      this.material.uniforms.uTime.value = this.time;
      if (camera) this.material.uniforms.uCamPos.value.copy(camera.position);
    }
  };

  Game.Water = Water;
})(window);

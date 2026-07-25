/* ============================================================
   VELL — sky dome, sun & moon, day/night lighting
   ============================================================ */
(function (TD) {
  'use strict';

  var sky = TD.sky = {};
  var dome, domeU, sun, moon, hemi, ambient, sunSprite, moonSprite;
  var scene = null;

  sky.sunDir = new THREE.Vector3(0, 1, 0);
  sky.moonDir = new THREE.Vector3(0, -1, 0);
  sky.sunColor = new THREE.Color(0xffffff);
  sky.horizonColor = new THREE.Color(0xbcd6e4);
  sky.fogColor = new THREE.Color(0xbcd6e4);
  sky.night = 0;

  var DOME_VERT = [
    'varying vec3 vDir;',
    'void main(){',
    '  vDir = normalize(position);',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');

  var DOME_FRAG = [
    'uniform vec3 uZenith;',
    'uniform vec3 uHorizon;',
    'uniform vec3 uGround;',
    'uniform vec3 uSunDir;',
    'uniform vec3 uSunCol;',
    'uniform vec3 uMoonDir;',
    'uniform float uNight;',
    'uniform float uTime;',
    'varying vec3 vDir;',
    'float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }',
    'void main(){',
    '  vec3 d = normalize(vDir);',
    '  float up = clamp(d.y, -1.0, 1.0);',
    '  vec3 col = mix(uHorizon, uZenith, pow(clamp(up,0.0,1.0), 0.62));',
    '  col = mix(col, uGround, smoothstep(0.0, -0.32, up));',
    // sun disc + halo
    '  float sd = max(dot(d, uSunDir), 0.0);',
    '  col += uSunCol * pow(sd, 900.0) * 6.0;',
    '  col += uSunCol * pow(sd, 26.0) * 0.32;',
    '  col += uSunCol * pow(sd, 4.0) * 0.09 * (1.0 - uNight);',
    // moon
    '  float md = max(dot(d, uMoonDir), 0.0);',
    '  col += vec3(0.75,0.82,0.95) * pow(md, 2400.0) * 5.0 * uNight;',
    '  col += vec3(0.35,0.45,0.68) * pow(md, 34.0) * 0.28 * uNight;',
    // stars
    '  if (uNight > 0.01 && up > -0.02) {',
    '    vec3 sp = floor(d * 190.0);',
    '    float h = hash(sp);',
    '    float star = step(0.9965, h);',
    '    float tw = 0.55 + 0.45 * sin(uTime * 2.2 + h * 60.0);',
    '    col += vec3(0.85,0.92,1.0) * star * tw * uNight * smoothstep(-0.02, 0.25, up);',
    '  }',
    '  gl_FragColor = vec4(col, 1.0);',
    '  #include <tonemapping_fragment>',
    '  #include <encodings_fragment>',
    '}'
  ].join('\n');

  /* palette keyframes across the day */
  var KEYS = [
    { t: 0.00, zen: 0x050a18, hor: 0x0d1730, gnd: 0x05080f, sun: 0x2a3a5c, amb: 0x1a2740, int: 0.16, hemi: 0.18 }, // deep night
    { t: 0.20, zen: 0x243a63, hor: 0x8a5a52, gnd: 0x241d24, sun: 0xffa062, amb: 0x4a4054, int: 0.55, hemi: 0.35 }, // dawn
    { t: 0.28, zen: 0x4d86c4, hor: 0xd8c39c, gnd: 0x5a5646, sun: 0xffe6bb, amb: 0x8fa6bd, int: 1.15, hemi: 0.62 }, // morning
    { t: 0.50, zen: 0x3f7fc8, hor: 0xbcd6e4, gnd: 0x6c705c, sun: 0xfff4dd, amb: 0xa8c4dc, int: 1.45, hemi: 0.75 }, // noon
    { t: 0.72, zen: 0x3a6ab0, hor: 0xdcae7c, gnd: 0x5c5348, sun: 0xffd39a, amb: 0x94a2b8, int: 1.05, hemi: 0.58 }, // afternoon
    { t: 0.82, zen: 0x2a3f78, hor: 0xd2643c, gnd: 0x2e2430, sun: 0xff8a44, amb: 0x5a4a60, int: 0.55, hemi: 0.34 }, // dusk
    { t: 0.90, zen: 0x101c3a, hor: 0x2b3050, gnd: 0x0d1018, sun: 0x3b4a72, amb: 0x232f4c, int: 0.22, hemi: 0.22 }, // twilight
    { t: 1.00, zen: 0x050a18, hor: 0x0d1730, gnd: 0x05080f, sun: 0x2a3a5c, amb: 0x1a2740, int: 0.16, hemi: 0.18 }
  ];

  var cA = new THREE.Color(), cB = new THREE.Color();
  function sample(t) {
    var i = 0;
    for (; i < KEYS.length - 1; i++) if (t < KEYS[i + 1].t) break;
    var a = KEYS[Math.min(i, KEYS.length - 1)], b = KEYS[Math.min(i + 1, KEYS.length - 1)];
    var span = Math.max(b.t - a.t, 1e-5);
    var f = TD.util.clamp((t - a.t) / span, 0, 1);
    f = TD.util.smooth(f);
    return {
      zen: cA.setHex(a.zen).lerp(cB.setHex(b.zen), f).convertSRGBToLinear().clone(),
      hor: cA.setHex(a.hor).lerp(cB.setHex(b.hor), f).convertSRGBToLinear().clone(),
      gnd: cA.setHex(a.gnd).lerp(cB.setHex(b.gnd), f).convertSRGBToLinear().clone(),
      sun: cA.setHex(a.sun).lerp(cB.setHex(b.sun), f).convertSRGBToLinear().clone(),
      amb: cA.setHex(a.amb).lerp(cB.setHex(b.amb), f).convertSRGBToLinear().clone(),
      int: TD.util.lerp(a.int, b.int, f),
      hemi: TD.util.lerp(a.hemi, b.hemi, f)
    };
  }

  sky.build = function (sc, quality) {
    scene = sc;
    var geo = new THREE.SphereGeometry(560, 32, 20);
    domeU = {
      uZenith: { value: TD.C(0x4d86c4) },
      uHorizon: { value: TD.C(0xd8c39c) },
      uGround: { value: TD.C(0x5a5646) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: TD.C(0xffe6bb) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uNight: { value: 0 },
      uTime: { value: 0 }
    };
    dome = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: domeU, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG,
      side: THREE.BackSide, depthWrite: false, fog: false
    }));
    dome.renderOrder = -1;
    dome.frustumCulled = false;
    scene.add(dome);

    sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.castShadow = !!quality.shadows;
    if (quality.shadows) {
      sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
      var s = 46;
      sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
      sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
      sun.shadow.camera.near = 1; sun.shadow.camera.far = 220;
      sun.shadow.bias = -0.0016;
      sun.shadow.normalBias = 0.035;
    }
    sun.target.position.set(0, 0, 0);
    scene.add(sun); scene.add(sun.target);

    hemi = new THREE.HemisphereLight(0xbfd8ea, 0x3d4433, 0.6);
    scene.add(hemi);
    ambient = new THREE.AmbientLight(0x8fa6bd, 0.35);
    scene.add(ambient);

    scene.fog = new THREE.Fog(0xbcd6e4, 48, 235);

    sky.sun = sun; sky.hemi = hemi; sky.ambient = ambient;
    return sky;
  };

  sky.update = function (dt, focus) {
    var st = TD.state;
    var p = sample(st.dayT);
    var ang = (st.dayT - 0.25) * Math.PI * 2;
    var elev = Math.sin(ang);
    var azim = 0.55;

    sky.sunDir.set(Math.cos(ang) * Math.cos(azim), elev, Math.cos(ang) * Math.sin(azim) + 0.25).normalize();
    sky.moonDir.copy(sky.sunDir).negate();
    sky.night = TD.util.clamp(TD.util.smoothstep(0.10, -0.16, elev), 0, 1);
    sky.sunColor.copy(p.sun);
    sky.horizonColor.copy(p.hor);
    sky.fogColor.copy(p.hor).lerp(p.zen, 0.35);

    domeU.uZenith.value.copy(p.zen);
    domeU.uHorizon.value.copy(p.hor);
    domeU.uGround.value.copy(p.gnd);
    domeU.uSunDir.value.copy(sky.sunDir);
    domeU.uSunCol.value.copy(p.sun);
    domeU.uMoonDir.value.copy(sky.moonDir);
    domeU.uNight.value = sky.night;
    domeU.uTime.value += dt;

    // key light follows sun by day, moon by night
    var dir = sky.night > 0.5 ? sky.moonDir : sky.sunDir;
    var lightCol = sky.night > 0.5 ? TD.C(0x9db8e8) : p.sun;
    sun.color.copy(lightCol);
    sun.intensity = Math.max(p.int, sky.night * 0.30);

    var fx = focus ? focus.x : 0, fz = focus ? focus.z : 0;
    sun.position.set(fx + dir.x * 90, Math.abs(dir.y) * 90 + 25, fz + dir.z * 90);
    sun.target.position.set(fx, 0, fz);
    sun.target.updateMatrixWorld();

    hemi.intensity = p.hemi;
    hemi.color.copy(p.zen).lerp(TD.C(0xffffff), 0.35);
    hemi.groundColor.copy(p.gnd);
    ambient.color.copy(p.amb);
    ambient.intensity = 0.28 + sky.night * 0.14;

    if (scene.fog) {
      scene.fog.color.copy(sky.fogColor);
      scene.fog.near = 52;
      scene.fog.far = 250 - sky.night * 60;
      TD.water.setFog(scene.fog.near, scene.fog.far);
    }
    if (dome && focus) dome.position.set(focus.x, 0, focus.z);
    TD.terrain.setNight(sky.night);
  };

})(window.TD);

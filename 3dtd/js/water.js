/* ============================================================
   VELL — water: depth-shaded, rippled, planar-reflective
   ============================================================ */
(function (TD) {
  'use strict';

  var water = TD.water = {};
  var mesh = null, uniforms = null;
  var rt = null, virtualCam = null, textureMatrix = null;
  var reflectionOn = false;

  var _reflectorPos = new THREE.Vector3(), _camPos = new THREE.Vector3();
  var _normal = new THREE.Vector3(), _view = new THREE.Vector3();
  var _target = new THREE.Vector3(), _lookAt = new THREE.Vector3();
  var _rot = new THREE.Matrix4();

  var VERT = [
    'uniform float uTime;',
    'attribute float aDepth;',
    'varying vec3 vWPos;',
    'varying float vDepth;',
    'varying vec4 vReflectUv;',
    'varying float vFogDepth;',
    'uniform mat4 textureMatrix;',
    'void main(){',
    '  vDepth = aDepth;',
    '  vec3 p = position;',
    '  float w = sin(p.x*0.55 + uTime*1.1) * cos(p.y*0.42 - uTime*0.85);',
    '  float w2 = sin((p.x+p.y)*0.22 - uTime*0.6);',
    '  p.z += (w*0.045 + w2*0.055) * clamp(aDepth*1.6, 0.15, 1.0);',
    '  vec4 world = modelMatrix * vec4(p,1.0);',
    '  vWPos = world.xyz;',
    '  vReflectUv = textureMatrix * vec4(p,1.0);',
    '  vec4 mvPosition = viewMatrix * world;',
    '  vFogDepth = -mvPosition.z;',
    '  gl_Position = projectionMatrix * mvPosition;',
    '}'
  ].join('\n');

  var FRAG = [
    'uniform sampler2D tRipple;',
    'uniform sampler2D tReflect;',
    'uniform float uTime;',
    'uniform vec3 uShallow;',
    'uniform vec3 uDeep;',
    'uniform vec3 uSkyCol;',
    'uniform vec3 uSunDir;',
    'uniform vec3 uSunCol;',
    'uniform float uReflect;',
    'uniform float uNight;',
    'uniform vec3 fogColor;',
    'uniform float fogNear;',
    'uniform float fogFar;',
    'varying vec3 vWPos;',
    'varying float vDepth;',
    'varying vec4 vReflectUv;',
    'varying float vFogDepth;',

    'void main(){',
    '  vec2 uv1 = vWPos.xz * 0.045 + vec2(uTime*0.014, uTime*0.010);',
    '  vec2 uv2 = vWPos.xz * 0.085 - vec2(uTime*0.021, uTime*0.017);',
    '  vec3 n1 = texture2D(tRipple, uv1).rgb * 2.0 - 1.0;',
    '  vec3 n2 = texture2D(tRipple, uv2).rgb * 2.0 - 1.0;',
    '  vec3 nrm = normalize(vec3(n1.x + n2.x, 4.0, n1.y + n2.y));',
    '  vec3 viewDir = normalize(cameraPosition - vWPos);',
    '  float fres = pow(1.0 - clamp(dot(viewDir, nrm), 0.0, 1.0), 3.0);',
    '  fres = clamp(0.06 + fres * 0.94, 0.0, 1.0);',

    '  float d = clamp(vDepth / 2.2, 0.0, 1.0);',
    '  vec3 body = mix(uShallow, uDeep, smoothstep(0.04, 0.75, d));',

    '  vec3 refl = uSkyCol;',
    '  if (uReflect > 0.5) {',
    '    vec2 ruv = vReflectUv.xy / max(vReflectUv.w, 0.0001);',
    '    ruv += nrm.xz * 0.028 * clamp(d + 0.25, 0.0, 1.0);',
    '    vec3 sampled = texture2D(tReflect, ruv).rgb;',
    '    refl = mix(uSkyCol, sampled, 0.86);',
    '  }',

    '  vec3 h = normalize(uSunDir + viewDir);',
    '  float spec = pow(max(dot(nrm, h), 0.0), 220.0) * 2.4;',
    '  float glint = pow(max(dot(nrm, h), 0.0), 26.0) * 0.18;',

    '  vec3 col = mix(body, refl, fres * 0.92);',
    '  col += uSunCol * (spec + glint);',

    // shoreline foam
    '  float foam = smoothstep(0.34, 0.02, vDepth);',
    '  float ripple = sin(vDepth*26.0 - uTime*2.2 + n1.x*3.0)*0.5+0.5;',
    '  col = mix(col, vec3(0.72,0.87,0.83), foam * (0.30 + ripple*0.35));',

    // bioluminescent motes under the surface at night
    '  float glow = smoothstep(0.70, 0.98, texture2D(tRipple, vWPos.xz * 0.031 + vec2(uTime*0.004, -uTime*0.003)).b);',
    '  glow *= 0.55 + 0.45 * sin(uTime * 1.3 + vWPos.x * 0.2 + vWPos.z * 0.17);',
    '  col += vec3(0.05,0.34,0.31) * glow * uNight * (1.0 - foam) * (0.4 + 0.6*smoothstep(1.2, 0.15, vDepth));',

    '  float alpha = mix(0.62, 0.96, smoothstep(0.0, 0.9, vDepth));',
    '  alpha = mix(alpha, 0.86, fres);',
    '  float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);',
    '  col = mix(col, fogColor, fogFactor);',
    '  gl_FragColor = vec4(col, alpha);',
    '  #include <tonemapping_fragment>',
    '  #include <encodings_fragment>',
    '}'
  ].join('\n');

  water.build = function (scene, renderer, quality) {
    var N = TD.GRID;
    var geo = new THREE.PlaneGeometry(TD.WORLD + 24, TD.WORLD + 24, N, N);
    var pos = geo.attributes.position;
    var depth = new Float32Array(pos.count);
    for (var v = 0; v < pos.count; v++) {
      // plane is XY here; it gets rotated on the mesh so local x->world x, local y->world -z
      var lx = pos.getX(v), ly = pos.getY(v);
      var wx = lx, wz = -ly;
      var h = TD.terrain.heightAt(
        TD.util.clamp(wx, -TD.HALF + 0.01, TD.HALF - 0.01),
        TD.util.clamp(wz, -TD.HALF + 0.01, TD.HALF - 0.01)
      );
      depth[v] = Math.max(0, TD.WATER_Y - h);
    }
    geo.setAttribute('aDepth', new THREE.BufferAttribute(depth, 1));

    var ripple = TD.tex.ripple();
    ripple.wrapS = ripple.wrapT = THREE.RepeatWrapping;

    reflectionOn = !!quality.reflection;
    if (reflectionOn) {
      var size = 512;
      rt = new THREE.WebGLRenderTarget(size, size, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        format: THREE.RGBFormat, encoding: renderer.outputEncoding
      });
      rt.texture.generateMipmaps = false;
      virtualCam = new THREE.PerspectiveCamera();
      textureMatrix = new THREE.Matrix4();
    }

    uniforms = {
      tRipple: { value: ripple },
      tReflect: { value: rt ? rt.texture : null },
      textureMatrix: { value: textureMatrix || new THREE.Matrix4() },
      uTime: { value: 0 },
      uShallow: { value: TD.C(0x2f7d78) },
      uDeep: { value: TD.C(0x08202f) },
      uSkyCol: { value: TD.C(0x8fb6d0) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: TD.C(0xffe9c4) },
      uReflect: { value: reflectionOn ? 1 : 0 },
      uNight: { value: 0 },
      fogColor: { value: TD.C(0x9fb8c4) },
      fogNear: { value: 40 },
      fogFar: { value: 260 }
    };

    var mat = new THREE.ShaderMaterial({
      uniforms: uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: THREE.FrontSide
    });

    mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = TD.WATER_Y;
    mesh.renderOrder = 2;
    mesh.name = 'water';
    scene.add(mesh);
    water.mesh = mesh;
    water.uniforms = uniforms;

    // muddy bed under the deep water so it never reads as a hole
    var bedGeo = new THREE.PlaneGeometry(TD.WORLD + 40, TD.WORLD + 40, 1, 1);
    bedGeo.rotateX(-Math.PI / 2);
    var bed = new THREE.Mesh(bedGeo, new THREE.MeshBasicMaterial({ color: TD.C(0x0a1a1f), fog: true }));
    bed.position.y = -8;
    scene.add(bed);
    return water;
  };

  water.update = function (dt, sky) {
    if (!uniforms) return;
    uniforms.uTime.value += dt;
    if (sky) {
      uniforms.uSunDir.value.copy(sky.sunDir);
      uniforms.uSunCol.value.copy(sky.sunColor);
      uniforms.uSkyCol.value.copy(sky.horizonColor);
      uniforms.uNight.value = sky.night;
      uniforms.fogColor.value.copy(sky.fogColor);
    }
  };

  water.setFog = function (near, far) {
    if (!uniforms) return;
    uniforms.fogNear.value = near; uniforms.fogFar.value = far;
  };

  /* planar reflection — mirror the camera across the water plane */
  water.renderReflection = function (renderer, scene, camera, hideList) {
    if (!reflectionOn || !mesh) return;
    mesh.updateMatrixWorld();
    camera.updateMatrixWorld();

    _reflectorPos.setFromMatrixPosition(mesh.matrixWorld);
    _camPos.setFromMatrixPosition(camera.matrixWorld);
    _rot.extractRotation(mesh.matrixWorld);
    _normal.set(0, 0, 1).applyMatrix4(_rot);
    _view.subVectors(_reflectorPos, _camPos);
    if (_view.dot(_normal) > 0) return; // camera below the surface
    _view.reflect(_normal).negate().add(_reflectorPos);

    _rot.extractRotation(camera.matrixWorld);
    _lookAt.set(0, 0, -1).applyMatrix4(_rot).add(_camPos);
    _target.subVectors(_reflectorPos, _lookAt);
    _target.reflect(_normal).negate().add(_reflectorPos);

    virtualCam.position.copy(_view);
    virtualCam.up.set(0, 1, 0).applyMatrix4(_rot).reflect(_normal);
    virtualCam.lookAt(_target);
    virtualCam.far = camera.far;
    virtualCam.near = camera.near;
    virtualCam.updateMatrixWorld();
    virtualCam.projectionMatrix.copy(camera.projectionMatrix);

    textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    textureMatrix.multiply(virtualCam.projectionMatrix);
    textureMatrix.multiply(virtualCam.matrixWorldInverse);
    textureMatrix.multiply(mesh.matrixWorld);
    uniforms.textureMatrix.value.copy(textureMatrix);

    var i;
    mesh.visible = false;
    if (hideList) for (i = 0; i < hideList.length; i++) if (hideList[i]) hideList[i].visible = false;

    var prevTarget = renderer.getRenderTarget();
    var prevShadow = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, virtualCam);
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.enabled = prevShadow;

    mesh.visible = true;
    if (hideList) for (i = 0; i < hideList.length; i++) if (hideList[i]) hideList[i].visible = true;
  };

})(window.TD);

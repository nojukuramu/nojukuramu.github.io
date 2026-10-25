/* sky.js — the sky: day, the long twilight, the night and its aurora.
 *
 * Day is three's Sky (vendor/jsm/objects/Sky.js): Preetham's analytic
 * daylight, the standard sky model, with the air of the Antarctic coast —
 * very little haze, a deep blue overhead. Its maths are ported here line
 * for line (skyColor), so the fog on the land is the sky's own colour at the
 * horizon and the ambient light is its colour overhead; nothing is matched
 * by eye.
 *
 * Preetham is a day model: it goes black a degree or two after sunset. The
 * polar twilight lasts for hours, so a second dome is laid over it: the
 * orange band toward the sun under the horizon, the pink belt and the
 * earth's blue shadow opposite, deepening to the night's blue-black; then
 * stars, and in the late journey the aurora — curtains of green going to
 * violet at their tops, drawn by sampling a moving band through a stack of
 * layers, which is what gives them their vertical rays. */

import * as THREE from "three";
import { Sky } from "../vendor/jsm/objects/Sky.js";
import { DEG } from "./sun.js";

export const AIR = { turbidity: 1.7, rayleigh: 1.25, mie: 0.0032, g: 0.8 };

/* ------------------------------------------------------------------ */
/* Preetham, in JS                                                    */

const TR = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MC = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const CUT = 1.6110731556870734;
const sunE = (zc) => 1000 * Math.max(0, 1 - Math.exp(-((CUT - Math.acos(Math.max(-1, Math.min(1, zc)))) / 1.5)));

/* Preetham's night floor is lifted by its own gamma (a dark sky comes out a
   tenth grey): under the horizon the day sky fades out, as drawn and here,
   and the twilight dome takes over. */
export const dayK = (sy) => Math.max(0, Math.min(1, (Math.asin(Math.max(-1, Math.min(1, sy))) * 180 / Math.PI + 4) / 6));

/** The sky's colour (before tone mapping) looking along `d`, with the sun at `s` (unit vectors). */
export function skyColor(d, s, out) {
  out = out || [0, 0, 0];
  const dk = dayK(s.y);
  const E = sunE(s.y);
  const fade = 1 - Math.max(0, Math.min(1, 1 - Math.exp(s.y / 450000)));
  const rc = AIR.rayleigh - (1 - fade);
  const bR = TR.map((v) => v * rc), mT = 0.434 * (0.2 * AIR.turbidity * 10e-18);
  const bM = MC.map((v) => v * mT * AIR.mie);
  const z = Math.acos(Math.max(0, d.y));
  const inv = 1 / (Math.cos(z) + 0.15 * Math.pow(93.885 - (z * 180) / Math.PI, -1.253));
  const sR = 8400 * inv, sM = 1250 * inv;
  const cosT = d.x * s.x + d.y * s.y + d.z * s.z;
  const rP = 0.05968310365946075 * (1 + Math.pow(cosT * 0.5 + 0.5, 2));
  const g2 = AIR.g * AIR.g, mP = 0.07957747154594767 * ((1 - g2) / Math.pow(1 - 2 * AIR.g * cosT + g2, 1.5));
  const mixK = Math.max(0, Math.min(1, Math.pow(1 - s.y, 5)));
  for (let c = 0; c < 3; c++) {
    const Fex = Math.exp(-(bR[c] * sR + bM[c] * sM));
    const ratio = (bR[c] * rP + bM[c] * mP) / (bR[c] + bM[c]);
    let Lin = Math.pow(E * ratio * (1 - Fex), 1.5);
    Lin *= 1 + (Math.pow(E * ratio * Fex, 0.5) - 1) * mixK;
    const L0 = 0.1 * Fex;
    const tex = (Lin + L0) * 0.04 + [0, 0.0003, 0.00075][c];
    out[c] = Math.pow(tex, 1 / (1.2 + 1.2 * fade)) * dk;
  }
  return out;
}

/* The twilight dome's colour, in JS too, for the same reason. */
export function twilightColor(d, s, k, out) {
  out = out || [0, 0, 0];
  const up = Math.max(d.y, 0), h = Math.pow(1 - up, 5);
  const dl = Math.hypot(d.x, d.z) || 1, sl = Math.hypot(s.x, s.z) || 1;
  const toward = Math.max(0, (d.x * s.x + d.z * s.z) / (dl * sl));
  const a = Math.pow(toward, 3) * h * 0.9, b = Math.pow(toward, 1.2) * h * 0.25;
  out[0] = k.tw * (1.0 * a + 0.9 * b + 0.12 * h * 0.35 + 0.02 * (1 - h) * 0.6) + k.night * (0.0015 + 0.006 * h);
  out[1] = k.tw * (0.42 * a + 0.5 * b + 0.2 * h * 0.35 + 0.04 * (1 - h) * 0.6) + k.night * (0.003 + 0.01 * h);
  out[2] = k.tw * (0.18 * a + 0.55 * b + 0.45 * h * 0.35 + 0.11 * (1 - h) * 0.6) + k.night * (0.008 + 0.02 * h);
  return out;
}

/* ------------------------------------------------------------------ */
/* The domes                                                          */

const DOME = {
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = ( modelMatrix * vec4( position, 0.0 ) ).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      gl_Position.z = gl_Position.w;
    }`,
  fragmentShader: `
    uniform vec3 sunDir;
    uniform float tw, night, aurora, time;
    varying vec3 vDir;
    float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
    float vnoise( vec2 p ) {
      vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
      return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), f.x ), mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), f.x ), f.y );
    }
    void main() {
      vec3 d = normalize( vDir );
      float up = max( d.y, 0.0 ), h = pow( 1.0 - up, 5.0 );
      vec2 dx = normalize( d.xz + 1e-5 ), sx = normalize( sunDir.xz + 1e-5 );
      float toward = max( dot( dx, sx ), 0.0 ), away = max( - dot( dx, sx ), 0.0 );
      vec3 col = tw * ( vec3( 1.0, 0.42, 0.18 ) * pow( toward, 3.0 ) * h * 0.9 + vec3( 0.9, 0.5, 0.55 ) * pow( toward, 1.2 ) * h * 0.25
        + vec3( 0.12, 0.2, 0.45 ) * h * 0.35 + vec3( 0.02, 0.04, 0.11 ) * ( 1.0 - h ) * 0.6 );
      // the belt of Venus: pink over the earth's blue shadow, opposite the sun
      col += tw * away * vec3( 0.55, 0.3, 0.42 ) * smoothstep( 0.03, 0.09, d.y ) * smoothstep( 0.24, 0.1, d.y ) * 0.3;
      col += night * ( vec3( 0.0015, 0.003, 0.008 ) + vec3( 0.006, 0.01, 0.02 ) * h );
      // the aurora: a wavering band, sampled through a stack of layers so it
      // hangs in curtains; green below, violet above
      if ( aurora > 0.001 && d.y > 0.015 ) {
        vec3 ac = vec3( 0.0 );
        for ( int i = 0; i < 14; i ++ ) {
          float fi = float( i ) / 14.0;
          vec2 p = d.xz / ( d.y + 0.04 ) * ( 0.55 + fi * 0.35 );
          float band = p.y + 0.55 * sin( p.x * 0.6 + time * 0.03 ) + 0.25 * sin( p.x * 1.7 - time * 0.05 + 1.0 ) - 0.9;
          float curtain = exp( - band * band * 7.0 );
          float rays = vnoise( vec2( p.x * 9.0 + time * 0.12 + band * 2.0, fi * 3.0 ) );
          curtain *= 0.25 + rays * rays * 1.6;
          vec3 c = mix( vec3( 0.12, 1.0, 0.42 ), vec3( 0.55, 0.18, 0.85 ), smoothstep( 0.35, 1.0, fi ) );
          ac += c * curtain * ( 1.0 - fi * 0.7 );
        }
        col += aurora * ac * 0.05 * smoothstep( 0.015, 0.15, d.y );
      }
      gl_FragColor = vec4( col, 1.0 );
    }`
};

/**
 * The sky, for a scene: the Preetham box, the twilight/aurora dome and the
 * stars. Returns { group, update(sun, k, time), env(): a scene of just the sky }.
 */
export function makeSky() {
  const group = new THREE.Group();
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const u = sky.material.uniforms;
  u.dayK = { value: 1 };
  sky.material.fragmentShader = "uniform float dayK;\n" + sky.material.fragmentShader.replace("gl_FragColor = vec4( retColor, 1.0 );", "gl_FragColor = vec4( retColor * dayK, 1.0 );");
  u.turbidity.value = AIR.turbidity; u.rayleigh.value = AIR.rayleigh; u.mieCoefficient.value = AIR.mie; u.mieDirectionalG.value = AIR.g;
  group.add(sky);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), new THREE.ShaderMaterial({
    uniforms: { sunDir: { value: new THREE.Vector3(0, 1, 0) }, tw: { value: 0 }, night: { value: 0 }, aurora: { value: 0 }, time: { value: 0 } },
    vertexShader: DOME.vertexShader, fragmentShader: DOME.fragmentShader,
    side: THREE.BackSide, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending
  }));
  dome.renderOrder = -9;
  sky.renderOrder = -10;
  group.add(dome);
  // stars: the southern sky's worth, at random, a few bright
  const n = 2600, pos = new Float32Array(n * 3), mag = new Float32Array(n);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const zz = rnd() * 1.1 - 0.1, a = rnd() * Math.PI * 2, rr = Math.sqrt(1 - zz * zz);
    pos[i * 3] = Math.cos(a) * rr * 8500; pos[i * 3 + 1] = zz * 8500; pos[i * 3 + 2] = Math.sin(a) * rr * 8500;
    mag[i] = Math.pow(rnd(), 6);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  sg.setAttribute("aMag", new THREE.BufferAttribute(mag, 1));
  const stars = new THREE.Points(sg, new THREE.ShaderMaterial({
    uniforms: { vis: { value: 0 }, time: { value: 0 }, px: { value: 1 } },
    vertexShader: `attribute float aMag; uniform float time, px; varying float vA;
      void main() { vec4 mv = modelViewMatrix * vec4( position, 1.0 ); gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.w * 0.99999;
        float tw = 0.75 + 0.25 * sin( time * ( 2.0 + aMag * 9.0 ) + position.x );
        vA = ( 0.25 + aMag * 0.9 ) * tw; gl_PointSize = ( 1.0 + aMag * 2.6 ) * px; }`,
    fragmentShader: `uniform float vis; varying float vA;
      void main() { vec2 c = gl_PointCoord - 0.5; float a = smoothstep( 0.5, 0.0, length( c ) ); gl_FragColor = vec4( vec3( 0.85, 0.9, 1.0 ) * vA * vis * a, 1.0 ); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  }));
  stars.renderOrder = -8;
  stars.frustumCulled = false;
  group.add(stars);
  // a scene of just the day sky and the dome, for the light it throws on
  // the snow (render.js turns it into the environment)
  const envScene = new THREE.Scene();
  const sky2 = new Sky(); sky2.material = sky.material; sky2.scale.setScalar(100);
  const dome2 = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), dome.material);
  envScene.add(sky2, dome2);

  return {
    group, sky, dome, stars, envScene,
    update(sun, k, time, camPos, pxRatio) {
      u.sunPosition.value.set(sun.x, sun.y, sun.z);
      u.dayK.value = dayK(sun.y);
      const du = dome.material.uniforms;
      du.sunDir.value.set(sun.x, sun.y, sun.z);
      du.tw.value = k.tw; du.night.value = k.night; du.aurora.value = k.aurora; du.time.value = time;
      stars.material.uniforms.vis.value = k.stars; stars.material.uniforms.time.value = time; stars.material.uniforms.px.value = pxRatio || 1;
      group.position.copy(camPos);
    }
  };
}

/** How much twilight, night and stars there are for a sun elevation (radians). */
export function skyMix(el) {
  const d = el / DEG;
  // twilight is strongest a few degrees under the horizon, gone by -14
  const tw = d > 4 ? 0 : d > -3 ? (4 - d) / 7 : d > -14 ? 1 - (-3 - d) / 11 : 0;
  const night = d > -2 ? 0 : d < -12 ? 1 : (-2 - d) / 10;
  const stars = d > -4 ? 0 : d < -12 ? 1 : (-4 - d) / 8;
  return { tw, night, stars, aurora: 0 };
}

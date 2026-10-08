/* models.js — every contraption as a small low-poly model, built from
 * primitives at load time. There are no model files: a type is a function
 * that assembles a THREE.Group one tile wide per size unit, standing on y = 0,
 * facing +x (east) — the renderer turns it to the copy's rotation.
 *
 * Materials follow the Level's Material (Wood, Copper, Iron, Silver, Gold,
 * Crystal, Starmetal, Voidglass): wood is matte, metals shine, the last
 * three glow a little. "glow" parts use unlit, tone-map-free colours above 1
 * so the bloom pass picks them up — that is what makes the factory shine at
 * night. Named parts ("spin", "swing", "flame", "pulse", "aim") are animated
 * by the renderer. */

import * as THREE from "three";
import { MATERIALS } from "./data.js";

const geoCache = new Map();
const G = (key, make) => { let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g; };
const box = (w, h, d) => G("b" + w + h + d, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, s) => G("c" + rt + rb + h + (s || 16), () => new THREE.CylinderGeometry(rt, rb, h, s || 16));
const sph = (r, w, h) => G("s" + r + (w || 16), () => new THREE.SphereGeometry(r, w || 16, h || 12));
const cone = (r, h, s) => G("k" + r + h + (s || 12), () => new THREE.ConeGeometry(r, h, s || 12));
const tor = (r, t, rs, ts) => G("t" + r + t + (rs || 8) + (ts || 24), () => new THREE.TorusGeometry(r, t, rs || 8, ts || 24));
const ico = (r, d) => G("i" + r + (d || 0), () => new THREE.IcosahedronGeometry(r, d || 0));
const oct = (r) => G("o" + r, () => new THREE.OctahedronGeometry(r, 0));

const matCache = new Map();
function std(col, metal, rough, emissive, ei) {
  const key = [col, metal, rough, emissive, ei].join(":");
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: col, metalness: metal || 0, roughness: rough == null ? 0.7 : rough, flatShading: true });
    if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = ei || 1; }
    matCache.set(key, m);
  }
  return m;
}
/** An unlit colour pushed past 1, for the bloom pass. */
export function glowMat(col, k) {
  const key = "glow:" + col + ":" + (k || 2.2);
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k || 2.2), toneMapped: false }); matCache.set(key, m); }
  return m;
}
const glassMat = () => { let m = matCache.get("glass"); if (!m) { m = new THREE.MeshStandardMaterial({ color: 0xcfefff, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.45 }); matCache.set("glass", m); } return m; };
export function metal(i) {
  const M = MATERIALS[i] || MATERIALS[0];
  switch (i) {
    case 0: return std(M.col, 0, 0.85);
    case 1: return std(M.col, 0.75, 0.35);
    case 2: return std(M.col, 0.7, 0.45);
    case 3: return std(M.col, 0.9, 0.22);
    case 4: return std(M.col, 1, 0.25);
    case 5: return std(M.col, 0.2, 0.1, "#3a8aa0", 0.4);
    case 6: return std(M.col, 0.8, 0.3, "#3a2a80", 0.5);
    default: return std(M.col, 0.6, 0.2, "#801060", 0.6);
  }
}
const trim = (i) => std((MATERIALS[i] || MATERIALS[0]).hi, i ? 0.8 : 0, i ? 0.3 : 0.8);
const stone = () => std("#8a8478", 0, 0.95);
const dark = () => std("#2a2420", 0, 0.9);
const water = () => glowMat("#4ea8ff", 1.1);

function mesh(geo, mat, x, y, z, name) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x || 0, y || 0, z || 0);
  m.castShadow = true; m.receiveShadow = true;
  if (name) m.name = name;
  return m;
}
const add = (g, ...ms) => { for (const m of ms) g.add(m); return g; };

/** A model for a type at a Material, `n` tiles wide, centred on (0, 0). */
export function build(type, mi, n) {
  const g = new THREE.Group();
  const M = metal(mi), Tm = trim(mi);
  const s = n;   // footprint
  const base = (h, w) => mesh(box((w || s) * 0.88, h, (w || s) * 0.88), M, 0, h / 2);
  switch (type) {
    case "wellspring": {
      add(g, mesh(cyl(0.4, 0.44, 0.26, 18), M, 0, 0.13), mesh(cyl(0.32, 0.32, 0.04, 18), water(), 0, 0.27), mesh(sph(0.09), glowMat("#dff4ff", 2.6), 0, 0.42, 0, "pulse"));
      break;
    }
    case "extractor": {
      add(g, base(0.32), mesh(cyl(0.28, 0.36, 0.7, 8), Tm, 0, 0.67), mesh(box(0.9, 0.08, 0.12), M, 0, 1.05));
      const head = mesh(cone(0.22, 0.5, 8), dark(), 0, 0.3); head.rotation.x = Math.PI; head.name = "spin";
      add(g, head, mesh(tor(0.55, 0.05, 6, 24), glowMat("#ffffff", 1.6), 0, 0.34, 0, "nodeRing"));
      g.getObjectByName("nodeRing").rotation.x = Math.PI / 2;
      break;
    }
    case "sundish": case "moonwell": {
      const sun = type === "sundish";
      add(g, base(0.3), mesh(cyl(0.12, 0.18, 0.5, 8), Tm, 0, 0.55));
      const dish = mesh(sph(0.62, 18, 8), M, 0, 0.9); dish.scale.set(1, 0.32, 1); dish.name = "aim";
      add(g, dish, mesh(sph(0.22), glowMat(sun ? "#ffd23f" : "#6ab8ff", 2.4), 0, 1.05, 0, "pulse"));
      if (!sun) add(g, mesh(cyl(0.5, 0.5, 0.05, 18), water(), 0, 0.34));
      break;
    }
    case "stormrod": add(g, mesh(cyl(0.16, 0.22, 0.2, 8), M, 0, 0.1), mesh(cyl(0.04, 0.05, 1.4, 6), Tm, 0, 0.8), mesh(oct(0.11), glowMat("#ffe86a", 2.6), 0, 1.55, 0, "pulse")); break;
    case "splitter": {
      add(g, mesh(box(0.8, 0.18, 0.8), M, 0, 0.09));
      for (const [x, z, r] of [[0.26, 0, 0], [0, 0.26, Math.PI / 2], [0, -0.26, -Math.PI / 2]]) { const a = mesh(box(0.34, 0.08, 0.12), Tm, x, 0.22, z); a.rotation.y = -r; g.add(a); }
      break;
    }
    case "launcher": case "cometlauncher": {
      add(g, mesh(cyl(0.38, 0.42, 0.22, 12), M, 0, 0.11), mesh(sph(0.24, 12, 8), dark(), 0, 0.32));
      const barrel = mesh(cyl(0.1, 0.13, 0.6, 10), type === "cometlauncher" ? glowMat("#7ae8ff", 1.8) : Tm, 0.25, 0.48); barrel.rotation.z = -Math.PI / 3; barrel.name = "aim";
      g.add(barrel);
      break;
    }
    case "warppipe": {
      const ring = mesh(tor(0.32, 0.09, 8, 20), M, 0, 0.42); ring.rotation.y = Math.PI / 2;
      const core = mesh(cyl(0.28, 0.28, 0.04, 20), glowMat("#b26bff", 2.2), 0, 0.42, 0, "pulse"); core.rotation.z = Math.PI / 2;
      add(g, mesh(box(0.7, 0.1, 0.7), M, 0, 0.05), ring, core);
      break;
    }
    case "polisher": add(g, mesh(box(0.72, 0.36, 0.72), M, 0, 0.18), mesh(cyl(0.26, 0.26, 0.06, 16), Tm, 0, 0.4, 0, "spin"), mesh(cyl(0.08, 0.08, 0.08, 8), glowMat("#ffffff", 1.4), 0, 0.45)); break;
    case "kiln": case "nebulakiln": {
      const neb = type === "nebulakiln";
      const r = s * 0.42;
      const dome = mesh(sph(r, 16, 10), M, 0, 0.2); dome.scale.set(1, 0.85, 1);
      const mouth = mesh(box(0.08, r * 0.6, r * 0.8), glowMat(neb ? "#c88aff" : "#ff7a2a", 2.4), r * 0.92, r * 0.42, 0, "flame");
      add(g, mesh(cyl(r * 1.05, r * 1.1, 0.2, 16), stone(), 0, 0.1), dome, mouth, mesh(cyl(0.1, 0.12, 0.6, 8), Tm, -r * 0.4, r * 1.1, -r * 0.4));
      break;
    }
    case "charger": {
      add(g, mesh(box(0.7, 0.3, 0.7), M, 0, 0.15), mesh(cyl(0.06, 0.06, 0.4, 6), Tm, 0.2, 0.5, 0.2), mesh(cyl(0.06, 0.06, 0.4, 6), Tm, -0.2, 0.5, -0.2));
      const bolt = mesh(oct(0.16), glowMat("#ffe86a", 2.6), 0, 0.55, 0, "pulse"); bolt.scale.set(0.6, 1.4, 0.6); g.add(bolt);
      break;
    }
    case "mirror": {
      const pane = mesh(box(0.06, 0.55, 0.6), std("#e8f4ff", 1, 0.04), 0, 0.55); pane.name = "spin";
      add(g, mesh(box(0.7, 0.24, 0.7), M, 0, 0.12), pane);
      break;
    }
    case "prism": {
      const p = mesh(cyl(0.3, 0.3, 0.42, 3), glassMat(), 0, 0.46); p.rotation.y = Math.PI / 6; p.name = "spin";
      add(g, mesh(box(0.7, 0.22, 0.7), M, 0, 0.11), p, mesh(sph(0.07), glowMat("#ffffff", 2.4), 0, 0.46, 0, "pulse"));
      break;
    }
    case "engraver": {
      const arm = mesh(box(0.5, 0.06, 0.08), Tm, 0.05, 0.62); arm.name = "swing";
      add(g, mesh(box(0.7, 0.3, 0.7), M, 0, 0.15), mesh(cyl(0.06, 0.06, 0.35, 6), Tm, -0.2, 0.48), arm, mesh(cone(0.05, 0.14, 6), glowMat("#ffb03a", 2), 0.28, 0.52));
      break;
    }
    case "hourglass": {
      const top = mesh(cone(0.22, 0.32, 10), glassMat(), 0, 0.72); top.rotation.x = Math.PI;
      add(g, mesh(box(0.66, 0.08, 0.66), M, 0, 0.04), mesh(box(0.66, 0.06, 0.66), M, 0, 0.94), top, mesh(cone(0.22, 0.32, 10), glassMat(), 0, 0.26), mesh(cone(0.14, 0.18, 10), glowMat("#ffd27a", 1.6), 0, 0.18, 0, "pulse"));
      for (const [x, z] of [[0.28, 0.28], [-0.28, 0.28], [0.28, -0.28], [-0.28, -0.28]]) g.add(mesh(cyl(0.03, 0.03, 0.9, 6), Tm, x, 0.49, z));
      break;
    }
    case "gardenpress": {
      const roll = mesh(cyl(0.22, 0.22, 1.3, 14), Tm, 0, 0.6); roll.rotation.x = Math.PI / 2; roll.name = "spinX";
      add(g, base(0.36), roll, mesh(cyl(0.6, 0.6, 0.06, 6), glowMat("#5fe08a", 1.3), 0, 0.38));
      break;
    }
    case "waterwheel": {
      const w = new THREE.Group(); w.name = "spinZ"; w.position.y = 0.45;
      w.add(mesh(tor(0.38, 0.04, 6, 20), M));
      for (let i = 0; i < 8; i++) { const p = mesh(box(0.08, 0.36, 0.3), Tm); const a = i * Math.PI / 4; p.position.set(Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0); p.rotation.z = a; w.add(p); }
      w.rotation.y = Math.PI / 2;
      const holder = new THREE.Group(); holder.add(w); holder.rotation.y = Math.PI / 2;
      add(g, holder, mesh(box(0.1, 0.5, 0.1), M, 0, 0.25, 0.42), mesh(box(0.1, 0.5, 0.1), M, 0, 0.25, -0.42));
      break;
    }
    case "fuser": {
      add(g, base(0.28));
      for (const [x, z] of [[0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) g.add(mesh(cyl(0.1, 0.14, 0.7, 8), Tm, x, 0.6, z));
      add(g, mesh(ico(0.3, 1), glowMat("#ffffff", 2.2), 0, 0.85, 0, "pulse"), mesh(tor(0.48, 0.04, 6, 28), M, 0, 0.85, 0, "spin"));
      g.getObjectByName("spin").rotation.x = Math.PI / 2;
      break;
    }
    case "lantern": add(g, mesh(cyl(0.05, 0.07, 0.8, 6), M, 0, 0.4), mesh(box(0.28, 0.32, 0.28), glowMat("#ffd98a", 2.4), 0, 0.9, 0, "light"), mesh(cone(0.24, 0.16, 4), Tm, 0, 1.13)); g.getObjectByName("light").userData.light = true; break;
    case "chime": case "echobell": {
      const echo = type === "echobell";
      add(g, mesh(cyl(0.04, 0.04, 0.9, 6), M, 0, 0.45, 0.32), mesh(cyl(0.04, 0.04, 0.9, 6), M, 0, 0.45, -0.32), mesh(box(0.08, 0.06, 0.74), M, 0, 0.9));
      const bell = new THREE.Group(); bell.name = "swing"; bell.position.y = 0.88;
      const b = mesh(cyl(0.12, 0.26, 0.32, 14), echo ? std("#e0c8ff", 0.6, 0.2, "#6040a0", 0.5) : Tm, 0, -0.2); bell.add(b, mesh(sph(0.06), glowMat("#fff0b0", 2), 0, -0.38, 0, "pulse"));
      g.add(bell);
      break;
    }
    case "sprinkler": add(g, mesh(cyl(0.12, 0.16, 0.5, 8), M, 0, 0.25), mesh(cyl(0.3, 0.3, 0.05, 10), Tm, 0, 0.52, 0, "spin"), mesh(sph(0.08), glowMat("#8ad0ff", 2), 0, 0.6)); break;
    case "hearth": case "singularity": {
      const r = s * 0.44;
      add(g, mesh(cyl(r, r * 1.08, 0.5, 8), stone(), 0, 0.25), mesh(cyl(r * 0.78, r * 0.78, 0.04, 16), dark(), 0, 0.51), mesh(tor(r * 0.92, 0.07, 6, 8), M, 0, 0.52));
      const flame = new THREE.Group(); flame.name = "flame"; flame.position.y = 0.5;
      flame.add(mesh(cone(0.32 * s / 2, 0.9, 8), glowMat("#ff7a2a", 2.2)), mesh(cone(0.18 * s / 2, 0.6, 8), glowMat("#ffe08a", 2.8), 0, -0.1));
      for (const m of flame.children) { m.castShadow = false; m.position.y += 0.45; }
      g.add(flame);
      if (type === "singularity") add(g, mesh(tor(r * 1.2, 0.05, 6, 32), glowMat("#c8a0ff", 2), 0, 1.1, 0, "spin"));
      break;
    }
    case "tinkerhut": {
      const roof = mesh(cone(1.05, 0.7, 4), Tm, 0, 1.25); roof.rotation.y = Math.PI / 4;
      add(g, mesh(box(1.4, 0.9, 1.4), M, 0, 0.45), roof, mesh(box(0.02, 0.5, 0.34), dark(), 0.71, 0.25), mesh(box(0.02, 0.22, 0.22), glowMat("#ffe08a", 1.8), 0.71, 0.6, 0.4));
      break;
    }
    case "clocktower": {
      add(g, mesh(box(2.2, 0.3, 2.2), stone(), 0, 0.15), mesh(box(1.1, 2.6, 1.1), std("#9a8a76", 0, 0.9), 0, 1.6), mesh(cone(0.9, 0.9, 4), std("#5a4a3a", 0, 0.8), 0, 3.35));
      g.children[2].rotation.y = Math.PI / 4;
      const face = mesh(cyl(0.38, 0.38, 0.04, 20), glowMat("#fff4d0", 1.4), 0.57, 2.4); face.rotation.z = Math.PI / 2;
      const hand = mesh(box(0.03, 0.3, 0.05), dark(), 0.6, 2.4); hand.name = "clock";
      add(g, face, hand);
      break;
    }
    case "ferris": {
      const w = new THREE.Group(); w.name = "spinZ"; w.position.y = 1.6;
      w.add(mesh(tor(1.2, 0.06, 6, 40), std("#e0d8ff", 0.6, 0.3)));
      for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5; const sp = mesh(box(0.04, 1.2, 0.04), std("#c8c0e8", 0.6, 0.3)); sp.position.set(Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0); sp.rotation.z = a - Math.PI / 2; w.add(sp, mesh(box(0.22, 0.22, 0.3), glowMat(["#ff8ab0", "#ffe36a", "#9ab8ff"][i % 3], 1.6), Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0)); }
      add(g, mesh(box(2.4, 0.2, 1.2), stone(), 0, 0.1), mesh(box(0.1, 1.6, 0.1), M, 0, 0.8, 0.3), mesh(box(0.1, 1.6, 0.1), M, 0, 0.8, -0.3), w);
      break;
    }
    case "gravity": {
      add(g, mesh(cyl(1.2, 1.3, 0.2, 20), stone(), 0, 0.1), mesh(sph(0.55, 20, 14), std("#05030a", 0.2, 0.1), 0, 1));
      for (let i = 0; i < 3; i++) { const r = mesh(tor(0.8 + i * 0.25, 0.03, 6, 40), glowMat(["#b26bff", "#6a8aff", "#ff6ad0"][i], 1.8), 0, 1); r.rotation.x = Math.PI / 2 + i * 0.4; r.name = "spin" + i; g.add(r); }
      break;
    }
    case "wishing": add(g, mesh(cyl(0.75, 0.8, 0.5, 14), stone(), 0, 0.25), mesh(cyl(0.6, 0.6, 0.04, 14), water(), 0, 0.46), mesh(cyl(0.04, 0.04, 1, 6), std("#6a4a2a"), 0.6, 0.75), mesh(cyl(0.04, 0.04, 1, 6), std("#6a4a2a"), -0.6, 0.75), mesh(cone(0.95, 0.4, 4), std("#8a3a2a"), 0, 1.4)); g.children[4].rotation.y = Math.PI / 4; break;
    case "sundial": { const gn = mesh(box(0.7, 0.5, 0.05), std("#3a3020", 0.6, 0.4), 0.2, 0.45); add(g, mesh(cyl(0.8, 0.85, 0.2, 24), std("#cfc4a8", 0, 0.8), 0, 0.1), gn); break; }
    case "starforge": {
      add(g, mesh(box(3.4, 0.6, 3.4), M, 0, 0.3), mesh(cyl(1.1, 1.4, 1.4, 8), std("#2a1a40", 0.6, 0.3), 0, 1.3), mesh(ico(0.6, 0), glowMat("#ffffff", 3), 0, 2.4, 0, "spin"));
      for (const [x, z] of [[1.4, 1.4], [-1.4, 1.4], [1.4, -1.4], [-1.4, -1.4]]) g.add(mesh(cyl(0.18, 0.22, 1.6, 6), Tm, x, 1.1, z));
      break;
    }
    case "orrery": {
      add(g, mesh(cyl(1.1, 1.2, 0.3, 20), std("#5a4a2a", 0.8, 0.3), 0, 0.15), mesh(sph(0.3), glowMat("#ffd23f", 2.6), 0, 1.2));
      for (let i = 0; i < 3; i++) { const arm = new THREE.Group(); arm.name = "orbit" + i; arm.position.y = 1.2; arm.add(mesh(sph(0.1 + i * 0.03), std(["#4ea8ff", "#ff7a5a", "#5fe08a"][i], 0.3, 0.5), 0.5 + i * 0.3, 0)); g.add(arm); }
      break;
    }
    case "worldheart": {
      add(g, mesh(cyl(2.3, 2.4, 0.35, 24), stone(), 0, 0.17), mesh(tor(2.1, 0.08, 6, 48), glowMat("#e8c070", 1.4), 0, 0.36));
      const tree = new THREE.Group(); tree.name = "heartTree"; g.add(tree);
      break;
    }
    default: add(g, base(0.4));
  }
  // An arrow on the output side, for everything that hands motes on.
  if (!["lantern", "chime", "echobell", "sprinkler", "tinkerhut", "clocktower", "sundial", "orrery", "starforge", "worldheart", "stormrod", "splitter", "track"].includes(type)) {
    const ar = mesh(cone(0.09, 0.2, 3), glowMat("#fff0c8", 1.2), s / 2 - 0.02, 0.06);
    ar.rotation.z = -Math.PI / 2; ar.castShadow = false; ar.name = "arrow";
    g.add(ar);
  }
  return g;
}

/** The World Heart's tree, grown to a Stage. */
export function heartTree(group, stage) {
  while (group.children.length) group.remove(group.children[0]);
  const h = 0.6 + stage * 0.45;
  group.add(mesh(cyl(0.18 + stage * 0.03, 0.32 + stage * 0.05, h, 8), std("#5a3a1a", 0, 0.9), 0, h / 2));
  const cols = ["#3a8a3a", "#5aaa4a", "#8ad06a", "#c8f08a", "#ffe08a", "#ffb0e0", "#ffffff", "#ffffff"];
  for (let i = 0; i <= stage; i++) {
    const a = i * 2.4, r = 0.3 + stage * 0.1;
    group.add(mesh(ico(0.4 + stage * 0.12, 1), i >= 5 ? glowMat(cols[i], 1.5) : std(cols[i], 0, 0.8), Math.cos(a) * r, h + Math.sin(i * 1.7) * 0.2, Math.sin(a) * r));
  }
}

/* ---------- small things: critters, Tinkers, the Golden Moth ---------- */
export function critter(col, flyer) {
  const g = new THREE.Group();
  if (flyer) { g.add(mesh(sph(0.07, 8, 6), glowMat(col, 2.6))); g.userData.fly = true; }
  else {
    const body = mesh(sph(0.13, 10, 8), std(col, 0, 0.7), 0, 0.12); body.scale.set(1.3, 0.9, 1);
    g.add(body, mesh(sph(0.025, 6, 4), dark(), 0.15, 0.17, 0.05), mesh(sph(0.025, 6, 4), dark(), 0.15, 0.17, -0.05));
  }
  return g;
}
export function tinker() {
  const g = new THREE.Group();
  g.add(mesh(box(0.22, 0.24, 0.2), std("#d8dce0", 0.6, 0.3), 0, 0.2), mesh(box(0.08, 0.06, 0.16), glowMat("#4ea8ff", 2), 0.11, 0.24), mesh(cyl(0.01, 0.01, 0.14, 4), std("#888"), 0, 0.39), mesh(sph(0.03, 6, 4), glowMat("#ffd23f", 2.4), 0, 0.47));
  g.add(mesh(cyl(0.04, 0.04, 0.08, 6), dark(), 0.06, 0.04, 0.07), mesh(cyl(0.04, 0.04, 0.08, 6), dark(), 0.06, 0.04, -0.07));
  return g;
}
export function moth() {
  const g = new THREE.Group();
  const wing = G("wing", () => new THREE.CircleGeometry(0.28, 10));
  const m = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffcf3a").multiplyScalar(2.2), toneMapped: false, side: THREE.DoubleSide });
  const l = new THREE.Mesh(wing, m), r = new THREE.Mesh(wing, m);
  l.name = "wl"; r.name = "wr";
  l.position.x = -0.2; r.position.x = 0.2;
  g.add(l, r, mesh(cyl(0.03, 0.03, 0.3, 6), dark()));
  return g;
}
export { std, mesh, box, cyl, sph, cone, tor, ico, oct, glassMat, stone, dark };

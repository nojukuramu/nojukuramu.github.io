#!/usr/bin/env node
/* ============================================================
   Magic Circles — assets/manifest.json from assets/models/

   `node tools/manifest.js`

   Every model is one of Kenney's (see assets/CREDITS.md), and every kit
   uses its own scale and its own idea of where a model's origin is: a
   Fantasy Town wall sits at the edge of its cell, a Graveyard wall at the
   back of it. The game wants all of them centred on their footprint and
   standing on the ground, at a size it chooses. So this reads each .glb's
   bounds once, here, and props.js recentres and scales from the numbers
   instead of measuring 140 models at boot.

   Run it after adding or removing a model; tools/validate.js checks that
   the manifest and the folder agree.
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MODELS = path.join(ROOT, "assets", "models");

function trs(n) {
  if (n.matrix) return n.matrix;
  const t = n.translation || [0, 0, 0], s = n.scale || [1, 1, 1], q = n.rotation || [0, 0, 0, 1];
  const [x, y, z, w] = q;
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  return [(1 - 2 * (yy + zz)) * s[0], 2 * (xy + wz) * s[0], 2 * (xz - wy) * s[0], 0,
    2 * (xy - wz) * s[1], (1 - 2 * (xx + zz)) * s[1], 2 * (yz + wx) * s[1], 0,
    2 * (xz + wy) * s[2], 2 * (yz - wx) * s[2], (1 - 2 * (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k];
  return o;
}
const apply = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

/** Bounds of a .glb in its own units, with every node's transform applied. */
function bounds(file) {
  const b = fs.readFileSync(file);
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.slice(20, 20 + len).toString());
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  const visit = (ni, M) => {
    const n = j.nodes[ni], m = mul(M, trs(n));
    if (n.mesh !== undefined) for (const p of j.meshes[n.mesh].primitives) {
      const a = j.accessors[p.attributes.POSITION];
      for (const cx of [a.min[0], a.max[0]]) for (const cy of [a.min[1], a.max[1]]) for (const cz of [a.min[2], a.max[2]]) {
        const v = apply(m, [cx, cy, cz]);
        for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], v[i]); mx[i] = Math.max(mx[i], v[i]); }
      }
    }
    (n.children || []).forEach((c) => visit(c, m));
  };
  (j.scenes[j.scene || 0].nodes).forEach((n) => visit(n, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  const r3 = (v) => v.map((x) => Math.round(x * 1000) / 1000);
  return { min: r3(mn), max: r3(mx), animated: !!(j.animations && j.animations.length) };
}

function build() {
  const out = { models: {} };
  for (const kit of fs.readdirSync(MODELS).sort()) {
    const dir = path.join(MODELS, kit);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).sort()) {
      if (!f.endsWith(".glb")) continue;
      const b = bounds(path.join(dir, f));
      const e = { file: "models/" + kit + "/" + f, min: b.min, max: b.max };
      if (b.animated) e.animated = true;
      out.models[kit + "/" + f.replace(/\.glb$/, "")] = e;
    }
  }
  return out;
}

module.exports = { build, bounds };
if (require.main === module) {
  const m = build();
  // one model per line, so a diff of the manifest reads as a list of models
  const lines = Object.entries(m.models).map(([k, e]) => "  " + JSON.stringify(k) + ": " + JSON.stringify(e));
  fs.writeFileSync(path.join(ROOT, "assets", "manifest.json"), '{"models": {\n' + lines.join(",\n") + "\n}}\n");
  console.log(Object.keys(m.models).length + " models written to assets/manifest.json");
}

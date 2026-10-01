#!/usr/bin/env node
/* Aisa — validation harness
 * `node tools/validate.js` from the aisa folder.
 *
 *   1. Static checks over the source as text: no emoji (every glyph is an
 *      inline SVG), every id the scripts reach for present in index.html,
 *      every (i) naming a topic that exists, the page asking not to be
 *      indexed, and nothing anywhere else on the site pointing at it.
 *
 *   2. Rig checks, with model.js and expressions.js loaded into a sandbox:
 *      at default parameters every part lands exactly where it was drawn
 *      (the rig at rest *is* the picture), every part and drawn part has a
 *      deformer and a place in the draw order, every parameter an
 *      expression, motion or pendulum names exists and is in range, and
 *      the extremes of every parameter still give finite geometry and eye
 *      clips the shader can walk.
 *
 * No dependencies, no build step - the shape of arco/tools/validate.js and
 * routecast/tools/validate.js, whose emoji check is lifted from there.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.join(__dirname, "..");
var SITE = path.join(ROOT, "..");
var failures = [];
var checks = 0;

function ok(name) { checks++; process.stdout.write("  ok   " + name + "\n"); }
function fail(name, detail) {
  checks++;
  failures.push(name + (detail ? " - " + detail : ""));
  process.stdout.write("  FAIL " + name + (detail ? " - " + detail : "") + "\n");
}
function check(name, cond, detail) { cond ? ok(name) : fail(name, detail); }
function section(title) { process.stdout.write("\n" + title + "\n"); }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }

function sourceFiles() {
  var out = [];
  (function walk(dir) {
    fs.readdirSync(path.join(ROOT, dir)).forEach(function (name) {
      var rel = path.join(dir, name);
      if (fs.statSync(path.join(ROOT, rel)).isDirectory()) { walk(rel); return; }
      if (/\.(js|css|html|md|py|json)$/.test(name)) out.push(rel);
    });
  })(".");
  return out;
}

var HTML = read("index.html");

/* ------------------------------------------------------------------ static */

section("Static: no emoji");
(function () {
  var EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;
  var bad = [];
  sourceFiles().forEach(function (f) {
    read(f).split("\n").forEach(function (line, i) {
      if (EMOJI.test(line)) bad.push(f + ":" + (i + 1));
    });
  });
  check("no emoji or pictographic characters in source", bad.length === 0, bad.slice(0, 8).join(", "));
})();

section("Static: the page");
(function () {
  var scripts = [];
  HTML.replace(/<script src="([^"]+)"/g, function (_, s) { scripts.push(s); });
  var missing = scripts.filter(function (s) { return !fs.existsSync(path.join(ROOT, s)); });
  check("every script the page loads exists", missing.length === 0, missing.join(", "));

  var ids = {};
  HTML.replace(/\bid="([^"]+)"/g, function (_, id) { ids[id] = 1; });
  var wanted = {};
  ["js/panel.js", "js/info.js"].forEach(function (f) {
    read(f).replace(/getElementById\("([^"]+)"\)/g, function (_, id) { wanted[id] = 1; });
  });
  var absent = Object.keys(wanted).filter(function (id) { return !ids[id]; });
  check("every id the scripts reach for is in index.html", absent.length === 0, absent.join(", "));

  var src = read("js/info.js");
  var keys = [];
  HTML.replace(/data-info="([^"]+)"/g, function (_, k) { keys.push(k); });
  var unknown = keys.filter(function (k) {
    return !new RegExp("\\n    (\"" + k + "\"|" + k + "): \\{").test(src);
  });
  check("every (i) names a topic in info.js", unknown.length === 0, unknown.join(", "));

  check("the page asks not to be indexed", /<meta name="robots" content="noindex/.test(HTML));
  /* An installable app here owes its users an update path (CLAUDE.md).
     This page caches nothing and registers no worker, so a deploy is live
     on the next load - and this check keeps it that way. */
  var shipped = sourceFiles().filter(function (f) { return !/^tools\//.test(f); });
  check("no service worker (so no stale copies to update)", !/serviceWorker/.test(shipped.map(read).join("\n")));
})();

section("Static: hidden");
(function () {
  /* The page is reached by its address and nothing else. Every place the
     site lists its projects must stay silent about it. */
  var places = ["index.html", "404.html", "README.md", "sitemap.xml", "robots.txt", "humans.txt",
                "static/home/js/projects.js", "CLAUDE.md"];
  var leaks = places.filter(function (p) {
    var f = path.join(SITE, p);
    return fs.existsSync(f) && /aisa/i.test(fs.readFileSync(f, "utf8"));
  });
  check("not linked or listed anywhere else on the site", leaks.length === 0, leaks.join(", "));
})();

/* ---------------------------------------------------------------- the rig */

var ctx = { console: console, Math: Math, Object: Object, Float32Array: Float32Array, Array: Array, WeakMap: WeakMap };
vm.createContext(ctx);
["js/model.js", "js/expressions.js"].forEach(function (f) {
  vm.runInContext(read(f), ctx, { filename: f });
});
var AISA = ctx.AISA, model = AISA.model;
var parts = JSON.parse(read("art/parts.json"));
var P = {};
model.params.forEach(function (p) { P[p.id] = p; });
function defaults() { var v = {}; model.params.forEach(function (p) { v[p.id] = p.def; }); return v; }

section("Rig: assets");
(function () {
  var png = fs.readFileSync(path.join(ROOT, "art/atlas.png"));
  var w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  check("atlas size matches parts.json", w === parts.width && h === parts.height, w + "x" + h);
  var outside = Object.keys(parts.parts).filter(function (k) {
    var p = parts.parts[k];
    return p.u < 0 || p.v < 0 || p.u + p.tw > w || p.v + p.th > h;
  });
  check("every part lies inside the atlas", outside.length === 0, outside.join(", "));
  check("a texel is a quarter of a source pixel", parts.scale === 4);
})();

section("Rig: structure");
(function () {
  var st = model.prepare(defaults());
  var order = model.order(st);
  var ids = parts.order.concat(model.sprites.map(function (s) { return s.id; }));
  var unplaced = ids.filter(function (id) { return order.indexOf(id) < 0; });
  check("every part and drawn part has a place in the draw order", unplaced.length === 0, unplaced.join(", "));
  var phantom = order.filter(function (id) { return ids.indexOf(id) < 0; });
  check("the draw order names nothing that does not exist", phantom.length === 0, phantom.join(", "));
  var broken = ids.filter(function (id) {
    try { model.deform(id, new Float32Array([120, 200]), new Float32Array(2), st); return false; }
    catch (e) { return true; }
  });
  check("every part has a deformer", broken.length === 0, broken.join(", "));
  var ranges = model.params.filter(function (p) { return !(p.min < p.max && p.def >= p.min && p.def <= p.max); });
  check("every parameter's default is inside its range", ranges.length === 0, ranges.map(function (p) { return p.id; }).join(", "));
})();

section("Rig: at rest she is the drawing");
(function () {
  /* Every deformer has to be the identity at the default parameters, or
     the picture on screen drifts from the picture that was drawn. */
  var st = model.prepare(defaults());
  var worst = 0, where = "";
  parts.order.forEach(function (id) {
    var p = parts.parts[id], pts = [];
    for (var y = p.y; y <= p.y + p.h; y += p.h / 6) for (var x = p.x; x <= p.x + p.w; x += p.w / 6) pts.push(x, y);
    var rest = new Float32Array(pts), out = new Float32Array(pts.length);
    model.deform(id, rest, out, st);
    for (var i = 0; i < pts.length; i++) {
      var d = Math.abs(out[i] - rest[i]);
      if (d > worst) { worst = d; where = id; }
    }
  });
  check("no part moves at the default parameters", worst < 1e-3, worst.toFixed(4) + " px in " + where);

  /* The eyeball is clipped along an edge worked out point by point
     (eyeClip), while the lash it hides under is a mesh whose depths were
     baked once. The two must land in the same place, or a closing eye
     shows a sliver of iris above the lash or a gap below it. */
  var v2 = defaults(), worstClip = 0;
  [[0.5, 0], [0, 0], [0.4, 1], [1.2, 0]].forEach(function (os) {
    v2.ParamEyeROpen = v2.ParamEyeLOpen = os[0]; v2.ParamEyeRSmile = v2.ParamEyeLSmile = os[1];
    v2.ParamAngleX = 18; v2.ParamAngleY = -10; v2.ParamAngleZ = 7; v2.ParamEyeRAngle = 0.6;
    var st2 = model.prepare(v2);
    [["lidR", "ballR", model.landmarks.lids.R], ["lidL", "ballL", model.landmarks.lids.L]].forEach(function (k) {
      var c = model.clip(k[1], st2), e = k[2], x0 = e[0][0], x1 = e[e.length - 1][0];
      for (var i = 0; i < 8; i++) {
        var x = x0 + (x1 - x0) * i / 7, y = 0;
        for (var j = 1; j < e.length; j++) if (x <= e[j][0] + 1e-6) { y = e[j - 1][1] + (e[j][1] - e[j - 1][1]) * (x - e[j - 1][0]) / (e[j][0] - e[j - 1][0]); break; }
        var o = new Float32Array(2);
        model.deform(k[0], new Float32Array([x, y - 0.7]), o, st2);
        worstClip = Math.max(worstClip, Math.hypot(o[0] - (c.origin[0] + c.top[i * 2]), o[1] - (c.origin[1] + c.top[i * 2 + 1])));
      }
    });
  });
  check("the eye clip follows the lash mesh", worstClip < 0.35, worstClip.toFixed(3) + " px");
})();

section("Rig: extremes");
(function () {
  var bad = [], clipBad = [];
  var probe = new Float32Array([90, 200, 150, 200, 120, 300, 70, 330, 170, 330, 100, 400, 140, 140]);
  model.params.forEach(function (p) {
    [p.min, p.max].forEach(function (val) {
      var v = defaults(); v[p.id] = val;
      var st = model.prepare(v), out = new Float32Array(probe.length);
      parts.order.concat(model.sprites.map(function (s) { return s.id; })).forEach(function (id) {
        model.deform(id, probe, out, st);
        for (var i = 0; i < out.length; i++) if (!isFinite(out[i])) { bad.push(p.id + "=" + val + " " + id); break; }
      });
      ["ballR", "ballL"].forEach(function (id) {
        var c = model.clip(id, st);
        for (var i = 2; i < 16; i += 2) if (!(c.top[i] > c.top[i - 2]) || !(c.bot[i] > c.bot[i - 2])) { clipBad.push(p.id + "=" + val + " " + id); break; }
      });
    });
  });
  check("every parameter at either end gives finite geometry", bad.length === 0, bad.slice(0, 6).join(", "));
  check("eye clip edges run left to right at every extreme", clipBad.length === 0, clipBad.slice(0, 6).join(", "));
})();

section("Rig: expressions, motions, physics");
(function () {
  var unknown = [], range = [];
  Object.keys(AISA.expressions).forEach(function (name) {
    var e = AISA.expressions[name];
    Object.keys(e).forEach(function (id) {
      if (!P[id]) unknown.push(name + "." + id);
      else if (e[id] < P[id].min || e[id] > P[id].max) range.push(name + "." + id);
    });
  });
  check("expressions only name parameters that exist", unknown.length === 0, unknown.join(", "));
  check("expression values are inside their ranges", range.length === 0, range.join(", "));

  var badTrack = [];
  Object.keys(AISA.motions).forEach(function (name) {
    var m = AISA.motions[name];
    Object.keys(m).forEach(function (id) {
      if (id === "loop") return;
      if (!P[id]) { badTrack.push(name + "." + id + " (no such parameter)"); return; }
      var keys = m[id];
      for (var i = 1; i < keys.length; i++) if (!(keys[i][0] > keys[i - 1][0])) { badTrack.push(name + "." + id + " (time goes backwards)"); break; }
      if (keys[0][0] !== 0 || keys[0][1] !== 0 || keys[keys.length - 1][1] !== 0) badTrack.push(name + "." + id + " (must start and end at 0)");
    });
  });
  check("motion tracks name parameters, run forward, and start and end at rest", badTrack.length === 0, badTrack.join(", "));

  var badPhys = [];
  AISA.physics.forEach(function (c) {
    if (!P[c.out]) badPhys.push(c.out);
    Object.keys(c.in).concat(Object.keys(c.hang)).forEach(function (id) { if (!P[id]) badPhys.push(c.out + " <- " + id); });
    if (!(c.hz > 0 && c.damp > 0)) badPhys.push(c.out + " (needs hz and damp)");
  });
  check("every pendulum reads and writes parameters that exist", badPhys.length === 0, badPhys.join(", "));

  /* A motion adds its keys to whatever she is doing, and the curve through
     them never overshoots a key, so a key further than a parameter's whole
     span can only ever be clamped - a typo, not a pose. */
  var wild = [];
  Object.keys(AISA.motions).forEach(function (name) {
    var m = AISA.motions[name];
    Object.keys(m).forEach(function (id) {
      if (id === "loop" || !P[id]) return;
      var span = P[id].max - P[id].min;
      if (m[id].some(function (k) { return Math.abs(k[1]) > span; })) wild.push(name + "." + id);
    });
  });
  check("no motion key reaches past a parameter's whole span", wild.length === 0, wild.join(", "));

  // the panel builds itself from these lists; the README is written by hand
  var readme = read("README.md").replace(/\s+/g, " ");
  var undocumented = Object.keys(AISA.expressions).concat(Object.keys(AISA.motions)).filter(function (n) {
    return !new RegExp("[ ,(]" + n + "[ ,).]").test(readme);
  });
  check("README lists every expression and motion", undocumented.length === 0, undocumented.join(", "));
})();

process.stdout.write("\n" + (checks - failures.length) + "/" + checks + " checks passed\n");
if (failures.length) {
  process.stdout.write("\n" + failures.length + " failed:\n  " + failures.join("\n  ") + "\n");
  process.exit(1);
}

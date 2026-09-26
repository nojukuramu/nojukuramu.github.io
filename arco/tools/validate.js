#!/usr/bin/env node
/* ARCO — validation harness
 * `node tools/validate.js` from the arco folder.
 *
 * Two halves, both of which must pass before anything ships.
 *
 *   1. Static checks over the source as text: no emoji (every glyph is an
 *      inline SVG), every SVG well formed, every id the scripts reach for
 *      present in index.html, every script the page loads in the service
 *      worker's shell, the page and the worker agreeing on the version, the
 *      worker never taking over on its own, and every (i) naming a topic that
 *      exists.
 *
 *   2. Behaviour checks on the neck, run in a sandbox with a fake engine that
 *      records what it is asked to play: the shapes come out as a guitarist
 *      would finger them, and hammer-ons, pull-offs, mutes, picks, palm mutes,
 *      strums and the position rail do what the info sheet says they do.
 *
 * No dependencies, no build step — the same shape as routecast/tools/validate.js,
 * whose emoji and SVG checks are lifted from there.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var ROOT = path.join(__dirname, "..");
var failures = [];
var checks = 0;

function ok(name) { checks++; process.stdout.write("  ok   " + name + "\n"); }
function fail(name, detail) {
  checks++;
  failures.push(name + (detail ? " — " + detail : ""));
  process.stdout.write("  FAIL " + name + (detail ? " — " + detail : "") + "\n");
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
      if (/\.(js|css|html|md|webmanifest|svg|txt)$/.test(name)) out.push(rel);
    });
  })(".");
  return out;
}

var HTML = read("index.html");
var SW = read("sw.js");

/* ------------------------------------------------------------------ static */

section("Static: no emoji");
(function () {
  /* The pictographic blocks, plus the variation selector that turns a dingbat
   * into an emoji — routecast's ranges. Except the three music signs: the
   * flat, natural and sharp live in the same block as the dingbats, and in an
   * instrument they are spelling, not decoration. */
  var EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{266C}\u{2670}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;
  var bad = [];
  sourceFiles().forEach(function (rel) {
    if (rel.indexOf("tools") === 0) return;
    read(rel).split("\n").forEach(function (line, i) {
      var m = line.match(EMOJI);
      if (m) bad.push(rel + ":" + (i + 1) + " " + JSON.stringify(m[0]));
    });
  });
  check("no emoji or pictographic characters in source", bad.length === 0, bad.slice(0, 8).join(", "));
})();

section("Static: SVG");
(function () {
  function parseSvg(svg) {
    var VOID = { path: 1, circle: 1, rect: 1, line: 1, polyline: 1, polygon: 1, ellipse: 1, use: 1, stop: 1, image: 1 };
    var stack = [];
    var re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
    var m, consumed = 0;
    while ((m = re.exec(svg))) {
      var between = svg.slice(consumed, m.index);
      if (between.indexOf("<") > -1) return "stray '<' before " + m[2];
      consumed = re.lastIndex;
      if (m[1]) {
        if (stack.pop() !== m[2]) return "</" + m[2] + "> does not close the open element";
      } else if (!m[4] && !VOID[m[2]]) {
        stack.push(m[2]);
      }
    }
    if (svg.slice(consumed).indexOf("<") > -1) return "trailing '<'";
    if (stack.length) return "unclosed <" + stack[stack.length - 1] + ">";
    return null;
  }
  var html = HTML.replace(/<!--[\s\S]*?-->/g, "");
  var svgs = html.match(/<svg[\s\S]*?<\/svg>/g) || [];
  var problems = [];
  svgs.forEach(function (svg, i) {
    var err = parseSvg(svg);
    if (err) problems.push("svg #" + (i + 1) + ": " + err);
    if (!/viewBox="[^"]+"/.test(svg)) problems.push("svg #" + (i + 1) + ": no viewBox");
  });
  var opens = (HTML.match(/<svg\b/g) || []).length;
  var closes = (HTML.match(/<\/svg>/g) || []).length;
  check("every inline SVG is well formed (" + svgs.length + " checked)", problems.length === 0, problems.slice(0, 4).join("; "));
  check("every <svg> is closed", opens === closes, opens + " open, " + closes + " closed");
})();

section("Static: ids and topics");
(function () {
  var declared = {};
  var re = /\sid="([^"]+)"/g, m;
  while ((m = re.exec(HTML))) declared[m[1]] = true;
  var missing = [];
  fs.readdirSync(path.join(ROOT, "js")).forEach(function (name) {
    var src = read("js/" + name);
    var r = /(?:\$|getElementById|el)\("([\w-]+)"\)/g, mm;
    while ((mm = r.exec(src))) if (!declared[mm[1]]) missing.push(name + ": #" + mm[1]);
  });
  check("every element id the scripts use exists in index.html", missing.length === 0, missing.slice(0, 8).join(", "));

  var info = read("js/info.js");
  var topics = {};
  var tr = /\n {4}"?([a-z-]+)"?: \{\n {6}title:/g, t;
  while ((t = tr.exec(info))) topics[t[1]] = true;
  var used = [], dead = [];
  var dr = /data-info="([^"]+)"/g, d;
  while ((d = dr.exec(HTML))) { used.push(d[1]); if (!topics[d[1]]) dead.push(d[1]); }
  check("every (i) names a topic that exists", dead.length === 0, dead.join(", "));
  check("the page links into the sheet", used.length >= 8, used.length + " links");
})();

section("Static: the service worker");
(function () {
  var pageScripts = [];
  var re = /<script src="(js\/[^"]+)"><\/script>/g, m;
  while ((m = re.exec(HTML))) pageScripts.push(m[1]);
  var onDisk = fs.readdirSync(path.join(ROOT, "js")).map(function (n) { return "js/" + n; });

  var missingFile = pageScripts.filter(function (p) { return onDisk.indexOf(p) < 0; });
  check("every script the page loads exists", missingFile.length === 0, missingFile.join(", "));
  /* The worklet is loaded by the audio engine, not by a script tag. */
  var orphan = onDisk.filter(function (p) { return pageScripts.indexOf(p) < 0 && p !== "js/dsp-worklet.js"; });
  check("no orphan script in js/", orphan.length === 0, orphan.join(", "));
  var uncached = onDisk.concat(["css/arco.css", "index.html", "manifest.webmanifest"])
    .filter(function (p) { return SW.indexOf('"./' + p + '"') < 0; });
  check("every file the page needs is in the offline shell", uncached.length === 0, uncached.join(", "));

  var swV = /var VERSION = "arco-v(\d+)"/.exec(SW);
  var pageV = /window\.ARCO_VERSION\s*=\s*"([^"]+)"/.exec(HTML);
  check("the page declares its version", !!pageV);
  check("the page and the service worker agree on it", !!pageV && !!swV && pageV[1] === swV[1],
    (pageV ? pageV[1] : "?") + " vs " + (swV ? swV[1] : "?"));

  /* Every skipWaiting() must be the one the page asked for. Comments are
   * stripped first: the install handler explains why it is not there. */
  var code = SW.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  var parts = code.split("skipWaiting");
  var unasked = 0;
  for (var i = 0; i < parts.length - 1; i++) if (parts[i].slice(-120).indexOf("skip-waiting") < 0) unasked++;
  check("the service worker never takes over on its own", unasked === 0, unasked + " unprompted skipWaiting()");
  check("it hands over when the page asks",
    /addEventListener\("message"[\s\S]{0,160}skip-waiting[\s\S]{0,80}skipWaiting/.test(code));
  check("it only ever clears ARCO's own caches",
    /caches\.delete/.test(code) && /indexOf\("arco-"\) === 0/.test(code));
})();

/* --------------------------------------------------------------- behaviour */

section("Behaviour: the neck");

var calls = [];
var energy = [0, 0, 0, 0, 0, 0];

function sandbox() {
  var state = {
    layout: "neck", tuning: "standard", frets: 7, pos: 1, lefty: false, lowTop: false,
    tap: true, shape: "note", scaleDots: true, key: 0, mode: "major", sevenths: false,
    instrument: "guitar", motion: false, tiltLR: 0, tiltFB: 0,
    ringVis: [0, 0, 0, 0, 0, 0]
  };
  var engine = {
    pluck: function (s, amp, tone, pm, hz, snap) { calls.push({ op: "pluck", s: s, amp: amp, pm: pm, hz: hz, snap: snap }); },
    damp: function (s, amt) { calls.push({ op: "damp", s: s, amt: amt }); },
    setFreq: function () {}, setBow: function () {}, setContact: function () {}, setBright: function () {},
    energy: function () { return energy; },
    preset: function () { return { bendRange: 2 }; }
  };
  var ctx = {
    window: {}, console: console, Math: Math, JSON: JSON,
    performance: { now: function () { return clock; } },
    setTimeout: function (fn) { fn(); },
    document: {
      getElementById: function () { return null; },
      createElement: function () { return { style: {} }; },
      body: { appendChild: function () {} }
    },
    getComputedStyle: function () { return {}; }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  ctx.ARCO = { input: { state: state }, engine: engine };
  vm.runInContext(read("js/theory.js"), ctx);
  vm.runInContext(read("js/neck.js"), ctx);
  ctx.ARCO.neck.init();
  return { A: ctx.ARCO, S: state };
}
var clock = 1000;

var box = sandbox();
var N = box.A.neck, S = box.S;

function stops(s, f, shape) {
  return N.shapeFor(s, f, shape).stops.map(function (st) { return st.s + ":" + st.f; }).join(" ");
}
function frets(s, f) {
  /* As a chord chart reads it, low E first, x for a string not played. */
  var out = ["x", "x", "x", "x", "x", "x"];
  N.shapeFor(s, f, "chord").stops.forEach(function (st) { out[st.s] = String(st.f); });
  return out.join("");
}

check("a power chord on the low E is root, fifth, octave", stops(0, 3, "power") === "0:3 1:5 2:5", stops(0, 3, "power"));
check("and keeps the three strings above it quiet", N.shapeFor(0, 3, "power").mutes.join() === "3,4,5");
check("across the G-to-B major third the shape shifts a fret", stops(3, 5, "power") === "3:5 4:8 5:8", stops(3, 5, "power"));
check("an octave skips the string between and mutes it",
  stops(0, 5, "octave") === "0:5 2:7" && N.shapeFor(0, 5, "octave").mutes.indexOf(1) >= 0, stops(0, 5, "octave"));

S.key = 4; check("chord on the open low E in E is E major (022100)", frets(0, 0) === "022100", frets(0, 0));
S.key = 9; check("chord on the open A in A is A major (x02220)", frets(1, 0) === "x02220", frets(1, 0));
S.key = 2; check("chord on the open D in D is D major (xx0232)", frets(2, 0) === "xx0232", frets(2, 0));
S.key = 7; check("chord on the open low E in G is E minor, vi (022000)", frets(0, 0) === "022000", frets(0, 0));
S.key = 0; check("chord on the A string's 3rd fret in C is the barre C (x35553)", frets(1, 3) === "x35553", frets(1, 3));

S.tuning = "dropd";
check("drop D turns the power chord into one finger across three strings", stops(0, 0, "power") === "0:0 1:0 2:0", stops(0, 0, "power"));
S.tuning = "standard";

var ok_t = N.TUNING_ORDER.every(function (k) {
  var t = N.TUNINGS[k];
  return t && t.midi.length === 6 && t.midi[0] >= 36 && t.midi.every(function (m, i) { return i === 0 || m > t.midi[i - 1]; });
});
check("every tuning has six rising strings, none below C2", ok_t);

/* Touches, on a phone-sized screen. */
var g = N.layout(844, 390);
function at(s, f) { return { x: N.colMid(f), y: N.laneY(N.stringAtLane(s)) }; }
function ev(id) { return { pointerId: id }; }
function last(op, s) {
  for (var i = calls.length - 1; i >= 0; i--) if (calls[i].op === op && (s === undefined || calls[i].s === s)) return calls[i];
  return null;
}
function near(a, b) { return Math.abs(a - b) < 0.05; }
function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

check("the body starts a fixed share across, the neck shows 7 frets", g.n === 7 && g.xb > g.W * 0.6 && g.xb < g.W * 0.8);

calls = [];
N.down(ev(1), at(0, 3));
var p1 = last("pluck", 0);
check("with tap on, pressing the low E's 3rd fret plays G2 at once", !!p1 && p1.snap === true && near(p1.hz, hz(43)),
  p1 ? p1.hz.toFixed(2) + " Hz" : "no pluck");

energy[0] = 0.05;
calls = [];
N.down(ev(2), at(0, 5));
var p2 = last("pluck", 0);
check("a higher fret on a ringing string is a hammer-on: new pitch, no snap, softer",
  !!p2 && p2.snap === false && near(p2.hz, hz(45)) && p2.amp < p1.amp, p2 ? JSON.stringify(p2) : "no pluck");

calls = [];
clock += 300;
N.up(ev(2), at(0, 5));
var p3 = last("pluck", 0);
check("lifting it again is a pull-off back to the 3rd fret", !!p3 && near(p3.hz, hz(43)) && !last("damp", 0),
  p3 ? p3.hz.toFixed(2) : "no pluck");

calls = [];
clock += 300;
N.up(ev(1), at(0, 3));
var d1 = last("damp", 0);
check("lifting the last finger stops the string", !!d1 && d1.amt >= 0.85);

calls = [];
energy[1] = 0.05;
N.down(ev(3), at(1, 0));             // tap the open A: rings, and is live
clock += 50;
var start = at(1, 5);
N.down(ev(4), start);
clock += 16; N.move(ev(4), { x: start.x, y: start.y - 30 }, clock);
clock += 16; N.move(ev(4), { x: start.x, y: start.y - 60 }, clock);
N.up(ev(4), { x: start.x, y: start.y - 60 });
var p4 = last("pluck", 1);
check("flicking off is a pull-off to what is still held, not a mute", !!p4 && near(p4.hz, hz(45)) && !last("damp", 1),
  p4 ? p4.hz.toFixed(2) : "none");
N.up(ev(3), at(1, 0));

/* A fast slide that ends in a lift is not a flick: it moves along the string. */
calls = [];
energy[2] = 0.05;
var sl = at(2, 3);
N.down(ev(13), sl);
clock += 16; N.move(ev(13), { x: sl.x + g.fw * 0.8, y: sl.y }, clock);
clock += 16; N.move(ev(13), { x: sl.x + g.fw * 1.6, y: sl.y }, clock);
N.up(ev(13), { x: sl.x + g.fw * 1.6, y: sl.y });
check("a slide that ends in a lift stops the string rather than ringing it open", !!last("damp", 2));

calls = [];
energy = [0, 0, 0, 0, 0, 0];
S.tap = false;
N.down(ev(5), at(2, 4));
check("with tap off, fretting a silent string makes no sound", !last("pluck"));
N.up(ev(5), at(2, 4));
S.tap = true;

calls = [];
var pickX = (g.xb + g.xm) / 2;
N.down(ev(6), { x: pickX, y: N.laneY(N.stringAtLane(5)) });
var p5 = last("pluck", 5);
check("tapping the body picks the string under the thumb", !!p5 && p5.pm === 0);
N.up(ev(6), { x: pickX, y: N.laneY(0) });

calls = [];
N.down(ev(7), { x: (g.xm + g.xe) / 2, y: N.laneY(N.stringAtLane(0)) });
var p6 = last("pluck", 0);
check("picking in the strip by the bridge is a palm mute", !!p6 && p6.pm === 1);
N.up(ev(7), { x: (g.xm + g.xe) / 2, y: N.laneY(0) });

/* A strum over a power chord on the A string: A, D and G sound, the low E
 * below the root does not, and neither do the B and e the shape mutes. */
S.shape = "power";
N.down(ev(8), at(1, 5));
S.shape = "note";
calls = [];
clock += 10;
N.down(ev(9), { x: pickX, y: g.top + 2 });
for (var yy = g.top + 2; yy <= g.bottom - 2; yy += 6) { clock += 4; N.move(ev(9), { x: pickX, y: yy }, clock); }
N.up(ev(9), { x: pickX, y: g.bottom - 2 });
var sounded = {};
calls.forEach(function (c) { if (c.op === "pluck") sounded[c.s] = true; });
check("a strum over a power chord sounds exactly its three strings",
  sounded[1] && sounded[2] && sounded[3] && !sounded[0] && !sounded[5], JSON.stringify(Object.keys(sounded)));
N.up(ev(8), at(1, 5));

/* Bends only go up, whichever way the finger pushes. */
calls = [];
var b0 = at(3, 7);
N.down(ev(10), b0);
clock += 16; N.move(ev(10), { x: b0.x, y: b0.y + g.laneH + 8 }, clock);
var fg = N.fingers()[10];
check("pushing a string a string's width bends it a whole step up", !!fg && Math.abs(fg.bend - 2) < 0.01,
  fg ? fg.bend.toFixed(2) : "no finger");
clock += 16; N.move(ev(10), { x: b0.x, y: b0.y - 20 }, clock);
check("and bringing it back past where it started relaxes, never bends down", fg.bend === 0);
N.up(ev(10), b0);

/* The rail. */
var p0 = S.pos;
N.down(ev(11), { x: g.xn + g.fw * 3, y: (g.railT + g.railB) / 2 });
N.move(ev(11), { x: g.xn + g.fw * 1, y: (g.railT + g.railB) / 2 }, clock);
N.up(ev(11), { x: g.xn + g.fw * 1, y: (g.railT + g.railB) / 2 });
check("dragging the rail toward the nut moves the window up the neck", S.pos === p0 + 2, "pos " + S.pos);
N.shift(-99);
check("and the window never runs off the end of the neck", S.pos === 1);

/* Left-handed: the same fret is at the mirrored place. */
S.lefty = true;
g = N.layout(844, 390);
calls = [];
var m = at(0, 3);
N.down(ev(12), { x: 844 - m.x, y: m.y });
var p7 = last("pluck", 0);
check("left-handed, the mirror of a fret is the same fret", !!p7 && near(p7.hz, hz(43)));
N.up(ev(12), { x: 844 - m.x, y: m.y });
S.lefty = false;

/* ------------------------------------------------------------------ tally */

process.stdout.write("\n" + (checks - failures.length) + " / " + checks + " checks passed\n");
if (failures.length) {
  process.stdout.write("\nFailures:\n  " + failures.join("\n  ") + "\n");
  process.exit(1);
}

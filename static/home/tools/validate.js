#!/usr/bin/env node
/* ============================================================
   The homepage — validation harness
   `node static/home/tools/validate.js` from the repository root.

   Same shape as routecast/tools/validate.js and the others: no
   dependencies, static checks over the source as text, then the project
   list itself run in a sandbox and held up against the repository.

   What it guards is the stuff that has drifted before or would fail
   silently in a browser: an emoji slipping into the source, an inline SVG
   that does not parse (it just does not draw), an element id the scripts
   reach for that the page no longer has, a custom property used and never
   set, a project pointing at a folder that is not there or not in the
   sitemap, a motif name with no drawing behind it, the heading that counts
   the projects in words (it once said "twelve" while the page held
   fourteen), the logo drifting between its copies — and the two ways this
   page has been broken without a single error: an overflow on body, which
   the browser hands to the viewport and which stopped the page scrolling
   at all, and a class put on <html> that an element also wears, which
   once turned the whole document into the intro's fixed, fading overlay.
   ============================================================ */
"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var HOME = path.join(__dirname, "..");
var ROOT = path.join(HOME, "..", "..");
var failures = [];
var checks = 0;

function ok(name) { checks++; process.stdout.write("  ✓ " + name + "\n"); }
function fail(name, detail) {
  checks++;
  failures.push(name + (detail ? " — " + detail : ""));
  process.stdout.write("  ✗ " + name + (detail ? " — " + detail : "") + "\n");
}
function check(name, cond, detail) { cond ? ok(name) : fail(name, detail); }
function section(title) { process.stdout.write("\n" + title + "\n"); }

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

var JS = fs.readdirSync(path.join(HOME, "js")).filter(function (n) { return /\.js$/.test(n); })
  .map(function (n) { return "static/home/js/" + n; });
var CSS = "static/home/css/home.css";
var SOURCES = ["index.html", "404.html", CSS].concat(JS);
var html = read("index.html");

/* ============================================================
   1. Static checks
   ============================================================ */

section("Static: no emoji");
(function () {
  /* Pictographs specifically, not "non-ASCII": the copy is full of em
     dashes, curly quotes and arrows in keyboard hints, all legitimate. */
  var EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/u;
  var bad = [];
  SOURCES.forEach(function (rel) {
    read(rel).split("\n").forEach(function (line, i) {
      var m = line.match(EMOJI);
      if (m) bad.push(rel + ":" + (i + 1) + " " + JSON.stringify(m[0]));
    });
  });
  check("no emoji or pictographic characters in the homepage source", bad.length === 0, bad.slice(0, 8).join(", "));
})();

section("Static: SVG well-formedness");
(function () {
  function parseSvg(svg, where) {
    var VOID = { path: 1, circle: 1, rect: 1, line: 1, polyline: 1, polygon: 1, ellipse: 1, use: 1, stop: 1, image: 1 };
    var stack = [];
    var re = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
    var m, consumed = 0;
    while ((m = re.exec(svg))) {
      var between = svg.slice(consumed, m.index);
      if (between.indexOf("<") > -1) return where + ": stray '<' before " + m[2];
      consumed = re.lastIndex;
      if (m[1]) {
        if (stack.pop() !== m[2]) return where + ": </" + m[2] + "> does not close the open element";
      } else if (!m[4] && !VOID[m[2]]) {
        stack.push(m[2]);
      }
    }
    if (svg.slice(consumed).indexOf("<") > -1) return where + ": trailing '<'";
    if (stack.length) return where + ": unclosed <" + stack[stack.length - 1] + ">";
    return null;
  }
  function stripComments(t) { return t.replace(/<!--[\s\S]*?-->/g, ""); }
  /* markup assembled from adjacent string literals, rejoined */
  function stripJoins(t) { return t.replace(/(['"])\s*\+\s*\1/g, ""); }

  var problems = [], count = 0, built = 0;
  [["index.html", stripComments(html)]].concat(JS.map(function (rel) { return [rel, stripJoins(read(rel))]; }))
    .forEach(function (pair) {
      var re = /<svg[\s\S]*?<\/svg>/g, m;
      while ((m = re.exec(pair[1]))) {
        /* a block with a value spliced in at run time is not markup yet */
        if (/'\s*\+|\+\s*'|"\s*\+\s*[a-z]/.test(m[0])) { built++; continue; }
        count++;
        var err = parseSvg(m[0], pair[0]);
        if (err) problems.push(err);
      }
    });
  check("every inline SVG is well formed (" + count + " checked, " + built + " built at run time)",
        problems.length === 0, problems.slice(0, 5).join("; "));

  JS.concat(["index.html"]).forEach(function (rel) {
    var text = read(rel);
    var opens = (text.match(/<svg\b/g) || []).length;
    var closes = (text.match(/<\/svg>/g) || []).length;
    if (opens !== closes) problems.push(rel + ": " + opens + " <svg> but " + closes + " </svg>");
  });
  check("every <svg> is closed in every file", problems.length === 0, problems.slice(0, 5).join("; "));
})();

section("Static: what the scripts reach for");
(function () {
  var ids = {};
  var re = /\sid="([^"]+)"/g, m;
  while ((m = re.exec(html))) ids[m[1]] = true;

  var missing = [], looked = 0;
  JS.forEach(function (rel) {
    var src = read(rel);
    /* getElementById, a jQuery-ish $("#id"), and the wheel's own $("id") */
    var byId = /var \$ = function \(id\) \{ return document\.getElementById\(id\)/.test(src);
    var r1 = byId ? /getElementById\("([^"]+)"\)|\$\("#?([\w-]+)"\)/g : /getElementById\("([^"]+)"\)|\$\("#([\w-]+)"\)/g, x;
    while ((x = r1.exec(src))) {
      var id = x[1] || x[2];
      looked++;
      if (!ids[id]) missing.push(rel + " #" + id);
    }
  });
  check("every element id the scripts look up (" + looked + ") exists in index.html", looked >= 40 && missing.length === 0, missing.join(", "));

  /* A class on <html> that an element also wears styles both. The intro's
     overlay and the root's "intro is running" flag once shared a name, and
     the root became a fixed, clipped, fading box: no error, no scrolling. */
  var rootClasses = [];
  JS.forEach(function (rel) {
    var r = /(?:docEl|doc|document\.documentElement)\.classList\.(?:add|toggle)\("([\w-]+)"/g, m2;
    var src = read(rel);
    while ((m2 = r.exec(src))) if (rootClasses.indexOf(m2[1]) === -1) rootClasses.push(m2[1]);
  });
  var inline = (html.match(/documentElement\.classList\.add\("([\w-]+)"\)/) || [])[1];
  if (inline && rootClasses.indexOf(inline) === -1) rootClasses.push(inline);
  var worn = rootClasses.filter(function (c) {
    return new RegExp('<(?!html)[a-z]+[^>]*\\sclass="(?:[^"]*\\s)?' + c + '(?:\\s|")').test(html);
  });
  check("no class the scripts put on <html> (" + rootClasses.join(", ") + ") is also an element's class",
        rootClasses.length >= 4 && worn.length === 0, worn.join(", "));

  var scripts = [], r3 = /<script[^>]+src="([^"]+)"/g, z;
  while ((z = r3.exec(html))) scripts.push(z[1]);
  var gone = scripts.filter(function (s) { return !exists(s); });
  check("every script the page loads is on disk (" + scripts.length + ")", gone.length === 0, gone.join(", "));
  var unloaded = JS.filter(function (rel) { return scripts.indexOf(rel) === -1; });
  check("every script in static/home/js is loaded by the page", unloaded.length === 0, unloaded.join(", "));

  var lost = read("404.html"), lostScripts = [], r5 = /<script[^>]+src="\/([^"]+)"/g, v;
  while ((v = r5.exec(lost))) lostScripts.push(v[1]);
  var lostGone = lostScripts.filter(function (s2) { return !exists(s2); });
  check("every script the 404 page loads is on disk (" + lostScripts.length + ")", lostGone.length === 0, lostGone.join(", "));
})();

section("Static: the stylesheet");
(function () {
  var css = read(CSS).replace(/\/\*[\s\S]*?\*\//g, "");
  /* Body's overflow is handed to the viewport, where clip becomes hidden
     and the page stops scrolling; html's is the viewport's own. Either
     would also unpin the stage. */
  var bad = [], re = /(^|\})\s*((?:html|body)[^{]*)\{([^}]*)\}/g, m;
  while ((m = re.exec(css))) {
    var sel = m[2].trim();
    if (/^(html|body)(\s*,\s*(html|body))*$/.test(sel) && /overflow/.test(m[3])) bad.push(sel);
  }
  check("neither html nor body sets an overflow", bad.length === 0, bad.join(", "));

  /* The page and its 404 share this sheet; the fonts it names are the
     ones both pages ask Google for. */
  var fam = ["Inter+Tight", "JetBrains+Mono"];
  var lost = read("404.html");
  var noFont = fam.filter(function (f) { return html.indexOf(f) === -1 || lost.indexOf(f) === -1; });
  check("both pages load the two faces the stylesheet uses", noFont.length === 0 &&
        /"Inter Tight"/.test(css) && /"JetBrains Mono"/.test(css), noFont.join(", "));
})();

section("Static: the mark");
(function () {
  /* One geometry everywhere: the header, the footer, the 404 and the
     favicon all carry the same four outlines under the same transform, so
     the intro (which copies the header's) and the mark at the bottom
     (likewise) cannot drift either. */
  var groups = [];
  [["index.html", html], ["404.html", read("404.html")]].forEach(function (pair) {
    var re = /<g class="mark-word" transform="([^"]+)">([\s\S]*?)<\/g>/g, m;
    while ((m = re.exec(pair[1]))) groups.push({ where: pair[0], t: m[1], d: (m[2].match(/ d="([^"]+)"/g) || []).join("|") });
  });
  var fav = (html.match(/<link rel="icon" href="([^"]+)"/) || [])[1] || "";
  var favD = (fav.match(/ d='([^']+)'/g) || []).map(function (x) { return x.replace(/'/g, '"'); }).join("|");
  var favT = (fav.match(/<g transform='([^']+)'/) || [])[1];
  var first = groups[0] || { t: "", d: "" };
  var off = groups.filter(function (g) { return g.t !== first.t || g.d !== first.d; }).map(function (g) { return g.where; });
  check("the mark is drawn from one geometry in every copy (" + groups.length + " + the favicon)",
        groups.length >= 3 && first.d.split("|").length === 4 && off.length === 0 && favD === first.d && favT === first.t,
        off.join(", ") + (favD !== first.d || favT !== first.t ? " favicon" : ""));
})();

section("Static: custom properties");
(function () {
  /* Set from JavaScript per element or per frame, so they are never
     declared in the stylesheet — and every one of them has a fallback or a
     setter that is checked for below. */
  var DYNAMIC = ["glow", "i", "d", "k", "dev"];
  var css = read(CSS);
  var declared = {};
  var re = /(--[\w-]+)\s*:/g, m;
  while ((m = re.exec(css))) declared[m[1]] = true;
  var used = {}, r2 = /var\((--[\w-]+)/g, u;
  while ((u = r2.exec(css))) used[u[1]] = true;
  var undef = Object.keys(used).filter(function (k) {
    return !declared[k] && DYNAMIC.indexOf(k.slice(2)) === -1;
  });
  check("every custom property the stylesheet uses is declared or set by script", undef.length === 0, undef.join(", "));

  var js = JS.map(read).join("\n") + html;
  var unset = DYNAMIC.filter(function (k) {
    return js.indexOf('"--' + k + '"') === -1 && js.indexOf("--" + k + ":") === -1 && js.indexOf(";--" + k) === -1 && !declared["--" + k];
  });
  check("every property left to script is actually set somewhere", unset.length === 0, unset.join(", "));
})();

/* ============================================================
   2. The project list, run
   ============================================================ */

section("The projects");
(function () {
  var win = { matchMedia: function () { return { matches: false }; } };
  win.window = win;
  var ctx = vm.createContext({ window: win, performance: { now: function () { return 0; } } });
  vm.runInContext(read("static/home/js/projects.js"), ctx, { filename: "projects.js" });
  var NJ = win.NJ && win.NJ.projects;
  check("projects.js runs without a browser and exports the list", !!(NJ && NJ.projects && NJ.projects.length));
  if (!NJ) return;
  var P = NJ.projects;

  var src = read("static/home/js/projects.js");
  var motifs = {}, re = /\n {4}(\w+): function \(c, w, h, p, a\)/g, m;
  while ((m = re.exec(src))) motifs[m[1]] = true;
  var noMotif = P.filter(function (p) { return !motifs[p.motif]; }).map(function (p) { return p.name + " → " + p.motif; });
  check("every card's motif has a drawing (" + Object.keys(motifs).length + " motifs)", noMotif.length === 0, noMotif.join(", "));

  var missing = P.filter(function (p) { return !exists(p.href + "index.html"); }).map(function (p) { return p.href; });
  check("every card opens a folder with an index.html", missing.length === 0, missing.join(", "));

  var sitemap = read("sitemap.xml");
  var unlisted = P.filter(function (p) {
    return sitemap.indexOf("<loc>https://nojukuramu.github.io/" + p.href + "</loc>") === -1;
  }).map(function (p) { return p.href; });
  check("every project is in sitemap.xml", unlisted.length === 0, unlisted.join(", "));

  var badHex = P.filter(function (p) { return !/^#[0-9A-Fa-f]{6}$/.test(p.accent); }).map(function (p) { return p.name; });
  check("every accent is a six-digit hex (rgbOf splits it by position)", badHex.length === 0, badHex.join(", "));

  var names = {};
  var dup = P.filter(function (p) { var d = names[p.name]; names[p.name] = 1; return d; }).map(function (p) { return p.name; });
  check("no two cards share a name", dup.length === 0, dup.join(", "));

  var ids = NJ.filters.map(function (f) { return f.id; });
  var orphan = P.filter(function (p) { return ids.indexOf(p.kind) === -1; }).map(function (p) { return p.name + " (" + p.kind + ")"; });
  check("every card belongs to a filter", orphan.length === 0, orphan.join(", "));
  var empty = NJ.filters.filter(function (f) {
    return f.id !== "all" && !P.some(function (p) { return p.kind === f.id; });
  }).map(function (f) { return f.id; });
  check("no filter is empty", empty.length === 0, empty.join(", "));

  var thin = P.filter(function (p) { return p.hi.length !== 3 || !p.tags.length || !p.desc; }).map(function (p) { return p.name; });
  check("every card has a line, three highlights and some tags", thin.length === 0, thin.join(", "));

  /* The written-in fallbacks have to agree with the list, or a page
     without scripts says one number and the carousel another. */
  var word = (html.match(/data-projects-word>([^<]+)</) || [])[1];
  check("the heading counts the projects in words (" + word + ")", word === NJ.inWords(P.length),
        "says " + word + ", list has " + P.length + " (" + NJ.inWords(P.length) + ")");
  var stat = (html.match(/data-count-to="projects">(\d+)</) || [])[1];
  check("the stat says the same number", +stat === P.length, "says " + stat);
  var total = (html.match(/id="info-total">(\d+)</) || [])[1];
  check("the wheel's counter starts with the same total", +total === P.length, "says " + total);
  var spec = (html.match(/data-projects-num>(\d+)</) || [])[1];
  check("the spec sheet says the same number", +spec === P.length, "says " + spec);

  /* What the wheel shows before its script has run is the first project,
     written in; it has to be the first project. */
  var name = (html.match(/id="info-name">([^<]+)</) || [])[1];
  var href = (html.match(/id="info-open" href="([^"]+)"/) || [])[1];
  check("the wheel's written-in frame is the first project (" + name + ")", name === P[0].name && href === P[0].href,
        "says " + name + " → " + href);

  /* The dial's engravings are a fifteenth of a turn apart. Past about
     nineteen projects the names stop fitting and are dropped; past forty
     the numbers would touch. */
  check("the dial has room for every number (" + P.length + " of at most 40)", P.length <= 40);
})();

/* ============================================================
   Result
   ============================================================ */
process.stdout.write("\n" + (failures.length ? "FAILED" : "PASSED") +
  " — " + (checks - failures.length) + "/" + checks + " checks\n");
if (failures.length) {
  failures.forEach(function (f) { process.stdout.write("  - " + f + "\n"); });
  process.exit(1);
}

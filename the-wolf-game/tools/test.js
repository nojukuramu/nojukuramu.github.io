/* test.js — run every suite in one go.
 *
 * Run: node tools/test.js            everything, browsers included
 *      node tools/test.js --fast     only the suites that need no browser
 *      node tools/test.js --only e2e run the suites whose name contains "e2e"
 *      node tools/test.js --verbose  stream each suite's own output through
 *
 * Each suite is its own process, because that is how they were written and how
 * a person runs them: nothing here loads the game, it only reads the two lines
 * every suite already prints. A suite that fails has its ✗ lines quoted back so
 * the failure is on screen without a second command.
 */
"use strict";
var cp = require("child_process"), path = require("path"), fs = require("fs");

var TOOLS = __dirname;

var SUITES = [
  { name: "engine",            file: "engine-test.js",           browser: false, note: "the engine, no browser and no network" },
  { name: "role-interaction",  file: "role-interaction-test.js", browser: false, note: "96 role-interaction cases; also an audit" },
  { name: "consistency",       file: "consistency.js",           browser: false, note: "drift between files that must agree" },
  { name: "version",           file: "version-check.js",         browser: false, note: "one version number, three files" },
  { name: "fit",               file: "fit-test.js",              browser: true,  note: "12 viewports, nothing may overflow" },
  { name: "render",            file: "render-test.js",           browser: true,  note: "a repaint keeps the reader's place" },
  { name: "sound",             file: "sound-test.js",            browser: true,  note: "every voice renders real audio" },
  { name: "e2e",               file: "e2e.js",                   browser: true,  note: "four real browsers, one real room" }
];

var argv = process.argv.slice(2);
var fast = argv.indexOf("--fast") >= 0 || argv.indexOf("--headless") >= 0;
var verbose = argv.indexOf("--verbose") >= 0 || argv.indexOf("-v") >= 0;
var onlyAt = argv.indexOf("--only");
var only = onlyAt >= 0 ? (argv[onlyAt + 1] || "") : null;

/* Playwright lives at an absolute path in the four browser suites. If it is not
 * there, those suites are skipped rather than reported as failures — a machine
 * without a browser is not a broken build. */
var PLAYWRIGHT = "/opt/node22/lib/node_modules/playwright";
var haveBrowser = fs.existsSync(PLAYWRIGHT);

function fmt(ms) {
  return ms < 1000 ? ms + "ms" : (ms / 1000).toFixed(1) + "s";
}
function pad(s, n) { while (s.length < n) s += " "; return s; }

var results = [], totalPass = 0, totalFail = 0, ran = 0, skipped = 0;

console.log("\nthe wolf game — " + (fast ? "headless suites" : "every suite") + "\n");

SUITES.forEach(function (s) {
  if (only && s.name.indexOf(only) < 0 && s.file.indexOf(only) < 0) return;

  if (s.browser && (fast || !haveBrowser)) {
    skipped++;
    console.log("  – " + pad(s.name, 17) + "skipped  (" + (fast ? "--fast" : "no playwright at " + PLAYWRIGHT) + ")");
    results.push({ name: s.name, skipped: true });
    return;
  }

  var started = Date.now();
  var run = cp.spawnSync(process.execPath, [path.join(TOOLS, s.file)], {
    cwd: path.join(TOOLS, ".."),
    encoding: "utf8",
    stdio: verbose ? "inherit" : "pipe",
    timeout: 10 * 60 * 1000
  });
  var took = Date.now() - started;
  var out = verbose ? "" : ((run.stdout || "") + (run.stderr || ""));
  ran++;

  /* Every suite ends with the same line, which is the only contract this
   * runner depends on. A suite that dies before printing it is a failure
   * whatever its exit code says. */
  var m = /(\d+) passed, (\d+) failed/.exec(out);
  var passed = m ? +m[1] : 0, failed = m ? +m[2] : 0;
  totalPass += passed; totalFail += failed;

  var died = run.status !== 0 || (!m && !verbose);
  var bad = failed > 0 || died;

  var line = "  " + (bad ? "✗" : "✓") + " " + pad(s.name, 17);
  if (m) line += pad(passed + " passed" + (failed ? ", " + failed + " failed" : ""), 22);
  else line += pad(died ? "did not finish" : "ran", 22);
  line += pad(fmt(took), 8) + "  " + s.note;
  console.log(line);

  /* A findings count is the role-interaction suite's second line: bugs it
   * reproduces on purpose without failing the build. Worth surfacing here so
   * nobody has to remember to go and look. */
  var f = /(\d+) findings still reproduce, (\d+) look fixed, (\d+) questions/.exec(out);
  if (f) console.log("      " + f[1] + " findings reproduce, " + f[2] + " look fixed, " + f[3] + " open questions  (tools/ROLE-INTERACTIONS.md)");

  if (bad && !verbose) {
    var bads = out.split("\n").filter(function (l) { return l.indexOf("✗") >= 0; });
    bads.slice(0, 20).forEach(function (l) { console.log("      " + l.trim()); });
    if (bads.length > 20) console.log("      … and " + (bads.length - 20) + " more");
    if (!bads.length) {
      console.log(out.split("\n").slice(-15).map(function (l) { return "      " + l; }).join("\n"));
    }
  }

  results.push({ name: s.name, passed: passed, failed: failed, died: died, bad: bad });
});

var broken = results.filter(function (r) { return r.bad; });
console.log("");
console.log(totalPass + " passed, " + totalFail + " failed across " + ran + " suite" + (ran === 1 ? "" : "s") +
            (skipped ? " (" + skipped + " skipped)" : "") + ".");
if (broken.length) console.log("failing: " + broken.map(function (r) { return r.name; }).join(", "));
console.log("");

process.exit(broken.length ? 1 : 0);

#!/usr/bin/env node
/* ============================================================
   Ballzooka — the game, played in a real browser
   `node tools/e2e.js [--shots <dir>]`

   The shape is Bloomworks' tools/e2e.js: serve the folder, open it in
   Chromium (WebGL through SwiftShader), play it the way a person would, and fail on anything a person
   would notice — including any error in the console.

   On a phone (touch): the title is up; Level 1 starts; a drag moves the
   cannon; the stream multiplies through a gate; a perk is drafted by a tap;
   pause and resume; a cleared level shows its stars, the wheel stops and
   pays; the shop sells an upgrade; a skin is bought and worn; a lost level
   offers a free revive that works; Endless and the Daily start; the save
   survives a reload. On a computer: the cannon follows the mouse and the
   arrow keys, and Escape pauses.
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
for (const where of ["playwright", "/opt/node22/lib/node_modules/playwright", "/opt/node-tools/node_modules/playwright", "playwright-core"]) {
  try { ({ chromium } = require(where)); break; } catch (e) { /* next */ }
}
if (!chromium) { console.log("playwright is not installed here; skipping the browser pass."); process.exit(0); }

const ROOT = path.join(__dirname, "..");
const shotsAt = process.argv.indexOf("--shots") > 0 ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const failures = [];
let checks = 0;
function check(name, cond, detail) { checks++; if (cond) process.stdout.write("  \u2713 " + name + "\n"); else { failures.push(name + (detail ? " — " + detail : "")); process.stdout.write("  \u2717 " + name + (detail ? " — " + detail : "") + "\n"); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { r.writeHead(403); r.end(); return; }
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); r.end(d); });
});

/* Fast-forward the running level inside the page, standing under the best
   gate, so a test does not wait out a level in real time. */
function forward(p, secs) {
  return p.evaluate((secs) => {
    const { sim } = window.__bz, g = window.__bz.g;
    for (let i = 0; i < secs * 60 && (g.state === "play" || g.state === "draft"); i++) {
      if (g.state === "draft") sim.choosePerk(g, 0);
      let best = null, low = null;
      for (const gt of g.gates) if (gt.op === "mul" && (!best || gt.v > best.v)) best = gt;
      for (const e of g.enemies) if (e.kind !== "gold" && (!low || e.y > low.y)) low = e;
      if (low && low.y > 400) g.cannon.tx = low.x;
      else if (best) g.cannon.tx = best.x;
      sim.step(g, 1 / 60);
    }
    return g.state;
  }, secs);
}

(async () => {
  await new Promise((res) => server.listen(0, res));
  const url = "http://localhost:" + server.address().port + "/";
  // WebGL through SwiftShader, so it runs headless
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const errors = [];
  const watch = (p) => { p.on("pageerror", (e) => errors.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); }); };
  const shot = async (p, name) => { if (shotsAt) { fs.mkdirSync(shotsAt, { recursive: true }); await p.screenshot({ path: path.join(shotsAt, name + ".png") }); } };
  const ev = (p, fn, arg) => p.evaluate(fn, arg);
  const click = (p, sel) => p.dispatchEvent(sel, "click");

  process.stdout.write("\nA phone\n");
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  watch(p);
  await p.goto(url);
  await p.waitForFunction(() => window.__bz && window.__bz.S);
  await wait(500);
  check("the title is up, offering level 1", await p.isVisible('#screen [data-act="play"][data-arg="campaign"]') && (await p.textContent("#screen")).includes("LEVEL 1"));
  await shot(p, "phone-title");

  await click(p, '#screen [data-act="play"][data-arg="campaign"]');
  await wait(300);
  check("Level 1 starts with the HUD up", await p.isVisible("#hud") && !(await p.isVisible("#screen")) && await ev(p, () => window.__bz.g.level === 1));

  // a drag anywhere moves the cannon, relative to where the finger started
  const x0 = await ev(p, () => window.__bz.g.cannon.x);
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
  await touch("touchStart", 200, 300);
  for (let i = 1; i <= 8; i++) { await touch("touchMove", 200 - i * 12, 300); await wait(16); }
  await touch("touchEnd");
  await wait(400);
  check("a drag moves the cannon", (await ev(p, () => window.__bz.g.cannon.x)) < x0 - 40, x0 + " → " + await ev(p, () => window.__bz.g.cannon.x));

  // the stream multiplies through a gate
  const mult = await ev(p, () => {
    const { sim } = window.__bz, g = window.__bz.g;
    const gt = g.gates.find((x) => x.op === "mul" && x.v > 1);
    if (!gt) return "no gate";
    g.cannon.x = g.cannon.tx = gt.x;
    const fired0 = g.fired;
    for (let i = 0; i < 90; i++) sim.step(g, 1 / 60);
    return g.ballCount > (g.fired - fired0) * 0.6 ? true : g.ballCount + " vs " + (g.fired - fired0);
  });
  check("balls through a × gate multiply", mult === true, mult);
  await shot(p, "phone-play");

  // a perk, drafted by a tap
  await ev(p, () => { const g = window.__bz.g; g.pendingDrafts = 1; });
  await wait(300);
  check("the XP bar opens a draft of three", (await p.$$('#screen [data-act="perk"]')).length === 3);
  await shot(p, "phone-draft");
  await click(p, '#screen [data-act="perk"][data-arg="1"]');
  await wait(200);
  check("tapping a card takes the perk and resumes", await ev(p, () => window.__bz.g.state === "play" && Object.keys(window.__bz.g.perks).length === 1) && !(await p.isVisible("#screen")));

  await click(p, "#pauseBtn");
  await wait(200);
  check("pause stops the field", await p.isVisible('#screen [data-act="resume"]'));
  const t0 = await ev(p, () => window.__bz.g.t);
  await wait(300);
  check("and time stands still", (await ev(p, () => window.__bz.g.t)) === t0);
  await click(p, '#screen [data-act="resume"]');
  await wait(300);
  check("resume carries on", (await ev(p, () => window.__bz.g.t)) > t0);

  // clear the level
  await ev(p, () => { const g = window.__bz.g; g.s.dmg *= 20; g.s.rate *= 3; g.hearts = g.maxHearts = 9; });
  const st = await forward(p, 300);
  await wait(1300);
  check("the level is cleared", st === "won" && await p.isVisible('#screen [data-act="stopWheel"]'), st);
  check("with stars", (await p.$$("#screen .star.on")).length >= 1);
  const coins0 = await ev(p, () => window.__bz.S.coins);
  await shot(p, "phone-won");
  await click(p, '#screen [data-act="stopWheel"]');
  await wait(300);
  check("the wheel stops and pays", (await ev(p, () => window.__bz.S.coins)) >= coins0 + 2 * (await ev(p, () => window.__bz.g.coins)) && await p.isVisible('#screen [data-act="next"]'));
  check("the next level is unlocked", await ev(p, () => window.__bz.S.level === 2));

  // the shop
  await click(p, '#screen [data-act="quit"]');
  await wait(200);
  await ev(p, () => { window.__bz.S.coins += 5000; });
  await click(p, '#screen [data-act="go"][data-arg="shop"]');
  await wait(200);
  await click(p, '#screen [data-act="buy"][data-arg="rate"]');
  await wait(200);
  check("the shop sells an upgrade", await ev(p, () => window.__bz.S.upg.rate === 1));
  await shot(p, "phone-shop");
  await click(p, '#screen [data-act="home"]');
  await click(p, '#screen [data-act="go"][data-arg="skins"]');
  await wait(200);
  await click(p, '#screen [data-act="skin"][data-arg="ball:candy"]');
  await wait(200);
  check("a skin is bought and worn", await ev(p, () => window.__bz.S.ball === "candy" && window.__bz.S.owned.balls.includes("candy")));
  await click(p, '#screen [data-act="home"]');

  // lose, and get back up
  await click(p, '#screen [data-act="play"][data-arg="campaign"]');
  await wait(200);
  await ev(p, () => { const g = window.__bz.g; g.s.dmg = 0.0001; g.s.volley = 1; });
  const lost = await ev(p, () => {
    const { sim } = window.__bz, g = window.__bz.g;
    for (let i = 0; i < 60 * 300 && g.state !== "lost"; i++) { if (g.state === "draft") sim.choosePerk(g, 0); sim.step(g, 1 / 60); }
    return g.state;
  });
  await wait(1000);
  check("running out of hearts ends the level", lost === "lost" && await p.isVisible('#screen [data-act="revive"]'), lost);
  await shot(p, "phone-lost");
  await click(p, '#screen [data-act="revive"]');
  await wait(200);
  check("a free revive puts you back in", await ev(p, () => window.__bz.g.state === "play" && window.__bz.g.hearts > 0 && window.__bz.S.ach.revive));
  await click(p, "#pauseBtn");
  await click(p, '#screen [data-act="quit"]');
  await wait(200);

  await click(p, '#screen [data-act="play"][data-arg="endless"]');
  await wait(300);
  check("Endless starts", await ev(p, () => window.__bz.g.mode === "endless") && (await p.textContent("#lvlTxt")).includes("ENDLESS"));
  await click(p, "#pauseBtn");
  await click(p, '#screen [data-act="quit"]');
  await click(p, '#screen [data-act="play"][data-arg="daily"]');
  await wait(300);
  check("the Daily starts with its twist", await ev(p, () => window.__bz.g.mode === "daily" && !!window.__bz.g.mod));
  await shot(p, "phone-daily");
  await click(p, "#pauseBtn");
  await click(p, '#screen [data-act="quit"]');

  const before = await ev(p, () => ({ level: window.__bz.S.level, rate: window.__bz.S.upg.rate, ball: window.__bz.S.ball }));
  await p.reload();
  await p.waitForFunction(() => window.__bz && window.__bz.S);
  check("the save survives a reload", await ev(p, (b) => { const S = window.__bz.S; return S.level === b.level && S.upg.rate === b.rate && S.ball === b.ball; }, before));
  await click(p, '#screen [data-act="go"][data-arg="settings"]');
  await wait(200);
  check("settings carry the version line", (await p.textContent("#screen")).includes("Ballzooka " + await ev(p, () => window.BZ_VERSION)));
  await click(p, '#screen [data-info="privacy"]');
  await wait(200);
  check("an (i) opens its sheet", await p.isVisible("#info-sheet") && (await p.textContent("#info-title")).length > 0);
  await ctx.close();

  process.stdout.write("\nA computer\n");
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const d = await ctx2.newPage();
  watch(d);
  await d.goto(url);
  await d.waitForFunction(() => window.__bz && window.__bz.S);
  await click(d, '#screen [data-act="play"][data-arg="campaign"]');
  await wait(300);
  await d.mouse.move(400, 400);
  await wait(400);
  const left = await ev(d, () => window.__bz.g.cannon.x);
  await d.mouse.move(880, 400);
  await wait(400);
  const right = await ev(d, () => window.__bz.g.cannon.x);
  check("the cannon follows the mouse", right > left + 100, left + " → " + right);
  await d.keyboard.down("ArrowLeft"); await wait(500); await d.keyboard.up("ArrowLeft");
  check("the arrow keys move it", (await ev(d, () => window.__bz.g.cannon.x)) < right - 50);
  await forward(d, 8);
  await wait(200);
  await shot(d, "desktop");
  await d.keyboard.press("Escape");
  await wait(200);
  check("Escape pauses", await d.isVisible('#screen [data-act="resume"]'));
  await ctx2.close();

  check("no errors in the console", !errors.length, errors.slice(0, 5).join(" | "));
  await browser.close();
  server.close();
  process.stdout.write("\n" + (failures.length ? failures.length + " of " + checks + " checks FAILED:\n  " + failures.join("\n  ") : checks + "/" + checks + " checks passed") + "\n");
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); try { server.close(); } catch (x) { /* already closed */ } process.exit(1); });

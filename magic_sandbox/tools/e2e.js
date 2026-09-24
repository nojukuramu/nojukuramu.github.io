#!/usr/bin/env node
/* ============================================================
   Magic Sandbox — the game in a real browser
   `node tools/e2e.js [--shots <dir>]`

   tools/validate.js proves the grammar and the wiring. It cannot prove that
   a floor actually ends, that a Warden wakes when you walk into its ring,
   that dying offers your landing back, or that a thumb on a phone moves the
   mage. This drives Chromium through all of that, from the title to a
   retried landing, on a desktop window and on a phone held upright.

   Same shape as komyut/tools/e2e.js: the folder is served from disk by a
   tiny local server, nothing reaches the network, and the run is skipped
   (not failed) where Playwright is not installed. Graphics are set to Low
   first, because a CI box renders WebGL in software and bloom there costs
   seconds a frame. Every wait is on a condition, never on a clock.

   The page's debug handle (window.MS) is switched on through the same
   localStorage flag a developer would use; it is never on by default.
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
for (const where of ["playwright", path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "playwright")]) {
  try { ({ chromium } = require(where)); break; } catch (e) {}
}
if (!chromium) {
  console.log("playwright is not installed here; skipping the browser pass.");
  process.exit(0);
}

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".glb": "model/gltf-binary", ".webmanifest": "application/manifest+json" };
const SHOT_DIR = (() => { const i = process.argv.indexOf("--shots"); return i === -1 ? null : (process.argv[i + 1] || path.join(ROOT, "shots")); })();
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });

let failures = 0, checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) console.log("  ✓ " + name);
  else { failures++; console.log("  ✗ " + name + (detail !== undefined ? " — " + detail : "")); }
}

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split("?")[0].split("#")[0]);
      const file = path.join(ROOT, u === "/" ? "index.html" : u);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function open(browser, base, opts) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 960, height: 540 }, serviceWorkers: "block" }, opts || {}));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("request", (r) => { if (!r.url().startsWith(base) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) errors.push("unexpected request " + r.url()); });
  await page.addInitScript(() => {
    localStorage.setItem("msandbox:debug", "1");
    if (!localStorage.getItem("msandbox:v2")) localStorage.setItem("msandbox:v2", JSON.stringify({ settings: { quality: "low", music: 0, sfx: 0 } }));
  });
  await page.goto(base + "/index.html");
  await page.waitForFunction(() => window.MS && window.MS.S.mode === "title", null, { timeout: 60000 });
  return { ctx, page, errors };
}
/* Wait for a condition. A level-up can open the boon cards (and pause the
   game) at any moment, exactly as it would for a player, so unless a step is
   waiting on the cards themselves, any that appear are taken on the way. */
async function until(page, fn, arg, t, keepCards) {
  const end = Date.now() + (t || 60000);
  for (;;) {
    if (await page.evaluate(fn, arg)) return;
    if (!keepCards && await page.evaluate(() => !document.getElementById("scr-boons").hidden)) await page.click("#boonCards .card").catch(() => {});
    if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 120));
    await page.waitForTimeout(250);
  }
}
async function shot(page, name) { if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, name + ".png") }); }
async function takeBoons(page) {
  for (let i = 0; i < 10; i++) {
    const open = await page.evaluate(() => !document.getElementById("scr-boons").hidden);
    if (!open) return;
    await page.click("#boonCards .card");
  }
}

(async function main() {
  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  try {
    /* ---------------- desktop ---------------- */
    console.log("\nDesktop: the title and the spellbook");
    let { ctx, page, errors } = await open(browser, base);
    await shot(page, "01-title");
    check("the title offers a new climb", await page.isVisible("#btnNew"));
    check("with no landing, there is nothing to continue", !(await page.isVisible("#btnContinue")));
    await page.click("#btnBookTitle");
    await until(page, () => !document.getElementById("book").hidden);
    const before = await page.textContent("#readout .rname b");
    await page.click('#stamps [data-el="water"]');
    const after = await page.textContent("#readout .rname b");
    check("stamping water onto Ember Bolt makes it Steam", /Steam/.test(after), before + " -> " + after);
    await page.click("#toolUndo");
    check("undo brings the page back", (await page.textContent("#readout .rname b")) === before);
    await shot(page, "02-spellbook");
    await page.click("#bookClose");
    check("closing the book returns to the title", await page.isVisible("#btnNew"));
    await page.click('[data-info="howto"]');
    check("an (i) opens its explanation", (await page.textContent("#info-title")) === "How to play");
    await page.click("#info-close");

    console.log("\nDesktop: a climb");
    await page.click("#btnNew");
    await until(page, () => window.MS.S.mode === "run" && window.MS.S.player && !document.getElementById("hud").hidden && document.getElementById("objective").textContent);
    check("the HUD is up", await page.isVisible("#hud"));
    check("floor 1 asks for three Anchors", /Anchors 0\/3/.test(await page.textContent("#objective")));
    check("arriving on floor 1 records a landing", await page.evaluate(() => window.MS.save.data.landing && window.MS.save.data.landing.floor === 1));
    await page.mouse.move(600, 200);
    await page.mouse.down();
    await until(page, () => window.MS.S.shots.length > 0 || window.MS.S.player.mana < window.MS.S.player.maxMana - 1);
    await page.mouse.up();
    check("holding the button casts, and casting costs mana", await page.evaluate(() => window.MS.S.player.mana < window.MS.S.player.maxMana));
    await shot(page, "03-floor1");
    await page.evaluate(async () => { const S = window.MS.S; S.player.iframe = 1e9; const m = await import("./js/enemies.js"); for (const e of [...S.enemies]) if (e.type === "anchor") m.hurtEnemy(e, 1e6); });
    await until(page, () => window.MS.S.portal && window.MS.S.portal.on);
    check("three severed Anchors open the portal", true);
    await page.evaluate(() => { const S = window.MS.S; S.player.x = S.portal.x; S.player.z = S.portal.z; });
    await until(page, () => window.MS.S.floor === 2 || !document.getElementById("scr-boons").hidden);
    await takeBoons(page);
    await until(page, () => window.MS.S.floor === 2);
    check("the portal leads to floor 2, a Warden's floor", /Warden/.test(await page.textContent("#objective")));
    // arriving on a floor resets i-frames, so the test mage is made untouchable again
    await page.evaluate(() => { const S = window.MS.S, A = S.world.arena; S.player.iframe = 1e9; S.player.x = A.x + 5; S.player.z = A.z; });
    await until(page, () => window.MS.S.boss && window.MS.S.boss.state !== "sleep");
    check("walking into the ring wakes the Warden", await page.isVisible("#bossBar"));
    await until(page, () => window.MS.S.boss && !["sleep", "intro"].includes(window.MS.S.boss.state));
    await shot(page, "04-warden");
    await page.evaluate(async () => { const S = window.MS.S; const m = await import("./js/enemies.js"); m.hurtEnemy(S.boss, 1e6); });
    await until(page, () => !window.MS.S.boss && window.MS.S.portal.on);
    await until(page, () => !document.getElementById("scr-boons").hidden, null, 20000, true).catch(() => {});
    check("the Warden's fall offers a boon", await page.isVisible("#scr-boons"));
    await takeBoons(page);
    await page.evaluate(() => { const S = window.MS.S; const t = S.pickups.find((q) => q.type === "thread"); S.player.x = t.x; S.player.z = t.z; });
    await until(page, () => window.MS.S.player.rank === 2);
    check("its thread raises the circle to rank 2", true);
    await page.evaluate(() => { const S = window.MS.S; S.player.x = S.portal.x; S.player.z = S.portal.z; });
    await until(page, () => window.MS.S.floor === 3 || !document.getElementById("scr-boons").hidden);
    await takeBoons(page);
    await until(page, () => window.MS.S.floor === 3);
    check("floor 3 is a new landing", await page.evaluate(() => window.MS.save.data.landing.floor === 3 && window.MS.save.data.landing.rank === 2));
    await page.evaluate(() => { const P = window.MS.S.player; P.iframe = 0; P.hurt(1e6, 0, "a test"); });
    await until(page, () => !document.getElementById("scr-death").hidden);
    await shot(page, "05-death");
    check("a fall offers the landing back", /floor 3/.test(await page.textContent("#btnRetry")));
    await page.click("#btnRetry");
    await until(page, () => window.MS.S.player && window.MS.S.player.alive && window.MS.S.floor === 3);
    check("retrying keeps the rank you arrived with", await page.evaluate(() => window.MS.S.player.rank === 2));
    await page.keyboard.press("Escape");
    check("Escape pauses", await page.isVisible("#scr-pause"));
    await page.click("#btnPauseSettings");
    await page.selectOption("#setQuality", "medium");
    check("a setting is remembered", await page.evaluate(() => JSON.parse(localStorage.getItem("msandbox:v2") || "{}").settings.quality === "medium" || window.MS.save.settings.quality === "medium"));
    await page.click("#btnSettingsBack");
    page.once("dialog", (d) => d.accept());
    await page.click("#btnQuit");
    await until(page, () => window.MS.S.mode === "title");
    check("leaving returns to the title, which now offers to continue", await page.isVisible("#btnContinue"));
    check("no errors on the desktop pass", errors.length === 0, errors.slice(0, 5).join(" | "));
    await ctx.close();

    console.log("\nDesktop: the sandbox");
    ({ ctx, page, errors } = await open(browser, base));
    await page.click("#btnSandbox");
    await until(page, () => window.MS.S.mode === "sandbox" && window.MS.S.player);
    check("the sandbox runs at rank 5", await page.evaluate(() => window.MS.S.player.rank === 5));
    check("the spawn panel is there", await page.isVisible('#sandboxPanel [data-spawn="knot"]'));
    await page.click('#sandboxPanel [data-spawn="knot"]');
    check("it summons what you ask for", await page.evaluate(() => window.MS.S.enemies.some((e) => e.type === "knot" && e.alive)));
    await page.evaluate(async () => {
      const S = window.MS.S, m = await import("./js/enemies.js");
      for (const e of S.enemies) if (e.type === "dummy") m.hurtEnemy(e, 50);
    });
    await until(page, () => /[1-9]/.test(document.getElementById("dps").textContent));
    check("dummies report damage per second", true);
    await shot(page, "06-sandbox");
    check("no errors in the sandbox", errors.length === 0, errors.slice(0, 5).join(" | "));
    await ctx.close();

    /* ---------------- phone ---------------- */
    console.log("\nPhone, held upright");
    ({ ctx, page, errors } = await open(browser, base, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }));
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    check("the title fits without sideways scrolling", await fits());
    await page.tap("#btnNew");
    await until(page, () => window.MS.S.mode === "run" && window.MS.S.player && !document.getElementById("touchUI").hidden);
    check("the touch controls are up", await page.isVisible("#tDash"));
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id })) });
    const z0 = await page.evaluate(() => window.MS.S.player.z);
    await touch("touchStart", [[90, 620, 1]]);
    for (let i = 1; i <= 6; i++) await touch("touchMove", [[90, 620 - i * 10, 1]]);
    await until(page, (z) => window.MS.S.player.z < z - 1, z0);
    check("a left thumb moves the mage", true);
    await touch("touchStart", [[90, 560, 1], [300, 620, 2]]);
    await until(page, () => window.MS.S.shots.length > 0 || window.MS.S.player.mana < window.MS.S.player.maxMana - 1);
    check("a right thumb held still casts at the nearest enemy", true);
    await touch("touchEnd", []);
    await shot(page, "07-phone");
    await page.tap("#btnBook");
    await until(page, () => !document.getElementById("book").hidden);
    const done = await page.locator("#bookClose").boundingBox();
    check("the spellbook's Done button is on screen", done && done.x + done.width <= 390 && done.y >= 0, JSON.stringify(done));
    const tools = await page.locator("#bookTools").boundingBox();
    check("the drawing tools fit the width", tools && tools.x >= 0 && tools.x + tools.width <= 390, JSON.stringify(tools));
    check("the spellbook fits without sideways scrolling", await fits());
    await shot(page, "08-phone-book");
    await page.tap("#bookClose");
    check("no errors on the phone", errors.length === 0, errors.slice(0, 5).join(" | "));
    await ctx.close();

    console.log("\nPhone, held sideways");
    ({ ctx, page, errors } = await open(browser, base, { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true }));
    await page.tap("#btnNew");
    await until(page, () => window.MS.S.mode === "run" && window.MS.S.player && !document.getElementById("touchUI").hidden);
    const dash = await page.locator("#tDash").boundingBox();
    check("dash sits inside the screen", dash && dash.y + dash.height <= 390 && dash.x + dash.width <= 844);
    await page.tap("#btnBook");
    await until(page, () => !document.getElementById("book").hidden);
    const t2 = await page.locator("#bookTools").boundingBox();
    check("the drawing tools fit the height", t2 && t2.y + t2.height <= 390, JSON.stringify(t2));
    await shot(page, "09-landscape-book");
    check("no errors sideways", errors.length === 0, errors.slice(0, 5).join(" | "));
    await ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  console.log("\n" + checks + " checks, " + failures + " failed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

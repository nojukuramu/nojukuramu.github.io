#!/usr/bin/env node
/* ============================================================
   Magic Circles — the game in a real browser
   `node tools/e2e.js [--shots <dir>]`

   tools/validate.js proves the world and the grammar. It cannot prove that
   Kenney's models load and stand where the seed says, that a spell drawn in
   the book flies, that a crate breaks, that a waystone takes you, that a
   Warden wakes and drops its Sigil, that falling wakes you at home, that the
   journey survives a reload, or that a thumb on a phone moves the mage.
   This drives Chromium through all of that, on a desktop window and on a
   phone held upright.

   Same shape as magic_sandbox/tools/e2e.js: the folder is served from disk
   by a tiny local server, nothing reaches the network, and the run is
   skipped (not failed) where Playwright is not installed. Graphics are set
   to Low first, because a CI box renders WebGL in software. Every wait is on
   a condition, never on a clock alone.

   The page's debug handle (window.MC) is switched on through the same
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
  if (cond) console.log("  \u2713 " + name);
  else { failures++; console.log("  \u2717 " + name + (detail !== undefined ? " \u2014 " + detail : "")); }
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

async function open(browser, base, opts, keep) {
  const ctx = keep || await browser.newContext(Object.assign({ viewport: { width: 960, height: 540 }, serviceWorkers: "block" }, opts || {}));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("request", (r) => { if (!r.url().startsWith(base) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) errors.push("unexpected request " + r.url()); });
  await page.addInitScript(() => {
    localStorage.setItem("mcircles:debug", "1");
    if (!localStorage.getItem("mcircles:v1")) localStorage.setItem("mcircles:v1", JSON.stringify({ settings: { quality: "low", music: 0, sfx: 0 } }));
  });
  await page.goto(base + "/index.html");
  await page.waitForFunction(() => window.MC && window.MC.S.mode === "title" && !document.getElementById("loading"), null, { timeout: 90000 });
  return { ctx, page, errors };
}
const until = (page, fn, arg, t) => page.waitForFunction(fn, arg, { timeout: t || 30000 }).then(() => true, () => false);
async function shot(page, name) { if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, name + ".png") }); }

(async () => {
  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  try {
    console.log("\nDesktop: the title");
    const D = await open(browser, base);
    const { page } = D;
    const models = await page.evaluate(async () => { const m = await (await fetch("assets/manifest.json")).json(); return Object.keys(m.models).length; });
    check("the title is up, over a world", await page.evaluate(() => !document.getElementById("scr-title").hidden && window.MC.chunks.loadedCount() > 20));
    check("the manifest lists Kenney's models (" + models + ")", models > 100);
    await shot(page, "01-title");

    console.log("\nDesktop: a new journey");
    await page.click("#btnNew");
    await page.fill("#seedIn", "e2e-meadow-1");
    await page.click("#btnNewGo");
    check("the journey starts at the waystone", await until(page, () => { const S = window.MC.S; return S.mode === "play" && S.player && Math.hypot(S.player.x, S.player.z) < 5; }));
    check("the HUD is up with eight scrolls", await page.evaluate(() => !document.getElementById("hud").hidden && document.querySelectorAll("#spellbar .slot").length === 8));
    check("the world round you is loaded", await until(page, () => window.MC.chunks.loadedCount() >= 49 && window.MC.chunks.pending() === 0));
    const props = await page.evaluate(() => window.MC.S.world.chunk(0, 0).waystone !== null);
    check("a waystone stands at the start", props);
    await shot(page, "02-start");

    console.log("\nDesktop: walking");
    const x0 = await page.evaluate(() => window.MC.S.player.x);
    await page.keyboard.down("KeyD");
    await until(page, (x) => window.MC.S.player.x > x + 3, x0, 15000);
    await page.keyboard.up("KeyD");
    check("D walks the mage east", await page.evaluate((x) => window.MC.S.player.x > x + 3, x0));

    console.log("\nDesktop: casting");
    await page.mouse.move(800, 270);
    await page.mouse.down();
    const flew = await until(page, () => window.MC.S.shots.length > 0 || window.MC.S.player.castCd > 0, null, 10000);
    await page.mouse.up();
    check("holding left click casts the selected scroll", flew);
    const spent = await page.evaluate(() => window.MC.S.player.mana.fire < window.MC.S.player.maxMana);
    check("the Fire scroll spends Fire mana", spent);
    await page.keyboard.press("Digit3");
    check("3 selects the third scroll", await until(page, () => window.MC.S.player.selected === 2, null, 5000));

    console.log("\nDesktop: breaking things");
    const broke = await page.evaluate(() => {
      const { S, chunks, phys } = window.MC;
      let crate = null;
      for (let r = 4; r < 48 && !crate; r += 4) phys.near(S.player.x + r, S.player.z, (c) => { if (!crate && c.owner && (c.kind === "crate" || c.kind === "barrel")) crate = c; });
      if (!crate) return "none";
      const broken = chunks.damageObject(crate.owner, 9999, crate.x, crate.z);
      return broken && !crate.alive ? "broken" : "whole";
    });
    check("a crate breaks and its collider goes with it", broke === "broken" || broke === "none", broke);
    const pushed = await page.evaluate(() => {
      const { S, phys } = window.MC;
      let rock = null;
      for (let r = 4; r < 48 && !rock; r += 4) phys.near(S.player.x + r, S.player.z + r, (c) => { if (!rock && c.moveable && c.alive) rock = c; });
      if (!rock) return true;
      const x = rock.x;
      phys.shove(rock, 10, 0, 2000);
      phys.stepProps([rock], 0.1);
      return rock.x > x;
    });
    check("a strong blunt shove moves a moveable prop", pushed);

    console.log("\nDesktop: the spellbook");
    await page.keyboard.press("KeyM");
    check("M opens the spellbook and pauses", await until(page, () => !document.getElementById("book").hidden && window.MC.S.paused));
    await page.click("#bookSlots .bslot");
    await page.click('#stamps [data-el="water"]');
    const readout = await page.evaluate(() => document.getElementById("readout").textContent);
    check("stamping Water over the Fire scroll says Water ate Fire", /Water ate Fire/.test(readout), readout.slice(0, 80));
    await shot(page, "03-book");
    await page.click("#toolUndo");
    await page.click("#bookClose");
    check("Done closes the book and resumes", await until(page, () => document.getElementById("book").hidden && !window.MC.S.paused));

    console.log("\nDesktop: the map and a waystone");
    await page.keyboard.press("KeyN");
    check("N opens the map", await until(page, () => !document.getElementById("map").hidden));
    await shot(page, "04-map");
    await page.click("#mapClose");
    const w = await page.evaluate(() => {
      const { S } = window.MC;
      const near = S.world.waystonesNear(0, 0, 400).filter((w) => w.id !== "w0_0").sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0];
      return near;
    });
    check("there is another waystone within 400 m", !!w);
    if (w) {
      await page.evaluate((w) => { const { S, chunks, gfx } = window.MC; S.player.x = w.x; S.player.z = w.z + 1; chunks.clear(); chunks.loadAround(S.player.x, S.player.z); gfx.snapCamera(S.player.x, S.player.z); }, w);
      check("standing on it takes it", await until(page, (id) => window.MC.game.isAttuned(id), w.id, 10000));
      check("and it becomes home", await page.evaluate((w) => { const J = window.MC.game.journey(); return J.home.x === w.x && J.home.z === w.z; }, w));
      await shot(page, "05-waystone");
    }

    console.log("\nDesktop: a Warden");
    const warden = await page.evaluate(() => {
      const { S } = window.MC;
      const s = S.world.structuresNear(0, 0, 900).find((s) => s.great);
      return s ? { x: s.x, z: s.z, id: s.id } : null;
    });
    check("a great structure stands within 900 m of the start", !!warden);
    if (warden) {
      await page.evaluate((s) => { const { S, chunks, gfx } = window.MC; S.player.x = s.x; S.player.z = s.z + 10; S.player.iframe = 999; chunks.clear(); chunks.loadAround(S.player.x, S.player.z); gfx.snapCamera(S.player.x, S.player.z); }, warden);
      check("its Warden wakes when you come near", await until(page, () => { const B = window.MC.S.boss; return B && B.alive && !B.dormant; }, null, 20000));
      await shot(page, "06-warden");
      await page.evaluate(() => { const B = window.MC.S.boss; B.hp = 1; });
      await page.evaluate(() => { const { S } = window.MC; import("./js/enemies.js").then((m) => m.hurtEnemy(S.boss, 50, {})); });
      check("it falls and leaves a Sigil", await until(page, () => window.MC.S.pickups.some((p) => p.type === "sigil"), null, 10000));
      const rank0 = await page.evaluate(() => window.MC.S.player.rank);
      await page.evaluate(() => { const { S } = window.MC; const p = S.pickups.find((p) => p.type === "sigil"); S.player.x = p.x; S.player.z = p.z; });
      check("the Sigil raises your circle rank", await until(page, (r) => window.MC.S.player.rank === r + 1, rank0, 10000));
      check("and the Warden stays beaten", await page.evaluate((id) => window.MC.game.hasSigil(id), warden.id));
      await page.evaluate(() => { window.MC.S.player.iframe = 0; });
    }

    console.log("\nDesktop: falling");
    await page.evaluate(() => { const P = window.MC.S.player; P.iframe = 0; P.hurt(9999, 0, "a test"); });
    check("falling shows the wake screen", await until(page, () => !document.getElementById("scr-death").hidden, null, 10000));
    await page.click("#btnWake");
    check("waking puts you at home, whole", await until(page, () => { const { S, game } = window.MC; const h = game.journey().home; return S.player.alive && S.player.hp === S.player.maxHp && Math.hypot(S.player.x - h.x, S.player.z - h.z) < 5; }));

    console.log("\nDesktop: the journey survives a reload");
    const saved = await page.evaluate(() => { window.MC.game.persist(); window.MC.save.flush(); const J = window.MC.game.journey(); return { seed: J.seed, rank: window.MC.S.player.rank, ways: J.waystones.length }; });
    await page.reload();
    await page.waitForFunction(() => window.MC && window.MC.S.mode === "title" && !document.getElementById("loading"), null, { timeout: 90000 });
    check("Continue is offered", await page.evaluate(() => !document.getElementById("btnContinue").hidden));
    await page.click("#btnContinue");
    check("and carries on the same journey", await until(page, (s) => { const { S, game } = window.MC; const J = game.journey(); return S.mode === "play" && J && J.seed === s.seed && S.player.rank === s.rank && J.waystones.length === s.ways; }, saved));
    check("no errors on the desktop run", D.errors.length === 0, D.errors.slice(0, 4).join(" | "));
    await D.ctx.close();

    console.log("\nPhone, held upright");
    const M = await open(browser, base, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const mp = M.page;
    await mp.tap("#btnNew");
    await mp.tap("#btnNewGo");
    await until(mp, () => window.MC.S.mode === "play" && window.MC.chunks.pending() === 0);
    const z0 = await mp.evaluate(() => window.MC.S.player.z);
    // a thumb on the left half, dragged down
    const cdp = await mp.context().newCDPSession(mp);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 100, y: 600 }] });
    for (let i = 1; i <= 8; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 100, y: 600 + i * 8 }] });
    const moved = await until(mp, (z) => window.MC.S.player.z > z + 1.5, z0, 15000);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    check("a thumb on the left moves the mage", moved);
    check("the touch controls are shown", await mp.evaluate(() => !document.getElementById("touchUI").hidden));
    const fits = await mp.evaluate(() => { const r = document.getElementById("spellbar").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; });
    check("eight scrolls fit across a phone", fits);
    await shot(mp, "07-phone");
    check("no errors on the phone run", M.errors.length === 0, M.errors.slice(0, 4).join(" | "));
    await M.ctx.close();
  } finally {
    await browser.close();
    srv.close();
  }
  console.log("\n" + (checks - failures) + " of " + checks + " browser checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

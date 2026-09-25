#!/usr/bin/env node
/* ============================================================
   Hacks — the game, played alone in a real browser
   `node tools/e2e.js [--shots <dir>]`

   The shape is Magic Sandbox's tools/e2e.js: serve the folder, open it in
   Chromium (software WebGL), play it the way a person would, and fail on
   anything a person would notice — including any error in the console.

   What it covers:
     - the title, the version line, settings, rebinding a key, the loadout
     - a match against bots: keys move you, bots move and fight, the HUD
       follows, the starter hack draws, time passes, somebody wins
     - the hacks panel: every lesson opens and runs, an ESP draws boxes, a
       syntax error is marked on its line, the panel survives a reopen with
       your code intact
     - practice: dummies that never shoot, and that you cannot be hurt by
     - a phone, both ways up: every button on screen, a tap jumps, the stick
       moves, and moving a button in the layout editor is remembered

   Skipped (not failed) where Playwright is not installed.
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
for (const where of ["playwright", path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "playwright")]) {
  try { ({ chromium } = require(where)); break; } catch (e) {}
}
if (!chromium) { console.log("playwright is not installed here; skipping the browser pass."); process.exit(0); }

const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const SHOT_DIR = (() => { const i = process.argv.indexOf("--shots"); return i === -1 ? null : (process.argv[i + 1] || path.join(ROOT, "shots")); })();
if (SHOT_DIR) fs.mkdirSync(SHOT_DIR, { recursive: true });

let failures = 0, checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) console.log("  \u2713 " + name);
  else { failures++; console.log("  \u2717 " + name + (detail !== undefined ? " — " + detail : "")); }
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
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 720 }, serviceWorkers: "block" }, opts || {}));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(() => {
    localStorage.setItem("hacks:debug", "1");
    if (!localStorage.getItem("hacks:v1")) localStorage.setItem("hacks:v1", JSON.stringify({ settings: { quality: "low", master: 0, sfx: 0 } }));
  });
  await page.goto(base + "/index.html");
  await page.waitForFunction(() => window.HK_DEBUG && window.HK_DEBUG.S.mode === "title", null, { timeout: 60000 });
  return { ctx, page, errors };
}
async function until(page, fn, arg, t) {
  const end = Date.now() + (t || 20000);
  for (;;) {
    if (await page.evaluate(fn, arg)) return true;
    if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 160));
    await page.waitForTimeout(150);
  }
}
const soft = (p) => p.then(() => true, () => false);
async function shot(page, name) { if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, name + ".png") }); }
/** Run the match forward by `seconds` of game time, as fast as the machine allows. */
const fastForward = (page, seconds) => page.evaluate((s) => { const { game } = window.HK_DEBUG; for (let i = 0; i < s * 64; i++) game.tick(game.TICK); }, seconds);

(async function main() {
  const srv = await serve();
  const base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--no-sandbox"] });
  const pages = [];
  try {
    console.log("\nThe title");
    const D = await open(browser, base); pages.push(D);
    const p = D.page;
    check("the title screen is up", await p.isVisible("#scr-title"));
    check("the version line says which version", /Version \d/.test(await p.textContent("#verLine")));
    await shot(p, "01-title");

    console.log("\nSettings");
    await p.click("#btnSettings");
    await p.click('#setTabs [data-tab="keys"]');
    await p.click('#bindList .key[data-act="jump"][data-i="0"]');
    check("clicking a key asks for a new one", await p.isVisible("#bindCapture"));
    await p.keyboard.press("KeyJ");
    check("the new key is bound", await p.evaluate(() => window.HK_DEBUG.save.data.binds.jump[0] === "KeyJ"));
    await p.click('#bindList .key[data-act="melee"][data-i="0"]');
    await p.keyboard.press("KeyJ");
    check("a key does one thing: binding it elsewhere takes it off jump", await p.evaluate(() => window.HK_DEBUG.save.data.binds.jump[0] === "" && window.HK_DEBUG.save.data.binds.melee[0] === "KeyJ"));
    await p.click("#btnResetKeys");
    check("reset puts every key back", await p.evaluate(() => window.HK_DEBUG.save.data.binds.jump[0] === "Space"));
    await p.click('#setTabs [data-tab="controls"]');
    await p.evaluate(() => { const r = document.getElementById("stSens"); r.value = 2.5; r.dispatchEvent(new Event("input")); });
    check("a slider changes the setting", await p.evaluate(() => window.HK_DEBUG.save.settings.sens === 2.5));
    await p.click("#scr-settings [data-back]");

    console.log("\nLoadout");
    await p.click("#btnLoadout");
    check("six guns and two blades to choose from", (await p.$$("#loPrimary .card")).length === 6 && (await p.$$("#loMelee .card")).length === 2);
    await p.click('#loPrimary .card[data-id="mauler"]');
    await p.click('#loMelee .card[data-id="lancer"]');
    check("the choice is kept", await p.evaluate(() => { const l = window.HK_DEBUG.save.data.loadout; return l.primary === "mauler" && l.melee === "lancer"; }));
    await p.click("#scr-loadout [data-back]");

    console.log("\nA match against bots");
    await p.click("#btnPlay");
    await p.evaluate(() => { const r = document.getElementById("spBots"); r.value = 5; r.dispatchEvent(new Event("input")); });
    await p.click('#spDiff [data-v="hard"]');
    await p.click("#btnPlayGo");
    await until(p, () => window.HK_DEBUG.S.mode === "play" && window.HK_DEBUG.S.me && window.HK_DEBUG.S.me.alive);
    check("the match starts with you and five bots", await p.evaluate(() => window.HK_DEBUG.S.actors.length === 6 && window.HK_DEBUG.S.actors.filter((a) => a.kind === "bot").length === 5));
    check("your loadout is in your hands", await p.evaluate(() => window.HK_DEBUG.S.me.arms.slots[0] === "mauler" && window.HK_DEBUG.S.me.arms.melee === "lancer"));
    check("the HUD is up", await p.isVisible("#hud") && await soft(until(p, () => /FFA/.test(document.getElementById("modeName").textContent), null, 5000)));
    check("the starter hack runs and draws", await soft(until(p, () => { const h = window.HK_DEBUG.hackapi; return h.running() === 1; }, null, 15000)));
    await p.waitForTimeout(600);
    const x0 = await p.evaluate(() => [window.HK_DEBUG.S.me.body.x, window.HK_DEBUG.S.me.body.z]);
    await p.keyboard.down("KeyW"); await p.waitForTimeout(700); await p.keyboard.up("KeyW");
    const x1 = await p.evaluate(() => [window.HK_DEBUG.S.me.body.x, window.HK_DEBUG.S.me.body.z]);
    check("W walks you forward", Math.hypot(x1[0] - x0[0], x1[1] - x0[1]) > 1, JSON.stringify([x0, x1]));
    // software WebGL can be a few frames a second here; game time still runs in real time, so wait on the outcome
    await until(p, () => window.HK_DEBUG.S.me.body.onGround, null, 5000);
    const y0 = await p.evaluate(() => window.HK_DEBUG.S.me.body.y);
    await p.evaluate(() => dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " " })));
    const jumped = await soft(until(p, (y) => window.HK_DEBUG.S.me.body.y > y + 0.3, y0, 4000));
    await p.evaluate(() => dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " " })));
    check("Space jumps", jumped);
    await shot(p, "02-match");
    const bots0 = await p.evaluate(() => window.HK_DEBUG.S.actors.filter((a) => a.kind === "bot").map((a) => [a.body.x, a.body.z]));
    await fastForward(p, 3);
    const botsMoved = await p.evaluate((b0) => window.HK_DEBUG.S.actors.filter((a) => a.kind === "bot").filter((a, i) => Math.hypot(a.body.x - b0[i][0], a.body.z - b0[i][1]) > 2).length, bots0);
    check("bots find their way around", botsMoved >= 3, botsMoved + " of 5 moved");
    await p.evaluate(() => { window.HK_DEBUG.S.me.body.gravityScale = 1; });
    await fastForward(p, 60);
    const kills = await p.evaluate(() => Object.values(window.HK_DEBUG.S.match.score.k).reduce((s, v) => s + v, 0));
    check("a minute later, somebody has been killed", kills > 0, kills);
    check("the kill feed says who", await soft(until(p, () => document.getElementById("killfeed").children.length > 0, null, 3000)));
    await p.keyboard.down("Tab");
    await p.waitForTimeout(200);
    check("Tab shows the scoreboard", await p.isVisible("#scoreboard") && (await p.$$("#scoreboard tr")).length === 7);
    await p.keyboard.up("Tab");
    await p.waitForTimeout(200);
    check("and letting go hides it", !(await p.isVisible("#scoreboard")));

    console.log("\nThe hacks panel");
    await p.keyboard.press("KeyH");
    await until(p, () => !document.getElementById("hackPanel").hidden);
    check("H opens the hacks panel", true);
    check("solo play pauses while it is open", await p.evaluate(() => window.HK_DEBUG.S.paused));
    check("the starter hack's code is in the editor", /Hello, hacker/.test(await p.inputValue("#editor textarea")));
    await p.click('#hpTabs [data-htab="learn"]');
    const lessons = await p.$$("#hpLearn [data-lesson]");
    check("the Learn tab lists the lessons", lessons.length >= 12, lessons.length);
    await p.click('#hpLearn [data-lesson="boxes"]');
    await until(p, () => window.HK_DEBUG.hackapi.running() === 2, null, 10000);
    check("a lesson opens as a new hack, running", /screen\.toScreen/.test(await p.inputValue("#editor textarea")));
    await p.click("#hpClose");
    await p.evaluate(() => { const { S } = window.HK_DEBUG; const e = S.actors.find((a) => a.kind === "bot" && a.alive); const b = S.me.body; b.x = e.body.x + 6; b.z = e.body.z; b.y = e.body.y + 0.02; S.me.px = b.x; S.me.pz = b.z; S.me.py = b.y; S.view.yaw = Math.PI / 2; S.view.pitch = -0.05; });
    const boxes = await soft(until(p, () => { const d = window.HK_DEBUG.hackapi; return d.running() === 2; }, null, 5000));
    await p.waitForTimeout(800);
    const draws = await p.evaluate(() => { const c = document.getElementById("overlay"); const g = c.getContext("2d"); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; return n; });
    check("the ESP draws on the overlay", boxes && draws > 200, draws);
    await shot(p, "03-esp");
    await p.keyboard.press("KeyH");
    await until(p, () => !document.getElementById("hackPanel").hidden);
    await p.click('#hpTabs [data-htab="code"]');
    await p.click("#editor textarea");
    await p.keyboard.press("Control+End");
    await p.keyboard.type("\nconst broken = ;\n");
    await p.click("#hpRun");
    await until(p, () => !!document.querySelector("#editor .ed-gutter .err"), null, 8000);
    const errLine = await p.textContent("#editor .ed-gutter .err");
    const codeLines = (await p.inputValue("#editor textarea")).split("\n");
    check("a syntax error is marked on its own line", codeLines[+errLine - 1] && codeLines[+errLine - 1].includes("broken"), errLine);
    check("and explained in the console", /SyntaxError/.test(await p.textContent("#hpLog")));
    await p.click("#hpClose");
    await p.keyboard.press("KeyH");
    await until(p, () => !document.getElementById("hackPanel").hidden);
    check("reopening the panel keeps the code as it was typed", (await p.inputValue("#editor textarea")).includes("const broken = ;"));
    await p.click("#hpClose");

    console.log("\nPause, and the end of a match");
    await p.keyboard.press("Escape");
    await until(p, () => !document.getElementById("scr-pause").hidden);
    check("Escape pauses", await p.evaluate(() => window.HK_DEBUG.S.paused));
    await p.click("#btnResume");
    check("and Resume goes back", await p.evaluate(() => !window.HK_DEBUG.S.paused && document.getElementById("menus").hidden));
    await p.evaluate(() => { const { S, game } = window.HK_DEBUG; S.match.score.target = (S.match.score.k[S.me.id] || 0) + 1; const e = S.actors.find((a) => a.kind === "bot" && a.alive); game.hitActor(e, 999, S.me, { weapon: "mauler", part: "head" }); });
    await until(p, () => !document.getElementById("scr-results").hidden, null, 8000);
    check("reaching the kill count ends it: you win", /You win/.test(await p.textContent("#resTitle")));
    await shot(p, "04-results");
    await p.click("#btnResAgain");
    await until(p, () => window.HK_DEBUG.S.mode === "play" && !window.HK_DEBUG.S.match.over && document.getElementById("scr-results").hidden);
    check("Play again starts a fresh match", await p.evaluate(() => Object.keys(window.HK_DEBUG.S.match.score.k).length === 0));
    await p.keyboard.press("Escape");
    await p.click("#btnQuit");
    await until(p, () => window.HK_DEBUG.S.mode === "title" && !document.getElementById("scr-title").hidden);
    check("Leave goes back to the title", true);

    console.log("\nPractice");
    await p.click("#btnPractice");
    await until(p, () => window.HK_DEBUG.S.mode === "play" && window.HK_DEBUG.S.match.mode === "practice");
    check("practice has dummies to aim at", await p.evaluate(() => window.HK_DEBUG.S.actors.filter((a) => a.kind === "bot" && a.passive).length === 4));
    await fastForward(p, 20);
    check("dummies never shoot, and nothing hurts you", await p.evaluate(() => window.HK_DEBUG.S.me.hp === 100 && window.HK_DEBUG.S.me.alive && window.HK_DEBUG.S.me.arms.shots === 0));
    check("no errors on the desktop", D.errors.length === 0, D.errors.slice(0, 4).join(" | "));
    await D.ctx.close();

    for (const [label, vw, vh] of [["held sideways", 844, 390], ["held upright", 390, 844]]) {
      console.log("\nA phone " + label);
      const M = await open(browser, base, { viewport: { width: vw, height: vh }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }); pages.push(M);
      const q = M.page;
      await q.tap("#btnPlay"); await q.tap("#btnPlayGo");
      await until(q, () => window.HK_DEBUG.S.mode === "play" && document.body.classList.contains("touchOn"));
      check("the touch controls are up", await q.isVisible("#touch"));
      const rects = await q.$$eval(".tbtn", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.id, r.left, r.top, r.right, r.bottom]; }));
      const off = rects.filter((r) => r[1] < 0 || r[2] < 0 || r[3] > vw + 0.5 || r[4] > vh + 0.5);
      check("all " + rects.length + " buttons are on screen, all the time", rects.length === 14 && off.length === 0, JSON.stringify(off));
      await q.waitForTimeout(400);
      const y0 = await q.evaluate(() => window.HK_DEBUG.S.me.body.y);
      const jb = await q.$('.tbtn[data-id="jump"]'), jr = await jb.boundingBox();
      await q.evaluate(([x, y]) => {
        const t = document.querySelector('.tbtn[data-id="jump"]');
        t.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 7, clientX: x, clientY: y, pointerType: "touch" }));
      }, [jr.x + jr.width / 2, jr.y + jr.height / 2]);
      const upped = await soft(until(q, (y) => window.HK_DEBUG.S.me.body.y > y + 0.3, y0, 3000));
      await q.evaluate(() => dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, pointerType: "touch" })));
      check("the jump button jumps", upped);
      const sb = await (await q.$(".tbtn.stick")).boundingBox();
      const p0 = await q.evaluate(() => [window.HK_DEBUG.S.me.body.x, window.HK_DEBUG.S.me.body.z]);
      await q.evaluate(([x, y, r]) => {
        const t = document.querySelector(".tbtn.stick");
        t.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 8, clientX: x, clientY: y, pointerType: "touch" }));
        dispatchEvent(new PointerEvent("pointermove", { pointerId: 8, clientX: x, clientY: y - r, pointerType: "touch" }));
      }, [sb.x + sb.width / 2, sb.y + sb.height / 2, sb.width / 2]);
      const walked = await soft(until(q, (p0) => Math.hypot(window.HK_DEBUG.S.me.body.x - p0[0], window.HK_DEBUG.S.me.body.z - p0[1]) > 1, p0, 6000));
      await q.evaluate(() => dispatchEvent(new PointerEvent("pointerup", { pointerId: 8, pointerType: "touch" })));
      check("pushing the stick moves you", walked);
      await shot(q, "05-phone-" + (vw > vh ? "landscape" : "portrait"));
      // move the fire button
      await q.evaluate(() => { window.HK_DEBUG.S.paused = true; });
      await q.tap('.tbtn[data-id="menu"]');
      await until(q, () => !document.getElementById("scr-pause").hidden);
      await q.tap("#btnPauseSettings");
      await q.tap('#setTabs [data-tab="touch"]');
      await q.tap("#btnEditTouch");
      await until(q, () => document.body.classList.contains("touchEditing"));
      const fb = await (await q.$('.tbtn[data-id="fire"]')).boundingBox();
      await q.evaluate(([x, y]) => {
        const t = document.querySelector('.tbtn[data-id="fire"]');
        t.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 9, clientX: x, clientY: y, pointerType: "touch" }));
        dispatchEvent(new PointerEvent("pointermove", { pointerId: 9, clientX: x - 60, clientY: y - 40, pointerType: "touch" }));
        dispatchEvent(new PointerEvent("pointerup", { pointerId: 9, pointerType: "touch" }));
      }, [fb.x + fb.width / 2, fb.y + fb.height / 2]);
      const moved = await q.evaluate(() => { const o = innerWidth >= innerHeight ? "landscape" : "portrait"; return JSON.parse(localStorage.getItem("hacks:v1")).touch[o].fire; });
      const def = vw > vh ? { x: 0.86, y: 0.62 } : { x: 0.78, y: 0.7 };
      check("dragging a button moves it, and the new place is saved", Math.abs(moved.x - (def.x - 60 / vw)) < 0.02 && Math.abs(moved.y - (def.y - 40 / vh)) < 0.02, JSON.stringify(moved));
      await q.tap("#teDone");
      check("Done goes back to the game's menu", await soft(until(q, () => !document.getElementById("scr-pause").hidden && !document.body.classList.contains("touchEditing"), null, 4000)));
      check("no errors on the phone", M.errors.length === 0, M.errors.slice(0, 4).join(" | "));
      await M.ctx.close();
    }
  } catch (e) {
    failures++;
    console.log("  \u2717 " + e.message);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log("\n" + (checks - failures) + "/" + checks + " browser checks passed");
  process.exit(failures ? 1 : 0);
})();

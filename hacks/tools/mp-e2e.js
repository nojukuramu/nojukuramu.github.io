#!/usr/bin/env node
/* ============================================================
   Hacks — multiplayer, in real browsers
   `node tools/mp-e2e.js [--shots <dir>]`

   The shape is Magic Sandbox's tools/mp-e2e.js: several Chromium pages,
   each its own browser profile, talking over real WebRTC data channels
   through tools/broker.js — KaraokeNatin's local stand-in for the public
   PeerJS broker — so nothing leaves the machine.

   What it proves, in the order a player would meet it:
     - the first browser to open a server holds its list, the next joins it
     - a room made on one appears in another's list and can be walked into
     - ready, start, and a free for all where a hack on one machine aims and
       fires, the round hits the body on the other machine, its owner applies
       the damage, and the host scores the kill
     - the kill count ends the match for everyone
     - team deathmatch with bots: the host's bots are puppets on the client,
       they move there, and they fight
     - a room set to "visual only" ignores a hack's trigger finger, and says so
     - leaving takes the body out of the other player's match

   Skipped (not failed) where Playwright is not installed.
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const broker = require("./broker");

let chromium;
for (const where of ["playwright", path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "playwright")]) {
  try { ({ chromium } = require(where)); break; } catch (e) {}
}
if (!chromium) { console.log("playwright is not installed here; skipping the multiplayer pass."); process.exit(0); }

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
async function open(browser, base, bport, name) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(name + ": " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(name + ": " + m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(([p, n]) => {
    window.HK_BROKERS = [{ host: "127.0.0.1", port: p, path: "/", key: "peerjs" }];
    window.HK_ICE = { iceServers: [] };
    localStorage.setItem("hacks:debug", "1");
    if (!localStorage.getItem("hacks:v1")) localStorage.setItem("hacks:v1", JSON.stringify({ name: n, settings: { quality: "low", master: 0, sfx: 0, pauseEditing: false }, hacks: [] }));
  }, [bport, name]);
  await page.goto(base + "/index.html");
  await page.waitForFunction(() => window.HK_DEBUG && window.HK_DEBUG.S.mode === "title", null, { timeout: 60000 });
  return { ctx, page, errors, name };
}
async function until(page, fn, arg, t) {
  const end = Date.now() + (t || 30000);
  for (;;) {
    if (await page.evaluate(fn, arg)) return true;
    if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 160));
    await page.waitForTimeout(200);
  }
}
const soft = (p) => p.then(() => true, () => false);
async function shot(page, name) { if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, name + ".png") }); }
const setRange = (page, id, v) => page.evaluate(([id, v]) => { const t = document.getElementById(id); t.value = v; t.dispatchEvent(new Event("input")); }, [id, v]);

(async function main() {
  const srv = await serve();
  const b = await broker.start(0);
  const base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-features=WebRtcHideLocalIpsWithMdns", "--no-sandbox"] });
  const all = [];
  try {
    console.log("\nServers");
    const A = await open(browser, base, b.port, "Ada"); all.push(A);
    await A.page.click("#btnMulti");
    await until(A.page, () => window.HK_DEBUG.lobby.directory("RELY01").state === "holding");
    check("the first browser to open a server holds its list", true);
    const B = await open(browser, base, b.port, "Bo"); all.push(B);
    await B.page.click("#btnMulti");
    check("the next browser joins the holder instead", await soft(until(B.page, () => window.HK_DEBUG.lobby.directory("RELY01").state === "joined")));

    console.log("\nA room");
    await A.page.click('[data-server="RELY01"]');
    await A.page.click("#btnCreateRoom");
    await setRange(A.page, "rsBots", 0);
    await setRange(A.page, "rsTarget", 5);
    await A.page.fill("#rsName", "Test arena");
    await A.page.click("#btnRoomsetGo");
    await until(A.page, () => !document.getElementById("scr-room").hidden && /^[A-Z0-9]{6}$/.test(document.getElementById("roomCode").textContent));
    const code = await A.page.textContent("#roomCode");
    check("making a room gives it a six-letter code", /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
    await B.page.click('[data-server="RELY01"]');
    check("the room shows in another browser's list", await soft(until(B.page, (c) => !!document.querySelector('#roomList [data-room="' + c + '"]'), code, 20000)));
    await B.page.click('#roomList [data-room="' + code + '"]');
    await until(B.page, () => window.HK_DEBUG.mpui.inRoom() && /Ada/.test(document.getElementById("roomPlayers").textContent));
    await until(A.page, () => /Bo/.test(document.getElementById("roomPlayers").textContent));
    check("walking in puts both names in both rooms", true);
    check("the host cannot start until everyone is ready", await A.page.evaluate(() => document.getElementById("btnRoomStart").disabled));
    await shot(A.page, "mp-01-room");

    console.log("\nFree for all, fought by a hack");
    await B.page.click("#btnRoomReady");
    await until(A.page, () => !document.getElementById("btnRoomStart").disabled);
    await A.page.click("#btnRoomStart");
    await until(A.page, () => window.HK_DEBUG.S.mode === "play" && window.HK_DEBUG.S.actors.some((a) => a.kind === "remote" && a.heard));
    await until(B.page, () => window.HK_DEBUG.S.mode === "play" && window.HK_DEBUG.S.actors.some((a) => a.kind === "remote" && a.heard));
    check("start puts both in the match, each seeing the other", true);
    // two spots twelve metres apart with a clear line between them
    const spots = await A.page.evaluate(async () => {
      const { S } = window.HK_DEBUG;
      const brush = await import("./js/brush.js");
      for (let r = 20; r < 60; r += 4) for (let k = 0; k < 16; k++) {
        const ax = Math.cos(k) * r, az = Math.sin(k) * r, bx = ax + 12 * Math.cos(k + 1.3), bz = az + 12 * Math.sin(k + 1.3);
        const t = brush.ray(S.world, ax, 1.5, az, bx, 1.5, bz);
        const fa = brush.solidAt(S.world, ax, 0.95, az, 0.4, 0.9, 0.4), fb = brush.solidAt(S.world, bx, 0.95, bz, 0.4, 0.9, 0.4);
        if (t.fraction === 1 && !fa && !fb) return { ax, az, bx, bz };
      }
      return null;
    });
    check("found two spots in sight of each other", !!spots);
    const place = (x, z) => { const { S } = window.HK_DEBUG; const b = S.me.body; b.x = x; b.y = 0.02; b.z = z; b.vx = b.vy = b.vz = 0; S.me.px = x; S.me.py = 0.02; S.me.pz = z; };
    await A.page.evaluate(([f, x, z]) => new Function("x", "z", f)(x, z), ["(" + place.toString() + ")(x, z)", spots.ax, spots.az]);
    await B.page.evaluate(([f, x, z]) => new Function("x", "z", f)(x, z), ["(" + place.toString() + ")(x, z)", spots.bx, spots.bz]);
    await until(A.page, (p) => { const q = window.HK_DEBUG.S.actors.find((a) => a.kind === "remote"); return q && Math.hypot(q.body.x - p.bx, q.body.z - p.bz) < 0.8; }, spots);
    check("each sees the other where they stand", true);
    const hp0 = await B.page.evaluate(() => window.HK_DEBUG.S.me.hp);
    // the aimbot lesson's core, shooting for Ada
    await A.page.evaluate(() => {
      const { save, hackapi } = window.HK_DEBUG;
      save.data.hacks.push({ id: "aimfire0", name: "aimfire", on: false, code: 'on("tick", () => { const e = enemies.find((x) => x.visible); if (!e) return; input.lookAt(e.bones.chest); input.fire = true; });' });
      hackapi.run("aimfire0");
    });
    const hurt = await soft(until(B.page, (h) => window.HK_DEBUG.S.me.hp < h || !window.HK_DEBUG.S.me.alive, hp0, 20000));
    check("a hack aims and fires on one machine, and the body on the other is hurt", hurt, hp0 + " -> " + await B.page.evaluate(() => window.HK_DEBUG.S.me.hp));
    const scored = await soft(until(A.page, () => (window.HK_DEBUG.S.match.score.k[1] || 0) >= 1, null, 20000));
    check("the victim's machine reports the death and the host scores it", scored, JSON.stringify(await A.page.evaluate(() => window.HK_DEBUG.S.match.score)));
    check("the kill reaches the client's kill feed", await soft(until(B.page, () => /Ada/.test(document.getElementById("killfeed").textContent), null, 8000)));
    await shot(A.page, "mp-02-ffa");
    await A.page.evaluate(() => window.HK_DEBUG.hackapi.stop("aimfire0"));
    // finish the match by Ada's hand
    for (let k = 0; k < 6; k++) {
      if (await A.page.evaluate(() => window.HK_DEBUG.S.match.over)) break;
      await until(B.page, () => window.HK_DEBUG.S.me.alive, null, 10000);
      await B.page.evaluate(() => { const { S, game } = window.HK_DEBUG; game.applyDamage(S.me, 1000, 1, { weapon: "kestrel", part: "head" }); });
      await B.page.waitForTimeout(300);
    }
    await until(A.page, () => !document.getElementById("scr-results").hidden);
    await until(B.page, () => !document.getElementById("scr-results").hidden);
    check("the kill count ends the match for everyone", /You win/.test(await A.page.textContent("#resTitle")) && /Ada wins/.test(await B.page.textContent("#resTitle")), (await A.page.textContent("#resTitle")) + " / " + (await B.page.textContent("#resTitle")));
    await A.page.click("#btnResBack"); await B.page.click("#btnResBack");
    await until(A.page, () => !document.getElementById("scr-room").hidden && window.HK_DEBUG.S.mode === "title");
    await until(B.page, () => !document.getElementById("scr-room").hidden);
    check("both are back in the room", true);

    console.log("\nTeam deathmatch with bots");
    await A.page.click("#btnRoomEdit");
    await A.page.click('#rsMode [data-v="tdm"]');
    await setRange(A.page, "rsBots", 6);
    await A.page.click("#btnRoomsetGo");
    await until(B.page, () => /Team deathmatch/.test(document.getElementById("roomDesc").textContent));
    check("the host's new setup reaches the guest", true);
    if (/^Ready/.test((await B.page.textContent("#btnRoomReady")).trim())) await B.page.click("#btnRoomReady");
    await until(A.page, () => !document.getElementById("btnRoomStart").disabled);
    await A.page.click("#btnRoomStart");
    await until(A.page, () => window.HK_DEBUG.S.mode === "play" && window.HK_DEBUG.S.actors.filter((a) => a.kind === "bot").length === 4);
    await until(B.page, () => window.HK_DEBUG.S.mode === "play" && window.HK_DEBUG.S.actors.filter((a) => a.kind === "bot").length === 4);
    check("the room fills to six with bots, on both machines", true);
    const teams = await A.page.evaluate(() => window.HK_DEBUG.S.actors.map((a) => a.team));
    check("two teams of three", teams.filter((t) => t === 0).length === 3 && teams.filter((t) => t === 1).length === 3, teams.join(","));
    const p0 = await B.page.evaluate(() => { const b = window.HK_DEBUG.S.actors.filter((a) => a.kind === "bot"); return b.map((a) => [a.body.x, a.body.z]); });
    await B.page.waitForTimeout(2500);
    const moved = await B.page.evaluate((p0) => window.HK_DEBUG.S.actors.filter((a) => a.kind === "bot").some((a, i) => p0[i] && Math.hypot(a.body.x - p0[i][0], a.body.z - p0[i][1]) > 1), p0);
    check("the host's bots move on the client's screen", moved);
    await B.page.evaluate(() => { window.__fired = 0; });
    const fight = await soft(until(A.page, () => Object.values(window.HK_DEBUG.S.match.score.k).reduce((s, v) => s + v, 0) > 0, null, 60000));
    check("bots fight, and it is scored", fight, JSON.stringify(await A.page.evaluate(() => window.HK_DEBUG.S.match.score.tk)));
    check("the client keeps the same score", await soft(until(B.page, (tk) => JSON.stringify(window.HK_DEBUG.S.match.score.tk) === tk, JSON.stringify(await A.page.evaluate(() => window.HK_DEBUG.S.match.score.tk)), 5000)));
    await shot(B.page, "mp-03-tdm");

    console.log("\nHack rules");
    await A.page.evaluate(() => { window.HK_DEBUG.S.match.settings.hacks = "visual"; });
    await A.page.evaluate(() => {
      const { save, hackapi } = window.HK_DEBUG;
      save.data.hacks.push({ id: "trig0000", name: "trig", on: false, code: 'on("tick", () => { input.fire = true; });' });
      hackapi.run("trig0000");
    });
    const warned = await soft(until(A.page, () => window.HK_DEBUG.hackapi.logs.some((l) => /needs the room's hack rules to be Assist/.test(l.text)), null, 8000));
    check("a room set to visual only ignores a hack's trigger, and the console says why", warned);
    const shots = await A.page.evaluate(async () => { const a = window.HK_DEBUG.S.me.arms.shots; await new Promise((r) => setTimeout(r, 800)); return window.HK_DEBUG.S.me.arms.shots - a; });
    check("and no shot was fired", shots === 0, shots);

    console.log("\nLeaving");
    await B.page.evaluate(() => window.HK_DEBUG.mpui && document.getElementById("btnQuit") && true);
    await B.page.evaluate(() => { window.confirm = () => true; });
    await B.page.evaluate(() => { const ev = new KeyboardEvent("keydown", { key: "Escape", code: "Escape" }); dispatchEvent(ev); });
    await B.page.waitForTimeout(300);
    await B.page.click("#btnQuit").catch(() => {});
    await until(A.page, () => !window.HK_DEBUG.S.actors.some((a) => a.kind === "remote"), null, 20000);
    check("leaving takes the body out of the other player's match", true);
    check("and a bot takes the empty seat", await soft(until(A.page, () => window.HK_DEBUG.S.actors.filter((a) => a.kind === "bot").length === 5, null, 5000)));

    const errs = all.flatMap((x) => x.errors).filter((e) => !/favicon|ERR_|Failed to load resource/.test(e));
    check("no page errors in any browser", errs.length === 0, errs.slice(0, 5).join(" | "));
  } catch (e) {
    failures++;
    console.log("  \u2717 " + e.message);
  } finally {
    for (const x of all) await x.ctx.close().catch(() => {});
    await browser.close();
    b.close && b.close();
    srv.close();
  }
  console.log("\n" + (checks - failures) + "/" + checks + " multiplayer checks passed");
  process.exit(failures ? 1 : 0);
})();

#!/usr/bin/env node
/* ============================================================
   Magic Sandbox — multiplayer, in real browsers
   `node tools/mp-e2e.js [--shots <dir>]`

   tools/e2e.js plays alone. This plays together: several Chromium pages,
   each its own browser profile, talking over real WebRTC data channels
   through tools/broker.js — the local stand-in for the public PeerJS broker
   that KaraokeNatin's suite uses — so nothing leaves the machine.

   What it proves, in the order a player would meet it:
     - the first browser to open a server holds its list, the next joins it
     - a room made on one appears in another's list, and can be walked into
     - Quick join finds a waiting room
     - ready, start, and a Free for all where a real spell from one mage
       really hurts another, the victim tells the host, and the host scores it
     - respawning, and a match that ends at its kill count, for everyone
     - a co-op climb: the host's enemies appear on a client, die there when
       they die on the host, the objective and portal follow, the whole room
       goes up to floor two together, and fog of war hides what is far away
     - Wipe Out rounds: a wiped team loses the round and everyone stands up
     - when the browser holding a server leaves, another takes it over

   Skipped (not failed) where Playwright is not installed, like tools/e2e.js.
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
if (!chromium) {
  console.log("playwright is not installed here; skipping the multiplayer pass.");
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

async function open(browser, base, bport, name) {
  const ctx = await browser.newContext({ viewport: { width: 640, height: 400 }, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(name + ": " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(name + ": " + m.text()); });
  page.on("dialog", (d) => d.accept());
  await page.addInitScript(([p, n]) => {
    window.MS_BROKERS = [{ host: "127.0.0.1", port: p, path: "/", key: "peerjs" }];
    window.MS_ICE = { iceServers: [] };
    localStorage.setItem("msandbox:debug", "1");
    if (!localStorage.getItem("msandbox:v2")) localStorage.setItem("msandbox:v2", JSON.stringify({ settings: { quality: "low", music: 0, sfx: 0 }, name: n, tutorial: { move: true, cast: true, swap: true, dash: true, book: true } }));
  }, [bport, name]);
  await page.goto(base + "/index.html");
  await page.waitForFunction(() => window.MS && window.MS.S.mode === "title", null, { timeout: 60000 });
  return { ctx, page, errors, name };
}
async function until(page, fn, arg, t) {
  const end = Date.now() + (t || 30000);
  for (;;) {
    if (await page.evaluate(fn, arg)) return true;
    // boon cards come and go in a co-op match; take them as a player would
    if (await page.evaluate(() => !document.getElementById("scr-boons").hidden)) await page.click("#boonCards .card").catch(() => {});
    if (Date.now() > end) throw new Error("timed out waiting for: " + fn.toString().slice(0, 140));
    await page.waitForTimeout(200);
  }
}
const soft = (p) => p.then(() => true, () => false);
async function shot(page, name) { if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, name + ".png") }); }

(async function main() {
  const srv = await serve();
  const b = await broker.start(0);
  const base = "http://127.0.0.1:" + srv.address().port;
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    "--disable-features=WebRtcHideLocalIpsWithMdns", "--no-sandbox"] });
  const all = [];
  try {
    /* ---------------- servers ---------------- */
    console.log("\nServers");
    const A = await open(browser, base, b.port, "Ada"); all.push(A);
    await A.page.click("#btnMulti");
    await until(A.page, () => window.MS.lobby.directory("VERD01").state === "holding");
    check("the first browser to open a server holds its list", true);
    check("the server list names the tower's lands", (await A.page.textContent("#serverList")).includes("Frostreach"));
    const B = await open(browser, base, b.port, "Bo"); all.push(B);
    await B.page.click("#btnMulti");
    const joined = await soft(until(B.page, () => window.MS.lobby.directory("VERD01").state === "joined"));
    check("the next browser joins the holder instead", joined, await B.page.evaluate(() => window.MS.lobby.directory("VERD01").state));
    await shot(A.page, "mp-01-servers");

    /* ---------------- a room ---------------- */
    console.log("\nA room");
    await A.page.click('[data-server="VERD01"]');
    await A.page.click("#btnCreateRoom");
    await A.page.click('#rsMode [data-mode="ffa"]');
    check("PVP modes offer a map and a target", await A.page.isVisible("#rsMap") && await A.page.isVisible("#rsTarget"));
    await A.page.evaluate(() => { const t = document.getElementById("rsTarget"); t.value = 3; t.dispatchEvent(new Event("input")); });
    await A.page.fill("#rsName", "Test arena");
    await A.page.click("#btnRoomsetGo");
    await until(A.page, () => !document.getElementById("scr-room").hidden && /^[A-Z0-9]{6}$/.test(document.getElementById("roomCode").textContent));
    const code = await A.page.textContent("#roomCode");
    check("making a room gives it a six-letter code", /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
    await B.page.click('[data-server="VERD01"]');
    const listed = await soft(until(B.page, (c) => !!document.querySelector('#roomList [data-room="' + c + '"]'), code, 20000));
    check("the room shows in another browser's list", listed);
    await shot(B.page, "mp-02-rooms");
    await B.page.click('#roomList [data-room="' + code + '"]');
    await until(B.page, () => window.MS.mpui.inRoom() && document.getElementById("roomPlayers").children.length > 0 && /Ada/.test(document.getElementById("roomPlayers").textContent));
    await until(A.page, () => /Bo/.test(document.getElementById("roomPlayers").textContent));
    check("walking in puts both names in both rooms", true);
    check("the host cannot start until everyone is ready", await A.page.evaluate(() => document.getElementById("btnRoomStart").disabled));

    console.log("\nQuick join");
    let C = await open(browser, base, b.port, "Cy"); all.push(C);
    await C.page.click("#btnQuickTitle");
    const quickIn = await soft(until(C.page, (c) => window.MS.mpui.inRoom() && document.getElementById("roomCode").textContent === c && /Ada/.test(document.getElementById("roomPlayers").textContent), code, 30000));
    check("Quick join finds the waiting room", quickIn);
    await shot(A.page, "mp-03-room");
    await C.page.click("#btnRoomLeave");
    await until(A.page, () => !/Cy/.test(document.getElementById("roomPlayers").textContent));
    check("leaving takes the name off the host's list", true);
    // three pages of software WebGL on one machine crawl; Cy comes back later
    await C.ctx.close();
    all.splice(all.indexOf(C), 1);

    /* ---------------- free for all ---------------- */
    console.log("\nFree for all");
    await B.page.click("#btnRoomReady");
    await until(A.page, () => !document.getElementById("btnRoomStart").disabled);
    await A.page.click("#btnRoomStart");
    await until(A.page, () => window.MS.S.mode === "pvp" && window.MS.S.remotes.length === 1);
    await until(B.page, () => window.MS.S.mode === "pvp" && window.MS.S.remotes.length === 1);
    check("start puts both in the match", true);
    await until(A.page, () => window.MS.S.remotes[0].heard);
    await until(B.page, () => window.MS.S.remotes[0].heard);
    // two spots nine metres apart with nothing solid between them
    const spots = await A.page.evaluate(() => {
      const W = window.MS.S.world;
      for (let r = 0; r < 20; r += 2) for (let k = 0; k < 24; k++) {
        const bx = Math.cos(k) * r, bz = Math.sin(k) * r;
        for (let j = 0; j < 12; j++) {
          const a = j / 12 * Math.PI * 2, ax = bx + Math.cos(a) * 9, az = bz + Math.sin(a) * 9;
          if (W.inside(bx, bz, 3) && W.inside(ax, az, 3) && !W.hitCollider(bx, bz, 1) && !W.hitCollider(ax, az, 1) && W.clearLine(ax, az, bx, bz)) return { ax, az, bx, bz };
        }
      }
      return { ax: 0, az: 6, bx: 0, bz: -3 };
    });
    await A.page.evaluate((p) => { const P = window.MS.S.player; P.x = p.ax; P.z = p.az; P.iframe = 0; }, spots);
    await B.page.evaluate((p) => { const P = window.MS.S.player; P.x = p.bx; P.z = p.bz; P.iframe = 0; P.vx = P.vz = 0; }, spots);
    await until(A.page, (p) => { const Q = window.MS.S.remotes[0]; return Math.abs(Q.x - p.bx) < 0.5 && Math.abs(Q.z - p.bz) < 0.5; }, spots);
    check("each sees the other where they stand", true);
    const hp0 = await B.page.evaluate(() => window.MS.S.player.hp);
    // a real cast: Ada holds the mouse on Bo
    await A.page.evaluate(() => { window.MS.S.player.iframe = 0; });
    // the camera is still gliding after the move, so keep the cursor on Bo, as a hand would
    const aimAt = () => A.page.evaluate(async () => { const g = await import("./js/gfx.js"); const Q = window.MS.S.remotes[0]; return g.worldToScreen(Q.x, 1, Q.z, {}); });
    await until(A.page, async () => { const g = await import("./js/gfx.js"), P = window.MS.S.player; return Math.hypot(g.camState.x - P.x, g.camState.z - P.z) < 3; });
    let hit = false;
    for (let i = 0; i < 20 && !hit; i++) {
      const aim = await aimAt();
      await A.page.mouse.move(aim.x, aim.y);
      await A.page.mouse.down();
      for (let k = 0; k < 5 && !hit; k++) {
        await A.page.waitForTimeout(200);
        const again = await aimAt();
        await A.page.mouse.move(again.x, again.y);
        hit = await B.page.evaluate((h) => window.MS.S.player.hp < h || !window.MS.S.player.alive, hp0);
      }
      await A.page.mouse.up();
    }
    check("a spell cast on one screen hurts the mage on the other", hit, hp0 + " -> " + await B.page.evaluate(() => window.MS.S.player.hp));
    await until(A.page, () => window.MS.S.remotes[0].hp < window.MS.S.remotes[0].maxHp || !window.MS.S.remotes[0].alive);
    check("the caster sees the victim's health drop", true);
    // finish Bo off by Ada's hand, three times
    for (let k = 1; k <= 3; k++) {
      await until(B.page, () => window.MS.S.player.alive);
      await B.page.evaluate(() => { const P = window.MS.S.player; P.iframe = 0; P.hurt(1e6, 0, "Ada", 0, 1); });
      if (k === 1) {
        await until(A.page, () => window.MS.S.match.score.k[1] === 1);
        check("the victim names the killer, and the host scores it", true);
        check("the score is on the HUD", await soft(until(A.page, () => /You 1/.test(document.getElementById("objective").textContent), null, 5000)), await A.page.textContent("#objective"));
        await until(B.page, () => /Back in/.test(document.getElementById("netLine").textContent));
        check("the fallen mage is told when they are back", true);
        await until(B.page, () => window.MS.S.player.alive, null, 10000);
        check("and comes back by themselves", true);
      }
    }
    await until(A.page, () => !document.getElementById("scr-results").hidden);
    await until(B.page, () => !document.getElementById("scr-results").hidden);
    check("the kill count ends the match for everyone", /You win/.test(await A.page.textContent("#resTitle")) && /Ada wins/.test(await B.page.textContent("#resTitle")));
    await shot(B.page, "mp-04-results");
    await A.page.click("#btnResBack");
    await B.page.click("#btnResBack");
    await until(A.page, () => !document.getElementById("scr-room").hidden && window.MS.S.mode === "title");
    await until(B.page, () => !document.getElementById("scr-room").hidden);
    check("both are back in the room", true);

    /* ---------------- co-op ---------------- */
    console.log("\nCo-op climb, with fog of war");
    await A.page.click("#btnRoomEdit");
    await A.page.click('#rsMode [data-mode="coop"]');
    await A.page.check("#rsFog");
    await A.page.click("#btnRoomsetGo");
    await until(B.page, () => /Co-op/.test(document.getElementById("roomDesc").textContent) && /fog/.test(document.getElementById("roomDesc").textContent));
    check("the host's new setup reaches the guest", true);
    const ready = await B.page.evaluate(() => window.MS.mpui && document.getElementById("btnRoomReady").textContent);
    if (/^Ready/.test(ready.trim())) await B.page.click("#btnRoomReady");
    await until(A.page, () => !document.getElementById("btnRoomStart").disabled);
    await A.page.click("#btnRoomStart");
    await until(A.page, () => window.MS.S.mode === "coop" && window.MS.S.world && window.MS.S.enemies.length > 5);
    await until(B.page, () => window.MS.S.mode === "coop" && window.MS.S.enemies.length > 5);
    const counts = [await A.page.evaluate(() => window.MS.S.enemies.filter((e) => e.alive).length), await B.page.evaluate(() => window.MS.S.enemies.filter((e) => e.alive).length)];
    check("the host's enemies appear on the client", Math.abs(counts[0] - counts[1]) <= 2, counts.join(" vs "));
    check("both stand on the same floor", await A.page.evaluate(() => window.MS.S.seed) === await B.page.evaluate(() => window.MS.S.seed));
    await A.page.evaluate(() => { window.MS.S.player.iframe = 1e9; });
    await B.page.evaluate(() => { window.MS.S.player.iframe = 1e9; });
    const near = await soft(until(B.page, () => {
      const S = window.MS.S;
      return S.enemies.some((e) => e.alive && e.nx !== undefined);
    }));
    check("client enemies follow the host's snapshots", near);
    check("fog of war is drawn", await B.page.evaluate(() => !document.getElementById("fog").hidden));
    const far = await soft(until(B.page, () => window.MS.S.enemies.some((e) => e.alive && e.fogHidden)));
    check("what is out of sight is not drawn", far);
    await shot(B.page, "mp-05-coop-fog");
    // the host severs the anchors; the client sees each fall, and the portal open
    const nids = await A.page.evaluate(async () => {
      const S = window.MS.S, m = await import("./js/enemies.js");
      const a = S.enemies.filter((e) => e.type === "anchor" && e.alive);
      for (const e of a) m.hurtEnemy(e, 1e6);
      return a.map((e) => e.nid);
    });
    await until(B.page, (n) => n.every((id) => !window.MS.S.enemies.some((e) => e.nid === id && e.alive)), nids);
    check("an enemy that dies on the host dies on the client", true);
    await until(B.page, () => window.MS.S.objective && window.MS.S.objective.done === 3);
    check("the objective follows", true);
    await until(B.page, () => window.MS.S.portal && window.MS.S.portal.on);
    check("the portal opens for the client too", true);
    // Bo stands in the portal: a countdown, then the room goes up together
    await B.page.evaluate(() => { const S = window.MS.S; S.player.x = S.portal.x; S.player.z = S.portal.z; });
    await until(A.page, () => /Going up/.test(document.getElementById("netLine").textContent));
    check("one mage in the portal starts a countdown", true);
    await until(A.page, () => window.MS.S.floor === 2, null, 20000);
    await until(B.page, () => window.MS.S.floor === 2, null, 20000);
    check("the whole room goes up to floor two", await A.page.evaluate(() => window.MS.S.seed) === await B.page.evaluate(() => window.MS.S.seed));
    await until(B.page, () => window.MS.S.boss && window.MS.S.boss.type === "warden");
    check("the client knows the floor's Warden", true);
    // Bo falls; Ada stands beside him and stands him up
    await B.page.evaluate(() => { const P = window.MS.S.player; P.iframe = 0; P.hurt(1e6, 0, "a test"); });
    await until(A.page, () => !window.MS.S.remotes[0].alive);
    await until(B.page, () => /Watching Ada/.test(document.getElementById("netLine").textContent));
    check("a fallen mage watches a friend", true);
    await A.page.evaluate(() => { const S = window.MS.S, Q = S.remotes[0]; S.player.x = Q.x + 1; S.player.z = Q.z; });
    await until(B.page, () => window.MS.S.player.alive, null, 15000);
    check("standing beside them stands them up", true);
    for (let i = 0; i < 12 && await A.page.evaluate(() => !document.getElementById("scr-boons").hidden); i++) await A.page.click("#boonCards .card").catch(() => {});
    check("in a match, boon cards do not pause the room", await A.page.evaluate(() => !window.MS.S.paused));
    await A.page.keyboard.press("Escape");
    await until(A.page, () => !document.getElementById("scr-pause").hidden);
    check("the pause sheet shows the room and does not pause it", await A.page.evaluate(() => !document.getElementById("pauseBoard").hidden && !window.MS.S.paused && window.MS.S.uiOpen));
    await shot(A.page, "mp-06-pause");
    await A.page.keyboard.press("Escape");

    /* ---------------- wipe out ---------------- */
    console.log("\nWipe Out");
    // the host leaves the match's room screen by ending: set up a new match
    await A.page.evaluate(() => { window.MS.net.currentRoom().setPhase("lobby"); });
    await A.page.evaluate(() => { const r = window.MS.net.currentRoom(); r.setSettings(Object.assign({}, r.settings, { mode: "wipeout", target: 2, fog: false })); });
    await until(B.page, () => window.MS.net.currentRoom().settings.mode === "wipeout");
    await A.page.evaluate(() => window.MS.net.hostStart());
    await until(A.page, () => window.MS.S.mode === "pvp" && window.MS.S.match.mode === "wipeout");
    await until(B.page, () => window.MS.S.mode === "pvp" && window.MS.S.match.mode === "wipeout");
    const teams = [await A.page.evaluate(() => window.MS.S.player.team), await B.page.evaluate(() => window.MS.S.player.team)];
    check("the teams are balanced, one each", teams[0] !== teams[1], teams.join(","));
    await until(B.page, () => window.MS.S.player.alive && window.MS.S.match.round === 1);
    await B.page.evaluate(() => { const P = window.MS.S.player; P.iframe = 0; P.hurt(1e6, 0, "Ada", 0, 1); });
    await until(A.page, () => window.MS.S.match.score.r.some((n) => n === 1));
    check("a wiped team loses the round", true);
    await until(B.page, () => window.MS.S.player.alive && window.MS.S.match.round === 2, null, 15000);
    check("the next round stands everyone up", true);
    await B.page.evaluate(() => { const P = window.MS.S.player; P.iframe = 0; P.hurt(1e6, 0, "Ada", 0, 1); });
    await until(B.page, () => !document.getElementById("scr-results").hidden, null, 15000);
    check("the target in rounds wins the match", /win/.test(await B.page.textContent("#resTitle")));

    /* ---------------- the server changes hands ---------------- */
    console.log("\nA server changing hands");
    const holderIsA = await A.page.evaluate(() => window.MS.lobby.directory("VERD01").state === "holding");
    check("the room's host was holding the server", holderIsA);
    C = await open(browser, base, b.port, "Cy"); all.push(C);
    await C.page.click("#btnMulti");
    await until(C.page, () => window.MS.lobby.directory("VERD01").state === "joined");
    const Cdir = await C.page.evaluate(() => window.MS.lobby.directory("VERD01").state);
    await A.ctx.close();
    all.splice(all.indexOf(A), 1);
    const state = (p) => p.evaluate(() => { const d = window.MS.lobby.directory("VERD01"); return d ? d.state : "none"; });
    const t0 = Date.now();
    let who = [];
    while (Date.now() - t0 < 60000) {
      who = [await state(B.page), await state(C.page)];
      if (who.filter((x) => x === "holding").length === 1 && who.every((x) => x === "holding" || x === "joined")) break;
      await C.page.waitForTimeout(500);
    }
    check("one of the others takes the server over, the other joins them", who.filter((x) => x === "holding").length === 1 && who.every((x) => x === "holding" || x === "joined"), Cdir + " -> " + who.join(","));
    const told = await soft(until(B.page, () => /closed/.test(document.getElementById("mpStatus").textContent), null, 60000));
    check("the guest is told the room closed", told, await B.page.textContent("#mpStatus"));

    /* ---------------- a phone ---------------- */
    console.log("\nPhone, held upright");
    for (const p of all.splice(0)) await p.ctx.close();
    const ph = await (async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push("phone: " + e.message));
      await page.addInitScript((port) => {
        window.MS_BROKERS = [{ host: "127.0.0.1", port, path: "/", key: "peerjs" }];
        window.MS_ICE = { iceServers: [] };
        localStorage.setItem("msandbox:debug", "1");
        localStorage.setItem("msandbox:v2", JSON.stringify({ settings: { quality: "low", music: 0, sfx: 0 }, name: "Pip" }));
      }, b.port);
      await page.goto(base + "/index.html");
      await page.waitForFunction(() => window.MS && window.MS.S.mode === "title", null, { timeout: 60000 });
      return { ctx, page, errors, name: "phone" };
    })();
    all.push(ph);
    const fits = () => ph.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    check("the title's multiplayer buttons fit", await fits() && await ph.page.isVisible("#btnQuickTitle"));
    await ph.page.tap("#btnMulti");
    check("the server list fits a phone", await fits());
    await ph.page.tap('[data-server="EMBR02"]');
    await ph.page.tap("#btnCreateRoom");
    await ph.page.tap('#rsMode [data-mode="tdm"]');
    const go = await ph.page.locator("#btnRoomsetGo").boundingBox();
    check("room setup fits a phone", await fits() && go && go.x + go.width <= 390);
    await shot(ph.page, "mp-07-phone-setup");
    await ph.page.tap("#btnRoomsetGo");
    await until(ph.page, () => !document.getElementById("scr-room").hidden);
    check("a team room fits a phone", await fits());
    await shot(ph.page, "mp-08-phone-room");
    await ph.page.tap("#btnRoomLeave");
    await until(ph.page, () => !document.getElementById("scr-servers").hidden);
    check("leaving is one tap back to the servers", true);

    const errs = all.flatMap((p) => p.errors).concat(A.errors);
    check("no errors in any browser", errs.length === 0, errs.slice(0, 6).join(" | "));
  } catch (e) {
    failures++;
    console.log("  ✗ " + e.message.split("\n")[0]);
    for (const p of all) if (p.errors.length) console.log("    " + p.name + " errors: " + p.errors.slice(0, 4).join(" | "));
  } finally {
    await browser.close();
    srv.close();
    b.server.close();
  }
  console.log("\n" + checks + " checks, " + failures + " failed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
/* ============================================================
   Magic Sandbox — how survivable is a climb?
   `node tools/balance.js [floors=6] [runs=3] [normal|bad]`

   A bot plays real floors in a real browser and reports, per floor, how long
   it took, how much damage it took, how many potions it drank, and the level
   and circle rank it left with. "normal" notices most announced attacks and
   steps out of them; "bad" notices about a third. It only ever casts the four
   starter pages, so it is a floor for difficulty, not a ceiling: a player who
   redraws their pages as their rank grows does better.

   The game loop is stepped directly at 60 steps a simulated second and never
   rendered, which is what makes minutes of play take seconds here. Tune
   numbers in enemies.js, themes.js and spellcore.js, then run this and
   compare. Needs Playwright, like tools/e2e.js; skipped where it is missing.
   ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
for (const where of ["playwright", path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "playwright")]) {
  try { ({ chromium } = require(where)); break; } catch (e) {}
}
if (!chromium) { console.log("playwright is not installed here; skipping."); process.exit(0); }

const ROOT = path.resolve(__dirname, "..");
const FLOORS = +(process.argv[2] || 6), RUNS = +(process.argv[3] || 3), SKILL = process.argv[4] || "normal";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".glb": "model/gltf-binary", ".webmanifest": "application/manifest+json" };

const srv = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split("?")[0]);
  const file = path.join(ROOT, u === "/" ? "index.html" : u);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

srv.listen(0, "127.0.0.1", async () => {
  const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await b.newPage({ viewport: { width: 320, height: 240 } });
  p.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await p.addInitScript(() => { localStorage.setItem("msandbox:debug", "1"); localStorage.setItem("msandbox:v2", JSON.stringify({ settings: { quality: "low", music: 0, sfx: 0 } })); });
  await p.goto("http://127.0.0.1:" + srv.address().port + "/index.html");
  await p.waitForFunction(() => window.MS && window.MS.S.mode === "title", null, { timeout: 60000 });
  for (let run = 0; run < RUNS; run++) {
    const res = await p.evaluate(async ({ FLOORS, SKILL }) => {
      const MS = window.MS, S = MS.S, game = MS.game;
      const { on } = await import('./js/state.js');
      // headless boon picks: take the first card the moment one is offered
      if (!window.__botHooked) { on('offerBoons', (c) => { setTimeout(() => { const card = document.querySelector('#boonCards .card'); if (card) card.click(); }, 0); }); window.__botHooked = true; }
      document.querySelectorAll('.screen').forEach((s) => s.hidden = true);
      game.startRun(false);
      const stats = []; let floorStart = 0, dmgTaken = 0, potions = 0, frame = 0;
      on('playerHurt', (d) => { dmgTaken += d; });
      on('potion', () => potions++);
      const dt = 1 / 60;
      const inp = { mx: 0, mz: 0, aimAng: null, aimX: null, aimZ: null, autoAim: false, cast: false, dash: false, trigger: false, interact: false, potion: false, select: -1, cycle: 0 };
      const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
      let strafe = 1, curFloor = S.floor, stuckT = 0, lastPos = null, detour = null;
      const react = SKILL === 'bad' ? 0.35 : 0.9;   // chance to notice a telegraph each frame it matters
      for (frame = 0; frame < 60 * 60 * 14 && S.floor <= FLOORS; frame++) {
        if (S.paused) { const card = document.querySelector('#boonCards .card'); if (card) card.click(); else { document.querySelectorAll('.screen').forEach(s => s.hidden = true); S.paused = false; } continue; }
        const P = S.player;
        if (!P.alive || S.over) break;
        if (S.floor !== curFloor) { stats.push({ floor: curFloor, secs: Math.round((frame - floorStart) / 60), dmg: Math.round(dmgTaken), potions, lvl: P.level, rank: P.rank }); curFloor = S.floor; floorStart = frame; dmgTaken = 0; potions = 0; }
        Object.assign(inp, { mx: 0, mz: 0, aimAng: null, cast: false, dash: false, trigger: false, interact: false, potion: false, select: -1 });
        // pick a target: nearest awake enemy, else the objective
        let tgt = null, td = 1e9;
        for (const e of S.enemies) { if (!e.alive || e.type === 'geode' || e.type === 'dummy') continue; if (e.boss && e.state === 'sleep') continue; const d = dist(P, e); const w = e.aggro || e.type === 'anchor' ? d : d + 12; if (w < td) { td = w; tgt = e; } }
        let goal = null;
        if (S.portal && S.portal.on) goal = S.portal;
        else if (S.boss && S.boss.state === 'sleep') goal = S.world.arena;
        else if (tgt) goal = tgt;
        // move
        let mx = 0, mz = 0;
        if (goal === S.portal || (goal === S.world.arena && !(tgt && tgt.aggro && dist(P, tgt) < 12))) { const a = Math.atan2(goal.z - P.z, goal.x - P.x); mx = Math.cos(a); mz = Math.sin(a); }
        else if (tgt) {
          const d = dist(P, tgt), a = Math.atan2(tgt.z - P.z, tgt.x - P.x);
          const want = tgt.type === 'anchor' ? 6 : tgt.boss ? 8 : tgt.type === 'spindle' ? 8 : 7;
          if (d > want + 2) { mx = Math.cos(a); mz = Math.sin(a); }
          else if (d < want - 2) { mx = -Math.cos(a); mz = -Math.sin(a); }
          else { if (Math.random() < 0.01) strafe = -strafe; mx = Math.cos(a + Math.PI / 2 * strafe); mz = Math.sin(a + Math.PI / 2 * strafe); }
          inp.aimAng = a; inp.cast = d < 15;
          // spell choice
          const near = S.enemies.filter(e => e.alive && e.aggro && dist(P, e) < 7).length;
          inp.select = near >= 3 ? 1 : (d < 3 ? 3 : (tgt.type === 'golem' || tgt.boss || tgt.type === 'anchor') ? 2 : 0);
        }
        // dodge what is announced
        for (const e of S.enemies) {
          if (!e.alive || Math.random() > react) continue;
          const d = dist(P, e), away = Math.atan2(P.z - e.z, P.x - e.x);
          const side = away + Math.PI / 2;
          if (e.type === 'knot' && e.state === 'wind' && d < 9) { mx = Math.cos(side); mz = Math.sin(side); if (d < 4 && P.dashCd <= 0) inp.dash = true; }
          if (e.type === 'golem' && e.state === 'raise' && d < 5) { mx = Math.cos(away); mz = Math.sin(away); }
          if (e.boss && e.act) {
            const A = e.act;
            if ((A.name === 'slam' && A.step === 1) || (A.name === 'blink' && A.step === 2)) { if (d < 6) { mx = Math.cos(away); mz = Math.sin(away); if (d < 4 && P.dashCd <= 0) inp.dash = true; } }
            if ((A.name === 'charge' && A.step === 1) || (A.name === 'lances' && A.step === 1)) { mx = Math.cos(side); mz = Math.sin(side); }
            if (A.name === 'rain' && A.drops) for (const dr of A.drops) if (dr.t > 0 && dist(P, dr) < 2.4) { const aw = Math.atan2(P.z - dr.z, P.x - dr.x); mx = Math.cos(aw); mz = Math.sin(aw); }
          }
        }
        // bolts: sidestep ones heading at us
        for (const q of S.eshots) { const d = dist(P, q); if (d < 3 && Math.random() < react) { const a = Math.atan2(q.vz, q.vx); mx = Math.cos(a + Math.PI / 2 * strafe); mz = Math.sin(a + Math.PI / 2 * strafe); } }
        // get unstuck
        if (lastPos && frame % 30 === 0) { if (dist(P, lastPos) < 0.4 && (mx || mz)) stuckT++; else stuckT = 0; lastPos = { x: P.x, z: P.z }; }
        if (!lastPos) lastPos = { x: P.x, z: P.z };
        if (stuckT > 2) { detour = { a: Math.random() * 6.28, t: 60 }; stuckT = 0; }
        if (detour && detour.t-- > 0) { mx = Math.cos(detour.a); mz = Math.sin(detour.a); }
        const m = Math.hypot(mx, mz) || 1; inp.mx = mx / m; inp.mz = mz / m;
        if (P.hp < P.maxHp * 0.4 && P.potions > 0) inp.potion = true;
        // shrines and chests on the way
        const prop = S.props.find(q => !q.used && q.kind !== 'portal' && dist(P, q) < 2.5);
        if (prop && (prop.kind === 'chest' || P.hp < P.maxHp * 0.7)) inp.interact = true;
        game.update(dt, inp); MS.fx.update(dt);
      }
      const P = S.player;
      return { reached: S.floor, alive: P.alive, killedBy: P.killedBy, minutes: +(frame / 3600).toFixed(1), lvl: P.level, boons: Object.keys(P.boons).length, stats };
    }, { FLOORS, SKILL });
    console.log("\nrun " + (run + 1) + ": " + (res.alive ? "alive" : "fell to " + res.killedBy) + " on floor " + res.reached + " after " + res.minutes + " min, level " + res.lvl + ", " + res.boons + " boons");
    for (const f of res.stats) console.log("  floor " + String(f.floor).padStart(2) + "  " + String(f.secs).padStart(4) + "s  " + String(f.dmg).padStart(4) + " damage taken  " + f.potions + " potions  level " + f.lvl + "  rank " + f.rank);
  }
  await b.close();
  srv.close();
});

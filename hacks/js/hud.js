/* hud.js — what is drawn over the game: health, ammo, the crosshair, the
 * kill feed, the score, where damage came from, and your speed. Beside the
 * crosshair, small and only while they mean something: a reload or a bolt
 * being worked (inside the scope too, which shakes while it is), the
 * grapple's pull, and how much harder your blade hits at this speed. Under
 * it, your kills' medals (medals.js) — the big ones once more across the
 * middle.
 *
 * It only listens (state.js events) and reads S; nothing here changes the
 * match. Enemies get no name tags and no outlines — seeing through walls is
 * what hacks are for, and the hacks panel is one key away. */

import { S, on } from "./state.js";
import { save } from "./save.js";
import { GUNS, MELEE, GRAPPLE, gunOf, spreadOf, zoomOf, boltOf, speedBonus, heldName } from "./weapons.js";
import { LUNGE, HOOK, PM, lungeFactor, lookDir } from "./movement.js";
import { MODES, TEAMS } from "./modes.js";
import { icon } from "./icons.js";
import { $, escHtml } from "./util.js";
import { worldToScreen, view } from "./render.js";
import { isEnemy } from "./game.js";

let hitT = 0, hitHead = false, hitKill = false, hurtT = 0, toastT = 0, fpsAcc = 0, fpsN = 0, fpsShow = 0;
/* Your kills: one line under the crosshair with their medals, and the loudest of them across the middle. */
let noteT = 0, medalT = 0;
const dmgArcs = [];
let lastHud = {};

function set(id, v) { if (lastHud[id] !== v) { lastHud[id] = v; const el = $(id); if (el) el.textContent = v; } }

export function show(on) {
  $("hud").hidden = !on;
  document.body.classList.toggle("inGame", !!on);
  if (!on) { $("scoreboard").hidden = true; $("scope").hidden = true; $("tags").innerHTML = ""; $("medal").hidden = true; }
}

function clock(t) { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }

export function scoreLine() {
  const m = S.match;
  if (!m) return "";
  const sc = m.score, M = MODES[m.mode];
  if (m.mode === "practice") return "dummies never shoot back";
  if (M.teams) return TEAMS[0].name + " " + sc.tk[0] + " — " + sc.tk[1] + " " + TEAMS[1].name + " · to " + sc.target;
  const me = S.me ? sc.k[S.me.id] || 0 : 0;
  let top = 0;
  for (const id in sc.k) top = Math.max(top, sc.k[id]);
  return "You " + me + " · best " + top + " · to " + sc.target;
}

export function update(dt) {
  const a = S.me, m = S.match;
  if (!a || !m) return;
  // frame rate
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { fpsShow = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
  $("fps").hidden = !save.settings.showFps;
  if (save.settings.showFps) set("fps", fpsShow + " fps");

  set("modeName", MODES[m.mode].short);
  set("scoreLine", scoreLine());
  set("clock", m.settings.time ? clock(m.timeLeft) : "");
  // health
  const hp = Math.max(0, Math.ceil(a.hp));
  set("hpN", String(hp));
  const f = $("hpF");
  const w = (hp / a.maxHp * 100).toFixed(1) + "%";
  if (f.style.width !== w) f.style.width = w;
  $("hpF").classList.toggle("low", hp < 35);
  // speed
  const hs = Math.hypot(a.body.vx, a.body.vz);
  $("speedo").hidden = !save.settings.showSpeed;
  set("speedN", hs.toFixed(1));
  $("speedo").classList.toggle("fast", hs > 9);
  // weapon
  const A = a.arms, g = gunOf(A);
  if (g) {
    set("ammoN", A.reloadT > 0 ? "···" : String(A.ammo[A.cur]));
    set("ammoMag", "/ " + g.mag);
    set("gunName", g.name);
  } else { set("ammoN", ""); set("ammoMag", ""); set("gunName", heldName(A)); }
  const slotsKey = A.slots.join() + A.melee + A.cur;
  if (lastHud.slots !== slotsKey) {
    lastHud.slots = slotsKey;
    $("slots").innerHTML = [GUNS[A.slots[0]].name, GUNS[A.slots[1]].name, MELEE[A.melee].name, GRAPPLE.name].map((n, i) => '<span class="' + (i === A.cur ? "on" : "") + '"><b>' + (i + 1) + "</b>" + escHtml(n) + "</span>").join("");
  }
  // crosshair: gap from spread
  const spread = g ? spreadOf(A, a.body) : 0.8;
  const px = Math.tan(spread * Math.PI / 180) / Math.tan((S.cam.fov || 70) * Math.PI / 360) * view.h / 2;
  const gap = Math.max(3, Math.min(60, px));
  const ch = $("crosshair");
  ch.style.setProperty("--gap", gap.toFixed(1) + "px");
  ch.style.setProperty("--cc", save.settings.crosshair);
  const scoped = !!(g && g.scope && A.ads > 0.9 && a.alive);
  // aimed, the gun's own sights are the crosshair: they sit on the screen's centre (viewmodel.js)
  ch.classList.toggle("hide", (g && A.ads > 0.5) || !a.alive);
  $("scope").hidden = !scoped;
  const bolt = a.alive ? boltOf(A) : 0;
  if (scoped) {
    // the bolt being worked shakes the glass: a jolt as it fires, then the throw of the handle
    const t = performance.now() / 1000, k = g.bolt || 0;
    const e = bolt <= 0 ? 0 : bolt < 0.12 ? 1 : Math.sin(Math.min(1, (bolt - 0.12) / 0.8) * Math.PI) * 0.7;
    const dx = e * k * (Math.sin(t * 41) * 7 + Math.sin(t * 17) * 4), dy = e * k * (Math.sin(t * 29 + 1) * 6 + (bolt < 0.12 ? 14 * (1 - bolt / 0.12) : 0));
    const sc = $("scope");
    const tf = "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px) rotate(" + (e * k * Math.sin(t * 13) * 2.2).toFixed(2) + "deg)";
    if (sc.style.transform !== tf) sc.style.transform = tf;
    set("scopeZoom", Math.round(zoomOf(A) * 10) / 10 + "×");
  }
  // beside the crosshair: a reload, or a bolt being worked
  const cyc = $("cycleRing");
  const reloading = a.alive && g && A.reloadT > 0;
  cyc.hidden = !(reloading || bolt > 0);
  if (!cyc.hidden) {
    const f = reloading ? 1 - A.reloadT / g.reload : bolt;
    $("cycleArc").style.strokeDashoffset = (100.5 * (1 - f)).toFixed(1);
    const ico = reloading ? "reload" : "cycle";
    if (cyc.dataset.ico !== ico) { cyc.dataset.ico = ico; $("cycleIco").innerHTML = icon(ico); }
    cyc.classList.toggle("scoped", scoped);
  }
  // the grapple: flying, then how much of the pull is done
  const hb = a.body, hk = $("hookInd");
  hk.hidden = !a.alive || hb.hook === HOOK.IDLE;
  if (!hk.hidden) {
    let txt = "···";
    if (hb.hook === HOOK.ON) {
      const d = Math.hypot(hb.hx - hb.x, hb.hy - hb.y - 0.9, hb.hz - hb.z);
      txt = Math.round(100 * Math.max(0, Math.min(1, 1 - (d - PM.hookDone) / Math.max(0.1, (hb.hStart || d) - PM.hookDone)))) + "%";
    }
    set("hookTxt", txt);
    hk.classList.toggle("grab", hb.hook === HOOK.ON && hb.hTarget >= 0);
  }
  // a blade: how much harder it hits at this speed, and lines streaming past when you are flying with it
  const v3 = Math.hypot(hb.vx, hb.vy, hb.vz), bonus = speedBonus(v3);
  const mm = $("meleeMul");
  const blade = a.arms.cur === 2;
  mm.hidden = !a.alive || !blade || bonus < 1.05;
  if (!mm.hidden) { set("meleeMul", "×" + bonus.toFixed(1)); mm.classList.toggle("hot", bonus >= 2); }
  const rush = a.alive && blade ? Math.max(hb.lunge === LUNGE.DASH ? 0.75 : 0, Math.min(1, (v3 - 8) / 10)) : 0;
  const sl = $("speedLines"), op = rush > 0.02 ? rush.toFixed(2) : "0";
  if (sl.style.opacity !== op) sl.style.opacity = op;
  // lunge
  const body = a.body;
  const ring = $("lungeRing");
  if (body.lunge === LUNGE.CHARGE) {
    ring.hidden = false;
    const dir = lookDir(S.view.yaw, S.view.pitch);
    const k = lungeFactor(body.lungeCharge, body.lungeStuck, body.lnx, body.lny, body.lnz, dir);
    $("lungeArc").style.strokeDashoffset = (163.4 * (1 - body.lungeCharge)).toFixed(1);
    ring.classList.toggle("stuck", body.lungeStuck);
    set("lungeTxt", Math.round(k * 100) + "%");
  } else ring.hidden = true;
  // hit marker, hurt flash
  hitT = Math.max(0, hitT - dt);
  const hm = $("hitmark");
  hm.style.opacity = hitT > 0 ? Math.min(1, hitT * 6) : 0;
  hm.classList.toggle("head", hitHead);
  hm.classList.toggle("kill", hitKill && hitT > 0);
  noteT = Math.max(0, noteT - dt);
  const kn = $("killNote");
  kn.classList.toggle("fade", noteT < 0.4);
  if (noteT <= 0) kn.hidden = true;
  medalT = Math.max(0, medalT - dt);
  if (medalT <= 0) $("medal").hidden = true;
  else $("medal").classList.toggle("fade", medalT < 0.35);
  hurtT = Math.max(0, hurtT - dt);
  $("hurtFlash").style.opacity = (hurtT * 1.6).toFixed(2);
  // damage direction
  for (let i = dmgArcs.length - 1; i >= 0; i--) {
    const d = dmgArcs[i];
    d.t -= dt;
    if (d.t <= 0) { d.el.remove(); dmgArcs.splice(i, 1); continue; }
    const src = S.actors.find((x) => x.id === d.from);
    if (src) d.ang = Math.atan2(src.body.x - a.body.x, src.body.z - a.body.z);
    const rel = d.ang - Math.atan2(-Math.sin(S.view.yaw), -Math.cos(S.view.yaw));
    d.el.style.transform = "translate(-50%,-50%) rotate(" + (-rel * 180 / Math.PI).toFixed(1) + "deg)";
    d.el.style.opacity = Math.min(1, d.t);
  }
  // respawn line
  const cm = $("centerMsg");
  if (!a.alive && !m.over) { cm.hidden = false; set("centerMsg", "Back in " + Math.max(0, Math.ceil(a.respawnT)) + (a.lastAttacker && S.spectate ? " · " + S.spectate.name + " got you" : "")); }
  else cm.hidden = true;
  toastT -= dt;
  if (toastT <= 0) $("toast").hidden = true;
  $("hackChip").hidden = !S.hackCount;
  if (S.hackCount) set("hackChipN", S.hackCount + (S.hackCount === 1 ? " hack" : " hacks"));
  tags();
  if (!$("scoreboard").hidden) scoreboard();
}

/* Teammates get a name over their head; enemies never do. */
const scr = {};
function tags() {
  const layer = $("tags");
  const M = S.match && MODES[S.match.mode];
  const want = [];
  if (M && M.teams && S.me) for (const b of S.actors) if (b !== S.me && b.alive && b.heard && !isEnemy(S.me, b)) want.push(b);
  while (layer.childElementCount < want.length) { const d = document.createElement("div"); d.className = "ntag"; layer.appendChild(d); }
  [...layer.children].forEach((d, i) => {
    const b = want[i];
    if (!b) { d.style.display = "none"; return; }
    worldToScreen(b.body.x, b.body.y + 2.1, b.body.z, scr);
    if (scr.behind) { d.style.display = "none"; return; }
    if (d.textContent !== b.name) d.textContent = b.name;
    d.style.display = "block";
    d.style.transform = "translate(" + scr.x.toFixed(0) + "px," + scr.y.toFixed(0) + "px) translate(-50%,-100%)";
  });
}

function killNote(m) {
  const el = $("killNote");
  const chips = m.list.map((x) => '<span class="medal t' + x.tier + '">' + (x.id === "nut" ? icon("nut") : x.id === "head" ? icon("head") : "") + escHtml(x.text) + "</span>").join("");
  el.innerHTML = "<span>" + escHtml(m.victim.name) + " down</span>" + chips;
  el.hidden = false;
  el.classList.remove("fade");
  el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
  noteT = 1.8 + 0.25 * m.list.length;
  hitT = 0.4; hitKill = true;
  // the loudest medal, once more across the middle of the screen
  const top = m.list.filter((x) => x.tier >= 3).sort((x, y) => y.pri - x.pri)[0];
  if (top) {
    const big = $("medal");
    big.innerHTML = (top.id === "nut" ? icon("nut") : "") + escHtml(top.text);
    big.className = top.id === "nut" ? "nut" : "";
    big.hidden = false;
    big.style.animation = "none"; void big.offsetWidth; big.style.animation = "";
    medalT = 1.6;
  }
}

export function toast(text, ms) {
  const t = $("toast");
  t.textContent = text; t.hidden = false;
  toastT = (ms || 2200) / 1000;
}

/* ---------------------------------------------------------------
   The scoreboard: Tab, the pause sheet, the results
   --------------------------------------------------------------- */
export function boardHtml() {
  const m = S.match;
  if (!m) return "";
  const M = MODES[m.mode];
  const rows = S.actors.map((a) => ({ a, k: m.score.k[a.id] || 0, d: m.score.d[a.id] || 0 }));
  rows.sort((x, y) => (M.teams ? x.a.team - y.a.team : 0) || y.k - x.k || x.d - y.d);
  const body = rows.map(({ a, k, d }) => {
    const me = a === S.me ? ' class="me"' : "";
    const dot = M.teams ? '<i class="tdot t' + a.team + '"></i>' : '<i class="tdot" style="background:#' + a.color.toString(16).padStart(6, "0") + '"></i>';
    const tag = a.kind === "bot" ? ' <small class="muted">bot</small>' : "";
    return "<tr" + me + "><td>" + dot + escHtml(a.name) + tag + "</td><td>" + k + "</td><td>" + d + "</td></tr>";
  }).join("");
  return '<table class="board"><tr><th>Player</th><th>Kills</th><th>Deaths</th></tr>' + body + "</table>";
}
function scoreboard() { const el = $("scoreboard"); const h = boardHtml(); if (el.dataset.h !== h) { el.dataset.h = h; el.innerHTML = '<div class="panel">' + h + "</div>"; } }

/* ---------------------------------------------------------------
   Listening
   --------------------------------------------------------------- */
export function init() {
  on("hit", (a, b, dmg, info) => { if (a === S.me) { hitT = 0.28; hitHead = info && info.part === "head"; hitKill = false; } });
  on("hurt", (b, dmg, by) => {
    if (b !== S.me) return;
    hurtT = Math.min(0.5, hurtT + dmg / 120);
    const src = S.actors.find((x) => x.id === by);
    if (!src) return;
    const el = document.createElement("i");
    el.className = "arc";
    const d = { from: by, t: 1.6, ang: Math.atan2(src.body.x - b.body.x, src.body.z - b.body.z), el };
    dmgArcs.push(d);
    $("dmgdir").appendChild(el);
  });
  on("killfeed", (k) => {
    const feed = $("killfeed");
    const row = document.createElement("div");
    const mine = (k.killer && k.killer === S.me) || (k.victim && k.victim === S.me);
    row.className = "kf" + (mine ? " mine" : "");
    const w = GUNS[k.weapon] ? GUNS[k.weapon].name : MELEE[k.weapon] ? MELEE[k.weapon].name : k.weapon === "fall" ? "fell" : "";
    row.innerHTML = (k.killer && k.killer !== k.victim ? "<b>" + escHtml(k.killer.name) + "</b>" : "") +
      '<span class="kw">' + escHtml(w) + (k.head ? icon("head") : "") + (k.nut ? icon("nut") : "") + "</span><b>" + escHtml(k.victim ? k.victim.name : "?") + "</b>";
    feed.prepend(row);
    while (feed.childElementCount > 5) feed.lastChild.remove();
    setTimeout(() => row.remove(), 6000);
    if (k.victim === S.me) S.spectate = k.killer && k.killer !== S.me ? k.killer : null;
  });
  on("medals", killNote);
  on("scoreboard", (v) => { const el = $("scoreboard"); el.hidden = !v || !S.match; if (v) scoreboard(); });
  on("spawn", (a) => { if (a === S.me) { S.spectate = null; for (const d of dmgArcs) d.el.remove(); dmgArcs.length = 0; } });
  on("toast", (t) => toast(t));
  on("quit", () => { lastHud = {}; });
  // the touch layout editor shows the readouts as they will be; outside a match, with stand-in values
  on("touchEditing", () => {
    if (S.match && S.me) return;
    const fill = { modeName: "FFA", scoreLine: "You 0 · best 0 · to 25", clock: "10:00", hpN: "100", speedN: "0.0", ammoN: "28", ammoMag: "/ 28", gunName: "Kestrel AR" };
    for (const id in fill) if (!$(id).textContent) $(id).textContent = fill[id];
    lastHud = {};
  });
  on("matchStart", () => { lastHud = {}; $("killfeed").innerHTML = ""; noteT = 0; medalT = 0; $("killNote").hidden = true; $("medal").hidden = true; });
}

/* hud.js — what is on screen while you play.
 *
 * Top left: health, mana, level, potions. Top centre: the floor and the one
 * thing it wants from you. Top right: a minimap and the two buttons that open
 * things. Bottom: your four pages. That is all that stays up; everything else
 * appears when it matters and leaves — a prompt over a chest you are standing
 * next to, an arrow at the screen edge toward the objective, a banner when a
 * floor starts or a Warden wakes.
 *
 * The old HUD carried a wave countdown, a combo counter, four mana bars, a
 * stamina bar and a paragraph of key bindings. None of those survived. */

import { S, on, emit } from "./state.js";
import { worldToScreen } from "./gfx.js";
import { icon, hydrateIcons } from "./icons.js";
import { thumbnail } from "./glyphart.js";
import { save, SLOTS } from "./save.js";
import { xpNeed } from "./player.js";
import { elementInfo, REACTIONS, FORMS, ELEMENTS } from "./spellcore.js";
import { interactTarget } from "./game.js";
import { pendingPayloads } from "./spells.js";
import { device, selectSlot } from "./input.js";
import { dummyDps } from "./enemies.js";
import { fmtTime, clamp, escHtml } from "./util.js";

const $ = (id) => document.getElementById(id);
const cache = {};
function set(id, prop, val) {
  const k = id + prop;
  if (cache[k] === val) return;
  cache[k] = val;
  const el = $(id);
  if (!el) return;
  if (prop === "text") el.textContent = val;
  else if (prop === "html") el.innerHTML = val;
  else if (prop === "hidden") el.hidden = val;
  else el.style[prop] = val;
}

/* ---------------------------------------------------------------
   Spell bar
   --------------------------------------------------------------- */
const thumbs = {};
let slotEls = [];
export function buildSpellbar() {
  const bar = $("spellbar");
  bar.innerHTML = "";
  slotEls = [];
  for (let i = 0; i < SLOTS; i++) {
    const b = document.createElement("button");
    b.className = "slot";
    b.setAttribute("aria-label", "Spell " + (i + 1));
    b.innerHTML = '<span class="thumb"></span><span class="cdw"></span><span class="key">' + (i + 1) + '</span><span class="cost"></span><span class="lock">' + icon("lock") + "</span>";
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); selectSlot(i); });
    bar.appendChild(b);
    slotEls.push(b);
  }
  refreshSpellbar();
}
export function refreshSpellbar() {
  const P = S.player;
  slotEls.forEach((b, i) => {
    const d = save.spell(i);
    const key = JSON.stringify(d);
    if (thumbs[i] !== key) {
      thumbs[i] = key;
      const t = b.querySelector(".thumb");
      t.innerHTML = "";
      t.appendChild(thumbnail(d, 46));
    }
    const c = P && P.compiled[i];
    b.querySelector(".cost").textContent = c && !(P && P.empty[i]) ? c.cost : "";
    b.classList.toggle("blocked", !!(P && P.blocked[i]));
    b.classList.toggle("empty", !!(P && P.empty[i]));
    b.title = c ? c.name + " · " + c.cost + " mana" : "";
    const el = c && c.elements[0] ? elementInfo(c.elements[0]).color : "#b39dff";
    b.style.setProperty("--el", el);
  });
}

/* ---------------------------------------------------------------
   Toasts and banners
   --------------------------------------------------------------- */
export function toast(msg, ico) {
  const box = $("toasts");
  const d = document.createElement("div");
  d.className = "toast";
  d.innerHTML = (ico ? icon(ico) : "") + "<span>" + escHtml(msg) + "</span>";
  box.appendChild(d);
  setTimeout(() => d.classList.add("out"), 2300);
  setTimeout(() => d.remove(), 2800);
  while (box.children.length > 3) box.firstChild.remove();
}
let bannerT = 0;
export function banner(title, sub, kind) {
  const b = $("banner");
  b.className = "banner show" + (kind ? " " + kind : "");
  b.innerHTML = "<b>" + escHtml(title) + "</b>" + (sub ? "<span>" + escHtml(sub) + "</span>" : "");
  clearTimeout(bannerT);
  bannerT = setTimeout(() => { b.className = "banner"; }, 2600);
}

/* ---------------------------------------------------------------
   Coaching: the first run teaches itself, one line at a time
   --------------------------------------------------------------- */
const COACH = [
  { id: "move", mouse: "Move with W A S D", touch: "Left thumb anywhere: move", pad: "Left stick: move" },
  { id: "cast", mouse: "Hold left click to cast at the cursor", touch: "Right thumb: drag to aim and cast — or just hold", pad: "Hold RT to cast; right stick aims" },
  { id: "swap", mouse: "Press 1 to 4 to try your other spells", touch: "Tap a spell below to switch", pad: "LB / RB switch spells" },
  { id: "dash", mouse: "Space dashes — straight through danger", touch: "DASH goes straight through danger", pad: "A dashes through danger" },
  { id: "book", mouse: "Press B to draw your own spells", touch: "The book (top right) is where you draw spells", pad: "Back opens the spellbook" }
];
let coachIdx = -1, coachProg = { move: 0, cast: 0, swap: new Set(), t: 0 };
function coach(dt) {
  if (S.mode !== "run" || !S.player || S.paused || S.over) { set("coach", "hidden", true); return; }
  if (coachIdx < 0) coachIdx = COACH.findIndex((c) => !save.tutorialDone(c.id));
  if (coachIdx < 0 || coachIdx >= COACH.length) { set("coach", "hidden", true); return; }
  const c = COACH[coachIdx];
  set("coach", "hidden", false);
  set("coach", "text", c[device] || c.mouse);
  coachProg.t += dt;
  const P = S.player;
  let done = false;
  if (c.id === "move") { coachProg.move += Math.hypot(P.vx, P.vz) * dt; done = coachProg.move > 4; }
  else if (c.id === "cast") done = coachProg.cast >= 3;
  else if (c.id === "swap") done = coachProg.swap.size >= 2;
  else if (c.id === "dash") done = !!coachProg.dashed;
  else if (c.id === "book") done = !!coachProg.book || coachProg.t > 30;
  if (done) { save.markTutorial(c.id); coachIdx++; coachProg.t = 0; if (coachIdx >= COACH.length) set("coach", "hidden", true); }
}
on("cast", () => coachProg.cast++);
on("select", (i) => coachProg.swap.add(i));
on("dash", () => { coachProg.dashed = true; });
on("bookOpened", () => { coachProg.book = true; });

/* ---------------------------------------------------------------
   Minimap
   --------------------------------------------------------------- */
let mapT = 0;
function drawMap() {
  const cv = $("minimap"), W = S.world, P = S.player;
  if (!cv || !W || !P) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const size = cv.clientWidth || 120;
  if (cv.width !== Math.round(size * dpr)) { cv.width = cv.height = Math.round(size * dpr); }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  const ext = W.mapExt, sc = size / (2 * ext);
  const X = (x) => (x + ext) * sc, Z = (z) => (z + ext) * sc;
  // explored ground, coastline clipped
  g.save();
  g.beginPath();
  for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2, r = W.radiusAt(a); const x = X(Math.cos(a) * r), y = Z(Math.sin(a) * r); i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.closePath();
  g.fillStyle = "rgba(255,255,255,0.06)"; g.fill();
  g.clip();
  const cell = (2 * ext) / 64;
  g.fillStyle = "rgba(232,221,200,0.2)";
  for (let j = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
    const x = -ext + (i + 0.5) * cell, z = -ext + (j + 0.5) * cell;
    if (W.isExplored(x, z)) g.fillRect(X(-ext + i * cell), Z(-ext + j * cell), cell * sc + 0.6, cell * sc + 0.6);
  }
  g.restore();
  g.strokeStyle = "rgba(201,164,92,0.55)"; g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i <= 96; i++) { const a = i / 96 * Math.PI * 2, r = W.radiusAt(a); const x = X(Math.cos(a) * r), y = Z(Math.sin(a) * r); i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  const dot = (x, z, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(X(x), Z(z), r, 0, Math.PI * 2); g.fill(); };
  for (const p of S.props) {
    if (p.kind === "portal") { if (p.on || W.isExplored(p.x, p.z)) { g.strokeStyle = p.on ? "#ffd97a" : "#8fa0ab"; g.lineWidth = 1.5; g.beginPath(); g.arc(X(p.x), Z(p.z), 4, 0, 7); g.stroke(); } }
    else if (!p.used && W.isExplored(p.x, p.z)) dot(p.x, p.z, 2.4, p.kind === "chest" ? "#ffd97a" : "#ff8fb0");
  }
  for (const e of S.enemies) {
    if (!e.alive || e.type === "geode" || e.type === "dummy") continue;
    const known = W.isExplored(e.x, e.z);
    if (e.type === "anchor") { if (known) dot(e.x, e.z, 3.4, "#" + W.theme.accent.toString(16).padStart(6, "0")); continue; }
    if (e.boss) { dot(e.x, e.z, 4, "#ff4f6a"); continue; }
    if (e.aggro && Math.hypot(e.x - P.x, e.z - P.z) < 22) dot(e.x, e.z, 1.6, "#ff5a74");
  }
  // you
  g.save();
  g.translate(X(P.x), Z(P.z)); g.rotate(P.aim);
  g.fillStyle = "#fff"; g.beginPath(); g.moveTo(5, 0); g.lineTo(-3.5, 3); g.lineTo(-2, 0); g.lineTo(-3.5, -3); g.closePath(); g.fill();
  g.restore();
}

/* ---------------------------------------------------------------
   The objective arrow
   --------------------------------------------------------------- */
function objectiveTarget() {
  const P = S.player;
  if (!P) return null;
  if (S.portal && S.portal.on) return S.portal;
  if (S.objective && S.objective.kind === "anchors") {
    let best = null, bd = 1e9;
    for (const e of S.enemies) if (e.alive && e.type === "anchor") { const d = Math.hypot(e.x - P.x, e.z - P.z); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  if (S.boss && S.boss.alive && S.boss.state === "sleep") return S.boss;
  return null;
}
const scr = {};
function arrow() {
  const a = $("edgeArrow"), t = objectiveTarget();
  if (!t || S.paused || S.over) { set("edgeArrow", "display", "none"); return; }
  worldToScreen(t.x, 1, t.z, scr);
  // keep clear of the HUD: the top rows and the spell bar own the edges
  const w = innerWidth, h = innerHeight, m = 40;
  const top = w < h ? 190 : 110, bottom = 150;
  const inView = !scr.behind && scr.x > m && scr.x < w - m && scr.y > top && scr.y < h - bottom;
  if (inView) { set("edgeArrow", "display", "none"); return; }
  const cx = w / 2, cy = (top + h - bottom) / 2;
  let dx = scr.x - cx, dy = scr.y - cy;
  if (scr.behind) { dx = -dx; dy = -dy; }
  const ang = Math.atan2(dy, dx);
  const kx = (w / 2 - m) / Math.abs(Math.cos(ang) || 1e-6), ky = ((h - bottom - top) / 2) / Math.abs(Math.sin(ang) || 1e-6);
  const k = Math.min(kx, ky);
  set("edgeArrow", "display", "block");
  a.style.transform = "translate(" + (cx + Math.cos(ang) * k).toFixed(0) + "px," + (cy + Math.sin(ang) * k).toFixed(0) + "px) translate(-50%,-50%) rotate(" + ang.toFixed(3) + "rad)";
}

/* ---------------------------------------------------------------
   Per frame
   --------------------------------------------------------------- */
let hpTrail = 1, lastHp = 1;
export function update(dt) {
  const P = S.player;
  const live = (S.mode === "run" || S.mode === "sandbox") && P;
  set("hud", "hidden", !live);
  set("touchUI", "hidden", !live || device !== "touch");
  if (!live) return;
  // vitals
  const hp = clamp(P.hp / P.maxHp, 0, 1);
  if (hp < lastHp) hpTrail = Math.max(hpTrail, lastHp);
  lastHp = hp;
  hpTrail = Math.max(hp, hpTrail - dt * 0.6);
  set("hpF", "width", (hp * 100).toFixed(1) + "%");
  set("hpTrail", "width", (hpTrail * 100).toFixed(1) + "%");
  set("hpT", "text", Math.ceil(P.hp) + " / " + Math.round(P.maxHp));
  const mp = clamp(P.mana / P.maxMana, 0, 1);
  set("mpF", "width", (mp * 100).toFixed(1) + "%");
  set("mpT", "text", Math.floor(P.mana) + " / " + Math.round(P.maxMana));
  P.lowManaT = Math.max(0, (P.lowManaT || 0) - dt);
  $("mpBar").classList.toggle("short", P.lowManaT > 0);
  set("lvlN", "text", String(P.level));
  const xp = clamp(P.xp / xpNeed(P.level), 0, 1);
  set("lvlArc", "strokeDashoffset", (113.1 * (1 - xp)).toFixed(1));
  set("potions", "html", potionsHtml(P));
  set("rankN", "text", "Rank " + P.rank);
  // danger vignette
  const low = hp < 0.34 ? (0.34 - hp) / 0.34 : 0;
  set("vignette", "opacity", (low * (0.55 + Math.sin(S.time * 5) * 0.2)).toFixed(2));
  // top centre
  set("floorN", "text", S.mode === "sandbox" ? "Sandbox" : "Floor " + S.floor);
  set("floorName", "text", S.world ? S.world.theme.name : "");
  set("objective", "text", S.objective ? S.objective.text : "");
  set("runT", "text", S.mode === "run" ? fmtTime(S.runTime) : "");
  // boss
  const B = S.boss && S.boss.alive && S.boss.state !== "sleep" ? S.boss : null;
  set("bossBar", "hidden", !B);
  if (B) { set("bossF", "width", (clamp(B.hp / B.maxHp, 0, 1) * 100).toFixed(1) + "%"); set("bossName", "text", B.type === "heart" ? "THE LOOM HEART" : "WARDEN OF " + S.world.theme.name.toUpperCase()); }
  // spells
  slotEls.forEach((b, i) => {
    const c = P.compiled[i];
    const cd = c && P.cd[i] > 0 ? P.cd[i] / Math.max(0.01, c.cooldown) : 0;
    b.style.setProperty("--cd", cd.toFixed(3));
    b.classList.toggle("sel", i === P.selected);
    b.classList.toggle("poor", !!c && P.mana < c.cost && !P.infiniteMana);
  });
  // context buttons
  const target = interactTarget();
  const pend = pendingPayloads();
  set("tUse", "hidden", !target);
  set("tTrigger", "hidden", !pend);
  set("tPotionN", "text", String(P.potions));
  $("tPotion").classList.toggle("dim", P.potions <= 0);
  if (target && !S.paused && !S.over) {
    worldToScreen(target.x, 2.2, target.z, scr);
    set("prompt", "display", "block");
    $("prompt").style.transform = "translate(" + scr.x.toFixed(0) + "px," + scr.y.toFixed(0) + "px) translate(-50%,-100%)";
    set("prompt", "html", (device === "touch" ? "" : "<kbd>" + (device === "pad" ? "X" : "E") + "</kbd> ") + escHtml(target.label));
  } else set("prompt", "display", "none");
  set("triggerHint", "hidden", !pend || device === "touch");
  set("triggerHint", "html", "<kbd>" + (device === "pad" ? "LT" : "F") + "</kbd> release the next layer");
  // sandbox dps
  if (S.mode === "sandbox") {
    let dps = 0;
    for (const e of S.enemies) if (e.alive && e.type === "dummy") dps += dummyDps(e);
    set("dps", "hidden", false);
    set("dps", "text", "Damage per second — " + Math.round(dps));
  } else set("dps", "hidden", true);
  mapT -= dt;
  if (mapT <= 0) { mapT = 0.1; drawMap(); }
  arrow();
  coach(dt);
}

function potionsHtml(P) {
  let s = "";
  for (let i = 0; i < P.potionCap; i++) s += '<i class="' + (i < P.potions ? "full" : "") + '">' + icon("flask") + "</i>";
  return s;
}

/* ---------------------------------------------------------------
   Events → words
   --------------------------------------------------------------- */
on("toast", (m, ico) => toast(m, ico));
on("floorStart", (floor, theme, kind) => {
  if (S.mode === "sandbox") { banner("The Practice Grounds", "Everything unlocked. Nothing counts.", "calm"); return; }
  const sub = kind === "anchors" ? "Sever the three Anchors" : kind === "heart" ? "The top of the tower" : "A Warden holds this floor";
  banner("Floor " + floor + " · " + theme.name, sub + (floor % 2 === 1 ? " · Landing saved" : ""));
  refreshSpellbar();
});
on("anchorDown", (d, t) => banner(d >= t ? "The way opens" : "Anchor severed", d + " of " + t, d >= t ? "gold" : ""));
on("bossIntro", (b) => banner(b.type === "heart" ? "The Loom Heart" : "Warden of " + S.world.theme.name, b.type === "heart" ? "Unmake it" : "", "danger"));
on("bossPhase", (b) => { if (b.type === "heart") toast("The Heart quickens", "skull"); else toast("The Warden is enraged", "skull"); });
on("bossDown", (b) => { if (S.mode === "run") banner(b.type === "heart" ? "The Loom is unmade" : "The Warden falls", b.type === "heart" ? "Step into the light" : "Take the thread it drops", "gold"); });
on("rankUp", (r) => banner("Circle rank " + r, "Your pages can hold more", "gold"));
on("portalOpen", (final) => { if (!final) toast("The portal is open", "portal"); });
on("discover", (kind, id) => {
  const name = kind === "reactions" ? REACTIONS[id].name : kind === "forms" ? FORMS[id].name : (ELEMENTS[id] || elementInfo(id)).name;
  toast("Discovered " + name, kind === "reactions" ? id : kind === "forms" ? id : id);
});
on("spellsChanged", () => refreshSpellbar());
on("playerHurt", () => {
  const f = $("hurtFlash");
  f.classList.remove("on"); void f.offsetWidth; f.classList.add("on");
});
on("potion", () => toast("Potion", "flask"));
on("revive", () => banner("Phoenix Thread", "You rise again", "gold"));
on("runStart", () => document.body.classList.toggle("sandbox", S.mode === "sandbox"));
on("title", () => document.body.classList.remove("sandbox"));
on("fade", (v) => set("fade", "opacity", v.toFixed(3)));

export function init() {
  hydrateIcons(document);
  buildSpellbar();
  const arc = $("lvlArc");
  if (arc) { arc.style.strokeDasharray = "113.1"; }
  emit("hudReady");
}

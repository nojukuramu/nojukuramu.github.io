/* hud.js — what is on screen while you walk.
 *
 * Shape lifted from Magic Sandbox (magic_sandbox/js/hud.js): values written
 * only when they change, a spell bar of thumbnails of what you drew, toasts
 * and one banner, a one-line coach for the first minutes, a minimap and an
 * arrow at the screen's edge toward what you are after.
 *
 * What it shows is this game's. Top left: health, vigor, the four element
 * pools, level, rank, potions. Top centre: the compass — the nearest Warden
 * you have not beaten, how far, and which way — and the land you are in and
 * how dangerous it is. Top right: the minimap, the map, the book. Bottom:
 * eight scrolls, each with its tier and a dot for whether you can pay for it
 * (the Phaser build's cast indicator). The Phaser HUD's debug readout of
 * seed, position and projectile count is gone; the seed is on the map. */

import { S, on, emit } from "./state.js";
import { worldToScreen, nightness } from "./gfx.js";
import { icon, hydrateIcons } from "./icons.js";
import { thumbnail } from "./glyphart.js";
import { save } from "./save.js";
import { xpNeed } from "./player.js";
import { elementInfo, ELEMENTS, ELEMENT_IDS, TIER_COLORS, SLOTS } from "./spellcore.js";
import { pendingPayloads } from "./spells.js";
import { getObjective, isAttuned } from "./game.js";
import { BIOMES, CHUNK, CELL, GRID, DIR } from "./world.js";
import { interactables } from "./chunks.js";
import { device, selectSlot } from "./input.js";
import { clamp, escHtml } from "./util.js";

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
   Scroll bar
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
    b.setAttribute("aria-label", "Scroll " + (i + 1));
    b.innerHTML = '<span class="thumb"></span><span class="cdw"></span><span class="key">' + (i + 1) + '</span><span class="tierl"></span><span class="dot"></span><span class="lock">' + icon("lock") + "</span>";
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
      t.appendChild(thumbnail(d, 40));
    }
    const c = P && P.compiled[i];
    const empty = P && P.empty[i];
    const tl = b.querySelector(".tierl");
    tl.textContent = c && !empty ? c.tier : "";
    tl.style.color = c ? TIER_COLORS[c.tier] : "";
    b.classList.toggle("blocked", !!(P && P.blocked[i]));
    b.classList.toggle("empty", !!empty);
    b.title = c ? (empty ? "Empty scroll — base magic" : c.name + " · tier " + c.tier) : "";
    b.style.setProperty("--el", c && c.elements[0] ? elementInfo(c.elements[0]).color : "#b8a6ff");
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
  bannerT = setTimeout(() => { b.className = "banner"; }, 2800);
}

/* ---------------------------------------------------------------
   Coaching: the first minutes teach themselves, one line at a time
   --------------------------------------------------------------- */
const COACH = [
  { id: "move", mouse: "Move with W A S D", touch: "Left thumb anywhere: move", pad: "Left stick: move" },
  { id: "cast", mouse: "Hold left click to cast at the cursor", touch: "Right thumb: drag to aim and cast — or just hold", pad: "Hold RT to cast; right stick aims" },
  { id: "swap", mouse: "Press 1 to 4 to try your other scrolls (1–8, or the wheel)", touch: "Tap a scroll below to switch", pad: "LB / RB switch scrolls" },
  { id: "dash", mouse: "Space dashes — straight through danger", touch: "Dash goes straight through danger", pad: "A dashes through danger" },
  { id: "book", mouse: "Press M to draw your own spells", touch: "The book, top right, is where you draw", pad: "Back opens the spellbook" },
  { id: "road", mouse: "Follow a road to the next waystone", touch: "Follow a road to the next waystone", pad: "Follow a road to the next waystone" }
];
let coachIdx = -1;
const prog = { move: 0, cast: 0, swap: new Set(), t: 0 };
function coach(dt) {
  if (S.mode !== "play" || !S.player || S.paused) { set("coach", "hidden", true); return; }
  if (coachIdx < 0) coachIdx = COACH.findIndex((c) => !save.tutorialDone(c.id));
  if (coachIdx < 0 || coachIdx >= COACH.length) { set("coach", "hidden", true); return; }
  const c = COACH[coachIdx];
  set("coach", "hidden", false);
  set("coach", "text", c[device] || c.mouse);
  prog.t += dt;
  const P = S.player;
  let done = false;
  if (c.id === "move") { prog.move += Math.hypot(P.vx, P.vz) * dt; done = prog.move > 5; }
  else if (c.id === "cast") done = prog.cast >= 3;
  else if (c.id === "swap") done = prog.swap.size >= 2;
  else if (c.id === "dash") done = !!prog.dashed;
  else if (c.id === "book") done = !!prog.book || prog.t > 30;
  else if (c.id === "road") done = !!prog.attuned || prog.t > 40;
  if (done) { save.markTutorial(c.id); coachIdx++; prog.t = 0; if (coachIdx >= COACH.length) set("coach", "hidden", true); }
}
on("cast", () => prog.cast++);
on("select", (i) => prog.swap.add(i));
on("dash", () => { prog.dashed = true; });
on("bookOpened", () => { prog.book = true; });
on("attune", (w) => { if (w.id !== "w0_0") prog.attuned = true; });

/* ---------------------------------------------------------------
   Minimap: chunk squares coloured by land, roads, water, and what moves
   --------------------------------------------------------------- */
const MAP_R = 56;   // metres from you to the minimap's edge
let mapT = 0;
const hex = (n) => "#" + n.toString(16).padStart(6, "0");
function drawMinimap() {
  const cv = $("minimap"), W = S.world, P = S.player;
  if (!cv || !W || !P) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const size = cv.clientWidth || 120;
  if (cv.width !== Math.round(size * dpr)) cv.width = cv.height = Math.round(size * dpr);
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, size, size);
  g.save();
  g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2); g.clip();
  const sc = size / (2 * MAP_R);
  const X = (x) => size / 2 + (x - P.x) * sc, Z = (z) => size / 2 + (z - P.z) * sc;
  const c0x = Math.floor((P.x - MAP_R) / CHUNK), c1x = Math.floor((P.x + MAP_R) / CHUNK);
  const c0z = Math.floor((P.z - MAP_R) / CHUNK), c1z = Math.floor((P.z + MAP_R) / CHUNK);
  for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
    const C = W.chunk(cx, cz);
    g.fillStyle = hex(BIOMES[C.biome].ground);
    g.fillRect(X(C.x0) - 0.5, Z(C.z0) - 0.5, CHUNK * sc + 1, CHUNK * sc + 1);
    g.fillStyle = "#3f86b8";
    for (let i = 0; i < GRID * GRID; i++) if (C.water[i]) g.fillRect(X(C.x0 + (i % GRID) * CELL), Z(C.z0 + Math.floor(i / GRID) * CELL), CELL * sc + 0.5, CELL * sc + 0.5);
    if (C.road) {
      g.strokeStyle = "rgba(232,212,168,0.9)"; g.lineWidth = Math.max(1.5, 3 * sc);
      const mx = X(C.x0 + CHUNK / 2), mz = Z(C.z0 + CHUNK / 2), h = CHUNK / 2 * sc;
      g.beginPath();
      if (C.road & DIR.N) { g.moveTo(mx, mz); g.lineTo(mx, mz - h); }
      if (C.road & DIR.S) { g.moveTo(mx, mz); g.lineTo(mx, mz + h); }
      if (C.road & DIR.E) { g.moveTo(mx, mz); g.lineTo(mx + h, mz); }
      if (C.road & DIR.W) { g.moveTo(mx, mz); g.lineTo(mx - h, mz); }
      g.stroke();
    }
    if (C.structure && C.structure.great && C.centrepiece) {
      g.fillStyle = C.structure.id && S.player ? "#ffd97a" : "#fff";
      g.beginPath(); g.arc(X(C.centrepiece.x), Z(C.centrepiece.z), 3.5, 0, 7); g.fill();
    }
  }
  // the night darkens the map a little, as it does the land
  const n = nightness();
  if (n > 0.05) { g.fillStyle = "rgba(8,12,30," + (n * 0.35).toFixed(2) + ")"; g.fillRect(0, 0, size, size); }
  for (const it of interactables) {
    if (it.type === "waystone") {
      g.fillStyle = isAttuned(it.id) ? "#8fd8ff" : "#d8d8e0";
      g.beginPath(); g.moveTo(X(it.x), Z(it.z) - 4.5); g.lineTo(X(it.x) + 3, Z(it.z) + 2.5); g.lineTo(X(it.x) - 3, Z(it.z) + 2.5); g.closePath(); g.fill();
    } else if (it.type === "chest") { g.fillStyle = "#ffd97a"; g.fillRect(X(it.x) - 2, Z(it.z) - 2, 4, 4); }
  }
  for (const e of S.enemies) {
    if (!e.alive) continue;
    if (e.boss) { g.fillStyle = "#ff4f6a"; g.beginPath(); g.arc(X(e.x), Z(e.z), 4, 0, 7); g.fill(); continue; }
    if (e.state !== "idle") { g.fillStyle = "#ff5a74"; g.beginPath(); g.arc(X(e.x), Z(e.z), 1.8, 0, 7); g.fill(); }
  }
  g.restore();
  g.strokeStyle = "rgba(201,164,92,0.6)"; g.lineWidth = 1.5;
  g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2); g.stroke();
  g.save();
  g.translate(size / 2, size / 2); g.rotate(P.aim);
  g.fillStyle = "#fff"; g.strokeStyle = "#000"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, 3.5); g.lineTo(-2, 0); g.lineTo(-4, -3.5); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

/* ---------------------------------------------------------------
   Compass and the edge arrow
   --------------------------------------------------------------- */
const DIRS = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
const dirWord = (a) => DIRS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
const scr = {};
function arrow(target) {
  const a = $("edgeArrow");
  if (!target || S.paused) { set("edgeArrow", "display", "none"); return; }
  worldToScreen(target.x, 1, target.z, scr);
  const w = innerWidth, h = innerHeight, m = 40;
  const top = w < h ? 190 : 120, bottom = 150;
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
  const live = S.mode === "play" && P;
  set("hud", "hidden", !live);
  set("touchUI", "hidden", !live || device !== "touch");
  if (!live) return;
  const hp = clamp(P.hp / P.maxHp, 0, 1);
  if (hp < lastHp) hpTrail = Math.max(hpTrail, lastHp);
  lastHp = hp;
  hpTrail = Math.max(hp, hpTrail - dt * 0.6);
  set("hpF", "width", (hp * 100).toFixed(1) + "%");
  set("hpTrail", "width", (hpTrail * 100).toFixed(1) + "%");
  set("hpT", "text", Math.ceil(P.hp) + " / " + Math.round(P.maxHp));
  set("vgF", "width", (clamp(P.vigor / P.maxVigor, 0, 1) * 100).toFixed(1) + "%");
  for (const e of ELEMENT_IDS) {
    set("mp_" + e, "height", (clamp(P.mana[e] / P.maxMana, 0, 1) * 100).toFixed(1) + "%");
    set("mpn_" + e, "text", String(Math.floor(P.mana[e])));
  }
  const c = P.compiled[P.selected];
  for (const e of ELEMENT_IDS) $("mpw_" + e).classList.toggle("short", !!c && c.cost[e] > P.mana[e]);
  set("lvlN", "text", String(P.level));
  set("lvlArc", "strokeDashoffset", (113.1 * (1 - clamp(P.xp / xpNeed(P.level), 0, 1))).toFixed(1));
  set("potions", "html", icon("flask") + "<b>" + P.potions + "</b>");
  set("rankN", "html", icon("sigil") + "Rank " + P.rank);
  const low = hp < 0.34 ? (0.34 - hp) / 0.34 : 0;
  set("vignette", "opacity", (low * (0.55 + Math.sin(S.time * 5) * 0.2)).toFixed(2));

  // the compass
  const O = getObjective();
  if (O) {
    set("compass", "hidden", false);
    set("compassName", "text", O.name);
    set("compassDist", "text", Math.round(O.d) + " m " + dirWord(O.ang) + " · danger " + O.danger);
    $("compassArrow").style.transform = "rotate(" + (O.ang + Math.PI / 2).toFixed(3) + "rad)";
  } else set("compass", "hidden", true);
  const biome = S.world.biomeAt(P.x, P.z);
  set("placeName", "text", biome + " · danger " + S.world.dangerAt(P.x, P.z));
  set("dayIco", "html", icon(nightness() > 0.5 ? "moon" : "sun"));

  // the Warden you are fighting
  const B = S.boss && S.boss.alive && !S.boss.dormant ? S.boss : null;
  set("bossBar", "hidden", !B);
  if (B) { set("bossF", "width", (clamp(B.hp / B.maxHp, 0, 1) * 100).toFixed(1) + "%"); set("bossName", "text", B.name.toUpperCase()); }

  // scrolls: cooldown is the staff's, shared
  const st = { ready: "ok", partial: "part", fallback: "none" };
  slotEls.forEach((b, i) => {
    const cc = P.compiled[i];
    const cd = cc && P.castCd > 0 && i === P.selected ? P.castCd / Math.max(0.01, cc.cooldown) : 0;
    b.style.setProperty("--cd", clamp(cd, 0, 1).toFixed(3));
    b.classList.toggle("sel", i === P.selected);
    b.dataset.st = st[P.castStatus(i)];
  });
  const pend = pendingPayloads(P);
  set("tTrigger", "hidden", !pend);
  set("tPotionN", "text", String(P.potions));
  $("tPotion").classList.toggle("dim", P.potions <= 0);
  set("triggerHint", "hidden", !pend || device === "touch");
  set("triggerHint", "html", "<kbd>" + (device === "pad" ? "LT" : "Right click") + "</kbd> release the payload");
  mapT -= dt;
  if (mapT <= 0) { mapT = 0.15; drawMinimap(); }
  arrow(B ? null : O ? O.s : null);
  coach(dt);
}

/* ---------------------------------------------------------------
   Events → words
   --------------------------------------------------------------- */
on("toast", (m, ico) => toast(m, ico));
on("banner", (t, sub, kind) => banner(t, sub, kind));
on("journeyStart", (J) => { banner(J.seed, "Your waystone is the one at your feet", "calm"); refreshSpellbar(); });
on("bossIntro", (b) => banner(b.name, "A Warden wakes", "danger"));
on("bossPhase", (b) => toast(b.name + " is enraged", "skull"));
on("bossLost", () => toast("The Warden returns to its sleep", "moon"));
on("kill", (e) => { if (e.boss) banner(e.name + " falls", "Take the Sigil it leaves", "gold"); });
on("rankUp", (r, capped) => banner(capped ? "The Sigil is yours" : "Circle rank " + r, capped ? "Your circle is already full" : "Your scrolls can hold more", "gold"));
on("attune", (w) => { if (w.id !== "w0_0") banner("Waystone held", "You will wake here", "calm"); });
on("discover", (s) => toast("Found: " + s.name, s.great ? "tower" : "map"));
on("chest", () => toast("A chest, opened", "chest"));
on("levelUp", (lv) => banner("Level " + lv, "More health, deeper pools", "gold"));
on("spellsChanged", () => refreshSpellbar());
on("travel", () => toast("You step through the waystone", "waystone"));
on("playerHurt", () => {
  const f = $("hurtFlash");
  f.classList.remove("on"); void f.offsetWidth; f.classList.add("on");
});
on("fade", (v) => set("fade", "opacity", v.toFixed(3)));

export function init() {
  hydrateIcons(document);
  buildSpellbar();
  const arc = $("lvlArc");
  if (arc) arc.style.strokeDasharray = "113.1";
  for (const e of ELEMENT_IDS) $("mpw_" + e).style.setProperty("--c", ELEMENTS[e].color);
}

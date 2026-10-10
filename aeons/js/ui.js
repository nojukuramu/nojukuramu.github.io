/* ui.js — the HUD, the command card, the panels and the title.
 *
 * The screen is the battlefield; the HUD keeps to its edges. Resources and the
 * phase along the top; champions, groups, idle workers and the army down the
 * left; the minimap, what is selected and what it can do along the bottom.
 * Everything a button cannot do yet says why in one line above the card — the
 * house rule (CLAUDE.md): one line on the pane, the explanation behind an (i).
 *
 * The command card is drawn from data: buildings.js actions() for buildings,
 * and the orders below for units. Its letters are its hotkeys. */

import { G, emit, on } from "./state.js";
import { TRAINED, RANK_NAMES } from "./data.js";
import { TILE, RES, RES_NAME, RES_ERA, ERAS, LINES, BUILDINGS, HEROES, HERO_IDS, TECH_CATS, DOCTRINES, DOCTRINE_IDS, MAX_ERA, bldCost, heroXpFor, HERO_MAX_LEVEL, maxLevel, supplyMax } from "./data.js";
import { icon, hydrateIcons } from "./icons.js";
import { portrait } from "./sprites.js";
import { actions, act, cancel, roman, tierOf, canPlace, territoryOf } from "./buildings.js";
import { canAfford, lacking, lvl } from "./entities.js";
import { setOrder, stop, isMilitary } from "./units.js";
import { selected, select, clearSel, beginPlace, beginTarget, cancelMode, confirmPlace, mode, onHotkey, setBoxMode, isBoxMode, centerOn, mouse } from "./input.js";
import { possess, release, cast, controlled, skillsOf } from "./heroes.js";
import { view, ping, darkness, pickAt } from "./render.js";
import { liveBases } from "./enemy.js";
import { headingOf } from "./auto.js";
import { exploredShare } from "./fog.js";
import { settings, saveSettings, listSlots, saveSlot, loadSlot, deleteSlot, exportJSON, importJSON } from "./save.js";
import * as info from "./info.js";
import * as ledger from "./ledger.js";
import * as details from "./details.js";
import { create as makeSquad } from "./squads.js";
import * as update from "./update.js";
import * as audio from "./audio.js";
import { HERO_LINES, ENEMY_PREFIX } from "./lore.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M" : n >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "k" : String(Math.floor(n));
const costHTML = (c) => RES.filter((r) => c && c[r]).map((r) => '<span class="cost ' + (G.res[r] >= c[r] ? "" : "short") + '">' + icon(r) + fmt(c[r]) + "</span>").join("");
const time = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
const ago = (t) => { const s = Math.max(0, G.time - t); return s < 60 ? Math.floor(s) + "s ago" : Math.floor(s / 60) + "m ago"; };

export const nameOf = (e) => {
  if (!e) return "";
  if (e.kind === "node") return { gold: "Gold Vein", stone: "Stone Outcrop", oil: "Oil Seep", aether: "Aether Shard", relic: "Ruin" }[e.type];
  const pre = e.team === 1 ? ENEMY_PREFIX + " " : "";
  if (e.kind === "bld") { const n = BUILDINGS[e.type].names; return pre + (n[e.level - 1] || n[n.length - 1]); }
  if (e.hero) return HEROES[e.hero].name;
  if (e.turret) return "Turret";
  if (e.drone) return "Scout Drone";
  return pre + LINES[e.line].names[e.tier];
};
const portraitOf = (e) => e.kind === "bld" ? portrait("bld", e.type, e.level - 1, e.team) : e.kind === "unit" ? portrait("unit", e.line, e.tier, e.team, e.hero) : "";

/* =========================================================================
   The top: resources and the phase
   ========================================================================= */
const resEls = {};
function buildRes() {
  const box = $("res");
  box.innerHTML = RES.map((r) => '<span class="res r-' + r + '" id="res-' + r + '" title="' + RES_NAME[r] + '">' + icon(r) + "<b></b></span>").join("") +
    '<span class="res r-supply" id="res-supply" title="Supply: used / available">' + icon("supply") + "<b></b></span>";
  for (const r of RES.concat("supply")) resEls[r] = { el: $("res-" + r), b: $("res-" + r).querySelector("b"), v: null };
}
function drawTop() {
  for (const r of RES) {
    const e = resEls[r], show = G.era >= RES_ERA[r] - 1 || G.res[r] > 0;
    e.el.hidden = !show;
    const v = fmt(G.res[r]);
    if (e.v !== v) { e.b.textContent = v; e.v = v; }
  }
  const s = resEls.supply, v = G.supply.used + "/" + G.supply.cap;
  if (s.v !== v) { s.b.textContent = v; s.v = v; s.el.classList.toggle("full", G.supply.used >= G.supply.cap && G.supply.cap < supplyMax(G.era)); }
  const P = G.phase, bases = liveBases().length;
  const ph = !P || P.n === 0 ? "The mist is quiet" : P.cleared ? "Phase " + P.n + " cleared" : "Phase " + P.n + " · " + bases + (bases === 1 ? " base" : " bases");
  setText($("eraName"), ERAS[G.era].name); setText($("phaseTxt"), ph);
  const recent = G.intel.alerts.filter((a) => G.time - a.t < 20);
  $("btnAlert").hidden = !recent.length; setText($("alertN"), recent.length ? String(recent.length) : "");
  setText($("speedTxt"), G.paused ? "||" : G.speed + "x");
  $("btnPause").innerHTML = icon(G.paused ? "play" : "pause");
}
function setText(el, s) { if (el && el.textContent !== s) el.textContent = s; }

/* =========================================================================
   Toasts and the banner
   ========================================================================= */
export function toast(text, kind) {
  const box = $("toasts");
  if (!box || !text) return;
  const last = box.lastElementChild;
  if (last && last.dataset.text === text) { last.dataset.n = (+last.dataset.n || 1) + 1; last.querySelector("b").textContent = "x" + last.dataset.n; last.dataset.until = Date.now() + 3500; return; }
  const el = document.createElement("div");
  el.className = "toast " + (kind || "");
  el.dataset.text = text; el.dataset.until = Date.now() + (kind === "lore" ? 9000 : 3500);
  el.innerHTML = "<span>" + esc(text) + "</span><b></b>";
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove();
}
function tickToasts() { const now = Date.now(); for (const el of [...$("toasts").children]) if (+el.dataset.until < now) { el.classList.add("out"); setTimeout(() => el.remove(), 400); el.dataset.until = 9e15; } }
let bannerT = 0;
export function banner(title, line, kind) {
  $("bannerTitle").textContent = title; $("bannerLine").textContent = line || "";
  const b = $("banner"); b.className = kind || ""; b.hidden = false; b.classList.remove("out");
  bannerT = Date.now() + 6500;
}
function tickBanner() { const b = $("banner"); if (!b.hidden && Date.now() > bannerT) { b.classList.add("out"); if (Date.now() > bannerT + 800) b.hidden = true; } }

/* =========================================================================
   The left: champions, groups, idle workers, the army
   ========================================================================= */
let sideSig = "";
function drawSide() {
  const heroes = HERO_IDS.filter((id) => G.heroes[id]);
  const sig = heroes.map((id) => { const h = G.heroes[id], u = h.uid && G.ents.get(h.uid); return id + (u ? "a" : "d") + (h.mode || "") + G.era; }).join("|") + "#" + G.groups.map((g) => g.length).join(",");
  if (sig !== sideSig) {
    sideSig = sig;
    $("heroBar").innerHTML = heroes.map((id) => {
      const h = G.heroes[id], u = h.uid && G.ents.get(h.uid);
      return '<button class="hero' + (u ? "" : " dead") + (h.mode === "manual" ? " manual" : "") + (u && u.sel ? " sel" : "") + '" data-hero="' + id + '" title="' + esc(HEROES[id].name) + '"><img src="' + portrait("unit", "melee", G.era, 0, id) + '" alt=""><i class="hpb"><i></i></i><span class="lv"></span>' + (h.mode === "manual" ? '<span class="pad">' + icon("control") + "</span>" : "") + "</button>";
    }).join("");
    // groups in use, and one empty slot to hold a new one: nine empty buttons are nine things to read
    let spare = false;
    $("groups").innerHTML = G.groups.slice(1, 6).map((g, k) => { if (!g.length) { if (spare) return ""; spare = true; } return '<button class="grp' + (g.length ? "" : " empty") + '" data-group="' + (k + 1) + '"><span>' + (k + 1) + "</span><b>" + (g.length || "") + "</b></button>"; }).join("");
  }
  for (const el of $("heroBar").children) {
    const h = G.heroes[el.dataset.hero], u = h.uid && G.ents.get(h.uid);
    el.querySelector(".hpb i").style.width = (u ? 100 * u.hp / u.maxHp : 0) + "%";
    el.classList.toggle("sel", !!(u && u.sel));
    setText(el.querySelector(".lv"), u ? String(u.lvl) : h.dead ? "" : "");
  }
  const idle = G.units.filter((u) => !u.dead && u.team === 0 && u.line === "worker" && !u.hero && u.order.t === "idle" && u.idleT > 1.5).length;
  setText($("idleN"), String(idle)); $("btnIdle").classList.toggle("has", idle > 0);
  const army = G.units.filter((u) => !u.dead && u.team === 0 && isMilitary(u) && !u.hero && !u.free).length;
  setText($("armyN"), String(army));
  $("btnBox").setAttribute("aria-pressed", isBoxMode() ? "true" : "false");
}
const heroTap = { id: "", t: 0 };
function sideEvents() {
  let heldGroup = null;
  $("heroBar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-hero]"); if (!b) return;
    const h = G.heroes[b.dataset.hero], u = h.uid && G.ents.get(h.uid);
    if (!u) { toast(HEROES[b.dataset.hero].name + " has fallen. Revive at the altar.", "bad"); const a = G.blds.find((x) => x.type === "altar" && x.team === 0 && !x.dead); if (a) { select([a]); centerOn([a]); } return; }
    // the strip redraws when the selection changes, so the first tap is remembered here, not on the button
    const now = Date.now();
    if (heroTap.id === b.dataset.hero && now - heroTap.t < 380) { u.manual ? release() : possess(u); heroTap.t = 0; return; }
    heroTap.id = b.dataset.hero; heroTap.t = now;
    select([u]); centerOn([u]); audio.play("select");
  });
  const groupEl = $("groups");
  groupEl.addEventListener("pointerdown", (e) => { const b = e.target.closest("[data-group]"); if (!b) return; heldGroup = { i: +b.dataset.group, t: setTimeout(() => { G.groups[heldGroup.i] = G.sel.filter((id) => { const x = G.ents.get(id); return x && x.team === 0; }); toast("Group " + heldGroup.i + " saved", "info"); sideSig = ""; heldGroup.done = true; }, 500) }; });
  groupEl.addEventListener("pointerup", (e) => {
    if (!heldGroup) return; clearTimeout(heldGroup.t);
    if (!heldGroup.done) {
      const ids = G.groups[heldGroup.i].filter((id) => G.ents.has(id));
      if (ids.length) { const already = ids.length === G.sel.length && ids.every((id) => G.sel.includes(id)); select(ids.map((id) => G.ents.get(id))); if (already) centerOn(selected()); }
      else toast("Hold to save the selection as group " + heldGroup.i, "info");
    }
    heldGroup = null;
  });
  $("btnIdle").addEventListener("click", () => emit("nextIdle"));
  $("btnArmy").addEventListener("click", () => {
    const army = G.units.filter((u) => !u.dead && u.team === 0 && isMilitary(u) && !u.manual && !u.free);
    if (!army.length) { toast("No army yet", "info"); return; }
    const same = army.length === G.sel.length;
    select(army); if (same) centerOn(army);
  });
  $("btnBox").addEventListener("click", () => { setBoxMode(!isBoxMode()); toast(isBoxMode() ? "Drag to select. Tap the button again to pan." : "Drag to look around", "info"); });
}
let idleIdx = 0;
on("nextIdle", () => {
  const idle = G.units.filter((u) => !u.dead && u.team === 0 && u.line === "worker" && !u.hero && u.order.t === "idle");
  if (!idle.length) { toast("Every worker is busy", "info"); return; }
  const u = idle[idleIdx++ % idle.length]; select([u]); centerOn([u]);
});

/* =========================================================================
   The command card
   ========================================================================= */
let cardItems = [], page = 0, cardSig = "", tipItem = null, tipUntil = 0, sub = null;
function unitItems(us) {
  const items = [];
  const workers = us.filter((u) => u.line === "worker" && !u.hero);
  const one = us.length === 1 ? us[0] : null;
  if (sub === "build" && workers.length) {
    for (const t in BUILDINGS) {
      const d = BUILDINGS[t];
      if (d.first > G.era) continue;
      const cost = bldCost(t), unique = d.unique && G.blds.some((b) => !b.dead && b.team === 0 && b.type === t);
      items.push({ id: "place:" + t, kind: "place", type: t, label: d.names[G.era] || d.names[d.names.length - 1], cost, ok: canAfford(cost) && !unique, why: unique ? "You can only have one" : canAfford(cost) ? "" : "Not enough resources", line2: d.blurb, img: portrait("bld", t, G.era, 0), hot: HOT_B[t] });
    }
    items.push({ id: "back", kind: "back", label: "Back", icon: "prev", hot: "Escape" });
    return items;
  }
  items.push({ id: "move", label: "Move", icon: "move", hot: "M", line2: "Walk there, ignoring enemies on the way." });
  items.push({ id: "stop", label: "Stop", icon: "stop", hot: "S" });
  if (us.some((u) => u.line !== "worker" || u.hero)) items.push({ id: "amove", label: "Attack-move", icon: "amove", hot: "A", line2: "Walk there, fighting whatever is met." });
  items.push({ id: "patrol", label: "Patrol", icon: "patrol", hot: "P", line2: "Walk back and forth, fighting." });
  items.push({ id: "hold", label: "Hold", icon: "hold", hot: "H", line2: "Stand still and only hit what comes in reach." });
  const st = us[0].stance;
  items.push({ id: "stance", label: st === "aggr" ? "Stance: aggressive" : st === "hold" ? "Stance: hold" : "Stance: scout", icon: "stance", hot: "G", line2: G.doctrines.scouts ? "Aggressive, hold, or scout (explore on their own)." : "Aggressive or hold. Pathfinders add scouting." });
  if (us.some((u) => isMilitary(u) && !u.free)) items.push({ id: "squad", label: "Make a squad", icon: "users", hot: "Y", line2: "A standing job for these soldiers: defend, patrol, strike, hunt or escort." });
  if (workers.length) {
    items.push({ id: "build", label: "Build", icon: "build", hot: "B" });
    items.push({ id: "repair", label: "Repair", icon: "wrench", hot: "R", line2: "Tap a damaged building or a foundation." });
    if (workers.some((u) => u.carry)) items.push({ id: "return", label: "Return cargo", icon: "ret", hot: "C" });
  }
  if (one && one.hero) {
    skillsOf(one).forEach((s, i) => items.push({ id: "skill:" + i, label: s.name, icon: s.id, hot: s.key, ok: s.ready && !s.locked, why: s.locked ? "Opens at level 6" : s.ready ? "" : "Ready in " + Math.ceil(s.cd) + "s", line2: s.line, cd: s.cd, cdMax: HEROES[one.hero].skills[i].cd }));
    items.push({ id: "control", label: one.manual ? "Let go" : "Take control", icon: one.manual ? "release" : "control", hot: "T", line2: "Drive the champion yourself, or let it fight on its own." });
  } else if (one && !one.turret && !one.drone) items.push({ id: "control", label: one.manual ? "Let go" : "Take control", icon: one.manual ? "release" : "control", hot: "T", line2: "Steer this one yourself." });
  return items;
}
const HOT_B = { hall: "T", house: "H", barracks: "B", lumber: "L", mine: "M", forge: "F", tower: "W", wall: "Z", outpost: "O", altar: "A", academy: "C", stable: "S", workshop: "K", shipyard: "Y", airfield: "I", radar: "R", derrick: "D", siphon: "N", beacon: "X" };
const HOT_A = { unit: "QWERTY", tech: "1234567890", level: "U", era: "V", doc: "1234567890", hero: "QWERT", refit: "ZXCV", toggle: "G", rally: "Y", cancel: "Escape" };

function itemsFor(sel) {
  const mine = sel.filter((e) => e.team === 0);
  if (!mine.length) return [];
  if (mine[0].kind === "unit") return unitItems(mine.filter((e) => e.kind === "unit"));
  if (mine[0].kind === "bld") {
    const b = leastBusy(mine);
    const used = {};
    return actions(b).map((a) => {
      const pool = HOT_A[a.kind] || "";
      let hot = pool === "Escape" ? "Escape" : "";
      for (const ch of pool) if (!used[ch]) { used[ch] = 1; hot = ch; break; }
      return Object.assign({}, a, { hot, img: a.kind === "unit" || a.kind === "refit" ? portrait("unit", a.line, a.tier, 0) : a.kind === "hero" ? portrait("unit", "melee", G.era, 0, a.hero) : "" });
    });
  }
  return [];
}
function leastBusy(bs) { return bs.slice().sort((a, b) => a.q.length - b.q.length || a.qt - b.qt)[0]; }

function capacity() {
  const card = $("card"), cs = getComputedStyle(card);
  const cols = cs.gridTemplateColumns.split(" ").length || 4, rows = cs.gridTemplateRows.split(" ").length || 3;
  return cols * rows;
}
function drawCard(force) {
  const sel = selected();
  if (!sel.length) sub = null;
  const items = controlled() ? [] : itemsFor(sel);
  const N = capacity();
  const pages = items.length > N ? Math.ceil(items.length / (N - 1)) : 1;
  if (page >= pages) page = 0;
  const shown = pages > 1 ? items.slice(page * (N - 1), page * (N - 1) + N - 1) : items;
  if (pages > 1) shown.push({ id: "more", label: "More (" + (page + 1) + "/" + pages + ")", icon: "next", hot: "Tab" });
  cardItems = shown;
  const sig = shown.map((i) => i.id + (i.ok === false ? 0 : 1) + (i.label || "") + (i.on ? 1 : 0) + (i.img ? i.img.length : 0)).join("|");
  if (sig !== cardSig || force) {
    cardSig = sig;
    $("card").innerHTML = shown.map((it, k) => '<button class="cmd' + (it.ok === false ? " no" : "") + (it.on ? " on" : "") + '" data-k="' + k + '" aria-label="' + esc(it.label) + '">' +
      (it.img ? '<img src="' + it.img + '" alt="">' : icon(it.icon || "info")) + (it.hot && it.hot.length === 1 ? '<kbd>' + it.hot + "</kbd>" : "") + (it.cdMax ? '<i class="cdw"></i>' : "") + "</button>").join("");
  }
  // cooldown sweeps, in place
  $("card").querySelectorAll(".cdw").forEach((el) => { const it = cardItems[+el.parentElement.dataset.k]; el.style.setProperty("--k", it && it.cdMax ? Math.max(0, it.cd / it.cdMax) : 0); });
  // the line above the card
  let t = tipItem && Date.now() < tipUntil ? tipItem : null;
  if (!t) {
    if (mode.kind === "place") t = { label: "Place: " + (BUILDINGS[mode.type].names[G.era] || mode.type), line2: mode.type === "wall" ? (mode.wall0 ? "Now the other end." : "Tap where the wall starts.") : (BUILDINGS[mode.type].anywhere ? "Anywhere you have explored." : "Inside your borders.") };
    else if (sel.length === 1 && sel[0].kind === "bld" && sel[0].team === 0 && sel[0].q.length) { const it = sel[0].q[0]; t = { label: qName(it), line2: Math.ceil(it.time - sel[0].qt) + "s left" }; }
  }
  const tip = $("tip");
  const html = t ? "<b>" + esc(t.label) + "</b>" + (t.cost ? costHTML(t.cost) : "") + (t.time ? '<span class="t">' + t.time + "s</span>" : "") + (t.ok === false && t.why ? '<span class="why">' + esc(t.why) + "</span>" : t.line2 ? '<span class="l2">' + esc(t.line2) + "</span>" : "") : "";
  if (tip.dataset.h !== html) { tip.innerHTML = html; tip.dataset.h = html; }
}
function qName(it) {
  if (it.k === "unit") return LINES[it.line].names[tierOf(it.line)];
  if (it.k === "tech") return TECH_CATS[it.cat].name + " " + roman(it.L);
  if (it.k === "refit") return "Training " + LINES[it.line].names[it.e] + "s";
  if (it.k === "level") return "Raising the building";
  if (it.k === "era") return "Entering the " + ERAS[Math.min(MAX_ERA, G.era + 1)].age;
  if (it.k === "doc") return DOCTRINES[it.doc].name;
  if (it.k === "hero") return HEROES[it.hero].name;
  return "";
}
function runItem(it, shift) {
  if (!it) return false;
  tipItem = it; tipUntil = Date.now() + 3500;
  const sel = selected(), us = sel.filter((e) => e.kind === "unit" && e.team === 0);
  if (it.ok === false && it.kind !== "cancel") { audio.play("error"); drawCard(true); return true; }
  audio.play("click");
  switch (it.id) {
    case "more": page++; drawCard(true); return true;
    case "back": sub = null; page = 0; drawCard(true); return true;
    case "move": beginTarget("move", "Tap where to go"); return true;
    case "amove": beginTarget("amove", "Tap where to attack-move"); return true;
    case "patrol": beginTarget("patrol", "Tap the far end of the patrol"); return true;
    case "repair": beginTarget("repair", "Tap what to repair"); return true;
    case "stop": for (const u of us) stop(u); return true;
    case "hold": for (const u of us) setOrder(u, { t: "hold" }, shift); return true;
    case "return": for (const u of us) if (u.carry) setOrder(u, { t: "return" }); return true;
    case "stance": {
      const order = G.doctrines.scouts ? ["aggr", "hold", "scout"] : ["aggr", "hold"];
      const next = order[(order.indexOf(us[0].stance) + 1) % order.length];
      for (const u of us) { u.stance = next; if (next === "hold") setOrder(u, { t: "hold" }); else if (next === "scout" && isMilitary(u)) setOrder(u, { t: "scout" }); else if (u.order.t === "hold" || u.order.t === "scout") stop(u); }
      drawCard(true); return true;
    }
    case "build": sub = "build"; page = 0; drawCard(true); return true;
    case "squad": { const s = makeSquad(us); if (s) { toast("Squad " + s.name + " formed", "good"); openPanel("ledger"); ledger.setTab("squads"); renderPanel(true); } return true; }
    case "control": { const u = us[0]; if (u) u.manual ? release() : possess(u); return true; }
  }
  if (it.id.startsWith("skill:")) {
    const u = us[0], i = +it.id.slice(6), S = HEROES[u.hero].skills[i];
    if (S.aim === "self") { cast(u, i) ? audio.play("magic") : audio.play("error"); }
    else if (document.body.classList.contains("touchUI")) { cast(u, i) ? audio.play("magic") : beginTarget("skill:" + i, "Tap a target for " + S.name, u.id); }
    else beginTarget("skill:" + i, "Click a target for " + S.name, u.id);
    return true;
  }
  if (it.kind === "place") { sub = null; beginPlace(it.type); return true; }
  const bs = sel.filter((e) => e.kind === "bld" && e.team === 0);
  if (bs.length) {
    const b = it.kind === "unit" ? leastBusy(bs) : bs[0];
    if (it.kind === "rally") { beginTarget("rally", "Tap the rally point"); return true; }
    if (it.kind === "toggle") { for (const x of bs) x.loop = !b.loop; drawCard(true); return true; }
    if (act(b, it.id)) { audio.play("ack"); if (shift && it.kind === "unit") for (let n = 0; n < 4; n++) act(leastBusy(bs), it.id); }
    else audio.play("error");
    drawCard(true);
    return true;
  }
  return false;
}
function cardEvents() {
  const card = $("card");
  let press = null;
  card.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".cmd"); if (!b) return;
    audio.unlock();
    const it = cardItems[+b.dataset.k];
    press = { it, long: false, t: setTimeout(() => { if (press) { press.long = true; tipItem = it; tipUntil = Date.now() + 5000; drawCard(true); } }, 450) };
  });
  card.addEventListener("pointerup", (e) => {
    if (!press) return; clearTimeout(press.t);
    const p = press; press = null;
    if (!p.long) runItem(p.it, e.shiftKey);
  });
  card.addEventListener("pointerleave", () => { if (press) { clearTimeout(press.t); press = null; } });
  card.addEventListener("pointerover", (e) => { const b = e.target.closest(".cmd"); if (b && e.pointerType === "mouse") { tipItem = cardItems[+b.dataset.k]; tipUntil = Date.now() + 60000; } });
  card.addEventListener("pointerout", (e) => { if (e.pointerType === "mouse") tipUntil = 0; });
  onHotkey((k, shift) => {
    if (k === "ESCAPE") return false;
    const it = cardItems.find((i) => i.hot === k);
    if (it) { runItem(it, shift); return true; }
    if (k === "\t") { const m = cardItems.find((i) => i.id === "more"); if (m) runItem(m); return true; }
    return false;
  });
}

/* =========================================================================
   What is selected
   ========================================================================= */
let selSig = "";
function drawSel() {
  const sel = selected(), box = $("selPanel");
  if (!sel.length) {
    const sig = "none";
    if (selSig !== sig) { selSig = sig; box.innerHTML = '<div class="empty">' + (G.phase && G.phase.n ? esc("Phase " + G.phase.n) : "Tap your hall or a worker") + "</div>"; }
    return;
  }
  if (sel.length > 1) {
    const sig = "m" + sel.map((e) => e.id + ":" + (e.tier || e.level || 0)).join(",");
    if (selSig !== sig) {
      selSig = sig;
      box.innerHTML = '<div class="multi">' + sel.slice(0, 40).map((e) => '<button class="mini" data-id="' + e.id + '"><img src="' + portraitOf(e) + '" alt=""><i class="hpb"><i></i></i></button>').join("") + (sel.length > 40 ? '<span class="more">+' + (sel.length - 40) + "</span>" : "") +
        '</div><button class="iconBtn small clr" data-act="clear" aria-label="Clear the selection">' + icon("close") + "</button>";
    }
    box.querySelectorAll(".mini").forEach((el) => { const e = G.ents.get(+el.dataset.id); if (e) el.querySelector(".hpb i").style.width = 100 * e.hp / e.maxHp + "%"; });
    return;
  }
  const e = sel[0];
  const sig = "s" + e.id + ":" + (e.tier || 0) + ":" + (e.level || 0) + ":" + (e.lvl || 0) + ":" + (e.q ? e.q.map((q) => q.k + q.key).join(",") : "") + ":" + (e.built >= 1 ? 1 : 0) + ":" + (e.manual ? 1 : 0);
  if (selSig !== sig) {
    selSig = sig;
    let html = '<div class="one">';
    if (e.kind !== "node") html += '<img class="por" src="' + portraitOf(e) + '" alt="">';
    html += '<div class="meta"><div class="nm">' + esc(nameOf(e)) + (e.kind === "bld" && e.type !== "wall" && !BUILDINGS[e.type].noLevel ? ' <span class="lvl">Lv ' + e.level + "</span>" : "") + (e.hero ? ' <span class="lvl">Lv <b data-b="lvl"></b></span>' : "") + "</div>";
    if (e.kind !== "node") html += '<div class="bar"><i data-b="hp"></i><span data-b="hpt"></span></div>';
    if (e.hero) html += '<div class="bar xp"><i data-b="xp"></i></div>';
    html += '<div class="stats" data-b="stats"></div>';
    if (e.kind === "bld" && e.team === 0 && e.q.length) html += '<div class="queue">' + e.q.map((it, i) => '<button class="qi" data-q="' + i + '" title="Cancel">' + (it.k === "unit" ? '<img src="' + portrait("unit", it.line, tierOf(it.line), 0) + '" alt="">' : icon(it.k === "tech" ? TECH_CATS[it.cat].icon : it.k === "doc" ? DOCTRINES[it.doc].icon : it.k === "level" ? "up" : it.k === "era" ? "era" : it.k === "hero" ? "crown" : "repeat")) + (i === 0 ? '<i class="qp"><i data-b="qp"></i></i>' : "") + "</button>").join("") + "</div>";
    html += "</div>";
    if (e.hero && e.team === 0) html += '<button class="btn small mode" data-act="control">' + icon(e.manual ? "release" : "control") + (e.manual ? "Let go" : "Control") + "</button>";
    html += '<button class="iconBtn small clr" data-act="clear" aria-label="Clear the selection">' + icon("close") + "</button>";
    html += '<button class="iconBtn small dtl" data-act="details" aria-label="Details">' + icon("info") + "</button></div>";
    box.innerHTML = html;
  }
  const B = (k) => box.querySelector('[data-b="' + k + '"]');
  if (e.kind !== "node") { const hp = B("hp"); if (hp) hp.style.width = 100 * Math.max(0, e.hp) / e.maxHp + "%"; setText(B("hpt"), Math.ceil(e.hp) + " / " + e.maxHp); }
  if (e.hero) { setText(B("lvl"), String(e.lvl)); const x = B("xp"); if (x) x.style.width = (e.lvl >= HERO_MAX_LEVEL ? 100 : 100 * e.xp / heroXpFor(e.lvl)) + "%"; }
  const qp = B("qp"); if (qp && e.q && e.q[0]) qp.style.width = 100 * e.qt / e.q[0].time + "%";
  setText(B("stats"), statLine(e));
}
function statLine(e) {
  if (e.kind === "node") return e.type === "gold" || e.type === "stone" ? fmt(e.amount) + " left" : e.type === "relic" ? "Something is buried here." : e.type === "oil" ? "Tap with a Derrick (Age of Steam)" : "Tap with a Siphon (Age of Stars)";
  if (e.kind === "bld") {
    if (e.built < 1) return "Building · " + Math.floor(e.built * 100) + "%";
    const d = BUILDINGS[e.type], bits = [];
    if (e.atk) bits.push("Hits " + Math.round(e.atk) + ", reach " + e.range.toFixed(1));
    if (d.territory) bits.push("Border " + territoryOf(e));
    if (d.supply) bits.push("+" + (d.supply + (d.supplyPerLevel || 2) * (e.level - 1)) + " supply");
    if (d.produces) bits.push(Object.keys(d.produces).map((r) => (d.produces[r] * (1 + 0.35 * (e.level - 1))).toFixed(1) + " " + r + "/s").join(", "));
    if (e.team === 0 && e.level < 10 && !d.noLevel) bits.push(e.level >= maxLevel(G.era) ? "Max for this era" : "Can be raised");
    return bits.join(" · ") || d.blurb;
  }
  const s = e.st, bits = [];
  if (e.line === "mender" && !e.hero) bits.push("Heals " + Math.round(s.atk * 1.6)); else bits.push("Atk " + Math.round(s.atk));
  bits.push("Arm " + Math.round(s.armor));
  if (s.range > 1.5) bits.push("Reach " + s.range.toFixed(1));
  if (e.carry) bits.push("Carrying " + e.carry.n + " " + e.carry.r);
  else if (e.team === 0 && e.line === "worker") bits.push(orderWord(e));
  if (e.team === 0 && e.line !== "worker") bits.push(e.manual ? "In your hands" : orderWord(e));
  return bits.join(" · ");
}
function orderWord(u) { return { idle: "Idle", move: "Moving", amove: "Attack-moving", attack: "Attacking", gather: "Gathering " + (u.order.res || ""), build: "Building", repair: "Repairing", return: "Returning", patrol: "Patrolling", hold: "Holding", guard: "Guarding", follow: "Following", scout: "Scouting" }[u.order.t] || u.order.t; }
function selEvents() {
  $("selPanel").addEventListener("click", (e) => {
    const q = e.target.closest("[data-q]");
    if (q) { const b = selected()[0]; if (b && b.kind === "bld") { cancel(b, +q.dataset.q); audio.play("click"); selSig = ""; } return; }
    const m = e.target.closest(".mini");
    if (m) { const x = G.ents.get(+m.dataset.id); if (x) select([x]); return; }
    const a = e.target.closest("[data-act]");
    if (!a) return;
    if (a.dataset.act === "clear") clearSel();
    if (a.dataset.act === "details") { openPanel("details"); return; }
    if (a.dataset.act === "control") { const u = selected()[0]; if (u) u.manual ? release() : possess(u); selSig = ""; }
  });
}

/* =========================================================================
   Targeting and placing, on a touch screen
   ========================================================================= */
function drawModes() {
  const th = $("targetHint"), pb = $("placeBar");
  if (mode.kind === "target") { th.hidden = false; setText($("targetTxt"), mode.label); } else th.hidden = true;
  pb.hidden = !(mode.kind === "place" && document.body.classList.contains("touchUI"));
  if (!pb.hidden) $("placeOk").classList.toggle("no", !(view.ghost && view.ghost.ok) && !(mode.type === "wall" && mode.wall0));
}

/* =========================================================================
   Manual control
   ========================================================================= */
let manSig = "";
function drawManual() {
  const u = controlled();
  document.body.classList.toggle("manual", !!u);
  $("manualUI").hidden = !u;
  if (!u) { manSig = ""; return; }
  const sk = skillsOf(u);
  const sig = u.id + ":" + (u.hero || "") + G.era;
  if (sig !== manSig) {
    manSig = sig;
    document.querySelectorAll("#skillPad .sk").forEach((b, i) => { const s = sk[i]; b.hidden = !s; if (s) b.innerHTML = icon(s.id) + '<i class="cdw"></i><kbd>' + s.key + "</kbd>"; });
  }
  document.querySelectorAll("#skillPad .sk").forEach((b, i) => {
    const s = sk[i]; if (!s) return;
    b.classList.toggle("no", !s.ready || s.locked);
    const w = b.querySelector(".cdw"); if (w) w.style.setProperty("--k", s.locked ? 1 : Math.max(0, s.cd / HEROES[u.hero].skills[i].cd));
  });
  setText($("mStatus"), nameOf(u) + (u.hero ? " · Lv " + u.lvl : "") + " · " + Math.ceil(u.hp) + "/" + u.maxHp);
}

/* =========================================================================
   Panels
   ========================================================================= */
let panelName = null;
export function openPanel(name, arg) {
  panelName = name;
  const P = $("panel");
  P.hidden = false; P.dataset.p = name;
  $("panelTitle").textContent = { menu: "Menu", settings: "Settings", saves: arg === "save" ? "Save the realm" : "Load a realm", intel: "Intel", auto: "Automation", codex: "Codex", realm: "The Realm", ledger: "Ledger", defeat: "The fire is out", complete: "The long road" }[name] || name;
  if (name === "details") $("panelTitle").textContent = details.title(selected()[0]);
  P.dataset.arg = arg || "";
  renderPanel();
  if (name === "menu" || name === "defeat" || name === "complete") { wasPaused = G.paused; G.paused = true; }
}
let wasPaused = false;
export function closePanel() {
  const P = $("panel");
  if (P.hidden) return;
  if (panelName === "menu" || panelName === "defeat" || panelName === "complete") G.paused = wasPaused;
  P.hidden = true; panelName = null;
}
export const panelOpen = () => !$("panel").hidden;
/** The menus stop the world; the working panels (ledger, intel, automation...) leave it running. */
export const panelPauses = () => panelOpen() && ["menu", "saves", "settings", "defeat", "complete"].includes(panelName);
let panelT = 0;
function tickPanel() {
  if (!panelName || Date.now() < panelT) return;
  panelT = Date.now() + 1000;
  if (panelName === "intel" || panelName === "realm" || panelName === "ledger" || panelName === "details") renderPanel(true);
}
function sw(id, on, enabled, label, line, infoKey) {
  return '<label class="row tog' + (enabled ? "" : " off") + '"><input type="checkbox" data-set="' + id + '"' + (on ? " checked" : "") + (enabled ? "" : " disabled") + "><span><b>" + esc(label) + "</b><small>" + esc(line) + "</small></span>" + (infoKey ? '<button class="info" data-info="' + infoKey + '" aria-label="About this">' + icon("info") + "</button>" : "") + "</label>";
}
function slider(id, v, min, max, step, label) { return '<label class="row sl"><span><b>' + esc(label) + '</b></span><input type="range" data-set="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + v + '"><output>' + v + "</output></label>"; }
function renderPanel(soft) {
  const body = $("panelBody"), name = panelName;
  const keepScroll = body.scrollTop;
  let h = "";
  if (name === "menu") {
    h = '<div class="stack">' +
      '<button class="btn wide primary" data-go="resume">' + icon("play") + "Back to the realm</button>" +
      '<button class="btn wide" data-go="save">' + icon("save") + "Save</button>" +
      '<button class="btn wide" data-go="load">' + icon("folder") + "Load</button>" +
      '<button class="btn wide" data-go="settings">' + icon("gear") + "Settings</button>" +
      '<button class="btn wide" data-info="howto">' + icon("info") + "Playing on a phone</button>" +
      '<button class="btn wide" data-info="keys">' + icon("info") + "Mouse and keys</button>" +
      '<button class="btn wide ghost" data-go="quit">' + icon("release") + "Save and leave to the title</button>" +
      "</div>" + versionLine();
  } else if (name === "settings") {
    h = '<div class="stack">' + slider("master", settings.master, 0, 1, 0.05, "Volume") + slider("sfx", settings.sfx, 0, 1, 0.05, "Effects") + slider("music", settings.music, 0, 1, 0.05, "Music") +
      slider("panSpeed", settings.panSpeed, 0.3, 3, 0.1, "Camera speed") +
      sw("s:edgePan", settings.edgePan, true, "Pan at the screen's edges", "With a mouse.") +
      sw("s:lights", settings.lights, true, "Day and night", "Darkness, and the lights in it.") +
      sw("s:weather", settings.weather, true, "Weather", "Rain, snow and dust.") +
      sw("s:hi", settings.quality !== "low", true, "Full detail", "Off on slow phones: blurrier ground, fewer sparks.") +
      sw("s:forceLandscape", settings.forceLandscape, true, "Force landscape", "Phones: always play sideways.", "landscape") +
      sw("s:autosave", settings.autosave, true, "Autosave", "Every minute, and when you leave.", "saves") +
      "</div>" + versionLine();
  } else if (name === "saves") {
    h = '<div class="stack" id="slots"><p class="dim">Reading the slots…</p></div><div class="stack row2"><button class="btn" data-go="export">' + icon("download") + 'Export to a file</button><label class="btn">' + icon("upload") + 'Import a file<input type="file" accept=".json,application/json" id="importFile" hidden></label></div>';
    setTimeout(fillSlots, 0);
  } else if (name === "intel") {
    const A = G.intel.alerts.slice().reverse().slice(0, 12), C = G.intel.contacts.slice().sort((a, b) => b.seen - a.seen).slice(0, 14);
    const bases = liveBases();
    h = '<p class="dim">' + (G.phase && G.phase.n ? "Phase " + G.phase.n + ": " + bases.length + (bases.length === 1 ? " base" : " bases") + " somewhere in the mist." : "Nothing has come yet.") + ' <button class="info" data-info="intel" aria-label="About intel">' + icon("info") + "</button></p>";
    h += "<h3>Alarms</h3>" + (A.length ? A.map((a) => '<button class="row go" data-x="' + a.x + '" data-y="' + a.y + '">' + icon("alert") + "<span><b>" + esc(a.what || "Something") + "</b><small>" + ago(a.t) + (a.n > 1 ? " · " + a.n + " strikes" : "") + "</small></span>" + icon("locate") + "</button>").join("") : '<p class="dim">Quiet.</p>');
    h += "<h3>Contacts</h3>" + (C.length ? C.map((c) => { const hd = headingOf(c); return '<button class="row go" data-x="' + c.x + '" data-y="' + c.y + '">' + icon(c.src === 1 ? "radar" : "eye") + "<span><b>" + c.n + (c.air ? " (" + c.air + " flying)" : "") + "</b><small>" + (G.time - c.seen < 1 ? "In sight" : "Seen " + ago(c.seen)) + (hd && hd.to ? " · heading for your " + esc(nameOf(hd.to)) + ", ~" + Math.round(hd.eta) + "s" : "") + "</small></span>" + icon("locate") + "</button>"; }).join("") : '<p class="dim">No enemies seen.</p>');
    const known = bases.map((b) => G.ghosts.get(b.core) ? b : null).filter(Boolean);
    h += "<h3>Known bases</h3>" + (known.length ? known.map((b) => '<button class="row go" data-x="' + b.x + '" data-y="' + b.y + '">' + icon("tower") + "<span><b>" + ERAS[b.era].name + " base</b><small>Phase " + b.phase + "</small></span>" + icon("locate") + "</button>").join("") : '<p class="dim">None found yet. Send scouts.</p>');
  } else if (name === "ledger") {
    h = ledger.render();
  } else if (name === "details") {
    h = details.render(selected()[0]);
  } else if (name === "auto") {
    const D = (id) => !!G.doctrines[id], A = G.auto;
    const lock = (id) => D(id) ? DOCTRINES[id].line : "Research at the academy" + (DOCTRINES[id].era > G.era ? " (" + ERAS[DOCTRINES[id].era].age + ")" : "");
    h = '<p class="dim">Habits, not clicks. <button class="info" data-info="automation" aria-label="About automation">' + icon("info") + "</button></p><div class=\"stack\">";
    h += "<h3>Economy</h3>";
    for (const id of ["foreman", "quarter", "repair", "census", "colonists"]) h += sw("a:" + id, D(id) && A[id] !== false, D(id), DOCTRINES[id].name, lock(id));
    if (D("census")) h += slider("workerTarget", A.workerTarget, 5, 150, 1, "Workers to keep");
    if (D("governor")) h += "<h3>Stewards</h3>" + sw("a:demand", !!A.demand, true, "Follow demand", "Lean towards whatever the realm is short of.") + slider("r:gold", A.ratio.gold, 0, 100, 5, "Gold") + slider("r:wood", A.ratio.wood, 0, 100, 5, "Wood") + slider("r:stone", A.ratio.stone, 0, 100, 5, "Stone");
    else h += sw("x", false, false, DOCTRINES.governor.name, lock("governor"));
    h += "<h3>Building</h3>";
    for (const id of ["masons", "sentinels"]) h += sw("a:" + id, D(id) && A[id] !== false, D(id), DOCTRINES[id].name, lock(id));
    h += "<h3>Defence</h3>";
    for (const id of ["signal", "captains", "rebirth", "overmind", "satellite", "drones"]) h += sw("a:" + id, D(id) && A[id] !== false, D(id), DOCTRINES[id].name, lock(id));
    h += sw("a:wake", !!A.wake, true, "Wake me", "Pause when a big contact comes near home.") + (A.wake ? slider("wakeAt", A.wakeAt, 3, 60, 1, "Contact size that wakes") : "");
    h += "<h3>" + esc(DOCTRINES.standing.name) + "</h3>";
    if (D("standing")) {
      h += sw("a:standing", A.standing === true, true, "Keep the army up", "Trains whenever it is under the target.") + slider("armyTarget", A.army.target, 5, 300, 5, "Army size (supply)");
      for (const l of ["melee", "ranged", "mender", "mounted", "siege", "naval", "air"]) if (LINES[l].first <= G.era) h += slider("mix:" + l, A.army.mix[l] || 0, 0, 6, 1, LINES[l].names[tierOf(l)]);
    } else h += '<p class="dim">' + esc(lock("standing")) + "</p>";
    h += "<h3>" + esc(DOCTRINES.bureau.name) + "</h3>";
    if (D("bureau")) {
      h += '<p class="dim">Kept going whenever a building is free:</p>';
      for (const c in TECH_CATS) h += sw("k:" + c, !!A.keep[c], true, TECH_CATS[c].name, "At the " + BUILDINGS[TECH_CATS[c].at].names[Math.min(9, G.era)] + " · level " + lvl(c) + "/" + TECH_CATS[c].max);
      h += sw("kr", A.keepRefit, true, "Retraining", "Every line, into its next version.") + sw("kl", A.keepLevels, true, "Raising buildings", "Every building, to the era's limit.") + sw("ke", A.keepEra, true, "The next era", "As soon as it can be begun.");
    } else h += '<p class="dim">' + esc(lock("bureau")) + "</p>";
    h += "<h3>" + esc(DOCTRINES.logistics.name) + "</h3>" + (D("logistics") ? '<button class="btn" data-go="muster">' + icon("flag") + (A.muster ? "Move the muster point" : "Set a muster point") + "</button>" : '<p class="dim">' + esc(lock("logistics")) + "</p>");
    h += "<h3>" + esc(DOCTRINES.command.name) + "</h3>" + (D("command") ? sw("a:command", !!A.command, true, "Strike when ready", "Sends the idle army at the nearest known base.") + slider("commandAt", A.commandAt, 10, 300, 5, "Army size to strike at (supply)") : '<p class="dim">' + esc(lock("command")) + "</p>");
    h += "</div>";
  } else if (name === "codex") {
    h = G.codex.length ? '<div class="codex">' + G.codex.slice().reverse().map((c) => '<blockquote class="' + c.kind + '"><p>' + esc(c.text) + "</p><small>" + ERAS[c.era || 0].age + " · " + time(c.t) + "</small></blockquote>").join("") + "</div>" : '<p class="dim">Nothing yet.</p>';
    h += '<p class="dim">' + (G.loreSeen ? G.loreSeen.length : 0) + " ruins read.</p>";
  } else if (name === "realm") {
    const E = ERAS[Math.min(MAX_ERA, G.era + 1)], hall = G.blds.find((b) => !b.dead && b.team === 0 && b.type === "hall");
    h = "<h3>" + ERAS[G.era].age + ' <button class="info" data-info="eras" aria-label="About eras">' + icon("info") + "</button></h3>";
    if (G.era < MAX_ERA) h += '<p class="dim">Next: ' + E.age + " — " + G.stats.phases + "/" + E.adv.phases + " phases cleared, hall at level " + (hall ? hall.level : 0) + "/" + maxLevel(G.era) + ". " + costHTML(E.adv.cost) + "</p>";
    else h += '<p class="dim">' + (G.beaconLit ? "The Beacon burns." : "The last age. Something is still left to build.") + "</p>";
    h += '<div class="prog"><i style="width:' + Math.round(completion() * 100) + '%"></i><span>The long road: ' + Math.round(completion() * 100) + "%</span></div>";
    h += "<h3>Phases " + '<button class="info" data-info="phases" aria-label="About phases">' + icon("info") + "</button></h3><p class=\"dim\">" + G.stats.phases + " cleared." + (G.phase && !G.phase.cleared ? " Phase " + G.phase.n + " under way." : "") + " Explored " + Math.round(exploredShare() * 100) + "% of the known land.</p>";
    h += "<h3>Champions " + '<button class="info" data-info="champions" aria-label="About champions">' + icon("info") + "</button></h3>";
    h += HERO_IDS.map((id) => { const s = G.heroes[id], u = s && s.uid && G.ents.get(s.uid); return '<div class="row"><img class="por sm" src="' + portrait("unit", "melee", G.era, 0, id) + '" alt=""><span><b>' + HEROES[id].name + "</b><small>" + HEROES[id].role + (s ? " · Lv " + s.lvl + (u ? "" : " · fallen") : " · not yet called") + "</small></span>" + (u ? '<button class="btn small" data-hero="' + id + '">' + icon(u.manual ? "release" : "control") + (u.manual ? "Let go" : "Control") + "</button>" : "") + "</div>"; }).join("");
    h += "<h3>Lines</h3><div class=\"grid2\">" + TRAINED.filter((l) => LINES[l].first <= G.era).map((l) => "<span>" + LINES[l].names[tierOf(l)] + "</span>").join("") + "</div>";
    h += "<h3>Research</h3><div class=\"grid2\">" + Object.keys(TECH_CATS).filter((c) => (TECH_CATS[c].first || 0) <= G.era).map((c) => "<span>" + TECH_CATS[c].name + " <b>" + lvl(c) + "/" + TECH_CATS[c].max + "</b></span>").join("") + "</div>";
    const S = G.stats;
    h += "<h3>Record</h3><p class=\"dim\">" + time(S.playtime) + " played · " + fmt(S.gathered) + " gathered · " + S.built + " built · " + S.killed + " destroyed · " + S.lost + " lost.</p>";
  } else if (name === "defeat") {
    h = '<p>Every hall is ash and every worker gone. The mist comes in.</p><div class="stack"><button class="btn wide primary" data-go="load">' + icon("folder") + 'Load a save</button><button class="btn wide" data-go="title">' + icon("release") + "To the title</button></div>";
  } else if (name === "complete") {
    h = '<div class="codex">' + G.codex.filter((c) => c.kind === "end").map((c) => "<blockquote class=\"end\"><p>" + esc(c.text) + "</p></blockquote>").join("") + '</div><p class="dim">The phases go on, if you want them to. ' + time(G.stats.playtime) + ' played.</p><div class="stack"><button class="btn wide primary" data-go="resume">' + icon("play") + "Go on</button></div>";
  }
  body.innerHTML = h;
  hydrateIcons(body);
  if (soft) body.scrollTop = keepScroll;
}
/** How far along the long road: eras, every line's version, research, doctrines, champions. */
export function completion() {
  let have = 0, all = 0;
  have += G.era; all += MAX_ERA;
  for (const c in TECH_CATS) { have += lvl(c); all += TECH_CATS[c].max; }
  for (const l of TRAINED) { have += Math.max(0, tierOf(l) - LINES[l].first); all += MAX_ERA - LINES[l].first; }
  have += Object.keys(G.doctrines).length * 2; all += DOCTRINE_IDS.length * 2;
  for (const id of HERO_IDS) { have += G.heroes[id] ? (G.heroes[id].lvl || 1) / 6 : 0; all += 5; }
  have += G.beaconLit ? 10 : 0; all += 10;
  return Math.min(1, have / all);
}
function versionLine() {
  return '<p class="ver">Aeons v' + esc(update.version()) + ' · <button class="link" data-go="update">Check for updates</button> <span id="updState"></span> <button class="info" data-info="privacy" aria-label="What is stored">' + icon("info") + '</button> · <a class="link" href="https://buymeacoffee.com/noju" target="_blank" rel="noopener">Buy me a coffee</a></p>';
}
function fillSlots() {
  const box = $("slots"); if (!box) return;
  const saving = $("panel").dataset.arg === "save";
  listSlots().then((list) => {
    box.innerHTML = list.map(({ slot, meta }) => {
      const name = slot === "auto" ? "Autosave" : "Slot " + slot;
      const m = meta ? ERAS[meta.era || 0].age + " · phase " + (meta.phase || 0) + " · " + time(meta.playtime || 0) + " · " + new Date(meta.savedAt).toLocaleString() : "Empty";
      const btns = (saving && slot !== "auto" ? '<button class="btn small primary" data-slot="' + slot + '" data-do="save">Save here</button>' : "") + (!saving && meta ? '<button class="btn small primary" data-slot="' + slot + '" data-do="load">Load</button>' : "") + (meta && slot !== "auto" && !saving ? '<button class="iconBtn small" data-slot="' + slot + '" data-do="del" aria-label="Delete">' + icon("trash") + "</button>" : "");
      return '<div class="row slot"><span><b>' + name + "</b><small>" + esc(m) + "</small></span>" + btns + "</div>";
    }).join("");
  }, () => { box.innerHTML = '<p class="dim">Saving is not available in this browser.</p>'; });
}
function panelEvents() {
  $("panelClose").addEventListener("click", closePanel);
  $("panel").addEventListener("click", (e) => {
    if (panelName === "ledger" && ledger.click(e.target)) { if (panelName) renderPanel(true); return; }
    const g = e.target.closest("[data-go]");
    if (g) {
      const k = g.dataset.go;
      if (k === "resume") closePanel();
      else if (k === "save") openPanel("saves", "save");
      else if (k === "load") openPanel("saves", "load");
      else if (k === "settings") openPanel("settings");
      else if (k === "quit") emit("quit");
      else if (k === "title") emit("toTitle");
      else if (k === "export") { const blob = new Blob([exportJSON()], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "aeons-" + ERAS[G.era].name.toLowerCase() + "-phase" + (G.phase ? G.phase.n : 0) + ".json"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
      else if (k === "muster") { closePanel(); beginTarget("muster", "Tap the muster point"); }
      else if (k === "update") { const s = $("updState"); if (s) s.textContent = "checking…"; update.checkNow().then((r) => { const el = $("updState"); if (el) el.textContent = { ready: "a new version is ready", downloading: "downloading…", current: "up to date", offline: "offline", unsupported: "not installed" }[r] || r; }); }
      return;
    }
    const s = e.target.closest("[data-do]");
    if (s) {
      const slot = s.dataset.slot;
      if (s.dataset.do === "save") saveSlot(slot).then(() => { toast("Saved to slot " + slot, "good"); fillSlots(); }, (er) => toast("Could not save: " + er.message, "bad"));
      if (s.dataset.do === "load") emit("loadSlot", slot);
      if (s.dataset.do === "del") { if (confirm("Delete this save?")) deleteSlot(slot).then(fillSlots); }
      return;
    }
    const x = e.target.closest(".go");
    if (x) { view.cam.x = +x.dataset.x; view.cam.y = +x.dataset.y; ping(+x.dataset.x, +x.dataset.y, "#ff6a6a", 40, 2); closePanel(); return; }
    const hb = e.target.closest("[data-hero]");
    if (hb) { const h = G.heroes[hb.dataset.hero], u = h && h.uid && G.ents.get(h.uid); if (u) { u.manual ? release() : possess(u); closePanel(); } }
  });
  $("panel").addEventListener("input", (e) => {
    const t = e.target, k = t.dataset.set;
    if (!k) return;
    const out = t.parentElement.querySelector("output"); if (out) out.textContent = t.value;
    if (k === "master" || k === "sfx" || k === "music" || k === "panSpeed") { settings[k] = +t.value; saveSettings(); audio.setVolumes(settings); return; }
    if (k === "workerTarget" || k === "commandAt" || k === "wakeAt") { G.auto[k] = +t.value; return; }
    if (k === "armyTarget") { G.auto.army.target = +t.value; return; }
    if (k.startsWith("mix:")) { G.auto.army.mix[k.slice(4)] = +t.value; return; }
    if (k.startsWith("r:")) { G.auto.ratio[k.slice(2)] = +t.value; return; }
  });
  $("panel").addEventListener("change", (e) => {
    const t = e.target, k = t.dataset.set;
    if (t.id === "importFile" && t.files && t.files[0]) { t.files[0].text().then((txt) => emit("importSave", txt)); return; }
    if (!k || t.type !== "checkbox") return;
    const v = t.checked;
    if (k.startsWith("s:")) { const n = k.slice(2); if (n === "hi") settings.quality = v ? "high" : "low"; else settings[n] = v; saveSettings(); emit("settings"); return; }
    if (k.startsWith("a:")) { G.auto[k.slice(2)] = v; if (k === "a:wake" || k === "a:standing") renderPanel(true); return; }
    if (k.startsWith("k:")) { G.auto.keep[k.slice(2)] = v; return; }
    if (k === "kr") G.auto.keepRefit = v; if (k === "kl") G.auto.keepLevels = v; if (k === "ke") G.auto.keepEra = v;
  });
}

/* =========================================================================
   The title
   ========================================================================= */
export function showTitle(hasAuto) {
  document.body.classList.add("atTitle");
  $("title").hidden = false; $("hud").hidden = true; closePanel();
  $("btnContinue").hidden = !hasAuto;
  $("titleVer").innerHTML = versionLine();
  hydrateIcons($("titleVer"));
}
export function hideTitle() { document.body.classList.remove("atTitle"); $("title").hidden = true; $("hud").hidden = false; $("newGame").hidden = true; }
function titleEvents() {
  $("title").addEventListener("click", (e) => {
    const b = e.target.closest("[data-t]");
    if (!b) return;
    audio.unlock();
    const k = b.dataset.t;
    if (k === "continue") emit("loadSlot", "auto");
    if (k === "new") { $("newGame").hidden = false; }
    if (k === "load") { openPanel("saves", "load"); }
    if (k === "settings") openPanel("settings");
    if (k === "diff") { $("newGame").querySelectorAll("[data-t=diff]").forEach((x) => x.classList.toggle("on", x === b)); }
    if (k === "begin") {
      const d = ($("newGame").querySelector("[data-t=diff].on") || {}).dataset;
      const seedTxt = $("seed").value.trim();
      emit("startGame", { diff: (d && d.v) || "normal", seedTxt });
    }
    if (k === "cancelNew") $("newGame").hidden = true;
    if (k === "update") { update.checkNow(); }
  });
  $("title").addEventListener("click", (e) => { const g = e.target.closest("[data-go=update]"); if (g) { const s = $("updState"); if (s) s.textContent = "checking…"; update.checkNow().then((r) => { const el = $("updState"); if (el) el.textContent = { ready: "a new version is ready", downloading: "downloading…", current: "up to date", offline: "offline", unsupported: "not installed" }[r] || r; }); } });
}

/* =========================================================================
   Hooking it up
   ========================================================================= */
export function init() {
  buildRes();
  sideEvents(); cardEvents(); selEvents(); panelEvents(); titleEvents();
  $("btnMenu").addEventListener("click", () => openPanel("menu"));
  $("btnIntel").addEventListener("click", () => openPanel("intel"));
  $("btnLedger").addEventListener("click", () => openPanel("ledger"));
  on("closePanel", () => closePanel());
  on("squads", () => { if (panelName === "ledger") renderPanel(true); });
  $("btnAuto").addEventListener("click", () => openPanel("auto"));
  $("btnCodex").addEventListener("click", () => openPanel("codex"));
  $("phaseChip").addEventListener("click", () => openPanel("realm"));
  $("btnPause").addEventListener("click", () => emit("togglePause"));
  $("btnSpeed").addEventListener("click", () => emit("cycleSpeed"));
  $("btnAlert").addEventListener("click", () => emit("jumpAlert"));
  $("targetCancel").addEventListener("click", cancelMode);
  $("placeOk").addEventListener("click", () => confirmPlace(false));
  $("placeCancel").addEventListener("click", cancelMode);
  on("wantPanel", (n) => panelOpen() ? closePanel() : openPanel(n));
  on("selection", () => { sub = null; page = 0; selSig = ""; });
  on("mode", () => drawCard(true));
  on("wantRally", () => beginTarget("rally", "Tap the rally point"));
  on("possess", () => { selSig = ""; manSig = ""; });
  on("toast", (t, k) => toast(t, k));
  hydrateIcons(document);
}
/* With a mouse, whatever is under the pointer says what it is. */
let hoverT = 0;
function hover(dt) {
  const tip = $("hoverTip");
  hoverT -= dt;
  if (hoverT > 0) return;
  hoverT = 0.12;
  if (document.body.classList.contains("touchUI") || !mouse.in || mode.kind || panelOpen()) { tip.hidden = true; return; }
  const p = pickAt(mouse.x, mouse.y, 1), e = p.ent;
  if (!e || (e.kind === "node" && e.type === "relic" && false)) { tip.hidden = true; return; }
  let h = "<b>" + esc(nameOf(e)) + "</b>";
  if (e.kind === "unit" || e.kind === "bld") h += " <span>" + Math.ceil(e.hp) + "/" + e.maxHp + "</span>" + (e.team === 1 ? ' <i class="foe">enemy</i>' : e.team === 2 ? ' <i class="wild">wild</i>' : "");
  if (e.kind === "unit" && e.rank) h += ' <i class="rk">' + RANK_NAMES[e.rank] + "</i>";
  if (e.kind === "node" && (e.type === "gold" || e.type === "stone")) h += " <span>" + fmt(e.amount) + " left</span>";
  if (tip.dataset.h !== h) { tip.innerHTML = h; tip.dataset.h = h; }
  tip.hidden = false;
  tip.style.left = Math.min(view.W - 220, mouse.x + 16) + "px"; tip.style.top = Math.min(view.H - 40, mouse.y + 18) + "px";
}
let acc = 0;
export function frame(dt) {
  if (document.body.classList.contains("atTitle")) return;
  drawTop(); tickToasts(); tickBanner(); drawModes(); hover(dt);
  acc += dt;
  if (acc > 0.12) { acc = 0; drawSide(); drawCard(); drawSel(); drawManual(); tickPanel(); }
}
export { nameOf as name, darkness, HERO_LINES };

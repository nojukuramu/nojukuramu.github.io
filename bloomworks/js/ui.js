/* ui.js — the interface: the top bar, the dock, the panels, the card for
 * whatever is selected, toasts, the Logbook, Zen Mode.
 *
 * House rule: the UI says one line, and the explanation lives behind a small
 * (i) that opens the info sheet (topics.js). Panels are drawn as HTML strings
 * and redrawn about once a second while open, except while you are typing
 * into one. Every button carries data-act; one delegated listener runs them. */

import { S, RT, pk } from "./state.js";
import { ZERO, fmtL, fmt, fmtTime, lGte, lAdd, lSub, setNotation, fmtMulL } from "./num.js";
import {
  TYPES, FAMILIES, HUES, HUE_LIST, BIOMES, WEATHER, CRITTERS, CRITTER_KINDS, MATERIALS, materialOf, SPECS, WORKSHOP, MODS, MOD_KEYS, RELICS, RELIC_KEYS,
  rarityName, RARITY_COLS, SEED_TREE, CONSTELLATIONS, CONSTELLATION_EXTRA, TRIALS, HEART_STAGES, COSMOS_TREE, LAWS, JOBS, UPGRADER_RULES,
  CONDITIONS, ACTIONS, FEAT_TIERS, HIDDEN_FEATS, LORE, NOTE_NAMES, WONDERS, SEASON_KINDS, TILES, WINDFALLS, BUILDABLE, DX, DY, bloomName, COMBO_LOOKS
} from "./data.js";
import * as E from "./econ.js";
import * as B from "./build.js";
import * as sim from "./sim.js";
import * as goals from "./goals.js";
import * as auto from "./auto.js";
import * as pr from "./prestige.js";
import * as ev from "./events.js";
import * as info from "./info.js";
import * as upd from "./update.js";
import * as save from "./save.js";
import * as audio from "./audio.js";
import { icon, hydrateIcons } from "./icons.js";
import { cam, spriteURL, skyPoints, forgetPlots, setQuality } from "./render.js";
import { mode, smartRot } from "./input.js";
import { T, tileAt, getPlot, plotOfTile, plotSize, owned, claimable, TILE_NAMES, ringOf } from "./world.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ii = (topic) => '<button class="ib" data-info="' + topic + '" aria-label="About this">' + icon("info") + "</button>";
const btn = (act, arg, label, cls, dis) => '<button class="btn ' + (cls || "") + '" data-act="' + act + '"' + (arg != null ? ' data-arg="' + esc(arg) + '"' : "") + (dis ? " disabled" : "") + ">" + label + "</button>";
const costTxt = (l) => (l === ZERO ? "Free" : fmtL(l));

let panel = null;
const tabs = { season: "harvest", codex: "types", goals: "board", tinkers: "crew" };
let buyAmt = 1;
let lastInput = 0, lastHtml = "", panelAt = 0;
let card = null;          // { kind: "copy"|"ghost"|"tile"|"plot", ... }
export const ui = { preview: null };

/* ---------- toasts ---------- */
export function toast(text, kind, ic) {
  const box = $("toasts");
  if (!box) return;
  const el = document.createElement("div");
  el.className = "toast " + (kind || "info");
  el.innerHTML = icon(ic || "spark") + "<span>" + esc(text) + "</span>";
  box.prepend(el);
  while (box.children.length > 5) box.lastChild.remove();
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 400); }, kind === "big" ? 5200 : 3600);
  if (kind === "milestone") audio.sound.milestone();
}

/* ---------- init ---------- */
export function init() {
  hydrateIcons();
  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);
  document.addEventListener("input", () => { lastInput = performance.now(); });
  $("panelClose").addEventListener("click", closePanel);
  // A press inside a panel holds its redraw, so a button never moves under a finger.
  for (const id of ["panel", "card"]) $(id).addEventListener("pointerdown", () => { lastInput = performance.now(); });
  $("placeRot").addEventListener("click", () => { mode.rot = (mode.rot + 1) & 3; });
  $("placeDone").addEventListener("click", () => endMode());
  $("placePlan").addEventListener("change", (e) => { mode.plan = e.target.checked; });
  $("logClose").addEventListener("click", () => { $("logbook").hidden = true; RT.replay = null; });
  upd.onChange(() => { const st = $("updState"); if (st) renderPanel(); });
  ui.preview = preview;
}
function onChange(e) {
  const t = e.target;
  const act = t.dataset.chg;
  if (!act) return;
  lastInput = performance.now();
  const v = t.type === "checkbox" ? t.checked : t.value;
  CHG[act] && CHG[act](v, t.dataset.arg, t);
  renderPanel(true); renderCard(true);
}
function onClick(e) {
  const b = e.target.closest ? e.target.closest("[data-act]") : null;
  if (!b || b.disabled) return;
  e.preventDefault();
  audio.unlock();
  const f = ACT[b.dataset.act];
  if (f) { f(b.dataset.arg, b); audio.sound.click(); }
  renderPanel(true); renderCard(true);
}

/* ---------- panels ---------- */
export function openPanel(id) {
  if (panel === id) return closePanel();
  panel = id;
  $("panel").hidden = false;
  document.body.classList.add("panelOpen");
  for (const d of document.querySelectorAll("#dock [data-act=panel]")) d.classList.toggle("on", d.dataset.arg === id);
  renderPanel(true);
}
export function closePanel() {
  panel = null;
  $("panel").hidden = true;
  document.body.classList.remove("panelOpen");
  for (const d of document.querySelectorAll("#dock [data-act=panel]")) d.classList.remove("on");
}
export const panelOpen = () => panel;
const TITLES = { build: "Build", levels: "Levels", workshop: "Workshop", season: "Seasons", goals: "Goals", tinkers: "Automation", codex: "Codex", menu: "Menu" };
export function renderPanel(force) {
  if (!panel) return;
  const body = $("panelBody");
  if (!force) {
    const a = document.activeElement;
    if (a && body.contains(a) && (a.tagName === "INPUT" || a.tagName === "SELECT" || a.tagName === "TEXTAREA")) return;
    if (performance.now() - lastInput < 1500) return;
  }
  $("panelTitle").textContent = TITLES[panel];
  const html = (PANELS[panel] || (() => ""))();
  if (!force && html === lastHtml) return;
  lastHtml = html;
  const top = body.scrollTop;
  body.innerHTML = html;
  hydrateIcons(body);
  body.scrollTop = top;
}

function unlockText(type) {
  const u = TYPES[type].unlock;
  if (u.glow) return "At " + fmt(u.glow) + " Glow in one Season";
  if (u.season) return "Season " + u.season;
  if (u.plot === "river") return "Claim a plot with a River";
  if (u.plot) return "Claim a " + BIOMES[u.plot].name + " plot";
  if (u.wonder) return "Found in Ruins";
  if (u.cosmos) return "Cosmos Tree: Celestial Designs";
  if (u.eclipse) return "After your first Eclipse";
  return "";
}
function typeCard(type) {
  const T0 = TYPES[type], open = E.unlocked(type);
  if (!open && T0.fam === "wonder") return "";
  const placed = E.count(type);
  const cost = E.buildCostL(type);
  const can = open && lGte(S.season.glow, cost);
  if (T0.fam === "wonder" && placed) return "";
  if (T0.fam === "heart" && placed) return "";
  return '<button class="tcard' + (open ? "" : " locked") + (can ? "" : " poor") + (mode.type === type ? " on" : "") + '" data-act="pick" data-arg="' + type + '"' + (open ? "" : " disabled") + ">" +
    '<img alt="" src="' + spriteURL(type, 0) + '">' +
    "<b>" + T0.name + "</b>" +
    "<span>" + (open ? costTxt(cost) + (placed ? " · ×" + placed : "") : icon("lock") + unlockText(type)) + "</span></button>";
}
const PANELS = {
  build() {
    let h = '<div class="row"><label class="sw"><input type="checkbox" data-chg="plan"' + (mode.plan ? " checked" : "") + "> Plan: place Ghosts</label>" + ii("ghosts") + '<span class="grow"></span>' + ii("howto") + "</div>";
    for (const f of FAMILIES) {
      const list = BUILDABLE.concat(WONDERS, ["worldheart"]).filter((k) => TYPES[k].fam === f.id || (f.id === "hearth" && k === "worldheart"));
      const cards = list.map(typeCard).join("");
      if (!cards) continue;
      h += '<h3>' + f.name + " <small>" + f.line + "</small></h3><div class=\"grid\">" + cards + "</div>";
    }
    h += '<h3>Blueprints ' + ii("blueprints") + "</h3>";
    h += '<div class="row">' + btn("bpArea", null, icon("blueprint") + "Save an area") + "</div>";
    for (const bp of S.meta.blueprints) {
      const miss = auto.missingParts(bp);
      h += '<div class="item"><div><b>' + esc(bp.name) + "</b><small>" + bp.w + "×" + bp.h + " · " + bp.parts.length + " parts" + (miss.length ? ' · <span class="bad">' + miss.length + " undiscovered</span>" : "") + "</small></div>" +
        btn("bpStamp", bp.id, "Stamp") + btn("bpCode", bp.id, icon("copy")) + btn("bpDel", bp.id, icon("trash"), "ghost") + "</div>";
    }
    h += '<div class="row"><input id="bpImport" type="text" placeholder="Paste a Blueprint code (BW1:...)" autocomplete="off" spellcheck="false">' + btn("bpImport", null, "Import") + "</div>";
    return h;
  },
  levels() {
    const amts = [[1, "×1"], [10, "×10"], [25, "×25"], ["ms", "Next Milestone"], ["max", "Max"]];
    let h = '<div class="seg">' + amts.map(([v, l]) => '<button data-act="amt" data-arg="' + v + '" class="' + (String(buyAmt) === String(v) ? "on" : "") + '">' + l + "</button>").join("") + "</div>" + '<p class="hint">One Level upgrades every copy of a type. ' + ii("levels") + "</p>";
    const types = [...new Set(S.season.copies.map((c) => E.lvlKey(c.type)))].filter((k) => TYPES[k].level);
    if (!types.length) return h + '<p class="empty">Build something first.</p>';
    for (const k of types) h += levelRow(k);
    return h;
  },
  workshop() {
    let h = '<p class="hint">Glow upgrades that last until the next Harvest. ' + ii("workshop") + "</p>";
    for (const k in WORKSHOP) {
      const w = WORKSHOP[k], open = E.workshopOpen(k), cost = E.workshopCostL(k);
      h += '<div class="item' + (open ? "" : " locked") + '"><div><b>' + w.name + " <small>Lv " + E.ws(k) + "</small></b><small>" + w.text + "</small></div>" +
        (open ? btn("ws", k, fmtL(cost), lGte(S.season.glow, cost) ? "primary" : "", !lGte(S.season.glow, cost)) : '<small class="lock">' + icon("lock") + (w.at.glow ? fmt(w.at.glow) + " Glow" : w.at.plot ? "First plot" : "First Fuser") + "</small>") + "</div>";
    }
    return h;
  },
  season() {
    const t = tabs.season;
    const list = [["harvest", "Harvest"], ["tree", "Seed Tree"]];
    if (S.meta.everEclipsed || S.world.eclipses) list.push(["sky", "Sky"], ["trials", "Trials"], ["heart", "World Heart"]);
    if (S.meta.depth > 0 || pr.genesisReady()) list.push(["cosmos", "Cosmos"]);
    let h = tabBar("season", list);
    h += (SEASON_TABS[t] || SEASON_TABS.harvest)();
    return h;
  },
  goals() {
    let h = tabBar("goals", [["board", "Commissions"], ["moths", "Moths & Merchant"], ["feats", "Feats"]]);
    return h + (GOAL_TABS[tabs.goals] || GOAL_TABS.board)();
  },
  tinkers() {
    let h = tabBar("tinkers", [["crew", "Tinkers"], ["dir", "Directives"], ["ghosts", "Ghosts"]]);
    return h + (AUTO_TABS[tabs.tinkers] || AUTO_TABS.crew)();
  },
  codex() {
    const c = goals.codexCounts();
    let h = tabBar("codex", [["types", "Contraptions"], ["wonders", "Wonders " + c.wonders + "/8"], ["critters", "Critters " + c.critters + "/" + c.ofCritters], ["world", "Biomes & weather"], ["lore", "Lore " + c.lore + "/" + LORE.length], ["mods", "Mods"], ["relics", "Relics"]]);
    return h + (CODEX_TABS[tabs.codex] || CODEX_TABS.types)();
  },
  menu() {
    const st = S.meta.settings, u = upd.state();
    let h = "<h3>Settings</h3>";
    h += '<div class="item"><div><b>Numbers</b><small>Short names, scientific or engineering</small></div><select data-chg="notation">' + [["short", "1.23M"], ["sci", "1.23e6"], ["eng", "1.23e6 (eng)"]].map(([v, l]) => '<option value="' + v + '"' + (st.notation === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select>" + ii("numbers") + "</div>";
    h += '<div class="item"><label class="sw"><input type="checkbox" data-chg="sound"' + (st.sound ? " checked" : "") + "> Sound</label>" + '<label class="sw"><input type="checkbox" data-chg="music"' + (st.music ? " checked" : "") + "> Music</label>" + '<label class="sw"><input type="checkbox" data-chg="pops"' + (st.pops ? " checked" : "") + "> Number pops</label>" + '<label class="sw"><input type="checkbox" data-chg="quality"' + (st.quality !== "low" ? " checked" : "") + "> Shadows and glow</label></div>";
    h += '<div class="row">' + btn("zen", null, icon("zen") + "Zen Mode") + ii("zen") + "</div>";
    h += "<h3>Version</h3>";
    h += '<div class="item"><div><b>Bloomworks ' + esc(u.version) + '</b><small id="updState">' + (u.ready ? "A new version is ready." : u.supported ? "Updates are checked every 30 minutes." : "Updates need the installed app.") + "</small></div>" + btn(u.ready ? "updApply" : "updCheck", null, u.ready ? "Reload" : "Check for updates") + "</div>";
    h += "<h3>Save " + ii("saving") + "</h3>";
    h += '<div class="row">' + btn("saveNow", null, icon("download") + "Save now") + btn("export", null, icon("copy") + "Export") + "</div>";
    h += '<textarea id="saveCode" rows="3" placeholder="Export puts a code here; paste one to import." spellcheck="false"></textarea>';
    h += '<div class="row">' + btn("import", null, icon("upload") + "Import") + btn("wipe", null, icon("trash") + "New world", "danger") + "</div>";
    h += "<h3>About</h3><div class=\"row wrap\">" + ["about", "howto", "active", "offline", "privacy"].map((k) => '<button class="btn ghost" data-info="' + k + '">' + esc(info.has(k) ? k.charAt(0).toUpperCase() + k.slice(1) : k) + "</button>").join("") + '<a class="btn ghost" href="https://buymeacoffee.com/noju" target="_blank" rel="noopener">' + icon("heart") + "Buy me a coffee</a></div>";
    h += '<p class="hint">Played ' + fmtTime(S.meta.stats.played) + " · " + S.meta.stats.harvests + " Harvests · " + S.meta.stats.eclipses + " Eclipses · Depth " + S.meta.depth + "</p>";
    return h;
  }
};
function tabBar(id, list) {
  if (!list.some(([k]) => k === tabs[id])) tabs[id] = list[0][0];
  return '<div class="tabs">' + list.map(([k, l]) => '<button data-act="tab" data-arg="' + id + ":" + k + '" class="' + (tabs[id] === k ? "on" : "") + '">' + esc(l) + "</button>").join("") + "</div>";
}

function amountFor(k) {
  if (buyAmt === "max") return Math.max(1, E.affordLevels(k, S.season.glow));
  if (buyAmt === "ms") return 25 - (E.level(k) % 25);
  return +buyAmt;
}
function levelRow(k) {
  const T0 = TYPES[k], lv = E.level(k), n = amountFor(k), cost = E.levelCostL(k, n);
  const mat = materialOf(lv);
  const tp = E.baseTempo(k);
  let stat = tp ? fmt(tp) + (k === "track" ? " tiles/s" : "/s") + (E.overclock(k) ? " · OC " + E.overclock(k) : "") : "";
  if (k === "fuser") stat += " · Tier ≤ " + E.maxFuseTier();
  if (T0.fam === "source") stat += " · ×" + fmt(Math.pow(2, E.milestones(k)) * (1 + 0.05 * E.overclock(k))) + " Value";
  let h = '<div class="item lv"><img alt="" src="' + spriteURL(k, Math.min(7, Math.floor(lv / 25))) + '"><div><b>' + (k === "track" ? "Track & Splitter" : T0.name) + " <small>Lv " + lv + " · " + mat.name + "</small></b><small>" + stat + " · next Milestone " + (Math.floor(lv / 25) + 1) * 25 + "</small></div>" +
    btn("lv", k, "+" + n + " · " + fmtL(cost), lGte(S.season.glow, cost) ? "primary" : "", !lGte(S.season.glow, cost)) + "</div>";
  if (SPECS[k] && lv >= 100) {
    const cur = S.meta.specs && S.meta.specs[k];
    const can = pr.canPickSpec(k);
    h += '<div class="specs">' + SPECS[k].map((s, i) => '<button class="spec' + (cur === i ? " on" : "") + '" data-act="spec" data-arg="' + k + ":" + i + '"' + (can || cur === i ? "" : " disabled") + "><b>" + s.name + "</b><small>" + s.text + "</small></button>").join("") + ii("specs") + "</div>";
  }
  return h;
}

/* ---------- Season tabs ---------- */
const SEASON_TABS = {
  harvest() {
    const kind = E.seasonKind();
    const gain = E.harvestGainL(), ready = E.harvestReady();
    const dbl = ready && (S.eclipse.seeds === ZERO || gain >= S.eclipse.seeds);
    let h = '<div class="hero"><b>' + kind.name + " · Season " + S.seasonNo + "</b><small>" + kind.rule + " " + fmtTime(S.season.seasonT) + " in." + (pr.seasonLimit() ? " Ends at " + fmtTime(pr.seasonLimit()) + "." : "") + "</small>" + ii("seasons") + "</div>";
    h += '<div class="stats"><div><small>Glow this Season</small><b>' + fmtL(S.season.glowSeason) + "</b></div><div><small>Seeds</small><b>" + fmtL(S.eclipse.seeds) + "</b></div><div><small>Seed bonus</small><b>" + fmtMulL(lAdd(0, S.eclipse.seedsEarned + Math.log10(0.05))) + "</b></div></div>";
    if (!S.meta.stats.harvests && !lGte(S.season.glowSeason, 6)) {
      const f = Math.max(0, Math.min(1, (S.season.glowSeason === ZERO ? 0 : S.season.glowSeason) / 6));
      h += '<div class="bar"><i style="width:' + (f * 100).toFixed(1) + '%"></i></div><p class="hint">The first Harvest opens at 1M Glow in one Season.</p>';
    }
    h += '<button class="btn big ' + (dbl ? "gold" : ready ? "primary" : "") + '" data-act="harvest"' + (ready ? "" : " disabled") + ">" + icon("seed") + "Harvest" + (gain !== ZERO ? " +" + fmtL(gain) + " Seeds" : "") + "</button>";
    if (S.world.eclipses > 0) {
      h += '<div class="item"><div><b>Next Season</b><small>Run a Trial instead of a plain Season.</small></div><select data-chg="nextTrial"><option value="">A plain Season</option>' + Object.keys(TRIALS).map((k) => '<option value="' + k + '"' + (RT.nextTrial === k ? " selected" : "") + ">" + TRIALS[k].name + " (Rank " + E.trialRank(k) + ")</option>").join("") + "</select>" + ii("trials") + "</div>";
    }
    // Eclipse
    const eg = E.eclipseGainL(), er = E.eclipseReady();
    h += "<h3>Eclipse " + ii("eclipse") + "</h3>";
    const ef = Math.max(0, Math.min(1, (S.eclipse.seedsEarned === ZERO ? 0 : S.eclipse.seedsEarned) / 6));
    h += '<div class="bar star"><i style="width:' + (ef * 100).toFixed(1) + '%"></i></div><p class="hint">' + fmtL(S.eclipse.seedsEarned) + " of 1M Seeds earned since the last Eclipse.</p>";
    h += '<button class="btn big ' + (er ? "primary" : "") + '" data-act="eclipse"' + (er && !(RT.eclipseShow > 0) ? "" : " disabled") + ">" + icon("moon") + (RT.eclipseShow > 0 ? "Eclipse in " + Math.ceil(RT.eclipseShow) + "s" : "Eclipse +" + fmtL(eg) + " Stars") + "</button>";
    return h;
  },
  tree() {
    let h = '<p class="hint">Seeds: <b>' + fmtL(S.eclipse.seeds) + "</b>. Kept until the next Eclipse. " + ii("seedtree") + "</p>";
    h += '<div class="tree">';
    for (const br of SEED_TREE) {
      h += '<div class="branch"><h4>' + br.name + "</h4>";
      for (const n of br.nodes) {
        const lv = E.tree(n.id), open = pr.seedOpen(n.id), cost = open ? pr.seedCostL(n.id) : ZERO;
        const maxed = n.max != null && lv >= n.max;
        h += '<button class="node' + (lv ? " have" : "") + (maxed ? " max" : "") + '" data-act="seed" data-arg="' + n.id + '"' + (open && lGte(S.eclipse.seeds, cost) ? "" : " disabled") + "><b>" + n.name + " <small>" + lv + (n.max != null ? "/" + n.max : "") + "</small></b><small>" + n.text + "</small><em>" + (maxed ? "Done" : open ? fmtL(cost) + " Seeds" : icon("lock")) + "</em></button>";
      }
      h += "</div>";
    }
    return h + "</div>";
  },
  sky() {
    const tot = E.starsTotal(), placed = E.starsPlaced();
    let h = '<p class="hint">Stars: <b>' + (tot - placed) + "</b> to place of " + tot + ". " + (S.world.skyEdit ? "You can move Stars until your next Harvest." : "Placed Stars are fixed until the next Eclipse.") + " " + ii("eclipse") + "</p>";
    const w = 340, hh = 300;
    h += '<svg class="sky" viewBox="0 0 ' + w + " " + hh + '">';
    CONSTELLATIONS.forEach((C, i) => {
      const pts = skyPoints(i, w, hh);
      const done = E.constellationOn(C.id);
      for (let j = 1; j < C.stars; j++) if (done) h += '<line x1="' + pts[j - 1][0].toFixed(1) + '" y1="' + pts[j - 1][1].toFixed(1) + '" x2="' + pts[j][0].toFixed(1) + '" y2="' + pts[j][1].toFixed(1) + '"/>';
      for (let j = 0; j < C.stars + CONSTELLATION_EXTRA; j++) {
        const id = C.id + ":" + (j < C.stars ? j : "x" + (j - C.stars));
        const on = !!S.world.sky[id];
        h += '<circle data-act="star" data-arg="' + id + '" class="' + (on ? "on" : "") + (j >= C.stars ? " extra" : "") + '" cx="' + pts[j][0].toFixed(1) + '" cy="' + pts[j][1].toFixed(1) + '" r="' + (j >= C.stars ? 4 : 6) + '"/>';
      }
      const col = i % 3, row = Math.floor(i / 3);
      h += '<text x="' + ((col + 0.5) / 3 * w).toFixed(0) + '" y="' + ((row + 1) / 3 * hh - 6).toFixed(0) + '" class="' + (done ? "done" : "") + '">' + C.name + "</text>";
    });
    h += "</svg>";
    h += '<div class="list">' + CONSTELLATIONS.map((C) => '<div class="item small' + (E.constellationOn(C.id) ? " good" : "") + '"><div><b>' + C.name + " <small>" + C.stars + " Stars</small></b><small>" + C.text + (E.constellationOn(C.id) && E.constellationMul(C.id) > 1 ? " · +" + Math.round((E.constellationMul(C.id) - 1) * 100) + "%" : "") + "</small></div></div>").join("") + "</div>";
    for (const wc of E.wildList()) {
      const have = wc.pts.filter((p) => S.world.sky[p]).length;
      h += '<div class="item' + (wc.done ? " good" : "") + '"><div><b>Wild Constellation ' + (wc.i + 1) + " <small>" + have + "/" + wc.size + "</small></b><small>" + wildText(wc) + "</small></div>" + btn("wildAdd", wc.i, "+ Star", "", have >= wc.size || placed >= tot) + btn("wildLift", wc.i, "−", "ghost", !S.world.skyEdit || !have) + "</div>";
    }
    return h;
  },
  trials() {
    let h = '<p class="hint">Choose a Trial for your next Season on the Harvest tab. ' + ii("trials") + "</p>";
    if (S.season.trial) h += '<div class="hero"><b>Running: ' + TRIALS[S.season.trial].name + "</b><small>" + (S.season.trialDone ? "Passed this Season." : "Goal " + fmtL(pr.trialGoalL(S.season.trial)) + " Glow · " + fmtL(S.season.glowSeason) + " so far") + "</small></div>";
    for (const k in TRIALS) {
      const t = TRIALS[k];
      h += '<div class="item"><div><b>' + t.name + " <small>Rank " + E.trialRank(k) + "</small></b><small>" + t.limit + " → " + t.reward + " per Rank · goal " + fmtL(pr.trialGoalL(k)) + "</small></div>" + btn("pickTrial", k, RT.nextTrial === k ? "Chosen" : "Next Season", RT.nextTrial === k ? "primary" : "") + "</div>";
    }
    return h;
  },
  heart() {
    const H = S.world.heart;
    let h = '<p class="hint">Grown in the Home Plot from high-Tier motes. Each Stage: ×2 all Glow until Genesis. ' + ii("worldheart") + "</p>";
    if (!S.season.copies.some((c) => c.type === "worldheart")) h += '<div class="row">' + btn("pick", "worldheart", icon("heart") + "Place the World Heart", "primary") + "</div>";
    HEART_STAGES.forEach((st, i) => {
      const tier = st.tier + 2 * S.meta.depth;
      const need = st.n.toLocaleString() + (st.prism ? " Prismatic" : "") + " motes of Tier " + tier + (st.lucky ? ", each Lucky " + st.lucky + "+" : "") + (st.name ? ": " + st.name : "");
      const state = i < H.stage ? "done" : i === H.stage ? H.n + " / " + st.n : "";
      h += '<div class="item small' + (i < H.stage ? " good" : "") + '"><div><b>Stage ' + (i + 1) + "</b><small>" + need + "</small></div><small>" + state + "</small></div>";
    });
    if (pr.genesisReady()) {
      h += "<h3>Genesis " + ii("genesis") + "</h3><p class=\"hint\">Choose the Law for your next world. +" + E.stardustGain() + " Stardust.</p>";
      for (const k of pr.lawChoices()) h += '<div class="item"><div><b>' + LAWS[k].name + "</b><small>" + LAWS[k].rule + " Leaves: " + LAWS[k].trait + "</small></div>" + btn("genesis", k, icon("planet") + "Genesis", "gold") + "</div>";
    }
    return h;
  },
  cosmos() {
    let h = '<p class="hint">Stardust: <b>' + fmtL(S.meta.stardust) + "</b> · Depth " + S.meta.depth + " · " + S.meta.planets.length + " Planets (×" + fmt(Math.pow(3, S.meta.planets.length)) + " Glow) " + ii("genesis") + "</p>";
    for (const n of COSMOS_TREE) {
      const lv = E.cosmos(n.id), maxed = n.max != null && lv >= n.max, cost = pr.cosmosCostL(n.id);
      h += '<div class="item' + (lv ? " good" : "") + '"><div><b>' + n.name + " <small>" + lv + (n.max != null ? "/" + n.max : "") + "</small></b><small>" + n.text + "</small></div>" + (maxed ? "<small>Done</small>" : btn("cosmos", n.id, fmtL(cost) + " Stardust", "", !lGte(S.meta.stardust, cost))) + "</div>";
    }
    if (S.meta.laws.length) h += "<h3>Laws in this world</h3>" + S.meta.laws.map((k) => '<div class="item small"><div><b>' + LAWS[k].name + "</b><small>" + LAWS[k].rule + "</small></div></div>").join("");
    if (S.meta.planets.length) h += "<h3>Planets</h3>" + S.meta.planets.map((p) => '<div class="item small"><div><b>' + esc(p.name) + "</b><small>Depth " + p.depth + (p.law ? " · " + LAWS[p.law].trait : " · the first world") + "</small></div></div>").join("");
    return h;
  }
};
function wildText(wc) {
  const m = wc.baseMult;
  const fx = { glow: "×" + m + " all Glow", tempo: "+" + Math.round((m - 1) * 100) + "% every Tempo", lucky: "+" + ((m - 1) * 2).toFixed(1) + "% Lucky chance", bloom: "×" + m + " Bloom XP", seeds: "×" + m + " Seeds" };
  return fx[wc.fx] || "";
}

/* ---------- Goals tabs ---------- */
const GOAL_TABS = {
  board() {
    let h = '<p class="hint">The Notice Board: 3 at a time. Rank ' + S.meta.rank + ". " + ii("commissions") + "</p>";
    if (!S.commissions.list.length) h += '<p class="empty">A Commission is on its way.</p>';
    for (const g of S.commissions.list) {
      const need = g.need || (g.kind === "sellHue" ? g.n : g.kind === "combo" ? 60 : g.kind === "glow" || g.kind === "claim" ? 1 : g.n);
      const f = Math.min(1, (g.got || 0) / need);
      const left = Math.max(0, g.until - S.season.seasonT);
      h += '<div class="item' + (g.done ? " good" : "") + '"><div><b>' + esc(g.text) + "</b><small>" + (g.done ? "Done. Collect it." : fmtTime(left) + " left · " + (g.got || 0) + " / " + need) + '</small><div class="bar thin"><i style="width:' + (f * 100).toFixed(0) + '%"></i></div></div>' + (g.done ? btn("collect", S.commissions.list.indexOf(g), "Collect", "primary") : "") + "</div>";
    }
    return h;
  },
  moths() {
    let h = '<div class="item"><div><b>Moth Jars <small>' + S.season.jars + "</small></b><small>Uncaught Golden Moths, kept for later.</small></div>" + btn("jar", null, icon("jar") + "Open", "", !S.season.jars) + ii("moths") + "</div>";
    h += "<h3>The Merchant " + ii("merchant") + "</h3>";
    const M = S.merchant;
    if (!M.until) h += '<p class="empty">Next visit in ' + fmtTime(M.next - S.t) + ".</p>";
    else {
      h += '<p class="hint">Leaves in ' + fmtTime(M.until - S.t) + ".</p>";
      M.stock.forEach((it, i) => {
        const name = it.kind === "mod" ? rarityName(it.r) + " " + MODS[it.k].name + " Mod" : it.kind === "jar" ? "A Moth Jar" : it.kind === "charm" ? "A Weather Charm" : "A Relic";
        const sub = it.kind === "mod" ? MODS[it.k].text : it.kind === "charm" ? "Sets the next weather in one biome." : it.kind === "relic" ? "A random Relic, for Seeds." : "A Windfall, when you open it.";
        let extra = "";
        if (it.kind === "charm") {
          const bs = Object.keys(S.weather);
          extra = '<select data-chg="charmBiome" data-arg="' + i + '">' + bs.map((b) => '<option value="' + b + '"' + (it.biome === b ? " selected" : "") + ">" + BIOMES[b].name + "</option>").join("") + "</select>";
          const b = it.biome || bs[0];
          extra += '<select data-chg="charmWeather" data-arg="' + i + '">' + (b ? BIOMES[b].weather : []).map((w) => '<option value="' + w + '"' + (it.weather === w ? " selected" : "") + ">" + WEATHER[w].name + "</option>").join("") + "</select>";
        }
        const pool = it.cur === "seeds" ? S.eclipse.seeds : S.season.glow;
        h += '<div class="item' + (it.sold ? " locked" : "") + '"><div><b>' + name + "</b><small>" + sub + "</small>" + extra + "</div>" + (it.sold ? "<small>Sold</small>" : btn("buy", i, fmtL(it.price) + (it.cur === "seeds" ? " Seeds" : ""), "", !lGte(pool, it.price))) + "</div>";
      });
    }
    h += '<h3>Rush ' + ii("rush") + '</h3><div class="bar rush"><i style="width:' + Math.min(100, S.rush.meter).toFixed(0) + '%"></i></div>';
    return h;
  },
  feats() {
    let h = '<p class="hint">' + E.featCount() + " Feats: +" + E.featCount() + "% Glow for ever. " + ii("feats") + "</p>";
    for (const k in FEAT_TIERS) h += '<div class="item small"><div><b>' + FEAT_TIERS[k].text(goals.featNext(k)) + "</b><small>" + (S.meta.feats.tiers[k] || 0) + " tiers earned</small></div></div>";
    h += "<h3>Hidden</h3>";
    for (const k in HIDDEN_FEATS) h += '<div class="item small' + (S.meta.feats.hidden[k] ? " good" : "") + '"><div><b>' + (S.meta.feats.hidden[k] ? HIDDEN_FEATS[k].name : "???") + "</b><small>" + (S.meta.feats.hidden[k] ? HIDDEN_FEATS[k].text : "A Lore page may know.") + "</small></div></div>";
    return h;
  }
};

/* ---------- Automation tabs ---------- */
const AUTO_TABS = {
  crew() {
    const n = auto.tinkerCount();
    if (!n) return '<p class="empty">Build a Tinker Hut to house Tinkers.</p>' + '<p class="hint">' + ii("tinkers") + "</p>";
    auto.syncTinkers();
    let h = '<p class="hint">' + n + " Tinkers · speed ×" + fmt(auto.tinkerSpeed() / 2.2) + " " + ii("tinkers") + "</p>";
    for (let i = 0; i < n; i++) {
      const t = S.tinkers[i];
      const bot = RT.tinkerBots[i];
      h += '<div class="item"><div><b>Tinker ' + (i + 1) + "</b><small>" + (bot && bot.task ? "Busy: " + bot.task.kind : "Idle") + "</small></div>";
      h += '<select data-chg="job" data-arg="' + i + '">' + Object.keys(JOBS).map((j) => '<option value="' + j + '"' + (t.job === j ? " selected" : "") + ">" + JOBS[j].name + "</option>").join("") + "</select>";
      if (t.job === "upgrader") {
        h += '<select data-chg="rule" data-arg="' + i + '">' + Object.keys(UPGRADER_RULES).map((r) => '<option value="' + r + '"' + (t.rule === r ? " selected" : "") + ">" + UPGRADER_RULES[r] + "</option>").join("") + "</select>";
        if (t.rule === "pinned") {
          const types = [...new Set(S.season.copies.map((c) => E.lvlKey(c.type)))].filter((k) => TYPES[k].level);
          h += '<select data-chg="pin" data-arg="' + i + '"><option value="">Pin a type…</option>' + types.map((k) => '<option value="' + k + '">' + TYPES[k].name + "</option>").join("") + "</select><small>" + (t.pinned || []).map((k) => TYPES[k].name).join(", ") + "</small>" + btn("unpin", i, "Clear", "ghost");
        }
      }
      if (t.job === "courier") h += btn("link", i, icon("link") + (t.link ? "Re-link" : "Link two"), "") + (t.link ? "<small>Linked</small>" : "");
      h += "</div>";
    }
    return h;
  },
  dir() {
    const slots = pr.directiveSlots();
    if (!slots) return '<p class="empty">Directives open in Season 3.</p><p class="hint">' + ii("directives") + "</p>";
    let h = '<p class="hint">' + S.directives.length + " / " + slots + " slots. Checked once a second, top down. " + ii("directives") + "</p>";
    S.directives.forEach((d, i) => {
      const live = i < slots;
      h += '<div class="dir' + (live ? "" : " locked") + '"><div class="row"><label class="sw"><input type="checkbox" data-chg="dirOn" data-arg="' + i + '"' + (d.on ? " checked" : "") + "> #" + (i + 1) + "</label><small>fired " + (d.fired || 0) + '</small><span class="grow"></span>' + btn("dirUp", i, icon("up"), "ghost") + btn("dirDel", i, icon("trash"), "ghost") + "</div>";
      d.conds.forEach((c, j) => { h += '<div class="row">' + (j ? "<small>AND</small>" : "<small>IF</small>") + condEditor(c, i, j) + btn("condDel", i + ":" + j, icon("minus"), "ghost", d.conds.length <= 1) + "</div>"; });
      if (d.conds.length < 3) h += '<div class="row">' + btn("condAdd", i, icon("plus") + "AND", "ghost") + "</div>";
      h += '<div class="row"><small>THEN</small>' + actEditor(d.act, i) + "</div></div>";
    });
    if (S.directives.length < slots) h += '<div class="row">' + btn("dirAdd", null, icon("plus") + "Add a Directive", "primary") + "</div>";
    return h;
  },
  ghosts() {
    const n = S.season.ghosts.length;
    let h = '<p class="hint">' + n + " Ghosts waiting. Builders rebuild them in order. " + ii("ghosts") + "</p>";
    h += '<div class="row">' + btn("ghostsBuild", null, "Build what I can afford", "primary", !n) + btn("ghostsClear", null, icon("trash") + "Clear all", "danger", !n) + "</div>";
    if (S.logbook) h += '<div class="row">' + btn("logbook", null, icon("scroll") + "Open the last Logbook") + "</div>";
    return h;
  }
};
function opt(v, l, cur) { return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + esc(l) + "</option>"; }
function condEditor(c, i, j) {
  let h = '<select data-chg="condK" data-arg="' + i + ":" + j + '">' + Object.keys(CONDITIONS).map((k) => opt(k, CONDITIONS[k].text.replace(/ [XNTWLP]( |$)/, " … ").replace(/ X /, " … "), c.k)).join("") + "</select>";
  const C = CONDITIONS[c.k];
  if (C.param === "w") {
    h += '<select data-chg="condB" data-arg="' + i + ":" + j + '">' + Object.keys(S.weather).map((b) => opt(b, BIOMES[b].name, c.b)).join("") + "</select>";
    h += '<select data-chg="condW" data-arg="' + i + ":" + j + '">' + Object.keys(WEATHER).filter((w) => w !== "meteor").map((w) => opt(w, WEATHER[w].name, c.w)).join("") + "</select>";
  } else if (C.param) h += '<input type="number" step="any" data-chg="condP" data-arg="' + i + ":" + j + '" value="' + esc(c[C.param] != null ? c[C.param] : C.def) + '">';
  return h;
}
function actEditor(a, i) {
  let h = '<select data-chg="actK" data-arg="' + i + '">' + Object.keys(ACTIONS).filter((k) => auto.actionAllowed(k) || a.k === k).map((k) => opt(k, ACTIONS[k].text, a.k)).join("") + "</select>";
  if (a.k === "levels") {
    const types = BUILDABLE.filter((k) => TYPES[k].level && E.unlocked(k));
    h += '<select data-chg="actType" data-arg="' + i + '">' + types.map((k) => opt(k, TYPES[k].name, a.type)).join("") + "</select>";
    h += '<select data-chg="actAmt" data-arg="' + i + '">' + [[1, "×1"], [10, "×10"], ["ms", "to the next Milestone"]].map(([v, l]) => opt(v, l, a.amount)).join("") + "</select>";
  }
  if (a.k === "workshop") h += '<select data-chg="actWs" data-arg="' + i + '">' + Object.keys(WORKSHOP).map((k) => opt(k, WORKSHOP[k].name, a.ws)).join("") + "</select>";
  if (a.k === "blueprint") h += '<select data-chg="actBp" data-arg="' + i + '">' + S.meta.blueprints.map((b) => opt(b.id, b.name, a.bp)).join("") + "</select>" + btn("actBpAt", i, "Set where", "ghost");
  if (a.k === "group" || a.k === "filter") {
    h += '<input type="text" maxlength="16" placeholder="group" data-chg="actGroup" data-arg="' + i + '" value="' + esc(a.group || "") + '">';
    if (a.k === "group") h += '<select data-chg="actState" data-arg="' + i + '">' + opt("on", "on", a.state) + opt("off", "off", a.state) + "</select>";
    else h += filterSelect("actFilter", i, a.filter);
  }
  return h;
}
function filterSelect(chg, arg, f) {
  const cur = f ? f.kind + ":" + f.val : "";
  const opts = [["", "No filter"]].concat(HUE_LIST.map((h) => ["hue:" + h, HUES[h].name + " motes"]), [2, 3, 4, 6, 8, 10].map((t) => ["tier:" + t, "Tier " + t + "+"]), [["trait:lucky", "Lucky motes"], ["trait:charged", "Charged motes"]]);
  return '<select data-chg="' + chg + '" data-arg="' + arg + '">' + opts.map(([v, l]) => opt(v, l, cur)).join("") + "</select>";
}
const parseFilter = (v) => { if (!v) return null; const [kind, val] = v.split(":"); return { kind, val: kind === "trait" ? val : +val }; };

/* ---------- Codex tabs ---------- */
const CODEX_TABS = {
  types() {
    let h = '<p class="hint">' + ii("codex") + "</p>";
    for (const f of FAMILIES) {
      if (f.id === "wonder") continue;
      const list = BUILDABLE.filter((k) => TYPES[k].fam === f.id);
      h += "<h3>" + f.name + "</h3>";
      for (const k of list) {
        const open = E.unlocked(k);
        h += '<div class="item small' + (open ? "" : " locked") + '">' + (open ? '<img alt="" src="' + spriteURL(k, 0) + '">' : icon("lock")) + "<div><b>" + (open ? TYPES[k].name : "???") + "</b><small>" + (open ? TYPES[k].rule : unlockText(k)) + "</small></div></div>";
      }
    }
    return h;
  },
  wonders() {
    let h = '<p class="hint">Found in Ruins and by secrets. All 8: +1 Mod slot on every copy.</p>';
    for (const k of WONDERS) {
      const open = S.meta.discovered.wonders[k];
      h += '<div class="item small' + (open ? "" : " locked") + '">' + (open ? '<img alt="" src="' + spriteURL(k, 0) + '">' : icon("lock")) + "<div><b>" + (open ? TYPES[k].name : "???") + " <small>" + TYPES[k].size + "×" + TYPES[k].size + "</small></b><small>" + (open ? TYPES[k].rule : "Not found yet.") + "</small></div></div>";
    }
    return h;
  },
  critters() {
    let h = '<p class="hint">' + ii("critters") + "</p>";
    for (const b in BIOMES) {
      const list = Object.keys(CRITTERS).filter((k) => CRITTERS[k].biome === b);
      h += "<h3>" + BIOMES[b].name + (E.codexBiomeDone(b) ? ' <small class="good">+10% Bloom XP</small>' : "") + "</h3>";
      for (const k of list) {
        const C = CRITTERS[k], seen = S.meta.discovered.critters[k];
        h += '<div class="item small' + (seen ? "" : " locked") + '"><i class="dot" style="background:' + (seen ? C.col : "#333") + '"></i><div><b>' + (seen ? C.name : "???") + (C.rare ? " <small>rare</small>" : "") + "</b><small>" + (seen ? CRITTER_KINDS[C.kind] : C.rare ? "Comes out in one kind of weather." : "Not seen yet.") + "</small></div></div>";
      }
    }
    h += '<div class="item small"><i class="dot" style="background:#ffcf3a"></i><div><b>Golden Moth</b><small>Any biome. Tap it for a Windfall.</small></div></div>';
    return h;
  },
  world() {
    let h = "<h3>Biomes " + ii("plots") + "</h3>";
    for (const b in BIOMES) {
      const seen = S.meta.discovered.biomes[b], B0 = BIOMES[b];
      h += '<div class="item small' + (seen ? "" : " locked") + '"><i class="dot" style="background:' + (seen ? B0.ground : "#333") + '"></i><div><b>' + (seen ? B0.name : "???") + " <small>Ring " + B0.rings[0] + (B0.rings[1] === Infinity ? "+" : "–" + B0.rings[1]) + "</small></b><small>" + (seen ? B0.bonus + " · weather: " + B0.weather.map((w) => WEATHER[w].name).join(", ") : "Farther out.") + "</small></div></div>";
    }
    h += "<h3>Weather " + ii("weather") + "</h3>";
    for (const w in WEATHER) {
      const seen = S.meta.discovered.weather[w];
      h += '<div class="item small' + (seen ? "" : " locked") + '"><div><b>' + (seen ? WEATHER[w].name : "???") + "</b><small>" + (seen ? WEATHER[w].effect : "Not seen yet.") + "</small></div></div>";
    }
    h += "<h3>Tiles " + ii("tiles") + "</h3>";
    for (const k in TILES) h += '<div class="item small"><div><b>' + TILES[k].name + "</b><small>" + TILES[k].effect + "</small></div></div>";
    return h;
  },
  lore() {
    let h = "";
    for (const l of LORE) {
      const have = S.meta.discovered.lore[l.id];
      h += '<div class="item lore' + (have ? "" : " locked") + '"><div><b>' + (have ? l.title : "A missing page") + "</b><small>" + (have ? esc(l.text) + (l.melody ? ' <span class="notes">' + l.melody.map((n) => NOTE_NAMES[n]).join(" ") + "</span>" : "") : "Ruins hold the rest of the book.") + "</small></div></div>";
    }
    return h;
  },
  mods() {
    let h = '<p class="hint">' + S.meta.mods.length + " Mods. Three of a kind and Rarity merge into the next. " + ii("mods") + "</p>";
    const groups = new Map();
    for (const m of S.meta.mods) { const k = m.k + ":" + m.r; if (!groups.has(k)) groups.set(k, { k: m.k, r: m.r, free: 0, on: 0 }); const g = groups.get(k); m.on ? g.on++ : g.free++; }
    const list = [...groups.values()].sort((a, b) => b.r - a.r || a.k.localeCompare(b.k));
    if (!list.length) h += '<p class="empty">No Mods yet. Ruins, Commissions and Golden Moths drop them.</p>';
    for (const g of list) {
      const M = MODS[g.k];
      h += '<div class="item small"><i class="dot" style="background:' + RARITY_COLS[Math.min(6, g.r)] + '"></i><div><b>' + rarityName(g.r) + " " + M.name + " <small>×" + (g.free + g.on) + (g.on ? " (" + g.on + " in use)" : "") + "</small></b><small>" + M.text + " · fits " + M.fits + "</small></div>" + btn("merge", g.k + ":" + g.r, "Merge", "", g.free < 3) + "</div>";
    }
    return h;
  },
  relics() {
    let h = '<p class="hint">' + ii("relics") + "</p>";
    for (const k of RELIC_KEYS) {
      const lv = E.relic(k);
      h += '<div class="item small' + (lv ? " good" : " locked") + '"><div><b>' + (lv ? RELICS[k].name : "???") + (lv ? " <small>Level " + lv + "</small>" : "") + "</b><small>" + (lv ? RELICS[k].text : "Not found yet.") + "</small></div></div>";
    }
    return h;
  }
};

/* ---------- actions ---------- */
const ACT = {
  panel: (id) => openPanel(id),
  tab: (arg) => { const [p, t] = arg.split(":"); tabs[p] = t; },
  pick: (type) => startPlace(type),
  amt: (v) => { buyAmt = v === "ms" || v === "max" ? v : +v; },
  lv: (k) => { const n = buyAmt === "max" ? "max" : buyAmt === "ms" ? "ms" : buyAmt; auto.buyLevels(k, n); },
  ws: (k) => { const cost = E.workshopCostL(k); if (lGte(S.season.glow, cost)) { S.season.glow = lSub(S.season.glow, cost); S.season.workshop[k] = E.ws(k) + 1; RT.lastGlobalAt = -1; RT.layoutDirty = true; } },
  spec: (arg) => { const [k, i] = arg.split(":"); pr.pickSpec(k, +i); },
  harvest: () => { if (E.harvestReady() && confirmHarvest()) { const t = RT.nextTrial || null; RT.nextTrial = null; pr.harvest({ trial: t }); card = null; RT.selected = null; forgetPlots(); } },
  eclipse: () => { if (window.confirm("Eclipse now? It resets Seeds, the Seed Tree and Overgrowth, and pays " + fmtL(E.eclipseGainL()) + " Stars.")) pr.beginEclipse(); },
  seed: (id) => pr.buySeed(id),
  star: (pt) => { if (S.world.sky[pt]) pr.liftStar(pt); else pr.placeStar(pt); },
  wildAdd: (i) => { const w = E.wildList()[+i]; const p = w && w.pts.find((q) => !S.world.sky[q]); if (p) pr.placeStar(p); },
  wildLift: (i) => { const w = E.wildList()[+i]; const p = w && w.pts.slice().reverse().find((q) => S.world.sky[q]); if (p) pr.liftStar(p); },
  pickTrial: (k) => { RT.nextTrial = RT.nextTrial === k ? null : k; },
  genesis: (law) => { if (window.confirm("Genesis under " + LAWS[law].name + "? This world becomes a Planet and a new one begins.")) { pr.genesis(law); forgetPlots(); card = null; RT.selected = null; cam.x = 5; cam.y = 5; } },
  cosmos: (id) => pr.buyCosmos(id),
  collect: (i) => { const g = S.commissions.list[+i]; if (g) goals.collect(g); },
  jar: () => goals.openJar(),
  buy: (i) => { const it = S.merchant.stock[+i]; if (!it) return; if (it.kind === "charm") { const b = it.biome || Object.keys(S.weather)[0]; goals.buy(it, b, it.weather || BIOMES[b].weather[1] || "clear"); } else goals.buy(it); },
  merge: (arg) => { const [k, r] = arg.split(":"); const m = goals.merge(k, +r); if (m) toast("Merged into " + rarityName(m.r) + " " + MODS[m.k].name, "loot", "gem"); },
  link: (i) => { mode.kind = "link"; mode.a = null; mode.tinker = +i; closePanel(); showPlaceBar("Tap the contraption to carry from"); },
  unpin: (i) => { S.tinkers[+i].pinned = []; },
  dirAdd: () => S.directives.push(auto.newDirective()),
  dirDel: (i) => S.directives.splice(+i, 1),
  dirUp: (i) => { i = +i; if (i > 0) { const d = S.directives.splice(i, 1)[0]; S.directives.splice(i - 1, 0, d); } },
  condAdd: (i) => { const d = S.directives[+i]; if (d.conds.length < 3) d.conds.push({ k: "seasonT", t: 10 }); },
  condDel: (arg) => { const [i, j] = arg.split(":").map(Number); S.directives[i].conds.splice(j, 1); },
  actBpAt: (i) => { mode.kind = "stamp"; mode.dirIndex = +i; mode.bp = S.meta.blueprints.find((b) => b.id === S.directives[+i].act.bp); mode.rot = 0; closePanel(); showPlaceBar("Tap where the Directive should stamp it"); },
  ghostsBuild: () => { let n = 0; for (const g of S.season.ghosts.slice().sort((a, b) => a.order - b.order)) { if (!lGte(S.season.glow, E.buildCostL(g.type))) break; if (auto.buildGhost(g)) n++; } toast(n + " Ghosts built.", "good", "hammer"); },
  ghostsClear: () => { if (window.confirm("Clear every Ghost?")) S.season.ghosts = []; },
  logbook: () => showLogbook(S.logbook, false),
  bpArea: () => { mode.kind = "bpArea"; mode.a = mode.b = null; closePanel(); showPlaceBar("Drag over the area to save"); },
  bpStamp: (id) => { mode.kind = "stamp"; mode.bp = S.meta.blueprints.find((b) => b.id === id); mode.rot = 0; mode.dirIndex = null; closePanel(); showPlaceBar("Tap where to stamp " + (mode.bp ? mode.bp.name : "")); },
  bpCode: (id) => { const bp = S.meta.blueprints.find((b) => b.id === id); if (!bp) return; const code = auto.blueprintCode(bp); copyText(code); toast("Blueprint code copied.", "good", "copy"); },
  bpDel: (id) => { S.meta.blueprints = S.meta.blueprints.filter((b) => b.id !== id); },
  bpImport: () => { const el = $("bpImport"); const bp = el && auto.blueprintFromCode(el.value); toast(bp ? "Imported " + bp.name : "That is not a Blueprint code.", bp ? "good" : "bad", "blueprint"); },
  zen: () => setZen(true),
  updCheck: () => { const st = $("updState"); if (st) st.textContent = "Checking…"; upd.checkNow().then((r) => { const s2 = $("updState"); if (s2) s2.textContent = r === "ready" ? "A new version is ready." : r === "current" ? "You are up to date." : r === "downloading" ? "Downloading a new version…" : r === "offline" ? "Offline: could not check." : "Updates need the installed app."; }); },
  updApply: () => upd.apply(),
  saveNow: () => toast(save.save() ? "Saved." : "Could not save in this browser.", "good", "download"),
  export: () => { const t = $("saveCode"); if (t) { t.value = save.exportCode(); t.select(); copyText(t.value); toast("Save code copied.", "good", "copy"); } },
  import: () => { const t = $("saveCode"); if (t && window.confirm("Replace this world with the one in the code?")) { if (save.importCode(t.value)) { forgetPlots(); toast("Imported.", "good", "upload"); closePanel(); } else toast("That is not a save code.", "bad", "upload"); } },
  wipe: () => { if (window.confirm("Start a new world? Everything here is lost.") && window.confirm("Really? This cannot be undone.")) { save.wipe(); location.reload(); } },
  // the card
  cLv: (id) => { const c = RT.byId.get(+id); if (c) auto.buyLevels(c.type, buyAmt === "max" ? "max" : buyAmt === "ms" ? "ms" : buyAmt); },
  cRot: (id) => { const c = RT.byId.get(+id); if (c) B.rotate(c); },
  cMove: (id) => { const c = RT.byId.get(+id); if (c) { mode.kind = "move"; mode.copy = c; showPlaceBar("Tap where to move " + TYPES[c.type].name); } },
  cDel: (id) => { const c = RT.byId.get(+id); if (c) { B.remove(c); card = null; RT.selected = null; } },
  cOff: (id) => { const c = RT.byId.get(+id); if (c) c.off = !c.off; },
  cTap: (id) => { const c = RT.byId.get(+id); if (c) sim.tap(c); },
  cModUn: (arg) => { const [id, mid] = arg.split(":").map(Number); const c = RT.byId.get(id); if (c) goals.unequip(mid, c); },
  gBuild: (id) => { const g = S.season.ghosts.find((x) => x.id === +id); if (g && auto.buildGhost(g)) card = null; else toast(g ? B.whyNot(g.type, g.x, g.y) || "Not enough Glow." : "", "bad", "hammer"); },
  gDel: (id) => { S.season.ghosts = S.season.ghosts.filter((x) => x.id !== +id); card = null; },
  gRot: (id) => { const g = S.season.ghosts.find((x) => x.id === +id); if (g) g.rot = (g.rot + 1) & 3; },
  claim: (arg) => { const [a, b] = arg.split(",").map(Number); if (B.claim(a, b)) { goals.commissionProgress("claim", getPlot(a, b).biome); card = null; E.refreshUnlocks(); } },
  rock: (arg) => { const [x, y] = arg.split(",").map(Number); const [px, py] = plotOfTile(x, y); if (B.clearRock(x, y)) { if (Math.random() < 0.05) goals.dropMod(Math.floor(ringOf(px, py) / 3), 0); card = null; forgetPlots(); } },
  dig: (arg) => { const [a, b] = arg.split(",").map(Number); if (B.startDig(a, b)) card = null; },
  closeCard: () => { card = null; RT.selected = null; }
};
function confirmHarvest() {
  if (S.meta.stats.harvests > 2) return true;
  return window.confirm("Harvest now? Glow, Levels, copies and plots reset; your copies stay as Ghosts and you keep the Seeds.");
}
function copyText(t) { try { navigator.clipboard.writeText(t); } catch (e) { /* the textarea still holds it */ } }

const CHG = {
  plan: (v) => { mode.plan = !!v; const p = $("placePlan"); if (p) p.checked = !!v; },
  notation: (v) => { S.meta.settings.notation = v; setNotation(v); },
  sound: (v) => { S.meta.settings.sound = v; audio.setSound(v); },
  music: (v) => { S.meta.settings.music = v; audio.unlock(); audio.setMusic(v); },
  pops: (v) => { S.meta.settings.pops = v; },
  quality: (v) => { S.meta.settings.quality = v ? "high" : "low"; setQuality(S.meta.settings.quality); },
  nextTrial: (v) => { RT.nextTrial = v || null; },
  job: (v, i) => { S.tinkers[+i].job = v; if (RT.tinkerBots[+i]) RT.tinkerBots[+i].task = null; },
  rule: (v, i) => { S.tinkers[+i].rule = v; },
  pin: (v, i) => { if (v) { const t = S.tinkers[+i]; t.pinned = (t.pinned || []).filter((x) => x !== v).concat([v]); } },
  charmBiome: (v, i) => { const it = S.merchant.stock[+i]; if (it) { it.biome = v; it.weather = BIOMES[v].weather[1] || "clear"; } },
  charmWeather: (v, i) => { const it = S.merchant.stock[+i]; if (it) it.weather = v; },
  dirOn: (v, i) => { S.directives[+i].on = !!v; },
  condK: (v, arg) => { const [i, j] = arg.split(":").map(Number); const C = CONDITIONS[v]; const c = { k: v }; if (C.param && C.param !== "w") c[C.param] = C.def; if (C.param === "w") { c.b = Object.keys(S.weather)[0] || "meadow"; c.w = C.def; } S.directives[i].conds[j] = c; },
  condP: (v, arg) => { const [i, j] = arg.split(":").map(Number); const c = S.directives[i].conds[j]; c[CONDITIONS[c.k].param] = +v; },
  condB: (v, arg) => { const [i, j] = arg.split(":").map(Number); S.directives[i].conds[j].b = v; },
  condW: (v, arg) => { const [i, j] = arg.split(":").map(Number); S.directives[i].conds[j].w = v; },
  actK: (v, i) => { const a = { k: v }; if (v === "levels") { a.type = "wellspring"; a.amount = 1; } if (v === "workshop") a.ws = "polish"; if (v === "blueprint") a.bp = S.meta.blueprints[0] ? S.meta.blueprints[0].id : null; if (v === "group") { a.group = ""; a.state = "off"; } S.directives[+i].act = a; },
  actType: (v, i) => { S.directives[+i].act.type = v; },
  actAmt: (v, i) => { S.directives[+i].act.amount = v === "ms" ? "ms" : +v; },
  actWs: (v, i) => { S.directives[+i].act.ws = v; },
  actBp: (v, i) => { S.directives[+i].act.bp = v; },
  actGroup: (v, i) => { S.directives[+i].act.group = String(v).slice(0, 16); },
  actState: (v, i) => { S.directives[+i].act.state = v; },
  actFilter: (v, i) => { S.directives[+i].act.filter = parseFilter(v); },
  cGroup: (v, id) => { const c = RT.byId.get(+id); if (c) c.group = String(v).slice(0, 16) || null; },
  cFilter: (v, id) => { const c = RT.byId.get(+id); if (c) c.filter = parseFilter(v); },
  cModEq: (v, id) => { const c = RT.byId.get(+id); if (c && v) goals.equip(+v, c); }
};

/* ---------- placing ---------- */
export function startPlace(type) {
  mode.kind = "place"; mode.type = type;
  if (type !== "track") mode.rot = mode.rot || 0;
  closePanel();
  const T0 = TYPES[type];
  showPlaceBar(T0.name + " · " + (type === "track" ? "drag to lay a path" : "tap to place"));
}
export function showPlaceBar(text) {
  $("placeBar").hidden = false;
  $("placeTxt").textContent = text;
  $("placeRot").hidden = !(mode.kind === "place" || mode.kind === "stamp");
  $("placePlanWrap").hidden = mode.kind !== "place";
  $("placePlan").checked = mode.plan;
  document.body.classList.add("placing");
}
export function endMode() {
  mode.kind = null; mode.type = null; mode.copy = null; mode.bp = null; mode.a = mode.b = null;
  $("placeBar").hidden = true;
  document.body.classList.remove("placing");
}
/** Place (or plan) a copy where the input says. */
export function placeAt(type, x, y, rot, fromTap) {
  if (mode.plan && fromTap !== undefined) {
    if (B.whyNot(type, x, y).match(/Something is already here|Not discovered/)) { toast(B.whyNot(type, x, y), "bad", "hammer"); return false; }
    const order = S.season.ghosts.reduce((m, g) => Math.max(m, g.order), 0) + 1;
    S.season.ghosts.push({ id: S.nextId++, type, x, y, rot, mods: [], order });
    return true;
  }
  if (mode.plan && type === "track") {
    const order = S.season.ghosts.reduce((m, g) => Math.max(m, g.order), 0) + 1;
    if (!B.copyAt(x, y)) S.season.ghosts.push({ id: S.nextId++, type, x, y, rot, mods: [], order });
    return true;
  }
  const why = B.whyNot(type, x, y);
  if (why) { if (fromTap) toast(why, "bad", "hammer"); return false; }
  const cost = E.buildCostL(type);
  if (!lGte(S.season.glow, cost)) { if (fromTap) toast("Needs " + fmtL(cost) + " Glow.", "bad", "glow"); return false; }
  const c = B.place(type, x, y, rot);
  if (c && TYPES[type].fam === "heart") endMode();
  if (c && TYPES[type].fam === "wonder") endMode();
  return !!c;
}

/* ---------- the card ---------- */
export function select(c) { card = c ? { kind: "copy", id: c.id } : null; RT.selected = c || null; renderCard(); }
export function selectTile(x, y) {
  const [px, py] = plotOfTile(x, y), key = pk(px, py);
  const gh = S.season.ghosts.find((g) => x >= g.x && y >= g.y && x < g.x + B.sizeOf(g.type) && y < g.y + B.sizeOf(g.type));
  RT.selected = null;
  if (gh) { card = { kind: "ghost", id: gh.id }; return renderCard(); }
  if (!owned(px, py)) { card = claimable(px, py) ? { kind: "plot", px, py } : { kind: "far", px, py }; return renderCard(); }
  const t = tileAt(x, y);
  if (t === T.rock) { card = { kind: "rock", x, y }; return renderCard(); }
  const p = getPlot(px, py);
  if ((t === T.ruins || S.hiddenRuins[key]) && !S.ruins[key]) { card = { kind: "ruins", px, py }; return renderCard(); }
  card = { kind: "tile", x, y };
  renderCard();
  void p;
}
export function renderCard(force) {
  const el = $("card");
  if (!card) { el.hidden = true; return; }
  const a = document.activeElement;
  if (a && el.contains(a) && (a.tagName === "SELECT" || a.tagName === "INPUT")) return;
  if (!force && performance.now() - lastInput < 600) return;
  let h = "";
  if (card.kind === "copy") {
    const c = RT.byId.get(card.id);
    if (!c) { card = null; el.hidden = true; return; }
    h = copyCard(c);
  } else if (card.kind === "ghost") {
    const g = S.season.ghosts.find((x) => x.id === card.id);
    if (!g) { card = null; el.hidden = true; return; }
    const why = B.whyNot(g.type, g.x, g.y), cost = E.buildCostL(g.type);
    h = '<div class="cardHead"><img alt="" src="' + spriteURL(g.type, 0) + '"><div><b>Ghost: ' + TYPES[g.type].name + "</b><small>" + (why || "Build " + costTxt(cost)) + "</small></div>" + btn("closeCard", null, icon("close"), "ghost") + "</div>" +
      '<div class="row">' + btn("gBuild", g.id, icon("hammer") + "Build", "primary", !!why || !lGte(S.season.glow, cost)) + btn("gRot", g.id, icon("rotate")) + btn("gDel", g.id, icon("trash"), "danger") + ii("ghosts") + "</div>";
  } else if (card.kind === "plot" || card.kind === "far") {
    const p = getPlot(card.px, card.py), cost = E.claimCostL(card.px, card.py);
    h = '<div class="cardHead"><i class="dot big" style="background:' + BIOMES[p.biome].ground + '"></i><div><b>' + BIOMES[p.biome].name + " · Ring " + p.ring + "</b><small>" + p.nodes.length + " Nodes · Richness ×" + fmt(Math.pow(1.6, p.ring)) + (p.ruins ? " · Ruins" : "") + (p.rules.length ? " · " + p.rules.map((r) => r).join(", ") : "") + "</small></div>" + btn("closeCard", null, icon("close"), "ghost") + "</div>";
    if (card.kind === "plot") h += '<div class="row">' + btn("claim", card.px + "," + card.py, icon("map") + "Claim " + fmtL(cost), "primary", !lGte(S.season.glow, cost)) + ii("plots") + "</div>";
    else h += '<p class="hint">Claim a plot beside it first.</p>';
  } else if (card.kind === "rock") {
    const [px, py] = plotOfTile(card.x, card.y), cost = E.rockCostL(px, py);
    h = '<div class="cardHead"><div><b>Rock</b><small>Clear it to build here. 5% chance of a Mod.</small></div>' + btn("closeCard", null, icon("close"), "ghost") + "</div>" + '<div class="row">' + btn("rock", card.x + "," + card.y, icon("pick") + "Clear " + fmtL(cost), "primary", !lGte(S.season.glow, cost)) + "</div>";
  } else if (card.kind === "ruins") {
    const cost = E.digCostL(card.px, card.py);
    h = '<div class="cardHead"><div><b>Ruins</b><small>Excavate for a Wonder, a Relic, Mods or a Lore page.</small></div>' + btn("closeCard", null, icon("close"), "ghost") + "</div>" + '<div class="row">' + btn("dig", card.px + "," + card.py, icon("pick") + "Excavate " + fmtL(cost), "primary", !lGte(S.season.glow, cost)) + ii("ruins") + "</div>";
  } else if (card.kind === "tile") {
    const t = tileAt(card.x, card.y), name = TILE_NAMES[t];
    const tk0 = Object.keys(TILES).find((k) => k === name) || "soil";
    const [px, py] = plotOfTile(card.x, card.y), key = pk(px, py), ps = S.season.plots[key], p = getPlot(px, py);
    const w = E.weatherOf(p.biome), fc = ev.forecast(p.biome);
    h = '<div class="cardHead"><i class="dot big" style="background:' + BIOMES[p.biome].ground + '"></i><div><b>' + TILES[tk0].name + " · " + BIOMES[p.biome].name + "</b><small>Bloom " + ps.bloom + " " + bloomName(ps.bloom) + " · " + WEATHER[w].name + (fc ? " → " + WEATHER[fc].name : "") + (p.rules.length ? " · " + p.rules.join(", ") : "") + "</small></div>" + btn("closeCard", null, icon("close"), "ghost") + "</div>";
    const nextXp = ps.bloom + 2, have = ps.xp === ZERO ? 0 : ps.xp;
    h += '<div class="bar thin"><i style="width:' + Math.max(0, Math.min(100, (have - (ps.bloom + 1)) * 100)).toFixed(0) + '%"></i></div><p class="hint">' + TILES[tk0].effect + " " + ii("bloom") + "</p>";
    void nextXp;
  }
  el.hidden = false;
  if (h === lastCard) return;
  lastCard = h;
  el.innerHTML = h;
  hydrateIcons(el);
}
let lastCard = "";
function copyCard(c) {
  const T0 = TYPES[c.type], k = E.lvlKey(c.type), lv = E.level(c.type);
  const tp = E.tempo(c);
  let stats = [];
  if (tp) stats.push(fmt(tp) + " actions/s");
  if (T0.fam === "source" && c.type !== "stormrod") { let v = E.sourceValueL(c); if (c.type === "extractor" && c.k.node) v += Math.log10(c.k.node.rich); stats.push("Value " + fmtL(v)); }
  if (T0.fam === "processor") stats.push(c.type === "mirror" ? Math.round(E.mirrorChance(c) * 100) + "% copy" : c.type === "prism" ? Math.round(E.prismShare(c) * 100) + "% each" : "×" + fmt(E.procPower(c)));
  if (T0.fam === "hearth") stats.push("Sale ×" + fmt(Math.pow(10, E.hearthSaleL(c))) + " · Combo " + fmt(Math.round(c.combo)) + " (×" + E.comboMul(c.combo).toFixed(2) + ")");
  if (c.type === "fuser") stats.push("Bonus ×" + E.fusionBonus(c).toFixed(2) + " · Tier ≤ " + E.maxFuseTier());
  if (c.type === "launcher" || c.type === "cometlauncher") stats.push("Range " + E.launcherRange(c));
  if (c.type === "chime" || c.type === "echobell") stats.push("Charge " + Math.floor(c.charge) + "/" + E.chimeNeed(c));
  if (c.type === "lantern") stats.push("+" + Math.round(E.lanternPower() * 100) + "% Tempo, Radius " + E.lanternRadius());
  if (T0.fam === "processor" || T0.fam === "source") stats.push(fmt(E.luckyChance(c) * 100) + "% Lucky");
  if (c.type === "extractor" && c.k.node) stats.push(HUES[c.k.node.hue].name + " T" + c.k.node.tier);
  if (c.type === "warppipe") stats.push(c.link ? "Entrance" : c.linkFrom ? "Exit" : "Waiting for its pair");
  const pm = E.powerMul(c);
  if (pm !== 1 && T0.fam !== "booster") stats.push("Power ×" + fmt(pm));
  if (c.type === "extractor" && !c.k.node) stats.push("No Node under it");
  const n = amountFor(k), cost = T0.level || k === "track" ? E.levelCostL(k, n) : ZERO;
  let h = '<div class="cardHead"><img alt="" src="' + spriteURL(c.type, T0.fam === "wonder" ? 0 : Math.min(7, Math.floor(lv / 25))) + '"><div><b>' + T0.name + (TYPES[k].level ? " <small>Lv " + lv + " · " + materialOf(lv).name + "</small>" : "") + "</b><small>" + stats.join(" · ") + "</small></div>" + btn("closeCard", null, icon("close"), "ghost") + "</div>";
  h += '<div class="row">';
  if (TYPES[k].level) h += btn("cLv", c.id, icon("up") + "+" + n + " · " + fmtL(cost), lGte(S.season.glow, cost) ? "primary" : "", !lGte(S.season.glow, cost));
  if (T0.fam !== "wonder" && c.type !== "track") h += btn("cTap", c.id, icon("hand"), "", c.type !== "wellspring" && c.tapReady > S.t);
  h += btn("cRot", c.id, icon("rotate")) + btn("cMove", c.id, icon("move")) + btn("cOff", c.id, icon(c.off ? "play" : "pause")) + btn("cDel", c.id, icon("trash"), "danger");
  h += "</div>";
  // Mods
  if (T0.fam !== "wonder" && T0.fam !== "heart" && c.type !== "track") {
    const slots = E.modSlots(c.type);
    h += '<div class="row mods"><small>Mods ' + c.mods.length + "/" + slots + "</small>";
    for (const id of c.mods) { const m = E.modById(id); if (m) h += '<button class="chip" data-act="cModUn" data-arg="' + c.id + ":" + id + '" style="border-color:' + RARITY_COLS[Math.min(6, m.r)] + '">' + rarityName(m.r) + " " + MODS[m.k].name + " " + icon("close") + "</button>"; }
    if (c.mods.length < slots) {
      const free = S.meta.mods.filter((m) => !m.on && goals.modFits(m, c));
      if (free.length) h += '<select data-chg="cModEq" data-arg="' + c.id + '"><option value="">Add a Mod…</option>' + free.sort((a, b) => b.r - a.r).slice(0, 40).map((m) => '<option value="' + m.id + '">' + rarityName(m.r) + " " + MODS[m.k].name + "</option>").join("") + "</select>";
    }
    h += ii("mods") + "</div>";
  }
  if (c.type === "splitter" && S.seasonNo >= 2) h += '<div class="row"><small>Filter</small>' + filterSelect("cFilter", c.id, c.filter) + "</div>";
  if (T0.fam !== "wonder") h += '<div class="row"><small>Group</small><input type="text" maxlength="16" placeholder="for Directives" data-chg="cGroup" data-arg="' + c.id + '" value="' + esc(c.group || "") + '"></div>';
  if (SPECS[c.type] && lv >= 100) h += '<p class="hint">' + (S.meta.specs && S.meta.specs[c.type] != null ? "Specialized: " + SPECS[c.type][S.meta.specs[c.type]].name : "Choose a Specialization in Levels.") + "</p>";
  return h;
}

/* ---------- the top bar ---------- */
let hudAt = 0;
export function hud(now) {
  if (now - hudAt < 220) return;
  hudAt = now;
  $("glowAmt").textContent = fmtL(S.season.glow);
  $("glowRate").textContent = "+" + fmtL(RT.rate.perSec) + "/s";
  const seedsOn = S.meta.stats.harvests > 0 || S.eclipse.seeds !== ZERO;
  $("seedChip").hidden = !seedsOn;
  if (seedsOn) $("seedAmt").textContent = fmtL(S.eclipse.seeds);
  const starsOn = S.world.eclipses > 0 || S.world.starsEarned !== ZERO;
  $("starChip").hidden = !starsOn;
  if (starsOn) $("starAmt").textContent = (E.starsTotal() - E.starsPlaced()) + "/" + E.starsTotal();
  $("dustChip").hidden = !(S.meta.depth > 0);
  if (S.meta.depth > 0) $("dustAmt").textContent = fmtL(S.meta.stardust);
  const kind = E.seasonKind();
  const day = E.isDay();
  $("seasonTxt").textContent = kind.name + " " + S.seasonNo + " · " + fmtTime(S.season.seasonT) + (S.season.trial ? " · " + TRIALS[S.season.trial].name : "");
  $("dayIcon").innerHTML = icon(day ? "sun" : "moon");
  // the weather where the camera is
  const P = plotSize(), p = getPlot(Math.floor(cam.x / P), Math.floor(cam.y / P));
  const w = E.weatherOf(p.biome), fc = ev.forecast(p.biome);
  $("weatherTxt").textContent = WEATHER[w].name + (fc && fc !== w ? " → " + WEATHER[fc].name : "");
  // Rush
  const rush = E.rushOn();
  $("rushFill").style.width = (rush ? 100 * (S.rush.until - S.t) / E.rushLength() : Math.min(100, S.rush.meter)) + "%";
  $("rush").classList.toggle("on", rush);
  audio.setRush(rush);
  // Harvest chip
  const ready = E.harvestReady(), gain = ready ? E.harvestGainL() : ZERO;
  const hc = $("harvestChip");
  hc.hidden = !ready;
  if (ready) { hc.classList.toggle("gold", S.eclipse.seeds === ZERO || gain >= S.eclipse.seeds); $("harvestTxt").textContent = "+" + fmtL(gain); }
  // a badge on Goals when something is waiting
  const waiting = S.commissions.list.some((g) => g.done) || S.season.jars > 0 || (S.merchant.until > S.t);
  const gb = document.querySelector('#dock [data-arg="goals"]');
  if (gb) gb.classList.toggle("badge", waiting);
  const sb = document.querySelector('#dock [data-arg="season"]');
  if (sb) sb.classList.toggle("badge", ready || E.eclipseReady() || pr.genesisReady());
  if (panel && now - panelAt > 1000) { panelAt = now; renderPanel(); }
  if (card) renderCard();
}

/* ---------- what the renderer previews on the ground ---------- */
function preview() {
  const out = [], hov = RT.hover;
  if (mode.kind === "place" && hov) {
    const n = B.sizeOf(mode.type), x = hov[0] - Math.floor((n - 1) / 2), y = hov[1] - Math.floor((n - 1) / 2);
    const why = B.whyNot(mode.type, x, y);
    out.push({ x, y, w: n, h: n, col: why ? "#ff5a5a" : "#7affa0" });
    const rot = mode.type === "track" ? smartRot(hov[0], hov[1]) : mode.rot;
    const [ox, oy] = B.outTile({ type: mode.type, x, y, rot });
    if (!["lantern", "chime", "sprinkler", "tinkerhut"].includes(mode.type)) out.push({ x: ox + 0.3, y: oy + 0.3, w: 0.4, h: 0.4, col: "#ffe08a", thin: true });
    const rad = mode.type === "lantern" ? E.lanternRadius() : mode.type === "chime" ? E.chimeRadius() : mode.type === "sprinkler" ? E.sprinklerRadius() : 0;
    if (rad) out.push({ x: x - rad, y: y - rad, w: 2 * rad + 1, h: 2 * rad + 1, col: "#ffd98a", thin: true });
  }
  if (mode.kind === "bpArea" && mode.a && mode.b) {
    const xa = Math.min(mode.a[0], mode.b[0]), xb = Math.max(mode.a[0], mode.b[0]), ya = Math.min(mode.a[1], mode.b[1]), yb = Math.max(mode.a[1], mode.b[1]);
    out.push({ x: xa, y: ya, w: xb - xa + 1, h: yb - ya + 1, col: "#8ac0ff", thin: true });
  }
  if (mode.kind === "stamp" && mode.bp && hov) for (const p of mode.bp.parts) {
    const q = auto.rotPart(mode.bp, p, mode.rot || 0), n = B.sizeOf(p.t);
    out.push({ x: hov[0] + q.x, y: hov[1] + q.y, w: n, h: n, col: E.unlocked(p.t) ? "#9ad0ff" : "#ff5a5a" });
  }
  if (mode.kind === "move" && mode.copy && hov) {
    const n = B.sizeOf(mode.copy.type), x = hov[0] - Math.floor((n - 1) / 2), y = hov[1] - Math.floor((n - 1) / 2);
    out.push({ x, y, w: n, h: n, col: B.whyNot(mode.copy.type, x, y, mode.copy) ? "#ff5a5a" : "#7affa0" });
  }
  return out;
}

/* ---------- Zen, the Logbook ---------- */
export function setZen(on) {
  document.body.classList.toggle("zen", !!on);
  RT.zen = !!on;
  RT.zenSince = on ? performance.now() : 0;
  if (on) { closePanel(); card = null; RT.selected = null; renderCard(); }
}
export function showLogbook(log, replay) {
  if (!log) return;
  const el = $("logbook");
  const rows = [
    ["Away", fmtTime(log.away) + (log.counted < log.away ? " (counted " + fmtTime(log.counted) + ")" : "")],
    ["Offline Rate", Math.round(log.rate * 100) + "%"],
    ["Glow earned", fmtL(log.glow)],
    ["Plots claimed", log.plots], ["Ghosts built", log.built], ["Levels bought", log.levels],
    ["Bloom levels", log.bloom], ["Golden Moths caught", log.caught], ["Moth Jars", log.jars], ["Harvests", log.harvests]
  ].filter(([, v]) => v !== 0 && v !== "0");
  $("logBody").innerHTML = '<table class="log">' + rows.map(([k, v]) => "<tr><td>" + k + "</td><td>" + esc(v) + "</td></tr>").join("") + "</table>" + '<p class="hint">' + "<button class=\"ib\" data-info=\"offline\" aria-label=\"About offline\">" + icon("info") + "</button></p>";
  hydrateIcons(el);
  el.hidden = false;
  if (replay && log.frames && log.frames.length > 2) {
    RT.replay = { frames: log.frames, t0: performance.now(), dur: 10000, frame: log.frames[0] };
    el.classList.add("replaying");
  }
}
export function replayTick(now) {
  const r = RT.replay;
  if (!r) return;
  const f = Math.min(1, (now - r.t0) / r.dur);
  r.frame = r.frames[Math.min(r.frames.length - 1, Math.floor(f * r.frames.length))];
  $("replayBar").style.width = (f * 100).toFixed(1) + "%";
  if (f >= 1) { RT.replay = null; $("logbook").classList.remove("replaying"); }
}
export { endMode as cancelMode };

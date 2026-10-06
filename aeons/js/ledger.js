/* ledger.js — the realm on one page: its structures, its forces, its squads, its economy.
 *
 * The map shows where things are; the ledger shows how many, how strong and
 * how busy, and lets you act on a whole kind at once: raise every barracks
 * that can be raised, send workers to everything damaged, select every idle
 * shooter. A large realm is run from here more than from the map.
 *
 * The economy tab draws income per minute for the last hour, one small chart
 * per resource. Each is a single series, so the title (and its icon) names
 * it and there is no legend; the latest value is labelled directly, and each
 * minute has a hover target with its exact figure. */

import { G, emit } from "./state.js";
import { TILE, RES, RES_NAME, RES_ERA, LINES, BUILDINGS, HEROES, TRAINED, RANK_NAMES, maxLevel, levelCost, DOCTRINES } from "./data.js";
import { icon } from "./icons.js";
import { portrait } from "./sprites.js";
import { actions, act, tierOf } from "./buildings.js";
import { canAfford, lvl } from "./entities.js";
import { setOrder, isMilitary } from "./units.js";
import { select, centerOn, beginTarget, selected } from "./input.js";
import { squads, create, disband, setRole, ROLES } from "./squads.js";
import { demand, armySupply } from "./auto.js";
import { possess, release } from "./heroes.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "k" : String(Math.round(n));
const RES_COL = { gold: "#f4d03f", wood: "#c8a068", stone: "#c0c4c8", oil: "#9a9ab8", aether: "#d38bff" };
export let tab = "structures";
export function setTab(t) { tab = t; }

/* ---------------- history: sampled by sim.js every half minute ---------------- */
/** Income per minute between samples, for one resource. */
function perMinute(r) {
  const H = G.history || [], out = [];
  for (let i = Math.max(1, H.length - 120); i < H.length; i++) { const dt = Math.max(1, H[i].t - H[i - 1].t); out.push({ t: H[i].t, v: (H[i][r] - H[i - 1][r]) / dt * 60 }); }
  return out;
}

/* ---------------- the page ---------------- */
export function render() {
  const tabs = [["structures", "Structures", "build"], ["forces", "Forces", "army"], ["squads", "Squads", "users"], ["economy", "Economy", "gold"]];
  let h = '<div class="tabs" role="tablist">' + tabs.map(([k, n, i]) => '<button role="tab" class="tab' + (tab === k ? " on" : "") + '" data-l="tab" data-v="' + k + '">' + icon(i) + n + "</button>").join("") + "</div>";
  h += tab === "structures" ? structures() : tab === "forces" ? forces() : tab === "squads" ? squadsTab() : economy();
  return h;
}

function structures() {
  const mine = G.blds.filter((b) => !b.dead && b.team === 0);
  const building = mine.filter((b) => b.built < 1).length, damaged = mine.filter((b) => b.built >= 1 && b.hp < b.maxHp * 0.95).length;
  const cap = maxLevel(G.era), raisable = mine.filter((b) => b.built >= 1 && !BUILDINGS[b.type].noLevel && b.level < cap).length;
  let h = '<p class="dim">' + mine.length + " standing · " + building + " going up · " + damaged + " damaged · " + raisable + " can be raised</p>";
  const types = Object.keys(BUILDINGS).filter((t) => mine.some((b) => b.type === t));
  for (const t of types) {
    const bs = mine.filter((b) => b.type === t), d = BUILDINGS[t];
    const lv = {}; for (const b of bs) lv[b.level] = (lv[b.level] || 0) + 1;
    const hp = bs.reduce((a, b) => a + b.hp / b.maxHp, 0) / bs.length;
    const busy = bs.filter((b) => b.q.length).length, dmg = bs.filter((b) => b.built >= 1 && b.hp < b.maxHp * 0.95).length;
    const up = bs.filter((b) => b.built >= 1 && !d.noLevel && b.level < cap);
    const nextCost = up.length ? levelCost(t, Math.min(...up.map((b) => b.level)) + 1) : null;
    const topLv = Math.max(...bs.map((b) => b.level));
    h += '<div class="row led"><img class="por sm" src="' + portrait("bld", t, Math.min(9, topLv - 1), 0) + '" alt=""><span><b>' + esc(d.names[Math.min(9, topLv - 1)] || d.names[d.names.length - 1]) + " <i class=\"n\">" + bs.length + "</i></b><small>" +
      Object.keys(lv).sort((a, b) => a - b).map((l) => "Lv " + l + (lv[l] > 1 ? " ×" + lv[l] : "")).join(", ") + (busy ? " · " + busy + " busy" : "") + "</small>" +
      '<i class="mbar"><i style="width:' + Math.round(hp * 100) + '%"></i></i></span><span class="acts">' +
      '<button class="iconBtn small" data-l="selType" data-v="' + t + '" aria-label="Select every one">' + icon("box") + "</button>" +
      '<button class="iconBtn small" data-l="nextType" data-v="' + t + '" aria-label="Go to the next one">' + icon("locate") + "</button>" +
      (dmg ? '<button class="iconBtn small" data-l="repairType" data-v="' + t + '" aria-label="Repair the damaged">' + icon("wrench") + "<b>" + dmg + "</b></button>" : "") +
      (up.length ? '<button class="iconBtn small' + (canAfford(nextCost) ? "" : " no") + '" data-l="raiseType" data-v="' + t + '" aria-label="Raise every one that can be raised">' + icon("up") + "<b>" + up.length + "</b></button>" : "") +
      "</span></div>";
  }
  if (!types.length) h += '<p class="dim">Nothing yet.</p>';
  return h;
}

function forces() {
  const mine = G.units.filter((u) => !u.dead && u.team === 0 && !u.hero && !u.free);
  let h = '<p class="dim">' + mine.length + " units · army supply " + armySupply() + " · " + mine.filter((u) => u.order.t === "idle").length + " idle</p>";
  for (const l of TRAINED) {
    const us = mine.filter((u) => u.line === l);
    if (!us.length) continue;
    const tiers = {}; for (const u of us) tiers[u.tier] = (tiers[u.tier] || 0) + 1;
    const ranks = [0, 0, 0, 0, 0]; for (const u of us) ranks[u.rank || 0]++;
    const idle = us.filter((u) => u.order.t === "idle").length;
    const hp = us.reduce((a, u) => a + u.hp / u.maxHp, 0) / us.length;
    const t = tierOf(l);
    h += '<div class="row led"><img class="por sm" src="' + portrait("unit", l, t, 0) + '" alt=""><span><b>' + esc(LINES[l].names[t]) + ' <i class="n">' + us.length + "</i></b><small>" +
      Object.keys(tiers).map((e) => (tiers[e] > 0 && +e !== t ? tiers[e] + " still " + LINES[l].names[e] : "")).filter(Boolean).join(", ") +
      (ranks.slice(1).some(Boolean) ? (Object.keys(tiers).length > 1 ? " · " : "") + ranks.map((n, r) => r && n ? n + " " + RANK_NAMES[r] : "").filter(Boolean).join(", ") : "") +
      (idle ? " · " + idle + " idle" : "") + '</small><i class="mbar"><i style="width:' + Math.round(hp * 100) + '%"></i></i></span><span class="acts">' +
      '<button class="iconBtn small" data-l="selLine" data-v="' + l + '" aria-label="Select every one">' + icon("box") + "</button>" +
      (idle ? '<button class="iconBtn small" data-l="selIdle" data-v="' + l + '" aria-label="Select the idle">' + icon("pause") + "<b>" + idle + "</b></button>" : "") + "</span></div>";
  }
  h += "<h3>Champions</h3>";
  const hs = Object.keys(G.heroes);
  if (!hs.length) h += '<p class="dim">None called yet.</p>';
  for (const id of hs) {
    const s = G.heroes[id], u = s.uid && G.ents.get(s.uid);
    h += '<div class="row led"><img class="por sm" src="' + portrait("unit", "melee", G.era, 0, id) + '" alt=""><span><b>' + HEROES[id].name + "</b><small>Lv " + s.lvl + (u ? " · " + Math.round(100 * u.hp / u.maxHp) + "% · " + (u.manual ? "in your hands" : "on its own") : " · fallen") + '</small></span><span class="acts">' +
      (u ? '<button class="iconBtn small" data-l="hero" data-v="' + id + '" aria-label="Find">' + icon("locate") + '</button><button class="btn small" data-l="heroCtl" data-v="' + id + '">' + (u.manual ? "Let go" : "Control") + "</button>" : "") + "</span></div>";
  }
  return h;
}

function squadsTab() {
  const S = squads(), sel = selected().filter((e) => e.kind === "unit" && e.team === 0 && isMilitary(e));
  let h = '<p class="dim">Squads keep doing a job until you change it. <button class="info" data-info="squads" aria-label="About squads">' + icon("info") + "</button></p>";
  h += '<button class="btn wide' + (sel.length ? " primary" : " no") + '" data-l="newSquad">' + icon("plus") + (sel.length ? "New squad from the " + sel.length + " selected" : "Select soldiers to make a squad") + "</button>";
  if (!G.doctrines.captains) h += '<p class="dim">' + esc(DOCTRINES.captains.name) + " (academy) sends new soldiers to fill squads.</p>";
  for (const s of S) {
    const n = s.ids.filter((id) => G.ents.has(id)).length;
    h += '<div class="squad"><div class="row led"><span><b>' + esc(s.name) + ' <i class="n">' + n + "/" + s.size + "</i></b><small>" + esc(ROLES[s.role].line) + (s.state === "march" ? " · marching" : s.state === "regroup" ? " · regrouping" : s.state === "answer" ? " · answering an alarm" : "") + '</small></span><span class="acts">' +
      '<button class="iconBtn small" data-l="sqSize" data-v="' + s.id + '" data-d="-1" aria-label="Fewer">' + icon("minus") + "</button>" +
      '<button class="iconBtn small" data-l="sqSize" data-v="' + s.id + '" data-d="1" aria-label="More">' + icon("plus") + "</button>" +
      '<button class="iconBtn small" data-l="sqSel" data-v="' + s.id + '" aria-label="Select">' + icon("box") + "</button>" +
      '<button class="iconBtn small" data-l="sqPlace" data-v="' + s.id + '" aria-label="Set its place">' + icon("flag") + "</button>" +
      '<button class="iconBtn small" data-l="sqDel" data-v="' + s.id + '" aria-label="Disband">' + icon("trash") + "</button></span></div>" +
      '<div class="seg small">' + Object.keys(ROLES).map((r) => '<button class="' + (s.role === r ? "on" : "") + '" data-l="sqRole" data-v="' + s.id + '" data-r="' + r + '">' + ROLES[r].name + "</button>").join("") + "</div></div>";
  }
  if (!S.length) h += '<p class="dim">No squads yet.</p>';
  return h;
}

function economy() {
  const H = G.history || [];
  let h = "";
  const ws = G.units.filter((u) => !u.dead && u.team === 0 && u.line === "worker" && !u.hero);
  const jobs = { gold: 0, wood: 0, stone: 0, build: 0, repair: 0, idle: 0, other: 0 };
  for (const w of ws) { const t = w.order.t; if (t === "gather") jobs[w.order.res]++; else if (t === "build" || t === "repair" || t === "idle") jobs[t]++; else jobs.other++; }
  h += '<p class="dim">' + ws.length + " workers: " + jobs.gold + " gold, " + jobs.wood + " wood, " + jobs.stone + " stone, " + jobs.build + " building, " + jobs.repair + " repairing, " + jobs.idle + " idle</p>";
  if (H.length < 3) h += '<p class="dim">Income charts begin after the first minute or two.</p>';
  else {
    h += '<div class="charts">';
    for (const r of RES) {
      if (G.era < RES_ERA[r] - 1 && !(G.stats.byRes || {})[r]) continue;
      h += chart(r);
    }
    h += "</div>";
  }
  const prod = G.blds.filter((b) => !b.dead && b.team === 0 && BUILDINGS[b.type].produces && b.built >= 1);
  if (prod.length) h += '<p class="dim">' + prod.length + " pumps and siphons working by themselves.</p>";
  const need = demand(), sum = need.gold + need.wood + need.stone;
  h += "<h3>What the realm is waiting for</h3>" + (sum > 0 ? '<p class="dim">' + RES.slice(0, 3).filter((r) => need[r] > 0).map((r) => fmt(need[r]) + " " + RES_NAME[r].toLowerCase()).join(", ") + " short, across everything your buildings offer." + (G.doctrines.governor ? (G.auto.demand ? " Stewards are leaning towards it." : " Stewards can follow it (Automation).") : "") + "</p>" : '<p class="dim">Nothing: you can pay for everything on offer.</p>');
  return h;
}
/** Income per minute, last hour: one series, a 2px line, a recessive baseline, the last value labelled. */
function chart(r) {
  const pts = perMinute(r);
  const W = 260, Hh = 54, pad = 4;
  const max = Math.max(1, ...pts.map((p) => p.v));
  const x = (i) => pad + i / Math.max(1, pts.length - 1) * (W - pad * 2 - 36), y = (v) => Hh - pad - v / max * (Hh - pad * 2 - 6);
  const d = pts.map((p, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p.v).toFixed(1)).join("");
  const last = pts[pts.length - 1] || { v: 0 };
  const hits = pts.map((p, i) => '<rect x="' + (x(i) - (W - 50) / pts.length / 2).toFixed(1) + '" y="0" width="' + Math.max(4, (W - 50) / pts.length).toFixed(1) + '" height="' + Hh + '" fill="transparent"><title>' + Math.floor(p.t / 60) + " min · " + fmt(p.v) + " " + RES_NAME[r].toLowerCase() + " a minute</title></rect>").join("");
  return '<figure class="chart"><figcaption>' + icon(r) + RES_NAME[r] + ' <span>per minute, last hour</span></figcaption><svg viewBox="0 0 ' + W + " " + Hh + '" role="img" aria-label="' + RES_NAME[r] + " income per minute, latest " + fmt(last.v) + '">' +
    '<line x1="' + pad + '" y1="' + (Hh - pad) + '" x2="' + (W - 40) + '" y2="' + (Hh - pad) + '" class="base"/>' +
    '<path d="' + d + '" fill="none" stroke="' + RES_COL[r] + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
    (pts.length ? '<circle cx="' + x(pts.length - 1) + '" cy="' + y(last.v) + '" r="3" fill="' + RES_COL[r] + '" stroke="#141118" stroke-width="2"/>' : "") +
    '<text x="' + (W - 34) + '" y="' + (y(last.v) + 4) + '" class="val">' + fmt(last.v) + "</text>" + hits + "</svg></figure>";
}

/* ---------------- what the buttons do ---------------- */
export function click(t) {
  const b = t.closest("[data-l]");
  if (!b) return false;
  const k = b.dataset.l, v = b.dataset.v;
  const mine = (type) => G.blds.filter((x) => !x.dead && x.team === 0 && x.type === type);
  switch (k) {
    case "tab": tab = v; break;
    case "selType": select(mine(v)); centerOn(mine(v)); emit("closePanel"); break;
    case "nextType": { const bs = mine(v); if (!bs.length) break; G.ledgerIdx = ((G.ledgerIdx || 0) + 1) % bs.length; const x = bs[G.ledgerIdx]; select([x]); centerOn([x]); emit("closePanel"); break; }
    case "raiseType": { let n = 0; for (const x of mine(v)) { const a = actions(x).find((a) => a.kind === "level"); if (a && a.ok && act(x, "level")) n++; } emit("toast", n ? n + " being raised" : "Nothing can be paid for yet", n ? "good" : "bad"); break; }
    case "repairType": {
      const ws = G.units.filter((u) => !u.dead && u.team === 0 && u.line === "worker" && !u.hero && u.order.t !== "build" && u.order.t !== "repair");
      let n = 0;
      for (const x of mine(v).filter((x) => x.built >= 1 && x.hp < x.maxHp * 0.95)) {
        ws.sort((a, c) => Math.hypot(a.x - x.x, a.y - x.y) - Math.hypot(c.x - x.x, c.y - x.y));
        const w = ws.shift(); if (!w) break; setOrder(w, { t: "repair", id: x.id }); n++;
      }
      emit("toast", n + " workers sent to repair", "auto"); break;
    }
    case "selLine": { const us = G.units.filter((u) => !u.dead && u.team === 0 && u.line === v && !u.hero && !u.free); select(us); emit("closePanel"); break; }
    case "selIdle": { const us = G.units.filter((u) => !u.dead && u.team === 0 && u.line === v && !u.hero && !u.free && u.order.t === "idle"); select(us); centerOn(us); emit("closePanel"); break; }
    case "hero": { const u = G.ents.get(G.heroes[v].uid); if (u) { select([u]); centerOn([u]); emit("closePanel"); } break; }
    case "heroCtl": { const u = G.ents.get(G.heroes[v].uid); if (u) { u.manual ? release() : possess(u); emit("closePanel"); } break; }
    case "newSquad": { const s = create(selected()); if (s) emit("toast", "Squad " + s.name + " formed", "good"); break; }
    case "sqRole": { const s = squads().find((x) => x.id === +v); if (s) setRole(s, b.dataset.r); break; }
    case "sqSize": { const s = squads().find((x) => x.id === +v); if (s) s.size = Math.max(1, Math.min(60, s.size + +b.dataset.d)); break; }
    case "sqSel": { const s = squads().find((x) => x.id === +v); if (s) { const us = s.ids.map((id) => G.ents.get(id)).filter(Boolean); select(us); centerOn(us); emit("closePanel"); } break; }
    case "sqPlace": { const s = squads().find((x) => x.id === +v); if (s) { G.placingSquad = s.id; emit("closePanel"); beginTarget("squad", "Tap the squad's place"); } break; }
    case "sqDel": { const s = squads().find((x) => x.id === +v); if (s) disband(s); break; }
    default: return false;
  }
  return true;
}
export { TILE, lvl };

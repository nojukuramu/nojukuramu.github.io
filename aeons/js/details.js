/* details.js — everything about one thing: what it is, what it does, what it becomes.
 *
 * The selection panel says one line; this is the sheet behind it (the house
 * rule: one line on the pane, the rest one tap away). For a building: its
 * numbers now and at the next level, everything it trains and researches, and
 * the strip of what it looks like in every era — the ones you have reached
 * lit, the rest dark. For a unit: its numbers and its next version's, its
 * rank and kills, and the same strip for its line. For a champion: its four
 * skills, what each does and how long it takes to come back. */

import { G } from "./state.js";
import { TILE, RES, RES_NAME, LINES, BUILDINGS, HEROES, TECH_CATS, ERAS, DOCTRINES, RANKS, RANK_NAMES, RANK_BONUS, lineStats, bldHp, bldArmor, maxLevel, levelCost, heroXpFor, ATK_PER_LEVEL, eraMul, NODES } from "./data.js";
import { icon } from "./icons.js";
import { portrait } from "./sprites.js";
import { actions, tierOf, territoryOf, roman } from "./buildings.js";
import { lvl, atkCatOf, armCatOf } from "./entities.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const n1 = (v) => (Math.round(v * 10) / 10).toString();
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? (n / 1e3).toFixed(1) + "k" : String(Math.round(n));
const cost = (c) => RES.filter((r) => c && c[r]).map((r) => '<span class="cost">' + icon(r) + fmt(c[r]) + "</span>").join(" ");
const row = (k, now, next) => "<tr><th>" + k + "</th><td>" + now + "</td>" + (next !== undefined ? '<td class="nx">' + (next === now ? "" : next) + "</td>" : "") + "</tr>";

export function title(e) {
  if (!e) return "Details";
  if (e.kind === "node") return NODES[e.type].name;
  if (e.kind === "bld") return BUILDINGS[e.type].names[Math.min(9, e.level - 1)];
  if (e.hero) return HEROES[e.hero].name;
  return LINES[e.line].names[e.tier];
}

/** The era strip: what this thing looks like in every age, the reached ones lit. */
function strip(kind, id, first, cur, team, hero) {
  let h = '<div class="strip">';
  for (let e = first; e <= 9; e++) {
    const src = kind === "bld" ? portrait("bld", id, e, team) : portrait("unit", id, e, team, hero);
    h += '<figure class="' + (e === cur ? "cur" : e > G.era ? "dark" : "") + '"><img src="' + src + '" alt=""><figcaption>' + ERAS[e].name + "</figcaption></figure>";
  }
  return h + "</div>";
}

export function render(e) {
  if (!e || e.dead) return '<p class="dim">Nothing selected.</p>';
  if (e.kind === "node") return node(e);
  if (e.kind === "bld") return building(e);
  return unit(e);
}

function node(n) {
  const d = NODES[n.type];
  const what = { gold: "Workers dig gold out of it until it is empty. Bigger, the further it is from home.", stone: "Workers break stone from it until it is gone.", oil: "Never runs dry. A Derrick (Age of Steam) pumps it on its own.", aether: "Never runs dry. A Siphon (Age of Stars) draws it on its own.", relic: "Someone was here before. Walk a unit into it to find what they left." }[n.type];
  let h = "<p>" + esc(what) + "</p><table class=\"st\">";
  if (n.type === "gold" || n.type === "stone") h += row("Left", fmt(n.amount)) + row("Taken", fmt(n.taken || 0));
  if (n.guards && n.guards.some((id) => G.ents.get(id) && !G.ents.get(id).dead)) h += row("Guarded by", n.guards.filter((id) => G.ents.get(id) && !G.ents.get(id).dead).length + " beasts");
  h += row("Size", d.w + " × " + d.h + " tiles") + "</table>";
  return h;
}

function building(b) {
  const d = BUILDINGS[b.type], L = b.level, nextL = Math.min(10, L + 1), cap = maxLevel(G.era);
  const mason = b.team === 0 ? 1 + 0.08 * lvl("masonry") : (b.boost || 1);
  let h = '<p class="dim">' + esc(d.blurb) + "</p>";
  if (b.built < 1) h += "<p>Going up: " + Math.floor(b.built * 100) + "%.</p>";
  const showNext = !d.noLevel && L < 10;
  h += '<table class="st"><tr><th></th><td>Level ' + L + "</td>" + (showNext ? '<td class="nx">Level ' + nextL + (nextL > cap ? " (" + ERAS[nextL - 1].name + ")" : "") + "</td>" : "") + "</tr>";
  h += row("Health", Math.ceil(b.hp) + " / " + b.maxHp, showNext ? String(Math.round(bldHp(b.type, nextL) * mason)) : undefined);
  h += row("Armour", n1(bldArmor(b.type, L)), showNext ? n1(bldArmor(b.type, nextL)) : undefined);
  if (d.attack) {
    const tk = b.team === 0 ? 1 + ATK_PER_LEVEL * lvl("tower") : (b.boost || 1);
    h += row("Attack", n1(b.atk) + " every " + d.attack.cd + "s", showNext ? n1(d.attack.atk * Math.pow(1.42, nextL - 1) * tk) : undefined);
    h += row("Reach", n1(b.range) + " tiles", showNext ? n1(b.range + 0.15) : undefined);
    h += row("Hits aircraft", b.hitsAir ? "yes" : "from " + ERAS[d.hitsAirFrom].name, undefined);
  }
  if (d.territory) h += row("Border", territoryOf(b) + " tiles", showNext ? String(territoryOf(b) + 2) : undefined);
  if (d.supply) h += row("Supply", "+" + (d.supply + (d.supplyPerLevel || 2) * (L - 1)), showNext ? "+" + (d.supply + (d.supplyPerLevel || 2) * (nextL - 1)) : undefined);
  if (d.trains) h += row("Work speed", "+" + 8 * (L - 1) + "%", showNext ? "+" + 8 * (nextL - 1) + "%" : undefined);
  if (d.produces) for (const r in d.produces) h += row(RES_NAME[r], n1(d.produces[r] * (1 + 0.35 * (L - 1))) + "/s", showNext ? n1(d.produces[r] * (1 + 0.35 * (nextL - 1))) + "/s" : undefined);
  h += row("Sight", b.sight + " tiles") + (d.drop ? row("Takes", d.drop.map((r) => RES_NAME[r]).join(", ")) : "") + "</table>";
  if (showNext && b.team === 0) h += '<p class="dim">Raising it: ' + cost(levelCost(b.type, nextL)) + (nextL > cap ? " — needs the " + ERAS[nextL - 1].age : "") + "</p>";
  if (b.team === 0 && b.built >= 1) {
    const acts = actions(b).filter((a) => a.kind === "unit" || a.kind === "tech" || a.kind === "refit" || a.kind === "doc" || a.kind === "hero");
    if (acts.length) {
      h += "<h3>Here</h3>";
      for (const a of acts) {
        const img = a.kind === "unit" || a.kind === "refit" ? '<img class="por xs" src="' + portrait("unit", a.line, a.tier, 0) + '" alt="">' : '<i class="por xs">' + icon(a.icon || (a.kind === "hero" ? "crown" : "up")) + "</i>";
        h += '<div class="row det">' + img + "<span><b>" + esc(a.label) + "</b><small>" + esc(a.line2 || "") + "</small><small>" + cost(a.cost) + ' <span class="t">' + a.time + "s</span>" + (a.ok ? "" : ' <span class="why">' + esc(a.why) + "</span>") + "</small></span></div>";
      }
    }
    // research levels this building owns
    const cats = Object.keys(TECH_CATS).filter((c) => TECH_CATS[c].at === b.type);
    if (cats.length) h += "<h3>Research held here</h3><div class=\"grid2\">" + cats.map((c) => "<span>" + TECH_CATS[c].name + " <b>" + lvl(c) + "/" + TECH_CATS[c].max + "</b></span>").join("") + "</div>";
    if (b.type === "academy") h += "<h3>Doctrines</h3><div class=\"grid2\">" + Object.keys(DOCTRINES).map((k) => "<span>" + DOCTRINES[k].name + " <b>" + (G.doctrines[k] ? "learned" : ERAS[DOCTRINES[k].era].name) + "</b></span>").join("") + "</div>";
  }
  h += "<h3>Through the ages</h3>" + strip("bld", b.type, d.first, Math.min(9, L - 1), b.team);
  return h;
}

function unit(u) {
  let h = "";
  const s = u.st;
  if (u.hero) {
    const H = HEROES[u.hero];
    h += '<p class="dim">' + esc(H.role + ". " + H.blurb) + "</p>";
    h += '<table class="st">' + row("Level", u.lvl + (u.lvl < 30 ? " (" + Math.floor(u.xp) + " / " + heroXpFor(u.lvl) + " to the next)" : " (the last)")) + statRows(u, s) + "</table>";
    h += "<h3>Skills</h3>";
    H.skills.forEach((k, i) => {
      h += '<div class="row det"><i class="por xs">' + icon(k.id) + "</i><span><b>" + k.key + " · " + esc(k.name) + "</b><small>" + esc(k.line) + "</small><small>Every " + k.cd + "s · reach " + k.range + (k.radius ? " · radius " + k.radius : "") + (i === 3 && u.lvl < 6 ? ' · <span class="why">opens at level 6</span>' : (u.skcd && u.skcd[i] > 0 ? " · ready in " + Math.ceil(u.skcd[i]) + "s" : " · ready")) + "</small></span></div>";
    });
    return h;
  }
  const L = LINES[u.line];
  h += '<p class="dim">' + esc(L.blurb) + "</p>";
  const nt = u.team === 0 && !L.wild && u.tier < 9 && u.tier + 1 >= L.first ? u.tier + 1 : null;
  let ns = null;
  if (nt !== null) { ns = lineStats(u.line, nt); const ac = atkCatOf(u.line); if (ac) ns.atk *= 1 + ATK_PER_LEVEL * lvl(ac); if (u.rank) { ns.atk *= 1 + RANK_BONUS * u.rank; ns.hp = Math.round(ns.hp * (1 + RANK_BONUS * u.rank)); } }
  h += '<table class="st"><tr><th></th><td>' + esc(L.names[u.tier]) + "</td>" + (ns ? '<td class="nx">' + esc(L.names[nt]) + (nt > G.era ? " (" + ERAS[nt].name + ")" : "") + "</td>" : "") + "</tr>" + statRows(u, s, ns) + "</table>";
  if (!L.wild) {
    const r = u.rank || 0, next = RANKS[r];
    h += '<p class="dim">' + (r ? RANK_NAMES[r] + ": +" + Math.round(RANK_BONUS * r * 100) + "% damage and health. " : "") + (u.kills || 0) + " kills" + (next ? ", " + (next - (u.kills || 0)) + " more to " + RANK_NAMES[r + 1] : "") + '. <button class="info" data-info="wild" aria-label="About ranks and the wild">' + icon("info") + "</button></p>";
    if (u.team === 0) {
      const ac = atkCatOf(u.line), am = armCatOf(u.line);
      if (ac || am) h += '<p class="dim">' + (ac ? TECH_CATS[ac].name + " " + lvl(ac) + "/" + TECH_CATS[ac].max : "") + (ac && am ? " · " : "") + (am ? TECH_CATS[am].name + " " + lvl(am) + "/" + TECH_CATS[am].max : "") + "</p>";
    }
  }
  h += "<h3>Through the ages</h3>" + strip("unit", u.line, L.first, u.tier, u.team === 1 ? 1 : 0);
  return h;
}
function statRows(u, s, ns) {
  const dps = (x) => n1(x.atk / x.cd);
  const N = (v) => (ns ? v : undefined);
  let h = row("Health", Math.ceil(u.hp) + " / " + u.maxHp, ns ? String(ns.hp) : undefined);
  h += row(u.line === "mender" && !u.hero ? "Heals" : "Attack", n1(s.atk * (u.line === "mender" && !u.hero ? 1.6 : 1)) + " · " + dps(s) + "/s", ns ? n1(ns.atk) + " · " + dps(ns) + "/s" : undefined);
  h += row("Armour", n1(s.armor), ns ? n1(ns.armor) : undefined);
  h += row("Reach", n1(s.range) + (s.minRange ? " (not under " + s.minRange + ")" : ""), ns ? n1(ns.range) : undefined);
  h += row("Speed", n1(s.speed) + " tiles/s", ns ? n1(ns.speed) : undefined);
  h += row("Sight", s.sight + " tiles", N(String(ns && ns.sight)));
  const traits = [];
  if (s.hitsAir) traits.push("hits aircraft"); if (s.splash) traits.push("splash " + n1(s.splash)); if (s.vsBld) traits.push("×" + s.vsBld + " against buildings"); if (s.air) traits.push("flies"); if (s.naval) traits.push("sails"); if (s.mech) traits.push("a machine: repairable");
  if (traits.length) h += row("Also", traits.join(", "));
  return h;
}
export { TILE, roman, tierOf, eraMul };

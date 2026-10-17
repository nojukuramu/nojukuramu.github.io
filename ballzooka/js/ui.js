/* ui.js — everything that is not the field: the HUD over it, and the
 * screens between runs (title, shop, trophies, settings, the perk draft,
 * pause, the result with its bonus wheel, and the free revive).
 *
 * One container (#screen) holds whichever screen is up, rebuilt from a
 * template string; clicks are delegated through data-act, so a screen is
 * markup and nothing else. The HUD is long-lived and only touched when a
 * number on it actually changes. */

import { S, save, wipe } from "./save.js";
import { PERKS, UPGRADES, upgradeCost, CANNONS, BALLS, ACH, MODIFIERS, DROP } from "./data.js";
import { icon, hydrateIcons } from "./icons.js";
import { fmt } from "./render.js";
import { stars as starsOf } from "./sim.js";
import * as upd from "./update.js";
import * as audio from "./audio.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let H = {}, current = null, data = null, wheelRAF = 0;

export function init(handlers) {
  H = handlers;
  $("screen").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const act = b.dataset.act, arg = b.dataset.arg;
    audio.unlock();
    if (ACTS[act]) { ACTS[act](arg, b); }
  });
  $("pauseBtn").addEventListener("click", () => H.pause());
  upd.onChange(() => { if (current === "settings") show("settings"); });
}
export const screenName = () => current;

/* ---------- toasts ---------- */
let toastT = 0;
export function toast(html) {
  const t = $("toast");
  t.innerHTML = html; t.hidden = false; t.classList.remove("in"); void t.offsetWidth; t.classList.add("in");
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- the HUD ---------- */
const last = {};
function set(id, v, html) {
  if (last[id] === v) return;
  last[id] = v;
  const el = $(id);
  if (el) { if (html) el.innerHTML = v; else el.textContent = v; }
}
export function hud(g) {
  if (!g) return;
  set("lvlTxt", g.mode === "campaign" ? "LEVEL " + g.level : g.mode === "daily" ? "DAILY  ·  WAVE " + (g.wave + 1) : "ENDLESS  ·  WAVE " + (g.wave + 1));
  set("coinTxt", fmt(S.coins + g.coins));
  set("ballTxt", fmt(g.ballCount));
  set("scoreTxt", g.mode === "campaign" ? "" : fmt(g.score));
  let h = "";
  for (let i = 0; i < g.maxHearts; i++) h += '<span class="' + (i < g.hearts ? "on" : "off") + '">' + icon("heart") + "</span>";
  set("hearts", h, true);
  const T = g.temp;
  let buffs = "";
  for (const k of ["rapid", "mega", "twin", "freeze"]) if (T[k] > 0) buffs += '<span class="buff" style="--c:' + DROP[k].color + '">' + DROP[k].name + " " + Math.ceil(T[k]) + "</span>";
  set("buffs", buffs, true);
  const pf = $("progFill"), ff = $("feverFill"), xf = $("xpFill");
  const prog = Math.round(H.progress(g) * 1000) / 10;
  if (last.prog !== prog) { last.prog = prog; pf.style.width = prog + "%"; }
  const fv = Math.round(g.fever * 100);
  if (last.fv !== fv) { last.fv = fv; ff.style.width = fv + "%"; }
  const fev = g.feverT > 0;
  if (last.fev !== fev) { last.fev = fev; $("hud").classList.toggle("fever", fev); }
  const xp = Math.round(Math.min(1, g.xp / g.xpNext) * 100);
  if (last.xp !== xp) { last.xp = xp; xf.style.width = xp + "%"; }
  const boss = g.mode === "campaign" && g.waves.length && g.waves[g.waves.length - 1].boss;
  if (last.boss !== boss) { last.boss = boss; $("progWrap").classList.toggle("boss", !!boss); }
}
export function resetHud() { for (const k of Object.keys(last)) delete last[k]; }
export function showHud(v) { $("hud").hidden = !v; }

/* ---------- screens ---------- */
function btn(act, arg, label, cls, ico, dis) {
  return '<button class="btn ' + (cls || "") + '" data-act="' + act + '"' + (arg != null ? ' data-arg="' + esc(arg) + '"' : "") + (dis ? " disabled" : "") + ">" + (ico ? icon(ico) : "") + "<span>" + label + "</span></button>";
}
const info = (k) => '<button class="info" data-info="' + k + '" aria-label="More about this">' + icon("info") + "</button>";
const coinChip = () => '<span class="chip coin">' + icon("coin") + "<b>" + fmt(S.coins) + "</b></span>";
function head(title, back) {
  return '<div class="head">' + (back ? '<button class="ibtn" data-act="home" aria-label="Back">' + icon("home") + "</button>" : "<span></span>") + "<h2>" + title + "</h2>" + coinChip() + "</div>";
}

const VIEWS = {
  title() {
    const d = H.dailyInfo();
    const played = S.best.daily[d.key];
    return '<div class="title">' +
      '<div class="topbar">' + coinChip() + '<span class="grow"></span>' + info("about") + "</div>" +
      '<div class="ad-ribbon">ONLY 1% CAN BEAT LEVEL ' + S.level + "</div>" +
      '<h1 class="logo"><span class="l1">BALL</span><span class="l2">ZOOKA</span></h1>' +
      '<p class="tag">Drag. Multiply. Pop everything.</p>' +
      '<div class="playwrap">' + btn("play", "campaign", "LEVEL " + S.level, "big primary", "play") + "</div>" +
      '<div class="modes">' +
        btn("play", "endless", "Endless" + (S.best.endless ? " <small>best " + fmt(S.best.endless) + "</small>" : ""), "", "endless") +
        btn("play", "daily", "Daily <small>" + esc(MODIFIERS[d.mod].name) + (played ? " · " + fmt(played) : "") + "</small>", "", "calendar") +
        info("modes") +
      "</div>" +
      '<nav class="dock">' +
        btn("go", "shop", "Shop", "", "shop") + btn("go", "skins", "Skins", "", "skin") + btn("go", "trophies", "Trophies", "", "trophy") + btn("go", "settings", "Settings", "", "gear") +
      "</nav>" +
      '<p class="noads">' + icon("check") + "No ads. Not even fake ones.</p>" +
    "</div>";
  },

  shop() {
    let h = '<div class="panel">' + head("Shop", true) + '<p class="sub">Permanent, for every mode. ' + info("shop") + "</p><div class=\"list\">";
    for (const id of Object.keys(UPGRADES)) {
      const u = UPGRADES[id], lv = S.upg[id] | 0, maxed = lv >= u.max, cost = upgradeCost(id, lv);
      h += '<div class="item"><span class="ic">' + icon(u.icon) + '</span><div class="txt"><b>' + u.name + ' <small>Lv ' + lv + (maxed ? " · max" : "") + "</small></b><small>" + u.line + "</small></div>" +
        (maxed ? '<span class="maxed">' + icon("check") + "</span>" : btn("buy", id, icon("coin") + fmt(cost), cost <= S.coins ? "primary small" : "small", null, cost > S.coins)) + "</div>";
    }
    return h + "</div></div>";
  },

  skins() {
    let h = '<div class="panel">' + head("Skins", true) + '<div class="preview" id="skinPreview"></div><h3>Cannons</h3><div class="grid">';
    const cell = (kind, id, o) => {
      const owned = (kind === "cannon" ? S.owned.cannons : S.owned.balls).includes(id);
      const on = (kind === "cannon" ? S.cannon : S.ball) === id;
      const locked = !owned && o.ach && !S.ach[o.ach];
      const sw = kind === "cannon"
        ? '<i class="sw" style="background:' + (o.trim === "rainbow" ? "conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)" : o.body) + ";border-color:" + (o.trim === "rainbow" ? "#fff" : o.trim) + '"></i>'
        : '<i class="sw ball" style="background:' + (o.fill === "rainbow" ? "conic-gradient(red,orange,yellow,lime,cyan,blue,magenta,red)" : o.fill) + ";box-shadow:0 0 10px " + o.glow + '"></i>';
      const sub = on ? "On" : owned ? "Use" : locked ? icon("lock") + ACH[o.ach].name : icon("coin") + fmt(o.cost);
      return '<button class="skin' + (on ? " on" : "") + '" data-act="skin" data-arg="' + kind + ":" + id + '"' + (locked || (!owned && o.cost > S.coins) ? " data-poor=\"1\"" : "") + ">" + sw + "<b>" + o.name + "</b><small>" + sub + "</small></button>";
    };
    for (const id of Object.keys(CANNONS)) h += cell("cannon", id, CANNONS[id]);
    h += "</div><h3>Balls</h3><div class=\"grid\">";
    for (const id of Object.keys(BALLS)) h += cell("ball", id, BALLS[id]);
    return h + "</div></div>";
  },

  trophies() {
    const got = Object.keys(ACH).filter((k) => S.ach[k]).length;
    let h = '<div class="panel">' + head("Trophies", true) + '<p class="sub">' + got + " of " + Object.keys(ACH).length + '</p><div class="list">';
    for (const id of Object.keys(ACH)) {
      const a = ACH[id], on = !!S.ach[id];
      h += '<div class="item' + (on ? "" : " dim") + '"><span class="ic">' + icon(on ? "trophy" : "lock") + '</span><div class="txt"><b>' + a.name + "</b><small>" + a.line + "</small></div></div>";
    }
    const st = S.stats;
    h += '</div><h3>All told</h3><div class="stats">' +
      "<span><b>" + fmt(st.kills) + "</b>popped</span><span><b>" + fmt(st.fired) + "</b>balls fired</span><span><b>" + fmt(st.peak) + "</b>most at once</span><span><b>" + st.bosses + "</b>bosses</span><span><b>" + S.cleared + "</b>levels</span><span><b>" + (S.best.endlessWave || 0) + "</b>best wave</span></div>";
    return h + "</div>";
  },

  settings() {
    const tg = (k, label, ico) => '<div class="item"><span class="ic">' + icon(ico) + '</span><div class="txt"><b>' + label + '</b></div><button class="switch' + (S.set[k] ? " on" : "") + '" data-act="toggle" data-arg="' + k + '" role="switch" aria-checked="' + !!S.set[k] + '" aria-label="' + label + '"><i></i></button></div>';
    const u = upd.state();
    return '<div class="panel">' + head("Settings", true) + '<div class="list">' +
      tg("sound", "Sound", "sound") + tg("music", "Music", "music") + tg("haptics", "Vibration", "vibrate") + tg("motion", "Screen shake and trails", "motion") + tg("fx", "Glow and shadows", "bolt") +
      "</div><h3>Version " + info("update") + '</h3><div class="list"><div class="item"><div class="txt"><b>Ballzooka ' + esc(u.version) + '</b><small id="updState">' + (u.ready ? "A new version is ready." : u.supported ? "Checked every 30 minutes." : "Updates need the installed app.") + "</small></div>" +
      btn(u.ready ? "updApply" : "updCheck", null, u.ready ? "Reload" : "Check for updates", "small") + "</div></div>" +
      "<h3>Progress " + info("privacy") + '</h3><div class="list"><div class="item"><div class="txt"><b>Start over</b><small>Erases coins, upgrades, skins and trophies.</small></div>' + btn("wipe", null, "Erase", "small danger", "trash") + "</div></div>" +
      '<p class="sub"><a href="../">More things from nojukuramu</a></p></div>';
  },

  draft() {
    const g = data;
    let h = '<div class="draft"><h2>LEVEL UP!</h2><p class="sub">Pick one. ' + info("perks") + '</p><div class="cards">';
    g.draft.forEach((k, i) => {
      const p = PERKS[k], have = g.perks[k] || 0;
      h += '<button class="card" data-act="perk" data-arg="' + i + '" style="--i:' + i + '"><span class="ic">' + icon(p.icon) + "</span><b>" + p.name + "</b><small>" + p.line + "</small>" + (p.max > 1 ? '<span class="pips">' + Array.from({ length: p.max }, (_, j) => '<i class="' + (j < have ? "on" : j === have ? "new" : "") + '"></i>').join("") + "</span>" : "") + "</button>";
    });
    h += "</div>" + (g.rerolls > 0 ? btn("reroll", null, "Reroll", "small ghost", "dice") : "") + "</div>";
    return h;
  },

  pause() {
    const g = data;
    let perks = "";
    for (const k of Object.keys(g.perks)) perks += '<span class="perk">' + icon(PERKS[k].icon) + PERKS[k].name + (g.perks[k] > 1 ? " ×" + g.perks[k] : "") + "</span>";
    return '<div class="modal"><h2>Paused</h2>' +
      (g.mod ? '<p class="sub">' + esc(MODIFIERS[g.mod].name) + " — " + esc(MODIFIERS[g.mod].line) + "</p>" : "") +
      (perks ? '<div class="perks">' + perks + "</div>" : "") +
      '<div class="col">' + btn("resume", null, "Resume", "big primary", "play") + btn("restart", null, "Restart", "", "retry") + btn("quit", null, "Quit to title", "", "home") + "</div>" +
      '<div class="row">' + '<button class="ibtn' + (S.set.sound ? "" : " off") + '" data-act="toggle" data-arg="sound" aria-label="Sound">' + icon(S.set.sound ? "sound" : "mute") + "</button>" +
      '<button class="ibtn' + (S.set.music ? "" : " off") + '" data-act="toggle" data-arg="music" aria-label="Music">' + icon("music") + "</button>" + info("howto") + "</div></div>";
  },

  won() {
    const g = data.g, st = starsOf(g);
    let s = "";
    for (let i = 0; i < 3; i++) s += '<span class="star' + (i < st ? " on" : "") + '" style="--i:' + i + '">' + icon("star") + "</span>";
    return '<div class="modal result"><h2 class="win">LEVEL ' + g.level + "<br>CLEARED!</h2>" +
      '<div class="stars">' + s + "</div>" +
      '<div class="stats"><span><b>' + g.kills + "</b>popped</span><span><b>" + g.bestCombo + "</b>best combo</span><span><b>" + fmt(g.peakBalls) + "</b>most balls</span></div>" +
      '<div class="earn">' + icon("coin") + '<b id="earnTxt">' + fmt(g.coins) + "</b></div>" +
      '<div class="wheel" id="wheel"><span>×2</span><span>×3</span><span class="hot">×5</span><span>×3</span><span>×2</span><i id="needle"></i></div>' +
      '<div class="col">' + btn("stopWheel", null, "TAP TO MULTIPLY", "big primary pulse", null) + "</div>" + info("wheel") + "</div>";
  },

  lost() {
    const g = data.g, scored = g.mode !== "campaign";
    const best = scored ? (g.mode === "daily" ? S.best.daily[H.dailyInfo().key] || 0 : S.best.endless) : 0;
    return '<div class="modal result"><h2 class="lose">' + (scored ? "WAVE " + (g.wave + 1) : "OUT OF<br>HEARTS") + "</h2>" +
      (scored ? '<div class="score"><b>' + fmt(g.score) + "</b><small>" + (g.score >= best ? "new best!" : "best " + fmt(best)) + "</small></div>" : "") +
      '<div class="stats"><span><b>' + g.kills + "</b>popped</span><span><b>" + g.bestCombo + "</b>best combo</span><span><b>" + fmt(g.peakBalls) + "</b>most balls</span></div>" +
      '<div class="earn">' + icon("coin") + "<b>" + fmt(g.coins) + "</b></div>" +
      '<div class="col">' +
        (!g.revived ? btn("revive", null, "Revive — free", "big primary pulse", "heart") + '<p class="sub small">No video. Just get back up. ' + info("revive") + "</p>" : "") +
        btn("restart", null, scored ? "Again" : "Retry", "", "retry") + btn("quit", null, "Title", "", "home") +
      "</div></div>";
  }
};

export function show(name, d) {
  current = name; data = d || data;
  cancelAnimationFrame(wheelRAF);
  const el = $("screen");
  el.innerHTML = VIEWS[name]();
  el.hidden = false;
  el.className = "s-" + name;
  hydrateIcons(el);
  if (name === "won") spinWheel();
  if (name === "skins") H.preview && H.preview($("skinPreview"));
}
export function hide() { current = null; cancelAnimationFrame(wheelRAF); const el = $("screen"); el.hidden = true; el.innerHTML = ""; }

/* ---------- the bonus wheel: the needle sweeps, a tap stops it ---------- */
const SEG = [2, 3, 5, 3, 2];
let needleAt = 0;
function spinWheel() {
  const t0 = performance.now(), needle = $("needle");
  const tick = (now) => {
    const t = (now - t0) / 1000;
    needleAt = (Math.sin(t * 3.1) + 1) / 2;
    if (needle) needle.style.left = (needleAt * 100) + "%";
    const g = data && data.g;
    if (g) { const m = SEG[Math.min(4, Math.floor(needleAt * 5))], e = $("earnTxt"); if (e) e.textContent = fmt(g.coins * m); }
    wheelRAF = requestAnimationFrame(tick);
  };
  wheelRAF = requestAnimationFrame(tick);
}

/* ---------- actions ---------- */
const ACTS = {
  play: (mode) => H.start(mode),
  go: (name) => { audio.sfx.click(); show(name); },
  home: () => { audio.sfx.click(); show("title"); },
  buy: (id) => {
    const lv = S.upg[id] | 0, cost = upgradeCost(id, lv);
    if (lv >= UPGRADES[id].max || cost > S.coins) { audio.sfx.nope(); return; }
    S.coins -= cost; S.spent += cost; S.upg[id] = lv + 1;
    audio.sfx.buy(); H.haptic(15);
    H.checkAch(); save(); show("shop");
  },
  skin: (arg) => {
    const [kind, id] = arg.split(":");
    const table = kind === "cannon" ? CANNONS : BALLS, o = table[id];
    const owned = kind === "cannon" ? S.owned.cannons : S.owned.balls;
    if (!owned.includes(id)) {
      if (o.ach) { if (!S.ach[o.ach]) { audio.sfx.nope(); toast("Earned with the trophy <b>" + ACH[o.ach].name + "</b>."); return; } }
      else if (o.cost > S.coins) { audio.sfx.nope(); return; }
      else { S.coins -= o.cost; S.spent += o.cost; }
      owned.push(id); audio.sfx.buy();
    } else audio.sfx.click();
    if (kind === "cannon") S.cannon = id; else S.ball = id;
    H.skins(); H.checkAch(); save(); show("skins");
  },
  toggle: (k) => { S.set[k] = !S.set[k]; save(); H.applySettings(); audio.sfx.click(); show(current, data); },
  wipe: () => { if (!window.confirm("Erase everything — coins, upgrades, skins, trophies — and start over?")) return; wipe(); save(); H.applySettings(); H.skins(); show("title"); },
  updCheck: () => { const st = $("updState"); if (st) st.textContent = "Checking…"; upd.checkNow().then((r) => { const s2 = $("updState"); if (s2) s2.textContent = r === "ready" ? "A new version is ready." : r === "current" ? "You are up to date." : r === "downloading" ? "Downloading a new version…" : r === "offline" ? "Offline: could not check." : "Updates need the installed app."; }); },
  updApply: () => upd.apply(),
  perk: (i) => H.perk(+i),
  reroll: () => H.reroll(),
  resume: () => H.resume(),
  restart: () => H.restart(),
  quit: () => H.quit(),
  revive: () => H.revive(),
  stopWheel: (arg, b) => {
    cancelAnimationFrame(wheelRAF);
    const m = SEG[Math.min(4, Math.floor(needleAt * 5))];
    b.disabled = true;
    b.querySelector("span").textContent = "×" + m + "!";
    b.classList.remove("pulse");
    H.collect(m);
    const col = b.parentNode;
    col.insertAdjacentHTML("beforeend", btn("next", null, "NEXT LEVEL", "big primary", "next") + btn("quit", null, "Title", "", "home"));
    hydrateIcons(col);
  },
  next: () => H.start("campaign")
};

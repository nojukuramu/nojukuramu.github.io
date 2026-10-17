/* render.js — the field, drawn on one 2D canvas every frame.
 *
 * Juice is most of this file. The design write-ups are unanimous that the
 * feel of a hypercasual game is layers of small animation and sound on top
 * of a mechanic that already works, so nothing here changes a number: it
 * only reads the state and the events sim.js leaves behind and turns them
 * into pops, rings, shakes, floating numbers and coins.
 *
 * Balls are the hot path — up to six hundred a frame — so each look is drawn
 * once into a small sprite and stamped with drawImage. A heavy ball (weight
 * above 1, see sim.js) is drawn a little larger, so a stream that has gone
 * past the object cap still looks like it is getting bigger. */

import { W, H, CANNON_Y, LINE_Y, BALL_FX } from "./sim.js";
import { ENEMY, GATE, PICKUP, DROP, CANNONS, BALLS, WORLDS } from "./data.js";

let cv = null, ctx = null, dpr = 1, scale = 1, ox = 0, oy = 0, vw = 0, vh = 0;
const parts = [], texts = [], rings = [], arcs = [], flyers = [];
let shake = 0, flash = 0, flashColor = "#fff", motion = true, comboShow = 0, comboN = 0, banner = null, gridT = 0;
let cannonSkin = CANNONS.classic, ballSkin = BALLS.classic;
const sprites = new Map();

export function init(canvas) {
  cv = canvas; ctx = cv.getContext("2d");
  resize();
  window.addEventListener("resize", resize);
}
export function resize() {
  if (!cv) return;
  dpr = Math.min(2, window.devicePixelRatio || 1);
  vw = window.innerWidth; vh = window.innerHeight;
  cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
  cv.style.width = vw + "px"; cv.style.height = vh + "px";
  scale = Math.min(vw / W, vh / H);
  ox = (vw - W * scale) / 2;
  oy = Math.max(0, vh - H * scale);
}
export function toWorld(px, py) { return { x: (px - ox) / scale, y: (py - oy) / scale }; }
export function toScreen(x, y) { return { x: ox + x * scale, y: oy + y * scale }; }
export function setMotion(v) { motion = !!v; }
export function setSkins(cid, bid) {
  cannonSkin = CANNONS[cid] || CANNONS.classic;
  ballSkin = BALLS[bid] || BALLS.classic;
  sprites.clear();
}
export function clear() { parts.length = texts.length = rings.length = arcs.length = flyers.length = 0; shake = flash = 0; banner = null; comboShow = 0; }

export function fmt(n) {
  n = Math.max(0, n);
  if (n < 10 && n % 1) return n.toFixed(1).replace(/\.0$/, "");
  if (n < 1000) return String(Math.ceil(n));
  const u = ["K", "M", "B", "T", "Qa", "Qi", "Sx", "Sp"];
  let i = -1;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return (n < 10 ? n.toFixed(1).replace(/\.0$/, "") : Math.floor(n)) + u[i];
}

/* ---------- sprites ---------- */
function ballSprite(fx, hue) {
  const key = fx + "|" + hue;
  let s = sprites.get(key);
  if (s) return s;
  const R = 16, c = document.createElement("canvas");
  c.width = c.height = R * 2;
  const x = c.getContext("2d");
  let fill = ballSkin.fill, glow = ballSkin.glow;
  if (fill === "rainbow") { fill = "hsl(" + hue + ",95%,70%)"; glow = "hsl(" + hue + ",95%,60%)"; }
  if (fx & BALL_FX.FIRE) { fill = "#ffcf5a"; glow = "#ff4d1a"; }
  else if (fx & BALL_FX.GOLD) { fill = "#ffe680"; glow = "#ffb300"; }
  else if (fx & BALL_FX.ICE) { fill = "#e8fbff"; glow = "#5fd4ff"; }
  const gr = x.createRadialGradient(R, R, 2, R, R, R);
  gr.addColorStop(0, glow); gr.addColorStop(1, "rgba(0,0,0,0)");
  x.globalAlpha = 0.55; x.fillStyle = gr; x.fillRect(0, 0, R * 2, R * 2);
  x.globalAlpha = 1;
  x.fillStyle = fill; x.beginPath(); x.arc(R, R, 5.2, 0, 6.283); x.fill();
  x.fillStyle = "rgba(255,255,255,.85)"; x.beginPath(); x.arc(R - 1.6, R - 1.8, 1.7, 0, 6.283); x.fill();
  if (ballSkin.eye && !fx) {
    x.fillStyle = "#3a8cff"; x.beginPath(); x.arc(R, R - 1, 2.6, 0, 6.283); x.fill();
    x.fillStyle = "#111"; x.beginPath(); x.arc(R, R - 1, 1.3, 0, 6.283); x.fill();
  }
  sprites.set(key, c);
  return c;
}

/* ---------- events into juice ---------- */
function burst(x, y, color, n, speed, size) {
  if (parts.length > 700) return;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, v = speed * (0.4 + Math.random() * 0.8);
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3, life: 0, max: 0.4 + Math.random() * 0.5, size: size * (0.6 + Math.random() * 0.8), color });
  }
}
function pop(x, y, text, color, size, life) {
  if (texts.length > 80) texts.shift();
  const t = { x, y, vy: -46, life: 0, max: life || 0.8, text, color: color || "#fff", size: size || 16 };
  texts.push(t);
  return t;
}
export function say(text, sub, color) { banner = { text, sub: sub || "", color: color || "#fff", life: 0, max: 1.8 }; }
export function kick(n) { if (motion) shake = Math.max(shake, n); }

export function feed(events, g) {
  for (const e of events) {
    switch (e.type) {
      case "hit": {
        const big = e.crit;
        let t = null;
        for (let i = texts.length - 1; i >= 0 && i >= texts.length - 24; i--) if (texts[i].id === e.id && texts[i].life < 0.25 && !texts[i].crit) { t = texts[i]; break; }
        if (t && !big) { t.sum += e.d; t.text = fmt(t.sum); t.life = Math.min(t.life, 0.1); t.size = Math.min(26, 13 + Math.log10(1 + t.sum) * 2.5); }
        else { t = pop(e.x + (Math.random() - 0.5) * 16, e.y, fmt(e.d), big ? "#ffd23f" : "#fff", big ? 20 : 13, big ? 0.9 : 0.6); t.id = e.id; t.sum = e.d; t.crit = big; }
        break;
      }
      case "kill": {
        burst(e.x, e.y, e.color, e.boss ? 60 : 12 + Math.min(10, e.r / 2), e.boss ? 380 : 190, e.boss ? 7 : 4);
        rings.push({ x: e.x, y: e.y, r: e.r, max: e.r * (e.boss ? 5 : 2.6), life: 0, dur: e.boss ? 0.7 : 0.32, color: e.color });
        for (let i = 0; i < Math.min(6, Math.ceil(e.coins / 3)); i++) flyers.push({ x: e.x, y: e.y, vx: (Math.random() - 0.5) * 160, vy: -120 - Math.random() * 120, life: 0 });
        if (e.combo >= 5 && e.combo % 5 === 0) { comboN = e.combo; comboShow = 1; }
        kick(e.boss ? 16 : 1.4);
        break;
      }
      case "boom": burst(e.x, e.y, "#ff8a3d", 18, 240, 5); rings.push({ x: e.x, y: e.y, r: 8, max: e.r, life: 0, dur: 0.35, color: "#ffb36b", fill: true }); kick(5); break;
      case "split": burst(e.x, e.y, e.color, 40, 300, 6); kick(10); say("IT SPLIT!", "", e.color); break;
      case "gate": if (Math.random() < 0.35 && (e.op === "mul" || e.op === "charge") && e.v > 1) pop(e.x + (Math.random() - 0.5) * 40, e.y - 12, "×" + e.v, GATE.mul.color, 14, 0.5); break;
      case "gateUp": pop(e.x, e.y - 18, "×" + e.v + "!", "#7fd0ff", 22, 1); burst(e.x, e.y, "#7fd0ff", 14, 160, 3); break;
      case "reveal": pop(e.x, e.y - 20, e.op === "mul" ? "×" + e.v + (e.v >= 10 ? " JACKPOT!" : "!") : e.op === "div" ? "÷" + e.v + " oops" : e.op.toUpperCase() + "!", e.v >= 10 ? "#ffd23f" : "#e0b8ff", e.v >= 10 ? 26 : 20, 1.3); burst(e.x, e.y, "#c58bff", 20, 200, 4); if (e.v >= 10) { flash = 0.5; flashColor = "#ffd23f"; kick(8); } break;
      case "flip": pop(e.x, e.y, "FLIPPED!", "#7fd0ff", 22, 1.1); burst(e.x, e.y + 18, "#7fd0ff", 24, 200, 4); break;
      case "pickup": pop(e.x, CANNON_Y - 70, (e.v > 0 ? "+" : "") + Math.round(e.v) + (PICKUP[e.stat].unit) + " " + PICKUP[e.stat].label, e.good ? "#7fd0ff" : "#ff6b7a", 22, 1.3); if (e.good) burst(e.x, CANNON_Y - 40, "#7fd0ff", 26, 220, 4); else kick(6); break;
      case "breach": kick(12); flash = 0.4; flashColor = "#ff2040"; pop(e.x, e.y - 10, "-" + e.harm, "#ff4d5e", 24, 1); break;
      case "escape": pop(e.x, e.y - 10, "it got away", "#ffd23f", 13, 1); break;
      case "fever": say("FEVER!", "double fire rate", "#ff5df0"); flash = 0.35; flashColor = "#ff5df0"; kick(6); break;
      case "boss": say("BOSS", g.enemies.length ? g.enemies[g.enemies.length - 1].name : "", "#ff4d6d"); kick(8); break;
      case "bossDown": say("BOSS DOWN!", "", "#ffd23f"); flash = 0.7; flashColor = "#fff"; break;
      case "wall": pop(e.x, e.y + 60, "WALL!", "#a58cff", 22, 1); break;
      case "curse": pop(e.x, e.y - 20, "CURSED", "#ff6bd2", 20, 1.2); burst(e.x, e.y, "#ff6bd2", 20, 160, 4); break;
      case "uncurse": pop(e.x, e.y - 20, "back to normal", "#9cff6b", 13, 1); break;
      case "heal": rings.push({ x: e.x, y: e.y, r: 10, max: 90, life: 0, dur: 0.6, color: "#9cff6b" }); break;
      case "shieldBreak": pop(e.x, e.y - 20, "SHIELD BROKEN", "#62c7ff", 14, 0.9); burst(e.x, e.y + 10, "#cfe9ff", 12, 180, 3); break;
      case "catch": pop(e.x, CANNON_Y - 60, DROP[e.kind].name.toUpperCase() + "!", DROP[e.kind].color, 20, 1.1); burst(e.x, CANNON_Y - 20, DROP[e.kind].color, 20, 200, 4); break;
      case "bomb": flash = 0.6; flashColor = "#ffb36b"; kick(14); for (let i = 0; i < 6; i++) rings.push({ x: Math.random() * W, y: 100 + Math.random() * 400, r: 10, max: 120, life: -i * 0.05, dur: 0.5, color: "#ff8a3d", fill: true }); break;
      case "arc": arcs.push({ pts: e.pts, life: 0 }); break;
      case "wave": if (e.n > 1) say(e.of ? "WAVE " + e.n + " / " + e.of : "WAVE " + e.n, "", "#fff"); break;
      case "won": say("CLEARED!", "", "#9cff6b"); break;
      case "revive": say("BACK IN IT", "", "#9cff6b"); flash = 0.4; flashColor = "#9cff6b"; break;
      case "perk": break;
    }
  }
}

/* ---------- drawing ---------- */
function rr(x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

function drawBackground(g, dt) {
  const wd = WORLDS[Math.floor(((g ? (g.mode === "campaign" ? g.level : 1 + Math.floor(g.wave / 5) * 5) : 1) - 1) / 5) % WORLDS.length];
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bg = ctx.createLinearGradient(0, 0, 0, vh);
  bg.addColorStop(0, wd.top); bg.addColorStop(1, wd.bot);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, vw, vh);
  return wd;
}

function drawField(g, wd, dt) {
  // the floor: lines rolling toward you, so a still cannon still feels fast
  gridT = (gridT + dt * (g && g.feverT > 0 ? 140 : 46)) % 48;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  ctx.globalAlpha = 0.16; ctx.strokeStyle = wd.grid; ctx.lineWidth = 1;
  for (let y = -48 + gridT; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  for (let x = 0; x <= W; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(W / 2 + (x - W / 2) * 1.25, H); ctx.stroke(); }
  ctx.globalAlpha = 1;
  ctx.restore();
  // walls
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fillRect(-12, 0, 12, H); ctx.fillRect(W, 0, 12, H);
  ctx.fillStyle = wd.grid; ctx.globalAlpha = 0.5;
  ctx.fillRect(-2, 0, 2, H); ctx.fillRect(W, 0, 2, H);
  ctx.globalAlpha = 1;
  // the line the horde must not cross
  let danger = 0;
  if (g) for (const e of g.enemies) danger = Math.max(danger, 1 - (LINE_Y - e.y) / 120);
  danger = Math.max(0, Math.min(1, danger));
  ctx.save();
  ctx.strokeStyle = wd.line; ctx.lineWidth = 2 + danger * 2;
  ctx.globalAlpha = 0.45 + danger * 0.5 * (0.6 + 0.4 * Math.sin(performance.now() / 90));
  ctx.setLineDash([10, 8]); ctx.lineDashOffset = -performance.now() / 40;
  ctx.beginPath(); ctx.moveTo(0, LINE_Y); ctx.lineTo(W, LINE_Y); ctx.stroke();
  ctx.setLineDash([]);
  if (danger > 0) { const gr = ctx.createLinearGradient(0, LINE_Y - 60, 0, LINE_Y); gr.addColorStop(0, "rgba(255,0,40,0)"); gr.addColorStop(1, "rgba(255,0,40," + (0.25 * danger) + ")"); ctx.fillStyle = gr; ctx.globalAlpha = 1; ctx.fillRect(0, LINE_Y - 60, W, 60); }
  ctx.restore();
}

function gateLabel(gt) {
  switch (gt.op) {
    case "mul": return "×" + gt.v;
    case "charge": return "×" + gt.v;
    case "div": return "÷" + gt.v;
    case "mystery": return "?";
    case "fire": return "FIRE";
    case "gold": return "GOLD";
    case "big": return "BIG";
    case "ice": return "ICE";
  }
  return "";
}

function drawGates(g) {
  for (const gt of g.gates) {
    const age = g.t - gt.born, k = Math.min(1, age / 0.35);
    const pop = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.25 : 1;
    const def = GATE[gt.op] || GATE.mul;
    let color = gt.op === "mul" && gt.v <= 1 ? "#8a8fa8" : def.color;
    if (gt.cursed > 0) color = "#ff4dd2";
    const w = gt.w * k * pop, h = 30 * pop, x = gt.x - w / 2, y = gt.y - h / 2;
    ctx.save();
    ctx.globalAlpha = k;
    // posts
    ctx.fillStyle = "rgba(0,0,0,.4)";
    ctx.fillRect(x - 5, y - 4, 5, h + 8); ctx.fillRect(x + w, y - 4, 5, h + 8);
    // glass
    ctx.fillStyle = color; ctx.globalAlpha = k * (0.28 + (gt.flash > 0 ? 0.35 : 0));
    rr(x, y, w, h, 7); ctx.fill();
    ctx.globalAlpha = k; ctx.strokeStyle = color; ctx.lineWidth = 2.5; ctx.stroke();
    // shine
    ctx.globalAlpha = k * 0.25; ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.moveTo(x + w * 0.1, y + 3); ctx.lineTo(x + w * 0.22, y + 3); ctx.lineTo(x + w * 0.14, y + h - 3); ctx.lineTo(x + w * 0.02, y + h - 3); ctx.fill();
    if (gt.op === "charge" && gt.v < 6) {
      const p = (gt.charge % gt.need) / gt.need;
      ctx.globalAlpha = k * 0.6; ctx.fillStyle = "#bfe4ff";
      rr(x + 4, y + h - 6, (w - 8) * p, 3, 2); ctx.fill();
    }
    ctx.globalAlpha = k;
    ctx.font = "900 " + Math.round(18 * pop) + "px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.55)";
    const label = gateLabel(gt);
    ctx.strokeText(label, gt.x, gt.y + 1);
    ctx.fillStyle = "#fff"; ctx.fillText(label, gt.x, gt.y + 1);
    ctx.restore();
  }
}

function drawPickups(g) {
  for (const p of g.pickups) {
    for (const pan of p.panels) {
      const good = pan.v >= 0, col = good ? "#3fa9ff" : "#ff4d5e";
      const x = pan.x0 + 4, w = pan.x1 - pan.x0 - 8;
      ctx.save();
      ctx.globalAlpha = 0.32 + (pan.flash > 0 ? 0.3 : 0);
      ctx.fillStyle = col; rr(x, p.y, w, p.h, 8); ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke();
      const P = PICKUP[pan.stat];
      const v = pan.stat === "volley" ? Math.round(pan.v) : Math.round(pan.v);
      ctx.font = "900 17px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const label = (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v) + P.unit + " " + P.label;
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.strokeText(label, x + w / 2, p.y + p.h / 2 + 1);
      ctx.fillStyle = "#fff"; ctx.fillText(label, x + w / 2, p.y + p.h / 2 + 1);
      ctx.restore();
    }
    // a downward chevron says "this is coming to you"
    ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2 - 7, p.y + p.h + 4); ctx.lineTo(W / 2, p.y + p.h + 10); ctx.lineTo(W / 2 + 7, p.y + p.h + 4); ctx.stroke(); ctx.restore();
  }
}

function drawEnemy(g, e) {
  const E = ENEMY[e.kind] || {};
  const color = e.color || E.color;
  const wob = motion ? Math.sin(g.t * 9 + e.id) * 0.06 : 0;
  const sx = e.r * (1 + wob), sy = e.r * (1 - wob);
  ctx.save();
  ctx.translate(e.x, e.y);
  // shadow
  ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(0, e.r * 0.85, e.r * 0.9, e.r * 0.3, 0, 0, 6.283); ctx.fill();
  // body
  const gr = ctx.createRadialGradient(-e.r * 0.35, -e.r * 0.45, e.r * 0.1, 0, 0, e.r);
  gr.addColorStop(0, "#fff"); gr.addColorStop(0.18, color); gr.addColorStop(1, shade(color, -0.35));
  ctx.fillStyle = e.flash > 0 ? "#fff" : gr;
  ctx.beginPath(); ctx.ellipse(0, 0, sx, sy, 0, 0, 6.283); ctx.fill();
  if (e.kind === "tank") { ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.ellipse(0, -e.r * 0.55, e.r * 0.85, e.r * 0.42, 0, Math.PI, 0); ctx.fill(); }
  if (e.kind === "bomber") { ctx.strokeStyle = "#ffd23f"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -e.r); ctx.quadraticCurveTo(5, -e.r - 6, 2, -e.r - 10); ctx.stroke(); ctx.fillStyle = Math.sin(g.t * 20) > 0 ? "#fff" : "#ff3d1a"; ctx.beginPath(); ctx.arc(2, -e.r - 10, 2.5, 0, 6.283); ctx.fill(); }
  if (e.kind === "healer") { ctx.fillStyle = "#fff"; ctx.fillRect(-2, -e.r - 8, 4, 10); ctx.fillRect(-5, -e.r - 5, 10, 4); }
  if (e.kind === "gold") { ctx.globalAlpha = 0.6 + 0.4 * Math.sin(g.t * 8); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(e.r * 0.4, -e.r * 0.4, 2, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1; }
  if (e.boss) drawCrown(e);
  // eyes, looking at the cannon
  const cx = g.cannon.x - e.x, cy = CANNON_Y - e.y, cl = Math.hypot(cx, cy) || 1;
  const ex = cx / cl, ey = cy / cl, es = Math.max(2.4, e.r * 0.22);
  const blink = ((g.t + e.id * 0.37) % 3.2) < 0.12;
  for (const s of [-1, 1]) {
    const px = s * e.r * 0.34, py = -e.r * 0.12;
    ctx.fillStyle = "#fff";
    if (blink) ctx.fillRect(px - es, py, es * 2, 1.6);
    else {
      ctx.beginPath(); ctx.arc(px, py, es, 0, 6.283); ctx.fill();
      ctx.fillStyle = "#16121f"; ctx.beginPath(); ctx.arc(px + ex * es * 0.45, py + ey * es * 0.45, es * 0.55, 0, 6.283); ctx.fill();
    }
  }
  if (e.boss && e.hp < e.maxHp * 0.5) { ctx.strokeStyle = "#16121f"; ctx.lineWidth = 3; for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(s * e.r * 0.15, -e.r * 0.32); ctx.lineTo(s * e.r * 0.55, -e.r * 0.42); ctx.stroke(); } }
  // shield plate
  if (e.armor > 0) {
    ctx.fillStyle = "#cfe0f0"; ctx.strokeStyle = "#5c7a99"; ctx.lineWidth = 2;
    rr(-e.r * 0.95, e.r * 0.35, e.r * 1.9, e.r * 0.6, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#2a3a50"; ctx.font = "800 " + Math.max(9, Math.round(e.r * 0.5)) + "px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(e.armor, 0, e.r * 0.66);
  }
  if (e.frozen > 0 || g.temp.freeze > 0) { ctx.globalAlpha = 0.45; ctx.fillStyle = "#bff0ff"; ctx.beginPath(); ctx.ellipse(0, 0, sx + 2, sy + 2, 0, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1; }
  // health
  if (!e.boss) {
    // health is a whole number, always: "3.6" on a blob reads as a bug
    ctx.font = "900 " + Math.max(10, Math.round(e.r * 0.62)) + "px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.6)";
    const hp = fmt(Math.ceil(e.hp)), hy = e.armor > 0 ? -e.r - 7 : e.r * 0.42;
    ctx.strokeText(hp, 0, hy);
    ctx.fillStyle = "#fff"; ctx.fillText(hp, 0, hy);
  }
  ctx.restore();
}
function drawCrown(e) {
  ctx.fillStyle = "#ffd23f"; ctx.strokeStyle = "#a8780a"; ctx.lineWidth = 2;
  const r = e.r;
  ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.82); ctx.lineTo(-r * 0.55, -r * 1.25); ctx.lineTo(-r * 0.25, -r * 1.0); ctx.lineTo(0, -r * 1.35); ctx.lineTo(r * 0.25, -r * 1.0); ctx.lineTo(r * 0.55, -r * 1.25); ctx.lineTo(r * 0.5, -r * 0.82); ctx.closePath(); ctx.fill(); ctx.stroke();
}
function shade(hex, k) {
  const h = hex.replace("#", "");
  const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return "rgb(" + c.map((v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)).join(",") + ")";
}

function drawBalls(g) {
  const many = g.balls.length > 260;
  const hueBase = (performance.now() / 8) % 360;
  if (!many && motion) {
    ctx.save(); ctx.globalAlpha = 0.25; ctx.lineCap = "round";
    ctx.strokeStyle = ballSkin.fill === "rainbow" ? "#fff" : ballSkin.glow;
    for (const b of g.balls) { ctx.lineWidth = b.r * 1.2; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.022, b.y - b.vy * 0.022); ctx.stroke(); }
    ctx.restore();
  }
  for (let i = 0; i < g.balls.length; i++) {
    const b = g.balls[i];
    const hue = ballSkin.fill === "rainbow" ? Math.round(((hueBase + i * 7) % 360) / 30) * 30 : 0;
    const spr = ballSprite(b.fx, hue);
    const r = b.r * (1 + Math.min(1.6, Math.log10(Math.max(1, b.n)) * 0.45)) * (g.temp.mega > 0 ? 1.4 : 1);
    const s = (r / 5.2) * 16;
    ctx.drawImage(spr, b.x - s, b.y - s, s * 2, s * 2);
  }
}

function drawCannon(g, x, ghost) {
  const c = g.cannon, sk = cannonSkin;
  const trim = sk.trim === "rainbow" ? "hsl(" + ((performance.now() / 6) % 360) + ",90%,62%)" : sk.trim;
  ctx.save();
  ctx.translate(x, CANNON_Y);
  if (ghost) ctx.globalAlpha = 0.4;
  ctx.rotate(c.tilt * 0.12);
  const rec = c.recoil * 6;
  // barrels
  const barrels = g.temp.twin > 0 ? [-20, 0, 20] : [0];
  for (const bx of barrels) {
    const bw = 16 + Math.min(10, g.s.volley * 1.5);
    ctx.fillStyle = sk.body; rr(bx - bw / 2, -40 + rec, bw, 34, 6); ctx.fill();
    ctx.fillStyle = trim; rr(bx - bw / 2 - 2, -44 + rec, bw + 4, 8, 3); ctx.fill();
  }
  // body
  ctx.fillStyle = sk.body; rr(-30, -14, 60, 26, 12); ctx.fill();
  ctx.strokeStyle = trim; ctx.lineWidth = 3; ctx.stroke();
  // wheels
  for (const s of [-1, 1]) {
    ctx.fillStyle = "#14121c"; ctx.beginPath(); ctx.arc(s * 20, 12, 10, 0, 6.283); ctx.fill();
    ctx.strokeStyle = trim; ctx.lineWidth = 2; ctx.beginPath();
    const a = c.x / 10;
    ctx.moveTo(s * 20 + Math.cos(a) * 7, 12 + Math.sin(a) * 7); ctx.lineTo(s * 20 - Math.cos(a) * 7, 12 - Math.sin(a) * 7); ctx.stroke();
  }
  // a muzzle flash on the frame it fired
  if (c.recoil > 0.75 && motion) { ctx.fillStyle = "rgba(255,240,180,.85)"; ctx.beginPath(); ctx.arc(0, -48, 7 * c.recoil, 0, 6.283); ctx.fill(); }
  ctx.restore();
}

function drawDrops(g) {
  for (const d of g.drops) {
    const D = DROP[d.kind];
    ctx.save(); ctx.translate(d.x, d.y);
    const pulse = 1 + Math.sin(g.t * 10 + d.id) * 0.08;
    ctx.scale(pulse, pulse);
    ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.beginPath(); ctx.arc(0, 2, 14, 0, 6.283); ctx.fill();
    ctx.fillStyle = D.color; ctx.beginPath(); ctx.arc(0, 0, 13, 0, 6.283); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#1a1626"; ctx.strokeStyle = "#1a1626"; ctx.lineWidth = 2.2;
    glyph(d.kind);
    ctx.restore();
  }
}
function glyph(kind) {
  ctx.beginPath();
  if (kind === "rapid") { ctx.moveTo(2, -8); ctx.lineTo(-5, 1); ctx.lineTo(0, 1); ctx.lineTo(-2, 8); ctx.lineTo(5, -1); ctx.lineTo(0, -1); ctx.closePath(); ctx.fill(); }
  else if (kind === "mega") { ctx.arc(0, 0, 6, 0, 6.283); ctx.fill(); }
  else if (kind === "twin") { for (const x of [-5, 0, 5]) ctx.fillRect(x - 1.5, -7, 3, 12); }
  else if (kind === "freeze") { for (let i = 0; i < 3; i++) { const a = i * Math.PI / 3; ctx.moveTo(Math.cos(a) * 7, Math.sin(a) * 7); ctx.lineTo(-Math.cos(a) * 7, -Math.sin(a) * 7); } ctx.stroke(); }
  else if (kind === "bomb") { ctx.arc(-1, 2, 6, 0, 6.283); ctx.fill(); ctx.beginPath(); ctx.moveTo(3, -3); ctx.lineTo(6, -7); ctx.stroke(); }
  else if (kind === "heart") { ctx.moveTo(0, 6); ctx.bezierCurveTo(-9, -1, -5, -9, 0, -4); ctx.bezierCurveTo(5, -9, 9, -1, 0, 6); ctx.fill(); }
}

function drawFx(dt) {
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.life += dt;
    if (r.life < 0) continue;
    const k = r.life / r.dur;
    if (k >= 1) { rings.splice(i, 1); continue; }
    ctx.globalAlpha = (1 - k) * (r.fill ? 0.45 : 0.8);
    const rad = r.r + (r.max - r.r) * (1 - Math.pow(1 - k, 3));
    ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, 6.283);
    if (r.fill) { ctx.fillStyle = r.color; ctx.fill(); } else { ctx.strokeStyle = r.color; ctx.lineWidth = 3 * (1 - k) + 1; ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life += dt;
    if (p.life >= p.max) { parts.splice(i, 1); continue; }
    p.vy += 420 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.98;
    ctx.globalAlpha = 1 - p.life / p.max;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
  // coins fly up to the counter
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i]; f.life += dt;
    if (f.life > 0.9) { flyers.splice(i, 1); continue; }
    if (f.life > 0.25) { f.vx += (W - 30 - f.x) * dt * 9; f.vy += (-30 - f.y) * dt * 9; }
    f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.92; f.vy *= 0.92;
    ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.ellipse(f.x, f.y, 4 * Math.abs(Math.cos(f.life * 14)) + 1, 4, 0, 0, 6.283); ctx.fill();
  }
  for (let i = arcs.length - 1; i >= 0; i--) {
    const a = arcs[i]; a.life += dt;
    if (a.life > 0.18) { arcs.splice(i, 1); continue; }
    ctx.strokeStyle = "#cfe9ff"; ctx.lineWidth = 2; ctx.globalAlpha = 1 - a.life / 0.18;
    ctx.beginPath();
    for (let j = 0; j < a.pts.length - 1; j++) {
      const [x0, y0] = a.pts[0], [x1, y1] = a.pts[j + 1];
      ctx.moveTo(x0, y0);
      for (let s = 1; s <= 4; s++) ctx.lineTo(x0 + (x1 - x0) * s / 4 + (s < 4 ? (Math.random() - 0.5) * 14 : 0), y0 + (y1 - y0) * s / 4 + (s < 4 ? (Math.random() - 0.5) * 14 : 0));
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i]; t.life += dt;
    if (t.life >= t.max) { texts.splice(i, 1); continue; }
    t.y += t.vy * dt; t.vy *= 0.94;
    const k = t.life / t.max, popk = t.life < 0.1 ? 1 + (1 - t.life / 0.1) * 0.5 : 1;
    ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
    ctx.font = "900 " + Math.round(t.size * popk) + "px system-ui, sans-serif";
    ctx.lineWidth = 4; ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

function drawBossBar(g) {
  const bosses = g.enemies.filter((e) => e.boss);
  if (!bosses.length) return;
  let hp = 0, max = 0;
  for (const b of bosses) { hp += Math.max(0, b.hp); max += b.maxHp; }
  const name = bosses[0].name;
  const x = 40, y = 64, w = W - 80;
  ctx.fillStyle = "rgba(0,0,0,.55)"; rr(x - 2, y - 2, w + 4, 14, 7); ctx.fill();
  ctx.fillStyle = bosses[0].color; rr(x, y, Math.max(0, w * hp / max), 10, 5); ctx.fill();
  ctx.font = "800 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillStyle = "#fff"; ctx.fillText(name + "  " + fmt(hp), W / 2, y - 3);
}

function drawOverlays(g, dt) {
  // combo
  if (comboShow > 0) {
    comboShow -= dt * 0.9;
    const k = Math.max(0, comboShow);
    ctx.save(); ctx.globalAlpha = Math.min(1, k * 2);
    ctx.translate(W / 2, 140); const s = 1 + (1 - k) * 0.15 + (k > 0.9 ? (k - 0.9) * 4 : 0); ctx.scale(s, s);
    ctx.font = "italic 900 30px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 6; ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.strokeText(comboN + " COMBO", 0, 0);
    ctx.fillStyle = comboN >= 50 ? "#ff5df0" : comboN >= 20 ? "#ffd23f" : "#fff"; ctx.fillText(comboN + " COMBO", 0, 0);
    ctx.restore();
  }
  if (banner) {
    banner.life += dt;
    const k = banner.life / banner.max;
    if (k >= 1) banner = null;
    else {
      const inK = Math.min(1, banner.life / 0.18), out = k > 0.8 ? (1 - k) / 0.2 : 1;
      ctx.save(); ctx.globalAlpha = out; ctx.translate(W / 2, 250);
      const s = inK < 1 ? 2.2 - 1.2 * inK : 1; ctx.scale(s, s);
      ctx.font = "italic 900 46px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = 8; ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.strokeText(banner.text, 0, 0);
      ctx.fillStyle = banner.color; ctx.fillText(banner.text, 0, 0);
      if (banner.sub) { ctx.font = "800 16px system-ui, sans-serif"; ctx.lineWidth = 4; ctx.strokeText(banner.sub, 0, 36); ctx.fillStyle = "#fff"; ctx.fillText(banner.sub, 0, 36); }
      ctx.restore();
    }
  }
}

/* ---------- a frame ---------- */
export function draw(g, dt) {
  if (!ctx) return;
  const wd = drawBackground(g, dt);
  let sx = 0, sy = 0;
  if (shake > 0) { sx = (Math.random() - 0.5) * shake; sy = (Math.random() - 0.5) * shake; shake = Math.max(0, shake - dt * 40); }
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (ox + sx) * dpr, (oy + sy) * dpr);
  drawField(g, wd, dt);
  if (g) {
    drawGates(g);
    drawPickups(g);
    for (const e of g.enemies) drawEnemy(g, e);
    drawBalls(g);
    drawDrops(g);
    if (g.s.mirror && Math.abs(W - 2 * g.cannon.x) > 24) drawCannon(g, W - g.cannon.x, true);
    drawCannon(g, g.cannon.x, false);
    drawFx(dt);
    drawBossBar(g);
    drawOverlays(g, dt);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // fever: a rainbow rim; freeze: a cold wash; a flash for the big moments
  if (g && g.feverT > 0) {
    const hue = (performance.now() / 4) % 360;
    ctx.strokeStyle = "hsl(" + hue + ",100%,62%)"; ctx.lineWidth = 8; ctx.globalAlpha = 0.6 + 0.3 * Math.sin(performance.now() / 70);
    ctx.strokeRect(4, 4, vw - 8, vh - 8); ctx.globalAlpha = 1;
  }
  if (g && g.temp.freeze > 0) { ctx.fillStyle = "rgba(160,230,255,.12)"; ctx.fillRect(0, 0, vw, vh); }
  if (g && g.slowmo > 0) { const gr = ctx.createRadialGradient(vw / 2, vh / 2, vh * 0.2, vw / 2, vh / 2, vh * 0.75); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,.5)"); ctx.fillStyle = gr; ctx.fillRect(0, 0, vw, vh); }
  if (flash > 0) { ctx.globalAlpha = Math.min(0.6, flash); ctx.fillStyle = flashColor; ctx.fillRect(0, 0, vw, vh); ctx.globalAlpha = 1; flash -= dt * 2.2; }
}

/* A preview for the shop and the title: one cannon and a few balls, with
   no game behind it. */
export function drawIdle(t, dt) {
  const fake = {
    t, mode: "campaign", level: 1, wave: 0, cannon: { x: W / 2 + Math.sin(t * 0.8) * 110, tilt: Math.cos(t * 0.8) * 0.5, recoil: (t * 3) % 1 },
    s: { volley: 3, mirror: 0 }, temp: { twin: 0, freeze: 0, mega: 0 }, enemies: [], gates: [], pickups: [], drops: [], balls: [], feverT: 0, slowmo: 0
  };
  for (let i = 0; i < 40; i++) {
    const p = ((t * 0.9 + i / 40) % 1);
    const x = W / 2 + Math.sin(t * 0.8 - p * 1.2) * 110 + Math.sin(i * 12.9) * 30 * p;
    fake.balls.push({ x, y: CANNON_Y - 30 - p * (CANNON_Y - 40), vx: 0, vy: -500, n: 1 + (p > 0.5 ? 3 : 0), r: 5, fx: 0 });
  }
  draw(fake, dt);
}

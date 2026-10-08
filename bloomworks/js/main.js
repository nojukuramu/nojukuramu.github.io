/* main.js — boot, the loop, and the glue between input and the game.
 *
 * The simulation runs at a fixed step (sim.STEP) from an accumulator, so a
 * slow frame never changes the economy; a tab that was hidden for a while
 * catches up with game.advance(), and anything longer than a minute goes
 * through the offline catch-up instead, with a Logbook at the end. */

import { S, RT, newGame } from "./state.js";
import { setNotation, ZERO } from "./num.js";
import { TYPES } from "./data.js";
import * as E from "./econ.js";
import * as B from "./build.js";
import * as sim from "./sim.js";
import * as game from "./game.js";
import * as render from "./render.js";
import * as input from "./input.js";
import * as ui from "./ui.js";
import * as info from "./info.js";
import * as upd from "./update.js";
import * as save from "./save.js";
import * as audio from "./audio.js";
import * as fx from "./fx.js";
import * as goals from "./goals.js";
import * as auto from "./auto.js";
import { catchUp } from "./offline.js";
import { seedFromString } from "./rng.js";
import { owned, plotOfTile, claimable } from "./world.js";

const canvas = document.getElementById("view");
render.init(canvas, document.getElementById("overlay"));
input.init(canvas);
ui.init();
info.init();
fx.attachSound(audio.sound);
game.onNotify((text, kind, ic) => ui.toast(text, kind, ic));

/* ---------- a world to play in ---------- */
let log = null;
if (!save.load()) {
  newGame(seedFromString("bloom" + Date.now() + Math.random()));
  // The first Wellspring and the first Hearth are free, and placed for you,
  // a few tiles apart, with a short Track between them.
  firstLayout();
  setTimeout(() => info.open("about"), 600);
} else {
  const away = (Date.now() - (S.savedAt || Date.now())) / 1000;
  if (away > 60) {
    log = catchUp(away);
    S.logbook = Object.assign({}, log, { frames: undefined });
  }
}
setNotation(S.meta.settings.notation);
render.setQuality(S.meta.settings.quality || "high");
audio.setSound(S.meta.settings.sound);
audio.setMusic(S.meta.settings.music);
E.refreshUnlocks();
B.rebuildLayout();
render.cam.x = 5; render.cam.y = 5;
{ const [W, H] = render.size(); render.cam.z = Math.max(18, Math.min(44, Math.min(W / 11.5, (H - 150) / 11.5))); }
if (log && log.away > 60) ui.showLogbook(log, log.away >= 600);

function firstLayout() {
  // Find a clear row in the Home Plot: Wellspring, two Tracks, a Hearth.
  for (let y = 3; y < 8; y++) for (let x = 1; x < 4; x++) {
    if (B.whyNot("wellspring", x, y) || B.whyNot("track", x + 1, y) || B.whyNot("track", x + 2, y) || B.whyNot("hearth", x + 3, y - 1)) continue;
    B.place("wellspring", x, y, 0);
    B.place("track", x + 1, y, 0, { free: true });
    B.place("track", x + 2, y, 0, { free: true });
    B.place("hearth", x + 3, y - 1, 0);
    return;
  }
}

/* ---------- input -> game ---------- */
input.on({
  interact() { audio.unlock(); if (RT.zen) ui.setZen(false); },
  placeAt: (type, x, y, rot, fromTap) => ui.placeAt(type, x, y, rot, fromTap),
  changed() {},
  moveTo(c, x, y) { if (B.move(c, x, y)) ui.endMode(); else ui.toast(B.whyNot(c.type, x, y, c), "bad", "move"); },
  stampAt(x, y) {
    const m = input.mode;
    if (!m.bp) return ui.endMode();
    if (m.dirIndex != null) {
      const d = S.directives[m.dirIndex];
      if (d) Object.assign(d.act, { x, y, rot: m.rot || 0 });
      ui.toast("The Directive will stamp it here.", "good", "blueprint");
    } else {
      const n = auto.stampBlueprint(m.bp, x, y, m.rot || 0);
      ui.toast(n + " Ghosts placed. Builders do the rest.", "good", "blueprint");
    }
    ui.endMode();
  },
  linkTo(c) {
    const m = input.mode;
    if (!c || c.type === "track") return ui.toast("Tap a contraption.", "bad", "link");
    if (!m.a) { m.a = c.id; ui.showPlaceBar("Now tap the contraption to carry to"); return; }
    const t = S.tinkers[m.tinker];
    if (t) t.link = [m.a, c.id];
    ui.toast("Courier linked.", "good", "link");
    ui.endMode();
  },
  bpAreaDone(a, b) {
    if (!a || !b) return ui.endMode();
    const bp = auto.saveBlueprint(null, a[0], a[1], b[0], b[1]);
    ui.toast(bp ? "Saved " + bp.name + " (" + bp.parts.length + " parts)." : "Nothing in that area.", bp ? "good" : "bad", "blueprint");
    ui.endMode();
  },
  tapTile(x, y) {
    const c = B.copyAt(x, y);
    if (c) {
      const r = sim.tap(c);
      if (r === "boost") fx.spark(c.x + B.sizeOf(c.type) / 2, c.y + B.sizeOf(c.type) / 2, "#9affc8", 8);
      ui.select(c);
      return;
    }
    ui.selectTile(x, y);
  },
  moth() { const w = goals.catchMoth(false); if (w) { fx.moth(); fx.spark(RT.mothX || 0, RT.mothY || 0, "#ffd23f", 20); } },
  rotated() { if (input.mode.kind === "place" || input.mode.kind === "stamp") ui.toast("Facing " + ["east", "south", "west", "north"][input.mode.rot], "info", "rotate"); },
  escape() { if (info.isOpen()) return; if (input.mode.kind) return ui.endMode(); if (ui.panelOpen()) return ui.closePanel(); ui.select(null); },
  zen() { ui.setZen(!RT.zen); },
  panel(id) { ui.openPanel(id); }
});
document.getElementById("placeRot").addEventListener("click", () => { if (input.mode.kind === "stamp") input.mode.rot = (input.mode.rot + 1) & 3; });

/* ---------- the loop ---------- */
let acc = 0, last = performance.now(), saveAt = performance.now();
function loop(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 60) {
    // Back from a long sleep: the offline catch-up, then the Logbook.
    const l = catchUp(dt);
    S.logbook = Object.assign({}, l, { frames: undefined });
    ui.showLogbook(l, dt >= 600);
    dt = 0;
  } else if (dt > 0.25) { game.advance(dt); dt = 0; }
  // Supernova: half a second of slow motion.
  let scale = 1;
  if (RT.slowmo > 0) { RT.slowmo -= dt; scale = 0.25; }
  acc += dt * scale;
  let steps = 0;
  while (acc >= sim.STEP && steps < 8) { game.tick(sim.STEP); acc -= sim.STEP; steps++; }
  if (steps >= 8) acc = 0;
  zenDrift(dt);
  ui.replayTick(now);
  render.frame(now, ui.ui);
  ui.hud(now);
  audio.musicTick();
  if (now - saveAt > 30000) { save.save(); saveAt = now; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* Zen Mode: the camera drifts slowly between your busiest spots. */
let zenTarget = null, zenAt = 0;
function zenDrift(dt) {
  if (!RT.zen) return;
  const now = performance.now();
  if (now - RT.zenSince > 600000) goals.hiddenFeat("zen");
  if (!zenTarget || now - zenAt > 14000) {
    zenAt = now;
    const busy = (RT.actors || []).slice().sort((a, b) => (b.combo || b.inq.length) - (a.combo || a.inq.length)).slice(0, 6);
    const c = busy[Math.floor(Math.random() * busy.length)];
    zenTarget = c ? [c.x + 1, c.y + 1] : [5, 5];
  }
  render.cam.x += (zenTarget[0] - render.cam.x) * Math.min(1, dt * 0.15);
  render.cam.y += (zenTarget[1] - render.cam.y) * Math.min(1, dt * 0.15);
}

/* ---------- saving and updates ---------- */
document.addEventListener("visibilitychange", () => { if (document.hidden) save.save(); });
window.addEventListener("pagehide", () => save.save());
const busy = () => E.rushOn() || RT.eclipseShow > 0;
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").then((reg) => upd.init(reg, busy, () => Promise.resolve(save.save()))).catch(() => upd.init(null, busy, () => Promise.resolve(save.save())));
} else upd.init(null, busy, () => Promise.resolve(save.save()));

// For tools/e2e.js: a window into the running game, read-only in spirit.
window.__bw = { S, RT, E, B, sim, game, save, ui, input, render, TYPES, ZERO, owned, plotOfTile, claimable };

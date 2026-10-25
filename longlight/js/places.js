/* places.js — what the people left: huts, their insides, depots, flags.
 *
 * Pure, like world.js: a function of the world and the difficulty. The base
 * where he wakes, five camps along the flagged route, and the last station
 * on its cape; between them the flag line, a sledge left where it stuck,
 * cairns, a line of old lantern posts, holes in the sea ice, a mast that fell.
 *
 * Every hut is a box of corrugated sheet on low stilts with a door on its
 * front, built in code (render.js); everything in it is a Poly Haven model
 * placed here, in the hut's own frame, and turned into the world's.
 *
 * What there is to take depends on the difficulty — "supplies: common, fair,
 * scarce" — but never so little that the beacon at a site cannot be lit
 * from what that site holds, on any difficulty: a scarce camp is a choice
 * between the beacon and the stove, not a dead end. tools/validate.js checks
 * it for every seed it builds. */

import { rng, pick } from "./rng.js";
import { heightAt, surface, HALF, CELL, SEA_ICE_Y } from "./world.js";

/* The models: footprint radius for walking into, the height of anything
   that can be stood on (a table's top), and a scale where Poly Haven's is
   not in metres. Measured from the packed files. */
export const CAT = {
  alarm_clock: { r: 0 }, axe: { r: 0 }, bed: { r: 0, box: [0.46, 1.0], top: 0.48 }, binoculars: { r: 0 },
  boots: { r: 0 }, bucket: { r: 0.2 }, cans: { r: 0 }, chair: { r: 0.25 }, clipboard: { r: 0 }, clock: { r: 0 },
  compass: { r: 0 }, crate: { r: 0, box: [0.9, 0.5], top: 0.3 }, crate_open: { r: 0, box: [0.62, 0.26], top: 0.46 },
  desk: { r: 0, box: [1.0, 0.48], top: 0.787 }, drum: { r: 0.33, top: 0.93 }, fish_knife: { r: 0 }, generator: { r: 0.42 },
  jerrycan: { r: 0 }, jerrycan_green: { r: 0 }, lantern: { r: 0 }, lifebuoy: { r: 0 }, lpg: { r: 0.21 }, medical: { r: 0 },
  notebook: { r: 0 }, postcards: { r: 0 }, pot: { r: 0 }, radio: { r: 0 }, rations: { r: 0 }, rock_a: { r: 0 }, rock_b: { r: 0 },
  searchlight: { r: 0 }, shelves: { r: 0, box: [0.55, 0.26], scale: 0.1 }, spade: { r: 0 }, spectacles: { r: 0 },
  stone_a: { r: 0 }, stone_b: { r: 0 }, stool: { r: 0.18 }, stove: { r: 0.32, top: 0.856 }, suitcase: { r: 0 },
  table: { r: 0, box: [0.9, 0.33], top: 0.549 }, thermos: { r: 0 }, toolbox: { r: 0 }
};
export const MODEL_NAMES = Object.keys(CAT);

/* Difficulty: what being found at zero costs, how fast things drain, how
   much is lying about, and what a beacon burns. The table in the design
   document, as numbers. */
export const DIFF = {
  easy: { label: "Easy", drainFood: 1 / 5400, tauCold: 1000, fuelPerSite: 4, foodPerSite: 3, beacon: 1, stove: 0.5, seasonT: 7800 },
  normal: { label: "Normal", drainFood: 1 / 3600, tauCold: 600, fuelPerSite: 3, foodPerSite: 2, beacon: 2, stove: 0.5, seasonT: 5700 },
  hard: { label: "Hard", drainFood: 1 / 2500, tauCold: 400, fuelPerSite: 3, foodPerSite: 1, beacon: 3, stove: 0.75, seasonT: 4500 }
};

const HUT_H = 2.5, STILT = 0.45;

/**
 * Everything placed. `diff` is "easy" | "normal" | "hard".
 */
export function buildPlaces(W, diff) {
  const D = DIFF[diff] || DIFF.normal;
  const r = rng((W.seed ^ 0x51ac3) >>> 0);
  const P = { huts: [], props: [], flags: [], tents: [], sleds: [], masts: [], posts: [], cairns: [], holes: [], rares: [], loose: [], signs: [] };
  const S = W.sites;

  /* ---- helpers ---- */
  const toWorld = (o, lx, lz) => { const c = Math.cos(o.rot), s = Math.sin(o.rot); return { x: o.x + lx * c + lz * s, z: o.z - lx * s + lz * c }; };
  const ground = (x, z) => heightAt(W, x, z);
  const prop = (kind, x, y, z, rot, extra) => {
    const p = Object.assign({ id: P.props.length, kind, x, y, z, rot: rot || 0, scale: (CAT[kind] && CAT[kind].scale) || 1, inside: -1 }, extra || {});
    P.props.push(p);
    return p;
  };
  // a prop in a hut's own frame: (lx, lz) on its floor, or on something at height dy
  const inHut = (h, kind, lx, lz, rot, dy, extra) => {
    const at = toWorld(h, lx, lz);
    return prop(kind, at.x, h.floor + (dy || 0), at.z, h.rot + (rot || 0), Object.assign({ inside: h.id }, extra || {}));
  };
  const outdoor = (o, kind, lx, lz, rot, extra) => {
    const at = toWorld(o, lx, lz);
    return prop(kind, at.x, ground(at.x, at.z), at.z, o.rot + (rot || 0), extra);
  };
  const hut = (site, role, lx, lz, w, d, color, rotOff) => {
    const at = toWorld(site, lx, lz);
    const rot = site.rot + (rotOff || 0);
    // the floor sits on stilts above the highest corner, so no corner is buried
    let gmax = -1e9;
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
      const q = toWorld({ x: at.x, z: at.z, rot }, cx * w / 2, cz * d / 2);
      gmax = Math.max(gmax, ground(q.x, q.z));
    }
    const h = { id: P.huts.length, site: site.id, role, x: at.x, z: at.z, rot, w, d, h: HUT_H, floor: gmax + STILT, color, door: { off: w * 0.25 * (r() < 0.5 ? -1 : 1), w: 0.95 }, stove: -1, radio: -1 };
    P.huts.push(h);
    return h;
  };

  /* ---- what is lying about: fuel and food, by difficulty ---- */
  // returns the props it made, so a site can hand them to its huts
  const supplies = (site, h, fuel, food) => {
    const made = [];
    for (let k = 0; k < fuel; k++) {
      const kind = k % 2 ? "jerrycan_green" : "jerrycan";
      const lx = -h.w / 2 + 0.35 + (k % 4) * 0.42, lz = h.d / 2 - 0.35 - Math.floor(k / 4) * 0.4;
      made.push(inHut(h, kind, lx, lz, Math.PI + (r() - 0.5) * 0.3, 0, { item: { type: "fuel", n: 1 } }));
    }
    for (let k = 0; k < food; k++) {
      const kind = k % 2 ? "cans" : "rations";
      const lx = h.w / 2 - 0.5 - (k % 3) * 0.4, lz = -h.d / 2 + 0.35 + Math.floor(k / 3) * 0.3;
      made.push(inHut(h, kind, lx, lz, r() * Math.PI, 0, { item: { type: "food", food: kind } }));
    }
    void site;
    return made;
  };

  /* ---- hut interiors, by role ---- */
  const fit = {
    bunk(h) {
      inHut(h, "bed", -h.w / 2 + 0.55, -h.d / 2 + 1.05, 0, 0, { solid: true });
      inHut(h, "bed", -h.w / 2 + 1.65, -h.d / 2 + 1.05, 0, 0, { solid: true });
      h.stove = inHut(h, "stove", h.w / 2 - 0.5, -h.d / 2 + 0.5, 0, 0, { stove: true, solid: true }).id;
      inHut(h, "table", 0.6, 0.15, 0, 0, { solid: true });
      inHut(h, "chair", 0.4, 0.75, Math.PI, 0, { solid: true });
      inHut(h, "alarm_clock", 0.2, 0.05, 0.2, CAT.table.top, { clock: true });
      inHut(h, "spectacles", 0.75, 0.25, 0.9, CAT.table.top);
      inHut(h, "pot", 1.15, 0.1, 0, CAT.table.top, { meal: true });
      inHut(h, "boots", -h.w / 2 + 0.6, h.d / 2 - 0.3, Math.PI, 0);
      inHut(h, "clock", 0, -h.d / 2 + 0.06, 0, 1.75, { clock: true, wall: true });
    },
    radio(h) {
      inHut(h, "desk", 0, -h.d / 2 + 0.55, 0, 0, { solid: true });
      h.radio = inHut(h, "radio", -0.45, -h.d / 2 + 0.45, 0, CAT.desk.top, { radio: true }).id;
      inHut(h, "notebook", 0.45, -h.d / 2 + 0.6, 0.15, CAT.desk.top);
      inHut(h, "stool", -0.3, -h.d / 2 + 1.35, 0, 0, { solid: true });
      inHut(h, "shelves", h.w / 2 - 0.3, 0, -Math.PI / 2, 0, { solid: true });
      inHut(h, "clock", 0.9, -h.d / 2 + 0.06, 0, 1.75, { clock: true, wall: true });
      inHut(h, "searchlight", h.w / 2 - 0.4, h.d / 2 - 0.4, 2.4, 0);
    },
    mess(h) {
      inHut(h, "table", 0, 0, 0, 0, { solid: true });
      inHut(h, "chair", -0.5, 0.65, Math.PI, 0, { solid: true });
      inHut(h, "chair", 0.5, -0.65, 0, 0, { solid: true });
      inHut(h, "stool", 1.2, 0.5, 0, 0, { solid: true });
      inHut(h, "pot", -0.3, 0.05, 0, CAT.table.top, { meal: true });
      inHut(h, "thermos", 0.35, -0.1, 0, CAT.table.top);
      inHut(h, "cans", 0.7, 0.15, 0.6, CAT.table.top);
      h.stove = inHut(h, "stove", h.w / 2 - 0.5, -h.d / 2 + 0.5, 0, 0, { stove: true, solid: true }).id;
      inHut(h, "clock", -0.8, -h.d / 2 + 0.06, 0, 1.75, { clock: true, wall: true });
    },
    store(h) {
      inHut(h, "shelves", -h.w / 2 + 0.3, -0.4, Math.PI / 2, 0, { solid: true });
      inHut(h, "shelves", h.w / 2 - 0.3, -0.4, -Math.PI / 2, 0, { solid: true });
      inHut(h, "crate", 0, -h.d / 2 + 0.6, 0, 0, { solid: true });
      inHut(h, "toolbox", 0.6, -h.d / 2 + 0.6, 0.3, CAT.crate.top);
      inHut(h, "medical", -0.5, -h.d / 2 + 0.55, -0.2, CAT.crate.top);
      inHut(h, "drum", -h.w / 2 + 0.5, h.d / 2 - 0.9, 0, 0, { solid: true });
    },
    shed(h) {
      inHut(h, "generator", 0, -h.d / 2 + 0.55, 0, 0, { generator: true, solid: true });
      inHut(h, "drum", h.w / 2 - 0.45, -h.d / 2 + 0.45, 0, 0, { solid: true });
      inHut(h, "spade", -h.w / 2 + 0.2, 0, 0.1, 0.5);
    }
  };

  /* ---- the sites ---- */
  for (const s of S) {
    const f = s.kind === "station" ? D.fuelPerSite + D.beacon : s.kind === "base" ? D.fuelPerSite : D.fuelPerSite + (r() < 0.35 ? 1 : 0);
    // never less than the site's own beacon asks
    const fuel = Math.max(f, D.beacon);
    const food = D.foodPerSite + (s.kind === "base" ? 1 : 0) + (r() < 0.3 ? 1 : 0);
    s.huts = [];
    if (s.kind === "base") {
      // where he wakes: bunks, the radio room, the store, the generator shed
      const b = hut(s, "bunk", -6, 0, 6, 4, "red"); fit.bunk(b);
      const rd = hut(s, "radio", 4, -1, 5, 4, "red", 0.06); fit.radio(rd);
      const st = hut(s, "store", -4, 9.5, 5, 4, "grey", Math.PI); fit.store(st);
      const sh = hut(s, "shed", 6, 9, 3.4, 3, "grey", Math.PI - 0.1); fit.shed(sh);
      s.huts.push(b.id, rd.id, st.id, sh.id);
      s.wake = { hut: b.id };
      // the things he needs first: the lantern in the bunkhouse, the compass and
      // the route map in the radio room, the line and the tools in the store
      inHut(b, "lantern", 0.55, 0.3, 0, CAT.table.top, { item: { type: "key", key: "lantern" } });
      inHut(rd, "compass", 0.1, -rd.d / 2 + 0.4, 0, CAT.desk.top, { item: { type: "key", key: "compass" } });
      inHut(rd, "clipboard", 0.85, -rd.d / 2 + 0.45, 0.4, CAT.desk.top, { item: { type: "key", key: "map" }, clue: "map" });
      inHut(st, "bucket", 0.3, st.d / 2 - 0.6, 0, 0, { item: { type: "key", key: "line" } });
      inHut(st, "fish_knife", 0.6, -st.d / 2 + 0.75, 1.2, CAT.crate.top);
      const tb = P.props.find((q) => q.inside === st.id && q.kind === "toolbox");
      if (tb) tb.item = { type: "key", key: "toolbox" };
      // fuel in the generator shed (it will not start: there is nothing to start it for)
      supplies(s, sh, Math.min(fuel, 3), 0);
      supplies(s, st, Math.max(0, fuel - 3), food);
      const o = { x: s.x, z: s.z, rot: s.rot };
      outdoor(o, "drum", 1, 6.5, 0, { solid: true }); outdoor(o, "drum", 1.7, 6.9, 0.4, { solid: true }); outdoor(o, "drum", 1.3, 7.6, 1.1, { solid: true });
      outdoor(o, "lpg", -0.8, 6.2, 0, { solid: true }); outdoor(o, "lpg", -1.2, 6.6, 0.5, { solid: true });
      outdoor(o, "crate", 9, 3, 0.4, { solid: true });
      outdoor(o, "spade", -10, 4, 0.3, { stuck: true });
      P.masts.push(Object.assign(toWorld(o, 0, -7), { kind: "flagpole", h: 6, down: true, site: s.id, id: P.masts.length }));
      clue(b, "note_bunk", 0.9, 0.35, CAT.table.top);
      clue(rd, "log_radio", 0.45, -rd.d / 2 + 0.6, CAT.desk.top, true);
      clue(st, "roster", -0.1, -st.d / 2 + 0.55, CAT.crate.top);
    } else if (s.kind === "camp") {
      const roles = [["radio", "bunk"], ["mess"], ["bunk"], ["radio"], ["mess", "store"]][s.id - 1] || ["bunk"];
      let i = 0;
      for (const role of roles) {
        const w = role === "store" ? 4.2 : 5.2, d = 3.8;
        const h = hut(s, role, i ? 7 : 0, i ? 3 : 0, w, d, r() < 0.7 ? "red" : "grey", i ? 0.3 : 0);
        fit[role](h); s.huts.push(h.id); i++;
      }
      const h0 = P.huts[s.huts[0]];
      // the camps have no store but the last: what is left is by the door
      supplies(s, h0, fuel, food);
      const o = { x: s.x, z: s.z, rot: s.rot };
      // a depot outside: drums, a crate, cylinders
      outdoor(o, "drum", -5, 2.5, 0.2, { solid: true }); outdoor(o, "drum", -5.6, 3.1, 1, { solid: true });
      outdoor(o, "crate_open", -4.6, -2.5, 0.5, { solid: true });
      if (r() < 0.6) outdoor(o, "lpg", -6.2, 2, 0, { solid: true });
      // a tent or two, pitched against the wind
      for (let t = 0; t < 1 + (r() < 0.5 ? 1 : 0); t++) { const at = toWorld(o, 4 + t * 4.5, -6 - t); P.tents.push({ x: at.x, z: at.z, y: ground(at.x, at.z), rot: s.rot + 0.4 * t, color: t ? "orange" : "yellow" }); }
      clue(h0, "camp" + s.id, h0.role === "radio" ? 0.45 : 0.2, h0.role === "radio" ? -h0.d / 2 + 0.6 : 0.1, h0.role === "radio" ? CAT.desk.top : CAT.table.top, h0.role === "radio");
      if (s.id === 2) { const at = toWorld(o, -8, 6); P.sleds.push({ x: at.x, z: at.z, y: ground(at.x, at.z), rot: s.rot + 0.7, clue: "sled" }); }
      if (s.id === 4) { const at = toWorld(o, 6, 9); P.masts.push({ x: at.x, z: at.z, kind: "weather", h: 7, down: true, site: s.id, id: P.masts.length }); }
      // the fourth camp's radio is broken: with the tools it can be made to talk
      if (s.id === 4 && h0.radio >= 0) P.props[h0.radio].broken = true;
    } else {
      // the last station: a hall, the bunkhouse, the store, the beacon tower
      const hall = hut(s, "radio", -8, 0, 9, 5, "red"); fit.radio(hall);
      const bk = hut(s, "bunk", 6, -2, 6.5, 4.2, "red", 0.1); fit.bunk(bk);
      const st = hut(s, "store", -6, 11, 5, 4, "grey", Math.PI); fit.store(st);
      s.huts.push(hall.id, bk.id, st.id);
      supplies(s, st, fuel, food);
      const o = { x: s.x, z: s.z, rot: s.rot };
      P.masts.push(Object.assign(toWorld(o, -16, -6), { kind: "radio", h: 18, down: false, site: s.id, id: P.masts.length }));
      outdoor(o, "drum", 4, 8, 0, { solid: true }); outdoor(o, "drum", 4.7, 8.4, 0.6, { solid: true });
      outdoor(o, "lifebuoy", -3, -6, 0, { onPost: true });
      clue(hall, "station", 0.45, -hall.d / 2 + 0.6, CAT.desk.top, true);
      clue(bk, "ledger", 0.9, 0.35, CAT.table.top);
      P.props[hall.radio].morse = true;
    }
  }

  function clue(h, id, lx, lz, dy, book) {
    inHut(h, book ? "notebook" : "clipboard", lx, lz, (r() - 0.5) * 0.4, dy, { clue: id });
  }

  /* ---- the flag line: old route markers every 150 m or so ---- */
  let acc = 0;
  for (let i = 1; i < W.line.length; i++) {
    const a = W.line[i - 1], b = W.line[i];
    acc += Math.hypot(b.x - a.x, b.z - a.z);
    if (acc < 150) continue;
    acc = 0;
    if (S.some((s) => Math.hypot(s.x - b.x, s.z - b.z) < s.pad + 20)) continue;
    // a little off the line, as flags are; some half buried, some down
    const side = r() < 0.5 ? -1 : 1, dx = b.z - a.z, dz = -(b.x - a.x), l = Math.hypot(dx, dz) || 1;
    const x = b.x + (dx / l) * side * (2 + r() * 3), z = b.z + (dz / l) * side * (2 + r() * 3);
    P.flags.push({ x, z, y: ground(x, z), lean: r() < 0.15 ? 1.2 : (r() - 0.5) * 0.25, buried: r() < 0.3 ? 0.4 + r() * 0.6 : 0, color: P.flags.length % 2 ? "red" : "green", rot: r() * Math.PI * 2 });
  }

  /* ---- detours ---- */
  // a line of old lantern posts on the way to the third camp
  {
    const seg = W.line.filter((p) => p.seg === 2);
    for (let k = 0; k < 6 && seg.length; k++) {
      const p = seg[Math.floor((0.25 + k * 0.1) * seg.length)];
      if (!p) continue;
      const x = p.x + 4, z = p.z + 3;
      P.posts.push({ id: P.posts.length, x, z, y: ground(x, z) });
    }
  }
  // cairns on three rises, each a few stones high, with loose stones round it
  {
    const spots = W.beacons.filter((b) => b.site < 0).concat(W.beacons.filter((b) => b.site >= 1 && b.site <= 5).slice(0, 2)).slice(0, 3);
    for (const b of spots) {
      const a = r() * Math.PI * 2, x = b.x + Math.cos(a) * 9, z = b.z + Math.sin(a) * 9;
      const c = { id: P.cairns.length, x, z, y: ground(x, z), stones: 3, full: 9 };
      P.cairns.push(c);
      for (let k = 0; k < 8; k++) {
        const aa = r() * Math.PI * 2, d = 3 + r() * 9, lx = x + Math.cos(aa) * d, lz = z + Math.sin(aa) * d;
        P.loose.push({ id: P.loose.length, x: lx, z: lz, y: ground(lx, lz), cairn: c.id, kind: r() < 0.5 ? "stone_a" : "stone_b", rot: r() * 6.28 });
      }
    }
  }
  // holes in the sea ice, near the sites the sea is near
  for (const s of S) {
    let best = null;
    for (let t = 0; t < 300; t++) {
      const a = r() * Math.PI * 2, d = 60 + r() * 460, x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
      const q = surface(W, x, z);
      if (q.seaIce < 0.99 || q.water > 0 || q.berg) continue;
      // flat around it, so the hole is not cut into a pressure ridge
      if (Math.abs(q.h - SEA_ICE_Y) > 0.12) continue;
      if (!best || d < best.d) best = { x, z, d };
    }
    if (best) P.holes.push({ id: P.holes.length, x: best.x, z: best.z, y: SEA_ICE_Y, site: s.id });
  }

  /* ---- rare moments: about one an hour of walking ---- */
  {
    // a light on a far hill, seen once from the route between the third and fourth camps
    const seg = W.line.filter((p) => p.seg === 3);
    const at = seg[Math.floor(seg.length * 0.4)] || W.line[Math.floor(W.line.length / 2)];
    let far = null;
    for (let t = 0; t < 200; t++) {
      const a = Math.PI / 2 + (r() - 0.5) * 1.6, d = 2200 + r() * 1200, x = at.x + Math.cos(a) * d, z = at.z + Math.sin(a) * d;
      if (Math.abs(x) > HALF - 200 || Math.abs(z) > HALF - 200) continue;
      const h = heightAt(W, x, z);
      if (!far || h > far.y) far = { x, z, y: h };
    }
    P.rares.push({ id: 0, kind: "light", tx: at.x, tz: at.z, x: far.x, z: far.z, y: far.y + 4 });
    P.rares.push({ id: 1, kind: "song", site: 1 });
    P.rares.push({ id: 2, kind: "engine" });
    P.rares.push({ id: 3, kind: "morse", site: S[S.length - 1].id });
  }

  /* ---- the answer: somewhere out over the sea, north and east of the station ---- */
  {
    const st = S[S.length - 1];
    P.answer = { x: Math.min(HALF - 60, st.x + 2600), z: Math.max(-HALF + 60, st.z - 2900), y: 30 };
  }

  for (const p of P.props) if (CAT[p.kind] && CAT[p.kind].box) p.box = CAT[p.kind].box;
  void pick; void CELL;
  return P;
}

/* A hut's own frame. */
export function hutLocal(h, x, z) {
  const dx = x - h.x, dz = z - h.z, c = Math.cos(h.rot), s = Math.sin(h.rot);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}
export function hutWorld(h, lx, lz) {
  const c = Math.cos(h.rot), s = Math.sin(h.rot);
  return { x: h.x + lx * c + lz * s, z: h.z - lx * s + lz * c };
}
/** Which hut (x,z) is inside, or -1. */
export function hutAt(P, x, z, margin) {
  const m = margin === undefined ? 0 : margin;
  for (const h of P.huts) {
    const l = hutLocal(h, x, z);
    if (Math.abs(l.x) < h.w / 2 - m && Math.abs(l.z) < h.d / 2 - m) return h.id;
  }
  return -1;
}

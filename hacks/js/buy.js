/* buy.js — the buy menu, the way Counter-Strike's works: B, a number, a number.
 *
 * B opens it over the game without stopping it (a match never waits for a
 * menu, and nobody else's does). 1 is your primary, 2 your secondary, 3 your
 * blade, 4 your utility; then a number picks the thing, and the menu goes
 * back to the four so the next purchase is two keys away. 0 or Backspace goes
 * back a step; B or Escape closes it. On a phone every row is a tap.
 *
 * What you pick is your loadout from then on (save.js, like the loadout
 * screen). Whether it is in your hands now is the buy window's call: in the
 * first seconds of a life, or any time in practice, you get it at once,
 * full; after that, at your next spawn — so the menu cannot refill a
 * magazine mid-fight.
 *
 * The keys reach this before they reach the weapon slots (input.js asks
 * isOpen() first), so a 1 in the menu buys rather than drawing your primary. */

import { S, on, emit } from "./state.js";
import { save } from "./save.js";
import { GUNS, MELEE, UTILS, UTIL_IDS, MELEE_IDS, SLOT_IDS, GRAPPLE, cleanLoadout } from "./weapons.js";
import { buy as buyNow } from "./game.js";
import { $, escHtml } from "./util.js";

export const BUY_WINDOW = 12;     // seconds into a life when a purchase is in your hands at once
const CATS = [
  { kind: "primary", name: "Primary", ids: SLOT_IDS },
  { kind: "secondary", name: "Secondary", ids: SLOT_IDS },
  { kind: "melee", name: "Melee", ids: MELEE_IDS },
  { kind: "utility", name: "Utility", ids: UTIL_IDS }
];
let open = false, cat = -1;
export const isOpen = () => open;

const nameOf = (kind, id) => kind === "melee" ? MELEE[id].name : kind === "utility" ? UTILS[id].name : (GUNS[id] || GRAPPLE).name;
const clsOf = (kind, id) => kind === "melee" ? (id === "katana" ? "Fast charge, wide cut" : "Slow charge, long reach") : kind === "utility" ? UTILS[id].cls : (GUNS[id] || GRAPPLE).cls;
/** Would a purchase now be in your hands now? */
export function inWindow() {
  const me = S.me, M = S.match;
  if (!me || !M || !me.alive) return false;
  return M.mode === "practice" || S.time - me.spawnedAt < BUY_WINDOW;
}

function render() {
  const el = $("buy");
  if (!el) return;
  const L = save.data.loadout;
  const now = inWindow();
  let rows = "";
  if (cat < 0) {
    rows = CATS.map((c, i) => '<button class="brow" data-n="' + (i + 1) + '"><kbd>' + (i + 1) + "</kbd><b>" + c.name + "</b><span>" + escHtml(nameOf(c.kind, L[c.kind])) + "</span></button>").join("");
  } else {
    const c = CATS[cat];
    const other = c.kind === "primary" ? L.secondary : c.kind === "secondary" ? L.primary : null;
    rows = c.ids.map((id, i) => {
      const on = L[c.kind] === id, swap = other === id;
      return '<button class="brow' + (on ? " on" : "") + '" data-n="' + (i + 1) + '"><kbd>' + (i + 1) + "</kbd><b>" + escHtml(nameOf(c.kind, id)) + "</b><span>" + escHtml(swap ? "swaps with your " + (c.kind === "primary" ? "secondary" : "primary") : clsOf(c.kind, id)) + "</span></button>";
    }).join("");
  }
  $("buyTitle").textContent = cat < 0 ? "Buy" : CATS[cat].name;
  $("buyRows").innerHTML = rows;
  $("buyNote").textContent = (cat < 0 ? "" : "0 back · ") + "B close · " + (now ? "in your hands now" : "from your next life");
}
export function toggle(v) {
  open = v == null ? !open : !!v;
  if (open && (!S.match || S.mode !== "play")) open = false;
  cat = -1;
  const el = $("buy");
  if (el) el.hidden = !open;
  document.body.classList.toggle("buying", open);
  if (open) render();
  emit("ui");
}
/** A number from the keys or a tap on a row. */
export function key(n) {
  if (!open) return false;
  if (n === 0) { if (cat < 0) toggle(false); else { cat = -1; render(); } return true; }
  if (cat < 0) { if (n >= 1 && n <= CATS.length) { cat = n - 1; render(); emit("ui"); } return true; }
  const c = CATS[cat], id = c.ids[n - 1];
  if (!id) return true;
  pick(c.kind, id);
  cat = -1;
  render();
  return true;
}
/** Make `id` this slot's: in the loadout from now on, and in your hands at once inside the buy window. */
export function pick(kind, id) {
  const L = save.data.loadout;
  // one item cannot be both guns: picking the other slot's swaps them, as the loadout screen does
  const otherKind = kind === "primary" ? "secondary" : kind === "secondary" ? "primary" : null;
  if (otherKind && L[otherKind] === id) L[otherKind] = L[kind];
  L[kind] = id;
  Object.assign(L, cleanLoadout(L));
  save.commit();
  const now = inWindow();
  if (S.me) { buyNow(S.me, kind, id, now); S.me.loadout = Object.assign({}, L); }
  emit("loadout", L);
  emit("buy", true);
  emit("toast", nameOf(kind, id) + (now ? "" : " · next life"));
}

export function init() {
  const el = $("buy");
  if (!el) return;
  el.addEventListener("click", (e) => { const b = e.target.closest(".brow"); if (b) key(+b.dataset.n); else if (e.target.closest("#buyClose")) toggle(false); });
  on("toggleBuy", () => toggle());
  on("menu", () => { if (open) toggle(false); });
  on("quit", () => { if (open) toggle(false); });
  on("matchEnd", () => { if (open) toggle(false); });
  on("died", (b) => { if (b === S.me && open) render(); });
  on("spawn", (a) => { if (a === S.me && open) render(); });
}

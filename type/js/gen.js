/* ============================================================
   Type — one door to every generator

   category: "all" | "text" | "terminal" | "code" | "keys"
   length:   "short" | "medium" | "long"
   seed:     any string; the same three always give the same challenge

   "all" is every category except random keys, as asked: the keys are a drill,
   not a mix-in. Which of the three is itself drawn from the seed.

   Normal Text turns into a conversation one time in ten thousand. Pass
   forceConvo (the page does, for ?convo) to see it without waiting for it.
   ============================================================ */

import { makeRng } from "./rng.js";
import { genText } from "./gen-text.js";
import { genTerminal } from "./gen-terminal.js";
import { genCode } from "./gen-code.js";
import { genKeys } from "./gen-keys.js";
import { genConvo, CONVO_CHANCE } from "./convo.js";

export const CATEGORIES = ["all", "text", "terminal", "code", "keys"];
export const LENGTHS = ["short", "medium", "long"];
const MIXED = ["text", "terminal", "code"];

export function generate(category, length, seed, opts) {
  const o = opts || {};
  const cat = CATEGORIES.indexOf(category) < 0 ? "all" : category;
  const len = LENGTHS.indexOf(length) < 0 ? "medium" : length;
  const rng = makeRng(seed + "|" + cat + "|" + len);
  const kind = cat === "all" ? rng.pick(MIXED) : cat;
  let ch;
  // a race hands everyone the same seed, and a chat has a cast that answers on its own clock: never in a race
  if (kind === "text") ch = !o.noConvo && (o.forceConvo || rng.chance(CONVO_CHANCE)) ? genConvo(rng, typeof o.forceConvo === "string" ? o.forceConvo : null) : genText(rng, len);
  else if (kind === "terminal") ch = genTerminal(rng, len);
  else if (kind === "code") ch = genCode(rng, len, o.lang);
  else ch = genKeys(rng, len);
  ch.category = cat;
  ch.length = len;
  ch.seed = seed;
  ch.id = cat + ":" + len + ":" + seed;
  return ch;
}

/* ============================================================
   Type — random keyboard characters

   No words, no rhythm to fall back on: groups of characters drawn from a
   randomly chosen part of the keyboard, so a challenge might be all brackets
   and operators, or digits and the shifted row above them, or a bit of
   everything. The mix is picked per challenge, which is what stops the hands
   settling into one pattern.
   ============================================================ */

const SETS = {
  letters: "abcdefghijklmnopqrstuvwxyz",
  caps: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  shifted: "!@#$%^&*()",
  brackets: "()[]{}<>",
  operators: "+-*/=%&|^~<>!?",
  punct: ".,;:'\"`_-\\/",
  home: "asdfghjkl;"
};

const MIXES = [
  ["letters", "digits"], ["letters", "caps", "digits"], ["shifted", "digits"], ["brackets", "operators"],
  ["letters", "punct"], ["caps", "shifted", "brackets"], ["letters", "caps", "digits", "shifted", "brackets", "operators", "punct"],
  ["operators", "punct", "digits"], ["home", "shifted"], ["letters", "brackets", "operators"]
];

const SIZE = { short: 24, medium: 60, long: 120 };

export function genKeys(rng, length) {
  const mix = rng.pick(MIXES);
  const chars = mix.map((k) => SETS[k]).join("");
  const total = SIZE[length] || SIZE.medium;
  const groups = [];
  let used = 0;
  while (used < total) {
    const g = rng.int(3, 6);
    let s = "";
    for (let i = 0; i < g; i++) s += chars[rng.int(0, chars.length - 1)];
    groups.push(s);
    used += g + 1;
  }
  return { kind: "keys", mix, text: groups.join(" ") };
}
export const KEY_SETS = SETS;

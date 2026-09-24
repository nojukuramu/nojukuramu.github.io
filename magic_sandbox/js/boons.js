/* boons.js — the cards you pick when you level up.
 *
 * The old game handed out stat points to spread over seven rows with a "+"
 * button each. Nobody enjoys arithmetic between fights, and the rows were all
 * the same shape, so none of them was ever a decision. A card is: three
 * choices, one tap, and each card says what it does in one line.
 *
 * Pure data plus one function; tools/validate.js checks every card names an
 * icon that exists and a stat the game actually reads. */

/* `stat` names a field on the player's modifier sheet (see player.js,
   freshMods); `add` is added to it once per stack. `max` caps the stacks so a
   lucky run cannot stack cooldown reduction to zero. */
export const BOONS = [
  { id: "vitality",  name: "Vitality",        icon: "heart",   rarity: 1, max: 6, text: "+25 max health, and heal it.",      stat: "maxHp", add: 25 },
  { id: "well",      name: "Deep Well",       icon: "drop",    rarity: 1, max: 5, text: "+30 max mana.",                      stat: "maxMana", add: 30 },
  { id: "flow",      name: "Flowing Mana",    icon: "wave",    rarity: 1, max: 5, text: "+30% mana regeneration.",           stat: "manaRegen", add: 0.3 },
  { id: "focus",     name: "Keen Focus",      icon: "spark",   rarity: 1, max: 6, text: "+15% spell damage.",                stat: "dmg", add: 0.15 },
  { id: "thrift",    name: "Thrift",          icon: "coin",    rarity: 1, max: 4, text: "Spells cost 12% less mana.",        stat: "cost", add: -0.12 },
  { id: "haste",     name: "Quickened Hand",  icon: "clock",   rarity: 1, max: 4, text: "Spells recover 12% faster.",        stat: "cd", add: -0.12 },
  { id: "swift",     name: "Swift Step",      icon: "boot",    rarity: 1, max: 4, text: "+10% move speed.",                  stat: "speed", add: 0.1 },
  { id: "shadow",    name: "Shadow Step",     icon: "dash",    rarity: 1, max: 3, text: "Dash recharges 25% faster.",        stat: "dashCd", add: -0.25 },
  { id: "ward",      name: "Ward",            icon: "shield",  rarity: 1, max: 4, text: "Take 10% less damage.",             stat: "armor", add: 0.1 },
  { id: "tailwind",  name: "Tailwind",        icon: "wind",    rarity: 1, max: 3, text: "Shots fly 20% faster and further.", stat: "shotSpeed", add: 0.2 },
  { id: "heavy",     name: "Heavy Hand",      icon: "fist",    rarity: 1, max: 3, text: "+40% knockback.",                   stat: "kb", add: 0.4 },
  { id: "kindle",    name: "Kindling",        icon: "flame",   rarity: 2, max: 3, text: "Burns deal 40% more.",              stat: "burn", add: 0.4 },
  { id: "rime",      name: "Rime",            icon: "flake",   rarity: 2, max: 2, text: "Chill slows harder and freezes sooner.", stat: "chill", add: 0.1 },
  { id: "siphon",    name: "Siphon",          icon: "leech",   rarity: 2, max: 3, text: "Kills restore 4 mana and 1 health.", stat: "siphon", add: 1 },
  { id: "magnet",    name: "Lodestone",       icon: "magnet",  rarity: 1, max: 2, text: "Pick things up from much further.", stat: "magnet", add: 0.7 },
  { id: "flask",     name: "Deep Flask",      icon: "flask",   rarity: 2, max: 2, text: "+1 potion slot, and a potion.",     stat: "potionCap", add: 1 },
  { id: "mend",      name: "Mending",         icon: "leaf",    rarity: 2, max: 3, text: "Regenerate 0.6 health a second.",   stat: "regen", add: 0.6 },
  { id: "echo",      name: "Echo",            icon: "echo",    rarity: 3, max: 2, text: "15% chance a cast repeats for free.", stat: "echo", add: 0.15 },
  { id: "phoenix",   name: "Phoenix Thread",  icon: "phoenix", rarity: 3, max: 1, text: "Once, rise again at half health.",  stat: "revive", add: 1 }
];
export const BOON_BY_ID = Object.fromEntries(BOONS.map((b) => [b.id, b]));
const WEIGHT = { 1: 10, 2: 5, 3: 2 };

/** Three different cards the player can still take, weighted by rarity.
 *  `taken` maps boon id → stacks already held. */
export function rollBoons(taken, n, rng) {
  rng = rng || Math.random;
  const pool = BOONS.filter((b) => (taken[b.id] || 0) < b.max);
  const out = [];
  while (out.length < (n || 3) && pool.length) {
    const total = pool.reduce((s, b) => s + WEIGHT[b.rarity], 0);
    let roll = rng() * total;
    let i = 0;
    for (; i < pool.length; i++) { roll -= WEIGHT[pool[i].rarity]; if (roll <= 0) break; }
    out.push(pool.splice(Math.min(i, pool.length - 1), 1)[0]);
  }
  return out;
}

export const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];

/* data.js — every table the game reads: enemies, bosses, gates, perks,
 * power-ups, the shop, skins, trophies and the Daily's rules.
 *
 * What a fun hypercasual shooter needs, as the design write-ups put it, is a
 * core loop that reads in a second (move, shoot, pick the better gate),
 * rewards that arrive steadily, a goal you can always see, layered
 * progression above the loop, and juice on top of a mechanic that already
 * works. So the loop is the ad's — gates that multiply a stream of balls —
 * and everything in this file is a layer on it: a horde with personalities
 * that each want a different answer, gates you can shoot to make better,
 * a draft of perks every few kills, Fever, bosses, a shop, a Daily. Each
 * entry carries one short line; the long explanations live in topics.js. */

/* ---------- the horde ----------
   hp is a multiple of the level's base health; v is pixels per second down
   the field; harm is hearts lost if it reaches the line. Every kind asks for
   something different: Shields soak a hit per ball no matter how heavy, so
   they want many small balls; Tanks want heavy ones; Splitters punish a
   stream that stops too early; Bombers reward letting them reach a crowd. */
export const ENEMY = {
  grunt:    { name: "Blob",     hp: 1,   r: 14, v: 26, xp: 1, coin: 1, harm: 1, color: "#ff5d8f", from: 1,  line: "Walks down. Gets hit. Goes pop." },
  runner:   { name: "Zoomer",   hp: 0.6, r: 11, v: 54, xp: 1, coin: 1, harm: 1, color: "#ffb02e", from: 2,  line: "Twice as fast, half as tough." },
  tank:     { name: "Chonk",    hp: 5,   r: 24, v: 15, xp: 4, coin: 4, harm: 2, color: "#8b6cff", from: 3,  line: "Slow, huge, costs two hearts." },
  shield:   { name: "Knight",   hp: 1.5, r: 17, v: 22, xp: 2, coin: 2, harm: 1, color: "#62c7ff", from: 4,  armor: 5, line: "Its shield stops one ball per point, however heavy." },
  splitter: { name: "Jelly",    hp: 2.4, r: 19, v: 22, xp: 2, coin: 2, harm: 1, color: "#3ee8b0", from: 6,  line: "Splits in two when popped." },
  bomber:   { name: "Boomer",   hp: 1.4, r: 16, v: 26, xp: 2, coin: 2, harm: 1, color: "#ff6b3d", from: 7,  line: "Explodes and hurts its neighbours." },
  healer:   { name: "Medic",    hp: 2,   r: 17, v: 20, xp: 3, coin: 3, harm: 1, color: "#9cff6b", from: 9,  line: "Heals everything around it. Pop it first." },
  gold:     { name: "Goldie",   hp: 3,   r: 13, v: 34, xp: 2, coin: 18, harm: 0, color: "#ffd23f", from: 1, line: "Runs off with the money. Harmless, rich." }
};

/* Bosses come at every fifth level in the campaign and every tenth wave
   in Endless. Each has one trick. */
export const BOSS = {
  king:  { name: "King Blob",    color: "#ff3d7f", trick: "spawns",  line: "Calls in his court." },
  golem: { name: "Brick Golem",  color: "#a58cff", trick: "wall",    line: "Builds walls of Knights." },
  hydra: { name: "The Hydra",    color: "#2fe0a0", trick: "split",   line: "Cut it in half and there are two." },
  magus: { name: "Gate Magus",   color: "#ffb02e", trick: "flip",    line: "Turns your best gate against you." }
};
export const BOSS_ORDER = ["king", "golem", "hydra", "magus"];

/* ---------- gates ----------
   A field gate acts on every ball that passes through it, once per ball. */
export const GATE = {
  mul:     { color: "#2fd67a", line: "Every ball through it becomes that many." },
  charge:  { color: "#3fa9ff", line: "Shoot through it to raise it, up to ×6." },
  div:     { color: "#ff4d5e", line: "Only one ball in that many gets through." },
  mystery: { color: "#b36bff", line: "Opens on the first ball. Could be ×10." },
  fire:    { color: "#ff7a1a", line: "Balls catch fire: more damage, and splash." },
  gold:    { color: "#ffc61a", line: "Golden balls: kills drop double coins." },
  big:     { color: "#25d9d9", line: "Giant balls: twice the damage." },
  ice:     { color: "#9fe8ff", line: "Icy balls slow whatever they hit." }
};

/* Pickup panels slide down toward the cannon in pairs; drive under one to
   take it. Every ball that hits a panel nudges its number up, so a bad
   panel can be shot into a good one — the ad's other trick. */
export const PICKUP = {
  volley: { label: "BALLS",  step: 0.09, unit: "",  min: -3,  max: 6,   line: "Balls per shot." },
  rate:   { label: "RATE",   step: 0.9,  unit: "%", min: -40, max: 100, line: "Shots per second." },
  dmg:    { label: "DAMAGE", step: 0.9,  unit: "%", min: -40, max: 100, line: "Damage per ball." }
};

/* ---------- power-ups, dropped by the horde; catch them with the cannon ---------- */
export const DROP = {
  rapid:  { name: "Rapid fire", color: "#ffd23f", w: 3,   t: 8,  line: "Double fire rate." },
  mega:   { name: "Mega balls", color: "#ff5d8f", w: 2,   t: 7,  line: "Triple damage." },
  twin:   { name: "Triple barrel", color: "#3fa9ff", w: 2, t: 10, line: "Three barrels at once." },
  freeze: { name: "Freeze",     color: "#9fe8ff", w: 1.5, t: 4,  line: "The whole horde, frozen." },
  bomb:   { name: "Bomb",       color: "#ff6b3d", w: 1,   t: 0,  line: "Hits everything on screen." },
  heart:  { name: "Heart",      color: "#ff3d5e", w: 1,   t: 0,  line: "One heart back." }
};

/* ---------- perks, drafted three at a time as the XP bar fills ---------- */
export const PERKS = {
  rapid:    { name: "Hair Trigger",  max: 6, icon: "bolt",    line: "+25% fire rate." },
  volley:   { name: "Extra Ball",    max: 6, icon: "balls",   line: "+1 ball per shot." },
  dmg:      { name: "Heavy Balls",   max: 6, icon: "weight",  line: "+30% damage." },
  pierce:   { name: "Drill Bits",    max: 3, icon: "drill",   line: "Balls go through one more enemy." },
  ricochet: { name: "Ricochet",      max: 3, icon: "bounce",  line: "Balls bounce off the top once more." },
  splash:   { name: "Splash",        max: 3, icon: "splash",  line: "Hits splash 30% to neighbours." },
  crit:     { name: "Lucky Strike",  max: 4, icon: "star",    line: "+12% critical chance." },
  homing:   { name: "Homing",        max: 2, icon: "target",  line: "Balls curve toward the horde." },
  shrapnel: { name: "Shrapnel",      max: 3, icon: "burst",   line: "Every kill throws 2 more balls." },
  frost:    { name: "Frostbite",     max: 3, icon: "snow",    line: "10% of hits freeze." },
  gates:    { name: "Gate Crasher",  max: 3, icon: "gate",    line: "Every × gate counts one higher." },
  magnet:   { name: "Magnet",        max: 2, icon: "magnet",  line: "Wider catch, more drops." },
  mirror:   { name: "Mirror Cannon", max: 1, icon: "mirror",  line: "A ghost cannon fires from the other side." },
  big:      { name: "Big Balls",     max: 3, icon: "bigball", line: "+35% size, +20% damage." },
  arc:      { name: "Static",        max: 3, icon: "zap",     line: "Crits arc to two more enemies." },
  heart:    { name: "Second Wind",   max: 9, icon: "heart",   line: "One heart back, one more maximum." },
  party:    { name: "Party Starter", max: 3, icon: "party",   line: "Fever fills 50% faster." },
  volatile: { name: "Volatile",      max: 2, icon: "boom",    line: "Everything explodes when popped." },
  rubber:   { name: "Rubber",        max: 3, icon: "rubber",  line: "Balls bounce off an enemy instead of vanishing." }
};

/* ---------- the shop: permanent, bought with coins ---------- */
export const UPGRADES = {
  rate:   { name: "Fire rate",     icon: "bolt",   base: 25,  grow: 1.32, max: 40, line: "+8% shots per second." },
  dmg:    { name: "Damage",        icon: "weight", base: 30,  grow: 1.33, max: 40, line: "+15% damage per ball." },
  volley: { name: "Barrels",       icon: "balls",  base: 150, grow: 2.1,  max: 8,  line: "+1 ball per shot." },
  crit:   { name: "Critical",      icon: "star",   base: 60,  grow: 1.45, max: 15, line: "+3% chance of a 2.5× hit." },
  speed:  { name: "Muzzle speed",  icon: "speed",  base: 40,  grow: 1.4,  max: 10, line: "+6% ball speed." },
  hearts: { name: "Hearts",        icon: "heart",  base: 300, grow: 3,    max: 3,  line: "+1 heart every level." },
  coin:   { name: "Coin magnet",   icon: "coin",   base: 70,  grow: 1.5,  max: 15, line: "+10% coins." },
  head:   { name: "Head start",    icon: "cards",  base: 500, grow: 3,    max: 2,  line: "A free perk draft at the start of a level." }
};
export function upgradeCost(id, lv) {
  const u = UPGRADES[id];
  return Math.round(u.base * Math.pow(u.grow, lv));
}

/* ---------- skins ---------- */
export const CANNONS = {
  classic: { name: "Classic",   body: "#3a3f58", trim: "#ffd23f", cost: 0 },
  bubble:  { name: "Bubblegum", body: "#ff6fa8", trim: "#fff2f8", cost: 400 },
  toxic:   { name: "Toxic",     body: "#1f3a2a", trim: "#6bff8f", cost: 800 },
  midnight:{ name: "Midnight",  body: "#141428", trim: "#8f7bff", cost: 1500 },
  lava:    { name: "Lava",      body: "#3a1410", trim: "#ff6b1a", cost: 3000 },
  gold:    { name: "Solid Gold",body: "#b8860b", trim: "#fff1a8", ach: "boss5" },
  rainbow: { name: "Rainbow",   body: "#222", trim: "rainbow", ach: "level25" }
};
export const BALLS = {
  classic: { name: "Pearl",    fill: "#ffffff", glow: "#bfe6ff", cost: 0 },
  candy:   { name: "Candy",    fill: "#ff8fc7", glow: "#ffd0e8", cost: 300 },
  lime:    { name: "Lime",     fill: "#b7ff5a", glow: "#e4ffb8", cost: 600 },
  eye:     { name: "Eyeball",  fill: "#ffffff", glow: "#ffd0d0", cost: 1200, eye: true },
  plasma:  { name: "Plasma",   fill: "#7af0ff", glow: "#2fb8ff", cost: 2500 },
  ember:   { name: "Ember",    fill: "#ffb347", glow: "#ff5a1a", ach: "fever3" },
  rainbow: { name: "Prism",    fill: "rainbow", glow: "#ffffff", ach: "pit" }
};

/* ---------- worlds: the backdrop turns every five levels ---------- */
export const WORLDS = [
  { name: "Bubble Bay",   top: "#2b1d5c", bot: "#14244a", grid: "#5b7bff", line: "#ff4d6d" },
  { name: "Neon Alley",   top: "#280a3a", bot: "#0a1030", grid: "#ff3dd2", line: "#ffe14d" },
  { name: "Lava Lanes",   top: "#3a0f0a", bot: "#1a0a14", grid: "#ff7a1a", line: "#ffd23f" },
  { name: "Frost Field",  top: "#0f2c4a", bot: "#0a1828", grid: "#9fe8ff", line: "#ff5d8f" },
  { name: "Toxic Tubes",  top: "#0f2a1a", bot: "#081410", grid: "#6bff8f", line: "#ff3d7f" },
  { name: "Golden Hour",  top: "#3a2a0a", bot: "#24120a", grid: "#ffd23f", line: "#ff3d5e" }
];

/* ---------- the Daily: one seed for everybody, and one twist ---------- */
export const MODIFIERS = {
  glass:  { name: "Glass Cannon", line: "Double damage, one heart." },
  swarm:  { name: "Swarm",        line: "Twice the horde at half the health." },
  storm:  { name: "Gate Storm",   line: "An extra row of gates, and every × is one higher." },
  giants: { name: "Giants",       line: "Everything is bigger, tougher, and worth double." },
  turbo:  { name: "Turbo",        line: "Everything runs a quarter faster." },
  payday: { name: "Payday",       line: "Triple coins, no power-ups." }
};

/* ---------- trophies ---------- */
export const ACH = {
  first:    { name: "First Pop",       line: "Pop your first blob." },
  x5:       { name: "High Five",       line: "Send a ball through a ×5." },
  jackpot:  { name: "Jackpot",         line: "Open a ×10 mystery gate." },
  pit:      { name: "Ball Pit",        line: "Have 1,000 balls in the air at once." },
  flip:     { name: "Shot Caller",     line: "Shoot a red panel until it turns blue." },
  boss:     { name: "Giant Slayer",    line: "Beat a boss." },
  boss5:    { name: "Royal Flush",     line: "Beat five bosses." },
  clean:    { name: "Untouchable",     line: "Finish a level without losing a heart." },
  fever3:   { name: "Fever Dream",     line: "Hit Fever three times in one level." },
  chain:    { name: "Chain Reaction",  line: "Pop 8 enemies with one explosion chain." },
  combo50:  { name: "Combo Breaker",   line: "Reach a 50 combo." },
  level10:  { name: "Getting Good",    line: "Clear level 10." },
  level25:  { name: "Ballistic",       line: "Clear level 25." },
  endless20:{ name: "Marathon",        line: "Reach wave 20 in Endless." },
  daily:    { name: "Daily Driver",    line: "Play a Daily." },
  revive:   { name: "No Ad Required",  line: "Use a free revive." },
  spender:  { name: "Big Spender",     line: "Spend 2,000 coins in the shop." },
  million:  { name: "Ball Factory",    line: "Fire 1,000,000 balls, all told." },
  wheel:    { name: "Spin Doctor",     line: "Stop the bonus wheel on ×5." }
};

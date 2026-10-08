/* data.js — every table in the design, in one place.
 *
 * Numbers here are the design document's starting values ("ready for
 * playtest tuning"). Code elsewhere reads them and never repeats them, so a
 * retune is an edit to this file only. tools/validate.js checks the tables
 * are complete: every type has an unlock, a cost and a draw, every biome has
 * weather and four critters, every Law leaves a Planet Trait. */

/* ---------- the grid ---------- */
export const PLOT = 10;            // tiles per side; the Tiny Plots law makes it 6
export const TILE = 32;            // world units per tile, for the renderer
export const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];   // 0 E, 1 S, 2 W, 3 N

/* ---------- tiles ---------- */
export const TILES = {
  soil:    { name: "Soil",     build: "any",   effect: "None. Most tiles are Soil." },
  rock:    { name: "Rock",     build: "none",  effect: "Clearing one costs 5% of the plot cost. Each cleared Rock has a 5% chance to drop a Mod." },
  river:   { name: "River",    build: "waterwheel", effect: "Moves motes downstream at 1.5 tiles/s for free." },
  lake:    { name: "Lake",     build: "none",  effect: "Blocks Tracks. Launchers throw over it." },
  ley:     { name: "Ley Line", build: "any",   effect: "A contraption on it gets ×1.5 Power." },
  node:    { name: "Node",     build: "extractor", effect: "Has a Hue, a Tier, and a Richness." },
  vent:    { name: "Vent",     build: "any",   effect: "A Kiln on it gets ×2 Power." },
  ice:     { name: "Ice",      build: "track", effect: "Tracks on Ice move motes 2× faster." },
  crystal: { name: "Crystal",  build: "any",   effect: "A contraption on it gets +2% Lucky chance." },
  cliff:   { name: "Cliff",    build: "none",  effect: "Only Launchers and Warp Pipes cross it." },
  gap:     { name: "Sky Gap",  build: "none",  effect: "Separates islands. Only Launchers and Warp Pipes cross it." },
  void:    { name: "Void",     build: "any",   effect: "Each minute it rolls one random effect, good or bad, for 60 s." },
  ruins:   { name: "Ruins",    build: "none",  effect: "A rubble site. Excavate it for loot." },
  star:    { name: "Starstone", build: "extractor", effect: "Left by a meteor for 5 minutes. An Extractor on it gets ×10 Power." }
};

/* ---------- hues ----------
   A hue is a set of primaries as bits. The output of a fusion holds every
   primary found in its inputs; Plain adds nothing. */
export const R = 1, Bl = 2, Y = 4;
export const HUES = {
  0: { name: "Plain", col: "#f4f1e6" },
  1: { name: "Red", col: "#ff5a4e" },
  2: { name: "Blue", col: "#4ea8ff" },
  4: { name: "Yellow", col: "#ffd23f" },
  3: { name: "Purple", col: "#b26bff" },
  6: { name: "Green", col: "#5fe08a" },
  5: { name: "Orange", col: "#ff9a3c" },
  7: { name: "Prismatic", col: "#ffffff" }
};
export const HUE_LIST = [0, 1, 2, 4, 3, 6, 5, 7];
export const primaries = (h) => (h & 1) + ((h >> 1) & 1) + ((h >> 2) & 1);
export const HUE_BONUS = [1, 1, 1.5, 3];   // by primaries in the output

/* ---------- mote looks ---------- */
export const TIER_LOOKS = ["Spark", "Orb", "Gem", "Star", "Comet", "Nova", "Nebula", "Galaxy"];
export const tierLook = (t) => TIER_LOOKS[(t - 1) % 8];
export const tierHalos = (t) => Math.floor((t - 1) / 8);

/* ---------- biomes ---------- */
export const BIOMES = {
  meadow:   { name: "Meadow", rings: [0, 2], hues: [0], special: ["river", "ley"], weather: ["clear", "rain"], bonus: "Bloom XP ×1.25", ground: "#6f8f4a" },
  ember:    { name: "Ember Wastes", rings: [2, Infinity], hues: [R], special: ["vent"], weather: ["clear", "heatwave"], bonus: "Kiln Power ×1.5", ground: "#9a5a3c" },
  tide:     { name: "Tidecoast", rings: [2, Infinity], hues: [Bl], special: ["river", "lake"], weather: ["clear", "rain", "fog", "storm"], bonus: "Waterwheel Power ×2", ground: "#4f8c8a" },
  dune:     { name: "Dune Sea", rings: [3, Infinity], hues: [Y], special: ["rock"], weather: ["clear", "sandstorm", "heatwave"], bonus: "Sun Dish Power ×2", ground: "#c9a960" },
  frost:    { name: "Frostreach", rings: [4, Infinity], hues: [Bl], special: ["ice"], weather: ["clear", "snow", "aurora"], bonus: "Moon Well Power ×2", ground: "#b8d4e6" },
  highland: { name: "Highlands", rings: [4, Infinity], hues: [R, Y], special: ["cliff"], weather: ["clear", "storm", "wind"], bonus: "Launcher Range +2", ground: "#7d8a64" },
  crystal:  { name: "Crystal Hollows", rings: [6, Infinity], hues: [3, 6, 5], special: ["crystal"], weather: ["clear", "aurora"], bonus: "Lucky chance +2%", ground: "#6c5a8f" },
  sky:      { name: "Skyreach", rings: [8, Infinity], hues: [7], special: ["gap"], weather: ["clear", "wind"], bonus: "Launcher Range ×2", ground: "#a9b8d8" },
  fringe:   { name: "The Fringe", rings: [12, Infinity], hues: [0, 1, 2, 4, 3, 6, 5, 7], special: ["void"], weather: ["clear", "rift"], bonus: "Void tiles everywhere", ground: "#3a2f4a" },
  anomaly:  { name: "Anomaly", rings: [16, Infinity], hues: [0, 1, 2, 4, 3, 6, 5, 7], special: ["mixed"], weather: ["clear", "rain", "fog", "heatwave", "sandstorm", "snow", "storm", "wind", "aurora", "rift"], bonus: "Two random World Law-style rules per plot", ground: "#4a3a5e" }
};
export const BIOME_KEYS = Object.keys(BIOMES);

/* Anomaly plots draw two rules from this pool, plus one more every 8 Rings.
   The pool is what makes the far world keep changing. */
export const ANOMALY_RULES = [
  { id: "fastTracks", name: "Quick ground", text: "Tracks ×2 speed here", good: true },
  { id: "slowTracks", name: "Thick air", text: "Tracks ×0.5 speed here" },
  { id: "hotKilns", name: "Old heat", text: "Kilns ×3 Power here", good: true },
  { id: "luckyAir", name: "Charmed air", text: "Lucky chance ×2 here", good: true },
  { id: "richNodes", name: "Deep veins", text: "Extractors ×4 Power here", good: true },
  { id: "dimSources", name: "Thin light", text: "Sources ×0.5 Power here" },
  { id: "eagerSources", name: "Restless springs", text: "Sources ×2 Tempo here", good: true },
  { id: "bloomRush", name: "Fertile rift", text: "Bloom XP ×3 here", good: true },
  { id: "noBloom", name: "Salted earth", text: "Bloom XP ×0.25 here" },
  { id: "greedyHearth", name: "Golden hearths", text: "Hearth sale ×2 here", good: true },
  { id: "fusionBoon", name: "Soft seams", text: "Fusion Bonus +0.5 here", good: true },
  { id: "chimeEcho", name: "Ringing stone", text: "Chimes need half the Charge here", good: true },
  { id: "heavyAir", name: "Heavy air", text: "Every Tempo ×0.75 here" },
  { id: "doubleStamp", name: "Ink and fire", text: "Processors ×1.5 Power here", good: true }
];

/* ---------- weather ---------- */
export const WEATHER = {
  clear:     { name: "Clear", effect: "No effect." },
  rain:      { name: "Rain", effect: "Waterwheel Power ×2. Bloom XP ×1.5." },
  fog:       { name: "Fog", effect: "Lucky chance ×1.5. Tempo −10%." },
  heatwave:  { name: "Heatwave", effect: "Kiln and Sun Dish Power ×1.5." },
  sandstorm: { name: "Sandstorm", effect: "Polisher Power ×2. Launcher Range −50%." },
  snow:      { name: "Snow", effect: "Track speed −25%. Moon Well Power ×1.5." },
  storm:     { name: "Storm", effect: "Storm Rods fire. Each strike gives +3 Charge to Chimes within 3 tiles." },
  wind:      { name: "Wind", effect: "Launcher Range +50%." },
  aurora:    { name: "Aurora", effect: "Lucky chance ×3.", night: true, rare: true },
  rift:      { name: "Rift", effect: "Void tiles roll a new effect every 20 s instead of every 60 s." },
  meteor:    { name: "Meteor Shower", effect: "3 to 8 meteors land on your plots. Each leaves a Starstone node for 5 minutes. An Extractor on Starstone gets ×10 Power." }
};

/* Void tiles: one random effect, good or bad, for 60 s. */
export const VOID_EFFECTS = [
  { id: "surge", text: "Power ×3", power: 3 },
  { id: "drain", text: "Power ×0.5", power: 0.5 },
  { id: "haste", text: "Tempo ×2", tempo: 2 },
  { id: "drag", text: "Tempo ×0.5", tempo: 0.5 },
  { id: "luck", text: "Lucky chance +5%", lucky: 0.05 },
  { id: "still", text: "Stopped", tempo: 0 },
  { id: "gild", text: "Power ×10", power: 10 },
  { id: "dull", text: "Power ×0.2", power: 0.2 }
];

/* ---------- Bloom ---------- */
export const BLOOM_NAMES = ["Barren", "Sprout", "Meadow", "Grove", "Wild", "Lush", "Radiant"];
export const bloomName = (n) => BLOOM_NAMES[Math.min(n, 6)] + (n > 6 ? " " + (n - 5) : "");

/* ---------- critters ----------
   kind is the effect; the design lists one critter per kind, and each biome
   has three common critters and one rare one that appears in only one kind
   of weather. */
export const CRITTER_KINDS = {
  lucky: "When it touches a contraption, that contraption gets +5% Lucky chance for 5 s.",
  stray: "Carries one Stray to the nearest Track.",
  kiln: "Sits on a Kiln. That Kiln gets +25% Power.",
  shore: "Carries motes along a shoreline at 1 tile/s, for free.",
  skink: "Gives ×1.1 Value to each mote it crosses, once per mote.",
  owl: "At night, Moon Wells within 3 tiles get +20% Tempo.",
  goat: "Stands on a Launcher. That Launcher gets +2 Range.",
  prism: "Turns a Plain mote it touches into a random primary hue."
};
export const CRITTERS = {
  firefly:     { name: "Firefly", biome: "meadow", kind: "lucky", col: "#f8f07a" },
  hopper:      { name: "Hopper", biome: "meadow", kind: "stray", col: "#9bd36a" },
  bumblebee:   { name: "Bumblebee", biome: "meadow", kind: "skink", col: "#ffcf3a" },
  dewhare:     { name: "Dew Hare", biome: "meadow", kind: "lucky", rare: "rain", col: "#dfe8ff" },
  newt:        { name: "Ember Newt", biome: "ember", kind: "kiln", col: "#ff6a3a" },
  cinder:      { name: "Cinder Beetle", biome: "ember", kind: "stray", col: "#5a2a20" },
  ashmoth:     { name: "Ash Moth", biome: "ember", kind: "lucky", col: "#cfc3b6" },
  phoenix:     { name: "Phoenix Chick", biome: "ember", kind: "kiln", rare: "heatwave", col: "#ffb03a" },
  crab:        { name: "Shore Crab", biome: "tide", kind: "shore", col: "#ff7a5a" },
  frog:        { name: "Tidepool Frog", biome: "tide", kind: "stray", col: "#5ad09a" },
  snail:       { name: "Sea-glass Snail", biome: "tide", kind: "skink", col: "#8ae0e8" },
  heron:       { name: "Mist Heron", biome: "tide", kind: "prism", rare: "fog", col: "#e8eef2" },
  skink:       { name: "Dune Skink", biome: "dune", kind: "skink", col: "#e0a050" },
  sandhopper:  { name: "Sand Hopper", biome: "dune", kind: "stray", col: "#d8c080" },
  scarab:      { name: "Glass Scarab", biome: "dune", kind: "lucky", col: "#4ae0c0" },
  djinn:       { name: "Dust Djinn", biome: "dune", kind: "skink", rare: "sandstorm", col: "#f0d8a0" },
  owl:         { name: "Snow Owl", biome: "frost", kind: "owl", col: "#f4f8ff" },
  fox:         { name: "Frost Fox", biome: "frost", kind: "stray", col: "#cfe2f4" },
  icemoth:     { name: "Ice Moth", biome: "frost", kind: "lucky", col: "#a8e0ff" },
  stag:        { name: "Aurora Stag", biome: "frost", kind: "owl", rare: "aurora", col: "#7affc8" },
  goat:        { name: "Storm Goat", biome: "highland", kind: "goat", col: "#c8c0b0" },
  marmot:      { name: "Crag Marmot", biome: "highland", kind: "stray", col: "#a07850" },
  kite:        { name: "Wind Kite", biome: "highland", kind: "goat", col: "#e8e0ff" },
  ram:         { name: "Thunder Ram", biome: "highland", kind: "goat", rare: "storm", col: "#ffe86a" },
  prismmoth:   { name: "Prism Moth", biome: "crystal", kind: "prism", col: "#e0a0ff" },
  mole:        { name: "Geode Mole", biome: "crystal", kind: "stray", col: "#806090" },
  bat:         { name: "Shard Bat", biome: "crystal", kind: "lucky", col: "#a070e0" },
  drake:       { name: "Crystal Drake", biome: "crystal", kind: "prism", rare: "aurora", col: "#c0f0ff" },
  ray:         { name: "Cloud Ray", biome: "sky", kind: "skink", col: "#e8f0ff" },
  finch:       { name: "Sky Finch", biome: "sky", kind: "stray", col: "#80c0ff" },
  wisp:        { name: "Wind Wisp", biome: "sky", kind: "lucky", col: "#f0fff8" },
  whale:       { name: "Zephyr Whale", biome: "sky", kind: "goat", rare: "wind", col: "#9ab0ff" },
  mite:        { name: "Void Mite", biome: "fringe", kind: "stray", col: "#8a5aff" },
  eel:         { name: "Rift Eel", biome: "fringe", kind: "skink", col: "#ff5ae0" },
  nullmoth:    { name: "Null Moth", biome: "fringe", kind: "lucky", col: "#202030" },
  wraith:      { name: "Echo Wraith", biome: "fringe", kind: "prism", rare: "rift", col: "#c0b0ff" },
  oddling:     { name: "Oddling", biome: "anomaly", kind: "lucky", col: "#ff8ad0" },
  paracat:     { name: "Paradox Cat", biome: "anomaly", kind: "skink", col: "#ffd0f0" },
  toad:        { name: "Mirror Toad", biome: "anomaly", kind: "stray", col: "#c0ffd0" },
  glitchfox:   { name: "Glitch Fox", biome: "anomaly", kind: "prism", rare: "meteor", col: "#7afff0" }
};

/* ---------- contraptions ----------
   fam: source, mover, processor, fuser, booster, hearth, hut, wonder,
   celestial. tempo is [base, cap] in actions per second. unlock is one of
   {start}, {glow: n} (Glow earned in one Season, ever), {season: n},
   {plot: biome or "river"}, {wonder}, {cosmos: node}. build and level are
   BuildBase and LevelBase in Glow. g is the Level cost growth. */
export const TYPES = {
  wellspring: { name: "Wellspring", fam: "source", size: 1, unlock: { start: true }, build: 45, level: 30, tempo: [0.5, 4], power: 1,
    rule: "Place it anywhere. Emits Plain T1 motes. Tap it to emit a mote now." },
  extractor: { name: "Extractor", fam: "source", size: 2, unlock: { glow: 2e3 }, build: 6e3, level: 2.4e3, tempo: [0.5, 4], power: 5,
    rule: "Must sit on a Node. The Node sets the Hue and Tier of its motes." },
  sundish: { name: "Sun Dish", fam: "source", size: 2, unlock: { season: 5 }, build: 1e9, level: 2.5e8, tempo: [1, 8], power: 3,
    rule: "Works by day only. Emits Yellow motes." },
  moonwell: { name: "Moon Well", fam: "source", size: 2, unlock: { season: 5 }, build: 1e9, level: 2.5e8, tempo: [1, 8], power: 3,
    rule: "Works by night only. Emits Blue motes." },
  stormrod: { name: "Storm Rod", fam: "source", size: 1, unlock: { plot: "highland" }, build: 5e4, level: 1.2e4, tempo: [1, 1], power: 10,
    rule: "Works only in a Storm. 20 Charged motes per lightning strike. Levels add +10% motes per burst." },

  track: { name: "Track", fam: "mover", size: 1, unlock: { start: true }, build: 5, level: 100, tempo: [2, 12], power: 4,
    rule: "Connects to its neighbors by itself. All Tracks share one Level. Milestone: +1 mote per tile." },
  splitter: { name: "Splitter", fam: "mover", size: 1, unlock: { glow: 100 }, build: 30, level: null, tempo: [2, 12], power: 0,
    rule: "Sends motes to its outputs in turn. From Season 2, it can filter by Hue, Tier, or Trait." },
  launcher: { name: "Launcher", fam: "mover", size: 1, unlock: { glow: 2.5e4 }, build: 6e4, level: 1.5e4, tempo: [1, 8], power: 4,
    rule: "Throws motes in an arc over anything. Milestone: +2 Range." },
  warppipe: { name: "Warp Pipe", fam: "mover", size: 1, unlock: { season: 4 }, build: 1e8, level: 2.5e7, tempo: [4, 24], power: 1,
    rule: "Placed in pairs. Moves motes from one end to the other at once. Milestone: +1 plot of Range." },

  polisher: { name: "Polisher", fam: "processor", size: 1, unlock: { glow: 25 }, build: 75, level: 45, tempo: [2, 12], power: 1.5, stamp: 1,
    rule: "The first processor. Sandstorm gives ×2 Power." },
  kiln: { name: "Kiln", fam: "processor", size: 2, unlock: { glow: 300 }, build: 900, level: 600, tempo: [1, 6], power: 3, stamp: 2,
    rule: "+20% Power for each Kiln next to it. A Vent tile gives ×2 Power." },
  charger: { name: "Charger", fam: "processor", size: 1, unlock: { season: 2 }, build: 3e5, level: 7.5e4, tempo: [2, 12], power: 2, stamp: 4,
    rule: "×2 and Charged. Charged motes feed Chimes as they pass." },
  mirror: { name: "Mirror", fam: "processor", size: 1, unlock: { season: 2 }, build: 3e5, level: 7.5e4, tempo: [2, 12], power: 0.1, stamp: 8,
    rule: "10% chance to make a copy of the mote. Above 100%, extra copies. Milestone: +2% chance." },
  prism: { name: "Prism", fam: "processor", size: 1, unlock: { season: 3 }, build: 1.5e7, level: 3.6e6, tempo: [2, 12], power: 0.5, stamp: 16,
    rule: "Splits a Plain mote into Red, Blue, and Yellow at 50% Value each. Milestone: +5% Value per split mote." },
  engraver: { name: "Engraver", fam: "processor", size: 1, unlock: { season: 3 }, build: 1.5e7, level: 3.6e6, tempo: [2, 12], power: 0.25, stamp: 32,
    rule: "×(1 + 0.25 per stamp already on the mote). Place it last." },
  hourglass: { name: "Hourglass", fam: "processor", size: 1, unlock: { season: 4 }, build: 1e8, level: 2.5e7, tempo: [2, 12], power: 0.02, stamp: 64,
    rule: "×(1 + 0.02 per second of age). Rewards long routes and loops." },
  gardenpress: { name: "Garden Press", fam: "processor", size: 2, unlock: { season: 4 }, build: 1e8, level: 2.5e7, tempo: [1, 6], power: 0.5, stamp: 128,
    rule: "×(1 + 0.5 per Bloom level of its own plot)." },
  waterwheel: { name: "Waterwheel", fam: "processor", size: 1, unlock: { plot: "river" }, build: 5e3, level: 1.5e3, tempo: [1, 1], power: 2, stamp: 256,
    rule: "Sits on a River. Stamps motes that float past at river speed. Rain gives ×2 Power." },

  fuser: { name: "Fuser", fam: "fuser", size: 2, unlock: { glow: 1e5 }, build: 2.4e5, level: 6e4, tempo: [4, 24], power: 1.25,
    rule: "4 motes of one Tier in, 1 mote of the next Tier out. Max input Tier = 1 + Level ÷ 50. Milestone: +0.05 Fusion Bonus." },

  lantern: { name: "Lantern", fam: "booster", size: 1, unlock: { glow: 1e3 }, build: 3e3, level: 900, tempo: null, power: 0.25, radius: 2,
    rule: "+25% Tempo in Radius 2. Doubles its strength at night. Milestone: +5% Tempo, and +1 Radius every 2nd Milestone." },
  chime: { name: "Chime", fam: "booster", size: 1, unlock: { glow: 1e4 }, build: 3e4, level: 8e3, tempo: null, power: 10, radius: 3,
    rule: "Rings at 10 Charge and gives one free action to every contraption in Radius 3. Milestone: −1 Charge needed, minimum 4." },
  sprinkler: { name: "Sprinkler", fam: "booster", size: 1, unlock: { season: 2 }, build: 3e5, level: 7.5e4, tempo: null, power: 2, radius: 3,
    rule: "Bloom XP ×2 in Radius 3. Critters spawn 2× faster there. Milestone: +1 Radius." },

  hearth: { name: "Hearth", fam: "hearth", size: 2, unlock: { start: true }, build: 450, level: 180, tempo: [4, 40], power: 1,
    rule: "Turns motes into Glow. Each Hearth has its own Combo and Hue Wish. Milestone: +0.5 sale multiplier." },
  tinkerhut: { name: "Tinker Hut", fam: "hut", size: 2, unlock: { glow: 2.5e4 }, build: 7.5e4, level: 2e4, tempo: null, power: 2,
    rule: "Houses 2 Tinkers. Each Level gives +5% Tinker speed. Milestone: +1 Tinker." },

  /* Wonders: one copy each, found in Ruins, kept in the Codex for ever. */
  clocktower: { name: "Clocktower", fam: "wonder", size: 3, unlock: { wonder: true }, build: 0, rule: "Every contraption in its plot gets +50% Tempo." },
  ferris: { name: "Ferris Loop", fam: "wonder", size: 3, unlock: { wonder: true }, build: 0, tempo: [4, 4], rule: "Motes ride 3 laps around it. Each lap gives ×1.2 Value." },
  gravity: { name: "Gravity Well", fam: "wonder", size: 3, unlock: { wonder: true }, build: 0, tempo: [4, 4], rule: "Pulls in Strays and missed Launcher shots within 6 tiles. Sends them out at ×1.5 Value." },
  echobell: { name: "Echo Bell", fam: "wonder", size: 1, unlock: { wonder: true }, build: 0, power: 10, radius: 3, rule: "A Chime that rings twice in each Chain." },
  wishing: { name: "Wishing Well", fam: "wonder", size: 2, unlock: { wonder: true }, build: 0, tempo: [8, 8], rule: "Each Lucky mote it takes in has a 2% chance to drop a Mod." },
  sundial: { name: "Sundial", fam: "wonder", size: 2, unlock: { wonder: true }, build: 0, rule: "Days in its plot last twice as long." },
  starforge: { name: "Star Forge", fam: "wonder", size: 4, unlock: { wonder: true }, build: 0, tempo: [8, 8], rule: "Takes motes of Tier 10 or higher. Every 1,000 motes add 1 Star at your next Eclipse." },
  orrery: { name: "Orrery", fam: "wonder", size: 3, unlock: { wonder: true }, build: 0, rule: "Its plot gets +100% Power for each Planet in your Cosmos." },

  /* Celestial Designs, from the Cosmos Tree. */
  cometlauncher: { name: "Comet Launcher", fam: "mover", size: 1, unlock: { cosmos: "celestial" }, build: 1e12, level: 2e11, tempo: [2, 16], power: 64,
    rule: "A Launcher with unlimited Range." },
  nebulakiln: { name: "Nebula Kiln", fam: "processor", size: 3, unlock: { cosmos: "celestial" }, build: 1e12, level: 2e11, tempo: [1, 6], power: 10, stamp: 2,
    rule: "A Kiln at ×10. Shares the Kiln stamp." },
  singularity: { name: "Singularity Hearth", fam: "hearth", size: 3, unlock: { cosmos: "celestial" }, build: 1e12, level: 2e11, tempo: [8, 80], power: 2,
    rule: "×2 sale multiplier. Takes any Tier." },

  /* The World Heart is placed once, after the first Eclipse. */
  worldheart: { name: "World Heart", fam: "heart", size: 5, unlock: { eclipse: 1 }, build: 0, tempo: [8, 8],
    rule: "Takes motes like a Hearth but pays no Glow. Grows in 7 Stages." }
};
export const TYPE_KEYS = Object.keys(TYPES);
export const WONDERS = TYPE_KEYS.filter((k) => TYPES[k].fam === "wonder");
export const BUILDABLE = TYPE_KEYS.filter((k) => !["wonder", "heart"].includes(TYPES[k].fam));
/* The 24 types in 7 families, the Celestials aside. */
export const CORE_TYPES = BUILDABLE.filter((k) => !TYPES[k].unlock.cosmos);
export const FAMILIES = [
  { id: "source", name: "Sources", line: "make motes" },
  { id: "mover", name: "Movers", line: "move motes" },
  { id: "processor", name: "Processors", line: "raise Value" },
  { id: "fuser", name: "Fuser", line: "raise Tier" },
  { id: "booster", name: "Boosters", line: "help nearby contraptions" },
  { id: "hearth", name: "Hearths", line: "sell motes" },
  { id: "hut", name: "Tinker Hut", line: "helpers" },
  { id: "wonder", name: "Wonders", line: "found in Ruins" }
];
export const levelGrowth = (k) => (TYPES[k].fam === "source" ? 1.15 : 1.2);

/* ---------- Materials ---------- */
export const MATERIALS = [
  { name: "Wood", col: "#8a6440", hi: "#b88a5a" },
  { name: "Copper", col: "#b0643a", hi: "#e89a6a" },
  { name: "Iron", col: "#6a7078", hi: "#a0a8b0" },
  { name: "Silver", col: "#b8c0c8", hi: "#f0f4f8" },
  { name: "Gold", col: "#d8a830", hi: "#ffe080" },
  { name: "Crystal", col: "#80c8e0", hi: "#e0f8ff" },
  { name: "Starmetal", col: "#5a4aa0", hi: "#c0b0ff" },
  { name: "Voidglass", col: "#2a1a3a", hi: "#ff7af0" }
];
export const materialOf = (level) => MATERIALS[Math.min(7, Math.floor(level / 25))];
export const starMarks = (level) => Math.max(0, Math.floor(level / 25) - 7);

/* ---------- Specializations, at Level 100 ---------- */
export const SPECS = {
  wellspring: [{ name: "Geyser", text: "Emits a burst of 8 motes every 8 s. Each burst gives +4 Charge to adjacent Chimes." }, { name: "Spring", text: "+50% Value with a steady flow." }],
  extractor: [{ name: "Deep Bore", text: "Node Tier +1." }, { name: "Wide Bore", text: "Also draws from Nodes next to it." }],
  kiln: [{ name: "Forge", text: "The Kiln heat bonus doubles to +40% per Kiln." }, { name: "Furnace", text: "×2 Tempo." }],
  fuser: [{ name: "Twin Fuser", text: "10% chance to make a second output mote." }, { name: "Rainbow Fuser", text: "Hue Bonus +50%." }],
  launcher: [{ name: "Cannon", text: "×2 Range." }, { name: "Juggler", text: "Throws to 3 targets in turn." }],
  chime: [{ name: "Carillon", text: "+2 Radius." }, { name: "Echo", text: "×2 Chain bonus." }],
  hearth: [{ name: "Market", text: "×2 sale multiplier, −50% Tempo." }, { name: "Bazaar", text: "A Hue Wish pays ×5 instead of ×3." }],
  polisher: [{ name: "Buffer", text: "+5% Lucky chance on its stamps." }, { name: "Burnisher", text: "×2 Power, −50% Tempo." }]
};

/* ---------- Workshop: Glow upgrades for one Season ---------- */
export const WORKSHOP = {
  polish:  { name: "Hearth Polish", text: "+10% all Glow", base: 1.5e4, at: { glow: 5e3 } },
  grease:  { name: "Track Grease", text: "+10% Track speed", base: 1.5e4, at: { glow: 5e3 } },
  fert:    { name: "Fertilizer", text: "+10% Bloom XP", base: 3e4, at: { glow: 1e4 } },
  survey:  { name: "Surveyor", text: "×0.95 plot cost", base: 3e4, at: { plot: 1 } },
  tuning:  { name: "Tempo Tuning", text: "+5% to every Tempo Cap", base: 5e4, at: { glow: 2.5e4 } },
  lens:    { name: "Lucky Lens", text: "+0.1% Lucky chance. Past 25%, each level gives half.", base: 1e5, at: { glow: 5e4 } },
  keeper:  { name: "Combo Keeper", text: "Combo decays 5% slower", base: 1e5, at: { glow: 5e4 } },
  flux:    { name: "Fusion Flux", text: "+0.02 Fusion Bonus", base: 5e5, at: { fuser: 1 } }
};
export const WORKSHOP_GROWTH = 2.5;

/* ---------- Mods ---------- */
export const RARITIES = ["Common", "Uncommon", "Rare", "Epic", "Legendary", "Mythic"];
export const rarityName = (r) => (r < 6 ? RARITIES[r] : "Ascended " + (r - 5));
export const rarityStrength = (r) => (r < 6 ? Math.pow(2, r) : 32 * Math.pow(2, r - 5));
export const RARITY_COLS = ["#c8c8c8", "#6adf7a", "#4ea8ff", "#b26bff", "#ffb83a", "#ff5a7a", "#7afff0"];
export const MODS = {
  swift:    { name: "Swift", text: "+5% Tempo. It can pass the Tempo Cap.", fits: "any" },
  mighty:   { name: "Mighty", text: "+5% Power", fits: "any" },
  lucky:    { name: "Lucky", text: "+0.5% Lucky chance", fits: "processor" },
  resonant: { name: "Resonant", text: "Each action gives +1 Charge to adjacent Chimes", fits: "any" },
  echo:     { name: "Echo", text: "2% chance to act twice", fits: "any" },
  rooted:   { name: "Rooted", text: "+2% Power per Bloom level of its plot", fits: "any" },
  farshot:  { name: "Far Shot", text: "+1 Range", fits: "launcher" },
  twin:     { name: "Twin", text: "+1% chance of a second output", fits: "fuser" }
};
export const MOD_KEYS = Object.keys(MODS);

/* ---------- Relics: permanent; duplicates raise the Relic Level ---------- */
export const RELICS = {
  hourglass: { name: "Cracked Hourglass", text: "Offline time cap +12 h" },
  fork:      { name: "Tuning Fork", text: "Chime Radius +1" },
  clover:    { name: "Four-Leaf Clover", text: "Lucky chance +0.5%" },
  compass:   { name: "Old Compass", text: "Plot cost ×0.95" },
  lightning: { name: "Bottled Lightning", text: "Storms come 25% more often" },
  glove:     { name: "Gardener's Glove", text: "Bloom XP +25%" },
  wrench:    { name: "Tinker's Wrench", text: "Tinker speed +15%" },
  mothlamp:  { name: "Moth Lantern", text: "Golden Moths come 15% more often" },
  shard:     { name: "Prism Shard", text: "Hue Bonus +10%" },
  emberheart:{ name: "Ember Heart", text: "Kiln heat bonus +5% per Kiln" }
};
export const RELIC_KEYS = Object.keys(RELICS);

/* ---------- Spectacle ---------- */
export const COMBO_LOOKS = [
  { at: 0, name: "Embers" }, { at: 100, name: "Small flame" }, { at: 300, name: "Tall flame" },
  { at: 1500, name: "Blue flame" }, { at: 25500, name: "White flame with sparks" }, { at: 6.5e6, name: "Starfire" }
];
export const PENTATONIC = [0, 2, 4, 7, 9];    // semitones: C D E G A
export const NOTE_NAMES = ["C", "D", "E", "G", "A"];

/* ---------- Tinkers ---------- */
export const JOBS = {
  builder:  { name: "Builder", text: "Builds Ghosts and Blueprint stamps in order, as soon as you can pay." },
  upgrader: { name: "Upgrader", text: "Buys Levels by the rule you pick." },
  courier:  { name: "Courier", text: "Carries Strays back to Tracks. Links two contraptions with no Track between them, 1 mote per trip." },
  scout:    { name: "Scout", text: "Claims the cheapest plot next to yours when you hold 3× its cost. Digs Ruins 2× faster." },
  keeper:   { name: "Keeper", text: "Catches Golden Moths at 50% of the Windfall. Collects Commission rewards." }
};
export const UPGRADER_RULES = { cheapest: "Cheapest", value: "Best value", bottleneck: "Fix the bottleneck", pinned: "Pinned list" };

/* ---------- Directives ---------- */
export const CONDITIONS = {
  glowX:    { text: "Glow ≥ X × the cost of the action", param: "x", def: 2 },
  combo:    { text: "Combo at a Hearth ≥ N", param: "n", def: 300 },
  seasonT:  { text: "Season time ≥ T minutes", param: "t", def: 10 },
  harvestX: { text: "Harvest gain ≥ X × current Seeds", param: "x", def: 2 },
  weather:  { text: "Weather in a biome = W", param: "w", def: "rain", biome: true },
  day:      { text: "It is day", param: null },
  night:    { text: "It is night", param: null },
  bloom:    { text: "Bloom of a plot ≥ L", param: "n", def: 3 },
  rush:     { text: "Rush meter ≥ P", param: "n", def: 80 }
};
export const ACTIONS = {
  levels:    { text: "Buy Levels of a type", param: "type", amount: true },
  blueprint: { text: "Build a Blueprint", param: "bp" },
  claim:     { text: "Claim the cheapest plot next to yours" },
  workshop:  { text: "Buy a Workshop upgrade", param: "ws" },
  group:     { text: "Turn a group of contraptions on or off", param: "group" },
  filter:    { text: "Set a Splitter filter", param: "group" },
  jar:       { text: "Open a Moth Jar" },
  harvest:   { text: "Harvest", gate: "selfSeeding" },
  eclipse:   { text: "Eclipse", gate: "crown" }
};

/* ---------- Goals ---------- */
export const WINDFALLS = [
  { id: "burst", name: "Glow Burst", text: "Gives 15 minutes of production at once", p: 0.40 },
  { id: "frenzy", name: "Frenzy", text: "×7 Glow for 60 s", p: 0.30 },
  { id: "luckyrain", name: "Lucky Rain", text: "×10 Lucky chance for 30 s", p: 0.15 },
  { id: "chainstorm", name: "Chain Storm", text: "Every Chime rings now", p: 0.10 },
  { id: "moddrop", name: "Mod Drop", text: "One Mod of Rare or better", p: 0.05 }
];

export const COMMISSIONS = {
  sellHue:  { text: (g) => "Sell " + g.n + " " + g.hueName + " motes", min: 10 },
  combo:    { text: (g) => "Hold Combo " + g.n + " at one Hearth for 60 s", min: 8 },
  chain:    { text: (g) => "Trigger a Chain of " + g.n + " Chimes", min: 10, needs: "chime" },
  lucky:    { text: (g) => "Sell one Lucky " + g.n + " mote", min: 15 },
  claim:    { text: (g) => "Claim a " + g.biomeName + " plot", min: 20 },
  tier:     { text: (g) => "Make a Tier " + g.n + " mote", min: 15, needs: "fuser" },
  glow:     { text: (g) => "Earn " + g.amountText + " Glow", min: 10 }
};

/* Feats: +1% Glow each, for ever. Tiered ones never end. */
export const FEAT_TIERS = {
  glow:  { text: (n) => "Earn 10^" + n + " Glow in one Season", from: 3 },
  combo: { text: (n) => "Reach Combo 10^" + n, from: 2 },
  tier:  { text: (n) => "Make a Tier " + n + " mote", from: 2 },
  chain: { text: (n) => "Trigger a Chain of " + n + " Chimes", from: 3 },
  lucky: { text: (n) => "Sell a Lucky " + n + " mote", from: 1 },
  plots: { text: (n) => "Own " + n + " plots in one Season", from: 2 }
};
/* Hidden Feats: their hints are in Lore pages. */
export const HIDDEN_FEATS = {
  nightshift: { name: "Night Shift", text: "Sell 1,000 motes in one night." },
  patience:   { name: "Patience", text: "Stamp a mote at least 120 s old." },
  rainbow:    { name: "Full Spectrum", text: "Sell a Prismatic mote." },
  supernova:  { name: "Supernova", text: "Sell a Lucky 4 mote." },
  zen:        { name: "Screensaver", text: "Leave Zen Mode running for 10 minutes." },
  overgrown:  { name: "Overgrown", text: "Raise one plot to Bloom 8." },
  mothcatcher:{ name: "Moth Catcher", text: "Catch 25 Golden Moths yourself." },
  riddle:     { name: "Riddle Solver", text: "Open a hidden Ruins site." }
};

/* ---------- Lore pages ----------
   Some carry a melody (Chime songs), some point at a plot and a pattern
   (Ruins riddles), some hint at hidden Feats or sales. */
export const LORE = [
  { id: "l1", title: "The grey", text: "Before the first Wellspring, the land kept no colour. It was not dead; it was waiting to be paid." },
  { id: "l2", title: "On Hearths", text: "A Hearth is a mouth that eats light and breathes warmth. Feed it what it wishes for, and it remembers." },
  { id: "l3", title: "The bell-maker's song", text: "She tuned five bells to the hills and they rang back:", melody: [0, 2, 4, 2, 0], wonder: "echobell" },
  { id: "l4", title: "A surveyor's note", text: "Two plots east of home there is a stone that hums when four lamps stand at its corners.", riddle: { px: 2, py: 0, pattern: "corners", type: "lantern" } },
  { id: "l5", title: "Night markets", text: "The old traders sold only after dark, a thousand lights in one night, and called it luck.", hint: "nightshift" },
  { id: "l6", title: "Rainbow under the lights", text: "When the sky burns green, a seven-times-fused rainbow sold at a Hearth buys something no Merchant carries.", hint: "hidden-sale" },
  { id: "l7", title: "The clockmaker", text: "Time is a Value too. The oldest light is the richest.", hint: "patience" },
  { id: "l8", title: "Carillon", text: "Up and down the hill, the bells said it twice:", melody: [4, 3, 2, 3, 4], wonder: "clocktower" },
  { id: "l9", title: "The well-digger", text: "One plot north and one west of home, the ground gives way to a ring of four Wellsprings.", riddle: { px: -1, py: -1, pattern: "ring", type: "wellspring" } },
  { id: "l10", title: "Weather-wise", text: "Every land has a shy creature that comes out in only one kind of sky." },
  { id: "l11", title: "Fusers", text: "Four become one, and the one is more than the four. That is the whole of the craft." },
  { id: "l12", title: "Stargazers", text: "The Sky keeps every Star you give it. Draw lines between them and the lines draw back." },
  { id: "l13", title: "Rising song", text: "A climbing scale wakes the oldest wells:", melody: [0, 1, 2, 3, 4], wonder: "wishing" },
  { id: "l14", title: "The slow screen", text: "Leave the world to itself for ten minutes and it will show you how it dreams.", hint: "zen" },
  { id: "l15", title: "A tinker's diary", text: "Three plots south of home, three Kilns in a row are a key.", riddle: { px: 0, py: 3, pattern: "row3", type: "kiln" } },
  { id: "l16", title: "Planets", text: "A world that is finished does not end. It rises, and it keeps watching." }
];

/* ---------- Seasons and the Seed Tree ---------- */
export const SEASON_KINDS = [
  { id: "spring", name: "Spring", rule: "Bloom XP ×2." },
  { id: "summer", name: "Summer", rule: "Days last 10 minutes and nights 2. Sun Dish Power ×1.5." },
  { id: "autumn", name: "Autumn", rule: "The Harvest that ends this Season gives +25% Seeds." },
  { id: "winter", name: "Winter", rule: "Days last 4 minutes and nights 8. Moon Well Power ×1.5. Snow comes twice as often." }
];

/* Node costs start at 5 Seeds; each node down a branch costs ×4 the one
   above it, and repeatable nodes cost ×2 per level. A node needs the one
   above it in its branch. max: null = no cap. */
export const SEED_TREE = [
  { id: "growth", name: "Growth", nodes: [
    { id: "fertile", name: "Fertile Soil", text: "+25% Glow per level, no cap.", max: null },
    { id: "deeproots", name: "Deep Roots", text: "Every claimed plot starts at Bloom 1 or higher.", max: 1 },
    { id: "sap", name: "Rising Sap", text: "+20% Bloom XP per level.", max: null } ] },
  { id: "hands", name: "Hands", nodes: [
    { id: "tinker", name: "Extra Hands", text: "+1 Tinker.", max: 5 },
    { id: "quick", name: "Quick Builders", text: "Builders work 2× faster.", max: 1 },
    { id: "slots", name: "Standing Orders", text: "+1 Directive slot.", max: 10 },
    { id: "selfseed", name: "Self-Seeding", text: "Unlocks the Harvest action in Directives.", max: 1 } ] },
  { id: "senses", name: "Senses", nodes: [
    { id: "rush", name: "Long Rush", text: "Rush +5 s and +10% strength per level, no cap.", max: null },
    { id: "luck", name: "Keen Eye", text: "Lucky chance +0.2% per level.", max: null },
    { id: "chimer", name: "Wide Bells", text: "Chime Radius +1.", max: 1 },
    { id: "combodecay", name: "Warm Coals", text: "Combo decays 10% slower.", max: 1 } ] },
  { id: "roads", name: "Roads", nodes: [
    { id: "plotcost", name: "Old Roads", text: "Plot cost ×0.9 per level.", max: null },
    { id: "ringstart", name: "Home Fields", text: "Start each Season with Ring 1 claimed.", max: 1 },
    { id: "ruinsgrade", name: "Antiquarian", text: "Ruins loot +1 grade.", max: 1 },
    { id: "vane", name: "Weather Vane", text: "Pick the next weather once per hour.", max: 1 } ] },
  { id: "memory", name: "Memory", nodes: [
    { id: "keep", name: "Muscle Memory", text: "Keep 10% of type Levels at Harvest.", max: 5 },
    { id: "offrate", name: "Night Watch", text: "Offline Rate +10%.", max: 5 },
    { id: "offcap", name: "Long Sleep", text: "Offline cap +1 day.", max: 6 } ] }
];

/* ---------- Eclipse: the Sky ----------
   The Sky is a chart of fixed Star Points. Each named Constellation owns
   its points and a few extra ones; a Star on an extra point of a finished
   Constellation adds +10% to its effect. */
export const CONSTELLATIONS = [
  { id: "lantern", name: "The Lantern", stars: 3, text: "×3 all Glow" },
  { id: "loom", name: "The Loom", stars: 4, text: "×2 Track speed and Launcher Tempo" },
  { id: "hare", name: "The Hare", stars: 5, text: "Each Season starts with 10 Levels on every type" },
  { id: "tinker", name: "The Tinker", stars: 6, text: "+3 Tinkers, and Tinkers work 2× faster" },
  { id: "bell", name: "The Bell", stars: 6, text: "Chimes need 2 less Charge. Chain bonus ×2." },
  { id: "crown", name: "The Crown", stars: 8, text: "Unlocks the Eclipse action in Directives" },
  { id: "serpent", name: "The Serpent", stars: 10, text: "Hue Bonus ×2" },
  { id: "gardener", name: "The Gardener", stars: 12, text: "An Eclipse no longer resets Overgrowth" },
  { id: "spiral", name: "The Spiral", stars: 15, text: "+5% Glow for every Star you own" }
];
export const CONSTELLATION_EXTRA = 3;
/* Wild Constellations: 16 Stars and up, generated for ever. */
export const WILD_EFFECTS = [
  { id: "glow", text: (m) => "×" + m + " all Glow" },
  { id: "tempo", text: (m) => "+" + Math.round((m - 1) * 100) + "% every Tempo" },
  { id: "lucky", text: (m) => "+" + ((m - 1) * 2).toFixed(1) + "% Lucky chance" },
  { id: "bloom", text: (m) => "×" + m + " Bloom XP" },
  { id: "seeds", text: (m) => "×" + m + " Seeds" }
];

export const TRIALS = {
  rails:    { name: "Rails", limit: "No Launchers or Warp Pipes", reward: "Track speed ×1.5" },
  solitude: { name: "Solitude", limit: "One Source and one Hearth", reward: "Hearth sale multiplier +1" },
  darkness: { name: "Darkness", limit: "Night lasts the whole Season", reward: "Moon Well Power ×2" },
  haste:    { name: "Haste", limit: "The Season ends after 15 minutes", reward: "+1 Tinker" },
  silence:  { name: "Silence", limit: "No Chimes", reward: "Chain bonus +50%" },
  grey:     { name: "Grey", limit: "Bloom stays at 0", reward: "Bloom XP ×2" }
};
export const TRIAL_GOAL = 1e7;    // Glow; each Rank multiplies it by 10

/* ---------- World Heart and Genesis ---------- */
export const HEART_STAGES = [
  { n: 1000, tier: 8 },
  { n: 1000, tier: 10, prism: true },
  { n: 100, tier: 12, lucky: 2 },
  { n: 100, tier: 14, prism: true },
  { n: 10, tier: 16 },
  { n: 10, tier: 18, prism: true, lucky: 3 },
  { n: 1, tier: 20, prism: true, name: "the Heartseed" }
];

export const COSMOS_TREE = [
  { id: "sky", name: "Starting Sky", text: "Each world starts with The Lantern complete.", max: 1, cost: 5 },
  { id: "eternal", name: "Eternal Seeds", text: "An Eclipse keeps 10% of your Seeds.", max: 5, cost: 10 },
  { id: "autoeclipse", name: "Auto-Eclipse", text: "Unlocks the Eclipse action in Directives from the start of each world.", max: 1, cost: 25 },
  { id: "headstart", name: "Head Start", text: "Each world starts with Ring 2 claimed.", max: 1, cost: 25 },
  { id: "heirloom", name: "Heirloom Levels", text: "Keep 1% of type Levels through an Eclipse (no cap).", max: null, cost: 15 },
  { id: "celestial", name: "Celestial Designs", text: "Unlocks Celestial contraptions: Comet Launcher, Nebula Kiln, Singularity Hearth.", max: 1, cost: 50 },
  { id: "mastery", name: "Law Mastery", text: "Choose from 4 World Laws instead of 3.", max: 1, cost: 40 },
  { id: "cosmictempo", name: "Cosmic Tempo", text: "+10% to every Tempo Cap per level (no cap).", max: null, cost: 20 }
];

export const LAWS = {
  eternalnight: { name: "Eternal Night", rule: "No day. Sun Dishes do not work. Moon Wells ×5.", trait: "Moon Well Power ×2" },
  archipelago:  { name: "Archipelago", rule: "Land is islands. Tracks cannot cross water. Launcher Range ×2.", trait: "Launcher Range +4" },
  tinyplots:    { name: "Tiny Plots", rule: "Plots are 6×6. Adjacency bonuses ×2.", trait: "Kiln heat bonus +20%" },
  heavymotes:   { name: "Heavy Motes", rule: "Tracks move at half speed. Mote Value ×3.", trait: "Track speed ×1.5" },
  chaoshues:    { name: "Chaos Hues", rule: "Fusers pick a random hue. The Prismatic Hue Bonus is ×6.", trait: "Hue Bonus +50%" },
  fragile:      { name: "Fragile Chains", rule: "Each Chime rings at most once per minute. Chain bonus ×5.", trait: "Chain bonus ×2" },
  wildgrowth:   { name: "Wild Growth", rule: "Bloom XP ×5. Rocks regrow on empty tiles.", trait: "Bloom XP ×2" },
  drought:      { name: "Lucky Drought", rule: "Lucky chance ÷4. Each Lucky level gives ×100.", trait: "Lucky chance +1%" },
  lonely:       { name: "Lonely Hearth", rule: "One Hearth only. Its sale multiplier is ×10.", trait: "Hearth sale multiplier +2" },
  shortseasons: { name: "Short Seasons", rule: "Seasons end at 20 minutes. Seeds ×3.", trait: "Seeds ×1.5" }
};
export const LAW_KEYS = Object.keys(LAWS);

/* ---------- pacing and timing ---------- */
export const DAY_S = 8 * 60, NIGHT_S = 4 * 60;
export const HARVEST_AT = 1e6;           // Glow in one Season, for the first Harvest
export const ECLIPSE_AT = 1e6;           // Seeds earned since the last Eclipse
export const PLOT_BASE = 900, PLOT_RING = 8, PLOT_SAME = 1.25;
export const BUILD_GROWTH = 1.8;
export const OFFLINE_CAP_H = 12;
export const MERCHANT_EVERY = 30 * 60, MERCHANT_STAY = 5 * 60;
export const COMMISSION_EVERY = 15 * 60;

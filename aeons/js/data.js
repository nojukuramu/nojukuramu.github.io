/* data.js — every number the game is balanced on, in one file.
 *
 * Nothing here runs; it is tables and the small formulas that turn an era or
 * a level into a stat. Units are not listed era by era: a unit *line* (the
 * worker, the foot soldier, the shooter, ...) has one set of base stats and a
 * name and a look for every era it exists in, and the era multiplies it. That
 * is how ten eras fit in one screen of numbers, and it is also what makes a
 * fight across eras come out right: an Ember club against Signal armour does
 * almost nothing, because both sides were scaled by the same curve.
 *
 * The pacing target is roughly fourteen hours from the first fire to every
 * line, every forge level and every building maxed. tools/validate.js prints
 * what maxing everything costs, so a change here shows up as a number. */

export const TILE = 32;          // world pixels per tile
export const CHUNK = 16;         // tiles per chunk side
export const TICK = 0.1;         // seconds per simulation step
export const ERA_GROWTH = 1.42;  // how much stronger each era is than the last

export const RES = ["gold", "wood", "stone", "oil", "aether"];
export const RES_NAME = { gold: "Gold", wood: "Wood", stone: "Stone", oil: "Oil", aether: "Aether" };
export const RES_ERA = { gold: 0, wood: 0, stone: 0, oil: 5, aether: 8 };

/* ---------------------------------------------------------------
   Eras. Index = era. `adv` is what it costs to *reach* this era from
   the one before; `phases` is how many enemy phases must be cleared
   first — the eras are earned in the field, not only bought.
   --------------------------------------------------------------- */
export const ERAS = [
  { name: "Ember",   age: "Age of Ember",   energy: "#ff9a3c", light: "#ffb35a", adv: null },
  { name: "Bronze",  age: "Age of Bronze",  energy: "#ffb347", light: "#ffbe63", adv: { cost: { gold: 400, wood: 500, stone: 150 }, time: 60, phases: 1 } },
  { name: "Iron",    age: "Age of Iron",    energy: "#ffd27a", light: "#ffc56e", adv: { cost: { gold: 1300, wood: 1300, stone: 500 }, time: 90, phases: 3 } },
  { name: "Crowns",  age: "Age of Crowns",  energy: "#9fd0ff", light: "#ffcf80", adv: { cost: { gold: 3200, wood: 2600, stone: 1400 }, time: 120, phases: 5 } },
  { name: "Powder",  age: "Age of Powder",  energy: "#ffe08a", light: "#ffd68c", adv: { cost: { gold: 7000, wood: 5000, stone: 3200 }, time: 150, phases: 8 } },
  { name: "Steam",   age: "Age of Steam",   energy: "#ffcf6b", light: "#ffe2a8", adv: { cost: { gold: 14000, wood: 9000, stone: 6500 }, time: 180, phases: 11 } },
  { name: "Engines", age: "Age of Engines", energy: "#fff2b0", light: "#fff0cc", adv: { cost: { gold: 25000, wood: 14000, stone: 11000, oil: 4000 }, time: 210, phases: 14 } },
  { name: "Signal",  age: "Age of Signal",  energy: "#62e8ff", light: "#d8f6ff", adv: { cost: { gold: 42000, wood: 20000, stone: 17000, oil: 12000 }, time: 240, phases: 18 } },
  { name: "Stars",   age: "Age of Stars",   energy: "#8da7ff", light: "#c9d4ff", adv: { cost: { gold: 64000, wood: 26000, stone: 26000, oil: 26000 }, time: 270, phases: 22 } },
  { name: "Aether",  age: "Age of Aether",  energy: "#d38bff", light: "#ecd0ff", adv: { cost: { gold: 95000, wood: 32000, stone: 40000, oil: 40000, aether: 12000 }, time: 300, phases: 27 } }
];
export const MAX_ERA = ERAS.length - 1;
export const eraMul = (e) => Math.pow(ERA_GROWTH, e);
export const supplyMax = (era) => 80 + 32 * era;

/* ---------------------------------------------------------------
   Unit lines. Base stats are at era-0 scale; a line that only
   begins later is still written at era-0 scale and the era lifts it.
   range/speed/sight in tiles; cd in seconds between blows.
   --------------------------------------------------------------- */
export const LINES = {
  worker: {
    from: ["hall", "outpost"], first: 0, supply: 1, cls: "inf", move: "land", time: 12,
    base: { hp: 40, atk: 3, cd: 1.2, range: 0.7, speed: 2.3, sight: 6, armor: 0 },
    cost: (e) => ({ gold: 50 * cm(e) }),
    names: ["Gatherer", "Hauler", "Artisan", "Peasant", "Settler", "Laborer", "Engineer", "Technician", "Constructor", "Weaver"],
    blurb: "Gathers, builds and repairs."
  },
  melee: {
    from: ["barracks"], first: 0, supply: 1, cls: "inf", move: "land", time: 16,
    base: { hp: 72, atk: 8, cd: 1.1, range: 0.75, speed: 2.2, sight: 7, armor: 1 },
    cost: (e) => ({ gold: 60 * cm(e), wood: 20 * cm(e) }),
    names: ["Clubber", "Spearman", "Legionary", "Man-at-Arms", "Grenadier", "Trooper", "Assault Infantry", "Exo-Trooper", "Plasma Lancer", "Aether Blade"],
    blurb: "Holds the line."
  },
  ranged: {
    from: ["barracks"], first: 0, supply: 1, cls: "inf", move: "land", time: 18,
    base: { hp: 46, atk: 6.5, cd: 1.4, range: 4.5, speed: 2.2, sight: 8, armor: 0 },
    cost: (e) => ({ gold: 40 * cm(e), wood: 45 * cm(e) }),
    names: ["Slinger", "Bowman", "Archer", "Crossbowman", "Musketeer", "Rifleman", "Marksman", "Railgunner", "Photon Archer", "Starcaller"],
    shot: ["stone", "arrow", "arrow", "bolt", "musket", "bullet", "bullet", "rail", "photon", "star"],
    hitsAir: 5, blurb: "Shoots from behind the line. Hits aircraft from the Age of Steam."
  },
  mender: {
    from: ["barracks"], first: 2, supply: 1, cls: "inf", move: "land", time: 22, heals: true,
    base: { hp: 50, atk: 5, cd: 1.5, range: 3.5, speed: 2.1, sight: 8, armor: 0 },
    cost: (e) => ({ gold: 80 * cm(e), wood: 20 * cm(e) }),
    names: ["", "", "Healer", "Friar", "Apothecary", "Medic", "Field Medic", "Nanite Medic", "Lightwright", "Mender of Threads"],
    blurb: "Heals the wounded nearby, without being told."
  },
  mounted: {
    from: ["stable"], first: 1, supply: 2, cls: "mnt", move: "land", time: 26,
    base: { hp: 140, atk: 12, cd: 1.3, range: 0.8, speed: 3.4, sight: 8, armor: 2 },
    cost: (e) => ({ gold: 110 * cm(e), wood: 50 * cm(e), oil: e >= 5 ? 40 * cm(e - 4) : 0 }),
    names: ["", "Chariot", "Horseman", "Knight", "Dragoon", "Armored Car", "Battle Tank", "Hover Tank", "Grav Tank", "Colossus"],
    shot: ["", "", "", "", "", "bullet", "shell", "shell", "plasma", "aether"],
    ranged: 5, splash: 6, mech: 5,
    blurb: "Fast and heavy. Becomes armour once engines arrive."
  },
  siege: {
    from: ["workshop"], first: 1, supply: 3, cls: "sie", move: "land", time: 35, vsBld: 3, mech: 1,
    base: { hp: 120, atk: 28, cd: 3.4, range: 7.5, speed: 1.4, sight: 8, armor: 3, minRange: 2 },
    cost: (e) => ({ wood: 150 * cm(e), gold: 80 * cm(e), stone: 40 * cm(e), oil: e >= 5 ? 60 * cm(e - 4) : 0 }),
    names: ["", "Ram", "Onager", "Trebuchet", "Cannon", "Field Gun", "Rocket Battery", "Missile Rig", "Lance Array", "Singularity Engine"],
    shot: ["", "", "boulder", "boulder", "shell", "shell", "rocket", "missile", "lance", "singularity"],
    splash: 1, blurb: "Breaks walls and crowds. Keep it behind your army."
  },
  naval: {
    from: ["shipyard"], first: 1, supply: 3, cls: "nav", move: "naval", time: 32, mech: 1,
    base: { hp: 160, atk: 11, cd: 1.8, range: 4.8, speed: 2.6, sight: 9, armor: 2 },
    cost: (e) => ({ wood: 140 * cm(e), gold: 60 * cm(e), oil: e >= 5 ? 50 * cm(e - 4) : 0 }),
    names: ["", "War Canoe", "Bireme", "Cog", "Galleon", "Ironclad", "Destroyer", "Stealth Frigate", "Tide Cutter", "Leviathan"],
    shot: ["", "spear", "arrow", "bolt", "shell", "shell", "shell", "missile", "plasma", "aether"],
    hitsAir: 6, blurb: "Rules the water and shells the shore."
  },
  air: {
    from: ["airfield"], first: 6, supply: 3, cls: "air", move: "air", time: 34, mech: 1, hitsAir: 6,
    base: { hp: 34, atk: 4.4, cd: 1.2, range: 4.2, speed: 4.2, sight: 10, armor: 0.6 },
    cost: (e) => ({ gold: 160 * cm(e), oil: 120 * cm(e - 4), aether: e >= 9 ? 60 * cm(e - 8) : 0 }),
    names: ["", "", "", "", "", "", "Gunship", "Interceptor", "Starfighter", "Seraph"],
    shot: ["", "", "", "", "", "", "bullet", "laser", "plasma", "aether"],
    blurb: "Flies over everything. Only some things can shoot back."
  }
};
function cm(e) { return Math.round(Math.pow(1.33, Math.max(0, e)) * 100) / 100; }
export const costMul = cm;
export const LINE_IDS = Object.keys(LINES);

/** A unit of line L at tier e: its stats, before upgrades. */
export function lineStats(id, e) {
  const L = LINES[id], b = L.base, m = eraMul(e);
  const s = {
    hp: Math.round(b.hp * m), atk: b.atk * m, cd: b.cd, armor: b.armor * m,
    range: b.range, speed: b.speed * (1 + 0.03 * e), sight: b.sight + Math.floor(e / 3),
    minRange: 0, splash: 0, shot: "", air: L.move === "air", naval: L.move === "naval", mech: false, hitsAir: false
  };
  if (id === "ranged") s.range = b.range + 0.2 * e;
  if (L.shot) s.shot = L.shot[e] || "";
  if (L.hitsAir !== undefined) s.hitsAir = e >= L.hitsAir;
  if (L.mech !== undefined) s.mech = e >= L.mech;
  if (id === "mounted" && e >= L.ranged) { s.range = 3.6 + 0.2 * (e - 5); s.cd = 1.6; s.speed = b.speed * 0.9 * (1 + 0.03 * e); }
  if (id === "mounted" && e >= L.splash) s.splash = 0.8;
  if (id === "siege") {
    if (e <= 1) { s.range = 0.9; s.minRange = 0; s.atk *= 1.3; s.vsBld = 5; s.siegeMeleeOnly = true; }
    else { s.minRange = b.minRange; s.splash = 1.2 + 0.08 * e; s.range = b.range + 0.25 * (e - 2); s.vsBld = 3; }
  }
  if (id === "naval" && e >= 4) s.splash = 0.5;
  if (id === "air" && e >= 8) s.splash = 0.6;
  return s;
}

/* ---------------------------------------------------------------
   Buildings. Stats are at level 1; a building's level is also the
   era it is drawn in (level 1 = Ember look ... level 10 = Aether), and
   no building can be upgraded past the era you have reached.
   --------------------------------------------------------------- */
export const BUILDINGS = {
  hall:     { w: 4, h: 4, first: 0, hp: 1400, armor: 4, time: 90, cost: { gold: 500, wood: 500, stone: 200 }, territory: 14, sight: 10, supply: 10, drop: ["gold", "wood", "stone"], trains: ["worker"], unique: true,
              names: ["Hearth", "Longhouse", "Great Hall", "Keep", "Citadel", "Capitol", "Headquarters", "Nexus", "Spire", "Sanctum"], blurb: "Your seat. Trains workers, takes every resource, and leads you into the next era." },
  house:    { w: 2, h: 2, first: 0, hp: 320, armor: 2, time: 20, cost: { wood: 60 }, sight: 3, supply: 6, supplyPerLevel: 3,
              names: ["Hut", "Mudhouse", "Villa", "Cottage", "Townhouse", "Tenement", "Apartments", "Habitat", "Arcology Pod", "Dreamhouse"], blurb: "Supply for more units." },
  barracks: { w: 3, h: 3, first: 0, hp: 750, armor: 3, time: 45, cost: { wood: 160, gold: 40 }, sight: 5, trains: ["melee", "ranged", "mender"],
              names: ["War Camp", "Drill Yard", "Barracks", "Barracks", "Garrison", "Depot", "Base", "Training Grid", "Muster Spire", "Hall of Echoes"], blurb: "Foot soldiers, shooters and menders." },
  lumber:   { w: 2, h: 2, first: 0, hp: 450, armor: 2, time: 30, cost: { wood: 90 }, sight: 4, drop: ["wood"],
              names: ["Woodpile", "Wood Camp", "Lumber Camp", "Lumber Mill", "Sawmill", "Steam Mill", "Timber Works", "Fibre Plant", "Growth Vat", "Rootwell"], blurb: "Drops wood. Researches better felling." },
  mine:     { w: 2, h: 2, first: 0, hp: 450, armor: 2, time: 30, cost: { wood: 90 }, sight: 4, drop: ["gold", "stone"],
              names: ["Rock Pile", "Ore Camp", "Mining Camp", "Mine Works", "Smeltery", "Ore Refinery", "Processing Plant", "Mass Extractor", "Matter Press", "Dust Cradle"], blurb: "Drops gold and stone. Researches better mining." },
  forge:    { w: 3, h: 3, first: 0, hp: 650, armor: 3, time: 50, cost: { wood: 160, gold: 80, stone: 40 }, sight: 4,
              names: ["Knapping Pit", "Bronze Pit", "Smithy", "Armory", "Foundry", "Iron Works", "Arsenal", "Fabricator", "Star Forge", "Loom"], blurb: "Weapon and armour upgrades for foot soldiers and towers." },
  tower:    { w: 2, h: 2, first: 0, hp: 520, armor: 5, time: 40, cost: { wood: 70, stone: 90 }, sight: 9, anywhere: true,
              attack: { atk: 9, cd: 1.4, range: 6.2 }, shots: ["arrow", "arrow", "arrow", "bolt", "shell", "bullet", "missile", "laser", "ion", "aether"], hitsAirFrom: 5,
              names: ["Watch Post", "Lookout", "Watchtower", "Guard Tower", "Cannon Tower", "Bunker", "Missile Turret", "Laser Turret", "Ion Spire", "Aether Ward"], blurb: "Shoots whatever comes near. Can stand outside your borders." },
  wall:     { w: 1, h: 1, first: 0, hp: 380, armor: 8, time: 6, cost: { stone: 10 }, sight: 2, anywhere: true, wall: true,
              names: ["Palisade", "Mud Wall", "Stone Wall", "Curtain Wall", "Star Fort Wall", "Iron Fence", "Barrier", "Hardlight Fence", "Field Wall", "Thread Ward"], blurb: "Blocks the way. Drag to lay a line of it." },
  outpost:  { w: 3, h: 3, first: 0, hp: 760, armor: 4, time: 60, cost: { wood: 220, gold: 120, stone: 60 }, territory: 9, sight: 11, drop: ["gold", "wood", "stone"], trains: ["worker"], anywhere: true,
              attack: { atk: 5, cd: 1.6, range: 5 }, shots: ["arrow", "arrow", "arrow", "bolt", "musket", "bullet", "bullet", "laser", "photon", "aether"], hitsAirFrom: 6,
              names: ["Fire Ring", "Stockade", "Outpost", "Motte", "Fort", "Station", "Forward Base", "Relay", "Beachhead", "Anchor"], blurb: "Claims new ground: a border, a drop-off, and eyes. Build it anywhere you have seen." },
  altar:    { w: 3, h: 3, first: 0, hp: 700, armor: 3, time: 60, cost: { gold: 200, wood: 150, stone: 60 }, sight: 5, unique: true,
              names: ["Ancestor Stone", "Shrine", "Temple", "Hall of Champions", "Pantheon", "Memorial", "Command Center", "Avatar Lab", "Ascendancy", "Choir of Names"], blurb: "Calls champions, and brings the fallen back." },
  academy:  { w: 3, h: 3, first: 0, hp: 620, armor: 3, time: 55, cost: { wood: 200, gold: 100 }, sight: 5, unique: true,
              names: ["Elder Circle", "House of Tablets", "Lyceum", "Scriptorium", "College", "Institute", "Laboratory", "Data Core", "Observatory", "Archive of Tomorrow"], blurb: "Doctrines: the automation that lets one hand hold a large realm." },
  stable:   { w: 3, h: 3, first: 1, hp: 720, armor: 3, time: 50, cost: { wood: 200, gold: 100 }, sight: 5, trains: ["mounted"],
              names: ["", "Pen", "Stable", "Stables", "Cavalry Yard", "Motor Pool", "Tank Plant", "Hover Works", "Grav Foundry", "Colossus Cradle"], blurb: "Mounts, then armour." },
  workshop: { w: 3, h: 3, first: 1, hp: 720, armor: 3, time: 55, cost: { wood: 220, gold: 80, stone: 60 }, sight: 5, trains: ["siege"],
              names: ["", "Carpenter", "Siege Yard", "Siege Workshop", "Gun Foundry", "Artillery Works", "Rocket Plant", "Missile Works", "Lance Works", "Engine of Ends"], blurb: "Siege." },
  shipyard: { w: 3, h: 3, first: 1, hp: 720, armor: 3, time: 55, cost: { wood: 260, gold: 60 }, sight: 7, trains: ["naval"], coastal: true, drop: ["wood"],
              names: ["", "Boat Shed", "Shipwright", "Shipyard", "Dockyard", "Naval Yard", "Navy Base", "Drydock", "Tide Port", "Deep Gate"], blurb: "Warships. Must touch the water." },
  airfield: { w: 4, h: 4, first: 6, hp: 1100, armor: 4, time: 70, cost: { gold: 300, stone: 150, oil: 120 }, sight: 7, trains: ["air"],
              names: ["", "", "", "", "", "", "Airfield", "Air Base", "Launch Deck", "Skyward"], blurb: "Aircraft." },
  radar:    { w: 2, h: 2, first: 5, hp: 420, armor: 2, time: 45, cost: { gold: 200, stone: 150 }, sight: 6, detect: 36, anywhere: true,
              names: ["", "", "", "", "", "Listening Post", "Radar", "Sensor Array", "Deep Scanner", "Seeing Eye"], blurb: "Tracks enemy movement far past what it can see." },
  derrick:  { w: 2, h: 2, first: 5, hp: 520, armor: 2, time: 45, cost: { wood: 150, gold: 150 }, sight: 4, onNode: "oil", produces: { oil: 1.0 }, anywhere: true,
              names: ["", "", "", "", "", "Derrick", "Oil Rig", "Pump Station", "Crude Synth", "Black Well"], blurb: "Pumps oil from a seep, forever." },
  siphon:   { w: 2, h: 2, first: 8, hp: 600, armor: 3, time: 60, cost: { gold: 400, stone: 200, oil: 200 }, sight: 4, onNode: "aether", produces: { aether: 0.6 }, anywhere: true,
              names: ["", "", "", "", "", "", "", "", "Siphon", "Wellspring"], blurb: "Draws aether from a shard, forever." },
  beacon:   { w: 5, h: 5, first: 9, hp: 9000, armor: 10, time: 600, cost: { gold: 400000, wood: 150000, stone: 220000, oil: 160000, aether: 80000 }, sight: 14, unique: true, noLevel: true,
              names: ["", "", "", "", "", "", "", "", "", "The Beacon"], blurb: "Light it, and something on the other side will answer." }
};
export const BLD_IDS = Object.keys(BUILDINGS);
const bldCostScale = (b) => Math.pow(1.35, b.first);

export function bldCost(id) {
  const b = BUILDINGS[id], k = id === "beacon" ? 1 : bldCostScale(b), out = {};
  for (const r in b.cost) out[r] = Math.round(b.cost[r] * k);
  return out;
}
/** Upgrading to level L (2..10). */
export function levelCost(id, L) {
  const base = bldCost(id), k = 0.9 * Math.pow(1.55, L - 2), out = {};
  for (const r in base) out[r] = Math.round(base[r] * k);
  if (L >= 6 && !out.oil) out.oil = Math.round((base.gold || base.wood || 100) * 0.3 * Math.pow(1.5, L - 6));
  if (L >= 9 && !out.aether) out.aether = Math.round(40 * Math.pow(1.6, L - 9));
  return out;
}
export const levelTime = (id, L) => Math.round(BUILDINGS[id].time * (0.8 + 0.45 * L));
export const bldHp = (id, L) => Math.round(BUILDINGS[id].hp * eraMul(L - 1));
export const bldArmor = (id, L) => BUILDINGS[id].armor * eraMul(L - 1);
export const maxLevel = (era) => Math.min(10, era + 1);

/* ---------------------------------------------------------------
   Research. Generated rather than listed: a category and a level make
   an id like "inf_atk:7". Every tech says where it is researched.
   --------------------------------------------------------------- */
export const TECH_CATS = {
  inf_atk: { at: "forge", max: 20, name: "Weapons", icon: "sword", lines: ["melee", "ranged", "mender", "worker"], kind: "atk", base: { gold: 100, wood: 60 } },
  inf_arm: { at: "forge", max: 20, name: "Armour", icon: "shield", lines: ["melee", "ranged", "mender", "worker"], kind: "arm", base: { gold: 90, stone: 50 } },
  tower:   { at: "forge", max: 20, name: "Fortification", icon: "tower", kind: "tower", base: { stone: 100, wood: 60 } },
  mnt_atk: { at: "stable", max: 18, first: 1, name: "Mount Weapons", icon: "sword", lines: ["mounted"], kind: "atk", base: { gold: 120, wood: 60 } },
  mnt_arm: { at: "stable", max: 18, first: 1, name: "Barding", icon: "shield", lines: ["mounted"], kind: "arm", base: { gold: 120, stone: 60 } },
  sie_atk: { at: "workshop", max: 18, first: 1, name: "Ballistics", icon: "blast", lines: ["siege"], kind: "atk", base: { wood: 140, gold: 80 } },
  nav_atk: { at: "shipyard", max: 18, first: 1, name: "Naval Guns", icon: "sword", lines: ["naval"], kind: "atk", base: { wood: 140, gold: 80 } },
  nav_arm: { at: "shipyard", max: 18, first: 1, name: "Hull", icon: "shield", lines: ["naval"], kind: "arm", base: { wood: 140, stone: 60 } },
  air_atk: { at: "airfield", max: 8, first: 6, name: "Avionics", icon: "sword", lines: ["air"], kind: "atk", base: { gold: 160, oil: 100 } },
  air_arm: { at: "airfield", max: 8, first: 6, name: "Airframes", icon: "shield", lines: ["air"], kind: "arm", base: { gold: 160, oil: 100 } },
  wood:    { at: "lumber", max: 10, name: "Felling", icon: "axe", kind: "gather", res: "wood", base: { wood: 80, gold: 60 } },
  gold:    { at: "mine", max: 10, name: "Prospecting", icon: "pick", kind: "gather", res: "gold", base: { wood: 80, gold: 60 } },
  stone:   { at: "mine", max: 10, name: "Quarrying", icon: "pick", kind: "gather", res: "stone", base: { wood: 80, gold: 60 } },
  haul:    { at: "hall", max: 10, name: "Haulage", icon: "cart", kind: "haul", base: { wood: 90, gold: 90 } },
  masonry: { at: "academy", max: 10, name: "Masonry", icon: "wall", kind: "masonry", base: { stone: 120, wood: 80 } },
  optics:  { at: "academy", max: 5, name: "Optics", icon: "eye", kind: "optics", base: { gold: 150, stone: 80 } }
};
/** The era a category's level L opens in. */
export function techEra(cat, L) {
  const c = TECH_CATS[cat], first = c.first || 0;
  if (c.max >= 18) return Math.min(9, first + Math.floor((L - 1) * (10 - first) / c.max));
  if (c.max === 5) return Math.min(9, (L - 1) * 2);
  if (c.max === 8) return Math.min(9, first + Math.floor((L - 1) / 3));
  return Math.min(9, L - 1);
}
export function techCost(cat, L) {
  const c = TECH_CATS[cat], k = Math.pow(c.max >= 18 ? 1.36 : 1.62, L - 1) * Math.pow(1.35, c.first || 0), out = {};
  for (const r in c.base) out[r] = Math.round(c.base[r] * k);
  const e = techEra(cat, L);
  if (e >= 6 && !out.oil) out.oil = Math.round(60 * Math.pow(1.45, e - 5));
  if (e >= 9 && !out.aether) out.aether = Math.round(80 * Math.pow(1.4, L - 1) / 20);
  return out;
}
export const techTime = (cat, L) => Math.round(25 + 9 * L);
/* What a level of each kind does. */
export const ATK_PER_LEVEL = 0.1;        // +10% damage
export const ARM_PER_LEVEL = 0.025;      // -2.5% damage taken
export const GATHER_PER_LEVEL = 0.12;    // +12% carried per trip
export const HAUL_PER_LEVEL = 0.05;      // +5% worker speed and +5% carried

/** Refits: a line's tier, the version of it a building trains. */
export function refitCost(line, e) {
  const c = LINES[line].cost(e), out = {};
  for (const r in c) if (c[r]) out[r] = Math.round(c[r] * 6);
  return out;
}
export const refitTime = (line, e) => 40 + 10 * e;

/* ---------------------------------------------------------------
   Doctrines — the automation. One-time research at the academy.
   --------------------------------------------------------------- */
export const DOCTRINES = {
  foreman:   { era: 0, cost: { gold: 120, wood: 120 }, time: 40, name: "Foremen", icon: "pick", line: "Idle workers find work on their own." },
  scouts:    { era: 0, cost: { gold: 80, wood: 60 }, time: 30, name: "Pathfinders", icon: "compass", line: "A Scout stance: units that explore by themselves." },
  quarter:   { era: 1, cost: { gold: 250, wood: 300 }, time: 60, name: "Quartermasters", icon: "house", line: "Houses are raised before supply runs out." },
  signal:    { era: 1, cost: { gold: 300, wood: 200, stone: 100 }, time: 60, name: "Signal Fires", icon: "alert", line: "Idle soldiers answer alarms near them." },
  repair:    { era: 2, cost: { gold: 500, wood: 500 }, time: 70, name: "Wardens of Stone", icon: "hammer", line: "Workers repair damage in your borders." },
  governor:  { era: 2, cost: { gold: 700, wood: 500, stone: 300 }, time: 80, name: "Stewards", icon: "scale", line: "Set how idle workers split between resources." },
  census:    { era: 3, cost: { gold: 1500, wood: 1200 }, time: 90, name: "Census", icon: "users", line: "Halls and outposts keep training workers up to a target." },
  watch:     { era: 3, cost: { gold: 1600, stone: 1200 }, time: 90, name: "Watchmen", icon: "eye", line: "Enemy contacts are tracked with their heading and where they are going." },
  bureau:    { era: 4, cost: { gold: 4000, wood: 3000, stone: 2000 }, time: 120, name: "Bureaucracy", icon: "list", line: "A research plan your buildings work through on their own." },
  logistics: { era: 5, cost: { gold: 8000, wood: 5000, oil: 1000 }, time: 140, name: "Logistics", icon: "flag", line: "New soldiers march straight to a chosen muster point." },
  command:   { era: 6, cost: { gold: 16000, stone: 8000, oil: 5000 }, time: 160, name: "High Command", icon: "crown", line: "Your idle army strikes the nearest known enemy base when it is strong enough." },
  satellite: { era: 7, cost: { gold: 26000, oil: 12000 }, time: 180, name: "Satellites", icon: "radar", line: "A scan of a contact or the dark every 45 seconds." },
  drones:    { era: 7, cost: { gold: 22000, oil: 14000 }, time: 180, name: "Drone Wing", icon: "drone", line: "Free scout drones circle your borders." },
  overmind:  { era: 8, cost: { gold: 50000, oil: 30000, aether: 3000 }, time: 220, name: "Overmind", icon: "brain", line: "Wounded units fall back to be healed; groups focus their fire." },
  continuum: { era: 9, cost: { gold: 80000, aether: 9000 }, time: 260, name: "Continuum", icon: "spiral", line: "You know where they will come from before they arrive." }
};
export const DOCTRINE_IDS = Object.keys(DOCTRINES);

/* ---------------------------------------------------------------
   Champions. Each has four skills (Q W E R); R opens at level 6.
   Their gear follows your era by itself.
   --------------------------------------------------------------- */
export const HEROES = {
  warden: {
    name: "The Warden", role: "Shield", base: { hp: 260, atk: 15, cd: 1.1, range: 0.85, speed: 2.6, sight: 9, armor: 3 }, melee: true,
    blurb: "Stands in front. Stuns, rallies and refuses to fall.",
    skills: [
      { key: "Q", id: "bash", name: "Shield Bash", cd: 7, range: 2.2, aim: "target", line: "Strike and stun the nearest foe." },
      { key: "W", id: "rally", name: "Rally", cd: 18, range: 6, aim: "self", line: "Allies near you hit faster and take less." },
      { key: "E", id: "charge", name: "Charge", cd: 10, range: 6, aim: "dir", line: "Dash, knocking aside everything in the way." },
      { key: "R", id: "bulwark", name: "Bulwark", cd: 50, range: 6, aim: "self", line: "Take far less damage, and draw every eye." }
    ]
  },
  huntress: {
    name: "The Huntress", role: "Marksman", base: { hp: 170, atk: 13, cd: 1.0, range: 5.2, speed: 2.8, sight: 11, armor: 1 }, shot: "hero",
    blurb: "Kills from far away and is never where you left her.",
    skills: [
      { key: "Q", id: "volley", name: "Volley", cd: 6, range: 5, aim: "dir", line: "A fan of shots." },
      { key: "W", id: "mark", name: "Mark Prey", cd: 12, range: 9, aim: "target", line: "A foe takes much more damage from everyone." },
      { key: "E", id: "tumble", name: "Tumble", cd: 8, range: 4, aim: "dir", line: "Roll away; the next shot hits twice as hard." },
      { key: "R", id: "hail", name: "Hail", cd: 45, range: 9, aim: "ground", radius: 4, line: "Rain on an area for three seconds." }
    ]
  },
  sage: {
    name: "The Sage", role: "Caster", base: { hp: 160, atk: 11, cd: 1.3, range: 4.6, speed: 2.5, sight: 10, armor: 1 }, shot: "hero",
    blurb: "Mends the living and ends the rest.",
    skills: [
      { key: "Q", id: "bolt", name: "Bolt", cd: 5, range: 8, aim: "dir", line: "A bolt that bursts on the first thing it meets." },
      { key: "W", id: "mend", name: "Mend", cd: 14, range: 5, aim: "self", line: "Heal everyone of yours around you." },
      { key: "E", id: "blink", name: "Blink", cd: 12, range: 6, aim: "ground", line: "Be somewhere else." },
      { key: "R", id: "cataclysm", name: "Cataclysm", cd: 60, range: 9, aim: "ground", radius: 5, line: "A moment's warning, then ruin." }
    ]
  },
  shade: {
    name: "The Shade", role: "Assassin", base: { hp: 190, atk: 18, cd: 0.9, range: 0.8, speed: 3.0, sight: 10, armor: 2 }, melee: true,
    blurb: "Arrives behind the one who matters.",
    skills: [
      { key: "Q", id: "rend", name: "Rend", cd: 6, range: 5, aim: "target", line: "Leap to a foe and cut deep." },
      { key: "W", id: "veil", name: "Veil", cd: 20, range: 0, aim: "self", line: "Unseen and quicker for five seconds." },
      { key: "E", id: "caltrops", name: "Caltrops", cd: 12, range: 6, aim: "ground", radius: 3, line: "Slow and bleed an area." },
      { key: "R", id: "execute", name: "Execution", cd: 40, range: 3, aim: "target", line: "Hits harder the more a foe is already hurt." }
    ]
  },
  artificer: {
    name: "The Artificer", role: "Engineer", base: { hp: 200, atk: 12, cd: 1.2, range: 4.0, speed: 2.5, sight: 10, armor: 2 }, shot: "hero",
    blurb: "Builds the fight around herself.",
    skills: [
      { key: "Q", id: "turret", name: "Turret", cd: 16, range: 4, aim: "ground", line: "Drop a turret that fights for twenty seconds." },
      { key: "W", id: "pulse", name: "Repair Pulse", cd: 15, range: 6, aim: "self", line: "Repair machines and buildings around you." },
      { key: "E", id: "mine", name: "Mine", cd: 8, range: 5, aim: "ground", radius: 2, line: "A charge that waits for a foe." },
      { key: "R", id: "overclock", name: "Overclock", cd: 55, range: 8, aim: "self", line: "Everything of yours nearby attacks much faster." }
    ]
  }
};
export const HERO_IDS = Object.keys(HEROES);
export const HERO_MAX_LEVEL = 30;
export const heroXpFor = (lvl) => Math.round(60 * Math.pow(lvl, 1.6));
export function heroStats(id, lvl, era) {
  const b = HEROES[id].base, m = eraMul(era) * (1 + 0.075 * (lvl - 1));
  return { hp: Math.round(b.hp * m), atk: b.atk * m, cd: b.cd, armor: b.armor * eraMul(era) * (1 + 0.04 * (lvl - 1)), range: b.range, speed: b.speed * (1 + 0.03 * era), sight: b.sight };
}
export function heroCost(era) { const k = Math.pow(1.35, era); return { gold: Math.round(300 * k), wood: Math.round(100 * k), stone: Math.round(40 * k) }; }

/* ---------------------------------------------------------------
   Resource nodes on the map.
   --------------------------------------------------------------- */
export const NODES = {
  gold:   { w: 3, h: 3, name: "Gold Vein", res: "gold" },
  stone:  { w: 2, h: 2, name: "Stone Outcrop", res: "stone" },
  oil:    { w: 2, h: 2, name: "Oil Seep", res: "oil", infinite: true },
  aether: { w: 2, h: 2, name: "Aether Shard", res: "aether", infinite: true },
  relic:  { w: 2, h: 2, name: "Ruin", relic: true }
};

/* ---------------------------------------------------------------
   Gathering.
   --------------------------------------------------------------- */
export const GATHER = {
  wood: { time: 3.2, carry: 10 },
  gold: { time: 2.4, carry: 10 },
  stone: { time: 3.4, carry: 8 }
};
export const TREE_WOOD = 100;

/* ---------------------------------------------------------------
   Enemy pressure, per phase. A phase is one or more enemy bases;
   clearing all of them is clearing the phase.
   --------------------------------------------------------------- */
export const DIFFICULTY = {
  calm:   { name: "Calm", budget: 0.6, waveEvery: 1.4, hp: 0.8 },
  normal: { name: "Normal", budget: 1.0, waveEvery: 1.0, hp: 1.0 },
  harsh:  { name: "Harsh", budget: 1.45, waveEvery: 0.8, hp: 1.15 }
};
/** The era the enemy fights in during phase p: whatever you could have reached by then. */
export function enemyEra(p) {
  let e = 0;
  for (let i = 1; i < ERAS.length; i++) if (ERAS[i].adv.phases <= p - 1) e = i;
  return e;
}
/** How much stronger than its era the enemy is: it grows while you linger in one. */
export function enemyBoost(p) {
  const e = enemyEra(p), since = (p - 1) - (e ? ERAS[e].adv.phases : 0);
  return 1 + 0.05 * Math.max(0, since);
}
export const START_BOUNDS = 64;   // the first map runs from -64 to +64 tiles on both axes

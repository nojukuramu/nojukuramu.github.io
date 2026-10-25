/* presets.js — the hand-drawn pieces the world is assembled from.
 *
 * Ported, unchanged in content, from the Phaser build
 * (static/js/phaser/config/ChunkPresets.js, which came from the original
 * WorldObject.js): every chunk is an 8×8 grid of 2 m cells, each cell a
 * two-letter object code, optionally followed by ":" and a floor code.
 *
 *   ..  nothing        TR  tree           RK  rock          CF  cliff
 *   WH  wall, east–west WV  wall, north–south  WD / WA  diagonal walls
 *   CR  crate          BR  barrel         ST  stairs
 *   floors: ST stone, CB cobble
 *
 * Three tables, as before:
 *   CHUNK_PRESETS      one chunk each, picked by biome (or by the road
 *                      passing through, for the path_* ones), weighted by rarity
 *   STRUCTURES         multi-chunk structures and which parts they are made of.
 *                      The Phaser build defined these and never placed one;
 *                      world.js does.
 *   STRUCTURE_PARTS    the chunks those structures are made of
 *
 * What a code turns into in 3D is decided in world.js (OBJECT_CODES) and
 * props.js, so this file stays data. */

export const CHUNK_PRESETS = {
  plains_open: { biome: "Plains", rarity: 1, grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. RK .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  plains_scattered_rocks: { biome: "Plains", rarity: 1, grid: [
      ".. .. .. .. .. .. .. ..",
      ".. RK .. .. .. RK .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. RK .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. RK .. .. .. RK .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  plains_bush_clump: { biome: "Plains", rarity: 1, grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. TR .. TR .. .. ..",
      ".. .. .. TR .. .. .. ..",
      ".. .. TR .. TR .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  forest_grove: { biome: "Forest", rarity: 1, grid: [
      ".. .. TR TR .. .. .. ..",
      ".. TR TR TR TR .. .. ..",
      ".. TR TR TR .. .. RK ..",
      ".. .. TR TR .. .. .. ..",
      ".. .. .. .. .. TR .. ..",
      "RK .. .. .. TR TR .. ..",
      ".. .. .. .. TR .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  forest_dense: { biome: "Forest", rarity: 0.8, grid: [
      "TR .. TR .. TR .. TR ..",
      ".. TR .. TR .. TR .. ..",
      "TR .. TR .. TR .. TR ..",
      ".. TR .. .. .. TR .. TR",
      "TR .. .. .. .. .. TR ..",
      ".. TR .. .. .. TR .. ..",
      "TR .. TR .. TR .. TR ..",
      ".. .. TR .. .. TR .. .."
    ] },
  forest_clearing: { biome: "Forest", rarity: 1, grid: [
      "TR TR .. .. .. .. TR TR",
      "TR .. .. .. .. .. .. TR",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      "TR .. .. .. .. .. .. TR",
      "TR TR .. .. .. .. TR TR"
    ] },
  forest_path: { biome: "Forest", rarity: 1, grid: [
      "TR TR TR .. .. TR TR TR",
      "TR TR .. .. .. .. TR TR",
      "TR .. .. .. .. .. .. TR",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      "TR .. .. .. .. .. .. TR",
      "TR TR .. .. .. .. TR TR",
      "TR TR TR .. .. TR TR TR"
    ] },
  ruins_lshape: { biome: "Ruins", rarity: 1, grid: [
      ".. .. .. .. .. .. .. ..",
      ".. WH:ST WH:ST WH:ST .. .. .. ..",
      ".. WV:ST ..:ST ..:ST .. .. .. ..",
      ".. WV:ST ..:ST CR:ST BR .. .. ..",
      ".. ..:ST ..:ST CR .. .. .. ..",
      ".. .. .. .. .. .. ST ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  ruins_room: { biome: "Ruins", rarity: 1, grid: [
      ".. .. .. .. .. .. .. ..",
      ".. WH:ST WH:ST .. WH:ST WH:ST .. ..",
      ".. WV:ST ..:ST ..:ST ..:ST WV:ST .. ..",
      ".. WV:ST ..:ST CR:ST ..:ST WV:ST .. ..",
      ".. WV:ST ..:ST BR:ST ..:ST WV:ST .. ..",
      ".. WH:ST WH:ST .. WH:ST WH:ST .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  ruins_scattered: { biome: "Ruins", rarity: 1, grid: [
      ".. WD .. .. .. .. .. ..",
      ".. .. .. .. WH .. .. ..",
      ".. .. CR .. .. .. .. ..",
      ".. .. .. .. .. WV .. ..",
      ".. .. .. BR .. .. .. ..",
      "WA .. .. .. .. .. CR ..",
      ".. .. .. ST .. .. .. ..",
      ".. .. .. .. .. WD .. .."
    ] },
  rocky_formation: { biome: "Rocky", rarity: 1, grid: [
      ".. .. .. .. .. .. .. ..",
      ".. RK .. .. .. RK .. ..",
      ".. .. .. CF .. .. .. ..",
      ".. .. CF .. .. CF .. ..",
      ".. .. .. CF .. .. .. ..",
      ".. RK .. .. .. RK .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  rocky_pillars: { biome: "Rocky", rarity: 0.5, grid: [
      ".. CF .. .. .. .. CF ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. CF .. .. CF .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. CF .. .. .. .. CF .."
    ] },
  cave_entrance: { biome: "Cave", rarity: 1, grid: [
      "CF CF .. .. .. .. CF CF",
      "CF .. .. .. .. .. .. CF",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      "CF .. .. .. .. .. .. CF",
      "CF CF .. .. .. .. CF CF"
    ] },
  cave_chamber: { biome: "Cave", rarity: 0.5, grid: [
      "CF CF CF CF CF CF CF CF",
      "CF .. .. .. .. .. .. CF",
      "CF .. .. .. .. .. .. CF",
      "CF .. .. .. .. .. .. CF",
      "CF .. .. .. .. .. .. CF",
      "CF .. .. .. .. .. .. CF",
      "CF .. .. .. .. .. .. CF",
      "CF CF .. .. .. .. CF CF"
    ] },
  village_house: { biome: "Village", rarity: 1, grid: [
      ".. .. .. .. .. .. .. ..",
      ".. WH:CB WH:CB WH:CB WH:CB .. .. ..",
      ".. WV:CB ..:CB ..:CB WV:CB .. .. ..",
      ".. WV:CB BR:CB CR:CB WV:CB .. CR ..",
      ".. WH:CB ..:CB WH:CB WH:CB .. .. ..",
      ".. .. .. .. .. .. BR ..",
      ".. .. CR .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  village_market: { biome: "Village", rarity: 1, grid: [
      ".. .. .. .. .. .. .. ..",
      ".. CR CR .. CR CR .. ..",
      ".. BR .. .. .. BR .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. BR .. .. .. BR .. ..",
      ".. CR CR .. CR CR .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. WH WH .. .. .."
    ] },
  camp_circle: { biome: "Camp", rarity: 1, grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. CR .. .. CR .. ..",
      ".. CR .. .. .. .. CR ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. BR .. .. .. .. BR ..",
      ".. .. CR .. .. CR .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  camp_scattered: { biome: "Camp", rarity: 1, grid: [
      ".. .. CR .. .. .. .. ..",
      ".. .. .. .. BR .. .. ..",
      "BR .. .. .. .. .. CR ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. CR .. .. BR .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. BR .. .. .. .. .. ..",
      ".. .. .. CR .. .. .. .."
    ] },
  swamp_dead: { biome: "Swamp", rarity: 1, grid: [
      ".. TR .. .. .. .. .. ..",
      ".. .. .. BR .. TR .. ..",
      ".. .. TR .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. TR .. .. .. ..",
      ".. TR .. .. .. .. BR ..",
      ".. .. .. .. TR .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  swamp_murky: { biome: "Swamp", rarity: 1, grid: [
      ".. TR .. BR .. .. TR ..",
      "BR .. .. .. .. TR .. ..",
      ".. .. TR .. .. .. .. BR",
      ".. .. .. .. TR .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. TR .. .. .. TR .. ..",
      ".. .. .. BR .. .. .. ..",
      "TR .. .. .. .. .. BR .."
    ] },
  desert_sparse: { biome: "Desert", rarity: 1, grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. RK .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. CR ..",
      ".. .. .. .. .. .. .. .."
    ] },
  desert_dunes: { biome: "Desert", rarity: 1, grid: [
      ".. .. .. .. .. .. .. ..",
      ".. RK .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. RK ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  lake_shore: { biome: "Lake", rarity: 1, grid: [
      "RK RK .. .. .. .. RK ..",
      "RK .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. RK",
      ".. RK .. .. .. .. RK RK"
    ] },
  clearing_empty: { biome: "Clearing", rarity: 1, grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  clearing_corner: { biome: "Clearing", rarity: 0.8, grid: [
      "TR .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  graveyard_rows: { biome: "Graveyard", rarity: 1, grid: [
      ".. .. .. .. .. .. .. ..",
      ".. WV .. WV .. WV .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. WV .. WV .. WV .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. WV .. .. .. WV .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  graveyard_scattered: { biome: "Graveyard", rarity: 1, grid: [
      ".. WV .. .. .. WV .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. WV .. .. WV .. ..",
      "WV .. .. .. .. .. WV ..",
      ".. .. .. WV .. .. .. ..",
      ".. WV .. .. .. .. .. ..",
      ".. .. .. .. WV .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  path_ns: { biome: "*", rarity: 0, pathType: "NS", grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  path_ew: { biome: "*", rarity: 0, pathType: "EW", grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  path_cross: { biome: "*", rarity: 0, pathType: "CROSS", grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  path_turn_ne: { biome: "*", rarity: 0, pathType: "NE", grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  path_turn_nw: { biome: "*", rarity: 0, pathType: "NW", grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  path_turn_se: { biome: "*", rarity: 0, pathType: "SE", grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  path_turn_sw: { biome: "*", rarity: 0, pathType: "SW", grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  path_t_n: { biome: "*", rarity: 0, pathType: "T_N", grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. CR .. .. .. .. CR ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. CR .. .. .. .. CR ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  path_t_s: { biome: "*", rarity: 0, pathType: "T_S", grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. CR .. .. .. .. CR ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. CR .. .. .. .. CR ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  path_t_e: { biome: "*", rarity: 0, pathType: "T_E", grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. CR .. .. .. .. CR ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. CR .. .. .. .. CR ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] },
  path_t_w: { biome: "*", rarity: 0, pathType: "T_W", grid: [
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. CR .. .. .. .. CR ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. ..",
      ".. CR .. .. .. .. CR ..",
      ".. .. .. .. .. .. .. ..",
      ".. .. .. .. .. .. .. .."
    ] }
};

export const STRUCTURES = {
  fortress: { w: 2, h: 2, rarity: 50, biomes: ["Ruins","Village"],
    parts: [{ dx: 0, dy: 0, preset: "fortress_nw" }, { dx: 1, dy: 0, preset: "fortress_ne" }, { dx: 0, dy: 1, preset: "fortress_sw" }, { dx: 1, dy: 1, preset: "fortress_se" }] },
  huge_grove: { w: 2, h: 2, rarity: 30, biomes: ["Forest"],
    parts: [{ dx: 0, dy: 0, preset: "grove_nw" }, { dx: 1, dy: 0, preset: "grove_ne" }, { dx: 0, dy: 1, preset: "grove_sw" }, { dx: 1, dy: 1, preset: "grove_se" }] },
  big_lake: { w: 2, h: 2, rarity: 40, biomes: ["Lake","Swamp"],
    parts: [{ dx: 0, dy: 0, preset: "lake_nw" }, { dx: 1, dy: 0, preset: "lake_ne" }, { dx: 0, dy: 1, preset: "lake_sw" }, { dx: 1, dy: 1, preset: "lake_se" }] },
  grand_bridge: { w: 1, h: 2, rarity: 60, biomes: ["Village","Ruins","Plains"],
    parts: [{ dx: 0, dy: 0, preset: "bridge_north" }, { dx: 0, dy: 1, preset: "bridge_south" }] },
  long_market: { w: 2, h: 1, rarity: 50, biomes: ["Village","Camp"],
    parts: [{ dx: 0, dy: 0, preset: "market_west" }, { dx: 1, dy: 0, preset: "market_east" }] },
  central_plaza: { w: 3, h: 3, rarity: 80, biomes: ["Village","Ruins"],
    parts: [{ dx: 0, dy: 0, preset: "plaza_nw" }, { dx: 1, dy: 0, preset: "plaza_n" }, { dx: 2, dy: 0, preset: "plaza_ne" }, { dx: 0, dy: 1, preset: "plaza_w" }, { dx: 1, dy: 1, preset: "plaza_center" }, { dx: 2, dy: 1, preset: "plaza_e" }, { dx: 0, dy: 2, preset: "plaza_sw" }, { dx: 1, dy: 2, preset: "plaza_s" }, { dx: 2, dy: 2, preset: "plaza_se" }] },
  village_corner: { w: 2, h: 2, rarity: 45, biomes: ["Village","Camp"], shape: "L",
    parts: [{ dx: 0, dy: 0, preset: "corner_nw" }, { dx: 1, dy: 0, preset: "corner_ne" }, { dx: 0, dy: 1, preset: "corner_sw" }] },
  u_courtyard: { w: 3, h: 2, rarity: 55, biomes: ["Ruins","Village"], shape: "U",
    parts: [{ dx: 0, dy: 0, preset: "courtyard_nw" }, { dx: 1, dy: 0, preset: "courtyard_n" }, { dx: 2, dy: 0, preset: "courtyard_ne" }, { dx: 0, dy: 1, preset: "courtyard_sw" }, { dx: 2, dy: 1, preset: "courtyard_se" }] },
  mage_tower: { w: 2, h: 3, rarity: 70, biomes: ["Ruins","Forest"],
    parts: [{ dx: 0, dy: 0, preset: "tower_nw" }, { dx: 1, dy: 0, preset: "tower_ne" }, { dx: 0, dy: 1, preset: "tower_w" }, { dx: 1, dy: 1, preset: "tower_e" }, { dx: 0, dy: 2, preset: "tower_sw" }, { dx: 1, dy: 2, preset: "tower_se" }] }
};

export const STRUCTURE_PARTS = {
  fortress_nw: [
    "WH:ST WH:ST WH:ST WH:ST WH:ST WH:ST WH:ST WH:ST",
    "WV:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..",
    "WV:ST ..:ST CR:ST CR:ST CR:ST CR:ST ..:ST ..",
    "WV:ST ..:ST CR:ST BR:ST BR:ST CR:ST ..:ST ..",
    "WV:ST ..:ST CR:ST BR:ST BR:ST CR:ST ..:ST ..",
    "WV:ST ..:ST CR:ST CR:ST CR:ST CR:ST ..:ST ..",
    "WV:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..",
    "..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST .."
  ],
  fortress_ne: [
    "WH:ST WH:ST WH:ST WH:ST WH:ST WH:ST WH:ST WH:ST",
    "..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST WV:ST",
    "..:ST ..:ST CR:ST CR:ST CR:ST CR:ST ..:ST WV:ST",
    "..:ST ..:ST CR:ST BR:ST BR:ST CR:ST ..:ST WV:ST",
    "..:ST ..:ST CR:ST BR:ST BR:ST CR:ST ..:ST WV:ST",
    "..:ST ..:ST CR:ST CR:ST CR:ST CR:ST ..:ST WV:ST",
    "..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST WV:ST",
    "..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST .."
  ],
  fortress_sw: [
    "..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..",
    "WV:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..",
    "WV:ST ..:ST WV:ST ..:ST ..:ST WV:ST ..:ST ..",
    "WV:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..",
    "WV:ST ..:ST ..:ST ST:ST ST:ST ..:ST ..:ST ..",
    "WV:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..",
    "WV:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..",
    "WH:ST WH:ST WH:ST .. .. WH:ST WH:ST WH:ST"
  ],
  fortress_se: [
    "..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..",
    "..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST WV:ST",
    "..:ST ..:ST WV:ST ..:ST ..:ST WV:ST ..:ST WV:ST",
    "..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST WV:ST",
    "..:ST ..:ST ST:ST ST:ST ..:ST ..:ST ..:ST WV:ST",
    "..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST WV:ST",
    "..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST WV:ST",
    "WH:ST WH:ST WH:ST .. .. WH:ST WH:ST WH:ST"
  ],
  grove_nw: [
    "TR TR TR TR TR .. TR ..",
    "TR TR TR TR .. TR .. ..",
    "TR TR TR TR .. .. .. ..",
    "TR TR TR .. .. .. .. ..",
    "TR TR .. .. .. .. .. ..",
    "TR .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. .."
  ],
  grove_ne: [
    ".. TR .. TR TR TR TR TR",
    ".. .. TR TR TR TR TR TR",
    ".. .. .. TR TR TR TR TR",
    ".. .. .. .. TR TR TR TR",
    ".. .. .. .. .. TR TR TR",
    ".. .. .. .. .. .. TR TR",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. .."
  ],
  grove_sw: [
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    "TR TR .. .. .. .. .. ..",
    "TR TR TR .. .. .. .. ..",
    "TR TR TR TR .. .. .. ..",
    "TR TR TR TR TR .. .. ..",
    "TR TR TR TR TR TR .. ..",
    "TR TR TR TR TR .. TR .."
  ],
  grove_se: [
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. TR TR",
    ".. .. .. .. .. TR TR TR",
    ".. .. .. .. TR TR TR TR",
    ".. .. .. TR TR TR TR TR",
    ".. .. TR TR TR TR TR TR",
    ".. TR .. TR TR TR TR TR"
  ],
  lake_nw: [
    "RK RK RK RK RK .. RK ..",
    "RK RK RK RK .. RK .. ..",
    "RK RK RK RK .. .. .. ..",
    "RK RK RK .. .. .. .. ..",
    "RK RK .. .. .. .. .. ..",
    "RK .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. .."
  ],
  lake_ne: [
    ".. RK .. RK RK RK RK RK",
    ".. .. RK RK RK RK RK RK",
    ".. .. .. RK RK RK RK RK",
    ".. .. .. .. RK RK RK RK",
    ".. .. .. .. .. RK RK RK",
    ".. .. .. .. .. .. RK RK",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. .."
  ],
  lake_sw: [
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    "RK RK .. .. .. .. .. ..",
    "RK RK RK .. .. .. .. ..",
    "RK RK RK RK .. .. .. ..",
    "RK RK RK RK RK .. .. ..",
    "RK RK RK RK RK RK .. ..",
    "RK RK RK RK RK .. RK .."
  ],
  lake_se: [
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. RK RK",
    ".. .. .. .. .. RK RK RK",
    ".. .. .. .. RK RK RK RK",
    ".. .. .. RK RK RK RK RK",
    ".. .. RK RK RK RK RK RK",
    ".. RK .. RK RK RK RK RK"
  ],
  bridge_north: [
    ".. WH WH WH WH WH WH ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. .."
  ],
  bridge_south: [
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. WH WH WH WH WH WH .."
  ],
  market_west: [
    ".. .. .. .. .. .. .. ..",
    ".. CR BR .. CR BR .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. BR CR .. BR CR .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. CR BR .. CR BR .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. .."
  ],
  market_east: [
    ".. .. .. .. .. .. .. ..",
    ".. CR BR .. CR BR .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. BR CR .. BR CR .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. CR BR .. CR BR .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. .."
  ],
  plaza_nw: [
    "WH WH WH WH WH WH WH WH",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. .."
  ],
  plaza_n: [
    "WH WH WH .. WH WH WH WH",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. .."
  ],
  plaza_ne: [
    "WH WH WH WH WH WH WH WH",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. .."
  ],
  plaza_w: [
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. .."
  ],
  plaza_center: [
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. CR .. .. CR .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. CR .. .. CR .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. .."
  ],
  plaza_e: [
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV"
  ],
  plaza_sw: [
    ".. .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WH WH WH WH WH WH WH WH"
  ],
  plaza_s: [
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    "WH WH WH .. WH WH WH WH"
  ],
  plaza_se: [
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    "WH WH WH WH WH WH WH WH"
  ],
  corner_nw: [
    "WH WH WH WH WH WH WH WH",
    "WV .. .. .. .. .. .. ..",
    "WV .. CR .. BR .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. BR .. CR .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. .."
  ],
  corner_ne: [
    "WH WH WH WH WH WH WH WH",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. BR .. CR .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. CR .. BR .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV"
  ],
  corner_sw: [
    ".. .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. CR .. BR .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. BR .. CR .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WH WH WH WH WH WH WH WH"
  ],
  courtyard_nw: [
    "WH WH WH WH WH WH WH WH",
    "WV .. .. .. .. .. .. ..",
    "WV .. ST .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WH WH WH WH WH .. .. .."
  ],
  courtyard_n: [
    "WH WH WH WH WH WH WH WH",
    ".. .. .. .. .. .. .. ..",
    ".. .. BR CR BR .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. .."
  ],
  courtyard_ne: [
    "WH WH WH WH WH WH WH WH",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. ST .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. WH WH WH WH WH"
  ],
  courtyard_sw: [
    "WH WH WH WH WH .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. CR .. BR .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. BR .. CR .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WV .. .. .. .. .. .. ..",
    "WH WH WH WH WH WH WH WH"
  ],
  courtyard_se: [
    ".. .. .. WH WH WH WH WH",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. BR .. CR .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. CR .. BR .. WV",
    ".. .. .. .. .. .. .. WV",
    ".. .. .. .. .. .. .. WV",
    "WH WH WH WH WH WH WH WH"
  ],
  tower_nw: [
    "CF CF CF CF CF CF CF CF",
    "CF .. .. .. .. .. .. ..",
    "CF .. WV .. .. WV .. ..",
    "CF .. .. .. .. .. .. ..",
    "CF .. .. CR .. .. .. ..",
    "CF .. .. .. .. .. .. ..",
    "CF .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. .."
  ],
  tower_ne: [
    "CF CF CF CF CF CF CF CF",
    ".. .. .. .. .. .. .. CF",
    ".. .. WV .. .. WV .. CF",
    ".. .. .. .. .. .. .. CF",
    ".. .. .. .. CR .. .. CF",
    ".. .. .. .. .. .. .. CF",
    ".. .. .. .. .. .. .. CF",
    ".. .. .. .. .. .. .. .."
  ],
  tower_w: [
    ".. .. .. .. .. .. .. ..",
    "CF .. .. .. .. .. .. ..",
    "CF .. .. BR .. .. .. ..",
    "CF .. .. .. .. .. .. ..",
    "CF .. .. .. .. .. .. ..",
    "CF .. .. BR .. .. .. ..",
    "CF .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. .."
  ],
  tower_e: [
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. CF",
    ".. .. .. .. BR .. .. CF",
    ".. .. .. .. .. .. .. CF",
    ".. .. .. .. .. .. .. CF",
    ".. .. .. .. BR .. .. CF",
    ".. .. .. .. .. .. .. CF",
    ".. .. .. .. .. .. .. .."
  ],
  tower_sw: [
    ".. .. .. .. .. .. .. ..",
    "CF .. .. .. .. .. .. ..",
    "CF .. ST .. .. .. .. ..",
    "CF .. .. .. .. .. .. ..",
    "CF .. .. .. .. .. .. ..",
    "CF .. .. .. .. .. .. ..",
    "CF CF CF CF .. .. .. ..",
    "CF CF CF CF CF CF CF CF"
  ],
  tower_se: [
    ".. .. .. .. .. .. .. ..",
    ".. .. .. .. .. .. .. CF",
    ".. .. .. .. .. ST .. CF",
    ".. .. .. .. .. .. .. CF",
    ".. .. .. .. .. .. .. CF",
    ".. .. .. .. .. .. .. CF",
    ".. .. .. .. CF CF CF CF",
    "CF CF CF CF CF CF CF CF"
  ]
};

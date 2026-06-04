/**
 * ChunkPresets - 8x8 Grid layouts for procedural world generation
 * Ported from original WorldObject.js
 */

// Object code mapping - 2-character codes to object definitions
const ObjectCodes = {
    // Empty
    '__': null,
    '..': null,

    // Trees
    'TR': { type: 'Tree', rotation: 0 },
    'T1': { type: 'Tree', rotation: 0 },
    'T2': { type: 'Tree', rotation: 0 },

    // Rocks
    'RK': { type: 'Rock', rotation: 0 },
    'R1': { type: 'Rock', rotation: 0 },
    'R2': { type: 'Rock', rotation: 0 },

    // Walls (with rotation)
    'WH': { type: 'Wall', rotation: 0 },              // Horizontal
    'WV': { type: 'Wall', rotation: Math.PI / 2 },    // Vertical
    'WD': { type: 'Wall', rotation: Math.PI / 4 },    // Diagonal
    'WA': { type: 'Wall', rotation: -Math.PI / 4 },   // Anti-diagonal

    // Cliffs
    'CF': { type: 'Cliff', rotation: 0 },
    'C1': { type: 'Cliff', rotation: 0 },

    // Crates
    'CR': { type: 'Crate', rotation: 0 },
    'CX': { type: 'Crate', rotation: Math.PI / 4 },

    // Barrels
    'BR': { type: 'Barrel', rotation: 0 },
    'B1': { type: 'Barrel', rotation: 0 },

    // Stairs
    'ST': { type: 'Stairs', rotation: 0 },
    'SN': { type: 'Stairs', rotation: Math.PI / 2 },
    'SE': { type: 'Stairs', rotation: 0 },
    'SS': { type: 'Stairs', rotation: -Math.PI / 2 },
    'SW': { type: 'Stairs', rotation: Math.PI },
};

// Chunk presets - 8x8 grid layouts for each biome
const ChunkPresets = {
    // === PLAINS BIOME ===
    plains_open: {
        biome: 'Plains',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. RK .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    plains_scattered_rocks: {
        biome: 'Plains',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. RK .. .. .. RK .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. RK .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. RK .. .. .. RK .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    plains_bush_clump: {
        biome: 'Plains',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. TR .. TR .. .. ..',
            '.. .. .. TR .. .. .. ..',
            '.. .. TR .. TR .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === FOREST BIOME ===
    forest_grove: {
        biome: 'Forest',
        rarity: 1.0,
        grid: [
            '.. .. TR TR .. .. .. ..',
            '.. TR TR TR TR .. .. ..',
            '.. TR TR TR .. .. RK ..',
            '.. .. TR TR .. .. .. ..',
            '.. .. .. .. .. TR .. ..',
            'RK .. .. .. TR TR .. ..',
            '.. .. .. .. TR .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    forest_dense: {
        biome: 'Forest',
        rarity: 0.8,
        grid: [
            'TR .. TR .. TR .. TR ..',
            '.. TR .. TR .. TR .. ..',
            'TR .. TR .. TR .. TR ..',
            '.. TR .. .. .. TR .. TR',
            'TR .. .. .. .. .. TR ..',
            '.. TR .. .. .. TR .. ..',
            'TR .. TR .. TR .. TR ..',
            '.. .. TR .. .. TR .. ..'
        ]
    },
    forest_clearing: {
        biome: 'Forest',
        rarity: 1.0,
        grid: [
            'TR TR .. .. .. .. TR TR',
            'TR .. .. .. .. .. .. TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. TR',
            'TR TR .. .. .. .. TR TR'
        ]
    },
    forest_path: {
        biome: 'Forest',
        rarity: 1.0,
        grid: [
            'TR TR TR .. .. TR TR TR',
            'TR TR .. .. .. .. TR TR',
            'TR .. .. .. .. .. .. TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. TR',
            'TR TR .. .. .. .. TR TR',
            'TR TR TR .. .. TR TR TR'
        ]
    },

    // === RUINS BIOME ===
    ruins_lshape: {
        biome: 'Ruins',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. WH:ST WH:ST WH:ST .. .. .. ..',
            '.. WV:ST ..:ST ..:ST .. .. .. ..',
            '.. WV:ST ..:ST CR:ST BR .. .. ..',
            '.. ..:ST ..:ST CR .. .. .. ..',
            '.. .. .. .. .. .. ST ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    ruins_room: {
        biome: 'Ruins',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. WH:ST WH:ST .. WH:ST WH:ST .. ..',
            '.. WV:ST ..:ST ..:ST ..:ST WV:ST .. ..',
            '.. WV:ST ..:ST CR:ST ..:ST WV:ST .. ..',
            '.. WV:ST ..:ST BR:ST ..:ST WV:ST .. ..',
            '.. WH:ST WH:ST .. WH:ST WH:ST .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    ruins_scattered: {
        biome: 'Ruins',
        rarity: 1.0,
        grid: [
            '.. WD .. .. .. .. .. ..',
            '.. .. .. .. WH .. .. ..',
            '.. .. CR .. .. .. .. ..',
            '.. .. .. .. .. WV .. ..',
            '.. .. .. BR .. .. .. ..',
            'WA .. .. .. .. .. CR ..',
            '.. .. .. ST .. .. .. ..',
            '.. .. .. .. .. WD .. ..'
        ]
    },

    // === ROCKY BIOME ===
    rocky_formation: {
        biome: 'Rocky',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. RK .. .. .. RK .. ..',
            '.. .. .. CF .. .. .. ..',
            '.. .. CF .. .. CF .. ..',
            '.. .. .. CF .. .. .. ..',
            '.. RK .. .. .. RK .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    rocky_pillars: {
        biome: 'Rocky',
        rarity: 0.5,
        grid: [
            '.. CF .. .. .. .. CF ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. CF .. .. CF .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. CF .. .. .. .. CF ..'
        ]
    },

    // === CAVE BIOME ===
    cave_entrance: {
        biome: 'Cave',
        rarity: 1.0,
        grid: [
            'CF CF .. .. .. .. CF CF',
            'CF .. .. .. .. .. .. CF',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'CF .. .. .. .. .. .. CF',
            'CF CF .. .. .. .. CF CF'
        ]
    },
    cave_chamber: {
        biome: 'Cave',
        rarity: 0.5,
        grid: [
            'CF CF CF CF CF CF CF CF',
            'CF .. .. .. .. .. .. CF',
            'CF .. .. .. .. .. .. CF',
            'CF .. .. .. .. .. .. CF',
            'CF .. .. .. .. .. .. CF',
            'CF .. .. .. .. .. .. CF',
            'CF .. .. .. .. .. .. CF',
            'CF CF .. .. .. .. CF CF'
        ]
    },

    // === VILLAGE BIOME ===
    village_house: {
        biome: 'Village',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. WH:CB WH:CB WH:CB WH:CB .. .. ..',
            '.. WV:CB ..:CB ..:CB WV:CB .. .. ..',
            '.. WV:CB BR:CB CR:CB WV:CB .. CR ..',
            '.. WH:CB ..:CB WH:CB WH:CB .. .. ..',
            '.. .. .. .. .. .. BR ..',
            '.. .. CR .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    village_market: {
        biome: 'Village',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. CR CR .. CR CR .. ..',
            '.. BR .. .. .. BR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. BR .. .. .. BR .. ..',
            '.. CR CR .. CR CR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. WH WH .. .. ..'
        ]
    },

    // === CAMP BIOME ===
    camp_circle: {
        biome: 'Camp',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. CR .. .. CR .. ..',
            '.. CR .. .. .. .. CR ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. BR .. .. .. .. BR ..',
            '.. .. CR .. .. CR .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    camp_scattered: {
        biome: 'Camp',
        rarity: 1.0,
        grid: [
            '.. .. CR .. .. .. .. ..',
            '.. .. .. .. BR .. .. ..',
            'BR .. .. .. .. .. CR ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. CR .. .. BR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. BR .. .. .. .. .. ..',
            '.. .. .. CR .. .. .. ..'
        ]
    },

    // === SWAMP BIOME ===
    swamp_dead: {
        biome: 'Swamp',
        rarity: 1.0,
        grid: [
            '.. TR .. .. .. .. .. ..',
            '.. .. .. BR .. TR .. ..',
            '.. .. TR .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. TR .. .. .. ..',
            '.. TR .. .. .. .. BR ..',
            '.. .. .. .. TR .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    swamp_murky: {
        biome: 'Swamp',
        rarity: 1.0,
        grid: [
            '.. TR .. BR .. .. TR ..',
            'BR .. .. .. .. TR .. ..',
            '.. .. TR .. .. .. .. BR',
            '.. .. .. .. TR .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. TR .. .. .. TR .. ..',
            '.. .. .. BR .. .. .. ..',
            'TR .. .. .. .. .. BR ..'
        ]
    },

    // === DESERT BIOME ===
    desert_sparse: {
        biome: 'Desert',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. RK .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. CR ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    desert_dunes: {
        biome: 'Desert',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. RK .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. RK ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === LAKE BIOME ===
    lake_shore: {
        biome: 'Lake',
        rarity: 1.0,
        grid: [
            'RK RK .. .. .. .. RK ..',
            'RK .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. RK',
            '.. RK .. .. .. .. RK RK'
        ]
    },

    // === CLEARING BIOME (SPAWN) ===
    clearing_empty: {
        biome: 'Clearing',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    clearing_corner: {
        biome: 'Clearing',
        rarity: 0.8,
        grid: [
            'TR .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === GRAVEYARD BIOME ===
    graveyard_rows: {
        biome: 'Graveyard',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. WV .. WV .. WV .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. WV .. WV .. WV .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. WV .. .. .. WV .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    graveyard_scattered: {
        biome: 'Graveyard',
        rarity: 1.0,
        grid: [
            '.. WV .. .. .. WV .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. WV .. .. WV .. ..',
            'WV .. .. .. .. .. WV ..',
            '.. .. .. WV .. .. .. ..',
            '.. WV .. .. .. .. .. ..',
            '.. .. .. .. WV .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // ==============================
    // PATHWAY PRESETS (for smart road generation)
    // ==============================
    path_ns: {
        biome: '*', // Works with any biome
        rarity: 0.0, // Never randomly selected, only via PathwayManager
        pathType: 'NS',
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    path_ew: {
        biome: '*',
        rarity: 0.0,
        pathType: 'EW',
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    path_cross: {
        biome: '*',
        rarity: 0.0,
        pathType: 'CROSS',
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    path_turn_ne: {
        biome: '*',
        rarity: 0.0,
        pathType: 'NE',
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    path_turn_nw: {
        biome: '*',
        rarity: 0.0,
        pathType: 'NW',
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    path_turn_se: {
        biome: '*',
        rarity: 0.0,
        pathType: 'SE',
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    path_turn_sw: {
        biome: '*',
        rarity: 0.0,
        pathType: 'SW',
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    path_t_n: {
        biome: '*',
        rarity: 0.0,
        pathType: 'T_N',
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. CR .. .. .. .. CR ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. CR .. .. .. .. CR ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    path_t_s: {
        biome: '*',
        rarity: 0.0,
        pathType: 'T_S',
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. CR .. .. .. .. CR ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. CR .. .. .. .. CR ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    path_t_e: {
        biome: '*',
        rarity: 0.0,
        pathType: 'T_E',
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. CR .. .. .. .. CR ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. CR .. .. .. .. CR ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    path_t_w: {
        biome: '*',
        rarity: 0.0,
        pathType: 'T_W',
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. CR .. .. .. .. CR ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. CR .. .. .. .. CR ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    }
};

// Multi-chunk structure definitions
const MultiChunkStructures = {
    // 2x2 Fortress
    fortress: {
        size: { w: 2, h: 2 },
        rarity: 50,
        biomes: ['Ruins', 'Village'],
        parts: [
            { dx: 0, dy: 0, preset: 'fortress_nw' },
            { dx: 1, dy: 0, preset: 'fortress_ne' },
            { dx: 0, dy: 1, preset: 'fortress_sw' },
            { dx: 1, dy: 1, preset: 'fortress_se' }
        ]
    },
    // 2x2 Dense Forest Grove
    huge_grove: {
        size: { w: 2, h: 2 },
        rarity: 30,
        biomes: ['Forest'],
        parts: [
            { dx: 0, dy: 0, preset: 'grove_nw' },
            { dx: 1, dy: 0, preset: 'grove_ne' },
            { dx: 0, dy: 1, preset: 'grove_sw' },
            { dx: 1, dy: 1, preset: 'grove_se' }
        ]
    },
    // 2x2 Large Lake
    big_lake: {
        size: { w: 2, h: 2 },
        rarity: 40,
        biomes: ['Lake', 'Swamp'],
        parts: [
            { dx: 0, dy: 0, preset: 'lake_nw' },
            { dx: 1, dy: 0, preset: 'lake_ne' },
            { dx: 0, dy: 1, preset: 'lake_sw' },
            { dx: 1, dy: 1, preset: 'lake_se' }
        ]
    },

    // === NEW MEGA-STRUCTURES ===

    // 1x2 Grand Bridge (vertical)
    grand_bridge: {
        size: { w: 1, h: 2 },
        rarity: 60,
        biomes: ['Village', 'Ruins', 'Plains'],
        parts: [
            { dx: 0, dy: 0, preset: 'bridge_north' },
            { dx: 0, dy: 1, preset: 'bridge_south' }
        ]
    },

    // 2x1 Long Market (horizontal)
    long_market: {
        size: { w: 2, h: 1 },
        rarity: 50,
        biomes: ['Village', 'Camp'],
        parts: [
            { dx: 0, dy: 0, preset: 'market_west' },
            { dx: 1, dy: 0, preset: 'market_east' }
        ]
    },

    // 3x3 Central Plaza
    central_plaza: {
        size: { w: 3, h: 3 },
        rarity: 80,
        biomes: ['Village', 'Ruins'],
        parts: [
            { dx: 0, dy: 0, preset: 'plaza_nw' },
            { dx: 1, dy: 0, preset: 'plaza_n' },
            { dx: 2, dy: 0, preset: 'plaza_ne' },
            { dx: 0, dy: 1, preset: 'plaza_w' },
            { dx: 1, dy: 1, preset: 'plaza_center' },
            { dx: 2, dy: 1, preset: 'plaza_e' },
            { dx: 0, dy: 2, preset: 'plaza_sw' },
            { dx: 1, dy: 2, preset: 'plaza_s' },
            { dx: 2, dy: 2, preset: 'plaza_se' }
        ]
    },

    // L-Shape Village Corner (rotated L)
    village_corner: {
        size: { w: 2, h: 2 },
        rarity: 45,
        biomes: ['Village', 'Camp'],
        shape: 'L',
        parts: [
            { dx: 0, dy: 0, preset: 'corner_nw' },
            { dx: 1, dy: 0, preset: 'corner_ne' },
            { dx: 0, dy: 1, preset: 'corner_sw' }
            // Note: SE is intentionally missing for L-shape
        ]
    },

    // U-Shape Courtyard
    u_courtyard: {
        size: { w: 3, h: 2 },
        rarity: 55,
        biomes: ['Ruins', 'Village'],
        shape: 'U',
        parts: [
            { dx: 0, dy: 0, preset: 'courtyard_nw' },
            { dx: 1, dy: 0, preset: 'courtyard_n' },
            { dx: 2, dy: 0, preset: 'courtyard_ne' },
            { dx: 0, dy: 1, preset: 'courtyard_sw' },
            // Center is open (no preset)
            { dx: 2, dy: 1, preset: 'courtyard_se' }
        ]
    },

    // 2x3 Mage Tower Complex
    mage_tower: {
        size: { w: 2, h: 3 },
        rarity: 70,
        biomes: ['Ruins', 'Forest'],
        parts: [
            { dx: 0, dy: 0, preset: 'tower_nw' },
            { dx: 1, dy: 0, preset: 'tower_ne' },
            { dx: 0, dy: 1, preset: 'tower_w' },
            { dx: 1, dy: 1, preset: 'tower_e' },
            { dx: 0, dy: 2, preset: 'tower_sw' },
            { dx: 1, dy: 2, preset: 'tower_se' }
        ]
    }
};

// Structure preset parts
const StructurePresets = {
    // Fortress parts (2x2) - Stone floors inside walls
    fortress_nw: {
        grid: [
            'WH:ST WH:ST WH:ST WH:ST WH:ST WH:ST WH:ST WH:ST',
            'WV:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..',
            'WV:ST ..:ST CR:ST CR:ST CR:ST CR:ST ..:ST ..',
            'WV:ST ..:ST CR:ST BR:ST BR:ST CR:ST ..:ST ..',
            'WV:ST ..:ST CR:ST BR:ST BR:ST CR:ST ..:ST ..',
            'WV:ST ..:ST CR:ST CR:ST CR:ST CR:ST ..:ST ..',
            'WV:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..',
            '..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..'
        ]
    },
    fortress_ne: {
        grid: [
            'WH:ST WH:ST WH:ST WH:ST WH:ST WH:ST WH:ST WH:ST',
            '..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST WV:ST',
            '..:ST ..:ST CR:ST CR:ST CR:ST CR:ST ..:ST WV:ST',
            '..:ST ..:ST CR:ST BR:ST BR:ST CR:ST ..:ST WV:ST',
            '..:ST ..:ST CR:ST BR:ST BR:ST CR:ST ..:ST WV:ST',
            '..:ST ..:ST CR:ST CR:ST CR:ST CR:ST ..:ST WV:ST',
            '..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST WV:ST',
            '..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..'
        ]
    },
    fortress_sw: {
        grid: [
            '..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..',
            'WV:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..',
            'WV:ST ..:ST WV:ST ..:ST ..:ST WV:ST ..:ST ..',
            'WV:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..',
            'WV:ST ..:ST ..:ST ST:ST ST:ST ..:ST ..:ST ..',
            'WV:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..',
            'WV:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..',
            'WH:ST WH:ST WH:ST .. .. WH:ST WH:ST WH:ST'
        ]
    },
    fortress_se: {
        grid: [
            '..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..',
            '..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST WV:ST',
            '..:ST ..:ST WV:ST ..:ST ..:ST WV:ST ..:ST WV:ST',
            '..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST WV:ST',
            '..:ST ..:ST ST:ST ST:ST ..:ST ..:ST ..:ST WV:ST',
            '..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST WV:ST',
            '..:ST ..:ST ..:ST ..:ST ..:ST ..:ST ..:ST WV:ST',
            'WH:ST WH:ST WH:ST .. .. WH:ST WH:ST WH:ST'
        ]
    },
    // Grove parts (2x2) - Natural irregular edges
    grove_nw: {
        grid: [
            'TR TR TR TR TR .. TR ..',
            'TR TR TR TR .. TR .. ..',
            'TR TR TR TR .. .. .. ..',
            'TR TR TR .. .. .. .. ..',
            'TR TR .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    grove_ne: {
        grid: [
            '.. TR .. TR TR TR TR TR',
            '.. .. TR TR TR TR TR TR',
            '.. .. .. TR TR TR TR TR',
            '.. .. .. .. TR TR TR TR',
            '.. .. .. .. .. TR TR TR',
            '.. .. .. .. .. .. TR TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    grove_sw: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'TR TR .. .. .. .. .. ..',
            'TR TR TR .. .. .. .. ..',
            'TR TR TR TR .. .. .. ..',
            'TR TR TR TR TR .. .. ..',
            'TR TR TR TR TR TR .. ..',
            'TR TR TR TR TR .. TR ..'
        ]
    },
    grove_se: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. TR TR',
            '.. .. .. .. .. TR TR TR',
            '.. .. .. .. TR TR TR TR',
            '.. .. .. TR TR TR TR TR',
            '.. .. TR TR TR TR TR TR',
            '.. TR .. TR TR TR TR TR'
        ]
    },
    // Lake parts (2x2) - Natural irregular shore
    lake_nw: {
        grid: [
            'RK RK RK RK RK .. RK ..',
            'RK RK RK RK .. RK .. ..',
            'RK RK RK RK .. .. .. ..',
            'RK RK RK .. .. .. .. ..',
            'RK RK .. .. .. .. .. ..',
            'RK .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    lake_ne: {
        grid: [
            '.. RK .. RK RK RK RK RK',
            '.. .. RK RK RK RK RK RK',
            '.. .. .. RK RK RK RK RK',
            '.. .. .. .. RK RK RK RK',
            '.. .. .. .. .. RK RK RK',
            '.. .. .. .. .. .. RK RK',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    lake_sw: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'RK RK .. .. .. .. .. ..',
            'RK RK RK .. .. .. .. ..',
            'RK RK RK RK .. .. .. ..',
            'RK RK RK RK RK .. .. ..',
            'RK RK RK RK RK RK .. ..',
            'RK RK RK RK RK .. RK ..'
        ]
    },
    lake_se: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. RK RK',
            '.. .. .. .. .. RK RK RK',
            '.. .. .. .. RK RK RK RK',
            '.. .. .. RK RK RK RK RK',
            '.. .. RK RK RK RK RK RK',
            '.. RK .. RK RK RK RK RK'
        ]
    },

    // === NEW STRUCTURE PRESETS ===

    // Bridge parts (1x2)
    bridge_north: {
        grid: [
            '.. WH WH WH WH WH WH ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    bridge_south: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. WH WH WH WH WH WH ..'
        ]
    },

    // Market parts (2x1)
    market_west: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. CR BR .. CR BR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. BR CR .. BR CR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. CR BR .. CR BR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    market_east: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. CR BR .. CR BR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. BR CR .. BR CR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. CR BR .. CR BR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // Plaza parts (3x3)
    plaza_nw: {
        grid: [
            'WH WH WH WH WH WH WH WH',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    plaza_n: {
        grid: [
            'WH WH WH .. WH WH WH WH',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    plaza_ne: {
        grid: [
            'WH WH WH WH WH WH WH WH',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    plaza_w: {
        grid: [
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..'
        ]
    },
    plaza_center: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. CR .. .. CR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. CR .. .. CR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    plaza_e: {
        grid: [
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV'
        ]
    },
    plaza_sw: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WH WH WH WH WH WH WH WH'
        ]
    },
    plaza_s: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'WH WH WH .. WH WH WH WH'
        ]
    },
    plaza_se: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            'WH WH WH WH WH WH WH WH'
        ]
    },

    // Corner parts (L-shape)
    corner_nw: {
        grid: [
            'WH WH WH WH WH WH WH WH',
            'WV .. .. .. .. .. .. ..',
            'WV .. CR .. BR .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. BR .. CR .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    corner_ne: {
        grid: [
            'WH WH WH WH WH WH WH WH',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. BR .. CR .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. CR .. BR .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV'
        ]
    },
    corner_sw: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. CR .. BR .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. BR .. CR .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WH WH WH WH WH WH WH WH'
        ]
    },

    // Courtyard parts (U-shape)
    courtyard_nw: {
        grid: [
            'WH WH WH WH WH WH WH WH',
            'WV .. .. .. .. .. .. ..',
            'WV .. ST .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WH WH WH WH WH .. .. ..'
        ]
    },
    courtyard_n: {
        grid: [
            'WH WH WH WH WH WH WH WH',
            '.. .. .. .. .. .. .. ..',
            '.. .. BR CR BR .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    courtyard_ne: {
        grid: [
            'WH WH WH WH WH WH WH WH',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. ST .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. WH WH WH WH WH'
        ]
    },
    courtyard_sw: {
        grid: [
            'WH WH WH WH WH .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. CR .. BR .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. BR .. CR .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WH WH WH WH WH WH WH WH'
        ]
    },
    courtyard_se: {
        grid: [
            '.. .. .. WH WH WH WH WH',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. BR .. CR .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. CR .. BR .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            'WH WH WH WH WH WH WH WH'
        ]
    },

    // Tower parts (2x3)
    tower_nw: {
        grid: [
            'CF CF CF CF CF CF CF CF',
            'CF .. .. .. .. .. .. ..',
            'CF .. WV .. .. WV .. ..',
            'CF .. .. .. .. .. .. ..',
            'CF .. .. CR .. .. .. ..',
            'CF .. .. .. .. .. .. ..',
            'CF .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    tower_ne: {
        grid: [
            'CF CF CF CF CF CF CF CF',
            '.. .. .. .. .. .. .. CF',
            '.. .. WV .. .. WV .. CF',
            '.. .. .. .. .. .. .. CF',
            '.. .. .. .. CR .. .. CF',
            '.. .. .. .. .. .. .. CF',
            '.. .. .. .. .. .. .. CF',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    tower_w: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            'CF .. .. .. .. .. .. ..',
            'CF .. .. BR .. .. .. ..',
            'CF .. .. .. .. .. .. ..',
            'CF .. .. .. .. .. .. ..',
            'CF .. .. BR .. .. .. ..',
            'CF .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    tower_e: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. CF',
            '.. .. .. .. BR .. .. CF',
            '.. .. .. .. .. .. .. CF',
            '.. .. .. .. .. .. .. CF',
            '.. .. .. .. BR .. .. CF',
            '.. .. .. .. .. .. .. CF',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    tower_sw: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            'CF .. .. .. .. .. .. ..',
            'CF .. ST .. .. .. .. ..',
            'CF .. .. .. .. .. .. ..',
            'CF .. .. .. .. .. .. ..',
            'CF .. .. .. .. .. .. ..',
            'CF CF CF CF .. .. .. ..',
            'CF CF CF CF CF CF CF CF'
        ]
    },
    tower_se: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. CF',
            '.. .. .. .. .. ST .. CF',
            '.. .. .. .. .. .. .. CF',
            '.. .. .. .. .. .. .. CF',
            '.. .. .. .. .. .. .. CF',
            '.. .. .. .. CF CF CF CF',
            'CF CF CF CF CF CF CF CF'
        ]
    }
};

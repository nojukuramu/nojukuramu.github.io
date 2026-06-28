/**
 * Config - Game Configuration Constants
 */
const Config = {
    // Element Colors
    Air: '#A0E0E0',
    Fire: '#E06060',
    Earth: '#80C060',
    Water: '#4080E0',

    // Circle Physics Colors
    Sharp: '#ff9',
    Blunt: '#d0d',

    // Movement Speeds
    PlayerSpd: 400,
    EnemySpd: 220,

    // Dash Settings
    Dash: {
        duration: 0.25,     // Seconds of dash (friction removed)
        speedBoost: 800,    // Initial dash velocity boost
        staminaCost: 15,    // Stamina consumed
        cooldown: 0.5       // Seconds before can dash again
    },

    // Mana Costs
    ManaCost: {
        Air: 15,
        Fire: 20,
        Earth: 25,
        Water: 20
    },

    // Mana Regen Rates (per second)
    ManaRegen: {
        Air: 8,
        Fire: 4,
        Earth: 2,
        Water: 5
    },

    // Combat
    BaseDamagePerElement: 25,
    ProjectileLife: 4,
    CastCooldown: 0.5,

    // Base Magic (fallback for failed/incomplete casts)
    BaseMagic: {
        damage: 8,          // Small damage
        power: 30,          // Short range
        speed: 200,         // Slow - weak power = slow movement
        radius: 5,          // Small projectile
        color: '#aaaaaa'    // Gray color
    },

    // Physics Thresholds
    SharpRadiusThreshold: 60, // Below this = Sharp, Above = Blunt
    SharpSpeed: 1000,
    BluntSpeed: 500,
    DefaultSpeed: 800,

    // Projectile Spawn & Range
    ProjectileSpawnOffset: 40, // Distance from caster center to spawn projectile
    PowerDistanceRatio: 15, // Max distance = power * this ratio (higher power = farther travel)
    BasePower: 50, // Default power if no elements are stacked

    // Combat Mechanics
    OverwhelmThreshold: 150, // Projectiles with power > this don't die on enemy hit (was 50)
    PvPPowerRatio: 1.5, // Projectile A destroys B if A.power > B.power * this ratio

    // Elemental Effects
    Effects: {
        // FIRE - Burns on hit (DoT damage)
        Fire: {
            burnDamage: 5,      // Damage per tick
            burnDuration: 3,    // Seconds
            burnTickRate: 0.5   // Damage every X seconds
        },
        // WATER - Slows on hit
        Water: {
            slowAmount: 0.3,    // Speed multiplier (0.3 = 70% slow) - more obvious
            slowDuration: 3     // Seconds - longer duration
        },
        // AIR - Propels/knockback (VERY STRONG)
        Air: {
            propelForce: 2500,  // Strong base knockback - sends targets flying
            propelPowerScale: 15 // Much more force per power point
        },
        // EARTH - Pushes everything in its path (BLUNT only)
        Earth: {
            pushForce: 1500,            // Strong push force - bulldozes targets
            pushRadius: 2.0,            // Larger collision radius for push detection
            weightDenialPerPower: 3,    // Can push heavier targets
            contactDamage: 15,          // Damage per second while in contact
            slowdownPerWeight: 0.5,     // Very low slowdown - can hit many enemies
            stopThreshold: 10,          // Very hard to stop - needs massive weight
            projectileLife: 12          // Long life for sustained pushing
        }
    },

    // Spell Spectrum - Based on Power/Radius ratio
    // Determines spell behavior: piercing, explosive, spreading, etc.
    // NOTE: Speed is calculated dynamically based on Size+Power quadrant system:
    //   - Small + Weak = 1.2x player speed (~480)
    //   - Small + Powerful = Very fast (~1400)
    //   - Big + Weak = Slow (~250)
    //   - Big + Powerful = Slow but unstoppable (~350)
    SpellSpectrum: {
        // Ratio thresholds (powerDensity = power / radius)
        thresholds: {
            needle: 6.0,    // Extreme piercing (small + very powerful)
            lance: 4.0,     // High piercing
            beam: 3.0,      // Fast long-range
            dart: 2.0,      // Standard throw
            wave: 1.5,      // Spreading arc
            burst: 1.0,     // Delayed explosion
            boulder: 0.5    // Slow push (big + powerful)
            // Below 0.5 = CANNON/NOVA (big + weak/powerful)
        },
        // Size thresholds for special cases
        smallRadius: 40,
        mediumRadius: 60,
        largeRadius: 80,
        // Power thresholds for special cases
        lowPower: 75,
        mediumPower: 100,
        highPower: 150,
        // Spectrum-specific settings
        // pierce: enemies to pass through (0 = hit first)
        // damage: multiplier, knockback: recoil multiplier
        effects: {
            NEEDLE: { pierce: 4, damage: 0.5, knockback: 0, visualScale: 0.7 },
            LANCE: { pierce: 3, damage: 0.7, knockback: 0.1, visualScale: 0.8 },
            BEAM: { pierce: 2, damage: 0.8, knockback: 0.2, visualScale: 0.9 },
            DART: { pierce: 0, damage: 1.0, knockback: 0.3, visualScale: 1.0 },
            WAVE: { pierce: 0, damage: 0.9, knockback: 0.4, visualScale: 1.1, spread: 25 },
            BURST: { pierce: 0, damage: 1.2, knockback: 0.6, visualScale: 1.2, explosion: true },
            BOULDER: { pierce: 0, damage: 0.8, knockback: 1.0, visualScale: 1.4, push: true },
            CANNON: { pierce: 0, damage: 1.5, knockback: 1.5, visualScale: 1.5, explosion: true },
            NOVA: { pierce: 0, damage: 2.0, knockback: 2.0, visualScale: 1.8, explosion: true, range: 0.3 },
            FLICKER: { pierce: 0, damage: 0.3, knockback: 0, visualScale: 0.6 }
        }
    },


    // World Objects Configuration
    // immortal: true = cannot be destroyed (Wall, Cliff)
    // moveable: true = can be pushed by physics (Rock, Crate, Barrel)
    // solid: true = has collision (most objects)
    Objects: {
        // DESTRUCTIBLE OBJECTS
        Tree: { hp: 150, radius: 26, mass: 500, color: '#228B22', solid: true, moveable: false, immortal: false },
        Bush: { hp: 30, radius: 16, mass: 20, color: '#2d5a27', solid: true, moveable: true, immortal: false },
        Crate: { hp: 40, radius: 18, mass: 40, color: '#CD853F', solid: true, moveable: true, immortal: false },
        Barrel: { hp: 60, radius: 16, mass: 60, color: '#8B4513', solid: true, moveable: true, immortal: false },

        // MOVEABLE OBJECTS (heavy, hard to destroy)
        Rock: { hp: 400, radius: 20, mass: 250, color: '#667788', solid: true, moveable: true, immortal: false },
        Boulder: { hp: 800, radius: 35, mass: 800, color: '#556677', solid: true, moveable: true, immortal: false },

        // IMMORTAL OBJECTS (cannot be destroyed, block everything)
        Wall: { hp: Infinity, radius: 18, mass: Infinity, color: '#555555', solid: true, moveable: false, immortal: true },
        Cliff: { hp: Infinity, radius: 50, mass: Infinity, color: '#3a3a3a', solid: true, moveable: false, immortal: true },
        Pillar: { hp: Infinity, radius: 14, mass: Infinity, color: '#666666', solid: true, moveable: false, immortal: true },

        // NON-SOLID DECORATIONS
        Stairs: { hp: Infinity, radius: 22, color: '#8B4513', solid: false, moveable: false, immortal: true },
        Grass: { hp: Infinity, radius: 10, color: '#3a5a30', solid: false, moveable: false, immortal: true },
        Flower: { hp: 5, radius: 8, color: '#ff6699', solid: false, moveable: false, immortal: false }
    },

    // Procedural Map Spawn Settings
    MapSpawn: {
        worldSize: 2000,        // World extends from -2000 to 2000
        playerClearRadius: 150, // No objects spawn within this radius of player start
        counts: {
            Tree: { min: 15, max: 25 },
            Wall: { min: 5, max: 10 },
            Cliff: { min: 2, max: 4 },
            Stairs: { min: 2, max: 4 },
            Rock: { min: 10, max: 20 },
            Crate: { min: 8, max: 15 },
            Barrel: { min: 5, max: 10 }
        }
    },

    // Magic Editor visuals
    EditorPowerShrink: 0.06,    // (legacy) kept for back-compat
    EditorMinPowerScale: 0.4,   // (legacy)

    // Star-ring spread vs Potency (per layer). LOWER potency = narrower ring = smaller glyphs.
    EditorMinNodeScale: 0.5,    // potency 1  -> ring pulled in (small shapes)
    EditorMaxNodeScale: 1.45,   // potency 10 -> ring pushed out (big shapes)

    // Editor grid / snap (design-space units, independent of screen size)
    EditorGridSize: 40,         // ley-grid cell size
    EditorMinZoom: 0.35,
    EditorMaxZoom: 3.2,

    // Symmetry / instability
    Instability: {
        powerMax: 0.5,          // Max power reduction fraction at full instability
        dmgMax: 0.5,            // Max damage reduction fraction
        spreadMax: 0.52,        // Max aim spread in radians (~30°)
        mixChance: 0.6,         // Probability of an element mix penalty at full instability
        symTolerance: 30        // Pixel tolerance when checking for mirror feature points
    },

    // Floor Generation
    FloorGen: {
        cols: 5, rows: 5,
        cellSize: 320,          // px per arena cell; independent of legacy Chunks.size
        baseEnemies: 4,
        enemiesPerDepth: 1,
        maxEnemies: 16,
        statScalePerDepth: 0.12,
        gateUnlockSeconds: 30,
        gateZoneRadius: 100,
        riftZoneRadius: 80,
        perimeter: 'Wall'
    },

    // Chunk-Based World Generation
    Chunks: {
        size: 320,          // 320x320 pixels per chunk (40px tiles)
        gridWidth: 12,      // 12x12 grid = 144 chunks (compensate smaller chunks)
        gridHeight: 12,
        activeRadius: 3,    // Update objects within 3 chunks of player
        loadRadius: 4,      // Pre-generate chunks within 4 of player
        unloadRadius: 6     // Unload chunks beyond 6 of player
    },

    // Biome Definitions (multi-chunk regions)
    // rarity: Higher = more common. Plains is most common (empty areas)
    Biomes: {
        Plains: {
            minChunks: 4, maxChunks: 10,
            color: '#3a4a2a',
            rarity: 2.5,  // Very common
            objects: { Rock: [0, 1] },
            scale: 'large'
        },
        Forest: {
            minChunks: 4, maxChunks: 8,
            color: '#1a3d1a',
            rarity: 1.5,  // Common
            objects: { Tree: [6, 12], Rock: [1, 3], Crate: [0, 1] },
            scale: 'large'
        },
        Rocky: {
            minChunks: 2, maxChunks: 5,
            color: '#3a3a3a',
            rarity: 0.8,
            objects: { Cliff: [1, 2], Rock: [5, 10], Tree: [0, 2] },
            scale: 'large'
        },
        Ruins: {
            minChunks: 2, maxChunks: 4,
            color: '#4a4040',
            rarity: 0.5,  // Rare
            objects: { Wall: [3, 6], Crate: [2, 5], Barrel: [1, 3], Stairs: [1, 2] },
            scale: 'small'
        },
        Village: {
            minChunks: 3, maxChunks: 6,
            color: '#5a4a3a',
            rarity: 0.5,
            objects: { Wall: [4, 8], Crate: [3, 6], Barrel: [2, 4] },
            scale: 'small'
        },
        Swamp: {
            minChunks: 2, maxChunks: 4,
            color: '#2a3a2a',
            rarity: 0.6,
            objects: { Tree: [3, 6], Rock: [2, 5], Barrel: [1, 2] },
            scale: 'large'
        },
        Desert: {
            minChunks: 3, maxChunks: 6,
            color: '#6a5a3a',
            rarity: 1.2,  // Common-ish
            objects: { Rock: [2, 5], Crate: [0, 2] },
            scale: 'large'
        },
        Graveyard: {
            minChunks: 1, maxChunks: 3,
            color: '#3a3a4a',
            rarity: 0.4,  // Very rare
            objects: { Wall: [2, 4], Rock: [3, 6] },
            scale: 'small'
        },
        Camp: {
            minChunks: 1, maxChunks: 2,
            color: '#4a3a2a',
            rarity: 0.4,
            objects: { Crate: [4, 8], Barrel: [3, 6], Rock: [1, 2] },
            scale: 'small'
        },
        Lake: {
            minChunks: 2, maxChunks: 4,
            color: '#2a4a5a',
            rarity: 0.5,
            objects: { Rock: [3, 6] },
            edgeOnly: true,  // Objects only on edges
            scale: 'large'
        },
        Cave: {
            minChunks: 2, maxChunks: 4,
            color: '#2a2a2a',
            rarity: 0.4,  // Very rare
            objects: { Cliff: [2, 4], Rock: [6, 12] },
            scale: 'small'
        },
        Clearing: {
            minChunks: 2, maxChunks: 4,
            color: '#2f3a2f',
            rarity: 1.5,
            objects: { Rock: [0, 2] },
            scale: 'small'
        }
    }
};

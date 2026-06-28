/**
 * Themes — Floor themes, enemy archetypes, and boss configs.
 * Loaded before GameScene and FloorManager.
 */

// Named collision categories (avoids magic integers everywhere)
const CAT = {
    PLAYER: 1,
    ENEMY: 2,
    OBJECT: 4,
    PROJECTILE: 8
};

const EnemyArchetypes = {
    Chaser: {
        key: 'Chaser',
        texture: 'enemy',
        baseHp: 100,
        baseSpeed: 220,
        mass: 50,
        contactDamage: 10,
        ranged: false,
        rangedConfig: null
    },
    Brute: {
        key: 'Brute',
        texture: 'enemy',
        baseHp: 220,
        baseSpeed: 140,
        mass: 90,
        contactDamage: 18,
        ranged: false,
        rangedConfig: null
    },
    Skirmisher: {
        key: 'Skirmisher',
        texture: 'enemy',
        baseHp: 80,
        baseSpeed: 180,
        mass: 40,
        contactDamage: 5,
        ranged: true,
        rangedConfig: {
            cooldown: 2.5,
            projectile: { power: 40, damage: 12, radius: 8, speed: 380 }
        }
    }
};

const BossConfigs = {
    VerdantWarden: {
        key: 'VerdantWarden',
        baseHp: 1200,
        baseSpeed: 110,
        mass: 200,
        aggroRadius: 350,
        enrageThreshold: 0.30,
        gimmick: 'selfHeal',
        attack: { cooldown: 1.6, projectile: { power: 80, damage: 25, radius: 18, speed: 320 } }
    },
    AshfallTyrant: {
        key: 'AshfallTyrant',
        baseHp: 1100,
        baseSpeed: 130,
        mass: 180,
        aggroRadius: 320,
        enrageThreshold: 0.35,
        gimmick: 'groundBurn',
        attack: { cooldown: 1.2, projectile: { power: 70, damage: 20, radius: 14, speed: 360 } }
    },
    DepthsHarbinger: {
        key: 'DepthsHarbinger',
        baseHp: 1400,
        baseSpeed: 95,
        mass: 220,
        aggroRadius: 400,
        enrageThreshold: 0.25,
        gimmick: 'teleportGate',
        attack: { cooldown: 2.0, projectile: { power: 100, damage: 30, radius: 20, speed: 300 } }
    },
    VoidSentinel: {
        key: 'VoidSentinel',
        baseHp: 900,
        baseSpeed: 150,
        mass: 160,
        aggroRadius: 380,
        enrageThreshold: 0.40,
        gimmick: 'nullifyCast',
        attack: { cooldown: 1.0, projectile: { power: 60, damage: 18, radius: 12, speed: 400 } }
    }
};

// Theme list — weighted selection by floorSeed % Themes.length
const Themes = [
    {
        name: 'Verdant',
        biome: 'Forest',
        enemyPool: ['Chaser', 'Brute'],
        boss: 'VerdantWarden',
        ambientColor: 0x1a3d1a
    },
    {
        name: 'Ashfall',
        biome: 'Graveyard',
        enemyPool: ['Chaser', 'Skirmisher'],
        boss: 'AshfallTyrant',
        ambientColor: 0x3a2a1a
    },
    {
        name: 'Depths',
        biome: 'Cave',
        enemyPool: ['Brute', 'Skirmisher'],
        boss: 'DepthsHarbinger',
        ambientColor: 0x0a0a2a
    },
    {
        name: 'Void',
        biome: 'Ruins',
        enemyPool: ['Chaser', 'Brute', 'Skirmisher'],
        boss: 'VoidSentinel',
        ambientColor: 0x1a0a2a
    }
];

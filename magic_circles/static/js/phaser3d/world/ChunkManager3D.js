/**
 * ChunkManager3D.js
 *
 * 3D port of ChunkManagerPhaser.  Produces THREE.js meshes + CollisionWorld
 * bodies instead of Phaser sprites/graphics.
 *
 * WORLD-GENERATION LOGIC is reproduced verbatim from ChunkManagerPhaser:
 *   - seededRandom / hash (same seed, same arithmetic)
 *   - getBiomeAt (spawn area, small patches, large biomes; same region sizes)
 *   - update (Chebyshev load/unload with Config.Chunks.loadRadius / unloadRadius)
 *   - spawnChunkObjects (pathway-forced preset → biome preset → fallback; 8×8 grid parse)
 *   - spawnRandomObjects (Config.Biomes[biome].objects fallback)
 *
 * 2D-only visual bits (Phaser graphics, tileSprites, floorOverlays, depth)
 * are replaced by:
 *   - Biome3D.groundTile(cx, cz, biome)   → THREE.Mesh added to THREE.Scene
 *   - Pathway3D.buildChunkPath(cx, cz)    → THREE.Group added to THREE.Scene
 *   - ModelFactory[method](opts)          → THREE.Group per world object
 *   - CollisionWorld.createBody(opts)     → physics body per solid/sensor object
 *
 * COORDINATE MAPPING:  2D (x, y)  →  3D (x, 0, z)  with z = 2D-y.
 * 1 unit = 1 px.  Chunk size 320, 8×8 tiles of 40 px.
 *   chunk col: cx = Math.floor(x / 320)
 *   chunk row: cz = Math.floor(z / 320)
 *   cell centre: worldX = cx*320 + col*40 + 20
 *                worldZ = cz*320 + row*40 + 20
 *
 * Globals required at runtime (injected before this file runs):
 *   THREE, Config, ModelFactory, CollisionWorld, Biome3D,
 *   ChunkPresets, ObjectCodes, SeededRandom (class — unused but available)
 *
 * scene must expose:
 *   scene.third.scene   (THREE.Scene)
 *   scene.world         (CollisionWorld instance)
 *   scene.pathways      (Pathway3D instance, may be null)
 *   scene.effects       (Effects3D, optional — for debris on object death)
 */

/* global THREE, Config, ModelFactory, CollisionWorld, Biome3D,
          ChunkPresets, ObjectCodes, SeededRandom */

class ChunkManager3D {

    // =========================================================================
    // Constructor
    // =========================================================================

    /**
     * @param {object} scene  GameScene3D instance.
     */
    constructor(scene) {
        this.scene  = scene;
        this.chunks = new Map();         // key → chunk record

        // Biome caches (mirrors ChunkManagerPhaser)
        this.biomeCache     = new Map();
        this.structureCache = new Map(); // reserved for future multi-chunk use

        this.generated = false;
        this.gridSize  = 8;                              // 8×8 grid per chunk
        this.tileSize  = Config.Chunks.size / 8;        // 40 px

        // Seed: use GameState.seed if available, else random
        this.seed = (typeof GameState !== 'undefined' && GameState.seed != null)
            ? GameState.seed
            : Math.floor(Math.random() * 1000000);

        this.rand = null; // unused (SeededRandom instance placeholder)

        // Biome weighted lists (populated by init())
        this.largeBiomes = [];
        this.largeTotal  = 0;
        this.smallBiomes = [];
        this.smallTotal  = 0;

        // Track last player chunk so update() can skip unchanged frames
        this.lastPcx = null;
        this.lastPcz = null;
    }

    // =========================================================================
    // init()
    // =========================================================================

    /**
     * Mirror of ChunkManagerPhaser.init().
     * Sets up biome weight lists.  Call once before the first update().
     */
    init() {
        this.tileSize  = Config.Chunks.size / this.gridSize;
        this.generated = true;

        // Populate biome lists exactly as 2D original
        for (const [name, cfg] of Object.entries(Config.Biomes)) {
            if (name === 'Clearing') continue;
            const item = { name, weight: cfg.rarity || 1.0 };

            if (cfg.scale === 'small') {
                this.smallBiomes.push(item);
                this.smallTotal += item.weight;
            } else {
                this.largeBiomes.push(item);
                this.largeTotal += item.weight;
            }
        }

        console.log('[ChunkManager3D] initialized with seed:', this.seed);
    }

    // =========================================================================
    // Seeded hash / random  (verbatim from ChunkManagerPhaser)
    // =========================================================================

    /** @private */
    hash(x, y) {
        let h = this.seed;
        h = ((h << 5) - h + x) | 0;
        h = ((h << 5) - h + y) | 0;
        h = ((h << 5) - h + (x * 31)) | 0;
        h = ((h << 5) - h + (y * 17)) | 0;
        return Math.abs(h);
    }

    /**
     * seededRandom(x, y, salt) → float in [0, 1)
     * Same arithmetic as ChunkManagerPhaser.seededRandom.
     * @param {number} x
     * @param {number} y
     * @param {number} [salt=0]
     * @returns {number}
     */
    seededRandom(x, y, salt = 0) {
        return (this.hash(x + salt * 1000, y + salt * 777) % 10000) / 10000;
    }

    // =========================================================================
    // getChunkKey
    // =========================================================================

    /**
     * getChunkKey(cx, cz) → string  ("cx,cz")
     * Note: the 2D version used (cx, cy); here cz maps 1-to-1 to the old cy.
     * @param {number} cx
     * @param {number} cz
     * @returns {string}
     */
    getChunkKey(cx, cz) {
        return `${cx},${cz}`;
    }

    // =========================================================================
    // getBiomeAt  (verbatim port of ChunkManagerPhaser.getBiomeAt)
    // =========================================================================

    /**
     * getBiomeAt(cx, cz) → biome name string
     *
     * Regions:
     *   Spawn area  |cx|≤1 && |cz|≤1   → 'Clearing'
     *   Small patch every 10-chunk region (35 % chance)
     *   Large biome every 60-chunk region (fallback)
     *
     * @param {number} cx
     * @param {number} cz
     * @returns {string}
     */
    getBiomeAt(cx, cz) {
        const key = `${cx},${cz}`;
        if (this.biomeCache.has(key)) return this.biomeCache.get(key);

        // Spawn area — always Clearing
        if (Math.abs(cx) <= 1 && Math.abs(cz) <= 1) {
            this.biomeCache.set(key, 'Clearing');
            return 'Clearing';
        }

        // Small feature biomes (patches) — same region divisors as 2D
        const smallRegionX = Math.floor(cx / 10);
        const smallRegionZ = Math.floor(cz / 10); // was cy/10 in 2D
        const smallRand    = this.seededRandom(smallRegionX, smallRegionZ, 12345);

        if (smallRand < 0.35) {
            const selectRand = this.seededRandom(smallRegionX, smallRegionZ, 67890);
            let target = selectRand * this.smallTotal;
            let sum    = 0;
            for (const b of this.smallBiomes) {
                sum += b.weight;
                if (sum >= target) {
                    this.biomeCache.set(key, b.name);
                    return b.name;
                }
            }
        }

        // Large base biomes
        const largeRegionX = Math.floor(cx / 60);
        const largeRegionZ = Math.floor(cz / 60); // was cy/60 in 2D
        const largeRand    = this.seededRandom(largeRegionX, largeRegionZ, 54321);

        let target = largeRand * this.largeTotal;
        let sum    = 0;
        for (const b of this.largeBiomes) {
            sum += b.weight;
            if (sum >= target) {
                this.biomeCache.set(key, b.name);
                return b.name;
            }
        }

        // Fallback
        const fallback = this.largeBiomes[0]?.name || 'Plains';
        this.biomeCache.set(key, fallback);
        return fallback;
    }

    // =========================================================================
    // getChunkColor  (minimap helper)
    // =========================================================================

    /**
     * getChunkColor(cx, cz) → integer 0xRRGGBB
     * Parses Config.Biomes[biome].color '#rrggbb'.
     * @param {number} cx
     * @param {number} cz
     * @returns {number}
     */
    getChunkColor(cx, cz) {
        const biome = this.getBiomeAt(cx, cz);
        const hex   = Config.Biomes[biome]?.color || '#111111';
        return parseInt(hex.replace('#', ''), 16);
    }

    // =========================================================================
    // getChunk
    // =========================================================================

    /**
     * getChunk(cx, cz) → chunk record | undefined
     * @param {number} cx
     * @param {number} cz
     * @returns {object|undefined}
     */
    getChunk(cx, cz) {
        return this.chunks.get(this.getChunkKey(cx, cz));
    }

    // =========================================================================
    // update  (mirrors ChunkManagerPhaser.update, adapted for z axis)
    // =========================================================================

    /**
     * update(playerX, playerZ)
     *
     * Called every frame.  Computes player chunk coords, skips if the player
     * hasn't crossed a boundary, then loads / unloads using Chebyshev distance.
     *
     * @param {number} playerX  World X of the player.
     * @param {number} playerZ  World Z of the player (maps to 2D playerY).
     */
    update(playerX, playerZ) {
        const size = Config.Chunks.size;
        const pcx  = Math.floor(playerX / size);
        const pcz  = Math.floor(playerZ / size);

        // Skip when the player hasn't crossed a chunk boundary
        if (pcx === this.lastPcx && pcz === this.lastPcz) return;
        this.lastPcx = pcx;
        this.lastPcz = pcz;

        const loadRadius   = Config.Chunks.loadRadius;   // 4
        const unloadRadius = Config.Chunks.unloadRadius; // 6

        // ---- Load nearby chunks (Chebyshev square) --------------------------
        for (let dz = -loadRadius; dz <= loadRadius; dz++) {
            for (let dx = -loadRadius; dx <= loadRadius; dx++) {
                const cx  = pcx + dx;
                const cz  = pcz + dz;
                const key = this.getChunkKey(cx, cz);

                if (!this.chunks.has(key)) {
                    this.loadChunk(cx, cz);
                }
            }
        }

        // ---- Unload distant chunks ------------------------------------------
        for (const [key, chunk] of this.chunks) {
            const dist = Math.max(
                Math.abs(chunk.x - pcx),
                Math.abs(chunk.y - pcz)   // chunk.y stores cz (matches 2D .y field)
            );

            if (dist > unloadRadius) {
                this.unloadChunk(key, chunk);
            }
        }
    }

    // =========================================================================
    // loadChunk
    // =========================================================================

    /**
     * loadChunk(cx, cz)
     *
     * Builds a chunk record with:
     *   ground mesh  (via Biome3D.groundTile)
     *   path group   (via Pathway3D.buildChunkPath, if applicable)
     *   world objects (via spawnChunkObjects)
     *
     * @param {number} cx
     * @param {number} cz
     * @returns {object} chunk record
     */
    loadChunk(cx, cz) {
        const key   = this.getChunkKey(cx, cz);
        const biome = this.getBiomeAt(cx, cz);

        const chunk = {
            x:             cx,
            y:             cz,   // mirrors 2D field name (.y) — stores cz
            biome:         biome,
            objects:       [],
            bodies:        [],   // standalone physics bodies (none currently)
            ground:        null, // THREE.Mesh
            pathGroup:     null, // THREE.Group | null
            loaded:        true,
            preset:        null,
            hasPath:       false,
            pathDirection: null
        };

        // ---- Ground tile ----------------------------------------------------
        try {
            chunk.ground = Biome3D.groundTile(cx, cz, biome);
            this.scene.third.scene.add(chunk.ground);
        } catch (e) {
            console.warn('[ChunkManager3D] groundTile failed for', cx, cz, e);
        }

        // ---- Pathway geometry ----------------------------------------------
        if (this.scene.pathways && this.scene.pathways.hasPath(cx, cz)) {
            chunk.pathDirection = this.scene.pathways.getPathDirection(cx, cz);
            chunk.hasPath       = true;
            try {
                chunk.pathGroup = this.scene.pathways.buildChunkPath(cx, cz);
                if (chunk.pathGroup) {
                    this.scene.third.scene.add(chunk.pathGroup);
                }
            } catch (e) {
                console.warn('[ChunkManager3D] buildChunkPath failed for', cx, cz, e);
            }
        }

        // ---- World objects -------------------------------------------------
        this._spawnChunkObjects(chunk, biome);

        this.chunks.set(key, chunk);
        return chunk;
    }

    // =========================================================================
    // _spawnChunkObjects  (port of ChunkManagerPhaser.spawnChunkObjects)
    // =========================================================================

    /**
     * _spawnChunkObjects(chunk, biome)
     *
     * Preset selection priority (identical to 2D):
     *   1. Pathway-forced preset  (chunk has a road → pathType match)
     *   2. Biome-specific presets
     *   3. Plains / Clearing fallback
     *   4. spawnRandomObjects() if ChunkPresets unavailable or no presets found
     *
     * Then the selected preset's 8×8 grid is parsed ("OBJECTCODE:FLOORCODE").
     * Only the OBJECTCODE matters here; FLOORCODE is discarded (handled by
     * Biome3D ground materials and Pathway3D in 3D).
     *
     * @private
     * @param {object} chunk
     * @param {string} biome
     */
    _spawnChunkObjects(chunk, biome) {
        // Guard: ChunkPresets must be available
        if (typeof ChunkPresets === 'undefined') {
            this._spawnRandomObjects(chunk, biome);
            return;
        }

        // ---- PRIORITY 1: Pathway preset ----------------------------------------
        let presets = [];

        if (chunk.hasPath && chunk.pathDirection) {
            // Same path-type mapping as 2D ChunkManagerPhaser
            const pathTypeMap = {
                'NS':    'NS',
                'EW':    'EW',
                'CROSS': 'CROSS',
                'NE':    'NE',
                'NW':    'NW',
                'SE':    'SE',
                'SW':    'SW',
                'T_N':   'T_N',
                'T_S':   'T_S',
                'T_E':   'T_E',
                'T_W':   'T_W',
                'END_N': 'NS',
                'END_S': 'NS',
                'END_E': 'EW',
                'END_W': 'EW'
            };
            const targetPathType = pathTypeMap[chunk.pathDirection] || null;

            if (targetPathType) {
                presets = Object.entries(ChunkPresets)
                    .filter(([, p]) => p.pathType === targetPathType)
                    .map(([name, p]) => ({ name, ...p }));
            }
        }

        // ---- PRIORITY 2: Biome presets ----------------------------------------
        if (presets.length === 0) {
            presets = Object.entries(ChunkPresets)
                .filter(([, p]) => p.biome === biome && (p.rarity === undefined || p.rarity > 0))
                .map(([name, p]) => ({ name, ...p }));
        }

        // ---- PRIORITY 3: Plains / Clearing fallback ---------------------------
        if (presets.length === 0) {
            presets = Object.entries(ChunkPresets)
                .filter(([, p]) => (p.biome === 'Plains' || p.biome === 'Clearing') &&
                                   (p.rarity === undefined || p.rarity > 0))
                .map(([name, p]) => ({ name, ...p }));
        }

        if (presets.length === 0) {
            // No presets at all → random fallback
            this._spawnRandomObjects(chunk, biome);
            return;
        }

        // ---- Weighted random selection (same as 2D) ---------------------------
        const totalWeight = presets.reduce((sum, p) => sum + (p.rarity || 1), 0);
        const rand        = this.seededRandom(chunk.x, chunk.y, 999) * totalWeight;
        let sum           = 0;
        let selectedPreset = presets[0];
        for (const preset of presets) {
            sum += (preset.rarity || 1);
            if (sum >= rand) {
                selectedPreset = preset;
                break;
            }
        }

        chunk.preset = selectedPreset.name;

        if (!selectedPreset.grid) return;

        // ---- Parse 8×8 grid ---------------------------------------------------
        for (let row = 0; row < selectedPreset.grid.length; row++) {
            const cells = selectedPreset.grid[row].split(' ');
            for (let col = 0; col < cells.length; col++) {
                const cell = cells[col];

                // Parse "OBJECT:FLOOR" — only objectCode matters in 3D
                const parts      = cell.split(':');
                const objectCode = parts[0];
                // parts[1] is floorCode — ignored in 3D (ground is a biome material)

                // Resolve to object definition via ObjectCodes
                const objDef = (typeof ObjectCodes !== 'undefined') ? ObjectCodes[objectCode] : null;
                if (!objDef) continue;  // null / empty codes ('__', '..') skip silently

                // Calculate cell world-space centre
                const cellWorldX = chunk.x * Config.Chunks.size + col * this.tileSize + this.tileSize / 2;
                const cellWorldZ = chunk.y * Config.Chunks.size + row * this.tileSize + this.tileSize / 2;

                // Skip spawn-area clearance (mirrors 2D behaviour)
                if (typeof Config.MapSpawn !== 'undefined' &&
                    Math.abs(cellWorldX) < Config.MapSpawn.playerClearRadius &&
                    Math.abs(cellWorldZ) < Config.MapSpawn.playerClearRadius) {
                    continue;
                }

                // Small random offset for natural look (same formula as 2D)
                const offsetRng = this.tileSize * 0.1;
                const ox = cellWorldX + (this.seededRandom(chunk.x * 8 + col, chunk.y * 8 + row, 3) - 0.5) * offsetRng;
                const oz = cellWorldZ + (this.seededRandom(chunk.x * 8 + col, chunk.y * 8 + row, 4) - 0.5) * offsetRng;

                // Create the 3D world object
                let obj = null;
                try {
                    obj = this.createWorldObject(ox, oz, objDef.type, objDef.rotation || 0);
                } catch (e) {
                    console.warn('[ChunkManager3D] createWorldObject error', objDef.type, e);
                }

                if (obj) {
                    // Store back-reference to owning chunk key for fast removal
                    obj._chunkKey = this.getChunkKey(chunk.x, chunk.y);
                    chunk.objects.push(obj);
                }
            }
        }
    }

    // =========================================================================
    // _spawnRandomObjects  (port of ChunkManagerPhaser.spawnRandomObjects)
    // =========================================================================

    /**
     * Fallback: spawn objects at random positions using Config.Biomes[biome].objects.
     * @private
     * @param {object} chunk
     * @param {string} biome
     */
    _spawnRandomObjects(chunk, biome) {
        const biomeCfg = Config.Biomes[biome];
        if (!biomeCfg || !biomeCfg.objects) return;

        const size   = Config.Chunks.size;
        const worldX = chunk.x * size;
        const worldZ = chunk.y * size;

        for (const [objType, range] of Object.entries(biomeCfg.objects)) {
            const min   = range[0] || 0;
            const max   = range[1] || 0;
            const count = min + Math.floor(
                this.seededRandom(chunk.x * 100 + chunk.y, objType.charCodeAt(0)) * (max - min + 1)
            );

            for (let i = 0; i < count; i++) {
                const ox = worldX + 20 + this.seededRandom(chunk.x + i, chunk.y + i * 2, 1) * (size - 40);
                const oz = worldZ + 20 + this.seededRandom(chunk.x + i * 3, chunk.y + i, 2) * (size - 40);

                // Skip spawn area
                if (typeof Config.MapSpawn !== 'undefined' &&
                    Math.abs(ox) < Config.MapSpawn.playerClearRadius &&
                    Math.abs(oz) < Config.MapSpawn.playerClearRadius) {
                    continue;
                }

                let obj = null;
                try {
                    obj = this.createWorldObject(ox, oz, objType);
                } catch (e) {
                    console.warn('[ChunkManager3D] createWorldObject (random) error', objType, e);
                }

                if (obj) {
                    obj._chunkKey = this.getChunkKey(chunk.x, chunk.y);
                    chunk.objects.push(obj);
                }
            }
        }
    }

    // =========================================================================
    // createWorldObject
    // =========================================================================

    /**
     * createWorldObject(x, z, type, rotation)
     *
     * Builds a 3D object record:
     *   group — THREE.Group (visual), added to scene.third.scene
     *   body  — CollisionWorld body (if cfg.solid or Flower sensor)
     *
     * @param {number} x         World X centre.
     * @param {number} z         World Z centre (3D z = 2D y).
     * @param {string} type      Object type key (e.g. 'Tree', 'Wall', 'Rock').
     * @param {number} [rotation=0]  Yaw in radians (same values as 2D).
     * @returns {object|null}    objRecord or null if type unknown.
     */
    createWorldObject(x, z, type, rotation = 0) {
        const cfg = Config.Objects[type];
        if (!cfg) return null;

        // Per-object deterministic seed for visual variance
        const seedRand = this.seededRandom(Math.round(x), Math.round(z), 7);

        // ---- Visual: resolve ModelFactory method ----------------------------
        const methodName = (typeof ModelFactory !== 'undefined' && ModelFactory.byType)
            ? ModelFactory.byType[type]
            : null;

        let group = null;

        if (methodName && typeof ModelFactory[methodName] === 'function') {
            // Build opts — wall needs orientation determined from rotation
            const opts = { seedRand, rotation };

            if (type === 'Wall') {
                // If |sin(rotation)| > 0.5 the wall is closer to vertical (z-aligned)
                opts.orientation = (Math.abs(Math.sin(rotation)) > 0.5) ? 'v' : 'h';
            }

            try {
                group = ModelFactory[methodName](opts);
            } catch (e) {
                console.warn('[ChunkManager3D] ModelFactory.' + methodName + ' error:', e);
            }
        }

        // Fallback: invisible placeholder group so the rest of the record is valid
        if (!group) {
            group = new THREE.Group();
        }

        // Position the group
        group.position.set(x, 0, z);

        // Apply yaw rotation (not for Wall / Stairs — they encode direction in opts)
        if (rotation !== 0 && type !== 'Wall' && type !== 'Stairs') {
            // THREE uses left-hand Y; 2D rotation is CCW, 3D is CW → negate
            group.rotation.y = -rotation;
        }

        this.scene.third.scene.add(group);

        // ---- Physics body ---------------------------------------------------
        let body = null;

        if (cfg.solid) {
            // Solid objects: full collider (static or dynamic)
            try {
                body = this.scene.world.createBody({
                    x,
                    z,
                    radius:       cfg.radius,
                    mass:         cfg.moveable ? cfg.mass : Infinity,
                    isStatic:     !cfg.moveable,
                    immortal:     !!cfg.immortal,
                    label:        'object',
                    category:     CollisionWorld.CAT_OBJECT,
                    collidesWith: CollisionWorld.CAT_PLAYER    |
                                  CollisionWorld.CAT_ENEMY     |
                                  CollisionWorld.CAT_PROJECTILE |
                                  CollisionWorld.CAT_OBJECT,
                    damping:      cfg.moveable ? 8 : 0
                });
            } catch (e) {
                console.warn('[ChunkManager3D] createBody error for', type, e);
            }
        } else if (type === 'Flower') {
            // Non-solid but destructible: sensor so projectiles can pop it
            try {
                body = this.scene.world.createBody({
                    x,
                    z,
                    radius:       cfg.radius,
                    mass:         1,
                    isStatic:     true,
                    isSensor:     true,
                    immortal:     false,
                    label:        'object',
                    category:     CollisionWorld.CAT_OBJECT,
                    collidesWith: CollisionWorld.CAT_PLAYER    |
                                  CollisionWorld.CAT_ENEMY     |
                                  CollisionWorld.CAT_PROJECTILE |
                                  CollisionWorld.CAT_OBJECT,
                    damping:      0
                });
            } catch (e) {
                console.warn('[ChunkManager3D] createBody (sensor) error for', type, e);
            }
        }

        // ---- Object record --------------------------------------------------
        const objRecord = {
            type,
            cfg,
            hp:       cfg.hp,
            x,
            z,
            group,
            body,
            _chunkKey: null   // filled by caller after chunk key is known
        };

        if (body) {
            body.owner = objRecord;
        }

        return objRecord;
    }

    // =========================================================================
    // damageObject
    // =========================================================================

    /**
     * damageObject(objRecord, amount)
     *
     * Apply damage to a world object.  Immortal objects are ignored.
     * When HP reaches 0:
     *   - Debris particles via scene.effects.debris() (if available)
     *   - Visual group removed from THREE.Scene
     *   - Physics body removed from CollisionWorld
     *   - Record removed from its owning chunk.objects array
     *
     * @param {object} objRecord
     * @param {number} amount
     */
    damageObject(objRecord, amount) {
        if (!objRecord || objRecord.cfg.immortal) return;

        objRecord.hp -= amount;

        if (objRecord.hp <= 0) {
            // Debris effect
            if (this.scene.effects && typeof this.scene.effects.debris === 'function') {
                const colorStr = objRecord.cfg.color || '#888888';
                const colorInt = parseInt(colorStr.replace('#', ''), 16);
                try {
                    this.scene.effects.debris(objRecord.x, objRecord.z, colorInt, 8);
                } catch (e) {
                    // Non-fatal — effects may not be ready
                }
            }

            // Remove visual
            if (objRecord.group) {
                try {
                    this.scene.third.scene.remove(objRecord.group);
                } catch (e) { /* ignore */ }
            }

            // Remove physics body
            if (objRecord.body) {
                try {
                    this.scene.world.removeBody(objRecord.body);
                } catch (e) { /* ignore */ }
                objRecord.body = null;
            }

            // Remove from owning chunk.objects (use stored back-reference)
            if (objRecord._chunkKey) {
                const chunk = this.chunks.get(objRecord._chunkKey);
                if (chunk) {
                    const idx = chunk.objects.indexOf(objRecord);
                    if (idx !== -1) chunk.objects.splice(idx, 1);
                }
            }
        }
    }

    // =========================================================================
    // unloadChunk
    // =========================================================================

    /**
     * unloadChunk(key, chunk)
     *
     * Removes all THREE.js objects and physics bodies that belong to this chunk,
     * then deletes the chunk record from this.chunks.
     *
     * Does NOT dispose shared geometries or materials (they are reused).
     *
     * @param {string} key
     * @param {object} chunk
     */
    unloadChunk(key, chunk) {
        // Remove ground mesh
        if (chunk.ground) {
            try { this.scene.third.scene.remove(chunk.ground); } catch (e) { /* ignore */ }
            chunk.ground = null;
        }

        // Remove path group
        if (chunk.pathGroup) {
            try { this.scene.third.scene.remove(chunk.pathGroup); } catch (e) { /* ignore */ }
            chunk.pathGroup = null;
        }

        // Remove world objects
        for (const obj of chunk.objects) {
            if (obj.group) {
                try { this.scene.third.scene.remove(obj.group); } catch (e) { /* ignore */ }
            }
            if (obj.body) {
                try { this.scene.world.removeBody(obj.body); } catch (e) { /* ignore */ }
            }
        }
        chunk.objects.length = 0;

        // Remove any standalone bodies (currently unused but reserved)
        for (const body of chunk.bodies) {
            try { this.scene.world.removeBody(body); } catch (e) { /* ignore */ }
        }
        chunk.bodies.length = 0;

        this.chunks.delete(key);
    }

    // =========================================================================
    // syncMovedObjects  (optional per-frame helper)
    // =========================================================================

    /**
     * syncMovedObjects()
     *
     * For every moveable object whose physics body has a non-trivial velocity,
     * sync the THREE.Group position to the body's current (x, z).
     *
     * GameScene3D should call this once per frame after CollisionWorld.step().
     */
    syncMovedObjects() {
        for (const chunk of this.chunks.values()) {
            for (const obj of chunk.objects) {
                if (!obj.body || obj.body.isStatic) continue;
                const vx = obj.body.vx;
                const vz = obj.body.vz;
                if (vx * vx + vz * vz > 0.25) {
                    obj.group.position.set(obj.body.x, 0, obj.body.z);
                    // Keep body owner in sync
                    obj.x = obj.body.x;
                    obj.z = obj.body.z;
                }
            }
        }
    }
}

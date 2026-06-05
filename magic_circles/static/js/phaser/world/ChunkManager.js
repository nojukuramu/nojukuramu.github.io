/**
 * ChunkManagerPhaser - Ported chunk generation system for Phaser
 */
class ChunkManagerPhaser {
    constructor(scene) {
        this.scene = scene;
        this.chunks = new Map();
        this.biomeCache = new Map();
        this.structureCache = new Map();
        this.generated = false;
        this.gridSize = 8;
        this.tileSize = Config.Chunks.size / 8;
        this.seed = Math.floor(Math.random() * 1000000);

        // Biome lists for weighted selection
        this.largeBiomes = [];
        this.largeTotal = 0;
        this.smallBiomes = [];
        this.smallTotal = 0;
    }

    init() {
        this.tileSize = Config.Chunks.size / this.gridSize;
        this.generated = true;

        // Initialize biome lists
        for (let [name, cfg] of Object.entries(Config.Biomes)) {
            if (name === 'Clearing') continue;
            let item = { name, weight: cfg.rarity || 1.0 };

            if (cfg.scale === 'small') {
                this.smallBiomes.push(item);
                this.smallTotal += item.weight;
            } else {
                this.largeBiomes.push(item);
                this.largeTotal += item.weight;
            }
        }

        console.log('ChunkManagerPhaser initialized with seed:', this.seed);
    }

    hash(x, y) {
        let h = this.seed;
        h = ((h << 5) - h + x) | 0;
        h = ((h << 5) - h + y) | 0;
        h = ((h << 5) - h + (x * 31)) | 0;
        h = ((h << 5) - h + (y * 17)) | 0;
        return Math.abs(h);
    }

    seededRandom(x, y, salt = 0) {
        return (this.hash(x + salt * 1000, y + salt * 777) % 10000) / 10000;
    }

    getBiomeAt(cx, cy) {
        const key = `${cx},${cy}`;
        if (this.biomeCache.has(key)) {
            return this.biomeCache.get(key);
        }

        // Spawn area
        if (Math.abs(cx) <= 1 && Math.abs(cy) <= 1) {
            this.biomeCache.set(key, 'Clearing');
            return 'Clearing';
        }

        // Small feature biomes (patches)
        const smallRegionX = Math.floor(cx / 10);
        const smallRegionY = Math.floor(cy / 10);
        const smallRand = this.seededRandom(smallRegionX, smallRegionY, 12345);

        if (smallRand < 0.35) {
            const selectRand = this.seededRandom(smallRegionX, smallRegionY, 67890);
            let target = selectRand * this.smallTotal;
            let sum = 0;
            for (let b of this.smallBiomes) {
                sum += b.weight;
                if (sum >= target) {
                    this.biomeCache.set(key, b.name);
                    return b.name;
                }
            }
        }

        // Large base biomes
        const largeRegionX = Math.floor(cx / 60);
        const largeRegionY = Math.floor(cy / 60);
        const largeRand = this.seededRandom(largeRegionX, largeRegionY, 54321);

        let target = largeRand * this.largeTotal;
        let sum = 0;
        for (let b of this.largeBiomes) {
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

    getChunkColor(cx, cy) {
        const biome = this.getBiomeAt(cx, cy);
        const hex = Config.Biomes[biome]?.color || '#111111';
        return this.hexToInt(hex);
    }

    hexToInt(hex) {
        return parseInt(hex.replace('#', ''), 16);
    }

    getChunkKey(cx, cy) {
        return `${cx},${cy}`;
    }

    update(playerX, playerY) {
        const size = Config.Chunks.size;
        const pcx = Math.floor(playerX / size);
        const pcy = Math.floor(playerY / size);

        // Skip the load/unload sweep when the player hasn't crossed a chunk boundary.
        if (pcx === this.lastPcx && pcy === this.lastPcy) return;
        this.lastPcx = pcx;
        this.lastPcy = pcy;

        const loadRadius = Config.Chunks.loadRadius;
        const unloadRadius = Config.Chunks.unloadRadius;

        // Load nearby chunks
        for (let dy = -loadRadius; dy <= loadRadius; dy++) {
            for (let dx = -loadRadius; dx <= loadRadius; dx++) {
                const cx = pcx + dx;
                const cy = pcy + dy;
                const key = this.getChunkKey(cx, cy);

                if (!this.chunks.has(key)) {
                    this.loadChunk(cx, cy);
                }
            }
        }

        // Unload distant chunks
        for (let [key, chunk] of this.chunks) {
            const dist = Math.max(
                Math.abs(chunk.x - pcx),
                Math.abs(chunk.y - pcy)
            );

            if (dist > unloadRadius) {
                this.unloadChunk(key, chunk);
            }
        }
    }

    loadChunk(cx, cy) {
        const key = this.getChunkKey(cx, cy);
        const biome = this.getBiomeAt(cx, cy);
        const size = Config.Chunks.size;

        const chunk = {
            x: cx,
            y: cy,
            biome: biome,
            objects: [],
            graphics: null,
            loaded: true
        };

        // Create ground tile
        const worldX = cx * size;
        const worldY = cy * size;

        // Ground graphics
        chunk.graphics = this.scene.add.graphics();
        chunk.graphics.fillStyle(this.getChunkColor(cx, cy), 1);
        chunk.graphics.fillRect(worldX, worldY, size, size);
        chunk.graphics.setDepth(-100);

        // Add texture overlay
        const textureKey = BiomeTextureGenerator.getTextureKey(biome);
        if (this.scene.textures.exists(textureKey)) {
            const tile = this.scene.add.tileSprite(
                worldX + size / 2,
                worldY + size / 2,
                size, size,
                textureKey
            );
            tile.setAlpha(0.5);
            tile.setDepth(-99);
            tile.setBlendMode(Phaser.BlendModes.OVERLAY);
            chunk.textureOverlay = tile;
        }

        // Spawn objects based on biome
        this.spawnChunkObjects(chunk, biome);

        this.chunks.set(key, chunk);
        return chunk;
    }

    spawnChunkObjects(chunk, biome) {
        const size = Config.Chunks.size;
        const worldX = chunk.x * size;
        const worldY = chunk.y * size;

        // Check if ChunkPresets is available
        if (typeof ChunkPresets === 'undefined') {
            // Fallback to random spawning
            this.spawnRandomObjects(chunk, biome);
            return;
        }

        // === SMART PATHWAY INTEGRATION ===
        // Check if this chunk has a road passing through it
        let pathDirection = null;
        if (this.scene.pathwayRenderer && this.scene.pathwayRenderer.generated) {
            pathDirection = this.scene.pathwayRenderer.getPathDirection(chunk.x, chunk.y);
        }

        let presets = [];

        if (pathDirection) {
            // PRIORITY 1: Force a pathway preset if this chunk has a road
            // Convert path direction to preset pathType matching
            const pathTypeMap = {
                'NS': 'NS',
                'EW': 'EW',
                'CROSS': 'CROSS',
                'NE': 'NE',
                'NW': 'NW',
                'SE': 'SE',
                'SW': 'SW',
                'T_N': 'T_N',
                'T_S': 'T_S',
                'T_E': 'T_E',
                'T_W': 'T_W',
                'END_N': 'NS', // Dead ends use straight path
                'END_S': 'NS',
                'END_E': 'EW',
                'END_W': 'EW'
            };

            const targetPathType = pathTypeMap[pathDirection] || null;

            if (targetPathType) {
                // Find pathway presets matching this path type
                presets = Object.entries(ChunkPresets)
                    .filter(([name, p]) => p.pathType === targetPathType)
                    .map(([name, p]) => ({ name, ...p }));

                // Mark chunk as having a path
                chunk.hasPath = true;
                chunk.pathDirection = pathDirection;
            }
        }

        // PRIORITY 2: If no path preset found, use biome-specific presets
        if (presets.length === 0) {
            presets = Object.entries(ChunkPresets)
                .filter(([name, p]) => p.biome === biome && (p.rarity === undefined || p.rarity > 0))
                .map(([name, p]) => ({ name, ...p }));
        }

        // PRIORITY 3: Fallback to Plains/Clearing if still no presets
        if (presets.length === 0) {
            presets = Object.entries(ChunkPresets)
                .filter(([name, p]) => (p.biome === 'Plains' || p.biome === 'Clearing') && (p.rarity === undefined || p.rarity > 0))
                .map(([name, p]) => ({ name, ...p }));
        }

        if (presets.length === 0) return;

        // Weighted random selection based on rarity
        const totalWeight = presets.reduce((sum, p) => sum + (p.rarity || 1), 0);
        const rand = this.seededRandom(chunk.x, chunk.y, 999) * totalWeight;
        let sum = 0;
        let selectedPreset = presets[0];
        for (let preset of presets) {
            sum += (preset.rarity || 1);
            if (sum >= rand) {
                selectedPreset = preset;
                break;
            }
        }

        chunk.preset = selectedPreset.name;

        // Parse and spawn objects from 8x8 grid
        if (!selectedPreset.grid) return;

        // Initialize floor overlays array
        chunk.floorOverlays = [];

        for (let row = 0; row < selectedPreset.grid.length; row++) {
            const cells = selectedPreset.grid[row].split(' ');
            for (let col = 0; col < cells.length; col++) {
                const cell = cells[col];

                // Parse OBJECT:FLOOR format
                const parts = cell.split(':');
                const objectCode = parts[0];
                const floorCode = parts[1] || null;

                // Calculate cell position
                const cellX = worldX + col * this.tileSize;
                const cellY = worldY + row * this.tileSize;
                const cellCenterX = cellX + this.tileSize / 2;
                const cellCenterY = cellY + this.tileSize / 2;

                // === FLOOR OVERLAY RENDERING ===
                if (floorCode && typeof BiomeTextureGenerator !== 'undefined') {
                    const floorTextureKey = BiomeTextureGenerator.getFloorTextureKey(floorCode);
                    if (floorTextureKey && this.scene.textures.exists(floorTextureKey)) {
                        const floorTile = this.scene.add.tileSprite(
                            cellCenterX,
                            cellCenterY,
                            this.tileSize, this.tileSize,
                            floorTextureKey
                        );
                        floorTile.setDepth(-98); // Above base ground (-100), below objects
                        chunk.floorOverlays.push(floorTile);
                    }
                }

                // === OBJECT SPAWNING ===
                const objDef = ObjectCodes ? ObjectCodes[objectCode] : null;
                if (objDef) {
                    // Skip spawn area
                    if (Math.abs(cellCenterX) < Config.MapSpawn.playerClearRadius &&
                        Math.abs(cellCenterY) < Config.MapSpawn.playerClearRadius) {
                        continue;
                    }

                    // Add small random offset for natural look
                    const offsetRng = this.tileSize * 0.1;
                    const ox = cellCenterX + (this.seededRandom(chunk.x * 8 + col, chunk.y * 8 + row, 3) - 0.5) * offsetRng;
                    const oy = cellCenterY + (this.seededRandom(chunk.x * 8 + col, chunk.y * 8 + row, 4) - 0.5) * offsetRng;

                    const obj = this.createWorldObject(ox, oy, objDef.type, objDef.rotation);
                    if (obj) {
                        chunk.objects.push(obj);
                    }
                }
            }
        }

        // === PATHWAY FLOOR OVERLAY ===
        // If this chunk has a path, render pathway-specific floor texture over the path cells
        if (chunk.hasPath && typeof BiomeTextureGenerator !== 'undefined') {
            this.renderPathwayFloor(chunk, biome);
        }
    }

    /**
     * Render pathway floor texture over path cells
     */
    renderPathwayFloor(chunk, biome) {
        const size = Config.Chunks.size;
        const worldX = chunk.x * size;
        const worldY = chunk.y * size;

        // Get pathway texture based on biome context
        const pathTextureKey = BiomeTextureGenerator.getPathwayTextureKey(biome);
        if (!pathTextureKey || !this.scene.textures.exists(pathTextureKey)) return;

        // Determine which cells are part of the path based on direction
        const pathCells = this.getPathCells(chunk.pathDirection);

        if (!chunk.floorOverlays) chunk.floorOverlays = [];

        for (let { row, col } of pathCells) {
            const cellX = worldX + col * this.tileSize;
            const cellY = worldY + row * this.tileSize;

            const pathTile = this.scene.add.tileSprite(
                cellX + this.tileSize / 2,
                cellY + this.tileSize / 2,
                this.tileSize, this.tileSize,
                pathTextureKey
            );
            pathTile.setDepth(-98);
            chunk.floorOverlays.push(pathTile);
        }
    }

    /**
     * Get grid cells that should have pathway floor based on path direction
     */
    getPathCells(pathDirection) {
        const cells = [];
        // Center 2 columns/rows for path (columns 3,4 or rows 3,4 in 0-7 grid)

        switch (pathDirection) {
            case 'NS':
            case 'END_N':
            case 'END_S':
                // Vertical path through center
                for (let row = 0; row < 8; row++) {
                    cells.push({ row, col: 3 });
                    cells.push({ row, col: 4 });
                }
                break;
            case 'EW':
            case 'END_E':
            case 'END_W':
                // Horizontal path through center
                for (let col = 0; col < 8; col++) {
                    cells.push({ row: 3, col });
                    cells.push({ row: 4, col });
                }
                break;
            case 'CROSS':
                // Both directions
                for (let i = 0; i < 8; i++) {
                    cells.push({ row: i, col: 3 });
                    cells.push({ row: i, col: 4 });
                    cells.push({ row: 3, col: i });
                    cells.push({ row: 4, col: i });
                }
                break;
            case 'NE':
                // North and East
                for (let row = 0; row <= 4; row++) {
                    cells.push({ row, col: 3 });
                    cells.push({ row, col: 4 });
                }
                for (let col = 3; col < 8; col++) {
                    cells.push({ row: 3, col });
                    cells.push({ row: 4, col });
                }
                break;
            case 'NW':
                // North and West
                for (let row = 0; row <= 4; row++) {
                    cells.push({ row, col: 3 });
                    cells.push({ row, col: 4 });
                }
                for (let col = 0; col <= 4; col++) {
                    cells.push({ row: 3, col });
                    cells.push({ row: 4, col });
                }
                break;
            case 'SE':
                // South and East
                for (let row = 3; row < 8; row++) {
                    cells.push({ row, col: 3 });
                    cells.push({ row, col: 4 });
                }
                for (let col = 3; col < 8; col++) {
                    cells.push({ row: 3, col });
                    cells.push({ row: 4, col });
                }
                break;
            case 'SW':
                // South and West
                for (let row = 3; row < 8; row++) {
                    cells.push({ row, col: 3 });
                    cells.push({ row, col: 4 });
                }
                for (let col = 0; col <= 4; col++) {
                    cells.push({ row: 3, col });
                    cells.push({ row: 4, col });
                }
                break;
            case 'T_N':
                // T-junction opening North
                for (let col = 0; col < 8; col++) {
                    cells.push({ row: 3, col });
                    cells.push({ row: 4, col });
                }
                for (let row = 0; row <= 3; row++) {
                    cells.push({ row, col: 3 });
                    cells.push({ row, col: 4 });
                }
                break;
            case 'T_S':
                // T-junction opening South
                for (let col = 0; col < 8; col++) {
                    cells.push({ row: 3, col });
                    cells.push({ row: 4, col });
                }
                for (let row = 4; row < 8; row++) {
                    cells.push({ row, col: 3 });
                    cells.push({ row, col: 4 });
                }
                break;
            case 'T_E':
                // T-junction opening East
                for (let row = 0; row < 8; row++) {
                    cells.push({ row, col: 3 });
                    cells.push({ row, col: 4 });
                }
                for (let col = 4; col < 8; col++) {
                    cells.push({ row: 3, col });
                    cells.push({ row: 4, col });
                }
                break;
            case 'T_W':
                // T-junction opening West
                for (let row = 0; row < 8; row++) {
                    cells.push({ row, col: 3 });
                    cells.push({ row, col: 4 });
                }
                for (let col = 0; col <= 3; col++) {
                    cells.push({ row: 3, col });
                    cells.push({ row: 4, col });
                }
                break;
        }

        return cells;
    }

    spawnRandomObjects(chunk, biome) {
        // Fallback random spawning (original logic)
        const biomeCfg = Config.Biomes[biome];
        if (!biomeCfg || !biomeCfg.objects) return;

        const size = Config.Chunks.size;
        const worldX = chunk.x * size;
        const worldY = chunk.y * size;

        for (let [objType, range] of Object.entries(biomeCfg.objects)) {
            const min = range[0] || 0;
            const max = range[1] || 0;
            const count = min + Math.floor(this.seededRandom(chunk.x * 100 + chunk.y, objType.charCodeAt(0)) * (max - min + 1));

            for (let i = 0; i < count; i++) {
                const ox = worldX + 20 + this.seededRandom(chunk.x + i, chunk.y + i * 2, 1) * (size - 40);
                const oy = worldY + 20 + this.seededRandom(chunk.x + i * 3, chunk.y + i, 2) * (size - 40);

                if (Math.abs(ox) < Config.MapSpawn.playerClearRadius &&
                    Math.abs(oy) < Config.MapSpawn.playerClearRadius) {
                    continue;
                }

                const obj = this.createWorldObject(ox, oy, objType);
                if (obj) {
                    chunk.objects.push(obj);
                }
            }
        }
    }

    createWorldObject(x, y, type, rotation = 0) {
        const cfg = Config.Objects[type];
        if (!cfg) return null;

        // Determine texture key - use orientation-specific textures for walls
        let textureKey = type.toLowerCase();
        let spriteRotation = rotation;

        if (type === 'Wall') {
            const isVertical = Math.abs(rotation - Math.PI / 2) < 0.1;
            if (isVertical) {
                textureKey = 'wall_v';
                spriteRotation = 0; // Texture is already vertical
            } else {
                textureKey = 'wall_h';
            }
        }

        if (!this.scene.textures.exists(textureKey)) {
            // Fallback to basic shape
            return this.createBasicObject(x, y, type, cfg, rotation);
        }

        // Collision categories:
        // 1 = Player, 2 = Enemy, 4 = Objects, 8 = Projectiles
        const collisionCategory = 4;
        const collidesWith = [1, 2, 4, 8]; // Collide with everything

        let obj;
        if (cfg.solid && !cfg.moveable) {
            // Static collider (Trees, Walls, Cliffs)
            obj = this.scene.matter.add.sprite(x, y, textureKey, null, {
                isStatic: true,
                label: type,
                circleRadius: cfg.radius,
                collisionFilter: {
                    category: collisionCategory,
                    mask: collidesWith.reduce((a, b) => a | b, 0)
                }
            });
        } else if (cfg.moveable) {
            // Moveable object (Rocks, Crates, Barrels)
            obj = this.scene.matter.add.sprite(x, y, textureKey, null, {
                label: type,
                circleRadius: cfg.radius,
                friction: 0.6,
                frictionAir: 0.08,
                frictionStatic: 0.8,
                restitution: 0.2,
                mass: cfg.mass || 100,
                collisionFilter: {
                    category: collisionCategory,
                    mask: collidesWith.reduce((a, b) => a | b, 0)
                }
            });
        } else {
            // Non-solid decoration
            obj = this.scene.add.sprite(x, y, textureKey);
        }

        // Dynamic scaling: force the sprite to match the physics size exactly
        // regardless of the texture resolution.
        // cfg.radius is the collision radius, so diameter is radius * 2
        // We add a slight visual padding (10%) so it doesn't look too tight
        const displayDiameter = cfg.radius * 2;

        // Use setDisplaySize to force dimensions
        obj.setDisplaySize(displayDiameter, displayDiameter);

        // Apply rotation
        if (spriteRotation !== 0) {
            obj.setRotation(spriteRotation);
        }

        obj.objectType = type;
        obj.hp = cfg.hp;
        obj.maxHp = cfg.hp;
        obj.immortal = cfg.immortal || false;
        obj.isWorldObject = true;

        // Add takeDamage method for destructible objects
        obj.takeDamage = (amount) => {
            if (obj.immortal) return; // Cannot damage immortal objects
            obj.hp -= amount;

            // Visual feedback
            if (obj.setTint) {
                obj.setTint(0xffffff);
                this.scene.time.delayedCall(100, () => {
                    if (obj.clearTint) obj.clearTint();
                });
            }

            // Spawn hit particles
            if (this.scene.spawnParticles) {
                this.scene.spawnParticles(obj.x, obj.y, this.hexToInt(cfg.color), 4);
            }

            // Destroy if HP depleted
            if (obj.hp <= 0) {
                if (this.scene.spawnParticles) {
                    this.scene.spawnParticles(obj.x, obj.y, this.hexToInt(cfg.color), 12);
                }
                obj.destroy();
            }
        };

        return obj;
    }

    createBasicObject(x, y, type, cfg, rotation = 0) {
        // Collision categories
        const collisionCategory = 4;
        const collidesWith = [1, 2, 4, 8];

        // Create container for graphics + physics
        const container = this.scene.add.container(x, y);

        // Draw the object
        const graphics = this.scene.add.graphics();
        graphics.fillStyle(this.hexToInt(cfg.color), 1);

        // Special handling for walls - draw as rectangle with orientation
        if (type === 'Wall') {
            const isVertical = Math.abs(rotation - Math.PI / 2) < 0.1;
            if (isVertical) {
                // Vertical wall - tall and thin
                const w = cfg.radius * 0.7;
                const h = cfg.radius * 2.5;
                graphics.fillRect(-w / 2, -h / 2, w, h);
                graphics.lineStyle(2, 0x3a3a3a, 0.5);
                graphics.strokeRect(-w / 2, -h / 2, w, h);
            } else {
                // Horizontal wall - wide and short
                const w = cfg.radius * 2.5;
                const h = cfg.radius * 0.7;
                graphics.fillRect(-w / 2, -h / 2, w, h);
                graphics.lineStyle(2, 0x3a3a3a, 0.5);
                graphics.strokeRect(-w / 2, -h / 2, w, h);
            }
        } else {
            // Default: draw as circle
            graphics.fillCircle(0, 0, cfg.radius);
            graphics.lineStyle(2, 0x000000, 0.3);
            graphics.strokeCircle(0, 0, cfg.radius);
        }

        container.add(graphics);

        // Add physics body if solid
        if (cfg.solid) {
            const body = this.scene.matter.add.circle(x, y, cfg.radius, {
                isStatic: !cfg.moveable,
                label: type,
                friction: cfg.moveable ? 0.6 : 0.5,
                frictionAir: cfg.moveable ? 0.08 : 0,
                frictionStatic: 0.8,
                restitution: cfg.moveable ? 0.2 : 0,
                mass: cfg.mass || Infinity,
                collisionFilter: {
                    category: collisionCategory,
                    mask: collidesWith.reduce((a, b) => a | b, 0)
                }
            });

            // CRITICAL: Link the body to the container so collision handler can find it
            body.gameObject = container;
            container.body = body;
            container.x = x;
            container.y = y;

            // Sync position with physics body
            container.preUpdate = () => {
                if (container.body) {
                    container.x = container.body.position.x;
                    container.y = container.body.position.y;
                }
            };
        }

        container.objectType = type;
        container.hp = cfg.hp;
        container.maxHp = cfg.hp;
        container.immortal = cfg.immortal || false;
        container.isWorldObject = true;

        // Add takeDamage method
        container.takeDamage = (amount) => {
            if (container.immortal) return;
            container.hp -= amount;

            // Visual feedback
            graphics.clear();
            graphics.fillStyle(0xffffff, 1);
            graphics.fillCircle(0, 0, cfg.radius);
            this.scene.time.delayedCall(100, () => {
                graphics.clear();
                graphics.fillStyle(this.hexToInt(cfg.color), 1);
                graphics.fillCircle(0, 0, cfg.radius);
                graphics.lineStyle(2, 0x000000, 0.3);
                graphics.strokeCircle(0, 0, cfg.radius);
            });

            if (this.scene.spawnParticles) {
                this.scene.spawnParticles(container.x, container.y, this.hexToInt(cfg.color), 4);
            }

            if (container.hp <= 0) {
                if (this.scene.spawnParticles) {
                    this.scene.spawnParticles(container.x, container.y, this.hexToInt(cfg.color), 12);
                }
                if (container.body) {
                    this.scene.matter.world.remove(container.body);
                }
                container.destroy();
            }
        };

        return container;
    }

    unloadChunk(key, chunk) {
        // Destroy graphics
        if (chunk.graphics) {
            chunk.graphics.destroy();
        }
        if (chunk.textureOverlay) {
            chunk.textureOverlay.destroy();
        }

        // Destroy floor overlays
        if (chunk.floorOverlays) {
            for (let floorTile of chunk.floorOverlays) {
                if (floorTile.destroy) floorTile.destroy();
            }
        }

        // Destroy objects
        for (let obj of chunk.objects) {
            if (obj.destroy) obj.destroy();
        }

        this.chunks.delete(key);
    }

    getChunk(cx, cy) {
        const key = this.getChunkKey(cx, cy);
        return this.chunks.get(key);
    }
}

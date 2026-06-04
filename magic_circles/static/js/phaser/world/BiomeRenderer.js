/**
 * BiomeTextureGenerator - Creates procedural ground textures for each biome
 */
const BiomeTextureGenerator = {
    textures: {},
    scene: null,
    size: 64,

    init(scene) {
        this.scene = scene;
        this.textures = {};

        // Helper to check if texture exists before generating
        const ensure = (key, genVal) => {
            if (this.scene.textures.exists(key)) {
                this.textures[key] = key;
            } else {
                genVal();
            }
        };

        // Generate textures for each biome
        ensure('plains_ground', () => this.createGrassTexture('plains_ground', '#4a5a3a', '#3a4a2a', '#5a6a4a', 0.6));
        ensure('forest_ground', () => this.createGrassTexture('forest_ground', '#2a4a2a', '#1a3d1a', '#3a5a3a', 0.9));
        ensure('clearing_ground', () => this.createGrassTexture('clearing_ground', '#3f4a3f', '#2f3a2f', '#4f5a4f', 0.5));
        ensure('swamp_ground', () => this.createMudTexture('swamp_ground', '#3a4a3a', '#2a3a2a', '#4a5a4a'));
        ensure('rocky_ground', () => this.createRockyTexture('rocky_ground', '#5a5a5a', '#3a3a3a', '#6a6a6a'));
        ensure('cave_ground', () => this.createCaveTexture('cave_ground', '#3a3a3a', '#2a2a2a', '#4a4a4a'));
        ensure('ruins_ground', () => this.createCobblestoneTexture('ruins_ground', '#5a5050', '#4a4040', '#6a6060'));
        ensure('graveyard_ground', () => this.createCobblestoneTexture('graveyard_ground', '#4a4a5a', '#3a3a4a', '#5a5a6a'));
        ensure('desert_ground', () => this.createSandTexture('desert_ground', '#8a7a5a', '#6a5a3a', '#9a8a6a'));
        ensure('village_ground', () => this.createCobblestoneTexture('village_ground', '#6a5a4a', '#5a4a3a', '#7a6a5a'));
        ensure('camp_ground', () => this.createDirtPathTexture('camp_ground', '#5a4a3a', '#4a3a2a', '#6a5a4a'));
        ensure('lake_ground', () => this.createWaterTexture('lake_ground', '#3a5a6a', '#2a4a5a', '#4a6a7a'));
        ensure('pathway_texture', () => this.createDirtPathTexture('pathway_texture', '#6a5a4a', '#5a5a4a', '#7a6a5a'));

        // ============================================
        // FLOOR TEXTURES (for indoor/structure areas)
        // ============================================
        // Built floor textures
        ensure('stone_floor', () => this.createCobblestoneTexture('stone_floor', '#5a5a5a', '#4a4a4a', '#6a6a6a'));
        ensure('cobblestone_floor', () => this.createCobblestoneTexture('cobblestone_floor', '#6a6a6a', '#5a5a5a', '#7a7a7a'));
        ensure('wood_floor', () => this.createWoodFloorTexture('wood_floor', '#6a4a2a', '#5a3a1a', '#7a5a3a'));
        ensure('dirt_floor', () => this.createDirtPathTexture('dirt_floor', '#5a4a3a', '#4a3a2a', '#6a5a4a'));
        ensure('tile_floor', () => this.createTileFloorTexture('tile_floor', '#7a7a8a', '#6a6a7a', '#8a8a9a'));

        // Pathway floor textures (context-aware)
        ensure('path_cobble', () => this.createCobblestoneTexture('path_cobble', '#7a6a5a', '#6a5a4a', '#8a7a6a'));
        ensure('path_stone', () => this.createCobblestoneTexture('path_stone', '#6a6060', '#5a5050', '#7a7070'));
        ensure('path_dirt', () => this.createDirtPathTexture('path_dirt', '#5a4a3a', '#4a3a2a', '#6a5a4a'));
        ensure('path_sand', () => this.createSandTexture('path_sand', '#9a8a6a', '#7a6a4a', '#aa9a7a'));
    },

    hexToInt(hex) {
        return parseInt(hex.replace('#', ''), 16);
    },

    createGrassTexture(key, baseColor, darkColor, lightColor, density = 0.7) {
        const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });

        // Base
        graphics.fillStyle(this.hexToInt(baseColor), 1);
        graphics.fillRect(0, 0, this.size, this.size);

        // Grass blades
        const bladeCount = Math.floor(80 * density);
        for (let i = 0; i < bladeCount; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            const height = 3 + Math.random() * 5;
            const lean = (Math.random() - 0.5) * 3;

            graphics.lineStyle(1, Math.random() > 0.5 ? this.hexToInt(darkColor) : this.hexToInt(lightColor));
            graphics.lineBetween(x, y, x + lean, y - height);
        }

        // Texture dots
        for (let i = 0; i < 30; i++) {
            graphics.fillStyle(Math.random() > 0.5 ? this.hexToInt(darkColor) : this.hexToInt(lightColor), 0.3 + Math.random() * 0.4);
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            graphics.fillCircle(x, y, 0.5 + Math.random() * 1.5);
        }

        graphics.generateTexture(key, this.size, this.size);
        graphics.destroy();
        this.textures[key] = key;
    },

    createCobblestoneTexture(key, baseColor, darkColor, lightColor) {
        const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });

        // Base (dark gaps)
        graphics.fillStyle(this.hexToInt(darkColor), 1);
        graphics.fillRect(0, 0, this.size, this.size);

        // Stones
        const stoneSize = 10;
        const gap = 2;

        for (let row = 0; row < this.size / (stoneSize + gap) + 1; row++) {
            const offset = (row % 2) * (stoneSize / 2 + gap / 2);
            for (let col = -1; col < this.size / (stoneSize + gap) + 1; col++) {
                const x = col * (stoneSize + gap) + offset + (Math.random() - 0.5) * 2;
                const y = row * (stoneSize + gap) + (Math.random() - 0.5) * 2;
                const w = stoneSize + (Math.random() - 0.5) * 4;
                const h = stoneSize + (Math.random() - 0.5) * 4;

                const shade = Math.random();
                const color = shade > 0.6 ? this.hexToInt(lightColor) :
                    (shade > 0.3 ? this.hexToInt(baseColor) : this.hexToInt(darkColor));

                graphics.fillStyle(color, 1);
                graphics.fillRoundedRect(x, y, w, h, 2);
            }
        }

        graphics.generateTexture(key, this.size, this.size);
        graphics.destroy();
        this.textures[key] = key;
    },

    createSandTexture(key, baseColor, darkColor, lightColor) {
        const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });

        graphics.fillStyle(this.hexToInt(baseColor), 1);
        graphics.fillRect(0, 0, this.size, this.size);

        // Sand grains
        for (let i = 0; i < 200; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            graphics.fillStyle(Math.random() > 0.5 ? this.hexToInt(darkColor) : this.hexToInt(lightColor), 0.2 + Math.random() * 0.3);
            graphics.fillCircle(x, y, 0.3 + Math.random() * 0.8);
        }

        // Wind ripples
        graphics.lineStyle(1, this.hexToInt(lightColor), 0.15);
        for (let i = 0; i < 5; i++) {
            const y = Math.random() * this.size;
            graphics.beginPath();
            graphics.moveTo(0, y);
            for (let x = 0; x < this.size; x += 4) {
                graphics.lineTo(x, y + Math.sin(x * 0.3) * 2);
            }
            graphics.strokePath();
        }

        graphics.generateTexture(key, this.size, this.size);
        graphics.destroy();
        this.textures[key] = key;
    },

    createRockyTexture(key, baseColor, darkColor, lightColor) {
        const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });

        graphics.fillStyle(this.hexToInt(baseColor), 1);
        graphics.fillRect(0, 0, this.size, this.size);

        // Rocky chunks
        for (let i = 0; i < 15; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            const size = 5 + Math.random() * 15;

            graphics.fillStyle(Math.random() > 0.5 ? this.hexToInt(darkColor) : this.hexToInt(lightColor), 0.4 + Math.random() * 0.3);

            // Irregular polygon
            const points = [];
            const pointCount = 5 + Math.floor(Math.random() * 3);
            for (let j = 0; j < pointCount; j++) {
                const angle = (j / pointCount) * Math.PI * 2;
                const r = size * (0.5 + Math.random() * 0.5);
                points.push({ x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r });
            }

            graphics.beginPath();
            graphics.moveTo(points[0].x, points[0].y);
            for (let j = 1; j < points.length; j++) {
                graphics.lineTo(points[j].x, points[j].y);
            }
            graphics.closePath();
            graphics.fillPath();
        }

        // Cracks
        graphics.lineStyle(0.5, this.hexToInt(darkColor), 0.5);
        for (let i = 0; i < 8; i++) {
            let x = Math.random() * this.size;
            let y = Math.random() * this.size;
            graphics.beginPath();
            graphics.moveTo(x, y);
            for (let j = 0; j < 3; j++) {
                x += (Math.random() - 0.5) * 15;
                y += (Math.random() - 0.5) * 15;
                graphics.lineTo(x, y);
            }
            graphics.strokePath();
        }

        graphics.generateTexture(key, this.size, this.size);
        graphics.destroy();
        this.textures[key] = key;
    },

    createCaveTexture(key, baseColor, darkColor, lightColor) {
        const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });

        graphics.fillStyle(this.hexToInt(darkColor), 1);
        graphics.fillRect(0, 0, this.size, this.size);

        // Uneven stone
        for (let i = 0; i < 20; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            graphics.fillStyle(Math.random() > 0.7 ? this.hexToInt(lightColor) : this.hexToInt(baseColor), 0.2 + Math.random() * 0.3);
            graphics.fillEllipse(x, y, 8 + Math.random() * 12, 6 + Math.random() * 10);
        }

        // Deep cracks
        graphics.lineStyle(1.5, 0x1a1a1a, 0.7);
        for (let i = 0; i < 5; i++) {
            let x = Math.random() * this.size;
            let y = Math.random() * this.size;
            graphics.beginPath();
            graphics.moveTo(x, y);
            for (let j = 0; j < 4; j++) {
                x += (Math.random() - 0.5) * 20;
                y += (Math.random() - 0.5) * 20;
                graphics.lineTo(x, y);
            }
            graphics.strokePath();
        }

        graphics.generateTexture(key, this.size, this.size);
        graphics.destroy();
        this.textures[key] = key;
    },

    createMudTexture(key, baseColor, darkColor, lightColor) {
        const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });

        graphics.fillStyle(this.hexToInt(baseColor), 1);
        graphics.fillRect(0, 0, this.size, this.size);

        // Wet patches
        for (let i = 0; i < 10; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            graphics.fillStyle(this.hexToInt(darkColor), 0.3 + Math.random() * 0.3);
            graphics.fillCircle(x, y, 5 + Math.random() * 10);
        }

        // Puddles
        graphics.fillStyle(0x2a3a3a, 0.4);
        for (let i = 0; i < 5; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            graphics.fillEllipse(x, y, 3 + Math.random() * 5, 2 + Math.random() * 3);
        }

        // Sparse grass
        for (let i = 0; i < 15; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            graphics.lineStyle(1, this.hexToInt(lightColor), 0.6);
            graphics.lineBetween(x, y, x + (Math.random() - 0.5) * 2, y - 3 - Math.random() * 3);
        }

        graphics.generateTexture(key, this.size, this.size);
        graphics.destroy();
        this.textures[key] = key;
    },

    createDirtPathTexture(key, baseColor, darkColor, lightColor) {
        const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });

        graphics.fillStyle(this.hexToInt(baseColor), 1);
        graphics.fillRect(0, 0, this.size, this.size);

        // Footstep impressions
        for (let i = 0; i < 8; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            graphics.fillStyle(this.hexToInt(darkColor), 0.25);
            graphics.fillEllipse(x, y, 2 + Math.random() * 3, 4 + Math.random() * 5);
        }

        // Pebbles
        for (let i = 0; i < 20; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            graphics.fillStyle(Math.random() > 0.5 ? 0x7a7a7a : this.hexToInt(lightColor), 0.5);
            graphics.fillCircle(x, y, 0.5 + Math.random() * 1.5);
        }

        graphics.generateTexture(key, this.size, this.size);
        graphics.destroy();
        this.textures[key] = key;
    },

    createWaterTexture(key, baseColor, darkColor, lightColor) {
        const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });

        graphics.fillStyle(this.hexToInt(baseColor), 1);
        graphics.fillRect(0, 0, this.size, this.size);

        // Ripples
        graphics.lineStyle(1, this.hexToInt(lightColor), 0.3);
        for (let i = 0; i < 6; i++) {
            const y = (i / 6) * this.size + Math.random() * 8;
            graphics.beginPath();
            for (let x = 0; x < this.size; x += 2) {
                const yOffset = Math.sin(x * 0.2 + i) * 3;
                if (x === 0) graphics.moveTo(x, y + yOffset);
                else graphics.lineTo(x, y + yOffset);
            }
            graphics.strokePath();
        }

        // Reflections
        graphics.fillStyle(this.hexToInt(lightColor), 0.2);
        for (let i = 0; i < 8; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            graphics.fillEllipse(x, y, 3 + Math.random() * 6, 1 + Math.random() * 3);
        }

        graphics.generateTexture(key, this.size, this.size);
        graphics.destroy();
        this.textures[key] = key;
    },

    getTextureKey(biome) {
        const biomeMap = {
            'Plains': 'plains_ground',
            'Forest': 'forest_ground',
            'Clearing': 'clearing_ground',
            'Swamp': 'swamp_ground',
            'Rocky': 'rocky_ground',
            'Cave': 'cave_ground',
            'Ruins': 'ruins_ground',
            'Graveyard': 'graveyard_ground',
            'Desert': 'desert_ground',
            'Village': 'village_ground',
            'Camp': 'camp_ground',
            'Lake': 'lake_ground'
        };
        return biomeMap[biome] || 'plains_ground';
    },

    /**
     * Get floor texture key from floor code (used for per-cell floor overrides)
     * @param {string} floorCode - 2-letter floor code (ST, CB, WD, DT, TL)
     * @returns {string|null} - Texture key or null if not a valid floor code
     */
    getFloorTextureKey(floorCode) {
        const floorMap = {
            'ST': 'stone_floor',
            'CB': 'cobblestone_floor',
            'WD': 'wood_floor',
            'DT': 'dirt_floor',
            'TL': 'tile_floor'
        };
        return floorMap[floorCode] || null;
    },

    /**
     * Get pathway floor texture based on surrounding biome context
     * @param {string} biome - The biome where the pathway is located
     * @returns {string} - Texture key for pathway floor
     */
    getPathwayTextureKey(biome) {
        const pathwayMap = {
            'Village': 'path_cobble',
            'Ruins': 'path_stone',
            'Graveyard': 'path_stone',
            'Desert': 'path_sand',
            'Plains': 'path_dirt',
            'Forest': 'path_dirt',
            'Clearing': 'path_dirt',
            'Swamp': 'path_dirt',
            'Rocky': 'path_stone',
            'Cave': 'path_stone',
            'Camp': 'path_dirt',
            'Lake': 'path_dirt'
        };
        return pathwayMap[biome] || 'path_dirt';
    },

    /**
     * Create wood floor texture (planks pattern)
     */
    createWoodFloorTexture(key, baseColor, darkColor, lightColor) {
        const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });

        // Base wood color
        graphics.fillStyle(this.hexToInt(baseColor), 1);
        graphics.fillRect(0, 0, this.size, this.size);

        // Wood planks (horizontal lines)
        const plankHeight = 12;
        const gap = 1;

        for (let row = 0; row < this.size / (plankHeight + gap) + 1; row++) {
            const y = row * (plankHeight + gap);
            const offset = (row % 2) * (this.size / 3); // Stagger planks

            // Draw planks
            for (let col = -1; col < 4; col++) {
                const x = col * (this.size / 2.5) + offset + (Math.random() - 0.5) * 3;
                const w = this.size / 2.5 - gap;
                const h = plankHeight;

                // Plank color variation
                const shade = Math.random();
                const color = shade > 0.6 ? this.hexToInt(lightColor) :
                    (shade > 0.3 ? this.hexToInt(baseColor) : this.hexToInt(darkColor));

                graphics.fillStyle(color, 1);
                graphics.fillRect(x, y, w, h);

                // Wood grain lines
                graphics.lineStyle(0.5, this.hexToInt(darkColor), 0.3);
                for (let i = 0; i < 3; i++) {
                    const grainY = y + 2 + Math.random() * (h - 4);
                    graphics.beginPath();
                    graphics.moveTo(x, grainY);
                    for (let gx = x; gx < x + w; gx += 4) {
                        graphics.lineTo(gx, grainY + (Math.random() - 0.5) * 1);
                    }
                    graphics.strokePath();
                }
            }
        }

        // Plank gaps (dark lines)
        graphics.lineStyle(gap, this.hexToInt(darkColor), 0.8);
        for (let row = 0; row < this.size / (plankHeight + gap) + 1; row++) {
            const y = row * (plankHeight + gap);
            graphics.lineBetween(0, y, this.size, y);
        }

        graphics.generateTexture(key, this.size, this.size);
        graphics.destroy();
        this.textures[key] = key;
    },

    /**
     * Create tile floor texture (clean stone tiles)
     */
    createTileFloorTexture(key, baseColor, darkColor, lightColor) {
        const graphics = this.scene.make.graphics({ x: 0, y: 0, add: false });

        // Base (grout color)
        graphics.fillStyle(this.hexToInt(darkColor), 1);
        graphics.fillRect(0, 0, this.size, this.size);

        // Tiles
        const tileSize = 14;
        const gap = 2;

        for (let row = 0; row < this.size / (tileSize + gap) + 1; row++) {
            for (let col = 0; col < this.size / (tileSize + gap) + 1; col++) {
                const x = col * (tileSize + gap);
                const y = row * (tileSize + gap);
                const w = tileSize;
                const h = tileSize;

                // Tile color with subtle variation
                const shade = Math.random();
                const color = shade > 0.7 ? this.hexToInt(lightColor) :
                    (shade > 0.2 ? this.hexToInt(baseColor) : this.hexToInt(darkColor));

                graphics.fillStyle(color, 1);
                graphics.fillRect(x, y, w, h);

                // Tile highlight (top-left)
                graphics.lineStyle(1, this.hexToInt(lightColor), 0.3);
                graphics.lineBetween(x, y, x + w, y);
                graphics.lineBetween(x, y, x, y + h);

                // Tile shadow (bottom-right)
                graphics.lineStyle(1, this.hexToInt(darkColor), 0.3);
                graphics.lineBetween(x + w, y, x + w, y + h);
                graphics.lineBetween(x, y + h, x + w, y + h);
            }
        }

        graphics.generateTexture(key, this.size, this.size);
        graphics.destroy();
        this.textures[key] = key;
    }
};

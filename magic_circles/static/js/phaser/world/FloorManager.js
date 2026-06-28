/**
 * FloorManager — Generates and manages a single bounded arena per floor.
 * Replaces the infinite ChunkManager streaming system.
 *
 * Each floor is a 5×5 chunk grid (1600×1600 px) centered at (0,0).
 * floor N is always regenerated identically via hash(worldSeed, depth).
 */
class FloorManager {
    constructor(scene) {
        this.scene = scene;
        this._floor = null;

        // All visual / physics objects for the current floor
        this._chunks = [];          // [{ graphics, textureOverlay, objects[] }]
        this._allObjects = [];      // flat list of world-objects for body lookup
        this._perimeterBodies = []; // immortal perimeter Matter bodies
        this._gateGraphics = null;
        this._gateLabel = null;
        this._riftGraphics = null;
        this._riftLabel = null;
    }

    /* ─── Deterministic seed ─── */

    floorSeed(depth) {
        const ws = this.scene.worldSeed || '0';
        let h = 0;
        for (let i = 0; i < ws.length; i++) {
            h = ((h << 5) - h + ws.charCodeAt(i)) | 0;
        }
        h = ((h << 5) - h + depth * 1337) | 0;
        return Math.abs(h) || 1;
    }

    _rand(seed, salt) {
        let h = (seed + salt * 1000) | 0;
        h = ((h << 5) - h + salt * 777) | 0;
        h = ((h << 5) - h + (seed ^ salt)) | 0;
        return (Math.abs(h) % 100000) / 100000;
    }

    /* ─── Public API ─── */

    get bounds()       { return this._floor ? this._floor.bounds      : { x: -800, y: -800, width: 1600, height: 1600 }; }
    get spawnPoint()   { return this._floor ? this._floor.spawnPoint  : { x: 0, y: 0 }; }
    get gate()         { return this._floor ? this._floor.gate        : null; }
    get returnRift()   { return this._floor ? this._floor.returnRift  : null; }
    get currentFloor() { return this._floor; }

    getObjectByBody(body) {
        for (const obj of this._allObjects) {
            if (!obj || !obj.body) continue;
            if (obj.body === body || obj.body.id === body.id) return obj;
        }
        return null;
    }

    /* ─── Generate ─── */

    generateFloor(depth) {
        const cfg        = Config.FloorGen;
        const chunkSize  = Config.Chunks.size; // 320
        const seed       = this.floorSeed(depth);

        // Pick theme deterministically
        const themeIdx = Math.floor(this._rand(seed, 1) * Themes.length);
        const theme    = Themes[themeIdx];

        const halfW = (cfg.cols * chunkSize) / 2;
        const halfH = (cfg.rows * chunkSize) / 2;

        // Gate: top edge; Return Rift: bottom edge
        this._floor = {
            depth,
            seed,
            theme,
            bounds:      { x: -halfW, y: -halfH, width: cfg.cols * chunkSize, height: cfg.rows * chunkSize },
            spawnPoint:  { x: 0, y: 150 },
            gate:        { x: 0, y: -halfH + 80, unlockSeconds: cfg.gateUnlockSeconds, unlockProgress: 0, state: 'locked' },
            returnRift:  depth > 0 ? { x: 0, y: halfH - 80 } : null,
            bossSpawn:   { x: 0, y: -halfH + 220 },
            cleared:     false
        };

        this._generateGround(depth, seed, theme, cfg, chunkSize);
        this._spawnPerimeter();
        this._placeGate();
        if (depth > 0) this._placeReturnRift();

        return this._floor;
    }

    /* ─── Ground + objects ─── */

    _generateGround(depth, seed, theme, cfg, chunkSize) {
        const biome    = theme.biome;
        const biomeCfg = Config.Biomes[biome] || Config.Biomes.Clearing;
        const hexColor = biomeCfg.color || '#2a3a2a';
        const bgColor  = parseInt(hexColor.replace('#', ''), 16);

        const { x: bx, y: by } = this._floor.bounds;

        for (let row = 0; row < cfg.rows; row++) {
            for (let col = 0; col < cfg.cols; col++) {
                const wx = bx + col * chunkSize;
                const wy = by + row * chunkSize;

                // Ground tile
                const g = this.scene.add.graphics();
                g.fillStyle(bgColor, 1);
                g.fillRect(wx, wy, chunkSize, chunkSize);
                g.setDepth(-100);

                const chunkData = { graphics: g, textureOverlay: null, objects: [] };

                // Biome texture overlay
                if (typeof BiomeTextureGenerator !== 'undefined') {
                    const texKey = BiomeTextureGenerator.getTextureKey(biome);
                    if (texKey && this.scene.textures.exists(texKey)) {
                        const tile = this.scene.add.tileSprite(
                            wx + chunkSize / 2, wy + chunkSize / 2,
                            chunkSize, chunkSize, texKey
                        );
                        tile.setAlpha(0.45).setDepth(-99).setBlendMode(Phaser.BlendModes.OVERLAY);
                        chunkData.textureOverlay = tile;
                    }
                }

                // Scatter objects from biome config
                if (biomeCfg.objects) {
                    for (const [objType, range] of Object.entries(biomeCfg.objects)) {
                        const min    = range[0] || 0;
                        const max    = range[1] || 0;
                        const salt   = objType.charCodeAt(0) * 31 + col * 13 + row * 7;
                        const count  = min + Math.floor(this._rand(seed + depth, salt) * (max - min + 1));

                        for (let i = 0; i < count; i++) {
                            const ox = wx + 20 + this._rand(seed + col * 100 + i * 7, salt + i)       * (chunkSize - 40);
                            const oy = wy + 20 + this._rand(seed + row * 100 + i * 7 + 1, salt + i + 1) * (chunkSize - 40);

                            // Keep spawn area clear
                            if (Math.abs(ox) < Config.MapSpawn.playerClearRadius &&
                                Math.abs(oy) < Config.MapSpawn.playerClearRadius) continue;

                            const obj = this._createObject(ox, oy, objType);
                            if (obj) {
                                chunkData.objects.push(obj);
                                this._allObjects.push(obj);
                            }
                        }
                    }
                }

                this._chunks.push(chunkData);
            }
        }
    }

    _createObject(x, y, type) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const cfg = Config.Objects[type];
        if (!cfg) return null;

        const collFilter = {
            category: CAT.OBJECT,
            mask: CAT.PLAYER | CAT.ENEMY | CAT.OBJECT | CAT.PROJECTILE
        };
        const color = parseInt((cfg.color || '#555555').replace('#', ''), 16);

        let matterBody = null;
        const gfx = this.scene.add.circle(x, y, cfg.radius, color, 0.9);
        gfx.setDepth(1);

        if (cfg.solid && !cfg.moveable) {
            matterBody = this.scene.matter.add.circle(x, y, cfg.radius, {
                isStatic: true,
                label: type,
                collisionFilter: collFilter
            });
        } else if (cfg.moveable) {
            matterBody = this.scene.matter.add.circle(x, y, cfg.radius, {
                isStatic: false,
                label: type,
                friction: 0.6,
                frictionAir: 0.08,
                mass: cfg.mass || 100,
                collisionFilter: collFilter
            });
        } else {
            // Non-solid decoration — no physics body
        }

        const scene = this.scene;
        const obj = {
            body:      matterBody,
            graphics:  gfx,
            type,
            hp:        cfg.hp,
            maxHp:     cfg.hp,
            immortal:  cfg.immortal || false,
            isWorldObject: true,
            takeDamage(amount) {
                if (obj.immortal || obj.hp === Infinity) return;
                obj.hp -= amount;
                if (scene.spawnParticles) scene.spawnParticles(x, y, color, 4);
                if (obj.hp <= 0) {
                    if (scene.spawnParticles) scene.spawnParticles(x, y, color, 10);
                    if (obj.graphics) { try { obj.graphics.destroy(); } catch(e){} obj.graphics = null; }
                    if (obj.body)    { try { scene.matter.world.remove(obj.body); } catch(e){} obj.body = null; }
                    const idx = scene.floorManager ? scene.floorManager._allObjects.indexOf(obj) : -1;
                    if (idx >= 0) scene.floorManager._allObjects.splice(idx, 1);
                }
            }
        };

        return obj;
    }

    /* ─── Perimeter ─── */

    _spawnPerimeter() {
        const { x, y, width: w, height: h } = this._floor.bounds;
        const thick = 50;
        const collFilter = {
            category: CAT.OBJECT,
            mask: CAT.PLAYER | CAT.ENEMY | CAT.OBJECT | CAT.PROJECTILE
        };

        const walls = [
            { rx: x + w / 2,         ry: y - thick / 2,        rw: w + thick * 2, rh: thick }, // top
            { rx: x + w / 2,         ry: y + h + thick / 2,    rw: w + thick * 2, rh: thick }, // bottom
            { rx: x - thick / 2,     ry: y + h / 2,            rw: thick,         rh: h     }, // left
            { rx: x + w + thick / 2, ry: y + h / 2,            rw: thick,         rh: h     }  // right
        ];

        for (const wall of walls) {
            if (!Number.isFinite(wall.rx) || !Number.isFinite(wall.ry)) continue;
            const body = this.scene.matter.add.rectangle(wall.rx, wall.ry, wall.rw, wall.rh, {
                isStatic: true,
                label: 'Wall',
                collisionFilter: collFilter
            });
            this._perimeterBodies.push(body);
        }

        // Visible border line
        const border = this.scene.add.graphics();
        border.lineStyle(4, 0x334455, 0.8);
        border.strokeRect(x, y, w, h);
        border.setDepth(5);
        this._borderGraphics = border;
    }

    /* ─── Gate ─── */

    _placeGate() {
        const gate = this._floor.gate;
        const scene = this.scene;

        const g = scene.add.graphics();
        g.fillStyle(0x22cc88, 1);
        g.fillRect(gate.x - 45, gate.y - 18, 90, 36);
        g.lineStyle(3, 0x55ffbb, 1);
        g.strokeRect(gate.x - 45, gate.y - 18, 90, 36);
        g.setDepth(10);

        const label = scene.add.text(gate.x, gate.y, 'EXIT GATE', {
            fontFamily: 'Arial', fontSize: '13px', color: '#00ffaa', stroke: '#003322', strokeThickness: 3
        }).setOrigin(0.5).setDepth(11);

        this._gateGraphics = g;
        this._gateLabel    = label;
    }

    /* ─── Return Rift ─── */

    _placeReturnRift() {
        const rift = this._floor.returnRift;
        if (!rift) return;
        const scene = this.scene;

        const g = scene.add.graphics();
        g.fillStyle(0x8844cc, 1);
        g.fillRect(rift.x - 38, rift.y - 16, 76, 32);
        g.lineStyle(3, 0xcc88ff, 1);
        g.strokeRect(rift.x - 38, rift.y - 16, 76, 32);
        g.setDepth(10);

        const label = scene.add.text(rift.x, rift.y, 'RETURN RIFT', {
            fontFamily: 'Arial', fontSize: '11px', color: '#cc88ff', stroke: '#220033', strokeThickness: 3
        }).setOrigin(0.5).setDepth(11);

        this._riftGraphics = g;
        this._riftLabel    = label;
    }

    /* ─── Teardown ─── */

    teardownFloor() {
        // Chunk ground + objects
        for (const chunk of this._chunks) {
            if (chunk.graphics)      { try { chunk.graphics.destroy(); }      catch(e){} }
            if (chunk.textureOverlay){ try { chunk.textureOverlay.destroy(); } catch(e){} }
            for (const obj of chunk.objects) {
                if (obj.graphics) { try { obj.graphics.destroy(); } catch(e){} }
                if (obj.body)     { try { this.scene.matter.world.remove(obj.body); } catch(e){} }
            }
        }
        this._chunks     = [];
        this._allObjects = [];

        // Perimeter
        for (const body of this._perimeterBodies) {
            try { this.scene.matter.world.remove(body); } catch(e) {}
        }
        this._perimeterBodies = [];
        if (this._borderGraphics) { try { this._borderGraphics.destroy(); } catch(e){} this._borderGraphics = null; }

        // Gate
        if (this._gateGraphics) { try { this._gateGraphics.destroy(); } catch(e){} this._gateGraphics = null; }
        if (this._gateLabel)    { try { this._gateLabel.destroy();    } catch(e){} this._gateLabel    = null; }

        // Rift
        if (this._riftGraphics) { try { this._riftGraphics.destroy(); } catch(e){} this._riftGraphics = null; }
        if (this._riftLabel)    { try { this._riftLabel.destroy();    } catch(e){} this._riftLabel    = null; }

        this._floor = null;
    }
}

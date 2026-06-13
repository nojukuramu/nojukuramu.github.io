/**
 * GameScene3D.js — Main gameplay scene for the Enable3D 3D port.
 *
 * Integrates:
 *   - Enable3D / THREE rendering (via this.third, accessThirdDimension)
 *   - Custom CollisionWorld XZ-plane physics (no Ammo.js)
 *   - Player3D, Enemy3D, Projectile3D entities
 *   - ChunkManager3D world streaming + Pathway3D + Biome3D fog
 *   - Effects3D particle system
 *   - 2D Phaser HUD overlaid on top of the 3D render
 *   - MinimapSystem (reused from 2D) via the player.y → player.z alias
 *   - TouchControls and InventorySystem (reused from 2D)
 *
 * Key design decisions:
 *   - Scene key MUST be 'GameScene' so MenuScene3D and MagicEditorScene
 *     (which call scene.launch/pause by key) work without modification.
 *   - 1 unit = 1px; 2D Y → 3D Z.  Player3D.y returns Z so all ported
 *     castSpell / minimap code that reads player.y works unchanged.
 *   - HUD lives here (not in a separate HUDScene3D) so pause/resume works
 *     exactly as in the 2D build.
 *   - Plain global-script style; no ES module imports.
 *
 * Globals assumed at runtime:
 *   THREE, ENABLE3D, Phaser, Config, GameState, W3D,
 *   CollisionWorld, ModelFactory, Effects3D,
 *   Player3D, Enemy3D, Projectile3D,
 *   ChunkManager3D, Pathway3D, Biome3D,
 *   InventorySystem, MinimapSystem (optional), TouchControls (optional)
 */

class GameScene3D extends ENABLE3D.Scene3D {

    constructor() {
        super({ key: 'GameScene' });
    }

    // =========================================================================
    // init — called before create(), receives data from scene.start()/launch()
    // =========================================================================

    init(data) {
        // accessThirdDimension() must be the very first call so Enable3D wires
        // up this.third (renderer, camera, scene) before anything else runs.
        this.accessThirdDimension();

        // Store seed (mirrors 2D GameScene.init exactly)
        this.worldSeed = data?.seed
            || (Date.now().toString(36) + Math.random().toString(36).substr(2, 5));
        GameState.lastSeed = this.worldSeed;
        console.log('[GameScene3D] World seed:', this.worldSeed);
    }

    // =========================================================================
    // create — set up the full scene in the prescribed order
    // =========================================================================

    create() {
        // ------------------------------------------------------------------
        // 1. Seed Phaser RNG for consistent procedural generation
        // ------------------------------------------------------------------
        Phaser.Math.RND.sow([this.worldSeed]);

        // ------------------------------------------------------------------
        // 2. 3D renderer / lights / fog / camera rig
        // ------------------------------------------------------------------
        const third = this.third;

        // Correct colour space for modern THREE
        third.renderer.outputColorSpace = THREE.SRGBColorSpace;

        // Hemisphere light — sky (blue-white) / ground (dark olive)
        const hemiLight = new THREE.HemisphereLight(0xbfd8ff, 0x3a3a2a, 0.55);
        third.scene.add(hemiLight);

        // Ambient fill
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
        third.scene.add(ambientLight);

        // Directional sun (warm, casts shadows in principle)
        const dirLight = new THREE.DirectionalLight(0xfff4e0, 0.9);
        dirLight.position.set(300, 700, -200);
        third.scene.add(dirLight);
        // Keep a ref so updateCamera() can move the sun with the player
        this.sun = dirLight;

        // Fog + background (shared ONE Color instance so lerp in updateFog works)
        this._fogColor = new THREE.Color(0x3a4a2a);
        third.scene.fog = new THREE.Fog(this._fogColor, 900, 1500);
        third.scene.background = this._fogColor;

        // Camera rig — isometric-style top-down perspective
        const cam = third.camera;
        cam.fov  = 50;
        cam.near = 1;
        cam.far  = 3000;
        cam.updateProjectionMatrix();
        this.camTarget = new THREE.Vector3(0, 0, 0);
        this.camZoom   = 1.0;
        // Position camera once before any entity exists (dt=1 clamps fine)
        this.updateCamera(1);

        // ------------------------------------------------------------------
        // 3. Custom physics world
        // ------------------------------------------------------------------
        this.world = new CollisionWorld({ cellSize: 160 });

        // ------------------------------------------------------------------
        // 4. ModelFactory — idempotent init (textures kicked off in BootScene3D)
        // ------------------------------------------------------------------
        if (ModelFactory.init) {
            ModelFactory.init(third);
        }

        // ------------------------------------------------------------------
        // 5. Pathway network (must exist before ChunkManager so chunks can
        //    query hasPath / getPathDirection / buildChunkPath)
        // ------------------------------------------------------------------
        this.pathways = new Pathway3D(this);
        this.pathways.init(this.worldSeed);

        // ------------------------------------------------------------------
        // 6. Chunk streaming
        // ------------------------------------------------------------------
        this.chunkManager = new ChunkManager3D(this);
        this.chunkManager.seed = this.worldSeed;
        this.chunkManager.init();

        // ------------------------------------------------------------------
        // 7. Inventory system
        // ------------------------------------------------------------------
        this.inventorySystem = new InventorySystem(this);
        this.inventorySystem.init(Config);
        GameState.inventorySystem = this.inventorySystem;

        // ------------------------------------------------------------------
        // 8. Entity arrays (enemies + projectiles also managed in GameState)
        // ------------------------------------------------------------------
        this.enemies     = [];
        this.projectiles = [];

        // ------------------------------------------------------------------
        // 9. Effects system
        // ------------------------------------------------------------------
        this.effects = new Effects3D(this);

        // ------------------------------------------------------------------
        // 10. Player (also sets GameState.player)
        // ------------------------------------------------------------------
        this.player = new Player3D(this, 0, 0);

        // ------------------------------------------------------------------
        // 11. Initial enemy wave
        // ------------------------------------------------------------------
        this.spawnInitialEnemies();

        // ------------------------------------------------------------------
        // 12. HUD (2D Phaser overlay drawn over the 3D canvas)
        // ------------------------------------------------------------------
        this.createHUD();

        // ------------------------------------------------------------------
        // 13. Minimap (optional — reused from 2D, player.y returns z alias)
        // ------------------------------------------------------------------
        if (typeof MinimapSystem !== 'undefined') {
            this.minimap = new MinimapSystem(this);
            this.minimap.create();
        }

        // ------------------------------------------------------------------
        // 14. Input and collision handlers
        // ------------------------------------------------------------------
        this.setupInput();
        this.setupCollisionHandlers();

        // ------------------------------------------------------------------
        // 15. Cast-spell event (from MagicEditorScene)
        // ------------------------------------------------------------------
        this.events.on('cast-spell', () => {
            try {
                this.castSpell();
            } catch (err) {
                console.error('cast-spell recovered:', err);
            }
        });

        // ------------------------------------------------------------------
        // 16. Inventory UI (DOM hotbar)
        // ------------------------------------------------------------------
        this.setupInventoryUI();

        // ------------------------------------------------------------------
        // 17. Mobile touch controls (optional)
        // ------------------------------------------------------------------
        if (GameState.isMobile && typeof TouchControls !== 'undefined') {
            this.touchControls = new TouchControls(this);
        }

        // ------------------------------------------------------------------
        // 18. Resize hook — re-anchor HUD / minimap and update camera aspect
        // ------------------------------------------------------------------
        this.scale.on('resize', this.onResize, this);
        this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));

        // ------------------------------------------------------------------
        // 19. Inventory bar visibility already handled by setupInventoryUI()
        // ------------------------------------------------------------------

        // ------------------------------------------------------------------
        // 20. Optional 2D camera fade-in (the main 2D camera sits over the 3D)
        // ------------------------------------------------------------------
        this.cameras.main.fadeIn(400);

        console.log('[GameScene3D] created with seed:', this.worldSeed);
    }

    // =========================================================================
    // onResize — called when the viewport resizes (rotate/resize)
    // =========================================================================

    onResize(gameSize) {
        const w = gameSize ? gameSize.width  : this.cameras.main.width;
        const h = gameSize ? gameSize.height : this.cameras.main.height;

        // Re-anchor minimap
        if (this.minimap && this.minimap.resize) {
            try { this.minimap.resize(w, h); } catch (e) { /* ignore */ }
        }

        // Reposition HUD (scrollFactor 0 anchors to camera)
        if (this.hud) {
            if (GameState.isMobile) {
                this.hud.setPosition(4, 52).setScale(0.82);
            } else {
                this.hud.setPosition(0, 0).setScale(1);
            }
        }

        // Update 3D camera aspect so the frustum doesn't stretch
        if (this.third && this.third.camera) {
            const camW = gameSize ? gameSize.width  : this.scale.width;
            const camH = gameSize ? gameSize.height : this.scale.height;
            const cam  = this.third.camera;
            cam.aspect = camW / camH;
            cam.updateProjectionMatrix();
        }
    }

    // =========================================================================
    // setupInput — port of 2D GameScene.setupInput + new 3D additions
    // =========================================================================

    setupInput() {
        // Disable right-click context menu in the canvas
        this.input.mouse.disableContextMenu();

        // On mobile, casting is driven ONLY by TouchControls buttons.
        // Mouse handlers are desktop-only.
        if (!GameState.isMobile) {
            // Left click → cast spell
            this.input.on('pointerdown', (pointer) => {
                try {
                    if (pointer.leftButtonDown() && !GameState.isMagicOpen) {
                        this.castSpell();
                    }
                } catch (err) {
                    console.error('Cast input recovered from error:', err);
                }
            });

            // Right click → remote trigger
            this.input.on('pointerdown', (pointer) => {
                try {
                    if (pointer.rightButtonDown()) {
                        this.remoteTrigger();
                    }
                } catch (err) {
                    console.error('Remote-trigger input recovered from error:', err);
                }
            });
        }

        // M key → open magic editor (all platforms)
        this.input.keyboard.on('keydown-M', () => {
            if (!GameState.isMagicOpen) {
                this.openMagicEditor();
            }
        });

        // Mouse wheel → zoom the 3D camera
        this.input.on('wheel', (pointer, gameObjects, dx, dy) => {
            this.camZoom = Phaser.Math.Clamp(
                this.camZoom + (dy > 0 ? -0.1 : 0.1),
                0.6,
                1.6
            );
        });
    }

    // =========================================================================
    // setupCollisionHandlers — wire CollisionWorld callback pairs
    // =========================================================================

    setupCollisionHandlers() {
        const W = CollisionWorld;

        // Projectile hits enemy
        this.world.onOverlap('projectile', 'enemy', (pB, eB) => {
            const p = pB.owner;
            const e = eB.owner;
            if (p && !p.isDead && e && p.onHitEnemy) {
                p.onHitEnemy(e);
            }
        });

        // Projectile hits world object
        this.world.onOverlap('projectile', 'object', (pB, oB) => {
            const p = pB.owner;
            if (p && !p.isDead && p.onHitObject) {
                p.onHitObject(oB.owner);
            }
        });

        // Projectile hits player (self-damage possible)
        this.world.onOverlap('projectile', 'player', (pB, plB) => {
            this.handleProjectilePlayerHit(pB.owner, plB.owner);
        });

        // Player walks into enemy
        this.world.onOverlap('player', 'enemy', (plB, eB) => {
            this.handlePlayerEnemyCollision(plB.owner, eB.owner);
        });
    }

    // =========================================================================
    // handleProjectilePlayerHit — port of 2D version, adapted for 3D bodies
    // =========================================================================

    handleProjectilePlayerHit(projectile, player) {
        if (!projectile || projectile.isDead || !player) return;

        // Guard: player is invincible during a dash
        if (player.invincible) return;

        // Activation delay hasn't elapsed — projectile not live yet
        if (projectile.activationDelay > 0) return;

        // Must travel at least 50 units to hit own caster
        if (projectile.caster === player && projectile.distanceTraveled < 50) return;

        // Apply damage
        player.takeDamage(projectile.damage);

        // Knockback: use 3D body velocity (vx/vz) normalised
        if (projectile.body) {
            const vx  = projectile.body.vx;
            const vz  = projectile.body.vz;
            const mag = Math.hypot(vx, vz) || 1;
            const knockback = projectile.power * 0.1;
            player.body.vx += (vx / mag) * knockback;
            player.body.vz += (vz / mag) * knockback;
        }

        // Visual feedback
        this.spawnParticles3D(player.x, player.z, projectile.mainColor || 0xff0000, 8);
        this.cameras.main.shake(80, 0.008);

        // Pierce / kill
        if (projectile.pierceRemaining > 0) {
            projectile.pierceRemaining--;
        } else {
            projectile.die();
        }
    }

    // =========================================================================
    // handlePlayerEnemyCollision
    // =========================================================================

    handlePlayerEnemyCollision(player, enemy) {
        // Only hurt the player; enemy contact damage (10 hp/collision)
        if (player && !player.invincible) {
            player.takeDamage(10);
        }
    }

    // =========================================================================
    // openMagicEditor — verbatim from 2D GameScene
    // =========================================================================

    openMagicEditor() {
        GameState.isMagicOpen = true;
        GameState.timeScale   = 0.1; // slow motion

        this.scene.pause();
        this.scene.launch('MagicEditorScene');
    }

    // =========================================================================
    // castSpell — near-verbatim from 2D with two targeted substitutions:
    //   (a) new ProjectileSprite → new Projectile3D
    //   (b) recoil setVelocity call → direct body.vx/vz mutation
    //   (c) this.player.rad → this.player.body.radius
    //   All other logic (stack/predator, spectrum, speed quad math, instability,
    //   runeOffset, buildPayloadChain, stagger, particles, shake/flash) is
    //   verbatim from the 2D source.
    // =========================================================================

    castSpell() {
        // === ELEMENTAL LOGIC (SHAPES = FUEL) ===
        let stack    = [];
        let manaCost = 0;

        // Flatten all shapes from visible layers
        let allShapes = [];
        GameState.magic.layers.forEach(layer => {
            if (!layer.visible) return;
            layer.items.forEach(item => {
                if (item.type === 'SHAPE') allShapes.push(item.data);
            });
        });

        // Power multiplier affects mana costs
        const powerMult = (GameState.magic.layers[0] && GameState.magic.layers[0].power)
            || GameState.magic.powerMultiplier || 1;
        const manaCostMult = 1 + (powerMult - 1) * 0.2;

        // Aggregate costs per element first to avoid partial deductions
        const costByElement = {};
        allShapes.forEach(shape => {
            const el   = shape.element;
            const cost = Math.ceil((Config.ManaCost[el] || 15) * manaCostMult);
            costByElement[el] = (costByElement[el] || 0) + cost;
        });

        // Stack Reduction Algorithm (predator logic) — only count affordable elements
        allShapes.forEach(shape => {
            const element    = shape.element;
            const actualCost = Math.ceil((Config.ManaCost[element] || 15) * manaCostMult);

            if (this.player.mana[element] >= (costByElement[element] || 0)) {
                manaCost += actualCost;

                // Predator Logic: bottom beats top
                if (stack.length > 0) {
                    const top    = stack[stack.length - 1];
                    const bottom = element;

                    let beats = false;
                    if (bottom === 'Water' && top === 'Fire')  beats = true;
                    if (bottom === 'Fire'  && top === 'Earth') beats = true;
                    if (bottom === 'Earth' && top === 'Air')   beats = true;
                    if (bottom === 'Air'   && top === 'Water') beats = true;

                    if (beats) {
                        stack.pop();
                    } else {
                        stack.push(bottom);
                    }
                } else {
                    stack.push(element);
                }
            }
        });

        // Deduct total costs now that we know what's affordable
        for (const [el, cost] of Object.entries(costByElement)) {
            if (this.player.mana[el] >= cost) {
                this.player.mana[el] -= cost;
            }
        }

        // === CIRCLE LOGIC (LAYER-BASED) ===
        let circleLayers = [];
        GameState.magic.layers.forEach(layer => {
            if (!layer.visible) return;

            let layerCircles = [];
            layer.items.forEach(item => {
                if (item.type === 'CIRCLE') {
                    layerCircles.push(item.data);
                }
            });

            if (layerCircles.length > 0) {
                circleLayers.push(layerCircles);
            }
        });

        // === FALLBACK LOGIC ===
        const hasCircles           = circleLayers.length > 0;
        const hasElements          = stack.length > 0;
        const hadShapesButNoMana   = allShapes.length > 0 && stack.length === 0;

        // Complete failure — fire Base Magic
        if (!hasCircles && !hasElements) {
            this.castBaseMagic();
            return;
        }

        // Had shapes but no mana — fire Base Magic
        if (hadShapesButNoMana) {
            this.castBaseMagic();
            return;
        }

        // Virtual circle fallback (elements but no circles drawn)
        if (circleLayers.length === 0) {
            circleLayers.push([{
                center: { x: 0, y: 0 },
                rad:    30,
                runes:  [],
                virtual: true
            }]);
        }

        // === EXECUTION ===
        const containerLayer = circleLayers[0];       // thrown circles
        const payloadLayers  = circleLayers.slice(1); // payload detonations

        // Damage and power base values
        let baseDmg   = stack.length > 0 ? stack.length * (Config.BaseDamagePerElement || 20) : 10;
        let basePower = ((Config.BasePower || 50) + (stack.length * 25)) * powerMult;

        // === INSTABILITY PENALTIES (4-quadrant symmetry) ===
        let stability = (GameState.magic && Number.isFinite(GameState.magic.stability))
            ? GameState.magic.stability : 1;
        let instab = 1 - stability;
        if (!Number.isFinite(instab) || instab < 0) instab = 0;
        if (instab > 1) instab = 1;
        if (instab > 0) {
            const ins = Config.Instability;
            basePower *= (1 - instab * ins.powerMax);
            baseDmg   *= (1 - instab * ins.dmgMax);

            if (stack.length > 0 && Math.random() < instab * ins.mixChance) {
                const elements = ['Air', 'Fire', 'Earth', 'Water'];
                const idx      = Math.floor(Math.random() * stack.length);
                stack[idx]     = elements[Math.floor(Math.random() * elements.length)];
            }
        }

        // Direction
        const angle = this.player.aimAngle;

        // Spawn projectile for each circle in the container layer
        let totalRecoil = 0;
        containerLayer.forEach((circle, circleIndex) => {
            // Calculate spectrum
            const spectrum       = this.getSpellSpectrum(basePower, circle.rad);
            const spectrumConfig = Config.SpellSpectrum.effects[spectrum] || {};

            // === SPEED CALCULATION BASED ON SIZE + POWER QUADRANT ===
            const SMALL_THRESHOLD  = 30;
            const LARGE_THRESHOLD  = 60;
            const WEAK_THRESHOLD   = 100;
            const STRONG_THRESHOLD = 200;
            const PLAYER_SPEED     = Config.PlayerSpd || 400;

            const sizeNorm  = Math.min(1, Math.max(0, (circle.rad - SMALL_THRESHOLD)  / (LARGE_THRESHOLD  - SMALL_THRESHOLD)));
            const powerNorm = Math.min(1, Math.max(0, (basePower  - WEAK_THRESHOLD)   / (STRONG_THRESHOLD - WEAK_THRESHOLD)));

            const SPEED_SMALL_WEAK      = PLAYER_SPEED * 1.2;
            const SPEED_SMALL_POWERFUL  = 1200;
            const SPEED_BIG_WEAK        = 120;
            const SPEED_BIG_POWERFUL    = 280;

            const topSpeed    = SPEED_SMALL_WEAK    + (SPEED_SMALL_POWERFUL - SPEED_SMALL_WEAK)    * powerNorm;
            const bottomSpeed = SPEED_BIG_WEAK      + (SPEED_BIG_POWERFUL   - SPEED_BIG_WEAK)      * powerNorm;
            let calculatedSpeed = topSpeed + (bottomSpeed - topSpeed) * sizeNorm;

            // Element speed modifiers
            const elementSpeedModifiers = {
                Air:   1.15,
                Fire:  1.05,
                Water: 1.0,
                Earth: 0.9
            };
            let elementMod = 1.0;
            if (stack.length > 0) {
                let totalMod = 0;
                for (let el of stack) {
                    totalMod += (elementSpeedModifiers[el] || 1.0);
                }
                elementMod = totalMod / stack.length;
                elementMod = 1 + (elementMod - 1) * (1 - sizeNorm * 0.7);
            }

            const finalSpeed = Math.round(calculatedSpeed * elementMod);
            const speed      = circle.virtual ? (PLAYER_SPEED * 1.0) : finalSpeed;

            // Physics type
            const isBigCircle = circle.rad >= LARGE_THRESHOLD;
            const isPiercing  = !isBigCircle && ['NEEDLE', 'LANCE', 'BEAM'].includes(spectrum);
            const physics     = isPiercing ? 'SHARP' : 'BLUNT';

            // Blunt speed modifier (heavier blunt spells are slower)
            let bluntSpeedModifier = 1.0;
            if (physics === 'BLUNT' && basePower > WEAK_THRESHOLD) {
                const powerFactor    = Math.min(1, (basePower - WEAK_THRESHOLD) / (STRONG_THRESHOLD - WEAK_THRESHOLD));
                bluntSpeedModifier   = 1.0 - (powerFactor * 0.5);
            }

            // Damage
            const damage = payloadLayers.length > 0 ? 10 : baseDmg * (spectrumConfig.damage || 1);

            // Recoil — 3D: mutate body.vx/vz instead of calling setVelocity
            const recoilAmount = spectrumConfig.knockback || 0;
            if (recoilAmount > 0 && !circle.virtual) {
                this.player.body.vx -= Math.cos(angle) * recoilAmount * 6;
                this.player.body.vz -= Math.sin(angle) * recoilAmount * 6;
                totalRecoil += recoilAmount;
            }

            // Direction with rune offset + instability spread
            const spread     = instab * (Config.Instability.spreadMax || 0.52);
            const finalAngle = angle + this.runeOffset(circle.runes) + (Math.random() - 0.5) * 2 * spread;

            // Projectile radius
            let projRadius;
            if (isPiercing) {
                projRadius = Math.max(5, 8 * (spectrumConfig.visualScale || 1));
            } else {
                projRadius = Math.max(10, (circle.rad / 2) * (spectrumConfig.visualScale || 1));
            }

            // Spawn position — stagger along heading to avoid coincident bodies
            // (this.player.body.radius replaces the 2D this.player.rad)
            const spawnOffset = Math.max(Config.ProjectileSpawnOffset || 30, this.player.body.radius + projRadius + 8)
                + circleIndex * (projRadius + 8);
            const dirX       = Math.cos(finalAngle);
            const dirY       = Math.sin(finalAngle);
            const perpNudge  = (circleIndex % 2 === 0 ? 1 : -1) * Math.ceil(circleIndex / 2) * 6;
            // player.y returns the Z coordinate (via the y→z alias on Player3D)
            const sx = this.player.x + dirX * spawnOffset - dirY * perpNudge;
            const sy = this.player.y + dirY * spawnOffset + dirX * perpNudge; // sy = world Z

            // Payload chain
            const payload = this.buildPayloadChain(payloadLayers, stack, baseDmg, basePower);

            // Spawn — Projectile3D(scene, x2d, y2d, data); y2d maps to 3D Z
            new Projectile3D(this, sx, sy, {
                elements:  stack,
                spectrum:  spectrum,
                physics:   physics,
                damage:    damage,
                pierce:    spectrumConfig.pierce || 0,
                radius:    projRadius,
                vel:       { x: dirX * speed * bluntSpeedModifier, y: dirY * speed * bluntSpeedModifier },
                power:     basePower,
                caster:    this.player,
                payload:   payload
            });

            // Stamina cost
            this.player.stm = Math.max(0, this.player.stm - (3 + powerMult));
        });

        // === VISUAL FEEDBACK ===
        const shakeIntensity = Math.min(0.01, 0.002 + totalRecoil * 0.002 + powerMult * 0.001);
        this.cameras.main.shake(80, shakeIntensity);

        // Muzzle flash particles — player.y returns Z alias (works unchanged)
        const flashColor   = stack.length > 0 ? this.getElementColor(stack[stack.length - 1]) : 0xffaa00;
        const particleCount = Math.min(20, 6 + stack.length * 2 + Math.floor(powerMult));
        this.spawnParticles(
            this.player.x + Math.cos(angle) * 30,
            this.player.y + Math.sin(angle) * 30,
            flashColor, particleCount
        );

        // Screen flash for powerful spells
        if (powerMult >= 5 || stack.length >= 3) {
            this.cameras.main.flash(100, 255, 255, 255, false, (cam, progress) => {
                // Subtle fade — no extra action needed
            });
        }
    }

    // =========================================================================
    // buildPayloadChain — verbatim from 2D GameScene
    // =========================================================================

    buildPayloadChain(remainingLayers, elements, totalDamage, parentPower) {
        if (remainingLayers.length === 0) return [];

        const currentLayer = remainingLayers[0];
        const nextLayers   = remainingLayers.slice(1);
        const splitCount   = currentLayer.length;
        const damagePerShard = totalDamage / splitCount;
        const powerPerShard  = Math.max(parentPower / splitCount, (Config.BasePower || 50) / 2);

        let payload = [];

        currentLayer.forEach(circle => {
            payload.push({
                relAngle:       this.runeOffset(circle.runes),
                circleRadius:   circle.rad,
                baseDamage:     damagePerShard,
                inheritedPower: powerPerShard,
                hasMorePayloads: nextLayers.length > 0,
                nestedPayload:  this.buildPayloadChain(nextLayers, elements, damagePerShard, powerPerShard)
            });
        });

        return payload;
    }

    // =========================================================================
    // castBaseMagic — verbatim from 2D except new ProjectileSprite → Projectile3D
    // =========================================================================

    castBaseMagic() {
        const angle       = this.player.aimAngle;
        const speed       = Config.BaseMagic?.speed  || 400;
        const spawnOffset = Config.ProjectileSpawnOffset || 30;

        // player.y returns Z — so spawn coords are correct in 3D
        new Projectile3D(this,
            this.player.x + Math.cos(angle) * spawnOffset,
            this.player.y + Math.sin(angle) * spawnOffset,
            {
                elements:  [],
                spectrum:  'DART',
                physics:   'BLUNT',
                damage:    Config.BaseMagic?.damage || 5,
                radius:    Config.BaseMagic?.radius || 8,
                vel:       { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
                power:     Config.BaseMagic?.power  || 20,
                caster:    this.player,
                payload:   null
            }
        );

        this.player.stm = Math.max(0, this.player.stm - 2);

        // Gray particles for base magic
        this.spawnParticles(
            this.player.x + Math.cos(angle) * spawnOffset,
            this.player.y + Math.sin(angle) * spawnOffset,
            0x888888, 5
        );
    }

    // =========================================================================
    // remoteTrigger — verbatim from 2D GameScene
    // =========================================================================

    remoteTrigger() {
        // Snapshot: activate() spawns new projectiles (and kills the parent),
        // both of which mutate GameState.projectiles.  Only the projectiles that
        // existed at click time should be triggered this round.
        for (let proj of [...GameState.projectiles]) {
            if (!proj || proj.isDead || !proj.activate) continue;
            try {
                proj.activate();
            } catch (err) {
                console.warn('Projectile activation failed:', err);
            }
        }
    }

    // =========================================================================
    // runeOffset — verbatim from 2D GameScene
    // =========================================================================

    runeOffset(runes) {
        if (!runes || runes.length === 0) return 0;
        const sum = runes.reduce((acc, a) => acc + a, 0);
        return sum / runes.length;
    }

    // =========================================================================
    // getElement — verbatim from 2D GameScene
    // =========================================================================

    getElement(nodeCount) {
        if (nodeCount === 3) return 'Air';
        if (nodeCount === 4) return 'Fire';
        if (nodeCount === 5) return 'Earth';
        if (nodeCount === 6) return 'Water';
        return 'Fire';
    }

    // =========================================================================
    // getElementColor — verbatim from 2D GameScene
    // =========================================================================

    getElementColor(element) {
        const colors = {
            Air:   0xA0E0E0,
            Fire:  0xFF6633,
            Earth: 0x80C060,
            Water: 0x4488FF
        };
        return colors[element] || 0xffffff;
    }

    // =========================================================================
    // getSpellSpectrum — verbatim from 2D GameScene
    // =========================================================================

    getSpellSpectrum(power, radius) {
        const ratio = power / Math.max(1, radius);

        if (ratio > 5)    return 'NEEDLE';
        if (ratio > 3)    return 'LANCE';
        if (ratio > 2)    return 'BEAM';
        if (ratio > 1.2)  return 'DART';
        if (ratio > 0.8)  return 'WAVE';
        if (ratio > 0.5)  return 'BURST';
        if (ratio > 0.3)  return 'BOULDER';
        if (ratio > 0.15) return 'CANNON';
        if (ratio > 0.05) return 'NOVA';
        return 'FLICKER';
    }

    // =========================================================================
    // spawnParticles3D — NEW 3D variant (delegates to Effects3D.burst)
    // =========================================================================

    /**
     * Emit burst particles via the 3D effects system.
     * @param {number} x     World X
     * @param {number} z     World Z
     * @param {number} color Hex colour integer
     * @param {number} [count=6]
     */
    spawnParticles3D(x, z, color, count) {
        if (this.effects) {
            this.effects.burst(x, z, color, count || 6);
        }
    }

    /**
     * 2D-compatible alias: `y` here is the Z coordinate per the 2D→3D mapping.
     * Any ported code that calls this.spawnParticles(x, y, color, count) works
     * unchanged because the second argument is already the world-Z value.
     */
    spawnParticles(x, y, color, count) {
        this.spawnParticles3D(x, y, color, count);
    }

    // =========================================================================
    // resolveProjectilePvP — ported from 2D, uses body.x / body.z / body.radius
    // =========================================================================

    resolveProjectilePvP() {
        // Snapshot — die() splices GameState.projectiles, so iterate a stable
        // copy and re-check isDead each step.
        const list     = [...GameState.projectiles];
        const pvpRatio = Config.PvPPowerRatio || 1.5;

        for (let i = 0; i < list.length; i++) {
            const a = list[i];
            if (!a || a.isDead || !a.body) continue;
            if (!Number.isFinite(a.body.x) || !Number.isFinite(a.body.z)) continue;

            for (let j = i + 1; j < list.length; j++) {
                if (a.isDead) break; // a was killed earlier this pass

                const b = list[j];
                if (!b || b.isDead || b === a) continue;
                if (a.caster === b.caster)    continue;
                if (!b.body) continue;
                if (!Number.isFinite(b.body.x) || !Number.isFinite(b.body.z)) continue;

                const ra   = a.body.radius;
                const rb   = b.body.radius;
                const dist = Math.hypot(a.body.x - b.body.x, a.body.z - b.body.z);
                if (dist >= ra + rb) continue;

                const mx = (a.body.x + b.body.x) / 2;
                const mz = (a.body.z + b.body.z) / 2;

                if (a.power > b.power * pvpRatio) {
                    b.die();
                    a.power -= b.power * 0.5;
                    this.spawnParticles3D(mx, mz, 0xffffff, 8);
                } else if (b.power > a.power * pvpRatio) {
                    a.die();
                    b.power -= a.power * 0.5;
                    this.spawnParticles3D(mx, mz, 0xffffff, 8);
                } else {
                    this.spawnParticles3D(mx, mz, 0xffffff, 12);
                    a.die();
                    b.die();
                }
            }
        }
    }

    // =========================================================================
    // spawnInitialEnemies — ported from 2D; new EnemySprite → new Enemy3D
    // =========================================================================

    spawnInitialEnemies() {
        const enemyCount = Config.MapSpawn.initialEnemies || 5;

        for (let i = 0; i < enemyCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist  = 300 + Math.random() * 400;
            const x     = Math.cos(angle) * dist;
            const y     = Math.sin(angle) * dist; // y here = world Z coordinate

            // Enemy3D(scene, x, z) — second arg is Z
            const enemy = new Enemy3D(this, x, y);
            this.enemies.push(enemy);
            GameState.enemies.push(enemy);
        }
    }

    // =========================================================================
    // createHUD — verbatim from 2D GameScene (Phaser 2D overlay over 3D)
    // =========================================================================

    createHUD() {
        // HUD container (fixed to camera)
        this.hud = this.add.container(0, 0).setScrollFactor(0).setDepth(1000);

        // HP Bar background
        const hpBg = this.add.rectangle(120, 30, 200, 20, 0x333333);
        hpBg.setStrokeStyle(2, 0x666666);

        // HP Bar fill
        this.hpBar = this.add.rectangle(21, 30, 198, 18, 0x22aa22);
        this.hpBar.setOrigin(0, 0.5);

        // HP Label
        const hpLabel = this.add.text(120, 30, 'LIFE', {
            fontFamily: 'Arial',
            fontSize:   '12px',
            color:      '#ffffff'
        }).setOrigin(0.5);

        // Stamina Bar
        const stmBg = this.add.rectangle(120, 55, 200, 12, 0x333333);
        stmBg.setStrokeStyle(1, 0x666666);

        this.stmBar = this.add.rectangle(21, 55, 198, 10, 0x2288aa);
        this.stmBar.setOrigin(0, 0.5);

        const stmLabel = this.add.text(120, 55, 'VIGOR', {
            fontFamily: 'Arial',
            fontSize:   '10px',
            color:      '#ffffff'
        }).setOrigin(0.5);

        // Mana bars
        const manaColors = {
            Air:   0xA0E0E0,
            Fire:  0xE06060,
            Earth: 0x80C060,
            Water: 0x4080E0
        };

        this.manaBars = {};
        let manaY = 85;
        for (let [element, color] of Object.entries(manaColors)) {
            const bg   = this.add.rectangle(80, manaY, 120, 8, 0x333333);
            const fill = this.add.rectangle(21, manaY, 118, 6, color);
            fill.setOrigin(0, 0.5);

            const label = this.add.text(15, manaY, element[0], {
                fontFamily: 'Arial',
                fontSize:   '10px',
                color:      '#' + color.toString(16).padStart(6, '0')
            }).setOrigin(0.5);

            this.manaBars[element] = fill;
            this.hud.add([bg, fill, label]);
            manaY += 15;
        }

        this.hud.add([hpBg, this.hpBar, hpLabel, stmBg, this.stmBar, stmLabel]);

        // Debug info (under mana bars)
        this.debugText = this.add.text(10, 160, '', {
            fontFamily: 'monospace',
            fontSize:   '11px',
            color:      '#88aa88'
        }).setScrollFactor(0).setDepth(1000);

        // On mobile, shift the HUD below the top hotbar and scale it down
        if (GameState.isMobile) {
            this.hud.setPosition(4, 52).setScale(0.82);
            this.debugText.setVisible(false);
        }
    }

    // =========================================================================
    // updateHUD — verbatim from 2D GameScene
    // =========================================================================

    updateHUD() {
        if (!this.player) return;

        // HP bar
        const hpPct = Math.max(0, this.player.hp / this.player.maxHp);
        this.hpBar.scaleX = hpPct;

        // Stamina bar
        const stmPct = Math.max(0, this.player.stm / this.player.maxStm);
        this.stmBar.scaleX = stmPct;

        // Mana bars
        for (let [element, bar] of Object.entries(this.manaBars)) {
            const manaPct = Math.max(0, this.player.mana[element] / 100);
            bar.scaleX = manaPct;
        }

        // Update inventory cast indicators (GREEN/RED/YELLOW)
        this.updateInventoryUI();
    }

    // =========================================================================
    // updateDebug — verbatim from 2D GameScene
    // =========================================================================

    updateDebug() {
        if (!this.player || !this.debugText) return;

        // Use player.y (= player.z alias) so this is identical to the 2D call
        const chunkX = Math.floor(this.player.x    / Config.Chunks.size);
        const chunkY = Math.floor(this.player.y    / Config.Chunks.size);
        const biome  = this.chunkManager.getBiomeAt(chunkX, chunkY);

        const chunk   = this.chunkManager.getChunk(chunkX, chunkY);
        const preset  = chunk?.preset        || 'random';
        const hasPath = chunk?.hasPath       ? 'Yes' : 'No';
        const pathDir = chunk?.pathDirection || '-';

        this.debugText.setText([
            `Seed: ${this.worldSeed || 'N/A'}`,
            `Pos: ${Math.round(this.player.x)}, ${Math.round(this.player.y)}`,
            `Chunk: ${chunkX}, ${chunkY}`,
            `Biome: ${biome}`,
            `Preset: ${preset}`,
            `Path: ${hasPath} (${pathDir})`,
            `Chunks: ${this.chunkManager.chunks.size}`,
            `Enemies: ${this.enemies.length}`,
            `Projectiles: ${GameState.projectiles.length}`
        ].join('\n'));
    }

    // =========================================================================
    // setupInventoryUI — verbatim from 2D GameScene
    // =========================================================================

    setupInventoryUI() {
        // Show inventory bar when entering the game
        const inventoryBar = document.getElementById('inventory-bar');
        if (inventoryBar) {
            inventoryBar.style.display = 'flex';
            if (GameState.isMobile) inventoryBar.classList.add('mobile');
        }

        // Slot click handlers
        const slots = document.querySelectorAll('.inv-slot');
        slots.forEach((slot, index) => {
            slot.addEventListener('click', () => {
                this.inventorySystem.selectSlot(index);
                this.updateInventoryUI();
            });
        });

        // Listen for slot changes from InventorySystem
        this.events.on('inventory-slot-changed', () => {
            this.updateInventoryUI();
        });

        // Keyboard 1-8 for slot selection
        this.input.keyboard.on('keydown', (event) => {
            if (event.code.startsWith('Digit')) {
                const num = parseInt(event.code.replace('Digit', ''));
                if (num >= 1 && num <= 8) {
                    this.inventorySystem.selectSlot(num - 1);
                    this.updateInventoryUI();
                }
            }
            if (event.code.startsWith('Numpad')) {
                const num = parseInt(event.code.replace('Numpad', ''));
                if (num >= 1 && num <= 8) {
                    this.inventorySystem.selectSlot(num - 1);
                    this.updateInventoryUI();
                }
            }
        });

        // Initial UI sync
        this.updateInventoryUI();
    }

    // =========================================================================
    // updateInventoryUI — verbatim from 2D GameScene
    // =========================================================================

    updateInventoryUI() {
        const slots    = document.querySelectorAll('.inv-slot');
        const statuses = this.inventorySystem.getAllCastStatuses(this.player?.mana);

        slots.forEach((slot, index) => {
            if (index === this.inventorySystem.selectedSlot) {
                slot.classList.add('active');
            } else {
                slot.classList.remove('active');
            }

            const indicator = slot.querySelector('.cast-indicator');
            if (indicator) {
                indicator.className = 'cast-indicator ' + statuses[index];
            }
        });
    }

    // =========================================================================
    // updateCamera — isometric top-down rig that follows the player
    // =========================================================================

    updateCamera(dt) {
        if (!this.player) return;

        // Clamp t so the very first call (dt=1 from init) doesn't overshoot
        const t = Math.min(1, 1 - Math.exp(-8 * dt));

        // Smooth-follow player XZ position
        this.camTarget.x += (this.player.x - this.camTarget.x) * t;
        this.camTarget.z += (this.player.z - this.camTarget.z) * t;

        const k   = 1 / this.camZoom;
        const cam = this.third.camera;

        // Isometric-style: elevated behind the player (in +Z direction)
        cam.position.set(
            this.camTarget.x,
            600 * k,
            this.camTarget.z + 350 * k
        );
        cam.lookAt(this.camTarget.x, 20, this.camTarget.z);

        // Move sun with camera so shadows are consistent
        if (this.sun) {
            this.sun.position.set(
                this.camTarget.x + 300,
                700,
                this.camTarget.z - 200
            );
            if (this.sun.target) {
                this.sun.target.position.set(this.camTarget.x, 0, this.camTarget.z);
                this.sun.target.updateMatrixWorld();
            }
        }
    }

    // =========================================================================
    // updateFog — smoothly lerp fog / background colour to the current biome
    // =========================================================================

    updateFog(dt) {
        if (!this.player || !this.chunkManager) return;

        const pcx   = Math.floor(this.player.x / Config.Chunks.size);
        const pcz   = Math.floor(this.player.z / Config.Chunks.size);
        const biome = this.chunkManager.getBiomeAt(pcx, pcz);

        const target = Biome3D.getFogColor(biome);
        const t      = 1 - Math.exp(-2 * dt);

        // _fogColor is shared by both scene.fog.color and scene.background,
        // so a single lerp updates both simultaneously.
        this._fogColor.lerp(target, t);
    }

    // =========================================================================
    // update — main game loop
    // =========================================================================

    update(time, delta) {
        // The entire frame is wrapped: an uncaught error here would stop the
        // Phaser loop and freeze the game.  Catching it lets the game drop a
        // bad frame and keep running.
        try {
            // Scaled-delta for simulation (respects timeScale when MagicEditor
            // is in slow-mo; clamped to 1/30 to prevent spiral of death)
            const dt  = Math.min((delta || 16) / 1000, 1 / 30);
            const ts  = GameState.timeScale || 1;
            const sdt = dt * ts; // simulation dt (may be slowed)

            // ---- Player ----
            if (this.player) {
                this.player.update(sdt, this.input.activePointer);
            }

            // ---- Enemies ----
            for (const e of this.enemies) {
                if (e && this.player) {
                    e.update(sdt, { x: this.player.x, z: this.player.z });
                }
            }

            // ---- Projectiles (snapshot — die() mutates GameState.projectiles) ----
            for (const p of [...GameState.projectiles]) {
                if (!p || p.isDead || !p.update) continue;
                try {
                    p.update(sdt);
                } catch (projErr) {
                    console.warn('proj update failed', projErr);
                    if (p.die) p.die();
                }
            }

            // ---- Physics step ----
            this.world.step(sdt);

            // ---- Visual sync: player ----
            if (this.player) {
                this.player.syncVisual(sdt);
            }

            // ---- Visual sync: enemies + billboard HP bars ----
            for (const e of this.enemies) {
                if (e && e.syncVisual) {
                    e.syncVisual();
                    // Keep HP bar quads facing the camera (billboard)
                    if (e.group && e.group.userData.hpBar &&
                        e.group.userData.hpBar.visible) {
                        e.group.userData.hpBar.quaternion.copy(
                            this.third.camera.quaternion
                        );
                    }
                }
            }
            // Note: Projectile3D.update() already calls syncVisual() internally.

            // ---- Sync moveable world objects (barrels, crates, etc.) ----
            if (this.chunkManager.syncMovedObjects) {
                this.chunkManager.syncMovedObjects();
            }

            // ---- PvP projectile clash resolution ----
            this.resolveProjectilePvP();

            // ---- Chunk streaming ----
            if (this.player) {
                this.chunkManager.update(this.player.x, this.player.z);
            }

            // ---- Camera (real dt — not slowed by timeScale) ----
            this.updateCamera(dt);

            // ---- Fog (real dt) ----
            this.updateFog(dt);

            // ---- Particle effects ----
            if (this.effects) {
                this.effects.update(sdt);
            }

            // ---- HUD (2D overlay) ----
            this.updateHUD();

            // ---- Debug readout ----
            this.updateDebug();

            // ---- Minimap (player.y returns z — compatible with 2D call) ----
            if (this.minimap && this.player) {
                this.minimap.update(this.player.x, this.player.y, this.chunkManager);
            }

        } catch (err) {
            console.error('GameScene3D.update recovered from a fatal frame error:', err);
        }
    }
}

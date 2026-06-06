/**
 * GameScene - Main gameplay scene
 */
class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    init(data) {
        // Receive seed from MenuScene
        this.worldSeed = data?.seed || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        GameState.lastSeed = this.worldSeed; // remembered so the menu can "Restart Run"
        console.log('World Seed:', this.worldSeed);
    }

    create() {
        // Seed the random number generator for consistent world generation
        Phaser.Math.RND.sow([this.worldSeed]);

        // World bounds (infinite, but we set a large area)
        this.matter.world.setBounds(-100000, -100000, 200000, 200000);

        // Initialize PathwayRenderer FIRST (before ChunkManager)
        // This ensures path data exists when chunks are loaded
        this.pathwayRenderer = new PathwayRenderer(this);
        this.pathwayRenderer.init(this.worldSeed);
        this.pathwayRenderer.generate(); // Generate path network BEFORE chunks

        // Initialize ChunkManager (will use pathwayRenderer for smart presets)
        this.chunkManager = new ChunkManagerPhaser(this);
        this.chunkManager.seed = this.worldSeed;
        this.chunkManager.init();

        // Initialize Inventory System
        this.inventorySystem = new InventorySystem(this);
        this.inventorySystem.init(Config);
        GameState.inventorySystem = this.inventorySystem;

        // Arrays for entities
        this.enemies = [];
        this.projectiles = [];

        // Create player
        this.player = new PlayerSprite(this, 0, 0);

        // Spawn initial enemies
        this.spawnInitialEnemies();

        // Camera setup
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        this.cameras.main.setZoom(1);

        // HUD
        this.createHUD();

        // Minimap
        if (typeof MinimapSystem !== 'undefined') {
            this.minimap = new MinimapSystem(this);
            this.minimap.create();
        }

        // Input handlers
        this.setupInput();

        // Collision handlers
        this.setupCollisions();

        // Events — guard so a throw inside the cast path can't freeze the game loop
        this.events.on('cast-spell', () => {
            try { this.castSpell(); }
            catch (err) { console.error('cast-spell event recovered from error:', err); }
        });

        // Inventory slot click handlers (DOM)
        this.setupInventoryUI();

        // Touch controls (mobile only)
        if (GameState.isMobile && typeof TouchControls !== 'undefined') {
            this.touchControls = new TouchControls(this);
        }

        // Reflow size-dependent UI when the viewport changes (rotate / resize).
        // The main camera auto-resizes in RESIZE mode; we just re-anchor the HUD
        // and minimap so nothing drifts off-screen.
        this.scale.on('resize', this.onResize, this);
        this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));

        // Fade in
        this.cameras.main.fadeIn(500);

        console.log('GameScene created with seed:', this.worldSeed);
    }

    onResize(gameSize) {
        const w = gameSize ? gameSize.width : this.cameras.main.width;
        const h = gameSize ? gameSize.height : this.cameras.main.height;
        if (this.minimap && this.minimap.resize) {
            try { this.minimap.resize(w, h); } catch (e) { /* ignore */ }
        }
        // HUD is anchored top-left (scrollFactor 0); keep its mobile offset/scale.
        if (this.hud) {
            if (GameState.isMobile) this.hud.setPosition(4, 52).setScale(0.82);
            else this.hud.setPosition(0, 0).setScale(1);
        }
    }

    setupInventoryUI() {
        // Show inventory bar when entering game
        const inventoryBar = document.getElementById('inventory-bar');
        if (inventoryBar) {
            inventoryBar.style.display = 'flex';
            // On touch devices pin the hotbar to the top strip (clear of the
            // bottom-corner sticks) and make it compact + horizontally scrollable.
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
            // Keys 1-8 (Digit1-Digit8)
            if (event.code.startsWith('Digit')) {
                const num = parseInt(event.code.replace('Digit', ''));
                if (num >= 1 && num <= 8) {
                    this.inventorySystem.selectSlot(num - 1);
                    this.updateInventoryUI();
                }
            }
            // Numpad 1-8
            if (event.code.startsWith('Numpad')) {
                const num = parseInt(event.code.replace('Numpad', ''));
                if (num >= 1 && num <= 8) {
                    this.inventorySystem.selectSlot(num - 1);
                    this.updateInventoryUI();
                }
            }
        });

        // Initial UI update
        this.updateInventoryUI();
    }

    updateInventoryUI() {
        const slots = document.querySelectorAll('.inv-slot');
        const statuses = this.inventorySystem.getAllCastStatuses(this.player?.mana);

        slots.forEach((slot, index) => {
            // Active state
            if (index === this.inventorySystem.selectedSlot) {
                slot.classList.add('active');
            } else {
                slot.classList.remove('active');
            }

            // Cast indicator
            const indicator = slot.querySelector('.cast-indicator');
            if (indicator) {
                indicator.className = 'cast-indicator ' + statuses[index];
            }
        });
    }

    spawnInitialEnemies() {
        const enemyCount = Config.MapSpawn.initialEnemies || 5;

        for (let i = 0; i < enemyCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 300 + Math.random() * 400;
            const x = Math.cos(angle) * dist;
            const y = Math.sin(angle) * dist;

            const enemy = new EnemySprite(this, x, y);
            this.enemies.push(enemy);
            GameState.enemies.push(enemy);
        }
    }

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
            fontSize: '12px',
            color: '#ffffff'
        }).setOrigin(0.5);

        // Stamina Bar
        const stmBg = this.add.rectangle(120, 55, 200, 12, 0x333333);
        stmBg.setStrokeStyle(1, 0x666666);

        this.stmBar = this.add.rectangle(21, 55, 198, 10, 0x2288aa);
        this.stmBar.setOrigin(0, 0.5);

        const stmLabel = this.add.text(120, 55, 'VIGOR', {
            fontFamily: 'Arial',
            fontSize: '10px',
            color: '#ffffff'
        }).setOrigin(0.5);

        // Mana bars
        const manaColors = {
            Air: 0xA0E0E0,
            Fire: 0xE06060,
            Earth: 0x80C060,
            Water: 0x4080E0
        };

        this.manaBars = {};
        let manaY = 85;
        for (let [element, color] of Object.entries(manaColors)) {
            const bg = this.add.rectangle(80, manaY, 120, 8, 0x333333);
            const fill = this.add.rectangle(21, manaY, 118, 6, color);
            fill.setOrigin(0, 0.5);

            const label = this.add.text(15, manaY, element[0], {
                fontFamily: 'Arial',
                fontSize: '10px',
                color: '#' + color.toString(16).padStart(6, '0')
            }).setOrigin(0.5);

            this.manaBars[element] = fill;
            this.hud.add([bg, fill, label]);
            manaY += 15;
        }

        this.hud.add([hpBg, this.hpBar, hpLabel, stmBg, this.stmBar, stmLabel]);

        // Debug info (under mana bars)
        this.debugText = this.add.text(10, 160, '', {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#88aa88'
        }).setScrollFactor(0).setDepth(1000);

        // On mobile the slot hotbar pins to the top strip — drop the HUD below it,
        // shrink it, and hide the debug readout so nothing overlaps.
        if (GameState.isMobile) {
            this.hud.setPosition(4, 52).setScale(0.82);
            this.debugText.setVisible(false);
        }
    }

    setupInput() {
        // Disable right-click context menu
        this.input.mouse.disableContextMenu();

        // On touch devices every tap reports as a left-button press, so casting
        // is driven ONLY by the on-screen CAST/TRIGGER buttons (TouchControls).
        // The mouse handlers below are desktop-only.
        if (GameState.isMobile) return;

        // Left click to cast
        this.input.on('pointerdown', (pointer) => {
            try {
                if (pointer.leftButtonDown() && !GameState.isMagicOpen) {
                    this.castSpell();
                }
            } catch (err) {
                console.error('Cast input recovered from error:', err);
            }
        });

        // Right click for remote trigger
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

    setupCollisions() {
        // Projectile vs Enemy and Object collisions
        this.matter.world.on('collisionstart', (event) => {
          try {
            for (let pair of event.pairs) {
                const { bodyA, bodyB } = pair;

                // Check projectile vs enemy
                if (bodyA.label === 'projectile' && bodyB.label === 'enemy') {
                    this.handleProjectileHit(bodyA.gameObject, bodyB.gameObject);
                } else if (bodyA.label === 'enemy' && bodyB.label === 'projectile') {
                    this.handleProjectileHit(bodyB.gameObject, bodyA.gameObject);
                }

                // Check projectile vs player (self-damage)
                if (bodyA.label === 'projectile' && bodyB.label === 'player') {
                    this.handleProjectilePlayerHit(bodyA.gameObject, bodyB.gameObject);
                } else if (bodyA.label === 'player' && bodyB.label === 'projectile') {
                    this.handleProjectilePlayerHit(bodyB.gameObject, bodyA.gameObject);
                }

                // Check projectile vs world object
                const objectTypes = ['Tree', 'Wall', 'Cliff', 'Rock', 'Crate', 'Barrel', 'Bush', 'Boulder', 'Pillar'];
                const isProjectileA = bodyA.label === 'projectile';
                const isProjectileB = bodyB.label === 'projectile';
                const isObjectA = objectTypes.includes(bodyA.label);
                const isObjectB = objectTypes.includes(bodyB.label);

                if (isProjectileA && isObjectB) {
                    this.handleProjectileObjectHit(bodyA.gameObject, bodyB);
                } else if (isProjectileB && isObjectA) {
                    this.handleProjectileObjectHit(bodyB.gameObject, bodyA);
                }

                // Player vs Enemy
                if ((bodyA.label === 'player' && bodyB.label === 'enemy') ||
                    (bodyA.label === 'enemy' && bodyB.label === 'player')) {
                    const player = bodyA.label === 'player' ? bodyA.gameObject : bodyB.gameObject;
                    const enemy = bodyA.label === 'enemy' ? bodyA.gameObject : bodyB.gameObject;
                    this.handlePlayerEnemyCollision(player, enemy);
                }
            }
          } catch (err) {
            // A collision callback runs inside the physics step; an uncaught
            // error here would freeze the game. Recover and keep simulating.
            console.error('Collision handler recovered from error:', err);
          }
        });
    }

    handleProjectileHit(projectile, enemy) {
        if (projectile && !projectile.isDead && enemy && projectile.onHitEnemy) {
            projectile.onHitEnemy(enemy);
        }
    }

    handleProjectileObjectHit(projectile, objectBody) {
        if (!projectile || projectile.isDead || !projectile.onHitObject) return;

        // Find the world object associated with this physics body
        // The object could be stored as gameObject or we need to search chunks
        let worldObj = objectBody.gameObject;

        if (!worldObj) {
            // Search through chunks for the object with this body
            for (let [key, chunk] of this.chunkManager.chunks) {
                for (let obj of chunk.objects) {
                    if (obj.body === objectBody || (obj.body && obj.body.id === objectBody.id)) {
                        worldObj = obj;
                        break;
                    }
                }
                if (worldObj) break;
            }
        }

        if (worldObj) {
            projectile.onHitObject(worldObj);
        } else {
            // Object not found, just kill projectile if not overwhelm
            if (projectile.power <= Config.OverwhelmThreshold) {
                projectile.die();
            }
        }
    }

    handleProjectilePlayerHit(projectile, player) {
        if (!projectile || projectile.isDead || !player) return;

        // Don't hit player if:
        // 1. Player is dashing (invincible)
        // 2. Projectile just spawned (activation delay not passed)
        // 3. Projectile is from this player and hasn't traveled far enough
        if (player.isDashing) return;
        if (projectile.activationDelay > 0) return;

        // Must have traveled at least 50 pixels to hit self
        if (projectile.caster === player && projectile.distanceTraveled < 50) return;

        // Apply damage - full damage, same as enemies
        const damage = projectile.damage;
        player.takeDamage(damage);

        // Apply knockback
        if (projectile.body && projectile.body.velocity) {
            const vel = projectile.body.velocity;
            const mag = Math.sqrt(vel.x * vel.x + vel.y * vel.y) || 1;
            const knockback = projectile.power * 0.1;
            player.setVelocity(
                player.body.velocity.x + (vel.x / mag) * knockback,
                player.body.velocity.y + (vel.y / mag) * knockback
            );
        }

        // Visual feedback
        this.spawnParticles(player.x, player.y, projectile.mainColor || 0xff0000, 8);
        this.cameras.main.shake(80, 0.008);

        // Kill projectile (unless it can pierce)
        if (projectile.pierceRemaining > 0) {
            projectile.pierceRemaining--;
        } else {
            projectile.die();
        }
    }

    handlePlayerEnemyCollision(player, enemy) {
        if (player && !player.isDashing) {
            player.takeDamage(10);
        }
    }

    openMagicEditor() {
        GameState.isMagicOpen = true;
        GameState.timeScale = 0.1; // Slow motion

        this.scene.pause();
        this.scene.launch('MagicEditorScene');
    }

    castSpell() {
        // === ELEMENTAL LOGIC (SHAPES = FUEL) ===
        let stack = [];
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
        // Power is now per-layer (node spread). The thrown spell's power comes from
        // the container layer (layer 0); fall back to the legacy global value.
        const powerMult = (GameState.magic.layers[0] && GameState.magic.layers[0].power)
            || GameState.magic.powerMultiplier || 1;
        const manaCostMult = 1 + (powerMult - 1) * 0.2;

        // Aggregate costs per element first, then deduct in one pass to avoid
        // partial deductions when the player can only afford some shapes.
        const costByElement = {};
        allShapes.forEach(shape => {
            const el = shape.element;
            const cost = Math.ceil((Config.ManaCost[el] || 15) * manaCostMult);
            costByElement[el] = (costByElement[el] || 0) + cost;
        });

        // Stack Reduction Algorithm (predator logic) — only count affordable elements
        allShapes.forEach(shape => {
            const element = shape.element;
            const actualCost = Math.ceil((Config.ManaCost[element] || 15) * manaCostMult);

            if (this.player.mana[element] >= (costByElement[element] || 0)) {
                manaCost += actualCost;

                // Predator Logic: bottom beats top
                if (stack.length > 0) {
                    const top = stack[stack.length - 1];
                    const bottom = element;

                    let beats = false;
                    if (bottom === 'Water' && top === 'Fire') beats = true;
                    if (bottom === 'Fire' && top === 'Earth') beats = true;
                    if (bottom === 'Earth' && top === 'Air') beats = true;
                    if (bottom === 'Air' && top === 'Water') beats = true;

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
        const hasCircles = circleLayers.length > 0;
        const hasElements = stack.length > 0;
        const hadShapesButNoMana = allShapes.length > 0 && stack.length === 0;

        // Complete failure - fire Base Magic
        if (!hasCircles && !hasElements) {
            this.castBaseMagic();
            return;
        }

        // Had shapes but no mana - fire Base Magic
        if (hadShapesButNoMana) {
            this.castBaseMagic();
            return;
        }

        // Virtual circle fallback (elements but no circles)
        if (circleLayers.length === 0) {
            circleLayers.push([{
                center: { x: 0, y: 0 },
                rad: 30,
                runes: [],
                virtual: true
            }]);
        }

        // === EXECUTION ===
        const containerLayer = circleLayers[0]; // First layer = thrown circles
        const payloadLayers = circleLayers.slice(1); // Remaining = payloads

        // Calculate damage and power
        let baseDmg = stack.length > 0 ? stack.length * (Config.BaseDamagePerElement || 20) : 10;
        let basePower = ((Config.BasePower || 50) + (stack.length * 25)) * powerMult;

        // === INSTABILITY PENALTIES (4-quadrant symmetry) ===
        // Read the stability the editor stored (it's stopped by the time we cast),
        // and clamp defensively so a bad value can never poison the math below.
        let stability = (GameState.magic && Number.isFinite(GameState.magic.stability))
            ? GameState.magic.stability : 1;
        let instab = 1 - stability;
        if (!Number.isFinite(instab) || instab < 0) instab = 0;
        if (instab > 1) instab = 1;
        if (instab > 0) {
            const ins = Config.Instability;
            basePower *= (1 - instab * ins.powerMax);
            baseDmg   *= (1 - instab * ins.dmgMax);

            // Element mixing: randomly drop/swap an element proportional to instability
            if (stack.length > 0 && Math.random() < instab * ins.mixChance) {
                const elements = ['Air', 'Fire', 'Earth', 'Water'];
                const idx = Math.floor(Math.random() * stack.length);
                stack[idx] = elements[Math.floor(Math.random() * elements.length)];
            }
        }

        // Direction
        const angle = this.player.aimAngle;

        // Spawn projectile for each circle in container layer
        let totalRecoil = 0;
        containerLayer.forEach((circle, circleIndex) => {
            // Calculate spectrum
            const spectrum = this.getSpellSpectrum(basePower, circle.rad);
            const spectrumConfig = Config.SpellSpectrum.effects[spectrum] || {};

            // === SPEED CALCULATION BASED ON SIZE + POWER QUADRANT ===
            // Reference values:
            const SMALL_THRESHOLD = 30;   // Circle radius below this = "small"
            const LARGE_THRESHOLD = 60;   // Circle radius above this = "big"
            const WEAK_THRESHOLD = 100;   // Power below this = "weak" (accounts for basePower 50 + elements)
            const STRONG_THRESHOLD = 200; // Power above this = "powerful"
            const PLAYER_SPEED = Config.PlayerSpd || 400;

            // Normalize size and power to 0-1 range (with smooth interpolation)
            const sizeNorm = Math.min(1, Math.max(0, (circle.rad - SMALL_THRESHOLD) / (LARGE_THRESHOLD - SMALL_THRESHOLD)));
            const powerNorm = Math.min(1, Math.max(0, (basePower - WEAK_THRESHOLD) / (STRONG_THRESHOLD - WEAK_THRESHOLD)));

            // Define speed for each quadrant:
            // 1. SMALL + WEAK = 1.2x player speed (fast but harmless)
            // 2. SMALL + POWERFUL = Very fast (piercing needle)
            // 3. BIG + WEAK = VERY SLOW (easily stopped, floaty)
            // 4. BIG + POWERFUL = Slow but unstoppable (heavy boulder)

            const SPEED_SMALL_WEAK = PLAYER_SPEED * 1.2;      // ~480
            const SPEED_SMALL_POWERFUL = 1200;                 // Very fast needle
            const SPEED_BIG_WEAK = 120;                        // VERY slow floaty orb
            const SPEED_BIG_POWERFUL = 280;                    // Slow unstoppable boulder

            // Bilinear interpolation between the 4 quadrant speeds
            // Top-left: small+weak, Top-right: small+powerful
            // Bottom-left: big+weak, Bottom-right: big+powerful
            const topSpeed = SPEED_SMALL_WEAK + (SPEED_SMALL_POWERFUL - SPEED_SMALL_WEAK) * powerNorm;
            const bottomSpeed = SPEED_BIG_WEAK + (SPEED_BIG_POWERFUL - SPEED_BIG_WEAK) * powerNorm;
            let calculatedSpeed = topSpeed + (bottomSpeed - topSpeed) * sizeNorm;

            // Apply element modifiers (reduced effect for big spells)
            const elementSpeedModifiers = {
                Air: 1.15,    // Air makes spells faster
                Fire: 1.05,   // Fire is slightly fast
                Water: 1.0,   // Water is neutral
                Earth: 0.9    // Earth is slower
            };
            let elementMod = 1.0;
            if (stack.length > 0) {
                let totalMod = 0;
                for (let el of stack) {
                    totalMod += (elementSpeedModifiers[el] || 1.0);
                }
                elementMod = totalMod / stack.length;
                // Reduce element effect for big circles (big spells are dominated by mass, not element)
                elementMod = 1 + (elementMod - 1) * (1 - sizeNorm * 0.7);
            }

            // Final speed
            const finalSpeed = Math.round(calculatedSpeed * elementMod);

            // Virtual circles (no drawn circle) use modest speed
            const speed = circle.virtual ? (PLAYER_SPEED * 1.0) : finalSpeed;

            // === PHYSICS TYPE DETERMINATION ===
            // Big circles (radius >= LARGE_THRESHOLD) are ALWAYS BLUNT, regardless of power
            const isBigCircle = circle.rad >= LARGE_THRESHOLD;
            const isPiercing = !isBigCircle && ['NEEDLE', 'LANCE', 'BEAM'].includes(spectrum);
            const physics = isPiercing ? 'SHARP' : 'BLUNT';

            // For BLUNT spells: more power = SLOWER (inverse relationship)
            // High power blunt spells are heavy and slow
            let bluntSpeedModifier = 1.0;
            if (physics === 'BLUNT' && basePower > WEAK_THRESHOLD) {
                // Reduce speed by up to 50% for very powerful blunt spells
                const powerFactor = Math.min(1, (basePower - WEAK_THRESHOLD) / (STRONG_THRESHOLD - WEAK_THRESHOLD));
                bluntSpeedModifier = 1.0 - (powerFactor * 0.5); // 1.0 at 100 power, 0.5 at 200+ power
            }

            // Damage (reduced if has payloads)
            const damage = payloadLayers.length > 0 ? 10 : baseDmg * (spectrumConfig.damage || 1);

            // Recoil (accumulate for camera feedback)
            const recoilAmount = spectrumConfig.knockback || 0;
            if (recoilAmount > 0 && !circle.virtual) {
                this.player.setVelocity(
                    this.player.body.velocity.x - Math.cos(angle) * recoilAmount * 6,
                    this.player.body.velocity.y - Math.sin(angle) * recoilAmount * 6
                );
                totalRecoil += recoilAmount;
            }

            // Direction with averaged-rune offset + instability aim spread
            const spread = instab * (Config.Instability.spreadMax || 0.52);
            const finalAngle = angle + this.runeOffset(circle.runes) + (Math.random() - 0.5) * 2 * spread;

            // Projectile radius (larger for blunt, tiny for piercing)
            let projRadius;
            if (isPiercing) {
                // SHARP - tiny fast projectiles
                projRadius = Math.max(5, 8 * (spectrumConfig.visualScale || 1));
            } else {
                // BLUNT - radius scales with drawn circle
                // For a big circle (rad 150+), projectile should be ~60-80
                // For a medium circle (rad 60), projectile should be ~30
                // For a small circle (rad 30), projectile should be ~15
                projRadius = Math.max(10, (circle.rad / 2) * (spectrumConfig.visualScale || 1));
            }

            // Spawn position. Stagger multiple circles along/around the heading so
            // two projectiles from the same cast never spawn at the exact same point
            // (coincident Matter bodies can produce a NaN normal and freeze the sim).
            const spawnOffset = Math.max(Config.ProjectileSpawnOffset || 30, this.player.rad + projRadius + 8)
                + circleIndex * (projRadius + 8);
            const dirX = Math.cos(finalAngle);
            const dirY = Math.sin(finalAngle);
            const perpNudge = (circleIndex % 2 === 0 ? 1 : -1) * Math.ceil(circleIndex / 2) * 6;
            const sx = this.player.x + dirX * spawnOffset - dirY * perpNudge;
            const sy = this.player.y + dirY * spawnOffset + dirX * perpNudge;

            // Build payload chain
            const payload = this.buildPayloadChain(payloadLayers, stack, baseDmg, basePower);

            new ProjectileSprite(this,
                sx,
                sy,
                {
                    elements: stack,
                    spectrum: spectrum,
                    physics: physics,
                    damage: damage,
                    pierce: spectrumConfig.pierce || 0,
                    radius: projRadius,
                    vel: { x: dirX * speed * bluntSpeedModifier, y: dirY * speed * bluntSpeedModifier },
                    power: basePower,
                    caster: this.player,
                    payload: payload
                }
            );

            // Stamina cost based on power
            this.player.stm = Math.max(0, this.player.stm - (3 + powerMult));
        });

        // === VISUAL FEEDBACK ===
        // Camera shake based on power and recoil
        const shakeIntensity = Math.min(0.01, 0.002 + totalRecoil * 0.002 + powerMult * 0.001);
        this.cameras.main.shake(80, shakeIntensity);

        // Muzzle flash particles (more for higher power)
        const flashColor = stack.length > 0 ? this.getElementColor(stack[stack.length - 1]) : 0xffaa00;
        const particleCount = Math.min(20, 6 + stack.length * 2 + Math.floor(powerMult));
        this.spawnParticles(
            this.player.x + Math.cos(angle) * 30,
            this.player.y + Math.sin(angle) * 30,
            flashColor, particleCount
        );

        // Flash screen slightly for powerful spells
        if (powerMult >= 5 || stack.length >= 3) {
            this.cameras.main.flash(100, 255, 255, 255, false, (cam, progress) => {
                // Subtle flash that fades quickly
            });
        }
    }

    buildPayloadChain(remainingLayers, elements, totalDamage, parentPower) {
        if (remainingLayers.length === 0) return [];

        const currentLayer = remainingLayers[0];
        const nextLayers = remainingLayers.slice(1);
        const splitCount = currentLayer.length;
        const damagePerShard = totalDamage / splitCount;
        const powerPerShard = Math.max(parentPower / splitCount, (Config.BasePower || 50) / 2);

        let payload = [];

        currentLayer.forEach(circle => {
            payload.push({
                relAngle: this.runeOffset(circle.runes),
                circleRadius: circle.rad,
                baseDamage: damagePerShard,
                inheritedPower: powerPerShard,
                hasMorePayloads: nextLayers.length > 0,
                nestedPayload: this.buildPayloadChain(nextLayers, elements, damagePerShard, powerPerShard)
            });
        });

        return payload;
    }

    castBaseMagic() {
        const angle = this.player.aimAngle;
        const speed = Config.BaseMagic?.speed || 400;
        const spawnOffset = Config.ProjectileSpawnOffset || 30;

        new ProjectileSprite(this,
            this.player.x + Math.cos(angle) * spawnOffset,
            this.player.y + Math.sin(angle) * spawnOffset,
            {
                elements: [],
                spectrum: 'DART',
                physics: 'BLUNT',
                damage: Config.BaseMagic?.damage || 5,
                radius: Config.BaseMagic?.radius || 8,
                vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
                power: Config.BaseMagic?.power || 20,
                caster: this.player,
                payload: null
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

    remoteTrigger() {
        // Snapshot: activate() spawns new projectiles (and kills the parent),
        // both of which mutate GameState.projectiles. Only the projectiles that
        // existed at click time should be triggered this round. Each activation
        // is isolated so one bad payload can't abort the rest or freeze the game.
        for (let proj of [...GameState.projectiles]) {
            if (!proj || proj.isDead || !proj.activate) continue;
            try {
                proj.activate();
            } catch (err) {
                console.warn('Projectile activation failed:', err);
            }
        }
    }

    runeOffset(runes) {
        if (!runes || runes.length === 0) return 0;
        // Direction offset = arithmetic mean of the rune angles, applied relative to
        // the aim. Example: runes at 0° and 180° average to 90°. No runes → straight.
        const sum = runes.reduce((acc, a) => acc + a, 0);
        return sum / runes.length;
    }

    getElement(nodeCount) {
        if (nodeCount === 3) return 'Air';
        if (nodeCount === 4) return 'Fire';
        if (nodeCount === 5) return 'Earth';
        if (nodeCount === 6) return 'Water';
        return 'Fire';
    }

    getElementColor(element) {
        const colors = {
            Air: 0xA0E0E0,
            Fire: 0xFF6633,
            Earth: 0x80C060,
            Water: 0x4488FF
        };
        return colors[element] || 0xffffff;
    }

    getSpellSpectrum(power, radius) {
        const ratio = power / Math.max(1, radius);

        if (ratio > 5) return 'NEEDLE';
        if (ratio > 3) return 'LANCE';
        if (ratio > 2) return 'BEAM';
        if (ratio > 1.2) return 'DART';
        if (ratio > 0.8) return 'WAVE';
        if (ratio > 0.5) return 'BURST';
        if (ratio > 0.3) return 'BOULDER';
        if (ratio > 0.15) return 'CANNON';
        if (ratio > 0.05) return 'NOVA';
        return 'FLICKER';
    }

    spawnParticles(x, y, color, count = 5) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 40 + Math.random() * 120;

            // Varied particle sizes
            const baseSize = 2 + Math.random() * 4;
            const particle = this.add.circle(x, y, baseSize, color);
            particle.setDepth(100);
            particle.setBlendMode(Phaser.BlendModes.ADD);

            // Add slight glow to some particles
            if (Math.random() > 0.6) {
                particle.setStrokeStyle(2, color, 0.5);
            }

            this.tweens.add({
                targets: particle,
                x: x + Math.cos(angle) * speed,
                y: y + Math.sin(angle) * speed,
                alpha: 0,
                scale: { from: 1, to: 0.2 },
                duration: 200 + Math.random() * 300,
                ease: 'Power2',
                onComplete: () => particle.destroy()
            });
        }
    }

    resolveProjectilePvP() {
        // Snapshot — die() splices GameState.projectiles, so iterate a stable copy
        // and re-check isDead each step. Skip any projectile with a non-finite
        // position (a poisoned body must never drive collision math).
        const list = [...GameState.projectiles];
        const pvpRatio = Config.PvPPowerRatio || 1.5;

        for (let i = 0; i < list.length; i++) {
            const a = list[i];
            if (!a || a.isDead || !Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;

            for (let j = i + 1; j < list.length; j++) {
                if (a.isDead) break; // a was killed earlier in this pass
                const b = list[j];
                if (!b || b.isDead || b === a) continue;
                if (a.caster === b.caster) continue;
                if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;

                const ra = (a.projectileData && a.projectileData.radius) || 10;
                const rb = (b.projectileData && b.projectileData.radius) || 10;
                const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
                if (dist >= ra + rb) continue;

                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                if (a.power > b.power * pvpRatio) {
                    b.die();
                    a.power -= b.power * 0.5;
                    this.spawnParticles(mx, my, 0xffffff, 8);
                } else if (b.power > a.power * pvpRatio) {
                    a.die();
                    b.power -= a.power * 0.5;
                    this.spawnParticles(mx, my, 0xffffff, 8);
                } else {
                    this.spawnParticles(mx, my, 0xffffff, 12);
                    a.die();
                    b.die();
                }
            }
        }
    }

    update(time, delta) {
        // The entire frame is wrapped: this runs inside Phaser's requestAnimationFrame
        // step, so an uncaught error here would stop the loop and freeze the game.
        // Catching it lets the game drop a bad frame and keep running instead.
        try {
            // Update player
            if (this.player) {
                this.player.update(time, delta);
            }

            // Update enemies
            for (let enemy of this.enemies) {
                if (enemy && this.player) {
                    enemy.update(time, delta, { x: this.player.x, y: this.player.y });
                }
            }

            // Update projectiles. Snapshot the array (die() mutates it) and isolate
            // each projectile so one misbehaving shard self-removes without taking
            // down the rest of the frame.
            for (let proj of [...GameState.projectiles]) {
                if (!proj || proj.isDead || !proj.update) continue;
                try {
                    proj.update(time, delta);
                } catch (projErr) {
                    console.warn('Projectile update failed; removing it:', projErr);
                    if (proj.die) proj.die();
                }
            }

            // Single O(n²/2) PvP pass — replaces per-projectile individual scans.
            this.resolveProjectilePvP();

            // Update chunk loading
            if (this.player) {
                this.chunkManager.update(this.player.x, this.player.y);
            }

            // Render pathways
            if (this.player) {
                this.pathwayRenderer.render(
                    this.player.x,
                    this.player.y,
                    this.cameras.main.width,
                    this.cameras.main.height
                );
            }

            // Update HUD
            this.updateHUD();

            // Update debug text
            this.updateDebug();

            // Update minimap
            if (this.minimap && this.player) {
                this.minimap.update(this.player.x, this.player.y, this.chunkManager);
            }
        } catch (err) {
            console.error('GameScene.update recovered from a fatal frame error:', err);
        }
    }

    updateHUD() {
        if (!this.player) return;

        // HP
        const hpPct = Math.max(0, this.player.hp / this.player.maxHp);
        this.hpBar.scaleX = hpPct;

        // Stamina
        const stmPct = Math.max(0, this.player.stm / this.player.maxStm);
        this.stmBar.scaleX = stmPct;

        // Mana
        for (let [element, bar] of Object.entries(this.manaBars)) {
            const manaPct = Math.max(0, this.player.mana[element] / 100);
            bar.scaleX = manaPct;
        }

        // Update inventory cast indicators (GREEN/RED/YELLOW)
        this.updateInventoryUI();
    }

    updateDebug() {
        if (!this.player || !this.debugText) return;

        const chunkX = Math.floor(this.player.x / Config.Chunks.size);
        const chunkY = Math.floor(this.player.y / Config.Chunks.size);
        const biome = this.chunkManager.getBiomeAt(chunkX, chunkY);

        // Get chunk data for preset and path info
        const chunk = this.chunkManager.getChunk(chunkX, chunkY);
        const preset = chunk?.preset || 'random';
        const hasPath = chunk?.hasPath ? 'Yes' : 'No';
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
}

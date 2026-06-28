/**
 * GameScene - Main gameplay scene (floor-based vertical infinite system)
 */
class GameScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameScene' });
    }

    init(data) {
        this.worldSeed = data?.seed || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
        GameState.lastSeed = this.worldSeed;
        console.log('World Seed:', this.worldSeed);
    }

    create() {
        Phaser.Math.RND.sow([this.worldSeed]);

        // Floor state
        this.currentDepth        = 0;
        this._gateUnlockActive   = false;
        this._gateUnlockProgress = 0;
        this._isTransitioning    = false;
        this.boss                = null;
        this._castCooldown       = 0;

        // Floor manager (replaces ChunkManager + PathwayRenderer)
        this.floorManager = new FloorManager(this);
        const floor       = this.floorManager.generateFloor(0);

        // Matter + camera bounds from arena
        const b = this.floorManager.bounds;
        this.matter.world.setBounds(b.x, b.y, b.width, b.height);

        // Initialize Inventory System
        this.inventorySystem = new InventorySystem(this);
        this.inventorySystem.init(Config);
        GameState.inventorySystem = this.inventorySystem;

        // Entity arrays
        this.enemies    = [];
        this.projectiles = [];

        // Create player at floor spawn point
        const sp = this.floorManager.spawnPoint;
        this.player = new PlayerSprite(this, sp.x, sp.y);

        // Spawn first floor's enemies + boss
        this.spawnFloorEnemies(floor);
        this.spawnBoss(floor);

        // Camera: follow player, bounded to arena
        this.cameras.main.startFollow(this.player, true, 0.1, 0.1);
        this.cameras.main.setZoom(1);
        this.cameras.main.setBounds(b.x, b.y, b.width, b.height);

        // HUD
        this.createHUD();

        // Minimap
        if (typeof MinimapSystem !== 'undefined') {
            this.minimap = new MinimapSystem(this);
            this.minimap.create();
        }

        this.setupInput();
        this.setupCollisions();

        this.events.on('cast-spell', () => {
            try { this.castSpell(); }
            catch (err) { console.error('cast-spell event recovered from error:', err); }
        });

        this.setupInventoryUI();

        if (GameState.isMobile && typeof TouchControls !== 'undefined') {
            this.touchControls = new TouchControls(this);
        }

        this.scale.on('resize', this.onResize, this);
        this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));

        this.cameras.main.fadeIn(500);
        console.log('GameScene created — Floor 0, seed:', this.worldSeed);
    }

    onResize(gameSize) {
        const w = gameSize ? gameSize.width  : this.cameras.main.width;
        const h = gameSize ? gameSize.height : this.cameras.main.height;
        if (this.minimap && this.minimap.resize) {
            try { this.minimap.resize(w, h); } catch (e) {}
        }
        if (this.hud) {
            if (GameState.isMobile) this.hud.setPosition(4, 52).setScale(0.82);
            else                    this.hud.setPosition(0, 0).setScale(1);
        }
    }

    /* ─── Inventory / UI (unchanged) ─── */

    setupInventoryUI() {
        const inventoryBar = document.getElementById('inventory-bar');
        if (inventoryBar) {
            inventoryBar.style.display = 'flex';
            if (GameState.isMobile) inventoryBar.classList.add('mobile');
        }

        const slots = document.querySelectorAll('.inv-slot');
        slots.forEach((slot, index) => {
            slot.addEventListener('click', () => {
                this.inventorySystem.selectSlot(index);
                this.updateInventoryUI();
            });
        });

        this.events.on('inventory-slot-changed', () => this.updateInventoryUI());

        this.input.keyboard.on('keydown', (event) => {
            if (event.code.startsWith('Digit')) {
                const num = parseInt(event.code.replace('Digit', ''));
                if (num >= 1 && num <= 8) { this.inventorySystem.selectSlot(num - 1); this.updateInventoryUI(); }
            }
            if (event.code.startsWith('Numpad')) {
                const num = parseInt(event.code.replace('Numpad', ''));
                if (num >= 1 && num <= 8) { this.inventorySystem.selectSlot(num - 1); this.updateInventoryUI(); }
            }
        });

        this.updateInventoryUI();
    }

    updateInventoryUI() {
        const slots    = document.querySelectorAll('.inv-slot');
        const statuses = this.inventorySystem.getAllCastStatuses(this.player?.mana);

        slots.forEach((slot, index) => {
            slot.classList.toggle('active', index === this.inventorySystem.selectedSlot);
            const indicator = slot.querySelector('.cast-indicator');
            if (indicator) indicator.className = 'cast-indicator ' + statuses[index];
        });
    }

    /* ─── Floor spawn helpers ─── */

    spawnFloorEnemies(floor) {
        const cfg   = Config.FloorGen;
        const depth = floor.depth;
        const count = Math.min(cfg.baseEnemies + depth * cfg.enemiesPerDepth, cfg.maxEnemies);
        const scale = 1 + depth * cfg.statScalePerDepth;
        const pool  = floor.theme.enemyPool;
        const b     = floor.bounds;

        for (let i = 0; i < count; i++) {
            const key  = pool[Math.floor(Math.random() * pool.length)];
            const arch = EnemyArchetypes && EnemyArchetypes[key];
            if (!arch) continue;

            const scaledArch = {
                ...arch,
                baseHp:        arch.baseHp        * scale,
                baseSpeed:     arch.baseSpeed      * Math.sqrt(scale), // speed grows slower
                contactDamage: arch.contactDamage  * scale
            };

            let x, y, tries = 0;
            do {
                x = b.x + 60 + Math.random() * (b.width  - 120);
                y = b.y + 60 + Math.random() * (b.height - 120);
                tries++;
            } while (Math.sqrt(x * x + y * y) < Config.MapSpawn.playerClearRadius && tries < 30);

            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

            // Stagger positions to avoid coincident Matter bodies
            x += i * 0.6;
            y += i * 0.6;

            const enemy = new EnemySprite(this, x, y, scaledArch);
            this.enemies.push(enemy);
            GameState.enemies.push(enemy);
        }
    }

    spawnBoss(floor) {
        const bossKey    = floor.theme.boss;
        const bossConfig = BossConfigs && BossConfigs[bossKey];
        if (!bossConfig) return;

        const sp    = floor.bossSpawn || { x: 0, y: -600 };
        const depth = floor.depth;
        const scale = 1 + depth * Config.FloorGen.statScalePerDepth;

        if (!Number.isFinite(sp.x) || !Number.isFinite(sp.y)) return;

        this.boss = new BossSprite(this, sp.x, sp.y, bossConfig, floor, scale);
        this.enemies.push(this.boss);
        GameState.enemies.push(this.boss);
    }

    clearEnemies() {
        for (const enemy of [...this.enemies]) {
            if (!enemy) continue;
            enemy.isDead = true; // prevent die() re-entrance
            try { enemy.destroy(); } catch (e) {}
        }
        this.enemies    = [];
        GameState.enemies = [];
        this.boss       = null;
    }

    /* ─── Floor transitions ─── */

    transitionToFloor(newDepth) {
        if (this._isTransitioning) return;
        this._isTransitioning = true;

        this.cameras.main.fadeOut(500);
        this.cameras.main.once('camerafadeoutcomplete', () => {
            this._doTransition(newDepth);
        });
    }

    _doTransition(newDepth) {
        // Tear down current floor
        this.floorManager.teardownFloor();

        // Remove all enemies
        this.clearEnemies();

        // Expire all projectiles
        for (const proj of [...GameState.projectiles]) {
            if (proj && proj.die) try { proj.die(); } catch(e) {}
        }
        GameState.projectiles = [];

        // Reset gate state
        this._gateUnlockActive   = false;
        this._gateUnlockProgress = 0;
        GameState.bossNullifyCast = false;

        // Generate new floor
        this.currentDepth = newDepth;
        const floor       = this.floorManager.generateFloor(newDepth);

        // Decide where player enters (advancing → south entry; retreating → north entry near gate)
        const advancing = newDepth > (this.currentDepth - 1); // always true since currentDepth is already set
        const sp = newDepth >= 0
            ? { x: 0, y: this.floorManager.bounds.y + this.floorManager.bounds.height - 150 } // enter from south (near rift side)
            : { x: 0, y: 150 };
        // Simple: always use floor.spawnPoint (center-ish)
        if (this.player) {
            this.player.setPosition(floor.spawnPoint.x, floor.spawnPoint.y);
            this.player.setVelocity(0, 0);
        }

        // Re-set bounds
        const b = this.floorManager.bounds;
        this.matter.world.setBounds(b.x, b.y, b.width, b.height);
        this.cameras.main.setBounds(b.x, b.y, b.width, b.height);

        // Spawn enemies + boss
        this.spawnFloorEnemies(floor);
        this.spawnBoss(floor);

        this.cameras.main.fadeIn(500);
        this._isTransitioning = false;
    }

    /* ─── HUD ─── */

    createHUD() {
        this.hud = this.add.container(0, 0).setScrollFactor(0).setDepth(1000);

        const hpBg = this.add.rectangle(120, 30, 200, 20, 0x333333);
        hpBg.setStrokeStyle(2, 0x666666);

        this.hpBar = this.add.rectangle(21, 30, 198, 18, 0x22aa22);
        this.hpBar.setOrigin(0, 0.5);

        const hpLabel = this.add.text(120, 30, 'LIFE', {
            fontFamily: 'Arial', fontSize: '12px', color: '#ffffff'
        }).setOrigin(0.5);

        const stmBg = this.add.rectangle(120, 55, 200, 12, 0x333333);
        stmBg.setStrokeStyle(1, 0x666666);

        this.stmBar = this.add.rectangle(21, 55, 198, 10, 0x2288aa);
        this.stmBar.setOrigin(0, 0.5);

        const stmLabel = this.add.text(120, 55, 'VIGOR', {
            fontFamily: 'Arial', fontSize: '10px', color: '#ffffff'
        }).setOrigin(0.5);

        const manaColors = { Air: 0xA0E0E0, Fire: 0xE06060, Earth: 0x80C060, Water: 0x4080E0 };
        this.manaBars = {};
        let manaY = 85;
        for (const [element, color] of Object.entries(manaColors)) {
            const bg   = this.add.rectangle(80, manaY, 120, 8, 0x333333);
            const fill = this.add.rectangle(21, manaY, 118, 6, color);
            fill.setOrigin(0, 0.5);
            const label = this.add.text(15, manaY, element[0], {
                fontFamily: 'Arial', fontSize: '10px',
                color: '#' + color.toString(16).padStart(6, '0')
            }).setOrigin(0.5);
            this.manaBars[element] = fill;
            this.hud.add([bg, fill, label]);
            manaY += 15;
        }

        this.hud.add([hpBg, this.hpBar, hpLabel, stmBg, this.stmBar, stmLabel]);

        // Debug text
        this.debugText = this.add.text(10, 160, '', {
            fontFamily: 'monospace', fontSize: '11px', color: '#88aa88'
        }).setScrollFactor(0).setDepth(1000);

        // Floor indicator
        this.floorText = this.add.text(10, 192, 'Floor: 0 | —', {
            fontFamily: 'Arial', fontSize: '11px', color: '#aaddff'
        }).setScrollFactor(0).setDepth(1000);

        // Gate unlock bar (hidden until player enters gate zone)
        const gateY = 210;
        this.gateBarBg = this.add.rectangle(120, gateY, 200, 12, 0x222222);
        this.gateBarBg.setStrokeStyle(1, 0x44aa66);
        this.gateBarBg.setScrollFactor(0).setDepth(1000).setVisible(false);

        this.gateBarFill = this.add.rectangle(21, gateY, 0, 10, 0x44ffaa);
        this.gateBarFill.setOrigin(0, 0.5);
        this.gateBarFill.setScrollFactor(0).setDepth(1000).setVisible(false);

        this.gateBarLabel = this.add.text(120, gateY - 10, 'GATE UNLOCKING', {
            fontFamily: 'Arial', fontSize: '9px', color: '#44ffaa'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(1000).setVisible(false);

        if (GameState.isMobile) {
            this.hud.setPosition(4, 52).setScale(0.82);
            this.debugText.setVisible(false);
        }
    }

    /* ─── Input ─── */

    setupInput() {
        this.input.mouse.disableContextMenu();
        if (GameState.isMobile) return;

        this.input.on('pointerdown', (pointer) => {
            try {
                if (pointer.leftButtonDown() && !GameState.isMagicOpen) {
                    this.castSpell();
                }
            } catch (err) { console.error('Cast input recovered from error:', err); }
        });

        this.input.on('pointerdown', (pointer) => {
            try {
                if (pointer.rightButtonDown()) this.remoteTrigger();
            } catch (err) { console.error('Remote-trigger input recovered from error:', err); }
        });
    }

    /* ─── Collisions ─── */

    setupCollisions() {
        this.matter.world.on('collisionstart', (event) => {
          try {
            for (const pair of event.pairs) {
                const { bodyA, bodyB } = pair;

                if (bodyA.label === 'projectile' && bodyB.label === 'enemy') {
                    this.handleProjectileHit(bodyA.gameObject, bodyB.gameObject);
                } else if (bodyA.label === 'enemy' && bodyB.label === 'projectile') {
                    this.handleProjectileHit(bodyB.gameObject, bodyA.gameObject);
                }

                if (bodyA.label === 'projectile' && bodyB.label === 'player') {
                    this.handleProjectilePlayerHit(bodyA.gameObject, bodyB.gameObject);
                } else if (bodyA.label === 'player' && bodyB.label === 'projectile') {
                    this.handleProjectilePlayerHit(bodyB.gameObject, bodyA.gameObject);
                }

                const objectTypes = ['Tree', 'Wall', 'Cliff', 'Rock', 'Crate', 'Barrel', 'Bush', 'Boulder', 'Pillar'];
                const isProjA = bodyA.label === 'projectile';
                const isProjB = bodyB.label === 'projectile';
                const isObjA  = objectTypes.includes(bodyA.label);
                const isObjB  = objectTypes.includes(bodyB.label);

                if (isProjA && isObjB) this.handleProjectileObjectHit(bodyA.gameObject, bodyB);
                else if (isProjB && isObjA) this.handleProjectileObjectHit(bodyB.gameObject, bodyA);

                if ((bodyA.label === 'player' && bodyB.label === 'enemy') ||
                    (bodyA.label === 'enemy'  && bodyB.label === 'player')) {
                    const player = bodyA.label === 'player' ? bodyA.gameObject : bodyB.gameObject;
                    const enemy  = bodyA.label === 'enemy'  ? bodyA.gameObject : bodyB.gameObject;
                    this.handlePlayerEnemyCollision(player, enemy);
                }
            }
          } catch (err) {
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

        // Try gameObject reference first (set by Phaser Matter sprites)
        let worldObj = objectBody.gameObject;

        // Fall back to searching FloorManager's tracked objects
        if (!worldObj && this.floorManager) {
            worldObj = this.floorManager.getObjectByBody(objectBody);
        }

        if (worldObj) {
            projectile.onHitObject(worldObj);
        } else {
            if (projectile.power <= Config.OverwhelmThreshold) projectile.die();
        }
    }

    handleProjectilePlayerHit(projectile, player) {
        if (!projectile || projectile.isDead || !player) return;
        if (player.isDashing) return;
        if (projectile.activationDelay > 0) return;
        if (projectile.caster === player && projectile.distanceTraveled < 50) return;

        player.takeDamage(projectile.damage);

        if (projectile.body && projectile.body.velocity) {
            const vel = projectile.body.velocity;
            const mag = Math.sqrt(vel.x * vel.x + vel.y * vel.y) || 1;
            const knockback = projectile.power * 0.1;
            player.setVelocity(
                player.body.velocity.x + (vel.x / mag) * knockback,
                player.body.velocity.y + (vel.y / mag) * knockback
            );
        }

        this.spawnParticles(player.x, player.y, projectile.mainColor || 0xff0000, 8);
        this.cameras.main.shake(80, 0.008);

        if (projectile.pierceRemaining > 0) projectile.pierceRemaining--;
        else projectile.die();
    }

    handlePlayerEnemyCollision(player, enemy) {
        if (player && !player.isDashing) {
            const dmg = (enemy && enemy.contactDamage) ? enemy.contactDamage : 10;
            player.takeDamage(dmg);
        }
    }

    /* ─── Magic editor ─── */

    openMagicEditor() {
        GameState.isMagicOpen = true;
        GameState.timeScale   = 0.1;
        this.scene.pause();
        this.scene.launch('MagicEditorScene');
    }

    /* ─── Cast Spell ─── */

    castSpell() {
        // Boss nullify gimmick
        if (GameState.bossNullifyCast) {
            GameState.bossNullifyCast = false;
            this.cameras.main.shake(100, 0.006);
            this.spawnParticles(this.player.x, this.player.y, 0xaa44ff, 10);
            return;
        }

        // Cast cooldown (set by tier system)
        if (this._castCooldown > 0) return;

        let stack    = [];
        let manaCost = 0;
        let allShapes = [];

        GameState.magic.layers.forEach(layer => {
            if (!layer.visible) return;
            layer.items.forEach(item => {
                if (item.type === 'SHAPE') allShapes.push(item.data);
            });
        });

        const powerMult      = (GameState.magic.layers[0] && GameState.magic.layers[0].power)
            || GameState.magic.powerMultiplier || 1;
        const manaCostMult   = 1 + (powerMult - 1) * 0.2;
        const costByElement  = {};

        allShapes.forEach(shape => {
            const el   = shape.element;
            const cost = Math.ceil((Config.ManaCost[el] || 15) * manaCostMult);
            costByElement[el] = (costByElement[el] || 0) + cost;
        });

        allShapes.forEach(shape => {
            const element    = shape.element;
            const actualCost = Math.ceil((Config.ManaCost[element] || 15) * manaCostMult);

            if (this.player.mana[element] >= (costByElement[element] || 0)) {
                manaCost += actualCost;

                if (stack.length > 0) {
                    const top    = stack[stack.length - 1];
                    const bottom = element;
                    let beats    = false;
                    if (bottom === 'Water' && top === 'Fire')  beats = true;
                    if (bottom === 'Fire'  && top === 'Earth') beats = true;
                    if (bottom === 'Earth' && top === 'Air')   beats = true;
                    if (bottom === 'Air'   && top === 'Water') beats = true;
                    if (beats) stack.pop(); else stack.push(bottom);
                } else {
                    stack.push(element);
                }
            }
        });

        for (const [el, cost] of Object.entries(costByElement)) {
            if (this.player.mana[el] >= cost) this.player.mana[el] -= cost;
        }

        let circleLayers = [];
        GameState.magic.layers.forEach(layer => {
            if (!layer.visible) return;
            const layerCircles = layer.items.filter(i => i.type === 'CIRCLE').map(i => i.data);
            if (layerCircles.length > 0) circleLayers.push(layerCircles);
        });

        const hasCircles           = circleLayers.length > 0;
        const hasElements          = stack.length > 0;
        const hadShapesButNoMana   = allShapes.length > 0 && stack.length === 0;

        if (!hasCircles && !hasElements)  { this.castBaseMagic(); return; }
        if (hadShapesButNoMana)           { this.castBaseMagic(); return; }

        if (circleLayers.length === 0) {
            circleLayers.push([{ center: { x: 0, y: 0 }, rad: 30, runes: [], virtual: true }]);
        }

        const containerLayer = circleLayers[0];
        const payloadLayers  = circleLayers.slice(1);

        let baseDmg   = stack.length > 0 ? stack.length * (Config.BaseDamagePerElement || 20) : 10;
        let basePower = ((Config.BasePower || 50) + (stack.length * 25)) * powerMult;

        // Instability penalties
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
                stack[Math.floor(Math.random() * stack.length)] =
                    elements[Math.floor(Math.random() * elements.length)];
            }
        }

        // === SPELL TIER (after basePower + stability are resolved) ===
        let finalCooldown = Config.CastCooldown || 0.5;
        if (typeof computeThreatScore !== 'undefined') {
            const firstRadius = (containerLayer.length > 0 && containerLayer[0].rad) ? containerLayer[0].rad : 30;
            const spectrum    = this.getSpellSpectrum(basePower, firstRadius);
            const uniqueElems = new Set(stack).size;
            const tierScore   = computeThreatScore({
                basePower,
                spectrum,
                uniqueElements: uniqueElems,
                payloadLayers:  payloadLayers.length,
                circleCount:    containerLayer.length,
                stability
            });
            const { tier, index } = scoreToTier(tierScore);
            const balance         = tierBalance(index);

            // Extra mana tax (applied on top of already-deducted base cost)
            if (balance.manaMult > 1) {
                const extraFrac = balance.manaMult - 1;
                for (const [el, cost] of Object.entries(costByElement)) {
                    if (this.player.mana[el] !== undefined) {
                        this.player.mana[el] = Math.max(0, this.player.mana[el] - Math.ceil(cost * extraFrac));
                    }
                }
            }

            finalCooldown = Math.max(Config.CastCooldown || 0.5, balance.cooldown);
        }

        // Direction
        const angle = this.player.aimAngle;
        let totalRecoil = 0;

        containerLayer.forEach((circle, circleIndex) => {
            const spectrum       = this.getSpellSpectrum(basePower, circle.rad);
            const spectrumConfig = Config.SpellSpectrum.effects[spectrum] || {};

            const SMALL_THRESHOLD  = 30;
            const LARGE_THRESHOLD  = 60;
            const WEAK_THRESHOLD   = 100;
            const STRONG_THRESHOLD = 200;
            const PLAYER_SPEED     = Config.PlayerSpd || 400;

            const sizeNorm  = Math.min(1, Math.max(0, (circle.rad - SMALL_THRESHOLD) / (LARGE_THRESHOLD - SMALL_THRESHOLD)));
            const powerNorm = Math.min(1, Math.max(0, (basePower - WEAK_THRESHOLD)  / (STRONG_THRESHOLD - WEAK_THRESHOLD)));

            const topSpeed    = PLAYER_SPEED * 1.2 + (1200 - PLAYER_SPEED * 1.2) * powerNorm;
            const bottomSpeed = 120           + (280  - 120)           * powerNorm;
            let calculatedSpeed = topSpeed + (bottomSpeed - topSpeed) * sizeNorm;

            const elementSpeedMods = { Air: 1.15, Fire: 1.05, Water: 1.0, Earth: 0.9 };
            let elementMod = 1.0;
            if (stack.length > 0) {
                let totalMod = stack.reduce((s, el) => s + (elementSpeedMods[el] || 1.0), 0);
                elementMod = 1 + (totalMod / stack.length - 1) * (1 - sizeNorm * 0.7);
            }

            const finalSpeed = Math.round(calculatedSpeed * elementMod);
            const speed      = circle.virtual ? (PLAYER_SPEED * 1.0) : finalSpeed;

            const isBigCircle = circle.rad >= LARGE_THRESHOLD;
            const isPiercing  = !isBigCircle && ['NEEDLE', 'LANCE', 'BEAM'].includes(spectrum);
            const physics     = isPiercing ? 'SHARP' : 'BLUNT';

            let bluntSpeedModifier = 1.0;
            if (physics === 'BLUNT' && basePower > WEAK_THRESHOLD) {
                const powerFactor = Math.min(1, (basePower - WEAK_THRESHOLD) / (STRONG_THRESHOLD - WEAK_THRESHOLD));
                bluntSpeedModifier = 1.0 - powerFactor * 0.5;
            }

            const damage = payloadLayers.length > 0 ? 10 : baseDmg * (spectrumConfig.damage || 1);

            const recoilAmount = spectrumConfig.knockback || 0;
            if (recoilAmount > 0 && !circle.virtual) {
                this.player.setVelocity(
                    this.player.body.velocity.x - Math.cos(angle) * recoilAmount * 6,
                    this.player.body.velocity.y - Math.sin(angle) * recoilAmount * 6
                );
                totalRecoil += recoilAmount;
            }

            const spread     = instab * (Config.Instability.spreadMax || 0.52);
            const finalAngle = angle + this.runeOffset(circle.runes) + (Math.random() - 0.5) * 2 * spread;

            let projRadius;
            if (isPiercing) {
                projRadius = Math.max(5, 8 * (spectrumConfig.visualScale || 1));
            } else {
                projRadius = Math.max(10, (circle.rad / 2) * (spectrumConfig.visualScale || 1));
            }

            const spawnOffset = Math.max(Config.ProjectileSpawnOffset || 30, this.player.rad + projRadius + 8)
                + circleIndex * (projRadius + 8);
            const dirX       = Math.cos(finalAngle);
            const dirY       = Math.sin(finalAngle);
            const perpNudge  = (circleIndex % 2 === 0 ? 1 : -1) * Math.ceil(circleIndex / 2) * 6;
            const sx         = this.player.x + dirX * spawnOffset - dirY * perpNudge;
            const sy         = this.player.y + dirY * spawnOffset + dirX * perpNudge;

            const payload = this.buildPayloadChain(payloadLayers, stack, baseDmg, basePower);

            new ProjectileSprite(this, sx, sy, {
                elements:  stack,
                spectrum,
                physics,
                damage,
                pierce:    spectrumConfig.pierce || 0,
                radius:    projRadius,
                vel:       { x: dirX * speed * bluntSpeedModifier, y: dirY * speed * bluntSpeedModifier },
                power:     basePower,
                caster:    this.player,
                payload
            });

            this.player.stm = Math.max(0, this.player.stm - (3 + powerMult));
        });

        // Set cast cooldown
        this._castCooldown = finalCooldown;

        // Visual feedback
        const shakeIntensity = Math.min(0.01, 0.002 + totalRecoil * 0.002 + powerMult * 0.001);
        this.cameras.main.shake(80, shakeIntensity);
        const flashColor     = stack.length > 0 ? this.getElementColor(stack[stack.length - 1]) : 0xffaa00;
        const particleCount  = Math.min(20, 6 + stack.length * 2 + Math.floor(powerMult));
        this.spawnParticles(
            this.player.x + Math.cos(angle) * 30,
            this.player.y + Math.sin(angle) * 30,
            flashColor, particleCount
        );
        if (powerMult >= 5 || stack.length >= 3) {
            this.cameras.main.flash(100, 255, 255, 255, false, () => {});
        }
    }

    buildPayloadChain(remainingLayers, elements, totalDamage, parentPower) {
        if (remainingLayers.length === 0) return [];
        const currentLayer  = remainingLayers[0];
        const nextLayers    = remainingLayers.slice(1);
        const splitCount    = currentLayer.length;
        const damagePerShard = totalDamage / splitCount;
        const powerPerShard  = Math.max(parentPower / splitCount, (Config.BasePower || 50) / 2);

        return currentLayer.map(circle => ({
            relAngle:        this.runeOffset(circle.runes),
            circleRadius:    circle.rad,
            baseDamage:      damagePerShard,
            inheritedPower:  powerPerShard,
            hasMorePayloads: nextLayers.length > 0,
            nestedPayload:   this.buildPayloadChain(nextLayers, elements, damagePerShard, powerPerShard)
        }));
    }

    castBaseMagic() {
        const angle       = this.player.aimAngle;
        const speed       = Config.BaseMagic?.speed  || 400;
        const spawnOffset = Config.ProjectileSpawnOffset || 30;

        new ProjectileSprite(this,
            this.player.x + Math.cos(angle) * spawnOffset,
            this.player.y + Math.sin(angle) * spawnOffset,
            {
                elements: [], spectrum: 'DART', physics: 'BLUNT',
                damage:   Config.BaseMagic?.damage || 5,
                radius:   Config.BaseMagic?.radius || 8,
                vel:      { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
                power:    Config.BaseMagic?.power  || 20,
                caster:   this.player, payload: null
            }
        );

        this.player.stm = Math.max(0, this.player.stm - 2);
        this.spawnParticles(
            this.player.x + Math.cos(angle) * spawnOffset,
            this.player.y + Math.sin(angle) * spawnOffset,
            0x888888, 5
        );
    }

    remoteTrigger() {
        for (const proj of [...GameState.projectiles]) {
            if (!proj || proj.isDead || !proj.activate) continue;
            try { proj.activate(); }
            catch (err) { console.warn('Projectile activation failed:', err); }
        }
    }

    runeOffset(runes) {
        if (!runes || runes.length === 0) return 0;
        return runes.reduce((acc, a) => acc + a, 0) / runes.length;
    }

    getElement(nodeCount) {
        if (nodeCount === 3) return 'Air';
        if (nodeCount === 4) return 'Fire';
        if (nodeCount === 5) return 'Earth';
        if (nodeCount === 6) return 'Water';
        return 'Fire';
    }

    getElementColor(element) {
        return ({ Air: 0xA0E0E0, Fire: 0xFF6633, Earth: 0x80C060, Water: 0x4488FF })[element] || 0xffffff;
    }

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

    spawnParticles(x, y, color, count = 5) {
        for (let i = 0; i < count; i++) {
            const angle    = Math.random() * Math.PI * 2;
            const speed    = 40 + Math.random() * 120;
            const particle = this.add.circle(x, y, 2 + Math.random() * 4, color);
            particle.setDepth(100).setBlendMode(Phaser.BlendModes.ADD);
            if (Math.random() > 0.6) particle.setStrokeStyle(2, color, 0.5);
            this.tweens.add({
                targets: particle,
                x: x + Math.cos(angle) * speed,
                y: y + Math.sin(angle) * speed,
                alpha: 0, scale: { from: 1, to: 0.2 },
                duration: 200 + Math.random() * 300,
                ease: 'Power2', onComplete: () => particle.destroy()
            });
        }
    }

    resolveProjectilePvP() {
        const list     = [...GameState.projectiles];
        const pvpRatio = Config.PvPPowerRatio || 1.5;

        for (let i = 0; i < list.length; i++) {
            const a = list[i];
            if (!a || a.isDead || !Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;

            for (let j = i + 1; j < list.length; j++) {
                if (a.isDead) break;
                const b = list[j];
                if (!b || b.isDead || b === a) continue;
                if (a.caster === b.caster) continue;
                if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;

                const ra   = (a.projectileData && a.projectileData.radius) || 10;
                const rb   = (b.projectileData && b.projectileData.radius) || 10;
                const dist = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
                if (dist >= ra + rb) continue;

                const mx = (a.x + b.x) / 2;
                const my = (a.y + b.y) / 2;
                if (a.power > b.power * pvpRatio) {
                    b.die(); a.power -= b.power * 0.5;
                    this.spawnParticles(mx, my, 0xffffff, 8);
                } else if (b.power > a.power * pvpRatio) {
                    a.die(); b.power -= a.power * 0.5;
                    this.spawnParticles(mx, my, 0xffffff, 8);
                } else {
                    this.spawnParticles(mx, my, 0xffffff, 12);
                    a.die(); b.die();
                }
            }
        }
    }

    /* ─── Main update loop ─── */

    update(time, delta) {
        try {
            const dt = delta / 1000;

            // Cast cooldown countdown
            if (this._castCooldown > 0) {
                this._castCooldown = Math.max(0, this._castCooldown - dt);
            }

            // Player
            if (this.player) this.player.update(time, delta);

            // Enemies — snapshot before iterating to guard against mid-loop splices from die()
            for (const enemy of [...this.enemies]) {
                if (!enemy || enemy.isDead || !this.player) continue;
                enemy.update(time, delta, { x: this.player.x, y: this.player.y });
            }

            // Projectiles
            for (const proj of [...GameState.projectiles]) {
                if (!proj || proj.isDead || !proj.update) continue;
                try { proj.update(time, delta); }
                catch (projErr) { console.warn('Projectile update failed; removing:', projErr); if (proj.die) proj.die(); }
            }

            this.resolveProjectilePvP();

            // Gate zone logic
            if (this.floorManager && this.player && !this._isTransitioning) {
                const gate = this.floorManager.gate;
                if (gate && gate.state !== 'open') {
                    const gx   = this.player.x - gate.x;
                    const gy   = this.player.y - gate.y;
                    const dist = Math.sqrt(gx * gx + gy * gy);
                    const R    = Config.FloorGen.gateZoneRadius || 100;

                    if (dist < R) {
                        if (!this._gateUnlockActive) {
                            this._gateUnlockActive = true;
                            // Force boss into AGGRO
                            if (this.boss && this.boss.forceAggro) this.boss.forceAggro();
                        }
                        this._gateUnlockProgress += dt;
                        gate.unlockProgress = this._gateUnlockProgress;

                        if (this._gateUnlockProgress >= gate.unlockSeconds) {
                            gate.state = 'open';
                            this.transitionToFloor(this.currentDepth + 1);
                        }
                    } else if (this._gateUnlockActive) {
                        // Decay at half rate when outside zone
                        this._gateUnlockProgress = Math.max(0, this._gateUnlockProgress - dt * 0.5);
                        gate.unlockProgress = this._gateUnlockProgress;
                    }
                }

                // Return Rift zone
                const rift = this.floorManager.returnRift;
                if (rift && this.currentDepth > 0 && !this._isTransitioning) {
                    const rx   = this.player.x - rift.x;
                    const ry   = this.player.y - rift.y;
                    const rdist = Math.sqrt(rx * rx + ry * ry);
                    if (rdist < (Config.FloorGen.riftZoneRadius || 80)) {
                        this.transitionToFloor(this.currentDepth - 1);
                    }
                }
            }

            this.updateHUD();
            this.updateDebug();

            // Minimap
            if (this.minimap && this.player) {
                this.minimap.update(this.player.x, this.player.y, this.floorManager, this.boss);
            }

        } catch (err) {
            console.error('GameScene.update recovered from a fatal frame error:', err);
        }
    }

    updateHUD() {
        if (!this.player) return;

        this.hpBar.scaleX  = Math.max(0, this.player.hp  / this.player.maxHp);
        this.stmBar.scaleX = Math.max(0, this.player.stm / this.player.maxStm);

        for (const [element, bar] of Object.entries(this.manaBars)) {
            bar.scaleX = Math.max(0, this.player.mana[element] / 100);
        }

        this.updateInventoryUI();

        // Floor indicator
        if (this.floorText && this.floorManager && this.floorManager.currentFloor) {
            const f = this.floorManager.currentFloor;
            this.floorText.setText(`Floor: ${f.depth} | ${f.theme.name}`);
        }

        // Gate unlock bar
        const gateActive = this._gateUnlockActive && this.floorManager && this.floorManager.gate;
        if (this.gateBarBg)    this.gateBarBg.setVisible(!!gateActive);
        if (this.gateBarFill)  this.gateBarFill.setVisible(!!gateActive);
        if (this.gateBarLabel) this.gateBarLabel.setVisible(!!gateActive);

        if (gateActive && this.gateBarFill && this.floorManager.gate) {
            const pct = Math.min(1, this._gateUnlockProgress / this.floorManager.gate.unlockSeconds);
            this.gateBarFill.scaleX = pct;
        }
    }

    updateDebug() {
        if (!this.player || !this.debugText) return;

        const f = this.floorManager && this.floorManager.currentFloor;
        this.debugText.setText([
            `Seed:  ${this.worldSeed || 'N/A'}`,
            `Pos:   ${Math.round(this.player.x)}, ${Math.round(this.player.y)}`,
            `Floor: ${this.currentDepth} (${f ? f.theme.name : '—'})`,
            `Biome: ${f ? f.theme.biome : '—'}`,
            `Enemies: ${this.enemies.length}`,
            `Boss: ${this.boss ? `${this.boss.bossState} (${Math.round(this.boss.hp)}hp)` : 'none'}`,
            `Gate: ${this._gateUnlockProgress ? Math.round(this._gateUnlockProgress) + 's' : '—'} / ${f ? f.gate.unlockSeconds : '—'}s`,
            `Projectiles: ${GameState.projectiles.length}`
        ].join('\n'));
    }
}

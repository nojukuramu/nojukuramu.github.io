/**
 * ProjectileSprite - Magic projectile with spectrum system
 */
class ProjectileSprite extends Phaser.Physics.Matter.Sprite {
    constructor(scene, x, y, data) {
        // Determine texture based on physics type
        const texture = data.physics === 'SHARP' ? 'projectile_sharp' : 'projectile_blunt';

        super(scene.matter.world, x, y, texture);
        scene.add.existing(this);

        // Physics body with proper collision radius
        const { Bodies } = Phaser.Physics.Matter.Matter;
        const radius = data.radius || 10;

        // Collision categories: 1=Player, 2=Enemy, 4=Objects, 8=Projectiles
        const collisionCategory = 8;
        const collidesWith = 1 | 2 | 4; // Player (1), Enemies (2), and Objects (4)

        const circleBody = Bodies.circle(x, y, radius, {
            label: 'projectile',
            friction: 0,
            frictionAir: 0,
            restitution: 0.3,
            isSensor: data.physics === 'SHARP', // Sharp projectiles don't push
            collisionFilter: {
                category: collisionCategory,
                mask: collidesWith
            }
        });

        this.setExistingBody(circleBody);
        this.setFixedRotation();

        // Store radius
        this.collisionRadius = radius;

        // Store data FIRST (needed for color calculation)
        this.projectileData = data;
        this.power = data.power || 50;
        this.damage = data.damage || 10;
        this.elements = data.elements || [];
        this.spectrum = data.spectrum || 'DART';
        this.physics = data.physics || 'BLUNT';
        this.caster = data.caster || null;
        this.payload = data.payload || null;

        // Set element color BEFORE drawing visual
        this.setTintFromElements();

        // HIDE the sprite texture - we'll draw our own visual that matches physics exactly
        this.setAlpha(0);

        // Create a graphics object that draws at EXACTLY the physics radius
        this.visualGraphics = scene.add.graphics();
        this.visualGraphics.setDepth(100); // Above most things
        this.drawVisual(data.physics, radius);
        this.visualGraphics.setPosition(x, y);

        // Spectrum properties
        const spectrumConfig = Config.SpellSpectrum.effects[this.spectrum] || {};
        this.pierceRemaining = spectrumConfig.pierce || 0;
        this.speed = spectrumConfig.speed || 800;

        // Apply initial velocity (guard against NaN/Infinity which would
        // corrupt the Matter physics simulation and freeze the game)
        if (data.vel && Number.isFinite(data.vel.x) && Number.isFinite(data.vel.y)) {
            this.setVelocity(data.vel.x * 0.1, data.vel.y * 0.1);
        }

        // Lifetime based on power
        this.lifetime = Config.ProjectileLife;
        this.distanceTraveled = 0;
        this.maxDistance = this.power * Config.PowerDistanceRatio;
        this.startPos = { x, y };

        // Active state (for remote trigger)
        this.isActive = false;
        this.activationDelay = 0.1; // Can't activate immediately

        // Lifecycle guard - once dead, the body/scene are gone and this object
        // must never be updated or touched again (prevents use-after-destroy
        // crashes that would throw inside the game loop and freeze it).
        this.isDead = false;

        // Trail particles
        this.setupTrail(scene);

        // Collision is already set in body creation (category 8, mask 2|4)

        // Reference
        this.scene = scene;

        // Track hit objects to avoid double-hits
        this.hitObjects = new Set();

        // Earth BLUNT contact damage tracking
        this.earthContactEntities = new Set();
        this.earthDamageTick = 0;

        // Add to game state
        GameState.projectiles.push(this);
    }

    /**
     * True only while this projectile is safe to touch. After die()/destroy()
     * the physics body and scene reference are gone; calling into Phaser/Matter
     * at that point throws and (because we are inside the rAF game step) would
     * freeze the entire game. Every per-frame / collision method guards on this.
     */
    isAlive() {
        return !this.isDead && !!this.body && !!this.scene;
    }

    onHitObject(obj) {
        if (!this.isAlive()) return; // Safety check

        // Avoid hitting the same object multiple times
        if (this.hitObjects.has(obj)) return;
        this.hitObjects.add(obj);

        // Check if object has takeDamage method and is still valid
        if (!obj || !obj.takeDamage) return;

        // Store position before damage (object might be destroyed)
        const hitX = obj.x || this.x;
        const hitY = obj.y || this.y;
        const cfg = Config.Objects[obj.objectType];
        const color = cfg ? parseInt(cfg.color.replace('#', ''), 16) : 0x888888;

        // Immortal objects stop projectiles but take no damage
        if (obj.immortal) {
            // Spawn impact particles
            this.scene.spawnParticles(this.x, this.y, 0x888888, 6);

            // Projectile dies on immortal objects (unless overwhelm)
            if (this.power <= Config.OverwhelmThreshold) {
                this.die();
            }
            return;
        }

        // Check if object is moveable and should be pushed (do this BEFORE damage)
        const shouldPush = this.physics === 'BLUNT' && obj.body && !obj.body.isStatic && obj.body.position;
        let pushData = null;

        if (shouldPush) {
            const vel = this.body.velocity;
            const mag = Math.sqrt(vel.x * vel.x + vel.y * vel.y) || 1;
            const pushForce = this.power * 0.0003;
            pushData = {
                body: obj.body,
                force: {
                    x: (vel.x / mag) * pushForce,
                    y: (vel.y / mag) * pushForce
                }
            };
        }

        // Apply damage based on projectile type
        let dmg = this.damage;
        if (this.physics === 'SHARP') {
            obj.takeDamage(dmg);
        } else {
            obj.takeDamage(dmg * 0.7);
        }

        // Apply push AFTER damage check, but only if body still exists
        if (pushData && pushData.body && pushData.body.position) {
            try {
                Phaser.Physics.Matter.Matter.Body.applyForce(
                    pushData.body,
                    pushData.body.position,
                    pushData.force
                );
            } catch (e) {
                // Body was destroyed, ignore
            }
        }

        // Spawn hit particles at stored position
        this.scene.spawnParticles(hitX, hitY, color, 5);

        // Check pierce
        if (this.pierceRemaining > 0) {
            this.pierceRemaining--;
        } else if (this.power <= Config.OverwhelmThreshold) {
            this.die();
        }
    }

    setTintFromElements() {
        const elementColors = {
            Air: 0xA0E0E0,
            Fire: 0xFF6633,
            Earth: 0x80C060,
            Water: 0x4488FF
        };

        if (this.elements.length > 0) {
            // Blend colors if multiple elements
            if (this.elements.length > 1) {
                let r = 0, g = 0, b = 0;
                for (let el of this.elements) {
                    const c = elementColors[el] || 0xffffff;
                    r += (c >> 16) & 0xff;
                    g += (c >> 8) & 0xff;
                    b += c & 0xff;
                }
                r = Math.floor(r / this.elements.length);
                g = Math.floor(g / this.elements.length);
                b = Math.floor(b / this.elements.length);
                this.mainColor = (r << 16) | (g << 8) | b;
            } else {
                this.mainColor = elementColors[this.elements[0]] || 0xffffff;
            }
            this.setTint(this.mainColor);
        } else {
            this.mainColor = 0xaaaaaa;
            this.setTint(0xaaaaaa);
        }
    }

    drawVisual(physicsType, radius) {
        if (!this.visualGraphics) return;

        this.visualGraphics.clear();

        // Get color from elements
        const color = this.mainColor || 0xaaaaaa;

        if (physicsType === 'SHARP') {
            // Sharp - draw a pointed shape
            this.visualGraphics.fillStyle(color, 0.9);
            this.visualGraphics.beginPath();
            this.visualGraphics.moveTo(0, -radius * 1.5);
            this.visualGraphics.lineTo(radius * 0.4, radius * 0.5);
            this.visualGraphics.lineTo(-radius * 0.4, radius * 0.5);
            this.visualGraphics.closePath();
            this.visualGraphics.fillPath();

            // Inner glow
            this.visualGraphics.fillStyle(0xffffff, 0.4);
            this.visualGraphics.fillCircle(0, -radius * 0.5, radius * 0.2);
        } else {
            // BLUNT - draw circle that EXACTLY matches physics radius
            // Outer glow
            this.visualGraphics.fillStyle(color, 0.3);
            this.visualGraphics.fillCircle(0, 0, radius * 1.2);

            // Main circle - EXACT hitbox size
            this.visualGraphics.fillStyle(color, 0.9);
            this.visualGraphics.fillCircle(0, 0, radius);

            // Inner highlight
            this.visualGraphics.fillStyle(0xffffff, 0.4);
            this.visualGraphics.fillCircle(-radius * 0.2, -radius * 0.2, radius * 0.4);

        }
    }

    setupTrail(scene) {
        // Trail properties based on physics type and speed
        const trailScale = this.physics === 'SHARP' ? 0.2 : 0.4;
        const trailLife = this.physics === 'SHARP' ? 150 : 250;

        // Calculate frequency based on speed (faster = more particles)
        const velocity = Math.sqrt(
            (this.projectileData.vel?.x || 0) ** 2 +
            (this.projectileData.vel?.y || 0) ** 2
        );
        const frequency = Math.min(100, Math.max(20, velocity / 10));

        // Trail emitter with element-based color
        this.trailEmitter = scene.add.particles(0, 0, 'particle', {
            speed: { min: 10, max: 30 },
            scale: { start: trailScale, end: 0 },
            alpha: { start: 0.7, end: 0 },
            lifespan: trailLife,
            tint: this.mainColor || 0xffffff,
            blendMode: 'ADD',
            emitting: true,
            follow: this,
            frequency: frequency
        });

        // Add glow effect for powerful projectiles
        if (this.power > 75) {
            this.glow = scene.add.circle(0, 0, this.projectileData.radius * 2, this.mainColor, 0.2);
            this.glow.setBlendMode(Phaser.BlendModes.ADD);
            this.glow.setDepth(this.depth - 0.1);
        }
    }

    update(time, delta) {
        // Never update a projectile whose body/scene have been destroyed.
        if (!this.isAlive()) return;

        // A body with a non-finite position/velocity has been poisoned (NaN) and
        // would corrupt every subsequent physics step. Kill it before it spreads.
        const bvel = this.body.velocity;
        if (!Number.isFinite(this.x) || !Number.isFinite(this.y) ||
            !Number.isFinite(bvel.x) || !Number.isFinite(bvel.y)) {
            this.die();
            return;
        }

        const dt = delta / 1000;

        // Update activation delay
        if (this.activationDelay > 0) {
            this.activationDelay -= dt;
        }

        // Track distance traveled
        const dx = this.x - this.startPos.x;
        const dy = this.y - this.startPos.y;
        this.distanceTraveled = Math.sqrt(dx * dx + dy * dy);

        // Check if max distance reached
        if (this.distanceTraveled >= this.maxDistance) {
            this.die();
            return;
        }

        // Lifetime
        this.lifetime -= dt;
        if (this.lifetime <= 0) {
            this.die();
            return;
        }

        // Rotation to face movement direction
        const vel = this.body.velocity;
        if (vel.x !== 0 || vel.y !== 0) {
            this.setRotation(Math.atan2(vel.y, vel.x) + Math.PI / 2);

            // Also rotate visual graphics for SHARP projectiles
            if (this.visualGraphics && this.physics === 'SHARP') {
                this.visualGraphics.setRotation(Math.atan2(vel.y, vel.x) + Math.PI / 2);
            }
        }

        // Update glow position
        if (this.glow) {
            this.glow.setPosition(this.x, this.y);
        }

        // Update visual graphics position to follow physics body
        if (this.visualGraphics) {
            this.visualGraphics.setPosition(this.x, this.y);
        }

        // BLUNT push mechanics - ALL BLUNT projectiles push (not just Earth)
        if (this.physics === 'BLUNT') {
            this.pushEntitiesOnPath();

            // Earth-specific: contact damage (sustained pushing damage)
            if (this.hasElement('Earth')) {
                this.applyEarthContactDamage(dt);
            }
        }

    }

    hasElement(element) {
        return this.elements.includes(element);
    }

    pushEntitiesOnPath() {
        if (!this.isAlive()) return;

        // Clear previous contacts
        this.earthContactEntities.clear();

        // === MASS-BASED PUSH SYSTEM ===
        // Projectile mass is based on power (power = mass for projectiles)
        // Push effectiveness = projectileMass / entityMass
        // Low power can't push heavy entities effectively
        const projectileMass = this.power;
        const basePushForce = Config.Effects.Earth.pushForce * 0.0001;

        // Push enemies in contact
        for (let enemy of this.scene.enemies) {
            const dist = Phaser.Math.Distance.Between(this.x, this.y, enemy.x, enemy.y);
            const combinedRadius = (this.projectileData.radius || 10) * Config.Effects.Earth.pushRadius + 20;

            if (dist < combinedRadius) {
                // Track entity for contact damage
                this.earthContactEntities.add(enemy);

                // Get entity mass (default 50 if not set)
                const entityMass = enemy.mass || 50;

                // Calculate mass ratio (how effectively can we push)
                // ratio > 1 means projectile is heavier, can push easily
                // ratio < 1 means entity is heavier, hard to push
                // ratio < 0.3 means can barely push at all
                const massRatio = projectileMass / entityMass;

                // Push effectiveness: 0 if massRatio < 0.2, scales up to full at massRatio >= 2
                const pushEffectiveness = Math.max(0, Math.min(1, (massRatio - 0.2) / 1.8));

                // Skip if can't push effectively
                if (pushEffectiveness <= 0) continue;

                const dir = {
                    x: enemy.x - this.x,
                    y: enemy.y - this.y
                };
                const mag = Math.sqrt(dir.x * dir.x + dir.y * dir.y) || 1;
                dir.x /= mag;
                dir.y /= mag;

                // Apply push force scaled by mass ratio
                const actualPushForce = basePushForce * pushEffectiveness;
                enemy.applyForce({
                    x: dir.x * actualPushForce,
                    y: dir.y * actualPushForce
                });

                // Push particles - more for effective pushes
                if (Math.random() < 0.3 * pushEffectiveness) {
                    this.scene.spawnParticles(enemy.x, enemy.y, this.mainColor || 0x80C060, 2);
                }

                // Slow down projectile based on how much mass we're pushing
                // Heavier entities slow us more
                if (massRatio < 2) {
                    const slowFactor = 1 - (0.02 * (entityMass / projectileMass));
                    const vel = this.body.velocity;
                    this.setVelocity(vel.x * slowFactor, vel.y * slowFactor);
                }
            }
        }

        // Also check player for self-push (if has left owner)
        const player = this.scene.player;
        if (player && this.caster === player && this.distanceTraveled > 50) {
            const dist = Phaser.Math.Distance.Between(this.x, this.y, player.x, player.y);
            const combinedRadius = (this.projectileData.radius || 10) * Config.Effects.Earth.pushRadius + player.rad;

            if (dist < combinedRadius) {
                this.earthContactEntities.add(player);

                const playerMass = player.mass || 60;
                const massRatio = projectileMass / playerMass;
                const pushEffectiveness = Math.max(0, Math.min(1, (massRatio - 0.2) / 1.8));

                if (pushEffectiveness > 0) {
                    const dir = {
                        x: player.x - this.x,
                        y: player.y - this.y
                    };
                    const mag = Math.sqrt(dir.x * dir.x + dir.y * dir.y) || 1;
                    dir.x /= mag;
                    dir.y /= mag;

                    // Reduced push for player
                    const playerPushForce = basePushForce * pushEffectiveness * 300;
                    player.setVelocity(
                        player.body.velocity.x + dir.x * playerPushForce,
                        player.body.velocity.y + dir.y * playerPushForce
                    );
                }
            }
        }
    }

    /**
     * Apply continuous contact damage to entities being pushed by Earth BLUNT
     */
    applyEarthContactDamage(dt) {
        if (!this.isAlive()) return;
        if (this.earthContactEntities.size === 0) return;

        this.earthDamageTick += dt;

        // Apply damage every 0.5 seconds (faster than original for more feedback)
        if (this.earthDamageTick >= 0.5) {
            this.earthDamageTick = 0;
            const damage = Config.Effects.Earth.contactDamage;

            for (let entity of this.earthContactEntities) {
                // Skip if entity has no hp or is player who is dashing
                if (entity.hp === undefined) continue;
                if (entity === this.scene.player && entity.isDashing) continue;

                // Reduced damage for self-hit
                const actualDamage = entity === this.caster ? damage * 0.5 : damage;

                // Apply damage
                if (entity.takeDamage) {
                    entity.takeDamage(actualDamage);
                } else {
                    entity.hp -= actualDamage;
                }

                // Damage particles - earth colored
                this.scene.spawnParticles(entity.x, entity.y, 0x80C060, 3);

                // Check death for enemies
                if (entity.hp <= 0 && entity.respawn) {
                    entity.respawn();
                }
            }
        }
    }

    onHitEnemy(enemy) {
        // Dead projectiles (already destroyed this step) must not run hit logic;
        // reading this.body.velocity below would throw and freeze the loop.
        if (!this.isAlive() || !enemy) return;

        // === BLUNT vs SHARP behavior ===
        // BLUNT: pushes enemies, reduced damage, doesn't die on hit (passes through)
        // SHARP: pierces enemies, full damage
        const isBluntProjectile = this.physics === 'BLUNT';
        const isOverwhelm = this.power > Config.OverwhelmThreshold && !isBluntProjectile;

        // Check pierce (projectile continues if has pierce remaining or overwhelms or is BLUNT)
        if (this.pierceRemaining > 0) {
            this.pierceRemaining--;
        } else if (!isOverwhelm && !isBluntProjectile) {
            // No pierce and no overwhelm and not BLUNT - projectile dies
            this.die();
            return;
        }

        // Apply damage based on projectile type
        // Earth BLUNT uses contact damage system instead of hit damage
        const isEarthBlunt = this.hasElement('Earth') && isBluntProjectile;

        if (!isEarthBlunt) {
            let dmg = this.damage;

            // BLUNT deals 70% damage (trades damage for push)
            if (isBluntProjectile) {
                dmg *= 0.7;
            }

            // Pierce projectiles do reduced damage to subsequent targets
            if (this.projectileData.pierce > 0 && this.pierceRemaining < this.projectileData.pierce) {
                const pierced = this.projectileData.pierce - this.pierceRemaining;
                dmg *= Math.pow(0.8, pierced);
            }

            // Calculate knockback direction
            const vel = this.body.velocity;
            const mag = Math.sqrt(vel.x * vel.x + vel.y * vel.y) || 1;
            const knockbackDir = { x: vel.x / mag, y: vel.y / mag };

            // BLUNT projectiles have stronger knockback
            const knockbackMult = isBluntProjectile ? 1.5 : 0.5;
            enemy.takeDamage(dmg, knockbackDir, this.power * knockbackMult);
        }

        // Apply elemental effects to ALL projectiles
        this.applyElementalEffects(enemy);

        // === VISUAL FEEDBACK ===
        // Hit particles (more for higher damage)
        const hitParticles = Math.min(15, 5 + Math.floor(this.damage / 10));
        this.scene.spawnParticles(enemy.x, enemy.y, this.mainColor || this.tintTopLeft, hitParticles);

        // Camera shake on hit (subtle, based on power)
        if (this.power > 30) {
            const shakeAmount = Math.min(0.005, this.power * 0.00005);
            this.scene.cameras.main.shake(60, shakeAmount);
        }
    }

    applyElementalEffects(target) {
        if (!this.isAlive() || !target) return;

        for (let element of this.elements) {
            switch (element) {
                case 'Fire':
                    target.applyEffect('burn', {
                        damage: Config.Effects.Fire.burnDamage + (this.power * 0.2),
                        duration: Config.Effects.Fire.burnDuration + (this.power * 0.05)
                    });
                    break;

                case 'Water':
                    let slowAmt = Config.Effects.Water.slowAmount + (this.power * 0.02);
                    if (slowAmt > 0.9) slowAmt = 0.9;
                    target.applyEffect('slow', {
                        amount: slowAmt,
                        duration: Config.Effects.Water.slowDuration + (this.power * 0.1)
                    });
                    break;

                case 'Air':
                    // Knockback
                    const vel = this.body.velocity;
                    const mag = Math.sqrt(vel.x * vel.x + vel.y * vel.y) || 1;
                    const dir = { x: vel.x / mag, y: vel.y / mag };
                    const force = Config.Effects.Air.propelForce + (this.power * Config.Effects.Air.propelPowerScale);

                    target.applyForce({
                        x: dir.x * force * 0.0001,
                        y: dir.y * force * 0.0001
                    });
                    break;
            }
        }
    }

    activate() {
        // Guard the remote-trigger entry point. This runs inside the rAF game
        // step (right-click input handler), so any throw here freezes the game.
        if (!this.isAlive()) return;
        if (this.activationDelay > 0) return;
        if (!this.payload || this.payload.length === 0) return;

        this.isActive = true;

        try {
            // Spawn payload projectiles with proper spectrum calculation
            let shardIndex = 0;
            for (let payloadData of this.payload) {
                // Calculate spawn direction (from current velocity + relative angle)
                const vel = this.body.velocity;
                const baseAngle = Math.atan2(vel.y, vel.x);
                const finalAngle = baseAngle + (payloadData.relAngle || 0);

                // === SPECTRUM CALCULATION AT ACTIVATION TIME ===
                // Use inheritedPower and circleRadius from payload data
                const inheritedPower = payloadData.inheritedPower || this.power;
                const circleRadius = payloadData.circleRadius || 30;
                const spectrum = this.getSpellSpectrum(inheritedPower, circleRadius);
                const spectrumConfig = Config.SpellSpectrum.effects[spectrum] || {};

                // Size thresholds matching GameScene
                const LARGE_THRESHOLD = 60;
                const WEAK_THRESHOLD = 100;
                const STRONG_THRESHOLD = 200;

                // Big circles are ALWAYS BLUNT, regardless of spectrum
                const isBigCircle = circleRadius >= LARGE_THRESHOLD;
                const isPiercing = !isBigCircle && ['NEEDLE', 'LANCE', 'BEAM'].includes(spectrum);
                const physics = isPiercing ? 'SHARP' : 'BLUNT';
                const damage = payloadData.hasMorePayloads ? 10 : (payloadData.baseDamage || 10) * (spectrumConfig.damage || 1);

                // Base speed from spectrum
                let speed = spectrumConfig.speed || 600;

                // For BLUNT: more power = SLOWER
                if (physics === 'BLUNT' && inheritedPower > WEAK_THRESHOLD) {
                    const powerFactor = Math.min(1, (inheritedPower - WEAK_THRESHOLD) / (STRONG_THRESHOLD - WEAK_THRESHOLD));
                    speed *= (1.0 - powerFactor * 0.5); // 50% slower at max power
                }

                // Projectile radius - SAME calculation as main spell (rad / 2)
                let projRadius;
                if (isPiercing) {
                    projRadius = Math.max(5, 8 * (spectrumConfig.visualScale || 1));
                } else {
                    // Use same formula as GameScene.castSpell: circleRadius / 2
                    projRadius = Math.max(10, (circleRadius / 2) * (spectrumConfig.visualScale || 1));
                }

                // Sanitize velocity: a non-finite value here would put a NaN into a
                // Matter body and wedge the physics solver (a hard freeze).
                let vx = Math.cos(finalAngle) * speed;
                let vy = Math.sin(finalAngle) * speed;
                if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
                    vx = 0;
                    vy = -(speed || 600);
                }

                // Spread shards out from the parent along their heading. Spawning
                // every shard at the exact same point creates perfectly coincident
                // Matter bodies whose collision normal is NaN -> frozen simulation.
                const spawnGap = projRadius + 6 + shardIndex * 3;
                const spawnX = this.x + Math.cos(finalAngle) * spawnGap;
                const spawnY = this.y + Math.sin(finalAngle) * spawnGap;

                const newData = {
                    elements: this.elements,
                    spectrum: spectrum,
                    physics: physics,
                    damage: damage,
                    pierce: spectrumConfig.pierce || 0,
                    radius: projRadius,
                    vel: { x: vx, y: vy },
                    power: inheritedPower,
                    caster: this.caster,
                    payload: payloadData.nestedPayload || null
                };

                new ProjectileSprite(this.scene, spawnX, spawnY, newData);
                shardIndex++;
            }
        } catch (err) {
            // One malformed payload shard must not take the whole game down.
            console.warn('ProjectileSprite.activate recovered from error:', err);
        }

        // Die after activating
        this.die();
    }

    getSpellSpectrum(power, radius) {
        const ratio = power / Math.max(1, radius);
        const cfg = Config.SpellSpectrum;

        if (ratio >= cfg.thresholds.needle) return 'NEEDLE';
        if (ratio >= cfg.thresholds.lance) return 'LANCE';
        if (ratio >= cfg.thresholds.beam) return 'BEAM';
        if (ratio >= cfg.thresholds.dart) return 'DART';
        if (ratio >= cfg.thresholds.wave) return 'WAVE';
        if (ratio >= cfg.thresholds.burst) return 'BURST';
        if (ratio >= cfg.thresholds.boulder) return 'BOULDER';

        return 'CANNON';
    }

    die() {
        // Idempotent: a projectile can be killed by several systems in the same
        // step (collision + lifetime, two collision pairs, ...). Running the
        // teardown twice would touch already-destroyed objects and throw.
        if (this.isDead) return;
        this.isDead = true;

        // Death particles + lingering effect (needs scene/position - do it first,
        // before super.destroy() clears them). Wrapped so FX errors can't abort
        // the cleanup below and leak the body/emitters.
        try {
            if (this.scene) {
                const particleCount = Math.min(15, 4 + Math.floor(this.power / 30));
                this.scene.spawnParticles(this.x, this.y, this.mainColor || this.tintTopLeft, particleCount);
                this.spawnDeathEffect();
            }
        } catch (err) {
            console.warn('ProjectileSprite death FX failed:', err);
        }

        // Remove from game state
        const idx = GameState.projectiles.indexOf(this);
        if (idx !== -1) {
            GameState.projectiles.splice(idx, 1);
        }

        // Clean up trail
        if (this.trailEmitter) {
            try { this.trailEmitter.destroy(); } catch (e) { /* already gone */ }
            this.trailEmitter = null;
        }

        // Clean up glow
        if (this.glow) {
            try { this.glow.destroy(); } catch (e) { /* already gone */ }
            this.glow = null;
        }

        // Clean up visual graphics
        if (this.visualGraphics) {
            try { this.visualGraphics.destroy(); } catch (e) { /* already gone */ }
            this.visualGraphics = null;
        }

        // Remove the physics body before destroying the GameObject so Phaser's
        // own destroy() doesn't try to remove an already-removed body.
        if (this.body && this.scene && this.scene.matter) {
            try { this.scene.matter.world.remove(this.body); } catch (e) { /* already removed */ }
        }
        this.body = null;

        try { super.destroy(); } catch (e) { /* already destroyed */ }
    }

    /**
     * Spawn a lingering death effect that scales with projectile size
     * Bigger projectiles create larger, more dramatic effects lasting 1-2 seconds
     */
    spawnDeathEffect() {
        if (!this.scene) return;

        const radius = this.collisionRadius || 10;
        const color = this.mainColor || 0xaaaaaa;

        // Scale effect size based on projectile radius
        // Small (10): base size, Big (80+): much larger
        const effectScale = Math.max(1, radius / 15);
        const baseEffectRadius = radius * 1.5;

        // Duration scales with size: 1000ms for small, up to 2000ms for large
        const duration = Math.min(2000, 1000 + radius * 12);

        // Create outer shockwave ring
        const shockwave = this.scene.add.circle(this.x, this.y, baseEffectRadius * 0.5, color, 0);
        shockwave.setStrokeStyle(Math.max(2, radius * 0.15), color, 0.8);
        shockwave.setBlendMode(Phaser.BlendModes.ADD);
        shockwave.setDepth(90);

        this.scene.tweens.add({
            targets: shockwave,
            radius: baseEffectRadius * 3,
            alpha: 0,
            duration: duration,
            ease: 'Power2',
            onUpdate: (tween) => {
                const progress = tween.progress;
                const newRadius = baseEffectRadius * 0.5 + (baseEffectRadius * 2.5 * progress);
                shockwave.setRadius(newRadius);
                shockwave.setStrokeStyle(Math.max(1, radius * 0.15 * (1 - progress)), color, 0.8 * (1 - progress));
            },
            onComplete: () => shockwave.destroy()
        });

        // Create inner glow that fades
        const innerGlow = this.scene.add.circle(this.x, this.y, baseEffectRadius, color, 0.5);
        innerGlow.setBlendMode(Phaser.BlendModes.ADD);
        innerGlow.setDepth(89);

        this.scene.tweens.add({
            targets: innerGlow,
            alpha: 0,
            scale: 0.3,
            duration: duration * 0.8,
            ease: 'Power3',
            onComplete: () => innerGlow.destroy()
        });

        // For big projectiles (radius > 30), add extra lingering particles
        if (radius > 30) {
            const extraParticles = Math.floor(radius / 10);
            for (let i = 0; i < extraParticles; i++) {
                const angle = (Math.PI * 2 / extraParticles) * i;
                const dist = baseEffectRadius * 0.5;
                const px = this.x + Math.cos(angle) * dist;
                const py = this.y + Math.sin(angle) * dist;

                const spark = this.scene.add.circle(px, py, 3 + radius * 0.05, color, 0.7);
                spark.setBlendMode(Phaser.BlendModes.ADD);
                spark.setDepth(91);

                this.scene.tweens.add({
                    targets: spark,
                    x: px + Math.cos(angle) * baseEffectRadius * 2,
                    y: py + Math.sin(angle) * baseEffectRadius * 2,
                    alpha: 0,
                    scale: 0.2,
                    duration: duration * 0.9,
                    ease: 'Power2',
                    delay: i * 30,
                    onComplete: () => spark.destroy()
                });
            }
        }

        // For very large projectiles (radius > 60), add a ground scorch mark
        if (radius > 60) {
            const scorch = this.scene.add.circle(this.x, this.y, baseEffectRadius * 0.8, 0x000000, 0.3);
            scorch.setDepth(5); // Below most things

            this.scene.tweens.add({
                targets: scorch,
                alpha: 0,
                duration: duration * 1.5,
                ease: 'Linear',
                onComplete: () => scorch.destroy()
            });
        }
    }
}

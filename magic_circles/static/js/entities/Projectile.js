/**
 * Projectile - Magic projectile entity
 * 
 * Projectiles can hit: enemies, other projectiles, obstacles, objects, and even the caster.
 * Power determines max travel distance (separate from visual size).
 * 
 * SPECTRUM SYSTEM:
 * - Pierce: NEEDLE/LANCE/BEAM can pass through multiple enemies
 * - Push: BOULDER spectrum pushes entities (even without Earth element)
 * - Explosion: BURST/CANNON/NOVA create AoE on impact
 */
class Projectile extends Entity {
    constructor(x, y, data) {
        super(x, y, data.rad, '#fff');
        this.data = data;

        // Spectrum tracking
        this.spectrum = data.spectrum || 'DART';

        // Pierce counter - how many more enemies this can pass through
        this.pierceRemaining = data.pierce || 0;

        // Use longer life for Earth BLUNT or BOULDER spectrum projectiles
        let isEarthBlunt = data.elements && data.elements.includes('Earth') && data.physics === 'BLUNT';
        let isBoulder = this.spectrum === 'BOULDER';
        this.life = (isEarthBlunt || isBoulder) ? Config.Effects.Earth.projectileLife : Config.ProjectileLife;

        // Power and distance tracking
        this.power = data.power || Config.BasePower;
        this.maxDistance = this.power * Config.PowerDistanceRatio;
        this.spawnPos = new Vec2(x, y);
        this.distanceTraveled = 0;

        // Owner tracking (to allow self-hit after leaving safe zone)
        this.owner = data.owner || null;
        this.hasLeftOwner = false; // Becomes true once projectile is far enough from owner

        // Earth BLUNT / BOULDER specific - contact damage tracking
        this.earthDamageTick = 0; // Timer for contact damage
        this.earthContactEntities = new Set(); // Entities currently in contact

        // Color based on primary element
        let last = data.elements[data.elements.length - 1];
        this.col = Config[last] || '#fff';
        if (data.elements.length === 0) this.col = '#aaa';
    }


    update(dt) {
        let prevPos = this.pos;
        this.pos = this.pos.add(this.data.vel.mul(dt * Game.timeScale));

        // Track distance traveled
        this.distanceTraveled = this.spawnPos.dist(this.pos);

        // Check if projectile has left the owner's vicinity (safe zone)
        if (this.owner && !this.hasLeftOwner) {
            let distFromOwner = this.pos.dist(this.owner.pos);
            // Once projectile is beyond owner radius + its own radius, it can hit owner
            if (distFromOwner > this.owner.rad + this.rad + 5) {
                this.hasLeftOwner = true;
            }
        }

        // --- EARTH BLUNT or BOULDER SPECTRUM: Push entities on path ---
        let hasEarthBlunt = this.hasElement('Earth') && this.data.physics === 'BLUNT';
        let isBoulderSpectrum = this.spectrum === 'BOULDER';

        if (hasEarthBlunt || isBoulderSpectrum) {
            this.pushEntitiesOnPath(dt);
            this.applyEarthContactDamage(dt);

            // Check if projectile has stopped (hit something too heavy or slowed to stop)
            if (this.data.vel.mag() < 1) {
                this.dead = true;
                for (let i = 0; i < 6; i++) {
                    Game.parts.push(new Particle(this.pos.x, this.pos.y, this.col));
                }
                return;
            }
        }

        // Die if exceeded max distance
        if (this.distanceTraveled >= this.maxDistance) {
            this.dead = true;
            // Fizzle out particles
            for (let i = 0; i < 5; i++) {
                Game.parts.push(new Particle(this.pos.x, this.pos.y, this.col));
            }
            return;
        }

        this.life -= dt * Game.timeScale;
        if (this.life <= 0) this.dead = true;

        // Particle trail
        if (Math.random() > 0.5) {
            let p = new Particle(this.pos.x, this.pos.y, this.col);
            if (this.data.physics === 'SHARP') p.rad = 1;
            Game.parts.push(p);
        }
    }

    /**
     * Check if projectile has a specific element
     */
    hasElement(element) {
        return this.data.elements && this.data.elements.includes(element);
    }

    /**
     * EARTH: Push entities on path (BLUNT only)
     * - Pushes entities based on weight
     * - Deals continuous damage while in contact
     * - Slows down based on total weight encountered
     * - Stops if slowed below threshold or hits something too heavy
     */
    pushEntitiesOnPath(dt) {
        // Use exact radius for physical push, but add small buffer for detection
        // If projectile is huge (High Power), the push radius should match correctly
        let detectionRadius = Math.max(this.rad + 20, this.rad * 1.2);
        let pushRadius = this.rad; // Physical push size

        let maxWeight = this.power * Config.Effects.Earth.weightDenialPerPower;
        let currentSpeed = this.data.vel.mag();

        // Get push direction - use last known direction if velocity is zero
        let pushDir;
        if (currentSpeed > 1) {
            pushDir = this.data.vel.norm();
            this._lastPushDir = pushDir; // Store for later
        } else if (this._lastPushDir) {
            pushDir = this._lastPushDir;
        } else {
            // Fallback: use direction from spawn to current position
            let fromSpawn = this.pos.sub(this.spawnPos);
            if (fromSpawn.mag() > 1) {
                pushDir = fromSpawn.norm();
            } else {
                pushDir = new Vec2(1, 0); // Default right
            }
        }

        let totalWeightEncountered = 0;
        this.earthContactEntities.clear();

        // Check enemies
        for (let e of Game.enemies) {
            let dist = this.pos.dist(e.pos);
            if (dist < pushRadius + e.rad) {
                this.earthContactEntities.add(e);

                // If too heavy, stop the projectile entirely
                if (e.rad > maxWeight) {
                    this.data.vel = new Vec2(0, 0);
                    // Big impact effect
                    for (let i = 0; i < 10; i++) {
                        Game.parts.push(new Particle(this.pos.x, this.pos.y, Config.Earth));
                    }
                    return;
                }

                // Add to weight encountered (affects slowdown)
                totalWeightEncountered += e.rad;

                // Push entity away from projectile center
                let toEntity = e.pos.sub(this.pos);
                if (toEntity.mag() < 1) toEntity = pushDir; // Directly overlapping
                toEntity = toEntity.norm();

                // Calculate push force based on weight ratio
                let weightRatio = 1 - (e.rad / maxWeight);
                let pushForce = Config.Effects.Earth.pushForce * Math.max(0.3, weightRatio);

                // Push away from projectile AND in travel direction
                e.vel = e.vel.add(toEntity.mul(pushForce * 0.7));
                e.vel = e.vel.add(pushDir.mul(pushForce * 0.5));

                // Visual feedback - particles
                for (let i = 0; i < 3; i++) {
                    let pp = new Particle(e.pos.x, e.pos.y, Config.Earth);
                    pp.vel = toEntity.mul(150);
                    Game.parts.push(pp);
                }
            }
        }

        // Check player (if can hit)
        if (this.canHit(Game.player)) {
            let dist = this.pos.dist(Game.player.pos);
            if (dist < pushRadius + Game.player.rad) {
                this.earthContactEntities.add(Game.player);

                // If player too heavy, stop projectile
                if (Game.player.rad > maxWeight) {
                    this.data.vel = new Vec2(0, 0);
                    for (let i = 0; i < 10; i++) {
                        Game.parts.push(new Particle(this.pos.x, this.pos.y, Config.Earth));
                    }
                    return;
                }

                totalWeightEncountered += Game.player.rad;

                // Push player away from projectile center
                let toEntity = Game.player.pos.sub(this.pos);
                if (toEntity.mag() < 1) toEntity = pushDir;
                toEntity = toEntity.norm();

                let pushForce = Config.Effects.Earth.pushForce * 0.5; // Reduced self-push
                Game.player.vel = Game.player.vel.add(toEntity.mul(pushForce * 0.7));
                Game.player.vel = Game.player.vel.add(pushDir.mul(pushForce * 0.3));

                for (let i = 0; i < 3; i++) {
                    let pp = new Particle(Game.player.pos.x, Game.player.pos.y, Config.Earth);
                    pp.vel = toEntity.mul(150);
                    Game.parts.push(pp);
                }
            }
        }

        // Slow down projectile based on weight encountered
        if (totalWeightEncountered > 0) {
            let slowdown = totalWeightEncountered * Config.Effects.Earth.slowdownPerWeight;
            let newSpeed = Math.max(0, currentSpeed - slowdown);

            // Check if projectile should stop
            if (newSpeed < Config.Effects.Earth.stopThreshold) {
                this.data.vel = new Vec2(0, 0);
                // Stopped effect
                for (let i = 0; i < 8; i++) {
                    Game.parts.push(new Particle(this.pos.x, this.pos.y, Config.Earth));
                }
            } else {
                // Apply slowdown
                this.data.vel = pushDir.mul(newSpeed);
            }
        }
    }

    /**
     * EARTH BLUNT: Apply contact damage to entities being pushed
     */
    applyEarthContactDamage(dt) {
        if (!this.hasElement('Earth') || this.data.physics !== 'BLUNT') return;
        if (this.earthContactEntities.size === 0) return;

        this.earthDamageTick += dt;

        // Apply damage every second
        if (this.earthDamageTick >= 1.0) {
            this.earthDamageTick = 0;
            let damage = Config.Effects.Earth.contactDamage;

            for (let entity of this.earthContactEntities) {
                if (entity.hp !== undefined) {
                    // Skip damage if player is dashing (invincible)
                    if (entity === Game.player && entity.isDashing) continue;

                    let actualDamage = entity === this.owner ? damage * 0.5 : damage;
                    entity.hp -= actualDamage;

                    // Damage indicator particles
                    for (let i = 0; i < 4; i++) {
                        let dp = new Particle(entity.pos.x, entity.pos.y, '#ff8800');
                        dp.vel = Vec2.fromAngle(Math.random() * Math.PI * 2).mul(100);
                        Game.parts.push(dp);
                    }

                    if (entity.hp <= 0 && entity.respawn) {
                        entity.respawn();
                    }
                }
            }
        }
    }

    /**
     * Check if this projectile can hit a target entity
     */
    canHit(entity) {
        // Can always hit non-owner entities
        if (entity !== this.owner) return true;
        // Can hit owner only if projectile has left the safe zone 
        // OR if projectile is oversized (radius > spawn offset)
        return this.hasLeftOwner || this.rad > Config.ProjectileSpawnOffset;
    }

    /**
     * Activate payload (Remote Detonation)
     * Spawns projectiles from the current payload, each carrying their own nested payload
     * 
     * SPECTRUM SYSTEM: Spectrum is calculated NOW using inherited power + stored radius
     * This creates dynamic multi-stage combos (e.g., CANNON -> NEEDLE shards)
     */
    activate() {
        if (!this.data.payload || this.data.payload.length === 0) return;

        let payloadCount = this.data.payload.length;

        this.data.payload.forEach(shardData => {
            let currentAngle = this.data.vel.angle();
            let offset = shardData.relAngle;
            let finalAngle = currentAngle + offset;

            // Calculate spectrum NOW using inherited power + stored radius
            // Use stored power from buildPayloadChain, or fall back to remaining distance calculation
            let childPower;
            if (shardData.inheritedPower) {
                childPower = shardData.inheritedPower;
            } else {
                // Legacy fallback
                let remainingDistance = this.maxDistance - this.distanceTraveled;
                childPower = Math.max((remainingDistance / Config.PowerDistanceRatio) / payloadCount, Config.BasePower / 2);
            }

            // Calculate spectrum based on power and circle radius
            let spectrum = getSpellSpectrum(childPower, shardData.circleRadius || 30);
            let spectrumConfig = Config.SpellSpectrum.effects[spectrum];

            // Physics based on spectrum (piercing types are SHARP)
            let isPiercing = ['NEEDLE', 'LANCE', 'BEAM'].includes(spectrum);
            let physics = isPiercing ? 'SHARP' : 'BLUNT';

            // Velocity from spectrum config
            let vel = Vec2.fromAngle(finalAngle).mul(spectrumConfig.speed);

            // Calculate projectile radius
            let projRadius;
            if (isPiercing) {
                projRadius = Math.max(4, 8 * spectrumConfig.visualScale);
            } else {
                projRadius = ((shardData.circleRadius || 30) / 3) * spectrumConfig.visualScale;
            }

            // Calculate damage with spectrum modifier AND power scaling
            let baseDamage = shardData.baseDamage || shardData.damage || 10;
            // Scale damage with childPower
            let powerDamageBonus = childPower * 0.5; // +0.5 damage per power
            let finalDamage = (shardData.hasMorePayloads ? 10 : baseDamage * spectrumConfig.damage) + powerDamageBonus;

            Game.projectiles.push(new Projectile(this.pos.x, this.pos.y, {
                elements: this.data.elements,
                spectrum: spectrum,
                physics: physics,
                damage: finalDamage,
                pierce: spectrumConfig.pierce + Math.floor(childPower / 20), // Add pierce for high power
                rad: projRadius,
                vel: vel,
                power: childPower,
                owner: this.owner, // Inherit owner
                // Pass the nested payload for the NEXT right-click
                payload: shardData.nestedPayload || null
            }));
        });

        this.dead = true;

        // Detonation FX
        for (let i = 0; i < 8; i++) {
            Game.parts.push(new Particle(this.pos.x, this.pos.y, '#fff'));
        }
    }

    /**
     * Custom render for projectiles
     * SHARP: Pointed spike shape (smaller = sharper)
     * BLUNT: Circle shape
     */
    render(ctx, cam) {
        let sx = this.pos.x - cam.x + canvas.width / 2;
        let sy = this.pos.y - cam.y + canvas.height / 2;

        ctx.save();
        ctx.translate(sx, sy);

        // Rotate to face movement direction
        let angle = Math.atan2(this.data.vel.y, this.data.vel.x);
        ctx.rotate(angle);

        if (this.data.physics === 'SHARP') {
            // Calculate sharpness based on radius
            // Smaller radius = sharper point (longer spike)
            // Larger radius = more rounded (approaches circle)
            let sharpness = Math.max(0.2, 1 - (this.rad / Config.SharpRadiusThreshold));
            let pointLength = this.rad * (2 + sharpness * 3); // Length of the spike
            let baseWidth = this.rad * (0.5 + (1 - sharpness) * 0.8); // Width at base

            ctx.beginPath();
            // Point at front
            ctx.moveTo(pointLength, 0);
            // Back curves
            ctx.lineTo(-this.rad * 0.5, -baseWidth);
            ctx.quadraticCurveTo(-this.rad * 0.3, 0, -this.rad * 0.5, baseWidth);
            ctx.closePath();

            // Fill with gradient - mostly color, white tip only
            let gradient = ctx.createLinearGradient(-this.rad, 0, pointLength, 0);
            gradient.addColorStop(0, this.col);        // Base: element color
            gradient.addColorStop(0.6, this.col);      // Keep color through 60%
            gradient.addColorStop(0.85, '#ffffff88');  // Transition to semi-white
            gradient.addColorStop(1, '#fff');          // Tip: pure white
            ctx.fillStyle = gradient;
            ctx.fill();

            // Outline
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();
        } else {
            // BLUNT - draw as circle
            ctx.beginPath();
            ctx.arc(0, 0, this.rad, 0, Math.PI * 2);
            ctx.fillStyle = this.col;
            ctx.fill();

            // Inner glow for blunt
            ctx.beginPath();
            ctx.arc(0, 0, this.rad * 0.6, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.fill();
        }

        ctx.restore();
        return new Vec2(sx, sy);
    }
}

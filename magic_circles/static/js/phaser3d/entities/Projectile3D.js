/**
 * Projectile3D.js
 *
 * Magic projectile entity for the Enable3D / Three.js scene.
 * Ported from ProjectileSprite.js (Matter.js 2D) to the custom CollisionWorld
 * physics engine on the XZ plane.
 *
 * Coordinate mapping: 2D (x, y) → 3D (x, height, z)  with z = 2D-y.
 * Projectiles fly at a fixed height: W3D.H.PROJECTILE (= 22).
 *
 * Globals assumed at runtime (plain-script style, no modules):
 *   THREE, ENABLE3D, Config, GameState, ModelFactory,
 *   CollisionWorld (with CAT_* statics), W3D
 */

// ---------------------------------------------------------------------------
// Module-level helper: safe 2D normalise on XZ components
// Returns (0, 0) rather than NaN when the vector has zero length.
// ---------------------------------------------------------------------------
function _norm3D(vx, vz) {
    const len = Math.hypot(vx, vz);
    if (len < 1e-9) return { x: 0, z: 0 };
    return { x: vx / len, z: vz / len };
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

class Projectile3D {

    /**
     * @param {object} scene  GameScene3D instance
     * @param {number} x2d    Spawn X (2D / world X)
     * @param {number} y2d    Spawn Y in 2D — mapped to 3D Z
     * @param {object} data   Projectile descriptor (mirrors ProjectileSprite data)
     */
    constructor(scene, x2d, y2d, data) {
        this.scene = scene;

        // ------------------------------------------------------------------
        // Projectile properties from data
        // ------------------------------------------------------------------
        this.physicsType = data.physics || data.physicsType || 'BLUNT';
        this.elements    = data.elements || [];
        this.power       = data.power    != null ? data.power    : 50;
        this.damage      = data.damage   != null ? data.damage   : 10;
        this.spectrum    = data.spectrum || 'DART';
        this.caster      = data.caster   || null;
        this.payload     = data.payload  || [];

        // Pierce: accept both pierce and pierceRemaining
        this.pierceRemaining = (data.pierce != null)
            ? data.pierce
            : (data.pierceRemaining || 0);

        // ------------------------------------------------------------------
        // Derived colour from elements
        // ------------------------------------------------------------------
        this.setColorFromElements();

        // ------------------------------------------------------------------
        // 3D visual model
        // ------------------------------------------------------------------
        const r = data.radius != null ? data.radius : 10;

        if (this.physicsType === 'SHARP') {
            this.group = ModelFactory.projectileSharp({ radius: r, color: this.mainColor });
        } else {
            this.group = ModelFactory.projectileBlunt({ radius: r, color: this.mainColor });
        }

        // Place group at flight height
        this.group.position.set(x2d, W3D.H.PROJECTILE, y2d);
        scene.third.scene.add(this.group);

        // ------------------------------------------------------------------
        // Physics body  (CollisionWorld XZ-plane circle)
        // SHARP projectiles are sensors — overlap events, no resolution.
        // BLUNT projectiles have mass proportional to power for push effect.
        // ------------------------------------------------------------------
        const mass = (this.physicsType === 'BLUNT')
            ? Math.max(1, this.power / 25)
            : 0.5;

        /** @type {object}  CollisionWorld body */
        this.body = scene.world.createBody({
            x:            x2d,
            z:            y2d,
            radius:       r,
            mass,
            isSensor:     (this.physicsType === 'SHARP'),
            label:        'projectile',
            category:     CollisionWorld.CAT_PROJECTILE,
            collidesWith:
                CollisionWorld.CAT_PLAYER |
                CollisionWorld.CAT_ENEMY  |
                CollisionWorld.CAT_OBJECT,
            owner:   this,
            damping: 0  // no air friction — projectiles maintain velocity
        });

        // Apply initial velocity from data (2D vel.x → 3D vx, 2D vel.y → 3D vz)
        if (data.vel) {
            scene.world.setVelocity(this.body, data.vel.x, data.vel.y);
        }

        // ------------------------------------------------------------------
        // Lifecycle / travel tracking
        // ------------------------------------------------------------------
        this.isDead       = false;
        this.hitEnemies   = new Set(); // enemies already hit (pierce de-dup)

        this.spawnX = x2d;
        this.spawnZ = y2d;
        this.distanceTraveled = 0;
        this.maxDistance      = this.power * Config.PowerDistanceRatio;

        // Lifetime: Earth BLUNT projectiles live much longer
        const isEarthBlunt = this.hasElement('Earth') && this.physicsType === 'BLUNT';
        this.lifetime = isEarthBlunt
            ? Config.Effects.Earth.projectileLife
            : Config.ProjectileLife;

        // Activation delay — payload cannot fire immediately after spawn
        this.activationDelay = 0.1;

        // Trail particle rate limiter
        this._trailTimer = 0;

        // Earth contact-damage tick timer
        this._earthTickTimer = 0;

        // Spin accumulator for BLUNT rotation
        this._spin = 0;

        // Store aim angle at spawn (for payload fan-out)
        this._aimAngle = data.vel
            ? Math.atan2(data.vel.y, data.vel.x)
            : 0;

        // ------------------------------------------------------------------
        // Register in GameState so GameScene3D can iterate projectiles
        // ------------------------------------------------------------------
        GameState.projectiles.push(this);
    }

    // -------------------------------------------------------------------------
    // Lifecycle guard
    // -------------------------------------------------------------------------

    /**
     * Returns true only while this projectile is safe to update.
     * After die() the body and scene refs are gone — this prevents
     * use-after-destroy crashes inside the game loop.
     * @returns {boolean}
     */
    isAlive() {
        return !this.isDead && !!this.body && !!this.scene;
    }

    // -------------------------------------------------------------------------
    // Element helpers
    // -------------------------------------------------------------------------

    /**
     * @param {string} el  'Air' | 'Fire' | 'Earth' | 'Water'
     * @returns {boolean}
     */
    hasElement(el) {
        return this.elements.indexOf(el) >= 0;
    }

    /**
     * Compute mainColor by averaging the RGB values of present element colours.
     * Stores result in this.mainColor.
     */
    setColorFromElements() {
        const elementColors = {
            Air:   0xA0E0E0,
            Fire:  0xFF6633,
            Earth: 0x80C060,
            Water: 0x4488FF
        };

        if (this.elements.length === 0) {
            this.mainColor = 0xcccccc;
            return;
        }

        if (this.elements.length === 1) {
            this.mainColor = elementColors[this.elements[0]] || 0xcccccc;
            return;
        }

        // Average RGB channels across all present elements
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < this.elements.length; i++) {
            const c = elementColors[this.elements[i]] || 0xcccccc;
            r += (c >> 16) & 0xff;
            g += (c >>  8) & 0xff;
            b +=  c        & 0xff;
        }
        const n = this.elements.length;
        r = Math.floor(r / n);
        g = Math.floor(g / n);
        b = Math.floor(b / n);
        this.mainColor = (r << 16) | (g << 8) | b;
    }

    // -------------------------------------------------------------------------
    // Per-frame update
    // -------------------------------------------------------------------------

    /**
     * @param {number} dt  Delta time in seconds
     */
    update(dt) {
        if (!this.isAlive()) return;

        // ------------------------------------------------------------------
        // Activation delay countdown
        // ------------------------------------------------------------------
        if (this.activationDelay > 0) {
            this.activationDelay -= dt;
        }

        // ------------------------------------------------------------------
        // Lifetime
        // ------------------------------------------------------------------
        this.lifetime -= dt;
        if (this.lifetime <= 0) {
            this.die();
            return;
        }

        // ------------------------------------------------------------------
        // Distance check
        // ------------------------------------------------------------------
        this.distanceTraveled = Math.hypot(
            this.body.x - this.spawnX,
            this.body.z - this.spawnZ
        );
        if (this.distanceTraveled >= this.maxDistance) {
            this.die();
            return;
        }

        // ------------------------------------------------------------------
        // Earth BLUNT special behaviour
        // ------------------------------------------------------------------
        if (this.hasElement('Earth') && this.physicsType === 'BLUNT') {
            this.pushEntitiesOnPath3D();
            this.applyEarthContactDamage(dt);
        }

        // ------------------------------------------------------------------
        // Trail particle
        // ------------------------------------------------------------------
        this._trailTimer -= dt;
        if (this._trailTimer <= 0) {
            this._trailTimer = 0.04; // ~25 trail particles per second
            if (this.scene && this.scene.effects && this.body) {
                this.scene.effects.trail(
                    this.body.x,
                    W3D.H.PROJECTILE,
                    this.body.z,
                    this.mainColor
                );
            }
        }

        // ------------------------------------------------------------------
        // Visual sync
        // ------------------------------------------------------------------
        this.syncVisual(dt);
    }

    // -------------------------------------------------------------------------
    // Collision handlers  (called by GameScene3D collision callbacks)
    // -------------------------------------------------------------------------

    /**
     * Handle collision with an enemy.
     * @param {object} enemy  Enemy3D instance
     */
    onHitEnemy(enemy) {
        // Dead or already-destroyed projectiles must not run this — reading
        // body.vx below would crash and could freeze the game loop.
        if (!this.isAlive() || !enemy) return;

        // Skip the caster (player cannot be hurt by own projectiles here)
        if (enemy === this.caster) return;

        // Avoid hitting the same enemy multiple times (before pierce consumed)
        if (this.hitEnemies.has(enemy)) return;

        // ------------------------------------------------------------------
        // Damage calculation
        // ------------------------------------------------------------------
        let dmg = this.damage;
        if (this.physicsType === 'BLUNT') {
            dmg *= 0.7; // BLUNT trades some damage for knockback/push
        }

        // ------------------------------------------------------------------
        // Knockback
        // ------------------------------------------------------------------
        const dir = _norm3D(this.body.vx, this.body.vz);
        const spectrumEffects = Config.SpellSpectrum.effects[this.spectrum] || {};
        const knockForce = this.power *
            (spectrumEffects.knockback != null ? spectrumEffects.knockback : 0.3);

        enemy.takeDamage(dmg, { x: dir.x, z: dir.z }, knockForce);

        // Elemental effects applied to all projectile types
        this.applyElementalEffects(enemy);

        // Record hit
        this.hitEnemies.add(enemy);

        // Hit particles
        if (this.scene && this.body) {
            this.scene.spawnParticles3D(this.body.x, this.body.z, this.mainColor, 6);
        }

        // ------------------------------------------------------------------
        // Pierce / death logic
        // ------------------------------------------------------------------
        if (this.pierceRemaining > 0) {
            this.pierceRemaining--;
        } else if (this.power <= Config.OverwhelmThreshold) {
            this.die();
        }
    }

    /**
     * Handle collision with a world object (chunk object record).
     * @param {object} objRecord  Object record with {cfg, ...} from ChunkManager3D
     */
    onHitObject(objRecord) {
        if (!this.isAlive()) return;

        const cfg = objRecord && objRecord.cfg;
        if (!cfg) return;

        if (cfg.immortal) {
            // Immortal objects stop weak projectiles
            if (this.scene && this.body) {
                this.scene.spawnParticles3D(this.body.x, this.body.z, 0xaaaaaa, 5);
            }
            if (this.power <= Config.OverwhelmThreshold) {
                this.die();
            }
            return;
        }

        // Damage the object through the chunk manager
        if (this.scene && this.scene.chunks) {
            this.scene.chunks.damageObject(objRecord, this.damage);
        }

        if (this.scene && this.body) {
            this.scene.spawnParticles3D(this.body.x, this.body.z, this.mainColor, 5);
        }

        // Pierce / death
        if (this.pierceRemaining > 0) {
            this.pierceRemaining--;
        } else if (this.power <= Config.OverwhelmThreshold) {
            this.die();
        }
    }

    // -------------------------------------------------------------------------
    // Elemental effects
    // -------------------------------------------------------------------------

    /**
     * Apply all elemental on-hit effects to a target.
     * @param {object} target  Enemy3D (or Player3D) instance
     */
    applyElementalEffects(target) {
        if (!this.isAlive() || !target) return;

        if (this.hasElement('Fire')) {
            target.applyEffect('burn', {
                duration: Config.Effects.Fire.burnDuration,
                damage:   Config.Effects.Fire.burnDamage
            });
        }

        if (this.hasElement('Water')) {
            target.applyEffect('slow', {
                duration: Config.Effects.Water.slowDuration,
                amount:   Config.Effects.Water.slowAmount
            });
        }

        if (this.hasElement('Air')) {
            const dir = _norm3D(this.body.vx, this.body.vz);
            const force = Config.Effects.Air.propelForce +
                          this.power * Config.Effects.Air.propelPowerScale;
            if (target.applyKnockback) {
                target.applyKnockback(dir.x, dir.z, force);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Earth BLUNT  — sustained push
    // -------------------------------------------------------------------------

    /**
     * Push all enemies and the player who are within the extended collision
     * radius of the projectile.  Only active for Earth BLUNT projectiles.
     */
    pushEntitiesOnPath3D() {
        if (!this.isAlive()) return;

        const queryRadius = this.body.radius * Config.Effects.Earth.pushRadius;

        // Query overlapping bodies
        const bodies = this.scene.world.queryCircle(
            this.body.x,
            this.body.z,
            queryRadius,
            function(b) {
                return (b.label === 'enemy' || b.label === 'player') && b.owner != null;
            }
        );

        for (let i = 0; i < bodies.length; i++) {
            const b = bodies[i];
            const owner = b.owner;
            if (!owner || owner === this.caster) continue;

            const dx = b.x - this.body.x;
            const dz = b.z - this.body.z;
            const dir = _norm3D(dx, dz);

            if (owner.applyKnockback) {
                owner.applyKnockback(dir.x, dir.z, Config.Effects.Earth.pushForce);
            }
        }
    }

    /**
     * Apply continuous contact damage to overlapping enemies at 0.5 s intervals.
     * @param {number} dt  Seconds
     */
    applyEarthContactDamage(dt) {
        if (!this.isAlive()) return;

        this._earthTickTimer -= dt;
        if (this._earthTickTimer > 0) return;

        this._earthTickTimer = 0.5;

        const bodies = this.scene.world.queryCircle(
            this.body.x,
            this.body.z,
            this.body.radius * Config.Effects.Earth.pushRadius,
            function(b) { return b.label === 'enemy' && b.owner != null; }
        );

        for (let i = 0; i < bodies.length; i++) {
            const b = bodies[i];
            if (!b.owner) continue;
            b.owner.takeDamage(Config.Effects.Earth.contactDamage, null, 0);
        }
    }

    // -------------------------------------------------------------------------
    // Payload activation (remote trigger)
    // -------------------------------------------------------------------------

    /**
     * Detonate the projectile: spawn all payload child projectiles then die.
     * Ported from ProjectileSprite.activate.
     */
    activate() {
        if (!this.isAlive()) return;
        if (this.activationDelay > 0) return;
        if (!this.payload || this.payload.length === 0) return;

        try {
            const baseAngle = this._aimAngle ||
                Math.atan2(this.body.vz, this.body.vx);

            for (let i = 0; i < this.payload.length; i++) {
                const entry = this.payload[i];
                const finalAngle = baseAngle + (entry.relAngle || 0);

                // Spawn offset so coincident bodies don't create NaN normals
                const projRadius = entry.circleRadius
                    ? Math.max(10, entry.circleRadius / 2)
                    : 10;
                const spawnGap = projRadius + 6 + i * 3;
                const spawnX   = this.body.x + Math.cos(finalAngle) * spawnGap;
                const spawnZ   = this.body.z + Math.sin(finalAngle) * spawnGap;

                const speed = 400; // spawn velocity magnitude
                let vx = Math.cos(finalAngle) * speed;
                let vz = Math.sin(finalAngle) * speed;

                // Guard against NaN velocities (would corrupt physics sim)
                if (!Number.isFinite(vx) || !Number.isFinite(vz)) {
                    vx = 0;
                    vz = -speed;
                }

                const childData = {
                    elements:  this.elements,
                    spectrum:  this.spectrum,
                    physics:   'BLUNT',
                    damage:    entry.baseDamage   || 10,
                    power:     entry.inheritedPower != null ? entry.inheritedPower : this.power,
                    radius:    projRadius,
                    pierce:    0,
                    vel:       { x: vx, y: vz }, // y maps to z in Projectile3D ctor
                    caster:    this.caster,
                    payload:   entry.nestedPayload || []
                };

                // spawnX, spawnZ → Projectile3D(scene, x2d, y2d, data)
                new Projectile3D(this.scene, spawnX, spawnZ, childData);
            }
        } catch (err) {
            // A malformed payload entry must not abort cleanup
            console.warn('[Projectile3D] activate() recovered from error:', err);
        }

        this.die();
    }

    // -------------------------------------------------------------------------
    // Visual sync
    // -------------------------------------------------------------------------

    /**
     * Sync group position and orientation to the physics body.
     * @param {number} dt  Seconds (used for spin animation)
     */
    syncVisual(dt) {
        if (!this.group || !this.body) return;

        // Fly at constant projectile height
        this.group.position.set(this.body.x, W3D.H.PROJECTILE, this.body.z);

        if (this.physicsType === 'SHARP') {
            // Point the apex (+X axis of cone) in the direction of travel
            const angle = Math.atan2(this.body.vz, this.body.vx);
            this.group.rotation.y = -angle;
        } else {
            // BLUNT: spin the core mesh for a churning-orb look
            this._spin += dt;
            const core = this.group.userData.core;
            if (core) {
                core.rotation.x += 3 * dt;
                core.rotation.y += 2 * dt;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Die / cleanup
    // -------------------------------------------------------------------------

    /**
     * Destroy this projectile.
     * Idempotent — safe to call more than once (collision + lifetime, etc.).
     */
    die() {
        if (this.isDead) return; // already dead
        this.isDead = true;

        // Shockwave death effect
        if (this.scene && this.scene.effects && this.body) {
            try {
                this.scene.effects.shockwave(
                    this.body.x,
                    this.body.z,
                    this.body.radius,
                    this.mainColor
                );
            } catch (e) {
                // FX failure must not block cleanup
                console.warn('[Projectile3D] shockwave FX failed:', e);
            }
        }

        // Remove 3D model from scene
        if (this.group && this.scene && this.scene.third) {
            this.scene.third.scene.remove(this.group);
        }
        this.group = null;

        // Remove physics body
        if (this.body && this.scene && this.scene.world) {
            this.scene.world.removeBody(this.body);
        }
        this.body = null;

        // Remove from GameState projectile list
        var idx = GameState.projectiles.indexOf(this);
        if (idx >= 0) {
            GameState.projectiles.splice(idx, 1);
        }
    }
}

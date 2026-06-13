/**
 * Enemy3D.js
 *
 * Enemy entity for the Enable3D / Three.js scene.
 * Ported from EnemySprite.js (Matter.js 2D) to the custom CollisionWorld
 * physics engine on the XZ plane.
 *
 * Coordinate mapping: 2D (x, y) → 3D (x, height, z) with z = 2D-y.
 *
 * Globals assumed at runtime (plain-script style, no modules):
 *   THREE, ENABLE3D, Config, GameState, ModelFactory,
 *   CollisionWorld (with CAT_* statics), W3D
 */
class Enemy3D {

    /**
     * @param {object} scene  GameScene3D instance
     * @param {number} x      World X position
     * @param {number} z      World Z position (maps to 2D Y)
     */
    constructor(scene, x, z) {
        this.scene = scene;

        // ------------------------------------------------------------------
        // Visual model
        // ------------------------------------------------------------------
        /** @type {ENABLE3D.ExtendedObject3D} */
        this.group = ModelFactory.enemy({});

        // Clone the body mesh material so each enemy can be tinted independently
        // without affecting the shared ModelFactory material cache.
        const bodyMesh = this.group.userData.body;
        if (bodyMesh && bodyMesh.material) {
            bodyMesh.material = bodyMesh.material.clone();
        }

        scene.third.scene.add(this.group);

        // ------------------------------------------------------------------
        // Physics body  (CollisionWorld XZ-plane circle)
        // ------------------------------------------------------------------
        /** @type {object}  CollisionWorld body */
        this.body = scene.world.createBody({
            x,
            z,
            radius:      24,
            mass:        2,
            label:       'enemy',
            category:    CollisionWorld.CAT_ENEMY,
            collidesWith:
                CollisionWorld.CAT_PLAYER |
                CollisionWorld.CAT_ENEMY  |
                CollisionWorld.CAT_OBJECT |
                CollisionWorld.CAT_PROJECTILE,
            owner:   this,
            damping: 0  // velocity managed manually
        });

        // ------------------------------------------------------------------
        // Stats
        // ------------------------------------------------------------------
        this.maxHp     = 100;
        this.hp        = 100;
        this.baseSpeed = Config.EnemySpd;

        // ------------------------------------------------------------------
        // Status effects  (same shape as EnemySprite.effects)
        // ------------------------------------------------------------------
        this.effects = {
            burn: {
                active:    false,
                timer:     0,   // remaining duration (seconds)
                tickTimer: 0,   // accumulator for tick rate
                damage:    0
            },
            slow: {
                active: false,
                timer:  0,
                amount: 1      // speed multiplier
            }
        };

        // Knockback impulse accumulators (decay exponentially)
        this.knockVX = 0;
        this.knockVZ = 0;

        // Flash timer used for the white hit-flash effect
        this._flashTimer = 0;
    }

    // -------------------------------------------------------------------------
    // Coordinate compatibility helpers
    // -------------------------------------------------------------------------

    /** World X (XZ-plane) */
    get x() { return this.body ? this.body.x : 0; }

    /** World Z (XZ-plane) — canonical */
    get z() { return this.body ? this.body.z : 0; }

    /**
     * 2D-y compatibility alias.
     * IMPORTANT: in 3D, Y is the *up* axis; this returns Z to match the
     * 2D → 3D remapping contract.
     */
    get y() { return this.body ? this.body.z : 0; }

    // -------------------------------------------------------------------------
    // Main update — called every frame by GameScene3D
    // -------------------------------------------------------------------------

    /**
     * @param {number} dt         Delta time in seconds
     * @param {object} playerPos  Object with {x, z} — current player position
     */
    update(dt, playerPos) {
        if (!this.body) return; // destroyed guard

        // ------------------------------------------------------------------
        // Chase player AI
        // ------------------------------------------------------------------
        const px = playerPos ? playerPos.x : 0;
        const pz = playerPos ? playerPos.z : 0;

        const dx   = px - this.body.x;
        const dz   = pz - this.body.z;
        const dist = Math.hypot(dx, dz);

        if (dist > 30) {
            // Move towards the player
            const invDist = 1 / dist;
            const dirX    = dx * invDist;
            const dirZ    = dz * invDist;
            const speed   = this.baseSpeed * this.getSpeedMultiplier();

            this.body.vx = dirX * speed + this.knockVX;
            this.body.vz = dirZ * speed + this.knockVZ;
        } else {
            // Close enough — only apply residual knockback
            this.body.vx = this.knockVX;
            this.body.vz = this.knockVZ;
        }

        // Exponential knockback decay (~half-life 0.115 s at k=6)
        const kDecay = Math.exp(-6 * dt);
        this.knockVX *= kDecay;
        this.knockVZ *= kDecay;

        // ------------------------------------------------------------------
        // Status effects
        // ------------------------------------------------------------------
        this.updateEffects(dt);

        // ------------------------------------------------------------------
        // Hit-flash fade
        // ------------------------------------------------------------------
        if (this._flashTimer > 0) {
            this._flashTimer -= dt;
            if (this._flashTimer <= 0) {
                this._flashTimer = 0;
                // Restore effect-state emissive after flash fades
                this.updateEffectVisuals();
            }
        }

        // ------------------------------------------------------------------
        // HP bar
        // ------------------------------------------------------------------
        this.updateHpBar();

        // ------------------------------------------------------------------
        // Visual sync
        // ------------------------------------------------------------------
        this.syncVisual();
    }

    // -------------------------------------------------------------------------
    // Status effects
    // -------------------------------------------------------------------------

    /**
     * Apply a status effect.  Matches the EnemySprite.applyEffect signature.
     * @param {string} type   'burn' | 'slow'
     * @param {object} params
     */
    applyEffect(type, params) {
        if (type === 'burn') {
            this.effects.burn.active    = true;
            this.effects.burn.timer     = (params && params.duration != null)
                ? params.duration : Config.Effects.Fire.burnDuration;
            this.effects.burn.damage    = (params && params.damage != null)
                ? params.damage   : Config.Effects.Fire.burnDamage;
            this.effects.burn.tickTimer = 0;
        } else if (type === 'slow') {
            this.effects.slow.active = true;
            this.effects.slow.timer  = (params && params.duration != null)
                ? params.duration : Config.Effects.Water.slowDuration;
            this.effects.slow.amount = (params && params.amount != null)
                ? params.amount   : Config.Effects.Water.slowAmount;
        }
    }

    /**
     * Tick status effects each frame.  Ported from EnemySprite.updateEffects.
     * @param {number} dt  Seconds
     */
    updateEffects(dt) {
        let hasBurn = false;
        let hasSlow = false;

        // --- Burn ---
        if (this.effects.burn.active) {
            hasBurn = true;
            this.effects.burn.timer     -= dt;
            this.effects.burn.tickTimer += dt;

            if (this.effects.burn.tickTimer >= Config.Effects.Fire.burnTickRate) {
                this.effects.burn.tickTimer = 0;
                this.hp -= this.effects.burn.damage;

                // Burn particle feedback
                if (this.scene && this.body) {
                    this.scene.spawnParticles3D(
                        this.body.x, this.body.z, 0xff6600, 4
                    );
                }

                // Death check
                if (this.hp <= 0) {
                    this.respawn();
                    return;
                }
            }

            if (this.effects.burn.timer <= 0) {
                this.effects.burn.active = false;
                hasBurn = false;
            }
        }

        // --- Slow ---
        if (this.effects.slow.active) {
            hasSlow = true;
            this.effects.slow.timer -= dt;
            if (this.effects.slow.timer <= 0) {
                this.effects.slow.active = false;
                this.effects.slow.amount = 1;
                hasSlow = false;
            }
        }

        // Update emissive tinting unless a hit-flash is active
        if (this._flashTimer <= 0) {
            this.updateEffectVisuals(hasBurn, hasSlow);
        }
    }

    /**
     * Update the body mesh emissive colour based on active effects.
     * Called from updateEffects and at the end of a hit-flash.
     * @param {boolean} [hasBurn]  If omitted, reads from effects state.
     * @param {boolean} [hasSlow]  If omitted, reads from effects state.
     */
    updateEffectVisuals(hasBurn, hasSlow) {
        const burn = (hasBurn !== undefined) ? hasBurn : this.effects.burn.active;
        const slow = (hasSlow !== undefined) ? hasSlow : this.effects.slow.active;

        const bodyMesh = this.group && this.group.userData.body;
        if (!bodyMesh || !bodyMesh.material) return;

        let emissiveColor  = 0x000000;
        const emissiveIntensity = 0.5;

        if (burn && slow) {
            emissiveColor = 0x662266; // purple blend
        } else if (burn) {
            emissiveColor = 0xff4400; // fire orange-red
        } else if (slow) {
            emissiveColor = 0x224488; // water blue
        }

        bodyMesh.material.emissive.setHex(emissiveColor);
        bodyMesh.material.emissiveIntensity = (emissiveColor !== 0x000000)
            ? emissiveIntensity : 0;
    }

    /**
     * Speed multiplier from active effects.
     * @returns {number}
     */
    getSpeedMultiplier() {
        if (this.effects.slow.active) {
            return this.effects.slow.amount;
        }
        return 1;
    }

    // -------------------------------------------------------------------------
    // HP bar
    // -------------------------------------------------------------------------

    /**
     * Sync the billboard HP bar with the current hp/maxHp ratio.
     * The bar is only visible when the enemy has taken damage.
     */
    updateHpBar() {
        if (!this.group) return;
        const hpBar = this.group.userData.hpBar;
        if (!hpBar) return;

        const ratio = Math.max(0, this.hp / this.maxHp);
        hpBar.setRatio(ratio);
        hpBar.visible = (this.hp < this.maxHp);
    }

    // -------------------------------------------------------------------------
    // Combat
    // -------------------------------------------------------------------------

    /**
     * Apply damage (and optional knockback) to this enemy.
     * Flashes the model white briefly.
     *
     * @param {number} amount         Damage amount
     * @param {object|null} knockbackDir  Normalised {x,z} direction (or null)
     * @param {number} knockbackForce Knockback magnitude
     */
    takeDamage(amount, knockbackDir = null, knockbackForce = 0) {
        if (!this.body) return; // destroyed guard

        this.hp -= amount;

        // Apply knockback impulse
        if (knockbackDir && knockbackForce > 0) {
            this.applyKnockback(knockbackDir.x, knockbackDir.z, knockbackForce);
        }

        // White hit-flash on body mesh
        const bodyMesh = this.group && this.group.userData.body;
        if (bodyMesh && bodyMesh.material) {
            bodyMesh.material.emissive.setHex(0xffffff);
            bodyMesh.material.emissiveIntensity = 1.0;
            this._flashTimer = 0.08; // ~80 ms flash
        }

        // Death check
        if (this.hp <= 0) {
            this.respawn();
        }

        this.updateHpBar();
    }

    /**
     * Apply an impulse that decays over time.
     * @param {number} dx    Normalised direction X
     * @param {number} dz    Normalised direction Z
     * @param {number} force Knockback magnitude
     */
    applyKnockback(dx, dz, force) {
        this.knockVX += dx * force * 0.25 / 2;
        this.knockVZ += dz * force * 0.25 / 2;
    }

    // -------------------------------------------------------------------------
    // Respawn
    // -------------------------------------------------------------------------

    /**
     * Teleport the enemy to a random position far from the player and reset stats.
     * Matches EnemySprite.respawn logic.
     */
    respawn() {
        if (!this.body) return;

        // Spawn effect at current (death) location
        if (this.scene) {
            this.scene.spawnParticles3D(this.body.x, this.body.z, 0xff4444, 12);
        }

        // Choose a random spawn point at distance 500–1000 from the player
        const player = GameState.player;
        let spawnX, spawnZ;

        if (player) {
            const angle = Math.random() * Math.PI * 2;
            const dist  = 500 + Math.random() * 500;
            spawnX = player.x + Math.cos(angle) * dist;
            spawnZ = player.z + Math.sin(angle) * dist;
        } else {
            spawnX = (Math.random() - 0.5) * 1000;
            spawnZ = (Math.random() - 0.5) * 1000;
        }

        // Teleport and halt
        this.scene.world.teleport(this.body, spawnX, spawnZ);
        this.body.vx = 0;
        this.body.vz = 0;

        // Reset stats
        this.hp = this.maxHp;
        this.knockVX = 0;
        this.knockVZ = 0;

        // Clear effects
        this.effects.burn.active    = false;
        this.effects.burn.timer     = 0;
        this.effects.burn.tickTimer = 0;
        this.effects.slow.active    = false;
        this.effects.slow.timer     = 0;
        this.effects.slow.amount    = 1;

        // Reset flash
        this._flashTimer = 0;
        this.updateEffectVisuals();

        // Spawn effect at new location
        if (this.scene) {
            this.scene.spawnParticles3D(spawnX, spawnZ, 0xff4444, 12);
        }
    }

    // -------------------------------------------------------------------------
    // Visual sync
    // -------------------------------------------------------------------------

    /**
     * Sync the Three.js group to the physics body position each frame.
     * HP bar billboarding is handled by GameScene3D (it aligns all bars to camera).
     */
    syncVisual() {
        if (!this.group || !this.body) return;

        // Position group at body location; y=0 is ground level
        this.group.position.set(this.body.x, 0, this.body.z);

        // Rotate to face movement direction (only when actually moving)
        const spd = Math.hypot(this.body.vx, this.body.vz);
        if (spd > 5) {
            this.group.rotation.y = -Math.atan2(this.body.vz, this.body.vx);
        }
    }

    // -------------------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------------------

    /**
     * Remove the enemy from the scene and physics world.
     */
    destroy() {
        if (this.group && this.scene && this.scene.third) {
            this.scene.third.scene.remove(this.group);
            this.group = null;
        }

        if (this.body && this.scene && this.scene.world) {
            this.scene.world.removeBody(this.body);
            this.body = null;
        }
    }
}

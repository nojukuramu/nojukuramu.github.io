/**
 * Player3D.js
 *
 * Player entity for the Enable3D / Three.js scene.
 * Ported from PlayerSprite.js (Matter.js 2D) to the custom CollisionWorld
 * physics engine on the XZ plane.
 *
 * Coordinate mapping: 2D (x, y) → 3D (x, height, z) with z = 2D-y.
 * Angles: Math.atan2(dz, dx) — same convention as Three.js XZ plane.
 *
 * Globals assumed at runtime (plain-script style, no modules):
 *   THREE, ENABLE3D, Config, GameState, ModelFactory,
 *   CollisionWorld (with CAT_* statics), W3D
 */

class Player3D {

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
        this.group = ModelFactory.player({});
        scene.third.scene.add(this.group);

        // ------------------------------------------------------------------
        // Physics body  (CollisionWorld XZ-plane circle)
        // ------------------------------------------------------------------
        /** @type {object}  CollisionWorld body */
        this.body = scene.world.createBody({
            x,
            z,
            radius:      18,
            mass:        2,
            label:       'player',
            category:    CollisionWorld.CAT_PLAYER,
            collidesWith:
                CollisionWorld.CAT_ENEMY |
                CollisionWorld.CAT_OBJECT |
                CollisionWorld.CAT_PROJECTILE,
            owner:   this,
            damping: 0  // we manage friction manually via knockback decay
        });

        // ------------------------------------------------------------------
        // Stats  (seed from GameState.playerStats when available)
        // ------------------------------------------------------------------
        const saved = (GameState.playerStats) || {};

        /** @type {number} */ this.hp     = (saved.hp     != null) ? saved.hp     : 100;
        /** @type {number} */ this.maxHp  = (saved.maxHp  != null) ? saved.maxHp  : 100;
        /** @type {number} */ this.stm    = (saved.stm    != null) ? saved.stm    : 100;
        /** @type {number} */ this.maxStm = (saved.maxStm != null) ? saved.maxStm : 100;

        const savedMana = (saved.mana) || {};
        this.mana = {
            Air:   (savedMana.Air   != null) ? savedMana.Air   : 100,
            Fire:  (savedMana.Fire  != null) ? savedMana.Fire  : 100,
            Earth: (savedMana.Earth != null) ? savedMana.Earth : 100,
            Water: (savedMana.Water != null) ? savedMana.Water : 100
        };

        // ------------------------------------------------------------------
        // Movement / aim
        // ------------------------------------------------------------------
        /** @type {number} Radians, XZ plane */
        this.aimAngle   = 0;
        /** @type {boolean} */
        this.isDashing  = false;
        /** @type {number} Seconds remaining in dash */
        this.dashTimer  = 0;
        /** @type {number} Seconds until next dash is allowed */
        this.dashCooldown = 0;
        /** @type {boolean} Invincible flag (active during dash) */
        this.invincible = false;

        this.baseSpeed = Config.PlayerSpd;

        // Knockback impulse (decays exponentially)
        this.knockVX = 0;
        this.knockVZ = 0;

        // Walking bob tracking
        this.walkPhase  = 0;
        this._lastSpeed = 0;

        // ------------------------------------------------------------------
        // Status effects — mirrors PlayerSprite.effects
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
                timer:  0,      // remaining duration (seconds)
                amount: 1       // speed multiplier (< 1 = slower)
            }
        };

        // ------------------------------------------------------------------
        // Mobile / virtual input
        // ------------------------------------------------------------------
        /** Set by touch joystick: {x, y} in [-1,1] */
        this._moveVec          = { x: 0, y: 0 };
        /** True while aim-stick is driving aimAngle */
        this._touchAimOverride = false;

        // ------------------------------------------------------------------
        // Keyboard input
        // ------------------------------------------------------------------
        this.cursors = scene.input.keyboard.createCursorKeys();
        this.wasd    = scene.input.keyboard.addKeys('W,A,S,D,SHIFT,M');

        // ------------------------------------------------------------------
        // Cached raycasting objects for mouse-aim (reused every frame)
        // ------------------------------------------------------------------
        this._raycaster   = new THREE.Raycaster();
        /** Ground plane Y=0 */
        this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        /** NDC coordinates for setFromCamera */
        this._ndc = new THREE.Vector2();
        /** Intersection hit point */
        this._hit = new THREE.Vector3();

        // ------------------------------------------------------------------
        // Register in GameState so other systems can find the player
        // ------------------------------------------------------------------
        GameState.player = this;
    }

    // -------------------------------------------------------------------------
    // Coordinate compatibility helpers
    // -------------------------------------------------------------------------

    /** World X (XZ-plane) */
    get x() { return this.body.x; }

    /** World Z (XZ-plane) — canonical */
    get z() { return this.body.z; }

    /**
     * y → z alias for legacy code that still uses 2D coordinate names.
     * IMPORTANT: in 3D, Y is the *up* axis; this getter intentionally
     * returns the Z (depth) value to match the 2D → 3D remapping contract.
     */
    get y() { return this.body.z; }

    // -------------------------------------------------------------------------
    // Virtual input (called by TouchControls)
    // -------------------------------------------------------------------------

    /**
     * Set the mobile move-stick vector.
     * @param {number} x  Normalised X in [-1, 1]
     * @param {number} y  Normalised Y in [-1, 1]  (maps to 3D Z)
     */
    setMoveVector(x, y) {
        this._moveVec.x = x;
        this._moveVec.y = y;
    }

    /**
     * Override aim direction from mobile aim-stick.
     * @param {number} a  Angle in radians (XZ plane)
     */
    setAimAngle(a) {
        this.aimAngle          = a;
        this._touchAimOverride = true;
    }

    // -------------------------------------------------------------------------
    // Main update — called every frame by GameScene3D
    // -------------------------------------------------------------------------

    /**
     * @param {number} dt      Delta time in seconds
     * @param {object} pointer Phaser pointer (scene.input.activePointer)
     */
    update(dt, pointer) {
        if (!this.body) return; // destroyed guard

        // ------------------------------------------------------------------
        // Movement input
        // ------------------------------------------------------------------
        let moveX = 0;
        let moveZ = 0;

        if (GameState.isMobile &&
            (this._moveVec.x !== 0 || this._moveVec.y !== 0)) {
            // Mobile virtual stick drives movement
            moveX = this._moveVec.x;
            moveZ = this._moveVec.y;  // stick Y → world Z
        } else {
            // Desktop: WASD / Arrow keys
            if (this.wasd.A.isDown    || this.cursors.left.isDown)  moveX = -1;
            if (this.wasd.D.isDown    || this.cursors.right.isDown) moveX =  1;
            if (this.wasd.W.isDown    || this.cursors.up.isDown)    moveZ = -1;
            if (this.wasd.S.isDown    || this.cursors.down.isDown)  moveZ =  1;
        }

        // Normalise diagonal movement
        if (moveX !== 0 && moveZ !== 0) {
            moveX *= 0.707;
            moveZ *= 0.707;
        }

        // ------------------------------------------------------------------
        // Dash trigger  (JustDown on SHIFT)
        // ------------------------------------------------------------------
        if (Phaser.Input.Keyboard.JustDown(this.wasd.SHIFT)) {
            this.dash();
        }

        // ------------------------------------------------------------------
        // Cooldown ticks
        // ------------------------------------------------------------------
        if (this.dashCooldown > 0) {
            this.dashCooldown = Math.max(0, this.dashCooldown - dt);
        }

        if (this.isDashing) {
            this.dashTimer -= dt;
            if (this.dashTimer <= 0) {
                // Dash ends — remove invincibility
                this.isDashing  = false;
                this.invincible = false;
                this.dashTimer  = 0;
            }
        }

        // ------------------------------------------------------------------
        // Velocity
        // ------------------------------------------------------------------
        const speed = this.isDashing
            ? (Config.PlayerSpd + Config.Dash.speedBoost)
            : this.baseSpeed * this.getSpeedMultiplier();

        this.body.vx = moveX * speed + this.knockVX;
        this.body.vz = moveZ * speed + this.knockVZ;

        // Exponential knockback decay  (e^(-6t) per second ≈ ~half-life 0.115 s)
        const knockDecay = Math.exp(-6 * dt);
        this.knockVX *= knockDecay;
        this.knockVZ *= knockDecay;

        this._lastSpeed = Math.hypot(moveX, moveZ) * speed;

        // ------------------------------------------------------------------
        // Stamina regeneration
        // ------------------------------------------------------------------
        const stmRegen = this.isDashing ? 2 : 10;
        this.stm = Math.min(this.maxStm, this.stm + stmRegen * dt);

        // ------------------------------------------------------------------
        // Aim
        // ------------------------------------------------------------------
        if (!this._touchAimOverride) {
            this.updateAim(pointer);
        }

        // ------------------------------------------------------------------
        // Effects, mana, sync
        // ------------------------------------------------------------------
        this.updateEffects(dt);
        this.regenerateMana(dt);
        this.syncToGameState();

        // ------------------------------------------------------------------
        // Visual sync
        // ------------------------------------------------------------------
        this.syncVisual(dt);
    }

    // -------------------------------------------------------------------------
    // Aim update — desktop mouse ray-cast onto the ground plane
    // -------------------------------------------------------------------------

    /**
     * @param {object} pointer  Phaser pointer object
     */
    updateAim(pointer) {
        if (!this.scene || !this.scene.third || !this.scene.third.camera) return;

        // Convert screen coordinates to NDC [-1, 1]
        this._ndc.x =  (pointer.x / this.scene.scale.width)  * 2 - 1;
        this._ndc.y = -(pointer.y / this.scene.scale.height)  * 2 + 1;

        this._raycaster.setFromCamera(this._ndc, this.scene.third.camera);

        if (this._raycaster.ray.intersectPlane(this._groundPlane, this._hit)) {
            this.aimAngle = Math.atan2(
                this._hit.z - this.body.z,
                this._hit.x - this.body.x
            );
        }
    }

    // -------------------------------------------------------------------------
    // Dash
    // -------------------------------------------------------------------------

    /**
     * Attempt a dash.  Consumes stamina and grants brief invincibility.
     * @returns {boolean} True if the dash was triggered.
     */
    dash() {
        if (this.isDashing)               return false;
        if (this.dashCooldown > 0)        return false;
        if (this.stm < Config.Dash.staminaCost) return false;

        this.stm          -= Config.Dash.staminaCost;
        this.isDashing     = true;
        this.invincible    = true;
        this.dashTimer     = Config.Dash.duration;
        this.dashCooldown  = Config.Dash.cooldown;

        // Dash-start particle burst
        if (this.scene && this.body) {
            this.scene.spawnParticles3D(this.body.x, this.body.z, 0xaaaaff, 6);
        }

        return true;
    }

    // -------------------------------------------------------------------------
    // Status effects
    // -------------------------------------------------------------------------

    /**
     * Apply a status effect.  Matches the PlayerSprite.applyEffect signature.
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
     * Tick status effects each frame.  Ported from PlayerSprite.updateEffects.
     * @param {number} dt  Seconds
     */
    updateEffects(dt) {
        // --- Burn ---
        if (this.effects.burn.active) {
            this.effects.burn.timer     -= dt;
            this.effects.burn.tickTimer += dt;

            if (this.effects.burn.tickTimer >= Config.Effects.Fire.burnTickRate) {
                this.effects.burn.tickTimer = 0;
                this.hp -= this.effects.burn.damage;

                // Burn particle feedback
                if (this.scene && this.body) {
                    this.scene.spawnParticles3D(
                        this.body.x, this.body.z, 0xff6600, 3
                    );
                }

                // Death check from burn
                if (this.hp <= 0) {
                    this.die();
                    return;
                }
            }

            if (this.effects.burn.timer <= 0) {
                this.effects.burn.active = false;
            }
        }

        // --- Slow ---
        if (this.effects.slow.active) {
            this.effects.slow.timer -= dt;
            if (this.effects.slow.timer <= 0) {
                this.effects.slow.active = false;
                this.effects.slow.amount = 1;
            }
        }
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
    // Knockback
    // -------------------------------------------------------------------------

    /**
     * @param {number} dx     Normalised direction X
     * @param {number} dz     Normalised direction Z
     * @param {number} force  Knockback magnitude
     */
    applyKnockback(dx, dz, force) {
        this.knockVX += dx * force * 0.25 / 2;
        this.knockVZ += dz * force * 0.25 / 2;
    }

    // -------------------------------------------------------------------------
    // Mana regeneration
    // -------------------------------------------------------------------------

    /** @param {number} dt  Seconds */
    regenerateMana(dt) {
        this.mana.Air   = Math.min(100, this.mana.Air   + Config.ManaRegen.Air   * dt);
        this.mana.Fire  = Math.min(100, this.mana.Fire  + Config.ManaRegen.Fire  * dt);
        this.mana.Earth = Math.min(100, this.mana.Earth + Config.ManaRegen.Earth * dt);
        this.mana.Water = Math.min(100, this.mana.Water + Config.ManaRegen.Water * dt);
    }

    // -------------------------------------------------------------------------
    // Damage / death
    // -------------------------------------------------------------------------

    /**
     * @param {number} amount  Damage to apply
     */
    takeDamage(amount) {
        if (this.invincible) return; // dash or other invincibility frame

        this.hp -= amount;

        // Screen shake feedback
        if (this.scene && this.scene.cameras && this.scene.cameras.main) {
            this.scene.cameras.main.shake(80, 0.006);
        }

        if (this.hp <= 0) {
            this.die();
        }
    }

    /**
     * Respawn the player at origin.  Ported from PlayerSprite.die.
     */
    die() {
        if (!this.body) return;

        // Teleport to world origin and stop movement
        this.scene.world.teleport(this.body, 0, 0);
        this.body.vx = 0;
        this.body.vz = 0;

        // Restore stats
        this.hp  = this.maxHp;
        this.stm = this.maxStm;

        // Clear all status effects
        this.effects.burn.active    = false;
        this.effects.burn.timer     = 0;
        this.effects.burn.tickTimer = 0;
        this.effects.slow.active    = false;
        this.effects.slow.timer     = 0;
        this.effects.slow.amount    = 1;

        // Clear knockback
        this.knockVX = 0;
        this.knockVZ = 0;

        // Screen flash (red-tinted)
        if (this.scene && this.scene.cameras && this.scene.cameras.main) {
            this.scene.cameras.main.flash(200, 255, 80, 80);
        }
    }

    // -------------------------------------------------------------------------
    // GameState sync
    // -------------------------------------------------------------------------

    /**
     * Push player stats into GameState.playerStats so the HUD can read them.
     */
    syncToGameState() {
        if (!GameState.playerStats) GameState.playerStats = {};

        GameState.playerStats.hp     = this.hp;
        GameState.playerStats.maxHp  = this.maxHp;
        GameState.playerStats.stm    = this.stm;
        GameState.playerStats.maxStm = this.maxStm;
        GameState.playerStats.mana   = this.mana;
    }

    // -------------------------------------------------------------------------
    // Visual sync — called at end of update()
    // -------------------------------------------------------------------------

    /**
     * Sync the Three.js group to the physics body position and apply
     * walking-bob animation.
     *
     * @param {number} dt  Seconds
     */
    syncVisual(dt) {
        if (!this.group || !this.body) return;

        // Position group at physics body origin (ground level y=0)
        this.group.position.set(this.body.x, 0, this.body.z);

        // Rotate to face aim direction.
        // group.rotation.y uses left-handed Y-up convention (CCW when viewed
        // from above), so we negate the XZ-plane angle.
        this.group.rotation.y = -this.aimAngle;

        // Walking bob: oscillate the body mesh upward
        const isMoving = this._lastSpeed > 10;

        if (isMoving) {
            this.walkPhase += dt * 12;
        } else {
            // Ease walk phase back to 0 when idle
            this.walkPhase *= (1 - Math.min(1, dt * 8));
        }

        const bodyMesh = this.group.userData.body;
        if (bodyMesh) {
            bodyMesh.position.y = 17 + (isMoving ? Math.sin(this.walkPhase) * 1.5 : 0);
        }

        // Show the aim arrow on desktop, or on mobile when aim-stick active
        const aimArrow = this.group.userData.aimArrow;
        if (aimArrow) {
            aimArrow.visible = (!GameState.isMobile || this._touchAimOverride);
        }
    }

    // -------------------------------------------------------------------------
    // Cleanup
    // -------------------------------------------------------------------------

    /**
     * Remove the player from the scene and physics world.
     * Call this when tearing down the game scene.
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

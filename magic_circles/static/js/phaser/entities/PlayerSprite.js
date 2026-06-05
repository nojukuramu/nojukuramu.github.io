/**
 * PlayerSprite - Player entity using Matter.js physics
 */
class PlayerSprite extends Phaser.Physics.Matter.Sprite {
    constructor(scene, x, y) {
        super(scene.matter.world, x, y, 'player');

        scene.add.existing(this);

        // Physics body setup
        const { Bodies, Body } = Phaser.Physics.Matter.Matter;

        // Collision categories: 1=Player, 2=Enemy, 4=Objects, 8=Projectiles
        const collisionCategory = 1;
        const collidesWith = 2 | 4 | 8; // Enemies, Objects, and Projectiles

        const circleBody = Bodies.circle(x, y, 18, {
            label: 'player',
            friction: 0,
            frictionAir: 0.08,
            restitution: 0.1,
            collisionFilter: {
                category: collisionCategory,
                mask: collidesWith
            }
        });

        this.setExistingBody(circleBody);
        this.setFixedRotation();

        // Dynamic scaling: force visual size to 64x64
        this.setDisplaySize(64, 64);

        this.rad = 18; // Collision radius for spawn offset calculations

        // Store reference in scene
        scene.player = this;
        GameState.player = this;

        // Stats
        this.hp = 100;
        this.maxHp = 100;
        this.stm = 100;
        this.maxStm = 100;
        this.mana = {
            Air: 100,
            Fire: 100,
            Earth: 100,
            Water: 100
        };

        // Movement
        this.baseSpeed = Config.PlayerSpd;
        this.moveForce = 0.002;
        this.mass = 60; // Mass for push calculations (player is slightly heavier than enemies)

        // Dash
        this.isDashing = false;
        this.dashTimer = 0;
        this.dashCooldown = 0;

        // Combat
        this.castCooldown = 0;

        // Status effects
        this.effects = {
            burn: { active: false, duration: 0, tickTimer: 0, damage: 0 },
            slow: { active: false, duration: 0, amount: 1 }
        };

        // Input
        this.cursors = scene.input.keyboard.createCursorKeys();
        this.wasd = scene.input.keyboard.addKeys({
            up: 'W',
            down: 'S',
            left: 'A',
            right: 'D',
            dash: 'SHIFT',
            magic: 'M'
        });

        // Aim direction (towards mouse on desktop; overridden by touch stick on mobile)
        this.aimAngle = 0;

        // Virtual input vectors (set by TouchControls on mobile, ignored on desktop)
        this._moveVec = { x: 0, y: 0 };
        this._touchAimOverride = false;

        // Dash particles
        this.dashEmitter = null;
        this.setupDashParticles(scene);

        // Shadow and glow effects
        this.shadow = scene.add.ellipse(x, y + 10, 30, 12, 0x000000, 0.3);
        this.shadow.setDepth(this.depth - 1);

        // Aim indicator
        this.aimIndicator = scene.add.graphics();
        this.aimIndicator.setDepth(this.depth - 0.5);

        // Collision category
        this.setCollisionCategory(1);
        this.setCollidesWith([1, 2, 4, 8]); // Players, enemies, objects, projectiles (for self-damage)
    }

    setupDashParticles(scene) {
        // Create particle emitter for dash trail
        this.dashEmitter = scene.add.particles(0, 0, 'particle', {
            speed: { min: 50, max: 100 },
            scale: { start: 0.4, end: 0 },
            alpha: { start: 0.8, end: 0 },
            lifespan: 300,
            tint: 0xaaaaff,
            blendMode: 'ADD',
            emitting: false
        });
    }

    update(time, delta) {
        const dt = delta / 1000;

        // Update cooldowns
        if (this.castCooldown > 0) this.castCooldown -= dt;
        if (this.dashCooldown > 0) this.dashCooldown -= dt;

        // Dash timer
        if (this.isDashing) {
            this.dashTimer -= dt;
            if (this.dashTimer <= 0) {
                this.isDashing = false;
                this.dashEmitter.stop();
            }

            // Update dash particles position
            this.dashEmitter.setPosition(this.x, this.y);
        }

        // Update effects
        this.updateEffects(dt);

        // Movement
        this.handleMovement(dt);

        // Aim towards mouse
        this.updateAim();

        // Mana regeneration
        this.regenerateMana(dt);

        // Stamina regeneration
        const stmRegen = this.isDashing ? 2 : 10;
        this.stm = Math.min(this.maxStm, this.stm + stmRegen * dt);

        // Update game state
        this.syncToGameState();

        // Update shadow position
        if (this.shadow) {
            this.shadow.setPosition(this.x, this.y + 14);
        }

        // Update aim indicator
        this.renderAimIndicator();

        // Check dash input
        if (Phaser.Input.Keyboard.JustDown(this.wasd.dash)) {
            this.dash();
        }

        // Check magic menu input
        if (Phaser.Input.Keyboard.JustDown(this.wasd.magic)) {
            this.scene.openMagicEditor();
        }
    }

    setMoveVector(x, y) { this._moveVec = { x, y }; }
    setAimAngle(a) { this.aimAngle = a; this._touchAimOverride = true; }

    handleMovement(dt) {
        let moveX = 0;
        let moveY = 0;

        if (GameState.isMobile && (this._moveVec.x !== 0 || this._moveVec.y !== 0)) {
            // Mobile: read from virtual stick
            moveX = this._moveVec.x;
            moveY = this._moveVec.y;
        } else {
            // Desktop: WASD / Arrow keys
            if (this.wasd.left.isDown || this.cursors.left.isDown) moveX = -1;
            if (this.wasd.right.isDown || this.cursors.right.isDown) moveX = 1;
            if (this.wasd.up.isDown || this.cursors.up.isDown) moveY = -1;
            if (this.wasd.down.isDown || this.cursors.down.isDown) moveY = 1;
        }

        // Normalize diagonal movement
        if (moveX !== 0 && moveY !== 0) {
            moveX *= 0.707;
            moveY *= 0.707;
        }

        // Apply speed multiplier from effects
        const speedMult = this.getSpeedMultiplier();

        if (moveX !== 0 || moveY !== 0) {
            // Apply force
            const force = this.moveForce * speedMult * GameState.timeScale;
            this.applyForce({ x: moveX * force, y: moveY * force });

            // Cap velocity (unless dashing)
            if (!this.isDashing) {
                const maxSpeed = this.baseSpeed * speedMult * 0.005;
                const vel = this.body.velocity;
                const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
                if (speed > maxSpeed) {
                    const scale = maxSpeed / speed;
                    this.setVelocity(vel.x * scale, vel.y * scale);
                }
            }

            // Animations
            if (Math.abs(moveX) > Math.abs(moveY)) {
                if (moveX > 0) this.anims.play('player-walk-right', true);
                else this.anims.play('player-walk-left', true);
            } else {
                if (moveY > 0) this.anims.play('player-walk-down', true);
                else this.anims.play('player-walk-up', true);
            }
        } else {
            // Idle - stop animation and show first frame of last animation
            this.anims.stop();
        }
    }

    updateAim() {
        if (this._touchAimOverride) return; // Mobile aim stick drives aimAngle directly
        const pointer = this.scene.input.activePointer;
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.aimAngle = Phaser.Math.Angle.Between(this.x, this.y, worldPoint.x, worldPoint.y);
    }

    renderAimIndicator() {
        if (!this.aimIndicator) return;
        this.aimIndicator.clear();

        // Draw aim line from player towards mouse
        const len = 40;
        const endX = this.x + Math.cos(this.aimAngle) * len;
        const endY = this.y + Math.sin(this.aimAngle) * len;

        // Gradient opacity line
        this.aimIndicator.lineStyle(3, 0xffffff, 0.4);
        this.aimIndicator.beginPath();
        this.aimIndicator.moveTo(this.x + Math.cos(this.aimAngle) * 22, this.y + Math.sin(this.aimAngle) * 22);
        this.aimIndicator.lineTo(endX, endY);
        this.aimIndicator.strokePath();

        // Arrow head
        const arrowSize = 6;
        const arrowAngle = 0.5;
        this.aimIndicator.fillStyle(0xffffff, 0.5);
        this.aimIndicator.beginPath();
        this.aimIndicator.moveTo(endX, endY);
        this.aimIndicator.lineTo(
            endX - Math.cos(this.aimAngle - arrowAngle) * arrowSize,
            endY - Math.sin(this.aimAngle - arrowAngle) * arrowSize
        );
        this.aimIndicator.lineTo(
            endX - Math.cos(this.aimAngle + arrowAngle) * arrowSize,
            endY - Math.sin(this.aimAngle + arrowAngle) * arrowSize
        );
        this.aimIndicator.closePath();
        this.aimIndicator.fillPath();
    }

    dash() {
        if (this.isDashing) return false;
        if (this.dashCooldown > 0) return false;
        if (this.stm < Config.Dash.staminaCost) return false;

        // Consume stamina
        this.stm -= Config.Dash.staminaCost;

        // Determine dash direction
        let dashX = 0, dashY = 0;
        if (this.wasd.left.isDown || this.cursors.left.isDown) dashX = -1;
        if (this.wasd.right.isDown || this.cursors.right.isDown) dashX = 1;
        if (this.wasd.up.isDown || this.cursors.up.isDown) dashY = -1;
        if (this.wasd.down.isDown || this.cursors.down.isDown) dashY = 1;

        // Default to aim direction if not moving
        if (dashX === 0 && dashY === 0) {
            dashX = Math.cos(this.aimAngle);
            dashY = Math.sin(this.aimAngle);
        } else {
            // Normalize
            const mag = Math.sqrt(dashX * dashX + dashY * dashY);
            dashX /= mag;
            dashY /= mag;
        }

        // Apply dash velocity
        const dashSpeed = Config.Dash.speedBoost * 0.01;
        this.setVelocity(
            this.body.velocity.x + dashX * dashSpeed,
            this.body.velocity.y + dashY * dashSpeed
        );

        // Start dash state
        this.isDashing = true;
        this.dashTimer = Config.Dash.duration;
        this.dashCooldown = Config.Dash.cooldown;

        // Start particles
        this.dashEmitter.start();

        // Visual effect
        this.scene.cameras.main.shake(50, 0.002);

        return true;
    }

    applyEffect(type, params) {
        if (type === 'burn') {
            this.effects.burn.active = true;
            this.effects.burn.duration = params.duration || Config.Effects.Fire.burnDuration;
            this.effects.burn.damage = params.damage || Config.Effects.Fire.burnDamage;
            this.effects.burn.tickTimer = 0;
        } else if (type === 'slow') {
            this.effects.slow.active = true;
            this.effects.slow.duration = params.duration || Config.Effects.Water.slowDuration;
            this.effects.slow.amount = params.amount || Config.Effects.Water.slowAmount;
        }
    }

    updateEffects(dt) {
        // Burn
        if (this.effects.burn.active) {
            this.effects.burn.duration -= dt;
            this.effects.burn.tickTimer += dt;

            if (this.effects.burn.tickTimer >= Config.Effects.Fire.burnTickRate) {
                this.effects.burn.tickTimer = 0;
                this.hp -= this.effects.burn.damage;

                // Burn particles
                this.scene.spawnParticles(this.x, this.y, 0xff6600, 3);
            }

            if (this.effects.burn.duration <= 0) {
                this.effects.burn.active = false;
            }
        }

        // Slow
        if (this.effects.slow.active) {
            this.effects.slow.duration -= dt;
            if (this.effects.slow.duration <= 0) {
                this.effects.slow.active = false;
                this.effects.slow.amount = 1;
            }
        }
    }

    getSpeedMultiplier() {
        if (this.effects.slow.active) {
            return this.effects.slow.amount;
        }
        return 1;
    }

    regenerateMana(dt) {
        this.mana.Air = Math.min(100, this.mana.Air + Config.ManaRegen.Air * dt);
        this.mana.Fire = Math.min(100, this.mana.Fire + Config.ManaRegen.Fire * dt);
        this.mana.Earth = Math.min(100, this.mana.Earth + Config.ManaRegen.Earth * dt);
        this.mana.Water = Math.min(100, this.mana.Water + Config.ManaRegen.Water * dt);
    }

    syncToGameState() {
        GameState.playerStats.hp = this.hp;
        GameState.playerStats.stm = this.stm;
        GameState.playerStats.mana = this.mana;
    }

    takeDamage(amount) {
        if (this.isDashing) return; // Invincible during dash
        this.hp -= amount;
        if (this.hp <= 0) {
            this.die();
        }
    }

    die() {
        // Reset position
        this.setPosition(0, 0);
        this.hp = this.maxHp;
        this.stm = this.maxStm;

        // Visual effect
        this.scene.cameras.main.flash(500, 255, 0, 0);
    }
}

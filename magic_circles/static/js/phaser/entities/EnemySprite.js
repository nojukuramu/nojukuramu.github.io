/**
 * EnemySprite - Enemy entity with chase AI
 */
class EnemySprite extends Phaser.Physics.Matter.Sprite {
    constructor(scene, x, y) {
        super(scene.matter.world, x, y, 'enemy');

        scene.add.existing(this);

        // Physics body
        const { Bodies } = Phaser.Physics.Matter.Matter;
        const circleBody = Bodies.circle(x, y, 24, {
            label: 'enemy',
            friction: 0,
            frictionAir: 0.05,
            restitution: 0.3
        });

        this.setExistingBody(circleBody);
        this.setFixedRotation();

        // Dynamic scaling: force visual size to 64x64
        this.setDisplaySize(64, 64);

        // Stats
        this.maxHp = 100;
        this.hp = 100;
        this.baseSpeed = Config.EnemySpd;
        this.moveForce = 0.0015;
        this.mass = 50; // Mass for push calculations (higher = harder to push)

        // Status effects
        this.effects = {
            burn: { active: false, duration: 0, tickTimer: 0, damage: 0 },
            slow: { active: false, duration: 0, amount: 1 }
        };

        // Collision category
        this.setCollisionCategory(2);
        this.setCollidesWith([1, 2, 4, 8]); // Players, enemies, objects, projectiles

        // HP bar graphics
        this.hpBar = scene.add.graphics();
        this.hpBar.setDepth(100);

        // Shadow
        this.shadow = scene.add.ellipse(x, y + 12, 36, 14, 0x000000, 0.25);
        this.shadow.setDepth(this.depth - 1);

        // Reference
        this.scene = scene;
    }

    update(time, delta, playerPos) {
        const dt = delta / 1000;

        // Update effects
        this.updateEffects(dt);

        // Chase player
        if (playerPos) {
            this.chasePlayer(playerPos, dt);
        }

        // Update HP bar
        this.updateHpBar();

        // Update shadow position
        if (this.shadow) {
            this.shadow.setPosition(this.x, this.y + 16);
        }

        // Check death
        if (this.hp <= 0) {
            this.respawn();
        }
    }

    chasePlayer(playerPos, dt) {
        const dx = playerPos.x - this.x;
        const dy = playerPos.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 30) { // Don't push into player
            const dirX = dx / dist;
            const dirY = dy / dist;

            // Speed multiplier from effects
            const speedMult = this.getSpeedMultiplier();

            // Apply force
            const force = this.moveForce * speedMult * GameState.timeScale;
            this.applyForce({ x: dirX * force, y: dirY * force });

            // Cap velocity
            const maxSpeed = this.baseSpeed * speedMult * 0.005;
            const vel = this.body.velocity;
            const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
            if (speed > maxSpeed) {
                const scale = maxSpeed / speed;
                this.setVelocity(vel.x * scale, vel.y * scale);
            }
        }
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
        // Track active effects for visual tinting
        let hasBurn = false;
        let hasSlow = false;

        // Burn
        if (this.effects.burn.active) {
            hasBurn = true;
            this.effects.burn.duration -= dt;
            this.effects.burn.tickTimer += dt;

            if (this.effects.burn.tickTimer >= Config.Effects.Fire.burnTickRate) {
                this.effects.burn.tickTimer = 0;
                this.hp -= this.effects.burn.damage;

                // Burn particles - more dramatic
                if (this.scene) {
                    this.scene.spawnParticles(this.x, this.y, 0xff6600, 4);
                    // Rising fire particles
                    for (let i = 0; i < 2; i++) {
                        const flame = this.scene.add.circle(
                            this.x + (Math.random() - 0.5) * 20,
                            this.y + (Math.random() - 0.5) * 20,
                            4 + Math.random() * 4,
                            0xff4400, 0.8
                        );
                        flame.setBlendMode(Phaser.BlendModes.ADD);
                        this.scene.tweens.add({
                            targets: flame,
                            y: flame.y - 30 - Math.random() * 20,
                            alpha: 0,
                            scale: 0.3,
                            duration: 400 + Math.random() * 200,
                            onComplete: () => flame.destroy()
                        });
                    }
                }
            }

            if (this.effects.burn.duration <= 0) {
                this.effects.burn.active = false;
            }
        }

        // Slow
        if (this.effects.slow.active) {
            hasSlow = true;
            this.effects.slow.duration -= dt;

            // Occasional water drip particles
            if (this.scene && Math.random() < 0.05) {
                const drip = this.scene.add.circle(
                    this.x + (Math.random() - 0.5) * 16,
                    this.y - 10,
                    2 + Math.random() * 2,
                    0x4488ff, 0.7
                );
                this.scene.tweens.add({
                    targets: drip,
                    y: drip.y + 30,
                    alpha: 0,
                    duration: 500,
                    onComplete: () => drip.destroy()
                });
            }

            if (this.effects.slow.duration <= 0) {
                this.effects.slow.active = false;
                this.effects.slow.amount = 1;
            }
        }

        // Apply visual tint based on active effects
        this.updateEffectVisuals(hasBurn, hasSlow);
    }

    /**
     * Update visual tint based on active effects
     */
    updateEffectVisuals(hasBurn, hasSlow) {
        if (hasBurn && hasSlow) {
            // Both effects - purple tint (blend of fire + water)
            this.setTint(0xdd66aa);
        } else if (hasBurn) {
            // Fire - orange/red tint
            this.setTint(0xff8844);
        } else if (hasSlow) {
            // Water - blue tint
            this.setTint(0x6699ff);
        } else {
            // No effects - clear tint
            this.clearTint();
        }

        // Create/update effect glow
        if (hasBurn || hasSlow) {
            if (!this.effectGlow) {
                this.effectGlow = this.scene.add.circle(this.x, this.y, 30, 0x000000, 0);
                this.effectGlow.setBlendMode(Phaser.BlendModes.ADD);
                this.effectGlow.setDepth(this.depth - 0.5);
            }

            // Update glow
            this.effectGlow.setPosition(this.x, this.y);
            if (hasBurn) {
                this.effectGlow.setFillStyle(0xff4400, 0.15);
            } else if (hasSlow) {
                this.effectGlow.setFillStyle(0x4488ff, 0.12);
            }
        } else {
            // Remove glow when no effects
            if (this.effectGlow) {
                this.effectGlow.destroy();
                this.effectGlow = null;
            }
        }
    }

    getSpeedMultiplier() {
        if (this.effects.slow.active) {
            return this.effects.slow.amount;
        }
        return 1;
    }

    updateHpBar() {
        this.hpBar.clear();

        const pct = this.hp / this.maxHp;
        const x = this.x - 20;
        const y = this.y - 35;

        // Background
        this.hpBar.fillStyle(0x333333, 1);
        this.hpBar.fillRect(x, y, 40, 6);

        // Fill
        this.hpBar.fillStyle(pct > 0.5 ? 0x00ff00 : 0xff0000, 1);
        this.hpBar.fillRect(x, y, 40 * pct, 6);
    }

    takeDamage(amount, knockbackDir = null, knockbackForce = 0) {
        this.hp -= amount;

        // Knockback
        if (knockbackDir && knockbackForce > 0) {
            this.applyForce({
                x: knockbackDir.x * knockbackForce * 0.001,
                y: knockbackDir.y * knockbackForce * 0.001
            });
        }

        // Hit flash
        this.setTint(0xffffff);
        this.scene.time.delayedCall(100, () => {
            this.clearTint();
        });
    }

    respawn() {
        // Spawn particles on death
        if (this.scene) {
            this.scene.spawnParticles(this.x, this.y, 0xff4444, 15);
        }

        // Reset stats
        this.hp = this.maxHp;

        // Teleport to random position
        const player = this.scene.player;
        if (player) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 500 + Math.random() * 500;
            this.setPosition(
                player.x + Math.cos(angle) * dist,
                player.y + Math.sin(angle) * dist
            );
        } else {
            this.setPosition(
                (Math.random() - 0.5) * 1000,
                (Math.random() - 0.5) * 1000
            );
        }

        this.setVelocity(0, 0);
    }

    destroy() {
        if (this.hpBar) {
            this.hpBar.destroy();
        }
        if (this.effectGlow) {
            this.effectGlow.destroy();
        }
        if (this.shadow) {
            this.shadow.destroy();
        }
        if (this.body) {
            this.scene.matter.world.remove(this.body);
            this.body = null;
        }
        super.destroy();
    }
}

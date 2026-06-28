/**
 * EnemySprite - Enemy entity with chase AI and permanent death.
 * Accepts an optional archetype config; defaults to Chaser stats.
 */
class EnemySprite extends Phaser.Physics.Matter.Sprite {
    constructor(scene, x, y, archetype) {
        const arch = archetype || (typeof EnemyArchetypes !== 'undefined' && EnemyArchetypes.Chaser) || {};
        super(scene.matter.world, x, y, arch.texture || 'enemy');

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
        this.setDisplaySize(64, 64);

        // Archetype stats
        this.archetype     = arch;
        this.maxHp         = arch.baseHp     != null ? arch.baseHp     : 100;
        this.hp            = this.maxHp;
        this.baseSpeed     = arch.baseSpeed  != null ? arch.baseSpeed  : Config.EnemySpd;
        this.mass          = arch.mass       != null ? arch.mass       : 50;
        this.contactDamage = arch.contactDamage != null ? arch.contactDamage : 10;
        this.moveForce     = 0.0015;

        // Ranged attack state
        this._rangedCooldown = 0;

        // Death guard
        this.isDead = false;

        // Status effects
        this.effects = {
            burn: { active: false, duration: 0, tickTimer: 0, damage: 0 },
            slow: { active: false, duration: 0, amount: 1 }
        };

        // Collision category 2; collides with Player(1), Enemy(2), Object(4), Projectile(8)
        this.setCollisionCategory(CAT.ENEMY);
        this.setCollidesWith([CAT.PLAYER, CAT.ENEMY, CAT.OBJECT, CAT.PROJECTILE]);

        // HP bar
        this.hpBar = scene.add.graphics();
        this.hpBar.setDepth(100);

        // Shadow
        this.shadow = scene.add.ellipse(x, y + 12, 36, 14, 0x000000, 0.25);
        this.shadow.setDepth(this.depth - 1);

        this.scene = scene;
    }

    update(time, delta, playerPos) {
        if (this.isDead) return;

        const dt = delta / 1000;

        // NaN guard — prevent a poisoned body from wedging the physics sim.
        if (this.body) {
            const v = this.body.velocity;
            if (!Number.isFinite(this.x) || !Number.isFinite(this.y) ||
                !Number.isFinite(v.x)    || !Number.isFinite(v.y)) {
                this.setVelocity(0, 0);
                const px = (playerPos && Number.isFinite(playerPos.x)) ? playerPos.x : 0;
                const py = (playerPos && Number.isFinite(playerPos.y)) ? playerPos.y : 0;
                this.setPosition(px + 200, py);
                return;
            }
        }

        this.updateEffects(dt);

        if (playerPos) this.chasePlayer(playerPos, dt);

        // Ranged attack
        if (this.archetype && this.archetype.ranged && this.archetype.rangedConfig && playerPos) {
            this._rangedCooldown -= dt;
            if (this._rangedCooldown <= 0) {
                this._fireRangedAttack(playerPos);
                this._rangedCooldown = this.archetype.rangedConfig.cooldown || 2.5;
            }
        }

        this.updateHpBar();

        if (this.shadow) this.shadow.setPosition(this.x, this.y + 16);

        if (this.hp <= 0) this.die();
    }

    _fireRangedAttack(playerPos) {
        if (!this.scene || !this.archetype.rangedConfig) return;
        const rc  = this.archetype.rangedConfig.projectile;
        const dx  = playerPos.x - this.x;
        const dy  = playerPos.y - this.y;
        const mag = Math.sqrt(dx * dx + dy * dy) || 1;
        const spd = rc.speed || 380;

        try {
            new ProjectileSprite(this.scene, this.x, this.y, {
                elements:  [],
                spectrum:  'DART',
                physics:   'BLUNT',
                damage:    rc.damage || 12,
                radius:    rc.radius || 8,
                vel:       { x: (dx / mag) * spd, y: (dy / mag) * spd },
                power:     rc.power  || 40,
                caster:    this,
                payload:   null
            });
        } catch (e) {
            console.warn('EnemySprite ranged attack failed:', e);
        }
    }

    chasePlayer(playerPos, dt) {
        const dx   = playerPos.x - this.x;
        const dy   = playerPos.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > 30) {
            const dirX      = dx / dist;
            const dirY      = dy / dist;
            const speedMult = this.getSpeedMultiplier();
            const force     = this.moveForce * speedMult * GameState.timeScale;

            this.applyForce({ x: dirX * force, y: dirY * force });

            const maxSpeed = this.baseSpeed * speedMult * 0.005;
            const vel      = this.body.velocity;
            const speed    = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
            if (speed > maxSpeed) {
                const scale = maxSpeed / speed;
                this.setVelocity(vel.x * scale, vel.y * scale);
            }
        }
    }

    applyEffect(type, params) {
        if (type === 'burn') {
            this.effects.burn.active    = true;
            this.effects.burn.duration  = params.duration || Config.Effects.Fire.burnDuration;
            this.effects.burn.damage    = params.damage   || Config.Effects.Fire.burnDamage;
            this.effects.burn.tickTimer = 0;
        } else if (type === 'slow') {
            this.effects.slow.active   = true;
            this.effects.slow.duration = params.duration || Config.Effects.Water.slowDuration;
            this.effects.slow.amount   = params.amount   || Config.Effects.Water.slowAmount;
        }
    }

    updateEffects(dt) {
        let hasBurn = false, hasSlow = false;

        if (this.effects.burn.active) {
            hasBurn = true;
            this.effects.burn.duration  -= dt;
            this.effects.burn.tickTimer += dt;

            if (this.effects.burn.tickTimer >= Config.Effects.Fire.burnTickRate) {
                this.effects.burn.tickTimer = 0;
                this.hp -= this.effects.burn.damage;

                if (this.scene) {
                    this.scene.spawnParticles(this.x, this.y, 0xff6600, 4);
                    for (let i = 0; i < 2; i++) {
                        const flame = this.scene.add.circle(
                            this.x + (Math.random() - 0.5) * 20,
                            this.y + (Math.random() - 0.5) * 20,
                            4 + Math.random() * 4, 0xff4400, 0.8
                        );
                        flame.setBlendMode(Phaser.BlendModes.ADD);
                        this.scene.tweens.add({
                            targets: flame,
                            y: flame.y - 30 - Math.random() * 20,
                            alpha: 0, scale: 0.3,
                            duration: 400 + Math.random() * 200,
                            onComplete: () => flame.destroy()
                        });
                    }
                }
            }
            if (this.effects.burn.duration <= 0) this.effects.burn.active = false;
        }

        if (this.effects.slow.active) {
            hasSlow = true;
            this.effects.slow.duration -= dt;

            if (this.scene && Math.random() < 0.05) {
                const drip = this.scene.add.circle(
                    this.x + (Math.random() - 0.5) * 16, this.y - 10,
                    2 + Math.random() * 2, 0x4488ff, 0.7
                );
                this.scene.tweens.add({
                    targets: drip, y: drip.y + 30, alpha: 0, duration: 500,
                    onComplete: () => drip.destroy()
                });
            }

            if (this.effects.slow.duration <= 0) {
                this.effects.slow.active = false;
                this.effects.slow.amount = 1;
            }
        }

        this.updateEffectVisuals(hasBurn, hasSlow);
    }

    updateEffectVisuals(hasBurn, hasSlow) {
        if (hasBurn && hasSlow) this.setTint(0xdd66aa);
        else if (hasBurn)       this.setTint(0xff8844);
        else if (hasSlow)       this.setTint(0x6699ff);
        else                    this.clearTint();

        if (hasBurn || hasSlow) {
            if (!this.effectGlow) {
                this.effectGlow = this.scene.add.circle(this.x, this.y, 30, 0x000000, 0);
                this.effectGlow.setBlendMode(Phaser.BlendModes.ADD);
                this.effectGlow.setDepth(this.depth - 0.5);
            }
            this.effectGlow.setPosition(this.x, this.y);
            if (hasBurn) this.effectGlow.setFillStyle(0xff4400, 0.15);
            else         this.effectGlow.setFillStyle(0x4488ff, 0.12);
        } else if (this.effectGlow) {
            this.effectGlow.destroy();
            this.effectGlow = null;
        }
    }

    getSpeedMultiplier() {
        return this.effects.slow.active ? this.effects.slow.amount : 1;
    }

    updateHpBar() {
        this.hpBar.clear();
        const pct = this.hp / this.maxHp;
        const x   = this.x - 20;
        const y   = this.y - 35;
        this.hpBar.fillStyle(0x333333, 1);
        this.hpBar.fillRect(x, y, 40, 6);
        this.hpBar.fillStyle(pct > 0.5 ? 0x00ff00 : 0xff0000, 1);
        this.hpBar.fillRect(x, y, 40 * pct, 6);
    }

    takeDamage(amount, knockbackDir = null, knockbackForce = 0) {
        if (this.isDead) return;
        this.hp -= amount;

        if (knockbackDir && knockbackForce > 0) {
            this.applyForce({
                x: knockbackDir.x * knockbackForce * 0.001,
                y: knockbackDir.y * knockbackForce * 0.001
            });
        }

        this.setTint(0xffffff);
        this.scene.time.delayedCall(100, () => { if (!this.isDead) this.clearTint(); });
    }

    die() {
        if (this.isDead) return;
        this.isDead = true;

        // Death particles
        if (this.scene && this.scene.spawnParticles) {
            this.scene.spawnParticles(this.x, this.y, 0xff4444, 15);
        }

        // Splice from both enemy arrays
        if (this.scene && this.scene.enemies) {
            const i = this.scene.enemies.indexOf(this);
            if (i >= 0) this.scene.enemies.splice(i, 1);
        }
        if (GameState && GameState.enemies) {
            const j = GameState.enemies.indexOf(this);
            if (j >= 0) GameState.enemies.splice(j, 1);
        }

        // Notify GameScene if this is the boss
        if (this.scene && this.scene.boss === this) {
            this.scene.boss = null;
            if (this.scene.floorManager && this.scene.floorManager.currentFloor) {
                this.scene.floorManager.currentFloor.cleared = true;
            }
        }

        this.destroy();
    }

    destroy() {
        if (this.hpBar)      { try { this.hpBar.destroy();      } catch(e){} this.hpBar      = null; }
        if (this.effectGlow) { try { this.effectGlow.destroy(); } catch(e){} this.effectGlow = null; }
        if (this.shadow)     { try { this.shadow.destroy();     } catch(e){} this.shadow     = null; }
        if (this.body && this.scene && this.scene.matter) {
            try { this.scene.matter.world.remove(this.body); } catch(e) {}
            this.body = null;
        }
        try { super.destroy(); } catch(e) {}
    }
}

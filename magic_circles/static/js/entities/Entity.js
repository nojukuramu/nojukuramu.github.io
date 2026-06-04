/**
 * Entity - Base class for all game objects
 * 
 * Supports status effects: burn (Fire), slow (Water)
 */
class Entity {
    constructor(x, y, r, c) {
        this.pos = new Vec2(x, y);
        this.vel = new Vec2(0, 0);
        this.rad = r;
        this.col = c;
        this.dead = false;

        // Status Effects
        this.effects = {
            burn: { active: false, duration: 0, tickTimer: 0, damage: 0 },
            slow: { active: false, duration: 0, amount: 1 }
        };

        // Base speed (subclasses should set this)
        this.baseSpeed = 200;
    }

    /**
     * Apply a status effect to this entity
     */
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

    /**
     * Update status effects
     */
    updateEffects(dt) {
        // Burn effect
        if (this.effects.burn.active) {
            this.effects.burn.duration -= dt;
            this.effects.burn.tickTimer += dt;

            // Apply burn damage on tick
            if (this.effects.burn.tickTimer >= Config.Effects.Fire.burnTickRate) {
                this.effects.burn.tickTimer = 0;
                if (this.hp !== undefined) {
                    this.hp -= this.effects.burn.damage;
                }
                // Burn particles
                for (let i = 0; i < 3; i++) {
                    Game.parts.push(new Particle(
                        this.pos.x + (Math.random() - 0.5) * this.rad,
                        this.pos.y + (Math.random() - 0.5) * this.rad,
                        '#ff6600'
                    ));
                }
            }

            if (this.effects.burn.duration <= 0) {
                this.effects.burn.active = false;
            }
        }

        // Slow effect
        if (this.effects.slow.active) {
            this.effects.slow.duration -= dt;
            if (this.effects.slow.duration <= 0) {
                this.effects.slow.active = false;
                this.effects.slow.amount = 1;
            }
        }
    }

    /**
     * Get current speed multiplier from effects
     */
    getSpeedMultiplier() {
        if (this.effects.slow.active) {
            return this.effects.slow.amount;
        }
        return 1;
    }

    update(dt) {
        this.updateEffects(dt);
        this.pos = this.pos.add(this.vel.mul(dt * Game.timeScale));
        // No world bounds - infinite map
    }

    render(ctx, cam) {
        let sx = this.pos.x - cam.x + canvas.width / 2;
        let sy = this.pos.y - cam.y + canvas.height / 2;

        if (this.sprite && this.sprite.complete && this.sprite.naturalWidth > 0) {
            ctx.save();
            ctx.translate(sx, sy);
            // Rotate if velocity is significant
            if (this.vel.mag() > 1) {
                ctx.rotate(Math.atan2(this.vel.y, this.vel.x));
            }
            let size = this.rad * 2.5; // Scale up slightly for visual appeal
            ctx.drawImage(this.sprite, -size / 2, -size / 2, size, size);
            ctx.restore();
        } else {
            ctx.beginPath();
            ctx.arc(sx, sy, this.rad, 0, Math.PI * 2);
            ctx.fillStyle = this.col;
            ctx.fill();
        }
        return new Vec2(sx, sy);
    }
}

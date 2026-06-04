/**
 * Player - The player entity
 */
class Player extends Entity {
    constructor() {
        super(0, 0, 15, '#fff');
        this.sprite = Game.assets.player;
        this.hp = 100;
        this.stm = 100;
        this.mana = {
            Air: 100,
            Fire: 100,
            Earth: 100,
            Water: 100
        };
        this.castCooldown = 0;
        this.baseSpeed = Config.PlayerSpd;

        // Dash state
        this.isDashing = false;
        this.dashTimer = 0;
        this.dashCooldown = 0;
    }

    /**
     * Initiate a dash in the current movement or aim direction
     */
    dash() {
        // Check if can dash
        if (this.isDashing) return false;
        if (this.dashCooldown > 0) return false;
        if (this.stm < Config.Dash.staminaCost) return false;

        // Consume stamina
        this.stm -= Config.Dash.staminaCost;

        // Determine dash direction (movement direction, or aim if not moving)
        let dashDir = Input.move.mag() > 0.1 ? Input.move.norm() : Input.aim;

        // Apply dash velocity boost
        this.vel = this.vel.add(dashDir.mul(Config.Dash.speedBoost));

        // Start dash state
        this.isDashing = true;
        this.dashTimer = Config.Dash.duration;
        this.dashCooldown = Config.Dash.cooldown;

        // Dash effect particles
        for (let i = 0; i < 10; i++) {
            let p = new Particle(this.pos.x, this.pos.y, '#fff');
            p.vel = dashDir.mul(-200).add(Vec2.fromAngle(Math.random() * Math.PI * 2).mul(100));
            Game.parts.push(p);
        }

        return true;
    }

    update(dt) {
        // Cooldowns
        if (this.castCooldown > 0) this.castCooldown -= dt;
        if (this.dashCooldown > 0) this.dashCooldown -= dt;

        // Dash timer
        if (this.isDashing) {
            this.dashTimer -= dt;
            if (this.dashTimer <= 0) {
                this.isDashing = false;
            }

            // Spawn trail particles during dash
            if (Math.random() < 0.5) {
                let p = new Particle(this.pos.x, this.pos.y, '#aaf');
                p.vel = this.vel.mul(-0.3);
                Game.parts.push(p);
            }
        }

        // Movement with speed multiplier (affected by slow)
        let speedMult = this.getSpeedMultiplier();
        let maxSpeed = this.baseSpeed * speedMult;

        if (Input.move.mag() > 0) {
            this.vel = this.vel.add(Input.move.mul(2000 * dt * Game.timeScale * speedMult));
            // Only cap speed if NOT dashing (dash can exceed normal max speed)
            if (!this.isDashing && this.vel.mag() > maxSpeed) {
                this.vel = this.vel.norm().mul(maxSpeed);
            }
        }

        // Friction - DISABLED during dash to preserve momentum
        if (!this.isDashing) {
            if (Input.move.mag() === 0) {
                this.vel = this.vel.mul(0.85);
            }
        }
        // During dash: no friction, momentum preserved!

        super.update(dt);

        // Mana Regeneration
        this.mana.Air = Math.min(100, this.mana.Air + Config.ManaRegen.Air * dt);
        this.mana.Fire = Math.min(100, this.mana.Fire + Config.ManaRegen.Fire * dt);
        this.mana.Earth = Math.min(100, this.mana.Earth + Config.ManaRegen.Earth * dt);
        this.mana.Water = Math.min(100, this.mana.Water + Config.ManaRegen.Water * dt);

        // Stamina Regeneration (slower while dashing)
        let stmRegen = this.isDashing ? 2 : 10;
        this.stm = Math.min(100, this.stm + stmRegen * dt);
    }

    render(ctx, cam) {
        let s = super.render(ctx, cam);

        // Dash visual effect - player glows during dash
        if (this.isDashing) {
            ctx.beginPath();
            ctx.arc(s.x, s.y, this.rad * 1.5, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(150, 200, 255, 0.3)';
            ctx.fill();
        }

        // Aim Arrow
        let end = s.add(Input.aim.mul(40));
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(end.x, end.y);
        ctx.strokeStyle = '#ff0';
        ctx.lineWidth = 3;
        ctx.stroke();
    }
}

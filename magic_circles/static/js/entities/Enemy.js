/**
 * Enemy - Basic enemy entity
 */
class Enemy extends Entity {
    constructor(x, y) {
        super(x, y, 20, '#f44');
        this.sprite = Game.assets.enemy;
        this.maxHp = 100;
        this.hp = 100;
        this.baseSpeed = Config.EnemySpd;
    }

    update(dt, playerPos) {
        // Chase player with speed multiplier (affected by slow)
        let speedMult = this.getSpeedMultiplier();
        let maxSpeed = this.baseSpeed * speedMult;

        let dir = playerPos.sub(this.pos).norm();
        this.vel = this.vel.add(dir.mul(600 * dt * Game.timeScale * speedMult));

        if (this.vel.mag() > maxSpeed) {
            this.vel = this.vel.norm().mul(maxSpeed);
        }

        this.vel = this.vel.mul(0.96); // Friction
        super.update(dt);

        // Check if died from burn damage
        if (this.hp <= 0) this.respawn();
    }

    render(ctx, cam) {
        let s = super.render(ctx, cam);

        // HP Bar
        let pct = this.hp / this.maxHp;
        ctx.fillStyle = '#333';
        ctx.fillRect(s.x - 20, s.y - 30, 40, 6);
        ctx.fillStyle = pct > 0.5 ? '#0f0' : '#f00';
        ctx.fillRect(s.x - 20, s.y - 30, 40 * pct, 6);
    }

    respawn() {
        this.hp = this.maxHp;
        this.pos = new Vec2(
            (Math.random() - 0.5) * 1000,
            (Math.random() - 0.5) * 1000
        );
    }
}

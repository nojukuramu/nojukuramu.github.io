/**
 * Particle - Visual effect particle
 */
class Particle extends Entity {
    constructor(x, y, c) {
        super(x, y, Math.random() * 3 + 2, c);
        let a = Math.random() * Math.PI * 2;
        this.vel = Vec2.fromAngle(a).mul(Math.random() * 150);
        this.life = 0.5 + Math.random() * 0.3;
        this.sprite = Game.assets.particle;
        this.rot = Math.random() * Math.PI * 2;
        this.rotSpd = (Math.random() - 0.5) * 10;
    }

    update(dt) {
        this.vel = this.vel.mul(0.92); // Drag
        super.update(dt);
        this.life -= dt;
        this.rot += this.rotSpd * dt;
    }

    render(ctx, cam) {
        if (this.life <= 0) return;
        ctx.globalAlpha = Math.min(1, this.life * 2);

        if (this.sprite && this.sprite.complete && this.sprite.naturalWidth > 0) {
            ctx.globalCompositeOperation = 'lighter';
            let sx = this.pos.x - cam.x + canvas.width / 2;
            let sy = this.pos.y - cam.y + canvas.height / 2;
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(this.rot);
            let s = this.rad * 4;
            ctx.drawImage(this.sprite, -s / 2, -s / 2, s, s);
            ctx.restore();
            ctx.globalCompositeOperation = 'source-over';
        } else {
            super.render(ctx, cam);
        }
        ctx.globalAlpha = 1;
    }
}

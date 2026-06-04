/**
 * Vec2 - 2D Vector Math Utility
 */
class Vec2 {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }

    add(v) {
        return new Vec2(this.x + v.x, this.y + v.y);
    }

    sub(v) {
        return new Vec2(this.x - v.x, this.y - v.y);
    }

    mul(s) {
        return new Vec2(this.x * s, this.y * s);
    }

    mag() {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    norm() {
        let m = this.mag();
        return m === 0 ? new Vec2(0, 0) : new Vec2(this.x / m, this.y / m);
    }

    dist(v) {
        return Math.sqrt((this.x - v.x) ** 2 + (this.y - v.y) ** 2);
    }

    angle() {
        return Math.atan2(this.y, this.x);
    }

    dot(v) {
        return this.x * v.x + this.y * v.y;
    }

    static fromAngle(r) {
        return new Vec2(Math.cos(r), Math.sin(r));
    }
}

// Export for module usage
if (typeof module !== 'undefined') module.exports = Vec2;

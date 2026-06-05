/**
 * TouchControls — orientation-aware, claw-grip-friendly on-screen controls.
 *
 *  bottom-left  : MOVE stick (left thumb)
 *  bottom-right : AIM / CHANNEL stick (right thumb) — releases a cast on lift
 *  right cluster: BLINK (dash) · RELEASE (remote-trigger)   — thumb or claw index
 *  top-right    : FORGE (open the Spellforge)               — claw index reach
 *
 * Everything re-lays-out on resize so portrait and landscape both work, and the
 * slot hotbar (DOM) is kept clear of the sticks. Buttons are hit-tested by rect
 * so multi-touch / claw grips never get swallowed by Phaser's input ordering.
 */
class TouchControls {
    constructor(scene) {
        this.scene = scene;
        this.leftPtr = null;
        this.rightPtr = null;
        this.lKnob = { x: 0, y: 0 };
        this.rKnob = { x: 0, y: 0 };
        this.consumed = {};          // pointerId -> true (a button press, not a stick)
        this.buttons = [];

        this.gfx = scene.add.graphics().setScrollFactor(0).setDepth(2000);

        this._buildButtons();
        this.layout();

        scene.input.on('pointerdown', this._onDown, this);
        scene.input.on('pointermove', this._onMove, this);
        scene.input.on('pointerup', this._onUp, this);

        this._onResize = () => this.layout();
        scene.scale.on('resize', this._onResize);
        scene.events.once('shutdown', () => this.destroy());
    }

    _buildButtons() {
        const mk = (key, label, color, action) => {
            const c = this.scene.add.container(0, 0).setScrollFactor(0).setDepth(2001);
            const bg = this.scene.add.graphics();
            const txt = this.scene.add.text(0, 0, label, { fontFamily: 'Arial Black', fontSize: '13px', color: '#ffffff' }).setOrigin(0.5);
            c.add([bg, txt]);
            const b = { key, label, color, action, c, bg, txt, rect: { x: 0, y: 0, w: 70, h: 70 } };
            this.buttons.push(b);
            return b;
        };
        mk('blink', 'BLINK', 0x55aaff, () => { if (this.scene.player) this.scene.player.dash(); });
        mk('release', 'RELEASE', 0xcc66ff, () => { this.scene.remoteTrigger(); });
        mk('forge', 'FORGE', 0x66ddaa, () => { if (!GameState.isMagicOpen) this.scene.openMagicEditor(); });
    }

    layout() {
        const W = this.scene.cameras.main.width, H = this.scene.cameras.main.height;
        const portrait = H >= W;

        // stick geometry scales with the smaller screen dimension
        this.r = Math.max(46, Math.min(82, Math.min(W, H) * 0.13));
        const m = this.r * 0.55 + 16;     // margin from the corner
        this.lx = m + this.r;
        this.ly = H - m - this.r;
        this.rx = W - m - this.r;
        this.ry = H - m - this.r;

        const bs = Math.max(58, this.r * 0.92);  // button size (touch target)
        const place = (b, x, y) => { b.rect = { x: x - bs / 2, y: y - bs / 2, w: bs, h: bs }; b.c.setPosition(x, y); this._drawButton(b, false); };

        // RELEASE + BLINK stack above-left of the aim stick; FORGE top-right corner.
        const cluX = this.rx - this.r - bs * 0.7;
        place(this.buttons[0], cluX, this.ry - bs * 0.2);                 // blink (lower)
        place(this.buttons[1], cluX, this.ry - bs * 1.3);                 // release (upper)
        place(this.buttons[2], W - bs / 2 - 12, bs / 2 + (portrait ? 60 : 14)); // forge (top-right, below the hotbar in portrait)

        this.drawSticks();
    }

    _drawButton(b, pressed) {
        const w = b.rect.w, h = b.rect.h;
        b.bg.clear();
        b.bg.fillStyle(0x0a0c16, pressed ? 0.9 : 0.55);
        b.bg.fillCircle(0, 0, w / 2);
        b.bg.lineStyle(3, b.color, pressed ? 1 : 0.85);
        b.bg.strokeCircle(0, 0, w / 2);
        b.txt.setFontSize(Math.max(11, Math.floor(w * 0.2)));
    }

    drawSticks() {
        const g = this.gfx;
        g.clear();
        // move stick
        g.lineStyle(3, 0xffffff, 0.25); g.strokeCircle(this.lx, this.ly, this.r);
        g.fillStyle(0xffffff, 0.5); g.fillCircle(this.lx + this.lKnob.x, this.ly + this.lKnob.y, this.r * 0.42);
        // aim / channel stick
        g.lineStyle(3, 0xff99cc, 0.3); g.strokeCircle(this.rx, this.ry, this.r);
        g.fillStyle(0xff99cc, 0.5); g.fillCircle(this.rx + this.rKnob.x, this.ry + this.rKnob.y, this.r * 0.42);
    }

    _hitButton(x, y) {
        for (const b of this.buttons) {
            const r = b.rect;
            if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return b;
        }
        return null;
    }

    _onDown(pointer) {
        const b = this._hitButton(pointer.x, pointer.y);
        if (b) {
            this.consumed[pointer.id] = true;
            this._drawButton(b, true);
            this.scene.time.delayedCall(110, () => this._drawButton(b, false));
            try { b.action(); } catch (e) { console.warn('touch button recovered:', e); }
            return;
        }
        const half = this.scene.cameras.main.width / 2;
        if (pointer.x < half && this.leftPtr === null) { this.leftPtr = pointer.id; this._updateLeft(pointer.x, pointer.y); }
        else if (pointer.x >= half && this.rightPtr === null) { this.rightPtr = pointer.id; this._updateRight(pointer.x, pointer.y); }
    }

    _onMove(pointer) {
        if (pointer.id === this.leftPtr) this._updateLeft(pointer.x, pointer.y);
        if (pointer.id === this.rightPtr) this._updateRight(pointer.x, pointer.y);
    }

    _onUp(pointer) {
        if (this.consumed[pointer.id]) { delete this.consumed[pointer.id]; return; }
        if (pointer.id === this.leftPtr) {
            this.leftPtr = null; this.lKnob = { x: 0, y: 0 };
            if (this.scene.player) this.scene.player.setMoveVector(0, 0);
            this.drawSticks();
        }
        if (pointer.id === this.rightPtr) {
            // fire on release if the stick was actually pushed (avoids accidental taps)
            const pushed = Math.hypot(this.rKnob.x, this.rKnob.y) > this.r * 0.2;
            if (pushed && !GameState.isMagicOpen) { try { this.scene.castSpell(); } catch (e) { console.warn('cast recovered:', e); } }
            this.rightPtr = null; this.rKnob = { x: 0, y: 0 };
            this.drawSticks();
        }
    }

    _updateLeft(px, py) {
        const dx = px - this.lx, dy = py - this.ly, d = Math.hypot(dx, dy) || 1;
        const cl = Math.min(d, this.r), nx = dx / d, ny = dy / d;
        this.lKnob = { x: nx * cl, y: ny * cl };
        if (this.scene.player) this.scene.player.setMoveVector(nx, ny);
        this.drawSticks();
    }
    _updateRight(px, py) {
        const dx = px - this.rx, dy = py - this.ry, d = Math.hypot(dx, dy) || 1;
        const cl = Math.min(d, this.r), nx = dx / d, ny = dy / d;
        this.rKnob = { x: nx * cl, y: ny * cl };
        if (this.scene.player) this.scene.player.setAimAngle(Math.atan2(ny, nx));
        this.drawSticks();
    }

    destroy() {
        try {
            this.scene.input.off('pointerdown', this._onDown, this);
            this.scene.input.off('pointermove', this._onMove, this);
            this.scene.input.off('pointerup', this._onUp, this);
            if (this._onResize) this.scene.scale.off('resize', this._onResize);
            this.gfx.destroy();
            this.buttons.forEach(b => b.c.destroy());
        } catch (e) { /* already torn down */ }
    }
}

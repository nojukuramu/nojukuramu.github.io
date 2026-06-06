/**
 * TouchControls — orientation-aware, claw-grip-friendly on-screen controls.
 *
 *  bottom-left  : MOVE stick (left thumb)
 *  bottom-right : AIM stick (right thumb) — sets aim direction; it does NOT cast
 *  near aim stick: CAST (throw the spell) · TRIGGER (detonate payload) · BLINK (dash)
 *  top-right    : FORGE (Spellforge) · MENU (game menu)
 *
 * Casting only happens when CAST is tapped — touching the sticks or any other
 * button never fires a spell. Aim persists after you lift the stick, so the
 * flow is: nudge aim → tap CAST.
 */
class TouchControls {
    constructor(scene) {
        this.scene = scene;
        this.leftPtr = null;
        this.rightPtr = null;
        this.lKnob = { x: 0, y: 0 };
        this.rKnob = { x: 0, y: 0 };
        this.consumed = {};
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
        const mk = (key, label, color, big, action) => {
            const c = this.scene.add.container(0, 0).setScrollFactor(0).setDepth(2001);
            const bg = this.scene.add.graphics();
            const txt = this.scene.add.text(0, 0, label, { fontFamily: 'Arial Black', fontSize: '13px', color: '#ffffff' }).setOrigin(0.5);
            c.add([bg, txt]);
            const b = { key, label, color, big: !!big, action, c, bg, txt, rect: { x: 0, y: 0, w: 70, h: 70 } };
            this.buttons.push(b);
            return b;
        };
        // primary
        mk('cast', 'CAST', 0xffcc44, true, () => { if (!GameState.isMagicOpen) { try { this.scene.castSpell(); } catch (e) { console.warn('cast recovered:', e); } } });
        mk('trigger', 'TRIGGER', 0xcc66ff, false, () => { if (!GameState.isMagicOpen) { try { this.scene.remoteTrigger(); } catch (e) { console.warn('trigger recovered:', e); } } });
        mk('blink', 'BLINK', 0x55aaff, false, () => { if (this.scene.player) this.scene.player.dash(); });
        mk('forge', 'FORGE', 0x66ddaa, false, () => { if (!GameState.isMagicOpen) this.scene.openMagicEditor(); });
        mk('menu', 'MENU', 0xaab0c0, false, () => { if (window.GameMenu) window.GameMenu.open(); });
    }

    _byKey(k) { return this.buttons.find(b => b.key === k); }

    layout() {
        const W = this.scene.cameras.main.width, H = this.scene.cameras.main.height;
        const portrait = H >= W;

        this.r = Math.max(46, Math.min(82, Math.min(W, H) * 0.13));
        const m = this.r * 0.55 + 16;
        this.lx = m + this.r;  this.ly = H - m - this.r;
        this.rx = W - m - this.r;  this.ry = H - m - this.r;

        const bs = Math.max(54, this.r * 0.86);     // standard button
        const cs = bs * 1.32;                        // CAST (bigger)
        const place = (b, x, y, size) => {
            const s = size || bs;
            b.rect = { x: x - s / 2, y: y - s / 2, w: s, h: s };
            b.c.setPosition(x, y);
            this._drawButton(b, false);
        };

        // action cluster around the aim stick (right thumb / claw index)
        place(this._byKey('cast'), this.rx, this.ry - this.r - cs * 0.58, cs);          // big, straight above aim
        place(this._byKey('trigger'), this.rx - this.r - bs * 0.55, this.ry - bs * 0.1); // left of aim stick
        place(this._byKey('blink'), this.lx, this.ly - this.r - bs * 0.6);               // above move stick

        // top-right utilities (kept below the top hotbar in portrait)
        const topY = portrait ? 60 : 12;
        place(this._byKey('forge'), W - bs / 2 - 10, topY + bs / 2);
        place(this._byKey('menu'), W - bs / 2 - 10, topY + bs / 2 + bs + 8);

        this.drawSticks();
    }

    _drawButton(b, pressed) {
        const w = b.rect.w;
        b.bg.clear();
        b.bg.fillStyle(0x0a0c16, pressed ? 0.92 : 0.58);
        b.bg.fillCircle(0, 0, w / 2);
        b.bg.lineStyle(b.big ? 4 : 3, b.color, pressed ? 1 : (b.big ? 0.95 : 0.85));
        b.bg.strokeCircle(0, 0, w / 2);
        b.txt.setFontSize(Math.max(11, Math.floor(w * (b.big ? 0.24 : 0.2))));
        b.txt.setColor(b.big ? '#fff3cc' : '#ffffff');
    }

    drawSticks() {
        const g = this.gfx;
        g.clear();
        g.lineStyle(3, 0xffffff, 0.25); g.strokeCircle(this.lx, this.ly, this.r);
        g.fillStyle(0xffffff, 0.5); g.fillCircle(this.lx + this.lKnob.x, this.ly + this.lKnob.y, this.r * 0.42);
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
            // aim persists after release (no auto-cast); CAST button does the casting
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

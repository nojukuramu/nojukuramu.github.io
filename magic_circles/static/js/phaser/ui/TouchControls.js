/**
 * TouchControls — on-canvas twin-stick + action buttons for mobile.
 *
 * Left side:  virtual move-stick  (finger 1)
 * Right side: aim/fire stick       (finger 2, fire on release)
 * Bottom bar: Dash | Remote | Editor | slots 1-4  (tap targets)
 *
 * Drives the player via player.setMoveVector() / player.setAimAngle() /
 * player.triggerCast() / player.triggerDash() / player.triggerRemote() /
 * player.openEditor().
 */
class TouchControls {
    constructor(scene) {
        this.scene = scene;

        const w = scene.cameras.main.width;
        const h = scene.cameras.main.height;

        this.stickRadius = 60;
        this.stickPad    = 100; // distance from edge to stick centre

        // Left stick centre
        this.lx = this.stickPad;
        this.ly = h - this.stickPad;

        // Right stick centre
        this.rx = w - this.stickPad;
        this.ry = h - this.stickPad;

        // Track pointer assignments
        this.leftPtr  = null; // pointer id assigned to move stick
        this.rightPtr = null; // pointer id assigned to aim stick

        // Current knob offsets
        this.lKnob = { x: 0, y: 0 };
        this.rKnob = { x: 0, y: 0 };

        this.gfx = scene.add.graphics().setDepth(2000).setScrollFactor(0);
        this.drawSticks();

        // Action buttons container
        this.btns = [];
        this._buildButtons(w, h);

        // Input listeners
        scene.input.on('pointerdown',  this._onDown,  this);
        scene.input.on('pointermove',  this._onMove,  this);
        scene.input.on('pointerup',    this._onUp,    this);
    }

    _buildButtons(w, h) {
        const btnDefs = [
            { label: 'DASH',   x: w / 2 - 140, action: () => { if (this.scene.player) this.scene.player.dash(); } },
            { label: 'RCLICK', x: w / 2 - 50,  action: () => { this.scene.remoteTrigger(); } },
            { label: 'EDITOR', x: w / 2 + 50,  action: () => { this.scene.openMagicEditor(); } },
        ];

        // Add slot buttons (4 visible slots on mobile)
        for (let i = 0; i < 4; i++) {
            btnDefs.push({
                label: `${i + 1}`,
                x: w / 2 + 140 + i * 55,
                action: () => {
                    this.scene.inventorySystem.selectSlot(i);
                    this.scene.updateInventoryUI();
                }
            });
        }

        for (const def of btnDefs) {
            const container = this.scene.add.container(def.x, this.scene.cameras.main.height - 40)
                .setDepth(2001).setScrollFactor(0);

            const bg = this.scene.add.graphics();
            bg.fillStyle(0x222244, 0.8);
            bg.fillRoundedRect(-36, -20, 72, 40, 8);
            bg.lineStyle(2, 0x6666aa, 1);
            bg.strokeRoundedRect(-36, -20, 72, 40, 8);

            const label = this.scene.add.text(0, 0, def.label, {
                fontFamily: 'Arial', fontSize: '13px', color: '#ffffff'
            }).setOrigin(0.5);

            container.add([bg, label]);
            container.setSize(72, 40);
            container.setInteractive({ useHandCursor: false });
            container.on('pointerdown', def.action);
            this.btns.push(container);
        }
    }

    drawSticks() {
        this.gfx.clear();

        // Left stick base
        this.gfx.lineStyle(3, 0xffffff, 0.3);
        this.gfx.strokeCircle(this.lx, this.ly, this.stickRadius);
        // Left knob
        this.gfx.fillStyle(0xffffff, 0.5);
        this.gfx.fillCircle(this.lx + this.lKnob.x, this.ly + this.lKnob.y, 22);

        // Right stick base
        this.gfx.lineStyle(3, 0xff8888, 0.3);
        this.gfx.strokeCircle(this.rx, this.ry, this.stickRadius);
        // Right knob
        this.gfx.fillStyle(0xff8888, 0.5);
        this.gfx.fillCircle(this.rx + this.rKnob.x, this.ry + this.rKnob.y, 22);
    }

    _onDown(pointer) {
        const hw = this.scene.cameras.main.width / 2;
        if (pointer.x < hw && this.leftPtr === null) {
            this.leftPtr = pointer.id;
            this._updateLeft(pointer.x, pointer.y);
        } else if (pointer.x >= hw && this.rightPtr === null) {
            this.rightPtr = pointer.id;
            this._updateRight(pointer.x, pointer.y);
        }
    }

    _onMove(pointer) {
        if (pointer.id === this.leftPtr)  this._updateLeft(pointer.x, pointer.y);
        if (pointer.id === this.rightPtr) this._updateRight(pointer.x, pointer.y);
    }

    _onUp(pointer) {
        if (pointer.id === this.leftPtr) {
            this.leftPtr = null;
            this.lKnob = { x: 0, y: 0 };
            if (this.scene.player) this.scene.player.setMoveVector(0, 0);
            this.drawSticks();
        }
        if (pointer.id === this.rightPtr) {
            // Fire on release
            if (!GameState.isMagicOpen) this.scene.castSpell();
            this.rightPtr = null;
            this.rKnob = { x: 0, y: 0 };
            this.drawSticks();
        }
    }

    _updateLeft(px, py) {
        const dx = px - this.lx;
        const dy = py - this.ly;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const clamped = Math.min(dist, this.stickRadius);
        const nx = dx / dist;
        const ny = dy / dist;
        this.lKnob = { x: nx * clamped, y: ny * clamped };
        if (this.scene.player) this.scene.player.setMoveVector(nx, ny);
        this.drawSticks();
    }

    _updateRight(px, py) {
        const dx = px - this.rx;
        const dy = py - this.ry;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const clamped = Math.min(dist, this.stickRadius);
        const nx = dx / dist;
        const ny = dy / dist;
        this.rKnob = { x: nx * clamped, y: ny * clamped };
        if (this.scene.player) {
            this.scene.player.setAimAngle(Math.atan2(ny, nx));
        }
        this.drawSticks();
    }

    destroy() {
        this.gfx.destroy();
        for (const btn of this.btns) btn.destroy();
        this.scene.input.off('pointerdown',  this._onDown,  this);
        this.scene.input.off('pointermove',  this._onMove,  this);
        this.scene.input.off('pointerup',    this._onUp,    this);
    }
}

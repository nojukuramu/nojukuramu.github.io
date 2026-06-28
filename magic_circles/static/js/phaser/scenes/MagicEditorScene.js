/**
 * MagicEditorScene — "The Spellforge"
 *
 * A touch-first, freely zoom/pannable arcane editor.
 *  - WEAVE   : bind stars (12-point ring) into glyphs, draw seals (circles), etch runes
 *  - SHIFT   : drag seals to reposition (or drag the void to pan)
 *  - UNMAKE  : tap a seal/glyph to dissolve it
 *  - DRIFT   : pan the canvas
 *  - pinch / wheel to zoom, two-finger drag to pan, ley-grid snapping
 *
 * Coordinate model: content is drawn in "design space" into a single Graphics
 * layer whose position/scale form the view transform (pan = position, zoom =
 * scale). Design space == legacy screen coords at the identity view, so existing
 * saved spells stay compatible. UI lives in screen space (untransformed).
 */
class MagicEditorScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MagicEditorScene' });
    }

    create() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // ---- state ----
        this.tool = 'weave';               // weave | shift | unmake | drift
        this.dragMode = null;              // 'shape' | 'circle' | 'move' | 'pan' | null
        this.dragStart = null;             // design-space
        this.dragCurrent = null;           // design-space
        this.currentPath = [];
        this.movingCircle = null;          // {item, grabDX, grabDY}
        this.undoHistory = [];
        this.maxUndoSteps = 30;
        this.stabilityText = null;
        this.buttons = {};
        this.uiRects = [];

        // view transform (design -> screen):  screen = design * scale + pan
        this.view = { scale: 1, panX: 0, panY: 0 };

        // pinch tracking
        this._pinch = null;

        // dim backdrop (screen space)
        this.overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x05060c, 0.88)
            .setScrollFactor(0);

        // the DOM slot hotbar floats above the canvas — tuck it away while forging
        this._invBar = (typeof document !== 'undefined') ? document.getElementById('inventory-bar') : null;
        if (this._invBar) this._invBar.style.display = 'none';

        // content layer (design space; pan/zoom via its own transform)
        this.graphics = this.add.graphics();

        this.initNodes();
        this.createUI();
        this.setupInput();
        this.loadFromCurrentScroll();
        this.recenterView(false);
        this.layoutUI();
        this.renderMagic();

        // keyboard
        this.input.keyboard.on('keydown-ESC', () => this.close());
        this.input.keyboard.on('keydown-M', () => this.close());
        this.input.keyboard.on('keydown-Z', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.undoLastEdit(); } });
        this.input.keyboard.on('keydown-PLUS', () => this.zoomAt(this.cx(), this.cy(), 1.2));
        this.input.keyboard.on('keydown-MINUS', () => this.zoomAt(this.cx(), this.cy(), 1 / 1.2));

        // resize / orientation
        this.scale.on('resize', this.onResize, this);
        this.events.once('shutdown', () => this.scale.off('resize', this.onResize, this));
    }

    cx() { return this.cameras.main.width / 2; }
    cy() { return this.cameras.main.height / 2; }
    isMobile() { return !!(GameState && GameState.isMobile); }
    isPortrait() { return this.cameras.main.height >= this.cameras.main.width; }

    /* =====================  view transform  ===================== */
    w2s(x, y) { return { x: x * this.view.scale + this.view.panX, y: y * this.view.scale + this.view.panY }; }
    s2w(x, y) { return { x: (x - this.view.panX) / this.view.scale, y: (y - this.view.panY) / this.view.scale }; }

    applyView() {
        if (this.graphics) this.graphics.setPosition(this.view.panX, this.view.panY).setScale(this.view.scale);
    }
    zoomAt(sx, sy, factor) {
        const before = this.s2w(sx, sy);
        const lo = Config.EditorMinZoom || 0.35, hi = Config.EditorMaxZoom || 3.2;
        this.view.scale = Math.max(lo, Math.min(hi, this.view.scale * factor));
        this.view.panX = sx - before.x * this.view.scale;
        this.view.panY = sy - before.y * this.view.scale;
        this.renderMagic();
    }
    panBy(dx, dy) { this.view.panX += dx; this.view.panY += dy; this.renderMagic(); }
    recenterView(preserveScale) {
        if (!preserveScale) this.view.scale = 1;
        this.view.panX = this.cx() - this.centerX * this.view.scale;
        this.view.panY = this.cy() - this.centerY * this.view.scale;
    }
    fitView() { this.recenterView(false); this.renderMagic(); }

    onResize() {
        // keep the ring centred across rotations; reflow UI
        const W = this.cameras.main.width, H = this.cameras.main.height;
        if (this.overlay) this.overlay.setPosition(W / 2, H / 2).setSize(W, H);
        this.recenterView(true);
        this.layoutUI();
        this.renderMagic();
    }

    /* =====================  nodes  ===================== */
    initNodes() {
        this.centerX = this.cx();
        this.centerY = this.cy();
        this.baseRadius = Math.min(this.centerX, this.centerY) * 0.55;

        this.baseNodes = [];
        this.nodes = [];
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
            const bx = this.centerX + Math.cos(angle) * this.baseRadius;
            const by = this.centerY + Math.sin(angle) * this.baseRadius;
            this.baseNodes.push({ x: bx, y: by });
            this.nodes.push({ x: bx, y: by, id: i, used: false });
        }
        this.syncNodeUsedState();
        this.refreshNodePositions();
    }

    // Potency -> ring spread.  LOWER potency = narrower ring = smaller glyphs.
    nodeScale(power) {
        const p = Math.max(1, Math.min(10, power || 1));
        const lo = Config.EditorMinNodeScale != null ? Config.EditorMinNodeScale : 0.5;
        const hi = Config.EditorMaxNodeScale != null ? Config.EditorMaxNodeScale : 1.45;
        return lo + ((p - 1) / 9) * (hi - lo);
    }
    scalePoint(base, scale) {
        if (!base) return { x: this.centerX, y: this.centerY };
        return {
            x: this.centerX + (base.x - this.centerX) * scale,
            y: this.centerY + (base.y - this.centerY) * scale
        };
    }
    getActiveLayerPower() { const l = this.getActiveLayer(); return (l && l.power) || 1; }
    refreshNodePositions() {
        if (!this.nodes || !this.baseNodes) return;
        const scale = this.nodeScale(this.getActiveLayerPower());
        for (let i = 0; i < this.nodes.length; i++) {
            const s = this.scalePoint(this.baseNodes[i], scale);
            this.nodes[i].x = s.x; this.nodes[i].y = s.y;
        }
    }
    syncNodeUsedState() {
        this.nodes.forEach(n => n.used = false);
        for (let layer of GameState.magic.layers) {
            for (let item of layer.items) {
                if (item.type === 'SHAPE') item.data.points.forEach(pid => { if (this.nodes[pid]) this.nodes[pid].used = true; });
            }
        }
    }

    /* =====================  UI  ===================== */
    createUI() {
        this.titleText = this.add.text(0, 0, '✦ THE SPELLFORGE', {
            fontFamily: 'Arial Black', fontSize: '22px', color: '#e9e6ff'
        }).setOrigin(0.5, 0).setScrollFactor(0);

        this.instrText = this.add.text(0, 0, 'bind the stars · draw seals in the void · etch runes on their rims', {
            fontFamily: 'Arial', fontSize: '12px', color: '#8e8bb5'
        }).setOrigin(0.5, 0).setScrollFactor(0);

        // action buttons
        this.makeButton('depart', 'DEPART', () => this.close(), { fill: 0x3a2740, stroke: 0x9a6aaa });
        this.makeButton('dispel', 'DISPEL', () => this.clearAll(), { fill: 0x40262a, stroke: 0xaa6a6a });
        this.makeButton('ley', 'LEY LINES', () => this.toggleSnapToGrid(), { fill: 0x223344, stroke: 0x4a88aa });
        this.makeButton('invoke', 'INVOKE', () => this.castAndClose(), { fill: 0x2a2a55, stroke: 0x7a7aff });

        // tool dock
        this.makeButton('weave', '✶ Weave', () => this.setTool('weave'), { fill: 0x24305a, stroke: 0x6a7aff, tool: true });
        this.makeButton('shift', '✥ Shift', () => this.setTool('shift'), { fill: 0x24305a, stroke: 0x6a7aff, tool: true });
        this.makeButton('unmake', '✖ Unmake', () => this.setTool('unmake'), { fill: 0x24305a, stroke: 0x6a7aff, tool: true });
        this.makeButton('drift', '✣ Drift', () => this.setTool('drift'), { fill: 0x24305a, stroke: 0x6a7aff, tool: true });

        // zoom
        this.makeButton('zin', '+', () => this.zoomAt(this.cx(), this.cy(), 1.25), { fill: 0x202a40, stroke: 0x5a6aaa, square: true });
        this.makeButton('zout', '–', () => this.zoomAt(this.cx(), this.cy(), 1 / 1.25), { fill: 0x202a40, stroke: 0x5a6aaa, square: true });
        this.makeButton('zfit', '⊡', () => this.fitView(), { fill: 0x202a40, stroke: 0x5a6aaa, square: true });
        this.makeButton('undo', '⟲', () => this.undoLastEdit(), { fill: 0x202a40, stroke: 0x5a6aaa, square: true });

        this.createLayerPanel();
        this.createPowerSlider();

        this.legendText = this.add.text(0, 0, '3★ Air   4★ Fire   5★ Earth   6★ Water', {
            fontFamily: 'Arial', fontSize: '12px', color: '#9aa0c0'
        }).setOrigin(0.5, 1).setScrollFactor(0);

        this.stabilityText = this.add.text(0, 0, 'HARMONY: 100%', {
            fontFamily: 'Arial', fontSize: '13px', color: '#88ff88'
        }).setOrigin(0.5, 0).setScrollFactor(0);

        this.tierText = this.add.text(0, 0, 'TIER: —', {
            fontFamily: 'Arial', fontSize: '13px', color: '#888888'
        }).setOrigin(0.5, 0).setScrollFactor(0);

        this.updateToolButtons();
        this.updateLeyBtn();
    }

    // touch-friendly button factory; positions are set later in layoutUI()
    makeButton(key, label, cb, opts) {
        opts = opts || {};
        const c = this.add.container(0, 0).setScrollFactor(0);
        const bg = this.add.graphics();
        const txt = this.add.text(0, 0, label, {
            fontFamily: 'Arial', fontSize: this.isMobile() ? '15px' : '14px', color: '#ffffff'
        }).setOrigin(0.5);
        c.add([bg, txt]);
        c.bgGfx = bg; c.labelText = txt;
        c.baseFill = opts.fill != null ? opts.fill : 0x2a2a55;
        c.baseStroke = opts.stroke != null ? opts.stroke : 0x7a7aff;
        c.isSquare = !!opts.square;
        c.isTool = !!opts.tool;
        c.cb = cb;
        c.setInteractive(new Phaser.Geom.Rectangle(-10, -10, 20, 20), Phaser.Geom.Rectangle.Contains);
        c.on('pointerover', () => c.setScale(1.04));
        c.on('pointerout', () => c.setScale(1));
        c.on('pointerdown', (p, lx, ly, ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); cb(); });
        this.buttons[key] = c;
        return c;
    }

    styleButton(key, active) {
        const c = this.buttons[key]; if (!c) return;
        const w = c.bw, h = c.bh;
        if (w == null || h == null) return; // not laid out yet
        const fill = active ? 0x4a6a3a : c.baseFill;
        const stroke = active ? 0x9bff9b : c.baseStroke;
        c.bgGfx.clear();
        c.bgGfx.fillStyle(fill, 1); c.bgGfx.fillRoundedRect(-w / 2, -h / 2, w, h, 8);
        c.bgGfx.lineStyle(2, stroke, 1); c.bgGfx.strokeRoundedRect(-w / 2, -h / 2, w, h, 8);
    }

    placeButton(key, x, y, w, h) {
        const c = this.buttons[key]; if (!c) return;
        c.bw = w; c.bh = h;
        c.setPosition(x, y);
        c.input.hitArea.setTo(-w / 2, -h / 2, w, h);
        this.styleButton(key, (c.isTool && this.tool === key) || (key === 'ley' && GameState.magic.snapToGrid));
        this.uiRects.push({ x: x - w / 2, y: y - h / 2, w: w, h: h });
    }

    layoutUI() {
        const W = this.cameras.main.width, H = this.cameras.main.height;
        const pad = this.isMobile() ? 14 : 16;
        const bh = this.isMobile() ? 46 : 38;        // button height (touch target)
        const sq = this.isMobile() ? 46 : 38;        // square button size
        const portrait = this.isPortrait();
        this.uiRects = [];

        // title
        this.titleText.setPosition(W / 2, 8).setFontSize(portrait ? 18 : 22);
        this.instrText.setPosition(W / 2, portrait ? 32 : 36).setVisible(!this.isMobile() || !portrait);

        // ---- action buttons: top row, centred ----
        const actions = ['depart', 'dispel', 'ley', 'invoke'];
        const aw = portrait ? Math.min(96, (W - pad * 2) / 4 - 6) : 104;
        const ay = portrait ? 60 : 70;
        let totalW = actions.length * aw + (actions.length - 1) * 8;
        let ax = W / 2 - totalW / 2 + aw / 2;
        actions.forEach(k => { this.placeButton(k, ax, ay, aw, bh); ax += aw + 8; });

        // ---- tool dock: left edge, vertical ----
        const tw = portrait ? 104 : 116;
        let ty = ay + bh + (portrait ? 16 : 30);
        const tx = pad + tw / 2;
        ['weave', 'shift', 'unmake', 'drift'].forEach(k => { this.placeButton(k, tx, ty, tw, bh); ty += bh + 8; });

        // ---- zoom + undo: bottom-left, vertical ----
        let zy = H - pad - sq / 2;
        ['undo', 'zfit', 'zout', 'zin'].forEach(k => { this.placeButton(k, pad + sq / 2, zy, sq, sq); zy -= sq + 8; });

        // ---- weaves (layer) panel: right edge ----
        const lpx = W - (portrait ? 150 : 168), lpy = ay + bh + (portrait ? 16 : 30);
        this.layerPanel.setPosition(lpx, lpy);
        this.updateLayerPanel();
        const rows = Math.max(1, GameState.magic.layers.length);
        this.uiRects.push({ x: lpx - 16, y: lpy - 8, w: (portrait ? 150 : 168) + 16, h: 30 + rows * (this.isMobile() ? 40 : 36) + 12 });

        // ---- potency slider: right edge, below weaves panel ----
        const pcx = W - (portrait ? 86 : 96);
        const pcy = H - (portrait ? 120 : 150);
        if (this.powerContainer) this.powerContainer.setPosition(pcx, pcy);
        this.uiRects.push({ x: pcx - 70, y: pcy - 44, w: 140, h: 100 });

        // ---- readouts ----
        this.stabilityText.setPosition(W / 2, portrait ? 90 : 100);
        this.tierText.setPosition(W / 2, portrait ? 108 : 118);
        this.legendText.setPosition(W / 2, H - 8);

        this.applyView();
    }

    setTool(t) {
        this.tool = t;
        // cancel any in-progress action when switching tools
        this.cancelDrag();
        this.updateToolButtons();
        this.renderMagic();
    }
    updateToolButtons() {
        ['weave', 'shift', 'unmake', 'drift'].forEach(k => this.styleButton(k, this.tool === k));
    }

    createLayerPanel() {
        this.layerPanel = this.add.container(0, 0).setScrollFactor(0);
        const title = this.add.text(0, 0, 'WEAVES', { fontFamily: 'Arial', fontSize: '13px', color: '#aab0ff' });
        const addBtn = this.add.text(72, 0, '[+]', { fontFamily: 'Arial', fontSize: '15px', color: '#88ff88' })
            .setInteractive({ useHandCursor: true });
        addBtn.on('pointerdown', (p, lx, ly, ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); this.createLayer(); });
        const delBtn = this.add.text(104, 0, '[×]', { fontFamily: 'Arial', fontSize: '15px', color: '#ff8888' })
            .setInteractive({ useHandCursor: true });
        delBtn.on('pointerdown', (p, lx, ly, ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); this.deleteActiveLayer(); });
        this.layerPanel.add([title, addBtn, delBtn]);
        this.updateLayerPanel();
    }

    updateLayerPanel() {
        if (!this.layerPanel) return;
        while (this.layerPanel.list.length > 3) {
            this.layerPanel.list[this.layerPanel.list.length - 1].destroy();
            this.layerPanel.list.pop();
        }
        let yPos = 22;
        for (let i = GameState.magic.layers.length - 1; i >= 0; i--) {
            const layer = GameState.magic.layers[i];
            const isActive = layer.id === GameState.magic.activeLayerId;
            const shapes = layer.items.filter(it => it.type === 'SHAPE').map(it => it.data.element);
            const circles = layer.items.filter(it => it.type === 'CIRCLE').length;
            let desc = shapes.join(', ');
            if (circles > 0) desc += (desc ? ', ' : '') + `${circles}○`;
            if (!desc) desc = 'empty';

            const row = this.add.text(0, yPos, `${isActive ? '▶' : '  '} ${layer.name}`, {
                fontFamily: 'Arial', fontSize: this.isMobile() ? '13px' : '12px',
                color: isActive ? '#ffffff' : '#9090b0',
                backgroundColor: isActive ? '#3a3a66' : null, padding: { x: 5, y: 3 }
            }).setInteractive({ useHandCursor: true });
            row.on('pointerdown', (p, lx, ly, ev) => {
                if (ev && ev.stopPropagation) ev.stopPropagation();
                GameState.magic.activeLayerId = layer.id;
                this.updateLayerPanel(); this.updatePowerSliderVisibility();
                this.refreshNodePositions(); this.renderMagic();
            });
            const sub = this.add.text(0, yPos + (this.isMobile() ? 20 : 18), desc, {
                fontFamily: 'Arial', fontSize: '10px', color: '#6c6c8c'
            });
            this.layerPanel.add([row, sub]);
            yPos += this.isMobile() ? 40 : 36;
        }
        if (GameState.magic.layers.length === 0) {
            this.layerPanel.add(this.add.text(0, yPos, 'no weaves — tap [+]', { fontFamily: 'Arial', fontSize: '11px', color: '#6c6c8c' }));
        }
    }

    createPowerSlider() {
        this.powerContainer = this.add.container(0, 0).setScrollFactor(0);
        const label = this.add.text(0, -28, 'POTENCY', { fontFamily: 'Arial', fontSize: '12px', color: '#c0a0ff' }).setOrigin(0.5);
        const hint = this.add.text(0, 40, '(star spread)', { fontFamily: 'Arial', fontSize: '10px', color: '#8888aa' }).setOrigin(0.5);
        const track = this.add.rectangle(0, 0, 120, 10, 0x2a2a4a).setStrokeStyle(1, 0x6666aa);
        this.powerHandle = this.add.circle(-55, 0, this.isMobile() ? 16 : 12, 0x8a6aff).setStrokeStyle(2, 0xc0a0ff);
        this.powerHandle.setInteractive({ draggable: true, useHandCursor: true });
        this.powerValue = this.add.text(0, 20, `×${this.getActiveLayerPower()}`, { fontFamily: 'Arial', fontSize: '15px', color: '#ffffff' }).setOrigin(0.5);
        this.powerContainer.add([label, track, this.powerHandle, this.powerValue, hint]);

        this.input.setDraggable(this.powerHandle);
        this.input.on('drag', (pointer, obj, dragX) => {
            try {
                if (obj === this.powerHandle) {
                    dragX = Phaser.Math.Clamp(dragX, -55, 55);
                    this.powerHandle.x = dragX;
                    const t = (dragX + 55) / 110;
                    const power = Math.round(1 + t * 9);
                    const layer = this.getActiveLayer();
                    if (layer) layer.power = power;
                    GameState.magic.powerMultiplier = power;
                    this.powerValue.setText(`×${power}`);
                    this.refreshNodePositions();
                    this.renderMagic();
                }
            } catch (err) { console.warn('Spellforge potency-drag recovered:', err); }
        });
        this.updatePowerSliderVisibility();
    }
    syncPowerSlider() {
        const power = this.getActiveLayerPower();
        const t = (power - 1) / 9;
        if (this.powerHandle) this.powerHandle.x = -55 + t * 110;
        if (this.powerValue) this.powerValue.setText(`×${power}`);
    }
    updatePowerSliderVisibility() {
        const layer = this.getActiveLayer();
        if (this.powerContainer) this.powerContainer.setVisible(!!layer);
        if (layer) this.syncPowerSlider();
    }

    /* =====================  input  ===================== */
    setupInput() {
        if (this.input.mouse && this.input.mouse.disableContextMenu) this.input.mouse.disableContextMenu();
        this.input.on('pointerdown', (p) => { try { this.onDown(p); } catch (e) { console.warn('Spellforge down recovered:', e); } });
        this.input.on('pointermove', (p) => { try { this.onMove(p); } catch (e) { console.warn('Spellforge move recovered:', e); } });
        this.input.on('pointerup', (p) => { try { this.onUp(p); } catch (e) { console.warn('Spellforge up recovered:', e); } });

        // desktop wheel zoom
        this.input.on('wheel', (p, objs, dx, dy) => {
            this.zoomAt(p.x, p.y, dy > 0 ? 1 / 1.12 : 1.12);
        });
    }

    overUI(sx, sy) {
        for (const r of this.uiRects) {
            if (sx >= r.x && sx <= r.x + r.w && sy >= r.y && sy <= r.y + r.h) return true;
        }
        return false;
    }

    pinchActive() {
        const p1 = this.input.pointer1, p2 = this.input.pointer2;
        return p1 && p2 && p1.isDown && p2.isDown;
    }

    cancelDrag() {
        if (this.dragMode === 'shape' && this.currentPath.length) {
            this.currentPath.forEach(id => { if (this.nodes[id]) this.nodes[id].used = false; });
        }
        this.dragMode = null; this.currentPath = []; this.dragStart = null;
        this.dragCurrent = null; this.movingCircle = null;
    }

    onDown(pointer) {
        // entering a two-finger pinch: abort whatever single-finger action started
        if (this.pinchActive()) {
            this.cancelDrag();
            this._pinch = this.pinchState();
            return;
        }
        if (this.overUI(pointer.x, pointer.y)) return;

        const p = this.s2w(pointer.x, pointer.y);

        // right button always pans (desktop)
        if (pointer.rightButtonDown && pointer.rightButtonDown()) { this.dragMode = 'pan'; this.dragStart = { x: pointer.x, y: pointer.y }; return; }

        if (this.tool === 'drift') { this.dragMode = 'pan'; this.dragStart = { x: pointer.x, y: pointer.y }; return; }

        if (this.tool === 'unmake') { this.eraseAt(p); return; }

        if (this.tool === 'shift') {
            const hit = this.getCircleAt(p);
            if (hit) {
                this.saveUndoState();
                this.movingCircle = { item: hit.item, grabDX: p.x - hit.item.data.center.x, grabDY: p.y - hit.item.data.center.y };
                this.dragMode = 'move';
            } else {
                this.dragMode = 'pan'; this.dragStart = { x: pointer.x, y: pointer.y };
            }
            return;
        }

        // ---- WEAVE (default smart tool) ----
        const hitNode = this.getNodeAt(p.x, p.y);
        if (hitNode && !hitNode.used) {
            this.saveUndoState(); this.ensureActiveLayer();
            this.dragMode = 'shape'; this.currentPath = [hitNode.id]; hitNode.used = true;
            this.renderMagic(); return;
        }
        const rune = this.checkRuneClick(p);
        if (rune) {
            this.saveUndoState();
            if (rune.runeIndex >= 0) rune.circle.runes.splice(rune.runeIndex, 1);
            else rune.circle.runes.push(Math.atan2(p.y - rune.circle.center.y, p.x - rune.circle.center.x));
            this.renderMagic(); return;
        }
        this.saveUndoState();
        this.dragMode = 'circle'; this.dragStart = p; this.dragCurrent = p;
    }

    onMove(pointer) {
        if (this.pinchActive()) { this.updatePinch(); return; }
        const p = this.s2w(pointer.x, pointer.y);

        if (this.dragMode === 'pan') {
            if (this.dragStart) { this.panBy(pointer.x - this.dragStart.x, pointer.y - this.dragStart.y); this.dragStart = { x: pointer.x, y: pointer.y }; }
            return;
        }
        if (this.dragMode === 'move' && this.movingCircle) {
            let nx = p.x - this.movingCircle.grabDX, ny = p.y - this.movingCircle.grabDY;
            if (GameState.magic.snapToGrid) { nx = this.snapX(nx); ny = this.snapY(ny); }
            this.movingCircle.item.data.center.x = nx;
            this.movingCircle.item.data.center.y = ny;
            this.renderMagic(); return;
        }
        if (this.dragMode === 'shape') {
            const hitNode = this.getNodeAt(p.x, p.y);
            if (hitNode) {
                if (hitNode.id === this.currentPath[0] && this.currentPath.length > 2) {
                    const element = this.getElement(this.currentPath.length);
                    const layer = this.getActiveLayer();
                    if (layer) layer.items.push({ type: 'SHAPE', data: { points: [...this.currentPath], element } });
                    this.currentPath = []; this.dragMode = null; this.updateLayerPanel();
                } else if (!hitNode.used) {
                    this.currentPath.push(hitNode.id); hitNode.used = true;
                }
            }
            this.renderMagic(); return;
        }
        if (this.dragMode === 'circle') { this.dragCurrent = p; this.renderMagic(); return; }
    }

    onUp(pointer) {
        if (this._pinch && !this.pinchActive()) { this._pinch = null; }

        if (this.dragMode === 'circle' && this.dragStart && this.dragCurrent) {
            const dx = this.dragCurrent.x - this.dragStart.x, dy = this.dragCurrent.y - this.dragStart.y;
            let radius = Math.sqrt(dx * dx + dy * dy);
            let cx = this.dragStart.x, cy = this.dragStart.y;
            if (GameState.magic.snapToGrid) { cx = this.snapX(cx); cy = this.snapY(cy); radius = this.snapLen(radius); }
            if (radius > 18) {
                this.ensureActiveLayer();
                const layer = this.getActiveLayer();
                if (layer) layer.items.push({ type: 'CIRCLE', data: { center: { x: cx, y: cy }, rad: radius, runes: [] } });
                this.updateLayerPanel(); this.updatePowerSliderVisibility();
            }
        }
        if (this.dragMode === 'shape' && this.currentPath.length > 0) {
            this.currentPath.forEach(id => { if (this.nodes[id]) this.nodes[id].used = false; });
        }
        this.dragMode = null; this.currentPath = []; this.dragStart = null; this.dragCurrent = null; this.movingCircle = null;
        this.renderMagic();
    }

    /* ---- pinch (two-finger zoom + pan) ---- */
    pinchState() {
        const p1 = this.input.pointer1, p2 = this.input.pointer2;
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
        return { mx, my, d };
    }
    updatePinch() {
        const now = this.pinchState();
        if (!this._pinch) { this._pinch = now; return; }
        // zoom about midpoint by distance ratio
        this.zoomAt(now.mx, now.my, now.d / (this._pinch.d || now.d));
        // pan by midpoint movement
        this.panBy(now.mx - this._pinch.mx, now.my - this._pinch.my);
        this._pinch = now;
    }

    /* =====================  hit tests (design space)  ===================== */
    getNodeAt(x, y) {
        const hitR = (this.isMobile() ? 56 : 30) / this.view.scale;
        for (let n of this.nodes) { if (Math.hypot(x - n.x, y - n.y) < hitR) return n; }
        return null;
    }
    checkRuneClick(p) {
        const edgeTol = 22 / this.view.scale, runeTol = 16 / this.view.scale;
        for (let layer of GameState.magic.layers) {
            if (!layer.visible) continue;
            for (let item of layer.items) {
                if (item.type !== 'CIRCLE') continue;
                const c = item.data, dist = Math.hypot(p.x - c.center.x, p.y - c.center.y);
                if (Math.abs(dist - c.rad) < edgeTol) {
                    for (let i = 0; i < c.runes.length; i++) {
                        const rx = c.center.x + Math.cos(c.runes[i]) * c.rad, ry = c.center.y + Math.sin(c.runes[i]) * c.rad;
                        if (Math.hypot(p.x - rx, p.y - ry) < runeTol) return { circle: c, runeIndex: i };
                    }
                    return { circle: c, runeIndex: -1 };
                }
            }
        }
        return null;
    }
    getCircleAt(p) {
        const tol = 18 / this.view.scale;
        for (let li = GameState.magic.layers.length - 1; li >= 0; li--) {
            const layer = GameState.magic.layers[li];
            if (!layer.visible) continue;
            for (let ii = layer.items.length - 1; ii >= 0; ii--) {
                const item = layer.items[ii];
                if (item.type !== 'CIRCLE') continue;
                if (Math.hypot(p.x - item.data.center.x, p.y - item.data.center.y) <= item.data.rad + tol) {
                    return { layer, item, index: ii };
                }
            }
        }
        return null;
    }
    getShapeAt(p) {
        for (let li = GameState.magic.layers.length - 1; li >= 0; li--) {
            const layer = GameState.magic.layers[li];
            if (!layer.visible) continue;
            const sc = this.nodeScale(layer.power);
            for (let ii = layer.items.length - 1; ii >= 0; ii--) {
                const item = layer.items[ii];
                if (item.type !== 'SHAPE') continue;
                const poly = item.data.points.map(pid => this.scalePoint(this.baseNodes[pid], sc));
                if (this.pointInPoly(p, poly)) return { layer, item, index: ii };
            }
        }
        return null;
    }
    pointInPoly(pt, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
            if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)) inside = !inside;
        }
        return inside;
    }
    eraseAt(p) {
        const c = this.getCircleAt(p);
        if (c) { this.saveUndoState(); c.layer.items.splice(c.index, 1); this.afterStructureChange(); return; }
        const s = this.getShapeAt(p);
        if (s) {
            this.saveUndoState();
            s.item.data.points.forEach(pid => { if (this.nodes[pid]) this.nodes[pid].used = false; });
            s.layer.items.splice(s.index, 1); this.syncNodeUsedState(); this.afterStructureChange(); return;
        }
    }
    afterStructureChange() { this.updateLayerPanel(); this.updatePowerSliderVisibility(); this.renderMagic(); }

    /* =====================  layers  ===================== */
    getElement(n) { return n === 3 ? 'Air' : n === 4 ? 'Fire' : n === 5 ? 'Earth' : n === 6 ? 'Water' : 'Fire'; }
    getActiveLayer() { return GameState.magic.layers.find(l => l.id === GameState.magic.activeLayerId); }
    ensureActiveLayer() { if (GameState.magic.layers.length === 0 || !this.getActiveLayer()) this.createLayer(); }
    createLayer(name) {
        const id = Date.now() + Math.floor(Math.random() * 1000);
        GameState.magic.layers.push({ id, name: name || `Weave ${GameState.magic.layers.length + 1}`, visible: true, solo: false, power: 1, items: [] });
        GameState.magic.activeLayerId = id;
        this.updateLayerPanel(); this.updatePowerSliderVisibility(); this.refreshNodePositions();
    }
    deleteActiveLayer() {
        const idx = GameState.magic.layers.findIndex(l => l.id === GameState.magic.activeLayerId);
        if (idx === -1) return;
        this.saveUndoState();
        const layer = GameState.magic.layers[idx];
        layer.items.forEach(it => { if (it.type === 'SHAPE') it.data.points.forEach(pid => { if (this.nodes[pid]) this.nodes[pid].used = false; }); });
        GameState.magic.layers.splice(idx, 1);
        GameState.magic.activeLayerId = GameState.magic.layers.length > 0 ? GameState.magic.layers[Math.max(0, idx - 1)].id : -1;
        this.syncNodeUsedState(); this.refreshNodePositions();
        this.updateLayerPanel(); this.updatePowerSliderVisibility(); this.renderMagic();
    }

    /* =====================  undo  ===================== */
    saveUndoState() {
        this.undoHistory.push(JSON.stringify(GameState.magic.layers));
        if (this.undoHistory.length > this.maxUndoSteps) this.undoHistory.shift();
    }
    undoLastEdit() {
        if (this.undoHistory.length === 0) return;
        GameState.magic.layers = JSON.parse(this.undoHistory.pop());
        this.syncNodeUsedState();
        GameState.magic.activeLayerId = GameState.magic.layers.length > 0 ? GameState.magic.layers[0].id : -1;
        this.refreshNodePositions();
        this.updateLayerPanel(); this.updatePowerSliderVisibility(); this.renderMagic();
    }
    clearAll() {
        this.saveUndoState();
        GameState.magic.layers = []; GameState.magic.activeLayerId = -1; GameState.magic.powerMultiplier = 1;
        this.nodes.forEach(n => n.used = false); this.currentPath = [];
        this.createLayer(); this.syncPowerSlider(); this.refreshNodePositions(); this.renderMagic();
    }

    /* =====================  render  ===================== */
    renderMagic() {
        try {
            this.applyView();
            const g = this.graphics;
            g.clear();

            // ley-grid — centred on the star ring (so it's symmetric on every
            // screen) and finer the more you zoom in (for fine-grained control).
            if (GameState.magic.snapToGrid) {
                const step = this.gridStep();
                const cgx = this.centerX, cgy = this.centerY;
                const tl = this.s2w(0, 0), br = this.s2w(this.cameras.main.width, this.cameras.main.height);
                const kx0 = Math.floor((tl.x - cgx) / step), kx1 = Math.ceil((br.x - cgx) / step);
                const ky0 = Math.floor((tl.y - cgy) / step), ky1 = Math.ceil((br.y - cgy) / step);
                const yTop = cgy + ky0 * step, yBot = cgy + ky1 * step;
                const xLeft = cgx + kx0 * step, xRight = cgx + kx1 * step;
                for (let k = kx0; k <= kx1; k++) {
                    const x = cgx + k * step;
                    // emphasise the centre lines and every 4th line
                    g.lineStyle(1, 0x3a5a4a, k === 0 ? 0.85 : (k % 4 === 0 ? 0.5 : 0.28));
                    g.lineBetween(x, yTop, x, yBot);
                }
                for (let k = ky0; k <= ky1; k++) {
                    const y = cgy + k * step;
                    g.lineStyle(1, 0x3a5a4a, k === 0 ? 0.85 : (k % 4 === 0 ? 0.5 : 0.28));
                    g.lineBetween(xLeft, y, xRight, y);
                }
            }

            // guide ring + quadrant axes (centred on the star ring)
            const cx = this.centerX, cy = this.centerY, R = this.baseRadius * this.nodeScale(this.getActiveLayerPower());
            g.lineStyle(1, 0x40406a, 0.5);
            g.strokeCircle(cx, cy, this.baseRadius);
            g.strokeCircle(cx, cy, this.baseRadius * 0.6);
            g.lineStyle(1, 0x445566, 0.5);
            g.lineBetween(cx, cy - this.baseRadius, cx, cy + this.baseRadius);
            g.lineBetween(cx - this.baseRadius, cy, cx + this.baseRadius, cy);

            // harmony (stored for casting)
            const stability = this.computeStability();
            GameState.magic.stability = stability;
            const pct = Math.round(stability * 100);
            const col = stability > 0.7 ? '#88ff88' : stability > 0.4 ? '#ffdd55' : '#ff6666';
            if (this.stabilityText) { this.stabilityText.setText(`HARMONY: ${pct}%`).setColor(col); }

            // Tier preview
            if (this.tierText && typeof computeThreatScore !== 'undefined') {
                const layers = GameState.magic.layers;
                // Mirror GameScene's cast logic: first circle-layer is the container; rest are payloads
                const circleLayers   = layers.filter(l => l.items.some(i => i.type === 'CIRCLE'));
                const circleCount    = circleLayers.length > 0
                    ? circleLayers[0].items.filter(i => i.type === 'CIRCLE').length : 0;
                const payloadLayers  = Math.max(0, circleLayers.length - 1);
                const shapes         = layers.flatMap(l => l.items.filter(i => i.type === 'SHAPE').map(i => i.data));
                const uniqueElements = new Set(shapes.map(s => s.element)).size;
                const powerMult      = GameState.magic.powerMultiplier || 1;
                const basePower      = (50 + shapes.length * 25) * powerMult;
                const firstCircle    = circleLayers.length > 0
                    ? circleLayers[0].items.find(i => i.type === 'CIRCLE') : null;
                const firstRad       = firstCircle ? firstCircle.data.rad : 30;
                const spectrum       = (typeof scoreSpectrum !== 'undefined')
                    ? scoreSpectrum(basePower, firstRad) : 'DART';
                const score          = computeThreatScore({ basePower, spectrum, uniqueElements, payloadLayers, circleCount, stability });
                const { tier }       = scoreToTier(score);
                const tierColor      = (typeof TIER_COLORS !== 'undefined' && TIER_COLORS[tier]) || '#888888';
                this.tierText.setText(`TIER: ${tier}`).setColor(tierColor);
            }

            // stars (nodes)
            for (let n of this.nodes) {
                g.fillStyle(n.used ? 0x555566 : 0xffffff, 1);
                g.fillCircle(n.x, n.y, 7);
                g.lineStyle(2, n.used ? 0x444455 : 0xaab0ff, 1);
                g.strokeCircle(n.x, n.y, 7);
            }

            const COL = { Air: 0xA0E0E0, Fire: 0xE06060, Earth: 0x80C060, Water: 0x4080E0 };

            for (let li = 0; li < GameState.magic.layers.length; li++) {
                const layer = GameState.magic.layers[li];
                if (!layer.visible) continue;
                const sc = this.nodeScale(layer.power);
                const pos = (pid) => this.scalePoint(this.baseNodes[pid], sc);

                for (let item of layer.items) {
                    if (item.type === 'SHAPE') {
                        const s = item.data, color = COL[s.element] || 0xffffff;
                        const start = pos(s.points[0]);
                        g.fillStyle(color, 0.18); g.beginPath(); g.moveTo(start.x, start.y);
                        for (let pid of s.points) { const pt = pos(pid); g.lineTo(pt.x, pt.y); }
                        g.closePath(); g.fillPath();
                        g.lineStyle(3, color, 1); g.beginPath(); g.moveTo(start.x, start.y);
                        for (let pid of s.points) { const pt = pos(pid); g.lineTo(pt.x, pt.y); }
                        g.closePath(); g.strokePath();
                    } else if (item.type === 'CIRCLE') {
                        const c = item.data, isBlunt = c.rad > (Config.SharpRadiusThreshold || 40);
                        g.lineStyle(3, isBlunt ? 0xdd00dd : 0xffff00, 1);
                        g.strokeCircle(c.center.x, c.center.y, c.rad);
                        for (let a of c.runes) {
                            const rx = c.center.x + Math.cos(a) * c.rad, ry = c.center.y + Math.sin(a) * c.rad;
                            g.fillStyle(0xffffff, 1); g.fillCircle(rx, ry, 5);
                            g.lineStyle(2, 0xffffff, 1); g.lineBetween(rx, ry, rx + Math.cos(a) * 18, ry + Math.sin(a) * 18);
                        }
                    }
                }
            }

            // in-progress glyph
            if (this.currentPath.length > 0) {
                g.lineStyle(3, 0xffffff, 0.85); g.beginPath();
                const s0 = this.nodes[this.currentPath[0]]; g.moveTo(s0.x, s0.y);
                for (let pid of this.currentPath) g.lineTo(this.nodes[pid].x, this.nodes[pid].y);
                g.strokePath();
            }
            // seal preview
            if (this.dragMode === 'circle' && this.dragStart && this.dragCurrent) {
                const r = Math.hypot(this.dragCurrent.x - this.dragStart.x, this.dragCurrent.y - this.dragStart.y);
                g.lineStyle(2, 0x9090b0, 0.6); g.strokeCircle(this.dragStart.x, this.dragStart.y, r);
            }
        } catch (err) { console.warn('Spellforge render recovered:', err); }
    }

    /* =====================  grid / ley lines  ===================== */
    // Effective grid step: a power-of-two multiple of the base unit chosen so the
    // on-screen spacing stays readable — i.e. the grid gets finer as you zoom in.
    gridStep() {
        const base = Config.EditorGridSize || 40;
        const target = 46; // desired on-screen px between lines
        let k = Math.round(Math.log2(target / (base * (this.view.scale || 1))));
        const step = base * Math.pow(2, k);
        return Math.max(2, Math.min(base * 8, step));
    }
    // Snap relative to the ring centre so placements are symmetric about it.
    snapX(v) { const s = this.gridStep(); return this.centerX + Math.round((v - this.centerX) / s) * s; }
    snapY(v) { const s = this.gridStep(); return this.centerY + Math.round((v - this.centerY) / s) * s; }
    snapLen(v) { const s = this.gridStep(); return Math.round(v / s) * s; }
    toggleSnapToGrid() {
        GameState.magic.snapToGrid = !GameState.magic.snapToGrid;
        this.styleButton('ley', GameState.magic.snapToGrid);
        this.renderMagic();
    }
    updateLeyBtn() { this.styleButton('ley', GameState.magic.snapToGrid); }

    /* =====================  harmony (4-quadrant symmetry)  ===================== */
    computeStability() {
        if (!this.baseNodes || !this.cameras || !this.cameras.main) return 1.0;
        if (!GameState.magic || !GameState.magic.layers) return 1.0;
        const cx = this.centerX, cy = this.centerY;
        const tol = (Config.Instability && Config.Instability.symTolerance) || 30;
        const features = [];
        for (const layer of GameState.magic.layers) {
            if (!layer.visible) continue;
            for (const item of layer.items) {
                if (item.type === 'CIRCLE') {
                    const c = item.data;
                    features.push({ x: c.center.x - cx, y: c.center.y - cy, tag: 'circ' });
                    for (const a of c.runes) features.push({ x: Math.cos(a) * c.rad, y: Math.sin(a) * c.rad, tag: 'rune' });
                } else if (item.type === 'SHAPE') {
                    for (const pid of item.data.points) {
                        const n = this.baseNodes[pid]; if (!n) continue;
                        features.push({ x: n.x - cx, y: n.y - cy, tag: item.data.element });
                    }
                }
            }
        }
        if (features.length === 0) return 1.0;
        let satisfied = 0; const total = features.length * 3;
        for (const f of features) {
            const mirrors = [{ x: -f.x, y: f.y }, { x: f.x, y: -f.y }, { x: -f.x, y: -f.y }];
            for (const m of mirrors) {
                if (features.some(o => o.tag === f.tag && Math.abs(o.x - m.x) < tol && Math.abs(o.y - m.y) < tol)) satisfied++;
            }
        }
        return satisfied / total;
    }

    /* =====================  lifecycle  ===================== */
    castAndClose() { this.close(); this.scene.get('GameScene').events.emit('cast-spell'); }
    close() {
        if (GameState.inventorySystem) GameState.inventorySystem.saveMagicToScroll(GameState.magic);
        if (this._invBar) this._invBar.style.display = 'flex'; // restore the hotbar
        GameState.timeScale = 1.0; GameState.isMagicOpen = false;
        this.scene.resume('GameScene'); this.scene.stop();
    }
    loadFromCurrentScroll() {
        if (!GameState.inventorySystem) return;
        const scrollData = GameState.inventorySystem.loadMagicFromScroll();
        if (!scrollData) return;
        GameState.magic.layers = scrollData.layers;
        GameState.magic.powerMultiplier = scrollData.powerMultiplier;
        GameState.magic.layers.forEach(l => { if (l.power == null) l.power = scrollData.powerMultiplier || 1; });
        GameState.magic.activeLayerId = GameState.magic.layers.length > 0 ? GameState.magic.layers[0].id : -1;
        this.syncNodeUsedState(); this.refreshNodePositions(); this.syncPowerSlider();
        this.updateLayerPanel(); this.updatePowerSliderVisibility();
    }
}

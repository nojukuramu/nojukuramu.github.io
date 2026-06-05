/**
 * MagicEditorScene - Complete Magic Editor with:
 * - SHAPE drawing (connect 12 nodes to form polygons -> elements)
 * - CIRCLE drawing (drag to create circles -> containers)
 * - RUNES on circles (click edge to add/remove)
 * - LAYERS system (multiple layers, visibility, solo)
 * - POWER slider (affects first layer circles)
 * - UNDO support (Ctrl+Z)
 */
class MagicEditorScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MagicEditorScene' });
    }

    create() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // Semi-transparent overlay
        this.overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.85);

        // State
        this.dragMode = null; // 'shape' or 'circle'
        this.dragStart = null;
        this.dragCurrent = null;
        this.currentPath = [];
        this.undoHistory = [];
        this.maxUndoSteps = 20;

        // Initialize nodes (12 in a circle)
        this.initNodes();

        // Main graphics for rendering
        this.graphics = this.add.graphics();

        // UI Elements
        this.createUI();

        // Input
        this.setupInput();

        // Load magic data from current scroll
        this.loadFromCurrentScroll();

        // Initial render
        this.renderMagic();

        // Keyboard shortcuts
        this.input.keyboard.on('keydown-ESC', () => this.close());
        this.input.keyboard.on('keydown-M', () => this.close());

        // Ctrl+Z for undo
        this.input.keyboard.on('keydown-Z', (event) => {
            if (event.ctrlKey) {
                event.preventDefault();
                this.undoLastEdit();
            }
        });
    }

    initNodes() {
        const cx = this.cameras.main.width / 2;
        const cy = this.cameras.main.height / 2;
        const radius = Math.min(cx, cy) * 0.5;
        const snap = GameState.magic.snapToGrid;

        this.nodes = [];
        for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
            let nx = cx + Math.cos(angle) * radius;
            let ny = cy + Math.sin(angle) * radius;
            if (snap) {
                nx = this.snapVal(nx);
                ny = this.snapVal(ny);
            }
            this.nodes.push({ x: nx, y: ny, id: i, used: false });
        }

        // Sync used state from GameState
        this.syncNodeUsedState();
    }

    syncNodeUsedState() {
        // Reset all
        this.nodes.forEach(n => n.used = false);

        // Mark used nodes from existing shapes
        for (let layer of GameState.magic.layers) {
            for (let item of layer.items) {
                if (item.type === 'SHAPE') {
                    item.data.points.forEach(pid => {
                        if (this.nodes[pid]) this.nodes[pid].used = true;
                    });
                }
            }
        }
    }

    createUI() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // Title
        this.add.text(width / 2, 30, 'MAGIC EDITOR', {
            fontFamily: 'Arial Black',
            fontSize: '24px',
            color: '#ffffff'
        }).setOrigin(0.5);

        // Instructions
        this.add.text(width / 2, 60, 'Connect nodes for elements • Drag in empty space for circles', {
            fontFamily: 'Arial',
            fontSize: '14px',
            color: '#aaaaaa'
        }).setOrigin(0.5);

        // Right side buttons
        const btnX = width - 80;
        this.createButton(btnX, 120, 'CLOSE', () => this.close());
        this.createButton(btnX, 170, 'RESET', () => this.clearAll());
        this.createButton(btnX, 220, 'CAST', () => this.castAndClose());
        this.magnetBtn = this.createButton(btnX, 270, 'MAGNET', () => this.toggleSnapToGrid());

        // Layer panel on the left
        this.createLayerPanel();

        // Power slider (only visible when first layer has circles)
        this.createPowerSlider();

        // Element legend at bottom
        this.createElementLegend();
    }

    createButton(x, y, text, callback) {
        const btn = this.add.container(x, y);

        const bg = this.add.graphics();
        bg.fillStyle(0x333366, 1);
        bg.fillRoundedRect(-50, -18, 100, 36, 6);
        bg.lineStyle(2, 0x6666aa);
        bg.strokeRoundedRect(-50, -18, 100, 36, 6);

        const label = this.add.text(0, 0, text, {
            fontFamily: 'Arial',
            fontSize: '14px',
            color: '#ffffff'
        }).setOrigin(0.5);

        btn.add([bg, label]);
        btn.setSize(100, 36);
        btn.setInteractive({ useHandCursor: true });

        btn.on('pointerover', () => btn.setScale(1.05));
        btn.on('pointerout', () => btn.setScale(1));
        btn.on('pointerdown', callback);

        return btn;
    }

    createLayerPanel() {
        const x = 20;
        const y = 120;

        this.layerPanel = this.add.container(x, y);

        // Title
        const title = this.add.text(0, 0, 'LAYERS', {
            fontFamily: 'Arial',
            fontSize: '14px',
            color: '#aaaaff'
        });
        this.layerPanel.add(title);

        // Buttons row
        const addBtn = this.add.text(60, 0, '[+]', {
            fontFamily: 'Arial',
            fontSize: '14px',
            color: '#88ff88'
        }).setInteractive({ useHandCursor: true });
        addBtn.on('pointerdown', () => this.createLayer());

        const delBtn = this.add.text(85, 0, '[×]', {
            fontFamily: 'Arial',
            fontSize: '14px',
            color: '#ff8888'
        }).setInteractive({ useHandCursor: true });
        delBtn.on('pointerdown', () => this.deleteActiveLayer());

        this.layerPanel.add([addBtn, delBtn]);

        this.updateLayerPanel();
    }

    updateLayerPanel() {
        // Remove old layer items (keep title and buttons at indices 0, 1, 2)
        while (this.layerPanel.list.length > 3) {
            this.layerPanel.list[this.layerPanel.list.length - 1].destroy();
            this.layerPanel.list.pop();
        }

        let yPos = 25;

        // Render layers in reverse (top to bottom visually)
        for (let i = GameState.magic.layers.length - 1; i >= 0; i--) {
            const layer = GameState.magic.layers[i];
            const isActive = layer.id === GameState.magic.activeLayerId;

            // Get content description
            const shapes = layer.items.filter(it => it.type === 'SHAPE').map(it => it.data.element);
            const circles = layer.items.filter(it => it.type === 'CIRCLE').length;
            let desc = shapes.join(', ');
            if (circles > 0) desc += (desc ? ', ' : '') + `${circles}○`;
            if (!desc) desc = 'Empty';

            const layerText = this.add.text(0, yPos, `${isActive ? '▶' : '  '} ${layer.name}`, {
                fontFamily: 'Arial',
                fontSize: '12px',
                color: isActive ? '#ffffff' : '#888888',
                backgroundColor: isActive ? '#444488' : null,
                padding: { x: 4, y: 2 }
            }).setInteractive({ useHandCursor: true });

            layerText.on('pointerdown', () => {
                GameState.magic.activeLayerId = layer.id;
                this.updateLayerPanel();
                this.updatePowerSliderVisibility();
            });

            const descText = this.add.text(100, yPos, desc, {
                fontFamily: 'Arial',
                fontSize: '10px',
                color: '#666666'
            });

            this.layerPanel.add([layerText, descText]);
            yPos += 22;
        }

        // If no layers, show message
        if (GameState.magic.layers.length === 0) {
            const msg = this.add.text(0, yPos, 'No layers. Click + to add.', {
                fontFamily: 'Arial',
                fontSize: '11px',
                color: '#666666'
            });
            this.layerPanel.add(msg);
        }
    }

    createPowerSlider() {
        const x = this.cameras.main.width - 80;
        const y = 300;

        this.powerContainer = this.add.container(x, y);

        const label = this.add.text(0, -25, 'POWER', {
            fontFamily: 'Arial',
            fontSize: '12px',
            color: '#aaaaff'
        }).setOrigin(0.5);

        // Track
        const track = this.add.rectangle(0, 0, 80, 8, 0x333366);
        track.setStrokeStyle(1, 0x6666aa);

        // Handle
        this.powerHandle = this.add.circle(-35, 0, 10, 0x6666aa);
        this.powerHandle.setStrokeStyle(2, 0xaaaaff);
        this.powerHandle.setInteractive({ draggable: true, useHandCursor: true });

        // Value
        this.powerValue = this.add.text(0, 20, `×${GameState.magic.powerMultiplier}`, {
            fontFamily: 'Arial',
            fontSize: '14px',
            color: '#ffffff'
        }).setOrigin(0.5);

        this.powerContainer.add([label, track, this.powerHandle, this.powerValue]);

        // Drag handling
        this.input.setDraggable(this.powerHandle);
        this.input.on('drag', (pointer, gameObject, dragX) => {
            if (gameObject === this.powerHandle) {
                dragX = Phaser.Math.Clamp(dragX, -35, 35);
                this.powerHandle.x = dragX;

                const t = (dragX + 35) / 70;
                GameState.magic.powerMultiplier = Math.round(1 + t * 9);
                this.powerValue.setText(`×${GameState.magic.powerMultiplier}`);
                this.renderMagic();
            }
        });

        this.updatePowerSliderVisibility();
    }

    updatePowerSliderVisibility() {
        const firstLayer = GameState.magic.layers[0];
        const hasCircles = firstLayer && firstLayer.items.some(it => it.type === 'CIRCLE');
        const isFirstLayerSelected = firstLayer && GameState.magic.activeLayerId === firstLayer.id;

        this.powerContainer.setVisible(hasCircles && isFirstLayerSelected);
    }

    createElementLegend() {
        const y = this.cameras.main.height - 40;
        const elements = [
            { sides: 3, name: 'Air', color: '#A0E0E0' },
            { sides: 4, name: 'Fire', color: '#E06060' },
            { sides: 5, name: 'Earth', color: '#80C060' },
            { sides: 6, name: 'Water', color: '#4080E0' }
        ];

        let x = this.cameras.main.width / 2 - 150;
        for (let el of elements) {
            this.add.text(x, y, `${el.sides}△ = ${el.name}`, {
                fontFamily: 'Arial',
                fontSize: '12px',
                color: el.color
            });
            x += 80;
        }
    }

    setupInput() {
        // Pointer down
        this.input.on('pointerdown', (pointer) => {
            // Ignore if clicking UI panels (left panel ~120px, right buttons ~150px)
            if (pointer.x > this.cameras.main.width - 150 || pointer.x < 120) return;

            const p = { x: pointer.x, y: pointer.y };

            // Check if hitting a node
            const hitNode = this.getNodeAt(p.x, p.y);
            if (hitNode && !hitNode.used) {
                this.saveUndoState();
                this.ensureActiveLayer();

                this.dragMode = 'shape';
                this.currentPath = [hitNode.id];
                hitNode.used = true;
                this.renderMagic();
                return;
            }

            // Check if clicking on a circle edge (for runes)
            const runeResult = this.checkRuneClick(p);
            if (runeResult) {
                this.saveUndoState();
                if (runeResult.runeIndex >= 0) {
                    // Remove rune
                    runeResult.circle.runes.splice(runeResult.runeIndex, 1);
                } else {
                    // Add rune
                    const angle = Math.atan2(p.y - runeResult.circle.center.y, p.x - runeResult.circle.center.x);
                    runeResult.circle.runes.push(angle);
                }
                this.renderMagic();
                return;
            }

            // Start circle drawing
            this.saveUndoState();
            this.dragMode = 'circle';
            this.dragStart = p;
            this.dragCurrent = p;
        });

        // Pointer move
        this.input.on('pointermove', (pointer) => {
            const p = { x: pointer.x, y: pointer.y };

            if (this.dragMode === 'shape') {
                const hitNode = this.getNodeAt(p.x, p.y);
                if (hitNode) {
                    // Close loop
                    if (hitNode.id === this.currentPath[0] && this.currentPath.length > 2) {
                        const element = this.getElement(this.currentPath.length);
                        const layer = this.getActiveLayer();
                        if (layer) {
                            layer.items.push({
                                type: 'SHAPE',
                                data: {
                                    points: [...this.currentPath],
                                    element: element
                                }
                            });
                        }
                        this.currentPath = [];
                        this.dragMode = null;
                        this.updateLayerPanel();
                    }
                    // Add node
                    else if (!hitNode.used) {
                        this.currentPath.push(hitNode.id);
                        hitNode.used = true;
                    }
                }
                this.renderMagic();
            } else if (this.dragMode === 'circle') {
                this.dragCurrent = p;
                this.renderMagic();
            }
        });

        // Pointer up
        this.input.on('pointerup', () => {
            if (this.dragMode === 'circle' && this.dragStart && this.dragCurrent) {
                const dx = this.dragCurrent.x - this.dragStart.x;
                const dy = this.dragCurrent.y - this.dragStart.y;
                let radius = Math.sqrt(dx * dx + dy * dy);

                // Snap center and radius to grid if enabled
                let cx = this.dragStart.x;
                let cy = this.dragStart.y;
                if (GameState.magic.snapToGrid) {
                    cx = this.snapVal(cx);
                    cy = this.snapVal(cy);
                    radius = this.snapVal(radius);
                }

                if (radius > 20) {
                    this.ensureActiveLayer();
                    const layer = this.getActiveLayer();
                    if (layer) {
                        layer.items.push({
                            type: 'CIRCLE',
                            data: {
                                center: { x: cx, y: cy },
                                rad: radius,
                                runes: []
                            }
                        });
                    }
                    this.updateLayerPanel();
                    this.updatePowerSliderVisibility();
                }
            }

            // If shape mode ended without completing, reset nodes
            if (this.dragMode === 'shape' && this.currentPath.length > 0) {
                this.currentPath.forEach(nodeId => {
                    if (this.nodes[nodeId]) this.nodes[nodeId].used = false;
                });
            }

            this.dragMode = null;
            this.currentPath = [];
            this.dragStart = null;
            this.dragCurrent = null;
            this.renderMagic();
        });
    }

    getNodeAt(x, y) {
        const hitR = GameState.isMobile ? 50 : 30;
        for (let node of this.nodes) {
            const dx = x - node.x;
            const dy = y - node.y;
            if (Math.sqrt(dx * dx + dy * dy) < hitR) return node;
        }
        return null;
    }

    checkRuneClick(p) {
        for (let layer of GameState.magic.layers) {
            if (!layer.visible) continue;
            for (let item of layer.items) {
                if (item.type === 'CIRCLE') {
                    const c = item.data;
                    const cx = c.center.x;
                    const cy = c.center.y;
                    const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);

                    // Near circle edge?
                    if (Math.abs(dist - c.rad) < 20) {
                        // Check existing runes
                        for (let i = 0; i < c.runes.length; i++) {
                            const rx = cx + Math.cos(c.runes[i]) * c.rad;
                            const ry = cy + Math.sin(c.runes[i]) * c.rad;
                            if (Math.sqrt((p.x - rx) ** 2 + (p.y - ry) ** 2) < 15) {
                                return { circle: c, runeIndex: i };
                            }
                        }
                        return { circle: c, runeIndex: -1 };
                    }
                }
            }
        }
        return null;
    }

    getElement(nodeCount) {
        if (nodeCount === 3) return 'Air';
        if (nodeCount === 4) return 'Fire';
        if (nodeCount === 5) return 'Earth';
        if (nodeCount === 6) return 'Water';
        return 'Fire';
    }

    getActiveLayer() {
        return GameState.magic.layers.find(l => l.id === GameState.magic.activeLayerId);
    }

    ensureActiveLayer() {
        if (GameState.magic.layers.length === 0 || !this.getActiveLayer()) {
            this.createLayer();
        }
    }

    createLayer(name) {
        const id = Date.now();
        GameState.magic.layers.push({
            id: id,
            name: name || `Layer ${GameState.magic.layers.length + 1}`,
            visible: true,
            solo: false,
            items: []
        });
        GameState.magic.activeLayerId = id;
        this.updateLayerPanel();
        this.updatePowerSliderVisibility();
    }

    deleteActiveLayer() {
        const idx = GameState.magic.layers.findIndex(l => l.id === GameState.magic.activeLayerId);
        if (idx !== -1) {
            this.saveUndoState();

            // Free nodes
            const layer = GameState.magic.layers[idx];
            layer.items.forEach(it => {
                if (it.type === 'SHAPE') {
                    it.data.points.forEach(pid => {
                        if (this.nodes[pid]) this.nodes[pid].used = false;
                    });
                }
            });

            GameState.magic.layers.splice(idx, 1);

            if (GameState.magic.layers.length > 0) {
                GameState.magic.activeLayerId = GameState.magic.layers[Math.max(0, idx - 1)].id;
            } else {
                GameState.magic.activeLayerId = -1;
            }

            this.updateLayerPanel();
            this.updatePowerSliderVisibility();
            this.renderMagic();
        }
    }

    saveUndoState() {
        const state = JSON.stringify(GameState.magic.layers);
        this.undoHistory.push(state);
        if (this.undoHistory.length > this.maxUndoSteps) {
            this.undoHistory.shift();
        }
    }

    undoLastEdit() {
        if (this.undoHistory.length === 0) return;

        const prevState = JSON.parse(this.undoHistory.pop());
        GameState.magic.layers = prevState;

        // Sync node state
        this.syncNodeUsedState();

        // Update UI
        if (GameState.magic.layers.length > 0) {
            GameState.magic.activeLayerId = GameState.magic.layers[0].id;
        } else {
            GameState.magic.activeLayerId = -1;
        }

        this.updateLayerPanel();
        this.updatePowerSliderVisibility();
        this.renderMagic();
    }

    clearAll() {
        this.saveUndoState();
        GameState.magic.layers = [];
        GameState.magic.activeLayerId = -1;
        GameState.magic.powerMultiplier = 1;

        this.nodes.forEach(n => n.used = false);
        this.currentPath = [];

        // Reset power slider
        this.powerHandle.x = -35;
        this.powerValue.setText('×1');

        this.createLayer();
        this.renderMagic();
    }

    renderMagic() {
        this.graphics.clear();

        // Draw gridlines when snap is active
        if (GameState.magic.snapToGrid) {
            const g = Config.EditorGridSize;
            const w = this.cameras.main.width;
            const h = this.cameras.main.height;
            this.graphics.lineStyle(1, 0x334433, 0.4);
            for (let x = g; x < w; x += g) {
                this.graphics.lineBetween(x, 0, x, h);
            }
            for (let y = g; y < h; y += g) {
                this.graphics.lineBetween(0, y, w, y);
            }
        }

        // Draw guide circle
        const cx = this.cameras.main.width / 2;
        const cy = this.cameras.main.height / 2;
        const radius = Math.min(cx, cy) * 0.5;

        this.graphics.lineStyle(1, 0x333366, 0.5);
        this.graphics.strokeCircle(cx, cy, radius);
        this.graphics.strokeCircle(cx, cy, radius * 0.6);

        // Draw 4-quadrant symmetry axes
        this.graphics.lineStyle(1, 0x334455, 0.5);
        this.graphics.lineBetween(cx, cy - radius, cx, cy + radius);
        this.graphics.lineBetween(cx - radius, cy, cx + radius, cy);

        // Stability readout
        const stability = this.computeStability();
        const pct = Math.round(stability * 100);
        const stabColor = stability > 0.7 ? '#88ff88' : stability > 0.4 ? '#ffff44' : '#ff6666';
        if (!this.stabilityText) {
            this.stabilityText = this.add.text(cx, cy + radius + 20, '', {
                fontFamily: 'Arial',
                fontSize: '13px',
                color: stabColor
            }).setOrigin(0.5);
        }
        this.stabilityText.setText(`STABILITY: ${pct}%`);
        this.stabilityText.setColor(stabColor);

        // Draw nodes
        for (let node of this.nodes) {
            this.graphics.fillStyle(node.used ? 0x555555 : 0xffffff, 1);
            this.graphics.fillCircle(node.x, node.y, 8);
            this.graphics.lineStyle(2, node.used ? 0x444444 : 0xaaaaff, 1);
            this.graphics.strokeCircle(node.x, node.y, 8);
        }

        // Element colors
        const elementColors = {
            Air: 0xA0E0E0,
            Fire: 0xE06060,
            Earth: 0x80C060,
            Water: 0x4080E0
        };

        // Draw layers
        for (let layerIndex = 0; layerIndex < GameState.magic.layers.length; layerIndex++) {
            const layer = GameState.magic.layers[layerIndex];
            if (!layer.visible) continue;

            for (let item of layer.items) {
                if (item.type === 'SHAPE') {
                    const s = item.data;
                    const color = elementColors[s.element] || 0xffffff;

                    // Draw filled polygon
                    this.graphics.fillStyle(color, 0.2);
                    this.graphics.beginPath();
                    const start = this.nodes[s.points[0]];
                    this.graphics.moveTo(start.x, start.y);
                    for (let pid of s.points) {
                        this.graphics.lineTo(this.nodes[pid].x, this.nodes[pid].y);
                    }
                    this.graphics.closePath();
                    this.graphics.fillPath();

                    // Draw outline
                    this.graphics.lineStyle(3, color, 1);
                    this.graphics.beginPath();
                    this.graphics.moveTo(start.x, start.y);
                    for (let pid of s.points) {
                        this.graphics.lineTo(this.nodes[pid].x, this.nodes[pid].y);
                    }
                    this.graphics.closePath();
                    this.graphics.strokePath();

                } else if (item.type === 'CIRCLE') {
                    const c = item.data;
                    const isBlunt = c.rad > (Config.SharpRadiusThreshold || 40);
                    const isFirstLayer = (layerIndex === 0);

                    // Higher power shrinks the drawn shapes (visual only – stored rad is unchanged)
                    const vScale = isFirstLayer
                        ? Math.max(Config.EditorMinPowerScale, 1 - (GameState.magic.powerMultiplier - 1) * Config.EditorPowerShrink)
                        : 1;
                    const vRad = c.rad * vScale;
                    const dotR = Math.max(2, 5 * vScale);

                    // Circle
                    this.graphics.lineStyle(3, isBlunt ? 0xdd00dd : 0xffff00, 1);
                    this.graphics.strokeCircle(c.center.x, c.center.y, vRad);

                    // Subtle power indicator: semi-transparent inner ring
                    if (isFirstLayer && GameState.magic.powerMultiplier > 1) {
                        this.graphics.lineStyle(1, 0xff8800, 0.4);
                        this.graphics.strokeCircle(c.center.x, c.center.y, vRad * 0.7);
                    }

                    // Runes
                    for (let angle of c.runes) {
                        const rx = c.center.x + Math.cos(angle) * vRad;
                        const ry = c.center.y + Math.sin(angle) * vRad;

                        this.graphics.fillStyle(0xffffff, 1);
                        this.graphics.fillCircle(rx, ry, dotR);

                        this.graphics.lineStyle(2, 0xffffff, 1);
                        this.graphics.lineBetween(rx, ry, rx + Math.cos(angle) * 20 * vScale, ry + Math.sin(angle) * 20 * vScale);
                    }
                }
            }
        }

        // Draw current path (in-progress shape)
        if (this.currentPath.length > 0) {
            this.graphics.lineStyle(3, 0xffffff, 0.8);
            this.graphics.beginPath();
            const start = this.nodes[this.currentPath[0]];
            this.graphics.moveTo(start.x, start.y);
            for (let pid of this.currentPath) {
                this.graphics.lineTo(this.nodes[pid].x, this.nodes[pid].y);
            }
            this.graphics.strokePath();
        }

        // Draw circle preview
        if (this.dragMode === 'circle' && this.dragStart && this.dragCurrent) {
            const dx = this.dragCurrent.x - this.dragStart.x;
            const dy = this.dragCurrent.y - this.dragStart.y;
            const r = Math.sqrt(dx * dx + dy * dy);

            this.graphics.lineStyle(2, 0x888888, 0.5);
            this.graphics.strokeCircle(this.dragStart.x, this.dragStart.y, r);
        }
    }

    snapVal(v) {
        const g = Config.EditorGridSize;
        return Math.round(v / g) * g;
    }

    toggleSnapToGrid() {
        GameState.magic.snapToGrid = !GameState.magic.snapToGrid;
        this.updateMagnetBtn();
        this.initNodes(); // Re-compute node positions with/without snapping
        this.renderMagic();
    }

    updateMagnetBtn() {
        if (!this.magnetBtn) return;
        // Tint the background graphics of the button to signal active state
        const bg = this.magnetBtn.list[0];
        if (bg && bg.fillStyle) {
            bg.clear();
            bg.fillStyle(GameState.magic.snapToGrid ? 0x336633 : 0x333366, 1);
            bg.fillRoundedRect(-50, -18, 100, 36, 6);
            bg.lineStyle(2, GameState.magic.snapToGrid ? 0x88ff88 : 0x6666aa);
            bg.strokeRoundedRect(-50, -18, 100, 36, 6);
        }
    }

    /**
     * Compute 4-quadrant symmetry stability [0..1] for the current magic.
     * 1.0 = perfectly symmetric across both axes. 0.0 = fully asymmetric.
     * Empty/trivial designs return 1.0.
     */
    computeStability() {
        const cx = this.cameras.main.width / 2;
        const cy = this.cameras.main.height / 2;
        const tol = Config.Instability.symTolerance;

        // Collect tagged feature points relative to editor centre
        const features = []; // {x, y, tag}
        for (const layer of GameState.magic.layers) {
            if (!layer.visible) continue;
            for (const item of layer.items) {
                if (item.type === 'CIRCLE') {
                    const c = item.data;
                    features.push({ x: c.center.x - cx, y: c.center.y - cy, tag: 'circ' });
                    for (const angle of c.runes) {
                        features.push({ x: Math.cos(angle) * c.rad, y: Math.sin(angle) * c.rad, tag: 'rune' });
                    }
                } else if (item.type === 'SHAPE') {
                    for (const pid of item.data.points) {
                        const n = this.nodes[pid];
                        features.push({ x: n.x - cx, y: n.y - cy, tag: item.data.element });
                    }
                }
            }
        }

        if (features.length === 0) return 1.0;

        let satisfied = 0;
        const total = features.length * 3; // 3 mirrors per feature

        for (const f of features) {
            // Check each of the 3 mirror points
            const mirrors = [{ x: -f.x, y: f.y }, { x: f.x, y: -f.y }, { x: -f.x, y: -f.y }];
            for (const m of mirrors) {
                const found = features.some(o =>
                    o.tag === f.tag &&
                    Math.abs(o.x - m.x) < tol &&
                    Math.abs(o.y - m.y) < tol
                );
                if (found) satisfied++;
            }
        }

        return satisfied / total;
    }

    castAndClose() {
        this.close();
        this.scene.get('GameScene').events.emit('cast-spell');
    }

    close() {
        // Save magic data to current scroll before closing
        if (GameState.inventorySystem) {
            GameState.inventorySystem.saveMagicToScroll(GameState.magic);
        }

        GameState.timeScale = 1.0;
        GameState.isMagicOpen = false;

        this.scene.resume('GameScene');
        this.scene.stop();
    }

    loadFromCurrentScroll() {
        // Load magic data from current scroll
        if (GameState.inventorySystem) {
            const scrollData = GameState.inventorySystem.loadMagicFromScroll();
            if (scrollData) {
                GameState.magic.layers = scrollData.layers;
                GameState.magic.powerMultiplier = scrollData.powerMultiplier;

                // Set active layer
                if (GameState.magic.layers.length > 0) {
                    GameState.magic.activeLayerId = GameState.magic.layers[0].id;
                } else {
                    GameState.magic.activeLayerId = -1;
                }

                // Sync node used state
                this.syncNodeUsedState();

                // Update power slider position
                if (this.powerHandle && this.powerValue) {
                    const t = (GameState.magic.powerMultiplier - 1) / 9;
                    this.powerHandle.x = -35 + t * 70;
                    this.powerValue.setText(`×${GameState.magic.powerMultiplier}`);
                }

                // Update layer panel
                this.updateLayerPanel();
                this.updatePowerSliderVisibility();
            }
        }
    }
}

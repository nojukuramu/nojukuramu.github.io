/**
 * MagicEditor - Magic canvas drawing interactions
 */

let mDrag = {
    active: false,
    start: null,
    curr: null,
    mode: null
};

/**
 * Initialize magic editor event listeners
 */
function initMagicEditor() {
    // Undo history
    Magic.undoHistory = [];
    Magic.maxUndoSteps = 20;

    // Pointer Down
    mCanvas.addEventListener('pointerdown', e => {
        let p = new Vec2(e.clientX, e.clientY);

        // Check if hitting a node
        let hitN = Magic.nodes.find(n => p.dist(new Vec2(n.x, n.y)) < 40);
        if (hitN && !hitN.used) {
            saveUndoState();
            let l = getActiveLayer();
            if (!l) createLayer();

            mDrag.mode = 'shape';
            Magic.currPath = [hitN.id];
            hitN.used = true;
            return;
        }

        // Check rune tap on circle edge
        // Use labeled loops (not forEach) so the search stops at the first matching
        // circle: `return` inside a forEach callback only exits that callback, which
        // let later circles clobber hitC/hitRuneIndex when circles overlapped.
        let hitC = null;
        let hitRuneIndex = -1;
        circleSearch:
        for (const l of Magic.layers) {
            if (!l.visible && !l.solo) continue;
            for (const it of l.items) {
                if (it.type !== 'CIRCLE') continue;
                let c = it.data;
                // Check if clicking near the circle edge
                if (Math.abs(p.dist(c.center) - c.rad) < 20) {
                    // Check if clicking on an existing rune
                    for (let i = 0; i < c.runes.length; i++) {
                        let rx = c.center.x + Math.cos(c.runes[i]) * c.rad;
                        let ry = c.center.y + Math.sin(c.runes[i]) * c.rad;
                        if (p.dist(new Vec2(rx, ry)) < 15) {
                            hitC = c;
                            hitRuneIndex = i;
                            break circleSearch;
                        }
                    }
                    // Not on an existing rune — add a new one to this circle
                    hitC = c;
                    break circleSearch;
                }
            }
        }

        if (hitC) {
            saveUndoState();
            if (hitRuneIndex >= 0) {
                // Remove existing rune
                hitC.runes.splice(hitRuneIndex, 1);
            } else {
                // Add new rune
                let angle = Math.atan2(p.y - hitC.center.y, p.x - hitC.center.x);
                hitC.runes.push(angle);
            }
            renderMagic();
            return;
        }

        // Draw circle mode
        saveUndoState();
        mDrag.mode = 'circle';
        mDrag.start = p;
        mDrag.curr = p;
    });

    // Pointer Move
    mCanvas.addEventListener('pointermove', e => {
        let p = new Vec2(e.clientX, e.clientY);

        if (mDrag.mode === 'shape') {
            let hitN = Magic.nodes.find(n => p.dist(new Vec2(n.x, n.y)) < 40);
            if (hitN) {
                // Close loop
                if (hitN.id === Magic.currPath[0] && Magic.currPath.length > 2) {
                    let el = getElement(Magic.currPath.length);
                    let l = getActiveLayer();
                    if (l) {
                        l.items.push({
                            type: 'SHAPE',
                            data: {
                                points: [...Magic.currPath],
                                element: el
                            }
                        });
                    }
                    Magic.currPath = [];
                    mDrag.mode = null;
                    updateLayerUI();
                }
                // Add node
                else if (!hitN.used) {
                    Magic.currPath.push(hitN.id);
                    hitN.used = true;
                }
            }
            renderMagic();
        } else if (mDrag.mode === 'circle') {
            mDrag.curr = p;
            renderMagic();
        }
    });

    // Pointer Up
    mCanvas.addEventListener('pointerup', e => {
        if (mDrag.mode === 'circle') {
            let r = mDrag.start.dist(mDrag.curr);
            if (r > 20) {
                let l = getActiveLayer();
                if (!l) {
                    createLayer();
                    l = getActiveLayer();
                }

                l.items.push({
                    type: 'CIRCLE',
                    data: {
                        center: mDrag.start,
                        rad: r,
                        runes: []
                    }
                });
                Game.player.stm -= 10;
                updateLayerUI();
                updatePowerPanel(); // Update power panel visibility
            }
        }

        // If shape mode ended without completing, reset used nodes
        if (mDrag.mode === 'shape' && Magic.currPath.length > 0) {
            // Shape wasn't completed - reset all nodes in the path
            Magic.currPath.forEach(nodeId => {
                if (Magic.nodes[nodeId]) {
                    Magic.nodes[nodeId].used = false;
                }
            });
        }

        mDrag.mode = null;
        Magic.currPath = [];
        renderMagic();
    });

    // Undo keyboard handler (Ctrl+Z)
    window.addEventListener('keydown', e => {
        if (!Game.isMagicOpen) return;
        if (e.ctrlKey && e.key === 'z') {
            e.preventDefault();
            undoLastEdit();
        }
    });

    // Initialize power slider
    initPowerSlider();
}

/**
 * Save current state to undo history
 */
function saveUndoState() {
    if (!Magic.undoHistory) Magic.undoHistory = [];

    // Deep copy the current layers
    let state = JSON.stringify(Magic.layers.map(l => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        solo: l.solo,
        items: l.items.map(it => ({
            type: it.type,
            data: it.type === 'CIRCLE' ? {
                center: { x: it.data.center.x, y: it.data.center.y },
                rad: it.data.rad,
                runes: [...it.data.runes]
            } : {
                points: [...it.data.points],
                element: it.data.element
            }
        }))
    })));

    Magic.undoHistory.push(state);

    // Limit history size
    if (Magic.undoHistory.length > (Magic.maxUndoSteps || 20)) {
        Magic.undoHistory.shift();
    }
}

/**
 * Undo the last edit
 */
function undoLastEdit() {
    if (!Magic.undoHistory || Magic.undoHistory.length === 0) return;

    let prevState = JSON.parse(Magic.undoHistory.pop());

    // Restore layers
    Magic.layers = prevState.map(l => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        solo: l.solo || false,
        items: l.items.map(it => ({
            type: it.type,
            data: it.type === 'CIRCLE' ? {
                center: new Vec2(it.data.center.x, it.data.center.y),
                rad: it.data.rad,
                runes: it.data.runes
            } : {
                points: it.data.points,
                element: it.data.element
            }
        }))
    }));

    // Reset used nodes
    Magic.nodes.forEach(n => n.used = false);
    Magic.layers.forEach(l => {
        l.items.forEach(it => {
            if (it.type === 'SHAPE') {
                it.data.points.forEach(id => {
                    if (Magic.nodes[id]) Magic.nodes[id].used = true;
                });
            }
        });
    });

    updateLayerUI();
    updatePowerPanel();
    renderMagic();
}

/**
 * Initialize power slider controls
 */
function initPowerSlider() {
    let slider = document.getElementById('powerSlider');
    let valueDisplay = document.getElementById('powerValue');
    let costDisplay = document.getElementById('powerCost');

    if (!slider || !valueDisplay) return;

    // Initialize power multiplier
    Magic.powerMultiplier = 1;

    slider.addEventListener('input', () => {
        Magic.powerMultiplier = parseInt(slider.value);
        valueDisplay.textContent = `×${Magic.powerMultiplier}`;

        // Update cost display: mana multiplier = 1 + (powerMult - 1) * 0.2
        let manaMult = 1 + (Magic.powerMultiplier - 1) * 0.2;
        if (costDisplay) costDisplay.textContent = `Mana: ×${manaMult.toFixed(1)}`;

        renderMagic(); // Re-render to show thicker circles
    });
}

/**
 * Update power panel visibility - only show if first layer is selected AND has circles
 */
function updatePowerPanel() {
    let panel = document.getElementById('powerPanel');
    if (!panel) return;

    // Check if the first layer (index 0) exists and has circles
    let firstLayer = Magic.layers[0];
    let hasCirclesInFirst = firstLayer && firstLayer.items.some(it => it.type === 'CIRCLE');

    // Check if first layer is currently selected
    let firstLayerSelected = firstLayer && Magic.activeLayerId === firstLayer.id;

    // Only show power panel if first layer is selected AND has circles
    if (hasCirclesInFirst && firstLayerSelected) {
        panel.classList.add('visible');
    } else {
        panel.classList.remove('visible');
    }
}

/**
 * Render the magic canvas
 */
function renderMagic() {
    mCtx.clearRect(0, 0, mCanvas.width, mCanvas.height);

    // Draw nodes
    Magic.nodes.forEach(n => {
        mCtx.beginPath();
        mCtx.arc(n.x, n.y, 8, 0, Math.PI * 2);
        mCtx.fillStyle = n.used ? '#555' : '#fff';
        mCtx.fill();
    });

    // Check if any layer is solo'd
    let hasSolo = Magic.layers.some(l => l.solo);

    // Draw layers
    Magic.layers.forEach((l, layerIndex) => {
        // Solo mode: only show solo'd layers
        if (hasSolo) {
            if (!l.solo) return;
        } else {
            // Normal mode: respect visibility
            if (!l.visible) return;
        }

        l.items.forEach(it => {
            if (it.type === 'SHAPE') {
                let s = it.data;
                mCtx.beginPath();
                let start = Magic.nodes[s.points[0]];
                mCtx.moveTo(start.x, start.y);
                s.points.forEach(id => mCtx.lineTo(Magic.nodes[id].x, Magic.nodes[id].y));
                mCtx.closePath();
                mCtx.strokeStyle = Config[s.element];
                mCtx.lineWidth = 4;
                mCtx.stroke();
                mCtx.fillStyle = Config[s.element] + "55";
                mCtx.fill();
            } else if (it.type === 'CIRCLE') {
                let c = it.data;
                let isBlunt = c.rad > Config.SharpRadiusThreshold;

                // First layer circles get thickness from power multiplier
                let isFirstLayer = (layerIndex === 0);
                let thickness = isFirstLayer ? 3 + (Magic.powerMultiplier || 1) * 2 : 3;

                mCtx.beginPath();
                mCtx.arc(c.center.x, c.center.y, c.rad, 0, Math.PI * 2);
                mCtx.strokeStyle = isBlunt ? Config.Blunt : Config.Sharp;
                mCtx.lineWidth = thickness;
                mCtx.stroke();

                // Power glow for first layer powered circles
                if (isFirstLayer && Magic.powerMultiplier > 1) {
                    mCtx.beginPath();
                    mCtx.arc(c.center.x, c.center.y, c.rad, 0, Math.PI * 2);
                    mCtx.strokeStyle = 'rgba(255, 136, 0, 0.3)';
                    mCtx.lineWidth = thickness + 6;
                    mCtx.stroke();
                }

                // Runes
                c.runes.forEach(a => {
                    let rx = c.center.x + Math.cos(a) * c.rad;
                    let ry = c.center.y + Math.sin(a) * c.rad;
                    mCtx.beginPath();
                    mCtx.arc(rx, ry, 5, 0, Math.PI * 2);
                    mCtx.fillStyle = '#fff';
                    mCtx.fill();
                    mCtx.beginPath();
                    mCtx.moveTo(rx, ry);
                    mCtx.lineTo(rx + Math.cos(a) * 20, ry + Math.sin(a) * 20);
                    mCtx.strokeStyle = '#fff';
                    mCtx.stroke();
                });
            }
        });
    });

    // Drawing path preview
    if (Magic.currPath.length > 0) {
        mCtx.beginPath();
        let start = Magic.nodes[Magic.currPath[0]];
        mCtx.moveTo(start.x, start.y);
        Magic.currPath.forEach(id => mCtx.lineTo(Magic.nodes[id].x, Magic.nodes[id].y));
        mCtx.strokeStyle = '#fff';
        mCtx.lineWidth = 2;
        mCtx.stroke();
    }

    // Circle drag preview
    if (mDrag.mode === 'circle') {
        let r = mDrag.start.dist(mDrag.curr);
        mCtx.beginPath();
        mCtx.arc(mDrag.start.x, mDrag.start.y, r, 0, Math.PI * 2);
        mCtx.strokeStyle = '#888';
        mCtx.setLineDash([5, 5]);
        mCtx.stroke();
        mCtx.setLineDash([]);
    }
}

// Expose functions globally
window.updatePowerPanel = updatePowerPanel;
window.saveUndoState = saveUndoState;

/**
 * Magic - Magic editor state and utilities
 */
const Magic = {
    nodes: [],
    layers: [],
    activeLayerId: -1,
    currPath: [],
    soloMode: null
};

/**
 * Get the currently active layer
 */
function getActiveLayer() {
    return Magic.layers.find(l => l.id === Magic.activeLayerId);
}

/**
 * Create a new layer
 */
function createLayer(name) {
    if (typeof saveUndoState === 'function') saveUndoState();
    let id = Date.now();
    Magic.layers.push({
        id: id,
        name: name || `Layer ${Magic.layers.length + 1}`,
        visible: true,
        solo: false,
        items: []
    });
    Magic.activeLayerId = id;
    updateLayerUI();
    if (typeof updatePowerPanel === 'function') updatePowerPanel();
}

/**
 * Delete a layer by ID
 */
function deleteLayer(layerId) {
    if (typeof saveUndoState === 'function') saveUndoState();
    let idx = Magic.layers.findIndex(l => l.id === layerId);
    if (idx !== -1) {
        // Free up nodes used by shapes in this layer
        let layer = Magic.layers[idx];
        layer.items.forEach(it => {
            if (it.type === 'SHAPE') {
                it.data.points.forEach(pid => {
                    if (Magic.nodes[pid]) Magic.nodes[pid].used = false;
                });
            }
        });

        Magic.layers.splice(idx, 1);
        if (Magic.layers.length > 0) {
            Magic.activeLayerId = Magic.layers[Math.max(0, idx - 1)].id;
        } else {
            Magic.activeLayerId = -1;
        }
        updateLayerUI();
        if (typeof updatePowerPanel === 'function') updatePowerPanel();
        renderMagic();
    }
}

/**
 * Toggle layer visibility
 */
function toggleLayerVisibility(layerId) {
    let l = Magic.layers.find(x => x.id === layerId);
    if (l) {
        l.visible = !l.visible;
        updateLayerUI();
        renderMagic();
    }
}

/**
 * Move layer up in the stack (towards top/last)
 */
function moveLayerUp(layerId) {
    let idx = Magic.layers.findIndex(l => l.id === layerId);
    if (idx !== -1 && idx < Magic.layers.length - 1) {
        if (typeof saveUndoState === 'function') saveUndoState();
        // Swap with next
        [Magic.layers[idx], Magic.layers[idx + 1]] = [Magic.layers[idx + 1], Magic.layers[idx]];
        updateLayerUI();
        renderMagic();
    }
}

/**
 * Move layer down in the stack (towards bottom/first)
 */
function moveLayerDown(layerId) {
    let idx = Magic.layers.findIndex(l => l.id === layerId);
    if (idx > 0) {
        if (typeof saveUndoState === 'function') saveUndoState();
        // Swap with previous
        [Magic.layers[idx], Magic.layers[idx - 1]] = [Magic.layers[idx - 1], Magic.layers[idx]];
        updateLayerUI();
        renderMagic();
    }
}

/**
 * Get element type from node count
 */
function getElement(n) {
    if (n === 3) return 'Air';
    if (n === 4) return 'Fire';
    if (n === 5) return 'Earth';
    if (n === 6) return 'Water';
    return 'Fire'; // Fallback
}

/**
 * Initialize magic canvas nodes
 */
function initNodes() {
    Magic.nodes = [];
    let cx = mCanvas.width / 2;
    let cy = mCanvas.height / 2;
    let r = Math.min(cx, cy) * 0.6;

    for (let i = 0; i < 12; i++) {
        let a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        Magic.nodes.push({
            x: cx + Math.cos(a) * r,
            y: cy + Math.sin(a) * r,
            id: i,
            used: false
        });
    }
}

/**
 * Clear all magic data
 */
function clearMagic() {
    if (typeof saveUndoState === 'function') saveUndoState();
    Magic.layers = [];
    Magic.currPath = [];
    Magic.activeLayerId = -1;
    Magic.nodes.forEach(n => n.used = false);
    createLayer();
    updateLayerUI();
    if (typeof updatePowerPanel === 'function') updatePowerPanel();
    renderMagic();
}

// Expose for global access
window.moveLayerUp = moveLayerUp;
window.moveLayerDown = moveLayerDown;


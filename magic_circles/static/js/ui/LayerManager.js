/**
 * LayerManager - Layer panel UI
 */

function initLayerManager() {
    let addBtn = document.getElementById('btnAddLayer');
    if (addBtn) addBtn.onclick = () => createLayer();

    let delBtn = document.getElementById('btnDelLayer');
    if (delBtn) delBtn.onclick = () => {
        if (Magic.activeLayerId !== -1) deleteLayer(Magic.activeLayerId);
    };

    // Up/Down buttons
    let upBtn = document.getElementById('btnLayerUp');
    if (upBtn) upBtn.onclick = () => {
        if (Magic.activeLayerId !== -1) moveLayerUp(Magic.activeLayerId);
    };

    let downBtn = document.getElementById('btnLayerDown');
    if (downBtn) downBtn.onclick = () => {
        if (Magic.activeLayerId !== -1) moveLayerDown(Magic.activeLayerId);
    };
}

function updateLayerUI() {
    const list = document.getElementById('layerList');
    if (!list) return;
    list.innerHTML = '';

    // No layers message
    if (Magic.layers.length === 0) {
        list.innerHTML = '<div style="padding:10px; color:#666; text-align:center; font-size:10px;">No layers. Click + to add.</div>';
        return;
    }

    // Render layers (top-down visual order = reverse array)
    for (let i = Magic.layers.length - 1; i >= 0; i--) {
        let l = Magic.layers[i];

        // Ensure solo property exists
        if (l.solo === undefined) l.solo = false;

        let el = document.createElement('div');
        el.className = `layer-item ${l.id === Magic.activeLayerId ? 'active' : ''}`;
        el.onclick = () => {
            Magic.activeLayerId = l.id;
            updateLayerUI();
            if (typeof updatePowerPanel === 'function') updatePowerPanel();
        };

        // Content description (elements in this layer)
        let shapes = l.items.filter(it => it.type === 'SHAPE').map(it => it.data.element);
        let circles = l.items.filter(it => it.type === 'CIRCLE').length;
        let desc = shapes.join(', ');
        if (circles > 0) desc += (desc ? ', ' : '') + `${circles}○`;
        if (!desc) desc = 'Empty';

        el.innerHTML = `
            <span class="layer-btn ${l.solo ? 'solo-active' : ''}" onclick="event.stopPropagation(); toggleLayerSolo(${l.id})" title="Solo Mode (show only this)">
                ${l.solo ? 'S' : 's'}
            </span>
            <span class="layer-btn ${!l.visible ? 'hidden' : ''}" onclick="event.stopPropagation(); toggleLayerVisibility(${l.id})" title="Toggle Visibility">
                ${l.visible ? '👁️' : '—'}
            </span>
            <span class="layer-name">${l.name}</span>
            <span class="layer-contents">${desc}</span>
        `;
        list.appendChild(el);
    }
}

/**
 * Toggle layer solo mode - show only this layer
 */
function toggleLayerSolo(id) {
    let layer = Magic.layers.find(l => l.id === id);
    if (!layer) return;

    // If this layer is already solo'd, turn off solo mode for all
    if (layer.solo) {
        Magic.layers.forEach(l => l.solo = false);
    } else {
        // Turn off all other solos and solo this one
        Magic.layers.forEach(l => l.solo = false);
        layer.solo = true;
    }

    updateLayerUI();
    renderMagic();
}

// Expose global functions
window.toggleLayerVisibility = toggleLayerVisibility;
window.toggleLayerSolo = toggleLayerSolo;

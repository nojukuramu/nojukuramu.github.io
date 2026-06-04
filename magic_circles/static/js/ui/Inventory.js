/**
 * Inventory - Inventory management UI
 */

/**
 * Initialize inventory with default scrolls
 */
function initInventory() {
    for (let i = 0; i < 8; i++) {
        Game.inventory.push(new Item(i, `Scroll ${i + 1}`, 'SCROLL', '📜', {
            layers: [],
            fromSolo: false
        }));
    }
    updateInventoryUI();
}

/**
 * Select an inventory slot
 */
function selectSlot(idx) {
    if (idx < 0 || idx >= 8) return;
    Game.selectedSlot = idx;
    updateInventoryUI();

    // Reload magic data if menu is open
    if (Game.isMagicOpen) {
        let item = Game.getCurrentItem();
        if (item && item.type === 'SCROLL') {
            loadMagicFromScroll(item);
            // Power is loaded from scroll in loadMagicFromScroll
        } else {
            toggleMagicMenu(false);
        }
    }
}

/**
 * Update the inventory UI
 */
function updateInventoryUI() {
    const bar = document.getElementById('inventoryBar');
    bar.innerHTML = '';

    Game.inventory.forEach((item, i) => {
        let el = document.createElement('div');
        el.className = `slot ${i === Game.selectedSlot ? 'active' : ''}`;
        el.innerText = item ? item.icon : '';
        el.onclick = () => selectSlot(i);

        let key = document.createElement('span');
        key.className = 'slot-key';
        key.innerText = i + 1;
        el.appendChild(key);

        // Cast status indicator
        let indicator = document.createElement('div');
        indicator.className = 'cast-indicator';
        indicator.id = `cast-indicator-${i}`;
        el.appendChild(indicator);

        bar.appendChild(el);
    });

    // Update indicators
    updateCastIndicators();
}

/**
 * Check if a scroll can be cast and return status
 * Returns: 'ready' (green), 'partial' (yellow), 'fallback' (red)
 */
function getScrollCastStatus(item) {
    if (!item || item.type !== 'SCROLL') return 'fallback';

    let layers = item.data.layers || [];
    if (layers.length === 0) return 'fallback';

    // Get all shapes
    let shapes = [];
    layers.forEach(l => {
        if (!l.visible) return;
        (l.items || []).forEach(it => {
            if (it.type === 'SHAPE') shapes.push(it.data);
        });
    });

    if (shapes.length === 0) {
        // Check if has circles at least
        let hasCircles = layers.some(l =>
            l.visible && (l.items || []).some(it => it.type === 'CIRCLE')
        );
        return hasCircles ? 'ready' : 'fallback';
    }

    // Check mana for each shape
    let powerMult = item.data.powerMultiplier || 1;
    let manaCostMult = 1 + (powerMult - 1) * 0.2;

    let canCastCount = 0;
    shapes.forEach(s => {
        let el = s.element;
        let baseCost = Config.ManaCost[el] || 15;
        let actualCost = Math.ceil(baseCost * manaCostMult);
        if (Game.player && Game.player.mana[el] >= actualCost) {
            canCastCount++;
        }
    });

    if (canCastCount === shapes.length) return 'ready';
    if (canCastCount > 0) return 'partial';
    return 'fallback';
}

/**
 * Update all cast indicators based on current mana
 */
function updateCastIndicators() {
    Game.inventory.forEach((item, i) => {
        let indicator = document.getElementById(`cast-indicator-${i}`);
        if (!indicator) return;

        let status = getScrollCastStatus(item);
        indicator.className = `cast-indicator ${status}`;
    });
}

/**
 * Load magic data from a scroll item
 */
function loadMagicFromScroll(item) {
    if (!item || item.type !== 'SCROLL') return;

    Magic.layers = JSON.parse(JSON.stringify(item.data.layers || []));

    // Legacy migration
    if (Magic.layers.length === 0 && (item.data.shapes || item.data.circles)) {
        let l = { id: Date.now(), name: "Migrated Layer", visible: true, items: [] };
        if (item.data.shapes) {
            item.data.shapes.forEach(s => l.items.push({ type: 'SHAPE', data: s }));
        }
        if (item.data.circles) {
            item.data.circles.forEach(c => l.items.push({ type: 'CIRCLE', data: c }));
        }
        Magic.layers.push(l);
    }

    if (Magic.layers.length > 0) {
        Magic.activeLayerId = Magic.layers[0].id;
    }

    // Restore node 'used' state
    Magic.nodes.forEach(n => n.used = false);
    Magic.layers.forEach(l => {
        l.items.forEach(it => {
            if (it.type === 'SHAPE') {
                it.data.points.forEach(pid => Magic.nodes[pid].used = true);
            }
        });
    });

    // Load power multiplier from scroll (default to 1 for untouched scrolls)
    Magic.powerMultiplier = item.data.powerMultiplier || 1;

    // Update slider UI
    let slider = document.getElementById('powerSlider');
    let valueDisplay = document.getElementById('powerValue');
    let costDisplay = document.getElementById('powerCost');
    if (slider) slider.value = Magic.powerMultiplier;
    if (valueDisplay) valueDisplay.textContent = `×${Magic.powerMultiplier}`;
    if (costDisplay) {
        let manaMult = 1 + (Magic.powerMultiplier - 1) * 0.2;
        costDisplay.textContent = `Mana: ×${manaMult.toFixed(1)}`;
    }

    updateLayerUI();
    if (typeof updatePowerPanel === 'function') updatePowerPanel();
    renderMagic();
}

/**
 * Save magic data to current scroll
 */
function saveMagicToScroll() {
    let item = Game.getCurrentItem();
    if (item && item.type === 'SCROLL') {
        item.data.layers = JSON.parse(JSON.stringify(Magic.layers));
        // Save power multiplier per scroll
        item.data.powerMultiplier = Magic.powerMultiplier || 1;
    }
}

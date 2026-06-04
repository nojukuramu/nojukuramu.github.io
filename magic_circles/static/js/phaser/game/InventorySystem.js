/**
 * InventorySystem - Manages 8-slot scroll inventory for Phaser RPG
 * Handles saving/loading magic data, cast indicators, and slot selection
 */
class InventorySystem {
    constructor(scene) {
        this.scene = scene;
        this.slots = [];
        this.selectedSlot = 0;
        this.config = null;

        // Cast indicator colors
        this.STATUS_COLORS = {
            ready: 0x00ff00,    // Green - can cast all elements
            partial: 0xffff00,  // Yellow - some elements available
            fallback: 0xff0000  // Red - will use base magic
        };
    }

    /**
     * Initialize inventory with 8 empty scrolls
     */
    init(config) {
        this.config = config;
        this.slots = [];

        for (let i = 0; i < 8; i++) {
            this.slots.push(new Item(i, `Scroll ${i + 1}`, 'SCROLL', '📜', {
                layers: [],
                powerMultiplier: 1,
                fromSolo: false
            }));
        }
    }

    /**
     * Select a slot by index (0-7)
     */
    selectSlot(index) {
        if (index < 0 || index >= 8) return;
        this.selectedSlot = index;
        if (this.scene && this.scene.events) {
            this.scene.events.emit('inventory-slot-changed', index);
        }
    }

    /**
     * Get currently selected item
     */
    getCurrentItem() {
        return this.slots[this.selectedSlot];
    }

    /**
     * Get item at specific slot
     */
    getItem(index) {
        return this.slots[index];
    }

    /**
     * Save magic data to current scroll
     */
    saveMagicToScroll(magicData) {
        const item = this.getCurrentItem();
        if (item && item.type === 'SCROLL') {
            item.data.layers = JSON.parse(JSON.stringify(magicData.layers || []));
            item.data.powerMultiplier = magicData.powerMultiplier || 1;
        }
    }

    /**
     * Load magic data from current scroll
     */
    loadMagicFromScroll() {
        const item = this.getCurrentItem();
        if (!item || item.type !== 'SCROLL') return null;

        return {
            layers: JSON.parse(JSON.stringify(item.data.layers || [])),
            powerMultiplier: item.data.powerMultiplier || 1
        };
    }

    /**
     * Check if a scroll can be cast and return status
     * Returns: 'ready' (green), 'partial' (yellow), 'fallback' (red)
     */
    getScrollCastStatus(slotIndex, playerMana) {
        const item = this.slots[slotIndex];
        if (!item || item.type !== 'SCROLL') return 'fallback';

        const layers = item.data.layers || [];
        if (layers.length === 0) return 'fallback';

        // Get all shapes from visible layers
        let shapes = [];
        layers.forEach(l => {
            if (!l.visible) return;
            (l.items || []).forEach(it => {
                if (it.type === 'SHAPE') shapes.push(it.data);
            });
        });

        if (shapes.length === 0) {
            // Check if has circles at least (neutral cast)
            const hasCircles = layers.some(l =>
                l.visible && (l.items || []).some(it => it.type === 'CIRCLE')
            );
            return hasCircles ? 'ready' : 'fallback';
        }

        // Check mana for each shape
        const powerMult = item.data.powerMultiplier || 1;
        const manaCostMult = 1 + (powerMult - 1) * 0.2;

        let canCastCount = 0;
        const ManaCost = this.config?.ManaCost || { Air: 15, Fire: 20, Earth: 25, Water: 20 };

        shapes.forEach(s => {
            const el = s.element;
            const baseCost = ManaCost[el] || 15;
            const actualCost = Math.ceil(baseCost * manaCostMult);
            if (playerMana && playerMana[el] >= actualCost) {
                canCastCount++;
            }
        });

        if (canCastCount === shapes.length) return 'ready';
        if (canCastCount > 0) return 'partial';
        return 'fallback';
    }

    /**
     * Get all cast statuses for UI update
     */
    getAllCastStatuses(playerMana) {
        const statuses = [];
        for (let i = 0; i < 8; i++) {
            statuses.push(this.getScrollCastStatus(i, playerMana));
        }
        return statuses;
    }
}

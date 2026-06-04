/**
 * SeededRandom - Deterministic random number generator for procedural world generation
 * Ported from original WorldObject.js ChunkManager
 */
class SeededRandom {
    constructor(seed) {
        this.seed = seed || Math.floor(Math.random() * 1000000);
    }

    /**
     * Simple hash function for deterministic randomness
     */
    hash(x, y) {
        let h = this.seed;
        h = ((h << 5) - h + x) | 0;
        h = ((h << 5) - h + y) | 0;
        h = ((h << 5) - h + (x * 31)) | 0;
        h = ((h << 5) - h + (y * 17)) | 0;
        return Math.abs(h);
    }

    /**
     * Seeded random [0, 1) for a coordinate
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {number} salt - Optional salt for different random streams
     * @returns {number} Pseudo-random value between 0 and 1
     */
    random(x, y, salt = 0) {
        return (this.hash(x + salt * 1000, y + salt * 777) % 10000) / 10000;
    }

    /**
     * Get random integer in range [min, max]
     */
    randomInt(x, y, min, max, salt = 0) {
        const r = this.random(x, y, salt);
        return Math.floor(min + r * (max - min + 1));
    }

    /**
     * Pick random item from array based on position
     */
    randomPick(x, y, array, salt = 0) {
        const idx = Math.floor(this.random(x, y, salt) * array.length);
        return array[idx];
    }

    /**
     * Weighted random selection
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate  
     * @param {Array} items - Array of {item, weight} objects
     * @param {number} salt - Optional salt
     */
    weightedPick(x, y, items, salt = 0) {
        let totalWeight = 0;
        for (let item of items) {
            totalWeight += (item.weight || item.rarity || 1);
        }

        const target = this.random(x, y, salt) * totalWeight;
        let sum = 0;
        for (let item of items) {
            sum += (item.weight || item.rarity || 1);
            if (sum >= target) {
                return item;
            }
        }
        return items[items.length - 1];
    }
}

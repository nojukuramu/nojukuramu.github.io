/**
 * PathwayRenderer - Renders connected road network overlay
 * Also provides path direction data for smart chunk preset selection
 */
class PathwayRenderer {
    constructor(scene) {
        this.scene = scene;
        this.paths = [];
        this.nodes = [];
        this.generated = false;
        this.seed = 12345;
        this.graphics = null;
        // Track path directions per chunk: Map<"cx,cy", Set<"N"|"S"|"E"|"W">>
        this.pathChunks = new Map();
    }

    init(seed) {
        this.seed = seed || Math.floor(Math.random() * 1000000);
        this.paths = [];
        this.nodes = [];
        this.generated = false;

        // Create graphics object for rendering
        this.graphics = this.scene.add.graphics();
        this.graphics.setDepth(-50); // Above ground, below objects
    }

    seededRandom(salt = 0) {
        let h = this.seed + salt;
        h = ((h << 5) - h + salt * 31) | 0;
        h = ((h << 5) - h + salt * 17) | 0;
        return Math.abs(h % 10000) / 10000;
    }

    generate() {
        if (this.generated) return;

        const chunkSize = Config.Chunks.size;
        const networkRadius = 30;
        const nodeCount = 15;

        // Generate landmark nodes
        for (let i = 0; i < nodeCount; i++) {
            const angle = this.seededRandom(i * 100) * Math.PI * 2;
            const dist = 3 + this.seededRandom(i * 100 + 1) * networkRadius;
            const nx = Math.round(Math.cos(angle) * dist);
            const ny = Math.round(Math.sin(angle) * dist);

            this.nodes.push({
                cx: nx,
                cy: ny,
                worldX: nx * chunkSize + chunkSize / 2,
                worldY: ny * chunkSize + chunkSize / 2
            });
        }

        // Add origin as a node
        this.nodes.unshift({
            cx: 0,
            cy: 0,
            worldX: chunkSize / 2,
            worldY: chunkSize / 2
        });

        // Build MST for connectivity
        const connected = new Set([0]);
        const edges = [];

        while (connected.size < this.nodes.length) {
            let bestEdge = null;
            let bestDist = Infinity;

            for (let i of connected) {
                for (let j = 0; j < this.nodes.length; j++) {
                    if (connected.has(j)) continue;
                    const dx = this.nodes[i].cx - this.nodes[j].cx;
                    const dy = this.nodes[i].cy - this.nodes[j].cy;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < bestDist) {
                        bestDist = dist;
                        bestEdge = { from: i, to: j };
                    }
                }
            }

            if (bestEdge) {
                edges.push(bestEdge);
                connected.add(bestEdge.to);
            } else break;
        }

        // Add extra connections for loops
        for (let i = 0; i < 5; i++) {
            const a = Math.floor(this.seededRandom(i * 500) * this.nodes.length);
            const b = Math.floor(this.seededRandom(i * 500 + 1) * this.nodes.length);
            if (a !== b) {
                const dx = this.nodes[a].cx - this.nodes[b].cx;
                const dy = this.nodes[a].cy - this.nodes[b].cy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 15) {
                    edges.push({ from: a, to: b });
                }
            }
        }

        // Create path segments from edges
        for (let edge of edges) {
            this.createPathBetween(this.nodes[edge.from], this.nodes[edge.to]);
        }

        this.generated = true;
        console.log(`PathwayRenderer generated: ${this.nodes.length} nodes, ${this.paths.length} segments`);
    }

    createPathBetween(from, to) {
        const chunkSize = Config.Chunks.size;

        let cx = from.cx;
        let cy = from.cy;
        const targetCX = to.cx;
        const targetCY = to.cy;

        let prevX = from.worldX;
        let prevY = from.worldY;
        let prevCX = from.cx;
        let prevCY = from.cy;
        const maxSteps = Math.abs(targetCX - cx) + Math.abs(targetCY - cy) + 5;
        let step = 0;

        while ((cx !== targetCX || cy !== targetCY) && step < maxSteps) {
            step++;

            const dx = targetCX - cx;
            const dy = targetCY - cy;
            const rand = this.seededRandom(cx * 1000 + cy * 100 + step);

            // Move towards target
            let moveDX = 0, moveDY = 0;
            if (Math.abs(dx) > Math.abs(dy) || (Math.abs(dx) === Math.abs(dy) && rand > 0.5)) {
                moveDX = Math.sign(dx);
                cx += moveDX;
            } else {
                moveDY = Math.sign(dy);
                cy += moveDY;
            }

            const currX = cx * chunkSize + chunkSize / 2;
            const currY = cy * chunkSize + chunkSize / 2;

            this.paths.push({
                x1: prevX, y1: prevY,
                x2: currX, y2: currY
            });

            // Track path directions for each chunk
            // Previous chunk: path goes in the direction we moved
            const prevKey = `${prevCX},${prevCY}`;
            if (!this.pathChunks.has(prevKey)) {
                this.pathChunks.set(prevKey, new Set());
            }
            if (moveDX > 0) this.pathChunks.get(prevKey).add('E');
            if (moveDX < 0) this.pathChunks.get(prevKey).add('W');
            if (moveDY > 0) this.pathChunks.get(prevKey).add('S');
            if (moveDY < 0) this.pathChunks.get(prevKey).add('N');

            // Current chunk: path comes from the opposite direction
            const currKey = `${cx},${cy}`;
            if (!this.pathChunks.has(currKey)) {
                this.pathChunks.set(currKey, new Set());
            }
            if (moveDX > 0) this.pathChunks.get(currKey).add('W');
            if (moveDX < 0) this.pathChunks.get(currKey).add('E');
            if (moveDY > 0) this.pathChunks.get(currKey).add('N');
            if (moveDY < 0) this.pathChunks.get(currKey).add('S');

            prevX = currX;
            prevY = currY;
            prevCX = cx;
            prevCY = cy;
        }
    }

    /**
     * Get path configuration for a chunk
     * @param {number} cx - Chunk X coordinate
     * @param {number} cy - Chunk Y coordinate
     * @returns {string|null} Path code: 'NS', 'EW', 'NE', 'NW', 'SE', 'SW', 'CROSS', 'T_N', 'T_S', 'T_E', 'T_W', or null
     */
    getPathDirection(cx, cy) {
        const key = `${cx},${cy}`;
        const dirs = this.pathChunks.get(key);
        if (!dirs || dirs.size === 0) return null;

        const hasN = dirs.has('N');
        const hasS = dirs.has('S');
        const hasE = dirs.has('E');
        const hasW = dirs.has('W');
        const count = dirs.size;

        // 4-way intersection
        if (count === 4) return 'CROSS';

        // 3-way intersections (T-junctions)
        if (count === 3) {
            if (!hasN) return 'T_S'; // Opens to south
            if (!hasS) return 'T_N'; // Opens to north
            if (!hasE) return 'T_W'; // Opens to west
            if (!hasW) return 'T_E'; // Opens to east
        }

        // Straight paths
        if (hasN && hasS && !hasE && !hasW) return 'NS';
        if (hasE && hasW && !hasN && !hasS) return 'EW';

        // Corner paths
        if (hasN && hasE) return 'NE';
        if (hasN && hasW) return 'NW';
        if (hasS && hasE) return 'SE';
        if (hasS && hasW) return 'SW';

        // Dead ends (single direction)
        if (hasN && count === 1) return 'END_N';
        if (hasS && count === 1) return 'END_S';
        if (hasE && count === 1) return 'END_E';
        if (hasW && count === 1) return 'END_W';

        return null;
    }

    /**
     * Check if a chunk has any pathway
     */
    hasPath(cx, cy) {
        return this.pathChunks.has(`${cx},${cy}`);
    }

    render(camX, camY, viewWidth, viewHeight) {
        if (!this.generated || this.paths.length === 0) return;

        this.graphics.clear();

        const buffer = 400;
        const minX = camX - viewWidth / 2 - buffer;
        const maxX = camX + viewWidth / 2 + buffer;
        const minY = camY - viewHeight / 2 - buffer;
        const maxY = camY + viewHeight / 2 + buffer;

        // Filter visible paths
        const visible = this.paths.filter(seg => {
            return !(seg.x1 < minX && seg.x2 < minX) &&
                !(seg.x1 > maxX && seg.x2 > maxX) &&
                !(seg.y1 < minY && seg.y2 < minY) &&
                !(seg.y1 > maxY && seg.y2 > maxY);
        });

        if (visible.length === 0) return;

        // Draw shadow/border
        this.graphics.lineStyle(52, 0x3a3020, 1);
        for (let seg of visible) {
            this.graphics.lineBetween(seg.x1, seg.y1, seg.x2, seg.y2);
        }

        // Draw main path
        this.graphics.lineStyle(48, 0x6a5a4a, 1);
        for (let seg of visible) {
            this.graphics.lineBetween(seg.x1, seg.y1, seg.x2, seg.y2);
        }

        // Draw center line
        this.graphics.lineStyle(44, 0x7a6a5a, 0.3);
        for (let seg of visible) {
            this.graphics.lineBetween(seg.x1, seg.y1, seg.x2, seg.y2);
        }
    }
}

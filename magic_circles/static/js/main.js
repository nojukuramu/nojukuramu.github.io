/**
 * Main - Game loop and initialization
 */

// Canvas references
let canvas, ctx, mCanvas, mCtx;
let isGameRunning = false;

// ============================================
// BIOME TEXTURE SYSTEM
// Procedurally generated ground textures per biome
// ============================================
const BiomeTextures = {
    textures: {},
    size: 64, // Tile size for patterns

    // Generate all biome textures at startup
    init() {
        this.textures = {
            // Grassy biomes
            Plains: this.createGrassTexture('#4a5a3a', '#3a4a2a', '#5a6a4a', 0.6),
            Forest: this.createGrassTexture('#2a4a2a', '#1a3d1a', '#3a5a3a', 0.9),
            Clearing: this.createGrassTexture('#3f4a3f', '#2f3a2f', '#4f5a4f', 0.5),
            Swamp: this.createMudTexture('#3a4a3a', '#2a3a2a', '#4a5a4a'),

            // Rocky/Stone biomes
            Rocky: this.createRockyTexture('#5a5a5a', '#3a3a3a', '#6a6a6a'),
            Cave: this.createCaveTexture('#3a3a3a', '#2a2a2a', '#4a4a4a'),
            Ruins: this.createCobblestoneTexture('#5a5050', '#4a4040', '#6a6060'),
            Graveyard: this.createCobblestoneTexture('#4a4a5a', '#3a3a4a', '#5a5a6a'),

            // Sandy biomes
            Desert: this.createSandTexture('#8a7a5a', '#6a5a3a', '#9a8a6a'),

            // Village/Camp
            Village: this.createCobblestoneTexture('#6a5a4a', '#5a4a3a', '#7a6a5a'),
            Camp: this.createDirtPathTexture('#5a4a3a', '#4a3a2a', '#6a5a4a'),

            // Water-adjacent
            Lake: this.createWaterEdgeTexture('#3a5a6a', '#2a4a5a', '#4a6a7a')
        };
    },

    // Get pattern for a biome (returns a canvas that can be used as pattern)
    getTexture(biome) {
        return this.textures[biome] || this.textures.Plains;
    },

    // === GRASS TEXTURE ===
    createGrassTexture(baseColor, darkColor, lightColor, density = 0.7) {
        const canvas = document.createElement('canvas');
        canvas.width = this.size;
        canvas.height = this.size;
        const ctx = canvas.getContext('2d');

        // Base color
        ctx.fillStyle = baseColor;
        ctx.fillRect(0, 0, this.size, this.size);

        // Random grass blades
        const bladeCount = Math.floor(80 * density);
        for (let i = 0; i < bladeCount; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            const height = 3 + Math.random() * 5;
            const lean = (Math.random() - 0.5) * 3;

            ctx.strokeStyle = Math.random() > 0.5 ? darkColor : lightColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + lean, y - height);
            ctx.stroke();
        }

        // Small dots for texture variation
        for (let i = 0; i < 30; i++) {
            ctx.fillStyle = Math.random() > 0.5 ? darkColor : lightColor;
            ctx.globalAlpha = 0.3 + Math.random() * 0.4;
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            ctx.beginPath();
            ctx.arc(x, y, 0.5 + Math.random() * 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        return canvas;
    },

    // === COBBLESTONE TEXTURE ===
    createCobblestoneTexture(baseColor, darkColor, lightColor) {
        const canvas = document.createElement('canvas');
        canvas.width = this.size;
        canvas.height = this.size;
        const ctx = canvas.getContext('2d');

        // Base color
        ctx.fillStyle = darkColor;
        ctx.fillRect(0, 0, this.size, this.size);

        // Draw cobblestones in a semi-regular grid
        const stoneSize = 10;
        const gap = 2;

        for (let row = 0; row < this.size / (stoneSize + gap) + 1; row++) {
            const offset = (row % 2) * (stoneSize / 2 + gap / 2);
            for (let col = -1; col < this.size / (stoneSize + gap) + 1; col++) {
                const x = col * (stoneSize + gap) + offset + (Math.random() - 0.5) * 2;
                const y = row * (stoneSize + gap) + (Math.random() - 0.5) * 2;
                const w = stoneSize + (Math.random() - 0.5) * 4;
                const h = stoneSize + (Math.random() - 0.5) * 4;

                // Stone body
                const shade = Math.random();
                ctx.fillStyle = shade > 0.6 ? lightColor : (shade > 0.3 ? baseColor : darkColor);

                // Draw rounded rectangle
                ctx.beginPath();
                const r = 2;
                ctx.moveTo(x + r, y);
                ctx.lineTo(x + w - r, y);
                ctx.quadraticCurveTo(x + w, y, x + w, y + r);
                ctx.lineTo(x + w, y + h - r);
                ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
                ctx.lineTo(x + r, y + h);
                ctx.quadraticCurveTo(x, y + h, x, y + h - r);
                ctx.lineTo(x, y + r);
                ctx.quadraticCurveTo(x, y, x + r, y);
                ctx.closePath();
                ctx.fill();

                // Edge highlight
                ctx.strokeStyle = lightColor;
                ctx.globalAlpha = 0.3;
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(x + r, y);
                ctx.lineTo(x + w - r, y);
                ctx.stroke();
                ctx.globalAlpha = 1;
            }
        }

        return canvas;
    },

    // === SAND TEXTURE ===
    createSandTexture(baseColor, darkColor, lightColor) {
        const canvas = document.createElement('canvas');
        canvas.width = this.size;
        canvas.height = this.size;
        const ctx = canvas.getContext('2d');

        // Base color
        ctx.fillStyle = baseColor;
        ctx.fillRect(0, 0, this.size, this.size);

        // Sand grains
        for (let i = 0; i < 200; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            ctx.fillStyle = Math.random() > 0.5 ? darkColor : lightColor;
            ctx.globalAlpha = 0.2 + Math.random() * 0.3;
            ctx.beginPath();
            ctx.arc(x, y, 0.3 + Math.random() * 0.8, 0, Math.PI * 2);
            ctx.fill();
        }

        // Wind ripples
        ctx.globalAlpha = 0.15;
        ctx.strokeStyle = lightColor;
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
            const y = Math.random() * this.size;
            ctx.beginPath();
            ctx.moveTo(0, y);
            for (let x = 0; x < this.size; x += 4) {
                ctx.lineTo(x, y + Math.sin(x * 0.3) * 2);
            }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        return canvas;
    },

    // === ROCKY TEXTURE ===
    createRockyTexture(baseColor, darkColor, lightColor) {
        const canvas = document.createElement('canvas');
        canvas.width = this.size;
        canvas.height = this.size;
        const ctx = canvas.getContext('2d');

        // Base
        ctx.fillStyle = baseColor;
        ctx.fillRect(0, 0, this.size, this.size);

        // Rocky chunks
        for (let i = 0; i < 15; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            const size = 5 + Math.random() * 15;

            ctx.fillStyle = Math.random() > 0.5 ? darkColor : lightColor;
            ctx.globalAlpha = 0.4 + Math.random() * 0.3;

            // Irregular polygon
            ctx.beginPath();
            const points = 5 + Math.floor(Math.random() * 3);
            for (let j = 0; j < points; j++) {
                const angle = (j / points) * Math.PI * 2;
                const r = size * (0.5 + Math.random() * 0.5);
                const px = x + Math.cos(angle) * r;
                const py = y + Math.sin(angle) * r;
                if (j === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
        }

        // Cracks
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = darkColor;
        ctx.lineWidth = 0.5;
        for (let i = 0; i < 8; i++) {
            ctx.beginPath();
            let x = Math.random() * this.size;
            let y = Math.random() * this.size;
            ctx.moveTo(x, y);
            for (let j = 0; j < 3; j++) {
                x += (Math.random() - 0.5) * 15;
                y += (Math.random() - 0.5) * 15;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        return canvas;
    },

    // === CAVE TEXTURE (darker, more cracked) ===
    createCaveTexture(baseColor, darkColor, lightColor) {
        const canvas = document.createElement('canvas');
        canvas.width = this.size;
        canvas.height = this.size;
        const ctx = canvas.getContext('2d');

        // Dark base
        ctx.fillStyle = darkColor;
        ctx.fillRect(0, 0, this.size, this.size);

        // Uneven stone floor
        for (let i = 0; i < 20; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            const radiusX = 8 + Math.random() * 12;
            const radiusY = 6 + Math.random() * 10;

            ctx.fillStyle = Math.random() > 0.7 ? lightColor : baseColor;
            ctx.globalAlpha = 0.2 + Math.random() * 0.3;
            ctx.beginPath();
            ctx.ellipse(x, y, radiusX, radiusY, Math.random() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
        }

        // Deep cracks
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            let x = Math.random() * this.size;
            let y = Math.random() * this.size;
            ctx.moveTo(x, y);
            for (let j = 0; j < 4; j++) {
                x += (Math.random() - 0.5) * 20;
                y += (Math.random() - 0.5) * 20;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        return canvas;
    },

    // === MUD TEXTURE (for swamp) ===
    createMudTexture(baseColor, darkColor, lightColor) {
        const canvas = document.createElement('canvas');
        canvas.width = this.size;
        canvas.height = this.size;
        const ctx = canvas.getContext('2d');

        // Muddy base
        ctx.fillStyle = baseColor;
        ctx.fillRect(0, 0, this.size, this.size);

        // Wet patches
        for (let i = 0; i < 10; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            const radius = 5 + Math.random() * 10;

            ctx.fillStyle = darkColor;
            ctx.globalAlpha = 0.3 + Math.random() * 0.3;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }

        // Small puddles
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = '#2a3a3a';
        for (let i = 0; i < 5; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            ctx.beginPath();
            ctx.ellipse(x, y, 3 + Math.random() * 5, 2 + Math.random() * 3, Math.random() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
        }

        // Some sparse grass
        ctx.globalAlpha = 0.6;
        for (let i = 0; i < 15; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            ctx.strokeStyle = lightColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + (Math.random() - 0.5) * 2, y - 3 - Math.random() * 3);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;

        return canvas;
    },

    // === DIRT PATH TEXTURE ===
    createDirtPathTexture(baseColor, darkColor, lightColor) {
        const canvas = document.createElement('canvas');
        canvas.width = this.size;
        canvas.height = this.size;
        const ctx = canvas.getContext('2d');

        // Base dirt
        ctx.fillStyle = baseColor;
        ctx.fillRect(0, 0, this.size, this.size);

        // Footstep impressions
        ctx.globalAlpha = 0.25;
        for (let i = 0; i < 8; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            ctx.fillStyle = darkColor;
            ctx.beginPath();
            ctx.ellipse(x, y, 2 + Math.random() * 3, 4 + Math.random() * 5, Math.random() * Math.PI * 0.3, 0, Math.PI * 2);
            ctx.fill();
        }

        // Small pebbles
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 20; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            ctx.fillStyle = Math.random() > 0.5 ? '#7a7a7a' : lightColor;
            ctx.beginPath();
            ctx.arc(x, y, 0.5 + Math.random() * 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        return canvas;
    },

    // === WATER EDGE TEXTURE (for lake shoreline) ===
    createWaterEdgeTexture(baseColor, darkColor, lightColor) {
        const canvas = document.createElement('canvas');
        canvas.width = this.size;
        canvas.height = this.size;
        const ctx = canvas.getContext('2d');

        // Water-like base
        ctx.fillStyle = baseColor;
        ctx.fillRect(0, 0, this.size, this.size);

        // Ripples
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = lightColor;
        ctx.lineWidth = 1;
        for (let i = 0; i < 6; i++) {
            const y = (i / 6) * this.size + Math.random() * 8;
            ctx.beginPath();
            for (let x = 0; x < this.size; x += 2) {
                const yOffset = Math.sin(x * 0.2 + i) * 3;
                if (x === 0) ctx.moveTo(x, y + yOffset);
                else ctx.lineTo(x, y + yOffset);
            }
            ctx.stroke();
        }

        // Lighter patches (reflection)
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = lightColor;
        for (let i = 0; i < 8; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            ctx.beginPath();
            ctx.ellipse(x, y, 3 + Math.random() * 6, 1 + Math.random() * 3, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        // Small rocks at shore
        ctx.globalAlpha = 0.6;
        for (let i = 0; i < 5; i++) {
            const x = Math.random() * this.size;
            const y = Math.random() * this.size;
            ctx.fillStyle = '#5a5a5a';
            ctx.beginPath();
            ctx.arc(x, y, 1 + Math.random() * 2, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        return canvas;
    }
};

// ============================================
// PATHWAY NETWORK SYSTEM
// Generates connected roads that overlay on biomes
// Uses a seeded network of paths between landmarks
// ============================================
const PathwayNetwork = {
    paths: [],       // Array of path segments [{start: {x,y}, end: {x,y}}]
    nodes: [],       // Key waypoints/intersections
    pathTexture: null,
    seed: 12345,
    generated: false,

    init(seed) {
        this.seed = seed || Math.floor(Math.random() * 1000000);
        this.paths = [];
        this.nodes = [];
        this.generated = false;
        this.createPathTexture();
    },

    // Create dirt path texture
    createPathTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');

        // Base dirt color
        ctx.fillStyle = '#6a5a4a';
        ctx.fillRect(0, 0, 32, 32);

        // Add some variation
        for (let i = 0; i < 40; i++) {
            const x = Math.random() * 32;
            const y = Math.random() * 32;
            ctx.fillStyle = Math.random() > 0.5 ? '#5a4a3a' : '#7a6a5a';
            ctx.globalAlpha = 0.3 + Math.random() * 0.3;
            ctx.beginPath();
            ctx.arc(x, y, 0.5 + Math.random() * 1.5, 0, Math.PI * 2);
            ctx.fill();
        }

        // Add small pebbles
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 10; i++) {
            const x = Math.random() * 32;
            const y = Math.random() * 32;
            ctx.fillStyle = '#888';
            ctx.beginPath();
            ctx.arc(x, y, 0.5 + Math.random(), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        this.pathTexture = canvas;
    },

    // Seeded random number generator
    seededRandom(salt = 0) {
        let h = this.seed + salt;
        h = ((h << 5) - h + salt * 31) | 0;
        h = ((h << 5) - h + salt * 17) | 0;
        return Math.abs(h % 10000) / 10000;
    },

    // Generate the pathway network - called once when chunk manager is ready
    generate() {
        if (this.generated || typeof chunkManager === 'undefined') return;

        const chunkSize = Config.Chunks.size;
        const nodeSpacing = 8; // Nodes every 8 chunks on average
        const networkRadius = 30; // Generate paths within this many chunks of origin

        // Step 1: Generate landmark nodes (intersections, town centers, etc.)
        const nodeCount = 15;
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
            cx: 0, cy: 0,
            worldX: chunkSize / 2,
            worldY: chunkSize / 2
        });

        // Step 2: Connect nodes using a minimum spanning tree + some extra connections
        const connected = new Set([0]);
        const edges = [];

        // Build MST
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

        // Add a few extra random connections for loops
        for (let i = 0; i < 5; i++) {
            const a = Math.floor(this.seededRandom(i * 500) * this.nodes.length);
            const b = Math.floor(this.seededRandom(i * 500 + 1) * this.nodes.length);
            if (a !== b) {
                const dx = this.nodes[a].cx - this.nodes[b].cx;
                const dy = this.nodes[a].cy - this.nodes[b].cy;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < 15) { // Only connect nearby nodes
                    edges.push({ from: a, to: b });
                }
            }
        }

        // Step 3: Create actual path segments from edges
        for (let edge of edges) {
            const fromNode = this.nodes[edge.from];
            const toNode = this.nodes[edge.to];
            this.createPathBetween(fromNode, toNode);
        }

        this.generated = true;
        console.log(`PathwayNetwork generated: ${this.nodes.length} nodes, ${this.paths.length} segments`);
    },

    // Create a winding path between two nodes
    createPathBetween(from, to) {
        const chunkSize = Config.Chunks.size;
        const segments = [];

        // Start and end in chunk coordinates
        let cx = from.cx;
        let cy = from.cy;
        const targetCX = to.cx;
        const targetCY = to.cy;

        // Create path by stepping towards target with some wandering
        let prevX = from.worldX;
        let prevY = from.worldY;
        const maxSteps = Math.abs(targetCX - cx) + Math.abs(targetCY - cy) + 5;
        let step = 0;

        while ((cx !== targetCX || cy !== targetCY) && step < maxSteps) {
            step++;

            // Decide direction - mostly towards target, sometimes wander
            const dx = targetCX - cx;
            const dy = targetCY - cy;

            const rand = this.seededRandom(cx * 1000 + cy * 100 + step);

            if (rand < 0.15 && Math.abs(dx) > 1 && Math.abs(dy) > 1) {
                // Wander perpendicular
                if (rand < 0.075) {
                    cy += Math.sign(dy) !== 0 ? 0 : (rand < 0.0375 ? 1 : -1);
                    cx += Math.sign(dx) !== 0 ? 0 : (rand < 0.0375 ? 1 : -1);
                }
            } else {
                // Move towards target
                if (Math.abs(dx) > Math.abs(dy) || (Math.abs(dx) === Math.abs(dy) && rand > 0.5)) {
                    cx += Math.sign(dx);
                } else {
                    cy += Math.sign(dy);
                }
            }

            // Add segment
            const currX = cx * chunkSize + chunkSize / 2;
            const currY = cy * chunkSize + chunkSize / 2;

            segments.push({
                x1: prevX, y1: prevY,
                x2: currX, y2: currY,
                cx1: Math.floor(prevX / chunkSize),
                cy1: Math.floor(prevY / chunkSize),
                cx2: cx, cy2: cy
            });

            prevX = currX;
            prevY = currY;
        }

        this.paths.push(...segments);
    },

    // Check if a world position is on a pathway
    isOnPath(worldX, worldY, threshold = 25) {
        for (let seg of this.paths) {
            const dist = this.pointToSegmentDist(worldX, worldY, seg.x1, seg.y1, seg.x2, seg.y2);
            if (dist < threshold) return true;
        }
        return false;
    },

    // Distance from point to line segment
    pointToSegmentDist(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;

        if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);

        let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));

        const nearX = x1 + t * dx;
        const nearY = y1 + t * dy;

        return Math.sqrt((px - nearX) ** 2 + (py - nearY) ** 2);
    },

    // Get path segments visible in a given viewport
    getVisiblePaths(camX, camY, viewWidth, viewHeight, buffer = 400) {
        const minX = camX - viewWidth / 2 - buffer;
        const maxX = camX + viewWidth / 2 + buffer;
        const minY = camY - viewHeight / 2 - buffer;
        const maxY = camY + viewHeight / 2 + buffer;

        return this.paths.filter(seg => {
            return !(seg.x1 < minX && seg.x2 < minX) &&
                !(seg.x1 > maxX && seg.x2 > maxX) &&
                !(seg.y1 < minY && seg.y2 < minY) &&
                !(seg.y1 > maxY && seg.y2 > maxY);
        });
    },

    // Render pathways
    render(ctx, camX, camY, viewWidth, viewHeight) {
        if (!this.generated || this.paths.length === 0) return;

        const visible = this.getVisiblePaths(camX, camY, viewWidth, viewHeight);
        if (visible.length === 0) return;

        ctx.save();
        ctx.translate(-camX + viewWidth / 2, -camY + viewHeight / 2);

        // Create pattern if needed
        if (!this.pathPattern) {
            this.pathPattern = ctx.createPattern(this.pathTexture, 'repeat');
        }

        // Draw path segments as thick lines with texture
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Draw shadow/border first
        ctx.strokeStyle = '#3a3020';
        ctx.lineWidth = 52;
        ctx.beginPath();
        for (let seg of visible) {
            ctx.moveTo(seg.x1, seg.y1);
            ctx.lineTo(seg.x2, seg.y2);
        }
        ctx.stroke();

        // Draw main path
        ctx.strokeStyle = this.pathPattern || '#6a5a4a';
        ctx.lineWidth = 48;
        ctx.beginPath();
        for (let seg of visible) {
            ctx.moveTo(seg.x1, seg.y1);
            ctx.lineTo(seg.x2, seg.y2);
        }
        ctx.stroke();

        // Draw edge highlights
        ctx.strokeStyle = 'rgba(100, 90, 70, 0.3)';
        ctx.lineWidth = 44;
        ctx.beginPath();
        for (let seg of visible) {
            ctx.moveTo(seg.x1, seg.y1);
            ctx.lineTo(seg.x2, seg.y2);
        }
        ctx.stroke();

        ctx.restore();
    }
};

function initEngine() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    mCanvas = document.getElementById('magicCanvas');
    mCtx = mCanvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
}

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    mCanvas.width = window.innerWidth;
    mCanvas.height = window.innerHeight;
}

function update(dt) {
    Game.player.update(dt);

    // Update chunk manager for lazy loading
    if (typeof chunkManager !== 'undefined' && chunkManager.generated) {
        chunkManager.update(Game.player.pos);
    }

    // === WORLD OBJECTS ===
    for (let i = Game.objects.length - 1; i >= 0; i--) {
        let obj = Game.objects[i];
        obj.update(dt);
        if (obj.dead) { Game.objects.splice(i, 1); continue; }

        // Player Collision with Objects
        let playerDist = obj.pos.dist(Game.player.pos);
        if (playerDist < obj.rad + Game.player.rad && playerDist > 0) {
            let overlap = (obj.rad + Game.player.rad) - playerDist;
            let dir = Game.player.pos.sub(obj.pos).norm();

            if (obj.solid && !obj.moveable) {
                // Hard collision - push player out (ALWAYS, even while dashing)
                // Immortal objects cannot be dashed through
                Game.player.pos = Game.player.pos.add(dir.mul(overlap));
                // Kill velocity in that direction (with safety check)
                if (Game.player.vel && typeof Game.player.vel.dot === 'function') {
                    let dot = Game.player.vel.dot(dir);
                    if (dot < 0) Game.player.vel = Game.player.vel.sub(dir.mul(dot));
                }
                // End dash if hitting immortal object
                if (obj.hp === Infinity && Game.player.isDashing) {
                    Game.player.isDashing = false;
                    Game.player.dashTimer = 0;
                    // Impact particles
                    for (let k = 0; k < 8; k++) {
                        let sp = new Particle(Game.player.pos.x, Game.player.pos.y, '#fff');
                        sp.vel = dir.mul(-100).add(Vec2.fromAngle(Math.random() * Math.PI * 2).mul(80));
                        Game.parts.push(sp);
                    }
                }
            } else if (obj.moveable) {
                // Soft collision - push object
                let playerSpeed = Game.player.vel && Game.player.vel.mag ? Game.player.vel.mag() : 0;
                if (Game.player.isDashing || playerSpeed > 50) {
                    let pushForce = Game.player.vel.mul(0.1 * (100 / (obj.mass || 100)));
                    obj.vel = obj.vel.add(pushForce);
                }
                // Separate them based on mass
                let totalMass = (obj.mass || 100) + 10;
                let r1 = 10 / totalMass;
                let r2 = (obj.mass || 100) / totalMass;

                Game.player.pos = Game.player.pos.add(dir.mul(overlap * r2));
                obj.pos = obj.pos.sub(dir.mul(overlap * r1));
            }
        }

        // Player-Enemy Collision (push interaction)
        for (let e of Game.enemies) {
            let peDist = e.pos.dist(Game.player.pos);
            if (peDist < e.rad + Game.player.rad && peDist > 0) {
                let overlap = (e.rad + Game.player.rad) - peDist;
                let dir = Game.player.pos.sub(e.pos).norm();

                // Mass-based separation (player mass ~10, enemy mass ~50)
                let playerMass = 10;
                let enemyMass = 50;
                let totalMass = playerMass + enemyMass;
                let playerRatio = enemyMass / totalMass;
                let enemyRatio = playerMass / totalMass;

                Game.player.pos = Game.player.pos.add(dir.mul(overlap * playerRatio));
                e.pos = e.pos.sub(dir.mul(overlap * enemyRatio));

                // Transfer some momentum
                let relVel = Game.player.vel.sub(e.vel);
                let velDot = relVel.dot(dir);
                if (velDot < 0) {
                    let impulse = dir.mul(velDot * 0.5);
                    Game.player.vel = Game.player.vel.sub(impulse.mul(playerRatio));
                    e.vel = e.vel.add(impulse.mul(enemyRatio));
                }
            }
        }

        // Enemy Collision with Objects
        for (let e of Game.enemies) {
            let enemyDist = obj.pos.dist(e.pos);
            if (enemyDist < obj.rad + e.rad && enemyDist > 0) {
                let overlap = (obj.rad + e.rad) - enemyDist;
                let dir = e.pos.sub(obj.pos).norm();

                if (obj.solid && !obj.moveable) {
                    e.pos = e.pos.add(dir.mul(overlap));
                    if (e.vel && typeof e.vel.dot === 'function') {
                        let dot = e.vel.dot(dir);
                        if (dot < 0) e.vel = e.vel.sub(dir.mul(dot));
                    }
                } else if (obj.moveable) {
                    e.pos = e.pos.add(dir.mul(overlap * 0.5));
                    obj.pos = obj.pos.sub(dir.mul(overlap * 0.5));
                }
            }
        }

        // Object-to-Object Collision (moveable objects only)
        for (let j = i - 1; j >= 0; j--) {
            let other = Game.objects[j];
            if (other.dead) continue;
            if (!obj.moveable && !other.moveable) continue; // Skip if both immovable

            let objDist = obj.pos.dist(other.pos);
            if (objDist < obj.rad + other.rad && objDist > 0) {
                let overlap = (obj.rad + other.rad) - objDist;
                let dir = obj.pos.sub(other.pos).norm();

                // Mass-based separation
                let m1 = obj.moveable ? (obj.mass || 100) : Infinity;
                let m2 = other.moveable ? (other.mass || 100) : Infinity;

                if (m1 === Infinity && m2 === Infinity) continue;

                let r1, r2;
                if (m1 === Infinity) {
                    r1 = 0; r2 = 1;
                } else if (m2 === Infinity) {
                    r1 = 1; r2 = 0;
                } else {
                    let total = m1 + m2;
                    r1 = m2 / total;
                    r2 = m1 / total;
                }

                if (obj.moveable) obj.pos = obj.pos.add(dir.mul(overlap * r1));
                if (other.moveable) other.pos = other.pos.sub(dir.mul(overlap * r2));

                // Momentum exchange for moveable objects
                if (obj.moveable && other.moveable) {
                    let relVel = obj.vel.sub(other.vel);
                    let velDot = relVel.dot(dir);
                    if (velDot < 0) {
                        let impulse = dir.mul(velDot * 0.8);
                        obj.vel = obj.vel.sub(impulse.mul(r1));
                        other.vel = other.vel.add(impulse.mul(r2));
                    }
                }
            }
        }
    }

    // Projectiles
    for (let i = Game.projectiles.length - 1; i >= 0; i--) {
        let p = Game.projectiles[i];
        p.update(dt);
        if (p.dead) { Game.projectiles.splice(i, 1); continue; }
        // --- Object collision ---
        for (let obj of Game.objects) {
            if (obj.dead) continue;
            if (p.pos.dist(obj.pos) < p.rad + obj.rad) {
                if (obj.solid) {
                    // Check if this is a push projectile
                    let hasEarthBlunt = p.hasElement && p.hasElement('Earth') && p.data.physics === 'BLUNT';
                    let isBoulder = p.spectrum === 'BOULDER';
                    let isPushProjectile = hasEarthBlunt || isBoulder;

                    // Damage destructible objects
                    if (obj.hp !== Infinity) {
                        obj.hp -= (p.data.damage || 10);
                        // Fire can burn objects
                        if (p.hasElement && p.hasElement('Fire')) {
                            obj.applyEffect('burn', {
                                damage: Config.Effects.Fire.burnDamage,
                                duration: Config.Effects.Fire.burnDuration
                            });
                        }
                    }

                    // Push moveable objects
                    if (obj.moveable && p.data.vel) {
                        let dir = p.data.vel.norm();
                        let force = 100;
                        if (p.hasElement && p.hasElement('Air')) force = 500;
                        if (p.hasElement && p.hasElement('Earth')) force = 800;
                        if (isBoulder) force = 400; // BOULDER also pushes
                        obj.vel = obj.vel.add(dir.mul(force * (100 / (obj.mass || 100))));
                    }

                    // Projectile death/pierce logic
                    if (!isPushProjectile) {
                        for (let k = 0; k < 6; k++) Game.parts.push(new Particle(p.pos.x, p.pos.y, p.col));

                        // Pierce check
                        if (p.pierceRemaining > 0) {
                            p.pierceRemaining--;
                        } else {
                            p.dead = true;
                        }
                    }

                    if (p.dead) break;
                }
            }
        }
        if (p.dead) continue;

        // --- Enemy collision ---
        for (let e of Game.enemies) {
            if (p.pos.dist(e.pos) < p.rad + e.rad) {
                // Check if this is an Earth BLUNT or BOULDER push projectile
                let hasEarthBlunt = p.hasElement && p.hasElement('Earth') && p.data.physics === 'BLUNT';
                let isBoulder = p.spectrum === 'BOULDER';
                let isPushProjectile = hasEarthBlunt || isBoulder;

                // Apply damage (push projectiles use contact damage system instead)
                if (!isPushProjectile) {
                    // Pierce projectiles do reduced damage to subsequent targets
                    let dmg = p.data.damage || 10;
                    if (p.data.pierce > 0 && p.pierceRemaining < p.data.pierce) {
                        // Reduce damage by 20% per target already pierced
                        let pierced = p.data.pierce - p.pierceRemaining;
                        dmg *= Math.pow(0.8, pierced);
                    }
                    e.hp -= dmg;
                }

                // Apply elemental effects to ALL projectiles (Fire burns, Water slows, Air propels)
                applyElementalEffects(p, e);

                // Particles
                for (let k = 0; k < 8; k++) Game.parts.push(new Particle(p.pos.x, p.pos.y, p.col));

                // Determine if projectile should die or continue
                let overwhelm = false;
                // High Power ("Overwhelm") Logic:
                // If projectile power is significantly higher than enemy resistance (mass-based approximation), it doesn't die.
                // Boulder (mass ~100) vs Enemy (mass ~50).
                // Let's say if (p.power * mass_factor) > e.mass * 2, it overwhelms.
                // Simplified: usage of p.power.
                // Assuming base power ~10-20. Max power multiplier x10 -> 200.
                if (p.power > 50) { // arbitrary threshold for "powerful spell"
                    overwhelm = true;
                }

                if (!isPushProjectile && !overwhelm) {
                    // Pierce check - projectile continues if has pierce remaining
                    if (p.pierceRemaining > 0) {
                        p.pierceRemaining--;
                        // Pierce visual feedback
                        for (let k = 0; k < 3; k++) {
                            let pp = new Particle(p.pos.x, p.pos.y, '#fff');
                            pp.vel = Vec2.fromAngle(Math.random() * Math.PI * 2).mul(60);
                            Game.parts.push(pp);
                        }
                    } else {
                        // No pierce - projectile dies
                        p.dead = true;
                    }
                }

                if (e.hp <= 0) e.respawn();
                if (p.dead) break;
            }
        }
        if (p.dead) continue;

        // --- Player collision (self-hit) ---
        if (p.canHit(Game.player)) {
            if (p.pos.dist(Game.player.pos) < p.rad + Game.player.rad) {
                // Invincible during dash - projectiles pass through
                if (Game.player.isDashing) {
                    // Visual feedback that projectile passed through
                    for (let k = 0; k < 3; k++) {
                        let pp = new Particle(p.pos.x, p.pos.y, '#88f');
                        pp.vel = Vec2.fromAngle(Math.random() * Math.PI * 2).mul(100);
                        Game.parts.push(pp);
                    }
                    continue; // Skip all damage and effects
                }

                // Check if this is a push projectile
                let hasEarthBlunt = p.hasElement && p.hasElement('Earth') && p.data.physics === 'BLUNT';
                let isBoulder = p.spectrum === 'BOULDER';
                let isPushProjectile = hasEarthBlunt || isBoulder;

                // Apply damage (push projectiles use contact damage system instead)
                if (!isPushProjectile) {
                    Game.player.hp -= (p.data.damage || 10) * 0.5; // Self damage reduced
                }

                // Apply elemental effects to ALL projectiles
                applyElementalEffects(p, Game.player, true);

                // Particles
                for (let k = 0; k < 6; k++) Game.parts.push(new Particle(p.pos.x, p.pos.y, '#f00'));

                // Determine if projectile should die or continue
                if (!isPushProjectile) {
                    if (p.pierceRemaining > 0) {
                        p.pierceRemaining--;
                    } else {
                        p.dead = true;
                    }
                }
            }
        }
        if (p.dead) continue;

        // --- Projectile-vs-Projectile collision ---
        for (let j = i - 1; j >= 0; j--) {
            let other = Game.projectiles[j];
            if (other.dead) continue;
            if (p.pos.dist(other.pos) < p.rad + other.rad) {
                // Both projectiles collide - create explosion effect
                for (let k = 0; k < 12; k++) {
                    Game.parts.push(new Particle(
                        (p.pos.x + other.pos.x) / 2,
                        (p.pos.y + other.pos.y) / 2,
                        Math.random() > 0.5 ? p.col : other.col
                    ));
                }
                // Weaker projectile dies, or both if similar power
                if (p.power > other.power * 1.5) {
                    other.dead = true;
                    p.power -= other.power * 0.5; // Reduce power
                } else if (other.power > p.power * 1.5) {
                    p.dead = true;
                    other.power -= p.power * 0.5;
                } else {
                    // Similar power - both destroyed
                    p.dead = true;
                    other.dead = true;
                }
                break;
            }
        }
    }

    Game.enemies.forEach(e => e.update(dt, Game.player.pos));

    // Enemy-to-Enemy Collision (prevent stacking)
    for (let i = 0; i < Game.enemies.length; i++) {
        for (let j = i + 1; j < Game.enemies.length; j++) {
            let e1 = Game.enemies[i];
            let e2 = Game.enemies[j];
            let dist = e1.pos.dist(e2.pos);
            if (dist < e1.rad + e2.rad && dist > 0) {
                let overlap = (e1.rad + e2.rad) - dist;
                let dir = e1.pos.sub(e2.pos).norm();
                // Equal separation
                e1.pos = e1.pos.add(dir.mul(overlap * 0.5));
                e2.pos = e2.pos.sub(dir.mul(overlap * 0.5));
            }
        }
    }

    // Particles
    for (let i = Game.parts.length - 1; i >= 0; i--) {
        Game.parts[i].update(dt);
        if (Game.parts[i].life <= 0) Game.parts.splice(i, 1);
    }
}

/**
 * Apply elemental effects from projectile to target entity
 * @param {Projectile} proj - The projectile
 * @param {Entity} target - The target entity
 * @param {boolean} isSelf - If true, effects are reduced (self-hit)
 */
function applyElementalEffects(proj, target, isSelf = false) {
    let elements = proj.data.elements || [];
    let dir = proj.data.vel.norm();
    let selfMult = isSelf ? 0.5 : 1;

    for (let el of elements) {
        switch (el) {
            case 'Fire':
                // FIRE: Burns on hit (DoT damage)
                // Scale burn with power
                target.applyEffect('burn', {
                    damage: (Config.Effects.Fire.burnDamage * selfMult) + (proj.power * 0.2),
                    duration: Config.Effects.Fire.burnDuration + (proj.power * 0.05)
                });
                // Fire hit particles
                for (let i = 0; i < 5; i++) {
                    let fp = new Particle(target.pos.x, target.pos.y, '#ff4400');
                    fp.vel = Vec2.fromAngle(Math.random() * Math.PI * 2).mul(200);
                    Game.parts.push(fp);
                }
                break;

            case 'Water':
                // WATER: Slows on hit
                // Scale slow with power (cap at 90%)
                let slowAmt = Config.Effects.Water.slowAmount + (proj.power * 0.02);
                if (slowAmt > 0.9) slowAmt = 0.9;

                target.applyEffect('slow', {
                    amount: slowAmt,
                    duration: Config.Effects.Water.slowDuration * (isSelf ? 0.5 : 1) + (proj.power * 0.1)
                });
                // Water hit particles (blue splash)
                for (let i = 0; i < 6; i++) {
                    let wp = new Particle(target.pos.x, target.pos.y, '#4080ff');
                    wp.vel = Vec2.fromAngle(Math.random() * Math.PI * 2).mul(150);
                    Game.parts.push(wp);
                }
                break;

            case 'Air':
                // AIR: Propels/knockback (strong push)
                // Scale propel force drastically with power
                let airForce = Config.Effects.Air.propelForce + (proj.power * Config.Effects.Air.propelPowerScale * 2); // Doubled scaling
                if (proj.power > 30) airForce *= 1.5; // Bonus for high power

                airForce *= selfMult;
                target.vel = target.vel.add(dir.mul(airForce));
                // Air whoosh particles
                for (let i = 0; i < 8; i++) {
                    let ap = new Particle(target.pos.x, target.pos.y, '#aaeeff');
                    ap.vel = dir.mul(-100).add(Vec2.fromAngle(Math.random() * Math.PI * 2).mul(80));
                    Game.parts.push(ap);
                }
                break;

            case 'Earth':
                // EARTH: On direct hit, just applies base knockback (push-on-path handled in Projectile)
                // If high power, add extra knockback here too
                if (proj.power > 40) {
                    target.vel = target.vel.add(dir.mul(proj.power * 10));
                }

                // Add extra particles for impact
                for (let i = 0; i < 4; i++) {
                    let ep = new Particle(target.pos.x, target.pos.y, Config.Earth);
                    ep.vel = Vec2.fromAngle(Math.random() * Math.PI * 2).mul(100);
                    Game.parts.push(ep);
                }
                break;
        }
    }
}

function render() {
    // Background - Biome Map (Scaled Up Low-Res Grid)
    // This creates a smooth gradient attached to world coordinates
    let cam = Game.player.pos;

    // Create/Reuse temporary canvas for the biome map
    if (!window.biomeMapCanvas) {
        window.biomeMapCanvas = document.createElement('canvas');
        window.biomeMapCanvas.width = 12; // Cover ample area (viewport + buffer)
        window.biomeMapCanvas.height = 12;
        window.biomeMapCtx = window.biomeMapCanvas.getContext('2d');
    }

    if (typeof chunkManager !== 'undefined') {
        const size = Config.Chunks.size;
        // Determine player chunk
        let pcx = Math.floor(cam.x / size);
        let pcy = Math.floor(cam.y / size);

        // Map radius (half of canvas size)
        const radius = 6;

        // Update the mini-map pixels
        // We draw a grid of chunk colors centered on the player
        let imgData = window.biomeMapCtx.createImageData(12, 12);
        let data = imgData.data;

        for (let y = 0; y < 12; y++) {
            for (let x = 0; x < 12; x++) {
                // Calculate world chunk coordinate
                let cx = pcx + (x - radius);
                let cy = pcy + (y - radius);

                // Get color for this chunk
                let color = chunkManager.getChunkColor(cx, cy);

                let idx = (y * 12 + x) * 4;
                data[idx] = color.r;
                data[idx + 1] = color.g;
                data[idx + 2] = color.b;
                data[idx + 3] = 255; // Alpha
            }
        }
        window.biomeMapCtx.putImageData(imgData, 0, 0);

        // Draw the mini-map scaled up to world space
        // 1 pixel = 1 chunk size (320px)
        ctx.save();
        ctx.imageSmoothingEnabled = true; // Essential for linear interpolation (blur)
        ctx.imageSmoothingQuality = 'high';

        // Calculate world position of the top-left of our grid
        // The grid starts at player_chunk - radius
        let gridWorldX = (pcx - radius) * size;
        let gridWorldY = (pcy - radius) * size;

        // Camera transform
        ctx.translate(-cam.x + canvas.width / 2, -cam.y + canvas.height / 2);

        // Draw image stretched to match world scale
        // We offset by half a chunk (size/2) because getChunkColor sampled the *center* logic 
        // effectively, but putImageData fills pixels. 
        // To align pixel centers with chunk centers, we effectively just draw 1:1.
        // Actually, to align perfectly:
        // Pixel (0,0) represents chunk (pcx-6, pcy-6).
        // That chunk's world origin is (pcx-6)*320.
        // We render it covering that 320x320 area.
        ctx.drawImage(window.biomeMapCanvas,
            gridWorldX, gridWorldY,
            12 * size, 12 * size
        );

        ctx.restore();
    } else {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Draw biome-specific ground textures
    // Render texture overlays for visible chunks
    if (typeof chunkManager !== 'undefined' && BiomeTextures.textures) {
        ctx.save();
        ctx.translate(-cam.x + canvas.width / 2, -cam.y + canvas.height / 2);

        // Determine which chunks are visible
        const size = Config.Chunks.size;
        const startCX = Math.floor((cam.x - canvas.width / 2) / size) - 1;
        const endCX = Math.floor((cam.x + canvas.width / 2) / size) + 1;
        const startCY = Math.floor((cam.y - canvas.height / 2) / size) - 1;
        const endCY = Math.floor((cam.y + canvas.height / 2) / size) + 1;

        // Cache patterns per biome for this frame
        if (!window.biomePatterns) window.biomePatterns = {};

        for (let cy = startCY; cy <= endCY; cy++) {
            for (let cx = startCX; cx <= endCX; cx++) {
                const biome = chunkManager.getBiomeAt(cx, cy);
                const texture = BiomeTextures.getTexture(biome);

                // Create pattern if not cached
                if (!window.biomePatterns[biome]) {
                    window.biomePatterns[biome] = ctx.createPattern(texture, 'repeat');
                }

                const chunkX = cx * size;
                const chunkY = cy * size;

                ctx.save();
                ctx.globalAlpha = 0.5; // Blend with base biome color
                ctx.globalCompositeOperation = 'overlay';

                // Clip to this chunk
                ctx.beginPath();
                ctx.rect(chunkX, chunkY, size, size);
                ctx.clip();

                // Apply pattern
                ctx.fillStyle = window.biomePatterns[biome];
                ctx.fillRect(chunkX, chunkY, size, size);

                ctx.restore();
            }
        }

        ctx.restore();
    }

    // Generate and render pathway network overlay
    if (typeof chunkManager !== 'undefined' && chunkManager.generated) {
        // Generate pathways if not done yet (uses same seed as chunk manager)
        if (!PathwayNetwork.generated) {
            PathwayNetwork.seed = chunkManager.seed;
            PathwayNetwork.generate();
        }
        // Render pathways over biome colors
        PathwayNetwork.render(ctx, cam.x, cam.y, canvas.width, canvas.height);
    }

    // Render world objects (sorted by Y for depth)
    let sortedObjects = [...Game.objects].sort((a, b) => a.pos.y - b.pos.y);
    sortedObjects.forEach(obj => obj.render(ctx, cam));

    // Render enemies and player (sorted together by Y for proper depth)
    let entities = [...Game.enemies, Game.player].sort((a, b) => a.pos.y - b.pos.y);
    entities.forEach(e => e.render(ctx, cam));

    Game.projectiles.forEach(p => p.render(ctx, cam));
    Game.parts.forEach(p => p.render(ctx, cam));

    // Joystick
    if (Input.isMoving) {
        ctx.beginPath(); ctx.arc(Input.joyStart.x, Input.joyStart.y, 50, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(Input.joyCurr.x, Input.joyCurr.y, 20, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fill();
    }

    // HUD
    document.getElementById('hpBar').style.width = Game.player.hp + "%";
    document.getElementById('stBar').style.width = Game.player.stm + "%";
    document.getElementById('mAir').style.opacity = Game.player.mana.Air / 100;
    document.getElementById('mFire').style.opacity = Game.player.mana.Fire / 100;
    document.getElementById('mEarth').style.opacity = Game.player.mana.Earth / 100;
    document.getElementById('mWater').style.opacity = Game.player.mana.Water / 100;

    // Update cast indicators (mana-based)
    if (typeof updateCastIndicators === 'function') updateCastIndicators();

    // Debug Panel Update
    updateDebugPanel();
}

function updateDebugPanel() {
    let p = document.getElementById('debugPanel');
    if (!isGameRunning || p.style.display === 'none') return;

    let cx = Math.floor(Game.player.pos.x / Config.Chunks.size);
    let cy = Math.floor(Game.player.pos.y / Config.Chunks.size);

    document.getElementById('debugPos').textContent = `${Math.floor(Game.player.pos.x)}, ${Math.floor(Game.player.pos.y)}`;

    // Biome and Chunk Type
    if (typeof chunkManager !== 'undefined') {
        let chunk = chunkManager.getChunk(cx, cy);
        if (chunk) {
            document.getElementById('debugBiome').textContent = chunk.biome || 'Unknown';
            document.getElementById('debugChunkType').textContent = chunk.type || 'Generated';
        }
    }
}

let lastT = 0;
function loop(t) {
    let dt = (t - lastT) / 1000;
    lastT = t;
    if (dt > 0.1) dt = 0.1;
    update(dt);
    render();
    window.animationId = requestAnimationFrame(loop);
}

window.stopGameLoop = function () {
    cancelAnimationFrame(window.animationId);
};

function toggleMagicMenu(forceState) {
    if (forceState !== undefined) Game.isMagicOpen = forceState;
    else Game.isMagicOpen = !Game.isMagicOpen;

    let ctr = document.getElementById('magicContainer');
    if (Game.isMagicOpen) {
        let item = Game.getCurrentItem();
        if (!item || item.type !== 'SCROLL') {
            Game.isMagicOpen = false;
            return;
        }
        loadMagicFromScroll(item);
        ctr.style.display = 'block';
        Game.timeScale = 0.1;
        initNodes();
        renderMagic(); // Render immediately so nodes appear

        // Reset power slider
        resetPowerSlider();
        updatePowerPanel();

        // Hide Debug Panel
        document.getElementById('debugPanel').style.display = 'none';
    } else {
        saveMagicToScroll();
        ctr.style.display = 'none';
        Game.timeScale = 1.0;

        // Restore Debug Panel if game is running
        if (typeof isGameRunning !== 'undefined' && isGameRunning) {
            document.getElementById('debugPanel').style.display = 'block';
        }
    }
}

/**
 * Reset power slider to default
 */
function resetPowerSlider() {
    Magic.powerMultiplier = 1;
    let slider = document.getElementById('powerSlider');
    let valueDisplay = document.getElementById('powerValue');
    if (slider) slider.value = 1;
    if (valueDisplay) valueDisplay.textContent = '×1';
}

function initUI() {
    document.getElementById('btnToggleMagic').onclick = () => toggleMagicMenu();
    window.addEventListener('keydown', e => { if (e.key.toLowerCase() === 'm') toggleMagicMenu(); });

    document.addEventListener('pointerdown', e => {
        if (e.target.closest('.hud-panel') || e.target.closest('#inventoryBar') || e.target.closest('.mc-btn') || e.target.id === 'btnToggleMagic') return;
        if (Game.isMagicOpen) return;
        if (e.button === 2) { Game.projectiles.forEach(p => p.activate()); return; }
        let item = Game.getCurrentItem();
        if (item && item.type === 'SCROLL' && Game.player.castCooldown <= 0) {
            loadMagicFromScroll(item);
            cast();
            Game.player.castCooldown = Config.CastCooldown;
        }
    });

    document.getElementById('btnCancel').onclick = () => toggleMagicMenu(false);
    document.getElementById('btnClear').onclick = () => clearMagic();
    document.getElementById('btnCast').onclick = () => { saveMagicToScroll(); cast(); toggleMagicMenu(false); };

    // Main Menu Buttons
    document.getElementById('btnPlay').onclick = () => {
        document.getElementById('mainMenu').style.display = 'none';
        document.getElementById('debugPanel').style.display = 'block';
        isGameRunning = true;
        // Start loop if not running
        if (!window.animationId) requestAnimationFrame(loop);
    };

    document.getElementById('btnHowToPlay').onclick = () => {
        document.getElementById('howToPlay').style.display = 'flex';
    };

    document.getElementById('btnBackToMenu').onclick = () => {
        document.getElementById('howToPlay').style.display = 'none';
    };
}

function start() {
    if (window.stopGameLoop) window.stopGameLoop();
    initEngine();
    BiomeTextures.init(); // Initialize procedural ground textures
    PathwayNetwork.init(); // Initialize pathway network system
    Game.init();
    generateMap(); // Procedurally generate world objects
    initInput();
    initInventory();
    initMagicEditor();
    initLayerManager();
    initUI();
    // Do NOT start loop immediately. Wait for Play button.
    // requestAnimationFrame(loop); 
}

// Expose functions globally
window.resetPowerSlider = resetPowerSlider;

// Auto-start
start();

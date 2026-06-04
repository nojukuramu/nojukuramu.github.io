/**
 * MinimapSystem - 12x12 chunk-based minimap for GameScene
 * Ported from original main.js render function
 */
class MinimapSystem {
    constructor(scene) {
        this.scene = scene;
        this.size = 12;          // Grid size (12x12 chunks)
        this.cellSize = 8;       // Pixel size per cell
        this.mapWidth = this.size * this.cellSize;  // 96px
        this.mapHeight = this.size * this.cellSize; // 96px

        // Position (top-right corner)
        this.x = 0;
        this.y = 0;

        this.graphics = null;
        this.playerMarker = null;
        this.container = null;
    }

    create() {
        const cam = this.scene.cameras.main;
        this.x = cam.width - this.mapWidth - 20;
        this.y = 20;

        // Container for all minimap elements
        this.container = this.scene.add.container(this.x, this.y)
            .setScrollFactor(0)
            .setDepth(1000);

        // Background
        const bg = this.scene.add.rectangle(
            this.mapWidth / 2, this.mapHeight / 2,
            this.mapWidth + 4, this.mapHeight + 4,
            0x000000, 0.7
        );
        bg.setStrokeStyle(2, 0x444444);

        // Minimap graphics (for drawing biome colors)
        this.graphics = this.scene.add.graphics();

        // Player marker (center dot)
        this.playerMarker = this.scene.add.circle(
            this.mapWidth / 2, this.mapHeight / 2,
            3, 0x00ff00
        );
        this.playerMarker.setStrokeStyle(1, 0xffffff);

        this.container.add([bg, this.graphics, this.playerMarker]);

        // Label
        const label = this.scene.add.text(this.mapWidth / 2, -10, 'MAP', {
            fontFamily: 'Arial',
            fontSize: '10px',
            color: '#888888'
        }).setOrigin(0.5);
        this.container.add(label);
    }

    update(playerX, playerY, chunkManager) {
        if (!this.graphics || !chunkManager) return;

        const size = Config.Chunks.size;
        const pcx = Math.floor(playerX / size);
        const pcy = Math.floor(playerY / size);
        const radius = Math.floor(this.size / 2);

        this.graphics.clear();

        // Draw grid of chunk colors centered on player
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const cx = pcx + (x - radius);
                const cy = pcy + (y - radius);

                // Get biome color
                const biome = chunkManager.getBiomeAt(cx, cy);
                const hex = Config.Biomes[biome]?.color || '#111111';
                const color = parseInt(hex.replace('#', ''), 16);

                // Draw cell
                this.graphics.fillStyle(color, 1);
                this.graphics.fillRect(
                    x * this.cellSize,
                    y * this.cellSize,
                    this.cellSize,
                    this.cellSize
                );
            }
        }

        // Player position offset within current chunk (smooth movement)
        const chunkOffsetX = (playerX / size - pcx) * this.cellSize;
        const chunkOffsetY = (playerY / size - pcy) * this.cellSize;

        this.playerMarker.setPosition(
            this.mapWidth / 2 + chunkOffsetX,
            this.mapHeight / 2 + chunkOffsetY
        );
    }

    resize(width, height) {
        // Reposition on window resize
        this.x = width - this.mapWidth - 20;
        this.y = 20;
        if (this.container) {
            this.container.setPosition(this.x, this.y);
        }
    }
}

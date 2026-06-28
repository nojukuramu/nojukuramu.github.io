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

    update(playerX, playerY, floorManager, boss) {
        if (!this.graphics) return;

        this.graphics.clear();

        const floor = floorManager && floorManager.currentFloor;
        if (!floor) {
            this.graphics.fillStyle(0x111122, 1);
            this.graphics.fillRect(0, 0, this.mapWidth, this.mapHeight);
            if (this.playerMarker) this.playerMarker.setPosition(this.mapWidth / 2, this.mapHeight / 2);
            return;
        }

        const b = floor.bounds;

        // Floor background — biome colour
        const biome    = floor.theme ? floor.theme.biome : 'Clearing';
        const biomeCfg = (typeof Config !== 'undefined' && Config.Biomes && Config.Biomes[biome]) || {};
        const hexColor = biomeCfg.color || '#2a3a2a';
        const bgColor  = parseInt(hexColor.replace('#', ''), 16);
        this.graphics.fillStyle(bgColor, 1);
        this.graphics.fillRect(0, 0, this.mapWidth, this.mapHeight);

        // World → minimap helper
        const toMM = (wx, wy) => ({
            x: (wx - b.x) / b.width  * this.mapWidth,
            y: (wy - b.y) / b.height * this.mapHeight
        });

        // Floor border
        this.graphics.lineStyle(1, 0x445566, 0.6);
        this.graphics.strokeRect(0, 0, this.mapWidth, this.mapHeight);

        // Gate marker (green rect)
        if (floor.gate) {
            const gp = toMM(floor.gate.x, floor.gate.y);
            this.graphics.fillStyle(0x22cc88, 1);
            this.graphics.fillRect(gp.x - 4, gp.y - 2, 8, 4);
            if (floor.gate.unlockProgress > 0 && floor.gate.unlockSeconds > 0) {
                const pct = Math.min(1, floor.gate.unlockProgress / floor.gate.unlockSeconds);
                this.graphics.fillStyle(0x55ffbb, 1);
                this.graphics.fillRect(gp.x - 4, gp.y - 2, 8 * pct, 4);
            }
        }

        // Return rift marker (purple rect)
        if (floor.returnRift) {
            const rp = toMM(floor.returnRift.x, floor.returnRift.y);
            this.graphics.fillStyle(0x8844cc, 1);
            this.graphics.fillRect(rp.x - 3, rp.y - 2, 6, 4);
        }

        // Boss marker (red triangle)
        if (boss && !boss.isDead) {
            const bp = toMM(boss.x, boss.y);
            this.graphics.fillStyle(0xff2222, 1);
            this.graphics.fillTriangle(bp.x, bp.y - 4, bp.x + 4, bp.y + 2, bp.x - 4, bp.y + 2);
        }

        // Player dot
        const pp = toMM(playerX, playerY);
        if (this.playerMarker) {
            this.playerMarker.setPosition(
                Phaser.Math.Clamp(pp.x, 2, this.mapWidth - 2),
                Phaser.Math.Clamp(pp.y, 2, this.mapHeight - 2)
            );
        }
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

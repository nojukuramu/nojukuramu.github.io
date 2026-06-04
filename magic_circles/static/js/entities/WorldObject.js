/**
 * WorldObject - Environmental and interactive objects in the game world
 * Grid-based chunk system with preset layouts
 */
class WorldObject extends Entity {
    constructor(x, y, type, rotation = 0) {
        let cfg = Config.Objects[type] || Config.Objects.Rock;
        super(x, y, cfg.radius, cfg.color);

        this.type = type;
        this.maxHp = cfg.hp;
        this.hp = cfg.hp;
        this.mass = cfg.mass || 100;
        this.solid = cfg.solid !== undefined ? cfg.solid : true;
        this.moveable = cfg.moveable || false;
        this.friction = 0.92;
        this.rotation = rotation;
        this.sizeVariation = 0.9 + Math.random() * 0.2;

        // Track wall orientation for smoother visuals
        if (type === 'Wall') {
            this.wallOrientation = (Math.abs(rotation - Math.PI / 2) < 0.1) ? 'vertical' : 'horizontal';
        }

        if (type === 'Tree') {
            this.treeType = Math.floor(Math.random() * 3);
        }
    }

    update(dt) {
        if (this.moveable && this.vel.mag() > 1) {
            this.vel = this.vel.mul(this.friction);
            if (this.vel.mag() < 1) {
                this.vel = new Vec2(0, 0);
            }
        }

        if (this.hp !== Infinity && this.hp <= 0) {
            this.onDestroy();
            this.dead = true;
            return;
        }

        super.update(dt);
    }

    onDestroy() {
        let debrisCount = Math.floor(this.rad / 3);
        for (let i = 0; i < debrisCount; i++) {
            let p = new Particle(
                this.pos.x + (Math.random() - 0.5) * this.rad,
                this.pos.y + (Math.random() - 0.5) * this.rad,
                this.col
            );
            p.vel = Vec2.fromAngle(Math.random() * Math.PI * 2).mul(50 + Math.random() * 100);
            p.life = 1 + Math.random();
            Game.parts.push(p);
        }
    }

    render(ctx, cam) {
        let sx = this.pos.x - cam.x + canvas.width / 2;
        let sy = this.pos.y - cam.y + canvas.height / 2;

        // Frustum culling
        if (sx < -100 || sx > canvas.width + 100 || sy < -100 || sy > canvas.height + 100) {
            return null;
        }

        let r = this.rad * this.sizeVariation;

        ctx.save();
        ctx.translate(sx, sy);
        // Don't rotate walls - they use orientation-based drawing
        if (this.rotation !== 0 && this.type !== 'Wall') ctx.rotate(this.rotation);

        switch (this.type) {
            case 'Tree': this.drawTree(ctx, r); break;
            case 'Wall': this.drawWall(ctx, r); break;
            case 'Cliff': this.drawCliff(ctx, r); break;
            case 'Stairs': this.drawStairs(ctx, r); break;
            case 'Rock': this.drawRock(ctx, r); break;
            case 'Crate': this.drawCrate(ctx, r); break;
            case 'Barrel': this.drawBarrel(ctx, r); break;
            default:
                ctx.beginPath();
                ctx.arc(0, 0, r, 0, Math.PI * 2);
                ctx.fillStyle = this.col;
                ctx.fill();
        }

        ctx.restore();

        if (this.hp !== Infinity && this.hp < this.maxHp) {
            let pct = this.hp / this.maxHp;
            let barWidth = this.rad * 2;
            ctx.fillStyle = '#333';
            ctx.fillRect(sx - barWidth / 2, sy - this.rad - 10, barWidth, 4);
            ctx.fillStyle = pct > 0.5 ? '#0f0' : (pct > 0.25 ? '#ff0' : '#f00');
            ctx.fillRect(sx - barWidth / 2, sy - this.rad - 10, barWidth * pct, 4);
        }

        return new Vec2(sx, sy);
    }

    // Drawing methods - natural proportions
    drawTree(ctx, r) {
        if (this.treeType === 0) {
            // Pine tree - triangular
            ctx.fillStyle = '#3a2010';
            ctx.fillRect(-r * 0.15, 0, r * 0.3, r * 0.9);
            ctx.fillStyle = '#1a5a1a';
            ctx.beginPath();
            ctx.moveTo(0, -r * 1.3);
            ctx.lineTo(-r * 0.7, -r * 0.1);
            ctx.lineTo(r * 0.7, -r * 0.1);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#227722';
            ctx.beginPath();
            ctx.moveTo(0, -r * 0.9);
            ctx.lineTo(-r * 0.9, r * 0.3);
            ctx.lineTo(r * 0.9, r * 0.3);
            ctx.closePath();
            ctx.fill();
        } else if (this.treeType === 1) {
            // Round tree
            ctx.fillStyle = '#4a2f1a';
            ctx.fillRect(-r * 0.2, -r * 0.1, r * 0.4, r * 1.0);
            ctx.fillStyle = this.col;
            ctx.beginPath();
            ctx.arc(0, -r * 0.4, r * 0.9, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#1a6b1a';
            ctx.beginPath();
            ctx.arc(-r * 0.4, -r * 0.35, r * 0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(r * 0.4, -r * 0.25, r * 0.5, 0, Math.PI * 2);
            ctx.fill();
        } else {
            // Bush tree
            ctx.fillStyle = '#2d7a2d';
            ctx.beginPath();
            ctx.ellipse(0, 0, r * 1.1, r * 0.8, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#3a9a3a';
            ctx.beginPath();
            ctx.arc(-r * 0.4, -r * 0.2, r * 0.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawWall(ctx, r) {
        if (this.wallOrientation === 'vertical') {
            // Vertical wall - tall and thin
            ctx.fillStyle = '#5a5a5a';
            ctx.fillRect(-r * 0.5, -r * 1.5, r * 1.0, r * 3.0);
            // Brick lines
            ctx.strokeStyle = '#3a3a3a';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, -r * 1.5);
            ctx.lineTo(0, r * 1.5);
            ctx.moveTo(-r * 0.5, -r * 0.5);
            ctx.lineTo(0, -r * 0.5);
            ctx.moveTo(-r * 0.5, r * 0.5);
            ctx.lineTo(0, r * 0.5);
            ctx.stroke();
            // Top highlight
            ctx.fillStyle = '#777';
            ctx.fillRect(-r * 0.5, -r * 1.5, r * 1.0, 3);
        } else {
            // Horizontal wall - wide and short
            ctx.fillStyle = '#5a5a5a';
            ctx.fillRect(-r * 1.5, -r * 0.5, r * 3.0, r * 1.0);
            // Brick lines
            ctx.strokeStyle = '#3a3a3a';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-r * 1.5, 0);
            ctx.lineTo(r * 1.5, 0);
            ctx.moveTo(-r * 0.5, -r * 0.5);
            ctx.lineTo(-r * 0.5, 0);
            ctx.moveTo(r * 0.5, -r * 0.5);
            ctx.lineTo(r * 0.5, 0);
            ctx.stroke();
            // Top highlight
            ctx.fillStyle = '#777';
            ctx.fillRect(-r * 1.5, -r * 0.5, r * 3.0, 3);
        }
    }

    drawCliff(ctx, r) {
        ctx.fillStyle = '#4a4040';
        ctx.beginPath();
        ctx.moveTo(-r, r * 0.6);
        ctx.lineTo(-r * 0.9, 0);
        ctx.lineTo(-r * 0.6, -r * 0.4);
        ctx.lineTo(-r * 0.2, -r * 0.7);
        ctx.lineTo(r * 0.3, -r * 0.6);
        ctx.lineTo(r * 0.7, -r * 0.3);
        ctx.lineTo(r, r * 0.1);
        ctx.lineTo(r * 0.9, r * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#2a2525';
        ctx.beginPath();
        ctx.moveTo(-r, r * 0.6);
        ctx.lineTo(-r * 0.7, r * 0.4);
        ctx.lineTo(0, r * 0.5);
        ctx.lineTo(r * 0.7, r * 0.35);
        ctx.lineTo(r * 0.9, r * 0.6);
        ctx.closePath();
        ctx.fill();
    }

    drawStairs(ctx, r) {
        let steps = 5;
        let stepH = (r * 1.6) / steps;
        for (let i = 0; i < steps; i++) {
            let y = r * 0.8 - i * stepH;
            let shade = 60 + i * 15;
            ctx.fillStyle = `rgb(${shade}, ${shade - 10}, ${shade - 20})`;
            ctx.fillRect(-r * 1.0, y - stepH, r * 2.0, stepH - 2);
        }
    }

    drawRock(ctx, r) {
        ctx.fillStyle = this.col;
        ctx.beginPath();
        ctx.moveTo(r * 0.7, 0);
        ctx.quadraticCurveTo(r * 0.8, -r * 0.5, r * 0.4, -r * 0.75);
        ctx.quadraticCurveTo(0, -r * 0.9, -r * 0.5, -r * 0.6);
        ctx.quadraticCurveTo(-r * 0.9, -r * 0.3, -r * 0.8, r * 0.2);
        ctx.quadraticCurveTo(-r * 0.7, r * 0.7, 0, r * 0.75);
        ctx.quadraticCurveTo(r * 0.5, r * 0.7, r * 0.7, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#8899aa';
        ctx.beginPath();
        ctx.ellipse(-r * 0.2, -r * 0.3, r * 0.25, r * 0.15, -0.3, 0, Math.PI * 2);
        ctx.fill();
    }

    drawCrate(ctx, r) {
        ctx.fillStyle = this.col;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.strokeStyle = '#5a3010';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(-r * 0.9, -r * 0.9);
        ctx.lineTo(r * 0.9, r * 0.9);
        ctx.moveTo(r * 0.9, -r * 0.9);
        ctx.lineTo(-r * 0.9, r * 0.9);
        ctx.stroke();
        ctx.strokeStyle = '#3a2505';
        ctx.lineWidth = 2;
        ctx.strokeRect(-r, -r, r * 2, r * 2);
    }

    drawBarrel(ctx, r) {
        ctx.fillStyle = this.col;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#2a2a2a';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.15, 0, Math.PI * 2);
        ctx.fill();
    }
}

// ============================================
// OBJECT CODE MAPPING
// Unique codes for future extensibility
// ============================================
const ObjectCodes = {
    // Empty
    '__': null,
    '..': null,

    // Trees
    'TR': { type: 'Tree', rotation: 0 },
    'T1': { type: 'Tree', rotation: 0 },
    'T2': { type: 'Tree', rotation: 0 },

    // Rocks
    'RK': { type: 'Rock', rotation: 0 },
    'R1': { type: 'Rock', rotation: 0 },
    'R2': { type: 'Rock', rotation: 0 },

    // Walls (with rotation)
    'WH': { type: 'Wall', rotation: 0 },              // Horizontal
    'WV': { type: 'Wall', rotation: Math.PI / 2 },   // Vertical
    'WD': { type: 'Wall', rotation: Math.PI / 4 },   // Diagonal
    'WA': { type: 'Wall', rotation: -Math.PI / 4 },  // Anti-diagonal

    // Cliffs
    'CF': { type: 'Cliff', rotation: 0 },
    'C1': { type: 'Cliff', rotation: 0 },

    // Crates
    'CR': { type: 'Crate', rotation: 0 },
    'CX': { type: 'Crate', rotation: Math.PI / 4 },

    // Barrels
    'BR': { type: 'Barrel', rotation: 0 },
    'B1': { type: 'Barrel', rotation: 0 },

    // Stairs
    'ST': { type: 'Stairs', rotation: 0 },
    'SN': { type: 'Stairs', rotation: Math.PI / 2 },  // Stairs North
    'SE': { type: 'Stairs', rotation: 0 },            // Stairs East
    'SS': { type: 'Stairs', rotation: -Math.PI / 2 }, // Stairs South
    'SW': { type: 'Stairs', rotation: Math.PI },      // Stairs West
};

// ============================================
// CHUNK PRESETS - 8x8 Grid Layouts
// Each cell is a 2-character code
// rarity: 1.0 = common, 0.5 = uncommon, 0.2 = rare, 0.01 = synthetic/special
// ============================================
const ChunkPresets = {
    // === PLAINS BIOME PRESETS ===
    plains_open: {
        biome: 'Plains',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. RK .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    plains_scattered_rocks: {
        biome: 'Plains',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. RK .. .. .. RK .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. RK .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. RK .. .. .. RK .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    plains_bush_clump: {
        biome: 'Plains',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. TR .. TR .. .. ..',
            '.. .. .. TR .. .. .. ..',
            '.. .. TR .. TR .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    plains_rock_feature: {
        biome: 'Plains',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. RK RK .. .. .. ..',
            '.. .. RK RK RK .. .. ..',
            '.. .. .. RK .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    plains_ruin_remnant: {
        biome: 'Plains',
        rarity: 0.3,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. CR .. .. .. .. ..',
            '.. .. .. .. .. WD .. ..',
            '.. .. .. WH .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === FOREST BIOME ===
    forest_grove: {
        biome: 'Forest',
        rarity: 1.0,
        grid: [
            '.. .. TR TR .. .. .. ..',
            '.. TR TR TR TR .. .. ..',
            '.. TR TR TR .. .. RK ..',
            '.. .. TR TR .. .. .. ..',
            '.. .. .. .. .. TR .. ..',
            'RK .. .. .. TR TR .. ..',
            '.. .. .. .. TR .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    forest_dense: {
        biome: 'Forest',
        rarity: 0.8,
        grid: [
            'TR .. TR .. TR .. TR ..',
            '.. TR .. TR .. TR .. ..',
            'TR .. TR .. TR .. TR ..',
            '.. TR .. .. .. TR .. TR',
            'TR .. .. .. .. .. TR ..',
            '.. TR .. .. .. TR .. ..',
            'TR .. TR .. TR .. TR ..',
            '.. .. TR .. .. TR .. ..'
        ]
    },
    forest_edge: {
        biome: 'Forest',
        rarity: 1.0,
        grid: [
            'TR TR TR .. .. .. .. ..',
            'TR TR .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. TR ..',
            '.. .. .. .. .. TR TR TR'
        ]
    },

    // === RUINS BIOME ===
    ruins_lshape: {
        biome: 'Ruins',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. WH WH WH .. .. .. ..',
            '.. WV .. .. .. .. .. ..',
            '.. WV .. CR BR .. .. ..',
            '.. .. .. CR .. .. .. ..',
            '.. .. .. .. .. .. ST ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    ruins_room: {
        biome: 'Ruins',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. WH WH .. WH WH .. ..',
            '.. WV .. .. .. WV .. ..',
            '.. WV .. CR .. WV .. ..',
            '.. WV .. BR .. WV .. ..',
            '.. WH WH .. WH WH .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    ruins_scattered: {
        biome: 'Ruins',
        rarity: 1.0,
        grid: [
            '.. WD .. .. .. .. .. ..',
            '.. .. .. .. WH .. .. ..',
            '.. .. CR .. .. .. .. ..',
            '.. .. .. .. .. WV .. ..',
            '.. .. .. BR .. .. .. ..',
            'WA .. .. .. .. .. CR ..',
            '.. .. .. ST .. .. .. ..',
            '.. .. .. .. .. WD .. ..'
        ]
    },

    // === ROCKY/CAVE BIOME ===
    rocky_formation: {
        biome: 'Rocky',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. RK .. .. .. RK .. ..',
            '.. .. .. CF .. .. .. ..',
            '.. .. CF .. .. CF .. ..',
            '.. .. .. CF .. .. .. ..',
            '.. RK .. .. .. RK .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    cave_entrance: {
        biome: 'Cave',
        rarity: 1.0,
        grid: [
            'CF CF .. .. .. .. CF CF',
            'CF .. .. .. .. .. .. CF',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'CF .. .. .. .. .. .. CF',
            'CF CF .. .. .. .. CF CF'
        ]
    },

    // === VILLAGE BIOME ===
    village_house: {
        biome: 'Village',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. WH WH WH WH .. .. ..',
            '.. WV .. .. WV .. .. ..',
            '.. WV BR CR WV .. CR ..',
            '.. WH .. WH WH .. .. ..',
            '.. .. .. .. .. .. BR ..',
            '.. .. CR .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    village_market: {
        biome: 'Village',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. CR CR .. CR CR .. ..',
            '.. BR .. .. .. BR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. BR .. .. .. BR .. ..',
            '.. CR CR .. CR CR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. WH WH .. .. ..'
        ]
    },

    // === CAMP BIOME ===
    camp_circle: {
        biome: 'Camp',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. CR .. .. CR .. ..',
            '.. CR .. .. .. .. CR ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. BR .. .. .. .. BR ..',
            '.. .. CR .. .. CR .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    camp_storage: {
        biome: 'Camp',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. CR CR CR CR .. .. ..',
            '.. CR BR BR CR .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. WH .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === GRAVEYARD BIOME ===
    graveyard_rows: {
        biome: 'Graveyard',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. WV .. WV .. WV .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. WV .. WV .. WV .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. WV .. .. .. WV .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === SWAMP BIOME ===
    swamp_dead: {
        biome: 'Swamp',
        rarity: 1.0,
        grid: [
            '.. TR .. .. .. .. .. ..',
            '.. .. .. BR .. TR .. ..',
            '.. .. TR .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. TR .. .. .. ..',
            '.. TR .. .. .. .. BR ..',
            '.. .. .. .. TR .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === DESERT BIOME ===
    desert_sparse: {
        biome: 'Desert',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. RK .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. CR ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === LAKE BIOME ===
    lake_shore: {
        biome: 'Lake',
        rarity: 1.0,
        grid: [
            'RK RK .. .. .. .. RK ..',
            'RK .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. RK',
            '.. RK .. .. .. .. RK RK'
        ]
    },

    // === CLEARING BIOME (SPAWN) ===
    clearing_empty: {
        biome: 'Clearing',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    clearing_corner: {
        biome: 'Clearing',
        rarity: 0.8,
        grid: [
            'TR .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === MORE FOREST VARIANTS ===
    forest_clearing: {
        biome: 'Forest',
        rarity: 1.0,
        grid: [
            'TR TR .. .. .. .. TR TR',
            'TR .. .. .. .. .. .. TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. TR',
            'TR TR .. .. .. .. TR TR'
        ]
    },
    forest_path: {
        biome: 'Forest',
        rarity: 1.0,
        grid: [
            'TR TR TR .. .. TR TR TR',
            'TR TR .. .. .. .. TR TR',
            'TR .. .. .. .. .. .. TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. TR',
            'TR TR .. .. .. .. TR TR',
            'TR TR TR .. .. TR TR TR'
        ]
    },
    forest_rocks: {
        biome: 'Forest',
        rarity: 0.5,
        grid: [
            '.. TR .. .. .. TR .. ..',
            'TR .. .. .. .. .. TR ..',
            '.. .. TR .. .. TR .. ..',
            '.. .. .. TR TR .. .. ..',
            '.. .. TR TR TR TR .. ..',
            '.. .. .. TR TR .. .. ..',
            'TR .. .. .. .. .. .. TR',
            '.. .. RK .. .. .. .. ..'
        ]
    },
    forest_corner: {
        biome: 'Forest',
        rarity: 0.8,
        grid: [
            'TR TR TR TR TR .. .. ..',
            'TR TR TR TR .. .. .. ..',
            'TR TR TR .. .. .. .. ..',
            'TR TR .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === MORE RUINS VARIANTS ===
    ruins_tower: {
        biome: 'Ruins',
        rarity: 0.5,
        grid: [
            '.. .. WH WH WH WH .. ..',
            '.. .. WV .. .. WV .. ..',
            '.. .. WV CR CR WV .. ..',
            '.. .. WV BR BR WV .. ..',
            '.. .. WH .. .. WH .. ..',
            '.. .. .. ST .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    dense_forest: {
        biome: 'Forest',
        rarity: 0.01,  // Synthetic: too uniform diagonal fill
        grid: [
            '.. .. TR TR TR .. .. ..',
            '.. TR TR TR TR TR .. ..',
            'TR TR TR TR TR TR TR ..',
            'TR TR TR TR TR TR TR ..',
            'TR TR TR TR TR TR TR TR',
            '.. TR TR TR TR TR TR TR',
            '.. .. TR TR TR TR TR TR',
            '.. .. .. TR TR TR TR ..'
        ]
    },
    ruins_corridor: {
        biome: 'Ruins',
        rarity: 0.8,
        grid: [
            'WH WH .. .. .. .. WH WH',
            'WV .. .. .. .. .. .. WV',
            'WV .. .. .. .. .. .. WV',
            '.. .. .. CR .. .. .. ..',
            '.. .. .. BR .. .. .. ..',
            'WV .. .. .. .. .. .. WV',
            'WV .. .. .. .. .. .. WV',
            'WH WH .. ST .. .. WH WH'
        ]
    },
    ruins_broken: {
        biome: 'Ruins',
        rarity: 1.0,
        grid: [
            '.. WD .. .. .. WA .. ..',
            '.. .. .. .. .. .. .. ..',
            'WH .. .. .. .. .. WH ..',
            '.. .. CR .. .. BR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. WV .. .. .. .. WV ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. WA .. .. WD .. ..'
        ]
    },
    ruins_courtyard: {
        biome: 'Ruins',
        rarity: 0.5,
        grid: [
            'WH WH WH .. .. WH WH WH',
            'WV .. .. .. .. .. .. WV',
            'WV .. CR .. .. CR .. WV',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. ST .. .. .. ..',
            'WV .. BR .. .. BR .. WV',
            'WV .. .. .. .. .. .. WV',
            'WH WH .. .. .. .. WH WH'
        ]
    },

    // === MORE ROCKY VARIANTS ===
    rocky_scattered: {
        biome: 'Rocky',
        rarity: 0.01,  // Synthetic: checkerboard pattern
        grid: [
            'RK .. .. RK .. .. RK ..',
            '.. .. RK .. .. RK .. ..',
            '.. RK .. .. RK .. .. RK',
            'RK .. .. CF .. .. RK ..',
            '.. .. RK .. .. RK .. ..',
            '.. RK .. .. RK .. .. ..',
            'RK .. .. RK .. .. RK ..',
            '.. .. RK .. .. RK .. ..'
        ]
    },
    rocky_wall: {
        biome: 'Rocky',
        rarity: 0.01,  // Synthetic: perfect straight wall
        grid: [
            '.. .. .. .. .. .. .. ..',
            'CF CF CF CF CF CF CF CF',
            '.. .. RK .. .. RK .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. RK .. .. .. .. RK ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. RK .. .. RK .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    rocky_pillars: {
        biome: 'Rocky',
        rarity: 0.5,
        grid: [
            '.. CF .. .. .. .. CF ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. CF .. .. CF .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. CF .. .. .. .. CF ..'
        ]
    },

    // === MORE CAVE VARIANTS ===
    cave_narrow: {
        biome: 'Cave',
        rarity: 0.8,
        grid: [
            'CF CF CF .. .. CF CF CF',
            'CF CF .. .. .. .. CF CF',
            'CF .. .. .. .. .. .. CF',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'CF .. .. .. .. .. .. CF',
            'CF CF .. .. .. .. CF CF',
            'CF CF CF .. .. CF CF CF'
        ]
    },
    cave_chamber: {
        biome: 'Cave',
        rarity: 0.5,
        grid: [
            'CF CF CF CF CF CF CF CF',
            'CF .. .. .. .. .. .. CF',
            'CF .. .. .. .. .. .. CF',
            'CF .. .. .. .. .. .. CF',
            'CF .. .. .. .. .. .. CF',
            'CF .. .. .. .. .. .. CF',
            'CF .. .. .. .. .. .. CF',
            'CF CF .. .. .. .. CF CF'
        ]
    },

    // === MORE VILLAGE VARIANTS ===
    village_double: {
        biome: 'Village',
        rarity: 0.5,
        grid: [
            'WH WH WH .. WH WH WH ..',
            'WV .. WV .. WV .. WV ..',
            'WH .. WH .. WH .. WH ..',
            '.. .. .. .. .. .. .. ..',
            '.. CR .. BR .. CR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. BR .. CR .. BR .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    village_workshop: {
        biome: 'Village',
        rarity: 0.8,
        grid: [
            '.. WH WH WH WH WH .. ..',
            '.. WV CR CR CR WV .. ..',
            '.. WV CR BR CR WV .. ..',
            '.. WH .. .. .. WH .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. BR .. .. .. .. BR ..',
            '.. CR .. ST .. .. CR ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    village_plaza: {
        biome: 'Village',
        rarity: 0.8,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. WV .. .. .. .. WV ..',
            '.. .. CR .. .. CR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. ST .. .. .. ..',
            '.. .. BR .. .. BR .. ..',
            '.. WV .. .. .. .. WV ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === MORE CAMP VARIANTS ===
    camp_defensive: {
        biome: 'Camp',
        rarity: 0.01,  // Synthetic: too symmetrical
        grid: [
            'RK .. .. .. .. .. .. RK',
            '.. CR CR .. .. CR CR ..',
            '.. CR .. .. .. .. CR ..',
            '.. .. .. BR BR .. .. ..',
            '.. .. .. BR BR .. .. ..',
            '.. CR .. .. .. .. CR ..',
            '.. CR CR .. .. CR CR ..',
            'RK .. .. .. .. .. .. RK'
        ]
    },
    camp_line: {
        biome: 'Camp',
        rarity: 0.01,  // Synthetic: perfect line pattern
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. CR CR CR CR CR CR ..',
            '.. BR BR BR BR BR BR ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    camp_scattered: {
        biome: 'Camp',
        rarity: 1.0,
        grid: [
            '.. .. CR .. .. .. .. ..',
            '.. .. .. .. BR .. .. ..',
            'BR .. .. .. .. .. CR ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. CR .. .. BR .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. BR .. .. .. .. .. ..',
            '.. .. .. CR .. .. .. ..'
        ]
    },

    // === MORE GRAVEYARD VARIANTS ===
    graveyard_cross: {
        biome: 'Graveyard',
        rarity: 0.01,  // Synthetic: perfect cross pattern
        grid: [
            '.. .. .. WV .. .. .. ..',
            '.. .. .. WV .. .. .. ..',
            '.. .. .. WV .. .. .. ..',
            'WH WH WH WV WH WH WH ..',
            '.. .. .. WV .. .. .. ..',
            '.. .. .. WV .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    graveyard_scattered: {
        biome: 'Graveyard',
        rarity: 1.0,
        grid: [
            '.. WV .. .. .. WV .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. WV .. .. WV .. ..',
            'WV .. .. .. .. .. WV ..',
            '.. .. .. WV .. .. .. ..',
            '.. WV .. .. .. .. .. ..',
            '.. .. .. .. WV .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === MORE SWAMP VARIANTS ===
    swamp_murky: {
        biome: 'Swamp',
        rarity: 1.0,
        grid: [
            '.. TR .. BR .. .. TR ..',
            'BR .. .. .. .. TR .. ..',
            '.. .. TR .. .. .. .. BR',
            '.. .. .. .. TR .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. TR .. .. .. TR .. ..',
            '.. .. .. BR .. .. .. ..',
            'TR .. .. .. .. .. BR ..'
        ]
    },
    swamp_island: {
        biome: 'Swamp',
        rarity: 0.3,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. RK RK RK RK RK .. ..',
            '.. RK TR .. .. TR .. ..',
            '.. RK .. .. .. .. .. ..',
            '.. RK .. BR .. .. RK ..',
            '.. .. TR .. .. TR RK ..',
            '.. .. RK RK RK RK RK ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === MORE DESERT VARIANTS ===
    desert_dunes: {
        biome: 'Desert',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. RK .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. RK ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    desert_oasis: {
        biome: 'Desert',
        rarity: 0.3,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. RK RK RK .. .. ..',
            '.. RK .. .. .. RK .. ..',
            '.. RK .. TR TR .. .. ..',
            '.. .. .. TR TR .. RK ..',
            '.. RK .. .. .. RK .. ..',
            '.. .. .. RK RK .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    desert_ruins: {
        biome: 'Desert',
        rarity: 0.5,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. WD .. .. .. WA .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. WA .. .. .. WD .. ..',
            '.. .. .. CR .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === MORE LAKE VARIANTS ===  
    lake_island: {
        biome: 'Lake',
        rarity: 0.3,
        grid: [
            'RK .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. RK RK RK .. .. ..',
            '.. .. RK TR TR RK .. ..',
            '.. .. RK TR TR RK .. ..',
            '.. .. .. RK RK .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. RK'
        ]
    },
    lake_corner: {
        biome: 'Lake',
        rarity: 0.5,
        grid: [
            'RK RK RK .. .. .. .. ..',
            'RK RK .. .. .. .. .. ..',
            'RK .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === MORE CLEARING VARIANTS ===
    clearing_rocks: {
        biome: 'Clearing',
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. RK .. ..',
            '.. .. .. .. RK .. .. ..'
        ]
    },
    clearing_edges: {
        biome: 'Clearing',
        grid: [
            'TR .. .. .. .. .. .. TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'RK .. .. .. .. .. .. RK'
        ]
    },

    // === EXTRA FOREST VARIANTS ===
    forest_spiral: {
        biome: 'Forest',
        rarity: 0.01,  // Synthetic: artificial maze pattern
        grid: [
            'TR TR TR TR TR .. .. ..',
            '.. .. .. .. TR .. .. ..',
            'TR TR TR .. TR .. TR TR',
            'TR .. .. .. TR .. TR ..',
            'TR .. TR TR TR .. TR ..',
            'TR .. TR .. .. .. TR ..',
            'TR .. TR TR TR TR TR ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    forest_scattered: {
        biome: 'Forest',
        rarity: 0.01,  // Synthetic: checkerboard pattern
        grid: [
            'TR .. .. TR .. .. TR ..',
            '.. .. TR .. .. TR .. ..',
            '.. TR .. .. TR .. .. TR',
            'TR .. .. TR .. .. TR ..',
            '.. .. TR .. .. TR .. ..',
            '.. TR .. .. TR .. .. TR',
            'TR .. .. TR .. .. TR ..',
            '.. .. TR .. .. TR .. ..'
        ]
    },
    forest_walls: {
        biome: 'Forest',
        rarity: 0.01,  // Synthetic: perfect straight walls
        grid: [
            'TR TR TR TR TR TR TR TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'TR TR TR TR TR TR TR TR'
        ]
    },
    forest_cross: {
        biome: 'Forest',
        rarity: 0.01,  // Synthetic: perfect cross pattern
        grid: [
            '.. .. .. TR .. .. .. ..',
            '.. .. .. TR .. .. .. ..',
            '.. .. .. TR .. .. .. ..',
            'TR TR TR TR TR TR TR TR',
            '.. .. .. TR .. .. .. ..',
            '.. .. .. TR .. .. .. ..',
            '.. .. .. TR .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === EXTRA RUINS VARIANTS ===
    ruins_temple: {
        biome: 'Ruins',
        rarity: 0.3,
        grid: [
            '.. WH WH WH WH WH WH ..',
            '.. WV .. .. .. .. WV ..',
            '.. WV .. CR CR .. WV ..',
            '.. WV .. CR CR .. WV ..',
            '.. WV .. BR BR .. WV ..',
            '.. WV .. .. .. .. WV ..',
            '.. WH WH .. .. WH WH ..',
            '.. .. .. ST ST .. .. ..'
        ]
    },
    ruins_maze: {
        biome: 'Ruins',
        rarity: 0.01,  // Synthetic: maze pattern
        grid: [
            'WH WH WH .. WH WH WH WH',
            '.. .. WV .. WV .. .. ..',
            'WH .. WV .. WV .. WH WH',
            'WV .. .. .. .. .. .. WV',
            'WV .. WH WH WH WH .. WV',
            '.. .. .. .. .. WV .. ..',
            'WH WH WH .. .. WV .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    ruins_pillars: {
        biome: 'Ruins',
        rarity: 0.01,  // Synthetic: too regular pattern
        grid: [
            '.. WV .. WV .. WV .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. WV .. WV .. WV .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. WV .. WV .. WV .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. WV .. .. .. WV .. ..',
            '.. .. CR .. .. .. BR ..'
        ]
    },
    ruins_hall: {
        biome: 'Ruins',
        rarity: 0.5,
        grid: [
            'WH WH WH WH WH WH WH WH',
            'WV .. .. .. .. .. .. WV',
            'WV .. .. .. .. .. .. WV',
            '.. .. .. CR .. .. .. ..',
            '.. .. .. BR .. .. .. ..',
            'WV .. .. .. .. .. .. WV',
            'WV .. .. .. .. .. .. WV',
            'WH WH .. .. .. .. WH WH'
        ]
    },

    // === EXTRA ROCKY VARIANTS ===
    rocky_maze: {
        biome: 'Rocky',
        rarity: 0.01,  // Synthetic: checkerboard maze
        grid: [
            'CF .. RK .. CF .. RK ..',
            '.. RK .. .. .. RK .. ..',
            'RK .. CF .. RK .. CF ..',
            '.. .. .. RK .. .. .. RK',
            'CF .. RK .. CF .. RK ..',
            '.. RK .. .. .. RK .. ..',
            'RK .. CF .. RK .. CF ..',
            '.. .. .. RK .. .. .. ..'
        ]
    },
    rocky_corner: {
        biome: 'Rocky',
        rarity: 0.5,
        grid: [
            'CF CF CF .. .. .. .. ..',
            'CF CF .. .. .. .. .. ..',
            'CF .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. CF ..',
            '.. .. .. .. .. CF CF ..',
            '.. .. .. .. CF CF CF ..'
        ]
    },

    // === EXTRA CAVE VARIANTS ===
    cave_tunnel: {
        biome: 'Cave',
        rarity: 0.8,
        grid: [
            'CF CF CF .. .. CF CF CF',
            'CF .. .. .. .. .. .. CF',
            'CF .. .. .. .. .. .. CF',
            'CF .. .. .. .. .. .. CF',
            'CF .. .. .. .. .. .. CF',
            'CF .. .. .. .. .. .. CF',
            'CF .. .. .. .. .. .. CF',
            'CF CF CF .. .. CF CF CF'
        ]
    },
    cave_pillars: {
        biome: 'Cave',
        rarity: 0.01,  // Synthetic: checkerboard pattern
        grid: [
            'CF .. CF .. CF .. CF ..',
            '.. .. .. .. .. .. .. ..',
            'CF .. .. .. CF .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'CF .. CF .. CF .. CF ..',
            '.. .. .. .. .. .. .. ..',
            'CF .. .. .. CF .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === EXTRA VILLAGE VARIANTS ===
    village_street: {
        biome: 'Village',
        rarity: 0.8,
        grid: [
            'WH WH WH .. .. WH WH WH',
            'WV CR WV .. .. WV BR WV',
            'WH .. WH .. .. WH .. WH',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'WH .. WH .. .. WH .. WH',
            'WV BR WV .. .. WV CR WV',
            'WH WH WH .. .. WH WH WH'
        ]
    },
    village_storage: {
        biome: 'Village',
        rarity: 0.01,  // Synthetic: perfect nested rectangle
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. CR CR CR CR CR CR ..',
            '.. CR BR BR BR BR CR ..',
            '.. CR BR .. .. BR CR ..',
            '.. CR BR .. .. BR CR ..',
            '.. CR BR BR BR BR CR ..',
            '.. CR CR CR CR CR CR ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    village_corner: {
        biome: 'Village',
        rarity: 0.8,
        grid: [
            'WH WH WH WH .. .. .. ..',
            'WV .. .. WV .. .. .. ..',
            'WV CR BR WV .. .. .. ..',
            'WH .. .. WH .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. WH WH WH',
            '.. .. .. .. .. WV CR WV',
            '.. .. .. .. .. WH .. WH'
        ]
    },

    // === EXTRA CAMP VARIANTS ===
    camp_fortified: {
        biome: 'Camp',
        rarity: 0.3,
        grid: [
            'WH WH WH .. .. WH WH WH',
            'WV CR .. .. .. .. CR WV',
            'WV .. BR BR BR BR .. WV',
            '.. .. BR .. .. BR .. ..',
            '.. .. BR .. .. BR .. ..',
            'WV .. BR BR BR BR .. WV',
            'WV CR .. .. .. .. CR WV',
            'WH WH .. .. .. .. WH WH'
        ]
    },
    camp_corner: {
        biome: 'Camp',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. CR CR CR .. .. .. ..',
            '.. CR BR CR .. .. .. ..',
            '.. CR CR CR .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === EXTRA GRAVEYARD VARIANTS ===
    graveyard_circle: {
        biome: 'Graveyard',
        rarity: 0.01,  // Synthetic: perfect circle
        grid: [
            '.. .. WV WV WV WV .. ..',
            '.. WV .. .. .. .. WV ..',
            'WV .. .. .. .. .. .. WV',
            'WV .. .. .. .. .. .. WV',
            'WV .. .. .. .. .. .. WV',
            'WV .. .. .. .. .. .. WV',
            '.. WV .. .. .. .. WV ..',
            '.. .. WV WV WV WV .. ..'
        ]
    },
    graveyard_path: {
        biome: 'Graveyard',
        rarity: 0.8,
        grid: [
            'WV .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === EXTRA SWAMP VARIANTS ===
    swamp_pools: {
        biome: 'Swamp',
        rarity: 0.5,
        grid: [
            'RK RK .. .. .. .. RK ..',
            'RK .. .. TR .. .. .. ..',
            '.. .. .. .. .. TR .. ..',
            '.. TR .. .. .. .. .. ..',
            '.. .. .. .. .. .. TR ..',
            '.. .. TR .. .. .. .. ..',
            '.. .. .. .. TR .. .. RK',
            '.. RK .. .. .. .. RK RK'
        ]
    },
    swamp_dense: {
        biome: 'Swamp',
        rarity: 0.01,  // Synthetic: checkerboard pattern
        grid: [
            'TR .. BR .. TR .. BR ..',
            '.. TR .. TR .. TR .. TR',
            'BR .. TR .. BR .. TR ..',
            '.. TR .. TR .. TR .. ..',
            'TR .. BR .. TR .. BR ..',
            '.. TR .. TR .. TR .. TR',
            '.. .. TR .. .. .. TR ..',
            '.. .. .. TR .. .. .. ..'
        ]
    },

    // === EXTRA DESERT VARIANTS ===
    desert_camp: {
        biome: 'Desert',
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. CR CR CR .. .. ..',
            '.. .. CR BR CR .. .. ..',
            '.. .. CR CR CR .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. RK .. .. .. RK .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. RK .. .. .. ..'
        ]
    },
    desert_rocks: {
        biome: 'Desert',
        grid: [
            'RK .. .. .. .. .. .. RK',
            '.. .. RK .. .. RK .. ..',
            '.. RK .. .. .. .. RK ..',
            '.. .. .. RK .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. RK .. .. .. RK .. ..',
            '.. .. RK .. .. .. RK ..',
            'RK .. .. .. .. .. .. RK'
        ]
    },

    // === EXTRA LAKE VARIANTS ===
    lake_peninsula: {
        biome: 'Lake',
        grid: [
            'RK RK RK RK RK .. .. ..',
            'RK .. .. .. RK .. .. ..',
            'RK .. TR .. RK .. .. ..',
            'RK .. .. .. RK .. .. ..',
            'RK RK RK RK RK .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. RK RK',
            '.. .. .. .. .. .. RK RK'
        ]
    },
    lake_double: {
        biome: 'Lake',
        grid: [
            'RK RK RK .. .. RK RK RK',
            'RK .. RK .. .. RK .. RK',
            'RK RK RK .. .. RK RK RK',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'RK RK RK .. .. RK RK RK',
            'RK .. RK .. .. RK .. RK',
            'RK RK RK .. .. RK RK RK'
        ]
    },

    // === EXTRA PATHWAY VARIANTS ===
    pathway_crossing: {
        biome: 'Pathway',
        grid: [
            '.. .. .. RK .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'RK .. .. .. .. .. .. RK',
            'RK .. .. .. .. .. .. RK',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. RK .. .. .. ..'
        ]
    },
    pathway_wide: {
        biome: 'Pathway',
        grid: [
            'TR .. .. .. .. .. .. TR',
            'TR .. .. .. .. .. .. TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. TR',
            'TR .. .. .. .. .. .. TR'
        ]
    },

    // === CORRIDOR PRESETS (all edges open) ===
    corridor_cross: {
        biome: 'Pathway',
        rarity: 1.0,
        grid: [
            'TR .. .. .. .. .. .. TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. TR'
        ]
    },
    corridor_ns: {
        biome: 'Pathway',
        rarity: 1.0,
        grid: [
            'TR TR .. .. .. .. TR TR',
            'TR .. .. .. .. .. .. TR',
            'TR .. .. .. .. .. .. TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. TR',
            'TR .. .. .. .. .. .. TR',
            'TR TR .. .. .. .. TR TR'
        ]
    },
    corridor_ew: {
        biome: 'Pathway',
        rarity: 1.0,
        grid: [
            'TR TR TR .. .. TR TR TR',
            'TR .. .. .. .. .. .. TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. TR',
            'TR TR TR .. .. TR TR TR'
        ]
    },

    // === FOREST PATH PRESETS ===
    forest_path_ns: {
        biome: 'Forest',
        rarity: 1.0,
        grid: [
            'TR TR .. .. .. .. TR TR',
            'TR .. .. .. .. .. .. TR',
            'TR .. .. .. .. .. .. TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. TR',
            'TR .. .. .. .. .. .. TR',
            'TR TR .. .. .. .. TR TR'
        ]
    },
    forest_path_ew: {
        biome: 'Forest',
        rarity: 1.0,
        grid: [
            'TR TR TR .. .. TR TR TR',
            'TR TR .. .. .. .. TR TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'TR TR .. .. .. .. TR TR',
            'TR TR TR .. .. TR TR TR'
        ]
    },
    forest_path_cross: {
        biome: 'Forest',
        rarity: 1.0,
        grid: [
            'TR TR .. .. .. .. TR TR',
            'TR .. .. .. .. .. .. TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. TR',
            'TR TR .. .. .. .. TR TR'
        ]
    },
    forest_path_corner: {
        biome: 'Forest',
        rarity: 0.8,
        grid: [
            'TR TR TR TR TR TR TR TR',
            'TR TR .. .. .. .. TR TR',
            'TR .. .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. ..',
            'TR TR .. .. .. .. TR TR',
            'TR TR .. .. .. .. TR TR'
        ]
    },

    // === PLAINS PRESETS ===
    plains_open: {
        biome: 'Pathway',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    plains_rocks: {
        biome: 'Pathway',
        rarity: 0.8,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. RK .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. RK .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    plains_sparse: {
        biome: 'Pathway',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. RK .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. RK .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === RUINS CORRIDOR ===
    ruins_corridor_ns: {
        biome: 'Ruins',
        rarity: 0.8,
        grid: [
            'WV WV .. .. .. .. WV WV',
            'WV .. .. .. .. .. .. WV',
            'WV .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. WV',
            'WV .. .. .. .. .. .. WV',
            'WV WV .. .. .. .. WV WV'
        ]
    },
    ruins_corridor_ew: {
        biome: 'Ruins',
        rarity: 0.8,
        grid: [
            'WH WH WH .. .. WH WH WH',
            'WH .. .. .. .. .. .. WH',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'WH .. .. .. .. .. .. WH',
            'WH WH WH .. .. WH WH WH'
        ]
    },

    // === ROCKY PATH ===
    rocky_path_ns: {
        biome: 'Rocky',
        rarity: 1.0,
        grid: [
            'RK CF .. .. .. .. CF RK',
            'CF .. .. .. .. .. .. CF',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'CF .. .. .. .. .. .. CF',
            'RK CF .. .. .. .. CF RK'
        ]
    },
    rocky_path_ew: {
        biome: 'Rocky',
        rarity: 1.0,
        grid: [
            'RK CF .. .. .. .. CF RK',
            'CF .. .. .. .. .. .. CF',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'CF .. .. .. .. .. .. CF',
            'RK CF .. .. .. .. CF RK'
        ]
    },

    // === VILLAGE STREET ===
    village_road_ns: {
        biome: 'Village',
        rarity: 1.0,
        grid: [
            'WH WH .. .. .. .. WH WH',
            'WV CR .. .. .. .. CR WV',
            'WV .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. WV',
            'WV CR .. .. .. .. CR WV',
            'WH WH .. .. .. .. WH WH'
        ]
    },
    village_road_ew: {
        biome: 'Village',
        rarity: 1.0,
        grid: [
            'WH WV WV .. .. WV WV WH',
            'WH CR .. .. .. .. CR WH',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'WH CR .. .. .. .. CR WH',
            'WH WV WV .. .. WV WV WH'
        ]
    },

    // === DESERT PATH ===
    desert_path: {
        biome: 'Desert',
        rarity: 1.0,
        grid: [
            '.. RK .. .. .. .. RK ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. RK .. .. .. .. RK ..'
        ]
    },
    desert_wide: {
        biome: 'Desert',
        rarity: 1.0,
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. RK .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. RK .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },

    // === SWAMP PATH ===
    swamp_path: {
        biome: 'Swamp',
        rarity: 1.0,
        grid: [
            'TR .. .. .. .. .. .. TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. TR'
        ]
    },

    // === GRAVEYARD PATH ===
    graveyard_path_ns: {
        biome: 'Graveyard',
        rarity: 1.0,
        grid: [
            'WV .. .. .. .. .. .. WV',
            'WV .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. WV',
            'WV .. .. .. .. .. .. WV'
        ]
    },

    // === CAMP PATH ===
    camp_road: {
        biome: 'Camp',
        rarity: 1.0,
        grid: [
            'CR .. .. .. .. .. .. CR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'CR .. .. .. .. .. .. CR'
        ]
    },

    // === LAKE SHORE PATH ===
    lake_path: {
        biome: 'Lake',
        rarity: 1.0,
        grid: [
            'RK .. .. .. .. .. .. RK',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'RK .. .. .. .. .. .. RK'
        ]
    },

    // === CAVE CORRIDOR ===
    cave_corridor: {
        biome: 'Cave',
        rarity: 1.0,
        grid: [
            'CF CF .. .. .. .. CF CF',
            'CF .. .. .. .. .. .. CF',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'CF .. .. .. .. .. .. CF',
            'CF CF .. .. .. .. CF CF'
        ]
    }
};

// ============================================
// CHUNK MANAGER - Infinite Procedural Generation
// ============================================

// Multi-chunk structure definitions (each part has position offset and preset)
const MultiChunkStructures = {
    // 2x2 Fortress
    fortress: {
        size: { w: 2, h: 2 },
        rarity: 50, // 1 in 50 chance per valid cell
        biomes: ['Ruins', 'Village'],
        parts: [
            { dx: 0, dy: 0, preset: 'fortress_nw' },
            { dx: 1, dy: 0, preset: 'fortress_ne' },
            { dx: 0, dy: 1, preset: 'fortress_sw' },
            { dx: 1, dy: 1, preset: 'fortress_se' }
        ]
    },
    // 2x2 Dense Forest Grove
    huge_grove: {
        size: { w: 2, h: 2 },
        rarity: 30,
        biomes: ['Forest'],
        parts: [
            { dx: 0, dy: 0, preset: 'grove_nw' },
            { dx: 1, dy: 0, preset: 'grove_ne' },
            { dx: 0, dy: 1, preset: 'grove_sw' },
            { dx: 1, dy: 1, preset: 'grove_se' }
        ]
    },
    // 2x2 Large Lake
    big_lake: {
        size: { w: 2, h: 2 },
        rarity: 40,
        biomes: ['Lake', 'Swamp'],
        parts: [
            { dx: 0, dy: 0, preset: 'lake_nw' },
            { dx: 1, dy: 0, preset: 'lake_ne' },
            { dx: 0, dy: 1, preset: 'lake_sw' },
            { dx: 1, dy: 1, preset: 'lake_se' }
        ]
    }
};

// Multi-chunk structure preset parts
const StructurePresets = {
    // Fortress parts (2x2)
    fortress_nw: {
        grid: [
            'WH WH WH WH WH WH WH WH',
            'WV .. .. .. .. .. .. ..',
            'WV .. CR CR CR CR .. ..',
            'WV .. CR BR BR CR .. ..',
            'WV .. CR BR BR CR .. ..',
            'WV .. CR CR CR CR .. ..',
            'WV .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    fortress_ne: {
        grid: [
            'WH WH WH WH WH WH WH WH',
            '.. .. .. .. .. .. .. WV',
            '.. .. CR CR CR CR .. WV',
            '.. .. CR BR BR CR .. WV',
            '.. .. CR BR BR CR .. WV',
            '.. .. CR CR CR CR .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    fortress_sw: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. WV .. .. WV .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. ST ST .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WV .. .. .. .. .. .. ..',
            'WH WH WH .. .. WH WH WH'
        ]
    },
    fortress_se: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. WV',
            '.. .. WV .. .. WV .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. ST ST .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            '.. .. .. .. .. .. .. WV',
            'WH WH WH .. .. WH WH WH'
        ]
    },
    // Grove parts (2x2) - Natural irregular edges
    grove_nw: {
        grid: [
            'TR TR TR TR TR .. TR ..',
            'TR TR TR TR .. TR .. ..',
            'TR TR TR TR .. .. .. ..',
            'TR TR TR .. .. .. .. ..',
            'TR TR .. .. .. .. .. ..',
            'TR .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    grove_ne: {
        grid: [
            '.. TR .. TR TR TR TR TR',
            '.. .. TR TR TR TR TR TR',
            '.. .. .. TR TR TR TR TR',
            '.. .. .. .. TR TR TR TR',
            '.. .. .. .. .. TR TR TR',
            '.. .. .. .. .. .. TR TR',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    grove_sw: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'TR TR .. .. .. .. .. ..',
            'TR TR TR .. .. .. .. ..',
            'TR TR TR TR .. .. .. ..',
            'TR TR TR TR TR .. .. ..',
            'TR TR TR TR TR TR .. ..',
            'TR TR TR TR TR .. TR ..'
        ]
    },
    grove_se: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. TR TR',
            '.. .. .. .. .. TR TR TR',
            '.. .. .. .. TR TR TR TR',
            '.. .. .. TR TR TR TR TR',
            '.. .. TR TR TR TR TR TR',
            '.. TR .. TR TR TR TR TR'
        ]
    },
    // Lake parts (2x2) - Natural irregular shore
    lake_nw: {
        grid: [
            'RK RK RK RK RK .. RK ..',
            'RK RK RK RK .. RK .. ..',
            'RK RK RK RK .. .. .. ..',
            'RK RK RK .. .. .. .. ..',
            'RK RK .. .. .. .. .. ..',
            'RK .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    lake_ne: {
        grid: [
            '.. RK .. RK RK RK RK RK',
            '.. .. RK RK RK RK RK RK',
            '.. .. .. RK RK RK RK RK',
            '.. .. .. .. RK RK RK RK',
            '.. .. .. .. .. RK RK RK',
            '.. .. .. .. .. .. RK RK',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..'
        ]
    },
    lake_sw: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            'RK RK .. .. .. .. .. ..',
            'RK RK RK .. .. .. .. ..',
            'RK RK RK RK .. .. .. ..',
            'RK RK RK RK RK .. .. ..',
            'RK RK RK RK RK RK .. ..',
            'RK RK RK RK RK .. RK ..'
        ]
    },
    lake_se: {
        grid: [
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. .. ..',
            '.. .. .. .. .. .. RK RK',
            '.. .. .. .. .. RK RK RK',
            '.. .. .. .. RK RK RK RK',
            '.. .. .. RK RK RK RK RK',
            '.. .. RK RK RK RK RK RK',
            '.. RK .. RK RK RK RK RK'
        ]
    }
};

class ChunkManager {
    constructor() {
        this.chunks = new Map();
        this.biomeCache = new Map();
        this.structureCache = new Map(); // Cache for multi-chunk structure placements
        this.spatialHash = new SpatialHash(100);
        this.generated = false;
        this.gridSize = 8;
        this.tileSize = Config.Chunks.size / 8;
        this.seed = Math.floor(Math.random() * 1000000);
    }

    init() {
        this.tileSize = Config.Chunks.size / this.gridSize;
        this.generated = true;
        console.log('Infinite world initialized with seed:', this.seed);
    }

    // Simple hash function for deterministic randomness
    hash(x, y) {
        let h = this.seed;
        h = ((h << 5) - h + x) | 0;
        h = ((h << 5) - h + y) | 0;
        h = ((h << 5) - h + (x * 31)) | 0;
        h = ((h << 5) - h + (y * 17)) | 0;
        return Math.abs(h);
    }

    // Seeded random [0, 1) for a coordinate
    seededRandom(x, y, salt = 0) {
        return (this.hash(x + salt * 1000, y + salt * 777) % 10000) / 10000;
    }

    // Get biome for any chunk coordinate (deterministic)
    // Uses weighted random based on biome rarity
    // Get biome for any chunk coordinate (deterministic)
    getBiomeAt(cx, cy) {
        let key = `${cx},${cy}`;
        if (this.biomeCache.has(key)) {
            return this.biomeCache.get(key);
        }

        // Spawn area is always Clearing
        if (Math.abs(cx) <= 1 && Math.abs(cy) <= 1) {
            this.biomeCache.set(key, 'Clearing');
            return 'Clearing';
        }

        // Initialize separated biome lists if not done
        if (!this.largeBiomes) {
            this.largeBiomes = [];
            this.largeTotal = 0;
            this.smallBiomes = [];
            this.smallTotal = 0;

            for (let [name, cfg] of Object.entries(Config.Biomes)) {
                if (name === 'Clearing') continue; // Spawn only
                let item = { name, weight: cfg.rarity || 1.0 };

                if (cfg.scale === 'small') {
                    this.smallBiomes.push(item);
                    this.smallTotal += item.weight;
                } else {
                    this.largeBiomes.push(item);
                    this.largeTotal += item.weight;
                }
            }
        }

        // Layer 1: Small Feature Biomes (Patches)
        // Scale 10 = ~3200px patches
        // Density 35%: 35% of the world is covered by these small distinct biomes
        let smallRegionX = Math.floor(cx / 10);
        let smallRegionY = Math.floor(cy / 10);
        let smallRand = this.seededRandom(smallRegionX, smallRegionY, 12345);

        if (smallRand < 0.35) {
            let selectRand = this.seededRandom(smallRegionX, smallRegionY, 67890);
            let target = selectRand * this.smallTotal;
            let sum = 0;
            for (let b of this.smallBiomes) {
                sum += b.weight;
                if (sum >= target) {
                    this.biomeCache.set(key, b.name);
                    return b.name;
                }
            }
        }

        // Layer 2: Large Base Biomes (Continents)
        // Scale 60 = ~19200px regions
        let largeRegionX = Math.floor(cx / 60);
        let largeRegionY = Math.floor(cy / 60);
        let largeRand = this.seededRandom(largeRegionX, largeRegionY, 54321);

        let target = largeRand * this.largeTotal;
        let sum = 0;
        for (let b of this.largeBiomes) {
            sum += b.weight;
            if (sum >= target) {
                this.biomeCache.set(key, b.name);
                return b.name;
            }
        }

        // Fallback
        let fallback = this.largeBiomes[0].name;
        this.biomeCache.set(key, fallback);
        return fallback;
    }

    // Get smoothed biome color at exact world position
    getInterpolatedBiomeColor(x, y) {
        const size = Config.Chunks.size;
        // Offset by half chunk size to center grid on chunk centers
        // Because a chunk at (0,0) has center at (160, 160)
        let gx = (x - size / 2) / size;
        let gy = (y - size / 2) / size;

        let ix = Math.floor(gx);
        let iy = Math.floor(gy);
        let fx = gx - ix;
        let fy = gy - iy;

        // Sample 4 nearest chunk centers
        let c00 = this.getChunkColor(ix, iy);
        let c10 = this.getChunkColor(ix + 1, iy);
        let c01 = this.getChunkColor(ix, iy + 1);
        let c11 = this.getChunkColor(ix + 1, iy + 1);

        // Bilinear interpolation
        let top = this.lerpColor(c00, c10, fx);
        let bottom = this.lerpColor(c01, c11, fx);
        let final = this.lerpColor(top, bottom, fy);

        return `rgb(${final.r}, ${final.g}, ${final.b})`;
    }

    getChunkColor(cx, cy) {
        let biome = this.getBiomeAt(cx, cy);
        let hex = Config.Biomes[biome] ? Config.Biomes[biome].color : '#111111';
        return this.hexToRgb(hex);
    }

    hexToRgb(hex) {
        let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? {
            r: parseInt(result[1], 16),
            g: parseInt(result[2], 16),
            b: parseInt(result[3], 16)
        } : { r: 17, g: 17, b: 17 };
    }

    lerpColor(c1, c2, t) {
        return {
            r: Math.round(c1.r + (c2.r - c1.r) * t),
            g: Math.round(c1.g + (c2.g - c1.g) * t),
            b: Math.round(c1.b + (c2.b - c1.b) * t)
        };
    }

    getChunkCoords(worldX, worldY) {
        const size = Config.Chunks.size;
        return {
            x: Math.floor(worldX / size),
            y: Math.floor(worldY / size)
        };
    }

    getChunkKey(cx, cy) {
        return `${cx},${cy}`;
    }

    // No boundaries - always valid
    isValidChunk(cx, cy) {
        return true;
    }

    getChunk(cx, cy) {
        return this.loadChunk(cx, cy);
    }

    loadChunk(cx, cy) {
        let key = this.getChunkKey(cx, cy);
        if (this.chunks.has(key)) return this.chunks.get(key);

        let biome = this.getBiomeAt(cx, cy);
        let chunk = {
            x: cx, y: cy, biome: biome,
            objects: [], loaded: true, preset: null
        };

        // Check if this chunk is part of a multi-chunk structure
        let structurePart = this.getStructurePart(cx, cy);
        if (structurePart) {
            this.loadStructurePreset(chunk, structurePart);
        } else {
            this.loadPresetIntoChunk(chunk);
        }

        this.chunks.set(key, chunk);

        for (let obj of chunk.objects) {
            Game.objects.push(obj);
            this.spatialHash.insert(obj);
        }

        return chunk;
    }

    // Check if a chunk is part of a multi-chunk structure
    getStructurePart(cx, cy) {
        // Check if we're already cached as part of a structure
        let key = this.getChunkKey(cx, cy);
        if (this.structureCache.has(key)) {
            return this.structureCache.get(key);
        }

        let biome = this.getBiomeAt(cx, cy);

        // Check each structure type
        for (let [name, struct] of Object.entries(MultiChunkStructures)) {
            if (!struct.biomes.includes(biome)) continue;

            // Check if this position could be the origin of a structure
            let rand = this.seededRandom(cx, cy, 10);
            if (rand * struct.rarity < 1) {
                // This is a structure origin! Cache all parts
                for (let part of struct.parts) {
                    let px = cx + part.dx;
                    let py = cy + part.dy;
                    let partKey = this.getChunkKey(px, py);
                    this.structureCache.set(partKey, {
                        structure: name,
                        preset: part.preset,
                        originX: cx,
                        originY: cy
                    });
                }
                return this.structureCache.get(key);
            }
        }

        // Check if we're part of someone else's structure (from a previous origin)
        for (let [name, struct] of Object.entries(MultiChunkStructures)) {
            for (let part of struct.parts) {
                let originX = cx - part.dx;
                let originY = cy - part.dy;
                let originBiome = this.getBiomeAt(originX, originY);

                if (struct.biomes.includes(originBiome)) {
                    let rand = this.seededRandom(originX, originY, 10);
                    if (rand * struct.rarity < 1) {
                        // Cache this structure's parts
                        for (let p of struct.parts) {
                            let px = originX + p.dx;
                            let py = originY + p.dy;
                            let partKey = this.getChunkKey(px, py);
                            this.structureCache.set(partKey, {
                                structure: name,
                                preset: p.preset,
                                originX: originX,
                                originY: originY
                            });
                        }
                        return this.structureCache.get(key);
                    }
                }
            }
        }

        return null;
    }

    // Load a structure preset into a chunk
    loadStructurePreset(chunk, structurePart) {
        let preset = StructurePresets[structurePart.preset];
        if (!preset) return;

        chunk.preset = `structure:${structurePart.preset}`;
        chunk.edges = this.analyzePresetEdges(preset.grid);

        const size = Config.Chunks.size;
        let chunkWorldX = chunk.x * size;
        let chunkWorldY = chunk.y * size;

        for (let row = 0; row < preset.grid.length; row++) {
            let cells = preset.grid[row].split(' ');
            for (let col = 0; col < cells.length; col++) {
                let code = cells[col];
                let objDef = ObjectCodes[code];

                if (objDef) {
                    let cellX = chunkWorldX + (col + 0.5) * this.tileSize;
                    let cellY = chunkWorldY + (row + 0.5) * this.tileSize;

                    if (Math.abs(cellX) < 80 && Math.abs(cellY) < 80) continue;

                    let offsetRng = this.tileSize * 0.1;
                    cellX += (this.seededRandom(chunk.x * 8 + col, chunk.y * 8 + row, 3) - 0.5) * offsetRng;
                    cellY += (this.seededRandom(chunk.x * 8 + col, chunk.y * 8 + row, 4) - 0.5) * offsetRng;

                    let obj = new WorldObject(cellX, cellY, objDef.type, objDef.rotation);
                    chunk.objects.push(obj);
                }
            }
        }
    }


    loadPresetIntoChunk(chunk) {
        // Find presets for this biome
        let presets = Object.entries(ChunkPresets)
            .filter(([name, p]) => p.biome === chunk.biome)
            .map(([name, p]) => ({ name, ...p }));

        if (presets.length === 0) {
            presets = [{ name: 'clearing_empty', ...ChunkPresets.clearing_empty }];
        }

        // Get required edge openings based on neighbors
        let requiredEdges = this.getRequiredEdges(chunk.x, chunk.y);

        // Filter presets that have compatible edges
        let compatiblePresets = presets.filter(p => {
            let edges = this.analyzePresetEdges(p.grid);
            if (requiredEdges.N && !edges.N) return false;
            if (requiredEdges.S && !edges.S) return false;
            if (requiredEdges.E && !edges.E) return false;
            if (requiredEdges.W && !edges.W) return false;
            return true;
        });

        // Use compatible presets if available
        let finalPresets = compatiblePresets.length > 0 ? compatiblePresets : presets;

        // Get presets from loaded neighbors
        let nearbyPresets = this.getNearbyPresets(chunk.x, chunk.y, 3);

        // Predict presets within 20 chunks using seeded random (deterministic)
        // Check a sparse sample of positions to avoid O(n²) explosion
        let predictedNearby = [];
        const checkRadius = 20;
        const sampleStep = 3; // Check every 3rd chunk for performance

        for (let dy = -checkRadius; dy <= checkRadius; dy += sampleStep) {
            for (let dx = -checkRadius; dx <= checkRadius; dx += sampleStep) {
                if (dx === 0 && dy === 0) continue;
                let nx = chunk.x + dx;
                let ny = chunk.y + dy;

                let neighborBiome = this.getBiomeAt(nx, ny);
                if (neighborBiome === chunk.biome) {
                    // Predict what preset would be selected at this position
                    let neighborSalt = (nx * 7 + ny * 13) % 100;
                    let neighborIdx = Math.floor(this.seededRandom(nx, ny, 2 + neighborSalt) * finalPresets.length);
                    if (finalPresets.length > 0) {
                        predictedNearby.push(finalPresets[neighborIdx % finalPresets.length].name);
                    }
                }
            }
        }

        // Combine actual and predicted nearby presets
        let allNearby = [...new Set([...nearbyPresets, ...predictedNearby])];

        // Filter out presets used nearby
        // Only filter if we have enough alternatives (at least 2 remaining)
        let diversePresets = finalPresets.filter(p => !allNearby.includes(p.name));

        if (diversePresets.length < 2 && finalPresets.length >= 2) {
            // If aggressive filtering left us with almost nothing, relax it
            diversePresets = finalPresets;
        }

        // If we filtered too much, use frequency scoring
        if (diversePresets.length === 0) {
            let freqMap = {};
            allNearby.forEach(n => freqMap[n] = (freqMap[n] || 0) + 1);

            let scored = finalPresets.map(p => ({
                preset: p,
                score: freqMap[p.name] || 0
            }));
            scored.sort((a, b) => a.score - b.score);
            let minScore = scored[0].score;
            diversePresets = scored.filter(s => s.score === minScore).map(s => s.preset);
        }

        // Use coordinate-based offset for variety
        let salt = (chunk.x * 7 + chunk.y * 13) % 100;

        // Weighted random selection based on rarity
        let totalWeight = diversePresets.reduce((sum, p) => sum + (p.rarity ?? 1.0), 0);
        let roll = this.seededRandom(chunk.x, chunk.y, 2 + salt) * totalWeight;
        let cumulative = 0;
        let preset = diversePresets[0]; // fallback
        for (let p of diversePresets) {
            cumulative += (p.rarity ?? 1.0);
            if (roll < cumulative) {
                preset = p;
                break;
            }
        }
        chunk.preset = preset.name;

        // Cache this chunk's edges for neighbors to use
        chunk.edges = this.analyzePresetEdges(preset.grid);

        // Calculate world position of chunk (no offset - origin is 0,0)
        const size = Config.Chunks.size;
        let chunkWorldX = chunk.x * size;
        let chunkWorldY = chunk.y * size;

        // Parse grid and spawn objects
        for (let row = 0; row < preset.grid.length; row++) {
            let cells = preset.grid[row].split(' ');
            for (let col = 0; col < cells.length; col++) {
                let code = cells[col];
                let objDef = ObjectCodes[code];

                if (objDef) {
                    let cellX = chunkWorldX + (col + 0.5) * this.tileSize;
                    let cellY = chunkWorldY + (row + 0.5) * this.tileSize;

                    // Skip spawn area
                    if (Math.abs(cellX) < 80 && Math.abs(cellY) < 80) continue;

                    // Position randomization - more for natural objects, less for structures
                    let offsetMult = 0.1; // Default small offset
                    if (objDef.type === 'Rock' || objDef.type === 'Tree' || objDef.type === 'Barrel') {
                        offsetMult = 0.4; // Natural objects get larger random offset
                    } else if (objDef.type === 'Crate') {
                        offsetMult = 0.25; // Medium offset for crates
                    }
                    // Walls, Cliffs, Stairs stay at 0.1 for structured placement

                    let offsetRng = this.tileSize * offsetMult;
                    cellX += (this.seededRandom(chunk.x * 8 + col, chunk.y * 8 + row, 3) - 0.5) * offsetRng;
                    cellY += (this.seededRandom(chunk.x * 8 + col, chunk.y * 8 + row, 4) - 0.5) * offsetRng;

                    let obj = new WorldObject(cellX, cellY, objDef.type, objDef.rotation);
                    chunk.objects.push(obj);
                }
            }
        }
    }

    // Analyze a preset's grid to determine which edges have path openings
    analyzePresetEdges(grid) {
        // An edge has an "opening" if the middle 2 cells are empty
        // N = row 0, cols 3-4 | S = row 7, cols 3-4
        // W = col 0, rows 3-4 | E = col 7, rows 3-4

        let edges = { N: true, S: true, E: true, W: true };

        // Check North edge (row 0, cols 3-4)
        let row0 = grid[0].split(' ');
        if (row0[3] !== '..' || row0[4] !== '..') edges.N = false;

        // Check South edge (row 7, cols 3-4)
        let row7 = grid[7].split(' ');
        if (row7[3] !== '..' || row7[4] !== '..') edges.S = false;

        // Check West edge (col 0, rows 3-4)
        let row3 = grid[3].split(' ');
        let row4 = grid[4].split(' ');
        if (row3[0] !== '..' || row4[0] !== '..') edges.W = false;

        // Check East edge (col 7, rows 3-4)
        if (row3[7] !== '..' || row4[7] !== '..') edges.E = false;

        return edges;
    }

    // Get required edge openings based on already-loaded neighbors
    getRequiredEdges(cx, cy) {
        let required = { N: false, S: false, E: false, W: false };

        // Check North neighbor (cy - 1): if it has S opening, we need N opening
        let northChunk = this.chunks.get(this.getChunkKey(cx, cy - 1));
        if (northChunk && northChunk.edges && northChunk.edges.S) {
            required.N = true;
        }

        // Check South neighbor (cy + 1): if it has N opening, we need S opening
        let southChunk = this.chunks.get(this.getChunkKey(cx, cy + 1));
        if (southChunk && southChunk.edges && southChunk.edges.N) {
            required.S = true;
        }

        // Check West neighbor (cx - 1): if it has E opening, we need W opening
        let westChunk = this.chunks.get(this.getChunkKey(cx - 1, cy));
        if (westChunk && westChunk.edges && westChunk.edges.E) {
            required.W = true;
        }

        // Check East neighbor (cx + 1): if it has W opening, we need E opening
        let eastChunk = this.chunks.get(this.getChunkKey(cx + 1, cy));
        if (eastChunk && eastChunk.edges && eastChunk.edges.W) {
            required.E = true;
        }

        return required;
    }

    // Get presets used by nearby chunks to avoid repetition
    getNearbyPresets(cx, cy, radius) {
        let presets = [];
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                if (dx === 0 && dy === 0) continue;
                let chunk = this.chunks.get(this.getChunkKey(cx + dx, cy + dy));
                if (chunk && chunk.preset) {
                    presets.push(chunk.preset);
                }
            }
        }
        return presets;
    }

    unloadChunk(cx, cy) {
        let key = this.getChunkKey(cx, cy);
        let chunk = this.chunks.get(key);
        if (!chunk) return;

        // Remove objects from global array
        for (let obj of chunk.objects) {
            let idx = Game.objects.indexOf(obj);
            if (idx !== -1) Game.objects.splice(idx, 1);
        }

        this.chunks.delete(key);
    }

    update(playerPos) {
        let playerChunk = this.getChunkCoords(playerPos.x, playerPos.y);
        let loadRadius = Config.Chunks.loadRadius;
        let unloadRadius = Config.Chunks.unloadRadius;

        // Load nearby chunks
        for (let dy = -loadRadius; dy <= loadRadius; dy++) {
            for (let dx = -loadRadius; dx <= loadRadius; dx++) {
                this.loadChunk(playerChunk.x + dx, playerChunk.y + dy);
            }
        }

        // Unload distant chunks
        for (let [key, chunk] of this.chunks) {
            let dx = Math.abs(chunk.x - playerChunk.x);
            let dy = Math.abs(chunk.y - playerChunk.y);
            if (dx > unloadRadius || dy > unloadRadius) {
                this.unloadChunk(chunk.x, chunk.y);
            }
        }

        this.spatialHash.rebuild(Game.objects);
    }

    getNearbyObjects(x, y) {
        return this.spatialHash.getNearby(x, y, 2);
    }
}

// ============================================
// SPATIAL HASH
// ============================================
class SpatialHash {
    constructor(cellSize = 100) {
        this.cellSize = cellSize;
        this.cells = new Map();
    }

    clear() { this.cells.clear(); }

    getKey(x, y) {
        return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
    }

    insert(obj) {
        let key = this.getKey(obj.pos.x, obj.pos.y);
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(obj);
    }

    getNearby(x, y, radius = 1) {
        let results = [];
        let cx = Math.floor(x / this.cellSize);
        let cy = Math.floor(y / this.cellSize);

        for (let dx = -radius; dx <= radius; dx++) {
            for (let dy = -radius; dy <= radius; dy++) {
                let key = `${cx + dx},${cy + dy}`;
                if (this.cells.has(key)) results.push(...this.cells.get(key));
            }
        }
        return results;
    }

    rebuild(objects) {
        this.clear();
        for (let obj of objects) {
            if (!obj.dead) this.insert(obj);
        }
    }
}

// Global instance
let chunkManager = new ChunkManager();

// ============================================
// WORLD GENERATION
// ============================================
function generateMap() {
    Game.objects = [];
    chunkManager = new ChunkManager();
    chunkManager.init();
    chunkManager.update(new Vec2(0, 0));
    console.log(`World generated: ${Config.Chunks.gridWidth}x${Config.Chunks.gridHeight} grid`);
}

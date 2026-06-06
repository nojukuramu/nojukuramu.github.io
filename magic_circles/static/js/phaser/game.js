/**
 * Phaser 3 Game Configuration
 * A Certain RPG Game - Phaser.js Implementation
 */

// Game configuration
const gameConfig = {
    type: Phaser.AUTO, // WebGL with Canvas fallback
    parent: 'game-container',
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#111111',

    // Enable DOM element support for text inputs
    dom: {
        createContainer: true
    },

    // Physics configuration - using Matter.js for complex interactions
    physics: {
        default: 'matter',
        matter: {
            gravity: { x: 0, y: 0 }, // Top-down, no gravity
            debug: false,
            setBounds: false // Infinite world
        }
    },

    // Scene list
    scene: [BootScene, MenuScene, GameScene, MagicEditorScene],

    // Scaling
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },

    // Render settings
    render: {
        pixelArt: false,
        antialias: true
    }
};

// Global game instance
let game;

// Wait for DOM to be ready
window.addEventListener('load', () => {
    GameState.isMobile = typeof Platform !== 'undefined' && Platform.isMobile();
    if (GameState.isMobile) {
        // up to 5 simultaneous touches so claw-grip (two thumbs + two index
        // fingers) and pinch-zoom in the Spellforge all work at once
        gameConfig.input = { activePointers: 5 };
    }
    game = new Phaser.Game(gameConfig);
    window.game = game; // exposed for GameMenu (DOM) and other UI helpers

    // Handle window resize
    window.addEventListener('resize', () => {
        game.scale.resize(window.innerWidth, window.innerHeight);
    });
});

// Global game state (accessible from all scenes)
const GameState = {
    player: null,
    enemies: [],
    projectiles: [],
    particles: [],
    objects: [],

    // Mana and stats
    playerStats: {
        hp: 100,
        maxHp: 100,
        stm: 100,
        maxStm: 100,
        mana: {
            Air: 100,
            Fire: 100,
            Earth: 100,
            Water: 100
        }
    },

    // Game flags
    isMagicOpen: false,
    timeScale: 1.0,

    // Inventory system instance (set on GameScene create)
    inventorySystem: null,
    selectedSlot: 0,

    // Magic editor state
    magic: {
        layers: [],
        activeLayerId: -1,
        nodes: [],
        currPath: [],
        powerMultiplier: 1,
        snapToGrid: false,
        stability: 1 // 4-quadrant symmetry score, refreshed by the editor; read at cast time
    },

    getCurrentItem() {
        // Inventory is owned by inventorySystem (assigned on GameScene create);
        // GameState has no `inventory` array, so delegate and guard early calls.
        return this.inventorySystem ? this.inventorySystem.getCurrentItem() : null;
    }
};

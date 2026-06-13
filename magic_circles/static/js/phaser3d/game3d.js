/**
 * game3d.js — Enable3D 3D Bootstrap
 *
 * This is the entry point for the 3D parallel version of Magic Circles.
 * It bootstraps Phaser + Enable3D (THREE.js rendering), defines the global
 * coordinate contract (W3D), and declares the single global GameState.
 *
 * NOTE: This build does NOT load Ammo.js physics. Gameplay collisions are
 * handled entirely by the custom CollisionWorld (AABB/circle, O(n) per frame),
 * keeping the bundle lean and startup instant. Scene3D / accessThirdDimension
 * only require THREE, which Enable3D bundles.
 *
 * Load order: this file must be loaded LAST (after all scene files).
 */

// ---------------------------------------------------------------------------
// 1.  THREE alias
//     Make THREE available globally so every phaser3d file can reference it
//     without importing.  Enable3D bundles its own THREE copy; we expose it
//     as a var so it is accessible before any module system runs.
// ---------------------------------------------------------------------------
var THREE = (typeof ENABLE3D !== 'undefined') ? ENABLE3D.THREE : undefined;

// ---------------------------------------------------------------------------
// 2.  W3D — coordinate / height contract
//     Top-down 2D → 3D mapping: X stays X, 2D Y maps to 3D Z.
//     H constants are world-space Y values for layering objects vertically.
// ---------------------------------------------------------------------------
const W3D = {
    toX: function(x2d) { return x2d; },
    toZ: function(y2d) { return y2d; },
    fromZ: function(z3d) { return z3d; },
    H: {
        GROUND:       0,
        SHADOW:       0.02,
        PATH:         0.04,
        DECOR:        0.05,
        ENTITY_BASE:  0,
        PROJECTILE:   22,
        HPBAR_ENEMY:  58,
        PARTICLE_MIN: 4,
        PARTICLE_MAX: 40
    }
};

// ---------------------------------------------------------------------------
// 3.  GameState — single global state (mirrors 2D game.js GameState exactly,
//     with isMobile and lastSeed additions).  This file replaces game.js for
//     the 3D build; do NOT load the 2D game.js alongside this file.
// ---------------------------------------------------------------------------
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

    // Inventory system instance (set on GameScene3D create)
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

    // 3D-build additions
    isMobile: false,
    lastSeed: null,

    getCurrentItem() {
        // Inventory is owned by inventorySystem (assigned on GameScene3D create);
        // GameState has no `inventory` array, so delegate and guard early calls.
        return this.inventorySystem ? this.inventorySystem.getCurrentItem() : null;
    }
};

// ---------------------------------------------------------------------------
// 4.  Phaser + Enable3D bootstrap
// ---------------------------------------------------------------------------
const gameConfig3D = {
    type: Phaser.WEBGL,
    parent: 'game-container',
    transparent: true,
    width: window.innerWidth,
    height: window.innerHeight,

    // Enable DOM element support for text inputs (MagicEditorScene, WorldSettings)
    dom: {
        createContainer: true
    },

    // Scaling
    scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH
    },

    // Scene list — BootScene3D is first so it preloads assets before menu
    scene: [BootScene3D, MenuScene3D, GameScene3D, HUDScene3D, MagicEditorScene],

    // Enable3D canvas/renderer overrides (THREE WebGLRenderer backing Phaser)
    ...ENABLE3D.Canvas()
};

window.addEventListener('load', function () {
    // Detect mobile for multi-touch input
    GameState.isMobile = (typeof Platform !== 'undefined') && Platform.isMobile();
    if (GameState.isMobile) {
        // Up to 5 simultaneous touches so claw-grip (two thumbs + two index
        // fingers) and pinch-zoom in the Spellforge all work at once
        gameConfig3D.input = { activePointers: 5 };
    }

    // Bootstrap via Enable3D factory form (preferred — lets enable3d wire up
    // THREE renderer before Phaser Scene constructors run).
    const { enable3d } = ENABLE3D;
    enable3d(function () {
        window.game = new Phaser.Game(gameConfig3D);
        return window.game;
    });

    // R1 robustness fallback: if the enable3d() factory form did not construct
    // the game within 1200 ms (e.g. THREE already loaded, factory skipped),
    // construct it directly.  Scene3D / accessThirdDimension only needs THREE,
    // not Ammo, so this path is always safe.
    setTimeout(function () {
        if (!window.game) {
            window.game = new Phaser.Game(gameConfig3D);
        }
    }, 1200);

    // --- Robust viewport sizing -------------------------------------------
    // Keep the canvas resolution locked to the *true* visible viewport so the
    // game never gets squished/stretched.  visualViewport is the source of truth
    // on mobile (address-bar show/hide, pinch); innerWidth/Height are a fallback.
    // Rotations need a short delay before the new dimensions settle.
    function fitGame() {
        var vv = window.visualViewport;
        var w = Math.round((vv && vv.width) || window.innerWidth);
        var h = Math.round((vv && vv.height) || window.innerHeight);
        if (!w || !h) return;
        var c = document.getElementById('game-container');
        if (c) { c.style.width = w + 'px'; c.style.height = h + 'px'; }
        if (window.game && window.game.scale) { window.game.scale.resize(w, h); window.game.scale.refresh(); }
    }
    var _fitTimer = null;
    function scheduleFit(delay) {
        clearTimeout(_fitTimer);
        _fitTimer = setTimeout(fitGame, delay || 120);
    }
    window.addEventListener('resize', function () { scheduleFit(120); });
    window.addEventListener('orientationchange', function () { scheduleFit(350); });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', function () { scheduleFit(120); });
    }
    // A couple of settle passes after load (mobile Chrome resizes post-load)
    scheduleFit(60);
    setTimeout(fitGame, 500);
    window.fitGame = fitGame;
});

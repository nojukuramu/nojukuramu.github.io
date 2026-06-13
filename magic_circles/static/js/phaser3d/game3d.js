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

// Convert a silent black screen into a readable on-page message. Without this,
// a missing engine (CDN 404 / ad-blocker / offline) just throws into the void.
function showFatalOverlay(msg) {
    try {
        var ls = document.getElementById('loading-screen');
        if (ls) ls.remove();
        var d = document.createElement('div');
        d.id = 'fatal-overlay';
        d.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#15151f;color:#ffd0d0;'
            + 'font-family:monospace;font-size:14px;padding:24px;overflow:auto;white-space:pre-wrap;'
            + 'line-height:1.6;box-sizing:border-box';
        d.textContent = msg;
        document.body.appendChild(d);
    } catch (e) { /* nothing more we can do */ }
    console.error(msg);
}

window.addEventListener('load', function () {
    // --- Engine sanity checks (a real message instead of a black screen) ---
    if (typeof Phaser === 'undefined') {
        showFatalOverlay('Could not load Phaser from the CDN.\n\nCheck your network connection or ad-blocker, then reload.');
        return;
    }
    if (typeof ENABLE3D === 'undefined' || !ENABLE3D.Scene3D || !ENABLE3D.Canvas || !ENABLE3D.enable3d) {
        showFatalOverlay('Could not load the Enable3D extension from the CDN.\n\n'
            + 'The 3D build needs the global "ENABLE3D" (Scene3D / Canvas / enable3d) '
            + 'from @enable3d/phaser-extension 0.25.4.\n\n'
            + 'Check your network connection or ad-blocker, then reload.');
        return;
    }

    // Re-alias THREE now that ENABLE3D is guaranteed present.
    if (!THREE) { THREE = ENABLE3D.THREE; }

    // Detect mobile for multi-touch input.
    GameState.isMobile = (typeof Platform !== 'undefined') && Platform.isMobile();

    // Build the Phaser config here (not at top level) so ENABLE3D.Canvas() is
    // only evaluated after the guard above confirms Enable3D is present.
    var gameConfig3D = {
        type: Phaser.WEBGL,                 // 3D requires WebGL (no Canvas fallback)
        parent: 'game-container',
        transparent: true,                  // let the THREE render show through Phaser's 2D layer
        width: window.innerWidth,
        height: window.innerHeight,
        dom: { createContainer: true },     // text inputs (MagicEditorScene, WorldSettings)
        scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [BootScene3D, MenuScene3D, GameScene3D, MagicEditorScene]
    };
    // Merge Enable3D's canvas/renderer config (WebGLRenderer backing Phaser).
    var canvasCfg = ENABLE3D.Canvas();
    for (var k in canvasCfg) { if (Object.prototype.hasOwnProperty.call(canvasCfg, k)) gameConfig3D[k] = canvasCfg[k]; }
    if (GameState.isMobile) {
        // Up to 5 simultaneous touches so claw-grip and pinch-zoom all work.
        gameConfig3D.input = { activePointers: 5 };
    }

    // Bootstrap via the Enable3D factory form (wires the THREE renderer to Phaser).
    try {
        ENABLE3D.enable3d(function () {
            window.game = new Phaser.Game(gameConfig3D);
            return window.game;
        });
    } catch (err) {
        showFatalOverlay('Enable3D bootstrap failed:\n\n' + ((err && err.stack) || err));
        return;
    }

    // Fallback: if the factory form didn't construct the game shortly, do it
    // directly (Scene3D / accessThirdDimension needs only THREE, not Ammo).
    setTimeout(function () {
        if (!window.game) {
            try { window.game = new Phaser.Game(gameConfig3D); }
            catch (err) { showFatalOverlay('Phaser.Game construction failed:\n\n' + ((err && err.stack) || err)); }
        }
    }, 1500);

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

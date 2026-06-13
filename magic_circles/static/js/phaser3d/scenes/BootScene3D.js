/**
 * BootScene3D — Asset preloading and 3D texture initialisation
 *
 * Key: 'BootScene' (must match so MagicEditorScene / any 2D code that
 * references the scene by key string continues to work unchanged).
 *
 * The 3D build uses procedurally generated geometry and textures via
 * ModelFactory, so we only Phaser-load the minimal set of 2D assets
 * that the reused 2D subsystems (particles, MagicEditorScene) need.
 * Heavy sprite sheets are NOT loaded here.
 */
class BootScene3D extends Phaser.Scene {
    constructor() {
        super({ key: 'BootScene' });
        console.log('BootScene3D constructed');
    }

    preload() {
        console.log('BootScene3D preload starting');

        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // Loading text
        const loadingText = this.add.text(width / 2, height / 2 - 50, 'Loading...', {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#ffffff'
        }).setOrigin(0.5);

        // Progress bar background
        const progressBg = this.add.rectangle(width / 2, height / 2, 400, 30, 0x333333);

        // Progress bar fill
        const progressBar = this.add.rectangle(width / 2 - 195, height / 2, 0, 20, 0x00ff00);
        progressBar.setOrigin(0, 0.5);

        // Update progress bar
        this.load.on('progress', function (value) {
            progressBar.width = 390 * value;
        });

        this.load.on('complete', function () {
            loadingText.setText('Complete!');
        });

        // Asset base URL (Django static files or local dev fallback)
        const baseUrl = (typeof window.STATIC_URL !== 'undefined') ? window.STATIC_URL : 'static/';
        this.load.setPath(baseUrl + 'assets/');

        // Only load assets needed by reused 2D subsystems (particle effects,
        // MagicEditorScene).  3D models and biome textures are built procedurally
        // by ModelFactory / BiomeTextureGenerator at runtime.
        this.load.image('particle', 'particle.png');
    }

    create() {
        console.log('BootScene3D create starting');

        // Kick off 3D texture/material pre-bake (non-blocking).
        // ModelFactory caches CanvasTexture objects on THREE materials so the
        // first chunk renders without a stall.
        if (typeof ModelFactory !== 'undefined' && ModelFactory.initTextures) {
            ModelFactory.initTextures(ENABLE3D.THREE);
        }

        // BiomeTextureGenerator is defined in BiomeRenderer.js (shared with 2D).
        // The editor and ChunkManager3D use it for ground tile textures.
        if (typeof BiomeTextureGenerator !== 'undefined') {
            try {
                BiomeTextureGenerator.init(this);
            } catch (e) {
                console.warn('BiomeTextureGenerator.init failed:', e);
            }
        }

        // Proceed to main menu
        this.scene.start('MenuScene');
    }
}
console.log('BootScene3D loaded');

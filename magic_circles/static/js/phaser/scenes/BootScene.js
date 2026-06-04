/**
 * BootScene - Asset preloading and initialization
 */
class BootScene extends Phaser.Scene {
    constructor() {
        super({ key: 'BootScene' });
        console.log('BootScene constructed');
    }

    preload() {
        console.log('BootScene preload starting');
        // Create loading bar
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
        this.load.on('progress', (value) => {
            progressBar.width = 390 * value;
        });

        this.load.on('complete', () => {
            loadingText.setText('Complete!');
        });

        // Load assets
        // Use global static URL if correct, otherwise fallback
        const baseUrl = (typeof window.STATIC_URL !== 'undefined') ? window.STATIC_URL : '/static/';
        this.load.setPath(baseUrl + 'assets/');

        // Entities
        this.load.spritesheet('player', 'player_spritesheet.png', { frameWidth: 64, frameHeight: 64 });
        this.load.image('enemy', 'enemy.png');
        this.load.image('projectile_sharp', 'projectile_sharp.png');
        this.load.image('projectile_blunt', 'projectile_blunt.png');
        this.load.image('particle', 'particle.png');

        // World Objects
        this.load.image('tree', 'tree.png');
        this.load.image('rock', 'rock.png');
        this.load.image('wall_h', 'wall_h.png');
        this.load.image('wall_v', 'wall_v.png');
        this.load.image('wall', 'wall_h.png'); // Alias
        this.load.image('crate', 'crate.png');
        this.load.image('barrel', 'barrel.png');
        this.load.image('cliff', 'cliff.png');

        // Ground/Floor Textures
        this.load.image('plains_ground', 'plains_ground.png');
        this.load.image('forest_ground', 'forest_ground.png');
        this.load.image('stone_floor', 'stone_floor.png');
        this.load.image('wood_floor', 'wood_floor.png');
        this.load.image('lake_ground', 'lake_ground.png');
    }

    create() {
        console.log('BootScene create starting');
        // Create player animations
        this.anims.create({
            key: 'player-walk-down',
            frames: this.anims.generateFrameNumbers('player', { start: 0, end: 3 }),
            frameRate: 8,
            repeat: -1
        });
        this.anims.create({
            key: 'player-walk-left',
            frames: this.anims.generateFrameNumbers('player', { start: 4, end: 7 }),
            frameRate: 8,
            repeat: -1
        });
        this.anims.create({
            key: 'player-walk-right',
            frames: this.anims.generateFrameNumbers('player', { start: 8, end: 11 }),
            frameRate: 8,
            repeat: -1
        });
        this.anims.create({
            key: 'player-walk-up',
            frames: this.anims.generateFrameNumbers('player', { start: 12, end: 15 }),
            frameRate: 8,
            repeat: -1
        });

        // Initialize biome texture generator
        if (typeof BiomeTextureGenerator !== 'undefined') {
            BiomeTextureGenerator.init(this);
        } else {
            console.error('BiomeTextureGenerator is undefined!');
        }

        // Go to menu
        this.scene.start('MenuScene');
    }
}
console.log('BootScene loaded');

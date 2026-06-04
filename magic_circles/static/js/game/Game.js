/**
 * Game - Global game state
 */
const Game = {
    player: null,
    enemies: [],
    objects: [],
    projectiles: [],
    parts: [],
    timeScale: 1.0,
    isMagicOpen: false,
    inventory: [],
    selectedSlot: 0,

    assets: {},

    init() {
        this.loadAssets();
        this.player = new Player();
        this.enemies = [
            new Enemy(400, 0),
            new Enemy(-400, 300),
            new Enemy(0, -500)
        ];
        this.projectiles = [];
        this.parts = [];
    },

    loadAssets() {
        const load = (src) => {
            const img = new Image();
            img.src = src;
            return img;
        };

        // Use Flask-served static assets relative to the /rpg prefix
        this.assets = {
            player: load('static/assets/player_sprite.png'),
            enemy: load('static/assets/enemy_sprite.png'),
            ground: load('static/assets/ground_tile.png'),
            particle: load('static/assets/particle_texture.png')
        };
    },

    getCurrentItem() {
        return this.inventory[this.selectedSlot];
    }
};

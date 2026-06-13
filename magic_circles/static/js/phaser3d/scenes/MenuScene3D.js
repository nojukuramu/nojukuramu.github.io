/**
 * MenuScene3D - Main menu (3D Edition)
 *
 * Ported almost verbatim from phaser/scenes/MenuScene.js.
 * Only differences:
 *   - Class name: MenuScene3D
 *   - Subtitle text: '[3D EDITION]' instead of '[PHASER.JS EDITION]'
 *   - Scene start target remains 'GameScene' (GameScene3D registers with that key)
 */
class MenuScene3D extends Phaser.Scene {
    constructor() {
        super({ key: 'MenuScene' });
    }

    create() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // Hide inventory bar in menu
        const inventoryBar = document.getElementById('inventory-bar');
        if (inventoryBar) inventoryBar.style.display = 'none';

        // Background gradient effect
        const bg = this.add.graphics();
        bg.fillGradientStyle(0x1a1a2e, 0x1a1a2e, 0x16213e, 0x16213e, 1);
        bg.fillRect(0, 0, width, height);

        // Animated particles in background
        this.createBackgroundParticles();

        // Title
        const title = this.add.text(width / 2, height * 0.25, 'A CERTAIN RPG GAME', {
            fontFamily: 'Arial Black, Arial',
            fontSize: '48px',
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 6
        }).setOrigin(0.5);

        // Subtitle
        const subtitle = this.add.text(width / 2, height * 0.25 + 50, '[3D EDITION]', {
            fontFamily: 'Arial',
            fontSize: '20px',
            color: '#aaaaff',
            letterSpacing: 4
        }).setOrigin(0.5);

        // Create New World button
        const createWorldBtn = this.createButton(width / 2, height * 0.55, 'CREATE NEW WORLD', () => {
            this.showWorldSettings();
        });

        // How to Play button
        const htpBtn = this.createButton(width / 2, height * 0.55 + 70, 'HOW TO PLAY', () => {
            this.showHowToPlay();
        });

        // Fade in
        this.cameras.main.fadeIn(500);

        // Title animation
        this.tweens.add({
            targets: title,
            y: title.y - 10,
            duration: 2000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });

        // The menu UI is centre-anchored, so rebuild it at the new size when the
        // viewport changes — but never while a modal is open or we're leaving.
        this._leaving = false;
        this.scale.on('resize', this._onMenuResize, this);
        this.events.once('shutdown', () => this.scale.off('resize', this._onMenuResize, this));
    }

    _onMenuResize() {
        if (this._leaving) return;
        if ((this.worldSettingsElements && this.worldSettingsElements.length) ||
            (this.howToPlayElements && this.howToPlayElements.length)) return;
        this.scene.restart();
    }

    createButton(x, y, text, callback, minWidth = 200) {
        const btn = this.add.container(x, y);

        // Button text (create first to measure width)
        const btnText = this.add.text(0, 0, text, {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#ffffff'
        }).setOrigin(0.5);

        // Calculate button width based on text + padding
        const padding = 40;
        const btnWidth = Math.max(minWidth, btnText.width + padding);
        const btnHeight = 50;
        const halfWidth = btnWidth / 2;

        // Button background
        const bg = this.add.graphics();
        bg.fillStyle(0x333366, 1);
        bg.fillRoundedRect(-halfWidth, -25, btnWidth, btnHeight, 10);
        bg.lineStyle(2, 0x6666aa);
        bg.strokeRoundedRect(-halfWidth, -25, btnWidth, btnHeight, 10);

        btn.add([bg, btnText]);
        btn.setSize(btnWidth, btnHeight);
        btn.setInteractive({ useHandCursor: true });

        // Store dimensions for hover effects
        btn.btnWidth = btnWidth;
        btn.halfWidth = halfWidth;

        // Hover effects
        btn.on('pointerover', () => {
            bg.clear();
            bg.fillStyle(0x4444aa, 1);
            bg.fillRoundedRect(-btn.halfWidth, -25, btn.btnWidth, 50, 10);
            bg.lineStyle(2, 0x8888cc);
            bg.strokeRoundedRect(-btn.halfWidth, -25, btn.btnWidth, 50, 10);
            btn.setScale(1.05);
        });

        btn.on('pointerout', () => {
            bg.clear();
            bg.fillStyle(0x333366, 1);
            bg.fillRoundedRect(-btn.halfWidth, -25, btn.btnWidth, 50, 10);
            bg.lineStyle(2, 0x6666aa);
            bg.strokeRoundedRect(-btn.halfWidth, -25, btn.btnWidth, 50, 10);
            btn.setScale(1);
        });

        btn.on('pointerdown', callback);

        return btn;
    }

    createBackgroundParticles() {
        // Create floating particles
        for (let i = 0; i < 50; i++) {
            const x = Phaser.Math.Between(0, this.cameras.main.width);
            const y = Phaser.Math.Between(0, this.cameras.main.height);

            const particle = this.add.circle(x, y, Phaser.Math.Between(1, 3), 0x6666ff, 0.3);

            this.tweens.add({
                targets: particle,
                y: particle.y - Phaser.Math.Between(50, 200),
                alpha: 0,
                duration: Phaser.Math.Between(3000, 6000),
                repeat: -1,
                onRepeat: () => {
                    particle.x = Phaser.Math.Between(0, this.cameras.main.width);
                    particle.y = this.cameras.main.height + 20;
                    particle.alpha = 0.3;
                }
            });
        }
    }

    showHowToPlay() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // Track every object created for this overlay so cleanup removes exactly
        // these (the old cleanup destroyed all Text below a y-threshold, which could
        // delete unrelated menu UI such as the subtitle).
        this.howToPlayElements = [];

        // Overlay
        const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.8);
        overlay.setInteractive();
        this.howToPlayElements.push(overlay);

        // Content panel
        const panel = this.add.graphics();
        panel.fillStyle(0x222244, 1);
        panel.fillRoundedRect(width / 2 - 300, height / 2 - 250, 600, 500, 20);
        panel.lineStyle(3, 0x6666aa);
        panel.strokeRoundedRect(width / 2 - 300, height / 2 - 250, 600, 500, 20);
        this.howToPlayElements.push(panel);

        // Title
        const title = this.add.text(width / 2, height / 2 - 200, 'HOW TO PLAY', {
            fontFamily: 'Arial Black',
            fontSize: '32px',
            color: '#ffffff'
        }).setOrigin(0.5);
        this.howToPlayElements.push(title);

        // Instructions
        const instructions = [
            { key: 'WASD / Arrows', action: 'Move' },
            { key: 'SHIFT', action: 'Dash' },
            { key: 'LEFT CLICK', action: 'Cast Spell' },
            { key: 'M', action: 'Magic Editor' },
            { key: 'RIGHT CLICK', action: 'Remote Trigger' }
        ];

        let yPos = height / 2 - 120;
        instructions.forEach(inst => {
            this.howToPlayElements.push(this.add.text(width / 2 - 100, yPos, inst.key, {
                fontFamily: 'Arial',
                fontSize: '18px',
                color: '#aaaaff'
            }));
            this.howToPlayElements.push(this.add.text(width / 2 + 50, yPos, inst.action, {
                fontFamily: 'Arial',
                fontSize: '18px',
                color: '#ffffff'
            }));
            yPos += 35;
        });

        // Elements info
        yPos += 20;
        this.howToPlayElements.push(this.add.text(width / 2, yPos, 'ELEMENTS', {
            fontFamily: 'Arial Black',
            fontSize: '20px',
            color: '#ffffff'
        }).setOrigin(0.5));

        yPos += 35;
        const elements = [
            { sides: '3 (Triangle)', element: 'AIR', effect: 'Speed & Push', color: '#A0E0E0' },
            { sides: '4 (Square)', element: 'FIRE', effect: 'Damage & Burn', color: '#E06060' },
            { sides: '5 (Pentagon)', element: 'EARTH', effect: 'Impact & Force', color: '#80C060' },
            { sides: '6 (Hexagon)', element: 'WATER', effect: 'Slow & Control', color: '#4080E0' }
        ];

        elements.forEach(el => {
            this.howToPlayElements.push(this.add.text(width / 2 - 100, yPos, el.element, {
                fontFamily: 'Arial',
                fontSize: '16px',
                color: el.color
            }));
            this.howToPlayElements.push(this.add.text(width / 2 + 20, yPos, el.effect, {
                fontFamily: 'Arial',
                fontSize: '16px',
                color: '#cccccc'
            }));
            yPos += 28;
        });

        // Close button
        const closeBtn = this.createButton(width / 2, height / 2 + 200, 'BACK', () => {
            // Destroy exactly the objects created for this overlay, then the button
            this.howToPlayElements.forEach(obj => obj.destroy());
            this.howToPlayElements = [];
            closeBtn.destroy();
        });
    }

    showWorldSettings() {
        const width = this.cameras.main.width;
        const height = this.cameras.main.height;

        // Store references for cleanup
        this.worldSettingsElements = [];

        // Overlay
        const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.85);
        overlay.setInteractive();
        this.worldSettingsElements.push(overlay);

        // Content panel
        const panel = this.add.graphics();
        panel.fillStyle(0x1a1a2e, 1);
        panel.fillRoundedRect(width / 2 - 250, height / 2 - 200, 500, 400, 20);
        panel.lineStyle(3, 0x6666aa);
        panel.strokeRoundedRect(width / 2 - 250, height / 2 - 200, 500, 400, 20);
        this.worldSettingsElements.push(panel);

        // Title
        const title = this.add.text(width / 2, height / 2 - 160, 'WORLD SETTINGS', {
            fontFamily: 'Arial Black',
            fontSize: '28px',
            color: '#ffffff'
        }).setOrigin(0.5);
        this.worldSettingsElements.push(title);

        // Custom seed state
        this.useCustomSeed = false;
        this.customSeedValue = '';

        // === CUSTOM SEED CHECKBOX ROW ===
        const checkboxY = height / 2 - 90;

        // Checkbox (visual)
        const checkboxBg = this.add.graphics();
        checkboxBg.fillStyle(0x333355, 1);
        checkboxBg.fillRoundedRect(width / 2 - 180, checkboxY - 15, 30, 30, 5);
        checkboxBg.lineStyle(2, 0x6666aa);
        checkboxBg.strokeRoundedRect(width / 2 - 180, checkboxY - 15, 30, 30, 5);
        this.worldSettingsElements.push(checkboxBg);

        const checkmark = this.add.text(width / 2 - 165, checkboxY, '✓', {
            fontFamily: 'Arial',
            fontSize: '24px',
            color: '#00ff00'
        }).setOrigin(0.5).setVisible(false);
        this.worldSettingsElements.push(checkmark);

        // Checkbox label
        const seedLabel = this.add.text(width / 2 - 140, checkboxY, 'Use Custom Seed', {
            fontFamily: 'Arial',
            fontSize: '20px',
            color: '#aaaaff'
        }).setOrigin(0, 0.5);
        this.worldSettingsElements.push(seedLabel);

        // Checkbox hitbox (covers checkbox + label)
        const checkboxHit = this.add.rectangle(width / 2 - 80, checkboxY, 200, 40, 0x000000, 0);
        checkboxHit.setInteractive({ useHandCursor: true });
        this.worldSettingsElements.push(checkboxHit);

        // === SEED INPUT ===
        const seedInputY = height / 2 - 20;

        // Input label
        const inputLabel = this.add.text(width / 2, seedInputY - 35, 'Enter Seed:', {
            fontFamily: 'Arial',
            fontSize: '16px',
            color: '#888899'
        }).setOrigin(0.5).setVisible(false);
        this.worldSettingsElements.push(inputLabel);

        // Seed Input (HTML DOM Element for proper text input)
        const seedInput = document.createElement('input');
        seedInput.type = 'text';
        seedInput.placeholder = 'Enter seed (e.g., MyWorld123)';
        seedInput.style.cssText = `
            width: 350px;
            padding: 14px 20px;
            font-size: 18px;
            font-family: Arial, sans-serif;
            background: #222244;
            border: 2px solid #444466;
            border-radius: 10px;
            color: #666688;
            opacity: 0.4;
            outline: none;
            text-align: center;
            transition: all 0.3s ease;
        `;
        seedInput.disabled = true;
        seedInput.addEventListener('input', () => {
            this.customSeedValue = seedInput.value;
        });
        seedInput.addEventListener('focus', () => {
            if (!seedInput.disabled) {
                seedInput.style.borderColor = '#8888cc';
                seedInput.style.boxShadow = '0 0 10px rgba(102, 102, 170, 0.5)';
            }
        });
        seedInput.addEventListener('blur', () => {
            seedInput.style.borderColor = this.useCustomSeed ? '#6666aa' : '#444466';
            seedInput.style.boxShadow = 'none';
        });

        // Create Phaser DOM element
        const inputElement = this.add.dom(width / 2, seedInputY, seedInput);
        this.worldSettingsElements.push(inputElement);

        // Checkbox toggle handler
        checkboxHit.on('pointerdown', () => {
            this.useCustomSeed = !this.useCustomSeed;
            checkmark.setVisible(this.useCustomSeed);
            inputLabel.setVisible(this.useCustomSeed);

            if (this.useCustomSeed) {
                seedInput.style.opacity = '1';
                seedInput.style.color = '#ffffff';
                seedInput.style.borderColor = '#6666aa';
                seedInput.disabled = false;
                seedInput.focus();
            } else {
                seedInput.style.opacity = '0.4';
                seedInput.style.color = '#666688';
                seedInput.style.borderColor = '#444466';
                seedInput.disabled = true;
                seedInput.value = '';
                this.customSeedValue = '';
            }
        });

        // === BUTTONS ===
        // Start World Button
        const startBtn = this.createButton(width / 2, height / 2 + 80, 'START WORLD', () => {
            // Determine seed
            let seed;
            if (this.useCustomSeed && this.customSeedValue.trim() !== '') {
                seed = this.customSeedValue.trim();
            } else {
                // Generate random seed
                seed = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
            }

            // Cleanup
            this.cleanupWorldSettings();

            // Start game with seed (block resize-restart during the transition)
            this._leaving = true;
            this.cameras.main.fadeOut(500);
            this.time.delayedCall(500, () => {
                this.scene.start('GameScene', { seed: seed });
            });
        });
        this.worldSettingsElements.push(startBtn);

        // Back Button
        const backBtn = this.createButton(width / 2, height / 2 + 150, 'BACK', () => {
            this.cleanupWorldSettings();
        });
        this.worldSettingsElements.push(backBtn);
    }

    cleanupWorldSettings() {
        if (this.worldSettingsElements) {
            this.worldSettingsElements.forEach(el => {
                if (el && el.destroy) {
                    el.destroy();
                }
            });
            this.worldSettingsElements = [];
        }
    }
}

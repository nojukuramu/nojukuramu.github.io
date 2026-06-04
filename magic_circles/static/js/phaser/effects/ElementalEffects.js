/**
 * ElementalEffects - Status effect handlers for Phaser
 */
const ElementalEffects = {

    /**
     * Apply Fire effect (burn damage over time)
     */
    applyFire(target, power) {
        const burnDamage = Config.Effects.Fire.burnDamage + (power * 0.2);
        const burnDuration = Config.Effects.Fire.burnDuration + (power * 0.05);

        target.applyEffect('burn', {
            damage: burnDamage,
            duration: burnDuration
        });
    },

    /**
     * Apply Water effect (slow movement)
     */
    applyWater(target, power) {
        let slowAmount = Config.Effects.Water.slowAmount + (power * 0.02);
        if (slowAmount > 0.9) slowAmount = 0.9;

        const slowDuration = Config.Effects.Water.slowDuration + (power * 0.1);

        target.applyEffect('slow', {
            amount: slowAmount,
            duration: slowDuration
        });
    },

    /**
     * Apply Air effect (knockback force)
     */
    applyAir(target, direction, power) {
        const force = Config.Effects.Air.propelForce + (power * Config.Effects.Air.propelPowerScale);

        if (target.applyForce) {
            target.applyForce({
                x: direction.x * force * 0.0001,
                y: direction.y * force * 0.0001
            });
        }
    },

    /**
     * Apply Earth effect (push and contact damage)
     */
    applyEarth(target, direction, power, scene) {
        const pushForce = Config.Effects.Earth.pushForce;

        if (target.applyForce) {
            target.applyForce({
                x: direction.x * pushForce * 0.0001,
                y: direction.y * pushForce * 0.0001
            });
        }

        // Contact damage
        const damage = Config.Effects.Earth.pushDamage;
        if (target.takeDamage) {
            target.takeDamage(damage);
        }

        // Particles
        if (scene && scene.spawnParticles) {
            scene.spawnParticles(target.x, target.y, 0x80C060, 5);
        }
    },

    /**
     * Create visual burn effect on entity
     */
    createBurnVisual(scene, target) {
        const emitter = scene.add.particles(0, 0, 'particle', {
            speed: { min: 20, max: 50 },
            scale: { start: 0.4, end: 0 },
            alpha: { start: 0.8, end: 0 },
            lifespan: 300,
            tint: [0xff6600, 0xff3300, 0xffaa00],
            blendMode: 'ADD',
            follow: target,
            frequency: 100
        });

        return emitter;
    },

    /**
     * Create slow visual effect on entity
     */
    createSlowVisual(scene, target) {
        const emitter = scene.add.particles(0, 0, 'particle', {
            speed: { min: 10, max: 30 },
            scale: { start: 0.3, end: 0 },
            alpha: { start: 0.5, end: 0 },
            lifespan: 400,
            tint: 0x4080E0,
            blendMode: 'ADD',
            follow: target,
            frequency: 150
        });

        return emitter;
    },

    /**
     * Create explosion effect
     */
    createExplosion(scene, x, y, radius, color = 0xff6600) {
        // Shockwave ring
        const ring = scene.add.circle(x, y, 0, color, 0.5);
        ring.setStrokeStyle(4, color);
        ring.setDepth(50);

        scene.tweens.add({
            targets: ring,
            scaleX: radius / 10,
            scaleY: radius / 10,
            alpha: 0,
            duration: 300,
            ease: 'Power2',
            onComplete: () => ring.destroy()
        });

        // Central flash
        const flash = scene.add.circle(x, y, radius * 0.3, 0xffffff);
        flash.setDepth(51);
        flash.setBlendMode(Phaser.BlendModes.ADD);

        scene.tweens.add({
            targets: flash,
            alpha: 0,
            scale: 2,
            duration: 150,
            onComplete: () => flash.destroy()
        });

        // Particles
        if (scene.spawnParticles) {
            scene.spawnParticles(x, y, color, 20);
        }

        // Camera shake
        scene.cameras.main.shake(100, 0.005 * (radius / 50));
    },

    /**
     * Create water splash effect
     */
    createSplash(scene, x, y, radius) {
        // Ripples
        for (let i = 0; i < 3; i++) {
            const delay = i * 100;
            const ring = scene.add.circle(x, y, 0, 0x4080E0, 0);
            ring.setStrokeStyle(2, 0x4080E0);
            ring.setDepth(40);

            scene.time.delayedCall(delay, () => {
                scene.tweens.add({
                    targets: ring,
                    scaleX: (radius / 20) * (1 + i * 0.3),
                    scaleY: (radius / 20) * (1 + i * 0.3),
                    alpha: 0,
                    duration: 500,
                    ease: 'Power2',
                    onComplete: () => ring.destroy()
                });
            });
        }

        // Droplets
        for (let i = 0; i < 8; i++) {
            const angle = (i / 8) * Math.PI * 2;
            const dist = radius * 0.5 + Math.random() * radius * 0.5;
            const dropX = x + Math.cos(angle) * dist;
            const dropY = y + Math.sin(angle) * dist;

            const drop = scene.add.circle(x, y, 3, 0x6090E0);
            drop.setDepth(41);

            scene.tweens.add({
                targets: drop,
                x: dropX,
                y: dropY - 30,
                scale: 0,
                alpha: 0,
                duration: 400,
                ease: 'Power2',
                onComplete: () => drop.destroy()
            });
        }
    },

    /**
     * Create earth impact effect
     */
    createEarthImpact(scene, x, y, radius) {
        // Ground crack graphics
        const crack = scene.add.graphics();
        crack.setDepth(30);

        crack.lineStyle(3, 0x3a2a1a);

        // Draw cracks
        const crackCount = 5 + Math.floor(radius / 20);
        for (let i = 0; i < crackCount; i++) {
            const angle = (i / crackCount) * Math.PI * 2 + Math.random() * 0.3;
            const length = radius * 0.3 + Math.random() * radius * 0.4;

            crack.beginPath();
            crack.moveTo(x, y);

            let cx = x, cy = y;
            const segments = 3;
            for (let j = 0; j < segments; j++) {
                const segLen = length / segments;
                cx += Math.cos(angle + (Math.random() - 0.5) * 0.5) * segLen;
                cy += Math.sin(angle + (Math.random() - 0.5) * 0.5) * segLen;
                crack.lineTo(cx, cy);
            }

            crack.strokePath();
        }

        // Fade out
        scene.tweens.add({
            targets: crack,
            alpha: 0,
            duration: 1000,
            delay: 500,
            onComplete: () => crack.destroy()
        });

        // Dust particles
        for (let i = 0; i < 10; i++) {
            const dustX = x + (Math.random() - 0.5) * radius;
            const dustY = y + (Math.random() - 0.5) * radius;

            const dust = scene.add.circle(dustX, dustY, 4 + Math.random() * 4, 0x8a7a5a, 0.6);
            dust.setDepth(32);

            scene.tweens.add({
                targets: dust,
                y: dustY - 20 - Math.random() * 20,
                alpha: 0,
                scale: 0.5,
                duration: 400 + Math.random() * 200,
                onComplete: () => dust.destroy()
            });
        }

        // Camera shake
        scene.cameras.main.shake(150, 0.008);
    },

    /**
     * Create air burst effect
     */
    createAirBurst(scene, x, y, direction, power) {
        // Wind lines
        const lineCount = 8;
        for (let i = 0; i < lineCount; i++) {
            const offset = (i - lineCount / 2) * 10;
            const perpX = -direction.y * offset;
            const perpY = direction.x * offset;

            const line = scene.add.graphics();
            line.lineStyle(2, 0xA0E0E0, 0.8);
            line.lineBetween(
                x + perpX,
                y + perpY,
                x + perpX + direction.x * 50,
                y + perpY + direction.y * 50
            );
            line.setDepth(45);

            scene.tweens.add({
                targets: line,
                x: direction.x * power,
                y: direction.y * power,
                alpha: 0,
                duration: 200,
                onComplete: () => line.destroy()
            });
        }

        // Particles
        if (scene.spawnParticles) {
            scene.spawnParticles(x, y, 0xA0E0E0, 12);
        }
    }
};

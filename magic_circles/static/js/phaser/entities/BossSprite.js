/**
 * BossSprite — One boss per floor, with IDLE/AGGRO/ENRAGE/DEAD state machine.
 * Extends EnemySprite; attack patterns spawn ProjectileSprite with caster:this.
 */
class BossSprite extends EnemySprite {
    constructor(scene, x, y, bossConfig, floor, depthScale) {
        const scale = depthScale != null ? depthScale : 1;
        const arch  = {
            key:           bossConfig.key,
            texture:       'enemy',
            baseHp:        bossConfig.baseHp * scale,
            baseSpeed:     bossConfig.baseSpeed,
            mass:          bossConfig.mass,
            contactDamage: 20 * scale,
            ranged:        false,
            rangedConfig:  null
        };

        super(scene, x, y, arch);

        this.bossConfig = bossConfig;
        this.floor      = floor;

        // Override display size — boss is bigger
        this.setDisplaySize(96, 96);

        // State machine
        this.bossState  = 'IDLE';
        this._attackCooldown = 0;
        this._gimmickCooldown = 0;
        this._wanderTimer = 0;
        this._wanderTarget = { x, y };

        // Enrage state
        this.enrageThreshold = bossConfig.enrageThreshold || 0.30;

        // Boss-coloured HP bar tint
        this._bossHpLabel = scene.add.text(x, y - 50, `⬥ ${bossConfig.key}`, {
            fontFamily: 'Arial', fontSize: '14px', color: '#ff4444',
            stroke: '#000000', strokeThickness: 3
        }).setOrigin(0.5).setDepth(105);
    }

    /* ─── State control ─── */

    forceAggro() {
        if (this.bossState !== 'DEAD') this.bossState = 'AGGRO';
    }

    /* ─── Update ─── */

    update(time, delta, playerPos) {
        if (this.isDead) return;
        if (this.bossState === 'DEAD') return;

        const dt = delta / 1000;

        // NaN guard
        if (this.body) {
            const v = this.body.velocity;
            if (!Number.isFinite(this.x) || !Number.isFinite(this.y) ||
                !Number.isFinite(v.x)    || !Number.isFinite(v.y)) {
                this.setVelocity(0, 0);
                return;
            }
        }

        this.updateEffects(dt);

        // Check enrage transition
        if (this.bossState === 'AGGRO' && this.hp / this.maxHp < this.enrageThreshold) {
            this.bossState = 'ENRAGE';
            if (this.scene && this.scene.cameras) {
                this.scene.cameras.main.shake(300, 0.012);
            }
        }

        // Check for aggro radius
        if (this.bossState === 'IDLE' && playerPos) {
            const dx = playerPos.x - this.x;
            const dy = playerPos.y - this.y;
            if (dx * dx + dy * dy < this.bossConfig.aggroRadius ** 2) {
                this.bossState = 'AGGRO';
            }
        }

        // State behaviour
        switch (this.bossState) {
            case 'IDLE':    this._doIdle(dt); break;
            case 'AGGRO':   this._doAggro(dt, playerPos); break;
            case 'ENRAGE':  this._doEnrage(dt, playerPos); break;
        }

        this._gimmickCooldown -= dt;
        if (this._gimmickCooldown <= 0 && this.bossState !== 'IDLE') {
            this._doGimmick(playerPos);
            this._gimmickCooldown = 8 + Math.random() * 6; // 8–14 s
        }

        // Update HP bar label position
        if (this._bossHpLabel) {
            this._bossHpLabel.setPosition(this.x, this.y - 55);
        }

        this.updateHpBar();
        if (this.shadow) this.shadow.setPosition(this.x, this.y + 18);

        if (this.hp <= 0) this.die();
    }

    _doIdle(dt) {
        // Slow wander
        this._wanderTimer -= dt;
        if (this._wanderTimer <= 0) {
            this._wanderTimer = 2 + Math.random() * 3;
            const angle = Math.random() * Math.PI * 2;
            const r     = 80 + Math.random() * 120;
            this._wanderTarget = {
                x: this.x + Math.cos(angle) * r,
                y: this.y + Math.sin(angle) * r
            };
        }
        this._moveToward(this._wanderTarget, this.baseSpeed * 0.35);
    }

    _doAggro(dt, playerPos) {
        if (playerPos) this._moveToward(playerPos, this.baseSpeed);
        this._tryAttack(dt, playerPos);
    }

    _doEnrage(dt, playerPos) {
        if (playerPos) this._moveToward(playerPos, this.baseSpeed * 1.6);
        this._tryAttack(dt, playerPos); // 2× faster via 0.5× cooldown set in _tryAttack
    }

    _moveToward(target, speed) {
        if (!target || !this.body) return;
        const dx   = target.x - this.x;
        const dy   = target.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 20) return;

        const dirX = dx / dist;
        const dirY = dy / dist;
        this.applyForce({ x: dirX * this.moveForce * GameState.timeScale, y: dirY * this.moveForce * GameState.timeScale });

        const maxSpd = speed * this.getSpeedMultiplier() * 0.005;
        const vel    = this.body.velocity;
        const spd    = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
        if (spd > maxSpd) {
            this.setVelocity(vel.x * (maxSpd / spd), vel.y * (maxSpd / spd));
        }
    }

    _tryAttack(dt, playerPos) {
        this._attackCooldown -= dt;
        if (this._attackCooldown > 0 || !playerPos) return;

        const atk = this.bossConfig.attack;
        this._attackCooldown = this.bossState === 'ENRAGE'
            ? atk.cooldown * 0.5   // 2× faster in enrage
            : atk.cooldown;

        const dx  = playerPos.x - this.x;
        const dy  = playerPos.y - this.y;
        const mag = Math.sqrt(dx * dx + dy * dy) || 1;
        const pc  = atk.projectile;
        const spd = pc.speed || 320;

        // Small spread in ENRAGE
        const spread = this.bossState === 'ENRAGE' ? 0.25 : 0;
        const angle  = Math.atan2(dy, dx) + (Math.random() - 0.5) * spread;

        const ox = this.x + Math.cos(angle) * 60;
        const oy = this.y + Math.sin(angle) * 60;

        if (!Number.isFinite(ox) || !Number.isFinite(oy)) return;

        try {
            new ProjectileSprite(this.scene, ox, oy, {
                elements:  ['Fire'],
                spectrum:  'DART',
                physics:   'BLUNT',
                damage:    pc.damage || 20,
                radius:    pc.radius || 16,
                vel:       { x: Math.cos(angle) * spd, y: Math.sin(angle) * spd },
                power:     pc.power  || 80,
                caster:    this,
                payload:   null
            });
        } catch (e) {
            console.warn('BossSprite attack failed:', e);
        }
    }

    /* ─── Gimmicks ─── */

    _doGimmick(playerPos) {
        const gimmick = this.bossConfig.gimmick;
        switch (gimmick) {
            case 'selfHeal':      this._gimmickSelfHeal();          break;
            case 'groundBurn':    this._gimmickGroundBurn(playerPos); break;
            case 'teleportGate':  this._gimmickTeleportGate();      break;
            case 'nullifyCast':   this._gimmickNullifyCast();        break;
        }
    }

    _gimmickSelfHeal() {
        const healAmt = this.maxHp * 0.06;
        this.hp = Math.min(this.maxHp, this.hp + healAmt);
        if (this.scene && this.scene.spawnParticles) {
            this.scene.spawnParticles(this.x, this.y, 0x44ff88, 10);
        }
    }

    _gimmickGroundBurn(playerPos) {
        if (!playerPos || !this.scene) return;
        // Spawn burn zone particles at player location
        this.scene.spawnParticles(playerPos.x, playerPos.y, 0xff4400, 20);
        // Apply delayed burn projectile as a slow AoE marker
        try {
            new ProjectileSprite(this.scene, playerPos.x, playerPos.y, {
                elements:  ['Fire'],
                spectrum:  'NOVA',
                physics:   'BLUNT',
                damage:    8,
                radius:    40,
                vel:       { x: 0, y: 0 },
                power:     30,
                caster:    this,
                payload:   null
            });
        } catch (e) {}
    }

    _gimmickTeleportGate() {
        if (!this.scene || !this.scene.floorManager) return;
        const gate = this.scene.floorManager.gate;
        if (!gate || !Number.isFinite(gate.x)) return;
        const ox = gate.x + (Math.random() - 0.5) * 120;
        const oy = gate.y + 80 + Math.random() * 60;
        this.setPosition(ox, oy);
        this.setVelocity(0, 0);
        if (this.scene.spawnParticles) this.scene.spawnParticles(this.x, this.y, 0x4444ff, 12);
    }

    _gimmickNullifyCast() {
        // Sets a GameState flag; castSpell() in GameScene checks it
        GameState.bossNullifyCast = true;
        if (this.scene && this.scene.spawnParticles) {
            this.scene.spawnParticles(this.x, this.y, 0xaa44ff, 15);
        }
    }

    /* ─── Death ─── */

    die() {
        if (this.isDead) return;
        this.bossState = 'DEAD';

        // Nullify-cast gimmick flag must not linger after the boss is gone
        GameState.bossNullifyCast = false;

        if (this._bossHpLabel) {
            try { this._bossHpLabel.destroy(); } catch(e) {}
            this._bossHpLabel = null;
        }

        super.die(); // handles particles + array splice + floor.cleared
    }

    destroy() {
        if (this._bossHpLabel) {
            try { this._bossHpLabel.destroy(); } catch(e) {}
            this._bossHpLabel = null;
        }
        super.destroy();
    }
}

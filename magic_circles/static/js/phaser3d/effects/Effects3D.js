/**
 * Effects3D - Pooled 3D particle/effect system for the Phaser+Enable3D game.
 * Relies on the global THREE (aliased from ENABLE3D.THREE at runtime).
 * Plain global-script style — no modules/exports.
 *
 * World units: 1 unit = 1px. Y-up; gameplay on XZ plane (y=0 ground).
 */

class Effects3D {
    constructor(scene) {
        // scene = GameScene3D
        this.scene = scene;
        this.third = scene.third;

        this.group = new THREE.Group();
        this.third.scene.add(this.group);

        // ---- Particle pool (burst / trail) ----
        this._PARTICLE_COUNT = 200;
        this._particlePool = [];
        this._particleIndex = 0;

        const sphereGeo = new THREE.SphereGeometry(2.5, 6, 4);

        for (let i = 0; i < this._PARTICLE_COUNT; i++) {
            const mat = new THREE.MeshBasicMaterial({
                transparent: true,
                opacity: 1,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            });
            const mesh = new THREE.Mesh(sphereGeo, mat);
            mesh.visible = false;
            mesh.userData.vx = 0;
            mesh.userData.vz = 0;
            mesh.userData.vy = 0;
            mesh.userData.life = 0;
            mesh.userData.maxLife = 1;
            mesh.userData._alive = false;
            mesh.userData._isDebris = false;
            this.group.add(mesh);
            this._particlePool.push(mesh);
        }

        // ---- Shockwave ring pool ----
        this._SHOCKWAVE_COUNT = 30;
        this._shockwavePool = [];
        this._shockwaveIndex = 0;
        this._activeShockwaves = [];

        const ringGeo = new THREE.RingGeometry(1, 1.6, 24);

        for (let i = 0; i < this._SHOCKWAVE_COUNT; i++) {
            const mat = new THREE.MeshBasicMaterial({
                transparent: true,
                opacity: 0.8,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(ringGeo, mat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.visible = false;
            mesh.userData._alive = false;
            mesh.userData.life = 0;
            mesh.userData.maxLife = 0.35;
            mesh.userData.targetRadius = 1;
            this.group.add(mesh);
            this._shockwavePool.push(mesh);
        }

        // ---- Debris cube pool ----
        this._DEBRIS_COUNT = 30;
        this._debrisPool = [];
        this._debrisIndex = 0;

        const boxGeo = new THREE.BoxGeometry(4, 4, 4);

        for (let i = 0; i < this._DEBRIS_COUNT; i++) {
            const mat = new THREE.MeshBasicMaterial({
                transparent: true,
                opacity: 1,
                depthWrite: false
            });
            const mesh = new THREE.Mesh(boxGeo, mat);
            mesh.visible = false;
            mesh.userData.vx = 0;
            mesh.userData.vz = 0;
            mesh.userData.vy = 0;
            mesh.userData.life = 0;
            mesh.userData.maxLife = 0.9;
            mesh.userData._alive = false;
            mesh.userData._isDebris = true;
            mesh.userData.spinX = 0;
            mesh.userData.spinZ = 0;
            this.group.add(mesh);
            this._debrisPool.push(mesh);
        }
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    /** Get next free particle from the particle pool (ring-buffer; reuses oldest). */
    _acquire() {
        // Search forward from current index for a dead slot
        const len = this._PARTICLE_COUNT;
        for (let i = 0; i < len; i++) {
            const idx = (this._particleIndex + i) % len;
            if (!this._particlePool[idx].userData._alive) {
                this._particleIndex = (idx + 1) % len;
                return this._particlePool[idx];
            }
        }
        // All slots alive — forcibly reclaim the oldest (next in ring)
        const mesh = this._particlePool[this._particleIndex];
        this._particleIndex = (this._particleIndex + 1) % len;
        return mesh;
    }

    _acquireShockwave() {
        const len = this._SHOCKWAVE_COUNT;
        for (let i = 0; i < len; i++) {
            const idx = (this._shockwaveIndex + i) % len;
            if (!this._shockwavePool[idx].userData._alive) {
                this._shockwaveIndex = (idx + 1) % len;
                return this._shockwavePool[idx];
            }
        }
        const mesh = this._shockwavePool[this._shockwaveIndex];
        // Remove from active list if forcibly reclaiming
        const ai = this._activeShockwaves.indexOf(mesh);
        if (ai !== -1) this._activeShockwaves.splice(ai, 1);
        this._shockwaveIndex = (this._shockwaveIndex + 1) % len;
        return mesh;
    }

    _acquireDebris() {
        const len = this._DEBRIS_COUNT;
        for (let i = 0; i < len; i++) {
            const idx = (this._debrisIndex + i) % len;
            if (!this._debrisPool[idx].userData._alive) {
                this._debrisIndex = (idx + 1) % len;
                return this._debrisPool[idx];
            }
        }
        const mesh = this._debrisPool[this._debrisIndex];
        this._debrisIndex = (this._debrisIndex + 1) % len;
        return mesh;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /**
     * Spawn `count` burst particles at world position (x, ?, z).
     * @param {number} x
     * @param {number} z
     * @param {number|THREE.Color} color  hex integer e.g. 0xFF6633
     * @param {number} [count=5]
     */
    burst(x, z, color, count) {
        if (count === undefined) count = 5;

        for (let i = 0; i < count; i++) {
            const mesh = this._acquire();
            const ud = mesh.userData;

            const angle = Math.random() * Math.PI * 2;
            const speed = 60 + Math.random() * 160; // 60-220 px/s
            ud.vx = Math.cos(angle) * speed;
            ud.vz = Math.sin(angle) * speed;
            ud.vy = 20 + Math.random() * 60;        // 20-80 upward
            const life = 0.4 + Math.random() * 0.4; // 0.4-0.8 s
            ud.life = life;
            ud.maxLife = life;
            ud._alive = true;
            ud._isDebris = false;

            const yStart = 4 + Math.random() * 36;  // 4-40
            mesh.position.set(x, yStart, z);
            mesh.material.color.set(color);
            mesh.material.opacity = 1;
            mesh.visible = true;
        }
    }

    /**
     * Spawn a single trail particle — called frequently by projectiles.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number|THREE.Color} color
     */
    trail(x, y, z, color) {
        const mesh = this._acquire();
        const ud = mesh.userData;

        ud.vx = 0;
        ud.vz = 0;
        ud.vy = 15 + Math.random() * 25; // slight upward drift
        ud.life = 0.25;
        ud.maxLife = 0.25;
        ud._alive = true;
        ud._isDebris = false;

        mesh.position.set(x, y, z);
        mesh.material.color.set(color);
        mesh.material.opacity = 1;
        mesh.visible = true;
    }

    /**
     * Spawn an expanding shockwave ring at ground level.
     * @param {number} x
     * @param {number} z
     * @param {number} radius  final scale factor
     * @param {number|THREE.Color} color
     */
    shockwave(x, z, radius, color) {
        const mesh = this._acquireShockwave();
        const ud = mesh.userData;

        ud.life = 0.35;
        ud.maxLife = 0.35;
        ud.targetRadius = radius * 1.5;
        ud._alive = true;

        mesh.position.set(x, 0.1, z);
        mesh.scale.set(1, 1, 1);
        mesh.material.color.set(color);
        mesh.material.opacity = 0.8;
        mesh.visible = true;

        this._activeShockwaves.push(mesh);
    }

    /**
     * Spawn debris cubes at (x, 6, z) with gravity.
     * @param {number} x
     * @param {number} z
     * @param {number|THREE.Color} color
     * @param {number} [count=8]
     */
    debris(x, z, color, count) {
        if (count === undefined) count = 8;

        for (let i = 0; i < count; i++) {
            const mesh = this._acquireDebris();
            const ud = mesh.userData;

            const angle = Math.random() * Math.PI * 2;
            const speed = 80 + Math.random() * 100; // 80-180
            ud.vx = Math.cos(angle) * speed;
            ud.vz = Math.sin(angle) * speed;
            ud.vy = 80 + Math.random() * 80;        // 80-160 upward
            ud.life = 0.9;
            ud.maxLife = 0.9;
            ud._alive = true;
            ud._isDebris = true;
            // Optional spin rates (radians/s)
            ud.spinX = (Math.random() - 0.5) * 6;
            ud.spinZ = (Math.random() - 0.5) * 6;

            mesh.position.set(x, 6, z);
            mesh.rotation.set(0, 0, 0);
            mesh.material.color.set(color);
            mesh.material.opacity = 1;
            mesh.visible = true;
        }
    }

    /**
     * Per-frame integration. Call from scene's update(time, delta).
     * @param {number} dt  delta time in SECONDS
     */
    update(dt) {
        // ---- Burst / trail particles ----
        for (let i = 0; i < this._PARTICLE_COUNT; i++) {
            const mesh = this._particlePool[i];
            const ud = mesh.userData;
            if (!ud._alive) continue;

            ud.life -= dt;
            if (ud.life <= 0) {
                ud._alive = false;
                mesh.visible = false;
                continue;
            }

            // Integrate position
            mesh.position.x += ud.vx * dt;
            mesh.position.y += ud.vy * dt;
            mesh.position.z += ud.vz * dt;

            // Fade by remaining life fraction
            mesh.material.opacity = ud.life / ud.maxLife;
        }

        // ---- Debris cubes ----
        for (let i = 0; i < this._DEBRIS_COUNT; i++) {
            const mesh = this._debrisPool[i];
            const ud = mesh.userData;
            if (!ud._alive) continue;

            ud.life -= dt;
            if (ud.life <= 0) {
                ud._alive = false;
                mesh.visible = false;
                continue;
            }

            // Visual gravity
            ud.vy -= 400 * dt;

            mesh.position.x += ud.vx * dt;
            mesh.position.y += ud.vy * dt;
            mesh.position.z += ud.vz * dt;

            // Spin
            mesh.rotation.x += ud.spinX * dt;
            mesh.rotation.z += ud.spinZ * dt;

            mesh.material.opacity = ud.life / ud.maxLife;
        }

        // ---- Shockwave rings ----
        for (let i = this._activeShockwaves.length - 1; i >= 0; i--) {
            const mesh = this._activeShockwaves[i];
            const ud = mesh.userData;

            ud.life -= dt;
            if (ud.life <= 0) {
                ud._alive = false;
                mesh.visible = false;
                this._activeShockwaves.splice(i, 1);
                continue;
            }

            const t = 1 - ud.life / ud.maxLife; // 0 -> 1 over lifetime
            const s = 1 + (ud.targetRadius - 1) * t;
            mesh.scale.set(s, s, s);
            mesh.material.opacity = 0.8 * (1 - t);
        }
    }

    /**
     * Hide all active effects and reset pools. Call on scene shutdown.
     */
    clear() {
        for (let i = 0; i < this._PARTICLE_COUNT; i++) {
            const mesh = this._particlePool[i];
            mesh.visible = false;
            mesh.userData._alive = false;
        }
        for (let i = 0; i < this._SHOCKWAVE_COUNT; i++) {
            const mesh = this._shockwavePool[i];
            mesh.visible = false;
            mesh.userData._alive = false;
        }
        for (let i = 0; i < this._DEBRIS_COUNT; i++) {
            const mesh = this._debrisPool[i];
            mesh.visible = false;
            mesh.userData._alive = false;
        }
        this._activeShockwaves.length = 0;
        this._particleIndex = 0;
        this._shockwaveIndex = 0;
        this._debrisIndex = 0;
    }
}

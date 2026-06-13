/**
 * CollisionWorld - Custom 2D circle-physics engine on the XZ plane.
 *
 * Gravity-free top-down physics for a 3D game. Bodies live on the XZ plane;
 * Y is up and is managed by the game engine separately.
 *
 * Features:
 *  - Uniform spatial hash broadphase (configurable cell size, default 160)
 *  - Semi-implicit Euler integration with per-body exponential damping
 *  - Position-correction + impulse narrowphase (2 solver iterations)
 *  - Sensor-only bodies (overlap events, no resolution)
 *  - Bitmask collision filtering (category / collidesWith)
 *  - onCollide / onOverlap callback system with label-pair matching
 *  - Safe mid-step removeBody / createBody
 *  - No external dependencies, no Math.random, deterministic
 *
 * Usage: loaded as a plain <script> tag; CollisionWorld is a global class.
 */
class CollisionWorld {

    // -------------------------------------------------------------------------
    // Static category bitmask constants
    // -------------------------------------------------------------------------
    static CAT_PLAYER     = 1;
    static CAT_ENEMY      = 2;
    static CAT_PROJECTILE = 4;
    static CAT_OBJECT     = 8;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /**
     * @param {object} opts
     * @param {number} [opts.cellSize=160]  Spatial-hash cell size in world units.
     */
    constructor(opts = {}) {
        /** @type {number} */
        this.cellSize = (opts && opts.cellSize != null) ? opts.cellSize : 160;

        /** Master ordered array of all active bodies (ordered by id for determinism). */
        this.bodies = [];

        /** Spatial hash: Map<string, body[]> */
        this._cells = new Map();

        /** Monotonically increasing id counter. */
        this._nextId = 1;

        /** Whether step() is currently executing (guards safe removals). */
        this._stepping = false;

        /** Bodies to remove at the end of the current step(). */
        this._pendingRemovals = new Set();

        /**
         * Overlap handlers: Map<'labelA|labelB', fn(bodyA, bodyB)>
         * Registered via onOverlap().
         */
        this._overlapHandlers = new Map();

        /**
         * Collision (resolved contact) handlers: Map<'labelA|labelB', fn(bodyA, bodyB)>
         * Registered via onCollide().
         */
        this._collideHandlers = new Map();
    }

    // -------------------------------------------------------------------------
    // Body creation / removal
    // -------------------------------------------------------------------------

    /**
     * Create a new physics body and add it to the world.
     *
     * @param {object} opts
     * @param {number}  opts.x
     * @param {number}  opts.z
     * @param {number}  opts.radius
     * @param {number}  [opts.mass=1]            Infinity makes body immovable.
     * @param {boolean} [opts.isStatic=false]
     * @param {boolean} [opts.isSensor=false]    Overlap-only; never resolved.
     * @param {boolean} [opts.immortal=false]    Metadata passthrough.
     * @param {string}  [opts.label='']
     * @param {*}       [opts.owner]             Back-reference to owning game object.
     * @param {number}  [opts.damping=0]         Per-second exponential velocity damping.
     * @param {number}  [opts.vx=0]
     * @param {number}  [opts.vz=0]
     * @param {number}  [opts.category=CAT_OBJECT]
     * @param {number}  [opts.collidesWith=CAT_PLAYER|CAT_ENEMY|CAT_PROJECTILE|CAT_OBJECT]
     * @returns {object} body
     */
    createBody(opts) {
        const isStatic = opts.isStatic === true;
        const mass     = (opts.mass != null) ? opts.mass : 1;
        const invMass  = (isStatic || mass === Infinity) ? 0 : 1 / mass;

        const body = {
            id:           this._nextId++,
            x:            opts.x,
            z:            opts.z,
            vx:           (opts.vx != null) ? opts.vx : 0,
            vz:           (opts.vz != null) ? opts.vz : 0,
            radius:       opts.radius,
            mass:         mass,
            invMass:      invMass,
            isStatic:     isStatic,
            isSensor:     opts.isSensor  === true,
            immortal:     opts.immortal  === true,
            label:        (opts.label != null) ? opts.label : '',
            owner:        (opts.owner  != null) ? opts.owner  : null,
            damping:      (opts.damping != null) ? opts.damping : 0,
            category:     (opts.category     != null) ? opts.category     : CollisionWorld.CAT_OBJECT,
            collidesWith: (opts.collidesWith != null) ? opts.collidesWith
                : (CollisionWorld.CAT_PLAYER | CollisionWorld.CAT_ENEMY |
                   CollisionWorld.CAT_PROJECTILE | CollisionWorld.CAT_OBJECT),
            _cells:       [],   // spatial-hash bookkeeping
            _removed:     false // internal removal flag
        };

        this.bodies.push(body);
        this._rehash(body);
        return body;
    }

    /**
     * Remove a body from the world.
     *
     * Safe to call from within step() callbacks — the body is flagged and
     * deferred to end-of-step cleanup. Outside of step() it is removed
     * immediately.
     *
     * @param {object} body
     */
    removeBody(body) {
        if (!body || body._removed) return;

        body._removed = true;

        if (this._stepping) {
            // Defer actual removal; _stepping guards immediate array/hash mutation.
            this._pendingRemovals.add(body);
        } else {
            this._doRemoveBody(body);
        }
    }

    /**
     * Perform the actual removal from data structures.
     * @private
     */
    _doRemoveBody(body) {
        this._removeFromCells(body);
        const idx = this.bodies.indexOf(body);
        if (idx !== -1) this.bodies.splice(idx, 1);
    }

    // -------------------------------------------------------------------------
    // Velocity helpers
    // -------------------------------------------------------------------------

    /**
     * Directly set a body's velocity.
     * @param {object} body
     * @param {number} vx
     * @param {number} vz
     */
    setVelocity(body, vx, vz) {
        body.vx = vx;
        body.vz = vz;
    }

    /**
     * Apply a linear impulse to a body (scaled by invMass so static bodies ignore it).
     * @param {object} body
     * @param {number} ix  X component of impulse.
     * @param {number} iz  Z component of impulse.
     */
    applyImpulse(body, ix, iz) {
        if (body.invMass === 0) return;
        body.vx += ix * body.invMass;
        body.vz += iz * body.invMass;
    }

    /**
     * Instantly move a body to (x, z) and update its hash position.
     * @param {object} body
     * @param {number} x
     * @param {number} z
     */
    teleport(body, x, z) {
        body.x = x;
        body.z = z;
        this._rehash(body);
    }

    // -------------------------------------------------------------------------
    // Main simulation step
    // -------------------------------------------------------------------------

    /**
     * Advance the simulation by dt seconds.
     *
     * Order: integrate → rehash → solve (2 iters) → fire callbacks → flush removals.
     *
     * @param {number} dt  Delta time in seconds.
     */
    step(dt) {
        // Clamp dt and bail out early when non-positive.
        dt = Math.min(dt, 1 / 30);
        if (dt <= 0) return;

        this._stepping = true;

        // ---- 1. Integration ------------------------------------------------
        for (let i = 0; i < this.bodies.length; i++) {
            const b = this.bodies[i];
            if (b._removed || b.isStatic) continue;

            // Exponential velocity damping
            if (b.damping > 0) {
                const f = Math.exp(-b.damping * dt);
                b.vx *= f;
                b.vz *= f;
            }

            b.x += b.vx * dt;
            b.z += b.vz * dt;

            // Defensive: clamp non-finite values
            if (!isFinite(b.x))  b.x  = 0;
            if (!isFinite(b.z))  b.z  = 0;
            if (!isFinite(b.vx)) b.vx = 0;
            if (!isFinite(b.vz)) b.vz = 0;
        }

        // ---- 2. Rehash moved bodies -----------------------------------------
        for (let i = 0; i < this.bodies.length; i++) {
            const b = this.bodies[i];
            if (b._removed || b.isStatic) continue;
            this._rehash(b);
        }

        // ---- 3. Build unique candidate pairs from spatial hash -------------
        const pairs = this._buildPairs();

        // ---- 4. Solver (2 iterations) --------------------------------------
        for (let iter = 0; iter < 2; iter++) {
            this._solveIteration(pairs);
        }

        // ---- 5. Fire callbacks (collide + overlap) -------------------------
        this._fireCallbacks(pairs);

        // ---- 6. Flush pending removals -------------------------------------
        this._stepping = false;
        this._pendingRemovals.forEach(b => this._doRemoveBody(b));
        this._pendingRemovals.clear();
    }

    // -------------------------------------------------------------------------
    // Spatial queries
    // -------------------------------------------------------------------------

    /**
     * Return all bodies whose circles overlap the query circle.
     * @param {number} x
     * @param {number} z
     * @param {number} radius
     * @param {function} [filterFn]  Optional predicate(body)->bool.
     * @returns {object[]}
     */
    queryCircle(x, z, radius, filterFn) {
        const results = [];
        const seen    = new Set();

        const minCX = Math.floor((x - radius) / this.cellSize);
        const maxCX = Math.floor((x + radius) / this.cellSize);
        const minCZ = Math.floor((z - radius) / this.cellSize);
        const maxCZ = Math.floor((z + radius) / this.cellSize);

        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cz = minCZ; cz <= maxCZ; cz++) {
                const bucket = this._cells.get(cx + ',' + cz);
                if (!bucket) continue;
                for (let i = 0; i < bucket.length; i++) {
                    const b = bucket[i];
                    if (b._removed || seen.has(b)) continue;
                    seen.add(b);

                    // Exact distance test
                    const dx   = b.x - x;
                    const dz   = b.z - z;
                    const dist = dx * dx + dz * dz;
                    const sum  = b.radius + radius;
                    if (dist < sum * sum) {
                        if (!filterFn || filterFn(b)) results.push(b);
                    }
                }
            }
        }
        return results;
    }

    /**
     * Return all bodies whose AABBs overlap the given axis-aligned bounding box.
     * @param {number} minX
     * @param {number} minZ
     * @param {number} maxX
     * @param {number} maxZ
     * @param {function} [filterFn]  Optional predicate(body)->bool.
     * @returns {object[]}
     */
    queryAABB(minX, minZ, maxX, maxZ, filterFn) {
        const results = [];
        const seen    = new Set();

        const minCX = Math.floor(minX / this.cellSize);
        const maxCX = Math.floor(maxX / this.cellSize);
        const minCZ = Math.floor(minZ / this.cellSize);
        const maxCZ = Math.floor(maxZ / this.cellSize);

        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cz = minCZ; cz <= maxCZ; cz++) {
                const bucket = this._cells.get(cx + ',' + cz);
                if (!bucket) continue;
                for (let i = 0; i < bucket.length; i++) {
                    const b = bucket[i];
                    if (b._removed || seen.has(b)) continue;
                    seen.add(b);

                    // Exact AABB test
                    if (b.x + b.radius >= minX && b.x - b.radius <= maxX &&
                        b.z + b.radius >= minZ && b.z - b.radius <= maxZ) {
                        if (!filterFn || filterFn(b)) results.push(b);
                    }
                }
            }
        }
        return results;
    }

    // -------------------------------------------------------------------------
    // Callback registration
    // -------------------------------------------------------------------------

    /**
     * Register a handler fired when two sensor/any-overlapping bodies match
     * the given labels (in either order). Fires once per pair per step.
     * @param {string}   labelA
     * @param {string}   labelB
     * @param {function} fn  Called as fn(bodyA, bodyB) with bodyA.label===labelA.
     */
    onOverlap(labelA, labelB, fn) {
        this._overlapHandlers.set(labelA + '|' + labelB, fn);
    }

    /**
     * Register a handler fired when two non-sensor bodies that were physically
     * resolved match the given labels. Fires once per pair per step.
     * @param {string}   labelA
     * @param {string}   labelB
     * @param {function} fn  Called as fn(bodyA, bodyB) with bodyA.label===labelA.
     */
    onCollide(labelA, labelB, fn) {
        this._collideHandlers.set(labelA + '|' + labelB, fn);
    }

    // -------------------------------------------------------------------------
    // Utility
    // -------------------------------------------------------------------------

    /** @returns {number} Number of active bodies. */
    bodyCount() {
        return this.bodies.length;
    }

    // -------------------------------------------------------------------------
    // Private: spatial hash
    // -------------------------------------------------------------------------

    /**
     * Compute the set of cell keys occupied by a body's AABB.
     * @private
     * @param {object} body
     * @returns {string[]}
     */
    _cellKeysForBody(body) {
        const cs   = this.cellSize;
        const minCX = Math.floor((body.x - body.radius) / cs);
        const maxCX = Math.floor((body.x + body.radius) / cs);
        const minCZ = Math.floor((body.z - body.radius) / cs);
        const maxCZ = Math.floor((body.z + body.radius) / cs);
        const keys = [];
        for (let cx = minCX; cx <= maxCX; cx++) {
            for (let cz = minCZ; cz <= maxCZ; cz++) {
                keys.push(cx + ',' + cz);
            }
        }
        return keys;
    }

    /**
     * Remove a body from all cells it currently occupies.
     * @private
     * @param {object} body
     */
    _removeFromCells(body) {
        for (let i = 0; i < body._cells.length; i++) {
            const key    = body._cells[i];
            const bucket = this._cells.get(key);
            if (!bucket) continue;
            const idx = bucket.indexOf(body);
            if (idx !== -1) bucket.splice(idx, 1);
            if (bucket.length === 0) this._cells.delete(key);
        }
        body._cells.length = 0;
    }

    /**
     * Update the spatial hash for a body. Only mutates cells when the set of
     * occupied cells has changed (avoids redundant work for static bodies).
     * @private
     * @param {object} body
     */
    _rehash(body) {
        const newKeys = this._cellKeysForBody(body);

        // Fast equality check: same length + same contents in order
        const old = body._cells;
        let changed = (old.length !== newKeys.length);
        if (!changed) {
            for (let i = 0; i < newKeys.length; i++) {
                if (old[i] !== newKeys[i]) { changed = true; break; }
            }
        }
        if (!changed) return;

        // Remove from old cells
        this._removeFromCells(body);

        // Insert into new cells
        for (let i = 0; i < newKeys.length; i++) {
            const key = newKeys[i];
            let bucket = this._cells.get(key);
            if (!bucket) {
                bucket = [];
                this._cells.set(key, bucket);
            }
            bucket.push(body);
            body._cells.push(key);
        }
    }

    // -------------------------------------------------------------------------
    // Private: broadphase pair building
    // -------------------------------------------------------------------------

    /**
     * Build a deduplicated list of candidate body pairs from spatial hash buckets.
     * Only pairs that could possibly interact (masks permit) are kept.
     * Bodies are ordered so A.id < B.id for determinism.
     * @private
     * @returns {Array<[object, object]>}
     */
    _buildPairs() {
        const pairSet = new Set(); // keys: 'minId_maxId'
        const pairs   = [];

        this._cells.forEach(bucket => {
            for (let i = 0; i < bucket.length; i++) {
                const a = bucket[i];
                if (a._removed) continue;
                for (let j = i + 1; j < bucket.length; j++) {
                    const b = bucket[j];
                    if (b._removed) continue;

                    const idA = a.id < b.id ? a.id : b.id;
                    const idB = a.id < b.id ? b.id : a.id;
                    const key = idA + '_' + idB;
                    if (pairSet.has(key)) continue;
                    pairSet.add(key);

                    // Ensure A.id < B.id
                    const bodyA = a.id < b.id ? a : b;
                    const bodyB = a.id < b.id ? b : a;
                    pairs.push([bodyA, bodyB]);
                }
            }
        });

        return pairs;
    }

    // -------------------------------------------------------------------------
    // Private: narrowphase solver iteration
    // -------------------------------------------------------------------------

    /**
     * Run one solver iteration over the given pair list.
     * Resolves penetrations and applies impulses for non-sensor, mask-passing pairs.
     * @private
     * @param {Array<[object, object]>} pairs
     */
    _solveIteration(pairs) {
        for (let p = 0; p < pairs.length; p++) {
            const A = pairs[p][0];
            const B = pairs[p][1];

            // Skip if either body was removed mid-step
            if (A._removed || B._removed) continue;

            // Sensor pairs are never resolved
            if (A.isSensor || B.isSensor) continue;

            // Bitmask filter
            if (!(A.category & B.collidesWith) || !(B.category & A.collidesWith)) continue;

            let dx = B.x - A.x;
            let dz = B.z - A.z;
            let d2 = dx * dx + dz * dz;

            const minDist = A.radius + B.radius;
            if (d2 >= minDist * minDist) continue;

            // Coincident NaN guard — deterministic push in +x direction
            if (d2 < 1e-8) { dx = 0.01; dz = 0; d2 = 1e-4; }

            const d  = Math.sqrt(d2);
            const nx = dx / d;
            const nz = dz / d;
            const pen = minDist - d;

            const totalInv = A.invMass + B.invMass;
            if (totalInv === 0) continue; // both infinite-mass — skip

            // Position correction (slop 0.01, percent 0.8)
            const corr = Math.max(pen - 0.01, 0) / totalInv * 0.8;
            A.x -= nx * corr * A.invMass;
            A.z -= nz * corr * A.invMass;
            B.x += nx * corr * B.invMass;
            B.z += nz * corr * B.invMass;

            // Velocity impulse (restitution 0.05)
            const rv = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
            if (rv < 0) {
                const j = -(1 + 0.05) * rv / totalInv;
                A.vx -= j * A.invMass * nx;
                A.vz -= j * A.invMass * nz;
                B.vx += j * B.invMass * nx;
                B.vz += j * B.invMass * nz;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Private: callback dispatch
    // -------------------------------------------------------------------------

    /**
     * Fire onCollide and onOverlap callbacks after solving.
     *
     * - onCollide fires for non-sensor, mask-passing pairs that are currently
     *   overlapping (after resolution).
     * - onOverlap fires for ANY mask-passing pair currently overlapping
     *   (including sensor pairs and resolved pairs).
     * Each handler fires at most once per pair per step.
     * Handles bodies removed mid-callback via the _removed flag.
     * @private
     * @param {Array<[object, object]>} pairs  Snapshot from broadphase.
     */
    _fireCallbacks(pairs) {
        // Snapshot pair list (pairs already deduplicated array, no copy needed —
        // but we guard each entry inside the loop with _removed checks).

        for (let p = 0; p < pairs.length; p++) {
            const A = pairs[p][0];
            const B = pairs[p][1];

            // Skip if removed during a previous callback in this step
            if (A._removed || B._removed) continue;

            // Bitmask filter
            if (!(A.category & B.collidesWith) || !(B.category & A.collidesWith)) continue;

            // Exact overlap test (current positions after solving)
            const dx  = B.x - A.x;
            const dz  = B.z - A.z;
            const d2  = dx * dx + dz * dz;
            const sum = A.radius + B.radius;
            const overlapping = (d2 < sum * sum);

            if (!overlapping) continue;

            // onCollide — only for non-sensor pairs
            if (!A.isSensor && !B.isSensor) {
                this._tryFireHandler(this._collideHandlers, A, B);
            }

            // onOverlap — all overlapping pairs (sensor or not)
            this._tryFireHandler(this._overlapHandlers, A, B);
        }
    }

    /**
     * Look up a handler for the label pair (A.label, B.label) in the given
     * registry (either order), then call it with bodies in registration order.
     * Wraps in try/catch — a throw must not break the step.
     * @private
     * @param {Map<string, function>} registry
     * @param {object} A
     * @param {object} B
     */
    _tryFireHandler(registry, A, B) {
        const keyAB = A.label + '|' + B.label;
        const keyBA = B.label + '|' + A.label;

        let fn    = null;
        let first = null; // body matching the first registered label
        let second = null;

        if (registry.has(keyAB)) {
            fn     = registry.get(keyAB);
            first  = A;
            second = B;
        } else if (registry.has(keyBA)) {
            fn     = registry.get(keyBA);
            first  = B;
            second = A;
        }

        if (!fn) return;

        // Guard: bodies may have been removed by a prior callback this step
        if (first._removed || second._removed) return;

        try {
            fn(first, second);
        } catch (e) {
            console.warn('[CollisionWorld] handler error for labels "' +
                A.label + '" / "' + B.label + '":', e);
        }
    }
}

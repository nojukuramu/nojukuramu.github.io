/**
 * ModelFactory.js
 *
 * Procedural low-poly 3D model builder using Three.js primitives.
 * Plain global-script style — no imports/exports.  THREE and ENABLE3D are
 * expected as globals at call-time (ENABLE3D.THREE is aliased to THREE
 * before these methods are invoked).
 *
 * World units: 1 unit = 1 pixel.  Y is up; gameplay on the XZ plane.
 * Every factory method returns a THREE.Group (or ENABLE3D.ExtendedObject3D,
 * which extends Group) whose ORIGIN sits at the ground point (x=0, y=0, z=0).
 * Meshes are offset upward inside the group.  Named child references are
 * attached on group.userData.
 */

const ModelFactory = {

    // -------------------------------------------------------------------------
    // Texture store — populated by initTextures / init
    // -------------------------------------------------------------------------
    textures: {},

    /**
     * initTextures(THREE_ref)
     * Loads PNG assets from static/assets/ using a THREE.TextureLoader.
     * Loading is async/non-blocking; all methods guard against undefined
     * textures and fall back to a solid-colour material.
     */
    initTextures(THREE_ref) {
        const loader = new THREE_ref.TextureLoader();
        const base = 'static/assets/';

        // Ground textures — need repeat wrapping so large planes tile nicely.
        const groundKeys = [
            'plains_ground', 'forest_ground', 'stone_floor',
            'wood_floor', 'lake_ground'
        ];

        // Non-ground textures (sprites, surfaces).
        const surfaceKeys = [
            'crate', 'barrel', 'wall_h', 'wall_v',
            'tree', 'rock', 'cliff', 'particle'
        ];

        const applyGround = (tex) => {
            tex.wrapS = THREE_ref.RepeatWrapping;
            tex.wrapT = THREE_ref.RepeatWrapping;
            tex.colorSpace = THREE_ref.SRGBColorSpace;
        };

        const applySurface = (tex) => {
            tex.colorSpace = THREE_ref.SRGBColorSpace;
        };

        groundKeys.forEach(key => {
            loader.load(
                base + key + '.png',
                (tex) => { applyGround(tex); this.textures[key] = tex; },
                undefined,
                () => { console.warn('ModelFactory: failed to load', key + '.png'); }
            );
        });

        surfaceKeys.forEach(key => {
            loader.load(
                base + key + '.png',
                (tex) => { applySurface(tex); this.textures[key] = tex; },
                undefined,
                () => { console.warn('ModelFactory: failed to load', key + '.png'); }
            );
        });
    },

    /**
     * init(third)
     * Alias used by some callers (e.g. BootScene3D passes ENABLE3D.THREE).
     */
    init(third) {
        // `third` here is the Enable3D "third" object; extract THREE from it
        // if it looks like the Enable3D wrapper, otherwise treat as THREE directly.
        const THREE_ref = (third && third.scene) ? ENABLE3D.THREE : third;
        this.initTextures(THREE_ref);
    },

    // -------------------------------------------------------------------------
    // Material cache
    // -------------------------------------------------------------------------

    /** @private */
    _matCache: {},

    /**
     * _mat(colorHex, opts) → shared THREE.Material
     *
     * opts may contain:
     *   basic       {bool}   — use MeshBasicMaterial instead of MeshLambertMaterial
     *   flat        {bool}   — flatShading:true  (Lambert only)
     *   transparent {bool}
     *   opacity     {number}
     *   depthWrite  {bool}
     *   depthTest   {bool}
     *   map         {THREE.Texture|undefined}  — ignored when falsy (falls back to color)
     *   side        {THREE.Side}
     */
    _mat(colorHex, opts = {}) {
        // Build a deterministic cache key from color + stringified opts
        // (omit the map texture object from the key string; use a stable proxy)
        const mapId = opts.map ? opts.map.uuid : 'none';
        const key = colorHex + '|' + mapId + '|' + JSON.stringify(
            Object.assign({}, opts, { map: undefined })
        );

        if (this._matCache[key]) return this._matCache[key];

        const params = { color: colorHex };

        if (opts.map) params.map = opts.map;
        if (opts.transparent !== undefined) params.transparent = opts.transparent;
        if (opts.opacity     !== undefined) params.opacity     = opts.opacity;
        if (opts.depthWrite  !== undefined) params.depthWrite  = opts.depthWrite;
        if (opts.depthTest   !== undefined) params.depthTest   = opts.depthTest;
        if (opts.side        !== undefined) params.side        = opts.side;

        let mat;
        if (opts.basic) {
            mat = new THREE.MeshBasicMaterial(params);
        } else {
            if (opts.flat) params.flatShading = true;
            mat = new THREE.MeshLambertMaterial(params);
        }

        this._matCache[key] = mat;
        return mat;
    },

    // -------------------------------------------------------------------------
    // Shadow disc helper
    // -------------------------------------------------------------------------

    /**
     * shadow(radius) → THREE.Mesh
     * A flat semi-transparent black circle placed just above y=0.
     * Callers add it as a child of their group.
     */
    shadow(radius) {
        const geo = new THREE.CircleGeometry(radius * 1.15, 16);
        const mat = this._mat(0x000000, {
            basic: true,
            transparent: true,
            opacity: 0.30,
            depthWrite: false
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.02;
        mesh.renderOrder = 1;
        return mesh;
    },

    // -------------------------------------------------------------------------
    // Billboard HP bar helper
    // -------------------------------------------------------------------------

    /**
     * billboardBar(width, height) → THREE.Group
     * A screen-aligned two-layer progress bar (background + foreground).
     * Attach group.setRatio(t) to update the displayed proportion in [0,1].
     */
    billboardBar(width, height) {
        const group = new THREE.Group();

        // Background plane
        const bgGeo = new THREE.PlaneGeometry(width, height);
        const bgMat = this._mat(0x222222, {
            basic: true,
            transparent: true,
            depthTest: false
        });
        const bg = new THREE.Mesh(bgGeo, bgMat);
        bg.renderOrder = 10;
        group.add(bg);

        // Foreground plane — CLONED so each bar can be coloured independently
        const fgGeo = new THREE.PlaneGeometry(width, height);
        const fgMat = this._mat(0x00cc44, {
            basic: true,
            transparent: true,
            depthTest: false
        }).clone();   // clone so setRatio can mutate color without sharing
        const fg = new THREE.Mesh(fgGeo, fgMat);
        fg.renderOrder = 11;
        fg.position.z = 0.1;
        group.add(fg);

        group.userData = { bg, fg };

        group.setRatio = function(t) {
            t = Math.max(t, 0.001);
            fg.scale.x = t;
            fg.position.x = -width * (1 - t) / 2;
            if (t < 0.3)      fg.material.color.setHex(0xcc3333);
            else if (t < 0.6) fg.material.color.setHex(0xcccc33);
            else               fg.material.color.setHex(0x00cc44);
        };

        return group;
    },

    // -------------------------------------------------------------------------
    // Player
    // -------------------------------------------------------------------------

    /**
     * player(opts) → ENABLE3D.ExtendedObject3D
     * Collision radius ~18.  Ground origin at y=0.
     */
    player(opts = {}) {
        const group = new ENABLE3D.ExtendedObject3D();

        // Body — capsule torso
        const bodyGeo = new THREE.CapsuleGeometry(9, 16, 4, 8);
        const bodyMat = this._mat(0x3a6ea5);
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.set(0, 17, 0);
        group.add(body);

        // Head
        const headGeo = new THREE.SphereGeometry(6.5, 12, 10);
        const headMat = this._mat(0xf0c8a0);
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.set(0, 33, 0);
        group.add(head);

        // Visor
        const visorGeo = new THREE.BoxGeometry(4, 3, 7);
        const visorMat = this._mat(0x222222, { basic: true });
        const visor = new THREE.Mesh(visorGeo, visorMat);
        visor.position.set(6, 33, 0);
        group.add(visor);

        // Aim arrow — cone with apex pointing +X
        const aimGeo = new THREE.ConeGeometry(4, 10, 8);
        const aimMat = this._mat(0xffffff, {
            basic: true,
            transparent: true,
            opacity: 0.85
        });
        const aimArrow = new THREE.Mesh(aimGeo, aimMat);
        aimArrow.rotation.z = -Math.PI / 2;  // apex points +X
        aimArrow.position.set(26, 2, 0);
        group.add(aimArrow);

        // Shadow
        group.add(this.shadow(18));

        group.userData = { body, head, visor, aimArrow };
        return group;
    },

    // -------------------------------------------------------------------------
    // Enemy
    // -------------------------------------------------------------------------

    /**
     * enemy(opts) → ENABLE3D.ExtendedObject3D
     * Collision radius ~24.  Ground origin at y=0.
     * NOTE: the Enemy3D class clones the body material after construction
     * so it can apply per-enemy tints — do NOT pre-clone here.
     */
    enemy(opts = {}) {
        const group = new ENABLE3D.ExtendedObject3D();

        // Body block
        const bodyGeo = new THREE.BoxGeometry(26, 30, 22);
        const bodyMat = this._mat(0x8b2222);
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.set(0, 16, 0);
        group.add(body);

        // Head sphere
        const headGeo = new THREE.SphereGeometry(9, 10, 8);
        const headMat = this._mat(0x6b1a1a);
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.set(0, 38, 0);
        group.add(head);

        // Eyes
        const eyeGeo = new THREE.SphereGeometry(2, 6, 6);
        const eyeMat = this._mat(0xffdd44, { basic: true });

        const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
        eyeL.position.set(8, 40, 4);
        group.add(eyeL);

        const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
        eyeR.position.set(8, 40, -4);
        group.add(eyeR);

        // HP bar
        const hpBar = this.billboardBar(40, 5);
        hpBar.position.set(0, 58, 0);
        group.add(hpBar);

        // Shadow
        group.add(this.shadow(24));

        group.userData = { body, head, hpBar };
        return group;
    },

    // -------------------------------------------------------------------------
    // Projectiles
    // -------------------------------------------------------------------------

    /**
     * projectileSharp(opts) → ENABLE3D.ExtendedObject3D
     * opts: { radius, color }
     * A fast, sharp projectile (arrow/bolt style).  Apex points +X.
     */
    projectileSharp(opts = {}) {
        const r = opts.radius || 6;
        const color = opts.color !== undefined ? opts.color : 0xffff00;
        const group = new ENABLE3D.ExtendedObject3D();

        // Core cone — apex pointing +X
        const coreGeo = new THREE.ConeGeometry(r * 0.6, r * 2.4, 6);
        const coreMat = this._mat(color, { basic: true });
        const core = new THREE.Mesh(coreGeo, coreMat);
        core.rotation.z = -Math.PI / 2;  // apex → +X
        group.add(core);

        // Glow halo
        const glowGeo = new THREE.SphereGeometry(r * 0.9, 8, 6);
        const glowMat = this._mat(color, {
            basic: true,
            transparent: true,
            opacity: 0.35,
            depthWrite: false
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.set(-r * 0.4, 0, 0);
        group.add(glow);

        group.userData = { core, glow };
        return group;
    },

    /**
     * projectileBlunt(opts) → ENABLE3D.ExtendedObject3D
     * opts: { radius, color }
     * A chunky projectile (cannonball / magic orb style).
     * The core material is created fresh (not shared) so each projectile
     * can be tinted independently.
     */
    projectileBlunt(opts = {}) {
        const r = opts.radius || 8;
        const color = opts.color !== undefined ? opts.color : 0xff8800;
        const group = new ENABLE3D.ExtendedObject3D();

        // Core icosahedron — CLONED material (intentional, per spec)
        const coreGeo = new THREE.IcosahedronGeometry(r, 1);
        const coreMat = new THREE.MeshLambertMaterial({
            color: color,
            flatShading: true,
            emissive: color,
            emissiveIntensity: 0.5
        });
        const core = new THREE.Mesh(coreGeo, coreMat);
        group.add(core);

        // Soft glow shell
        const glowGeo = new THREE.SphereGeometry(r * 1.35, 10, 8);
        const glowMat = this._mat(color, {
            basic: true,
            transparent: true,
            opacity: 0.25,
            depthWrite: false
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        group.add(glow);

        group.userData = { core, glow };
        return group;
    },

    // -------------------------------------------------------------------------
    // Environment — vegetation
    // -------------------------------------------------------------------------

    /**
     * tree(opts) → THREE.Group
     * opts: { seedRand }  (seedRand ∈ [0,1), default 0.5)
     * Collision radius ~26.
     */
    tree(opts = {}) {
        const seed = (opts.seedRand !== undefined) ? opts.seedRand : 0.5;
        const group = new THREE.Group();

        // Trunk
        const trunkGeo = new THREE.CylinderGeometry(5, 7, 26, 7);
        const trunkMat = this._mat(0x6b4a2a);
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(0, 13, 0);
        group.add(trunk);

        // Foliage — three stacked cones, low-poly
        const foliageMat = this._mat(0x228B22, { flat: true });

        const f1 = new THREE.Mesh(new THREE.ConeGeometry(24, 26, 8), foliageMat);
        f1.position.set(0, 34, 0);
        group.add(f1);

        const f2 = new THREE.Mesh(new THREE.ConeGeometry(19, 22, 8), foliageMat);
        f2.position.set(0, 48, 0);
        group.add(f2);

        const f3 = new THREE.Mesh(new THREE.ConeGeometry(13, 18, 8), foliageMat);
        f3.position.set(0, 60, 0);
        group.add(f3);

        // Randomise rotation and scale by seed
        group.rotation.y = seed * Math.PI * 2;
        const s = 0.85 + seed * 0.3;
        group.scale.set(s, s, s);

        group.add(this.shadow(26));

        return group;
    },

    /**
     * bush(opts) → THREE.Group
     * opts: { seedRand }
     * Collision radius ~16.  Cluster of 4 spheres.
     */
    bush(opts = {}) {
        const group = new THREE.Group();
        const mat = this._mat(0x2d5a27, { flat: true });

        const spheres = [
            { r: 12, x: 0,  y: 10, z: 0  },
            { r:  9, x: 8,  y:  8, z: 4  },
            { r:  9, x: -7, y:  8, z: -5 },
            { r:  7, x: 2,  y: 15, z: -3 }
        ];

        spheres.forEach(({ r, x, y, z }) => {
            const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat);
            mesh.position.set(x, y, z);
            group.add(mesh);
        });

        group.add(this.shadow(16));
        return group;
    },

    /**
     * grass(opts) → THREE.Group
     * 3 crossed planes giving a billboard-style tuft.  No shadow.
     */
    grass(opts = {}) {
        const group = new THREE.Group();
        const mat = this._mat(0x3a5a30, {
            side: THREE.DoubleSide
        });

        for (let i = 0; i < 3; i++) {
            const geo = new THREE.PlaneGeometry(8, 10);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.y = i * (2 * Math.PI / 3);
            mesh.position.y = 5;
            group.add(mesh);
        }

        return group;
    },

    /**
     * flower(opts) → THREE.Group
     * Tiny decorative flower.  No shadow.
     */
    flower(opts = {}) {
        const group = new THREE.Group();

        // Stem
        const stemGeo = new THREE.CylinderGeometry(0.6, 0.6, 8, 5);
        const stemMat = this._mat(0x3a5a30);
        const stem = new THREE.Mesh(stemGeo, stemMat);
        stem.position.y = 4;
        group.add(stem);

        // Central head
        const headGeo = new THREE.SphereGeometry(3, 8, 6);
        const headMat = this._mat(0xff6699, { basic: true });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = 9.5;
        group.add(head);

        // 5 petals arranged in a ring around the head
        const petalMat = this._mat(0xff99bb, { basic: true });
        for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2;
            const px = Math.cos(angle) * 4;
            const pz = Math.sin(angle) * 4;
            const petal = new THREE.Mesh(new THREE.SphereGeometry(1.8, 6, 4), petalMat);
            petal.position.set(px, 9.5, pz);
            group.add(petal);
        }

        return group;
    },

    // -------------------------------------------------------------------------
    // Environment — rocks / terrain
    // -------------------------------------------------------------------------

    /**
     * rock(opts) → THREE.Group
     * opts: { seedRand }
     * Collision radius ~20.
     */
    rock(opts = {}) {
        const seed = (opts.seedRand !== undefined) ? opts.seedRand : 0.5;
        const group = new THREE.Group();

        const tex = this.textures.rock;
        const mat = this._mat(0x667788, {
            flat: true,
            map: tex || undefined
        });

        const geo = new THREE.IcosahedronGeometry(20, 0);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.scale.set(1, 0.55, 1);
        mesh.position.y = 11;
        mesh.rotation.y = seed * Math.PI * 2;
        group.add(mesh);

        group.add(this.shadow(20));
        return group;
    },

    /**
     * boulder(opts) → THREE.Group
     * opts: { seedRand }
     * Collision radius ~35.
     */
    boulder(opts = {}) {
        const seed = (opts.seedRand !== undefined) ? opts.seedRand : 0.5;
        const group = new THREE.Group();

        const tex = this.textures.rock;
        const mat = this._mat(0x556677, {
            flat: true,
            map: tex || undefined
        });

        const geo = new THREE.IcosahedronGeometry(35, 1);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.scale.set(1, 0.7, 1);
        mesh.position.y = 24.5;
        mesh.rotation.y = seed * Math.PI * 2;
        group.add(mesh);

        group.add(this.shadow(35));
        return group;
    },

    /**
     * cliff(opts) → THREE.Group
     * opts: { seedRand }
     * Collision radius ~50.  Large blocky cliff with jagged top chunks.
     */
    cliff(opts = {}) {
        const seed = (opts.seedRand !== undefined) ? opts.seedRand : 0.5;
        const group = new THREE.Group();

        const cliffTex = this.textures.cliff;
        const sideMat  = this._mat(0x3a3a3a, { map: cliffTex || undefined });
        const topMat   = this._mat(0x3a3a3a);

        // Base box with 6-material array (sides from texture, top plain)
        const baseGeo = new THREE.BoxGeometry(88, 70, 88);
        // Face order for BoxGeometry: +x, -x, +y, -y, +z, -z
        const baseMats = [
            sideMat, sideMat,   // +x, -x
            topMat,  sideMat,   // +y, -y
            sideMat, sideMat    // +z, -z
        ];
        const base = new THREE.Mesh(baseGeo, baseMats);
        base.position.set(0, 35, 0);
        group.add(base);

        // Jagged top chunks in a sub-group (rotated by seed)
        const jagMat = this._mat(0x3a3a3a, { flat: true });
        const jagGroup = new THREE.Group();
        jagGroup.rotation.y = seed * Math.PI * 2;

        const jags = [
            { r: 22, x: -25, y: 74, z: -15 },
            { r: 16, x:  20, y: 70, z:  18 },
            { r: 14, x:   5, y: 78, z: -28 }
        ];
        jags.forEach(({ r, x, y, z }) => {
            const jGeo = new THREE.IcosahedronGeometry(r, 0);
            const jMesh = new THREE.Mesh(jGeo, jagMat);
            jMesh.position.set(x, y, z);
            jagGroup.add(jMesh);
        });
        group.add(jagGroup);

        group.add(this.shadow(50));
        return group;
    },

    // -------------------------------------------------------------------------
    // Environment — props
    // -------------------------------------------------------------------------

    /**
     * crate(opts) → THREE.Group
     * Collision radius ~18.
     */
    crate(opts = {}) {
        const group = new THREE.Group();

        const tex = this.textures.crate;
        const mat = this._mat(0xCD853F, { map: tex || undefined });

        const geo = new THREE.BoxGeometry(28, 28, 28);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(0, 14, 0);
        group.add(mesh);

        group.add(this.shadow(18));
        return group;
    },

    /**
     * barrel(opts) → THREE.Group
     * Collision radius ~16.  Cylinder body with two metal hoops.
     */
    barrel(opts = {}) {
        const group = new THREE.Group();

        const tex = this.textures.barrel;
        const sideMat   = this._mat(0x8B4513, { map: tex || undefined });
        const capMat    = this._mat(0x8B4513);
        const hoopMat   = this._mat(0x444444);

        // 3-material array: [side, top cap, bottom cap]
        const bodyGeo = new THREE.CylinderGeometry(13, 13, 30, 12);
        const body = new THREE.Mesh(bodyGeo, [sideMat, capMat, capMat]);
        body.position.set(0, 15, 0);
        group.add(body);

        // Metal hoops
        const hoopGeo = new THREE.TorusGeometry(13.4, 1, 6, 14);
        const hoop1 = new THREE.Mesh(hoopGeo, hoopMat);
        hoop1.rotation.x = Math.PI / 2;
        hoop1.position.set(0, 8, 0);
        group.add(hoop1);

        const hoop2 = new THREE.Mesh(hoopGeo, hoopMat);
        hoop2.rotation.x = Math.PI / 2;
        hoop2.position.set(0, 22, 0);
        group.add(hoop2);

        group.add(this.shadow(16));
        return group;
    },

    /**
     * wall(opts) → THREE.Group
     * opts: { orientation }  'h' (horizontal) or 'v' (vertical).
     * Collision radius ~20.
     */
    wall(opts = {}) {
        const group = new THREE.Group();
        const orientation = opts.orientation || 'h';

        const wallTex = orientation === 'h' ? this.textures.wall_h : this.textures.wall_v;
        const plainMat  = this._mat(0x555555);
        const facedMat  = this._mat(0x555555, { map: wallTex || undefined });

        let geo;
        let mats;

        if (orientation === 'h') {
            // Wide along X; thin along Z → large faces are ±Z
            geo = new THREE.BoxGeometry(40, 44, 18);
            // Face order: +x, -x, +y, -y, +z, -z
            mats = [
                plainMat, plainMat,   // +x, -x (narrow ends)
                plainMat, plainMat,   // +y, -y (top/bottom)
                facedMat, facedMat    // +z, -z (large faces)
            ];
        } else {
            // Wide along Z; thin along X → large faces are ±X
            geo = new THREE.BoxGeometry(18, 44, 40);
            mats = [
                facedMat, facedMat,   // +x, -x (large faces)
                plainMat, plainMat,   // +y, -y
                plainMat, plainMat    // +z, -z (narrow ends)
            ];
        }

        const mesh = new THREE.Mesh(geo, mats);
        mesh.position.set(0, 22, 0);
        group.add(mesh);

        group.add(this.shadow(20));
        return group;
    },

    /**
     * pillar(opts) → THREE.Group
     * Collision radius ~14.  Classical column with cap and base.
     */
    pillar(opts = {}) {
        const group = new THREE.Group();
        const mat = this._mat(0x666666);

        // Shaft
        const shaftGeo = new THREE.CylinderGeometry(11, 13, 60, 10);
        const shaft = new THREE.Mesh(shaftGeo, mat);
        shaft.position.set(0, 30, 0);
        group.add(shaft);

        // Capital (cap)
        const capGeo = new THREE.BoxGeometry(28, 6, 28);
        const cap = new THREE.Mesh(capGeo, mat);
        cap.position.set(0, 63, 0);
        group.add(cap);

        // Base plinth
        const baseGeo = new THREE.BoxGeometry(30, 6, 30);
        const base = new THREE.Mesh(baseGeo, mat);
        base.position.set(0, 3, 0);
        group.add(base);

        group.add(this.shadow(14));
        return group;
    },

    /**
     * stairs(opts) → THREE.Group
     * opts: { rotation }  — yaw in radians (default 0)
     * Collision radius ~22.  4 ascending steps.
     */
    stairs(opts = {}) {
        const group = new THREE.Group();
        const mat = this._mat(0x8B4513);

        const steps = [
            { z: -16.5, y: 2.5  },
            { z:  -5.5, y: 7.5  },
            { z:   5.5, y: 12.5 },
            { z:  16.5, y: 17.5 }
        ];

        steps.forEach(({ z, y }) => {
            const geo = new THREE.BoxGeometry(40, 5, 11);
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(0, y, z);
            group.add(mesh);
        });

        group.rotation.y = -(opts.rotation || 0);

        // Low-opacity shadow hint
        const shadowMesh = this.shadow(22);
        shadowMesh.material = shadowMesh.material.clone();
        shadowMesh.material.opacity = 0.15;
        group.add(shadowMesh);

        return group;
    },

    // -------------------------------------------------------------------------
    // byType lookup
    // -------------------------------------------------------------------------

    /**
     * Maps entity type strings (used in game data / level configs) to the
     * corresponding ModelFactory method name.
     */
    byType: {
        Tree:    'tree',
        Bush:    'bush',
        Crate:   'crate',
        Barrel:  'barrel',
        Rock:    'rock',
        Boulder: 'boulder',
        Wall:    'wall',
        Cliff:   'cliff',
        Pillar:  'pillar',
        Stairs:  'stairs',
        Grass:   'grass',
        Flower:  'flower'
    }

}; // end ModelFactory

console.log('ModelFactory loaded');

/**
 * Biome3D.js — 3D ground tile and fog-color helpers per biome.
 *
 * Globals consumed (set up before this runs):
 *   THREE        — aliased from ENABLE3D.THREE in game3d.js
 *   ModelFactory — has .textures (map of THREE.Texture) and ._mat
 *   Config       — Config.Biomes[name].color hex strings
 *
 * No ES-module exports; everything is exposed on the global `Biome3D` object.
 */

const Biome3D = {

    // -------------------------------------------------------------------------
    // Caches
    // -------------------------------------------------------------------------
    _groundMatCache: {},
    _fogColorCache:  {},

    // -------------------------------------------------------------------------
    // biomeTextureKey(biome) -> string key into ModelFactory.textures
    // -------------------------------------------------------------------------
    biomeTextureKey(biome) {
        switch (biome) {
            case 'Plains':
            case 'Clearing':
            case 'Desert':
                return 'plains_ground';

            case 'Forest':
            case 'Swamp':
                return 'forest_ground';

            case 'Rocky':
            case 'Cave':
            case 'Graveyard':
            case 'Ruins':
                return 'stone_floor';

            case 'Village':
            case 'Camp':
                return 'wood_floor';

            case 'Lake':
                return 'lake_ground';

            default:
                return 'plains_ground';
        }
    },

    // -------------------------------------------------------------------------
    // _parseColor(str) -> integer 0xRRGGBB from '#rrggbb'
    // -------------------------------------------------------------------------
    _parseColor(str) {
        if (!str || typeof str !== 'string') return 0x3a4a2a;
        return parseInt(str.replace('#', ''), 16);
    },

    // -------------------------------------------------------------------------
    // getGroundMaterial(biome) -> cached THREE.MeshLambertMaterial
    //
    // Color = biome tint from Config.Biomes[biome].color (Lambert multiplies
    // color × map so the tint stays light — we use the raw hex value directly).
    // Texture repeat is set once (4×4) on the shared texture; all chunks of the
    // same biome share the same repeat so we never mutate it at draw time.
    // -------------------------------------------------------------------------
    getGroundMaterial(biome) {
        if (this._groundMatCache[biome]) return this._groundMatCache[biome];

        const colorHex = this._parseColor(
            (typeof Config !== 'undefined' && Config.Biomes && Config.Biomes[biome])
                ? Config.Biomes[biome].color
                : null
        );

        const mat = new THREE.MeshLambertMaterial({ color: colorHex });

        const texKey  = this.biomeTextureKey(biome);
        const textures = (typeof ModelFactory !== 'undefined') ? ModelFactory.textures : {};
        const tex     = textures[texKey];

        if (tex) {
            // Configure repeat once on the shared texture — all same-biome chunks
            // use the same UV repeat (4×4 tiles across the 320-unit chunk).
            tex.wrapS  = THREE.RepeatWrapping;
            tex.wrapT  = THREE.RepeatWrapping;
            tex.repeat.set(4, 4);
            tex.needsUpdate = true;

            mat.map   = tex;
            mat.color.setHex(colorHex); // keep biome tint
            mat.needsUpdate = true;
        }

        mat.receiveShadow = false;

        this._groundMatCache[biome] = mat;
        return mat;
    },

    // -------------------------------------------------------------------------
    // groundTile(cx, cz, biome) -> THREE.Mesh
    //
    // A 320×320 horizontal plane centred in chunk (cx, cz).
    // Chunk world-space centre: x = cx*320 + 160, z = cz*320 + 160, y = 0.
    // -------------------------------------------------------------------------
    groundTile(cx, cz, biome) {
        const CHUNK = 320;
        const geo   = new THREE.PlaneGeometry(CHUNK, CHUNK);
        const mat   = this.getGroundMaterial(biome);
        const mesh  = new THREE.Mesh(geo, mat);

        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(
            cx * CHUNK + CHUNK / 2,
            0,
            cz * CHUNK + CHUNK / 2
        );
        mesh.receiveShadow = false;

        return mesh;
    },

    // -------------------------------------------------------------------------
    // getFogColor(biome) -> THREE.Color (cached)
    // -------------------------------------------------------------------------
    getFogColor(biome) {
        if (this._fogColorCache[biome]) return this._fogColorCache[biome];

        const hex = this._parseColor(
            (typeof Config !== 'undefined' && Config.Biomes && Config.Biomes[biome])
                ? Config.Biomes[biome].color
                : null
        );

        const color = new THREE.Color(hex);
        this._fogColorCache[biome] = color;
        return color;
    },

    // -------------------------------------------------------------------------
    // init(third) — kept for API symmetry; textures are handled by ModelFactory.
    // -------------------------------------------------------------------------
    init(third) {
        // no-op: texture initialisation is performed by ModelFactory.initTextures()
        // in BootScene3D.js before any chunk is rendered.
    }
};

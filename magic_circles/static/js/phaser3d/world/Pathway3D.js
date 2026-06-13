/**
 * Pathway3D.js — 3D path-floor mesh builder wrapping PathwayRenderer.
 *
 * PathwayRenderer supplies the path-network data (which chunks have paths and
 * in which directions).  Pathway3D builds THREE.js geometry for those paths
 * so ChunkManager3D can add/remove them with the rest of the chunk meshes.
 *
 * Globals consumed:
 *   THREE           — aliased from ENABLE3D.THREE in game3d.js
 *   ModelFactory    — .textures map of THREE.Texture
 *   PathwayRenderer — reused 2D path-data class
 *   W3D             — W3D.H.PATH height constant (0.04)
 *
 * Constructor: new Pathway3D(scene)
 *   scene — GameScene3D instance (scene.third.scene is the THREE.Scene).
 *   Only stored for future use; Pathway3D does NOT add meshes itself —
 *   the caller (ChunkManager3D) does that via buildChunkPath().
 */

class Pathway3D {

    // -------------------------------------------------------------------------
    // Construction
    // -------------------------------------------------------------------------
    constructor(scene) {
        this.scene    = scene;   // GameScene3D
        this.renderer = null;    // PathwayRenderer instance, set by init()

        // Cached dirt path material (shared across all path quads).
        this._pathMat = null;
    }

    // -------------------------------------------------------------------------
    // init(seed) — create and populate the PathwayRenderer data model.
    //
    // PathwayRenderer.init() calls this.scene.add.graphics() to create a Phaser
    // graphics object for 2D rendering.  We are only using its DATA (pathChunks
    // map) here, so we supply a minimal mock scene whose add.graphics() returns
    // a harmless stub.  The stub implements the methods PathwayRenderer calls:
    //   setDepth, clear, lineStyle, lineBetween.
    // -------------------------------------------------------------------------
    init(seed) {
        // Minimal Phaser-scene mock — satisfies PathwayRenderer.init() without
        // requiring a live Phaser scene.
        const mockGraphics = {
            setDepth()   {},
            clear()      {},
            lineStyle()  {},
            lineBetween() {}
        };
        const mockScene = {
            add: { graphics: () => mockGraphics }
        };

        this.renderer = new PathwayRenderer(mockScene);
        this.renderer.init(seed);
        this.renderer.generate();
    }

    // -------------------------------------------------------------------------
    // Delegation helpers — degrade gracefully if renderer is not ready.
    // -------------------------------------------------------------------------

    /**
     * getPathDirection(cx, cz) -> string code or null
     * Possible values: 'NS','EW','NE','NW','SE','SW','CROSS',
     *                  'T_N','T_S','T_E','T_W',
     *                  'END_N','END_S','END_E','END_W', or null.
     */
    getPathDirection(cx, cz) {
        if (!this.renderer) return null;
        try { return this.renderer.getPathDirection(cx, cz); }
        catch (e) { return null; }
    }

    /**
     * hasPath(cx, cz) -> boolean
     */
    hasPath(cx, cz) {
        if (!this.renderer) return false;
        try { return this.renderer.hasPath(cx, cz); }
        catch (e) { return false; }
    }

    // -------------------------------------------------------------------------
    // _getPathMaterial() -> cached THREE.MeshLambertMaterial (dirt colour)
    // -------------------------------------------------------------------------
    _getPathMaterial() {
        if (this._pathMat) return this._pathMat;

        const textures = (typeof ModelFactory !== 'undefined') ? ModelFactory.textures : {};
        const tex      = textures['stone_floor'];  // reuse stone_floor if available

        if (tex) {
            this._pathMat = new THREE.MeshLambertMaterial({
                color: 0x6a5a4a,
                map:   tex
            });
        } else {
            this._pathMat = new THREE.MeshLambertMaterial({ color: 0x6a5a4a });
        }
        return this._pathMat;
    }

    // -------------------------------------------------------------------------
    // _cellsForCode(code) -> Set of "row,col" strings (8×8 tile grid, 0-based)
    //
    // The 320-unit chunk is divided into an 8×8 grid of 40-unit tiles.
    // Row 0 = northmost (low Z), Row 7 = southmost (high Z).
    // Col 0 = westmost  (low X), Col 7 = eastmost  (high X).
    //
    // Path strips:
    //   N/S corridor  → columns 3 & 4 (centre two, all rows)
    //   E/W corridor  → rows    3 & 4 (centre two, all cols)
    //   Centre 2×2    → rows 3-4, cols 3-4 (always filled for non-null code)
    //
    // For dead-ends (END_*) we fill the centre plus a half-strip toward the
    // open direction (rows/cols 0-3 or 4-7 depending on direction).
    // -------------------------------------------------------------------------
    _cellsForCode(code) {
        const cells = new Set();
        if (!code) return cells;

        const addCol = (col) => {
            for (let row = 0; row < 8; row++) cells.add(`${row},${col}`);
        };
        const addRow = (row) => {
            for (let col = 0; col < 8; col++) cells.add(`${row},${col}`);
        };
        const addColHalf = (col, fromRow, toRow) => {
            for (let row = fromRow; row <= toRow; row++) cells.add(`${row},${col}`);
        };
        const addRowHalf = (row, fromCol, toCol) => {
            for (let col = fromCol; col <= toCol; col++) cells.add(`${row},${col}`);
        };

        // Always include centre 2×2
        cells.add('3,3'); cells.add('3,4');
        cells.add('4,3'); cells.add('4,4');

        // Determine which cardinal directions are open
        const hasN = code === 'NS'   || code === 'NE'  || code === 'NW'  ||
                     code === 'CROSS'|| code === 'T_N'  || code === 'T_E'  ||
                     code === 'T_W'  || code === 'END_N';
        const hasS = code === 'NS'   || code === 'SE'  || code === 'SW'  ||
                     code === 'CROSS'|| code === 'T_S'  || code === 'T_E'  ||
                     code === 'T_W'  || code === 'END_S';
        const hasE = code === 'EW'   || code === 'NE'  || code === 'SE'  ||
                     code === 'CROSS'|| code === 'T_E'  || code === 'T_N'  ||
                     code === 'T_S'  || code === 'END_E';
        const hasW = code === 'EW'   || code === 'NW'  || code === 'SW'  ||
                     code === 'CROSS'|| code === 'T_W'  || code === 'T_N'  ||
                     code === 'T_S'  || code === 'END_W';

        // N/S corridor (cols 3 & 4)
        if (hasN && hasS) {
            // Full N↔S corridor
            addCol(3); addCol(4);
        } else if (hasN) {
            // Half-strip toward north (rows 0–3)
            addColHalf(3, 0, 3); addColHalf(4, 0, 3);
        } else if (hasS) {
            // Half-strip toward south (rows 4–7)
            addColHalf(3, 4, 7); addColHalf(4, 4, 7);
        }

        // E/W corridor (rows 3 & 4)
        if (hasE && hasW) {
            // Full E↔W corridor
            addRow(3); addRow(4);
        } else if (hasE) {
            // Half-strip toward east (cols 4–7)
            addRowHalf(3, 4, 7); addRowHalf(4, 4, 7);
        } else if (hasW) {
            // Half-strip toward west (cols 0–3)
            addRowHalf(3, 0, 3); addRowHalf(4, 0, 3);
        }

        return cells;
    }

    // -------------------------------------------------------------------------
    // buildChunkPath(cx, cz) -> THREE.Group | null
    //
    // Returns a group of 40×40 PlaneGeometry quads at y = W3D.H.PATH (0.04)
    // covering the path cells in this chunk, or null if no path exists here.
    // The group position is (0,0,0); each quad has an absolute world position.
    // -------------------------------------------------------------------------
    buildChunkPath(cx, cz) {
        if (!this.hasPath(cx, cz)) return null;

        const code = this.getPathDirection(cx, cz);
        const cells = this._cellsForCode(code);
        if (cells.size === 0) return null;

        const TILE  = 40;
        const PATH_Y = (typeof W3D !== 'undefined') ? W3D.H.PATH : 0.04;
        const mat   = this._getPathMaterial();
        const group = new THREE.Group();

        for (const cellKey of cells) {
            const parts = cellKey.split(',');
            const row   = parseInt(parts[0], 10);  // Z axis (0 = north)
            const col   = parseInt(parts[1], 10);  // X axis (0 = west)

            const worldX = cx * 320 + col * TILE + TILE / 2;
            const worldZ = cz * 320 + row * TILE + TILE / 2;

            const geo  = new THREE.PlaneGeometry(TILE, TILE);
            const quad = new THREE.Mesh(geo, mat);

            quad.rotation.x = -Math.PI / 2;
            quad.position.set(worldX, PATH_Y, worldZ);
            quad.receiveShadow = false;

            group.add(quad);
        }

        return group;
    }

    // -------------------------------------------------------------------------
    // update(camX, camZ) — no-op.
    // Path meshes are owned per-chunk by ChunkManager3D; it adds/removes them
    // as chunks load and unload.  No per-frame work is required here.
    // -------------------------------------------------------------------------
    update(camX, camZ) {
        // intentional no-op
    }
}

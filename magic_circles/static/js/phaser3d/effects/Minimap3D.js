/**
 * Minimap3D - Thin adapter that wires the 2D MinimapSystem into a 3D scene.
 *
 * The MinimapSystem is a Phaser 2D overlay (defined in
 * phaser/effects/MinimapSystem.js).  It already handles all rendering;
 * this file only constructs it against the HUD scene.
 *
 * Usage (in HUDScene3D):
 *   this.minimap = Minimap3D.attach(this, chunkManager);
 *
 * Per-frame (in HUDScene3D.update):
 *   this.minimap.update(player.x, player.z, chunkManager);
 *   // player.z maps to MinimapSystem's playerY because gameplay is on XZ plane.
 *
 * Plain global-script style — no modules/exports.
 */

const Minimap3D = {
    /**
     * Create and return a MinimapSystem bound to the given HUD (2D) Phaser scene.
     * Returns null when MinimapSystem is not yet loaded.
     *
     * @param {Phaser.Scene} hudScene       - The 2D overlay scene (HUDScene3D)
     * @param {object}       chunkManager3D - Passed for context; not used here
     *                                        (caller passes it each frame to .update())
     * @returns {MinimapSystem|null}
     */
    attach: function (hudScene, chunkManager3D) {
        if (typeof MinimapSystem === 'undefined') return null;
        const mm = new MinimapSystem(hudScene);
        mm.create();
        return mm;
    }
};

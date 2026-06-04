/**
 * Cast - Spellcasting logic
 * 
 * Layer-based casting:
 * - Bottom layer circles are thrown first
 * - Right-click activates the next layer of circles
 * - Elements are processed bottom-to-top for the stack
 * 
 * Spectrum System:
 * - Power/Radius ratio determines spell type (NEEDLE, LANCE, DART, etc.)
 * - Each spectrum has unique speed, damage, pierce, and special effects
 */

/**
 * Determine spell spectrum based on power and circle radius
 * @param {number} power - Spell power (affected by power multiplier)
 * @param {number} radius - Circle radius
 * @returns {string} Spectrum type (NEEDLE, LANCE, BEAM, DART, WAVE, BURST, BOULDER, CANNON, NOVA, FLICKER)
 */
function getSpellSpectrum(power, radius) {
    let cfg = Config.SpellSpectrum;
    let ratio = power / Math.max(radius, 1);

    // Check for extreme combinations first (special cases)
    // NOVA: Very large circle + very high power = short-range massive explosion
    if (radius > cfg.largeRadius && power > cfg.highPower) return 'NOVA';
    // NEEDLE: Tiny circle + high power = extreme piercing
    if (radius < cfg.smallRadius && power > cfg.highPower) return 'NEEDLE';
    // FLICKER: Tiny circle + low power = weak fast shot
    if (radius < cfg.smallRadius && power < cfg.lowPower) return 'FLICKER';

    // Ratio-based classification
    if (ratio >= cfg.thresholds.needle) return 'NEEDLE';
    if (ratio >= cfg.thresholds.lance) return 'LANCE';
    if (ratio >= cfg.thresholds.beam) return 'BEAM';
    if (ratio >= cfg.thresholds.dart) return 'DART';
    if (ratio >= cfg.thresholds.wave) return 'WAVE';
    if (ratio >= cfg.thresholds.burst) return 'BURST';
    if (ratio >= cfg.thresholds.boulder) return 'BOULDER';

    // Default to CANNON for very low ratios
    return 'CANNON';
}

/**
 * Check if spectrum is piercing type (goes through enemies)
 */
function isSpectumPiercing(spectrum) {
    return ['NEEDLE', 'LANCE', 'BEAM'].includes(spectrum);
}

/**
 * Execute the spell based on current Magic state
 */
function cast() {
    // --- 1. Elemental Logic (The Fuel) ---
    let stack = [];
    let manaCost = 0;

    // Flatten all shapes from all layers (bottom to top)
    let allShapes = [];
    Magic.layers.forEach(l => {
        if (!l.visible) return;
        l.items.forEach(it => {
            if (it.type === 'SHAPE') allShapes.push(it.data);
        });
    });

    // Power multiplier affects mana costs
    // Formula: cost multiplier = 1 + (powerMult - 1) * 0.2
    // ×1 = 1.0× cost, ×5 = 1.8× cost, ×10 = 2.8× cost
    let powerMult = Magic.powerMultiplier || 1;
    let manaCostMult = 1 + (powerMult - 1) * 0.2;

    // Stack Reduction Algorithm
    allShapes.forEach(s => {
        let el = s.element;
        let baseCost = Config.ManaCost[el] || 15;
        let actualCost = Math.ceil(baseCost * manaCostMult);

        if (Game.player.mana[el] >= actualCost) {
            Game.player.mana[el] -= actualCost;
            manaCost += actualCost;

            // Predator Logic
            if (stack.length > 0) {
                let top = stack[stack.length - 1];
                let bottom = el;

                let beats = false;
                if (bottom === 'Water' && top === 'Fire') beats = true;
                if (bottom === 'Fire' && top === 'Earth') beats = true;
                if (bottom === 'Earth' && top === 'Air') beats = true;
                if (bottom === 'Air' && top === 'Water') beats = true;

                if (beats) {
                    stack.pop();
                } else {
                    stack.push(bottom);
                }
            } else {
                stack.push(el);
            }
        }
    });

    // --- 2. Circle Logic (Layer-Based) ---
    // Group circles by their LAYER, not by geometry
    let circleLayers = []; // Array of arrays: [[layer0 circles], [layer1 circles], ...]

    Magic.layers.forEach(l => {
        if (!l.visible) return;

        let layerCircles = [];
        l.items.forEach(it => {
            if (it.type === 'CIRCLE') {
                let c = it.data;
                // Ensure center is Vec2
                if (!(c.center instanceof Vec2)) {
                    c.center = new Vec2(c.center.x, c.center.y);
                }
                layerCircles.push(c);
            }
        });

        if (layerCircles.length > 0) {
            circleLayers.push(layerCircles);
        }
    });

    // --- BASE MAGIC FALLBACK ---
    // Triggers when cast truly fails:
    // 1. No circles AND no elements (nothing to cast)
    // 2. Had shapes but no mana for any of them (intended elements, but can't cast them)
    let hasCircles = circleLayers.length > 0;
    let hasElements = stack.length > 0;
    let hadShapesButNoMana = (allShapes.length > 0 && stack.length === 0);

    // Only fallback to Base Magic if there's truly nothing to cast
    if (!hasCircles && !hasElements) {
        // Complete failure - fire Base Magic
        castBaseMagic();
        return;
    }

    // If had shapes but no mana for ANY of them, fire Base Magic
    // This prevents using wrong elements (e.g., Fire when Air was intended but no Air mana)
    if (hadShapesButNoMana) {
        castBaseMagic();
        return;
    }

    // Virtual circle fallback (if elements but no circles - still a valid cast)
    if (circleLayers.length === 0) {
        circleLayers.push([{
            center: new Vec2(0, 0),
            rad: 30,
            runes: [],
            virtual: true
        }]);
    }

    // --- 3. Execution ---
    // Bottom layer (index 0) = Container layer to throw
    let containerLayer = circleLayers[0];
    // Remaining layers = Payload layers (to be activated on right-clicks)
    let payloadLayers = circleLayers.slice(1);

    // Calculate damage
    let baseDmg = stack.length > 0 ? stack.length * Config.BaseDamagePerElement : 10;

    // Calculate power based on stack size and power multiplier (slider)
    // Power multiplier only affects first layer circles (container layer)
    let basePower = (Config.BasePower + (stack.length * 25)) * powerMult;

    // For each circle in the container layer, spawn a projectile
    containerLayer.forEach(cont => {
        // Calculate spectrum based on power and radius
        let spectrum = getSpellSpectrum(basePower, cont.rad);
        let spectrumConfig = Config.SpellSpectrum.effects[spectrum];

        // Speed from spectrum config (virtual uses default)
        let speed = cont.virtual ? Config.DefaultSpeed : spectrumConfig.speed;

        // Damage modified by spectrum
        let finalDamage = payloadLayers.length > 0 ? 10 : baseDmg * spectrumConfig.damage;

        // Determine physics type (sharp for piercing spectrums)
        let isPiercing = isSpectumPiercing(spectrum);
        let physics = isPiercing ? 'SHARP' : 'BLUNT';

        // Recoil based on spectrum knockback
        if (spectrumConfig.knockback > 0 && !cont.virtual) {
            Game.player.vel = Game.player.vel.sub(Input.aim.mul(800 * spectrumConfig.knockback));
        }

        // Direction (use runes if present)
        let dir = Input.aim;
        if (cont.runes && cont.runes.length > 0) {
            let offset = cont.runes[0] - (-Math.PI / 2);
            let finalAng = Input.aim.angle() + offset;
            dir = Vec2.fromAngle(finalAng);
        }

        // Calculate projectile radius based on spectrum
        let projRadius;
        if (isPiercing) {
            // Piercing: smaller visual based on spectrum
            projRadius = Math.max(4, 8 * spectrumConfig.visualScale);
        } else {
            // Non-piercing: scale based on circle size
            projRadius = (cont.rad / 3) * spectrumConfig.visualScale;
        }

        // Calculate spawn offset - projectile spawns away from caster
        let spawnOffset = Math.max(Config.ProjectileSpawnOffset, Game.player.rad + projRadius + 5);
        let spawnPos = Game.player.pos.add(dir.mul(spawnOffset));

        // Build nested payload structure (each layer becomes the next payload)
        let payload = buildPayloadChain(payloadLayers, stack, baseDmg, basePower);

        Game.projectiles.push(new Projectile(spawnPos.x, spawnPos.y, {
            // Use stack elements, or empty for circle-only casts (neutral projectile)
            elements: stack,
            spectrum: spectrum,
            physics: physics,
            damage: finalDamage,
            pierce: spectrumConfig.pierce,      // How many enemies to pass through
            rad: projRadius,
            vel: dir.norm().mul(speed),
            power: basePower, // Power determines max travel distance
            owner: Game.player, // Track who cast it for self-hit logic
            payload: payload
        }));

        // Stamina cost (flat - power costs extra mana instead)
        Game.player.stm = Math.max(0, Game.player.stm - 5);
    });

    // Reset nodes
    Magic.nodes.forEach(n => n.used = false);

    // Muzzle flash (spawn at new offset position)
    for (let i = 0; i < 10; i++) {
        Game.parts.push(new Particle(
            Game.player.pos.x + Input.aim.x * Config.ProjectileSpawnOffset,
            Game.player.pos.y + Input.aim.y * Config.ProjectileSpawnOffset,
            '#ffaa00'
        ));
    }
}


/**
 * Build a chain of payloads from remaining circle layers
 * Each layer activation spawns circles from that layer with the NEXT layer as their payload
 * 
 * Spectrum is calculated at ACTIVATION time using inherited power + stored radius
 * This allows multi-stage combos: CANNON -> NEEDLE shards, etc.
 */
function buildPayloadChain(remainingLayers, elements, totalDamage, parentPower) {
    if (remainingLayers.length === 0) return [];

    let currentLayer = remainingLayers[0];
    let nextLayers = remainingLayers.slice(1);
    let splitCount = currentLayer.length;
    let damagePerShard = totalDamage / splitCount;
    // Power is split among shards (minimum ensures some power remains)
    let powerPerShard = Math.max(parentPower / splitCount, Config.BasePower / 2);

    let payload = [];

    currentLayer.forEach(circle => {
        let relAngle = 0;
        if (circle.runes && circle.runes.length > 0) {
            relAngle = circle.runes[0] - (-Math.PI / 2);
        }

        // Store circle radius - spectrum will be calculated at activation time
        payload.push({
            relAngle: relAngle,
            circleRadius: circle.rad,       // Original circle radius for spectrum calc
            baseDamage: damagePerShard,     // Base damage before spectrum modifier
            inheritedPower: powerPerShard,  // Power inherited from parent for spectrum calc
            hasMorePayloads: nextLayers.length > 0,
            // Recursively build the next layer's payload
            nestedPayload: buildPayloadChain(nextLayers, elements, damagePerShard, powerPerShard)
        });
    });

    return payload;
}


/**
 * Cast Base Magic - Fallback for failed/incomplete casts
 * Fires a small, weak projectile with no elemental effects
 */
function castBaseMagic() {
    let dir = Input.aim;
    let spawnOffset = Config.ProjectileSpawnOffset;
    let spawnPos = Game.player.pos.add(dir.mul(spawnOffset));

    // Create base magic projectile
    Game.projectiles.push(new Projectile(spawnPos.x, spawnPos.y, {
        elements: [], // No elements - pure base magic
        physics: 'BLUNT', // Small circle shape
        damage: Config.BaseMagic.damage,
        rad: Config.BaseMagic.radius,
        vel: dir.norm().mul(Config.BaseMagic.speed),
        power: Config.BaseMagic.power,
        owner: Game.player,
        payload: null
    }));

    // Small stamina cost
    Game.player.stm = Math.max(0, Game.player.stm - 2);

    // Weak muzzle flash (gray particles)
    for (let i = 0; i < 5; i++) {
        let p = new Particle(
            Game.player.pos.x + dir.x * spawnOffset,
            Game.player.pos.y + dir.y * spawnOffset,
            Config.BaseMagic.color
        );
        p.vel = dir.mul(50).add(Vec2.fromAngle(Math.random() * Math.PI * 2).mul(30));
        Game.parts.push(p);
    }
}

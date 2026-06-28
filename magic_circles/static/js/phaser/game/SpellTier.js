/**
 * SpellTier — Pure scoring layer for magic casts.
 * Reads composition → returns tier label + mana/cooldown balance.
 * Does NOT touch damage values.
 */

const SPECTRUM_CEILING = {
    FLICKER: 0.3, DART: 1.0, WAVE: 1.2, BURST: 1.6, BOULDER: 1.4,
    BEAM: 1.8, LANCE: 2.2, NEEDLE: 2.0, CANNON: 2.0, NOVA: 3.0
};

// Descending order; first match wins.
const TIER_CUTOFFS = [
    ['SSS', 2000], ['SS', 1300], ['S', 850], ['A', 550],
    ['B', 300],   ['C', 150],  ['D', 60],  ['E', 0]
];

function computeThreatScore({ basePower, spectrum, uniqueElements, payloadLayers, circleCount, stability }) {
    const ceiling     = SPECTRUM_CEILING[spectrum] || 1.0;
    const diversity   = 1 + 0.2  * Math.max(0, (uniqueElements || 0) - 1);
    const payloadMult = 1 + 0.5  * (payloadLayers || 0);
    const multishot   = 1 + 0.35 * Math.max(0, (circleCount || 1) - 1);
    const harmonyQ    = 0.5 + 0.5 * (Number.isFinite(stability) ? Math.max(0, Math.min(1, stability)) : 1);
    const power       = Number.isFinite(basePower) ? basePower : 0;
    return power * ceiling * diversity * payloadMult * multishot * harmonyQ;
}

function scoreToTier(score) {
    for (let i = 0; i < TIER_CUTOFFS.length; i++) {
        const [tier, cutoff] = TIER_CUTOFFS[i];
        if (score >= cutoff) {
            // index 0 = E (cheapest), 7 = SSS (most expensive)
            return { tier, index: TIER_CUTOFFS.length - 1 - i, score };
        }
    }
    return { tier: 'E', index: 0, score };
}

function tierBalance(index) {
    return {
        manaMult: Math.pow(1.4, index),         // 1× at E, ~10.5× at SSS
        cooldown: 0.5 + 0.6 * index             // 0.5s at E, ~4.7s at SSS
    };
}

const TIER_COLORS = {
    SSS: '#ff4444', SS: '#ff8844', S: '#ffdd44',
    A:   '#88ff44', B:  '#44ffdd', C: '#44aaff',
    D:   '#8888ff', E:  '#888888'
};

/* ============================================================
   VELL — content definitions: the Bloom, the Weave, the Rust
   ============================================================ */
(function (TD) {
  'use strict';

  var D = TD.defs = {};

  /* ---------------- towers: THE BLOOM ---------------- */
  /* model: how build.js grows the mesh
     stats: range (world units), dmg, rate (shots/sec), and modifiers      */
  var TOWERS = {
    sporecap: {
      name: 'Sporecap', kind: 'tower', tier: 1, cost: 45,
      desc: 'A pale cap that coughs a hardened spore-dart. Everything the Bloom knows starts here.',
      color: 0xcfe0c0, glow: 0x7fe6b4,
      model: { base: 'stalk', head: 'cap', arms: 0, headScale: 1.0 },
      stats: { range: 9.5, dmg: 10, rate: 1.15, proj: 'dart', projSpeed: 26 },
      children: ['thornspire', 'mistcap', 'glowpod']
    },

    /* --- thorn line: single-target puncture --- */
    thornspire: {
      name: 'Thornspire', kind: 'tower', tier: 2, cost: 0,
      desc: 'The cap hardens into lignin and learns to aim. Fast, ugly, effective.',
      color: 0x9fae86, glow: 0xd8f07a,
      model: { base: 'stalk', head: 'cone', arms: 3, headScale: 1.1 },
      stats: { range: 11, dmg: 20, rate: 1.7, proj: 'thorn', projSpeed: 40, pierceArmor: 0.25 },
      children: ['bramblelance', 'ironbriar']
    },
    bramblelance: {
      name: 'Bramblelance', kind: 'tower', tier: 3, cost: 0,
      desc: 'Fires a running length of bramble that skewers a whole file of them at once.',
      color: 0x8ea079, glow: 0xe4ff8a,
      model: { base: 'stalk', head: 'lance', arms: 4, headScale: 1.2 },
      stats: { range: 14, dmg: 38, rate: 1.15, proj: 'lance', projSpeed: 52, pierce: 5, pierceArmor: 0.35 },
      children: ['worldthorn']
    },
    ironbriar: {
      name: 'Ironbriar', kind: 'tower', tier: 3, cost: 0,
      desc: 'Draws iron out of the peat and grows it into a single, patient spike.',
      color: 0x7d8878, glow: 0xffc46a,
      model: { base: 'trunk', head: 'spike', arms: 2, headScale: 1.35 },
      stats: { range: 22, dmg: 165, rate: 0.36, proj: 'spike', projSpeed: 90, pierceArmor: 0.6, stagger: 0.35 },
      children: ['sovereign_briar']
    },
    worldthorn: {
      name: 'Worldthorn', kind: 'tower', tier: 4, cost: 0,
      desc: 'Roots reach the old rails and use them as a rack. The lance no longer stops for bodies.',
      color: 0x94a884, glow: 0xf2ff9c,
      model: { base: 'trunk', head: 'lance', arms: 6, headScale: 1.5 },
      stats: { range: 17, dmg: 78, rate: 1.35, proj: 'lance', projSpeed: 64, pierce: 12, pierceArmor: 0.5 },
      children: []
    },
    sovereign_briar: {
      name: 'Sovereign Briar', kind: 'tower', tier: 4, cost: 0,
      desc: 'One shot, delivered with the unhurried certainty of geology.',
      color: 0x6f7c6d, glow: 0xffb04a,
      model: { base: 'trunk', head: 'spike', arms: 4, headScale: 1.8 },
      stats: { range: 27, dmg: 520, rate: 0.30, proj: 'spike', projSpeed: 120, pierceArmor: 0.85, splash: 2.2, stagger: 0.6 },
      children: []
    },

    /* --- mist line: area, rot, slow --- */
    mistcap: {
      name: 'Mistcap', kind: 'tower', tier: 2, cost: 0,
      desc: 'Lobs a wet sac of spores. The Rust hates damp; damp is how the Bloom took the moor.',
      color: 0xa9bcc2, glow: 0x86e0d8,
      model: { base: 'stalk', head: 'bulb', arms: 0, headScale: 1.3 },
      stats: { range: 9.5, dmg: 15, rate: 0.95, proj: 'sac', projSpeed: 18, splash: 2.6, slow: 0.22, slowTime: 1.6 },
      children: ['fogbloom', 'rotmoor']
    },
    fogbloom: {
      name: 'Fogbloom', kind: 'tower', tier: 3, cost: 0,
      desc: 'Vents a low, crawling fog that finds the gaps in their plating.',
      color: 0x9ec4c8, glow: 0x6fe8dc,
      model: { base: 'stalk', head: 'bulb', arms: 3, headScale: 1.6 },
      stats: { range: 11.5, dmg: 34, rate: 0.85, proj: 'sac', projSpeed: 20, splash: 3.8, slow: 0.30, slowTime: 2.0 },
      children: ['miasma_choir']
    },
    rotmoor: {
      name: 'Rotmoor', kind: 'tower', tier: 3, cost: 0,
      desc: 'No projectile. It simply makes the ground around it hostile to metal.',
      color: 0x7d8f74, glow: 0x9cf07a,
      model: { base: 'stump', head: 'ring', arms: 5, headScale: 1.4 },
      stats: { range: 8.5, dmg: 26, rate: 2.2, proj: 'aura', dot: 22, dotTime: 3.0, slow: 0.18, slowTime: 1.2 },
      children: ['grave_lily']
    },
    miasma_choir: {
      name: 'Miasma Choir', kind: 'tower', tier: 4, cost: 0,
      desc: 'Three caps singing on the same note. The fog answers with a shape of its own.',
      color: 0xa8cdd2, glow: 0x5cf0e0,
      model: { base: 'trunk', head: 'bulb', arms: 6, headScale: 1.9 },
      stats: { range: 13.5, dmg: 96, rate: 0.9, proj: 'sac', projSpeed: 24, splash: 5.2, slow: 0.42, slowTime: 2.6, dot: 30, dotTime: 3.0 },
      children: []
    },
    grave_lily: {
      name: 'Grave Lily', kind: 'tower', tier: 4, cost: 0,
      desc: 'Flowers only on ground where something has already died. It is rarely short of ground.',
      color: 0x86a07e, glow: 0xb4ff70,
      model: { base: 'stump', head: 'ring', arms: 8, headScale: 2.0 },
      stats: { range: 11.5, dmg: 82, rate: 2.4, proj: 'aura', dot: 74, dotTime: 3.5, slow: 0.32, slowTime: 1.6 },
      children: []
    },

    /* --- light line: chain, beam --- */
    glowpod: {
      name: 'Glowpod', kind: 'tower', tier: 2, cost: 0,
      desc: 'Stores three centuries of swamp-light and gives it back all at once.',
      color: 0xbfe3d8, glow: 0x53e6ff,
      model: { base: 'stalk', head: 'crystal', arms: 0, headScale: 1.15 },
      stats: { range: 10, dmg: 13, rate: 1.35, proj: 'arc', chain: 3, chainRange: 5.5, chainFalloff: 0.72 },
      children: ['arcbloom', 'stormcap']
    },
    arcbloom: {
      name: 'Arcbloom', kind: 'tower', tier: 3, cost: 0,
      desc: 'The arc has learned to prefer company.',
      color: 0xa9d8ea, glow: 0x3fd0ff,
      model: { base: 'stalk', head: 'crystal', arms: 4, headScale: 1.45 },
      stats: { range: 12, dmg: 32, rate: 1.25, proj: 'arc', chain: 6, chainRange: 6.5, chainFalloff: 0.80 },
      children: ['aurora_crown']
    },
    stormcap: {
      name: 'Stormcap', kind: 'tower', tier: 3, cost: 0,
      desc: 'A continuous thread of light. Cheap per shot; there are simply a great many shots.',
      color: 0xc8d8f0, glow: 0x9ea8ff,
      model: { base: 'stalk', head: 'crystal', arms: 2, headScale: 1.2 },
      stats: { range: 11, dmg: 16, rate: 5.0, proj: 'beam', pierceArmor: 0.3 },
      children: ['solstice_beacon']
    },
    aurora_crown: {
      name: 'Aurora Crown', kind: 'tower', tier: 4, cost: 0,
      desc: 'Night-coloured light that bends between bodies and leaves them slow and singing.',
      color: 0xbfe8ff, glow: 0x66ffd8,
      model: { base: 'trunk', head: 'crystal', arms: 8, headScale: 1.9 },
      stats: { range: 15, dmg: 88, rate: 1.2, proj: 'arc', chain: 10, chainRange: 8, chainFalloff: 0.88, slow: 0.3, slowTime: 1.4 },
      children: []
    },
    solstice_beacon: {
      name: 'Solstice Beacon', kind: 'tower', tier: 4, cost: 0,
      desc: 'It keeps a small, private noon inside itself and shares it with anything that walks close.',
      color: 0xffeec8, glow: 0xffd25a,
      model: { base: 'trunk', head: 'crystal', arms: 5, headScale: 1.7 },
      stats: { range: 13, dmg: 54, rate: 6.0, proj: 'beam', pierceArmor: 0.55, dot: 26, dotTime: 2.0 },
      children: []
    }
  };

  /* ---------------- traps: THE WEAVE (walkable) ---------------- */
  var TRAPS = {
    sporemat: {
      name: 'Sporemat', kind: 'trap', tier: 1, cost: 25,
      desc: 'A soft mat of mycelium. It does almost nothing, patiently.',
      color: 0x6f8f6a, glow: 0x8ce6a0,
      model: { pattern: 'mat' },
      stats: { slow: 0.22, dmg: 4, tick: 0.5 },
      children: ['tarvine', 'emberpeat', 'wisplight']
    },
    tarvine: {
      name: 'Tarvine', kind: 'trap', tier: 2, cost: 0,
      desc: 'Peat-tar and creeper. Legs go in easily and leave slowly.',
      color: 0x3c3a30, glow: 0x7ad090,
      model: { pattern: 'vine' },
      stats: { slow: 0.46, dmg: 9, tick: 0.5 },
      children: ['snarelace', 'gravebind']
    },
    snarelace: {
      name: 'Snarelace', kind: 'trap', tier: 3, cost: 0,
      desc: 'Fine enough to be invisible, strong enough to hold a walker at the knee.',
      color: 0x4a5a44, glow: 0x9cffb4,
      model: { pattern: 'vine' },
      stats: { slow: 0.66, dmg: 20, tick: 0.45, rootChance: 0.16, rootTime: 0.8 },
      children: ['deeproot_maw']
    },
    gravebind: {
      name: 'Gravebind', kind: 'trap', tier: 3, cost: 0,
      desc: 'Grips once, hard, and takes a toll for letting go.',
      color: 0x3a3838, glow: 0xc8ff8a,
      model: { pattern: 'maw' },
      stats: { slow: 0.34, dmg: 62, tick: 1.2, rootChance: 0.45, rootTime: 1.2 },
      children: ['barrow_mouth']
    },
    deeproot_maw: {
      name: 'Deeproot Maw', kind: 'trap', tier: 4, cost: 0,
      desc: 'The lace goes all the way down now, and something down there pulls back.',
      color: 0x44543e, glow: 0x8affc0,
      model: { pattern: 'maw' },
      stats: { slow: 0.78, dmg: 62, tick: 0.4, rootChance: 0.3, rootTime: 1.3 },
      children: []
    },
    barrow_mouth: {
      name: 'Barrow Mouth', kind: 'trap', tier: 4, cost: 0,
      desc: 'An old grave, reopened for business.',
      color: 0x2e2c2c, glow: 0xd8ff7a,
      model: { pattern: 'maw' },
      stats: { slow: 0.4, dmg: 230, tick: 1.1, rootChance: 0.7, rootTime: 1.6 },
      children: []
    },
    emberpeat: {
      name: 'Emberpeat', kind: 'trap', tier: 2, cost: 0,
      desc: 'Dried peat with a smoulder kept alive underneath. Steps on it ignite.',
      color: 0x5a3524, glow: 0xff8a3a,
      model: { pattern: 'ember' },
      stats: { dmg: 14, tick: 0.6, burn: 16, burnTime: 3.0 },
      children: ['cinderbog', 'pyremoor']
    },
    cinderbog: {
      name: 'Cinderbog', kind: 'trap', tier: 3, cost: 0,
      desc: 'The fire has learned to travel with them instead of waiting.',
      color: 0x6a3a20, glow: 0xff7a24,
      model: { pattern: 'ember' },
      stats: { dmg: 26, tick: 0.5, burn: 52, burnTime: 4.0, spread: 1 },
      children: ['ashen_fen']
    },
    pyremoor: {
      name: 'Pyremoor', kind: 'trap', tier: 3, cost: 0,
      desc: 'Holds its breath until something heavy is standing directly on top of it.',
      color: 0x7a3018, glow: 0xffb03a,
      model: { pattern: 'ember' },
      stats: { dmg: 130, tick: 1.5, burn: 26, burnTime: 2.5, blast: 2.4 },
      children: ['pyre_heart']
    },
    ashen_fen: {
      name: 'Ashen Fen', kind: 'trap', tier: 4, cost: 0,
      desc: 'Nothing grows here on purpose. That is the point of it.',
      color: 0x4c4a46, glow: 0xff9a2a,
      model: { pattern: 'ember' },
      stats: { dmg: 96, tick: 0.4, burn: 180, burnTime: 5.0, spread: 1 },
      children: []
    },
    pyre_heart: {
      name: 'Pyre Heart', kind: 'trap', tier: 4, cost: 0,
      desc: 'A buried furnace, fed on rust and impatience.',
      color: 0x8a2c10, glow: 0xffd06a,
      model: { pattern: 'ember' },
      stats: { dmg: 620, tick: 1.6, burn: 80, burnTime: 3.0, blast: 4.0 },
      children: []
    },
    wisplight: {
      name: 'Wisplight', kind: 'trap', tier: 2, cost: 0,
      desc: 'Shines like an open gate. The Rust navigates by light, which was always going to be a mistake.',
      color: 0x2f5a5e, glow: 0x6ff0ff,
      model: { pattern: 'wisp' },
      stats: { dmg: 6, tick: 0.7, vuln: 0.25, vulnTime: 2.5, lure: 1 },
      children: ['beguiling_lantern', 'hollow_choir']
    },
    beguiling_lantern: {
      name: 'Beguiling Lantern', kind: 'trap', tier: 3, cost: 0,
      desc: 'They stop to look at it. Everything else on the moor takes advantage of that.',
      color: 0x2a6a6e, glow: 0x8affff,
      model: { pattern: 'wisp' },
      stats: { dmg: 12, tick: 0.6, vuln: 0.45, vulnTime: 3.0, slow: 0.3, lure: 1 },
      children: ['lantern_of_vell']
    },
    hollow_choir: {
      name: 'Hollow Choir', kind: 'trap', tier: 3, cost: 0,
      desc: 'Plays back the sound a foundry makes when it is happy. They cannot help but answer.',
      color: 0x3a4a68, glow: 0xb0a0ff,
      model: { pattern: 'wisp' },
      stats: { dmg: 34, tick: 0.8, vuln: 0.35, vulnTime: 2.5, fear: 1, lure: 1 },
      children: ['choir_eternal']
    },
    lantern_of_vell: {
      name: 'Lantern of Vell', kind: 'trap', tier: 4, cost: 0,
      desc: 'The last light the Wardens hung, relit by a colony that never stopped tending it.',
      color: 0x2f8f92, glow: 0xa8ffff,
      model: { pattern: 'wisp' },
      stats: { dmg: 44, tick: 0.5, vuln: 0.75, vulnTime: 4.0, slow: 0.45, lure: 1 },
      children: []
    },
    choir_eternal: {
      name: 'Choir Eternal', kind: 'trap', tier: 4, cost: 0,
      desc: 'It knows every voice the Foundry ever had, including the ones it buried.',
      color: 0x4a5a88, glow: 0xd0c0ff,
      model: { pattern: 'wisp' },
      stats: { dmg: 120, tick: 0.7, vuln: 0.6, vulnTime: 3.5, fear: 1, lure: 1 },
      children: []
    }
  };

  /* ---------------- walls: THE BULWARK ---------------- */
  var WALLS = {
    palisade: {
      name: 'Palisade', kind: 'wall', tier: 1, cost: 18,
      desc: 'Woven stalks, hardened with sap. It buys seconds, and seconds compound.',
      color: 0x8a7a55, glow: 0x9ad8a0,
      model: { style: 'wood' },
      stats: { hp: 260 },
      children: ['heartwood']
    },
    heartwood: {
      name: 'Heartwood Bulwark', kind: 'wall', tier: 2, cost: 0,
      desc: 'Dense enough to blunt an axe-arm, and it grows its own splinters back.',
      color: 0x6f5f42, glow: 0xa8ff9c,
      model: { style: 'wood' },
      stats: { hp: 1100, thorns: 12 },
      children: ['stonebound']
    },
    stonebound: {
      name: 'Stonebound Wall', kind: 'wall', tier: 3, cost: 0,
      desc: 'Roots have pulled the moor\'s old kerbstones up and set them by hand.',
      color: 0x8d8d88, glow: 0x9cf0c0,
      model: { style: 'stone' },
      stats: { hp: 4200, thorns: 48 },
      children: ['petrified_gate']
    },
    petrified_gate: {
      name: 'Petrified Gate', kind: 'wall', tier: 4, cost: 0,
      desc: 'Not a wall so much as a decision the ground has made.',
      color: 0xa0a49c, glow: 0x7fffd0,
      model: { style: 'stone' },
      stats: { hp: 16000, thorns: 210 },
      children: []
    }
  };

  var ALL = {};
  var k;
  for (k in TOWERS) { TOWERS[k].id = k; TOWERS[k].kind = 'tower'; ALL[k] = TOWERS[k]; }
  for (k in TRAPS) { TRAPS[k].id = k; TRAPS[k].kind = 'trap'; ALL[k] = TRAPS[k]; }
  for (k in WALLS) { WALLS[k].id = k; WALLS[k].kind = 'wall'; ALL[k] = WALLS[k]; }

  D.towers = TOWERS; D.traps = TRAPS; D.walls = WALLS; D.all = ALL;
  D.roots = { tower: 'sporecap', trap: 'sporemat', wall: 'palisade' };
  D.get = function (id) { return ALL[id]; };

  D.ASCEND = ['Elder', 'Ancient', 'Primeval', 'Hallowed', 'Eternal', 'Mythic', 'Undying', 'Firstborn'];

  D.displayName = function (s) {
    var base = ALL[s.type].name;
    if (!s.asc) return base;
    var pre = D.ASCEND[Math.min(s.asc - 1, D.ASCEND.length - 1)];
    if (s.asc > D.ASCEND.length) pre += ' ' + TD.util.roman(s.asc - D.ASCEND.length + 1);
    return pre + ' ' + base;
  };

  /* level → stat multiplier (indefinite growth) */
  D.levelMult = function (level, asc) {
    return Math.pow(1.135, level - 1) * Math.pow(1.55, asc || 0);
  };

  D.statsFor = function (s) {
    var def = ALL[s.type];
    var m = D.levelMult(s.level, s.asc);
    var out = {};
    for (var key in def.stats) {
      var v = def.stats[key];
      if (typeof v !== 'number') { out[key] = v; continue; }
      if (key === 'dmg' || key === 'hp' || key === 'dot' || key === 'burn' || key === 'thorns') out[key] = v * m;
      else if (key === 'range' || key === 'splash' || key === 'blast' || key === 'chainRange') out[key] = v * (1 + Math.log(1 + (s.level - 1) * 0.34 + (s.asc || 0) * 1.2) * 0.16);
      else if (key === 'rate') out[key] = v * (1 + Math.min(0.9, (s.level - 1) * 0.012));
      else if (key === 'slow' || key === 'vuln') out[key] = Math.min(0.88, v * (1 + (s.level - 1) * 0.012));
      else out[key] = v;
    }
    out.proj = def.stats.proj;
    return out;
  };

  D.upgradeCost = function (s) {
    var def = ALL[s.type];
    var root = D.rootCost(def.kind);
    var c = root * 0.75 * Math.pow(1.19, s.level) * Math.pow(2.1, s.asc || 0);
    if ((s.level + 1) % 10 === 0) c *= 2.4;   // promotion level costs more
    return Math.ceil(c);
  };
  D.rootCost = function (kind) { return ALL[D.roots[kind]].cost; };
  D.sellValue = function (s) {
    var spent = D.rootCost(ALL[s.type].kind);
    for (var l = 1; l < s.level; l++) spent += Math.ceil(D.rootCost(ALL[s.type].kind) * 0.75 * Math.pow(1.19, l));
    return Math.ceil(spent * 0.55);
  };

  /* what happens when a structure hits a multiple of 10 */
  D.promotionOptions = function (s) {
    var def = ALL[s.type];
    if (def.children && def.children.length) {
      return def.children.map(function (id) { return ALL[id]; });
    }
    return null; // → ascension
  };

  /* ---------------- enemies: THE RUST ---------------- */
  D.enemies = {
    rustling: {
      name: 'Rustling', hp: 70, speed: 2.4, armor: 0.06, dmg: 10, bounty: 9, size: 0.42,
      color: 0x8a4a2c, glow: 0xff6a2a, shape: 'walker',
      desc: 'A field-hand chassis, re-tasked. Most of it is still shovel.'
    },
    skitter: {
      name: 'Skitter', hp: 44, speed: 4.4, armor: 0.0, dmg: 6, bounty: 7, size: 0.32,
      color: 0x6a3a3a, glow: 0xff9a3a, shape: 'skitter',
      desc: 'Six legs, no torso, no patience. Scouts the shallows for a crossing.'
    },
    hulk: {
      name: 'Slaghulk', hp: 340, speed: 1.5, armor: 0.42, dmg: 38, bounty: 26, size: 0.72,
      color: 0x5a4a44, glow: 0xff5a1a, shape: 'hulk',
      desc: 'Poured, not built. It walks like the ground owes it money.'
    },
    sapper: {
      name: 'Sapper', hp: 150, speed: 2.6, armor: 0.12, dmg: 60, bounty: 18, size: 0.46,
      color: 0x77552a, glow: 0xffc03a, shape: 'walker', structFirst: true,
      desc: 'Carries a cutting arm and a grudge against anything the Bloom has grown.'
    },
    wader: {
      name: 'Wader', hp: 120, speed: 2.9, armor: 0.10, dmg: 16, bounty: 15, size: 0.5,
      color: 0x3a6a68, glow: 0x4ad0ff, shape: 'wader', amphibious: true,
      desc: 'Long-legged dredger. The shallows slow everything else; they do not slow this.'
    },
    corrosite: {
      name: 'Corrosite', hp: 210, speed: 1.9, armor: 0.2, dmg: 12, bounty: 30, size: 0.55,
      color: 0x6a5a80, glow: 0xc06aff, shape: 'orb', healer: 26, healRange: 7,
      desc: 'Sprays a fixative that welds its neighbours back together mid-stride.'
    },
    warden: {
      name: 'Foundry Warden', hp: 3200, speed: 1.45, armor: 0.5, dmg: 220, bounty: 240, size: 1.15,
      color: 0x4a4a52, glow: 0xff3a10, shape: 'boss', boss: true, spawnOnDeath: 'rustling',
      desc: 'A shift supervisor that never clocked out. Its harness is fastened from the inside.'
    }
  };

  /* ---------------- waves ---------------- */
  D.waveComp = function (w) {
    var out = [];
    var pool = [];
    pool.push({ type: 'rustling', n: 5 + Math.floor(w * 1.6) });
    if (w >= 2) pool.push({ type: 'skitter', n: 2 + Math.floor(w * 1.1) });
    if (w >= 4) pool.push({ type: 'wader', n: 1 + Math.floor(w * 0.5) });
    if (w >= 5) pool.push({ type: 'hulk', n: 1 + Math.floor(w * 0.35) });
    if (w >= 7) pool.push({ type: 'sapper', n: 1 + Math.floor(w * 0.3) });
    if (w >= 9) pool.push({ type: 'corrosite', n: Math.floor(w * 0.22) });
    if (w % 5 === 0) pool.push({ type: 'warden', n: Math.max(1, Math.floor(w / 10)) });
    for (var i = 0; i < pool.length; i++) if (pool[i].n > 0) out.push(pool[i]);
    return out;
  };

  D.waveScale = function (w) {
    return {
      hp: Math.pow(1.185, w - 1) * (1 + w * 0.06),
      speed: 1 + Math.min(0.55, w * 0.012),
      bounty: Math.pow(1.055, w - 1)
    };
  };

  /* ---------------- story ---------------- */
  D.story = {
    title: 'VELL',
    sub: 'the shallows remember',
    intro: [
      'Three hundred years ago the Foundry drained the moor of Vell to get at the ore beneath it, and when the ore ran out they left the pumps running and walked away.',
      'The pumps failed. The water came back. It came back over the rails, the kilns, the ledger-houses and the men who stayed to watch them — and in the warm dark underneath it, something began to think.',
      'You are the Heartspore: one colony, one mind, rooted at the centre of the shallows. Above you the Bloom grows what you ask it to grow — caps that spit, thorns that skewer, mats of quiet mycelium laid across the fording-places.',
      'And out at the map\'s edge, in the flooded foundries, the Rust has finished waking up. It is walking home. Home is you.'
    ],
    rules: [
      'Shallow water and open ground are walkable — for you and for them.',
      'You may shape the route with Towers and Walls, but you may never seal it: the Rust must always have a way through.',
      'Traps lie flat in the path. Enemies walk over them willingly.',
      'Every 10th level a structure promotes and you choose what it becomes. There is no final level.'
    ]
  };

})(window.TD);

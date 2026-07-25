/* ============================================================
   VELL — bootstrap and game loop
   ============================================================ */
(function (TD) {
  'use strict';

  var game = TD.game = {};
  var renderer, scene, camera, canvas;
  var quality, qname;
  var ghost = null, ghostKind = null;
  var highlight = null, rangeRing = null;
  var clock = null;
  var DAY_SECONDS = 210;
  var waveTimer = 0, betweenWaves = true;
  var fpsAcc = 0, fpsFrames = 0, fpsTime = 0;
  var reflectTick = 0;

  /* ---------------- boot ---------------- */
  function step(fn, p, label, next) {
    TD.ui.bootProgress(p, label);
    setTimeout(function () { fn(); if (next) next(); }, 16);
  }

  game.boot = function () {
    canvas = document.getElementById('game-canvas');
    qname = TD.detectQuality();
    quality = TD.QUALITY[qname];
    TD.state.quality = qname;
    TD.state.seed = (Math.random() * 0x7fffffff) | 0;

    TD.ui.init();
    TD.ui.bootProgress(0.05, 'waking the colony…');

    renderer = new THREE.WebGLRenderer({
      canvas: canvas, antialias: qname !== 'low', powerPreference: 'high-performance',
      alpha: false, stencil: false
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    if (quality.shadows) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 700);
    game.scene = scene; game.camera = camera; game.renderer = renderer;

    var chain = [
      ['reading the moor…', function () { TD.terrain.generate(scene, TD.state.seed); }],
      ['finding the fording places…', function () { TD.path.init(); TD.path.reserveCorridors(); }],
      ['seeding the groves…', function () { TD.props.build(scene, TD.state.seed, quality); TD.path.rebuild(); }],
      ['letting the water back in…', function () { TD.water.build(scene, renderer, quality); }],
      ['hanging the sky…', function () { TD.sky.build(scene, quality); }],
      ['stirring the spores…', function () { TD.fx.init(scene, quality); TD.build.init(scene); TD.enemies.init(scene); }],
      ['tuning the instruments…', function () { TD.audio.init(); }],
      ['rooting the Heartspore…', function () { setupHelpers(); TD.input.init(camera, canvas); }]
    ];

    var i = 0;
    (function run() {
      if (i >= chain.length) {
        TD.ui.bootProgress(1, 'ready');
        setTimeout(function () {
          TD.ui.hideBoot();
          TD.ui.showIntro();
        }, 260);
        return;
      }
      var c = chain[i];
      TD.ui.bootProgress(0.1 + i / chain.length * 0.85, c[0]);
      setTimeout(function () { c[1](); i++; run(); }, 24);
    })();

    window.addEventListener('resize', onResize);
    wireEvents();
  };

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /* ---------------- helpers: ghost, highlight, range ---------------- */
  function setupHelpers() {
    var g = new THREE.PlaneGeometry(TD.CELL * 0.98, TD.CELL * 0.98);
    g.rotateX(-Math.PI / 2);
    highlight = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      color: TD.C(0x7cffd8), transparent: true, opacity: 0.28, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false
    }));
    highlight.visible = false;
    highlight.renderOrder = 5;
    scene.add(highlight);

    var rg = new THREE.RingGeometry(0.97, 1.0, 64);
    rg.rotateX(-Math.PI / 2);
    rangeRing = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({
      color: TD.C(0x9dffe0), transparent: true, opacity: 0.45, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false
    }));
    rangeRing.visible = false;
    rangeRing.renderOrder = 5;
    scene.add(rangeRing);
  }

  function setGhost(kind) {
    if (ghost) { scene.remove(ghost); ghost = null; }
    ghostKind = kind;
    if (!kind || kind === 'inspect') return;
    ghost = TD.build.makeGhost(kind);
    ghost.visible = false;
    scene.add(ghost);
  }

  function placeHighlight(x, z, ok) {
    var wx = TD.cellToWorldX(x), wz = TD.cellToWorldZ(z);
    var wy = Math.max(TD.terrain.heightAt(wx, wz), TD.WATER_Y - 0.1);
    highlight.position.set(wx, wy + 0.09, wz);
    highlight.quaternion.copy(TD.props.alignQuat(wx, wz, 1.0, 0));
    highlight.material.color.copy(TD.C(ok ? 0x7cffd8 : 0xff6a5a));
    highlight.visible = true;
    if (ghost) {
      ghost.position.set(wx, wy, wz);
      ghost.quaternion.copy(TD.props.alignQuat(wx, wz, ghostKind === 'trap' ? 1.0 : 0.55, 0));
      ghost.visible = true;
      ghost.traverse(function (o) {
        if (o.isMesh && o.material) o.material.opacity = ok ? 0.6 : 0.28;
      });
    }
    // preview the range while placing a tower
    if (ghostKind === 'tower') {
      var r = TD.defs.get(TD.defs.roots.tower).stats.range;
      rangeRing.position.set(wx, wy + 0.12, wz);
      rangeRing.scale.set(r, 1, r);
      rangeRing.material.color.copy(TD.C(ok ? 0x9dffe0 : 0xff8a7a));
      rangeRing.visible = true;
    } else if (!TD.ui.selected) {
      rangeRing.visible = false;
    }
  }

  function clearHighlight() {
    highlight.visible = false;
    if (ghost) ghost.visible = false;
    if (!TD.ui.selected) rangeRing.visible = false;
  }

  function showRangeFor(s) {
    if (!s || s.kind !== 'tower') { rangeRing.visible = false; return; }
    rangeRing.position.set(s.wx, s.wy + 0.14, s.wz);
    rangeRing.scale.set(s.stats.range, 1, s.stats.range);
    rangeRing.material.color.copy(TD.C(0x9dffe0));
    rangeRing.visible = true;
  }

  /* ---------------- interaction ---------------- */
  function wireEvents() {
    TD.bus.on('startGame', startGame);
    TD.bus.on('modeChanged', function (mode) {
      setGhost(mode === 'inspect' ? null : mode);
      clearHighlight();
      TD.ui.hideConfirm();
      TD.ui.setHint(mode === 'inspect'
        ? 'Tap a structure to inspect it, or a relic to read it.'
        : 'Tap where it should grow. Tap again to confirm.');
    });

    TD.bus.on('hover', function (c) {
      if (!c || TD.ui.mode === 'inspect') { if (TD.ui.mode === 'inspect') clearHighlight(); return; }
      var chk = TD.build.canPlace(TD.ui.mode, c.x, c.z);
      placeHighlight(c.x, c.z, chk.ok);
    });

    TD.bus.on('tap', function (c) {
      if (TD.state.over) return;
      if (TD.ui.mode === 'inspect') {
        var s = TD.build.structAt(c.x, c.z);
        if (s) { TD.ui.select(s); showRangeFor(s); TD.audio.play('ui'); return; }
        var lore = TD.props.loreAt(c.x, c.z);
        if (lore) { TD.ui.unlockLore(lore.def); return; }
        TD.ui.closePanel();
        rangeRing.visible = false;
        return;
      }
      // build modes
      var pend = TD.ui.pendingCell;
      var chk = TD.build.canPlace(TD.ui.mode, c.x, c.z);
      var hoverMatch = (TD.input.hoverCell.x === c.x && TD.input.hoverCell.z === c.z);
      if ((pend && pend.x === c.x && pend.z === c.z) || hoverMatch) {
        doBuild(c);
      } else {
        TD.ui.showConfirm({ x: c.x, z: c.z }, chk.ok, chk.why);
        placeHighlight(c.x, c.z, chk.ok);
        if (!chk.ok) TD.bus.emit('toast', { text: chk.why, bad: true });
      }
    });

    TD.bus.on('confirmBuild', function (c) { doBuild(c); });
    TD.bus.on('cancelBuild', function () { clearHighlight(); });
    TD.bus.on('selected', function (s) { showRangeFor(s); });
    TD.bus.on('callWave', function () {
      if (TD.state.over) return;
      if (TD.state.waveActive) { TD.bus.emit('toast', { text: 'The wave is still walking.', bad: true }); return; }
      var bonus = Math.ceil(waveTimer * 3);
      if (bonus > 0) { TD.state.sap += bonus; TD.bus.emit('toast', { text: 'Called early: +' + bonus + ' sap.' }); }
      waveTimer = 0;
      startWave();
    });
    TD.bus.on('baseHit', function () {
      if (TD.state.baseHP <= 0 && !TD.state.over) endGame();
    });
    TD.bus.on('waveClear', function (w) {
      var bonus = 40 + w * 14;
      TD.state.sap += bonus;
      TD.audio.play('clear');
      TD.bus.emit('toast', { text: 'Wave ' + w + ' broken. +' + bonus + ' sap.' });
      betweenWaves = true;
      waveTimer = Math.max(14, 24 - w * 0.25);
    });
    TD.bus.on('bounty', function (d) {
      TD.fx.burst({ x: d.pos.x, y: d.pos.y + 1.2, z: d.pos.z }, {
        count: 4, color: 0xffe08a, speed: 1.4, life: 0.8, size: 0.3, gravity: 1.2, drag: 0.8
      });
    });
  }

  function doBuild(c) {
    var s = TD.build.place(TD.ui.mode, c.x, c.z);
    TD.ui.hideConfirm();
    if (s) {
      var chk = TD.build.canPlace(TD.ui.mode, c.x, c.z);
      placeHighlight(c.x, c.z, chk.ok);
    }
  }

  /* ---------------- game flow ---------------- */
  function startGame() {
    TD.state.running = true;
    TD.state.sap = 260;
    TD.state.wave = 0;
    TD.state.baseHP = TD.state.baseHPMax = 1200;
    TD.state.kills = 0;
    TD.state.dayT = 0.30;
    betweenWaves = true;
    waveTimer = 22;
    document.getElementById('hud-top').classList.remove('hidden');
    document.getElementById('build-bar').classList.remove('hidden');
    document.getElementById('wave-dock').classList.remove('hidden');
    TD.ui.setHint('Tap a structure to inspect it, or a relic to read it.');
    TD.input.focusOn(TD.terrain.base.wx, TD.terrain.base.wz, 42);
    TD.audio.resume();
    clock = new THREE.Clock();
    requestAnimationFrame(loop);
  }

  function startWave() {
    TD.state.wave++;
    betweenWaves = false;
    TD.enemies.startWave(TD.state.wave);
    TD.audio.play('wave');
    TD.bus.emit('toast', { text: 'Wave ' + TD.state.wave + ' — the Rust is moving.', bad: true });
    TD.ui.setWaveButton('Wave ' + TD.state.wave + ' walking', false);
  }

  function endGame() {
    TD.state.over = true;
    TD.state.running = false;
    TD.audio.play('over');
    TD.fx.burst({ x: TD.terrain.base.wx, y: TD.terrain.base.y + 2, z: TD.terrain.base.wz }, {
      count: 120, color: 0x7cffd8, speed: 12, life: 2.0, size: 0.8, lift: 5, gravity: -3
    });
    TD.ui.gameOver();
  }

  /* ---------------- loop ---------------- */
  function loop() {
    requestAnimationFrame(loop);
    var raw = Math.min(clock.getDelta(), 0.06);
    var dt = raw * (TD.state.paused ? 0 : TD.state.speed);

    if (dt > 0) {
      TD.state.time += dt;
      TD.state.dayT = (TD.state.dayT + dt / DAY_SECONDS) % 1;

      // passive sap trickle from the Heartspore
      TD.state.sap += dt * (1.6 + TD.state.wave * 0.22);

      if (betweenWaves && !TD.state.over) {
        waveTimer -= dt;
        if (waveTimer <= 0) startWave();
        TD.ui.setWaveButton('Call wave ' + (TD.state.wave + 1) + ' ↯', true);
        TD.ui.setWaveStatus('next wave in ' + Math.ceil(waveTimer) + 's');
      } else if (!TD.state.over) {
        TD.ui.setWaveStatus(TD.enemies.remaining() + ' rust remaining');
      }

      TD.enemies.update(dt, TD.sky.night);
      TD.build.update(dt, TD.sky.night);
      TD.fx.update(dt);
      TD.props.update(dt, TD.sky.night);
      TD.water.update(dt, TD.sky);

      if (TD.state.baseHP <= 0 && !TD.state.over) endGame();
    }

    TD.input.update(raw);
    TD.sky.update(raw, TD.input.target);
    TD.ui.updateHud();
    if (TD.ui.selected) {
      if (TD.ui.selected.dead) { TD.ui.closePanel(); rangeRing.visible = false; }
      else if (Math.random() < 0.05) TD.ui.refreshPanel();
    }

    var night = TD.sky.night;
    TD.audio.updateAmbient(night, TD.util.clamp(1 - TD.input.target.y * 0.5, 0, 1));

    // planar water reflection (high quality only, every other frame)
    if (quality.reflection) {
      reflectTick++;
      if (reflectTick % 2 === 0) TD.water.renderReflection(renderer, scene, camera, null);
    }

    renderer.render(scene, camera);

    fpsFrames++; fpsAcc += raw;
    if (fpsAcc >= 0.5) {
      fpsTime = Math.round(fpsFrames / fpsAcc);
      TD.ui.setFps(fpsTime);
      fpsFrames = 0; fpsAcc = 0;
    }
  }

  window.addEventListener('load', function () { game.boot(); });

})(window.TD);

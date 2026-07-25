/* ============================================================
   VELL — HUD, panels, codex, toasts
   ============================================================ */
(function (TD) {
  'use strict';

  var UI = TD.ui = {};
  var $ = function (id) { return document.getElementById(id); };
  var el = {};
  var selected = null;
  var pendingPromo = null;

  UI.mode = 'inspect';   // 'inspect' | 'tower' | 'wall' | 'trap'
  UI.pendingCell = null;

  function bindEls() {
    ['boot-screen', 'boot-fill', 'boot-status', 'intro', 'intro-body', 'intro-start',
      'hud-top', 'hud-sap', 'hud-wave', 'hud-hp-fill', 'hud-hp-text', 'hud-clock', 'hud-phase',
      'build-bar', 'panel', 'panel-name', 'panel-level', 'panel-desc', 'panel-stats',
      'panel-upgrade', 'panel-sell', 'panel-close', 'promote', 'promote-options', 'promote-title',
      'promote-cancel', 'codex', 'codex-list', 'codex-close', 'menu', 'toast-container',
      'wave-btn', 'wave-status', 'fps', 'gameover', 'go-stats', 'go-restart', 'hint',
      'sound-toggle', 'menu-btn', 'menu-close', 'menu-restart', 'menu-help', 'help', 'help-close',
      'codex-btn', 'speed-1', 'speed-2', 'speed-3', 'pause-btn', 'confirm-chip', 'confirm-build', 'confirm-cancel'
    ].forEach(function (id) { el[id] = $(id); });
    UI.el = el;
  }

  /* ---------------- toasts ---------------- */
  var toastQueue = [];
  UI.toast = function (text, bad) {
    var d = document.createElement('div');
    d.className = 'toast' + (bad ? ' bad' : '');
    d.textContent = text;
    el['toast-container'].appendChild(d);
    toastQueue.push(d);
    if (toastQueue.length > 4) { var old = toastQueue.shift(); if (old.parentNode) old.parentNode.removeChild(old); }
    setTimeout(function () {
      d.classList.add('out');
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 400);
    }, bad ? 2600 : 2000);
  };

  /* ---------------- boot / intro ---------------- */
  UI.bootProgress = function (p, status) {
    if (el['boot-fill']) el['boot-fill'].style.width = Math.round(p * 100) + '%';
    if (status && el['boot-status']) el['boot-status'].textContent = status;
  };
  UI.hideBoot = function () {
    el['boot-screen'].classList.add('hidden');
  };
  UI.showIntro = function () {
    var body = TD.defs.story.intro.map(function (p) { return '<p>' + p + '</p>'; }).join('');
    body += '<ul class="rules">' + TD.defs.story.rules.map(function (r) { return '<li>' + r + '</li>'; }).join('') + '</ul>';
    el['intro-body'].innerHTML = body;
    el['intro'].classList.remove('hidden');
  };

  /* ---------------- hud ---------------- */
  var lastSap = -1, lastWave = -1, lastHP = -1;
  UI.updateHud = function () {
    var s = TD.state;
    if (s.sap !== lastSap) { el['hud-sap'].textContent = TD.util.fmt(s.sap); lastSap = s.sap; }
    if (s.wave !== lastWave) { el['hud-wave'].textContent = s.wave; lastWave = s.wave; }
    if (s.baseHP !== lastHP) {
      var f = TD.util.clamp(s.baseHP / s.baseHPMax, 0, 1);
      el['hud-hp-fill'].style.width = (f * 100) + '%';
      el['hud-hp-fill'].style.background = f > 0.5 ? 'linear-gradient(90deg,#2fe0a8,#7cffd8)'
        : f > 0.22 ? 'linear-gradient(90deg,#e0c22f,#fff08a)' : 'linear-gradient(90deg,#e04a2f,#ff9a7a)';
      el['hud-hp-text'].textContent = Math.max(0, Math.ceil(s.baseHP)) + ' / ' + s.baseHPMax;
      lastHP = s.baseHP;
    }
    var t = s.dayT;
    var phase = t < 0.22 ? 'night' : t < 0.32 ? 'dawn' : t < 0.62 ? 'day' : t < 0.78 ? 'dusk' : t < 0.88 ? 'twilight' : 'night';
    var icon = (phase === 'day') ? '☀' : (phase === 'dawn' ? '🌅' : phase === 'dusk' ? '🌇' : '🌙');
    el['hud-clock'].textContent = icon;
    el['hud-phase'].textContent = phase;

    var costs = UI.el.costs;
    if (costs) {
      for (var k in costs) {
        costs[k].classList.toggle('poor', TD.state.sap < TD.defs.rootCost(k));
      }
    }
  };

  UI.setWaveStatus = function (text) { el['wave-status'].textContent = text; };
  UI.setWaveButton = function (label, enabled) {
    el['wave-btn'].textContent = label;
    el['wave-btn'].disabled = !enabled;
  };

  /* ---------------- build bar ---------------- */
  function setMode(mode) {
    UI.mode = mode;
    UI.pendingCell = null;
    el['confirm-chip'].classList.add('hidden');
    var btns = el['build-bar'].querySelectorAll('.build-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-mode') === mode);
    }
    TD.bus.emit('modeChanged', mode);
    if (mode !== 'inspect') UI.closePanel();
    TD.audio.play('ui');
  }
  UI.setMode = setMode;

  /* ---------------- selection panel ---------------- */
  UI.select = function (s) {
    selected = s;
    UI.selected = s;
    if (!s) { UI.closePanel(); return; }
    renderPanel();
    el['panel'].classList.remove('hidden');
    document.body.classList.add('panel-open');
    TD.bus.emit('selected', s);
  };
  UI.closePanel = function () {
    selected = null; UI.selected = null;
    el['panel'].classList.add('hidden');
    document.body.classList.remove('panel-open');
    TD.bus.emit('selected', null);
  };

  function statRow(label, value) {
    return '<div class="stat"><span>' + label + '</span><b>' + value + '</b></div>';
  }

  function renderPanel() {
    var s = selected;
    if (!s || s.dead) { UI.closePanel(); return; }
    var def = TD.defs.get(s.type);
    var st = s.stats;
    el['panel-name'].textContent = TD.defs.displayName(s);
    el['panel-level'].textContent = 'Lv ' + s.level + (s.asc ? ' · ascended ×' + s.asc : '') + ' · ' + def.kind;
    el['panel-desc'].textContent = def.desc;

    var rows = '';
    if (def.kind === 'tower') {
      if (st.proj === 'aura') {
        rows += statRow('Aura damage', Math.round(st.dmg));
        rows += statRow('Ticks / sec', st.rate.toFixed(2));
      } else {
        rows += statRow('Damage', Math.round(st.dmg));
        rows += statRow('Rate', st.rate.toFixed(2) + '/s');
        rows += statRow('DPS', Math.round(st.dmg * st.rate * (st.pierce ? Math.min(st.pierce, 3) : 1)));
      }
      rows += statRow('Range', st.range.toFixed(1));
      if (st.splash) rows += statRow('Splash', st.splash.toFixed(1));
      if (st.chain) rows += statRow('Chains', st.chain);
      if (st.pierce) rows += statRow('Pierces', st.pierce);
      if (st.pierceArmor) rows += statRow('Armour cut', Math.round(st.pierceArmor * 100) + '%');
      if (st.slow) rows += statRow('Slow', Math.round(st.slow * 100) + '%');
      if (st.dot) rows += statRow('Rot / sec', Math.round(st.dot));
    } else if (def.kind === 'trap') {
      rows += statRow('Damage / tick', Math.round(st.dmg || 0));
      rows += statRow('Tick', (st.tick || 0.5).toFixed(2) + 's');
      if (st.slow) rows += statRow('Slow', Math.round(st.slow * 100) + '%');
      if (st.burn) rows += statRow('Burn / sec', Math.round(st.burn));
      if (st.vuln) rows += statRow('Vulnerable', '+' + Math.round(st.vuln * 100) + '%');
      if (st.rootChance) rows += statRow('Snare', Math.round(st.rootChance * 100) + '%');
      if (st.blast) rows += statRow('Blast', st.blast.toFixed(1));
      if (st.lure) rows += statRow('Lure', 'yes');
      if (st.fear) rows += statRow('Fear', 'yes');
    } else {
      rows += statRow('Integrity', Math.round(s.hp) + ' / ' + Math.round(s.hpMax));
      if (st.thorns) rows += statRow('Thorns', Math.round(st.thorns));
    }
    el['panel-stats'].innerHTML = rows;

    var cost = TD.defs.upgradeCost(s);
    var promo = (s.level + 1) % 10 === 0;
    el['panel-upgrade'].innerHTML = (promo ? '★ Promote to Lv ' + (s.level + 1) : 'Upgrade to Lv ' + (s.level + 1)) +
      ' <span class="cost">' + TD.util.fmt(cost) + '</span>';
    el['panel-upgrade'].classList.toggle('promo', promo);
    el['panel-upgrade'].disabled = TD.state.sap < cost;
    el['panel-sell'].innerHTML = 'Reclaim <span class="cost">+' + TD.util.fmt(TD.defs.sellValue(s)) + '</span>';
  }
  UI.refreshPanel = function () { if (selected) renderPanel(); };

  /* ---------------- promotion modal ---------------- */
  function showPromote(data) {
    pendingPromo = data;
    var s = data.s;
    var html = '';
    if (data.options && data.options.length) {
      el['promote-title'].textContent = TD.defs.displayName(s) + ' is ready to become something else.';
      for (var i = 0; i < data.options.length; i++) {
        var o = data.options[i];
        html += '<button class="promo-card" data-id="' + o.id + '">' +
          '<span class="promo-swatch" style="background:' + hex(o.glow) + '"></span>' +
          '<h4>' + o.name + '</h4>' +
          '<p>' + o.desc + '</p>' +
          '<div class="promo-stats">' + promoStats(o) + '</div>' +
          '</button>';
      }
    } else {
      el['promote-title'].textContent = TD.defs.displayName(s) + ' has nothing left to become — so it becomes more of itself.';
      html += '<button class="promo-card ascend" data-id="">' +
        '<span class="promo-swatch" style="background:' + hex(TD.defs.get(s.type).glow) + '"></span>' +
        '<h4>Ascend · ' + (TD.defs.ASCEND[Math.min(s.asc, TD.defs.ASCEND.length - 1)]) + '</h4>' +
        '<p>Every stat is multiplied again. The Bloom does not recognise a ceiling.</p>' +
        '<div class="promo-stats"><span>all stats ×1.55</span><span>+size</span></div>' +
        '</button>';
    }
    el['promote-options'].innerHTML = html;
    var cards = el['promote-options'].querySelectorAll('.promo-card');
    for (var c = 0; c < cards.length; c++) {
      cards[c].addEventListener('click', function () {
        var id = this.getAttribute('data-id');
        TD.build.confirmPromotion(pendingPromo.s, id || null, pendingPromo.cost);
        el['promote'].classList.add('hidden');
        pendingPromo = null;
        renderPanel();
      });
    }
    el['promote'].classList.remove('hidden');
  }

  function promoStats(def) {
    var out = [];
    var st = def.stats;
    if (st.dmg) out.push('dmg ' + st.dmg);
    if (st.rate) out.push(st.rate + '/s');
    if (st.range) out.push('rng ' + st.range);
    if (st.splash) out.push('splash ' + st.splash);
    if (st.chain) out.push('chain ' + st.chain);
    if (st.pierce) out.push('pierce ' + st.pierce);
    if (st.slow) out.push('slow ' + Math.round(st.slow * 100) + '%');
    if (st.burn) out.push('burn ' + st.burn);
    if (st.vuln) out.push('vuln +' + Math.round(st.vuln * 100) + '%');
    if (st.hp) out.push('hp ' + st.hp);
    return out.map(function (t) { return '<span>' + t + '</span>'; }).join('');
  }

  function hex(n) { return '#' + ('000000' + n.toString(16)).slice(-6); }

  /* ---------------- codex ---------------- */
  UI.unlockLore = function (entry) {
    if (TD.state.codex[entry.id]) {
      UI.showCodex(entry.id);
      return;
    }
    TD.state.codex[entry.id] = true;
    TD.audio.play('lore');
    UI.toast('Codex: ' + entry.title);
    UI.showCodex(entry.id);
    el['codex-btn'].classList.add('pulse');
    setTimeout(function () { el['codex-btn'].classList.remove('pulse'); }, 2400);
  };

  UI.showCodex = function (focusId) {
    var html = '';
    var all = TD.props.LORE;
    var found = 0;
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      var known = !!TD.state.codex[e.id];
      if (known) found++;
      html += '<div class="codex-entry' + (known ? '' : ' locked') + (focusId === e.id ? ' focus' : '') + '">' +
        '<h4>' + (known ? e.title : '· · ·') + '</h4>' +
        '<p>' + (known ? e.text : 'Somewhere out in the shallows, unfound.') + '</p>' +
        '</div>';
    }
    el['codex-list'].innerHTML =
      '<p class="codex-count">' + found + ' of ' + all.length + ' relics read</p>' + html;
    el['codex'].classList.remove('hidden');
    var f = el['codex-list'].querySelector('.focus');
    if (f) f.scrollIntoView({ block: 'center' });
  };

  /* ---------------- game over ---------------- */
  UI.gameOver = function () {
    el['go-stats'].innerHTML =
      '<div><b>' + TD.state.wave + '</b><span>waves held</span></div>' +
      '<div><b>' + TD.util.fmt(TD.state.kills) + '</b><span>rust broken</span></div>' +
      '<div><b>' + Object.keys(TD.state.codex).length + '</b><span>relics read</span></div>';
    el['gameover'].classList.remove('hidden');
  };

  /* ---------------- wiring ---------------- */
  UI.init = function () {
    bindEls();

    // build bar buttons
    var costs = {};
    var modes = [
      { m: 'tower', label: 'Tower', icon: '🍄', kind: 'tower' },
      { m: 'wall', label: 'Wall', icon: '🧱', kind: 'wall' },
      { m: 'trap', label: 'Trap', icon: '🕸', kind: 'trap' },
      { m: 'inspect', label: 'Inspect', icon: '👁', kind: null }
    ];
    var bar = el['build-bar'];
    bar.innerHTML = modes.map(function (m) {
      var cost = m.kind ? '<span class="bcost" data-kind="' + m.kind + '">' + TD.defs.rootCost(m.kind) + '</span>' : '';
      return '<button class="build-btn' + (m.m === 'inspect' ? ' active' : '') + '" data-mode="' + m.m + '">' +
        '<span class="bicon">' + m.icon + '</span><span class="blabel">' + m.label + '</span>' + cost + '</button>';
    }).join('');
    var btns = bar.querySelectorAll('.build-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () { setMode(this.getAttribute('data-mode')); });
    }
    var cs = bar.querySelectorAll('.bcost');
    for (i = 0; i < cs.length; i++) costs[cs[i].getAttribute('data-kind')] = cs[i];
    UI.el.costs = costs;

    el['panel-close'].addEventListener('click', function () { UI.closePanel(); TD.audio.play('ui'); });
    el['panel-upgrade'].addEventListener('click', function () {
      if (!selected) return;
      var r = TD.build.upgrade(selected);
      if (r === true) renderPanel();
    });
    el['panel-sell'].addEventListener('click', function () {
      if (!selected) return;
      TD.build.sell(selected);
      UI.closePanel();
    });
    el['promote-cancel'].addEventListener('click', function () {
      el['promote'].classList.add('hidden'); pendingPromo = null;
    });

    el['codex-btn'].addEventListener('click', function () { UI.showCodex(); TD.audio.play('ui'); });
    el['codex-close'].addEventListener('click', function () { el['codex'].classList.add('hidden'); });

    el['menu-btn'].addEventListener('click', function () { el['menu'].classList.remove('hidden'); TD.state.paused = true; });
    el['menu-close'].addEventListener('click', function () { el['menu'].classList.add('hidden'); TD.state.paused = false; });
    el['menu-restart'].addEventListener('click', function () { location.reload(); });
    el['menu-help'].addEventListener('click', function () { el['help'].classList.remove('hidden'); });
    el['help-close'].addEventListener('click', function () { el['help'].classList.add('hidden'); });
    el['go-restart'].addEventListener('click', function () { location.reload(); });

    el['sound-toggle'].addEventListener('click', function () {
      var on = !TD.audio.isEnabled();
      TD.audio.setEnabled(on);
      this.textContent = on ? '🔊 Sound on' : '🔇 Sound off';
    });

    el['intro-start'].addEventListener('click', function () {
      el['intro'].classList.add('hidden');
      TD.audio.resume();
      TD.bus.emit('startGame');
    });

    el['wave-btn'].addEventListener('click', function () { TD.bus.emit('callWave'); });

    [['speed-1', 1], ['speed-2', 2], ['speed-3', 3]].forEach(function (p) {
      el[p[0]].addEventListener('click', function () {
        TD.state.speed = p[1]; TD.state.paused = false;
        updateSpeedUI();
        TD.audio.play('ui');
      });
    });
    el['pause-btn'].addEventListener('click', function () {
      TD.state.paused = !TD.state.paused;
      updateSpeedUI();
    });

    el['confirm-build'].addEventListener('click', function () {
      if (UI.pendingCell) TD.bus.emit('confirmBuild', UI.pendingCell);
    });
    el['confirm-cancel'].addEventListener('click', function () {
      UI.pendingCell = null;
      el['confirm-chip'].classList.add('hidden');
      TD.bus.emit('cancelBuild');
    });

    TD.bus.on('toast', function (d) { UI.toast(d.text, d.bad); if (d.bad) TD.audio.play('bad'); });
    TD.bus.on('promote', showPromote);
    TD.bus.on('structChanged', function () { renderPanel(); });
    TD.bus.on('sold', function () { UI.closePanel(); });

    TD.bus.on('key', function (k) {
      if (k === '1') setMode('tower');
      else if (k === '2') setMode('wall');
      else if (k === '3') setMode('trap');
      else if (k === 'escape') { setMode('inspect'); UI.closePanel(); el['codex'].classList.add('hidden'); el['help'].classList.add('hidden'); }
      else if (k === ' ') { TD.state.paused = !TD.state.paused; updateSpeedUI(); }
      else if (k === 'c') UI.showCodex();
      else if (k === 'n') TD.bus.emit('callWave');
      else if (k === 'u' && selected) { var r = TD.build.upgrade(selected); if (r === true) renderPanel(); }
    });

    updateSpeedUI();
  };

  function updateSpeedUI() {
    el['speed-1'].classList.toggle('active', TD.state.speed === 1 && !TD.state.paused);
    el['speed-2'].classList.toggle('active', TD.state.speed === 2 && !TD.state.paused);
    el['speed-3'].classList.toggle('active', TD.state.speed === 3 && !TD.state.paused);
    el['pause-btn'].classList.toggle('active', TD.state.paused);
    el['pause-btn'].textContent = TD.state.paused ? '▶' : '❚❚';
  }
  UI.updateSpeedUI = updateSpeedUI;

  UI.showConfirm = function (cell, ok, why) {
    UI.pendingCell = cell;
    el['confirm-chip'].classList.remove('hidden');
    el['confirm-build'].disabled = !ok;
    el['confirm-build'].textContent = ok ? 'Grow here' : (why || 'Cannot build');
  };
  UI.hideConfirm = function () {
    UI.pendingCell = null;
    el['confirm-chip'].classList.add('hidden');
  };

  UI.setHint = function (text) {
    if (!el['hint']) return;
    el['hint'].textContent = text || '';
    el['hint'].classList.toggle('hidden', !text);
  };

  UI.setFps = function (v) { if (el['fps']) el['fps'].textContent = v + ' fps'; };

})(window.TD);

/**
 * GameMenu — a DOM pause/menu overlay shared by desktop (ESC / ☰) and mobile
 * (the on-screen MENU button). Handles fullscreen, PWA install, restart, main
 * menu, quit, and a controls reference. Also registers the service worker.
 *
 * Browser APIs that need a user gesture (fullscreen, install prompt) are fired
 * from DOM button clicks, which qualify.
 */
(function () {
  'use strict';

  var deferredPrompt = null;
  var built = false;
  var els = {};
  var helpOpen = false;

  function isMobile() {
    return (typeof Platform !== 'undefined' && Platform.isMobile()) ||
      (typeof GameState !== 'undefined' && GameState.isMobile);
  }
  function isIOS() {
    return /ipad|iphone|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function game() { return window.game || null; }
  function sceneMgr() { var g = game(); return g && g.scene ? g.scene : null; }

  function injectStyles() {
    var css = '\
    .gm-fab{position:fixed;top:12px;right:12px;z-index:300;width:44px;height:44px;border-radius:10px;\
      background:rgba(12,13,22,.7);border:1px solid rgba(150,150,200,.5);color:#dfe0ff;font-size:20px;\
      cursor:pointer;display:none}\
    .gm-fab:hover{border-color:#8a7bff}\
    .gm-backdrop{position:fixed;inset:0;z-index:400;background:rgba(6,7,14,.78);backdrop-filter:blur(5px);\
      display:none;align-items:center;justify-content:center;font-family:Arial,sans-serif}\
    .gm-backdrop.open{display:flex}\
    .gm-panel{width:min(360px,92vw);max-height:90vh;overflow-y:auto;background:linear-gradient(160deg,#16182e,#0e1020);\
      border:1px solid rgba(140,130,255,.4);border-radius:16px;padding:22px;box-shadow:0 30px 80px -20px #000;text-align:center}\
    .gm-title{color:#cdc8ff;font-size:22px;font-weight:800;letter-spacing:1px;margin-bottom:4px}\
    .gm-sub{color:#8a8ab0;font-size:12px;margin-bottom:16px}\
    .gm-btn{display:block;width:100%;margin:8px 0;padding:13px;border-radius:10px;border:1px solid rgba(120,120,180,.45);\
      background:rgba(40,42,80,.6);color:#fff;font-size:15px;font-weight:700;cursor:pointer;transition:all .15s}\
    .gm-btn:hover{border-color:#8a7bff;background:rgba(60,62,110,.7);transform:translateY(-1px)}\
    .gm-btn.primary{background:#5a4bd6;border-color:#8a7bff}\
    .gm-btn.danger{border-color:rgba(220,120,120,.5)}\
    .gm-btn.danger:hover{border-color:#e07a7a;background:rgba(90,40,40,.6)}\
    .gm-help{display:none;text-align:left;color:#b9bbdf;font-size:13px;line-height:1.7;\
      background:rgba(0,0,0,.25);border-radius:10px;padding:12px;margin-top:10px}\
    .gm-help.open{display:block}\
    .gm-help b{color:#cdc8ff}\
    .gm-hide{display:none!important}\
    .gm-rotate{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:250;display:none;\
      align-items:center;gap:8px;padding:9px 14px;border-radius:999px;background:rgba(16,18,34,.9);\
      border:1px solid rgba(140,130,255,.5);color:#dfe0ff;font-family:Arial,sans-serif;font-size:13px;\
      cursor:pointer;box-shadow:0 8px 24px -8px #000}\
    .gm-rotate b{font-size:16px}';
    var s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  function build() {
    if (built) return;
    built = true;
    injectStyles();

    var fab = document.createElement('button');
    fab.className = 'gm-fab';
    fab.setAttribute('aria-label', 'Menu');
    fab.textContent = '☰';
    fab.addEventListener('click', open);
    if (!isMobile()) fab.style.display = 'block';
    document.body.appendChild(fab);
    els.fab = fab;

    var back = document.createElement('div');
    back.className = 'gm-backdrop';
    back.innerHTML =
      '<div class="gm-panel" role="dialog" aria-modal="true" aria-label="Game menu">' +
        '<div class="gm-title">❖ Paused</div>' +
        '<div class="gm-sub">Magic Circles</div>' +
        '<button class="gm-btn primary" data-act="resume">Resume</button>' +
        '<button class="gm-btn" data-act="fullscreen">Enter Fullscreen</button>' +
        '<button class="gm-btn gm-rotate-btn" data-act="rotate">Force Landscape ↻</button>' +
        '<button class="gm-btn gm-hide" data-act="install">Install App</button>' +
        '<button class="gm-btn" data-act="controls">Controls</button>' +
        '<button class="gm-btn" data-act="restart">Restart Run</button>' +
        '<button class="gm-btn" data-act="mainmenu">Main Menu</button>' +
        '<button class="gm-btn danger" data-act="quit">Quit to Hub</button>' +
        '<div class="gm-help"></div>' +
      '</div>';
    back.addEventListener('click', function (e) { if (e.target === back) close(); });
    document.body.appendChild(back);
    els.back = back;
    els.panel = back.querySelector('.gm-panel');
    els.help = back.querySelector('.gm-help');
    els.install = back.querySelector('[data-act="install"]');
    els.fullscreen = back.querySelector('[data-act="fullscreen"]');
    els.rotateBtn = back.querySelector('.gm-rotate-btn');
    if (els.rotateBtn && !isMobile()) els.rotateBtn.classList.add('gm-hide'); // mobile-only

    back.querySelectorAll('.gm-btn').forEach(function (b) {
      b.addEventListener('click', function () { handle(b.getAttribute('data-act')); });
    });

    // standing "rotate to landscape" nudge (mobile + portrait)
    var rot = document.createElement('button');
    rot.className = 'gm-rotate';
    rot.innerHTML = '<b>↻</b> Tap to play in landscape';
    rot.addEventListener('click', forceLandscape);
    document.body.appendChild(rot);
    els.rotate = rot;
    updateRotateHint();
  }

  function controlsHTML() {
    if (isMobile()) {
      return '<b>Move</b> — left stick<br><b>Aim</b> — right stick (aim sticks after release)<br>' +
        '<b>CAST</b> — throw the spell<br><b>TRIGGER</b> — detonate payload mid-air<br>' +
        '<b>BLINK</b> — dash<br><b>FORGE</b> — open the Spellforge<br><b>MENU</b> — this menu';
    }
    return '<b>Move</b> — WASD / Arrows<br><b>Aim</b> — mouse<br><b>Cast</b> — left click<br>' +
      '<b>Detonate payload</b> — right click<br><b>Dash</b> — Shift<br><b>Spellforge</b> — M<br>' +
      '<b>Slots</b> — 1–8<br><b>Menu</b> — Esc';
  }

  function handle(act) {
    switch (act) {
      case 'resume': close(); break;
      case 'fullscreen': toggleFullscreen(); break;
      case 'rotate': forceLandscape(); break;
      case 'install': doInstall(); break;
      case 'controls':
        helpOpen = !helpOpen;
        els.help.innerHTML = controlsHTML();
        els.help.classList.toggle('open', helpOpen);
        break;
      case 'restart': restart(); break;
      case 'mainmenu': mainMenu(); break;
      case 'quit': window.location.href = 'index.html'; break;
    }
  }

  function fsActive() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function isPortrait() {
    return (window.innerHeight || 0) > (window.innerWidth || 0);
  }
  // Force landscape: orientation lock needs fullscreen, so request both. iOS
  // doesn't support either on the web — it just stays put (the layout still
  // adapts), and we keep the rotate hint visible.
  function forceLandscape() {
    var lock = function () {
      try {
        if (screen.orientation && screen.orientation.lock) {
          screen.orientation.lock('landscape').catch(function () {});
        }
      } catch (e) { /* unsupported */ }
    };
    try {
      if (!fsActive()) {
        var el = document.documentElement;
        var p = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        if (p && p.then) { p.then(lock).catch(lock); } else { lock(); }
      } else {
        lock();
      }
    } catch (e) { console.warn('force landscape failed:', e); }
    setTimeout(updateRotateHint, 400);
  }
  function updateRotateHint() {
    if (!els.rotate) return;
    var show = isMobile() && isPortrait();
    els.rotate.style.display = show ? 'flex' : 'none';
  }
  function toggleFullscreen() {
    // Fullscreen the whole document (not just the Phaser parent) so this DOM
    // menu and the canvas both stay visible. Phaser's RESIZE mode + the window
    // resize listener keep the canvas filling the screen.
    try {
      if (fsActive()) {
        (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      } else {
        var el = document.documentElement;
        (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
      }
    } catch (e) { console.warn('fullscreen failed:', e); }
    setTimeout(updateFullscreenLabel, 150);
  }
  function updateFullscreenLabel() {
    if (els.fullscreen) els.fullscreen.textContent = fsActive() ? 'Exit Fullscreen' : 'Enter Fullscreen';
  }

  function doInstall() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () { deferredPrompt = null; els.install.classList.add('gm-hide'); });
    } else if (isIOS()) {
      els.help.innerHTML = 'To install on iOS: tap the <b>Share</b> icon, then <b>Add to Home Screen</b>.';
      els.help.classList.add('open'); helpOpen = true;
    }
  }

  function clearWorldState() {
    if (typeof GameState === 'undefined') return;
    if (GameState.projectiles) GameState.projectiles.length = 0;
    if (GameState.enemies) GameState.enemies.length = 0;
    if (GameState.particles) GameState.particles.length = 0;
    GameState.isMagicOpen = false;
    GameState.timeScale = 1.0;
  }
  function restart() {
    var sm = sceneMgr(); if (!sm) { close(); return; }
    var seed = (typeof GameState !== 'undefined' && GameState.lastSeed) ? GameState.lastSeed : undefined;
    clearWorldState();
    try { sm.stop('MagicEditorScene'); } catch (e) {}
    sm.stop('GameScene');
    sm.start('GameScene', { seed: seed });
    close();
  }
  function mainMenu() {
    var sm = sceneMgr(); if (!sm) { close(); return; }
    clearWorldState();
    var bar = document.getElementById('inventory-bar'); if (bar) bar.style.display = 'none';
    try { sm.stop('MagicEditorScene'); } catch (e) {}
    sm.stop('GameScene');
    sm.start('MenuScene');
    close();
  }

  function gameRunning() {
    var sm = sceneMgr();
    return sm && sm.isActive && sm.isActive('GameScene');
  }
  function open() {
    build();
    if (typeof GameState !== 'undefined' && GameState.isMagicOpen) return; // Spellforge owns Esc
    var sm = sceneMgr();
    if (sm && sm.isActive('GameScene')) { try { sm.pause('GameScene'); } catch (e) {} }
    updateFullscreenLabel();
    if (els.install) els.install.classList.toggle('gm-hide', !(deferredPrompt || isIOS()));
    els.back.classList.add('open');
  }
  function close() {
    if (!built) return;
    els.back.classList.remove('open');
    helpOpen = false; if (els.help) els.help.classList.remove('open');
    // input was frozen while paused — clear any held stick so the player doesn't drift
    if (typeof GameState !== 'undefined' && GameState.player && GameState.player.setMoveVector) {
      try { GameState.player.setMoveVector(0, 0); } catch (e) {}
    }
    var sm = sceneMgr();
    if (sm && sm.isPaused && sm.isPaused('GameScene')) { try { sm.resume('GameScene'); } catch (e) {} }
  }
  function toggle() { if (built && els.back.classList.contains('open')) close(); else open(); }

  // ---- wiring ----
  function init() {
    build();

    window.addEventListener('resize', updateRotateHint);
    window.addEventListener('orientationchange', function () { setTimeout(updateRotateHint, 300); });

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (typeof GameState !== 'undefined' && GameState.isMagicOpen && !(els.back && els.back.classList.contains('open'))) return;
        e.preventDefault();
        toggle();
      }
    });

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      if (els.install) els.install.classList.remove('gm-hide');
    });
    window.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      if (els.install) els.install.classList.add('gm-hide');
    });

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function (err) { console.warn('SW registration failed:', err); });
      });
    }
  }

  window.GameMenu = { open: open, close: close, toggle: toggle };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* app.js — bootstrap, keyboard shortcuts, PWA plumbing. */
var App = (function () {
  'use strict';

  var _deferredInstall = null;
  var _keepAudio = null;

  /* ---------- background keep-awake ----------
   * Browsers throttle timers in background tabs. A tab that is playing audio
   * is not throttled, so an opt-in loop of silence keeps alarms punctual. */
  function silentWavUrl() {
    var sampleRate = 8000, seconds = 2, frames = sampleRate * seconds;
    var buf = new ArrayBuffer(44 + frames * 2);
    var v = new DataView(buf);
    function str(off, s) { for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); v.setUint32(4, 36 + frames * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, frames * 2, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  function setKeepAwake(on) {
    if (on) {
      if (_keepAudio) return;
      _keepAudio = new Audio(silentWavUrl());
      _keepAudio.loop = true;
      _keepAudio.volume = 0.001;
      _keepAudio.play().catch(function () {
        // Needs a gesture first — retry on the next interaction.
        document.addEventListener('pointerdown', function once() {
          if (_keepAudio) _keepAudio.play().catch(function () {});
          document.removeEventListener('pointerdown', once);
        }, { once: true });
      });
    } else if (_keepAudio) {
      _keepAudio.pause();
      _keepAudio = null;
    }
  }

  /* ---------- service worker ---------- */

  function registerSW() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.register('sw.js').then(function (reg) {
      Notifier.setRegistration(reg);

      if ('periodicSync' in reg && navigator.permissions) {
        navigator.permissions.query({ name: 'periodic-background-sync' }).then(function (st) {
          if (st.state === 'granted') {
            reg.periodicSync.register('tn-alarms', { minInterval: 15 * 60 * 1000 }).catch(function () {});
          }
        }).catch(function () {});
      }

      navigator.serviceWorker.addEventListener('message', function (e) {
        var msg = e.data || {};
        if (msg.type === 'notes-changed') {
          Store.reloadFromDb().then(function () { Engine.plan(); });
        } else if (msg.type === 'open-note' && msg.noteId) {
          Store.reloadFromDb().then(function () { UI.openEditor(msg.noteId); });
        }
      });
      return reg;
    }).catch(function (err) {
      console.warn('Service worker registration failed', err);
      return null;
    });
  }

  function initInstall() {
    var btn = document.getElementById('btn-install');
    var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
    if (standalone && btn) btn.hidden = true;

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      _deferredInstall = e;
      if (btn) btn.hidden = false;
    });

    if (btn) {
      btn.addEventListener('click', function () {
        if (!_deferredInstall) {
          UI.toast('Use your browser menu → "Install app" or "Add to Home Screen".', { duration: 7000 });
          return;
        }
        _deferredInstall.prompt();
        _deferredInstall.userChoice.then(function () {
          _deferredInstall = null;
          btn.hidden = true;
        });
      });
    }

    window.addEventListener('appinstalled', function () {
      if (btn) btn.hidden = true;
      UI.toast('Installed. Alarms are more reliable from the installed app.');
    });
  }

  /* ---------- keyboard ---------- */

  function focusedNote() {
    var el = document.activeElement && document.activeElement.closest && document.activeElement.closest('[data-id]');
    if (el) return Store.byId(el.dataset.id);
    return null;
  }

  function isTyping(e) {
    var t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  function initKeys() {
    document.addEventListener('keydown', function (e) {
      if (Alarm.keydown(e)) { e.preventDefault(); return; }

      var mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        Editor.openPalette();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        if (isTyping(e)) return;
        e.preventDefault();
        if (e.shiftKey) { Store.redo(); UI.toast('Redone'); }
        else { Store.undo(); UI.toast('Undone'); }
        return;
      }
      if (mod) return;

      if (e.key === 'Escape') {
        if (Editor.isOpen()) { Editor.close(); return; }
        UI.closeMenu();
        if (UI.state.query) { UI.state.query = ''; UI.render(); }
        UI.clearSelection();
        return;
      }

      if (isTyping(e)) return;

      var note = focusedNote();

      switch (e.key) {
        case 'n': case 'N': e.preventDefault(); UI.newNote(); break;
        case '/': e.preventDefault(); UI.focusSearch(); break;
        case '?': e.preventDefault(); Editor.openSettings('about'); break;
        case 'e': case 'E': if (note) { e.preventDefault(); UI.openEditor(note.id); } break;
        case ' ': if (note) { e.preventDefault(); UI.toggleDone(note); } break;
        case 'a': case 'A': if (note) { e.preventDefault(); Editor.openReminder(note.id, null); } break;
        case 'p': case 'P': if (note) { e.preventDefault(); note.pinned = !note.pinned; Store.put(note); } break;
        case 's': case 'S': if (note) { e.preventDefault(); note.starred = !note.starred; Store.put(note); } break;
        case '#': if (note) { e.preventDefault(); UI.archiveNote(note); } break;
        case 'x': case 'X': if (note) { e.preventDefault(); UI.toggleSelect(note.id); } break;
        case 'Delete': case 'Backspace': if (note) { e.preventDefault(); UI.trashNote(note); } break;
        case '1': case '2': case '3': case '4': case '5': {
          var v = UI.VIEWS[Number(e.key) - 1];
          if (v) { e.preventDefault(); Store.updateSettings({ view: v.id }); }
          break;
        }
      }
    });
  }

  /* ---------- boot ---------- */

  function handleUrl() {
    var params = new URLSearchParams(location.search);
    if (params.get('action') === 'add') {
      setTimeout(function () { UI.newNote(); }, 200);
    }
    var note = params.get('note');
    if (note && Store.byId(note)) {
      setTimeout(function () { UI.openEditor(note); }, 200);
    }
    var scope = params.get('scope');
    if (scope) Store.updateSettings({ scope: scope }, { silent: true });
    if (params.toString()) history.replaceState(null, '', location.pathname);
  }

  function boot() {
    var splash = document.getElementById('splash');

    Store.load().then(function () {
      UI.applyTheme();
      Alarm.init();
      UI.init();
      initKeys();
      initInstall();
      handleUrl();

      if (Store.settings().keepAwake) setKeepAwake(true);

      // Any interaction is enough to let the audio engine ring later.
      var unlockOnce = function () {
        Ringtone.unlock();
        document.removeEventListener('pointerdown', unlockOnce);
        document.removeEventListener('keydown', unlockOnce);
      };
      document.addEventListener('pointerdown', unlockOnce);
      document.addEventListener('keydown', unlockOnce);

      return Engine.start();
    }).then(function () {
      return registerSW();
    }).then(function () {
      Engine.plan();
      if (splash) {
        splash.classList.add('is-out');
        setTimeout(function () { splash.remove(); }, 400);
      }
      var s = Store.settings();
      if (!s.onboarded) {
        Store.updateSettings({ onboarded: true }, { silent: true });
        setTimeout(function () {
          UI.toast('Tip: press ? for shortcuts, or ⏰ on a note to set an alarm.', { duration: 8000 });
        }, 1200);
      }
      Store.updateSettings({ lastSeenAt: Date.now() }, { silent: true });
    }).catch(function (err) {
      console.error(err);
      if (splash) {
        splash.innerHTML = '<div class="splash-error"><h1>Task Notes could not start</h1>' +
          '<p>' + MD.esc(err && err.message ? err.message : String(err)) + '</p>' +
          '<p>Private browsing windows sometimes block local storage.</p></div>';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return { setKeepAwake: setKeepAwake };
})();

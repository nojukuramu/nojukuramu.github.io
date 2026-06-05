var PWA = (function () {
  var _deferredPrompt = null;
  var _swReg = null;

  function _isIosSafari() {
    var ua = navigator.userAgent;
    return /iP(hone|od|ad)/.test(ua) && /WebKit/.test(ua) && !/(CriOS|FxiOS)/.test(ua);
  }

  function _isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  }

  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      _swReg = reg;
      Notifier.setSwReg(reg);

      // Best-effort periodicSync for background reminders
      if ('periodicSync' in reg) {
        navigator.permissions.query({ name: 'periodic-background-sync' }).then(function (status) {
          if (status.state === 'granted') {
            reg.periodicSync.register('task-notes-reminders', { minInterval: 15 * 60 * 1000 }).catch(function () {});
          }
        }).catch(function () {});
      }
    }).catch(function (err) {
      console.warn('SW registration failed:', err);
    });
  }

  function init() {
    registerSW();

    var installBtn = document.getElementById('btn-install');
    var iosTip = document.getElementById('ios-install-tip');

    if (_isStandalone()) {
      if (installBtn) installBtn.style.display = 'none';
      return;
    }

    if (_isIosSafari() && !_isStandalone()) {
      if (iosTip) iosTip.style.display = '';
    }

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      _deferredPrompt = e;
      if (installBtn) installBtn.style.display = '';
    });

    if (installBtn) {
      installBtn.addEventListener('click', function () {
        if (!_deferredPrompt) return;
        _deferredPrompt.prompt();
        _deferredPrompt.userChoice.then(function (result) {
          _deferredPrompt = null;
          if (result.outcome === 'accepted') installBtn.style.display = 'none';
        });
      });
    }

    window.addEventListener('appinstalled', function () {
      if (installBtn) installBtn.style.display = 'none';
      if (iosTip) iosTip.style.display = 'none';
    });

    // Handle ?action=add shortcut (from manifest shortcut)
    var params = new URLSearchParams(window.location.search);
    if (params.get('action') === 'add') {
      setTimeout(function () {
        var btn = document.getElementById('btn-add');
        if (btn) btn.click();
      }, 300);
    }
  }

  return { init: init };
})();

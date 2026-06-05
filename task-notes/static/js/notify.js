var Notifier = (function () {
  var _swReg = null;
  var _bannerQueue = [];
  var _bannerContainer = null;

  function setSwReg(reg) { _swReg = reg; }

  function setBannerContainer(el) { _bannerContainer = el; }

  function requestPermission(onResult) {
    if (!('Notification' in window)) {
      if (onResult) onResult('denied');
      return;
    }
    if (Notification.permission === 'granted') {
      if (onResult) onResult('granted');
      return;
    }
    if (Notification.permission === 'denied') {
      if (onResult) onResult('denied');
      return;
    }
    Notification.requestPermission().then(function (p) {
      Store.updateSettings({ notificationsAsked: true });
      if (onResult) onResult(p);
    });
  }

  function _makeBeep(priority) {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = priority === 'high' ? 880 : priority === 'low' ? 440 : 660;
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch (_) {}
  }

  function _showWebNotification(task) {
    var title = task.title || 'Task reminder';
    var opts = {
      body: task.notes ? task.notes.slice(0, 100) : 'Your task reminder is due.',
      tag: task.id,
      requireInteraction: task.priority === 'high',
      icon: 'static/icons/icon-192.png',
      badge: 'static/icons/icon-192.png',
      actions: [
        { action: 'dismiss', title: 'Dismiss' },
        { action: 'snooze', title: 'Snooze 5m' }
      ]
    };
    if (_swReg && _swReg.showNotification) {
      _swReg.showNotification(title, opts);
    } else {
      try { new Notification(title, opts); } catch (_) {}
    }
  }

  function _createBanner(task, onSnooze, onDismiss, onOpen, missed) {
    var banner = document.createElement('div');
    banner.className = 'alert-banner priority-' + (task.priority || 'normal') + (missed ? ' missed' : '');
    banner.dataset.taskId = task.id;
    banner.setAttribute('role', 'alert');
    banner.setAttribute('aria-live', 'assertive');

    var emoji = { high: '🚨', normal: '⏰', low: '🔔' }[task.priority || 'normal'];
    var label = missed ? '(missed) ' : '';

    banner.innerHTML =
      '<span class="alert-icon">' + emoji + '</span>' +
      '<span class="alert-title">' + label + _esc(task.title) + '</span>' +
      '<span class="alert-actions">' +
        '<button class="btn-snooze" title="Snooze 5 minutes">Snooze 5m</button>' +
        '<button class="btn-snooze-15" title="Snooze 15 minutes">15m</button>' +
        '<button class="btn-snooze-1h" title="Snooze 1 hour">1h</button>' +
        '<button class="btn-open" title="Open task">Open</button>' +
        '<button class="btn-dismiss" title="Dismiss" aria-label="Dismiss alert">✕</button>' +
      '</span>';

    banner.querySelector('.btn-snooze').addEventListener('click', function () {
      if (onSnooze) onSnooze(5, 'minutes');
      banner.remove();
    });
    banner.querySelector('.btn-snooze-15').addEventListener('click', function () {
      if (onSnooze) onSnooze(15, 'minutes');
      banner.remove();
    });
    banner.querySelector('.btn-snooze-1h').addEventListener('click', function () {
      if (onSnooze) onSnooze(60, 'minutes');
      banner.remove();
    });
    banner.querySelector('.btn-open').addEventListener('click', function () {
      if (onOpen) onOpen();
      banner.remove();
    });
    banner.querySelector('.btn-dismiss').addEventListener('click', function () {
      if (onDismiss) onDismiss();
      banner.remove();
    });

    return banner;
  }

  function _esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function alert(task, onSnooze, onDismiss, onOpen, missed) {
    if (!_bannerContainer) return;
    var banner = _createBanner(task, onSnooze, onDismiss, onOpen, missed);
    _bannerContainer.prepend(banner);

    var settings = Store.getSettings();
    if (settings.soundEnabled) _makeBeep(task.priority);
    if (navigator.vibrate && task.priority === 'high') navigator.vibrate([200, 100, 200]);

    if (Notification.permission === 'granted') {
      _showWebNotification(task);
    }
  }

  function clearBannersForTask(id) {
    if (!_bannerContainer) return;
    _bannerContainer.querySelectorAll('.alert-banner').forEach(function (b) {
      if (b.dataset.taskId === id) b.remove();
    });
  }

  return {
    setSwReg: setSwReg,
    setBannerContainer: setBannerContainer,
    requestPermission: requestPermission,
    alert: alert,
    clearBannersForTask: clearBannersForTask
  };
})();

/* notify.js — system notifications.
 *
 * Three delivery paths, best available wins:
 *   1. Notification Triggers (Chromium) — the OS fires the alert even with the
 *      app fully closed. Scheduled ahead of time.
 *   2. The service worker's periodic sync — fires from IndexedDB when the
 *      worker is woken up.
 *   3. The page itself, while a tab is open.
 */
var Notifier = (function () {
  'use strict';

  var _reg = null;

  function supported() {
    return typeof Notification !== 'undefined';
  }

  function permission() {
    return supported() ? Notification.permission : 'unsupported';
  }

  function setRegistration(reg) {
    _reg = reg;
  }

  function registration() {
    return _reg;
  }

  function request() {
    if (!supported()) return Promise.resolve('unsupported');
    if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
    return Notification.requestPermission().then(function (p) {
      Store.updateSettings({ notificationsAsked: true });
      return p;
    }).catch(function () { return 'denied'; });
  }

  function triggersSupported() {
    return supported() && 'showTrigger' in Notification.prototype && typeof TimestampTrigger !== 'undefined';
  }

  function titleFor(note, rem) {
    if (rem && rem.label) return rem.label;
    if (note.title) return note.title;
    var p = MD.plain(note.body, 60);
    return p || 'Reminder';
  }

  function bodyFor(note, rem, missed) {
    var parts = [];
    if (missed) parts.push('Missed reminder');
    if (rem && rem.label && note.title) parts.push(note.title);
    var p = MD.plain(note.body, 140);
    if (p) parts.push(p);
    if (!parts.length) parts.push(rem && rem.alarm ? 'Alarm' : 'Reminder');
    return parts.join(' · ');
  }

  function optionsFor(note, rem, opts) {
    opts = opts || {};
    return {
      body: bodyFor(note, rem, opts.missed),
      tag: 'tn:' + rem.id,
      renotify: true,
      requireInteraction: !!rem.alarm,
      icon: 'static/icons/icon-192.png',
      badge: 'static/icons/badge-96.png',
      vibrate: rem.vibrate ? [300, 120, 300, 120, 300] : undefined,
      timestamp: opts.at || Date.now(),
      silent: false,
      data: {
        noteId: note.id,
        reminderId: rem.id,
        alarm: !!rem.alarm,
        url: './?note=' + encodeURIComponent(note.id)
      },
      actions: [
        { action: 'snooze', title: 'Snooze' },
        { action: 'done', title: 'Mark done' }
      ]
    };
  }

  /* Immediate notification for something firing right now. */
  function show(note, rem, opts) {
    if (permission() !== 'granted') return Promise.resolve(false);
    var options = optionsFor(note, rem, opts);
    if (_reg && _reg.showNotification) {
      return _reg.showNotification(titleFor(note, rem), options)
        .then(function () { return true; })
        .catch(function () { return false; });
    }
    try {
      new Notification(titleFor(note, rem), options);
      return Promise.resolve(true);
    } catch (_) {
      return Promise.resolve(false);
    }
  }

  /* Hand upcoming alerts to the OS so they survive the app being closed.
   * `items` is [{note, reminder, at}]. */
  function scheduleTriggers(items) {
    if (!triggersSupported() || !_reg || permission() !== 'granted') return Promise.resolve(0);

    return _reg.getNotifications({ includeTriggered: true }).then(function (existing) {
      existing.forEach(function (n) {
        if (n.data && n.data.scheduled) n.close();
      });

      var now = Date.now();
      var queued = items
        .filter(function (it) { return it.at > now + 2000; })
        .sort(function (a, b) { return a.at - b.at; })
        .slice(0, 30);

      return Promise.all(queued.map(function (it) {
        var options = optionsFor(it.note, it.reminder, { at: it.at });
        options.tag = 'tn-sched:' + it.reminder.id;
        options.data.scheduled = true;
        options.data.at = it.at;
        try {
          options.showTrigger = new TimestampTrigger(it.at);
        } catch (_) {
          return null;
        }
        return _reg.showNotification(titleFor(it.note, it.reminder), options).catch(function () {});
      })).then(function () { return queued.length; });
    }).catch(function () { return 0; });
  }

  function clearFor(reminderId) {
    if (!_reg || !_reg.getNotifications) return Promise.resolve();
    return _reg.getNotifications({ includeTriggered: true }).then(function (list) {
      list.forEach(function (n) {
        if (n.tag === 'tn:' + reminderId || n.tag === 'tn-sched:' + reminderId) n.close();
      });
    }).catch(function () {});
  }

  function clearAll() {
    if (!_reg || !_reg.getNotifications) return Promise.resolve();
    return _reg.getNotifications({ includeTriggered: true }).then(function (list) {
      list.forEach(function (n) { n.close(); });
    }).catch(function () {});
  }

  return {
    supported: supported,
    permission: permission,
    request: request,
    setRegistration: setRegistration,
    registration: registration,
    triggersSupported: triggersSupported,
    show: show,
    scheduleTriggers: scheduleTriggers,
    clearFor: clearFor,
    clearAll: clearAll,
    titleFor: titleFor,
    bodyFor: bodyFor
  };
})();

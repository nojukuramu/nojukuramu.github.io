/* alarm.js — the ringing screen.
 *
 * A reminder set to "alarm" takes over the window until it is answered.
 * Quiet reminders fall through to a toast instead.
 */
var Alarm = (function () {
  'use strict';

  var _queue = [];
  var _el = null;
  var _sound = null;
  var _vibrateTimer = null;
  var _clockTimer = null;
  var _wakeLock = null;
  var _snoozeOpen = false;

  var SNOOZE_CHOICES = [
    { every: 1, unit: 'minutes', label: '1 min' },
    { every: 5, unit: 'minutes', label: '5 min' },
    { every: 10, unit: 'minutes', label: '10 min' },
    { every: 15, unit: 'minutes', label: '15 min' },
    { every: 30, unit: 'minutes', label: '30 min' },
    { every: 1, unit: 'hours', label: '1 hour' },
    { every: 3, unit: 'hours', label: '3 hours' },
    { every: 1, unit: 'days', label: 'Tomorrow' }
  ];

  function el() {
    if (!_el) _el = document.getElementById('alarm-screen');
    return _el;
  }

  function current() {
    return _queue[0] || null;
  }

  function enqueue(items) {
    var loud = [];
    items.forEach(function (it) {
      if (it.reminder.alarm) loud.push(it);
      else UI.toastReminder(it);
    });
    if (!loud.length) return;

    loud.forEach(function (it) {
      var dup = _queue.some(function (q) { return q.reminder.id === it.reminder.id; });
      if (!dup) _queue.push(it);
    });
    open();
  }

  function open() {
    if (!current()) return;
    document.documentElement.classList.add('alarm-ringing');
    render();
    startRinging();
    requestWakeLock();
    clearInterval(_clockTimer);
    _clockTimer = setInterval(updateClock, 1000);
  }

  function close() {
    document.documentElement.classList.remove('alarm-ringing');
    stopRinging();
    releaseWakeLock();
    clearInterval(_clockTimer);
    _clockTimer = null;
    _snoozeOpen = false;
    var host = el();
    if (host) host.innerHTML = '';
  }

  function next() {
    _queue.shift();
    if (!_queue.length) {
      close();
      return;
    }
    stopRinging();
    _snoozeOpen = false;
    render();
    startRinging();
  }

  /* ---------- sound + haptics ---------- */

  function startRinging() {
    var item = current();
    if (!item) return;
    var s = Store.settings();
    var rem = item.reminder;

    if (s.sound !== false) {
      Ringtone.stopAll();
      _sound = Ringtone.play(rem.ringtone || s.defaultRingtone, {
        loop: !item.missed,
        volume: rem.volume == null ? s.defaultVolume : rem.volume,
        escalate: !item.missed,
        maxRepeats: item.missed ? 1 : 24
      });
    }

    if (rem.vibrate && s.vibrate !== false && navigator.vibrate) {
      Ringtone.vibrate([400, 200, 400, 200, 400]);
      clearInterval(_vibrateTimer);
      if (!item.missed) {
        _vibrateTimer = setInterval(function () {
          Ringtone.vibrate([400, 200, 400, 200, 400]);
        }, 3000);
      }
    }
  }

  function stopRinging() {
    if (_sound) { _sound.stop(); _sound = null; }
    Ringtone.stopAll();
    clearInterval(_vibrateTimer);
    _vibrateTimer = null;
    if (navigator.vibrate) { try { navigator.vibrate(0); } catch (_) {} }
  }

  function requestWakeLock() {
    if (!navigator.wakeLock || _wakeLock) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      _wakeLock = lock;
      lock.addEventListener('release', function () { _wakeLock = null; });
    }).catch(function () {});
  }

  function releaseWakeLock() {
    if (_wakeLock) {
      try { _wakeLock.release(); } catch (_) {}
      _wakeLock = null;
    }
  }

  /* ---------- rendering ---------- */

  function updateClock() {
    var host = el();
    if (!host) return;
    var clock = host.querySelector('.alarm-clock');
    if (!clock) return;
    var s = Store.settings();
    var now = new Date();
    clock.textContent = Sched.clockLabel(now.getHours(), now.getMinutes(), s.time24);
    var secs = host.querySelector('.alarm-seconds');
    if (secs) secs.textContent = Sched.pad2(now.getSeconds());
  }

  function render() {
    var host = el();
    var item = current();
    if (!host || !item) return;

    var s = Store.settings();
    var note = item.note;
    var rem = item.reminder;
    var now = new Date();
    var preview = MD.plain(note.body, 260);
    var title = rem.label || note.title || 'Reminder';
    var dsnooze = s.defaultSnooze || { every: 5, unit: 'minutes' };

    host.innerHTML =
      '<div class="alarm-sheet color-' + MD.esc(note.color) + (item.missed ? ' is-missed' : '') + '" role="alertdialog" aria-modal="true" aria-label="Alarm">' +
        '<div class="alarm-rings" aria-hidden="true"><span></span><span></span><span></span></div>' +
        '<div class="alarm-top">' +
          '<span class="alarm-kind">' + (item.missed ? '⏳ Missed alarm' : '⏰ Alarm') + '</span>' +
          (_queue.length > 1 ? '<span class="alarm-count">1 of ' + _queue.length + '</span>' : '') +
        '</div>' +
        '<div class="alarm-time">' +
          '<span class="alarm-clock">' + MD.esc(Sched.clockLabel(now.getHours(), now.getMinutes(), s.time24)) + '</span>' +
          '<span class="alarm-seconds">' + Sched.pad2(now.getSeconds()) + '</span>' +
        '</div>' +
        (item.missed ? '<div class="alarm-was">was due ' + MD.esc(Sched.relative(item.at)) + '</div>' : '') +
        '<h1 class="alarm-title">' + MD.esc(title) + '</h1>' +
        (rem.label && note.title ? '<div class="alarm-note-title">' + MD.esc(note.title) + '</div>' : '') +
        (preview ? '<p class="alarm-body">' + MD.esc(preview) + '</p>' : '') +
        '<div class="alarm-schedule">' + MD.esc(Sched.describe(rem, s.time24)) +
          (rem.nextAt ? ' · next ' + MD.esc(Sched.dateLabel(rem.nextAt, s.time24)) : '') +
        '</div>' +
        '<div class="alarm-actions">' +
          '<button class="alarm-btn alarm-snooze" data-act="snooze">' +
            '<span class="alarm-btn-icon" aria-hidden="true">😴</span>' +
            'Snooze <small>' + dsnooze.every + ' ' + MD.esc(dsnooze.unit === 'minutes' ? 'min' : dsnooze.unit) + '</small>' +
          '</button>' +
          '<button class="alarm-btn alarm-done" data-act="done">' +
            '<span class="alarm-btn-icon" aria-hidden="true">✅</span>Mark done' +
          '</button>' +
          '<button class="alarm-btn alarm-dismiss" data-act="dismiss">' +
            '<span class="alarm-btn-icon" aria-hidden="true">✔</span>Dismiss' +
          '</button>' +
        '</div>' +
        '<div class="alarm-more">' +
          '<button class="alarm-link" data-act="snooze-menu" aria-haspopup="true">Snooze for…</button>' +
          '<button class="alarm-link" data-act="open">Open note</button>' +
          '<button class="alarm-link" data-act="silence">Silence</button>' +
        '</div>' +
        '<div class="alarm-snooze-menu' + (_snoozeOpen ? ' open' : '') + '" role="menu">' +
          SNOOZE_CHOICES.map(function (c, i) {
            return '<button role="menuitem" data-act="snooze-pick" data-i="' + i + '">' + c.label + '</button>';
          }).join('') +
        '</div>' +
      '</div>';

    host.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        handle(btn.getAttribute('data-act'), btn);
      });
    });

    var focusTarget = host.querySelector('.alarm-dismiss');
    if (focusTarget) setTimeout(function () { try { focusTarget.focus(); } catch (_) {} }, 60);
  }

  function handle(act, btn) {
    var item = current();
    if (!item) return;
    var s = Store.settings();
    var noteId = item.note.id;
    var remId = item.reminder.id;

    if (act === 'snooze') {
      var d = s.defaultSnooze || { every: 5, unit: 'minutes' };
      Engine.snooze(noteId, remId, d.every, d.unit);
      UI.toast('Snoozed for ' + d.every + ' ' + d.unit);
      next();
      return;
    }
    if (act === 'snooze-menu') {
      _snoozeOpen = !_snoozeOpen;
      var menu = el().querySelector('.alarm-snooze-menu');
      if (menu) menu.classList.toggle('open', _snoozeOpen);
      return;
    }
    if (act === 'snooze-pick') {
      var c = SNOOZE_CHOICES[Number(btn.getAttribute('data-i'))];
      Engine.snooze(noteId, remId, c.every, c.unit);
      UI.toast('Snoozed · ' + c.label);
      next();
      return;
    }
    if (act === 'done') {
      Engine.complete(noteId, remId);
      Ringtone.blip('done');
      UI.toast('Marked done');
      next();
      return;
    }
    if (act === 'dismiss') {
      Engine.dismiss(noteId, remId);
      next();
      return;
    }
    if (act === 'silence') {
      stopRinging();
      return;
    }
    if (act === 'open') {
      Engine.dismiss(noteId, remId);
      var id = noteId;
      next();
      if (!_queue.length) UI.openEditor(id);
      return;
    }
  }

  function isRinging() {
    return _queue.length > 0;
  }

  function keydown(e) {
    if (!isRinging()) return false;
    var k = e.key.toLowerCase();
    if (k === 's') { handle('snooze'); return true; }
    if (k === 'd' || k === 'escape') { handle('dismiss'); return true; }
    if (k === 'enter') { handle('done'); return true; }
    return false;
  }

  function init() {
    _el = document.getElementById('alarm-screen');
    // A pending alarm keeps ringing across a reload, so stop the audio if the
    // page is being torn down.
    window.addEventListener('pagehide', stopRinging);
  }

  return {
    init: init,
    enqueue: enqueue,
    isRinging: isRinging,
    keydown: keydown,
    stopRinging: stopRinging,
    close: close,
    SNOOZE_CHOICES: SNOOZE_CHOICES
  };
})();

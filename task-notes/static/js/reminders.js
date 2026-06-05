var ReminderEngine = (function () {
  var _tickInterval = null;

  function UNIT_MS(unit) {
    return Model.UNIT_MS(unit);
  }

  function _inQuietHours(qh) {
    if (!qh || !qh.start || !qh.end) return false;
    var now = new Date();
    var hhmm = now.getHours() * 100 + now.getMinutes();
    var s = parseInt(qh.start.replace(':', ''), 10);
    var e = parseInt(qh.end.replace(':', ''), 10);
    if (s > e) return hhmm >= s || hhmm < e;  // crosses midnight
    return hhmm >= s && hhmm < e;
  }

  function _quietHoursEnd(qh) {
    if (!qh || !qh.end) return Date.now();
    var now = new Date();
    var parts = qh.end.split(':');
    var end = new Date(now);
    end.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
    if (end <= now) end.setDate(end.getDate() + 1);
    return end.getTime();
  }

  function _advanceDueAt(dueAt, repeat, customEvery, customUnit) {
    var d = new Date(dueAt);
    switch (repeat) {
      case 'daily':
        d.setDate(d.getDate() + 1);
        break;
      case 'weekly':
        d.setDate(d.getDate() + 7);
        break;
      case 'weekdays':
        d.setDate(d.getDate() + 1);
        while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
        break;
      case 'monthly':
        var origDay = d.getDate();
        d.setMonth(d.getMonth() + 1);
        // clamp if month is shorter
        var maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(origDay, maxDay));
        break;
      case 'custom':
        d = new Date(dueAt + (customEvery || 1) * UNIT_MS(customUnit || 'days'));
        break;
      default:
        return null; // one-shot, disable after firing
    }
    return d.getTime();
  }

  function computeNextFireAt(reminder, now) {
    if (!reminder.enabled || reminder.mode === 'none') return null;
    now = now || Date.now();

    if (reminder.mode === 'interval') {
      var anchor = reminder.intervalAnchor || now;
      var step = (reminder.intervalEvery || 1) * UNIT_MS(reminder.intervalUnit);
      var k = Math.ceil((now - anchor) / step);
      if (k <= 0) k = 1;
      var next = anchor + k * step;
      if (reminder.quietHours && _inQuietHours(reminder.quietHours)) {
        return _quietHoursEnd(reminder.quietHours);
      }
      return next;
    }

    if (reminder.mode === 'datetime') {
      if (!reminder.dueAt) return null;
      var fire = reminder.dueAt - (reminder.leadTime || 0) * 60000;
      if (fire <= now) {
        // already past, advance if repeating
        if (reminder.repeat && reminder.repeat !== 'none') {
          var nextDue = _advanceDueAt(reminder.dueAt, reminder.repeat, reminder.customRepeatEvery, reminder.customRepeatUnit);
          if (!nextDue) return null;
          return nextDue - (reminder.leadTime || 0) * 60000;
        }
        return null; // past, no repeat
      }
      if (reminder.quietHours && _inQuietHours(reminder.quietHours)) {
        return _quietHoursEnd(reminder.quietHours);
      }
      return fire;
    }

    return null;
  }

  function _fireTask(task) {
    var now = Date.now();
    var rem = task.reminder;
    rem.lastFiredAt = now;
    rem.acknowledgedAt = null;

    // advance nextFireAt after fire
    if (rem.autoSnooze) {
      rem.snoozeCount = (rem.snoozeCount || 0) + 1;
      if (rem.maxSnoozes && rem.snoozeCount >= rem.maxSnoozes) {
        rem.nextFireAt = null; // exhausted
      } else {
        rem.nextFireAt = now + (rem.snoozeEvery || 5) * UNIT_MS(rem.snoozeUnit || 'minutes');
      }
    } else {
      // advance to normal next occurrence
      rem.snoozeCount = 0;
      if (rem.mode === 'interval') {
        rem.nextFireAt = computeNextFireAt(rem, now);
      } else if (rem.mode === 'datetime') {
        if (rem.repeat && rem.repeat !== 'none') {
          var nextDue = _advanceDueAt(rem.dueAt, rem.repeat, rem.customRepeatEvery, rem.customRepeatUnit);
          rem.dueAt = nextDue;
          rem.nextFireAt = nextDue ? computeNextFireAt(rem, now) : null;
        } else {
          rem.nextFireAt = null;
        }
      }
    }

    Store.upsertTask(task);

    Notifier.alert(
      task,
      function (every, unit) { _handleSnooze(task, every, unit); },
      function () { _handleDismiss(task); },
      function () { UI.openEditor(task.id); },
      false
    );
  }

  function _handleSnooze(task, every, unit) {
    var rem = task.reminder;
    rem.nextFireAt = Date.now() + every * UNIT_MS(unit);
    rem.snoozeCount = (rem.snoozeCount || 0);
    Store.upsertTask(task);
  }

  function _handleDismiss(task) {
    var rem = task.reminder;
    rem.acknowledgedAt = Date.now();
    rem.snoozeCount = 0;
    // advance to next normal occurrence
    if (rem.mode === 'interval') {
      rem.nextFireAt = computeNextFireAt(rem, Date.now());
    } else if (rem.mode === 'datetime') {
      if (rem.repeat && rem.repeat !== 'none') {
        var nextDue = _advanceDueAt(rem.dueAt, rem.repeat, rem.customRepeatEvery, rem.customRepeatUnit);
        rem.dueAt = nextDue;
        rem.nextFireAt = nextDue ? computeNextFireAt(rem, Date.now()) : null;
      } else {
        rem.nextFireAt = null;
      }
    }
    Store.upsertTask(task);
  }

  function sweep(catchUp) {
    var now = Date.now();
    var tasks = Store.getTasks();
    tasks.forEach(function (task) {
      var rem = task.reminder;
      if (!rem.enabled || !rem.nextFireAt) return;
      if (now >= rem.nextFireAt) {
        _fireTask(task);
        if (catchUp && UI && UI.showMissedBadge) {
          // mark as missed
        }
      }
    });
  }

  function refreshAll() {
    var now = Date.now();
    var tasks = Store.getTasks();
    tasks.forEach(function (task) {
      var rem = task.reminder;
      if (!rem.enabled) return;
      if (!rem.nextFireAt && rem.mode !== 'none') {
        rem.nextFireAt = computeNextFireAt(rem, now);
        Store.upsertTask(task);
      }
    });
  }

  function catchUpMissed() {
    var now = Date.now();
    var tasks = Store.getTasks();
    tasks.forEach(function (task) {
      var rem = task.reminder;
      if (!rem.enabled || !rem.nextFireAt) return;
      if (now > rem.nextFireAt + 5000) {
        // missed — fire immediately with missed flag
        rem.lastFiredAt = now;
        rem.acknowledgedAt = null;
        rem.nextFireAt = null;
        Store.upsertTask(task);
        Notifier.alert(
          task,
          function (every, unit) { _handleSnooze(task, every, unit); },
          function () { _handleDismiss(task); },
          function () { if (UI) UI.openEditor(task.id); },
          true  // missed flag
        );
      }
    });
  }

  function enableTask(task) {
    var rem = task.reminder;
    if (!rem.intervalAnchor && rem.mode === 'interval') {
      rem.intervalAnchor = Date.now();
    }
    rem.nextFireAt = computeNextFireAt(rem, Date.now());
    rem.snoozeCount = 0;
    Store.upsertTask(task);
  }

  function disableTask(task) {
    task.reminder.nextFireAt = null;
    task.reminder.snoozeCount = 0;
    Store.upsertTask(task);
  }

  function start() {
    catchUpMissed();
    _tickInterval = setInterval(function () { sweep(false); }, 1000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') sweep(false);
    });
    window.addEventListener('focus', function () { sweep(false); });
  }

  function stop() {
    clearInterval(_tickInterval);
  }

  return {
    start: start,
    stop: stop,
    sweep: sweep,
    refreshAll: refreshAll,
    computeNextFireAt: computeNextFireAt,
    enableTask: enableTask,
    disableTask: disableTask
  };
})();

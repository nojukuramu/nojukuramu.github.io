var ReminderEngine = (function () {
  var _tickInterval = null;

  function UNIT_MS(unit) {
    return Model.UNIT_MS(unit);
  }

  // Safely parse an "HH:MM" string, clamping to valid ranges with a 09:00 fallback.
  function _parseHHMM(str) {
    var parts = (str || '').split(':');
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (isNaN(h) || h < 0 || h > 23) h = 9;
    if (isNaN(m) || m < 0 || m > 59) m = 0;
    return { h: h, m: m };
  }

  function _inQuietHours(qh, atMs) {
    if (!qh || !qh.start || !qh.end) return false;
    var d = new Date(atMs || Date.now());
    var hhmm = d.getHours() * 100 + d.getMinutes();
    var s = parseInt(qh.start.replace(':', ''), 10);
    var e = parseInt(qh.end.replace(':', ''), 10);
    if (s > e) return hhmm >= s || hhmm < e;  // crosses midnight
    return hhmm >= s && hhmm < e;
  }

  function _quietHoursEnd(qh, fromMs) {
    if (!qh || !qh.end) return fromMs || Date.now();
    var ref = new Date(fromMs || Date.now());
    var parts = qh.end.split(':');
    var end = new Date(ref);
    end.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), 0, 0);
    if (end <= ref) end.setDate(end.getDate() + 1);
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
        var maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(origDay, maxDay));
        break;
      case 'custom':
        d = new Date(dueAt + (customEvery || 1) * UNIT_MS(customUnit || 'days'));
        break;
      default:
        return null;
    }
    return d.getTime();
  }

  // Compute next fire for interval/monthly-date: every Nth day of the month at HH:MM
  function _nextMonthlyDate(rem, now) {
    var day = parseInt(rem.intervalMonthDay, 10);
    if (isNaN(day)) day = 1;
    day = Math.max(1, Math.min(31, day));
    var t = _parseHHMM(rem.intervalDayTime);
    var h = t.h, m = t.m;

    // Try this month
    var candidate = new Date(now);
    candidate.setDate(1);
    candidate.setHours(h, m, 0, 0);
    var maxDayThisMonth = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
    candidate.setDate(Math.min(day, maxDayThisMonth));

    if (candidate.getTime() > now) {
      if (rem.quietHours && _inQuietHours(rem.quietHours, candidate.getTime())) {
        return _quietHoursEnd(rem.quietHours, candidate.getTime());
      }
      return candidate.getTime();
    }

    // Advance to next month
    candidate.setDate(1);
    candidate.setMonth(candidate.getMonth() + 1);
    var maxDayNext = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
    candidate.setDate(Math.min(day, maxDayNext));
    candidate.setHours(h, m, 0, 0);

    if (rem.quietHours && _inQuietHours(rem.quietHours, candidate.getTime())) {
      return _quietHoursEnd(rem.quietHours, candidate.getTime());
    }
    return candidate.getTime();
  }

  // Compute next fire for interval/weekly-day: every specific weekday at HH:MM
  function _nextWeeklyDay(rem, now) {
    var targetDay = parseInt(rem.intervalWeekDay, 10);
    if (isNaN(targetDay) || targetDay < 0 || targetDay > 6) targetDay = 1;
    var t = _parseHHMM(rem.intervalDayTime);
    var h = t.h, m = t.m;

    var candidate = new Date(now);
    candidate.setHours(h, m, 0, 0);

    var daysUntil = (targetDay - candidate.getDay() + 7) % 7;
    if (daysUntil === 0 && candidate.getTime() <= now) {
      daysUntil = 7;
    }
    candidate.setDate(candidate.getDate() + daysUntil);

    if (rem.quietHours && _inQuietHours(rem.quietHours, candidate.getTime())) {
      return _quietHoursEnd(rem.quietHours, candidate.getTime());
    }
    return candidate.getTime();
  }

  function computeNextFireAt(reminder, now) {
    if (!reminder.enabled || reminder.mode === 'none') return null;
    now = now || Date.now();

    if (reminder.mode === 'interval') {
      var itype = reminder.intervalType || 'frequency';

      if (itype === 'monthly-date') {
        return _nextMonthlyDate(reminder, now);
      }

      if (itype === 'weekly-day') {
        return _nextWeeklyDay(reminder, now);
      }

      // frequency sub-type (default)
      var anchor = reminder.intervalAnchor || now;
      var step = (reminder.intervalEvery || 1) * UNIT_MS(reminder.intervalUnit);
      var k = Math.ceil((now - anchor) / step);
      if (k <= 0) k = 1;
      var next = anchor + k * step;
      if (reminder.quietHours && _inQuietHours(reminder.quietHours, next)) {
        return _quietHoursEnd(reminder.quietHours, next);
      }
      return next;
    }

    if (reminder.mode === 'datetime') {
      if (!reminder.dueAt) return null;
      var fire = reminder.dueAt - (reminder.leadTime || 0) * 60000;
      if (fire <= now) {
        if (reminder.repeat && reminder.repeat !== 'none') {
          var nextDue = _advanceDueAt(reminder.dueAt, reminder.repeat, reminder.customRepeatEvery, reminder.customRepeatUnit);
          if (!nextDue) return null;
          fire = nextDue - (reminder.leadTime || 0) * 60000;
        } else {
          return null;
        }
      }
      if (reminder.quietHours && _inQuietHours(reminder.quietHours, fire)) {
        return _quietHoursEnd(reminder.quietHours, fire);
      }
      return fire;
    }

    return null;
  }

  function _advanceReminder(rem, now) {
    if (rem.autoSnooze) {
      rem.snoozeCount = (rem.snoozeCount || 0) + 1;
      if (rem.maxSnoozes && rem.snoozeCount >= rem.maxSnoozes) {
        rem.nextFireAt = null;
      } else {
        rem.nextFireAt = now + (rem.snoozeEvery || 5) * UNIT_MS(rem.snoozeUnit || 'minutes');
      }
    } else {
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
  }

  function _fireTask(task) {
    var now = Date.now();
    var rem = task.reminder;
    rem.lastFiredAt = now;
    rem.acknowledgedAt = null;
    _advanceReminder(rem, now);
    Store.upsertTask(task);
    Notifier.alert(
      task,
      function (every, unit) { _handleSnooze(task, every, unit); },
      function () { _handleDismiss(task); },
      function () { UI.openEditor(task.id); },
      false
    );
  }

  function _fireSubtask(parentTask, subtask) {
    var now = Date.now();
    var rem = subtask.reminder;
    rem.lastFiredAt = now;
    rem.acknowledgedAt = null;
    _advanceReminder(rem, now);
    Store.upsertTask(parentTask);

    // Build a virtual task object for Notifier.alert
    var virtualTask = {
      id: subtask.id,
      title: subtask.title + ' • ' + parentTask.title,
      notes: subtask.notes || '',
      priority: 'normal'
    };
    Notifier.alert(
      virtualTask,
      function (every, unit) { _handleSubtaskSnooze(parentTask, subtask, every, unit); },
      function () { _handleSubtaskDismiss(parentTask, subtask); },
      function () { UI.openEditor(parentTask.id); },
      false
    );
  }

  function _handleSnooze(task, every, unit) {
    var rem = task.reminder;
    rem.nextFireAt = Date.now() + every * UNIT_MS(unit);
    Store.upsertTask(task);
  }

  function _handleDismiss(task) {
    var rem = task.reminder;
    rem.acknowledgedAt = Date.now();
    rem.snoozeCount = 0;
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

  function _handleSubtaskSnooze(parentTask, subtask, every, unit) {
    subtask.reminder.nextFireAt = Date.now() + every * UNIT_MS(unit);
    Store.upsertTask(parentTask);
  }

  function _handleSubtaskDismiss(parentTask, subtask) {
    var rem = subtask.reminder;
    rem.acknowledgedAt = Date.now();
    rem.snoozeCount = 0;
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
    Store.upsertTask(parentTask);
  }

  function sweep(catchUp) {
    var now = Date.now();
    var tasks = Store.getTasks();
    tasks.forEach(function (task) {
      // Sweep task-level reminder
      var rem = task.reminder;
      if (rem.enabled && rem.nextFireAt && now >= rem.nextFireAt) {
        _fireTask(task);
      }
      // Sweep subtask reminders
      (task.subtasks || []).forEach(function (subtask) {
        var srem = subtask.reminder;
        if (srem && srem.enabled && srem.nextFireAt && now >= srem.nextFireAt) {
          _fireSubtask(task, subtask);
        }
      });
    });
  }

  function refreshAll() {
    var now = Date.now();
    var tasks = Store.getTasks();
    tasks.forEach(function (task) {
      var rem = task.reminder;
      var changed = false;
      if (rem.enabled && !rem.nextFireAt && rem.mode !== 'none') {
        rem.nextFireAt = computeNextFireAt(rem, now);
        changed = true;
      }
      (task.subtasks || []).forEach(function (subtask) {
        var srem = subtask.reminder;
        if (srem && srem.enabled && !srem.nextFireAt && srem.mode !== 'none') {
          srem.nextFireAt = computeNextFireAt(srem, now);
          changed = true;
        }
      });
      if (changed) Store.upsertTask(task);
    });
  }

  function catchUpMissed() {
    var now = Date.now();
    var tasks = Store.getTasks();
    tasks.forEach(function (task) {
      var rem = task.reminder;
      var changed = false;
      if (rem.enabled && rem.nextFireAt && now > rem.nextFireAt + 5000) {
        rem.lastFiredAt = now;
        rem.acknowledgedAt = null;
        rem.nextFireAt = null;
        changed = true;
        Notifier.alert(
          task,
          function (every, unit) { _handleSnooze(task, every, unit); },
          function () { _handleDismiss(task); },
          function () { if (UI) UI.openEditor(task.id); },
          true
        );
      }
      (task.subtasks || []).forEach(function (subtask) {
        var srem = subtask.reminder;
        if (srem && srem.enabled && srem.nextFireAt && now > srem.nextFireAt + 5000) {
          srem.lastFiredAt = now;
          srem.acknowledgedAt = null;
          srem.nextFireAt = null;
          changed = true;
          var virtualTask = {
            id: subtask.id,
            title: subtask.title + ' • ' + task.title,
            notes: subtask.notes || '',
            priority: 'normal'
          };
          Notifier.alert(
            virtualTask,
            function (every, unit) { _handleSubtaskSnooze(task, subtask, every, unit); },
            function () { _handleSubtaskDismiss(task, subtask); },
            function () { if (UI) UI.openEditor(task.id); },
            true
          );
        }
      });
      if (changed) Store.upsertTask(task);
    });
  }

  // Mutate a reminder's schedule in place (no persistence). Works for both
  // task and subtask reminders since both share the reminder sub-object shape.
  function _applyEnableReminder(rem) {
    if (!rem.intervalAnchor && rem.mode === 'interval' && (rem.intervalType || 'frequency') === 'frequency') {
      rem.intervalAnchor = Date.now();
    }
    rem.nextFireAt = computeNextFireAt(rem, Date.now());
    rem.snoozeCount = 0;
  }

  function _applyDisableReminder(rem) {
    rem.nextFireAt = null;
    rem.snoozeCount = 0;
  }

  // Apply the correct enabled/disabled schedule based on the reminder's own
  // state, without persisting. Callers batch a single Store write afterwards.
  function applyReminderState(rem) {
    if (rem && rem.enabled && rem.mode !== 'none') _applyEnableReminder(rem);
    else if (rem) _applyDisableReminder(rem);
  }

  function enableTask(task) {
    _applyEnableReminder(task.reminder);
    Store.upsertTask(task);
  }

  function disableTask(task) {
    _applyDisableReminder(task.reminder);
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
    applyReminderState: applyReminderState,
    enableTask: enableTask,
    disableTask: disableTask,
    dismissTask: _handleDismiss,
    snoozeTask: _handleSnooze
  };
})();

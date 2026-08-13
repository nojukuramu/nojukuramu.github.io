/* engine.js — the reminder scheduler.
 *
 * The old build polled every second. This one sleeps until the next reminder
 * is actually due (capped so it can correct for a laptop lid closing), which
 * is both accurate and cheap.
 */
var Engine = (function () {
  'use strict';

  var MAX_SLEEP = 30000;     // wake up at least this often to correct drift
  var MISSED_GRACE = 45000;  // later than this and we call it "missed"

  var _timer = null;
  var _started = false;
  var _lastTick = Date.now();

  function opts() {
    return { quietHours: Store.settings().quietHours };
  }

  /* Only one open tab should ring for a given firing. */
  function claim(key) {
    var k = 'tn:lock:' + key;
    var now = Date.now();
    try {
      var prev = parseInt(localStorage.getItem(k) || '0', 10);
      if (now - prev < 20000) return false;
      localStorage.setItem(k, String(now));
      if (Math.random() < 0.05) pruneLocks(now);
      return true;
    } catch (_) {
      return true;
    }
  }

  function pruneLocks(now) {
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('tn:lock:') === 0) {
          var v = parseInt(localStorage.getItem(k) || '0', 10);
          if (now - v > 3600000) kill.push(k);
        }
      }
      kill.forEach(function (k) { localStorage.removeItem(k); });
    } catch (_) {}
  }

  function isLive(note) {
    return note && !note.trashed && !note.archived;
  }

  function isRecurring(rem) {
    return rem.kind !== 'once';
  }

  function shouldRun(note, rem) {
    if (!isLive(note)) return false;
    if (!rem.enabled) return false;
    if (note.done && !isRecurring(rem)) return false;
    return true;
  }

  /* Fill in nextAt for anything that lost it (new reminder, edited, imported). */
  function refresh(persist) {
    var now = Date.now();
    var changed = [];
    Store.notes().forEach(function (note) {
      var dirty = false;
      note.reminders.forEach(function (rem) {
        if (!rem.enabled) {
          if (rem.nextAt || rem.snoozedUntil) { rem.nextAt = null; rem.snoozedUntil = null; dirty = true; }
          return;
        }
        if (rem.nextAt == null && rem.snoozedUntil == null) {
          if (rem.kind === 'interval' && !rem.anchor) rem.anchor = now;
          rem.nextAt = Sched.nextOccurrence(rem, now, opts());
          dirty = true;
        }
      });
      if (dirty) changed.push(note);
    });
    if (changed.length && persist !== false) {
      return Store.putMany(changed, { touch: false, reason: 'engine-refresh' });
    }
    return Promise.resolve();
  }

  /* Recompute every reminder on one note — used after editing. */
  function rescheduleNote(note) {
    var now = Date.now();
    note.reminders.forEach(function (rem) {
      if (!rem.enabled) {
        rem.nextAt = null;
        rem.snoozedUntil = null;
        return;
      }
      if (rem.kind === 'interval' && !rem.anchor) rem.anchor = now;
      rem.snoozedUntil = null;
      rem.snoozeCount = 0;
      rem.nextAt = Sched.nextOccurrence(rem, now, opts());
    });
    return note;
  }

  /* Everything currently pending, soonest first. */
  function pending() {
    var out = [];
    Store.notes().forEach(function (note) {
      note.reminders.forEach(function (rem) {
        if (!shouldRun(note, rem)) return;
        var at = Sched.effectiveNext(rem);
        if (at) out.push({ note: note, reminder: rem, at: at });
      });
    });
    out.sort(function (a, b) { return a.at - b.at; });
    return out;
  }

  function upcoming(limit, withinMs) {
    var now = Date.now();
    var list = pending().filter(function (it) {
      return it.at >= now && (!withinMs || it.at <= now + withinMs);
    });
    return limit ? list.slice(0, limit) : list;
  }

  function overdueNotes() {
    var now = Date.now();
    return Store.notes().filter(function (note) {
      if (!isLive(note) || note.done) return false;
      return note.reminders.some(function (rem) {
        if (!rem.enabled) return false;
        if (rem.kind !== 'once') return false;
        return rem.at && rem.at < now;
      });
    });
  }

  /* Advance a reminder past a firing, honouring auto-snooze. */
  function advanceAfterFire(rem, now) {
    var scheduled = Sched.nextOccurrence(rem, now, opts());
    rem.lastFiredAt = now;
    rem.firedCount = (rem.firedCount || 0) + 1;
    rem.nextAt = scheduled;

    var as = rem.autoSnooze || {};
    if (as.enabled && (rem.snoozeCount || 0) < (as.max || 3)) {
      rem.snoozeCount = (rem.snoozeCount || 0) + 1;
      rem.snoozedUntil = now + Math.max(1, as.every || 5) * Sched.unitMs(as.unit || 'minutes');
    } else {
      rem.snoozeCount = 0;
      rem.snoozedUntil = null;
    }

    if (rem.kind === 'once' && !rem.nextAt && !rem.snoozedUntil) rem.enabled = false;
  }

  function fire(items) {
    if (!items.length) return Promise.resolve();
    var now = Date.now();
    var touched = {};
    var ringing = [];

    items.forEach(function (it) {
      var note = it.note;
      var rem = it.reminder;
      if (!claim(rem.id + ':' + Math.round(it.at / 30000))) return;

      // A recurring alarm on a completed note resets it — that is what makes
      // "water the plants, every Tuesday" work.
      if (note.done && isRecurring(rem)) {
        note.done = false;
        note.doneAt = null;
      }
      advanceAfterFire(rem, now);
      touched[note.id] = note;
      ringing.push({ note: note, reminder: rem, missed: it.missed, at: it.at });
    });

    if (!ringing.length) return Promise.resolve();

    var list = Object.keys(touched).map(function (k) { return touched[k]; });
    return Store.putMany(list, { touch: false, reason: 'fire' }).then(function () {
      ringing.forEach(function (r) {
        if (document.visibilityState !== 'visible' || !r.reminder.alarm) {
          Notifier.show(r.note, r.reminder, { missed: r.missed });
        }
      });
      Alarm.enqueue(ringing);
      plan();
    });
  }

  function tick() {
    var now = Date.now();
    _lastTick = now;
    var due = [];
    Store.notes().forEach(function (note) {
      note.reminders.forEach(function (rem) {
        if (!shouldRun(note, rem)) return;
        var at = Sched.effectiveNext(rem);
        if (at && at <= now) {
          due.push({ note: note, reminder: rem, at: at, missed: now - at > MISSED_GRACE });
        }
      });
    });
    if (due.length) return fire(due);
    plan();
    return Promise.resolve();
  }

  /* Sleep exactly as long as we can get away with. */
  function plan() {
    clearTimeout(_timer);
    var list = pending();
    var now = Date.now();
    var wait = MAX_SLEEP;
    if (list.length) {
      wait = Math.max(0, Math.min(MAX_SLEEP, list[0].at - now));
    }
    _timer = setTimeout(tick, wait);
    pushTriggers();
  }

  var _triggerTimer = null;
  function pushTriggers() {
    clearTimeout(_triggerTimer);
    _triggerTimer = setTimeout(function () {
      Notifier.scheduleTriggers(pending());
    }, 1200);
  }

  /* ---------- user responses ---------- */

  function withReminder(noteId, reminderId, fn) {
    var note = Store.byId(noteId);
    if (!note) return Promise.resolve();
    var rem = note.reminders.filter(function (r) { return r.id === reminderId; })[0];
    if (!rem) return Promise.resolve();
    fn(note, rem);
    return Store.put(note, { touch: false, reason: 'reminder' }).then(plan);
  }

  function snooze(noteId, reminderId, every, unit) {
    return withReminder(noteId, reminderId, function (note, rem) {
      rem.snoozedUntil = Date.now() + Math.max(1, every) * Sched.unitMs(unit || 'minutes');
      rem.snoozeCount = 0;
      rem.enabled = true;
      Notifier.clearFor(reminderId);
    });
  }

  function dismiss(noteId, reminderId) {
    return withReminder(noteId, reminderId, function (note, rem) {
      var now = Date.now();
      rem.snoozedUntil = null;
      rem.snoozeCount = 0;
      rem.nextAt = Sched.nextOccurrence(rem, now, opts());
      if (rem.kind === 'once' && !rem.nextAt) rem.enabled = false;
      Notifier.clearFor(reminderId);
    });
  }

  function complete(noteId, reminderId) {
    return withReminder(noteId, reminderId, function (note, rem) {
      var now = Date.now();
      note.done = true;
      note.doneAt = now;
      note.updatedAt = now;
      rem.snoozedUntil = null;
      rem.snoozeCount = 0;
      rem.nextAt = Sched.nextOccurrence(rem, now, opts());
      if (rem.kind === 'once' && !rem.nextAt) rem.enabled = false;
      Notifier.clearFor(reminderId);
    });
  }

  /* Turn every alarm on a note off — used when trashing or archiving. */
  function silence(note) {
    note.reminders.forEach(function (rem) {
      rem.snoozedUntil = null;
      rem.snoozeCount = 0;
      Notifier.clearFor(rem.id);
    });
    return note;
  }

  function start() {
    if (_started) return Promise.resolve();
    _started = true;
    return refresh().then(function () {
      tick();
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') tick();
      });
      window.addEventListener('focus', function () { tick(); });
      window.addEventListener('online', function () { tick(); });
      Store.onChange(function (detail) {
        if (detail.reason === 'fire' || detail.reason === 'engine-refresh') return;
        refresh(true).then(plan);
      });
    });
  }

  return {
    start: start,
    tick: tick,
    plan: plan,
    refresh: refresh,
    rescheduleNote: rescheduleNote,
    pending: pending,
    upcoming: upcoming,
    overdueNotes: overdueNotes,
    snooze: snooze,
    dismiss: dismiss,
    complete: complete,
    silence: silence,
    shouldRun: shouldRun
  };
})();

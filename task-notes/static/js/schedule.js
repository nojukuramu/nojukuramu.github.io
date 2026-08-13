/* schedule.js — recurrence maths for reminders.
 *
 * Like db.js this is shared with the service worker, so it must stay free of
 * DOM/window references. Everything here is pure: give it a reminder and a
 * timestamp, get the next firing time back.
 */
(function (global) {
  'use strict';

  var MINUTE = 60000;
  var HOUR = 3600000;
  var DAY = 86400000;
  var WEEK = 604800000;

  var UNIT_MS = { minutes: MINUTE, hours: HOUR, days: DAY, weeks: WEEK };

  var DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function unitMs(unit) {
    return UNIT_MS[unit] || MINUTE;
  }

  /* ---------- small time helpers ---------- */

  function parseHHMM(str, fallbackH, fallbackM) {
    var parts = String(str || '').split(':');
    var h = parseInt(parts[0], 10);
    var m = parseInt(parts[1], 10);
    if (isNaN(h) || h < 0 || h > 23) h = fallbackH == null ? 9 : fallbackH;
    if (isNaN(m) || m < 0 || m > 59) m = fallbackM == null ? 0 : fallbackM;
    return { h: h, m: m };
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function toHHMM(ms) {
    var d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function startOfDay(ms) {
    var d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function atTimeOn(dateMs, hhmm) {
    var t = parseHHMM(hhmm);
    var d = new Date(dateMs);
    d.setHours(t.h, t.m, 0, 0);
    return d.getTime();
  }

  function addDays(ms, n) {
    var d = new Date(ms);
    d.setDate(d.getDate() + n);
    return d.getTime();
  }

  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function sameDay(a, b) {
    var x = new Date(a), y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  }

  /* ---------- quiet hours ---------- */

  function inQuietHours(qh, atMs) {
    if (!qh || !qh.enabled || !qh.start || !qh.end) return false;
    if (qh.start === qh.end) return false;
    var d = new Date(atMs);
    var cur = d.getHours() * 60 + d.getMinutes();
    var s = parseHHMM(qh.start, 22, 0);
    var e = parseHHMM(qh.end, 7, 0);
    var sm = s.h * 60 + s.m;
    var em = e.h * 60 + e.m;
    if (sm > em) return cur >= sm || cur < em;   // window crosses midnight
    return cur >= sm && cur < em;
  }

  function quietHoursEnd(qh, fromMs) {
    var e = parseHHMM(qh.end, 7, 0);
    var d = new Date(fromMs);
    d.setHours(e.h, e.m, 0, 0);
    if (d.getTime() <= fromMs) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  function applyQuiet(ms, rem, opts) {
    if (ms == null) return null;
    if (!opts || !opts.quietHours) return ms;
    if (rem && rem.respectQuiet === false) return ms;
    if (inQuietHours(opts.quietHours, ms)) return quietHoursEnd(opts.quietHours, ms);
    return ms;
  }

  /* ---------- next occurrence ---------- */

  function rawNext(rem, from) {
    var kind = rem.kind || 'once';
    var i, cand;

    if (kind === 'once') {
      if (!rem.at) return null;
      return rem.at > from ? rem.at : null;
    }

    if (kind === 'daily') {
      cand = atTimeOn(from, rem.time);
      if (cand <= from) cand = atTimeOn(addDays(from, 1), rem.time);
      return cand;
    }

    if (kind === 'weekly') {
      var days = (rem.days && rem.days.length) ? rem.days : [new Date(from).getDay()];
      for (i = 0; i <= 7; i++) {
        var dayMs = addDays(from, i);
        if (days.indexOf(new Date(dayMs).getDay()) === -1) continue;
        cand = atTimeOn(dayMs, rem.time);
        if (cand > from) return cand;
      }
      return null;
    }

    if (kind === 'monthly') {
      var wanted = Math.max(1, Math.min(31, parseInt(rem.monthDay, 10) || 1));
      var ref = new Date(from);
      for (i = 0; i < 13; i++) {
        var y = ref.getFullYear();
        var mo = ref.getMonth() + i;
        var yy = y + Math.floor(mo / 12);
        var mm = ((mo % 12) + 12) % 12;
        var dayNum = Math.min(wanted, daysInMonth(yy, mm));
        var t = parseHHMM(rem.time);
        cand = new Date(yy, mm, dayNum, t.h, t.m, 0, 0).getTime();
        if (cand > from) return cand;
      }
      return null;
    }

    if (kind === 'yearly') {
      var mIdx = Math.max(0, Math.min(11, parseInt(rem.month, 10) || 0));
      var mDay = Math.max(1, Math.min(31, parseInt(rem.monthDay, 10) || 1));
      var tt = parseHHMM(rem.time);
      var year = new Date(from).getFullYear();
      for (i = 0; i < 3; i++) {
        var dnum = Math.min(mDay, daysInMonth(year + i, mIdx));
        cand = new Date(year + i, mIdx, dnum, tt.h, tt.m, 0, 0).getTime();
        if (cand > from) return cand;
      }
      return null;
    }

    if (kind === 'interval') {
      var every = Math.max(1, parseInt(rem.every, 10) || 1);
      var unit = rem.unit || 'minutes';
      var anchor = rem.anchor || rem.createdAt || from;

      if (unit === 'days' || unit === 'weeks') {
        // Day-grained intervals land on a wall-clock time, so step by calendar
        // days rather than by milliseconds (keeps working across DST).
        var stepDays = every * (unit === 'weeks' ? 7 : 1);
        var base = atTimeOn(anchor, rem.time || toHHMM(anchor));
        if (base > from) return base;
        var elapsed = Math.floor((startOfDay(from) - startOfDay(base)) / DAY);
        var k = Math.floor(elapsed / stepDays);
        cand = atTimeOn(addDays(base, k * stepDays), rem.time || toHHMM(anchor));
        while (cand <= from) {
          k++;
          cand = atTimeOn(addDays(base, k * stepDays), rem.time || toHHMM(anchor));
        }
        return cand;
      }

      var step = every * unitMs(unit);
      var n = Math.ceil((from - anchor) / step);
      if (n < 0) n = 0;
      cand = anchor + n * step;
      if (cand <= from) cand += step;
      return cand;
    }

    return null;
  }

  /* Next time this reminder should alert, or null if it is finished.
   * `opts.quietHours` defers alerts that land inside a quiet window. */
  function nextOccurrence(rem, from, opts) {
    if (!rem || rem.enabled === false) return null;
    from = from || Date.now();

    var t = rawNext(rem, from);
    if (t == null) return null;

    if (rem.endAt && t > rem.endAt) return null;
    if (rem.maxCount && (rem.firedCount || 0) >= rem.maxCount) return null;

    return applyQuiet(t, rem, opts);
  }

  /* The effective time the engine should watch: a pending snooze wins over the
   * regular schedule. */
  function effectiveNext(rem) {
    if (!rem || rem.enabled === false) return null;
    var a = rem.snoozedUntil || null;
    var b = rem.nextAt || null;
    if (a && b) return Math.min(a, b);
    return a || b;
  }

  /* Advance a reminder past an occurrence that just fired. Mutates in place. */
  function advance(rem, now, opts) {
    rem.firedCount = (rem.firedCount || 0) + 1;
    rem.lastFiredAt = now;
    rem.snoozedUntil = null;
    rem.nextAt = nextOccurrence(rem, now, opts);
    if (rem.kind === 'once' && !rem.nextAt) rem.enabled = false;
    return rem;
  }

  /* ---------- human-readable descriptions ---------- */

  function ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function timeLabel(ms, time24) {
    var d = new Date(ms);
    return clockLabel(d.getHours(), d.getMinutes(), time24);
  }

  function clockLabel(h, m, time24) {
    if (time24) return pad2(h) + ':' + pad2(m);
    var ap = h < 12 ? 'AM' : 'PM';
    var hh = h % 12;
    if (hh === 0) hh = 12;
    return hh + ':' + pad2(m) + ' ' + ap;
  }

  function hhmmLabel(str, time24) {
    var t = parseHHMM(str);
    return clockLabel(t.h, t.m, time24);
  }

  function dateLabel(ms, time24) {
    var d = new Date(ms);
    var now = new Date();
    var todayStart = startOfDay(now.getTime());
    var diffDays = Math.round((startOfDay(ms) - todayStart) / DAY);
    var time = clockLabel(d.getHours(), d.getMinutes(), time24);
    if (diffDays === 0) return 'Today ' + time;
    if (diffDays === 1) return 'Tomorrow ' + time;
    if (diffDays === -1) return 'Yesterday ' + time;
    if (diffDays > 1 && diffDays < 7) return DAY_LONG[d.getDay()] + ' ' + time;
    var withYear = d.getFullYear() !== now.getFullYear();
    return MONTH_NAMES[d.getMonth()] + ' ' + d.getDate() + (withYear ? ', ' + d.getFullYear() : '') + ' ' + time;
  }

  function describe(rem, time24) {
    if (!rem) return '';
    var k = rem.kind || 'once';
    if (k === 'once') return rem.at ? dateLabel(rem.at, time24) : 'No time set';
    if (k === 'daily') return 'Every day at ' + hhmmLabel(rem.time, time24);
    if (k === 'weekly') {
      var days = (rem.days || []).slice().sort();
      var label;
      if (days.length === 7) label = 'Every day';
      else if (days.length === 5 && days.join() === '1,2,3,4,5') label = 'Weekdays';
      else if (days.length === 2 && days.join() === '0,6') label = 'Weekends';
      else if (!days.length) label = 'Weekly';
      else label = days.map(function (d) { return DAY_NAMES[d]; }).join(', ');
      return label + ' at ' + hhmmLabel(rem.time, time24);
    }
    if (k === 'monthly') return 'Monthly on the ' + ordinal(rem.monthDay || 1) + ' at ' + hhmmLabel(rem.time, time24);
    if (k === 'yearly') return 'Every ' + MONTH_LONG[rem.month || 0] + ' ' + (rem.monthDay || 1) + ' at ' + hhmmLabel(rem.time, time24);
    if (k === 'interval') {
      var every = Math.max(1, parseInt(rem.every, 10) || 1);
      var unit = rem.unit || 'minutes';
      var word = every === 1 ? unit.replace(/s$/, '') : unit;
      var base = 'Every ' + (every === 1 ? '' : every + ' ') + word;
      if (unit === 'days' || unit === 'weeks') base += ' at ' + hhmmLabel(rem.time || '09:00', time24);
      return base;
    }
    return '';
  }

  /* "in 5 min", "2 days ago" */
  function relative(ms, now) {
    now = now || Date.now();
    var diff = ms - now;
    var past = diff < 0;
    var abs = Math.abs(diff);
    var out;
    if (abs < 45000) out = 'less than a minute';
    else if (abs < HOUR) out = Math.round(abs / MINUTE) + ' min';
    else if (abs < DAY) {
      var h = Math.floor(abs / HOUR);
      var m = Math.round((abs % HOUR) / MINUTE);
      out = h + 'h' + (m ? ' ' + m + 'm' : '');
    } else if (abs < 30 * DAY) {
      out = Math.round(abs / DAY) + ' day' + (Math.round(abs / DAY) === 1 ? '' : 's');
    } else if (abs < 365 * DAY) {
      out = Math.round(abs / (30 * DAY)) + ' mo';
    } else {
      out = Math.round(abs / (365 * DAY)) + ' yr';
    }
    return past ? out + ' ago' : 'in ' + out;
  }

  global.Sched = {
    MINUTE: MINUTE, HOUR: HOUR, DAY: DAY, WEEK: WEEK,
    DAY_NAMES: DAY_NAMES, DAY_LONG: DAY_LONG,
    MONTH_NAMES: MONTH_NAMES, MONTH_LONG: MONTH_LONG,
    unitMs: unitMs,
    parseHHMM: parseHHMM,
    toHHMM: toHHMM,
    pad2: pad2,
    startOfDay: startOfDay,
    atTimeOn: atTimeOn,
    addDays: addDays,
    daysInMonth: daysInMonth,
    sameDay: sameDay,
    inQuietHours: inQuietHours,
    quietHoursEnd: quietHoursEnd,
    nextOccurrence: nextOccurrence,
    effectiveNext: effectiveNext,
    advance: advance,
    describe: describe,
    dateLabel: dateLabel,
    timeLabel: timeLabel,
    clockLabel: clockLabel,
    hhmmLabel: hhmmLabel,
    relative: relative,
    ordinal: ordinal
  };
})(typeof self !== 'undefined' ? self : this);

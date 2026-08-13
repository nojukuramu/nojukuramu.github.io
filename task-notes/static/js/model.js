/* model.js — data shapes, defaults and normalisation.
 * Shared with the service worker, so no DOM access.
 */
(function (global) {
  'use strict';

  var COLORS = ['default', 'yellow', 'amber', 'rose', 'lilac', 'sky', 'mint', 'sand', 'slate'];
  var PRIORITIES = ['none', 'low', 'medium', 'high'];
  var RINGTONES = ['chime', 'bell', 'radar', 'pulse', 'marimba', 'digital', 'gentle', 'siren'];

  var _seq = 0;

  function uid(prefix) {
    _seq = (_seq + 1) % 100000;
    return (prefix || 'n') + '_' +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 8) +
      _seq.toString(36);
  }

  function defaultSettings() {
    return {
      theme: 'system',            // system | light | dark
      accent: 'violet',
      density: 'comfortable',     // comfortable | compact
      view: 'grid',               // grid | list | board | agenda | calendar
      scope: 'all',               // all | today | upcoming | overdue | starred | done | archive | trash | notebook:<id> | tag:<name>
      sort: 'manual',             // manual | updated | created | title | due | priority
      showCompleted: true,
      time24: false,
      weekStart: 1,               // 0 = Sunday
      sound: true,
      defaultRingtone: 'chime',
      defaultVolume: 0.8,
      vibrate: true,
      defaultSnooze: { every: 5, unit: 'minutes' },
      autoSnooze: { enabled: true, every: 5, unit: 'minutes', max: 3 },
      quietHours: { enabled: false, start: '22:00', end: '07:00' },
      keepAwake: false,
      notificationsAsked: false,
      onboarded: false,
      lastSeenAt: Date.now()
    };
  }

  function defaultReminder(settings) {
    var s = settings || defaultSettings();
    var now = Date.now();
    var soon = new Date(now + 15 * 60000);
    soon.setSeconds(0, 0);
    return {
      id: uid('r'),
      label: '',
      enabled: true,
      kind: 'once',                 // once | daily | weekly | monthly | yearly | interval
      at: soon.getTime(),
      time: Sched.pad2(soon.getHours()) + ':' + Sched.pad2(soon.getMinutes()),
      days: [new Date().getDay()],
      monthDay: new Date().getDate(),
      month: new Date().getMonth(),
      every: 1,
      unit: 'hours',
      anchor: null,
      endAt: null,
      maxCount: null,
      alarm: true,                  // true = ring until dismissed, false = quiet notification
      ringtone: s.defaultRingtone,
      volume: s.defaultVolume,
      vibrate: s.vibrate,
      respectQuiet: true,
      autoSnooze: {
        enabled: s.autoSnooze.enabled,
        every: s.autoSnooze.every,
        unit: s.autoSnooze.unit,
        max: s.autoSnooze.max
      },
      // runtime bookkeeping
      nextAt: null,
      snoozedUntil: null,
      lastFiredAt: null,
      snoozeCount: 0,
      firedCount: 0,
      createdAt: now
    };
  }

  function normalizeReminder(r, settings) {
    var base = defaultReminder(settings);
    var out = Object.assign({}, base, r || {});
    out.id = (r && r.id) || base.id;
    if (!Array.isArray(out.days)) out.days = base.days;
    out.days = out.days.map(Number).filter(function (d) { return d >= 0 && d <= 6; });
    out.autoSnooze = Object.assign({}, base.autoSnooze, (r && r.autoSnooze) || {});
    if (RINGTONES.indexOf(out.ringtone) === -1) out.ringtone = base.ringtone;
    out.every = Math.max(1, parseInt(out.every, 10) || 1);
    out.volume = Math.max(0, Math.min(1, Number(out.volume)));
    if (isNaN(out.volume)) out.volume = 0.8;
    return out;
  }

  function createNote(fields, settings) {
    var now = Date.now();
    var note = {
      id: uid('n'),
      title: '',
      body: '',
      color: 'default',
      pinned: false,
      starred: false,
      done: false,
      doneAt: null,
      priority: 'none',
      tags: [],
      notebook: null,
      reminders: [],
      archived: false,
      archivedAt: null,
      trashed: false,
      trashedAt: null,
      createdAt: now,
      updatedAt: now,
      order: now
    };
    if (fields) {
      Object.assign(note, fields);
      if (fields.reminders) {
        note.reminders = fields.reminders.map(function (r) { return normalizeReminder(r, settings); });
      }
    }
    return note;
  }

  function normalizeNote(n, settings) {
    var out = Object.assign(createNote(null, settings), n || {});
    if (!Array.isArray(out.tags)) out.tags = [];
    out.tags = out.tags.map(function (t) { return String(t).trim(); }).filter(Boolean);
    if (!Array.isArray(out.reminders)) out.reminders = [];
    out.reminders = out.reminders.map(function (r) { return normalizeReminder(r, settings); });
    if (COLORS.indexOf(out.color) === -1) out.color = 'default';
    if (PRIORITIES.indexOf(out.priority) === -1) out.priority = 'none';
    out.title = String(out.title || '');
    out.body = String(out.body || '');
    out.pinned = !!out.pinned;
    out.starred = !!out.starred;
    out.done = !!out.done;
    out.archived = !!out.archived;
    out.trashed = !!out.trashed;
    if (typeof out.order !== 'number') out.order = out.createdAt || Date.now();
    return out;
  }

  function createNotebook(name, color) {
    return {
      id: uid('b'),
      name: name || 'Notebook',
      color: color || 'violet',
      icon: '📓',
      order: Date.now(),
      createdAt: Date.now()
    };
  }

  /* Checklist progress is parsed out of the note body rather than stored
   * separately — one source of truth, and the markdown stays portable. */
  function checklistStats(body) {
    var total = 0, done = 0;
    String(body || '').split('\n').forEach(function (line) {
      var m = /^\s*[-*]\s+\[( |x|X)\]\s?/.exec(line);
      if (!m) return;
      total++;
      if (m[1] !== ' ') done++;
    });
    return { total: total, done: done };
  }

  function toggleChecklistLine(body, lineIndex) {
    var lines = String(body || '').split('\n');
    var line = lines[lineIndex];
    if (line == null) return body;
    var m = /^(\s*[-*]\s+\[)( |x|X)(\].*)$/.exec(line);
    if (!m) return body;
    lines[lineIndex] = m[1] + (m[2] === ' ' ? 'x' : ' ') + m[3];
    return lines.join('\n');
  }

  global.Model = {
    COLORS: COLORS,
    PRIORITIES: PRIORITIES,
    RINGTONES: RINGTONES,
    uid: uid,
    defaultSettings: defaultSettings,
    defaultReminder: defaultReminder,
    normalizeReminder: normalizeReminder,
    createNote: createNote,
    normalizeNote: normalizeNote,
    createNotebook: createNotebook,
    checklistStats: checklistStats,
    toggleChecklistLine: toggleChecklistLine
  };
})(typeof self !== 'undefined' ? self : this);

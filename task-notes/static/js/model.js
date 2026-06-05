var Model = (function () {
  var _idCounter = 0;

  function genId() {
    var rand = Math.random().toString(36).slice(2, 8);
    var ts = Date.now().toString(36);
    _idCounter++;
    return 'tn_' + ts + rand + _idCounter;
  }

  function genSubId() {
    return 'st_' + Math.random().toString(36).slice(2, 10);
  }

  function defaultReminder() {
    return {
      enabled: false,
      mode: 'none',              // none | datetime | interval
      dueAt: null,
      repeat: 'none',            // none|daily|weekly|weekdays|monthly|custom
      customRepeatEvery: 1,
      customRepeatUnit: 'days',
      leadTime: 0,               // minutes before dueAt
      // interval frequency sub-type
      intervalType: 'frequency', // frequency | monthly-date | weekly-day
      intervalEvery: 1,
      intervalUnit: 'hours',     // minutes|hours|days
      intervalAnchor: null,
      // interval date-picker sub-types
      intervalMonthDay: 1,       // 1-31 for monthly-date
      intervalWeekDay: 1,        // 0=Sun...6=Sat for weekly-day
      intervalDayTime: '09:00',  // HH:MM for monthly-date and weekly-day
      // auto-snooze
      autoSnooze: true,
      snoozeEvery: 5,
      snoozeUnit: 'minutes',
      maxSnoozes: 12,
      quietHours: null,          // {start:'22:00', end:'07:00'} | null
      // engine bookkeeping
      nextFireAt: null,
      lastFiredAt: null,
      snoozeCount: 0,
      acknowledgedAt: null
    };
  }

  function createTask(fields) {
    var now = Date.now();
    var task = {
      id: genId(),
      title: '',
      notes: '',
      done: false,
      color: 'yellow',   // yellow|pink|blue|green|purple|gray
      pinned: false,
      priority: 'normal', // low|normal|high
      tags: [],
      subtasks: [],
      createdAt: now,
      updatedAt: now,
      order: now,
      reminder: defaultReminder()
    };
    if (fields) {
      Object.assign(task, fields);
      if (fields.reminder) {
        task.reminder = Object.assign(defaultReminder(), fields.reminder);
      }
    }
    return task;
  }

  // Subtask shape: {id, title, notes, done, reminder}
  function createSubtask(title) {
    return {
      id: genSubId(),
      title: title || '',
      notes: '',
      done: false,
      reminder: defaultReminder()
    };
  }

  function normalizeSubtask(s) {
    return {
      id: s.id || genSubId(),
      title: s.title || s.text || '',  // 'text' was the old field name
      notes: s.notes || '',
      done: !!s.done,
      reminder: Object.assign(defaultReminder(), s.reminder || {})
    };
  }

  function normalizeTask(task) {
    var base = createTask();
    var out = Object.assign({}, base, task);
    out.reminder = Object.assign(defaultReminder(), task.reminder || {});
    if (!Array.isArray(out.tags)) out.tags = [];
    if (!Array.isArray(out.subtasks)) out.subtasks = [];
    out.subtasks = out.subtasks.map(normalizeSubtask);
    return out;
  }

  function UNIT_MS(unit) {
    return { minutes: 60000, hours: 3600000, days: 86400000 }[unit] || 60000;
  }

  return {
    createTask: createTask,
    createSubtask: createSubtask,
    normalizeTask: normalizeTask,
    normalizeSubtask: normalizeSubtask,
    defaultReminder: defaultReminder,
    genId: genId,
    UNIT_MS: UNIT_MS
  };
})();

var Store = (function () {
  var STORE_KEY = 'task-notes:v1';
  var CURRENT_VERSION = 2;
  var _data = null;
  var _saveTimer = null;
  var _listeners = [];

  var MIGRATIONS = {
    // v1 → v2: expand subtask shape from {id,text,done} to {id,title,notes,done,reminder}
    1: function (data) {
      (data.tasks || []).forEach(function (task) {
        if (Array.isArray(task.subtasks)) {
          task.subtasks = task.subtasks.map(function (s) {
            return {
              id: s.id || ('st_' + Math.random().toString(36).slice(2, 10)),
              title: s.title || s.text || '',
              notes: s.notes || '',
              done: !!s.done,
              reminder: s.reminder || Model.defaultReminder()
            };
          });
        }
      });
      return data;
    }
  };

  function defaultData() {
    return {
      schemaVersion: CURRENT_VERSION,
      tasks: [
        Model.createTask({
          title: 'Welcome to Task Notes! 👋',
          notes: 'Tap a note to edit it. Use the + button to add tasks. Pin important ones to keep them on top.',
          color: 'yellow',
          pinned: true
        })
      ],
      settings: {
        mode: 'full',
        sort: 'createdAt',
        filter: 'all',
        filterTag: '',
        notificationsAsked: false,
        soundEnabled: true,
        theme: 'light'
      },
      meta: { lastSavedAt: Date.now() }
    };
  }

  function migrate(data) {
    var v = data.schemaVersion || 0;
    while (v < CURRENT_VERSION) {
      if (MIGRATIONS[v]) {
        data = MIGRATIONS[v](data);
      }
      v++;
      data.schemaVersion = v;
    }
    return data;
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) {
        _data = defaultData();
        return;
      }
      var parsed = JSON.parse(raw);
      parsed = migrate(parsed);
      parsed.tasks = (parsed.tasks || []).map(Model.normalizeTask);
      _data = parsed;
    } catch (e) {
      try {
        localStorage.setItem('task-notes:backup:' + Date.now(), localStorage.getItem(STORE_KEY) || '');
      } catch (_) {}
      _data = defaultData();
    }
  }

  function serialize() {
    _data.meta.lastSavedAt = Date.now();
    return JSON.stringify(_data);
  }

  function flush() {
    try {
      localStorage.setItem(STORE_KEY, serialize());
    } catch (e) {}
  }

  function save() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(flush, 250);
  }

  function emit() {
    _listeners.forEach(function (fn) { try { fn(_data); } catch (_) {} });
  }

  function onChange(fn) {
    _listeners.push(fn);
  }

  function get() {
    return _data;
  }

  function getTasks() {
    return _data.tasks;
  }

  function getSettings() {
    return _data.settings;
  }

  function upsertTask(task) {
    task.updatedAt = Date.now();
    var idx = _data.tasks.findIndex(function (t) { return t.id === task.id; });
    if (idx === -1) {
      _data.tasks.push(task);
    } else {
      _data.tasks[idx] = task;
    }
    save();
    emit();
  }

  function deleteTask(id) {
    _data.tasks = _data.tasks.filter(function (t) { return t.id !== id; });
    save();
    emit();
  }

  function updateSettings(patch) {
    Object.assign(_data.settings, patch);
    save();
    emit();
  }

  function init() {
    load();
    window.addEventListener('storage', function (e) {
      if (e.key === STORE_KEY && e.newValue) {
        try {
          var parsed = JSON.parse(e.newValue);
          parsed.tasks = (parsed.tasks || []).map(Model.normalizeTask);
          _data = parsed;
          emit();
        } catch (_) {}
      }
    });
    window.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });
    window.addEventListener('beforeunload', flush);
  }

  return {
    init: init,
    get: get,
    getTasks: getTasks,
    getSettings: getSettings,
    upsertTask: upsertTask,
    deleteTask: deleteTask,
    updateSettings: updateSettings,
    flush: flush,
    onChange: onChange
  };
})();

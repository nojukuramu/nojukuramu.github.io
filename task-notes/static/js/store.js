/* store.js — in-memory state on top of IndexedDB, with cross-tab sync,
 * undo history and a one-time import of the old localStorage format.
 */
var Store = (function () {
  'use strict';

  var LEGACY_KEY = 'task-notes:v1';
  var CHANNEL = 'task-notes-sync';

  var _notes = [];
  var _notebooks = [];
  var _settings = Model.defaultSettings();
  var _listeners = [];
  var _channel = null;
  var _undo = [];
  var _redo = [];
  var _muted = false;

  /* ---------- events ---------- */

  function onChange(fn) { _listeners.push(fn); }

  function emit(detail) {
    if (_muted) return;
    _listeners.forEach(function (fn) {
      try { fn(detail || {}); } catch (e) { console.error(e); }
    });
  }

  function broadcast(msg) {
    if (!_channel) return;
    try { _channel.postMessage(msg); } catch (_) {}
  }

  /* ---------- loading ---------- */

  function importLegacy() {
    var raw;
    try { raw = localStorage.getItem(LEGACY_KEY); } catch (_) { return null; }
    if (!raw) return null;
    var parsed;
    try { parsed = JSON.parse(raw); } catch (_) { return null; }
    if (!parsed || !Array.isArray(parsed.tasks)) return null;

    var notes = parsed.tasks.map(function (t) {
      var body = t.notes || '';
      if (Array.isArray(t.subtasks) && t.subtasks.length) {
        var lines = t.subtasks.map(function (s) {
          return '- [' + (s.done ? 'x' : ' ') + '] ' + (s.title || s.text || '');
        });
        body = (body ? body + '\n\n' : '') + lines.join('\n');
      }
      var reminders = [];
      var r = t.reminder;
      if (r && r.enabled && r.mode && r.mode !== 'none') {
        var conv = Model.defaultReminder(_settings);
        if (r.mode === 'datetime' && r.dueAt) {
          if (r.repeat === 'daily') { conv.kind = 'daily'; conv.time = Sched.toHHMM(r.dueAt); }
          else if (r.repeat === 'weekly') { conv.kind = 'weekly'; conv.days = [new Date(r.dueAt).getDay()]; conv.time = Sched.toHHMM(r.dueAt); }
          else if (r.repeat === 'weekdays') { conv.kind = 'weekly'; conv.days = [1, 2, 3, 4, 5]; conv.time = Sched.toHHMM(r.dueAt); }
          else if (r.repeat === 'monthly') { conv.kind = 'monthly'; conv.monthDay = new Date(r.dueAt).getDate(); conv.time = Sched.toHHMM(r.dueAt); }
          else { conv.kind = 'once'; conv.at = r.dueAt; }
        } else if (r.mode === 'interval') {
          conv.kind = 'interval';
          conv.every = r.intervalEvery || 1;
          conv.unit = r.intervalUnit || 'hours';
          conv.anchor = r.intervalAnchor || Date.now();
        }
        reminders.push(Model.normalizeReminder(conv, _settings));
      }
      var colorMap = { yellow: 'yellow', pink: 'rose', blue: 'sky', green: 'mint', purple: 'lilac', gray: 'slate' };
      var prioMap = { low: 'low', normal: 'none', high: 'high' };
      return Model.normalizeNote({
        id: t.id,
        title: t.title || '',
        body: body,
        color: colorMap[t.color] || 'default',
        pinned: !!t.pinned,
        done: !!t.done,
        priority: prioMap[t.priority] || 'none',
        tags: Array.isArray(t.tags) ? t.tags : [],
        reminders: reminders,
        createdAt: t.createdAt || Date.now(),
        updatedAt: t.updatedAt || Date.now(),
        order: t.order || t.createdAt || Date.now()
      }, _settings);
    });

    try { localStorage.setItem(LEGACY_KEY + ':archived', raw); } catch (_) {}
    try { localStorage.removeItem(LEGACY_KEY); } catch (_) {}
    return notes;
  }

  function welcomeNotes() {
    var now = Date.now();
    return [
      Model.createNote({
        title: 'Welcome to Task Notes',
        body: 'A notebook with a real alarm clock inside it.\n\n' +
          '- [x] Write a note — the body understands **markdown**\n' +
          '- [ ] Tap ⏰ on a note to set an alarm\n' +
          '- [ ] Turn on notifications so alarms reach you outside the tab\n' +
          '- [ ] Press `?` to see every keyboard shortcut\n\n' +
          '> Everything lives in your browser. No account, no server.',
        color: 'lilac',
        pinned: true,
        createdAt: now,
        updatedAt: now,
        order: now
      }, _settings),
      Model.createNote({
        title: 'Alarms vs. notifications',
        body: 'Each reminder can be either:\n\n' +
          '- **Alarm** — takes over the screen and rings until you answer it.\n' +
          '- **Notification** — a quiet nudge that stays out of your way.\n\n' +
          'Snooze, mark done, or open the note straight from either one.',
        color: 'amber',
        tags: ['tips'],
        createdAt: now - 1000,
        updatedAt: now - 1000,
        order: now - 1000
      }, _settings)
    ];
  }

  function load() {
    return DB.kvGet('settings').then(function (s) {
      _settings = Object.assign(Model.defaultSettings(), s || {});
      _settings.quietHours = Object.assign(Model.defaultSettings().quietHours, _settings.quietHours || {});
      _settings.autoSnooze = Object.assign(Model.defaultSettings().autoSnooze, _settings.autoSnooze || {});
      _settings.defaultSnooze = Object.assign(Model.defaultSettings().defaultSnooze, _settings.defaultSnooze || {});
      return Promise.all([DB.getAll('notes'), DB.getAll('notebooks')]);
    }).then(function (res) {
      _notes = (res[0] || []).map(function (n) { return Model.normalizeNote(n, _settings); });
      _notebooks = (res[1] || []).sort(function (a, b) { return a.order - b.order; });

      if (!_notes.length) {
        var legacy = importLegacy();
        var seed = legacy && legacy.length ? legacy : (_settings.onboarded ? [] : welcomeNotes());
        if (seed.length) {
          _notes = seed;
          return DB.putMany('notes', _notes);
        }
      }
    }).then(function () {
      initChannel();
    });
  }

  function initChannel() {
    if (typeof BroadcastChannel === 'undefined') return;
    try { _channel = new BroadcastChannel(CHANNEL); } catch (_) { return; }
    _channel.onmessage = function (e) {
      var msg = e.data || {};
      if (msg.type === 'notes-changed') {
        reloadFromDb();
      } else if (msg.type === 'settings-changed') {
        DB.kvGet('settings').then(function (s) {
          _settings = Object.assign(Model.defaultSettings(), s || {});
          emit({ reason: 'settings', remote: true });
        });
      }
    };
  }

  function reloadFromDb() {
    return DB.getAll('notes').then(function (rows) {
      _notes = (rows || []).map(function (n) { return Model.normalizeNote(n, _settings); });
      emit({ reason: 'reload', remote: true });
    });
  }

  /* ---------- reads ---------- */

  function notes() { return _notes; }
  function notebooks() { return _notebooks; }
  function settings() { return _settings; }

  function byId(id) {
    for (var i = 0; i < _notes.length; i++) if (_notes[i].id === id) return _notes[i];
    return null;
  }

  function findReminder(reminderId) {
    for (var i = 0; i < _notes.length; i++) {
      var rs = _notes[i].reminders;
      for (var j = 0; j < rs.length; j++) {
        if (rs[j].id === reminderId) return { note: _notes[i], reminder: rs[j] };
      }
    }
    return null;
  }

  function allTags() {
    var counts = {};
    _notes.forEach(function (n) {
      if (n.trashed) return;
      n.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    });
    return Object.keys(counts).sort(function (a, b) {
      return counts[b] - counts[a] || a.localeCompare(b);
    }).map(function (t) { return { name: t, count: counts[t] }; });
  }

  /* ---------- undo ---------- */

  function snapshot(label) {
    _undo.push({ label: label, notes: JSON.parse(JSON.stringify(_notes)) });
    if (_undo.length > 40) _undo.shift();
    _redo.length = 0;
  }

  function canUndo() { return _undo.length > 0; }
  function canRedo() { return _redo.length > 0; }

  function undo() {
    if (!_undo.length) return null;
    var entry = _undo.pop();
    _redo.push({ label: entry.label, notes: JSON.parse(JSON.stringify(_notes)) });
    _notes = entry.notes.map(function (n) { return Model.normalizeNote(n, _settings); });
    persistAll();
    emit({ reason: 'undo' });
    return entry.label;
  }

  function redo() {
    if (!_redo.length) return null;
    var entry = _redo.pop();
    _undo.push({ label: entry.label, notes: JSON.parse(JSON.stringify(_notes)) });
    _notes = entry.notes.map(function (n) { return Model.normalizeNote(n, _settings); });
    persistAll();
    emit({ reason: 'redo' });
    return entry.label;
  }

  /* ---------- writes ---------- */

  function persistAll() {
    return DB.replaceAll('notes', _notes).then(function () {
      broadcast({ type: 'notes-changed' });
    });
  }

  function put(note, opts) {
    opts = opts || {};
    if (opts.touch !== false) note.updatedAt = Date.now();
    var idx = -1;
    for (var i = 0; i < _notes.length; i++) if (_notes[i].id === note.id) { idx = i; break; }
    if (idx === -1) _notes.unshift(note); else _notes[idx] = note;
    return DB.put('notes', note).then(function () {
      broadcast({ type: 'notes-changed' });
      emit({ reason: opts.reason || 'put', noteId: note.id, silent: opts.silent });
    });
  }

  /* Writes several notes at once — one transaction, one repaint. */
  function putMany(list, opts) {
    opts = opts || {};
    var now = Date.now();
    list.forEach(function (note) {
      if (opts.touch !== false) note.updatedAt = now;
      var idx = -1;
      for (var i = 0; i < _notes.length; i++) if (_notes[i].id === note.id) { idx = i; break; }
      if (idx === -1) _notes.unshift(note); else _notes[idx] = note;
    });
    return DB.putMany('notes', list).then(function () {
      broadcast({ type: 'notes-changed' });
      emit({ reason: opts.reason || 'put-many' });
    });
  }

  function remove(id) {
    _notes = _notes.filter(function (n) { return n.id !== id; });
    return DB.del('notes', id).then(function () {
      broadcast({ type: 'notes-changed' });
      emit({ reason: 'remove', noteId: id });
    });
  }

  function removeMany(ids) {
    var set = {};
    ids.forEach(function (id) { set[id] = 1; });
    _notes = _notes.filter(function (n) { return !set[n.id]; });
    return DB.delMany('notes', ids).then(function () {
      broadcast({ type: 'notes-changed' });
      emit({ reason: 'remove-many' });
    });
  }

  function updateSettings(patch, opts) {
    Object.assign(_settings, patch);
    return DB.kvSet('settings', _settings).then(function () {
      broadcast({ type: 'settings-changed' });
      if (!opts || !opts.silent) emit({ reason: 'settings' });
    });
  }

  /* ---------- notebooks ---------- */

  function addNotebook(name, color) {
    var nb = Model.createNotebook(name, color);
    nb.order = _notebooks.length ? Math.max.apply(null, _notebooks.map(function (b) { return b.order; })) + 1 : 0;
    _notebooks.push(nb);
    return DB.put('notebooks', nb).then(function () {
      emit({ reason: 'notebooks' });
      return nb;
    });
  }

  function updateNotebook(nb) {
    var idx = _notebooks.findIndex(function (b) { return b.id === nb.id; });
    if (idx > -1) _notebooks[idx] = nb;
    return DB.put('notebooks', nb).then(function () { emit({ reason: 'notebooks' }); });
  }

  function removeNotebook(id) {
    _notebooks = _notebooks.filter(function (b) { return b.id !== id; });
    var touched = _notes.filter(function (n) { return n.notebook === id; });
    touched.forEach(function (n) { n.notebook = null; });
    return DB.del('notebooks', id)
      .then(function () { return touched.length ? DB.putMany('notes', touched) : null; })
      .then(function () { emit({ reason: 'notebooks' }); });
  }

  function notebookById(id) {
    for (var i = 0; i < _notebooks.length; i++) if (_notebooks[i].id === id) return _notebooks[i];
    return null;
  }

  /* ---------- backup ---------- */

  function exportData() {
    return {
      app: 'task-notes',
      version: 3,
      exportedAt: new Date().toISOString(),
      settings: _settings,
      notebooks: _notebooks,
      notes: _notes
    };
  }

  function importData(payload, mode) {
    if (!payload) throw new Error('Empty backup');
    var incomingNotes = payload.notes || payload.tasks || [];
    if (!Array.isArray(incomingNotes)) throw new Error('Backup has no notes');

    var normalized = incomingNotes.map(function (n) { return Model.normalizeNote(n, _settings); });
    var incomingBooks = Array.isArray(payload.notebooks) ? payload.notebooks : [];

    if (mode === 'replace') {
      _notes = normalized;
      _notebooks = incomingBooks;
    } else {
      var existing = {};
      _notes.forEach(function (n) { existing[n.id] = 1; });
      normalized.forEach(function (n) {
        if (existing[n.id]) n.id = Model.uid('n');
        _notes.push(n);
      });
      var haveBooks = {};
      _notebooks.forEach(function (b) { haveBooks[b.id] = 1; });
      incomingBooks.forEach(function (b) { if (!haveBooks[b.id]) _notebooks.push(b); });
    }

    return DB.replaceAll('notes', _notes)
      .then(function () { return DB.replaceAll('notebooks', _notebooks); })
      .then(function () {
        broadcast({ type: 'notes-changed' });
        emit({ reason: 'import' });
        return normalized.length;
      });
  }

  function wipe() {
    _notes = [];
    _notebooks = [];
    return DB.clear('notes')
      .then(function () { return DB.clear('notebooks'); })
      .then(function () {
        broadcast({ type: 'notes-changed' });
        emit({ reason: 'wipe' });
      });
  }

  return {
    load: load,
    onChange: onChange,
    emit: emit,
    notes: notes,
    notebooks: notebooks,
    settings: settings,
    byId: byId,
    findReminder: findReminder,
    allTags: allTags,
    snapshot: snapshot,
    undo: undo,
    redo: redo,
    canUndo: canUndo,
    canRedo: canRedo,
    put: put,
    putMany: putMany,
    persistAll: persistAll,
    remove: remove,
    removeMany: removeMany,
    updateSettings: updateSettings,
    addNotebook: addNotebook,
    updateNotebook: updateNotebook,
    removeNotebook: removeNotebook,
    notebookById: notebookById,
    exportData: exportData,
    importData: importData,
    reloadFromDb: reloadFromDb,
    wipe: wipe
  };
})();

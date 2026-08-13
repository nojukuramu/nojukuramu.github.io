/* ui.js — application shell: sidebar, toolbar, the five views, note cards,
 * multi-select, drag ordering, menus and toasts.
 */
var UI = (function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  var esc = function (s) { return MD.esc(s); };

  var state = {
    query: '',
    selection: {},
    selecting: false,
    dragId: null,
    calendarMonth: null,
    sidebarOpen: false
  };

  var VIEWS = [
    { id: 'grid', icon: '▦', label: 'Grid' },
    { id: 'list', icon: '☰', label: 'List' },
    { id: 'board', icon: '▤', label: 'Board' },
    { id: 'agenda', icon: '📅', label: 'Agenda' },
    { id: 'calendar', icon: '🗓', label: 'Calendar' }
  ];

  var SORTS = [
    { id: 'manual', label: 'Manual order' },
    { id: 'updated', label: 'Last edited' },
    { id: 'created', label: 'Date created' },
    { id: 'title', label: 'Title A–Z' },
    { id: 'due', label: 'Next alarm' },
    { id: 'priority', label: 'Priority' }
  ];

  var PRIORITY_RANK = { high: 0, medium: 1, low: 2, none: 3 };

  /* ================= scope helpers ================= */

  function scopeInfo(scope) {
    scope = scope || 'all';
    if (scope.indexOf('notebook:') === 0) {
      var nb = Store.notebookById(scope.slice(9));
      return { kind: 'notebook', id: scope.slice(9), title: nb ? nb.name : 'Notebook', icon: nb ? nb.icon : '📓' };
    }
    if (scope.indexOf('tag:') === 0) {
      return { kind: 'tag', id: scope.slice(4), title: '#' + scope.slice(4), icon: '#' };
    }
    var map = {
      all: { title: 'All notes', icon: '🗒' },
      today: { title: 'Today', icon: '☀️' },
      upcoming: { title: 'Upcoming', icon: '📆' },
      overdue: { title: 'Overdue', icon: '⚠️' },
      starred: { title: 'Starred', icon: '⭐' },
      alarms: { title: 'Alarms', icon: '⏰' },
      done: { title: 'Completed', icon: '✅' },
      archive: { title: 'Archive', icon: '📦' },
      trash: { title: 'Trash', icon: '🗑' }
    };
    var m = map[scope] || map.all;
    return { kind: scope, title: m.title, icon: m.icon };
  }

  function nextAlarmAt(note) {
    var best = null;
    note.reminders.forEach(function (r) {
      if (!r.enabled) return;
      var at = Sched.effectiveNext(r);
      if (at && (best == null || at < best)) best = at;
    });
    return best;
  }

  function isOverdue(note) {
    var now = Date.now();
    if (note.done) return false;
    return note.reminders.some(function (r) {
      if (!r.enabled || r.kind !== 'once') return false;
      if (r.snoozedUntil && r.snoozedUntil > now) return false;  // answered, just later
      return r.at && r.at < now;
    });
  }

  function inScope(note, scope) {
    if (scope === 'trash') return note.trashed;
    if (note.trashed) return false;
    if (scope === 'archive') return note.archived;
    if (note.archived) return false;

    var s = Store.settings();
    if (scope === 'done') return note.done;
    if (!s.showCompleted && note.done && scope !== 'all') return false;

    if (scope === 'all') return true;
    if (scope === 'starred') return note.starred;
    if (scope === 'alarms') return note.reminders.some(function (r) { return r.enabled; });
    if (scope === 'overdue') return isOverdue(note);
    if (scope === 'today') {
      var at = nextAlarmAt(note);
      if (isOverdue(note)) return true;
      return at != null && Sched.startOfDay(at) === Sched.startOfDay(Date.now());
    }
    if (scope === 'upcoming') {
      var a = nextAlarmAt(note);
      return a != null && a <= Date.now() + 7 * Sched.DAY;
    }
    if (scope.indexOf('notebook:') === 0) return note.notebook === scope.slice(9);
    if (scope.indexOf('tag:') === 0) return note.tags.indexOf(scope.slice(4)) > -1;
    return true;
  }

  function matchesQuery(note, q) {
    if (!q) return true;
    var hay = (note.title + ' ' + note.body + ' ' + note.tags.join(' ')).toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(function (term) {
      if (term.indexOf('#') === 0) return note.tags.some(function (t) { return t.toLowerCase().indexOf(term.slice(1)) === 0; });
      if (term === 'is:done') return note.done;
      if (term === 'is:open') return !note.done;
      if (term === 'is:alarm') return note.reminders.some(function (r) { return r.enabled; });
      if (term === 'is:pinned') return note.pinned;
      return hay.indexOf(term) > -1;
    });
  }

  function sortNotes(list, sort) {
    var arr = list.slice();
    arr.sort(function (a, b) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      switch (sort) {
        case 'updated': return b.updatedAt - a.updatedAt;
        case 'created': return b.createdAt - a.createdAt;
        case 'title': return (a.title || MD.plain(a.body, 40)).localeCompare(b.title || MD.plain(b.body, 40));
        case 'priority': return (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) || (b.updatedAt - a.updatedAt);
        case 'due': {
          var x = nextAlarmAt(a), y = nextAlarmAt(b);
          if (x == null && y == null) return b.updatedAt - a.updatedAt;
          if (x == null) return 1;
          if (y == null) return -1;
          return x - y;
        }
        default: return b.order - a.order;
      }
    });
    return arr;
  }

  function visibleNotes() {
    var s = Store.settings();
    var list = Store.notes().filter(function (n) {
      return inScope(n, s.scope) && matchesQuery(n, state.query);
    });
    return sortNotes(list, s.sort);
  }

  function counts() {
    var notes = Store.notes();
    var c = { all: 0, today: 0, upcoming: 0, overdue: 0, starred: 0, alarms: 0, done: 0, archive: 0, trash: 0 };
    notes.forEach(function (n) {
      if (n.trashed) { c.trash++; return; }
      if (n.archived) { c.archive++; return; }
      c.all++;
      if (n.starred) c.starred++;
      if (n.done) c.done++;
      if (n.reminders.some(function (r) { return r.enabled; })) c.alarms++;
      if (isOverdue(n)) c.overdue++;
      var at = nextAlarmAt(n);
      if (isOverdue(n) || (at != null && Sched.startOfDay(at) === Sched.startOfDay(Date.now()))) c.today++;
      if (at != null && at <= Date.now() + 7 * Sched.DAY) c.upcoming++;
    });
    return c;
  }

  /* ================= sidebar ================= */

  function navItem(scope, label, icon, count, active) {
    return '<button class="sb-item' + (active ? ' is-active' : '') + '" data-scope="' + esc(scope) + '">' +
      '<span class="sb-icon" aria-hidden="true">' + icon + '</span>' +
      '<span class="sb-label">' + esc(label) + '</span>' +
      (count ? '<span class="sb-count">' + count + '</span>' : '') +
      '</button>';
  }

  function renderSidebar() {
    var s = Store.settings();
    var c = counts();
    var host = $('#sidebar-body');
    if (!host) return;

    var books = Store.notebooks();
    var tags = Store.allTags();

    host.innerHTML =
      '<div class="sb-group">' +
        navItem('all', 'All notes', '🗒', c.all, s.scope === 'all') +
        navItem('today', 'Today', '☀️', c.today, s.scope === 'today') +
        navItem('upcoming', 'Upcoming', '📆', c.upcoming, s.scope === 'upcoming') +
        navItem('overdue', 'Overdue', '⚠️', c.overdue, s.scope === 'overdue') +
        navItem('alarms', 'Alarms', '⏰', c.alarms, s.scope === 'alarms') +
        navItem('starred', 'Starred', '⭐', c.starred, s.scope === 'starred') +
        navItem('done', 'Completed', '✅', c.done, s.scope === 'done') +
      '</div>' +

      '<div class="sb-group">' +
        '<div class="sb-group-head">' +
          '<span>Notebooks</span>' +
          '<button class="sb-add" data-act="add-notebook" title="New notebook" aria-label="New notebook">+</button>' +
        '</div>' +
        (books.length ? books.map(function (b) {
          var n = Store.notes().filter(function (x) { return !x.trashed && !x.archived && x.notebook === b.id; }).length;
          return '<button class="sb-item' + (s.scope === 'notebook:' + b.id ? ' is-active' : '') + '" data-scope="notebook:' + esc(b.id) + '" data-notebook="' + esc(b.id) + '">' +
            '<span class="sb-icon" aria-hidden="true">' + esc(b.icon || '📓') + '</span>' +
            '<span class="sb-label">' + esc(b.name) + '</span>' +
            (n ? '<span class="sb-count">' + n + '</span>' : '') +
            '<span class="sb-more" data-act="notebook-menu" data-id="' + esc(b.id) + '" role="button" tabindex="0" aria-label="Notebook options">⋯</span>' +
            '</button>';
        }).join('') : '<p class="sb-empty">No notebooks yet</p>') +
      '</div>' +

      '<div class="sb-group">' +
        '<div class="sb-group-head"><span>Tags</span></div>' +
        (tags.length ? '<div class="sb-tags">' + tags.slice(0, 40).map(function (t) {
          return '<button class="tag-chip' + (s.scope === 'tag:' + t.name ? ' is-active' : '') + '" data-scope="tag:' + esc(t.name) + '">#' + esc(t.name) +
            '<span>' + t.count + '</span></button>';
        }).join('') + '</div>' : '<p class="sb-empty">Add tags in the editor</p>') +
      '</div>' +

      '<div class="sb-group">' +
        navItem('archive', 'Archive', '📦', c.archive, s.scope === 'archive') +
        navItem('trash', 'Trash', '🗑', c.trash, s.scope === 'trash') +
      '</div>';
  }

  /* ================= topbar ================= */

  function renderTopbar() {
    var s = Store.settings();
    var info = scopeInfo(s.scope);
    var title = $('#scope-title');
    if (title) {
      title.innerHTML = '<span class="scope-icon" aria-hidden="true">' + esc(info.icon) + '</span>' + esc(info.title);
    }

    var vs = $('#view-switch');
    if (vs) {
      vs.innerHTML = VIEWS.map(function (v) {
        return '<button class="' + (s.view === v.id ? 'is-active' : '') + '" data-view="' + v.id + '" title="' + v.label + ' view" aria-label="' + v.label + ' view" aria-pressed="' + (s.view === v.id) + '">' + v.icon + '</button>';
      }).join('');
    }

    $$('#bottom-nav [data-scope]').forEach(function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-scope') === s.scope);
    });

    var perm = Notifier.permission();
    var nb = $('#btn-notif');
    if (nb) {
      nb.style.display = (perm === 'granted' || perm === 'unsupported') ? 'none' : '';
      nb.textContent = perm === 'denied' ? '🔕 Alerts blocked' : '🔔 Enable alerts';
      nb.classList.toggle('is-denied', perm === 'denied');
    }

    var search = $('#search-input');
    if (search && search.value !== state.query) search.value = state.query;
    var clear = $('#search-clear');
    if (clear) clear.style.display = state.query ? '' : 'none';
  }

  function renderStatus() {
    var host = $('#status-strip');
    if (!host) return;
    var s = Store.settings();
    var up = Engine.upcoming(1);
    var over = Engine.overdueNotes().length;
    var bits = [];

    if (over) bits.push('<button class="chip chip-warn" data-scope="overdue">⚠️ ' + over + ' overdue</button>');
    if (up.length) {
      bits.push('<span class="chip">⏰ Next: ' + esc(Notifier.titleFor(up[0].note, up[0].reminder)) +
        ' · ' + esc(Sched.relative(up[0].at)) + '</span>');
    }
    if (Notifier.permission() === 'granted' && !Notifier.triggersSupported()) {
      bits.push('<span class="chip chip-quiet" title="This browser can only fire alarms while a tab is open. Keep the app installed or a tab pinned.">ℹ️ Alarms need an open tab</span>');
    }
    if (s.quietHours && s.quietHours.enabled) {
      bits.push('<span class="chip chip-quiet">🌙 Quiet ' + esc(s.quietHours.start) + '–' + esc(s.quietHours.end) + '</span>');
    }
    host.innerHTML = bits.join('');
    host.style.display = bits.length ? '' : 'none';
  }

  /* ================= note cards ================= */

  function reminderChip(note, rem) {
    var s = Store.settings();
    var at = Sched.effectiveNext(rem);
    var late = rem.kind === 'once' && rem.at && rem.at < Date.now() && !note.done;
    var cls = 'rem-chip' + (rem.alarm ? ' is-alarm' : '') + (late ? ' is-late' : '') + (rem.enabled ? '' : ' is-off');
    var label = rem.enabled
      ? (at ? Sched.dateLabel(at, s.time24) : Sched.describe(rem, s.time24))
      : 'Off';
    if (rem.snoozedUntil) label = 'Snoozed · ' + Sched.relative(rem.snoozedUntil);
    return '<button class="' + cls + '" data-act="edit-reminder" data-rid="' + esc(rem.id) + '" title="' + esc(Sched.describe(rem, s.time24)) + '">' +
      '<span aria-hidden="true">' + (rem.alarm ? '⏰' : '🔔') + '</span>' + esc(label) +
      (rem.kind !== 'once' ? '<span class="rem-repeat" aria-hidden="true">↻</span>' : '') +
      '</button>';
  }

  function cardHTML(note, opts) {
    opts = opts || {};
    var s = Store.settings();
    var stats = Model.checklistStats(note.body);
    var selected = !!state.selection[note.id];
    var bodyHtml = MD.render(note.body, { interactive: true });
    var nb = note.notebook ? Store.notebookById(note.notebook) : null;

    var cls = ['note-card', 'color-' + note.color];
    if (note.done) cls.push('is-done');
    if (note.pinned) cls.push('is-pinned');
    if (selected) cls.push('is-selected');
    if (note.priority !== 'none') cls.push('prio-' + note.priority);
    if (isOverdue(note)) cls.push('is-overdue');
    if (opts.compact) cls.push('is-compact');

    return '<article class="' + cls.join(' ') + '" data-id="' + esc(note.id) + '" tabindex="0" ' +
      (s.sort === 'manual' && !state.selecting ? 'draggable="true"' : '') +
      ' aria-label="' + esc(note.title || MD.plain(note.body, 40) || 'Untitled note') + '">' +

      '<button class="nc-select" data-act="select" aria-label="Select note" aria-pressed="' + selected + '"></button>' +

      '<div class="nc-main" data-act="open">' +
        (note.priority !== 'none' ? '<span class="nc-prio" title="' + note.priority + ' priority"></span>' : '') +
        (note.title ? '<h3 class="nc-title">' + esc(note.title) + '</h3>' : '') +
        (note.body ? '<div class="nc-body md">' + bodyHtml + '</div>' : (note.title ? '' : '<div class="nc-body md nc-empty">Empty note</div>')) +
      '</div>' +

      (stats.total ? '<div class="nc-progress" title="' + stats.done + ' of ' + stats.total + ' done">' +
        '<div class="nc-progress-bar"><span style="width:' + Math.round(stats.done / stats.total * 100) + '%"></span></div>' +
        '<span class="nc-progress-label">' + stats.done + '/' + stats.total + '</span>' +
      '</div>' : '') +

      ((note.tags.length || nb) ? '<div class="nc-tags">' +
        (nb ? '<span class="nc-book">' + esc(nb.icon || '📓') + ' ' + esc(nb.name) + '</span>' : '') +
        note.tags.map(function (t) { return '<button class="nc-tag" data-act="tag" data-tag="' + esc(t) + '">#' + esc(t) + '</button>'; }).join('') +
      '</div>' : '') +

      (note.reminders.length ? '<div class="nc-alarms">' +
        note.reminders.map(function (r) { return reminderChip(note, r); }).join('') +
      '</div>' : '') +

      '<footer class="nc-foot">' +
        '<span class="nc-meta">' + esc(Sched.relative(note.updatedAt)) + '</span>' +
        '<div class="nc-actions">' +
          '<button data-act="done" title="' + (note.done ? 'Mark as not done' : 'Mark done') + '" aria-label="Toggle done">' + (note.done ? '☑' : '☐') + '</button>' +
          '<button data-act="alarm" title="Add alarm" aria-label="Add alarm">⏰</button>' +
          '<button data-act="star" class="' + (note.starred ? 'is-on' : '') + '" title="Star" aria-label="Star">' + (note.starred ? '★' : '☆') + '</button>' +
          '<button data-act="pin" class="' + (note.pinned ? 'is-on' : '') + '" title="Pin" aria-label="Pin">📌</button>' +
          '<button data-act="palette" title="Colour" aria-label="Colour">🎨</button>' +
          '<button data-act="more" title="More" aria-label="More options">⋯</button>' +
        '</div>' +
      '</footer>' +
    '</article>';
  }

  /* ================= views ================= */

  function emptyState() {
    var s = Store.settings();
    var info = scopeInfo(s.scope);
    var msg = state.query
      ? { icon: '🔍', title: 'Nothing matched', sub: 'Try a different search, or clear it to see everything.' }
      : {
        trash: { icon: '🗑', title: 'Trash is empty', sub: 'Deleted notes rest here for as long as you like.' },
        archive: { icon: '📦', title: 'Nothing archived', sub: 'Archive notes you want out of the way but not gone.' },
        today: { icon: '☀️', title: 'Nothing due today', sub: 'Enjoy it, or add an alarm to something.' },
        upcoming: { icon: '📆', title: 'Nothing in the next week', sub: 'Set an alarm and it will show up here.' },
        overdue: { icon: '🎉', title: 'Nothing overdue', sub: 'You are completely caught up.' },
        starred: { icon: '⭐', title: 'No starred notes', sub: 'Star a note to keep it close at hand.' },
        alarms: { icon: '⏰', title: 'No alarms set', sub: 'Open a note and press ⏰ to set one.' },
        done: { icon: '✅', title: 'Nothing completed yet', sub: 'Tick a note off and it lands here.' }
      }[s.scope] || { icon: '🗒', title: 'No notes yet', sub: 'Press N, or the + button, to write your first one.' };

    return '<div class="empty-state">' +
      '<div class="empty-icon" aria-hidden="true">' + msg.icon + '</div>' +
      '<h2>' + esc(msg.title) + '</h2>' +
      '<p>' + esc(msg.sub) + '</p>' +
      (s.scope === 'trash' ? '' : '<button class="btn-primary" data-act="new-note">New note</button>') +
      '</div>';
  }

  function renderGrid(list) {
    return '<div class="note-grid">' + list.map(function (n) { return cardHTML(n); }).join('') + '</div>';
  }

  function renderList(list) {
    return '<div class="note-list">' + list.map(function (n) { return cardHTML(n, { compact: true }); }).join('') + '</div>';
  }

  function renderBoard(list) {
    var cols = [
      { id: 'high', label: '🔴 High', test: function (n) { return !n.done && n.priority === 'high'; } },
      { id: 'medium', label: '🟠 Medium', test: function (n) { return !n.done && n.priority === 'medium'; } },
      { id: 'low', label: '🔵 Low / none', test: function (n) { return !n.done && (n.priority === 'low' || n.priority === 'none'); } },
      { id: 'done', label: '✅ Done', test: function (n) { return n.done; } }
    ];
    return '<div class="board">' + cols.map(function (col) {
      var items = list.filter(col.test);
      return '<section class="board-col" data-col="' + col.id + '">' +
        '<header class="board-head">' + col.label + '<span>' + items.length + '</span></header>' +
        '<div class="board-body">' +
          (items.length ? items.map(function (n) { return cardHTML(n, { compact: true }); }).join('')
            : '<p class="board-empty">Drop a note here</p>') +
        '</div>' +
      '</section>';
    }).join('') + '</div>';
  }

  function renderAgenda(list) {
    var now = Date.now();
    var today = Sched.startOfDay(now);
    var buckets = [
      { id: 'overdue', label: '⚠️ Overdue', items: [] },
      { id: 'today', label: '☀️ Today', items: [] },
      { id: 'tomorrow', label: '🌤 Tomorrow', items: [] },
      { id: 'week', label: '📆 This week', items: [] },
      { id: 'later', label: '🌙 Later', items: [] },
      { id: 'none', label: '💤 No alarm', items: [] }
    ];
    var index = {};
    buckets.forEach(function (b) { index[b.id] = b; });

    list.forEach(function (note) {
      var at = nextAlarmAt(note);
      if (at == null) { index.none.items.push({ note: note, at: null }); return; }
      var day = Sched.startOfDay(at);
      if (at < now && isOverdue(note)) index.overdue.items.push({ note: note, at: at });
      else if (day === today) index.today.items.push({ note: note, at: at });
      else if (day === today + Sched.DAY) index.tomorrow.items.push({ note: note, at: at });
      else if (at <= now + 7 * Sched.DAY) index.week.items.push({ note: note, at: at });
      else index.later.items.push({ note: note, at: at });
    });

    var s = Store.settings();
    var html = buckets.filter(function (b) { return b.items.length; }).map(function (b) {
      b.items.sort(function (x, y) { return (x.at || Infinity) - (y.at || Infinity); });
      return '<section class="agenda-group">' +
        '<header class="agenda-head">' + b.label + '<span>' + b.items.length + '</span></header>' +
        b.items.map(function (it) {
          var note = it.note;
          return '<div class="agenda-row note-card color-' + esc(note.color) + (note.done ? ' is-done' : '') + '" data-id="' + esc(note.id) + '" tabindex="0">' +
            '<button class="agenda-check" data-act="done" aria-label="Toggle done">' + (note.done ? '☑' : '☐') + '</button>' +
            '<div class="agenda-main" data-act="open">' +
              '<div class="agenda-title">' + esc(note.title || MD.plain(note.body, 60) || 'Untitled') + '</div>' +
              '<div class="agenda-sub">' +
                (it.at ? esc(Sched.dateLabel(it.at, s.time24)) + ' · ' + esc(Sched.relative(it.at)) : 'No alarm set') +
              '</div>' +
            '</div>' +
            '<div class="agenda-actions">' +
              '<button data-act="alarm" aria-label="Alarms">⏰</button>' +
              '<button data-act="more" aria-label="More">⋯</button>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</section>';
    }).join('');

    return '<div class="agenda">' + html + '</div>';
  }

  function renderCalendar(list) {
    var s = Store.settings();
    var ref = state.calendarMonth ? new Date(state.calendarMonth) : new Date();
    var year = ref.getFullYear();
    var month = ref.getMonth();
    var first = new Date(year, month, 1);
    var startPad = (first.getDay() - s.weekStart + 7) % 7;
    var total = Sched.daysInMonth(year, month);
    var todayKey = Sched.startOfDay(Date.now());

    // Map every upcoming occurrence in this month to its day.
    var byDay = {};
    list.forEach(function (note) {
      note.reminders.forEach(function (rem) {
        if (!rem.enabled) return;
        var cursor = Date.now() - Sched.DAY;
        for (var i = 0; i < 40; i++) {
          var at = (i === 0 && Sched.effectiveNext(rem)) ? Sched.effectiveNext(rem)
            : Sched.nextOccurrence(rem, cursor, { quietHours: s.quietHours });
          if (!at) break;
          cursor = at;
          var d = new Date(at);
          if (d.getFullYear() > year || (d.getFullYear() === year && d.getMonth() > month)) break;
          if (d.getFullYear() === year && d.getMonth() === month) {
            var key = d.getDate();
            (byDay[key] = byDay[key] || []).push({ note: note, rem: rem, at: at });
          }
          if (rem.kind === 'once') break;
        }
      });
    });

    var dayNames = [];
    for (var i = 0; i < 7; i++) dayNames.push(Sched.DAY_NAMES[(s.weekStart + i) % 7]);

    var cells = '';
    for (var p = 0; p < startPad; p++) cells += '<div class="cal-cell is-pad"></div>';
    for (var d = 1; d <= total; d++) {
      var dayStart = new Date(year, month, d).getTime();
      var items = (byDay[d] || []).sort(function (a, b) { return a.at - b.at; });
      cells += '<div class="cal-cell' + (dayStart === todayKey ? ' is-today' : '') + '" data-day="' + d + '">' +
        '<div class="cal-num">' + d + '</div>' +
        items.slice(0, 4).map(function (it) {
          return '<button class="cal-item color-' + esc(it.note.color) + '" data-id="' + esc(it.note.id) + '" data-act="open" title="' + esc(Notifier.titleFor(it.note, it.rem)) + '">' +
            '<span class="cal-time">' + esc(Sched.timeLabel(it.at, s.time24)) + '</span> ' +
            esc(MD.plain(it.note.title || it.note.body, 22) || 'Note') +
          '</button>';
        }).join('') +
        (items.length > 4 ? '<span class="cal-more">+' + (items.length - 4) + ' more</span>' : '') +
      '</div>';
    }

    return '<div class="calendar">' +
      '<header class="cal-head">' +
        '<button data-act="cal-prev" aria-label="Previous month">‹</button>' +
        '<h2>' + Sched.MONTH_LONG[month] + ' ' + year + '</h2>' +
        '<button data-act="cal-next" aria-label="Next month">›</button>' +
        '<button class="cal-today" data-act="cal-today">Today</button>' +
      '</header>' +
      '<div class="cal-grid">' +
        dayNames.map(function (n) { return '<div class="cal-dow">' + n + '</div>'; }).join('') +
        cells +
      '</div>' +
    '</div>';
  }

  function renderContent() {
    var host = $('#content');
    if (!host) return;
    var s = Store.settings();
    var list = visibleNotes();

    if (s.scope === 'trash' && list.length) {
      host.innerHTML = '<div class="trash-bar">Notes in the trash stay until you empty it. ' +
        '<button class="btn-danger-ghost" data-act="empty-trash">Empty trash</button></div>' +
        (s.view === 'list' ? renderList(list) : renderGrid(list));
      return;
    }

    if (!list.length) {
      host.innerHTML = emptyState();
      return;
    }

    if (s.view === 'list') host.innerHTML = renderList(list);
    else if (s.view === 'board') host.innerHTML = renderBoard(list);
    else if (s.view === 'agenda') host.innerHTML = renderAgenda(list);
    else if (s.view === 'calendar') host.innerHTML = renderCalendar(list);
    else host.innerHTML = renderGrid(list);
  }

  function renderSelectionBar() {
    var bar = $('#selection-bar');
    if (!bar) return;
    var ids = Object.keys(state.selection);
    state.selecting = ids.length > 0;
    document.documentElement.classList.toggle('is-selecting', state.selecting);
    bar.style.display = ids.length ? '' : 'none';
    if (!ids.length) return;
    bar.innerHTML =
      '<span class="sel-count">' + ids.length + ' selected</span>' +
      '<div class="sel-actions">' +
        '<button data-act="sel-done">☑ Done</button>' +
        '<button data-act="sel-pin">📌 Pin</button>' +
        '<button data-act="sel-color">🎨 Colour</button>' +
        '<button data-act="sel-tag">🏷 Tag</button>' +
        '<button data-act="sel-notebook">📓 Move</button>' +
        '<button data-act="sel-archive">📦 Archive</button>' +
        '<button data-act="sel-trash" class="danger">🗑 Delete</button>' +
        '<button data-act="sel-clear" aria-label="Clear selection">✕</button>' +
      '</div>';
  }

  var _renderQueued = false;
  function render() {
    if (_renderQueued) return;
    _renderQueued = true;
    requestAnimationFrame(function () {
      _renderQueued = false;
      applyTheme();
      renderSidebar();
      renderTopbar();
      renderStatus();
      renderSelectionBar();
      renderContent();
    });
  }

  /* ================= theme ================= */

  function applyTheme() {
    var s = Store.settings();
    var root = document.documentElement;
    var theme = s.theme;
    if (theme === 'system') {
      theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-accent', s.accent || 'violet');
    root.setAttribute('data-density', s.density || 'comfortable');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#101018' : '#f6f5f9');
    // Mirrored so the inline head script can paint before IndexedDB answers.
    try {
      localStorage.setItem('tn:theme', s.theme);
      localStorage.setItem('tn:accent', s.accent || 'violet');
    } catch (_) {}
  }

  /* ================= toasts ================= */

  function toast(message, opts) {
    opts = opts || {};
    var host = $('#toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast' + (opts.kind ? ' toast-' + opts.kind : '');
    el.innerHTML = '<span class="toast-msg">' + esc(message) + '</span>' +
      (opts.actionLabel ? '<button class="toast-action">' + esc(opts.actionLabel) + '</button>' : '') +
      '<button class="toast-close" aria-label="Dismiss">✕</button>';

    var timer = setTimeout(remove, opts.duration || 5000);
    function remove() {
      clearTimeout(timer);
      el.classList.add('is-out');
      setTimeout(function () { el.remove(); }, 220);
    }
    if (opts.onAction) {
      el.querySelector('.toast-action').addEventListener('click', function () {
        opts.onAction();
        remove();
      });
    }
    el.querySelector('.toast-close').addEventListener('click', remove);
    host.appendChild(el);
    return remove;
  }

  /* A quiet reminder — shows as an actionable toast instead of taking over. */
  function toastReminder(item) {
    var host = $('#toasts');
    if (!host) return;
    var note = item.note, rem = item.reminder;
    var s = Store.settings();
    var el = document.createElement('div');
    el.className = 'toast toast-reminder color-' + esc(note.color);
    el.innerHTML =
      '<div class="tr-main">' +
        '<div class="tr-title">🔔 ' + esc(Notifier.titleFor(note, rem)) + '</div>' +
        '<div class="tr-sub">' + esc(MD.plain(note.body, 90) || Sched.describe(rem, s.time24)) + '</div>' +
      '</div>' +
      '<div class="tr-actions">' +
        '<button data-a="snooze">Snooze</button>' +
        '<button data-a="done">Done</button>' +
        '<button data-a="open">Open</button>' +
        '<button data-a="dismiss" aria-label="Dismiss">✕</button>' +
      '</div>';

    if (s.sound !== false) Ringtone.play(rem.ringtone || s.defaultRingtone, { loop: false, volume: (rem.volume == null ? s.defaultVolume : rem.volume) * 0.7 });
    if (rem.vibrate && s.vibrate !== false) Ringtone.vibrate([200, 100, 200]);

    var timer = setTimeout(close, 30000);
    function close() { clearTimeout(timer); el.classList.add('is-out'); setTimeout(function () { el.remove(); }, 220); }

    el.querySelectorAll('[data-a]').forEach(function (b) {
      b.addEventListener('click', function () {
        var a = b.getAttribute('data-a');
        if (a === 'snooze') { var d = s.defaultSnooze; Engine.snooze(note.id, rem.id, d.every, d.unit); toast('Snoozed for ' + d.every + ' ' + d.unit); }
        else if (a === 'done') { Engine.complete(note.id, rem.id); }
        else if (a === 'open') { Engine.dismiss(note.id, rem.id); openEditor(note.id); }
        else Engine.dismiss(note.id, rem.id);
        close();
      });
    });
    host.appendChild(el);
  }

  /* ================= menus ================= */

  var _menu = null;

  function closeMenu() {
    if (_menu) { _menu.remove(); _menu = null; }
  }

  /* items: [{label, icon, act, danger, checked, sep}] */
  function menu(anchor, items, onPick) {
    closeMenu();
    var m = document.createElement('div');
    m.className = 'popmenu';
    m.setAttribute('role', 'menu');
    m.innerHTML = items.map(function (it, i) {
      if (it.sep) return '<div class="popmenu-sep"></div>';
      if (it.heading) return '<div class="popmenu-heading">' + esc(it.heading) + '</div>';
      if (it.swatches) {
        return '<div class="popmenu-swatches">' + it.swatches.map(function (c) {
          return '<button class="swatch color-' + c + (it.current === c ? ' is-on' : '') + '" data-i="' + i + '" data-val="' + c + '" title="' + c + '" aria-label="' + c + '"></button>';
        }).join('') + '</div>';
      }
      return '<button role="menuitem" class="popmenu-item' + (it.danger ? ' is-danger' : '') + '" data-i="' + i + '">' +
        '<span class="popmenu-icon" aria-hidden="true">' + (it.icon || '') + '</span>' +
        '<span>' + esc(it.label) + '</span>' +
        (it.checked ? '<span class="popmenu-check">✓</span>' : '') +
        (it.hint ? '<kbd>' + esc(it.hint) + '</kbd>' : '') +
      '</button>';
    }).join('');

    document.body.appendChild(m);
    var r = anchor.getBoundingClientRect();
    var mw = m.offsetWidth, mh = m.offsetHeight;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - mw - 8);
    var top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    m.style.left = left + 'px';
    m.style.top = top + 'px';

    m.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-i]');
      if (!btn) return;
      var item = items[Number(btn.getAttribute('data-i'))];
      var val = btn.getAttribute('data-val');
      closeMenu();
      onPick(item, val);
    });
    _menu = m;
    setTimeout(function () {
      document.addEventListener('click', onDocClick, { once: true });
    }, 0);
    function onDocClick() { closeMenu(); }
    return m;
  }

  /* ================= note actions ================= */

  function newNote(fields) {
    var s = Store.settings();
    var seed = { order: Date.now() };
    if (s.scope.indexOf('notebook:') === 0) seed.notebook = s.scope.slice(9);
    if (s.scope.indexOf('tag:') === 0) seed.tags = [s.scope.slice(4)];
    if (s.scope === 'starred') seed.starred = true;
    var note = Model.createNote(Object.assign(seed, fields || {}), s);
    return Store.put(note).then(function () {
      openEditor(note.id, { fresh: true });
      return note;
    });
  }

  function toggleDone(note) {
    Store.snapshot('done');
    note.done = !note.done;
    note.doneAt = note.done ? Date.now() : null;
    if (note.done) Ringtone.blip('done');
    Store.put(note);
  }

  function trashNote(note) {
    Store.snapshot('trash');
    note.trashed = true;
    note.trashedAt = Date.now();
    Engine.silence(note);
    Store.put(note).then(function () {
      toast('Moved to trash', { actionLabel: 'Undo', onAction: function () { Store.undo(); } });
    });
  }

  function restoreNote(note) {
    note.trashed = false;
    note.trashedAt = null;
    note.archived = false;
    Store.put(note).then(function () { toast('Restored'); });
  }

  function archiveNote(note) {
    Store.snapshot('archive');
    note.archived = !note.archived;
    note.archivedAt = note.archived ? Date.now() : null;
    if (note.archived) Engine.silence(note);
    Store.put(note).then(function () {
      toast(note.archived ? 'Archived' : 'Restored from archive', {
        actionLabel: 'Undo', onAction: function () { Store.undo(); }
      });
    });
  }

  function duplicateNote(note) {
    var copy = Model.normalizeNote(JSON.parse(JSON.stringify(note)), Store.settings());
    copy.id = Model.uid('n');
    copy.title = note.title ? note.title + ' (copy)' : '';
    copy.createdAt = copy.updatedAt = copy.order = Date.now();
    copy.reminders = copy.reminders.map(function (r) {
      r.id = Model.uid('r');
      r.nextAt = null; r.snoozedUntil = null; r.firedCount = 0; r.snoozeCount = 0;
      return r;
    });
    Store.put(copy).then(function () { toast('Duplicated'); });
  }

  function deleteForever(note) {
    Store.snapshot('delete');
    Engine.silence(note);
    Store.remove(note.id).then(function () {
      toast('Deleted permanently', { actionLabel: 'Undo', onAction: function () { Store.undo(); } });
    });
  }

  function copyNote(note) {
    var text = (note.title ? note.title + '\n\n' : '') + note.body;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied to clipboard'); })
        .catch(function () { toast('Could not copy', { kind: 'error' }); });
    }
  }

  /* ================= selection ================= */

  function toggleSelect(id) {
    if (state.selection[id]) delete state.selection[id];
    else state.selection[id] = true;
    render();
  }

  function clearSelection() {
    state.selection = {};
    render();
  }

  function selectedNotes() {
    return Object.keys(state.selection).map(Store.byId).filter(Boolean);
  }

  function bulk(act, anchor) {
    var list = selectedNotes();
    if (!list.length) return;
    Store.snapshot('bulk');

    if (act === 'sel-done') {
      var allDone = list.every(function (n) { return n.done; });
      list.forEach(function (n) { n.done = !allDone; n.doneAt = n.done ? Date.now() : null; });
      Store.putMany(list).then(function () { toast((allDone ? 'Reopened ' : 'Completed ') + list.length + ' notes'); clearSelection(); });
      return;
    }
    if (act === 'sel-pin') {
      var allPinned = list.every(function (n) { return n.pinned; });
      list.forEach(function (n) { n.pinned = !allPinned; });
      Store.putMany(list).then(function () { clearSelection(); });
      return;
    }
    if (act === 'sel-archive') {
      list.forEach(function (n) { n.archived = true; n.archivedAt = Date.now(); Engine.silence(n); });
      Store.putMany(list).then(function () {
        toast('Archived ' + list.length + ' notes', { actionLabel: 'Undo', onAction: function () { Store.undo(); } });
        clearSelection();
      });
      return;
    }
    if (act === 'sel-trash') {
      var inTrash = Store.settings().scope === 'trash';
      if (inTrash) {
        Store.removeMany(list.map(function (n) { return n.id; })).then(function () {
          toast('Deleted ' + list.length + ' notes', { actionLabel: 'Undo', onAction: function () { Store.undo(); } });
          clearSelection();
        });
      } else {
        list.forEach(function (n) { n.trashed = true; n.trashedAt = Date.now(); Engine.silence(n); });
        Store.putMany(list).then(function () {
          toast('Moved ' + list.length + ' notes to trash', { actionLabel: 'Undo', onAction: function () { Store.undo(); } });
          clearSelection();
        });
      }
      return;
    }
    if (act === 'sel-color') {
      menu(anchor, [{ heading: 'Colour' }, { swatches: Model.COLORS }], function (item, val) {
        if (!val) return;
        list.forEach(function (n) { n.color = val; });
        Store.putMany(list).then(clearSelection);
      });
      return;
    }
    if (act === 'sel-tag') {
      var tag = prompt('Add a tag to ' + list.length + ' notes:');
      if (!tag) return;
      tag = tag.replace(/^#/, '').trim();
      if (!tag) return;
      list.forEach(function (n) { if (n.tags.indexOf(tag) === -1) n.tags.push(tag); });
      Store.putMany(list).then(function () { toast('Tagged #' + tag); clearSelection(); });
      return;
    }
    if (act === 'sel-notebook') {
      var books = Store.notebooks();
      var items = [{ heading: 'Move to notebook' }, { label: 'No notebook', icon: '⊘', act: '' }]
        .concat(books.map(function (b) { return { label: b.name, icon: b.icon || '📓', act: b.id }; }));
      menu(anchor, items, function (item) {
        if (!item || item.heading) return;
        list.forEach(function (n) { n.notebook = item.act || null; });
        Store.putMany(list).then(clearSelection);
      });
      return;
    }
  }

  /* ================= drag ordering ================= */

  function bindDrag(host) {
    host.addEventListener('dragstart', function (e) {
      var card = e.target.closest('.note-card');
      if (!card) return;
      state.dragId = card.dataset.id;
      card.classList.add('is-dragging');
      try { e.dataTransfer.setData('text/plain', card.dataset.id); } catch (_) {}
      e.dataTransfer.effectAllowed = 'move';
    });
    host.addEventListener('dragend', function () {
      $$('.note-card').forEach(function (c) { c.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after'); });
      state.dragId = null;
    });
    host.addEventListener('dragover', function (e) {
      if (!state.dragId) return;
      e.preventDefault();
      var card = e.target.closest('.note-card');
      $$('.note-card').forEach(function (c) { c.classList.remove('is-drop-before', 'is-drop-after'); });
      if (!card || card.dataset.id === state.dragId) return;
      var r = card.getBoundingClientRect();
      var before = (e.clientY - r.top) < r.height / 2;
      card.classList.add(before ? 'is-drop-before' : 'is-drop-after');
    });
    host.addEventListener('drop', function (e) {
      if (!state.dragId) return;
      e.preventDefault();
      var target = e.target.closest('.note-card');
      if (!target || target.dataset.id === state.dragId) return;
      var before = target.classList.contains('is-drop-before');
      reorder(state.dragId, target.dataset.id, before);
    });
  }

  function reorder(dragId, targetId, before) {
    var list = visibleNotes();
    var dragged = Store.byId(dragId);
    var idx = list.findIndex(function (n) { return n.id === targetId; });
    if (!dragged || idx === -1) return;

    var ordered = list.filter(function (n) { return n.id !== dragId; });
    var at = ordered.findIndex(function (n) { return n.id === targetId; });
    ordered.splice(before ? at : at + 1, 0, dragged);

    var base = Date.now();
    ordered.forEach(function (n, i) { n.order = base - i; });
    if (Store.settings().sort !== 'manual') Store.updateSettings({ sort: 'manual' }, { silent: true });
    Store.putMany(ordered, { touch: false });
  }

  /* ================= events ================= */

  function noteFromEvent(e) {
    var card = e.target.closest('[data-id]');
    if (!card) return null;
    return Store.byId(card.dataset.id);
  }

  function noteMenu(note, anchor) {
    var s = Store.settings();
    var items = note.trashed
      ? [
        { label: 'Restore', icon: '↩️', act: 'restore' },
        { label: 'Delete permanently', icon: '🗑', act: 'delete', danger: true }
      ]
      : [
        { label: note.done ? 'Mark not done' : 'Mark done', icon: note.done ? '☐' : '☑', act: 'done' },
        { label: note.pinned ? 'Unpin' : 'Pin to top', icon: '📌', act: 'pin' },
        { label: note.starred ? 'Unstar' : 'Star', icon: '⭐', act: 'star' },
        { sep: true },
        { heading: 'Priority' },
        { label: 'High', icon: '🔴', act: 'prio:high', checked: note.priority === 'high' },
        { label: 'Medium', icon: '🟠', act: 'prio:medium', checked: note.priority === 'medium' },
        { label: 'Low', icon: '🔵', act: 'prio:low', checked: note.priority === 'low' },
        { label: 'None', icon: '⚪', act: 'prio:none', checked: note.priority === 'none' },
        { sep: true },
        { label: 'Add alarm', icon: '⏰', act: 'alarm' },
        { label: 'Move to notebook', icon: '📓', act: 'notebook' },
        { label: 'Duplicate', icon: '⧉', act: 'duplicate' },
        { label: 'Copy text', icon: '📋', act: 'copy' },
        { label: 'Export as Markdown', icon: '⬇', act: 'export-md' },
        { sep: true },
        { label: note.archived ? 'Unarchive' : 'Archive', icon: '📦', act: 'archive' },
        { label: 'Move to trash', icon: '🗑', act: 'trash', danger: true }
      ];

    menu(anchor, items, function (item) {
      if (!item || !item.act) return;
      if (item.act.indexOf('prio:') === 0) {
        note.priority = item.act.slice(5);
        Store.put(note);
        return;
      }
      switch (item.act) {
        case 'done': toggleDone(note); break;
        case 'pin': note.pinned = !note.pinned; Store.put(note); break;
        case 'star': note.starred = !note.starred; Store.put(note); break;
        case 'alarm': Editor.openReminder(note.id, null); break;
        case 'notebook': pickNotebook(note, anchor); break;
        case 'duplicate': duplicateNote(note); break;
        case 'copy': copyNote(note); break;
        case 'export-md': exportNoteMd(note); break;
        case 'archive': archiveNote(note); break;
        case 'trash': trashNote(note); break;
        case 'restore': restoreNote(note); break;
        case 'delete': deleteForever(note); break;
      }
    });
  }

  function pickNotebook(note, anchor) {
    var books = Store.notebooks();
    var items = [{ heading: 'Notebook' }, { label: 'No notebook', icon: '⊘', act: '' }]
      .concat(books.map(function (b) {
        return { label: b.name, icon: b.icon || '📓', act: b.id, checked: note.notebook === b.id };
      }))
      .concat([{ sep: true }, { label: 'New notebook…', icon: '＋', act: '__new' }]);
    menu(anchor, items, function (item) {
      if (!item || item.heading) return;
      if (item.act === '__new') {
        var name = prompt('Notebook name:');
        if (!name) return;
        Store.addNotebook(name).then(function (nb) {
          note.notebook = nb.id;
          Store.put(note);
        });
        return;
      }
      note.notebook = item.act || null;
      Store.put(note);
    });
  }

  function exportNoteMd(note) {
    var body = (note.title ? '# ' + note.title + '\n\n' : '') + note.body + '\n';
    download((note.title || 'note').replace(/[^\w\- ]+/g, '').slice(0, 40) + '.md', body, 'text/markdown');
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  function colorMenu(note, anchor) {
    menu(anchor, [
      { heading: 'Colour' },
      { swatches: Model.COLORS, current: note.color }
    ], function (item, val) {
      if (!val) return;
      note.color = val;
      Store.put(note);
    });
  }

  function onContentClick(e) {
    var actEl = e.target.closest('[data-act]');
    var act = actEl && actEl.getAttribute('data-act');

    // markdown checkbox toggling works directly on the card
    var box = e.target.closest('.md-box');
    if (box) {
      e.stopPropagation();
      var n = noteFromEvent(e);
      if (!n) return;
      n.body = Model.toggleChecklistLine(n.body, Number(box.getAttribute('data-md-line')));
      Ringtone.blip();
      Store.put(n);
      return;
    }

    if (act === 'cal-prev' || act === 'cal-next' || act === 'cal-today') {
      var ref = state.calendarMonth ? new Date(state.calendarMonth) : new Date();
      if (act === 'cal-today') state.calendarMonth = null;
      else {
        ref.setDate(1);
        ref.setMonth(ref.getMonth() + (act === 'cal-next' ? 1 : -1));
        state.calendarMonth = ref.getTime();
      }
      render();
      return;
    }
    if (act === 'new-note') { newNote(); return; }
    if (act === 'empty-trash') {
      var trashed = Store.notes().filter(function (n) { return n.trashed; });
      if (!trashed.length) return;
      if (!confirm('Permanently delete ' + trashed.length + ' note' + (trashed.length === 1 ? '' : 's') + '?')) return;
      Store.snapshot('empty-trash');
      Store.removeMany(trashed.map(function (n) { return n.id; })).then(function () {
        toast('Trash emptied', { actionLabel: 'Undo', onAction: function () { Store.undo(); } });
      });
      return;
    }
    if (act === 'tag') {
      Store.updateSettings({ scope: 'tag:' + actEl.getAttribute('data-tag') });
      return;
    }

    var note = noteFromEvent(e);
    if (!note) return;

    if (state.selecting && !act) { toggleSelect(note.id); return; }

    switch (act) {
      case 'select': toggleSelect(note.id); break;
      case 'open': if (state.selecting) toggleSelect(note.id); else openEditor(note.id); break;
      case 'done': toggleDone(note); break;
      case 'star': note.starred = !note.starred; Store.put(note); break;
      case 'pin': note.pinned = !note.pinned; Store.put(note); break;
      case 'alarm': Editor.openReminder(note.id, null); break;
      case 'edit-reminder': Editor.openReminder(note.id, actEl.getAttribute('data-rid')); break;
      case 'palette': colorMenu(note, actEl); break;
      case 'more': noteMenu(note, actEl); break;
      default: if (!act) openEditor(note.id);
    }
  }

  /* ================= public ================= */

  function openEditor(id, opts) {
    Editor.open(id, opts);
  }

  function setScope(scope) {
    Store.updateSettings({ scope: scope });
    closeSidebar();
  }

  function openSidebar() {
    state.sidebarOpen = true;
    document.documentElement.classList.add('sidebar-open');
  }

  function closeSidebar() {
    state.sidebarOpen = false;
    document.documentElement.classList.remove('sidebar-open');
  }

  function focusSearch() {
    var el = $('#search-input');
    if (el) { el.focus(); el.select(); }
  }

  function init() {
    applyTheme();

    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onScheme = function () { if (Store.settings().theme === 'system') applyTheme(); };
      if (mq.addEventListener) mq.addEventListener('change', onScheme);
      else if (mq.addListener) mq.addListener(onScheme);
    }

    var content = $('#content');
    content.addEventListener('click', onContentClick);
    bindDrag(content);

    $('#sidebar-body').addEventListener('click', function (e) {
      var more = e.target.closest('[data-act="notebook-menu"]');
      if (more) {
        e.stopPropagation();
        var nb = Store.notebookById(more.getAttribute('data-id'));
        if (!nb) return;
        menu(more, [
          { label: 'Rename', icon: '✏️', act: 'rename' },
          { label: 'Delete notebook', icon: '🗑', act: 'delete', danger: true }
        ], function (item) {
          if (!item) return;
          if (item.act === 'rename') {
            var name = prompt('Notebook name:', nb.name);
            if (name) { nb.name = name; Store.updateNotebook(nb); }
          } else if (item.act === 'delete') {
            if (confirm('Delete "' + nb.name + '"? Its notes are kept.')) {
              Store.removeNotebook(nb.id).then(function () {
                if (Store.settings().scope === 'notebook:' + nb.id) Store.updateSettings({ scope: 'all' });
              });
            }
          }
        });
        return;
      }
      var add = e.target.closest('[data-act="add-notebook"]');
      if (add) {
        e.stopPropagation();
        var name = prompt('Notebook name:');
        if (name) Store.addNotebook(name);
        return;
      }
      var item = e.target.closest('[data-scope]');
      if (item) setScope(item.getAttribute('data-scope'));
    });

    $('#status-strip').addEventListener('click', function (e) {
      var b = e.target.closest('[data-scope]');
      if (b) setScope(b.getAttribute('data-scope'));
    });

    $('#selection-bar').addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'sel-clear') clearSelection();
      else bulk(act, b);
    });

    $('#view-switch').addEventListener('click', function (e) {
      var b = e.target.closest('[data-view]');
      if (b) Store.updateSettings({ view: b.getAttribute('data-view') });
    });

    $('#btn-sort').addEventListener('click', function () {
      var s = Store.settings();
      menu($('#btn-sort'), [{ heading: 'Sort by' }].concat(SORTS.map(function (x) {
        return { label: x.label, act: x.id, checked: s.sort === x.id };
      })).concat([
        { sep: true },
        { label: 'Show completed', icon: s.showCompleted ? '👁' : '🚫', act: '__completed', checked: s.showCompleted }
      ]), function (item) {
        if (!item || !item.act) return;
        if (item.act === '__completed') Store.updateSettings({ showCompleted: !s.showCompleted });
        else Store.updateSettings({ sort: item.act });
      });
    });

    $('#btn-menu').addEventListener('click', function () {
      if (state.sidebarOpen) closeSidebar(); else openSidebar();
    });
    $('#scrim').addEventListener('click', closeSidebar);
    $('#btn-sb-close').addEventListener('click', closeSidebar);

    $('#btn-new').addEventListener('click', function () { newNote(); });
    $('#fab').addEventListener('click', function () { newNote(); });

    $('#btn-notif').addEventListener('click', function () {
      Notifier.request().then(function (p) {
        renderTopbar();
        if (p === 'granted') { toast('Alerts enabled'); Engine.plan(); }
        else if (p === 'denied') toast('Your browser blocked alerts. Enable them in site settings.', { kind: 'error', duration: 8000 });
      });
    });

    $('#btn-settings').addEventListener('click', function () { Editor.openSettings(); });

    var search = $('#search-input');
    search.addEventListener('input', function () {
      state.query = search.value;
      renderContent();
      var clear = $('#search-clear');
      if (clear) clear.style.display = state.query ? '' : 'none';
    });
    $('#search-clear').addEventListener('click', function () {
      state.query = '';
      search.value = '';
      search.focus();
      render();
    });

    $$('#bottom-nav [data-scope]').forEach(function (b) {
      b.addEventListener('click', function () { setScope(b.getAttribute('data-scope')); });
    });

    Store.onChange(function () { render(); });
    window.addEventListener('resize', function () { closeMenu(); });

    // Keep relative times honest without a full re-render storm.
    setInterval(function () {
      if (document.visibilityState === 'visible' && !Alarm.isRinging()) renderStatus();
    }, 30000);

    render();
  }

  return {
    init: init,
    render: render,
    renderTopbar: renderTopbar,
    renderStatus: renderStatus,
    state: state,
    toast: toast,
    toastReminder: toastReminder,
    menu: menu,
    closeMenu: closeMenu,
    newNote: newNote,
    openEditor: openEditor,
    setScope: setScope,
    focusSearch: focusSearch,
    clearSelection: clearSelection,
    toggleSelect: toggleSelect,
    visibleNotes: visibleNotes,
    nextAlarmAt: nextAlarmAt,
    isOverdue: isOverdue,
    download: download,
    applyTheme: applyTheme,
    trashNote: trashNote,
    archiveNote: archiveNote,
    duplicateNote: duplicateNote,
    toggleDone: toggleDone,
    SORTS: SORTS,
    VIEWS: VIEWS
  };
})();

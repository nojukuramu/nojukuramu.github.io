/* editor.js — note editor panel, alarm dialog, settings, command palette. */
var Editor = (function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return MD.esc(s); };
  var pad2 = function (n) { return Sched.pad2(n); };

  var _openId = null;
  var _saveTimer = null;
  var _preview = false;
  var _lastFocus = null;

  /* ================= generic modal ================= */

  function modal(cfg) {
    var root = $('#modal-root');
    var wrap = document.createElement('div');
    wrap.className = 'modal-wrap' + (cfg.className ? ' ' + cfg.className : '');
    wrap.innerHTML =
      '<div class="modal-scrim" data-close></div>' +
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(cfg.title || 'Dialog') + '">' +
        '<header class="modal-head">' +
          '<h2>' + esc(cfg.title || '') + '</h2>' +
          '<button class="icon-btn" data-close aria-label="Close">✕</button>' +
        '</header>' +
        '<div class="modal-body">' + (cfg.body || '') + '</div>' +
        (cfg.footer ? '<footer class="modal-foot">' + cfg.footer + '</footer>' : '') +
      '</div>';
    root.appendChild(wrap);

    function close() {
      wrap.classList.add('is-out');
      setTimeout(function () { wrap.remove(); }, 180);
      document.removeEventListener('keydown', onKey, true);
      if (cfg.onClose) cfg.onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    }
    wrap.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) close();
    });
    document.addEventListener('keydown', onKey, true);
    requestAnimationFrame(function () { wrap.classList.add('is-in'); });
    if (cfg.onMount) cfg.onMount(wrap, close);
    return close;
  }

  /* ================= note editor ================= */

  function toLocalInput(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fromLocalInput(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0).getTime();
  }

  function open(id, opts) {
    opts = opts || {};
    var note = Store.byId(id);
    if (!note) return;
    _openId = id;
    _preview = false;
    _lastFocus = document.activeElement;

    var panel = $('#editor');
    document.documentElement.classList.add('editor-open');
    panel.setAttribute('aria-hidden', 'false');
    renderEditor();

    var titleEl = $('#ed-title');
    if (titleEl) {
      titleEl.focus();
      if (!opts.fresh && note.body) $('#ed-body').focus();
    }
  }

  function close() {
    flush();
    _openId = null;
    document.documentElement.classList.remove('editor-open');
    var panel = $('#editor');
    panel.setAttribute('aria-hidden', 'true');
    panel.innerHTML = '';
    if (_lastFocus && _lastFocus.focus) { try { _lastFocus.focus(); } catch (_) {} }
    UI.render();
  }

  function isOpen() { return !!_openId; }

  function flush() {
    clearTimeout(_saveTimer);
    if (!_openId) return;
    var note = Store.byId(_openId);
    if (!note) return;
    var t = $('#ed-title'), b = $('#ed-body');
    if (!t || !b) return;
    if (note.title !== t.value || note.body !== b.value) {
      note.title = t.value;
      note.body = b.value;
      Store.put(note, { silent: true });
    }
  }

  function scheduleSave() {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(function () {
      var note = Store.byId(_openId);
      if (!note) return;
      var t = $('#ed-title'), b = $('#ed-body');
      if (!t || !b) return;
      note.title = t.value;
      note.body = b.value;
      Store.put(note, { silent: true });
      updateMeta();
    }, 450);
  }

  function updateMeta() {
    var note = Store.byId(_openId);
    if (!note) return;
    var meta = $('#ed-meta');
    if (!meta) return;
    var words = (note.body.trim().match(/\S+/g) || []).length;
    var stats = Model.checklistStats(note.body);
    meta.textContent = words + ' word' + (words === 1 ? '' : 's') +
      (stats.total ? ' · ' + stats.done + '/' + stats.total + ' checked' : '') +
      ' · edited ' + Sched.relative(note.updatedAt);
  }

  function reminderRow(note, rem) {
    var s = Store.settings();
    var at = Sched.effectiveNext(rem);
    return '<div class="ed-rem' + (rem.enabled ? '' : ' is-off') + '" data-rid="' + esc(rem.id) + '">' +
      '<button class="ed-rem-toggle" data-act="toggle-rem" aria-label="Enable alarm" aria-pressed="' + rem.enabled + '">' +
        (rem.alarm ? '⏰' : '🔔') + '</button>' +
      '<button class="ed-rem-main" data-act="edit-rem">' +
        '<span class="ed-rem-when">' + esc(rem.label || Sched.describe(rem, s.time24)) + '</span>' +
        '<span class="ed-rem-next">' +
          (rem.enabled
            ? (at ? 'Next ' + esc(Sched.dateLabel(at, s.time24)) + ' · ' + esc(Sched.relative(at)) : 'Finished')
            : 'Disabled') +
          (rem.label ? ' · ' + esc(Sched.describe(rem, s.time24)) : '') +
        '</span>' +
      '</button>' +
      '<button class="ed-rem-del" data-act="del-rem" aria-label="Remove alarm">✕</button>' +
    '</div>';
  }

  function renderEditor() {
    var note = Store.byId(_openId);
    if (!note) return;
    var s = Store.settings();
    var panel = $('#editor');
    var books = Store.notebooks();

    panel.innerHTML =
      '<div class="ed-shell color-' + esc(note.color) + '">' +
        '<header class="ed-head">' +
          '<button class="icon-btn" data-act="close" aria-label="Close editor">✕</button>' +
          '<div class="ed-head-actions">' +
            '<button class="icon-btn' + (note.done ? ' is-on' : '') + '" data-act="done" title="Mark done">' + (note.done ? '☑' : '☐') + '</button>' +
            '<button class="icon-btn' + (note.pinned ? ' is-on' : '') + '" data-act="pin" title="Pin">📌</button>' +
            '<button class="icon-btn' + (note.starred ? ' is-on' : '') + '" data-act="star" title="Star">' + (note.starred ? '★' : '☆') + '</button>' +
            '<button class="icon-btn" data-act="preview" title="Toggle preview" aria-pressed="' + _preview + '">' + (_preview ? '✏️' : '👁') + '</button>' +
            '<button class="icon-btn" data-act="more" title="More">⋯</button>' +
          '</div>' +
        '</header>' +

        '<div class="ed-scroll">' +
          '<input id="ed-title" class="ed-title" placeholder="Title" value="' + esc(note.title) + '" maxlength="300">' +

          '<div class="ed-toolbar" role="toolbar" aria-label="Formatting">' +
            '<button data-md="bold" title="Bold (Ctrl+B)"><b>B</b></button>' +
            '<button data-md="italic" title="Italic (Ctrl+I)"><i>I</i></button>' +
            '<button data-md="head" title="Heading">H</button>' +
            '<button data-md="bullet" title="Bullet list">•</button>' +
            '<button data-md="check" title="Checklist (Ctrl+Shift+C)">☑</button>' +
            '<button data-md="number" title="Numbered list">1.</button>' +
            '<button data-md="quote" title="Quote">❝</button>' +
            '<button data-md="code" title="Code">&lt;/&gt;</button>' +
            '<button data-md="link" title="Link">🔗</button>' +
            '<button data-md="strike" title="Strikethrough"><s>S</s></button>' +
            '<button data-md="hr" title="Divider">—</button>' +
          '</div>' +

          (_preview
            ? '<div class="ed-preview md">' + MD.render(note.body, { interactive: false }) + '</div>'
            : '<textarea id="ed-body" class="ed-body" placeholder="Write it down…  Markdown works: **bold**, # heading, - [ ] checklist">' + esc(note.body) + '</textarea>') +

          '<section class="ed-section">' +
            '<h3>Alarms &amp; reminders</h3>' +
            '<div class="ed-rems">' +
              (note.reminders.length
                ? note.reminders.map(function (r) { return reminderRow(note, r); }).join('')
                : '<p class="ed-hint">No alarms on this note yet.</p>') +
            '</div>' +
            '<div class="ed-quick">' +
              '<button data-quick="10m">In 10 min</button>' +
              '<button data-quick="1h">In 1 hour</button>' +
              '<button data-quick="tonight">Tonight 8pm</button>' +
              '<button data-quick="tomorrow">Tomorrow 9am</button>' +
              '<button class="btn-primary" data-act="add-rem">＋ Custom alarm</button>' +
            '</div>' +
          '</section>' +

          '<section class="ed-section">' +
            '<h3>Organise</h3>' +
            '<div class="ed-field">' +
              '<label>Colour</label>' +
              '<div class="ed-swatches">' + Model.COLORS.map(function (c) {
                return '<button class="swatch color-' + c + (note.color === c ? ' is-on' : '') + '" data-color="' + c + '" aria-label="' + c + '" title="' + c + '"></button>';
              }).join('') + '</div>' +
            '</div>' +
            '<div class="ed-field">' +
              '<label for="ed-prio">Priority</label>' +
              '<select id="ed-prio">' + Model.PRIORITIES.map(function (p) {
                return '<option value="' + p + '"' + (note.priority === p ? ' selected' : '') + '>' +
                  ({ none: 'None', low: 'Low', medium: 'Medium', high: 'High' })[p] + '</option>';
              }).join('') + '</select>' +
            '</div>' +
            '<div class="ed-field">' +
              '<label for="ed-book">Notebook</label>' +
              '<select id="ed-book">' +
                '<option value="">No notebook</option>' +
                books.map(function (b) {
                  return '<option value="' + esc(b.id) + '"' + (note.notebook === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>';
                }).join('') +
                '<option value="__new">＋ New notebook…</option>' +
              '</select>' +
            '</div>' +
            '<div class="ed-field">' +
              '<label for="ed-tag-input">Tags</label>' +
              '<div class="ed-tags">' +
                note.tags.map(function (t) {
                  return '<span class="ed-tag">#' + esc(t) + '<button data-untag="' + esc(t) + '" aria-label="Remove tag">✕</button></span>';
                }).join('') +
                '<input id="ed-tag-input" placeholder="Add tag…" list="ed-tag-list" autocomplete="off">' +
                '<datalist id="ed-tag-list">' + Store.allTags().map(function (t) {
                  return '<option value="' + esc(t.name) + '"></option>';
                }).join('') + '</datalist>' +
              '</div>' +
            '</div>' +
          '</section>' +
        '</div>' +

        '<footer class="ed-foot">' +
          '<span id="ed-meta" class="ed-meta"></span>' +
          '<div class="ed-foot-actions">' +
            '<button class="icon-btn" data-act="archive" title="Archive">📦</button>' +
            '<button class="icon-btn" data-act="duplicate" title="Duplicate">⧉</button>' +
            '<button class="icon-btn danger" data-act="trash" title="Move to trash">🗑</button>' +
          '</div>' +
        '</footer>' +
      '</div>';

    updateMeta();
    bindEditor(note);
  }

  function bindEditor(note) {
    var title = $('#ed-title');
    var body = $('#ed-body');
    if (title) title.addEventListener('input', scheduleSave);
    if (body) {
      body.addEventListener('input', function () { autoGrow(body); scheduleSave(); });
      body.addEventListener('keydown', onBodyKey);
      autoGrow(body);
    }

    bindPanelOnce();
    bindFields();
  }

  /* The panel element itself survives every re-render, so its delegated
   * listener must only ever be attached once. */
  var _panelBound = false;
  function bindPanelOnce() {
    if (_panelBound) return;
    _panelBound = true;
    var panel = $('#editor');

    panel.addEventListener('click', function (e) {
      var el = e.target.closest('[data-act],[data-md],[data-color],[data-untag],[data-quick]');
      if (!el) return;
      var n = Store.byId(_openId);
      if (!n) return;

      if (el.hasAttribute('data-md')) { applyMarkdown(el.getAttribute('data-md')); return; }
      if (el.hasAttribute('data-color')) {
        n.color = el.getAttribute('data-color');
        Store.put(n, { silent: true });
        renderEditor();
        UI.render();
        return;
      }
      if (el.hasAttribute('data-untag')) {
        n.tags = n.tags.filter(function (t) { return t !== el.getAttribute('data-untag'); });
        Store.put(n, { silent: true });
        renderEditor();
        return;
      }
      if (el.hasAttribute('data-quick')) { quickAlarm(n, el.getAttribute('data-quick')); return; }

      var act = el.getAttribute('data-act');
      var row = el.closest('[data-rid]');
      var rid = row && row.getAttribute('data-rid');

      switch (act) {
        case 'close': close(); break;
        case 'preview': flush(); _preview = !_preview; renderEditor(); break;
        case 'done': UI.toggleDone(n); renderEditor(); break;
        case 'pin': n.pinned = !n.pinned; Store.put(n, { silent: true }); renderEditor(); break;
        case 'star': n.starred = !n.starred; Store.put(n, { silent: true }); renderEditor(); break;
        case 'add-rem': openReminder(n.id, null); break;
        case 'edit-rem': openReminder(n.id, rid); break;
        case 'toggle-rem': {
          var rem = n.reminders.filter(function (r) { return r.id === rid; })[0];
          if (rem) {
            rem.enabled = !rem.enabled;
            rem.snoozedUntil = null;
            rem.snoozeCount = 0;
            rem.nextAt = rem.enabled ? Sched.nextOccurrence(rem, Date.now(), { quietHours: Store.settings().quietHours }) : null;
            Store.put(n, { silent: true }).then(function () { Engine.plan(); });
            renderEditor();
          }
          break;
        }
        case 'del-rem': {
          n.reminders = n.reminders.filter(function (r) { return r.id !== rid; });
          Notifier.clearFor(rid);
          Store.put(n, { silent: true }).then(function () { Engine.plan(); });
          renderEditor();
          break;
        }
        case 'archive': UI.archiveNote(n); close(); break;
        case 'duplicate': UI.duplicateNote(n); break;
        case 'trash':
          if (n.trashed) { Store.remove(n.id); close(); }
          else { UI.trashNote(n); close(); }
          break;
        case 'more': editorMenu(n, el); break;
      }
    });
  }

  /* Inputs are rebuilt by every render, so these bind per render. */
  function bindFields() {
    var tagInput = $('#ed-tag-input');
    if (tagInput) {
      tagInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ',') return;
        e.preventDefault();
        var val = tagInput.value.replace(/^#/, '').trim();
        if (!val) return;
        var n = Store.byId(_openId);
        if (n.tags.indexOf(val) === -1) n.tags.push(val);
        Store.put(n, { silent: true });
        tagInput.value = '';
        renderEditor();
        setTimeout(function () { var t = $('#ed-tag-input'); if (t) t.focus(); }, 0);
      });
    }

    var prio = $('#ed-prio');
    if (prio) prio.addEventListener('change', function () {
      var n = Store.byId(_openId);
      n.priority = prio.value;
      Store.put(n, { silent: true });
      UI.render();
    });

    var book = $('#ed-book');
    if (book) book.addEventListener('change', function () {
      var n = Store.byId(_openId);
      if (book.value === '__new') {
        var name = prompt('Notebook name:');
        if (!name) { renderEditor(); return; }
        Store.addNotebook(name).then(function (nb) {
          n.notebook = nb.id;
          Store.put(n, { silent: true });
          renderEditor();
        });
        return;
      }
      n.notebook = book.value || null;
      Store.put(n, { silent: true });
      UI.render();
    });
  }

  function editorMenu(note, anchor) {
    UI.menu(anchor, [
      { label: 'Copy text', icon: '📋', act: 'copy' },
      { label: 'Export as Markdown', icon: '⬇', act: 'md' },
      { sep: true },
      { label: 'Insert current date', icon: '📅', act: 'date' },
      { label: 'Sort checklist (undone first)', icon: '↕', act: 'sortcheck' },
      { label: 'Clear completed items', icon: '🧹', act: 'clearcheck' }
    ], function (item) {
      if (!item) return;
      var n = Store.byId(_openId);
      if (item.act === 'copy') {
        navigator.clipboard && navigator.clipboard.writeText((n.title ? n.title + '\n\n' : '') + n.body)
          .then(function () { UI.toast('Copied'); });
      } else if (item.act === 'md') {
        UI.download((n.title || 'note').replace(/[^\w\- ]+/g, '').slice(0, 40) + '.md',
          (n.title ? '# ' + n.title + '\n\n' : '') + n.body, 'text/markdown');
      } else if (item.act === 'date') {
        insertAtCursor(Sched.dateLabel(Date.now(), Store.settings().time24));
      } else if (item.act === 'sortcheck') {
        var lines = n.body.split('\n');
        var checks = lines.filter(function (l) { return /^\s*[-*]\s+\[( |x|X)\]/.test(l); });
        var rest = lines.filter(function (l) { return !/^\s*[-*]\s+\[( |x|X)\]/.test(l); });
        checks.sort(function (a, b) {
          var ad = /\[[xX]\]/.test(a) ? 1 : 0, bd = /\[[xX]\]/.test(b) ? 1 : 0;
          return ad - bd;
        });
        n.body = rest.concat(checks).join('\n');
        Store.put(n, { silent: true });
        renderEditor();
      } else if (item.act === 'clearcheck') {
        n.body = n.body.split('\n').filter(function (l) { return !/^\s*[-*]\s+\[[xX]\]/.test(l); }).join('\n');
        Store.put(n, { silent: true });
        renderEditor();
        UI.toast('Completed items removed');
      }
    });
  }

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.max(200, el.scrollHeight) + 'px';
  }

  function insertAtCursor(text) {
    var b = $('#ed-body');
    if (!b) return;
    var s = b.selectionStart, e = b.selectionEnd;
    b.value = b.value.slice(0, s) + text + b.value.slice(e);
    b.selectionStart = b.selectionEnd = s + text.length;
    b.focus();
    autoGrow(b);
    scheduleSave();
  }

  function applyMarkdown(kind) {
    var b = $('#ed-body');
    if (!b) { _preview = false; renderEditor(); return; }
    var start = b.selectionStart, end = b.selectionEnd;
    var val = b.value;
    var sel = val.slice(start, end);

    function wrap(before, after) {
      b.value = val.slice(0, start) + before + sel + (after == null ? before : after) + val.slice(end);
      b.selectionStart = start + before.length;
      b.selectionEnd = start + before.length + sel.length;
    }
    function linePrefix(prefix) {
      var ls = val.lastIndexOf('\n', start - 1) + 1;
      var le = val.indexOf('\n', end);
      if (le === -1) le = val.length;
      var block = val.slice(ls, le).split('\n').map(function (l, i) {
        return (typeof prefix === 'function' ? prefix(i) : prefix) + l;
      }).join('\n');
      b.value = val.slice(0, ls) + block + val.slice(le);
      b.selectionStart = b.selectionEnd = ls + block.length;
    }

    switch (kind) {
      case 'bold': wrap('**'); break;
      case 'italic': wrap('*'); break;
      case 'strike': wrap('~~'); break;
      case 'code': wrap('`'); break;
      case 'head': linePrefix('## '); break;
      case 'bullet': linePrefix('- '); break;
      case 'check': linePrefix('- [ ] '); break;
      case 'number': linePrefix(function (i) { return (i + 1) + '. '; }); break;
      case 'quote': linePrefix('> '); break;
      case 'hr': insertAtCursor('\n\n---\n\n'); return;
      case 'link': {
        var url = prompt('Link URL:', 'https://');
        if (!url) return;
        wrap('[', '](' + url + ')');
        break;
      }
    }
    b.focus();
    autoGrow(b);
    scheduleSave();
  }

  /* Enter on a list line continues the list — the small thing that makes
   * checklists actually pleasant to write. */
  function onBodyKey(e) {
    var b = e.currentTarget;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      var k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); applyMarkdown('bold'); return; }
      if (k === 'i') { e.preventDefault(); applyMarkdown('italic'); return; }
      if (k === 'c' && e.shiftKey) { e.preventDefault(); applyMarkdown('check'); return; }
      if (k === 'enter') { e.preventDefault(); close(); return; }
    }
    if (e.key !== 'Enter' || e.shiftKey) return;
    var pos = b.selectionStart;
    var lineStart = b.value.lastIndexOf('\n', pos - 1) + 1;
    var line = b.value.slice(lineStart, pos);
    var m = /^(\s*)([-*]\s+\[( |x|X)\]\s|[-*+]\s|\d+[.)]\s)/.exec(line);
    if (!m) return;
    var rest = line.slice(m[0].length);
    e.preventDefault();
    if (!rest.trim()) {
      // empty list item — end the list
      b.value = b.value.slice(0, lineStart) + b.value.slice(pos);
      b.selectionStart = b.selectionEnd = lineStart;
    } else {
      var marker = m[2];
      if (/^\d+[.)]\s$/.test(marker)) marker = (parseInt(marker, 10) + 1) + '. ';
      if (/\[[xX]\]/.test(marker)) marker = marker.replace(/\[[xX]\]/, '[ ]');
      var ins = '\n' + m[1] + marker;
      b.value = b.value.slice(0, pos) + ins + b.value.slice(pos);
      b.selectionStart = b.selectionEnd = pos + ins.length;
    }
    autoGrow(b);
    scheduleSave();
  }

  /* ================= quick alarms ================= */

  function quickAlarm(note, kind) {
    var s = Store.settings();
    var rem = Model.defaultReminder(s);
    var now = new Date();
    var at;
    if (kind === '10m') at = Date.now() + 10 * 60000;
    else if (kind === '1h') at = Date.now() + 3600000;
    else if (kind === 'tonight') {
      var t = new Date(now); t.setHours(20, 0, 0, 0);
      if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1);
      at = t.getTime();
    } else {
      var d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
      at = d.getTime();
    }
    rem.kind = 'once';
    rem.at = at;
    rem.nextAt = Sched.nextOccurrence(rem, Date.now(), { quietHours: s.quietHours });
    note.reminders.push(rem);
    Store.put(note, { silent: true }).then(function () {
      Engine.plan();
      UI.toast('Alarm set · ' + Sched.dateLabel(at, s.time24));
    });
    if (_openId === note.id) renderEditor();
    UI.render();
  }

  /* ================= reminder dialog ================= */

  var KINDS = [
    { id: 'once', label: 'Once' },
    { id: 'daily', label: 'Daily' },
    { id: 'weekly', label: 'Weekly' },
    { id: 'monthly', label: 'Monthly' },
    { id: 'yearly', label: 'Yearly' },
    { id: 'interval', label: 'Every…' }
  ];

  function openReminder(noteId, reminderId) {
    var note = Store.byId(noteId);
    if (!note) return;
    var s = Store.settings();
    var isNew = !reminderId;
    var source = isNew
      ? Model.defaultReminder(s)
      : note.reminders.filter(function (r) { return r.id === reminderId; })[0];
    if (!source) return;
    var draft = JSON.parse(JSON.stringify(source));
    var root = null;   // the #rem-form of *this* dialog

    var close = modal({
      title: isNew ? 'New alarm' : 'Edit alarm',
      className: 'modal-reminder',
      body: '<div id="rem-form"></div>',
      footer:
        (isNew ? '' : '<button class="btn-ghost danger" data-rem="delete">Delete</button>') +
        '<div class="spacer"></div>' +
        '<button class="btn-ghost" data-close>Cancel</button>' +
        '<button class="btn-primary" data-rem="save">' + (isNew ? 'Add alarm' : 'Save') + '</button>',
      onMount: function (wrap, closeFn) {
        root = wrap.querySelector('#rem-form');
        renderForm();

        wrap.addEventListener('click', function (e) {
          var el = e.target.closest('[data-rem],[data-kind],[data-day],[data-mode],[data-preset]');
          if (!el) return;

          if (el.hasAttribute('data-kind')) {
            draft.kind = el.getAttribute('data-kind');
            if (draft.kind === 'interval' && !draft.anchor) draft.anchor = Date.now();
            renderForm();
            return;
          }
          if (el.hasAttribute('data-mode')) {
            draft.alarm = el.getAttribute('data-mode') === 'alarm';
            renderForm();
            return;
          }
          if (el.hasAttribute('data-day')) {
            var d = Number(el.getAttribute('data-day'));
            var i = draft.days.indexOf(d);
            if (i > -1) draft.days.splice(i, 1); else draft.days.push(d);
            renderForm();
            return;
          }
          if (el.hasAttribute('data-preset')) {
            applyPreset(el.getAttribute('data-preset'));
            renderForm();
            return;
          }

          var act = el.getAttribute('data-rem');
          if (act === 'save') { save(); closeFn(); }
          else if (act === 'delete') {
            note.reminders = note.reminders.filter(function (r) { return r.id !== reminderId; });
            Notifier.clearFor(reminderId);
            Store.put(note, { silent: true }).then(function () { Engine.plan(); UI.render(); });
            if (_openId) renderEditor();
            closeFn();
          } else if (act === 'preview-tone') {
            Ringtone.preview(draft.ringtone, draft.volume);
          }
        });
      }
    });

    function applyPreset(p) {
      var now = new Date();
      draft.kind = 'once';
      if (p === '5m') draft.at = Date.now() + 5 * 60000;
      else if (p === '30m') draft.at = Date.now() + 30 * 60000;
      else if (p === '1h') draft.at = Date.now() + 3600000;
      else if (p === '3h') draft.at = Date.now() + 3 * 3600000;
      else if (p === 'tomorrow') {
        var d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
        draft.at = d.getTime();
      } else if (p === 'nextweek') {
        var w = new Date(now); w.setDate(w.getDate() + 7); w.setHours(9, 0, 0, 0);
        draft.at = w.getTime();
      } else if (p === 'weekdays') {
        draft.kind = 'weekly';
        draft.days = [1, 2, 3, 4, 5];
        draft.time = '09:00';
      }
    }

    function collect() {
      if (!root) return;
      var g = function (sel) { return root.querySelector(sel); };
      if (g('#rem-label')) draft.label = g('#rem-label').value.trim();
      if (g('#rem-at')) {
        var v = fromLocalInput(g('#rem-at').value);
        if (v) draft.at = v;
      }
      if (g('#rem-time')) draft.time = g('#rem-time').value || '09:00';
      if (g('#rem-monthday')) draft.monthDay = Math.max(1, Math.min(31, parseInt(g('#rem-monthday').value, 10) || 1));
      if (g('#rem-month')) draft.month = parseInt(g('#rem-month').value, 10) || 0;
      if (g('#rem-every')) draft.every = Math.max(1, parseInt(g('#rem-every').value, 10) || 1);
      if (g('#rem-unit')) draft.unit = g('#rem-unit').value;
      if (g('#rem-tone')) draft.ringtone = g('#rem-tone').value;
      if (g('#rem-vol')) draft.volume = Number(g('#rem-vol').value) / 100;
      if (g('#rem-vibrate')) draft.vibrate = g('#rem-vibrate').checked;
      if (g('#rem-quiet')) draft.respectQuiet = g('#rem-quiet').checked;
      if (g('#rem-autosnooze')) draft.autoSnooze.enabled = g('#rem-autosnooze').checked;
      if (g('#rem-snooze-every')) draft.autoSnooze.every = Math.max(1, parseInt(g('#rem-snooze-every').value, 10) || 5);
      if (g('#rem-snooze-max')) draft.autoSnooze.max = Math.max(0, parseInt(g('#rem-snooze-max').value, 10) || 0);
      if (g('#rem-end')) {
        var e = g('#rem-end').value;
        draft.endAt = e ? fromLocalInput(e + 'T23:59') : null;
      }
    }

    function preview() {
      var t = Sched.nextOccurrence(draft, Date.now(), { quietHours: s.quietHours });
      if (!t) return '<span class="rem-preview-none">This alarm has no future occurrences.</span>';
      return '<strong>' + esc(Sched.dateLabel(t, s.time24)) + '</strong> · ' + esc(Sched.relative(t));
    }

    function renderForm() {
      collect();
      if (!root) return;
      var k = draft.kind;

      root.innerHTML =
        '<div class="rem-modes">' +
          '<button class="rem-mode' + (draft.alarm ? ' is-on' : '') + '" data-mode="alarm">' +
            '<span aria-hidden="true">⏰</span><strong>Alarm</strong><small>Rings until answered</small></button>' +
          '<button class="rem-mode' + (!draft.alarm ? ' is-on' : '') + '" data-mode="notify">' +
            '<span aria-hidden="true">🔔</span><strong>Notification</strong><small>A quiet nudge</small></button>' +
        '</div>' +

        '<div class="rem-presets">' +
          ['5m:In 5 min', '30m:In 30 min', '1h:In 1 hour', '3h:In 3 hours', 'tomorrow:Tomorrow 9am', 'nextweek:Next week', 'weekdays:Weekdays 9am']
            .map(function (p) {
              var bits = p.split(':');
              return '<button data-preset="' + bits[0] + '">' + bits[1] + '</button>';
            }).join('') +
        '</div>' +

        '<div class="rem-kinds" role="tablist">' + KINDS.map(function (x) {
          return '<button role="tab" class="' + (k === x.id ? 'is-on' : '') + '" data-kind="' + x.id + '" aria-selected="' + (k === x.id) + '">' + x.label + '</button>';
        }).join('') + '</div>' +

        '<div class="rem-fields">' + fieldsFor(k) + '</div>' +

        '<div class="rem-preview">Next: ' + preview() + '</div>' +

        '<details class="rem-adv"' + (draft.alarm ? ' open' : '') + '>' +
          '<summary>Sound &amp; behaviour</summary>' +
          '<div class="ed-field">' +
            '<label for="rem-label">Label</label>' +
            '<input id="rem-label" placeholder="Optional — shown instead of the title" value="' + esc(draft.label) + '" maxlength="120">' +
          '</div>' +
          '<div class="ed-field">' +
            '<label for="rem-tone">Ringtone</label>' +
            '<div class="rem-inline">' +
              '<select id="rem-tone">' + Ringtone.list().map(function (t) {
                return '<option value="' + t.id + '"' + (draft.ringtone === t.id ? ' selected' : '') + '>' + t.label + '</option>';
              }).join('') + '</select>' +
              '<button class="btn-ghost" data-rem="preview-tone" type="button">▶ Play</button>' +
            '</div>' +
          '</div>' +
          '<div class="ed-field">' +
            '<label for="rem-vol">Volume</label>' +
            '<input id="rem-vol" type="range" min="0" max="100" value="' + Math.round(draft.volume * 100) + '">' +
          '</div>' +
          '<label class="ed-check"><input type="checkbox" id="rem-vibrate"' + (draft.vibrate ? ' checked' : '') + '> Vibrate</label>' +
          '<label class="ed-check"><input type="checkbox" id="rem-quiet"' + (draft.respectQuiet ? ' checked' : '') + '> Respect quiet hours</label>' +
          '<label class="ed-check"><input type="checkbox" id="rem-autosnooze"' + (draft.autoSnooze.enabled ? ' checked' : '') + '> Re-alert if I do not answer</label>' +
          '<div class="rem-inline rem-sub">' +
            '<label>every</label><input id="rem-snooze-every" type="number" min="1" max="120" value="' + draft.autoSnooze.every + '"><span>min,</span>' +
            '<label>up to</label><input id="rem-snooze-max" type="number" min="0" max="20" value="' + draft.autoSnooze.max + '"><span>times</span>' +
          '</div>' +
          (k !== 'once' ? '<div class="ed-field">' +
            '<label for="rem-end">Repeat until (optional)</label>' +
            '<input id="rem-end" type="date" value="' + (draft.endAt ? new Date(draft.endAt).toISOString().slice(0, 10) : '') + '">' +
          '</div>' : '') +
        '</details>';

      root.querySelectorAll('input,select').forEach(function (el) {
        el.addEventListener('change', function () {
          collect();
          var p = root.querySelector('.rem-preview');
          if (p) p.innerHTML = 'Next: ' + preview();
        });
      });
    }

    function fieldsFor(k) {
      if (k === 'once') {
        return '<div class="ed-field"><label for="rem-at">Date &amp; time</label>' +
          '<input id="rem-at" type="datetime-local" value="' + toLocalInput(draft.at || Date.now() + 900000) + '"></div>';
      }
      if (k === 'daily') {
        return '<div class="ed-field"><label for="rem-time">Time</label>' +
          '<input id="rem-time" type="time" value="' + esc(draft.time) + '"></div>';
      }
      if (k === 'weekly') {
        var start = Store.settings().weekStart || 0;
        var order = [];
        for (var i = 0; i < 7; i++) order.push((start + i) % 7);
        return '<div class="ed-field"><label>Days</label><div class="rem-days">' +
          order.map(function (d) {
            return '<button data-day="' + d + '" class="' + (draft.days.indexOf(d) > -1 ? 'is-on' : '') + '" aria-pressed="' + (draft.days.indexOf(d) > -1) + '">' + Sched.DAY_NAMES[d] + '</button>';
          }).join('') + '</div></div>' +
          '<div class="ed-field"><label for="rem-time">Time</label><input id="rem-time" type="time" value="' + esc(draft.time) + '"></div>';
      }
      if (k === 'monthly') {
        return '<div class="ed-field"><label for="rem-monthday">Day of month</label>' +
          '<input id="rem-monthday" type="number" min="1" max="31" value="' + (draft.monthDay || 1) + '">' +
          '<p class="ed-hint">Months that are too short fall back to their last day.</p></div>' +
          '<div class="ed-field"><label for="rem-time">Time</label><input id="rem-time" type="time" value="' + esc(draft.time) + '"></div>';
      }
      if (k === 'yearly') {
        return '<div class="rem-inline">' +
          '<div class="ed-field"><label for="rem-month">Month</label><select id="rem-month">' +
            Sched.MONTH_LONG.map(function (m, i) {
              return '<option value="' + i + '"' + (draft.month === i ? ' selected' : '') + '>' + m + '</option>';
            }).join('') + '</select></div>' +
          '<div class="ed-field"><label for="rem-monthday">Day</label><input id="rem-monthday" type="number" min="1" max="31" value="' + (draft.monthDay || 1) + '"></div>' +
        '</div>' +
        '<div class="ed-field"><label for="rem-time">Time</label><input id="rem-time" type="time" value="' + esc(draft.time) + '"></div>';
      }
      // interval
      return '<div class="rem-inline">' +
        '<div class="ed-field"><label for="rem-every">Every</label><input id="rem-every" type="number" min="1" max="999" value="' + draft.every + '"></div>' +
        '<div class="ed-field"><label for="rem-unit">Unit</label><select id="rem-unit">' +
          ['minutes', 'hours', 'days', 'weeks'].map(function (u) {
            return '<option value="' + u + '"' + (draft.unit === u ? ' selected' : '') + '>' + u + '</option>';
          }).join('') + '</select></div>' +
      '</div>' +
      ((draft.unit === 'days' || draft.unit === 'weeks')
        ? '<div class="ed-field"><label for="rem-time">At</label><input id="rem-time" type="time" value="' + esc(draft.time) + '"></div>'
        : '<p class="ed-hint">Counts from now, and keeps going until you turn it off.</p>');
    }

    function save() {
      collect();
      draft.enabled = true;
      draft.snoozedUntil = null;
      draft.snoozeCount = 0;
      if (draft.kind === 'interval') draft.anchor = Date.now();
      if (draft.kind === 'weekly' && !draft.days.length) draft.days = [new Date().getDay()];
      draft.nextAt = Sched.nextOccurrence(draft, Date.now(), { quietHours: s.quietHours });

      var n = Store.byId(noteId);
      if (!n) return;
      var idx = n.reminders.findIndex(function (r) { return r.id === draft.id; });
      if (idx === -1) n.reminders.push(Model.normalizeReminder(draft, s));
      else n.reminders[idx] = Model.normalizeReminder(draft, s);

      Store.put(n, { silent: true }).then(function () {
        Engine.plan();
        UI.render();
        if (draft.nextAt) UI.toast('Alarm set · ' + Sched.dateLabel(draft.nextAt, s.time24));
        if (Notifier.permission() === 'default') {
          Notifier.request().then(function () { UI.renderTopbar(); });
        }
      });
      if (_openId) renderEditor();
    }

    return close;
  }

  /* ================= settings ================= */

  var ACCENTS = ['violet', 'blue', 'teal', 'green', 'amber', 'rose', 'slate'];

  function openSettings(tab) {
    var s = Store.settings();
    var active = tab || 'appearance';

    modal({
      title: 'Settings',
      className: 'modal-settings',
      body: '<div class="set-tabs" role="tablist">' +
          ['appearance:Appearance', 'alarms:Alarms', 'data:Data', 'about:About'].map(function (t) {
            var b = t.split(':');
            return '<button role="tab" data-tab="' + b[0] + '" class="' + (active === b[0] ? 'is-on' : '') + '">' + b[1] + '</button>';
          }).join('') +
        '</div><div id="set-body"></div>',
      onMount: function (wrap, closeFn) {
        renderTab(active);

        wrap.addEventListener('click', function (e) {
          var t = e.target.closest('[data-tab]');
          if (t) {
            active = t.getAttribute('data-tab');
            $$('.set-tabs button', wrap).forEach(function (b) { b.classList.toggle('is-on', b.getAttribute('data-tab') === active); });
            renderTab(active);
            return;
          }
          var a = e.target.closest('[data-set]');
          if (!a) return;
          handle(a.getAttribute('data-set'), a, closeFn);
        });

        function renderTab(name) {
          var host = $('#set-body', wrap);
          var st = Store.settings();
          if (name === 'appearance') {
            host.innerHTML =
              '<div class="ed-field"><label>Theme</label><div class="seg">' +
                ['system:Auto', 'light:Light', 'dark:Dark'].map(function (x) {
                  var b = x.split(':');
                  return '<button data-set="theme:' + b[0] + '" class="' + (st.theme === b[0] ? 'is-on' : '') + '">' + b[1] + '</button>';
                }).join('') + '</div></div>' +
              '<div class="ed-field"><label>Accent</label><div class="ed-swatches">' +
                ACCENTS.map(function (a) {
                  return '<button class="swatch accent-' + a + (st.accent === a ? ' is-on' : '') + '" data-set="accent:' + a + '" aria-label="' + a + '"></button>';
                }).join('') + '</div></div>' +
              '<div class="ed-field"><label>Density</label><div class="seg">' +
                ['comfortable:Comfortable', 'compact:Compact'].map(function (x) {
                  var b = x.split(':');
                  return '<button data-set="density:' + b[0] + '" class="' + (st.density === b[0] ? 'is-on' : '') + '">' + b[1] + '</button>';
                }).join('') + '</div></div>' +
              '<div class="ed-field"><label>Clock</label><div class="seg">' +
                '<button data-set="time24:0" class="' + (!st.time24 ? 'is-on' : '') + '">12-hour</button>' +
                '<button data-set="time24:1" class="' + (st.time24 ? 'is-on' : '') + '">24-hour</button>' +
              '</div></div>' +
              '<div class="ed-field"><label>Week starts on</label><div class="seg">' +
                '<button data-set="weekStart:0" class="' + (st.weekStart === 0 ? 'is-on' : '') + '">Sunday</button>' +
                '<button data-set="weekStart:1" class="' + (st.weekStart === 1 ? 'is-on' : '') + '">Monday</button>' +
              '</div></div>' +
              '<label class="ed-check"><input type="checkbox" data-set="toggle:showCompleted"' + (st.showCompleted ? ' checked' : '') + '> Show completed notes in lists</label>';
            return;
          }

          if (name === 'alarms') {
            var perm = Notifier.permission();
            host.innerHTML =
              '<div class="set-perm ' + (perm === 'granted' ? 'is-ok' : perm === 'denied' ? 'is-bad' : '') + '">' +
                '<div><strong>System notifications: ' + (perm === 'granted' ? 'on' : perm === 'denied' ? 'blocked' : 'off') + '</strong>' +
                '<p>' + (perm === 'granted'
                  ? (Notifier.triggersSupported()
                    ? 'This browser can fire alarms even when Task Notes is closed.'
                    : 'Alarms fire while a tab is open. Install the app and keep it running for the most reliable alerts.')
                  : perm === 'denied'
                    ? 'Your browser is blocking alerts. Re-enable them from the padlock icon in the address bar.'
                    : 'Turn these on so alarms reach you outside the tab.') + '</p></div>' +
                (perm === 'default' ? '<button class="btn-primary" data-set="ask-perm">Enable</button>' : '') +
              '</div>' +
              '<label class="ed-check"><input type="checkbox" data-set="toggle:sound"' + (st.sound ? ' checked' : '') + '> Play alarm sounds</label>' +
              '<label class="ed-check"><input type="checkbox" data-set="toggle:vibrate"' + (st.vibrate ? ' checked' : '') + '> Vibrate on mobile</label>' +
              '<label class="ed-check"><input type="checkbox" data-set="toggle:keepAwake"' + (st.keepAwake ? ' checked' : '') + '> Keep timers running in background tabs <small>(plays a silent track; uses a little more battery)</small></label>' +
              '<div class="ed-field"><label for="set-tone">Default ringtone</label><div class="rem-inline">' +
                '<select id="set-tone" data-set="field:defaultRingtone">' + Ringtone.list().map(function (t) {
                  return '<option value="' + t.id + '"' + (st.defaultRingtone === t.id ? ' selected' : '') + '>' + t.label + '</option>';
                }).join('') + '</select>' +
                '<button class="btn-ghost" data-set="preview-tone">▶ Play</button>' +
              '</div></div>' +
              '<div class="ed-field"><label for="set-snooze">Default snooze</label><div class="rem-inline">' +
                '<input id="set-snooze" type="number" min="1" max="120" value="' + st.defaultSnooze.every + '" data-set="field:snoozeEvery"><span>minutes</span>' +
              '</div></div>' +
              '<div class="ed-field"><label>Quiet hours</label>' +
                '<label class="ed-check"><input type="checkbox" data-set="toggle:quiet"' + (st.quietHours.enabled ? ' checked' : '') + '> Hold alarms overnight</label>' +
                '<div class="rem-inline">' +
                  '<input type="time" value="' + esc(st.quietHours.start) + '" data-set="field:quietStart"><span>to</span>' +
                  '<input type="time" value="' + esc(st.quietHours.end) + '" data-set="field:quietEnd">' +
                '</div>' +
                '<p class="ed-hint">Alarms landing inside this window wait until it ends.</p>' +
              '</div>' +
              '<div class="ed-field"><button class="btn-ghost" data-set="test-alarm">🔔 Test an alarm now</button></div>';
            return;
          }

          if (name === 'data') {
            var notes = Store.notes();
            var live = notes.filter(function (n) { return !n.trashed && !n.archived; }).length;
            var rems = notes.reduce(function (a, n) { return a + n.reminders.filter(function (r) { return r.enabled; }).length; }, 0);
            host.innerHTML =
              '<div class="set-stats">' +
                '<div><strong>' + live + '</strong><span>notes</span></div>' +
                '<div><strong>' + rems + '</strong><span>active alarms</span></div>' +
                '<div><strong>' + Store.allTags().length + '</strong><span>tags</span></div>' +
                '<div><strong>' + notes.filter(function (n) { return n.done; }).length + '</strong><span>completed</span></div>' +
              '</div>' +
              '<p id="set-storage" class="ed-hint">Measuring storage…</p>' +
              '<div class="set-actions">' +
                '<button class="btn-ghost" data-set="export">⬆ Export backup (.json)</button>' +
                '<button class="btn-ghost" data-set="export-md">📝 Export all as Markdown</button>' +
                '<button class="btn-ghost" data-set="import">⬇ Import backup</button>' +
                '<input type="file" id="set-file" accept=".json,application/json" hidden>' +
              '</div>' +
              '<div class="set-danger">' +
                '<h4>Danger zone</h4>' +
                '<button class="btn-ghost danger" data-set="empty-trash">Empty trash</button>' +
                '<button class="btn-ghost danger" data-set="wipe">Delete everything</button>' +
              '</div>';
            DB.estimate().then(function (est) {
              var el = $('#set-storage', wrap);
              if (!el) return;
              if (!est) { el.textContent = 'Everything is stored locally in this browser.'; return; }
              var used = (est.usage / 1048576).toFixed(2);
              el.textContent = 'Using ' + used + ' MB of local browser storage. Nothing leaves this device.';
            });
            return;
          }

          host.innerHTML =
            '<div class="set-about">' +
              '<p><strong>Task Notes</strong> — a notebook with a real alarm clock inside it.</p>' +
              '<p>Notes are markdown. Alarms can ring, repeat, snooze themselves and survive a reload. Everything is stored in IndexedDB on this device; there is no account and no server.</p>' +
              '<h4>Keyboard shortcuts</h4>' +
              '<table class="kbd-table">' +
                [['N', 'New note'], ['/', 'Search'], ['Ctrl K', 'Command palette'],
                 ['E', 'Edit focused note'], ['Space', 'Toggle done'], ['A', 'Add alarm'],
                 ['P', 'Pin'], ['S', 'Star'], ['#', 'Archive'], ['Del', 'Move to trash'],
                 ['1–5', 'Switch view'], ['Ctrl Z', 'Undo'], ['Ctrl Shift Z', 'Redo'],
                 ['Esc', 'Close'], ['?', 'This list']].map(function (r) {
                  return '<tr><td><kbd>' + r[0] + '</kbd></td><td>' + r[1] + '</td></tr>';
                }).join('') +
              '</table>' +
              '<h4>While an alarm is ringing</h4>' +
              '<table class="kbd-table">' +
                [['S', 'Snooze'], ['Enter', 'Mark done'], ['D / Esc', 'Dismiss']].map(function (r) {
                  return '<tr><td><kbd>' + r[0] + '</kbd></td><td>' + r[1] + '</td></tr>';
                }).join('') +
              '</table>' +
            '</div>';
        }

        function handle(cmd, el, closeFn) {
          var st = Store.settings();
          var bits = cmd.split(':');
          var key = bits[0], val = bits[1];

          if (key === 'theme') { Store.updateSettings({ theme: val }); renderTab('appearance'); return; }
          if (key === 'accent') { Store.updateSettings({ accent: val }); renderTab('appearance'); return; }
          if (key === 'density') { Store.updateSettings({ density: val }); renderTab('appearance'); return; }
          if (key === 'time24') { Store.updateSettings({ time24: val === '1' }); renderTab('appearance'); return; }
          if (key === 'weekStart') { Store.updateSettings({ weekStart: Number(val) }); renderTab('appearance'); return; }

          if (key === 'toggle') {
            var checked = el.checked;
            if (val === 'quiet') {
              var qh = Object.assign({}, st.quietHours, { enabled: checked });
              Store.updateSettings({ quietHours: qh });
            } else if (val === 'keepAwake') {
              Store.updateSettings({ keepAwake: checked });
              App.setKeepAwake(checked);
            } else {
              var patch = {};
              patch[val] = checked;
              Store.updateSettings(patch);
            }
            Engine.refresh(true).then(Engine.plan);
            return;
          }

          if (key === 'field') {
            var v = el.value;
            if (val === 'defaultRingtone') Store.updateSettings({ defaultRingtone: v });
            else if (val === 'snoozeEvery') Store.updateSettings({ defaultSnooze: { every: Math.max(1, parseInt(v, 10) || 5), unit: 'minutes' } });
            else if (val === 'quietStart') Store.updateSettings({ quietHours: Object.assign({}, st.quietHours, { start: v }) });
            else if (val === 'quietEnd') Store.updateSettings({ quietHours: Object.assign({}, st.quietHours, { end: v }) });
            return;
          }

          if (key === 'ask-perm') {
            Notifier.request().then(function () { renderTab('alarms'); UI.renderTopbar(); });
            return;
          }
          if (key === 'preview-tone') {
            var sel = $('#set-tone', wrap);
            Ringtone.preview(sel ? sel.value : st.defaultRingtone, st.defaultVolume);
            return;
          }
          if (key === 'test-alarm') {
            closeFn();
            testAlarm();
            return;
          }
          if (key === 'export') {
            UI.download('task-notes-backup-' + new Date().toISOString().slice(0, 10) + '.json',
              JSON.stringify(Store.exportData(), null, 2), 'application/json');
            UI.toast('Backup downloaded');
            return;
          }
          if (key === 'export-md') {
            var md = Store.notes().filter(function (n) { return !n.trashed; }).map(function (n) {
              var head = '# ' + (n.title || 'Untitled') + '\n';
              var meta = [];
              if (n.tags.length) meta.push(n.tags.map(function (t) { return '#' + t; }).join(' '));
              if (n.reminders.length) meta.push(n.reminders.map(function (r) { return '⏰ ' + Sched.describe(r, st.time24); }).join(' · '));
              return head + (meta.length ? '_' + meta.join(' — ') + '_\n' : '') + '\n' + n.body + '\n';
            }).join('\n---\n\n');
            UI.download('task-notes-' + new Date().toISOString().slice(0, 10) + '.md', md, 'text/markdown');
            return;
          }
          if (key === 'import') {
            var file = $('#set-file', wrap);
            file.onchange = function () {
              var f = file.files[0];
              if (!f) return;
              var reader = new FileReader();
              reader.onload = function () {
                var data;
                try { data = JSON.parse(reader.result); }
                catch (_) { UI.toast('That file is not valid JSON', { kind: 'error' }); return; }
                var mode = confirm('Replace everything with this backup?\n\nOK = replace, Cancel = merge alongside existing notes.') ? 'replace' : 'merge';
                Store.snapshot('import');
                Store.importData(data, mode).then(function (count) {
                  Engine.refresh(true).then(Engine.plan);
                  UI.toast('Imported ' + count + ' notes');
                  renderTab('data');
                }).catch(function (err) {
                  UI.toast('Import failed: ' + err.message, { kind: 'error' });
                });
              };
              reader.readAsText(f);
            };
            file.click();
            return;
          }
          if (key === 'empty-trash') {
            var trashed = Store.notes().filter(function (n) { return n.trashed; });
            if (!trashed.length) { UI.toast('Trash is already empty'); return; }
            if (!confirm('Permanently delete ' + trashed.length + ' notes?')) return;
            Store.snapshot('empty-trash');
            Store.removeMany(trashed.map(function (n) { return n.id; })).then(function () {
              UI.toast('Trash emptied'); renderTab('data');
            });
            return;
          }
          if (key === 'wipe') {
            if (!confirm('Delete every note, notebook and alarm on this device? This cannot be undone.')) return;
            if (!confirm('Really sure? Export a backup first if you might want it back.')) return;
            Store.wipe().then(function () { UI.toast('Everything deleted'); renderTab('data'); });
          }
        }
      }
    });
  }

  /* Fires a throwaway alarm so people can check sound and permissions. */
  function testAlarm() {
    var s = Store.settings();
    var fake = Model.createNote({
      title: 'Test alarm',
      body: 'If you can see and hear this, alarms are working.'
    }, s);
    var rem = Model.defaultReminder(s);
    rem.alarm = true;
    rem.label = 'Test alarm';
    Alarm.enqueue([{ note: fake, reminder: rem, missed: false, at: Date.now() }]);
    if (Notifier.permission() === 'granted') Notifier.show(fake, rem, {});
  }

  /* ================= command palette ================= */

  function openPalette() {
    var close = modal({
      title: 'Commands',
      className: 'modal-palette',
      body: '<input id="pal-input" class="pal-input" placeholder="Search notes and commands…" autocomplete="off">' +
        '<div id="pal-results" class="pal-results"></div>',
      onMount: function (wrap, closeFn) {
        var input = $('#pal-input', wrap);
        var results = $('#pal-results', wrap);
        var cursor = 0;
        var items = [];

        function commands() {
          var s = Store.settings();
          var base = [
            { icon: '📝', label: 'New note', run: function () { UI.newNote(); } },
            { icon: '⏰', label: 'Test an alarm', run: testAlarm },
            { icon: '⚙️', label: 'Open settings', run: function () { openSettings(); } },
            { icon: '🔔', label: 'Enable notifications', run: function () { Notifier.request().then(UI.renderTopbar); } },
            { icon: '⬆', label: 'Export backup', run: function () { openSettings('data'); } },
            { icon: '📓', label: 'New notebook', run: function () { var n = prompt('Notebook name:'); if (n) Store.addNotebook(n); } },
            { icon: s.theme === 'dark' ? '☀️' : '🌙', label: 'Toggle dark mode', run: function () { Store.updateSettings({ theme: s.theme === 'dark' ? 'light' : 'dark' }); } },
            { icon: '↩️', label: 'Undo last change', run: function () { Store.undo(); } }
          ];
          UI.VIEWS.forEach(function (v) {
            base.push({ icon: v.icon, label: 'View: ' + v.label, run: function () { Store.updateSettings({ view: v.id }); } });
          });
          ['all', 'today', 'upcoming', 'overdue', 'alarms', 'starred', 'done', 'archive', 'trash'].forEach(function (sc) {
            base.push({ icon: '→', label: 'Go to: ' + sc.charAt(0).toUpperCase() + sc.slice(1), run: function () { UI.setScope(sc); } });
          });
          return base;
        }

        function search(q) {
          q = q.trim().toLowerCase();
          var cmds = commands().filter(function (c) { return !q || c.label.toLowerCase().indexOf(q) > -1; });
          var notes = q ? Store.notes().filter(function (n) {
            return !n.trashed && (n.title + ' ' + n.body).toLowerCase().indexOf(q) > -1;
          }).slice(0, 8).map(function (n) {
            return {
              icon: '🗒', label: n.title || MD.plain(n.body, 50) || 'Untitled',
              sub: MD.plain(n.body, 60),
              run: function () { UI.openEditor(n.id); }
            };
          }) : [];
          items = notes.concat(cmds).slice(0, 24);
          cursor = 0;
          paint();
        }

        function paint() {
          results.innerHTML = items.length ? items.map(function (it, i) {
            return '<button class="pal-item' + (i === cursor ? ' is-on' : '') + '" data-i="' + i + '">' +
              '<span class="pal-icon">' + it.icon + '</span>' +
              '<span class="pal-label">' + esc(it.label) + (it.sub ? '<small>' + esc(it.sub) + '</small>' : '') + '</span>' +
            '</button>';
          }).join('') : '<p class="ed-hint">Nothing found.</p>';
          var on = results.querySelector('.is-on');
          if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
        }

        input.addEventListener('input', function () { search(input.value); });
        input.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowDown') { e.preventDefault(); cursor = Math.min(items.length - 1, cursor + 1); paint(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); cursor = Math.max(0, cursor - 1); paint(); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            var it = items[cursor];
            if (it) { closeFn(); setTimeout(it.run, 60); }
          }
        });
        results.addEventListener('click', function (e) {
          var b = e.target.closest('[data-i]');
          if (!b) return;
          var it = items[Number(b.getAttribute('data-i'))];
          closeFn();
          setTimeout(it.run, 60);
        });

        search('');
        setTimeout(function () { input.focus(); }, 40);
      }
    });
    return close;
  }

  return {
    open: open,
    close: close,
    isOpen: isOpen,
    openReminder: openReminder,
    openSettings: openSettings,
    openPalette: openPalette,
    testAlarm: testAlarm,
    modal: modal,
    flush: flush
  };
})();

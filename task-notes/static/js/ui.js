var UI = (function () {
  var _searchQuery = '';
  var _activeEditorId = null;
  var _addInputVisible = false;

  // ---- Helpers ----

  function esc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmtDate(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var now = new Date();
    var diff = ms - Date.now();
    var abs = Math.abs(diff);
    if (abs < 60000) return diff < 0 ? 'just now' : 'in <1m';
    if (abs < 3600000) {
      var m = Math.round(abs / 60000);
      return diff < 0 ? m + 'm ago' : 'in ' + m + 'm';
    }
    if (abs < 86400000) {
      var h = Math.round(abs / 3600000);
      return diff < 0 ? h + 'h ago' : 'in ' + h + 'h';
    }
    var opts = { month: 'short', day: 'numeric' };
    if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
    return d.toLocaleDateString(undefined, opts) + ' ' +
      d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function reminderChip(task) {
    var rem = task.reminder;
    if (!rem.enabled || rem.mode === 'none') return '';
    var now = Date.now();
    var isOverdue = rem.nextFireAt && rem.nextFireAt < now;
    var cls = isOverdue ? 'chip-overdue' : 'chip-reminder';
    var icon, text;
    if (rem.mode === 'interval') {
      var itype = rem.intervalType || 'frequency';
      if (itype === 'monthly-date') {
        icon = '🔁'; text = 'every ' + _ordinal(rem.intervalMonthDay || 1);
      } else if (itype === 'weekly-day') {
        icon = '🔁'; text = 'every ' + _weekdayName(rem.intervalWeekDay != null ? rem.intervalWeekDay : 1);
      } else {
        icon = '🔁'; text = 'every ' + rem.intervalEvery + rem.intervalUnit[0];
      }
    } else if (rem.mode === 'datetime') {
      icon = rem.dueAt < now ? '⚠' : '📅';
      text = fmtDate(rem.dueAt);
    }
    if (rem.nextFireAt) {
      text = (isOverdue ? '⚠ ' : '') + fmtDate(rem.nextFireAt);
    }
    return '<span class="chip ' + cls + '">' + icon + ' ' + esc(text) + '</span>';
  }

  function _ordinal(n) {
    var s = ['th', 'st', 'nd', 'rd'];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function _weekdayName(d) {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d] || 'Mon';
  }

  function priorityIcon(p) {
    return { high: '🔴', normal: '', low: '🔵' }[p] || '';
  }

  // ---- Task list ----

  function renderTaskList() {
    var container = document.getElementById('task-list');
    if (!container) return;
    var tasks = Store.getTasks();
    var settings = Store.getSettings();
    var filtered = Search.filterAndSort(tasks, settings, _searchQuery);

    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state">' +
        '<div class="empty-icon">📝</div>' +
        '<div class="empty-text">No tasks yet — tap <strong>+</strong> to add one</div>' +
        '</div>';
      return;
    }

    container.innerHTML = filtered.map(function (task) {
      var doneCls = task.done ? ' done' : '';
      var pinnedCls = task.pinned ? ' pinned' : '';
      var subtasksDone = task.subtasks.filter(function (s) { return s.done; }).length;
      var subtasksTotal = task.subtasks.length;
      var allSubtasksDone = subtasksTotal > 0 && subtasksDone === subtasksTotal;
      var subtaskChip = subtasksTotal > 0
        ? '<span class="chip chip-subtasks' + (allSubtasksDone ? ' chip-subtasks-done' : '') + '">' + subtasksDone + '/' + subtasksTotal + ' ✓</span>'
        : '';
      var tagChips = task.tags.map(function (tag) {
        return '<span class="chip chip-tag">' + esc(tag) + '</span>';
      }).join('');
      var popoutBtn = '<button class="btn-popout" title="Pop out as sticky note" data-id="' + esc(task.id) + '" aria-label="Pop out">⧉</button>';
      var resetBtn = (task.done && subtasksTotal > 0)
        ? '<button class="btn-reset-task" data-id="' + esc(task.id) + '" title="Reset subtasks and reopen task" aria-label="Reset task">↺ Reset</button>'
        : '';

      return '<li class="task-card color-' + esc(task.color) + doneCls + pinnedCls +
        '" data-id="' + esc(task.id) + '" tabindex="0" role="article" aria-label="Task: ' + esc(task.title) + '">' +
        '<div class="card-top">' +
          '<label class="checkbox-wrap" title="Mark done" aria-label="' + (task.done ? 'Mark undone' : 'Mark done') + '">' +
            '<input type="checkbox" class="task-done-cb" data-id="' + esc(task.id) + '"' + (task.done ? ' checked' : '') + '>' +
            '<span class="checkbox-custom"></span>' +
          '</label>' +
          '<span class="card-title">' + esc(task.title) + '</span>' +
          '<span class="card-priority">' + priorityIcon(task.priority) + '</span>' +
          (task.pinned ? '<span class="pin-icon" title="Pinned">📌</span>' : '') +
          popoutBtn +
        '</div>' +
        (task.notes ? '<div class="card-notes">' + esc(task.notes.slice(0, 80)) + (task.notes.length > 80 ? '…' : '') + '</div>' : '') +
        '<div class="card-chips">' +
          reminderChip(task) +
          subtaskChip +
          tagChips +
        '</div>' +
        (resetBtn ? '<div class="card-reset-row">' + resetBtn + '</div>' : '') +
        '</li>';
    }).join('');

    // Wire card click → open editor
    container.querySelectorAll('.task-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.task-done-cb') || e.target.closest('.btn-popout') || e.target.closest('.btn-reset-task')) return;
        openEditor(card.dataset.id);
      });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === 'e') { e.preventDefault(); openEditor(card.dataset.id); }
        if (e.key === ' ') {
          e.preventDefault();
          var t = _findTask(card.dataset.id);
          if (t) { t.done = !t.done; Store.upsertTask(t); }
        }
      });
    });

    container.querySelectorAll('.task-done-cb').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var task = _findTask(cb.dataset.id);
        if (!task) return;
        task.done = cb.checked;
        Store.upsertTask(task);
      });
    });

    container.querySelectorAll('.btn-popout').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        Modes.popOut(btn.dataset.id);
      });
    });

    container.querySelectorAll('.btn-reset-task').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var task = _findTask(btn.dataset.id);
        if (!task) return;
        task.done = false;
        task.subtasks.forEach(function (s) { s.done = false; });
        Store.upsertTask(task);
      });
    });
  }

  // ---- Editor ----

  function openEditor(id) {
    _activeEditorId = id;
    var task = _findTask(id);
    if (!task) return;
    _renderEditor(task);
    var panel = document.getElementById('editor-panel');
    if (panel) {
      panel.classList.add('open');
      panel.querySelector('.editor-title-input').focus();
    }
    document.getElementById('editor-overlay') && document.getElementById('editor-overlay').classList.add('open');
  }

  function closeEditor() {
    _activeEditorId = null;
    var panel = document.getElementById('editor-panel');
    if (panel) panel.classList.remove('open');
    var overlay = document.getElementById('editor-overlay');
    if (overlay) overlay.classList.remove('open');
  }

  function _findTask(id) {
    return Store.getTasks().find(function (t) { return t.id === id; });
  }

  function _toDatetimeLocal(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function _renderEditor(task) {
    var panel = document.getElementById('editor-panel');
    if (!panel) return;
    var rem = task.reminder;

    var colorSwatches = ['yellow', 'pink', 'blue', 'green', 'purple', 'gray'].map(function (c) {
      return '<button class="color-swatch color-swatch-' + c + (task.color === c ? ' selected' : '') +
        '" data-color="' + c + '" title="' + c + '" aria-label="Color: ' + c + '" aria-pressed="' + (task.color === c) + '"></button>';
    }).join('');

    var dueVal = rem.dueAt ? _toDatetimeLocal(rem.dueAt) : '';
    var repeatOpts = ['none', 'daily', 'weekly', 'weekdays', 'monthly', 'custom'].map(function (v) {
      return '<option value="' + v + '"' + (rem.repeat === v ? ' selected' : '') + '>' + v.charAt(0).toUpperCase() + v.slice(1) + '</option>';
    }).join('');
    var repeatUnitOpts = ['days', 'hours', 'minutes'].map(function (v) {
      return '<option value="' + v + '"' + (rem.customRepeatUnit === v ? ' selected' : '') + '>' + v + '</option>';
    }).join('');
    var intervalUnitOpts = ['minutes', 'hours', 'days'].map(function (v) {
      return '<option value="' + v + '"' + (rem.intervalUnit === v ? ' selected' : '') + '>' + v + '</option>';
    }).join('');
    var snoozeUnitOpts = ['minutes', 'hours'].map(function (v) {
      return '<option value="' + v + '"' + (rem.snoozeUnit === v ? ' selected' : '') + '>' + v + '</option>';
    }).join('');
    var priorityOpts = ['low', 'normal', 'high'].map(function (v) {
      return '<option value="' + v + '"' + (task.priority === v ? ' selected' : '') + '>' + v.charAt(0).toUpperCase() + v.slice(1) + '</option>';
    }).join('');

    var itype = rem.intervalType || 'frequency';
    var intervalTypeOpts = ['frequency', 'monthly-date', 'weekly-day'].map(function (v) {
      var labels = { 'frequency': 'Every N units', 'monthly-date': 'Day of month', 'weekly-day': 'Day of week' };
      return '<option value="' + v + '"' + (itype === v ? ' selected' : '') + '>' + labels[v] + '</option>';
    }).join('');

    var weekdayOpts = [['0','Sunday'],['1','Monday'],['2','Tuesday'],['3','Wednesday'],['4','Thursday'],['5','Friday'],['6','Saturday']].map(function (pair) {
      return '<option value="' + pair[0] + '"' + (String(rem.intervalWeekDay) === pair[0] ? ' selected' : '') + '>' + pair[1] + '</option>';
    }).join('');

    var nextFire = rem.nextFireAt ? fmtDate(rem.nextFireAt) : (rem.enabled ? '—' : '');

    var tagsHtml = task.tags.map(function (tag) {
      return '<span class="tag-pill">' + esc(tag) +
        '<button class="btn-tag-remove" data-tag="' + esc(tag) + '" aria-label="Remove tag ' + esc(tag) + '">✕</button></span>';
    }).join('');

    var subtasksHtml = task.subtasks.map(function (s) {
      return _buildSubtaskCardHtml(s);
    }).join('');

    panel.innerHTML =
      '<div class="editor-header">' +
        '<h2 class="editor-heading">Edit Task</h2>' +
        '<button id="btn-editor-close" aria-label="Close editor">✕</button>' +
      '</div>' +

      '<div class="editor-body">' +
        '<label class="field-label" for="editor-title">Title</label>' +
        '<input id="editor-title" class="editor-title-input" type="text" value="' + esc(task.title) + '" placeholder="Task title…" aria-required="true">' +

        '<label class="field-label" for="editor-notes">Notes</label>' +
        '<textarea id="editor-notes" class="editor-notes" placeholder="Optional notes…">' + esc(task.notes) + '</textarea>' +

        '<label class="field-label">Color</label>' +
        '<div class="color-swatches">' + colorSwatches + '</div>' +

        '<div class="editor-row">' +
          '<label class="editor-row-label">' +
            '<input type="checkbox" id="editor-pinned"' + (task.pinned ? ' checked' : '') + '> 📌 Pin to top' +
          '</label>' +
          '<label class="editor-row-label">Priority: ' +
            '<select id="editor-priority">' + priorityOpts + '</select>' +
          '</label>' +
        '</div>' +

        // Tags
        '<label class="field-label">Tags</label>' +
        '<div class="tags-editor">' +
          '<div class="tag-pills" id="tag-pills">' + tagsHtml + '</div>' +
          '<div class="tag-input-row">' +
            '<input id="tag-input" type="text" placeholder="Add tag…" class="tag-input">' +
            '<button id="btn-add-tag" class="btn-sm">Add</button>' +
          '</div>' +
        '</div>' +

        // Subtasks
        '<div class="subtasks-header">' +
          '<span class="field-label" style="margin-bottom:0">Subtasks</span>' +
          (task.done && task.subtasks.length > 0 ?
            '<button id="btn-reset-subtasks" class="btn-sm btn-reset" title="Reset all subtasks and reopen task">↺ Reset</button>' : '') +
        '</div>' +
        '<div class="subtasks-list" id="subtasks-list">' + subtasksHtml + '</div>' +
        '<div class="subtask-add-row">' +
          '<input id="subtask-input" type="text" placeholder="Add subtask…" class="subtask-input">' +
          '<button id="btn-add-subtask" class="btn-sm">Add</button>' +
        '</div>' +

        // Reminder
        '<label class="field-label">Reminder</label>' +
        '<div class="reminder-section">' +
          '<label class="toggle-label">' +
            '<input type="checkbox" id="rem-enabled"' + (rem.enabled ? ' checked' : '') + '> Remind me' +
          '</label>' +

          '<div class="rem-config" id="rem-config" style="' + (rem.enabled ? '' : 'display:none') + '">' +
            '<div class="seg-control" role="group" aria-label="Reminder mode">' +
              '<button class="seg-btn' + (rem.mode === 'none' ? ' active' : '') + '" data-mode="none">Off</button>' +
              '<button class="seg-btn' + (rem.mode === 'datetime' ? ' active' : '') + '" data-mode="datetime">At a time</button>' +
              '<button class="seg-btn' + (rem.mode === 'interval' ? ' active' : '') + '" data-mode="interval">Every…</button>' +
            '</div>' +

            '<div class="rem-datetime-opts" style="' + (rem.mode === 'datetime' ? '' : 'display:none') + '">' +
              '<label>Due date/time <input type="datetime-local" id="rem-due" value="' + dueVal + '"></label>' +
              '<label>Repeat <select id="rem-repeat">' + repeatOpts + '</select></label>' +
              '<div id="rem-custom-repeat" style="' + (rem.repeat === 'custom' ? '' : 'display:none') + '">' +
                '<label>Every <input type="number" id="rem-custom-every" value="' + (rem.customRepeatEvery || 1) + '" min="1" style="width:60px"></label>' +
                '<select id="rem-custom-unit">' + repeatUnitOpts + '</select>' +
              '</div>' +
              '<label>Heads-up <input type="number" id="rem-lead" value="' + (rem.leadTime || 0) + '" min="0" style="width:60px"> min before</label>' +
            '</div>' +

            '<div class="rem-interval-opts" style="' + (rem.mode === 'interval' ? '' : 'display:none') + '">' +
              '<label>Type <select id="rem-interval-type">' + intervalTypeOpts + '</select></label>' +
              '<div id="rem-interval-freq" style="' + (itype !== 'frequency' ? 'display:none' : '') + '">' +
                '<label>Every <input type="number" id="rem-interval-every" value="' + (rem.intervalEvery || 1) + '" min="1" style="width:60px"> ' +
                  '<select id="rem-interval-unit">' + intervalUnitOpts + '</select>' +
                '</label>' +
              '</div>' +
              '<div id="rem-interval-monthly" style="' + (itype !== 'monthly-date' ? 'display:none' : '') + '">' +
                '<label>Day of month (1–31) <input type="number" id="rem-month-day" value="' + (rem.intervalMonthDay || 1) + '" min="1" max="31" style="width:60px"></label>' +
                '<label>At time <input type="time" id="rem-interval-day-time" value="' + (rem.intervalDayTime || '09:00') + '"></label>' +
              '</div>' +
              '<div id="rem-interval-weekly" style="' + (itype !== 'weekly-day' ? 'display:none' : '') + '">' +
                '<label>Day of week <select id="rem-week-day">' + weekdayOpts + '</select></label>' +
                '<label>At time <input type="time" id="rem-interval-day-time-weekly" value="' + (rem.intervalDayTime || '09:00') + '"></label>' +
              '</div>' +
            '</div>' +

            '<div class="rem-snooze-opts">' +
              '<label class="toggle-label">' +
                '<input type="checkbox" id="rem-autosnooze"' + (rem.autoSnooze ? ' checked' : '') + '> Auto-snooze if not dismissed' +
              '</label>' +
              '<div id="rem-snooze-detail" style="' + (rem.autoSnooze ? '' : 'display:none') + '">' +
                '<label>Re-alert every <input type="number" id="rem-snooze-every" value="' + (rem.snoozeEvery || 5) + '" min="1" style="width:50px"> ' +
                  '<select id="rem-snooze-unit">' + snoozeUnitOpts + '</select>' +
                '</label>' +
                '<label>Max snoozes <input type="number" id="rem-max-snoozes" value="' + (rem.maxSnoozes || 12) + '" min="1" style="width:50px"></label>' +
              '</div>' +
            '</div>' +

            '<details class="rem-advanced">' +
              '<summary>Advanced</summary>' +
              '<label>Quiet hours (no alerts from–to)<br>' +
                'From <input type="time" id="rem-quiet-start" value="' + (rem.quietHours ? rem.quietHours.start : '22:00') + '">' +
                ' to <input type="time" id="rem-quiet-end" value="' + (rem.quietHours ? rem.quietHours.end : '07:00') + '">' +
                '<label class="toggle-label" style="margin-top:4px"><input type="checkbox" id="rem-quiet-enabled"' +
                (rem.quietHours ? ' checked' : '') + '> Enable quiet hours</label>' +
              '</label>' +
            '</details>' +

            (nextFire ? '<div class="next-fire-preview">⏰ Next alert: <strong>' + esc(nextFire) + '</strong></div>' : '') +
          '</div>' +
        '</div>' +

        '<div class="editor-footer">' +
          '<button id="btn-save-task" class="btn-primary">Save</button>' +
          '<button id="btn-delete-task" class="btn-danger">🗑 Delete</button>' +
        '</div>' +
      '</div>';

    _wireEditor(task);
  }

  function _buildSubtaskCardHtml(s) {
    var srem = s.reminder;
    var hasReminder = srem && srem.enabled && srem.mode !== 'none';
    var remChip = hasReminder
      ? '<span class="chip chip-reminder subtask-rem-chip">' +
          (srem.mode === 'interval' ? '🔁' : '📅') + ' ' +
          esc(srem.nextFireAt ? fmtDate(srem.nextFireAt) : '—') +
        '</span>'
      : '';

    var dueVal = (srem && srem.dueAt) ? _toDatetimeLocal(srem.dueAt) : '';
    var sIntervalUnitOpts = ['minutes', 'hours', 'days'].map(function (v) {
      return '<option value="' + v + '"' + (srem && srem.intervalUnit === v ? ' selected' : '') + '>' + v + '</option>';
    }).join('');
    var sSnoozeUnitOpts = ['minutes', 'hours'].map(function (v) {
      return '<option value="' + v + '"' + (srem && srem.snoozeUnit === v ? ' selected' : '') + '>' + v + '</option>';
    }).join('');

    return '<div class="subtask-card' + (s.done ? ' subtask-done' : '') + '" data-sid="' + esc(s.id) + '">' +
      '<div class="subtask-card-header">' +
        '<label class="checkbox-wrap" aria-label="' + (s.done ? 'Mark undone' : 'Mark done') + '">' +
          '<input type="checkbox" class="subtask-cb"' + (s.done ? ' checked' : '') + '>' +
          '<span class="checkbox-custom"></span>' +
        '</label>' +
        '<input type="text" class="subtask-title-input" value="' + esc(s.title) + '" placeholder="Subtask title…" aria-label="Subtask title">' +
        remChip +
        '<button class="btn-subtask-toggle" aria-label="Expand subtask details" title="Expand">▼</button>' +
        '<button class="btn-subtask-del" aria-label="Remove subtask" title="Remove">✕</button>' +
      '</div>' +
      '<div class="subtask-card-body" style="display:none">' +
        '<textarea class="subtask-notes-input" placeholder="Notes / description…" aria-label="Subtask notes">' + esc(s.notes) + '</textarea>' +
        '<div class="subtask-rem-section">' +
          '<label class="toggle-label">' +
            '<input type="checkbox" class="subtask-rem-enabled"' + (srem && srem.enabled ? ' checked' : '') + '> Reminder' +
          '</label>' +
          '<div class="subtask-rem-config" style="' + (srem && srem.enabled ? '' : 'display:none') + '">' +
            '<div class="seg-control" role="group" aria-label="Subtask reminder mode">' +
              '<button class="subtask-seg-btn' + (srem && srem.mode === 'none' ? ' active' : '') + '" data-mode="none">Off</button>' +
              '<button class="subtask-seg-btn' + (srem && srem.mode === 'datetime' ? ' active' : '') + '" data-mode="datetime">At a time</button>' +
              '<button class="subtask-seg-btn' + (srem && srem.mode === 'interval' ? ' active' : '') + '" data-mode="interval">Every…</button>' +
            '</div>' +
            '<div class="subtask-rem-datetime" style="' + (srem && srem.mode === 'datetime' ? '' : 'display:none') + '">' +
              '<label>Due <input type="datetime-local" class="subtask-rem-due" value="' + dueVal + '"></label>' +
            '</div>' +
            '<div class="subtask-rem-interval" style="' + (srem && srem.mode === 'interval' ? '' : 'display:none') + '">' +
              '<label>Every <input type="number" class="subtask-rem-interval-every" value="' + (srem ? srem.intervalEvery || 1 : 1) + '" min="1" style="width:55px"> ' +
                '<select class="subtask-rem-interval-unit">' + sIntervalUnitOpts + '</select>' +
              '</label>' +
            '</div>' +
            '<div class="subtask-rem-snooze">' +
              '<label class="toggle-label" style="font-size:12px">' +
                '<input type="checkbox" class="subtask-rem-autosnooze"' + (srem && srem.autoSnooze ? ' checked' : '') + '> Auto-snooze' +
              '</label>' +
              '<div class="subtask-snooze-detail" style="' + (srem && srem.autoSnooze ? '' : 'display:none') + '">' +
                '<label>Every <input type="number" class="subtask-snooze-every" value="' + (srem ? srem.snoozeEvery || 5 : 5) + '" min="1" style="width:45px"> ' +
                  '<select class="subtask-snooze-unit">' + sSnoozeUnitOpts + '</select>' +
                '</label>' +
              '</div>' +
            '</div>' +
            (srem && srem.nextFireAt ? '<div class="next-fire-preview" style="font-size:11px">⏰ Next: <strong>' + esc(fmtDate(srem.nextFireAt)) + '</strong></div>' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function _wireSubtaskCard(parentTask, s, cardEl) {
    var titleInput = cardEl.querySelector('.subtask-title-input');
    titleInput.addEventListener('input', function () { s.title = this.value; });

    var cb = cardEl.querySelector('.subtask-cb');
    cb.addEventListener('change', function () {
      s.done = this.checked;
      cardEl.classList.toggle('subtask-done', s.done);
      _checkAutoComplete(parentTask);
    });

    var toggleBtn = cardEl.querySelector('.btn-subtask-toggle');
    var body = cardEl.querySelector('.subtask-card-body');
    toggleBtn.addEventListener('click', function () {
      var isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : '';
      toggleBtn.textContent = isOpen ? '▼' : '▲';
      toggleBtn.setAttribute('aria-label', isOpen ? 'Expand subtask details' : 'Collapse subtask details');
    });

    var notesTextarea = cardEl.querySelector('.subtask-notes-input');
    notesTextarea.addEventListener('input', function () { s.notes = this.value; });

    var remEnabled = cardEl.querySelector('.subtask-rem-enabled');
    var remConfig = cardEl.querySelector('.subtask-rem-config');
    remEnabled.addEventListener('change', function () {
      s.reminder.enabled = this.checked;
      remConfig.style.display = this.checked ? '' : 'none';
      if (this.checked && Notification && Notification.permission === 'default') {
        Notifier.requestPermission(function () {});
      }
    });

    cardEl.querySelectorAll('.subtask-seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        cardEl.querySelectorAll('.subtask-seg-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        s.reminder.mode = btn.dataset.mode;
        cardEl.querySelector('.subtask-rem-datetime').style.display = btn.dataset.mode === 'datetime' ? '' : 'none';
        cardEl.querySelector('.subtask-rem-interval').style.display = btn.dataset.mode === 'interval' ? '' : 'none';
      });
    });

    cardEl.querySelector('.subtask-rem-due').addEventListener('change', function () {
      s.reminder.dueAt = this.value ? new Date(this.value).getTime() : null;
    });
    cardEl.querySelector('.subtask-rem-interval-every').addEventListener('change', function () {
      s.reminder.intervalEvery = parseInt(this.value, 10) || 1;
      if (!s.reminder.intervalAnchor) s.reminder.intervalAnchor = Date.now();
    });
    cardEl.querySelector('.subtask-rem-interval-unit').addEventListener('change', function () {
      s.reminder.intervalUnit = this.value;
    });

    var autoSnoozeCb = cardEl.querySelector('.subtask-rem-autosnooze');
    var snoozDetail = cardEl.querySelector('.subtask-snooze-detail');
    autoSnoozeCb.addEventListener('change', function () {
      s.reminder.autoSnooze = this.checked;
      snoozDetail.style.display = this.checked ? '' : 'none';
    });
    cardEl.querySelector('.subtask-snooze-every').addEventListener('change', function () {
      s.reminder.snoozeEvery = parseInt(this.value, 10) || 5;
    });
    cardEl.querySelector('.subtask-snooze-unit').addEventListener('change', function () {
      s.reminder.snoozeUnit = this.value;
    });

    cardEl.querySelector('.btn-subtask-del').addEventListener('click', function () {
      parentTask.subtasks = parentTask.subtasks.filter(function (st) { return st.id !== s.id; });
      cardEl.remove();
    });
  }

  function _wireSubtasksList(task) {
    var list = document.getElementById('subtasks-list');
    if (!list) return;
    list.querySelectorAll('.subtask-card').forEach(function (cardEl) {
      var sid = cardEl.dataset.sid;
      var s = task.subtasks.find(function (st) { return st.id === sid; });
      if (!s) return;
      _wireSubtaskCard(task, s, cardEl);
    });
  }

  // Auto-complete is buffered (not persisted here): the whole editor commits on
  // Save via _readEditor + a single Store.upsertTask, so we never write a stale
  // snapshot or persist edits the user might cancel. We only flip task.done in
  // memory and surface the Reset affordance.
  function _checkAutoComplete(task) {
    if (task.subtasks.length === 0) return;
    var allDone = task.subtasks.every(function (s) { return s.done; });
    if (allDone && !task.done) {
      task.done = true;
      _showResetButton(task);
    }
  }

  function _showResetButton(task) {
    if (document.getElementById('btn-reset-subtasks')) return;
    var subtasksHeader = document.querySelector('.subtasks-header');
    if (!subtasksHeader) return;
    var btn = document.createElement('button');
    btn.id = 'btn-reset-subtasks';
    btn.className = 'btn-sm btn-reset';
    btn.title = 'Reset all subtasks and reopen task';
    btn.textContent = '↺ Reset';
    subtasksHeader.appendChild(btn);
    _wireResetSubtasks(task, btn);
  }

  // Editor-context reset: buffer the change (reopen task + clear subtasks) and
  // reflect it in the open editor. Persisted on Save like every other edit.
  function _wireResetSubtasks(task, btn) {
    if (!btn) return;
    btn.addEventListener('click', function () {
      task.done = false;
      task.subtasks.forEach(function (s) {
        s.done = false;
        var cardEl = document.querySelector('.subtask-card[data-sid="' + s.id + '"]');
        if (cardEl) {
          cardEl.querySelector('.subtask-cb').checked = false;
          cardEl.classList.remove('subtask-done');
        }
      });
      btn.remove();
    });
  }

  function _readEditor(task) {
    var p = document.getElementById('editor-panel');
    task.title = p.querySelector('#editor-title').value.trim();
    task.notes = p.querySelector('#editor-notes').value.trim();
    task.pinned = p.querySelector('#editor-pinned').checked;
    task.priority = p.querySelector('#editor-priority').value;

    var rem = task.reminder;
    rem.enabled = p.querySelector('#rem-enabled').checked;
    rem.mode = p.querySelector('.seg-btn.active') ? p.querySelector('.seg-btn.active').dataset.mode : 'none';

    if (rem.mode === 'datetime') {
      var dueInput = p.querySelector('#rem-due').value;
      rem.dueAt = dueInput ? new Date(dueInput).getTime() : null;
      rem.repeat = p.querySelector('#rem-repeat').value;
      rem.customRepeatEvery = parseInt(p.querySelector('#rem-custom-every').value, 10) || 1;
      rem.customRepeatUnit = p.querySelector('#rem-custom-unit').value;
      rem.leadTime = parseInt(p.querySelector('#rem-lead').value, 10) || 0;
    } else if (rem.mode === 'interval') {
      rem.intervalType = p.querySelector('#rem-interval-type').value;
      if (rem.intervalType === 'frequency') {
        rem.intervalEvery = parseInt(p.querySelector('#rem-interval-every').value, 10) || 1;
        rem.intervalUnit = p.querySelector('#rem-interval-unit').value;
        if (!rem.intervalAnchor) rem.intervalAnchor = Date.now();
      } else if (rem.intervalType === 'monthly-date') {
        rem.intervalMonthDay = parseInt(p.querySelector('#rem-month-day').value, 10) || 1;
        rem.intervalDayTime = p.querySelector('#rem-interval-day-time').value || '09:00';
      } else if (rem.intervalType === 'weekly-day') {
        var wd = parseInt(p.querySelector('#rem-week-day').value, 10);
        rem.intervalWeekDay = isNaN(wd) ? 1 : wd;  // keep 0 (Sunday) intact
        rem.intervalDayTime = p.querySelector('#rem-interval-day-time-weekly').value || '09:00';
      }
    }

    rem.autoSnooze = p.querySelector('#rem-autosnooze').checked;
    rem.snoozeEvery = parseInt(p.querySelector('#rem-snooze-every').value, 10) || 5;
    rem.snoozeUnit = p.querySelector('#rem-snooze-unit').value;
    rem.maxSnoozes = parseInt(p.querySelector('#rem-max-snoozes').value, 10) || 12;

    var quietEnabled = p.querySelector('#rem-quiet-enabled').checked;
    if (quietEnabled) {
      rem.quietHours = {
        start: p.querySelector('#rem-quiet-start').value || '22:00',
        end: p.querySelector('#rem-quiet-end').value || '07:00'
      };
    } else {
      rem.quietHours = null;
    }

    return task;
  }

  function _wireEditor(task) {
    var p = document.getElementById('editor-panel');

    p.querySelector('#btn-editor-close').addEventListener('click', closeEditor);

    // Color swatches
    p.querySelectorAll('.color-swatch').forEach(function (btn) {
      btn.addEventListener('click', function () {
        p.querySelectorAll('.color-swatch').forEach(function (b) {
          b.classList.remove('selected');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('selected');
        btn.setAttribute('aria-pressed', 'true');
        task.color = btn.dataset.color;
      });
    });

    // Segment mode
    p.querySelectorAll('.seg-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        // Only handle main task seg-btns (not subtask ones)
        if (btn.closest('.subtask-rem-config')) return;
        p.querySelectorAll('.editor-body > .reminder-section .seg-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var mode = btn.dataset.mode;
        p.querySelector('.rem-datetime-opts').style.display = mode === 'datetime' ? '' : 'none';
        p.querySelector('.rem-interval-opts').style.display = mode === 'interval' ? '' : 'none';
        _updateNextFirePreview(task);
      });
    });

    // Interval type switcher
    p.querySelector('#rem-interval-type').addEventListener('change', function () {
      var v = this.value;
      p.querySelector('#rem-interval-freq').style.display = v === 'frequency' ? '' : 'none';
      p.querySelector('#rem-interval-monthly').style.display = v === 'monthly-date' ? '' : 'none';
      p.querySelector('#rem-interval-weekly').style.display = v === 'weekly-day' ? '' : 'none';
      _updateNextFirePreview(task);
    });

    // Reminder enabled toggle
    p.querySelector('#rem-enabled').addEventListener('change', function () {
      p.querySelector('#rem-config').style.display = this.checked ? '' : 'none';
      if (this.checked && Notification.permission === 'default') {
        Notifier.requestPermission(function () { renderToolbar(); });
      }
    });

    // Auto-snooze toggle
    p.querySelector('#rem-autosnooze').addEventListener('change', function () {
      p.querySelector('#rem-snooze-detail').style.display = this.checked ? '' : 'none';
    });

    // Repeat change
    p.querySelector('#rem-repeat').addEventListener('change', function () {
      p.querySelector('#rem-custom-repeat').style.display = this.value === 'custom' ? '' : 'none';
    });

    // Live next-fire preview
    p.querySelector('.rem-config').querySelectorAll('input, select').forEach(function (el) {
      el.addEventListener('change', function () { _updateNextFirePreview(task); });
    });

    // Tags
    p.querySelector('#btn-add-tag').addEventListener('click', function () { _addTag(task); });
    p.querySelector('#tag-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); _addTag(task); }
    });
    _refreshTagPills(task);

    // Subtasks: wire existing cards
    _wireSubtasksList(task);

    // Add subtask
    p.querySelector('#btn-add-subtask').addEventListener('click', function () { _addSubtask(task); });
    p.querySelector('#subtask-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); _addSubtask(task); }
    });

    // Reset subtasks button (if present)
    var resetBtn = p.querySelector('#btn-reset-subtasks');
    if (resetBtn) _wireResetSubtasks(task, resetBtn);

    // Save — compute all reminder schedules in memory, then persist once.
    p.querySelector('#btn-save-task').addEventListener('click', function () {
      _readEditor(task);
      if (!task.title) { p.querySelector('#editor-title').focus(); return; }
      ReminderEngine.applyReminderState(task.reminder);
      task.subtasks.forEach(function (s) {
        ReminderEngine.applyReminderState(s.reminder);
      });
      Store.upsertTask(task);
      closeEditor();
    });

    // Delete
    p.querySelector('#btn-delete-task').addEventListener('click', function () {
      if (confirm('Delete "' + task.title + '"?')) {
        Store.deleteTask(task.id);
        closeEditor();
      }
    });
  }

  function _updateNextFirePreview(task) {
    var p = document.getElementById('editor-panel');
    if (!p) return;
    var tempTask = _readEditor(JSON.parse(JSON.stringify(task)));
    var rem = tempTask.reminder;
    var next = (rem.enabled && rem.mode !== 'none') ? ReminderEngine.computeNextFireAt(rem) : null;
    var preview = p.querySelector('.next-fire-preview');
    if (preview) {
      preview.textContent = next ? '⏰ Next alert: ' + fmtDate(next) : '';
    } else if (next) {
      var div = document.createElement('div');
      div.className = 'next-fire-preview';
      div.textContent = '⏰ Next alert: ' + fmtDate(next);
      p.querySelector('.rem-config').appendChild(div);
    }
  }

  function _addTag(task) {
    var input = document.getElementById('tag-input');
    var val = input.value.trim().replace(/\s+/g, '-').toLowerCase();
    if (!val || task.tags.indexOf(val) !== -1) { input.value = ''; return; }
    task.tags.push(val);
    input.value = '';
    _refreshTagPills(task);
    renderFilterBar();
  }

  function _refreshTagPills(task) {
    var pills = document.getElementById('tag-pills');
    if (!pills) return;
    pills.innerHTML = task.tags.map(function (tag) {
      return '<span class="tag-pill">' + esc(tag) +
        '<button class="btn-tag-remove" data-tag="' + esc(tag) + '" aria-label="Remove tag">✕</button></span>';
    }).join('');
    pills.querySelectorAll('.btn-tag-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        task.tags = task.tags.filter(function (t) { return t !== btn.dataset.tag; });
        _refreshTagPills(task);
      });
    });
  }

  function _addSubtask(task) {
    var input = document.getElementById('subtask-input');
    var val = input.value.trim();
    if (!val) return;
    var s = Model.createSubtask(val);
    task.subtasks.push(s);
    input.value = '';
    var list = document.getElementById('subtasks-list');
    var cardHtml = _buildSubtaskCardHtml(s);
    var tmp = document.createElement('div');
    tmp.innerHTML = cardHtml;
    var cardEl = tmp.firstElementChild;
    list.appendChild(cardEl);
    _wireSubtaskCard(task, s, cardEl);
    input.focus();
  }

  // ---- Toolbar ----

  function renderToolbar() {
    var notifBtn = document.getElementById('btn-notif');
    if (notifBtn) {
      if (Notification && Notification.permission === 'granted') {
        notifBtn.style.display = 'none';
      } else if (Notification && Notification.permission === 'denied') {
        notifBtn.textContent = '🔕 Notifications blocked';
        notifBtn.title = 'Notifications are blocked. Enable in browser site settings.';
        notifBtn.classList.add('blocked');
      } else {
        notifBtn.style.display = '';
      }
    }
  }

  // ---- Filter bar ----

  function renderFilterBar() {
    var filterBar = document.getElementById('filter-bar');
    if (!filterBar) return;
    var settings = Store.getSettings();
    var tags = Search.getAllTags(Store.getTasks());

    var statusOpts = ['all', 'active', 'done', 'overdue'].map(function (v) {
      return '<option value="' + v + '"' + (settings.filter === v ? ' selected' : '') + '>' +
        { all: 'All', active: 'Active', done: 'Done', overdue: 'Overdue' }[v] + '</option>';
    }).join('');

    var tagOpts = '<option value="">All tags</option>' + tags.map(function (tag) {
      return '<option value="' + esc(tag) + '"' + (settings.filterTag === tag ? ' selected' : '') + '>' + esc(tag) + '</option>';
    }).join('');

    var sortOpts = ['createdAt', 'priority', 'due', 'alpha'].map(function (v) {
      return '<option value="' + v + '"' + (settings.sort === v ? ' selected' : '') + '>' +
        { createdAt: 'Newest', priority: 'Priority', due: 'Due date', alpha: 'A–Z' }[v] + '</option>';
    }).join('');

    filterBar.innerHTML =
      '<select id="filter-status" aria-label="Filter by status">' + statusOpts + '</select>' +
      (tags.length ? '<select id="filter-tag" aria-label="Filter by tag">' + tagOpts + '</select>' : '') +
      '<select id="filter-sort" aria-label="Sort by">' + sortOpts + '</select>';

    var statusSel = document.getElementById('filter-status');
    if (statusSel) statusSel.addEventListener('change', function () {
      Store.updateSettings({ filter: this.value });
    });
    var tagSel = document.getElementById('filter-tag');
    if (tagSel) tagSel.addEventListener('change', function () {
      Store.updateSettings({ filterTag: this.value });
    });
    var sortSel = document.getElementById('filter-sort');
    if (sortSel) sortSel.addEventListener('change', function () {
      Store.updateSettings({ sort: this.value });
    });
  }

  // ---- Add task input ----

  function _showAddInput() {
    var wrap = document.getElementById('add-input-wrap');
    if (!wrap) return;
    _addInputVisible = true;
    wrap.style.display = '';
    var input = document.getElementById('add-task-input');
    if (input) { input.value = ''; input.focus(); }
  }

  function _hideAddInput() {
    _addInputVisible = false;
    var wrap = document.getElementById('add-input-wrap');
    if (wrap) wrap.style.display = 'none';
  }

  function _commitAdd() {
    var input = document.getElementById('add-task-input');
    if (!input) return;
    var title = input.value.trim();
    if (title) {
      var task = Model.createTask({ title: title });
      Store.upsertTask(task);
    }
    input.value = '';
    input.focus();
  }

  // ---- Export / Import ----

  function exportData() {
    var data = Store.get();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'task-notes-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var parsed = JSON.parse(e.target.result);
        if (!parsed.tasks) throw new Error('Invalid backup file');
        if (!confirm('Import will replace your current tasks. Continue?')) return;
        var data = Store.get();
        data.tasks = parsed.tasks.map(Model.normalizeTask);
        if (parsed.settings) Object.assign(data.settings, parsed.settings);
        Store.flush();
        location.reload();
      } catch (err) {
        alert('Could not import: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  // ---- Main init ----

  function init() {
    Notifier.setBannerContainer(document.getElementById('alert-banners'));

    var btnAdd = document.getElementById('btn-add');
    if (btnAdd) btnAdd.addEventListener('click', _showAddInput);

    var addWrap = document.getElementById('add-input-wrap');
    if (addWrap) addWrap.style.display = 'none';

    var addInput = document.getElementById('add-task-input');
    if (addInput) {
      addInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); _commitAdd(); }
        if (e.key === 'Escape') { _hideAddInput(); }
      });
    }
    var btnAddCommit = document.getElementById('btn-add-commit');
    if (btnAddCommit) btnAddCommit.addEventListener('click', _commitAdd);
    var btnAddCancel = document.getElementById('btn-add-cancel');
    if (btnAddCancel) btnAddCancel.addEventListener('click', _hideAddInput);

    var overlay = document.getElementById('editor-overlay');
    if (overlay) overlay.addEventListener('click', closeEditor);

    var modeBtn = document.getElementById('btn-mode-toggle');
    if (modeBtn) modeBtn.addEventListener('click', Modes.toggle);

    var notifBtn = document.getElementById('btn-notif');
    if (notifBtn) {
      notifBtn.addEventListener('click', function () {
        Notifier.requestPermission(function () { renderToolbar(); });
      });
    }

    var searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        _searchQuery = this.value;
        renderTaskList();
      });
    }

    var btnExport = document.getElementById('btn-export');
    if (btnExport) btnExport.addEventListener('click', exportData);
    var importInput = document.getElementById('import-input');
    if (importInput) {
      importInput.addEventListener('change', function () {
        if (this.files[0]) importData(this.files[0]);
      });
    }
    var btnImport = document.getElementById('btn-import');
    if (btnImport) btnImport.addEventListener('click', function () {
      document.getElementById('import-input').click();
    });

    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if ((e.key === '+' || e.key === 'n') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); _showAddInput();
      }
      if (e.key === 'Escape' && _addInputVisible) _hideAddInput();
      if (e.key === 'Escape' && _activeEditorId) closeEditor();
    });

    Store.onChange(function () {
      renderTaskList();
      renderFilterBar();
      renderToolbar();
    });

    renderTaskList();
    renderFilterBar();
    renderToolbar();
  }

  return {
    init: init,
    openEditor: openEditor,
    closeEditor: closeEditor,
    renderTaskList: renderTaskList,
    renderFilterBar: renderFilterBar,
    renderToolbar: renderToolbar
  };
})();

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
      icon = '🔁';
      text = 'every ' + rem.intervalEvery + rem.intervalUnit[0];
    } else if (rem.mode === 'datetime') {
      icon = rem.dueAt < now ? '⚠' : '📅';
      text = fmtDate(rem.dueAt);
    }
    if (rem.nextFireAt) {
      text = (isOverdue ? '⚠ ' : '') + fmtDate(rem.nextFireAt);
    }
    return '<span class="chip ' + cls + '">' + icon + ' ' + esc(text) + '</span>';
  }

  function priorityIcon(p) {
    return { high: '🔴', normal: '', low: '🔵' }[p] || '';
  }

  function colorName(c) {
    return { yellow: '🟡', pink: '🌸', blue: '🔵', green: '🟢', purple: '🟣', gray: '⬜' }[c] || '🟡';
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
      var subtaskChip = subtasksTotal > 0
        ? '<span class="chip chip-subtasks">' + subtasksDone + '/' + subtasksTotal + ' ✓</span>'
        : '';
      var tagChips = task.tags.map(function (tag) {
        return '<span class="chip chip-tag">' + esc(tag) + '</span>';
      }).join('');
      var popoutBtn = '<button class="btn-popout" title="Pop out as sticky note" data-id="' + esc(task.id) + '" aria-label="Pop out">⧉</button>';

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
        '</li>';
    }).join('');

    // Wire card click → open editor
    container.querySelectorAll('.task-card').forEach(function (card) {
      card.addEventListener('click', function (e) {
        if (e.target.closest('.task-done-cb') || e.target.closest('.btn-popout')) return;
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

    var nextFire = rem.nextFireAt ? fmtDate(rem.nextFireAt) : (rem.enabled ? '—' : '');

    var subtasksHtml = task.subtasks.map(function (s) {
      return '<li class="subtask-item" data-sid="' + esc(s.id) + '">' +
        '<label>' +
          '<input type="checkbox" class="subtask-cb"' + (s.done ? ' checked' : '') + '> ' +
          '<span class="subtask-text" contenteditable="true" data-sid="' + esc(s.id) + '">' + esc(s.text) + '</span>' +
        '</label>' +
        '<button class="btn-subtask-del" data-sid="' + esc(s.id) + '" aria-label="Remove subtask">✕</button>' +
        '</li>';
    }).join('');

    var tagsHtml = task.tags.map(function (tag) {
      return '<span class="tag-pill">' + esc(tag) +
        '<button class="btn-tag-remove" data-tag="' + esc(tag) + '" aria-label="Remove tag ' + esc(tag) + '">✕</button></span>';
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
        '<textarea id="editor-notes" class="editor-notes" placeholder="Optional notes…" rows="3">' + esc(task.notes) + '</textarea>' +

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
        '<label class="field-label">Subtasks</label>' +
        '<ul class="subtasks-list" id="subtasks-list">' + subtasksHtml + '</ul>' +
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
              '<label>Every <input type="number" id="rem-interval-every" value="' + (rem.intervalEvery || 1) + '" min="1" style="width:60px"> ' +
                '<select id="rem-interval-unit">' + intervalUnitOpts + '</select>' +
              '</label>' +
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

  function _toDatetimeLocal(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    var pad = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
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
      rem.intervalEvery = parseInt(p.querySelector('#rem-interval-every').value, 10) || 1;
      rem.intervalUnit = p.querySelector('#rem-interval-unit').value;
      if (!rem.intervalAnchor) rem.intervalAnchor = Date.now();
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

    // Close
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
        p.querySelectorAll('.seg-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        var mode = btn.dataset.mode;
        p.querySelector('.rem-datetime-opts').style.display = mode === 'datetime' ? '' : 'none';
        p.querySelector('.rem-interval-opts').style.display = mode === 'interval' ? '' : 'none';
        _updateNextFirePreview(task);
      });
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

    // Live next-fire preview on any reminder input change
    p.querySelector('.rem-config').querySelectorAll('input, select').forEach(function (el) {
      el.addEventListener('change', function () { _updateNextFirePreview(task); });
    });

    // Tags
    p.querySelector('#btn-add-tag').addEventListener('click', function () { _addTag(task); });
    p.querySelector('#tag-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); _addTag(task); }
    });
    p.querySelectorAll('.btn-tag-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        task.tags = task.tags.filter(function (t) { return t !== btn.dataset.tag; });
        p.querySelector('#tag-pills').innerHTML = task.tags.map(function (tag) {
          return '<span class="tag-pill">' + esc(tag) +
            '<button class="btn-tag-remove" data-tag="' + esc(tag) + '">✕</button></span>';
        }).join('');
        p.querySelectorAll('.btn-tag-remove').forEach(function (b) {
          b.addEventListener('click', function () {
            task.tags = task.tags.filter(function (t) { return t !== b.dataset.tag; });
            _refreshTagPills(task);
          });
        });
      });
    });

    // Subtasks
    p.querySelector('#btn-add-subtask').addEventListener('click', function () { _addSubtask(task); });
    p.querySelector('#subtask-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); _addSubtask(task); }
    });
    _wireSubtasks(task);

    // Save
    p.querySelector('#btn-save-task').addEventListener('click', function () {
      _readEditor(task);
      if (!task.title) { p.querySelector('#editor-title').focus(); return; }
      if (task.reminder.enabled && task.reminder.mode !== 'none') {
        ReminderEngine.enableTask(task);
      } else {
        ReminderEngine.disableTask(task);
      }
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
    task.subtasks.push(Model.createSubtask(val));
    input.value = '';
    var list = document.getElementById('subtasks-list');
    _renderSubtaskItem(task, task.subtasks[task.subtasks.length - 1], list);
  }

  function _renderSubtaskItem(task, s, list) {
    var li = document.createElement('li');
    li.className = 'subtask-item';
    li.dataset.sid = s.id;
    li.innerHTML =
      '<label><input type="checkbox" class="subtask-cb"' + (s.done ? ' checked' : '') + '> ' +
        '<span class="subtask-text" contenteditable="true" data-sid="' + esc(s.id) + '">' + esc(s.text) + '</span>' +
      '</label>' +
      '<button class="btn-subtask-del" data-sid="' + esc(s.id) + '" aria-label="Remove subtask">✕</button>';
    list.appendChild(li);
    li.querySelector('.subtask-cb').addEventListener('change', function () {
      s.done = this.checked;
    });
    li.querySelector('.subtask-text').addEventListener('blur', function () {
      s.text = this.textContent.trim();
    });
    li.querySelector('.btn-subtask-del').addEventListener('click', function () {
      task.subtasks = task.subtasks.filter(function (st) { return st.id !== s.id; });
      li.remove();
    });
  }

  function _wireSubtasks(task) {
    var list = document.getElementById('subtasks-list');
    if (!list) return;
    list.querySelectorAll('.subtask-item').forEach(function (li) {
      var sid = li.dataset.sid;
      var s = task.subtasks.find(function (st) { return st.id === sid; });
      if (!s) return;
      li.querySelector('.subtask-cb').addEventListener('change', function () { s.done = this.checked; });
      li.querySelector('.subtask-text').addEventListener('blur', function () { s.text = this.textContent.trim(); });
      li.querySelector('.btn-subtask-del').addEventListener('click', function () {
        task.subtasks = task.subtasks.filter(function (st) { return st.id !== sid; });
        li.remove();
      });
    });
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
    // Banner container
    Notifier.setBannerContainer(document.getElementById('alert-banners'));

    // Add task button
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

    // Editor overlay close
    var overlay = document.getElementById('editor-overlay');
    if (overlay) overlay.addEventListener('click', closeEditor);

    // Mode toggle
    var modeBtn = document.getElementById('btn-mode-toggle');
    if (modeBtn) modeBtn.addEventListener('click', Modes.toggle);

    // Notifications chip
    var notifBtn = document.getElementById('btn-notif');
    if (notifBtn) {
      notifBtn.addEventListener('click', function () {
        Notifier.requestPermission(function () { renderToolbar(); });
      });
    }

    // Search
    var searchInput = document.getElementById('search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        _searchQuery = this.value;
        renderTaskList();
      });
    }

    // Export / Import
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

    // Keyboard shortcuts (global)
    document.addEventListener('keydown', function (e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if ((e.key === '+' || e.key === 'n') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault(); _showAddInput();
      }
      if (e.key === 'Escape' && _addInputVisible) _hideAddInput();
      if (e.key === 'Escape' && _activeEditorId) closeEditor();
    });

    // Store changes → re-render
    Store.onChange(function () {
      renderTaskList();
      renderFilterBar();
      renderToolbar();
    });

    // Initial render
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

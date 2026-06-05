var Search = (function () {

  function filterAndSort(tasks, settings, query) {
    var filter = settings.filter || 'all';
    var filterTag = settings.filterTag || '';
    var sort = settings.sort || 'createdAt';
    var now = Date.now();

    var result = tasks.filter(function (t) {
      // Status filter
      if (filter === 'active' && t.done) return false;
      if (filter === 'done' && !t.done) return false;
      if (filter === 'overdue') {
        var overdue = t.reminder.enabled && t.reminder.nextFireAt && t.reminder.nextFireAt < now;
        if (!overdue && !(!t.done && t.reminder.mode === 'datetime' && t.reminder.dueAt && t.reminder.dueAt < now)) return false;
      }
      // Tag filter
      if (filterTag && t.tags.indexOf(filterTag) === -1) return false;
      // Text search
      if (query) {
        var q = query.toLowerCase();
        var haystack = (t.title + ' ' + t.notes + ' ' + t.tags.join(' ')).toLowerCase();
        if (haystack.indexOf(q) === -1) return false;
      }
      return true;
    });

    result.sort(function (a, b) {
      // Pinned always first
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;

      if (sort === 'priority') {
        var pOrder = { high: 0, normal: 1, low: 2 };
        var pa = pOrder[a.priority] || 1;
        var pb = pOrder[b.priority] || 1;
        if (pa !== pb) return pa - pb;
      } else if (sort === 'due') {
        var da = (a.reminder.dueAt || Infinity);
        var db = (b.reminder.dueAt || Infinity);
        if (da !== db) return da - db;
      } else if (sort === 'alpha') {
        return a.title.localeCompare(b.title);
      }

      // Default: createdAt descending (newest first)
      return b.createdAt - a.createdAt;
    });

    return result;
  }

  function getAllTags(tasks) {
    var set = {};
    tasks.forEach(function (t) {
      t.tags.forEach(function (tag) { set[tag] = true; });
    });
    return Object.keys(set).sort();
  }

  return { filterAndSort: filterAndSort, getAllTags: getAllTags };
})();

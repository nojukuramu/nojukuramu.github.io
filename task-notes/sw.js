/* sw.js — offline shell plus a worker-side copy of the alarm engine.
 *
 * Because notes now live in IndexedDB, the worker can read them, decide what
 * is due and post the notification itself — no open tab required, as long as
 * the browser wakes the worker up.
 */
importScripts('static/js/db.js', 'static/js/schedule.js', 'static/js/model.js');

var CACHE = 'task-notes-v3';

var SHELL = [
  './',
  'index.html',
  'offline.html',
  'manifest.webmanifest',
  'static/css/app.css',
  'static/js/db.js',
  'static/js/schedule.js',
  'static/js/model.js',
  'static/js/store.js',
  'static/js/markdown.js',
  'static/js/audio.js',
  'static/js/notify.js',
  'static/js/engine.js',
  'static/js/alarm.js',
  'static/js/ui.js',
  'static/js/editor.js',
  'static/js/app.js',
  'static/icons/icon-192.png',
  'static/icons/icon-512.png',
  'static/icons/icon-maskable-192.png',
  'static/icons/icon-maskable-512.png',
  'static/icons/apple-touch-icon.png',
  'static/icons/favicon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) {
        // One bad URL should not fail the whole install.
        return Promise.all(SHELL.map(function (u) {
          return c.add(u).catch(function () {});
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  if (!req.url.startsWith(self.location.origin)) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match('index.html').then(function (r) {
          return r || caches.match('offline.html');
        });
      })
    );
    return;
  }

  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req).then(function (cached) {
        var live = fetch(req).then(function (fresh) {
          if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
          return fresh;
        }).catch(function () { return cached; });
        return cached || live;
      });
    })
  );
});

/* ================= alarm engine (worker side) ================= */

function settings() {
  return DB.kvGet('settings').then(function (s) {
    return Object.assign(Model.defaultSettings(), s || {});
  });
}

function notifyClients(msg) {
  try {
    var ch = new BroadcastChannel('task-notes-sync');
    ch.postMessage(msg);
    ch.close();
  } catch (_) {}
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    list.forEach(function (c) { c.postMessage(msg); });
  });
}

function titleFor(note, rem) {
  if (rem.label) return rem.label;
  if (note.title) return note.title;
  var line = String(note.body || '').split('\n').filter(function (l) { return l.trim(); })[0] || '';
  return line.slice(0, 60) || 'Reminder';
}

function bodyFor(note, rem) {
  var text = String(note.body || '')
    .replace(/^\s*[-*]\s+\[( |x|X)\]\s?/gm, '• ')
    .replace(/[#*_`>]/g, '')
    .trim();
  return text.slice(0, 140) || (rem.alarm ? 'Alarm' : 'Reminder');
}

function showFor(note, rem, missed) {
  return self.registration.showNotification(titleFor(note, rem), {
    body: (missed ? 'Missed · ' : '') + bodyFor(note, rem),
    tag: 'tn:' + rem.id,
    renotify: true,
    requireInteraction: !!rem.alarm,
    icon: 'static/icons/icon-192.png',
    badge: 'static/icons/icon-192.png',
    vibrate: rem.vibrate ? [300, 120, 300, 120, 300] : undefined,
    data: { noteId: note.id, reminderId: rem.id, alarm: !!rem.alarm }
  });
}

function advanceAfterFire(rem, now, opts) {
  rem.lastFiredAt = now;
  rem.firedCount = (rem.firedCount || 0) + 1;
  rem.nextAt = Sched.nextOccurrence(rem, now, opts);
  var as = rem.autoSnooze || {};
  if (as.enabled && (rem.snoozeCount || 0) < (as.max || 3)) {
    rem.snoozeCount = (rem.snoozeCount || 0) + 1;
    rem.snoozedUntil = now + Math.max(1, as.every || 5) * Sched.unitMs(as.unit || 'minutes');
  } else {
    rem.snoozeCount = 0;
    rem.snoozedUntil = null;
  }
  if (rem.kind === 'once' && !rem.nextAt && !rem.snoozedUntil) rem.enabled = false;
}

/* Scan storage and post anything that is due. Returns how many fired. */
function sweep() {
  return Promise.all([DB.getAll('notes'), settings()]).then(function (res) {
    var notes = res[0] || [];
    var s = res[1];
    var opts = { quietHours: s.quietHours };
    var now = Date.now();
    var changed = [];
    var shows = [];

    notes.forEach(function (note) {
      if (note.trashed || note.archived) return;
      var dirty = false;
      (note.reminders || []).forEach(function (rem) {
        if (!rem.enabled) return;
        if (note.done && rem.kind === 'once') return;
        var at = Sched.effectiveNext(rem);
        if (!at || at > now) return;
        shows.push({ note: note, rem: rem, missed: now - at > 120000 });
        if (note.done && rem.kind !== 'once') { note.done = false; note.doneAt = null; }
        advanceAfterFire(rem, now, opts);
        dirty = true;
      });
      if (dirty) changed.push(note);
    });

    if (!shows.length) return 0;
    return DB.putMany('notes', changed)
      .then(function () {
        return Promise.all(shows.map(function (x) { return showFor(x.note, x.rem, x.missed); }));
      })
      .then(function () { return notifyClients({ type: 'notes-changed' }); })
      .then(function () { return shows.length; });
  }).catch(function () { return 0; });
}

/* Apply a notification action straight to storage. */
function respond(reminderId, action) {
  return Promise.all([DB.getAll('notes'), settings()]).then(function (res) {
    var notes = res[0] || [];
    var s = res[1];
    var opts = { quietHours: s.quietHours };
    var now = Date.now();
    var hit = null;

    notes.some(function (note) {
      return (note.reminders || []).some(function (rem) {
        if (rem.id !== reminderId) return false;
        hit = { note: note, rem: rem };
        return true;
      });
    });
    if (!hit) return null;

    var note = hit.note, rem = hit.rem;
    if (action === 'snooze') {
      var d = s.defaultSnooze || { every: 5, unit: 'minutes' };
      rem.snoozedUntil = now + Math.max(1, d.every) * Sched.unitMs(d.unit || 'minutes');
      rem.snoozeCount = 0;
    } else {
      if (action === 'done') { note.done = true; note.doneAt = now; }
      rem.snoozedUntil = null;
      rem.snoozeCount = 0;
      rem.nextAt = Sched.nextOccurrence(rem, now, opts);
      if (rem.kind === 'once' && !rem.nextAt) rem.enabled = false;
    }
    note.updatedAt = now;

    return DB.put('notes', note)
      .then(function () { return notifyClients({ type: 'notes-changed' }); })
      .then(function () { return note; });
  }).catch(function () { return null; });
}

self.addEventListener('notificationclick', function (e) {
  var data = e.notification.data || {};
  var action = e.action;
  e.notification.close();

  e.waitUntil(
    respond(data.reminderId, action || 'open').then(function () {
      if (action === 'snooze' || action === 'done') return null;
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
        if (list.length) {
          var c = list[0];
          c.postMessage({ type: 'open-note', noteId: data.noteId });
          return c.focus();
        }
        return self.clients.openWindow('./?note=' + encodeURIComponent(data.noteId || ''));
      });
    })
  );
});

self.addEventListener('periodicsync', function (e) {
  if (e.tag === 'tn-alarms') e.waitUntil(sweep());
});

self.addEventListener('sync', function (e) {
  if (e.tag === 'tn-alarms') e.waitUntil(sweep());
});

self.addEventListener('message', function (e) {
  var msg = e.data || {};
  if (msg.type === 'sweep') e.waitUntil(sweep());
  if (msg.type === 'skip-waiting') self.skipWaiting();
});

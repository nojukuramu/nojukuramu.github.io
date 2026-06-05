var CACHE = 'task-notes-v2';
var SHELL = [
  './',
  'index.html',
  'offline.html',
  'manifest.webmanifest',
  'static/css/app.css',
  'static/js/model.js',
  'static/js/store.js',
  'static/js/notify.js',
  'static/js/reminders.js',
  'static/js/search.js',
  'static/js/modes.js',
  'static/js/ui.js',
  'static/js/pwa.js',
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
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  // Only handle same-origin requests within our scope
  if (!req.url.startsWith(self.location.origin)) return;

  if (req.mode === 'navigate') {
    // Navigation: network-first, fall back to cached index, then offline page
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match('index.html').then(function (r) { return r || caches.match('offline.html'); });
      })
    );
    return;
  }

  // Static assets: stale-while-revalidate
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req).then(function (cached) {
        var fetchPromise = fetch(req).then(function (fresh) {
          cache.put(req, fresh.clone());
          return fresh;
        }).catch(function () { return cached; });
        return cached || fetchPromise;
      });
    })
  );
});

// Handle notification clicks (Snooze / Dismiss actions)
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var action = e.action;
  var taskId = e.notification.tag;

  if (action === 'snooze') {
    // Post a message to all clients to snooze this task
    e.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(function (clients) {
        clients.forEach(function (c) {
          c.postMessage({ type: 'SNOOZE_TASK', taskId: taskId, every: 5, unit: 'minutes' });
        });
      })
    );
  } else {
    // Dismiss or open — focus / open the app
    e.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
        clients.forEach(function (c) {
          c.postMessage({ type: 'DISMISS_TASK', taskId: taskId });
        });
        if (clients.length > 0) return clients[0].focus();
        return self.clients.openWindow('./');
      })
    );
  }
});

self.addEventListener('notificationclose', function (e) {
  // Notification closed without action — treat as dismiss
  var taskId = e.notification.tag;
  self.clients.matchAll({ type: 'window' }).then(function (clients) {
    clients.forEach(function (c) {
      c.postMessage({ type: 'DISMISS_TASK', taskId: taskId });
    });
  });
});

// Best-effort periodic sync for background reminders
self.addEventListener('periodicsync', function (e) {
  if (e.tag === 'task-notes-reminders') {
    e.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(function (clients) {
        if (clients.length === 0) {
          // App isn't open — can't access localStorage from SW context.
          // A real implementation would need IndexedDB here.
          return;
        }
        clients.forEach(function (c) {
          c.postMessage({ type: 'PERIODIC_SWEEP' });
        });
      })
    );
  }
});

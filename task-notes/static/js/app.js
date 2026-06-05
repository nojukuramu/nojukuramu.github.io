// Bootstrap — runs after all other scripts are loaded.
(function () {
  Store.init();
  Modes.initFromUrl();
  Modes.init(document.documentElement);
  UI.init();
  ReminderEngine.start();
  PWA.init();

  // Handle messages from the service worker (notification action clicks)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (e) {
      var msg = e.data;
      if (!msg) return;
      var tasks = Store.getTasks();
      var task = tasks.find(function (t) { return t.id === msg.taskId; });
      if (!task) return;

      if (msg.type === 'SNOOZE_TASK') {
        task.reminder.nextFireAt = Date.now() + (msg.every || 5) * Model.UNIT_MS(msg.unit || 'minutes');
        Store.upsertTask(task);
      } else if (msg.type === 'DISMISS_TASK') {
        task.reminder.acknowledgedAt = Date.now();
        task.reminder.snoozeCount = 0;
        Store.upsertTask(task);
      } else if (msg.type === 'PERIODIC_SWEEP') {
        ReminderEngine.sweep(true);
      }
    });
  }
})();

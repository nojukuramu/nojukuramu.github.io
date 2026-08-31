/* db.js — IndexedDB layer.
 *
 * Deliberately free of DOM references: this file is loaded both by the page
 * and by the service worker (via importScripts), so the worker can read and
 * update reminders while no tab is open. That is the whole reason the app
 * moved off localStorage.
 */
(function (global) {
  'use strict';

  var DB_NAME = 'task-notes';
  var DB_VERSION = 1;
  var _open = null;

  /* Without this, browsers treat our storage as evictable: Chrome can clear
   * it under disk pressure and Safari's ITP wipes script-writable storage
   * after ~7 days with no visit. Ask once per tab; the browser can still
   * say no (it's a heuristic grant, not a promise), so log the outcome —
   * silently swallowing it would leave no way to tell "denied" apart from
   * "storage actually got cleared" when someone reports data loss later.
   * Page context only — this file is also imported by the service worker,
   * which has no need to ask (and importScripts has no top-level
   * `document`). */
  if (typeof document !== 'undefined' && global.navigator && navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(function (already) {
      if (already) return true;
      return navigator.storage.persist();
    }).then(function (granted) {
      if (!granted) console.warn('[task-notes] persistent storage was not granted; data may be evicted by the browser');
    }).catch(function () {});
  }

  function open() {
    if (_open) return _open;
    _open = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('notes')) {
          var notes = db.createObjectStore('notes', { keyPath: 'id' });
          notes.createIndex('updatedAt', 'updatedAt');
          notes.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('notebooks')) {
          db.createObjectStore('notebooks', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv');
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('IndexedDB blocked')); };
    });
    return _open;
  }

  function tx(storeNames, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(storeNames, mode);
        var out;
        t.oncomplete = function () { resolve(out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error || new Error('aborted')); };
        try {
          out = fn(t);
        } catch (err) {
          try { t.abort(); } catch (_) {}
          reject(err);
        }
      });
    });
  }

  function req2promise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function getAll(store) {
    return open().then(function (db) {
      return req2promise(db.transaction(store, 'readonly').objectStore(store).getAll());
    });
  }

  function get(store, key) {
    return open().then(function (db) {
      return req2promise(db.transaction(store, 'readonly').objectStore(store).get(key));
    });
  }

  function put(store, value, key) {
    return tx(store, 'readwrite', function (t) {
      t.objectStore(store).put(value, key);
    });
  }

  function putMany(store, values) {
    return tx(store, 'readwrite', function (t) {
      var os = t.objectStore(store);
      values.forEach(function (v) { os.put(v); });
    });
  }

  function del(store, key) {
    return tx(store, 'readwrite', function (t) {
      t.objectStore(store).delete(key);
    });
  }

  function delMany(store, keys) {
    return tx(store, 'readwrite', function (t) {
      var os = t.objectStore(store);
      keys.forEach(function (k) { os.delete(k); });
    });
  }

  function clear(store) {
    return tx(store, 'readwrite', function (t) { t.objectStore(store).clear(); });
  }

  function replaceAll(store, values) {
    return tx(store, 'readwrite', function (t) {
      var os = t.objectStore(store);
      os.clear();
      values.forEach(function (v) { os.put(v); });
    });
  }

  function kvGet(key, fallback) {
    return get('kv', key).then(function (v) {
      return v === undefined ? fallback : v;
    });
  }

  function kvSet(key, value) {
    return put('kv', value, key);
  }

  function estimate() {
    if (!global.navigator || !navigator.storage || !navigator.storage.estimate) {
      return Promise.resolve(null);
    }
    return navigator.storage.estimate().catch(function () { return null; });
  }

  global.DB = {
    open: open,
    getAll: getAll,
    get: get,
    put: put,
    putMany: putMany,
    del: del,
    delMany: delMany,
    clear: clear,
    replaceAll: replaceAll,
    kvGet: kvGet,
    kvSet: kvSet,
    estimate: estimate
  };
})(typeof self !== 'undefined' ? self : this);

/* save.js
 * IndexedDB-backed persistence (localStorage's ~5-10MB cap is too small once
 * a heightmap + road graph + hundreds of buildings are serialized). Saves
 * are versioned (`saveVersion`) so a future format change can migrate old
 * records instead of breaking them — see `migrate()`.
 *
 * Slots: any number of named manual saves, plus one reserved "autosave"
 * slot that periodic autosave overwrites. Export/import round-trips a slot
 * to/from a downloadable .json file so progress isn't locked to one
 * browser profile.
 */
(function (global) {
  "use strict";
  var SAVE_VERSION = 1;
  var DB_NAME = "skyline-city-builder";
  var STORE = "saves";

  var Save = {
    db: null,
    AUTOSAVE_ID: "__autosave__",

    init: function () {
      var self = this;
      return new Promise(function (resolve, reject) {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
        };
        req.onsuccess = function (e) { self.db = e.target.result; resolve(self.db); };
        req.onerror = function () { reject(req.error); };
      });
    },

    // ---------------- migration ----------------
    migrate: function (data) {
      if (!data.saveVersion) data.saveVersion = 1;
      // future: if (data.saveVersion < 2) { ...upgrade fields...; data.saveVersion = 2; }
      return data;
    },

    // ---------------- serialize whole city ----------------
    serializeCity: function () {
      return {
        saveVersion: SAVE_VERSION,
        mode: Game.mode,
        terrain: { heights: Game.Terrain.heights, segs: Game.Terrain.segs },
        roads: Game.Roads.getSaveState(),
        zoning: Game.Zoning.getSaveState(),
        buildings: Game.Buildings.getSaveState(),
        economy: Game.Economy.getSaveState(),
        lighting: Game.Lighting.getSaveState(),
        weather: Game.Weather.getSaveState(),
        camera: Game.Terrain.getCameraSaveState()
      };
    },

    applyCityData: function (data) {
      data = this.migrate(data);
      Game.loadCityData(data);
    },

    // ---------------- IndexedDB CRUD ----------------
    _tx: function (mode) { return this.db.transaction(STORE, mode).objectStore(STORE); },

    saveToSlot: function (slotId, name, thumbnail) {
      var self = this;
      return new Promise(function (resolve, reject) {
        var record = {
          id: slotId, name: name, timestamp: Date.now(), thumbnail: thumbnail || null,
          data: self.serializeCity()
        };
        var req = self._tx("readwrite").put(record);
        req.onsuccess = function () { resolve(record); };
        req.onerror = function () { reject(req.error); };
      });
    },

    autosave: function () {
      var self = this;
      var thumb = Game.captureThumbnail ? Game.captureThumbnail() : null;
      return this.saveToSlot(this.AUTOSAVE_ID, "Autosave", thumb).catch(function (e) { console.warn("autosave failed", e); });
    },

    loadSlot: function (slotId) {
      var self = this;
      return new Promise(function (resolve, reject) {
        var req = self._tx("readonly").get(slotId);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    },

    listSlots: function () {
      var self = this;
      return new Promise(function (resolve, reject) {
        var req = self._tx("readonly").getAll();
        req.onsuccess = function () {
          var list = req.result || [];
          list.sort(function (a, b) { return b.timestamp - a.timestamp; });
          resolve(list);
        };
        req.onerror = function () { reject(req.error); };
      });
    },

    deleteSlot: function (slotId) {
      var self = this;
      return new Promise(function (resolve, reject) {
        var req = self._tx("readwrite").delete(slotId);
        req.onsuccess = function () { resolve(); };
        req.onerror = function () { reject(req.error); };
      });
    },

    // ---------------- export / import ----------------
    exportSlot: function (record) {
      var plain = JSON.stringify(record.data, function (key, value) {
        if (value instanceof Float32Array) return Array.from(value);
        return value;
      });
      var blob = new Blob([plain], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      var safeName = (record.name || "city").replace(/[^a-z0-9_\-]+/gi, "_");
      a.href = url; a.download = "skyline-" + safeName + ".json";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    },

    importFile: function (file) {
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var data = JSON.parse(reader.result);
            if (data.terrain && Array.isArray(data.terrain.heights)) {
              data.terrain.heights = new Float32Array(data.terrain.heights);
            }
            resolve(data);
          } catch (e) { reject(e); }
        };
        reader.onerror = function () { reject(reader.error); };
        reader.readAsText(file);
      });
    }
  };

  Game.Save = Save;
})(window);

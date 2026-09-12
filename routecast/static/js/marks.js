/* ============================================================
   RouteCast — saved marks

   A mark is a place you named yourself: "home", "the gate at the back of
   the plant", "that shed where the road forks". The point of them is that
   they are YOUR coordinate, not a geocoder's — a mark is stored as the exact
   pair of numbers it was made from, and reusing one never goes near the
   network.

   Same shape as routes.js on purpose: a bounded, versioned localStorage
   store with an in-place update rather than an ever-growing pile of near
   duplicates. Two marks within about a metre of each other are the same
   mark; re-saving one under a new name renames it instead of stacking a
   second copy.

   It never leaves the device.
   ============================================================ */
RC.marks = (function () {
  "use strict";

  var KEY = "savedMarks";
  var VERSION = 1;
  var MAX = 200;
  var NAME_MAX = 60;

  function load() {
    var raw = RC.store.get(KEY, null);
    if (!raw || raw.v !== VERSION || !Array.isArray(raw.items)) return { v: VERSION, items: [] };
    return raw;
  }

  function persist(db) { RC.store.set(KEY, db); }

  function newId() {
    return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // A metre of resolution: fine enough to tell two ends of a street apart,
  // coarse enough that re-pinning the same gate is the same mark.
  function signature(lat, lon) {
    return lat.toFixed(5) + "," + lon.toFixed(5);
  }

  /* RC.marks.list() -> most recently used first. */
  function list() {
    var items = load().items.slice();
    items.sort(function (a, b) {
      return (b.lastUsedAt || b.createdAt || 0) - (a.lastUsedAt || a.createdAt || 0);
    });
    return items;
  }

  function get(id) {
    var items = load().items;
    for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
    return null;
  }

  /* RC.marks.save({name, lat, lon, address}) -> entry
     Throws without a usable coordinate: a mark with no position is a note,
     and this is not a notes app. */
  function save(input) {
    input = input || {};
    var lat = Number(input.lat), lon = Number(input.lon);
    if (!RC.coords.isValid(lat, lon)) throw RC.error("A mark needs a coordinate.", "input");

    var db = load();
    var sig = signature(lat, lon);
    var entry = {
      id: newId(),
      name: String(input.name || "").trim().slice(0, NAME_MAX) || RC.coords.format(lat, lon),
      address: String(input.address || "").slice(0, 200),
      lat: lat,
      lon: lon,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 0
    };

    for (var i = db.items.length - 1; i >= 0; i--) {
      if (signature(db.items[i].lat, db.items[i].lon) === sig) {
        // Same spot: keep its identity and its history, take the new name.
        entry.id = db.items[i].id;
        entry.createdAt = db.items[i].createdAt;
        entry.useCount = db.items[i].useCount || 0;
        db.items.splice(i, 1);
      }
    }

    db.items.push(entry);
    while (db.items.length > MAX) {
      var oldest = 0;
      for (var j = 1; j < db.items.length; j++) {
        if ((db.items[j].lastUsedAt || 0) < (db.items[oldest].lastUsedAt || 0)) oldest = j;
      }
      db.items.splice(oldest, 1);
    }
    persist(db);
    return entry;
  }

  function rename(id, name) {
    var db = load();
    for (var i = 0; i < db.items.length; i++) {
      if (db.items[i].id === id) {
        db.items[i].name = String(name || "").trim().slice(0, NAME_MAX) || db.items[i].name;
        persist(db);
        return db.items[i];
      }
    }
    return null;
  }

  function remove(id) {
    var db = load();
    var before = db.items.length;
    db.items = db.items.filter(function (m) { return m.id !== id; });
    if (db.items.length !== before) persist(db);
    return before !== db.items.length;
  }

  function touch(id) {
    var db = load();
    for (var i = 0; i < db.items.length; i++) {
      if (db.items[i].id === id) {
        db.items[i].lastUsedAt = Date.now();
        db.items[i].useCount = (db.items[i].useCount || 0) + 1;
        persist(db);
        return db.items[i];
      }
    }
    return null;
  }

  /* Marks matching what has been typed so far. They are offered ABOVE the
     search results and cost nothing, which is the whole point: the places
     you go most often should never need a round trip to Nominatim. */
  function find(query, limit) {
    var q = String(query || "").trim().toLowerCase();
    var items = list();
    if (!q) return items.slice(0, limit == null ? 6 : limit);
    var out = [];
    for (var i = 0; i < items.length && out.length < (limit == null ? 6 : limit); i++) {
      var m = items[i];
      if (m.name.toLowerCase().indexOf(q) > -1 || (m.address || "").toLowerCase().indexOf(q) > -1) {
        out.push(m);
      }
    }
    return out;
  }

  /* The nearest mark to a coordinate, within `withinM`. Used to label a pin
     the rider drops on somewhere they have already named, rather than
     reverse-geocoding it into an address they will not recognise. */
  function nearest(lat, lon, withinM) {
    var limit = withinM == null ? 60 : withinM;
    var items = load().items;
    var best = null, bestD = Infinity;
    for (var i = 0; i < items.length; i++) {
      var d = RC.haversine({ lat: lat, lon: lon }, { lat: items[i].lat, lon: items[i].lon });
      if (d < bestD) { bestD = d; best = items[i]; }
    }
    return (best && bestD <= limit) ? best : null;
  }

  // A mark, as the rest of the app speaks it. `precise` because it is: the
  // coordinate was aimed at once and has been kept ever since.
  function toPlace(mark) {
    if (!mark) return null;
    return {
      name: mark.name,
      address: mark.address || RC.coords.format(mark.lat, mark.lon),
      lat: mark.lat,
      lon: mark.lon,
      precise: true,
      markId: mark.id
    };
  }

  function clear() { persist({ v: VERSION, items: [] }); }

  return {
    list: list,
    get: get,
    save: save,
    rename: rename,
    remove: remove,
    touch: touch,
    find: find,
    nearest: nearest,
    toPlace: toPlace,
    clear: clear,
    MAX: MAX
  };
})();

/* ============================================================
   RouteCast — saved routes
   A route worth riding twice is worth keeping. This is a small, bounded
   store of named trips: the places (with their exact coordinates), the
   vehicle they were planned for, the checkpoint spacing, and how often the
   trip has been reused.

   It stores PLACES, not geometry. Reloading a saved route re-runs the
   router, which is the right thing: roads change, the traffic model has
   moved on, and the forecast has to be fetched fresh anyway. What is worth
   persisting is the intent — these points, this vehicle — not a polyline
   that was true last March.

   Coordinates are stored exactly as they were confirmed, including the
   `precise` flag that says a point came from a map pin or a GPS fix rather
   than from a geocoder's idea of where an address is. That distinction is
   the whole reason marking works the way it does, and it survives a save.
   ============================================================ */
RC.routes = (function () {
  "use strict";

  var KEY = "savedRoutes";
  var VERSION = 1;
  var MAX = 60;
  var NAME_MAX = 60;

  function load() {
    var raw = RC.store.get(KEY, null);
    if (!raw || raw.v !== VERSION || !Array.isArray(raw.items)) return { v: VERSION, items: [] };
    return raw;
  }

  function persist(db) {
    RC.store.set(KEY, db);
  }

  function newId() {
    return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function cleanPlace(p) {
    if (!p || typeof p.lat !== "number" || typeof p.lon !== "number") return null;
    return {
      name: String(p.name || "").slice(0, 120),
      address: String(p.address || "").slice(0, 200),
      lat: p.lat,
      lon: p.lon,
      precise: !!p.precise
    };
  }

  /* A default name, when the rider does not type one: "Makati to Tagaytay",
     using the short half of each place label rather than the full postal
     address, which is unreadable at chip size. */
  function suggestName(places) {
    if (!places || places.length < 2) return "Saved route";
    function shortName(p) {
      var n = (p && p.name) || "";
      var comma = n.indexOf(",");
      return (comma > 0 ? n.slice(0, comma) : n).trim() || "Unnamed";
    }
    var name = shortName(places[0]) + " to " + shortName(places[places.length - 1]);
    if (places.length > 2) name += " (" + (places.length - 2) + " stop" + (places.length > 3 ? "s" : "") + ")";
    return name.slice(0, NAME_MAX);
  }

  /* RC.routes.list() -> newest use first. */
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

  /* RC.routes.save({name, places, vehicle, interval}) -> entry
     Throws on fewer than two places — a route with one end is a pin, not a
     route, and silently storing it would fill the list with junk. */
  function save(input) {
    input = input || {};
    var places = (input.places || []).map(cleanPlace).filter(Boolean);
    if (places.length < 2) throw RC.error("A saved route needs a start and a destination.", "input");

    var db = load();
    var entry = {
      id: newId(),
      name: String(input.name || "").trim().slice(0, NAME_MAX) || suggestName(places),
      places: places,
      vehicle: input.vehicle === "motorcycle" ? "motorcycle" : "car",
      interval: input.interval || "auto",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 0
    };

    /* Re-saving the same points under the same vehicle updates the existing
       entry rather than stacking a second copy of a daily commute — and
       keeps its ID, because anything already holding a reference to that
       route (a list rendered a moment ago, a button mid-tap) must not be
       left pointing at nothing. Its history comes along too: re-saving a
       trip under a better name is not a reason to forget you have ridden
       it eleven times. */
    var sig = signature(entry);
    for (var i = db.items.length - 1; i >= 0; i--) {
      if (signature(db.items[i]) === sig) {
        entry.id = db.items[i].id;
        entry.createdAt = db.items[i].createdAt;
        entry.useCount = db.items[i].useCount || 0;
        db.items.splice(i, 1);
      }
    }

    db.items.push(entry);
    while (db.items.length > MAX) {
      // Evict the least recently used, never the one just saved.
      var oldest = 0;
      for (var j = 1; j < db.items.length; j++) {
        if ((db.items[j].lastUsedAt || 0) < (db.items[oldest].lastUsedAt || 0)) oldest = j;
      }
      db.items.splice(oldest, 1);
    }
    persist(db);
    return entry;
  }

  // Five decimal places is about a metre — close enough that re-picking the
  // same pin counts as the same trip, fine enough that two ends of a street
  // do not.
  function signature(entry) {
    if (!entry || !entry.places) return "";
    return entry.vehicle + "|" + entry.places.map(function (p) {
      return p.lat.toFixed(5) + "," + p.lon.toFixed(5);
    }).join(";");
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
    db.items = db.items.filter(function (r) { return r.id !== id; });
    if (db.items.length !== before) persist(db);
    return before !== db.items.length;
  }

  /* Mark a route as used — reordering the list so the trips you actually
     reuse float to the top. */
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

  function clear() { persist({ v: VERSION, items: [] }); }

  return {
    list: list,
    get: get,
    save: save,
    rename: rename,
    remove: remove,
    touch: touch,
    clear: clear,
    suggestName: suggestName,
    signature: signature,
    MAX: MAX
  };
})();

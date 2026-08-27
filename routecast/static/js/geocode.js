/* ============================================================
   RouteCast — geocoding
   Upstream: Nominatim (https://nominatim.openstreetmap.org), free & key-less.
   Usage policy: max 1 request/second, no bulk/heavy loops, identify the app
   via a normal browser fetch (no custom User-Agent possible from the
   browser, that's fine for light personal use). We honour the rate limit by
   funnelling every request through a single shared RC.throttleQueue(1100).
   We also keep a tiny in-memory cache so repeated identical queries (e.g.
   the user retyping/backspacing while searching) don't re-hit the network.
   ============================================================ */
RC.geocode = (function () {
  "use strict";

  var BASE = "https://nominatim.openstreetmap.org";

  // Every Nominatim call in the whole app funnels through this one queue,
  // so we never exceed ~1 request/second regardless of how many callers
  // (search box, reverse-lookup on map click, etc.) fire at once.
  var queue = RC.throttleQueue(1100);

  // query text (normalised) -> Promise<Place[]>   /   "lat,lon" -> Promise<Place>
  var cache = new Map();

  function normQuery(q) {
    return String(q).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function toPlace(row) {
    var display = row.display_name || "";
    var parts = display.split(",");
    var name = parts.slice(0, 2).join(",").trim();
    return {
      name: name || display,
      address: display,
      lat: parseFloat(row.lat),
      lon: parseFloat(row.lon),
      kind: row.type || row.class || ""
    };
  }

  // RC.geocode.search(query, {limit, near:{lat,lon}|null, signal}) -> Promise<Place[]>
  function search(query, opts) {
    opts = opts || {};
    var q = normQuery(query);
    if (!q) return Promise.resolve([]);

    var limit = opts.limit == null ? 6 : opts.limit;
    var cacheKey = "s:" + q + ":" + limit + ":" + (opts.near ? opts.near.lat + "," + opts.near.lon : "");
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    var url = BASE + "/search?format=jsonv2&q=" + encodeURIComponent(query) +
      "&limit=" + encodeURIComponent(limit) + "&addressdetails=1";

    // Bias (not restrict) results toward a location, e.g. the map centre,
    // using a small viewbox around it. bounded=0 keeps it a soft hint.
    if (opts.near && typeof opts.near.lat === "number" && typeof opts.near.lon === "number") {
      var d = 2; // degrees, roughly a country-scale box
      var left = opts.near.lon - d, right = opts.near.lon + d;
      var top = opts.near.lat + d, bottom = opts.near.lat - d;
      url += "&viewbox=" + left + "," + top + "," + right + "," + bottom + "&bounded=0";
    }

    var promise = queue(function () {
      return RC.jsonGet(url, { signal: opts.signal }).then(function (rows) {
        return (rows || []).map(toPlace);
      });
    });

    cache.set(cacheKey, promise);
    // Don't cache a failed lookup — let the next attempt retry.
    promise.catch(function () { cache.delete(cacheKey); });
    return promise;
  }

  // RC.geocode.reverse(lat, lon) -> Promise<Place>
  function reverse(lat, lon, opts) {
    opts = opts || {};
    var cacheKey = "r:" + lat + "," + lon;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    var url = BASE + "/reverse?format=jsonv2&lat=" + encodeURIComponent(lat) +
      "&lon=" + encodeURIComponent(lon) + "&zoom=14";

    var promise = queue(function () {
      return RC.jsonGet(url, { signal: opts.signal }).then(function (row) {
        if (!row || row.error) throw RC.error("No place found there.", "http");
        return toPlace(row);
      });
    });

    cache.set(cacheKey, promise);
    promise.catch(function () { cache.delete(cacheKey); });
    return promise;
  }

  return { search: search, reverse: reverse };
})();

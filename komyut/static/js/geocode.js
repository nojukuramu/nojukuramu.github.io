/* ============================================================
   TheCommuters — geocoding
   Lifted from routecast/static/js/geocode.js, namespace changed, with a
   Philippines-first bias added to the default search.

   Upstream: Nominatim (https://nominatim.openstreetmap.org), free and
   key-less. Its usage policy allows at most one request a second and no
   bulk loops, so every call in this app funnels through one shared
   throttle queue regardless of how many places want to search at once.
   ============================================================ */
var KM = KM || {};

KM.geocode = (function () {
  "use strict";

  var BASE = "https://nominatim.openstreetmap.org";
  var queue = KM.throttleQueue(1100);
  var cache = new Map();

  function normQuery(q) {
    return String(q).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function toPlace(row) {
    var display = row.display_name || "";
    var parts = display.split(",");
    var name = parts.slice(0, 2).join(",").trim();
    return {
      name: KM.sanitize.line(name || display, KM.sanitize.LIMITS.placeName),
      address: KM.sanitize.line(display, 200),
      lat: parseFloat(row.lat),
      lon: parseFloat(row.lon),
      kind: KM.sanitize.line(row.type || row.class || "", 40)
    };
  }

  /* search(query, {limit, near, countries, signal}) -> Promise<Place[]>
     `countries` is a soft narrowing, not a cage: pass null to search the
     whole planet, which is what the field does once somebody types a
     place that is plainly not local. */
  function search(query, opts) {
    opts = opts || {};
    var q = normQuery(query);
    if (!q) return Promise.resolve([]);

    var limit = opts.limit == null ? 6 : opts.limit;
    var countries = opts.countries === undefined ? null : opts.countries;
    var cacheKey = "s:" + q + ":" + limit + ":" + (countries || "") +
      ":" + (opts.near ? opts.near.lat.toFixed(2) + "," + opts.near.lon.toFixed(2) : "");
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    var url = BASE + "/search?format=jsonv2&q=" + encodeURIComponent(query) +
      "&limit=" + encodeURIComponent(limit) + "&addressdetails=1";
    if (countries) url += "&countrycodes=" + encodeURIComponent(countries);

    if (opts.near && typeof opts.near.lat === "number" && typeof opts.near.lon === "number") {
      var d = 2;
      url += "&viewbox=" + (opts.near.lon - d) + "," + (opts.near.lat + d) +
             "," + (opts.near.lon + d) + "," + (opts.near.lat - d) + "&bounded=0";
    }

    var promise = queue(function () {
      return KM.jsonGet(url, { signal: opts.signal }).then(function (rows) {
        return (rows || []).map(toPlace).filter(function (p) {
          return isFinite(p.lat) && isFinite(p.lon);
        });
      });
    });

    cache.set(cacheKey, promise);
    promise.catch(function () { cache.delete(cacheKey); });
    return promise;
  }

  /* reverse(lat, lon) -> Promise<Place>. Used to give a dropped pin a name
     so a stop in a route is not "14.5995, 120.9842" to everybody else. */
  function reverse(lat, lon, opts) {
    opts = opts || {};
    var cacheKey = "r:" + lat.toFixed(4) + "," + lon.toFixed(4);
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    var url = BASE + "/reverse?format=jsonv2&lat=" + encodeURIComponent(lat) +
      "&lon=" + encodeURIComponent(lon) + "&zoom=16";

    var promise = queue(function () {
      return KM.jsonGet(url, { signal: opts.signal }).then(function (row) {
        if (!row || row.error) throw KM.error("No place found there.", "http");
        return toPlace(row);
      });
    });

    cache.set(cacheKey, promise);
    promise.catch(function () { cache.delete(cacheKey); });
    return promise;
  }

  return { search: search, reverse: reverse };
})();

/* ============================================================
   RouteCast — weather
   Upstream: Open-Meteo forecast API — https://api.open-meteo.com/v1/forecast
   Free, key-less, no paid tier params. Batches multiple checkpoints into a
   single request via the `latitude=a,b,c&longitude=a,b,c` form (Open-Meteo
   allows up to ~20 locations per request); chunks of >20 are split into
   several requests run one after another (politeness, not a hard API limit).

   ------------------------------------------------------------------------
   RC.weather.forecastSeries(checkpoints, opts) -> Promise<Series>

     Fetches each checkpoint's full hourly forecast ONCE and keeps the raw
     parsed arrays around, so callers (the departure planner in risk.js, in
     particular) can re-evaluate arbitrary times against the same data with
     zero additional network requests.

     opts: { signal, marginHours=6, maxAgeMs=0 }
       marginHours pads forecast_days so offsets a few hours later than the
       checkpoints' own ETAs (as used by the departure planner) still land
       inside the fetched range.
       maxAgeMs>0 lets a checkpoint reuse an in-memory series fetched for a
       point in the same ~5 km grid cell less than maxAgeMs ago, provided it
       still covers the latest ETA asked for. 0 (the default, and what the
       Plan button uses) always goes to the network. RC.weather.clearCache()
       empties it.

     Series = {
       checkpoints: checkpoints,                 // the array passed in, unchanged
       perCheckpoint: [                           // one entry per checkpoint, same order/index
         {
           lat: number, lon: number,              // rounded coords actually queried
           times: [Date, ...],                    // ascending, parsed as UTC
           temperature_2m: [n,...], apparent_temperature: [n,...],
           precipitation: [n,...], precipitation_probability: [n,...],
           weather_code: [n,...], wind_speed_10m: [n,...], wind_gusts_10m: [n,...],
           relative_humidity_2m: [n,...], cloud_cover: [n,...],
           visibility: [n,...], is_day: [n,...]
         }, ...
       ],
       at: function(checkpointIndex, date) -> wx   // same sampling logic as sampleSeries()
     }

     Checkpoints whose rounded (4dp) coordinates match an earlier checkpoint
     reuse that checkpoint's fetched series (one network slot per unique
     location) — perCheckpoint[i] is simply a reference to the shared entry.

   RC.weather.forecast(checkpoints, opts) -> Promise<Checkpoint[]>
     Thin wrapper: fetches the series, stamps `.wx` (sampled at each
     checkpoint's own `.eta`) onto every checkpoint, and resolves with the
     same array (mutated in place, also returned for convenience).

   RC.weather.sampleSeries(series, checkpointIndex, date) -> wx
     Public standalone sampler so other modules (risk.js's bestDeparture)
     can evaluate any checkpoint at any date against an already-fetched
     Series. Identical to series.at(checkpointIndex, date).

   wx = {
     outOfRange: false, time: Date, tempC, feelsC, precipMm, precipProb,
     code, windKmh, gustKmh, humidity, cloud, visibilityM, isDay
   }
   or { outOfRange: true } when the requested date falls outside the
   fetched hourly range.

   RC.weather.describe(code, isDay) -> {text, icon}
     icon one of: clear, partly, cloud, fog, drizzle, rain, heavy-rain,
     snow, thunder. Covers the full WMO weather_code table Open-Meteo uses.
   ============================================================ */
(function () {
  "use strict";

  var BASE = "https://api.open-meteo.com/v1/forecast";
  var HOURLY_FIELDS = [
    "temperature_2m", "apparent_temperature", "precipitation",
    "precipitation_probability", "weather_code", "wind_speed_10m",
    "wind_gusts_10m", "relative_humidity_2m", "cloud_cover",
    "visibility", "is_day", "wind_direction_10m"
  ];
  var CHUNK = 20;

  /* ---- in-memory forecast cache (live navigation) ---------------------
     Live navigation re-reads the forecast for a moving set of checkpoints,
     and a reroute usually keeps most of the corridor it already fetched.
     Refetching every point every time would hammer Open-Meteo for data that
     barely changed, so parsed hourly series are kept in memory, keyed by a
     ~5 km grid cell (finer than Open-Meteo's own model grid, so two points
     sharing a cell genuinely share a forecast) and reused while they are
     younger than the caller's maxAgeMs *and* their hourly range still covers
     the time being asked about. Nothing is written to disk: the service
     worker still never caches a forecast, and a reload starts clean. */
  var CACHE_GRID_DEG = 0.05;   // ~5.5 km at the equator
  var CACHE_MAX = 400;         // entries; oldest quarter evicted when exceeded
  var cache = {};              // gridKey -> { entry, fetchedAt }
  var cacheCount = 0;

  function gridKey(lat, lon) {
    return Math.round(lat / CACHE_GRID_DEG) + "|" + Math.round(lon / CACHE_GRID_DEG);
  }

  function cacheGet(lat, lon, maxAgeMs, needEndMs) {
    var hit = cache[gridKey(lat, lon)];
    if (!hit) return null;
    if (Date.now() - hit.fetchedAt > maxAgeMs) return null;
    var times = hit.entry.times;
    if (!times || !times.length) return null;
    if (needEndMs && times[times.length - 1].getTime() < needEndMs) return null;
    return hit.entry;
  }

  function cachePut(lat, lon, entry) {
    var k = gridKey(lat, lon);
    if (!cache[k]) {
      cacheCount++;
      if (cacheCount > CACHE_MAX) {
        // Evict the oldest quarter in one pass rather than sorting on every put.
        var keys = Object.keys(cache);
        keys.sort(function (a, b) { return cache[a].fetchedAt - cache[b].fetchedAt; });
        var drop = keys.length >> 2;
        for (var i = 0; i < drop; i++) { delete cache[keys[i]]; cacheCount--; }
      }
    }
    cache[k] = { entry: entry, fetchedAt: Date.now() };
  }

  function clearCache() { cache = {}; cacheCount = 0; }

  function round4(n) { return Math.round(n * 10000) / 10000; }

  function coordKey(lat, lon) {
    return round4(lat).toFixed(4) + "," + round4(lon).toFixed(4);
  }

  /* Parse Open-Meteo's "YYYY-MM-DDTHH:mm" as UTC explicitly — never let the
     browser guess a local timezone for it. */
  function parseUtc(s) {
    return new Date(s + "Z");
  }

  function daysBetween(seconds) {
    return seconds / 86400;
  }

  /* forecast_days = ceil(span in days) + 1, clamped 1..16 */
  function computeForecastDays(checkpoints, marginHours) {
    var maxSeconds = 0;
    for (var i = 0; i < checkpoints.length; i++) {
      var s = checkpoints[i].etaSeconds || 0;
      if (s > maxSeconds) maxSeconds = s;
    }
    maxSeconds += (marginHours || 0) * 3600;
    var span = daysBetween(maxSeconds);
    var days = Math.ceil(span) + 1;
    return RC.clamp(days, 1, 16);
  }

  function buildUrl(coordList, forecastDays) {
    var lats = [], lons = [];
    for (var i = 0; i < coordList.length; i++) {
      lats.push(coordList[i].lat);
      lons.push(coordList[i].lon);
    }
    return BASE +
      "?latitude=" + lats.join(",") +
      "&longitude=" + lons.join(",") +
      "&hourly=" + HOURLY_FIELDS.join(",") +
      /* Sunrise and sunset, the way the home page asks for them — the same
         `daily` block, from the same request, so a ride's daylight costs
         nothing extra. With timezone=UTC they arrive as UTC instants. */
      "&daily=sunrise,sunset" +
      "&timezone=UTC&forecast_days=" + forecastDays +
      "&wind_speed_unit=kmh&precipitation_unit=mm";
  }

  /* Normalise Open-Meteo's response: an ARRAY of location objects when
     multiple locations were requested, a bare OBJECT for a single one. */
  function normaliseResponse(json, count) {
    if (Array.isArray(json)) return json;
    return [json];
  }

  function parseHourly(entry) {
    var h = entry.hourly || {};
    var times = (h.time || []).map(parseUtc);
    var out = {
      lat: entry.latitude, lon: entry.longitude,
      times: times,
      sun: parseSun(entry.daily)
    };
    for (var i = 0; i < HOURLY_FIELDS.length; i++) {
      var f = HOURLY_FIELDS[i];
      out[f] = h[f] || [];
    }
    return out;
  }

  /* Every sunrise and sunset in the fetched range as one timeline of
     events, oldest first. Which UTC day each belongs to is irrelevant — the
     question is always "what was the last thing the sun did before this
     instant", and a flat list answers that without caring where midnight
     fell. */
  function parseSun(daily) {
    var ev = [];
    if (!daily) return ev;
    var up = daily.sunrise || [], down = daily.sunset || [];
    for (var i = 0; i < up.length; i++) if (up[i]) ev.push({ t: parseUtc(up[i]).getTime(), up: true });
    for (var j = 0; j < down.length; j++) if (down[j]) ev.push({ t: parseUtc(down[j]).getTime(), up: false });
    ev = ev.filter(function (e) { return !isNaN(e.t); });
    ev.sort(function (a, b) { return a.t - b.t; });
    return ev;
  }

  /* { dark, next: { at, kind } } at `date`, from an entry's sun timeline.
     dark is null when the timeline does not reach back that far — the
     caller falls back to the hourly is_day flag rather than guessing. */
  function sunAt(entry, date) {
    var ev = entry && entry.sun;
    if (!ev || !ev.length) return { dark: null, next: null };
    var t = date.getTime();
    var before = null, after = null;
    for (var i = 0; i < ev.length; i++) {
      if (ev[i].t <= t) before = ev[i];
      else { after = ev[i]; break; }
    }
    return {
      dark: before ? !before.up : (after ? after.up : null),
      next: after ? { at: new Date(after.t), kind: after.up ? "sunrise" : "sunset" } : null
    };
  }

  /* Fetch one chunk (<=20 unique coords) and return parsed entries keyed
     by coordKey, in the same order the coords were requested. */
  function fetchChunk(coordList, forecastDays, signal) {
    var url = buildUrl(coordList, forecastDays);
    return RC.jsonGet(url, { signal: signal, timeout: 20000, retries: 1 })
      .then(function (json) {
        var entries = normaliseResponse(json, coordList.length);
        var byKey = {};
        for (var i = 0; i < coordList.length; i++) {
          var e = entries[i];
          if (!e) continue;
          byKey[coordList[i].key] = parseHourly(e);
        }
        return byKey;
      });
  }

  /* Find the pair of indices [lo, hi] in an ascending times[] array that
     bracket `date`. Returns null if date is outside [times[0], times[last]]. */
  function bracket(times, date) {
    var t = date.getTime();
    var n = times.length;
    if (n === 0) return null;
    if (t < times[0].getTime() || t > times[n - 1].getTime()) return null;
    // binary search for the first index whose time is >= t
    var lo = 0, hi = n - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (times[mid].getTime() < t) lo = mid + 1; else hi = mid;
    }
    if (times[lo].getTime() === t) return { i0: lo, i1: lo, frac: 0 };
    var i1 = lo, i0 = lo - 1;
    if (i0 < 0) return { i0: 0, i1: 0, frac: 0 };
    var t0 = times[i0].getTime(), t1 = times[i1].getTime();
    var frac = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    return { i0: i0, i1: i1, frac: frac };
  }

  function lerp(a, b, frac) { return a + (b - a) * frac; }

  /* Wind direction is an angle, and the average of 350 and 10 is 0, not
     180. Interpolated on the shortest arc, like every other bearing here. */
  function lerpAngle(a, b, frac) {
    if (typeof a !== "number" || isNaN(a)) return typeof b === "number" && !isNaN(b) ? b : null;
    if (typeof b !== "number" || isNaN(b)) return a;
    var d = ((b - a) % 360 + 540) % 360 - 180;
    return ((a + d * frac) % 360 + 360) % 360;
  }

  function sampleEntry(entry, date) {
    var br = bracket(entry.times, date);
    if (!br) return { outOfRange: true };
    var i0 = br.i0, i1 = br.i1, frac = br.frac;
    var nearest = frac < 0.5 ? i0 : i1;

    return {
      outOfRange: false,
      time: date,
      tempC: lerp(entry.temperature_2m[i0], entry.temperature_2m[i1], frac),
      feelsC: lerp(entry.apparent_temperature[i0], entry.apparent_temperature[i1], frac),
      precipMm: lerp(entry.precipitation[i0], entry.precipitation[i1], frac),
      precipProb: lerp(entry.precipitation_probability[i0], entry.precipitation_probability[i1], frac),
      code: entry.weather_code[nearest],
      windKmh: lerp(entry.wind_speed_10m[i0], entry.wind_speed_10m[i1], frac),
      gustKmh: lerp(entry.wind_gusts_10m[i0], entry.wind_gusts_10m[i1], frac),
      humidity: lerp(entry.relative_humidity_2m[i0], entry.relative_humidity_2m[i1], frac),
      cloud: lerp(entry.cloud_cover[i0], entry.cloud_cover[i1], frac),
      visibilityM: lerp(entry.visibility[i0], entry.visibility[i1], frac),
      isDay: !!entry.is_day[nearest],
      // Where the wind blows FROM, degrees clockwise from north — the
      // meteorological convention. Null where the series has none.
      windDir: entry.wind_direction_10m && entry.wind_direction_10m.length
        ? lerpAngle(entry.wind_direction_10m[i0], entry.wind_direction_10m[i1], frac) : null
    };
  }

  /* The first hour at or after `date` with rain worth mentioning, within
     `hours`, at one location: { now: bool, at: Date|null }. Read off the
     series already in memory, so "rain in forty minutes" costs nothing. */
  function nextRain(entry, date, hours, thresholdMm) {
    var out = { now: false, at: null };
    if (!entry || !entry.times || !entry.times.length) return out;
    var mm = thresholdMm == null ? 0.3 : thresholdMm;
    var cur = sampleEntry(entry, date);
    if (!cur.outOfRange && cur.precipMm >= mm) { out.now = true; out.at = date; return out; }
    var t0 = date.getTime(), t1 = t0 + (hours || 6) * 3600000;
    for (var i = 0; i < entry.times.length; i++) {
      var t = entry.times[i].getTime();
      if (t <= t0) continue;
      if (t > t1) break;
      if ((entry.precipitation[i] || 0) >= mm) {
        /* The hourly figure is the hour ENDING at that timestamp, so the rain
           is under way by half past the previous one — say that, not the
           top of the hour, or "rain in 50 minutes" arrives wet. */
        out.at = new Date(Math.max(t0, t - 30 * 60000));
        return out;
      }
    }
    return out;
  }

  function forecastSeries(checkpoints, opts) {
    opts = opts || {};
    var signal = opts.signal;
    var marginHours = opts.marginHours == null ? 6 : opts.marginHours;
    var forecastDays = computeForecastDays(checkpoints, marginHours);

    // maxAgeMs 0 (the default, and what the Plan button uses) bypasses the
    // cache entirely, so planning a trip always fetches fresh data. Live
    // navigation passes a TTL and pays for the network only on a miss.
    var maxAgeMs = opts.maxAgeMs == null ? 0 : opts.maxAgeMs;
    var needEndMs = 0;
    for (var e = 0; e < checkpoints.length; e++) {
      var et = checkpoints[e].eta ? checkpoints[e].eta.getTime() : 0;
      if (et > needEndMs) needEndMs = et;
    }

    // de-duplicate identical rounded coordinates
    var uniqueByKey = {};
    var uniqueList = [];
    var resultsByKey = {};
    for (var i = 0; i < checkpoints.length; i++) {
      var cp = checkpoints[i];
      var key = coordKey(cp.lat, cp.lon);
      if (!uniqueByKey[key]) {
        uniqueByKey[key] = true;
        var cached = maxAgeMs > 0 ? cacheGet(cp.lat, cp.lon, maxAgeMs, needEndMs) : null;
        if (cached) resultsByKey[key] = cached;
        else uniqueList.push({ key: key, lat: round4(cp.lat), lon: round4(cp.lon) });
      }
    }

    // split into chunks of <= 20 and run sequentially (politeness)
    var chunks = [];
    for (var c = 0; c < uniqueList.length; c += CHUNK) {
      chunks.push(uniqueList.slice(c, c + CHUNK));
    }

    var chain = Promise.resolve();
    chunks.forEach(function (chunk) {
      chain = chain.then(function () {
        return fetchChunk(chunk, forecastDays, signal);
      }).then(function (byKey) {
        for (var k in byKey) {
          if (!byKey.hasOwnProperty(k)) continue;
          resultsByKey[k] = byKey[k];
          cachePut(byKey[k].lat, byKey[k].lon, byKey[k]);
        }
      });
    });

    return chain.then(function () {
      var perCheckpoint = [];
      for (var i = 0; i < checkpoints.length; i++) {
        var key = coordKey(checkpoints[i].lat, checkpoints[i].lon);
        perCheckpoint.push(resultsByKey[key] || { lat: checkpoints[i].lat, lon: checkpoints[i].lon, times: [] });
      }

      var series = {
        checkpoints: checkpoints,
        perCheckpoint: perCheckpoint,
        at: function (checkpointIndex, date) {
          var entry = perCheckpoint[checkpointIndex];
          if (!entry) return { outOfRange: true };
          return sampleEntry(entry, date);
        },
        sun: function (checkpointIndex, date) {
          return sunAt(perCheckpoint[checkpointIndex], date);
        },
        rain: function (checkpointIndex, date, hours) {
          return nextRain(perCheckpoint[checkpointIndex], date, hours);
        }
      };
      return series;
    });
  }

  function forecast(checkpoints, opts) {
    return forecastSeries(checkpoints, opts).then(function (series) {
      for (var i = 0; i < checkpoints.length; i++) {
        checkpoints[i].wx = series.at(i, checkpoints[i].eta);
      }
      return checkpoints;
    });
  }

  function sampleSeriesFn(series, checkpointIndex, date) {
    return series.at(checkpointIndex, date);
  }

  /* Full WMO weather_code table, day/night aware where it matters
     (clear / mainly clear / partly cloudy only — the rest read the same
     text regardless of time of day). */
  var CODES = {
    0: { day: "Clear sky", night: "Clear night", icon: "clear" },
    1: { day: "Mainly clear", night: "Mostly clear night", icon: "clear" },
    2: { day: "Partly cloudy", night: "Partly cloudy night", icon: "partly" },
    3: { day: "Overcast", night: "Overcast", icon: "cloud" },
    45: { day: "Fog", night: "Fog", icon: "fog" },
    48: { day: "Rime fog", night: "Rime fog", icon: "fog" },
    51: { day: "Light drizzle", night: "Light drizzle", icon: "drizzle" },
    53: { day: "Drizzle", night: "Drizzle", icon: "drizzle" },
    55: { day: "Dense drizzle", night: "Dense drizzle", icon: "drizzle" },
    56: { day: "Light freezing drizzle", night: "Light freezing drizzle", icon: "drizzle" },
    57: { day: "Freezing drizzle", night: "Freezing drizzle", icon: "drizzle" },
    61: { day: "Light rain", night: "Light rain", icon: "rain" },
    63: { day: "Rain", night: "Rain", icon: "rain" },
    65: { day: "Heavy rain", night: "Heavy rain", icon: "heavy-rain" },
    66: { day: "Freezing rain", night: "Freezing rain", icon: "rain" },
    67: { day: "Heavy freezing rain", night: "Heavy freezing rain", icon: "heavy-rain" },
    71: { day: "Light snow", night: "Light snow", icon: "snow" },
    73: { day: "Snow", night: "Snow", icon: "snow" },
    75: { day: "Heavy snow", night: "Heavy snow", icon: "snow" },
    77: { day: "Snow grains", night: "Snow grains", icon: "snow" },
    80: { day: "Light showers", night: "Light showers", icon: "rain" },
    81: { day: "Showers", night: "Showers", icon: "rain" },
    82: { day: "Heavy showers", night: "Heavy showers", icon: "heavy-rain" },
    85: { day: "Snow showers", night: "Snow showers", icon: "snow" },
    86: { day: "Heavy snow showers", night: "Heavy snow showers", icon: "snow" },
    95: { day: "Thunderstorm", night: "Thunderstorm", icon: "thunder" },
    96: { day: "Thunderstorm with hail", night: "Thunderstorm with hail", icon: "thunder" },
    99: { day: "Severe thunderstorm with hail", night: "Severe thunderstorm with hail", icon: "thunder" }
  };

  function describe(code, isDay) {
    var entry = CODES[code];
    if (!entry) return { text: "Unknown", icon: "cloud" };
    return { text: isDay ? entry.day : entry.night, icon: entry.icon };
  }

  RC.weather = {
    forecastSeries: forecastSeries,
    clearCache: clearCache,
    forecast: forecast,
    sampleSeries: sampleSeriesFn,
    describe: describe,
    // Exposed for the harness, and for anything holding a series of its own.
    _parseSun: parseSun,
    _sunAt: sunAt,
    _nextRain: nextRain,
    _lerpAngle: lerpAngle
  };
})();

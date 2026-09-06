/* ============================================================
   nojukuramu — the real sky
   Upstream: Open-Meteo — https://api.open-meteo.com/v1/forecast
   Free, key-less, no account, the same service RouteCast uses.

   This is what lets the drawn sunset agree with the one outside the
   window: where you are, what the weather is doing, how much of the moon
   is lit, and how far through its own day the sun actually is.

   Nothing is sent anywhere until you ask for it. Coordinates are rounded
   to two decimals (~1 km) before they leave the page, the answer is cached
   in localStorage for twenty minutes, and every failure is silent — the
   scene simply carries on running off the scroll, which is what it does
   when this file never loads at all.

   NJ.weather.load()      resume a permission already granted, else nothing
   NJ.weather.request()   ask for location now (needs a click; browsers
                          refuse a geolocation prompt without one)
   NJ.weather.forget()    drop the coordinates and the cached forecast
   NJ.weather.onchange(f) f(state) on every change, including null
   NJ.weather.state       the current reading, or null

   state = {
     place: "14.60, 121.00",  lat, lon,
     code, icon, text,        // WMO code and RouteCast's own naming
     cloud: 0..1, wind: km/h, precip: mm, temp: °C, isDay: bool,
     sunrise: Date, sunset: Date, now: Date,   // all in the place's own zone
     dayT: 0..1,              // 0 = golden hour, 1 = deep night, from the sun
     moon: { phase: 0..1, lit: 0..1, name: "Waxing gibbous" },
     at: Date                 // when this was fetched
   }
   ============================================================ */
(function (global) {
  "use strict";

  var NJ = (global.NJ = global.NJ || {});

  var BASE = "https://api.open-meteo.com/v1/forecast";
  var GEO_KEY = "sky.geo";
  var WX_KEY = "sky.wx";
  var MAX_AGE = 20 * 60 * 1000;

  /* RouteCast's table, trimmed to what the sky needs to draw. */
  var CODES = {
    0:  ["Clear sky", "clear"],        1:  ["Mainly clear", "clear"],
    2:  ["Partly cloudy", "partly"],   3:  ["Overcast", "cloud"],
    45: ["Fog", "fog"],                48: ["Rime fog", "fog"],
    51: ["Light drizzle", "drizzle"],  53: ["Drizzle", "drizzle"],
    55: ["Dense drizzle", "drizzle"],  56: ["Freezing drizzle", "drizzle"],
    57: ["Freezing drizzle", "drizzle"],
    61: ["Light rain", "rain"],        63: ["Rain", "rain"],
    65: ["Heavy rain", "heavy-rain"],  66: ["Freezing rain", "rain"],
    67: ["Heavy freezing rain", "heavy-rain"],
    71: ["Light snow", "snow"],        73: ["Snow", "snow"],
    75: ["Heavy snow", "snow"],        77: ["Snow grains", "snow"],
    80: ["Light showers", "rain"],     81: ["Showers", "rain"],
    82: ["Heavy showers", "heavy-rain"],
    85: ["Snow showers", "snow"],      86: ["Heavy snow showers", "snow"],
    95: ["Thunderstorm", "thunder"],   96: ["Thunderstorm with hail", "thunder"],
    99: ["Severe thunderstorm", "thunder"]
  };

  var listeners = [];
  var api = { state: null };

  function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](api.state); } catch (e) {} } }
  api.onchange = function (fn) { listeners.push(fn); if (api.state) { try { fn(api.state); } catch (e) {} } };

  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function recall(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }

  /* ---------- the moon, worked out rather than fetched ----------
     No free forecast API carries the phase, and it does not need one: the
     synodic month is regular enough that counting from a known new moon is
     accurate to a few hours, which is far finer than "how lit do I draw
     this disc". Epoch: the new moon of 2000-01-06 18:14 UTC. */
  var SYNODIC = 29.530588853;
  var NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0);

  function moonPhase(date) {
    var days = (date.getTime() - NEW_MOON) / 86400000;
    var phase = (days / SYNODIC) % 1;
    if (phase < 0) phase += 1;
    /* Illuminated fraction of the disc, 0 at new and 1 at full. */
    var lit = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
    var NAMES = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous",
                 "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];
    var idx = Math.floor(phase * 8 + 0.5) % 8;
    return { phase: phase, lit: lit, name: NAMES[idx] };
  }
  api.moonPhase = moonPhase;

  /* ---------- where the sun actually is, as our one scene number ----------
     The scene draws an evening, so a real reading is mapped onto it rather
     than pretending to be a full 24 hours: broad daylight parks at the top
     of the evening, the hour around sunset walks through it, and the small
     hours sit at the bottom. Scrolling then runs forward from wherever that
     lands, so an afternoon visit still gets the whole sunset. */
  function solarT(now, sunrise, sunset) {
    if (!sunrise || !sunset) return 0;
    var ms = now.getTime(), up = sunrise.getTime(), down = sunset.getTime();
    var HOUR = 3600000;
    if (ms < up - HOUR) return 1;                                   /* small hours */
    if (ms < up + HOUR * 0.6) return clamp(1 - (ms - (up - HOUR)) / (HOUR * 1.6), 0, 1);  /* dawn, running backwards */
    if (ms < down - HOUR * 2) return 0;                             /* daylight */
    if (ms < down) return clamp((ms - (down - HOUR * 2)) / (HOUR * 2), 0, 1) * 0.45;
    return clamp(0.45 + (ms - down) / (HOUR * 1.6) * 0.55, 0, 1);   /* the evening itself */
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /* ---------- fetch ---------- */
  function url(lat, lon) {
    return BASE +
      "?latitude=" + lat + "&longitude=" + lon +
      "&current=temperature_2m,weather_code,cloud_cover,wind_speed_10m,precipitation,is_day" +
      "&daily=sunrise,sunset" +
      "&timezone=auto&forecast_days=1" +
      "&wind_speed_unit=kmh&precipitation_unit=mm";
  }

  /* Open-Meteo returns local wall-clock strings with `timezone=auto` and no
     offset on them, so they are read as local-to-the-place and compared
     against a `now` built the same way. Mixing one of these with a real UTC
     instant is the classic way to get a sunset an hour out. */
  function parseLocal(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  }

  function build(json, lat, lon) {
    var c = json.current || {};
    var d = json.daily || {};
    var code = c.weather_code | 0;
    var entry = CODES[code] || ["Unknown", "cloud"];
    var offset = (json.utc_offset_seconds || 0) * 1000;
    var now = new Date(Date.now() + offset);          /* the place's wall clock */
    var sunrise = parseLocal(d.sunrise && d.sunrise[0]);
    var sunset = parseLocal(d.sunset && d.sunset[0]);

    return {
      place: lat.toFixed(2) + ", " + lon.toFixed(2),
      lat: lat, lon: lon,
      code: code, text: entry[0], icon: entry[1],
      cloud: clamp((c.cloud_cover == null ? 0 : c.cloud_cover) / 100, 0, 1),
      wind: c.wind_speed_10m == null ? 0 : c.wind_speed_10m,
      precip: c.precipitation == null ? 0 : c.precipitation,
      temp: c.temperature_2m,
      isDay: c.is_day === 1,
      sunrise: sunrise, sunset: sunset, now: now,
      dayT: solarT(now, sunrise, sunset),
      moon: moonPhase(new Date()),
      at: new Date()
    };
  }

  function fetchAt(lat, lon) {
    lat = Math.round(lat * 100) / 100;
    lon = Math.round(lon * 100) / 100;
    return fetch(url(lat, lon), { mode: "cors" })
      .then(function (r) { if (!r.ok) throw new Error("weather " + r.status); return r.json(); })
      .then(function (json) {
        var s = build(json, lat, lon);
        api.state = s;
        store(WX_KEY, { lat: lat, lon: lon, ts: Date.now(), json: json });
        emit();
        return s;
      });
  }

  function position(opts) {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject(new Error("no geolocation"));
      navigator.geolocation.getCurrentPosition(
        function (p) { resolve(p.coords); },
        reject,
        opts || { enableHighAccuracy: false, timeout: 12000, maximumAge: 30 * 60 * 1000 }
      );
    });
  }

  /* An explicit ask. Browsers will not raise the permission prompt outside a
     user gesture, so this is only ever called from a click. */
  api.request = function () {
    return position().then(function (c) {
      store(GEO_KEY, { lat: c.latitude, lon: c.longitude, ts: Date.now() });
      return fetchAt(c.latitude, c.longitude);
    });
  };

  /* Resume without prompting: a forecast still warm in storage, else the
     saved coordinates, else — only if the browser says the permission is
     already granted — a fresh fix. Someone who has never said yes is never
     asked by this path. */
  api.load = function () {
    var cached = recall(WX_KEY);
    if (cached && cached.json && Date.now() - cached.ts < MAX_AGE) {
      api.state = build(cached.json, cached.lat, cached.lon);
      emit();
      return Promise.resolve(api.state);
    }
    var geo = recall(GEO_KEY);
    if (geo && typeof geo.lat === "number") {
      return fetchAt(geo.lat, geo.lon).catch(function () { return null; });
    }
    if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve(null);
    return navigator.permissions.query({ name: "geolocation" })
      .then(function (st) {
        if (st.state !== "granted") return null;
        return api.request();
      })
      .catch(function () { return null; });
  };

  api.forget = function () {
    try { localStorage.removeItem(GEO_KEY); localStorage.removeItem(WX_KEY); } catch (e) {}
    api.state = null;
    emit();
  };

  /* Used by the demo commands in the palette, and by the screenshot tests. */
  api.pretend = function (partial) {
    var base = api.state || {
      place: "somewhere", lat: 0, lon: 0, code: 0, text: "Clear sky", icon: "clear",
      cloud: 0, wind: 6, precip: 0, temp: 24, isDay: true,
      sunrise: null, sunset: null, now: new Date(), dayT: 0,
      moon: moonPhase(new Date()), at: new Date()
    };
    var s = {};
    for (var k in base) if (Object.prototype.hasOwnProperty.call(base, k)) s[k] = base[k];
    for (var j in partial) if (Object.prototype.hasOwnProperty.call(partial, j)) s[j] = partial[j];
    if (partial.code != null) {
      var e = CODES[partial.code] || ["Unknown", "cloud"];
      s.text = e[0]; s.icon = e[1];
    }
    api.state = s;
    emit();
    return s;
  };

  NJ.weather = api;
})(window);

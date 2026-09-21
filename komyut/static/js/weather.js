/* ============================================================
   KomyutApp — the weather waiting along the line

   The same idea RouteCast is built on, applied to a commute rather than a
   drive: a route is broken into checkpoints, each checkpoint is given the
   hour you will actually reach it, and the forecast is read for that place
   at that hour. The point on a jeepney route is not "will it rain today" —
   it is whether the twenty minutes you spend standing at the transfer are
   the twenty minutes the squall arrives.

   Upstream: Open-Meteo (https://api.open-meteo.com/v1/forecast), free and
   key-less. Several checkpoints go in one request using the
   `latitude=a,b,c&longitude=a,b,c` form, which the API supports for up to
   about twenty locations; more than that is split into consecutive
   requests rather than fired in parallel, as politeness to a free service.

   This is a leaner cousin of routecast/static/js/weather.js: same upstream,
   same WMO code table, same sampling rule, but without the departure
   planner's requirement to keep every raw hourly series alive for
   re-scoring. A commute is not a thing you shift by three hours.
   ============================================================ */
var KM = KM || {};

KM.weather = (function () {
  "use strict";

  var BASE = "https://api.open-meteo.com/v1/forecast";
  var HOURLY = [
    "temperature_2m", "apparent_temperature", "precipitation",
    "precipitation_probability", "weather_code", "wind_speed_10m",
    "wind_gusts_10m", "relative_humidity_2m", "is_day"
  ];
  var CHUNK = 20;

  function round3(n) { return Math.round(n * 1000) / 1000; }

  /* Open-Meteo returns local-to-the-point times without a zone when asked
     for `timezone=auto`, which is ambiguous to parse. Asking for UTC and
     converting here is unambiguous, and every ETA in this app is already a
     real Date. */
  function parseUtc(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s));
    if (!m) return new Date(NaN);
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  }

  function fetchChunk(points, days, signal) {
    var url = BASE +
      "?latitude=" + points.map(function (p) { return round3(p.lat); }).join(",") +
      "&longitude=" + points.map(function (p) { return round3(p.lon); }).join(",") +
      "&hourly=" + HOURLY.join(",") +
      "&timezone=UTC&forecast_days=" + days;

    return KM.jsonGet(url, { signal: signal, timeout: 20000 }).then(function (body) {
      /* One location comes back as an object, several as an array. */
      var list = Array.isArray(body) ? body : [body];
      return list.map(function (entry) {
        var h = (entry && entry.hourly) || {};
        var times = (h.time || []).map(parseUtc);
        var series = { times: times };
        HOURLY.forEach(function (f) { series[f] = h[f] || []; });
        return series;
      });
    });
  }

  /* The forecast at a moment, by taking the nearer of the two surrounding
     hours rather than interpolating. Interpolating a WMO weather code
     produces a code that does not exist; interpolating a temperature to
     make it disagree with the code it is shown beside is worse than
     rounding to the nearest hour. */
  function sample(series, when) {
    var times = series && series.times;
    if (!times || !times.length) return { outOfRange: true };
    var t = when.getTime();
    if (t < times[0].getTime() - 3600000 || t > times[times.length - 1].getTime() + 3600000) {
      return { outOfRange: true };
    }
    var best = 0, bestGap = Infinity;
    for (var i = 0; i < times.length; i++) {
      var gap = Math.abs(times[i].getTime() - t);
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    function at(f) { var v = series[f] && series[f][best]; return typeof v === "number" ? v : null; }
    return {
      outOfRange: false,
      time: times[best],
      tempC: at("temperature_2m"),
      feelsC: at("apparent_temperature"),
      precipMm: at("precipitation"),
      precipProb: at("precipitation_probability"),
      code: at("weather_code"),
      windKmh: at("wind_speed_10m"),
      gustKmh: at("wind_gusts_10m"),
      humidity: at("relative_humidity_2m"),
      isDay: at("is_day")
    };
  }

  /* forecast(checkpoints, {signal}) -> Promise<checkpoints>
     checkpoints: [{lat, lon, eta: Date}, ...]. Each gets `.wx` stamped on
     it and the same array comes back. Checkpoints within about a hundred
     metres of one already asked about share its answer, so a dense sample
     along a short route is still one location. */
  function forecast(checkpoints, opts) {
    opts = opts || {};
    if (!checkpoints || !checkpoints.length) return Promise.resolve([]);

    var unique = [], keyed = {};
    checkpoints.forEach(function (c) {
      var k = round3(c.lat) + "," + round3(c.lon);
      if (keyed[k] === undefined) { keyed[k] = unique.length; unique.push({ lat: c.lat, lon: c.lon }); }
      c._wxSlot = keyed[k];
    });

    /* How many days of forecast to ask for: enough to cover the latest ETA,
       plus a day of margin, and never more than Open-Meteo's sixteen. */
    var latest = checkpoints.reduce(function (m, c) {
      var t = c.eta ? c.eta.getTime() : Date.now();
      return t > m ? t : m;
    }, Date.now());
    var days = KM.clamp(Math.ceil((latest - Date.now()) / 86400000) + 2, 2, 16);

    var chunks = [];
    for (var i = 0; i < unique.length; i += CHUNK) chunks.push(unique.slice(i, i + CHUNK));

    var all = [];
    var chain = Promise.resolve();
    chunks.forEach(function (chunk) {
      chain = chain.then(function () {
        return fetchChunk(chunk, days, opts.signal).then(function (rows) {
          all = all.concat(rows);
        });
      });
    });

    return chain.then(function () {
      checkpoints.forEach(function (c) {
        var series = all[c._wxSlot];
        c.wx = series ? sample(series, c.eta || new Date()) : { outOfRange: true };
        delete c._wxSlot;
      });
      return checkpoints;
    });
  }

  /* ---------------------------------------------------------
     The WMO code table Open-Meteo uses, in full. `icon` names match
     KM.icons.weather().
     --------------------------------------------------------- */
  function describe(code, isDay) {
    var c = Number(code);
    var day = isDay === undefined ? 1 : isDay;
    if (c === 0) return { text: day ? "Clear" : "Clear night", icon: "clear" };
    if (c === 1) return { text: "Mostly clear", icon: "partly" };
    if (c === 2) return { text: "Partly cloudy", icon: "partly" };
    if (c === 3) return { text: "Overcast", icon: "cloud" };
    if (c === 45 || c === 48) return { text: "Fog", icon: "fog" };
    if (c >= 51 && c <= 57) return { text: "Drizzle", icon: "drizzle" };
    if (c === 61) return { text: "Light rain", icon: "rain" };
    if (c === 63) return { text: "Rain", icon: "rain" };
    if (c === 65) return { text: "Heavy rain", icon: "heavy-rain" };
    if (c === 66 || c === 67) return { text: "Freezing rain", icon: "heavy-rain" };
    if (c >= 71 && c <= 77) return { text: "Snow", icon: "snow" };
    if (c === 80) return { text: "Light showers", icon: "rain" };
    if (c === 81) return { text: "Showers", icon: "rain" };
    if (c === 82) return { text: "Violent showers", icon: "heavy-rain" };
    if (c === 85 || c === 86) return { text: "Snow showers", icon: "snow" };
    if (c === 95) return { text: "Thunderstorm", icon: "thunder" };
    if (c === 96 || c === 99) return { text: "Storm with hail", icon: "thunder" };
    return { text: "Unknown", icon: "cloud" };
  }

  /* How much this weather matters to somebody standing at a stop or riding
     with the windows open. Four bands, the same vocabulary RouteCast uses,
     because a commuter and a rider are worried about the same sky.

     The weighting is not a driver's: a jeepney passenger does not care
     about aquaplaning, and does care a great deal about standing in it. */
  function severity(wx) {
    if (!wx || wx.outOfRange) return { level: 0, id: "unknown", label: "No forecast" };
    var score = 0;
    var mm = wx.precipMm || 0;
    var prob = wx.precipProb || 0;
    var code = wx.code;

    if (mm >= 7) score += 3;
    else if (mm >= 2.5) score += 2;
    else if (mm >= 0.4) score += 1;
    if (prob >= 70 && mm < 0.4) score += 1;

    if (code === 95 || code === 96 || code === 99) score += 3;
    if (code === 45 || code === 48) score += 1;

    if ((wx.gustKmh || 0) >= 55) score += 2;
    else if ((wx.gustKmh || 0) >= 38) score += 1;

    /* Heat is the one a Manila commute actually meets most days. */
    var feels = wx.feelsC == null ? wx.tempC : wx.feelsC;
    if (feels != null) {
      if (feels >= 41) score += 3;
      else if (feels >= 37) score += 2;
      else if (feels >= 33) score += 1;
    }

    if (score >= 5) return { level: 3, id: "severe", label: "Rough" };
    if (score >= 3) return { level: 2, id: "caution", label: "Take care" };
    if (score >= 1) return { level: 1, id: "watch", label: "Keep an eye out" };
    return { level: 0, id: "clear", label: "Fine" };
  }

  return {
    forecast: forecast,
    sample: sample,
    describe: describe,
    severity: severity
  };
})();

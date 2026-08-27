/* ============================================================
   RouteCast — risk
   Turns a `wx` sample (see weather.js) into a rider/driver-facing risk
   verdict. No network calls of its own — everything here is pure
   arithmetic over data weather.js already fetched.

   ------------------------------------------------------------------------
   RC.risk.score(wx, vehicle) -> {level, score, reasons, advice}
     vehicle: 'car' | 'motorcycle'
     level:   'clear' | 'watch' | 'caution' | 'danger'
     score:   0..100, higher = worse
     reasons: short strings naming what's driving the score, with the
              actual observed number interpolated in (never generic filler)
     advice:  short actionable strings

   RC.risk.trip(checkpoints, vehicle) -> {level, score, worst, reasons,
                                           advice, rainMinutes}
     Scores every checkpoint that has a `.wx`, picks the worst one (highest
     score; outOfRange checkpoints are skipped), and reports its
     level/score/reasons/advice as the trip's headline verdict.
     rainMinutes: walks consecutive checkpoint pairs, attributes each pair's
     travel-time gap (etaSeconds[i+1] - etaSeconds[i]) to that leg of the
     trip, and sums the legs whose average precipitation is meaningful
     (>= 0.1 mm/h) — i.e. "minutes spent riding/driving through rain",
     estimated from the share of total trip duration each leg represents.

   RC.risk.LEVELS = { clear, watch, caution, danger } — label + CSS var
   name per the site's risk colour palette.

   ------------------------------------------------------------------------
   RC.risk.bestDeparture(route, baseDate, vehicle, forecastFn)
     -> Promise<[{offsetH, level, score, eta}, ...]>

     Evaluates offsets [-3..+6] hours against data already fetched by
     weather.js — it makes NO new network requests. Because this module
     only receives the OSRM `route` (coords/cumDist/cumDur), not the
     original checkpoint list or its Series, the caller supplies a
     `forecastFn` closure that already has both in scope:

       forecastFn(distanceMeters, date) -> wx

     `distanceMeters` is a distance-along-the-route value (metres from the
     start, i.e. a value out of route.cumDist); the caller is expected to
     resolve it to whichever already-fetched checkpoint is nearest that
     distance and sample its Series at `date`, e.g.:

       var series = <the Series from RC.weather.forecastSeries(checkpoints)>;
       function forecastFn(distanceMeters, date) {
         var idx = nearestCheckpointIndexByDistance(checkpoints, distanceMeters);
         return RC.weather.sampleSeries(series, idx, date);
       }

     Internally bestDeparture picks a handful of evenly-spaced points along
     route.cumDist (start, ~20/40/60/80% marks, end — capped at 6 points so
     re-evaluating 10 offsets stays cheap), re-derives each point's ETA at
     the shifted departure time from route.cumDur, samples forecastFn at
     each, scores the worst of them, and returns one entry per offset,
     sorted by offsetH. `eta` in each result is the shifted arrival time
     for the *whole trip* (departAt + total route duration).
   ============================================================ */
(function () {
  "use strict";

  var LEVELS = {
    clear: { label: "Clear", color: "--rc-clear" },
    watch: { label: "Watch", color: "--rc-watch" },
    caution: { label: "Caution", color: "--rc-caution" },
    danger: { label: "Danger", color: "--rc-danger" }
  };
  var LEVEL_ORDER = ["clear", "watch", "caution", "danger"];

  function rank(level) { return LEVEL_ORDER.indexOf(level); }

  function levelFromScore(score) {
    if (score >= 75) return "danger";
    if (score >= 50) return "caution";
    if (score >= 25) return "watch";
    return "clear";
  }

  var THUNDER_CODES = { 95: 1, 96: 1, 99: 1 };
  var ICE_CODES = { 56: 1, 57: 1, 66: 1, 67: 1, 96: 1, 99: 1 };
  var SNOW_CODES = { 71: 1, 73: 1, 75: 1, 77: 1, 85: 1, 86: 1 };
  var HEAVY_SNOW_CODES = { 75: 1, 86: 1 };

  function round1(n) { return Math.round(n * 10) / 10; }

  /* ---------- per-sample scoring ---------- */

  function scoreCar(wx) {
    var score = 0, reasons = [], advice = [], hardDanger = false;

    if (THUNDER_CODES[wx.code]) {
      score += 50; hardDanger = true;
      reasons.push("Thunderstorms forecast");
      advice.push("Consider delaying — lightning and sudden downpours ahead");
    }
    if (ICE_CODES[wx.code]) {
      score += 45; hardDanger = true;
      reasons.push("Freezing precipitation — ice risk on the road");
      advice.push("Roads may be icy — reduce speed and increase following distance");
    } else if (SNOW_CODES[wx.code]) {
      var heavy = !!HEAVY_SNOW_CODES[wx.code];
      score += heavy ? 40 : 20;
      if (heavy) hardDanger = true;
      reasons.push((heavy ? "Heavy snow" : "Snow") + " forecast");
      advice.push("Carry winter gear and slow down for reduced traction");
    }

    if (wx.precipMm > 7) {
      score += 40; hardDanger = true;
      reasons.push("Heavy rain: " + round1(wx.precipMm) + " mm/h — aquaplaning risk");
      advice.push("Slow down on the highway — standing water can cause aquaplaning");
    } else if (wx.precipMm > 2.5) {
      score += 20;
      reasons.push("Rain: " + round1(wx.precipMm) + " mm/h, wet roads");
      advice.push("Wet roads — leave extra braking distance");
    } else if (wx.precipMm > 0.2) {
      score += 8;
      reasons.push("Light rain: " + round1(wx.precipMm) + " mm/h");
    }

    if (wx.visibilityM < 500) {
      score += 40; hardDanger = true;
      reasons.push("Visibility down to " + Math.round(wx.visibilityM) + " m");
      advice.push("Use fog lights and slow down — visibility is very limited");
    } else if (wx.visibilityM < 1000) {
      score += 20;
      reasons.push("Reduced visibility: " + Math.round(wx.visibilityM) + " m");
      advice.push("Fog patches likely — keep headlights on");
    } else if (wx.visibilityM < 3000) {
      score += 8;
      reasons.push("Some haze/fog, visibility " + Math.round(wx.visibilityM / 100) / 10 + " km");
    }

    if (wx.gustKmh > 80) {
      score += 15;
      reasons.push("Strong gusts to " + Math.round(wx.gustKmh) + " km/h");
      advice.push("Watch for crosswind on bridges and overtaking trucks");
    }

    score = RC.clamp(score, 0, 100);
    var level = hardDanger ? "danger" : levelFromScore(score);
    if (hardDanger) score = Math.max(score, 80);
    return { level: level, score: score, reasons: reasons, advice: advice };
  }

  function scoreMotorcycle(wx) {
    var score = 0, reasons = [], advice = [], hardDanger = false;

    if (THUNDER_CODES[wx.code]) {
      score += 55; hardDanger = true;
      reasons.push("Thunderstorm — lightning and gusty downdrafts");
      advice.push("Get off the bike and shelter until it passes");
    }
    if (ICE_CODES[wx.code]) {
      score += 55; hardDanger = true;
      reasons.push("Freezing precipitation — near-zero grip for two wheels");
      advice.push("Do not ride — ice risk is extreme on two wheels");
    } else if (SNOW_CODES[wx.code]) {
      score += 40; hardDanger = true;
      reasons.push("Snow forecast — poor traction for two wheels");
      advice.push("Avoid riding — snow drastically cuts tyre grip");
    }

    // rain + standing water — grip matters far more on two wheels
    if (wx.precipMm > 7) {
      score += 45; hardDanger = true;
      reasons.push("Heavy rain: " + round1(wx.precipMm) + " mm/h — standing water likely");
      advice.push("Standing water risk — avoid wheel ruts and painted road markings");
    } else if (wx.precipMm > 4) {
      score += 30;
      reasons.push("Rain: " + round1(wx.precipMm) + " mm/h — reduced grip");
      advice.push("Smooth inputs — braking and cornering grip is well down");
    } else if (wx.precipMm > 1) {
      score += 18;
      reasons.push("Light rain: " + round1(wx.precipMm) + " mm/h, road surface will be wet");
      advice.push("Watch for oily patches in the first few minutes of rain");
    } else if (wx.precipMm > 0.2 || wx.precipProb > 60) {
      score += 10;
      reasons.push("Chance of rain: " + Math.round(wx.precipProb) + "%");
      advice.push("Pack a rain jacket");
    }

    // crosswind gusts — the headline motorcycle hazard
    if (wx.gustKmh > 60) {
      score += 45; hardDanger = true;
      reasons.push("Gusts to " + Math.round(wx.gustKmh) + " km/h — high crosswind risk");
      advice.push("Strong crosswind risk — grip the tank with your knees, expect sudden push");
    } else if (wx.gustKmh > 45) {
      score += 25;
      reasons.push("Gusts to " + Math.round(wx.gustKmh) + " km/h — expect push on bridges");
      advice.push("Ease off through bridges and overpasses when gusts hit");
    } else if (wx.gustKmh > 30) {
      score += 10;
      reasons.push("Breezy: gusts to " + Math.round(wx.gustKmh) + " km/h");
    }

    // visibility / fog + visor fogging
    if (wx.visibilityM < 500) {
      score += 45; hardDanger = true;
      reasons.push("Visibility down to " + Math.round(wx.visibilityM) + " m");
      advice.push("Visibility is too low to ride safely — wait it out");
    } else if (wx.visibilityM < 1500) {
      score += 22;
      reasons.push("Fog: visibility " + Math.round(wx.visibilityM) + " m");
      advice.push("Use a clear or yellow visor and slow down in fog");
    } else if (wx.visibilityM < 4000) {
      score += 8;
      reasons.push("Haze, visibility " + Math.round(wx.visibilityM / 100) / 10 + " km");
    }
    if (wx.humidity > 85 && wx.tempC < 18 && wx.precipMm > 0) {
      score += 5;
      advice.push("Visor fogging: crack it open");
    }

    // wind chill at highway speed (apparent temp already factors ambient
    // wind; riding adds a lot more relative airflow, so treat feelsC more
    // aggressively than a car would)
    if (wx.feelsC < 2) {
      score += 30;
      reasons.push("Feels like " + round1(wx.feelsC) + "°C — severe wind chill at speed");
      advice.push("Full thermals and windproof liners — wind chill will bite fast");
    } else if (wx.feelsC < 10) {
      score += 15;
      reasons.push("Feels like " + round1(wx.feelsC) + "°C — wind chill on the highway");
      advice.push("Layer up: highway speed will make it feel colder than the forecast");
    }

    // heat exhaustion in riding gear
    if (wx.feelsC > 40) {
      score += 30; hardDanger = true;
      reasons.push("Feels like " + round1(wx.feelsC) + "°C in gear — heat stress risk");
      advice.push("Heat exhaustion risk in full gear — hydrate often and take shade breaks");
    } else if (wx.feelsC > 34) {
      score += 15;
      reasons.push("Feels like " + round1(wx.feelsC) + "°C in gear");
      advice.push("Carry water — full gear traps heat fast at this temperature");
    }

    // night visibility
    if (!wx.isDay) {
      score += 15;
      reasons.push("Riding at night — reduced visibility for other traffic");
      advice.push("Use reflective gear and watch for animals or debris on unlit roads");
    }

    score = RC.clamp(score, 0, 100);
    var level = hardDanger ? "danger" : levelFromScore(score);
    if (hardDanger) score = Math.max(score, 80);
    return { level: level, score: score, reasons: reasons, advice: advice };
  }

  function score(wx, vehicle) {
    if (!wx || wx.outOfRange) {
      return {
        level: "watch", score: 20,
        reasons: ["Forecast unavailable this far out"],
        advice: ["Check conditions again closer to departure"]
      };
    }
    return vehicle === "motorcycle" ? scoreMotorcycle(wx) : scoreCar(wx);
  }

  /* ---------- trip aggregation ---------- */

  function trip(checkpoints, vehicle) {
    var worst = null, worstResult = null;

    for (var i = 0; i < checkpoints.length; i++) {
      var cp = checkpoints[i];
      if (!cp.wx || cp.wx.outOfRange) continue;
      var r = score(cp.wx, vehicle);
      if (!worstResult || r.score > worstResult.score) {
        worst = cp;
        worstResult = r;
      }
    }

    if (!worstResult) {
      worstResult = { level: "clear", score: 0, reasons: [], advice: [] };
    }

    // rainMinutes: attribute each leg's travel-time share to the segment,
    // sum legs with meaningful average precipitation
    var rainMinutes = 0;
    for (var j = 0; j < checkpoints.length - 1; j++) {
      var a = checkpoints[j], b = checkpoints[j + 1];
      if (!a.wx || a.wx.outOfRange || !b.wx || b.wx.outOfRange) continue;
      var legSeconds = (b.etaSeconds || 0) - (a.etaSeconds || 0);
      if (legSeconds <= 0) continue;
      var avgPrecip = (a.wx.precipMm + b.wx.precipMm) / 2;
      if (avgPrecip >= 0.1) rainMinutes += legSeconds / 60;
    }

    return {
      level: worstResult.level,
      score: worstResult.score,
      worst: worst,
      reasons: worstResult.reasons,
      advice: worstResult.advice,
      rainMinutes: Math.round(rainMinutes)
    };
  }

  /* ---------- departure planner ---------- */

  var OFFSETS_H = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
  var MAX_SAMPLE_POINTS = 6;

  /* pick up to MAX_SAMPLE_POINTS indices into route.cumDist, evenly spread
     across the trip (always including start and end) */
  function pickSampleIndices(route) {
    var n = route.cumDist ? route.cumDist.length : 0;
    if (n === 0) return [];
    if (n <= MAX_SAMPLE_POINTS) {
      var all = [];
      for (var i = 0; i < n; i++) all.push(i);
      return all;
    }
    var idxs = [];
    var steps = MAX_SAMPLE_POINTS - 1;
    for (var k = 0; k <= steps; k++) {
      var idx = Math.round((k / steps) * (n - 1));
      if (idxs.indexOf(idx) === -1) idxs.push(idx);
    }
    return idxs;
  }

  function bestDeparture(route, baseDate, vehicle, forecastFn) {
    var sampleIdxs = pickSampleIndices(route);
    var lastIdx = route.cumDur.length - 1;
    var totalDurS = route.cumDur[lastIdx] || 0;

    var results = OFFSETS_H.map(function (offH) {
      var departAt = new Date(baseDate.getTime() + offH * 3600000);
      var worstScore = -1, worstLevel = "clear";

      for (var s = 0; s < sampleIdxs.length; s++) {
        var idx = sampleIdxs[s];
        var distM = route.cumDist[idx];
        var etaS = route.cumDur[idx];
        var eta = new Date(departAt.getTime() + etaS * 1000);
        var wx = forecastFn(distM, eta);
        if (!wx || wx.outOfRange) continue;
        var r = score(wx, vehicle);
        if (r.score > worstScore) {
          worstScore = r.score;
          worstLevel = r.level;
        }
      }

      if (worstScore < 0) { worstScore = 0; worstLevel = "clear"; }

      return {
        offsetH: offH,
        level: worstLevel,
        score: worstScore,
        eta: new Date(departAt.getTime() + totalDurS * 1000)
      };
    });

    results.sort(function (a, b) { return a.offsetH - b.offsetH; });
    return Promise.resolve(results);
  }

  RC.risk = {
    score: score,
    trip: trip,
    bestDeparture: bestDeparture,
    LEVELS: LEVELS
  };
})();

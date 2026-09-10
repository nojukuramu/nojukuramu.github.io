/* ============================================================
   RouteCast — traffic
   There is no traffic API here, and that is a decision rather than an
   oversight. Every live-traffic feed worth having (TomTom, HERE, Google,
   Waze) needs a key and a server to hide it in; this app is a static page
   on GitHub Pages with neither. A key pasted into a public JavaScript file
   is not a key, it is a donation. So instead of pretending, RouteCast
   predicts congestion from two things it can actually stand behind:

   1. **A time-of-week profile.** Congestion is overwhelmingly a function of
      when you set off, and the shape of a weekday is not a mystery. The
      profile below is the ordinary two-peak commuter curve, with Philippine
      road reality in mind: a long, heavy evening peak that starts before
      five and does not clear until well past eight, a lighter but sharper
      morning one, and Sunday mornings that are genuinely empty.

   2. **Your own rides.** Once history.js has watched you ride, the model is
      grounded: your observed speed on these exact roads, and your observed
      ratio of real time to predicted time at this hour of the week, both
      beat any generic curve. The profile is what answers before you have
      any history, and it fades as the history arrives.

   Everything here is arithmetic over local data. No requests are made.
   ============================================================ */
RC.traffic = (function () {
  "use strict";

  /* Relative congestion by hour of day, 0..23. 1.0 is free-flowing.
     Weekday and weekend curves are separate because a Saturday afternoon
     and a Tuesday afternoon are not the same road. */
  var WEEKDAY = [
    1.00, 1.00, 1.00, 1.00, 1.02, 1.10,  //  0- 5  night, first movers
    1.28, 1.55, 1.62, 1.45, 1.28, 1.22,  //  6-11  morning peak
    1.26, 1.24, 1.22, 1.28, 1.42, 1.62,  // 12-17  lunch bump, evening builds
    1.70, 1.62, 1.44, 1.26, 1.12, 1.04   // 18-23  evening peak, unwinding
  ];
  var WEEKEND = [
    1.00, 1.00, 1.00, 1.00, 1.00, 1.00,
    1.02, 1.06, 1.12, 1.20, 1.30, 1.36,
    1.38, 1.36, 1.34, 1.34, 1.38, 1.44,
    1.46, 1.40, 1.28, 1.16, 1.06, 1.02
  ];
  // Friday evening is its own weather system.
  var FRIDAY_EVENING_BOOST = 1.08;

  /* A motorcycle filters. It does not escape a jam, but it does not sit in
     it either, so it feels a fraction of the delay a car does. */
  var VEHICLE_SENSITIVITY = { car: 1.0, motorcycle: 0.45 };

  var LEVELS = {
    free:     { label: "Free flowing", rank: 0 },
    moderate: { label: "Moderate",     rank: 1 },
    heavy:    { label: "Heavy",        rank: 2 },
    severe:   { label: "Severe",       rank: 3 }
  };

  function curveFor(date) {
    var day = date.getDay();               // 0 Sun .. 6 Sat
    var weekend = (day === 0 || day === 6);
    var base = weekend ? WEEKEND : WEEKDAY;
    var h = date.getHours();
    // Interpolate across the hour so a 17:50 departure is not scored as 17:00.
    var next = base[(h + 1) % 24];
    var frac = date.getMinutes() / 60;
    var v = base[h] + (next - base[h]) * frac;
    if (day === 5 && h >= 15 && h <= 21) v *= FRIDAY_EVENING_BOOST;
    return v;
  }

  // The mean of the profile over a whole week. Dividing by it turns the
  // absolute curve into a *relative* one whose average is exactly 1, which
  // is what eta.js needs: a learned bias already contains average traffic,
  // so the model must only redistribute it across the day, never add it in
  // a second time.
  var WEEK_MEAN = (function () {
    var sum = 0;
    for (var d = 0; d < 7; d++) {
      var arr = (d === 0 || d === 6) ? WEEKEND : WEEKDAY;
      for (var h = 0; h < 24; h++) sum += arr[h];
    }
    return sum / (7 * 24);
  })();

  /* RC.traffic.factor(date, vehicle) -> absolute delay multiplier (>= 1). */
  function factor(date, vehicle) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return 1;
    var sensitivity = VEHICLE_SENSITIVITY[vehicle] == null ? 1 : VEHICLE_SENSITIVITY[vehicle];
    var raw = curveFor(date);
    return 1 + (raw - 1) * sensitivity;
  }

  /* RC.traffic.relative(date, vehicle) -> the same curve normalised so that
     its average over a week is 1. Above 1 means this hour is worse than
     your typical hour; below 1 means it is better. */
  function relative(date, vehicle) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return 1;
    var sensitivity = VEHICLE_SENSITIVITY[vehicle] == null ? 1 : VEHICLE_SENSITIVITY[vehicle];
    var raw = curveFor(date) / WEEK_MEAN;
    return 1 + (raw - 1) * sensitivity;
  }

  /* RC.traffic.level(date, vehicle) -> "free" | "moderate" | "heavy" | "severe"
     Graded on the car curve regardless of vehicle: the road is as congested
     as it is: what changes with a motorcycle is how much of that you feel,
     which is what factor() reports. Telling a rider the road is clear when
     it is a car park would be a lie of a different kind. */
  function level(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return "free";
    var v = curveFor(date);
    if (v >= 1.55) return "severe";
    if (v >= 1.32) return "heavy";
    if (v >= 1.14) return "moderate";
    return "free";
  }

  /* RC.traffic.forecast(checkpoints, vehicle) -> one reading per checkpoint,
     each at that checkpoint's own ETA. This is the whole point: the traffic
     you meet 90 km out is the traffic at the hour you get there, not the
     traffic now. */
  function forecast(checkpoints, vehicle) {
    var out = [];
    if (!checkpoints) return out;
    for (var i = 0; i < checkpoints.length; i++) {
      var eta = checkpoints[i].eta;
      out.push({
        index: i,
        at: eta,
        level: level(eta),
        factor: factor(eta, vehicle)
      });
    }
    return out;
  }

  /* The worst stretch of the trip, for the summary line: {level, at, label}
     or null when the whole thing is free flowing. */
  function worst(checkpoints, vehicle) {
    var list = forecast(checkpoints, vehicle);
    var best = null;
    for (var i = 0; i < list.length; i++) {
      if (!best || LEVELS[list[i].level].rank > LEVELS[best.level].rank) best = list[i];
    }
    if (!best || best.level === "free") return null;
    return { level: best.level, at: best.at, index: best.index, label: LEVELS[best.level].label };
  }

  /* How much of this is guesswork, and how much is you. Returns
     {source: "model"|"blended"|"measured", detail} so the UI can say where
     a number came from instead of presenting a model as a measurement. */
  function confidence(coords, vehicle, date) {
    var observed = RC.history ? RC.history.observedSpeed(coords, vehicle) : null;
    var bias = RC.history ? RC.history.etaBias(vehicle, date) : null;
    if (observed && bias && bias.hourSamples > 0) {
      return { source: "measured", detail: "your rides on these roads at this hour" };
    }
    if (observed || bias) {
      return { source: "blended", detail: bias ? "your past rides" : "your speed on these roads" };
    }
    return { source: "model", detail: "time-of-week model" };
  }

  return {
    factor: factor,
    relative: relative,
    level: level,
    forecast: forecast,
    worst: worst,
    confidence: confidence,
    LEVELS: LEVELS,
    WEEK_MEAN: WEEK_MEAN
  };
})();

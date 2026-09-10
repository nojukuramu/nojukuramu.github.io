/* ============================================================
   RouteCast — ETA calibration
   The complaint this module exists to answer: the ETA was always too
   optimistic, which is worse here than in an ordinary navigator. RouteCast
   times the *forecast* off the ETA, so an ETA that runs half an hour fast
   does not merely mislead about arrival — it reads the weather for the
   wrong hour at the wrong place, and cheerfully reports sunshine into a
   squall you will actually ride through.

   Where the optimism comes from
   -----------------------------
   The OSRM demo server runs the stock `driving` profile: free-flow speeds
   derived from the road class, with no traffic model, no signals, no
   junction delay and no queueing. On an empty motorway at 3am it is close
   to right. On EDSA at six in the evening it is fiction.

   What this does about it
   -----------------------
   Three multipliers, applied per edge in a single forward pass, so the
   correction changes *along* the route as the clock moves:

     duration_edge x  base       (the router's structural optimism)
                   x  traffic    (relative congestion at the time you are
                                  actually at that edge, mean-1 normalised)
                   x  stops      (nothing yet — reserved for the stop model)

   `base` is a published default until you have ridden, and your own measured
   ratio of real time to predicted time afterwards. Because a learned bias
   already contains the average congestion you ride in, the traffic term is
   deliberately the *relative* curve (see traffic.js) — it moves time between
   hours rather than adding it twice.

   The result is a new route object: same geometry, same distances, honest
   cumDur. Everything downstream — the sampler's ETAs, the forecast hour, the
   summary, live navigation's baseline — is corrected for free, because they
   all read cumDur.
   ============================================================ */
RC.eta = (function () {
  "use strict";

  /* The structural correction, before any of your own data exists.
     A car sits in what a car sits in. A motorcycle filters, so it loses less
     to congestion, but it also loses time the router never models — pulling
     over, narrower overtakes, and no expressway to make it back on. */
  var BASE = { car: 1.22, motorcycle: 1.12 };

  // A learned bias is trusted, but not unconditionally: a run of unusual
  // rides should not be able to double an ETA.
  var BIAS_MIN = 0.85, BIAS_MAX = 2.0;
  // Nor should the per-edge product run away at the extremes of the curve.
  var EDGE_MIN = 0.8, EDGE_MAX = 2.6;

  function baseFor(vehicle) {
    return BASE[vehicle] == null ? BASE.car : BASE[vehicle];
  }

  /* RC.eta.factorAt(date, vehicle, bias) -> the multiplier for one moment. */
  function factorAt(date, vehicle, bias) {
    var b = bias == null ? baseFor(vehicle) : bias;
    var rel = RC.traffic ? RC.traffic.relative(date, vehicle) : 1;
    return RC.clamp(b * rel, EDGE_MIN, EDGE_MAX);
  }

  /* RC.eta.plan(route, departAt, vehicle) -> {route, calibration}

     `route` is a NEW object sharing the original's coordinate and distance
     arrays (they are unchanged and there is no reason to copy them) with a
     rebuilt cumDur, duration, legs and steps. The original is left intact so
     an uncalibrated comparison is still available for the UI.

     calibration = {
       base, biasRatio|null, samples, hourSamples, source, factorMean,
       addedSeconds, rawDuration, duration
     }
   */
  function plan(route, departAt, vehicle) {
    if (!route || !route.cumDur || route.cumDur.length < 2) {
      return { route: route, calibration: null };
    }
    var depart = departAt instanceof Date ? departAt : new Date();

    var learned = RC.history ? RC.history.etaBias(vehicle, depart) : null;
    var bias = learned ? RC.clamp(learned.ratio, BIAS_MIN, BIAS_MAX) : baseFor(vehicle);

    var src = route.cumDur;
    var out = new Array(src.length);
    out[0] = 0;
    var departMs = depart.getTime();

    for (var i = 1; i < src.length; i++) {
      var edge = src[i] - src[i - 1];
      if (!(edge > 0)) { out[i] = out[i - 1]; continue; }
      // The clock at the START of this edge, using the corrected time so
      // far — which is the whole reason this is a forward pass and not a
      // single multiply: leave at 06:30 and by the time you reach the far
      // end of the route the peak is behind you.
      var at = new Date(departMs + out[i - 1] * 1000);
      out[i] = out[i - 1] + edge * factorAt(at, vehicle, bias);
    }

    var rawDuration = src[src.length - 1];
    var duration = out[out.length - 1];
    var mean = rawDuration > 0 ? duration / rawDuration : 1;

    var calibrated = {
      coords: route.coords,
      cumDist: route.cumDist,
      cumDur: out,
      distance: route.distance,
      duration: duration,
      summary: route.summary,
      // Steps and legs are scaled by the whole-route mean rather than
      // re-integrated: they are used for display and for waypoint
      // boundaries, never for timing a checkpoint.
      steps: (route.steps || []).map(function (s) {
        return { text: s.text, distance: s.distance, duration: s.duration * mean, lat: s.lat, lon: s.lon };
      }),
      legs: (route.legs || []).map(function (l) {
        return { distance: l.distance, duration: l.duration * mean };
      }),
      raw: route,
      rawDuration: rawDuration
    };
    // Carry across the flags app.js and the UI look for.
    if (route.avoidedMotorways) calibrated.avoidedMotorways = true;
    if (route.motorwayAvoidanceFailed) {
      calibrated.motorwayAvoidanceFailed = true;
      calibrated.motorwayAvoidanceReason = route.motorwayAvoidanceReason;
    }
    if (route.expresswayNames) calibrated.expresswayNames = route.expresswayNames;
    if (route.familiarity) calibrated.familiarity = route.familiarity;

    var calibration = {
      base: baseFor(vehicle),
      biasRatio: learned ? learned.ratio : null,
      samples: learned ? learned.samples : 0,
      hourSamples: learned ? learned.hourSamples : 0,
      source: learned ? (learned.hourSamples > 0 ? "rides-at-this-hour" : "rides") : "default",
      factorMean: mean,
      rawDuration: rawDuration,
      duration: duration,
      addedSeconds: duration - rawDuration
    };
    // The record travels with the route: selecting an alternative later must
    // not have to remember which calibration produced it.
    calibrated.calibration = calibration;

    return { route: calibrated, calibration: calibration };
  }

  /* A sentence for the UI explaining where the number came from. Never
     claims to have measured something it modelled. */
  function explain(cal, vehicle) {
    if (!cal) return "";
    var pct = Math.round((cal.factorMean - 1) * 100);
    var slower = pct > 0
      ? pct + "% slower than the router's own estimate"
      : (pct < 0 ? Math.abs(pct) + "% faster than the router's own estimate" : "in line with the router's estimate");
    if (cal.source === "rides-at-this-hour") {
      return "ETA " + slower + ", from your " + cal.samples + " recorded " +
             (cal.samples === 1 ? "ride" : "rides") + " — " + cal.hourSamples +
             " of them at this hour of the week.";
    }
    if (cal.source === "rides") {
      return "ETA " + slower + ", from your " + cal.samples + " recorded " +
             (cal.samples === 1 ? "ride" : "rides") + " and the time-of-week traffic model.";
    }
    return "ETA " + slower + ", from the time-of-week traffic model. Ride with " +
           "navigation on and RouteCast will replace this with your own timings.";
  }

  return { plan: plan, factorAt: factorAt, explain: explain, BASE: BASE };
})();

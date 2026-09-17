/* ============================================================
   RouteCast — the heat map

   RouteCast has been quietly writing down which roads you use since the day
   it shipped, because it needs that to prefer a familiar line and to tell an
   ETA what your traffic is really like. It has never shown it to you.

   This draws it. Not a blur of dots over a city — a blur says "you have been
   here", which you already knew — but the actual network of road segments the
   recorder holds, each one coloured by something worth knowing about it:

     Visits   how often you ride it. The shape of a life: the commute is a
              hot line, the ride you took once is a cold thread.
     Speed    how fast you ACTUALLY move on it, averaged over every crossing.
              This is the one that surprises people. The road you think of as
              the fast way out of town is amber all the way to the bypass.
     Held up  seconds per crossing. Where the time goes, which is a different
              question from where the distance goes, and the only one that
              explains why a 20 km ride takes 50 minutes.
     Recent   how lately. A record that goes back a year is mostly history;
              this is the part of it that is still your life.

   Where the numbers come from
   ---------------------------
   RC.history.segments(). Nothing is fetched and nothing is computed twice:
   the store already holds, per ~124 m segment, how many crossings, how many
   metres and how many seconds. Speed is metres over seconds — the ratio of
   the totals, so one crawl in rush hour does not count the same as one clear
   run at midnight, it counts for the time it actually took.

   Why it is drawn on a canvas
   ---------------------------
   Six thousand segments is six thousand SVG paths, which is a phone dropping
   to four frames a second the moment you pan. One Leaflet canvas renderer
   takes all of them, and the layer is rebuilt only when the map has actually
   moved somewhere new — not on every frame of a pan.

   The scale
   ---------
   Colour is assigned by RANK, not by value. A linear ramp over "visits" on a
   record where one commute has 400 crossings and everything else has two
   paints the entire map the colour of "two" and the commute the colour of
   "400", which is a picture of one number rather than of a life. Ranking
   spreads the record across the ramp, so the top decile is always the top
   colour and the map always says something.
   ============================================================ */
var RC = RC || {};

RC.heat = (function () {
  "use strict";

  // Below this many segments there is nothing to rank and nothing to say.
  var MIN_SEGMENTS = 8;
  var MAX_DRAWN = 4000;        // a ceiling on one repaint, not on the record
  var REBUILD_MOVE_PX = 120;   // pan this far before the visible set is redone

  /* Five steps, cold to hot. Chosen to read on both the light and the dark
     map filter, to stay clear of the route palette (matcha green) and of the
     four risk colours, and to survive the most common colour-vision
     deficiency — which rules out the red/green ramp everybody reaches for
     first. This is blue through violet to orange: distinguishable by
     lightness alone, so it still works in a helmet visor at noon. */
  var RAMP = ["#2C6FB5", "#5B5FC0", "#8E52B0", "#C0508B", "#E2703A"];

  var METRICS = {
    visits: {
      key: "visits",
      label: "Visits",
      note: "How often you ride each stretch.",
      value: function (s) { return s.uses; },
      // More is hotter.
      reverse: false,
      format: function (s) { return s.uses + (s.uses === 1 ? " ride" : " rides"); }
    },
    speed: {
      key: "speed",
      label: "Speed",
      note: "Your own average speed on each stretch, over every crossing.",
      value: function (s) { return s.kmh; },
      // Slow is hotter: a heat map of a ride is a map of where it goes wrong.
      reverse: true,
      format: function (s, units) {
        return s.kmh == null ? "no speed recorded" : RC.fmtSpeed(s.kmh, units);
      }
    },
    dwell: {
      key: "dwell",
      label: "Held up",
      note: "Seconds spent per crossing — where the time actually goes.",
      value: function (s) { return s.perVisitS; },
      reverse: false,
      format: function (s) { return RC.fmtDur(Math.round(s.perVisitS)) + " per ride"; }
    },
    recent: {
      key: "recent",
      label: "Recent",
      note: "How lately you rode it.",
      value: function (s) { return s.lastDay; },
      reverse: false,
      format: function (s) {
        var days = Math.max(0, Math.floor(Date.now() / 86400000) - s.lastDay);
        return days <= 0 ? "today" : days === 1 ? "yesterday" : days + " days ago";
      }
    }
  };

  var map = null;
  var bridge = null;            // { units(), setStatus(), flashStatus() }
  var layer = null;
  var renderer = null;
  var on = false;
  var metric = "visits";
  var vehicle = null;           // null = both
  var cache = null;             // the ranked segment list, built once per show
  var lastCentre = null;
  var onChange = null;

  function units() { return bridge && bridge.units ? bridge.units() : "metric"; }

  /* ---------------------------------------------------------
     Ranking
     --------------------------------------------------------- */

  /* Give every segment a 0..1 position in the record by rank, then use that
     to pick a colour and a width. Segments whose metric is undefined (a road
     with no usable speed, say) are dropped rather than parked at one end of
     the ramp pretending to be the coldest thing on the map. */
  function rank(segments, m) {
    var def = METRICS[m] || METRICS.visits;
    var usable = [];
    for (var i = 0; i < segments.length; i++) {
      var v = def.value(segments[i]);
      if (v == null || !isFinite(v)) continue;
      usable.push({ seg: segments[i], v: v });
    }
    usable.sort(function (a, b) { return a.v - b.v; });

    var n = usable.length;
    for (var j = 0; j < n; j++) {
      // Ties share a position, so a hundred segments all ridden exactly twice
      // are all the same colour — which is true, and a strict index would
      // have spread them across half the ramp for no reason.
      var k = j;
      while (k + 1 < n && usable[k + 1].v === usable[j].v) k++;
      var t = n > 1 ? ((j + k) / 2) / (n - 1) : 1;
      for (var q = j; q <= k; q++) usable[q].t = def.reverse ? 1 - t : t;
      j = k;
    }
    return usable;
  }

  function colourAt(t) {
    var i = RC.clamp(Math.floor(t * RAMP.length), 0, RAMP.length - 1);
    return RAMP[i];
  }

  /* Width says "how much of your riding is this", independently of the
     colour, so a rarely used road never looks like a motorway just because
     it happened to be slow. */
  function widthFor(seg, maxUses) {
    var share = maxUses > 0 ? Math.min(1, seg.uses / Math.min(maxUses, 12)) : 0;
    return 2.5 + share * 5.5;
  }

  /* ---------------------------------------------------------
     Drawing
     --------------------------------------------------------- */
  function build() {
    if (!map) return;
    if (!layer) {
      // One canvas for the whole record. padding keeps freshly panned-in
      // segments from popping at the edge of the viewport.
      renderer = L.canvas({ padding: 0.3 });
      layer = L.layerGroup().addTo(map);
    }
    layer.clearLayers();
    if (!on || !cache || !cache.list.length) return;

    var bounds = map.getBounds().pad(0.25);
    var drawn = 0;
    var list = cache.list;

    for (var i = 0; i < list.length; i++) {
      if (drawn >= MAX_DRAWN) break;
      var s = list[i].seg;
      // Cheap rejection before Leaflet is asked to make anything: a record of
      // a whole country, viewed at street level, is 99% off screen.
      if (!bounds.contains(L.latLng(s.a[0], s.a[1])) &&
          !bounds.contains(L.latLng(s.b[0], s.b[1]))) continue;

      L.polyline([s.a, s.b], {
        renderer: renderer,
        color: colourAt(list[i].t),
        weight: widthFor(s, cache.maxUses),
        opacity: 0.72,
        lineCap: "round",
        interactive: false
      }).addTo(layer);
      drawn++;
    }
    cache.drawn = drawn;
    lastCentre = map.getCenter();
  }

  function onMapMove() {
    if (!on || !map) return;
    if (lastCentre) {
      try {
        var a = map.latLngToContainerPoint(lastCentre);
        var b = map.latLngToContainerPoint(map.getCenter());
        if (Math.abs(a.x - b.x) < REBUILD_MOVE_PX && Math.abs(a.y - b.y) < REBUILD_MOVE_PX) return;
      } catch (e) {}
    }
    build();
  }

  function refresh() {
    if (!on) return;
    var segs = RC.history.segments({ vehicle: vehicle });
    var ranked = rank(segs, metric);
    var maxUses = 0, meters = 0, seconds = 0;
    for (var i = 0; i < segs.length; i++) {
      if (segs[i].uses > maxUses) maxUses = segs[i].uses;
      meters += segs[i].meters;
      seconds += segs[i].seconds;
    }
    cache = {
      list: ranked, maxUses: maxUses, segments: segs.length,
      meters: meters, seconds: seconds, drawn: 0
    };
    build();
    fire();
  }

  function fire() {
    if (typeof onChange === "function") { try { onChange(api.state()); } catch (e) {} }
  }

  /* ---------------------------------------------------------
     Public
     --------------------------------------------------------- */
  var api = {
    init: function (opts) {
      map = opts.map;
      bridge = opts.bridge || null;
      onChange = opts.onChange || null;
      metric = RC.store.get("heatMetric", "visits");
      if (!METRICS[metric]) metric = "visits";
      if (map) {
        map.on("moveend", onMapMove);
        map.on("zoomend", function () { if (on) build(); });
      }
    },

    METRICS: METRICS,
    RAMP: RAMP,

    /** How much there is to draw, without drawing any of it. The panel asks
        this before offering the switch, because "turn on the heat map" over a
        record of four segments is an offer worth not making. */
    ready: function () {
      var s = RC.history.heatSummary(vehicle);
      return s.segments >= MIN_SEGMENTS;
    },

    summary: function (forVehicle) {
      return RC.history.heatSummary(forVehicle === undefined ? vehicle : forVehicle);
    },

    show: function () {
      if (on) return true;
      if (!api.ready()) {
        if (bridge && bridge.setStatus) {
          bridge.setStatus("Not enough recorded road yet — ride a few kilometres first.", "");
          if (bridge.flashStatus) bridge.flashStatus(4000);
        }
        return false;
      }
      on = true;
      refresh();
      return true;
    },

    hide: function () {
      if (!on) return false;
      on = false;
      if (layer) layer.clearLayers();
      cache = null;
      fire();
      return true;
    },

    toggle: function () { return on ? (api.hide(), false) : api.show(); },

    isOn: function () { return on; },

    setMetric: function (m) {
      if (!METRICS[m] || m === metric) return metric;
      metric = m;
      RC.store.set("heatMetric", m);
      refresh();
      return metric;
    },

    getMetric: function () { return metric; },

    /** null means "both", which is the default: a road you learned in a car
        is still a road you know on a bike, and the heat map is about the
        rider, not the machine. */
    setVehicle: function (v) {
      vehicle = (v === "car" || v === "motorcycle") ? v : null;
      if (on) refresh();
      return vehicle;
    },

    getVehicle: function () { return vehicle; },

    state: function () {
      return {
        on: on,
        metric: metric,
        vehicle: vehicle,
        segments: cache ? cache.segments : 0,
        drawn: cache ? cache.drawn : 0,
        meters: cache ? cache.meters : 0,
        seconds: cache ? cache.seconds : 0
      };
    },

    /** Everything the record can say about one metric, as text. Used by the
        panel; kept here so the wording and the maths cannot drift apart. */
    describe: function () {
      var s = RC.history.heatSummary(vehicle);
      var u = units();
      if (!s.segments) return null;
      var out = {
        segments: s.segments,
        distance: RC.fmtDist(s.meters, u),
        time: RC.fmtDur(Math.round(s.seconds)),
        pace: s.kmh == null ? null : RC.fmtSpeed(s.kmh, u),
        busiest: s.busiest ? s.busiest.uses : 0,
        slowest: s.slowest && s.slowest.kmh != null ? RC.fmtSpeed(s.slowest.kmh, u) : null
      };
      return out;
    },

    /** Re-rank without re-reading, after a ride has added to the record. */
    invalidate: function () { if (on) refresh(); }
  };

  return api;
})();

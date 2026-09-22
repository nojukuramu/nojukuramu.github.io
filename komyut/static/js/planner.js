/* ============================================================
   TheCommuters — the trip planner, as a screen

   Two buttons that name places, one button that finds the routes, and a
   list of itineraries. The search itself lives in static/js/plan.js; this
   file is about saying the answer honestly.

   Two decisions worth naming
   --------------------------
   **The reliability of an itinerary is its weakest leg's, and it is shown
   before the time.** A planner that leads with "48 min" and hides that the
   second jeepney is a route one person filed and nobody has confirmed is
   lying by layout. The meter is at the top of every itinerary for the same
   reason the fare is: it is a thing you decide on.

   **Walking is drawn and counted.** Every itinerary says how far you walk
   in total, because on a Philippine commute that number is the one that
   decides whether a route is usable in the rain, and it is exactly the
   number a "fastest route" ranking makes invisible.
   ============================================================ */
var KM = KM || {};

KM.planner = (function () {
  "use strict";

  var origin = null, destination = null;
  var results = null, emptyEl = null;
  var busy = false;
  var shown = null;          // the itinerary currently drawn

  function init() {
    results = KM.el("find-results");
    emptyEl = KM.el("find-empty");

    KM.glyph(KM.el("find-swap"), "swap");

    KM.el("find-from").addEventListener("click", function () { choose("origin"); });
    KM.el("find-to").addEventListener("click", function () { choose("destination"); });

    KM.el("find-swap").addEventListener("click", function () {
      var t = origin; origin = destination; destination = t;
      paintPlaces();
      if (origin && destination) run();
    });

    KM.el("find-go").addEventListener("click", run);
  }

  function choose(which) {
    KM.finder.open({
      placeholder: which === "origin" ? "Where are you starting?" : "Where are you going?"
    }).then(function (place) {
      if (!place) return;
      if (which === "origin") origin = place; else destination = place;
      paintPlaces();
      drawPins();
      if (origin && destination) run();
    });
  }

  function paintPlaces() {
    KM.el("find-from-text").textContent = origin ? origin.name : "Where you are";
    KM.el("find-to-text").textContent = destination ? destination.name : "Where you are going";
    KM.el("find-from").classList.toggle("is-set", !!origin);
    KM.el("find-to").classList.toggle("is-set", !!destination);
  }

  function drawPins() {
    KM.map.clear("pins");
    if (origin) KM.map.dot("pins", origin, { text: "A", colour: "#2E7D4F", size: 28, title: origin.name, z: 600 });
    if (destination) KM.map.dot("pins", destination, { text: "B", colour: "#B4562B", size: 28, title: destination.name, z: 600 });
  }

  /* ---------------------------------------------------------
     Running the search
     --------------------------------------------------------- */
  function run() {
    if (busy) return;
    if (!origin || !destination) {
      KM.app.toast("Pick a start and an end first.");
      return;
    }
    if (!KM.supa.ready()) {
      KM.ui.empty(results, "Not connected to a community database yet.");
      emptyEl.hidden = true;
      return;
    }

    busy = true;
    emptyEl.hidden = true;
    KM.ui.spinner(results, "Looking for a way across…");
    KM.map.clear("plan");
    KM.map.clear("route");
    KM.map.clear("build");
    drawPins();

    KM.plan.find(origin, destination).then(function (out) {
      busy = false;
      render(out);
    }, function (err) {
      busy = false;
      KM.ui.failure(results, err, run);
    });
  }

  function render(out) {
    results.textContent = "";

    if (!out.itineraries.length) {
      var box = KM.mk("div", "km-failure");
      box.appendChild(KM.ui.icon("alert"));
      box.appendChild(KM.mk("p", null,
        out.considered
          ? "No chain of filed routes gets between those two, within a walk at each end."
          : "No routes have been filed around there yet."));
      var add = KM.mk("button", "km-btn km-btn-primary", "File the route yourself");
      add.type = "button";
      add.addEventListener("click", function () { KM.app.openTab("build"); });
      box.appendChild(add);
      results.appendChild(box);
      return;
    }

    var head = KM.mk("p", "km-hint",
      out.itineraries.length + (out.itineraries.length === 1 ? " way" : " ways") +
      " across, from " + out.considered + " route" + (out.considered === 1 ? "" : "s") + " filed nearby. ");
    if (out.itineraries.some(function (it) { return it.transfers > 0; })) {
      var tI = KM.mk("button", "km-i");
      tI.type = "button";
      tI.setAttribute("data-info", "transfers");
      tI.setAttribute("aria-label", "How a change is worked out");
      head.appendChild(tI);
    }
    results.appendChild(head);
    KM.info.paintButtons();

    out.itineraries.forEach(function (it, i) {
      results.appendChild(card(it, i));
    });

    /* Draw the best one straight away: an itinerary list nobody has tapped
       yet is a list with a blank map beside it. */
    show(out.itineraries[0]);
  }

  function card(it, index) {
    var el = KM.mk("article", "km-itin");
    el.setAttribute("data-band", it.band.id);

    var head = KM.mk("button", "km-itin-head");
    head.type = "button";

    var top = KM.mk("div", "km-itin-top");
    top.appendChild(KM.mk("span", "km-itin-time", KM.fmtDur(it.duration)));
    if (it.fare) {
      top.appendChild(KM.mk("span", "km-dot-sep"));
      top.appendChild(KM.mk("span", "km-itin-fare", KM.fmtFare(it.fare.min, it.fare.max, it.fare.currency)));
    }
    top.appendChild(KM.mk("span", "km-dot-sep"));
    top.appendChild(KM.mk("span", "km-itin-walk", KM.fmtDist(it.walkM) + " walking"));
    head.appendChild(top);

    /* The chain, as icons: jeepney, walk, bus. It is the fastest way to
       read "is this two rides or four" and it needs no words. */
    var chain = KM.mk("div", "km-chain");
    it.legs.forEach(function (leg, i) {
      if (i) chain.appendChild(KM.ui.icon("chevron", "km-chain-sep"));
      var node = KM.mk("span", "km-chain-leg");
      node.classList.add(leg.mode === "walk" ? "is-walk" : "is-ride");
      node.appendChild(leg.mode === "walk"
        ? KM.ui.rideIcon("walk")
        : KM.ui.rideIcon(leg.route.route_type));
      chain.appendChild(node);
    });
    head.appendChild(chain);

    /* The meter, before anything else about quality. It is built here
       rather than by KM.ui.meter because an itinerary has no votes of its
       own: the number shown is its weakest leg's, already worked out. */
    var band = KM.mk("div", "km-itin-trust");
    band.appendChild(trustBar(it));
    head.appendChild(band);

    head.addEventListener("click", function () { show(it); toggle(el); });
    el.appendChild(head);

    var detail = KM.mk("div", "km-itin-legs");
    detail.hidden = index !== 0;
    it.legs.forEach(function (leg) { detail.appendChild(legRow(leg)); });
    el.appendChild(detail);

    if (index === 0) el.classList.add("is-open");
    return el;
  }

  function trustBar(it) {
    var wrap = KM.mk("div", "km-meter");
    wrap.setAttribute("data-band", it.band.id);
    var bar = KM.mk("div", "km-meter-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", "Reliability of the weakest leg: " + it.band.label);
    for (var i = 0; i < 5; i++) {
      var seg = KM.mk("span", "km-meter-seg");
      if (it.reliability > i * 0.2) seg.classList.add("is-on");
      bar.appendChild(seg);
    }
    wrap.appendChild(bar);
    wrap.appendChild(KM.mk("span", "km-meter-label",
      it.band.label + (it.transfers ? " · " + it.transfers + " change" + (it.transfers > 1 ? "s" : "") : "")));
    return wrap;
  }

  function legRow(leg) {
    var row = KM.mk("div", "km-leg");
    row.classList.add(leg.mode === "walk" ? "is-walk" : "is-ride");

    var ic = KM.mk("span", "km-leg-icon");
    KM.glyph(ic, leg.mode === "walk" ? "walk" : KM.transit.type(leg.route.route_type).icon, "ride");
    ic.setAttribute("aria-hidden", "true");
    row.appendChild(ic);

    var text = KM.mk("div", "km-leg-text");

    if (leg.mode === "walk") {
      text.appendChild(KM.mk("p", "km-leg-title", leg.label));
      text.appendChild(KM.mk("p", "km-leg-sub", KM.fmtDist(leg.distance) + " · " + KM.fmtDur(leg.duration)));
    } else {
      var title = KM.mk("button", "km-leg-title km-leg-link", leg.route.name);
      title.type = "button";
      title.addEventListener("click", function (e) {
        e.stopPropagation();
        KM.detail.open(leg.route, { onClose: function () { KM.app.openTab("find"); } });
      });
      text.appendChild(title);

      var sub = KM.mk("p", "km-leg-sub");
      sub.appendChild(KM.mk("span", null, KM.transit.type(leg.route.route_type).label));
      sub.appendChild(KM.mk("span", "km-dot-sep"));
      sub.appendChild(KM.mk("span", null, KM.fmtDist(leg.distance)));
      sub.appendChild(KM.mk("span", "km-dot-sep"));
      sub.appendChild(KM.mk("span", null, "~" + KM.fmtDur(leg.waitS) + " wait"));
      var fare = KM.fmtFare(leg.route.fare_min, leg.route.fare_max, leg.route.currency);
      if (fare) {
        sub.appendChild(KM.mk("span", "km-dot-sep"));
        sub.appendChild(KM.mk("span", null, fare));
      }
      text.appendChild(sub);

      var m = KM.ui.meter(leg.route);
      m.classList.add("km-meter-tiny");
      text.appendChild(m);
    }

    row.appendChild(text);
    return row;
  }

  function toggle(el) {
    Array.prototype.forEach.call(results.querySelectorAll(".km-itin"), function (other) {
      var open = other === el;
      other.classList.toggle("is-open", open);
      var legs = other.querySelector(".km-itin-legs");
      if (legs) legs.hidden = !open;
    });
  }

  /* ---------------------------------------------------------
     Drawing one on the map
     --------------------------------------------------------- */
  function show(it) {
    shown = it;
    KM.map.clear("plan");

    var rideIndex = 0;
    var all = [];
    it.legs.forEach(function (leg) {
      if (!leg.path || leg.path.length < 2) return;
      if (leg.mode === "walk") {
        KM.map.line("plan", leg.path, { colour: KM.map.COLOURS.walk, weight: 4, dashed: true });
      } else {
        var colour = KM.map.COLOURS.ride[rideIndex % KM.map.COLOURS.ride.length];
        rideIndex++;
        KM.map.line("plan", leg.path, { colour: colour, weight: 7 });
        KM.map.dot("plan", { lat: leg.path[0][0], lon: leg.path[0][1] }, {
          ride: KM.transit.type(leg.route.route_type).icon,
          colour: colour, size: 30, title: leg.route.name, z: 300
        });
      }
      all = all.concat(leg.path);
    });

    drawPins();
    KM.map.fit(all, { bottom: 300 });
  }

  /* Called when the Find pane is opened. If the phone has already given a
     position, the start is filled in with it — because "from where I am"
     is what almost everybody means, and making them say so is a tap. */
  function activate() {
    paintPlaces();
    drawPins();
    if (shown) show(shown);
    if (!origin) {
      var fix = KM.map.lastKnown();
      if (fix) {
        origin = { lat: fix.lat, lon: fix.lon, name: "Where I am" };
        paintPlaces();
        drawPins();
      }
    }
  }

  /* Used by the "plan a trip from here" path elsewhere in the app. */
  function setOrigin(place) { origin = place; paintPlaces(); drawPins(); }
  function setDestination(place) { destination = place; paintPlaces(); drawPins(); }

  return {
    init: init,
    activate: activate,
    run: run,
    setOrigin: setOrigin,
    setDestination: setDestination
  };
})();

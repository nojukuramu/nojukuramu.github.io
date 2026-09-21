/* ============================================================
   KomyutApp — filing a route

   The hard part of this screen is not the form, it is the stops. Somebody
   describing a jeepney line from memory is not drawing a shape; they are
   listing places in order. So the controls are built around that list and
   nothing else:

     * **Three ways to add a stop**, all equal: drop a pin on the map,
       search a place by name, or use where you are standing. The last one
       matters more than it looks — most routes are filed by somebody
       standing on the route.
     * **The order is the route.** Each stop carries an up and a down
       arrow. No drag handles: a drag on a touch screen fights the map
       underneath it, and the one list where the order is the entire
       meaning is the worst place to lose a drag.
     * **The line redraws itself** a moment after every change. There is no
       "calculate" button, because a button you have to press to see what
       you just did is a button you will forget to press.
     * **The names write themselves.** A dropped pin is named from the map,
       so a stop is "Farmers Plaza" rather than a pair of numbers, and the
       route's start and end come from the first and last stop rather than
       from two more fields to fill in.

   Nothing is sent anywhere until Save. The stops live in memory and in
   localStorage, so closing the app halfway through filing a route does not
   lose it.
   ============================================================ */
var KM = KM || {};

KM.builder = (function () {
  "use strict";

  var DRAFT_KEY = "draft";

  var stops = [];
  var routed = null;         // the last successful router reply
  var editingId = null;      // set when editing a route that already exists
  var routeToken = 0;
  var typeId = "jeepney";

  var els = {};

  function init() {
    els.list = KM.el("build-stops");
    els.types = KM.el("build-types");
    els.measure = KM.el("build-measure");
    els.distance = KM.el("build-distance");
    els.duration = KM.el("build-duration");
    els.name = KM.el("build-name");
    els.nameErr = KM.el("build-name-err");
    els.fareMin = KM.el("build-fare-min");
    els.fareMax = KM.el("build-fare-max");
    els.city = KM.el("build-city");
    els.country = KM.el("build-country");
    els.desc = KM.el("build-desc");
    els.descCount = KM.el("build-desc-count");
    els.err = KM.el("build-err");
    els.form = KM.el("build-form");
    els.locked = KM.el("build-locked");

    buildTypeChips();

    KM.el("build-add-pin").addEventListener("click", addByPin);
    KM.el("build-add-search").addEventListener("click", addBySearch);
    KM.el("build-add-here").addEventListener("click", addHere);
    KM.el("build-save").addEventListener("click", save);
    KM.el("build-reset").addEventListener("click", function () {
      if (stops.length && !window.confirm("Throw away this route and start over?")) return;
      reset();
    });
    KM.el("build-signin").addEventListener("click", function () { KM.app.openTab("you"); });

    els.desc.addEventListener("input", function () {
      els.descCount.textContent = els.desc.value.length + " / " + KM.sanitize.LIMITS.routeDescription;
    });
    [els.name, els.fareMin, els.fareMax, els.city, els.country, els.desc].forEach(function (el) {
      el.addEventListener("input", KM.debounce(remember, 600));
    });

    els.country.value = KM.config.DEFAULT_COUNTRY;
    restore();
  }

  function buildTypeChips() {
    els.types.textContent = "";
    KM.transit.TYPES.forEach(function (t) {
      if (t.id === "walk") return;    /* a walk is not a route anybody files */
      var chip = KM.mk("button", "km-chip");
      chip.type = "button";
      chip.setAttribute("data-type", t.id);
      var ic = KM.mk("span", "km-chip-icon");
      KM.glyph(ic, t.icon, "ride");
      ic.setAttribute("aria-hidden", "true");
      chip.appendChild(ic);
      chip.appendChild(KM.mk("span", null, t.label));
      chip.addEventListener("click", function () { setType(t.id); remember(); });
      els.types.appendChild(chip);
    });
    setType(typeId);
  }

  function setType(id) {
    typeId = id;
    Array.prototype.forEach.call(els.types.querySelectorAll(".km-chip"), function (c) {
      var on = c.getAttribute("data-type") === id;
      c.classList.toggle("is-on", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  /* ---------------------------------------------------------
     Adding stops
     --------------------------------------------------------- */
  function addStop(stop) {
    if (stops.length >= KM.sanitize.LIMITS.stopsMax) {
      KM.app.toast("That is as many stops as a route can hold.");
      return;
    }
    var c = KM.sanitize.coord(stop.lat, stop.lon);
    if (!c) { KM.app.toast("That is not a place."); return; }
    stops.push({
      lat: c.lat, lon: c.lon,
      name: KM.sanitize.line(stop.name || "", KM.sanitize.LIMITS.placeName) || ("Stop " + (stops.length + 1))
    });
    renderStops();
    redraw();
    remember();
  }

  function addByPin() {
    KM.app.pick({ label: "Drag the map to the stop, then Set here" }).then(function (coord) {
      if (!coord) return;
      /* Add it immediately with a placeholder name and fill the real one in
         when the geocoder answers. Waiting a second for a name before the
         stop appears makes the button feel broken. */
      addStop({ lat: coord.lat, lon: coord.lon, name: "Stop " + (stops.length + 1) });
      var i = stops.length - 1;
      KM.geocode.reverse(coord.lat, coord.lon).then(function (place) {
        if (!stops[i]) return;
        stops[i].name = place.name;
        renderStops();
        remember();
      }, function () {});
    });
  }

  function addBySearch() {
    KM.finder.open({ placeholder: "Search a stop" }).then(function (place) {
      if (place) addStop(place);
    });
  }

  function addHere() {
    KM.map.locate().then(function (fix) {
      addStop({ lat: fix.lat, lon: fix.lon, name: "Where I am" });
      var i = stops.length - 1;
      KM.geocode.reverse(fix.lat, fix.lon).then(function (place) {
        if (!stops[i]) return;
        stops[i].name = place.name;
        renderStops();
        remember();
      }, function () {});
    }, function (err) { KM.app.toast(err.message); });
  }

  /* ---------------------------------------------------------
     The list
     --------------------------------------------------------- */
  function renderStops() {
    els.list.textContent = "";

    if (!stops.length) {
      var li = KM.mk("li", "km-stop-empty", "No stops yet. Add the first one below.");
      els.list.appendChild(li);
      return;
    }

    stops.forEach(function (st, i) {
      var li = KM.mk("li", "km-stop");
      if (i === 0) li.classList.add("is-first");
      if (i === stops.length - 1) li.classList.add("is-last");

      var badge = KM.mk("span", "km-stop-n", i === 0 ? "A" : (i === stops.length - 1 ? "B" : String(i)));
      li.appendChild(badge);

      var name = KM.mk("button", "km-stop-name", st.name);
      name.type = "button";
      name.title = "Rename, or move this stop";
      name.addEventListener("click", function () { editStop(i); });
      li.appendChild(name);

      var tools = KM.mk("div", "km-stop-tools");
      tools.appendChild(toolBtn("up", "Move up", i > 0, function () { move(i, -1); }));
      tools.appendChild(toolBtn("down", "Move down", i < stops.length - 1, function () { move(i, 1); }));
      tools.appendChild(toolBtn("trash", "Remove", true, function () { removeStop(i); }));
      li.appendChild(tools);

      els.list.appendChild(li);
    });
  }

  function toolBtn(iconName, label, enabled, fn) {
    var b = KM.mk("button", "km-icon-btn km-stop-tool");
    b.type = "button";
    KM.glyph(b, iconName);
    b.setAttribute("aria-label", label);
    b.title = label;
    b.disabled = !enabled;
    b.addEventListener("click", fn);
    return b;
  }

  function move(i, delta) {
    var j = i + delta;
    if (j < 0 || j >= stops.length) return;
    var tmp = stops[i]; stops[i] = stops[j]; stops[j] = tmp;
    renderStops();
    redraw();
    remember();
  }

  function removeStop(i) {
    stops.splice(i, 1);
    renderStops();
    redraw();
    remember();
  }

  function editStop(i) {
    var st = stops[i];
    var next = window.prompt("What is this stop called?", st.name);
    if (next === null) return;
    var clean = KM.sanitize.line(next, KM.sanitize.LIMITS.placeName);
    stops[i].name = clean || st.name;
    renderStops();
    remember();
  }

  /* ---------------------------------------------------------
     The line

     Debounced, and every reply carries a token: a fast tap on the up arrow
     three times fires three route requests, and without the token the
     slowest one wins and draws a line for an order nobody is looking at.
     --------------------------------------------------------- */
  var redraw = KM.debounce(function () {
    KM.map.clear("build");
    KM.map.clear("route");
    KM.map.clear("plan");

    stops.forEach(function (st, i) {
      KM.map.dot("build", st, {
        text: i === 0 ? "A" : (i === stops.length - 1 ? "B" : String(i)),
        colour: i === 0 ? "#2E7D4F" : (i === stops.length - 1 ? "#B4562B" : "#1F7A6B"),
        size: (i === 0 || i === stops.length - 1) ? 28 : 22,
        title: st.name,
        z: 400
      });
    });

    if (stops.length < 2) {
      routed = null;
      els.measure.hidden = true;
      if (stops.length === 1) KM.map.centreOn(stops[0], 15);
      return;
    }

    var mine = ++routeToken;
    els.measure.hidden = false;
    els.distance.textContent = "drawing…";
    els.duration.textContent = "";

    KM.router.route(stops).then(function (r) {
      if (mine !== routeToken) return;
      routed = r;
      KM.map.clear("build");
      KM.map.line("build", r.path, { style: "build", weight: 7 });
      stops.forEach(function (st, i) {
        KM.map.dot("build", st, {
          text: i === 0 ? "A" : (i === stops.length - 1 ? "B" : String(i)),
          colour: i === 0 ? "#2E7D4F" : (i === stops.length - 1 ? "#B4562B" : "#1F7A6B"),
          size: (i === 0 || i === stops.length - 1) ? 28 : 22,
          title: st.name,
          z: 400
        });
      });
      KM.map.fit(r.path, { bottom: 260 });
      els.distance.textContent = KM.fmtDist(r.distance);
      els.duration.textContent = KM.fmtDur(r.duration) + " by car";
    }, function (err) {
      if (mine !== routeToken) return;
      routed = null;
      els.distance.textContent = err.message;
      els.duration.textContent = "";
    });
  }, 500);

  /* ---------------------------------------------------------
     Saving
     --------------------------------------------------------- */
  function draft() {
    return {
      name: els.name.value,
      route_type: typeId,
      description: els.desc.value,
      origin_name: stops.length ? stops[0].name : "",
      destination_name: stops.length ? stops[stops.length - 1].name : "",
      city: els.city.value,
      country_code: els.country.value || KM.config.DEFAULT_COUNTRY,
      currency: KM.config.DEFAULT_CURRENCY,
      fare_min: els.fareMin.value,
      fare_max: els.fareMax.value,
      stops: stops,
      path: routed ? routed.path : [],
      distance_m: routed ? routed.distance : 0,
      duration_s: routed ? routed.duration : 0
    };
  }

  function save() {
    els.err.hidden = true;
    els.nameErr.hidden = true;

    if (!KM.supa.signedIn()) {
      KM.app.openTab("you");
      KM.app.toast("Sign in to file a route.");
      return;
    }
    if (!routed) {
      showError("Add at least two stops and let the line draw first.");
      return;
    }

    var btn = KM.el("build-save");
    btn.disabled = true;
    btn.textContent = editingId ? "Saving…" : "Filing…";

    var d = draft();
    var op = editingId ? KM.routes.save(editingId, d) : KM.routes.create(d);

    op.then(function (row) {
      btn.disabled = false;
      btn.textContent = "File this route";
      KM.app.toast(editingId ? "Route updated." : "Route filed. Thank you.");
      reset();
      KM.browse.refresh();
      if (row) KM.detail.open(row, { onClose: function () { KM.app.openTab("browse"); } });
    }, function (err) {
      btn.disabled = false;
      btn.textContent = editingId ? "Save changes" : "File this route";
      if (err.fields && err.fields.name) {
        els.nameErr.textContent = err.fields.name;
        els.nameErr.hidden = false;
      }
      showError(err.message);
    });
  }

  function showError(msg) {
    els.err.textContent = msg;
    els.err.hidden = false;
  }

  /* ---------------------------------------------------------
     Loading one back in, and not losing one halfway
     --------------------------------------------------------- */
  function load(route) {
    editingId = route.id;
    stops = (route.stops || []).slice();
    routed = { path: route.path, distance: route.distance_m, duration: route.duration_s, legs: [] };
    setType(route.route_type);
    els.name.value = route.name || "";
    els.desc.value = route.description || "";
    els.descCount.textContent = els.desc.value.length + " / " + KM.sanitize.LIMITS.routeDescription;
    els.city.value = route.city || "";
    els.country.value = route.country_code || KM.config.DEFAULT_COUNTRY;
    els.fareMin.value = route.fare_min == null ? "" : route.fare_min;
    els.fareMax.value = route.fare_max == null ? "" : route.fare_max;
    KM.el("build-save").textContent = "Save changes";
    renderStops();
    redraw();
  }

  function reset() {
    stops = [];
    routed = null;
    editingId = null;
    els.name.value = "";
    els.desc.value = "";
    els.descCount.textContent = "0 / " + KM.sanitize.LIMITS.routeDescription;
    els.fareMin.value = "";
    els.fareMax.value = "";
    els.city.value = "";
    els.err.hidden = true;
    els.nameErr.hidden = true;
    els.measure.hidden = true;
    KM.el("build-save").textContent = "File this route";
    setType("jeepney");
    renderStops();
    KM.map.clear("build");
    KM.store.remove(DRAFT_KEY);
  }

  /* A route half-filed is worth keeping. This is the only thing the
     builder writes down, it never leaves the phone, and Save clears it. */
  function remember() {
    if (!stops.length && !els.name.value) { KM.store.remove(DRAFT_KEY); return; }
    KM.store.set(DRAFT_KEY, {
      editingId: editingId,
      stops: stops,
      typeId: typeId,
      name: els.name.value,
      desc: els.desc.value,
      city: els.city.value,
      country: els.country.value,
      fareMin: els.fareMin.value,
      fareMax: els.fareMax.value
    });
  }

  function restore() {
    var d = KM.store.get(DRAFT_KEY, null);
    if (!d) { renderStops(); return; }
    editingId = d.editingId || null;
    stops = (d.stops || []).filter(function (s) { return KM.sanitize.coord(s.lat, s.lon); });
    setType(d.typeId || "jeepney");
    els.name.value = d.name || "";
    els.desc.value = d.desc || "";
    els.descCount.textContent = els.desc.value.length + " / " + KM.sanitize.LIMITS.routeDescription;
    els.city.value = d.city || "";
    els.country.value = d.country || KM.config.DEFAULT_COUNTRY;
    els.fareMin.value = d.fareMin || "";
    els.fareMax.value = d.fareMax || "";
    if (editingId) KM.el("build-save").textContent = "Save changes";
    renderStops();
    if (stops.length >= 2) redraw();
  }

  /* Shown when the pane opens: the form, or the reason it is not usable. */
  function activate() {
    var inOut = !KM.supa.signedIn();
    els.locked.hidden = !inOut;
    els.form.hidden = inOut;
    if (!inOut) redraw();
  }

  return {
    init: init,
    activate: activate,
    load: load,
    reset: reset,
    /* Exposed so the harness can build a draft without a DOM. */
    _stops: function () { return stops; }
  };
})();

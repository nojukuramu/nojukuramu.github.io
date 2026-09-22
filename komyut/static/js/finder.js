/* ============================================================
   TheCommuters — picking a place

   One sheet, used by the trip planner and the route builder alike, with
   three ways to name a point and no preference between them:

     * where you are, from the phone
     * a pin dropped on the map
     * a place searched for by name

   It is one module rather than two because the two callers need exactly
   the same thing, and because a second copy of "search a place" is how one
   of them ends up with a Philippines bias and the other without.

   Everything the geocoder returns is rendered with textContent. A place
   name in OpenStreetMap is written by a stranger the same way a route name
   here is, and it gets the same treatment.
   ============================================================ */
var KM = KM || {};

KM.finder = (function () {
  "use strict";

  var sheet, input, results, hereRow, pinRow;
  var resolveOpen = null;
  var searching = null;

  function init() {
    sheet = KM.el("finder");
    input = KM.el("finder-q");
    results = KM.el("finder-results");
    hereRow = KM.el("finder-here");
    pinRow = KM.el("finder-pin");

    KM.glyph(KM.el("finder-back"), "back");
    KM.glyph(hereRow.querySelector(".km-finder-icon"), "location");
    KM.glyph(pinRow.querySelector(".km-finder-icon"), "pin");

    KM.el("finder-back").addEventListener("click", function () { close(null); });

    hereRow.addEventListener("click", function () {
      hereRow.disabled = true;
      KM.map.locate().then(function (fix) {
        hereRow.disabled = false;
        return KM.geocode.reverse(fix.lat, fix.lon).then(function (place) {
          close({ lat: fix.lat, lon: fix.lon, name: place.name });
        }, function () {
          close({ lat: fix.lat, lon: fix.lon, name: "Where I am" });
        });
      }, function (err) {
        hereRow.disabled = false;
        KM.app.toast(err.message);
      });
    });

    pinRow.addEventListener("click", function () {
      hide();
      KM.app.pick({ label: "Drag the map to place the pin" }).then(function (coord) {
        if (!coord) { show(); return; }
        /* Name it from the map rather than leaving a stop called
           "14.6512, 121.0483" for everybody else to read. */
        KM.geocode.reverse(coord.lat, coord.lon).then(function (place) {
          close({ lat: coord.lat, lon: coord.lon, name: place.name });
        }, function () {
          close({ lat: coord.lat, lon: coord.lon, name: "Dropped pin" });
        });
      });
    });

    input.addEventListener("input", KM.debounce(run, 420));
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); run(); }
      if (e.key === "Escape") close(null);
    });
  }

  function run() {
    var q = KM.sanitize.line(input.value, KM.sanitize.LIMITS.search);
    if (searching) { try { searching.abort(); } catch (e) {} }
    if (q.length < 2) { results.textContent = ""; return; }

    var ctrl = ("AbortController" in window) ? new AbortController() : null;
    searching = ctrl;

    results.textContent = "";
    results.appendChild(KM.mk("p", "km-empty", "Searching…"));

    var near = KM.map.lastKnown() || KM.map.centreCoord();
    KM.geocode.search(q, { near: near, limit: 8, signal: ctrl ? ctrl.signal : undefined })
      .then(function (places) {
        if (searching !== ctrl) return;
        render(places);
      }, function (err) {
        if (searching !== ctrl || (err && err.kind === "abort")) return;
        results.textContent = "";
        results.appendChild(KM.mk("p", "km-empty", "Could not search just now."));
      });
  }

  function render(places) {
    results.textContent = "";
    if (!places.length) {
      results.appendChild(KM.mk("p", "km-empty", "Nothing found. Try a district or a landmark."));
      return;
    }
    places.forEach(function (p) {
      var row = KM.mk("button", "km-finder-row");
      row.type = "button";
      var icon = KM.mk("span", "km-finder-icon");
      KM.glyph(icon, "pin");
      row.appendChild(icon);

      var text = KM.mk("span", "km-finder-text");
      text.appendChild(KM.mk("span", "km-finder-name", p.name));
      text.appendChild(KM.mk("span", "km-finder-addr", p.address));
      row.appendChild(text);

      row.addEventListener("click", function () {
        close({ lat: p.lat, lon: p.lon, name: p.name });
      });
      results.appendChild(row);
    });
  }

  /* open({title}) -> Promise<{lat, lon, name} | null> */
  function open(opts) {
    opts = opts || {};
    input.value = "";
    results.textContent = "";
    input.placeholder = opts.placeholder || "Search a place";
    show();
    try { input.focus(); } catch (e) {}
    return new Promise(function (resolve) { resolveOpen = resolve; });
  }

  function show() { sheet.hidden = false; }
  function hide() { sheet.hidden = true; }

  function close(value) {
    hide();
    var r = resolveOpen;
    resolveOpen = null;
    /* Whatever route the finder was left by, the sheet comes back. Dropping
       a pin closes the sheet to clear the map, and backing out of the
       finder afterwards used to leave somebody on a bare map with nothing
       chosen and no way back but the tab bar. */
    if (KM.app && KM.app.setSheet) KM.app.setSheet(true);
    if (r) r(value);
  }

  return { init: init, open: open, isOpen: function () { return !!resolveOpen; }, close: close };
})();

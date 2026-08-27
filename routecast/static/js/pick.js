/* ============================================================
   RouteCast — centre-pin place picker
   The classic "move the map, the pin stays in the middle" picker used for
   Start, any Stop, and Destination. The pin is fixed to the screen centre
   by CSS; this module only drives state, reverse geocoding and callbacks.
   ============================================================ */
RC.pick = (function () {
  "use strict";

  var map = null;
  var els = {};

  var active = false;
  var target = null;
  var seq = 0;           // monotonically increasing; guards against stale reverse-geocode replies
  var currentPlace = null; // last known {name, address, kind} from reverse geocode (lat/lon ignored — centre always wins)

  var moveStartHandler = null;
  var moveEndHandler = null;
  var debouncedReverse = null;

  function fmtCoord(lat, lon) {
    return lat.toFixed(5) + ", " + lon.toFixed(5);
  }

  function setLabel(text, sub) {
    if (els.label) els.label.textContent = text;
    if (els.sub) els.sub.textContent = sub || "";
  }

  function show(visible) {
    if (!els.root) return;
    els.root.hidden = !visible;
    if (els.root.classList) {
      if (visible) els.root.classList.add("is-active");
      else els.root.classList.remove("is-active");
    }
  }

  // Leaflet's LatLng exposes .lng; the rest of the app speaks {lat, lon}.
  // Normalise at the boundary so no caller ever sees an undefined longitude.
  function mapCenter() {
    var c = map.getCenter();
    return { lat: c.lat, lon: c.lng };
  }

  // Build the Place that will actually be handed back: coordinates are
  // ALWAYS the exact map centre, never whatever Nominatim snapped to.
  function placeFromCenter(center, geocoded) {
    var name = (geocoded && geocoded.name) ? geocoded.name : fmtCoord(center.lat, center.lon);
    var address = (geocoded && geocoded.address) ? geocoded.address : "";
    var kind = (geocoded && geocoded.kind) ? geocoded.kind : "";
    return { name: name, address: address, lat: center.lat, lon: center.lon, kind: kind };
  }

  function doReverse() {
    if (!active || !map) return;
    var mySeq = ++seq;
    var c = mapCenter();

    RC.geocode.reverse(c.lat, c.lon).then(function (place) {
      if (!active || mySeq !== seq) return; // superseded by a later move — discard
      currentPlace = place;
      setLabel(place.name, place.address);
    }, function () {
      if (!active || mySeq !== seq) return;
      currentPlace = null;
      setLabel(fmtCoord(c.lat, c.lon), "");
    });
  }

  function onMoveStart() {
    if (els.pin && els.pin.classList) els.pin.classList.add("is-moving");
    setLabel("Locating…", "");
  }

  function onMoveEnd() {
    if (els.pin && els.pin.classList) els.pin.classList.remove("is-moving");
    if (debouncedReverse) debouncedReverse();
  }

  function onKeyDown(e) {
    var key = e.key || "";
    if (key === "Escape" || key === "Esc" || e.keyCode === 27) cancel();
  }

  function onConfirmClick() { confirm(); }
  function onCancelClick() { cancel(); }

  // Tear down listeners/UI without invoking either callback. Safe to call
  // repeatedly and used both by the public stop() and internally when
  // start() is re-entered for a different target.
  function teardown() {
    active = false;
    seq++; // invalidate anything in flight

    if (map) {
      if (moveStartHandler) map.off("movestart", moveStartHandler);
      if (moveEndHandler) map.off("moveend", moveEndHandler);
    }
    moveStartHandler = null;
    moveEndHandler = null;

    try { document.removeEventListener("keydown", onKeyDown); } catch (e) {}
    if (els.confirm && els.confirm.removeEventListener) els.confirm.removeEventListener("click", onConfirmClick);
    if (els.cancel && els.cancel.removeEventListener) els.cancel.removeEventListener("click", onCancelClick);
    if (els.pin && els.pin.classList) els.pin.classList.remove("is-moving");

    show(false);
  }

  function confirm() {
    if (!active || !map) return;
    var c = mapCenter();
    var place = placeFromCenter(c, currentPlace);
    var t = target;
    teardown();
    if (typeof RC.pick.onConfirm === "function") RC.pick.onConfirm(t, place);
  }

  function cancel() {
    if (!active) return;
    var t = target;
    teardown();
    if (typeof RC.pick.onCancel === "function") RC.pick.onCancel(t);
  }

  function init(opts) {
    opts = opts || {};
    map = opts.map || null;
    els = opts.els || {};
    debouncedReverse = RC.debounce(doReverse, 450);
  }

  function start(tgt, opts) {
    opts = opts || {};
    if (active) teardown(); // switching fields — drop old listeners, don't fire onCancel
    if (!map) return;

    target = tgt;
    currentPlace = null;
    seq++; // invalidate any stale reply from a previous session

    if (opts.center && typeof opts.center.lat === "number" && typeof opts.center.lon === "number") {
      if (typeof map.setView === "function") {
        var z = (typeof map.getZoom === "function") ? map.getZoom() : undefined;
        map.setView([opts.center.lat, opts.center.lon], z);
      } else if (typeof map.panTo === "function") {
        map.panTo([opts.center.lat, opts.center.lon]);
      }
    }

    active = true;
    show(true);
    setLabel(opts.title || "Locating…", "");

    moveStartHandler = onMoveStart;
    moveEndHandler = onMoveEnd;
    map.on("movestart", moveStartHandler);
    map.on("moveend", moveEndHandler);

    document.addEventListener("keydown", onKeyDown);
    if (els.confirm && els.confirm.addEventListener) els.confirm.addEventListener("click", onConfirmClick);
    if (els.cancel && els.cancel.addEventListener) els.cancel.addEventListener("click", onCancelClick);

    // Resolve an address for the initial centre without waiting for a move.
    doReverse();
  }

  function stop() {
    if (!active) return; // idempotent — safe to call twice
    teardown();
  }

  function isActive() { return active; }

  return {
    init: init,
    start: start,
    stop: stop,
    isActive: isActive,
    onConfirm: null,
    onCancel: null
  };
})();

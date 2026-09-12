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
  var moveHandler = null;
  var debouncedReverse = null;

  function fmtCoord(lat, lon) {
    return lat.toFixed(5) + ", " + lon.toFixed(5);
  }

  function setLabel(text, sub) {
    if (els.label) els.label.textContent = text;
    if (els.sub) els.sub.textContent = sub || "";
  }

  /* The coordinate readout is not decoration. It is the contract: whatever
     name the reverse geocoder settles on, THIS pair of numbers is what gets
     saved and routed to. Showing it is how the rider can tell the picker
     apart from a search box that quietly snaps to a landmark. */
  function setCoord(center) {
    if (!els.coord) return;
    els.coord.textContent = center ? fmtCoord(center.lat, center.lon) : "";
  }

  function setTitle(text) {
    if (els.title && text) els.title.textContent = text;
  }

  /* The pin and its card are separate elements in separate stacking contexts
     — the pin has to sit inside the map to be centred on it, the card has to
     sit outside the map to be above the panel — so both are shown and hidden
     together here rather than by nesting. */
  function show(visible) {
    [els.root, els.card].forEach(function (el) {
      if (!el) return;
      el.hidden = !visible;
      if (!el.classList) return;
      if (visible) el.classList.add("is-active");
      else el.classList.remove("is-active");
    });
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
    // precise: this came from a coordinate the user aimed at, not from a
    // geocoder's opinion about where an address is.
    return { name: name, address: address, lat: center.lat, lon: center.lon, kind: kind, precise: true };
  }

  function doReverse() {
    if (!active || !map) return;
    var mySeq = ++seq;
    var c = mapCenter();
    setCoord(c);

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
    if (map) setCoord(mapCenter());
  }

  function onMoveEnd() {
    if (els.pin && els.pin.classList) els.pin.classList.remove("is-moving");
    if (map) setCoord(mapCenter());
    if (debouncedReverse) debouncedReverse();
  }

  // The numbers track the pin continuously; only the NAME waits for the
  // debounced network call, because Nominatim is rate limited and the
  // coordinate is not.
  function onMove() {
    if (map) setCoord(mapCenter());
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
    if (map && moveHandler) map.off("move", moveHandler);
    moveStartHandler = null;
    moveEndHandler = null;
    moveHandler = null;

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
    setTitle(opts.title);
    setLabel("Locating…", "");
    setCoord(mapCenter());

    moveStartHandler = onMoveStart;
    moveEndHandler = onMoveEnd;
    moveHandler = onMove;
    map.on("movestart", moveStartHandler);
    map.on("moveend", moveEndHandler);
    map.on("move", moveHandler);

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

  /* What the pin is over right now, as the Place it would confirm to. Used
     by "Save as mark", which has to be able to keep a spot WITHOUT setting
     it as a route endpoint — marking the fuel stop you noticed on the way
     past is not the same as agreeing to route through it. */
  function current() {
    if (!active || !map) return null;
    return placeFromCenter(mapCenter(), currentPlace);
  }

  return {
    init: init,
    start: start,
    stop: stop,
    current: current,
    isActive: isActive,
    onConfirm: null,
    onCancel: null
  };
})();

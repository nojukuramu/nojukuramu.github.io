/* ============================================================
   KomyutApp — inline SVG icon set

   The repository rule is no emoji: every glyph is drawn. The stroke style
   is the one RouteCast and the parent site already use — viewBox 0 0 24 24,
   fill none, stroke currentColor, width 1.7, round caps and joins — so an
   icon lifted from there sits beside one drawn here without looking like a
   guest.

   KM.icons.ride(name)  -> a vehicle glyph (jeepney, tricycle, bus, ...)
   KM.icons.ui(name)    -> an interface glyph
   KM.icons.weather(nm) -> the RouteCast weather set, unchanged

   ES5 only.
   ============================================================ */
var KM = KM || {};

KM.icons = (function () {
  "use strict";

  var OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var CLOSE = '</svg>';
  function wrap(inner) { return OPEN + inner + CLOSE; }

  /* ---------- the vehicles ----------
     Drawn as silhouettes at a consistent weight rather than as accurate
     pictures: at 20px a jeepney and a van are the same handful of strokes,
     so what distinguishes them has to be one deliberate feature each — the
     jeepney its long body and side bench, the tricycle its sidecar, the
     habal-habal its rider. */
  var wheels = '<circle cx="7.6" cy="17.2" r="1.9"/><circle cx="16.4" cy="17.2" r="1.9"/>';

  var rideIcons = {
    /* long flat body, roof line, bench window strip */
    jeepney: wrap(
      '<path d="M2.6 17.2V9.6a1.6 1.6 0 0 1 1.6-1.6h11.9l3.6 3.2h1.7a1.6 1.6 0 0 1 1.6 1.6v4.4h-2.6"/>' +
      '<path d="M9.5 17.2h5"/><path d="M5.2 10.6h9.4v2.6H5.2z"/>' + wheels),

    bus: wrap(
      '<rect x="3" y="4.6" width="18" height="12.6" rx="2.2"/>' +
      '<path d="M3 9.4h18M9.6 4.6v4.8M14.4 4.6v4.8M3 13.6h18"/>' +
      '<path d="M6.6 19.4v1.6M17.4 19.4v1.6"/><circle cx="7" cy="17.2" r="1.3"/><circle cx="17" cy="17.2" r="1.3"/>'),

    /* a body with a sidecar bolted to its right */
    tricycle: wrap(
      '<path d="M3.4 16.6V12a1.5 1.5 0 0 1 1.5-1.5h4.3l1.8 2.4h2.4v3.7"/>' +
      '<path d="M13.4 12.9h5.1a1.5 1.5 0 0 1 1.5 1.5v2.2"/>' +
      '<circle cx="6" cy="17.6" r="1.7"/><circle cx="18.6" cy="17.6" r="1.7"/>' +
      '<path d="M9.6 10.5 11 7.2h2.3"/>'),

    motorcycle: wrap(
      '<circle cx="5.4" cy="16.4" r="2.9"/><circle cx="18.6" cy="16.4" r="2.9"/>' +
      '<path d="M5.4 16.4h4.2l3.6-5h2.8l2.6 5"/><path d="M9.8 11.4h4.4M15.4 8.2h2.6"/>'),

    van: wrap(
      '<path d="M2.6 16.4v-5.2a1.8 1.8 0 0 1 1.8-1.8h9.8l4.4 3.4h2.2a1.2 1.2 0 0 1 1.2 1.2v2.4h-2"/>' +
      '<path d="M9.4 16.4h5.2"/><path d="M5.4 11.4h5.4v2.4H5.4z"/>' + wheels),

    train: wrap(
      '<rect x="5" y="3.4" width="14" height="12.4" rx="3"/>' +
      '<path d="M5 9.2h14M9.8 12.8h.01M14.2 12.8h.01"/>' +
      '<path d="M8.4 15.8 6 20.6M15.6 15.8 18 20.6M4.6 20.6h14.8"/>'),

    ferry: wrap(
      '<path d="M3.4 15.4 5 10.2h14l1.6 5.2"/><path d="M7.2 10.2V6.6h9.6v3.6"/>' +
      '<path d="M12 3.4v3.2"/>' +
      '<path d="M2.4 18.4c1.6 0 1.6 1.6 3.2 1.6s1.6-1.6 3.2-1.6 1.6 1.6 3.2 1.6 1.6-1.6 3.2-1.6 1.6 1.6 3.2 1.6 1.6-1.6 3.2-1.6"/>'),

    pedicab: wrap(
      '<circle cx="5.6" cy="16.8" r="2.6"/><circle cx="18.4" cy="16.8" r="2.6"/>' +
      '<path d="M5.6 16.8 9 8.6h3.4l2.6 8.2"/><path d="M12.4 12.6h6a1.6 1.6 0 0 1 1.6 1.6v1.2"/>' +
      '<path d="M8.4 8.6h3.6"/>'),

    walk: wrap(
      '<circle cx="13" cy="4.4" r="1.9"/>' +
      '<path d="M11.4 20.6 13 15l-2.6-2.6.8-4.2 3 1.6 2.4 2.2"/>' +
      '<path d="M10.4 8.2 7.6 10 6.4 13.4M13 15l2.6 5.6"/>'),

    route: wrap(
      '<circle cx="6" cy="6" r="2.6"/><circle cx="18" cy="18" r="2.6"/>' +
      '<path d="M8.6 6h5.4a3 3 0 0 1 0 6h-4a3 3 0 0 0 0 6h5.4"/>')
  };

  /* ---------- interface ---------- */
  var uiIcons = {
    search: wrap('<circle cx="11" cy="11" r="6.8"/><path d="M19.8 19.8l-4.1-4.1"/>'),
    close: wrap('<path d="M6 6l12 12M18 6L6 18"/>'),
    plus: wrap('<path d="M12 5v14M5 12h14"/>'),
    minus: wrap('<path d="M5 12h14"/>'),
    check: wrap('<path d="M4.5 12.6 9.4 17.5 19.5 6.8"/>'),
    back: wrap('<path d="M16 5l-7 7 7 7M9.5 12H21"/>'),
    chevron: wrap('<path d="M8 5l7 7-7 7"/>'),
    up: wrap('<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>'),
    down: wrap('<path d="M12 5v14M5.5 12.5 12 19l6.5-6.5"/>'),
    pin: wrap('<path d="M12 21.5s-6.8-6.3-6.8-11.3a6.8 6.8 0 1 1 13.6 0c0 5-6.8 11.3-6.8 11.3Z"/><circle cx="12" cy="10.2" r="2.3"/>'),
    location: wrap('<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="8"/><path d="M12 1.6v2.6M12 19.8v2.6M22.4 12h-2.6M4.2 12H1.6"/>'),
    swap: wrap('<path d="M7 4v14M3.6 14.6 7 18l3.4-3.4"/><path d="M17 20V6M13.6 9.4 17 6l3.4 3.4"/>'),
    user: wrap('<circle cx="12" cy="8" r="3.6"/><path d="M4.6 20c.8-3.9 3.7-6.2 7.4-6.2s6.6 2.3 7.4 6.2"/>'),
    chat: wrap('<path d="M20.5 12.2c0 4-3.8 7.2-8.5 7.2a9.8 9.8 0 0 1-2.8-.4L4.5 20.5l1.3-3.7a6.9 6.9 0 0 1-2.3-5c0-4 3.8-7.3 8.5-7.3s8.5 3.3 8.5 7.7Z"/>'),
    shield: wrap('<path d="M12 2.6 4.6 5.6v6.1c0 4.4 3 8.2 7.4 9.7 4.4-1.5 7.4-5.3 7.4-9.7V5.6Z"/><path d="M8.8 12.1 11 14.3l4.2-4.4"/>'),
    star: wrap('<path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8Z"/>'),
    flag: wrap('<path d="M5.5 21V3.8M5.5 4.6h11.8l-2.1 3.8 2.1 3.8H5.5"/>'),
    trash: wrap('<path d="M4.6 6.6h14.8M9.4 6.6V4.8h5.2v1.8"/><path d="M6.6 6.6 7.6 20a1.2 1.2 0 0 0 1.2 1.1h6.4a1.2 1.2 0 0 0 1.2-1.1l1-13.4"/>'),
    edit: wrap('<path d="M4.6 19.4h3.2L18.2 9a2.3 2.3 0 0 0-3.2-3.2L4.6 16.2Z"/><path d="M13.8 7 17 10.2"/>'),
    clock: wrap('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>'),
    money: wrap('<rect x="2.6" y="6.4" width="18.8" height="11.2" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6.2 12h.01M17.8 12h.01"/>'),
    filter: wrap('<path d="M3.4 5.6h17.2L14 13v5.4l-4 2.2V13Z"/>'),
    transfer: wrap('<path d="M4 8.4h13.4M14 5l3.4 3.4L14 11.8"/><path d="M20 15.6H6.6M10 12.2 6.6 15.6 10 19"/>'),
    signout: wrap('<path d="M14.6 7.4V5.6a1.8 1.8 0 0 0-1.8-1.8H5.6a1.8 1.8 0 0 0-1.8 1.8v12.8a1.8 1.8 0 0 0 1.8 1.8h7.2a1.8 1.8 0 0 0 1.8-1.8v-1.8"/><path d="M9.4 12h11M17 8.4l3.6 3.6-3.6 3.6"/>'),
    alert: wrap('<path d="M12 3.6 1.9 20.4h20.2Z"/><path d="M12 9.6v4.6M12 17.4h.01"/>'),
    refresh: wrap('<path d="M20.4 11.4a8.4 8.4 0 1 0-.7 4.6"/><path d="M21 7.4v4.6h-4.6"/>'),
    info: wrap('<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.4M12 7.8h.01"/>'),
    menu: wrap('<path d="M4 7h16M4 12h16M4 17h10"/>'),
    weatherpin: wrap('<path d="M6.5 15.5a3.6 3.6 0 0 1-.4-7.2A5 5 0 0 1 15.9 6.6a3.9 3.9 0 0 1-.4 8.9Z"/><path d="M8.6 18.4 7.6 21M12 18.4 11 21M15.4 18.4 14.4 21"/>'),
    install: wrap('<path d="M12 3v12.5M7 11l5 5 5-5"/><path d="M4.5 17.5V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1.5"/>')
  };

  /* ---------- weather, unchanged from RouteCast ---------- */
  var sunRays = '<circle cx="12" cy="12" r="4.2"/>' +
    '<path d="M12 2.5v2.6M12 18.9v2.6M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12h2.6M18.9 12h2.6' +
    'M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/>';
  var cloudPath = 'M6.5 18.5a4 4 0 0 1-.4-7.98A5.5 5.5 0 0 1 16.9 9.1 4.25 4.25 0 0 1 16.5 18.5h-10Z';

  var weatherIcons = {
    clear: wrap(sunRays),
    partly: wrap('<path d="M8.2 14.5a3.5 3.5 0 1 1 .53-6.96A4.75 4.75 0 0 1 17.9 9.3a3.6 3.6 0 0 1-.4 7.2H8.7a3.5 3.5 0 0 1-.5-2Z"/><path d="M5.4 4.4l1.3 1.3M3 9h1.9"/>'),
    cloud: wrap('<path d="' + cloudPath + '"/>'),
    fog: wrap('<path d="M6.5 11.5a4 4 0 0 1-.4-7.98A5.5 5.5 0 0 1 16.9 5.1a4.25 4.25 0 0 1-.4 6.4h-10Z"/><path d="M3.5 15.5h17M3.5 19h17M7 19v0"/>'),
    drizzle: wrap('<path d="' + cloudPath + '" transform="translate(0,-3)"/><path d="M8.5 18v1.6M12 18v1.6M15.5 18v1.6"/>'),
    rain: wrap('<path d="' + cloudPath + '" transform="translate(0,-3)"/><path d="M7.5 17.5l-1.2 3M12 17.5l-1.2 3M16.5 17.5l-1.2 3"/>'),
    "heavy-rain": wrap('<path d="' + cloudPath + '" transform="translate(0,-3.5)"/><path d="M6.5 16.8l-1.6 4M10.5 16.8l-1.6 4M14.5 16.8l-1.6 4M18.2 16.8l-1.6 4"/>'),
    snow: wrap('<path d="' + cloudPath + '" transform="translate(0,-3)"/><path d="M8.4 18.6v2M7.4 19.6h2M12 18.6v2M11 19.6h2M15.6 18.6v2M14.6 19.6h2"/>'),
    thunder: wrap('<path d="' + cloudPath + '" transform="translate(0,-3.2)"/><path d="m12.6 15.4-3 3.6h2.6l-1 3.2 3.4-4h-2.6Z"/>')
  };

  /* An unknown name must still draw something. A blank space where an icon
     belongs reads as a broken page; a neutral dot reads as "no icon for
     this yet", which is the truth. */
  var FALLBACK = wrap('<circle cx="12" cy="12" r="7.4"/>');

  return {
    ride: function (name) { return rideIcons[name] || FALLBACK; },
    ui: function (name) { return uiIcons[name] || FALLBACK; },
    weather: function (name) { return weatherIcons[name] || FALLBACK; },
    rideNames: function () { return Object.keys(rideIcons); },
    uiNames: function () { return Object.keys(uiIcons); },
    weatherNames: function () { return Object.keys(weatherIcons); }
  };
})();

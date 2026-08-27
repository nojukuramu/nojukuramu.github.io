/* ============================================================
   RouteCast — inline SVG icon set
   RC.icons.weather(name) -> weather glyph SVG string
   RC.icons.ui(name)      -> UI glyph SVG string
   Stroke style matches the parent site: viewBox 0 0 24 24, fill none,
   stroke currentColor, stroke-width 1.7, round caps/joins.
   ES5 syntax only.
   ============================================================ */
var RC = RC || {};

RC.icons = (function () {
  "use strict";

  var OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var CLOSE = '</svg>';

  function wrap(inner) {
    return OPEN + inner + CLOSE;
  }

  /* ---------- weather glyphs ---------- */

  var sunRays = '<circle cx="12" cy="12" r="4.2"/>' +
    '<path d="M12 2.5v2.6M12 18.9v2.6M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12h2.6M18.9 12h2.6' +
    'M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8"/>';

  var cloudPath = 'M6.5 18.5a4 4 0 0 1-.4-7.98A5.5 5.5 0 0 1 16.9 9.1 4.25 4.25 0 0 1 16.5 18.5h-10Z';

  var weatherIcons = {
    clear: wrap(sunRays),

    partly: wrap(
      '<path d="M8.2 14.5a3.5 3.5 0 1 1 .53-6.96A4.75 4.75 0 0 1 17.9 9.3a3.6 3.6 0 0 1-.4 7.2H8.7a3.5 3.5 0 0 1-.5-2Z"/>' +
      '<path d="M5.4 4.4l1.3 1.3M3 9h1.9"/>'
    ),

    cloud: wrap('<path d="' + cloudPath + '"/>'),

    fog: wrap(
      '<path d="M6.5 11.5a4 4 0 0 1-.4-7.98A5.5 5.5 0 0 1 16.9 5.1a4.25 4.25 0 0 1-.4 6.4h-10Z"/>' +
      '<path d="M3.5 15.5h17M3.5 19h17M7 19v0"/>'
    ),

    drizzle: wrap(
      '<path d="' + cloudPath + '" transform="translate(0,-3)"/>' +
      '<path d="M8.5 18v1.6M12 18v1.6M15.5 18v1.6"/>'
    ),

    rain: wrap(
      '<path d="' + cloudPath + '" transform="translate(0,-3)"/>' +
      '<path d="M7.5 17.5l-1.2 3M12 17.5l-1.2 3M16.5 17.5l-1.2 3"/>'
    ),

    "heavy-rain": wrap(
      '<path d="' + cloudPath + '" transform="translate(0,-3.5)"/>' +
      '<path d="M6.5 16.8l-1.6 4M10.5 16.8l-1.6 4M14.5 16.8l-1.6 4M18.2 16.8l-1.6 4"/>'
    ),

    snow: wrap(
      '<path d="' + cloudPath + '" transform="translate(0,-3)"/>' +
      '<path d="M8 18v3.2M6.5 19.6h3M12 18v3.2M10.5 19.6h3M16 18v3.2M14.5 19.6h3"/>'
    ),

    thunder: wrap(
      '<path d="' + cloudPath + '" transform="translate(0,-3.5)"/>' +
      '<path d="M12.3 15.5l-2.6 4.2h2.7l-1.6 3.3 3.9-4.7h-2.6z"/>'
    )
  };

  var weatherFallback = wrap('<circle cx="12" cy="12" r="8"/><path d="M12 8v5M12 16.2v.1"/>');

  /* ---------- UI glyphs ---------- */

  var uiIcons = {
    car: wrap(
      '<path d="M4.5 16.5V12l1.7-4.3A2 2 0 0 1 8 6.4h8a2 2 0 0 1 1.8 1.3L19.5 12v4.5"/>' +
      '<path d="M4.5 16.5h15v2.2a1 1 0 0 1-1 1h-1.3a1 1 0 0 1-1-1v-1.2h-8.4v1.2a1 1 0 0 1-1 1H5.5a1 1 0 0 1-1-1v-2.2Z"/>' +
      '<path d="M4.5 12h15M8 12V8.4M16 12V8.4"/><circle cx="7.5" cy="16.5" r=".15"/><circle cx="16.5" cy="16.5" r=".15"/>'
    ),

    motorcycle: wrap(
      '<circle cx="5.5" cy="17" r="2.6"/><circle cx="18.5" cy="17" r="2.6"/>' +
      '<path d="M5.5 17l3.5-6h4.3l1 2.4h3.3l1.9 3.6M9 11l-1.7-2.6h3M13.3 11l1.6-2.6"/>'
    ),

    pin: wrap(
      '<path d="M12 21.5s-6.8-6.3-6.8-11.3a6.8 6.8 0 1 1 13.6 0c0 5-6.8 11.3-6.8 11.3Z"/>' +
      '<circle cx="12" cy="10.2" r="2.3"/>'
    ),

    flag: wrap(
      '<path d="M6 21V4"/><path d="M6 4.5c1.6-1 3.4-1 5 0s3.4 1 5 0v8c-1.6 1-3.4 1-5 0s-3.4-1-5 0Z"/>'
    ),

    search: wrap('<circle cx="11" cy="11" r="6.8"/><path d="M19.8 19.8l-4.1-4.1"/>'),

    location: wrap(
      '<path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3"/><circle cx="12" cy="12" r="4.6"/>'
    ),

    swap: wrap(
      '<path d="M6.5 4v13.5M6.5 4L3 7.5M6.5 4L10 7.5"/>' +
      '<path d="M17.5 20V6.5M17.5 20L21 16.5M17.5 20L14 16.5"/>'
    ),

    plus: wrap('<path d="M12 5v14M5 12h14"/>'),

    close: wrap('<path d="M6 6l12 12M18 6L6 18"/>'),

    clock: wrap('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>'),

    wind: wrap(
      '<path d="M3 8h11a2.6 2.6 0 1 0-2.4-3.6"/>' +
      '<path d="M3 12.5h14.5a2.6 2.6 0 1 1-2.4 3.6"/>' +
      '<path d="M3 17h8.5a2.1 2.1 0 1 1-1.9 3"/>'
    ),

    drop: wrap(
      '<path d="M12 2.8s6 7 6 11.4a6 6 0 1 1-12 0c0-4.4 6-11.4 6-11.4Z"/>'
    ),

    eye: wrap(
      '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/>' +
      '<circle cx="12" cy="12" r="2.8"/>'
    ),

    thermo: wrap(
      '<path d="M12 14.5V4.8a2 2 0 1 0-4 0v9.7a4 4 0 1 0 4 0Z"/><circle cx="10" cy="16.8" r="1.1"/>'
    ),

    sun: wrap(sunRays),

    moon: wrap('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'),

    chevron: wrap('<path d="M8 5l7 7-7 7"/>'),

    back: wrap('<path d="M16 5l-7 7 7 7M9.5 12H21"/>'),

    alert: wrap(
      '<path d="M12 3.5L2.5 20.5h19L12 3.5Z"/><path d="M12 9.8v4.2M12 17.3v.1"/>'
    )
  };

  var uiFallback = wrap('<circle cx="12" cy="12" r="8.5"/>');

  return {
    weather: function (name) {
      return weatherIcons.hasOwnProperty(name) ? weatherIcons[name] : weatherFallback;
    },
    ui: function (name) {
      return uiIcons.hasOwnProperty(name) ? uiIcons[name] : uiFallback;
    }
  };
})();

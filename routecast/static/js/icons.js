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

    /* Somebody is at the door: a closed door with a knock beside the handle.
       Used for the group ride's approval queue, which is the one decision in
       the app that has a safety consequence. */
    knock: wrap(
      '<path d="M5.5 20.5V4.6a1 1 0 0 1 1-1h8.4a1 1 0 0 1 1 1v15.9"/>' +
      '<path d="M4 20.5h13.4"/><circle cx="13.3" cy="12.4" r=".9"/>' +
      '<path d="M19.4 8.6l1.8-1.1M19.9 11.6h2.1M19.4 14.6l1.8 1.1"/>'
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
    ),

    people: wrap(
      '<circle cx="9.2" cy="8.4" r="3.4"/>' +
      '<path d="M2.8 20c.6-3.4 3.2-5.4 6.4-5.4s5.8 2 6.4 5.4"/>' +
      '<path d="M16.2 5.6a3 3 0 0 1 0 5.8M17.4 14.9c2 .7 3.4 2.5 3.8 5.1"/>'
    ),

    chat: wrap(
      '<path d="M20.5 12.4c0 3.9-3.8 7-8.5 7a10 10 0 0 1-2.6-.34L4.2 21l1.2-3.6a6.6 6.6 0 0 1-1.9-4.5c0-3.9 3.8-7 8.5-7s8.5 3.1 8.5 7Z"/>'
    ),

    mic: wrap(
      '<path d="M12 3.6a2.7 2.7 0 0 1 2.7 2.7v5a2.7 2.7 0 0 1-5.4 0v-5A2.7 2.7 0 0 1 12 3.6Z"/>' +
      '<path d="M6.4 11a5.6 5.6 0 0 0 11.2 0M12 17v3.4M9 20.4h6"/>'
    ),

    // The static planned route: one agreed line with the stops strung on it.
    route: wrap(
      '<circle cx="6" cy="18.5" r="2.4"/><circle cx="18" cy="5.5" r="2.4"/>' +
      '<path d="M8.4 18.5h4.1a3.3 3.3 0 0 0 0-6.6h-2a3.2 3.2 0 0 1 0-6.4h5.1"/>'
    ),

    check: wrap('<path d="M4.5 12.6 9.4 17.5 19.5 6.8"/>'),

    // Spoken guidance on, and off.
    speaker: wrap(
      '<path d="M4 9.5h3.2L12 5.2v13.6L7.2 14.5H4a.8.8 0 0 1-.8-.8V10.3a.8.8 0 0 1 .8-.8Z"/>' +
      '<path d="M15.6 9a4.2 4.2 0 0 1 0 6M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/>'
    ),

    "speaker-off": wrap(
      '<path d="M4 9.5h3.2L12 5.2v13.6L7.2 14.5H4a.8.8 0 0 1-.8-.8V10.3a.8.8 0 0 1 .8-.8Z"/>' +
      '<path d="m16 9.6 4.8 4.8M20.8 9.6 16 14.4"/>'
    ),

    // The rain lock: a screen that ignores wet fingers until it is held.
    lock: wrap(
      '<rect x="5.2" y="10.6" width="13.6" height="9.8" rx="2"/><path d="M8.4 10.6V8a3.6 3.6 0 0 1 7.2 0v2.6"/>' +
      '<path d="M12 14.4v2.2"/>'
    ),

    share: wrap(
      '<path d="M12 3.4v11.2M7.8 7.4 12 3.2l4.2 4.2"/>' +
      '<path d="M8 10.6H6.4a1.6 1.6 0 0 0-1.6 1.6v7a1.6 1.6 0 0 0 1.6 1.6h11.2a1.6 1.6 0 0 0 1.6-1.6v-7a1.6 1.6 0 0 0-1.6-1.6H16"/>'
    ),

    // The dashboard: a gauge with its needle.
    gauge: wrap(
      '<path d="M4.2 17.4a8.6 8.6 0 1 1 15.6 0"/><path d="m12 13.6 3.8-4.4"/><circle cx="12" cy="13.8" r="1.3"/>'
    ),

    battery: wrap(
      '<rect x="3.2" y="7.4" width="15.6" height="9.2" rx="2"/><path d="M21 10.6v2.8"/><path d="M6.2 10.4v3.2"/>'
    ),

    bolt: wrap('<path d="M13.2 3.2 5.8 13.4h5.6l-.8 7.4 7.6-10.4h-5.8l.8-7.2Z"/>'),

    // The sun on the horizon: sunset and sunrise both.
    horizon: wrap(
      '<path d="M3 17.6h18M6 20.6h12"/><path d="M7.4 17.6a4.6 4.6 0 0 1 9.2 0"/>' +
      '<path d="M12 6.2v2.4M5.6 9.8l1.6 1.6M18.4 9.8l-1.6 1.6"/>'
    ),

    // A plain arrow pointing up, rotated by whoever uses it: the wind, the heading.
    arrow: wrap('<path d="M12 19.5V5M6.8 10.2 12 5l5.2 5.2"/>'),

    // The ride as a picture: a finished loop with a start and an end.
    recap: wrap(
      '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/>' +
      '<path d="M7.6 16.8c2.2-1.6 1.2-5 3.8-6.2 2.8-1.3 3.4 2.6 5.2 1.4 1.3-.9.6-3.2.9-4.4"/>'
    )
  };

  var uiFallback = wrap('<circle cx="12" cy="12" r="8.5"/>');

  /* ---------- the next manoeuvre ----------
     One glyph per kind of turn, drawn the way road signs draw them: a stem
     from the bottom — where you are — bending to where you will be. The
     faded strokes are the road you are NOT taking, which is what makes a
     fork read as a fork and a ramp as a ramp at a glance. Names come from
     RC.guide.kind(), which reads OSRM's own manoeuvre type and modifier. */
  var HEAD_UP = '<path d="M7.6 9.2 12 4.8l4.4 4.4"/>';
  var turnIcons = {
    straight: wrap('<path d="M12 20.5V5"/>' + HEAD_UP),
    depart: wrap('<circle cx="12" cy="19" r="1.8"/><path d="M12 17V5"/>' + HEAD_UP),
    right: wrap('<path d="M7.5 20.5v-7a3.4 3.4 0 0 1 3.4-3.4H19"/><path d="M15 6.1l4 4-4 4"/>'),
    left: wrap('<path d="M16.5 20.5v-7a3.4 3.4 0 0 0-3.4-3.4H5"/><path d="M9 6.1l-4 4 4 4"/>'),
    "slight-right": wrap('<path d="M9 20.5v-6.8L17.2 5.5"/><path d="M11.6 5.2h5.9v5.9"/>'),
    "slight-left": wrap('<path d="M15 20.5v-6.8L6.8 5.5"/><path d="M12.4 5.2H6.5v5.9"/>'),
    // Up, over the top and back down at forty-five degrees: a hook, so it
    // can never be read as a letter.
    "sharp-right": wrap('<path d="M8 21v-9.2a3.6 3.6 0 0 1 6.15-2.55l5.35 5.35"/><path d="M19.5 9.5v5.1h-5.1"/>'),
    "sharp-left": wrap('<path d="M16 21v-9.2a3.6 3.6 0 0 0-6.15-2.55L4.5 14.6"/><path d="M4.5 9.5v5.1h5.1"/>'),
    uturn: wrap('<path d="M16.5 20.5V9.8a4.3 4.3 0 0 0-8.6 0v5"/><path d="M4.2 11.6 7.9 15.3l3.7-3.7"/>'),
    /* A ring you enter from the bottom and leave by the arm the exit is on —
       the round-the-island drawing every roundabout sign uses. */
    roundabout: wrap(
      '<circle cx="11" cy="10" r="4"/><path d="M11 21v-7"/><path d="M15 10h6"/><path d="m18.6 7.5 2.5 2.5-2.5 2.5"/>'
    ),
    "roundabout-left": wrap(
      '<circle cx="13" cy="10" r="4"/><path d="M13 21v-7"/><path d="M9 10H3"/><path d="M5.4 7.5 2.9 10l2.5 2.5"/>'
    ),
    "roundabout-straight": wrap(
      '<circle cx="12" cy="12" r="4"/><path d="M12 21.5V16"/><path d="M12 8V2.6"/><path d="M9.5 5.1 12 2.6l2.5 2.5"/>'
    ),
    merge: wrap(
      '<path d="M7 20.5c0-4.8 5-6.2 5-10.2V5"/><path d="M17 20.5c0-4.8-5-6.2-5-10.2" opacity=".45"/>' + HEAD_UP
    ),
    "fork-right": wrap(
      '<path d="M12 20.5v-6.2"/><path d="M12 14.3 7 9V4.5" opacity=".4"/><path d="M12 14.3 17 9V4.8"/>' +
      '<path d="M13.2 8.4 17 4.6l3.8 3.8"/>'
    ),
    "fork-left": wrap(
      '<path d="M12 20.5v-6.2"/><path d="M12 14.3 17 9V4.5" opacity=".4"/><path d="M12 14.3 7 9V4.8"/>' +
      '<path d="M3.2 8.4 7 4.6l3.8 3.8"/>'
    ),
    "ramp-right": wrap(
      '<path d="M8.5 20.5V4.5" opacity=".4"/><path d="M8.5 15.5 16.8 7"/><path d="M11.4 6.7h5.7v5.7"/>'
    ),
    "ramp-left": wrap(
      '<path d="M15.5 20.5V4.5" opacity=".4"/><path d="M15.5 15.5 7.2 7"/><path d="M12.6 6.7H6.9v5.7"/>'
    ),
    arrive: wrap(
      '<path d="M6.4 21V3.8"/><path d="M6.4 4.4c1.7-1 3.5-1 5.2 0s3.5 1 5.2 0v8.2c-1.7 1-3.5 1-5.2 0s-3.5-1-5.2 0Z"/>' +
      '<path d="M11.6 4.4v8.2" opacity=".45"/>'
    )
  };

  return {
    weather: function (name) {
      return weatherIcons.hasOwnProperty(name) ? weatherIcons[name] : weatherFallback;
    },
    ui: function (name) {
      return uiIcons.hasOwnProperty(name) ? uiIcons[name] : uiFallback;
    },
    turn: function (name) {
      return turnIcons.hasOwnProperty(name) ? turnIcons[name] : turnIcons.straight;
    }
  };
})();

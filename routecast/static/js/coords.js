/* ============================================================
   RouteCast — coordinate parsing

   A destination field that only understands place names is a field that
   quietly rewrites what you asked for: type a coordinate and the geocoder
   hands back the nearest landmark, a block away and occasionally across a
   river. So the field understands coordinates FIRST, and only falls through
   to a search when what was typed is plainly not a position.

   Accepted, in the order they are tried:

     14.5995, 120.9842          decimal pair, comma or whitespace separated
     14.5995N 120.9842E         hemisphere suffixed (or prefixed)
     14 35 58.2 N, 120 59 3 E   degrees / minutes / seconds, any punctuation
     geo:14.5995,120.9842       RFC 5870 geo URI (as scanned by a phone)
     https://…/@14.5995,120.98  a maps URL with an @lat,lon or ?q=lat,lon
     https://…#map=15/14.6/121  an OpenStreetMap permalink

   Everything returned is `{lat, lon}` in signed decimal degrees, or null.
   Nothing here touches the network: a coordinate is already an answer.
   ============================================================ */
RC.coords = (function () {
  "use strict";

  var DEG = "(?:[\\u00B0d]|deg)";        // 14° / 14d / 14deg
  var MIN = "(?:['\\u2032\\u2019]|m)";   // 35' / 35m
  var SEC = "(?:[\"\\u2033\\u201D]|s|''|\\u2032\\u2032)";

  function ok(lat, lon) {
    return typeof lat === "number" && typeof lon === "number" &&
      isFinite(lat) && isFinite(lon) &&
      lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function make(lat, lon) {
    return ok(lat, lon) ? { lat: lat, lon: lon } : null;
  }

  /* A pair of plain decimals. Deliberately strict about what may sit between
     them — a bare space is allowed, but "5 Ayala Avenue" must not read as a
     coordinate, so the second number has to look like a longitude and both
     have to be the whole of the string. */
  function parseDecimalPair(s) {
    var m = s.match(/^([+-]?\d{1,3}(?:\.\d+)?)\s*[,;/ ]\s*([+-]?\d{1,3}(?:\.\d+)?)$/);
    if (!m) return null;
    return make(parseFloat(m[1]), parseFloat(m[2]));
  }

  /* Hemisphere letters, either side of the number, in either order — so
     "N14.6 E121.0", "14.6N, 121.0E" and "121.0E 14.6N" all work. */
  function parseHemispherePair(s) {
    var re = /([NSEW])\s*([+-]?\d{1,3}(?:\.\d+)?)|([+-]?\d{1,3}(?:\.\d+)?)\s*([NSEW])/gi;
    var found = [], m;
    while ((m = re.exec(s))) {
      var letter = (m[1] || m[4] || "").toUpperCase();
      var value = parseFloat(m[2] != null ? m[2] : m[3]);
      if (isNaN(value)) return null;
      found.push({ letter: letter, value: value });
    }
    if (found.length !== 2) return null;
    var lat = null, lon = null;
    for (var i = 0; i < found.length; i++) {
      var f = found[i];
      var signed = (f.letter === "S" || f.letter === "W") ? -Math.abs(f.value) : Math.abs(f.value);
      if (f.letter === "N" || f.letter === "S") { if (lat != null) return null; lat = signed; }
      else { if (lon != null) return null; lon = signed; }
    }
    return make(lat, lon);
  }

  /* Degrees / minutes / seconds, with or without the symbols. The hemisphere
     letter is required here: without it "14 35 58 120 59 3" is six numbers,
     not a position, and guessing which three belong to which axis is exactly
     the sort of silent reinterpretation this module exists to avoid. */
  function parseDms(s) {
    /* Only look for DMS in a string that actually looks like DMS: one of the
       degree/minute/second symbols, or two numbers separated by whitespace.
       Without this guard "14.5995N" is a perfectly good DMS match — one
       degree, four and a bit minutes, somewhere in the Gulf of Guinea — and
       a decimal coordinate silently becomes a position 1,500 km away. The
       decimal forms below handle that string; this one must not touch it. */
    if (!/[\u00B0'"\u2032\u2033\u2019\u201D]/.test(s) && !/\d\s+\d/.test(s)) return null;

    var part = "([+-]?\\d{1,3})(?!\\.)\\s*" + DEG + "?\\s*(?:(\\d{1,2})\\s*" + MIN + "?\\s*)?" +
               "(?:(\\d{1,2}(?:\\.\\d+)?)\\s*" + SEC + "?\\s*)?([NSEW])";
    var re = new RegExp(part, "gi");
    var found = [], m;
    while ((m = re.exec(s))) {
      var d = parseFloat(m[1]);
      var mm = m[2] ? parseFloat(m[2]) : 0;
      var ss = m[3] ? parseFloat(m[3]) : 0;
      if (mm >= 60 || ss >= 60) return null;
      var value = Math.abs(d) + mm / 60 + ss / 3600;
      var letter = m[4].toUpperCase();
      if (letter === "S" || letter === "W" || d < 0) value = -value;
      found.push({ letter: letter, value: value });
    }
    if (found.length !== 2) return null;
    var lat = null, lon = null;
    for (var i = 0; i < found.length; i++) {
      var f = found[i];
      if (f.letter === "N" || f.letter === "S") { if (lat != null) return null; lat = f.value; }
      else { if (lon != null) return null; lon = f.value; }
    }
    return make(lat, lon);
  }

  /* A pasted link. Phones share positions as URLs far more often than as
     numbers, and pulling the pair out of one is the difference between
     "paste and go" and "read the numbers off the screen and retype them". */
  function parseUrl(s) {
    if (!/^(?:https?:|geo:)/i.test(s) && s.indexOf("/@") < 0 && s.indexOf("#map=") < 0) return null;
    var m;

    m = s.match(/^geo:\s*([+-]?\d{1,3}(?:\.\d+)?)\s*,\s*([+-]?\d{1,3}(?:\.\d+)?)/i);
    if (m) return make(parseFloat(m[1]), parseFloat(m[2]));

    m = s.match(/#map=\d+(?:\.\d+)?\/([+-]?\d{1,3}(?:\.\d+)?)\/([+-]?\d{1,3}(?:\.\d+)?)/);
    if (m) return make(parseFloat(m[1]), parseFloat(m[2]));

    m = s.match(/[@=/]\s*([+-]?\d{1,3}\.\d+)\s*,\s*([+-]?\d{1,3}\.\d+)/);
    if (m) return make(parseFloat(m[1]), parseFloat(m[2]));

    m = s.match(/[?&](?:q|ll|mlat)=([+-]?\d{1,3}(?:\.\d+)?)[,&]/);
    if (m) {
      var lon = s.match(/[?&](?:mlon)=([+-]?\d{1,3}(?:\.\d+)?)/);
      if (lon) return make(parseFloat(m[1]), parseFloat(lon[1]));
    }
    return null;
  }

  // RC.coords.parse(text) -> {lat, lon} | null
  function parse(text) {
    if (text == null) return null;
    var s = String(text).trim();
    if (!s) return null;
    return parseUrl(s) ||
           parseDecimalPair(s) ||
           parseDms(s) ||
           parseHemispherePair(s);
  }

  /* Five decimals is about a metre — the resolution a map pin actually has,
     and the resolution the rest of the app rounds to when it stores a point.
     Anything finer is noise dressed up as precision. */
  function format(lat, lon, dp) {
    var n = dp == null ? 5 : dp;
    return lat.toFixed(n) + ", " + lon.toFixed(n);
  }

  return {
    parse: parse,
    format: format,
    isValid: ok
  };
})();

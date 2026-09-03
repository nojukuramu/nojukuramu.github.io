/* icons.js — the app's whole icon set, drawn rather than typed.
 *
 * Emoji and dingbats were standing in for icons here, and they are not icons:
 * every platform draws them differently, ✕ and ▶ sit on the text baseline while
 * 🔊 and 👥 are full-colour pictures that ignore the theme, and none of them
 * scale with the button they live in. These are 24×24 line drawings on
 * `currentColor`, so one stylesheet rule sizes them and they inherit hover,
 * dark mode, and the accent colour for free.
 *
 * Markup for the icons that never change lives in index.html; anything drawn
 * from script asks for one here by name.
 */
(function (global) {
  "use strict";

  var KN = (global.KN = global.KN || {});

  /* Shared geometry, so a new icon cannot drift from the others by accident. */
  /* width/height are intrinsic fallbacks, not the real size — the stylesheet
   * sizes `.i` per host. Without them an <svg> with only a viewBox falls back
   * to 300×150, so one stylesheet that fails to load (or arrives from a stale
   * cache) would not just look plain, it would blow the layout apart. */
  var HEAD =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" ' +
    'class="i" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">';

  var SHAPES = {
    play: '<path d="M8 5.2v13.6L19 12z" fill="currentColor" stroke-linejoin="round" />',
    pause: '<path d="M9.5 5v14M14.5 5v14" stroke-width="2.4" />',
    skip: '<path d="M5.5 5.2v13.6L15 12z" fill="currentColor" /><path d="M18.5 5v14" />',
    restart: '<path d="M20 12a8 8 0 1 1-2.4-5.7" /><path d="M20.5 4.2v5h-5" />',

    "volume-on":
      '<path d="M4 9.3h3.3L12 5.4v13.2L7.3 14.7H4z" fill="currentColor" stroke-linejoin="round" />' +
      '<path d="M15.8 9.4a3.9 3.9 0 0 1 0 5.2" /><path d="M18.4 6.7a7.6 7.6 0 0 1 0 10.6" />',
    "volume-off":
      '<path d="M4 9.3h3.3L12 5.4v13.2L7.3 14.7H4z" fill="currentColor" stroke-linejoin="round" />' +
      '<path d="M16.2 9.8l5 4.4M21.2 9.8l-5 4.4" />',

    fullscreen:
      '<path d="M4 9V5.6A1.6 1.6 0 0 1 5.6 4H9" /><path d="M15 4h3.4A1.6 1.6 0 0 1 20 5.6V9" />' +
      '<path d="M20 15v3.4a1.6 1.6 0 0 1-1.6 1.6H15" /><path d="M9 20H5.6A1.6 1.6 0 0 1 4 18.4V15" />',
    "fullscreen-exit":
      '<path d="M9.4 4v3.8a1.6 1.6 0 0 1-1.6 1.6H4" /><path d="M20 9.4h-3.8a1.6 1.6 0 0 1-1.6-1.6V4" />' +
      '<path d="M14.6 20v-3.8a1.6 1.6 0 0 1 1.6-1.6H20" /><path d="M4 14.6h3.8a1.6 1.6 0 0 1 1.6 1.6V20" />',

    guests:
      '<circle cx="9.3" cy="8.4" r="3.3" /><path d="M3.4 19.4a5.9 5.9 0 0 1 11.8 0" />' +
      '<path d="M16.4 5.6a3.3 3.3 0 0 1 0 5.6" /><path d="M17.6 13.9a5.9 5.9 0 0 1 3 5.5" />',
    broker:
      '<circle cx="12" cy="12" r="1.9" fill="currentColor" stroke="none" />' +
      '<path d="M8.5 15.5a5 5 0 0 1 0-7" /><path d="M15.5 8.5a5 5 0 0 1 0 7" />' +
      '<path d="M5.8 18.2a8.8 8.8 0 0 1 0-12.4" /><path d="M18.2 5.8a8.8 8.8 0 0 1 0 12.4" />',

    close: '<path d="M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8" />',
    check: '<path d="M5 12.6l4.6 4.6L19 7.4" />',
    plus: '<path d="M12 5.5v13M5.5 12h13" />',

    "arrow-right": '<path d="M4.6 12h14" /><path d="M13 6.4l5.6 5.6L13 17.6" />',
    "arrow-up-right": '<path d="M7 17L17 7" /><path d="M8.6 7H17v8.4" />',
    "to-top": '<path d="M5.2 4.4h13.6" /><path d="M12 20V9" /><path d="M7.4 13.6L12 9l4.6 4.6" />',
    "chevron-up": '<path d="M6.4 14.6L12 9l5.6 5.6" />',
    "chevron-down": '<path d="M6.4 9.4L12 15l5.6-5.6" />',
    "chevron-right": '<path d="M9.4 6.4L15 12l-5.6 5.6" />',

    star: '<path d="M12 4.3l2.44 4.94 5.46.8-3.95 3.84.93 5.42L12 16.74l-4.88 2.56.93-5.42-3.95-3.84 5.46-.8z" />',
    "star-filled":
      '<path d="M12 4.3l2.44 4.94 5.46.8-3.95 3.84.93 5.42L12 16.74l-4.88 2.56.93-5.42-3.95-3.84 5.46-.8z" ' +
      'fill="currentColor" />',

    pencil:
      '<path d="M4.6 19.4l.9-3.9L15.7 5.3a1.9 1.9 0 0 1 2.7 0l.3.3a1.9 1.9 0 0 1 0 2.7L8.5 18.5z" />' +
      '<path d="M14.6 6.4l3 3" />'
  };

  /* Parsed rather than assigned through innerHTML: an <svg> element's innerHTML
   * is not universally reliable, and a parsed document gives the SVG namespace
   * correctly in every engine that matters. */
  var parser = global.DOMParser ? new global.DOMParser() : null;
  var cache = {};

  function markup(name) {
    var shape = SHAPES[name];
    if (!shape) throw new Error("unknown icon: " + name);
    return HEAD + shape + "</svg>";
  }

  /** A fresh <svg> node for `name`; `cls` adds classes beside the base `i`. */
  function icon(name, cls) {
    if (!cache[name]) {
      if (!parser) return null;
      var doc = parser.parseFromString(markup(name), "image/svg+xml");
      cache[name] = doc.documentElement;
    }
    var node = document.importNode(cache[name], true);
    if (cls) node.setAttribute("class", "i " + cls);
    return node;
  }

  /** Replaces whatever `node` is showing with a single icon. */
  function setIcon(node, name, cls) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
    var svg = icon(name, cls);
    if (svg) node.appendChild(svg);
  }

  KN.icon = icon;
  KN.setIcon = setIcon;
  KN.iconMarkup = markup;
})(typeof window !== "undefined" ? window : globalThis);

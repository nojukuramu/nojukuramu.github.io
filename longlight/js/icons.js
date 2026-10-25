/* icons.js — every glyph in the game, as inline SVG.
 *
 * Lifted from Last Flame (lastflame/js/icons.js), whose shape is Ballzooka's
 * (ballzooka/js/icons.js): one 24-unit grid, one stroke weight, currentColor
 * throughout, icon() for markup built in JavaScript and hydrateIcons() for
 * the <i data-icon="..."> placeholders in index.html. The general glyphs and
 * the lantern, flame and hand are Last Flame's own paths; the rest are this
 * game's. The house rule is no emoji in source; tools/validate.js checks
 * that every icon named anywhere is drawn here. */

const P = (d) => '<path d="' + d + '"/>';
const C = (cx, cy, r, fill) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"' + (fill ? ' fill="currentColor" stroke="none"' : "") + "/>";

export const ICONS = {
  info: C(12, 12, 9) + P("M12 11v6M12 7.5v.5"),
  close: P("M6 6l12 12M18 6L6 18"),
  pause: P("M9 6v12M15 6v12"),
  play: P("M8 5.5v13l10-6.5z"),
  gear: C(12, 12, 3) + P("M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"),
  check: P("M5 12.5l4.5 4.5L19 7.5"),
  home: P("M4 11l8-6 8 6M6 9.5V19h12V9.5M10 19v-5h4v5"),
  headphones: P("M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z"),
  lantern: P("M9 5h6M10 5V3.5h4V5M8 8h8l-1 10H9zM7 21h10M12 11c-1.2 1.4-1.2 3 0 4 1.2-1 1.2-2.6 0-4z"),
  flame: P("M12 3c3 4 5 6.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.5 1 2.3 2 2.5-.6-2.6 0-5.4 1-8z"),
  hand: P("M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7s-5-2-6.5-4.5L3 14a1.5 1.5 0 0 1 2.5-1.5L8 15"),
  // the game's own
  beacon: P("M12 3c1.6 2 2.6 3.4 2.6 5a2.6 2.6 0 0 1-5.2 0c0-1 .5-1.8 1-2.3.2.7.5 1.2 1 1.3-.3-1.4 0-2.8.6-4zM9 11h6l-1 3h-4zM10 14l-3 7M14 14l3 7M12 14v7"),
  pack: P("M7 8a5 5 0 0 1 10 0v12H7zM9.5 8V6a2.5 2.5 0 0 1 5 0v2M7 13h10M10.5 13v2.5h3V13"),
  map: P("M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"),
  compass: C(12, 12, 9) + P("M15.5 8.5l-2 5-5 2 2-5z"),
  body: C(12, 5, 2.2) + P("M12 8v7M8 10.5l4-1.5 4 1.5M9.5 21l2.5-6 2.5 6"),
  sun: C(12, 12, 4) + P("M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"),
  snow: P("M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5L12 6.5l2.5-2M9.5 19.5L12 17.5l2.5 2"),
  fish: P("M3 12c3-4 8-5 12-3l4-3v12l-4-3c-4 2-9 1-12-3zM14 11.5v.5"),
  can: P("M6 6h12v13H6zM6 9h12M6 16h12M9 6V4.5h6V6"),
  note: P("M6 3h9l3 3v15H6zM9 9h6M9 12h6M9 15h4"),
  moon: P("M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"),
  walk: C(13, 4.5, 2) + P("M12 8l-2 6 3 3v4M10 14l-3 6M12 8l3 3 3 .5M12 8l-3 2-1 3")
};

export function icon(name, cls) {
  const body = ICONS[name] || ICONS.info;
  return '<svg class="ico' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + body + "</svg>";
}
export function hydrateIcons(root) {
  (root || document).querySelectorAll("[data-icon]").forEach((el) => {
    if (el.dataset.iconDone) return;
    el.innerHTML = icon(el.dataset.icon, el.dataset.iconClass || "");
    el.dataset.iconDone = "1";
  });
}

/* icons.js — every glyph in the game, as inline SVG.
 *
 * The shape is Bloomworks' icons.js (bloomworks/js/icons.js), which is
 * Aeons', Hacks' and Magic Sandbox's: one 24-unit grid, one stroke weight,
 * currentColor throughout, icon() for markup built in JavaScript and
 * hydrateIcons() for the <i data-icon="..."> placeholders in index.html. The
 * general glyphs (info, close, pause, play, gear, check, trash, bolt, star,
 * heart, target, lock, home, sound, mute, music, trophy, next) are
 * Bloomworks' own paths. The house rule is no emoji in source;
 * tools/validate.js checks that every icon named anywhere is drawn here. */

const P = (d) => '<path d="' + d + '"/>';
const C = (cx, cy, r, fill) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"' + (fill ? ' fill="currentColor" stroke="none"' : "") + "/>";

export const ICONS = {
  info: C(12, 12, 9) + P("M12 11v6M12 7.5v.5"),
  close: P("M6 6l12 12M18 6L6 18"),
  pause: P("M9 6v12M15 6v12"),
  play: P("M8 5.5v13l10-6.5z"),
  gear: C(12, 12, 3) + P("M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"),
  check: P("M5 12.5l4.5 4.5L19 7.5"),
  trash: P("M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"),
  bolt: P("M13 3L5 14h6l-1 7 8-11h-6z"),
  star: P("M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"),
  heart: P("M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"),
  target: C(12, 12, 8.5) + C(12, 12, 4.5) + C(12, 12, 1.2, 1),
  lock: P("M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3"),
  home: P("M4 11l8-6 8 6M6 9.5V19h12V9.5M10 19v-5h4v5"),
  sound: P("M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"),
  mute: P("M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6"),
  music: P("M9 18V6l10-2v12") + C(7, 18, 2) + C(17, 16, 2),
  trophy: P("M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v3M8 20h8M9 17h6"),
  next: P("M9 6l6 6-6 6"),
  // the game's own
  coin: C(12, 12, 8.5) + P("M12 7v10M14.5 9h-3.3a1.8 1.8 0 0 0 0 3.6h1.6a1.8 1.8 0 0 1 0 3.6H9.5"),
  balls: C(7, 15, 3) + C(13, 9, 3) + C(17, 16, 3),
  weight: P("M8 8h8l3 12H5zM10 8a2 2 0 1 1 4 0"),
  drill: P("M4 12h9l7-4v8l-7-4M7 9v6"),
  bounce: P("M4 20l6-14 6 14M16 20l4-8") + C(10, 5, 1.6, 1),
  splash: C(12, 12, 3, 1) + P("M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 16.4l2 2M5.6 18.4l2-2M16.4 7.6l2-2"),
  burst: P("M12 2l2 6 6-3-3 6 6 2-6 2 3 6-6-3-2 6-2-6-6 3 3-6-6-2 6-2-3-6 6 3z"),
  snow: P("M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M10 4.5l2 2 2-2M10 19.5l2-2 2 2"),
  gate: P("M5 20V6M19 20V6M5 9h14M5 15h14") + P("M10 12l4 0"),
  magnet: P("M6 4v8a6 6 0 0 0 12 0V4M6 4h3v8a3 3 0 0 0 6 0V4h3M6 7.5h3M15 7.5h3"),
  mirror: P("M12 3v18M9 7L4 12l5 5M15 7l5 5-5 5"),
  bigball: C(12, 12, 8) + C(9, 9, 2, 1),
  zap: P("M4 12h4l2-5 4 10 2-5h4"),
  party: P("M4 20l5-12 7 7zM14 4l1 2M18 6l2-1M18 10h3M13 9c1-2 3-2 4-1"),
  boom: C(12, 14, 6) + P("M15 9l3-4M18 5l1.5-.5M18 5l.5-1.5"),
  rubber: P("M4 16c3-8 13-8 16 0") + C(4, 17, 1.5, 1) + C(20, 17, 1.5, 1),
  speed: P("M3 9h7M2 13h9M4 17h7") + C(16, 13, 5),
  cards: P("M4 7h9v13H4zM9 4h11v13"),
  cannon: P("M9 3h6v10H9zM5 13h14v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z") + C(8, 20, 1.5, 1) + C(16, 20, 1.5, 1),
  shop: P("M4 9h16l-1 11H5zM8 9V7a4 4 0 0 1 8 0v2"),
  skin: P("M8 4l4 2 4-2 5 4-3 3-2-1v10H8V10l-2 1-3-3z"),
  endless: P("M6 9a3 3 0 1 0 0 6c3 0 9-6 12-6a3 3 0 1 1 0 6c-3 0-9-6-12-6z"),
  calendar: P("M4 6h16v14H4zM4 10h16M8 3v5M16 3v5") + C(12, 15, 1.4, 1),
  retry: P("M20 12a8 8 0 1 1-2.5-5.8M20 4v4.5h-4.5"),
  skull: P("M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14z") + C(9, 11, 1.8, 1) + C(15, 11, 1.8, 1) + P("M11 20v-2M13 20v-2"),
  dice: P("M4 4h16v16H4z") + C(8.5, 8.5, 1.2, 1) + C(15.5, 15.5, 1.2, 1) + C(12, 12, 1.2, 1),
  vibrate: P("M8 4h8v16H8zM4 8v8M20 8v8"),
  motion: P("M3 12h4l3-7 4 14 3-7h4"),
  crown: P("M4 18h16M5 18L3 7l5 4 4-6 4 6 5-4-2 11")
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

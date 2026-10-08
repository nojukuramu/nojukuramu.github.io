/* icons.js — every glyph in the game, as inline SVG.
 *
 * The shape is Aeons' icons.js (aeons/js/icons.js), which is Hacks' and Magic
 * Sandbox's: one 24-unit grid, one stroke weight, currentColor throughout,
 * icon() for markup built in JavaScript and hydrateIcons() for the
 * <i data-icon="..."> placeholders in index.html. Several glyphs (info,
 * close, menu, play, pause, gear, check, trash, download, upload, bolt, book,
 * eye, cart, list, map, spiral) are Aeons' own paths. The house rule is no
 * emoji in source; tools/validate.js checks that every icon named anywhere
 * is drawn here. */

const P = (d) => '<path d="' + d + '"/>';
const C = (cx, cy, r, fill) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"' + (fill ? ' fill="currentColor" stroke="none"' : "") + "/>";

export const ICONS = {
  info: C(12, 12, 9) + P("M12 11v6M12 7.5v.5"),
  close: P("M6 6l12 12M18 6L6 18"),
  menu: P("M4 7h16M4 12h16M4 17h16"),
  pause: P("M9 6v12M15 6v12"),
  play: P("M8 5.5v13l10-6.5z"),
  gear: C(12, 12, 3) + P("M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"),
  book: P("M4 5.5c2.5-1 5-1 8 1 3-2 5.5-2 8-1V19c-2.5-1-5-1-8 1-3-2-5.5-2-8-1z M12 6.5V20"),
  eye: P("M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z") + C(12, 12, 2.8),
  check: P("M5 12.5l4.5 4.5L19 7.5"),
  trash: P("M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"),
  download: P("M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"),
  upload: P("M12 15V4M7.5 8.5L12 4l4.5 4.5M5 20h14"),
  bolt: P("M13 3L5 14h6l-1 7 8-11h-6z"),
  cart: P("M3 5h3l2 10h10l2-7H7") + C(10, 19, 1.5) + C(17, 19, 1.5),
  list: P("M8 6h12M8 12h12M8 18h12") + C(4.5, 6, 1, 1) + C(4.5, 12, 1, 1) + C(4.5, 18, 1, 1),
  map: P("M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"),
  spiral: P("M12 12a1 1 0 1 1 1 1 3 3 0 1 1-3-3 5 5 0 1 1 5 5 7 7 0 1 1-7-7"),
  up: P("M6 15l6-6 6 6"),
  down: P("M6 9l6 6 6-6"),
  next: P("M9 6l6 6-6 6"),
  prev: P("M15 6l-6 6 6 6"),
  plus: P("M12 5v14M5 12h14"),
  minus: P("M5 12h14"),
  // the game's own
  glow: C(12, 12, 4, 1) + C(12, 12, 8) + P("M12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2"),
  spark: P("M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3"),
  seed: P("M12 21c0-6 0-9 5-13-6 0-9 3-10 7M12 21c0-5-2-8-7-9 1 4 3 7 7 9"),
  star: P("M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z"),
  moon: P("M19 14.5A8 8 0 0 1 9.5 5a8 8 0 1 0 9.5 9.5z"),
  sun: C(12, 12, 4) + P("M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"),
  planet: C(12, 12, 5.5) + P("M3 15c3 2 15-2 18-6"),
  heart: P("M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z"),
  bell: P("M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"),
  gem: P("M6 4h12l3 5-9 11L3 9zM3 9h18M9 4l3 16M15 4l-3 16"),
  relic: P("M12 3l3 3-3 3-3-3zM9 9l-4 12h14L15 9M8 15h8"),
  moth: P("M12 7v11M12 9c-3-4-8-3-8 1s4 4 8 1M12 9c3-4 8-3 8 1s-4 4-8 1M12 13c-2 1-5 3-4 5 1 1 3-1 4-3M12 13c2 1 5 3 4 5-1 1-3-1-4-3M10 5l2 2 2-2"),
  medal: C(12, 15, 5) + P("M8.5 3h7L13 10.5M8.5 3L11 10.5M12 12.5v5"),
  leaf: P("M5 19c0-9 5-14 15-14 0 10-5 15-14 15M5 19l8-8"),
  cloud: P("M7 18h10a4 4 0 0 0 0-8 5.5 5.5 0 0 0-10.6-1.5A4.2 4.2 0 0 0 7 18z"),
  bag: P("M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2"),
  pick: P("M5 20l9-9M4 9c4-5 11-5 15 0-4-2-7-2-9 0"),
  hammer: P("M5 20l8-8M10 5l6-1 4 4-1 2-3-1-2 2-3-3z"),
  rotate: P("M20 12a8 8 0 1 1-2.5-5.8M20 4v4.5h-4.5"),
  move: P("M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"),
  flame: P("M12 3c3 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-7 .5 2 1.5 3 2.5 3-1-3 0-5 .5-7z"),
  tinker: P("M8 10h8v8H8zM10 18v3M14 18v3M12 10V7M12 7h3M9.5 13h1M13.5 13h1"),
  blueprint: P("M4 4h16v16H4zM4 9h16M9 9v11M12 13h5M12 16h5"),
  target: C(12, 12, 8.5) + C(12, 12, 4.5) + C(12, 12, 1.2, 1),
  jar: P("M8 4h8M9 4v3l-3 3v9a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-9l-3-3V4") + C(12, 15, 2),
  zen: P("M3 12c3-4 6-6 9-6s6 2 9 6M6 17c2-1.5 4-2 6-2s4 .5 6 2"),
  clock: C(12, 12, 9) + P("M12 7v5l3.5 2"),
  hand: P("M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8c0 4-2.7 7-6.5 7S5 19 4 16l-1-3a1.5 1.5 0 0 1 2.6-1.3L8 14"),
  lock: P("M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3"),
  filter: P("M3 5h18l-7 8v6l-4 2v-8z"),
  link: P("M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"),
  home: P("M4 11l8-6 8 6M6 9.5V19h12V9.5M10 19v-5h4v5"),
  copy: P("M8 8h11v11H8zM5 16V5h11"),
  sky: P("M4 18l4-7 4 3 4-8 4 12") + C(8, 11, 1, 1) + C(12, 14, 1, 1) + C(16, 6, 1, 1),
  tree: P("M12 21v-6M12 15c-4 0-7-2-7-5 0-2 2-4 4-4 0-2 1.5-3 3-3s3 1 3 3c2 0 4 2 4 4 0 3-3 5-7 5z"),
  wave: P("M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0M3 17c2-3 4-3 6 0s4 3 6 0 4-3 6 0"),
  sound: P("M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"),
  mute: P("M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6"),
  music: P("M9 18V6l10-2v12") + C(7, 18, 2) + C(17, 16, 2),
  trophy: P("M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v3M8 20h8M9 17h6"),
  scroll: P("M7 4h11v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2h11M7 4a2 2 0 0 0-2 2v10M10 8h5M10 11h5"),
  rule: P("M5 6h4M5 12h4M5 18h4M12 6h7M12 12h7M12 18h7")
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

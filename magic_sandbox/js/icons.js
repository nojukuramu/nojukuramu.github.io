/* icons.js — every glyph in the game, as inline SVG.
 *
 * The first version drew its hotbar, its toasts and its buttons with emoji,
 * which render as a different picture on every phone and as a blank box on
 * some. The house rule is no emoji in source; this is the whole replacement.
 *
 * One 24-unit grid, one stroke weight, currentColor throughout, so an icon
 * takes the colour of whatever it sits in. The element icons are the element
 * glyphs themselves — the same triangle, square, pentagon and hexagon you
 * draw in the forge — so the HUD teaches the drawing without a word. */

const P = (d) => '<path d="' + d + '"/>';
const C = (cx, cy, r, fill) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"' + (fill ? ' fill="currentColor" stroke="none"' : "") + "/>";

export const ICONS = {
  /* elements: the glyph shapes, with the ring they are drawn on */
  fire: P("M12 4l8 8-8 8-8-8z") + C(12, 12, 1.6, 1),
  water: P("M12 4l6.93 4v8L12 20l-6.93-4V8z") + C(12, 12, 1.6, 1),
  earth: P("M12 4l6.93 4L16 18.93H8L5.07 8z") + C(12, 12.5, 1.6, 1),
  air: P("M12 4l6.93 12H5.07z") + C(12, 12.2, 1.6, 1),
  arcane: C(12, 12, 7.5) + C(12, 12, 2.2, 1),

  /* forms */
  needle: P("M4 20L18 6M13 6h5v5M7 14l-2 2"),
  bolt: C(15, 9, 3.5) + P("M4 20l8-8M4 15l5-5M9 20l5-5"),
  orb: C(12, 12, 7) + P("M9 9.5a3.5 3.5 0 0 1 3-2"),
  nova: C(12, 12, 2.5, 1) + C(12, 12, 8.5) + P("M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"),

  /* reactions */
  steam: P("M8 20c-2-3 2-5 0-8s2-5 0-8M12 20c-2-3 2-5 0-8s2-5 0-8M16 20c-2-3 2-5 0-8s2-5 0-8"),
  magma: P("M3 18c2-2 4 0 6-1s3-3 6-2 4 2 6 1M10.5 3c1 2.5 4 4 4 7.5a3.5 3.5 0 0 1-7 0c0-2 1.2-3 2-4 .2 1 .6 1.7 1.3 2 0-2-.8-3.8-.3-5.5z"),
  wildfire: P("M9 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 1.5 1 2.5 2 3 0-3-1-5.5.5-8zM17 9c.5 1.5 3 2.8 3 5.5a3 3 0 0 1-4 2.8"),
  mire: P("M3 15c3-2 5 2 9 0s6 2 9 0M3 19c3-2 5 2 9 0s6 2 9 0M8.5 11.5a3.5 3.5 0 1 1 7 0"),
  storm: P("M13 2L5 14h6l-2 8 10-13h-7z"),
  shrapnel: P("M12 12L6 4M12 12l7-6M12 12l8 5M12 12l-3 9M12 12l-8 2M5 2.5l2 .5-1 2zM19.5 4.5l.5 2-2-.5zM20.5 18.5l-2 .5.5-2zM8 21.5l-.5-2 2 .5zM2.5 14l1.5-1.5.5 2z"),

  /* boons */
  heart: P("M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"),
  drop: P("M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"),
  wave: P("M3 9c3-3 6 3 9 0s6 3 9 0M3 15c3-3 6 3 9 0s6 3 9 0"),
  spark: P("M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"),
  coin: C(12, 12, 8.5) + C(12, 12, 4.5),
  clock: C(12, 12, 9) + P("M12 7v5l3 2"),
  boot: P("M7 3h5v9l6 3a2 2 0 0 1 2 2v3H7zM7 16h13"),
  dash: P("M3 12h9M3 8h6M3 16h6M13 6l6 6-6 6"),
  shield: P("M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"),
  wind: P("M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"),
  fist: P("M7 11V7.5a1.5 1.5 0 0 1 3 0V10M10 10V6.5a1.5 1.5 0 0 1 3 0V10M13 10V7.5a1.5 1.5 0 0 1 3 0V11M16 11V9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-6-6v-1.5A2.5 2.5 0 0 1 7.5 11H10"),
  flame: P("M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 1.5 1 2.5 2 3 0-3-1-5.5.5-8z"),
  flake: P("M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"),
  leech: P("M12 3s5 5.5 5 9.5a5 5 0 0 1-10 0C7 8.5 12 3 12 3zM12 9.5v5M9.8 12.5l2.2 2.2 2.2-2.2"),
  magnet: P("M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4M14 8h4"),
  flask: P("M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.3 15h9.4"),
  leaf: P("M5 19C5 10 11 5 20 4c0 9-5 15-14 15zM5 19l8-8"),
  echo: C(12, 12, 2, 1) + P("M8 8a6 6 0 0 0 0 8M5 5a10 10 0 0 0 0 14M16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"),
  phoenix: P("M12 21c-.8-2.5-.8-5.5 0-8-3 0-6.5-2-8.5-6.5 3 1.3 5.5 1.3 7.3.2C10 4.5 10.5 3 12 2c1.5 1 2 2.5 1.2 4.7 1.8 1.1 4.3 1.1 7.3-.2-2 4.5-5.5 6.5-8.5 6.5"),

  /* interface */
  pause: P("M8 5v14M16 5v14"),
  play: P("M7 4l13 8-13 8z"),
  gear: C(12, 12, 3) + P("M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1") + C(12, 12, 6.5),
  book: P("M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5M9 7.5h7M9 11h5"),
  info: C(12, 12, 9) + P("M12 11v6") + C(12, 7.6, 1.1, 1),
  close: P("M6 6l12 12M18 6L6 18"),
  undo: P("M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"),
  trash: P("M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"),
  plus: P("M12 5v14M5 12h14"),
  minus: P("M5 12h14"),
  check: P("M4 12.5l5 5L20 6.5"),
  refresh: P("M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"),
  trigger: C(12, 12, 3.2, 1) + P("M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.8 2.8M16.2 16.2L19 19M5 19l2.8-2.8M16.2 7.8L19 5"),
  hand: P("M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7.5c0 4.2-2.6 7.5-7 7.5-3 0-5-1.8-6.4-4.5L2.3 13a1.5 1.5 0 0 1 2.5-1.6L8 14.5"),
  anchor: C(12, 5, 2) + P("M12 7v14M5 13a7 7 0 0 0 14 0M8.5 10.5h7"),
  portal: P("M12 2.5c4.1 0 7 4.3 7 9.5s-2.9 9.5-7 9.5-7-4.3-7-9.5 2.9-9.5 7-9.5z") + P("M12 7c1.9 0 3 2.2 3 5s-1.1 5-3 5-3-2.2-3-5 1.1-5 3-5z"),
  chest: P("M3 10h18v10H3zM3 10a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4M10.5 12h3v3h-3z"),
  shrine: P("M12 2.5v5M9 5h6M7 10h10l-1 3H8zM5 21h14M8.5 21l1-8M15.5 21l-1-8"),
  star: P("M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"),
  lock: P("M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11M12 15v2"),
  crown: P("M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"),
  skull: P("M12 3a8 8 0 0 0-8 8c0 3 1.5 5 4 6v3.5h8V17c2.5-1 4-3 4-6a8 8 0 0 0-8-8zM10 17.5v3M14 17.5v3") + C(9, 11.5, 1.6, 1) + C(15, 11.5, 1.6, 1),
  target: C(12, 12, 8.5) + C(12, 12, 4.5) + C(12, 12, 1.2, 1),
  cube: P("M12 2.5l8.5 4.8v9.4L12 21.5l-8.5-4.8V7.3zM3.5 7.3L12 12l8.5-4.7M12 12v9.5"),
  tower: P("M8 21V10h8v11M6.5 10h11V5h-2.2v2h-2.2V5h-2.2v2H8.7V5H6.5zM10.5 21v-4a1.5 1.5 0 0 1 3 0v4M5 21h14"),
  trophy: P("M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3.2 4M16 6h3a3 3 0 0 1-3.2 4M12 13v4M9 17h6v4H9z"),
  volume: P("M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"),
  exit: P("M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"),
  flag: P("M5 21V4M5 4h11l-2 4 2 4H5"),
  up: P("M12 4l6.5 7H15v9H9v-9H5.5z"),
  grid: P("M4 4h16v16H4zM4 12h16M12 4v16"),
  layers: P("M12 3l9 5-9 5-9-5zM3 12.5l9 5 9-5M3 16.5l9 5 9-5"),
  music: P("M9 18V5l11-2v13") + C(6, 18, 3) + C(17, 16, 3),
  sparkle: P("M12 4l1.8 6.2L20 12l-6.2 1.8L12 20l-1.8-6.2L4 12l6.2-1.8z"),
  map: P("M3 6l6-2.5 6 2.5 6-2.5v14.5L15 20.5 9 18l-6 2.5zM9 3.5V18M15 6v14.5"),
  dice: P("M4 4h16v16H4z") + C(8.5, 8.5, 1.3, 1) + C(15.5, 15.5, 1.3, 1) + C(12, 12, 1.3, 1),
  users: C(9, 8, 3.2) + P("M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6") + C(17, 9, 2.6) + P("M16.5 14c2.7.3 4.5 2.4 4.5 5.5"),
  quick: P("M13 2L5 14h6l-2 8 10-13h-7z"),
  server: P("M4 4h16v6H4zM4 14h16v6H4z") + C(8, 7, 1, 1) + C(8, 17, 1, 1),
  swords: P("M4 4l9 9M4 4h4M4 4v4M20 4l-9 9M20 4h-4M20 4v4M9.5 15.5L6 19M14.5 15.5L18 19M7 13l4 4M17 13l-4 4"),
  eye: P("M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z") + C(12, 12, 3),
  pad: P("M6.5 8h11a4.5 4.5 0 0 1 4.3 5.8l-1.3 4.4a2.3 2.3 0 0 1-4 .7L15 17H9l-1.5 1.9a2.3 2.3 0 0 1-4-.7l-1.3-4.4A4.5 4.5 0 0 1 6.5 8zM8 11v3M6.5 12.5h3") + C(16, 12.5, 1.1, 1),

  /* forge tools */
  toolGlyph: P("M12 4l7 13H5z") + C(12, 4, 1.8, 1) + C(19, 17, 1.8, 1) + C(5, 17, 1.8, 1),
  toolSeal: C(12, 12, 7.5) + C(12, 12, 1.4, 1) + P("M12 12h7.5"),
  toolRune: C(12, 13, 7) + P("M12 2.5v6.5") + C(12, 6, 1.8, 1),
  toolErase: P("M14.5 4.5l5 5L10 19H6l-3-3zM9.5 9.5l5 5M10 19h10")
};

export function icon(name, cls) {
  const body = ICONS[name] || ICONS.sparkle;
  return '<svg class="ico' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + body + "</svg>";
}

/** Fill every <i data-icon="name"> in a subtree — lets index.html say which
 *  icon goes where without carrying the path data itself. */
export function hydrateIcons(root) {
  (root || document).querySelectorAll("[data-icon]").forEach((el) => {
    if (el.dataset.iconDone) return;
    el.innerHTML = icon(el.dataset.icon, el.dataset.iconClass || "");
    el.dataset.iconDone = "1";
  });
}

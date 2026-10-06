/* icons.js — every glyph in the game, as inline SVG.
 *
 * The shape is Hacks' and Magic Sandbox's icons.js: one 24-unit grid, one
 * stroke weight, currentColor throughout, icon() for markup built in
 * JavaScript and hydrateIcons() for the <i data-icon="..."> placeholders in
 * index.html. The house rule is no emoji in source; tools/validate.js checks
 * that every icon named anywhere is drawn here. */

const P = (d) => '<path d="' + d + '"/>';
const C = (cx, cy, r, fill) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"' + (fill ? ' fill="currentColor" stroke="none"' : "") + "/>";

export const ICONS = {
  info: C(12, 12, 9) + P("M12 11v6M12 7.5v.5"),
  close: P("M6 6l12 12M18 6L6 18"),
  menu: P("M4 7h16M4 12h16M4 17h16"),
  pause: P("M9 6v12M15 6v12"),
  play: P("M8 5.5v13l10-6.5z"),
  fast: P("M4 6l7 6-7 6zM13 6l7 6-7 6z"),
  gear: C(12, 12, 3) + P("M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"),
  save: P("M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"),
  folder: P("M3.5 7V5.5h6l2 2h9V19h-17z"),
  book: P("M4 5.5c2.5-1 5-1 8 1 3-2 5.5-2 8-1V19c-2.5-1-5-1-8 1-3-2-5.5-2-8-1z M12 6.5V20"),
  eye: P("M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z") + C(12, 12, 2.8),
  auto: C(12, 12, 4) + P("M12 3v3M12 18v3M3 12h3M18 12h3M6 6l2 2M16 16l2 2M6 18l2-2M16 8l2-2") + C(12, 12, 1.2, 1),
  crown: P("M4 17l-1-9 5 4 4-7 4 7 5-4-1 9zM4 20h16"),
  sword: P("M5 19l3-3M4 15l5 5M8 16L19 5V4h-1L7 15"),
  shield: P("M12 3l7 3v5c0 5-3.2 8.2-7 10-3.8-1.8-7-5-7-10V6z"),
  bow: P("M6 4c8 2 12 6 14 14M6 4l14 14M6 4v4M6 4h4M20 18l-3 1M20 18l1-3"),
  axe: P("M5 20L15 10M13 4c3 0 7 2 7 7l-4-1-3-3z"),
  pick: P("M5 20l9-9M4 9c4-5 11-5 15 0-4-2-7-2-9 0"),
  hammer: P("M5 20l8-8M10 5l6-1 4 4-1 2-3-1-2 2-3-3z"),
  wrench: P("M14.5 4a4.5 4.5 0 0 0-4.2 6l-6.3 6.3 2.7 2.7 6.3-6.3A4.5 4.5 0 0 0 19 8.5L16 11l-3-3 2.5-3z"),
  house: P("M4 11l8-6 8 6M6 9.5V19h12V9.5M10 19v-5h4v5"),
  wall: P("M4 4h16v16H4zM4 9.5h16M4 15h16M9 4v5.5M15 9.5V15M9 15v5"),
  tower: P("M7 21V9h10v12M6 9V4h2.5v2h2V4h3v2h2V4H18v5M10 21v-4h4v4"),
  flag: P("M6 21V4M6 4h11l-2.5 3.5L17 11H6"),
  move: P("M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"),
  stop: P("M7 7h10v10H7z"),
  amove: P("M4 20l6-6M3 15l6 6M9 16l7-7M14 4h6v6M20 4l-7 7"),
  patrol: P("M4 9a7 7 0 0 1 13-2M20 15a7 7 0 0 1-13 2M17 3v4h-4M7 21v-4h4"),
  hold: P("M7 11V6.5a1.5 1.5 0 0 1 3 0V11M10 10V5a1.5 1.5 0 0 1 3 0v5M13 10V6a1.5 1.5 0 0 1 3 0v6M16 11V9a1.5 1.5 0 0 1 3 0v5c0 4-3 7-7 7s-6-2.5-7.5-6L4 12a1.5 1.5 0 0 1 2.6-1.3L7 12"),
  stance: P("M12 3l7 3v5c0 5-3.2 8.2-7 10-3.8-1.8-7-5-7-10V6zM9 12l2 2 4-4"),
  build: P("M3 21h18M5 21V11l7-5 7 5v10M9 21v-5h6v5"),
  ret: P("M12 3v11M7.5 9.5L12 14l4.5-4.5M4 15v5h16v-5"),
  control: P("M6 9h12a3 3 0 0 1 3 3v2a4 4 0 0 1-7 2.6h-4A4 4 0 0 1 3 14v-2a3 3 0 0 1 3-3zM8 11v4M6 13h4") + C(15.5, 12.5, 0.9, 1) + C(17.5, 14.5, 0.9, 1),
  release: P("M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"),
  up: P("M6 15l6-6 6 6"),
  down: P("M6 9l6 6 6-6"),
  next: P("M9 6l6 6-6 6"),
  prev: P("M15 6l-6 6 6 6"),
  era: C(12, 12, 4) + P("M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"),
  repeat: P("M4 12a8 8 0 0 1 14-5M20 12a8 8 0 0 1-14 5M18 3v4h-4M6 21v-4h4"),
  plus: P("M12 5v14M5 12h14"),
  minus: P("M5 12h14"),
  target: C(12, 12, 8.5) + C(12, 12, 4.5) + C(12, 12, 1.2, 1),
  users: C(9, 8.5, 3.2) + P("M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5") + C(17, 9.5, 2.4) + P("M16 14.2c2.4-.3 4.1 1.3 4.6 4.3"),
  alert: P("M12 3l10 17H2zM12 10v5M12 17.5v.5"),
  compass: C(12, 12, 9) + P("M15.5 8.5l-2 5-5 2 2-5z"),
  scale: P("M12 4v16M7 20h10M4 8h16M6 8l-3 6a3 3 0 0 0 6 0zM18 8l-3 6a3 3 0 0 0 6 0z"),
  list: P("M8 6h12M8 12h12M8 18h12") + C(4.5, 6, 1, 1) + C(4.5, 12, 1, 1) + C(4.5, 18, 1, 1),
  radar: C(12, 12, 9) + C(12, 12, 5) + P("M12 12l6-6"),
  drone: C(5, 5, 2.5) + C(19, 5, 2.5) + C(5, 19, 2.5) + C(19, 19, 2.5) + P("M7 7l3 3M17 7l-3 3M7 17l3-3M17 17l-3-3M10 10h4v4h-4z"),
  brain: P("M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a3 3 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"),
  spiral: P("M12 12a1 1 0 1 1 1 1 3 3 0 1 1-3-3 5 5 0 1 1 5 5 7 7 0 1 1-7-7"),
  cart: P("M3 5h3l2 10h10l2-7H7") + C(10, 19, 1.5) + C(17, 19, 1.5),
  blast: P("M12 2l2 6 6-3-3 6 6 2-6 2 3 6-6-3-2 6-2-6-6 3 3-6-6-2 6-2-3-6 6 3z"),
  check: P("M5 12.5l4.5 4.5L19 7.5"),
  trash: P("M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"),
  download: P("M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"),
  upload: P("M12 15V4M7.5 8.5L12 4l4.5 4.5M5 20h14"),
  worker: C(10, 6, 2.6) + P("M5 20l2-8h6l1.5 4M14 9l5-3M17 4l3 3"),
  army: P("M4 4l9 9M4 4v3.5M4 4h3.5M20 4l-9 9M20 4v3.5M20 4h-3.5M7.5 16.5l-3 3M16.5 16.5l3 3M9 15l-3-3M15 15l3-3"),
  box: P("M4 4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4"),
  map: P("M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"),
  locate: C(12, 12, 6) + P("M12 2v4M12 18v4M2 12h4M18 12h4") + C(12, 12, 1.5, 1),
  // resources
  gold: C(12, 12, 8) + P("M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.7c0 2.3-5 1.3-5 3.8 0 1.2 1 1.8 2.5 1.8s2.5-.6 2.5-1.6M12 6.5V8M12 16v1.5"),
  wood: P("M3 15l14-8a3 3 0 0 1 3 5L6 20a3 3 0 0 1-3-5z") + C(18.5, 9.5, 1.3),
  stone: P("M4 17l3-8 5-3 6 3 2 8-6 3z M7 9l5 3 6-3M12 12v8"),
  oil: P("M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"),
  aether: P("M12 2l5 8-5 12-5-12zM7 10h10"),
  supply: P("M4 11l8-6 8 6M6 9.5V19h12V9.5") + C(12, 14, 2),
  // skills
  bash: P("M12 3l7 3v5c0 5-3.2 8.2-7 10-3.8-1.8-7-5-7-10V6zM12 8v6M9 11h6"),
  rally: P("M6 21V4M6 4h11l-2.5 3.5L17 11H6M15 15l3 3M18 15l-3 3"),
  charge: P("M3 12h12M11 7l5 5-5 5M18 6v12"),
  bulwark: P("M12 2l8 3.5v5.5c0 6-3.6 9-8 11-4.4-2-8-5-8-11V5.5zM12 7v10M7.5 12h9"),
  volley: P("M4 20L18 6M4 14l10-10M10 20L20 10M15 6h3v3M11 4h3M20 13v3"),
  mark: C(12, 12, 7) + C(12, 12, 3) + P("M12 2v4M12 18v4M2 12h4M18 12h4"),
  tumble: P("M4 18a8 8 0 0 1 14-9M18 4v5h-5M14 20h6"),
  hail: P("M6 3v5M12 3v8M18 3v5M4 15l2 2-2 2M10 15l2 2-2 2M16 15l2 2-2 2"),
  bolt: P("M13 3L5 14h6l-1 7 8-11h-6z"),
  mend: P("M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10zM12 9v6M9 12h6"),
  blink: P("M4 12h6M14 12h6M10 8l4 4-4 4") + C(5, 12, 1.5, 1) + C(19, 12, 1.5, 1),
  cataclysm: C(12, 14, 6) + P("M12 2v4M5 5l2.5 2.5M19 5l-2.5 2.5M12 11v3l2 1"),
  rend: P("M5 19L19 5M8 19l11-11M5 16L16 5"),
  veil: P("M3 12s3.5-6 9-6c1.8 0 3.3.6 4.6 1.4M21 12s-3.5 6-9 6c-1.8 0-3.3-.6-4.6-1.4M4 20L20 4"),
  caltrops: P("M12 4v6M12 10l-6 6M12 10l6 6M12 10v10") + C(12, 10, 1.4, 1),
  execute: P("M6 18l12-12M15 4h5v5M4 14l6 6M3 20l3-1"),
  turret: P("M5 20h14M7 20v-5h10v5M9 15v-3h6v3M12 12V8M12 8h7"),
  pulse: P("M3 12h4l2-5 4 10 2-5h6"),
  mine: C(12, 13, 6) + P("M12 7V3M9 4l3-1 3 1M8.5 16.5l7-7"),
  overclock: C(12, 13, 8) + P("M12 13l4-4M12 3v2M7 6l1 1.5"),
  attack: P("M5 19l3-3M4 15l5 5M8 16L19 5V4h-1L7 15") + C(18, 18, 2.5)
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

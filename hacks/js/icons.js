/* icons.js — every glyph in the game, as inline SVG.
 *
 * The shape is Magic Sandbox's icons.js: one 24-unit grid, one stroke
 * weight, currentColor throughout, icon() for markup built in JavaScript and
 * hydrateIcons() for the <i data-icon="…"> placeholders in index.html. The
 * house rule is no emoji in source; tools/validate.js checks that every icon
 * named anywhere is drawn here. */

const P = (d) => '<path d="' + d + '"/>';
const C = (cx, cy, r, fill) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"' + (fill ? ' fill="currentColor" stroke="none"' : "") + "/>";

export const ICONS = {
  info: C(12, 12, 9) + P("M12 11v6M12 7.5v.5"),
  help: C(12, 12, 9) + P("M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 16.5v.5"),
  play: P("M8 5.5v13l10-6.5z"),
  stop: P("M7 7h10v10H7z"),
  pause: P("M9 6v12M15 6v12"),
  close: P("M6 6l12 12M18 6L6 18"),
  plus: P("M12 5v14M5 12h14"),
  check: P("M5 12.5l4.5 4.5L19 7.5"),
  more: C(6, 12, 1.4, 1) + C(12, 12, 1.4, 1) + C(18, 12, 1.4, 1),
  exit: P("M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"),
  gear: C(12, 12, 3) + P("M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"),
  users: C(9, 8.5, 3.2) + P("M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5") + C(17, 9.5, 2.4) + P("M16 14.2c2.4-.3 4.1 1.3 4.6 4.3"),
  quick: P("M13 3L5 14h6l-1 7 8-11h-6z"),
  target: C(12, 12, 8.5) + C(12, 12, 4.5) + C(12, 12, 1.2, 1),
  code: P("M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15"),
  gun: P("M3 8h16l2 2v2h-6l-1.5 1.5V17h-3.5l.8-5H3z"),
  server: P("M4 5h16v5H4zM4 14h16v5H4z") + C(7.5, 7.5, 0.9, 1) + C(7.5, 16.5, 0.9, 1),
  up: P("M9 6l6 6-6 6"),
  move: P("M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"),
  fire: C(12, 12, 7.5) + C(12, 12, 2.5, 1) + P("M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"),
  jump: P("M12 19V6M6.5 11.5L12 6l5.5 5.5M6 21h12"),
  crouch: P("M12 5v11M6.5 10.5L12 16l5.5-5.5M6 20h12"),
  scope: C(12, 12, 7.5) + P("M12 4.5v5M12 14.5v5M4.5 12h5M14.5 12h5"),
  lunge: P("M4 20L16 8M11 8h5v5M17 4l3 3M3 14l3 3"),
  reload: P("M19 12a7 7 0 1 1-2.1-5M19 4v4.5h-4.5"),
  swap: P("M5 9h13l-3.5-3.5M19 15H6l3.5 3.5"),
  blade: P("M4 20l3-3M6 18l-2-2M7.5 15.5L19 4l1 1-11.5 11.5z"),
  sprint: P("M13 4.5a1.5 1.5 0 1 0 0 .1M10 20l2.5-5.5-3-2.5 2.5-4 3.5 3h3M12.5 14.5L16 17v3M9 8.5L6 11"),
  list: P("M8 6h12M8 12h12M8 18h12") + C(4.5, 6, 1, 1) + C(4.5, 12, 1, 1) + C(4.5, 18, 1, 1),
  eye: P("M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z") + C(12, 12, 2.8),
  skull: P("M6 16.5V11a6 6 0 1 1 12 0v5.5l-2 .5v2.5H8V17z") + C(9.5, 11.5, 1.3, 1) + C(14.5, 11.5, 1.3, 1),
  head: C(12, 9, 4.5) + P("M5 20c1-3.5 3.8-5.5 7-5.5s6 2 7 5.5M12 2v2.5M12 13.5V16"),
  swords: P("M4 4l9 9M4 4v3.5M4 4h3.5M20 4l-9 9M20 4v3.5M20 4h-3.5M7.5 16.5l-3 3M16.5 16.5l3 3M9 15l-3-3M15 15l3-3"),
  copy: P("M8 8h11v12H8zM5 16V4h11"),
  download: P("M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"),
  upload: P("M12 15V4M7.5 8.5L12 4l4.5 4.5M5 20h14"),
  trash: P("M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"),
  book: P("M4 5.5c2.5-1 5-1 8 1 3-2 5.5-2 8-1V19c-2.5-1-5-1-8 1-3-2-5.5-2-8-1z M12 6.5V20"),
  bolt: P("M13 3L5 14h6l-1 7 8-11h-6z"),
  wall: P("M4 4h16v16H4zM4 9.5h16M4 15h16M9 4v5.5M15 9.5V15M9 15v5"),
  surf: P("M3 18l9-12 9 12M7 18l5-6.5 5 6.5"),
  bug: P("M8 9h8v6a4 4 0 0 1-8 0zM12 9v10M8 12H4M20 12h-4M8 16l-3 2M16 16l3 2M8.5 9L6 6.5M15.5 9L18 6.5M9.5 9a2.5 2.5 0 0 1 5 0")
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

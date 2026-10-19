/* icons.js — every glyph in the game, as inline SVG.
 *
 * The shape is Ballzooka's icons.js (ballzooka/js/icons.js), which is
 * Bloomworks', Aeons', Hacks' and Magic Sandbox's: one 24-unit grid, one
 * stroke weight, currentColor throughout, icon() for markup built in
 * JavaScript and hydrateIcons() for the <i data-icon="..."> placeholders in
 * index.html. The general glyphs (info, close, pause, play, gear, check,
 * sound, mute, retry, home, lock, next) are Ballzooka's own paths; the rest
 * are this game's. The house rule is no emoji in source; tools/validate.js
 * checks that every icon named anywhere is drawn here. */

const P = (d) => '<path d="' + d + '"/>';
const C = (cx, cy, r, fill) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"' + (fill ? ' fill="currentColor" stroke="none"' : "") + "/>";

export const ICONS = {
  info: C(12, 12, 9) + P("M12 11v6M12 7.5v.5"),
  close: P("M6 6l12 12M18 6L6 18"),
  pause: P("M9 6v12M15 6v12"),
  play: P("M8 5.5v13l10-6.5z"),
  gear: C(12, 12, 3) + P("M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"),
  check: P("M5 12.5l4.5 4.5L19 7.5"),
  lock: P("M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3"),
  home: P("M4 11l8-6 8 6M6 9.5V19h12V9.5M10 19v-5h4v5"),
  sound: P("M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"),
  mute: P("M4 9h4l5-4v14l-5-4H4zM16 9l5 6M21 9l-5 6"),
  retry: P("M20 12a8 8 0 1 1-2.5-5.8M20 4v4.5h-4.5"),
  next: P("M9 6l6 6-6 6"),
  // the game's own
  lantern: P("M9 5h6M10 5V3.5h4V5M8 8h8l-1 10H9zM7 21h10M12 11c-1.2 1.4-1.2 3 0 4 1.2-1 1.2-2.6 0-4z"),
  flame: P("M12 3c3 4 5 6.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-4.5.3 1.5 1 2.3 2 2.5-.6-2.6 0-5.4 1-8z"),
  closet: P("M5 3h14v18H5zM12 3v18M7.5 7h3M7.5 9.5h3M7.5 12h3M13.5 7h3M13.5 9.5h3M13.5 12h3M10.5 15v1.5M13.5 15v1.5"),
  hand: P("M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7s-5-2-6.5-4.5L3 14a1.5 1.5 0 0 1 2.5-1.5L8 15"),
  breath: P("M4 9h10a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M5 17h5"),
  crouch: C(12, 5, 2) + P("M12 8l-1 5 4 2v5M11 13l-4 3 2 4M10 10l-3 1"),
  run: C(15, 4.5, 2) + P("M13 8l-3 4 4 3-2 5M10 12l-4 1M14 8l3 3 3-1M13 15l-4 5"),
  eye: P("M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z") + C(12, 12, 3),
  ear: P("M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 0M10 9a2 2 0 0 1 4 0c0 1.5-1.5 2-1.5 3.5"),
  door: P("M6 21V4h10v17M4 21h14M13 12.5v1M16 4l3 2v15"),
  moon: P("M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"),
  skull: P("M12 3a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14z") + C(9, 11, 1.8, 1) + C(15, 11, 1.8, 1) + P("M11 20v-2M13 20v-2"),
  note: P("M6 3h9l3 3v15H6zM9 9h6M9 12h6M9 15h4"),
  captions: P("M3 6h18v12H3zM7 11h3M7 14h6M13 11h4M15 14h2"),
  headphones: P("M4 15v-3a8 8 0 0 1 16 0v3M4 15h3v5H4zM17 15h3v5h-3z"),
  rain: P("M7 15a5 5 0 1 1 9.5-4A3.5 3.5 0 1 1 17 15zM8 18l-1 2M12 18l-1 2M16 18l-1 2")
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

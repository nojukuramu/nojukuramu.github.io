/* loader.js — the loading screen: over everything until there is something
 * whole to show.
 *
 * Without it the game showed itself the moment it could: the menus over a
 * black canvas, then the arena once its shaders had compiled, then the box
 * guns swapped for the real ones as the models arrived. Starting a match
 * froze the title for the frame that compiled the bodies' and the gun's
 * shaders, then showed the match half-built.
 *
 * The shape is Magic Sandbox's #loading — a cover in the page from the first
 * paint, faded out with a class — with one thing it never needed: a cover
 * that comes back. A cover shown from a click has to be painted before the
 * heavy frame, or the freeze happens with the old screen still up, so the
 * first frame after it is shown draws nothing (main.js asks skipFrame()).
 * Under it the frames are drawn as usual: that is what compiles the shaders
 * and uploads the textures, out of sight. */

const $ = (id) => document.getElementById(id);

let up = true, skip = 0, drawn = 0, t0 = 0, job = null;

/** Is the cover up? False from the moment it starts to fade. */
export const covering = () => up;

/**
 * Cover the screen with a line of text. It stays at least `min` ms (so it
 * never flashes), until two frames have been drawn under it and `ready()`
 * says yes, and at most `max` ms whatever `ready()` says. `progress()`, if
 * given, fills the bar (0..1); without it the bar just runs.
 */
export function cover(text, opts) {
  opts = opts || {};
  const L = $("loading");
  $("loadText").textContent = text;
  L.hidden = false;
  L.classList.remove("gone");
  L.classList.toggle("busy", !opts.progress);
  $("loadBar").style.width = opts.progress ? "0%" : "";
  up = true; skip = 1; drawn = 0; t0 = performance.now();
  job = { ready: opts.ready || (() => true), progress: opts.progress || null, min: opts.min == null ? 450 : opts.min, max: opts.max || 4000 };
}

/** main.js, first thing each frame: true means draw nothing this once, so the cover is painted first. */
export function skipFrame() {
  if (skip > 0) { skip--; return true; }
  return false;
}

/** main.js, after a frame was drawn: lift the cover once what it waits for is in. */
export function afterFrame() {
  if (!job) return;
  drawn++;
  if (job.progress) $("loadBar").style.width = (Math.min(1, job.progress()) * 100).toFixed(0) + "%";
  const t = performance.now() - t0;
  if (drawn < 2 || t < job.min || (t < job.max && !job.ready())) return;
  job = null;
  const L = $("loading");
  L.classList.add("gone");
  // the game is yours from the moment the fade starts; the fade is only the picture
  up = false;
  setTimeout(() => { if (!job) L.hidden = true; }, 350);
}

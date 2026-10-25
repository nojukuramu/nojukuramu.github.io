/* sun.js — where the sun is, which is what time it is.
 *
 * There is no clock in the game. The sun is the clock: at 79 degrees south
 * in summer it never sets, it goes round — high in the north at noon, low
 * in the south at midnight — and the shadows go round with it like a
 * sundial's. Over the journey the season turns toward winter: the sun's
 * declination climbs from the solstice toward the equinox and past it, the
 * circle sinks, the midnight sun touches the horizon, then the noon sun
 * does, and then the polar night.
 *
 * This is real solar geometry (the hour angle and the declination, nothing
 * faked), with the day sped up: one turn of the sun is DAY seconds of play.
 * Pure: game.js uses it for warmth, render.js for the light, the validator
 * for both. North is -z, east is +x. */

export const DEG = Math.PI / 180;
export const LAT = -79 * DEG;
export const DAY = 20 * 60;          // seconds of play for the sun to go once round
export const START_DAY = 0.36;       // he wakes mid-morning: the sun in the north-east, climbing

/** The season, 0 (high summer) .. 1 (the polar night), to the sun's declination. */
export function declination(s) {
  return (-23.2 + 35.8 * Math.pow(Math.max(0, Math.min(1.2, s)), 1.45)) * DEG;
}

/**
 * The direction to the sun (a unit vector, y up) for a time of day
 * (0..1, 0 = midnight) and a season. `out` is reused.
 */
export function sunDir(day, season, out) {
  out = out || {};
  const H = (day - 0.5) * 2 * Math.PI, d = declination(season);
  const E = -Math.cos(d) * Math.sin(H);
  const N = Math.sin(d) * Math.cos(LAT) - Math.cos(d) * Math.cos(H) * Math.sin(LAT);
  const U = Math.sin(d) * Math.sin(LAT) + Math.cos(d) * Math.cos(H) * Math.cos(LAT);
  out.x = E; out.y = U; out.z = -N;
  out.el = Math.asin(Math.max(-1, Math.min(1, U)));
  out.az = Math.atan2(E, N);
  return out;
}

/** Noon and midnight elevations for a season: how high the circle is. */
export function circle(season) {
  const a = sunDir(0.5, season), b = sunDir(0, season);
  return { noon: a.el, midnight: b.el };
}

/** Time of day from seconds of play. */
export const dayOf = (t) => (((t / DAY + START_DAY) % 1) + 1) % 1;

/**
 * How much the sun warms, 0..1: nothing below the horizon, little through
 * a long low path of air, most when high. (The real number would be the
 * airmass; this is its shape, and the warmth is a feeling, not a reading.)
 */
export function sunWarmth(el) {
  if (el <= 0) return 0;
  return Math.min(1, Math.sin(el) * 1.9) ** 0.8;
}

/** How dark it is, 0 (day) .. 1 (night): civil twilight is the slope. */
export function nightness(el) {
  const d = el / DEG;
  return d >= 2 ? 0 : d <= -9 ? 1 : (2 - d) / 11;
}

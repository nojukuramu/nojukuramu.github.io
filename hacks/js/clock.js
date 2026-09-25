/* clock.js — real time in, a whole number of fixed ticks out.
 *
 * The game never advances by "one frame". Each frame reports how much real
 * time passed (its delta), that time is banked, and the simulation is paid
 * out of the bank in fixed ticks (movement.js TICK, 1/64 s). Whatever is left
 * over, as a fraction of a tick, is how far between the last two ticks the
 * renderer should draw.
 *
 * That is stronger than scaling each step by delta time: a variable step
 * changes the answer (a jump is a few centimetres higher at 30 fps than at
 * 240 with a naive Euler step, and a bunny hop's one-tick timing window
 * would change size). With a fixed step, 30, 60, 144 and 240 frames a second
 * produce the same ticks with the same numbers in them — tools/validate.js
 * runs the same movement through this clock at all four and compares.
 *
 * Pure. */

export function makeClock(tick, maxSteps) {
  let acc = 0;
  return {
    /**
     * Bank `dt` seconds and run `step(tick)` as many times as that pays for.
     * Returns how far into the next tick we are (0..1), for drawing between.
     * A stall longer than maxSteps ticks (a tab in the background, a
     * debugger) is forgiven rather than raced to catch up.
     */
    advance(dt, step) {
      acc += Math.max(0, Math.min(dt, 0.25));
      let n = 0;
      while (acc >= tick && n < maxSteps) { step(tick); acc -= tick; n++; }
      if (n === maxSteps && acc >= tick) acc = 0;
      return Math.min(1, acc / tick);
    },
    reset() { acc = 0; },
    get banked() { return acc; }
  };
}

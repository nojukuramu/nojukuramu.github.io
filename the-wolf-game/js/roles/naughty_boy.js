/* naughty_boy.js — swaps two lives, once, and tells neither of them.
 *
 * The swap is two houses, so it arrives as a two-step: pick a door, then pick
 * the door it changes places with. Both players keep their names, their seats
 * and their entire understanding of the game, and both are now wrong.
 */
(function (global) {
  "use strict";
  var WG = global.WG;

  /** Shared by all three swappers. */
  function swap(c, oncePerGame) {
    var pending = c.actor._swapFirst;
    if (!pending) {
      c.actor._swapFirst = c.occupant.id;
      c.out.say(c.actor.id, "" + c.occupant.name + " is the first half. Pick the second house.", "act");
      return { ok: true, pending: { kind: "swap-second", firstId: c.occupant.id } };
    }
    if (pending === c.occupant.id) {
      c.out.say(c.actor.id, "That is the same house. Pick a different one.", "warn");
      return { ok: true, pending: { kind: "swap-second", firstId: pending } };
    }
    var a = c.P(pending), b = c.occupant;
    c.actor._swapFirst = null;
    /* The selector was evaluated when the FIRST house was picked, and the night
     * has moved since. If that player has died in between, going through with
     * it buries a live role in a corpse and deletes it from the game for good.
     * Re-check both ends against the rule the action actually declares. */
    if (!a || !b || !a.alive || !b.alive || a.spectator || b.spectator) {
      return { ok: false, reason: "One of those houses is gone. Start again." };
    }

    var ra = a.role, rb = b.role;
    a.role = rb; Object.assign(a, WG.roles.initialState(rb));
    b.role = ra; Object.assign(b, WG.roles.initialState(ra));
    if (oncePerGame) c.actor.hasSwapped = true;

    c.out.say(c.actor.id,
      "Swapped. " + a.name + " is a " + WG.roles.get(rb).name + ", " + b.name + " a " +
      WG.roles.get(ra).name + ". Neither was told.", "act");
    c.out.say([a.id, b.id], "Something changed. Read your card again.", "transform");
    return { ok: true };
  }

  WG.roles.define("naughty_boy", {
    actions: { swap_roles: function (c) { return swap(c, true); } },
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "They have left their life already.";
      }
    }
  });
  WG.roles._swap = swap;    // shared with the Crazy one and the Ghost
})(typeof window !== "undefined" ? window : globalThis);

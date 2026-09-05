/* fanatic.js — the cult's bodyguard, with the same timing problem.
 *
 * Same shape as the Bodyguard and the same lesson: arrive before whatever is
 * coming, or arrive and find out you were not needed because there was nothing
 * left to guard.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("fanatic", {
    actions: {
      guard_cult: function (c) {
        c.R.shield(c.state, c.house.ownerId, "bodyshield", c.actor.id, c.out);
        c.actor.guardTarget = c.occupant.id;
        c.out.say(c.actor.id, "At the door. Anything that comes for them gets you.", "act");
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "Too late. Nothing left to stand in front of.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

/* bodyguard.js — the role the whole redesign was written around.
 *
 * The Doctor turns a blade aside. The Bodyguard is a body standing where the
 * blade is going, which means arriving on time is the entire job. Arrive after
 * the pack has already been and you do not fail to protect anybody — you walk
 * up to a door you were going to stand at all night and find your charge dead
 * behind it, which is a different and much worse thing to be told.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("bodyguard", {
    actions: {
      guard: function (c) {
        c.R.shield(c.state, c.house.ownerId, "bodyshield", c.actor.id, c.out);
        c.actor.guarding = c.occupant.id;
        c.out.say(c.actor.id,
          "At the door, and not moving. The next thing through goes through you.", "act");
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) {
          return "Nobody has lived here for nights.";
        }
        return "You came to stand watch and found them already dead inside. Minutes late. Your night is still yours.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

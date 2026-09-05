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
          "You are at " + c.occupant.name + "'s door and you are not moving. " +
          "The next thing that comes through it goes through you first.", "act");
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) {
          return "You came to guard " + c.occupant.name + "'s house. There has been nobody in it for nights.";
        }
        return "You came to stand watch over " + c.occupant.name + " — and found them already dead inside. " +
          "You were minutes late. Whoever did this is still out there, and your night is still yours to spend.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

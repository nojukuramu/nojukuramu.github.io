/* fanatic_plus.js — what a Fanatic becomes when the Leader dies.
 *
 * A Doctor for the cult: the ward turns the attack away instead of catching it,
 * so the Fanatic+ is still there tomorrow.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("fanatic_plus", {
    actions: {
      save_cult: function (c) {
        if (c.actor.lastSaved === c.occupant.id) return { ok: false, reason: "Not the same one two nights running." };
        c.R.shield(c.state, c.house.ownerId, "shield", c.actor.id, c.out);
        c.actor.lastSaved = c.occupant.id;
        c.out.say(c.actor.id, "" + c.occupant.name + " is warded for the rest of the night.", "act");
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "Holding a ward, looking at a body.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

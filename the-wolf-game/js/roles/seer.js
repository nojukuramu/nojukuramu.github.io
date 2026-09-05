/* seer.js — one true thing a night, and the problem of saying it out loud.
 *
 * The read is honest about what it sees and not about what is there: a Lycan
 * comes back Werewolf, a Trickster comes back as whoever they last wore. The
 * Seer is never told which of those happened.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  WG.roles.define("seer", {
    actions: {
      investigate: function (c) {
        var seen = WG.roles.apparentRole(c.state, c.occupant);
        var def = WG.roles.get(seen);
        c.actor.readings = (c.actor.readings || []).concat([{ id: c.occupant.id, role: seen, night: c.state.round }]);
        c.out.say(c.actor.id,
          c.occupant.name + " is a " + def.name + ".", "read",
          { targetId: c.occupant.id, role: seen });
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        var def = WG.roles.get(c.occupant.role);
        return "A dead " + def.name + ". You know what they were, for what that is worth.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

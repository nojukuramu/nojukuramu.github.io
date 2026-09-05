/* alpha_wolf.js — turns the village into the pack rather than eating it.
 *
 * The bite is quiet and slow: the victim keeps their role, their information
 * and their honest belief in themselves for two more nights, and then wakes up
 * on the other side. They are told nothing until it happens, which means they
 * spend two days arguing sincerely for a side they are about to leave.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  WG.roles.define("alpha_wolf", {
    actions: {
      infect: function (c) {
        var t = c.occupant;
        if (t.infectedOn != null) return { ok: false, reason: "They are already carrying it." };
        t.infectedOn = c.state.round;
        c.actor.infectionsUsed = (c.actor.infectionsUsed || 0) + 1;
        c.out.say(c.actor.id,
          "You bit " + t.name + " while they slept. In two nights they will be one of yours, " +
          "and they will not see it coming either.", "act");
        WG.resolver.living(c.state).forEach(function (p) {
          if (p.id !== c.actor.id && WG.roles.isWolf(p.role)) {
            c.out.say(p.id, "🧬 The Alpha has bitten someone tonight.", "pack");
          }
        });
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "You came to bite " + c.occupant.name + ". There is nothing left in there worth turning.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

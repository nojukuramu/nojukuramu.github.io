/* wolf_shaman.js — deletes the evidence rather than making more of it.
 *
 * A marked victim of the pack leaves no body and no announcement. The village
 * gets a missing person and a morning with nothing in it, which is far worse
 * for them than a corpse: a corpse at least tells you a night happened.
 *
 * The mark is applied the moment it is drawn, so the rest of the pack can see
 * which door is safe to howl at. Only one may stand at a time.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  WG.roles.define("wolf_shaman", {
    actions: {
      mark: function (c) {
        c.state.players.forEach(function (p) {
          if (p.markedByShaman === c.actor.id) p.markedByShaman = null;
        });
        c.occupant.markedByShaman = c.actor.id;
        c.actor.markedPlayer = c.occupant.id;
        c.out.say(c.actor.id,
          "The sign is on " + c.occupant.name + "'s door. If the pack takes them, the village will never be told.",
          "act");
        WG.resolver.living(c.state).forEach(function (p) {
          if (p.id !== c.actor.id && WG.roles.isWolf(p.role)) {
            c.out.say(p.id, "🪦 The Shaman has marked " + c.occupant.name + ".", "pack");
          }
        });
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return c.body.hidden
          ? "Your sign held. " + c.occupant.name + " is gone, and the village will find an empty house and no story."
          : "You came to hide " + c.occupant.name + ", too late to hide anything. The village will see this one.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

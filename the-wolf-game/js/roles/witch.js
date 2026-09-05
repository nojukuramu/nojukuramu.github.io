/* witch.js — two bottles, and no way to get either back.
 *
 * On the live clock the save is worth much more early and the poison much more
 * late, which is a decision the old game never made anyone take.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("witch", {
    actions: {
      save: function (c) {
        c.R.shield(c.state, c.house.ownerId, "shield", c.actor.id, c.out);
        c.actor.savePotionUsed = true;
        c.out.say(c.actor.id,
          "🧪 The clear bottle is spent on " + c.occupant.name + "'s threshold. " +
          "Nothing lethal gets past it from now until dawn.", "act");
        return { ok: true };
      },
      poison: function (c) {
        c.actor.killPotionUsed = true;
        var res = c.R.kill(c.state, c.occupant.id, { cause: "poison", byId: c.actor.id, out: c.out });
        c.out.say(c.actor.id, res.result === "dead"
          ? "☠️ " + c.occupant.name + " will not wake up."
          : "☠️ You poured it, and something turned it aside. The bottle is gone regardless.", "act");
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "You came to " + c.occupant.name + "'s door with a bottle in each hand. " +
          "Neither of them is any use to a body.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

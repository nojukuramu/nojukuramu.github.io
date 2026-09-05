/* albularyo.js — the pack's one second chance.
 *
 * Reviving a wolf is never announced, so the village keeps counting a body it
 * no longer has. And because revival hands the turn back immediately, a wolf
 * raised early in the night still gets to howl in the same night's vote.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("albularyo", {
    actions: {
      albularyo_revive: function (c) {
        var res = c.R.revive(c.state, c.occupant.id, { out: c.out });
        if (res.result !== "alive") return { ok: false, reason: "They cannot be called back." };
        c.actor.hasRevived = true;
        c.out.say(c.actor.id,
          c.occupant.name + " is up, and nobody will hear of it.", "act");
        c.out.say(c.occupant.id, "You are back. Nobody knows you were gone.", "revive");
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        if (!c.state.night) return null;
        return (global.WG.roles.isWolf(c.occupant.role)
          ? "One of yours. You could do something about that."
          : "Not one of yours. The herbs would be wasted.");
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

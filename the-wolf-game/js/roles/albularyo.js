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
          c.occupant.name + " is on their feet again, and the village will never hear about it. " +
          "They still have tonight.", "act");
        c.out.say(c.occupant.id, "🌿 The Albularyo sat with you. Nobody else knows you were ever gone.", "revive");
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        if (!c.state.night) return null;
        return "You knelt by " + c.occupant.name + ". " +
          (global.WG.roles.isWolf(c.occupant.role)
            ? "One of yours. There is still something you could do about that."
            : "Not one of yours. The herbs would be wasted.");
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

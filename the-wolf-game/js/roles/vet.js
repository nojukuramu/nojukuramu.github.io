/* vet.js — only ever saves the animals, which sounds like a joke until the
 * Cat turns out to be the only honest witness the village has.
 *
 * A treated pet is back on its feet with its turn intact, so a Cat killed early
 * can still bite something before dawn.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("vet", {
    actions: {
      vet_revive: function (c) {
        var res = c.R.revive(c.state, c.occupant.id, { out: c.out });
        if (res.result !== "alive") return { ok: false, reason: "Nothing to be done for them." };
        c.actor.hasRevived = true;
        c.occupant.hasBeenTreatedByVet = true;
        var kind = c.occupant.role === "cat" ? "cat" : "dog";
        c.out.say(c.actor.id, c.occupant.name + " is breathing, and still has tonight.", "act");
        c.out.say(c.occupant.id, "The Vet got to you. The night is not over.", "revive");
        c.out.say("all", "" + c.occupant.name + " was carried in half dead and walked out.", "revive");
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        var pet = c.occupant.role === "cat" || c.occupant.role === "dog";
        if (!pet) return "Dead, and not an animal. Nothing here for you.";
        return "Dead - and exactly the kind of patient you can still help.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

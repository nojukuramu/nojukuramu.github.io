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
        c.out.say(c.actor.id, "🩺 The " + kind + " is breathing. " + c.occupant.name + " has the rest of the night.", "act");
        c.out.say(c.occupant.id, "🩺 The Vet got to you in time. You are alive, and the night is not over.", "revive");
        c.out.say("all", "🩺 " + c.occupant.name + " was carried in half dead and walked out on their own.", "revive");
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        var pet = c.occupant.role === "cat" || c.occupant.role === "dog";
        if (!pet) return "You found " + c.occupant.name + " dead. You are a vet. There is nothing here for you.";
        return "You found " + c.occupant.name + " dead — and they are exactly the kind of patient you can still do something about.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

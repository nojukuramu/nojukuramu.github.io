/* cat.js — knows which house smells wrong and cannot tell you which one.
 *
 * The bite is harmless to everyone except a wolf, and fatal to the Cat if it
 * finds one. So a dead Cat in the morning is a real piece of evidence — it
 * means the pack is one of the houses the Cat visited — except the Cat is the
 * only one who knew which houses those were, and it could only ever meow.
 */
(function (global) {
  "use strict";
  var WG = global.WG;

  function bite(c, noise) {
    var t = c.occupant;
    c.actor.lastBiteTarget = t.id;
    c.out.say(t.id, "🦷 Something small got in and bit you in the night. It did no real harm.", "bite");
    if (WG.roles.isWolf(t.role)) {
      c.out.say(c.actor.id, "🦷 You bit " + t.name + " and something much larger bit back.", "death");
      c.R.kill(c.state, c.actor.id, { cause: "bite", byId: t.id, out: c.out, ignoreShields: true });
      c.out.say(t.id, "It was not a person. You dealt with it.", "pack");
    } else {
      c.out.say(c.actor.id, "🦷 You bit " + t.name + ". Nothing happened, which tells you something.", "act");
    }
    return { ok: true };
  }

  WG.roles.define("cat", {
    actions: { bite: function (c) { return bite(c, "meow"); } },
    hooks: {
      brief: function () {
        return { title: "Meow", lines: ["You cannot type words during the day. Only meows. The room sees them as meows."] };
      },
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "You got in through " + c.occupant.name + "'s window. They do not wake up. There is nothing here to bite.";
      }
    }
  });
  WG.roles._bite = bite;
})(typeof window !== "undefined" ? window : globalThis);

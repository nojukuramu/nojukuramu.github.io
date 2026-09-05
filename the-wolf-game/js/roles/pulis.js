/* pulis.js — armed, and held to account for it.
 *
 * Two mutually exclusive actions a night. Searching a body is unlimited and
 * safe. Shooting is one charge, resolves instantly, and settles the role's whole
 * future in a single moment: shoot a villager and you are a villager, shoot
 * anything else and you are cleared for as many as you like.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  WG.roles.define("pulis", {
    actions: {
      pulis_investigate: function (c) {
        var def = WG.roles.get(c.occupant.role);
        var cause = WG.protocol.CAUSE_TEXT[(c.house.body || {}).cause] || "dead, and the how is not obvious";
        c.actor.investigationsUsed = (c.actor.investigationsUsed || 0) + 1;
        c.out.say(c.actor.id,
          "🔦 " + c.occupant.name + " was a " + def.name + " " + def.icon + ". They were " + cause + ".",
          "read", { targetId: c.occupant.id, role: c.occupant.role });
        return { ok: true };
      },

      pulis_kill: function (c) {
        var t = c.occupant;
        var village = WG.roles.teamOf(t.role) === "village";
        c.actor.killsUsed = (c.actor.killsUsed || 0) + 1;
        var res = c.R.kill(c.state, t.id, { cause: "gunshot", byId: c.actor.id, out: c.out });

        if (res.result !== "dead") {
          c.out.say(c.actor.id, "🔫 You fired and they are still standing. Somebody was in the way.", "act");
          return { ok: true };
        }
        if (village) {
          c.actor.role = "villager";
          c.actor.isDemoted = true;
          Object.assign(c.actor, WG.roles.initialState("villager"));
          c.actor.isDemoted = true;
          c.out.say(c.actor.id,
            "⚖️ " + t.name + " was one of yours. The badge is gone — you are an ordinary Villager now, " +
            "and you are the only one who knows why.", "transform");
        } else {
          c.actor.hasUnlimitedKills = true;
          c.out.say(c.actor.id,
            "🔥 " + t.name + " was not what they were pretending to be. You are cleared. No more limits.", "act");
        }
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        return "You have a body and a torch. " + c.occupant.name +
          (c.body.night === c.state.round ? " has not been dead an hour." : " has been dead for some time.");
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

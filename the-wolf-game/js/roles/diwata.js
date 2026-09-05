/* diwata.js — kill her with teeth and the forest settles the whole account.
 *
 * A werewolf kill on the Diwata kills every living werewolf, which normally
 * ends the game on the spot. Anything else that comes for her fails once, and
 * the second attempt leaves an ordinary Villager where she was.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  WG.roles.define("diwata", {
    actions: {},
    hooks: {
      onKilled: function (c) {
        if (c.self.isDemoted) return null;
        if (c.cause === "pack") return null;      // she dies; the curse fires in onDeath
        if (!c.self.hasUsedImmunity) {
          c.self.hasUsedImmunity = true;
          c.out.say(c.self.id, "🌟 Something reached for you tonight and the trees did not allow it.", "saved");
          return { prevent: true, result: "warded" };
        }
        c.self.role = "villager";
        c.self.isDemoted = true;
        Object.assign(c.self, WG.roles.initialState("villager"));
        c.self.isDemoted = true;
        c.out.say(c.self.id, "😔 The forest has stopped answering. You are an ordinary Villager, and you are still in danger.", "transform");
        return null;                              // demoted, and the kill lands
      },

      onDeath: function (c) {
        if (c.cause !== "pack" || c.self.isDemoted) return null;
        var wolves = c.state.players.filter(function (p) { return p.alive && WG.roles.isWolf(p.role); });
        wolves.forEach(function (w) {
          c.R.kill(c.state, w.id, { cause: "retribution", byId: c.self.id, out: c.out, ignoreShields: true });
        });
        c.out.say("all",
          "🧚‍♀️ The trees kept a count, and last night they settled it. Every werewolf in this village is dead.",
          "retribution");
        return { public: "The forest has taken its side." };
      },

      onLynch: function (c) {
        if (c.self.isDemoted) return null;
        if (!c.self.hasUsedImmunity) {
          c.self.hasUsedImmunity = true;
          return { prevent: true, message: c.self.name + " was voted out and the rope would not hold. They walked home." };
        }
        c.self.role = "villager";
        c.self.isDemoted = true;
        return null;
      },

      brief: function (c) {
        return {
          title: "The ward",
          lines: [
            c.self.hasUsedImmunity ? "Your ward is spent." : "One attempt on your life that is not a wolf's will fail.",
            "If the pack takes you, every werewolf dies with you."
          ]
        };
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

/* diseased.js — poisonous to eat.
 *
 * The passive fires on the wolf that actually carried out the kill, which on
 * the live clock is a specific, identifiable wolf rather than "the pack".
 */
(function (global) {
  "use strict";
  global.WG.roles.define("diseased", {
    actions: {},
    hooks: {
      onDeath: function (c) {
        if (c.cause !== "pack") return null;
        var killer = c.state.players.filter(function (p) { return p.id === c.byId && p.alive; })[0];
        if (!killer) return null;
        c.out.say(killer.id, "You ate something that was already dying.", "death");
        c.R.kill(c.state, killer.id, { cause: "disease", byId: c.self.id, out: c.out, ignoreShields: true });
        return { public: "Whatever came through that window did not walk away." };
      },
      brief: function () {
        return { title: "Bad meat", lines: ["You have no power and no night action. The wolf that kills you dies of it."] };
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

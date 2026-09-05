/* naughty_ghost.js — harmless until you kill it.
 *
 * A villager with a task while alive. Dead, it keeps taking night turns and
 * starts swapping roles like the Crazy one — so the pack's tidiest night can
 * be the move that hands the village its most disruptive piece.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  WG.roles.define("naughty_ghost", {
    actions: { swap_roles: function (c) { return WG.roles._swap(c, false); } },
    hooks: {
      onDeath: function (c) {
        c.out.say(c.self.id,
          "👻 You are dead, and that was the promotion. From tonight you can reach into two houses " +
          "and swap what is inside them, every night, for as long as this goes on.", "transform");
        return null;
      },
      brief: function (c) {
        return c.self.alive
          ? { title: "For now", lines: ["An ordinary villager. This changes when you die."] }
          : { title: "Restless", lines: ["Pick two houses each night and swap what is in them. Nobody can stop you."] };
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

/* cultist.js — converted, and useless for two more nights.
 *
 * The waiting is the cost of the Leader's recruitment. Two nights of ordinary
 * villager work and the Cultist becomes a Fanatic, which is when the cult stops
 * being a rumour and starts being a problem.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("cultist", {
    actions: {},
    hooks: {
      brief: function (c) {
        var left = Math.max(0, 2 - (c.self.nightsAsCultist || 0));
        var cult = c.state.players.filter(function (p) {
          return p.alive && global.WG.roles.isCult(p.role) && p.id !== c.self.id;
        }).map(function (p) { return p.name; });
        return {
          title: "The cult",
          lines: [
            left ? left + (left === 1 ? " night until you become a Fanatic." : " nights until you become a Fanatic.") : "You become a Fanatic tonight.",
            cult.length ? "With you: " + cult.join(", ") : "You are alone in this so far."
          ]
        };
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

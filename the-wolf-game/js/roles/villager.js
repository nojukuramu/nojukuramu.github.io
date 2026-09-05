/* villager.js — no power, and the whole game rests on them anyway.
 *
 * The one thing a Villager has that nobody else does is a route out: enough
 * nights of work and the village hands them a real role. It keeps the largest
 * group in the game from being a group with nothing to do.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("villager", {
    actions: {},          // `task` is generic
    hooks: {
      /** Promotion is checked between phases, not during one. */
      onPhaseEnd: function (c) {
        if (!c.self.alive || c.self.hasUpgraded) return null;
        if ((c.self.totalScore || 0) < 1000) return null;
        var pool = global.WG.roles.all().filter(function (r) {
          if (r.team !== "village") return false;
          if (["villager", "cat", "dog"].indexOf(r.id) >= 0) return false;
          // One Mayor is the point of a Mayor.
          if (r.id === "mayor" && c.state.players.some(function (p) { return p.alive && p.role === "mayor"; })) return false;
          return true;
        });
        if (!pool.length) return null;
        var picked = pool[Math.floor(Math.random() * pool.length)];
        c.self.hasUpgraded = true;
        c.self.totalScore = 0;
        c.self.role = picked.id;
        Object.assign(c.self, global.WG.roles.initialState(picked.id));
        c.out.say(c.self.id,
          "The village has been watching you work. You are the " + picked.name + " now.", "transform");
        return { public: "Someone in the village has grown into something more useful." };
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

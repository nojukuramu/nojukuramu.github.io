/* avenger.js — the oath fires on death, whichever death it was.
 *
 * Re-swearable every night, so the Avenger can follow the argument. Being
 * hanged at noon works exactly as well as being eaten at night.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("avenger", {
    actions: {
      revenge: function (c) {
        c.actor.revengeTarget = c.occupant.id;
        c.out.say(c.actor.id,
          "⚔️ Sworn. If you die tonight or tomorrow, " + c.occupant.name + " goes with you.", "act");
        return { ok: true };
      }
    },
    hooks: {
      onDeath: function (c) {
        var target = c.state.players.filter(function (p) { return p.id === c.self.revengeTarget; })[0];
        if (!target || !target.alive) return null;
        c.out.say(c.self.id, "You are dead. So is " + target.name + ".", "death");
        c.R.kill(c.state, target.id, { cause: "revenge", byId: c.self.id, out: c.out });
        return { public: "Someone died with a hand still holding on." };
      },
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "You came to swear on " + c.occupant.name + ". They are past being anybody's revenge.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

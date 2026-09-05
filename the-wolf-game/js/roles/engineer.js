/* engineer.js — a bell on a door.
 *
 * The trap reports live. On a clock where everybody moves at once, that turns
 * the Engineer into the only villager who learns things while the night is
 * still running, and therefore the only one who can be too late on purpose.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("engineer", {
    actions: {
      trap: function (c) {
        Object.keys(c.night.houses).forEach(function (hid) {
          var h = c.night.houses[hid];
          if (h.trap && h.trap.byId === c.actor.id) h.trap = null;
        });
        c.house.trap = { byId: c.actor.id, at: c.at };
        c.actor.trapSet = c.house.ownerId;
        c.out.say(c.actor.id,
          "🪤 The doorway at " + c.occupant.name + "'s is rigged. From now until dawn you get a name " +
          "the moment anyone walks in.", "act");
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "You came to rig " + c.occupant.name + "'s doorway. There is no longer anything worth catching here.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

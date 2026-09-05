/* doppelganger.js — stops being what it was.
 *
 * Not a disguise and not a copy of an appearance: the role, the team and the
 * win condition all change hands, permanently, and the original keeps theirs.
 * Copying a wolf makes you a wolf, on the wolves' side, for the rest of the game.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  WG.roles.define("doppelganger", {
    actions: {
      copy: function (c) {
        var taken = c.occupant.role;
        var def = WG.roles.get(taken);
        c.actor.hasCopied = true;
        c.actor.role = taken;
        Object.assign(c.actor, WG.roles.initialState(taken));
        c.actor.hasCopied = true;
        c.out.say(c.actor.id,
          "You are a " + def.name + " now, on the " +
          WG.roles.teams[def.team].name + " side, and there is no going back. " +
          c.occupant.name + " has no idea.", "transform", { role: taken });
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "You came to study " + c.occupant.name + " until you were them. " +
          "You would rather not be what they are now.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

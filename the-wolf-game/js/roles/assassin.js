/* assassin.js — hunts titles, not people.
 *
 * Stalking is safe, unlimited, and always one night late. Assassination is
 * instant and symmetrical: name the role correctly and they die, name it wrong
 * and you do. Charges are handed out at setup, one per leader actually in the
 * game, so the Assassin always has exactly enough knives for the job and not
 * one spare.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  WG.roles.define("assassin", {
    actions: {
      stalk: function (c) {
        var seen = WG.roles.apparentRole(c.state, c.occupant);
        c.actor.pendingStalkResults = (c.actor.pendingStalkResults || []).concat([{
          name: c.occupant.name, role: seen, night: c.state.round
        }]);
        c.out.say(c.actor.id,
          "👁️ You watched " + c.occupant.name + "'s house all night. You will know what they are by your next turn.",
          "act");
        return { ok: true };
      },

      assassinate: function (c) {
        var guess = c.payload.roleGuess;
        if (!WG.roles.get(guess)) return { ok: false, reason: "Name a real role." };
        c.actor.killCharges = Math.max(0, (c.actor.killCharges || 0) - 1);

        if (c.occupant.role === guess) {
          c.out.say(c.actor.id, "🗡️ Right first time. " + c.occupant.name + " was a " + WG.roles.get(guess).name + ".", "act");
          c.R.kill(c.state, c.occupant.id, { cause: "assassin", byId: c.actor.id, out: c.out });
        } else {
          c.out.say(c.actor.id, "🗡️ Wrong. They were not a " + WG.roles.get(guess).name + ", and they were faster than you.", "death");
          c.R.kill(c.state, c.actor.id, { cause: "suicide", byId: c.occupant.id, out: c.out, ignoreShields: true });
        }
        return { ok: true };
      }
    },
    hooks: {
      /** Last night's stalking, delivered at the top of tonight's turn. */
      brief: function (c) {
        var pending = c.self.pendingStalkResults || [];
        var due = pending.filter(function (r) { return r.night < c.state.round; });
        c.self.pendingStalkResults = pending.filter(function (r) { return r.night >= c.state.round; });
        var leaders = WG.roles.LEADER_ROLES.filter(function (rid) {
          return c.state.players.some(function (p) { return p.alive && p.role === rid; });
        }).map(function (rid) { return WG.roles.get(rid).name; });

        var lines = due.map(function (r) { return r.name + " is a " + WG.roles.get(r.role).name + "."; });
        lines.push(leaders.length ? "Still standing: " + leaders.join(", ") + "." : "Every leader is dead. That is the game.");
        lines.push((c.self.killCharges || 0) + " knives left.");
        return { title: "The list", lines: lines };
      },
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "You came for " + c.occupant.name + " with a knife and a name. Somebody spent it for you.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

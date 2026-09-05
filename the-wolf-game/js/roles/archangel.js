/* archangel.js — a lightning rod that raises the dead.
 *
 * Two passives, one shared clause. Killed by the pack, every wolf that howled
 * for that house dies. Killed by anything else, the killer dies instead. Either
 * way the Archangel survives the attempt and is stripped to an ordinary
 * Villager for the rest of the game — so the role is a single enormous
 * one-shot, and everybody who spends it on you loses more than you do.
 *
 * (The legacy engine both killed the Archangel and demoted it, which meant the
 * retribution text fired over a corpse. Surviving the attempt is what the two
 * passives were plainly written to mean, so that is what happens here.)
 *
 * The revival is the other half, and on the live clock it is much stronger than
 * it was: the raised player gets their turn back for the night they are
 * standing in, not the next one.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  WG.roles.define("archangel", {
    actions: {
      revive: function (c) {
        var role = c.payload.newRole;
        if (c.payload.assignment !== "manual" || !WG.roles.get(role)) {
          var pool = WG.roles.all().filter(function (r) {
            return r.team === "village" && ["archangel", "mayor", "villager"].indexOf(r.id) < 0;
          });
          role = pool[Math.floor(Math.random() * pool.length)].id;
        }
        var res = c.R.revive(c.state, c.occupant.id, { newRole: role, out: c.out });
        if (res.result !== "alive") return { ok: false, reason: "They are beyond calling back." };

        c.actor.hasRevived = true;
        var def = WG.roles.get(role);
        var reveal = c.payload.reveal !== false;
        c.out.say(c.actor.id, "" + c.occupant.name + " is back as a " + def.name + ", with tonight intact.", "act");
        c.out.say(c.occupant.id, "Pulled back. You are a " + def.name + " now.", "revive");
        c.out.say("all", reveal
          ? "" + c.occupant.name + " is back, as a " + def.name + "."
          : "" + c.occupant.name + " is back. Nobody will say as what.", "revive");
        return { ok: true };
      }
    },
    hooks: {
      onKilled: function (c) {
        if (c.self.isDemoted) return null;
        var out = c.out, state = c.state;

        if (c.cause === "pack") {
          var howlers = (state.night && state.night.packHowlers) || [];
          var died = 0;
          howlers.forEach(function (wid) {
            var w = state.players.filter(function (p) { return p.id === wid && p.alive; })[0];
            if (!w) return;
            died++;
            c.R.kill(state, w.id, { cause: "retribution", byId: c.self.id, out: out, ignoreShields: true });
          });
          fall(c);
          out.say("all", died
            ? "Something answered the pack, and " + died + " did not make it home."
            : "Something in the village answered the pack.", "retribution");
          return { prevent: true, result: "retribution" };
        }

        var killer = c.state.players.filter(function (p) { return p.id === c.byId && p.alive; })[0];
        if (killer) {
          c.R.kill(state, killer.id, { cause: "retribution", byId: c.self.id, out: out, ignoreShields: true });
          out.say("all", "Somebody raised a hand against the wrong person. It was the last thing they did.", "retribution");
        }
        fall(c);
        return { prevent: true, result: "retribution" };
      },

      /** Voted out: the village strips the wings and the body walks home. */
      onLynch: function (c) {
        if (c.self.isDemoted) return null;
        fall(c);
        return { prevent: true, message: c.self.name + " was voted out — and did not die. Whatever they were, they are not it any more." };
      },

      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "Still warm. You could call them back tonight, in time to matter.";
      }
    }
  });

  function fall(c) {
    c.self.role = "villager";
    c.self.isDemoted = true;
    Object.assign(c.self, WG.roles.initialState("villager"));
    c.self.isDemoted = true;
    c.out.say(c.self.id, "Alive, and nothing special any more. Ordinary Villager.", "transform");
  }
})(typeof window !== "undefined" ? window : globalThis);

/* cult_leader.js — wins without killing anybody, which is why nobody counts.
 *
 * Recruitment is a real offer now rather than a dice roll: the target is asked,
 * on their own phone, while the night is running, and they answer. Refusing
 * costs the Leader a charge either way, so three attempts is three attempts.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  WG.roles.define("cult_leader", {
    actions: {
      recruit: function (c) {
        if (WG.roles.isWolf(c.occupant.role)) return { ok: false, reason: "There is nothing in there to convert." };
        c.actor.recruitsLeft = Math.max(0, (c.actor.recruitsLeft == null ? 3 : c.actor.recruitsLeft) - 1);

        var id = "consent_" + c.occupant.id + "_" + c.state.round;
        c.night.prompts[id] = {
          id: id, kind: "recruit", to: c.occupant.id, from: c.actor.id,
          question: "Somebody knocked, and made you an offer. Do you take it?",
          accept: "Join them", decline: "Shut the door",
          expiresAt: c.at + 60000
        };
        c.out.say(c.occupant.id, "🕯️ Somebody is at your door with an offer.", "prompt", { promptId: id });
        c.out.say(c.actor.id, "🕯️ You made the offer to " + c.occupant.name + ". They are deciding.", "act");
        return { ok: true };
      }
    },
    hooks: {
      /** Answered from the engine when the target replies. */
      onConsent: function (c) {
        var target = c.target, leader = c.self;
        if (!c.ok) {
          c.out.say(leader.id, "🚪 " + target.name + " shut the door on you.", "warn");
          c.out.say(target.id, "You shut the door. You have no idea who that was.", "info");
          return null;
        }
        target.role = "cultist";
        Object.assign(target, WG.roles.initialState("cultist"));
        target.recruitedOn = c.state.round;
        c.out.say(target.id, "🕯️ You are a Cultist. You keep your name, your house and your face. Nothing else.", "transform");
        c.out.say(leader.id, "🕯️ " + target.name + " is one of ours.", "act");
        c.state.players.forEach(function (p) {
          if (p.alive && WG.roles.isCult(p.role) && p.id !== target.id && p.id !== leader.id) {
            c.out.say(p.id, "🕯️ " + target.name + " has joined us.", "team");
          }
        });
        return null;
      },
      onDeath: function (c) {
        var promoted = 0;
        c.state.players.forEach(function (p) {
          if (p.alive && p.role === "fanatic") {
            p.role = "fanatic_plus";
            Object.assign(p, WG.roles.initialState("fanatic_plus"));
            promoted++;
            c.out.say(p.id, "💥 The Leader is dead. You are Fanatic+ now — you can save them outright instead of dying for them.", "transform");
          }
        });
        return promoted ? { public: null } : null;
      },
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "You knocked at " + c.occupant.name + "'s to make the offer. There is nobody left in there to accept it.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

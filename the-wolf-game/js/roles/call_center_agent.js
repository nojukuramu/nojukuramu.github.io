/* call_center_agent.js — puts a player on hold.
 *
 * You write a question and mark the right answer; the next night your mark
 * cannot do anything at all until they get it right. On a clock where the whole
 * night is a race, delaying somebody by ninety seconds is a kill they did not
 * get to prevent — which makes this the most quietly vicious village role in
 * the game, and the reason it only gets two calls.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("call_center_agent", {
    actions: {
      call_center_block: function (c) {
        var q = c.payload.quiz;
        if (!q || !q.question || !Array.isArray(q.choices) || q.choices.length !== 4) {
          return { ok: false, reason: "Write a question and four answers first." };
        }
        var correct = Number(q.correct);
        if (!(correct >= 0 && correct < 4)) return { ok: false, reason: "Mark which answer is the right one." };

        c.state.pendingQuizzes = c.state.pendingQuizzes || {};
        c.state.pendingQuizzes[c.occupant.id] = {
          byId: c.actor.id,
          question: String(q.question).slice(0, 200),
          choices: q.choices.map(function (s) { return String(s).slice(0, 80); }),
          correct: correct,
          attempts: 0
        };
        c.actor.chargesUsed = (c.actor.chargesUsed || 0) + 1;
        c.out.say(c.actor.id,
          "☎️ " + c.occupant.name + " will be on hold tomorrow night until they answer you correctly.", "act");
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "You rang " + c.occupant.name + "'s house and let it ring. Nobody is going to pick up.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

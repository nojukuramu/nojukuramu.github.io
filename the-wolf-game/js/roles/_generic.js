/* _generic.js — the actions that belong to no role in particular.
 *
 * Four roles howl for the kill and eleven do the night's work; writing either
 * out eleven times would guarantee that one of the eleven eventually drifts.
 * A role can still override any of these by declaring its own handler — the
 * registry checks against both, so nothing here can hide a missing implementation.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});
  var G = WG.roles.defineGeneric;

  /* The pack's vote. Not resolved here — the resolver settles it the moment the
   * last wolf has howled, which is what keeps the kill inside the night's real
   * ordering instead of deferring it to dawn. */
  G("wolf_vote", function (c) {
    c.R.packVote(c.state, c.actor.id, c.house.ownerId, c.out);
    c.out.say(c.actor.id, "You howled for " + c.occupant.name + ".", "act");
    return { ok: true };
  });

  /* Night work. Villagers climb towards a promotion on it; everybody else does
   * it because a role with no night action still has to end its night somehow,
   * and "stayed in" is a truthful thing for the Detective to read tomorrow. */
  G("task", function (c) {
    var score = Math.max(0, Math.round(Number(c.payload.score) || 0));
    if (score > 400) score = 400;                  // one puzzle is worth one puzzle
    c.actor.totalScore = (c.actor.totalScore || 0) + score;
    c.out.say(c.actor.id, score
      ? "Night's work done. " + score + " points — " + (c.actor.totalScore || 0) + " in total."
      : "You bolted the door and waited it out.", "act");
    return { ok: true };
  });

  G("stay_in", function (c) {
    c.out.say(c.actor.id, "You stayed in and let the night go by.", "act");
    return { ok: true };
  });

  /* Raising the alarm. Free, available to anyone who can see the body, and
   * pointedly available to the killer too: a wolf reporting its own work is a
   * real play, and the village only ever learns who found the body, never
   * whether finding it was a coincidence. */
  G("report", function (c) {
    if (c.house.reportedBy) return { ok: false, reason: "Already reported." };
    c.house.reportedBy = c.actor.id;
    c.house.body.reportedAt = c.at;
    c.actor.reportedBodies = (c.actor.reportedBodies || 0) + 1;
    c.out.say(c.actor.id,
      "You raised the alarm over " + c.occupant.name + ". The village will know at dawn that you were the one who found them.",
      "act");
    return { ok: true, spent: false };
  });
})(typeof window !== "undefined" ? window : globalThis);

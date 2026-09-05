/* detective.js — reads movement, which is the one thing nobody can disguise.
 *
 * Roles lie, appearances are copied, and the Seer can be fed a Lycan. Footprints
 * are just footprints. The trade is that this is always a night behind.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("detective", {
    actions: {
      detect: function (c) {
        var last = (c.state.lastNight && c.state.lastNight.visits) || {};
        var went = last[c.occupant.id] || [];
        var came = [];
        Object.keys(last).forEach(function (visitorId) {
          last[visitorId].forEach(function (v) {
            if (v.houseId === c.occupant.id && visitorId !== c.occupant.id) came.push(visitorId);
          });
        });
        var goneTo = went
          .filter(function (v) { return v.houseId !== c.occupant.id; })
          .map(function (v) { return (c.P(v.houseId) || {}).name; })
          .filter(Boolean);

        var lines = [];
        lines.push(goneTo.length
          ? c.occupant.name + " went to " + goneTo.join(" and ") + " last night."
          : c.occupant.name + " never left their own house last night.");
        lines.push(came.length
          ? came.length + (came.length === 1 ? " person came to theirs." : " people came to theirs.")
          : "Nobody came to theirs.");

        c.out.say(c.actor.id, lines.join(" "), "read",
          { targetId: c.occupant.id, went: goneTo, visitors: came.length });
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        var n = c.house.visits.length;
        return "A body, and " + (n ? n + " sets of prints on the step." : "one set of prints on the step. Yours.");
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

/* dog.js — the same deal as the Cat, louder.
 *
 * Kept as its own file rather than an alias because they are two seats at the
 * table, the Vet can only treat each of them once, and a room that ends up with
 * both should be able to tell them apart everywhere it matters.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  WG.roles.define("dog", {
    actions: { bite: function (c) { return WG.roles._bite(c, "bark"); } },
    hooks: {
      brief: function () {
        return { title: "Bark", lines: ["You cannot type words during the day. Only barks. The room sees them as barks."] };
      },
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "You got into " + c.occupant.name + "'s house and they will not get up. You bark at them anyway.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

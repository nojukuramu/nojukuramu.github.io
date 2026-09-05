/* werewolf.js — the pack's rank and file.
 *
 * No individual power at all. What a Werewolf has is a vote in a small group
 * that already trusts each other, on the first night, when nobody else knows
 * anything. That is usually enough.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("werewolf", {
    actions: {},            // wolf_vote is generic; the pack is a shared machine
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        if (c.body.cause === "pack") {
          return "Already done. The pack was here first.";
        }
        return "Somebody beat you to it. Not one of yours.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

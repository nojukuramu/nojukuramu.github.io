/* crazy_naughty_boy.js — the same trick, every night, forever.
 *
 * By the fourth night nobody is who they say they are and about half of them
 * are sincerely wrong about it, which is either the best or the worst thing
 * that can happen to a game of this.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  WG.roles.define("crazy_naughty_boy", {
    actions: { swap_roles: function (c) { return WG.roles._swap(c, false); } },
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "Their life is not worth much now.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

/* lycan.js — innocent, and reads guilty every single time.
 *
 * `seenAs` in the data does all the work; there is nothing to run. The role is
 * a pure information trap, and telling the player about it is the mercy that
 * makes it playable rather than merely unfair.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("lycan", {
    actions: {},
    hooks: {
      brief: function () {
        return { title: "Bad blood", lines: ["Anyone who reads you sees a Werewolf. You are not one. Good luck."] };
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

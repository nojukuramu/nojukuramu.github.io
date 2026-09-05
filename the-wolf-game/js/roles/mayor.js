/* mayor.js — a known honest voice, and therefore a target.
 *
 * Everything the Mayor has happens in daylight. The role's entire cost is that
 * it is public: the pack knows exactly which house to visit on night one.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("mayor", {
    actions: {},
    hooks: {
      brief: function (c) {
        return { title: "Known", lines: ["Every village-team player can see that you are the Mayor. So can the ones who are not."] };
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

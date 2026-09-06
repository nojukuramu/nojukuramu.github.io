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
        // js/engine/view.js reveals the Mayor to teamOf(viewer) === "village"
        // and to nobody else, and list_of_roles.json says the same. The card
        // used to tell the player the pack could see them too, which is a whole
        // day's argument built on nothing.
        return { title: "Known", lines: ["Every village-team player can see that you are the Mayor. The rest of the village's enemies have to work it out."] };
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

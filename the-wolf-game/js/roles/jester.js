/* jester.js — wants the rope, and only the rope.
 *
 * Dying at night is a loss. The Jester has to be voted out, in daylight, by
 * people who think they are doing the right thing — which means playing badly
 * on purpose, well enough that it does not look purposeful.
 */
(function (global) {
  "use strict";
  var ERRANDS = [
    "You spent the night moving something heavy from one side of your house to the other.",
    "You washed your hands for a very long time. Nobody saw. That is the problem.",
    "You buried something in the garden. It was a spoon.",
    "You practised looking calm in a mirror until you looked extremely guilty.",
    "You went out, walked past three houses, and came home. No reason."
  ];
  global.WG.roles.define("jester", {
    actions: {
      task: function (c) {
        var line = ERRANDS[Math.floor(Math.random() * ERRANDS.length)];
        c.out.say(c.actor.id, "🎭 " + line + " It achieved nothing. Make sure somebody suspects you anyway.", "act");
        return { ok: true };
      }
    },
    hooks: {
      onLynch: function (c) {
        c.state.jesterWasLynched = c.self.id;
        return null;                        // the rope still works; the win check reads the flag
      },
      brief: function () {
        return { title: "The plan", lines: ["Get hanged. Only being voted out counts — dying at night loses."] };
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

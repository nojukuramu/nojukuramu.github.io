/* manipulator.js — sees everything, does nothing, takes the win.
 *
 * Whichever side wins, the Manipulator wins instead, provided they are alive to
 * claim it. So the whole role is a survival problem played with perfect
 * information, and every single other player is working for them.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  WG.roles.define("manipulator", {
    actions: {},
    hooks: {
      brief: function (c) {
        var lines = c.state.players.map(function (p) {
          var d = WG.roles.get(p.role);
          return (p.alive ? "" : "† ") + p.name + " — " + d.icon + " " + d.name;
        });
        return { title: "Everyone", lines: lines };
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

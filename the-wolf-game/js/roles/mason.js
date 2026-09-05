/* mason.js — two people who are certain of each other.
 *
 * No night power at all. The whole role is a piece of information the village
 * cannot manufacture: one relationship nobody had to take on trust.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("mason", {
    actions: {},
    hooks: {
      /** What the role card shows this player, rebuilt each night. */
      brief: function (c) {
        var others = c.state.players.filter(function (p) {
          return p.alive && p.role === "mason" && p.id !== c.self.id;
        });
        return others.length
          ? { title: "Fellow Masons", lines: others.map(function (p) { return p.name; }) }
          : { title: "Fellow Masons", lines: ["You are the only one left."] };
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

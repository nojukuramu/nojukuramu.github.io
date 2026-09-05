/* trickster.js — wears other people's roles for the benefit of investigators.
 *
 * The Trickster keeps its own role and team; only what a reader sees changes.
 * As a side effect they get the copied role's night briefing, which is the only
 * reason anyone plays it: you find out what a Seer's card looks like from the
 * inside, and can lie about it accurately.
 */
(function (global) {
  "use strict";
  var WG = global.WG;
  WG.roles.define("trickster", {
    actions: {
      copy_appearance: function (c) {
        var worn = c.occupant.role;
        var def = WG.roles.get(worn);
        c.actor.currentAppearance = worn;
        c.actor.copyTarget = c.occupant.id;
        c.out.say(c.actor.id,
          "Readers see a " + def.name + " now. You get their view of the night.", "act", { appearance: worn });
        return { ok: true };
      }
    },
    hooks: {
      brief: function (c) {
        var worn = c.self.currentAppearance || "villager";
        var def = WG.roles.get(worn);
        return { title: "Wearing", lines: [def.name + " - " + def.description] };
      },
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "A dead face would fool nobody.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

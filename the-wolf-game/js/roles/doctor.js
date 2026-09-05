/* doctor.js — the shield, and the first role the new clock genuinely changed.
 *
 * A protection is not a rule about the night any more. It is a thing you did at
 * a time, and it only covers what arrives after it. Sit up with somebody at
 * 00:12 and every knife after 00:12 goes elsewhere; get there at 00:44, after
 * the pack settled at 00:38, and you are not a Doctor tonight — you are the
 * person who found the body.
 */
(function (global) {
  "use strict";
  global.WG.roles.define("doctor", {
    actions: {
      protect: function (c) {
        c.R.shield(c.state, c.house.ownerId, "shield", c.actor.id, c.out);
        c.actor.lastProtected = c.occupant.id;
        c.out.say(c.actor.id,
          "You are sitting up with " + c.occupant.name + ". Anything that comes for them from now on does not get in. " +
          "You will only find out whether that mattered if it did.", "act");
        return { ok: true };
      }
    },
    hooks: {
      onFindBody: function (c) {
        if (c.body.night !== c.state.round) return null;
        return "You came to sit up with " + c.occupant.name + " and let yourself in. " +
          "There was nothing left to treat — they were dead before you reached the door.";
      }
    }
  });
})(typeof window !== "undefined" ? window : globalThis);

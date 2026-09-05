/* protocol.js — every message that crosses the wire, in one place.
 *
 * The shape is inherited from KaraokeNatin and it is deliberately dumb: guests
 * send commands, the host applies them and answers with a whole snapshot. No
 * patching, no reconciliation. A phone that missed ten messages because it was
 * in a pocket is correct again the instant one snapshot lands, which for a game
 * where a wrong view means a wrong accusation is worth the extra bytes.
 *
 * What is NOT inherited: snapshots here are per-recipient and heavily redacted.
 * A karaoke queue is the same for everybody; a werewolf game is thirty
 * different views of one truth, and the host is the only place the truth lives.
 * See engine/view.js — every field a guest can read is whitelisted there.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});

  /* guest -> host */
  var CMD = {
    HELLO:       "HELLO",        // { name, avatar }
    NAME:        "NAME",         // { name }
    AVATAR:      "AVATAR",       // { avatar }
    RESYNC:      "RESYNC",

    /* room management — host, and where noted co-hosts */
    CONFIG:      "CONFIG",       // { config }            host/co-host
    ROLESET:     "ROLESET",      // { roles: {id: n} }    host/co-host
    KICK:        "KICK",         // { id }                host/co-host
    ROLE_GRANT:  "ROLE_GRANT",   // { id, cohost }        host only
    APPROVE:     "APPROVE",      // { id, ok }            host/co-host
    SEAT:        "SEAT",         // { id, dir }           host/co-host
    START:       "START",        // begin the game        host/co-host
    ABORT:       "ABORT",        // back to lobby         host only
    REMATCH:     "REMATCH",      // { keepPlayers }       host/co-host
    SKIP_PHASE:  "SKIP_PHASE",   // nudge the clock on    host/co-host
    EXTEND:      "EXTEND",       // { seconds }           host/co-host

    /* play */
    KNOCK:       "KNOCK",        // { houseId }           free; returns offers
    ACT:         "ACT",          // { houseId, actionId, payload }
    UNDO:        "UNDO",         // { }   revoke a revocable action (wolf vote)
    READY:       "READY",        // { }   done for this phase
    VOTE:        "VOTE",         // { targetId }  targetId null = skip
    QUIZ_ANSWER: "QUIZ_ANSWER",  // { choice }
    CONSENT:     "CONSENT",      // { offerId, ok }   cult recruitment etc.
    TASK:        "TASK",         // { taskId, payload }  night-work minigame
    CHAT:        "CHAT"          // { text, channel }
  };

  /* host -> guest */
  var MSG = {
    WELCOME:  "WELCOME",    // { clientId, code, version }
    STATE:    "STATE",      // { rev, state }  a view built for this one guest
    NOTICE:   "NOTICE",     // { text, kind }
    PRIVATE:  "PRIVATE",    // { entry }   one line for your eyes only
    OFFERS:   "OFFERS",     // { houseId, offers, discovery }   answer to KNOCK
    PROMPT:   "PROMPT",     // { id, kind, ... }  consent / quiz / role guess
    CHAT:     "CHAT",       // { from, text, channel, at }
    WAIT:     "WAIT",       // you are in the lobby, awaiting approval
    BYE:      "BYE"         // { reason }
  };

  /* Why a body stopped moving. Several passives key off this, so it is a
   * closed set rather than free text. */
  var CAUSE = {
    PACK:        "pack",          // the werewolves' nightly kill
    POISON:      "poison",        // Witch
    GUNSHOT:     "gunshot",       // Pulis
    ASSASSIN:    "assassin",      // Assassin's named guess
    BITE:        "bite",          // Cat/Dog bit something with teeth
    REVENGE:     "revenge",       // Avenger's oath
    RETRIBUTION: "retribution",   // Archangel / Diwata passives
    DISEASE:     "disease",       // Diseased, Pandemic
    GUARD:       "guard",         // died in someone else's place
    LYNCH:       "lynch",         // the village voted
    SUICIDE:     "suicide"        // a wrong guess, mostly
  };

  var CAUSE_TEXT = {
    pack:        "torn apart in the night",
    poison:      "found cold, with no mark on them",
    gunshot:     "shot",
    assassin:    "killed with a blade, precisely",
    bite:        "killed by something with teeth",
    revenge:     "taken down by a dying hand",
    retribution: "struck down by something older than the village",
    disease:     "taken by the sickness",
    guard:       "killed standing in someone else's doorway",
    lynch:       "hanged by the village",
    suicide:     "died by their own mistake"
  };

  WG.protocol = { CMD: CMD, MSG: MSG, CAUSE: CAUSE, CAUSE_TEXT: CAUSE_TEXT };
})(typeof window !== "undefined" ? window : globalThis);

/* state.js — the shape of a room, and every knob the host can turn.
 *
 * One object holds the whole truth. The host owns it; guests never see it, they
 * see a redacted view built by engine/view.js. Keeping the authoritative shape
 * in one place is what lets the view be a whitelist rather than a series of
 * deletions, and a whitelist is the only kind of redaction that stays correct
 * when somebody adds a field.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});

  /* Grouped on purpose. The old settings screen was one long column of
   * checkboxes with no argument for their order; these are the four questions a
   * host actually asks — how long, how harsh, who gets in, and what can go
   * wrong — and the settings UI is generated from exactly this shape. */
  function defaultConfig() {
    return {
      flow: {
        preset: "classic",
        durations: { role_reveal: 30, night: 180, dawn: 25, discussion: 300, voting: 120, verdict: 25 },
        endNightEarly: true,     // close the night once every turn is spent
        endVotingEarly: true     // close the vote once everyone has voted
      },
      rules: {
        /* "Don't believe anyone."
         *
         * Normally the night is secret and the morning is not: a killing is
         * known only to whoever caused it and whoever went round, and then at
         * dawn the village is told who died whether or not anybody reported it.
         * Reporting adds a name to that announcement — who found them — which
         * is a fact worth having and occasionally worth lying about.
         *
         * With this on, dawn names nobody. The village only ever hears about a
         * body somebody went and reported, so an unreported death stays a
         * rumour for the rest of the game and the roster keeps counting a
         * player who is not there. */
        trustNoone: false,
        revealRolesOnDeath: true,
        firstNightImmunity: false,
        showVoteCounts: true,
        showPersonalVotes: true,
        allowSkipVote: true,
        allowSelfVote: false,
        tieBehaviour: "nobody",   // nobody | random | runoff
        villagerPromotion: true,
        animalSpeech: true        // Cats and Dogs really are restricted to noises
      },
      room: {
        joinApproval: true,
        maxPlayers: 24,
        allowSpectators: true,
        chat: true,
        deadChat: true            // the dead get a channel the living cannot read
      },
      events: {
        enabled: true,
        chance: 0.08,
        allowed: ["festival", "pandemic", "blood_moon", "curfew", "long_night"]
      },
      look: {
        timeOfDayTheme: true,     // the room's colour tracks the phase clock
        reduceMotion: false,
        sound: true
      }
    };
  }

  /** Fold a config off the wire onto the defaults, key by key, dropping junk. */
  function sanitizeConfig(raw) {
    var out = defaultConfig();
    if (!raw || typeof raw !== "object") return out;
    Object.keys(out).forEach(function (group) {
      var g = raw[group];
      if (!g || typeof g !== "object") return;
      Object.keys(out[group]).forEach(function (k) {
        var want = typeof out[group][k];
        var got = g[k];
        if (want === "boolean" && typeof got === "boolean") out[group][k] = got;
        else if (want === "number" && typeof got === "number" && isFinite(got)) out[group][k] = got;
        else if (want === "string" && typeof got === "string") out[group][k] = got;
        else if (Array.isArray(out[group][k]) && Array.isArray(got)) {
          out[group][k] = got.filter(function (x) { return typeof x === "string"; });
        } else if (want === "object" && got && typeof got === "object" && !Array.isArray(got)) {
          Object.keys(out[group][k]).forEach(function (kk) {
            if (typeof got[kk] === "number" && isFinite(got[kk])) {
              out[group][k][kk] = Math.max(5, Math.min(3600, Math.round(got[kk])));
            }
          });
        }
      });
    });
    return out;
  }

  function createPlayer(id, name, seat) {
    return {
      id: id,
      name: name || "Player",
      seat: seat,
      avatar: null,
      role: null,
      alive: true,
      connected: true,
      cohost: false,
      spectator: false,
      ready: false,
      totalScore: 0
    };
  }

  function createState(code) {
    return {
      code: code,
      rev: 0,
      version: WG.VERSION || "1.0.0",

      phase: "lobby",
      phaseIndex: 0,
      round: 0,
      phaseStartedAt: 0,
      phaseEndsAt: 0,
      paused: false,

      hostId: "host",
      hostName: "Host",
      players: [],
      pending: [],          // [{ id, name, at }] waiting at the door
      cohosts: {},

      roster: {},           // roleId -> how many copies are in the bag
      config: defaultConfig(),

      night: null,          // built fresh by the resolver each night
      lastNight: null,
      pendingQuizzes: {},

      votes: {},            // voterId -> targetId | "SKIP"
      voteHistory: [],
      leadersAlive: [],
      jesterWasLynched: null,
      currentEvent: null,
      curfew: false,

      chat: { day: [], dead: [], pack: [], cult: [] },
      publicLog: [],        // the morning reports, in order — the game's history
      winner: null,
      startedAt: Date.now()
    };
  }

  WG.state = {
    createState: createState,
    createPlayer: createPlayer,
    defaultConfig: defaultConfig,
    sanitizeConfig: sanitizeConfig
  };
})(typeof window !== "undefined" ? window : globalThis);

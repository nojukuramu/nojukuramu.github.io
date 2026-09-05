/* view.js — thirty different truths, built from one.
 *
 * KaraokeNatin could broadcast one snapshot to the whole room because a queue
 * of songs is the same object for everybody. A werewolf game is not: the whole
 * point is that no two people can see the same board. So the host never sends
 * `state` — it sends a view assembled here, per recipient, per broadcast.
 *
 * This is a whitelist and it has to stay one. Redacting by deleting fields
 * means the day somebody adds `state.night.shields` the Doctor's target leaks
 * to every phone in the room and nothing anywhere errors. Building the view
 * field by field means a new field is invisible until somebody decides who may
 * see it, which is the failure mode you want.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});
  var R = WG.roles;

  function me(state, id) {
    for (var i = 0; i < state.players.length; i++) if (state.players[i].id === id) return state.players[i];
    return null;
  }

  function isManager(state, id) {
    return id === state.hostId || !!state.cohosts[id];
  }

  /**
   * May `viewer` see `subject`'s role right now?
   * Every "yes" here is a designed leak — a team that knows itself, a corpse the
   * village is allowed to read, a Mayor who is public by definition.
   */
  function knowsRole(state, viewer, subject) {
    if (!viewer) return false;
    if (viewer.id === subject.id) return true;
    if (state.winner) return true;                                  // the reveal at the end
    if (viewer.role === "manipulator") return true;
    // A role is revealed with the body, so only once the viewer knows there is one.
    if (!subject.alive && state.config.rules.revealRolesOnDeath &&
        WG.resolver.knowsDead(state, viewer, subject)) return true;
    if (subject.role === "mayor" && R.teamOf(viewer.role) === "village") return true;

    var vt = R.teamOf(viewer.role), st = R.teamOf(subject.role);
    if (vt === "werewolf" && st === "werewolf") return true;
    if (vt === "cult" && st === "cult") return true;
    if (viewer.role === "mason" && subject.role === "mason") return true;
    return false;
  }

  function playerCard(state, viewer, p) {
    /* `alive` here is BELIEF, not truth. Somebody killed an hour ago is still
     * at home as far as this viewer is concerned, and a Shaman-marked death is
     * never announced at all — so for the rest of the game the village goes on
     * counting a player it does not have. Reading `p.alive` straight through
     * leaked both. */
    var believed = !viewer || WG.resolver.believedAlive(state, viewer, p);
    var card = {
      id: p.id,
      name: p.name,
      seat: p.seat,
      avatar: p.avatar,
      alive: believed,
      trulyDead: !p.alive && !believed ? undefined : undefined,
      connected: p.connected,
      cohost: !!state.cohosts[p.id],
      isHost: p.id === state.hostId,
      spectator: !!p.spectator,
      ready: !!p.ready,
      isMe: !!viewer && p.id === viewer.id,
      speech: null,
      role: null,
      diedNight: believed ? null : (p.diedNight || null)
    };
    if (state.config.rules.animalSpeech && (p.role === "cat" || p.role === "dog") && knowsRole(state, viewer, p)) {
      card.speech = p.role === "cat" ? "meow" : "bark";
    }
    if (knowsRole(state, viewer, p)) {
      var d = R.get(p.role);
      if (d) card.role = { id: d.id, name: d.name, icon: d.icon, team: d.team };
    }
    if (p.markedByShaman && viewer && R.isWolf(viewer.role)) card.marked = true;
    return card;
  }

  /**
   * The doors, as this one viewer may see them.
   *
   * A house is drawn from belief and nothing else. Somebody killed ten minutes
   * ago has a lit window and smoke from the chimney like everyone else, because
   * nobody has been round yet — and the moment the map says otherwise, the
   * whole point of a secret night is gone.
   */
  function houseCards(state, viewer) {
    if (!state.night || !viewer) return [];
    return state.players.map(function (p) {
      var h = state.night.houses[p.id];
      var known = WG.resolver.knowsDead(state, viewer, p);
      var found = !!(h && h.body && h.body.foundBy.indexOf(viewer.id) >= 0);
      return {
        id: p.id,
        ownerName: p.name,
        seat: p.seat,
        avatar: p.avatar,
        occupantAlive: !known,
        isOwn: p.id === viewer.id,
        state: !known ? "living" : (p.diedNight === state.round ? "dead-tonight" : "dead"),
        bodyFound: found,
        reported: !!(h && h.reportedBy && known),
        visited: !!(h && h.visits.some(function (v) { return v.byId === viewer.id; }))
      };
    });
  }

  function myBrief(state, p) {
    if (!p) return null;
    var out = R.hook(p.role, "brief", { state: state, R: WG.resolver, self: p });
    return out || null;
  }

  function build(state, viewerId, extra) {
    var p = me(state, viewerId);
    var manager = isManager(state, viewerId);
    var d = p ? R.get(p.role) : null;
    var night = state.night;

    var view = {
      code: state.code,
      rev: state.rev,
      version: state.version,
      phase: state.phase,
      round: state.round,
      phaseStartedAt: state.phaseStartedAt,
      phaseEndsAt: state.phaseEndsAt,
      paused: state.paused,
      serverNow: Date.now(),

      hostName: state.hostName,
      hostId: state.hostId,
      config: state.config,
      roster: state.roster,
      winner: state.winner,
      currentEvent: state.currentEvent ? {
        id: state.currentEvent.id,
        name: state.currentEvent.definition.name,
        icon: state.currentEvent.definition.icon,
        description: state.currentEvent.definition.description
      } : null,

      players: state.players.map(function (x) { return playerCard(state, p, x); }),
      publicLog: state.publicLog.slice(-60),

      me: p ? {
        id: p.id,
        name: p.name,
        alive: p.alive,
        cohost: !!state.cohosts[p.id],
        isHost: p.id === state.hostId,
        spectator: !!p.spectator,
        ready: !!p.ready,
        totalScore: p.totalScore || 0,
        role: d ? {
          id: d.id, name: d.name, icon: d.icon, team: d.team,
          classification: d.classification, tagline: d.tagline,
          description: d.description, lore: d.lore,
          winCondition: d.winCondition, knows: d.knows,
          passives: d.passives, actions: d.actions
        } : null,
        brief: myBrief(state, p),
        charges: chargeSummary(p, d),
        turn: night && night.turns[p.id] ? {
          spent: night.turns[p.id].spent,
          blocked: night.turns[p.id].blocked
        } : null,
        quiz: quizFor(state, p),
        prompt: promptFor(state, p)
      } : null,

      houses: houseCards(state, p),

      night: night ? {
        n: night.n,
        turnsSpent: Object.keys(night.turns).filter(function (id) { return night.turns[id].spent; }).length,
        turnsTotal: Object.keys(night.turns).length,
        /* The pack sees its own arithmetic live. Nobody else knows a vote is
         * even being held. */
        packTally: p && R.isWolf(p.role) ? WG.resolver.packTally(state) : null,
        packVotes: p && R.isWolf(p.role) ? night.packVotes : null,
        deaths: p && !p.alive ? night.deaths.map(function (x) { return x.id; }) : null
      } : null,

      votes: voteView(state, p),
      chat: chatFor(state, p),
      pending: manager ? state.pending : [],
      lobby: false
    };

    if (extra) Object.keys(extra).forEach(function (k) { view[k] = extra[k]; });
    return view;
  }

  function chargeSummary(p, d) {
    if (!d) return {};
    var out = {};
    (d.actions || []).forEach(function (a) {
      out[a.id] = WG.resolver.chargesLeft(p, a);
    });
    return out;
  }

  function quizFor(state, p) {
    var q = state.night && state.night.quizzes[p.id];
    if (!q) return null;
    return { question: q.question, choices: q.choices, attempts: q.attempts };   // never `correct`
  }

  function promptFor(state, p) {
    if (!state.night) return null;
    var ps = state.night.prompts;
    var keys = Object.keys(ps);
    for (var i = 0; i < keys.length; i++) {
      var pr = ps[keys[i]];
      if (pr.to === p.id) {
        return { id: pr.id, kind: pr.kind, question: pr.question, accept: pr.accept, decline: pr.decline };
      }
    }
    return null;
  }

  function voteView(state, viewer) {
    if (state.phase !== "voting" && state.phase !== "verdict") return null;
    var rules = state.config.rules;
    var counts = {};
    Object.keys(state.votes).forEach(function (voterId) {
      var t = state.votes[voterId];
      counts[t] = (counts[t] || 0) + 1;
    });
    var out = {
      mine: viewer ? (state.votes[viewer.id] || null) : null,
      cast: Object.keys(state.votes).length,
      total: state.players.filter(function (p) { return p.alive; }).length,
      counts: rules.showVoteCounts ? counts : null,
      /* Who voted for whom is the loudest information in the game. It is only
       * ever handed out in full when the room asked for it. */
      detail: rules.showVoteCounts ? state.votes : null,
      onMe: null
    };
    if (viewer && rules.showPersonalVotes) {
      out.onMe = Object.keys(state.votes).filter(function (v) { return state.votes[v] === viewer.id; });
    }
    return out;
  }

  function chatFor(state, p) {
    if (!p || !state.config.room.chat) return { day: [] };
    var out = { day: state.chat.day.slice(-80) };
    if (!p.alive && state.config.room.deadChat) out.dead = state.chat.dead.slice(-60);
    if (R.isWolf(p.role)) out.pack = state.chat.pack.slice(-60);
    if (R.isCult(p.role)) out.cult = state.chat.cult.slice(-60);
    return out;
  }

  /** Someone at the door: the shape of a room and nothing that is in it. */
  function lobbyView(state, name) {
    return {
      code: state.code,
      rev: state.rev,
      phase: "lobby",
      round: 0,
      hostName: state.hostName,
      config: state.config,
      players: [],
      houses: [],
      publicLog: [],
      me: { name: name || "Guest" },
      chat: { day: [] },
      pending: [],
      lobby: true
    };
  }

  WG.view = { build: build, lobbyView: lobbyView, knowsRole: knowsRole, isManager: isManager };
})(typeof window !== "undefined" ? window : globalThis);

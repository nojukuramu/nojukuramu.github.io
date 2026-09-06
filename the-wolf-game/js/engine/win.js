/* win.js — who has actually won, checked after anything that could change it.
 *
 * Order matters more than any individual rule here. The Manipulator steals
 * whatever result would otherwise have been declared, so it is checked last and
 * rewrites the answer; the Jester and the Assassin are checked first because
 * their conditions are events rather than counts and can be true on a board
 * that also looks like a village win.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});
  var R = WG.roles;

  function count(state) {
    var c = { village: 0, werewolf: 0, cult: 0, solo: [] };
    state.players.forEach(function (p) {
      // A spectator arrived after the deal and holds no side. teamOf(null)
      // answers "village", so counting them puts every side's arithmetic out.
      if (!p.alive || p.spectator) return;
      var t = R.teamOf(p.role);
      if (t === "solo") c.solo.push(p);
      else c[t]++;
    });
    return c;
  }

  /** Returns { team, message, stolenFrom } or null if the game continues. */
  function check(state) {
    // Every path that can create an Assassin ends up here, so this is the one
    // place that catches all of them.
    armAssassins(state);
    var c = count(state);
    var manipulator = state.players.filter(function (p) { return p.alive && p.role === "manipulator"; })[0];

    function declare(team, message) {
      if (manipulator && team !== "manipulator") {
        return {
          team: "manipulator",
          stolenFrom: team,
          message: "The Manipulator wins. They never lifted a finger, and the " +
            (R.teams[team] ? R.teams[team].name : team) + " did all of it for them."
        };
      }
      return { team: team, message: message };
    }

    // Events, first — they can be true on a board that also reads as a win.
    if (state.jesterWasLynched) {
      return declare("jester", "The Jester wins. They wanted the rope, and the village handed it over.");
    }
    var assassin = state.players.filter(function (p) { return p.alive && p.role === "assassin"; })[0];
    if (assassin && leadersAllDead(state)) {
      return declare("assassin", "The Assassin wins. Every leader in this village is dead, and one person did all of it.");
    }
    if (state.pandemicWon) {
      return { team: "pandemic", message: "The sickness wins. There is nobody left in this village who is not dying of it." };
    }

    // Counts.
    if (c.cult > 0 && c.cult >= c.werewolf + c.village) {
      return declare("cult", "The Cult wins. Nobody was killed and nobody was counting, and now they are the village.");
    }

    /* A solo only holds the game open while it can still get what it wants.
     * The legacy engine let ANY living solo block a village win, which meant a
     * Jester who was never hanged kept a village of two people awake forever:
     * no wolves left to kill anybody, no majority to hang anybody, and a win
     * condition that could not be reached or ruled out. */
    var solosLeft = c.solo.filter(function (p) {
      return p.role !== "manipulator" && canStillWin(state, p, c);
    });

    /* Nobody at all, before anything else. An empty board matches "no wolves
     * and no cult" perfectly well, so the village win used to be announced over
     * a village with nobody standing in it and the branch written for this
     * further down could never be reached. */
    if (c.village === 0 && c.werewolf === 0 && c.cult === 0 && !c.solo.length) {
      return { team: "nobody", message: "Everybody is dead. Nobody wins a village with nobody in it." };
    }

    if (c.werewolf === 0 && c.cult === 0) {
      if (solosLeft.length) return null;      // a solo with a live path takes priority
      return declare("village", "The Village wins. Every wolf is dead and nothing else was hiding in here.");
    }
    if (c.werewolf > 0 && c.werewolf >= c.village && c.cult === 0) {
      if (solosLeft.length) return null;
      return declare("werewolf", "The Werewolves win. There are as many of them as there are of you, and it is still dark.");
    }
    /* Last resort, and it has to exist: a board where nobody alive can kill
     * anybody and no condition can be met is a game that never ends. Rather
     * than let a room sit through that, call it. */
    if (!canAnyoneStillKill(state, c)) {
      return { team: "stalemate", message: "Nothing can happen to anybody any more. The village is still standing, and so is whatever was hiding in it." };
    }
    return null;
  }

  /** Is this solo's win still reachable at all? */
  function canStillWin(state, p, c) {
    if (p.role === "jester") {
      // Needs a lynch, and the village controls lynches. It never blocks a win
      // that is otherwise ready — it just has to get hanged before that happens.
      return false;
    }
    if (p.role === "assassin") {
      return livingLeaders(state).length > 0 && (p.killCharges || 0) > 0;
    }
    return true;
  }

  /** Does anybody alive still have a way to end somebody else? */
  function canAnyoneStillKill(state, c) {
    if (c.werewolf > 0 || c.cult > 0) return true;
    var alive = state.players.filter(function (x) { return x.alive; });
    if (alive.length > 2) return true;      // a majority can still hang someone
    return alive.some(function (p) {
      var d = R.get(p.role);
      return d && (d.actions || []).some(function (a) {
        return a.lethal && WG.resolver.chargesLeft(p, a) !== 0;
      });
    });
  }

  /* Who is wearing a leader's card RIGHT NOW.
   *
   * This used to be a list of ids frozen at deal time, and everything that can
   * move a role went straight through it: a swapped Seer left the list naming
   * somebody who is not a Seer, so killing the real one cleared nothing and the
   * Assassin could never win — or, the same hole from the other side, the
   * Assassin won with a promoted Seer standing in the village. The Assassin's
   * own brief has always derived this correctly; now everybody does.
   */
  function livingLeaders(state) {
    return state.players.filter(function (p) {
      return p.alive && !p.spectator && R.LEADER_ROLES.indexOf(p.role) >= 0;
    }).map(function (p) { return p.id; });
  }

  function leadersAllDead(state) {
    // An empty bag is not a bag of corpses. With no leader ever dealt there is
    // nothing for an Assassin to hunt, and "every leader is dead" used to be
    // true before the first night — which read as a roster with no game in it.
    if (!state.leadersDealt) return false;
    return livingLeaders(state).length === 0;
  }

  /* One knife per leader dealt, handed to anybody holding the card.
   *
   * Handing them out once at setup meant every Assassin created afterwards —
   * copied by a Doppelgänger, swapped in, promoted, raised by an Archangel —
   * had none, forever, and a permanently disabled action. */
  function armAssassins(state) {
    state.players.forEach(function (p) {
      if (p.role !== "assassin") { delete p.assassinArmed; return; }
      if (p.assassinArmed) return;
      p.killCharges = Math.max(1, state.leadersDealt || 0);
      p.assassinArmed = true;
    });
  }

  /** Called at setup: record how big the hunt is, and arm whoever is hunting. */
  function noteLeaders(state) {
    state.leadersDealt = livingLeaders(state).length;
    state.leadersAlive = livingLeaders(state);   // kept for readers; derived now
    state.players.forEach(function (p) { delete p.assassinArmed; });
    armAssassins(state);
    return state.leadersAlive;
  }

  /* ---------------- how small a village can be ----------------
   * There is no fixed minimum. Four was a guess inherited from the legacy
   * app, and it is wrong in both directions: one wolf against two villagers
   * is a real game of three, while two wolves and two villagers is over
   * before anybody sleeps. What actually matters is whether the board is
   * already decided the moment it is dealt.
   *
   * So deal the host's roster onto N seats - padding with villagers exactly
   * as the engine does - and ask the same win check the game itself uses. The
   * first N it has no answer for is the smallest table this mix can be played
   * on, and it moves on its own as the host changes the roster.
   */

  /** The roster dealt onto n seats, as a state the win check can read. */
  function deal(roster, n) {
    var bag = [];
    Object.keys(roster || {}).forEach(function (rid) {
      for (var i = 0; i < roster[rid]; i++) bag.push(rid);
    });
    while (bag.length < n) bag.push("villager");
    bag = bag.slice(0, n);

    var state = { players: [], round: 0 };
    bag.forEach(function (rid, i) {
      var p = { id: "s" + i, name: "s" + i, alive: true, role: rid };
      var init = R.initialState(rid) || {};
      Object.keys(init).forEach(function (k) { p[k] = init[k]; });
      state.players.push(p);
    });
    noteLeaders(state);
    return state;
  }

  /** Smallest playable table for this roster, or 0 if there is no game in it. */
  function minimumSeats(roster, cap) {
    var dealt = 0;
    Object.keys(roster || {}).forEach(function (k) { dealt += roster[k]; });
    var top = cap || 40;
    for (var n = Math.max(2, dealt); n <= top; n++) {
      if (!check(deal(roster, n))) return n;
    }
    return 0;
  }

  WG.win = { check: check, count: count, noteLeaders: noteLeaders, livingLeaders: livingLeaders,
             armAssassins: armAssassins, minimumSeats: minimumSeats };
})(typeof window !== "undefined" ? window : globalThis);

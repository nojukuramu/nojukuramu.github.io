/* resolver.js — what happens, in the order it happens.
 *
 * The legacy game collected every night action into a bag and worked out the
 * consequences at dawn, all at once. That is the right design for one phone
 * passed around a table, where "at the same time" has no meaning.
 *
 * This one is live. Thirty phones are awake at once, and an action takes effect
 * the moment it is committed. A kill kills now. A shield only covers attacks
 * that arrive after it. A revival puts someone back on their feet in time to
 * take their own turn the same night. Which means the night has an order, the
 * order is first come first served, and being late is a real thing that can
 * happen to you:
 *
 *   The Bodyguard picks a house at 00:41. The wolves settled on it at 00:38.
 *   He does not guard anybody. He opens the door and finds a body.
 *
 * That is not a special case anywhere in this file — it falls out of resolving
 * in arrival order and letting the house remember what has already happened to
 * it. Everything else about the night model exists to keep that true:
 *
 *   - Houses, not players, are the unit. You pick a door and are then offered
 *     what your role can do at that door, given who is behind it and what state
 *     they are in. A dead player still has a house you can walk up to.
 *   - Knocking is free and unrecorded. A visit is only a visit once you commit
 *     to something, so scouting the village costs nothing and reveals nothing.
 *   - Finding a body is not an action. It happens to you when you knock.
 *     Reporting it is an action, and it is free, and the killer is perfectly
 *     welcome to report their own work.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});
  var CAUSE = WG.protocol.CAUSE;
  var R = WG.roles;

  function P(state, id) {
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return state.players[i];
    }
    return null;
  }
  function living(state) { return state.players.filter(function (p) { return p.alive; }); }
  function now() { return Date.now(); }

  /* ---------------- night lifecycle ---------------- */

  function beginNight(state) {
    var houses = {};
    var turns = {};
    state.players.forEach(function (p) {
      houses[p.id] = {
        ownerId: p.id,
        shields: [],       // newest last; consumed newest first
        visits: [],        // committed actions only — knocking is not a visit
        trap: null,        // { byId }
        body: null,        // set the moment the occupant dies tonight
        reportedBy: null
      };
      // A dead player's house still stands, and some of them still act.
      var def = R.get(p.role);
      var acts = p.alive || (def && def.actsWhileDead);
      turns[p.id] = { spent: !acts, at: null, blocked: null };
    });

    state.night = {
      n: state.round,
      startedAt: now(),
      houses: houses,
      turns: turns,
      packVotes: {},          // wolfId -> houseId
      packKillDone: false,
      quizzes: state.pendingQuizzes || {},
      prompts: {},            // promptId -> { kind, to, ... } awaiting an answer
      pending: [],            // actions parked until a prompt is answered
      deaths: [],             // [{ id, cause, byId, at, hidden }]
      publicLog: [],
      privateLog: [],
      visitsLastNight: state.night ? snapshotVisits(state.night) : {}
    };
    state.pendingQuizzes = {};

    // A quiz written last night comes due now, before its target may do a thing.
    Object.keys(state.night.quizzes).forEach(function (pid) {
      if (state.night.turns[pid]) state.night.turns[pid].blocked = "quiz";
    });
    return state.night;
  }

  /** Who went where, flattened for the Detective to read tomorrow. */
  function snapshotVisits(night) {
    var out = {};
    Object.keys(night.houses).forEach(function (hid) {
      night.houses[hid].visits.forEach(function (v) {
        (out[v.byId] = out[v.byId] || []).push({ houseId: hid, actionId: v.actionId, at: v.at });
      });
    });
    return out;
  }

  /* ---------------- outcomes ----------------
   * Nothing in here writes to a socket. A handler describes what somebody
   * should be told and the engine decides how it reaches them, which is what
   * lets the same resolver run in a test with no network at all. */

  function bag() {
    var out = [];
    return {
      list: out,
      /** to: player id, or an array of them, or "all" for the morning report. */
      say: function (to, text, kind, data) {
        out.push({ to: to === "all" ? "all" : [].concat(to), text: text, kind: kind || "info", data: data || null, at: now() });
        return out[out.length - 1];
      }
    };
  }

  /* ---------------- knocking ---------------- */

  /**
   * Walk up to a door. Free, unrecorded, and repeatable — but if there is a
   * body behind it you will see it, and seeing it is a thing that happened.
   */
  function knock(state, actorId, houseId) {
    var actor = P(state, actorId);
    var house = state.night && state.night.houses[houseId];
    if (!actor || !house) return { ok: false, reason: "no-such-house" };

    var occupant = P(state, house.ownerId);
    var out = bag();
    var discovery = null;

    if (house.body && canSeeBody(state, actor, house)) {
      var first = house.body.foundBy.indexOf(actorId) < 0;
      if (first) house.body.foundBy.push(actorId);
      discovery = {
        occupant: occupant.name,
        cause: house.body.cause,
        first: first && house.body.foundBy.length === 1,
        text: bodyText(state, actor, occupant, house)
      };
    }

    return {
      ok: true,
      houseId: houseId,
      occupant: occupant.name,
      state: houseStateLabel(state, actor, house, occupant),
      discovery: discovery,
      offers: offersAt(state, actor, house, occupant),
      outcomes: out.list
    };
  }

  /** A hidden death is hidden from the village, not from the pack that hid it. */
  function canSeeBody(state, actor, house) {
    if (!house.body) return false;
    if (!house.body.hidden) return true;
    return R.isWolf(actor.role);
  }

  function houseStateLabel(state, actor, house, occupant) {
    if (!occupant.alive) {
      if (house.body && house.body.night === state.round) return "dead-tonight";
      return "dead";
    }
    if (house.ownerId === actor.id) return "own";
    return "living";
  }

  /**
   * What you find when the door does not open. The words are the role's — a
   * Bodyguard arriving too late and a wolf arriving second should not read the
   * same, because they are not the same mistake.
   */
  function bodyText(state, actor, occupant, house) {
    var custom = R.hook(actor.role, "onFindBody", {
      state: state, actor: actor, occupant: occupant, house: house, body: house.body
    });
    if (custom) return custom;
    var tonight = house.body.night === state.round;
    if (!tonight) return "Empty since they died.";
    return "No answer. They are dead inside, and they were warm not long ago.";
  }

  /* ---------------- offers ---------------- */

  var SELECTORS = {
    "any": function () { return true; },
    "self": function (c) { return c.house.ownerId === c.actor.id; },
    "living-any": function (c) { return c.occupant.alive; },
    "living-others": function (c) { return c.occupant.alive && c.occupant.id !== c.actor.id; },
    "living-not-last": function (c) {
      return c.occupant.alive && c.actor.lastProtected !== c.occupant.id;
    },
    "living-non-wolf": function (c) { return c.occupant.alive && !R.isWolf(c.occupant.role); },
    "living-non-cult": function (c) {
      return c.occupant.alive && !R.isCult(c.occupant.role) && c.occupant.id !== c.actor.id;
    },
    "living-cult": function (c) { return c.occupant.alive && R.isCult(c.occupant.role); },
    "dead-any": function (c) { return !c.occupant.alive; },
    "dead-tonight": function (c) {
      return !c.occupant.alive && c.house.body && c.house.body.night === c.state.round;
    },
    "dead-wolves": function (c) { return !c.occupant.alive && R.isWolf(c.occupant.role); },
    "dead-pets": function (c) {
      return !c.occupant.alive &&
        (c.occupant.role === "cat" || c.occupant.role === "dog") &&
        !c.occupant.hasBeenTreatedByVet;
    }
  };

  function matches(sel, ctx) {
    var fn = SELECTORS[sel];
    return fn ? !!fn(ctx) : false;
  }

  /** Charges left on an action, or null when it is unlimited. */
  function chargesLeft(actor, action) {
    if (action.unlimitedWhen && actor[action.unlimitedWhen]) return null;
    if (!action.chargeKey) return action.charges == null ? null : action.charges;
    var v = actor[action.chargeKey];
    if (typeof v === "boolean") return v ? 0 : (action.charges || 1);
    if (typeof v === "number") {
      // Two conventions live in the data — a field that counts down to nothing
      // (recruitsLeft) and a field that counts up from nothing (infectionsUsed).
      // The action declares which; guessing from the value cost us a Cult
      // Leader who could never recruit.
      if (action.chargeMode === "remaining") return Math.max(0, v);
      if (action.charges == null) return Math.max(0, v);
      return Math.max(0, action.charges - v);
    }
    return action.charges == null ? null : action.charges;
  }

  function offersAt(state, actor, house, occupant) {
    var offers = [];
    var turn = state.night.turns[actor.id] || {};
    var def = R.get(actor.role);
    var ctx = { state: state, actor: actor, house: house, occupant: occupant };

    function consider(action, source) {
      if (!matches(action.houses, ctx)) return;
      if (action.requires === "alive" && !actor.alive) return;
      if (action.requires === "dead" && actor.alive) return;

      var left = chargesLeft(actor, action);
      var reason = null;
      if (action.spendsTurn && turn.spent) reason = "Your night is already spent.";
      else if (action.spendsTurn && turn.blocked) reason = "You are on hold — answer the call first.";
      else if (left === 0) reason = "No charges left.";
      else if (state.curfew && action.spendsTurn && house.ownerId !== actor.id && !R.isWolf(actor.role)) {
        reason = "Curfew. Nobody leaves their own house tonight.";
      }

      offers.push({
        actionId: action.id,
        roleId: source === "universal" ? null : actor.role,
        label: action.label,
        houseVerb: action.houseVerb,
        icon: action.icon,
        description: action.description,
        spendsTurn: !!action.spendsTurn,
        arity: action.arity || 1,
        authoring: action.authoring || null,
        options: action.options || null,
        charges: left,
        enabled: !reason,
        reason: reason
      });
    }

    (def ? def.actions || [] : []).forEach(function (a) { consider(a, "role"); });
    R.universalActions.forEach(function (a) {
      if (a.id === "peek") return;                 // knocking IS peeking
      if (a.id === "report" && house.reportedBy) return;
      if (a.id === "report" && !canSeeBody(state, actor, house)) return;
      consider(a, "universal");
    });

    return offers;
  }

  /* ---------------- performing ---------------- */

  function perform(state, actorId, houseId, actionId, payload) {
    var actor = P(state, actorId);
    var house = state.night && state.night.houses[houseId];
    if (!actor || !house) return { ok: false, reason: "no-such-house" };
    var occupant = P(state, house.ownerId);
    var turn = state.night.turns[actorId];
    if (!turn) return { ok: false, reason: "not-playing" };

    var def = R.get(actor.role);
    var action = (def && def.actionById[actionId]) ||
      findUniversal(actionId);
    if (!action) return { ok: false, reason: "no-such-action" };

    // Re-run the offer test rather than trusting the client's word for it.
    var offer = offersAt(state, actor, house, occupant).filter(function (o) {
      return o.actionId === actionId;
    })[0];
    if (!offer) return { ok: false, reason: "not-offered-here" };
    if (!offer.enabled) return { ok: false, reason: offer.reason };

    var out = bag();
    var ctx = {
      state: state, R: api, roles: R,
      actor: actor, house: house, occupant: occupant,
      action: action, payload: payload || {},
      out: out, P: function (id) { return P(state, id); },
      night: state.night, at: now()
    };

    var fn = R.handler(actor.role, actionId) || R.genericAction(actionId);
    if (!fn) return { ok: false, reason: "unimplemented" };

    var res = fn(ctx) || {};
    if (res.ok === false) return { ok: false, reason: res.reason || "refused", outcomes: out.list };

    // A committed action is a visit, and visits are what the Detective reads
    // and the Engineer's trap catches. Prompts that are still open are not
    // committed yet, so they are not visits either.
    if (!res.pending) {
      recordVisit(state, actor, house, actionId, out);
      var spends = res.spent != null ? res.spent : !!action.spendsTurn;
      if (spends) { turn.spent = true; turn.at = now(); }
    }

    return {
      ok: true,
      spent: !!(state.night.turns[actorId] || {}).spent,
      pending: res.pending || null,
      outcomes: out.list
    };
  }

  function findUniversal(id) {
    var list = R.universalActions;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /** Log the visit, and spring the trap if one is set on this door. */
  function recordVisit(state, actor, house, actionId, out) {
    if (house.ownerId === actor.id && actionId === "task") return;   // staying in is not a visit
    house.visits.push({ byId: actor.id, actionId: actionId, at: now() });
    if (house.trap && house.trap.byId !== actor.id) {
      out.say(house.trap.byId,
        "Trap: " + actor.name + " walked into " + P(state, house.ownerId).name + "'s.", "trap",
        { visitor: actor.id, house: house.ownerId });
    }
  }

  /* ---------------- the primitives roles are built out of ---------------- */

  /**
   * Kill somebody, right now.
   *
   * Everything protective is consumed newest-first, because the last person to
   * arrive is the one standing in the doorway. A shield turns the blow away; a
   * bodyshield takes it in the chest. Both are spent whether or not the target
   * ever learns how close it was.
   */
  function kill(state, targetId, opts) {
    opts = opts || {};
    var out = opts.out || bag();
    var target = P(state, targetId);
    if (!target) return { result: "no-target" };
    if (!target.alive) return { result: "already-dead" };

    var cause = opts.cause || CAUSE.PACK;
    var byId = opts.byId || null;
    var house = state.night ? state.night.houses[targetId] : null;

    // The victim's own passive gets first refusal. Diwata's ward lives here.
    var veto = R.hook(target.role, "onKilled", {
      state: state, R: api, self: target, target: target, cause: cause, byId: byId, out: out
    });
    if (veto && veto.prevent) {
      return { result: veto.result || "warded", byId: byId };
    }

    if (house && !opts.ignoreShields) {
      for (var i = house.shields.length - 1; i >= 0; i--) {
        var s = house.shields[i];
        if (s.kind === "shield") {
          house.shields.splice(i, 1);
          out.say(s.byId, "Something came for " + target.name + " and did not get through. That was you.", "saved");
          out.say(target.id, "You woke for no reason, and went back to sleep. You are alive.", "saved");
          return { result: "saved", byId: s.byId };
        }
        if (s.kind === "bodyshield") {
          house.shields.splice(i, 1);
          var guard = P(state, s.byId);
          out.say(target.id, "Something came for you. Somebody was standing in front of it.", "saved");
          if (guard && guard.alive) {
            kill(state, guard.id, { cause: CAUSE.GUARD, byId: byId, out: out, ignoreShields: true });
          }
          return { result: "intercepted", byId: s.byId };
        }
      }
    }

    return die(state, target, cause, byId, out, opts);
  }

  function die(state, target, cause, byId, out, opts) {
    target.alive = false;
    var at = now();
    var hidden = !!(opts && opts.hidden);

    // The Shaman's mark only silences a death the pack itself caused.
    if (!hidden && target.markedByShaman && cause === CAUSE.PACK) {
      hidden = true;
      var shaman = P(state, target.markedByShaman);
      target.markedByShaman = null;
      if (shaman) out.say(shaman.id, "" + target.name + " died under your mark. Nothing will be announced.", "hidden");
    }

    var record = { id: target.id, cause: cause, byId: byId, at: at, night: state.round, hidden: hidden };
    if (state.night) {
      state.night.deaths.push(record);
      var house = state.night.houses[target.id];
      if (house) {
        house.body = { night: state.round, at: at, cause: cause, byId: byId, hidden: hidden, foundBy: [] };
        // Whoever was guarding this house is guarding a corpse. Release them so
        // a later attack does not kill a bodyguard for nothing.
        house.shields = house.shields.filter(function (s) { return s.kind !== "bodyshield"; });
      }
    }
    target.diedAt = at;
    target.diedNight = state.round;
    target.diedCause = cause;

    out.say(target.id, "You are dead. You can watch. The village cannot hear you.", "death");

    // Consequences. Order matters: the victim's own last act, then everyone
    // else's reaction to it, then bookkeeping the game itself cares about.
    R.hook(target.role, "onDeath", { state: state, R: api, self: target, cause: cause, byId: byId, out: out });
    R.broadcastHook(state, "onSomeoneDied", {
      state: state, R: api, victim: target, cause: cause, byId: byId, out: out
    });
    noteLeaderDeath(state, target);
    if (cause !== CAUSE.LYNCH) releaseTurn(state, target.id, true);

    return { result: "dead", id: target.id, cause: cause, hidden: hidden };
  }

  /**
   * Put somebody back on their feet, right now.
   *
   * The important word is "now". A revived player is not a spectator who gets
   * to play again tomorrow — they get their turn back for the night they are
   * standing in, which is the whole reason a Vet or an Albularyo is worth a
   * seat. Their body stops being findable and their door stops being a crime
   * scene, so anybody who walks up to it after this sees a house with someone
   * living in it and nothing to report.
   */
  function revive(state, targetId, opts) {
    opts = opts || {};
    var out = opts.out || bag();
    var target = P(state, targetId);
    if (!target) return { result: "no-target" };
    if (target.alive) return { result: "already-alive" };

    target.alive = true;
    delete target.diedAt;
    delete target.diedNight;
    delete target.diedCause;

    if (opts.newRole && opts.newRole !== target.role) {
      var fresh = R.initialState(opts.newRole);
      Object.keys(fresh).forEach(function (k) { target[k] = fresh[k]; });
      target.role = opts.newRole;
    }

    if (state.night) {
      var house = state.night.houses[targetId];
      if (house) { house.body = null; house.reportedBy = null; }
      state.night.deaths = state.night.deaths.filter(function (d) { return d.id !== targetId; });
      releaseTurn(state, targetId, false);
    }

    out.say(target.id, "Breathing again, and the night is not over.", "revive");
    return { result: "alive", id: targetId, role: target.role };
  }

  /** Mark a turn spent (on death) or handed back (on revival). */
  function releaseTurn(state, playerId, spent) {
    if (!state.night || !state.night.turns[playerId]) return;
    var def = R.get((P(state, playerId) || {}).role);
    if (spent && def && def.actsWhileDead) return;   // the Ghost keeps working
    state.night.turns[playerId].spent = spent;
  }

  function shield(state, houseId, kind, byId, out) {
    var house = state.night && state.night.houses[houseId];
    if (!house) return false;
    house.shields.push({ kind: kind, byId: byId, at: now() });
    return true;
  }

  function noteLeaderDeath(state, target) {
    if (R.LEADER_ROLES.indexOf(target.role) < 0) return;
    state.leadersAlive = (state.leadersAlive || []).filter(function (id) { return id !== target.id; });
  }

  /* ---------------- the pack ----------------
   *
   * The one action that cannot resolve the instant it is taken, because it is
   * not one player's decision. It resolves the instant it stops being open:
   * when every living wolf has howled. That keeps it inside the night's real
   * ordering rather than deferring it to dawn — which matters enormously, since
   * a pack that agrees early kills early, and everything the village does after
   * that is too late.
   */
  function packVote(state, wolfId, houseId, out) {
    state.night.packVotes[wolfId] = houseId;
    var wolves = living(state).filter(function (p) { return R.isWolf(p.role); });
    var names = wolves.map(function (w) { return w.id; });
    wolves.forEach(function (w) {
      out.say(w.id, P(state, wolfId).name + " howls for " + P(state, houseId).name + ".", "pack", packTally(state));
    });
    var allIn = names.every(function (id) { return state.night.packVotes[id]; });
    if (allIn) resolvePack(state, out);
    return { allIn: allIn };
  }

  function packTally(state) {
    var tally = {};
    living(state).forEach(function (w) {
      if (!R.isWolf(w.role)) return;
      var v = state.night.packVotes[w.id];
      if (!v) return;
      var def = R.get(w.role);
      var weight = 1;
      (def.actions || []).forEach(function (a) { if (a.id === "wolf_vote" && a.weight) weight = a.weight; });
      tally[v] = (tally[v] || 0) + weight;
    });
    return tally;
  }

  /** Settle the pack's kill. Called when the last wolf votes, or at dawn. */
  function resolvePack(state, out, opts) {
    if (!state.night || state.night.packKillDone) return null;
    var tally = packTally(state);
    var best = null, high = 0, tied = [];
    Object.keys(tally).forEach(function (hid) {
      if (tally[hid] > high) { high = tally[hid]; best = hid; tied = [hid]; }
      else if (tally[hid] === high) tied.push(hid);
    });
    if (!best) return null;
    if (tied.length > 1) best = tied[Math.floor(Math.random() * tied.length)];

    state.night.packKillDone = true;
    var howlers = Object.keys(state.night.packVotes).filter(function (w) {
      return state.night.packVotes[w] === best;
    });
    state.night.packHowlers = howlers;

    var count = (opts && opts.extraKills ? opts.extraKills : 0) + 1;
    var results = [];
    results.push(kill(state, best, { cause: CAUSE.PACK, byId: howlers[0] || null, out: out }));

    // Blood Moon and friends: a second throat, chosen from whoever is left.
    for (var i = 1; i < count; i++) {
      var pool = living(state).filter(function (p) { return !R.isWolf(p.role); });
      if (!pool.length) break;
      var victim = pool[Math.floor(Math.random() * pool.length)];
      results.push(kill(state, victim.id, { cause: CAUSE.PACK, byId: howlers[0] || null, out: out }));
    }

    living(state).forEach(function (p) {
      if (R.isWolf(p.role)) {
        out.say(p.id, "The pack settled on " + P(state, best).name + ".", "pack");
      }
    });
    return results;
  }

  /* ---------------- closing the night ---------------- */

  function endNight(state, opts) {
    var out = bag();
    if (!state.night) return { outcomes: out.list };

    // Wolves who never got round to voting have run out of night.
    resolvePack(state, out, opts);

    // Delayed conversions: the Alpha's bite, and the Cult's slow burn.
    state.players.forEach(function (p) {
      if (p.infectedOn != null && p.alive && state.round - p.infectedOn >= 2 && !R.isWolf(p.role)) {
        p.infectedOn = null;
        var was = p.role;
        p.role = "werewolf";
        Object.assign(p, R.initialState("werewolf"));
        out.say(p.id, "The bite took. You are a Werewolf now, and you were a " + R.get(was).name + ".", "transform");
      }
      if (p.role === "cultist" && p.alive) {
        p.nightsAsCultist = (p.nightsAsCultist || 0) + 1;
        if (p.nightsAsCultist >= 2) {
          p.role = "fanatic";
          Object.assign(p, R.initialState("fanatic"));
          out.say(p.id, "Long enough in. You are a Fanatic now.", "transform");
        }
      }
    });

    // Traps and quizzes are one-night things.
    Object.keys(state.night.houses).forEach(function (hid) { state.night.houses[hid].trap = null; });

    state.lastNight = {
      n: state.round,
      deaths: state.night.deaths.slice(),
      visits: snapshotVisits(state.night),
      reports: reportsFrom(state)
    };
    return { outcomes: out.list, deaths: state.night.deaths.slice() };
  }

  function reportsFrom(state) {
    var out = [];
    Object.keys(state.night.houses).forEach(function (hid) {
      var h = state.night.houses[hid];
      if (h.reportedBy) out.push({ houseId: hid, byId: h.reportedBy });
    });
    return out;
  }

  function allTurnsSpent(state) {
    if (!state.night) return false;
    return Object.keys(state.night.turns).every(function (id) {
      return state.night.turns[id].spent;
    });
  }

  var api = {
    beginNight: beginNight,
    endNight: endNight,
    knock: knock,
    perform: perform,
    offersAt: offersAt,
    kill: kill,
    revive: revive,
    shield: shield,
    packVote: packVote,
    packTally: packTally,
    resolvePack: resolvePack,
    allTurnsSpent: allTurnsSpent,
    chargesLeft: chargesLeft,
    canSeeBody: canSeeBody,
    snapshotVisits: snapshotVisits,
    bag: bag,
    P: P,
    living: living
  };
  WG.resolver = api;
})(typeof window !== "undefined" ? window : globalThis);

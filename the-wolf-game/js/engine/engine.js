/* engine.js — the thing that runs the game.
 *
 * Everything above this file is a piece: the resolver knows what a kill is, the
 * clock knows what a phase is, the roles know what they do. This is what walks
 * the round, decides who is allowed to ask for what, and turns the resolver's
 * outcomes into messages addressed to actual phones.
 *
 * Two rules it enforces that nothing else can:
 *
 *   Nothing addressed to "all" leaves the building during the night. A wolf
 *   dying to a Diseased villager at 00:12 is public information — at dawn. It
 *   is queued and released with the morning report, so the night stays a night
 *   rather than a live feed of everyone else's mistakes.
 *
 *   Every command is re-checked here against the state, never trusted. A guest
 *   telling us it is the Seer's turn is a guest telling us something.
 */
(function (global) {
  "use strict";
  var WG = (global.WG = global.WG || {});
  var CMD = WG.protocol.CMD, MSG = WG.protocol.MSG, CAUSE = WG.protocol.CAUSE;
  var R = WG.roles, Res = WG.resolver, Clock = WG.clock, Win = WG.win, Events = WG.events;

  function create(state, io) {
    // io: { toPlayer(id,msg), toAll(msg), changed(), ended(result) }
    var eng = {};
    var queuedPublic = [];

    function P(id) { return Res.P(state, id); }
    function living() { return Res.living(state); }
    function manager(id) { return WG.view.isManager(state, id); }

    /* ---------------- outcome delivery ---------------- */

    function deliver(outcomes) {
      (outcomes || []).forEach(function (o) {
        if (o.to === "all") {
          if (state.phase === "night") queuedPublic.push(o);
          else publish(o.text, o.kind);
          return;
        }
        o.to.forEach(function (id) {
          io.toPlayer(id, { type: MSG.PRIVATE, entry: { text: o.text, kind: o.kind, data: o.data, at: o.at } });
        });
      });
    }

    function publish(text, kind) {
      var entry = { text: text, kind: kind || "info", round: state.round, at: Date.now() };
      state.publicLog.push(entry);
      if (state.publicLog.length > 300) state.publicLog.shift();
      return entry;
    }

    function notice(id, text, kind) {
      io.toPlayer(id, { type: MSG.NOTICE, text: text, kind: kind || "info" });
    }

    /* ---------------- setup ---------------- */

    /** Deal the roster out. Roles that arrive in pairs are dealt as pairs. */
    function assignRoles() {
      var bag = [];
      Object.keys(state.roster).forEach(function (rid) {
        for (var i = 0; i < state.roster[rid]; i++) bag.push(rid);
      });
      var seats = state.players.filter(function (p) { return !p.spectator; });
      while (bag.length < seats.length) bag.push("villager");
      bag = shuffle(bag).slice(0, seats.length);

      shuffle(seats).forEach(function (p, i) {
        p.role = bag[i];
        p.alive = true;
        Object.assign(p, R.initialState(bag[i]));
        p.totalScore = 0;
      });
      Win.noteLeaders(state);
      return seats;
    }

    function shuffle(a) {
      var out = a.slice();
      for (var i = out.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = out[i]; out[i] = out[j]; out[j] = t;
      }
      return out;
    }

    function startGame() {
      var seats = state.players.filter(function (p) { return !p.spectator; });
      if (seats.length < 4) return { ok: false, reason: "You need at least four people." };
      var total = Object.keys(state.roster).reduce(function (n, k) { return n + state.roster[k]; }, 0);
      if (total > seats.length) return { ok: false, reason: "More roles than players." };

      state.round = 0;
      state.winner = null;
      state.publicLog = [];
      state.jesterWasLynched = null;
      state.pandemic = null;
      state.pandemicWon = false;
      state.currentEvent = null;
      assignRoles();
      publish(seats.length + " houses. Not all of them are what they look like.", "start");
      enter("role_reveal");
      return { ok: true };
    }

    /* ---------------- the round ---------------- */

    function enter(phaseId) {
      if (phaseId === "night") {
        state.round++;
        Events.maybeTrigger(state);
        Res.beginNight(state);
        state.players.forEach(function (p) { p.ready = false; });
        if (state.currentEvent) {
          publish(state.currentEvent.definition.icon + " " + state.currentEvent.definition.name +
            ". " + state.currentEvent.definition.description, "event");
        }
      }
      if (phaseId === "voting") {
        state.votes = {};
        state.players.forEach(function (p) { p.ready = false; });
      }
      Clock.enter(state, phaseId);
      io.changed();
    }

    /** Close the current phase and open whatever the flow says comes next. */
    function advance() {
      var from = state.phase;
      if (from === "night") closeNight();
      else if (from === "voting") closeVoting();
      else if (from === "role_reveal" || from === "dawn" || from === "verdict" || from === "discussion") { /* nothing to settle */ }

      if (state.winner) return;
      var nextId = Clock.next(state);
      if (!nextId) return;
      enter(nextId);
    }

    function closeNight() {
      var out = Res.bag();
      Res.resolvePack(state, out, { extraKills: Events.extraKills(state) });
      var res = Res.endNight(state, { extraKills: Events.extraKills(state) });
      deliver(out.list);
      deliver(res.outcomes);
      Events.tick(state, out);
      deliver(out.list);

      // Promotions and anything else that waits for the phase to be over.
      var phaseOut = Res.bag();
      R.broadcastHook(state, "onPhaseEnd", { state: state, R: Res, out: phaseOut, phase: "night" });
      deliver(phaseOut.list);

      buildMorningReport();
      checkWin();
    }

    /**
     * The morning report. Deaths first, then who found them, then everything
     * that was queued up during the night. Hidden deaths are not in here — a
     * Shaman-marked victim simply stops being mentioned, and the village has to
     * notice the empty chair on its own.
     */
    function buildMorningReport() {
      var night = state.lastNight || { deaths: [], reports: [] };
      var shown = night.deaths.filter(function (d) { return !d.hidden; });

      if (!shown.length) {
        publish("Everybody who went to bed got up again.", "morning");
      } else {
        shown.forEach(function (d) {
          var p = P(d.id);
          if (!p) return;
          var role = state.config.rules.revealRolesOnDeath
            ? " They were a " + R.get(p.role).name + "." : "";
          publish("" + p.name + " is dead — " + (WG.protocol.CAUSE_TEXT[d.cause] || "dead") + "." + role, "death");
        });
      }
      night.reports.forEach(function (r) {
        var finder = P(r.byId), victim = P(r.houseId);
        if (!finder || !victim) return;
        publish("" + finder.name + " found " + victim.name + " and raised the alarm.", "report");
      });

      queuedPublic.forEach(function (o) { publish(o.text, o.kind); });
      queuedPublic = [];
    }

    /* ---------------- voting ---------------- */

    function closeVoting() {
      var counts = {};
      Object.keys(state.votes).forEach(function (v) {
        var t = state.votes[v];
        counts[t] = (counts[t] || 0) + 1;
      });
      var aliveCount = living().length;
      var majority = Math.floor(aliveCount / 2) + 1;

      state.voteHistory.push({ round: state.round, votes: Object.assign({}, state.votes) });

      if ((counts.SKIP || 0) >= majority) {
        publish("The village hanged nobody. " + counts.SKIP + " of " + aliveCount + ".", "vote");
        return;
      }
      delete counts.SKIP;

      var top = null, high = 0, tied = [];
      Object.keys(counts).forEach(function (id) {
        if (counts[id] > high) { high = counts[id]; top = id; tied = [id]; }
        else if (counts[id] === high) tied.push(id);
      });

      if (!top) { publish("Nobody voted. Nobody hangs.", "vote"); return; }
      if (tied.length > 1) {
        if (state.config.rules.tieBehaviour === "random") {
          top = tied[Math.floor(Math.random() * tied.length)];
          publish("A tie, broken by the drawing of a straw.", "vote");
        } else {
          publish("Tied " + tied.length + " ways. Nobody hangs.", "vote");
          return;
        }
      }

      lynch(P(top), high, aliveCount);
    }

    function lynch(target, votes, aliveCount) {
      if (!target) return;
      var out = Res.bag();

      // Some roles do not die of a rope. They get first refusal before it.
      var veto = R.hook(target.role, "onLynch", { state: state, R: Res, self: target, out: out, votes: votes });
      deliver(out.list);
      if (veto && veto.prevent) {
        publish("" + (veto.message || (target.name + " was voted out and walked away from it.")), "vote");
        checkWin();
        return;
      }

      var out2 = Res.bag();
      Res.kill(state, target.id, { cause: CAUSE.LYNCH, byId: null, out: out2, ignoreShields: true });
      deliver(out2.list);
      // The rope is public, so anything it caused is public now, not at dawn.
      queuedPublic.forEach(function (o) { publish(o.text, o.kind); });
      queuedPublic = [];

      var role = state.config.rules.revealRolesOnDeath
        ? " They were a " + R.get(target.role).name + "." : "";
      publish("" + target.name + " was hanged, " + votes + " votes to " +
        Math.max(0, aliveCount - votes) + "." + role, "vote");

      var phaseOut = Res.bag();
      R.broadcastHook(state, "onPhaseEnd", { state: state, R: Res, out: phaseOut, phase: "voting" });
      deliver(phaseOut.list);
      checkWin();
    }

    function checkWin() {
      var res = Win.check(state);
      if (!res) return false;
      state.winner = res;
      publish("" + res.message, "end");
      Clock.enter(state, "game_over");
      io.ended(res);
      io.changed();
      return true;
    }

    /* ---------------- the clock ---------------- */

    /** Called a few times a second by the host. Cheap when nothing is due. */
    function tick() {
      if (state.winner || state.paused) return;
      var cfg = state.config.flow;

      if (state.phase === "night" && cfg.endNightEarly && Res.allTurnsSpent(state)) { advance(); return; }
      if (state.phase === "voting" && cfg.endVotingEarly &&
          Object.keys(state.votes).length >= living().length) { advance(); return; }
      if ((state.phase === "role_reveal" || state.phase === "dawn" || state.phase === "verdict") &&
          allReady()) { advance(); return; }
      if (Clock.expired(state)) advance();
    }

    function allReady() {
      var seats = state.players.filter(function (p) { return !p.spectator && p.connected; });
      return seats.length > 0 && seats.every(function (p) { return p.ready; });
    }

    /* ---------------- commands ---------------- */

    /**
     * Every guest command lands here. `fromId` is the link it arrived on, which
     * is the only identity claim worth anything — a payload saying "I am the
     * host" is a payload.
     */
    function handle(cmd, fromId) {
      var p = P(fromId);
      var isMgr = manager(fromId);

      switch (cmd.type) {
        /* ---- room management ---- */
        case CMD.CONFIG:
          if (!isMgr) return refuse(fromId, "Only the host and co-hosts can change the settings.");
          state.config = WG.state.sanitizeConfig(cmd.config);
          return done();

        case CMD.ROLESET:
          if (!isMgr) return refuse(fromId, "Only the host and co-hosts can set the roles.");
          if (state.phase !== "lobby") return refuse(fromId, "The bag is already dealt.");
          state.roster = {};
          Object.keys(cmd.roles || {}).forEach(function (rid) {
            var n = Math.max(0, Math.min(24, Math.round(Number(cmd.roles[rid]) || 0)));
            if (n && R.get(rid)) state.roster[rid] = n;
          });
          return done();

        case CMD.ROLE_GRANT:
          // A co-host who could appoint co-hosts is a room with no owner.
          if (fromId !== state.hostId) return refuse(fromId, "Only the host can do that.");
          if (cmd.cohost) state.cohosts[cmd.id] = true; else delete state.cohosts[cmd.id];
          var g = P(cmd.id);
          if (g) {
            g.cohost = !!cmd.cohost;
            publish("" + g.name + (cmd.cohost ? " is a co-host now." : " is no longer a co-host."), "room");
          }
          return done();

        case CMD.SEAT:
          if (!isMgr || state.phase !== "lobby") return refuse(fromId, "Not now.");
          return done(moveSeat(cmd.id, cmd.dir));

        case CMD.START:
          if (!isMgr) return refuse(fromId, "Only the host and co-hosts can start.");
          if (state.phase !== "lobby") return refuse(fromId, "Already running.");
          var s = startGame();
          if (!s.ok) return refuse(fromId, s.reason);
          return done();

        case CMD.ABORT:
          if (fromId !== state.hostId) return refuse(fromId, "Only the host can end the game.");
          state.winner = null; state.round = 0; state.night = null;
          state.players.forEach(function (x) { x.alive = true; x.role = null; x.ready = false; });
          Clock.enter(state, "lobby");
          publish("The host stopped the game.", "room");
          return done();

        case CMD.SKIP_PHASE:
          if (!isMgr) return refuse(fromId, "Only the host and co-hosts can move it along.");
          advance();
          return done();

        case CMD.EXTEND:
          if (!isMgr) return refuse(fromId, "Only the host and co-hosts can add time.");
          var add = Math.max(-300, Math.min(600, Math.round(Number(cmd.seconds) || 0))) * 1000;
          if (state.phaseEndsAt) state.phaseEndsAt = Math.max(Date.now() + 3000, state.phaseEndsAt + add);
          return done();

        /* ---- play ---- */
        case CMD.KNOCK: {
          if (!p || state.phase !== "night") return refuse(fromId, "There is nothing to knock on right now.");
          var res = Res.knock(state, fromId, cmd.houseId);
          if (!res.ok) return refuse(fromId, "No such house.");
          io.toPlayer(fromId, {
            type: MSG.OFFERS, houseId: res.houseId, occupant: res.occupant,
            state: res.state, discovery: res.discovery, offers: res.offers
          });
          // Discovering a body changes the door for everybody who looks after.
          return res.discovery ? done() : { ok: true, quiet: true };
        }

        case CMD.ACT: {
          if (!p || state.phase !== "night") return refuse(fromId, "Not during the day.");
          var turn = state.night.turns[fromId];
          if (turn && turn.blocked === "quiz") return refuse(fromId, "Answer the call first.");

          var houseId = cmd.houseId;
          // Festival: what you aimed at is not what you hit.
          if (state.currentEvent && state.currentEvent.id === "festival") {
            var pool = state.players.filter(function (x) { return x.alive; }).map(function (x) { return x.id; });
            houseId = Events.redirect(state, fromId, houseId, pool);
          }

          var r = Res.perform(state, fromId, houseId, cmd.actionId, cmd.payload);
          deliver(r.outcomes);
          if (!r.ok) return refuse(fromId, r.reason || "You cannot do that here.");
          checkWin();
          return done();
        }

        case CMD.READY:
          if (!p) return { ok: false };
          p.ready = true;
          return done();

        case CMD.VOTE: {
          if (!p || !p.alive || state.phase !== "voting") return refuse(fromId, "You have no vote right now.");
          var target = cmd.targetId;
          if (target === "SKIP" && !state.config.rules.allowSkipVote) return refuse(fromId, "Skipping is off in this room.");
          if (target === fromId && !state.config.rules.allowSelfVote) return refuse(fromId, "You cannot vote for yourself.");
          if (target !== "SKIP") {
            var t = P(target);
            if (!t || !t.alive) return refuse(fromId, "They are not standing there.");
          }
          if (state.currentEvent && state.currentEvent.id === "festival") {
            var alive = living().map(function (x) { return x.id; });
            target = Events.redirect(state, fromId, target, alive);
          }
          state.votes[fromId] = target;
          return done();
        }

        case CMD.QUIZ_ANSWER: {
          var q = state.night && state.night.quizzes[fromId];
          if (!q) return { ok: false };
          q.attempts++;
          if (Number(cmd.choice) === q.correct) {
            delete state.night.quizzes[fromId];
            if (state.night.turns[fromId]) state.night.turns[fromId].blocked = null;
            notice(fromId, "Thank you for holding. You may go about your night.", "ok");
            io.toPlayer(q.byId, { type: MSG.PRIVATE, entry: { text: "Your mark answered correctly on attempt " + q.attempts + ".", kind: "info" } });
          } else {
            notice(fromId, "That is not the answer. Please try again.", "warn");
          }
          return done();
        }

        case CMD.CONSENT: {
          var pr = state.night && state.night.prompts[cmd.offerId];
          if (!pr || pr.to !== fromId) return { ok: false };
          delete state.night.prompts[cmd.offerId];
          var out = Res.bag();
          var from = P(pr.from);
          if (from) {
            R.hook(from.role, "onConsent", {
              state: state, R: Res, self: from, target: p, ok: !!cmd.ok, out: out
            });
          }
          deliver(out.list);
          checkWin();
          return done();
        }

        case CMD.CHAT:
          return done(chat(p, cmd));

        case CMD.NAME:
          if (p) { p.name = String(cmd.name || "Player").slice(0, 20); }
          return done();

        case CMD.AVATAR:
          if (p && typeof cmd.avatar === "string" && cmd.avatar.length < 40000) p.avatar = cmd.avatar;
          return done();

        default:
          return { ok: false };
      }
    }

    /* Cats and Dogs really cannot talk. The restriction is applied on the host,
     * to the text, before it is stored — a client that "forgets" is not a way
     * around it. */
    function chat(p, cmd) {
      if (!p || !state.config.room.chat) return false;
      var channel = cmd.channel || "day";
      var text = String(cmd.text || "").slice(0, 300).trim();
      if (!text) return false;

      if (channel === "day") {
        if (!p.alive) channel = "dead";
        else if (state.phase === "night") return false;      // the village is asleep
      }
      if (channel === "pack" && !R.isWolf(p.role)) return false;
      if (channel === "cult" && !R.isCult(p.role)) return false;
      if (channel === "dead" && p.alive) return false;
      if (!state.chat[channel]) return false;

      if (channel === "day" && state.config.rules.animalSpeech) {
        var noise = p.role === "cat" ? "meow" : p.role === "dog" ? "bark" : null;
        if (noise) text = animalise(text, noise);
      }

      state.chat[channel].push({ id: p.id, name: p.name, text: text, at: Date.now(), channel: channel });
      if (state.chat[channel].length > 200) state.chat[channel].shift();
      return true;
    }

    /* Length and punctuation survive; the words do not. A Cat can still be
     * emphatic, and still cannot tell you which house. */
    function animalise(text, noise) {
      var words = text.split(/\s+/).length;
      var out = [];
      for (var i = 0; i < Math.min(words, 12); i++) out.push(noise);
      var tail = /[!?]+$/.exec(text);
      return out.join(" ") + (tail ? tail[0] : "");
    }

    function moveSeat(id, dir) {
      var i = state.players.findIndex(function (x) { return x.id === id; });
      if (i < 0) return false;
      var j = dir === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= state.players.length) return false;
      var t = state.players[i]; state.players[i] = state.players[j]; state.players[j] = t;
      state.players.forEach(function (x, n) { x.seat = n; });
      return true;
    }

    function refuse(id, reason) { notice(id, reason, "warn"); return { ok: false, reason: reason }; }
    function done(changed) { if (changed !== false) io.changed(); return { ok: true }; }

    eng.handle = handle;
    eng.tick = tick;
    eng.advance = advance;
    eng.enter = enter;
    eng.startGame = startGame;
    eng.assignRoles = assignRoles;
    eng.publish = publish;
    eng.deliver = deliver;
    eng.checkWin = checkWin;
    eng.state = state;
    return eng;
  }

  WG.engine = { create: create };
})(typeof window !== "undefined" ? window : globalThis);

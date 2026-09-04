/* room.js — the room's shared state, and the rules for changing it.
 *
 * The host owns the only authoritative copy. Guests hold a read-only mirror
 * refreshed by whole-state snapshots; every guest action is a command sent to
 * the host, applied here, and reflected back. That is deliberately dumber than
 * patching: a snapshot after every change means a guest that missed messages
 * (backgrounded tab, tunnel, reconnect) is correct again the moment one lands.
 *
 * State is small — a queue of song stubs — so snapshots stay a few KB.
 */
(function (global) {
  "use strict";

  var KN = (global.KN = global.KN || {});

  /* ---------------- protocol ---------------- */

  // guest -> host
  var CMD = {
    HELLO: "HELLO",           // { name }
    NAME: "NAME",             // { name }
    ADD: "ADD",               // { video }
    REMOVE: "REMOVE",         // { sid }
    MOVE: "MOVE",             // { sid, dir: up|down|top|bottom }
    PLAY_NOW: "PLAY_NOW",     // { sid }
    PLAY: "PLAY",
    PAUSE: "PAUSE",
    SKIP: "SKIP",
    RESTART: "RESTART",
    SEEK: "SEEK",             // { t }
    VOLUME: "VOLUME",         // { v }
    MUTE: "MUTE",             // { on }
    CLEAR: "CLEAR",
    CONFIG: "CONFIG",         // { config }   host/co-host only
    KICK: "KICK",             // { id }       host/co-host only
    ROLE: "ROLE",             // { id, cohost } host only
    APPROVE: "APPROVE",       // { id, ok }   host/co-host only
    GAME_ADD: "GAME_ADD",     // { video }    a song into the roulette pot
    GAME_REMOVE: "GAME_REMOVE", // { rid }
    GAME_CONFIG: "GAME_CONFIG", // { includeHost } host/co-host only
    GAME_QUEUE: "GAME_QUEUE", // queue a roulette round   host/co-host only
    GAME_AGAIN: "GAME_AGAIN", // spin again, inside the offer window
    RESYNC: "RESYNC"
  };

  // host -> guest
  var MSG = {
    WELCOME: "WELCOME",       // { clientId, code }
    STATE: "STATE",           // { rev, state }
    NOTICE: "NOTICE",         // { text, kind }
    WAIT: "WAIT",             // { }          you are in the lobby, awaiting approval
    BYE: "BYE"                // { reason }
  };

  var QUEUE_LIMIT = 200;
  var SCORE_LIMIT = 60;

  /* Every knob the host can turn, and what it means with nobody having touched
   * it. Scoring and the leaderboard are on by default because a karaoke night
   * without a score is just a playlist. */
  function defaultConfig() {
    return {
      scoring: true,        // score a song when it finishes
      leaderboard: true,    // keep a session-long table of those scores
      maxRun: false,        // cap each singer at two songs back to back
      /* On by default, and the one default here that is not about taste. A
       * room code is six characters against a public broker: guessable given
       * enough tries. Approval is what turns "anyone who guesses the code is
       * in" into "anyone who guesses the code is in a lobby". */
      joinApproval: true,
      sounds: true          // the ticks, the drumroll, the chime
    };
  }

  var MAX_RUN = 2;

  /** Fold a partial config from the wire onto the defaults, dropping junk. */
  function sanitizeConfig(raw) {
    var c = defaultConfig();
    if (!raw || typeof raw !== "object") return c;
    Object.keys(c).forEach(function (k) {
      if (typeof raw[k] === "boolean") c[k] = raw[k];
    });
    return c;
  }

  /* ---------------- state ---------------- */

  function createState(code) {
    return {
      code: code,
      rev: 0,
      now: null,               // song currently loaded, or null
      queue: [],
      guests: [],              // [{ id, name, cohost }]
      cohosts: {},             // guest id -> true; a co-host can do host things
      hostName: "Host",
      player: { status: "idle", time: 0, duration: 0, volume: 80, muted: false },
      config: defaultConfig(),
      scores: [],              // [{ name, score, title, at }] newest first
      lastScore: null,         // the one being celebrated on the stage, or null
      /* Waiting at the door: connected, named, and allowed to do nothing else
       * until the host says so. Only present while `config.joinApproval` is
       * on, and empty the rest of the time. */
      pending: [],             // [{ id, name, at }]
      roulette: KN.games ? KN.games.createRoulette() : null,
      spin: null,              // the wheel, mid-turn — broadcast so every phone sees it
      spinOffer: null,         // { at, ms } the window to spin again
      startedAt: Date.now()
    };
  }

  var seq = 0;
  function toSong(video, addedBy, addedById) {
    seq++;
    return {
      sid: "s" + Date.now().toString(36) + seq.toString(36),
      id: video.id,
      title: video.title || "YouTube video",
      author: video.author || "",
      duration: video.duration || 0,
      thumb: video.thumb || "https://i.ytimg.com/vi/" + video.id + "/mqdefault.jpg",
      addedBy: addedBy || "someone",
      addedById: addedById || null,
      addedAt: Date.now()
    };
  }

  function indexOfSid(queue, sid) {
    for (var i = 0; i < queue.length; i++) if (queue[i].sid === sid) return i;
    return -1;
  }

  /**
   * Apply a queue-affecting command. Transport commands (PLAY/SEEK/…) are not
   * handled here — the host routes those straight at the video player, which
   * then reports the resulting status back into state.
   *
   * Returns { changed, notice } — `notice` is a message worth showing.
   */
  function apply(state, cmd, who) {
    var i;
    switch (cmd.type) {
      case CMD.ADD: {
        if (!cmd.video || !cmd.video.id) return { changed: false };
        if (state.queue.length >= QUEUE_LIMIT) {
          return { changed: false, notice: "The queue is full." };
        }
        var song = toSong(cmd.video, who, cmd.byId);
        state.queue.push(song);
        rebalance(state);
        return { changed: true, notice: who + " added “" + song.title + "”" };
      }

      case CMD.REMOVE:
        i = indexOfSid(state.queue, cmd.sid);
        if (i < 0) return { changed: false };
        state.queue.splice(i, 1);
        return { changed: true };

      case CMD.MOVE: {
        i = indexOfSid(state.queue, cmd.sid);
        if (i < 0) return { changed: false };
        var target = i;
        if (cmd.dir === "up") target = i - 1;
        else if (cmd.dir === "down") target = i + 1;
        else if (cmd.dir === "top") target = 0;
        else if (cmd.dir === "bottom") target = state.queue.length - 1;
        /* Dragging names where the row landed rather than which way it went.
         * The index is clamped instead of rejected: a drag races the queue it
         * is dragging in, and refusing the drop because somebody else's song
         * arrived mid-gesture is a worse answer than the nearest slot. */
        else if (cmd.dir === "to") {
          target = Math.max(0, Math.min(state.queue.length - 1, Math.round(Number(cmd.to))));
          if (!isFinite(target)) return { changed: false };
        }
        if (target === i || target < 0 || target >= state.queue.length) return { changed: false };
        var moved = state.queue.splice(i, 1)[0];
        state.queue.splice(target, 0, moved);
        return { changed: true };
      }

      case CMD.CLEAR:
        if (!state.queue.length) return { changed: false };
        state.queue = [];
        return { changed: true, notice: "Queue cleared" };

      default:
        return { changed: false };
    }
  }

  /* ---------------- turn taking ----------------
   * With `maxRun` on, one person cannot hold the microphone for a third song
   * in a row while somebody else is waiting. The queue is walked once and the
   * first song by a different singer is pulled forward whenever the run would
   * otherwise reach three — the ordering everyone else asked for is left
   * alone, so this reads as "you got bumped one slot", not as a reshuffle.
   *
   * The song playing right now counts towards the run: it is the turn people
   * in the room can actually see.
   */
  function singerOf(song) {
    return (song && (song.addedById || song.addedBy)) || "";
  }

  /* A roulette card in the queue belongs to nobody until it is spun, so it
   * cannot be part of anyone's run — and must never be pulled forward or
   * pushed back on account of who queued it. */
  function isGameCard(song) {
    return !!(song && song.kind === "game");
  }

  function rebalance(state) {
    if (!state.config || !state.config.maxRun) return false;
    var pool = state.queue.slice();
    var out = [];
    var last = state.now ? singerOf(state.now) : null;
    var run = state.now ? 1 : 0;
    var changed = false;

    while (pool.length) {
      var pick = 0;
      if (isGameCard(pool[0])) {
        out.push(pool.shift());
        last = null;
        run = 0;
        continue;
      }
      if (last !== null && run >= MAX_RUN && singerOf(pool[0]) === last) {
        for (var i = 1; i < pool.length; i++) {
          if (isGameCard(pool[i])) break;
          if (singerOf(pool[i]) !== last) { pick = i; changed = true; break; }
        }
        // Nobody else is waiting — a run of one singer is the whole queue.
      }
      var song = pool.splice(pick, 1)[0];
      var by = singerOf(song);
      if (by === last) run++; else { last = by; run = 1; }
      out.push(song);
    }

    if (changed) state.queue = out;
    return changed;
  }

  /* ---------------- scoring ----------------
   * Weighted on purpose. A flat 65–100 hands out a 97 every third song and the
   * number stops meaning anything; here the middle is where almost everyone
   * lands, the extremes are worth shouting about, and 101 exists so that once
   * a night somebody breaks the machine.
   */
  function rollScore() {
    if (Math.random() < 0.005) return 101;          // the impossible score
    var r = Math.random();
    if (r < 0.06) return 65 + Math.floor(Math.random() * 5);    // 65–69, rare
    if (r < 0.14) return 95 + Math.floor(Math.random() * 6);    // 95–100, rare
    return 70 + Math.floor(Math.random() * 25);                 // 70–94, usual
  }

  var LINES = {
    impossible: ["THAT IS NOT EVEN POSSIBLE!", "The machine gave up. One hundred and one!"],
    great: ["Wow, you are amazing!", "Superstar! The neighbours heard that one.", "Unbelievable! Give them a hand."],
    good: ["Nice one! That was good.", "Very good! The crowd approves.", "Solid. Someone has done this before."],
    okay: ["Not bad! Keep going.", "Good effort! Try another one.", "You are getting there."],
    poor: ["Well… you tried. Have another go!", "Brave. Very brave.", "The microphone was probably broken."]
  };

  function scoreBand(score) {
    if (score > 100) return "impossible";
    if (score >= 95) return "great";
    if (score >= 85) return "good";
    if (score >= 70) return "okay";
    return "poor";
  }

  function scoreLine(score) {
    var pool = LINES[scoreBand(score)];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /** Score the song that just finished and file it on the leaderboard. */
  function recordScore(state, song) {
    var score = rollScore();
    var entry = {
      score: score,
      band: scoreBand(score),
      line: scoreLine(score),
      name: (song && song.addedBy) || "Someone",
      /* The name is what the room reads; the id is what a phone checks to
       * know the score was its own. Names collide, and two Jos on one
       * leaderboard should not become one row in anybody's statistics. */
      by: (song && song.addedById) || null,
      title: (song && song.title) || "",
      seconds: (song && song.duration) || 0,
      game: (song && song.viaGame) || null,
      at: Date.now()
    };
    state.lastScore = entry;
    if (state.config && state.config.leaderboard) {
      state.scores.unshift(entry);
      if (state.scores.length > SCORE_LIMIT) state.scores.length = SCORE_LIMIT;
    }
    return entry;
  }

  /** The leaderboard: one row per singer, their best score and how many songs. */
  function standings(state) {
    var by = {};
    (state.scores || []).forEach(function (e) {
      var row = by[e.name] || (by[e.name] = { name: e.name, id: e.by || e.name, best: 0, songs: 0, total: 0 });
      row.songs++;
      row.total += e.score;
      if (e.score > row.best) row.best = e.score;
    });
    return Object.keys(by)
      .map(function (k) {
        var r = by[k];
        r.average = Math.round(r.total / r.songs);
        return r;
      })
      .sort(function (a, b) { return b.best - a.best || b.average - a.average; });
  }

  /** Pop the next song into `now`. Returns the song, or null if the queue ran dry. */
  function advance(state) {
    var next = state.queue.shift() || null;
    state.now = next;
    state.player.time = 0;
    state.player.duration = next && !isGameCard(next) ? next.duration : 0;
    /* A game card is not something the player loads — it is the room stopping
     * to spin a wheel. Saying "loading" would put the transport into a state
     * no player is ever going to leave. */
    state.player.status = !next ? "idle" : isGameCard(next) ? "game" : "loading";
    rebalance(state);
    return next;
  }

  /* ---------------- formatting ---------------- */

  function fmtTime(seconds) {
    var s = Math.max(0, Math.round(seconds || 0));
    var m = Math.floor(s / 60);
    var h = Math.floor(m / 60);
    var rs = s % 60;
    if (h > 0) return h + ":" + String(m % 60).padStart(2, "0") + ":" + String(rs).padStart(2, "0");
    return m + ":" + String(rs).padStart(2, "0");
  }

  KN.room = {
    CMD: CMD,
    MSG: MSG,
    QUEUE_LIMIT: QUEUE_LIMIT,
    MAX_RUN: MAX_RUN,
    defaultConfig: defaultConfig,
    sanitizeConfig: sanitizeConfig,
    createState: createState,
    rebalance: rebalance,
    rollScore: rollScore,
    scoreBand: scoreBand,
    scoreLine: scoreLine,
    recordScore: recordScore,
    standings: standings,
    toSong: toSong,
    isGameCard: isGameCard,
    apply: apply,
    advance: advance,
    indexOfSid: indexOfSid,
    fmtTime: fmtTime
  };
})(typeof window !== "undefined" ? window : globalThis);

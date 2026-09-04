/* games.js — the room's party games, and the rules they run on.
 *
 * There is one so far. The tab is built for more: a game is a small pool of
 * state on the room plus a queue entry that means "run me", and nothing about
 * the queue, the player or the scoreboard knows which game it is looking at.
 *
 * ── Song Roulette ──────────────────────────────────────────────────────────
 * Everybody drops songs into a pot. Once there are enough of them the pot can
 * be dropped into the queue as a single entry, and when that entry reaches the
 * stage the room spins twice: first for who sings, then for what. The picked
 * song plays credited to the picked singer, gets scored like any other, and
 * then the host is given a few seconds to spin again on the spot.
 *
 * Two rules are worth stating because they are the ones people argue about:
 *
 *   - **A picked song leaves the pot.** A pot of five is five rounds, not an
 *     unbounded supply with the same song coming up twice. Anyone can top it
 *     back up mid-game.
 *   - **The host can be excluded.** The host is usually the person running the
 *     night rather than one of the people playing it, and a roulette that
 *     keeps landing on the person holding the laptop stops being a game.
 *
 * Everything here is pure: it takes room state and returns a decision. The
 * spinning, the ticking and the confetti are the app's business, and the host
 * is still the only thing that decides anything — a guest asks.
 */
(function (global) {
  "use strict";

  var KN = (global.KN = global.KN || {});

  /* Fewer than this and it is not a roulette, it is a queue with extra steps. */
  var MIN_POOL = 3;
  var POOL_LIMIT = 60;

  var seq = 0;

  function createRoulette() {
    return {
      pool: [],
      includeHost: true,
      /* Off, and the pot drains: five songs is five rounds and then it needs
       * topping up. On, and the same pot goes all night — which is what a room
       * that curated twenty good tracks actually wants, and what a room of
       * three does not. Neither default is right for everybody, so it is a
       * switch rather than a rule. */
      keepPicked: false,
      rounds: 0,          // how many times it has been spun this session
      lastSingerId: null, // avoided on the next spin where there is a choice
      lastSongId: null    // likewise, once songs can come up more than once
    };
  }

  /** Fold a roulette off the wire back onto something sane. */
  function sanitizeRoulette(raw) {
    var r = createRoulette();
    if (!raw || typeof raw !== "object") return r;
    if (Array.isArray(raw.pool)) r.pool = raw.pool.slice(0, POOL_LIMIT);
    if (typeof raw.includeHost === "boolean") r.includeHost = raw.includeHost;
    if (typeof raw.keepPicked === "boolean") r.keepPicked = raw.keepPicked;
    if (typeof raw.rounds === "number") r.rounds = raw.rounds;
    if (typeof raw.lastSingerId === "string") r.lastSingerId = raw.lastSingerId;
    if (typeof raw.lastSongId === "string") r.lastSongId = raw.lastSongId;
    return r;
  }

  function toEntry(video, addedBy, addedById) {
    seq++;
    return {
      rid: "g" + Date.now().toString(36) + seq.toString(36),
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

  /** Returns { added, reason } — a duplicate is refused rather than doubled. */
  function addToPool(rl, video, addedBy, addedById) {
    if (!rl || !video || !video.id) return { added: false, reason: "Nothing to add." };
    if (rl.pool.length >= POOL_LIMIT) return { added: false, reason: "The roulette is full." };
    var clash = rl.pool.some(function (e) { return e.id === video.id; });
    if (clash) return { added: false, reason: "That song is already in the roulette." };
    var entry = toEntry(video, addedBy, addedById);
    rl.pool.push(entry);
    return { added: true, entry: entry };
  }

  function removeFromPool(rl, rid) {
    if (!rl) return false;
    for (var i = 0; i < rl.pool.length; i++) {
      if (rl.pool[i].rid === rid) { rl.pool.splice(i, 1); return true; }
    }
    return false;
  }

  /* Two different bars, and conflating them was a bug worth naming. Getting a
   * roulette *started* needs a pot worth drawing from — MIN_POOL, or it is a
   * queue with extra steps. Carrying on with one that is already running needs
   * exactly one song: the round after a three-song pot's first draw is still a
   * roulette round, and refusing it because the pot is now "too small" ends
   * the game two thirds of the way through it. */
  function canSpin(rl) {
    return !!(rl && rl.pool.length >= MIN_POOL);
  }

  function hasSongs(rl) {
    return !!(rl && rl.pool.length);
  }

  /**
   * Everyone the wheel is allowed to land on. The host is a candidate only
   * when the room says so — and if excluding them would leave nobody at all,
   * they are back in, because a roulette with no candidates is a dead end
   * rather than a rule being enforced.
   */
  function candidates(state) {
    var rl = state.roulette || createRoulette();
    var people = (state.guests || []).map(function (g) {
      return { id: g.id, name: g.name };
    });
    if (rl.includeHost || !people.length) {
      people.unshift({ id: "host", name: state.hostName || "Host" });
    }
    return people;
  }

  function pickFrom(list) {
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }

  /**
   * Spin for a singer. The person who sang the previous round is skipped where
   * anyone else is available — two rounds running is a coincidence the first
   * time and a broken wheel the second.
   */
  function spinSinger(state) {
    var rl = state.roulette || createRoulette();
    var all = candidates(state);
    if (!all.length) return null;
    var fresh = all.filter(function (p) { return p.id !== rl.lastSingerId; });
    return pickFrom(fresh.length ? fresh : all);
  }

  /**
   * Spin for a song. It leaves the pot unless the room asked for songs to stay
   * in — and when they stay in, the one that just played is skipped where
   * there is anything else to pick, for the same reason the previous singer is:
   * the same song twice running reads as a broken wheel rather than as luck.
   */
  function spinSong(rl) {
    if (!rl || !rl.pool.length) return null;
    var pool = rl.pool;
    if (rl.keepPicked) {
      var fresh = pool.filter(function (e) { return e.id !== rl.lastSongId; });
      var pick = pickFrom(fresh.length ? fresh : pool);
      rl.lastSongId = pick ? pick.id : null;
      return pick;
    }
    var i = Math.floor(Math.random() * pool.length);
    var out = pool.splice(i, 1)[0];
    rl.lastSongId = out ? out.id : null;
    return out;
  }

  /**
   * The list of names the wheel flashes through on its way to `landing`.
   * Built here rather than in the animation so the reel is honestly drawn from
   * the real candidates — a wheel showing names that were never in the running
   * is a slot machine, not a draw.
   */
  function reel(options, landing, length) {
    var out = [];
    var n = Math.max(8, length || 24);
    if (!options.length) return out;
    for (var i = 0; i < n; i++) out.push(options[i % options.length]);
    /* Shuffle everything but the last slot, which is the answer. */
    for (var j = out.length - 2; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1));
      var tmp = out[j]; out[j] = out[k]; out[k] = tmp;
    }
    out[out.length - 1] = landing;
    return out;
  }

  /* A queue entry that is a game rather than a song. The queue, the transport
   * and the reorder buttons all treat it like any other row; only `advance`
   * on the host looks at `kind`. */
  function queueCard(game, addedBy, addedById) {
    seq++;
    return {
      sid: "s" + Date.now().toString(36) + seq.toString(36),
      kind: "game",
      game: game || "roulette",
      id: null,
      title: "Song Roulette",
      author: "",
      duration: 0,
      thumb: null,
      addedBy: addedBy || "someone",
      addedById: addedById || null,
      addedAt: Date.now()
    };
  }

  function isGameCard(song) {
    return !!(song && song.kind === "game");
  }

  KN.games = {
    MIN_POOL: MIN_POOL,
    POOL_LIMIT: POOL_LIMIT,
    createRoulette: createRoulette,
    sanitizeRoulette: sanitizeRoulette,
    addToPool: addToPool,
    removeFromPool: removeFromPool,
    canSpin: canSpin,
    hasSongs: hasSongs,
    candidates: candidates,
    spinSinger: spinSinger,
    spinSong: spinSong,
    reel: reel,
    queueCard: queueCard,
    isGameCard: isGameCard
  };
})(typeof window !== "undefined" ? window : globalThis);

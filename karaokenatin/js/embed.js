/* embed.js — "will this actually play here?", asked before we show it.
 *
 * A search mirror will happily return videos the host screen can never play:
 * the owner disabled embedding (player errors 101/150), the upload is private
 * or gone (100), or YouTube refuses it for some other reason (5). Those used to
 * reach the queue and only fail in front of everybody, mid-party, on the one
 * screen nobody wants to be fiddling with.
 *
 * There is no honest API for this. oEmbed's 401 is a rumour, not a contract,
 * and neither Piped nor Invidious carries the flag. The only answer that
 * matches what the host will do is the thing the host does: hand the id to a
 * real YouTube embed and see what it says. So that is what this is — a small
 * pool of offscreen, muted IFrame players that `cueVideoById` each candidate.
 * Cueing loads no video stream; it asks YouTube whether it *would*, which is
 * exactly the question, and costs a fraction of a playback.
 *
 * Two things keep it from feeling like a wait:
 *
 *   - Verdicts stream. Callers render each result the moment it passes rather
 *     than after the sweep, so the first playable song is on screen in about
 *     the time one probe takes, not thirty.
 *   - Verdicts are remembered. Embeddability is a property of the video, not
 *     of today, so a hit in the cache costs nothing and a second search for
 *     the same song is instant.
 *
 * Uncertainty never hides a result. A probe that times out, a pool that could
 * not be built, an API that is blocked — all resolve to "unknown", and unknown
 * is shown. Hiding a playable song is a worse failure than showing one that
 * turns out not to be, which the room already handles by skipping.
 */
(function (global) {
  "use strict";

  var KN = (global.KN = global.KN || {});

  var POOL_SIZE = 3;          // concurrent probes; also the render fan-out
  var PROBE_MS = 6500;        // a silent player is an answer we won't get
  /* CUED is not the end of the story. YouTube accepts the id, moves the
   * player to "video cued", and only then decides it will not serve it here —
   * the 101/150 refusal lands a beat after the state change, not instead of
   * it. Settling on CUED therefore passed almost everything, and cached the
   * wrong answer forever. A positive state now only starts the clock. */
  var GRACE_MS = 1400;        // how long a refusal is given to contradict a cue
  /* Versioned: every verdict cached before the fix above was reached by
   * trusting a cue, so a returning user's stored "playable" is exactly the
   * wrong answer we are here to stop showing. The old key is dropped rather
   * than migrated. */
  var CACHE_KEY = "kn:embeddable:2";
  var LEGACY_CACHE_KEYS = ["kn:embeddable"];
  var CACHE_MAX = 800;

  var YES = "yes", NO = "no", UNKNOWN = "unknown";

  /* ---------------- remembered verdicts ----------------
   * id -> 1 playable | 0 refused. Only decided verdicts are stored; an
   * "unknown" is our failure, not the video's, and must not be cached as one.
   */
  var cache = (function () {
    try {
      LEGACY_CACHE_KEYS.forEach(function (k) { localStorage.removeItem(k); });
      return JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
    } catch (e) { return {}; }
  })();

  function remember(id, ok) {
    cache[id] = ok ? 1 : 0;
    var keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) {
      // Insertion-ordered, so the oldest entries are at the front.
      keys.slice(0, keys.length - CACHE_MAX).forEach(function (k) { delete cache[k]; });
    }
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) { /* private mode */ }
  }

  /* ---------------- the probe pool ---------------- */

  var slots = [];        // every player built so far
  var idle = [];         // ready and unclaimed
  var waiting = [];      // resolvers queued behind a busy pool
  var building = 0;
  var poolBroken = false; // the IFrame API is unreachable; stop trying
  var seq = 0;

  /* Offscreen rather than display:none — a hidden player is allowed to skip
   * work the real one wouldn't, and we want the same answer the host gets. */
  function stage() {
    var host = document.getElementById("kn-probes");
    if (!host) {
      host = document.createElement("div");
      host.id = "kn-probes";
      host.className = "embed-probes";
      host.setAttribute("aria-hidden", "true");
      document.body.appendChild(host);
    }
    return host;
  }

  function makeSlot() {
    return KN.player.loadApi().then(function (YT) {
      return new Promise(function (resolve, reject) {
        var mount = document.createElement("div");
        mount.id = "kn-probe-" + (++seq);
        stage().appendChild(mount);

        var slot = { id: mount.id };
        var settle = null;      // resolver of the probe in flight
        var expect = null;      // the id that probe asked about
        var previous = null;    // the id before it — the only source of stale events
        var timer = null;
        var grace = null;
        var started = false;

        function done(verdict) {
          clearTimeout(timer);
          clearTimeout(grace);
          grace = null;
          var fn = settle;
          settle = null;
          previous = expect;
          expect = null;
          if (fn) fn(verdict);
        }

        function reportedId(player) {
          try {
            var d = player.getVideoData && player.getVideoData();
            return d && d.video_id ? d.video_id : null;
          } catch (e) { return null; }
        }

        /* A verdict must belong to the video we asked about. The player keeps
         * emitting about the previous one for a moment after a new cue, and a
         * stale "cued" landing on the next probe would wave through a video
         * nobody checked.
         *
         * Only the slot's previous id is stale, though. A refused video often
         * reports no video data at all, and rejecting every event the player
         * cannot name threw away the refusals we are here to collect — the
         * probe then timed out as "unknown", and unknown is shown. */
        function mine(player) {
          if (!expect) return false;
          var id = reportedId(player);
          if (!id || id === expect) return true;
          return id !== previous;
        }

        var player = new YT.Player(mount.id, {
          height: "180",
          width: "320",
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            rel: 0,
            modestbranding: 1,
            iv_load_policy: 3,
            playsinline: 1,
            origin: /^https?:$/.test(global.location.protocol) ? global.location.origin : undefined
          },
          events: {
            onReady: function () {
              started = true;
              try { player.mute(); } catch (e) { /* nothing to silence yet */ }
              resolve(slot);
            },
            onStateChange: function (e) {
              // CUED is the candidate pass; PLAYING/BUFFERING mean the same in
              // case a cue ever runs long. None of them is final: a refusal
              // arrives just after the cue, so a pass has to outlive it.
              if ((e.data === 5 || e.data === 1 || e.data === 3) && mine(player)) {
                if (!settle || grace) return;
                grace = setTimeout(function () { done(YES); }, GRACE_MS);
              }
            },
            onError: function (e) {
              // 2 bad id · 5 html5 · 100 gone · 101/150 embedding refused.
              // Every one of them means this cannot play in our page, which is
              // the only distinction the caller needs.
              void e;
              if (mine(player)) done(NO);
            }
          }
        });

        slot.probe = function (videoId) {
          return new Promise(function (res) {
            settle = res;
            expect = videoId;
            clearTimeout(grace);
            grace = null;
            timer = setTimeout(function () { done(UNKNOWN); }, PROBE_MS);
            try { player.cueVideoById({ videoId: videoId }); }
            catch (err) { done(UNKNOWN); }
          });
        };

        /* A player that never reports ready is a player that never will —
         * but only foreground seconds count towards saying so. A backgrounded
         * iOS page is frozen, not broken, and a wall-clock timer condemned
         * every probe that was in flight when the phone was pocketed. */
        var idled = 0;
        var watch = setInterval(function () {
          if (started) { clearInterval(watch); return; }
          if (document.hidden) return;
          idled += 500;
          if (idled >= 15000) {
            clearInterval(watch);
            reject(new Error("probe player did not start"));
          }
        }, 500);
      });
    });
  }

  function breakPool(err) {
    poolBroken = true;
    var queued = waiting;
    waiting = [];
    queued.forEach(function (w) { w(null); });
    return err;
  }

  function acquire() {
    if (poolBroken) return Promise.resolve(null);
    if (idle.length) return Promise.resolve(idle.pop());
    if (slots.length + building < POOL_SIZE) {
      building++;
      return makeSlot().then(
        function (slot) { building--; slots.push(slot); return slot; },
        function (e) { building--; breakPool(e); return null; }
      );
    }
    return new Promise(function (res) { waiting.push(res); });
  }

  function release(slot) {
    var next = waiting.shift();
    if (next) next(slot);
    else idle.push(slot);
  }

  /* ---------------- public API ---------------- */

  /** check(id) -> Promise<'yes'|'no'|'unknown'>. Never rejects. */
  function check(id) {
    if (!id) return Promise.resolve(UNKNOWN);
    if (Object.prototype.hasOwnProperty.call(cache, id)) {
      return Promise.resolve(cache[id] ? YES : NO);
    }
    return acquire().then(function (slot) {
      if (!slot) return UNKNOWN;
      return slot.probe(id).then(function (verdict) {
        release(slot);
        if (verdict !== UNKNOWN) remember(id, verdict === YES);
        return verdict;
      }, function () {
        release(slot);
        return UNKNOWN;
      });
    }, function () { return UNKNOWN; });
  }

  /**
   * filter(videos, opts) — probe a result list, POOL_SIZE at a time, calling
   * back as each verdict lands instead of at the end.
   *
   *   onAccept(video, rank, verdict)
   *                          playable (or undecidable); rank is its position
   *                          in the original list, so a caller rendering out
   *                          of order can still put it back in order, and
   *                          verdict says which of the two it was, so an
   *                          unchecked result can be shown as unchecked
   *   onProgress(stats)      after every verdict
   *   onDone(stats)          the sweep finished, or was cancelled
   *
   * Returns { cancel() } — a new search abandons the previous sweep rather
   * than making it queue behind results nobody is looking at any more.
   */
  function filter(videos, opts) {
    opts = opts || {};
    var onAccept = opts.onAccept || function () {};
    var onProgress = opts.onProgress || function () {};
    var onDone = opts.onDone || function () {};
    var list = (videos || []).slice(0, opts.limit || (videos || []).length);

    /* A broken pool is a snapshot, not a diagnosis. It latches when the API
     * cannot be reached, and used to stay latched for the life of the page —
     * so a blocker switched off, or wifi that came back, still left every
     * later search reporting its results "unchecked". A new sweep gets a new
     * chance; if the API is still gone it re-breaks on the first acquire. */
    if (poolBroken && !slots.length) poolBroken = false;

    var next = 0, active = 0;
    var stats = { total: list.length, checked: 0, kept: 0, dropped: 0, unsure: 0 };
    var cancelled = false;
    var finished = false;

    function finish() {
      if (finished) return;
      finished = true;
      onDone(stats);
    }

    function pump() {
      if (cancelled) return;
      while (active < POOL_SIZE && next < list.length) {
        (function (video, rank) {
          active++;
          check(video.id).then(function (verdict) {
            active--;
            if (cancelled) return;
            stats.checked++;
            if (verdict === NO) {
              stats.dropped++;
            } else {
              stats.kept++;
              if (verdict === UNKNOWN) stats.unsure++;
              onAccept(video, rank, verdict);
            }
            onProgress(stats);
            pump();
          });
        })(list[next], next);
        next++;
      }
      if (active === 0 && next >= list.length) finish();
    }

    pump();

    return {
      cancel: function () {
        if (finished) return;
        cancelled = true;
        finished = true;
      }
    };
  }

  KN.embed = {
    check: check,
    filter: filter,
    YES: YES,
    NO: NO,
    UNKNOWN: UNKNOWN,
    POOL_SIZE: POOL_SIZE,
    /* Tests need a clean slate; nothing in the app calls this. */
    _forget: function () {
      cache = {};
      try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* private mode */ }
    }
  };
})(typeof window !== "undefined" ? window : globalThis);

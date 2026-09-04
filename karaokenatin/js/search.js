/* search.js — YouTube search without a YouTube API key.
 *
 * Two independent networks of public, CORS-open mirrors are used:
 *   1. Piped      GET /search?q=…&filter=videos
 *   2. Invidious  GET /api/v1/search?q=…&type=video
 *
 * Instances go down constantly, so a single hard-coded host is not a plan.
 * Each tier is probed a few hosts at a time and the first usable answer wins;
 * if a whole tier fails we drop to the next, and if both fail we say so
 * plainly. Pasting a YouTube link always works, search up or down — that path
 * needs no third party at all beyond optional title lookup.
 */
(function (global) {
  "use strict";

  var KN = (global.KN = global.KN || {});

  var PIPED = [
    "https://pipedapi.kavin.rocks",
    "https://pipedapi.adminforge.de",
    "https://api.piped.private.coffee",
    "https://pipedapi.leptons.xyz",
    "https://pipedapi.drgns.space",
    "https://pipedapi.ducks.party",
    "https://pipedapi.reallyaweso.me"
  ];

  var INVIDIOUS = [
    "https://inv.nadeko.net",
    "https://invidious.nerdvpn.de",
    "https://yewtu.be",
    "https://invidious.jing.rocks",
    "https://invidious.privacyredirect.com",
    "https://iv.melmac.space",
    "https://invidious.reallyaweso.me"
  ];

  var TIMEOUT_MS = 7000;
  var FANOUT = 3;        // hosts probed simultaneously within a tier
  var HEALTH_KEY = "kn:endpoints";

  /* ---------------- endpoint health ----------------
   * Remember which mirror answered last time so the next search starts there
   * instead of re-walking the graveyard. Failures are only remembered for the
   * session; instances recover.
   */
  var health = (function () {
    try { return JSON.parse(localStorage.getItem(HEALTH_KEY)) || {}; }
    catch (e) { return {}; }
  })();
  var deadThisSession = {};

  function remember(kind, base) {
    health[kind] = base;
    try { localStorage.setItem(HEALTH_KEY, JSON.stringify(health)); } catch (e) { /* private mode */ }
  }

  function ordered(list, kind) {
    var preferred = health[kind];
    var live = list.filter(function (b) { return !deadThisSession[b]; });
    if (!live.length) { deadThisSession = {}; live = list.slice(); }
    if (preferred && live.indexOf(preferred) > 0) {
      live = [preferred].concat(live.filter(function (b) { return b !== preferred; }));
    }
    return live;
  }

  function getJSON(url) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    return fetch(url, {
      signal: ctrl ? ctrl.signal : undefined,
      headers: { Accept: "application/json" },
      referrerPolicy: "no-referrer",
      mode: "cors"
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .finally(function () { clearTimeout(timer); });
  }

  /**
   * Run `attempt(base)` over `bases`, FANOUT at a time, and resolve with the
   * first non-empty result. Rejects only when every host has been tried.
   */
  function hedge(bases, attempt) {
    return new Promise(function (resolve, reject) {
      var i = 0;
      var inflight = 0;
      var done = false;
      var errors = 0;

      function pump() {
        if (done) return;
        while (inflight < FANOUT && i < bases.length) {
          var base = bases[i++];
          inflight++;
          /* eslint-disable no-loop-func */
          (function (b) {
            attempt(b).then(
              function (value) {
                inflight--;
                if (done) return;
                if (value) { done = true; resolve({ value: value, base: b }); }
                else { errors++; pump(); }
              },
              function () {
                inflight--;
                errors++;
                deadThisSession[b] = true;
                if (!done) pump();
              }
            );
          })(base);
          /* eslint-enable no-loop-func */
        }
        if (!done && inflight === 0 && i >= bases.length) reject(new Error("all endpoints failed (" + errors + ")"));
      }
      pump();
    });
  }

  /* ---------------- normalisation ---------------- */

  // i.ytimg.com is served straight from YouTube's CDN, so thumbnails keep
  // working even when the mirror that produced the search result is gone.
  function thumbFor(id) { return "https://i.ytimg.com/vi/" + id + "/mqdefault.jpg"; }

  function clean(title) {
    return String(title || "").replace(/\s+/g, " ").trim();
  }

  function fromPiped(items) {
    return (items || [])
      .map(function (it) {
        var id = (it.url || "").split("v=")[1] || (it.url || "").split("/").pop();
        if (!id || it.type === "channel" || it.type === "playlist") return null;
        return {
          id: id,
          title: clean(it.title),
          author: clean(it.uploaderName || it.uploader),
          duration: it.duration > 0 ? it.duration : 0,
          thumb: thumbFor(id)
        };
      })
      .filter(Boolean);
  }

  function fromInvidious(items) {
    return (items || [])
      .map(function (it) {
        if (!it.videoId || (it.type && it.type !== "video")) return null;
        return {
          id: it.videoId,
          title: clean(it.title),
          author: clean(it.author),
          duration: it.lengthSeconds > 0 ? it.lengthSeconds : 0,
          thumb: thumbFor(it.videoId)
        };
      })
      .filter(Boolean);
  }

  /* ---------------- public API ---------------- */

  /** Pull a video id out of anything a user is likely to paste. */
  function parseVideoId(input) {
    var s = String(input || "").trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    var patterns = [
      /[?&]v=([A-Za-z0-9_-]{11})/,
      /youtu\.be\/([A-Za-z0-9_-]{11})/,
      /youtube\.com\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/,
      /\/watch\/([A-Za-z0-9_-]{11})/
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = s.match(patterns[i]);
      if (m) return m[1];
    }
    return null;
  }

  function looksLikeUrl(s) {
    return /^https?:\/\//i.test(String(s || "").trim()) || /youtu\.?be/i.test(String(s || ""));
  }

  /**
   * This is a karaoke app, so a search for a song title means the karaoke
   * track, not the official music video. Biasing the query is what actually
   * gets those to the top — ranking the raw results ourselves cannot, since
   * the mirrors only return what they were asked for.
   *
   * Kept out of the input box on purpose: the user typed a song, and echoing
   * back a query they did not write reads as the app being broken. Skipped
   * when they already said it, so nobody searches "karaoke karaoke".
   */
  function biasToKaraoke(q) {
    return /\bkaraoke\b/i.test(q) ? q : q + " karaoke";
  }

  /* ---------------- is this actually a karaoke track? ----------------
   * The bias above asks the mirror for karaoke; it does not make the mirror
   * deliver it. A search for a song comes back with the official video, three
   * live performances, a reaction and — somewhere in there — the track people
   * can actually sing over. Reading the title and the uploader is a heuristic,
   * but it is the only evidence there is: no mirror carries a "this is a
   * karaoke track" flag, and neither does YouTube.
   *
   * The number is a confidence, not a verdict, and it is used at two
   * thresholds. Above SURE the row is badged, because being wrong there costs
   * a badge. Below MAYBE the row is dropped, because a room searching for
   * something to sing has no use for a reaction video, and a list where four
   * results in five cannot be sung is a list nobody scrolls.
   *
   * Terms are matched in the several languages this app is actually used in —
   * "videoke" and "minus one" are what a Filipino room searches for, and
   * dropping their results because the word "karaoke" was absent would be a
   * bug that only shows up somewhere else.
   */
  var SURE = 0.9;      // badge it
  var MAYBE = 0.45;    // below this it is not shown at all

  var STRONG = /\b(?:karaoke|videoke|kar(?:a)?oke|minus\s*one|minusone|sing\s*-?\s*along|singalong|off\s*vocal|karafun)\b/i;
  var BACKING = /\b(?:backing\s*track|instrumental(?:\s*version)?|no\s*vocals?|without\s*vocals?|acompa(?:n|ñ)amiento)\b/i;
  var LYRICS = /\b(?:lyrics?|lyric\s*video|with\s*lyrics)\b/i;
  /* Things a karaoke track is definitely not, however the title is worded. */
  var AGAINST = /\b(?:official\s*(?:music\s*)?video|official\s*mv|\bm\/?v\b|reaction|review|behind\s*the\s*scenes|interview|tutorial|how\s*to\s*(?:sing|play)|guitar\s*lesson|full\s*album|compilation|mix\s*\d|top\s*\d+)\b/i;
  var LIVE = /\b(?:live(?:\s*(?:at|in|from|performance|session))?|concert|tour|acoustic\s*session)\b/i;

  /**
   * karaokeScore(video) -> 0..1
   *
   * Title and uploader both count, and the uploader counts for a lot: a
   * channel whose name is "Sing King Karaoke" uploads exactly one kind of
   * thing, which is far better evidence than any single word in a title.
   */
  function karaokeScore(video) {
    var title = String((video && video.title) || "");
    var author = String((video && video.author) || "");
    var both = title + " " + author;

    var score = 0.3;                                  // an unremarkable result
    if (STRONG.test(title)) score = 0.92;
    else if (STRONG.test(author)) score = 0.86;
    else if (BACKING.test(title) && LYRICS.test(title)) score = 0.9;
    else if (BACKING.test(title)) score = 0.6;
    else if (LYRICS.test(title)) score = 0.4;

    // A karaoke channel putting out a karaoke title is as sure as this gets.
    if (STRONG.test(title) && STRONG.test(author)) score = 0.97;
    // "karaoke ... with lyrics" is the canonical shape of the real thing.
    if (STRONG.test(title) && LYRICS.test(title)) score = Math.max(score, 0.95);

    if (LIVE.test(both)) score = Math.min(score, 0.35);
    // The one exception: a "live karaoke" upload is still a karaoke track.
    if (LIVE.test(both) && STRONG.test(title)) score = Math.max(score, 0.88);
    if (AGAINST.test(both)) score = Math.min(score, 0.12);

    return Math.max(0, Math.min(1, score));
  }

  /** A row's verdict: "sure" (badge it), "maybe" (show it), "no" (drop it). */
  function karaokeVerdict(video) {
    var score = karaokeScore(video);
    if (score >= SURE) return "sure";
    if (score >= MAYBE) return "maybe";
    return "no";
  }

  /* ---------------- topping the list back up ----------------
   * Between the embeddability sweep and the karaoke filter, a search that
   * started with twenty results can end with four on screen — and four is a
   * dead end rather than a list. So the same song is asked for again in
   * different words, and the answers are merged.
   *
   * Different words, not the same words twice: every mirror is deterministic,
   * so re-running one query is a guaranteed way to get the identical page
   * back. These are the phrasings that actually turn up different uploads.
   */
  var VARIANTS = [
    function (q) { return biasToKaraoke(q); },
    function (q) { return q.replace(/\s*karaoke\s*/ig, " ").trim() + " karaoke version with lyrics"; },
    function (q) { return q.replace(/\s*karaoke\s*/ig, " ").trim() + " videoke minus one"; },
    function (q) { return q.replace(/\s*karaoke\s*/ig, " ").trim() + " instrumental karaoke sing along"; }
  ];

  function variantQuery(raw, attempt) {
    var fn = VARIANTS[Math.min(attempt, VARIANTS.length - 1)];
    return fn(String(raw || "").trim());
  }

  /**
   * Search both tiers. Resolves with { results, source } or rejects with an
   * Error whose message is safe to show the user.
   */
  function search(query, attempt) {
    var raw = String(query || "").trim();
    if (!raw) return Promise.resolve({ results: [], source: null });
    var q = variantQuery(raw, attempt || 0);

    return hedge(ordered(PIPED, "piped"), function (base) {
      return getJSON(base + "/search?q=" + encodeURIComponent(q) + "&filter=videos").then(function (data) {
        var r = fromPiped(data && data.items);
        return r.length ? r : null;
      });
    })
      .then(function (hit) {
        remember("piped", hit.base);
        return { results: hit.value, source: "Piped · " + hostOf(hit.base) };
      })
      .catch(function () {
        return hedge(ordered(INVIDIOUS, "invidious"), function (base) {
          return getJSON(base + "/api/v1/search?q=" + encodeURIComponent(q) + "&type=video").then(function (data) {
            var r = fromInvidious(data);
            return r.length ? r : null;
          });
        }).then(function (hit) {
          remember("invidious", hit.base);
          return { results: hit.value, source: "Invidious · " + hostOf(hit.base) };
        });
      })
      .catch(function () {
        throw new Error(
          "Search is unavailable right now — every public Piped and Invidious mirror we know refused. " +
          "You can still paste a YouTube link."
        );
      });
  }

  function hostOf(base) {
    try { return new URL(base).hostname; } catch (e) { return base; }
  }

  /**
   * Turn a pasted link (or bare id) into a queue entry. Metadata is a bonus:
   * if every lookup fails we still return a playable entry, and the player
   * fills in the real title and duration once it loads.
   */
  function resolve(input) {
    var id = parseVideoId(input);
    if (!id) return Promise.reject(new Error("That does not look like a YouTube link."));

    var fallback = { id: id, title: "YouTube video", author: "", duration: 0, thumb: thumbFor(id) };

    // oembed is YouTube's own, CORS-open, and needs no mirror.
    return getJSON("https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://youtu.be/" + id))
      .then(function (d) {
        return { id: id, title: clean(d.title), author: clean(d.author_name), duration: 0, thumb: thumbFor(id) };
      })
      .catch(function () {
        return hedge(ordered(PIPED, "piped"), function (base) {
          return getJSON(base + "/streams/" + id).then(function (d) {
            if (!d || !d.title) return null;
            return { id: id, title: clean(d.title), author: clean(d.uploader), duration: d.duration || 0, thumb: thumbFor(id) };
          });
        }).then(function (hit) { return hit.value; });
      })
      .catch(function () {
        return hedge(ordered(INVIDIOUS, "invidious"), function (base) {
          return getJSON(base + "/api/v1/videos/" + id).then(function (d) {
            if (!d || !d.title) return null;
            return { id: id, title: clean(d.title), author: clean(d.author), duration: d.lengthSeconds || 0, thumb: thumbFor(id) };
          });
        }).then(function (hit) { return hit.value; });
      })
      .catch(function () { return fallback; });
  }

  KN.search = {
    search: search,
    resolve: resolve,
    parseVideoId: parseVideoId,
    looksLikeUrl: looksLikeUrl,
    thumbFor: thumbFor,
    biasToKaraoke: biasToKaraoke,
    variantQuery: variantQuery,
    karaokeScore: karaokeScore,
    karaokeVerdict: karaokeVerdict,
    SURE: SURE,
    MAYBE: MAYBE,
    VARIANTS: VARIANTS.length,
    PIPED: PIPED,
    INVIDIOUS: INVIDIOUS
  };
})(typeof window !== "undefined" ? window : globalThis);

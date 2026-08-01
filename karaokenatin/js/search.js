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

  /**
   * Search both tiers. Resolves with { results, source } or rejects with an
   * Error whose message is safe to show the user.
   */
  function search(query) {
    var raw = String(query || "").trim();
    if (!raw) return Promise.resolve({ results: [], source: null });
    var q = biasToKaraoke(raw);

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
    PIPED: PIPED,
    INVIDIOUS: INVIDIOUS
  };
})(typeof window !== "undefined" ? window : globalThis);

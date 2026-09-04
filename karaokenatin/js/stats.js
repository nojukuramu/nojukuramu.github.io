/* stats.js — what this phone remembers about its own karaoke nights.
 *
 * Every number here is about *you*: the songs you sang, the scores they got,
 * how long you held the microphone, how the games went. Other people's songs
 * are none of this file's business even when they came down the same wire.
 *
 * It lives in localStorage and goes nowhere else. There is no account to
 * attach it to and no server to send it to — that is not a policy that could
 * change, it is the shape of the app. The Statistics page says so in as many
 * words, because a page full of personal history that does not say where it
 * lives is a page people are right to distrust.
 *
 * The store is deliberately append-mostly and capped: a session row per room
 * joined, a song row per song sung, and a small tally per game. Everything the
 * page shows is derived from those three at read time, so a new statistic
 * later is a new derivation rather than a migration.
 */
(function (global) {
  "use strict";

  var KN = (global.KN = global.KN || {});

  var KEY = "kn:stats";
  var VERSION = 1;
  var SESSION_LIMIT = 300;
  var SONG_LIMIT = 1000;
  /* A reload should rejoin the session it was already in rather than counting
   * the night twice. Anything older than this is a different night. */
  var SESSION_RESUME_MS = 6 * 60 * 60 * 1000;

  function blank() {
    return { v: VERSION, sessions: [], songs: [], games: {}, current: null };
  }

  var store = (function () {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY));
      if (!raw || raw.v !== VERSION) return blank();
      raw.sessions = Array.isArray(raw.sessions) ? raw.sessions : [];
      raw.songs = Array.isArray(raw.songs) ? raw.songs : [];
      raw.games = raw.games && typeof raw.games === "object" ? raw.games : {};
      return raw;
    } catch (e) { return blank(); }
  })();

  var listeners = [];

  function flush() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* private mode */ }
    listeners.forEach(function (fn) { try { fn(); } catch (e) { /* a listener's problem */ } });
  }

  function sessionById(id) {
    for (var i = 0; i < store.sessions.length; i++) {
      if (store.sessions[i].id === id) return store.sessions[i];
    }
    return null;
  }

  function current() {
    return store.current ? sessionById(store.current) : null;
  }

  /* ---------------- writing ---------------- */

  /**
   * A room was entered. Reuses the open session for the same room when the
   * page was merely reloaded — otherwise a host refreshing twice would look
   * like three separate nights.
   */
  function startSession(opts) {
    opts = opts || {};
    var now = Date.now();
    var open = current();
    if (open && open.code === opts.code && now - (open.lastAt || open.startedAt) < SESSION_RESUME_MS) {
      open.lastAt = now;
      open.role = opts.role || open.role;
      flush();
      return open.id;
    }
    endSession();

    var row = {
      id: "n" + now.toString(36) + Math.floor(Math.random() * 1296).toString(36),
      code: opts.code || "",
      role: opts.role || "guest",
      startedAt: now,
      lastAt: now,
      endedAt: 0,
      songs: 0,
      scoreTotal: 0,
      best: 0,
      singMs: 0
    };
    store.sessions.unshift(row);
    if (store.sessions.length > SESSION_LIMIT) store.sessions.length = SESSION_LIMIT;
    store.current = row.id;
    flush();
    return row.id;
  }

  /** The room was left, or this page is going away. */
  function endSession() {
    var open = current();
    if (open && !open.endedAt) {
      open.endedAt = Math.max(open.lastAt || open.startedAt, Date.now());
    }
    store.current = null;
    flush();
  }

  /** Keeps an open session's clock honest while the room is still running. */
  function touchSession() {
    var open = current();
    if (!open) return;
    open.lastAt = Date.now();
    flush();
  }

  /**
   * One song, sung by the owner of this phone, and what it scored.
   * `seconds` is how much of it actually played — a skipped song never gets
   * here, so this is time at the microphone rather than time in the queue.
   */
  function recordSong(entry) {
    entry = entry || {};
    var open = current();
    var row = {
      at: Date.now(),
      title: String(entry.title || "").slice(0, 120),
      score: Number(entry.score) || 0,
      ms: Math.max(0, Math.round(Number(entry.seconds) || 0) * 1000),
      code: (open && open.code) || "",
      session: open ? open.id : null
    };
    store.songs.unshift(row);
    if (store.songs.length > SONG_LIMIT) store.songs.length = SONG_LIMIT;

    if (open) {
      open.songs++;
      open.scoreTotal += row.score;
      open.singMs += row.ms;
      if (row.score > open.best) open.best = row.score;
      open.lastAt = row.at;
    }
    flush();
    return row;
  }

  /** A game round finished. `outcome` is "win" or "loss". */
  function recordGame(game, outcome) {
    var key = String(game || "game");
    var tally = store.games[key] || (store.games[key] = { played: 0, wins: 0, losses: 0 });
    tally.played++;
    if (outcome === "win") tally.wins++;
    else if (outcome === "loss") tally.losses++;
    flush();
  }

  /* ---------------- reading ---------------- */

  /**
   * Everything the Statistics page shows, derived rather than stored — so a
   * statistic added later needs no migration and cannot disagree with the rows
   * it came from.
   *
   * A session that was never closed (the tab was killed, the phone died) has
   * no end time; its length is measured to the last thing that happened in it
   * rather than to now, which would grow forever.
   */
  function summary() {
    var songs = store.songs;
    var sessions = store.sessions;

    var scoreTotal = 0;
    var best = 0;
    var worst = 0;
    var singMs = 0;
    songs.forEach(function (s) {
      scoreTotal += s.score;
      singMs += s.ms;
      if (s.score > best) best = s.score;
      if (!worst || s.score < worst) worst = s.score;
    });

    var roomMs = 0;
    sessions.forEach(function (n) {
      var end = n.endedAt || n.lastAt || n.startedAt;
      roomMs += Math.max(0, end - n.startedAt);
    });

    var games = Object.keys(store.games).map(function (k) {
      var g = store.games[k];
      var decided = g.wins + g.losses;
      return {
        game: k,
        played: g.played,
        wins: g.wins,
        losses: g.losses,
        winrate: decided ? Math.round((g.wins / decided) * 100) : null
      };
    });

    return {
      sessions: sessions.length,
      hosted: sessions.filter(function (n) { return n.role === "host"; }).length,
      songs: songs.length,
      average: songs.length ? Math.round(scoreTotal / songs.length) : 0,
      best: best,
      worst: worst,
      singMs: singMs,
      roomMs: roomMs,
      games: games,
      firstAt: sessions.length ? sessions[sessions.length - 1].startedAt : 0,
      /* The best night, by average rather than by one lucky song — a single
       * 101 should not crown an evening nobody else remembers. */
      bestSession: sessions.reduce(function (top, n) {
        if (!n.songs) return top;
        var avg = Math.round(n.scoreTotal / n.songs);
        if (!top || avg > top.average) return { code: n.code, average: avg, songs: n.songs, at: n.startedAt };
        return top;
      }, null)
    };
  }

  /** Session rows, newest first, with their averages worked out. */
  function sessions() {
    return store.sessions.map(function (n) {
      var end = n.endedAt || n.lastAt || n.startedAt;
      return {
        id: n.id,
        code: n.code,
        role: n.role,
        startedAt: n.startedAt,
        ms: Math.max(0, end - n.startedAt),
        songs: n.songs,
        best: n.best,
        average: n.songs ? Math.round(n.scoreTotal / n.songs) : 0,
        singMs: n.singMs,
        open: !n.endedAt
      };
    });
  }

  function songs() { return store.songs.slice(); }

  function isEmpty() { return !store.sessions.length && !store.songs.length; }

  function clear() {
    store = blank();
    flush();
  }

  function onChange(fn) { listeners.push(fn); }

  KN.stats = {
    startSession: startSession,
    endSession: endSession,
    touchSession: touchSession,
    recordSong: recordSong,
    recordGame: recordGame,
    summary: summary,
    sessions: sessions,
    songs: songs,
    isEmpty: isEmpty,
    clear: clear,
    onChange: onChange,
    KEY: KEY
  };
})(typeof window !== "undefined" ? window : globalThis);

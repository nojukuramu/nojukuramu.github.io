/* library.js — saved songs and playlists, stored in this browser.
 *
 * Deliberately independent of the room: the library is yours, it survives
 * leaving a room, and it works with no connection at all. A room borrows from
 * it (queue this song, queue this playlist) and never the other way round —
 * nothing a guest does can reach into your library.
 *
 * Everything lives under one localStorage key so a save is atomic; the store
 * is small (song stubs, no media) and a party-sized library is a few KB.
 */
(function (global) {
  "use strict";

  var KN = (global.KN = global.KN || {});

  var KEY = "kn:library";
  var VERSION = 1;
  var MAX_SONGS = 500;
  var MAX_PLAYLIST_SONGS = 300;

  var state = null;
  var listeners = [];

  function blank() {
    return { v: VERSION, songs: [], playlists: [] };
  }

  /* A stored song is a stub — id, title, and enough to draw a row. The video
   * itself always comes from YouTube at play time. */
  function toEntry(video) {
    return {
      id: video.id,
      title: video.title || "YouTube video",
      author: video.author || "",
      duration: video.duration || 0,
      thumb: video.thumb || "https://i.ytimg.com/vi/" + video.id + "/mqdefault.jpg",
      savedAt: Date.now()
    };
  }

  function isSong(x) {
    return x && typeof x.id === "string" && /^[A-Za-z0-9_-]{11}$/.test(x.id);
  }

  function load() {
    if (state) return state;
    try {
      var raw = JSON.parse(localStorage.getItem(KEY));
      if (raw && raw.v === VERSION && Array.isArray(raw.songs) && Array.isArray(raw.playlists)) {
        // Trust the shape but not the contents — a hand-edited or truncated
        // store should degrade to "missing entries", never to a broken app.
        state = {
          v: VERSION,
          songs: raw.songs.filter(isSong),
          playlists: raw.playlists
            .filter(function (p) { return p && typeof p.name === "string" && Array.isArray(p.songs); })
            .map(function (p) {
              return {
                pid: p.pid || newId("p"),
                name: String(p.name).slice(0, 60),
                createdAt: p.createdAt || Date.now(),
                updatedAt: p.updatedAt || Date.now(),
                songs: p.songs.filter(isSong)
              };
            })
        };
        return state;
      }
    } catch (e) { /* corrupt or unavailable — start fresh */ }
    state = blank();
    return state;
  }

  function persist() {
    load().updatedAt = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      // Quota, or private mode. The in-memory copy still works for this
      // session; saying so beats silently losing the user's list.
      notify("error", "Could not save to this browser's storage.");
      return false;
    }
    notify("change");
    return true;
  }

  function notify(kind, detail) {
    listeners.forEach(function (fn) {
      try { fn(kind, detail); } catch (e) { console.error("[kn] library listener", e); }
    });
  }

  var counter = 0;
  function newId(prefix) {
    counter++;
    return prefix + Date.now().toString(36) + counter.toString(36);
  }

  /* ---------------- saved songs ---------------- */

  function songs() { return load().songs.slice(); }

  function hasSong(id) {
    return load().songs.some(function (s) { return s.id === id; });
  }

  /** Save a song, or remove it if it is already saved. Returns true if saved. */
  function toggleSong(video) {
    var s = load();
    var i = s.songs.findIndex(function (x) { return x.id === video.id; });
    if (i >= 0) {
      s.songs.splice(i, 1);
      persist();
      return false;
    }
    if (s.songs.length >= MAX_SONGS) {
      notify("error", "Saved songs are full (" + MAX_SONGS + ").");
      return false;
    }
    s.songs.unshift(toEntry(video));
    persist();
    return true;
  }

  function removeSong(id) {
    var s = load();
    var i = s.songs.findIndex(function (x) { return x.id === id; });
    if (i < 0) return false;
    s.songs.splice(i, 1);
    return persist();
  }

  /* ---------------- playlists ---------------- */

  function playlists() { return load().playlists.slice(); }

  function playlist(pid) {
    return load().playlists.find(function (p) { return p.pid === pid; }) || null;
  }

  function createPlaylist(name) {
    var s = load();
    var p = {
      pid: newId("p"),
      name: String(name || "New playlist").trim().slice(0, 60) || "New playlist",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      songs: []
    };
    s.playlists.push(p);
    persist();
    return p;
  }

  function renamePlaylist(pid, name) {
    var p = playlist(pid);
    if (!p) return false;
    p.name = String(name || "").trim().slice(0, 60) || p.name;
    p.updatedAt = Date.now();
    return persist();
  }

  function deletePlaylist(pid) {
    var s = load();
    var i = s.playlists.findIndex(function (p) { return p.pid === pid; });
    if (i < 0) return false;
    s.playlists.splice(i, 1);
    return persist();
  }

  function addToPlaylist(pid, video) {
    var p = playlist(pid);
    if (!p) return false;
    if (p.songs.some(function (x) { return x.id === video.id; })) {
      notify("error", "Already in “" + p.name + "”.");
      return false;
    }
    if (p.songs.length >= MAX_PLAYLIST_SONGS) {
      notify("error", "“" + p.name + "” is full.");
      return false;
    }
    p.songs.push(toEntry(video));
    p.updatedAt = Date.now();
    return persist();
  }

  function removeFromPlaylist(pid, id) {
    var p = playlist(pid);
    if (!p) return false;
    var i = p.songs.findIndex(function (x) { return x.id === id; });
    if (i < 0) return false;
    p.songs.splice(i, 1);
    p.updatedAt = Date.now();
    return persist();
  }

  function moveInPlaylist(pid, id, dir) {
    var p = playlist(pid);
    if (!p) return false;
    var i = p.songs.findIndex(function (x) { return x.id === id; });
    if (i < 0) return false;
    var to = dir === "up" ? i - 1 : i + 1;
    if (to < 0 || to >= p.songs.length) return false;
    var moved = p.songs.splice(i, 1)[0];
    p.songs.splice(to, 0, moved);
    p.updatedAt = Date.now();
    return persist();
  }

  /* ---------------- portability ----------------
   * Local-only storage is one cleared cache away from gone, so the library
   * has to be something you can carry out.
   */
  function exportAll() {
    var s = load();
    return JSON.stringify({ karaokenatin: "library/1", exportedAt: Date.now(), songs: s.songs, playlists: s.playlists }, null, 2);
  }

  /** Merge an exported file in. Returns { songs, playlists } counts added. */
  function importAll(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { throw new Error("That file is not valid JSON."); }
    if (!data || (!Array.isArray(data.songs) && !Array.isArray(data.playlists))) {
      throw new Error("That does not look like a KaraokeNatin library.");
    }
    var s = load();
    var added = { songs: 0, playlists: 0 };

    (data.songs || []).filter(isSong).forEach(function (song) {
      if (s.songs.length >= MAX_SONGS) return;
      if (s.songs.some(function (x) { return x.id === song.id; })) return;
      s.songs.push(toEntry(song));
      added.songs++;
    });

    (data.playlists || []).forEach(function (p) {
      if (!p || typeof p.name !== "string" || !Array.isArray(p.songs)) return;
      // Importing twice should not silently merge into an existing list —
      // name the copy instead and let the user decide what to keep.
      var name = String(p.name).slice(0, 60);
      if (s.playlists.some(function (x) { return x.name === name; })) name = (name + " (imported)").slice(0, 60);
      s.playlists.push({
        pid: newId("p"),
        name: name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        songs: p.songs.filter(isSong).slice(0, MAX_PLAYLIST_SONGS).map(toEntry)
      });
      added.playlists++;
    });

    persist();
    return added;
  }

  function clearAll() {
    state = blank();
    return persist();
  }

  function onChange(fn) { listeners.push(fn); }

  function stats() {
    var s = load();
    return { songs: s.songs.length, playlists: s.playlists.length };
  }

  KN.library = {
    songs: songs,
    hasSong: hasSong,
    toggleSong: toggleSong,
    removeSong: removeSong,
    playlists: playlists,
    playlist: playlist,
    createPlaylist: createPlaylist,
    renamePlaylist: renamePlaylist,
    deletePlaylist: deletePlaylist,
    addToPlaylist: addToPlaylist,
    removeFromPlaylist: removeFromPlaylist,
    moveInPlaylist: moveInPlaylist,
    exportAll: exportAll,
    importAll: importAll,
    clearAll: clearAll,
    onChange: onChange,
    stats: stats,
    MAX_SONGS: MAX_SONGS
  };
})(typeof window !== "undefined" ? window : globalThis);

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
    RESYNC: "RESYNC"
  };

  // host -> guest
  var MSG = {
    WELCOME: "WELCOME",       // { clientId, code }
    STATE: "STATE",           // { rev, state }
    NOTICE: "NOTICE",         // { text, kind }
    BYE: "BYE"                // { reason }
  };

  var QUEUE_LIMIT = 200;

  /* ---------------- state ---------------- */

  function createState(code) {
    return {
      code: code,
      rev: 0,
      now: null,               // song currently loaded, or null
      queue: [],
      guests: [],              // [{ id, name, since }]
      player: { status: "idle", time: 0, duration: 0, volume: 80, muted: false },
      startedAt: Date.now()
    };
  }

  var seq = 0;
  function toSong(video, addedBy) {
    seq++;
    return {
      sid: "s" + Date.now().toString(36) + seq.toString(36),
      id: video.id,
      title: video.title || "YouTube video",
      author: video.author || "",
      duration: video.duration || 0,
      thumb: video.thumb || "https://i.ytimg.com/vi/" + video.id + "/mqdefault.jpg",
      addedBy: addedBy || "someone",
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
        var song = toSong(cmd.video, who);
        state.queue.push(song);
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

  /** Pop the next song into `now`. Returns the song, or null if the queue ran dry. */
  function advance(state) {
    var next = state.queue.shift() || null;
    state.now = next;
    state.player.time = 0;
    state.player.duration = next ? next.duration : 0;
    state.player.status = next ? "loading" : "idle";
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
    createState: createState,
    toSong: toSong,
    apply: apply,
    advance: advance,
    indexOfSid: indexOfSid,
    fmtTime: fmtTime
  };
})(typeof window !== "undefined" ? window : globalThis);

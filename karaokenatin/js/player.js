/* player.js — thin wrapper around the YouTube IFrame API (host only).
 *
 * The guests' phones never load this: only the host screen plays video, which
 * is the whole point of a karaoke room. Everything here is best-effort — if
 * YouTube's API script is blocked we surface that instead of hanging.
 */
(function (global) {
  "use strict";

  var KN = (global.KN = global.KN || {});

  var apiPromise = null;

  function loadApi() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise(function (resolve, reject) {
      if (global.YT && global.YT.Player) return resolve(global.YT);

      var timer = setTimeout(function () {
        reject(new Error("YouTube player could not load (blocked or offline)."));
      }, 15000);

      var prev = global.onYouTubeIframeAPIReady;
      global.onYouTubeIframeAPIReady = function () {
        clearTimeout(timer);
        if (typeof prev === "function") prev();
        resolve(global.YT);
      };

      var s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.onerror = function () {
        clearTimeout(timer);
        reject(new Error("YouTube player could not load (blocked or offline)."));
      };
      document.head.appendChild(s);
    });
    return apiPromise;
  }

  /**
   * create(elementId) -> Promise<player>
   *
   * player: load(id) play() pause() seek(t) volume(v) mute(on)
   *         time() duration() destroy()
   * events: 'ready' 'playing' 'paused' 'ended' 'buffering' 'error' 'meta' 'blocked'
   */
  function create(elementId) {
    var self = {};
    var listeners = {};
    var yt = null;
    var ready = false;
    var wanted = null;      // video id requested before the player was ready
    var wantPlaying = false; // we have asked for playback and not seen it start
    var blockTimer = null;

    self.on = function (name, fn) {
      (listeners[name] = listeners[name] || []).push(fn);
      return self;
    };
    function emit(name, arg) {
      (listeners[name] || []).forEach(function (fn) {
        try { fn(arg); } catch (e) { console.error("[kn] player handler", e); }
      });
    }

    function meta() {
      if (!ready || !yt || !yt.getDuration) return null;
      var d = yt.getVideoData ? yt.getVideoData() : null;
      return {
        duration: Math.round(yt.getDuration() || 0),
        title: d && d.title ? d.title : "",
        author: d && d.author ? d.author : ""
      };
    }

    /* A browser will refuse to start audible video without a recent user
     * gesture, which a Tauri webview never does — this is the one place the
     * web port has to do more than the desktop app. A refusal leaves the
     * player parked in UNSTARTED or CUED, so watch for that and let the UI
     * put up a tap-to-play prompt rather than looking silently broken. */
    function watchForBlock() {
      clearTimeout(blockTimer);
      if (!wantPlaying) return;
      blockTimer = setTimeout(function () {
        if (!wantPlaying || !ready || !yt.getPlayerState) return;
        var s = yt.getPlayerState();
        if (s === -1 || s === 5) emit("blocked");
      }, 2500);
    }

    self.load = function (videoId, startAt) {
      wantPlaying = true;
      if (!ready) { wanted = { id: videoId, at: startAt || 0 }; return; }
      yt.loadVideoById({ videoId: videoId, startSeconds: startAt || 0 });
      watchForBlock();
    };
    self.play = function () {
      wantPlaying = true;
      if (ready && yt.playVideo) yt.playVideo();
      watchForBlock();
    };
    self.pause = function () {
      wantPlaying = false;
      clearTimeout(blockTimer);
      if (ready && yt.pauseVideo) yt.pauseVideo();
    };
    self.stop = function () {
      wantPlaying = false;
      clearTimeout(blockTimer);
      if (ready && yt.stopVideo) yt.stopVideo();
    };
    self.seek = function (t) { if (ready && yt.seekTo) yt.seekTo(Math.max(0, t), true); };
    self.volume = function (v) { if (ready && yt.setVolume) yt.setVolume(Math.max(0, Math.min(100, v))); };
    self.mute = function (on) {
      if (!ready) return;
      if (on) yt.mute(); else yt.unMute();
    };
    self.time = function () { return ready && yt.getCurrentTime ? yt.getCurrentTime() || 0 : 0; };
    self.duration = function () { return ready && yt.getDuration ? yt.getDuration() || 0 : 0; };
    self.meta = meta;
    self.destroy = function () {
      clearTimeout(blockTimer);
      if (yt && yt.destroy) yt.destroy();
      ready = false;
    };

    return loadApi().then(function (YT) {
      return new Promise(function (resolve) {
        yt = new YT.Player(elementId, {
          height: "100%",
          width: "100%",
          // Same configuration as the desktop app: the default youtube.com
          // host, no native chrome (the room supplies its own transport).
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
              ready = true;
              if (wanted) { yt.loadVideoById({ videoId: wanted.id, startSeconds: wanted.at }); wanted = null; watchForBlock(); }
              emit("ready");
              resolve(self);
            },
            onStateChange: function (e) {
              var S = YT.PlayerState;
              if (e.data === S.ENDED) { wantPlaying = false; emit("ended"); }
              else if (e.data === S.PLAYING) {
                wantPlaying = false;
                clearTimeout(blockTimer);
                emit("playing");
                emit("meta", meta());
              } else if (e.data === S.PAUSED) emit("paused");
              else if (e.data === S.BUFFERING) emit("buffering");
              else if (e.data === S.CUED) {
                // loadVideoById can land here instead of playing outright.
                // The desktop app kicks it the same way.
                if (wantPlaying) { yt.playVideo(); watchForBlock(); }
              }
            },
            onError: function (e) {
              // 2 bad id · 5 html5 · 100 gone · 101/150 embedding disabled
              var map = {
                2: "That video id is not valid.",
                5: "This video cannot be played here.",
                100: "That video is unavailable (removed or private).",
                101: "The owner does not allow this video to be embedded.",
                150: "The owner does not allow this video to be embedded."
              };
              emit("error", map[e.data] || "Playback error (" + e.data + ").");
            }
          }
        });
      });
    });
  }

  KN.player = { create: create };
})(typeof window !== "undefined" ? window : globalThis);

/* player.js — thin wrapper around the YouTube IFrame API.
 *
 * Only the host screen creates a *playing* player, which is the whole point of
 * a karaoke room. A guest's phone still loads the API, because embed.js probes
 * search results through the same one — see there for why that is the only
 * honest way to ask whether a video will play. Everything here is best-effort:
 * if YouTube's API cannot be reached we say which hop failed, and we stay
 * retryable, instead of hanging or condemning the page for the rest of its
 * life on one bad moment.
 */
(function (global) {
  "use strict";

  var KN = (global.KN = global.KN || {});

  /* The API arrives in two hops: this script, and the widget bundle it then
   * pulls from s.ytimg.com. Either can be stopped independently — a content
   * blocker, a VPN or DNS filter, a captive portal — and the two failures need
   * different words, because "blocked or offline" sent everyone to look at
   * their wifi when the answer was an extension.
   *
   * The budget is spent in foreground time only. iOS suspends a backgrounded
   * page wholesale: locking the phone or switching apps to send someone the
   * join link froze the load and left a wall-clock timer running against it,
   * so a perfectly healthy player came back declared dead. Time in a pocket is
   * not time the network had.
   */
  var LOAD_BUDGET_MS = 20000;
  var TICK_MS = 500;

  var apiPromise = null;
  var script = null;      // the one injection; reused across retries
  var scriptState = "none"; // none | pending | loaded | error

  function apiReady() {
    return !!(global.YT && typeof global.YT.Player === "function");
  }

  function inject() {
    if (script && scriptState !== "error") return;
    scriptState = "pending";
    script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onload = function () { if (scriptState === "pending") scriptState = "loaded"; };
    script.onerror = function () { scriptState = "error"; };
    document.head.appendChild(script);
  }

  /* Why we gave up, in the words of whichever hop actually failed. */
  function reason() {
    if (scriptState === "error") {
      return "YouTube's player script was refused (https://www.youtube.com/iframe_api). " +
             "A content blocker, VPN or filtered network is the usual cause.";
    }
    if (scriptState === "loaded") {
      return "YouTube's player script loaded but never finished starting up — " +
             "something is blocking its second file from s.ytimg.com. " +
             "Turn off content blockers for this site and reload.";
    }
    return "YouTube's player did not load in time. Check the connection and try again.";
  }

  /**
   * loadApi() -> Promise<YT>
   *
   * Memoised while it is pending or resolved, and deliberately *not* memoised
   * once it has failed: the old version cached the rejection, so one bad
   * moment on mobile data disabled playback and the embeddability probes for
   * the life of the page, with a reload the only cure.
   */
  function loadApi() {
    if (apiReady()) return Promise.resolve(global.YT);
    if (apiPromise) return apiPromise;

    apiPromise = new Promise(function (resolve, reject) {
      var waited = 0;
      var tick = null;
      var settled = false;

      function stop() { settled = true; clearInterval(tick); }

      /* YouTube calls this once, globally. Anything already installed keeps
       * working: the API is a singleton and we may not be its only caller. */
      var prev = global.onYouTubeIframeAPIReady;
      global.onYouTubeIframeAPIReady = function () {
        if (typeof prev === "function") { try { prev(); } catch (e) { console.error("[kn] yt ready hook", e); } }
        if (settled) return;
        stop();
        resolve(global.YT);
      };

      /* One timer does both jobs. The poll matters as much as the budget: if
       * the API is already on the page — a second injection, a callback that
       * fired before we hooked it — no callback is coming, and waiting for one
       * is a hang with a 20-second fuse. */
      tick = setInterval(function () {
        if (settled) return;
        if (apiReady()) { stop(); resolve(global.YT); return; }
        if (document.hidden) return;
        waited += TICK_MS;
        if (scriptState === "error" || waited >= LOAD_BUDGET_MS) {
          stop();
          apiPromise = null;
          var err = new Error(reason());
          err.stage = scriptState;
          console.warn("[kn] youtube api unavailable:", scriptState, err.message);
          reject(err);
        }
      }, TICK_MS);

      inject();
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

  /* Exported so the embeddability probes in embed.js share this one script
   * load and this one memoised promise — the API is a singleton on the page,
   * and a second injection would race the first. */
  KN.player = { create: create, loadApi: loadApi };
})(typeof window !== "undefined" ? window : globalThis);

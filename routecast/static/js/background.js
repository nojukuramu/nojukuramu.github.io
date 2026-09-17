/* ============================================================
   RouteCast — staying alive with the screen off

   A ride does not stop because the phone went in a pocket. It used to here:
   the tab was backgrounded, timers were throttled to one tick a minute, the
   wake lock was taken away, and a rider who pulled the phone out at the next
   junction found a dashboard that had quietly lost ten kilometres.

   This module is the one place that fights that, so no other module has to
   half-fight it. Nav, free drive and the group room all just take a hold on
   it for as long as their session lasts:

       RC.background.hold("free");     // ...ride...
       RC.background.release("free");

   Holds are counted, not boolean, so navigation inside a group ride does not
   have two owners disagreeing about whether the phone is allowed to sleep.

   What a web page can actually do about it
   ----------------------------------------
   Honestly: three things, and they are worth knowing apart, because the first
   is famous, the second is what actually works, and the third is what
   everybody assumes is happening and is not.

   1. **The screen wake lock.** Keeps the display on while the page is
      visible — a phone on a handlebar mount that never dims. It is released
      by the browser every time the page is hidden and is NOT restored on the
      way back, which is the bug behind "it worked until I took a call". So it
      is re-taken on every return to visibility, here, once, for everybody.

   2. **A silent audio loop.** This is the load-bearing one. A page that is
      playing audio is a page the browser will not freeze: timers keep firing,
      `watchPosition` keeps delivering, and the tab survives being backgrounded
      on both Android and iOS. So while a ride is running, a track of pure
      digital silence is played on loop. It is inaudible, it does not duck
      music or a phone call (it is tagged as such), and it costs a fraction of
      a percent of a CPU. Autoplay rules mean it can only START from a user
      gesture — which is exactly what tapping Go or Free drive is, so the hold
      is taken on the tap and the silence starts inside it.

   3. **A worker heartbeat.** `setTimeout` in a hidden page is clamped to once
      a minute; the same timer inside a Web Worker is not clamped nearly as
      hard. So the periodic work a hidden ride still needs — flushing recorded
      roads, noticing a position watch that has died — is driven from a worker
      rather than from the page. The worker is built from a blob, because this
      app ships as static files and a separate worker file is another request
      and another thing to keep in the service worker's shell.

   What it deliberately does NOT claim
   -----------------------------------
   There is no way for a web page to keep running after the BROWSER is killed,
   or after iOS suspends the whole app. Nothing here pretends otherwise: when
   the page is frozen anyway, the wake-up path is what matters, so every
   return from hidden re-establishes the truth — re-take the lock, restart the
   silence, re-check the geolocation watch, and tell whoever is holding how
   long they were away for.
   ============================================================ */
var RC = RC || {};

RC.background = (function (global) {
  "use strict";

  var HEARTBEAT_MS = 5000;
  // A gap between heartbeats longer than this means the page was frozen or the
  // machine slept, rather than merely throttled.
  var FREEZE_GAP_MS = 45000;

  var holds = {};           // reason -> count
  var total = 0;
  var enabled = true;       // the rider's own switch

  var wakeLock = null;
  var wakeLockBusy = false;

  var audioEl = null;
  var audioCtx = null;
  var silenceNode = null;

  var worker = null;
  var fallbackTimer = null;
  var lastBeatTs = 0;
  var hiddenSince = 0;

  var listeners = [];       // {ev, fn} — the module owns its own teardown

  function fire(name, detail) {
    for (var i = 0; i < listeners.length; i++) {
      if (listeners[i].ev !== name) continue;
      try { listeners[i].fn(detail); } catch (e) {}
    }
  }

  function hidden() {
    try { return document.visibilityState === "hidden"; } catch (e) { return false; }
  }

  function active() { return total > 0 && enabled; }

  /* ---------------------------------------------------------
     1. The screen wake lock
     --------------------------------------------------------- */
  function takeWakeLock() {
    if (!active() || wakeLock || wakeLockBusy || hidden()) return;
    var wl = global.navigator && navigator.wakeLock;
    if (!wl || !wl.request) return;
    wakeLockBusy = true;
    try {
      wl.request("screen").then(function (lock) {
        wakeLockBusy = false;
        if (!active()) { try { lock.release(); } catch (e) {} return; }
        wakeLock = lock;
        // The browser drops it on its own terms — a hidden page, a call, a
        // low battery. Noticing is how it comes back.
        try {
          lock.addEventListener("release", function () {
            if (wakeLock === lock) wakeLock = null;
          });
        } catch (e) {}
      }, function () { wakeLockBusy = false; });
    } catch (e) { wakeLockBusy = false; }
  }

  function dropWakeLock() {
    if (!wakeLock) return;
    try { wakeLock.release(); } catch (e) {}
    wakeLock = null;
  }

  /* ---------------------------------------------------------
     2. The silence

     Two paths, because the two platforms fail differently. An <audio> element
     looping a tiny silent WAV is what keeps an Android tab out of the freezer;
     a zero-gain oscillator in a running AudioContext is what iOS counts as
     "this page is playing something". Running both costs nothing measurable
     and means neither platform is relying on the other's trick.
     --------------------------------------------------------- */

  /* 0.5 s of 8 kHz mono silence, built rather than pasted: a base64 blob
     nobody can read is a thing nobody can check. */
  function silentWavUrl() {
    var rate = 8000, seconds = 0.5;
    var samples = Math.floor(rate * seconds);
    var bytes = 44 + samples;
    var buf = new ArrayBuffer(bytes);
    var view = new DataView(buf);
    function str(off, s) { for (var i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }
    str(0, "RIFF");
    view.setUint32(4, bytes - 8, true);
    str(8, "WAVEfmt ");
    view.setUint32(16, 16, true);        // PCM header size
    view.setUint16(20, 1, true);         // PCM
    view.setUint16(22, 1, true);         // mono
    view.setUint32(24, rate, true);
    view.setUint32(28, rate, true);      // byte rate (8-bit mono)
    view.setUint16(32, 1, true);         // block align
    view.setUint16(34, 8, true);         // bits per sample
    str(36, "data");
    view.setUint32(40, samples, true);
    // 8-bit PCM silence is 128, not 0; zeros here would be a DC offset, which
    // is a click on some hardware and not silence at all.
    for (var i = 0; i < samples; i++) view.setUint8(44 + i, 128);
    try {
      return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
    } catch (e) { return null; }
  }

  function startSilence() {
    if (!active()) return;

    if (!audioEl) {
      var url = silentWavUrl();
      if (url) {
        try {
          audioEl = new Audio(url);
          audioEl.loop = true;
          audioEl.volume = 0;
          audioEl.preload = "auto";
          // Nothing about this is media the system should treat as media: no
          // lock-screen controls, no ducking of the rider's own music, no
          // stealing of a Bluetooth headset's A2DP profile mid-podcast.
          try { audioEl.disableRemotePlayback = true; } catch (e) {}
          audioEl.setAttribute("playsinline", "");
        } catch (e) { audioEl = null; }
      }
    }
    if (audioEl && audioEl.paused) {
      var p = audioEl.play();
      if (p && p.catch) p.catch(function () { /* needs a gesture; the next hold has one */ });
    }

    if (!audioCtx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (AC) {
        try {
          audioCtx = new AC();
          var osc = audioCtx.createOscillator();
          var gain = audioCtx.createGain();
          gain.gain.value = 0;
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start();
          silenceNode = osc;
        } catch (e) { audioCtx = null; silenceNode = null; }
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      try { audioCtx.resume(); } catch (e) {}
    }
  }

  function stopSilence() {
    if (audioEl) {
      try { audioEl.pause(); } catch (e) {}
    }
    if (silenceNode) {
      try { silenceNode.stop(); } catch (e) {}
      try { silenceNode.disconnect(); } catch (e) {}
      silenceNode = null;
    }
    if (audioCtx) {
      try { audioCtx.close(); } catch (e) {}
      audioCtx = null;
    }
  }

  /* ---------------------------------------------------------
     3. The heartbeat
     --------------------------------------------------------- */
  function onBeat() {
    var t = Date.now();
    var gap = lastBeatTs ? t - lastBeatTs : 0;
    lastBeatTs = t;

    // Recorded roads are flushed on a 20 s debounce inside RC.history, which
    // is a timer in the page and therefore the first casualty of a hidden
    // tab. Flushing from the heartbeat is what makes a ride that ended with
    // the phone in a pocket still be a ride that was written down.
    if (RC.history && RC.history.flush) {
      try { RC.history.flush(); } catch (e) {}
    }

    fire("beat", { gap: gap, hidden: hidden() });
    if (gap > FREEZE_GAP_MS) fire("thaw", { gap: gap });
  }

  function startHeartbeat() {
    if (worker || fallbackTimer) return;
    lastBeatTs = Date.now();
    var src = "var t=null;onmessage=function(e){" +
      "if(e.data&&e.data.ms){clearInterval(t);t=setInterval(function(){postMessage(1);},e.data.ms);}" +
      "else{clearInterval(t);t=null;}};";
    try {
      var url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      worker = new Worker(url);
      URL.revokeObjectURL(url);
      worker.onmessage = onBeat;
      worker.postMessage({ ms: HEARTBEAT_MS });
    } catch (e) {
      // No workers (a locked-down CSP, an ancient browser): a page timer is
      // throttled while hidden but it is not nothing.
      worker = null;
      fallbackTimer = setInterval(onBeat, HEARTBEAT_MS);
    }
  }

  function stopHeartbeat() {
    if (worker) {
      try { worker.postMessage({ stop: true }); worker.terminate(); } catch (e) {}
      worker = null;
    }
    if (fallbackTimer) { clearInterval(fallbackTimer); fallbackTimer = null; }
    lastBeatTs = 0;
  }

  /* ---------------------------------------------------------
     Visibility — the moment everything has to be re-established
     --------------------------------------------------------- */
  function onVisibility() {
    if (hidden()) {
      hiddenSince = Date.now();
      // The lock is gone whether we release it or not; dropping our reference
      // keeps takeWakeLock() from believing it still holds one.
      wakeLock = null;
      if (RC.history && RC.history.flush) { try { RC.history.flush(); } catch (e) {} }
      fire("hide", {});
      return;
    }
    var away = hiddenSince ? Date.now() - hiddenSince : 0;
    hiddenSince = 0;
    if (!active()) return;
    takeWakeLock();
    startSilence();
    fire("show", { awayMs: away });
  }

  function onPageShow(e) {
    // A bfcache restore is not a visibilitychange on every browser, and it is
    // the one wake-up where absolutely nothing survived.
    if (e && e.persisted && active()) {
      takeWakeLock();
      startSilence();
      fire("show", { awayMs: 0, restored: true });
    }
  }

  function attach() {
    if (listeners.attached) return;
    listeners.attached = true;
    try {
      document.addEventListener("visibilitychange", onVisibility);
      global.addEventListener("pageshow", onPageShow);
      global.addEventListener("resume", function () { if (active()) { takeWakeLock(); startSilence(); } });
      // Any tap is a fresh gesture, and a fresh gesture is another chance for
      // the silence to start if autoplay refused it the first time.
      ["pointerdown", "touchend", "keydown"].forEach(function (ev) {
        global.addEventListener(ev, function () { if (active()) startSilence(); }, true);
      });
    } catch (e) {}
  }

  /* ---------------------------------------------------------
     Public
     --------------------------------------------------------- */
  function engage() {
    attach();
    takeWakeLock();
    startSilence();
    startHeartbeat();
  }

  function disengage() {
    dropWakeLock();
    stopSilence();
    stopHeartbeat();
  }

  var api = {
    /** Take a hold for as long as a session lasts. Call it from inside the tap
        that starts the ride: that gesture is what buys the silent track its
        permission to play, and without it the page is freezable again. */
    hold: function (reason) {
      reason = String(reason || "ride");
      holds[reason] = (holds[reason] || 0) + 1;
      total++;
      if (total === 1) engage();
      return true;
    },

    release: function (reason) {
      reason = String(reason || "ride");
      if (!holds[reason]) return false;
      holds[reason]--;
      if (!holds[reason]) delete holds[reason];
      total = Math.max(0, total - 1);
      if (total === 0) disengage();
      return true;
    },

    /** Drop everything — used when a ride ends abnormally and nobody is quite
        sure who still thinks they are holding. */
    releaseAll: function () {
      holds = {};
      total = 0;
      disengage();
    },

    held: function () { return total > 0; },
    heldBy: function () { return Object.keys(holds); },

    /** The rider's switch. Off means the app behaves exactly as it did before
        any of this existed: the screen is allowed to sleep and the page is
        allowed to be frozen. It is remembered, and it is honest — turning it
        off mid-ride stops everything immediately rather than at the next one. */
    setEnabled: function (on) {
      on = !!on;
      if (enabled === on) return on;
      enabled = on;
      RC.store.set("background", on);
      if (active()) engage(); else disengage();
      fire("enabled", { enabled: enabled });
      return enabled;
    },

    isEnabled: function () { return enabled; },

    /** Is the phone actually being kept awake right now, as opposed to merely
        asked to be? The wake lock is the honest part of that: everything else
        is best-effort and silent about failing. */
    isAwake: function () { return !!wakeLock; },

    supported: function () {
      return !!(global.navigator && navigator.wakeLock && navigator.wakeLock.request);
    },

    /** Events: "beat" (the heartbeat, with the gap since the last one),
        "thaw" (that gap was long enough to mean the page was frozen),
        "hide", "show" ({awayMs}), "enabled". */
    on: function (ev, fn) {
      listeners.push({ ev: ev, fn: fn });
      return function () {
        for (var i = 0; i < listeners.length; i++) {
          if (listeners[i].fn === fn && listeners[i].ev === ev) { listeners.splice(i, 1); return; }
        }
      };
    }
  };

  try { enabled = RC.store.get("background", true) !== false; } catch (e) {}
  attach();

  return api;
})(typeof window !== "undefined" ? window : globalThis);

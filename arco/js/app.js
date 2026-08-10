/* ARCO — app.js
 * Wiring: toolbar, settings, the practice trainer, and the frame loop.
 */
window.ARCO = window.ARCO || {};
(function (A) {
  "use strict";

  var T = A.theory;
  var S = null;
  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------------ songs */
  /* Stored as scale degrees, never as notes. That is the entire point: the same
   * sequence is playable in all twelve keys without changing one finger motion.
   *   '  = up an octave      ,  = down an octave      b / # = accidental
   */
  var SONGS = [
    { name: "Twinkle, Twinkle",  mode: "major", seq: "1 1 5 5 6 6 5  4 4 3 3 2 2 1" },
    { name: "Ode to Joy",        mode: "major", seq: "3 3 4 5 5 4 3 2 1 1 2 3 3 2 2" },
    { name: "Happy Birthday",    mode: "major", seq: "5 5 6 5 1' 7  5 5 6 5 2' 1'" },
    { name: "Amazing Grace",     mode: "major", seq: "5, 1 3 1 3 2 1 6, 5," },
    { name: "Scarborough Fair",  mode: "dorian", seq: "1 1 5 5 6 5 4 3 1" },
    { name: "I–V–vi–IV loop",    mode: "major", seq: "1, 5, 6, 4," }
  ];

  function parseSeq(str, mode) {
    var scale = T.scaleOf(mode);
    return str.trim().split(/\s+/).map(function (tok) {
      var ring = 1, acc = 0, i = 0;
      while (i < tok.length && (tok[i] === "b" || tok[i] === "#")) {
        acc += tok[i] === "b" ? -1 : 1;
        i++;
      }
      var d = parseInt(tok[i], 10);
      i++;
      for (; i < tok.length; i++) {
        if (tok[i] === "'") ring++;
        else if (tok[i] === ",") ring--;
      }
      var o = scale[(d - 1) % scale.length] + acc;
      while (o < 0) { o += 12; ring--; }
      while (o > 11) { o -= 12; ring++; }
      return { offset: o, ring: Math.max(0, Math.min(2, ring)) };
    });
  }

  var trainer = { on: false, song: null, seq: [], i: 0, last: 0, done: false };

  function trainerTarget() {
    if (!trainer.on || trainer.done) return null;
    return trainer.seq[trainer.i] || null;
  }

  function startSong(idx) {
    var s = SONGS[idx];
    trainer.song = s;
    trainer.seq = parseSeq(s.seq, s.mode);
    trainer.i = 0;
    trainer.done = false;
    trainer.on = true;
    S.mode = s.mode;
    A.input.rebuildZones();
    $("modeSel").value = s.mode;
    $("trainer").hidden = false;
    renderTrainer();
    syncHud();
  }

  function stopTrainer() {
    trainer.on = false;
    $("trainer").hidden = true;
  }

  function renderTrainer() {
    var row = $("trainerRow");
    row.innerHTML = "";
    var from = Math.max(0, trainer.i - 1);
    for (var k = from; k < Math.min(trainer.seq.length, from + 12); k++) {
      var n = trainer.seq[k];
      var el = document.createElement("span");
      el.className = "chip" + (k === trainer.i ? " now" : k < trainer.i ? " done" : "");
      el.textContent = T.solfege(n.offset) + (n.ring > 1 ? "▲" : n.ring < 1 ? "▼" : "");
      row.appendChild(el);
    }
    $("trainerName").textContent = trainer.done
      ? "✓ " + trainer.song.name + " — in " + T.keyName(S.key)
      : trainer.song.name;
    $("trainerHint").textContent = trainer.done
      ? "Now change the key. The shapes do not move."
      : (trainer.i + 1) + " / " + trainer.seq.length;
  }

  function trainerCheck(now) {
    if (!trainer.on || trainer.done) return;
    var tgt = trainer.seq[trainer.i];
    var live = S.left;
    if (!live || live.offset !== tgt.offset || live.ring !== tgt.ring) return;
    var ring = S.ringVis[0] + S.ringVis[1] + S.ringVis[2] + S.ringVis[3];
    if (ring < 0.14) return;
    if (now - trainer.last < 200) return;
    trainer.last = now;
    trainer.i++;
    if (trainer.i >= trainer.seq.length) {
      trainer.done = true;
      trainer.i = trainer.seq.length - 1;
    }
    renderTrainer();
  }

  /* -------------------------------------------------------------------- hud */

  function syncHud() {
    $("keyName").textContent = T.keyName(S.key);
    $("modeSel").value = S.mode;
    $("btn7th").classList.toggle("on", S.sevenths);
    $("btnLatch").classList.toggle("on", S.latch);
    $("btnLock").classList.toggle("on", S.lock);
    $("btnLock").textContent = S.lock ? "diatonic" : "chromatic";
    $("btnMotion").classList.toggle("on", S.motion);
    var g = $("btnGuitar"), v = $("btnViolin");
    g.classList.toggle("on", S.instrument === "guitar");
    v.classList.toggle("on", S.instrument === "violin");
    document.body.dataset.inst = S.instrument;
    $("octVal").textContent = S.octave;
    var rs = $("reachSel");
    if (rs) rs.value = String(S.reach);
  }

  function setKey(k) {
    S.key = ((k % 12) + 12) % 12;
    syncHud();
    if (trainer.on) renderTrainer();
  }

  function setInstrument(name) {
    S.instrument = name;
    A.engine.setInstrument(name);
    A.input.silenceBows();
    syncHud();
  }

  /* ------------------------------------------------------------------ loop */

  var last = 0;
  function frame(ts) {
    var dt = Math.min(0.05, Math.max(0.001, (ts - last) / 1000));
    last = ts;
    A.input.tick(dt);
    A.render.draw();
    trainerCheck(ts);
    requestAnimationFrame(frame);
  }

  /* --------------------------------------------------------------- overlays */

  function checkOrientation() {
    var portrait = window.innerHeight > window.innerWidth;
    $("rotate").hidden = !portrait;
  }

  var wakeLock = null;
  function keepAwake() {
    if (!navigator.wakeLock) return;
    navigator.wakeLock.request("screen").then(function (w) {
      wakeLock = w;
      w.addEventListener("release", function () { wakeLock = null; });
    }).catch(function () { /* not fatal */ });
  }

  function begin() {
    var btn = $("startBtn");
    btn.disabled = true;
    btn.textContent = "tuning…";
    A.engine.init().then(function () {
      return A.engine.resume();
    }).then(function () {
      A.engine.setInstrument(S.instrument);
      $("start").hidden = true;
      keepAwake();
      checkOrientation();
      A.render.resize();
      requestAnimationFrame(function (t) { last = t; frame(t); });
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = "try again";
      $("startErr").textContent = err && err.message ? err.message : String(err);
      $("startErr").hidden = false;
    });
  }

  /* ------------------------------------------------------------------ init */

  function init() {
    S = A.input.state;
    var cv = $("stage");
    A.render.init(cv);
    A.input.attach(cv);

    /* Populate selects */
    var ms = $("modeSel");
    T.MODE_ORDER.forEach(function (m) {
      var o = document.createElement("option");
      o.value = m;
      o.textContent = T.MODES[m].label;
      ms.appendChild(o);
    });
    var ss = $("songSel");
    SONGS.forEach(function (s, i) {
      var o = document.createElement("option");
      o.value = String(i);
      o.textContent = s.name;
      ss.appendChild(o);
    });

    $("startBtn").addEventListener("click", begin);

    $("keyDown").addEventListener("click", function () { setKey(S.key - 1); });
    $("keyUp").addEventListener("click", function () { setKey(S.key + 1); });
    $("keyName").addEventListener("click", function () { setKey(S.key + 7); });   // circle of fifths

    ms.addEventListener("change", function () {
      S.mode = ms.value;
      A.input.rebuildZones();
      syncHud();
    });

    $("btnGuitar").addEventListener("click", function () { setInstrument("guitar"); });
    $("btnViolin").addEventListener("click", function () { setInstrument("violin"); });

    $("btn7th").addEventListener("click", function () { S.sevenths = !S.sevenths; syncHud(); });

    $("btnLatch").addEventListener("click", function () {
      S.latch = !S.latch;
      if (S.latch) {
        S.latched = S.left ? { offset: S.left.offset, ring: S.left.ring } : { offset: 0, ring: 0 };
      } else {
        S.latched = null;
      }
      syncHud();
    });

    /* While latch is on, a fresh press of the stopping thumb re-voices the held
     * chord — so the left thumb can both comp and carry the tune. */
    A.input.on(function (ev) {
      if (ev === "input" && S.latch && S.left) {
        if (!S.latched || S.latched.offset !== S.left.offset || S.latched.ring !== S.left.ring) {
          if (S.right) S.latched = { offset: S.left.offset, ring: S.left.ring };
        }
      }
    });

    $("btnLock").addEventListener("click", function () {
      S.lock = !S.lock;
      A.input.rebuildZones();
      syncHud();
    });

    $("btnMotion").addEventListener("click", function () {
      if (S.motion) {
        A.input.disableMotion();
      } else {
        A.input.enableMotion().then(function (ok) {
          if (!ok) $("motionNote").hidden = false;
          syncHud();
        });
      }
      syncHud();
    });

    $("btnSettings").addEventListener("click", function () { $("settings").hidden = false; });
    $("settingsClose").addEventListener("click", function () { $("settings").hidden = true; });
    $("settings").addEventListener("click", function (e) {
      if (e.target === $("settings")) $("settings").hidden = true;
    });

    $("reachSel").addEventListener("change", function () {
      S.reach = parseFloat(this.value);
      A.render.resize();
    });
    $("octDown").addEventListener("click", function () {
      S.octave = Math.max(1, S.octave - 1); syncHud();
    });
    $("octUp").addEventListener("click", function () {
      S.octave = Math.min(5, S.octave + 1); syncHud();
    });
    $("btnCalibrate").addEventListener("click", function () {
      A.input.calibrate();
      var b = this;
      b.textContent = "zeroed ✓";
      setTimeout(function () { b.textContent = "Set neutral pose"; }, 1200);
    });

    $("btnLearn").addEventListener("click", function () {
      if (trainer.on) { stopTrainer(); }
      else { startSong(parseInt($("songSel").value, 10) || 0); }
      $("btnLearn").classList.toggle("on", trainer.on);
    });
    $("songSel").addEventListener("change", function () {
      if (trainer.on) startSong(parseInt(this.value, 10));
    });
    $("trainerClose").addEventListener("click", function () {
      stopTrainer();
      $("btnLearn").classList.remove("on");
    });
    $("trainerKey").addEventListener("click", function () {
      /* Prove the point: jump to a random new key mid-song. */
      var k;
      do { k = Math.floor(Math.random() * 12); } while (k === S.key);
      setKey(k);
      trainer.i = 0;
      trainer.done = false;
      renderTrainer();
    });

    window.addEventListener("resize", checkOrientation);
    window.addEventListener("orientationchange", function () { setTimeout(checkOrientation, 250); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && $("start").hidden) keepAwake();
    });

    /* Drop focus after a tap so the space bar keeps strumming instead of
     * re-triggering whichever toolbar button was touched last. Keyboard
     * activation is untouched, so tab-navigation still shows a focus ring. */
    document.addEventListener("pointerup", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("button") : null;
      if (b) b.blur();
    });

    /* Stop the page itself from scrolling or zooming under the thumbs. */
    document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
    document.addEventListener("touchmove", function (e) {
      if (e.target === cv) e.preventDefault();
    }, { passive: false });

    checkOrientation();
    syncHud();
  }

  A.app = { init: init, trainerTarget: trainerTarget, SONGS: SONGS };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window.ARCO);

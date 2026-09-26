/* ARCO — app.js
 * Wiring: toolbar, Setup, the practice trainer, updates, and the frame loop.
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

  /* A degree and ring as a real pitch on the neck: ring 1 sits around the
   * middle of a guitar, and anything under the lowest open string comes up an
   * octave rather than asking for a note the neck does not have. */
  function targetMidi(t) {
    var m = 36 + S.key + t.offset + 12 * t.ring;
    var low = A.neck.tuning()[0];
    while (m < low) m += 12;
    return m;
  }

  function startSong(idx) {
    var s = SONGS[idx];
    trainer.song = s;
    trainer.seq = parseSeq(s.seq, s.mode);
    trainer.i = 0;
    trainer.done = false;
    trainer.on = true;
    /* Only notes played from now on count toward the first target. */
    trainer.last = performance.now();
    S.mode = s.mode;
    A.input.rebuildZones();
    $("modeSel").value = s.mode;
    var wasHidden = $("trainer").hidden;
    $("trainer").hidden = false;
    renderTrainer();
    syncHud();
    /* The strip sits over the top of the neck, so the neck steps down out
     * of its way while it is up. */
    if (wasHidden) A.render.resize();
  }

  function stopTrainer() {
    trainer.on = false;
    $("trainer").hidden = true;
    A.render.resize();
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
      ? trainer.song.name + " — done, in " + T.keyName(S.key)
      : trainer.song.name;
    $("trainerHint").textContent = trainer.done
      ? (S.layout === "neck" ? "Now change the key, and find it again." : "Now change the key. The shapes do not move.")
      : (trainer.i + 1) + " / " + trainer.seq.length;
  }

  function advance(now) {
    trainer.last = now;
    trainer.i++;
    if (trainer.i >= trainer.seq.length) {
      trainer.done = true;
      trainer.i = trainer.seq.length - 1;
    }
    renderTrainer();
  }

  function trainerCheck(now) {
    if (!trainer.on || trainer.done) return;
    var tgt = trainer.seq[trainer.i];
    if (S.layout === "neck") {
      /* Any octave counts: the targets pulse at the right pitch, but a melody
       * found an octave up is still the melody found. A note has to be played
       * after the last one was taken, so repeated notes need repeated picks. */
      var ln = A.neck.lastNote();
      if (ln.t <= trainer.last || ln.midi < 0) return;
      if (((ln.midi - targetMidi(tgt)) % 12 + 12) % 12 !== 0) return;
      advance(ln.t);
      return;
    }
    var live = S.left;
    if (!live || live.offset !== tgt.offset || live.ring !== tgt.ring) return;
    var ring = S.ringVis[0] + S.ringVis[1] + S.ringVis[2] + S.ringVis[3];
    if (ring < 0.14) return;
    if (now - trainer.last < 200) return;
    advance(now);
  }

  /* ------------------------------------------------------------- settings */

  /* Remembered per phone, so the tuning and hand someone set up are there
   * the next time. A convenience, not state anything depends on: storage can
   * be missing or refused, and every read falls back to the default. */
  var SAVED = ["layout", "tuning", "frets", "pos", "lefty", "lowTop", "tap", "shape", "scaleDots",
    "instrument", "key", "mode", "sevenths", "lock", "invert", "reach", "octave"];
  var STORE = "arco.settings.v1";

  function load() {
    var o = null;
    try { o = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { o = null; }
    if (!o || typeof o !== "object") return;
    SAVED.forEach(function (k) {
      if (o[k] !== undefined && typeof o[k] === typeof S[k]) S[k] = o[k];
    });
    if (!A.neck.TUNINGS[S.tuning]) S.tuning = "standard";
    if (!T.MODES[S.mode]) S.mode = "major";
    if (A.neck.SHAPES.indexOf(S.shape) < 0) S.shape = "note";
    if ([5, 7, 9, 12].indexOf(S.frets) < 0) S.frets = 7;
    if (S.instrument !== "violin") S.instrument = "guitar";
    if (S.layout !== "arc") S.layout = "neck";
  }

  function save() {
    var o = {};
    SAVED.forEach(function (k) { o[k] = S[k]; });
    try { localStorage.setItem(STORE, JSON.stringify(o)); } catch (e) { /* private mode */ }
  }

  /* -------------------------------------------------------------------- hud */

  function syncHud() {
    var body = document.body;
    body.dataset.layout = S.layout;
    body.dataset.shape = S.shape;
    $("layNeck").classList.toggle("on", S.layout === "neck");
    $("layArc").classList.toggle("on", S.layout === "arc");
    var segs = $("shapeSeg").querySelectorAll("[data-shape]");
    for (var i = 0; i < segs.length; i++) segs[i].classList.toggle("on", segs[i].dataset.shape === S.shape);
    $("btnTap").classList.toggle("on", S.tap);
    $("tuneSel").value = S.tuning;
    $("fretSel").value = String(S.frets);
    $("setView").textContent = S.lowTop ? "Low E on top" : "Low E at the bottom";
    $("setHand").textContent = S.lefty ? "Left-handed" : "Right-handed";
    $("setDots").textContent = S.scaleDots ? "Shown" : "Hidden";
    $("setGuitar").classList.toggle("on", S.instrument === "guitar");
    $("setViolin").classList.toggle("on", S.instrument === "violin");

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
    $("setInvert").textContent = S.invert ? "Bass nearest" : "Melody nearest";
    var rs = $("reachSel");
    if (rs) rs.value = String(S.reach);
    save();
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
    A.neck.silenceBows();
    syncHud();
  }

  function setLayout(name) {
    if (name === S.layout) return;
    A.input.setLayout(name);
    syncHud();
    A.render.resize();
    if (trainer.on) renderTrainer();
  }

  /* --------------------------------------------------------------- version */

  function renderVersion() {
    var st = A.update.state();
    $("versionNote").textContent = "Version " + st.version + (st.ready ? " — newer ready" : "");
    $("versionCheck").textContent = st.ready ? "Reload to update" : "Check for updates";
  }

  function checkVersion() {
    var b = $("versionCheck");
    if (A.update.isReady()) { A.update.apply(); return; }
    b.textContent = "Checking…";
    b.disabled = true;
    A.update.check().then(function (r) {
      b.disabled = false;
      if (r === "ready") { renderVersion(); return; }
      b.textContent = r === "downloading" ? "Downloading…"
        : r === "offline" ? "Offline — try later"
        : r === "unsupported" ? "Reload the page instead"
        : "Up to date";
      setTimeout(renderVersion, 2600);
    });
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

  /* ------------------------------------------------------- fullscreen / install */

  function syncShell(st) {
    st = st || A.shell.status();

    var fs = $("btnFull");
    fs.hidden = !st.canFullscreen;
    fs.classList.toggle("on", st.fullscreen);
    fs.title = st.fullscreen ? "Leave fullscreen" : "Fullscreen";
    $("rowFull").hidden = !st.canFullscreen;
    $("setFull").textContent = st.fullscreen ? "Leave fullscreen" : "Go fullscreen";

    /* Only offer installing when the browser has actually said it is possible.
     * iPhone never fires that event and has no Fullscreen API either, so it
     * gets the manual Add-to-Home-Screen line instead of a dead button. */
    var canInstall = st.installable && !st.installed;
    var iosHint = st.ios && !st.installed && !st.canFullscreen;
    $("startInstall").hidden = !canInstall;
    $("rowInstall").hidden = !canInstall;
    $("startIosNote").hidden = !iosHint;
  }

  function doInstall() {
    A.shell.install().then(function () { syncShell(); });
  }

  function toggleFull() {
    A.shell.toggleFullscreen().then(function (st) { syncShell(st); });
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
      A.engine.setSpread(S.layout === "neck" ? 6 : 4);
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
    A.neck.init();
    load();
    document.body.dataset.layout = S.layout;
    document.body.dataset.inst = S.instrument;
    var cv = $("stage");
    A.render.init(cv);
    A.input.attach(cv);
    A.info.init();

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
    var ts = $("tuneSel");
    A.neck.TUNING_ORDER.forEach(function (k) {
      var o = document.createElement("option");
      o.value = k;
      o.textContent = A.neck.TUNINGS[k].label;
      ts.appendChild(o);
    });

    A.shell.init();
    A.shell.on(function (st) {
      syncShell(st);
      /* Entering or leaving fullscreen changes the viewport; re-measure once the
       * transition has settled so the arcs use the space they actually have. */
      setTimeout(function () { A.render.resize(); checkOrientation(); }, 130);
    });
    $("btnFull").addEventListener("click", toggleFull);
    $("setFull").addEventListener("click", toggleFull);
    $("startInstall").addEventListener("click", doInstall);
    $("setInstall").addEventListener("click", doInstall);

    /* The portrait screen is itself the button: double-tap goes fullscreen and
     * rotates in one gesture. Bound here and not on the canvas, because a fast
     * repeat tap on the playing surface is tremolo picking. */
    A.shell.onDoubleTap($("rotate"), function () {
      A.shell.goImmersive().then(function () {
        setTimeout(function () {
          A.render.resize();
          checkOrientation();
          /* Still portrait means the rotation lock was refused — Safari, every
           * desktop browser, and anything that would not go fullscreen first.
           * Say so, rather than leaving the same prompt sitting there looking
           * like it did nothing. */
          if (window.innerHeight > window.innerWidth) $("rotFail").hidden = false;
        }, 300);
      });
    });

    $("startBtn").addEventListener("click", begin);

    $("keyDown").addEventListener("click", function () { setKey(S.key - 1); });
    $("keyUp").addEventListener("click", function () { setKey(S.key + 1); });
    $("keyName").addEventListener("click", function () { setKey(S.key + 7); });   // circle of fifths

    ms.addEventListener("change", function () {
      S.mode = ms.value;
      A.input.rebuildZones();
      syncHud();
      /* A select keeps focus after a choice, and a focused select eats the
       * space bar that should be strumming. */
      ms.blur();
    });

    $("btnGuitar").addEventListener("click", function () { setInstrument("guitar"); });
    $("btnViolin").addEventListener("click", function () { setInstrument("violin"); });
    $("setGuitar").addEventListener("click", function () { setInstrument("guitar"); });
    $("setViolin").addEventListener("click", function () { setInstrument("violin"); });

    /* ---- the neck ---- */
    $("shapeSeg").addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-shape]") : null;
      if (!b) return;
      S.shape = b.dataset.shape;
      syncHud();
    });
    $("btnTap").addEventListener("click", function () { S.tap = !S.tap; syncHud(); });
    $("layNeck").addEventListener("click", function () { setLayout("neck"); });
    $("layArc").addEventListener("click", function () { setLayout("arc"); });
    ts.addEventListener("change", function () {
      S.tuning = ts.value;
      A.neck.reset();
      A.engine.clear();
      syncHud();
    });
    $("fretSel").addEventListener("change", function () {
      S.frets = parseInt(this.value, 10) || 7;
      syncHud();
      A.render.resize();
    });
    $("setView").addEventListener("click", function () { S.lowTop = !S.lowTop; syncHud(); });
    $("setHand").addEventListener("click", function () {
      S.lefty = !S.lefty;
      syncHud();
      A.render.resize();
    });
    $("setDots").addEventListener("click", function () { S.scaleDots = !S.scaleDots; syncHud(); });

    $("versionCheck").addEventListener("click", checkVersion);
    A.update.onState(renderVersion);

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
      syncHud();
      A.render.resize();
    });
    $("octDown").addEventListener("click", function () {
      S.octave = Math.max(1, S.octave - 1); syncHud();
    });
    $("octUp").addEventListener("click", function () {
      S.octave = Math.min(5, S.octave + 1); syncHud();
    });
    $("setInvert").addEventListener("click", function () {
      S.invert = !S.invert;
      /* A bow already riding a lane would otherwise keep driving the string it
       * used to be on. */
      A.input.silenceBows();
      syncHud();
    });
    $("btnCalibrate").addEventListener("click", function () {
      A.input.calibrate();
      var b = this;
      b.textContent = "Zeroed";
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
      trainer.last = performance.now();
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
    syncShell();
  }

  A.app = { init: init, trainerTarget: trainerTarget, targetMidi: targetMidi, SONGS: SONGS };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})(window.ARCO);

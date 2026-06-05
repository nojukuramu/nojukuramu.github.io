/* ============================================================
   Elemental Echo — a Simon-style memory minigame.
   Watch the runes light up, then repeat the growing sequence.
   ============================================================ */
(function () {
  "use strict";

  var ELEMENTS = ["Air", "Fire", "Earth", "Water"];
  var TONES = { Air: 523.25, Fire: 392.0, Earth: 311.13, Water: 440.0 }; // C5, G4, Eb4, A4

  var padsWrap = document.getElementById("echo-pads");
  if (!padsWrap) return;
  var pads = {};
  ELEMENTS.forEach(function (el) {
    pads[el] = padsWrap.querySelector('[data-element="' + el + '"]');
  });
  var startBtn = document.getElementById("echo-start");
  var statusEl = document.getElementById("echo-status");
  var roundEl = document.getElementById("echo-round");
  var bestEl = document.getElementById("echo-best");

  var BEST_KEY = "atelier:echo-best";
  var best = 0;
  try { best = parseInt(localStorage.getItem(BEST_KEY) || "0", 10) || 0; } catch (e) {}
  bestEl.textContent = best;

  var seq = [];
  var input = [];
  var accepting = false;
  var playing = false;
  var audio = null;

  function ctx() {
    if (!audio) {
      try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audio = null; }
    }
    return audio;
  }
  function beep(el, dur) {
    var ac = ctx();
    if (!ac) return;
    try {
      var osc = ac.createOscillator(), g = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = TONES[el] || 440;
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.16, ac.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + (dur || 0.32));
      osc.connect(g); g.connect(ac.destination);
      osc.start(); osc.stop(ac.currentTime + (dur || 0.32) + 0.02);
    } catch (e) {}
  }

  function setStatus(txt) { statusEl.textContent = txt; }
  function light(el, on) { if (pads[el]) pads[el].classList.toggle("lit", !!on); }

  function flash(el, dur) {
    return new Promise(function (resolve) {
      light(el, true); beep(el, (dur || 380) / 1000);
      setTimeout(function () { light(el, false); setTimeout(resolve, 130); }, dur || 380);
    });
  }

  function playback() {
    playing = true; accepting = false;
    setStatus("watch…");
    var speed = Math.max(220, 440 - seq.length * 14);
    var i = 0;
    (function next() {
      if (i >= seq.length) {
        playing = false; accepting = true; input = [];
        setStatus("your turn ✦");
        return;
      }
      flash(seq[i], speed).then(function () { i++; next(); });
    })();
  }

  function addStep() {
    seq.push(ELEMENTS[Math.floor(Math.random() * ELEMENTS.length)]);
    roundEl.textContent = seq.length;
  }

  function start() {
    seq = []; input = [];
    roundEl.textContent = "0";
    startBtn.textContent = "…";
    startBtn.disabled = true;
    ctx(); // unlock audio on the user gesture
    setStatus("watch…");
    setTimeout(function () { addStep(); playback(); }, 400);
  }

  function gameOver() {
    accepting = false;
    var reached = seq.length - 1;
    if (reached > best) {
      best = reached;
      try { localStorage.setItem(BEST_KEY, String(best)); } catch (e) {}
      bestEl.textContent = best;
    }
    setStatus("missed at round " + (reached) + " — Begin again?");
    startBtn.textContent = "Begin";
    startBtn.disabled = false;
  }

  function roundClear() {
    accepting = false;
    setStatus("nice — round " + seq.length + " ✓");
    if (seq.length >= 7 && window.Atelier) {
      if (Atelier.addEgg("echo")) {
        Atelier.toast("✦ seven runes, perfectly echoed. you have a good memory — the footer rewards it too.");
      }
    }
    setTimeout(function () { addStep(); playback(); }, 720);
  }

  function press(el) {
    if (!accepting) return;
    light(el, true); beep(el, 0.26);
    setTimeout(function () { light(el, false); }, 160);
    input.push(el);
    var idx = input.length - 1;
    if (input[idx] !== seq[idx]) {
      if (pads[el]) { pads[el].classList.add("bad"); setTimeout(function () { pads[el].classList.remove("bad"); }, 400); }
      gameOver();
      return;
    }
    if (input.length === seq.length) roundClear();
  }

  ELEMENTS.forEach(function (el) {
    if (!pads[el]) return;
    pads[el].addEventListener("click", function () { press(el); });
  });
  startBtn.addEventListener("click", start);
})();

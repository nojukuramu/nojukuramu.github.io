/* Rubiks — inspection alerts
 *
 * The context is created lazily on a gesture, as karaokenatin/js/sound.js
 * does it: one created earlier starts suspended and drops every sound. say()
 * is routecast/static/js/guide.js's, including the silent prime that iOS
 * needs before a page may speak outside a gesture.
 *
 * Everything is best-effort. A phone on silent gets the on-screen countdown,
 * which is the correct failure. */
"use strict";

var RK = RK || {};

RK.sound = (function (global) {
  var ctx = null, broken = false, primed = false;

  function context() {
    if (ctx || broken) return ctx;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) { broken = true; return null; }
    try { ctx = new AC(); } catch (e) { broken = true; }
    return ctx;
  }

  function resume() {
    var c = context();
    if (c && c.state === "suspended" && c.resume) c.resume().catch(function () {});
    return c;
  }

  function beep(freq, ms, count) {
    var c = resume();
    if (!c) return;
    for (var i = 0; i < (count || 1); i++) {
      var t = c.currentTime + i * (ms / 1000 + 0.08);
      var o = c.createOscillator(), g = c.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      o.connect(g); g.connect(c.destination);
      o.start(t); o.stop(t + ms / 1000 + 0.02);
    }
  }

  function synth() {
    var s = global.speechSynthesis;
    return (s && typeof global.SpeechSynthesisUtterance === "function") ? s : null;
  }

  function say(text) {
    var s = synth();
    if (!s) return false;
    try {
      s.cancel();
      var u = new global.SpeechSynthesisUtterance(text);
      u.rate = 1.1;
      try { u.lang = document.documentElement.lang || "en"; } catch (e) {}
      s.speak(u);
      return true;
    } catch (e) { return false; }
  }

  /* Called from the press that starts inspection, which is a gesture. */
  function prime(mode) {
    if (mode === "off") return;
    resume();
    if (mode !== "voice" || primed) return;
    var s = synth();
    if (!s) return;
    primed = true;
    try { var u = new global.SpeechSynthesisUtterance(" "); u.volume = 0; s.speak(u); } catch (e) {}
  }

  /* The WCA judge calls "8 seconds" and "12 seconds"; so does this. */
  function alert(mode, seconds) {
    if (mode === "voice") { if (say(seconds + " seconds")) return; mode = "beep"; }
    if (mode === "beep") beep(seconds === 8 ? 880 : 1320, 120, seconds === 8 ? 1 : 2);
  }

  return { prime: prime, alert: alert, beep: beep };
})(typeof window !== "undefined" ? window : globalThis);

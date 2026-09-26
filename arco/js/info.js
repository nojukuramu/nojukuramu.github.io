/* ARCO — info.js
 * The info sheet: one sheet, one registry of topics, delegated clicks.
 *
 * Lifted from routecast/static/js/info.js — same mechanics, ARCO's copy. A
 * control opts in with data-info="<key>"; the click is delegated from the
 * document, so nothing needs wiring per button. What is left on the panes is
 * one line each; the explanation is one tap away, and written once here so the
 * start screen and Setup can both reach it without two copies drifting apart.
 *
 * Bodies are trusted HTML written in this file. Nothing from anywhere else ever
 * reaches the sheet.
 */
window.ARCO = window.ARCO || {};
(function (A) {
  "use strict";

  var TOPICS = {
    neck: {
      title: "Playing the neck",
      body:
        "<p>It is a guitar neck. The <b>highest fret held</b> on a string is the note, so " +
        "everything a left hand does on a real one works here.</p>" +
        "<p><b>Hammer-on</b>: hold a fret, tap a higher one on the same string. " +
        "<b>Pull-off</b>: lift the higher one again. <b>Slide</b>: move along the string. " +
        "<b>Bend</b>: push across the string — up or down, the note only goes up, a whole step " +
        "per string's width. Rock it for vibrato.</p>" +
        "<p><b>Lifting</b> stops the string, the way easing off a fret does. <b>Flicking off</b> " +
        "— still moving as you leave — is a pull-off to the open string instead.</p>" +
        "<p>The column behind the nut is the <b>open strings</b>, and it is always there " +
        "wherever you are on the neck.</p>" +
        "<p>Drag the <b>fret numbers</b> under the neck to move up and down it; the arrows at " +
        "their ends step one fret. Setup has how many frets show at once.</p>"
    },

    tap: {
      title: "Tap",
      body:
        "<p>With <b>tap</b> on, a fret sounds the moment you press it, like two-handed " +
        "tapping. A riff then needs one hand, and nothing has to be timed between two pieces " +
        "of glass — which is the genuinely hard part of playing a phone.</p>" +
        "<p>With it off, the neck only stops the strings and the body makes the sound, as on a " +
        "real guitar. Hammer-ons, pull-offs and slides still ring either way, because they " +
        "move a string that is already sounding.</p>"
    },

    pick: {
      title: "The body",
      body:
        "<p>Where the body would be, the strings carry on. <b>Tap</b> a string to pick it. " +
        "<b>Sweep</b> across them to strum — slowly and it arpeggiates. A quick " +
        "<b>back-and-forth</b> on one string is tremolo picking.</p>" +
        "<p><b>Where</b> you pick is tone: round towards the neck, bright and twangy towards " +
        "the bridge.</p>" +
        "<p>The hatched strip at the bridge is a <b>palm mute</b>: the attack stays, the ring " +
        "does not. Chug there.</p>" +
        "<p>A strum skips the strings below your lowest fretted note, the way a chord is " +
        "voiced from its root. Picking one of those on purpose still plays it — that is a " +
        "pedal tone. A string a shape marks with an <b>x</b> stays quiet either way.</p>" +
        "<p>In <b>Bow</b> mode, moving along a string bows it, and the note lives only while " +
        "you keep moving.</p>"
    },

    shapes: {
      title: "Shapes",
      body:
        "<p>What one finger holds.</p>" +
        "<p><b>note</b> — one string, one fret.</p>" +
        "<p><b>power</b> — root, fifth and octave on the next two strings: the rock power " +
        "chord. The octave matters on a phone, whose speaker cannot reproduce a low E at all " +
        "and still hears where the root is.</p>" +
        "<p><b>oct</b> — the root and its octave two strings up, the one in between muted.</p>" +
        "<p><b>chord</b> — the chord the key builds on that root, so it comes out minor on ii " +
        "and major on V by itself. <b>7th</b> adds the seventh.</p>" +
        "<p>Shapes are worked out from the tuning, not memorised, so they are right in drop " +
        "and open tunings too. Sliding a held shape slides the whole chord.</p>"
    },

    scale: {
      title: "Key and scale",
      body:
        "<p>The key and mode at the top mark their scale on the neck — numbered from the " +
        "root, which is teal — so the box for a riff is visible in any position.</p>" +
        "<p>They mark; they never restrict. Every fret plays.</p>" +
        "<p>They also decide what the <b>chord</b> shape builds.</p>"
    },

    layout: {
      title: "Neck or arcs",
      body:
        "<p><b>Neck</b> is a guitar: frets on the left, the body on the right, played with any " +
        "fingers you like.</p>" +
        "<p><b>Arcs</b> is ARCO's original two-thumb layout. The left thumb sweeps a fan of " +
        "scale degrees — angle picks the degree, reaching further out jumps an octave, a " +
        "wiggle bends. The right thumb picks or bows four strings that always voice the chord " +
        "of that degree.</p>" +
        "<p>On the arcs a melody is the same motion in every key, which is its whole " +
        "argument. The neck trades that for being a guitar.</p>"
    },

    arcchords: {
      title: "Chords on the arcs",
      body:
        "<p>The four strings are a voicing of whatever degree the left thumb holds, bass to " +
        "treble: root, third, fifth, and the degree itself an octave up.</p>" +
        "<p><b>7th</b> swaps the fifth for the seventh. <b>Latch</b> freezes the chord under " +
        "the lower three strings and lets the melody string keep following the thumb — " +
        "comp underneath, tune on top.</p>" +
        "<p><b>Diatonic</b> hides the chromatic wedges; <b>chromatic</b> shows them.</p>"
    },

    tilt: {
      title: "Tilt",
      body:
        "<p>Rolling the phone moves the tone between warm and bright. Tipping it forward and " +
        "back bends every string together — a whammy bar on the neck.</p>" +
        "<p>Tilt never picks a note. Thumbs are precise and tilt is not.</p>" +
        "<p>Tapping the back of the phone knocks on the body.</p>" +
        "<p><b>Set neutral pose</b> takes however you are holding it now as level.</p>"
    },

    learn: {
      title: "Learn",
      body:
        "<p>Pick a melody and its notes line up at the top; the next one pulses wherever it " +
        "can be played on the neck.</p>" +
        "<p>Then press <b>new key</b>. The melody moves, and on the neck you find it again — " +
        "or, on the arcs, you play it with exactly the same motion.</p>"
    },

    install: {
      title: "Installing",
      body:
        "<p>Installed, ARCO launches fullscreen in landscape with no browser around it, and " +
        "plays with no network — there are no samples to download; the strings are " +
        "synthesised on the phone.</p>" +
        "<p>On an iPhone, that is <b>Share, then Add to Home Screen</b>. Safari there has no " +
        "fullscreen otherwise.</p>"
    },

    update: {
      title: "Updates",
      body:
        "<p>ARCO keeps its own copy so it opens instantly and plays offline. That copy is " +
        "replaced when a new version is published.</p>" +
        "<p>A new version never swaps itself in while you play — it waits, and a bar at the " +
        "top offers it. Reloading takes a second and keeps your settings.</p>"
    }
  };

  var sheet = null, scrim = null, titleEl = null, bodyEl = null, lastFocus = null;

  function el(id) { return document.getElementById(id); }

  function ensure() {
    if (sheet) return true;
    sheet = el("info-sheet");
    scrim = el("info-scrim");
    titleEl = el("info-title");
    bodyEl = el("info-body");
    return !!(sheet && titleEl && bodyEl);
  }

  function open(key) {
    if (!ensure()) return false;
    var topic = TOPICS[key];
    if (!topic) return false;
    try { lastFocus = document.activeElement; } catch (e) { lastFocus = null; }
    titleEl.textContent = topic.title;
    bodyEl.innerHTML = topic.body;
    sheet.hidden = false;
    var close = el("info-close");
    if (close && close.focus) { try { close.focus(); } catch (e) {} }
    return true;
  }

  function close() {
    if (!ensure() || sheet.hidden) return false;
    sheet.hidden = true;
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    lastFocus = null;
    return true;
  }

  function init() {
    if (!ensure()) return;
    var closeBtn = el("info-close");
    if (closeBtn) closeBtn.addEventListener("click", close);
    if (scrim) scrim.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
    document.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-info]") : null;
      if (!btn) return;
      e.preventDefault();
      open(btn.getAttribute("data-info"));
    });
  }

  A.info = {
    init: init,
    open: open,
    close: close,
    isOpen: function () { return !!(sheet && !sheet.hidden); },
    has: function (key) { return !!TOPICS[key]; },
    /* For the harness: every data-info in the page must name a topic. */
    keys: function () { return Object.keys(TOPICS); }
  };
})(window.ARCO);

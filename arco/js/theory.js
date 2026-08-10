/* ARCO — theory.js
 * Everything here is *relative*. Pitches are stored as semitone offsets from the
 * tonic, never as note names. That is the whole trick behind the instrument:
 * a shape learned once is the same shape in all twelve keys.
 */
window.ARCO = window.ARCO || {};
(function (A) {
  "use strict";

  var SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  var FLAT  = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];

  /* Movable-do solfège, chromatic. Index = semitones above the tonic. */
  var SOLFEGE = ["do", "di", "re", "ri", "mi", "fa", "fi", "sol", "si", "la", "li", "ti"];
  /* Shorter labels for the narrow chromatic wedges. */
  var SOLFEGE_TIGHT = ["do", "di", "re", "ri", "mi", "fa", "fi", "sol", "si", "la", "li", "ti"];

  var MODES = {
    major:      { label: "Major",          scale: [0, 2, 4, 5, 7, 9, 11] },
    minor:      { label: "Natural minor",  scale: [0, 2, 3, 5, 7, 8, 10] },
    dorian:     { label: "Dorian",         scale: [0, 2, 3, 5, 7, 9, 10] },
    mixolydian: { label: "Mixolydian",     scale: [0, 2, 4, 5, 7, 9, 10] },
    harmonic:   { label: "Harmonic minor", scale: [0, 2, 3, 5, 7, 8, 11] },
    penta:      { label: "Pentatonic",     scale: [0, 2, 4, 7, 9] },
    blues:      { label: "Blues",          scale: [0, 3, 5, 6, 7, 10] }
  };
  var MODE_ORDER = ["major", "minor", "dorian", "mixolydian", "harmonic", "penta", "blues"];

  /* Keys whose conventional spelling uses flats. */
  var FLAT_KEYS = { 1: 1, 3: 1, 5: 1, 8: 1, 10: 1 };

  function noteName(pc, key) {
    pc = ((pc % 12) + 12) % 12;
    return (FLAT_KEYS[((key % 12) + 12) % 12] ? FLAT : SHARP)[pc];
  }

  function keyName(key) {
    return (FLAT_KEYS[((key % 12) + 12) % 12] ? FLAT : SHARP)[((key % 12) + 12) % 12];
  }

  function solfege(offset, tight) {
    var o = ((offset % 12) + 12) % 12;
    return (tight ? SOLFEGE_TIGHT : SOLFEGE)[o];
  }

  function scaleOf(modeName) {
    return (MODES[modeName] || MODES.major).scale;
  }

  function isDiatonic(offset, modeName) {
    return scaleOf(modeName).indexOf(((offset % 12) + 12) % 12) >= 0;
  }

  /* MIDI note for a degree.
   *   offset  semitones above the tonic (0..11)
   *   ring    octave band from the fingerboard (0,1,2)
   *   key     tonic pitch class (0 = C)
   *   octave  register of ring 0
   */
  function midiFor(offset, ring, key, octave) {
    return 12 * (octave + 1) + key + offset + 12 * ring;
  }

  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  /* Build the four-voice stack for a degree, bass first.
   *
   * Diatonic degrees stack in scale steps, so the chord quality falls out of the
   * mode automatically (ii is minor, V is major, vii is diminished — for free).
   * Chromatic degrees have no diatonic stack, so they default to a dominant
   * seventh, which is what a note outside the key is almost always doing.
   *
   * Returns semitone offsets from the tonic: [root, third, fifth-or-seventh, root+12]
   * The top voice is always the degree itself an octave up, so a player who only
   * touches the melody string hears exactly the note they fingered.
   */
  function chordStack(offset, modeName, sevenths) {
    var scale = scaleOf(modeName);
    var n = scale.length;
    var o = ((offset % 12) + 12) % 12;
    var idx = scale.indexOf(o);
    var root, third, fifth, seventh;

    if (idx >= 0) {
      var at = function (k) {
        var i = idx + k;
        return scale[((i % n) + n) % n] + 12 * Math.floor(i / n);
      };
      root = at(0); third = at(2); fifth = at(4); seventh = at(6);
    } else {
      root = o; third = o + 4; fifth = o + 7; seventh = o + 10;
    }

    /* Bass -> treble. With sevenths on we drop the fifth for the seventh, which
     * is the standard rootless-ish "shell" voicing and sounds far less muddy on
     * a phone speaker than a four-note close triad. */
    var mid = sevenths ? seventh : fifth;
    return [root, third, mid, root + 12];
  }

  function qualityOf(offset, modeName) {
    var st = chordStack(offset, modeName, false);
    var t = st[1] - st[0], f = st[2] - st[0];
    if (t === 3 && f === 6) return "dim";
    if (t === 3) return "min";
    if (t === 4 && f === 8) return "aug";
    if (t === 4) return "maj";
    if (t === 5 || t === 2) return "sus";
    return "maj";
  }

  var ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

  /* Roman numeral relative to the tonic, so it reads the same in every key. */
  function roman(offset, modeName) {
    var scale = scaleOf(modeName);
    var o = ((offset % 12) + 12) % 12;
    var idx = scale.indexOf(o);
    var q = qualityOf(o, modeName);
    var base;
    if (idx >= 0 && scale.length === 7) {
      base = ROMAN[idx];
    } else {
      /* Chromatic (or a gapped scale): name it by distance from the tonic. */
      var below = 0;
      for (var i = 0; i < 7; i++) if ([0, 2, 4, 5, 7, 9, 11][i] < o) below = i;
      base = "♭" + ROMAN[(below + 1) % 7];
      if ([0, 2, 4, 5, 7, 9, 11].indexOf(o) >= 0) base = ROMAN[[0, 2, 4, 5, 7, 9, 11].indexOf(o)];
    }
    if (q === "min" || q === "dim") base = base.toLowerCase();
    if (q === "dim") base += "°";
    if (q === "aug") base += "+";
    return base;
  }

  function chordName(offset, modeName, key, sevenths) {
    var st = chordStack(offset, modeName, sevenths);
    var q = qualityOf(offset, modeName);
    var rootPc = (key + st[0]) % 12;
    var suffix = q === "min" ? "m" : q === "dim" ? "°" : q === "aug" ? "+" : "";
    if (sevenths) {
      var iv = ((st[2] - st[0]) % 12 + 12) % 12;
      if (iv === 10) suffix += "7";
      else if (iv === 11) suffix += q === "min" ? "♯7" : "maj7";
    }
    return noteName(rootPc, key) + suffix;
  }

  A.theory = {
    MODES: MODES,
    MODE_ORDER: MODE_ORDER,
    SOLFEGE: SOLFEGE,
    noteName: noteName,
    keyName: keyName,
    solfege: solfege,
    scaleOf: scaleOf,
    isDiatonic: isDiatonic,
    midiFor: midiFor,
    midiToFreq: midiToFreq,
    chordStack: chordStack,
    qualityOf: qualityOf,
    roman: roman,
    chordName: chordName
  };
})(window.ARCO);

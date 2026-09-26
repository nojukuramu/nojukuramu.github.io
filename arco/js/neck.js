/* ARCO — neck.js
 * The guitar layout: a six-string neck across the screen, and a picking area
 * where the body would be.
 *
 * Why this exists next to the arcs: a guitarist already owns a whole
 * vocabulary — frets, hammer-ons, pull-offs, slides, bends, palm mutes, power
 * chords — and an instrument that speaks it needs no manual. The arcs ask a
 * player to learn a new geometry before the first riff; this asks for nothing
 * new, and constrains nothing: every fret of every string is there, in key or
 * not.
 *
 *   NECK   The highest fret held on a string is the note, exactly as on a real
 *          neck. So holding one fret and tapping a higher one is a hammer-on,
 *          and lifting it again is a pull-off. Along the string is a slide,
 *          across it is a bend. Lifting the last finger stops the string — and
 *          flicking off instead of lifting is a pull-off to the open string.
 *   TAP    With tap on, a fret sounds by itself, the way two-handed tapping
 *          does. That makes every riff playable with one hand, and nothing has
 *          to be synchronised across two pieces of glass, which is the genuinely
 *          hard part of playing a phone.
 *   PICK   The body area picks the string it lands on, strums across the ones
 *          it crosses, and re-picks on a quick back-and-forth (tremolo). The
 *          strip at the bridge end palm-mutes. Where along the string you pick
 *          sets the tone: warm by the neck, twangy by the bridge.
 *   SHAPE  One finger can hold more than one note — a power chord, an octave,
 *          or the key's own chord on that root — which is what makes rock riffs
 *          playable with a single thumb.
 *
 * Strings are numbered by pitch: 0 is the low E, 5 the high e. Lanes are
 * numbered down the screen, and which string sits in which lane is a setting.
 * All geometry is worked out in "logical" x, with the neck on the left; the
 * left-handed option mirrors screen x through lx() and nothing else changes.
 */
window.ARCO = window.ARCO || {};
(function (A) {
  "use strict";

  var T = A.theory;
  var S = null;

  var STRINGS = 6;
  var MAX_FRET = 22;

  /* MIDI notes, low string first. Nothing goes below C2: the waveguide's
   * longest delay line bottoms out at 38 Hz, and a phone speaker gave up long
   * before that anyway. */
  var TUNINGS = {
    standard: { label: "Standard (E A D G B E)", midi: [40, 45, 50, 55, 59, 64] },
    dropd:    { label: "Drop D",                 midi: [38, 45, 50, 55, 59, 64] },
    half:     { label: "Half step down",         midi: [39, 44, 49, 54, 58, 63] },
    dstd:     { label: "Whole step down",        midi: [38, 43, 48, 53, 57, 62] },
    dropc:    { label: "Drop C",                 midi: [36, 43, 48, 53, 57, 62] },
    openg:    { label: "Open G (D G D G B D)",   midi: [38, 43, 50, 55, 59, 62] },
    opend:    { label: "Open D (D A D F# A D)",  midi: [38, 45, 50, 54, 57, 62] },
    dadgad:   { label: "DADGAD",                 midi: [38, 45, 50, 55, 57, 62] }
  };
  var TUNING_ORDER = ["standard", "dropd", "half", "dstd", "dropc", "openg", "opend", "dadgad"];

  var SHAPES = ["note", "power", "octave", "chord"];

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function tuning() { return (TUNINGS[S.tuning] || TUNINGS.standard).midi; }

  /* Lane <-> string. Tab view (the default) puts the low E at the bottom, the
   * way every riff is written down, and it also puts the strings riffs live on
   * under the thumbs, where reaching is easiest. The mapping is its own
   * inverse, so one function converts both ways. */
  function stringAtLane(l) { return S.lowTop ? l : STRINGS - 1 - l; }

  /* ---------------------------------------------------------------- layout */

  var g = null;
  var probe = null;

  /* The notch and the home indicator. A canvas that fills the screen gets no
   * help from CSS here, so the insets are read off an element that has them. */
  function insets() {
    try {
      if (!probe) {
        probe = document.createElement("div");
        probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;" +
          "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
        document.body.appendChild(probe);
      }
      var cs = getComputedStyle(probe);
      return {
        t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0,
        b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0
      };
    } catch (e) {
      return { t: 0, r: 0, b: 0, l: 0 };
    }
  }

  function layout(W, H) {
    var ins = insets();
    var bar = document.getElementById("bar");
    var barB = bar ? bar.getBoundingClientRect().bottom : 36;
    /* The trainer strip hangs over the top of the neck while it is up, so
     * the top string steps down out of its way rather than under it. */
    var tr = document.getElementById("trainer");
    if (tr && !tr.hidden) barB = Math.max(barB, tr.getBoundingClientRect().bottom);
    var inL = S.lefty ? ins.r : ins.l;
    var inR = S.lefty ? ins.l : ins.r;

    var top = barB + 6;
    var railH = clamp(H * 0.075, 18, 28);
    var railB = H - Math.max(2, ins.b * 0.5);
    var railT = railB - railH;
    var bottom = railT - 4;

    var x0 = inL + 4;
    var xe = W - inR - 4;
    /* The body is a fixed share of the width with a floor, because a thumb
     * needs the same room to strum on a small phone as on a large one. */
    var pickW = clamp((xe - x0) * 0.27, 130, 300);
    var xb = xe - pickW;

    var n = S.frets;
    var guess = (xb - x0) / (n + 0.7);
    var openW = clamp(guess * 0.7, 30, 58);
    var xn = x0 + openW;
    var fw = (xb - 8 - xn) / n;

    S.pos = clamp(S.pos, 1, MAX_FRET - n + 1);

    g = {
      W: W, H: H,
      top: top, bottom: bottom, laneH: (bottom - top) / STRINGS,
      railT: railT, railB: railB,
      x0: x0, xn: xn, fw: fw, n: n, xb: xb, xe: xe,
      xm: xe - pickW * 0.24,
      openW: openW
    };
    return g;
  }

  /* Screen x <-> logical x. Mirroring is its own inverse too. */
  function lx(x) { return S.lefty ? g.W - x : x; }

  function laneY(l) { return g.top + (l + 0.5) * g.laneH; }
  function laneAt(y) { return clamp(Math.floor((y - g.top) / g.laneH), 0, STRINGS - 1); }

  function visible(f) { return f === 0 || (f >= S.pos && f < S.pos + g.n); }

  /* Logical x-range of a fret's column. Fret 0 is the open column behind the
   * nut, and it is always there wherever the window is on the neck — open
   * strings are half of every riff. */
  function colRange(f) {
    if (f === 0) return [g.x0, g.xn];
    var k = f - S.pos;
    return [g.xn + k * g.fw, g.xn + (k + 1) * g.fw];
  }
  function colMid(f) { var r = colRange(f); return (r[0] + r[1]) / 2; }

  /* Sticky, like the arcs' wedges: a finger resting on a fret has to travel
   * well past the wire before it counts as a slide, or a still thumb would
   * buzz between two frets. */
  function fretAt(x, prev) {
    if (prev !== null && prev !== undefined && visible(prev)) {
      var r = colRange(prev);
      var h = (r[1] - r[0]) * 0.24;
      if (x >= r[0] - h && x < r[1] + h) return prev;
    }
    if (x < g.xn) return 0;
    return S.pos + clamp(Math.floor((x - g.xn) / g.fw), 0, g.n - 1);
  }

  function midiAt(s, f) { return tuning()[s] + f; }

  /* ---------------------------------------------------------------- shapes */

  /* What one finger holds. Returns the stops it frets and the strings it
   * deliberately keeps quiet — the underside of the finger on a real neck —
   * so a strum over a power chord stays a power chord. Worked out from the
   * tuning rather than from memorised shapes, so drop and open tunings get
   * correct shapes for free. */
  function shapeFor(s, f, shape) {
    var tun = tuning();
    var stops = [{ s: s, f: f }];
    var mutes = [];
    var t, fret;

    if (shape === "power" || shape === "octave") {
      /* Root, fifth, octave. The octave is what lets a phone speaker, which
       * cannot reproduce a low E at all, still hear where the root is. */
      var want = shape === "power" ? [7, 12] : [null, 12];
      for (var k = 1; k <= 2; k++) {
        t = s + k;
        if (t >= STRINGS) break;
        if (want[k - 1] === null) { mutes.push(t); continue; }
        fret = f + want[k - 1] - (tun[t] - tun[s]);
        if (fret < 0 || fret > MAX_FRET) { mutes.push(t); continue; }
        stops.push({ s: t, f: fret });
      }
      for (t = s + 3; t < STRINGS; t++) mutes.push(t);
    } else if (shape === "chord") {
      /* The chord the key builds on this root — minor on ii, major on V — so
       * quality is automatic, as it is on the arcs. Each higher string takes
       * the lowest chord tone within four frets of the root, which lands on
       * the familiar open and barre shapes in standard tuning and finds
       * sensible ones in any other. */
      var off = ((midiAt(s, f) - S.key) % 12 + 12) % 12;
      var stack = T.chordStack(off, S.mode, S.sevenths);
      var pcs = {};
      for (var i = 0; i < stack.length; i++) pcs[((S.key + stack[i]) % 12 + 12) % 12] = true;
      for (t = s + 1; t < STRINGS; t++) {
        var found = -1;
        for (fret = f; fret <= f + 3 && fret <= MAX_FRET; fret++) {
          if (pcs[(tun[t] + fret) % 12]) { found = fret; break; }
        }
        if (found >= 0) stops.push({ s: t, f: found });
        else mutes.push(t);
      }
    }
    return { stops: stops, mutes: mutes };
  }

  function shapeName(fg) {
    var m = midiAt(fg.s, fg.fret);
    var name = T.noteName(m % 12, S.key);
    var off = ((m - S.key) % 12 + 12) % 12;
    if (fg.shape === "power") return { big: name + "5", small: T.solfege(off) };
    if (fg.shape === "chord") return { big: T.chordName(off, S.mode, S.key, S.sevenths), small: T.roman(off, S.mode) };
    return { big: name, small: T.solfege(off) + (fg.shape === "octave" ? " · oct" : "") };
  }

  /* ----------------------------------------------------------- the strings */

  var fingers = {};     // pointer id -> a fretting finger
  var picks = {};       // pointer id -> a picking touch
  var rail = null;      // the position rail, while dragged
  var order = 0;
  var latest = null;    // the finger that decides the readout
  var live = [false, false, false, false, false, false];
  var pickTone = 0.45;  // where along the string the last pick landed, 0 neck .. 1 bridge
  var lastNote = { midi: -1, t: 0 };

  /* Per string: the highest fret held, and the finger holding it. */
  function held() {
    var out = [null, null, null, null, null, null];
    for (var id in fingers) {
      var fg = fingers[id];
      for (var i = 0; i < fg.stops.length; i++) {
        var st = fg.stops[i];
        var cur = out[st.s];
        if (!cur || st.f > cur.f) out[st.s] = { f: st.f, finger: fg };
      }
    }
    return out;
  }

  function tiltBend() {
    if (!S.motion) return 0;
    /* A whammy bar: tip the phone and every string dips or rises together. */
    return S.tiltFB * A.engine.preset().bendRange;
  }

  function pitchOf(s, h) {
    var hs = h[s];
    var f = hs ? hs.f : 0;
    var bend = hs && hs.f > 0 ? hs.finger.bend : 0;
    return midiAt(s, f) + bend + tiltBend();
  }

  function hzOf(s, h) { return T.midiToFreq(pitchOf(s, h || held())); }

  function energy(s) { return A.engine.energy()[s] || 0; }
  function ringing(s) { return live[s] && energy(s) > 0.006; }

  function note(s, h) {
    lastNote = { midi: Math.round(pitchOf(s, h)), t: performance.now() };
  }

  /* A fresh attack: pick, tap, strum. The target pitch rides along with the
   * pluck so the string starts in tune, rather than on whatever the pitch was
   * a frame ago. */
  function attack(s, amp, tone, pm, h) {
    h = h || held();
    A.engine.pluck(s, amp, tone, pm || 0, hzOf(s, h), true);
    live[s] = true;
    S.ringVis[s] = Math.min(1, S.ringVis[s] + amp * 2.2);
    note(s, h);
  }

  /* Hammer-on, pull-off: the string keeps ringing and changes pitch, with the
   * small click of a fingertip arriving or leaving. No snap — the glide is the
   * sound of it. */
  function legato(s, amp, h) {
    h = h || held();
    A.engine.pluck(s, amp, 0.3, 0, hzOf(s, h), false);
    live[s] = true;
    note(s, h);
  }

  function mute(s) {
    A.engine.damp(s, 0.9);
    live[s] = false;
  }

  function tapping() { return S.tap && S.instrument === "guitar"; }

  /* ------------------------------------------------------------ the neck */

  function press(id, s, fret, x, y) {
    var before = held();
    var fg = {
      id: id, s: s, fret: fret, x: x, y: y, yDown: y,
      bendDir: 0, bend: 0, shape: S.shape, t: ++order,
      hist: [{ x: x, y: y, t: performance.now() }]
    };
    var sh = shapeFor(s, fret, fg.shape);
    fg.stops = sh.stops;
    fg.mutes = sh.mutes;
    fingers[id] = fg;
    latest = fg;
    sound(fg, before, held());

    /* The strings a shape keeps quiet are quietened now, too — an open string
     * left ringing under a power chord is exactly the mud the shape avoids. */
    var h = held();
    for (var i = 0; i < fg.mutes.length; i++) {
      var m = fg.mutes[i];
      if (!h[m] && live[m]) mute(m);
    }
  }

  /* What a new finger sounds like, string by string. */
  function sound(fg, before, after) {
    var stagger = 0;
    for (var i = 0; i < fg.stops.length; i++) {
      var s = fg.stops[i].s;
      if (!after[s] || after[s].finger !== fg) continue;     // a higher fret elsewhere wins
      var moved = !before[s] || before[s].f !== after[s].f || before[s].finger !== fg;
      if (!moved) continue;

      if (ringing(s)) {
        /* Something is already sounding on this string, so this is a
         * hammer-on (or a slide) and it keeps the ring. */
        legato(s, tapping() ? 0.09 + Math.min(0.08, energy(s) * 0.6) : 0.06 + Math.min(0.06, energy(s) * 0.5), after);
      } else if (tapping()) {
        /* Nothing sounding: with tap on, the fret is the attack. A shape's
         * notes roll in low to high a few milliseconds apart, like a quick
         * strum, instead of landing as a single slab. */
        (function (str, d) {
          if (d === 0) attack(str, fg.stops.length > 1 ? 0.24 : 0.28, 0.5, 0, after);
          else setTimeout(function () { if (fingers[fg.id] === fg) attack(str, 0.22, 0.5, 0); }, d);
        })(s, stagger);
        stagger += 6;
      }
    }
  }

  function slide(fg, fret) {
    var before = held();
    var old = fg.stops;
    fg.fret = fret;
    var sh = shapeFor(fg.s, fret, fg.shape);
    fg.stops = sh.stops;
    fg.mutes = sh.mutes;
    var after = held();

    /* A slide keeps the string ringing and only moves the pitch, which the
     * frame loop does; the worklet's glide steps through the frets on the way
     * like a real one. A string a sliding shape picks up on the way is new,
     * and one it leaves behind stops. */
    var i, s, had = {}, has = {};
    for (i = 0; i < old.length; i++) had[old[i].s] = true;
    for (i = 0; i < fg.stops.length; i++) has[fg.stops[i].s] = true;
    for (i = 0; i < fg.stops.length; i++) {
      s = fg.stops[i].s;
      if (!had[s] && after[s] && after[s].finger === fg) {
        if (ringing(s)) legato(s, 0.05, after);
        else if (tapping()) attack(s, 0.2, 0.5, 0, after);
      }
    }
    for (i = 0; i < old.length; i++) {
      s = old[i].s;
      if (!has[s] && !after[s]) mute(s);
    }
    if (ringing(fg.s) && after[fg.s] && after[fg.s].finger === fg) note(fg.s, after);
  }

  function drag(fg, x, y, now) {
    /* Enough samples to reach ~80 ms back even at the 240 Hz some screens
     * deliver coalesced touches at — the window lift() measures a flick over. */
    fg.hist.push({ x: x, y: y, t: now });
    if (fg.hist.length > 24) fg.hist.shift();
    fg.x = x;
    fg.y = y;

    var f = fretAt(x, fg.fret);
    if (f !== fg.fret) slide(fg, f);

    /* A bend pushes the string across the neck, and the note only ever goes
     * up. The direction is whichever way the finger first leaves, so a
     * vibrato rocking back through the start point relaxes the bend instead
     * of bending the other way. Open strings do not bend. */
    var dy = y - fg.yDown;
    if (!fg.bendDir && Math.abs(dy) > BEND_DEAD) fg.bendDir = dy > 0 ? 1 : -1;
    var along = fg.bendDir ? dy * fg.bendDir : 0;
    fg.bend = fg.fret > 0 ? clamp((along - BEND_DEAD) / g.laneH * 2, 0, 3) : 0;
  }
  /* A thumb's contact point wanders a few pixels as it presses harder, and
   * every one of those pixels past the dead zone is a sour note. */
  var BEND_DEAD = 8;

  /* Lifting stops the string, as it does on a neck. Flicking off — a finger
   * still moving across the string as it leaves — is a pull-off instead, and
   * lets the next note down ring: the fret below if one is held, the open
   * string if not. */
  function lift(fg) {
    /* Measured over the last ~80 ms, and only across the string: that is the
     * direction a real pull-off plucks in. A fast slide that ends in a lift
     * moves along the string, and must not set the open string ringing. */
    var now = performance.now();
    var ref = fg.hist[0];
    for (var i = fg.hist.length - 1; i >= 0; i--) {
      if (now - fg.hist[i].t >= 80) { ref = fg.hist[i]; break; }
    }
    var ddx = Math.abs(fg.x - ref.x), ddy = Math.abs(fg.y - ref.y);
    var flick = ddy > 9 && ddy > ddx && ddy / Math.max(16, now - ref.t) > 0.35;

    var before = held();
    delete fingers[fg.id];
    var after = held();
    if (latest === fg) latest = pickLatest();

    for (var k = 0; k < fg.stops.length; k++) {
      var s = fg.stops[k].s;
      if (!before[s] || before[s].finger !== fg) continue;
      if (after[s]) {
        if (ringing(s)) legato(s, flick ? 0.16 : 0.08, after);
      } else if (flick && ringing(s)) {
        legato(s, 0.16, after);
      } else {
        mute(s);
      }
    }
  }

  function pickLatest() {
    var best = null;
    for (var id in fingers) if (!best || fingers[id].t > best.t) best = fingers[id];
    return best;
  }

  /* ---------------------------------------------------------- the body */

  /* A string a held shape keeps quiet — the x on a chord chart. Nothing
   * sounds it, not even a pick aimed straight at it: a strum has to start
   * somewhere, and it usually starts on the string the shape is muting. */
  function silenced(s, h) {
    if (h[s]) return false;
    for (var id in fingers) if (fingers[id].mutes.indexOf(s) >= 0) return true;
    return false;
  }

  /* Which strings a strum is allowed to sound. Nothing held: all six, open.
   * Otherwise the strings below the lowest fretted one are skipped — the way
   * a guitarist voices every chord from its root — and so are any a shape
   * silences. A single pick only asks the second question: aiming at an open
   * string under a fretted note is how pedal-tone riffs are played. */
  function strummable(s) {
    var h = held();
    if (silenced(s, h)) return false;
    var any = false, lowest = STRINGS;
    for (var id in fingers) {
      any = true;
      var st = fingers[id].stops;
      for (var i = 0; i < st.length; i++) lowest = Math.min(lowest, st[i].s);
    }
    if (!any || h[s]) return true;
    return s > lowest;
  }

  function toneAt(x) { return clamp((x - g.xb) / (g.xe - g.xb), 0, 1); }

  function pickString(s, amp, x) {
    var pm = x >= g.xm ? 1 : 0;
    var t = toneAt(x);
    pickTone = t;
    attack(s, pm ? amp * 1.15 : amp, pm ? 0.22 : 0.3 + 0.45 * t, pm);
  }

  function pickDown(id, x, y) {
    var laneF = (y - g.top) / g.laneH;
    var lane = clamp(Math.floor(laneF), 0, STRINGS - 1);
    var p = {
      id: id, lane: lane, laneF: laneF, x: x, y: y,
      lastX: x, lastY: y, lastT: performance.now(),
      speed: 0, bow: 0, dir: 0, travel: 0
    };
    picks[id] = p;
    var s = stringAtLane(lane);
    if (silenced(s, held())) return;
    if (S.instrument === "violin") {
      /* A bow landing on a string makes a small bite before it moves. */
      A.engine.pluck(s, 0.035, 0.25, 0, hzOf(s), true);
      live[s] = true;
    } else {
      pickString(s, 0.3, x);
    }
  }

  function pickMove(p, x, y, now) {
    /* Coalesced samples arrive in a burst, so time comes from the event and
     * not from the clock, or a fast strum would read as a faster one. */
    var dt = Math.max(2, now - p.lastT) / 1000;
    var dx = x - p.lastX, dy = y - p.lastY;
    p.speed = p.speed * 0.55 + (Math.sqrt(dx * dx + dy * dy) / dt) * 0.45;
    /* Along the string is the bow stroke; across it is changing string. */
    p.bow = p.bow * 0.55 + (Math.abs(dx) / dt) * 0.45;
    p.lastT = now;
    p.lastX = x;
    p.lastY = y;

    var laneF = (y - g.top) / g.laneH;
    var lane = clamp(Math.floor(laneF), 0, STRINGS - 1);
    var dir = dy > 0 ? 1 : dy < 0 ? -1 : p.dir;

    if (S.instrument === "guitar") {
      var amp = 0.13 + 0.26 * Math.min(1, p.speed / 1500);
      if (lane !== p.lane) {
        /* A strum: every string crossed sounds as the thumb gets there, so
         * a slow sweep arpeggiates and a fast one is a chord. */
        var step = lane > p.lane ? 1 : -1;
        for (var l = p.lane + step; ; l += step) {
          var s = stringAtLane(l);
          if (strummable(s)) pickString(s, amp, x);
          if (l === lane) break;
        }
        p.travel = 0;
      } else if (dir !== p.dir && p.dir !== 0) {
        /* Reversing on one string is tremolo picking. Travel is counted per
         * stroke and reset at every turn, so a resting thumb's jitter never
         * adds up to a pick. */
        var ts = stringAtLane(lane);
        if (p.travel > 8 && !silenced(ts, held())) pickString(ts, amp * 0.9, x);
        p.travel = 0;
      }
      p.travel += Math.abs(dy);
    }

    p.dir = dir;
    p.lane = lane;
    p.laneF = laneF;
    p.x = x;
    p.y = y;
    pickTone = toneAt(x);
  }

  /* ------------------------------------------------------ the position rail */

  function shift(d) {
    var n = g ? g.n : S.frets;
    var p = clamp(S.pos + d, 1, MAX_FRET - n + 1);
    if (p === S.pos) return false;
    S.pos = p;
    return true;
  }

  function railMove(x) {
    /* Grab-and-pull, like scrolling a map: dragging toward the body brings
     * the lower frets into view. */
    var d = (x - rail.x) / g.fw;
    var p = clamp(Math.round(rail.pos - d), 1, MAX_FRET - g.n + 1);
    if (p !== S.pos) { S.pos = p; rail.moved = true; }
    if (Math.abs(x - rail.x) > 6) rail.moved = true;
  }

  function railUp(x) {
    if (rail.moved) return;
    /* A tap without a drag: the ends step one fret. */
    if (x < g.xn) shift(-1);
    else if (x > g.xn + (g.n - 1) * g.fw) shift(1);
  }

  /* ---------------------------------------------------------- pointer entry */

  function down(e, p) {
    if (!g) return;
    var x = lx(p.x), y = p.y;
    if (x >= g.xb) { pickDown(e.pointerId, x, y); return; }
    if (y >= g.railT - 2) {
      rail = { id: e.pointerId, x: x, pos: S.pos, moved: false };
      return;
    }
    press(e.pointerId, stringAtLane(laneAt(y)), fretAt(x, null), x, y);
  }

  function move(e, p, t) {
    if (!g) return;
    var x = lx(p.x), y = p.y;
    t = t || performance.now();
    var fg = fingers[e.pointerId];
    if (fg) { drag(fg, x, y, t); return; }
    var pk = picks[e.pointerId];
    if (pk) { pickMove(pk, x, y, t); return; }
    if (rail && rail.id === e.pointerId) railMove(x);
  }

  function up(e, p) {
    var fg = fingers[e.pointerId];
    if (fg) { if (p) { fg.x = lx(p.x); fg.y = p.y; } lift(fg); return; }
    if (picks[e.pointerId]) {
      delete picks[e.pointerId];
      if (S.instrument === "violin") silenceBows();
      return;
    }
    if (rail && rail.id === e.pointerId) {
      if (p) railUp(lx(p.x));
      rail = null;
    }
  }

  /* ------------------------------------------------------------ per frame */

  var lastHz = [0, 0, 0, 0, 0, 0];
  var lastBow = [-1, -1, -1, -1, -1, -1];

  function sendBow(s, v, fast) {
    if (Math.abs(v - lastBow[s]) < 0.004) return;
    lastBow[s] = v;
    A.engine.setBow(s, v, fast);
  }

  function silenceBows() {
    for (var i = 0; i < STRINGS; i++) { lastBow[i] = 0; A.engine.setBow(i, 0, true); }
  }

  function tick(dt) {
    if (!g) return;
    var now = performance.now();
    var h = held();

    for (var s = 0; s < STRINGS; s++) {
      var hz = T.midiToFreq(pitchOf(s, h));
      /* Six strings every frame is a lot of automation for values that
       * mostly sit still. */
      if (Math.abs(hz - lastHz[s]) > 0.01) { lastHz[s] = hz; A.engine.setFreq(s, hz); }
    }

    /* The bow, same as on the arcs: pointermove stops the moment a thumb
     * holds still, so the stroke speed has to bleed away on its own or a
     * parked thumb would drone forever. */
    if (S.instrument === "violin") {
      var amt = [0, 0, 0, 0, 0, 0];
      for (var id in picks) {
        var p = picks[id];
        if (now - p.lastT > 40) p.bow *= Math.pow(2e-4, dt);
        var v = Math.min(1, Math.sqrt(p.bow / 900));
        var frac = p.laneF - Math.floor(p.laneF);
        var s0 = stringAtLane(p.lane);
        amt[s0] = Math.max(amt[s0], v);
        /* Riding the edge of a lane catches the neighbour too — a double stop. */
        if (frac < 0.3 && p.lane > 0) { var sa = stringAtLane(p.lane - 1); amt[sa] = Math.max(amt[sa], v * (0.3 - frac) / 0.3); }
        if (frac > 0.7 && p.lane < STRINGS - 1) { var sb = stringAtLane(p.lane + 1); amt[sb] = Math.max(amt[sb], v * (frac - 0.7) / 0.3); }
      }
      for (var k = 0; k < STRINGS; k++) {
        sendBow(k, amt[k] * 0.34, amt[k] > 0);
        if (amt[k] > 0) { live[k] = true; S.ringVis[k] = Math.max(S.ringVis[k], amt[k]); }
      }
    }

    /* Where the pick lands is tone: by the bridge the string is thin and
     * bright, over the neck it is round. Tilt, when on, leans on the same
     * two controls, as it does on the arcs. */
    var lr = S.motion ? S.tiltLR : 0;
    A.engine.setContact(clamp(1 - pickTone - lr * 0.4, 0, 1));
    A.engine.setBright(clamp(0.46 + 0.3 * pickTone + lr * 0.25 + (S.instrument === "guitar" ? 0.06 : 0), 0, 1));
  }

  /* ---------------------------------------------------------------- keyboard */

  /* Degree keys play the degree at the nearest place on the visible neck,
   * so a desktop can still demonstrate it. */
  var kbFret = 3;
  function kbPress(offset, ring) {
    var target = 36 + S.key + offset + 12 * ring;
    var tun = tuning();
    while (target < tun[0]) target += 12;
    var best = null;
    for (var s = 0; s < STRINGS; s++) {
      var f = target - tun[s];
      if (f < 0 || f > MAX_FRET) continue;
      var cost = Math.abs(f - kbFret) + (visible(f) ? 0 : 20);
      if (!best || cost < best.cost) best = { s: s, f: f, cost: cost };
    }
    if (!best) return;
    if (fingers[-1]) lift(fingers[-1]);
    kbFret = best.f || kbFret;
    press(-1, best.s, best.f, colMid(best.f), laneY(stringAtLane(best.s)));
  }

  function kbRelease() { if (fingers[-1]) lift(fingers[-1]); }

  function strumAll() {
    for (var l = 0; l < STRINGS; l++) (function (s, i) {
      setTimeout(function () { if (strummable(s)) pickString(s, 0.26, g.xb + (g.xm - g.xb) * 0.5); }, i * 18);
    })(l, l);
  }

  function pickOne(s) { pickString(s, 0.3, g.xb + (g.xm - g.xb) * 0.5); }

  /* ------------------------------------------------------------------ reset */

  function reset() {
    fingers = {};
    picks = {};
    rail = null;
    latest = null;
    for (var s = 0; s < STRINGS; s++) { live[s] = false; lastHz[s] = 0; lastBow[s] = -1; }
  }

  /* Every place on the visible neck a pitch can be played — the trainer's
   * targets. Exact pitch first; if that is off-screen, the same note in any
   * octave, so there is always somewhere to aim. */
  function positionsOf(midi) {
    var tun = tuning();
    var out = [], pc = [];
    for (var s = 0; s < STRINGS; s++) {
      for (var f = 0; f <= MAX_FRET; f++) {
        if (!visible(f)) continue;
        var m = tun[s] + f;
        if (m === midi) out.push({ s: s, f: f });
        else if ((m - midi) % 12 === 0) pc.push({ s: s, f: f });
      }
    }
    return out.length ? out : pc;
  }

  function init() { S = A.input.state; }

  A.neck = {
    TUNINGS: TUNINGS,
    TUNING_ORDER: TUNING_ORDER,
    SHAPES: SHAPES,
    STRINGS: STRINGS,
    MAX_FRET: MAX_FRET,
    init: init,
    layout: layout,
    geom: function () { return g; },
    lx: lx,
    laneY: laneY,
    colRange: colRange,
    colMid: colMid,
    visible: visible,
    stringAtLane: stringAtLane,
    tuning: tuning,
    midiAt: midiAt,
    held: held,
    pitchOf: pitchOf,
    fingers: function () { return fingers; },
    picks: function () { return picks; },
    railActive: function () { return !!rail; },
    latest: function () { return latest; },
    shapeName: shapeName,
    shapeFor: shapeFor,
    strummable: strummable,
    lastNote: function () { return lastNote; },
    positionsOf: positionsOf,
    down: down,
    move: move,
    up: up,
    tick: tick,
    shift: shift,
    kbPress: kbPress,
    kbRelease: kbRelease,
    strumAll: strumAll,
    pickOne: pickOne,
    silenceBows: silenceBows,
    reset: reset
  };
})(window.ARCO);

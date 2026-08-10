/* ARCO — input.js
 * Geometry, thumbs, and sensors.
 *
 * Hold the phone in landscape, both hands wrapped around it, fingers behind.
 * Each thumb pivots at its bottom corner, so both control surfaces are arcs
 * struck from those corners — the shape a thumb actually sweeps.
 *
 *   LEFT  arc  = the fingerboard. Angle picks the scale degree, radius picks
 *                the octave, and micro-movement inside a degree bends the pitch.
 *   RIGHT arc  = the bow / picking hand. Radius picks which of the four strings
 *                you are on, and motion along the arc is what makes sound.
 *
 * Sensors never choose a pitch — they only shape one. Touch is precise and
 * instant; tilt is coarse and drifts. Giving tilt the job of note selection is
 * the mistake that makes most sensor instruments unplayable.
 */
window.ARCO = window.ARCO || {};
(function (A) {
  "use strict";

  var T = A.theory;

  var state = {
    key: 0,
    mode: "major",
    octave: 3,
    instrument: "guitar",
    lock: true,          // diatonic lock — hides the chromatic wedges
    invert: false,       // string order: false = melody nearest the corner
    sevenths: false,
    latch: false,
    reach: 1.0,
    motion: false,

    left: null,          // { id, offset, ring, bend, r, a, refA }
    right: null,         // { id, lane, laneF, r, a, speed, vx, vy, lastT }
    latched: null,       // { offset, ring }

    tiltLR: 0,
    tiltFB: 0,
    ringVis: [0, 0, 0, 0],
    lastHit: 0
  };

  var geom = null;
  var listeners = [];
  function emit(ev, data) {
    for (var i = 0; i < listeners.length; i++) listeners[i](ev, data);
  }

  /* ---------------------------------------------------------------- layout */

  function side(px, py, mirror, rMin, rMax, a0, a1) {
    return {
      px: px, py: py, mirror: mirror, rMin: rMin, rMax: rMax, a0: a0, a1: a1,
      polar: function (x, y) {
        var dx = mirror ? (this.px - x) : (x - this.px);
        var dy = this.py - y;
        return { r: Math.sqrt(dx * dx + dy * dy), a: Math.atan2(dy, dx) };
      },
      point: function (r, a) {
        var dx = r * Math.cos(a), dy = r * Math.sin(a);
        return { x: this.px + (mirror ? -dx : dx), y: this.py - dy };
      }
    };
  }

  var D2R = Math.PI / 180;

  function layout(W, H) {
    /* The pivot sits just off the bottom corner, where the thumb joint actually
     * is. Everything past 86 degrees would swing back off the side of the
     * screen, and the outer ring has to clear the toolbar, so both the sweep and
     * the reach are capped rather than left to spill. */
    var reach = state.reach;
    var rMax = Math.min(W * 0.44, H - 52) * reach;
    /* Clamped after the reach multiplier, not before: a long-thumb setting must
     * still not push the outer ring off the screen or under the toolbar. */
    rMax = Math.min(rMax, W * 0.46, H - 46);
    var rMin = rMax * 0.33;
    var A0 = 7 * D2R, A1 = 86 * D2R;

    var L = side(W * 0.012, H * 1.01, false, rMin, rMax, A0, A1);
    var R = side(W * 0.988, H * 1.01, true, rMax * 0.36, rMax, A0, A1);

    geom = {
      W: W, H: H,
      L: L, R: R,
      rings: 3,
      ringH: (rMax - rMin) / 3,
      lanes: 4,
      laneH: (R.rMax - R.rMin) / 4,
      zones: buildZones(L)
    };
    return geom;
  }

  /* Degree wedges. Diatonic degrees get a full-width wedge; chromatic ones get a
   * narrow sliver wedged between them — the same white-key/black-key economy a
   * piano uses, rotated into a fan and made relative to the tonic instead of to C.
   * With the diatonic lock on, the chromatic slivers vanish and the seven
   * remaining wedges expand to fill the whole sweep. */
  function buildZones(L) {
    var scale = T.scaleOf(state.mode);
    var w = [], total = 0, o;
    for (o = 0; o < 12; o++) {
      var dia = scale.indexOf(o) >= 0;
      w[o] = dia ? 1 : (state.lock ? 0 : 0.5);
      total += w[o];
    }
    var span = L.a1 - L.a0;
    var zones = [];
    var acc = 0;
    for (o = 0; o < 12; o++) {
      if (w[o] <= 0) continue;
      var a0 = L.a0 + (acc / total) * span;
      acc += w[o];
      var a1 = L.a0 + (acc / total) * span;
      zones.push({
        o: o,
        a0: a0,
        a1: a1,
        mid: (a0 + a1) / 2,
        w: a1 - a0,
        dia: scale.indexOf(o) >= 0
      });
    }
    return zones;
  }

  function zoneIndexOf(offset) {
    for (var i = 0; i < geom.zones.length; i++) if (geom.zones[i].o === offset) return i;
    return -1;
  }

  /* Sticky zone lookup. Once a thumb is inside a wedge it has to travel well
   * past the edge to leave, which is what stops a resting thumb from flickering
   * between two notes. */
  function zoneAt(a, prev) {
    var zs = geom.zones;
    if (prev !== null && prev !== undefined) {
      var pi = zoneIndexOf(prev);
      if (pi >= 0) {
        var z = zs[pi], h = z.w * 0.30;
        if (a >= z.a0 - h && a <= z.a1 + h) return prev;
      }
    }
    for (var i = 0; i < zs.length; i++) if (a >= zs[i].a0 && a < zs[i].a1) return zs[i].o;
    return a < zs[0].a0 ? zs[0].o : zs[zs.length - 1].o;
  }

  function ringAt(r, prev) {
    var g = geom;
    var raw = (r - g.L.rMin) / g.ringH;
    var idx = Math.floor(raw);
    if (prev !== null && prev !== undefined) {
      var lo = prev - 0.18, hi = prev + 1.18;
      if (raw >= lo && raw <= hi) idx = prev;
    }
    return Math.max(0, Math.min(g.rings - 1, idx));
  }

  /* ------------------------------------------------------------- resolution */

  /* Which four pitches the strings should be at right now.
   * Index 0 is the bass string (outermost under the thumb), 3 is the melody
   * string (innermost, where a relaxed thumb naturally rests). */
  function voicing() {
    var live = state.left;
    var base = state.latch && state.latched
      ? state.latched
      : (live ? { offset: live.offset, ring: live.ring } : { offset: 0, ring: 0 });

    var stack = T.chordStack(base.offset, state.mode, state.sevenths);
    var bendAll = (live ? live.bend : 0) + tiltBend();
    var out = [];
    for (var s = 0; s < 4; s++) {
      var midi = T.midiFor(stack[s], base.ring, state.key, state.octave);
      out.push({ midi: midi, bend: bendAll });
    }

    /* Latched: the lower three voices hold the chord while the melody string
     * keeps following the live thumb. This is what makes solo playing possible
     * with only two thumbs — comp underneath, tune on top. */
    if (state.latch && live) {
      out[3] = {
        midi: T.midiFor(live.offset, live.ring, state.key, state.octave) + 12,
        bend: live.bend + tiltBend()
      };
    }
    return out;
  }

  function tiltBend() {
    if (!state.motion) return 0;
    return state.tiltFB * A.engine.preset().bendRange;
  }

  function pushFreqs() {
    var v = voicing();
    for (var s = 0; s < 4; s++) A.engine.setFreq(s, T.midiToFreq(v[s].midi + v[s].bend));
  }

  /* ---------------------------------------------------------------- pointers */

  var canvas = null;
  var pointers = {};

  function local(e) {
    var rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onDown(e) {
    if (!geom) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers */ }
    var p = local(e);
    var isLeft = p.x < geom.W * 0.5;
    pointers[e.pointerId] = { left: isLeft };

    if (isLeft) {
      var po = geom.L.polar(p.x, p.y);
      var offset = zoneAt(po.a, null);
      var ring = ringAt(po.r, null);
      state.left = { id: e.pointerId, offset: offset, ring: ring, bend: 0, r: po.r, a: po.a, refA: po.a };
      onFingerChange(true);
    } else {
      var pr = geom.R.polar(p.x, p.y);
      var laneF = (pr.r - geom.R.rMin) / geom.laneH;
      var lane = Math.max(0, Math.min(3, Math.floor(laneF)));
      state.right = {
        id: e.pointerId, lane: lane, laneF: laneF, r: pr.r, a: pr.a,
        speed: 0, lastT: performance.now(), lastX: p.x, lastY: p.y,
        arc: 0, dir: 0, lastPluckLane: -1
      };
      if (state.instrument === "guitar") {
        pluckLane(lane, 0.30, 0.55);
        state.right.lastPluckLane = lane;
      } else {
        /* A bow landing on a string makes a small bite even before it moves. */
        pluckLane(lane, 0.035, 0.25);
      }
    }
    emit("input");
  }

  function onMove(e) {
    var rec = pointers[e.pointerId];
    if (!rec || !geom) return;
    var p = local(e);
    var now = performance.now();

    if (rec.left && state.left && state.left.id === e.pointerId) {
      var po = geom.L.polar(p.x, p.y);
      var prevOffset = state.left.offset, prevRing = state.left.ring;
      var offset = zoneAt(po.a, prevOffset);
      var ring = ringAt(po.r, prevRing);
      if (offset !== prevOffset || ring !== prevRing) state.left.refA = po.a;

      var zi = zoneIndexOf(offset);
      var zw = zi >= 0 ? geom.zones[zi].w : 0.1;
      var bend = ((po.a - state.left.refA) / (zw * 0.5)) * 0.6;
      state.left.offset = offset;
      state.left.ring = ring;
      state.left.r = po.r;
      state.left.a = po.a;
      state.left.bend = Math.max(-0.9, Math.min(0.9, bend));

      if (offset !== prevOffset || ring !== prevRing) onFingerChange(false);
    }

    if (!rec.left && state.right && state.right.id === e.pointerId) {
      var R = state.right;
      var pr = geom.R.polar(p.x, p.y);
      var dt = Math.max(4, now - R.lastT) / 1000;
      var dx = p.x - R.lastX, dy = p.y - R.lastY;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var inst = dist / dt;
      R.speed = R.speed * 0.55 + inst * 0.45;
      R.lastT = now;
      R.lastX = p.x;
      R.lastY = p.y;

      var laneF = (pr.r - geom.R.rMin) / geom.laneH;
      var lane = Math.max(0, Math.min(3, Math.floor(laneF)));

      /* Signed travel along the arc, used for tremolo picking. */
      var dA = pr.a - R.a;
      R.arc += dA * pr.r;
      var newDir = dA > 0 ? 1 : (dA < 0 ? -1 : R.dir);

      if (state.instrument === "guitar") {
        var amp = 0.13 + 0.30 * Math.min(1, R.speed / 1500);
        var tone = 0.35 + 0.5 * Math.min(1, R.speed / 1800);
        if (lane !== R.lane) {
          /* Sweeping across strings is a strum, and a slow sweep genuinely
           * arpeggiates because each crossing fires when the thumb gets there. */
          var step = lane > R.lane ? 1 : -1;
          for (var l = R.lane + step; ; l += step) {
            pluckLane(l, amp, tone);
            if (l === lane) break;
          }
          R.lastPluckLane = lane;
          R.arc = 0;
        } else if (newDir !== R.dir && Math.abs(R.arc) > 10) {
          pluckLane(lane, amp * 0.9, tone);
          R.arc = 0;
        } else if (Math.abs(R.arc) > 34) {
          pluckLane(lane, amp * 0.85, tone);
          R.arc = 0;
        }
      }

      R.dir = newDir;
      R.lane = lane;
      R.laneF = laneF;
      R.r = pr.r;
      R.a = pr.a;
    }
    emit("input");
  }

  function onUp(e) {
    var rec = pointers[e.pointerId];
    if (!rec) return;
    delete pointers[e.pointerId];
    if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }

    if (state.left && state.left.id === e.pointerId) {
      state.left = null;
      /* Lifting the stopping thumb mutes, exactly like taking a finger off a
       * fretboard. It is how you get staccato chords and rhythmic chops. */
      if (!state.latch) for (var s = 0; s < 4; s++) A.engine.damp(s, 0.85);
    }
    if (state.right && state.right.id === e.pointerId) {
      state.right = null;
      silenceBows();
    }
    emit("input");
  }

  /* Moving the stopping thumb while strings are already ringing is a hammer-on
   * or a slide, not a new attack — so we only nudge the strings that are still
   * sounding, and only in pluck mode. It is what lets fast runs happen under the
   * left thumb alone while the right hand stays mostly still. */
  function onFingerChange(isNewTouch) {
    if (state.latch && !isNewTouch) return;
    if (state.instrument !== "guitar") return;
    var e = A.engine.energy();
    for (var s = 0; s < 4; s++) {
      if (e[s] > 0.012) {
        A.engine.damp(s, 0);
        A.engine.pluck(s, 0.055 + Math.min(0.06, e[s] * 0.5), 0.22);
      }
    }
  }

  /* Lane (0 = nearest the thumb's corner) to string index (0 = bass).
   * By default the nearest lane is the melody voice, so a relaxed curled thumb
   * plays the tune and reaching outward adds the chord under it. Inverted puts
   * the bass nearest instead, which is the way round a guitar sits when you look
   * down at it. Both mappings are their own inverse, so this one function
   * converts in either direction. */
  function stringForLane(lane) {
    return state.invert ? lane : 3 - lane;
  }

  function pluckLane(lane, amp, tone) {
    lane = Math.max(0, Math.min(3, lane));
    var s = stringForLane(lane);
    A.engine.damp(s, 0);
    A.engine.pluck(s, amp, tone);
    state.ringVis[s] = Math.min(1, state.ringVis[s] + amp * 2.2);
  }

  /* ------------------------------------------------------------ per-frame */

  /* The bow is re-sent for all four strings every frame, which is 240 parameter
   * automations a second for values that mostly do not change. Skipping the
   * no-ops keeps the audio thread quiet on cheaper phones. */
  var lastBow = [-1, -1, -1, -1];
  function sendBow(s, v, fast) {
    if (Math.abs(v - lastBow[s]) < 0.004) return;
    lastBow[s] = v;
    A.engine.setBow(s, v, fast);
  }

  function silenceBows() {
    for (var i = 0; i < 4; i++) { lastBow[i] = 0; A.engine.setBow(i, 0, true); }
  }

  function tick(dt) {
    if (!geom) return;
    var now = performance.now();

    /* The bow. pointermove stops firing the moment a thumb holds still, so the
     * bow speed has to bleed away on its own — otherwise a parked thumb would
     * drone forever, and the whole point is that stopping stops the sound. */
    if (state.instrument === "violin") {
      var R = state.right;
      if (R) {
        if (now - R.lastT > 40) R.speed *= Math.pow(2e-4, dt);
        var v = Math.min(1, Math.sqrt(R.speed / 900));
        var frac = R.laneF - Math.floor(R.laneF);
        for (var s = 0; s < 4; s++) {
          var lane = stringForLane(s);
          var amt = 0;
          if (lane === R.lane) amt = 1;
          /* Riding a boundary catches the neighbour too — double stops. */
          else if (lane === R.lane - 1 && frac < 0.34) amt = (0.34 - frac) / 0.34;
          else if (lane === R.lane + 1 && frac > 0.66) amt = (frac - 0.66) / 0.34;
          sendBow(s, v * amt * 0.34, amt > 0);
          if (amt > 0) state.ringVis[s] = Math.max(state.ringVis[s], v * amt);
        }
      } else {
        for (var k = 0; k < 4; k++) sendBow(k, 0, true);
      }
    }

    /* Tilt shapes tone, never pitch selection. Rolling the phone slides the
     * contact point from over-the-neck to up-against-the-bridge, which is a real
     * and very audible thing on both instruments. */
    var contact = 0.5 + state.tiltLR * 0.5;
    A.engine.setContact(contact);
    A.engine.setBright(0.5 + state.tiltLR * 0.32 + (state.instrument === "guitar" ? 0.12 : 0));

    pushFreqs();

    var decay = Math.pow(0.06, dt);
    var en = A.engine.energy();
    for (var i = 0; i < 4; i++) {
      state.ringVis[i] = Math.max(state.ringVis[i] * decay, Math.min(1, en[i] * 3.5));
    }
  }

  /* ---------------------------------------------------------------- sensors */

  var tiltRaw = { lr: 0, fb: 0 };
  var tiltZero = { lr: 0, fb: 0 };
  var haveTilt = false;
  var lastAccel = 0;

  function screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === "number") return screen.orientation.angle;
    if (typeof window.orientation === "number") return window.orientation;
    return 0;
  }

  function onOrient(e) {
    if (e.beta === null && e.gamma === null) return;
    haveTilt = true;
    var beta = e.beta || 0, gamma = e.gamma || 0;
    var ang = ((screenAngle() % 360) + 360) % 360;
    var lr, fb;
    /* beta/gamma are reported in the device's own frame, so they have to be
     * rotated into whatever way the phone is currently being held. */
    if (ang === 90) { lr = beta; fb = -gamma; }
    else if (ang === 270) { lr = -beta; fb = gamma; }
    else if (ang === 180) { lr = -gamma; fb = -beta; }
    else { lr = gamma; fb = beta; }
    tiltRaw.lr = lr;
    tiltRaw.fb = fb;

    var l = (lr - tiltZero.lr) / 26;
    var f = (fb - tiltZero.fb) / 20;
    l = Math.max(-1, Math.min(1, l));
    f = Math.max(-1, Math.min(1, f));
    /* Small dead zone so a naturally unsteady grip does not wobble the tone. */
    l = Math.abs(l) < 0.08 ? 0 : l;
    f = Math.abs(f) < 0.10 ? 0 : f;
    state.tiltLR += (l - state.tiltLR) * 0.2;
    state.tiltFB += (f - state.tiltFB) * 0.2;
  }

  function onMotion(e) {
    var a = e.acceleration;
    var mag;
    if (a && a.x !== null) {
      mag = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    } else {
      var g = e.accelerationIncludingGravity;
      if (!g || g.x === null) return;
      var m = Math.sqrt(g.x * g.x + g.y * g.y + g.z * g.z);
      mag = Math.abs(m - lastAccel) * 3;
      lastAccel = m;
    }
    var now = performance.now();
    if (mag > 13 && now - state.lastHit > 130) {
      state.lastHit = now;
      A.engine.bodyHit(Math.min(1, mag / 28));
      emit("hit");
    }
  }

  function calibrate() {
    tiltZero.lr = tiltRaw.lr;
    tiltZero.fb = tiltRaw.fb;
    state.tiltLR = 0;
    state.tiltFB = 0;
  }

  function enableMotion() {
    function attach() {
      window.addEventListener("deviceorientation", onOrient, true);
      window.addEventListener("devicemotion", onMotion, true);
      state.motion = true;
      setTimeout(calibrate, 400);
      emit("input");
    }
    var DOE = window.DeviceOrientationEvent;
    var DME = window.DeviceMotionEvent;
    var needs = DOE && typeof DOE.requestPermission === "function";
    if (needs) {
      return DOE.requestPermission().then(function (r) {
        if (r !== "granted") return false;
        if (DME && typeof DME.requestPermission === "function") {
          return DME.requestPermission().then(function () { attach(); return true; })
            .catch(function () { attach(); return true; });
        }
        attach();
        return true;
      });
    }
    attach();
    return Promise.resolve(true);
  }

  function disableMotion() {
    window.removeEventListener("deviceorientation", onOrient, true);
    window.removeEventListener("devicemotion", onMotion, true);
    state.motion = false;
    state.tiltLR = 0;
    state.tiltFB = 0;
    emit("input");
  }

  /* --------------------------------------------------------------- keyboard */
  /* Desktop fallback so the thing can be demonstrated without a phone.
   * A W S E D F T G Y H U J is the tracker/piano row: white keys on the home
   * row, black keys above, mapped to chromatic degrees rather than to notes. */
  var KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11 };
  var keyRing = 1;
  var heldKey = null;

  function onKeyDown(ev) {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var t = ev.target;
    if (t && /^(input|select|textarea)$/i.test(t.tagName)) return;
    var k = ev.key.toLowerCase();

    if (k in KEYMAP) {
      ev.preventDefault();
      if (heldKey === k) return;
      heldKey = k;
      state.left = { id: -1, offset: KEYMAP[k], ring: keyRing, bend: 0, r: 0, a: 0, refA: 0 };
      onFingerChange(false);
      emit("input");
      return;
    }
    if (k === "z") { keyRing = Math.max(0, keyRing - 1); if (state.left) state.left.ring = keyRing; emit("input"); }
    if (k === "x") { keyRing = Math.min(2, keyRing + 1); if (state.left) state.left.ring = keyRing; emit("input"); }
    if (k === " ") {
      ev.preventDefault();
      for (var l = 0; l < 4; l++) (function (lane) {
        setTimeout(function () { pluckLane(lane, 0.26, 0.6); }, lane * 22);
      })(l);
    }
    if (k >= "1" && k <= "4") pluckLane(4 - parseInt(k, 10), 0.3, 0.6);
  }

  function onKeyUp(ev) {
    var k = ev.key.toLowerCase();
    if (k in KEYMAP && heldKey === k) {
      heldKey = null;
      state.left = null;
      if (!state.latch) for (var s = 0; s < 4; s++) A.engine.damp(s, 0.85);
      emit("input");
    }
  }

  /* ------------------------------------------------------------------ setup */

  function attach(cv) {
    canvas = cv;
    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onMove);
    cv.addEventListener("pointerup", onUp);
    cv.addEventListener("pointercancel", onUp);
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
  }

  function rebuildZones() {
    if (geom) geom.zones = buildZones(geom.L);
  }

  A.input = {
    state: state,
    attach: attach,
    layout: layout,
    geom: function () { return geom; },
    rebuildZones: rebuildZones,
    zoneIndexOf: zoneIndexOf,
    voicing: voicing,
    tick: tick,
    enableMotion: enableMotion,
    disableMotion: disableMotion,
    calibrate: calibrate,
    hasTilt: function () { return haveTilt; },
    pluckLane: pluckLane,
    stringForLane: stringForLane,
    silenceBows: silenceBows,
    on: function (fn) { listeners.push(fn); }
  };
})(window.ARCO);

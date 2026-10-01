/* ============================================================
   Aisa — the controller, and the one object anything else talks to

   window.Aisa is the whole interface. Nothing drives it yet: there is no
   tracker, no voice, no chat behind it, on purpose. It is the socket those
   plug into. What it does on its own is what a rig needs in order to look
   alive while it waits: blink, breathe, drift a little, let the hair
   settle. Each of those can be switched off.

   Every frame the parameters are built up in layers, and the order is the
   point of it:

     1. base         what set() last said, or the default
     2. look-at      head, body and eyes towards a target
     3. idle         a slow drift, so she is never a still picture
     4. expression   blended towards the active expression(s)
     5. motion       keyframed offsets added on top (a nod while smiling)
     6. voice        mouth opening from speak() - a lip-sync input
     7. blink        multiplies the eyes shut, briefly
     8. physics      hair and skirt, from how everything above moved

   so a caller can hold an arm up with set() and still have her blink,
   smile and nod over it.
   ============================================================ */
var AISA = AISA || {};

AISA.create = function (canvas, opts) {
  "use strict";
  opts = opts || {};
  var base = opts.base || "art/";
  var model = AISA.model;
  var DEF = {}, RANGE = {};
  model.params.forEach(function (p) { DEF[p.id] = p.def; RANGE[p.id] = p; });

  var values = {}, out = {};
  model.params.forEach(function (p) { values[p.id] = p.def; out[p.id] = p.def; });

  var auto = { blink: true, breath: true, idle: true, physics: true };
  var listeners = {};
  function emit(type, a, b) {
    var l = listeners[type];
    if (!l || !l.length) return;
    l = l.slice();
    for (var i = 0; i < l.length; i++) { try { l[i](a, b); } catch (e) { console.error(e); } }
  }

  function clampParam(id, v) {
    var r = RANGE[id];
    return r ? Math.max(r.min, Math.min(r.max, v)) : v;
  }
  function ease(t) { return t * t * (3 - 2 * t); }

  // ---- expressions: each has a weight easing towards its target ---------
  var exprW = {}, exprTarget = {}, exprFade = 0.3, current = "neutral";
  /* Where she is looking and how she holds her head are added, not set: a
     sad expression tips the head down, and must not stop it drifting or
     turning to follow something while it does. */
  var ADDITIVE = { ParamAngleX: 1, ParamAngleY: 1, ParamAngleZ: 1, ParamBodyAngleX: 1, ParamBodyAngleY: 1,
                   ParamBodyAngleZ: 1, ParamEyeBallX: 1, ParamEyeBallY: 1 };
  Object.keys(AISA.expressions).forEach(function (k) { exprW[k] = 0; exprTarget[k] = 0; });

  // ---- motions ------------------------------------------------------------
  /* A track is a smooth curve through its keys - a monotone cubic, the
     Fritsch-Carlson kind - rather than an ease from each key to the next.
     Eased key to key, every key is a dead stop, and a wave or a laugh reads
     as a robot hitting its marks; through the keys, the arm only stops
     where the animator held it. Monotone, so it never overshoots a key: a
     held pose stays held, and an arm told to stop at 104 degrees does not
     swing on to 110 first. A looping track takes its end tangents from
     across the loop, so it does not pause where it wraps. */
  var compiled = {};
  function compile(name) {
    if (compiled[name]) return compiled[name];
    var def = AISA.motions[name], tracks = [], len = 0;
    Object.keys(def).forEach(function (id) {
      var k = def[id];
      if (!Array.isArray(k)) return;
      var n = k.length, t = new Float64Array(n), v = new Float64Array(n), m = new Float64Array(n), d = new Float64Array(n);
      for (var i = 0; i < n; i++) { t[i] = k[i][0]; v[i] = k[i][1]; }
      for (i = 0; i < n - 1; i++) d[i] = (v[i + 1] - v[i]) / Math.max(t[i + 1] - t[i], 1e-6);
      for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
      if (def.loop && n > 2) {
        var T = t[n - 1];
        m[0] = m[n - 1] = (v[1] - v[n - 2]) / Math.max(t[1] + (T - t[n - 2]), 1e-6);
      }
      for (i = 0; i < n - 1; i++) {
        if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
        var a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
        if (h > 9) { var s3 = 3 / Math.sqrt(h); m[i] = s3 * a * d[i]; m[i + 1] = s3 * b * d[i]; }
      }
      tracks.push({ id: id, t: t, v: v, m: m });
      len = Math.max(len, t[n - 1]);
    });
    return (compiled[name] = { tracks: tracks, len: len, loop: !!def.loop });
  }
  function trackValue(tr, x) {
    var t = tr.t, n = t.length;
    if (x <= t[0]) return tr.v[0];
    if (x >= t[n - 1]) return tr.v[n - 1];
    var i = 1;
    while (t[i] < x) i++;
    var h = t[i] - t[i - 1], u = (x - t[i - 1]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * tr.v[i - 1] + (u3 - 2 * u2 + u) * h * tr.m[i - 1] +
           (-2 * u3 + 3 * u2) * tr.v[i] + (u3 - u2) * h * tr.m[i];
  }
  var playing = [];

  // ---- look-at, idle, blink, voice ----------------------------------------
  // the eyes get there first, the head follows, the body last of all
  var look = { ex: 0, ey: 0, hx: 0, hy: 0, bx: 0, tx: 0, ty: 0, on: false };
  var seed = [Math.random() * 100, Math.random() * 100, Math.random() * 100, Math.random() * 100, Math.random() * 100];
  var saccade = { x: 0, y: 0, tx: 0, ty: 0, next: 1 };
  var blink = { next: 1.5 + Math.random() * 3, t: -1, twice: false };
  var voice = { level: 0, target: 0, held: 0 };

  function wave(t, k) {
    var s = seed[k];
    return Math.sin(t * (0.21 + k * 0.037) + s) * 0.6 + Math.sin(t * (0.53 + k * 0.051) + s * 1.7) * 0.4;
  }

  /* 0 = shut, 1 = open. Shuts quickly and opens a touch slower, which is
     what makes a blink read as a blink and not a flicker. */
  function blinkFactor(dt) {
    if (blink.t < 0) {
      blink.next -= dt;
      if (blink.next <= 0) { blink.t = 0; blink.twice = Math.random() < 0.15; }
      return 1;
    }
    blink.t += dt;
    var T = 0.2, u = blink.t / T, f;
    if (u < 0.35) f = 1 - ease(u / 0.35);
    else if (u < 0.45) f = 0;
    else if (u < 1) f = ease((u - 0.45) / 0.55);
    else {
      f = 1;
      blink.t = -1;
      if (blink.twice) { blink.twice = false; blink.next = 0.08; }
      else blink.next = 1.8 + Math.random() * 4.2;
    }
    return f;
  }

  // ---- physics ------------------------------------------------------------
  var phys = (AISA.physics || []).map(function (c) {
    return { c: c, b: null, vb: 0, ink: Object.keys(c.in), hk: Object.keys(c.hang) };
  });
  function stepPhysics(v, dt) {
    var steps = Math.max(1, Math.ceil(dt / (1 / 120))), h = dt / steps;
    for (var j = 0; j < phys.length; j++) {
      var p = phys[j], c = p.c, a = 0, g = 0, q;
      for (q = 0; q < p.ink.length; q++) a += (v[p.ink[q]] || 0) * c.in[p.ink[q]];
      for (q = 0; q < p.hk.length; q++) g += (v[p.hk[q]] || 0) * c.hang[p.hk[q]];
      if (p.b === null) p.b = a;
      var k = Math.pow(2 * Math.PI * c.hz, 2), d = 2 * c.damp * Math.sqrt(k);
      for (var i = 0; i < steps; i++) {
        p.vb += (k * (a - p.b) - d * p.vb) * h;
        p.b += p.vb * h;
      }
      // the bob trails the anchor: a head turning right leaves the hair
      // behind it, on the left
      var o = (p.b - a) * c.gain + g;
      v[c.out] = clampParam(c.out, v[c.out] + (auto.physics ? o : 0));
    }
  }

  // ---- the frame ----------------------------------------------------------
  var time = 0;
  function build(dt) {
    time += dt;
    var v = out, k;
    for (k in values) v[k] = values[k];

    // look-at
    var gx = look.on ? look.tx : 0, gy = look.on ? look.ty : 0;
    var ke = 1 - Math.exp(-dt * 18), kh = 1 - Math.exp(-dt * 5), kb = 1 - Math.exp(-dt * 2.2);
    look.ex += (gx - look.ex) * ke; look.ey += (gy - look.ey) * ke;
    look.hx += (gx - look.hx) * kh; look.hy += (gy - look.hy) * kh;
    look.bx += (gx - look.bx) * kb;
    v.ParamAngleX += look.hx * 22; v.ParamAngleY += look.hy * 16;
    // the eyes cover whatever of the turn the head has not made yet
    v.ParamEyeBallX += look.ex * 0.55 + (look.ex - look.hx) * 0.9;
    v.ParamEyeBallY += look.ey * 0.5 + (look.ey - look.hy) * 0.9;
    v.ParamBodyAngleX += look.bx * 4; v.ParamAngleZ -= look.hx * look.hy * 4;

    if (auto.idle) {
      v.ParamAngleX += wave(time, 0) * 4; v.ParamAngleY += wave(time, 1) * 3; v.ParamAngleZ += wave(time, 2) * 3;
      v.ParamBodyAngleX += wave(time, 3) * 1.5; v.ParamBodyAngleZ += wave(time, 4) * 1.2;
      // the arms are not bolted on: they hang a little out of time with
      // the body, and drift as the weight shifts
      v.ParamArmRA += 1.6 + wave(time + 1.3, 4) * 2.2; v.ParamArmLA += 1.6 + wave(time + 2.1, 3) * 2.2;
      saccade.next -= dt;
      if (saccade.next <= 0) {
        saccade.tx = (Math.random() - 0.5) * 0.4; saccade.ty = (Math.random() - 0.5) * 0.3;
        saccade.next = 1.2 + Math.random() * 3;
      }
      var sk = 1 - Math.exp(-dt * 25);
      saccade.x += (saccade.tx - saccade.x) * sk; saccade.y += (saccade.ty - saccade.y) * sk;
      v.ParamEyeBallX += saccade.x; v.ParamEyeBallY += saccade.y;
    }
    if (auto.breath) {
      var br = 0.5 + 0.5 * Math.sin(time * 2 * Math.PI / 3.6);
      v.ParamBreath += br;
      // a breath lifts the head a touch, and the shoulders the arms
      v.ParamAngleY += (br - 0.5) * 0.8;
      v.ParamArmRA += br * 1.2; v.ParamArmLA += br * 1.2;
    }

    // expressions: weights ease towards their targets
    var step = exprFade > 0 ? dt / exprFade : 1;
    for (k in exprW) {
      var w = exprW[k], t = exprTarget[k];
      exprW[k] = w < t ? Math.min(t, w + step) : Math.max(t, w - step);
      if (exprW[k] <= 0) continue;
      var e = AISA.expressions[k], ew = ease(exprW[k]);
      for (var id in e) {
        if (!(id in v)) continue;
        if (ADDITIVE[id]) v[id] += e[id] * ew;
        else v[id] += (e[id] - v[id]) * ew;
      }
    }

    // motions
    for (var i = playing.length - 1; i >= 0; i--) {
      var m = playing[i];
      m.t += dt * m.speed;
      if (m.stopping) m.env = Math.max(0, m.env - dt / 0.2);
      else m.env = Math.min(1, m.env + dt / 0.12);
      var mt = m.loop ? m.t % m.len : Math.min(m.t, m.len), tr = m.c.tracks, f = m.weight * ease(m.env);
      for (var q = 0; q < tr.length; q++) if (tr[q].id in v) v[tr[q].id] += trackValue(tr[q], mt) * f;
      if ((!m.loop && m.t >= m.len) || (m.stopping && m.env <= 0)) {
        playing.splice(i, 1);
        emit("motion", m.name, "end");
        if (m.resolve) m.resolve(m.name);
      }
    }

    // voice: a level from outside, held briefly so a meter that reports at
    // 30 Hz still gives a mouth that moves at 60
    voice.held += dt;
    if (voice.held > 0.12) voice.target *= Math.exp(-dt * 12);
    voice.level += (voice.target - voice.level) * (1 - Math.exp(-dt * 30));
    if (voice.level > 0.01) {
      v.ParamMouthOpenY = Math.max(v.ParamMouthOpenY, voice.level);
      v.ParamMouthForm += (Math.sin(time * 11) * 0.15) * voice.level;
    }

    if (auto.blink) {
      var bf = blinkFactor(dt);
      v.ParamEyeLOpen *= bf; v.ParamEyeROpen *= bf;
    }

    for (k in v) v[k] = clampParam(k, v[k]);
    stepPhysics(v, dt);
    return v;
  }

  // ---- boot ---------------------------------------------------------------
  var rig = null, raf = 0, last = 0, running = false;
  var ready = Promise.all([
    fetch(base + "parts.json").then(function (r) { if (!r.ok) throw new Error("parts.json " + r.status); return r.json(); }),
    new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error("atlas.png did not load")); };
      img.src = base + "atlas.png";
    })
  ]).then(function (r) {
    rig = new AISA.Rig(canvas, model, r[1], r[0]);
    if (opts.background) api.background(opts.background);
    start();
    return api;
  });

  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60;
    last = now;
    var v = build(dt);
    rig.render(v);
    emit("frame", v, dt);
  }
  function start() { if (!running && rig) { running = true; last = 0; raf = requestAnimationFrame(frame); } }
  function stop() { running = false; cancelAnimationFrame(raf); }

  // a hidden tab draws nothing; coming back must not replay the whole
  // absence as one enormous physics step
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stop(); else if (opts.paused !== true) start();
  });

  var SIDE = { left: "L", right: "R", L: "L", R: "R" };
  function side(s) {
    var k = SIDE[s];
    if (!k) throw new Error("side is 'left' or 'right' (hers)");
    return k;
  }
  function setMany(o) { for (var k in o) api.set(k, o[k]); return api; }

  var api = {
    ready: ready,
    model: model,

    /* -- parameters ---------------------------------------------------- */
    params: function () {
      return model.params.map(function (p) {
        return { id: p.id, min: p.min, max: p.max, def: p.def, group: p.group, label: p.label, value: values[p.id] };
      });
    },
    set: function (id, v) {
      if (typeof id === "object") return setMany(id);
      if (!(id in RANGE)) throw new Error("unknown parameter " + id);
      values[id] = clampParam(id, +v);
      return api;
    },
    /* The value she is showing this frame, after every layer. base(id) is
       what set() last said. */
    get: function (id) { return out[id]; },
    base: function (id) { return values[id]; },
    reset: function (ids) {
      (ids || Object.keys(values)).forEach(function (k) { values[k] = DEF[k]; });
      return api;
    },

    /* -- expressions --------------------------------------------------- */
    expressions: function () { return Object.keys(AISA.expressions); },
    expression: function (name, o) {
      o = o || {};
      if (name == null) name = "neutral";
      if (!AISA.expressions[name]) throw new Error("unknown expression " + name);
      if (o.fade != null) exprFade = Math.max(0, +o.fade);
      var weight = o.weight == null ? 1 : Math.max(0, Math.min(1, +o.weight));
      if (!o.mix) for (var k in exprTarget) exprTarget[k] = 0;
      exprTarget[name] = weight;
      // A change of face is covered by a blink, as an animator would: the
      // eyes shut on the old expression and open on the new one, and the
      // in-between never shows. Only when the eyes change, and only once.
      if (auto.blink && blink.t < 0 && name !== current && o.blink !== false) {
        var a = AISA.expressions[current] || {}, b = AISA.expressions[name];
        var eyes = ["ParamEyeLOpen", "ParamEyeROpen", "ParamEyeLSmile", "ParamEyeRSmile"];
        for (var q = 0; q < eyes.length; q++) {
          if (Math.abs((a[eyes[q]] == null ? DEF[eyes[q]] : a[eyes[q]]) - (b[eyes[q]] == null ? DEF[eyes[q]] : b[eyes[q]])) > 0.15) {
            blink.t = 0; blink.twice = false; break;
          }
        }
      }
      current = name;
      emit("expression", name, weight);
      return api;
    },
    current: function () { return current; },

    /* -- motions ------------------------------------------------------- */
    motions: function () { return Object.keys(AISA.motions); },
    play: function (name, o) {
      o = o || {};
      var def = AISA.motions[name];
      if (!def) return Promise.reject(new Error("unknown motion " + name));
      if (!o.layer) api.stop();
      var c = compile(name);
      return new Promise(function (resolve) {
        playing.push({ name: name, c: c, t: 0, len: c.len, loop: o.loop != null ? !!o.loop : c.loop,
                       speed: o.speed || 1, weight: o.weight == null ? 1 : +o.weight, env: 0, resolve: resolve });
        emit("motion", name, "start");
      });
    },
    stop: function (name) {
      playing.forEach(function (m) { if (!name || m.name === name) m.stopping = true; });
      return api;
    },
    playing: function () { return playing.filter(function (m) { return !m.stopping; }).map(function (m) { return m.name; }); },

    /* -- the face ------------------------------------------------------ */
    /* Where to look, -1..1 each way: +x to the right of the screen, +y up.
       lookAt(null) looks straight ahead again. */
    lookAt: function (x, y) {
      if (x == null) { look.on = false; return api; }
      var nx = Math.max(-1, Math.min(1, +x)), ny = Math.max(-1, Math.min(1, +y || 0));
      // a big glance away is often a blink as well
      var jump = Math.abs(nx - look.tx) + Math.abs(ny - look.ty);
      if (auto.blink && blink.t < 0 && jump > 0.9 && Math.random() < 0.5) { blink.t = 0; blink.twice = false; }
      look.on = true;
      look.tx = nx; look.ty = ny;
      return api;
    },
    /* The same, at a point on the page: she looks at the pointer, a
       finger, whatever the caller tracks. */
    lookAtPoint: function (clientX, clientY) {
      if (!rig) return api;
      var p = rig.toModel(clientX, clientY), h = model.landmarks.head;
      return api.lookAt((p.x - h[0]) / 140, -(p.y - h[1]) / 140);
    },
    blink: function () { blink.t = 0; blink.twice = false; return api; },
    eyes: function (o) {
      o = o || {};
      if (o.open != null) api.set({ ParamEyeLOpen: o.open, ParamEyeROpen: o.open });
      if (o.smile != null) api.set({ ParamEyeLSmile: o.smile, ParamEyeRSmile: o.smile });
      if (o.slant != null) api.set({ ParamEyeLAngle: o.slant, ParamEyeRAngle: o.slant });
      if (o.x != null) api.set("ParamEyeBallX", o.x);
      if (o.y != null) api.set("ParamEyeBallY", o.y);
      return api;
    },
    eye: function (s, o) {
      var k = side(s); o = o || {};
      if (o.open != null) api.set("ParamEye" + k + "Open", o.open);
      if (o.smile != null) api.set("ParamEye" + k + "Smile", o.smile);
      if (o.slant != null) api.set("ParamEye" + k + "Angle", o.slant);
      return api;
    },
    brows: function (o) {
      o = o || {};
      if (o.y != null) api.set({ ParamBrowLY: o.y, ParamBrowRY: o.y });
      if (o.slant != null) api.set({ ParamBrowLAngle: o.slant, ParamBrowRAngle: o.slant });
      return api;
    },
    mouth: function (o) {
      o = o || {};
      if (o.open != null) api.set("ParamMouthOpenY", o.open);
      if (o.form != null) api.set("ParamMouthForm", o.form);
      return api;
    },
    /* A loudness, 0..1, as often as you have one. This is the lip-sync
       socket: an audio analyser, a TTS viseme stream, a microphone meter. */
    speak: function (level) {
      voice.target = Math.max(0, Math.min(1, +level || 0));
      voice.held = 0;
      return api;
    },

    /* -- head, body, limbs --------------------------------------------- */
    head: function (o) {
      o = o || {};
      if (o.x != null) api.set("ParamAngleX", o.x);
      if (o.y != null) api.set("ParamAngleY", o.y);
      if (o.z != null) api.set("ParamAngleZ", o.z);
      return api;
    },
    body: function (o) {
      o = o || {};
      if (o.x != null) api.set("ParamBodyAngleX", o.x);
      if (o.y != null) api.set("ParamBodyAngleY", o.y);
      if (o.z != null) api.set("ParamBodyAngleZ", o.z);
      if (o.lift != null) api.set("ParamBodyY", o.lift);
      return api;
    },
    /* Degrees. shoulder: 0 hanging, 90 out level, 180 straight up.
       elbow and wrist: positive carries on outward, negative folds in. */
    arm: function (s, o) {
      var k = side(s); o = o || {};
      if (o.shoulder != null) api.set("ParamArm" + k + "A", o.shoulder);
      if (o.elbow != null) api.set("ParamArm" + k + "B", o.elbow);
      if (o.wrist != null) api.set("ParamHand" + k, o.wrist);
      return api;
    },
    leg: function (s, deg) { return api.set("ParamLeg" + side(s), deg); },

    /* -- running ------------------------------------------------------- */
    auto: function (o) {
      if (!o) return { blink: auto.blink, breath: auto.breath, idle: auto.idle, physics: auto.physics };
      for (var k in o) if (k in auto) auto[k] = !!o[k];
      return api;
    },
    pause: function () { stop(); return api; },
    resume: function () { start(); return api; },
    /* Framing: zoom about the middle of her, and a nudge in model pixels. */
    view: function (o) {
      if (!rig) return api;
      o = o || {};
      if (o.zoom != null) rig.view.zoom = Math.max(0.2, +o.zoom);
      if (o.x != null) rig.view.dx = +o.x;
      if (o.y != null) rig.view.dy = +o.y;
      return api;
    },
    /* A CSS-style "#rrggbb", or null for transparent so she can stand over
       whatever the page has behind the canvas. */
    background: function (c) {
      if (!rig) return api;
      if (!c) { rig.background = null; return api; }
      var m = /^#?([0-9a-f]{6})$/i.exec(c);
      if (!m) throw new Error("background is #rrggbb or null");
      var n = parseInt(m[1], 16);
      rig.background = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1];
      return api;
    },
    snapshot: function () {
      var o = {};
      for (var k in out) o[k] = out[k];
      return o;
    },
    on: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); return api; },
    off: function (type, fn) {
      var l = listeners[type] || [], i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
      return api;
    },
    /* Advance time by hand, in steps of 1/60 s, and draw the result: for
       a test, a recording, or a page that runs its own clock (pause()
       first, or the animation frame keeps time as well). */
    step: function (seconds) {
      if (!rig) return api;
      var n = Math.max(1, Math.round((+seconds || 0) * 60));
      for (var i = 0; i < n; i++) { build(1 / 60); emit("frame", out, 1 / 60); }
      rig.render(out);
      return api;
    },
    stats: function () { return rig ? rig.stats : null; }
  };
  return api;
};
